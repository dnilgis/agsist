/* components/ag-chart.js: the shared chart kit (Nov 11, 2026). Every chart: a headline from the data, lines named with the
   latest value, labelled axes and dates, missing days shown as missing, a hover / tap readout, Share and a save-the-picture
   card (1200 x 630), keyboard and screen reader use, reduced motion, a reserved height. Plain SVG and JS; styles in
   components/ag-chart.css. AgChart.mount(el, cfg) draws into an empty el, returns { redraw, state }. cfg:
     series   [{ key, name, points: [{ d: 'YYYY-MM-DD', v }], color (page CSS), card (picture colour), dash, faint (dashed,
                 muted; note: its key; pending, pendingShort: shown while it has no points), toggle: false,
                 step (a value holds flat to the next point), until: 'YYYY-MM-DD' (held flat to it), startText(p), endText(p) }]
              a point may carry b: 'YYYY-MM-DD' (nothing held from that day to it: a gap) and m: true (a thin mark)
     bands    [{ a: key, b: key, color, card, opacity, cardOpacity, end(p), start(p) }]  shaded between two series
     gaps     missing days: 'weekdays', a number of calendar days, or each series by its own spacing; a gap is dashed
              and lighter. gapLabel({ from, to }), gapKey(view): the key on the top row; gapNote: the same under a step gap
     fmt, tick(v, step), unit, axisTitle (top left), pad (least room above and below); period 'year' (one point a year,
              'YYYY-01-01'), gapWord; ranges [{ label, days, aria }] (days 0 = all), range, minPoints (5)
     story(view, forCard) -> { head, take, summary, note }; readout(view, day); ownGaps (the readout names missing
              days); height { phone, wide }; tools; share { url, title, file, kicker, source, date or dateText }; foot (or foot(view))
     legend   several named lines, nothing labelled inside the plot (E53). From 720 px and on the picture the names
              wrap in a right gutter beside each line's end (colour and dash tell them apart; end dots that touch sit in a
              row to the right, each joined to its line); under 720 px a key below the plot has one 44 px row each. One
              line is named in the plot. valueAt, intTicks, fixedTicks, weekly (Monday ticks), clip (a stray stretch in
              a marked break; clipMin), markLabel(p, s), markMany
   Also AgChart.svg, card, layout, slice, pairs, ranges, gapAt, ruleOf, fitLines. Exports window.AgChart and module.exports. */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var FONT = 'Inter, system-ui, -apple-system, Segoe UI, sans-serif';
  var PAGE = { ink: 'var(--text)', dim: 'var(--text-dim)', mut: 'var(--text-muted)', grid: 'var(--border)', surf: 'var(--surface)' };
  var CARD = { ink: '#e9edeb', dim: 'rgba(233,237,235,.78)', mut: 'rgba(233,237,235,.55)', grid: 'rgba(233,237,235,.13)', surf: '#0a0c0d' };

  var HY = false;   // set per chart: a legend chart prints true hyphens
  function hy(s) { return String(s).replace(/(\w)-(?=\w)/g, '$1\u2010'); }   // the true hyphen: Inter's hyphen-minus sits wide and spaced
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function utc(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return Date.UTC(+m[1], +m[2] - 1, +m[3]); }
  function isoOf(t) { return new Date(t).toISOString().slice(0, 10); }
  function short(s) { return MON[+s.slice(5, 7) - 1] + ' ' + (+s.slice(8, 10)); }
  function long(s) { return short(s) + ', ' + s.slice(0, 4); }
  function dayOf(cfg, s) { return cfg && cfg.period === 'year' ? s.slice(0, 4) : short(s); }
  function money(v) { return '$' + v.toFixed(2); }
  function fmtOf(cfg) { return cfg.fmt || money; }
  function f1(v) { return v.toFixed(1); }

  function lastDay(cfg) { var t = ''; cfg.series.forEach(function (s) { if (!s.faint && s.points.length) { var e = s.until || s.points[s.points.length - 1].d; if (e > t) t = e; } }); return t; }
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
  function missing(a, b, rule) {
    var t0 = utc(a), t1 = utc(b);
    if (typeof rule === 'number') return (t1 - t0) / 864e5 > rule ? [isoOf(t0 + 864e5), isoOf(t1 - 864e5)] : null;
    var first = null, last = null;
    for (var t = t0 + 864e5; t < t1; t += 864e5) { var w = new Date(t).getUTCDay(); if (w && w !== 6) { first = first || isoOf(t); last = isoOf(t); } }
    return first ? [first, last] : null;
  }
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
      if (pts[i - 1].d < d && d < pts[i].d) {
        if (pts[i].b) return d >= pts[i].b ? { from: pts[i].b, to: isoOf(utc(pts[i].d) - 864e5) } : null;
        var m = missing(pts[i - 1].d, pts[i].d, ruleOf(cfg, pts)); if (!m) return null;
        if (cfg.period === 'year') { var y0 = +pts[i - 1].d.slice(0, 4) + 1, y1 = +pts[i].d.slice(0, 4) - 1; return y1 < y0 ? null : { from: y0 + '-01-01', to: y1 + '-01-01' }; }
        return { from: m[0], to: m[1] };
      }
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
    var gp = main.length && !cfg.ownGaps && gapAt(cfg, main[0].points, d);
    if (gp) return 'No ' + (cfg.gapWord || 'report') + ' ' + dayOf(cfg, gp.from) + (gp.to !== gp.from ? ' to ' + dayOf(cfg, gp.to) : '');
    if (cfg.readout) return cfg.readout(view, d);
    var p0 = near(main[0].points, d);
    return dayOf(cfg, p0.d) + ': ' + main.map(function (s) { var p = near(s.points, p0.d); return p && p.d === p0.d ? s.name + ' ' + fmtOf(cfg)(p.v) : ''; }).filter(Boolean).join(' · ');
  }

  function ticks(lo, hi, n, whole) {
    var raw = (hi - lo || 1) / n, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), st = mag;
    (whole ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]).some(function (m) { st = m * mag; return st >= raw; });
    var out = []; for (var t = Math.ceil(lo / st) * st; t <= hi + 1e-9; t += st) out.push(+t.toFixed(6));
    return out;
  }
  function clipOf(view, hide, cfg) {
    if (!cfg.clip) return null;
    var vals = [], days = [];
    view.series.forEach(function (s) {
      if (s.faint || hide[s.key] || !s.points.length) return;
      var pts = s.points, end = s.until && s.until > pts[pts.length - 1].d ? s.until : pts[pts.length - 1].d, j = 0;
      for (var t = utc(pts[0].d); t <= utc(end); t += 864e5) {
        var d = isoOf(t); while (j + 1 < pts.length && pts[j + 1].d <= d) j++;
        vals.push(pts[j].v); days.push({ d: d, v: pts[j].v, k: s.key });
      }
    });
    if (vals.length < 8) return null;
    var sorted = vals.slice().sort(function (a, b) { return a - b; }), q = function (f) { return sorted[Math.floor(f * (sorted.length - 1))]; };
    var q1 = q(0.25), q3 = q(0.75), iqr = Math.max(q3 - q1, cfg.clipMin || 10), lf = q1 - 3 * iqr, hf = q3 + 3 * iqr;
    var inn = vals.filter(function (v) { return v >= lf && v <= hf; });
    if (inn.length === vals.length || !inn.length) return null;
    var lo = Math.min.apply(null, inn), hi = Math.max.apply(null, inn), ranges = [], cur = null;
    days.forEach(function (x) {
      var out = x.v < lo || x.v > hi;
      if (out && cur && cur.k === x.k && cur.v === x.v && isoOf(utc(cur.to) + 864e5) === x.d) cur.to = x.d;
      else if (out) { cur = { v: x.v, from: x.d, to: x.d, k: x.k }; ranges.push(cur); } else cur = null;
    });
    var seen = {}; ranges = ranges.filter(function (r) { var id = r.v + '|' + r.from + '|' + r.to; if (seen[id]) return false; seen[id] = 1; return true; });
    return { lo: lo, hi: hi, ranges: ranges };
  }
  function breakNote(view, rs, cfg) {
    var nm = function (k) { var q = ser(view, k); return q ? q.name : ''; };
    return rs.map(function (r) { return nm(r.k) + ': ' + fmtOf(cfg)(r.v) + ', ' + (r.from === r.to ? dayOf(cfg, r.from) : dayOf(cfg, r.from) + ' to ' + dayOf(cfg, r.to)); }).join('; ') + ' (off the scale)';
  }
  function geom(view, W, H, fs, hide, gutter, cfg, keyRow) {
    var all = [];
    cfg = cfg || {};
    view.series.forEach(function (s) { if (!hide[s.key]) s.points.forEach(function (p) { all.push(p.v); }); });
    if (!all.length) view.series.forEach(function (s) { s.points.forEach(function (p) { all.push(p.v); }); });
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), cl = clipOf(view, hide, cfg), below = false, above = false;
    if (cl) { below = lo < cl.lo; above = hi > cl.hi; lo = cl.lo; hi = cl.hi; }
    var pad = Math.max((hi - lo) * 0.03, cfg.pad || 0.25), dLo = lo - (cfg.pad || 0), dHi = hi + (cfg.pad || 0);
    lo -= pad; hi += pad;
    var nt = 5, tk = ticks(lo, hi, nt, cfg.intTicks), st = tk.length > 1 ? tk[1] - tk[0] : 1;
    var tLo = Math.floor(dLo / st + 1e-9) * st, tHi = Math.ceil(dHi / st - 1e-9) * st;
    lo = tLo; hi = tHi;   // the axis runs from gridline to gridline
    var tks = []; for (var tv = tLo; tv <= tHi + st * 1e-6; tv += st) tks.push(+tv.toFixed(6));
    var L = Math.round(fs * (W < 420 ? 3.4 : 3.9)), R = Math.round(fs * (cfg.period === 'year' ? 1.7 : 0.8)) + (gutter || 0), T = cfg.legend ? Math.round(fs * 3.5) + 8 : Math.round(fs * (3 + (keyRow === 2 ? 1.9 + 0.6 : keyRow ? 0.7 + 1.1 : 1.1))), B = Math.round(fs * 2.2), lab = Math.round(fs * 1.4);
    if (cfg.tick && cfg.legend) L = Math.ceil(Math.max.apply(null, tks.map(function (v) { return widthOf(cfg.tick(v, 5), fs, true); })) + fs * 1.1);
    var nl = function (lo2) { var rs = cl ? cl.ranges.filter(function (r) { return lo2 ? r.v < cl.lo : r.v > cl.hi; }) : []; return rs.length ? wrapText(breakNote(view, rs, cfg), fs, W - L - R - 14 - Math.round(fs * 0.9)).length : 1; };
    var bandB = below ? Math.round(fs * (1.5 + 1.2 * nl(1))) + 10 : 0, bandT = above ? Math.round(fs * (1.5 + 1.2 * nl(0))) : 0;
    T += bandT; lab += bandB;
    var t0 = utc(view.from), dt = Math.max(utc(view.to) - t0, 864e5), pl = cfg.legend ? Math.round(fs * 0.9) : 0;
    var yIn = function (v) { return T + (hi - v) / (hi - lo) * (H - T - B - lab); };
    if (cl && (H - T - B - lab) / (tks.length - 1) < fs * 1.3) return geom(view, W, H, fs, hide, gutter, Object.assign({}, cfg, { clip: 0 }), keyRow);   // bands too thin: no break
    return { L: L, R: R, T: T, B: B, W: W, H: H, fs: fs, lo: lo, hi: hi, nt: nt, tk: tks, st: st, base: H - B - fs * 0.6, right: W - R,
      ppu: (H - T - B - lab) / (hi - lo),
      clip: cl ? { lo: cl.lo, hi: cl.hi, below: below, above: above, ranges: cl.ranges, yLo: yIn(lo), yHi: yIn(hi), bandB: bandB, bandT: bandT } : null,
      x: function (d) { return L + pl + (utc(d) - t0) / dt * (W - L - R - pl); },
      y: function (v) {
        if (cl && v < lo - 1e-9 && below) return yIn(lo) + fs * 1.9;
        if (cl && v > hi + 1e-9 && above) return T - fs * 1.9;
        return yIn(v);
      },
      day: function (px) { return isoOf(t0 + Math.round((px - L - pl) / (W - L - R - pl) * dt / 864e5) * 864e5); } };
  }
  function widthOf(s, fs, bold) { return String(s).length * fs * (bold ? 0.6 : 0.56); }
  function boxOf(x, y, w, fs, anchor) { var x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x; return { x0: x0 - 2, x1: x0 + w + 2, y0: y - fs * 0.95, y1: y + fs * 0.3 }; }
  function hitBox(a, b) { return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1; }
  function hitSeg(b, s) {
    var xa = Math.max(b.x0, Math.min(s.x1, s.x2)), xb = Math.min(b.x1, Math.max(s.x1, s.x2));
    if (xa > xb) return false;
    if (s.x1 === s.x2) return Math.max(s.y1, s.y2) > b.y0 && Math.min(s.y1, s.y2) < b.y1;
    var k = (s.y2 - s.y1) / (s.x2 - s.x1), ya = s.y1 + (xa - s.x1) * k, yb = s.y1 + (xb - s.x1) * k;
    return Math.max(ya, yb) > b.y0 && Math.min(ya, yb) < b.y1;
  }
  function tieOffsets(view, hide, ppu) {
    var by = {}, off = {};
    view.series.forEach(function (s) { if (!s.faint && s.points.length && !hide[s.key]) (by[s.points[s.points.length - 1].v] = by[s.points[s.points.length - 1].v] || []).push(s.key); });
    Object.keys(by).forEach(function (v) { var k = by[v], sp = Math.max(0.6, Math.min(1.8, 0.3 * ppu / Math.max(1, k.length - 1))); if (k.length > 1) k.forEach(function (key, i) { off[key] = (i - (k.length - 1) / 2) * sp; }); });
    return off;
  }
  function listOrder(view, hide) {
    var main = view.series.filter(function (s) { return !s.faint && s.points.length; });
    var cmp = function (a, b) { var d = b.s.points[b.s.points.length - 1].v - a.s.points[a.s.points.length - 1].v; return d || (a.s.name < b.s.name ? -1 : a.s.name > b.s.name ? 1 : 0); };
    var m = function (s) { return { s: s }; };
    return main.filter(function (s) { return !hide[s.key]; }).map(m).sort(cmp).concat(main.filter(function (s) { return hide[s.key]; }).map(m).sort(cmp)).map(function (e) { return e.s; });
  }
  function wrapText(text, fs, maxW, bold) {
    var lines = [], cur = '';
    String(text).split(' ').forEach(function (w) { var x = cur ? cur + ' ' + w : w; if (widthOf(x, fs, bold) > maxW && cur) { lines.push(cur); cur = w; } else cur = x; });
    if (cur) lines.push(cur);
    if (lines.length === 2) {   // two lines: break where they are most alike, not after the longest first line
      var ws = String(text).split(' '), best = lines, bw = Math.max(widthOf(lines[0], fs, bold), widthOf(lines[1], fs, bold));
      for (var k = 1; k < ws.length; k++) { var a = ws.slice(0, k).join(' '), b = ws.slice(k).join(' '), m = Math.max(widthOf(a, fs, bold), widthOf(b, fs, bold)); if (m < bw - 0.5 && m <= maxW) { bw = m; best = [a, b]; } }
      lines = best;
    }
    return lines;
  }
  function legendOn(cfg, W, opt) { return !!cfg.legend && (!!opt.card || W >= 720); }
  function manyOf(view) { return view.series.filter(function (s) { return !s.faint && s.points.length; }).length > 1; }
  function layout(view, W, H, opt) {
    var fs = opt.fs || 12, hide = opt.hide || {}, cfg = opt.cfg || {}, fmt = fmtOf(cfg), rules = {};
    var many = manyOf(view) || !!opt.leg, gutter = (opt.gutter || (many && legendOn(cfg, W, opt) ? (opt.card ? 470 : 340) : 0)) + (opt.dw || 0), g = geom(view, W, H, fs, hide, gutter, cfg, 0), kt = '', row2 = false, krows = 0, x0 = opt.card ? 24 : 0, segs = [], dots = [], runs = [], boxes = [], labels = [], out = [];
    var off = cfg.legend ? tieOffsets(view, hide, g.ppu) : {}, endDot = {}, ends = [];
    if (cfg.gapKey) {
      kt = cfg.gapKey(view, Math.floor((g.right - g.L + fs) / (fs * 0.53)));
      krows = kt ? kt.split('\n').length : 0;
      if (kt) { var kw0 = Math.max.apply(null, kt.split('\n').map(function (q) { return widthOf(q, fs); })) * 0.94 + fs * 2.2, uw = widthOf(cfg.unit || '', fs), ul = x0 + (uw > g.L - fs ? uw : g.L - x0); row2 = !(g.right - kw0 > ul + fs * 1.5); if (row2) g = geom(view, W, H, fs, hide, gutter, cfg, krows); }
    }
    view.series.forEach(function (s) {
      if (!s.points.length || hide[s.key]) return;
      var dy = off[s.key] || 0;
      var pts = s.points.map(function (p) { return { d: p.d, v: p.v, x: g.x(p.d), y: g.y(p.v) + dy }; });
      var run = [pts[0]], rule = rules[s.key] = ruleOf(cfg, s.points);
      for (var i = 1; i < pts.length; i++) {
        var gap = !s.faint && (s.points[i].b || missing(pts[i - 1].d, pts[i].d, rule)), q = pts[i - 1];
        if (s.step && gap) {
          var gx = s.points[i].b && s.points[i].b > pts[i - 1].d ? Math.min(g.x(s.points[i].b), pts[i].x) : pts[i - 1].x, hold = { x: gx, y: q.y };
          if (gx > q.x) { segs.push({ x1: q.x, y1: q.y, x2: gx, y2: q.y, key: s.key }); run.push(hold); }
          runs.push({ s: s, pts: run });
          var corner = { x: pts[i].x, y: q.y };
          segs.push({ x1: gx, y1: q.y, x2: corner.x, y2: q.y, key: s.key, gap: true, s: s, d1: pts[i - 1].d }, { x1: corner.x, y1: q.y, x2: pts[i].x, y2: pts[i].y, key: s.key, gap: true });
          runs.push({ s: s, pts: [hold, corner, pts[i]], gap: true, note: { x0: gx, x1: corner.x, y: q.y } });
          run = [pts[i]]; continue;
        }
        if (s.step && !gap) { q = { x: pts[i].x, y: q.y }; segs.push({ x1: pts[i - 1].x, y1: q.y, x2: q.x, y2: q.y, key: s.key }); run.push(q); }
        segs.push({ x1: q.x, y1: q.y, x2: pts[i].x, y2: pts[i].y, key: s.key, gap: !!gap, s: s, d1: pts[i - 1].d });
        if (gap) { runs.push({ s: s, pts: run }); runs.push({ s: s, pts: [pts[i - 1], pts[i]], gap: true }); run = [pts[i]]; } else run.push(pts[i]);
      }
      var z = pts[pts.length - 1], endX = z.x;
      if (s.until > z.d) { q = { x: g.x(s.until), y: z.y }; segs.push({ x1: z.x, y1: z.y, x2: q.x, y2: q.y, key: s.key }); run.push(q); endX = q.x; }
      runs.push({ s: s, pts: run });
      if (!s.faint) {
        pts.forEach(function (p, j) { dots.push({ x: p.x, y: p.y, r: Math.max(1.6, fs / 6), s: s, last: false }); });
        if (cfg.legend) { endDot[s.key] = z.y; ends.push({ x: endX, ex: endX, y: z.y, r: fs / 5 + 1.2, s: s, last: true }); dots.push(ends[ends.length - 1]); }
        else dots[dots.length - 1] = { x: z.x, y: z.y, r: fs / 3 + 1, s: s, last: true };
      }
    });
    ends.sort(function (a, b) { return a.y - b.y; }).forEach(function (e, i) {
      var q = 2 * e.r + 2; while (ends.slice(0, i).some(function (p) { return Math.hypot(p.x - e.x, p.y - e.y) < q; })) e.x += 1;
    });
    var dw = Math.ceil(Math.max.apply(null, ends.map(function (e) { return e.x - g.right; }).concat(0)));
    if (dw > (opt.dw || 0)) return layout(view, W, H, Object.assign({}, opt, { dw: dw }));
    // end dots are drawn last, and a change dot within one end dot's width of an end dot is left out (it would sit under it)
    dots = dots.filter(function (d) { return d.last || !ends.some(function (e) { return Math.hypot(e.x - d.x, e.y - d.y) < 2 * e.r; }); }).sort(function (a, b) { return a.last - b.last; });
    var key = null;
    if (kt && segs.some(function (q) { return q.gap && q.s && !q.s.faint; })) {
      var kw = Math.max.apply(null, kt.split('\n').map(function (q) { return widthOf(q, fs); })) * 0.94 + fs * 2.2;
      key = row2 ? { text: kt, x: x0, ly: fs * 2.15, ty: fs * 2.5, w: kw } : { text: kt, x: g.right - kw, ly: fs * 0.85, ty: fs * 1.2, w: kw };
      boxes.push({ x0: key.x - 2, x1: key.x + kw + 2, y0: key.ty - fs * 0.8, y1: key.ty + (krows - 1) * fs * 1.2 + fs * 0.15 });
    }
    if (cfg.markLabel && view.series.some(function (q) { return !hide[q.key] && q.points.some(function (p) { return p.m; }); })) { var my = fs * 2.5 + (cfg.legend ? 8 : 0); boxes.push({ x0: g.L, x1: W, y0: my - fs * 0.95, y1: my + fs * 0.3 }); }
    var ext = 0;   // a first-point label may dip just under the lowest gridline when the line leaves no room above
    var bound = function (b, outside) {
      return b.y0 >= fs * (row2 ? 1.85 + krows * 1.2 : 1.6) && b.y1 <= g.base - 1 + ext && (outside ? b.x0 >= g.right + 2 && b.x1 <= W : b.x0 >= g.L + 2 && b.x1 <= g.right);
    };
    var strict = false, pad = 0;   // strict: also keep off the gridlines; pad: room kept round other labels (a gap label)
    var free = function (b, outside) {
      if (!bound(b, outside)) return false;
      var bp = pad ? { x0: b.x0 - pad, x1: b.x1 + pad, y0: b.y0, y1: b.y1 } : b;
      for (var i = 0; i < boxes.length; i++) if (hitBox(bp, boxes[i])) return false;
      if (outside) return true;
      if (strict) {   // no gridline within a margin (up to 6 px, less where the bands are tight) of the text
        var band = g.tk.length > 1 ? Math.abs(g.y(g.tk[1]) - g.y(g.tk[0])) : 99, m = Math.max(1, Math.min(6, (band - (b.y1 - b.y0)) / 2 - 0.5));
        for (var t = 0; t < g.tk.length; t++) { var gy = g.y(g.tk[t]); if (gy > b.y0 - m && gy < b.y1 + m) return false; }
      }
      for (var j = 0; j < segs.length; j++) if (hitSeg(b, segs[j])) return false;
      for (var k = 0; k < dots.length; k++) { var d = dots[k]; if (hitBox(b, { x0: d.x - d.r - 1, x1: d.x + d.r + 1, y0: d.y - d.r - 1, y1: d.y + d.r + 1 })) return false; }
      return true;
    };
    var failed = [], left = [], top0 = row2 ? fs * (2.65 + (krows - 1) * 1.2) + 1 : fs * 1.7;
    // First/last point label (E53 r7): nearest slot 6 px off gridlines, dots, line and labels, within a band (or past the
    // edge gridline), two steps sideways, no other point nearer by over 6 px. Else a first label is left out; a last one
    // tries 3 px to line and labels, then two bands, then without the other-point test (it prints its year).
    var placePt = function (L) {
      var P = L.pt, px = P.x, py = P.y, r = P.r, w = widthOf(L.text, fs, L.bold), end = L.kind === 'end', gys = g.tk.map(function (t) { return g.y(t); });
      var yb = Math.max.apply(null, gys), yt = Math.min.apply(null, gys), bot = H - fs * 1.25 - 3, M = 6, best = null, C, G, BP;
      var dist = function (t, x, y) { return Math.hypot(Math.max(t.x0 - x, 0, x - t.x1), Math.max(t.y0 - y, 0, y - t.y1)); };
      var at = function (x0, y, band) {   // x0: the text's left edge, y: its baseline
        var t = { x0: x0 - 2, x1: x0 + w + 2, y0: y - fs * 0.76, y1: y + fs * 0.14 }, own = dist(t, px, py), i;
        if ((best && own >= best.own) || t.x0 < g.L + 2 || t.x1 > W - 2 || t.y0 < top0 || t.y1 > bot) return;
        if (band && (py < t.y0 ? t.y0 - py : py > t.y1 ? py - t.y1 : 0) > BP) return;
        for (i = 0; i < gys.length; i++) if (gys[i] > t.y0 - G && gys[i] < t.y1 + G) return;
        var tb = { x0: t.x0 - C, x1: t.x1 + C, y0: t.y0 - C, y1: t.y1 + C };
        for (i = 0; i < boxes.length; i++) if (hitBox(tb, boxes[i])) return;
        for (i = 0; i < segs.length; i++) if (hitSeg(tb, segs[i])) return;
        for (i = 0; i < dots.length; i++) { var d = dots[i], dd = dist(t, d.x, d.y); if (dd < d.r + M || (lv < 3 && dd < own - M && Math.hypot(d.x - px, d.y - py) > 0.5)) return; }
        best = { t: t, x: end ? x0 + w : x0, y: y, own: own, lv: lv };
      };
      var dir = end ? -1 : 1, k, sh, y, lv, xa = end ? px + r - w : px - r, xb = end ? px - r - M - 2 - w : px + r + M + 2, xg = end ? xa : xb;
      for (lv = 0; lv < (end ? 4 : 1) && !best; lv++) {
        C = lv ? 3 : M; G = lv && cfg.legend ? 3 : M; BP = (lv > 1 ? 2 : 1) * bandPx;
        for (k = 0; k <= BP + fs; k += 0.5) for (y = -1; y <= 1; y += 2) for (sh = -2; sh < 3; sh++) {
          var o = dir * sh * fs * 0.8, yy = py + fs * 0.31 + y * k;
          at(xa + o, yy, true);
          at(xb + o, yy, true);
          if (Math.abs(py - yb) <= BP) at(xg + o, yb + M + fs * 0.76 + k, false);
          if (Math.abs(py - yt) <= BP) at(xg + o, yt - M - fs * 0.14 - k, false);
        }
        gys.forEach(function (gy) { for (sh = -2; sh < 3; sh++) [xa, xb].forEach(function (x) { x += dir * sh * fs * 0.8; at(x, gy + M + fs * 0.76, true); at(x, gy - M - fs * 0.14, true); }); });   // flush to a gridline
      }
      if (!best) return false;
      var b = boxOf(best.x, best.y, w, fs, end ? 'end' : 'start');
      boxes.push(b); out.push(Object.assign({}, L, { x: best.x, y: best.y, box: b, tight: best.t, lv: best.lv })); return true;
    };
    var place = function (L) {
      if (L.pt) { if (!placePt(L)) left.push(L); return; }   // no slot meets the rule: left out (the headline and readout carry it)
      var w = widthOf(L.text, fs, L.bold), step = fs * 0.17, span = g.base - g.T + fs * 2;
      ext = L.kind === 'gap' ? fs * 1.4 : L.kind === 'start' ? fs * 0.9 : 0;
      var win = L.win || [L.y - fs * 3, L.y + fs * 3];   // stay near what it names; else go outside
      var gap = L.kind === 'gap', passes = gap ? [true] : [true, false];
      pad = gap ? fs * 1.2 : 0;
      for (var ps = 0; ps < passes.length; ps++) {
        strict = passes[ps];   // first off the gridlines; a gap label never sits on one, the others fall back
        for (var n = 0; n * step < span; n++) {
          for (var si = 0, sgs = n ? (L.down ? [1, -1] : [-1, 1]) : [1]; si < sgs.length; si++) {
            var sgn = sgs[si], y = L.y + sgn * n * step;
            if (y < win[0] || y > win[1]) continue;
            for (var dxi = 0; dxi < (L.anchor === 'middle' ? 7 : 1); dxi++) {
              var lx = L.x + (dxi % 2 ? 1 : -1) * Math.ceil(dxi / 2) * fs * 0.7;
              if (L.anchor === 'middle') lx = Math.max(g.L + (gap ? fs : 3) + w / 2, Math.min(g.right - 1 - w / 2, lx));
              var b = boxOf(lx, y, w, fs, L.anchor);
              if (free(b)) { boxes.push(b); out.push(Object.assign({}, L, { x: lx, y: y, box: b })); strict = false; pad = 0; return; }
            }
          }
        }
      }
      strict = false; pad = 0;
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
    var ex = g.x(view.to) - fs * 0.8, bandPx = g.tk.length > 1 ? Math.abs(g.y(g.tk[1]) - g.y(g.tk[0])) : fs * 3;   // a point's own label stays within one gridline band of it
    var main = view.series.filter(function (s) { return !s.faint && s.points.length; });
    if (cfg.legend && (many || !legendOn(cfg, W, opt))) {
      var legend = legendOn(cfg, W, opt) ? legendLayout(view, g, endDot, hide, fmt, opt, fs) : null;
      return { g: g, segs: segs, dots: dots, runs: runs, labels: [], boxes: [], rules: rules, off: off, legend: legend, order: listOrder(view, hide) };
    }
    main.filter(function (s) { return !hide[s.key]; }).map(function (s) { return { s: s, v: s.points[s.points.length - 1].v }; })
      .sort(function (a, b) { return b.v - a.v; }).forEach(function (e, i) {
        var lp = e.s.points[e.s.points.length - 1], pv = e.s.points[e.s.points.length - 2];
        var down = i === 0 && pv && g.y(pv.v) < g.y(e.v) - 2;   // a line falling into its end: the free side is below it
        var y = i === 0 && !down ? g.y(e.v) - fs * 0.6 : g.y(e.v) + fs * 1.3;
        labels.push({ kind: 'end', s: e.s, text: e.s.endText ? e.s.endText(lp) : e.s.name + ' ' + fmt(e.v), x: ex, y: y, anchor: 'end', bold: true, down: down, win: [g.y(e.v) - bandPx, g.y(e.v) + bandPx + fs * 0.9], pt: e.s.endText || cfg.legend ? dots.filter(function (d) { return d.last && d.s === e.s; })[0] : null });
      });
    main.filter(function (s) { return !hide[s.key] && s.startText && s.points.length > 1; }).forEach(function (s) {
      var p0 = s.points[0], nx = s.points[1], dn = g.y(nx.v) < g.y(p0.v) - 2;   // the line leaves upward: the free side is below
      labels.push({ kind: 'start', s: s, text: s.startText(p0), x: g.x(p0.d) + fs * 0.7, y: g.y(p0.v) + (dn ? fs * 1.5 : -fs * 0.9), anchor: 'start', bold: true, optional: true, down: dn, win: [g.y(p0.v) - bandPx, g.y(p0.v) + bandPx + fs * 0.9], pt: { x: g.x(p0.d), y: g.y(p0.v), r: Math.max(1.6, fs / 6) } });
    });
    (cfg.bands || []).forEach(function (b) {
      if (hide[b.a] || hide[b.b]) return;
      var pp = pairs(view, b); if (pp.length < 2) return;
      var e = pp[pp.length - 1], s0 = pp[0];
      var win = function (p) { var y1 = Math.min(g.y(p.a), g.y(p.b)), y2 = Math.max(g.y(p.a), g.y(p.b)); return [y1 - fs * 0.6, y2 + fs * 1.6]; };
      if (b.end) labels.push({ kind: 'band', text: b.end(e), x: ex, y: (g.y(e.a) + g.y(e.b)) / 2 + fs * 0.35, anchor: 'end', bold: true, win: win(e) });
      if (b.start) labels.push({ kind: 'band', text: b.start(s0), x: g.x(s0.d) + fs * 0.6, y: (g.y(s0.a) + g.y(s0.b)) / 2 + fs * 0.35, anchor: 'start', win: win(s0), optional: true });
    });
    main.filter(function (s) { return hide[s.key]; }).forEach(function (s) {
      labels.push({ kind: 'end', off: true, s: s, text: s.name + ' ' + fmt(s.points[s.points.length - 1].v), x: g.right, y: g.T + fs * 0.3, anchor: 'end', bold: true, win: [0, g.base] });
    });
    var gq = cfg.gapLabel && W >= 500 ? lay_gaps(segs, cfg, fs) : [], gmax = Math.max.apply(null, gq.map(function (q) { return q.y; })), gmin = Math.min.apply(null, gq.map(function (q) { return q.y; }));
    if (gq.length > 1 && gmax - gmin < fs * 2.2) gq.forEach(function (q) { q.y = gmax; });   // the labels of one chart share a baseline
    gq.forEach(function (q) { labels.push({ kind: 'gap', s: q.s, text: q.text, x: q.x, y: q.y, anchor: 'middle', optional: true, win: [q.y - fs * 4.4, q.y + fs * 2.2] }); });
    labels.forEach(place);
    var gl = out.filter(function (L) { return L.kind === 'gap'; }), gy = Math.max.apply(null, gl.map(function (L) { return L.y; }));
    gl.forEach(function (L) {   // one baseline where it fits
      var d = gy - L.y, b = { x0: L.box.x0, x1: L.box.x1, y0: L.box.y0 + d, y1: L.box.y1 + d };
      boxes.splice(boxes.indexOf(L.box), 1); strict = true;
      if (d && d < fs * 2.5 && free(b)) { L.y = gy; L.box = b; }
      strict = false; boxes.push(L.box);
    });
    if (cfg.legend && left.some(function (L) { return L.kind === 'end'; })) return layout(view, W, H, Object.assign({}, opt, { leg: 1 }));   // one line the plot cannot name: named beside it, as several are
    if (failed.length) {
      var wide = Math.max.apply(null, failed.map(function (L) { return widthOf(L.text, fs, L.bold); })), want = Math.min(Math.round(wide + fs * 1.4), Math.round(W * 0.4));
      if (want > gutter) return layout(view, W, H, Object.assign({}, opt, { gutter: want }));
    }
    return { g: g, segs: segs, dots: dots, runs: runs, labels: out, boxes: boxes, rules: rules, off: off, key: key, x0: x0, left: left, top: top0 };
  }
  function lay_gaps(segs, cfg, fs) {
    var out = [];
    segs.forEach(function (sg) {
      if (!sg.gap || !sg.s || sg.s.faint) return;
      var gp = gapAt(cfg, sg.s.points, isoOf(utc(sg.d1) + 864e5)), t = gp && cfg.gapLabel(gp);
      if (t) out.push({ s: sg.s, text: t, x: (sg.x1 + sg.x2) / 2, y: Math.max(sg.y1, sg.y2) + fs * 1.2 });
    });
    return out;
  }
  function legendLayout(view, g, ends, hide, fmt, opt, fs) {
    var order = listOrder(view, hide), card = !!opt.card, x0 = g.right + (opt.dw || 0) + (card ? 26 : 22), maxW = g.W - x0 - 30;
    var lfs = card ? 16 : fs, lh = lfs * 1.25, top = card ? 0 : g.T, bot = g.base;   // one size on the picture: nothing shrinks
    var items = order.map(function (s) {
      var val = fmt(s.points[s.points.length - 1].v), nm = s.name, ci = nm.indexOf(', '), one = nm + ' ' + val, fitL = function (t) { return widthOf(t, lfs, true) <= maxW ? [t] : wrapText(t, lfs, maxW, true); };
      var lines = widthOf(one, lfs, true) <= maxW ? [one] : ci > 0 ? fitL(nm.slice(0, ci + 1)).concat(fitL(nm.slice(ci + 2) + ' ' + val)) : fitL(one);
      return { s: s, lines: lines, h: lines.length * lh, ye: ends[s.key], hidden: !!hide[s.key], fs: lfs };
    });
    var gap = items.length ? items[0].fs * 0.5 : 0, y = top;
    items.forEach(function (it) { var want = (it.ye == null ? bot : it.ye) - it.h / 2; it.y = Math.max(y, want); y = it.y + it.h + gap; });
    var limit = bot + (items.length ? items[0].fs : 0);
    for (var k = items.length - 1; k >= 0; k--) { var cap = k === items.length - 1 ? limit : items[k + 1].y - gap; if (items[k].y + items[k].h > cap) items[k].y = cap - items[k].h; }
    items.forEach(function (it) { it.x = x0; it.box = { x0: x0 - 4, x1: g.W, y0: it.y - 2, y1: it.y + it.h + 2 }; });
    return { items: items, x: x0, fs: items.length ? items[0].fs : fs, lh: lh };
  }

  function txt(x, y, s, st, anchor, cls) { return '<text' + (cls ? ' class="' + cls + '"' : '') + ' x="' + f1(x) + '" y="' + f1(y) + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + ' style="' + st + '">' + esc(HY ? hy(s) : s) + '</text>'; }
  function dashOf(d, fs) { var k = fs / 13; return String(d).split(' ').map(function (n) { return (+n * k).toFixed(1); }).join(' '); }
  function poly(pts) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + f1(p.x) + ' ' + f1(p.y); }).join(''); }

  function weeklyTicks(view, g, fs) {
    var t0 = utc(view.from), t1 = utc(view.to), mons = [], t = t0;
    while (new Date(t).getUTCDay() !== 1 && t <= t1) t += 864e5;
    for (; t <= t1; t += 7 * 864e5) mons.push(isoOf(t));
    if (mons.length > 1 && g.x(mons[1]) - g.x(mons[0]) < fs * 6.2) mons = mons.filter(function (d, i) { return (mons.length - 1 - i) % 2 === 0; });
    if (!mons.length) mons.push(view.to);
    return mons;
  }
  function svg(view, W, H, opt) {
    var fs = opt.fs || 12, hide = opt.hide || {}, P = opt.card ? CARD : PAGE, cfg = opt.cfg || {};
    var col = function (s) { return opt.card ? s.card || s.color : s.color; };
    HY = !!cfg.legend;
    var lay = layout(view, W, H, opt), g = lay.g, f = 'font-size:' + fs + 'px;font-family:' + FONT + ';', fb = f + 'font-weight:700;', o = [];
    var halo = 'paint-order:stroke;stroke:' + P.surf + ';stroke-width:' + (fs / 3.5).toFixed(1) + 'px;stroke-linejoin:round;';
    o.push('<svg xmlns="http://www.w3.org/2000/svg" class="agc-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '"' + (opt.label ? ' role="img" aria-label="' + esc(opt.label) + '"' : '') + '>');
    var unitW = widthOf(cfg.unit || '', fs), unitStart = unitW > g.L - fs;   // a long axis title starts at the left edge
    o.push(cfg.axisTitle ? txt(opt.card ? 24 : 0, fs * 1.2, cfg.axisTitle, f + 'fill:' + P.dim, 'start', 'agc-at') : txt(unitStart ? lay.x0 : g.L - fs * 0.5, fs * 1.2, cfg.unit || '', f + 'fill:' + P.mut, unitStart ? 'start' : 'end'));
    g.tk.forEach(function (v) {
      var y = g.y(v);
      o.push('<line x1="' + g.L + '" x2="' + f1(g.right) + '" y1="' + f1(y) + '" y2="' + f1(y) + '" style="stroke:' + P.grid + ';stroke-width:1"/>');
      o.push(txt(g.L - fs * 0.5, y + fs * 0.35, cfg.tick ? cfg.tick(v, g.st) : '$' + (g.st % 1 ? v.toFixed(2) : v), f + 'fill:' + P.dim, 'end'));
    });
    if (cfg.weekly) o.push('<line x1="' + g.L + '" x2="' + f1(g.right) + '" y1="' + f1(g.base) + '" y2="' + f1(g.base) + '" style="stroke:' + P.grid + ';stroke-width:1"/>');
    var marks = [], drawn = {};
    view.series.forEach(function (s) { if (!hide[s.key]) s.points.forEach(function (p) { if (p.m) {
      if (!drawn[p.d]) o.push('<line class="agc-mk" x1="' + f1(g.x(p.d)) + '" x2="' + f1(g.x(p.d)) + '" y1="' + g.T + '" y2="' + f1(g.clip && g.clip.below ? g.clip.yLo : g.base) + '" style="stroke:' + P.mut + ';stroke-dasharray:2 3"/>');
      drawn[p.d] = 1;
      var t = cfg.markLabel ? cfg.markLabel(p, s) : '';
      if (t && !marks.some(function (m) { return m.d === p.d && m.t === t; })) marks.push({ d: p.d, t: t, x: g.x(p.d) });
    } }); });
    if (marks.length) {
      marks.sort(function (a, b) { return a.x - b.x; });
      var ms = fs - 1, mw = function (t) { return widthOf(t, ms) + 8; }, merged = [];
      marks.forEach(function (m) {
        var last = merged[merged.length - 1];
        if (last && (m.x - last.x < mw(last.t) + 6 || Math.abs(m.x - last.x) < 30)) { if (last.ds.indexOf(m.d) < 0) last.ds.push(m.d); last.x1 = m.x; last.t = (cfg.markMany || 'Reference changed') + ': ' + last.ds.map(function (d) { return dayOf(cfg, d); }).join(', '); } else merged.push({ d: m.d, t: m.t, x: m.x, x1: m.x, ds: [m.d] });
      });
      var prev = -1e9;
      merged.forEach(function (m) {
        var w = mw(m.t), x = m.ds.length > 1 ? Math.max(g.L, Math.min((m.x + m.x1) / 2 - w / 2 + 4, g.right - w + 8)) : Math.max(g.L, Math.min(m.x + 4, g.right - w + 8));
        if (x < prev + 6) return;
        prev = x + w;
        o.push(txt(x, fs * 2.5 + (cfg.legend ? 8 : 0), m.t, 'font-size:' + ms + 'px;font-family:' + FONT + ';fill:' + P.dim + ';' + halo, 'start', 'agc-mkl'));
      });
    }
    var days = Math.round((utc(view.to) - utc(view.from)) / 864e5), want = Math.min(days + 1, (g.right - g.L) / fs < 34 ? 3 : 6), dts = [];
    if (cfg.period === 'year') {
      var y0 = +view.from.slice(0, 4), y1 = +view.to.slice(0, 4), span = y1 - y0, wide = (g.right - g.L) / fs >= 34, stp = span <= 10 ? 1 : wide ? 3 : 6;
      while (span / stp + 1 > (wide ? 11 : 6) && span > 10) stp += 3;
      while (stp < 3 && span > 1 && (g.right - g.L) / span * stp < fs * 3.6) stp++;
      var yl = []; for (var yy = y1; yy >= y0; yy -= stp) yl.unshift(yy);
      yl.forEach(function (yv) { o.push(txt(g.x(yv + '-01-01'), H - fs * 0.5, String(yv), f + 'fill:' + P.dim, 'middle')); });
      want = 0;
    }
    var rep0 = [];
    view.series.forEach(function (s) { if (!s.faint) rep0 = rep0.concat(s.points, s.until ? [{ d: view.to }] : []); });
    if (cfg.weekly) dts = weeklyTicks(view, g, fs);
    else for (var i = 0; i < want; i++) {
      var dd = isoOf(utc(view.from) + Math.round(i * days / Math.max(1, want - 1)) * 864e5), np = rep0.length ? near(rep0, dd) : null;
      if (np) dd = np.d;
      if (!dts.length || (dd > dts[dts.length - 1] && g.x(dd) - g.x(dts[dts.length - 1]) >= fs * (i === want - 1 ? 6.6 : 4.4))) dts.push(dd);
      else if (i === want - 1 && dts.length > 1 && dd > dts[dts.length - 1]) dts[dts.length - 1] = dd;
    }
    dts.forEach(function (d, j) {
      var x = g.x(d), last = j === dts.length - 1 && d === view.to;
      if (cfg.weekly) o.push('<line x1="' + f1(x) + '" x2="' + f1(x) + '" y1="' + f1(g.base) + '" y2="' + f1(g.base + 4) + '" style="stroke:' + P.mut + ';stroke-width:1"/>');
      o.push(txt(x, H - fs * 0.5, dayOf(cfg, d), f + 'fill:' + P.dim, cfg.weekly ? (last && x + widthOf(dayOf(cfg, d), fs) / 2 > g.right + 4 ? 'end' : 'middle') : j === dts.length - 1 ? 'end' : (x - g.L < fs * 2 ? 'start' : 'middle')));
    });
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
    if (lay.key) {
      var K = lay.key;
      o.push('<line x1="' + f1(K.x) + '" x2="' + f1(K.x + fs * 1.5) + '" y1="' + f1(K.ly) + '" y2="' + f1(K.ly) + '" style="stroke:' + col(view.series.filter(function (q) { return !q.faint && q.points.length; })[0]) + ';stroke-width:2;stroke-opacity:.8;stroke-dasharray:' + fs / 4 + ' ' + fs / 3 + '"/>');
      K.text.split('\n').forEach(function (q, qi) { o.push(txt(K.x + fs * 2.2, K.ty + qi * fs * 1.2, q, f + 'fill:' + P.mut, 'start', 'agc-gk')); });
    }
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
    if (g.clip && (g.clip.below || g.clip.above)) {
      var drawBreak = function (y, lines, x0, y0) {
        o.push('<line x1="' + g.L + '" x2="' + f1(g.right) + '" y1="' + f1(y) + '" y2="' + f1(y) + '" style="stroke:' + P.mut + ';stroke-width:1"/>');
        o.push('<path d="M' + f1(g.L - 6) + ' ' + f1(y + 3) + 'L' + f1(g.L - 2) + ' ' + f1(y - 1) + 'L' + f1(g.L + 2) + ' ' + f1(y + 3) + 'L' + f1(g.L + 6) + ' ' + f1(y - 1) + '" style="fill:none;stroke:' + P.dim + ';stroke-width:1.5"/>');
        lines.forEach(function (l, i) { o.push(txt(x0, y0 + i * fs * 1.2, l, f + 'fill:' + P.dim + ';' + halo, 'start', 'agc-off')); });
      };
      var lows = g.clip.ranges.filter(function (r) { return r.v < g.clip.lo; }), highs = g.clip.ranges.filter(function (r) { return r.v > g.clip.hi; });
      var room = g.right - g.L - 14;
      if (g.clip.below && lows.length) drawBreak(g.clip.yLo + fs * 1.1, wrapText(breakNote(view, lows, cfg), fs, room), g.L + 8, g.clip.yLo + fs * 3.1);
      if (g.clip.above && highs.length) drawBreak(g.clip.yHi - fs * 1.1, wrapText(breakNote(view, highs, cfg), fs, room), g.L + 8, g.clip.yHi - fs * 1.9 - fs * 1.2 * (wrapText(breakNote(view, highs, cfg), fs, room).length - 1) - fs * 0.5);
    }
    var lw = Math.max(2, fs / 6);
    lay.runs.filter(function (r) { return r.s.faint; }).concat(lay.runs.filter(function (r) { return !r.s.faint; })).forEach(function (r) {
      if (r.pts.length < 2) return;
      var st = r.s.faint ? 'stroke:' + P.mut + ';stroke-width:' + Math.max(1.5, fs / 8) + ';stroke-dasharray:' + fs / 3 + ' ' + fs / 3
        : r.gap ? 'stroke:' + col(r.s) + ';stroke-width:' + Math.max(2, lw * 0.85) + ';stroke-opacity:' + (cfg.legend ? '.7;stroke-width:1;stroke-dasharray:' + (fs / 2.2).toFixed(1) + ' ' + (fs / 3.2).toFixed(1) : '.8;stroke-dasharray:' + fs / 4 + ' ' + fs / 3)
          : 'stroke:' + col(r.s) + ';stroke-width:' + lw + ';stroke-linejoin:round;stroke-linecap:' + (r.s.dash ? 'butt' : 'round') + (r.s.dash ? ';stroke-dasharray:' + dashOf(r.s.dash, fs) : '');
      o.push('<path class="agc-ln' + (r.gap ? ' agc-gap' : '') + '" d="' + poly(r.pts) + '" style="fill:none;' + st + '"/>');
      if (r.note && cfg.gapNote) {   // the words under a dashed stretch, when they fit under it
        var nw = widthOf(cfg.gapNote, fs - 1);
        if (r.note.x1 - r.note.x0 >= nw + 6) o.push(txt((r.note.x0 + r.note.x1) / 2, r.note.y + fs * 1.15, cfg.gapNote, 'font-size:' + (fs - 1) + 'px;font-family:' + FONT + ';fill:' + P.dim + ';' + halo, 'middle', 'agc-gn'));
      }
    });
    lay.dots.filter(function (d) { return d.last && d.x > d.ex; }).sort(function (a, b) { return b.x - a.x; }).forEach(function (d) { o.push('<line class="agc-jn" x1="' + f1(d.ex) + '" x2="' + f1(d.x) + '" y1="' + f1(d.y) + '" y2="' + f1(d.y) + '" style="stroke:' + col(d.s) + ';stroke-width:' + lw + ';stroke-linecap:round"/>'); });
    lay.dots.forEach(function (d) { o.push('<circle class="agc-dot' + (d.last ? ' agc-last' : '') + '" cx="' + f1(d.x) + '" cy="' + f1(d.y) + '" r="' + f1(d.r) + '" style="fill:' + col(d.s) + (d.last ? ';stroke:' + P.surf + ';stroke-width:' + (cfg.legend ? 1 : 2) : '') + '"/>'); });
    if (opt.hover) {
      o.push('<g class="agc-hov" visibility="hidden"><line y1="' + g.T + '" y2="' + f1(g.base) + '" style="stroke:' + P.mut + ';stroke-dasharray:3 3"/>' +
        view.series.filter(function (s) { return !s.faint && s.points.length; }).map(function (s) { return '<circle r="4" data-k="' + esc(s.key) + '" style="fill:' + col(s) + ';stroke:' + P.surf + ';stroke-width:2"/>'; }).join('') + '</g>');
      o.push('<rect class="agc-hit" x="' + g.L + '" y="' + g.T + '" width="' + f1(Math.max(0, g.right - g.L)) + '" height="' + f1(g.base - g.T) + '" fill="transparent"/>');
    }
    if (lay.legend) lay.legend.items.forEach(function (it) {
      var tog = it.s.toggle !== false && !opt.card, off = it.hidden, c = col(it.s), lf = it.fs, lh = lf * 1.25, b = it.box;
      var fl = 'font-size:' + lf + 'px;font-family:' + FONT + ';font-weight:700;fill:' + c + (off ? ';opacity:.5;text-decoration:line-through' : '');
      o.push('<g class="agc-tog agc-leg"' + (tog ? ' data-k="' + esc(it.s.key) + '" tabindex="0" role="button" aria-pressed="' + !off + '" aria-label="' + (off ? 'Show ' : 'Hide ') + esc(it.lines.join(' ')) + '"' : '') + '>' +
        (tog ? '<rect x="' + f1(b.x0) + '" y="' + f1(b.y0) + '" width="' + f1(b.x1 - b.x0) + '" height="' + f1(b.y1 - b.y0) + '" fill="transparent"/>' : '') +
        '<line x1="' + f1(it.x) + '" x2="' + f1(it.x + 20) + '" y1="' + f1(it.y + lh * 0.62) + '" y2="' + f1(it.y + lh * 0.62) + '" style="stroke:' + c + ';stroke-width:2.2' + (it.s.dash ? ';stroke-dasharray:' + dashOf(it.s.dash, 13) : '') + '"/><circle cx="' + f1(it.x + 22) + '" cy="' + f1(it.y + lh * 0.62) + '" r="3" style="fill:' + c + '"/>' +
        it.lines.map(function (l, i) { return txt(it.x + 30, it.y + lf * 0.98 + i * lh, l, fl, 'start'); }).join('') + '</g>');
    });
    lay.labels.forEach(function (L) {
      if (L.kind === 'gap') { o.push(txt(L.x, L.y, L.text, f + halo + 'fill:' + P.dim, 'middle', 'agc-gl')); return; }
      if (L.kind === 'band') { o.push(txt(L.x, L.y, L.text, (L.bold ? fb : f) + halo + 'fill:' + P.ink, L.anchor, 'agc-bl')); return; }
      var off = !!L.off, tog = L.kind !== 'start' && L.s.toggle !== false && !opt.card, b = L.box;
      o.push('<g class="agc-tog"' + (tog ? ' data-k="' + esc(L.s.key) + '" tabindex="0" role="button" aria-pressed="' + !off + '" aria-label="' + (off ? 'Show ' : 'Hide ') + esc(L.text) + '"' : '') + '>' +
        (tog ? '<rect x="' + f1(b.x0) + '" y="' + f1(b.y0) + '" width="' + f1(b.x1 - b.x0) + '" height="' + f1(b.y1 - b.y0) + '" fill="transparent"/>' : '') +
        txt(L.x, L.y, L.text, fb + halo + 'fill:' + col(L.s) + (off ? ';opacity:.5;text-decoration:line-through' : ''), L.anchor) + '</g>');
    });
    o.push('</svg>');
    return o.join('');
  }

  function footOf(cfg, v) { return typeof cfg.foot === 'function' ? cfg.foot(v) : cfg.foot; }
  function fitLines(measure, text, maxW, sizes, maxLines, balance) {
    var lines = [];
    for (var i = 0; i < sizes.length; i++) {
      lines = []; var cur = '';
      String(text || '').split(' ').forEach(function (w) { var x = cur ? cur + ' ' + w : w; if (measure(x, sizes[i]) > maxW && cur) { lines.push(cur); cur = w; } else cur = x; });
      if (cur) lines.push(cur);
      if (lines.length <= maxLines && lines.every(function (l) { return measure(l, sizes[i]) <= maxW; })) {
        if (balance && lines.length === 2) {   // the split that leaves the two lines nearest in width, no single word left alone
          var ws = String(text).split(' '), best = null;
          for (var k = 1; k < ws.length; k++) {
            var a = ws.slice(0, k).join(' '), b = ws.slice(k).join(' '), m = Math.max(measure(a, sizes[i]), measure(b, sizes[i]));
            if (m <= maxW && (!best || m < best.m)) best = { m: m, lines: [a, b] };
          }
          if (best) lines = best.lines;
        }
        return { size: sizes[i], lines: lines };
      }
    }
    return { size: sizes[sizes.length - 1], lines: lines, over: true };
  }
  function card(cfg, view, done) {
    var D = root.document, W = 1200, H = 630, c = D.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d'); if (!x || !root.Image) { done(null); return; }
    var st = cfg.story ? cfg.story(view, true) : {}, sh = cfg.share || {};
    var meas = function (wt) { return function (s, size) { x.font = wt + ' ' + size + 'px ' + FONT; return x.measureText(s).width; }; };
    x.fillStyle = '#0a0c0d'; x.fillRect(0, 0, W, H); x.fillStyle = '#d4a23f'; x.fillRect(0, 0, W, 10);
    x.font = '800 34px ' + FONT; x.fillStyle = '#e9edeb'; x.fillText('agsist', 48, 62);
    var aw = x.measureText('agsist').width; x.font = '700 20px ' + FONT; x.fillStyle = '#d4a23f'; x.fillText('.com', 50 + aw, 62);
    var mark = 50 + aw + x.measureText('.com').width + 32;
    var k = fitLines(meas('600'), (sh.kicker ? sh.kicker + ' · ' : '') + (sh.dateText || (sh.date ? long(sh.date) : cfg.period === 'year' ? dayOf(cfg, view.to) : long(view.to))), W - 48 - mark, [20, 18, 16], 1);
    x.font = '600 ' + k.size + 'px ' + FONT; x.fillStyle = 'rgba(233,237,235,.72)'; x.textAlign = 'right'; x.fillText(hy(k.lines[0]), W - 48, 60); x.textAlign = 'left';
    var hd = fitLines(meas('800'), st.head, W - 96, [38, 34, 30, 28], 1); if (hd.over) hd = fitLines(meas('800'), st.head, W - 96, [38, 34, 30, 27], 2, true); var y = 80 + hd.size;
    x.font = '800 ' + hd.size + 'px ' + FONT; x.fillStyle = '#e9edeb';
    hd.lines.forEach(function (l) { x.fillText(hy(l), 48, y); y += hd.size * 1.2; });
    if (st.take) {
      var tk = fitLines(meas('400'), st.take, W - 96, [25, 22, 20, 18], 2);
      x.font = '400 ' + tk.size + 'px ' + FONT; x.fillStyle = 'rgba(233,237,235,.86)';
      tk.lines.forEach(function (l, i) { x.fillText(hy(l), 48, y + 2 + i * tk.size * 1.25); }); y += tk.lines.length * tk.size * 1.25 + 8;
    }
    var src = fitLines(meas('400'), typeof sh.source === 'function' ? sh.source(view) : sh.source || '', W - 96, [17, 16, 15], 1), url = fitLines(meas('700'), String(sh.url || '').replace(/^https?:\/\//, ''), W - 96, [20, 18], 1);
    var foot = cfg.foot ? fitLines(meas('400'), footOf(cfg, view), W - 96, [17, 16, 15], 2) : null, below = foot ? 76 + 22 * foot.lines.length + 6 : 66;
    var img = new root.Image();
    img.onload = function () {
      x.drawImage(img, 24, y + 4);
      var sz = foot ? Math.min(src.size, foot.size) : src.size; if (foot) { x.font = '400 ' + sz + 'px ' + FONT; x.fillStyle = 'rgba(233,237,235,.72)'; foot.lines.forEach(function (l, i) { x.fillText(hy(l), 48, H - 72 - (foot.lines.length - 1 - i) * 22); }); }
      x.font = '400 ' + sz + 'px ' + FONT; x.fillStyle = 'rgba(233,237,235,.72)'; x.fillText(hy(src.lines[0]), 48, foot ? H - 46 : H - 40);
      x.font = '700 ' + url.size + 'px ' + FONT; x.fillStyle = '#d4a23f'; x.fillText(url.lines[0], 48, foot ? H - 18 : H - 14);
      c.toBlob(function (b) { done(b); }, 'image/png');
    };
    img.onerror = function () { done(null); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(view, W - 64, Math.max(200, Math.round(H - y - below)), { fs: cfg.legend ? 17 : 18, card: true, cfg: cfg }));
  }
  function ga(n, kit) { try { if (typeof root.gtag === 'function') root.gtag('event', n, { kit: kit }); } catch (e) {} }

  function mount(el, cfg) {
    var rs = ranges(cfg), cur = rs.filter(function (r) { return r.label === cfg.range; })[0] || rs[rs.length - 1];
    var hide = {}, lastW = 0, view = null, animated = false, kit = (cfg.share && cfg.share.file) || 'chart';
    var reduce = false; try { reduce = root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    el.classList.add('agc');
    el.innerHTML = (rs.length > 1 ? '<div class="agc-ctl" role="group" aria-label="Range">' + rs.map(function (r) {
      return '<button type="button" class="agc-rg" data-days="' + r.days + '" aria-pressed="' + (r === cur) + '" aria-label="Show ' + esc(r.aria || r.label) + '">' + esc(r.label) + '</button>';
    }).join('') + '</div>' : '') + '<div class="agc-plot"></div><p class="agc-read" aria-live="polite"></p>' +
      (cfg.legend ? '<div class="agc-key" role="group" aria-label="Lines on the chart" hidden></div>' : '') +
      (cfg.foot ? '<p class="agc-foot"></p>' : '') + (cfg.share && typeof cfg.share.source === 'string' && cfg.share.source ? '<p class="agc-src">' + esc(cfg.share.source) + '</p>' : '');
    var plot = el.querySelector('.agc-plot'), read = el.querySelector('.agc-read'), keyEl = el.querySelector('.agc-key'), hh = cfg.height || {};
    var narrow = function (w) { return w < (cfg.legend ? 720 : 520); };
    var fit = function () { plot.style.height = (narrow(cfg.legend ? plot.clientWidth || el.clientWidth : el.clientWidth) ? hh.phone || 200 : hh.wide || 280) + 'px'; };
    fit();
    var keyOn = false;
    var say = function (d) {
      if (keyOn && keyEl) { var iso = /^\d{4}-\d{2}-\d{2}$/.test(d); return (d === view.to ? 'Latest, ' : '') + (iso ? long(d) : d) + (cfg.keyNote ? ' ' + cfg.keyNote : ''); }
      return cfg.legend ? hy(readout(cfg, view, d)) : readout(cfg, view, d);
    };
    var keyDay = function (d) {
      if (!keyOn || !keyEl) return;
      [].slice.call(keyEl.querySelectorAll('.agc-krow')).forEach(function (r) {
        var sr = ser(view, r.getAttribute('data-k')), v = sr ? (cfg.valueAt ? cfg.valueAt(sr.key, d) : (function () { var p = null; sr.points.forEach(function (q) { if (q.d <= d) p = q; }); return p ? fmtOf(cfg)(p.v) : ''; })()) : '';
        r.querySelector('.agc-kv').textContent = v || 'none';
      });
    };
    var latest = function () { read.textContent = say(view.to); keyDay(view.to); };
    var reserve = function () {
      var days = {}; days[view.to] = 1; view.series.forEach(function (s) { s.points.forEach(function (p) { days[p.d] = 1; }); });
      var ks = Object.keys(days), stepN = Math.max(1, Math.ceil(ks.length / 150));
      var keep = read.textContent, hmax = 0; read.style.minHeight = '0';
      ks.forEach(function (d, i) { if (i % stepN && d !== view.to) return; read.textContent = say(d); hmax = Math.max(hmax, read.offsetHeight); });
      read.textContent = keep; read.style.minHeight = hmax + 'px';
    };
    function draw(force) {
      var W = Math.round(plot.clientWidth); if (!W || (W === lastW && !force)) return; lastW = W;
      fit();
      var H = narrow(W) ? hh.phone || 200 : hh.wide || 280, fs = W < 520 ? 12 : 13;
      keyOn = !!cfg.legend && W < 720;
      view = slice(cfg, cur.days);
      var st = cfg.story ? cfg.story(view) : {};
      if (cfg.headEl) cfg.headEl.textContent = cfg.legend ? hy(st.head || '') : st.head || '';
      if (cfg.takeEl) cfg.takeEl.textContent = cfg.legend ? hy(st.take || '') : st.take || '';
      if (cfg.noteEl) cfg.noteEl.textContent = st.note || '';
      var opt = { fs: fs, hide: hide, hover: true, label: st.summary, cfg: cfg };
      plot.innerHTML = svg(view, W, H, opt);
      var lay = layout(view, W, H, opt), g = lay.g, hov = plot.querySelector('.agc-hov'), hit = plot.querySelector('.agc-hit');
      if (keyEl) {
        keyEl.hidden = !keyOn;
        keyEl.innerHTML = keyOn ? lay.order.map(function (s) {
          var c = s.color, dash = s.dash ? dashOf(s.dash, 13) : '', off = !!hide[s.key];
          return '<button type="button" class="agc-krow" data-k="' + esc(s.key) + '" aria-pressed="' + !off + '" aria-label="' + (off ? 'Show ' : 'Hide ') + esc(s.name) + '"' + (off ? ' data-off="1"' : '') + '>' +
            '<svg class="agc-ksw" width="36" height="14" viewBox="0 0 36 14" aria-hidden="true"><line x1="1" x2="35" y1="7" y2="7" style="stroke:' + c + ';stroke-width:2.5' + (dash ? ';stroke-dasharray:' + dash : '') + '"/><circle cx="31" cy="7" r="4" style="fill:' + c + '"/></svg>' +
            '<span class="agc-kn">' + esc(hy(s.name)) + '</span><span class="agc-kv"></span></button>';
        }).join('') : '';
        if (keyOn) [].slice.call(keyEl.querySelectorAll('.agc-krow')).forEach(function (b) {
          b.addEventListener('click', function () { var k = b.getAttribute('data-k'); hide[k] = !hide[k]; draw(true); var n = keyEl.querySelector('.agc-krow[data-k="' + k + '"]'); if (n) n.focus(); });
        });
      }
      var fe = el.querySelector('.agc-foot'); if (fe) fe.textContent = footOf(cfg, view);
      reserve(); latest();
      var move = function (ev) {
        var r = plot.getBoundingClientRect(), d = g.day((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left);
        var main = view.series.filter(function (s) { return !s.faint && s.points.length; });
        if (cfg.legend) {   // any day: each line is held flat between its changes
          d = d < view.from ? view.from : d > view.to ? view.to : d;
          var XD = f1(g.x(d)); hov.firstChild.setAttribute('x1', XD); hov.firstChild.setAttribute('x2', XD);
          [].slice.call(hov.querySelectorAll('circle')).forEach(function (cEl) {
            var s = ser(view, cEl.getAttribute('data-k')), p = null; if (s) s.points.forEach(function (q) { if (q.d <= d) p = q; });
            var on = p && !hide[s.key] && (!cfg.valueAt || cfg.valueAt(s.key, d));
            cEl.setAttribute('visibility', on ? 'visible' : 'hidden');
            if (on) { cEl.setAttribute('cx', XD); cEl.setAttribute('cy', f1(g.y(p.v) + ((lay.off || {})[s.key] || 0))); }
          });
          hov.setAttribute('visibility', 'visible'); read.textContent = say(d); keyDay(d); return;
        }
        if (!cfg.ownGaps && gapAt(cfg, main[0].points, d)) { hov.setAttribute('visibility', 'hidden'); read.textContent = say(d); keyDay(d); return; }
        var p0 = near(main[0].points, d), X = f1(g.x(p0.d));
        hov.firstChild.setAttribute('x1', X); hov.firstChild.setAttribute('x2', X);
        [].slice.call(hov.querySelectorAll('circle')).forEach(function (cEl) {
          var s = ser(view, cEl.getAttribute('data-k')), p = s && near(s.points, p0.d), on = p && p.d === p0.d && !hide[s.key];
          cEl.setAttribute('visibility', on ? 'visible' : 'hidden');
          if (on) { cEl.setAttribute('cx', X); cEl.setAttribute('cy', f1(g.y(p.v) + ((lay.off || {})[s.key] || 0))); }
        });
        hov.setAttribute('visibility', 'visible'); read.textContent = say(p0.d); keyDay(p0.d);
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
            var L = p.getTotalLength ? p.getTotalLength() : 0; if (!L || p.style.strokeDasharray) return;
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
    if (cfg.tools && cfg.share) tools(cfg, function () { return view; }, cfg.legend ? null : read);
    return { redraw: function () { draw(true); }, state: function () { return { view: view, hide: hide, range: cur.label }; } };
  }
  function tools(cfg, getView, read) {
    var T = cfg.tools, sh = cfg.share, nav = root.navigator || {}, canFiles = false, D = T.ownerDocument;
    try { canFiles = !!(nav.share && nav.canShare && root.File && nav.canShare({ files: [new root.File([''], 'x.png', { type: 'image/png' })] })); } catch (e) {}
    T.innerHTML = (canFiles ? '<button type="button" class="agc-btn agc-share">Share</button>' : '<button type="button" class="agc-btn agc-copy">Copy link</button>') +
      '<button type="button" class="agc-btn agc-save">Save the picture</button>';
    if (read) T.insertBefore(read, T.firstChild);   // the readout left, the buttons right, one row
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
    short: short, long: long, money: money, dayOf: dayOf, hy: hy };
  root.AgChart = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
