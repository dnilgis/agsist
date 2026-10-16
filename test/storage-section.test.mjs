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
const HIST = existsSync(ROOT + "data/storage/history.json") ? JSON.parse(read("data/storage/history.json")) : null;
// a frozen copy of the Oct 16, 2026 pull: the hand-checked numbers live here, so
// the next NASS pull changes the live page without breaking these checks
const FIX = JSON.parse(read("test/fixtures/storage/2026-10-16.json"));
const BASIS = read("basis.html");
const SEED = BASIS.match(/<!--SEED:storage-->([\s\S]*?)<!--\/SEED-->/)[1];
const py = (code, input) => execFileSync("python3", ["-c", "import sys,json;sys.path.insert(0,'scripts');import seed_static as s\n" + code],
  { cwd: ROOT, input: JSON.stringify(input), encoding: "utf8" });
const storageHtml = (d, hist = null, basis = {}, today = "2026-10-16") => py(
  "a=json.loads(sys.stdin.read());b={k:(v[0],v[1],s._iso_date(v[2])) for k,v in a['b'].items()};print(s.storage_html(a['d'],a['t'],a['h'],b),end='')",
  { d, h: hist, b: basis, t: today });
const blobOf = (h) => JSON.parse(h.match(/<script type="application\/json" id="st-data">([\s\S]*?)<\/script>/)[1]);
const NAME = { MO: "Missouri", SD: "South Dakota", NE: "Nebraska", OH: "Ohio", IN: "Indiana", IA: "Iowa", IL: "Illinois", MI: "Michigan", MN: "Minnesota", KS: "Kansas", ND: "North Dakota" };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mdy = (iso) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return `${MON[m - 1]} ${d}, ${y}`; };
const live = (HIST && HIST.generated === STORE.generated && HIST.fall_year === STORE.crunch.year) ? HIST : null;
// the Oct 16 fixture, with USDA's Iowa corn basis that week (-43c, 14c under normal)
const FIXB = { Iowa: [-0.43, -0.14, "2026-10-09"] };
const FIXH = storageHtml(FIX.storage, FIX.history, FIXB);

// the hand-worked history of fetch_storage.py's selftest: IL 2000-2011,
// pressure 1.15 + 0.01i, Dec 1 use 0.80, this fall 1.20
const STATS = { n: 12, first: "2000", last: "2011", p_avg: 1.205, p10: 1.161, p90: 1.249, u_avg: 0.8, u10: 0.8, u90: 0.8,
  drop_avg: 0.405, drop10: 0.361, drop90: 0.449, loo_mae: 0.033, loo_max: 0.06, this_p: 1.2, below: 5, if_usual: 0.795, if_slow: 0.839 };

test("the live seed is exactly what the generator prints from today's data files", () => {
  const basis = {};
  const wk = (SEED.match(/week of (\w{3}) (\d+):/) || []);
  const blob = blobOf(SEED);
  for (const v of Object.values(blob.states)) if (v.bd != null) basis[v.n] = [v.bn / 100, v.bd / 100, "2026-10-09"];
  // the week in the blob decides the date passed back in
  if (wk.length) for (const k of Object.keys(basis)) basis[k][2] = `${STORE.crunch.year}-${String(MON.indexOf(wk[1]) + 1).padStart(2, "0")}-${wk[2].padStart(2, "0")}`;
  assert.equal(storageHtml(STORE, HIST, basis, `${STORE.crunch.year}-10-16`), SEED);
  assert.doesNotMatch(SEED, /\u2014|&mdash;/);
});

test("the answer comes first, built from the live data", () => {
  const ans = SEED.indexOf('class="st-ans"'), you = SEED.indexOf('id="st-you"');
  assert.ok(ans === 3 && you > ans, "answer, then the reader's state, open the section");
  assert.ok(you < SEED.indexOf("Basis has to pay for space") && you < SEED.indexOf("<table"));
  const rows = Object.entries(STORE.crunch.states).filter(([, r]) => r.ratio != null).sort((a, b) => b[1].ratio - a[1].ratio);
  const over = rows.filter(([, r]) => r.ratio > 1).length;
  assert.ok(SEED.includes(`<strong>${over} of ${rows.length}</strong> states with full NASS figures have more grain to hold this fall than bins; ${NAME[rows[0][0]]} is most crowded at ${rows[0][1].ratio.toFixed(2)}&times;`));
  const us = STORE.crunch.us;
  if (us) assert.ok(SEED.includes(`grain to hold is <strong>${(100 * us.total / us.cap).toFixed(1)}%</strong> of bin space`));
  else assert.match(SEED, /about 99% of bin space \(farmdoc daily, on NASS&rsquo;s September forecast\)/);
  assert.ok(SEED.includes(`pulled ${mdy(STORE.generated)}`));
});

test("Oct 16 pull, hand-checked: the US line is NASS's own, 99.6%", () => {
  // (4,489,083,000 Sept 1 stocks + 20,886,624,000 crop) / 25,488,800,000 bins = 0.99556
  assert.equal(FIX.storage.crunch.us.total, 4489083000 + 20886624000);
  assert.match(FIXH, /The US as a whole: grain to hold is <strong>99\.6%<\/strong> of bin space \(25,376 million bu, 25,489 of bins; NASS national figures\)/);
  assert.doesNotMatch(FIXH, /farmdoc daily, on NASS/);
  // no national rows (a pull before NASS posts them): farmdoc's figure, named as theirs
  const noUs = JSON.parse(JSON.stringify(FIX.storage)); delete noUs.crunch.us;
  assert.match(storageHtml(noUs), /The US as a whole has room: grain to hold is about 99% of bin space \(farmdoc daily, on NASS&rsquo;s September forecast\)/);
});

test("Oct 16 pull, hand-checked: Iowa's card", () => {
  const you = FIXH.match(/<div class="st-you"[^>]*>([\s\S]*?)<\/div>/)[1];
  assert.match(you, /<b>Iowa: 1\.08&times;<\/b> <span>6th most crowded of 11<\/span>/);
  assert.match(you, /477 million bu in the bins on Sept 1 \+ 3,416 million bu of 2026 crop, against 3,590 million bu of bin space/);
  assert.ok(Math.abs((477 + 3416) / 3590 - 1.084) < 0.001);
  // Iowa bins 3,570 (Dec 2020) -> 3,590 (Dec 2025): +0.56%, printed +0.6%
  assert.match(you, /Bin space: 3,590 million bu on Dec 1, 2025, \+0\.6% from Dec 1, 2020 \(NASS\)/);
  assert.match(you, /Corn basis in USDA&rsquo;s Iowa region, week of Oct 9: −43¢, 14&cent; under its 5-year normal/);
  // past falls, from history.json's Iowa stats: pressure 0.993, Dec 1 0.757,
  // drop 0.236 (24 points; 10th-90th 0.206-0.261), this fall 1.084 above 23 of
  // 26, 1.084 - 0.236 = 0.848 at the usual pace, 1.084 - 0.206 = 0.878 slow
  const s = FIX.history.states.IA.stats;
  assert.equal(Math.round((s.this_p - s.drop_avg) * 1000) / 1000, s.if_usual);
  assert.match(you, /Past falls in Iowa \(2000 to 2025, 26 with full figures\): the September pressure averaged 0\.99&times; and December 1 use 0\.76&times;, so moving and using grain took off 24 points by December \(most years 21 to 26\)\. This fall&rsquo;s 1\.08&times; is above 23 of those 26\. At the usual pace December 1 use would land near 0\.85&times;; at the pace of the slowest tenth of years, 0\.88&times;/);
  assert.doesNotMatch(you, /fills in after our next NASS pull/);
});

test("Oct 16 pull: our 2000-2025 history lands on farmdoc daily's published averages", () => {
  // farmdoc (Oct 7, 2026): Illinois averages 103% in September, 81% on Dec 1,
  // a 22 point drop; Minnesota 19, North Dakota 21, Missouri 38; US 27 points
  const S = FIX.history.states, near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs farmdoc ${b}`);
  near(S.IL.stats.p_avg, 1.03, 0.02, "IL pressure"); near(S.IL.stats.u_avg, 0.81, 0.02, "IL Dec 1 use");
  near(S.IL.stats.drop_avg, 0.22, 0.02, "IL drop"); near(S.MN.stats.drop_avg, 0.19, 0.02, "MN drop");
  near(S.ND.stats.drop_avg, 0.21, 0.02, "ND drop"); near(S.MO.stats.drop_avg, 0.38, 0.02, "MO drop");
  near(FIX.history.us.stats.drop_avg, 0.27, 0.02, "US drop");
  assert.match(FIXH, /in 2000 to 2025 the US took off 26 points of pressure by December 1 on average \(most years 24 to 27\)/);
});

test("the live card shows past falls when history.json is from the same pull, else the empty state", () => {
  const you = SEED.match(/<div class="st-you"[^>]*>([\s\S]*?)<\/div>/)[1];
  const st = SEED.match(/<div class="st-you"[^>]*data-st="(\w\w)"/)[1];
  const h = live && live.states[st] && live.states[st].stats;
  if (h && h.n >= 10) assert.ok(you.includes(`(${h.first} to ${h.last}, ${h.n} with full figures)`) && you.includes(`averaged ${h.p_avg.toFixed(2)}&times;`));
  else assert.match(you, /fills in after our next NASS pull|not enough history to say/);
  // no history file at all: a plain empty state, no invented numbers
  const none = storageHtml(FIX.storage, null, FIXB).match(/<div class="st-you"[^>]*>([\s\S]*?)<\/div>/)[1];
  assert.match(none, /How fast Iowa has cleared the pressure in past falls .* fills in after our next NASS pull/);
  assert.doesNotMatch(none, /Past falls in Iowa \(/);
});

test("floors name the missing figure; the farmdoc order note; the math block", () => {
  assert.match(FIXH, /Mississippi<\/button> <span class="st-note">no Sept 1 stocks figure for corn, soybeans<\/span>/);
  assert.doesNotMatch(SEED, /"st-note">no figure for/);
  assert.match(SEED, /Their article came out before NASS&rsquo;s October crop report and used the September forecast; this table uses the newer figures, so the order of the states can differ/);
  assert.match(SEED, /<details class="st-math"><summary>Show the math and sources<\/summary>/);
  assert.match(SEED, /Reviewed by Sigurd Lindquist, CCA/);
  // capacity trend, from the national sum: 2015 -> 2020 -> 2025 (hand: +1.0%, +4.6%)
  const n = STORE.national.cap, y = STORE.crunch.year;
  const p1 = (100 * (n[y - 1] / n[y - 6] - 1)).toFixed(1), p0 = (100 * (n[y - 6] / n[y - 11] - 1)).toFixed(1);
  assert.ok(SEED.includes(`rose ${p1}% from December ${y - 6} to December ${y - 1}, after ${p0}% in the five years before`));
  assert.match(FIXH, /rose 1\.0% from December 2020 to December 2025, after 4\.6% in the five years before/);
});

test("no em dashes in the page script", () => {
  assert.doesNotMatch(read("components/storage-detail.js").replace(/\/\*[\s\S]*?\*\//g, ""), /\u2014|&mdash;/);
});

test("the section's script loads only when the section is opened", () => {
  assert.doesNotMatch(BASIS, /<script[^>]+src="\/components\/storage-detail\.js/);
  assert.match(BASIS, /s\.src='\/components\/storage-detail\.js\?v=1'/);
  assert.match(BASIS, /d\.addEventListener\('toggle',go\)/);
});

test("the card's two copies print the same thing, state by state", () => {
  const blob = blobOf(FIXH);
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
  const h = storageHtml(FIX.storage, hist);
  assert.doesNotMatch(h, /Past falls in Iowa \(/);
  assert.match(h, /fills in after our next NASS pull/);
  const same = storageHtml(FIX.storage, { ...hist, generated: FIX.storage.generated });
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
    const fake = { generated: STORE.generated, fall_year: 2026, years, states: Object.fromEntries(Object.keys(STORE.crunch.states).map((k) => [k, rec])), us: rec };
    await pg.route("**/*", (r) => {
      const u = r.request().url();
      if (u.endsWith("/data/storage/history.json")) return r.fulfill({ contentType: "application/json", body: JSON.stringify(fake) });
      return u.startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort();
    });
    await pg.goto(`http://127.0.0.1:${port}/basis#storage`);
    await pg.waitForFunction(() => window.StorageDetail && document.querySelector("#st-you .st-more"));
    const sw = await pg.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert.ok(sw[0] <= sw[1], `page scrolls sideways at 390: ${sw}`);
    // the most crowded state in today's data, whichever it is
    const rows = Object.entries(STORE.crunch.states).filter(([, r]) => r.ratio != null).sort((a, b) => b[1].ratio - a[1].ratio);
    const [top, tr] = rows[0];
    await pg.click(`.st-b[data-st="${top}"]`);
    assert.ok((await pg.textContent("#st-you")).includes(`${NAME[top]}: ${tr.ratio.toFixed(2)}× 1st most crowded of ${rows.length}`));
    assert.equal(await pg.getAttribute(`.st-b[data-st="${top}"]`, "aria-pressed"), "true");
    await pg.click("#st-you .st-more");
    assert.equal(await pg.locator("#st-you svg.sc-svg circle.sc-pd").count(), 26);
    const box = await pg.$eval("#st-you svg.sc-svg", (e) => e.getBoundingClientRect().right);
    assert.ok(box <= 390, "chart runs off the phone screen");
    const wi = await pg.$('.st-b[data-st="WI"]');
    if (wi) { await wi.click(); assert.match(await pg.textContent("#st-you"), /Wisconsin: at least \d\.\d\d× a floor: no Sept 1 stocks figure for/); }
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
