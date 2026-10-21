/* Storm replay in a browser at 390 and 1280 px, with every outside source
 * answered from a made-up storm (test/fixtures/storm-replay/). Checks what a
 * reader sees: the caption from the data, every credit on screen, the share
 * link opening the same frame, sources that are down saying so, reduced
 * motion, and the pause when the tab is hidden.
 * Needs Playwright and Chromium; skips without them.
 *
 *   node --test test/storm-replay-browser.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { serve, mock, shareQuery } from "./fixtures/storm-replay/mock.mjs";
import * as F from "./fixtures/storm-replay/storm.mjs";

const C = createRequire(import.meta.url)("../components/storm-replay-core.js");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const HEAD = "Hail estimated at your field Tue 9 to 11 PM; 1.20 in of rain (estimated); about 34 lightning strikes near your field (estimated).";

async function setup(width, opts = {}, ctxOpts = {}) {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext(Object.assign({ serviceWorkers: "block", viewport: { width, height: 844 }, timezoneId: "America/Chicago" }, ctxOpts));
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  const hits = await mock(pg, port, opts);
  return { srv, port, browser, pg, errors, hits, done: async () => { await browser.close(); srv.close(); } };
}
const state = (pg) => pg.evaluate(() => { const R = window.AgStormReplay && window.AgStormReplay._state(); return R ? { idx: R.idx, playing: R.playing, n: R.times.length, t: R.times[R.idx], layers: R.v.layers } : null; });
const srcText = (pg) => pg.$$eval("#sr-src li", (a) => a.map((li) => li.textContent));

test("390 px: the button opens the replay; caption, tags, credits and sources from the data", { skip, timeout: 120000 }, async () => {
  const s = await setup(390);
  try {
    const { pg } = s;
    await pg.goto(`http://127.0.0.1:${s.port}/rain-radar?lat=${F.FIELD.lat}&lon=${F.FIELD.lon}&label=${encodeURIComponent(F.FIELD.label)}`);
    await pg.waitForSelector("#rr-replay", { state: "visible", timeout: 20000 });
    assert.equal(await pg.evaluate(() => !!window.AgStormReplay), false, "nothing of the replay loads before the tap");
    await pg.click("#rr-replay");
    await pg.waitForSelector(".sr", { timeout: 20000 }).catch(async (e) => {
      throw new Error(e.message + " note=" + (await pg.$eval("#rr-replay-note", (n) => n.textContent)) + " errors=" + s.errors.join(";") + " state=" + JSON.stringify(await pg.evaluate(() => [!!window.AgStormReplay, typeof window.agsistStormReplay, JSON.stringify(document.querySelector(".sr").getBoundingClientRect()), getComputedStyle(document.querySelector(".sr")).display, getComputedStyle(document.querySelector(".sr")).visibility, document.querySelector(".sr").parentNode.tagName])));
    });
    await pg.waitForFunction((h) => document.getElementById("sr-headtext").textContent === h, HEAD, { timeout: 40000 });
    const tags = await pg.$$eval("#sr-lines li", (a) => a.map((li) => [li.dataset.kind, li.querySelector(".sr-tag").textContent]));
    assert.deepEqual(tags, [["hail", "Estimate"], ["reports", "Observed"], ["rain", "Estimate"], ["lightning", "Estimate"]]);
    // every source credited on screen
    const cred = await pg.$eval("#sr-cred", (e) => e.textContent);
    for (const k of ["radar", "lightning", "clouds", "swaths", "reports", "rain", "map"]) {
      assert.ok(cred.includes(C.CREDITS[k].name + ": " + C.CREDITS[k].what), "credit for " + k);
    }
    assert.match(cred, /No key, no signup/);
    const src = await srcText(pg);
    assert.ok(src.some((t) => t === "NOAA satellite: off."), src.join(" | "));
    assert.ok(src.some((t) => /^NWS hail reports: 2 within 10 miles/.test(t)), src.join(" | "));
    assert.ok(src.some((t) => /^Radar rain total: Tue 7 AM to Wed 7 AM\.$/.test(t)), src.join(" | "));
    // a phone screen: no sideways scroll, real tap targets
    const wide = await pg.evaluate(() => [document.querySelector(".sr-panel").scrollWidth, document.querySelector(".sr-panel").clientWidth]);
    assert.ok(wide[0] <= wide[1], "no sideways scroll in the replay: " + wide);
    const small = await pg.$$eval(".sr-ctl .sr-btn, .sr-x", (a) => a.filter((b) => b.getBoundingClientRect().height < 36).length);
    assert.equal(small, 0);
    // the opening plays once from an hour before the hail; a hidden tab pauses it
    let st = await state(pg);
    assert.equal(st.n, 97);
    await pg.waitForFunction(() => window.AgStormReplay._state().playing, null, { timeout: 15000 });
    await pg.evaluate(() => { Object.defineProperty(document, "hidden", { value: true, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
    st = await state(pg);
    assert.equal(st.playing, false, "a hidden tab pauses the replay");
    assert.deepEqual(s.errors, []);
  } finally { await s.done(); }
});

test("1280 px: a shared link opens that exact replay, and Share gives the same link back", { skip, timeout: 120000 }, async () => {
  const s = await setup(1280, {}, { viewport: { width: 1280, height: 860 } });
  try {
    const { pg } = s;
    const q = shareQuery({ f: "202607150315", ly: "rlsp" });
    await pg.goto(`http://127.0.0.1:${s.port}/hail-map${q}`);
    await pg.waitForSelector(".sr", { timeout: 20000 });
    await pg.waitForFunction((h) => document.getElementById("sr-headtext").textContent === h, HEAD, { timeout: 40000 });
    const st = await state(pg);
    assert.equal(st.t, Date.UTC(2026, 6, 15, 3, 15), "the frame in the link");
    assert.equal(st.idx, 61);
    assert.equal(st.playing, false, "a shared frame stays put");
    assert.deepEqual(st.layers, { radar: true, lightning: true, swaths: true, reports: true, clouds: false });
    assert.match(await pg.$eval("#sr-clock", (e) => e.textContent), /^10:15 PMTue, Jul 14 CDT$/);
    assert.equal(await pg.$eval("#sr-range", (e) => e.getAttribute("aria-valuetext")), "Tue, Jul 14, 10:15 PM CDT");
    // the frame's own note: the hail hour at the field
    assert.match(await pg.$eval("#sr-flag", (e) => e.textContent), /Radar hail estimate this hour: up to 1 in at your field/);
    await pg.waitForFunction(() => location.search.includes("sr=1"));
    assert.equal(await pg.evaluate(() => location.search), q, "the address bar holds the same view");
    // step and the link follows
    await pg.click("#sr-fwd");
    await pg.waitForFunction(() => /f=202607150330/.test(location.search), null, { timeout: 5000 });
    await pg.click("[data-layer=clouds]");
    await pg.waitForFunction(() => /ly=rlspc/.test(location.search), null, { timeout: 5000 });
    const back = C.decodeShare(await pg.evaluate(() => location.search), F.NOW + 72 * 3600e3);
    assert.equal(back.frame, Date.UTC(2026, 6, 15, 3, 30));
    assert.equal(back.end, F.END, "three days later the link still opens the same window");
    assert.equal(back.layers.clouds, true);
    // the satellite is down in this test: it says so
    await pg.waitForFunction(() => [...document.querySelectorAll("#sr-src li")].some((li) => li.textContent === "NOAA satellite not answering right now."), null, { timeout: 15000 });
    // Latest goes to the newest frame; closing restores the page
    await pg.click("#sr-latest");
    assert.equal((await state(pg)).t, F.END);
    await pg.click("#sr-x");
    assert.equal(await pg.$(".sr"), null);
    assert.doesNotMatch(await pg.evaluate(() => location.search), /sr=1/);
    assert.deepEqual(s.errors, []);
  } finally { await s.done(); }
});

test("sources that are down say so, and the caption leaves them out", { skip, timeout: 120000 }, async () => {
  const s = await setup(390, { radar: "down", lightning: "stale", reports: "down" });
  try {
    const { pg } = s;
    await pg.goto(`http://127.0.0.1:${s.port}/hail-map${shareQuery({ f: "202607150300" })}`);
    await pg.waitForSelector(".sr", { timeout: 20000 });
    await pg.waitForFunction(() => [...document.querySelectorAll("#sr-src li")].some((li) => li.textContent === "NOAA radar not answering right now."), null, { timeout: 30000 });
    await pg.waitForFunction(() => [...document.querySelectorAll("#sr-src li")].some((li) => li.textContent === "NWS hail reports not answering right now."), null, { timeout: 30000 });
    const src = await srcText(pg);
    assert.ok(src.some((t) => t === "NOAA lightning has not updated since 4 AM."), src.join(" | "));
    assert.match(await pg.$eval("#sr-flag", (e) => e.textContent), /No radar frame for this time/);
    const kinds = await pg.$$eval("#sr-lines li", (a) => a.map((li) => li.dataset.kind));
    assert.ok(!kinds.includes("reports"), "no report line when the reports did not answer");
    assert.match(await pg.$eval("#sr-headtext", (e) => e.textContent), /^Hail estimated at your field Tue 9 to 11 PM; 1\.20 in of rain \(estimated\)/);
    assert.deepEqual(s.errors, []);
  } finally { await s.done(); }
});

test("lightning counts that cannot be read are left out and said so", { skip, timeout: 120000 }, async () => {
  const s = await setup(390, { lightningInfo: "picture" });
  try {
    const { pg } = s;
    await pg.goto(`http://127.0.0.1:${s.port}/hail-map${shareQuery()}`);
    await pg.waitForSelector(".sr", { timeout: 20000 });
    await pg.waitForFunction(() => [...document.querySelectorAll("#sr-src li")].some((li) => /Strike counts could not be read/.test(li.textContent)), null, { timeout: 30000 });
    assert.equal(await pg.$eval("#sr-headtext", (e) => e.textContent), "Hail estimated at your field Tue 9 to 11 PM; 1.20 in of rain (estimated).");
    assert.ok(s.hits.lightningInfo < 10, "it stops asking once the answers are pictures, not numbers");
  } finally { await s.done(); }
});

test("reduced motion: no autoplay, the replay opens on the hail", { skip, timeout: 120000 }, async () => {
  const s = await setup(390, {}, { reducedMotion: "reduce" });
  try {
    const { pg } = s;
    await pg.goto(`http://127.0.0.1:${s.port}/rain-radar?lat=${F.FIELD.lat}&lon=${F.FIELD.lon}`);
    await pg.waitForSelector("#rr-replay", { state: "visible", timeout: 20000 });
    await pg.click("#rr-replay");
    await pg.waitForSelector(".sr", { timeout: 20000 });
    await pg.waitForFunction((h) => document.getElementById("sr-headtext").textContent === h, HEAD, { timeout: 40000 });
    await pg.waitForTimeout(800);
    const st = await state(pg);
    assert.equal(st.playing, false);
    assert.equal(st.t, Date.UTC(2026, 6, 15, 3, 0), "the end of the first hail hour, 10 PM");
    assert.ok(parseFloat(await pg.$eval(".sr-fr", (e) => getComputedStyle(e).transitionDuration)) < 0.01, "no crossfade");
  } finally { await s.done(); }
});
