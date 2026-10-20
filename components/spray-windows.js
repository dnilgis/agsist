/* /spray: wind at your field and the best spray windows, the math only.
 *
 * No page code in here: the wind view (components/spray-wind.js) and the tests
 * (test/spray-wind.test.mjs) run this same file. The spray rules themselves
 * (wind band at the boom, temperature, humidity, delta T, the hourly strip's
 * inversion rule, dicamba) are not copied here: they are the spray-rules block
 * in spray.html, handed in as `R` (window.AgSprayRules in the browser).
 *
 * Forecast: Open-Meteo, model gfs_seamless (NOAA HRRR for the first hours,
 * then NOAA GFS), keyless. A 5 x 5 grid of points around the field for the
 * wind map (three numbers per point per hour), and the field point itself
 * with everything the spray rules need. Decoding GFS GRIB in the browser
 * would mean megabytes per run for one field; this is a few dozen KB.
 */
(function (root) {
  'use strict';

  var MODEL = 'gfs_seamless';
  var GRID_N = 5;          // 5 x 5 points
  var GRID_HALF_LAT = 0.2; // degrees north and south of the field (about 14 miles)
  var HOURS = 48;

  /* Inversion risk, the rule stated on the page (a risk, not a measurement):
     calm air at the boom (under 3 mph), from 2 hours before sunset to 1 hour
     after sunrise, under a mostly clear sky (cloud cover 30% or less).
     Sources: Sprayers101, "Spraying weather" (inversions form when the sun is
     low or down, early evening to early morning, more on clear nights, and
     can begin hours before sunset, citing Mandy Bish, University of
     Missouri); SDSU Extension, SD Spray Tool (calm to 2 mph is the red and
     yellow band, 3 to 10 mph green; inversions most often at night and in the
     first and last hours of daylight). */
  var INV = { calmBoom: 3, beforeSunsetMin: 120, afterSunriseMin: 60, clearCloud: 30 };

  /* Default rain-free hours by product, from the rain-free table on /spray
     (MSU 2025 Weed Control Guide Table 11, University of Arkansas chart). The
     reader can change it; the label is the authority. */
  var RAINFREE = { general: 2, enlist: 2, dicamba: 4, glyphosate: 2, '24d_ester': 2, contact: 4 };
  var RAINFREE_CHOICES = [1, 2, 4, 6];

  var CREDITS = [
    { id: 'forecast', t: 'Forecast: NOAA HRRR and GFS models (Open-Meteo GFS blend), from', a: 'Open-Meteo', u: 'https://open-meteo.com/', tail: '(CC BY 4.0). An estimate, not a measurement.' },
    { id: 'map', t: 'Map:', a: 'USGS The National Map', u: 'https://www.usgs.gov/programs/national-geospatial-program/national-map', tail: '(public domain).' },
    { id: 'boom', t: 'Boom wind from the 10 m forecast with the', a: 'FAO-56 wind profile', u: 'https://www.fao.org/4/x0490e/x0490e07.htm', tail: '(about 0.75 of the 10 m speed).' },
    { id: 'inv', t: 'Inversion rule after', a: 'Sprayers101, Spraying weather', u: 'https://sprayers101.com/spraying-weather/', tail: '' },
    { id: 'inv2', t: 'and', a: 'SDSU Extension, SD Spray Tool', u: 'https://extension.sdstate.edu/use-sd-spray-tool-inversion-detection-and-weather-pesticide-application', tail: '.' },
    { id: 'rain', t: 'Rain-free hours from the table above (MSU, University of Arkansas). Check your product label.', a: '', u: '', tail: '' }
  ];

  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
  function r3(x) { return Math.round(x * 1000) / 1000; }

  /* ---------- the grid ---------- */
  function gridPoints(lat, lon) {
    var half = GRID_HALF_LAT, halfLon = half / Math.max(0.3, Math.cos(lat * Math.PI / 180));
    var pts = [], step = 2 * half / (GRID_N - 1), stepLon = 2 * halfLon / (GRID_N - 1);
    for (var r = 0; r < GRID_N; r++) {
      for (var c = 0; c < GRID_N; c++) pts.push({ lat: r3(lat + half - r * step), lon: r3(lon - halfLon + c * stepLon) });
    }
    return { n: GRID_N, pts: pts, north: lat + half, south: lat - half, west: lon - halfLon, east: lon + halfLon };
  }

  var API = 'https://api.open-meteo.com/v1/forecast';
  function gridUrl(g) {
    return API + '?latitude=' + g.pts.map(function (p) { return p.lat; }).join(',') +
      '&longitude=' + g.pts.map(function (p) { return p.lon; }).join(',') +
      '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=mph&timezone=auto&forecast_days=3&models=' + MODEL;
  }
  function fieldUrl(lat, lon) {
    return API + '?latitude=' + r3(lat) + '&longitude=' + r3(lon) +
      '&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,precipitation,precipitation_probability,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,is_day' +
      '&daily=sunrise,sunset,temperature_2m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=4&models=' + MODEL;
  }
  /* When each model run started, from Open-Meteo's own model status files. */
  var META = [
    { name: 'HRRR', u: 'https://api.open-meteo.com/data/ncep_hrrr_conus/static/meta.json' },
    { name: 'GFS', u: 'https://api.open-meteo.com/data/ncep_gfs013/static/meta.json' }
  ];
  function runTime(meta) {
    var s = meta && num(meta.last_run_initialisation_time);
    return s == null ? null : new Date(s * 1000);
  }

  /* ---------- time, in the field's own clock ---------- */
  // Open-Meteo (timezone=auto) gives field-local "YYYY-MM-DDTHH:MM" strings. They are handled as text
  // and as UTC-frame dates (Date.UTC of the same numbers) so the reader's own time zone never shifts them.
  function hourKey(d) { // field-local now, floored to the hour, from utc_offset_seconds
    var off = d && num(d.utc_offset_seconds); if (off == null) off = 0;
    var u = new Date(Date.now() + off * 1000);
    return u.toISOString().slice(0, 13) + ':00';
  }
  function parts(s) { var m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(String(s || '')); return m ? { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] } : null; }
  function minOfDay(s) { var p = parts(s); return p ? p.h * 60 + p.mi : null; }
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function dow(s) { var p = parts(s); return p ? DOW[new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()] : ''; }
  function clock(h) { h = ((h % 24) + 24) % 24; if (h === 0) return 'midnight'; if (h === 12) return 'noon'; return (h % 12) + (h < 12 ? ' AM' : ' PM'); }
  function hourOf(s) { var p = parts(s); return p ? p.h : null; }
  /* "Tue 7 to 11 AM", "Tue 10 AM to 2 PM", "Tue 8 PM to Wed 6 AM". s and e are the first and last hour
     strings of the run; the run ends at the top of the hour after e. */
  function fmtRange(s, e) {
    var h0 = hourOf(s), h1 = (hourOf(e) + 1) % 24, d0 = dow(s);
    var endNextDay = hourOf(e) + 1 >= 24 || String(e).slice(0, 10) !== String(s).slice(0, 10);
    var a = clock(h0), b = clock(h1);
    if (endNextDay) {
      var sameDate = String(e).slice(0, 10) === String(s).slice(0, 10);
      if (h1 === 0) return d0 + ' ' + a + ' to midnight' + (sameDate ? '' : ' ' + dow(e));
      return d0 + ' ' + a + ' to ' + dow(e) + ' ' + b;
    }
    // same half of the day and neither is noon or midnight: "7 to 11 AM"
    if (/ (AM|PM)$/.test(a) && /( AM| PM)$/.test(b) && a.slice(-2) === b.slice(-2)) return d0 + ' ' + a.slice(0, -3) + ' to ' + b;
    return d0 + ' ' + a + ' to ' + b;
  }

  /* ---------- wind ---------- */
  // Direction is where the wind comes FROM (meteorological). u east, v north, the way the air moves.
  function uv(speed, dirFrom) {
    if (speed == null || dirFrom == null) return null;
    var a = dirFrom * Math.PI / 180;
    return { u: -speed * Math.sin(a), v: -speed * Math.cos(a) };
  }
  var COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  function compass(d) { return d == null ? '' : COMPASS[Math.floor(d / 22.5 + 0.5) % 16]; }

  /* The grid answer (an array, one entry per point, in gridPoints order) as hour-by-hour
     u / v / speed / gust arrays, starting at the field's current hour. */
  function parseGrid(json, g, startKey) {
    var arr = Array.isArray(json) ? json : (json ? [json] : []);
    if (arr.length !== g.pts.length) return null;
    var times = arr[0] && arr[0].hourly && arr[0].hourly.time;
    if (!times || !times.length) return null;
    var i0 = 0; while (i0 < times.length && times[i0] < startKey) i0++;
    var nh = Math.min(HOURS, times.length - i0); if (nh <= 0) return null;
    var out = { times: times.slice(i0, i0 + nh), u: [], v: [], speed: [], gust: [], dir: [], n: g.n };
    for (var h = 0; h < nh; h++) {
      var U = [], V = [], S = [], G = [], D = [];
      for (var k = 0; k < arr.length; k++) {
        var hr = arr[k].hourly || {}, s = num((hr.wind_speed_10m || [])[i0 + h]), d = num((hr.wind_direction_10m || [])[i0 + h]);
        var w = uv(s, d);
        U.push(w ? w.u : null); V.push(w ? w.v : null); S.push(s); D.push(d); G.push(num((hr.wind_gusts_10m || [])[i0 + h]));
      }
      out.u.push(U); out.v.push(V); out.speed.push(S); out.gust.push(G); out.dir.push(D);
    }
    return out;
  }

  /* Wind at fractional grid position (gx across 0..n-1 west to east, gy down 0..n-1 north to south)
     and fractional hour t: bilinear in space, linear in time. Missing corners are skipped. */
  function sample(W, t, gx, gy) {
    var n = W.n, h0 = Math.max(0, Math.min(W.u.length - 1, Math.floor(t))), h1 = Math.min(W.u.length - 1, h0 + 1), ft = Math.max(0, Math.min(1, t - h0));
    gx = Math.max(0, Math.min(n - 1, gx)); gy = Math.max(0, Math.min(n - 1, gy));
    var x0 = Math.min(n - 2, Math.floor(gx)), y0 = Math.min(n - 2, Math.floor(gy)), fx = gx - x0, fy = gy - y0;
    var su = 0, sv = 0, sw = 0;
    function add(h, wt) {
      if (wt <= 0) return;
      var c = [[x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)], [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy]];
      for (var i = 0; i < 4; i++) {
        var k = c[i][1] * n + c[i][0], u = W.u[h][k], v = W.v[h][k], w = c[i][2] * wt;
        if (u == null || v == null || w <= 0) continue;
        su += u * w; sv += v * w; sw += w;
      }
    }
    add(h0, 1 - ft); if (h1 !== h0) add(h1, ft);
    if (!sw) return null;
    var u = su / sw, v = sv / sw;
    return { u: u, v: v, s: Math.sqrt(u * u + v * v) };
  }

  /* The wind band at the boom for a 10 m speed, for colour: calm, band, high, over. */
  function band(R, P, u10) {
    if (u10 == null) return 'na';
    var b = R.boomWind(u10);
    if (b < P.wMin) return 'calm';
    if (b <= P.wHiCaution) return 'band';
    if (b <= P.wMax) return 'high';
    return 'over';
  }

  /* ---------- the field, hour by hour ---------- */
  function sunFor(field, key) {
    var dl = field.daily || {}, k = (dl.time || []).indexOf(String(key).slice(0, 10));
    if (k < 0) return null;
    var sr = minOfDay((dl.sunrise || [])[k]), ss = minOfDay((dl.sunset || [])[k]);
    return (sr == null || ss == null) ? null : { sr: sr, ss: ss };
  }
  /* The stated inversion rule for the hour starting at `key`. Returns 'risk' (calm, low sun, clear),
     'calm-night' (calm and low sun but cloudy or cloud unknown) or null. isDay is the fallback when the
     day's sunrise and sunset are missing. */
  function inversionFlag(R, key, u10, cloud, sun, isDay) {
    if (u10 == null) return null;
    if (R.boomWind(u10) >= INV.calmBoom) return null;
    var low;
    if (sun) {
      var m = minOfDay(key);
      low = (m + 60 > sun.ss - INV.beforeSunsetMin) || (m < sun.sr + INV.afterSunriseMin);
    } else if (isDay != null) low = isDay === 0;
    else return null;
    if (!low) return null;
    return (cloud != null && cloud <= INV.clearCloud) ? 'risk' : 'calm-night';
  }
  function isRain(precipIn, prob, code) {
    if (code != null && code >= 51 && code <= 99) return true;
    if (precipIn != null && precipIn >= 0.01) return true;
    if (prob != null && prob >= 50) return true;
    return false;
  }

  /* Reason keys, worst first: the first one an hour hits is the one the plain-words list names. */
  var WHY = ['frozen', 'rain', 'rainsoon', 'inv', 'windy', 'calm', 'dicamba', 'hot', 'cold', 'dry', 'dew', 'gust', 'breezy', 'invwatch', 'dicambawatch', 'warm', 'cool', 'lowrh', 'humid', 'dewwatch', 'na'];
  var WHY_TEXT = {
    frozen: 'Below freezing', rain: 'Rain', rainsoon: 'Rain too soon after', inv: 'Inversion risk', windy: 'Too windy',
    calm: 'Too calm', dicamba: 'No dicamba', hot: 'Too hot', cold: 'Too cold', dry: 'Too dry', dew: 'Dew on the leaves',
    gust: 'Gusty', breezy: 'Breezy', invwatch: 'Inversion possible', dicambawatch: 'Dicamba limits', warm: 'Warm', cool: 'Cool',
    lowrh: 'Dry air', humid: 'Humid air', dewwatch: 'Dew possible', na: 'Forecast missing a value'
  };

  /* Every hour from the field's current hour, up to 48, rated with the page's own spray rules plus
     the rain-free hours and the inversion rule above.
     opts: { P: product, pkey: product key, S: dicamba state rule or null, rainfree: hours, startKey } */
  function rateHours(R, field, opts) {
    var hr = field && field.hourly; if (!hr || !hr.time) return [];
    var P = opts.P || R.PRODUCTS.general, N = opts.rainfree != null ? opts.rainfree : (RAINFREE[opts.pkey] || 2);
    var startKey = opts.startKey || hourKey(field), times = hr.time;
    function at(name, i) { return num((hr[name] || [])[i]); }
    var wet = times.map(function (_, i) { return isRain(at('precipitation', i), at('precipitation_probability', i), at('weather_code', i)); });
    var out = [];
    for (var i = 0; i < times.length && out.length < HOURS; i++) {
      if (times[i] < startKey) continue;
      var key = times[i], h = hourOf(key);
      var wind = at('wind_speed_10m', i), gust = at('wind_gusts_10m', i), dir = at('wind_direction_10m', i);
      var tRaw = at('temperature_2m', i), temp = tRaw == null ? null : Math.round(tRaw), rh = at('relative_humidity_2m', i);
      var dewRaw = at('dew_point_2m', i), dew = dewRaw == null ? null : Math.round(dewRaw), cloud = at('cloud_cover', i), code = at('weather_code', i);
      var tNext = at('temperature_2m', i + 1), trend = (tRaw != null && tNext != null) ? Math.round((tNext - tRaw) * 10) / 10 : null;
      var wR = wind == null ? 'na' : R.windRatingG(wind, gust, P);
      var tR = temp == null ? 'na' : R.tempRatingP(temp, P);
      var hR = rh == null ? 'na' : R.humidRating(rh);
      var iR = wind == null ? 'na' : R.inversionRisk(wind, h, cloud, trend);
      var dR = (temp == null || dew == null) ? 'na' : R.dewRisk(temp, dew);
      var dt = (temp == null || rh == null) ? null : R.deltaTC(temp, rh), dtR = dt == null ? 'na' : R.deltaTRating(dt);
      var overall = R.overallRating(wR, tR, hR, iR, dR, code == null ? 0 : code, dtR);
      var dst = R.dicambaStatus(P, field.daily, new Date(key), 36e5, opts.S || null, temp);
      overall = R.applyDicamba(overall, dst);
      var inv = inversionFlag(R, key, wind, cloud, sunFor(field, key), at('is_day', i));
      // rain in this hour or the N hours after it ends
      var rainNow = wet[i], rainSoon = false, unknown = false;
      for (var j = i + 1; j <= i + N; j++) { if (j >= times.length) { unknown = true; break; } if (wet[j]) { rainSoon = true; break; } }
      var why = [];
      function push(k) { if (why.indexOf(k) < 0) why.push(k); }
      if (tR === 'frozen') push('frozen');
      if (rainNow) push('rain');
      if (rainSoon) push('rainsoon');
      if (inv === 'risk' || iR === 'poor') push('inv');
      if (wR === 'poor' && wind != null && R.boomWind(wind) > P.wMax) push('windy');
      if (wR === 'poor' && wind != null && R.boomWind(wind) < P.wMin) push('calm');
      if (dst && dst.level === 'block') push('dicamba');
      if (tR === 'poor') push(temp >= 60 ? 'hot' : 'cold');
      if (hR === 'poor' || dtR === 'poor') push('dry');
      if (dR === 'poor') push('dew');
      if (wR === 'marginal' && R.gustyFlag(wind, gust, P)) push('gust');
      else if (wR === 'marginal') push('breezy');
      if (iR === 'marginal' || inv === 'calm-night') push('invwatch');
      if (dst && dst.level === 'caution') push('dicambawatch');
      if (tR === 'marginal') push(temp >= 60 ? 'warm' : 'cool');
      if (hR === 'marginal') push(rh < 40 ? 'lowrh' : 'humid');
      if (dtR === 'marginal') push(dt < 2 ? 'humid' : 'lowrh');
      if (dR === 'marginal') push('dewwatch');
      if ([wR, tR, hR, dR, dtR].indexOf('na') >= 0) push('na');
      var r = overall === 'good' ? 'good' : overall === 'marginal' ? 'fair' : 'no';
      if (rainNow || rainSoon || inv === 'risk') r = 'no';
      if (r === 'good' && unknown) { r = 'fair'; push('na'); }
      why.sort(function (a, b) { return WHY.indexOf(a) - WHY.indexOf(b); });
      out.push({ t: key, r: r, why: why, wind: wind, boom: wind == null ? null : R.boomWind(wind), gust: gust, dir: dir, temp: temp, rh: rh, dt: dt, cloud: cloud, inv: inv, dicamba: dst || null });
    }
    return out;
  }

  /* ---------- plain words ---------- */
  function runs(hours, test) {
    var out = [], s = -1;
    for (var i = 0; i <= hours.length; i++) {
      var ok = i < hours.length && test(hours[i]);
      if (ok && s < 0) s = i;
      if (!ok && s >= 0) { out.push({ s: s, e: i - 1 }); s = -1; }
    }
    return out;
  }
  function mainWhy(h) { return h.why.length ? h.why[0] : 'na'; }
  function detail(hours, run, k) {
    var mx = function (f) { var m = null; for (var i = run.s; i <= run.e; i++) { var v = f(hours[i]); if (v != null && (m == null || v > m)) m = v; } return m; };
    var mn = function (f) { var m = null; for (var i = run.s; i <= run.e; i++) { var v = f(hours[i]); if (v != null && (m == null || v < m)) m = v; } return m; };
    if (k === 'windy' || k === 'breezy') { var b = mx(function (h) { return h.boom; }), g = mx(function (h) { return h.gust; }); return '(about ' + Math.round(b) + ' mph at the boom' + (g != null ? ', gusts ' + Math.round(g) + ' mph' : '') + ')'; }
    if (k === 'gust') { var g2 = mx(function (h) { return h.gust; }); return g2 == null ? '' : '(gusts ' + Math.round(g2) + ' mph)'; }
    if (k === 'calm') { var b2 = mx(function (h) { return h.boom; }); return b2 == null ? '' : '(under ' + Math.max(1, Math.ceil(b2)) + ' mph at the boom)'; }
    if (k === 'hot' || k === 'warm') { var t = mx(function (h) { return h.temp; }); return t == null ? '' : '(' + t + '°F)'; }
    if (k === 'cold' || k === 'cool' || k === 'frozen') { var t2 = mn(function (h) { return h.temp; }); return t2 == null ? '' : '(' + t2 + '°F)'; }
    if (k === 'dry') { var d = mx(function (h) { return h.dt; }), rh = mn(function (h) { return h.rh; }); return '(' + (rh != null ? rh + '% humidity' : '') + (d != null ? (rh != null ? ', ' : '') + 'delta T ' + (d * 9 / 5).toFixed(0) + '°F' : '') + ')'; }
    return '';
  }
  /* The list, as short lines: good runs first, then what rules out the rest. */
  function summary(hours, opts) {
    opts = opts || {};
    var N = opts.rainfree || 2, lines = [], maxLines = opts.max || 7;
    if (!hours.length) return ['No forecast hours to rate.'];
    var good = runs(hours, function (h) { return h.r === 'good'; });
    good.forEach(function (g) { if (lines.length < 3) lines.push({ r: 'good', text: 'Good: ' + fmtRange(hours[g.s].t, hours[g.e].t) + (g.s === 0 ? ' (from now)' : '') + '.' }); });
    if (!good.length) {
      var fair = runs(hours, function (h) { return h.r === 'fair'; });
      if (!fair.length) lines.push({ r: 'no', text: 'No spray window in the next ' + hours.length + ' hours.' });
      else {
        lines.push({ r: 'no', text: 'No good hours in the next ' + hours.length + ' hours.' });
        fair.slice(0, 2).forEach(function (f) { lines.push({ r: 'fair', text: 'Best is fair: ' + fmtRange(hours[f.s].t, hours[f.e].t) + ' (' + WHY_TEXT[mainWhy(hours[f.s])].toLowerCase() + ').' }); });
      }
    }
    // what rules out the other hours: runs of the same main reason, worst reasons first, named once each
    var segs = runs(hours, function (h) { return h.r !== 'good'; }), by = {};
    segs.forEach(function (sg) {
      var s = sg.s;
      for (var i = sg.s; i <= sg.e + 1; i++) {
        if (i > sg.e || mainWhy(hours[i]) !== mainWhy(hours[s])) {
          var k = mainWhy(hours[s]);
          (by[k] = by[k] || []).push({ s: s, e: i - 1 });
          s = i;
        }
      }
    });
    WHY.forEach(function (k) {
      if (!by[k] || lines.length >= maxLines) return;
      var rr = by[k].slice(0, 3), txt = WHY_TEXT[k];
      if (k === 'rainsoon') txt = 'Rain within ' + N + ' hour' + (N === 1 ? '' : 's') + ' after';
      var where = rr.map(function (x) { return fmtRange(hours[x.s].t, hours[x.e].t); }).join(', ');
      var det = rr.length === 1 ? detail(hours, rr[0], k) : detail(hours, { s: rr[0].s, e: rr[rr.length - 1].e }, k);
      var rs = hours[rr[0].s].r;
      lines.push({ r: rs, k: k, text: txt + ' ' + where + (det ? ' ' + det : '') + '.' });
    });
    return lines;
  }

  /* ---------- share link ---------- */
  function shareUrl(origin, lat, lon, key) {
    return origin + '/spray?f=' + r3(lat) + ',' + r3(lon) + (key ? '&t=' + String(key).slice(0, 13) : '') + '#wind';
  }
  function parseShare(search) {
    var q = String(search || '').replace(/^\?/, ''), f = null, t = null;
    q.split('&').forEach(function (kv) {
      var i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1));
      if (k === 'f') { var m = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(v); if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) f = { lat: +m[1], lon: +m[2] }; }
      if (k === 't' && /^\d{4}-\d\d-\d\dT\d\d$/.test(v)) t = v + ':00';
    });
    return f ? { lat: f.lat, lon: f.lon, t: t } : null;
  }

  var API_OUT = {
    MODEL: MODEL, HOURS: HOURS, INV: INV, RAINFREE: RAINFREE, RAINFREE_CHOICES: RAINFREE_CHOICES, CREDITS: CREDITS, META: META, WHY_TEXT: WHY_TEXT,
    gridPoints: gridPoints, gridUrl: gridUrl, fieldUrl: fieldUrl, runTime: runTime, hourKey: hourKey, fmtRange: fmtRange, clock: clock, dow: dow,
    uv: uv, compass: compass, parseGrid: parseGrid, sample: sample, band: band, inversionFlag: inversionFlag, isRain: isRain, sunFor: sunFor,
    rateHours: rateHours, summary: summary, runs: runs, shareUrl: shareUrl, parseShare: parseShare
  };
  if (typeof module === 'object' && module.exports) module.exports = API_OUT;
  else root.AgSprayWin = API_OUT;
})(typeof window !== 'undefined' ? window : this);
