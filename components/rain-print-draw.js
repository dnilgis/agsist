/* components/rain-print-draw.js: "Watch your year draw" (Sig, 2026-10-20).
 *
 * The reader's own Rain Print draws itself day by day, on the page (in place,
 * over the print) and as a video file to post or text: square 1080 x 1080 or
 * tall 1080 x 1920 for stories. Used by /rain-print (the reader's design and
 * any ?d= or /r? link view, through RainPrint.drawInput) and by every county
 * rain page's print (components/rain-county-print.js), loaded only on a tap.
 *
 * HONEST BY CONSTRUCTION. Nothing here draws the year a second way. The art
 * (components/rain-print-art.js) draws the finished print once, from the same
 * input the page just drew; this file splits that one SVG into its own layers
 * (data-rp groups) and reveals them in date order:
 *   from the start   the paper, the axis, the scale
 *   day by day       the line or bars, the usual-year band, crop, ribbon:
 *                    a wipe to the right edge of the last day drawn
 *   on its date      each marked day, remarkable day, frost and the biggest
 *                    rain, the day it happened (never before)
 *   month by month   month totals and normals, once that month is over
 *   at the end       the totals, the verdict, the name, the foot, the QR
 * so the last frame IS the print (test/rain-print-draw.test.mjs compares the
 * pixels). The ticker's dates are the days' own dates and its running total is
 * the art's own running total (AgRainArt.model: a missing day adds nothing).
 * The usual year, when it is on, shows faintly ahead of the line: it is the
 * same 30-year line the print shows, known before the year starts.
 *
 * Two things only the video shows, both from data with its source on screen,
 * both gone from the last frame so it stays the print:
 *   hail     our own hail records near the town (US only): NOAA NCEI Storm
 *            Events 1955 to 2020 and NWS storm reports 2022 on (reported hail
 *            within HAIL_MI miles), and NOAA MRMS radar-estimated hail (MESH)
 *            where our archive has that day; nothing for 2021 or before 1955
 *   wind     optional, off by default: each day's highest gust, MODELED
 *            (ERA5 reanalysis through Open-Meteo's archive), labeled so
 *
 * EXPORT. MediaRecorder on a canvas, H.264 MP4 where the browser offers it
 * (Safari, Chrome 126 and later), WebM otherwise; no sound; about 2.5 to 4 Mb/s
 * so a 16 s video stays near 5 MB, under 8 MB. A phone gets "Share video"
 * (the Web Share API with the file) and "Save video"; a computer saves it. A
 * browser that cannot record says so and offers the finished picture instead.
 * Recording runs at real speed, so the page must stay open while it records.
 *
 * PERFORMANCE. The SVG is rasterized once per layer (about a dozen images,
 * done in steps between frames); a frame is then a few drawImage calls and
 * some text, well under 4 ms on a mid-range phone, on the main thread. A
 * worker (OffscreenCanvas) would add a copy of the art for little gain, and
 * captureStream needs a page canvas anyway.
 *
 * Reduced motion: the on-screen version is four still steps (a quarter, half,
 * three quarters, the whole year). The file is the full one, for other people.
 *
 * Analytics: rain_print_video {action: play|replay|export|share|save|still|fail, format, style, from}.
 * No place, name or design code goes to Analytics.
 *
 * The pure parts (plan, ticker, events, hail and wind matching, file naming)
 * run without a document, for the tests.
 */
(function (root) {
  'use strict';

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // FR-REVIEW: the few French words in the video (Canadian prints in French)
  var MON_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juill.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  var HAIL_MI = 10;               // reported hail this close to the town, in miles
  var GUST_MARK = 50;             // a modeled gust this strong (mph) gets a mark on its day
  var FORMATS = {
    square: { w: 1080, h: 1080, label: 'Square, for posts', bps: 2200000 },
    tall: { w: 1080, h: 1920, label: 'Tall, for stories', bps: 2800000 }
  };
  // seconds: lead-in, base drawing time, the finish, the last hold; each kind of day's pause
  var T = { intro: 1.1, draw: 10.6, outro: 1.5, hold: 2.6, min: 12, max: 20 };
  var HOLD = { wet: 0.8, mark: 0.55, rec: 0.3, frost: 0.25, dry: 0.25, hail: 0.4, wind: 0.4 };
  var HOLDS_MAX = 4.2;            // all the pauses together
  var EASE_K = 0.3;               // a gentle start and finish to the day rate (0 = even)

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }
  function ease(u) { return u - EASE_K * Math.sin(2 * Math.PI * u) / (2 * Math.PI); }
  function easeInv(p) { var a = 0, b = 1; for (var k = 0; k < 40; k++) { var m = (a + b) / 2; if (ease(m) < p) a = m; else b = m; } return (a + b) / 2; }

  /* THE SCHEDULE. o = {n: days drawn, events: [{i (day index), kind}]}.
     d(t) is how many days are drawn at time t (a float, 0 to n): the line has
     reached the right edge of day floor(d). An event's day is fully drawn the
     moment d = i + 1, and the video pauses there for that kind's HOLD. */
  function plan(o) {
    var n = Math.max(1, o.n | 0), byDay = {};
    (o.events || []).forEach(function (e) {
      if (!(e.i >= 0 && e.i < n) || !HOLD[e.kind]) return;
      byDay[e.i] = Math.max(byDay[e.i] || 0, HOLD[e.kind]);
    });
    var stops = Object.keys(byDay).map(Number).sort(function (a, b) { return a - b; }).map(function (i) { return { i: i, len: byDay[i] }; });
    var holds = stops.reduce(function (s, h) { return s + h.len; }, 0);
    if (holds > HOLDS_MAX) { var f = HOLDS_MAX / holds; stops.forEach(function (h) { h.len *= f; }); holds = HOLDS_MAX; }
    var B = T.draw, fixed = T.intro + T.outro + T.hold;
    if (fixed + B + holds > T.max) B = Math.max(7, T.max - fixed - holds);
    if (fixed + B + holds < T.min) B = T.min - fixed - holds;
    // each stop's base time (the drawing clock without the pauses)
    stops.forEach(function (h) { h.s = B * easeInv((h.i + 1) / n); });
    var t0 = T.intro, t1 = t0 + B + holds, total = t1 + T.outro + T.hold;
    function dayAt(t) {
      if (t <= t0) return 0;
      if (t >= t1) return n;
      var s = t - t0;
      for (var k = 0; k < stops.length; k++) {
        var h = stops[k];
        if (s <= h.s) break;
        if (s <= h.s + h.len) return h.i + 1;
        s -= h.len;
      }
      return clamp(n * ease(clamp(s / B, 0, 1)), 0, n);
    }
    // the first moment day i is fully drawn
    function timeOf(i) {
      var p = clamp((i + 1) / n, 0, 1), s = B * easeInv(p), t = t0 + s;
      stops.forEach(function (h) { if (h.i < i) t += h.len; });
      return Math.min(t, t1);
    }
    return { n: n, t0: t0, t1: t1, outro: t1 + T.outro, total: total, base: B, stops: stops, dayAt: dayAt, timeOf: timeOf };
  }
  /* Reduced motion: four still steps, each held, then the finished print. */
  function stepsPlan(n) {
    var hold = 1.5, at = [0.25, 0.5, 0.75, 1].map(function (f) { return Math.round(n * f); });
    return { n: n, t0: 0, t1: hold * 3, outro: hold * 3 + 0.01, total: hold * 4 + 1.2, steps: at, base: 0, stops: [],
      dayAt: function (t) { return at[clamp(Math.floor(t / hold), 0, 3)]; },
      timeOf: function (i) { for (var k = 0; k < 4; k++) if (at[k] >= i + 1) return k * hold; return hold * 3; } };
  }

  // the last day the line has touched, for d days drawn (0 before it starts)
  function dayIdx(d, n) { return d <= 0 ? 0 : clamp(Math.ceil(d - 1e-9) - 1, 0, n - 1); }
  function runTotal(E, k) { for (var j = k; j >= 0; j--) if (E.cum[j] !== null && E.cum[j] !== undefined) return E.cum[j]; return 0; }

  function fmtDate(iso, fr) { var p = String(iso).split('-').map(Number); return fr ? (p[2] === 1 ? '1er' : p[2]) + ' ' + MON_FR[p[1] - 1] : MON[p[1] - 1] + ' ' + p[2]; }
  function amt(inches, loc, kind) {
    if (loc && loc.units === 'mm') {
      var mm = inches * 25.4, s = kind === 'day' ? mm.toFixed(1) : String(Math.round(mm));
      return (loc.lang === 'fr' ? s.replace('.', ',') : s) + ' mm';
    }
    return inches.toFixed(2) + ' in';
  }
  function snowAmt(inches, loc) {
    if (loc && loc.units === 'mm') { var s = (inches * 2.54).toFixed(0); return s + ' cm'; }
    return inches.toFixed(1) + ' in';
  }
  /* What the ticker says at d days drawn. E: AgRainArt.model(input). The date is
     the day's own date; the total is the print's own running total through it. */
  function ticker(E, d, loc) {
    var n = E.n, k = dayIdx(d, n), x = E.days[k] || {}, fr = !!(loc && loc.lang === 'fr');
    var p = E.P[k], w;
    if (d <= 0) w = '';
    else if (p === null) w = x.flag === 'S' ? (fr ? 'compté plus tard' : 'counted with a later day') : (fr ? 'aucun relevé' : 'no report');
    else if (E.full && x.s > 0) w = (fr ? 'neige ' : 'snow ') + snowAmt(x.s, loc) + (p > 0 ? ' (' + amt(p, loc, 'day') + (fr ? ' d’eau)' : ' melted)') : '');
    else if (p > 0) w = (fr ? 'pluie ' : 'rain ') + amt(p, loc, 'day');
    else if (x.flag === 'T') w = fr ? 'trace' : 'a trace';
    else w = fr ? 'sec' : 'dry';
    return { k: k, date: x.date || '', dateText: x.date ? fmtDate(x.date, fr) : '', total: d <= 0 ? 0 : runTotal(E, k), totalText: amt(d <= 0 ? 0 : runTotal(E, k), loc, 'tot'),
      kind: d <= 0 ? '' : p === null ? 'gap' : E.full && x.s > 0 ? 'snow' : p > 0 ? 'rain' : 'dry', words: w };
  }

  /* The days the video pauses on, with what it says, from the print's own
     model and the groups the art drew. groups: the data-rp keys in the SVG. */
  function events(I, E, opts) {
    opts = opts || {};
    var A = root.AgRainArt, out = [], fr = !!(I.loc && I.loc.lang === 'fr'), keys = opts.groups || [];
    var has = function (k) { return !keys.length || keys.indexOf(k) >= 0; };
    var F = A && A.facts ? A.facts(I, { unplaced: opts.unplaced || [] }) : null;
    if (E.wi >= 0 && E.wet && has('wet')) out.push({ i: E.wi, kind: 'wet', key: 'wet', text: F && F.wet ? F.wet.label + ': ' + F.wet.amount + ', ' + F.wet.dateText : '' });
    (E.markers || []).forEach(function (mk, k) {
      if (!has('mark:' + k)) return;
      var dt = E.days[mk.i] && E.days[mk.i].date;
      var words = String(mk.words || mk.label || '').replace(/\u0001[^\u0002]*\u0002/g, '').replace(/[\u0001\u0002]/g, '').trim();
      out.push({ i: mk.i, kind: 'mark', key: 'mark:' + k, text: (words && words !== fmtDate(dt || '', fr) ? words + ', ' : '') + (dt ? fmtDate(dt, fr) : '') });
    });
    if (A && A.recordPoints) A.recordPoints(E, I.records).pts.forEach(function (r, k) {
      if (has('rec:' + k)) out.push({ i: r.b === undefined ? r.i : Math.max(r.i, r.b), kind: 'rec', key: 'rec:' + k, text: String(r.text || r.label).replace(/[\u0001\u0002]/g, ' ').replace(/\s+/g, ' ').trim() });
    });
    ((I.temp && I.temp.frost) || []).forEach(function (f, k) { if (f.doy >= 0 && has('frost:' + k)) out.push({ i: f.doy, kind: 'frost', key: 'frost:' + k, text: '' }); });
    if (E.dry && keys.indexOf('dry') >= 0) out.push({ i: E.dry.e, kind: 'dry', key: 'dry', text: '' });
    (opts.hail || []).forEach(function (h) { out.push({ i: h.i, kind: 'hail', key: '', text: hailWords(h, fr), anim: true, data: h }); });
    if (opts.wind && opts.wind.top) out.push({ i: opts.wind.top.i, kind: 'wind', key: '', text: windWords(opts.wind.top, fr), anim: true, data: opts.wind.top });
    return out.filter(function (e) { return e.i >= 0 && e.i < E.n; }).sort(function (a, b) { return a.i - b.i; });
  }

  // ---------- hail near the town (our own data, /hail-map) ----------
  function milesBetween(a, b, c, d) {
    var R = 3958.8, t = function (x) { return x * Math.PI / 180; };
    var h = Math.pow(Math.sin(t(c - a) / 2), 2) + Math.cos(t(a)) * Math.cos(t(c)) * Math.pow(Math.sin(t(d - b) / 2), 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function hailWords(h, fr) {
    var size = h.size > 0 ? (fr ? ', ' + String(h.size.toFixed(2)).replace('.', ',') + ' po' : ', ' + h.size.toFixed(2) + ' in') : '';
    if (h.kind === 'radar') return fr ? 'Grêle estimée par radar' + size : 'Radar-estimated hail' + (h.size > 0 ? ' up to ' + h.size.toFixed(2) + ' in' : '');
    return (fr ? 'Grêle signalée à moins de ' + Math.max(1, Math.ceil(h.mi)) + ' mi' : 'Hail reported within ' + Math.max(1, Math.ceil(h.mi)) + ' mi') + size;
  }
  /* Which hail sources cover a year (null: none; the video then says so). */
  function hailCover(year, idx) {
    idx = idx || {};
    var nc = idx.ncei && idx.ncei.years ? idx.ncei : null, live = (idx.manifest && idx.manifest.years) || [];
    var out = [];
    if (nc && year >= nc.years[0] && year <= (nc.cutoff || nc.years[1])) out.push('ncei');
    if (live.indexOf(year) >= 0) out.push('nws');
    if (idx.mesh && idx.mesh.dates && idx.mesh.dates.some(function (d) { return d.slice(0, 4) === String(year); })) out.push('mesh');
    return out.length ? out : null;
  }
  // NCEI tiles: {e: [[yyyymmdd, size x100, lat x1e4, lon x1e4, "p"|"c"]]}; only reported points ("p")
  function hailFromNcei(tiles, lat, lon, year, days) {
    var byDate = dateIndex(days), out = [];
    tiles.forEach(function (t) {
      ((t && t.e) || []).forEach(function (r) {
        if (r[4] !== 'p' || Math.floor(r[0] / 10000) !== year) return;
        var iso = String(r[0]).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'), mi = milesBetween(lat, lon, r[2] / 1e4, r[3] / 1e4);
        if (mi <= HAIL_MI && byDate[iso] !== undefined) out.push({ i: byDate[iso], date: iso, size: r[1] / 100, mi: mi, kind: 'report', src: 'NOAA NCEI Storm Events' });
      });
    });
    return bestPerDay(out);
  }
  // NWS storm reports (data/hail/events-YYYY.json): {ev: [[lat, lon, size in, "MM-DD", st]]}
  function hailFromNws(j, lat, lon, year, days) {
    var byDate = dateIndex(days), out = [];
    ((j && j.ev) || []).forEach(function (r) {
      var mi = milesBetween(lat, lon, r[0], r[1]), iso = year + '-' + r[3];
      if (mi <= HAIL_MI && byDate[iso] !== undefined) out.push({ i: byDate[iso], date: iso, size: +r[2] || 0, mi: mi, kind: 'report', src: 'NWS storm reports' });
    });
    return bestPerDay(out);
  }
  function inRing(x, y, ring) {
    var c = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  // MRMS MESH day (data/hail/mesh/<date>.json, GeoJSON): the largest threshold whose swath covers the town
  function meshAt(gj, lat, lon) {
    var best = 0;
    ((gj && gj.features) || []).forEach(function (f) {
      var g = f.geometry || {}, th = +(f.properties || {}).thresh_in || 0, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      polys.forEach(function (p) {
        if (!p || !p[0] || !inRing(lon, lat, p[0])) return;
        for (var h = 1; h < p.length; h++) if (inRing(lon, lat, p[h])) return;
        if (th > best) best = th;
      });
    });
    return best;
  }
  function dateIndex(days) { var m = {}; (days || []).forEach(function (x, i) { if (x && x.date) m[x.date] = i; }); return m; }
  function bestPerDay(list) {
    var by = {};
    list.forEach(function (h) { var o = by[h.i]; if (!o || h.size > o.size || (h.size === o.size && h.mi < o.mi)) by[h.i] = h; });
    return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a.i - b.i; });
  }
  /* MESH days worth a look: wet days (a quarter inch or more that day or the
     next morning's reading) from May to September that our archive has. */
  function meshDays(days, dates) {
    var have = {}, out = [];
    (dates || []).forEach(function (d) { have[d] = true; });
    (days || []).forEach(function (x, i) {
      if (!x || !have[x.date] || x.m < 3 || x.m > 8) return;
      var nx = days[i + 1], v = (x.v || 0) + (nx && nx.v ? nx.v : 0);
      if (v >= 0.25) out.push(x.date);
    });
    return out.slice(0, 24);
  }

  // ---------- wind (optional, modeled) ----------
  function windWords(w, fr) { return (fr ? 'Rafales max. ' : 'Windiest day: gusts ') + Math.round(w.gust) + ' mph, ' + fmtDate(w.date, fr) + (fr ? ' (modèle)' : ' (modeled)'); }
  /* Open-Meteo archive answer -> {gust[], speed[], top, src}, aligned to the days.
     j = {daily: {time: [...], wind_gusts_10m_max: [...], wind_speed_10m_max: [...]}} in mph. */
  function windFrom(j, days) {
    var dl = j && j.daily, by = {}, gust = [], speed = [], top = null;
    if (!dl || !dl.time) return null;
    dl.time.forEach(function (t, k) { by[t] = k; });
    (days || []).forEach(function (x, i) {
      var k = by[x.date], g = k === undefined ? null : dl.wind_gusts_10m_max ? dl.wind_gusts_10m_max[k] : null, s = k === undefined ? null : dl.wind_speed_10m_max ? dl.wind_speed_10m_max[k] : null;
      gust.push(typeof g === 'number' ? g : null); speed.push(typeof s === 'number' ? s : null);
      if (typeof g === 'number' && (!top || g > top.gust)) top = { i: i, date: x.date, gust: g };
    });
    return gust.some(function (g) { return g !== null; }) ? { gust: gust, speed: speed, top: top, src: 'ERA5 reanalysis via Open-Meteo, modeled' } : null;
  }
  function windUrl(lat, lon, year, lastIso) {
    return 'https://archive-api.open-meteo.com/v1/archive?latitude=' + (+lat).toFixed(3) + '&longitude=' + (+lon).toFixed(3) +
      '&start_date=' + year + '-01-01&end_date=' + lastIso + '&daily=wind_gusts_10m_max,wind_speed_10m_max&wind_speed_unit=mph&timezone=auto';
  }

  function fileName(o, ext) {
    var s = ['rain-print', o.place || '', o.year || '', o.style || ''].join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return (s || 'rain-print') + '.' + ext;
  }
  // the recorder's type: H.264 MP4 first (posts everywhere), then WebM
  /* plain 'video/mp4' comes last: Chromium answers yes to it and writes VP9 inside, which an iPhone will not play */
  var MIMES = ['video/mp4;codecs=avc1.42E01F', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  function pickMime(isOk) { for (var i = 0; i < MIMES.length; i++) { try { if (isOk(MIMES[i])) return MIMES[i]; } catch (e) {} } return ''; }

  /* A WebM from MediaRecorder carries no duration, so some apps show 0:00 and
     will not seek. This writes one into the Segment's Info (the stream's own
     length), the way the recorder would if it knew. Returns new bytes, or the
     same ones when the layout is not the plain one Chrome writes. */
  function webmWithDuration(bytes, ms) {
    var u = bytes, readId = function (p) { var b = u[p], l = b & 0x80 ? 1 : b & 0x40 ? 2 : b & 0x20 ? 3 : b & 0x10 ? 4 : 0; return l ? { len: l, id: Array.prototype.slice.call(u, p, p + l).reduce(function (a, c) { return a * 256 + c; }, 0) } : null; };
    var readSize = function (p) {
      var b = u[p], l = 1, m = 0x80;
      while (l <= 8 && !(b & m)) { l++; m >>= 1; }
      if (l > 8) return null;
      var v = b & (m - 1), unknown = v === m - 1;
      for (var k = 1; k < l; k++) { v = v * 256 + u[p + k]; if (u[p + k] !== 0xFF) unknown = false; }
      return { len: l, v: v, unknown: unknown };
    };
    try {
      var p = 0, id = readId(p); if (!id || id.id !== 0x1A45DFA3) return bytes;
      var sz = readSize(p + id.len); p += id.len + sz.len + sz.v;
      id = readId(p); if (!id || id.id !== 0x18538067) return bytes;
      sz = readSize(p + id.len); var q = p + id.len + sz.len, end = sz.unknown ? u.length : q + sz.v;
      while (q < end) {
        var cid = readId(q); if (!cid) return bytes;
        var csz = readSize(q + cid.len); if (!csz) return bytes;
        var body = q + cid.len + csz.len;
        if (cid.id === 0x1549A966) {
          var r = body, bend = body + csz.v;
          while (r < bend) { var e = readId(r), es = readSize(r + e.len); if (e.id === 0x4489) return bytes; r += e.len + es.len + es.v; }
          var dur = new Uint8Array(11); dur[0] = 0x44; dur[1] = 0x89; dur[2] = 0x88;
          new DataView(dur.buffer).setFloat64(3, ms);
          var nv = csz.v + 11, enc = new Uint8Array(8); enc[0] = 0x01; for (var k = 7; k >= 1; k--) enc[k] = Math.floor(nv / Math.pow(256, 7 - k)) % 256;
          var out = new Uint8Array(u.length + 11 + (8 - csz.len));
          out.set(u.subarray(0, q + cid.len), 0);
          var o = q + cid.len; out.set(enc, o); o += 8;
          out.set(u.subarray(body, bend), o); o += csz.v;
          out.set(dur, o); o += 11;
          out.set(u.subarray(bend), o);
          return out;
        }
        if (csz.unknown) return bytes;
        q = body + csz.v;
      }
    } catch (e) {}
    return bytes;
  }

  /* A plain MP4 (H.264, no sound) from the encoder's own chunks: ftyp, moov
     (one track, one chunk), mdat, with moov first so a phone can start playing
     it before it has all of it. o = {width, height, fps, description (the
     avcC the encoder hands over), samples: [{data, key}] in decode order}. */
  function mp4Mux(o) {
    var fps = o.fps || 30, ts = fps * 1000, dt = 1000, N = o.samples.length, durMs = Math.round(N * 1000 / fps);
    function u32(v) { return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; }
    function u16(v) { return [(v >> 8) & 255, v & 255]; }
    function str(s) { return s.split('').map(function (c) { return c.charCodeAt(0); }); }
    function box(type, parts) {
      var body = [].concat.apply([], parts.map(function (p) { return Array.isArray(p) ? p : Array.prototype.slice.call(p); }));
      return u32(body.length + 8).concat(str(type), body);
    }
    function full(type, ver, flags, parts) { return box(type, [[ver].concat(u32(flags).slice(1))].concat(parts)); }
    var M = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 0, 0, 0];   // the unity matrix
    var sizes = o.samples.map(function (x) { return x.data.length; }), keys = [];
    o.samples.forEach(function (x, i) { if (x.key) keys.push(i + 1); });
    function moov(off) {
      var avc1 = box('avc1', [[0, 0, 0, 0, 0, 0].concat(u16(1), u16(0), u16(0), u32(0), u32(0), u32(0), u16(o.width), u16(o.height), u32(0x480000), u32(0x480000), u32(0), u16(1)),
        new Array(32).fill(0), u16(0x18), u16(0xFFFF), box('avcC', [o.description])]);
      var stbl = box('stbl', [
        full('stsd', 0, 0, [u32(1), avc1]),
        full('stts', 0, 0, [u32(1), u32(N), u32(dt)]),
        full('stss', 0, 0, [u32(keys.length)].concat(keys.map(u32))),
        full('stsc', 0, 0, [u32(1), u32(1), u32(N), u32(1)]),
        full('stsz', 0, 0, [u32(0), u32(N)].concat(sizes.map(u32))),
        full('stco', 0, 0, [u32(1), u32(off)])
      ]);
      var minf = box('minf', [full('vmhd', 0, 1, [u16(0), u16(0), u16(0), u16(0)]), box('dinf', [full('dref', 0, 0, [u32(1), full('url ', 0, 1, [])])]), stbl]);
      var mdia = box('mdia', [full('mdhd', 0, 0, [u32(0), u32(0), u32(ts), u32(N * dt), u16(0x55C4), u16(0)]),
        full('hdlr', 0, 0, [u32(0), str('vide'), u32(0), u32(0), u32(0), str('VideoHandler'), [0]]), minf]);
      var trak = box('trak', [full('tkhd', 0, 3, [u32(0), u32(0), u32(1), u32(0), u32(durMs), u32(0), u32(0), u16(0), u16(0), u16(0), u16(0), M, u32(o.width * 65536), u32(o.height * 65536)]), mdia]);
      return box('moov', [full('mvhd', 0, 0, [u32(0), u32(0), u32(1000), u32(durMs), u32(0x10000), u16(0x100), u16(0), u32(0), u32(0), M, new Array(24).fill(0), u32(2)]), trak]);
    }
    var ftyp = box('ftyp', [str('isom'), u32(512), str('isom'), str('iso2'), str('avc1'), str('mp41')]);
    var mlen = moov(0).length, dataLen = sizes.reduce(function (a, b) { return a + b; }, 0);
    var mv = moov(ftyp.length + mlen + 8), out = new Uint8Array(ftyp.length + mv.length + 8 + dataLen), p = 0;
    out.set(ftyp, p); p += ftyp.length; out.set(mv, p); p += mv.length;
    out.set(u32(dataLen + 8), p); out.set(str('mdat'), p + 4); p += 8;
    o.samples.forEach(function (x) { out.set(x.data, p); p += x.data.length; });
    return out;
  }
  // H.264 profiles a 1080 x 1920 frame fits (level 4.0 and up), best first
  var AVC = ['avc1.640028', 'avc1.4d0028', 'avc1.42002a'];

  var api = { plan: plan, stepsPlan: stepsPlan, ticker: ticker, events: events, dayIdx: dayIdx, hailCover: hailCover, hailFromNcei: hailFromNcei,
    hailFromNws: hailFromNws, meshAt: meshAt, meshDays: meshDays, windFrom: windFrom, windUrl: windUrl, hailWords: hailWords, windWords: windWords,
    fileName: fileName, pickMime: pickMime, mp4Mux: mp4Mux, AVC: AVC, MIMES: MIMES, webmWithDuration: webmWithDuration, milesBetween: milesBetween, FORMATS: FORMATS, T: T, HOLD: HOLD,
    HAIL_MI: HAIL_MI, GUST_MARK: GUST_MARK, layerOf: layerOf };
  root.AgRainDraw = api;

  /* Which layer each of the art's groups belongs to (see the top of this file).
     Anything the art adds later that is not listed waits for the end, so it can
     never show before its time. */
  function layerOf(key) {
    if (!key) return 'base';
    if (key === 'axis') return 'base';
    if (key === 'data' || key === 'hist' || key === 'crop' || key === 'ribbon') return 'wipe';
    if (key === 'usual') return 'usual';
    if (key === 'months') return 'months';
    if (key === 'wet' || key === 'dry' || /^(mark|rec|frost):\d+$/.test(key)) return 'pop';
    return 'end';
  }

  var doc = root.document;
  if (!doc || typeof doc.createElement !== 'function') return;

  // ============================================================== the player
  var FONT_FILES = [
    ['Fraunces', '300 600', 'normal', '/fonts/rp-fraunces-opsz.woff2'],
    ['Fraunces', '400', 'italic', '/fonts/rp-fraunces-opsz-400i.woff2'],
    ['IBM Plex Sans', '300 600', 'normal', '/fonts/rp-plex-sans-var.woff2'],
    ['IBM Plex Sans', '400', 'italic', '/fonts/rp-plex-sans-400i.woff2']
  ];
  var fontCssP = null;
  function fontCss() {
    if (fontCssP) return fontCssP;
    fontCssP = Promise.all(FONT_FILES.map(function (f) {
      return fetch(f[3]).then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); }).then(function (buf) {
        var b = new Uint8Array(buf), s = '';
        for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
        return "@font-face{font-family:'" + f[0] + "';font-weight:" + f[1] + ';font-style:' + f[2] + ";src:url(data:font/woff2;base64," + btoa(s) + ") format('woff2')}";
      }).catch(function () { return ''; });
    })).then(function (p) { return p.join(''); });
    return fontCssP;
  }
  function pageFonts() {
    var fs = doc.fonts;
    if (!fs || !fs.load) return Promise.resolve();
    return Promise.all(["600 40px 'Fraunces'", "400 40px 'Fraunces'", "400 20px 'IBM Plex Sans'", "500 20px 'IBM Plex Sans'"].map(function (f) { return fs.load(f).catch(function () {}); }));
  }
  function ga(action, p) {
    var o = Object.assign({ action: action }, p || {});
    try { if (root.gaEvent) root.gaEvent('rain_print_video', o); else if (root.gtag) root.gtag('event', 'rain_print_video', o); } catch (e) {}
  }
  function wait() { return new Promise(function (r) { (root.requestAnimationFrame || setTimeout)(function () { r(); }); }); }

  function svgToCanvas(svgText, w, h) {
    return new Promise(function (res, rej) {
      var img = new Image(), url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
      img.onload = function () {
        (img.decode ? img.decode().catch(function () {}) : Promise.resolve()).then(function () {
          try {
            var c = doc.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url); res(c);
          } catch (e) { URL.revokeObjectURL(url); rej(e); }
        });
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('image')); };
      img.src = url;
    });
  }

  /* The print, split. Returns {W, H, scale, layers: {base, wipe, usual, months, end}, pops: [{key, box, canvas}], boxes}. */
  function build(svg, scale) {
    var P = new root.DOMParser(), X = new root.XMLSerializer();
    var src = P.parseFromString(svg, 'image/svg+xml').documentElement;
    var W = 1800, H = 1200, kids = Array.prototype.slice.call(src.childNodes);
    var keyOf = function (n) { return n.nodeType === 1 && n.getAttribute ? n.getAttribute('data-rp') || '' : ''; };
    var shared = kids.filter(function (n) { return n.nodeType === 1 && /^(style|defs)$/i.test(n.nodeName); });
    var groups = kids.filter(function (n) { return n.nodeType === 1 && !/^(style|defs|title|desc)$/i.test(n.nodeName); });
    var keys = groups.map(keyOf);
    function svgOf(list, vb, pw, ph) {
      var s = src.cloneNode(false);
      s.setAttribute('viewBox', vb || '0 0 ' + W + ' ' + H);
      s.setAttribute('width', String(pw)); s.setAttribute('height', String(ph));
      shared.concat(list).forEach(function (n) { s.appendChild(n.cloneNode(true)); });
      return X.serializeToString(s);
    }
    // measure every pop and the ticker's place (the header or the totals) in a hidden copy
    var probe = doc.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;left:-30000px;top:0;width:1800px;height:1200px;overflow:hidden;visibility:hidden';
    probe.innerHTML = svg;
    doc.body.appendChild(probe);
    var live = probe.querySelector('svg'), boxes = {};
    if (live) { live.setAttribute('width', '1800'); live.setAttribute('height', '1200'); }
    Array.prototype.forEach.call(live ? live.querySelectorAll('[data-rp]') : [], function (g) {
      var k = g.getAttribute('data-rp');
      try { var b = g.getBBox(); if (b && b.width + b.height > 0) boxes[k] = boxes[k] ? union(boxes[k], b) : { x: b.x, y: b.y, w: b.width, h: b.height }; } catch (e) {}
    });
    probe.remove();
    var by = { base: [], wipe: [], usual: [], months: [], end: [] }, popKeys = [];
    groups.forEach(function (g, i) {
      var L = layerOf(keys[i]);
      if (L === 'pop') { if (popKeys.indexOf(keys[i]) < 0) popKeys.push(keys[i]); }
      else by[L].push(g);
    });
    var jobs = [], out = { W: W, H: H, scale: scale, layers: {}, pops: [], boxes: boxes, keys: keys };
    Object.keys(by).forEach(function (L) {
      if (!by[L].length) { out.layers[L] = null; return; }
      jobs.push(function () { return svgToCanvas(svgOf(by[L], null, W * scale, H * scale), W * scale, H * scale).then(function (c) { out.layers[L] = c; }); });
    });
    popKeys.forEach(function (k) {
      var b = boxes[k];
      if (!b) return;
      var pad = 6, bx = { x: Math.floor(b.x - pad), y: Math.floor(b.y - pad), w: Math.ceil(b.w + 2 * pad), h: Math.ceil(b.h + 2 * pad) };
      var list = groups.filter(function (g, i) { return keys[i] === k; });
      jobs.push(function () {
        return svgToCanvas(svgOf(list, bx.x + ' ' + bx.y + ' ' + bx.w + ' ' + bx.h, bx.w * scale, bx.h * scale), bx.w * scale, bx.h * scale)
          .then(function (c) { out.pops.push({ key: k, box: bx, canvas: c }); });
      });
    });
    // one image at a time, a frame between each, so a phone never stalls
    return jobs.reduce(function (p, job) { return p.then(wait).then(job); }, Promise.resolve()).then(function () { return out; });
  }
  function union(a, b) { var x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y); return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.width) - x0, h: Math.max(a.y + a.h, b.y + b.height) - y0 }; }

  /* ---------- one frame ----------
     S: the prepared show. mode 'inplace' (the art's own box, no wall) or a FORMATS key. */
  var SERIF_F = "'Fraunces', Georgia, serif", SANS_F = "'IBM Plex Sans', system-ui, sans-serif";
  var WALL = ['#3a3630', '#27241f'], PAPER_INK = '#1E2125', RAIN = '#2B5C8A', SNOW = '#8DB6D8', ACCENT = '#A8321E', LIGHT = '#F2EDE4', DIM = 'rgba(242,237,228,0.62)';
  function scene(S, mode) {
    if (mode === 'inplace') return { W: S.cw, H: S.ch, print: { x: 0, y: 0, w: S.cw, h: S.ch }, zoom: 1, frame: 0 };
    var F = FORMATS[mode], pw = 1000, ph = pw * 2 / 3;
    if (mode === 'square') return { W: F.w, H: F.h, print: { x: 40, y: 250, w: pw, h: ph }, zoom: 1.15, frame: 16, minTop: 236 };
    return { W: F.w, H: F.h, print: { x: 40, y: 650, w: pw, h: ph }, zoom: 1.34, frame: 16, minTop: 520 };
  }
  function frameAt(ctx, S, mode, t) {
    var sc = scene(S, mode), pl = S.plan, n = S.E.n, g = S.geom, E = S.E;
    var d = pl.dayAt(t), cxArt = g.x0 + (g.x1 - g.x0) * d / g.n;
    var drawing = t < pl.t1 + 0.0001, endA = t >= pl.outro ? 1 : smooth((t - pl.t1 - 0.45) / (T.outro - 0.45)), tickA = S.still && t >= pl.outro ? 0 : 1 - smooth((t - pl.t1) / 0.45);
    var tk = ticker(E, d, S.loc);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (mode === 'inplace') { ctx.clearRect(0, 0, sc.W, sc.H); }
    else {
      var gr = ctx.createLinearGradient(0, 0, 0, sc.H); gr.addColorStop(0, WALL[0]); gr.addColorStop(1, WALL[1]);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, sc.W, sc.H);
    }
    // the camera: in close on the day being drawn, back to the whole print for the finish
    var z = 1, fx = 900, fy = 600;
    if (mode !== 'inplace' && !S.still) {
      var back = smooth((t - pl.t1 + 0.2) / (T.outro + 0.2)), beat = 0;
      S.beats.forEach(function (b) { var u = (t - b.t) / 0.7; if (u > 0 && u < 1) beat = Math.max(beat, Math.sin(u * Math.PI) * 0.05); });
      z = sc.zoom + (1 - sc.zoom) * back + beat * (1 - back);
      var half = 900 / z, fyc = g.style === 'r1' ? (g.top + g.base) / 2 + 40 : (g.snowTop + g.rainBase) / 2;
      fx = clamp(cxArt, half, 1800 - half) * (1 - back) + 900 * back;
      fy = fyc * (1 - back) + 600 * back;
      var halfH = 600 / z; fy = clamp(fy, halfH, 1200 - halfH);
    }
    var k = sc.print.w / 1800 * z, ox = sc.print.x + sc.print.w / 2 - fx * k, oy = sc.print.y + sc.print.h / 2 - fy * k;
    // in close, the print never rides up over the ticker
    if (mode !== 'inplace') oy = Math.max(oy, sc.minTop);
    ctx.setTransform(k, 0, 0, k, ox, oy);
    if (sc.frame) {
      var fr = sc.frame / k;
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 30 / k * k; ctx.shadowOffsetY = 10;
      ctx.fillStyle = '#121212'; ctx.fillRect(-fr, -fr, 1800 + 2 * fr, 1200 + 2 * fr);
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    }
    var L = S.layers, s = 1 / S.scale, C = compose(S, d, t, cxArt, endA);
    ctx.drawImage(C.canvas, 0, 0, 1800, 1200);
    // a pop still opening is drawn over the print; once open it is part of it (compose)
    S.pops.forEach(function (p) {
      var ev = S.popEv[p.key]; if (!ev || C.stamped[p.key]) return;
      var u = (t - ev.t) / POP_S;
      if (d < ev.i + 1 || u <= 0) return;
      var a = clamp(u * 1.6, 0, 1), sz = 1 + 0.18 * Math.sin(clamp(u, 0, 1) * Math.PI), bx = p.box;
      var cxp = bx.x + bx.w / 2, cyp = bx.y + bx.h / 2;
      ctx.save(); ctx.globalAlpha = a;
      ctx.translate(cxp, cyp); ctx.scale(sz, sz); ctx.translate(-cxp, -cyp);
      ctx.drawImage(p.canvas, bx.x, bx.y, bx.w, bx.h);
      ctx.restore();
    });
    // what only the video shows: hail and wind marks, gone by the last frame
    var animA = tickA;
    if (animA > 0) S.anims.forEach(function (ev) {
      if (d < ev.i + 1) return;
      var u = S.still ? 1 : clamp((t - ev.t) / 0.4, 0, 1), x = g.x0 + (g.x1 - g.x0) * (ev.i + 0.5) / g.n, y = markY(g, E, ev.i);
      ctx.save(); ctx.globalAlpha = animA * u;
      if (ev.kind === 'hail') hailGlyph(ctx, x, y - 30 - 8 * (1 - u), 7 + 2 * (1 - u));
      else windGlyph(ctx, x, y - 30, 1);
      ctx.restore();
    });
    // the beat on the biggest rain: a ring that opens once
    if (!S.still) S.beats.forEach(function (b) {
      var u = (t - b.t) / 0.9; if (u <= 0 || u >= 1) return;
      ctx.save(); ctx.globalAlpha = (1 - u) * 0.8; ctx.strokeStyle = ACCENT; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(b.x, b.y, 8 + 46 * smooth(u), 0, 2 * Math.PI); ctx.stroke(); ctx.restore();
    });
    // the pen: where the line is now
    if (drawing && d > 0 && d < n && !S.still) {
      var py = g.style === 'r1' ? g.base - runTotal(E, tk.k) * (g.base - g.top) / g.dom : g.ground;
      ctx.save();
      ctx.fillStyle = tk.kind === 'snow' ? SNOW : g.style === 'r1' ? RAIN : PAPER_INK;
      ctx.globalAlpha = 0.22; ctx.beginPath(); ctx.arc(cxArt, py, 13, 0, 2 * Math.PI); ctx.fill();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(cxArt, py, 5.5, 0, 2 * Math.PI); ctx.fill();
      ctx.restore();
    }
    // the in-place ticker sits where the totals land
    if (mode === 'inplace' && tickA > 0) inplaceTicker(ctx, S, tk, tickA, t);
    if (L.end && endA > 0 && !C.endIn) { ctx.save(); ctx.globalAlpha = endA; ctx.drawImage(L.end, 0, 0, 1800, 1200); ctx.restore(); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (mode !== 'inplace') overlay(ctx, S, sc, mode, t, d, tk, endA, tickA);
    ctx.restore();
    return { d: d, k: tk.k, date: tk.date, total: tk.total, endA: endA };
  }
  /* The print so far, kept in one canvas in art space and added to a strip at
     a time: the days drawn since the last frame (paper, the year, the usual
     year over the faint one), a month's totals when it ends, a pop once it has
     opened, the finish once it is whole. A frame is then one drawImage. Asked
     for an earlier moment (Replay, a test), it starts again from the paper. */
  var POP_S = 0.42;
  function compose(S, d, t, cxArt, endA) {
    var C = S.comp, L = S.layers, sc = S.scale, g = S.geom;
    if (!C || d < C.d || t < C.t) {
      var cv = C ? C.canvas : doc.createElement('canvas');
      cv.width = Math.round(1800 * sc); cv.height = Math.round(1200 * sc);
      var x0 = cv.getContext('2d');
      x0.clearRect(0, 0, cv.width, cv.height);
      if (L.base) x0.drawImage(L.base, 0, 0);
      if (L.usual) { x0.globalAlpha = 0.32; x0.drawImage(L.usual, 0, 0); x0.globalAlpha = 1; }
      C = S.comp = { canvas: cv, ctx: x0, px: 0, mpx: 0, d: 0, t: 0, stamped: {}, endIn: false };
      whiteHead(S, C, 0, cv.width);
    }
    var W = C.canvas.width;
    var to = d >= S.E.n ? W : Math.floor(cxArt * sc);
    if (L.months) { var mx = Math.min(Math.floor(monthEdge(S.E, d, g) * sc), Math.max(to, C.px)); if (mx > C.mpx) { var m0 = C.mpx; C.mpx = mx; if (m0 < C.px) column(S, C, m0, Math.min(mx, C.px)); } }
    if (to > C.px) { column(S, C, C.px, to); C.px = to; }
    S.pops.forEach(function (p) {
      var ev = S.popEv[p.key];
      if (!ev || C.stamped[p.key] || d < ev.i + 1 || (!S.still && t < ev.t + POP_S)) return;
      C.stamped[p.key] = true; stamp(S, C, p);
    });
    if (endA >= 1 && !C.endIn && L.end) { C.ctx.drawImage(L.end, 0, 0); C.endIn = true; }
    C.d = d; C.t = t;
    return C;
  }
  // one column of the print, drawn fresh: paper, the year, the usual year, month totals up to the last full month, pops open there
  function column(S, C, a, b) {
    var L = S.layers, x = C.ctx, H = C.canvas.height, w = b - a;
    if (w <= 0) return;
    x.clearRect(a, 0, w, H);
    [L.base, L.wipe, L.usual].forEach(function (c) { if (c) x.drawImage(c, a, 0, w, H, a, 0, w, H); });
    if (L.months && C.mpx > a) { var mw = Math.min(C.mpx, b) - a; x.drawImage(L.months, a, 0, mw, H, a, 0, mw, H); }
    whiteHead(S, C, a, b);
    restamp(S, C, a, b);
  }
  function stamp(S, C, p) { var sc = S.scale, b = p.box; C.ctx.drawImage(p.canvas, b.x * sc, b.y * sc, b.w * sc, b.h * sc); }
  // a strip drawn again goes under any pop already open there
  function restamp(S, C, a, b) {
    var sc = S.scale, x = C.ctx;
    S.pops.forEach(function (p) {
      if (!(C.stamped[p.key] && p.box.x * sc < b && (p.box.x + p.box.w) * sc > a)) return;
      // only inside the strip: outside it the pop is already there, and twice would darken its edges
      x.save(); x.beginPath(); x.rect(a, 0, b - a, C.canvas.height); x.clip(); stamp(S, C, p); x.restore();
    });
  }
  function whiteHead(S, C, a, b) {
    var h = S.geom.head, sc = S.scale;
    if (S.geom.style !== 'r1' || !h) return;
    var x0 = Math.max(a, h.x * sc), x1 = Math.min(b, (h.x + h.w) * sc);
    if (x1 > x0) { C.ctx.fillStyle = '#FFFFFF'; C.ctx.fillRect(x0, h.y * sc, x1 - x0, h.h * sc); }
  }
  // the right edge of the last finished month (the month totals show then)
  function monthEdge(E, d, g) {
    if (d >= E.n) return 1800;
    var k = Math.floor(d), m = E.days[k] ? E.days[k].m : 0, i = k;
    while (i > 0 && E.days[i - 1] && E.days[i - 1].m === m) i--;
    return i <= 0 ? 0 : g.x0 + (g.x1 - g.x0) * i / g.n;
  }
  function markY(g, E, i) { return g.style === 'r1' ? g.base - runTotal(E, i) * (g.base - g.top) / g.dom : g.ground - 4; }
  function hailGlyph(ctx, x, y, r) {
    ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#5F8DB3'; ctx.lineWidth = 2;
    [[0, 0], [-r * 1.5, r * 0.9], [r * 1.5, r * 0.9]].forEach(function (p) { ctx.beginPath(); ctx.arc(x + p[0], y + p[1], r * (p[0] ? 0.62 : 1), 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); });
  }
  function windGlyph(ctx, x, y) {
    ctx.strokeStyle = '#5E6475'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    [[0, 18], [8, 12]].forEach(function (q, j) {
      ctx.beginPath(); ctx.moveTo(x - 12, y + j * 8); ctx.lineTo(x + q[1] - 2, y + j * 8);
      ctx.arc(x + q[1] - 2, y + j * 8 - 4, 4, Math.PI / 2, -Math.PI / 1.2, true); ctx.stroke();
    });
  }
  // in place, the ticker takes the name's spot (the name lands there at the end)
  function inplaceTicker(ctx, S, tk, a, t) {
    var b = S.tickBox; if (!b) return;
    var x = b.x, y = b.y + 52;
    ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = PAPER_INK; ctx.font = "500 60px " + SERIF_F;
    var d1 = tk.dateText || (S.fr ? '1er janv.' : 'Jan 1');
    ctx.fillText(d1, x, y);
    var w1 = ctx.measureText(d1 + '  ').width;
    ctx.font = "400 60px " + SERIF_F; ctx.fillStyle = '#5E6475'; ctx.fillText(String(S.year), x + w1, y);
    ctx.font = "500 22px " + SANS_F; ctx.fillStyle = RAIN;
    var l2 = tk.totalText + (S.fr ? ' cumulés' : ' so far');
    ctx.fillText(l2, x + 2, y + 38);
    if (tk.words) {
      var w2 = ctx.measureText(l2 + '   ').width;
      ctx.font = "400 22px " + SANS_F; ctx.fillStyle = tk.kind === 'snow' ? '#4F7FA6' : '#5E6475';
      ctx.fillText(tk.words, x + 2 + w2, y + 38);
    }
    var toast = toastAt(S, t);
    if (toast) { ctx.globalAlpha = a * toast.a; ctx.fillStyle = toast.kind === 'wet' ? ACCENT : toast.kind === 'hail' ? '#4F7FA6' : PAPER_INK; ctx.font = "500 22px " + SANS_F; ctx.fillText(toast.text, x + 2, y + 72); }
    ctx.restore();
  }
  function toastAt(S, t) {
    var best = null;
    S.events.forEach(function (e) { if (!e.text) return; var u = t - e.t; if (u >= 0 && u < 1.9) best = { text: e.text, kind: e.kind, a: u < 0.2 ? u / 0.2 : u > 1.5 ? (1.9 - u) / 0.4 : 1 }; });
    return best;
  }
  function fitFont(ctx, text, weight, size, fam, maxW) {
    while (size > 14) { ctx.font = weight + ' ' + size + 'px ' + fam; if (ctx.measureText(text).width <= maxW) break; size -= 2; }
    return size;
  }
    // the export's words, on the wall: the ticker while it draws, the name and the link at the end
  function overlay(ctx, S, sc, mode, t, d, tk, endA, tickA) {
    var tall = mode === 'tall', W = sc.W, cx = W / 2, a = tickA;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    var top = tall ? 300 : 112;
    if (a > 0) {
      ctx.globalAlpha = a;
      ctx.fillStyle = DIM; ctx.font = '500 ' + (tall ? 30 : 24) + 'px ' + SANS_F;
      ctx.fillText(S.placeLine, cx, top - (tall ? 120 : 64));
      ctx.fillStyle = LIGHT; ctx.font = '600 ' + (tall ? 132 : 84) + 'px ' + SERIF_F;
      ctx.fillText(tk.dateText || (S.fr ? '1er janv.' : 'Jan 1'), cx, top + (tall ? 30 : 12));
      ctx.font = '500 ' + (tall ? 44 : 32) + 'px ' + SANS_F; ctx.fillStyle = '#BFD6EA';
      ctx.fillText(tk.totalText + (S.fr ? ' cumulés' : ' so far'), cx, top + (tall ? 110 : 62));
      ctx.font = '400 ' + (tall ? 32 : 24) + 'px ' + SANS_F; ctx.fillStyle = tk.kind === 'snow' ? '#CFE2F2' : DIM;
      ctx.fillText(tk.words || ' ', cx, top + (tall ? 162 : 98));
      var toast = toastAt(S, t);
      if (toast) {
        ctx.globalAlpha = a * toast.a;
        var ty = tall ? 1680 : 1022;
        var size = fitFont(ctx, toast.text, '500', tall ? 40 : 30, SANS_F, W - 120);
        ctx.font = '500 ' + size + 'px ' + SANS_F;
        var tw = ctx.measureText(toast.text).width, ph = size * 1.9;
        ctx.fillStyle = toast.kind === 'wet' ? 'rgba(168,50,30,0.92)' : toast.kind === 'hail' ? 'rgba(95,141,179,0.92)' : 'rgba(242,237,228,0.94)';
        roundRect(ctx, cx - tw / 2 - 28, ty - ph * 0.68, tw + 56, ph, ph / 2); ctx.fill();
        ctx.fillStyle = toast.kind === 'wet' || toast.kind === 'hail' ? '#FFFFFF' : PAPER_INK;
        ctx.fillText(toast.text, cx, ty);
      }
    }
    // the finish: the name, the place and year, a quiet link
    if (endA > 0) {
      ctx.globalAlpha = endA;
      var nameY = tall ? 330 : 120;
      if (S.name) {
        var ns = fitFont(ctx, S.name, '500', tall ? 104 : 72, SERIF_F, W - 100);
        ctx.fillStyle = LIGHT; ctx.font = '500 ' + ns + 'px ' + SERIF_F; ctx.fillText(S.name, cx, nameY);
      }
      ctx.fillStyle = S.name ? DIM : LIGHT;
      var pl = S.placeLine, ps = fitFont(ctx, pl, S.name ? '400' : '500', S.name ? (tall ? 40 : 30) : (tall ? 76 : 56), S.name ? SANS_F : SERIF_F, W - 100);
      ctx.font = (S.name ? '400 ' : '500 ') + ps + 'px ' + (S.name ? SANS_F : SERIF_F);
      ctx.fillText(pl, cx, nameY + (S.name ? (tall ? 76 : 54) : 0));
      if (tall && S.totalLine) { ctx.fillStyle = '#BFD6EA'; ctx.font = '500 40px ' + SANS_F; ctx.fillText(S.totalLine, cx, sc.print.y + sc.print.h + 150); }
    }
    ctx.globalAlpha = 0.55 + 0.25 * endA; ctx.fillStyle = DIM; ctx.font = '400 ' + (tall ? 28 : 22) + 'px ' + SANS_F;
    ctx.fillText('agsist.com/rain-print', cx, sc.H - (tall ? 120 : 34));
    if (S.creditLine && a > 0) { ctx.globalAlpha = 0.5 * a; ctx.font = '400 ' + (tall ? 20 : 15) + 'px ' + SANS_F; ctx.fillText(S.creditLine, cx, sc.H - (tall ? 80 : 12)); }
    ctx.globalAlpha = 1;
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  /* ---------- getting the show ready ----------
     src = {input (the art input the page drew), place, year, name, lat, lon, ca, url, from, style} */
  function prepare(src, opts) {
    opts = opts || {};
    var A = root.AgRainArt, I = Object.assign({}, src.input, { watermark: false, bleed: 0, px: null });
    return Promise.all([fontCss(), pageFonts(), opts.hail === false ? null : loadHail(src).catch(function () { return null; }), opts.wind ? loadWind(src).catch(function () { return { failed: true }; }) : null]).then(function (r) {
      var css = r[0], hail = r[2], wind = r[3];
      var svg = A.render(Object.assign({}, I, { fontCss: css }));
      var geom = A.lastGeom ? A.lastGeom() : null, unplaced = A.lastUnplaced ? A.lastUnplaced() : [];
      if (!geom) throw new Error('art too old');
      var J = I.markers ? Object.assign({}, I, { markers: I.markers.filter(function (m, k) { return unplaced.indexOf(k) < 0; }) }) : I;
      var E = A.model(J);
      return build(svg, opts.scale || 1).then(function (B) {
        var evs = events(J, E, { groups: B.keys, unplaced: unplaced, hail: hail && hail.list, wind: wind && !wind.failed ? wind : null });
        var pl = opts.reduced ? stepsPlan(E.n) : plan({ n: E.n, events: evs });
        evs.forEach(function (e) { e.t = pl.timeOf(e.i); });
        var popEv = {};
        evs.forEach(function (e) { if (e.key) popEv[e.key] = e; });
        var fr = !!(I.loc && I.loc.lang === 'fr');
        var tb = B.boxes.title, tickBox = tb ? { x: tb.x + 2, y: tb.y, w: tb.w, h: tb.h } : { x: geom.x0, y: geom.style === 'r1' ? 850 : 90, w: 900, h: 130 };
        var F = A.facts(J, { unplaced: unplaced });
        var credit = [];
        if (hail && hail.list && hail.list.length) credit.push('Hail: ' + hail.srcs.join(', '));
        if (wind && !wind.failed) credit.push('Wind: ' + wind.src);
        return {
          src: src, I: J, E: E, geom: geom, layers: B.layers, pops: B.pops, boxes: B.boxes, events: evs, popEv: popEv, plan: pl,
          anims: evs.filter(function (e) { return e.anim; }).concat(wind && wind.gust ? windMarks(wind, evs) : []),
          beats: evs.filter(function (e) { return e.kind === 'wet'; }).map(function (e) { return { t: e.t, x: geom.x0 + (geom.x1 - geom.x0) * (e.i + 0.5) / geom.n, y: markY(geom, E, e.i) }; }),
          scale: B.scale, loc: I.loc || null, fr: fr, year: src.year || I.year, name: String(src.name || I.name || '').trim(),
          placeLine: (src.place || I.place || '') + ', ' + (src.year || I.year), totalLine: F.totalText + (F.preview ? (fr ? ' jusqu’ici' : ' so far') : ' ' + (fr ? 'cette année' : 'this year')),
          tickBox: tickBox, hail: hail, wind: wind, creditLine: credit.join(' · '), still: !!opts.reduced, fontCss: css
        };
      });
    });
  }
  function windMarks(w, evs) {
    var topI = w.top ? w.top.i : -1, out = [];
    w.gust.forEach(function (g, i) { if (g !== null && g >= GUST_MARK && i !== topI) out.push({ i: i, kind: 'wind', t: 0, anim: true }); });
    return out;
  }
  function loadHail(src) {
    var I = src.input, year = +(src.year || I.year), lat = +src.lat, lon = +src.lon, days = I.days;
    if (!isFinite(lat) || !isFinite(lon) || src.ca) return Promise.resolve(null);
    var j = function (u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
    return Promise.all([j('/data/hail/ncei/index.json'), j('/data/hail/manifest.json'), year >= 2026 ? j('/data/hail/mesh/index.json') : null]).then(function (ix) {
      var idx = { ncei: ix[0], manifest: ix[1], mesh: ix[2] }, cov = hailCover(year, idx);
      if (!cov) return { list: [], srcs: [], none: true };
      var parts = [], srcs = [];
      if (cov.indexOf('ncei') >= 0) {
        var keys = {};
        [-0.16, 0.16].forEach(function (dy) { [-0.22, 0.22].forEach(function (dx) { keys[Math.floor(lat + dy) + '_' + Math.floor(lon + dx)] = 1; }); });
        parts.push(Promise.all(Object.keys(keys).map(function (k) { return j('/data/hail/ncei/tiles/' + k + '.json'); })).then(function (tiles) {
          srcs.push('NOAA NCEI Storm Events'); return hailFromNcei(tiles.filter(Boolean), lat, lon, year, days);
        }));
      }
      if (cov.indexOf('nws') >= 0) parts.push(j('/data/hail/events-' + year + '.json').then(function (e) { srcs.push('NWS storm reports'); return hailFromNws(e, lat, lon, year, days); }));
      return Promise.all(parts).then(function (lists) {
        var all = bestPerDay([].concat.apply([], lists));
        if (cov.indexOf('mesh') < 0) return { list: all, srcs: srcs };
        var seen = {}; all.forEach(function (h) { seen[h.date] = 1; });
        var want = meshDays(days, idx.mesh.dates).filter(function (d) { return !seen[d]; });
        return Promise.all(want.map(function (d) { return j('/data/hail/mesh/' + d + '.json').then(function (gj) { var s = meshAt(gj, lat, lon); return s > 0 ? { i: dateIndex(days)[d], date: d, size: s, mi: 0, kind: 'radar', src: 'NOAA MRMS radar estimate' } : null; }); }))
          .then(function (rad) { rad = rad.filter(Boolean); if (rad.length) srcs.push('NOAA MRMS radar estimate'); return { list: bestPerDay(all.concat(rad)), srcs: srcs }; });
      });
    });
  }
  function loadWind(src) {
    var I = src.input, year = +(src.year || I.year), days = I.days;
    if (!isFinite(+src.lat) || !isFinite(+src.lon) || !days.length) return Promise.resolve({ failed: true });
    return fetch(windUrl(src.lat, src.lon, year, days[days.length - 1].date)).then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) { return windFrom(j, days) || { failed: true }; });
  }

  // ---------- recording ----------
  /* Two ways to a file. Best: WebCodecs (VideoEncoder) makes H.264 frame by
     frame, exactly 30 to the second whatever the phone's speed, faster than
     real time, and mp4Mux wraps it (Chrome, Edge, Safari 16.4 and later).
     Otherwise MediaRecorder records the canvas as it plays, in real time. */
  var avcP = null, STALL_MS = 8000;
  function avcCodec(F) {
    if (!root.VideoEncoder || !root.VideoFrame || typeof root.VideoEncoder.isConfigSupported !== 'function') return Promise.resolve('');
    return AVC.reduce(function (p, codec) {
      return p.then(function (got) {
        if (got) return got;
        return root.VideoEncoder.isConfigSupported(encConfig(codec, F)).then(function (r) { return r && r.supported ? codec : ''; }, function () { return ''; });
      });
    }, Promise.resolve(''));
  }
  function encConfig(codec, F) { return { codec: codec, width: F.w, height: F.h, bitrate: F.bps, framerate: 30, avc: { format: 'avc' } }; }
  function mrMime() { return root.MediaRecorder && typeof doc.createElement('canvas').captureStream === 'function' ? pickMime(function (m) { return root.MediaRecorder.isTypeSupported(m); }) : ''; }
  function canRecord() {
    if (mrMime()) return Promise.resolve(true);
    return (avcP = avcP || avcCodec(FORMATS.tall)).then(function (c) { return !!c; });
  }
  function record(S, mode, onTick, opts) {
    opts = opts || {};
    var F = FORMATS[mode];
    return (opts.via === 'recorder' ? Promise.resolve('') : avcCodec(F)).then(function (codec) {
      var live = function () { if (!mrMime()) throw new Error('no recorder'); return liveRecord(S, mode, onTick); };
      if (codec) return encodeMp4(S, mode, codec, onTick).then(null, function (e) { if (mrMime()) return live(); throw e; });
      return live();
    });
  }
  function encodeMp4(S, mode, codec, onTick) {
    var F = FORMATS[mode];
    return encodeFrames(S, mode, codec, onTick).then(function (r) {
      if (!r.desc || !r.samples.length) throw new Error('encoder');
      var bytes = mp4Mux({ width: F.w, height: F.h, fps: r.fps, description: r.desc, samples: r.samples });
      return { blob: new Blob([bytes], { type: 'video/mp4' }), type: 'video/mp4', ext: 'mp4', canvas: r.canvas, via: 'webcodecs', codec: codec, frames: r.samples.length };
    });
  }
  // every frame of the video through VideoEncoder -> {samples [{data, key}], desc, canvas, fps}
  function encodeFrames(S, mode, codec, onTick) {
    var F = FORMATS[mode], c = doc.createElement('canvas'), fps = 30;
    c.width = F.w; c.height = F.h;
    var ctx = c.getContext('2d'), samples = [], desc = null, failed = null, moved = performance.now();
    var enc = new root.VideoEncoder({
      output: function (chunk, meta) {
        if (meta && meta.decoderConfig && meta.decoderConfig.description) {
          var dd = meta.decoderConfig.description;
          desc = dd.buffer ? new Uint8Array(dd.buffer, dd.byteOffset || 0, dd.byteLength).slice() : new Uint8Array(dd).slice();
        }
        var b = new Uint8Array(chunk.byteLength); chunk.copyTo(b);
        samples.push({ data: b, key: chunk.type === 'key' });
        moved = performance.now();
      },
      error: function (e) { failed = e || new Error('encoder'); }
    });
    enc.configure(encConfig(codec, F));
    var N = Math.ceil(S.plan.total * fps) + 1, f = 0;
    return new Promise(function (res, rej) {
      function step() {
        // an encoder that stops giving frames back (seen in headless Chromium) must not hang the page: give up, the recorder takes over
        if (!failed && performance.now() - moved > STALL_MS) failed = new Error('stall');
        if (failed) { try { enc.close(); } catch (e) {} rej(failed); return; }
        // a few frames, then a breath for the page (and the encoder's queue)
        var until = performance.now() + 12;
        if (enc.encodeQueueSize < 6) moved = performance.now();
        while (f < N && enc.encodeQueueSize < 6 && performance.now() < until) {
          frameAt(ctx, S, mode, Math.min(f / fps, S.plan.total));
          var vf = new root.VideoFrame(c, { timestamp: Math.round(f * 1e6 / fps), duration: Math.round(1e6 / fps) });
          enc.encode(vf, { keyFrame: f % (fps * 2) === 0 });
          vf.close();
          f++;
        }
        if (onTick) onTick(f / fps, N / fps, c);
        if (f < N) { setTimeout(step, 0); return; }
        Promise.race([enc.flush(), new Promise(function (r, j) { setTimeout(function () { j(new Error('stall')); }, STALL_MS); })]).then(function () {
          enc.close();
          if (failed) throw failed;
          res({ samples: samples, desc: desc, canvas: c, fps: fps, frames: N });
        }).catch(rej);
      }
      step();
    });
  }
  function liveRecord(S, mode, onTick) {
    var F = FORMATS[mode], c = doc.createElement('canvas');
    c.width = F.w; c.height = F.h;
    var ctx = c.getContext('2d'), mime = mrMime();
    frameAt(ctx, S, mode, 0);
    var stream = c.captureStream(30), rec = new root.MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: F.bps }), chunks = [];
    return new Promise(function (res, rej) {
      var t0 = 0, stopped = false, hid = false;
      var onVis = function () { if (doc.hidden && !stopped) { hid = true; stop(); } };
      function stop() { if (stopped) return; stopped = true; doc.removeEventListener('visibilitychange', onVis); try { rec.stop(); } catch (e) { rej(e); } stream.getTracks().forEach(function (tr) { tr.stop(); }); }
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = function (e) { rej(e.error || new Error('recorder')); };
      rec.onstop = function () {
        if (hid) { rej(new Error('hidden')); return; }
        var type = (mime.split(';')[0]) || 'video/webm', blob = new Blob(chunks, { type: type }), ms = performance.now() - t0;
        var done = function (b) { res({ blob: b, type: type, ext: /mp4/.test(type) ? 'mp4' : 'webm', canvas: c, via: 'recorder' }); };
        if (/webm/.test(type) && blob.arrayBuffer) blob.arrayBuffer().then(function (b) { done(new Blob([webmWithDuration(new Uint8Array(b), ms)], { type: type })); }, function () { done(blob); });
        else done(blob);
      };
      doc.addEventListener('visibilitychange', onVis);
      rec.start(250);
      t0 = performance.now();
      (function loop() {
        if (stopped) return;
        var t = (performance.now() - t0) / 1000;
        frameAt(ctx, S, mode, Math.min(t, S.plan.total));
        if (onTick) onTick(t, S.plan.total, c);
        if (t >= S.plan.total + 0.12) { stop(); return; }
        root.requestAnimationFrame(loop);
      })();
    });
  }
  function stillOf(S, mode) {
    var F = FORMATS[mode], c = doc.createElement('canvas'); c.width = F.w; c.height = F.h;
    frameAt(c.getContext('2d'), S, mode, S.plan.total);
    return new Promise(function (r) { c.toBlob(function (b) { r(b); }, 'image/png'); });
  }
  function isPhone() { try { return root.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } }
  function canShareFile(file) { var n = root.navigator; try { return !!(n && n.canShare && n.share && n.canShare({ files: [file] })); } catch (e) { return false; } }
  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob), a = doc.createElement('a');
    a.href = url; a.download = name; doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  function shareText(S) {
    var RP = root.RainPrint, place = S.src.place || S.I.place, year = S.year, url = S.src.url || 'https://agsist.com/rain-print';
    var title = RP && typeof RP.familyMessage === 'function' ? RP.familyMessage({ place: place, year: year, url: url }).subject : 'A Rain Print of ' + place + ', ' + year;
    return { title: title, text: 'Every rain and snow at ' + place + ' in ' + year + ', day by day. ' + url };
  }

  // ---------- the controls ----------
  var CSS = '.rpd-host{position:relative}.rpd-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;z-index:3;background:transparent}' +
    '.rpd-bar{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .6rem;margin:.6rem auto 0;max-width:680px;font-size:var(--fs-xs,.85rem);line-height:1.45}' +
    '.rpd-bar .rpd-say{flex:1 1 100%;margin:0;color:inherit;opacity:.85}.rpd-bar .rpd-fmt{display:inline-flex;gap:.3rem;flex-wrap:wrap}' +
    '.rpd-bar label{display:inline-flex;align-items:center;gap:.3rem;cursor:pointer}.rpd-bar .rpd-wind{opacity:.9}' +
    '.rpd-bar button{min-height:40px}.rpd-prog{display:block;width:100%;height:4px;border-radius:2px;background:color-mix(in srgb,currentColor 20%,transparent);overflow:hidden}' +
    '.rpd-prog i{display:block;height:100%;width:0;background:currentColor}.rpd-hide{display:none!important}';
  function addCss() { if (doc.getElementById('rpd-css')) return; var s = doc.createElement('style'); s.id = 'rpd-css'; s.textContent = CSS; doc.head.appendChild(s); }
  function el(tag, attrs, text) { var e = doc.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); if (text) e.textContent = text; return e; }
  function reducedMotion() { try { return root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

  var CUR = null;
  /* open(src, o): play the print in place. o = {host (the element the print is
     drawn in), after (where the controls go), from: 'page'|'county', getSrc
     (rebuilds src on Replay, so a change since is drawn)} */
  function open(src, o) {
    o = o || {};
    addCss();
    close();
    var host = o.host, after = o.after || host;
    if (!host || !src || !src.input) return null;
    host.classList.add('rpd-host');
    var cv = el('canvas', { class: 'rpd-canvas', 'aria-hidden': 'true' });
    host.appendChild(cv);
    var bar = el('div', { class: 'rpd-bar', role: 'group', 'aria-label': 'Watch your year draw' });
    var say = el('p', { class: 'rpd-say', 'aria-live': 'polite' }, 'Getting your year ready…');
    var replay = el('button', { type: 'button', class: 'chip' }, 'Replay');
    var fmtBox = el('span', { class: 'rpd-fmt', role: 'radiogroup', 'aria-label': 'Video shape' });
    Object.keys(FORMATS).forEach(function (k, j) {
      var lab = el('label'), r = el('input', { type: 'radio', name: 'rpd-fmt', value: k });
      if (!j) r.checked = true;
      lab.appendChild(r); lab.appendChild(doc.createTextNode(FORMATS[k].label)); fmtBox.appendChild(lab);
    });
    var windLab = el('label', { class: 'rpd-wind' }), windBox = el('input', { type: 'checkbox' });
    windLab.appendChild(windBox); windLab.appendChild(doc.createTextNode(' Wind (modeled)'));
    if (!isFinite(+src.lat) || !isFinite(+src.lon)) windLab.classList.add('rpd-hide');
    var make = el('button', { type: 'button', class: 'chip rpd-make' }, 'Make a video');
    var share = el('button', { type: 'button', class: 'chip rpd-share rpd-hide' }, 'Share video');
    var save = el('button', { type: 'button', class: 'chip rpd-save rpd-hide' }, 'Save video');
    var still = el('button', { type: 'button', class: 'chip rpd-still rpd-hide' }, 'Save the picture');
    var shut = el('button', { type: 'button', class: 'chip rpd-close', 'aria-label': 'Close the video and show the print' }, 'Done');
    var prog = el('span', { class: 'rpd-prog rpd-hide', 'aria-hidden': 'true' }), progI = el('i');
    prog.appendChild(progI);
    [say, replay, fmtBox, windLab, make, share, save, still, shut, prog].forEach(function (x) { bar.appendChild(x); });
    after.parentNode.insertBefore(bar, after.nextSibling);
    var me = { host: host, cv: cv, bar: bar, S: null, raf: 0, file: null, busy: false, src: src, from: o.from || 'page' };
    CUR = me;
    var reduced = reducedMotion(), meta = function () { return { format: fmt(), style: me.S ? me.S.geom.style : '', from: me.from }; };
    function fmt() { var r = fmtBox.querySelector('input:checked'); return r ? r.value : 'square'; }
    function size() {
      var r = host.getBoundingClientRect(), dpr = Math.min(2, root.devicePixelRatio || 1);
      var w = Math.max(300, Math.round((r.width || 600) * dpr)), h = Math.round(w * 2 / 3);
      cv.width = w; cv.height = h;
      return { w: w, h: h };
    }
    function play(S) {
      root.cancelAnimationFrame(me.raf);
      var sz = size(); S.cw = sz.w; S.ch = sz.h;
      var ctx = cv.getContext('2d'), t0 = performance.now(), slow = 0;
      cv.classList.remove('rpd-hide');
      (function loop() {
        var t = (performance.now() - t0) / 1000, a = performance.now();
        frameAt(ctx, S, 'inplace', Math.min(t, S.plan.total));
        if (performance.now() - a > 24) slow++;
        if (t < S.plan.total) me.raf = root.requestAnimationFrame(loop);
        else { me.raf = 0; me.slowFrames = slow; host.setAttribute('data-rpd-done', '1'); }
      })();
    }
    function ready(opts2) {
      var s0 = o.getSrc ? o.getSrc() || src : src;
      me.src = s0;
      say.textContent = 'Getting your year ready…';
      host.removeAttribute('data-rpd-done');
      var sz0 = size();
      return prepare(s0, { reduced: reduced, wind: windBox.checked, scale: clamp(sz0.w / 1800, 0.75, 1) }).then(function (S) {
        me.S = S;
        var words = reduced ? 'Your year in four steps, without motion. The video you make plays the whole year.' : 'Your year, day by day, from the same NOAA record as the print.';
        if (S.hail && S.hail.none && !s0.ca) words += ' No hail record for ' + S.year + ' in our data.';
        else if (S.hail && S.hail.list && S.hail.list.length) words += ' Hail near town: ' + S.hail.srcs.join(', ') + '.';
        else if (S.hail && S.hail.srcs && S.hail.srcs.length) words += ' No hail reported within ' + HAIL_MI + ' mi in ' + S.year + ' (' + S.hail.srcs.join(', ') + ').';
        if (windBox.checked) words += S.wind && !S.wind.failed ? ' Wind is modeled (ERA5 reanalysis via Open-Meteo), not measured at the station.' : ' The wind record didn’t load, so the video has no wind.';
        say.textContent = words;
        play(S);
        ga(opts2 && opts2.replay ? 'replay' : 'play', meta());
        return S;
      }).catch(function () { say.textContent = 'The video couldn’t be drawn here. The print above is the same year.'; ga('fail', { step: 'prepare', from: me.from }); });
    }
    me.ready = ready;
    replay.addEventListener('click', function () { if (!me.busy) ready({ replay: true }); });
    windBox.addEventListener('change', function () { if (!me.busy) ready({ replay: true }); });
    shut.addEventListener('click', close);
    make.addEventListener('click', function () {
      if (me.busy || !me.S) return;
      me.busy = true; make.disabled = true; replay.disabled = true;
      share.classList.add('rpd-hide'); save.classList.add('rpd-hide');
      prog.classList.remove('rpd-hide');
      var mode = fmt(), S = me.S;
      // the file is always the full year in motion, whatever this screen plays
      var go = S.still ? prepare(me.src, { wind: windBox.checked, scale: 0.75 }) : Promise.resolve(S);
      say.textContent = 'Making your video. Keep this page open; it takes up to ' + Math.round(S.plan.total) + ' seconds.';
      canRecord().then(function (ok) {
        if (!ok) throw new Error('no recorder');
        return go;
      }).then(function (S2) {
        return record(S2, mode, function (t, tot) { progI.style.width = Math.min(100, t / tot * 100).toFixed(1) + '%'; });
      }).then(function (r) {
        me.file = new File([r.blob], fileName({ place: me.src.place || S.I.place, year: S.year, style: S.geom.style }, r.ext), { type: r.type });
        var mb = (r.blob.size / 1048576).toFixed(1);
        say.textContent = 'Your video is ready (' + mb + ' MB, ' + r.ext.toUpperCase() + ').';
        if (isPhone() && canShareFile(me.file)) share.classList.remove('rpd-hide');
        save.classList.remove('rpd-hide');
        ga('export', Object.assign(meta(), { type: r.ext, via: r.via, mb: +mb }));
      }).catch(function (e) {
        say.textContent = e && e.message === 'hidden' ? 'The video stopped because the page was hidden. Press Make a video and keep this page open.'
          : e && e.message === 'no recorder' ? 'This browser can’t make a video file. You can save the finished picture instead.'
          : 'The video didn’t record in this browser. You can save the finished picture instead.';
        if (!(e && e.message === 'hidden')) still.classList.remove('rpd-hide');
        ga('fail', Object.assign(meta(), { step: 'record' }));
      }).then(function () { me.busy = false; make.disabled = false; replay.disabled = false; prog.classList.add('rpd-hide'); progI.style.width = '0'; });
    });
    share.addEventListener('click', function () {
      if (!me.file || !me.S) return;
      var m = shareText(me.S);
      root.navigator.share({ files: [me.file], title: m.title, text: m.text }).then(function () { ga('share', meta()); }, function (e) {
        if (e && e.name === 'AbortError') return;
        saveBlob(me.file, me.file.name); ga('save', meta());
      });
    });
    save.addEventListener('click', function () { if (me.file) { saveBlob(me.file, me.file.name); ga('save', meta()); } });
    still.addEventListener('click', function () {
      if (!me.S) return;
      stillOf(me.S, fmt()).then(function (b) {
        var f = new File([b], fileName({ place: me.src.place || me.S.I.place, year: me.S.year, style: me.S.geom.style }, 'png'), { type: 'image/png' });
        if (isPhone() && canShareFile(f)) { var m = shareText(me.S); root.navigator.share({ files: [f], title: m.title, text: m.text }).then(function () { ga('still', meta()); }, function () {}); }
        else { saveBlob(f, f.name); ga('still', meta()); }
      });
    });
    ready();
    return me;
  }
  function close() {
    var me = CUR; CUR = null;
    if (!me) return;
    root.cancelAnimationFrame(me.raf);
    if (me.cv) me.cv.remove();
    if (me.bar) me.bar.remove();
    if (me.host) { me.host.classList.remove('rpd-host'); me.host.removeAttribute('data-rpd-done'); }
    if (me.onClose) me.onClose();
  }
  api.open = open; api.close = close; api.prepare = prepare; api.frameAt = frameAt; api.record = record; api.canRecord = canRecord; api.stillOf = stillOf; api.encodeFrames = encodeFrames; api.avcCodec = avcCodec;
  api.current = function () { return CUR; };

  // ---------- on /rain-print: a "Watch it draw" chip beside Up close ----------
  function pageHook() {
    var RP = root.RainPrint, zoom = doc.getElementById('rp-zoom'), art = doc.getElementById('rp-art');
    if (!zoom || !art || doc.getElementById('rp-watch')) return;
    var b = el('button', { type: 'button', class: 'chip rp-watch', id: 'rp-watch', disabled: '' }, 'Watch it draw');
    b.setAttribute('aria-label', 'Watch your year draw itself, and make a video of it');
    zoom.parentNode.insertBefore(b, zoom);
    var sync = function () {
      var on = !!(root.RainPrint && typeof root.RainPrint.drawInput === 'function' && art.querySelector('svg') && !art.classList.contains('rp-empty'));
      b.disabled = !on;
      if (CUR && CUR.from === 'page') close();   // a new draw: the old video no longer matches
    };
    doc.addEventListener('rainprint:drawn', sync);
    sync();
    b.addEventListener('click', function () {
      var RP2 = root.RainPrint, s = RP2 && RP2.drawInput && RP2.drawInput();
      if (!s) return;
      var wall = doc.getElementById('rp-wall');
      open(s, { host: art, after: wall, from: 'page', getSrc: function () { return RP2.drawInput(); } });
    });
    if (RP && !RP.drawVideo) RP.drawVideo = function () { b.click(); };
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', pageHook); else pageHook();
})(typeof window !== 'undefined' ? window : this);
