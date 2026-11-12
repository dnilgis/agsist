/* components/ag-chart.js: the shared chart kit (Nov 11, 2026). Every chart: a headline from the data, lines
   named at their right end with the latest value, labelled axes and dates, every report day marked, missing
   days shown as missing, a hover / tap readout, Share and a save-the-picture card that stands alone,
   keyboard and screen reader use, reduced motion, a reserved height. Plain SVG and JS, no library.
   Styles: components/ag-chart.css. AgChart.mount(el, cfg) draws into an empty el, returns { redraw, state }.
   cfg:
     series   [{ key, name, points: [{ d: 'YYYY-MM-DD', v }], color (page CSS), card (picture colour),
                 faint: true (dashed, muted, under, keyed on the top row; note: its key; pending: the top
                 row while it has no points, pendingShort when narrow), toggle: false (no hide/show),
                 step: true (a value holds flat to the next point), until: 'YYYY-MM-DD' (held flat to it) }]
              a point may carry b: 'YYYY-MM-DD' (nothing held from that day to it: a gap) and m: true (a
              thin mark: what the value is quoted against changed there)
     bands    [{ a: key, b: key, color, card, opacity, cardOpacity, end(p), start(p): label text for the
                 last and first shared day, p = { d, a, b, v: a minus b } }]  shaded between two series
     gaps     missing days: 'weekdays' (a weekday with no point), a number of calendar days (a longer step
              is a gap), or left out: each series by its own normal spacing. A gap is dashed and lighter,
              the band breaks, the readout says "No report ..."
     fmt      v -> value text (default '$' + 2 decimals); tick(v) -> axis text; unit ('$/cwt'); pad: least
              room above and below the values (0.25)
     period   'year': one point a year, dated 'YYYY-01-01'; axis, readout and gaps say '2015'
     gapWord  the readout's word for a missing point ('report'; 'survey')
     ranges   [{ label: '3M', days: 92, aria }], days 0 = all; shown only when the held days run past it
              with minPoints (5) in it; 'All' always. range: the label to open on
     story(view, forCard) -> { head, take, summary } for the range shown (forCard: the picture's own words) (view = { series, from, to, days }); head
              and take go into cfg.headEl / cfg.takeEl, summary is the SVG's aria-label
     readout(view, day) -> the readout line (default: each value that day); ownGaps: true, it names
              missing days itself (else the first line's gaps speak for all)
     height   { phone: 200, wide: 280 }, reserved in CSS
   legend   true (several named lines, Nov 12, 2026, E53): no label is drawn inside the plot. From 600 px of chart (and on the
              picture) the names sit in a right gutter (300 px; names wrap, none is cut, a leader line to each line's end),
              sorted by value then name; under 720 px the plot takes the whole width and a key under it lists every
              line, one 44 px row each: swatch, full name, value (the rows hide and show a line)
   valueAt(key, day) -> a line's value text for the key rows (default: its held value)
   axisTitle  the axis title, top left ('Basis vs futures, cents a bushel'); intTicks: whole-number tick steps (1, 2, 5, 10);
              fixedTicks: the same number of ticks at every size
   weekly     true: date ticks on Mondays (every second Monday when crowded) and the last day, at every size
   clip       true: the axis keeps to the values that hold (a stretch far outside the rest is drawn in a marked break below or
              above the plot, its value and days printed, 'off the scale'); clipMin: the least spread counted (10)
   markLabel(point, series) -> the words on a thin vertical mark; markMany: the words when marks crowd ('reference changed')
   gapNote    words under a dashed stretch of a step line ('no bid posted'); foot: a note under the picture and the page chart
   series     also { dash: '9 4' } so a line survives colour blindness and print
     tools    element for the buttons: Share (picture and link, where files can be shared) or Copy link,
              and Save the picture
     share    { url, title, file, kicker: card top line, source: the source line (card foot and under the chart), date: 'YYYY-MM-DD' }
   Labels never overlap a line, a point, another label or the axes: where they belong, nudged, else
   outside on the right. AgChart.svg, card, layout (label boxes,
   segments, points: the tests check overlaps), slice, pairs, ranges, gapAt, ruleOf, fitLines.
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
  function dayOf(cfg, s) { return cfg && cfg.period === 'year' ? s.slice(0, 4) : short(s); }
  function money(v) { return '$' + v.toFixed(2); }
  function fmtOf(cfg) { return cfg.fmt || money; }
  function f1(v) { return v.toFixed(1); }

  /* ------------------------------------------------------------ data */
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

  /* ------------------------------------------------------------ geometry and label placement */
  function ticks(lo, hi, n, whole) {
    var raw = (hi - lo || 1) / n, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), st = mag;
    (whole ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]).some(function (m) { st = m * mag; return st >= raw; });
    var out = []; for (var t = Math.ceil(lo / st) * st; t <= hi + 1e-9; t += st) out.push(+t.toFixed(6));
    return out;
  }
  /* the values that hold, for a chart with clip: the daily values (each line held to its next point) leave out
     any beyond three spreads of the middle half, so one stray bid for a few days does not flatten every line.
     -> { lo, hi, ranges: [{ v, from, to }] } or null when nothing is that far out */
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
  function geom(view, W, H, fs, hide, gutter, cfg) {
    var all = [];
    cfg = cfg || {};
    view.series.forEach(function (s) { if (!hide[s.key]) s.points.forEach(function (p) { all.push(p.v); }); });
    if (!all.length) view.series.forEach(function (s) { s.points.forEach(function (p) { all.push(p.v); }); });
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), cl = clipOf(view, hide, cfg), below = false, above = false;
    if (cl) { below = lo < cl.lo; above = hi > cl.hi; lo = cl.lo; hi = cl.hi; }
    var pad = Math.max((hi - lo) * 0.03, cfg.pad || 0.25);
    lo -= pad; hi += pad;
    var nt = cfg.fixedTicks ? 5 : W / fs < 40 ? 4 : 5, tk = ticks(lo, hi, nt, cfg.intTicks), st = tk.length > 1 ? tk[1] - tk[0] : 1;   // the axis runs to a tick at both ends
    lo = Math.min(lo, Math.floor(lo / st) * st); hi = Math.max(hi, Math.ceil(hi / st) * st);
    var tks = []; for (var tv = lo; tv <= hi + st * 1e-6; tv += st) tks.push(+tv.toFixed(6));   // the drawn ticks: the same step, end to end
    var L = Math.round(fs * (W < 420 ? 3.4 : 3.9)), R = Math.round(fs * 0.8) + (gutter || 0), T = Math.round(fs * 3), B = Math.round(fs * 2.2), lab = Math.round(fs * 1.4);
    if (cfg.tick && cfg.legend) L = Math.ceil(Math.max.apply(null, tks.map(function (v) { return widthOf(cfg.tick(v), fs, true); })) + fs * 1.1);   // room for the longest tick
    var bandB = below ? Math.round(fs * 2.4) : 0, bandT = above ? Math.round(fs * 2.4) : 0;
    T += bandT; lab += bandB;
    var t0 = utc(view.from), dt = Math.max(utc(view.to) - t0, 864e5);
    var yIn = function (v) { return T + (hi - v) / (hi - lo) * (H - T - B - lab); };
    return { L: L, R: R, T: T, B: B, W: W, H: H, fs: fs, lo: lo, hi: hi, nt: nt, tk: tks, base: H - B - fs * 0.6, right: W - R,
      clip: cl ? { lo: cl.lo, hi: cl.hi, below: below, above: above, ranges: cl.ranges, yLo: yIn(lo), yHi: yIn(hi), bandB: bandB, bandT: bandT } : null,
      x: function (d) { return L + (utc(d) - t0) / dt * (W - L - R); },
      y: function (v) {
        if (cl && v < cl.lo - 1e-9 && below) return yIn(lo) + bandB * 0.62;
        if (cl && v > cl.hi + 1e-9 && above) return T - bandT * 0.55;
        return yIn(v);
      },
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
  /* lines that share a value on a day are drawn a little apart, so none hides another: -> { key: px } */
  function tieOffsets(view, hide) {
    var main = view.series.filter(function (s) { return !s.faint && s.points.length && !hide[s.key]; }), days = {}, held = function (s, d) { var v = null; s.points.forEach(function (p) { if (p.d <= d) v = p.v; }); return v; };
    main.forEach(function (s) { s.points.forEach(function (p) { days[p.d] = 1; }); days[view.to] = 1; });
    var tied = {};
    Object.keys(days).forEach(function (d) {
      var by = {}; main.forEach(function (s) { var v = held(s, d); if (v != null && !(s.until && d > s.until) ) (by[v] = by[v] || []).push(s.key); });
      Object.keys(by).forEach(function (v) { if (by[v].length > 1) by[v].forEach(function (k) { tied[k] = 1; }); });
    });
    var keys = main.map(function (s) { return s.key; }).filter(function (k) { return tied[k]; }), off = {};
    keys.forEach(function (k, i) { off[k] = (i - (keys.length - 1) / 2) * 2.5; });
    return off;
  }
  /* the order the names are listed in: the value now, best first, then the name; hidden lines last */
  function listOrder(view, hide) {
    var main = view.series.filter(function (s) { return !s.faint && s.points.length; });
    var cmp = function (a, b) { var d = b.s.points[b.s.points.length - 1].v - a.s.points[a.s.points.length - 1].v; return d || (a.s.name < b.s.name ? -1 : a.s.name > b.s.name ? 1 : 0); };
    var m = function (s) { return { s: s }; };
    return main.filter(function (s) { return !hide[s.key]; }).map(m).sort(cmp).concat(main.filter(function (s) { return hide[s.key]; }).map(m).sort(cmp)).map(function (e) { return e.s; });
  }
  /* wrap text into lines of at most maxW px at size fs (bold); a word is never cut */
  function wrapText(text, fs, maxW, bold) {
    var lines = [], cur = '';
    String(text).split(' ').forEach(function (w) { var x = cur ? cur + ' ' + w : w; if (widthOf(x, fs, bold) > maxW && cur) { lines.push(cur); cur = w; } else cur = x; });
    if (cur) lines.push(cur);
    return lines;
  }
  function legendOn(cfg, W, opt) { return !!cfg.legend && (!!opt.card || W >= 720); }
  function layout(view, W, H, opt) {
    var fs = opt.fs || 12, hide = opt.hide || {}, cfg = opt.cfg || {}, fmt = fmtOf(cfg), rules = {};
    var gutter = opt.gutter || (legendOn(cfg, W, opt) ? (opt.card ? 400 : 300) : 0), g = geom(view, W, H, fs, hide, gutter, cfg), segs = [], dots = [], runs = [], boxes = [], labels = [], out = [];
    var off = cfg.legend ? tieOffsets(view, hide) : {};
    view.series.forEach(function (s) {
      if (!s.points.length || hide[s.key]) return;
      var dy = off[s.key] || 0;
      var pts = s.points.map(function (p) { return { d: p.d, v: p.v, x: g.x(p.d), y: g.y(p.v) + dy }; });
      var run = [pts[0]], rule = rules[s.key] = ruleOf(cfg, s.points);
      for (var i = 1; i < pts.length; i++) {
        var gap = !s.faint && (s.points[i].b || missing(pts[i - 1].d, pts[i].d, rule)), q = pts[i - 1];
        if (s.step && gap) {
          // a step line: held flat to the day the gap began, then flat and dashed at the last value, then the step
          var gx = s.points[i].b && s.points[i].b > pts[i - 1].d ? Math.min(g.x(s.points[i].b), pts[i].x) : pts[i - 1].x, hold = { x: gx, y: q.y };
          if (gx > q.x) { segs.push({ x1: q.x, y1: q.y, x2: gx, y2: q.y, key: s.key }); run.push(hold); }
          runs.push({ s: s, pts: run });
          var corner = { x: pts[i].x, y: q.y };
          segs.push({ x1: gx, y1: q.y, x2: corner.x, y2: q.y, key: s.key, gap: true }, { x1: corner.x, y1: q.y, x2: pts[i].x, y2: pts[i].y, key: s.key, gap: true });
          runs.push({ s: s, pts: [hold, corner, pts[i]], gap: true, note: { x0: gx, x1: corner.x, y: q.y } });
          run = [pts[i]]; continue;
        }
        if (s.step && !gap) { q = { x: pts[i].x, y: q.y }; segs.push({ x1: pts[i - 1].x, y1: q.y, x2: q.x, y2: q.y, key: s.key }); run.push(q); }
        segs.push({ x1: q.x, y1: q.y, x2: pts[i].x, y2: pts[i].y, key: s.key, gap: !!gap });
        if (gap) { runs.push({ s: s, pts: run }); runs.push({ s: s, pts: [pts[i - 1], pts[i]], gap: true }); run = [pts[i]]; } else run.push(pts[i]);
      }
      var z = pts[pts.length - 1], endX = z.x;
      if (s.until > z.d) { q = { x: g.x(s.until), y: z.y }; segs.push({ x1: z.x, y1: z.y, x2: q.x, y2: q.y, key: s.key }); run.push(q); endX = q.x; }
      runs.push({ s: s, pts: run });
      // the latest dot sits at the line's right end (today for a held line), the small ones at each logged change
      if (!s.faint) {
        pts.forEach(function (p, j) { dots.push({ x: p.x, y: p.y, r: Math.max(1.6, fs / 6), s: s, last: false }); });
        if (cfg.legend) dots.push({ x: endX, y: z.y, r: fs / 4 + 1.2, s: s, last: true });
        else dots[dots.length - 1] = { x: z.x, y: z.y, r: fs / 3 + 1, s: s, last: true };
      }
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
    if (cfg.legend) {
      var legend = legendOn(cfg, W, opt) ? legendLayout(view, g, runs, off, hide, fmt, opt, fs) : null;
      return { g: g, segs: segs, dots: dots, runs: runs, labels: [], boxes: [], rules: rules, off: off, legend: legend, order: listOrder(view, hide) };
    }
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
      var wide = Math.max.apply(null, labels.map(function (L) { return widthOf(L.text, fs, L.bold); }));
      return layout(view, W, H, Object.assign({}, opt, { gutter: Math.min(Math.round(wide + fs * 1.4), Math.round(W * 0.4)) }));
    }
    return { g: g, segs: segs, dots: dots, runs: runs, labels: out, boxes: boxes, rules: rules, off: off };
  }
  /* the names in the right gutter: wrapped, in value order, each pulled apart from the next, with the y of its line's end */
  function legendLayout(view, g, runs, off, hide, fmt, opt, fs) {
    var order = listOrder(view, hide), card = !!opt.card, x0 = g.right + (card ? 26 : 22), maxW = g.W - x0 - 2;
    var ends = {}; runs.forEach(function (r) { if (!r.gap && !r.s.faint) { var p = r.pts[r.pts.length - 1]; ends[r.s.key] = p; } });
    var fl = card ? [18, 17, 16, 15] : [fs], items, lh, top = g.T, bot = g.base;
    for (var f = 0; f < fl.length; f++) {
      var lfs = fl[f]; lh = lfs * 1.25;
      items = order.map(function (s) {
        var last = s.points[s.points.length - 1], val = fmt(last.v), words = s.name.split(' '), tail = words.pop() + ' ' + val;
        var lines = wrapText(words.concat([tail.replace(' ', '\u00a0')]).join(' '), lfs, maxW, true).map(function (l) { return l.replace(/\u00a0/g, ' '); });   // the value stays with the last word
        var e = ends[s.key], hid = !!hide[s.key];
        return { s: s, lines: lines, h: lines.length * lh, ye: e ? e.y : null, xe: e ? e.x : null, hidden: hid, fs: lfs };
      });
      var need = items.reduce(function (a, it) { return a + it.h + lfs * 0.5; }, 0);
      if (need <= bot - top + lfs || f === fl.length - 1) break;
    }
    // vertical positions: as near each line's end as the others allow, kept inside the plot
    var gap = items.length ? items[0].fs * 0.5 : 0, y = top;
    items.forEach(function (it) { var want = (it.ye == null ? bot : it.ye) - it.h / 2; it.y = Math.max(y, want); y = it.y + it.h + gap; });
    var limit = bot + (items.length ? items[0].fs : 0);
    for (var k = items.length - 1; k >= 0; k--) { var cap = k === items.length - 1 ? limit : items[k + 1].y - gap; if (items[k].y + items[k].h > cap) items[k].y = cap - items[k].h; }
    items.forEach(function (it) { it.x = x0; it.box = { x0: x0 - 4, x1: g.W, y0: it.y - 2, y1: it.y + it.h + 2 }; });
    return { items: items, x: x0, fs: items.length ? items[0].fs : fs, lh: lh };
  }

  /* ------------------------------------------------------------ the SVG */
  function txt(x, y, s, st, anchor, cls) { return '<text' + (cls ? ' class="' + cls + '"' : '') + ' x="' + f1(x) + '" y="' + f1(y) + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + ' style="' + st + '">' + esc(s) + '</text>'; }
  function dashOf(d, fs) { var k = fs / 13; return String(d).split(' ').map(function (n) { return (+n * k).toFixed(1); }).join(' '); }
  function poly(pts) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + f1(p.x) + ' ' + f1(p.y); }).join(''); }

  /* date ticks on Mondays, every second Monday when they would crowd, and the last day closing the axis */
  function weeklyTicks(view, g, fs) {
    var t0 = utc(view.from), t1 = utc(view.to), mons = [], t = t0;
    while (new Date(t).getUTCDay() !== 1 && t <= t1) t += 864e5;
    for (; t <= t1; t += 7 * 864e5) mons.push(isoOf(t));
    var need = fs * 6.2;
    if (mons.length > 1 && g.x(mons[1]) - g.x(mons[0]) < need) mons = mons.filter(function (d, i) { return i % 2 === 0; });
    var last = view.to, out = mons.filter(function (d) { return g.x(last) - g.x(d) >= fs * 5.6 && g.x(d) - g.L >= 0; });
    out.push(last);
    return out;
  }
  /* opt: { fs, hide: {key: true}, card: true (literal colours), hover: true, label, cfg } */
  function svg(view, W, H, opt) {
    var fs = opt.fs || 12, hide = opt.hide || {}, P = opt.card ? CARD : PAGE, cfg = opt.cfg || {};
    var col = function (s) { return opt.card ? s.card || s.color : s.color; };
    var lay = layout(view, W, H, opt), g = lay.g, f = 'font-size:' + fs + 'px;font-family:' + FONT + ';', fb = f + 'font-weight:700;', o = [];
    var halo = 'paint-order:stroke;stroke:' + P.surf + ';stroke-width:' + (fs / 3.5).toFixed(1) + 'px;stroke-linejoin:round;';
    o.push('<svg xmlns="http://www.w3.org/2000/svg" class="agc-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '"' + (opt.label ? ' role="img" aria-label="' + esc(opt.label) + '"' : '') + '>');
    o.push(cfg.axisTitle ? txt(0, fs * 1.2, cfg.axisTitle, f + 'fill:' + P.dim, 'start', 'agc-at') : txt(g.L - fs * 0.5, fs * 1.2, cfg.unit || '', f + 'fill:' + P.mut, 'end'));
    g.tk.forEach(function (v) {
      var y = g.y(v);
      o.push('<line x1="' + g.L + '" x2="' + f1(g.right) + '" y1="' + f1(y) + '" y2="' + f1(y) + '" style="stroke:' + P.grid + ';stroke-width:1"/>');
      o.push(txt(g.L - fs * 0.5, y + fs * 0.35, cfg.tick ? cfg.tick(v) : '$' + (v % 1 ? v.toFixed(1) : v), f + 'fill:' + P.dim, 'end'));
    });
    o.push('<line x1="' + g.L + '" x2="' + f1(g.right) + '" y1="' + f1(g.base) + '" y2="' + f1(g.base) + '" style="stroke:' + P.mut + ';stroke-width:1"/>');
    var marks = [], drawn = {};
    view.series.forEach(function (s) { if (!hide[s.key]) s.points.forEach(function (p) { if (p.m) {
      if (!drawn[p.d]) o.push('<line class="agc-mk" x1="' + f1(g.x(p.d)) + '" x2="' + f1(g.x(p.d)) + '" y1="' + g.T + '" y2="' + f1(g.base) + '" style="stroke:' + P.mut + ';stroke-dasharray:2 3"/>');
      drawn[p.d] = 1;
      var t = cfg.markLabel ? cfg.markLabel(p, s) : '';
      if (t && !marks.some(function (m) { return m.d === p.d && m.t === t; })) marks.push({ d: p.d, t: t, x: g.x(p.d) });
    } }); });
    if (marks.length) {   // each vertical mark says what it is, at the top of its line; marks too close to speak apart say it once
      marks.sort(function (a, b) { return a.x - b.x; });
      var ms = fs - 1, mw = function (t) { return widthOf(t, ms) + 8; }, merged = [];
      marks.forEach(function (m) {
        var last = merged[merged.length - 1];
        if (last && (m.x - last.x < mw(last.t) + 6 || Math.abs(m.x - last.x) < 30)) { last.t = cfg.markMany || 'reference changed'; last.many = true; } else merged.push({ d: m.d, t: m.t, x: m.x });
      });
      var prev = -1e9;
      merged.forEach(function (m) {
        var w = mw(m.t), right = m.x + 4 + w > g.right, x = right ? m.x - 4 : m.x + 4;
        if (!right && x < prev + 6) return;
        prev = right ? x : x + w;
        o.push(txt(x, fs * 2.5, m.t, 'font-size:' + ms + 'px;font-family:' + FONT + ';fill:' + P.dim + ';' + halo, right ? 'end' : 'start', 'agc-mkl'));
      });
    }
    // dates under the axis: evenly spread, each on the nearest report day (any line's; a held line's end), with room
    var days = Math.round((utc(view.to) - utc(view.from)) / 864e5), want = Math.min(days + 1, (g.right - g.L) / fs < 34 ? 3 : 6), dts = [];
    var rep0 = [];
    view.series.forEach(function (s) { if (!s.faint) rep0 = rep0.concat(s.points, s.until ? [{ d: view.to }] : []); });
    if (cfg.weekly) dts = weeklyTicks(view, g, fs);
    else for (var i = 0; i < want; i++) {
      var dd = isoOf(utc(view.from) + Math.round(i * days / Math.max(1, want - 1)) * 864e5), np = rep0.length ? near(rep0, dd) : null;
      if (np) dd = np.d;
      if (!dts.length || (dd > dts[dts.length - 1] && g.x(dd) - g.x(dts[dts.length - 1]) >= fs * (i === want - 1 ? 6.6 : 4.4))) dts.push(dd);
      else if (i === want - 1 && dts.length > 1 && dd > dts[dts.length - 1]) dts[dts.length - 1] = dd;   // the latest day always closes the axis
    }
    dts.forEach(function (d, j) { var x = g.x(d); o.push(txt(x, H - fs * 0.5, dayOf(cfg, d), f + 'fill:' + P.dim, j === dts.length - 1 ? 'end' : (x - g.L < fs * 2 ? 'start' : 'middle'))); });
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
    if (g.clip && (g.clip.below || g.clip.above)) {   // the break: a zigzag on the axis, a light rule, and what was left off the scale in words
      var drawBreak = function (y, label) {
        o.push('<line x1="' + g.L + '" x2="' + f1(g.right) + '" y1="' + f1(y) + '" y2="' + f1(y) + '" style="stroke:' + P.mut + ';stroke-width:1;stroke-dasharray:1 4"/>');
        o.push('<path d="M' + f1(g.L - 6) + ' ' + f1(y + 3) + 'L' + f1(g.L - 2) + ' ' + f1(y - 1) + 'L' + f1(g.L + 2) + ' ' + f1(y + 3) + 'L' + f1(g.L + 6) + ' ' + f1(y - 1) + '" style="fill:none;stroke:' + P.dim + ';stroke-width:1.5"/>');
        if (label) { var wl = widthOf(label.t, fs), lx = Math.max(g.L + 6, label.x), endA = lx + wl > g.right - 6; o.push(txt(endA ? g.right - 6 : lx, label.y, label.t, f + 'fill:' + P.dim + ';' + halo, endA ? 'end' : 'start', 'agc-off')); }
      };
      var lows = g.clip.ranges.filter(function (r) { return r.v < g.clip.lo; }), highs = g.clip.ranges.filter(function (r) { return r.v > g.clip.hi; });
      var say = function (rs) { return rs.map(function (r) { return fmtOf(cfg)(r.v) + ', ' + (r.from === r.to ? dayOf(cfg, r.from) : dayOf(cfg, r.from) + ' to ' + dayOf(cfg, r.to)); }).join('; ') + ' (off the scale)'; };
      if (g.clip.below && lows.length) drawBreak(g.clip.yLo + g.clip.bandB * 0.08, { t: say(lows), x: lows.length === 1 ? g.x(lows[0].from) - fs * 0.5 : g.L + 6, y: g.clip.yLo + g.clip.bandB * 0.62 + fs * 1.25 });
      if (g.clip.above && highs.length) drawBreak(g.clip.yHi - g.clip.bandT * 0.08, { t: say(highs), x: highs.length === 1 ? g.x(highs[0].from) - fs * 0.5 : g.L + 6, y: g.clip.yHi - g.clip.bandT * 0.55 - fs * 0.9 });
    }
    var lw = Math.max(2, fs / 6);
    lay.runs.filter(function (r) { return r.s.faint; }).concat(lay.runs.filter(function (r) { return !r.s.faint; })).forEach(function (r) {
      if (r.pts.length < 2) return;
      var st = r.s.faint ? 'stroke:' + P.mut + ';stroke-width:' + Math.max(1.5, fs / 8) + ';stroke-dasharray:' + fs / 3 + ' ' + fs / 3
        : r.gap ? 'stroke:' + col(r.s) + ';stroke-width:' + Math.max(1.5, lw * 0.75) + ';stroke-opacity:' + (cfg.legend ? '.75;stroke-linecap:round;stroke-dasharray:0.1 ' + (fs / 2.4).toFixed(1) : '.5;stroke-dasharray:' + fs / 4 + ' ' + fs / 3)
          : 'stroke:' + col(r.s) + ';stroke-width:' + lw + ';stroke-linejoin:round;stroke-linecap:' + (r.s.dash ? 'butt' : 'round') + (r.s.dash ? ';stroke-dasharray:' + dashOf(r.s.dash, fs) : '');
      o.push('<path class="agc-ln' + (r.gap ? ' agc-gap' : '') + '" d="' + poly(r.pts) + '" style="fill:none;' + st + '"/>');
      if (r.note && cfg.gapNote) {   // the words under a dashed stretch, when they fit under it
        var nw = widthOf(cfg.gapNote, fs - 1);
        if (r.note.x1 - r.note.x0 >= nw + 6) o.push(txt((r.note.x0 + r.note.x1) / 2, r.note.y + fs * 1.15, cfg.gapNote, 'font-size:' + (fs - 1) + 'px;font-family:' + FONT + ';fill:' + P.dim + ';' + halo, 'middle', 'agc-gn'));
      }
    });
    lay.dots.forEach(function (d) { o.push('<circle class="agc-dot' + (d.last ? ' agc-last' : '') + '" cx="' + f1(d.x) + '" cy="' + f1(d.y) + '" r="' + f1(d.r) + '" style="fill:' + col(d.s) + (d.last ? ';stroke:' + P.surf + ';stroke-width:' + (cfg.legend ? 1.5 : 2) : '') + '"/>'); });
    if (opt.hover) {
      o.push('<g class="agc-hov" visibility="hidden"><line y1="' + g.T + '" y2="' + f1(g.base) + '" style="stroke:' + P.mut + ';stroke-dasharray:3 3"/>' +
        view.series.filter(function (s) { return !s.faint && s.points.length; }).map(function (s) { return '<circle r="4" data-k="' + esc(s.key) + '" style="fill:' + col(s) + ';stroke:' + P.surf + ';stroke-width:2"/>'; }).join('') + '</g>');
      o.push('<rect class="agc-hit" x="' + g.L + '" y="' + g.T + '" width="' + f1(Math.max(0, g.right - g.L)) + '" height="' + f1(g.base - g.T) + '" fill="transparent"/>');
    }
    if (lay.legend) lay.legend.items.forEach(function (it) {
      var tog = it.s.toggle !== false && !opt.card, off = it.hidden, c = col(it.s), lf = it.fs, lh = lf * 1.25, b = it.box;
      var leader = '';
      if (it.ye != null) {
        var ly = it.y + lh * 0.62, xe = it.xe + (cfg.legend ? 7 : 5), xm = g.right + 8;
        leader = '<path class="agc-lead" d="M' + f1(xe) + ' ' + f1(it.ye) + 'L' + f1(Math.max(xe, xm)) + ' ' + f1(it.ye) + 'L' + f1(lay.legend.x - 6) + ' ' + f1(ly) + '" style="fill:none;stroke:' + c + ';stroke-width:1;stroke-opacity:.55"/>';
      }
      var fl = 'font-size:' + lf + 'px;font-family:' + FONT + ';font-weight:700;fill:' + c + (off ? ';opacity:.5;text-decoration:line-through' : '');
      o.push('<g class="agc-tog agc-leg"' + (tog ? ' data-k="' + esc(it.s.key) + '" tabindex="0" role="button" aria-pressed="' + !off + '" aria-label="' + (off ? 'Show ' : 'Hide ') + esc(it.lines.join(' ')) + '"' : '') + '>' + leader +
        (tog ? '<rect x="' + f1(b.x0) + '" y="' + f1(b.y0) + '" width="' + f1(b.x1 - b.x0) + '" height="' + f1(b.y1 - b.y0) + '" fill="transparent"/>' : '') +
        it.lines.map(function (l, i) { return txt(it.x, it.y + lf * 0.98 + i * lh, l, fl, 'start'); }).join('') + '</g>');
    });
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
  /* the largest size in sizes at which text wraps into maxLines within maxW; when even the smallest size
     needs more lines, it takes them (over: true): a word is never cut and no ellipsis is drawn. measure(text, size) -> px */
  function fitLines(measure, text, maxW, sizes, maxLines) {
    var lines = [];
    for (var i = 0; i < sizes.length; i++) {
      lines = []; var cur = '';
      String(text || '').split(' ').forEach(function (w) { var x = cur ? cur + ' ' + w : w; if (measure(x, sizes[i]) > maxW && cur) { lines.push(cur); cur = w; } else cur = x; });
      if (cur) lines.push(cur);
      if (lines.length <= maxLines && lines.every(function (l) { return measure(l, sizes[i]) <= maxW; })) return { size: sizes[i], lines: lines };
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
    var k = fitLines(meas('600'), (sh.kicker ? sh.kicker + ' · ' : '') + (sh.date ? long(sh.date) : cfg.period === 'year' ? dayOf(cfg, view.to) : long(view.to)), W - 48 - mark, [20, 18, 16], 1);
    x.font = '600 ' + k.size + 'px ' + FONT; x.fillStyle = 'rgba(233,237,235,.72)'; x.textAlign = 'right'; x.fillText(k.lines[0], W - 48, 60); x.textAlign = 'left';
    var hd = fitLines(meas('800'), st.head, W - 96, [38, 34, 30, 27], 2), y = 80 + hd.size;
    x.font = '800 ' + hd.size + 'px ' + FONT; x.fillStyle = '#e9edeb';
    hd.lines.forEach(function (l) { x.fillText(l, 48, y); y += hd.size * 1.2; });
    if (st.take) {
      var tk = fitLines(meas('400'), st.take, W - 96, [25, 22, 20, 18], 2);
      x.font = '400 ' + tk.size + 'px ' + FONT; x.fillStyle = 'rgba(233,237,235,.86)';
      tk.lines.forEach(function (l, i) { x.fillText(l, 48, y + 2 + i * tk.size * 1.25); }); y += tk.lines.length * tk.size * 1.25 + 8;
    }
    var src = fitLines(meas('400'), sh.source || '', W - 96, [18, 16, 15, 14], 1), url = fitLines(meas('700'), String(sh.url || '').replace(/^https?:\/\//, ''), W - 96, [20, 18], 1);
    var foot = cfg.foot ? fitLines(meas('400'), cfg.foot, W - 96, [16, 15, 14], 1) : null, below = foot ? 100 : 76;
    var img = new root.Image();
    img.onload = function () {
      x.drawImage(img, 24, y + 4);
      if (foot) { x.font = '400 ' + foot.size + 'px ' + FONT; x.fillStyle = 'rgba(233,237,235,.72)'; x.fillText(foot.lines[0], 48, H - 70); }
      x.font = '400 ' + src.size + 'px ' + FONT; x.fillStyle = 'rgba(233,237,235,.72)'; x.fillText(src.lines[0], 48, H - 46);
      x.font = '700 ' + url.size + 'px ' + FONT; x.fillStyle = '#d4a23f'; x.fillText(url.lines[0], 48, H - 18);
      c.toBlob(function (b) { done(b); }, 'image/png');
    };
    img.onerror = function () { done(null); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(view, W - 64, Math.max(200, Math.round(H - y - below)), { fs: cfg.legend ? 17 : 22, card: true, cfg: cfg }));
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
    }).join('') + '</div>' : '') + '<div class="agc-plot"></div><p class="agc-read" aria-live="polite"></p>' +
      (cfg.legend ? '<div class="agc-key" role="group" aria-label="Lines on the chart" hidden></div>' : '') +
      (cfg.foot ? '<p class="agc-foot">' + esc(cfg.foot) + '</p>' : '') + (cfg.share && cfg.share.source ? '<p class="agc-src">' + esc(cfg.share.source) + '</p>' : '');
    var plot = el.querySelector('.agc-plot'), read = el.querySelector('.agc-read'), keyEl = el.querySelector('.agc-key'), hh = cfg.height || {};
    var narrow = function (w) { return w < (cfg.legend ? 720 : 520); };
    var fit = function () { plot.style.height = (narrow(cfg.legend ? plot.clientWidth || el.clientWidth : el.clientWidth) ? hh.phone || 200 : hh.wide || 280) + 'px'; };
    fit();
    var keyOn = false;
    /* the words under the plot for a day: the config's readout; under 600 px with a key, only the day (the key holds the values) */
    var say = function (d) {
      if (keyOn && keyEl) { var iso = /^\d{4}-\d{2}-\d{2}$/.test(d); return (d === view.to ? 'Latest, ' : '') + (iso ? long(d) : d) + (cfg.keyNote ? ' ' + cfg.keyNote : ''); }
      return readout(cfg, view, d);
    };
    var keyDay = function (d) {
      if (!keyOn || !keyEl) return;
      [].slice.call(keyEl.querySelectorAll('.agc-krow')).forEach(function (r) {
        var sr = ser(view, r.getAttribute('data-k')), v = sr ? (cfg.valueAt ? cfg.valueAt(sr.key, d) : (function () { var p = null; sr.points.forEach(function (q) { if (q.d <= d) p = q; }); return p ? fmtOf(cfg)(p.v) : ''; })()) : '';
        r.querySelector('.agc-kv').textContent = v || 'none';
      });
    };
    var latest = function () { read.textContent = say(view.to); keyDay(view.to); };
    /* reserve the readout's height at its longest (every report day), so touching the chart never moves the page */
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
      if (cfg.headEl) cfg.headEl.textContent = st.head || '';
      if (cfg.takeEl) cfg.takeEl.textContent = st.take || '';
      var opt = { fs: fs, hide: hide, hover: true, label: st.summary, cfg: cfg };
      plot.innerHTML = svg(view, W, H, opt);
      var lay = layout(view, W, H, opt), g = lay.g, hov = plot.querySelector('.agc-hov'), hit = plot.querySelector('.agc-hit');
      if (keyEl) {
        keyEl.hidden = !keyOn;
        keyEl.innerHTML = keyOn ? lay.order.map(function (s) {
          var c = s.color, dash = s.dash ? dashOf(s.dash, 13) : '', off = !!hide[s.key];
          return '<button type="button" class="agc-krow" data-k="' + esc(s.key) + '" aria-pressed="' + !off + '" aria-label="' + (off ? 'Show ' : 'Hide ') + esc(s.name) + '"' + (off ? ' data-off="1"' : '') + '>' +
            '<svg class="agc-ksw" width="36" height="14" viewBox="0 0 36 14" aria-hidden="true"><line x1="1" x2="35" y1="7" y2="7" style="stroke:' + c + ';stroke-width:2.5' + (dash ? ';stroke-dasharray:' + dash : '') + '"/><circle cx="31" cy="7" r="4" style="fill:' + c + '"/></svg>' +
            '<span class="agc-kn">' + esc(s.name) + '</span><span class="agc-kv"></span></button>';
        }).join('') : '';
        if (keyOn) [].slice.call(keyEl.querySelectorAll('.agc-krow')).forEach(function (b) {
          b.addEventListener('click', function () { var k = b.getAttribute('data-k'); hide[k] = !hide[k]; draw(true); var n = keyEl.querySelector('.agc-krow[data-k="' + k + '"]'); if (n) n.focus(); });
        });
      }
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
    short: short, long: long, money: money, dayOf: dayOf };
  root.AgChart = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
