/* home-page.js: the home page (Nov 11, 2026 rebuild). Draws into the cards index.html already lays out; every
   card holds its room in css/home.css, so nothing here moves the page.

   WHERE EACH NUMBER COMES FROM (nothing is worked out here beyond a sum or a subtraction):
     place      AgSavedPlace (components/saved-place.js): the ZIP the reader typed or the place geo.js found after a
                tap on "Use my location". The ZIP box hands a ZIP to geo.js (agsistSetZip), which saves it and loads
                the bids; nothing leaves the browser but the files below and the weather service call.
     bids       components/bids-homepage.js draws the elevator list and publishes its top corn and soybean board
                (agsist:bids-top); the two tiles print that, in its own formatter (agsistBidFmt).
     futures    data/prices.json (the headline contract, AgPxStamp.headline) and data/price-stats.json (the front
                month's weekly closes): 19 Friday closes plus today's price, on a labelled dollar axis with dates.
     the Daily  data/daily.json: its teaser, a line with no price in it.
     markets    data/prices.json front months.
     weather    the National Weather Service grid (components/nws.js), live in the browser; radar rain from
                data/radar-rain/<st>.bin (NOAA MRMS); rain and GDUs against normal from data/rain/<st>.json and
                data/rain/wx/<st>.json (NOAA daily records through RCC-ACIS) for the reader's county.
     land       data/land-sales/<st>/<fips>.json for the reader's county; else data/land-sales/lead.json.
     Rain Print data/rain-print.json: prices and the real order-by date.
   FAIL SOFT: each source that does not answer says so in its own card; the rest of the page carries on.
   window.AgHomePage = { lineSvg, cumSvg, landSvg, nice, fridays, county, words } (test/home-a3.test.mjs). */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var NAMES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
    DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
    KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
    NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
    PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
    VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
  var RR_COLORS = [[1, '#d9f0d3'], [10, '#a6dba0'], [25, '#5aae61'], [50, '#4eb3d3'], [100, '#2b8cbe'],
    [150, '#0868ac'], [200, '#6a51a3'], [300, '#ae017e'], [400, '#f768a1']];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(x) { return typeof x === 'number' && isFinite(x); }
  function f1(x, d) { return Number(x).toFixed(d == null ? 1 : d); }
  function comma(x) { return Math.round(x).toLocaleString('en-US'); }
  function utc(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; }
  function md(d) { return MON[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
  function addDays(d, n) { return new Date(d.getTime() + n * 864e5); }
  function doy(d) { return Math.round((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5); }
  /* the Central calendar day of a moment, as a UTC midnight Date */
  function ctDay(t) {
    try {
      var p = {};
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(t || new Date()).forEach(function (x) { p[x.type] = x.value; });
      return new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
    } catch (e) { var n = t || new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); }
  }
  function ctClock(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    try {
      var p = {};
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
      var h = +p.hour % 24, mi = p.minute;
      if (h === 12 && mi === '00') return 'noon CT';
      if (h === 0 && mi === '00') return 'midnight CT';
      return ((h % 12) || 12) + (mi === '00' ? '' : ':' + mi) + (h < 12 ? ' a.m.' : ' p.m.') + ' CT';
    } catch (e) { return ''; }
  }

  /* ---------- charts (pure; the tests run them in node) ---------- */
  /* a tick step that gives 4 to 7 lines over lo..hi */
  function nice(lo, hi, steps) {
    steps = steps || [0.05, 0.1, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
    var span = Math.max(hi - lo, 1e-9);
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i], a = Math.floor(lo / s + 1e-9) * s, b = Math.ceil(hi / s - 1e-9) * s;
      if ((b - a) / s <= 6) return { step: s, lo: a, hi: b === a ? a + s : b };
    }
    return { step: span, lo: lo, hi: hi };
  }
  /* the Friday close date of each weekly bar: weekly bars are dated by their Monday (hist_to is the current week's) */
  function fridays(histTo, n) {
    var to = utc(histTo); if (!to) return null;
    var out = [];
    for (var i = n; i >= 1; i--) out.push(addDays(to, -7 * i + 4));
    return out;
  }
  function money2(v) { return '$' + f1(v, 2); }
  function attr(pal, k) { return pal && pal[k] ? ' style="' + pal[k] + '"' : ''; }

  /* futures line chart. ds: Dates, vs: dollars, cur: the label on today's point. pal: inline styles (the saved picture) */
  function lineSvg(o) {
    var ds = o.d, vs = o.v, w = o.w, h = o.h, fs = o.fs || 12, pal = o.pal || null, uid = o.uid || 'c';
    var pl = 50, pr = 96, pt = 18, pb = 28;
    var mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
    var t = nice(mn, mx, [0.05, 0.1, 0.25, 0.5, 1, 2]);
    var y0 = t.lo, y1 = t.hi, t0 = ds[0].getTime(), t1 = ds[ds.length - 1].getTime();
    var X = function (d) { return pl + (d.getTime() - t0) / (t1 - t0) * (w - pl - pr); };
    var Y = function (v) { return pt + (y1 - v) / (y1 - y0) * (h - pt - pb); };
    var o2 = ['<svg class="ch" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(o.label) + '" style="font-size:' + fs + 'px' + (pal ? ';font-family:' + pal.font : '') + '">'];
    o2.push('<defs><linearGradient id="g' + uid + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" class="ch-fill-a"' + (pal ? ' stop-color="' + pal.gold + '" stop-opacity=".22"' : '') + '/><stop offset="1" class="ch-fill-b"' + (pal ? ' stop-color="' + pal.gold + '" stop-opacity="0"' : '') + '/></linearGradient></defs>');
    for (var v = y0; v <= y1 + 1e-9; v += t.step) {
      var y = Y(v);
      o2.push('<line class="ch-grid"' + attr(pal, 'grid') + ' x1="' + pl + '" x2="' + (w - pr + 8) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>');
      o2.push('<text class="ch-ax"' + attr(pal, 'ax') + ' x="' + (pl - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + money2(v) + '</text>');
    }
    var yb = h - pb;
    o2.push('<line class="ch-base"' + attr(pal, 'base') + ' x1="' + pl + '" x2="' + (w - pr + 8) + '" y1="' + yb + '" y2="' + yb + '"/>');
    var labs = [[ds[0], md(ds[0]), 'start']];
    var m = new Date(Date.UTC(ds[0].getUTCFullYear(), ds[0].getUTCMonth() + 1, 1));
    while (m.getTime() < t1) { labs.push([m, MON[m.getUTCMonth()], 'middle']); m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1)); }
    labs.push([ds[ds.length - 1], md(ds[ds.length - 1]), 'end']);
    labs.forEach(function (L) {
      var x = X(L[0]);
      if (L[2] === 'middle' && (x - X(ds[0]) < 52 || X(ds[ds.length - 1]) - x < 50)) return;
      o2.push('<line class="ch-tick"' + attr(pal, 'base') + ' x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + yb + '" y2="' + (yb + 4) + '"/>');
      o2.push('<text class="ch-ax"' + attr(pal, 'ax') + ' x="' + x.toFixed(1) + '" y="' + (yb + 17) + '" text-anchor="' + L[2] + '">' + L[1] + '</text>');
    });
    var pts = ds.map(function (d, i) { return X(d).toFixed(1) + ',' + Y(vs[i]).toFixed(1); }).join(' ');
    o2.push('<polygon fill="url(#g' + uid + ')" points="' + X(ds[0]).toFixed(1) + ',' + yb + ' ' + pts + ' ' + X(ds[ds.length - 1]).toFixed(1) + ',' + yb + '"/>');
    o2.push('<polyline class="ch-line"' + attr(pal, 'line') + ' points="' + pts + '"/>');
    var hi = 0; for (var i = 1; i < vs.length; i++) if (vs[i] > vs[hi]) hi = i;
    var xh = X(ds[hi]), yh = Y(vs[hi]);
    if (hi < vs.length - 1) {
      o2.push('<circle class="ch-hi"' + attr(pal, 'hi') + ' cx="' + xh.toFixed(1) + '" cy="' + yh.toFixed(1) + '" r="3"/>');
      var anc = xh < pl + 60 ? 'start' : 'middle';
      o2.push('<text class="ch-note"' + attr(pal, 'note') + ' x="' + xh.toFixed(1) + '" y="' + (yh - 8).toFixed(1) + '" text-anchor="' + anc + '">High ' + money2(vs[hi]) + ', ' + md(ds[hi]) + '</text>');
    }
    var xc = X(ds[ds.length - 1]), yc = Y(vs[vs.length - 1]);
    o2.push('<line class="ch-cur-l"' + attr(pal, 'curl') + ' x1="' + pl + '" x2="' + xc.toFixed(1) + '" y1="' + yc.toFixed(1) + '" y2="' + yc.toFixed(1) + '"/>');
    o2.push('<circle class="ch-cur-o"' + attr(pal, 'curo') + ' cx="' + xc.toFixed(1) + '" cy="' + yc.toFixed(1) + '" r="6"/><circle class="ch-cur"' + attr(pal, 'cur') + ' cx="' + xc.toFixed(1) + '" cy="' + yc.toFixed(1) + '" r="3.5"/>');
    o2.push('<rect class="ch-tag"' + attr(pal, 'cur') + ' x="' + (xc + 10).toFixed(1) + '" y="' + (yc - 12).toFixed(1) + '" width="' + (pr - 14) + '" height="24" rx="5"/>');
    o2.push('<text class="ch-tag-t"' + attr(pal, 'tagt') + ' x="' + (xc + 10 + (pr - 14) / 2).toFixed(1) + '" y="' + (yc + 4.5).toFixed(1) + '" text-anchor="middle">' + esc(o.cur) + '</text>');
    o2.push('</svg>');
    return o2.join('');
  }

  /* cumulative this year against normal. xs: day of year; a: this year; b: normal; xl: [[x, label, anchor]] */
  function cumSvg(o) {
    var xs = o.x, a = o.a, b = o.b, w = o.w, h = o.h, fs = o.fs || 12, fmt = o.fmt;
    var pl = 44, pr = 12, pt = 16, pb = 28;
    var t = nice(0, Math.max(Math.max.apply(null, a), Math.max.apply(null, b)) * 1.04, o.steps);
    var ymax = t.hi, x0 = xs[0], x1 = xs[xs.length - 1];
    var X = function (d) { return pl + (d - x0) / (x1 - x0) * (w - pl - pr); };
    var Y = function (v) { return pt + (ymax - v) / ymax * (h - pt - pb); };
    var s = ['<svg class="ch" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(o.label) + '" style="font-size:' + fs + 'px">'];
    s.push('<defs><linearGradient id="g' + o.uid + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" class="ch-fill-a"/><stop offset="1" class="ch-fill-b"/></linearGradient></defs>');
    for (var v = 0; v <= ymax + 1e-9; v += t.step) {
      s.push('<line class="' + (v === 0 ? 'ch-base' : 'ch-grid') + '" x1="' + pl + '" x2="' + (w - pr) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/>');
      s.push('<text class="ch-ax" x="' + (pl - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end">' + fmt(v) + '</text>');
    }
    o.xl.forEach(function (L) {
      s.push('<line class="ch-tick" x1="' + X(L[0]).toFixed(1) + '" x2="' + X(L[0]).toFixed(1) + '" y1="' + (h - pb) + '" y2="' + (h - pb + 4) + '"/>');
      s.push('<text class="ch-ax" x="' + X(L[0]).toFixed(1) + '" y="' + (h - pb + 17) + '" text-anchor="' + L[2] + '">' + L[1] + '</text>');
    });
    var pa = xs.map(function (x, i) { return X(x).toFixed(1) + ',' + Y(a[i]).toFixed(1); }).join(' ');
    var pn = xs.map(function (x, i) { return X(x).toFixed(1) + ',' + Y(b[i]).toFixed(1); }).join(' ');
    s.push('<polygon fill="url(#g' + o.uid + ')" points="' + X(x0).toFixed(1) + ',' + Y(0).toFixed(1) + ' ' + pa + ' ' + X(x1).toFixed(1) + ',' + Y(0).toFixed(1) + '"/>');
    s.push('<polyline class="ch-norm" points="' + pn + '"/><polyline class="ch-line" points="' + pa + '"/>');
    var xe = X(x1), ye = Y(a[a.length - 1]), yn = Y(b[b.length - 1]);
    s.push('<circle class="ch-cur-o" cx="' + xe.toFixed(1) + '" cy="' + ye.toFixed(1) + '" r="6"/><circle class="ch-cur" cx="' + xe.toFixed(1) + '" cy="' + ye.toFixed(1) + '" r="3.5"/>');
    s.push('<circle class="ch-normdot" cx="' + xe.toFixed(1) + '" cy="' + yn.toFixed(1) + '" r="3"/>');
    var above = ye <= yn;
    s.push('<text class="ch-val" x="' + (xe - 10).toFixed(1) + '" y="' + (above ? ye - 10 : ye + 18).toFixed(1) + '" text-anchor="end">' + esc(o.now) + '</text>');
    s.push('</svg>');
    return s.join('');
  }

  /* every recorded farmland sale over 24 months, price per acre, with the county median and its middle half */
  function landSvg(o) {
    var rows = o.rows, w = o.w, h = o.h, fs = o.fs || 12, med = o.med, q1 = o.q1, q3 = o.q3;
    var pl = 58, pr = 14, pt = 14, pb = 28;
    var ppas = rows.map(function (r) { return r.ppa; }).sort(function (x, y) { return x - y; });
    var pc = function (q) { return ppas[Math.max(0, Math.min(ppas.length - 1, Math.round(q * (ppas.length - 1))))]; };
    var t = nice(Math.min(pc(0.03), q1 || pc(0.03)), Math.max(pc(0.97), q3 || pc(0.97)), [500, 1000, 2000, 2500, 4000, 5000, 10000]);
    var y0 = t.lo, y1 = t.hi, d0 = o.from.getTime(), d1 = o.to.getTime();
    var X = function (d) { return pl + (d.getTime() - d0) / (d1 - d0) * (w - pl - pr); };
    var Y = function (v) { return pt + (y1 - v) / (y1 - y0) * (h - pt - pb); };
    var s = ['<svg class="ch" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(o.label) + '" style="font-size:' + fs + 'px">'];
    if (num(q1) && num(q3) && q3 > q1) s.push('<rect class="ch-band" x="' + pl + '" y="' + Y(Math.min(q3, y1)).toFixed(1) + '" width="' + (w - pl - pr) + '" height="' + (Y(Math.max(q1, y0)) - Y(Math.min(q3, y1))).toFixed(1) + '"/>');
    for (var v = y0; v <= y1 + 1e-9; v += t.step) {
      s.push('<line class="ch-grid" x1="' + pl + '" x2="' + (w - pr) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/>');
      s.push('<text class="ch-ax" x="' + (pl - 8) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end">$' + (v >= 1000 ? (v / 1000) + 'k' : comma(v)) + '</text>');
    }
    var yb = h - pb;
    s.push('<line class="ch-base" x1="' + pl + '" x2="' + (w - pr) + '" y1="' + yb + '" y2="' + yb + '"/>');
    var labs = [[o.from, MON[o.from.getUTCMonth()] + ' ' + o.from.getUTCFullYear(), 'start'], [o.to, MON[o.to.getUTCMonth()] + ' ' + o.to.getUTCFullYear(), 'end']];
    var mid = new Date(Date.UTC(o.to.getUTCFullYear(), 0, 1));
    if (mid.getTime() > d0 && X(mid) - pl > 90 && (w - pr) - X(mid) > 80) labs.push([mid, 'Jan ' + mid.getUTCFullYear(), 'middle']);
    labs.forEach(function (L) { s.push('<text class="ch-ax" x="' + X(L[0]).toFixed(1) + '" y="' + (yb + 17) + '" text-anchor="' + L[2] + '">' + L[1] + '</text>'); });
    var off = 0;
    rows.forEach(function (r) {
      if (r.ppa > y1 || r.ppa < y0) { off++; return; }
      s.push('<circle class="ch-dot" cx="' + X(r.d).toFixed(1) + '" cy="' + Y(r.ppa).toFixed(1) + '" r="' + (3 + Math.min(4, (r.acres || 40) / 60)).toFixed(1) + '"/>');
    });
    if (o.ring && o.ring.ppa >= y0 && o.ring.ppa <= y1) s.push('<circle class="ch-cur-o" cx="' + X(o.ring.d).toFixed(1) + '" cy="' + Y(o.ring.ppa).toFixed(1) + '" r="8"/>');
    if (num(med) && med >= y0 && med <= y1) {
      var tw = 128;
      s.push('<line class="ch-med" x1="' + pl + '" x2="' + (w - pr) + '" y1="' + Y(med).toFixed(1) + '" y2="' + Y(med).toFixed(1) + '"/>');
      s.push('<rect class="ch-tag" x="' + (w - pr - tw) + '" y="' + (Y(med) - 11).toFixed(1) + '" width="' + tw + '" height="22" rx="5"/>');
      s.push('<text class="ch-tag-t" x="' + (w - pr - tw / 2) + '" y="' + (Y(med) + 4).toFixed(1) + '" text-anchor="middle">Median $' + comma(med) + '</text>');
    }
    s.push('</svg>');
    return { svg: s.join(''), off: off, top: y1, bottom: y0 };
  }

  /* county names: "McLean" (our ZIP table) and "McLean County" (the rain files) are the same place */
  function county(s) {
    return String(s || '').toLowerCase().replace(/\b(county|parish|borough|census area|city and borough|municipality)\b/g, '')
      .replace(/\bsaint\b/g, 'st').replace(/[^a-z0-9]/g, '');
  }
  function countyName(c, st) {
    c = String(c || '').trim();
    if (!c || /\b(County|Parish|Borough|Census Area|Municipality)$/i.test(c)) return c;
    return c + (st === 'LA' ? ' Parish' : st === 'AK' ? ' Borough' : ' County');
  }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function quarters(c) {
    var a = Math.abs(c), wh = Math.floor(a + 1e-9), q = Math.round((a - wh) * 4);
    if (q === 4) { wh++; q = 0; }
    var part = ['', '1/4', '1/2', '3/4'][q];
    return wh && part ? wh + ' ' + part : (part || String(wh));
  }
  /* "10¢ over Dec" from a basis in dollars and the contract it is priced on */
  function basisWords(dollars, ref) {
    if (!num(dollars)) return '';
    var c = Math.round(dollars * 400) / 4;
    var r = String(ref || '').replace(/ \(inferred\)$/, '').replace(/\s*[’']\d\d$/, '');
    if (c === 0) return 'even with ' + (r || 'futures');
    return quarters(c) + '¢ ' + (c > 0 ? 'over ' : 'under ') + (r || 'futures');
  }
  var words = { basis: basisWords, county: countyName, quarters: quarters };

  var api = { lineSvg: lineSvg, cumSvg: cumSvg, landSvg: landSvg, nice: nice, fridays: fridays, county: county, words: words };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgHomePage = api;
  var doc = root.document;
  if (!doc || !doc.getElementById('hb-zip-form')) return;

  /* ---------- the page ---------- */
  function $(id) { return doc.getElementById(id); }
  function txt(id, t) { var e = $(id); if (e) e.textContent = t; return e; }
  function html(id, h) { var e = $(id); if (e) e.innerHTML = h; return e; }
  function timed(p, ms) {
    var to; var t = new Promise(function (_, rej) { to = setTimeout(function () { rej(new Error('timeout')); }, ms || 12000); });
    return Promise.race([p, t]).then(function (v) { clearTimeout(to); return v; }, function (e) { clearTimeout(to); throw e; });
  }
  var memo = {};
  function getJSON(u, ms) {
    if (!memo[u]) memo[u] = timed(fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }), ms)
      .then(null, function (e) { delete memo[u]; throw e; });
    return memo[u];
  }
  function getBin(u) { return timed(fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }), 20000); }
  function script(src, test) {
    if (test()) return Promise.resolve();
    return new Promise(function (ok, no) {
      var s = doc.createElement('script'); s.src = src; s.async = true;
      s.onload = function () { test() ? ok() : no(new Error('script')); }; s.onerror = function () { no(new Error('script')); };
      doc.head.appendChild(s);
    });
  }
  function ga(n, p) { try { p = p || {}; p.page = 'home'; if (typeof root.gtag === 'function') root.gtag('event', n, p); } catch (e) {} }
  var PHONE = root.matchMedia ? root.matchMedia('(max-width:640px)') : null;
  function phone() { return !!(PHONE && PHONE.matches); }
  function later(el, fn) {
    if (!el) return;
    if (!('IntersectionObserver' in root)) { fn(); return; }
    var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); fn(); } }, { rootMargin: '400px 0px' });
    io.observe(el);
  }

  /* ---- place ---- */
  function readPlace() { try { return root.AgSavedPlace ? root.AgSavedPlace.read() : null; } catch (e) { return null; } }
  function hasZip(p) { return !!(p && /^\d{5}$/.test(String(p.zip || ''))); }
  var looking = '', lookT = null, shownZip = '';
  function say(t, err) { var m = $('hb-zip-msg'); if (m) { m.textContent = t || ''; m.className = 'hp-zmsg' + (err ? ' err' : ''); } }
  function paintPlace(p) {
    p = p || readPlace();
    var z = hasZip(p);
    doc.documentElement.classList.toggle('has-zip', z || !!looking);
    var inp = $('hb-zip');
    if (inp && z && doc.activeElement !== inp && !looking) inp.value = p.zip;
    var t = $('hb-place-t');
    if (t) {
      if (looking) t.textContent = 'Looking up ZIP ' + looking;
      else if (z) {
        t.textContent = p.town ? p.town + (p.state ? ', ' + p.state : '') : 'ZIP ' + p.zip;
        if (p.county) { var c = doc.createElement('span'); c.className = 'c'; c.textContent = ' · ' + countyName(p.county, p.state); t.appendChild(c); }
      } else t.textContent = '';
    }
    txt('hp-bids-near', z ? 'near ' + p.zip : 'near you');
    txt('hp-wx-where', z ? ', ' + p.zip : '');
    var href = z ? '/cash-bids?zip=' + p.zip : '/cash-bids';
    ['hp-bids-all', 'hp-t-corn', 'hp-t-soy'].forEach(function (id) { var a = $(id); if (a) a.setAttribute('href', href); });
    var bl = $('hp-basis-l');
    if (bl) {
      if (p && NAMES[p.state]) { bl.setAttribute('href', '/basis/' + slug(NAMES[p.state])); bl.textContent = NAMES[p.state] + ' basis against normal →'; }
      else { bl.setAttribute('href', '/basis'); bl.textContent = 'Basis by state, against normal →'; }
    }
    var ff = $('hp-ff'); if (ff && p && p.county) ff.textContent = 'Fast Facts for ' + countyName(p.county, p.state);
    if (z && p.zip !== shownZip) { var was = shownZip; shownZip = p.zip; if (was) placeChanged(); }
  }
  function fullPlace() {
    try { if (root.AgSavedPlace) return root.AgSavedPlace.full().then(function (p) { return p || readPlace(); }, function () { return readPlace(); }); } catch (e) {}
    return Promise.resolve(readPlace());
  }
  function landed() {
    var p = readPlace();
    if (looking && p && p.zip === looking) { looking = ''; clearTimeout(lookT); say(''); }
    paintPlace(p);
    fullPlace().then(function (q) { paintPlace(q); });
  }
  function sendZip(z) { if (typeof root.agsistSetZip === 'function') { root.agsistSetZip(z); return true; } return false; }
  function submitZip(ev) {
    if (ev) ev.preventDefault();
    var inp = $('hb-zip'), z = String(inp && inp.value || '').replace(/\D/g, '');
    if (z.length !== 5) { say('Enter a 5-digit ZIP code.', true); if (inp) { inp.setAttribute('aria-invalid', 'true'); inp.focus(); } return; }
    if (inp) { inp.removeAttribute('aria-invalid'); inp.value = z; inp.blur(); }
    say('');
    ga('bids_search', { method: 'zip' });
    try { if (root.AgSavedPlace) root.AgSavedPlace.save(z); } catch (e) {}
    looking = z; paintPlace();
    if (!sendZip(z)) { var n = 0; (function wait() { if (sendZip(z)) return; if (++n < 40) setTimeout(wait, 250); })(); }
    fullPlace().then(function () { if (looking === z) { looking = ''; say(''); } landed(); });
    clearTimeout(lookT);
    lookT = setTimeout(function () { if (looking === z) { looking = ''; paintPlace(); say('ZIP ' + z + ' did not load. Check it, or try again in a minute.', true); } }, 12000);
  }
  function useLocation() {
    say('Finding your location…');
    ga('location_tap', {});
    var before = (readPlace() || {}).zip || '';
    if (typeof root.requestGeo === 'function') root.requestGeo();
    else { say('Location is not ready yet. Type your ZIP.', true); return; }
    var n = 0;
    (function wait() {
      var p = readPlace();
      if (p && p.zip && (p.zip !== before || n > 2) && p.lat != null) { say(''); landed(); return; }
      if (++n < 40) setTimeout(wait, 300); else say('Your location did not come through. Type your ZIP.', true);
    })();
  }

  /* ---- cash bid tiles (components/bids-homepage.js publishes agsist:bids-top) ---- */
  var TILE = { corn: ['hp-t-corn', 'corn'], soybeans: ['hp-t-soy', 'soybean'] };
  function fmt() { return root.agsistBidFmt || null; }
  function miles(m) { return m < 1 ? 'under 1 mi' : (m < 10 ? f1(m) : Math.round(m)) + ' mi'; }
  function paintTiles(d) {
    if (!d || typeof d !== 'object') return;
    var F = fmt(), r = num(d.radiusMi) ? Math.round(d.radiusMi) : 50;
    if (d.place) landed();
    if (num(d.count) && d.count > 0) txt('hp-bids-all', 'All ' + d.count + ' bids');
    Object.keys(TILE).forEach(function (k) {
      var id = TILE[k][0], w = TILE[k][1], b = d[k], el = $(id);
      if (!el) return;
      el.classList.remove('old');
      if (b && num(b.cash)) {
        html(id + '-p', F ? F.cash(b.cash, 'hp-frac') : money2(b.cash));
        txt(id + '-e', b.name + (b.town ? ', ' + b.town.replace(/, [A-Z]{2}$/, '') : ''));
        var bits = [];
        if (num(b.mi)) bits.push(miles(b.mi));
        if (b.month) bits.push(b.month);
        var bw = basisWords(b.basis, b.ref); if (bw) bits.push(bw);
        if (b.stale && b.posted && F) { bits.push('posted ' + F.day(b.posted)); el.classList.add('old'); }
        txt(id + '-x', bits.join(' · '));
        el.setAttribute('data-board-key', b.boardKey || '');
        return;
      }
      el.removeAttribute('data-board-key');
      var st = d.status || 'none';
      if (st === 'pending') { html(id + '-p', '<span class="hp-skel" aria-hidden="true"></span><span class="vh">Loading</span>'); txt(id + '-e', ''); txt(id + '-x', ''); return; }
      html(id + '-p', '<span class="hp-mut">-</span>');
      txt(id + '-e', st === 'failed' ? 'Cash bids did not load.' : st === 'nozip' ? 'Type your ZIP above.' : 'No ' + w + ' bid within ' + r + ' miles.');
      txt(id + '-x', st === 'failed' ? 'Try again in a minute, or open the cash bids page.' : '');
    });
  }
  function paintNear(d) {
    var tb = doc.querySelector('#hp-near tbody'), msg = $('hp-near-msg'), F = fmt();
    if (!tb || !d) return;
    var rows = Array.isArray(d.near) ? d.near.filter(function (b) { return b && num(b.cash); }).slice(0, 7) : null;
    if (!rows) { if (d.status === 'failed' && msg) msg.textContent = 'Cash bids did not load. Open the cash bids page, or try again in a minute.'; return; }
    if (msg) msg.textContent = rows.length ? '' : 'No corn or soybean cash bid within ' + (num(d.radiusMi) ? Math.round(d.radiusMi) : 50) + ' miles.';
    var z = (readPlace() || {}).zip || '', out = rows.map(function (b) {
      var sub = [num(b.mi) ? miles(b.mi) : '', (b.crop === 'soybeans' ? 'soybeans' : 'corn') + (b.month ? ', ' + b.month : '')].filter(Boolean).join(' \u00b7 ');
      var bw = basisWords(b.basis, b.ref) + (b.stale && b.posted && F ? ' \u00b7 posted ' + F.day(b.posted) : '');
      return '<tr><td><a href="/cash-bids' + (z ? '?zip=' + z : '') + '">' + esc(b.name) + '</a><span class="s">' + esc(sub) + '</span></td><td class="n">'
        + (F ? F.cash(b.cash, 'hp-frac') : money2(b.cash)) + '<span class="b">' + esc(bw || '\u00a0') + '</span></td></tr>';
    });
    for (var i = out.length; i < 7; i++) out.push('<tr aria-hidden="true"><td>&nbsp;<span class="s">&nbsp;</span></td><td class="n">&nbsp;<span class="b">&nbsp;</span></td></tr>');
    tb.innerHTML = out.join('');
  }

  /* ---- futures: the header from data/prices.json, the charts from data/price-stats.json ---- */
  var PX = null, STATS = null;
  var CROPS = [['corn', 'fc', 'corn', 'hp-ch-corn', 'Corn'], ['beans', 'fs', 'soybean', 'hp-ch-soy', 'Soybean']];
  function headline(crop) { try { return root.AgPxStamp && root.AgPxStamp.headline(PX, crop); } catch (e) { return null; } }
  function paintHeader() {
    var A = root.AG && root.AG.px;
    if (!PX || !A) return;
    CROPS.forEach(function (c) {
      var h = headline(c[0]); if (!h || !h.q || !num(h.q.close)) return;
      var q = h.q;
      txt('hb-' + c[1] + '-k', (h.label ? h.label + ' ' : '') + c[2] + ' futures');
      html('hb-' + c[1] + '-v', '<span class="hb-n">' + A.price(q.close, { style: 'slash', fracClass: 'hb-frac' }) + '</span>');
      var diff = num(q.netChange) ? q.netChange : (num(q.open) ? q.close - q.open : null), chg = '';
      if (num(diff)) {
        var cl = diff > 0 ? 'up' : diff < 0 ? 'dn' : 'nc';
        var ar = diff > 0 ? '<span aria-hidden="true">▲ </span><span class="vh">up </span>' : diff < 0 ? '<span aria-hidden="true">▼ </span><span class="vh">down </span>' : '';
        chg = '<span class="hb-l"><span class="hb-n hb-chg ' + cl + '">' + ar + A.move(diff, { style: 'slash', sign: true }) + '</span></span>';
      }
      var when = '';
      try { when = root.AgPxStamp.shortStamp(q, PX.fetched); } catch (e) {}
      html('hb-' + c[1] + '-s', chg + '<span class="hb-l hb-age">' + esc(when) + '</span>');
    });
  }
  function chartData(c) {
    var key = c[0] === 'corn' ? 'corn' : 'soybean', s = STATS && STATS[key], h = headline(c[0]);
    if (!s || !Array.isArray(s.hist) || s.hist.length < 19 || !h || !num(h.q.close)) return null;
    var ds = fridays(s.hist_to, 19), vs = s.hist.slice(-19);
    if (!ds || vs.some(function (v) { return !num(v) || v <= 0; })) return null;
    var today = utc(h.q.close_date) || ctDay();
    if ((today.getTime() - ds[ds.length - 1].getTime()) / 864e5 > 21) return null;   /* the history is old: no chart */
    if (today.getTime() <= ds[ds.length - 1].getTime()) return null;
    var A = root.AG && root.AG.px, cur = A ? A.priceDollars(h.q.close / 100, { style: 'slash' }).replace(/<[^>]+>/g, '') : money2(h.q.close / 100);
    return { d: ds.concat([today]), v: vs.concat([h.q.close / 100]), cur: cur, label: h.label || '' };
  }
  function chartLabel(c, cd) {
    var vs = cd.v, ds = cd.d, hi = 0; for (var i = 1; i < vs.length; i++) if (vs[i] > vs[hi]) hi = i;
    return c[4] + ' futures, 20 weeks: ' + money2(vs[0]) + ' on ' + md(ds[0]) + ', ' + money2(vs[vs.length - 1]) + ' on ' + md(ds[ds.length - 1]) + '; high ' + money2(vs[hi]) + ' on ' + md(ds[hi]) + '.';
  }
  function drawCharts() {
    var ph = phone();
    CROPS.forEach(function (c) {
      var box = $(c[3]); if (!box) return;
      var cd = chartData(c), msg = box.querySelector('.hp-cmsg');
      var old = box.querySelector('svg'); if (old) old.parentNode.removeChild(old);
      if (!cd) { if (msg) msg.textContent = (STATS ? 'No chart: the weekly price history is not current.' : 'No chart: the price history did not load.'); return; }
      if (msg) msg.textContent = '';
      box.insertAdjacentHTML('afterbegin', lineSvg({ d: cd.d, v: cd.v, w: ph ? 366 : 446, h: ph ? 190 : 290, fs: ph ? 11 : 12, uid: c[1] + (ph ? 'm' : 'd'), cur: cd.cur, label: chartLabel(c, cd) }));
    });
    var s0 = STATS && STATS.corn && fridays(STATS.corn.hist_to, 19);
    var cd0 = chartData(CROPS[0]);
    if (s0 && cd0) txt('hp-fut-src', 'Chicago futures; your elevator’s cash bid is futures plus its basis. Friday closes of the front month, ' + md(s0[0]) + ' to ' + md(s0[18]) + '; the last point is today’s price of the contract named above. Yahoo Finance, delayed 10 to 25 min.');
  }

  /* Save picture (E10): both charts, the date, the units and the source, in fixed dark colors */
  var PAL = { font: 'Helvetica, Arial, sans-serif', gold: '#d4a23f', grid: 'stroke:#22292b;stroke-width:1', base: 'stroke:#3a4346;stroke-width:1', ax: 'fill:#a9b3b0',
    line: 'fill:none;stroke:#d4a23f;stroke-width:2.5;stroke-linejoin:round', hi: 'fill:#0a0c0d;stroke:#a9b3b0;stroke-width:1.5', note: 'fill:#a9b3b0',
    curl: 'stroke:#d4a23f;stroke-dasharray:3 4;opacity:.55', curo: 'fill:none;stroke:#d4a23f;stroke-width:1.5;opacity:.55', cur: 'fill:#d4a23f', tagt: 'fill:#0a0c0d;font-weight:700' };
  function savePicture() {
    var parts = CROPS.map(function (c) { return { c: c, d: chartData(c) }; }).filter(function (x) { return x.d; });
    var btn = $('hp-save');
    if (!parts.length) { if (btn) btn.textContent = 'Picture not ready'; return; }
    var W = 1200, H = 630, today = ctDay(), y = 150;
    var s = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="Helvetica, Arial, sans-serif">',
      '<rect width="' + W + '" height="' + H + '" fill="#0a0c0d"/><rect width="' + W + '" height="8" fill="#d4a23f"/>',
      '<text x="48" y="70" fill="#e9edeb" font-size="34" font-weight="700">Corn and soybean futures, last 20 weeks</text>',
      '<text x="48" y="108" fill="#a9b3b0" font-size="20">' + esc(md(today) + ', ' + today.getUTCFullYear()) + ' · dollars per bushel · Friday closes of the front month, then today</text>'];
    parts.forEach(function (p, i) {
      var x = 48 + i * 560;
      s.push('<text x="' + x + '" y="' + (y + 10) + '" fill="#e9edeb" font-size="24" font-weight="700">' + esc(p.c[4] + ' ' + (p.d.label ? p.d.label + ' ' : '') + p.d.cur) + '</text>');
      s.push('<g transform="translate(' + x + ',' + (y + 28) + ')">' + lineSvg({ d: p.d.d, v: p.d.v, w: 540, h: 330, fs: 15, pal: PAL, uid: 's' + i, cur: p.d.cur, label: '' }).replace(/^<svg[^>]*>/, '<svg width="540" height="330" viewBox="0 0 540 330" font-size="15" font-family="Helvetica, Arial, sans-serif">') + '</g>');
    });
    s.push('<text x="48" y="588" fill="#a9b3b0" font-size="18">Yahoo Finance, delayed. A cash bid is futures plus the elevator’s basis.</text>');
    s.push('<text x="' + (W - 48) + '" y="588" fill="#d4a23f" font-size="22" font-weight="700" text-anchor="end">agsist.com</text></svg>');
    var img = new Image();
    img.onload = function () {
      var cv = doc.createElement('canvas'); cv.width = W; cv.height = H;
      cv.getContext('2d').drawImage(img, 0, 0);
      cv.toBlob(function (blob) {
        if (!blob) return;
        var name = 'agsist-futures-' + today.toISOString().slice(0, 10) + '.png';
        var file = null; try { file = new File([blob], name, { type: 'image/png' }); } catch (e) {}
        if (file && navigator.canShare && navigator.canShare({ files: [file] }) && phone()) {
          navigator.share({ files: [file], title: 'Corn and soybean futures', text: 'agsist.com' }).catch(function () {});
          ga('share_open', { kit: 'home-futures' });
          return;
        }
        var a = doc.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
        doc.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
        ga('picture_download', { kit: 'home-futures' });
      }, 'image/png');
    };
    img.onerror = function () { if (btn) btn.textContent = 'Picture not ready'; };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s.join(''));
  }

  /* ---- more markets ---- */
  var MK = { wheat: 'c', kcwheat: 'c', oats: 'c', meal: 'd', soyoil: 'c2', cattle: 'd', feeders: 'd', hogs: 'd', milk: 'd' };
  function paintMarkets() {
    var A = root.AG && root.AG.px, q = PX && PX.quotes;
    if (!q || !A) return;
    var rows = doc.querySelectorAll('#hp-mk tbody tr'), n = 0;
    Array.prototype.forEach.call(rows, function (tr) {
      var k = tr.getAttribute('data-k'), d = q[k], kind = MK[k], td = tr.querySelectorAll('td');
      if (!d || !num(d.close) || td.length < 3) return;
      var last = kind === 'c' ? A.price(d.close, { style: 'slash' }).replace(/<[^>]+>/g, '') : kind === 'c2' ? f1(d.close, 2) + '¢' : '$' + Number(d.close).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      var v = num(d.netChange) ? d.netChange : null, ch = '<span class="nc">-</span>';
      if (v != null) {
        if (Math.abs(v) < 1e-9) ch = '<span class="nc">unch.</span>';
        else ch = '<span class="' + (v > 0 ? 'up' : 'dn') + '"><span aria-hidden="true">' + (v > 0 ? '▲' : '▼') + '</span><span class="vh">' + (v > 0 ? 'up' : 'down') + '</span> '
          + (kind === 'c' ? quarters(v) + '¢' : kind === 'c2' ? f1(Math.abs(v), 2) + '¢' : f1(Math.abs(v), 2)) + '</span>';
      }
      td[1].textContent = last; td[2].innerHTML = ch; n++;
    });
    var when = ''; try { when = root.AgPxStamp.shortStamp(q.wheat || q.cattle, PX.fetched); } catch (e) {}
    if (n) txt('hp-mk-src', 'Front month' + (when ? ', ' + when : '') + '. Yahoo Finance, delayed 10 to 25 min. Energy, metals and export sales are on All markets.');
  }

  /* ---- the Daily card ---- */
  function paintDaily(d) {
    if (!d) return;
    var t = String(d.teaser || d.headline || '').trim(); if (!t) return;
    var gen = d.generated_at ? ctDay(new Date(d.generated_at)) : null, today = ctDay();
    txt('daily-card-t', t);
    txt('daily-card-k', gen && gen.getTime() === today.getTime() ? 'Today:' : (gen ? 'Latest, ' + md(gen) + ':' : 'Latest:'));
  }

  /* ---- Rain Print (data/rain-print.json: prices and the real order-by date) ---- */
  function paintRainPrint(R) {
    if (!R) return;
    var d = function (k) { return num(R[k]) ? '$' + R[k] : null; };
    if (d('framed12x18')) txt('hp-rp-f', d('framed12x18'));
    if (d('print12x18')) txt('hp-rp-p', d('print12x18'));
    if (d('digital')) txt('hp-rp-d', d('digital'));
    var today = ctDay(), fc = utc(R.framed_christmas_cutoff), pc = utc(R.print_christmas_cutoff), from = utc(R.promote_from);
    var on = R.promote === true && (!from || today >= from);
    if (on && fc && today <= fc) {
      txt('hp-rpchip-t', (d('framed12x18') || '') + ' framed. Order by ' + md(fc) + ' for Christmas →');
      html('hp-rp-by', 'Order a framed print by <b>' + md(fc) + '</b> for Christmas.');
      txt('hp-rp-k', 'Rain Print · Christmas gift');
    } else if (on && pc && today <= pc) {
      txt('hp-rpchip-t', (d('print12x18') || '') + ' print. Order by ' + md(pc) + ' for Christmas →');
      html('hp-rp-by', 'Order a print by <b>' + md(pc) + '</b> for Christmas.');
      txt('hp-rp-k', 'Rain Print · Christmas gift');
    } else if (d('digital')) txt('hp-rpchip-t', 'From ' + d('digital') + '. Design yours →');
  }

  /* ---- weather band ---- */
  var band = { zip: '', seq: 0 };
  var WX = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
    56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow',
    75: 'Heavy snow', 77: 'Snow', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorms', 96: 'Thunderstorms', 99: 'Thunderstorms' };
  function compass(d) { return num(d) ? ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((d % 360) + 360) % 360 / 45) % 8] : ''; }
  function stateFile(dir, st, ext) { return '/data/' + dir + st.toLowerCase() + (ext || '.json'); }
  /* the reader's county in a state's rain file: {fips, c, near} (near: no station in the county; the file names the nearest county) */
  function findCounty(R, name) {
    var key = county(name), cs = (R && R.counties) || {}, k;
    if (!key) return null;
    for (k in cs) if (county(cs[k].name) === key) return { fips: k, c: cs[k] };
    var none = (R && R.none) || {};
    for (k in none) if (county(none[k].name) === key && cs[none[k].near]) return { fips: k, c: cs[none[k].near], near: none[k].near, nearName: cs[none[k].near].name };
    return null;
  }
  function msgIn(id, t) { var b = $(id); if (!b) return; var m = b.querySelector('.hp-msg'); if (m) m.textContent = t || ''; }
  function fcFail(t) { var m = $('hp-fc-msg'); if (m) { m.textContent = t; m.style.background = 'var(--surface)'; } }
  function drawForecast(p, seq) {
    if (!root.AgNWS) { fcFail('The forecast did not load. Try again in a few minutes.'); return; }
    root.AgNWS.forecast(p.lat, p.lon, { days: 8 }).then(function (f) {
      if (seq !== band.seq) return;
      var c = f.current || {}, D = f.daily || {};
      txt('hp-now-t', num(c.temperature_2m) ? Math.round(c.temperature_2m) + '°' : '--°');
      var w = [];
      if (num(c.wind_speed_10m)) w.push('Wind ' + compass(c.wind_direction_10m) + ' ' + Math.round(c.wind_speed_10m) + ' mph');
      if (num(c.relative_humidity_2m)) w.push('Humidity ' + Math.round(c.relative_humidity_2m) + '%');
      html('hp-now-d', '<b>' + esc(WX[c.weather_code] || 'Now') + '</b><br>' + w.map(esc).join('<br>'));
      var times = D.time || [], todayKey = (c.time || '').slice(0, 10), i0 = Math.max(0, times.indexOf(todayKey)), lis = [];
      if (!num((D.temperature_2m_max || [])[i0]) || !num((D.temperature_2m_min || [])[i0])) i0++;   /* today half gone: the grid has no full-day high and low, start tomorrow */
      for (var i = i0; i < Math.min(times.length, i0 + 7); i++) {
        var dd = utc(times[i]), hi = (D.temperature_2m_max || [])[i], lo = (D.temperature_2m_min || [])[i], pp = (D.precipitation_probability_max || [])[i];
        lis.push('<li><b>' + (times[i] === todayKey ? 'Today' : DOW[dd.getUTCDay()]) + '</b><span class="hi">' + (num(hi) ? Math.round(hi) + '°' : '-') + '</span> <span class="lo">' + (num(lo) ? Math.round(lo) + '°' : '-')
          + '</span><span class="pp">' + (num(pp) ? Math.round(pp) + '%<span class="pw"> rain</span>' : '-') + '</span></li>');
      }
      if (lis.length) html('hp-d7', lis.join(''));
      var src = 'Percent: chance of rain. National Weather Service forecast';
      try { var n = f._nws; if (n && n.updated) src += ', issued ' + new Date(n.updated).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: f.timezone || undefined, timeZoneName: 'short' }); } catch (e) {}
      txt('hp-fc-src', src + '.');
      fcFail(''); var m = $('hp-fc-msg'); if (m) m.style.background = '';
    }, function (e) {
      if (seq !== band.seq) return;
      fcFail(e && e.outside ? 'The National Weather Service has no forecast for this point.' : 'The National Weather Service forecast did not answer. Try again in a few minutes.');
    });
  }
  function drawRain(R, p, cf) {
    var c = cf && cf.c;
    if (!c || !Array.isArray(c.cum) || !c.cum.length || !num(c.total)) { msgIn('hp-rain-ch', 'No rain record for this county yet.'); txt('hp-rain-h', 'Rain this year'); return; }
    var yr = R.year || (utc(c.as_of) || ctDay()).getUTCFullYear(), end = utc(c.as_of || R.edate);
    var xs = [0], a = [0], b = [0];
    c.cum.forEach(function (r) { xs.push(r[0]); a.push(r[1]); b.push(r[2]); });
    var ph = phone(), lastX = xs[xs.length - 1];
    var xl = [[0, 'Jan 1', 'start']];
    [[3, 'Apr'], [6, 'Jul'], [9, 'Oct']].forEach(function (m) { var x = doy(new Date(Date.UTC(yr, m[0], 1))); if (x < lastX - 40 && x > 40) xl.push([x, m[1], 'middle']); });
    xl.push([lastX, end ? md(end) : '', 'end']);
    var pct = num(c.pct) ? c.pct : (c.usual ? Math.round(c.total / c.usual * 100) : null);
    txt('hp-rain-h', 'Rain this year: ' + f1(c.total) + ' in' + (num(pct) ? ', ' + pct + '% of normal' : ''));
    txt('hp-yr', String(yr));
    var key = $('hp-rain-key'); if (key && num(c.usual)) key.lastChild.lastChild.textContent = 'Normal: ' + f1(c.usual) + ' in (1991 to 2020)';
    var box = $('hp-rain-ch'); if (!box) return;
    var old = box.querySelector('svg'); if (old) old.remove();
    msgIn('hp-rain-ch', '');
    box.insertAdjacentHTML('afterbegin', cumSvg({ x: xs, a: a, b: b, w: ph ? 366 : 380, h: ph ? 200 : 250, fs: ph ? 11 : 12, uid: 'rn' + (ph ? 'm' : 'd'),
      fmt: function (v) { return v + ' in'; }, steps: [1, 2, 5, 10, 20], xl: xl, now: f1(c.total) + ' in',
      label: 'Rain since January 1: ' + f1(c.total) + ' inches; normal to date ' + f1(c.usual) + ' inches.' }));
    var st = c.station || {}, net = st.net === 'cocorahs' ? ' (CoCoRaHS)' : st.net ? ' (NOAA co-op)' : '';
    txt('hp-rain-src', 'Jan 1 to ' + (end ? md(end) : '') + '. ' + (cf.near ? 'No station in ' + countyName(p.county, p.state) + '; nearest county: ' + cf.nearName + '. ' : '') + (st.name ? 'Gauge: ' + st.name + net + '. ' : '') + 'NOAA daily records via RCC-ACIS.');
  }
  function drawGdu(W, p, fips) {
    var c = W && W.counties && W.counties[fips], yr = (W && W.year) || ctDay().getUTCFullYear();
    txt('hp-yr2', String(yr));
    if (!c || !Array.isArray(c.gm) || c.gm.length < 5 || !Array.isArray(c.g)) { msgIn('hp-gdu-ch', c && Array.isArray(c.gm) && c.gm.length < 5 ? 'The corn GDU season starts May 1.' : 'No GDU record for this county yet.'); return; }
    var end = utc(W.edate), xs = [doy(new Date(Date.UTC(yr, 4, 1)))], a = [0], b = [0];
    for (var m = 4; m < c.gm.length; m++) {
      var g = c.gm[m]; if (!Array.isArray(g) || !num(g[0]) || !num(g[1])) break;
      var mend = m === c.gm.length - 1 && end ? doy(end) : doy(new Date(Date.UTC(yr, m + 1, 0)));
      xs.push(mend); a.push(a[a.length - 1] + g[0]); b.push(b[b.length - 1] + g[1]);
    }
    if (xs.length < 2) { msgIn('hp-gdu-ch', 'The corn GDU season starts May 1.'); return; }
    var now = c.g[0], norm = c.g[2], ph = phone(), lastX = xs[xs.length - 1];
    var xl = [[xs[0], 'May 1', 'start']];
    [[6, 'Jul'], [8, 'Sep']].forEach(function (mm) { var x = doy(new Date(Date.UTC(yr, mm[0], 1))); if (x < lastX - 35) xl.push([x, mm[1], 'middle']); });
    xl.push([lastX, end ? md(end) : '', 'end']);
    txt('hp-gdu-h', 'Corn GDUs since May 1: ' + comma(now) + (num(norm) ? ' (' + (now - norm >= 0 ? '+' : '−') + comma(Math.abs(now - norm)) + ')' : ''));
    var key = $('hp-gdu-h').parentNode.querySelector('.hp-key'); if (key && num(norm)) key.lastChild.lastChild.textContent = 'Normal: ' + comma(norm) + ' (1991 to 2020)';
    var box = $('hp-gdu-ch'), old = box && box.querySelector('svg'); if (old) old.remove();
    msgIn('hp-gdu-ch', '');
    box.insertAdjacentHTML('afterbegin', cumSvg({ x: xs, a: a, b: b, w: ph ? 366 : 380, h: ph ? 200 : 250, fs: ph ? 11 : 12, uid: 'gd' + (ph ? 'm' : 'd'),
      fmt: function (v) { return v ? (v >= 1000 ? (v / 1000) + 'k' : String(v)) : '0'; }, steps: [100, 250, 500, 1000], xl: xl, now: comma(now) + ' GDUs',
      label: 'Corn growing degree units since May 1: ' + comma(now) + '; normal ' + comma(norm) + '.' }));
    var s = c.s && c.s[0] ? 'Station ' + c.s[0] + '. ' : '';
    txt('hp-gdu-src', 'May 1 to ' + (end ? md(end) : '') + ', 86/50 method, month ends. ' + s + 'NOAA daily records via RCC-ACIS.');
  }
  function drawRadar(p, seq) {
    var st = p.state;
    script('/components/radar-rain.js?v=1', function () { return !!root.AgRadarRain; })
      .then(function () { return Promise.all([getBin(stateFile('radar-rain/', st, '.bin')).then(root.AgRadarRain.parse), getJSON('/data/us-states.geo.json').catch(function () { return null; }), getJSON('/data/places/zip/' + p.zip.slice(0, 2) + '.json').catch(function () { return null; })]); })
      .then(function (r) {
        if (seq !== band.seq) return;
        var h = r[0].header, q = r[0].grids['7d'], win = (h.windows || []).filter(function (w) { return w.id === '7d'; })[0];
        if (!q || !win) throw new Error('no-window');
        var ph = phone(), W = ph ? 366 : 392, H = ph ? 330 : 352, lat = +p.lat, lon = +p.lon;
        var lonSpan = 3.1, latSpan = lonSpan * (H / W) * Math.cos(lat * Math.PI / 180);
        var lon0 = lon - lonSpan / 2, lon1 = lon + lonSpan / 2, lat0 = lat - latSpan / 2, lat1 = lat + latSpan / 2;
        var X = function (lo) { return (lo - lon0) / (lon1 - lon0) * W; }, Y = function (la) { return (lat1 - la) / (lat1 - lat0) * H; };
        var ca = Math.floor((lon0 - h.x0) / h.d), cb = Math.ceil((lon1 - h.x0) / h.d), ra = Math.floor((h.y0 - lat1) / h.d), rb = Math.ceil((h.y0 - lat0) / h.d);
        var cw = cb - ca + 1, rh = rb - ra + 1, cv = doc.createElement('canvas'); cv.width = cw; cv.height = rh;
        var ctx = cv.getContext('2d'), im = ctx.createImageData(cw, rh);
        for (var rr = 0; rr < rh; rr++) for (var cc = 0; cc < cw; cc++) {
          var R = ra + rr, C = ca + cc; if (R < 0 || R >= h.ny || C < 0 || C >= h.nx) continue;
          var v = q[R * h.nx + C]; if (!(v >= 1)) continue;
          var col = null; for (var k = 0; k < RR_COLORS.length; k++) if (v >= RR_COLORS[k][0]) col = RR_COLORS[k][1];
          var o = (rr * cw + cc) * 4; im.data[o] = parseInt(col.slice(1, 3), 16); im.data[o + 1] = parseInt(col.slice(3, 5), 16); im.data[o + 2] = parseInt(col.slice(5, 7), 16); im.data[o + 3] = 200;
        }
        ctx.putImageData(im, 0, 0);
        var ix = X(h.x0 + (ca - 0.5) * h.d), iy = Y(h.y0 - (ra - 0.5) * h.d), iw = X(h.x0 + (cb + 0.5) * h.d) - ix, ihh = Y(h.y0 - (rb + 0.5) * h.d) - iy;
        var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Radar rain, last 7 days, around ZIP ' + esc(p.zip) + '" style="font-size:' + (ph ? 11 : 12) + 'px"><rect class="rmap-bg" width="' + W + '" height="' + H + '"/>'];
        for (var gl = Math.ceil(lon0); gl <= lon1; gl++) s.push('<line class="rmap-gr" x1="' + X(gl).toFixed(1) + '" x2="' + X(gl).toFixed(1) + '" y1="0" y2="' + H + '"/>');
        for (var gt = Math.ceil(lat0); gt <= lat1; gt++) s.push('<line class="rmap-gr" x1="0" x2="' + W + '" y1="' + Y(gt).toFixed(1) + '" y2="' + Y(gt).toFixed(1) + '"/>');
        s.push('<image href="' + cv.toDataURL() + '" x="' + ix.toFixed(1) + '" y="' + iy.toFixed(1) + '" width="' + iw.toFixed(1) + '" height="' + ihh.toFixed(1) + '" preserveAspectRatio="none" style="image-rendering:pixelated"/>');
        var G = r[1];
        if (G && G.features) {
          var d = [];
          G.features.forEach(function (f) {
            var g = f.geometry; if (!g) return;
            var polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
            polys.forEach(function (poly) { poly.forEach(function (ring) {
              var inb = ring.some(function (pt) { return pt[0] > lon0 - 1 && pt[0] < lon1 + 1 && pt[1] > lat0 - 1 && pt[1] < lat1 + 1; });
              if (inb) d.push('M' + ring.map(function (pt) { return X(pt[0]).toFixed(1) + ',' + Y(pt[1]).toFixed(1); }).join('L') + 'Z');
            }); });
          });
          if (d.length) s.push('<path class="rmap-st" d="' + d.join('') + '"/>');
        }
        var Z = r[2], towns = {}, mx = X(lon), my = Y(lat);
        if (Z) Object.keys(Z).forEach(function (zz) {
          var t = Z[zz]; if (!Array.isArray(t) || !t[2]) return;
          var k2 = t[2] + '|' + t[3]; if (!towns[k2]) towns[k2] = { n: t[2], c: 0, la: 0, lo: 0 };
          towns[k2].c++; towns[k2].la += +t[0]; towns[k2].lo += +t[1];
        });
        var own = String(p.town || '').toLowerCase(), list = Object.keys(towns).map(function (k3) { var t = towns[k3]; return { n: t.n, c: t.c, x: X(t.lo / t.c), y: Y(t.la / t.c) }; })
          .filter(function (t) { return t.x > 20 && t.x < W - 20 && t.y > 16 && t.y < H - 10 && t.n.toLowerCase() !== own; })
          .sort(function (a2, b2) { return b2.c - a2.c; }), keep = [];
        list.forEach(function (t) {
          if (keep.length >= 6 || t.c < 2) return;
          if (Math.hypot(t.x - mx, t.y - my) < 55) return;
          if (keep.some(function (k4) { return Math.abs(k4.x - t.x) < 95 && Math.abs(k4.y - t.y) < 22; })) return;
          keep.push(t);
        });
        keep.forEach(function (t) {
          var right = t.x > W - 90;
          s.push('<circle class="rmap-tdot" cx="' + t.x.toFixed(1) + '" cy="' + t.y.toFixed(1) + '" r="2.5"/><text class="rmap-t" x="' + (t.x + (right ? -6 : 6)).toFixed(1) + '" y="' + (t.y + 4).toFixed(1) + '" text-anchor="' + (right ? 'end' : 'start') + '">' + esc(t.n) + '</text>');
        });
        s.push('<circle cx="' + mx.toFixed(1) + '" cy="' + my.toFixed(1) + '" r="7" fill="#ffd23f" stroke="#111" stroke-width="2"/><text class="rmap-me" x="' + (mx + 11).toFixed(1) + '" y="' + (my + 4).toFixed(1) + '">' + esc(p.zip) + '</text></svg>');
        var box = $('hp-rmap'), old = box.querySelector('svg'); if (old) old.remove();
        box.insertAdjacentHTML('afterbegin', s.join(''));
        txt('hp-rr-msg', '');
        var here = root.AgRadarRain.lookup(h, q, lat, lon);
        txt('hp-rr-h', 'Radar rain, last 7 days: ' + (here == null ? 'no reading' : f1(here / 100, 2) + ' in') + ' at ' + p.zip);
        var start = new Date(win.start), endT = new Date(win.end), ageH = (Date.now() - endT.getTime()) / 36e5;
        var sq = (h.d * 69).toFixed(1) + ' by ' + (h.d * 69 * Math.cos(lat * Math.PI / 180)).toFixed(1) + ' miles';
        txt('hp-rr-lead', md(ctDay(start)) + ' to ' + md(ctDay(endT)) + ', ' + ctClock(win.end) + '. ' + (ageH > 9 ? 'Last good read; the newer one is late. ' : '') + 'Each square is about ' + sq + '.');
      })
      .catch(function () { if (seq === band.seq) txt('hp-rr-msg', 'The radar rain map did not load for this state.'); });
  }
  function loadBand() {
    var p0 = readPlace();
    if (!hasZip(p0)) return;
    fullPlace().then(function (p) {
      if (!p || !hasZip(p) || p.lat == null || !/^[A-Z]{2}$/.test(p.state || '')) {
        ['hp-rain-ch', 'hp-gdu-ch'].forEach(function (id) { msgIn(id, 'This ZIP is not in our place table.'); }); return;
      }
      if (band.zip === p.zip) return;
      band.zip = p.zip; var seq = ++band.seq;
      drawForecast(p, seq);
      drawRadar(p, seq);
      getJSON(stateFile('rain/', p.state)).then(function (R) {
        if (seq !== band.seq) return;
        var cf = findCounty(R, p.county);
        drawRain(R, p, cf);
        if (!cf) { msgIn('hp-gdu-ch', 'No GDU record for this county yet.'); return; }
        getJSON(stateFile('rain/wx/', p.state)).then(function (W) { if (seq === band.seq) drawGdu(W, p, cf.near || cf.fips); }, function () { msgIn('hp-gdu-ch', 'The GDU file did not load. Try again later.'); });
      }, function () { msgIn('hp-rain-ch', 'The rain file did not load. Try again later.'); msgIn('hp-gdu-ch', 'The GDU file did not load. Try again later.'); });
    });
  }

  /* ---- farmland sales ---- */
  var landSeq = 0;
  function landRows(F, w24) {
    var cols = F.cols || [], ix = {}; cols.forEach(function (c, i) { ix[c] = i; });
    var from = utc(w24 && w24[0]), to = utc(w24 && w24[1]);
    return (F.s || []).map(function (r) {
      return { id: r[ix.id], d: utc(r[ix.when]), acres: r[ix.acres], ppa: r[ix.ppa], place: r[ix.place], kind: r[ix.kind], m: r[ix.m] };
    }).filter(function (r) { return r.d && r.kind === 'f' && num(r.ppa) && r.ppa > 0 && r.m === 'y' && (!from || r.d >= from) && (!to || r.d <= to); });
  }
  function drawLand(F, L, st, ring, words) {
    var rows = landRows(F, F.w24), u = F.usual || [];
    if (rows.length < 5 || !num(u[0])) return false;
    var from = utc(F.w24[0]), to = utc(F.w24[1]), ph = phone();
    var cn = countyName(F.county, st), newest = rows.reduce(function (a, b) { return b.d > a.d ? b : a; }, rows[0]);
    var ch = landSvg({ rows: rows, med: u[0], q1: u[1], q2: u[2], q3: u[2], w: ph ? 366 : 374, h: ph ? 190 : 250, fs: ph ? 11 : 12, from: from, to: to,
      ring: ring || newest, label: 'Farmland sales in ' + cn + ', price per acre, ' + md(from) + ', ' + from.getUTCFullYear() + ' to ' + md(to) + ', ' + to.getUTCFullYear() });
    var src = (L && L.lead && L.lead[st] && L.lead[st].src) || 'State';
    txt('hp-land-h', words.h || (cn + ' median: $' + comma(u[0]) + ' an acre'));
    var nw = words.p || ((num(u[3]) ? u[3] : rows.length) + ' bare farmland sales over two years. Newest: ' + Math.round(newest.acres) + ' acres'
      + (newest.place ? ' in ' + newest.place : '') + ', $' + comma(newest.ppa) + ' an acre, ' + md(newest.d) + '.');
    txt('hp-land-p', nw);
    var box = $('hp-land-ch'), old = box.querySelector('svg'); if (old) old.remove();
    msgIn('hp-land-ch', '');
    box.insertAdjacentHTML('afterbegin', ch.svg);
    txt('hp-land-src', 'Each dot is one sale; bigger dots are more acres. Shaded: the middle half of sales.'
      + (ch.off ? ' ' + ch.off + ' sale' + (ch.off === 1 ? '' : 's') + ' outside $' + comma(ch.bottom) + ' to $' + comma(ch.top) + ' ' + (ch.off === 1 ? 'is' : 'are') + ' off the chart.' : '')
      + ' ' + src + ' transfer records, ' + MON[from.getUTCMonth()] + ' ' + from.getUTCFullYear() + ' to ' + MON[to.getUTCMonth()] + ' ' + to.getUTCFullYear() + '. No names.');
    var all = $('hp-land-all'); if (all && NAMES[st]) all.setAttribute('href', '/land-sales/' + slug(NAMES[st]) + '/' + slug(cn));
    return true;
  }
  function countyFile(st, name) {
    return getJSON(stateFile('rain/', st)).then(function (R) {
      var cf = findCounty(R, name); if (!cf) throw new Error('county');
      return getJSON('/data/land-sales/' + st.toLowerCase() + '/' + cf.fips + '.json');
    });
  }
  function loadLand() {
    var seq = ++landSeq;
    var leadP = getJSON('/data/land-sales/lead.json').catch(function () { return null; });
    fullPlace().then(function (p) {
      leadP.then(function (L) {
        if (seq !== landSeq) return;
        var sts = (L && L.states) || [];
        var mine = p && hasZip(p) && sts.indexOf(p.state) >= 0 && p.county ? p : null;
        var fallback = function () { return leadSale(L, p, seq); };
        if (mine) {
          countyFile(mine.state, mine.county).then(function (F) {
            if (seq !== landSeq) return;
            txt('hp-land-near', 'near ' + mine.zip);
            if (!drawLand(F, L, mine.state, null, {})) fallback();
          }, fallback);
        } else fallback();
      });
    });
  }
  function leadSale(L, p, seq) {
    var sts = (L && L.states) || [], mine = p && p.state, leads = (L && L.lead) || {};
    var have = sts.filter(function (s) { var r = leads[s]; return r && num(r.ppa) && r.county && utc(r.when) && r.window && (ctDay() - utc(r.window[1])) / 864e5 <= 60; });
    if (!have.length) { msgIn('hp-land-ch', 'No recent farmland sale on file.'); return; }
    var st = have.indexOf(mine) >= 0 ? mine : have.sort(function (a, b) { return leads[a].when < leads[b].when ? 1 : -1; })[0], r = leads[st];
    txt('hp-land-near', NAMES[st] ? 'in ' + NAMES[st] : '');
    var not = mine && sts.indexOf(mine) < 0 && NAMES[mine] ? 'Not yet in ' + NAMES[mine] + '. ' : '';
    var w = { h: 'Top bare-land price in ' + NAMES[st] + ': $' + comma(r.ppa) + ' an acre',
      p: not + Math.round(r.acres) + ' acres in ' + countyName(r.county, st) + ', ' + (r.basis === 'sale date' ? 'sold ' : 'recorded ') + md(utc(r.when)) + ', the highest of the 30 days to ' + md(utc(r.window[1])) + '. County median: $' + comma(r.med) + '.' };
    countyFile(st, r.county).then(function (F) {
      if (seq !== landSeq) return;
      var ring = { d: utc(r.when), ppa: r.ppa };
      if (!drawLand(F, L, st, ring, w)) throw new Error('few');
      var all = $('hp-land-all'); if (all && r.url) all.setAttribute('href', r.url);
    }).catch(function () {
      txt('hp-land-h', w.h); txt('hp-land-p', w.p); msgIn('hp-land-ch', 'The county chart did not load.');
    });
  }

  function placeChanged() { band.zip = ''; if (bandStarted) loadBand(); if (landStarted) loadLand(); }
  var bandStarted = false, landStarted = false;

  /* ---- price alert: same double opt-in as before (workers/subs-worker.js WATCH A PRICE TARGET) ---- */
  function priceAlert() {
    var PA_WORKER = 'https://agsist-api.dnilgis.workers.dev';
    var PA_LABELS = { 'corn': 'Corn', 'corn-dec': 'Corn (new crop)', 'beans': 'Soybeans', 'beans-nov': 'Soybeans (new crop)', 'wheat': 'Chicago SRW wheat', 'cattle': 'Live Cattle' };
    function paId(symbol, direction, targetCents) {
      var s = (symbol + '|' + direction + '|' + targetCents).toUpperCase(), h = 0x811c9dc5;
      for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
      return ('00000000' + (h >>> 0).toString(16)).slice(-8);
    }
    var sym = $('pa-symbol'), dir = $('pa-direction'), tgt = $('pa-target'), email = $('pa-email'), go = $('pa-go'), status = $('pa-status');
    if (!go) return;
    function fail(msg, field) {
      status.textContent = msg; status.style.color = 'var(--red,#ef4444)';
      [tgt, email].forEach(function (f) { f.removeAttribute('aria-invalid'); });
      if (field) { field.setAttribute('aria-invalid', 'true'); field.setAttribute('aria-describedby', 'pa-status'); field.focus(); } else status.focus();
      go.disabled = false; go.textContent = 'Set alert';
    }
    function submit() {
      var dollars = parseFloat(tgt.value), addr = (email.value || '').trim();
      if (!(dollars > 0 && dollars <= 1000 && isFinite(dollars))) return fail('Enter a target price between $0.01 and $1000.', tgt);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addr)) return fail('Enter a real email address.', email);
      [tgt, email].forEach(function (f) { f.removeAttribute('aria-invalid'); });
      var symbol = sym.value, direction = dir.value, targetCents = Math.round(dollars * 100);
      var label = (PA_LABELS[symbol] || symbol) + ' ' + (direction === 'above' ? 'above' : 'below') + ' $' + dollars.toFixed(2);
      go.disabled = true; go.textContent = 'Sending…'; status.textContent = ''; status.style.color = 'var(--text-muted)';
      fetch(PA_WORKER + '/price-watch-subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addr, pid: paId(symbol, direction, targetCents), symbol: symbol, direction: direction, target_cents: targetCents, label: label }) })
        .then(function (r) { return r.json().catch(function () { return null; }).then(function (data) { return { r: r, data: data }; }); }, function () { return null; })
        .then(function (res) {
          if (!res) return fail('Could not reach the alert service. Try again in a minute.');
          var r = res.r, data = res.data;
          if (data && data.error === 'limit') return fail('You already have 5 price alerts set, the most one address can track at once.', email);
          if (data && data.ok === false && data.error && r.status >= 400 && r.status < 500)
            return fail(/email/.test(String(data.error)) ? 'That email address was not accepted.' : /target/.test(String(data.error)) ? 'That target price was not accepted.' : 'That alert was not accepted.', /email/.test(String(data.error)) ? email : /target/.test(String(data.error)) ? tgt : null);
          if (!r.ok || !data || data.ok !== true) return fail('The alert service did not confirm this' + (r.ok ? '' : ' (error ' + r.status + ')') + '. Nothing was saved. Try again in a minute.');
          var oi = $('pa-optin'), oiL = $('pa-optin-l');
          var wantDaily = !!(oi && oi.checked && oiL && !oiL.hidden && root.AgsistSignup && !root.AgsistSignup.isSignedUp());
          $('pa-form').innerHTML = '<span id="pa-done" tabindex="-1" style="font-size:.875rem;color:var(--green)">Check your email to confirm. It arrives within about 30 minutes; nothing is sent until you confirm.</span><div class="sa-optmsg" id="pa-optmsg" role="status"></div>';
          var done = $('pa-done'); if (done) done.focus();
          var more = function () { var S = root.AgsistSignup, f = $('pa-form'); if (S && S.oneMore && f) S.oneMore(f, { gave: 'price', had: ['price'].concat(wantDaily ? ['daily'] : []), email: addr }); };
          if (wantDaily) root.AgsistSignup.subscribe({ email: addr, source: 'watch-optin' }).then(function (res2) {
            var m = $('pa-optmsg'); if (!m) return;
            m.className = 'sa-optmsg ' + (res2.ok ? 'is-ok' : 'is-err');
            m.textContent = res2.ok ? 'AGSIST Daily: ' + root.AgsistSignup.okText() : 'AGSIST Daily: ' + root.AgsistSignup.errText(res2);
            more();
          }); else more();
        });
    }
    go.addEventListener('click', submit);
    [tgt, email].forEach(function (el) { el.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); }); });
  }

  /* ---- start ---- */
  function start() {
    var f = $('hb-zip-form'); if (f) f.addEventListener('submit', submitZip);
    Array.prototype.forEach.call(doc.querySelectorAll('[data-hp-loc]'), function (b) { b.addEventListener('click', useLocation); });
    var sv = $('hp-save'); if (sv) sv.addEventListener('click', savePicture);
    paintPlace(); fullPlace().then(function (p) { paintPlace(p); });
    root.addEventListener('agsist-place', function () { paintPlace(); });
    root.addEventListener('storage', function () { paintPlace(); });
    root._AGSIST_GEO_CALLBACKS = root._AGSIST_GEO_CALLBACKS || [];
    root._AGSIST_GEO_CALLBACKS.push(function () { setTimeout(landed, 0); });
    root.addEventListener('agsist:bids-top', function (e) { paintTiles(e.detail); paintNear(e.detail); });
    if (root.__agsistBidsTop) { paintTiles(root.__agsistBidsTop); paintNear(root.__agsistBidsTop); }
    Promise.all([getJSON('/data/prices.json').catch(function () { return null; }), getJSON('/data/price-stats.json').catch(function () { return null; })]).then(function (r) {
      PX = r[0]; STATS = r[1]; paintHeader(); drawCharts(); paintMarkets();
    });
    getJSON('/data/daily.json').then(paintDaily, function () {});
    getJSON('/data/rain-print.json').then(paintRainPrint, function () {});
    later($('hp-wx'), function () { bandStarted = true; loadBand(); });
    later($('hp-land'), function () { landStarted = true; loadLand(); });
    priceAlert();
    if (PHONE) {
      var redraw = function () { drawCharts(); if (bandStarted) { band.zip = ''; loadBand(); } if (landStarted) loadLand(); };
      if (PHONE.addEventListener) PHONE.addEventListener('change', redraw); else if (PHONE.addListener) PHONE.addListener(redraw);
    }
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(typeof self !== 'undefined' ? self : this);
