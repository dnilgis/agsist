/* /basis#storage ("Why basis is wide this fall"), the 2026-10-16 build toward 50/50.
 *
 *   - The answer comes first: how many states are over their bins, the most
 *     crowded, and the US as a whole (ours from NASS national rows once
 *     scripts/fetch_storage.py has pulled them; farmdoc's 99% until then).
 *   - The reader's state: ratio, rank, inputs, USDA corn basis vs its 5-year
 *     normal, bin growth since 2020, and its past falls (Sept pressure vs
 *     Dec 1 use) from data/storage/history.json, loaded only when opened.
 *   - Floors say which figure is missing (Sept 1 stocks), not just the crop.
 *   - It says why the order can differ from farmdoc (their September forecast).
 *   - The card text has two copies (seed_static.py storage_card and
 *     components/storage-detail.js card); they must print the same thing.
 *   - History from a different NASS pull than the table is never shown.
 *
 *   node --test test/storage-section.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const read = (f) => readFileSync(ROOT + f, "utf8");
const SD = createRequire(import.meta.url)(ROOT + "components/storage-detail.js");

const STORE = JSON.parse(read("data/storage/storage.json"));
const BASIS = read("basis.html");
const SEED = BASIS.match(/<!--SEED:storage-->([\s\S]*?)<!--\/SEED-->/)[1];
const py = (code, input) => execFileSync("python3", ["-c", "import sys,json;sys.path.insert(0,'scripts');import seed_static as s\n" + code],
  { cwd: ROOT, input: JSON.stringify(input), encoding: "utf8" });
const storageHtml = (d, hist = null, basis = {}) => py(
  "a=json.loads(sys.stdin.read());b={k:(v[0],v[1],s._iso_date(v[2])) for k,v in a['b'].items()};print(s.storage_html(a['d'],'2026-10-16',a['h'],b),end='')",
  { d, h: hist, b: basis });
const blobOf = (h) => JSON.parse(h.match(/<script type="application\/json" id="st-data">([\s\S]*?)<\/script>/)[1]);

// the hand-worked history of fetch_storage.py's selftest: IL 2000-2011,
// pressure 1.15 + 0.01i, Dec 1 use 0.80, this fall 1.20
const STATS = { n: 12, first: "2000", last: "2011", p_avg: 1.205, p10: 1.161, p90: 1.249, u_avg: 0.8, u10: 0.8, u90: 0.8,
  drop_avg: 0.405, drop10: 0.361, drop90: 0.449, loo_mae: 0.033, loo_max: 0.06, this_p: 1.2, below: 5, if_usual: 0.795, if_slow: 0.839 };

test("the answer comes first, before the explainer and the table", () => {
  const ans = SEED.indexOf('class="st-ans"'), you = SEED.indexOf('id="st-you"');
  assert.ok(ans === 3 && you > ans, "answer, then the reader's state, open the section");
  assert.ok(you < SEED.indexOf("Basis has to pay for space") && you < SEED.indexOf("<table"));
  assert.match(SEED, /<strong>8 of 11<\/strong> states with full NASS figures have more grain to hold this fall than bins; Missouri is most crowded at 1\.17&times;/);
  // no national NASS rows in this pull yet: farmdoc's figure, named as theirs
  assert.match(SEED, /The US as a whole has room: grain to hold is about 99% of bin space \(farmdoc daily, on NASS&rsquo;s September forecast\)/);
});

test("the US line is ours once the pull has national rows", () => {
  const d = JSON.parse(JSON.stringify(STORE));
  // hand-worked: 2,000 stocks + 23,000 crop = 25,000 to hold, 25,250 bins -> 0.990
  d.crunch.us = { total: 25000e6, cap: 25250e6, ratio: 0.99, cap_year: "2025" };
  const h = storageHtml(d);
  assert.match(h, /The US as a whole: <strong>0\.99&times;<\/strong> \(25,000 million bu to hold, 25,250 of bins\)/);
  assert.doesNotMatch(h, /farmdoc daily, on NASS/);
});

test("Iowa's card: inputs, rank, USDA basis vs normal, bin growth, hand-checked", () => {
  const you = SEED.match(/<div class="st-you"[^>]*>([\s\S]*?)<\/div>/)[1];
  assert.match(you, /<b>Iowa: 1\.08&times;<\/b> <span>6th most crowded of 11<\/span>/);
  assert.match(you, /477 million bu in the bins on Sept 1 \+ 3,416 million bu of 2026 crop, against 3,590 million bu of bin space/);
  // (477 + 3,416) / 3,590 = 1.084
  assert.ok(Math.abs((477 + 3416) / 3590 - 1.084) < 0.001);
  // Iowa bins 3,570 (Dec 2020) -> 3,590 (Dec 2025): +0.56%, printed +0.6%
  assert.match(you, /Bin space: 3,590 million bu on Dec 1, 2025, \+0\.6% from Dec 1, 2020 \(NASS\)/);
  assert.match(you, /Corn basis in USDA&rsquo;s Iowa region, week of Oct \d+: [−+]\d+¢, \d+&cent; (under|over) its 5-year normal/);
  // no history file in this pull yet: a plain empty state, no invented numbers
  assert.match(you, /How fast Iowa has cleared the pressure in past falls .* fills in after our next NASS pull/);
});

test("floors name the missing figure; the farmdoc order note; the math block", () => {
  assert.match(SEED, /Mississippi<\/button> <span class="st-note">no Sept 1 stocks figure for corn, soybeans<\/span>/);
  assert.doesNotMatch(SEED, /"st-note">no figure for/);
  assert.match(SEED, /Their article came out before NASS&rsquo;s October crop report and used the September forecast; this table uses the newer figures, so the order of the states can differ/);
  assert.match(SEED, /<details class="st-math"><summary>Show the math and sources<\/summary>/);
  assert.match(SEED, /pulled Oct 14, 2026/);
  assert.match(SEED, /Reviewed by Sigurd Lindquist, CCA/);
  // capacity trend, from storage.json's national sum: 2015 -> 2020 -> 2025
  const n = STORE.national.cap, a = n["2015"], b = n["2020"], c = n["2025"];
  const p1 = (100 * (c / b - 1)).toFixed(1), p0 = (100 * (b / a - 1)).toFixed(1);
  assert.equal(p1, "1.0"); assert.equal(p0, "4.6");
  assert.match(SEED, new RegExp(`rose ${p1}% from December 2020 to December 2025, after ${p0}% in the five years before`));
});

test("no em dashes, nothing typed by hand: the seed is what the generator prints", () => {
  assert.doesNotMatch(SEED, /—|&mdash;/);
  assert.doesNotMatch(read("components/storage-detail.js").replace(/\/\*[\s\S]*?\*\//g, ""), /—|&mdash;/);
  const basis = {};
  for (const m of SEED.matchAll(/"n":"([^"]+)"[^}]*?"bn":(-?\d+),"bd":(-?\d+)/g)) basis[m[1]] = [m[2] / 100, m[3] / 100, "2026-10-09"];
  assert.equal(storageHtml(STORE, null, basis), SEED);
});

test("the section's script loads only when the section is opened", () => {
  assert.doesNotMatch(BASIS, /<script[^>]+src="\/components\/storage-detail\.js/);
  assert.match(BASIS, /s\.src='\/components\/storage-detail\.js\?v=1'/);
  assert.match(BASIS, /d\.addEventListener\('toggle',go\)/);
});

test("the card's two copies print the same thing, state by state", () => {
  const blob = blobOf(SEED);
  const meta = { year: blob.year, n: blob.n, wk: blob.wk };
  for (const [hs, have] of [[null, false], [STATS, true], [{ n: 7, withheld: "only 7 falls with both figures (need 10)" }, true]]) {
    const pyOut = JSON.parse(py(
      "a=json.loads(sys.stdin.read());print(json.dumps({k:s.storage_card(k,v,a['h'],a['have'],a['m']) for k,v in a['s'].items()}))",
      { s: blob.states, h: hs, have, m: meta }));
    for (const [st, v] of Object.entries(blob.states)) {
      assert.equal(SD.card(st, v, hs, have, meta), pyOut[st], `${st} differs between the page and the generator`);
    }
  }
});

test("past falls in words, hand-worked from the fetch selftest", () => {
  const t = SD.histText("Illinois", STATS);
  assert.match(t, /\(2000 to 2011, 12 with full figures\)/);
  assert.match(t, /September pressure averaged 1\.21&times; and December 1 use 0\.80&times;, so moving and using grain took off 41 points by December \(most years 36 to 45\)/);
  assert.match(t, /This fall&rsquo;s 1\.20&times; is above 5 of those 12/);
  assert.match(t, /usual pace December 1 use would land near 0\.80&times;; at the pace of the slowest tenth of years, 0\.84&times;/);
  assert.match(t, /missed December by 3 points on average, 6 at worst/);
  assert.match(SD.histText("Illinois", { ...STATS, below: 12 }), /is above all 12\./);
  assert.match(SD.histText("Iowa", { n: 7, withheld: "only 7 falls" }), /not enough history to say/);
  assert.doesNotMatch(SD.histText("Iowa", { n: 7, withheld: "only 7 falls" }), /averaged/);
});

test("history from another NASS pull is not used", () => {
  const hist = { generated: "2026-10-01T00:00:00Z", fall_year: 2026, years: [], states: { IA: { stats: STATS } }, us: { stats: STATS } };
  const h = storageHtml(STORE, hist);
  assert.doesNotMatch(h, /Past falls in Iowa \(/);
  assert.match(h, /fills in after our next NASS pull/);
  const same = storageHtml(STORE, { ...hist, generated: STORE.generated });
  assert.match(same, /Past falls in Iowa \(2000 to 2011/);
  assert.match(same, /the US took off 41 points of pressure by December 1 on average \(most years 36 to 45\)/);
  assert.match(same, /<a href="\/data\/storage\/history\.json">history\.json<\/a>/);
});

test("the chart: one dot per year with a figure, the 1.00 line, this fall as a ring, a table view", () => {
  const years = ["2000", "2001", "2002"];
  const svg = SD.chart("Iowa", { p: [1.0, null, 1.1], u: [0.7, 0.75, null], stats: { this_p: 1.08 } }, years, 2026);
  assert.equal((svg.match(/class="sc-pd"/g) || []).length, 2);
  assert.equal((svg.match(/class="sc-ud"/g) || []).length, 2);
  assert.match(svg, /bins full/);
  assert.match(svg, /class="sc-now"><title>2026 so far: 1\.08× \(latest NASS forecast\)/);
  assert.match(svg, /<summary>Year by year as a table<\/summary>/);
  assert.match(svg, /<tr><td>2001<\/td><td class="num">&ndash;<\/td><td class="num">0\.75<\/td><td class="num">&ndash;<\/td><\/tr>/);
  assert.match(svg, /<tr><td>2000<\/td><td class="num">1\.00<\/td><td class="num">0\.70<\/td><td class="num">30<\/td><\/tr>/);
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("in the browser at 390: no sideways scroll, a tapped state fills the card, past falls open", { skip }, async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const errors = [];
    pg.on("pageerror", (e) => errors.push(String(e)));
    const years = Array.from({ length: 26 }, (_, i) => String(2000 + i));
    const rec = { p: years.map((_, i) => 1 + i / 100), u: years.map((_, i) => 0.75 + i / 200), stats: STATS };
    const fake = { generated: STORE.generated, fall_year: 2026, years, states: { MO: rec, IA: rec }, us: rec };
    await pg.route("**/*", (r) => {
      const u = r.request().url();
      if (u.endsWith("/data/storage/history.json")) return r.fulfill({ contentType: "application/json", body: JSON.stringify(fake) });
      return u.startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort();
    });
    await pg.goto(`http://127.0.0.1:${port}/basis#storage`);
    await pg.waitForFunction(() => window.StorageDetail && document.querySelector("#st-you .st-more"));
    const sw = await pg.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert.ok(sw[0] <= sw[1], `page scrolls sideways at 390: ${sw}`);
    await pg.click('.st-b[data-st="MO"]');
    assert.match(await pg.textContent("#st-you"), /Missouri: 1\.17× 1st most crowded of 11/);
    assert.equal(await pg.getAttribute('.st-b[data-st="MO"]', "aria-pressed"), "true");
    await pg.click("#st-you .st-more");
    assert.equal(await pg.locator("#st-you svg.sc-svg circle.sc-pd").count(), 26);
    const box = await pg.$eval("#st-you svg.sc-svg", (e) => e.getBoundingClientRect().right);
    assert.ok(box <= 390, "chart runs off the phone screen");
    await pg.click('.st-b[data-st="WI"]');
    assert.match(await pg.textContent("#st-you"), /Wisconsin: at least 1\.03× a floor: no Sept 1 stocks figure for wheat/);
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
