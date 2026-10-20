/* /spray: wind at your field and the best spray windows (components/spray-windows.js).
 *
 * The hours are rated with the spray-rules block in spray.html, the same copy
 * the browser runs, handed to the windows code the way the page hands it
 * (window.AgSprayRules). Forecasts are made up (test/fixtures/spray-wind-forecast.mjs).
 *
 *   node --test test/spray-wind.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { fieldForecast, gridForecast } from "./fixtures/spray-wind-forecast.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "spray.html", "utf8");
const SRC = readFileSync(ROOT + "components/spray-windows.js", "utf8");
const UI = readFileSync(ROOT + "components/spray-wind.js", "utf8");
const W = createRequire(import.meta.url)(ROOT + "components/spray-windows.js");
const NAMES = ["PRODUCTS", "windRatingG", "gustyFlag", "boomWind", "tempRatingP", "humidRating", "inversionRisk", "dewRisk", "deltaTC", "deltaTRating", "overallRating", "dicambaStatus", "applyDicamba"];

function rules() {
  const m = HTML.match(/\/\* spray-rules:start \*\/([\s\S]*?)\/\* spray-rules:end \*\//);
  assert.ok(m, "spray.html has a spray-rules block");
  const ctx = { Date, document: { getElementById: () => null } };
  vm.runInNewContext(m[1] + "\nthis.R={" + NAMES.join(",") + "};", ctx);
  return ctx.R;
}
const R = rules();
const START = "2026-10-20T00:00"; // a Tuesday
const rate = (pk = "general", extra = {}) => W.rateHours(R, fieldForecast("2026-10-20"), { P: R.PRODUCTS[pk], pkey: pk, startKey: START, ...extra });
const texts = (hours, n) => W.summary(hours, { rainfree: n ?? 2 }).map((l) => l.text);

test("the page hands the wind view the same rules the hourly strip uses", () => {
  const m = HTML.match(/window\.AgSprayRules=\{(.+)\};\n/);
  assert.ok(m, "spray.html sets window.AgSprayRules");
  for (const n of NAMES) assert.match(m[1], new RegExp("\\b" + n + ":" + n + "\\b"), n);
  for (const n of ["currentProduct", "currentState", "productKey"]) assert.match(m[1], new RegExp("\\b" + n + ":"), n);
});

test("window math: good runs, too windy, inversion risk and rain, in plain words", () => {
  const hrs = rate();
  assert.equal(hrs.length, 48);
  const t = texts(hrs);
  assert.deepEqual(t.slice(0, 3), ["Good: Tue 7 to 11 AM.", "Good: Tue 6 to 7 PM.", "Good: Wed 10 to 11 AM."]);
  assert.ok(t.includes("Too windy Tue noon to 6 PM, Wed noon to 6 PM (about 16 mph at the boom, gusts 30 mph)."), t.join(" | "));
  assert.ok(t.includes("Inversion risk Tue midnight to 7 AM, Tue 7 PM to Wed 7 AM, Wed 7 PM to midnight."), t.join(" | "));
  assert.ok(t.includes("Rain Wed 9 to 10 AM."), t.join(" | "));
  assert.ok(t.includes("Rain within 2 hours after Wed 7 to 9 AM."), t.join(" | "));
  // 22 mph at 10 m is about 16.5 at the boom: past the 15 mph max, a no
  const noon = hrs.find((h) => h.t === "2026-10-20T12:00");
  assert.equal(noon.r, "no"); assert.equal(noon.why[0], "windy");
  // 16 mph at 10 m is about 12 at the boom: in the 10 to 15 band, fair
  assert.equal(hrs.find((h) => h.t === "2026-10-20T11:00").r, "fair");
});

test("rain-free hours change the windows: 1 hour frees Wed 7 AM, 4 hours rules out Wed 5 AM", () => {
  const one = rate("general", { rainfree: 1 });
  assert.equal(one.find((h) => h.t === "2026-10-21T07:00").r, "good");
  assert.equal(one.find((h) => h.t === "2026-10-21T08:00").why[0], "rainsoon");
  const four = rate("general", { rainfree: 4 });
  assert.ok(four.find((h) => h.t === "2026-10-21T05:00").why.includes("rainsoon"));
  assert.match(texts(four, 4).join(" "), /Rain within 4 hours after/);
  // the default follows the product's row in the rain-free table
  assert.equal(W.RAINFREE.contact, 4); assert.equal(W.RAINFREE.dicamba, 4); assert.equal(W.RAINFREE.general, 2);
});

test("an hour at the end of the forecast with no rain data after it is fair, never good", () => {
  const f = fieldForecast("2026-10-20", 1); // 24 hours only
  for (let i = 19; i < 24; i++) { f.hourly.wind_speed_10m[i] = 8; f.hourly.wind_gusts_10m[i] = 12; f.hourly.cloud_cover[i] = 80; f.hourly.dew_point_2m[i] = 36; f.hourly.relative_humidity_2m[i] = 60; }
  const hrs = W.rateHours(R, f, { P: R.PRODUCTS.general, pkey: "general", startKey: "2026-10-20T17:00" });
  assert.equal(hrs.find((h) => h.t === "2026-10-20T21:00").r, "good");
  const late = hrs.find((h) => h.t === "2026-10-20T22:00");
  assert.equal(late.r, "fair"); assert.ok(late.why.includes("na"));
});

test("OTT dicamba in October: no hour is good, said once with the label reason", () => {
  const hrs = rate("dicamba");
  assert.ok(hrs.every((h) => h.r !== "good"));
  const t = texts(hrs, 4);
  assert.match(t[0], /^No OTT dicamba hours in the next 48 hours: past June 30/);
  assert.ok(!t.some((x) => /^No dicamba /.test(x)), "no second dicamba line");
});

test("inversion-risk rule: calm at the boom, 2 h before sunset to 1 h after sunrise, clear sky", () => {
  const sun = { sr: 7 * 60 + 30, ss: 18 * 60 + 20 };
  const f = (key, u10, cloud, s = sun, isDay = null) => W.inversionFlag(R, "2026-10-20T" + key, u10, cloud, s, isDay);
  assert.equal(W.INV.calmBoom, 3);
  // 3.5 mph at 10 m is about 2.6 at the boom: calm. 4.1 mph is about 3.07: not calm.
  assert.equal(f("21:00", 3.5, 10), "risk");
  assert.equal(f("21:00", 4.1, 10), null);
  // clear is 30% cloud or less; cloudier calm nights are "calm-night" (possible, not flagged as risk)
  assert.equal(f("21:00", 2, 30), "risk");
  assert.equal(f("21:00", 2, 31), "calm-night");
  assert.equal(f("21:00", 2, null), "calm-night");
  // the evening window opens 2 hours before sunset (6:20 PM): the 4 PM hour ends at 5, inside it; 3 PM is not
  assert.equal(f("16:00", 2, 0), "risk");
  assert.equal(f("15:00", 2, 0), null);
  // the morning window closes 1 hour after sunrise (7:30 AM): 8 AM starts before 8:30, 9 AM does not
  assert.equal(f("08:00", 2, 0), "risk");
  assert.equal(f("09:00", 2, 0), null);
  // midday calm is not an inversion risk by this rule (the wind band still calls it too calm)
  assert.equal(f("13:00", 1, 0), null);
  // no sunrise or sunset: the forecast's is_day stands in
  assert.equal(f("02:00", 1, 0, null, 0), "risk");
  assert.equal(f("13:00", 1, 0, null, 1), null);
  assert.equal(f("02:00", 1, 0, null, null), null);
  assert.equal(f("02:00", null, 0), null);
});

test("the page states the inversion rule as a risk and cites the extension sources it is based on", () => {
  assert.match(UI, /It is a risk read from a forecast, not a measurement/);
  assert.match(UI, /A risk, not a reading/);
  assert.match(SRC, /sprayers101\.com\/spraying-weather/);
  assert.match(SRC, /extension\.sdstate\.edu\/use-sd-spray-tool-inversion-detection/);
  const src = JSON.parse(readFileSync(ROOT + "references/sources.json", "utf8"));
  const ids = new Set(src.sources.map((s) => s.id));
  for (const id of ["ndsu-ae1705-inversions", "open-meteo-terms", "open-meteo-gfs-docs"]) assert.ok(ids.has(id), "source request " + id);
});

test("time words: ranges in the field's clock, noon and midnight by name", () => {
  assert.equal(W.fmtRange("2026-10-20T07:00", "2026-10-20T10:00"), "Tue 7 to 11 AM");
  assert.equal(W.fmtRange("2026-10-20T10:00", "2026-10-20T13:00"), "Tue 10 AM to 2 PM");
  assert.equal(W.fmtRange("2026-10-20T12:00", "2026-10-20T17:00"), "Tue noon to 6 PM");
  assert.equal(W.fmtRange("2026-10-20T10:00", "2026-10-20T11:00"), "Tue 10 AM to noon");
  assert.equal(W.fmtRange("2026-10-20T20:00", "2026-10-21T05:00"), "Tue 8 PM to Wed 6 AM");
  assert.equal(W.fmtRange("2026-10-20T19:00", "2026-10-20T23:00"), "Tue 7 PM to midnight");
  assert.equal(W.fmtRange("2026-10-20T19:00", "2026-10-21T23:00"), "Tue 7 PM to midnight Wed");
  assert.equal(W.fmtRange("2026-10-20T18:00", "2026-10-20T18:00"), "Tue 6 to 7 PM");
});

test("rating starts at the field's current hour, from utc_offset_seconds, not the reader's clock", () => {
  const f = fieldForecast("2026-10-20");
  const realNow = Date.now;
  try {
    Date.now = () => Date.parse("2026-10-20T15:40:00Z"); // 10:40 AM in Iowa (UTC-5)
    assert.equal(W.hourKey(f), "2026-10-20T10:00");
    const hrs = W.rateHours(R, f, { P: R.PRODUCTS.general, pkey: "general" });
    assert.equal(hrs[0].t, "2026-10-20T10:00");
    assert.match(W.summary(hrs)[0].text, /^Good: Tue 10 to 11 AM \(from now\)\.$/);
  } finally { Date.now = realNow; }
});

test("wind grid: 25 points around the field, keyless request, u/v the way the air moves, blended between points", () => {
  const g = W.gridPoints(42.03, -93.62);
  assert.equal(g.pts.length, 25);
  assert.deepEqual(g.pts[12], { lat: 42.03, lon: -93.62 });
  assert.ok(g.north > 42.2 && g.south < 41.9);
  const u = W.gridUrl(g);
  assert.equal(new URL(u).searchParams.get("latitude").split(",").length, 25);
  assert.equal(new URL(u).searchParams.get("models"), "gfs_seamless");
  assert.doesNotMatch(u, /apikey|key=|token/i);
  assert.match(W.fieldUrl(42.03, -93.62), /models=gfs_seamless/);
  // wind from the west moves east: u > 0, v about 0; from the north moves south
  const w = W.uv(10, 270); assert.ok(Math.abs(w.u - 10) < 1e-9 && Math.abs(w.v) < 1e-9);
  const n = W.uv(10, 0); assert.ok(Math.abs(n.v + 10) < 1e-9);
  assert.equal(W.compass(315), "NW");
  const grid = W.parseGrid(gridForecast("2026-10-20"), g, "2026-10-20T06:00");
  assert.equal(grid.times[0], "2026-10-20T06:00");
  assert.equal(grid.times.length, 48);
  // the grid is stronger to the west (col 0) than the east (col 4): halfway between is the mean
  const a = W.sample(grid, 2, 0, 2).s, b = W.sample(grid, 2, 4, 2).s, mid = W.sample(grid, 2, 2, 2).s;
  assert.ok(a > b);
  assert.ok(Math.abs(mid - (a + b) / 2) < 0.2, `${a} ${mid} ${b}`);
  // halfway between 6 AM (3 mph) and 7 AM (8 mph) in time
  const t0 = W.sample(grid, 0, 2, 2).s, t1 = W.sample(grid, 1, 2, 2).s, th = W.sample(grid, 0.5, 2, 2).s;
  assert.ok(th > t0 && th < t1);
  // a short or broken answer is no grid, never a made-up one
  assert.equal(W.parseGrid(gridForecast("2026-10-20", 24), g, START), null);
  assert.equal(W.parseGrid(null, g, START), null);
});

test("wind colours follow the product band at the boom", () => {
  const G = R.PRODUCTS.general, D = R.PRODUCTS.dicamba;
  assert.equal(W.band(R, G, 3.5), "calm");   // about 2.6 at the boom
  assert.equal(W.band(R, G, 8), "band");     // about 6
  assert.equal(W.band(R, G, 16), "high");    // about 12
  assert.equal(W.band(R, G, 22), "over");    // about 16.5
  assert.equal(W.band(R, D, 16), "over");    // dicamba max is 10 at the boom
  assert.equal(W.band(R, G, null), "na");
});

test("share link carries the field and the hour, and nothing else", () => {
  const u = W.shareUrl("https://agsist.com", 42.03456, -93.61999, "2026-10-21T07:00");
  assert.equal(u, "https://agsist.com/spray?f=42.035,-93.62&t=2026-10-21T07#wind");
  assert.deepEqual(W.parseShare(new URL(u).search), { lat: 42.035, lon: -93.62, t: "2026-10-21T07:00" });
  assert.deepEqual(W.parseShare("?f=42.03,-93.62"), { lat: 42.03, lon: -93.62, t: null });
  assert.equal(W.parseShare("?f=420,-93"), null);
  assert.equal(W.parseShare("?f=abc"), null);
  assert.equal(W.parseShare("?f=42.03,-93.62&t=<script>").t, null);
  // the page opens a shared field on load, and does not save it over the reader's own field
  assert.match(HTML, /SPRAY_SHARED=true;loadWeather\(\+sh\[1\],\+sh\[2\],null\)/);
  assert.match(HTML, /if\(!SPRAY_SHARED\)try\{var _o=\{\};/);
});

test("credits: every source named on screen with a link", () => {
  const ids = W.CREDITS.map((c) => c.id);
  for (const id of ["forecast", "map", "boom", "inv", "inv2", "rain"]) assert.ok(ids.includes(id), id);
  const all = W.CREDITS.map((c) => c.t + " " + c.a + " " + c.tail).join(" ");
  for (const s of ["Open-Meteo", "CC BY 4.0", "NOAA HRRR and GFS", "USGS", "FAO-56", "Sprayers101", "SDSU Extension", "Check your product label"]) assert.ok(all.includes(s), s);
  for (const c of W.CREDITS) if (c.a) assert.match(c.u, /^https:\/\//, c.id);
  assert.match(UI, /Forecast \(estimate\): NOAA HRRR and GFS models, blended by Open-Meteo \(model /);
  assert.match(UI, /time not given by the source/);
});

test("degraded sources: each one has a plain line and a retry", () => {
  assert.match(UI, /The forecast for your field is not answering right now \(Open-Meteo/);
  assert.match(UI, /The wind map forecast is not answering right now \(Open-Meteo/);
  assert.match(UI, /The map underneath did not load\. The wind still draws; the dot is your field\./);
  assert.match(UI, /sw-retry-f/); assert.match(UI, /sw-retry-g/);
});

test("new code loads on demand: no script tag for the wind view, Leaflet only from the wind view", () => {
  assert.doesNotMatch(HTML, /<script[^>]+src="\/components\/spray-wind\.js/);
  assert.doesNotMatch(HTML, /leaflet[\w.-]*\.(js|css)/i);
  assert.match(HTML, /s\.src='\/components\/spray-wind\.js\?v=\d+'/);
  assert.match(UI, /\/vendor\/leaflet-1\.9\.4\//);
  assert.match(UI, /spray-windows\.js\?v=' \+ V\.win/);
  assert.match(UI, /prefers-reduced-motion: reduce/);
});

test("new files: no em dashes in what readers see", () => {
  for (const [name, txt] of [["spray-windows.js", SRC], ["spray-wind.js", UI]]) {
    const strs = txt.match(/'[^'\n]*'/g) || [];
    for (const s of strs) assert.doesNotMatch(s, /—/, name + ": " + s.slice(0, 60));
  }
});
