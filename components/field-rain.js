/* field-rain.js: rain at a reader's saved fields, /field-rain (Nov 20, 2026).

   WHY. Farmers pay for apps that show rain at several fields; the complaints are that estimates disagree with gauges,
   nobody says when the number last updated, history disappears on a plan change, and a pin lands two towns away.
   Everything here is public data, read in the reader's browser; nothing about a field leaves the device except the
   one point each data read needs (the radar file is a whole state, so not even that; PRISM is asked for the point).

   WHERE THE NUMBERS COME FROM
   - Last 24 hours, last 7 days, month to date: NOAA MRMS multi-sensor QPE, Pass 2 (radar corrected with rain gauges),
     from our own state files, data/radar-rain/<st>.bin (scripts/radar_rain.py, four runs a day; components/radar-rain.js
     decodes them). Pass 2 is the gauge-corrected run; MRMS does not revise it afterward.
   - Since Jan 1, crop season, and every "last year" figure: PRISM daily precipitation (Oregon State, 4 km), read through
     RCC-ACIS GridData grid 21 (components/prism.js). PRISM's newest days are early estimates it reissues once the
     month's late gauge reports are in, so any total holding a day from this month or last month is marked preliminary.
   - Beside them, the nearest county gauge within 30 miles (the radar file carries its reported days, and radar at it).
   - Town and county: the nearest ZIP center in our own ZIP table (data/places/zip/), with its distance, so a pin that
     landed in the wrong place shows it.

   RULES
   - Every figure carries its source label and its dates. Each source line says "rain through" (the end of the data)
     and "data received" (when our radar job read it, or when this browser read PRISM). Nothing is guessed: a window
     with a missing day shows the missing count and no total.
   - Fields live in this browser only (localStorage agsist-fields, at most MAX). The permanent link carries a field's
     coordinates, name and planting date in the #hash (never sent to a server; Analytics gets the bare path).

   window.AgFieldRain (node: module.exports, test/field-rain.test.mjs). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object' && typeof root.document !== 'undefined') {
    root.AgFieldRain = api;
    var run = function () { try { api.boot(root); } catch (e) { if (root.console) root.console.error(e); } };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', run); else run();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MAX = 20;             // field-rain.html's head script holds room for at most this many cards
  var KEY = 'agsist-fields';
  var STALE_H = 9;          // the radar job runs four times a day: older than this missed a run or two
  var GAUGE_MI = 30;
  var SRC = { mrms: 'radar estimate (NOAA MRMS)', prism: 'PRISM estimate' };
  var NET = { cocorahs: 'CoCoRaHS volunteer gauge', noaa: 'NOAA co-op gauge' };
  var M3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /* which ZIP shards (first two digits) hold each state's ZIPs; test/field-rain.test.mjs checks it against data/places/zip */
  var ZSH = { AL: '35 36', AR: '71 72', AZ: '85 86', CA: '90 91 92 93 94 95 96', CO: '80 81', CT: '06', DC: '20 56', DE: '19',
    FL: '32 33 34', GA: '30 31 39', IA: '50 51 52', ID: '83', IL: '60 61 62', IN: '46 47', KS: '66 67', KY: '40 41 42',
    LA: '70 71', MA: '01 02 05', MD: '20 21', ME: '03 04', MI: '48 49', MN: '55 56', MO: '63 64 65 72', MS: '38 39', MT: '59',
    NC: '27 28', ND: '58', NE: '68 69', NH: '03', NJ: '07 08', NM: '87 88', NV: '88 89', NY: '00 06 10 11 12 13 14',
    OH: '43 44 45', OK: '73 74', OR: '97', PA: '15 16 17 18 19', RI: '02', SC: '29', SD: '57', TN: '37 38',
    TX: '73 75 76 77 78 79 88', UT: '84', VA: '20 22 23 24', VT: '05', WA: '98 99', WI: '53 54', WV: '24 25 26', WY: '82 83' };

  /* ---------- small helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function day(s) { return new Date(s + 'T00:00:00Z'); }
  function addDays(s, n) { var d = day(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); }
  /* the same date a year earlier (Feb 29 becomes Feb 28) */
  function yearBack(s) {
    var y = +s.slice(0, 4) - 1, md = s.slice(5);
    if (md === '02-29') md = '02-28';
    return y + '-' + md;
  }
  function dShort(s) { return M3[+s.slice(5, 7) - 1] + ' ' + (+s.slice(8, 10)); }
  function dLong(s) { return dShort(s) + ', ' + s.slice(0, 4); }
  /* "Nov 14 to 20" or "Oct 30 to Nov 5": two dates of one year, the month said once when it is the same */
  function dd(a, b) { return a.slice(0, 7) === b.slice(0, 7) ? dShort(a) + ' to ' + (+b.slice(8, 10)) : dShort(a) + ' to ' + dShort(b); }
  function span(a, b) {
    if (a === b) return dLong(a);
    return a.slice(0, 4) === b.slice(0, 4) ? dd(a, b) + ', ' + a.slice(0, 4) : dLong(a) + ' to ' + dLong(b);
  }
  function inch(v) { return v == null ? null : (Math.round(v * 100) / 100).toFixed(2); }
  function okPoint(lat, lon) { return isFinite(lat) && isFinite(lon) && lat > 15 && lat < 72 && lon > -180 && lon < -50; }
  function okDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(day(s)) && ymd(day(s)) === s; }
  function cleanName(s) { return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40); }
  /* a date in America/Chicago (the radar's month starts at midnight Central) */
  function centralDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return null;
    try {
      var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;
    } catch (e) {}
    return ymd(new Date(d.getTime() - 6 * 3600e3));
  }
  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    try {
      var s = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d);
      return s.replace(':00 ', ' ').replace(/,? (\d{1,2}(:\d\d)?) ([AP]M)/, ', $1 $3');
    } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; }
  }

  /* ---------- the link ---------- */
  /* '#f=42.0300,-93.6200&n=North%2080&p=2026-05-01' (or the same as a query) -> field, or null */
  function parseLink(hash, search) {
    var raw = String(hash || '').replace(/^#/, '');
    if (!/(^|&)f=/.test(raw)) raw = String(search || '').replace(/^\?/, '');
    var q = {};
    raw.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i < 1) return;
      try { q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch (e) {}
    });
    var ll = String(q.f || '').split(',');
    var lat = parseFloat(ll[0]), lon = parseFloat(ll[1]);
    if (ll.length !== 2 || !okPoint(lat, lon)) return null;
    var f = { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, n: cleanName(q.n) || 'Field' };
    if (okDate(q.p)) f.p = q.p;
    return f;
  }
  function linkFor(f, origin) {
    var s = '/field-rain#f=' + (+f.lat).toFixed(4) + ',' + (+f.lon).toFixed(4) + '&n=' + encodeURIComponent(cleanName(f.n) || 'Field');
    if (okDate(f.p)) s += '&p=' + f.p;
    return (origin || '') + s;
  }

  /* ---------- saved fields (pure: each returns a new list, or throws a reader-facing reason) ---------- */
  function readList(raw) {
    var a;
    try { a = JSON.parse(raw || '[]'); } catch (e) { return []; }
    if (!Array.isArray(a)) return [];
    return a.filter(function (f) { return f && okPoint(+f.lat, +f.lon); }).slice(0, MAX).map(function (f, i) {
      var o = { id: String(f.id || 'f' + i), n: cleanName(f.n) || 'Field ' + (i + 1), lat: +f.lat, lon: +f.lon };
      if (okDate(f.p)) o.p = f.p;
      return o;
    });
  }
  function same(a, b) { return Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4; }
  function add(list, f, id) {
    if (list.length >= MAX) throw new Error('You have ' + MAX + ' fields saved, the most this page keeps. Remove one first.');
    if (!okPoint(+f.lat, +f.lon)) throw new Error('That spot is not a point in the US.');
    var o = { id: id || 'f' + Date.now().toString(36), n: cleanName(f.n) || 'Field ' + (list.length + 1), lat: Math.round(f.lat * 1e4) / 1e4, lon: Math.round(f.lon * 1e4) / 1e4 };
    if (okDate(f.p)) o.p = f.p;
    for (var i = 0; i < list.length; i++) if (same(list[i], o) && list[i].n === o.n) return list.slice();
    return list.concat([o]);
  }
  function edit(list, id, ch) {
    return list.map(function (f) {
      if (f.id !== id) return f;
      var o = { id: f.id, n: f.n, lat: f.lat, lon: f.lon };
      if (f.p) o.p = f.p;
      if (ch.n != null) o.n = cleanName(ch.n) || f.n;
      if (ch.lat != null && ch.lon != null) {
        if (!okPoint(+ch.lat, +ch.lon)) throw new Error('That spot is not a point in the US.');
        o.lat = Math.round(ch.lat * 1e4) / 1e4; o.lon = Math.round(ch.lon * 1e4) / 1e4;
      }
      if (ch.p !== undefined) { if (okDate(ch.p)) o.p = ch.p; else delete o.p; }
      return o;
    });
  }
  function remove(list, id) { return list.filter(function (f) { return f.id !== id; }); }

  /* '42.03, -93.62' or '42.03 -93.62' (a pasted map point) -> {lat, lon}; a 5-digit ZIP -> {zip}; else null */
  function parsePlace(s) {
    s = String(s || '').trim();
    if (/^\d{5}$/.test(s)) return { zip: s };
    var m = s.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (!m) return null;
    var lat = +m[1], lon = +m[2];
    if (lon > 0 && lon < 180) lon = -lon;            // "93.62 W" pasted without the minus sign
    return okPoint(lat, lon) ? { lat: lat, lon: lon } : null;
  }

  /* ---------- the grid cells a point reads ---------- */
  function mrmsCell(h, lat, lon) {
    var c = Math.round((lon - h.x0) / h.d), r = Math.round((h.y0 - lat) / h.d);
    if (!(r >= 0 && r < h.ny && c >= 0 && c < h.nx)) return null;
    var cl = h.y0 - r * h.d, cx = h.x0 + c * h.d;
    return { r: r, c: c, lat: Math.round(cl * 1e4) / 1e4, lon: Math.round(cx * 1e4) / 1e4, d: h.d,
             ns: Math.round(h.d * 69.05 * 10) / 10, ew: Math.round(h.d * 69.17 * Math.cos(cl * Math.PI / 180) * 10) / 10 };
  }
  /* PRISM's 4 km grid (1/24 degree, cell centers at -125 + i/24 and 24.0833 + j/24): the cell GridData reads for a point */
  function prismCell(lat, lon) {
    var i = Math.round((lon + 125) * 24), j = Math.round((lat - 24.0833333) * 24);
    return { lat: Math.round((24.0833333 + j / 24) * 1e4) / 1e4, lon: Math.round((-125 + i / 24) * 1e4) / 1e4 };
  }
  function miles(lat1, lon1, lat2, lon2) {
    var R = 3958.8, t = Math.PI / 180, dLat = (lat2 - lat1) * t, dLon = (lon2 - lon1) * t;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * t) * Math.cos(lat2 * t) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  /* the states whose radar box holds the point (index.json boxes are padded, so a border field may sit in two) */
  function statesAt(idx, lat, lon) {
    var st = (idx && idx.states) || {};
    return Object.keys(st).filter(function (k) { var b = st[k]; return lon > b[0] && lon < b[2] && lat > b[1] && lat < b[3]; }).sort();
  }
  function shardsFor(states) {
    var seen = {}, out = [];
    states.forEach(function (s) { String(ZSH[s] || '').split(' ').forEach(function (z) { if (z && !seen[z]) { seen[z] = 1; out.push(z); } }); });
    return out.sort();
  }
  /* nearest ZIP center among tables {zip: [lat, lon, town, st, county]} */
  function nearestTown(tables, lat, lon) {
    var best = null;
    tables.forEach(function (t) {
      Object.keys(t || {}).forEach(function (z) {
        var p = t[z];
        if (!Array.isArray(p) || !isFinite(+p[0]) || !isFinite(+p[1]) || (+p[0] === 0 && +p[1] === 0)) return;
        var m = miles(lat, lon, +p[0], +p[1]);
        if (!best || m < best.mi) best = { zip: z, town: p[2] || '', st: p[3] || '', county: p[4] || '', mi: m };
      });
    });
    return best;
  }
  function townLine(t) {
    if (!t) return 'nearest town not found';
    var mi = t.mi < 1 ? 'under a mile' : (Math.round(t.mi * 10) / 10) + ' mi';
    return 'nearest ZIP center: ' + t.town + ', ' + t.st + ' ' + t.zip + ' (' + mi + ' away), ' + t.county + ' County';
  }

  /* ---------- PRISM sums ---------- */
  /* daily = {time: [...], precipitation_sum: [...]} -> map date -> inches or null */
  function dayMap(daily) {
    var m = {}, t = (daily && daily.time) || [], v = (daily && daily.precipitation_sum) || [];
    for (var i = 0; i < t.length; i++) m[t[i]] = v[i] == null ? null : +v[i];
    return m;
  }
  function lastDay(map, today) {
    var best = null;
    Object.keys(map).forEach(function (d) { if (map[d] != null && d <= today && (!best || d > best)) best = d; });
    return best;
  }
  /* PRISM reissues a month's days once its late reports are in: a day from this month or last month is preliminary */
  function prelimDay(d, today) {
    var y = +today.slice(0, 4), m = +today.slice(5, 7) - 1;
    var py = m === 0 ? y - 1 : y, pm = m === 0 ? 12 : m;
    return d.slice(0, 7) >= py + '-' + pad(pm);
  }
  function sum(map, a, b, today) {
    if (!a || !b || a > b) return null;
    var s = 0, miss = 0, n = 0, pre = false;
    for (var d = a; d <= b; d = addDays(d, 1)) {
      n++;
      if (map[d] == null) miss++;
      else { s += map[d]; if (prelimDay(d, today)) pre = true; }
    }
    return { v: miss ? null : Math.round(s * 100) / 100, a: a, b: b, days: n, miss: miss, pre: pre, src: 'prism' };
  }

  /* ---------- the periods ---------- */
  function radarWin(file, id, lat, lon, lookup) {
    var h = file && file.header;
    if (!h) return null;
    var w = (h.windows || []).filter(function (x) { return x.id === id; })[0];
    if (!w || !file.grids[id]) return null;
    var v = lookup(h, file.grids[id], lat, lon);
    return { v: v == null ? null : v / 100, start: w.start, end: w.end, hours: w.hours, src: 'mrms', gap: v == null };
  }
  /* rows: [{key, label, now: {...}, last: {...}}]; ctx = {radar, prism (dayMap or null), today, plant, lookup} */
  function rows(f, ctx) {
    var out = [], today = ctx.today, map = ctx.prism, L = map ? lastDay(map, today) : null;
    var E = ctx.radar && ctx.radar.header ? centralDate(ctx.radar.header.data_end) : null;
    function lastYear(a, b) { return map ? sum(map, yearBack(a), yearBack(b), today) : { v: null, failed: true, src: 'prism' }; }
    function radarRow(key, label, id, a) {
      var now = ctx.radar ? radarWin(ctx.radar, id, f.lat, f.lon, ctx.lookup) : null;
      var ly = E ? lastYear(a(E), E) : null;
      out.push({ key: key, label: label, now: now || { v: null, src: 'mrms', missing: true }, last: ly });
    }
    radarRow('24h', 'Last 24 hours', '24h', function (e) { return e; });
    radarRow('7d', 'Last 7 days', '7d', function (e) { return addDays(e, -6); });
    radarRow('mtd', 'Month to date', 'month', function (e) { return e.slice(0, 8) + '01'; });
    var y0 = today.slice(0, 4) + '-01-01';
    out.push({ key: 'ytd', label: 'Since Jan 1', now: L && L >= y0 ? sum(map, y0, L, today) : (map ? { v: null, src: 'prism', none: true } : { v: null, failed: true, src: 'prism' }),
               last: L && L >= y0 ? lastYear(y0, L) : null });
    if (okDate(f.p) && f.p <= today) {
      out.push({ key: 'season', label: 'Since planting (' + dShort(f.p) + ')', now: L && L >= f.p ? sum(map, f.p, L, today) : (map ? { v: null, src: 'prism', none: true } : { v: null, failed: true, src: 'prism' }),
                 last: L && L >= f.p ? lastYear(f.p, L) : null });
    }
    return out;
  }
  /* a radar window said with the hour it runs to, so it is plain whether last night's storm is in it:
     "24 hours to Nov 19, 12 PM CST", "Nov 13 to Nov 19, 12 PM CST" (first whole day, Central dates as the radar's month) */
  function radarSpan(c) {
    var to = when(c.end).replace(/^\w+, /, '');
    if (c.hours === 24 || (Date.parse(c.end) - Date.parse(c.start)) === 864e5) return '24 hours to ' + to;
    var a = centralDate(c.start), b = centralDate(c.end);
    if (!a || !b) return '';
    // the month window starts at midnight Central (05:00 or 06:00 UTC), already its first day; a window that starts
    // later in a day (the 7 days from noon) is said from the next day, its first whole day
    if (!/T0[56]:00:00Z$/.test(c.start) && addDays(a, 1) <= b) a = addDays(a, 1);
    return dShort(a) + ' to ' + to;
  }
  /* one cell, said: {v: the figure, t: the source label, dt: its days, pre: preliminary} */
  function cellText(c) {
    if (!c) return { v: '', t: '', dt: '' };
    if (c.failed) return { v: 'no answer', t: SRC.prism, dt: 'RCC-ACIS did not answer' };
    if (c.missing) return { v: 'no file', t: SRC.mrms, dt: 'the radar file did not load' };
    if (c.none) return { v: 'not yet', t: SRC.prism, dt: 'no day posted yet' };
    var dt = c.src === 'mrms' ? radarSpan(c) : span(c.a, c.b);
    if (c.v == null) {
      if (c.src === 'mrms') return { v: 'radar gap', t: SRC.mrms, dt: dt };
      return { v: c.miss + (c.miss === 1 ? ' day' : ' days') + ' missing', t: SRC.prism, dt: dt };
    }
    return { v: inch(c.v) + ' in', t: SRC[c.src], dt: dt, pre: !!c.pre };
  }

  function cellHtml(c) {
    if (!c) return '<div class="fr-v" role="cell"><b>&nbsp;</b><small>&nbsp;</small><small>&nbsp;</small></div>';
    return '<div class="fr-v" role="cell"><b>' + esc(c.v) + (c.pre ? '<sup class="fr-p" title="preliminary">P</sup>' : '') + '</b>' +
      '<small class="fr-src">' + esc(c.t) + '</small><small>' + esc(c.dt) + '</small></div>';
  }

  /* ---------- history: the daily rows, the table and the CSV come from this one list ---------- */
  /* ---------- the reader's own gauge (this device only): {"<lat>,<lon>": {"YYYY-MM-DD": inches}} ---------- */
  var GKEY = 'agsist-field-gauge';
  function gaugeKey(f) { return (+f.lat).toFixed(4) + ',' + (+f.lon).toFixed(4); }
  function readGauge(raw) {
    var o, out = {};
    try { o = JSON.parse(raw || '{}'); } catch (e) { return {}; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    Object.keys(o).forEach(function (k) {
      if (!/^-?\d+\.\d{4},-?\d+\.\d{4}$/.test(k) || !o[k] || typeof o[k] !== 'object') return;
      Object.keys(o[k]).forEach(function (d) { var v = o[k][d]; if (okDate(d) && typeof v === 'number' && v >= 0 && v <= 30) { out[k] = out[k] || {}; out[k][d] = v; } });
    });
    return out;
  }
  /* a reading for the morning of `date` (the rain of the 24 hours before it); v null removes it */
  function putReading(store, key, date, v, today) {
    if (!okDate(date) || date > today) throw new Error('Pick the morning you read the gauge (today or earlier).');
    var out = JSON.parse(JSON.stringify(store || {}));
    if (v == null || v === '') { if (out[key]) { delete out[key][date]; if (!Object.keys(out[key]).length) delete out[key]; } return out; }
    var n = +v;
    if (!isFinite(n) || n < 0 || n > 30) throw new Error('Enter the gauge reading in inches, like 0.45.');
    out[key] = out[key] || {};
    out[key][date] = Math.round(n * 100) / 100;
    return out;
  }
  function moveReadings(store, from, to) {
    if (from === to || !store[from]) return store;
    var out = JSON.parse(JSON.stringify(store));
    out[to] = Object.assign({}, out[from], out[to] || {});
    delete out[from];
    return out;
  }
  /* the newest reading beside PRISM's day for the same morning (PRISM's day ends 12:00 UTC, near a 7 am reading) */
  function mine(readings, map) {
    var ds = Object.keys(readings || {}).sort();
    if (!ds.length) return null;
    var d = ds[ds.length - 1], v = readings[d], p = map ? map[d] : undefined;
    return { d: d, v: v, p: p == null ? null : p, prism: !!map, diff: p == null ? null : Math.round((v - p) * 100) / 100, n: ds.length };
  }
  function mineLine(m) {
    if (!m) return 'Your own gauge: no reading entered for this field yet. Tap "My gauge" to keep one; it stays on this device.';
    var s = 'Your gauge, morning of ' + dShort(m.d) + ': ' + inch(m.v) + ' in. ';
    if (m.p == null) s += m.prism ? 'PRISM has not posted that day yet.' : 'PRISM did not answer, so there is nothing to set beside it.';
    else s += 'PRISM estimate, same day: ' + inch(m.p) + ' in (' + (Math.abs(m.diff) < 0.005 ? 'the same' : 'your gauge ' + inch(Math.abs(m.diff)) + ' in ' + (m.diff > 0 ? 'more' : 'less')) + ').';
    return s + (m.n > 1 ? ' ' + m.n + ' readings kept.' : '');
  }

  function dailyRows(map, today, gauge) {
    var seen = {}, ds = Object.keys(map || {}).concat(Object.keys(gauge || {})).filter(function (d) { if (seen[d] || d > today) return false; seen[d] = 1; return true; }).sort();
    return ds.map(function (d) { var v = map && map[d] != null ? map[d] : null; return { date: d, v: v, pre: v != null && prelimDay(d, today), g: gauge && gauge[d] != null ? gauge[d] : null }; });
  }
  function csv(f, map, today, readAt, gauge) {
    var lines = ['# Rain at ' + cleanName(f.n) + ' (' + (+f.lat).toFixed(4) + ', ' + (+f.lon).toFixed(4) + '), PRISM daily precipitation estimate, 4 km cell centered ' +
      prismCell(f.lat, f.lon).lat + ', ' + prismCell(f.lat, f.lon).lon + '. Read through RCC-ACIS ' + (readAt || '') + '. Blank = PRISM has not posted that day. my_gauge_in = your own reading for that morning, kept on your device.',
      'date,rain_in,source,status,my_gauge_in'];
    dailyRows(map, today, gauge).forEach(function (r) {
      lines.push(r.date + ',' + (r.v == null ? '' : inch(r.v)) + ',PRISM estimate,' + (r.v == null ? 'missing' : r.pre ? 'preliminary' : 'settled') + ',' + (r.g == null ? '' : inch(r.g)));
    });
    return lines.join('\n') + '\n';
  }
  function monthTotals(map, year, today) {
    var out = [];
    for (var m = 1; m <= 12; m++) {
      var a = year + '-' + pad(m) + '-01';
      if (a > today) break;
      var b = addDays((m === 12 ? (year + 1) + '-01-01' : year + '-' + pad(m + 1) + '-01'), -1);
      if (b > today) b = today;
      var s = sum(map, a, b, today);
      out.push({ m: M3[m - 1], a: a, b: b, v: s ? s.v : null, miss: s ? s.miss : 0, pre: s ? s.pre : false });
    }
    return out;
  }
  /* bars for one year: svg string, one rect per day with a value (a missing day draws nothing) */
  function chart(map, year, today) {
    var a = year + '-01-01', b = year + '-12-31', W = 366, H = 120, top = 0, n = 0;
    for (var d = a; d <= b && d <= today; d = addDays(d, 1)) { n++; if (map[d] != null && map[d] > top) top = map[d]; }
    var ceil = Math.max(1, Math.ceil(top));
    var bars = [], i = 0;
    for (d = a; d <= b && d <= today; d = addDays(d, 1), i++) {
      var v = map[d];
      if (v == null || v <= 0) continue;
      var h = Math.max(1.5, v / ceil * (H - 2));
      bars.push('<rect x="' + i + '" y="' + (H - h).toFixed(1) + '" width="1" height="' + h.toFixed(1) + '"><title>' + dLong(d) + ': ' + inch(v) + ' in</title></rect>');
    }
    var ticks = M3.map(function (m, k) {
      var x = Math.round((day(year + '-' + pad(k + 1) + '-01') - day(a)) / 864e5);
      return '<line x1="' + x + '" x2="' + x + '" y1="0" y2="' + H + '" class="g"/><text x="' + (x + 2) + '" y="' + (H + 11) + '">' + m.charAt(0) + '</text>';
    }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + (H + 14) + '" preserveAspectRatio="none" role="img" aria-label="Daily rain in ' + year + ', PRISM estimate, tallest bar ' + inch(top) + ' in; the table below has every day">' +
      ticks + '<line x1="0" x2="' + W + '" y1="' + H + '" y2="' + H + '" class="b"/>' + bars.join('') + '</svg><p class="fr-ax">Scale 0 to ' + ceil + ' in a day. ' + n + ' days shown.</p>';
  }

  /* ---------- the page ---------- */
  function boot(w) {
    var d = w.document, $ = function (id) { return d.getElementById(id); };
    var app = $('fr-app');
    if (!app) return;
    var R = w.AgRadarRain, P = w.AgPRISM;
    var S = { list: [], idx: null, files: {}, prism: {}, towns: {}, shard: {}, link: null, open: null, year: null, edit: null, map: null };
    function lsGet() { try { return w.localStorage.getItem(KEY); } catch (e) { return null; } }
    function lsSet(list) { try { w.localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} }
    function gSave(g) { S.gauge = g; try { w.localStorage.setItem(GKEY, JSON.stringify(g)); } catch (e) {} }
    try { S.gauge = readGauge(w.localStorage.getItem(GKEY)); } catch (e) { S.gauge = {}; }
    function today() { var t = new Date(); return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()); }
    function getJSON(u, ms) {
      return Promise.race([fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }),
        new Promise(function (_, no) { setTimeout(function () { no(new Error('timeout')); }, ms || 12000); })]);
    }
    function index() { if (!S.idxP) S.idxP = getJSON('/data/radar-rain/index.json').then(function (j) { S.idx = j; return j; }, function (e) { S.idxP = null; throw e; }); return S.idxP; }
    function radarFile(st) {
      if (!S.files[st]) S.files[st] = fetch('/data/radar-rain/' + st.toLowerCase() + '.bin').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
        .then(R.parse).catch(function (e) { delete S.files[st]; throw e; });
      return S.files[st];
    }
    function radarFor(f) {
      return index().then(function (idx) {
        var st = R.pickState(idx, f.lat, f.lon);
        if (!st) { var e = new Error('outside'); e.outside = true; throw e; }
        return radarFile(st);
      });
    }
    function prismFor(f) {
      var k = f.lat.toFixed(4) + ',' + f.lon.toFixed(4);
      if (!S.prism[k]) {
        var t = today(), y = +t.slice(0, 4) - 1;
        S.prism[k] = (P ? P.daily(f.lat, f.lon, y + '-01-01', t, { elems: ['pcpn'] }) : Promise.reject(new Error('no prism')))
          .then(function (x) { return { map: dayMap(x.daily), at: new Date().toISOString() }; })
          .catch(function (e) { delete S.prism[k]; return { failed: true, at: new Date().toISOString() }; });
      }
      return S.prism[k];
    }
    function shard(z) { if (!S.shard[z]) S.shard[z] = getJSON('/data/places/zip/' + z + '.json').catch(function () { return {}; }); return S.shard[z]; }
    function townFor(f) {
      var k = f.lat.toFixed(4) + ',' + f.lon.toFixed(4);
      if (!S.towns[k]) S.towns[k] = index().then(function (idx) { return Promise.all(shardsFor(statesAt(idx, f.lat, f.lon)).map(shard)); })
        .then(function (ts) { return nearestTown(ts, f.lat, f.lon); }).catch(function () { return null; });
      return S.towns[k];
    }

    /* one card; skeleton first (same rows, same lines), then filled in place */
    function card(f, i, linked) {
      var nrow = okDate(f.p) && f.p <= today() ? 5 : 4;
      var body = '', cell = '<div class="fr-v" role="cell"><b>&nbsp;</b><small>&nbsp;</small><small>&nbsp;</small></div>';
      for (var k = 0; k < nrow; k++) body += '<div class="fr-r" role="row"><div class="fr-pl" role="rowheader">&nbsp;</div>' + cell + cell + '</div>';
      return '<article class="fr-card" id="fr-c' + i + '" data-i="' + i + '"' + (linked ? ' data-linked="1"' : '') + '>' +
        '<h2 class="fr-n">' + esc(f.n) + '</h2>' +
        '<p class="fr-where">' + (+f.lat).toFixed(4) + ', ' + (+f.lon).toFixed(4) + ' &middot; <span class="fr-town">finding the nearest town</span></p>' +
        '<p class="fr-big"><b>&nbsp;</b> <span>reading the radar file</span></p>' +
        '<div class="fr-t" role="table" aria-label="Rain at ' + esc(f.n) + '"><div class="fr-r fr-hd" role="row"><div class="fr-pl" role="columnheader">Period</div><div class="fr-v" role="columnheader">This year</div><div class="fr-v" role="columnheader">Same days last year</div></div>' + body + '</div>' +
        '<p class="fr-gauge">&nbsp;</p><p class="fr-mine">&nbsp;</p>' +
        '<p class="fr-fresh fr-fm">&nbsp;</p><p class="fr-fresh fr-fp">&nbsp;</p>' +
        '<p class="fr-cells">&nbsp;</p>' +
        '<p class="fr-act">' + (linked ? '' : '<a class="fr-hl" href="' + esc(linkFor(f)) + '">History and CSV</a>') +
        (linked ? '<button type="button" data-act="save">Save this field</button>' : '') + '<button type="button" data-act="gauge" aria-expanded="false">My gauge</button>' +
        (linked ? '' : '<button type="button" data-act="move">Move</button><button type="button" data-act="rename">Rename</button><button type="button" data-act="remove">Remove</button>') + '</p>' +
        '<form class="fr-gform" hidden><label>Morning you read it <input type="date" name="d" value="' + today() + '" max="' + today() + '" required></label>' +
        '<label>Inches in your gauge <input name="v" inputmode="decimal" placeholder="0.45" required></label>' +
        '<button type="submit" class="fr-btn go">Keep this reading</button><button type="button" class="fr-btn" data-act="gdel">Delete that morning\'s reading</button></form>' +
        '</article>';
    }
    function fill(el, f) {
      var t = today();
      Promise.all([radarFor(f).then(function (x) { return x; }, function (e) { return { err: e }; }), prismFor(f), townFor(f)]).then(function (r) {
        if (!el.isConnected) return;
        var rad = r[0] && !r[0].err ? r[0] : null, pr = r[1], town = r[2];
        var rs = rows(f, { radar: rad, prism: pr.failed ? null : pr.map, today: t, lookup: R.lookup });
        el.querySelector('.fr-town').textContent = townLine(town);
        var big = el.querySelector('.fr-big'), w7 = rs[1].now;
        if (w7 && w7.v != null) big.innerHTML = '<b>' + inch(w7.v) + ' in</b> <span>in the last 7 days, ' + SRC.mrms + '</span>';
        else if (r[0] && r[0].err && r[0].err.outside) big.innerHTML = '<b>&ndash;</b> <span>NOAA MRMS covers the lower 48 states; this spot is outside it</span>';
        else big.innerHTML = '<b>&ndash;</b> <span>' + (rad ? 'the radar has a gap at this spot' : 'the radar file did not load') + '</span>';
        var trs = el.querySelectorAll('.fr-r:not(.fr-hd)');
        rs.forEach(function (row, k) {
          var tr = trs[k]; if (!tr) return;
          tr.innerHTML = '<div class="fr-pl" role="rowheader">' + esc(row.label) + '</div>' + cellHtml(cellText(row.now)) + cellHtml(row.last ? cellText(row.last) : null);
        });
        /* the nearest gauge beside the radar */
        var gEl = el.querySelector('.fr-gauge'), near = rad ? R.nearestGauge(rad.header, f.lat, f.lon, GAUGE_MI) : null;
        if (near) {
          var g = near.g, wk = R.gaugeWeek(g, 7), mi = near.mi < 1 ? 'under a mile' : Math.round(near.mi) + ' mi';
          var k2 = g.dates.length - 1, lastG = g.gauge[k2];
          var s = 'Nearest gauge: ' + esc(g.name) + ' (' + (NET[g.net] || 'gauge') + ', ' + esc(g.county) + ', ' + mi + ' away). ';
          if (wk) s += 'Its 7 reported days ' + dd(wk.from, wk.to) + ' (each to the morning reading): <b>' + inch(wk.gauge / 100) + ' in</b>; radar at that gauge, same days: ' + inch(wk.radar / 100) + ' in.';
          else if (lastG != null) s += 'Newest report: <b>' + inch(lastG / 100) + ' in</b> for the day ending the morning of ' + dShort(g.dates[k2]) + '.';
          else s += 'No clean recent report to show.';
          gEl.innerHTML = s;
        } else gEl.textContent = rad ? 'No county gauge we track within ' + GAUGE_MI + ' miles.' : 'Gauge readings come with the radar file.';
        /* both times for each source */
        var fm = el.querySelector('.fr-fm'), fp = el.querySelector('.fr-fp');
        if (rad) {
          var h = rad.header, age = (Date.now() - Date.parse(h.data_end)) / 3600e3;
          fm.innerHTML = '<b>Radar (NOAA MRMS, Pass 2):</b> rain through ' + esc(when(h.data_end)) + '; data received ' + (h.made ? esc(when(h.made)) : 'time not stamped in this file') + '.' +
            (age >= STALE_H ? ' <strong class="fr-old">Old: ' + Math.round(age) + ' hours since the newest radar hour; rain since then is not counted.</strong>' : '');
        } else fm.innerHTML = '<b>Radar (NOAA MRMS):</b> ' + (r[0].err && r[0].err.outside ? 'no coverage here.' : 'our radar file did not load at ' + esc(when(new Date().toISOString())) + '.');
        if (pr.failed) fp.innerHTML = '<b>PRISM:</b> not answering (RCC-ACIS, tried ' + esc(when(pr.at)) + '); the radar rows still show.';
        else {
          var L = lastDay(pr.map, t);
          fp.innerHTML = '<b>PRISM:</b> rain through ' + (L ? 'the day ending the morning of ' + dLong(L) : 'no day posted yet') + '; data received ' + esc(when(pr.at)) + ' (read by this browser).';
        }
        var cells = 'Grid cells read: ';
        var mc = rad ? mrmsCell(rad.header, f.lat, f.lon) : null, pc = prismCell(f.lat, f.lon);
        cells += mc ? 'radar cell centered ' + mc.lat.toFixed(2) + ', ' + mc.lon.toFixed(2) + ' (' + mc.ew + ' by ' + mc.ns + ' mi)' : 'radar cell none';
        cells += '; PRISM 4 km cell centered ' + pc.lat.toFixed(3) + ', ' + pc.lon.toFixed(3) + '.';
        el.querySelector('.fr-cells').textContent = cells;
        el._pr = pr;
        el.querySelector('.fr-mine').textContent = mineLine(mine(S.gauge[gaugeKey(f)], pr.failed ? null : pr.map));
        if (S.open && S.open.f === f) history(f, pr);
      });
    }

    function draw() {
      var lk = S.link, list = S.list, html = '';
      /* a field link shows that one field and its history; the bare page shows every saved field */
      var hit = -1;
      if (lk) list.forEach(function (f, i) { if (hit < 0 && same(f, lk)) hit = i; });
      if (lk) html = hit >= 0 ? card(list[hit], hit, false) : card(lk, 'L', true);
      else list.forEach(function (f, i) { html += card(f, i, false); });
      app.innerHTML = html || '<p class="fr-empty">No fields saved on this device yet. Add one below: a ZIP, a point pasted from a map, or your location.</p>';
      $('fr-count').innerHTML = lk ? (list.length ? '<a href="/field-rain">All ' + list.length + ' of your saved fields</a>' : '') :
        (list.length ? list.length + ' of ' + MAX + ' fields saved on this device' : '');
      S.open = lk ? { f: hit >= 0 ? list[hit] : lk } : null;
      $('fr-hist').hidden = !lk;
      if (lk) $('fr-htitle').textContent = S.open.f.n + ': every day of rain, PRISM estimate';
      if (lk) fill($('fr-c' + (hit >= 0 ? hit : 'L')), S.open.f);
      else list.forEach(function (f, i) { var el = $('fr-c' + i); if (el) fill(el, f); });
    }

    /* the history panel (link mode): chart, month totals, every day, the CSV */
    function history(f, pr) {
      var box = $('fr-hist'), t = today();
      if (!S.year) S.year = +t.slice(0, 4);
      if (pr.failed) { box.querySelector('.fr-hbody').innerHTML = '<p class="fr-err">PRISM did not answer just now, so the daily history cannot be drawn. Reload in a minute; the link keeps the field.</p>'; return; }
      var map = pr.map, y = S.year, rowsD = dailyRows(map, t).filter(function (r) { return +r.date.slice(0, 4) === y; });
      var mt = monthTotals(map, y, t);
      var h = '<div class="fr-yr" role="group" aria-label="Year">' + [+t.slice(0, 4), +t.slice(0, 4) - 1].map(function (yy) {
        return '<button type="button" data-yr="' + yy + '" aria-pressed="' + (yy === y) + '">' + yy + '</button>'; }).join('') + '</div>' +
        '<div class="fr-chart">' + chart(map, y, t) + '</div>' +
        '<table class="fr-mt"><thead><tr><th scope="col">Month</th><th scope="col">Rain, PRISM estimate</th></tr></thead><tbody>' +
        mt.map(function (m) { return '<tr><th scope="row">' + m.m + ' ' + y + '</th><td>' + (m.v == null ? m.miss + ' days missing' : inch(m.v) + ' in') + (m.pre && m.v != null ? '<sup class="fr-p">P</sup>' : '') + '</td></tr>'; }).join('') +
        '</tbody></table>' +
        '<details class="fr-days"><summary>Every day of ' + y + ' (' + rowsD.length + ' days)</summary><table class="fr-dt"><thead><tr><th scope="col">Date</th><th scope="col">Rain (in)</th><th scope="col">Status</th><th scope="col">Your gauge (in)</th></tr></thead><tbody>' +
        rowsD.map(function (r) { return '<tr><td>' + r.date + '</td><td>' + (r.v == null ? '' : inch(r.v)) + '</td><td>' + (r.v == null ? 'missing' : r.pre ? 'preliminary' : 'settled') + '</td><td>' + (r.g == null ? '' : inch(r.g)) + '</td></tr>'; }).join('') +
        '</tbody></table></details>';
      box.querySelector('.fr-hbody').innerHTML = h;
      S.csv = { f: f, text: csv(f, map, t, when(pr.at), S.gauge[gaugeKey(f)]) };
    }

    function save(list) { S.list = list; lsSet(list); draw(); }
    function msg(t, err) { var m = $('fr-msg'); m.textContent = t || ''; m.className = 'fr-msg' + (err ? ' err' : ''); }
    function zipPoint(z) {
      return getJSON('/data/places/zip/' + z.slice(0, 2) + '.json').then(function (t) {
        var p = t && t[z];
        if (Array.isArray(p) && isFinite(+p[0]) && isFinite(+p[1]) && !(+p[0] === 0 && +p[1] === 0)) return { lat: +p[0], lon: +p[1], town: p[2] };
        throw new Error('ZIP ' + z + ' is not in our table. Check it, or paste a point from a map.');
      });
    }
    function placeFrom(text) {
      var p = parsePlace(text);
      if (!p) return Promise.reject(new Error('Enter a 5-digit ZIP, or a point like 42.0308, -93.6319.'));
      return p.zip ? zipPoint(p.zip) : Promise.resolve(p);
    }
    function submit(e) {
      e.preventDefault();
      var name = $('fr-name').value, where = $('fr-where').value, plant = $('fr-plant').value || null;
      placeFrom(where).then(function (p) {
        if (S.edit) {
          var was = S.list.filter(function (x) { return x.id === S.edit; })[0], next = edit(S.list, S.edit, { n: name, lat: p.lat, lon: p.lon, p: plant });
          var now = next.filter(function (x) { return x.id === S.edit; })[0];
          if (was && now) gSave(moveReadings(S.gauge, gaugeKey(was), gaugeKey(now)));   // a moved pin keeps its gauge readings
          save(next);
        }
        else save(add(S.list, { n: name || (p.town ? 'Near ' + p.town : ''), lat: p.lat, lon: p.lon, p: plant }));
        closeForm(); msg(S.edit ? 'Moved.' : 'Saved on this device.');
      }).catch(function (er) { msg(er.message, true); });
    }
    function openForm(f) {
      S.edit = f ? f.id : null;
      $('fr-name').value = f ? f.n : '';
      $('fr-where').value = f ? f.lat.toFixed(4) + ', ' + f.lon.toFixed(4) : '';
      $('fr-plant').value = f && f.p ? f.p : '';
      $('fr-go').textContent = f ? 'Save changes' : 'Save this field';
      $('fr-form').setAttribute('data-mode', f ? 'edit' : 'add');
      $('fr-legend').textContent = f ? 'Move or rename ' + f.n : 'Add a field';
      $('fr-form').scrollIntoView({ block: 'nearest' });
      $('fr-where').focus();
    }
    function closeForm() { S.edit = null; $('fr-form').reset(); $('fr-go').textContent = 'Save this field'; $('fr-legend').textContent = 'Add a field'; $('fr-form').setAttribute('data-mode', 'add'); }

    /* a small map to set the point by tapping (Leaflet and its style load on the first tap of "Pick on a map") */
    function loadMapLib() {
      if (w.L) return Promise.resolve(w.L);
      if (!S.libP) S.libP = new Promise(function (ok, no) {
        var c = d.createElement('link'); c.rel = 'stylesheet'; c.href = '/vendor/leaflet-1.9.4/leaflet.css'; d.head.appendChild(c);
        var s = d.createElement('script'); s.src = '/vendor/leaflet-1.9.4/leaflet.js'; s.onload = function () { w.L ? ok(w.L) : no(new Error('map')); };
        s.onerror = function () { S.libP = null; no(new Error('map')); }; d.head.appendChild(s);
      });
      return S.libP;
    }
    function pickOnMap() {
      var box = $('fr-map'), cur = parsePlace($('fr-where').value);
      var start = cur && cur.lat ? cur : (S.list[0] || S.link || { lat: 41.9, lon: -93.4 });
      box.hidden = false;
      loadMapLib().then(function (L) {
        if (!S.map) {
          S.map = L.map(box, { scrollWheelZoom: false, maxZoom: 16 }).setView([start.lat, start.lon], 13);
          L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 16, maxZoom: 16, attribution: 'Map: USGS' }).addTo(S.map);
          S.pin = L.circleMarker([start.lat, start.lon], { radius: 8, color: '#111', weight: 2, fillColor: '#ffd23f', fillOpacity: 1 }).addTo(S.map);
          S.map.on('click', function (ev) {
            S.pin.setLatLng(ev.latlng);
            $('fr-where').value = ev.latlng.lat.toFixed(4) + ', ' + ev.latlng.lng.toFixed(4);
            msg('Point set. Save to keep it.');
          });
        } else { S.map.setView([start.lat, start.lon], 13); S.pin.setLatLng([start.lat, start.lon]); S.map.invalidateSize(); }
      }).catch(function () { box.hidden = true; msg('The map did not load. Paste a point or enter a ZIP instead.', true); });
    }

    S.list = readList(lsGet());
    S.link = parseLink(w.location.hash, w.location.search);
    draw();

    $('fr-form').addEventListener('submit', submit);
    $('fr-cancel').addEventListener('click', function () { closeForm(); msg(''); });
    $('fr-pick').addEventListener('click', pickOnMap);
    $('fr-geo').addEventListener('click', function () {
      if (!w.navigator.geolocation) { msg('This browser cannot share a location. Enter a ZIP or paste a point.', true); return; }
      msg('Waiting for your location...');
      w.navigator.geolocation.getCurrentPosition(function (p) {
        $('fr-where').value = p.coords.latitude.toFixed(4) + ', ' + p.coords.longitude.toFixed(4);
        msg('Location filled in. Save to keep it; this stays on your device.');
      }, function () { msg('No location came through. Enter a ZIP or paste a point.', true); }, { timeout: 9000, maximumAge: 600000 });
    });
    app.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-act]') : null;
      if (!b) return;
      var c = b.closest('.fr-card'), i = c.getAttribute('data-i'), f = i === 'L' ? S.link : S.list[+i], act = b.getAttribute('data-act');
      if (!f) return;
      try {
        if (act === 'save') { save(add(S.list, f)); msg('Saved on this device.'); }
        else if (act === 'remove') { if (w.confirm('Remove ' + f.n + ' from this device? Its link still works.')) save(remove(S.list, f.id)); }
        else if (act === 'rename') { var n = w.prompt('New name for ' + f.n, f.n); if (n != null) save(edit(S.list, f.id, { n: n })); }
        else if (act === 'move') openForm(f);
        else if (act === 'gauge') {
          var gf = c.querySelector('.fr-gform'), open = gf.hidden;
          gf.hidden = !open; b.setAttribute('aria-expanded', String(open));
          if (open) gf.querySelector('[name="v"]').focus();
        } else if (act === 'gdel') {
          gSave(putReading(S.gauge, gaugeKey(f), c.querySelector('[name="d"]').value, null, today()));
          refreshMine(c, f); msg('Reading deleted.');
        }
      } catch (er) { msg(er.message, true); }
    });
    function refreshMine(c, f) {
      var pr = c._pr;
      c.querySelector('.fr-mine').textContent = mineLine(mine(S.gauge[gaugeKey(f)], pr && !pr.failed ? pr.map : null));
      if (S.open && S.open.f === f && pr) history(f, pr);
    }
    app.addEventListener('submit', function (e) {
      var gf = e.target.closest ? e.target.closest('.fr-gform') : null;
      if (!gf) return;
      e.preventDefault();
      var c = gf.closest('.fr-card'), i = c.getAttribute('data-i'), f = i === 'L' ? S.link : S.list[+i];
      if (!f) return;
      try {
        gSave(putReading(S.gauge, gaugeKey(f), gf.querySelector('[name="d"]').value, String(gf.querySelector('[name="v"]').value).trim(), today()));
        refreshMine(c, f);
        gf.querySelector('[name="v"]').value = '';
        msg('Reading kept on this device. It is in this field\'s CSV too.');
      } catch (er) { msg(er.message, true); }
    });
    var hist = $('fr-hist');
    hist.addEventListener('click', function (e) {
      var y = e.target.closest ? e.target.closest('[data-yr]') : null;
      if (y && S.open) { S.year = +y.getAttribute('data-yr'); prismFor(S.open.f).then(function (pr) { history(S.open.f, pr); }); return; }
      var a = e.target.closest ? e.target.closest('[data-h]') : null;
      if (!a || !S.open) return;
      if (a.getAttribute('data-h') === 'csv' && S.csv) {
        var blob = new Blob([S.csv.text], { type: 'text/csv' }), u = URL.createObjectURL(blob), x = d.createElement('a');
        x.href = u; x.download = 'rain-' + (cleanName(S.csv.f.n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'field') + '.csv';
        d.body.appendChild(x); x.click(); setTimeout(function () { URL.revokeObjectURL(u); x.remove(); }, 500);
      }
      if (a.getAttribute('data-h') === 'copy') {
        var link = linkFor(S.open.f, w.location.origin);
        var done = function () { msg('Link copied. It opens this field with its history on any device.'); };
        if (w.navigator.clipboard) w.navigator.clipboard.writeText(link).then(done, function () { w.prompt('Copy this link', link); });
        else w.prompt('Copy this link', link);
      }
    });
    w.addEventListener('hashchange', function () { S.link = parseLink(w.location.hash, w.location.search); S.year = null; draw(); });
  }

  return { MAX: MAX, KEY: KEY, SRC: SRC, ZSH: ZSH, parseLink: parseLink, linkFor: linkFor, readList: readList, add: add, edit: edit, remove: remove,
           parsePlace: parsePlace, mrmsCell: mrmsCell, prismCell: prismCell, statesAt: statesAt, shardsFor: shardsFor, nearestTown: nearestTown,
           townLine: townLine, dayMap: dayMap, lastDay: lastDay, prelimDay: prelimDay, sum: sum, rows: rows, cellText: cellText, cellHtml: cellHtml, radarSpan: radarSpan,
           dailyRows: dailyRows, csv: csv, GKEY: GKEY, gaugeKey: gaugeKey, readGauge: readGauge, putReading: putReading, moveReadings: moveReadings, mine: mine, mineLine: mineLine, monthTotals: monthTotals, chart: chart, yearBack: yearBack, centralDate: centralDate, when: when, boot: boot };
});
