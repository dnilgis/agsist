/* The 52-week funds chart on /cot (Nov 5, 2026, Sig: "I can picture people sharing it if we make it easy").
   One market at a time, picked by chips; the pick rides in the link (/cot?m=soybeans). The main line is managed
   money's net for the weekly reports in data/cot-history.json; the futures price sits in its own strip with its
   own scale (Sig, Nov 6: kept on the pictures and the sheet), never a second scale on the net. The strip is drawn
   when every week has a close and the roll-repaired index (px_adj) and the pipeline does not withhold the price;
   on release day it runs to the last repaired week, dated. Kit v2 (Nov 6, the share kit panel): weeks placed by
   date with months and the year, round ticks with a unit, the 52-week high and low and the latest point labelled
   with value, side and date, one run bracket at most; the headline says what changed, then where funds stand
   (AgCotGlance.brief); every asset carries absolute dates with the year. Shared helpers: components/cot-kit.js; the picture's
   card, pen and fonts from components/share-kit.js (the share kit core).
   One layout feeds the inline SVG on the page, the saved pictures (1080x1350 on a phone, 1200x675 on a desktop)
   and the printed sheet (cot-print.js). Compare mode: up to three markets on the pipeline's 0 to 100 rank (`rk`).
   cot-page.js hands this file the data it fetched (AgCotChart.update); nothing here fetches.
   Exports window.AgCotChart (and module.exports for the tests). */
(function (root) {
  'use strict';
  var G = root.AgCotGlance || (typeof require === 'function' ? require('./cot-glance.js') : null);
  var ORDER = G.ORDER;
  var CHIP = G.SHORT;
  var K = root.AgCotKit || (typeof require === 'function' ? require('./cot-kit.js') : null);
  /* the share kit core, read only when a picture is drawn: without it the chart and the page work as ever */
  function kit() { return root.AgShareKit || (typeof require === 'function' ? require('./share-kit.js') : null); }
  var SITE = 'https://agsist.com';
  var ASK = 'Free every Friday: agsist.com/cot';
  function full(d) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt(d).getDay()] + ', ' + mdy(d); }
  var esc = K.esc, commas = K.commas, netWords = K.netWords, kTick = K.kTick, dt = K.dt, mdy = K.mdy, md = K.md, px = K.px, tw = K.tw;

  /* ---------------------------------------------------------------- the model
     key: a cot-history.json key. hist: the whole file. cot: cot.json. cx: cot-analysis.json (or null).
     -> null without at least two weeks, else
     {key, name, rows:[{date, net, price, raw}], last, hi, lo, price: bool, priceWhy, headline, asOf, src, aligned} */
  function model(key, hist, cot, cx) {
    var arr = hist && hist.history && hist.history[key];
    if (!arr || arr.length < 2) return null;
    var rows = arr.filter(function (r) { return r && typeof r.net === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(r.date); })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }).slice(-52)
      .map(function (r) { return { date: r.date, net: r.net, raw: typeof r.price === 'number' ? r.price : null, adj: typeof r.px_adj === 'number' ? r.px_adj : null }; });
    if (rows.length < 2) return null;
    var last = rows[rows.length - 1], hi = rows[0], lo = rows[0];
    rows.forEach(function (r) { if (r.net > hi.net) hi = r; if (r.net < lo.net) lo = r; });
    /* The report the page shows, and whether this chart ends on it with the same net. */
    var rep = cot && G.iso(cot.report_date), c = cot && cot[key];
    var aligned = !!(rep && rep === last.date && c && c.net === last.net);
    var cxA = cx && G.iso(cx.report_date) === last.date ? cx : null;
    var cxc = cxA && cxA.commodities && cxA.commodities[key];
    /* the price strip: every week priced and repaired, and not withheld */
    var reason = (cxc && cxc.price_withheld_reason) || '';
    /* release day: the newest 1-2 weeks can lack the repaired index; the line stops at the last repaired week */
    var tail = 0;
    while (tail < 2 && tail < rows.length - 1 && rows[rows.length - 1 - tail].adj === null && rows[rows.length - 1 - tail].raw !== null) tail++;
    var head = rows.slice(0, rows.length - tail);
    var every = head.every(function (r) { return r.raw !== null && r.adj !== null; });
    var pLast = head[head.length - 1];
    var price = !reason && every && pLast && pLast.adj > 0;
    if (price) {
      var k = pLast.raw / pLast.adj;   /* the repaired index scaled so its last point is that week's close */
      rows.forEach(function (r, i) { r.price = i < head.length ? Math.round(r.adj * k * 100) / 100 : null; });
    }
    var priceWhy = price ? '' : /roll/.test(reason) || key === 'leanhogs'
      ? 'No price line: the price series still jumps where one contract rolls to the next, so it is left out.'
      : rows.some(function (r) { return r.raw !== null; })
        ? 'No price line: some weeks have no futures close, so it is left out rather than half drawn.'
        : 'No price line: our futures feed does not carry this contract.';
    var rel = cxA && cxA.release_date ? cxA.release_date : (cot && rep === last.date && /^\d{4}-\d{2}-\d{2}$/.test(cot.release_date || '') ? cot.release_date : null);
    var when = 'Week to ' + full(last.date) + '.' + (rel ? ' Released ' + full(rel) + '.' : '');
    var src = 'CFTC Commitments of Traders, managed money, futures only, week to ' + full(last.date) + (rel ? ', released ' + full(rel) : '') + '.'
      + (price ? ' Price: front-month futures close each report Tuesday (Yahoo Finance), adjusted for contract rolls.' : '');
    var h = aligned && G.brief(key, cot, cx), an = aligned && G.answer(key, cot, cx);
    return { key: key, name: CHIP[key] || key, rows: rows, last: last, hi: hi, lo: lo, price: price, priceWhy: priceWhy,
      pLast: price ? pLast : null, headline: h ? h.text : null, headlineHtml: h ? h.html : null, head: h ? h.head : null, stand: h ? h.stand : '',
      record: h ? h.record : '', run: K.run(rows), aligned: aligned, answer: an ? an.rank : null, asOf: when, src: src };
  }

  /* ---------------------------------------------------------------- the layout (kit v2, the design seat's spec)
     m: model(); w, h: the box in px; o: {fs: base font px, big: the saved picture, print: the paper sheet}.
     Weeks placed by date; round ticks with the unit "Net contracts"; zero the strongest rule; the 52-week high and low
     ringed and labelled with value, side and date; the latest point labelled with its date (and a measured record);
     at most one event, the run of buying or selling ending this report, from the rows; the price in its own strip
     with its own high and low values and the latest close at the line's end (dated when the line stops early).
     -> {w, h, items:[...]} where each item is one of
        {t:'line', pts:[[x,y]...], ink, width, dash}   {t:'area', pts, base, ink}
        {t:'dot', x, y, r, ink, ring}                    {t:'text', x, y, s, ink, size, weight, align, base}
     ink names: net, netFill, price, grid, zero, axis, text, muted, surface, none. Painters map them to colours. */
  function layout(m, w, h, o) {
    if (m.cmp) return layoutCmp(m, w, h, o);
    o = o || {};
    var fs = o.fs || 12, big = !!o.big, items = [], boxes = [], rows = m.rows, n = rows.length, li = n - 1;
    var note = !m.price && !big && !o.print ? m.priceWhy : '';   /* only the page says why there is no price line */
    var axisH = Math.round(fs * 3.1), T = Math.round(fs * 2.3), R = Math.round(fs * 1.2);
    var gap = m.price || note ? Math.round(fs * 1.1) : 0;
    var priceH = m.price ? Math.max(Math.round(h * 0.2), Math.round(fs * 3.6)) : note ? Math.round(fs * 2.4) : 0;
    var evH = m.run ? Math.round(fs * 1.6) : 0, netB = h - axisH - priceH - gap - evH;
    var nets = rows.map(function (r) { return r.net; });
    var short = netB - T < fs * 9, tk = K.ticks(Math.min(0, Math.min.apply(null, nets)), Math.max(0, Math.max.apply(null, nets)), short ? 3 : 5, short ? 4 : 7);
    var lo = tk.lo, hi = tk.hi, pl = 0, ph = 0, plab = [];
    if (m.price) {
      var ps = rows.map(function (r) { return r.price; }).filter(function (v) { return v !== null; });
      pl = Math.min.apply(null, ps); ph = Math.max.apply(null, ps); plab = [K.pxShort(m.key, ph), K.pxShort(m.key, pl)];
    }
    var L = Math.round(Math.max.apply(null, tk.vals.map(kTick).concat(plab).map(function (s) { return tw(s, fs); })) + fs * 0.9);
    var t0 = dt(rows[0].date).getTime(), span = dt(m.last.date).getTime() - t0 || 1;
    var xs = rows.map(function (r) { return L + (dt(r.date).getTime() - t0) / span * (w - L - R); });
    function X(i) { return xs[i]; }
    function Y(v) { return T + (1 - (v - lo) / (hi - lo)) * (netB - T); }
    function box(x, y, s, size, al, base) {
      var bw = tw(s, size), bh = size * 1.25;
      var x0 = al === 'right' ? x - bw : al === 'center' ? x - bw / 2 : x;
      var y0b = base === 'top' ? y : base === 'middle' ? y - bh / 2 : y - bh;
      return [x0, y0b, x0 + bw, y0b + bh];
    }
    function hits(b) { return boxes.some(function (q) { return b[0] < q[2] + 4 && b[2] > q[0] - 4 && b[1] < q[3] + 4 && b[3] > q[1] - 4; }); }
    /* the net line does not run through b */
    function clearOfLine(b) { for (var i = 0; i < n; i++) { if (xs[i] < b[0] - fs || xs[i] > b[2] + fs) continue; var y = Y(nets[i]); if (y > b[1] - 3 && y < b[3] + 3) return false; } return true; }
    function label(it) { items.push(it); boxes.push(box(it.x, it.y, it.s, it.size, it.align, it.base)); }
    /* a block of lines, top-aligned from y: [{s, size, weight, ink}] */
    function block(ls, x, y, al) { var yy = y; ls.forEach(function (l) { items.push({ t: 'text', x: x, y: yy, s: l.s, ink: l.ink, size: l.size, weight: l.weight, align: al, base: 'top' }); yy += l.size * 1.2; }); }
    function bsize(ls, x, y, al) { var bw = Math.max.apply(null, ls.map(function (l) { return tw(l.s, l.size); })), bh = ls.reduce(function (a, l) { return a + l.size * 1.2; }, 0); var x0 = al === 'right' ? x - bw : al === 'center' ? x - bw / 2 : x; return [x0, y, x0 + bw, y + bh]; }
    /* round ticks, the unit once above the top one */
    tk.vals.forEach(function (v) {
      var y = Y(v);
      if (v !== 0) items.push({ t: 'line', pts: [[L, y], [w - R, y]], ink: 'grid', width: 1 });
      items.push({ t: 'text', x: L - fs * 0.5, y: y, s: kTick(v), ink: 'muted', size: fs, align: 'right', base: 'middle' });
    });
    label({ t: 'text', x: 0, y: Y(tk.vals[tk.vals.length - 1]) - fs * 0.7, s: 'Net contracts', ink: 'muted', size: fs, weight: 600, align: 'left', base: 'bottom' });
    var y0 = Y(0);
    items.push({ t: 'line', pts: [[L, y0], [w - R, y0]], ink: 'zero', width: 1.5 });
    var pts = rows.map(function (r, i) { return [xs[i], Y(r.net)]; });
    items.push({ t: 'area', pts: pts, base: y0, ink: 'netFill', op: o.print ? 0.08 : 0.13 });
    items.push({ t: 'line', pts: pts, ink: 'net', width: big ? 3.5 : o.print ? 2.5 : 2.25 });
    var hiI = rows.indexOf(m.hi), loI = rows.indexOf(m.lo), off = big ? 16 : 10, mo = big ? 13 : 8;
    var marks = [hiI, loI].filter(function (i) { return i !== li; }).map(function (i) { return [xs[i], Y(nets[i])]; });
    function covers(b) { return marks.some(function (p) { return p[0] > b[0] - 6 && p[0] < b[2] + 6 && p[1] > b[1] - 6 && p[1] < b[3] + 6; }); }
    /* the 52-week high and low: a ring, then "52-wk high 414.5k long" over its date */
    function mark(i, word, up) {
      var x = xs[i], y = Y(nets[i]), mk = [{ s: word + ' ' + K.kWords(nets[i]), size: fs, weight: 700, ink: 'text' }, { s: md(rows[i].date), size: fs, weight: 400, ink: 'muted' }];
      items.push({ t: 'dot', x: x, y: y, r: big ? 6 : 4, ink: 'surface', ring: 'net' });
      var bw = Math.max(tw(mk[0].s, fs), tw(mk[1].s, fs)), bh = fs * 2.4;
      var al = x - bw / 2 < L ? 'left' : x + bw / 2 > w - R ? 'right' : 'center', ax = al === 'left' ? x - fs * 0.3 : al === 'right' ? x + fs * 0.3 : x;
      var b = null, ok = false, rr = (big ? 6 : 4) + 4;
      /* above or below, centred; then hung to either side of the ring; then level with it on either side (kit v2
         part 2: a label never lands on another). -> false when it had to land on one */
      var qs = [[up, al], [!up, al], [up, 'right'], [up, 'left'], [!up, 'right'], [!up, 'left'], [null, 'right'], [null, 'left']];
      qs.concat(qs.slice(0, 2)).some(function (q, k) {
        var qx = q[0] === null ? (q[1] === 'left' ? x + rr : x - rr) : q[1] === al ? ax : q[1] === 'left' ? x - fs * 0.3 : x + fs * 0.3;
        var c = bsize(mk, qx, q[0] === null ? y - bh / 2 : q[0] ? y - mo - bh : y + mo, q[1]);
        if (c[0] >= 0 && c[2] <= w && c[1] >= 0 && c[3] <= netB + fs * 0.2 && (k > 7 || !hits(c))) { b = c; al = q[1]; ax = qx; ok = k < 8; return true; }
        return false;
      });
      if (!b) b = bsize(mk, ax, up ? y - mo - bh : y + mo, al);
      block(mk, ax, b[1], al); boxes.push(b);
      return ok;
    }
    var mk0 = items.length, bx0 = boxes.length;
    function marks2() { var a = hiI === li || mark(hiI, '52-wk high', true); return (loI === li || loI === hiI || mark(loI, '52-wk low', false)) && a; }
    var mOk = marks2();
    /* the latest point (placed after the marks, clear of their labels): its number (and "52-wk high" when it is one), its date, and a measured record */
    var lx = xs[li], ly = Y(m.last.net), lfs = Math.round(fs * 1.12), dr = big ? 8 : 5.5;
    var ls = [{ s: netWords(m.last.net) + (li === hiI ? ' (52-wk high)' : li === loI ? ' (52-wk low)' : ''), size: lfs, weight: 800, ink: 'text' },
      { s: md(m.last.date), size: fs, weight: 600, ink: 'muted' }];
    if (m.record) {
      var rec = m.record, cut = rec.indexOf(' in ');
      if (tw(rec, fs) > (w - L - R) * 0.6 && cut > 0) ls.push({ s: rec.slice(0, cut), size: fs, weight: 700, ink: 'text' }, { s: rec.slice(cut + 1), size: fs, weight: 700, ink: 'text' });
      else ls.push({ s: rec, size: fs, weight: 700, ink: 'text' });
    }
    var lh = ls.reduce(function (a, l) { return a + l.size * 1.2; }, 0), lxr = lx - dr - 2;
    var tries = (li === loI || ly - T < lh + off ? [false, true] : [true, false]).concat([null]), lx0 = lxr;
    /* above or below the dot, then level with it on its left -> [box, try] for the first clear one from try k0 */
    function fit(k0) {
      for (var k = k0; k < tries.length; k++) {
        var up = tries[k], x = up === null ? lx - dr - fs * 0.5 : lx0, b = bsize(ls, x, up === null ? ly - lh / 2 : up ? ly - off - lh : ly + off, 'right');
        if (b[0] >= 0 && b[1] >= T - fs * 0.6 && b[3] <= netB + (evH ? 0 : fs * 0.3) && !covers(b) && !hits(b)) { lxr = x; return [b, k]; }
      }
      return null;
    }
    var f = fit(0), lb = f && f[0], redo = !lb || !mOk;
    /* no clear spot for every label (a 52-week high a few weeks back, Nov 7): the latest label goes first, each of
       its spots in turn, until the marks find room around it, so no two labels touch */
    for (var k = 0, end = false; redo;) {
      items.length = mk0; boxes.length = bx0; f = fit(k);
      if (!f && k) { f = fit(0); end = true; }   /* none worked: its first clear spot */
      if (!f) lxr = lx0;
      lb = f ? f[0] : bsize(ls, lx0, tries[0] ? ly - off - lh : ly + off, 'right');
      boxes.push(lb);
      if (marks2() || !f || end) break;
      k = f[1] + 1;
    }
    items.push({ t: 'dot', x: lx, y: ly, r: dr, ink: 'net', ring: 'surface' });
    if (m.record) items.push({ t: 'dot', x: lx, y: ly, r: dr + (big ? 6 : 4), ink: 'none', ring: 'text', rw: 2 });
    block(ls, lxr, lb[1], 'right'); if (!redo) boxes.push(lb);
    /* one event at most: the run of buying or selling that ends on this report, bracketed on its own row under
       the run's weeks, its label to the left ("Sold 7 weeks: 405,665") */
    if (evH) {
      var x1 = xs[m.run.start], by = netB + fs * 0.8, sx = Math.max(x1 - fs * 0.5, tw(m.run.tag, fs));
      items.push({ t: 'line', pts: [[x1, by - fs * 0.45], [x1, by], [lx, by], [lx, by - fs * 0.45]], ink: 'muted', width: 2 });
      items.push({ t: 'text', x: sx, y: by, s: m.run.tag, ink: 'muted', size: fs, weight: 700, align: 'right', base: 'middle' });
    }
    /* "Funds long" just above zero and "Funds short" just below, where the line and the labels leave room */
    function room(up) {
      var s = up ? 'Funds long ↑' : 'Funds short ↓', band = fs * 1.9;
      for (var x0 = L + 6; x0 + tw(s, fs) < w - R; x0 += fs) {
        var bx = box(x0, up ? y0 - 5 : y0 + 5, s, fs, 'left', up ? 'bottom' : 'top'), clear = !hits(bx);
        for (var i = 0; i < n && clear; i++) {
          if (xs[i] < bx[0] - fs || xs[i] > bx[2] + fs) continue;
          var y = Y(nets[i]);
          if (up ? (y > y0 - band - 4 && y < y0 + 2) : (y < y0 + band + 4 && y > y0 - 2)) clear = false;
        }
        if (clear) return x0;
      }
      return null;
    }
    var xu = y0 - T > fs * 1.8 ? room(true) : null;
    if (xu !== null) label({ t: 'text', x: xu, y: y0 - 5, s: 'Funds long ↑', ink: 'muted', size: fs, weight: 600, align: 'left', base: 'bottom' });
    var xd = netB - y0 > fs * 1.8 ? room(false) : null;
    if (xd !== null) label({ t: 'text', x: xd, y: y0 + 5, s: 'Funds short ↓', ink: 'muted', size: fs, weight: 600, align: 'left', base: 'top' });
    /* the price strip: its own panel and its own scale (its high and low), the latest close at the line's end */
    var pT = netB + evH + gap, pB = pT + priceH;
    if (m.price) {
      var pad = fs * 0.55;
      var PY = function (v) { return pB - pad - (v - pl) / ((ph - pl) || 1) * (pB - pT - 2 * pad); };
      items.push({ t: 'line', pts: [[L, pT - gap / 2], [w - R, pT - gap / 2]], ink: 'grid', width: 1 });
      [ph, pl].forEach(function (v, i) {
        items.push({ t: 'line', pts: [[L, PY(v)], [w - R, PY(v)]], ink: 'grid', width: 1, dash: '2 3' });
        items.push({ t: 'text', x: L - fs * 0.5, y: PY(v), s: plab[i], ink: 'muted', size: fs, weight: 600, align: 'right', base: 'middle' });
      });
      var ppts = [];
      rows.forEach(function (r, i) { if (r.price !== null) ppts.push([xs[i], PY(r.price)]); });
      var e = ppts[ppts.length - 1], early = ppts.length - 1 < li;
      items.push({ t: 'line', pts: ppts, ink: 'price', width: big ? 2.5 : o.print ? 1.5 : 1.5, dash: o.print ? '4 3' : null });
      items.push({ t: 'dot', x: e[0], y: e[1], r: big ? 5 : 3.5, ink: 'price', ring: 'surface' });
      var pv = px(m.key, m.pLast.raw) + (early ? ' on ' + md(m.pLast.date) : ''), up2 = e[1] - pT > fs * 1.5;
      items.push({ t: 'text', x: e[0] - (big ? 8 : 5), y: up2 ? e[1] - fs * 0.4 : e[1] + fs * 0.4, s: pv, ink: 'text', size: fs, weight: 700, align: 'right', base: up2 ? 'bottom' : 'top' });
    } else if (note) {
      items.push({ t: 'line', pts: [[L, pT - gap / 2], [w - R, pT - gap / 2]], ink: 'grid', width: 1 });
      items.push({ t: 'text', x: L, y: pT + priceH / 2, s: note, ink: 'muted', size: fs, align: 'left', base: 'middle', wrap: w - L - R });
    }
    K.axis(rows.map(function (r) { return r.date; }), X, h - axisH + fs * 0.25, fs).forEach(function (it) { items.push(it); });
    return { w: w, h: h, items: items, X: X, Y: Y, L: L, R: R, T: T, netB: netB, pT: pT, pB: m.price || note ? pB : netB + evH };
  }

  /* ---------------------------------------------------------------- compare mode
     keys: up to 3 history keys. -> null without one market with two weeks, else
     {cmp:true, keys, series:[{key, name, vals:[0..100 or null per date], nets:[]}], dates, last, headline, asOf, src, rows(dates)} */
  function lowerName(k) { var n = CHIP[k] || k; return /^(Chicago|KC|MPLS|Class)/.test(n) ? n : n.charAt(0).toLowerCase() + n.slice(1); }
  function listWords(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  /* the printed whole number of a rank: 1 to 99, so a record never reads 0 or 100 (as the pipeline's shown_pct) */
  function shown(v) { return Math.min(99, Math.max(1, Math.round(v))); }
  function cmpModel(keys, hist, cot, cx) {
    var ser = [], all = {};
    keys.forEach(function (k) {
      var arr = hist && hist.history && hist.history[k];
      if (!arr) return;
      var rows = arr.filter(function (r) { return r && typeof r.net === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(r.date); })
        .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }).slice(-52);
      if (rows.length < 2) return;
      var by = {}, rk = {};
      rows.forEach(function (r) { by[r.date] = r.net; if (typeof r.rk === 'number') rk[r.date] = r.rk; all[r.date] = 1; });
      ser.push({ key: k, name: CHIP[k] || k, by: by, rk: rk, rows: rows });
    });
    if (!ser.length) return null;
    var dates = Object.keys(all).sort().slice(-52);
    ser.forEach(function (s2) {
      s2.vals = dates.map(function (d) { return typeof s2.rk[d] === 'number' ? s2.rk[d] : null; });
    });
    var last = dates[dates.length - 1], cxA = cx && G.iso(cx.report_date) === last ? cx : null;
    var rel = cxA && cxA.release_date ? cxA.release_date : null;
    /* the year each market's record starts (the analysis file names it); one year for all, or say so */
    var yrs = ser.map(function (s2) { var c = cx && cx.commodities && cx.commodities[s2.key]; return c && c.first_week ? String(c.first_week).slice(0, 4) : ''; });
    var since = yrs.every(function (y) { return y && y === yrs[0]; }) ? 'since ' + yrs[0] : 'since each market\u2019s first week on record';
    var names = ser.map(function (s2) { return lowerName(s2.key); });
    return { cmp: true, keys: ser.map(function (s2) { return s2.key; }), series: ser, dates: dates, last: { date: last }, rows: dates, since: since,
      name: listWords(ser.map(function (s2) { return s2.name; })),
      headline: 'Funds in ' + listWords(names) + ': share of open interest, rank ' + since,
      axis: 'Each week\u2019s net as a share of open interest, ranked against all weeks ' + since + ' up to it (0 to 100).',
      asOf: 'Week to ' + full(last) + '.' + (rel ? ' Released ' + full(rel) + '.' : ''),
      src: 'CFTC Commitments of Traders, managed money, week to ' + full(last) + (rel ? ', released ' + full(rel) : '') + '.' };
  }
  function layoutCmp(m, w, h, o) {
    o = o || {};
    var fs = o.fs || 12, items = [], axisH = Math.round(fs * 3.1);
    var L = Math.round(fs * 2.9), R = Math.round(fs * 1.2), T = Math.round(fs * 1.6), B = h - axisH, n = m.dates.length;
    function X(i) { return L + (i / Math.max(n - 1, 1)) * (w - L - R); }
    function Y(v) { return T + (1 - v / 100) * (B - T); }
    [0, 25, 50, 75, 100].forEach(function (v) {
      items.push({ t: 'line', pts: [[L, Y(v)], [w - R, Y(v)]], ink: v === 50 ? 'zero' : 'grid', width: v === 50 ? 1.5 : 1 });
      items.push({ t: 'text', x: L - 6, y: Y(v), s: String(v), ink: 'muted', size: fs, align: 'right', base: 'middle' });
    });
    var ends = [];
    m.series.forEach(function (s2, si) {
      var seg = [];
      function flush() { if (seg.length > 1) items.push({ t: 'line', pts: seg, ink: 'c' + si, width: o.big ? 3.5 : 2.25 }); seg = []; }
      var li = -1;
      s2.vals.forEach(function (v, i) { if (v === null) flush(); else { seg.push([X(i), Y(v)]); li = i; } });
      flush();
      if (li >= 0) { items.push({ t: 'dot', x: X(li), y: Y(s2.vals[li]), r: o.big ? 7 : 5, ink: 'c' + si, ring: 'surface' }); ends.push({ si: si, x: X(li), y: Y(s2.vals[li]), s: s2.name + ' ' + shown(s2.vals[li]) }); }
    });
    /* direct labels at the line ends, above the dot, pushed apart so none covers another */
    var gap = fs * 1.4, off = o.big ? 14 : 9;
    ends.sort(function (a, b) { return a.y - b.y; });
    ends.forEach(function (e, i) { e.ly = Math.max(T + fs, e.y - off); if (i && e.ly < ends[i - 1].ly + gap) e.ly = ends[i - 1].ly + gap; });
    for (var j = ends.length - 1; j >= 0; j--) { var cap = j === ends.length - 1 ? B - 2 : ends[j + 1].ly - gap; if (ends[j].ly > cap) ends[j].ly = cap; }
    ends.forEach(function (e) { items.push({ t: 'text', x: e.x, y: e.ly, s: e.s, ink: 'c' + e.si, size: Math.round(fs * 1.08), weight: 800, align: 'right', base: 'bottom', halo: true }); });
    K.axis(m.dates, X, h - axisH + fs * 0.25, fs).forEach(function (it) { items.push(it); });
    return { w: w, h: h, items: items, X: X, Y: Y, L: L, R: R, T: T, netB: B, pB: B, cmp: true };
  }

  /* ---------------------------------------------------------------- painters */
  var SVG_INK = { net: 'var(--chart-1)', netFill: 'var(--chart-1)', price: 'var(--chart-2)', grid: 'var(--chart-grid)',
    zero: 'var(--text)', axis: 'var(--chart-text)', text: 'var(--text)', muted: 'var(--text-muted)', surface: 'var(--surface)', none: 'none',
    c0: 'var(--cmp-1)', c1: 'var(--cmp-2)', c2: 'var(--cmp-3)' };
  var ANCHOR = { left: 'start', center: 'middle', right: 'end' };
  var BASE = { top: 'hanging', middle: 'central', bottom: 'auto' };
  function path(pts) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(''); }
  function toSvg(g) {
    var s = '';
    g.items.forEach(function (it) {
      if (it.t === 'line') s += '<path d="' + path(it.pts) + '" fill="none" stroke="' + SVG_INK[it.ink] + '" stroke-width="' + it.width + '"' + (it.dash ? ' stroke-dasharray="' + it.dash + '"' : '') + ' stroke-linejoin="round" stroke-linecap="round"/>';
      else if (it.t === 'area') s += '<path d="' + path(it.pts) + 'L' + it.pts[it.pts.length - 1][0].toFixed(1) + ' ' + it.base.toFixed(1) + 'L' + it.pts[0][0].toFixed(1) + ' ' + it.base.toFixed(1) + 'Z" fill="' + SVG_INK[it.ink] + '" fill-opacity="' + (it.op || 0.13) + '" stroke="none"/>';
      else if (it.t === 'dot') s += '<circle cx="' + it.x.toFixed(1) + '" cy="' + it.y.toFixed(1) + '" r="' + it.r + '" fill="' + SVG_INK[it.ink] + '" stroke="' + SVG_INK[it.ring] + '" stroke-width="' + (it.rw || 2) + '"/>';
      else if (it.t === 'text') {
        var attrs = ' x="' + it.x.toFixed(1) + '" y="' + it.y.toFixed(1) + '" fill="' + SVG_INK[it.ink] + '" font-size="' + it.size + '"' + (it.weight ? ' font-weight="' + it.weight + '"' : '') + ' text-anchor="' + ANCHOR[it.align || 'left'] + '" dominant-baseline="' + BASE[it.base || 'bottom'] + '" stroke="' + SVG_INK.surface + '" stroke-width="3" stroke-linejoin="round" paint-order="stroke"';
        if (it.wrap) {   /* the no-price note: two lines at most */
          var ws = it.s.split(' '), a = [], cur = '', per = Math.floor(it.wrap / (it.size * 0.52));
          ws.forEach(function (x) { if ((cur + ' ' + x).trim().length > per && cur) { a.push(cur); cur = x; } else cur = (cur + ' ' + x).trim(); });
          a.push(cur);
          s += '<text' + attrs.replace(/ y="[^"]*"/, ' y="' + (it.y - (a.length - 1) * it.size * 0.65).toFixed(1) + '"') + '>' + a.map(function (t, i) { return '<tspan x="' + it.x.toFixed(1) + '"' + (i ? ' dy="' + (it.size * 1.3).toFixed(1) + '"' : '') + '>' + esc(t) + '</tspan>'; }).join('') + '</text>';
        } else s += '<text' + attrs + '>' + esc(it.s) + '</text>';
      }
    });
    return s;
  }
  /* the saved picture is always the dark card (the site's default look), so every copy matches */
  var PNG_INK = { net: '#d4a23f', netFill: 'rgba(212,162,63,.16)', price: '#8fa6b2', grid: 'rgba(132,160,168,.18)', zero: 'rgba(233,237,235,.85)',
    axis: 'rgba(233,237,235,.72)', text: '#e9edeb', muted: 'rgba(233,237,235,.74)', surface: '#101415', none: '',
    c0: '#d4a23f', c1: '#62aee0', c2: '#e07a9a' };
  function paint(ctx, g, ox, oy) {
    var SK = kit(), FONT = SK.FONT;
    ctx.save(); ctx.translate(ox, oy);
    g.items.forEach(function (it) {
      if (it.t === 'line' || it.t === 'area') {
        ctx.beginPath();
        it.pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
        if (it.t === 'area') {
          ctx.lineTo(it.pts[it.pts.length - 1][0], it.base); ctx.lineTo(it.pts[0][0], it.base); ctx.closePath();
          ctx.fillStyle = PNG_INK[it.ink]; ctx.fill();
        } else { ctx.strokeStyle = PNG_INK[it.ink]; ctx.lineWidth = it.width; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash(it.dash ? it.dash.split(' ').map(Number) : []); ctx.stroke(); ctx.setLineDash([]); }
      } else if (it.t === 'dot') {
        ctx.beginPath(); ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2);
        if (PNG_INK[it.ink]) { ctx.fillStyle = PNG_INK[it.ink]; ctx.fill(); }
        ctx.lineWidth = it.rw || 3; ctx.strokeStyle = PNG_INK[it.ring]; ctx.stroke();
      } else if (it.t === 'text') {
        ctx.fillStyle = PNG_INK[it.ink]; ctx.font = (it.weight || 400) + ' ' + it.size + 'px ' + FONT;
        ctx.textAlign = it.align || 'left'; ctx.textBaseline = it.base === 'top' ? 'top' : it.base === 'middle' ? 'middle' : 'alphabetic';
        var ty = it.base === 'bottom' || !it.base ? it.y - 2 : it.y;
        var ls = it.wrap ? SK.wrap(ctx, it.s, it.wrap) : [it.s];
        ls.forEach(function (t, i) {
          var yy = ty + (i - (ls.length - 1) / 2) * it.size * 1.3;
          ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.strokeStyle = PNG_INK.surface; ctx.strokeText(t, it.x, yy);
          ctx.fillText(t, it.x, yy);
        });
      }
    });
    ctx.restore();
  }
  /* The saved picture. o.phone: 1080x1350 (4:5, the default on a phone): headline 60 px, every other word 26 px
     or more, so it reads at 390 px wide; else 1200x675 (desktop). Both: agsist.com/cot, the headline, the answer
     line, the chart (with the price strip when the market has one), the report date and the source, then the
     Funds this week ask on its own last line ("Free every Friday: agsist.com/cot", Sig, Nov 6).
     -> {canvas, texts, sizes, ys} (texts and their font sizes, every string drawn, and the baselines of the ones
     drawn outside the chart, for the tests) */
  function image(m, doc, o) {
    o = o || {};
    var ph = !!o.phone, W = ph ? 1080 : 1200, H = ph ? 1350 : 675, P = ph ? 60 : 56;
    var SK = kit(), c = SK.canvas(doc, W, H), ctx = c.getContext('2d'), p = SK.pen(ctx), text = p.text;
    function wrapped(s, size, weight, max) { p.font(size, weight); return p.wrap(s, W - 2 * P).slice(0, max); }
    SK.frame(ctx, W, H, ph ? 12 : 8);
    var head = m.cmp ? m.headline : m.head || ('Managed money in ' + m.name.toLowerCase() + ': ' + netWords(m.last.net) + ' contracts.');
    var stand = m.cmp ? '' : m.stand || '';
    var sub = m.cmp ? m.axis : 'Managed money net position, ' + m.name.toLowerCase() + ', each week since ' + mdy(m.rows[0].date);
    var rs = m.rows, ql = m.cmp ? '' : K.qtyLine(m.key, m.last.net, rs.length > 1 ? m.last.net - rs[rs.length - 2].net : null);
    var src = 'Source: ' + m.src + (ql ? ' ' + K.SPEC_SRC : ''), y, g, gh, GOLD = SK.GOLD, INK = SK.INK;
    if (ph) {
      SK.head(p, P, 'agsist.com/cot', m.asOf, { size: 40, ink: 'rgba(233,237,235,.86)' });
      y = 210;
      wrapped(head, 60, 800, 3).forEach(function (s) { text(s, P, y, 60, 800, INK); y += 72; });
      if (stand) { text(stand, P, y + 2, 44, 700, GOLD); y += 58; }
      if (ql) { wrapped(ql, 28, 600, 2).forEach(function (s) { text(s, P, y, 28, 600, INK); y += 38; }); }
      y += 4;
      if (m.answer) { wrapped(m.answer, 30, 500, 4).forEach(function (s) { text(s, P, y, 30, 500, INK); y += 41; }); y += 8; }
      wrapped(sub, 26, 600, 2).forEach(function (s) { text(s, P, y, 26, 600, 'rgba(233,237,235,.80)'); y += 34; });
      /* the ask on its own last line, a gap above it so the source line is not crowded (Sig, Nov 6) */
      var srcL = wrapped(src, 20, 400, 4), foot = H - 40 - 50 - (srcL.length - 1) * 26;
      gh = foot - 50 - y;
      g = layout(m, W - 2 * P, gh, { fs: 26, big: true });
      paint(ctx, g, P, y + 6);
      srcL.forEach(function (s, i) { text(s, P, foot + i * 26, 20, 400, 'rgba(233,237,235,.72)'); });
      text(ASK, P, H - 40, 28, 700, GOLD);
    } else {
      text('agsist.com/cot', P, 62, 26, 800, GOLD);
      text(m.asOf, W - P, 62, 22, 600, 'rgba(233,237,235,.80)', 'right');
      var hl = wrapped(head, 38, 800, 2);
      hl.forEach(function (s, i) { text(s, P, 122 + i * 48, 38, 800, INK); });
      var top = 122 + (hl.length - 1) * 48 + 30;
      if (stand) { text(stand, P, top + 6, 26, 700, GOLD); top += 36; }
      if (ql) { text(ql, P, top + 2, 20, 600, INK); top += 30; }
      text(sub, P, top + 4, 20, 600, 'rgba(233,237,235,.74)');
      gh = H - top - 124; g = layout(m, W - 2 * P, gh, { fs: 19, big: true });
      paint(ctx, g, P, top + 18);
      wrapped(src, 14, 400, 2).forEach(function (s, i) { text(s, P, H - 70 + i * 18, 14, 400, 'rgba(233,237,235,.68)'); });
      text(ASK, P, H - 20, 19, 700, GOLD);
    }
    p.keep(g.items);
    return { canvas: c, texts: p.texts, sizes: p.sizes, ys: p.ys };
  }

  /* ---------------------------------------------------------------- the page */
  var api = { model: model, cmpModel: cmpModel, shown: shown, layout: layout, toSvg: toSvg, image: image, netWords: netWords, kTick: kTick, px: px, CHIP: CHIP };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgCotChart = api;
  var doc = root.document, box = doc && doc.getElementById('cot-chart-box');
  if (!box) return;
  var D = { cot: null, hist: null, cx: null }, cur = null, geo = null, M = null, cmp = false, sel = [], MAXSEL = 3;
  function $(id) { return doc.getElementById(id); }
  function gtag(name, p) { try { if (typeof root.gtag === 'function') root.gtag('event', name, p); } catch (e) {} }

  (function initKey() {
    var q = null; try { q = new URLSearchParams(root.location.search).get('m'); } catch (e) {}
    var ks = [];
    String(q || '').split(',').forEach(function (p) { var k = G.keyOf(p.trim()); if (k && ks.indexOf(k) < 0 && ks.length < MAXSEL) ks.push(k); });
    cur = ks[0] || 'corn';
    if (ks.length > 1) { cmp = true; sel = ks; }
  })();
  /* the chips */
  var chips = $('cc-chips');
  /* the chips are in the page (so the row holds its place from the first paint); fill them only if missing */
  if (!chips.querySelector('.cc-chip')) chips.innerHTML = ORDER.map(function (k) {
    return '<button type="button" class="cc-chip" data-k="' + k + '" aria-pressed="' + (k === cur) + '">' + esc(CHIP[k]) + '</button>';
  }).join('');
  chips.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.cc-chip') : null;
    if (!b) return;
    if (cmp) { toggleSel(b.getAttribute('data-k')); return; }
    select(b.getAttribute('data-k'), true); gtag('cot_chart_market', { market: G.SLUG[cur] });
  });
  var cmpBtn = $('cc-cmp');
  if (cmpBtn) cmpBtn.addEventListener('click', function () {
    setMode(!cmp); gtag('cot_chart_compare', { on: cmp ? 1 : 0 });
  });
  function setMode(on) {
    cmp = !!on;
    if (cmp) sel = [cur]; else cur = sel[0] || cur;
    markChips(); url(); draw();
  }
  function toggleSel(k) {
    if (!G.SLUG[k]) return;
    var i = sel.indexOf(k);
    if (i >= 0) {
      if (sel.length < 2) { toast('Keep at least one market.'); return; }
      sel.splice(i, 1);
    } else {
      if (sel.length >= MAXSEL) { toast('Pick up to 3 markets. Tap one to take it off first.'); return; }
      sel.push(k);
    }
    cur = sel[0]; markChips(); url(); draw();
    gtag('cot_chart_market', { market: sel.map(function (x) { return G.SLUG[x]; }).join(',') });
  }
  /* a short note over the top of the plot: it takes no room, so nothing below it moves */
  function toast(msg) {
    var t = $('cc-toast');
    if (!t) { t = doc.createElement('p'); t.id = 'cc-toast'; t.className = 'cc-toast'; t.setAttribute('role', 'status'); $('cc-plot').appendChild(t); }
    t.textContent = msg; t.hidden = false;
    var l = $('cc-live'); if (l) l.textContent = msg;
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 4000);
  }
  /* the link carries the picks: ?m=corn,soybeans (a comma, not %2C) */
  function slugs() { return (cmp ? sel : [cur]).map(function (x) { return G.SLUG[x]; }).join(','); }
  function url() {
    try {
      var u = new URL(root.location.href);
      u.search = '?m=' + slugs();
      root.history.replaceState(root.history.state, '', u.pathname + u.search + u.hash);
    } catch (e) {}
  }
  function markChips() {
    box.classList.toggle('cmp', cmp);
    if (cmpBtn) cmpBtn.setAttribute('aria-pressed', cmp ? 'true' : 'false');
    Array.prototype.forEach.call(chips.querySelectorAll('.cc-chip'), function (b) {
      var si = cmp ? sel.indexOf(b.getAttribute('data-k')) : -1;
      var on = cmp ? si >= 0 : b.getAttribute('data-k') === cur;
      if (si >= 0) b.style.setProperty('--c', 'var(--cmp-' + (si + 1) + ')'); else b.style.removeProperty('--c');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on && b.scrollIntoView && chips.scrollWidth > chips.clientWidth) {
        var l = b.offsetLeft - chips.offsetLeft, r = l + b.offsetWidth;
        if (l < chips.scrollLeft || r > chips.scrollLeft + chips.clientWidth) chips.scrollLeft = Math.max(0, l - 16);
      }
    });
  }
  function select(k, push) {
    if (!G.SLUG[k]) return;
    cur = k; cmp = false; markChips(); draw();
    if (push) url();
  }
  api.select = select;
  api.current = function () { return cur; };
  api.shareUrl = function () { return SITE + '/cot?m=' + slugs(); };
  api.slugs = slugs;
  api.selected = function () { return cmp ? sel.slice() : [cur]; };
  api.compare = function () { return cmp; };

  function draw() {
    var plot = $('cc-plot'), svg = $('cc-svg'), msg = $('cc-msg');
    if (!D.hist) return;
    if (cmp) return drawCmp(plot, svg, msg);
    box.removeAttribute('data-mode');
    M = model(cur, D.hist, D.cot, D.cx);
    $('cc-head').innerHTML = '<span>' + (M && M.headlineHtml ? M.headlineHtml : esc(CHIP[cur]) + ': managed money net position, last 52 weeks') + '</span>';
    answerLine(cur);
    howLine(cur);
    if (!M) {
      svg.innerHTML = ''; msg.hidden = false; msg.textContent = 'No 52-week record for ' + CHIP[cur] + ' in this report.';
      $('cc-src').textContent = ''; geo = null; box.removeAttribute('data-latest'); return;
    }
    msg.hidden = true;
    var w = Math.max(280, Math.round(plot.clientWidth || 340)), h = Math.round(plot.clientHeight || 300);
    geo = layout(M, w, h, { fs: 12 });
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('aria-label', M.name + ', managed money net position over the last ' + M.rows.length + ' weekly reports: ' + netWords(M.last.net)
      + ' contracts on ' + mdy(M.last.date) + '; 52-week high ' + netWords(M.hi.net) + ' (' + md(M.hi.date) + '), low ' + netWords(M.lo.net) + ' (' + md(M.lo.date) + ').');
    svg.innerHTML = toSvg(geo) + '<line id="cc-rule" x1="0" x2="0" y1="' + geo.T + '" y2="' + geo.pB + '" stroke="var(--text-muted)" stroke-width="1" visibility="hidden"/>'
      + '<circle id="cc-hot" r="5" fill="var(--chart-1)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>';
    $('cc-src').textContent = M.src;
    box.setAttribute('data-latest', String(M.last.net));
    box.setAttribute('data-market', cur);
    box.setAttribute('data-price', M.price ? '1' : '0');
    table();
    hide();
  }
  function drawCmp(plot, svg, msg) {
    M = cmpModel(sel, D.hist, D.cot, D.cx);
    if (!M) {
      $('cc-head').innerHTML = '<span>Compare markets, last 52 weeks</span>';
      svg.innerHTML = ''; msg.hidden = false; msg.textContent = 'No 52-week record for these markets in this report.';
      $('cc-src').textContent = ''; geo = null; box.removeAttribute('data-latest'); return;
    }
    msg.hidden = true;
    var w = Math.max(280, Math.round(plot.clientWidth || 340)), h = Math.round(plot.clientHeight || 300);
    geo = layout(M, w, h, { fs: 12 });
    $('cc-head').innerHTML = '<span>' + esc(M.headline) + '</span>';
    answerLine(sel[0]);
    howLine(null);
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('aria-label', M.headline + '. ' + M.series.map(function (s) { var v = s.vals[s.vals.length - 1]; return s.name + ' ' + (v === null ? 'no report' : 'higher than ' + shown(v) + '% of weeks'); }).join(', ') + ' on ' + mdy(M.last.date) + '.');
    svg.innerHTML = toSvg(geo) + '<line id="cc-rule" x1="0" x2="0" y1="' + geo.T + '" y2="' + geo.pB + '" stroke="var(--text-muted)" stroke-width="1" visibility="hidden"/>'
      + M.series.map(function (s, i) { return '<circle id="cc-hot' + i + '" class="cc-hotc" r="5" fill="var(--cmp-' + (i + 1) + ')" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>'; }).join('');
    $('cc-src').textContent = M.axis + ' ' + M.src;
    box.setAttribute('data-mode', 'compare');
    box.setAttribute('data-market', sel.join(','));
    box.setAttribute('data-latest', M.series.map(function (s) { var v = s.vals[s.vals.length - 1]; return v === null ? '' : shown(v); }).join(','));
    box.setAttribute('data-price', '0');
    var t = $('cc-table');
    if (t) t.innerHTML = '<caption>' + esc(M.name) + ': each week\'s managed money net as a share of open interest, ranked against every week ' + esc(M.since) + ' up to that week, 0 lowest, 100 highest</caption><thead><tr><th scope="col">Week of</th>'
      + M.series.map(function (s) { return '<th scope="col">' + esc(s.name) + '</th>'; }).join('') + '</tr></thead><tbody>'
      + M.dates.map(function (d, i) { return i; }).reverse().map(function (i) { return '<tr><td>' + mdy(M.dates[i]) + '</td>' + M.series.map(function (s) { return '<td>' + (s.vals[i] === null ? '' : shown(s.vals[i])) + ' (' + netWords(s.by[M.dates[i]]) + ')</td>'; }).join('') + '</tr>'; }).join('')
      + '</tbody>';
    hide();
  }
  /* The answer line under the title, for the market picked (the first pick in Compare): baked for corn in the
     HTML, rewritten here only when the report and its analysis give one, so a missing file never blanks it. */
  function answerLine(k) {
    var el = $('cc-answer');
    /* only with the analysis for the same report: the baked line carries the rank, and a line written before the
       analysis lands would drop it and then grow back (a layout shift) */
    if (!el || !D.cot || !D.cx || G.iso(D.cx.report_date) !== G.iso(D.cot.report_date)) return;
    var a = G.answer(k, D.cot, D.cx, Date.now());
    if (a && el.textContent !== a.text) el.textContent = a.text;
  }
  /* Longs and shorts under the headline (G.how: the analysis card's line); same-week files only, else the baked line stays */
  function howLine(k) {
    var el = $('cc-how');
    if (!el || (k && (!D.cot || !D.cx || G.iso(D.cx.report_date) !== G.iso(D.cot.report_date)))) return;
    var t = k ? G.how(k, D.cot, D.cx) : '';
    if (el.textContent !== t) el.textContent = t;
  }
  api.answerLine = function () { answerLine(cmp ? sel[0] : cur); };
  /* the numbers, for screen readers and anyone who wants them */
  function table() {
    var t = $('cc-table');
    if (!t || !M) return;
    t.innerHTML = '<caption>' + esc(M.name) + ': managed money net position by report week</caption><thead><tr><th scope="col">Week of</th><th scope="col">Net (contracts)</th>'
      + (M.price ? '<th scope="col">Futures close</th>' : '') + '</tr></thead><tbody>'
      + M.rows.slice().reverse().map(function (r) { return '<tr><td>' + mdy(r.date) + '</td><td>' + netWords(r.net) + '</td>' + (M.price ? '<td>' + px(cur, r.raw) + '</td>' : '') + '</tr>'; }).join('')
      + '</tbody>';
  }

  /* hover or tap: the week's date and net (and close) */
  var tip = $('cc-tip'), plotEl = $('cc-plot'), at = -1;
  function show(i) {
    if (!geo || !M) return;
    i = Math.max(0, Math.min(M.rows.length - 1, i)); at = i;
    if (M.cmp) return showCmp(i);
    var r = M.rows[i], x = geo.X(i), y = geo.Y(r.net);
    var rule = $('cc-rule'), hot = $('cc-hot');
    rule.setAttribute('x1', x); rule.setAttribute('x2', x); rule.setAttribute('visibility', 'visible');
    hot.setAttribute('cx', x); hot.setAttribute('cy', y); hot.setAttribute('visibility', 'visible');
    tip.innerHTML = '<b>' + esc(mdy(r.date)) + '</b><br>Net ' + esc(netWords(r.net)) + (M.price && r.raw !== null ? '<br>Futures close ' + esc(px(cur, r.raw)) : '');
    tip.hidden = false;
    var tw = tip.offsetWidth || 150, left = x + 12;
    if (left + tw > geo.w) left = x - tw - 12;
    tip.style.left = Math.max(0, left) + 'px';
    tip.style.top = (y < geo.T + 70 ? geo.netB - 70 : geo.T) + 'px';
    $('cc-live').textContent = mdy(r.date) + ': net ' + netWords(r.net) + ' contracts.';
  }
  function showCmp(i) {
    var x = geo.X(i), rule = $('cc-rule'), top = geo.T, d = M.dates[i];
    rule.setAttribute('x1', x); rule.setAttribute('x2', x); rule.setAttribute('visibility', 'visible');
    var ys = [];
    M.series.forEach(function (s, k) {
      var hot = $('cc-hot' + k), v = s.vals[i];
      if (!hot) return;
      if (v === null) { hot.setAttribute('visibility', 'hidden'); return; }
      hot.setAttribute('cx', x); hot.setAttribute('cy', geo.Y(v)); hot.setAttribute('visibility', 'visible'); ys.push(geo.Y(v));
    });
    tip.innerHTML = '<b>' + esc(mdy(d)) + '</b>' + M.series.map(function (s, k) {
      var v = s.vals[i];
      return '<br><span class="cc-sw" style="background:var(--cmp-' + (k + 1) + ')"></span>' + esc(s.name) + ' ' + (v === null ? 'no report' : shown(v) + ' (' + esc(netWords(s.by[d])) + ')');
    }).join('');
    tip.hidden = false;
    var tw = tip.offsetWidth || 190, left = x + 12;
    if (left + tw > geo.w) left = x - tw - 12;
    tip.style.left = Math.max(0, left) + 'px';
    tip.style.top = (Math.min.apply(null, ys.concat([geo.netB])) < top + 90 ? geo.netB - 90 : top) + 'px';
    $('cc-live').textContent = mdy(d) + ': ' + M.series.map(function (s) { return s.name + ' ' + (s.vals[i] === null ? 'no report' : 'higher than ' + shown(s.vals[i]) + '% of weeks'); }).join(', ') + '.';
  }
  function hide() {
    var hs = doc.querySelectorAll('.cc-hotc'); Array.prototype.forEach.call(hs, function (e) { e.setAttribute('visibility', 'hidden'); }); at = -1; if (tip) tip.hidden = true; var r = $('cc-rule'), h = $('cc-hot'); if (r) r.setAttribute('visibility', 'hidden'); if (h) h.setAttribute('visibility', 'hidden'); }
  function idx(clientX) {
    if (!geo) return -1;
    var b = plotEl.getBoundingClientRect(), x = (clientX - b.left) * (geo.w / (b.width || geo.w)), n = M.rows.length, j = 0;
    if (x < geo.L - 30 || x > geo.w + 30) return -9;
    for (var i = 1; i < n; i++) if (Math.abs(geo.X(i) - x) < Math.abs(geo.X(j) - x)) j = i;
    return j;
  }
  plotEl.addEventListener('pointermove', function (e) { var i = idx(e.clientX); if (i >= -2 && M && i <= M.rows.length + 1) show(i); else hide(); });
  plotEl.addEventListener('pointerdown', function (e) { show(idx(e.clientX)); });
  plotEl.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(); });
  plotEl.addEventListener('keydown', function (e) {
    if (!M) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); show((at < 0 ? M.rows.length - 1 : at) + (e.key === 'ArrowLeft' ? -1 : 1)); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); show(e.key === 'Home' ? 0 : M.rows.length - 1); }
    else if (e.key === 'Escape') hide();
  });
  plotEl.addEventListener('blur', hide);

  /* Share, Save picture and Print sheet: components/cot-share.js (pick your market, the share fallback, the tags) */

  /* cot-page.js hands over what it fetched: {cot, hist, cx}; any may be missing */
  api.update = function (o) {
    if (o.cot !== undefined) D.cot = o.cot;
    if (o.hist !== undefined) D.hist = o.hist;
    if (o.cx !== undefined) D.cx = o.cx;
    draw();
    /* the printed sheet (components/cot-print.js) builds from the same files, never its own fetch */
    try { doc.dispatchEvent(new CustomEvent('cot:chart-data', { detail: { cot: D.cot, hist: D.hist, cx: D.cx } })); } catch (e) {}
  };
  api.data = function () { return { cot: D.cot, hist: D.hist, cx: D.cx }; };
  var rz = 0;
  root.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(draw, 120); });
  markChips();
})(typeof window !== 'undefined' ? window : this);
