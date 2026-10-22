/* Rain Print, Oct 21, 2026 (Sig, live, dark mode, desktop): Chetek, WI (54728), 2025, Staircase. The subs
 * worker was blocked, so the page drew the Chetek sample; "chetek, wi" typed while the sample was still
 * drawing never drew ("Not drawn yet: chetek, wi, 2025"), and Every year behind your year, checked on the
 * sample, stayed on the gauge 10.6 mi E with 0 full years and said "Pick the nearest station again under
 * Weather station, or turn this off" instead of moving to the nearest station with 30 full years.
 * And Sig: the default station should be the one with the more complete record (rain AND snow) over a
 * slightly closer one with a thin record, never a far one, and the page says which and why.
 *
 * Checks, on the shipped components/rain-print.js:
 *   - the pick ranks the near-complete years by a snowfall record that draws, then unrecorded days (a few
 *     either way count the same), then distance, inside the snow slack only; the words by the station line;
 *   - the long-record pick for every year behind yours says why, and prefers one that draws snow;
 *   - the town said back in its own capitals;
 * In a real browser (skipped without Playwright), from the fixture of the real case:
 *   - Sig's sequence draws the typed town, then moves to the long record with the why on the page;
 *   - the sample with no town typed re-picks its own station for the threads;
 *   - a short station picked by hand says so and offers the way back, which works;
 *   - the worker blocked costs no page error and no red line.
 *
 *   node --test test/rain-print-chetek-oct21.test.mjs
 *   RP_SHOTS=dir node --test test/rain-print-chetek-oct21.test.mjs   (screenshots, 390 and 1280, light and dark)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { PW, CHROME, serve, mocks, acisRows } from "./fixtures/rp-chetek-oct21.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctx.window = ctx;
vm.runInNewContext(readFileSync(ROOT + "components/rain-print.js", "utf8"), ctx);
const RP = ctx.RainPrint;
const plain = (x) => JSON.parse(JSON.stringify(x));
const KM = 1 / 0.621371;

function dailyOf(rows) {
  const days = rows.map((row, i) => {
    const p = RP.parsePcpn(row[1]), sn = RP.parsePcpn(row[3]).v, dt = new Date(row[0] + "T00:00:00");
    return { date: row[0], v: p.v, flag: p.flag, t: +row[2], s: sn, m: dt.getMonth(), d: dt.getDate(), doy: i };
  });
  return { meta: {}, days, d: RP.derive(days), raw: rows };
}
const st = (sid, name, mi, snowOk) => ({ sid, name, km: mi * KM, snowOk, state: "WI", elev: 1050, ll: [-91.65, 45.31 + mi / 69], valid_daterange: [["1990-01-01", "2026-10-18"]] });
function reader(by) {
  const asked = [];
  return { asked, read: (sid, year) => { asked.push(sid); const o = by[sid]; return o ? Promise.resolve(dailyOf(acisRows(year, { upto: "2025-12-31", ...o }))) : Promise.reject(new Error("no answer")); } };
}

// ---------- the pick: completeness, then distance, inside the slack ----------
test("a fuller year a few miles farther wins over a near one with holes, and the page says why", async () => {
  const NEAR = st("US1WIBR0002", "CHETEK 1.9 SSW", 1.9, true), FULL = st("471667 2", "CHETEK", 4, true), FAR = st("470904 2", "BLOOMER", 17, true);
  const R = reader({ [NEAR.sid]: { missing: 8 }, [FULL.sid]: {}, [FAR.sid]: {} });
  const got = await RP.pickStation([NEAR, FULL, FAR], 2025, R.read, { lat: 45.3141 });
  assert.equal(got.picked.d.missing, 0);
  assert.equal(got.chosen.sid, FULL.sid, "8 unrecorded days lose to none, 2.1 mi farther");
  assert.equal(got.why.over.sid, NEAR.sid);
  assert.equal(RP.pickWhy(got.why, 2025), "Picked over a gauge 1.9 mi away because its 2025 is more complete: no days unrecorded here, 8 days there.");
  assert.deepEqual(plain(R.asked), [NEAR.sid, FULL.sid, FAR.sid], "the nearest three, read once each, nothing more");
});

test("a few days either way never cost miles; nor does a fuller year past the slack", async () => {
  assert.equal(RP.missRank(3), 0); assert.equal(RP.missRank(4), 4);
  const NEAR = st("A", "ALPHA", 1.9, true), FULL = st("B", "BRAVO", 4, true);
  const R = reader({ A: { missing: 3 }, B: {} });
  const got = await RP.pickStation([NEAR, FULL], 2025, R.read, { lat: 45.3 });
  assert.equal(got.chosen.sid, "A", "3 unrecorded days count as none: the nearest stays");
  assert.equal(got.why, null, "and nothing is said");
  const PAST = st("C", "CHARLIE", 12.5, true);   // past 1.9 + 10 mi
  const R2 = reader({ A: { missing: 9 }, C: {} });
  const got2 = await RP.pickStation([NEAR, PAST], 2025, R2.read, { lat: 45.3 });
  assert.equal(got2.chosen.sid, "A", "never a far station for a fuller year");
  assert.equal(got2.why, null);
});

test("rain AND snow comes first, then the fuller year: of two snow stations the more complete is taken", async () => {
  const GAUGE = st("US1WIBR0002", "CHETEK 1.9 SSW", 1.9, false), E = st("US1WIRS0008", "CHETEK 10.6 E", 10.6, true), RICE = st("477113 2", "RICE LAKE", 9.2, true);
  // the gauge keeps no snowfall; Rice Lake keeps it but misses 9 days of 2025; the gauge east of town misses none
  const R = reader({ [GAUGE.sid]: { snow: "none" }, [RICE.sid]: { missing: 9 }, [E.sid]: {} });
  const got = await RP.pickStation([GAUGE, RICE, E], 2025, R.read, { lat: 45.3141 });
  assert.equal(got.chosen.sid, E.sid, "both keep snow; 0 unrecorded days beat 9, 1.4 mi farther");
  assert.equal(RP.pickWhy(got.why, 2025), "Picked over a gauge 1.9 mi away because it records snowfall too.");
});

test("every year behind yours: the words by the station line", () => {
  assert.equal(RP.pickWhy({ long: { n: 76, snow: false, over: { sid: "US1WIBR0002", name: "CHETEK 1.9 SSW", km: 1.9 * KM } } }, 2025),
    "Picked for every year behind yours: the nearest station with 30 or more full years and a good 2025 (76 full years here). The nearest station of all is 1.9 mi away.");
  assert.equal(RP.pickWhy({ long: { n: 41, snow: true, over: null } }, 2025),
    "Picked for every year behind yours: the nearest station with 30 or more full years, a snowfall record and a good 2025 (41 full years here).");
  const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
  assert.ok(!/Pick the nearest station again under Weather station/.test(S), "the old dead-end words are gone");
});

test("the town said back in its own capitals", () => {
  assert.equal(RP.placeShown("chetek, wi"), "Chetek, WI");
  assert.equal(RP.placeShown("CHETEK, WI"), "Chetek, WI");
  assert.equal(RP.placeShown("chetek wi"), "Chetek WI");
  assert.equal(RP.placeShown("eau claire,  wisconsin"), "Eau Claire, Wisconsin");
  assert.equal(RP.placeShown("McFarland, WI"), "McFarland, WI", "typed with its own capitals: as typed");
  assert.equal(RP.placeShown("54728"), "54728");
});

// ---------------------------------------------------------------- in a browser
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const SHOTS = process.env.RP_SHOTS || null;

async function withPage(fn, { width = 1280, scheme = "dark", delay = 0 } = {}) {
  const srv = await serve(ROOT), base = "http://127.0.0.1:" + srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const context = await browser.newContext({ viewport: { width, height: width > 500 ? 900 : 844 }, colorScheme: scheme, serviceWorkers: "block" });
    await context.clock.setFixedTime(new Date("2026-10-21T15:00:00Z"));
    const log = await mocks(context, { delay });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, base, log, errors);
  } finally { await browser.close(); srv.close(); }
}
const text = (page, id) => page.$eval("#" + id, (el) => (el.hidden ? "" : el.textContent.trim()));
const drawnFrom = (page, re) => page.waitForFunction((src) => { const s = document.getElementById("rp-source").textContent; return new RegExp(src).test(s) && !document.getElementById("rp-go").disabled && document.querySelector("#rp-art svg"); }, re.source, { timeout: 40000 });
async function shot(page, name, sel) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.$eval(sel, (el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS + "/" + name + ".png" });
}

/* Since 2026-10-22 (Sig: every layer on by default) a new visit starts with every year behind on, so the town typed
   is drawn straight from the nearest long record, which says why; turning the threads off goes back to the gauge. */
test("browser: Sig's sequence: the town typed while the sample draws is drawn, from the nearest long record (threads on by default) saying why; threads off goes back to the gauge", { skip }, async () => {
  for (const [width, scheme] of [[1280, "dark"], [390, "light"]]) await withPage(async (page, base, log, errors) => {
    await page.goto(base + "/rain-print.html");
    await page.waitForTimeout(2500);   // the worker refused /where; the sample is drawing (NOAA slow)
    assert.ok(log.worker.includes("GET /where"), "the page asked the worker for the town");
    await page.fill("#rp-place", "chetek, wi");
    await page.click("#rp-name");      // leaves the town box
    // the reader's own print (the sample is the same town, so wait for the sample line to go)
    await page.waitForFunction(() => document.getElementById("rp-sample-line").hidden && /days recorded/.test(document.getElementById("rp-source").textContent) && !document.getElementById("rp-go").disabled, null, { timeout: 40000 });
    assert.ok(await page.isChecked("#rp-hist"), "every year behind is on for a new visit");
    assert.match(await text(page, "rp-source"), /Bloomer, WI, 17 mi from Chetek \(NOAA co-op station 470904\)\. Picked for every year behind yours: the nearest station with 30 or more full years and a good 2025 \(\d+ full years here\)\. The nearest station of all is 1\.9 mi away\. Change station\./);
    assert.equal(await page.inputValue("#rp-place"), "Chetek, WI", "the box says the town as it is spelled");
    assert.equal(await text(page, "rp-pending"), "", "no Not drawn yet: the town is drawn");
    assert.equal(await page.evaluate(() => !!document.querySelector("#rp-sample-line:not([hidden])")), false, "the print is the reader's, not the sample");
    assert.equal(await text(page, "rp-hist-why"), "", "nothing contradicts the switch");
    assert.equal(await page.inputValue("#rp-station"), "470904 2");
    assert.match(page.url(), /hist=1/);
    assert.ok(await page.$eval("#rp-art svg", (s) => /Bloomer/.test(s.textContent)), "the print names the station");
    // the threads off: the nearest gauge that keeps snowfall again, and it says why
    await page.uncheck("#rp-hist");
    await drawnFrom(page, /Chetek, WI, 11 mi from Chetek \(volunteer gauge US1WIRS0008\)\. Picked over a gauge 1\.9 mi away because it records snowfall too\./);
    assert.equal(await page.inputValue("#rp-station"), "US1WIRS0008 6");
    assert.ok(!/hist=1/.test(page.url()), "the link drops the threads");
    assert.deepEqual(errors, []);
    await shot(page, `hist-after-${width}-${scheme}`, "#rp-hist");
    await shot(page, `source-after-${width}-${scheme}`, "#rp-source");
  }, { width, scheme, delay: 1200 });
});

test("browser: the sample with no town typed re-picks its own station for every year behind, and back without it", { skip }, async () => {
  await withPage(async (page, base, log, errors) => {
    await page.goto(base + "/rain-print.html");
    // every year behind is on for a new visit (2026-10-22), so the sample comes from the nearest long record
    await drawnFrom(page, /Bloomer, WI, 17 mi from Chetek \(NOAA co-op station 470904\)\. Picked for every year behind yours/);
    assert.ok(await page.evaluate(() => !document.getElementById("rp-sample-line").hidden), "the sample is up, with the threads");
    assert.equal(await text(page, "rp-hist-why"), "");
    assert.equal(await text(page, "rp-pending"), "");
    await page.uncheck("#rp-hist");
    await drawnFrom(page, /volunteer gauge US1WIRS0008/);
    assert.ok(await page.evaluate(() => !document.getElementById("rp-sample-line").hidden), "still the sample, now without the threads");
    await page.check("#rp-hist");
    await drawnFrom(page, /Bloomer, WI, 17 mi from Chetek \(NOAA co-op station 470904\)\. Picked for every year behind yours/);
    assert.ok(await page.evaluate(() => !document.getElementById("rp-sample-line").hidden), "and back");
    assert.deepEqual(errors, []);
  }, { width: 390, scheme: "light" });
});

test("browser: a short station picked by hand says so and offers the way back, which works", { skip }, async () => {
  await withPage(async (page, base, log, errors) => {
    await page.goto(base + "/rain-print.html?place=Chetek%2C+WI&year=2025&style=r1&hist=1");
    await drawnFrom(page, /Bloomer, WI, 17 mi from Chetek .*Picked for every year behind yours/);
    await page.evaluate(() => { document.getElementById("rp-more").open = true; });
    await page.selectOption("#rp-station", "US1WIRS0008 6");
    await drawnFrom(page, /volunteer gauge US1WIRS0008\) Change station\./);
    await page.waitForFunction(() => /has 0 full years; it takes 30\./.test(document.getElementById("rp-hist-why").textContent), null, { timeout: 20000 });
    assert.equal(await text(page, "rp-hist-why"), "Chetek, 10.6 mi E has 0 full years; it takes 30. Use the nearest station with 30 full years");
    await shot(page, "hist-short-1280-dark", "#rp-hist");
    await page.click("#rp-hist-long");
    await drawnFrom(page, /Bloomer, WI, 17 mi from Chetek \(NOAA co-op station 470904\)\. Picked for every year behind yours/);
    assert.equal(await text(page, "rp-hist-why"), "");
    assert.ok(await page.isChecked("#rp-hist"));
    assert.deepEqual(errors, []);
  });
});

test("browser: ZIP 54728 with the worker blocked: the town is found, no page error, no red line", { skip }, async () => {
  await withPage(async (page, base, log, errors) => {
    await page.goto(base + "/rain-print.html");
    await page.fill("#rp-place", "54728");
    await page.click("#rp-go");
    // the reader's print, not the Chetek sample the blocked worker left up
    await page.waitForFunction(() => document.getElementById("rp-sample-line").hidden && /from Chetek/.test(document.getElementById("rp-source").textContent) && !document.getElementById("rp-go").disabled, null, { timeout: 40000 });
    assert.equal(await page.inputValue("#rp-place"), "Chetek, WI");
    assert.equal(await page.$eval("#rp-status", (el) => el.classList.contains("rp-bad")), false);
    assert.deepEqual(errors, []);
  }, { width: 390, scheme: "light" });
});
