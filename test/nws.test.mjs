// components/nws.js: the NWS forecast grid read hour by hour, in the shape the pages read (2026-10-29,
// Open-Meteo removed). The NWS is mocked (test/fixtures/nws-mock.mjs): the sandbox cannot reach it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { nwsGrid, nwsAnswer } from "./fixtures/nws-mock.mjs";
const require = createRequire(import.meta.url);
const N = require("../components/nws.js");

const NOW = Date.parse("2026-10-29T17:20:00Z"); // 12:20 PM CDT
const PT = { office: "ARX", x: 30, y: 60, tz: "America/Chicago", lat: 45.31, lon: -91.65 };

test("hours run from local midnight in the point's own clock, units F, mph, inches", () => {
  const d = N.build(nwsGrid({ now: NOW, tempF: 50, windMph: 10, gustMph: 20, dewF: 40 }), PT, { now: NOW });
  assert.equal(d.timezone, "America/Chicago");
  assert.equal(d.utc_offset_seconds, -5 * 3600);
  assert.equal(d.hourly.time[0], "2026-10-29T00:00");
  assert.equal(d.current.time, "2026-10-29T12:00");
  assert.equal(d.current.temperature_2m, 50);
  assert.equal(d.current.dew_point_2m, 40);
  assert.equal(d.current.wind_speed_10m, 10);
  assert.equal(d.current.wind_gusts_10m, 20);
  assert.equal(d.current.wind_direction_10m, 225);
  // hours before the grid's first step are empty, not filled in
  assert.equal(d.hourly.temperature_2m[0], null);
  assert.equal(d._nws.office, "ARX");
});

test("a 6-hour precipitation amount is shared equally across its hours; the day sums it back", () => {
  const d = N.build(nwsGrid({ now: NOW, qpfIn: (h) => (h === 12 ? 0.3 : 0) }), PT, { now: NOW });
  const i = d.hourly.time.indexOf("2026-10-29T18:00");
  assert.deepEqual(d.hourly.precipitation.slice(i, i + 6), [0.05, 0.05, 0.05, 0.05, 0.05, 0.05]);
  assert.equal(d.hourly.precipitation[i - 1], 0);
  assert.equal(d.daily.precipitation_sum[0], 0.3);
});

test("weather code: precipitation only where the NWS words it likely or more; a chance keeps the sky", () => {
  assert.equal(N.wxCode([{ coverage: "likely", weather: "rain_showers", intensity: "light" }], 90), 80);
  assert.equal(N.wxCode([{ coverage: "chance", weather: "rain_showers", intensity: "light" }], 90), 3);
  assert.equal(N.wxCode([{ coverage: "slight_chance", weather: "thunderstorms" }], 10), 0);
  assert.equal(N.wxCode([{ coverage: "definite", weather: "snow", intensity: "heavy" }], 100), 75);
  assert.equal(N.wxCode([{ coverage: "likely", weather: "rain" }, { coverage: "likely", weather: "thunderstorms" }], 100), 95);
  assert.equal(N.wxCode([{ coverage: "areas", weather: "fog" }], 100), 45);
  assert.equal(N.wxCode([{ coverage: null, weather: null }], 50), 2);
  assert.equal(N.wxCode(null, null), null);
});

test("sunrise and sunset from the sun's position (Boulder, June 21: 5:32 AM and 8:32 PM MDT)", () => {
  const s = N.sunTimes(40.0, -105.0, 2026, 6, 21);
  assert.ok(Math.abs(s.rise - Date.parse("2026-06-21T11:32:00Z")) < 4 * 60e3);
  assert.ok(Math.abs(s.set - Date.parse("2026-06-22T02:32:00Z")) < 4 * 60e3);
  const d = N.build(nwsGrid({ now: NOW }), PT, { now: NOW });
  assert.match(d.daily.sunrise[0], /^2026-10-29T07:\d\d$/);
  assert.match(d.daily.sunset[0], /^2026-10-29T1[78]:\d\d$/);
  const i = d.hourly.time.indexOf("2026-10-29T12:00"), j = d.hourly.time.indexOf("2026-10-29T22:00");
  assert.equal(d.hourly.is_day[i], 1);
  assert.equal(d.hourly.is_day[j], 0);
});

test("daily highs and lows: the hourly extremes when the grid has no max/min element", () => {
  const d = N.build(nwsGrid({ now: NOW, tempF: (h) => 40 + (h % 24) }), PT, { now: NOW });
  assert.ok(d.daily.temperature_2m_max[1] > d.daily.temperature_2m_min[1]);
  assert.equal(d.daily.time.length, 7);
});

test("a gust element with no values leaves gusts empty, never zero", () => {
  const d = N.build(nwsGrid({ now: NOW, noGust: true }), PT, { now: NOW });
  assert.equal(d.current.wind_gusts_10m, null);
  assert.equal(d.daily.wind_gusts_10m_max[0], null);
});

test("metric units on request", () => {
  const d = N.build(nwsGrid({ now: NOW, tempF: 50, windMph: 10 }), PT, { now: NOW, units: "metric" });
  assert.equal(d.current.temperature_2m, 10);
  assert.equal(d.current.wind_speed_10m, 16.1);
});

test("forecast(): one /points read and one grid read per point; a 404 point rejects as outside", async () => {
  N._reset();
  const seen = [];
  const get = async (u) => { seen.push(u); const a = nwsAnswer(u, { now: NOW, outside: (lat) => lat > 49 }); return { ok: a.status === 200, status: a.status, json: async () => a.body }; };
  const d = await N.forecast(45.31, -91.65, { get });
  assert.equal(d._nws.office, "ARX");
  await N.forecast(45.31, -91.65, { get });
  assert.equal(seen.length, 2);
  assert.match(seen[0], /^https:\/\/api\.weather\.gov\/points\/45\.31,-91\.65$/);
  assert.match(seen[1], /^https:\/\/api\.weather\.gov\/gridpoints\/ARX\/30,60$/);
  await assert.rejects(N.forecast(52.1, -106.6, { get }), (e) => e.outside === true);
});

test("forecast(): a down NWS rejects (the page fails soft), after one more try", async () => {
  N._reset();
  let n = 0;
  const get = async () => { n++; return { ok: false, status: 503, json: async () => ({}) }; };
  await assert.rejects(N.forecast(45.31, -91.65, { get }), /NWS 503/);
  assert.equal(n, 2);
});

test("the source line names the office, the grid cell and the issue time", () => {
  const d = N.build(nwsGrid({ now: NOW, updated: "2026-10-29T15:05:00+00:00" }), PT, { now: NOW });
  assert.equal(N.sourceLine(d), "Forecast: National Weather Service (NDFD grid, ARX 30,60), issued Oct 29, 10:05 AM CDT.");
});
