/* components/ag-bars.js: grouped bars for the shared chart kit (Nov 12, 2026). Adds AgChart.mountBars and AgChart.barsSvg
   to components/ag-chart.js, which it needs loaded first: the card, Share and Save the picture are the kit's own.
*/
(function (root) {
  'use strict';
  var K = root.AgChart || (typeof module !== 'undefined' && module.exports && require('./ag-chart.js'));
  if (!K) return;
  var PAGE = K.PAGE, CARD = K.CARD, FONT = K.FONT, tools = K.tools;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function f1(v) { return v.toFixed(1); }
  function widthOf(s, fs) { return String(s).length * fs * 0.56; }
  function txt(x, y, s, st, anchor) { return '<text x="' + f1(x) + '" y="' + f1(y) + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + ' style="' + st + '">' + esc(s) + '</text>'; }
  var NORM = { page: 'var(--agc-norm,#5b6870)', card: '#7d8b93' }, barN = 0;
  function nice(lo, hi, steps) {
    steps = steps || [0.05, 0.1, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i], a = Math.floor(lo / s + 1e-9) * s, b = Math.ceil(hi / s - 1e-9) * s;
      if ((b - a) / s <= 6) return { step: s, lo: a, hi: b === a ? a + s : b };
    }
    return { step: Math.max(hi - lo, 1e-9), lo: lo, hi: hi };
  }
  function isN(x) { return typeof x === 'number' && isFinite(x); }
  /* the axis label of a tick: the top one also carries the unit when the config names one (cfg.topUnit) */
  function tickText(cfg, v, hi) { return (cfg.fmt ? cfg.fmt(v) : String(v)) + (cfg.topUnit && v > hi - 1e-9 ? cfg.topUnit : ''); }
  function barsGeom(cfg, W, H, fs) {
    var M = cfg.groups, pr = 8, pt = Math.ceil(fs * 2.1), pb = Math.ceil(fs * 2.1), top = 0;
    M.forEach(function (x) { if (isN(x.a)) top = Math.max(top, x.a); if (isN(x.n)) top = Math.max(top, x.n); });
    var t = nice(0, Math.max(top, 1e-6) * 1.03, cfg.steps), pl = 44;
    for (var v0 = 0; v0 <= t.hi + 1e-9; v0 += t.step) pl = Math.max(pl, Math.ceil(widthOf(tickText(cfg, v0, t.hi), fs)) + 12);
    var cw = (W - pl - pr) / M.length, yb = H - pb;
    var hasN = M.some(function (x) { return isN(x.n); }), bw = Math.max(3, Math.min(cw * 0.36, fs * 1.6));
    return { M: M, pl: pl, pr: pr, pt: pt, pb: pb, t: t, ymax: t.hi, cw: cw, yb: yb, hasN: hasN, bw: bw,
      Y: function (v) { return pt + (t.hi - v) / t.hi * (yb - pt); }, cx: function (i) { return pl + cw * (i + 0.5); } };
  }
  function barsSvg(cfg, W, H, opt) {
    var fs = opt.fs || 12, P = opt.card ? CARD : PAGE, g = barsGeom(cfg, W, H, fs), M = g.M, id = 'agcb' + (++barN), o = [];
    var gold = opt.card ? '#d4a23f' : 'var(--chart-1,var(--gold,#d4a23f))', slate = opt.card ? NORM.card : NORM.page;
    var f = 'font-size:' + fs + 'px;font-family:' + FONT + ';';
    o.push('<svg xmlns="http://www.w3.org/2000/svg" class="agc-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(cfg.label || '') + '">');
    o.push('<defs><pattern id="' + id + '" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" style="fill:' + P.surf + '"/><line x1="0" y1="0" x2="0" y2="5" style="stroke:' + P.mut + ';stroke-width:1.6"/></pattern></defs>');
    for (var v = 0; v <= g.ymax + 1e-9; v += g.t.step) {
      o.push('<line x1="' + g.pl + '" x2="' + (W - g.pr) + '" y1="' + f1(g.Y(v)) + '" y2="' + f1(g.Y(v)) + '" style="stroke:' + P.grid + ';stroke-width:1"/>');
      o.push(txt(g.pl - 6, g.Y(v) + fs * 0.33, tickText(cfg, v, g.ymax), f + 'fill:' + P.dim, 'end'));
    }
    o.push('<line x1="' + g.pl + '" x2="' + (W - g.pr) + '" y1="' + g.yb + '" y2="' + g.yb + '" style="stroke:' + P.mut + ';stroke-width:1"/>');
    var step = M.length > 9 && g.cw < fs * 2.6 ? 2 : 1;
    M.forEach(function (x, i) {
      var cx = g.cx(i), xa = g.hasN ? cx - g.bw - 1 : cx - g.bw / 2, xn = cx + 1;
      if (g.hasN && isN(x.n)) o.push('<rect x="' + f1(xn) + '" y="' + f1(g.Y(x.n)) + '" width="' + f1(g.bw) + '" height="' + f1(Math.max(0, g.yb - g.Y(x.n))) + '" style="fill:' + slate + (x.part ? ';opacity:.7' : '') + '"/>');
      /* a withheld month is a hatched stub; the word n/a goes beside it only where the months are wide enough to hold it (the key says it otherwise) */
      if (x.gap || !isN(x.a)) o.push('<rect x="' + f1(xa) + '" y="' + (g.yb - 8) + '" width="' + f1(g.bw) + '" height="8" style="fill:url(#' + id + ');stroke:' + P.mut + ';stroke-width:1"/>' + (g.cw >= 30 ? txt(xa + g.bw / 2, g.yb - 12, 'n/a', f + 'fill:' + P.mut, 'middle') : ''));
      else o.push('<rect x="' + f1(xa) + '" y="' + f1(g.Y(x.a)) + '" width="' + f1(g.bw) + '" height="' + f1(Math.max(0, g.yb - g.Y(x.a))) + '" style="fill:' + gold + (x.part ? ';opacity:.6' : '') + '"/>');
      if (i % step === 0 || i === M.length - 1) o.push(txt(cx, g.yb + fs * 1.45, x.lab, f + 'fill:' + P.dim, 'middle'));
    });
    var L = M.length - 1, last = M[L];
    /* the last month's figure is written in the saved picture only; on the page the readout under the chart says it once */
    if (opt.card && isN(last.a) && !last.gap) {
      o.push(txt(W - g.pr, g.pt - fs * 0.6, last.lab + (last.part ? ' so far' : '') + ': ' + cfg.vfmt(last.a) + (g.hasN && isN(last.n) ? ' (normal ' + cfg.vfmt(last.n) + ')' : ''), f + 'font-weight:700;fill:' + P.ink, 'end'));
    }
    if (opt.card) {   /* the key goes in the picture: it has no legend of its own */
      var kx = g.pl, ky = g.pt - fs * 0.6, na = (cfg.names || {});
      o.push('<rect x="' + kx + '" y="' + f1(ky - fs * 0.8) + '" width="' + f1(fs * 0.8) + '" height="' + f1(fs * 0.8) + '" style="fill:' + gold + '"/>' + txt(kx + fs * 1.1, ky, na.a || '', f + 'fill:' + P.ink));
      if (g.hasN) { var kx2 = kx + fs * 1.1 + widthOf(na.a || '', fs) + fs * 1.4; o.push('<rect x="' + f1(kx2) + '" y="' + f1(ky - fs * 0.8) + '" width="' + f1(fs * 0.8) + '" height="' + f1(fs * 0.8) + '" style="fill:' + slate + '"/>' + txt(kx2 + fs * 1.1, ky, na.n || 'Normal', f + 'fill:' + P.ink)); }
    }
    o.push('<rect class="agc-hl" x="0" y="' + g.pt + '" width="' + f1(g.cw) + '" height="' + f1(g.yb - g.pt) + '" visibility="hidden" style="fill:' + P.ink + ';opacity:.08;pointer-events:none"/>');
    o.push('</svg>');
    return o.join('');
  }
  function mountBars(el, cfg) {
    var hh = cfg.height || {}, lastW = 0, cur = -1, kit = (cfg.share && cfg.share.file) || 'bars';
    el.classList.add('agc', 'agc-bars');
    el.innerHTML = '<div class="agc-plot" tabindex="0" role="group"></div><p class="agc-read" aria-live="polite"></p>';
    var plot = el.querySelector('.agc-plot'), read = el.querySelector('.agc-read'), n = cfg.groups.length, g = null;
    var fit = function () { plot.style.height = (el.clientWidth < 520 ? hh.phone || 200 : hh.wide || 250) + 'px'; };
    fit();
    function say(i) {
      var hl = plot.querySelector('.agc-hl'); cur = i;
      if (i < 0) { read.textContent = cfg.groups[n - 1].text || ''; if (hl) hl.setAttribute('visibility', 'hidden'); return; }
      read.textContent = cfg.groups[i].text || '';
      if (hl && g) { hl.setAttribute('x', f1(g.cx(i) - g.cw / 2)); hl.setAttribute('visibility', 'visible'); }
    }
    function draw(force) {
      var W = Math.round(plot.clientWidth); if (!W || (W === lastW && !force)) return; lastW = W; fit();
      var H = W < 520 ? hh.phone || 200 : hh.wide || 250, fs = W < 520 ? 12.5 : 13, st = cfg.story ? cfg.story() : {};
      if (cfg.headEl) cfg.headEl.textContent = st.head || '';
      if (cfg.takeEl) cfg.takeEl.textContent = st.take || '';
      g = barsGeom(cfg, W, H, fs);
      plot.innerHTML = barsSvg({ groups: cfg.groups, steps: cfg.steps, fmt: cfg.fmt, topUnit: cfg.topUnit, vfmt: cfg.vfmt, names: cfg.names, label: st.summary || cfg.label }, W, H, { fs: fs });
      plot.setAttribute('aria-label', (st.summary || cfg.label || '') + ' Use the arrow keys to read each month.');
      say(cur);
    }
    var at = function (e) { var r = plot.getBoundingClientRect(); return Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left - g.pl) / g.cw))); };
    plot.addEventListener('pointermove', function (e) { if (g && e.clientX - plot.getBoundingClientRect().left >= g.pl) say(at(e)); });
    plot.addEventListener('pointerdown', function (e) { if (g) say(at(e)); });
    plot.addEventListener('pointerleave', function () { if (el.ownerDocument.activeElement !== plot) say(-1); });
    plot.addEventListener('blur', function () { say(-1); });
    plot.addEventListener('focus', function () { say(cur >= 0 ? cur : n - 1); });
    plot.addEventListener('keydown', function (e) {
      var j = e.key === 'ArrowLeft' ? (cur < 0 ? n - 1 : cur) - 1 : e.key === 'ArrowRight' ? (cur < 0 ? n - 1 : cur) + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
      if (e.key === 'Escape') { say(-1); return; }
      if (j == null) return;
      e.preventDefault(); say(Math.max(0, Math.min(n - 1, j)));
    });
    draw();
    if (root.ResizeObserver) new root.ResizeObserver(function () { draw(); }).observe(plot); else root.addEventListener('resize', function () { draw(); });
    cfg.svgFor = function (W, H) { return barsSvg(cfg, W, H, { fs: 22, card: true }); };
    if (cfg.tools && cfg.share) tools(cfg, function () { return { to: cfg.share.date }; });
    return { redraw: function () { draw(true); } };
  }

  K.mountBars = mountBars; K.barsSvg = barsSvg; K.barsGeom = barsGeom;
})(typeof window !== 'undefined' ? window : globalThis);
