/* Stand-in answers for the National Weather Service API (components/nws.js, 2026-10-29). The sandbox
 * cannot reach api.weather.gov, so the browser and unit tests answer for it here, in the shapes the NWS
 * documents (/points/<lat>,<lon> and the raw /gridpoints/<office>/<x>,<y> answer, every element on its
 * own time steps in SI units: degC, km_h-1, percent, mm).
 *
 *   NWS_RE                 matches every api.weather.gov URL
 *   nwsPoints(lat, lon, o) the /points answer ({office, x, y, tz} in o, defaults ARX 30,60 America/Chicago)
 *   nwsGrid(o)             a raw grid answer. o: {now (ms), hours (default 168), tempF(h) or tempF,
 *                          dewF, rh, windMph, gustMph, dir, sky, pop, qpfIn (6-hour step totals),
 *                          weather: (h) => [{coverage, weather, intensity}] or null, updated}
 *                          Each may be a number or a function of the hour index from the first step.
 *   nwsAnswer(url, o)      {status, body} for any NWS URL (points, gridpoints, alerts) with o as above;
 *                          o.down: true answers 503 for everything
 *   routeNws(page, o)      a Playwright route for api.weather.gov that answers with nwsAnswer */
export const NWS_RE = /^https:\/\/api\.weather\.gov\//;
const HOUR = 3600e3;
const fToC = (f) => (f - 32) * 5 / 9;
const mphToKmh = (m) => m * 1.609344;
const val = (v, h, d) => (typeof v === "function" ? v(h) : v == null ? d : v);

export function nwsPoints(lat, lon, o = {}) {
  return {
    properties: {
      gridId: o.office || "ARX", gridX: o.x != null ? o.x : 30, gridY: o.y != null ? o.y : 60,
      forecastGridData: `https://api.weather.gov/gridpoints/${o.office || "ARX"}/${o.x != null ? o.x : 30},${o.y != null ? o.y : 60}`,
      timeZone: o.tz || "America/Chicago",
      relativeLocation: { properties: { city: o.city || "Chetek", state: o.state || "WI" } },
    },
  };
}

export function nwsGrid(o = {}) {
  const now = o.now != null ? o.now : Date.now();
  const t0 = Math.floor(now / HOUR) * HOUR - 6 * HOUR; // the grid starts a few hours back, as the NWS does
  const n = o.hours || 168;
  const iso = (ms) => new Date(ms).toISOString().replace(".000Z", "+00:00");
  const hourly = (f, uom) => ({ uom, values: Array.from({ length: n }, (_, h) => ({ validTime: `${iso(t0 + h * HOUR)}/PT1H`, value: f(h) })) });
  const steps = (len, f, uom) => ({ uom, values: Array.from({ length: Math.floor(n / len) }, (_, k) => ({ validTime: `${iso(t0 + k * len * HOUR)}/PT${len}H`, value: f(k * len) })) });
  const tF = (h) => val(o.tempF, h, 60 + 10 * Math.sin((h / 24) * 2 * Math.PI));
  const p = {
    updateTime: o.updated || iso(t0 + 4 * HOUR), gridId: o.office || "ARX", gridX: o.x != null ? o.x : 30, gridY: o.y != null ? o.y : 60,
    temperature: hourly((h) => fToC(tF(h)), "wmoUnit:degC"),
    dewpoint: hourly((h) => fToC(val(o.dewF, h, tF(h) - 12)), "wmoUnit:degC"),
    apparentTemperature: hourly((h) => fToC(val(o.feelsF, h, tF(h))), "wmoUnit:degC"),
    relativeHumidity: hourly((h) => val(o.rh, h, 60), "wmoUnit:percent"),
    windSpeed: hourly((h) => mphToKmh(val(o.windMph, h, 8)), "wmoUnit:km_h-1"),
    windGust: hourly((h) => mphToKmh(val(o.gustMph, h, 12)), "wmoUnit:km_h-1"),
    windDirection: hourly((h) => val(o.dir, h, 225), "wmoUnit:degree_(angle)"),
    skyCover: hourly((h) => val(o.sky, h, 40), "wmoUnit:percent"),
    probabilityOfPrecipitation: hourly((h) => val(o.pop, h, 10), "wmoUnit:percent"),
    quantitativePrecipitation: steps(6, (h) => val(o.qpfIn, h, 0) * 25.4, "wmoUnit:mm"),
    weather: { values: Array.from({ length: n }, (_, h) => ({ validTime: `${iso(t0 + h * HOUR)}/PT1H`, value: (o.weather && o.weather(h)) || [{ coverage: null, weather: null, intensity: null, attributes: [] }] })) },
  };
  if (o.noGust) p.windGust = { uom: "wmoUnit:km_h-1", values: [] };
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [[[-91.68, 45.32], [-91.65, 45.32], [-91.65, 45.30], [-91.68, 45.30], [-91.68, 45.32]]] }, properties: p };
}

export function nwsAnswer(url, o = {}) {
  const u = String(url && url.href ? url.href : url);
  if (o.down) return { status: 503, body: { title: "Service Unavailable" } };
  let m = /\/points\/(-?[\d.]+),(-?[\d.]+)/.exec(u);
  if (m) {
    if (o.outside && o.outside(+m[1], +m[2])) return { status: 404, body: { title: "Data Unavailable For Requested Point" } };
    return { status: 200, body: nwsPoints(+m[1], +m[2], o) };
  }
  m = /\/gridpoints\/([A-Z]{3})\/(\d+),(\d+)(\/[a-z]+)?/.exec(u);
  if (m && !m[4]) return { status: 200, body: nwsGrid({ ...o, office: m[1], x: +m[2], y: +m[3], ...(o.cell ? o.cell(+m[2], +m[3]) : {}) }) };
  if (/\/alerts\/active/.test(u)) return { status: 200, body: { type: "FeatureCollection", features: o.alerts || [] } };
  return { status: 404, body: {} };
}

export async function routeNws(page, o = {}) {
  await page.route(NWS_RE, (route) => {
    const a = nwsAnswer(route.request().url(), o);
    if (o.seen) o.seen.push(route.request().url());
    return route.fulfill({ status: a.status, contentType: "application/geo+json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(a.body) });
  });
}

/* An Open-Meteo-shaped answer, the shape the pages read and the older tests were written in, as the raw
 * NWS grid that components/nws.js turns back into it (to the rounding of the unit changes). So a test that
 * fixed its numbers as {current, hourly, daily} keeps them: nwsFromOM(om, {now, tz}).
 *   hourly fields map hour by hour (their time strings are wall clock in tz); a field with no hourly series
 *   takes the current value for every hour, or the day's value from daily (highs and lows, the day's
 *   precipitation spread over its hours, the day's precipitation chance and weather code on each hour);
 *   current overrides the hour that holds `now`. */
import { createRequire } from "node:module";
const requireN = createRequire(import.meta.url);
const NWSJS = requireN("../../components/nws.js");
const CODE = (c) => {
  if (c == null || c <= 3) return null;
  if (c === 45 || c === 48) return { coverage: "areas", weather: c === 48 ? "freezing_fog" : "fog", intensity: null };
  const t = c >= 95 ? "thunderstorms" : c >= 85 ? "snow_showers" : c >= 80 ? "rain_showers" : c === 77 ? "sleet" : c >= 71 ? "snow" : c >= 66 ? "freezing_rain" : c >= 61 ? "rain" : c >= 56 ? "freezing_drizzle" : "drizzle";
  const i = [51, 61, 71, 80, 85, 56, 66].includes(c) ? "light" : [55, 65, 75, 82, 86, 57, 67].includes(c) ? "heavy" : "moderate";
  return { coverage: "likely", weather: t, intensity: i, attributes: [] };
};
const SKY = (c) => (c == null ? null : c === 0 ? 5 : c === 1 ? 25 : c === 2 ? 50 : 95);
export function nwsFromOM(om, o = {}) {
  const tz = o.tz || om.timezone || "America/Chicago", now = o.now != null ? +new Date(o.now) : Date.now();
  const utcOf = (s) => { const m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d))?/.exec(s); const w = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)); return w - NWSJS.offsetSec(w, tz) * 1000; };
  const localDay = (ms) => NWSJS.localStr(ms, tz).slice(0, 10);
  const H = om.hourly || {}, D = om.daily || {}, C = om.current || {};
  const nowH = Math.floor(now / HOUR) * HOUR;
  const days = Math.max(2, (D.time || []).length, Math.ceil((H.time || []).length / 24));
  const start = utcOf(localDay(now)), hours = [];
  for (let t = start; t < start + days * 24 * HOUR; t += HOUR) hours.push(t);
  // hourly times as wall-clock strings in tz, or as unix seconds (Open-Meteo's timeformat=unixtime)
  const hIdx = {}; (H.time || []).forEach((s, i) => { hIdx[typeof s === "number" ? s * 1000 : utcOf(s)] = i; });
  const dIdx = (t) => (D.time || []).indexOf(localDay(t));
  const iso = (ms) => new Date(ms).toISOString().replace(".000Z", "+00:00");
  function series(hName, cName, dName, conv) {
    return { values: hours.map((t) => {
      let v = null;
      if (H[hName] && hIdx[t] != null) v = H[hName][hIdx[t]];
      else if (dName && D[dName] && dIdx(t) >= 0) v = D[dName][dIdx(t)];
      else if (C[cName] != null) v = C[cName];
      if (t === nowH && C[cName] != null) v = C[cName];
      return { validTime: iso(t) + "/PT1H", value: v == null ? null : conv(v) };
    }) };
  }
  const id = (v) => v, c = (f) => (f - 32) * 5 / 9, k = (m) => m * 1.609344;
  const p = {
    updateTime: o.updated || iso(nowH - 2 * HOUR), gridId: "ARX", gridX: 30, gridY: 60,
    temperature: { uom: "wmoUnit:degC", ...series("temperature_2m", "temperature_2m", null, c) },
    dewpoint: { uom: "wmoUnit:degC", ...series("dew_point_2m", "dew_point_2m", null, c) },
    apparentTemperature: { uom: "wmoUnit:degC", ...series("apparent_temperature", "apparent_temperature", null, c) },
    relativeHumidity: { uom: "wmoUnit:percent", ...series("relative_humidity_2m", "relative_humidity_2m", "relative_humidity_2m_mean", id) },
    windSpeed: { uom: "wmoUnit:km_h-1", ...series("wind_speed_10m", "wind_speed_10m", "wind_speed_10m_max", k) },
    windGust: { uom: "wmoUnit:km_h-1", ...series("wind_gusts_10m", "wind_gusts_10m", "wind_gusts_10m_max", k) },
    windDirection: { uom: "wmoUnit:degree_(angle)", ...series("wind_direction_10m", "wind_direction_10m", "winddirection_10m_dominant", id) },
    probabilityOfPrecipitation: { uom: "wmoUnit:percent", ...series("precipitation_probability", "precipitation_probability", "precipitation_probability_max", id) },
    skyCover: { uom: "wmoUnit:percent", values: [] },
    quantitativePrecipitation: { uom: "wmoUnit:mm", values: [] },
    weather: { values: [] },
    maxTemperature: { uom: "wmoUnit:degC", values: [] }, minTemperature: { uom: "wmoUnit:degC", values: [] },
  };
  hours.forEach((t) => {
    const code = H.weather_code && hIdx[t] != null ? H.weather_code[hIdx[t]] : H.weathercode && hIdx[t] != null ? H.weathercode[hIdx[t]]
      : t === nowH && C.weather_code != null ? C.weather_code : D.weather_code && dIdx(t) >= 0 ? D.weather_code[dIdx(t)] : C.weather_code;
    const cloud = H.cloud_cover && hIdx[t] != null ? H.cloud_cover[hIdx[t]] : t === nowH && C.cloud_cover != null ? C.cloud_cover : SKY(code);
    p.skyCover.values.push({ validTime: iso(t) + "/PT1H", value: cloud == null ? null : cloud });
    const w = CODE(code);
    p.weather.values.push({ validTime: iso(t) + "/PT1H", value: [w || { coverage: null, weather: null, intensity: null, attributes: [] }] });
    let q = null;
    if (H.precipitation && hIdx[t] != null) q = H.precipitation[hIdx[t]];
    else if (D.precipitation_sum && dIdx(t) >= 0) q = D.precipitation_sum[dIdx(t)] / 24;
    p.quantitativePrecipitation.values.push({ validTime: iso(t) + "/PT1H", value: q == null ? null : q * 25.4 });
  });
  (D.time || []).forEach((day, i) => {
    const mid = utcOf(day);
    if (D.temperature_2m_max && D.temperature_2m_max[i] != null) p.maxTemperature.values.push({ validTime: iso(mid + 7 * HOUR) + "/PT13H", value: c(D.temperature_2m_max[i]) });
    if (D.temperature_2m_min && D.temperature_2m_min[i] != null) p.minTemperature.values.push({ validTime: iso(mid - 5 * HOUR) + "/PT14H", value: c(D.temperature_2m_min[i]) });
  });
  return { type: "Feature", properties: p };
}
/* A Playwright route for api.weather.gov answering every point with nwsFromOM(om(url) or om, o). */
export async function routeNwsOM(page, om, o = {}) {
  await page.route(NWS_RE, (route) => {
    const u = route.request().url();
    if (o.seen) o.seen.push(u);
    if (o.down) return route.fulfill({ status: 503, contentType: "application/geo+json", headers: { "access-control-allow-origin": "*" }, body: "{}" });
    const pm = /\/points\/(-?[\d.]+),(-?[\d.]+)/.exec(u);
    const body = pm ? nwsPoints(+pm[1], +pm[2], { tz: o.tz || (om && om.timezone) || "America/Chicago" })
      : /\/gridpoints\//.test(u) ? nwsFromOM(typeof om === "function" ? om(u) : om, o) : /\/alerts\/active/.test(u) ? { type: "FeatureCollection", features: [] } : null;
    return route.fulfill({ status: body ? 200 : 404, contentType: "application/geo+json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body || {}) });
  });
}
