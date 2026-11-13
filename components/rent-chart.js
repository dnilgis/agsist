/* components/rent-chart.js: "every county, and what corn was doing" on each state rent page (/rent/<state>;
   Sig approved Nov 13, 2026, concept R1). One dash per county per year, the median county as the ink line, the
   reader's county as the one gold line, the years the state's corn paid over $5 shaded top to bottom, and under
   the plot the corn price received each crop year on the same years.

   The numbers and the words come from scripts/rent_chart.py (rc-data). The builder runs drawStatic() of this
   same file in node, so the page reads without script and the script redraws the same picture: nothing moves.

   The dashes are drawn once, in a sprite (#rc-cols): each year one vertical stroke whose dash pattern puts a dash
   at every county's rent, in quarter pixels of the wide plot (UNITS from the scale's top to its bottom). Each
   drawing shows that sprite through a nested <svg> whose viewBox picks the years, so a range or a width change
   redraws only the frame. County names and rents for the picker and the tap come from the state's file
   (/data/cash-rent/<ST>.json), fetched when the chart comes near the screen or is used.

   Exports window.AgRentChart (and module.exports) for the tests: scale, cols, render, readout, drawStatic. */
(function (root) {
  'use strict';
  var UNITS = 1360, DASH = 5;                          // sprite: the scale's span in quarter pixels of a 340 px plot; a dash 5 of them tall
  var FS = { wide: 12.8, phone: 12.08 };               // --fs-xs and --fs-2xs (components/styles.css), in px at 16 px a rem
  var H = { wide: [540, 412], phone: [470, 372] };     // drawing height with the corn strip, without it
  var PAGE = { ink: 'var(--text)', dim: 'var(--text-dim)', mut: 'var(--text-muted)', grid: 'var(--border)', acc: 'var(--gold)', bg: 'var(--bg)' };
  var CARD = { ink: '#e9edeb', dim: 'rgba(233,237,235,.80)', mut: 'rgba(233,237,235,.62)', grid: 'rgba(233,237,235,.14)', acc: '#d4a23f', bg: '#0a0c0d' };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function f1(v) { var s = (Math.round(v * 10) / 10).toFixed(1); return s === '-0.0' ? '0.0' : s; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(v) { return '$' + (v === Math.round(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); }
  function cents(v) { return '$' + v.toFixed(2); }
  function wid(s, fs, bold) { return String(s).length * fs * (bold ? 0.62 : 0.58); }
  function ord(n) { var t = n % 100, u = n % 10; return n + (t > 10 && t < 14 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th'); }
  function many(m, n) { var c = m.cnoun.toLowerCase(); return n === 1 ? c : c === 'parish' ? 'parishes' : c === 'county' ? 'counties' : c + 's'; }
  function years(m) { var a = []; for (var y = m.y0; y <= m.y1; y++) a.push(y); return a; }
  function medAt(m, y) { return m.med[y - m.y0] || null; }
  function priceAt(m, y) { return m.price.length ? m.price[y - m.y0] : null; }
  function plast(m) { var l = null; m.price.forEach(function (p, i) { if (p != null) l = m.y0 + i; }); return l; }
  function hotAt(m, y) { return m.hot.some(function (r) { return y >= r[0] && y <= r[1]; }); }

  /* the dollar scale: nice ticks over every county in every year (the same for every range and size) */
  function scale(m) {
    var lo = Infinity, hi = -Infinity;
    m.med.forEach(function (q) { if (q) { lo = Math.min(lo, q[2]); hi = Math.max(hi, q[3]); } });
    var span = Math.max(hi - lo, 1), steps = [1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500], st = steps[steps.length - 1];
    for (var i = 0; i < steps.length; i++) if (span / steps[i] <= 4.2) { st = steps[i]; break; }
    var a = Math.max(0, Math.floor(lo / st) * st), b = Math.ceil(hi / st) * st;
    if (lo - a < st * 0.15 && a > 0) a -= st;
    if (b - hi < st * 0.1) b += st;
    var tk = []; for (var v = a + st; v < b + 1e-9; v += st) tk.push(Math.round(v * 100) / 100);
    return { lo: a, hi: b, step: st, ticks: tk };
  }
  function tickText(sc, v) { return '$' + (sc.step % 1 ? v.toFixed(2) : v.toLocaleString('en-US')); }
  function unit(sc, v) { return Math.round(UNITS * (sc.hi - v) / (sc.hi - sc.lo)); }

  /* the sprite: one stroke per year, a dash at each county's rent (equal or touching rents run together) */
  function cols(m, vals) {
    var sc = scale(m);
    return '<g id="rc-cols">' + vals.map(function (vs, i) {
      if (!vs || !vs.length) return '';
      var u = vs.map(function (v) { return unit(sc, v); }).sort(function (a, b) { return b - a; }).filter(function (x, k, a) { return !k || x !== a[k - 1]; });
      var start = u[0] + DASH / 2, pat = [];
      for (var k = 0; k < u.length; k++) {
        var gap = k + 1 < u.length ? u[k] - u[k + 1] : 0;
        if (k + 1 < u.length && gap < DASH) pat.push(gap, 0); else pat.push(DASH, k + 1 < u.length ? gap - DASH : UNITS * 2);
      }
      var end = start - pat.reduce(function (a, b) { return a + b; }, 0) + UNITS * 2;
      return '<path d="M' + (i + 0.5) + ' ' + f1(start) + 'V' + f1(end) + '" stroke-dasharray="' + pat.join(' ') + '"/>';
    }).join('') + '</g>';
  }

  function geom(m, W, mode, o) {
    var card = !!o.card, fs = o.fs || FS[mode], phone = mode === 'phone', strip = m.price.length > 0;
    var Ht = o.h || H[mode][strip ? 0 : 1];
    var from = o.from || m.y0, to = o.to || m.y1, n = to - from + 1;
    var sc = scale(m), tl = 0;
    sc.ticks.forEach(function (v) { tl = Math.max(tl, wid(tickText(sc, v), fs)); });
    var L = Math.round(Math.max(fs * 2.6, tl + 10)), R = 6;
    if (!phone) {   // the right gutter holds the end labels: as wide as their longest line, the county name wrapped at 12 font sizes
      var lm = null; for (var yy = to; yy >= from && !lm; yy--) if (medAt(m, yy)) lm = [yy, medAt(m, yy)];
      var need = lm ? Math.max(wid('Median ' + m.cnoun.toLowerCase(), fs * 1.06, true), wid(money(lm[1][0]) + ' an acre', fs * 1.06, true), wid(lm[1][1] + ' ' + many(m, lm[1][1]) + ', ' + lm[0], fs)) : 0;
      if (o.county) {
        var lc = null; for (var yc = to; yc >= from && !lc; yc--) if (o.county.v[yc - m.y0] != null) lc = [yc, o.county.v[yc - m.y0]];
        need = Math.max(need, Math.min(wid(o.county.name + ' ' + m.cnoun, fs * 1.06, true), fs * 12), lc ? wid(money(lc[1]) + (lc[0] === to ? '' : ' in ' + lc[0]), fs * 1.06, true) : 0);
      }
      R = Math.round(Math.min(fs * 14, Math.max(fs * 8, need + 18)));
    }
    var T = Math.round(fs * (phone ? 2.6 : 2.7)), GAP = strip ? Math.round(fs * (phone ? 3.2 : card ? 2.6 : 3.5)) : 0;
    var HS = strip ? Math.round(Ht * (phone ? 0.135 : card ? 0.13 : 0.155)) : 0, XA = Math.round(fs * 1.9);
    var HM = Ht - T - GAP - HS - XA, pw = W - L - R, slot = pw / n;
    return {
      fs: fs, phone: phone, card: card, strip: strip, W: W, H: Ht, L: L, R: R, T: T, GAP: GAP, HS: HS, XA: XA, HM: HM,
      from: from, to: to, n: n, slot: slot, sc: sc, tw: Math.min(slot * 0.56, card ? 26 : 28),
      x: function (y) { return L + (y - from + 0.5) * slot; },
      y: function (v) { return T + HM * (sc.hi - v) / (sc.hi - sc.lo); },
      yearAt: function (px) { var y = from + Math.floor((px - L) / slot); return y < from ? from : y > to ? to : y; },
      sb: T + HM + GAP + HS
    };
  }

  function tx(x, y, s, st, anchor, extra) {
    return '<text x="' + f1(x) + '" y="' + f1(y) + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + (extra || '') + ' style="' + st + '">' + esc(s) + '</text>';
  }

  /* the drawing: frame, sprite through a nested svg, lines, labels, the corn strip. o: { from, to, county: { name,
     v: [rent or null per year] }, hover: year, tap: { y, v, name }, card, fs, h, cols (sprite markup, for the card) } */
  function render(m, W, mode, o) {
    o = o || {};
    var g = geom(m, W, mode, o), P = o.card ? CARD : PAGE, fs = g.fs, out = [], boxes = [];
    var face = o.card ? 'font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;' : '';
    var tok = g.phone ? 'var(--fs-2xs)' : 'var(--fs-xs)';   // the page's own size tokens; the picture has no stylesheet
    var st = function (size, fill, bold) { var k = Math.round(size / fs * 100) / 100; return face + 'font-size:' + (o.card ? f1(size) + 'px' : k === 1 ? tok : 'calc(' + tok + ' * ' + k + ')') + ';fill:' + fill + (bold ? ';font-weight:700' : ''); };
    var halo = ' paint-order="stroke" stroke="' + P.bg + '" stroke-width="4" stroke-linejoin="round"';
    var box = function (x, y, s, size, anchor, bold, kind) {
      var w = wid(s, size, bold), x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
      boxes.push({ x0: x0, x1: x0 + w, y0: y - size * 0.8, y1: y + size * 0.22, s: s, kind: kind || 'label' });
    };
    var put = function (x, y, s, size, fill, anchor, bold, kind, extra) { box(x, y, s, size, anchor, bold, kind); out.push(tx(x, y, s, st(size, fill, bold), anchor, extra)); };
    var free = function (x, y, s, size, anchor, bold) {   // no other label within 2 px of this one
      var w = wid(s, size, bold), x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x, b = { x0: x0 - 2, x1: x0 + w + 2, y0: y - size * 0.8 - 2, y1: y + size * 0.22 + 2 };
      return x0 >= 0 && x0 + w <= g.W && !boxes.some(function (o) { return o.x0 < b.x1 && b.x0 < o.x1 && o.y0 < b.y1 && b.y0 < o.y1; });
    };
    var vfree = function (x, y0, y1) { return !boxes.some(function (o) { return o.x0 < x + 8 && x - 8 < o.x1 && o.y0 < y1 && y0 < o.y1; }); };
    var yrs = []; for (var y = g.from; y <= g.to; y++) yrs.push(y);
    var bottom = g.strip ? g.sb : g.T + g.HM;
    // corn over $5: shaded years, labelled at the top where the band is wide enough
    m.hot.forEach(function (r) {
      var a = Math.max(r[0], g.from), b = Math.min(r[1], g.to); if (a > b) return;
      var x0 = g.L + (a - g.from) * g.slot, w = (b - a + 1) * g.slot, cx = x0 + w / 2;
      out.push('<rect x="' + f1(x0) + '" y="0" width="' + f1(w) + '" height="' + f1(bottom) + '" style="fill:' + P.ink + ';fill-opacity:' + (o.card ? '.09' : '.06') + '"/>');
      var one = 'Corn over $5', s1 = 'Corn', s2 = 'over $5';
      if (wid(one, fs, true) <= w - 6) put(cx, fs * 1.15, one, fs, P.ink, 'middle', true, 'band');
      else if (wid(s2, fs) <= w - 4) { put(cx, fs * 1.0, s1, fs, P.ink, 'middle', false, 'band'); put(cx, fs * 2.1, s2, fs, P.ink, 'middle', false, 'band'); }
      if (m.short && !g.phone && m.short[0] >= a && m.short[0] <= b) {
        var sl = m.short[0] + ' crop: ' + m.short[1] + ' bu corn';
        if (wid(sl, fs * 0.92) <= w - 6 && wid(one, fs, true) <= w - 6) put(cx, fs * 2.35, sl, fs * 0.92, P.dim, 'middle', false, 'band');
      }
    });
    // gridlines and dollar ticks
    g.sc.ticks.forEach(function (v) {
      var yy = g.y(v);
      out.push('<line x1="' + g.L + '" x2="' + f1(g.W - g.R) + '" y1="' + f1(yy) + '" y2="' + f1(yy) + '" style="stroke:' + P.grid + '"/>');
      put(g.L - 7, yy + fs * 0.33, tickText(g.sc, v), fs, P.mut, 'end', false, 'tick');
    });
    // years with no figure, named in the column
    yrs.forEach(function (y) {
      if (medAt(m, y)) return;
      var why = m.why[String(y)] === 'no survey' ? ['no', 'survey'] : ['none', 'published'], x = g.x(y), size = fs * 0.92;
      if (wid(why[1], size) <= g.slot - 2) { put(x, g.T + g.HM - size * 1.55, why[0], size, P.mut, 'middle'); put(x, g.T + g.HM - size * 0.35, why[1], size, P.mut, 'middle'); }
      else {
        var s = why.join(' '), yb = g.T + g.HM - 4;
        boxes.push({ x0: x - size * 0.5, x1: x + size * 0.5, y0: yb - wid(s, size), y1: yb, s: s, kind: 'label' });
        out.push('<text transform="translate(' + f1(x + size * 0.36) + ' ' + f1(yb) + ') rotate(-90)" style="' + st(size, P.mut) + '">' + esc(s) + '</text>');
      }
    });
    // the dashes: the sprite, through a viewBox on the years shown
    var sw = Math.min(0.56, g.tw / g.slot);
    out.push('<svg x="' + g.L + '" y="' + g.T + '" width="' + f1(g.slot * g.n) + '" height="' + g.HM + '" viewBox="' + (g.from - m.y0) + ' 0 ' + g.n + ' ' + UNITS + '" preserveAspectRatio="none" overflow="hidden">' +
      (o.cols ? '<g stroke-width="' + sw.toFixed(3) + '" style="stroke:' + P.ink + ';stroke-opacity:.34;fill:none">' + o.cols.replace(/^<g id="rc-cols">|<\/g>$/g, '') + '</g>'
        : '<use href="#rc-cols" class="rc-dashes" stroke-width="' + sw.toFixed(3) + '" style="stroke:' + P.ink + ';stroke-opacity:.32;fill:none"/>') + '</svg>');
    if (o.hover != null && o.hover >= g.from && o.hover <= g.to) {
      var hx = g.L + (o.hover - g.from) * g.slot;
      out.push('<rect class="rc-hov" x="' + f1(hx + 1) + '" y="' + f1(g.T - 4) + '" width="' + f1(g.slot - 2) + '" height="' + f1(bottom - g.T + 4) + '" style="fill:none;stroke:' + P.ink + ';stroke-opacity:.55"/>');
    }
    // a line over the years: solid between neighbouring years, dotted across a year with no figure
    var line = function (vals, color, wd, r, key) {
      var pts = []; yrs.forEach(function (y) { var v = vals(y); if (v != null) pts.push([y, v]); });
      var s = '';
      for (var k = 1; k < pts.length; k++) {
        var a = pts[k - 1], b = pts[k], dot = b[0] - a[0] > 1;
        s += '<line x1="' + f1(g.x(a[0])) + '" y1="' + f1(g.y(a[1])) + '" x2="' + f1(g.x(b[0])) + '" y2="' + f1(g.y(b[1])) + '" style="stroke:' + color + ';stroke-width:' + wd + ';stroke-linecap:round' + (dot ? ';stroke-dasharray:' + (g.phone ? '2 4' : '3 5') : '') + '"/>';
      }
      pts.forEach(function (p, k) {
        var last = k === pts.length - 1;
        s += '<circle cx="' + f1(g.x(p[0])) + '" cy="' + f1(g.y(p[1])) + '" r="' + (last ? r + 1.6 : r) + '" style="fill:' + color + ';stroke:' + P.bg + ';stroke-width:1.5"/>';
      });
      out.push('<g class="rc-' + key + '">' + s + '</g>');
      return pts;
    };
    var cv = o.county ? function (y) { var v = o.county.v[y - m.y0]; return v == null ? null : v; } : null;
    var cpts = cv ? line(cv, P.acc, g.phone ? 2 : 2.2, g.phone ? 2.2 : 2.8, 'county') : [];
    var mpts = line(function (y) { var q = medAt(m, y); return q ? q[0] : null; }, P.ink, 2.4, g.phone ? 2.4 : 3.1, 'median');
    if (o.tap && o.tap.y >= g.from && o.tap.y <= g.to) {
      var tx0 = g.x(o.tap.y), ty = g.y(o.tap.v), tw = Math.max(g.tw, 10);
      out.push('<line class="rc-tap" x1="' + f1(tx0 - tw / 2 - 2) + '" x2="' + f1(tx0 + tw / 2 + 2) + '" y1="' + f1(ty) + '" y2="' + f1(ty) + '" style="stroke:' + P.ink + ';stroke-width:3;stroke-linecap:round"/>');
    }
    // names and values: the first median point; the last points named at their ends
    if (mpts.length) {
      var f = mpts[0], fx = g.x(f[0]) - g.tw / 2, fsz = fs * 1.02, fv = money(f[1]);
      var fys = [g.y(f[1]) + fs * 1.65, g.y(f[1]) - fs * 0.8].filter(function (y) { return y > g.T + fs && y < g.T + g.HM && free(fx, y, fv, fsz, 'start', true); });
      if (fys.length) put(fx, fys[0], fv, fsz, P.ink, 'start', true, 'value', halo);
    }
    var lastOf = function (pts) { return pts.length ? pts[pts.length - 1] : null; };
    var ml = lastOf(mpts), cl = lastOf(cpts), cn = o.county ? o.county.name + ' ' + m.cnoun : '';
    if (!g.phone) {
      var ex = g.x(g.to) + g.tw / 2 + 12, lh = fs * 1.32, room = g.R - 16, blocks = [];
      if (ml) {
        var q = medAt(m, ml[0]);
        blocks.push({ want: g.y(ml[1]), lines: [['Median ' + m.cnoun.toLowerCase(), P.ink, true], [money(ml[1]) + ' an acre', P.ink, true], [q[1] + ' ' + many(m, q[1]) + ', ' + ml[0], P.dim, false]] });
      }
      if (cl) {
        var nm = [], cur = '';
        cn.split(' ').forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (wid(t, fs, true) > room && cur) { nm.push(cur); cur = w; } else cur = t; });
        nm.push(cur);
        blocks.push({ want: g.y(cl[1]), lines: nm.map(function (s) { return [s, P.acc, true]; }).concat([[money(cl[1]) + (cl[0] === g.to ? '' : ' in ' + cl[0]), P.acc, true]]) });
      }
      blocks.forEach(function (b) { b.h = b.lines.length * lh; b.top = b.want - lh * 0.75; });
      blocks.sort(function (a, b) { return a.want - b.want; });
      for (var k = 1; k < blocks.length; k++) { var pb = blocks[k - 1]; if (blocks[k].top < pb.top + pb.h + 6) blocks[k].top = pb.top + pb.h + 6; }
      var over = blocks.length ? blocks[blocks.length - 1].top + blocks[blocks.length - 1].h - (g.T + g.HM) : 0;
      if (over > 0) blocks.forEach(function (b) { b.top -= over; });
      blocks.forEach(function (b) { b.lines.forEach(function (l, i) { put(ex, b.top + fs * 0.95 + i * lh, l[0], fs * (l[2] ? 1.06 : 1), l[1], 'start', l[2], 'end'); }); });
    } else {
      var rx = g.x(g.to) + g.tw / 2, below = !cl || (ml && ml[1] <= cl[1]);
      var endLab = function (x, yv, first, s, fill) {   // its own side first, the other side if that is taken, else left out
        var ys2 = [yv + (first ? fs * 1.6 : -fs * 0.75), yv + (first ? -fs * 0.75 : fs * 1.6)].filter(function (y) { return y > g.T + fs * 0.6 && y < g.T + g.HM + fs * 0.5 && free(x, y, s, fs * 1.02, 'end', true); });
        if (ys2.length) put(x, ys2[0], s, fs * 1.02, fill, 'end', true, 'value', halo);
      };
      if (ml) endLab(rx, g.y(ml[1]), below, money(ml[1]), P.ink);
      if (cl) endLab(cl[0] === g.to ? rx : g.x(cl[0]) + g.tw / 2, g.y(cl[1]), !below, money(cl[1]), P.acc);
    }
    // the corn strip: the price received each crop year, dark when over $5
    if (g.strip) {
      var s0 = g.T + g.HM + g.GAP, pv = yrs.map(function (y) { return priceAt(m, y); }).filter(function (p) { return p != null; });
      var pm = Math.max.apply(null, pv.concat([5])) * 1.3, ys = function (p) { return g.sb - p / pm * g.HS; }, pl = plast(m);
      var title = m.name + ' corn price received, $ a bushel' + (g.phone ? '' : ', by crop year');
      put(g.phone ? 0 : g.L, s0 - fs * 0.85, title, fs, P.ink, 'start', false, 'title');
      out.push('<line x1="' + g.L + '" x2="' + f1(g.W - g.R) + '" y1="' + f1(g.sb) + '" y2="' + f1(g.sb) + '" style="stroke:' + P.mut + ';stroke-opacity:.6"/>');
      var bw = g.tw, size = fs * (g.phone ? 0.95 : 0.92), every = wid('$6.87', size) <= g.slot - 3;
      var bars = [], labs = [];
      yrs.forEach(function (y) {
        var p = priceAt(m, y), x = g.x(y);
        if (p == null) return;
        var hot = p > 5;
        out.push('<rect x="' + f1(x - bw / 2) + '" y="' + f1(ys(p)) + '" width="' + f1(bw) + '" height="' + f1(g.sb - ys(p)) + '" style="fill:' + P.ink + (hot ? '' : ';fill-opacity:.36') + '"/>');
        var peak = m.hot.some(function (r) { if (y < r[0] || y > r[1]) return false; for (var k = r[0]; k <= r[1]; k++) if ((priceAt(m, k) || 0) > p) return false; return true; });
        labs.push({ y: y, p: p, x: x, hot: hot, rank: peak ? 0 : y === pl ? 1 : 2 });
      });
      labs.sort(function (a, b) { return a.rank - b.rank || a.y - b.y; }).forEach(function (l) {
        if (l.rank === 2 && !every) return;
        var ly = ys(l.p) - size * 0.4, s = cents(l.p);
        if (free(l.x, ly, s, size, 'middle', l.hot)) put(l.x, ly, s, size, l.hot ? P.ink : P.dim, 'middle', l.hot, 'price');
      });
      yrs.forEach(function (y) {
        if (priceAt(m, y) != null || pl == null || y <= pl) return;
        var x = g.x(y);
        if (wid('not out', size) <= g.slot - 2) { put(x, g.sb - size * 1.5, 'not out', size, P.mut, 'middle'); put(x, g.sb - size * 0.35, 'yet', size, P.mut, 'middle'); }
        else { var s = 'not out', yb = g.sb - 3; if (!vfree(x, yb - wid(s, size), yb)) return; boxes.push({ x0: x - size * 0.5, x1: x + size * 0.5, y0: yb - wid(s, size), y1: yb, s: s, kind: 'label' }); out.push('<text transform="translate(' + f1(x + size * 0.36) + ' ' + f1(yb) + ') rotate(-90)" style="' + st(size, P.mut) + '">' + s + '</text>'); }
      });
    }
    // years along the bottom: every year that fits, always the last
    var stepY = 1; while (stepY * g.slot < wid('2026', fs) + (g.phone ? 14 : 12)) stepY++;
    yrs.forEach(function (y) {
      if ((g.to - y) % stepY) return;
      var x = g.x(y), w = wid(String(y), fs), an = x + w / 2 > g.W ? 'end' : x - w / 2 < g.L - 6 ? 'start' : 'middle';
      put(an === 'end' ? g.W : an === 'start' ? Math.max(0, x - g.slot / 2) : x, g.H - fs * 0.45, String(y), fs, P.mut, an, false, 'year');
    });
    var label = (o.label || '');
    var svg = '<svg class="rc-svg" xmlns="http://www.w3.org/2000/svg" width="' + g.W + '" height="' + g.H + '" viewBox="0 0 ' + g.W + ' ' + g.H + '"' +
      (o.card ? '' : ' role="img" aria-label="' + esc(label) + '"') + ' overflow="visible">' + out.join('') + '</svg>';
    return { svg: svg, g: g, boxes: boxes };
  }

  /* the line under the plot, for one year: the median county, the spread, corn, the reader's county or a tapped dash */
  function readout(m, y, o) {
    o = o || {};
    var q = medAt(m, y), p = priceAt(m, y), pl = plast(m), cn = m.cnoun.toLowerCase(), s;
    if (!q) s = y + ': ' + (m.why[String(y)] === 'no survey' ? 'no USDA survey.' : 'no ' + cn + ' published.');
    else s = y + ': median ' + cn + ' ' + money(q[0]) + ' an acre (' + q[1] + ' ' + many(m, q[1]) + (q[1] > 1 ? ', ' + money(q[2]) + ' to ' + money(q[3]) : '') + ').';
    if (m.price.length) {
      if (p != null) s += ' Corn ' + cents(p) + ' a bushel' + (m.prelim.indexOf(y) >= 0 ? ' (preliminary)' : '') + '.';
      else if (pl != null && y > pl) s += ' Corn price not out yet.';
    }
    var who = o.tap && o.tap.y === y ? o.tap : null;
    if (!who && o.county) { var v = o.county.v[y - m.y0]; who = { name: o.county.name, v: v }; }
    if (who) {
      var nm = who.name + ' ' + m.cnoun;
      if (who.v == null) s += ' ' + nm + ': not published.';
      else {
        var rk = o.rank ? o.rank(y, who.v) : null;
        s += ' ' + nm + ' ' + money(who.v) + (rk ? ', ' + rk : '') + '.';
      }
    }
    return s;
  }
  /* '5th highest of 86' / 'tied for 5th highest of 86' among the rents of one year */
  function rankOf(all, v) {
    var above = all.filter(function (x) { return x > v; }).length, same = all.filter(function (x) { return x === v; }).length;
    return (same > 1 ? 'tied for ' : '') + (above === 0 ? 'highest' : ord(above + 1) + ' highest') + ' of ' + all.length;
  }
  function summary(m) {
    var a = medAt(m, m.y0), b = medAt(m, m.y1);
    return m.name + ' ' + m.land + ' cash rent by ' + m.cnoun.toLowerCase() + ', ' + m.y0 + ' to ' + m.y1 + ', one dash per ' + m.cnoun.toLowerCase() + ' each year, with the median ' +
      m.cnoun.toLowerCase() + (a && b ? ' (' + money(a[0]) + ' in ' + m.y0 + ', ' + money(b[0]) + ' in ' + m.y1 + ')' : '') + (m.price.length ? ' and the ' + m.name + ' corn price received each crop year' : '') + '.';
  }

  /* the first paint, for the builder: the sprite, both drawings and the readout for the latest year */
  function drawStatic(m, vals) {
    var strip = m.price.length > 0, lab = summary(m);
    return {
      cols: cols(m, vals),
      wide: render(m, 1028, 'wide', { label: lab }).svg,
      phone: render(m, 358, 'phone', { label: lab }).svg,
      read: readout(m, m.y1, {}),
      h: { wide: H.wide[strip ? 0 : 1], phone: H.phone[strip ? 0 : 1] },
      summary: lab
    };
  }

  /* ---------- in the browser ---------- */
  function norm(s) { return String(s || '').toLowerCase().replace(/\b(county|parish|borough|census area|city)\b/g, '').replace(/\bsaint\b/g, 'st').replace(/[^a-z]/g, ''); }

  function card(m, st, done) {
    var D = root.document, W = 1200, Hc = 630, c = D.createElement('canvas'); c.width = W; c.height = Hc;
    var x = c.getContext('2d'); if (!x || !root.Image) { done(null); return; }
    var F = 'Inter, system-ui, -apple-system, Segoe UI, sans-serif';
    var fit = function (wt, text, maxW, sizes, lines) {
      for (var i = 0; i < sizes.length; i++) {
        x.font = wt + ' ' + sizes[i] + 'px ' + F; var out = [], cur = '';
        String(text).split(' ').forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (x.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; });
        if (cur) out.push(cur);
        if (out.length <= lines) return { size: sizes[i], lines: out };
      }
      return null;
    };
    x.fillStyle = CARD.bg; x.fillRect(0, 0, W, Hc); x.fillStyle = CARD.acc; x.fillRect(0, 0, W, 8);
    x.font = '800 32px ' + F; x.fillStyle = CARD.ink; x.fillText('agsist', 48, 58);
    var aw = x.measureText('agsist').width; x.font = '700 19px ' + F; x.fillStyle = CARD.acc; x.fillText('.com', 50 + aw, 58);
    x.font = '600 19px ' + F; x.fillStyle = CARD.dim; x.textAlign = 'right'; x.fillText(m.name + ' cash rent, ' + m.y0 + ' to ' + m.y1, W - 48, 57); x.textAlign = 'left';
    var hd = fit('800', m.head, W - 96, [36, 33, 30, 28], 2) || { size: 28, lines: [m.head] }, yy = 84 + hd.size;
    x.font = '800 ' + hd.size + 'px ' + F; x.fillStyle = CARD.ink;
    hd.lines.forEach(function (l) { x.fillText(l, 48, yy); yy += hd.size * 1.18; });
    var who = st.county ? st.county.name + ' ' + m.cnoun : '';
    var src = 'Each dash is one ' + m.cnoun.toLowerCase() + '\u2019s rent, $ an acre. Source: USDA NASS Cash Rents Survey county estimates' + (m.hot.length ? ' and prices received' : '') + ', ' + m.y0 + '–' + m.y1 + '.';
    var hgt = Math.round(Hc - yy - 66), r = render(m, W - 48, 'wide', { card: true, fs: 15, h: hgt, cols: st.cols, county: st.county, from: st.from, to: st.to });
    var img = new root.Image();
    img.onload = function () {
      x.drawImage(img, 18, yy + 2);
      x.font = '400 16px ' + F; x.fillStyle = CARD.mut; x.fillText(src, 48, Hc - 42);
      x.font = '700 19px ' + F; x.fillStyle = CARD.acc; x.fillText(String(m.url).replace(/^https?:\/\//, '') + (who ? '?county=' + encodeURIComponent(st.county.name) : ''), 48, Hc - 16);
      c.toBlob(function (b) { done(b); }, 'image/png');
    };
    img.onerror = function () { done(null); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(r.svg);
  }

  function mount(sec) {
    var D = root.document, raw = D.getElementById('rc-data'), plot = D.getElementById('rc-plot'), read = D.getElementById('rc-read');
    if (!raw || !plot || !read) return;
    var m; try { m = JSON.parse(raw.textContent); } catch (e) { return; }
    var sprite = D.getElementById('rc-cols'), colsHtml = sprite ? sprite.outerHTML : '';
    var S = { from: m.y0, to: m.y1, county: null, hover: null, tap: null, list: null, byName: {}, loading: null, from0: '' };
    var sel = D.getElementById('rc-county'), rec = D.getElementById('rc-rec'), key = D.getElementById('rc-key-c'), lastW = 0, cur = null;
    var rank = function (y, v) { if (!S.list) return null; var all = []; S.list.forEach(function (c) { var w = c.v[y - m.y0]; if (w != null) all.push(w); }); return rankOf(all, v); };
    var say = function (y) { read.textContent = readout(m, y, { county: S.county, tap: S.tap, rank: rank }); };
    var idle = function () { say(S.tap ? S.tap.y : S.to); };
    function draw(force) {
      var W = Math.round(plot.clientWidth); if (!W || (W === lastW && !force)) return; lastW = W;
      var mode = W < 600 ? 'phone' : 'wide';
      cur = render(m, W, mode, { from: S.from, to: S.to, county: S.county, hover: S.hover, tap: S.tap, label: summary(m) });
      plot.innerHTML = cur.svg;
      var svg = plot.firstChild; svg.setAttribute('tabindex', '0');
      svg.setAttribute('aria-describedby', 'rc-read');
    }
    function load() {
      if (S.loading) return S.loading;
      S.loading = (root.fetch ? root.fetch('/data/cash-rent/' + m.st + '.json').then(function (r) { return r.ok ? r.json() : null; }) : Promise.resolve(null)).then(function (d) {
        if (!d || !d.counties) return null;
        S.list = d.counties.map(function (c) {
          var t = (c.rent || {})[m.key] || {}, v = []; for (var y = m.y0; y <= m.y1; y++) v.push(t[String(y)] != null ? t[String(y)] : null);
          return { name: c.name, v: v };
        }).filter(function (c) { return c.v.some(function (x) { return x != null; }); }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
        S.list.forEach(function (c) { S.byName[norm(c.name)] = c; });
        if (sel) { S.list.forEach(function (c) { var op = D.createElement('option'); op.value = c.name; op.textContent = c.name; sel.appendChild(op); }); sel.disabled = false; }
        return S.list;
      }, function () { return null; });
      return S.loading;
    }
    function pick(c, from) {
      S.county = c; S.tap = null; S.from0 = c && from ? from : '';
      if (sel) sel.value = c ? c.name : '';
      if (key) { key.hidden = !c; var kn = key.querySelector('span'); if (kn && c) kn.textContent = c.name + ' ' + m.cnoun; }
      if (rec) {
        var a = null; if (c) [].slice.call(D.querySelectorAll('#rs-table a')).forEach(function (e) { if (!a && norm(e.textContent) === norm(c.name)) a = e; });
        rec.style.visibility = a ? 'visible' : 'hidden'; if (a) { rec.href = a.getAttribute('href'); rec.textContent = m.cnoun + ' record'; rec.setAttribute('aria-label', 'Farmland Atlas record for ' + c.name + ' ' + m.cnoun); }
      }
      draw(true); idle();
    }
    // the years shown
    [].slice.call(sec.querySelectorAll('.rc-rg')).forEach(function (b, i, all) {
      b.addEventListener('click', function () {
        all.forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
        var n = +b.getAttribute('data-n'); S.from = n ? Math.max(m.y0, m.y1 - n + 1) : m.y0; S.hover = null; draw(true); idle();
      });
    });
    if (sel) sel.addEventListener('change', function () { load().then(function () { pick(sel.value ? S.byName[norm(sel.value)] || null : null); }); });
    if (sel) ['focus', 'pointerdown'].forEach(function (ev) { sel.addEventListener(ev, load); });
    // drag or hover to read a year; a tap names the county under it
    var down = null;
    var yearOf = function (ev) { var r = plot.getBoundingClientRect(); return cur ? cur.g.yearAt(ev.clientX - r.left) : null; };
    var show = function (y) { if (y == null || y === S.hover) return; S.hover = y; draw(true); say(y); };
    plot.addEventListener('pointerdown', function (ev) { down = { x: ev.clientX, y: ev.clientY, moved: false }; load(); try { plot.setPointerCapture(ev.pointerId); } catch (e) {} if (ev.pointerType !== 'mouse') show(yearOf(ev)); });
    plot.addEventListener('pointermove', function (ev) {
      if (down && Math.abs(ev.clientX - down.x) > 8) down.moved = true;
      if (ev.pointerType === 'mouse' || down) show(yearOf(ev));
    });
    var end = function (ev) {
      if (!down) return; var d = down; down = null;
      if (d.moved || !cur) return;
      var r = plot.getBoundingClientRect(), y = cur.g.yearAt(ev.clientX - r.left), py = ev.clientY - r.top;
      load().then(function () {
        if (!S.list) return;
        var best = null; S.list.forEach(function (c) { var v = c.v[y - m.y0]; if (v == null) return; var dd = Math.abs(cur.g.y(v) - py); if (dd <= 9 && (!best || dd < best.d)) best = { d: dd, c: c, v: v }; });
        S.tap = best ? { y: y, v: best.v, name: best.c.name } : null; S.hover = y; draw(true); say(y);
      });
    };
    plot.addEventListener('pointerup', end);
    plot.addEventListener('pointercancel', function () { down = null; });
    plot.addEventListener('mouseleave', function () { if (S.hover != null) { S.hover = null; draw(true); idle(); } });
    // keys: left and right for a year, up and down for each county in it, Escape to let go
    plot.addEventListener('keydown', function (ev) {
      var y = S.hover != null ? S.hover : S.to, k = ev.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End') {
        ev.preventDefault(); y = k === 'Home' ? S.from : k === 'End' ? S.to : Math.min(S.to, Math.max(S.from, y + (k === 'ArrowRight' ? 1 : -1)));
        S.tap = null; S.hover = y; draw(true); say(y); plot.firstChild.focus();
      } else if (k === 'ArrowUp' || k === 'ArrowDown') {
        ev.preventDefault();
        load().then(function () {
          if (!S.list) return;
          var col = S.list.filter(function (c) { return c.v[y - m.y0] != null; }).sort(function (a, b) { return b.v[y - m.y0] - a.v[y - m.y0]; });
          if (!col.length) return;
          var i = S.tap && S.tap.y === y ? col.findIndex(function (c) { return c.name === S.tap.name; }) : -1;
          i = k === 'ArrowDown' ? Math.min(col.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
          S.tap = { y: y, v: col[i].v[y - m.y0], name: col[i].name }; S.hover = y; draw(true); say(y); plot.firstChild.focus();
        });
      } else if (k === 'Escape') { S.tap = null; S.hover = null; draw(true); idle(); }
    });
    // copy the link (with the county) and save the picture
    var copy = D.getElementById('rc-copy'), save = D.getElementById('rc-save');
    var link = function () { return m.url + (S.county ? '?county=' + encodeURIComponent(S.county.name) : ''); };
    var flash = function (b, t) { var o = b.textContent; b.textContent = t; setTimeout(function () { b.textContent = o; }, 1800); };
    if (copy) copy.addEventListener('click', function () { var u = link(); try { root.navigator.clipboard.writeText(u).then(function () { flash(copy, 'Link copied'); }, function () { flash(copy, u); }); } catch (e) { flash(copy, u); } });
    if (save) save.addEventListener('click', function () {
      card(m, { cols: colsHtml, county: S.county, from: S.from, to: S.to }, function (b) {
        if (!b) return; var a = D.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'agsist-rent-' + String(m.url).split('/').pop() + '.png';
        D.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
        try { if (typeof root.gtag === 'function') root.gtag('event', 'picture_download', { kit: 'rent' }); } catch (e) {}
      });
    });
    sec.classList.add('rc-on');
    draw(true);
    if (root.ResizeObserver) new root.ResizeObserver(function () { draw(); }).observe(plot); else root.addEventListener('resize', function () { draw(); });
    // your county: from the link, else from the place saved on AGSIST (read here, never sent)
    var want = '', from = '';
    try { want = new URL(root.location.href).searchParams.get('county') || ''; } catch (e) {}
    if (!want) { try { var lc = JSON.parse(root.localStorage.getItem('agsist-wx-loc') || 'null'); if (lc && lc.state === m.st && lc.county) want = lc.county; } catch (e) {} }
    if (want) load().then(function () { var c = S.byName[norm(want)]; if (c) pick(c, from); });
    else if (root.IntersectionObserver) { var io = new root.IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); load(); } }, { rootMargin: '300px' }); io.observe(plot); }
  }

  var api = { scale: scale, cols: cols, render: render, readout: readout, rankOf: rankOf, drawStatic: drawStatic, summary: summary, norm: norm, geom: geom, UNITS: UNITS, H: H, FS: FS };
  root.AgRentChart = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document && root.document.getElementById) {
    var go = function () { var s = root.document.getElementById('rent-history'); if (s && root.document.getElementById('rc-data')) mount(s); };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', go); else go();
  }
})(typeof window !== 'undefined' ? window : globalThis);
