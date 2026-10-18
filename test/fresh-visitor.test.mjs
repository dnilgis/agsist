/* First-time visitor fixes (Oct 18, 2026; the fresh-2026-10 read of 80 pages).
 *   1. One shared glossary: data/glossary.json, components/glossary.js marks the
 *      FIRST use of each term in a page's main content, /glossary lists them all.
 *   2. Who made it and where the data comes from, near the top of tool and price pages.
 *   3. A "Next" block from one map, data/next-links.json, so no page is a dead end.
 * The browser part needs Playwright and Chromium; it is skipped where they are missing.
 *   node --test test/fresh-visitor.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const G = require(ROOT + "components/glossary.js");
const GL = JSON.parse(read("data/glossary.json"));
const NX = JSON.parse(read("data/next-links.json"));
const C = G.compile(GL.terms);
const marks = (segs) => G.pickMarks(segs, C).map((m) => [m.id, segs[m.seg].slice(m.start, m.end)]);

/* a site path -> the file Pages serves for it, or null */
function fileFor(href) {
  const p = href.split("#")[0].replace(/^\//, "");
  if (p === "") return "index.html";
  for (const f of [p, p + ".html", p.replace(/\/$/, "") + "/index.html"]) if (existsSync(join(ROOT, f)) && statSync(join(ROOT, f)).isFile()) return f;
  return null;
}

test("the glossary has the terms the read found unexplained, each complete and plain", () => {
  const need = ["basis", "wasde", "cca", "nass", "rma", "fsa", "settle", "nearby", "carry", "cwt", "managed-money", "ending-stocks",
    "the-trade", "black-layer", "crp", "shrink", "nowcast", "crop-progress", "net-30", "noaa", "futures", "cash-bid"];
  const ids = GL.terms.map((t) => t.id);
  for (const id of need) assert.ok(ids.includes(id), "missing term " + id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  for (const t of GL.terms) {
    assert.ok(t.term && t.q && t.short && t.long && t.match.length, t.id + " has term, q, short, long and match");
    assert.ok(t.short.length <= 200, t.id + " short line stays short (" + t.short.length + ")");
    for (const src of t.match) assert.doesNotThrow(() => new RegExp(src, t.flags ?? "i"), t.id + ": " + src);
    for (const s of t.see || []) assert.ok(fileFor(s.href), t.id + " links " + s.href + ", a real page");
    if (t.source) assert.match(t.source.href, /^https:\/\//);
  }
  assert.equal(C.length, GL.terms.length, "every term compiles");
});

test("each term resolves on its own words and on nothing else", () => {
  const hit = (s) => marks([s]).map((m) => m[0]);
  const yes = { basis: "Your basis is weak.", "cash-bid": "Check two cash bids.", futures: "December futures fell.", settle: "The Oct 16 settle was",
    nearby: "Nearby Dec '26", carry: "a big carry pays storage", cwt: "$240 per cwt", "managed-money": "managed money is net long",
    "ending-stocks": "ending stocks rose", "the-trade": "the trade expected more", wasde: "the Oct 9 WASDE", nass: "USDA NASS said",
    rma: "RMA sets it", fsa: "your county FSA office", crp: "land in CRP", cca: "Lindquist, CCA", noaa: "NOAA records",
    "crop-progress": "the Crop Progress report", "black-layer": "corn hit black layer", shrink: "the shrink factor",
    nowcast: "our nowcast says", "net-30": "invoiced net 30", cbot: "on CBOT", cftc: "the CFTC report", "open-interest": "share of open interest",
    "marketing-year": "the marketing year", aph: "your APH" };
  for (const [id, s] of Object.entries(yes)) assert.ok(hit(s).includes(id), id + " in: " + s);
  const no = ["elevators nearby pay more", "on a daily basis", "the trade war with China", "the Cash Bid Index for October",
    "carry the bucket", "settle in for winter", "nass and wasde in lower case"];
  for (const s of no) assert.deepEqual(hit(s), [], "no mark in: " + s);
});

test("a page marks only the first use of each term, in reading order", () => {
  const m = marks(["Basis is cash minus futures.", "Basis again, and futures again.", "Then WASDE, and basis once more."]);
  assert.deepEqual(m, [["basis", "Basis"], ["futures", "futures"], ["wasde", "WASDE"]]);
  assert.deepEqual(marks(["$4.74 ▼ 3¢ basis 40"]), [], "mostly-number text is left alone");
  const many = Array.from({ length: 40 }, (_, i) => GL.terms[i % GL.terms.length].term + " here.");
  assert.ok(G.pickMarks(many, C).length <= G.MAX, "capped at " + G.MAX + " marks a page");
});

test("glossary.js stays out of nav, links, headings and form text, and is accessible", () => {
  const js = read("components/glossary.js");
  for (const tag of ["A", "BUTTON", "H1", "H2", "H3", "SUMMARY", "LABEL", "NAV", "HEADER", "FOOTER", "TH"]) assert.match(js, new RegExp("\\b" + tag + "\\|"), tag + " is skipped");
  assert.match(js, /querySelector\('\[data-glossary-root\]'\) \|\| doc\.querySelector\('main'\)/, "main content only");
  assert.match(js, /aria-expanded/); assert.match(js, /aria-controls', 'gl-pop'/); assert.match(js, /Escape/);
  assert.match(js, /requestIdleCallback/, "loads after the page, when idle");
});

test("/glossary is built from the same file, indexable, and listed", () => {
  execFileSync("python3", [join(ROOT, "scripts/build_glossary.py"), "--check"], { cwd: ROOT });
  const h = read("glossary.html");
  for (const t of GL.terms) assert.ok(h.includes(`<section id="${t.id}">`), "section for " + t.id);
  assert.match(h, /<link rel="canonical"\s+href="https:\/\/agsist\.com\/glossary">/);
  assert.doesNotMatch(h, /noindex/);
  assert.match(h, /"@type":"FAQPage"/); assert.match(h, /"@type":"DefinedTermSet"/);
  assert.match(h, /"jobTitle":"Certified Crop Adviser \(CCA\)"/);
  assert.match(h, /Sigurd Lindquist, CCA/);
  assert.match(read("sitemap.xml"), /<loc>https:\/\/agsist\.com\/glossary<\/loc>/);
  assert.match(read("llms.txt"), /https:\/\/agsist\.com\/glossary\)/);
});

test("every Next link is a real page, 2 or 3 a page, never the page itself", () => {
  assert.ok(NX.ask && NX.ask.length > 20, "default ask text");
  for (const [k, e] of Object.entries(NX.pages)) {
    assert.ok(e.links.length >= 2 && e.links.length <= 3, k + " has 2 or 3 links");
    assert.ok(k === "/" || fileFor(k), k + " is a page");
    for (const l of e.links) {
      assert.ok(fileFor(l.href), k + " -> " + l.href + " exists");
      assert.notEqual(l.href.replace(/\/$/, ""), k, k + " links itself");
      assert.ok(l.text && !/—/.test(l.text + (l.why || "")), k + " link text");
    }
  }
});

test("pages that load next-links.js have an entry, and the pages read get the script", () => {
  const keyOf = (f) => "/" + f.replace(/\/index\.html$/, "").replace(/\.html$/, "");
  const pending = new Set(["/", "/tools"]); // index.html and tools.html: shared files, added at merge (Integration needed)
  for (const k of Object.keys(NX.pages)) {
    if (pending.has(k)) continue;
    const f = fileFor(k), h = read(f);
    assert.match(h, /<script src="\/components\/next-links\.js\?v=\d+" defer><\/script>/, f + " loads next-links.js");
    if (k !== "/glossary") assert.match(h, /<script src="\/components\/glossary\.js\?v=\d+" defer><\/script>/, f + " loads glossary.js");
    assert.equal(keyOf(f), k);
  }
});

test("no em dashes in anything this adds", () => {
  for (const f of ["data/glossary.json", "data/next-links.json", "components/glossary.js", "components/next-links.js", "glossary.html", "scripts/build_glossary.py"])
    assert.doesNotMatch(read(f), /—/, f);
  for (const f of ["usda-calendar.html", "corn-futures-prices.html", "soybean-futures-prices.html", "wheat-futures-prices.html",
    "cattle-futures-prices.html", "cash-bids.html", "grain-bin-calculator.html", "crop-tour.html", "markets.html", "cot.html"]) {
    const lines = read(f).split("\n").filter((l) => /class="(madeby|ph-plain|ct-what|gb-intro|cog-next)"/.test(l));
    assert.ok(lines.length >= 1, f + " has its first-visitor line");
    for (const l of lines) assert.doesNotMatch(l, /—/, f);
  }
});

test("who made it: tool and price pages name Sig and the data source near the top", () => {
  for (const f of ["usda-calendar.html", "corn-futures-prices.html", "soybean-futures-prices.html", "wheat-futures-prices.html",
    "cattle-futures-prices.html", "cash-bids.html", "crop-tour.html", "cot.html", "hail-map.html", "markets.html", "fertilizer.html",
    "conditions.html", "basis.html", "lrp.html", "store-or-sell.html", "grain-emc.html", "harvest-price-tracker.html", "farmland-atlas.html"]) {
    const h = read(f), i = h.indexOf("<h1"), j = h.indexOf('class="madeby"');
    assert.ok(j > i && i > 0, f + " has the made-by line after its H1");
    assert.ok(j - i < 6000, f + " made-by line sits near the top");
    assert.match(h.slice(j, h.indexOf("</p>", j)), /Sigurd Lindquist, CCA<\/a>[.,] .*(Data|Weather|Dates|Sources|Bids|Tour|radar)/i, f);
    assert.equal(h.split('class="madeby"').length, 2, f + " has one made-by line");
  }
});

/* ---------- browser: the marks and the Next block on real pages ---------- */
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let f = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    if (f.endsWith("/")) f += "index.html";
    if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}

test("in a browser: first use only, never in nav, links or headings; Next block and ask render", { skip, timeout: 90000 }, async () => {
  const srv = await serve();
  const base = "http://127.0.0.1:" + srv.address().port;
  const b = await chromium.launch({ executablePath: CHROME });
  try {
    for (const w of [390, 1280]) {
      const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
      const p = await ctx.newPage();
      await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      for (const path of ["/corn-futures-prices", "/usda-calendar", "/grain-shrink"]) {
        await p.goto(base + path, { waitUntil: "load" });
        await p.waitForSelector(".next-links", { timeout: 15000 });
        await p.waitForFunction(() => document.querySelector(".gl-term") || performance.now() > 9000, null, { timeout: 15000 });
        const r = await p.evaluate(() => {
          const t = [...document.querySelectorAll(".gl-term")];
          return {
            ids: t.map((b) => b.dataset.term),
            bad: t.filter((b) => b.closest("a,nav,header,footer,h1,h2,h3,h4,h5,h6,summary,label,#site-header,#site-footer") || !b.closest("main")).length,
            next: [...document.querySelectorAll(".next-links a")].map((a) => a.getAttribute("href")),
            ask: !!document.querySelector(".next-links [data-signup-ask]"),
            wide: document.documentElement.scrollWidth > innerWidth + 1,
          };
        });
        assert.ok(r.ids.length > 0, path + " marks some terms");
        assert.equal(new Set(r.ids).size, r.ids.length, path + " marks each term once");
        assert.equal(r.bad, 0, path + " no mark in nav, links or headings");
        const key = path;
        assert.deepEqual(r.next, NX.pages[key].links.map((l) => l.href), path + " Next links from the map");
        assert.equal(r.wide, false, path + " no sideways scroll at " + w);
        const btn = p.locator(".gl-term").first();
        await btn.scrollIntoViewIfNeeded(); await btn.click();
        assert.equal(await btn.getAttribute("aria-expanded"), "true");
        assert.ok(await p.locator("#gl-pop").isVisible(), "popover opens on tap");
        await p.keyboard.press("Escape");
        assert.equal(await btn.getAttribute("aria-expanded"), "false", "Escape closes");
      }
      await ctx.close();
    }
  } finally { await b.close(); srv.close(); }
});
