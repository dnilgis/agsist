/* Farmland Atlas: recorded farm sales (Oct 17, 2026), Illinois and Wisconsin.
 *
 *   node --test test/atlas-sales.test.mjs
 *
 * scripts/build_land_summary.py ports field-scout-land.js (rowObjs, marketSale, perAcre) to
 * Python. Both run the same made-up rows in test/fixtures/land-summary.json, so a change to
 * one that is not made to the other fails here.
 *
 * The fixture, worked by hand (fetched Oct 17, 2026, so sales through Sep 30, 2026):
 *   last 12 months, Oct 2025 to Sep 2026, market sales of 20+ acres with known acres:
 *     A 800,000/80 = 10,000   B 1,100,000/100 = 11,000   C 480,000/40 = 12,000
 *     D 1,300,000/100 = 13,000   E 2,100,000/150 = 14,000   F 1,500,000/30 = 50,000
 *     sorted 10,000 11,000 12,000 13,000 14,000 50,000 (n 6):
 *       median rank 2.5 -> (12,000 + 13,000) / 2 = 12,500
 *       25th rank 1.25 -> 11,000 + 0.25 x 1,000 = 11,250; 75th rank 3.75 -> 13,000 + 0.75 x 1,000 = 13,750
 *     also market: G (5 acres, too small), H (two parcels, acres unknown); so 8 market sales.
 *     not market: I related parties, J quit claim with no price, L exempt. K is dated Dec 2026: never counted.
 *   12 before: M 10,000, N 9,000, O 8,000, Q 12,000 (three parcels, acres given): 4, under 5, no median.
 *   24 months, the 10 comparables: 8,000 9,000 10,000 10,000 11,000 12,000 12,000 13,000 14,000 50,000
 *     median rank 4.5 -> 11,500; 25th rank 2.25 -> 10,000; 75th rank 6.75 -> 12,750; width 2,750
 *     fences 10,000 - 4,125 = 5,875 and 12,750 + 4,125 = 16,875: only F (50,000) is outside, above.
 *   largest by acres: O 400, E 150, Q 120 (of 11 market sales with known acres). P is Sep 2024: out. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, extname, normalize } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const require = createRequire(import.meta.url);
const F = require(join(ROOT, "field-scout-land.js"));
const S = require(join(ROOT, "components/atlas-sales.js"));
const FX = JSON.parse(read("test/fixtures/land-summary.json"));
const PY = read("scripts/build_land_summary.py");

test("the Python builder passes its selftest on the shared fixture", () => {
  const r = spawnSync("python3", [join(ROOT, "scripts/build_land_summary.py"), "--selftest"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /selftest: ok/);
});

test("field-scout-land.js reads the shared fixture the way the Python port does", () => {
  const rows = F.rowObjs(FX.file);
  assert.deepEqual(rows.map((r) => F.marketSale(r, FX.fetched.slice(0, 10))), FX.expect.market);
  assert.deepEqual(rows.map((r) => r.ppa), FX.expect.ppa);
  // one deed-type rule: the Python pattern is the field-scout one, character for character
  const py = /^NON_MARKET = r"(.*)"$/m.exec(PY)[1];
  assert.equal(py, F.NON_MARKET.source);
  assert.equal(FX.non_market, F.NON_MARKET.source);
  assert.match(PY, /^ACRES_RULE = 2 /m);
  assert.equal(F.ACRES_RULE, 2);
  // the same median: field scout's medianPpa on the 6 comparables of the last 12 months
  const W = FX.expect.windows.cur;
  const comp = rows.filter((r) => F.marketSale(r, FX.fetched.slice(0, 10)) && r.ppa != null && r.acres >= 20 && r.date >= W[0] && r.date <= W[1]);
  assert.deepEqual(F.medianPpa(comp), { ppa: FX.expect.county.med.med, n: FX.expect.county.med.n });
});

// a summary shaped like the builder's, from the fixture's expected county
function fixtureSummary(extra) {
  const c = Object.assign({ name: "Fixture", from: "2017-01-03", to: "2026-10-01", u12: 1, u12p: 0, nout: 1 }, FX.expect.county, extra || {});
  return { state: "IL", record: "Illinois PTAX-203 (MyDec) transfer declarations", who: "Illinois Department of Revenue", url: "https://data.illinois.gov/d/it54-y4c6",
    kinds: "farm parcels", since_note: "", through: "2026-09-30", windows: FX.expect.windows, min_acres: 20, min_n: 5, counties: { 17999: c } };
}

test("county block: counts, median with count and middle half, outliers labeled neutrally", () => {
  const h = S.countyHTML(fixtureSummary(), "17999", { v: 7074, year: 2022, flag: false });
  assert.match(h, /8 market farm sales were recorded in Fixture County from Oct 2025 to Sep 2026, against 4 in the 12 months before\./);
  assert.match(h, /\$12,500<\/span>|\$12,500\/ac/);
  assert.match(h, /6 sales with known acres; middle half \$11,250 to \$13,750/);
  assert.match(h, /only 4 sales of 20\+ acres with known acres in Oct 2024 to Sep 2025; needs 5/);   // change withheld, reason given
  assert.match(h, /under \$5,875 or over \$16,875/);
  assert.match(h, /well above/);
  assert.match(h, /Alpha township/);
  assert.match(h, /Illinois PTAX-203 \(MyDec\) transfer declarations/);
  assert.match(h, /USDA Census of Agriculture 2022: \$7,074 an acre/);
  assert.match(h, /measure different things/);
  assert.match(h, /Neither is an appraisal/);
  for (const bad of [/overpriced|underpriced|bargain|steal/i, /—/, /SYNTHETIC/, /grantor|grantee/i]) assert.doesNotMatch(h, bad);
});

test("county block: withholds the median under 5 sales, and calls nothing unusual without 5 comparables", () => {
  const c = { n12: 3, n12p: 2, k12: 3, k12p: 2, k24: 4, a24: 4, u12: 0, u12p: 0 };
  const sum = fixtureSummary();
  sum.counties["17999"] = Object.assign({ name: "Thin", from: "2017-01-03", to: "2026-10-01" }, c);
  const h = S.countyHTML(sum, "17999", { v: 5000, year: 2022 });
  assert.match(h, /only 3 sales of 20\+ acres with known acres in 12 months; a median needs 5 or more/);
  assert.match(h, /No sale is called unusual: 4 sales of 20\+ acres with known acres in 24 months, and it takes 5/);
  assert.match(h, /Not shown: 4 market sales with known acres in 24 months/);
  assert.doesNotMatch(h, /well above|well below|Median price, sales of 20\+ acres, Oct/);
  assert.doesNotMatch(h, /Census of Agriculture/);   // no median, nothing to set beside the census
  // a change withheld for unknown acres says why
  const s2 = fixtureSummary({ medp: { n: 9, med: 9000, q1: 8000, q3: 10000 }, why_chg: "acres unknown on 10 of 89 market sales in the last 12 months and 45 of 91 in the 12 before" });
  assert.match(S.countyHTML(s2, "17999", null), /45 of 91 in the 12 before, so the two years do not compare/);
  const s3 = fixtureSummary({ medp: { n: 9, med: 10000, q1: 8000, q3: 11000 }, chg: 25 });
  assert.match(S.countyHTML(s3, "17999", null), /\+25%.*median \$10,000\/ac on 9 sales/s);
});

test("sheet and state blocks", () => {
  const fct = (l, r, s) => `<div class="f">${l}|${r}|${s || ""}</div>`, fw = (l, r) => `<div class="f w">${l}|${r}</div>`;
  const h = S.sheetHTML(fixtureSummary(), "17999", fct, fw);
  assert.match(h, /<h2>Recorded farm sales<\/h2>/);
  assert.match(h, /Median, 20\+ acre sales\|\$12,500\/ac\|6 sales; middle half \$11,250 to \$13,750/);
  assert.match(h, /Largest sale by acres, 24 months\|400 ac\|Oct 2024, \$3,200,000, \$8,000\/ac, Beta township/);
  assert.match(h, /Unusual \$\/acre, 24 months\|1 of 10/);
  assert.match(h, /Farthest out\|\$[\d,]+\/ac\|[A-Z][a-z]{2} \d{4}, [\d.,]+ ac, \$[\d,]+, .*well (above|below) the middle range/);
  assert.match(h, /related-party sales, quit claims, gifts, sheriff, judicial, court and partition deeds are left out/);
  assert.match(h, /sales dated through Sep 30, 2026/);
  assert.match(h, /No names printed/);
  assert.equal(S.sheetHTML(fixtureSummary(), "00000", fct, fw), "");
  const st = S.stateHTML(fixtureSummary(), { 17999: "/farmland-atlas/illinois/fixture-county" });
  assert.match(st, /<a href="\/farmland-atlas\/illinois\/fixture-county">Fixture<\/a><\/td><td>\$12,500<\/td>/);
  assert.match(st, /not the USDA survey or census estimates/);
});

const STATES = ["il", "wi"].filter((s) => existsSync(join(ROOT, "data/land", s, "summary.json")));

test("committed summaries: current rules, no names, small", () => {
  for (const s of STATES) {
    const txt = read(`data/land/${s}/summary.json`);
    assert.ok(Buffer.byteLength(txt) < 150 * 1024, `${s} summary ${Buffer.byteLength(txt)} bytes`);
    const sum = JSON.parse(txt);
    assert.equal(sum.min_n, 5); assert.equal(sum.min_acres, 20);
    assert.doesNotMatch(txt, /grantor|grantee|"legal"|"pid"|"doc"/);
    for (const [f, c] of Object.entries(sum.counties)) {
      if (c.med) { assert.ok(c.med.n >= 5 && c.med.q1 <= c.med.med && c.med.med <= c.med.q3, f); assert.equal(c.med.n, c.k12, f); }
      else assert.ok((c.k12 || 0) < 5, f + " withheld a median it had the sales for");
      if (c.chg != null) assert.ok(c.med && c.medp && c.medp.n >= 5, f);
      if (c.out) {
        assert.ok(c.r24 && c.r24.n >= 5, f + " outliers without 5 comparables");
        for (const o of c.out) {
          assert.equal(o.length, 6);
          assert.ok(o[5] > 0 ? o[3] > c.r24.hi - 0.5 : o[3] < c.r24.lo + 0.5, `${f} ${o} is inside the range`);
          assert.ok(o[1] >= 20, f);
        }
      }
      if (c.large) { assert.ok(c.a24 >= 5, f); assert.ok(c.large.every((r) => r.length === 5)); }
      for (const r of [...(c.large || []), ...(c.out || [])]) assert.ok(r[0] <= sum.through, `${f} sale dated ${r[0]} after ${sum.through}`);
    }
  }
});

test("committed summaries carry no buyer or seller name from the county files (sample)", () => {
  for (const s of STATES) {
    const txt = read(`data/land/${s}/summary.json`);
    const files = readdirSync(join(ROOT, "data/land", s)).filter((n) => /^\d{5}\.json$/.test(n));
    const pick = files.filter((n, i) => i % 6 === 0 || n === "17113.json" || n === "55025.json");
    for (const n of pick) {
      const f = JSON.parse(read(`data/land/${s}/${n}`));
      const ix = ["grantor", "grantee", "legal"].map((c) => f.cols.indexOf(c)).filter((i) => i >= 0);
      for (const r of f.rows) for (const i of ix) {
        const v = r[i];
        if (typeof v === "string" && v.trim().length >= 6) assert.ok(!txt.includes(JSON.stringify(v.trim()).slice(1, -1)), `${s}/${n}: a source name or legal is in the summary`);
      }
    }
  }
});

test("pages: IL and WI county and state pages carry the block; other states do not; the sheet and workflow are wired", () => {
  const v = /atlas-sales\.js\?v=([0-9a-f]{8})/;
  const mc = read("farmland-atlas/illinois/mclean-county.html");
  assert.match(mc, /data-atlas-sales="county" data-st="IL" data-fips="17113"/);
  const dn = read("farmland-atlas/wisconsin/dane-county.html");
  assert.match(dn, /data-atlas-sales="county" data-st="WI" data-fips="55025"/);
  assert.match(read("farmland-atlas/illinois/index.html"), /data-atlas-sales="state" data-st="IL"/);
  assert.doesNotMatch(read("farmland-atlas/iowa/story-county.html"), /atlas-sales/);
  assert.doesNotMatch(read("farmland-atlas/iowa/index.html"), /atlas-sales/);
  const sh = read("farmland-atlas/sheet.html");
  assert.match(sh, /AtlasSales\.sheetHTML\(SALES,F,fct,fw\)/);
  // every page asks for the script that is on disk now
  const hash = createHash("sha1").update(readFileSync(join(ROOT, "components/atlas-sales.js"))).digest("hex").slice(0, 8);
  for (const t of [mc, dn, sh, read("farmland-atlas/wisconsin/index.html")]) assert.equal(v.exec(t)[1], hash);
  // sizes: under the 150 KB cap for a generated page
  for (const st of ["illinois", "wisconsin"]) for (const n of readdirSync(join(ROOT, "farmland-atlas", st))) {
    const b = readFileSync(join(ROOT, "farmland-atlas", st, n)).length;
    assert.ok(b < 150 * 1024, `${st}/${n} is ${b} bytes`);
  }
  const wf = read(".github/workflows/land-data.yml");
  assert.match(wf, /build_land_summary\.py --selftest/);
  const i = wf.indexOf("python scripts/build_land_summary.py\n"), w = wf.indexOf("Wisconsin transfer returns (browser)"), c = wf.indexOf("Commit if changed");
  assert.ok(i > w && i < c, "summary build runs after the transfer fetch and before the commit");
});

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) || !STATES.length ? "Playwright, Chromium or the summaries not found here" : false;

test("in Chromium: the McLean and Dane blocks draw at 390 and 1280 with no sideways scroll", { skip }, async () => {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const w of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: 900 } });
      const pg = await ctx.newPage();
      const errors = [];
      pg.on("pageerror", (e) => errors.push(String(e)));
      await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
      for (const u of ["/farmland-atlas/illinois/mclean-county", "/farmland-atlas/wisconsin/dane-county"]) {
        await pg.goto(`http://127.0.0.1:${port}${u}`);
        await pg.locator("section.as").scrollIntoViewIfNeeded();
        await pg.waitForSelector("section.as[data-ready]", { timeout: 30000 });
        const t = await pg.textContent("section.as");
        assert.match(t, /market farm sales? (was|were) recorded/);
        assert.match(t, /Median price, sales of 20\+ acres/);
        assert.doesNotMatch(t, /—/);
        const [sw, iw] = await pg.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
        assert.ok(sw <= iw, `${u} at ${w}: page is ${sw}px wide in a ${iw}px window`);
      }
      await pg.goto(`http://127.0.0.1:${port}/farmland-atlas/illinois/`);
      await pg.click(".as-go");
      await pg.waitForSelector("[data-atlas-sales=state] table");
      const [sw, iw] = await pg.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      assert.ok(sw <= iw, `IL state page at ${w}: ${sw}px in ${iw}px`);
      assert.match(await pg.textContent("[data-atlas-sales=state]"), /McLean/);
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
