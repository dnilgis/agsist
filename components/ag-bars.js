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
  function nice(lo, hi, steps) {
    steps = steps || [0.05, 0.1, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i], a = Math.floor(lo / s + 1e-9) * s, b = Math.ceil(hi / s - 1e-9) * s;
      if ((b - a) / s <= 6) return { step: s, lo: a, hi: b === a ? a + s : b };
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

  function runGeom(cfg, W, H, fs) {
    var top = 0;
    (cfg.this || []).forEach(function (p) { if (isN(p[1])) top = Math.max(top, p[1]); });
    (cfg.norm || []).forEach(function (p) { if (isN(p[1])) top = Math.max(top, p[1]); });
    var t = nice(0, Math.max(top, 1e-6) * 1.03, cfg.steps), pl = 44;
    for (var v0 = 0; v0 <= t.hi + 1e-9; v0 += t.step) pl = Math.max(pl, Math.ceil(widthOf(tickText(cfg, v0, t.hi), fs, 0.64)) + (fs >= 20 ? 26 : 12));
    var wide = W >= 520, ends = [cfg.names && cfg.names.a || '', cfg.names && cfg.names.n || ''];
    var endLab = [cfg.vfmt ? cfg.vfmt(cfg.this[cfg.this.length - 1][1]) : '', cfg.norm ? cfg.vfmt(cfg.norm[cfg.norm.length - 1][1]) : ''];
    var pr = Math.ceil(Math.max(widthOf(endLab[0], fs, 0.6), widthOf(endLab[1], fs, 0.6), widthOf(ends[0], fs), widthOf(ends[1], fs))) + 14;
    var pt = Math.ceil(fs * 1.6), pb = Math.ceil(fs * 2.1), yb = H - pb, x0 = cfg.x0, x1 = cfg.x1;
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

  function runSvg(cfg, W, H, opt) {
    opt = opt || {};
    var fs = opt.fs || 12, P = opt.card ? CARD : PAGE, g = runGeom(cfg, W, H, fs), o = [], card = !!opt.card;
    var gold = card ? '#d4a23f' : 'var(--chart-1,var(--gold,#d4a23f))', grey = card ? '#9aa7ae' : 'var(--agc-norm,#5b6870)', halo = 'paint-order:stroke;stroke:' + (card ? '#0a0c0d' : 'var(--surface)') + ';stroke-width:3px;stroke-linejoin:round;';
    var f = 'font-size:' + fs + 'px;font-family:' + FONT + ';', fb = f + 'font-weight:700;';
    var T = cfg.this, N = cfg.norm, last = T[T.length - 1], nlast = N ? N[N.length - 1] : null;
    o.push('<svg xmlns="http://www.w3.org/2000/svg" class="agc-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(cfg.label || '') + '">');
    for (var v = 0; v <= g.ymax + 1e-9; v += g.t.step) {
      o.push('<line x1="' + g.pl + '" x2="' + f1(W - g.pr) + '" y1="' + f1(g.Y(v)) + '" y2="' + f1(g.Y(v)) + '" style="stroke:' + P.grid + ';stroke-width:1"/>');
      o.push(txt(g.pl - 6, g.Y(v) + fs * 0.33, tickText(cfg, v, g.ymax), f + 'fill:' + P.dim, 'end'));
    }
    o.push('<line x1="' + g.pl + '" x2="' + f1(W - g.pr) + '" y1="' + g.yb + '" y2="' + g.yb + '" style="stroke:' + P.mut + ';stroke-width:1"/>');
    /* month names under the plot, every other one when they would touch */
    var ticks = cfg.ticks || [], mid = function (t) { return g.X((t.a + t.b) / 2); }, step = ticks.length > 1 && Math.abs(g.X(ticks[1].a) - g.X(ticks[0].a)) < fs * 2.9 ? 2 : 1;
    ticks.forEach(function (t, i) {
      o.push('<line x1="' + f1(g.X(t.a)) + '" x2="' + f1(g.X(t.a)) + '" y1="' + g.yb + '" y2="' + (g.yb + 4) + '" style="stroke:' + P.mut + ';stroke-width:1"/>');
      if (i % step === 0) o.push(txt(mid(t), g.yb + fs * 1.45, t.lab, f + 'fill:' + P.dim, 'middle'));
    });
    /* the gap, one flat neutral, only where both lines are drawn */
    if (N) {
      var xs = T.map(function (p) { return p[0]; }).filter(function (x) { return at(N, x) != null; }), up = [], dn = [];
      xs.forEach(function (x) { up.push([x, at(T, x)]); dn.unshift([x, at(N, x)]); });
      if (up.length > 1) o.push('<path d="' + pathOf(g, up.concat(dn)) + 'Z" style="fill:' + (card ? 'rgba(154,167,174,.22)' : 'var(--agc-gap,rgba(128,140,148,.22))') + ';stroke:none"/>');
      o.push('<path d="' + pathOf(g, N) + '" style="fill:none;stroke:' + grey + ';stroke-width:' + (card ? 3 : 2) + ';stroke-linejoin:round"/>');
    }
    /* the stretches that made the year: gold under the ink line */
    (cfg.marks || []).forEach(function (m) { o.push('<path d="' + pathOf(g, sub(T, m.a, m.b)) + '" style="fill:none;stroke:' + gold + ';stroke-width:' + (card ? 9 : 6) + ';stroke-linecap:round;stroke-linejoin:round"/>'); });
    /* this year: ink, dotted where the file withholds the days */
    var dots = cfg.dotted || [];
    if (!dots.length) o.push('<path d="' + pathOf(g, T) + '" style="fill:none;stroke:' + P.ink + ';stroke-width:' + (card ? 4.5 : 2.6) + ';stroke-linejoin:round;stroke-linecap:round"/>');
    else {
      var edges = [T[0][0]]; dots.forEach(function (d) { edges.push(d[0], d[1]); }); edges.push(last[0]);
      for (var i = 0; i < edges.length; i += 2) o.push('<path d="' + pathOf(g, sub(T, edges[i], edges[i + 1])) + '" style="fill:none;stroke:' + P.ink + ';stroke-width:' + (card ? 4.5 : 2.6) + ';stroke-linecap:round"/>');
      dots.forEach(function (d) { o.push('<path d="' + pathOf(g, sub(T, d[0], d[1])) + '" style="fill:none;stroke:' + P.ink + ';stroke-width:' + (card ? 3 : 2) + ';stroke-dasharray:2 5;stroke-linecap:round"/>'); });
    }
    /* the first 28 degree freeze: a thin rule with its words */
    if (cfg.freeze && cfg.freeze.x > g.x0 && cfg.freeze.x < g.x1) {
      var fx = g.X(cfg.freeze.x), left = fx + widthOf(cfg.freeze.text, fs - 1) + 6 > W - g.pr;
      o.push('<line x1="' + f1(fx) + '" x2="' + f1(fx) + '" y1="' + g.pt + '" y2="' + g.yb + '" style="stroke:' + P.mut + ';stroke-width:1;stroke-dasharray:3 3"/>');
      o.push(txt(fx + (left ? -4 : 4), g.yb - 6, cfg.freeze.text, f + 'font-size:' + (fs - 1) + 'px;fill:' + P.dim + ';' + halo, left ? 'end' : 'start'));
    }
    /* the marks' words: under the lower of the two lines, where the running lines leave room, from the stretch's middle to the right,
       joined to it by a hairline; one below another when they would touch */
    var placed = [], leaders = [], words = [];
    (cfg.marks || []).forEach(function (m) {
      var xm = (m.a + m.b) / 2, va = at(T, xm), vn = N ? at(N, xm) : null, low = g.Y(vn == null ? va : Math.min(va, vn)), high = g.Y(vn == null ? va : Math.max(va, vn)), w = widthOf(m.text, fs - 1, 0.58);
      var x = g.X(xm) + 5, anchor = 'start', maxR = W - g.pr - 2;
      if (x + w > maxR) { x = maxR; anchor = 'end'; }
      var two = low + fs * 2 > g.yb - 3 ? String(m.text).split(', normal ') : null;   /* over the upper line the words go on two short lines, clear of the climbing lines */
      if (two && two.length === 2) { two[1] = 'normal ' + two[1]; w = Math.max(widthOf(two[0], fs - 1, 0.58), widthOf(two[1], fs - 1, 0.58)); if (anchor === 'start') x = g.X(xm) + 5; }
      /* under the lower line; over the upper one when there is no room above the axis */
      var below = low + fs * 2 <= g.yb - 3, y = below ? low + fs * 2 : high - fs * 0.9, dir = below ? 1 : -1, l = anchor === 'end' ? x - w : x, r = anchor === 'end' ? x : x + w;
      for (var k = 0; k < placed.length; k++) if (l < placed[k].r + 8 && r > placed[k].l - 8 && Math.abs(y - placed[k].y) < fs * 1.35) { y += dir * fs * 1.4; k = -1; }
      placed.push({ l: l, r: r, y: y, xm: g.X(xm), y1: below ? low + 3 : y + 3, y2: below ? y - fs * 0.95 : high - 3 });
      if (two && two.length === 2) { words.push(txt(x, y - fs * 1.2, two[0], f + 'font-size:' + (fs - 1) + 'px;font-weight:700;fill:' + P.ink + ';' + halo, anchor)); words.push(txt(x, y, two[1], f + 'font-size:' + (fs - 1) + 'px;font-weight:700;fill:' + P.ink + ';' + halo, anchor)); }
      else words.push(txt(x, y, m.text, f + 'font-size:' + (fs - 1) + 'px;font-weight:700;fill:' + P.ink + ';' + halo, anchor));
    });
    placed.forEach(function (p, i) {   /* a hairline that would run through another mark's words is left out */
      var hit = placed.some(function (q, j) { return j !== i && p.xm > q.l - 2 && p.xm < q.r + 2 && q.y - fs * 1.1 < Math.max(p.y1, p.y2) + 1 && q.y + 3 > Math.min(p.y1, p.y2); });
      if (!hit) leaders.push('<line x1="' + f1(p.xm) + '" x2="' + f1(p.xm) + '" y1="' + f1(p.y1) + '" y2="' + f1(p.y2) + '" style="stroke:' + P.mut + ';stroke-width:1"/>');
    });
    o.push.apply(o, leaders); o.push.apply(o, words);   /* the hairlines first, so a word's halo clears the one behind it */
    /* the lines named at their ends, with the value; the gap in words between them where there is room */
    var ex = W - g.pr + 8, ya0 = g.Y(last[1]), yn0 = nlast ? g.Y(nlast[1]) : null, ta = ya0, tn = yn0, minGap = fs * 2.7;
    if (yn0 != null && Math.abs(ya0 - yn0) < minGap) { var mid = (ya0 + yn0) / 2, half = minGap / 2; ta = ya0 <= yn0 ? mid - half : mid + half; tn = ya0 <= yn0 ? mid + half : mid - half; }
    o.push(circle(g.X(last[0]), ya0, P.ink, card));
    o.push(txt(ex, ta - fs * 0.15, g.endLab[0], fb + 'fill:' + P.ink));
    o.push(txt(ex, ta + fs * 1.05, cfg.names.a, f + 'fill:' + P.dim));
    if (nlast) {
      o.push(circle(g.X(nlast[0]), yn0, grey, card));
      o.push(txt(ex, tn - fs * 0.15, g.endLab[1], fb + 'fill:' + P.dim));
      o.push(txt(ex, tn + fs * 1.05, cfg.names.n, f + 'fill:' + P.dim));
    }
    /* the gap in words, top left where the running lines have not yet climbed */
    if (N && cfg.gapWords) {
      var gw = String(cfg.gapWords), room = W - g.pl - g.pr - 16, parts = widthOf(gw, fs, 0.6) > room ? gw.split(/ (?=ahead of|behind)/) : [gw];
      parts.forEach(function (sx, j) { o.push(txt(g.pl + 8, g.pt + fs * 1.2 + j * fs * 1.25, sx, fb + 'fill:' + P.ink + ';' + halo)); });
    }
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
      read.textContent = cfg.read(p[0], a, n);
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
      var r = plot.getBoundingClientRect(), x = g.x0 + (e.clientX - r.left - g.pl) / (r.width - g.pl - g.pr) * (g.x1 - g.x0), b = 0;
      T.forEach(function (p, i) { if (Math.abs(p[0] - x) < Math.abs(T[b][0] - x)) b = i; });
      return b;
    };
    plot.addEventListener('pointermove', function (e) { if (g && e.clientX - plot.getBoundingClientRect().left >= g.pl) say(near(e)); });
    plot.addEventListener('pointerdown', function (e) { if (g) say(near(e)); });
    plot.addEventListener('pointerleave', function () { if (el.ownerDocument.activeElement !== plot) say(-1); });
    plot.addEventListener('blur', function () { say(-1); });
    plot.addEventListener('focus', function () { say(cur >= 0 ? cur : T.length - 1); });
    plot.addEventListener('keydown', function (e) {
      var c = cur < 0 ? T.length - 1 : cur, j = e.key === 'ArrowLeft' ? c - 1 : e.key === 'ArrowRight' ? c + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? T.length - 1 : null;
      if (e.key === 'Escape') { say(-1); return; }
      if (j == null) return;
      e.preventDefault(); say(Math.max(0, Math.min(T.length - 1, j)));
    });
    draw();
    if (root.ResizeObserver) new root.ResizeObserver(function () { draw(); }).observe(plot); else root.addEventListener('resize', function () { draw(); });
    cfg.svgFor = function (W, H) { return runSvg(cfg, W, H, { fs: 22, card: true }); };
    if (cfg.tools && cfg.share) tools(cfg, function () { return { to: cfg.share.date }; });
    return { redraw: function () { draw(true); } };
  }

  K.mountRun = mountRun; K.runSvg = runSvg; K.runGeom = runGeom; K.runAt = at;
})(typeof window !== 'undefined' ? window : globalThis);
