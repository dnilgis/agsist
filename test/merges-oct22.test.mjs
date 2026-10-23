/* The page merges Sig approved on Oct 22 and 23, 2026 (scripts/moved_pages.py holds the table).
 *
 *   node --test test/merges-oct22.test.mjs
 *
 * Each old address is a small forward page: noindex, canonical to the page that took it over,
 * the query and #hash kept (its own hash wins, else the section's anchor). The section is on the
 * new page. Nothing the site serves links to an old address: menu, footer, fallbacks, sitemaps,
 * llms.txt, search, Next blocks and every hand-written page. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const MOVED = JSON.parse(execFileSync("python3", ["-c",
  "import sys,json;sys.path.insert(0,'scripts');import moved_pages as m;print(json.dumps({k:list(v) for k,v in m.MOVED.items()}))"],
  { cwd: ROOT, encoding: "utf8" }));

test("the table: nine merges, each into a page that exists", () => {
  assert.deepEqual(Object.keys(MOVED).sort(), ["/archive", "/cash-bids/states", "/conditions-yield", "/elevators",
    "/foreign-land", "/hail/", "/news", "/pod-counts", "/scorecard", "/whats-priced-in"].sort());
  for (const [old, [to, anchor, file]] of Object.entries(MOVED)) {
    assert.ok(existsSync(path.join(ROOT, to.slice(1) + ".html")), old + " -> " + to + " exists");
    assert.ok(existsSync(path.join(ROOT, file)), old + " forward page " + file);
    assert.match(read(to.slice(1) + ".html"), new RegExp(`id="${anchor}"`), `${to} carries #${anchor}`);
  }
  execFileSync("python3", ["scripts/moved_pages.py", "--check"], { cwd: ROOT });
  assert.match(execFileSync("python3", ["scripts/moved_pages.py", "--selftest"], { cwd: ROOT, encoding: "utf8" }), /passed/);
});

test("every forward page: under 1.5 KB, noindex, canonical to the new page, query and hash kept", () => {
  for (const [old, [to, anchor, file]] of Object.entries(MOVED)) {
    const s = read(file);
    assert.ok(Buffer.byteLength(s) < 1536, file + " under 1.5 KB");
    assert.match(s, /<meta name="robots" content="noindex,follow">/, file);
    assert.ok(s.includes(`<link rel="canonical" href="https://agsist.com${to}">`), file + " canonical");
    assert.ok(s.includes(`<meta http-equiv="refresh" content="0; url=${to}#${anchor}">`), file + " no-script forward");
    assert.doesNotMatch(s, /—|&mdash;/, file);
    const js = s.match(/<script>([\s\S]*?)<\/script>/)[1];
    const go = (search, hash) => { const c = { location: { search, hash, replace(u) { c.to = u; } } }; vm.runInNewContext(js, c); return c.to; };
    assert.equal(go("", ""), `${to}#${anchor}`, file + " lands on the section");
    assert.equal(go("?zip=54728", ""), `${to}?zip=54728#${anchor}`, file + " keeps the query");
    assert.equal(go("?zip=54728", "#corn"), `${to}?zip=54728#corn`, file + " keeps its own hash");
  }
});

test("nothing links to an old address: chrome, sitemaps, llms.txt, search, Next blocks, every page", () => {
  const olds = Object.keys(MOVED).map((o) => o.replace(/\/$/, ""));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const LINK = new RegExp(`(?:href="|agsist\\.com|"href": ?")(?:${olds.map(esc).join("|")})(?:\\.html)?\\/?(?=["?#<\\s])`);
  for (const f of ["components/header.html", "components/footer.html", "components/header-fallback.html", "components/footer-fallback.html",
    "llms.txt", "data/search-index.json", "data/next-links.json"].concat(readdirSync(ROOT).filter((x) => /^sitemap.*\.xml$/.test(x))))
    assert.doesNotMatch(read(f), LINK, f);
  for (const n of readdirSync(path.join(ROOT, "data/next"))) assert.doesNotMatch(read("data/next/" + n), LINK, n);
  const stubs = new Set(Object.values(MOVED).map((v) => v[2]));
  const bad = [];
  (function walk(d) {
    for (const n of readdirSync(path.join(ROOT, d))) {
      if (n.startsWith(".") || n === "node_modules" || n === "data" || n === "test") continue;
      const p = d ? d + "/" + n : n;
      if (statSync(path.join(ROOT, p)).isDirectory()) {
        // Past daily issues and the town pages are rebuilt by their own jobs; the forward pages carry them meanwhile.
        if (p === "daily" || p === "cash-bids") continue;
        walk(p); continue;
      }
      if (!/\.html$/.test(n) || stubs.has(p)) continue;
      if (LINK.test(read(p).replace(/href="\/hail\/\d{4}-/g, ""))) bad.push(p);
    }
  })("");
  assert.deepEqual(bad, [], "pages linking to an old address");
  assert.match(read("scripts/inject_static_nav.py"), /"\/news", "\/conditions-yield", "\/whats-priced-in", "\/scorecard", "\/pod-counts", "\/hail\/",\s+"\/cash-bids\/states", "\/elevators", "\/foreign-land", "\/archive"\)/);
});

test("the menu and footer name the merged pages by what they hold now", () => {
  const h = read("components/header.html"), f = read("components/footer.html");
  assert.match(h, /href="\/basis"[^>]*>[\s\S]{0,200}Bids and basis by state/);
  assert.match(h, /USDA calendar and what&rsquo;s priced in/);
  assert.match(h, /Crop progress and size/);
  assert.ok(h.includes('href="/daily#past"') && f.includes('href="/daily#past"'), "Past briefings in the menu and footer");
  assert.match(read("components/loader.js"), /var CV = '86';/);
});

test("the sections carry what the old pages had", () => {
  const d = read("daily.html");
  assert.match(d, /<section class="nw" id="moved"[\s\S]*<!--SEED:newslist-->/, "the wire on the Daily");
  assert.match(d, /<section class="dv3-past" id="past"[\s\S]*<!--SEED:dailyrecent-->[\s\S]*<!--SEED:archivelist-->/, "past briefings");
  const c = read("conditions.html");
  for (const m of ["<!-- CS:panel -->", "<!-- CS:corn -->", "<!-- CS:record -->", "<!-- CY:table -->", "<!--SEED:cystats-->", "function buildVerdicts(j)"])
    assert.ok(c.includes(m), "conditions carries " + m);
  const u = read("usda-calendar.html");
  for (const m of ["<!-- PRERENDER:wp-next -->", "<!-- PRERENDER:as-board -->", "<!--SEED:pb:pb-plain-->", 'id="wp-dataset-ld"'])
    assert.ok(u.includes(m), "the calendar carries " + m);
  assert.match(u, /<title>WASDE &amp; USDA Report Dates 2026: Next WASDE [A-Z][a-z]{2} \d{1,2} \| AGSIST<\/title>/, "the calendar keeps its title (Sig, Oct 19)");
  assert.equal((u.match(/data-signup-ask=/g) || []).length, 1, "one ask on the calendar");
  assert.match(read("crop-tour.html"), /<section class="pc-wrap" id="pod-counts"/);
  assert.match(read("hail-map.html"), /<section class="hm-hist" id="history"[\s\S]*?<!--SEED:hailhistory--><p class="he-recap">[\s\S]*?<details class="he-yr"/);
  assert.match(read("basis.html"), /id="states"[\s\S]*<!--SEED:statelist--><p class="bs-seed"><b>\d+ states? with a current bid/);
  const l = read("list-your-elevator.html");
  for (const id of ["le-ask", "coverage", "claim", "cov-map"]) assert.ok(l.includes(`id="${id}"`), "list your elevator carries #" + id);
  assert.match(read("farmland-atlas.html"), /<details class="fa-fold" id="fa-foreign">[\s\S]*id="foreign"/);
  for (const h of ["conditions.html", "usda-calendar.html", "crop-tour.html", "daily.html", "list-your-elevator.html", "farmland-atlas.html"])
    for (const b of read(h).match(/<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g) || [])
      JSON.parse(b.replace(/<\/?script[^>]*>/g, ""));
});
