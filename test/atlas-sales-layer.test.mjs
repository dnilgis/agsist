/* Farmland Atlas map: the recorded farmland sales layer (Sig, Nov 5, 2026: every county with recorded sales is
 * shown, no minimum count; the count stands beside every figure and low counts are marked, never hidden).
 *   - data/land/atlas-layer.json agrees with the state summaries it is built from: every county with a market sale
 *     in the window has its count, every priced county its median and the sales behind it
 *   - no names: the file holds numbers, dates and page slugs only
 *   - Florida dates are months
 *   - in Chromium, on a fixture file: covered counties with no sale, uncovered states, a county with sales but no
 *     farm-size price, the thin-read mark, Florida months, the two links, the count toggle
 * Reads live files only for invariants (BUILD-RULES 73): no county's presence or value is pinned.
 *
 *   node --test test/atlas-sales-layer.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const read = (f) => readFileSync(ROOT + f, "utf8");
const LAYER = JSON.parse(read("data/land/atlas-layer.json"));
const SUMS = readdirSync(ROOT + "data/land", { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(ROOT + `data/land/${d.name}/summary.json`))
  .map((d) => JSON.parse(read(`data/land/${d.name}/summary.json`)));
const DAY = /^\d{4}-\d{2}-\d{2}$/;

test("the builder's own checks pass (layer median, the layer file)", () => {
  const out = execFileSync("python3", ["scripts/build_land_summary.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /selftest: ok/);
});

test("every state with a summary is a covered state, and only those", () => {
  assert.ok(SUMS.length >= 1);
  assert.deepEqual(Object.keys(LAYER.states).sort(), SUMS.map((s) => s.state).sort());
  for (const st of Object.keys(LAYER.listed)) assert.ok(!LAYER.states[st], `${st} is both covered and only listed`);
  assert.deepEqual(LAYER.cols, ["med", "n", "set", "d0", "d1", "n12", "page"]);
  assert.equal(LAYER.thin, 5);
});

test("every county with at least 1 market sale has its count, and a median with the sales behind it", () => {
  for (const s of SUMS) {
    const st = LAYER.states[s.state];
    assert.deepEqual(st.cur, s.windows.cur, `${s.state}: the window is the summary's last 12 months`);
    for (const [f, c] of Object.entries(s.counties)) {
      const r = LAYER.counties[f];
      if (!c.n12) { assert.equal(r, undefined, `${f}: no sale in the window, no row (drawn as "no recorded sale")`); continue; }
      assert.ok(r, `${f}: ${c.n12} sales but no row`);
      assert.equal(r[5], c.n12, `${f}: count`);
      if (c.m12) {
        assert.deepEqual([r[0], r[1], r[3], r[4]], [c.m12.med, c.m12.n, c.m12.d[0], c.m12.d[1]], `${f}: median`);
        assert.ok(r[1] >= 1 && r[1] <= c.n12 && [1, 2].includes(r[2]), `${f}: set and n`);
        assert.ok(r[3] <= r[4] && r[3] >= st.cur[0] && r[4] <= st.cur[1], `${f}: sale dates inside the window`);
        assert.ok(r[0] >= 500, `${f}: a median under the $500 floor`);
      } else assert.deepEqual([r[0], r[1], r[2], r[3], r[4]], [null, 0, 0, null, null], `${f}: no farm-size price`);
      // a bare-land median is the summary's own 12-month median wherever that one is published (5 or more sales)
      if (c.med && r[2] === 1) assert.equal(r[0], c.med.med, `${f}: the county pages and the map disagree`);
    }
  }
  for (const f of Object.keys(LAYER.counties)) assert.ok(SUMS.some((s) => s.counties[f]), `${f}: a row with no summary`);
});

test("no names: the file holds numbers, dates and page slugs only", () => {
  const strs = [];
  for (const r of Object.values(LAYER.counties)) for (const v of r) if (typeof v === "string") strs.push(v);
  assert.ok(strs.length > 0);
  for (const v of strs) assert.ok(DAY.test(v) || /^[a-z0-9-]+-county$/.test(v), `unexpected text in the layer: ${v.slice(0, 3)}...`);
  for (const r of Object.values(LAYER.counties)) assert.ok(r.length === 7);
  const t = JSON.stringify(LAYER);
  assert.doesNotMatch(t, /grantor|grantee|buyer|seller|legal|parcel|"pid"/i);
});

test("Florida dates are months", () => {
  const fl = LAYER.states.FL;
  if (!fl) return;      // Florida not in the summaries yet
  assert.equal(fl.dates, "month");
  for (const [f, r] of Object.entries(LAYER.counties)) if (f.startsWith("12") && r[3]) {
    assert.match(r[3], /-01$/); assert.match(r[4], /-01$/);
  }
});

test("the page wires both toggles, the thin mark and the three empty kinds", () => {
  const h = read("farmland-atlas.html");
  assert.match(h, /key:'sales_med',grp:'Recorded sales'/);
  assert.match(h, /key:'sales_n',grp:'Recorded sales',label:'Number of sales'/);
  assert.match(h, /sales:\{url:'\/data\/land\/atlas-layer\.json'/);
  assert.match(h, /'based on '\+scount\(n\)\+': a thin read'/);
  assert.match(h, /no public sale records here yet/);
  assert.match(h, /no recorded sale in the window/);
  assert.match(h, /\['Land & rent',\['Land value','Recorded sales',/);
  const block = h.slice(h.indexOf("// ---------- recorded farmland sales"), h.indexOf("function sCard("));
  assert.ok(block.length > 1000 && !/\u2014/.test(block), "no em dash in the layer's words");
});

// ---- in Chromium, on a fixture layer file
const FIX = {
  cols: ["med", "n", "set", "d0", "d1", "n12", "page"], min_acres: 20, thin: 5,
  states: {
    IL: { through: "2026-10-31", cur: ["2025-11-01", "2026-10-31"], dates: "day", who: "Illinois Department of Revenue", record: "x", slug: "illinois" },
    WI: { through: "2026-09-30", cur: ["2025-10-01", "2026-09-30"], dates: "day", who: "Wisconsin Department of Revenue", record: "x", slug: "wisconsin" },
    FL: { through: "2026-10-31", cur: ["2025-11-01", "2026-10-31"], dates: "month", who: "Florida Department of Revenue", record: "x", slug: "florida" },
  },
  listed: { IN: "indiana", NJ: "new-jersey", VT: "vermont" },
  counties: {
    "17001": [8100, 13, 1, "2025-11-03", "2026-10-20", 50, "adams-county"],
    "17003": [4002, 2, 1, "2026-03-12", "2026-09-24", 8, "alexander-county"],
    "55001": [7000, 3, 2, "2026-01-05", "2026-04-05", 4, "adams-county"],
    "12001": [15818, 2, 1, "2026-02-01", "2026-03-01", 89, "alachua-county"],
    "12003": [null, 0, 0, null, null, 1, "baker-county"],
  },
};

test("in Chromium: fills, the card, the thin mark, Florida months, links and the count toggle", { skip }, async () => {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/data/land/atlas-layer.json") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(FIX)); return; }
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
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
    const pg = await ctx.newPage();
    const errors = [];
    pg.on("pageerror", (e) => errors.push(String(e)));
    // BUILD-RULES 58: nothing leaves the machine
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const open = async (hash) => {
      await pg.goto(`http://127.0.0.1:${port}/farmland-atlas#${hash}`);
      await pg.waitForFunction(() => /Sources:/.test((document.querySelector("#fa-legend2") || {}).textContent || ""), null, { timeout: 60000 });
    };
    await open("17003&l=sales_med");
    const fill = (f) => pg.$eval(`path[data-fips="${f}"]`, (e) => e.getAttribute("fill"));
    assert.doesNotMatch(await fill("17003"), /url|#3b4245/, "a county with 2 sales is colored");
    assert.doesNotMatch(await fill("55001"), /url|#3b4245/, "a county priced from sales with buildings is colored");
    assert.equal(await fill("12003"), "url(#fa-nop)", "sales, none priced as farmland");
    assert.equal(await fill("17005"), "url(#fa-zero)", "covered state, no sale in the window");
    assert.equal(await fill("19169"), "#3b4245", "a state with no sale records is grey");
    assert.equal(await fill("18001"), "#3b4245", "a listed-only state is grey too");
    const leg = await pg.textContent("#fa-legend2");
    assert.match(leg, /no public sale records here yet/);
    assert.match(leg, /no recorded sale in the window/);
    assert.match(leg, /Florida Nov 2025 to Oct 2026 \(sale months\)/);
    assert.match(leg, /Sources: Florida Department of Revenue, Illinois Department of Revenue, Wisconsin Department of Revenue/);
    let rail = await pg.textContent("#fa-rail");
    assert.match(rail, /\$4,002 an acre/);
    assert.match(rail, /Median of 2 sales of bare farm land, 20 acres or more/);
    assert.match(rail, /Sales from Mar 12, 2026 to Sep 24, 2026/);
    assert.match(rail, /Based on 2 sales: a thin read/);
    assert.match(rail, /8 sales recorded in all, Nov 2025 to Oct 2026/);
    const hrefs = await pg.$$eval("#fa-rail a.fa-cc-print", (as) => as.map((a) => a.getAttribute("href")));
    assert.ok(hrefs.includes("/land-sales/illinois/alexander-county"), hrefs.join(" "));
    assert.ok(hrefs.includes("/farmland-atlas/illinois/alexander-county"), hrefs.join(" "));
    // Florida: months, not days
    await open("12001&l=sales_med");
    rail = await pg.textContent("#fa-rail");
    assert.match(rail, /Sales from Feb 2026 to Mar 2026/);
    assert.match(rail, /89 sales recorded in all, Nov 2025 to Oct 2026 \(sale months\)/);
    // buildings or woods: said in the card
    await open("55001&l=sales_med");
    assert.match(await pg.textContent("#fa-rail"), /3 sales of 20 acres or more with buildings or woods/);
    // the count toggle
    await open("12003&l=sales_n");
    rail = await pg.textContent("#fa-rail");
    assert.match(rail, /1 sale\b/);
    assert.doesNotMatch(rail, /1 sales/);
    assert.notEqual(await fill("12003"), "url(#fa-nop)", "on the count toggle every county with a sale is colored");
    await open("19169&l=sales_med");
    assert.match(await pg.textContent("#fa-rail"), /no public sale records here yet/);
    await open("18001&l=sales_med");
    assert.match(await pg.textContent("#fa-rail"), /listed on the land sales pages/);
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
