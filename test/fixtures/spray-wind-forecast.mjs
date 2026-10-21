/* A made-up Open-Meteo forecast for one Iowa field, for the /spray wind tests.
 * Hour-of-day pattern, the same every day:
 *   midnight to 7 AM   calm (3 mph at 10 m, about 2 at the boom), clear sky   -> inversion risk
 *   7 to 11 AM         8 mph, gusts 12, 55 F, 60% humidity                    -> good
 *   11 AM              16 mph (about 12 at the boom), gusts 20                -> fair, breezy
 *   noon to 6 PM       22 mph (about 16 at the boom), gusts 30                -> too windy
 *   6 PM               10 mph                                                 -> good
 *   7 PM to midnight   calm, clear                                            -> inversion risk
 * Day 2 (index 1) has rain at 9 AM. Sunrise 7:30, sunset 6:20 PM.
 */
export function pad(n) { return String(n).padStart(2, "0"); }
export function addDays(ymd, k) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + k));
  return t.getUTCFullYear() + "-" + pad(t.getUTCMonth() + 1) + "-" + pad(t.getUTCDate());
}
function hourWx(h, day) {
  let wind = 3, gust = 5, dir = 300, temp = 50, rh = 85, cloud = 5, code = 0, precip = 0, dewGap = 6;
  if (h <= 6) { temp = 45; }
  else if (h <= 10) { wind = 8; gust = 12; temp = 55 + (h - 7); rh = 60; cloud = 20; dewGap = 14; }
  else if (h === 11) { wind = 16; gust = 20; temp = 62; rh = 55; cloud = 20; dewGap = 15; }
  else if (h <= 17) { wind = 22; gust = 30; dir = 315; temp = 64; rh = 50; cloud = 25; dewGap = 16; }
  else if (h === 18) { wind = 10; gust = 14; temp = 60; rh = 60; cloud = 20; dewGap = 14; }
  if (day === 1 && h === 9) { precip = 0.05; code = 61; cloud = 90; }
  return { wind, gust, dir, temp, rh, cloud, code, precip, dew: temp - dewGap, isDay: h >= 8 && h <= 18 ? 1 : 0 };
}
/* The field answer: `days` days from local midnight of `ymd`. */
export function fieldForecast(ymd, days = 4, opts = {}) {
  const H = { time: [], temperature_2m: [], relative_humidity_2m: [], dew_point_2m: [], precipitation: [], precipitation_probability: [], weather_code: [], cloud_cover: [], wind_speed_10m: [], wind_gusts_10m: [], wind_direction_10m: [], is_day: [] };
  const D = { time: [], sunrise: [], sunset: [], temperature_2m_max: [] };
  for (let d = 0; d < days; d++) {
    const ds = addDays(ymd, d);
    D.time.push(ds); D.sunrise.push(ds + "T07:30"); D.sunset.push(ds + "T18:20"); D.temperature_2m_max.push(opts.hi ?? 66);
    for (let h = 0; h < 24; h++) {
      const w = hourWx(h, d);
      H.time.push(ds + "T" + pad(h) + ":00");
      H.temperature_2m.push(w.temp); H.relative_humidity_2m.push(w.rh); H.dew_point_2m.push(w.dew);
      H.precipitation.push(w.precip); H.precipitation_probability.push(null); H.weather_code.push(w.code);
      H.cloud_cover.push(w.cloud); H.wind_speed_10m.push(w.wind); H.wind_gusts_10m.push(w.gust);
      H.wind_direction_10m.push(w.dir); H.is_day.push(w.isDay);
    }
  }
  return { latitude: 42.03, longitude: -93.62, utc_offset_seconds: -18000, timezone: "America/Chicago", hourly: H, daily: D };
}
/* The grid answer: one entry per point, wind a little stronger to the west, same pattern. */
export function gridForecast(ymd, nPts = 25, days = 3) {
  const out = [];
  for (let k = 0; k < nPts; k++) {
    const col = k % 5, H = { time: [], wind_speed_10m: [], wind_direction_10m: [], wind_gusts_10m: [] };
    for (let d = 0; d < days; d++) {
      const ds = addDays(ymd, d);
      for (let h = 0; h < 24; h++) {
        const w = hourWx(h, d);
        H.time.push(ds + "T" + pad(h) + ":00");
        H.wind_speed_10m.push(w.wind + (4 - col) * 0.5); H.wind_direction_10m.push(w.dir + (col - 2) * 4); H.wind_gusts_10m.push(w.gust);
      }
    }
    out.push({ utc_offset_seconds: -18000, hourly: H });
  }
  return out;
}
/* The page's own forecast (the cards and the 24-hour strip): the field answer plus `current`. */
export function pageForecast(ymd, nowKey) {
  const f = fieldForecast(ymd, 5);
  const i = Math.max(0, f.hourly.time.indexOf(nowKey));
  f.current = { time: f.hourly.time[i], temperature_2m: f.hourly.temperature_2m[i], relative_humidity_2m: f.hourly.relative_humidity_2m[i], dew_point_2m: f.hourly.dew_point_2m[i], precipitation_probability: 0, weather_code: 0, wind_speed_10m: f.hourly.wind_speed_10m[i], wind_gusts_10m: f.hourly.wind_gusts_10m[i], wind_direction_10m: f.hourly.wind_direction_10m[i], cloud_cover: f.hourly.cloud_cover[i] };
  f.daily.weather_code = f.daily.time.map(() => 0);
  f.daily.wind_speed_10m_max = f.daily.time.map(() => 22);
  f.daily.wind_gusts_10m_max = f.daily.time.map(() => 30);
  f.daily.precipitation_probability_max = f.daily.time.map(() => 10);
  return f;
}
