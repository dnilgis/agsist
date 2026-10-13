/* components/rain-print-art.js: the two Rain Print styles Sig picked (2026-10-13).
 *
 *   R1 "Staircase" (default): the running total across the year, the verdict and
 *      both year totals upper left, the chart full width, snow as ice-blue ticks
 *      under the axis, place and year bottom left.
 *   R2 "Roots": snow piles up above the ground line, rain soaks down below it,
 *      month totals across the top, a quiet depth scale.
 *
 * Pure: AgRainArt.render(input) -> an SVG string on a 1800 x 1200 viewBox
 * (18 x 12 in, 100 units per inch). The engine (components/rain-print.js)
 * builds `input` from the station's days; nothing here fetches anything.
 *
 * input = {
 *   style: 'r1' | 'r2', year, place (long form, "Chetek, Wisconsin"), name, dedication,
 *   days: engine days [{date, v, flag, s, m, doy}], D: RainPrint.derive(days),
 *   axisLen: days on the x axis (a preview lays out the whole calendar year),
 *   ov: the comparison {daily (0 on unrecorded days), total} or null,
 *   ovNote: what "usual" means, printed small ("Usual = 30-year normal"),
 *   showNormals: month normals under the month totals,
 *   markers: [{doy, label}], records: AgRainRecords.find() output or [],
 *   qr: {matrix, serial} or null, preview: {last ISO} or null,
 *   watermark, bleed (units), px [w, h], fontCss, measure(text, font) -> width
 * }
 * render() also returns what it could not place: AgRainArt.lastSkipped().
 *
 * RULES carried from the engine: an unrecorded or S day is a gap (no step, no
 * bar, ground line broken), never a dry day; the comparison is 0 on those days,
 * so both totals leave them out; an A total is never the biggest rain; a dry
 * stretch is marked only at 7 days or more (the engine's showDry).
 */
(function (root) {
  'use strict';

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var PT = 1.389;
  var C = {
    ink: '#1E2125', mute: '#5E6475', soft: '#8A8F98', guide: '#D6D9D2', grid: '#E4E6E1',
    rain: '#2B5C8A', bar: '#26313D', snowLine: '#8DB6D8', snowFill: '#AFCBE2', snowEdge: '#5F8DB3', snowInk: '#4F7FA6', snowGrid: '#DCE6EE',
    accent: '#A8321E', dryBand: '#F3E2DF', wetBand: '#DDE5EC', rec: '#3F4651'
  };
  var QR_INK = '#A4A89F', SERIAL_INK = '#8E9289';
  var SANS = "'IBM Plex Sans',system-ui,sans-serif", SERIF = "'Fraunces',Georgia,serif";
  var W0 = 1800, H0 = 1200;

  var n2 = function (v) { return +(+v).toFixed(2); };
  var f2 = function (v) { return (+v).toFixed(2); };
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  function fmtDate(iso) { var p = String(iso).split('-').map(Number); return MON[p[1] - 1] + ' ' + p[2]; }
  function fmtRange(a, b) {
    var A = String(a).split('-').map(Number), B = String(b).split('-').map(Number);
    return A[1] === B[1] ? MON[A[1] - 1] + ' ' + A[2] + ' to ' + B[2] : MON[A[1] - 1] + ' ' + A[2] + ' to ' + MON[B[1] - 1] + ' ' + B[2];
  }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function doyOf(year, iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m || +m[1] !== +year) return -1;
    return Math.round((Date.UTC(year, +m[2] - 1, +m[3]) - Date.UTC(year, 0, 1)) / 86400000);
  }

  // ---------- text measurement ----------
  /* In the browser a canvas measures with the page's own fonts (the engine waits
     for them before drawing). Without one (tests), a rough per-character width. */
  var canvasCtx = null;
  function roughW(s, o) {
    var w = 0, serif = o.fam === SERIF;
    String(s).split('').forEach(function (ch) {
      if (ch === ' ') w += 0.26;
      else if (/[0-9]/.test(ch)) w += serif ? 0.58 : 0.6;
      else if (/[A-Z]/.test(ch)) w += 0.66;
      else if (/[ilj.,:;'|!]/.test(ch)) w += 0.27;
      else if (/[mw]/.test(ch)) w += 0.82;
      else w += 0.53;
    });
    if (o.w >= 600) w *= 1.05; else if (o.w <= 300) w *= 0.96;
    return w * o.size;
  }
  function defaultMeasure(s, o) {
    try {
      if (!canvasCtx && root.document && root.document.createElement) {
        var cv = root.document.createElement('canvas');
        canvasCtx = cv.getContext ? cv.getContext('2d') : null;
      }
      if (canvasCtx) {
        canvasCtx.font = (o.it ? 'italic ' : '') + o.w + ' ' + o.size + 'px ' + o.fam;
        var m = canvasCtx.measureText(String(s));
        if (m && m.width > 0) return m.width;
      }
    } catch (e) { /* fall through */ }
    return roughW(s, o);
  }
  var measure = defaultMeasure;
  function st(o) { return { fam: o.fam || SANS, w: o.w || 400, it: !!o.it, size: o.size || 16, ls: o.ls || 0, fill: o.fill || C.ink, anchor: o.anchor || 'start' }; }
  function W(s, o) {
    o = st(o || {});
    var n = String(s).length;
    return measure(s, o) + o.ls * o.size * Math.max(0, n - 1);
  }
  function T(x, y, s, o) {
    o = st(o || {});
    var ls = o.ls ? ' letter-spacing="' + n2(o.ls * o.size) + '"' : '';
    var dx = o.ls ? (o.anchor === 'middle' ? o.ls * o.size / 2 : o.anchor === 'end' ? o.ls * o.size : 0) : 0;
    return '<text x="' + n2(x + dx) + '" y="' + n2(y) + '" font-family="' + esc(o.fam) + '" font-weight="' + o.w + '" font-style="' + (o.it ? 'italic' : 'normal') +
      '" font-size="' + n2(o.size) + '" fill="' + o.fill + '" text-anchor="' + o.anchor + '"' + ls + ' style="font-variant-numeric:lining-nums">' + esc(s) + '</text>';
  }
  function box(x, y, s, o) {
    var w = W(s, o), size = (o && o.size) || 16, a = (o && o.anchor) || 'start';
    return { x: a === 'start' ? x : a === 'end' ? x - w : x - w / 2, y: y - 0.74 * size, w: w, h: 0.96 * size };
  }
  function hit(a, b, p) { p = p || 0; return a.x < b.x + b.w + p && b.x < a.x + a.w + p && a.y < b.y + b.h + p && b.y < a.y + a.h + p; }
  function line(x1, y1, x2, y2, stroke, sw, extra) {
    return '<line x1="' + n2(x1) + '" y1="' + n2(y1) + '" x2="' + n2(x2) + '" y2="' + n2(y2) + '" stroke="' + (stroke || C.ink) + '" stroke-width="' + n2(sw || 0.75 * PT) + '"' + (extra || '') + '/>';
  }
  // the largest size (down to min) at which s fits in maxW
  function fit(s, o, maxW, min) {
    var size = o.size;
    while (size > min && W(s, Object.assign({}, o, { size: size })) > maxW) size -= 1;
    return size;
  }

  // ---------- the year, in the shape both styles draw ----------
  function model(I) {
    var days = I.days || [], D = I.D, n = days.length, year = +I.year;
    var N = Math.max(n, I.axisLen || 0, 1);
    var P = days.map(function (x) { return x.v === null || x.v === undefined || x.flag === 'S' ? null : x.v; });
    var snowMissing = 0, snowTot = 0;
    days.forEach(function (x) { if (x.s === null || x.s === undefined) snowMissing++; else snowTot += x.s; });
    var snowState = snowMissing <= 10 ? (snowTot >= 0.1 ? 'full' : 'none') : 'unknown';
    if (n === 0) snowState = 'unknown';
    var full = snowState === 'full';
    var cum = [], c = 0;
    P.forEach(function (p) { if (p !== null) c += p; cum.push(p === null ? null : c); });
    var ov = I.ov && I.ov.daily ? I.ov : null;
    var ncum = [], nc = 0;
    if (ov) for (var i = 0; i < n; i++) { nc += ov.daily[i] || 0; ncum.push(nc); }
    var starts = [];
    for (var m = 0; m < 12; m++) starts.push(doyOf(year, year + '-' + String(m + 1).padStart(2, '0') + '-01'));
    var ends = starts.slice(1).concat([isLeap(year) ? 366 : 365]);
    var monthHas = Array(12).fill(false);
    days.forEach(function (x, k) { if (P[k] !== null) monthHas[x.m] = true; });
    var mN = Array(12).fill(0);
    if (ov) days.forEach(function (x, k) { mN[x.m] += ov.daily[k] || 0; });
    var total = D.total, Ts = f2(total);
    var liquid = { full: 'rain and melted snow', none: 'rain', unknown: 'precipitation' }[snowState];
    var wi = D.max && D.max.v > 0 && D.max.doy >= 0 ? D.max.doy : -1;
    var wet = wi >= 0 ? { p: D.max.v, date: D.max.date } : null;
    var wetLabel = wi >= 0 && days[wi].s > 0 ? 'Wettest day' : 'Biggest rain';
    var pct = ov && ov.total > 0 ? Math.round((total - ov.total) / ov.total * 100) : null;
    var soFar = I.preview ? ' so far' : '';
    var verdict = pct === null ? null : (Math.abs(pct) < 3 ? 'About a usual year' : Math.abs(pct) + '% ' + (pct < 0 ? 'less' : 'more') + ' than a usual year') + soFar;
    var dry = D.dryMax && D.dryMax.len >= 7 && D.dryMax.startDoy >= 0 ? { s: D.dryMax.startDoy, e: D.dryMax.endDoy, len: D.dryMax.len } : null;
    if (dry) dry.range = fmtRange(days[dry.s].date, days[dry.e].date);
    var markers = (I.markers || []).filter(function (mk) { return mk.doy >= 0 && mk.doy < n; }).slice(0, 3)
      .map(function (mk) { return { i: mk.doy, label: String(mk.label || '') }; }).sort(function (a, b) { return a.i - b.i; });
    var maxP = Math.max.apply(null, [0.01].concat(P.filter(function (p) { return p !== null; })));
    var maxSnow = Math.max.apply(null, [0].concat(days.map(function (x) { return x.s > 0 ? x.s : 0; })));
    return {
      year: year, N: N, n: n, days: days, P: P, cum: cum, ncum: ncum, cmp: !!ov, ov: ov, normalRec: ov ? ov.total : null,
      starts: starts, ends: ends, monthHas: monthHas, month: D.month || Array(12).fill(0), mN: mN,
      total: total, T: Ts, liquid: liquid, full: full, snowState: snowState, snowTot: Math.round(snowTot * 10) / 10,
      wi: wi, wet: wet, wetText: wet ? wetLabel + ': ' + f2(wet.p) + ' in, ' + fmtDate(wet.date) : null,
      daysText: (snowState === 'none' ? 'Days with rain' : 'Days with rain or snow') + ': ' + D.wet,
      snowText: full ? 'Snow: ' + (Math.round(snowTot * 10) / 10).toFixed(1) + ' in' : null,
      verdict: verdict, dry: dry, markers: markers, maxP: maxP, maxSnow: maxSnow,
      name: String(I.name || '').trim(), dedication: String(I.dedication || '').trim(), place: String(I.place || ''),
      showN: !!(ov && I.showNormals), ovNote: I.ovNote || '', preview: I.preview || null, soFar: soFar
    };
  }

  // ---------- records: which ones draw as a point, which as a line of text ----------
  function recordPoints(E, recs) {
    var pts = [], lines = [];
    (recs || []).forEach(function (r) {
      if (!r || !r.label) return;
      var sp = r.span;
      if (sp && sp.from && sp.to && sp.from.slice(5) === '01-01' && sp.to.slice(5) === '12-31') { lines.push(r.label); return; }
      var a = doyOf(E.year, sp ? sp.from : r.date), b = sp ? doyOf(E.year, sp.to) : a;
      if (a < 0 || a >= E.n) return;
      if (b < a || b >= E.n) b = a;
      pts.push({ i: Math.round((a + b) / 2), a: a, b: b, label: r.label, span: !!sp });
    });
    pts.sort(function (p, q) { return p.i - q.i; });
    return { pts: pts, lines: lines };
  }

  // ---------- the maker's mark: QR, square to the page, serial under it ----------
  var snap = function (v) { return Math.round(v * 3) / 3; };   // whole 300 dpi pixels
  function qrMark(Q, right, bottom) {
    if (!Q || !Q.matrix || !Q.matrix.length) return '';
    var m = Q.matrix, n = m.length;
    var cellPx = Math.max(2, Math.min(7, Math.floor(255 / (n + 6)))), cell = cellPx / 3;
    var mx1 = snap(right), my1 = snap(bottom - 17);
    var mx0 = snap(mx1 - n * cell), my0 = snap(my1 - n * cell), quiet = 3 * cell;
    var d = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n;) {
      if (!m[r][c]) { c++; continue; }
      var e = c; while (e < n && m[r][e]) e++;
      d += 'M' + n2(mx0 + c * cell) + ',' + n2(my0 + r * cell) + 'h' + n2((e - c) * cell) + 'v' + n2(cell) + 'h' + n2(-(e - c) * cell) + 'z';
      c = e;
    }
    var s = '<g aria-hidden="true"><rect x="' + n2(mx0 - quiet) + '" y="' + n2(my0 - quiet) + '" width="' + n2(n * cell + 2 * quiet) + '" height="' + n2(n * cell + 2 * quiet) + '" fill="#FFFFFF"/>' +
      '<path d="' + d + '" fill="' + QR_INK + '" shape-rendering="crispEdges"/></g>';
    if (Q.serial) s += '<text x="' + n2((mx0 + mx1) / 2) + '" y="' + n2(bottom) + '" font-family="' + esc(SANS) + '" font-size="11.5" fill="' + SERIAL_INK + '" text-anchor="middle" letter-spacing="0.3" style="font-variant-numeric:tabular-nums lining-nums">' + esc(Q.serial) + '</text>';
    return s;
  }

  // ---------- a preview of this year: a band across the art, and the watermark ----------
  function previewBand(E, y) {
    var t = 'PREVIEW THROUGH ' + fmtDate(E.preview.last).toUpperCase();
    return '<g aria-hidden="true"><rect x="-40" y="' + (y - 34) + '" width="' + (W0 + 80) + '" height="68" fill="' + C.ink + '" opacity="0.88"/>' +
      T(W0 / 2, y - 4, t, { w: 500, size: 24, ls: 0.12, fill: '#FFFFFF', anchor: 'middle' }) +
      T(W0 / 2, y + 22, 'Your print will show the full year, Jan 1 to Dec 31, ' + E.year, { size: 17, fill: '#FFFFFF', anchor: 'middle' }) + '</g>';
  }
  function watermark() {
    var row = '', out = '', i;
    for (i = 0; i < 6; i++) row += 'PREVIEW  ·  AGSIST.COM/RAIN-PRINT  ·  ';
    for (i = -6; i < 14; i++) out += '<text x="' + (-W0) + '" y="' + (i * 140) + '" font-family="' + esc(SANS) + '" font-size="38" font-weight="500" fill="' + C.ink + '" letter-spacing="4">' + row + '</text>';
    return '<g opacity="0.13" transform="rotate(-24 ' + (W0 / 2) + ' ' + (H0 / 2) + ')" aria-hidden="true">' + out + '</g>';
  }

  function open(I, E) {
    var b = I.bleed || 0;
    var size = I.px ? ' width="' + I.px[0] + '" height="' + I.px[1] + '"' : '';
    var title = E.place + ', ' + E.year + ', rain print' + (E.preview ? ', preview through ' + fmtDate(E.preview.last) : '');
    var desc = E.T + ' in of ' + E.liquid + (E.snowText ? '. ' + E.snowText : '') + '. ' + E.daysText + (E.verdict ? '. ' + E.verdict : '') + '.';
    var id = I.idPrefix || 'rp';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + (-b) + ' ' + (-b) + ' ' + (W0 + 2 * b) + ' ' + (H0 + 2 * b) + '"' + size +
      ' font-family="' + esc(SANS) + '" role="img" aria-labelledby="' + id + 'T ' + id + 'D">' +
      (I.fontCss ? '<style>' + I.fontCss + '</style>' : '') +
      '<title id="' + id + 'T">' + esc(title) + '</title><desc id="' + id + 'D">' + esc(desc) + '</desc>' +
      '<rect x="' + (-b) + '" y="' + (-b) + '" width="' + (W0 + 2 * b) + '" height="' + (H0 + 2 * b) + '" fill="#FFFFFF"/>';
  }
  function close(I, E, o, bandY) {
    if (E.preview) o.push(previewBand(E, bandY));
    if (I.watermark) o.push(watermark());
    o.push('</svg>');
    return o.join('');
  }

  // ======================================================================= R1
  function r1(I) {
    var E = model(I), N = E.N, days = E.days, skipped = [];
    var ML = 120, X0 = 196, X1 = 1680, PW = X1 - X0, w = PW / N;
    var showN = E.showN;
    var PTOP = 160, PB = showN ? 782 : 828;
    var top = Math.max(E.total, E.cmp ? E.normalRec : 0, 1);
    var step = top > 50 ? 10 : top > 12 ? 5 : top > 5 ? 2 : 1;
    var dom = Math.ceil(top / step - 1e-6) * step;
    var y = function (v) { return PB - v * (PB - PTOP) / dom; };
    var xs = function (i) { return X0 + i * w; };
    var o = [open(I, E)];

    // header: verdict and the small facts, upper left inside the plot (the early year sits low there)
    var head = E.verdict || (E.T + ' inches of ' + E.liquid + E.soFar);
    var facts = [];
    if (E.snowText) facts.push(E.snowText);
    facts.push(E.daysText);
    if (E.cmp && E.ovNote) facts.push(E.ovNote);
    var recs = recordPoints(E, I.records);
    var HX = X0 + 28, HY = PTOP + 62, hs = { fam: SERIF, w: 600, size: 52 }, fs = { size: 21, fill: C.mute };
    var header = [T(HX, HY, head, hs)];
    var KY = HY + 62;
    var yN = { fam: SERIF, w: 600, size: 40, fill: C.rain }, yL = { size: 19, w: 500, fill: C.rain };
    var uN = { fam: SERIF, w: 400, size: 32, fill: C.mute }, uL = { size: 19, fill: C.mute };
    var kx = HX;
    header.push(line(kx, KY - 12, kx + 34, KY - 12, C.rain, 3.2)); kx += 46;
    header.push(T(kx, KY, E.T + ' in', yN)); kx += W(E.T + ' in', yN) + 10;
    var yLab = (E.full ? 'your year, rain and melted snow' : E.snowState === 'none' ? 'your year, rain' : 'your year') + E.soFar;
    header.push(T(kx, KY, yLab, yL)); kx += W(yLab, yL);
    if (E.cmp) {
      kx += 40;
      header.push('<path d="M' + n2(kx) + ',' + (KY - 12) + 'h34" stroke="' + C.mute + '" stroke-width="1.6" stroke-dasharray="7 5"/>'); kx += 46;
      header.push(T(kx, KY, f2(E.normalRec) + ' in', uN)); kx += W(f2(E.normalRec) + ' in', uN) + 10;
      var uLab = E.preview ? 'a usual year by then' : 'a usual year';
      header.push(T(kx, KY, uLab, uL)); kx += W(uLab, uL);
    }
    var factLine = facts.join('  ·  ');
    header.push(T(HX, KY + 40, factLine, fs));
    var hb = KY + 56;
    recs.lines.forEach(function (t, k) { header.push(T(HX, KY + 70 + k * 28, t, { size: 19, w: 500, fill: C.rec })); hb = KY + 84 + k * 28; });
    var hw = Math.max(W(head, hs), W(factLine, fs), kx - HX, Math.max.apply(null, [0].concat(recs.lines.map(function (t) { return W(t, { size: 19, w: 500 }); }))));
    var headBox = { x: HX - 14, y: PTOP - 4, w: hw + 28, h: hb - PTOP };
    var headMask = '<rect x="' + n2(headBox.x) + '" y="' + n2(headBox.y) + '" width="' + n2(headBox.w) + '" height="' + n2(headBox.h) + '" fill="#FFFFFF"/>';

    // grid and y labels
    for (var v = 0; v <= dom + 1e-9; v += step) {
      var yy = y(v);
      if (v > 0) o.push(line(X0, yy, X1, yy, C.grid, 0.7));
      o.push(T(X0 - 14, yy + 5, v === dom ? v + ' in' : String(v), { size: 15, fill: C.mute, anchor: 'end' }));
    }
    o.push(headMask);
    o.push(header.join(''));

    // the band between the year and a usual year
    if (E.cmp) {
      var band = '', last = 0;
      days.forEach(function (x, i) {
        if (E.cum[i] !== null) last = E.cum[i];
        var a = y(last), b = y(E.ncum[i]);
        if (Math.abs(a - b) < 0.3) return;
        band += '<rect x="' + n2(xs(i)) + '" y="' + n2(Math.min(a, b)) + '" width="' + n2(w + 0.25) + '" height="' + n2(Math.abs(a - b)) + '" fill="' + (a > b ? C.dryBand : C.wetBand) + '"/>';
      });
      o.push('<g shape-rendering="crispEdges">' + band + '</g>');
      var p = 'M' + X0 + ',' + PB;
      days.forEach(function (x, i) { p += 'L' + n2(xs(i + 1)) + ',' + n2(y(E.ncum[i])); });
      o.push('<path d="' + p + '" fill="none" stroke="' + C.mute + '" stroke-width="1.6" stroke-dasharray="7 5"/>');
    }

    // axis and month ticks
    o.push(line(X0, PB, X1, PB, C.ink, 0.9 * PT));
    E.starts.concat([isLeap(E.year) ? 366 : 365]).forEach(function (b) { if (b <= N) o.push(line(xs(b), PB, xs(b), PB + 8, C.ink, 0.75 * PT)); });
    if (E.preview && E.n < N) o.push(line(xs(E.n), PTOP, xs(E.n), PB, C.mute, 1, ' stroke-dasharray="3 4"'));

    // the staircase; the pen lifts over a day with no amount of its own
    var d1 = '', prev = 0, pen = false;
    days.forEach(function (x, i) {
      if (E.P[i] === null) { pen = false; return; }
      var c = E.cum[i];
      if (!pen) { d1 += 'M' + n2(xs(i)) + ',' + n2(y(prev)); pen = true; }
      d1 += 'L' + n2(xs(i)) + ',' + n2(y(c)) + 'L' + n2(xs(i + 1)) + ',' + n2(y(c));
      prev = c;
    });
    if (d1) o.push('<path d="' + d1 + '" fill="none" stroke="' + C.rain + '" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="butt"/>');
    // steps that came as snow, in ice blue: the riser and the flat after it, up to the next wet day or gap
    if (E.full) {
      var sp = '';
      days.forEach(function (x, i) {
        if (E.P[i] === null || !(x.s > 0) || !(E.P[i] > 0)) return;
        var c = E.cum[i], c0 = c - E.P[i];
        var j = i + 1; while (j < E.n && E.P[j] === 0 && !(days[j].s > 0)) j++;
        sp += 'M' + n2(xs(i)) + ',' + n2(y(c0)) + 'L' + n2(xs(i)) + ',' + n2(y(c)) + 'L' + n2(xs(Math.min(j, E.n))) + ',' + n2(y(c));
      });
      if (sp) o.push('<path d="' + sp + '" fill="none" stroke="' + C.snowLine + '" stroke-width="3.4" stroke-linejoin="round"/>');
    }
    if (E.wi >= 0) { var c0w = E.cum[E.wi] - E.P[E.wi]; o.push(line(xs(E.wi), y(c0w) + 1.5, xs(E.wi), y(E.cum[E.wi]) - 1.5, C.accent, 4.4)); }

    // snow ticks under the axis
    if (E.full) {
      var sd = Math.max(8, Math.ceil(E.maxSnow / 4) * 4), snowT = '';
      days.forEach(function (x, i) {
        if (!(x.s > 0) || E.P[i] === null) return;
        var h = Math.max(3, x.s / sd * 44);
        snowT += '<rect x="' + n2(xs(i) + w * 0.05) + '" y="' + n2(PB + 3) + '" width="' + n2(w * 0.9) + '" height="' + n2(h) + '"/>';
      });
      o.push('<g fill="' + C.snowLine + '">' + snowT + '</g>');
      o.push(T(X0 - 14, PB + 24, 'snow', { size: 15, w: 500, fill: C.snowInk, anchor: 'end' }));
    }

    // month labels, and with normals on, each month's total over its normal
    var MY = PB + 74;
    E.starts.forEach(function (b, m) {
      var cx = (xs(b) + xs(E.ends[m])) / 2;
      o.push(T(cx, MY, MON[m].toUpperCase(), { w: 500, size: 15, ls: 0.16, fill: C.mute, anchor: 'middle' }));
      if (showN && E.monthHas[m]) {
        o.push(T(cx, MY + 26, f2(E.month[m]) + (m === 0 ? ' in' : ''), { w: 500, size: 19, fill: C.rain, anchor: 'middle' }));
        o.push(T(cx, MY + 48, (m === 0 ? 'usual ' : '') + f2(E.mN[m]), { size: 15, fill: C.mute, anchor: 'middle' }));
      }
    });

    // the reader's dates and the dry stretch, in one row under the months
    var RY = MY + (showN ? 82 : 34), rowBoxes = [], curveHits = [];
    if (E.dry) {
      var a = xs(E.dry.s), b2 = xs(E.dry.e + 1), dcx = (a + b2) / 2;
      var ds = E.dry.len + ' dry days', dst = { size: 17, fill: C.mute, anchor: 'middle', it: true };
      o.push('<path d="M' + n2(a) + ',' + (RY - 24) + 'v6H' + n2(b2) + 'v-6" fill="none" stroke="' + C.mute + '" stroke-width="0.9"/>');
      var bx = box(dcx, RY, ds, dst), lx = dcx;
      if (bx.x < ML) { lx += ML - bx.x; bx = box(lx, RY, ds, dst); }
      if (bx.x + bx.w > X1 + 60) { lx -= bx.x + bx.w - X1 - 60; bx = box(lx, RY, ds, dst); }
      o.push(T(lx, RY, ds, dst)); rowBoxes.push(bx);
    }
    var lastCum = function (i) { for (var k = i; k >= 0; k--) if (E.cum[k] !== null) return E.cum[k]; return 0; };
    E.markers.forEach(function (mk) {
      var x = xs(mk.i + 0.5), yy2 = y(lastCum(mk.i));
      o.push(line(x, yy2 + 5, x, PB, C.ink, 0.75));
      o.push('<circle cx="' + n2(x) + '" cy="' + n2(yy2) + '" r="4.6" fill="' + C.ink + '" stroke="#FFFFFF" stroke-width="1.4"/>');
      curveHits.push({ x: x - 6, y: yy2 - 6, w: 12, h: 12 });
      if (!mk.label) return;
      var mst = { size: 18, it: true, anchor: 'middle' }, ry2 = RY, mb = box(x, ry2, mk.label, mst), anc = 'middle', mx = x;
      if (mb.x < ML) { anc = 'start'; mx = x - 12; } else if (mb.x + mb.w > X1 + 80) { anc = 'end'; mx = x + 12; }
      mst.anchor = anc; mb = box(mx, ry2, mk.label, mst);
      while (rowBoxes.some(function (q) { return hit(q, mb, 10); })) { ry2 += 24; mb = box(mx, ry2, mk.label, mst); }
      o.push(line(x, PB + 8, x, PB + 14, C.ink, 0.75));
      o.push(T(mx, ry2, mk.label, mst)); rowBoxes.push(mb);
    });

    // keep labels off the two lines
    var polyHit = function (bx) {
      for (var i = 0; i < E.n; i++) {
        var xx = xs(i + 0.5);
        if (xx < bx.x - 4 || xx > bx.x + bx.w + 4) continue;
        var ys = [];
        if (E.cum[i] !== null) ys.push(y(E.cum[i]));
        if (E.cmp) ys.push(y(E.ncum[i]));
        if (ys.some(function (v) { return v > bx.y - 8 && v < bx.y + bx.h + 8; })) return true;
      }
      return curveHits.some(function (h) { return hit(h, bx, 6); });
    };
    var inPlot = function (bx) { return bx.x > X0 && bx.x + bx.w < X1 && bx.y + bx.h < PB - 6 && bx.y > PTOP - 20 && !hit(bx, headBox, 6); };
    var placed = [];

    // the biggest rain, in words
    if (E.wi >= 0) {
      var x = xs(E.wi), c1 = E.cum[E.wi], c0 = c1 - E.wet.p, s = E.wetText, wst = { w: 500, size: 23, fill: C.accent };
      var cands = [];
      [34, 64, 94, 124, 154].forEach(function (dy) { cands.push({ x: x + 16, y: y(c0) + dy, a: 'start' }); });
      [-24, -54, -84].forEach(function (dy) { cands.push({ x: x - 16, y: y(c1) + dy, a: 'end' }); });
      [34, 64, 94].forEach(function (dy) { cands.push({ x: x - 16, y: y(c0) + dy, a: 'end' }); });
      var pick = cands.filter(function (cd) { var bb = box(cd.x, cd.y, s, Object.assign({}, wst, { anchor: cd.a })); return inPlot(bb) && !polyHit(bb); })[0] || cands[0];
      var lb = box(pick.x, pick.y, s, Object.assign({}, wst, { anchor: pick.a }));
      var my = (y(c0) + y(c1)) / 2;
      o.push('<path d="M' + n2(x + (pick.a === 'start' ? 4 : -4)) + ',' + n2(my) + 'L' + n2(pick.x + (pick.a === 'start' ? -4 : 4)) + ',' + n2(lb.y + lb.h / 2) + '" stroke="' + C.accent + '" stroke-width="1"/>');
      o.push(T(pick.x, pick.y, s, Object.assign({}, wst, { anchor: pick.a })));
      placed.push(lb);
    }

    // remarkable days: a small open ring on the line, a label clear of everything
    recs.pts.forEach(function (r) {
      var x = xs(r.i + 0.5), yy3 = y(lastCum(r.i)), rst = { size: 16, w: 500, fill: C.rec };
      var cands = [];
      [[14, 30, 'start'], [-14, -18, 'end'], [14, 58, 'start'], [-14, -46, 'end'], [14, 86, 'start'], [-14, 30, 'end'], [14, -18, 'start'], [-14, -74, 'end'], [14, 114, 'start'], [-14, 58, 'end']]
        .forEach(function (k) { cands.push({ x: x + k[0], y: yy3 + k[1], a: k[2] }); });
      var pick = null, pb = null;
      for (var k = 0; k < cands.length && !pick; k++) {
        var bb = box(cands[k].x, cands[k].y, r.label, Object.assign({}, rst, { anchor: cands[k].a }));
        if (inPlot(bb) && !polyHit(bb) && !placed.some(function (q) { return hit(q, bb, 8); })) { pick = cands[k]; pb = bb; }
      }
      if (!pick) { skipped.push(r.label); return; }
      o.push('<circle cx="' + n2(x) + '" cy="' + n2(yy3) + '" r="5" fill="#FFFFFF" stroke="' + C.rec + '" stroke-width="1.8"/>');
      o.push('<path d="M' + n2(x) + ',' + n2(yy3) + 'L' + n2(pick.x + (pick.a === 'start' ? -3 : 3)) + ',' + n2(pb.y + pb.h / 2) + '" stroke="' + C.rec + '" stroke-width="0.8" stroke-dasharray="2 2"/>');
      o.push(T(pick.x, pick.y, r.label, Object.assign({}, rst, { anchor: pick.a })));
      placed.push(pb); curveHits.push({ x: x - 6, y: yy3 - 6, w: 12, h: 12 });
    });

    // title block, bottom left
    var placeSize = fit(E.place, { fam: SERIF, w: 300, size: 40 }, 1500, 24);
    o.push(T(ML, 1004, E.place, { fam: SERIF, w: 300, size: placeSize }));
    o.push(T(ML - 3, 1080, String(E.year), { fam: SERIF, w: 600, size: 84 }));
    var yw = W(String(E.year), { fam: SERIF, w: 600, size: 84 }), room = 1600 - (ML + yw + 26) - 120;
    if (E.name) o.push(T(ML + yw + 26, E.dedication ? 1048 : 1068, E.name, { fam: SERIF, w: 400, size: fit(E.name, { fam: SERIF, w: 400, size: 36 }, room, 22) }));
    if (E.dedication) o.push(T(ML + yw + 26, E.name ? 1080 : 1068, E.dedication, { fam: SERIF, it: true, w: 400, size: fit(E.dedication, { fam: SERIF, it: true, w: 400, size: 21 }, room, 14), fill: C.mute }));

    o.push(qrMark(I.qr, 1690, 1100));
    last_skipped = skipped;
    return close(I, E, o, (PTOP + PB) / 2 + 60);
  }

  // ======================================================================= R2
  function niceRain(maxP) {
    var dom = Math.max(2, Math.ceil(maxP / 0.5 - 1e-9) * 0.5);
    var ticks = dom <= 4 ? [0.5, 1, 2, 3, 4] : dom <= 8 ? [1, 2, 4, 6, 8] : [2, 4, 8, 12, 16];
    return { dom: dom, ticks: ticks.filter(function (t) { return t <= dom + 1e-9; }) };
  }
  function niceSnow(maxS) {
    var dom = Math.max(8, Math.ceil(maxS / 4 - 1e-9) * 4);
    var step = dom <= 8 ? 4 : dom <= 16 ? 8 : 10, ticks = [];
    for (var t = step; t <= dom + 1e-9; t += step) ticks.push(t);
    return { dom: dom, ticks: ticks };
  }
  function r2(I) {
    var E = model(I), N = E.N, days = E.days, skipped = [];
    var ML = 120, X0 = 205, X1 = 1690, PW = X1 - X0, w = PW / N;
    var G = 478, SH = 92, RB = 1000, RH = RB - G - 6;
    var R = niceRain(E.maxP), S = niceSnow(E.maxSnow);
    var ry = function (p) { return G + p * RH / R.dom; }, sy = function (s) { return G - s * SH / S.dom; };
    var xs = function (i) { return X0 + (i + 0.5) * w; };
    var o = [open(I, E)];
    var recs = recordPoints(E, I.records);

    // right: the year's totals
    var big = { w: 300, size: 80 };
    o.push(T(X1, 214, E.T + ' in', Object.assign({ anchor: 'end' }, big)));
    o.push(T(X1, 140, (E.liquid + (E.soFar ? ', so far' : '')).toUpperCase(), { w: 500, size: 14, ls: 0.16, fill: C.mute, anchor: 'end' }));
    if (E.verdict) o.push(T(X1, 254, E.verdict, { size: 22, anchor: 'end' }));
    recs.lines.forEach(function (t, k) { o.push(T(X1, 254 + (E.verdict ? 28 : 0) + k * 26, t, { size: 18, w: 500, fill: C.rec, anchor: 'end' })); });
    var rightEdge = X1 - W(E.T + ' in', big);
    if (E.full) {
      var bxs = rightEdge - 70;
      o.push(T(bxs, 214, E.snowTot.toFixed(1) + ' in', { w: 300, size: 52, fill: C.snowInk, anchor: 'end' }));
      o.push(T(bxs, 140, 'SNOWFALL', { w: 500, size: 14, ls: 0.16, fill: C.snowInk, anchor: 'end' }));
      rightEdge = bxs - W(E.snowTot.toFixed(1) + ' in', { w: 300, size: 52 });
    }
    // left: name, place and year, dedication; shrunk to stay clear of the totals
    var leftRoom = rightEdge - 50 - ML;
    var py = E.name ? 214 : 190;
    if (E.name) {
      var nst = { w: 500, size: 30, ls: 0.14 };
      nst.size = fit(E.name.toUpperCase(), nst, leftRoom, 18);
      o.push(T(ML, 150, E.name.toUpperCase(), nst));
    }
    var ps = { w: 300, size: 50 }, ys = { w: 500, size: 50 }, both = E.place + '  ' + E.year;
    var psz = fit(both, { w: 400, size: 50 }, leftRoom, 28);
    ps.size = ys.size = psz;
    o.push(T(ML, py, E.place, ps));
    o.push(T(ML + W(E.place + '  ', ps), py, String(E.year), ys));
    if (E.dedication) o.push(T(ML, py + 40, E.dedication, { it: true, size: fit(E.dedication, { it: true, size: 21 }, Math.max(400, leftRoom), 14), fill: C.mute }));

    // guides and scales
    R.ticks.forEach(function (t) {
      var yy = ry(t);
      o.push(line(X0, yy, X1, yy, C.guide, 0.7));
      o.push(T(X0 - 14, yy + 5, String(t), { size: 15, fill: C.mute, anchor: 'end' }));
    });
    if (E.full) S.ticks.forEach(function (t) {
      var yy = sy(t);
      o.push(line(X0, yy, X1, yy, C.snowGrid, 0.7));
      o.push(T(X0 - 14, yy + 5, String(t), { size: 15, fill: C.snowInk, anchor: 'end' }));
    });
    var lastY = ry(R.ticks[R.ticks.length - 1]);
    var rainTitle = E.full ? 'rain, in' : E.liquid + ', in';
    var rty = lastY + 36, rtw = W(rainTitle, { size: 15 });
    if (days.some(function (x, i) { return E.P[i] > 0 && xs(i) < ML + rtw + 6 && xs(i) > ML - 4 && ry(E.P[i]) > rty - 16; })) rty = RB + 24;
    o.push(T(ML, rty, rainTitle, { size: 15, fill: C.mute }));
    if (E.full) o.push(T(ML, sy(S.dom) - 14, 'snow, in', { size: 15, fill: C.snowInk }));

    // bars: a snow day shows only above the line (its melted water still counts in the total)
    var bw = 0.66 * w, sw = 0.8 * w, bars = '', snows = '', traces = '';
    days.forEach(function (x, i) {
      var p = E.P[i], cx = xs(i);
      if (p === null) return;
      if (E.full && x.s > 0) {
        var h = Math.max(1.4, G - sy(x.s));
        snows += '<rect x="' + n2(cx - sw / 2 + 0.35) + '" y="' + n2(G - 2.2 - h + 0.35) + '" width="' + n2(sw - 0.7) + '" height="' + n2(h - 0.7) + '"/>';
        return;
      }
      if (p > 0 && i !== E.wi) bars += '<rect x="' + n2(cx - bw / 2) + '" y="' + (G + 1.5) + '" width="' + n2(bw) + '" height="' + n2(Math.max(0.8, ry(p) - G)) + '"/>';
      else if (p === 0 && x.flag === 'T') traces += '<circle cx="' + n2(cx) + '" cy="' + (G + 5) + '" r="1.3"/>';
    });
    if (snows) o.push('<g fill="' + C.snowFill + '" stroke="' + C.snowEdge + '" stroke-width="0.7">' + snows + '</g>');
    o.push('<g fill="' + C.bar + '">' + bars + traces + '</g>');
    // ground line, broken over unrecorded days
    var seg = null, segs = [];
    days.forEach(function (x, i) { if (E.P[i] !== null) { if (!seg) seg = [i, i]; seg[1] = i; } else if (seg) { segs.push(seg); seg = null; } });
    if (seg) segs.push(seg);
    segs.forEach(function (sg) { o.push(line(X0 + sg[0] * w + (sg[0] ? 1 : 0), G, X0 + (sg[1] + 1) * w - (sg[1] < E.n - 1 ? 1 : 0), G, C.ink, 1.1 * PT)); });
    E.starts.concat([isLeap(E.year) ? 366 : 365]).forEach(function (b) { if (b <= N) o.push(line(X0 + b * w, G - 7, X0 + b * w, G + 7, C.ink, 0.75 * PT)); });
    if (E.preview && E.n < N) o.push(line(X0 + E.n * w, G - SH, X0 + E.n * w, RB, C.mute, 1, ' stroke-dasharray="3 4"'));

    var placed = [];
    var barHit = function (bb) {
      return days.some(function (x, i) { var p = E.P[i]; return p > 0 && !(E.full && x.s > 0) && xs(i) > bb.x - 4 && xs(i) < bb.x + bb.w + 4 && ry(p) > bb.y - 4; });
    };
    // the biggest rain, in red, in words
    if (E.wi >= 0) {
      var cx = xs(E.wi), y2 = ry(E.wet.p), wst = { w: 500, size: 24, fill: C.accent };
      o.push('<rect x="' + n2(cx - 1.9) + '" y="' + (G + 1.5) + '" width="3.8" height="' + n2(y2 - G - 1.5) + '" fill="' + C.accent + '"/>');
      var right = cx + 10 + W(E.wetText, wst) > X1, ty = y2 + 6;
      R.ticks.forEach(function (t) { var gy = ry(t); if (ty > gy - 2 && ty - 14 < gy + 2) ty = gy - 6; });
      if (ty > RB + 30) ty = RB + 30;
      wst.anchor = right ? 'end' : 'start';
      o.push(T(right ? cx - 10 : cx + 10, ty, E.wetText, wst));
      placed.push(box(right ? cx - 10 : cx + 10, ty, E.wetText, wst));
    }

    // the dry stretch, under the ground, if it fits among the bars
    var dryOnArt = false;
    if (E.dry) {
      var da = X0 + E.dry.s * w, db = X0 + (E.dry.e + 1) * w, dcx = (da + db) / 2;
      var ds = E.dry.len + ' dry days', dst = { it: true, size: 15, fill: C.mute, anchor: 'middle' };
      var dbb = box(dcx, G + 30, ds, dst);
      if (!barHit(dbb) && !placed.some(function (q) { return hit(q, dbb, 6); })) { o.push(T(dcx, G + 30, ds, dst)); dryOnArt = true; placed.push(dbb); }
    }

    // month labels and totals; with normals on, each month's normal under its total
    var MY = 316, TY = 345, mBoxes = [];
    E.starts.forEach(function (b, m) {
      var cx2 = X0 + (b + E.ends[m]) / 2 * w, ms = MON[m].toUpperCase();
      var mst = { w: 500, size: 14, ls: 0.18, fill: C.mute, anchor: 'middle' };
      o.push(T(cx2, MY, ms, mst)); mBoxes.push(box(cx2, MY, ms, mst));
      if (!E.monthHas[m]) return;
      var tv = f2(E.month[m]) + (m === 0 ? ' in' : ''), tst = { w: 500, size: 20, anchor: 'middle' };
      o.push(T(cx2, TY, tv, tst)); mBoxes.push(box(cx2, TY, tv, tst));
      if (E.showN) {
        var nv = (m === 0 ? 'usual ' : '') + f2(E.mN[m]), nst2 = { size: 15, fill: C.mute, anchor: 'middle' };
        o.push(T(cx2, TY + 23, nv, nst2)); mBoxes.push(box(cx2, TY + 23, nv, nst2));
      }
    });

    // the reader's dates: label above the month row, a tick down to the ground
    var LY = 290;
    E.markers.forEach(function (mk, k) {
      var x = xs(mk.i), mst2 = { it: true, size: 17 }, yy = LY;
      if (k > 0 && mk.i - E.markers[k - 1].i <= 21) yy = LY - 22;
      var anchor = 'middle', lx = x, lb = box(x, yy, mk.label, Object.assign({ anchor: 'middle' }, mst2));
      if (lb.x < X0) { anchor = 'start'; lx = X0; } else if (lb.x + lb.w > X1) { anchor = 'end'; lx = X1; }
      var snowTop = G;
      if (E.full) days.forEach(function (dd, i) { if (Math.abs(i - mk.i) <= 1 && dd.s > 0 && E.P[i] !== null) snowTop = Math.min(snowTop, sy(dd.s) - 4); });
      var segs2 = [[yy + 6, Math.min(G - 1, snowTop)]];
      mBoxes.forEach(function (b) {
        if (!(x > b.x - 6 && x < b.x + b.w + 6)) return;
        var g0 = b.y - 4, g1 = b.y + b.h + 4;
        segs2 = segs2.reduce(function (acc, pq) {
          if (g1 <= pq[0] || g0 >= pq[1]) acc.push(pq);
          else [[pq[0], g0], [g1, pq[1]]].forEach(function (uv) { if (uv[1] - uv[0] > 8) acc.push(uv); });
          return acc;
        }, []);
      });
      segs2.forEach(function (pq) { o.push(line(x, pq[0], x, pq[1], C.ink, 0.75)); });
      if (mk.label) o.push(T(lx, yy, mk.label, Object.assign({ anchor: anchor }, mst2)));
    });

    // remarkable days: an open ring on the ground line, the label down in the open soil, clear of every bar
    recs.pts.forEach(function (r) {
      var x = xs(r.i), rst = { size: 16, w: 500, fill: C.rec }, pick = null, pb = null;
      for (var yy = G + 70; yy <= RB - 4 && !pick; yy += 30) {
        var tries = [{ x: x + 8, a: 'start' }, { x: x - 8, a: 'end' }];
        for (var k = 0; k < tries.length && !pick; k++) {
          var bb = box(tries[k].x, yy, r.label, Object.assign({}, rst, { anchor: tries[k].a }));
          if (bb.x < X0 || bb.x + bb.w > X1) continue;
          if (barHit(bb) || placed.some(function (q) { return hit(q, bb, 8); })) continue;
          // the leader runs down the day's own column: it must not cut a bar on the way
          var cut = days.some(function (dd, i) { var p = E.P[i]; return p > 0 && !(E.full && dd.s > 0) && i !== r.i && Math.abs(xs(i) - x) < 2.5 && ry(p) > G + 8; });
          if (cut) continue;
          pick = { x: tries[k].x, y: yy, a: tries[k].a }; pb = bb;
        }
      }
      if (!pick) { skipped.push(r.label); return; }
      var own = E.P[r.i] > 0 && !(E.full && days[r.i].s > 0) ? ry(E.P[r.i]) + 4 : G + 5;
      o.push(line(x, own, x, pb.y + pb.h / 2, C.rec, 0.8, ' stroke-dasharray="2 2"'));
      o.push('<circle cx="' + n2(x) + '" cy="' + G + '" r="4.6" fill="#FFFFFF" stroke="' + C.rec + '" stroke-width="1.8"/>');
      o.push(T(pick.x, pick.y, r.label, Object.assign({}, rst, { anchor: pick.a })));
      placed.push(pb);
    });

    // footer
    var foot = [E.daysText];
    if (E.cmp && E.ovNote) foot.push(E.ovNote);
    if (E.dry && !dryOnArt) foot.push('Longest dry stretch: ' + E.dry.len + ' days, ' + E.dry.range);
    else if (E.dry) foot.push('Dry stretch ' + E.dry.range);
    var fst = { size: 17, fill: C.mute };
    fst.size = fit(foot.join('  ·  '), fst, 1440, 13);
    o.push(T(ML, 1100, foot.join('  ·  '), fst));
    o.push(qrMark(I.qr, X1, 1100));
    last_skipped = skipped;
    return close(I, E, o, (G + RB) / 2 + 40);
  }

  var last_skipped = [];
  function render(I) {
    measure = typeof I.measure === 'function' ? I.measure : defaultMeasure;
    last_skipped = [];
    return I.style === 'r2' ? r2(I) : r1(I);
  }

  root.AgRainArt = {
    render: render, model: model, recordPoints: recordPoints, lastSkipped: function () { return last_skipped.slice(); },
    STYLES: ['r1', 'r2'], W: W0, H: H0, QR_INK: QR_INK, roughW: roughW
  };
})(typeof window !== 'undefined' ? window : this);
