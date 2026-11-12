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
     weather    the National Weather Service grid (components/nws.js), live in the browser;
                the live radar (Windy embed, lazy); rain and GDUs against normal from data/rain/<st>.json and
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

  /* "7:05 am", Central */
  function ctHm(d) {
    var p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    var h = +p.hour % 24; return ((h % 12) || 12) + ':' + p.minute + (h < 12 ? ' am' : ' pm');
  }
  /* "Bids posted Nov 11, 7:05 am to 3:37 pm CT" from the boards' posted times (ISO; nulls skipped) */
  function postedRange(times) {
    var ts = (times || []).map(function (t) { return t ? Date.parse(t) : NaN; }).filter(isFinite);
    if (!ts.length) return '';
    try {
      var lo = new Date(Math.min.apply(null, ts)), hi = new Date(Math.max.apply(null, ts)), dl = md(ctDay(lo)), dh = md(ctDay(hi));
      if (lo.getTime() === hi.getTime()) return 'Bid' + (ts.length > 1 ? 's' : '') + ' posted ' + dl + ', ' + ctHm(lo) + ' CT';
      return 'Bids posted ' + dl + ', ' + ctHm(lo) + ' to ' + (dl === dh ? '' : dh + ', ') + ctHm(hi) + ' CT';
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
  /* the close date of each weekly bar: weekly bars are dated by their Monday (hist_to is the current week's), and a
     week closes on its last trading day: Friday, or Thursday Jul 2 when Jul 3 is the holiday (audit Q6). trading(iso)
     is AgPxStamp.isTradingDay in the page; with none, Saturday and Sunday alone are skipped. A hist_to that is not a
     Monday is not a weekly bar date: no dates. */
  function fridays(histTo, n, trading) {
    var to = utc(histTo); if (!to || to.getUTCDay() !== 1) return null;
    var ok = trading || function (iso) { var w = utc(iso).getUTCDay(); return w > 0 && w < 6; };
    var out = [];
    for (var i = n; i >= 1; i--) {
      var d = addDays(to, -7 * i + 4), g = 0;
      while (!ok(d.toISOString().slice(0, 10)) && g++ < 4) d = addDays(d, -1);
      out.push(d);
    }
    return out;
  }
  function money2(v) { return '$' + f1(v, 2); }
  function attr(pal, k) { return pal && pal[k] ? ' style="' + pal[k] + '"' : ''; }

  /* futures line chart. ds: Dates, vs: dollars, cur: the label on today's point. pal: inline styles (the saved picture) */
  function lineSvg(o) {
    var ds = o.d, vs = o.v, w = o.w, h = o.h, fs = o.fs || 12, pal = o.pal || null, uid = o.uid || 'c';
    var pl = Math.max(50, Math.ceil(fs * 4.5)), pr = 96, pt = 18, pb = 28;
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
      if (L[2] === 'middle' && (x - X(ds[0]) < Math.max(52, fs * 4.2) || X(ds[ds.length - 1]) - x < Math.max(50, fs * 6.4))) return;   /* no month label crowding the end date at phone sizes */
      o2.push('<line class="ch-tick"' + attr(pal, 'base') + ' x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + yb + '" y2="' + (yb + 4) + '"/>');
      o2.push('<text class="ch-ax"' + attr(pal, 'ax') + ' x="' + x.toFixed(1) + '" y="' + (yb + 17) + '" text-anchor="' + L[2] + '">' + L[1] + '</text>');
    });
    var pts = ds.map(function (d, i) { return X(d).toFixed(1) + ',' + Y(vs[i]).toFixed(1); }).join(' ');
    if (o.out) { o.out.w = w; o.out.h = h; o.out.top = pt; o.out.bottom = yb; o.out.pts = ds.map(function (d, i) { return { x: X(d), y: Y(vs[i]), i: i }; }); }
    o2.push('<polygon fill="url(#g' + uid + ')" points="' + X(ds[0]).toFixed(1) + ',' + yb + ' ' + pts + ' ' + X(ds[ds.length - 1]).toFixed(1) + ',' + yb + '"/>');
    o2.push('<polyline class="ch-line"' + attr(pal, 'line') + ' points="' + pts + '"/>');
    var hi = 0; for (var i = 1; i < vs.length; i++) if (vs[i] > vs[hi]) hi = i;
    var xh = X(ds[hi]), yh = Y(vs[hi]);
    if (hi < vs.length - 1) {
      o2.push('<circle class="ch-hi"' + attr(pal, 'hi') + ' cx="' + xh.toFixed(1) + '" cy="' + yh.toFixed(1) + '" r="3"/>');
      var anc = xh < pl + 60 ? 'start' : 'middle';
      o2.push('<text class="ch-note"' + attr(pal, 'note') + ' x="' + xh.toFixed(1) + '" y="' + (yh - 8).toFixed(1) + '" text-anchor="' + anc + '">High ' + pxSlash(vs[hi]) + ', ' + md(ds[hi]) + '</text>');
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
    var pl = Math.max(44, Math.ceil(fs * 3.7)), pr = 12, pt = 16, pb = 28;
    /* b null: no normal on file for this place, so no normal line, dot or label (never a normal of zero) */
    var t = nice(0, Math.max(Math.max.apply(null, a), b ? Math.max.apply(null, b) : 0) * 1.04, o.steps);
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
    var pn = b ? xs.map(function (x, i) { return X(x).toFixed(1) + ',' + Y(b[i]).toFixed(1); }).join(' ') : '';
    s.push('<polygon fill="url(#g' + o.uid + ')" points="' + X(x0).toFixed(1) + ',' + Y(0).toFixed(1) + ' ' + pa + ' ' + X(x1).toFixed(1) + ',' + Y(0).toFixed(1) + '"/>');
    s.push((b ? '<polyline class="ch-norm" points="' + pn + '"/>' : '') + '<polyline class="ch-line" points="' + pa + '"/>');
    if (o.out) { o.out.w = w; o.out.h = h; o.out.top = pt; o.out.bottom = h - pb; o.out.pts = xs.map(function (x, i) { return { x: X(x), y: Y(a[i]), i: i }; }); }
    var xe = X(x1), ye = Y(a[a.length - 1]), yn = b ? Y(b[b.length - 1]) : h;
    s.push('<circle class="ch-cur-o" cx="' + xe.toFixed(1) + '" cy="' + ye.toFixed(1) + '" r="6"/><circle class="ch-cur" cx="' + xe.toFixed(1) + '" cy="' + ye.toFixed(1) + '" r="3.5"/>');
    if (b) s.push('<circle class="ch-normdot" cx="' + xe.toFixed(1) + '" cy="' + yn.toFixed(1) + '" r="3"/>');
    var above = ye <= yn;
    s.push('<text class="ch-val" x="' + (xe - 10).toFixed(1) + '" y="' + (above ? ye - 10 : ye + 18).toFixed(1) + '" text-anchor="end">' + esc(o.now) + '</text>');
    if (b && o.norm && Math.abs(ye - yn) > 14) s.push('<text class="ch-note" x="' + (xe - 10).toFixed(1) + '" y="' + (above ? yn + 18 : yn - 10).toFixed(1) + '" text-anchor="end">' + esc(o.norm) + '</text>');
    s.push('</svg>');
    return s.join('');
  }

  /* every recorded farmland sale over 24 months, price per acre, with the county median and its middle half */
  /* month bars against normal (the old home's season chart, owner Nov 12): for each month this year's total (gold)
     beside its 1991 to 2020 normal for the same reported days (dashed box). o.m: [{lab, a, n (null: none on file),
     part (the month still running), gap (withheld: not enough days)}]; o.fmt(v) the axis words; o.vfmt(v) a bar's
     value; the month still running is lighter and its bar carries its value. No normal anywhere: no normal boxes. */
  function barSvg(o) {
    var M = o.m, w = o.w, h = o.h, fs = o.fs || 12, pl = Math.max(44, Math.ceil(fs * 3.7)), pr = 8, pt = Math.ceil(fs * 2.1), pb = 26;
    var hasN = M.some(function (x) { return num(x.n); });
    var top = 0; M.forEach(function (x) { if (num(x.a)) top = Math.max(top, x.a); if (num(x.n)) top = Math.max(top, x.n); });
    var t = nice(0, Math.max(top, 1e-6) * 1.08, o.steps), ymax = t.hi;
    var cw = (w - pl - pr) / M.length, Y = function (v) { return pt + (ymax - v) / ymax * (h - pt - pb); }, yb = h - pb;
    var s = ['<svg class="ch" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(o.label) + '" style="font-size:' + fs + 'px">'];
    for (var v = 0; v <= ymax + 1e-9; v += t.step) {
      s.push('<line class="ch-grid" x1="' + pl + '" x2="' + (w - pr) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/>');
      s.push('<text class="ch-ax" x="' + (pl - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end">' + o.fmt(v) + '</text>');
    }
    s.push('<line class="ch-base" x1="' + pl + '" x2="' + (w - pr) + '" y1="' + yb + '" y2="' + yb + '"/>');
    var pts = [], step = M.length > 9 && cw < fs * 2.6 ? 2 : 1;
    /* owner, Nov 12: a true double bar per month, this year (gold, left) beside its normal (solid slate, right) */
    M.forEach(function (x, i) {
      var cx = pl + cw * (i + 0.5), bw = Math.max(3, Math.min(cw * 0.36, fs * 1.6)), xa = hasN ? cx - bw - 1 : cx - bw / 2, xn = cx + 1;
      if (hasN && num(x.n)) s.push('<rect class="ch-bn' + (x.part ? ' part' : '') + '" x="' + xn.toFixed(1) + '" y="' + Y(x.n).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, yb - Y(x.n)).toFixed(1) + '"/>');
      if (x.gap || !num(x.a)) s.push('<rect class="ch-bx" x="' + xa.toFixed(1) + '" y="' + (yb - 3) + '" width="' + bw.toFixed(1) + '" height="3"/><text class="ch-ax" x="' + (xa + bw / 2).toFixed(1) + '" y="' + (yb - 7) + '" text-anchor="middle">n/a</text>');
      else s.push('<rect class="ch-ba' + (x.part ? ' part' : '') + '" x="' + xa.toFixed(1) + '" y="' + Y(x.a).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, yb - Y(x.a)).toFixed(1) + '"/>');
      if ((i % step === 0) || i === M.length - 1) s.push('<text class="ch-ax" x="' + cx.toFixed(1) + '" y="' + (yb + 17) + '" text-anchor="middle">' + esc(x.lab) + '</text>');
      pts.push({ x: cx, y: num(x.a) ? Y(x.a) : yb, i: i });
    });
    /* the latest month named on its bar, and marked */
    var L = M.length - 1, xl = pl + cw * (L + 0.5) - (hasN ? Math.max(3, Math.min(cw * 0.36, fs * 1.6)) / 2 + 1 : 0);
    if (num(M[L].a) && !M[L].gap) {
      s.push('<circle class="ch-cur" cx="' + xl.toFixed(1) + '" cy="' + (Y(M[L].a) - 5).toFixed(1) + '" r="3"/>');
      /* its value in the top right corner, clear of every bar: "Nov so far: 0.68 in" */
      s.push('<text class="ch-bl" x="' + (w - pr).toFixed(1) + '" y="' + (pt - 8) + '" text-anchor="end">' + esc(M[L].lab + (M[L].part ? ' so far' : '') + ': ' + o.vfmt(M[L].a) + (hasN && num(M[L].n) ? ' (normal ' + o.vfmt(M[L].n) + ')' : '')) + '</text>');
    }
    if (o.out) { o.out.w = w; o.out.h = h; o.out.top = pt; o.out.bottom = yb; o.out.pts = pts; }
    s.push('</svg>');
    return s.join('');
  }
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
    var off = 0, pts = [];
    rows.forEach(function (r, i) {
      if (r.ppa > y1 || r.ppa < y0) { off++; return; }
      pts.push({ x: X(r.d), y: Y(r.ppa), i: i });
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
    return { svg: s.join(''), off: off, top: y1, bottom: y0, pts: pts, w: w, h: h, ptop: pt, pbottom: yb };
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
  /* basis in words against its futures month (audit Q10): a month worked out from the price, not read from the
     board ("Dec '26 (inferred)"), keeps a "~"; the year stays unless it is the headline contract's (head, "Dec '26") */
  function basisWords(dollars, ref, head) {
    if (!num(dollars)) return '';
    var c = Math.round(dollars * 400) / 4;
    var raw = String(ref || '').replace(/\u2019/g, "'"), inf = / \(inferred\)$/.test(raw);
    var r = raw.replace(/ \(inferred\)$/, '');
    if (head && r === String(head).replace(/\u2019/g, "'")) r = r.replace(/\s*'\d\d$/, '');
    if (r && inf) r = '~' + r;
    if (c === 0) return 'even with ' + (r || 'futures');
    return quarters(c) + '¢ ' + (c > 0 ? 'over ' : 'under ') + (r || 'futures');
  }
  var CARD_CSS = '.ch{font-family:Helvetica,Arial,sans-serif}.ch-grid{stroke:#22292b;stroke-width:1}.ch-base,.ch-tick{stroke:#3a4346;stroke-width:1}.ch-ax{fill:#a9b3b0}'
    + '.ch-line{fill:none;stroke:#d4a23f;stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}.ch-fill-a{stop-color:#d4a23f;stop-opacity:.22}.ch-fill-b{stop-color:#d4a23f;stop-opacity:0}'
    + '.ch-hi{fill:#0a0c0d;stroke:#a9b3b0;stroke-width:1.5}.ch-note{fill:#a9b3b0}.ch-cur-l{stroke:#d4a23f;stroke-dasharray:3 4;opacity:.55}.ch-cur,.ch-tag{fill:#d4a23f}'
    + '.ch-cur-o{fill:none;stroke:#d4a23f;stroke-width:1.5;opacity:.6}.ch-tag-t{fill:#0a0c0d;font-weight:700}.ch-band{fill:#d4a23f;opacity:.14}'
    + '.ch-dot{fill:#6f9fc2;fill-opacity:.6;stroke:#101415;stroke-width:1}.ch-med{stroke:#d4a23f;stroke-width:2}.ch-val{fill:#e9edeb;font-weight:700}'
    + '.ch-norm{fill:none;stroke:#6f9fc2;stroke-width:2;stroke-dasharray:5 4}.ch-normdot{fill:#6f9fc2}.rmap-bg{fill:#161b1c}.rmap-gr{stroke:#22292b}'
    + '.ch-bn{fill:#5b6870}.ch-bn.part{opacity:.7}.ch-ba{fill:#d4a23f}.ch-ba.part{opacity:.55}.ch-bx{fill:#3a4346}.ch-bl{fill:#e9edeb;font-weight:700}'
    + '.rmap-st{fill:none;stroke:#e9edeb;stroke-opacity:.55;stroke-width:1.4}.rmap-t,.rmap-me{fill:#e9edeb;font-weight:700;paint-order:stroke;stroke:#161b1c;stroke-width:3px}.rmap-tdot{fill:#e9edeb}';
  function wrap(t, n) {
    var words = String(t).split(' '), lines = [''];
    words.forEach(function (w) { var l = lines[lines.length - 1]; if ((l + ' ' + w).trim().length > n && l) lines.push(w); else lines[lines.length - 1] = (l + ' ' + w).trim(); });
    return lines;
  }
  function sized(svg, w, h) { return svg.replace(/^<svg([^>]*?)>/, function (m0, at) { return '<svg' + at.replace(/\s(width|height)="[^"]*"/g, '') + ' width="' + w + '" height="' + h + '">'; }); }
  function cardSvg(sp, today) {
    var W = 1200, H = 630, date = md(today) + ', ' + today.getUTCFullYear();
    var head = wrap(sp.head, 58).slice(0, 2), y0 = head.length > 1 ? 196 : 170;
    var s = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="Helvetica, Arial, sans-serif"><style>' + CARD_CSS + '</style>',
      '<rect width="' + W + '" height="' + H + '" fill="#0a0c0d"/><rect width="' + W + '" height="8" fill="#d4a23f"/>',
      '<text x="48" y="56" fill="#d4a23f" font-size="24" font-weight="800" letter-spacing="3">AGSIST</text>',
      '<text x="' + (W - 48) + '" y="56" fill="#a9b3b0" font-size="20" text-anchor="end">' + esc(date) + '</text>'];
    head.forEach(function (l, i) { s.push('<text x="48" y="' + (100 + i * 38) + '" fill="#e9edeb" font-size="32" font-weight="700">' + esc(l) + '</text>'); });
    s.push('<text x="48" y="' + (y0 - 30) + '" fill="#a9b3b0" font-size="19">' + esc(sp.sub || '') + '</text>');
    var ch = H - y0 - 86, cw = sp.side ? 560 : W - 96;
    s.push('<g transform="translate(48,' + y0 + ')">' + sized(sp.big(cw, ch), cw, ch) + '</g>');
    (sp.side || []).forEach(function (l, i) { s.push('<text x="650" y="' + (y0 + 40 + i * 34) + '" fill="' + (i ? '#a9b3b0' : '#e9edeb') + '" font-size="' + (i ? 20 : 24) + '"' + (i ? '' : ' font-weight="700"') + '>' + esc(l) + '</text>'); });
    wrap(sp.source, 96).slice(0, 2).forEach(function (l, i) { s.push('<text x="48" y="' + (H - 48 + i * 22 - (wrap(sp.source, 96).length > 1 ? 22 : 0)) + '" fill="#a9b3b0" font-size="16">' + esc(l) + '</text>'); });
    s.push('<text x="' + (W - 48) + '" y="' + (H - 40) + '" fill="#d4a23f" font-size="24" font-weight="700" text-anchor="end">agsist.com</text></svg>');
    return s.join('');
  }
  var words = { basis: basisWords, county: countyName, quarters: quarters };

  var api = { postedRange: postedRange, takeaway: takeaway, barSvg: barSvg, lineSvg: lineSvg, cumSvg: cumSvg, landSvg: landSvg, cardSvg: cardSvg, nice: nice, fridays: fridays, county: county, words: words };
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
  /* chart text in viewBox units that renders at 12.2px or more at the box's real width */
  function fsFor(id, vbW) { var b = $(id), w = b && b.clientWidth; return w ? Math.max(12, Math.round(12.2 * vbW / w * 10) / 10) : 12.5; }
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
      else if (z && badZip === p.zip) t.textContent = '';
      else if (z) {
        t.textContent = p.town ? p.town + (p.state ? ', ' + p.state : '') : 'ZIP ' + p.zip;
        if (p.county) { var c = doc.createElement('span'); c.className = 'c'; c.textContent = ' · ' + countyName(p.county, p.state); t.appendChild(c); }
      } else t.textContent = '';
    }
    txt('hp-bids-near', z && badZip !== p.zip ? 'near ' + p.zip : 'near you');
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
    /* audit A10: a pasted ZIP with spaces or a ZIP+4 ("61701-1234") is read as its five digits, never cut short */
    var inp = $('hb-zip'), raw = String(inp && inp.value || '').replace(/\D/g, ''), z = raw.length === 9 ? raw.slice(0, 5) : raw;
    if (z.length !== 5) { say('Enter a 5-digit ZIP code.', true); if (inp) { inp.setAttribute('aria-invalid', 'true'); inp.focus(); } return; }
    if (inp) { inp.removeAttribute('aria-invalid'); inp.value = z; inp.blur(); }
    say('');
    ga('bids_search', { method: 'zip' });
    try { if (root.AgSavedPlace) root.AgSavedPlace.save(z); } catch (e) {}
    looking = z; paintPlace();
    if (!sendZip(z)) { var n = 0; (function wait() { if (sendZip(z)) return; if (++n < 40) setTimeout(wait, 250); })(); }
    fullPlace().then(function () { if (looking === z) { looking = ''; say(''); } landed(); });
    clearTimeout(lookT);
    /* audit A1: an answer within about 6 seconds, never "Loading" for good */
    lookT = setTimeout(function () { if (looking === z) { looking = ''; paintPlace(); say('ZIP ' + z + ' did not load. Check it, or try again in a minute.', true); } }, 6000);
    checkZip(z); watchBids();
  }
  /* audit A1: a ZIP that is not in our ZIP table says so at once, and the cards stop loading; a table that does not
     load is a failure, not an unknown ZIP */
  function placeCheck(z) {
    return getJSON('/data/places/zip/' + z.slice(0, 2) + '.json', 8000).then(function (t) { return t && Array.isArray(t[z]) ? 'ok' : 'unknown'; },
      function (e) { return e && /HTTP 404/.test(String(e.message)) ? 'unknown' : 'failed'; });
  }
  var badZip = '';
  function checkZip(z) {
    placeCheck(z).then(function (r) {
      if ((readPlace() || {}).zip !== z) return;
      if (r === 'failed') { say('The place for ZIP ' + z + ' did not load. Try again in a minute.', true); return; }
      if (r !== 'unknown') { if (badZip === z) badZip = ''; return; }
      badZip = z; looking = ''; clearTimeout(lookT);
      say('ZIP ' + z + ' is not in our ZIP table. Check the five digits.', true);
      txt('hp-bids-near', 'near you'); txt('hb-place-t', '');
      var d = { status: 'unknown', zip: z }; paintTiles(d); paintNear(d);
      unknownBand(z);
    });
  }
  function bandFailed(t) {
    var wx = $('hp-wx'), wm = $('hp-wxmsg'); if (!wx) return;
    wx.classList.add('unknown'); liveOff();
    if (!wm) { wm = doc.createElement('p'); wm.id = 'hp-wxmsg'; wm.className = 'hp-wxmsg'; wm.setAttribute('role', 'status'); wx.insertBefore(wm, wx.querySelector('.hp-wxg')); }
    wm.textContent = t;
  }
  function unknownBand(z) {
    var t = 'ZIP ' + z + ' is not in our ZIP table.';
    /* a11y round 3 (A3): one short message for the whole band, not one in each of its panels */
    var wx = $('hp-wx'), wm = $('hp-wxmsg');
    if (wx) { wx.classList.add('unknown'); if (!wm) { wm = doc.createElement('p'); wm.id = 'hp-wxmsg'; wm.className = 'hp-wxmsg'; wm.setAttribute('role', 'status'); var g = wx.querySelector('.hp-wxg'); wx.insertBefore(wm, g); } wm.textContent = t + ' Check the five digits at the top of the page for your forecast, radar, rain and GDUs.'; }
    fcFail(t); liveOff(); txt('hp-live-msg', t); ['hp-rain-ch', 'hp-gdu-ch'].forEach(function (id) { msgIn(id, t); });
  }
  /* audit A1: bids still loading 6 seconds after a ZIP is in place end in a plain message; a later answer still draws */
  var bidsT = null;
  function watchBids() {
    clearTimeout(bidsT);
    bidsT = setTimeout(function () {
      var p = readPlace(); if (!hasZip(p) || badZip === p.zip) return;
      var stuck = ['hp-t-corn-p', 'hp-t-soy-p'].some(function (id) { var e = $(id); return e && e.querySelector('.hp-haszip .hp-skel, .hp-skel') && !/\d/.test(e.textContent); });
      if (stuck) { var d = { status: 'failed' }; paintTiles(d); paintNear(d); }
    }, 6000);
  }
  function useLocation() {
    say('Finding your location…');
    ga('location_tap', {});
    var before = (readPlace() || {}).zip || '';
    var failed = false;
    root.agsistGeoFailed = function () { failed = true; say('Your location did not come through. Type your ZIP.', true); };
    if (typeof root.requestGeo === 'function') root.requestGeo();
    else { say('Location is not ready yet. Type your ZIP.', true); return; }
    var n = 0;
    (function wait() {
      var p = readPlace();
      if (p && p.zip && (p.zip !== before || n > 2) && p.lat != null) { say(''); landed(); return; }
      if (failed) return;
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
    if (num(d.count) && d.count > 0) txt('hp-bids-all', 'All ' + d.count + ' elevator' + (d.count === 1 ? '' : 's'));
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
        var bw = basisWords(b.basis, b.ref, headLabel(k)); if (bw) bits.push(bw);
        if (b.posted && F && !postedToday(b.posted)) { bits.push('posted ' + F.day(b.posted)); if (b.stale) el.classList.add('old'); }
        txt(id + '-x', bits.join(' · '));
        el.setAttribute('data-board-key', b.boardKey || '');
        return;
      }
      el.removeAttribute('data-board-key');
      var st = d.status || 'none';
      if (st === 'pending') { html(id + '-p', '<span class="hp-skel" aria-hidden="true"></span><span class="vh">Loading</span>'); txt(id + '-e', ''); txt(id + '-x', ''); return; }
      html(id + '-p', '<span class="hp-mut">-</span>');
      /* audit A4: a failure is said once, in the list under the tiles, not in each tile again */
      txt(id + '-e', st === 'failed' || st === 'unknown' ? '' : st === 'nozip' ? 'Type your ZIP above.' : 'No ' + w + ' bid within ' + r + ' miles.');
      txt(id + '-x', '');
    });
  }
  function paintNear(d) {
    var tb = doc.querySelector('#hp-near tbody'), msg = $('hp-near-msg'), F = fmt();
    if (!tb || !d) return;
    var rows = Array.isArray(d.near) ? d.near.filter(function (b) { return b && num(b.cash); }).slice(0, 11) : null;
    if (!rows) {
      if (d.status === 'failed') nearFail('Cash bids did not load. Open the cash bids page, or try again in a minute.');
      else if (d.status === 'unknown') nearFail('No cash bids: ZIP ' + (d.zip || '') + ' is not in our ZIP table. Check the five digits.');
      return;
    }
    nearOk();
    if (!rows.length) { nearFail('No corn or soybean cash bid within ' + (num(d.radiusMi) ? Math.round(d.radiusMi) : 50) + ' miles.'); return; }
    if (msg) msg.textContent = '';
    var z = (readPlace() || {}).zip || '', out = rows.map(function (b) {
      var sub = [num(b.mi) ? miles(b.mi) : '', (b.crop === 'soybeans' ? 'soybeans' : 'corn') + (b.month ? ', ' + b.month : '')].filter(Boolean).join(' \u00b7 ');
      var bw = basisWords(b.basis, b.ref, headLabel(b.crop)) + (b.posted && F && !postedToday(b.posted) ? ' \u00b7 posted ' + F.day(b.posted) : '');
      return '<tr><td><a href="/cash-bids' + (z ? '?zip=' + z : '') + '">' + esc(b.name) + '</a><span class="s">' + esc(sub) + '</span></td><td class="n">'
        + (F ? F.cash(b.cash, 'hp-frac') : money2(b.cash)) + '<span class="b">' + esc(bw || '\u00a0') + '</span></td></tr>';
    });
    /* the held rows were for loading; a short list ends where it ends (the card's foot sits below the first screen) */
    tb.innerHTML = out.join('');
    bidsAsOf(rows.concat([d.corn, d.soybeans]));
  }
  /* audit A4: one message where the list would be; the empty rows and the column heads are hidden but keep their room
     (the card below does not move) */
  function nearFail(t) {
    var tb = doc.querySelector('#hp-near tbody'), msg = $('hp-near-msg'), tab = $('hp-near');
    if (tab) tab.classList.add('hp-nfail');
    if (tb && tb.rows.length) { tb.rows[0].innerHTML = '<td colspan="2" class="hp-nf">' + esc(t) + '</td>'; }
    else if (tb) tb.innerHTML = '<tr><td colspan="2" class="hp-nf">' + esc(t) + '</td></tr>';
    if (msg) { msg.textContent = t; msg.classList.add('vh'); }   /* said to a screen reader (role=status), shown once in the list */
  }
  function nearOk() { var tab = $('hp-near'), msg = $('hp-near-msg'); if (tab) tab.classList.remove('hp-nfail'); if (msg) msg.classList.remove('vh'); }
  /* the headline futures month a crop's basis is quoted against ("Dec '26"), for basisWords */
  function headLabel(crop) { if (!PX) return null; var h = headline(crop === 'soybeans' ? 'beans' : 'corn'); return h && h.label ? String(h.label) : null; }
  function postedToday(iso) { var t = new Date(iso); return !isNaN(t) && ctDay(t).getTime() === ctDay().getTime(); }
  /* audit Q9: the bids shown say when they were posted: the oldest to the newest board time among them, Central
     (never the newest alone: one fresh board would make the older ones look current, the Oct 19 boardAge rule). */
  function bidsAsOf(list) {
    var e = $('hp-bids-src'); if (!e) return;
    var base = e.getAttribute('data-base') || e.innerHTML; e.setAttribute('data-base', base);   /* the definition stays its own span (folded on phones, round 3) */
    var r = postedRange(list.map(function (b) { return b && b.posted; }));
    e.innerHTML = (r ? esc(r) + '. ' : '') + base;
  }
  /* ---- no ZIP yet: pick a state, see its median basis (data/basis-states.json, AGSIST network elevators) ----
     Only crops with a median are printed (the file prints one at min_n elevators or more); a thinner corn or soybean
     line is counted, not priced. The pick is remembered on this browser for the planting and RMA pages too. */
  var NOLOC = { corn: 'Corn', soybeans: 'Soybeans', wheat_srw: 'SRW wheat', wheat_hrw: 'HRW wheat', wheat_hrs: 'Spring wheat' };
  function medOf(n, m) { var s = 'median of ' + n + ' elevator' + (n === 1 ? '' : 's'); return typeof m !== 'number' ? s : s + ', ' + m + ' compan' + (m === 1 ? 'y' : 'ies'); }
  function bcents(m) { var c = Math.round(m * 10000) / 100; return (root.AG && root.AG.px && root.AG.px.basis) ? root.AG.px.basis(c) : ((c > 0 ? '+' : '\u2212') + Math.abs(c) + '\u00a2'); }
  root.__agsistNolocRows = function (doc, code) {
    var s = doc && doc.states && doc.states[code]; if (!s) return null;
    var rows = [], thin = [];
    Object.keys(NOLOC).forEach(function (k) {
      var c = s.crops && s.crops[k]; if (!c) return;
      if (c.median == null) { if (k === 'corn' || k === 'soybeans') thin.push(NOLOC[k]); return; }
      var wk = '';
      if (c.wow != null && c.wow_n >= (doc.min_n || 3)) { var w = Math.round(c.wow * 4) / 4; wk = w === 0 ? 'no change on the week' : (root.AG.px.basis(w) + ' on the week'); }
      rows.push({ crop: NOLOC[k], basis: bcents(c.median), contract: c.label || '', n: c.n, co: c.companies, week: wk });
    });
    return { name: s.name, path: s.path || '', rows: rows, thin: thin };
  };
  function noloc() {
    var box = $('bids-noloc'); if (!box || box._on) return; box._on = true;
    var sel = box.querySelector('.hn-sel'), out = box.querySelector('.hn-out'), AB = {}, doc = null;
    function day(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' }); }
    function draw(code) {
      if (!code) { out.innerHTML = ''; return; }
      var r = root.__agsistNolocRows(doc, code);
      if (!r || !r.rows.length) { out.innerHTML = '<p class="hn-fine">Not enough fresh ' + esc(AB[code]) + ' bids in the AGSIST network to print a state basis this week.' + (r && r.path ? ' <a href="' + esc(r.path.replace(/#.*$/, '')) + '">' + esc(r.name) + ' bids</a>' : '') + '</p>'; return; }
      out.innerHTML = '<ul class="hn-rows">' + r.rows.map(function (x) {
        return '<li><span class="hn-crop">' + esc(x.crop) + '</span><span class="hn-b">' + esc(x.basis) + '</span><span class="hn-c">' + esc(x.contract) + '</span><span class="hn-n">' + medOf(x.n, x.co) + (x.week ? ', ' + esc(x.week) : '') + '</span></li>';
      }).join('') + '</ul><p class="hn-fine">Median basis of AGSIST network elevators with a fresh bid, read ' + esc(day(doc.generated)) + '. Your elevator will differ.' + (r.thin.length ? ' Too few bids to print: ' + esc(r.thin.join(', ')) + '.' : '') + ' <a href="' + esc(r.path || '/basis') + '">All ' + esc(r.name) + ' bids</a></p>';
    }
    sel.addEventListener('change', function () {
      var v = sel.value;
      try { if (v) { localStorage.setItem('agsist-pd-state', v); localStorage.setItem('agsist-rma-state', AB[v]); } } catch (e) {}
      ga('noloc_state_pick', { state: v || 'none' });
      draw(v);
    });
    getJSON('/data/basis-states.json').then(function (d) {
      doc = d; var st = (d && d.states) || {};
      Object.keys(st).forEach(function (k) { if (st[k] && st[k].name) AB[k] = st[k].name; });
      var ks = Object.keys(AB).sort(function (x, y) { return AB[x] < AB[y] ? -1 : 1; });
      if (!ks.length) throw new Error('no states');
      sel.innerHTML = '<option value="">Pick a state</option>' + ks.map(function (k) { return '<option value="' + esc(k) + '">' + esc(AB[k]) + '</option>'; }).join('');
      sel.disabled = false;
      var pre = ''; try { pre = localStorage.getItem('agsist-pd-state') || ''; if (!AB[pre]) { var n = localStorage.getItem('agsist-rma-state'); pre = ''; for (var k in AB) if (AB[k] === n) pre = k; } } catch (e) {}
      if (pre) { sel.value = pre; draw(pre); }
    }).catch(function () {
      var lab = box.querySelector('.hn-sl'); if (lab) lab.parentNode.removeChild(lab);
      out.innerHTML = '<p class="hn-fine">State basis did not load. Your ZIP still works.</p>';
    });
  }

  /* ---- futures: the header from data/prices.json, the charts from data/price-stats.json ---- */
  var PX = null, STATS = null;
  var CROPS = [['corn', 'fc', 'corn', 'hp-ch-corn', 'Corn'], ['beans', 'fs', 'soybean', 'hp-ch-soy', 'Soybean']];
  /* expired contracts roll off (AgPxStamp.roll: corn-dec on Jan 2 is the next live Dec), then the headline contract */
  function headline(crop) {
    try { var S = root.AgPxStamp, q = PX && PX.quotes; if (!S || !q) return null; if (S.roll) q = S.roll(q); return root.AgPxStamp.headline({ quotes: q, nearby: PX.nearby }, crop); } catch (e) { return null; }
  }
  /* the trading day before today, Central (weekends and exchange holidays skipped): a quote closed on it is the latest
     session's until today's settles, so overnight and before the open it is not an old price (Nov 12: "Last close"
     showed in the small hours and moved the first screen) */
  function prevSession() {
    var S = root.AgPxStamp, d = addDays(ctDay(), -1), g = 0;
    while (g++ < 7) { var iso = d.toISOString().slice(0, 10), w = d.getUTCDay(); if (w > 0 && w < 6 && (!S || !S.isTradingDay || S.isTradingDay(iso))) return iso; d = addDays(d, -1); }
    return d.toISOString().slice(0, 10);
  }
  function paintHeader() {
    var A = root.AG && root.AG.px;
    if (!PX || !A) return;
    CROPS.forEach(function (c) {
      var h = headline(c[0]); if (!h || !h.q || !num(h.q.close)) return;
      var q = h.q;
      var tm = /^Z[CS]([FGHJKMNQUVXZ])(\d{2})/.exec(String(q.ticker || '')), lab = tm ? MON['FGHJKMNQUVXZ'.indexOf(tm[1])] + ' \u2019' + tm[2] : (h.label ? String(h.label).replace(/'/g, '\u2019') : '');
      txt('hb-' + c[1] + '-k', (lab ? lab + ' ' : '') + c[2] + ' futures');
      html('hb-' + c[1] + '-v', '<span class="hb-n">' + A.price(q.close, { style: 'slash', fracClass: 'hb-frac' }) + '</span>');
      var S = root.AgPxStamp || {}, held = !!(q.move_withheld || q.roll);
      /* the change only as AgPxStamp.change pairs it with this price (audit Q16): never close minus open, which is not a day's move */
      var cc = null; try { cc = S.change ? S.change(q, h.key) : null; } catch (e) { cc = null; }
      var diff = cc && num(cc.net) ? cc.net : null, chg = '';
      if (held) chg = '<span class="hb-l"><span class="hb-n hb-chg nc">contract roll</span></span>';
      else if (num(diff)) {
        var cl = diff > 0 ? 'up' : diff < 0 ? 'dn' : 'nc';
        var ar = diff > 0 ? '<span aria-hidden="true">\u25b2 </span><span class="vh">up </span>' : diff < 0 ? '<span aria-hidden="true">\u25bc </span><span class="vh">down </span>' : '';
        chg = '<span class="hb-l"><span class="hb-n hb-chg ' + cl + '">' + ar + A.move(diff, { style: 'slash', sign: true }) + '</span></span>';
      }
      /* the stamp says when the quote is from; a settle carries its own year and age, and the cell greys once it is
         OLD_SESSIONS behind (components/price-local.js); an older close than the file's day says "Last close" */
      var sa = q.close_kind === 'settle' && S.settleAge ? S.settleAge(q.settle_date || q.close_date) : null;
      var old = !sa && (q.stale === true || (PX.stale_keys || []).indexOf(h.key) >= 0 || (q.close_date && q.close_date < prevSession()));
      var cell = $('hb-' + c[1]); if (cell) cell.classList.toggle('px-old', !!(sa && sa.old));
      var stamp = ''; try { stamp = S.html ? S.html(q, PX.fetched) : esc(S.shortStamp(q, PX.fetched)); } catch (e) {}
      var age = old ? '<span class="hb-l hb-old">Last close' + (q.close_date ? ' \u00b7 ' + md(utc(q.close_date)) : '') + '</span>' : (stamp ? '<span class="hb-l hb-age">' + stamp + '</span>' : '');
      var ov = '';
      try { if (!old && !held && S.overnightHtml) ov = S.overnightHtml(q, function (x) { return A.price(x, { style: 'slash' }); }, function (n) { return A.move(n, { style: 'slash', sign: true }); }, null, { short: true }); } catch (e) {}
      html('hb-' + c[1] + '-s', chg + age + (ov ? '<span class="hb-l hb-ovn">' + ov + '</span>' : '') || '&nbsp;');
    });
  }
  function chartData(c) {
    var key = c[0] === 'corn' ? 'corn' : 'soybean', s = STATS && STATS[key], h = headline(c[0]);
    if (!s || !Array.isArray(s.hist) || s.hist.length < 19 || !h || !num(h.q.close)) return null;
    var ds = fridays(s.hist_to, 19, tradingFn()), vs = s.hist.slice(-19);
    if (!ds || vs.some(function (v) { return !num(v) || v <= 0; })) return null;
    var today = utc(h.q.close_date) || ctDay();
    if ((today.getTime() - ds[ds.length - 1].getTime()) / 864e5 > 21) return null;   /* the history is old: no chart */
    if (today.getTime() <= ds[ds.length - 1].getTime()) return null;
    var A = root.AG && root.AG.px, cur = A ? A.priceDollars(h.q.close / 100, { style: 'slash' }).replace(/<[^>]+>/g, '') : money2(h.q.close / 100);
    return { d: ds.concat([today]), v: vs.concat([h.q.close / 100]), cur: cur, label: h.label || '' };
  }
  function tradingFn() { var S = root.AgPxStamp; return S && S.isTradingDay ? S.isTradingDay : null; }
  function pxSlash(v) { var A = root.AG && root.AG.px; return A && A.priceDollars ? A.priceDollars(v, { style: 'slash' }).replace(/<[^>]+>/g, '') : money2(v); }
  /* one line the chart says, from its own numbers (audit Q5): the move since the first weekly close, named by its
     date, and the distance from the highest weekly close. "At its high" only when today's price is the top of the
     line; today's price is never called a weekly close. */
  function takeaway(cd) {
    var vs = cd.v, n = vs.length, last = vs[n - 1], first = vs[0], hi = 0;
    for (var i = 1; i < n - 1; i++) if (vs[i] > vs[hi]) hi = i;
    var ch = (last - first) / first * 100, off = (vs[hi] - last) / vs[hi] * 100;
    var a = Math.abs(ch) < 0.5 ? 'About even with ' + md(cd.d[0]) : (ch > 0 ? 'Up ' : 'Down ') + Math.round(Math.abs(ch)) + '% since ' + md(cd.d[0]);
    var b = last >= vs[hi] ? ', above every weekly close on the chart.' : off < 0.5 ? ', within half a percent of the highest weekly close (' + pxSlash(vs[hi]) + ', ' + md(cd.d[hi]) + ').'
      : '; ' + Math.round(off) + '% under the highest weekly close, ' + pxSlash(vs[hi]) + ' on ' + md(cd.d[hi]) + '.';
    return a + b;
  }
  function chartLabel(c, cd) {
    var vs = cd.v, ds = cd.d, hi = 0; for (var i = 1; i < vs.length; i++) if (vs[i] > vs[hi]) hi = i;
    return c[4] + ' futures, front-month weekly closes: ' + pxSlash(vs[0]) + ' on ' + md(ds[0]) + ', today ' + pxSlash(vs[vs.length - 1]) + ' on ' + md(ds[ds.length - 1]) + '; highest ' + pxSlash(vs[hi]) + ' on ' + md(ds[hi]) + '.';
  }
  function drawCharts() {
    var ph = phone();
    CROPS.forEach(function (c) {
      var box = $(c[3]); if (!box) return;
      var cd = chartData(c), msg = box.querySelector('.hp-cmsg');
      var old = box.querySelector('svg'); if (old) old.parentNode.removeChild(old);
      if (!cd) { if (msg) msg.textContent = (STATS ? 'No chart: the weekly price history is not current.' : 'No chart: the price history did not load.'); return; }
      if (msg) msg.textContent = '';
      var take = takeaway(cd), A = root.AG && root.AG.px, out = {};
      txt('hp-take-' + c[1], take);
      var svg = lineSvg({ d: cd.d, v: cd.v, w: ph ? 366 : 446, h: ph ? 190 : 290, fs: fsFor(c[3], ph ? 366 : 446), uid: c[1] + (ph ? 'm' : 'd'), cur: cd.cur, label: chartLabel(c, cd), out: out });
      out.svg = svg; out.mode = 'x'; out.label = chartLabel(c, cd);
      out.text = function (i) { var v = cd.v[i]; return md(cd.d[i]) + (i === cd.v.length - 1 ? ', today: ' : ', weekly close: ') + (A ? A.priceDollars(v, { style: 'slash' }).replace(/<[^>]+>/g, '') : money2(v)); };
      chart(box, out);
      SPECS[c[1] === 'fc' ? 'corn' : 'soy'] = function () {
        return { head: c[4] + ' futures ' + cd.cur + ' a bushel: ' + take.charAt(0).toLowerCase() + take.slice(1), sub: 'Front-month weekly closes since ' + md(cd.d[0]) + ' (contracts roll inside the line), then today' + (cd.label ? '\u2019s ' + cd.label + ' contract' : ''),
          big: function (w, h) { return lineSvg({ d: cd.d, v: cd.v, w: w, h: h, fs: 16, uid: 'k' + c[1], cur: cd.cur, label: chartLabel(c, cd) }); },
          source: 'Chicago futures, Yahoo Finance, delayed 10 to 25 min. A cash bid is futures plus the elevator\u2019s basis.', file: c[2] + '-futures', date: cd.d[cd.d.length - 1] };
      };
    });
    var s0 = STATS && STATS.corn && fridays(STATS.corn.hist_to, 19, tradingFn());
    var cdh = chartData(CROPS[0]); if (cdh) txt('hp-fut-h', 'Futures, since ' + md(cdh.d[0]));   /* the heading from the chart's own first point, not a week count */
    var cd0 = chartData(CROPS[0]);
    if (s0 && cd0) txt('hp-fut-src', 'Chicago futures; your elevator’s cash bid is futures plus its basis. Weekly closes of the front month, ' + md(s0[0]) + ' to ' + md(s0[18]) + ' (contracts roll inside the line); the last point is today’s price of the contract named above. Yahoo Finance, delayed 10 to 25 min.');
  }

  /* ---- one small chart helper (every chart on this page goes through it; it can move onto a shared chart kit) ----
     chart(box, c)  draws c.svg into box and wires the readout: hover, tap or the arrow keys pick a point and a
                    line under the chart's corner says it (c.text(i)); c.at(x, y) for a map. c: {svg, pts, w, h, top,
                    bottom, mode: 'x' | 'xy' | 'map', label}. The box holds its room in css/home.css.
     SPECS[name]()  the picture card for that chart: {head, sub, big(w, h) -> svg, side: [lines], source, file}.
     card(spec)     the 1200 x 630 picture: AGSIST, the headline, the chart with its labels, the source and the date,
                    in fixed dark colors, so it reads on its own in a text thread. Share sends it with the phone's share
                    sheet (or the link where files cannot be shared); Save picture downloads it. */
  var SPECS = {};
  var NS = 'http://www.w3.org/2000/svg';
  function chart(box, c) {
    setTimeout(toolsReady, 0);   /* the caller sets its SPECS entry right after drawing */
    if (!box) return;
    var old = box.querySelector('svg'); if (old) old.parentNode.removeChild(old);
    box.insertAdjacentHTML('afterbegin', c.svg);
    box._c = c; box._i = -1;
    box.tabIndex = 0;
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', c.label + ' Use the arrow keys to read each point.');
    var m = box.querySelector('.hp-msg,.hp-cmsg'); if (m) m.textContent = '';
    if (!box.querySelector('.hp-ro')) {
      box.insertAdjacentHTML('beforeend', '<div class="hp-ro" aria-hidden="true" hidden></div><span class="vh" role="status" aria-live="polite"></span>');
    }
    if (box._wired) return;
    box._wired = true;
    function vb(e) { var r = box.getBoundingClientRect(), k = box._c; return [(e.clientX - r.left) * k.w / r.width, (e.clientY - r.top) * k.h / r.height]; }
    function near(x, y) {
      var k = box._c, best = -1, bd = Infinity;
      (k.pts || []).forEach(function (p, j) { var d = k.mode === 'xy' ? Math.hypot(p.x - x, p.y - y) : Math.abs(p.x - x); if (d < bd) { bd = d; best = j; } });
      return best;
    }
    box.addEventListener('pointermove', function (e) { var v = vb(e); if (box._c.mode === 'map') show(-1, v[0], v[1]); else show(near(v[0], v[1])); });
    box.addEventListener('pointerdown', function (e) { var v = vb(e); if (box._c.mode === 'map') show(-1, v[0], v[1]); else show(near(v[0], v[1])); });
    box.addEventListener('pointerleave', function () { if (doc.activeElement !== box) hide(); });
    box.addEventListener('blur', hide);
    box.addEventListener('focus', function () { var k = box._c; if (k.mode === 'map') show(-1, k.w / 2, k.h / 2); else show(box._i >= 0 ? box._i : (k.pts || []).length - 1); });
    box.addEventListener('keydown', function (e) {
      var k = box._c, n = (k.pts || []).length, i = box._i;
      if (k.mode === 'map') {
        var st = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }[e.key];
        if (st) { e.preventDefault(); box._mx = Math.max(0, Math.min(k.w, (box._mx == null ? k.w / 2 : box._mx) + st[0])); box._my = Math.max(0, Math.min(k.h, (box._my == null ? k.h / 2 : box._my) + st[1])); show(-1, box._mx, box._my); }
        return;
      }
      var j = e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowRight' ? i + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
      if (e.key === 'Escape') { hide(); return; }
      if (j == null || !n) return;
      e.preventDefault(); show(Math.max(0, Math.min(n - 1, j)));
    });
    function mark(svg) {
      var g = svg.querySelector('.ch-pickg');
      if (!g) { g = doc.createElementNS(NS, 'g'); g.setAttribute('class', 'ch-pickg'); g.innerHTML = '<line class="ch-guide"/><circle class="ch-pick" r="5"/>'; svg.appendChild(g); }
      return g;
    }
    function show(j, mx, my) {
      var k = box._c, svg = box.querySelector('svg'), ro = box.querySelector('.hp-ro'), live = box.querySelector('[role="status"]');
      if (!svg || !ro) return;
      var t, x, y;
      if (k.mode === 'map') { t = k.at(mx, my); x = mx; y = my; }
      else { var p = k.pts && k.pts[j]; if (!p) return; box._i = j; t = k.text(p.i); x = p.x; y = p.y; }
      if (!t) { hide(); return; }
      var g = mark(svg), ln = g.querySelector('line'), ci = g.querySelector('circle');
      if (k.mode === 'x') { ln.setAttribute('x1', x); ln.setAttribute('x2', x); ln.setAttribute('y1', k.top); ln.setAttribute('y2', k.bottom); } else { ln.setAttribute('x1', x); ln.setAttribute('x2', x); ln.setAttribute('y1', y); ln.setAttribute('y2', y); }
      ci.setAttribute('cx', x); ci.setAttribute('cy', y);
      g.style.display = '';
      ro.textContent = t; ro.hidden = false;
      var r = box.getBoundingClientRect(), px = x / k.w * r.width, half = ro.offsetWidth / 2;
      ro.style.left = Math.max(half, Math.min(r.width - half, px)) + 'px';
      if (live && live.textContent !== t) live.textContent = t;
    }
    function hide() { var ro = box.querySelector('.hp-ro'), g = box.querySelector('.ch-pickg'); if (ro) ro.hidden = true; if (g) g.style.display = 'none'; }
  }
  function card(sp) {
    var W = 1200, H = 630, svg = cardSvg(sp, sp.date instanceof Date && !isNaN(sp.date) ? sp.date : ctDay());   /* the data's own day (audit Q15) */
    return new Promise(function (ok, no) {
      var img = new Image();
      img.onload = function () { var cv = doc.createElement('canvas'); cv.width = W; cv.height = H; cv.getContext('2d').drawImage(img, 0, 0); cv.toBlob(function (b) { b ? ok(b) : no(new Error('blob')); }, 'image/png'); };
      img.onerror = function () { no(new Error('img')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  function act(btn) {
    var name = btn.closest('[data-chart]').getAttribute('data-chart'), how = btn.getAttribute('data-act'), mk = SPECS[name];
    if (!mk) { toolSay(btn, 'The chart is not drawn yet.'); return; }
    var sp = mk(), file = 'agsist-' + sp.file + '-' + ctDay().toISOString().slice(0, 10) + '.png', url = 'https://agsist.com/?utm_source=share&utm_medium=picture&utm_campaign=home-' + sp.file;
    card(sp).then(function (blob) {
      var f = null; try { f = new File([blob], file, { type: 'image/png' }); } catch (e) {}
      if (how === 'share' && navigator.share) {
        var data = f && navigator.canShare && navigator.canShare({ files: [f] }) ? { files: [f], title: sp.head, text: sp.head + ' agsist.com' } : { title: sp.head, text: sp.head, url: url };
        navigator.share(data).then(function () { ga('share_done', { kit: 'home-' + sp.file }); }, function () {});
        ga('share_open', { kit: 'home-' + sp.file });
        return;
      }
      var a = doc.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file;
      doc.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      ga('picture_download', { kit: 'home-' + sp.file });
    }, function () { toolSay(btn, 'The picture could not be made. Try again.'); });
  }

  /* ---- the price ticker (the strip under the menu): what geo.js does not write ----
     Each label names its contract month (the price file's nearby label for corn, soybeans, wheat and cattle; the
     earliest dated contract for the rows priced here); the deferred tiles name theirs; KC, MGEX, cotton and rice get
     their price and change here; a tile with no quote in the file is hidden, not shown as a dash. */
  var TICK = { corn: 'Corn', beans: 'Soybeans', wheat: 'Chicago SRW wheat', kcwheat: 'KC HRW wheat', mplswheat: 'MGEX HRS wheat', oats: 'Oats', cotton: 'Cotton',
    rice: 'Rough rice', cattle: 'Live cattle', feeders: 'Feeder cattle', hogs: 'Lean hogs', milk: 'Class III milk', meal: 'Soybean meal' };
  var OWN = { kcwheat: 'g', mplswheat: 'g', cotton: 'cl', rice: 'd' };
  var M3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function cmKey(k) { var m = /-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(\d\d)$/.exec(k || ''); return m ? MON[M3.indexOf(m[1])] + " '" + m[2] : null; }
  function frontKey(k) {
    var q = PX.quotes, best = null, bt = Infinity;
    Object.keys(q).forEach(function (x) {
      var m = /-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(\d\d)$/.exec(x), y = q[x];
      if (!m || x.indexOf(k + '-') !== 0 || x.length !== k.length + 6 || !y || y.close == null || y.stale === true) return;
      var t = +m[2] * 12 + M3.indexOf(m[1]); if (t < bt) { bt = t; best = x; }
    });
    return best;
  }
  function byTicker(qq) { var r = null; if (qq && qq.ticker) Object.keys(PX.quotes).some(function (x) { var lb = cmKey(x); if (lb && PX.quotes[x] && PX.quotes[x].ticker === qq.ticker) { r = lb; return true; } return false; }); return r; }
  /* the badge at the ticker's end (#ticker-age): what the prices are, in two short lines, the full stamp as its title.
     The old home script wrote it; the rebuilt page had left it at its "..." placeholder (audit A3). */
  function paintTickerAge(failed) {
    var tb = $('ticker-age'); if (!tb) return;
    var box = tb.parentNode, S = root.AgPxStamp, f = !failed && PX ? front('corn') : null, sp = null, full = '';
    try { sp = f && S && S.stampParts ? S.stampParts(f.q, PX.fetched) : null; full = f && S && S.stamp ? S.stamp(f.q, PX.fetched) : ''; } catch (e) { sp = null; }
    var two = !sp ? ['Not loaded', 'yet'] : sp.kind === 'settle' ? ['Settle', sp.at] : sp.kind === 'bell' ? ['Last trade', sp.at] : sp.kind === 'overnight' ? ['Overnight', sp.at]
      : sp.kind === 'read' ? ['Delayed', '10 to 25 min'] : ['As of', sp.at];
    var live = !!(sp && sp.kind === 'read' && PX.fetched && Date.now() - Date.parse(PX.fetched) <= 45 * 60000);
    tb.textContent = two[0]; tb.appendChild(doc.createElement('br')); tb.appendChild(doc.createTextNode(String(two[1]).replace(/ CT$/, '')));
    if (box) { box.classList.toggle('stale', !live); if (full) box.title = full; }
  }
  /* the price file did not load (audit A3/A10): the ticker says so, its empty tiles go, and the baked overnight line
     (a time-bound read from the bake) is hidden, keeping its room */
  function pricesFailed() {
    paintTickerAge(true);
    var ch = false;
    Array.prototype.forEach.call(doc.querySelectorAll('.prices-strip [data-sym]'), function (it) {
      var pe = it.querySelector('.t-price'); if (pe && /\d/.test(pe.textContent)) return;
      if (!it.classList.contains('t-noq')) { it.classList.add('t-noq'); ch = true; }
    });
    Array.prototype.forEach.call(doc.querySelectorAll('.hb-ovn'), function (e) { e.style.visibility = 'hidden'; });
    if (ch && typeof root.rebuildTickerLoop === 'function') root.rebuildTickerLoop();
  }
  function paintTicker() {
    var A = root.AG && root.AG.px, Q = PX && PX.quotes; if (!A || !Q) return;
    var qa = function (sel) { return Array.prototype.slice.call(doc.querySelectorAll(sel)); }, ch = false;
    paintTickerAge();
    Object.keys(TICK).forEach(function (k) {
      var own = OWN[k], fk = own ? frontKey(k) : null, f = front(k), q = fk ? Q[fk] : (f ? f.q : null);
      var mon = fk ? cmKey(fk) : (f && f.mon ? f.mon : null);
      var has = !!(q && q.close != null);
      qa('.prices-strip [data-sym="' + k + '"]').forEach(function (it) {
        if (it.classList.contains('t-noq') === has) { it.classList.toggle('t-noq', !has); ch = true; }
        if (!has) return;
        /* a continuous series with no dated twin (cotton CT=F) names no month: which contract it holds is not on file */
        var lb = it.querySelector('.t-label'), want = TICK[k] + (mon ? ' ' + mon : '');
        if (lb && lb.textContent !== want) { lb.textContent = want; ch = true; }
        if (!own) return;
        var pe = it.querySelector('.t-price'), ce = it.querySelector('.t-chg');
        var pt = own === 'g' ? A.price(q.close, { style: 'slash' }).replace(/<[^>]+>/g, '') : own === 'cl' ? f1(q.close, 2) + '¢' : '$' + f1(q.close, 2);
        if (pe && pe.textContent !== pt) { pe.textContent = pt; ch = true; }
        var cv = null; if (fk) { try { cv = root.AgPxStamp && root.AgPxStamp.change ? root.AgPxStamp.change(q, fk) : null; } catch (e) { cv = null; } }
        var n = cv ? cv.net : null, t = '', c = 'nc';
        if (q.move_withheld || q.roll) t = 'contract roll';
        else if (num(n)) { c = n > 0 ? 'up' : n < 0 ? 'dn' : 'nc'; t = n === 0 ? 'unch' : (n > 0 ? '▲ +' : '▼ −') + (own === 'g' ? A.move(Math.abs(n), { style: 'slash' }) : own === 'cl' ? f1(Math.abs(n), 2) + '¢' : '$' + f1(Math.abs(n), 2)); }
        if (ce && ce.textContent !== t) { ce.textContent = t; ce.className = 't-chg ' + c; ch = true; }
      });
    });
    /* the deferred tiles name the next harvest contract after the headline (AgPxStamp.harvest: Nov '27 soybeans once Jan '27 leads) */
    [['corn-dec', 'Corn deferred', 'Corn ', 'corn'], ['beans-nov', 'Soybeans deferred', 'Soybeans ', 'beans']].forEach(function (d) {
      var hv = null; try { hv = root.AgPxStamp && root.AgPxStamp.harvest ? root.AgPxStamp.harvest(PX, d[3]) : null; } catch (e) { hv = null; }
      var lb = hv && hv.label ? String(hv.label).replace(/\u2019/g, "'") : byTicker(Q[d[0]]); if (!lb) return;
      qa('.prices-strip [data-sym="' + d[0] + '"]').forEach(function (it) {
        var e = it.querySelector('.t-label'); if (e && e.textContent !== d[2] + lb) { e.textContent = d[2] + lb; ch = true; }
        var hq = hv && hv.q; if (!hq || !num(hq.close)) return;   /* the price and change of that same contract, so label and price agree */
        var pe = it.querySelector('.t-price'), ce = it.querySelector('.t-chg'), pt = A.price(hq.close, { style: 'slash' }).replace(/<[^>]+>/g, '');
        if (pe && pe.textContent !== pt) { pe.textContent = pt; ch = true; }
        /* its change only through AgPxStamp.change (audit Q16): a pair it rejects prints no change */
        var cv = null; try { cv = !(hq.move_withheld || hq.roll) && root.AgPxStamp && root.AgPxStamp.change ? root.AgPxStamp.change(hq, hv.key) : null; } catch (x) { cv = null; }
        var n = cv ? cv.net : null, t = !ce ? '' : num(n) ? (n === 0 ? 'unch' : (n > 0 ? '\u25b2 +' : '\u25bc \u2212') + A.move(Math.abs(n), { style: 'slash' })) : (hq.move_withheld || hq.roll ? 'contract roll' : '');
        if (ce && ce.textContent !== t) { ce.textContent = t; ce.className = 't-chg ' + (num(n) ? (n > 0 ? 'up' : n < 0 ? 'dn' : 'nc') : 'nc'); ch = true; }
      });
    });
    if (ch && typeof root.rebuildTickerLoop === 'function') root.rebuildTickerLoop();
  }

  /* ---- one quote per market: the front month, never a continuous series that has rolled ahead of it ----
     Audit Nov 12: KC wheat read KE=F, already the March contract, at $6.49 1/2 with a +15 1/4 change measured from
     December's close, while the front month (Dec '26) was $6.39 1/2 +5 1/4. Every row now takes the rolled file's
     -nearby alias (AgPxStamp.headline: the nearby, else the nearest dated month, else the continuous series), names its
     month, and prints the change only when AgPxStamp.change accepts the pair. A continuous series with no dated twin
     (cotton CT=F) prints its price with no change and no month: which contract it is cannot be confirmed. */
  var RQ = null;
  function rolledQuotes() {
    if (!RQ) { try { RQ = root.AgPxStamp && root.AgPxStamp.roll ? root.AgPxStamp.roll(PX.quotes) : PX.quotes; } catch (e) { RQ = PX.quotes; } }
    return RQ;
  }
  function front(k) {
    var S = root.AgPxStamp, Q = rolledQuotes(), h = null;
    try { h = S && S.headline ? S.headline({ quotes: Q, nearby: PX.nearby }, k) : null; } catch (e) { h = null; }
    if (!h) { var c = Q && (Q[k + '-nearby'] && num(Q[k + '-nearby'].close) ? k + '-nearby' : k); h = c && Q[c] && num(Q[c].close) ? { key: c, q: Q[c], label: null } : null; }
    if (!h || !h.q || !num(h.q.close)) return null;
    var cont = h.key === k && /=F$/.test(String(h.q.ticker || ''));
    var c2 = null;
    if (!cont && !(h.q.move_withheld || h.q.roll)) { try { c2 = S && S.change ? S.change(h.q, h.key) : (num(h.q.netChange) ? { net: h.q.netChange } : null); } catch (e) { c2 = null; } }
    return { key: h.key, q: h.q, mon: h.label ? String(h.label).replace(/’/g, "'") : null, chg: c2, cont: cont, roll: !!(h.q.move_withheld || h.q.roll) };
  }

  /* ---- more markets ---- */
  var MK = { wheat: 'c', kcwheat: 'c', oats: 'c', meal: 'd', soyoil: 'c2', cattle: 't', feeders: 't', hogs: 't', milk: 'd' };
  function paintMarkets() {
    var A = root.AG && root.AG.px;
    if (!PX || !PX.quotes || !A) return;
    var rows = doc.querySelectorAll('#hp-mk tbody tr'), n = 0, keys = [];
    Array.prototype.forEach.call(rows, function (tr) {
      var k = tr.getAttribute('data-k'), f = front(k), kind = MK[k], td = tr.querySelectorAll('td');
      if (!f || td.length < 3) return;
      var d = f.q;
      /* livestock to the board's tick (three places: $218.975, not $218.98) */
      var last = kind === 'c' ? A.price(d.close, { style: 'slash' }).replace(/<[^>]+>/g, '') : kind === 'c2' ? f1(d.close, 2) + '¢'
        : kind === 't' ? A.cash(d.close) : '$' + Number(d.close).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      var v = f.chg && num(f.chg.net) ? f.chg.net : null, ch = '<span class="nc">-</span>';
      /* a move the price run withheld (a change that crosses contracts near expiry) prints the price and no change */
      if (f.roll) ch = '<span class="nc">contract roll</span>';
      else if (v != null) {
        if (Math.abs(v) < 1e-9) ch = '<span class="nc">unch.</span>';
        else ch = '<span class="' + (v > 0 ? 'up' : 'dn') + '"><span aria-hidden="true">' + (v > 0 ? '▲' : '▼') + '</span><span class="vh">' + (v > 0 ? 'up' : 'down') + '</span> '
          + (kind === 'c' ? quarters(v) + '¢' : kind === 'c2' ? f1(Math.abs(v), 2) + '¢' : kind === 't' ? A.cash(Math.abs(v), { dollar: false }) : f1(Math.abs(v), 2)) + '</span>';
      }
      var sm = td[0].querySelector('.s'), unit = sm ? (sm.getAttribute('data-unit') || sm.textContent) : '';
      if (sm) { sm.setAttribute('data-unit', unit); sm.textContent = (f.mon ? f.mon + ', ' : '') + unit; }
      td[1].textContent = last; td[2].innerHTML = ch; n++; keys.push(f.key);
    });
    /* each row's own time: milk is a settle a day older than the grain trade, so one row's stamp cannot stand for all */
    var when = ''; try { when = root.AgPxStamp.board(rolledQuotes(), keys, PX.fetched); } catch (e) {}
    if (n) txt('hp-mk-src', 'Front month' + (when ? '. ' + when : '') + '. Yahoo Finance, delayed 10 to 25 min. Energy, metals and export sales are on All markets.');
  }

  /* ---- the Daily card ---- */
  /* the briefing's top stories under the fold. Each title links to the publisher's own news story (often through
     Google News), the same link the email carries. News links, not links to a data source, so the Oct 29
     no-data-source-links rule does not apply here. */
  function storyLink(u){
    u = (u == null ? '' : String(u)).trim();
    if (!u || u.length > 800 || /\s/.test(u) || u.slice(0, 8).toLowerCase() !== 'https://') return '';
    if ((u.split('/')[2] || '').indexOf('@') >= 0) return '';
    var h = ''; try { h = new URL(u).hostname.toLowerCase(); } catch (e) { return ''; }
    if (!h) return '';
    var shared = ['workers.dev', 'github.io', 'vercel.app', 'pages.dev', 'netlify.app', 'herokuapp.com'];
    for (var i = 0; i < shared.length; i++) if (h === shared[i] || h.slice(-(shared[i].length + 1)) === '.' + shared[i]) return '';
    return u;
  }
  function mdInline(t) { return esc(t).replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>'); }
  function paintStories(d) {
    var g = $('daily-otp-grid'), box = $('daily-otp'), list = Array.isArray(d.outside_the_pit) ? d.outside_the_pit : [];
    if (!g || !box) return;
    var h = list.map(function (it) {
      it = it || {};
      var t = String(it.title || '').trim(), b = String(it.body || '').trim(), l = storyLink(it.link), src = it.source == null ? '' : String(it.source).trim();
      if (!t && !b) return '';
      return '<div class="daily-otp-item">' + (t ? '<div class="daily-otp-title">' + (l ? '<a href="' + esc(l) + '" rel="noopener nofollow" target="_blank">' + esc(t) + '</a>' : esc(t)) + '</div>' : '')
        + (b ? '<div class="daily-otp-body">' + mdInline(b) + '</div>' : '') + (src ? '<div class="daily-otp-src">Source: ' + esc(src) + '</div>' : '') + '</div>';
    }).join('');
    if (!h) return;
    g.innerHTML = h; box.hidden = false;
    txt('daily-otp-h', d.otp_week_ahead ? 'Week ahead in ag' : 'Outside the pit: not moving prices today, but worth knowing');
  }
  function paintDaily(d) {
    if (!d) return;
    paintStories(d);
    var t = String(d.teaser || d.headline || '').trim(); if (!t) return;
    /* the issue's own date ("Wednesday, November 11, 2026"), else the day it was written, Central */
    var dd = d.date ? new Date(String(d.date).replace(/^[A-Za-z]+,\s*/, '') + ' 12:00 UTC') : null;
    var gen = dd && !isNaN(dd) ? new Date(Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth(), dd.getUTCDate())) : (d.generated_at ? ctDay(new Date(d.generated_at)) : null), today = ctDay();
    txt('daily-card-t', t);
    /* audit Q8: the teaser is the morning's words, and its move is the morning's; next to a live price it must say when */
    var at = ''; try { at = d.generated_at && root.AgPxStamp && root.AgPxStamp.clock ? root.AgPxStamp.clock(d.generated_at) : ctClock(d.generated_at || ''); } catch (e) { at = ''; }
    txt('daily-card-k', gen && gen.getTime() === today.getTime() ? 'This morning\u2019s briefing' + (at ? ', ' + at : '') + ':' : (gen ? 'Latest issue, ' + md(gen) + (gen.getUTCFullYear() !== today.getUTCFullYear() ? ', ' + gen.getUTCFullYear() : '') + ':' : 'Latest issue:'));
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
      var gl = $('hp-rp-gift'); if (gl) gl.hidden = false;
    } else if (on && pc && today <= pc) {
      txt('hp-rpchip-t', (d('print12x18') || '') + ' print. Order by ' + md(pc) + ' for Christmas →');
      html('hp-rp-by', 'Order a print by <b>' + md(pc) + '</b> for Christmas.');
      txt('hp-rp-k', 'Rain Print · Christmas gift');
    } else if (d('digital')) txt('hp-rpchip-t', 'From ' + d('digital') + '. Design yours →');
    /* audit S4: the rain gauge's one hook, in its own words (rain-print.json gauge_hook), only inside its window
       (gauge_window from..until, Central, inclusive); outside it the line keeps its room, unseen */
    var gh = R.gauge_hook, gw = R.gauge_window || {}, g0 = utc(gw.from), g1 = utc(gw.until), ge = $('hp-gauge');
    if (ge && gh && gh.line && gh.link && g0 && g1 && today >= g0 && today <= g1) {
      txt('hp-gauge-t', gh.line); txt('hp-gauge-l', gh.link + ' →'); ge.hidden = false;
    }
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
    for (k in none) if (county(none[k].name) === key) {
      if (cs[none[k].near]) return { fips: k, c: cs[none[k].near], near: none[k].near, nearName: cs[none[k].near].name };
      if (/^\d{5}$/.test(String(none[k].near || ''))) return { fips: k, cross: String(none[k].near) };   /* the nearest gauge is in another state's file */
    }
    return null;
  }
  /* state FIPS -> postal code, to find a nearest county across a state line in its own state's file (round 3) */
  var FIPS_ST = { '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
    '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ',
    '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA',
    '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY' };
  function msgIn(id, t) { var b = $(id); if (!b) return; var m = b.querySelector('.hp-msg'); if (m) m.textContent = t || ''; if (t && CHART_OF[id]) { delete SPECS[CHART_OF[id]]; toolsReady(); } }
  /* audit A5: Share and Save picture show only beside a chart that is drawn (its SPECS entry); hidden, they keep
     their room, and with no script they never show (css/home.css .hp-tools) */
  var CHART_OF = { 'hp-ch-corn': 'corn', 'hp-ch-soy': 'soy', 'hp-rain-ch': 'rain', 'hp-gdu-ch': 'gdu', 'hp-land-ch': 'land' };
  function toolsReady() {
    Array.prototype.forEach.call(doc.querySelectorAll('.hp-tools[data-chart]'), function (t) { t.classList.toggle('on', !!SPECS[t.getAttribute('data-chart')]); });
  }
  /* a short word on a tool, said in its row's status line and gone after a few seconds */
  function toolSay(btn, t) {
    var row = btn.closest('.hp-tools'); if (!row) return;
    var st = row.querySelector('.hp-tst');
    if (!st) { st = doc.createElement('span'); st.className = 'hp-tst'; st.setAttribute('role', 'status'); row.appendChild(st); }
    st.textContent = t; clearTimeout(st._t); st._t = setTimeout(function () { st.textContent = ''; }, 4000);
  }
  /* a11y round 3 (A3): a forecast that does not come says so under its heading; the empty cards go */
  function fcFail(t) { var m = $('hp-fc-msg'), a = doc.querySelector('.hp-a-fc'); if (m) { m.textContent = t; m.style.background = t ? 'var(--surface)' : ''; } if (a) a.classList.toggle('fcfail', !!t); }
  /* the old home's weather icons (index.html sprite), from the NWS words made into WMO-style codes (components/nws.js) */
  function wxIcon(code, day, cls) {
    var k = code == null ? 'i-cloud-sun' : code === 0 ? (day === 0 ? 'i-moon' : 'i-sun') : code <= 2 ? 'i-cloud-sun' : code === 3 ? 'i-cloud' : code === 45 || code === 48 ? 'i-cloud-fog'
      : code >= 51 && code <= 57 ? 'i-cloud-sun-rain' : code >= 61 && code <= 67 ? 'i-cloud-rain' : code >= 71 && code <= 77 ? 'i-snowflake' : code >= 80 && code <= 82 ? 'i-cloud-sun-rain'
      : code === 85 || code === 86 ? 'i-snowflake' : code >= 95 ? 'i-cloud-lightning' : 'i-cloud-sun';
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#' + k + '"/></svg>';
  }
  function hr12(iso) { var h = +String(iso).slice(11, 13); return h === 0 ? '12 am' : h === 12 ? 'noon' : (h % 12) + (h < 12 ? ' am' : ' pm'); }
  /* owner, Nov 12: the old home's fuller forecast: now (icon, temperature, feels like, wind, humidity, dew point,
     chance of rain), the days with icons, highs, lows and chance of rain, and the next 24 hours behind a fold */
  function drawForecast(p, seq) {
    if (!root.AgNWS) { fcFail('The forecast did not load. Try again in a few minutes.'); return; }
    root.AgNWS.forecast(p.lat, p.lon, { days: 8 }).then(function (f) {
      if (seq !== band.seq) return;
      var c = f.current || {}, D = f.daily || {}, H = f.hourly || {}, r = function (v) { return num(v) ? Math.round(v) : null; };
      txt('hp-now-t', num(c.temperature_2m) ? Math.round(c.temperature_2m) + '°' : '--°');
      var ni = $('hp-now-i'); if (ni) ni.outerHTML = wxIcon(c.weather_code, c.is_day, 'hp-nowi').replace('<svg ', '<svg id="hp-now-i" ');
      /* the grid's forecast for the hour that holds now, not a reading (audit Q15, C14) */
      html('hp-now-d', '<b>' + esc(WX[c.weather_code] || 'Forecast') + '</b><br>Hourly forecast');
      txt('hp-nw-f', r(c.apparent_temperature) != null ? r(c.apparent_temperature) + '°' : '-');
      txt('hp-nw-w', num(c.wind_speed_10m) ? (Math.round(c.wind_speed_10m) === 0 ? 'Calm' : (compass(c.wind_direction_10m) + ' ' + Math.round(c.wind_speed_10m) + ' mph').trim()) : '-');
      txt('hp-nw-h', r(c.relative_humidity_2m) != null ? r(c.relative_humidity_2m) + '%' : '-');
      txt('hp-nw-d', r(c.dew_point_2m) != null ? r(c.dew_point_2m) + '°' : '-');
      txt('hp-nw-p', r(c.precipitation_probability) != null ? r(c.precipitation_probability) + '%' : '-');
      var snowSoon = (H.weather_code || []).slice(0, 24).some(function (cc) { return (cc >= 71 && cc <= 77) || cc === 85 || cc === 86; });
      txt('hp-nw-pk', snowSoon ? 'Chance of rain or snow' : 'Chance of rain');
      /* round 3: each card's chance is the daytime one (6 am to 5 pm, from the hourly grid), so a night block is not
         counted on two days (the daily max ran midnight to midnight: Sunday night's 40% showed on Monday too); its low is
         the night after its high, so the pair reads as one day and night; a day with no high is left out, and today
         stays while it has a high (its low can be past: "-") */
      var times = D.time || [], todayKey = (c.time || '').slice(0, 10), i0 = Math.max(0, times.indexOf(todayKey)), lis = [];
      var HT = H.time || [], HP = H.precipitation_probability || [], HTe = H.temperature_2m || [], HC = H.weather_code || [];
      var dayPop = function (key) { var m = null; for (var q = 0; q < HT.length; q++) { var t = String(HT[q]), hh = +t.slice(11, 13); if (t.slice(0, 10) === key && hh >= 6 && hh <= 17 && num(HP[q])) m = m == null ? HP[q] : Math.max(m, HP[q]); } return m; };
      /* the night's low only when the grid reaches past midnight into it (the last card's evening alone is not a low) */
      var nightLow = function (key, next) { var m = null, late = false; for (var q = 0; q < HT.length; q++) { var t = String(HT[q]), hh = +t.slice(11, 13); if (next && t.slice(0, 10) === next && hh < 6) late = true; if (((t.slice(0, 10) === key && hh >= 18) || (next && t.slice(0, 10) === next && hh < 6)) && num(HTe[q])) m = m == null ? HTe[q] : Math.min(m, HTe[q]); } return late ? m : null; };
      /* the day's icon and words from the same 6 am to 5 pm hours as its chance: the worst code in them */
      var dayCode = function (key, fb) { var w = null; for (var q = 0; q < HT.length; q++) { var t = String(HT[q]), hh = +t.slice(11, 13), cc = HC[q]; if (t.slice(0, 10) === key && hh >= 6 && hh <= 17 && num(cc) && (w == null || cc > w)) w = cc; } return w == null ? fb : w; };
      var snowy = function (key) { for (var q = 0; q < HT.length; q++) { var t = String(HT[q]), hh = +t.slice(11, 13), cc = HC[q]; if (t.slice(0, 10) === key && hh >= 6 && hh <= 17 && ((cc >= 71 && cc <= 77) || cc === 85 || cc === 86)) return true; } return false; };
      for (var i = i0; i < times.length && lis.length < 7; i++) {
        var hi = (D.temperature_2m_max || [])[i];
        if (!num(hi)) continue;   /* a day with no high (past the grid's end, or today's high already gone) is left out */
        var dd = utc(times[i]), nl = nightLow(times[i], times[i + 1]), lo = nl, dc = dayCode(times[i], (D.weather_code || [])[i]);
        var pp = dayPop(times[i]); if (!num(pp)) pp = (D.precipitation_probability_max || [])[i];
        var word = snowy(times[i]) ? 'snow' : 'rain';
        lis.push('<li><b>' + (times[i] === todayKey ? 'Today' : DOW[dd.getUTCDay()]) + '</b>' + wxIcon(dc, 1) + '<span><span class="vh">high </span><span class="hi">' + Math.round(hi) + '°</span> <span class="vh">, low </span><span class="lo">' + (num(lo) ? Math.round(lo) + '°' : '-')
          + '</span><span class="vh">, ' + esc(WX[dc] || '') + ', </span></span><span class="pp">' + (num(pp) ? Math.round(pp) + '% ' + word + '<span class="vh"> chance</span>' : '-') + '</span></li>');
      }
      if (lis.length) html('hp-d7', lis.join(''));
      /* the next 24 hours from this hour */
      var ht = H.time || [], h0 = -1, now = String(c.time || '').slice(0, 13), cells = [];
      for (var k = 0; k < ht.length; k++) if (String(ht[k]).slice(0, 13) >= now) { h0 = k; break; }
      if (h0 >= 0) for (var j = h0; j < ht.length && cells.length < 24; j++) {
        var tt = (H.temperature_2m || [])[j], hp = (H.precipitation_probability || [])[j];
        cells.push('<div><b>' + (j === h0 ? 'Now' : hr12(ht[j])) + '</b>' + wxIcon((H.weather_code || [])[j], (H.is_day || [])[j]) + (num(tt) ? Math.round(tt) + '°' : '-') + '<span class="pp">' + (num(hp) ? Math.round(hp) + '%<span class="vh"> chance of rain or snow</span>' : '-') + '</span></div>');
      }
      var hr = $('hp-hourly'); if (hr) hr.hidden = !cells.length; if (cells.length) html('hp-hr', cells.join(''));
      var src = 'Each day: high, then the low of the night after; percent: the daytime chance of rain or snow, 6 am to 5 pm. Now: the forecast for this hour. National Weather Service forecast';
      try { var n = f._nws; if (n && n.updated) src += ', issued ' + new Date(n.updated).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: f.timezone || undefined, timeZoneName: 'short' }); } catch (e) {}
      txt('hp-fc-src', src + '.');
      fcFail(''); var m = $('hp-fc-msg'); if (m) m.style.background = '';
    }, function (e) {
      if (seq !== band.seq) return;
      fcFail(e && e.outside ? 'The National Weather Service has no forecast for this point.' : 'The National Weather Service forecast did not answer. Try again in a few minutes.');
    });
  }
  /* owner, Nov 12: the live radar back on the home page, as the old home had it (Windy's radar layer, the same embed
     components/geo.js built), centred on the reader's place; it loads only when the band comes near the screen
     (loadBand runs from later()), holds its room, and says so if it does not come in */
  /* round 3 (phones): the map takes no touches until "Tap to move the map", so a thumb scrolling the page is not caught in it */
  /* a11y re-measure: after the tap, focus goes to the map's box (not lost to the page); "Done" gives the page its scroll back */
  function liveTap() {
    var b = $('hp-livego'), d = $('hp-livedone'), box = $('hp-live'); if (!b || !box) return;
    b.addEventListener('click', function () { box.classList.add('on'); try { box.focus({ preventScroll: true }); } catch (e) { box.focus(); } });
    if (d) d.addEventListener('click', function () { box.classList.remove('on'); try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); } });
  }
  var liveSeq = 0;
  /* a11y round 3 (A2, A5): a frame's load event fires on a failed page too, so the host is probed first (a no-cors
     fetch that rejects when Windy cannot be reached), and each call has its own sequence number so a late timer from an
     earlier place never writes over a newer one */
  function drawLive(p) {
    var f = $('hp-live-f'), msg = $('hp-live-msg'), box = $('hp-live'); if (!f) return;
    var la = (+p.lat).toFixed(4), lo = (+p.lon).toFixed(4), mine = ++liveSeq;
    var u = 'https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=in&metricTemp=%C2%B0F&metricWind=mph&zoom=7&overlay=radar&product=radar&level=surface'
      + '&lat=' + la + '&lon=' + lo + '&detailLat=' + la + '&detailLon=' + lo + '&detail=false&pressure=false&menu=false&message=false&marker=true&calendar=now&thunder=false';
    if (f.getAttribute('src') === u) return;
    var fail = function () { if (mine !== liveSeq) return; f.removeAttribute('src'); f.hidden = true; if (box) box.classList.add('fail'); if (msg) msg.textContent = 'The live radar did not load. Try again in a few minutes, or open the radar on the rain page.'; };
    if (box) box.classList.remove('fail', 'ok');
    if (msg) msg.textContent = 'Loading the live radar';
    var probe = root.fetch ? timed(fetch('https://embed.windy.com/', { mode: 'no-cors', cache: 'no-store' }), 10000) : Promise.resolve();
    probe.then(function () {
      if (mine !== liveSeq) return;
      var done = false;
      f.onload = function () { if (mine !== liveSeq) return; done = true; f.hidden = false; if (box) box.classList.add('ok'); if (msg) msg.textContent = ''; };
      f.hidden = false; f.setAttribute('src', u);
      setTimeout(function () { if (!done) fail(); }, 15000);
    }, fail);
  }
  function liveOff() { liveSeq++; var f = $('hp-live-f'); if (f) { f.removeAttribute('src'); f.hidden = true; } }
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
    /* the normal only where the file has one for every point: 18 of 93 Illinois counties carry usual null and a
       null normal on every day, which drew "normal 0.0 in" (audit Q2) */
    var hasN = num(c.usual) && c.usual > 0 && b.slice(1).every(num);
    if (!hasN) b = null;
    /* round 3: the file's own percent, never one worked out here: the builder withholds it on a normal under 1.00 in
       (Jan 1 to 10 printed "239% of normal"); then the card gives inches only */
    var pct = hasN && num(c.pct) ? c.pct : null;
    /* days the gauge did not report are not rain: say how many (audit Q13) */
    var miss = num(c.missing) && c.missing > 0 ? c.missing : 0;
    var head = 'Rain this year: ' + f1(c.total) + ' in' + (num(pct) ? ', ' + pct + '% of normal' + (end ? ' to ' + md(end) : '') : '') + (miss ? '; ' + miss + ' day' + (miss === 1 ? '' : 's') + ' not reported' : '');
    txt('hp-rain-h', head);
    txt('hp-yr', String(yr));
    var key = $('hp-rain-key');
    /* round 3: c.usual is the normal over the days the gauge reported; with days missing the key says so */
    if (key) { var nk = key.lastChild; nk.hidden = !hasN; if (hasN) nk.lastChild.textContent = (miss ? 'Normal for the days reported: ' : 'Normal: ') + f1(c.usual) + ' in (1991 to 2020)'; }
    /* owner, Nov 12: the old home's month bars, this year against normal, with the percent of normal up top */
    /* round 3: rain's percent in a neutral colour (more rain is not good or bad by itself) */
    var onDays = miss && num(c.reported) ? ' on the ' + c.reported + ' days reported' : '';
    html('hp-rain-pct', num(pct) ? '<b>' + pct + '%</b> of normal (' + f1(c.usual) + ' in' + (onDays || (end ? ' to ' + md(end) : '')) + ')'
      : hasN ? '<b>' + f1(c.total, 2) + ' in</b> since Jan 1; normal ' + f1(c.usual, 2) + ' in' + onDays + ', too small for a percent'
      : '<b>' + f1(c.total) + ' in</b> since Jan 1; no normal on file for this gauge');
    var box = $('hp-rain-ch'); if (!box) return;
    var MR = (Array.isArray(c.months) ? c.months : []).map(function (r, i) {
      var ok = Array.isArray(r) && num(r[0]);
      return { lab: MON[i], a: ok ? r[0] : null, n: hasN && ok && num(r[1]) ? r[1] : null, gap: !ok, rep: ok ? r[2] : null, so: ok ? r[3] : null,
        part: end && i === end.getUTCMonth() && end.getUTCDate() < new Date(Date.UTC(yr, i + 1, 0)).getUTCDate() };
    });
    if (!MR.length) { msgIn('hp-rain-ch', 'No month totals for this county yet.'); return; }
    var opts = function (w, h, fs, out) { return { m: MR, w: w, h: h, fs: fs, out: out, steps: [0.5, 1, 2, 5, 10], fmt: function (v) { return v + ' in'; }, vfmt: function (v) { return f1(v, 2) + ' in'; },
      label: 'Rain by month, ' + yr + (hasN ? ', against the 1991 to 2020 normal for the same days' : '') + '. Since January 1: ' + f1(c.total, num(pct) ? 1 : 2) + ' inches' + (num(pct) ? ', ' + pct + ' percent of normal.' : hasN ? '; normal ' + f1(c.usual, 2) + ' inches, too small for a percent.' : '; no normal on file for this gauge.') }; };   /* the same conditions as the visible line (round 3 re-verify) */
    var bw0 = Math.round(box.clientWidth) || (ph ? 366 : 380), out = {}; out.svg = barSvg(opts(bw0, ph ? 200 : 250, 12.5, out));   /* drawn at the box's own width: 1 unit = 1 px, so 12.5 px text is 12.5 px */ out.mode = 'x'; out.label = head + '.';
    out.text = function (i) { var r = MR[i]; if (r.gap) return r.lab + ': not enough days reported';
      return r.lab + (r.part ? ' so far' : '') + ': ' + f1(r.a, 2) + ' in' + (num(r.n) ? '; normal ' + f1(r.n, 2) + ' in' + (r.n >= 1 ? ' (' + Math.round(r.a / r.n * 100) + '%)' : '') : '') + (num(r.rep) && num(r.so) && r.rep < r.so ? '; ' + r.rep + ' of ' + r.so + ' days reported' : ''); };
    chart(box, out);
    var st = c.station || {}, net = st.net === 'cocorahs' ? ' (CoCoRaHS)' : st.net ? ' (NOAA co-op)' : '';
    txt('hp-rain-src', 'Jan 1 to ' + (end ? md(end) : '') + '. ' + (cf.near ? 'No station in ' + countyName(p.county, p.state) + '; nearest county: ' + cf.nearName + '. ' : '') + (st.name ? 'Gauge: ' + st.name + net + '. ' : '') + 'NOAA daily records via RCC-ACIS.');
    SPECS.rain = function () { return { head: head + (cf.near ? ', nearest gauge to ' : ' at ') + countyName(p.county, p.state) + ', ' + p.state, sub: String(yr) + ' by month (gold)' + (hasN ? ' against the 1991 to 2020 normal for the same days (dashed)' : ', no normal on file for this gauge') + ', inches',
      big: function (w, h) { return barSvg(opts(w, h, 16)); }, source: (cf.near ? 'No station in ' + countyName(p.county, p.state) + '; nearest county: ' + cf.nearName + '. ' : '') + (st.name ? 'Gauge: ' + st.name + net + '. ' : '') + 'NOAA daily records via RCC-ACIS, Jan 1 to ' + (end ? md(end) : '') + '.', file: 'rain', date: end }; };
  }
  /* mmdd (1109) of this year -> a date */
  function mmddDate(v, yr) { return num(v) && v >= 101 && v <= 1231 ? new Date(Date.UTC(yr, Math.floor(v / 100) - 1, v % 100)) : null; }
  /* Corn GDUs since May 1 (audit Q4/A2). The headline is the file's season figure "g" ([total, days missing, normal
     over the same reported days, years, pct]; "m" when withheld for missing days). The chart plots the monthly
     totals "gm" ([total, normal or null, days reported, days so far]; null when the month is withheld) and stops at
     the first withheld month rather than drawing through it; the normal line only where every plotted month has
     one. 39% of counties had a null normal, and the old loop broke at the first one and said "The corn GDU season
     starts May 1." in November. The end date is the county's own (c.a), not the state file's. */
  function drawGdu(W, p, fips, cf) {
    var borrowed = cf && cf.near ? 'No station in ' + countyName(p.county, p.state) + '; nearest county: ' + cf.nearName + '. ' : '';
    var c = W && W.counties && W.counties[fips], yr = (W && W.year) || ctDay().getUTCFullYear();
    txt('hp-yr2', String(yr));
    var today = ctDay(), early = today < new Date(Date.UTC(today.getUTCFullYear(), 4, 15));
    var g = c && Array.isArray(c.g) && num(c.g[0]) ? c.g : null;
    if (!c || !Array.isArray(c.gm) || c.gm.length < 5 || !g) {
      msgIn('hp-gdu-ch', early && (!c || !Array.isArray(c.gm) || c.gm.length < 5) ? 'The corn GDU season starts May 1.' : c ? 'Not enough days reported at this station to count GDUs.' : 'No temperature station on file for this county.');
      return;
    }
    var end = mmddDate(c.a, yr) || utc(W.edate), ph = phone(), gaps = [];
    /* owner, Nov 12: month bars from May, this year against normal; a withheld month is a gap marked n/a, never a zero */
    var MG = [];
    for (var m = 4; m < c.gm.length; m++) {
      var gm = c.gm[m], ok = Array.isArray(gm) && num(gm[0]);
      if (!ok) gaps.push(MON[m]);
      MG.push({ lab: MON[m], a: ok ? gm[0] : null, n: ok && num(gm[1]) ? gm[1] : null, gap: !ok, rep: ok ? gm[2] : null, so: ok ? gm[3] : null,
        part: m === c.gm.length - 1 && end && end.getUTCDate() < new Date(Date.UTC(yr, m + 1, 0)).getUTCDate() });
    }
    if (!MG.some(function (x) { return !x.gap; })) { msgIn('hp-gdu-ch', 'Not enough days reported at this station to count GDUs.'); return; }
    var hasNM = MG.some(function (x) { return num(x.n); });
    var now = g[0], norm = num(g[2]) && g[2] > 0 ? g[2] : null, gp = norm ? (num(g[4]) ? g[4] : Math.round(now / norm * 100)) : null;
    var gmiss = num(g[1]) && g[1] > 0 ? g[1] : 0;
    var head = 'Corn GDUs since May 1: ' + comma(now) + (norm ? ', ' + comma(Math.abs(now - norm)) + (now >= norm ? ' ahead of' : ' behind') + ' normal' : '') + (gmiss ? '; ' + gmiss + ' day' + (gmiss === 1 ? '' : 's') + ' not reported' : '');
    txt('hp-gdu-h', head);
    /* round 3: no big percent on a season normal under 100 GDUs (a few May days make a wild percent) */
    html('hp-gdu-pct', norm && norm >= 100 ? '<b class="' + (gp >= 100 ? 'up' : 'dn') + '">' + gp + '%</b> of normal (' + comma(norm) + ')' : norm ? '<b>' + comma(now) + '</b> GDUs; normal ' + comma(norm) + ' so far' : '<b>' + comma(now) + '</b> GDUs; no normal on file for this station');
    var key = $('hp-gdu-h').parentNode.querySelector('.hp-key');
    if (key) { var nk = key.lastChild; nk.hidden = !hasNM; if (hasNM) nk.lastChild.textContent = 'Normal (1991 to 2020)'; }
    /* round 3: the season total counts the reported days of the months the bars mark n/a; the first 28°F freeze, when the file has one */
    var fz = c.fr && Array.isArray(c.fr.f28) ? mmddDate(c.fr.f28[0], yr) : null;
    var tail = (gaps.length ? ' Not enough days reported in ' + gaps.join(', ') + ' to draw ' + (gaps.length === 1 ? 'that month' : 'those months') + '; the season total counts the days reported in ' + (gaps.length === 1 ? 'it' : 'them') + (gmiss ? ' (' + gmiss + ' day' + (gmiss === 1 ? '' : 's') + ' missing)' : '') + '.' : '')
      + (fz && (!end || fz <= end) ? ' First 28°F freeze: ' + md(fz) + '.' : '');
    var box = $('hp-gdu-ch'); if (!box) return;
    var opts = function (w, h, fs, out) { return { m: MG, w: w, h: h, fs: fs, out: out, steps: [50, 100, 250, 500], fmt: function (v) { return comma(v); }, vfmt: function (v) { return comma(v); },
      label: 'Corn growing degree units by month since May 1, ' + yr + ': ' + comma(now) + (norm && norm >= 100 ? ', ' + gp + ' percent of normal' : norm ? '; normal ' + comma(norm) + ' so far' : '; no 1991 to 2020 normal on file for this station') + '.' }; };
    var bw0 = Math.round(box.clientWidth) || (ph ? 366 : 380), out = {}; out.svg = barSvg(opts(bw0, ph ? 200 : 250, 12.5, out));   /* drawn at the box's own width: 1 unit = 1 px, so 12.5 px text is 12.5 px */ out.mode = 'x'; out.label = head + '.';
    out.text = function (i) { var r = MG[i]; if (r.gap) return r.lab + ': not enough days reported';
      return r.lab + (r.part ? ' so far' : '') + ': ' + comma(r.a) + ' GDUs' + (num(r.n) ? '; normal ' + comma(r.n) + (r.n >= 50 ? ' (' + Math.round(r.a / r.n * 100) + '%)' : '') : '') + (num(r.rep) && num(r.so) && r.rep < r.so ? '; ' + r.rep + ' of ' + r.so + ' days reported' : ''); };
    chart(box, out);
    var s = c.s && c.s[0] ? 'Station ' + c.s[0] + '. ' : '';
    txt('hp-gdu-src', 'Counted May 1 through ' + (end ? md(end) : '') + ', 86/50 method, by month.' + tail + ' ' + borrowed + s + 'NOAA daily records via RCC-ACIS.');
    SPECS.gdu = function () { return { head: head + (borrowed ? ', nearest station to ' : ', ') + countyName(p.county, p.state) + ', ' + p.state, sub: String(yr) + ' by month (gold)' + (hasNM ? ' against the 1991 to 2020 normal for the same days (dashed)' : ', no normal on file for this station') + ', corn GDUs, 86/50 method',
      big: function (w, h) { return barSvg(opts(w, h, 16)); }, source: borrowed + s + 'NOAA daily records via RCC-ACIS, May 1 to ' + (end ? md(end) : '') + ', month ends.', file: 'gdu', date: end }; };
  }

  function loadBand() {
    var p0 = readPlace();
    if (!hasZip(p0)) return;
    fullPlace().then(function (p) {
      if (!p || !hasZip(p) || p.lat == null || !/^[A-Z]{2}$/.test(p.state || '')) {
        /* a11y round 3 (A6): a ZIP table that did not download is "did not load, try again", not an unknown ZIP */
        var zz = p && p.zip ? p.zip : '';
        if (!zz) return;
        placeCheck(zz).then(function (r) { if (r === 'failed') bandFailed('The place for ZIP ' + zz + ' did not load. Try again in a minute.'); else unknownBand(zz); });
        return;
      }
      if (band.zip === p.zip) return;
      band.zip = p.zip; var seq = ++band.seq;
      var wx0 = $('hp-wx'), wm0 = $('hp-wxmsg'); if (wx0) wx0.classList.remove('unknown'); if (wm0) wm0.textContent = '';
      drawForecast(p, seq);
      drawLive(p);
      getJSON(stateFile('rain/', p.state)).then(function (R) {
        var cf = findCounty(R, p.county), wst = p.state;
        if (!cf || !cf.cross) return [R, cf, wst];
        /* round 3: the nearest gauge is across the state line: read it from that state's own file */
        var st2 = FIPS_ST[cf.cross.slice(0, 2)];
        if (!st2) return [R, null, wst];
        return getJSON(stateFile('rain/', st2)).then(function (R2) {
          var c2 = R2 && R2.counties && R2.counties[cf.cross];
          return c2 ? [R2, { fips: cf.fips, c: c2, near: cf.cross, nearName: c2.name + ', ' + st2 }, st2] : [R, null, wst];
        }, function () { return [R, null, wst]; });
      }).then(function (rr) {
        if (seq !== band.seq) return;
        var R = rr[0], cf = rr[1], wst = rr[2];
        drawRain(R, p, cf);
        if (!cf) { msgIn('hp-gdu-ch', 'No temperature station on file for this county.'); return; }
        getJSON(stateFile('rain/wx/', wst)).then(function (W) { if (seq === band.seq) drawGdu(W, p, cf.near || cf.fips, cf); }, function () { msgIn('hp-gdu-ch', 'The GDU file did not load. Try again later.'); });
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
    var lab = 'Farmland sales in ' + cn + ', price per acre, ' + md(from) + ', ' + from.getUTCFullYear() + ' to ' + md(to) + ', ' + to.getUTCFullYear();
    var opts = function (w, h, fs) { return { rows: rows, med: u[0], q1: u[1], q3: u[2], w: w, h: h, fs: fs, from: from, to: to, ring: ring || newest, label: lab }; };
    var ch = landSvg(opts(ph ? 366 : 374, ph ? 190 : 250, fsFor('hp-land-ch', ph ? 366 : 374)));
    var src = (L && L.lead && L.lead[st] && L.lead[st].src) || 'State';
    txt('hp-land-h', words.h || (cn + ' median: $' + comma(u[0]) + ' an acre'));
    var nw = words.p || ((num(u[3]) ? u[3] : rows.length) + ' bare farmland sales over two years. Newest: ' + Math.round(newest.acres) + ' acres'
      + (newest.place ? ' in ' + newest.place : '') + ', $' + comma(newest.ppa) + ' an acre, ' + md(newest.d) + '.');
    txt('hp-land-p', nw);
    var head = words.h || (cn + ' median: $' + comma(u[0]) + ' an acre');
    chart($('hp-land-ch'), { svg: ch.svg, pts: ch.pts, w: ch.w, h: ch.h, top: ch.ptop, bottom: ch.pbottom, mode: 'xy', label: head + '. Each dot is one sale.',
      text: function (i) { var r = rows[i]; return md(r.d) + ', ' + r.d.getUTCFullYear() + ': ' + Math.round(r.acres) + ' acres, $' + comma(r.ppa) + ' an acre'; } });
    txt('hp-land-src', 'Each dot is one sale; bigger dots are more acres. Shaded: the middle half of sales.'
      + (ch.off ? ' ' + ch.off + ' sale' + (ch.off === 1 ? '' : 's') + ' outside $' + comma(ch.bottom) + ' to $' + comma(ch.top) + ' ' + (ch.off === 1 ? 'is' : 'are') + ' off the chart.' : '')
      + ' ' + src + ' transfer records, ' + MON[from.getUTCMonth()] + ' ' + from.getUTCFullYear() + ' to ' + MON[to.getUTCMonth()] + ' ' + to.getUTCFullYear() + '. No names.'
      );
    /* the lead rule (audit Q3), folded in the line index.html holds for it, so the card keeps its height */
    landRule(words.rule);
    var all = $('hp-land-all'); if (all && NAMES[st]) all.setAttribute('href', '/land-sales/' + slug(NAMES[st]) + '/' + slug(cn));
    SPECS.land = function () { return { head: head + (words.h ? '' : ', ' + st), sub: (words.h ? cn + ': e' : 'E') + 'very bare farmland sale with acres and price over 24 months, price per acre; line: the county median; shaded: the middle half',
      big: function (w, h) { return landSvg(opts(w, h, 16)).svg; }, source: src + ' transfer records, ' + MON[from.getUTCMonth()] + ' ' + from.getUTCFullYear() + ' to ' + MON[to.getUTCMonth()] + ' ' + to.getUTCFullYear() + '. No names.', file: 'farm-sales', date: to }; };
    return true;
  }
  function landRule(rule) {
    var lr = $('hp-land-rule'); if (!lr) return;
    txt('hp-land-rule-t', rule ? ' ' + rule : ''); lr.style.visibility = rule ? '' : 'hidden'; if (!rule) lr.open = false;
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
    /* audit Q3: the pick is the top price among the sales the lead rule keeps, but sales over twice the state's middle
       are left out (higher sales are on file: Will, Kendall, Kane on Nov 12), so the card never says "top" or "highest":
       it is "a recent farm sale"; the rule itself (lead.json "rule", with the cap) is in the held fold below */
    var w = { h: 'A recent farm sale in ' + NAMES[st] + ': $' + comma(r.ppa) + ' an acre',
      p: not + Math.round(r.acres) + ' acres in ' + countyName(r.county, st) + ', ' + (r.basis === 'sale date' ? 'sold ' : 'recorded ') + md(utc(r.when)) + '. County median: $' + comma(r.med) + '.',
      rule: typeof r.rule === 'string' ? r.rule : '' };
    countyFile(st, r.county).then(function (F) {
      if (seq !== landSeq) return;
      var ring = { d: utc(r.when), ppa: r.ppa };
      if (!drawLand(F, L, st, ring, w)) throw new Error('few');
      var all = $('hp-land-all'); if (all && r.url) all.setAttribute('href', r.url);
    }).catch(function () {
      txt('hp-land-h', w.h); txt('hp-land-p', w.p); landRule(w.rule); msgIn('hp-land-ch', 'The county chart did not load.');
    });
  }

  function placeChanged() { band.zip = ''; if (bandStarted) loadBand(); if (landStarted) loadLand(); }
  var bandStarted = false, landStarted = false;

  /* ---- price alert: same double opt-in as before (workers/subs-worker.js WATCH A PRICE TARGET) ---- */
  function priceAlert() {
    var PA_WORKER = 'https://agsist-api.dnilgis.workers.dev';
    function paId(symbol, direction, targetCents) {
      var s = (symbol + '|' + direction + '|' + targetCents).toUpperCase();
      var h = 0x811c9dc5;
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
      var opt = sym.options[sym.selectedIndex], named = opt && opt.getAttribute('data-c') ? opt.getAttribute('data-c') : ((PA_BASE[symbol] || symbol) + (/-(dec|nov)$/.test(symbol) ? ' (new crop)' : ''));
      var label = named + ' ' + (direction === 'above' ? 'above' : 'below') + ' $' + dollars.toFixed(2);
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

  /* audit Q12: each alert option names the contract the alert service watches (its key in data/prices.json, read
     raw as the service reads it): "Soybeans, Nov '26 (rolls to Nov '27 after Nov 13)" when the dated month expires
     within three weeks, "front month" for a continuous series whose month is not on file. The six symbols stay. */
  var PA_BASE = { 'corn': 'Corn', 'corn-dec': 'Corn', 'beans': 'Soybeans', 'beans-nov': 'Soybeans', 'wheat': 'Chicago SRW wheat', 'cattle': 'Live cattle' };
  function alertWords(sym, q, today) {
    var S = root.AgPxStamp, base = PA_BASE[sym] || sym, lab = q && S && S.label ? S.label(q.ticker) : '';
    if (!lab) { var nf = nextAfter(sym.split('-')[0], headline(sym.split('-')[0])); return base + ', front month' + (nf ? ' (moves to ' + nf.next + ' before ' + nf.now + ' expires)' : ''); }
    var out = base + ', ' + lab, dead = S.deadFrom ? S.deadFrom(q.ticker) : null, dd = utc(dead);
    if (dd && (dd - today) / 864e5 <= 21 && dd > today) {
      /* round 3: the harvest aliases (corn-dec, beans-nov) roll a year on; any other dated option to the next month on file (cattle Dec -> Feb) */
      var nx = /-(dec|nov)$/.test(sym) ? lab.replace(/'(\d\d)$/, function (m0, y) { return "'" + ('0' + ((+y + 1) % 100)).slice(-2); }) : ((nextAfter(sym.split('-')[0], { q: q }) || {}).next || '');
      /* its last trading day: the trading day before the first dead day (ZSX26: dead from Nov 15, last trade Fri Nov 13) */
      var lt = addDays(dd, -1), g = 0; while (S.isTradingDay && !S.isTradingDay(lt.toISOString().slice(0, 10)) && g++ < 6) lt = addDays(lt, -1);
      if (nx) out += ' (rolls to ' + nx + ' after ' + md(lt) + ')';
    }
    return out;
  }
  /* the next dated month on file after a quote's own: {now: "Dec '26", next: "Mar '27"} or null. A continuous series
     moves to it before the front month expires (round 3: it does not wait for expiry), so a roll is not read as a move */
  function nextAfter(root0, h) {
    var S = root.AgPxStamp, Q = PX && PX.quotes; if (!h || !h.q || !Q || !S || !S.label) return null;
    var hm = /([FGHJKMNQUVXZ])(\d\d)\b/.exec(String(h.q.ticker || '')), F = 'FGHJKMNQUVXZ'; if (!hm) return null;
    var at = (+hm[2]) * 12 + F.indexOf(hm[1]), best = null, bt = Infinity;
    Object.keys(Q).forEach(function (k) {
      var m = new RegExp('^' + root0 + '-[a-z]{3}\\d\\d$').test(k) && /^[A-Z]{2}([FGHJKMNQUVXZ])(\d\d)\b/.exec(String((Q[k] || {}).ticker || ''));
      if (!m || !num(Q[k].close)) return; var t = (+m[2]) * 12 + F.indexOf(m[1]); if (t > at && t < bt) { bt = t; best = Q[k]; }
    });
    return best ? { now: S.label(h.q.ticker), next: S.label(best.ticker) } : null;
  }
  function paintAlertOptions() {
    var sel = $('pa-symbol'), Q = PX && PX.quotes; if (!sel || !Q) return;
    var today = ctDay();
    Array.prototype.forEach.call(sel.options, function (o) {
      var t = alertWords(o.value, Q[o.value], today);
      o.textContent = t; o.setAttribute('data-c', t.replace(/ \((rolls|moves) to .*\)$/, ''));
    });
  }

  /* ---- start ---- */
  function start() {
    var f = $('hb-zip-form'); if (f) f.addEventListener('submit', submitZip);
    Array.prototype.forEach.call(doc.querySelectorAll('[data-hp-loc]'), function (b) { b.addEventListener('click', useLocation); });
    doc.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('.hp-tools [data-act]'); if (b) act(b); });
    paintPlace(); fullPlace().then(function (p) { paintPlace(p); });
    if (!hasZip(readPlace())) noloc(); else { checkZip(readPlace().zip); watchBids(); }
    root.addEventListener('agsist-place', function () { paintPlace(); });
    root.addEventListener('storage', function () { paintPlace(); });
    root._AGSIST_GEO_CALLBACKS = root._AGSIST_GEO_CALLBACKS || [];
    root._AGSIST_GEO_CALLBACKS.push(function () { setTimeout(landed, 0); });
    root.addEventListener('agsist:bids-top', function (e) { paintTiles(e.detail); paintNear(e.detail); });
    if (root.__agsistBidsTop) { paintTiles(root.__agsistBidsTop); paintNear(root.__agsistBidsTop); }
    Promise.all([getJSON('/data/prices.json').catch(function () { return null; }), getJSON('/data/price-stats.json').catch(function () { return null; })]).then(function (r) {
      PX = r[0]; RQ = null; STATS = r[1]; if (!PX) pricesFailed(); paintHeader(); paintAlertOptions(); drawCharts(); paintMarkets(); try { paintTicker(); setTimeout(paintTicker, 1500); } catch (e) {}
    });
    getJSON('/data/daily.json').then(paintDaily, function () {});
    getJSON('/data/rain-print.json').then(paintRainPrint, function () {});
    later($('hp-wx'), function () { bandStarted = true; loadBand(); });
    later($('hp-land'), function () { landStarted = true; loadLand(); });
    priceAlert(); liveTap();
    if (PHONE) {
      var redraw = function () { drawCharts(); if (bandStarted) { band.zip = ''; loadBand(); } if (landStarted) loadLand(); };
      if (PHONE.addEventListener) PHONE.addEventListener('change', redraw); else if (PHONE.addListener) PHONE.addListener(redraw);
    }
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(typeof self !== 'undefined' ? self : this);
