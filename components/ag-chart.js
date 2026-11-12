/* components/ag-chart.js: the shared chart kit (Nov 11, 2026). Every chart on the site meets one bar:
   a headline computed from the data, lines named at their right end with the latest value, labelled
   axes and dates, every report day marked, missing days shown as missing, a hover / tap readout, a
   Share button and a save-the-picture card that stands alone, keyboard and screen reader use, reduced
   motion respected, a reserved height. Plain SVG and JS, no library. Styles: components/ag-chart.css.

   AgChart.mount(el, cfg) draws into el (an empty element) and returns { redraw, state }.
   cfg:
     series   [{ key, name, points: [{ d: 'YYYY-MM-DD', v: number }], color: CSS colour for the page,
                 card: colour for the picture, faint: true (dashed, muted, drawn under, keyed on the top
                 row), note: the faint line's key text, pending: text shown on the top row while a faint
                 line has no points yet (pendingShort for narrow charts), toggle: false (no hide/show) }]
     bands    [{ a: key, b: key, color, card, opacity, cardOpacity,
                 end(p), start(p): label text for the band's last and first shared day,
                 p = { d, a, b, v: a minus b } }]   the shaded area between two series (not across missing days)
     gaps     what counts as missing days between two points: 'weekdays' (a weekday with no point, for
              daily reports), a number of calendar days (a longer step is a gap), or left out: each series
              is read on its own normal spacing (a weekday report without weekends as 'weekdays', else a step
              past 1.5 times its usual one). A gap is drawn dashed and lighter, the band breaks there, and
              the readout says "No report ...".
     fmt      v -> text for values (default '$' + 2 decimals); tick(v) -> axis text (default '$' + v)
     unit     axis unit, top left ('$/cwt')
     ranges   [{ label: '3M', days: 92, aria: 'three months' }], days 0 = all held; a button shows only
              when the held days run past it and leave minPoints in it; 'All' always
     range    the label to open on (falls back to the longest shown)
     minPoints  fewest points a drawn series needs (5)
     story(view) -> { head, take, summary }  from the range shown; view = { series, from, to, days }
              head and take go into cfg.headEl / cfg.takeEl, summary is the SVG's aria-label
     readout(view, day) -> text for the readout line (default: each series' value that day)
     height   { phone: 200, wide: 280 }   reserved in CSS too (ag-chart.css), so nothing shifts
     tools    element for the buttons (optional): Share (the picture and the link together, where the
              device can share files), else Copy link; and Save the picture
     share    { url, title, file: 'name.png', kicker: card top line, source: card foot line,
                date: 'YYYY-MM-DD' shown on the card }
   Labels (line names, band labels) are placed so none overlaps a line, a point, another label or the
   axes: first where they belong, then nudged up or down inside the plot, else set outside the plot on
   the right (the plot narrows to make room).
   AgChart.svg(view, W, H, opt), AgChart.card(cfg, view, done(blob)) draw; AgChart.layout(...) returns
   the placed label boxes and the drawn segments and points (the tests check overlaps on it);
   AgChart.slice, pairs, ranges, gapAt, ruleOf, fitLines are the helpers the tests use.
   Exports window.AgChart (and module.exports). */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var FONT = 'Inter, system-ui, -apple-system, Segoe UI, sans-serif';
  var PAGE = { ink: 'var(--text)', dim: 'var(--text-dim)', mut: 'var(--text-muted)', grid: 'var(--border)', surf: 'var(--surface)' };
  var CARD = { ink: '#e9edeb', dim: 'rgba(233,237,235,.78)', mut: 'rgba(233,237,235,.55)', grid: 'rgba(233,237,235,.13)', surf: '#0a0c0d' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function utc(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return Date.UTC(+m[1], +m[2] - 1, +m[3]); }
  function isoOf(t) { return new Date(t).toISOString().slice(0, 10); }
  function short(s) { return MON[+s.slice(5, 7) - 1] + ' ' + (+s.slice(8, 10)); }
  function long(s) { return short(s) + ', ' + s.slice(0, 4); }
  function money(v) { return '$' + v.toFixed(2); }
  function fmtOf(cfg) { return cfg.fmt || money; }
  function f1(v) { return v.toFixed(1); }

  /* ------------------------------------------------------------ data */
  function lastDay(cfg) { var t = ''; cfg.series.forEach(function (s) { if (!s.faint && s.points.length) t = s.points[s.points.length - 1].d > t ? s.points[s.points.length - 1].d : t; }); return t; }
  function slice(cfg, days) {
    var to = lastDay(cfg), cut = days ? isoOf(utc(to) - days * 864e5) : '', min = cfg.minPoints || 5;
    var series = cfg.series.map(function (s) {
      var pts = s.points.filter(function (p) { return p.d > cut && p.d <= to; });
      return Object.assign({}, s, { points: pts.length >= min ? pts : [] });
    });
    var from = to;
    series.forEach(function (s) { if (!s.faint && s.points.length && s.points[0].d < from) from = s.points[0].d; });
    return { series: series, from: from, to: to, days: days };
  }
  function ser(view, key) { return view.series.filter(function (s) { return s.key === key; })[0]; }
  /* missing days between two report days: the first and last missing day, or null */
  function missing(a, b, rule) {
    var t0 = utc(a), t1 = utc(b);
    if (typeof rule === 'number') return (t1 - t0) / 864e5 > rule ? [isoOf(t0 + 864e5), isoOf(t1 - 864e5)] : null;
    var first = null, last = null;
    for (var t = t0 + 864e5; t < t1; t += 864e5) { var w = new Date(t).getUTCDay(); if (w && w !== 6) { first = first || isoOf(t); last = isoOf(t); } }
    return first ? [first, last] : null;
  }
  /* the gap rule for one series: cfg.gaps, else its own normal spacing */
  function ruleOf(cfg, pts) {
    if (cfg.gaps) return cfg.gaps;
    var st = [], wk = false;
    for (var i = 0; i < pts.length; i++) {
      var w = new Date(utc(pts[i].d)).getUTCDay(); if (!w || w === 6) wk = true;
      if (i) st.push((utc(pts[i].d) - utc(pts[i - 1].d)) / 864e5);
    }
    if (!st.length) return 'weekdays';
    st.sort(function (a, b) { return a - b; });
    var med = st[Math.floor(st.length / 2)];
    return med <= 1 && !wk ? 'weekdays' : Math.max(1, Math.floor(med * 1.5));
  }
  function gapAt(cfg, pts, d) {
    for (var i = 1; i < pts.length; i++) {
      if (pts[i - 1].d < d && d < pts[i].d) { var m = missing(pts[i - 1].d, pts[i].d, ruleOf(cfg, pts)); return m ? { from: m[0], to: m[1] } : null; }
    }
    return null;
  }
  function pairs(view, band) {
    var A = ser(view, band.a), B = ser(view, band.b); if (!A || !B) return [];
    var m = {}; B.points.forEach(function (p) { m[p.d] = p.v; });
    return A.points.filter(function (p) { return m[p.d] != null; }).map(function (p) { return { d: p.d, a: p.v, b: m[p.d], v: p.v - m[p.d] }; });
  }
  function ranges(cfg) {
    var all = slice(cfg, 0), span = (utc(all.to) - utc(all.from)) / 864e5, out = [];
    (cfg.ranges || []).forEach(function (r) {
      if (!r.days) return;
      if (span > r.days && slice(cfg, r.days).series.some(function (s) { return !s.faint && s.points.length; })) out.push(r);
    });
    out.push((cfg.ranges || []).filter(function (r) { return !r.days; })[0] || { label: 'All', days: 0, aria: 'all days held' });
    return out;
  }
  function near(pts, d) { var b = null; pts.forEach(function (p) { if (!b || Math.abs(utc(p.d) - utc(d)) < Math.abs(utc(b.d) - utc(d))) b = p; }); return b; }
  function readout(cfg, view, d) {
    var main = view.series.filter(function (s) { return !s.faint && s.points.length; });
    var gp = main.length && gapAt(cfg, main[0].points, d);
    if (gp) return 'No report ' + short(gp.from) + (gp.to !== gp.from ? ' to ' + short(gp.to) : '');
    if (cfg.readout) return cfg.readout(view, d);
    var p0 = near(main[0].points, d);
    return short(p0.d) + ': ' + main.map(function (s) { var p = near(s.points, p0.d); return p && p.d === p0.d ? s.name + ' ' + fmtOf(cfg)(p.v) : ''; }).filter(Boolean).join(' · ');
  }

  /* ------------------------------------------------------------ geometry and label placement */
  function ticks(lo, hi, n) {
    var raw = (hi - lo || 1) / n, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), st = mag;
    [1, 2, 2.5, 5, 10].some(function (m) { st = m * mag; return st >= raw; });
    var out = []; for (var t = Math.ceil(lo / st) * st; t <= hi + 1e-9; t += st) out.push(+t.toFixed(6));
    return out;
  }
  function geom(view, W, H, fs, hide, gutter) {
    var all = [];
    view.series.forEach(function (s) { if (!hide[s.key]) s.points.forEach(function (p) { all.push(p.v); }); });
    if (!all.length) view.series.forEach(function (s) { s.points.forEach(function (p) { all.push(p.v); }); });
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), pad = Math.max((hi - lo) * 0.03, 0.25);
    lo -= pad; hi += pad;
    var nt = W / fs < 40 ? 4 : 5, tk = ticks(lo, hi, nt), st = tk.length > 1 ? tk[1] - tk[0] : 1;   // the axis runs to a tick at both ends
    lo = Math.min(lo, Math.floor(lo / st) * st); hi = Math.max(hi, Math.ceil(hi / st) * st);
    var L = Math.round(fs * (W < 420 ? 3.4 : 3.9)), R = Math.round(fs * 0.8) + (gutter || 0), T = Math.round(fs * 3), B = Math.round(fs * 2.2), lab = Math.round(fs * 1.4);
    var t0 = utc(view.from), dt = Math.max(utc(view.to) - t0, 864e5);
    return { L: L, R: R, T: T, B: B, W: W, H: H, fs: fs, lo: lo, hi: hi, nt: nt, base: H - B - fs * 0.6, right: W - R,
      x: function (d) { return L + (utc(d) - t0) / dt * (W - L - R); },
      y: function (v) { return T + (hi - v) / (hi - lo) * (H - T - B - lab); },
      day: function (px) { return isoOf(t0 + Math.round((px - L) / (W - L - R) * dt / 864e5) * 864e5); } };
  }
  function widthOf(s, fs, bold) { return String(s).length * fs * (bold ? 0.6 : 0.56); }
  /* the box of a text drawn at baseline y, anchored at x */
  function boxOf(x, y, w, fs, anchor) { var x0 = anchor === 'end' ? x - w : x; return { x0: x0 - 2, x1: x0 + w + 2, y0: y - fs * 0.95, y1: y + fs * 0.3 }; }
  function hitBox(a, b) { return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1; }
  function hitSeg(b, s) {
    var xa = Math.max(b.x0, Math.min(s.x1, s.x2)), xb = Math.min(b.x1, Math.max(s.x1, s.x2));
    if (xa > xb) return false;
    if (s.x1 === s.x2) return Math.max(s.y1, s.y2) > b.y0 && Math.min(s.y1, s.y2) < b.y1;
    var k = (s.y2 - s.y1) / (s.x2 - s.x1), ya = s.y1 + (xa - s.x1) * k, yb = s.y1 + (xb - s.x1) * k;
    return Math.max(ya, yb) > b.y0 && Math.min(ya, yb) < b.y1;
  }
  /* everything drawn, then the labels in order of importance; returns null when a label fits nowhere
     inside and the caller should leave a gutter on the right */
  function layout(view, W, H, opt) {
    var fs = opt.fs || 12, hide = opt.hide || {}, cfg = opt.cfg || {}, fmt = fmtOf(cfg), rules = {};
    var gutter = opt.gutter || 0, g = geom(view, W, H, fs, hide, gutter), segs = [], dots = [], runs = [], boxes = [], labels = [], out = [];
    view.series.forEach(function (s) {
      if (!s.points.length || hide[s.key]) return;
      var pts = s.points.map(function (p) { return { d: p.d, v: p.v, x: g.x(p.d), y: g.y(p.v) }; });
      var run = [pts[0]], rule = rules[s.key] = ruleOf(cfg, s.points);
      for (var i = 1; i < pts.length; i++) {
        var gap = !s.faint && missing(pts[i - 1].d, pts[i].d, rule);
        segs.push({ x1: pts[i - 1].x, y1: pts[i - 1].y, x2: pts[i].x, y2: pts[i].y, key: s.key, gap: !!gap });
        if (gap) { runs.push({ s: s, pts: run }); runs.push({ s: s, pts: [pts[i - 1], pts[i]], gap: true }); run = [pts[i]]; } else run.push(pts[i]);
      }
      runs.push({ s: s, pts: run });
      if (!s.faint) pts.forEach(function (p, j) { var r = j === pts.length - 1 ? fs / 3 + 1 : Math.max(1.6, fs / 6); dots.push({ x: p.x, y: p.y, r: r, s: s, last: j === pts.length - 1 }); });
    });
    var bound = function (b, outside) {
      return b.y0 >= fs * 1.6 && b.y1 <= g.base - 1 && (outside ? b.x0 >= g.right + 2 && b.x1 <= W : b.x0 >= g.L + 2 && b.x1 <= g.right);
    };
    var free = function (b, outside) {
      if (!bound(b, outside)) return false;
      for (var i = 0; i < boxes.length; i++) if (hitBox(b, boxes[i])) return false;
      if (outside) return true;
      for (var j = 0; j < segs.length; j++) if (hitSeg(b, segs[j])) return false;
      for (var k = 0; k < dots.length; k++) { var d = dots[k]; if (hitBox(b, { x0: d.x - d.r - 1, x1: d.x + d.r + 1, y0: d.y - d.r - 1, y1: d.y + d.r + 1 })) return false; }
      return true;
    };
    var failed = [];
    var place = function (L) {
      var w = widthOf(L.text, fs, L.bold), step = fs * 0.35, span = g.base - g.T + fs * 2;
      var win = L.win || [L.y - fs * 3, L.y + fs * 3];   // stay near what it names; else go outside
      for (var n = 0; n * step < span; n++) {
        for (var sgn = n ? -1 : 1; sgn <= 1; sgn += 2) {
          var y = L.y + sgn * n * step, b = boxOf(L.x, y, w, fs, L.anchor);
          if (y < win[0] || y > win[1]) continue;
          if (free(b)) { boxes.push(b); out.push(Object.assign({}, L, { x: L.x, y: y, box: b })); return; }
        }
      }
      if (L.optional) return;   // says the same as text elsewhere (the takeaway): left out rather than misplaced
      if (!gutter) { failed.push(L); return; }
      var ox = g.right + fs * 0.6;
      for (var m = 0; m * step < span; m++) {
        for (var sg = m ? -1 : 1; sg <= 1; sg += 2) {
          var oy = L.y + sg * m * step, ob = boxOf(ox, oy, w, fs, 'start');
          if (free(ob, true)) { boxes.push(ob); out.push(Object.assign({}, L, { x: ox, y: oy, anchor: 'start', box: ob, outside: true })); return; }
        }
      }
      failed.push(L);
    };
    var ex = g.x(view.to) - fs * 0.8;
    var main = view.series.filter(function (s) { return !s.faint && s.points.length; });
    main.filter(function (s) { return !hide[s.key]; }).map(function (s) { return { s: s, v: s.points[s.points.length - 1].v }; })
      .sort(function (a, b) { return b.v - a.v; }).forEach(function (e, i) {
        var y = i === 0 ? g.y(e.v) - fs * 0.6 : g.y(e.v) + fs * 1.3;
        labels.push({ kind: 'end', s: e.s, text: e.s.name + ' ' + fmt(e.v), x: ex, y: y, anchor: 'end', bold: true });
      });
    (cfg.bands || []).forEach(function (b) {
      if (hide[b.a] || hide[b.b]) return;
      var pp = pairs(view, b); if (pp.length < 2) return;
      var e = pp[pp.length - 1], s0 = pp[0];
      // a band label stays between (or right by) the two lines it measures
      var win = function (p) { var y1 = Math.min(g.y(p.a), g.y(p.b)), y2 = Math.max(g.y(p.a), g.y(p.b)); return [y1 - fs * 0.6, y2 + fs * 1.6]; };
      if (b.end) labels.push({ kind: 'band', text: b.end(e), x: ex, y: (g.y(e.a) + g.y(e.b)) / 2 + fs * 0.35, anchor: 'end', bold: true, win: win(e) });
      if (b.start) labels.push({ kind: 'band', text: b.start(s0), x: g.x(s0.d) + fs * 0.6, y: (g.y(s0.a) + g.y(s0.b)) / 2 + fs * 0.35, anchor: 'start', win: win(s0), optional: true });
    });
    // a hidden line keeps its name on the plot, near the top, so it can come back
    main.filter(function (s) { return hide[s.key]; }).forEach(function (s) {
      labels.push({ kind: 'end', off: true, s: s, text: s.name + ' ' + fmt(s.points[s.points.length - 1].v), x: g.right, y: g.T + fs * 0.3, anchor: 'end', bold: true, win: [0, g.base] });
    });
    labels.forEach(place);
    if (failed.length && !gutter) {
      var wide = Math.max.apply(null, failed.map(function (L) { return widthOf(L.text, fs, L.bold); }));
      return layout(view, W, H, Object.assign({}, opt, { gutter: Math.min(Math.round(wide + fs * 1.4), Math.round(W * 0.4)) }));
    }
    return { g: g, segs: segs, dots: dots, runs: runs, labels: out, boxes: boxes, rules: rules };
  }

  /* ------------------------------------------------------------ the SVG */
  function txt(x, y, s, st, anchor, cls) { return '<text' + (cls ? ' class="' + cls + '"' : '') + ' x="' + f1(x) + '" y="' + f1(y) + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + ' style="' + st + '">' + esc(s) + '</text>'; }
  function poly(pts) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + f1(p.x) + ' ' + f1(p.y); }).join(''); }

  /* opt: { fs, hide: {key: true}, card: true (literal colours), hover: true, label, cfg } */
  function svg(view, W, H, opt) {
    var fs = opt.fs || 12, hide = opt.hide || {}, P = opt.card ? CARD : PAGE, cfg = opt.cfg || {};
    var col = function (s) { return opt.card ? s.card || s.color : s.color; };
    var lay = layout(view, W, H, opt), g = lay.g, f = 'font-size:' + fs + 'px;font-family:' + FONT + ';', fb = f + 'font-weight:700;', o = [];
    var halo = 'paint-order:stroke;stroke:' + P.surf + ';stroke-width:' + (fs / 3.5).toFixed(1) + 'px;stroke-linejoin:round;';
    o.push('<svg xmlns="http://www.w3.org/2000/svg" class="agc-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '"' + (opt.label ? ' role="img" aria-label="' + esc(opt.label) + '"' : '') + '>');
    o.push(txt(g.L - fs * 0.5, fs * 1.2, cfg.unit || '', f + 'fill:' + P.mut, 'end'));
    ticks(g.lo, g.hi, g.nt).forEach(function (v) {
      var y = g.y(v);
      o.push('<line x1="' + g.L + '" x2="' + f1(g.right) + '" y1="' + f1(y) + '" y2="' + f1(y) + '" style="stroke:' + P.grid + ';stroke-width:1"/>');
      o.push(txt(g.L - fs * 0.5, y + fs * 0.35, cfg.tick ? cfg.tick(v) : '$' + (v % 1 ? v.toFixed(1) : v), f + 'fill:' + P.dim, 'end'));
    });
    o.push('<line x1="' + g.L + '" x2="' + f1(g.right) + '" y1="' + f1(g.base) + '" y2="' + f1(g.base) + '" style="stroke:' + P.mut + ';stroke-width:1"/>');
    var days = Math.round((utc(view.to) - utc(view.from)) / 864e5), want = Math.min(days + 1, (g.right - g.L) / fs < 34 ? 3 : 6), dts = [];
    for (var i = 0; i < want; i++) dts.push(isoOf(utc(view.from) + Math.round(i * days / Math.max(1, want - 1)) * 864e5));
    dts.forEach(function (d, j) { var x = g.x(d); o.push(txt(x, H - fs * 0.5, short(d), f + 'fill:' + P.dim, j === dts.length - 1 ? 'end' : (x - g.L < fs * 2 ? 'start' : 'middle'))); });
    // the top row, right: a faint line's key, or the note that it is not held yet
    var kx = g.right;
    view.series.filter(function (s) { return s.faint && (s.note || s.pending); }).forEach(function (s) {
      var on = s.points.length && !hide[s.key], t = on ? s.note : s.pending; if (!t) return;
      var room = g.right - g.L - (on ? fs * 2.5 : fs * 0.5), ks = on ? fs : fs * 0.9;
      if (widthOf(t, ks) > room && !on && s.pendingShort) t = s.pendingShort;
      ks = Math.max(Math.min(ks, room / (String(t).length * 0.56)), 9.5);
      var kw = widthOf(t, ks);
      if (on) o.push('<line x1="' + f1(kx - kw - fs * 2) + '" x2="' + f1(kx - kw - fs * 0.6) + '" y1="' + f1(fs * 0.85) + '" y2="' + f1(fs * 0.85) + '" style="stroke:' + P.mut + ';stroke-width:2;stroke-dasharray:' + fs / 3 + ' ' + fs / 4 + '"/>');
      o.push(txt(kx, fs * 1.2, t, 'font-size:' + ks.toFixed(1) + 'px;font-family:' + FONT + ';fill:' + (on ? P.dim : P.mut) + (on ? '' : ';font-style:italic'), 'end', on ? '' : 'agc-pending'));
    });
    // bands: one polygon per stretch with no missing days
    (cfg.bands || []).forEach(function (b) {
      if (hide[b.a] || hide[b.b]) return;
      var pp = pairs(view, b), parts = [], cur = [], rule = lay.rules[b.a] || ruleOf(cfg, pp);
      pp.forEach(function (p, k) { if (k && missing(pp[k - 1].d, p.d, rule)) { parts.push(cur); cur = []; } cur.push(p); });
      parts.push(cur);
      parts.forEach(function (pt) {
        if (pt.length < 2) return;
        var top = pt.map(function (p) { return f1(g.x(p.d)) + ',' + f1(g.y(p.a)); }), bot = pt.slice().reverse().map(function (p) { return f1(g.x(p.d)) + ',' + f1(g.y(p.b)); });
        o.push('<polygon class="agc-band" points="' + top.concat(bot).join(' ') + '" style="fill:' + (opt.card ? b.card || (ser(view, b.a) || {}).card || '#5ea4ea' : b.color) + ';fill-opacity:' + (opt.card ? b.cardOpacity || 0.26 : b.opacity || 0.2) + '"/>');
      });
    });
    var lw = Math.max(2, fs / 6);
    lay.runs.filter(function (r) { return r.s.faint; }).concat(lay.runs.filter(function (r) { return !r.s.faint; })).forEach(function (r) {
      if (r.pts.length < 2) return;
      var st = r.s.faint ? 'stroke:' + P.mut + ';stroke-width:' + Math.max(1.5, fs / 8) + ';stroke-dasharray:' + fs / 3 + ' ' + fs / 3
        : r.gap ? 'stroke:' + col(r.s) + ';stroke-width:' + Math.max(1.5, lw * 0.75) + ';stroke-opacity:.5;stroke-dasharray:' + fs / 4 + ' ' + fs / 3
          : 'stroke:' + col(r.s) + ';stroke-width:' + lw + ';stroke-linejoin:round;stroke-linecap:round';
      o.push('<path class="agc-ln' + (r.gap ? ' agc-gap' : '') + '" d="' + poly(r.pts) + '" style="fill:none;' + st + '"/>');
    });
    lay.dots.forEach(function (d) { o.push('<circle class="agc-dot" cx="' + f1(d.x) + '" cy="' + f1(d.y) + '" r="' + f1(d.r) + '" style="fill:' + col(d.s) + (d.last ? ';stroke:' + P.surf + ';stroke-width:2' : '') + '"/>'); });
    if (opt.hover) {
      o.push('<g class="agc-hov" visibility="hidden"><line y1="' + g.T + '" y2="' + f1(g.base) + '" style="stroke:' + P.mut + ';stroke-dasharray:3 3"/>' +
        view.series.filter(function (s) { return !s.faint && s.points.length; }).map(function (s) { return '<circle r="4" data-k="' + esc(s.key) + '" style="fill:' + col(s) + ';stroke:' + P.surf + ';stroke-width:2"/>'; }).join('') + '</g>');
      o.push('<rect class="agc-hit" x="' + g.L + '" y="' + g.T + '" width="' + f1(Math.max(0, g.right - g.L)) + '" height="' + f1(g.base - g.T) + '" fill="transparent"/>');
    }
    lay.labels.forEach(function (L) {
      if (L.kind === 'band') { o.push(txt(L.x, L.y, L.text, (L.bold ? fb : f) + halo + 'fill:' + P.ink, L.anchor, 'agc-bl')); return; }
      var off = !!L.off, tog = L.s.toggle !== false && !opt.card, b = L.box;
      o.push('<g class="agc-tog"' + (tog ? ' data-k="' + esc(L.s.key) + '" tabindex="0" role="button" aria-pressed="' + !off + '" aria-label="' + (off ? 'Show ' : 'Hide ') + esc(L.text) + '"' : '') + '>' +
        (tog ? '<rect x="' + f1(b.x0) + '" y="' + f1(b.y0) + '" width="' + f1(b.x1 - b.x0) + '" height="' + f1(b.y1 - b.y0) + '" fill="transparent"/>' : '') +
        txt(L.x, L.y, L.text, fb + halo + 'fill:' + col(L.s) + (off ? ';opacity:.5;text-decoration:line-through' : ''), L.anchor) + '</g>');
    });
    o.push('</svg>');
    return o.join('');
  }

  /* ------------------------------------------------------------ the picture: exactly 1200 x 630 */
  /* the largest size in sizes at which text wraps into maxLines within maxW; the last line is cut
     with an ellipsis when even the smallest size does not fit. measure(text, size) -> px */
  function fitLines(measure, text, maxW, sizes, maxLines) {
    var lines = [];
    for (var i = 0; i < sizes.length; i++) {
      lines = []; var cur = '';
      String(text || '').split(' ').forEach(function (w) { var x = cur ? cur + ' ' + w : w; if (measure(x, sizes[i]) > maxW && cur) { lines.push(cur); cur = w; } else cur = x; });
      if (cur) lines.push(cur);
      if (lines.length <= maxLines && lines.every(function (l) { return measure(l, sizes[i]) <= maxW; })) return { size: sizes[i], lines: lines };
    }
    var sz = sizes[sizes.length - 1], keep = lines.slice(0, maxLines), last = keep[keep.length - 1] || '';
    while (last && measure(last + '…', sz) > maxW) last = last.replace(/\s*\S+$/, '');
    keep[keep.length - 1] = last + '…';
    return { size: sz, lines: keep, cut: true };
  }
  function card(cfg, view, done) {
    var D = root.document, W = 1200, H = 630, c = D.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d'); if (!x || !root.Image) { done(null); return; }
    var st = cfg.story ? cfg.story(view) : {}, sh = cfg.share || {};
    var meas = function (wt) { return function (s, size) { x.font = wt + ' ' + size + 'px ' + FONT; return x.measureText(s).width; }; };
    x.fillStyle = '#0a0c0d'; x.fillRect(0, 0, W, H); x.fillStyle = '#d4a23f'; x.fillRect(0, 0, W, 10);
    x.font = '800 34px ' + FONT; x.fillStyle = '#e9edeb'; x.fillText('agsist', 48, 62);
    var aw = x.measureText('agsist').width; x.font = '700 20px ' + FONT; x.fillStyle = '#d4a23f'; x.fillText('.com', 50 + aw, 62);
    var mark = 50 + aw + x.measureText('.com').width + 32;
    var k = fitLines(meas('600'), (sh.kicker ? sh.kicker + ' · ' : '') + long(sh.date || view.to), W - 48 - mark, [20, 18, 16], 1);
    x.font = '600 ' + k.size + 'px ' + FONT; x.fillStyle = 'rgba(233,237,235,.72)'; x.textAlign = 'right'; x.fillText(k.lines[0], W - 48, 60); x.textAlign = 'left';
    var hd = fitLines(meas('800'), st.head, W - 96, [38, 34, 30, 27], 2), y = 80 + hd.size;
    x.font = '800 ' + hd.size + 'px ' + FONT; x.fillStyle = '#e9edeb';
    hd.lines.forEach(function (l) { x.fillText(l, 48, y); y += hd.size * 1.2; });
    if (st.take) {
      var tk = fitLines(meas('400'), st.take, W - 96, [25, 22, 20], 1);
      x.font = '400 ' + tk.size + 'px ' + FONT; x.fillStyle = 'rgba(233,237,235,.86)'; x.fillText(tk.lines[0], 48, y + 2); y += tk.size + 10;
    }
    var src = fitLines(meas('400'), sh.source || '', W - 96, [18, 16, 15], 1), url = fitLines(meas('700'), String(sh.url || '').replace(/^https?:\/\//, ''), W - 96, [20, 18], 1);
    var img = new root.Image();
    img.onload = function () {
      x.drawImage(img, 24, y + 4);
      x.font = '400 ' + src.size + 'px ' + FONT; x.fillStyle = 'rgba(233,237,235,.72)'; x.fillText(src.lines[0], 48, H - 46);
      x.font = '700 ' + url.size + 'px ' + FONT; x.fillStyle = '#d4a23f'; x.fillText(url.lines[0], 48, H - 18);
      c.toBlob(function (b) { done(b); }, 'image/png');
    };
    img.onerror = function () { done(null); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(view, W - 64, Math.max(200, Math.round(H - y - 76)), { fs: 22, card: true, cfg: cfg }));
  }
  function ga(n, kit) { try { if (typeof root.gtag === 'function') root.gtag('event', n, { kit: kit }); } catch (e) {} }

  /* ------------------------------------------------------------ mount */
  function mount(el, cfg) {
    var rs = ranges(cfg), cur = rs.filter(function (r) { return r.label === cfg.range; })[0] || rs[rs.length - 1];
    var hide = {}, lastW = 0, view = null, animated = false, kit = (cfg.share && cfg.share.file) || 'chart';
    var reduce = false; try { reduce = root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    el.classList.add('agc');
    el.innerHTML = (rs.length > 1 ? '<div class="agc-ctl" role="group" aria-label="Range">' + rs.map(function (r) {
      return '<button type="button" class="agc-rg" data-days="' + r.days + '" aria-pressed="' + (r === cur) + '" aria-label="Show ' + esc(r.aria || r.label) + '">' + esc(r.label) + '</button>';
    }).join('') + '</div>' : '') + '<div class="agc-plot"></div><p class="agc-read" aria-live="polite"></p>';
    var plot = el.querySelector('.agc-plot'), read = el.querySelector('.agc-read'), hh = cfg.height || {};
    var fit = function () { plot.style.height = (el.clientWidth < 520 ? hh.phone || 200 : hh.wide || 280) + 'px'; };
    fit();
    var latest = function () { read.textContent = readout(cfg, view, view.to); };
    function draw(force) {
      var W = Math.round(plot.clientWidth); if (!W || (W === lastW && !force)) return; lastW = W;
      fit();
      var H = W < 520 ? hh.phone || 200 : hh.wide || 280, fs = W < 520 ? 12 : 13;
      view = slice(cfg, cur.days);
      var st = cfg.story ? cfg.story(view) : {};
      if (cfg.headEl) cfg.headEl.textContent = st.head || '';
      if (cfg.takeEl) cfg.takeEl.textContent = st.take || '';
      var opt = { fs: fs, hide: hide, hover: true, label: st.summary, cfg: cfg };
      plot.innerHTML = svg(view, W, H, opt);
      latest();
      var g = layout(view, W, H, opt).g, hov = plot.querySelector('.agc-hov'), hit = plot.querySelector('.agc-hit');
      var move = function (ev) {
        var r = plot.getBoundingClientRect(), d = g.day((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left);
        var main = view.series.filter(function (s) { return !s.faint && s.points.length; });
        if (gapAt(cfg, main[0].points, d)) { hov.setAttribute('visibility', 'hidden'); read.textContent = readout(cfg, view, d); return; }
        var p0 = near(main[0].points, d), X = f1(g.x(p0.d));
        hov.firstChild.setAttribute('x1', X); hov.firstChild.setAttribute('x2', X);
        [].slice.call(hov.querySelectorAll('circle')).forEach(function (cEl) {
          var s = ser(view, cEl.getAttribute('data-k')), p = s && near(s.points, p0.d), on = p && p.d === p0.d && !hide[s.key];
          cEl.setAttribute('visibility', on ? 'visible' : 'hidden');
          if (on) { cEl.setAttribute('cx', X); cEl.setAttribute('cy', f1(g.y(p.v))); }
        });
        hov.setAttribute('visibility', 'visible'); read.textContent = readout(cfg, view, p0.d);
      };
      hit.addEventListener('mousemove', move); hit.addEventListener('touchstart', move, { passive: true }); hit.addEventListener('touchmove', move, { passive: true });
      hit.addEventListener('mouseleave', function () { hov.setAttribute('visibility', 'hidden'); latest(); });
      [].slice.call(plot.querySelectorAll('.agc-tog[data-k]')).forEach(function (t) {
        var flip = function () { var k = t.getAttribute('data-k'); hide[k] = !hide[k]; draw(true); var n = plot.querySelector('.agc-tog[data-k="' + k + '"]'); if (n) n.focus(); };
        t.addEventListener('click', flip);
        t.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
      });
      if (!animated && !reduce) {
        animated = true;
        var run = function () {
          plot.classList.add('agc-in');
          [].slice.call(plot.querySelectorAll('.agc-ln')).forEach(function (p) {
            var L = p.getTotalLength ? p.getTotalLength() : 0; if (!L || p.style.strokeDasharray) return;   // dashed lines fade in with the band
            p.style.strokeDasharray = L; p.style.strokeDashoffset = L; p.getBoundingClientRect();
            p.style.transition = 'stroke-dashoffset 1.1s ease-out'; p.style.strokeDashoffset = '0';
            setTimeout(function () { p.style.transition = p.style.strokeDasharray = p.style.strokeDashoffset = ''; }, 1300);
          });
        };
        plot.classList.add('agc-pre');
        if (root.IntersectionObserver) {
          var io = new root.IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); run(); } }, { threshold: 0.35 });
          io.observe(plot);
        } else run();
      }
    }
    [].slice.call(el.querySelectorAll('.agc-rg')).forEach(function (b, i, all) {
      b.addEventListener('click', function () {
        all.forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
        cur = rs.filter(function (r) { return String(r.days) === b.getAttribute('data-days'); })[0]; draw(true); ga('chart_range', kit);
      });
    });
    draw();
    if (root.ResizeObserver) new root.ResizeObserver(function () { draw(); }).observe(plot); else root.addEventListener('resize', function () { draw(); });
    if (cfg.tools && cfg.share) tools(cfg, function () { return view; });
    return { redraw: function () { draw(true); }, state: function () { return { view: view, hide: hide, range: cur.label }; } };
  }
  function tools(cfg, getView) {
    var T = cfg.tools, sh = cfg.share, nav = root.navigator || {}, canFiles = false, D = T.ownerDocument;
    try { canFiles = !!(nav.share && nav.canShare && root.File && nav.canShare({ files: [new root.File([''], 'x.png', { type: 'image/png' })] })); } catch (e) {}
    T.innerHTML = (canFiles ? '<button type="button" class="agc-btn agc-share">Share</button>' : '<button type="button" class="agc-btn agc-copy">Copy link</button>') +
      '<button type="button" class="agc-btn agc-save">Save the picture</button>';
    var save = function (b) { var a = D.createElement('a'); a.href = URL.createObjectURL(b); a.download = sh.file || 'agsist-chart.png'; D.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); };
    var flash = function (b, t) { var o = b.textContent; b.textContent = t; setTimeout(function () { b.textContent = o; }, 1800); };
    T.querySelector('.agc-save').addEventListener('click', function () { card(cfg, getView(), function (b) { if (b) { save(b); ga('picture_download', sh.file); } }); });
    var cp = T.querySelector('.agc-copy');
    if (cp) cp.addEventListener('click', function () { try { nav.clipboard.writeText(sh.url).then(function () { flash(cp, 'Link copied'); }, function () { flash(cp, sh.url); }); } catch (e) { flash(cp, sh.url); } });
    var sb = T.querySelector('.agc-share');
    if (sb) sb.addEventListener('click', function () {
      ga('share_open', sh.file);
      var v = getView(), st = cfg.story ? cfg.story(v) : {};
      card(cfg, v, function (b) {
        var data = { title: sh.title, text: st.head, url: sh.url };
        try { if (b && canFiles) data.files = [new root.File([b], sh.file || 'agsist-chart.png', { type: 'image/png' })]; } catch (e) {}
        nav.share(data).then(function () { ga('share_done', sh.file); }, function (e) { if (!(e && e.name === 'AbortError') && b) save(b); });
      });
    });
  }

  var api = { mount: mount, svg: svg, layout: layout, card: card, fitLines: fitLines, slice: slice, pairs: pairs, ranges: ranges, readout: readout, gapAt: gapAt, ruleOf: ruleOf,
    short: short, long: long, money: money };
  root.AgChart = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
