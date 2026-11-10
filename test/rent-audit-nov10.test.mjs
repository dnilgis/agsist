/* Cash rent audit, Nov 10, 2026 (feedbag notes/audits/rent-audit-2026-11-10.md), each case from the real data:
 *   1 state tables: a rent more than three survey years old reads "n/a, last published YYYY" and sorts as no
 *     value (Fayette IA irrigated, $203 from 2010, sat in the 2026 column); one rule, scripts/rent_age.py, the
 *     Atlas tiles' rule since Oct 19.
 *   2 Atlas titles, ledes and descriptions name no old rent: Otero CO ($35, 2009) and Colusa CA ("Cash Rent 2021:
 *     $28/Acre" beside a 2026 irrigated $375) fall back to the current irrigated rent.
 *   4 the change line names its counties when their median is more than 5% from the headline (Georgia: $58
 *     headline, $64.50 to $73.50 across the 82 counties published both years).
 *   5 counties NASS did not publish are rows that say so (Georgia: 24, Bibb among them), and the hero and FAQ
 *     say so.
 *   6 phone: picker options open the county table, a county filter, the three rent columns fit 390 px.
 *   7 one rounding (Adair IA 21.5%, not 22%), one ten-year base (2016), "unchanged" (Illinois), no "every year"
 *     in the fold, one as-of date on an Atlas page.
 *   8 the 2025 US cash rent fact stops printing (the 2026 figure is out and not in the repo).
 *
 *   node --test test/rent-audit-nov10.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { extname, join, normalize } from "node:path";
import os from "node:os";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const TMP = mkdtempSync(join(os.tmpdir(), "rent-audit-"));
const py = (code) => execFileSync("python3", ["-c", code], { cwd: ROOT, encoding: "utf8", env: { ...process.env, PYTHONHASHSEED: "0" } });

// the state pages, built from the committed data into a temp folder (the set is built on main, never here)
py(`import sys; sys.path.insert(0, 'scripts'); import build_state_rent_pages as B; B.build_all(${JSON.stringify(join(TMP, "rent"))})`);
const R = (f) => readFileSync(join(TMP, "rent", f), "utf8");
const row = (h, name) => {
  const m = new RegExp(`<tr[^>]*><td>(?:<a [^>]*>)?${name}(?:</a>)?[\\s\\S]*?</tr>`).exec(h);
  assert.ok(m, name + " row");
  return m[0];
};

test("rent_age.py: its selftest, and both builders import it (no second copy of the rule)", () => {
  assert.match(execFileSync("python3", ["scripts/rent_age.py", "--selftest"], { cwd: ROOT, encoding: "utf8" }), /selftest: ok/);
  for (const f of ["scripts/build_state_rent_pages.py", "scripts/build_atlas_pages.py", "scripts/build_farmland_atlas.py"])
    assert.match(read(f), /^import rent_age as RA\b/m, f);
  const atlas = read("scripts/build_atlas_pages.py");
  assert.doesNotMatch(atlas, /(?:RL|rent_latest) - 3\b/, "an inline three-year rule is back in build_atlas_pages.py");
  assert.doesNotMatch(read("scripts/build_state_rent_pages.py"), /yr_latest - 9\b/, "the 2017 ten-year base is back");
});

test("generated_sets: the rent and Atlas sets list rent_age.py as code", () => {
  const out = JSON.parse(py(`import sys, json; sys.path.insert(0, 'scripts'); import generated_sets as G
print(json.dumps({s['id']: G.code_paths(s) for s in G.SETS if s['id'] in ('rent', 'farmland-atlas')}))`));
  assert.ok(out.rent.includes("scripts/rent_age.py"), "rent set");
  assert.ok(out["farmland-atlas"].includes("scripts/rent_age.py"), "Atlas set");
});

test("1: Fayette IA irrigated (2010) reads n/a with its year and sorts as no value; every old cell does", () => {
  const fay = row(R("iowa.html"), "Fayette");
  assert.match(fay, /<td class="mut old" data-v="-1">n\/a, last published 2010<\/td>/);
  assert.doesNotMatch(fay, /\$203/);
  let n = 0;
  for (const st of ["iowa", "georgia", "texas", "california", "kansas", "colorado"]) {
    const h = R(st + ".html");
    const yr = +/<h1>[^<]* (20\d\d)<\/h1>/.exec(h)[1];
    for (const m of h.matchAll(/<td class="mut" data-v="([-\d.]+)">\$[\d,.]+ <span[^>]*>\((\d{4})\)<\/span><\/td>/g)) {
      n++;
      assert.ok(+m[2] >= yr - 3, `${st}: a ${m[2]} rent still prints in the ${yr} table`);
      assert.notEqual(m[1], "-1");
    }
    for (const m of h.matchAll(/<td class="mut old" data-v="([-\d.]+)">n\/a, last published (\d{4})<\/td>/g))
      assert.ok(m[1] === "-1" && +m[2] < yr - 3, `${st}: ${m[0]}`);
  }
  assert.ok(n > 20, `recent older rents still print with their year (${n})`);
});

test("4: Georgia names the counties behind its change; Iowa keeps 'the same 99 counties'", () => {
  const ga = R("georgia.html");
  assert.match(ga, /Across the 82 counties published both years the state median went from \$64\.50 to \$73\.50/);
  assert.match(ga, /<div class="s">median of the 82 counties published both years<\/div>/);
  assert.match(ga, /That median is not the \$58 headline, which counts every county published in 2026\./);
  const ia = R("iowa.html");
  assert.match(ia, /Across the same 99 counties the state median went from \$270 to \$266/);
  for (const st of ["louisiana", "florida", "massachusetts", "south-dakota", "west-virginia"])
    assert.match(R(st + ".html"), /counties published both years the state median/, st);
});

test("5: counties NASS did not publish are rows; the hero and FAQ say so", () => {
  const ga = R("georgia.html");
  assert.match(row(ga, "Bibb"), /<td class="mut old" data-v="-1">not published<\/td>/);
  assert.equal((ga.match(/>not published<\/td>/g) || []).length, 24);
  assert.match(ga, /Every county is in the table below, including 24 NASS did not publish\./);
  assert.match(ga, /Why does my Georgia county say not published\?/);
  assert.doesNotMatch(ga, /Why is my Georgia county not listed/);
  assert.match(ga, /<h2 id="counties"[^>]*>Every county, 2026<\/h2>/);
  const ia = R("iowa.html");
  assert.match(ia, /Every county is in the table below\./);
  assert.doesNotMatch(ia, />not published<\/td>/, "Iowa: all 99 published");
  let all = 0;
  for (const st of ["virginia", "west-virginia", "new-york", "kentucky"]) all += (R(st + ".html").match(/>not published<\/td>/g) || []).length;
  assert.ok(all >= 70, `unpublished rows in VA, WV, NY, KY: ${all}`);
});

test("7: one ten-year base (2016), 'unchanged' for Illinois, no 'every year' in the fold", () => {
  const ia = R("iowa.html");
  assert.match(ia, /<div class="l">vs 2016<\/div>/);
  assert.doesNotMatch(ia, /vs 2017</);
  const il = R("illinois.html");
  assert.match(il, /<b style='color:[^']*'>unchanged vs 2025<\/b>/);
  for (const f of ["illinois.html", "iowa.html", "index.html", "georgia.html"]) {
    const h = R(f);
    assert.doesNotMatch(h, /[+-]0\.0%|[+-]0\.0&#37;/, f);
    const fold = h.slice(h.indexOf('<details class="rs-terms"'));
    assert.doesNotMatch(fold, /every year/, f);
  }
  assert.match(R("index.html"), /no survey in 2015 or 2018/);
});

test("6: picker options open the county table; the filter has its place before the script runs", () => {
  const hub = R("index.html");
  const opts = [...hub.matchAll(/<option value="([^"]+)">/g)].map((m) => m[1]);
  assert.ok(opts.length >= 47);
  for (const o of opts) assert.match(o, /^\/rent\/[a-z-]+#counties$/);
  const ia = R("iowa.html");
  assert.match(ia, /<div class="rs-filter"><label for="rs-q">Find a county<\/label><input id="rs-q" type="search"[^>]*disabled>/);
  assert.match(ia, /\.rs-filter\{[^}]*min-height:44px/);
  assert.ok(ia.indexOf('class="rs-filter"') < ia.indexOf('id="rs-table"'), "the filter sits above the table");
});

/* ---------- browser: 390 px ---------- */
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += p.endsWith("/") ? "index.html" : ".html";
    const base = p.startsWith("/rent/") ? TMP : ROOT;
    const f = normalize(join(base, p));
    if (!f.startsWith(base) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("390 px: the three rent columns show without a sideways swipe, and the filter finds Fayette", { skip, timeout: 120000 }, async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await ctx.route("**/*", (r) => r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort());
    const pg = await ctx.newPage();
    for (const st of ["iowa", "georgia", "texas"]) {
      await pg.goto(`http://127.0.0.1:${port}/rent/${st}`, { waitUntil: "load" });
      const r = await pg.evaluate(() => {
        const ths = [...document.querySelectorAll("#rs-table thead th")];
        const pas = ths.find((t) => /^Pasture/i.test(t.textContent.trim()));
        const wrap = document.querySelector(".rs-tw").getBoundingClientRect();
        return { right: pas && pas.getBoundingClientRect().right, wrap: wrap.right, page: document.documentElement.scrollWidth };
      });
      assert.ok(r.right, `${st}: a pasture column`);
      assert.ok(r.right <= r.wrap + 0.5 && r.right <= 390, `${st}: pasture ends at ${r.right} px, past the ${r.wrap} px table box`);
      assert.ok(r.page <= 390, `${st}: the page scrolls sideways (${r.page} px)`);
    }
    await pg.goto(`http://127.0.0.1:${port}/rent/iowa`, { waitUntil: "load" });
    const top = () => pg.evaluate(() => document.getElementById("rs-table").getBoundingClientRect().top + window.scrollY);
    const y0 = await top();
    await pg.fill("#rs-q", "fayet");
    const shown = await pg.$$eval("#rs-table tbody tr", (rs) => rs.filter((r) => !r.hidden).map((r) => r.cells[0].textContent.trim()));
    assert.deepEqual(shown.map((s) => s.replace(/\s*sales$/, "")), ["Fayette"]);
    assert.equal(await pg.textContent("#rs-qn"), "1 county");
    assert.equal(await top(), y0, "the table does not move when the filter is used");
    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
});

/* ---------- Atlas ---------- */
const OUT = mkdtempSync(join(os.tmpdir(), "rent-audit-atlas-"));
let built = false;
function atlas() {
  if (!built) {
    execFileSync("python3", ["scripts/build_atlas_pages.py", "--only", "08089", "06011", "19001", "--out", OUT],
      { cwd: ROOT, env: { ...process.env, PYTHONHASHSEED: "0" }, stdio: "pipe", timeout: 600000 });
    built = true;
  }
  return (p) => readFileSync(join(OUT, "farmland-atlas", p), "utf8");
}
const meta = (h) => ({ title: /<title>([^<]*)<\/title>/.exec(h)[1], desc: /<meta name="description" content="([^"]*)"/.exec(h)[1] });

test("2: Otero CO and Colusa CA name their current irrigated rent, never the old dry one", { timeout: 600000 }, () => {
  const A = atlas();
  const ot = meta(A("colorado/otero-county.html")), co = meta(A("california/colusa-county.html"));
  assert.match(ot.title, /Irrigated Cash Rent 2026: \$\d+\/Acre/);
  assert.doesNotMatch(ot.title + ot.desc, /2009|\$35\b/);
  assert.match(co.title, /Irrigated Cash Rent 2026: \$375\/Acre/);
  assert.match(co.desc, /irrigated cash rent \$375 an acre \(2026\)/);
  assert.doesNotMatch(co.title + co.desc, /2021|\$28\b/);
});

test("7: Adair IA: one rounding of its ten-year change, one as-of date", { timeout: 600000 }, () => {
  const h = atlas()("iowa/adair-county.html");
  assert.match(h, /21\.5%/);
  assert.doesNotMatch(h, /\b22% from \$195/);
  const asof = [...h.replace(/<script[\s\S]*?<\/script>/g, "").matchAll(/\b[Aa]s of ([A-Z][a-z]{2} \d{1,2})/g)].map((m) => m[1]);
  assert.ok(asof.length >= 1, "the page states its as-of date");
  assert.equal(new Set(asof).size, 1, "as-of dates on the page: " + [...new Set(asof)].join(", "));
});

test("8: the 2025 US cash rent fact is stopped and never picked", () => {
  const f = JSON.parse(read("data/daily-facts.json")).facts.find((x) => x.id === "us-cash-rent-2025");
  if (!f) return;                          // replaced by a 2026 entry: nothing left to stop
  assert.match(String(f.stop || ""), /2026/, "stopped, with the reason");
  const ids = JSON.parse(py(`import sys, json; sys.path.insert(0, 'scripts'); import daily_fact as D
from datetime import date, timedelta
print(json.dumps([(D.for_day(date(2026, 11, 2) + timedelta(days=k)) or {}).get('id') for k in range(420)]))`));
  assert.ok(!ids.includes("us-cash-rent-2025"));
  assert.ok(ids.filter(Boolean).length >= 400, "the days still have facts");
});
