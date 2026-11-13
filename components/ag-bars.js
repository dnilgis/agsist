/* components/ag-bars.js: the running-total line for the shared chart kit (Nov 13, 2026). Adds AgChart.mountRun and
   AgChart.runSvg to components/ag-chart.js, which it needs loaded first: the saved picture, Share and Copy link
   are the kit's own.

   One line for this year's running total over a second line for the normal's running total, the gap between them
   shaded flat, each line named at its right end, the stretches that made the year drawn heavier with the month's
   own numbers on them. Nothing here works a number out: the caller hands in points and words.

   cfg: { this: [[x, y]], norm: [[x, y]] | null, dotted: [[xa, xb]], x0, x1, ticks: [{ a, b, lab }], marks: [{ a, b, text }],
          freeze: { x, text } | null, fmt(v) axis text, topUnit, vfmt(v) text for an end, names: { a, n }, gapWords,
          steps, label, read(x, a, n) -> readout text, whenOf(x) -> date text } */
(function (root) {
  'use strict';
  var K = root.AgChart || (typeof module !== 'undefined' && module.exports && require('./ag-chart.js'));
  if (!K) return;
  var PAGE = K.PAGE, CARD = K.CARD, FONT = K.FONT, tools = K.tools;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function f1(v) { return v.toFixed(1); }
  function isN(x) { return typeof x === 'number' && isFinite(x); }
  /* text measured at what this face sets it at (about 0.56 of the size a character; the gutter allows 0.64) */
  function widthOf(s, fs, k) { return String(s).length * fs * (k || 0.56); }
  function txt(x, y, s, st, anchor) { return '<text x="' + f1(x) + '" y="' + f1(y) + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + ' style="' + st + '">' + esc(s) + '</text>'; }
  function nice(lo, hi, steps, maxN) {
    steps = steps || [0.05, 0.1, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i], a = Math.floor(lo / s + 1e-9) * s, b = Math.ceil(hi / s - 1e-9) * s;
      if ((b - a) / s <= (maxN || 6)) return { step: s, lo: a, hi: b === a ? a + s : b };
    }
    return { step: Math.max(hi - lo, 1e-9), lo: lo, hi: hi };
  }
  /* the value of a polyline at x (linear between its points; null outside) */
  function at(pts, x) {
    if (!pts || !pts.length || x < pts[0][0] - 1e-9 || x > pts[pts.length - 1][0] + 1e-9) return null;
    for (var i = 1; i < pts.length; i++) if (x <= pts[i][0] + 1e-9) {
      var a = pts[i - 1], b = pts[i]; return b[0] === a[0] ? b[1] : a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
    }
    return pts[pts.length - 1][1];
  }
  function tickText(cfg, v, hi) { return (cfg.fmt ? cfg.fmt(v) : String(v)) + (cfg.topUnit && v > hi - 1e-9 ? cfg.topUnit : ''); }

  /* the gap in words on short lines for the right edge: "10.3 inches", "ahead of", "normal" */
  function gapLines(w) {
    var m = /^(.+?) (ahead of|behind) (normal)$/.exec(String(w || ''));
    return m ? [m[1], m[2], m[3]] : w ? String(w).split(' ') .length > 2 ? [String(w).replace(/ normal$/, ''), 'normal'] : [String(w)] : [];
  }
  function runGeom(cfg, W, H, fs) {
    var top = 0;
    (cfg.this || []).forEach(function (p) { if (isN(p[1])) top = Math.max(top, p[1]); });
    (cfg.norm || []).forEach(function (p) { if (isN(p[1])) top = Math.max(top, p[1]); });
    var t = nice(0, Math.max(top, 1e-6) * (cfg.headroom || 1.03), cfg.steps, cfg.maxTicks), pl = 44;
    for (var v0 = 0; v0 <= t.hi + 1e-9; v0 += t.step) pl = Math.max(pl, Math.ceil(widthOf(tickText(cfg, v0, t.hi), fs, 0.64)) + (fs >= 20 ? 26 : 12));
    var wide = W >= 520, ends = [cfg.names && cfg.names.a || '', cfg.names && cfg.names.n || ''];
    var endLab = [cfg.vfmt ? cfg.vfmt(cfg.this[cfg.this.length - 1][1]) : '', cfg.norm ? cfg.vfmt(cfg.norm[cfg.norm.length - 1][1]) : ''];
    var gl = gapLines(cfg.gapWords), pr = Math.ceil(Math.max(widthOf(endLab[0], fs, 0.6), widthOf(endLab[1], fs, 0.6), widthOf(ends[0], fs), widthOf(ends[1], fs), cfg.norm ? Math.max.apply(null, gl.map(function (l) { return widthOf(l, fs, 0.6); }).concat([0])) : 0)) + 14;
    var card = fs >= 20, pt = Math.ceil(fs * (card ? 0.7 : 1.0)), pb = Math.ceil(fs * (card ? 1.85 : 2.1)), yb = H - pb, x0 = cfg.x0, x1 = cfg.x1;
    return { pl: pl, pr: pr, pt: pt, pb: pb, yb: yb, t: t, ymax: t.hi, x0: x0, x1: x1, wide: wide, endLab: endLab,
      X: function (x) { return pl + (x - x0) / (x1 - x0) * (W - pl - pr); }, Y: function (v) { return pt + (t.hi - v) / t.hi * (yb - pt); } };
  }
  function pathOf(g, pts) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + f1(g.X(p[0])) + ' ' + f1(g.Y(p[1])); }).join(''); }
  /* the part of a polyline between xa and xb, ends interpolated */
  function sub(pts, xa, xb) {
    var o = [[xa, at(pts, xa)]];
    pts.forEach(function (p) { if (p[0] > xa + 1e-9 && p[0] < xb - 1e-9) o.push(p); });
    o.push([xb, at(pts, xb)]);
    return o.filter(function (p) { return isN(p[1]); });
  }

  /* the places a label must stay off: both lines as sample points, the freeze rule, other labels */
  function samples(g, pts, out) {
    for (var i = 1; i < pts.length; i++) {
      var x0 = g.X(pts[i - 1][0]), y0 = g.Y(pts[i - 1][1]), x1 = g.X(pts[i][0]), y1 = g.Y(pts[i][1]), n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
      for (var k = 0; k <= n; k++) out.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
    }
    return out;
  }
  function hits(box, pts, pad) { var n = 0; for (var i = 0; i < pts.length; i++) if (pts[i][0] > box.l - pad && pts[i][0] < box.r + pad && pts[i][1] > box.t - pad && pts[i][1] < box.b + pad) n++; return n; }
  function overlap(a, b, pad) { return a.l < b.r + pad && a.r > b.l - pad && a.t < b.b + pad && a.b > b.t - pad; }

  var lastInfo = null;
  function runSvg(cfg, W, H, opt) {
    opt = opt || {};
    var fs = opt.fs || 12, P = opt.card ? CARD : PAGE, g = runGeom(cfg, W, H, fs), o = [], card = !!opt.card;
    var gold = card ? '#d4a23f' : 'var(--chart-1,var(--gold,#d4a23f))', grey = card ? '#9aa7ae' : 'var(--hp-norm,#7d8b93)', halo = 'paint-order:stroke;stroke:' + (card ? '#0a0c0d' : 'var(--surface)') + ';stroke-width:3px;stroke-linejoin:round;';
    var f = 'font-size:' + fs + 'px;font-family:' + FONT + ';', fb = f + 'font-weight:700;', fs1 = fs - 1;
    var T = cfg.this, N = cfg.norm, last = T[T.length - 1], nlast = N ? N[N.length - 1] : null;
    o.push('<svg xmlns="http://www.w3.org/2000/svg" class="agc-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(cfg.label || '') + '">');
    for (var v = 0; v <= g.ymax + 1e-9; v += g.t.step) {
      o.push('<line x1="' + g.pl + '" x2="' + f1(W - g.pr) + '" y1="' + f1(g.Y(v)) + '" y2="' + f1(g.Y(v)) + '" style="stroke:' + P.grid + ';stroke-width:1"/>');
      o.push(txt(g.pl - 6, g.Y(v) + fs * 0.33, tickText(cfg, v, g.ymax), f + 'fill:' + P.dim, 'end'));
    }
    o.push('<line x1="' + g.pl + '" x2="' + f1(W - g.pr) + '" y1="' + g.yb + '" y2="' + g.yb + '" style="stroke:' + P.mut + ';stroke-width:1"/>');
    /* month names under the plot: one even step for the whole axis (every month, every 2nd or every 3rd), the smallest that keeps every name
       clear of the next; the last month, a stub, is named only where it is as wide as its name */
    var ticks = cfg.ticks || [], cxs = ticks.map(function (t) { return g.X((t.a + t.b) / 2); }), maxW = 0, step = 1;
    ticks.forEach(function (t) { maxW = Math.max(maxW, widthOf(t.lab, fs, 0.6)); });
    for (; step < ticks.length; step++) { var okS = true; for (var q = step; q < ticks.length; q += step) if (cxs[q] - cxs[q - step] < maxW + fs * 0.9) okS = false; if (okS) break; }
    ticks.forEach(function (t, ti) {
      var w = widthOf(t.lab, fs, 0.6), stub = ti === ticks.length - 1 && g.X(t.b) - g.X(t.a) < w * 0.9;
      o.push('<line x1="' + f1(g.X(t.a)) + '" x2="' + f1(g.X(t.a)) + '" y1="' + g.yb + '" y2="' + (g.yb + 4) + '" style="stroke:' + P.mut + ';stroke-width:1"/>');
      if (ti % step === 0 && !stub) o.push(txt(cxs[ti], g.yb + fs * 1.45, t.lab, f + 'fill:' + P.dim, 'middle'));
    });
    if (N) {
      var xs = T.map(function (p) { return p[0]; }).filter(function (x) { return at(N, x) != null; }), up = [], dn = [];
      xs.forEach(function (x) { up.push([x, at(T, x)]); dn.unshift([x, at(N, x)]); });
      if (up.length > 1) o.push('<path d="' + pathOf(g, up.concat(dn)) + 'Z" style="fill:' + (card ? 'rgba(154,167,174,.22)' : 'var(--agc-gap,rgba(128,140,148,.22))') + ';stroke:none"/>');
      o.push('<path d="' + pathOf(g, N) + '" style="fill:none;stroke:' + grey + ';stroke-width:' + (card ? 3 : 2) + ';stroke-linejoin:round"/>');
    }
    (cfg.marks || []).forEach(function (m) { o.push('<path d="' + pathOf(g, sub(T, m.a, m.b)) + '" style="fill:none;stroke:' + gold + ';stroke-width:' + (card ? 9 : 6) + ';stroke-linecap:round;stroke-linejoin:round"/>'); });
    var dots = cfg.dotted || [], sw = card ? 4.5 : 2.6;
    if (!dots.length) o.push('<path d="' + pathOf(g, T) + '" style="fill:none;stroke:' + P.ink + ';stroke-width:' + sw + ';stroke-linejoin:round;stroke-linecap:round"/>');
    else {
      var edges = [T[0][0]]; dots.forEach(function (d) { edges.push(d[0], d[1]); }); edges.push(last[0]);
      for (var i = 0; i < edges.length; i += 2) o.push('<path d="' + pathOf(g, sub(T, edges[i], edges[i + 1])) + '" style="fill:none;stroke:' + P.ink + ';stroke-width:' + sw + ';stroke-linecap:round"/>');
      dots.forEach(function (d) { o.push('<path d="' + pathOf(g, sub(T, d[0], d[1])) + '" style="fill:none;stroke:' + P.ink + ';stroke-width:' + (card ? 3 : 2) + ';stroke-dasharray:2 5;stroke-linecap:round"/>'); });
    }
    /* what the words must stay off */
    var pts = samples(g, T, []); if (N) samples(g, N, pts);
    var boxes = [], inPlot = { l: g.pl + 2, r: W - g.pr - 2, t: g.pt - 2, b: g.yb - 3 };
    function fits(b) { return b.l >= inPlot.l && b.r <= inPlot.r && b.t >= inPlot.t && b.b <= inPlot.b; }
    function free(b, rule) { return fits(b) && !hits(b, pts, 3) && !boxes.some(function (q) { return overlap(b, q, 5); }) && !(rule != null && b.l - 6 < rule && b.r + 6 > rule); }
    /* the first 28 degree freeze: a thin rule, its words in a corner clear of the lines */
    var frz = null;
    if (cfg.freeze && cfg.freeze.x > g.x0 && cfg.freeze.x < g.x1) {
      var fx = g.X(cfg.freeze.x), variants = [cfg.freeze.text].concat(cfg.freeze.short ? [cfg.freeze.short] : []), pick = null;
      variants.forEach(function (txtv) {
        var fw = widthOf(txtv, fs1, 0.58);
        [[fx - 5, g.yb - 6, 'end'], [fx - 5, g.pt + fs1 + 2, 'end'], [fx - 5, g.yb - 6 - fs * 1.4, 'end'], [fx - 5, g.yb - 6 - fs * 2.8, 'end'], [fx + 5, g.yb - 6, 'start']].forEach(function (c) {
          if (pick) return;
          var b = c[2] === 'end' ? { l: c[0] - fw, r: c[0], t: c[1] - fs1, b: c[1] + 3 } : { l: c[0], r: c[0] + fw, t: c[1] - fs1, b: c[1] + 3 };
          if (fits(b) && !hits(b, pts, 3)) pick = { b: b, c: c, text: txtv };
        });
      });
      var fw0 = widthOf(variants[variants.length - 1], fs1, 0.58);
      pick = pick || { b: { l: fx - 5 - fw0, r: fx - 5, t: g.yb - 6 - fs1, b: g.yb - 3 }, c: [fx - 5, g.yb - 6, 'end'], text: variants[variants.length - 1] };
      boxes.push(pick.b); frz = fx;
      o.push('<line x1="' + f1(fx) + '" x2="' + f1(fx) + '" y1="' + g.pt + '" y2="' + g.yb + '" style="stroke:' + P.mut + ';stroke-width:1;stroke-dasharray:3 3"/>');
      o.push(txt(pick.c[0], pick.c[1], pick.text, f + 'font-size:' + fs1 + 'px;fill:' + P.dim + ';' + halo, pick.c[2]));
    }
    /* the marks' words: each one off both lines (6 px clear, bold measured at 0.62 of the size), off the other labels, and joined to its stretch by a
       hairline that crosses nothing: it runs from the line nearest the label, and a place whose hairline would cross another label, hairline or line is not chosen */
    var mid = (g.x0 + g.x1) / 2, words = [], leaders = [], segs = [];
    function segCross(x0, y0, x1, y1) {
      var n = 0, len = Math.hypot(x1 - x0, y1 - y0), steps = Math.max(2, Math.ceil(len / 2));
      for (var i = 0; i <= steps; i++) {
        var x = x0 + (x1 - x0) * i / steps, y = y0 + (y1 - y0) * i / steps, d0 = Math.hypot(x - x0, y - y0);
        if (d0 > 5) for (var j = 0; j < pts.length; j++) if (Math.abs(pts[j][0] - x) < 2.5 && Math.abs(pts[j][1] - y) < 2.5) { n++; break; }
        for (var k = 0; k < boxes.length; k++) if (x > boxes[k].l - 3 && x < boxes[k].r + 3 && y > boxes[k].t - 3 && y < boxes[k].b + 3) { n++; break; }
      }
      segs.forEach(function (q) { if (ccw(x0, y0, q[0], q[1], q[2], q[3]) && ccw(x1, y1, q[0], q[1], q[2], q[3]) !== ccw(x0, y0, q[0], q[1], q[2], q[3]) && ccw(x0, y0, x1, y1, q[0], q[1]) !== ccw(x0, y0, x1, y1, q[2], q[3])) n += 20; });
      return n;
    }
    function ccw(ax, ay, bx, by, cx, cy) { return (cy - ay) * (bx - ax) > (by - ay) * (cx - ax); }
    (cfg.marks || []).forEach(function (m) {
      var xm = (m.a + m.b) / 2, va = at(T, xm), vn = N ? at(N, xm) : null, px = g.X(xm), py = g.Y(va), lowY = g.Y(vn == null ? va : Math.min(va, vn)), highY = g.Y(vn == null ? va : Math.max(va, vn));
      var one = [m.text], two = String(m.text).split(', normal '); if (two.length === 2) two[1] = 'normal ' + two[1]; else two = null;
      var late = xm > mid, order = late ? ['UL', 'LR', 'LL', 'UR'] : ['LR', 'UL', 'UR', 'LL'], best = null, bestN = 1e9;
      [one, two].forEach(function (lines) {
        if (!lines) return;
        var w = Math.max.apply(null, lines.map(function (l) { return widthOf(l, fs1, 0.62); })), h = lines.length * fs * 1.2;
        order.forEach(function (side) { for (var k = 0; k < 14; k++) [0, 12, 24, 36, 48, 60, 80, 100, 120].forEach(function (dx) {
          var up = side[0] === 'U', rt = side[1] === 'R', x = rt ? px + 4 + dx : px - 4 - dx, bot = highY - fs * 0.55 - k * fs * 1.3, yTop = up ? bot - h : lowY + fs * 0.55 + k * fs * 1.3;
          var b = { l: rt ? x : x - w, r: rt ? x + w : x, t: yTop, b: yTop + h };
          var sy = up ? highY : lowY, ex0 = Math.max(b.l, Math.min(b.r, px)), ey0 = up ? b.b : b.t;
          var nHit = hits(b, pts, 6) + (fits(b) ? 0 : 400) + boxes.filter(function (q) { return overlap(b, q, 5); }).length * 600 + (frz != null && b.l - 6 < frz && b.r + 6 > frz ? 300 : 0);
          if (Math.hypot(ex0 - px, ey0 - sy) > 7) nHit += segCross(px, sy, ex0, ey0) * 4;
          if (nHit + dx * 0.02 + k * 0.5 < bestN) { bestN = nHit + dx * 0.02 + k * 0.5; best = { b: b, lines: lines, x: x, rt: rt, y0: yTop + fs1 * 0.85, up: up, sy: sy, ex0: ex0, ey0: ey0 }; }
        }); });
      });
      if (!best) return;
      boxes.push(best.b);
      best.lines.forEach(function (l, j) { words.push(txt(best.x, best.y0 + j * fs * 1.2, l, f + 'font-size:' + fs1 + 'px;font-weight:700;fill:' + P.ink + ';' + halo, best.rt ? 'start' : 'end')); });
      if (Math.hypot(best.ex0 - px, best.ey0 - best.sy) > 7) { leaders.push('<line x1="' + f1(px) + '" x2="' + f1(best.ex0) + '" y1="' + f1(best.sy) + '" y2="' + f1(best.ey0) + '" style="stroke:' + P.mut + ';stroke-width:1"/>'); segs.push([px, best.sy, best.ex0, best.ey0]); }
    });
    o.push.apply(o, leaders); o.push.apply(o, words);
    /* the lines named at their right ends with the value; the gap in words under them, in the same column */
    var ex = W - g.pr + 8, ya0 = g.Y(last[1]), yn0 = nlast ? g.Y(nlast[1]) : null, ta = ya0, tn = yn0, minGap = fs * 3.4;
    if (yn0 != null && Math.abs(ya0 - yn0) < minGap) { var md = (ya0 + yn0) / 2, half = minGap / 2; ta = ya0 <= yn0 ? md - half : md + half; tn = ya0 <= yn0 ? md + half : md - half; }
    ta = Math.max(ta, fs * 1.1); if (tn != null) { tn = Math.max(tn, fs * 1.1); if (Math.abs(ta - tn) < minGap) { if (ta <= tn) tn = ta + minGap; else ta = tn + minGap; } }
    o.push(circle(g.X(last[0]), ya0, P.ink, card));
    o.push(txt(ex, ta - fs * 0.15, g.endLab[0], fb + 'fill:' + P.ink));
    o.push(txt(ex, ta + fs * 1.05, cfg.names.a, f + 'fill:' + P.dim));
    if (nlast) {
      o.push(circle(g.X(nlast[0]), yn0, grey, card));
      o.push(txt(ex, tn - fs * 0.15, g.endLab[1], fb + 'fill:' + P.dim));
      o.push(txt(ex, tn + fs * 1.05, cfg.names.n, f + 'fill:' + P.dim));
      var gl = gapLines(cfg.gapWords);
      if (gl.length) {
        var lowEnd = Math.max(ta, tn), gy = lowEnd + fs * 2.9;
        if (gy + gl.length * fs * 1.2 > g.yb) gy = Math.min(ta, tn) - fs * 1.9 - gl.length * fs * 1.2 + fs * 1.2;
        gl.forEach(function (l, j) { o.push(txt(ex, gy + j * fs * 1.2, l, fb + 'fill:' + P.ink)); });
      }
    }
    lastInfo = { boxes: boxes.slice(), pts: pts, freeze: frz, plot: inPlot, marks: boxes.slice(frz == null ? 0 : 1) };
    o.push('<g class="agc-hv" visibility="hidden" style="pointer-events:none"><line class="hv-l" y1="' + g.pt + '" y2="' + g.yb + '" style="stroke:' + P.ink + ';stroke-width:1;opacity:.55"/><circle class="hv-a" r="4" style="fill:' + P.ink + '"/>' + (N ? '<circle class="hv-n" r="4" style="fill:' + grey + '"/>' : '') + '</g>');
    o.push('</svg>');
    return o.join('');
  }
  function circle(x, y, fill, card) { return '<circle cx="' + f1(x) + '" cy="' + f1(y) + '" r="' + (card ? 6 : 3.5) + '" style="fill:' + fill + '"/>'; }

  function mountRun(el, cfg) {
    var hh = cfg.height || {}, lastW = 0, cur = -1, g = null, T = cfg.this, N = cfg.norm;
    el.classList.add('agc', 'agc-bars', 'agc-run');
    el.innerHTML = '<div class="agc-plot" tabindex="0" role="group"></div><p class="agc-read" aria-live="polite"></p>';
    var plot = el.querySelector('.agc-plot'), read = el.querySelector('.agc-read');
    var fit = function () { plot.style.height = (el.clientWidth < 520 ? hh.phone || 230 : hh.wide || 260) + 'px'; };
    fit();
    function say(i) {
      cur = i;
      var hv = plot.querySelector('.agc-hv'), p = T[i < 0 ? T.length - 1 : i], a = p[1], n = N ? at(N, p[0]) : null;
      read.textContent = i < 0 ? (cfg.rest || 'Drag along the line to read any date.') : cfg.read(p[0], a, n);
      if (!hv || !g) return;
      if (i < 0) { hv.setAttribute('visibility', 'hidden'); return; }
      var x = g.X(p[0]); hv.setAttribute('visibility', 'visible');
      var l = hv.querySelector('.hv-l'); l.setAttribute('x1', f1(x)); l.setAttribute('x2', f1(x));
      var ca = hv.querySelector('.hv-a'); ca.setAttribute('cx', f1(x)); ca.setAttribute('cy', f1(g.Y(a)));
      var cn = hv.querySelector('.hv-n'); if (cn && n != null) { cn.setAttribute('cx', f1(x)); cn.setAttribute('cy', f1(g.Y(n))); }
    }
    function draw(force) {
      var W = Math.round(plot.clientWidth); if (!W || (W === lastW && !force)) return; lastW = W; fit();
      var H = W < 520 ? hh.phone || 230 : hh.wide || 260, fs = W < 520 ? 12.5 : 13;
      g = runGeom(cfg, W, H, fs);
      plot.innerHTML = runSvg(cfg, W, H, { fs: fs });
      plot.setAttribute('aria-label', (cfg.label || '') + ' Use the arrow keys to read along the year.');
      say(cur);
    }
    var near = function (e) {
      var r = plot.getBoundingClientRect(), x = g.x0 + (e.clientX - r.left - g.pl) / (r.width - g.pl - g.pr) * (g.x1 - g.x0), b = 1;   /* the zero point at the start of the year is not a day to read */
      T.forEach(function (p, i) { if (i > 0 && Math.abs(p[0] - x) < Math.abs(T[b][0] - x)) b = i; });
      return b;
    };
    plot.addEventListener('pointermove', function (e) { if (g && e.clientX - plot.getBoundingClientRect().left >= g.pl) say(near(e)); });
    plot.addEventListener('pointerdown', function (e) { if (g) say(near(e)); });
    plot.addEventListener('pointerleave', function () { if (el.ownerDocument.activeElement !== plot) say(-1); });
    plot.addEventListener('blur', function () { say(-1); });
    plot.addEventListener('focus', function () { say(cur >= 0 ? cur : T.length - 1); });
    plot.addEventListener('keydown', function (e) {
      var c = cur < 0 ? T.length - 1 : cur, j = e.key === 'ArrowLeft' ? c - 1 : e.key === 'ArrowRight' ? c + 1 : e.key === 'Home' ? 1 : e.key === 'End' ? T.length - 1 : null;
      if (e.key === 'Escape') { say(-1); return; }
      if (j == null) return;
      e.preventDefault(); say(Math.max(1, Math.min(T.length - 1, j)));
    });
    draw();
    if (root.ResizeObserver) new root.ResizeObserver(function () { draw(); }).observe(plot); else root.addEventListener('resize', function () { draw(); });
    cfg.svgFor = function (W, H) { return runSvg(cfg, W, H, { fs: 22, card: true }); };
    if (cfg.tools && cfg.share) tools(cfg, function () { return { to: cfg.share.date }; });
    return { redraw: function () { draw(true); } };
  }

  K.runInfo = function () { return lastInfo; }; K.mountRun = mountRun; K.runSvg = runSvg; K.runGeom = runGeom; K.runAt = at;
})(typeof window !== 'undefined' ? window : globalThis);
