/* components/nws.js: the National Weather Service forecast grid, read for one point (2026-10-29).
 *
 * It replaced Open-Meteo on every page (Sig, Oct 29: Open-Meteo's terms count an ad-supported site
 * as commercial use). The source is api.weather.gov, public and keyless: /points/<lat>,<lon> names the
 * forecast office and grid cell (2.5 km), then /gridpoints/<office>/<x>,<y> is that cell's NDFD
 * forecast, every element on its own time steps. This file lays those steps out hour by hour and
 * answers in the shape the pages already read (Open-Meteo's), so each page's own math is unchanged:
 *   {timezone, utc_offset_seconds, current: {time, ...}, hourly: {time: [...], <field>: [...]},
 *    daily: {time: [...], <field>: [...]}, _nws: {office, x, y, updated, cell, city, state}}
 * Times are wall-clock strings in the point's own time zone ("YYYY-MM-DDTHH:00"), as before.
 * Units: temperature F, wind mph, precipitation inches (opts.units: 'metric' for C, km/h, mm).
 *
 * What the grid does not carry, said plainly where it is used:
 *   weather_code   made here from the grid's "weather" element and sky cover (see wxCode): a
 *                  precipitation code only where the NWS words it likely or more, else the sky.
 *   precipitation  the grid's amounts cover 6-hour steps; each hour gets an equal share.
 *   is_day, sunrise, sunset   worked out here from the sun's position (NOAA's solar equations).
 *   soil temperature, soil moisture, evapotranspiration, past days: not in the NWS grid at all.
 *
 *   AgNWS.forecast(lat, lon, {get, units, days}) -> Promise of the answer above; rejects (fail soft
 *     in the caller) when the NWS does not answer or the point is outside its grid (Canada, sea).
 *   AgNWS.point(lat, lon) -> Promise {office, x, y, tz, city, state}
 *   AgNWS.gridAt(office, x, y) -> Promise of the raw grid answer
 *   AgNWS.build(rawGrid, pointInfo, {units, days, now}) -> the answer, no network (tests use it)
 *   AgNWS.credit -> the one credit line every page shows with these numbers
 */
(function (root) {
  'use strict';
  var API = 'https://api.weather.gov';
  var HOUR = 3600e3;

  function defaultGet(url) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, 15000) : null;
    return fetch(url, { headers: { Accept: 'application/geo+json' }, signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (t) clearTimeout(t); return r; }, function (e) { if (t) clearTimeout(t); throw e; });
  }
  function r4(x) { return Math.round(x * 1e4) / 1e4; }
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }

  /* ---------- the network, once per page per point and per cell ---------- */
  var mem = {}, TTL = 15 * 60e3; // a page open longer than this reads the grid again (the NWS updates it about hourly)
  function json(url, get, tries) {
    return (get || defaultGet)(url).then(function (r) {
      if (r.status === 404) { var e = new Error('outside the NWS forecast grid'); e.outside = true; throw e; }
      // the NWS answers a brief 500 or 503 now and then; one more try, then give up
      if (!r.ok) { if ((tries || 0) < 1 && r.status >= 500) return json(url, get, 1); throw new Error('NWS ' + r.status); }
      return r.json();
    });
  }
  function once(key, make) {
    var m = mem[key], now = Date.now();
    if (!m || now - m.at > TTL) {
      m = mem[key] = { at: now, p: make().then(null, function (e) { if (mem[key] === m) delete mem[key]; throw e; }) };
    }
    return m.p;
  }
  function point(lat, lon, o) {
    o = o || {};
    var key = 'p' + r4(lat) + ',' + r4(lon);
    return once(key, function () {
      return json(API + '/points/' + r4(lat) + ',' + r4(lon), o.get).then(function (j) {
        var p = j && j.properties;
        if (!p || !p.gridId || p.gridX == null || p.gridY == null) throw new Error('NWS: no forecast cell for this point');
        var rl = p.relativeLocation && p.relativeLocation.properties;
        return { office: p.gridId, x: p.gridX, y: p.gridY, tz: p.timeZone || null, city: rl ? rl.city : null, state: rl ? rl.state : null };
      });
    });
  }
  function gridAt(office, x, y, o) {
    o = o || {};
    return once('g' + office + '/' + x + ',' + y, function () {
      return json(API + '/gridpoints/' + office + '/' + x + ',' + y, o.get).then(function (j) {
        if (!j || !j.properties) throw new Error('NWS: empty forecast grid');
        return j;
      });
    });
  }

  /* ---------- time ---------- */
  // ISO 8601 durations as the grid writes them: PT1H, PT6H, P1D, P1DT12H
  function durMs(s) {
    var m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(String(s || ''));
    if (!m) return HOUR;
    return ((+m[1] || 0) * 24 + (+m[2] || 0)) * HOUR + (+m[3] || 0) * 60e3;
  }
  function span(vt) { // "2026-10-29T04:00:00+00:00/PT3H" -> {a, b} in ms
    var i = String(vt || '').indexOf('/'); if (i < 0) return null;
    var a = Date.parse(vt.slice(0, i)); if (!isFinite(a)) return null;
    return { a: a, b: a + durMs(vt.slice(i + 1)) };
  }
  var fmts = {};
  function localParts(ms, tz) {
    var f = fmts[tz];
    if (!f) {
      try { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
      catch (e) { f = null; }
      fmts[tz] = f;
    }
    if (!f) { var d = new Date(ms); return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }; }
    var o = {};
    f.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, mo: +o.month, d: +o.day, h: (+o.hour) % 24, mi: +o.minute };
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function localStr(ms, tz) { var p = localParts(ms, tz); return p.y + '-' + pad(p.mo) + '-' + pad(p.d) + 'T' + pad(p.h) + ':' + pad(p.mi); }
  function offsetSec(ms, tz) { var p = localParts(ms, tz); return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(ms / 60e3) * 60e3) / 1000); }

  /* ---------- the sun (NOAA solar calculator equations) ---------- */
  function sunTimes(lat, lon, y, mo, d) { // UTC ms of sunrise and sunset for that calendar date at the point
    var rad = Math.PI / 180, n = (Date.UTC(y, mo - 1, d, 12) - Date.UTC(y, 0, 1, 12)) / 864e5;
    var lenY = (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 366 : 365;
    var g = 2 * Math.PI / lenY * n;
    var eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    var dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    var c = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(dec)) - Math.tan(lat * rad) * Math.tan(dec);
    if (c > 1 || c < -1) return null; // polar day or night
    var ha = Math.acos(c) / rad, noon = 720 - 4 * lon - eqt;
    var base = Date.UTC(y, mo - 1, d);
    return { rise: base + (noon - 4 * ha) * 60e3, set: base + (noon + 4 * ha) * 60e3 };
  }

  /* ---------- the weather words to a code the pages read (WMO style, as Open-Meteo's) ---------- */
  // Coverage the NWS uses for "this will happen here" rather than "it might": only these give a
  // precipitation code. A "chance" or "scattered" hour keeps its sky code and its precipitation chance.
  var SURE = { likely: 1, definite: 1, numerous: 1, widespread: 1, frequent: 1, occasional: 1, periods: 1, intermittent: 1, areas: 1, patchy: 1 };
  function wxCode(list, sky) {
    var best = null;
    (list || []).forEach(function (w) {
      if (!w || !w.weather || !SURE[w.coverage]) return;
      var t = w.weather, heavy = w.intensity === 'heavy', light = w.intensity === 'light' || w.intensity === 'very_light', c = null;
      if (t === 'thunderstorms') c = 95;
      else if (t === 'freezing_rain') c = heavy ? 67 : 66;
      else if (t === 'freezing_drizzle') c = heavy ? 57 : 56;
      else if (t === 'sleet' || t === 'ice_pellets' || t === 'hail') c = 77;
      else if (t === 'snow') c = heavy ? 75 : light ? 71 : 73;
      else if (t === 'snow_showers') c = heavy ? 86 : 85;
      else if (t === 'rain') c = heavy ? 65 : light ? 61 : 63;
      else if (t === 'rain_showers') c = heavy ? 82 : light ? 80 : 81;
      else if (t === 'drizzle') c = heavy ? 55 : light ? 51 : 53;
      else if (t === 'fog' || t === 'ice_fog') c = 45;
      else if (t === 'freezing_fog') c = 48;
      if (c != null && (best == null || c > best)) best = c;
    });
    if (best != null) return best;
    sky = num(sky);
    if (sky == null) return null;
    return sky <= 12 ? 0 : sky <= 37 ? 1 : sky <= 62 ? 2 : 3;
  }

  /* ---------- units ---------- */
  function conv(v, uom, kind, metric) {
    v = num(v); if (v == null) return null;
    var u = String(uom || '').replace(/^wmoUnit:|^unit:/, '');
    if (kind === 'temp') { var c = u === 'degF' ? (v - 32) * 5 / 9 : v; return metric ? c : c * 9 / 5 + 32; }
    if (kind === 'wind') { var k = u === 'm_s-1' ? v * 3.6 : u === 'kn' ? v * 1.852 : u === 'mph' ? v * 1.609344 : v; return metric ? k : k / 1.609344; }
    if (kind === 'len') { var mm = u === 'in' ? v * 25.4 : u === 'cm' ? v * 10 : u === 'm' ? v * 1000 : v; return metric ? mm : mm / 25.4; }
    return v;
  }
  function round(v, d) { if (v == null) return null; var f = Math.pow(10, d); return Math.round(v * f) / f; }

  /* ---------- the grid, hour by hour ---------- */
  // Each grid element as one value per hour of `hours` (UTC ms at the top of each hour). An element
  // that is an amount over its step (precipitation) is shared equally across the step's hours.
  function layer(p, name, hours, kind, metric, amount) {
    var L = p[name], out = hours.map(function () { return null; });
    if (!L || !L.values) return out;
    var i0 = hours.length ? hours[0] : 0;
    L.values.forEach(function (v) {
      var s = span(v.validTime); if (!s) return;
      var n = Math.max(1, Math.round((s.b - s.a) / HOUR));
      var val = kind === 'raw' ? v.value : conv(v.value, L.uom, kind, metric);
      if (val == null) return;
      if (amount) val = val / n;
      for (var t = s.a; t < s.b; t += HOUR) {
        var k = Math.round((t - i0) / HOUR);
        if (k >= 0 && k < hours.length) out[k] = val;
      }
    });
    return out;
  }

  function build(raw, pt, o) {
    o = o || {};
    var p = raw && raw.properties; if (!p) throw new Error('NWS: empty forecast grid');
    var metric = o.units === 'metric', tz = (pt && pt.tz) || 'America/Chicago';
    var now = o.now != null ? o.now : Date.now(), days = o.days || 7;
    var lat = pt && pt.lat, lon = pt && pt.lon;
    if ((lat == null || lon == null) && raw.geometry && raw.geometry.coordinates) { // the cell's own middle
      var ring = raw.geometry.coordinates[0] || [], sx = 0, sy = 0;
      ring.forEach(function (c) { sx += c[0]; sy += c[1]; });
      if (ring.length) { lon = sx / ring.length; lat = sy / ring.length; }
    }
    // hours from local midnight today, `days` days long
    var lp = localParts(now, tz), midLocal = Date.UTC(lp.y, lp.mo - 1, lp.d);
    var start = midLocal - offsetSec(now, tz) * 1000;
    start = Math.floor(start / HOUR) * HOUR;
    var hours = []; for (var t = start; t < start + days * 24 * HOUR; t += HOUR) hours.push(t);
    var H = {
      time: hours.map(function (h) { return localStr(h, tz); }),
      time_unix: hours.map(function (h) { return h / 1000; }),   // the same hours as UTC seconds (Open-Meteo's timeformat=unixtime)
      temperature_2m: layer(p, 'temperature', hours, 'temp', metric),
      dew_point_2m: layer(p, 'dewpoint', hours, 'temp', metric),
      apparent_temperature: layer(p, 'apparentTemperature', hours, 'temp', metric),
      relative_humidity_2m: layer(p, 'relativeHumidity', hours, 'raw'),
      wind_speed_10m: layer(p, 'windSpeed', hours, 'wind', metric),
      wind_gusts_10m: layer(p, 'windGust', hours, 'wind', metric),
      wind_direction_10m: layer(p, 'windDirection', hours, 'raw'),
      cloud_cover: layer(p, 'skyCover', hours, 'raw'),
      precipitation_probability: layer(p, 'probabilityOfPrecipitation', hours, 'raw'),
      precipitation: layer(p, 'quantitativePrecipitation', hours, 'len', metric, true)
    };
    var wx = layer(p, 'weather', hours, 'raw');
    H.weather_code = hours.map(function (_, i) { return wxCode(wx[i], H.cloud_cover[i]); });
    H.weathercode = H.weather_code;
    ['temperature_2m', 'dew_point_2m', 'apparent_temperature', 'wind_speed_10m', 'wind_gusts_10m'].forEach(function (k) { H[k] = H[k].map(function (v) { return round(v, 1); }); });
    var rawP = H.precipitation; // the day's total adds the unrounded hours
    H.precipitation = rawP.map(function (v) { return round(v, metric ? 2 : 3); });
    // the sun, per local date
    var D = { time: [], sunrise: [], sunset: [] }, sunAt = {};
    for (var di = 0; di < days; di++) {
      var dp = localParts(start + (di * 24 + 12) * HOUR, tz), key = dp.y + '-' + pad(dp.mo) + '-' + pad(dp.d);
      if (D.time.indexOf(key) >= 0) continue;
      var st = (lat != null && lon != null) ? sunTimes(lat, lon, dp.y, dp.mo, dp.d) : null;
      D.time.push(key); D.sunrise.push(st ? localStr(st.rise, tz) : null); D.sunset.push(st ? localStr(st.set, tz) : null);
      sunAt[key] = st;
    }
    H.is_day = hours.map(function (h, i) {
      var s = sunAt[H.time[i].slice(0, 10)]; if (!s) return null;
      var mid = h + HOUR / 2; return (mid >= s.rise && mid < s.set) ? 1 : 0;
    });
    // daily: the NWS day and night highs and lows where given, else the hourly extremes
    function byDay(arr, f) {
      return D.time.map(function (k) {
        var v = []; for (var i = 0; i < H.time.length; i++) if (H.time[i].slice(0, 10) === k && arr[i] != null) v.push(arr[i]);
        return v.length ? f(v) : null;
      });
    }
    function mx(v) { return Math.max.apply(null, v); }
    function mn(v) { return Math.min.apply(null, v); }
    function sum(v) { return v.reduce(function (a, b) { return a + b; }, 0); }
    function official(name) {
      var L = p[name], out = D.time.map(function () { return null; });
      if (!L || !L.values) return out;
      L.values.forEach(function (v) {
        var s = span(v.validTime); if (!s) return;
        var mid = localStr(s.a + (s.b - s.a) / 2, tz).slice(0, 10), k = D.time.indexOf(mid);
        // a night low belongs to the date it ends on (the morning low), as the NWS words it
        if (name === 'minTemperature') k = D.time.indexOf(localStr(s.b - 1, tz).slice(0, 10));
        if (k >= 0) out[k] = round(conv(v.value, L.uom, 'temp', metric), 1);
      });
      return out;
    }
    var hiO = official('maxTemperature'), loO = official('minTemperature');
    // a day the grid covers only in part (today, before the grid's first hour) has no hourly high or low:
    // the hours left are not the day's
    function full(f) { return function (v) { return v.length >= 20 ? f(v) : null; }; }
    var hiH = byDay(H.temperature_2m, full(mx)), loH = byDay(H.temperature_2m, full(mn));
    D.temperature_2m_max = D.time.map(function (_, i) { return hiO[i] != null ? hiO[i] : hiH[i]; });
    D.temperature_2m_min = D.time.map(function (_, i) { return loO[i] != null ? loO[i] : loH[i]; });
    D.precipitation_probability_max = byDay(H.precipitation_probability, mx);
    D.precipitation_sum = byDay(rawP, function (v) { return round(sum(v), metric ? 1 : 2); });
    D.wind_speed_10m_max = byDay(H.wind_speed_10m, mx); D.windspeed_10m_max = D.wind_speed_10m_max;
    D.wind_gusts_10m_max = byDay(H.wind_gusts_10m, mx);
    D.relative_humidity_2m_mean = byDay(H.relative_humidity_2m, function (v) { return Math.round(sum(v) / v.length); });
    D.weather_code = D.time.map(function (k) { // the day's worst code, daylight-ish hours 6 AM to 9 PM
      var best = null;
      for (var i = 0; i < H.time.length; i++) {
        if (H.time[i].slice(0, 10) !== k) continue;
        var hh = +H.time[i].slice(11, 13), c = H.weather_code[i];
        if (hh < 6 || hh > 21 || c == null) continue;
        if (best == null || c > best) best = c;
      }
      return best;
    });
    D.weathercode = D.weather_code;
    D.winddirection_10m_dominant = D.time.map(function (k) { // vector mean of the day's winds
      var su = 0, sv = 0, n = 0;
      for (var i = 0; i < H.time.length; i++) {
        if (H.time[i].slice(0, 10) !== k) continue;
        var s = H.wind_speed_10m[i], d = H.wind_direction_10m[i]; if (s == null || d == null) continue;
        su += s * Math.sin(d * Math.PI / 180); sv += s * Math.cos(d * Math.PI / 180); n++;
      }
      return n ? Math.round((Math.atan2(su, sv) * 180 / Math.PI + 360) % 360) : null;
    });
    // current: the hour that holds now
    var ci = Math.floor((now - start) / HOUR), C = { time: H.time[ci] || null, interval: 3600 };
    Object.keys(H).forEach(function (k) { if (k !== 'time' && k !== 'time_unix') C[k] = (H[k] || [])[ci] != null ? H[k][ci] : null; });
    return {
      latitude: lat, longitude: lon, timezone: tz, utc_offset_seconds: offsetSec(now, tz),
      current: C, hourly: H, daily: D,
      _nws: { office: pt && pt.office || p.gridId, x: pt && pt.x != null ? pt.x : p.gridX, y: pt && pt.y != null ? pt.y : p.gridY,
        updated: p.updateTime || null, city: pt && pt.city || null, state: pt && pt.state || null }
    };
  }

  function forecast(lat, lon, o) {
    o = o || {};
    return point(lat, lon, o).then(function (pt) {
      return gridAt(pt.office, pt.x, pt.y, o).then(function (raw) {
        return build(raw, { office: pt.office, x: pt.x, y: pt.y, tz: pt.tz, city: pt.city, state: pt.state, lat: +lat, lon: +lon }, o);
      });
    });
  }

  // "Forecast: National Weather Service (NDFD grid, ARX 28,70), issued Oct 29 5:52 AM CDT."
  function sourceLine(d) {
    var n = d && d._nws; if (!n) return 'Forecast: National Weather Service.';
    var at = '';
    if (n.updated) { try { at = new Date(n.updated).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: d.timezone || undefined, timeZoneName: 'short' }); } catch (e) { at = ''; } }
    return 'Forecast: National Weather Service (NDFD grid, ' + n.office + ' ' + n.x + ',' + n.y + ')' + (at ? ', issued ' + at : '') + '.';
  }

  var OUT = {
    API: API, point: point, gridAt: gridAt, build: build, forecast: forecast, wxCode: wxCode, sunTimes: sunTimes,
    localStr: localStr, offsetSec: offsetSec, durMs: durMs, sourceLine: sourceLine,
    credit: { t: 'Forecast:', a: 'National Weather Service', u: 'https://www.weather.gov/documentation/services-web-api', tail: '(NDFD forecast grid, public domain). An estimate, not a measurement.' },
    _reset: function () { mem = {}; }
  };
  if (typeof module === 'object' && module.exports) module.exports = OUT;
  else root.AgNWS = OUT;
})(typeof window !== 'undefined' ? window : this);
