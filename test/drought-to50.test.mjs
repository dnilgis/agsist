/* /drought-monitor, the 2026-10-16 "best page for it" pass:
 *   1. A first-screen answer: NDMC's own share of the Lower 48 in drought on the
 *      newest map, with the change from a week, four weeks and a year before
 *      (data/drought/summary.json). Until that file exists the line says so and
 *      prints no number. The state view adds the same line for the state.
 *   2. The county box sits above the map and opens with a one-line answer.
 *   3. Drought streaks (any part of the county, as FSA's LFP reads the map),
 *      stated as counts and never as eligibility.
 *   4. Rain this year for the county, from the county rain file the /rain pages use.
 *   5. ?county=<fips> opens a county, and a pick writes it to the address.
 *   6. NOAA rain outlooks load only when the reader opens that box.
 *
 *   node --test test/drought-to50.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PAGE = readFileSync(ROOT + "drought-monitor.html", "utf8");
const COUNTY_JS = readFileSync(ROOT + "components/drought-county.js", "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

// ---------------------------------------------------------------- static

test("workflow commits the summary file; page order and copy", () => {
  const w = readFileSync(ROOT + ".github/workflows/drought-county-week.yml", "utf8");
  assert.match(w, /FILES="data\/drought\/county-week\.json data\/drought\/summary\.json"/);
  assert.ok(PAGE.indexOf('id="dm-county-q"') < PAGE.indexOf('id="dm-map-img"'), "county box above the map");
  assert.ok(PAGE.indexOf('id="dm-answer"') < PAGE.indexOf('id="dm-county-q"'), "headline first");
  assert.doesNotMatch(PAGE, /—/);
  assert.doesNotMatch(PAGE, /commonly cited/i, "no unsourced 'commonly cited' claims");
  assert.doesNotMatch(PAGE, /can make you eligible/i, "no eligibility promise");
  assert.doesNotMatch(PAGE, /&#39;/, "no entity apostrophes (they print raw in JSON-LD)");
  assert.match(PAGE, /<script src="\/components\/drought-county\.js\?v=\d+" defer><\/script>/, "the county box script loads deferred");
  for (const src of [PAGE, COUNTY_JS]) {
    assert.doesNotMatch(src, /—/);
    assert.doesNotMatch(src, /insurance agent/i);
  }
  assert.match(COUNTY_JS, /not an eligibility answer/);
  assert.match(PAGE, /not an NDMC rating/, "the stress table says whose rule it is");
  const ld = PAGE.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  JSON.parse(ld);
});

// ---------------------------------------------------------------- browser

const WEEK = {
  source: "fixture", valid: "2026-10-13", prev: "2026-10-06", prev4: "2026-09-15", streak_maps: 53,
  cols: ["d0", "d1", "d2", "d3", "d4"], counties: 3, dropped_rows: 0,
  zero: ["19001"],
  c: { "19169": [[40, 25.5, 10, 0, 0], [30, 20, 0, 0, 0], [0, 0, 0, 0, 0]],
       "40139": [[100, 100, 80.2, 33.3, 0], null, [100, 90, 50, 0, 0]] },
  k: { "19169": [3, 1, 0, 0, 1, 0, 0, 0], "40139": [53, 9, 2, 0, 12, 2, 0, 1] },
};
// hand-worked: Lower 48 D1+ 53.7 now, 52.5 a week before (+1.2), 49.6 four weeks before (+4.1), 40.2 a year before
const SUM = {
  source: "fixture", valid: "2026-10-13", dates: ["2026-10-13", "2026-10-06", "2026-09-15", "2025-10-14"],
  conus: [[70, 53.7, 30.1, 10, 2], [69, 52.5, 29, 9, 2], [65, 49.6, 25, 8, 1], [60, 40.2, 20, 5, 1]],
  states: { OK: [[100, 98, 80, 30, 4], [100, 98, 79, 30, 4], [95, 90, 60, 20, 0], [50, 20, 5, 0, 0]] },
};

function serve(files) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".png": "image/png", ".gif": "image/gif", ".svg": "image/svg+xml" };
  const hits = [];
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/drought-monitor") p = "/drought-monitor.html";
    hits.push(p);
    if (p in files) {
      if (files[p]) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(files[p])); }
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
async function open(browser, port, width = 1280, qs = "") {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.goto(`http://127.0.0.1:${port}/drought-monitor${qs}`);
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

test("headline: Lower 48 share and changes, hand-worked; state line in the state view", { skip }, async () => {
  const srv = await serve({ "/data/drought/summary.json": SUM, "/data/drought/county-week.json": WEEK }), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, 390);
    await pg.waitForFunction(() => /Lower 48 is in drought/.test(document.getElementById("dm-answer").textContent));
    const a = await txt(pg, "#dm-answer");
    assert.match(a, /On the map valid Oct 13, 2026, 53\.7% of the Lower 48 is in drought \(D1 or worse\), up 1\.2 points from a week before and up 4\.1 points from four weeks before\./);
    assert.match(a, /30\.1% is in severe drought \(D2\) or worse\./);
    assert.match(a, /In drought 40\.2% a year before \(Oct 14, 2025\)\./);
    assert.match(a, /NDMC/);
    // the headline is on the first phone screen
    const top = await pg.$eval("#dm-answer", (e) => e.getBoundingClientRect().bottom);
    assert.ok(top < 844, `headline bottom ${top}`);
    // state view: OK 98 now, 98 a week before (no change), 90 four weeks before (+8); 80 severe
    await pg.click('.dm-tab[data-view="state"]');
    await pg.click('.dm-state-btn:has-text("OK")');
    await pg.waitForFunction(() => document.getElementById("dm-state-line").textContent.length > 0);
    const sl = await txt(pg, "#dm-state-line");
    assert.match(sl, /OK, map valid Oct 13, 2026: 98% of the state in drought \(D1 or worse\), no change from a week before and up 8 points from four weeks before; 80% severe \(D2\) or worse\./);
    await pg.click('.dm-tab[data-view="national"]');
    assert.equal(await pg.$eval("#dm-state-line", (e) => e.textContent), "");
    const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 390, `no sideways scroll (${sw})`);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("no summary file yet: the headline says so and prints no number", { skip }, async () => {
  const srv = await serve({ "/data/drought/summary.json": null }), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port);
    await pg.waitForTimeout(600);
    const a = await txt(pg, "#dm-answer");
    assert.match(a, /shows here after each Thursday read/);
    assert.doesNotMatch(a, /\d+(\.\d)?%/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("county answer, streaks as counts, rain from the county rain file", { skip }, async () => {
  const srv = await serve({ "/data/drought/summary.json": SUM, "/data/drought/county-week.json": WEEK }), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, 390);
    await pick(pg, "story", "Story County, IA");
    let out = await txt(pg, "#dm-county-out");
    assert.match(out, /25\.5% of the county is in drought \(D1 or worse\); 10% severe \(D2\) or worse\./);
    assert.match(out, /Some of it in drought \(D1 or worse\): 3 weekly maps in a row, through Oct 13, 2026/);
    assert.match(out, /Some of it in severe drought \(D2\) or worse: this week’s map only \(valid Oct 13, 2026\)/);
    assert.match(out, /2026 weekly maps with some of it in D2 or worse: 1; D3 or worse: 0; D4: 0/);
    assert.doesNotMatch(out, /extreme drought \(D3\) or worse:/, "no D3 streak line at zero");
    assert.match(out, /not an eligibility answer/);
    // rain: straight from data/rain/ia.json
    const r = JSON.parse(readFileSync(ROOT + "data/rain/ia.json", "utf8")).counties["19169"];
    await pg.waitForFunction(() => /Since Jan 1/.test(document.getElementById("dm-county-out").textContent));
    out = await txt(pg, "#dm-county-out");
    assert.ok(out.includes(`Since Jan 1: ${r.total.toFixed(2)} in`), "rain total");
    if (r.pct != null) assert.ok(out.includes(`${r.pct}% of usual (usual ${r.usual.toFixed(2)} in)`), "percent of usual");
    const sep = r.months[8];
    assert.ok(out.includes(`September: ${sep[0].toFixed(2)} in, usual ${sep[1].toFixed(2)} in`), "September");
    assert.match(out, new RegExp(r.station.net === "cocorahs" ? "CoCoRaHS volunteer gauge" : "NOAA weather station"));
    // the address now names the county
    assert.match(await pg.evaluate(() => location.search), /county=19169/);

    // Texas County, OK: lower-bound streak, D3 streak, this year's counts
    await pick(pg, "texas", "Texas County, OK");
    out = await txt(pg, "#dm-county-out");
    assert.match(out, /100% of the county is in drought \(D1 or worse\); 80\.2% severe \(D2\) or worse; 33\.3% extreme \(D3\) or worse\./);
    assert.match(out, /Some of it in drought \(D1 or worse\): at least 53 weekly maps in a row, through Oct 13, 2026 \(the file reads 53 weeks back\)/);
    assert.match(out, /Some of it in severe drought \(D2\) or worse: 9 weekly maps in a row/);
    assert.match(out, /Some of it in extreme drought \(D3\) or worse: 2 weekly maps in a row/);
    assert.doesNotMatch(out, /exceptional drought \(D4\):/);
    assert.match(out, /2026 weekly maps with some of it in D2 or worse: 12; D3 or worse: 2; D4: 0/);

    // Adair County, IA: at zero, no streak
    await pick(pg, "adair", "Adair County, IA");
    out = await txt(pg, "#dm-county-out");
    assert.match(out, /No part of the county is dry or in drought on this map\./);
    assert.match(out, /No part of the county is in drought \(D1 or worse\) on the map valid Oct 13, 2026, and no weekly map in 2026 had any of it in severe drought \(D2\) or worse\./);
    const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 390, `no sideways scroll (${sw})`);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("an old weekly file without streaks shows no streak block", { skip }, async () => {
  const old = { ...WEEK }; delete old.k;
  const srv = await serve({ "/data/drought/county-week.json": old }), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port);
    await pick(pg, "story", "Story County, IA");
    const out = await txt(pg, "#dm-county-out");
    assert.match(out, /25\.5% of the county is in drought/);
    assert.doesNotMatch(out, /How long it has run/);
  } finally { await browser.close(); srv.close(); }
});

test("?county= opens that county; outlooks load only when opened", { skip }, async () => {
  const srv = await serve({ "/data/drought/county-week.json": WEEK }), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, 1280, "?county=19169");
    await pg.waitForFunction(() => /weekly maps/.test(document.getElementById("dm-county-out").textContent));
    assert.equal(await pg.$eval("#dm-county-q", (e) => e.value), "Story County, IA");
    assert.ok(!srv.hits.some((h) => /noaa_prcp/.test(h)), "no outlook image before the box is opened");
    await pg.click("#dm-outlook-more summary");
    await pg.waitForFunction(() => document.querySelectorAll("#dm-outlook-more img").length === 2);
    await pg.waitForTimeout(300);
    assert.ok(srv.hits.includes("/data/outlooks/noaa_prcp_30day.gif") && srv.hits.includes("/data/outlooks/noaa_prcp_90day.gif"));
    assert.match(await txt(pg, "#dm-outlook-more"), /Next month.*NOAA CPC/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
