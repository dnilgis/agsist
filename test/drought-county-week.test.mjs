/* /drought-monitor, the 2026-10-16 fixes:
 *   1. The 2024 hole. A refetch starting 1/1/2025 also got the 2024-12-31 map,
 *      counted it as "2024: 1 map" and wrote that over the full year, in every
 *      county. The fetcher's selftest now holds that case, and every "since
 *      2000" total names a year the record is short of instead of skipping it.
 *   2. This week for the county: percent of the county in D0-D4 on the newest
 *      map, against a week and four weeks before, from ONE weekly file
 *      (data/drought/county-week.json) loaded only when the box is used. Until
 *      that file exists the box says so and prints no number.
 *   3. The national map is the dated copy (data/outlooks/usdm_latest.png), not
 *      NDMC's live image; no line sends anyone to a crop insurance agent; the
 *      crop stress table fits a 390 px phone.
 *
 *   node --test test/drought-county-week.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PAGE = readFileSync(ROOT + "drought-monitor.html", "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

// ---------------------------------------------------------------- static

test("fetchers' selftests pass, including the 2024-hole case", () => {
  for (const s of ["fetch_atlas_drought.py", "fetch_drought_county_week.py", "atlas_layers_p1.py"]) {
    const out = execFileSync("python3", [s, "--selftest"], { cwd: ROOT + "scripts", encoding: "utf8" });
    assert.match(out, /selftest ok/, s);
  }
  const src = readFileSync(ROOT + "scripts/fetch_atlas_drought.py", "utf8");
  assert.match(src, /merge_years\(counties\.get\(fips\), results\[fips\], this_year\)/, "the merge goes through the guard");
  assert.doesNotMatch(src, /\.update\(results\[fips\]\)/, "no blind overwrite of a county's years");
});

test("the workflow can refetch whole drought years on dispatch", () => {
  const y = readFileSync(ROOT + ".github/workflows/farmland-atlas.yml", "utf8");
  assert.match(y, /drought_years:/);
  assert.match(y, /fetch_atlas_drought\.py --years "\$IN_DROUGHT_YEARS"/);
  const w = readFileSync(ROOT + ".github/workflows/drought-county-week.yml", "utf8");
  assert.match(w, /fetch_drought_county_week\.py --selftest/);
  assert.match(w, /fetch_drought_county_week\.py --probe/);
  assert.match(w, /cron: '52 13 \* \* 4'/);
});

test("page copy: no em dashes, no agent routing, no 'no delay', local national map", () => {
  assert.doesNotMatch(PAGE, /—/);
  assert.doesNotMatch(PAGE, /insurance agent/i);
  assert.doesNotMatch(PAGE, /no delay/i);
  assert.match(PAGE, /src="\/data\/outlooks\/usdm_latest\.png"/);
  assert.doesNotMatch(PAGE, /current_usdm\.png/, "the national view is never NDMC's undated live image");
  assert.match(PAGE, /national:\s*\{ src: '\/data\/outlooks\/usdm_latest\.png'/);
});

// gaps the record really has today: finished years most counties hold short (<40 maps)
const RAW = JSON.parse(readFileSync(ROOT + "data/atlas/raw/drought.json", "utf8"));
const THIS_YEAR = Number(RAW.fetched.slice(0, 4));
const GAPS = (() => {
  const cs = Object.values(RAW.counties).filter((c) => Object.keys(c).length);
  const out = [];
  for (let y = 2000; y < THIS_YEAR; y++) {
    const short = cs.filter((c) => !c[y] || c[y].maps < 40).length;
    if (short > cs.length / 2) out.push(y);
  }
  return out;
})();

test("a full past year has 52 or 53 maps, or the year is one the pages name", () => {
  const story = RAW.counties["19169"];
  for (let y = 2000; y < THIS_YEAR; y++) {
    const m = story[y] ? story[y].maps : 0;
    if (GAPS.includes(y)) continue;
    assert.ok(m === 52 || m === 53, `Story County ${y}: ${m} maps`);
  }
  // Today's file has the 2024 hole; this test keeps passing after the refetch,
  // when GAPS is empty and every year must be full.
  for (const y of GAPS) assert.ok(!story[y] || story[y].maps < 40, `${y} counted as a gap`);
});

// ---------------------------------------------------------------- browser

// hand-worked fixture: Story County 25.5% D1+ this week, 20% last week, 0 four weeks back
const WEEK = {
  source: "fixture", valid: "2026-10-13", prev: "2026-10-06", prev4: "2026-09-15",
  cols: ["d0", "d1", "d2", "d3", "d4"], counties: 3, dropped_rows: 0,
  zero: ["19001"],
  c: { "19169": [[40, 25.5, 10, 0, 0], [30, 20, 0, 0, 0], [0, 0, 0, 0, 0]],
       "40139": [[100, 100, 80.2, 33.3, 0], null, [100, 90, 50, 0, 0]] },
};

function serve(week) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml" };
  const hits = [];
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/drought-monitor") p = "/drought-monitor.html";
    hits.push(p);
    if (p === "/data/drought/county-week.json") {
      if (week) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(week)); }
      else { res.writeHead(404); res.end(); }
      return;
    }
    if (!extname(p) && existsSync(join(ROOT, p + ".html"))) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  srv.hits = hits;
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, port, width = 1280) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.goto(`http://127.0.0.1:${port}/drought-monitor`);
  await pg.waitForSelector("#dm-county-q");
  return { pg, errors };
}
const txt = (pg, sel) => pg.$eval(sel, (e) => e.innerText.replace(/\s+/g, " ").trim());
async function pick(pg, q, label) {
  await pg.fill("#dm-county-q", q);
  await pg.dispatchEvent("#dm-county-q", "input");
  await pg.click(`#dm-county-list button:has-text("${label}")`);
  await pg.waitForFunction(() => /weekly maps|withheld|did not load/i.test(document.getElementById("dm-county-out").textContent));
}

test("this week for Story County: shares, changes and dates, hand-worked", { skip }, async () => {
  const srv = await serve(WEEK), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, 390);
    await pg.waitForTimeout(500);
    assert.ok(!srv.hits.includes("/data/drought/county-week.json"), "the weekly file waits for the box");
    await pick(pg, "story", "Story County, IA");
    const out = await txt(pg, "#dm-county-out");
    assert.match(out, /Map valid Oct 13, 2026/i);
    // D1-D4 25.5% now; 20 a week before (+5.5); 0 four weeks before (+25.5)
    assert.match(out, /D1–D4: in drought 25\.5% \+5\.5 pts \+25\.5 pts/);
    // D2-D4 10% now, 0 then: +10 both ways; D3 0 -> no change
    assert.match(out, /D2–D4: severe or worse 10% \+10 pts \+10 pts/);
    assert.match(out, /D3–D4: extreme or worse 0% no change no change/);
    // the bar splits the cumulative shares: none 60, D0 14.5, D1 15.5, D2 10
    assert.match(out, /No drought 60% D0 14\.5% D1 15\.5% D2 10%/);
    assert.match(out, /map valid Oct 6, 2026; four weeks before, Sep 15, 2026/);
    // the 2024 hole is named in the since-2000 total while the record is short of it
    const d = JSON.parse(readFileSync(ROOT + "data/atlas/counties/19169.json", "utf8")).drought;
    const miss = [];
    for (let y = d.first_year; y <= d.last_full_year; y++) if (!d.series[y] || d.series[y].maps < 40) miss.push(y);
    if (miss.length) {
      assert.match(out, new RegExp(`${d.first_year}–${d.last_full_year} except ${miss.join(", ")}:`));
      assert.match(out, new RegExp(`${miss.join(", ")} left out`));
    } else assert.doesNotMatch(out, /\d{4}–\d{4} except|left out/);
    assert.deepEqual(GAPS.filter((y) => !miss.includes(y)), [], "every gap in the raw file shows on the page");
    const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 390, `no sideways scroll at 390 (${sw})`);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("a missing week (n/a), a county at zero, a county not in the file", { skip }, async () => {
  const srv = await serve(WEEK), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port);
    await pick(pg, "texas", "Texas County, OK");
    let out = await txt(pg, "#dm-county-out");
    assert.match(out, /D1–D4: in drought 100% n\/a \+10 pts/);
    assert.match(out, /D3–D4: extreme or worse 33\.3% n\/a \+33\.3 pts/);
    await pick(pg, "adair", "Adair County, IA");
    out = await txt(pg, "#dm-county-out");
    assert.match(out, /D0–D4: abnormally dry or worse 0% no change no change/);
    assert.match(out, /No drought 100%/);
    await pick(pg, "story", "Story County, IA");
    await pick(pg, "baldwin", "Baldwin County, AL");
    out = await txt(pg, "#dm-county-out");
    assert.match(out, /has no county figure for this county on the map valid Oct 13, 2026/);
  } finally { await browser.close(); srv.close(); }
});

test("before the first read: a plain line, no numbers for this week", { skip }, async () => {
  const srv = await serve(null), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port);
    await pick(pg, "story", "Story County, IA");
    const out = await txt(pg, "#dm-county-out");
    assert.match(out, /This week’s county numbers load after the first Drought Monitor read/);
    assert.doesNotMatch(out, /pts|Map valid/);
    assert.match(out, /weekly maps/, "the since-2000 record still shows");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("phone: the stress table stacks, nothing cut off; the map is the saved copy", { skip }, async () => {
  const srv = await serve(WEEK), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, 390);
    const r = await pg.$$eval(".dm-stress-table td", (tds) => tds.map((t) => { const b = t.getBoundingClientRect(); return [b.left, b.right]; }));
    assert.ok(r.length === 20);
    for (const [l, rt] of r) assert.ok(l >= 0 && rt <= 390, `cell ${l}-${rt} inside 390`);
    const stake = await pg.$eval(".dm-stress-table td[data-k='At stake']", (t) => getComputedStyle(t, "::before").content);
    assert.match(stake, /At stake/);
    assert.equal(await pg.$eval("#dm-map-img", (i) => i.getAttribute("src")), "/data/outlooks/usdm_latest.png");
    await pg.waitForFunction(() => /valid \d{4}-\d\d-\d\d/.test(document.getElementById("dm-map-note").textContent));
    await pg.click('.dm-tab[data-view="corn-belt"]');
    assert.match(await txt(pg, "#dm-map-note"), /NDMC's live image/);
    await pg.click('.dm-tab[data-view="national"]');
    assert.match(await txt(pg, "#dm-map-note"), /saved copy of the national map, valid/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
