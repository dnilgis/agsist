/* The 52-week funds chart on /cot (Nov 5, 2026, Sig: "I want the 52-week COT chart enhanced and made near the
   top of the page ... I can picture people sharing it if we make it easy").

   One market at a time, picked by chips; the pick rides in the link (/cot?m=soybeans) so a shared link opens on
   that market. The main line is managed money's net position for the 52 weekly reports in data/cot-history.json,
   with zero drawn plainly (funds long above, funds short below), this week's point labelled with its number and
   the 52-week high and low marked. The futures price sits in its own quieter strip under it, on the same weeks:
   one axis per panel, never a second scale on the net (dataviz rule). The strip is drawn only when every week in
   view has a close and the roll-repaired index (px_adj) and the pipeline does not withhold the market's price
   (cot_analysis.py price_withheld_reason: lean hogs' rolls are not repaired; Minneapolis wheat has no feed).
   Otherwise the strip says why and draws nothing: no half-drawn line.

   The title is the market's one brief line (AgCotGlance.brief: "Soybeans: funds long, fairly heavy (75th since
   2010), sold 27,544 this week"), shown only
   when the chart's last week is the report on the page and carries the same net; the source line names the
   CFTC report, the Tuesday and the release day (the release day only when the analysis is for the same week).

   One layout feeds two painters: the inline SVG on the page and a 1200x675 canvas for "Save image", so the
   saved picture is the chart on screen. "Share this chart" uses the phone's share sheet, or copies the link.
   cot-page.js hands this file the data it already fetched (AgCotChart.update); nothing here fetches.
   Compare mode (Nov 5, Sig: "Is there a way to select multiple commodities in the COT chart?"): up to three markets on
   one 0 to 100 axis. Since Nov 6 (one rank engine) each line is the pipeline's `rk` on every cot-history.json row:
   that week's net as a share of open interest, ranked against every week since 2010 up to that week only (no
   hindsight), at or below, the rule of the headline rank; the latest point is the headline rank exactly. Nothing is
   ranked in the browser. The link is /cot?m=corn,soybeans.
   Under the title, the answer line (AgCotGlance.answer): what managed money did, the rank in words, the Tuesday and
   the next report. Save image draws 1080x1350 (4:5) on a phone, text 26 px or more, and 1200x675 on a desktop.
   Exports window.AgCotChart (and module.exports for the tests: model, layout, fmt helpers). */
(function (root) {
  'use strict';
  var G = root.AgCotGlance || (typeof require === 'function' ? require('./cot-glance.js') : null);
  var ORDER = G.ORDER;
  var CHIP = G.SHORT;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MINUS = '−';
  var SITE = 'https://agsist.com';

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function commas(n) { return Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  /* 193781 -> "193,781 long"; -74606 -> "74,606 short"; 0 -> "0" */
  function netWords(n) { return n === 0 ? '0' : commas(n) + (n > 0 ? ' long' : ' short'); }
  /* axis ticks: 100000 -> "100k", -50000 -> "−50k" */
  function kTick(v) {
    if (v === 0) return '0';
    var a = Math.abs(v), s = a >= 1000 ? (a % 1000 ? (a / 1000).toFixed(1) : String(a / 1000)) + 'k' : String(a);
    return (v < 0 ? MINUS : '') + s;
  }
  function dt(s) { return new Date(String(s) + 'T12:00:00'); }
  function mdy(s) { var d = dt(s); return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
  function md(s) { var d = dt(s); return MON[d.getMonth()] + ' ' + d.getDate(); }

  /* Futures closes as the price file stores them (enrich_cot_prices.py: exchange units), in a farmer's units. */
  function cents(c) { /* 1229.25 cents -> "$12.29¼" */
    var q = Math.round(c * 4) / 4, whole = Math.floor(q + 1e-9), f = Math.round((q - whole) * 4);
    var d = Math.floor(whole / 100), r = whole % 100;
    return '$' + d + '.' + ('0' + r).slice(-2) + ['', '¼', '½', '¾'][f];
  }
  var UNIT = {
    corn: function (p) { return cents(p) + '/bu'; }, beans: function (p) { return cents(p) + '/bu'; },
    wheat: function (p) { return cents(p) + '/bu'; }, kcwheat: function (p) { return cents(p) + '/bu'; },
    mplswheat: function (p) { return cents(p) + '/bu'; },
    soymeal: function (p) { return '$' + p.toFixed(2) + '/ton'; },
    soyoil: function (p) { return p.toFixed(2) + '¢/lb'; },
    livecattle: function (p) { return '$' + p.toFixed(2) + '/cwt'; }, feedercattle: function (p) { return '$' + p.toFixed(2) + '/cwt'; },
    leanhogs: function (p) { return '$' + p.toFixed(2) + '/cwt'; },
    milk: function (p) { return '$' + p.toFixed(2) + '/cwt'; }
  };
  function px(key, p) { return typeof p === 'number' && UNIT[key] ? UNIT[key](p) : ''; }

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
    var every = rows.every(function (r) { return r.raw !== null && r.adj !== null; });
    var price = !reason && every && last.adj > 0;
    if (price) {
      var k = last.raw / last.adj;   /* the repaired index scaled so its last point is the last close */
      rows.forEach(function (r) { r.price = Math.round(r.adj * k * 100) / 100; });
    }
    var priceWhy = price ? '' : /roll/.test(reason) || key === 'leanhogs'
      ? 'No price line: the price series still jumps where one contract rolls to the next, so it is left out.'
      : rows.some(function (r) { return r.raw !== null; })
        ? 'No price line: some weeks have no futures close, so it is left out rather than half drawn.'
        : 'No price line: our futures feed does not carry this contract.';
    var rel = cxA && cxA.release_date ? cxA.release_date : null;
    var src = 'CFTC Commitments of Traders, managed money, futures only, as of ' + md(last.date) + (rel ? ', released ' + md(rel) : '') + '.'
      + (price ? ' Price: front-month futures close each report Tuesday (Yahoo Finance), adjusted for contract rolls.' : '');
    var h = aligned && G.brief(key, cot, cx), an = aligned && G.answer(key, cot, cx);
    return { key: key, name: CHIP[key] || key, rows: rows, last: last, hi: hi, lo: lo, price: price, priceWhy: priceWhy,
      headline: h ? h.text : null, headlineHtml: h ? h.html : null, aligned: aligned, answer: an ? an.did : null,
      asOf: 'Positions as of ' + mdy(last.date) + (rel ? ', released ' + md(rel) : ''), src: src };
  }

  function niceStep(span, n) {
    var raw = span / Math.max(n, 1), p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }

  /* ---------------------------------------------------------------- the layout
     m: model(); w, h: the box in px; o: {fs: base font px, big: true for the saved image}.
     -> {w, h, items:[...]} where each item is one of
        {t:'line', pts:[[x,y]...], ink, width, dash}   {t:'area', pts, base, ink}
        {t:'dot', x, y, r, ink, ring}                    {t:'text', x, y, s, ink, size, weight, align, base}
     ink names: net, netFill, price, grid, zero, axis, text, muted, surface. Painters map them to colours. */
  function layout(m, w, h, o) {
    if (m.cmp) return layoutCmp(m, w, h, o);
    o = o || {};
    var fs = o.fs || 12, items = [];
    var priceH = Math.round(h * 0.2), gap = Math.round(fs * 1.6), axisH = Math.round(fs * 1.9);
    var L = Math.round(fs * 3.9), R = Math.round(fs * 1.2), T = Math.round(fs * 1.6);
    var netB = h - axisH - priceH - gap;           /* bottom of the net panel */
    var nets = m.rows.map(function (r) { return r.net; });
    var lo = Math.min(0, Math.min.apply(null, nets)), hi = Math.max(0, Math.max.apply(null, nets));
    var step = niceStep(hi - lo || 1, 4);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    if (hi === lo) hi = lo + step;
    var n = m.rows.length;
    function X(i) { return L + (i / (n - 1)) * (w - L - R); }
    function Y(v) { return T + (1 - (v - lo) / (hi - lo)) * (netB - T); }
    /* gridlines and their labels */
    for (var v = lo; v <= hi + step / 2; v += step) {
      var y = Y(v);
      if (v !== 0) items.push({ t: 'line', pts: [[L, y], [w - R, y]], ink: 'grid', width: 1 });
      items.push({ t: 'text', x: L - 6, y: y, s: kTick(v), ink: 'muted', size: fs, align: 'right', base: 'middle' });
    }
    /* zero, plainly, with its two words */
    var y0 = Y(0), n0 = m.rows.length;
    items.push({ t: 'line', pts: [[L, y0], [w - R, y0]], ink: 'zero', width: 1.5 });
    /* the net: a faint fill to zero, then the 2px line */
    var pts = m.rows.map(function (r, i) { return [X(i), Y(r.net)]; });
    items.push({ t: 'area', pts: pts, base: y0, ink: 'netFill' });
    items.push({ t: 'line', pts: pts, ink: 'net', width: o.big ? 3.5 : 2.25 });
    /* labels, most important first; each later one keeps clear of the boxes already placed */
    var boxes = [];
    function box(x, y, s, size, al, base) {
      var bw = s.length * size * 0.58, bh = size * 1.25;
      var x0 = al === 'right' ? x - bw : al === 'center' ? x - bw / 2 : x;
      var y0b = base === 'top' ? y : base === 'middle' ? y - bh / 2 : y - bh;
      return [x0, y0b, x0 + bw, y0b + bh];
    }
    function hits(b) { return boxes.some(function (o) { return b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]; }); }
    function label(it) { items.push(it); boxes.push(box(it.x, it.y, it.s, it.size, it.align, it.base)); }
    var off = o.big ? 16 : 10, mo = o.big ? 13 : 8;
    var li = n - 1, hiI = m.rows.indexOf(m.hi), loI = m.rows.indexOf(m.lo);
    /* this week: the dot and its number */
    var lx = X(li), ly = Y(m.last.net), lfs = Math.round(fs * 1.12);
    var lab = netWords(m.last.net) + (li === hiI ? ', 52-wk high' : li === loI ? ', 52-wk low' : '');
    var below = ly - T < fs * 2.6 || (li === loI && netB - ly > fs * 2.6);
    /* not over the high or low marker: try the other side first */
    var marks = [hiI, loI].filter(function (i) { return i !== li; }).map(function (i) { return [X(i), Y(m.rows[i].net)]; });
    function covers(b) { return marks.some(function (p) { return p[0] > b[0] - 6 && p[0] < b[2] + 6 && p[1] > b[1] - 6 && p[1] < b[3] + 6; }); }
    if (covers(box(lx, below ? ly + off : ly - off, lab, lfs, 'right', below ? 'top' : 'bottom'))) {
      var alt = !below, ay = alt ? ly + off : ly - off, ab = box(lx, ay, lab, lfs, 'right', alt ? 'top' : 'bottom');
      if (!covers(ab) && ab[1] >= T - 2 && ab[3] <= netB + 2) below = alt;
    }
    items.push({ t: 'dot', x: lx, y: ly, r: o.big ? 8 : 5.5, ink: 'net', ring: 'surface' });
    label({ t: 'text', x: lx, y: below ? ly + off : ly - off, s: lab, ink: 'text', size: lfs, weight: 800, align: 'right', base: below ? 'top' : 'bottom' });
    /* the 52-week high and low (when this week is one of them, its own label says so) */
    function mark(i, word, up) {
      var x = X(i), y = Y(m.rows[i].net), s = word + ' ' + kTick(m.rows[i].net);
      items.push({ t: 'dot', x: x, y: y, r: o.big ? 6 : 4, ink: 'surface', ring: 'net' });
      var al = x < L + 70 ? 'left' : x > w - R - 70 ? 'right' : 'center';
      var it = { t: 'text', x: x, y: up ? y - mo : y + mo, s: s, ink: 'muted', size: fs, weight: 600, align: al, base: up ? 'bottom' : 'top' };
      if (hits(box(it.x, it.y, s, fs, al, it.base))) { it.y = up ? y + mo : y - mo; it.base = up ? 'top' : 'bottom'; }
      label(it);
    }
    if (hiI !== li) mark(hiI, '52-wk high', true);
    if (loI !== li && loI !== hiI) mark(loI, '52-wk low', false);
    /* "Funds long" just above zero and "Funds short" just below, where the line and the labels leave room;
       without room in the plot, short words in the gutter beside the zero */
    function room(up) {
      var s = up ? 'Funds long ↑' : 'Funds short ↓', band = fs * 1.9;
      for (var x0 = L + 6; x0 + s.length * fs * 0.58 < w - R; x0 += fs) {
        var bx = box(x0, up ? y0 - 5 : y0 + 5, s, fs, 'left', up ? 'bottom' : 'top'), clear = !hits(bx);
        for (var i = 0; i < n0 && clear; i++) {
          var x = X(i);
          if (x < bx[0] - fs || x > bx[2] + fs) continue;
          var y = Y(m.rows[i].net);
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
    if (xu === null && y0 - T > fs * 1.8) items.push({ t: 'text', x: L - 6, y: y0 - fs * 1.15, s: 'long ↑', ink: 'muted', size: fs, weight: 600, align: 'right', base: 'middle' });
    if (xd === null && netB - y0 > fs * 1.8) items.push({ t: 'text', x: L - 6, y: y0 + fs * 1.15, s: 'short ↓', ink: 'muted', size: fs, weight: 600, align: 'right', base: 'middle' });
    /* the x axis: the first report of each quarter month, the first and last labelled with the year */
    var ax = h - axisH + fs * 0.3, prevM = -1, used = [], gapX = fs * 5.2;
    m.rows.forEach(function (r, i) {
      var d = dt(r.date), mo = d.getMonth();
      if (mo !== prevM && (mo % 3 === 0) && X(i) - X(0) > gapX && X(n - 1) - X(i) > gapX) {
        var s = MON[mo] + (mo === 0 ? " '" + String(d.getFullYear()).slice(2) : '');
        used.push(i); items.push({ t: 'text', x: X(i), y: ax, s: s, ink: 'muted', size: fs, align: 'center', base: 'top' });
      }
      prevM = mo;
    });
    var f = dt(m.rows[0].date), l = dt(m.last.date);
    items.push({ t: 'text', x: X(0), y: ax, s: MON[f.getMonth()] + " '" + String(f.getFullYear()).slice(2), ink: 'muted', size: fs, align: 'left', base: 'top' });
    items.push({ t: 'text', x: X(li), y: ax, s: md(m.last.date), ink: 'muted', size: fs, align: 'right', base: 'top' });
    /* the price strip: its own panel, same weeks, no second scale on the net */
    var pT = netB + gap, pB = pT + priceH - 4;
    items.push({ t: 'line', pts: [[L, pT - gap / 2], [w - R, pT - gap / 2]], ink: 'grid', width: 1 });
    if (m.price) {
      var ps = m.rows.map(function (r) { return r.price; });
      var pl = Math.min.apply(null, ps), ph = Math.max.apply(null, ps), pp = (ph - pl) * 0.08 || 1;
      pl -= pp; ph += pp;
      var ppts = m.rows.map(function (r, i) { return [X(i), pB - ((r.price - pl) / (ph - pl)) * (pB - pT - fs)]; });
      items.push({ t: 'line', pts: ppts, ink: 'price', width: o.big ? 2.5 : 1.5 });
      items.push({ t: 'dot', x: ppts[li][0], y: ppts[li][1], r: o.big ? 5 : 3.5, ink: 'price', ring: 'surface' });
      items.push({ t: 'text', x: L - 6, y: pT + (pB - pT) / 2, s: 'Price', ink: 'muted', size: fs, weight: 600, align: 'right', base: 'middle' });
      items.push({ t: 'text', x: w - R, y: pT - 2, s: px(m.key, m.last.raw), ink: 'muted', size: fs, weight: 600, align: 'right', base: 'top' });
    } else {
      items.push({ t: 'text', x: L, y: pT + (pB - pT) / 2, s: m.priceWhy, ink: 'muted', size: fs, align: 'left', base: 'middle', wrap: w - L - R });
    }
    return { w: w, h: h, items: items, X: X, Y: Y, L: L, R: R, T: T, netB: netB, pT: pT, pB: pB };
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
      asOf: 'Positions as of ' + mdy(last) + (rel ? ', released ' + md(rel) : ''),
      src: 'CFTC Commitments of Traders, managed money, as of ' + md(last) + (rel ? ', released ' + md(rel) : '') + '.' };
  }
  function layoutCmp(m, w, h, o) {
    o = o || {};
    var fs = o.fs || 12, items = [], axisH = Math.round(fs * 1.9);
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
    /* the x axis, as on the single chart */
    var ax = h - axisH + fs * 0.3, prevM = -1, gapX = fs * 5.2;
    m.dates.forEach(function (ds, i) {
      var d = dt(ds), mo = d.getMonth();
      if (mo !== prevM && mo % 3 === 0 && X(i) - X(0) > gapX && X(n - 1) - X(i) > gapX)
        items.push({ t: 'text', x: X(i), y: ax, s: MON[mo] + (mo === 0 ? " '" + String(d.getFullYear()).slice(2) : ''), ink: 'muted', size: fs, align: 'center', base: 'top' });
      prevM = mo;
    });
    var f = dt(m.dates[0]);
    items.push({ t: 'text', x: X(0), y: ax, s: MON[f.getMonth()] + " '" + String(f.getFullYear()).slice(2), ink: 'muted', size: fs, align: 'left', base: 'top' });
    items.push({ t: 'text', x: X(n - 1), y: ax, s: md(m.last.date), ink: 'muted', size: fs, align: 'right', base: 'top' });
    return { w: w, h: h, items: items, X: X, Y: Y, L: L, R: R, T: T, netB: B, pB: B, cmp: true };
  }

  /* ---------------------------------------------------------------- painters */
  var SVG_INK = { net: 'var(--chart-1)', netFill: 'var(--chart-1)', price: 'var(--chart-2)', grid: 'var(--chart-grid)',
    zero: 'var(--text-muted)', axis: 'var(--chart-text)', text: 'var(--text)', muted: 'var(--text-muted)', surface: 'var(--surface)',
    c0: 'var(--cmp-1)', c1: 'var(--cmp-2)', c2: 'var(--cmp-3)' };
  var ANCHOR = { left: 'start', center: 'middle', right: 'end' };
  var BASE = { top: 'hanging', middle: 'central', bottom: 'auto' };
  function path(pts) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(''); }
  function toSvg(g) {
    var s = '';
    g.items.forEach(function (it) {
      if (it.t === 'line') s += '<path d="' + path(it.pts) + '" fill="none" stroke="' + SVG_INK[it.ink] + '" stroke-width="' + it.width + '" stroke-linejoin="round" stroke-linecap="round"/>';
      else if (it.t === 'area') s += '<path d="' + path(it.pts) + 'L' + it.pts[it.pts.length - 1][0].toFixed(1) + ' ' + it.base.toFixed(1) + 'L' + it.pts[0][0].toFixed(1) + ' ' + it.base.toFixed(1) + 'Z" fill="' + SVG_INK[it.ink] + '" fill-opacity=".13" stroke="none"/>';
      else if (it.t === 'dot') s += '<circle cx="' + it.x.toFixed(1) + '" cy="' + it.y.toFixed(1) + '" r="' + it.r + '" fill="' + SVG_INK[it.ink] + '" stroke="' + SVG_INK[it.ring] + '" stroke-width="2"/>';
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
  var PNG_INK = { net: '#d4a23f', netFill: 'rgba(212,162,63,.16)', price: '#8fa6b2', grid: 'rgba(132,160,168,.18)', zero: 'rgba(233,237,235,.62)',
    axis: 'rgba(233,237,235,.72)', text: '#e9edeb', muted: 'rgba(233,237,235,.74)', surface: '#101415',
    c0: '#d4a23f', c1: '#62aee0', c2: '#e07a9a' };
  var FONT = "Inter, 'Inter Fallback', system-ui, sans-serif";
  function paint(ctx, g, ox, oy) {
    ctx.save(); ctx.translate(ox, oy);
    g.items.forEach(function (it) {
      if (it.t === 'line' || it.t === 'area') {
        ctx.beginPath();
        it.pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
        if (it.t === 'area') {
          ctx.lineTo(it.pts[it.pts.length - 1][0], it.base); ctx.lineTo(it.pts[0][0], it.base); ctx.closePath();
          ctx.fillStyle = PNG_INK[it.ink]; ctx.fill();
        } else { ctx.strokeStyle = PNG_INK[it.ink]; ctx.lineWidth = it.width; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); }
      } else if (it.t === 'dot') {
        ctx.beginPath(); ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2); ctx.fillStyle = PNG_INK[it.ink]; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = PNG_INK[it.ring]; ctx.stroke();
      } else if (it.t === 'text') {
        ctx.fillStyle = PNG_INK[it.ink]; ctx.font = (it.weight || 400) + ' ' + it.size + 'px ' + FONT;
        ctx.textAlign = it.align || 'left'; ctx.textBaseline = it.base === 'top' ? 'top' : it.base === 'middle' ? 'middle' : 'alphabetic';
        var ty = it.base === 'bottom' || !it.base ? it.y - 2 : it.y;
        var ls = it.wrap ? wrapLines(ctx, it.s, it.wrap) : [it.s];
        ls.forEach(function (t, i) {
          var yy = ty + (i - (ls.length - 1) / 2) * it.size * 1.3;
          ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.strokeStyle = PNG_INK.surface; ctx.strokeText(t, it.x, yy);
          ctx.fillText(t, it.x, yy);
        });
      }
    });
    ctx.restore();
  }
  /* wrap text to a width with the canvas's own measure */
  function wrapLines(ctx, s, max) {
    var out = [], cur = '';
    String(s).split(' ').forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > max && cur) { out.push(cur); cur = w; } else cur = t; });
    if (cur) out.push(cur);
    return out;
  }
  /* The saved picture. o.phone: 1080x1350 (4:5, the default on a phone): headline 60 px, every other word 26 px
     or more, so it reads at 390 px wide; else 1200x675 (desktop). Both: agsist.com/cot, the headline, the answer
     line, the chart (with the price strip when the market has one), the report date and the source.
     -> {canvas, texts, sizes} (texts and their font sizes, every string drawn, for the tests) */
  function image(m, doc, o) {
    o = o || {};
    var ph = !!o.phone, W = ph ? 1080 : 1200, H = ph ? 1350 : 675, P = ph ? 60 : 56;
    var c = (doc || document).createElement('canvas'); c.width = W; c.height = H;
    var ctx = c.getContext('2d'), texts = [], sizes = [];
    function text(s, x, y, size, weight, ink, al) { ctx.font = weight + ' ' + size + 'px ' + FONT; ctx.fillStyle = ink; ctx.textAlign = al || 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(s, x, y); texts.push(s); sizes.push(size); }
    function wrapped(s, size, weight, max) { ctx.font = weight + ' ' + size + 'px ' + FONT; return wrapLines(ctx, s, W - 2 * P).slice(0, max); }
    ctx.fillStyle = '#0a0c0d'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#d4a23f'; ctx.fillRect(0, 0, W, ph ? 12 : 8);
    var head = m.cmp ? m.headline : m.headline || ('Managed money in ' + m.name.toLowerCase() + ': ' + netWords(m.last.net) + ' contracts.');
    var sub = m.cmp ? m.axis : 'Managed money net position, ' + m.name.toLowerCase() + ', last 52 weeks (contracts)';
    var src = 'Source: ' + m.src, y, g, gh;
    if (ph) {
      text('agsist.com/cot', P, 84, 40, 800, '#d4a23f');
      text(m.asOf + '.', P, 132, 28, 600, 'rgba(233,237,235,.86)');
      y = 210;
      wrapped(head, 60, 800, 3).forEach(function (s) { text(s, P, y, 60, 800, '#e9edeb'); y += 72; });
      y += 4;
      if (m.answer) { wrapped(m.answer, 30, 500, 6).forEach(function (s) { text(s, P, y, 30, 500, '#e9edeb'); y += 41; }); y += 8; }
      wrapped(sub, 26, 600, 3).forEach(function (s) { text(s, P, y, 26, 600, 'rgba(233,237,235,.80)'); y += 34; });
      var srcL = wrapped(src, 26, 400, 4), foot = H - 40 - (srcL.length - 1) * 34;
      gh = foot - 50 - y;
      g = layout(m, W - 2 * P, gh, { fs: 26, big: true });
      paint(ctx, g, P, y + 6);
      srcL.forEach(function (s, i) { text(s, P, foot + i * 34, 26, 400, 'rgba(233,237,235,.80)'); });
    } else {
      text('agsist.com/cot', P, 62, 26, 800, '#d4a23f');
      text(m.asOf, W - P, 62, 22, 600, 'rgba(233,237,235,.80)', 'right');
      var hl = wrapped(head, 38, 800, 2);
      hl.forEach(function (s, i) { text(s, P, 122 + i * 48, 38, 800, '#e9edeb'); });
      var top = 122 + (hl.length - 1) * 48 + 30;
      text(sub, P, top + 4, 20, 600, 'rgba(233,237,235,.74)');
      gh = H - top - 96; g = layout(m, W - 2 * P, gh, { fs: 19, big: true });
      paint(ctx, g, P, top + 18);
      wrapped(src, 17, 400, 2).forEach(function (s, i) { text(s, P, H - 46 + i * 22, 17, 400, 'rgba(233,237,235,.70)'); });
    }
    g.items.forEach(function (it) { if (it.t === 'text') { texts.push(it.s); sizes.push(it.size); } });
    return { canvas: c, texts: texts, sizes: sizes };
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
    var b = plotEl.getBoundingClientRect(), x = (clientX - b.left) * (geo.w / (b.width || geo.w));
    return Math.round(((x - geo.L) / (geo.w - geo.L - geo.R)) * (M.rows.length - 1));
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

  /* share the link: the phone's share sheet, else copy */
  function note(s) { var n = $('cc-note'); if (n) { n.textContent = s; clearTimeout(note.t); note.t = setTimeout(function () { n.textContent = ''; }, 4000); } }
  var coarse = function () { try { return root.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } };
  /* the 4:5 phone picture on a phone (a touch screen or a narrow window), the wide one on a desktop */
  var phone = function () { return coarse() || (root.innerWidth || 1200) < 700; };
  $('cc-share').addEventListener('click', function () {
    var url = api.shareUrl(), title = (M && M.cmp ? M.headline : 'Funds in ' + (CHIP[cur] || '').toLowerCase() + ', 52 weeks') + ' | AGSIST';
    var text = M && M.headline ? M.headline : title;
    gtag('cot_chart_share', { market: slugs(), how: root.navigator.share && coarse() ? 'sheet' : 'copy' });
    if (root.navigator.share && coarse()) {
      root.navigator.share({ title: title, text: text, url: url }).catch(function () {});
      return;
    }
    copy(url);
  });
  function copy(url) {
    function fallback() {
      var i = doc.createElement('input'); i.value = url; i.setAttribute('readonly', ''); i.style.position = 'fixed'; i.style.opacity = '0';
      doc.body.appendChild(i); i.select();
      var ok = false; try { ok = doc.execCommand('copy'); } catch (e) {}
      doc.body.removeChild(i);
      note(ok ? 'Link copied' : 'Copy this link: ' + url);
    }
    if (root.navigator.clipboard && root.navigator.clipboard.writeText) root.navigator.clipboard.writeText(url).then(function () { note('Link copied'); }, fallback);
    else fallback();
  }
  /* save the picture: share it as a file on a phone that can, else download it */
  $('cc-save').addEventListener('click', function () {
    if (!M) { note('The chart has not loaded, so there is no image to save yet.'); return; }
    var ready = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
    ready.then(function () {
      var im = image(M, doc, { phone: phone() });
      api.lastImage = { w: im.canvas.width, h: im.canvas.height, texts: im.texts, sizes: im.sizes };
      var name = 'agsist-cot-' + slugs().replace(/,/g, '-') + '-' + M.last.date + '.png';
      im.canvas.toBlob(function (blob) {
        if (!blob) { note('Could not draw the image here.'); return; }
        var file = null; try { file = new File([blob], name, { type: 'image/png' }); } catch (e) {}
        gtag('cot_chart_image', { market: slugs() });
        if (file && coarse() && root.navigator.canShare && root.navigator.canShare({ files: [file] })) {
          root.navigator.share({ files: [file], title: M.cmp ? M.headline : 'Funds in ' + CHIP[cur].toLowerCase(), text: (M.headline || '') + ' ' + api.shareUrl() }).catch(function () {});
          return;
        }
        var a = doc.createElement('a'), u = URL.createObjectURL(blob);
        a.href = u; a.download = name; doc.body.appendChild(a); a.click(); doc.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
        note('Image saved');
      }, 'image/png');
    });
  });

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
