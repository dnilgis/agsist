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

   The title is the market's at-a-glance line without the bracketed percentile (AgCotGlance.headline), shown only
   when the chart's last week is the report on the page and carries the same net; the source line names the
   CFTC report, the Tuesday and the release day (the release day only when the analysis is for the same week).

   One layout feeds two painters: the inline SVG on the page and a 1200x675 canvas for "Save image", so the
   saved picture is the chart on screen. "Share this chart" uses the phone's share sheet, or copies the link.
   cot-page.js hands this file the data it already fetched (AgCotChart.update); nothing here fetches.
   Exports window.AgCotChart (and module.exports for the tests: model, layout, fmt helpers). */
(function (root) {
  'use strict';
  var G = root.AgCotGlance || (typeof require === 'function' ? require('./cot-glance.js') : null);
  var ORDER = G.ORDER;
  var CHIP = { corn: 'Corn', beans: 'Soybeans', wheat: 'Chicago wheat', kcwheat: 'KC wheat', mplswheat: 'Mpls wheat',
    soymeal: 'Soybean meal', soyoil: 'Soybean oil', livecattle: 'Live cattle', feedercattle: 'Feeder cattle',
    leanhogs: 'Lean hogs', milk: 'Class III milk' };
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
    var why = cxc && cxc.price_withheld_reason ? 'withheld' : null;
    var every = rows.every(function (r) { return r.raw !== null && r.adj !== null; });
    var price = !why && every && last.adj > 0;
    if (price) {
      var k = last.raw / last.adj;   /* the repaired index scaled so its last point is the last close */
      rows.forEach(function (r) { r.price = Math.round(r.adj * k * 100) / 100; });
    }
    var priceWhy = price ? '' : (key === 'leanhogs' || why
      ? 'No price line: the price series still jumps where one contract rolls to the next, so it is left out.'
      : 'No price line: our futures feed does not carry this contract every week.');
    var rel = cxA && cxA.release_date ? cxA.release_date : null;
    var src = 'CFTC Commitments of Traders, managed money, futures only, as of ' + md(last.date) + (rel ? ', released ' + md(rel) : '') + '.'
      + (price ? ' Price: front-month futures close each report Tuesday (Yahoo Finance), adjusted for contract rolls.' : '');
    var h = aligned && G.headline(key, cot, cx);
    return { key: key, name: CHIP[key] || key, rows: rows, last: last, hi: hi, lo: lo, price: price, priceWhy: priceWhy,
      headline: h ? h.text : null, headlineHtml: h ? h.html : null, aligned: aligned,
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
    o = o || {};
    var fs = o.fs || 12, items = [];
    var priceH = Math.round(h * 0.2), gap = Math.round(fs * 1.6), axisH = Math.round(fs * 1.9);
    var L = Math.round(fs * 3.4), R = Math.round(fs * 1.2), T = Math.round(fs * 1.6);
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
    /* "Funds long" just above zero and "Funds short" just below, each where the line leaves room for it */
    function room(up) {
      var lw = fs * 7.5, band = fs * 1.9;
      for (var x0 = L + 6; x0 + lw < w - R - fs * 8; x0 += fs) {
        var clear = true;
        for (var i = 0; i < n0 && clear; i++) {
          var x = L + (i / (n0 - 1)) * (w - L - R);
          if (x < x0 - fs || x > x0 + lw + fs) continue;
          var y = Y(m.rows[i].net);
          if (up ? (y > y0 - band - 4 && y < y0 + 2) : (y < y0 + band + 4 && y > y0 - 2)) clear = false;
        }
        if (clear) return x0;
      }
      return null;
    }
    var xu = y0 - T > fs * 1.8 ? room(true) : null, xd = netB - y0 > fs * 1.8 ? room(false) : null;
    if (xu !== null) items.push({ t: 'text', x: xu, y: y0 - 5, s: 'Funds long ↑', ink: 'muted', size: fs, weight: 600, align: 'left', base: 'bottom' });
    if (xd !== null) items.push({ t: 'text', x: xd, y: y0 + 5, s: 'Funds short ↓', ink: 'muted', size: fs, weight: 600, align: 'left', base: 'top' });
    /* the net: a faint fill to zero, then the 2px line */
    var pts = m.rows.map(function (r, i) { return [X(i), Y(r.net)]; });
    items.push({ t: 'area', pts: pts, base: y0, ink: 'netFill' });
    items.push({ t: 'line', pts: pts, ink: 'net', width: o.big ? 3.5 : 2.25 });
    /* high and low (when this week is one of them, it says so in its own label) */
    var li = n - 1, hiI = m.rows.indexOf(m.hi), loI = m.rows.indexOf(m.lo);
    function mark(i, word, up) {
      var x = X(i), y = Y(m.rows[i].net);
      items.push({ t: 'dot', x: x, y: y, r: o.big ? 6 : 4, ink: 'surface', ring: 'net' });
      var al = x < L + 70 ? 'left' : x > w - R - 70 ? 'right' : 'center';
      items.push({ t: 'text', x: x, y: up ? y - 8 : y + 8, s: word + ' ' + kTick(m.rows[i].net), ink: 'muted', size: fs, weight: 600, align: al, base: up ? 'bottom' : 'top' });
    }
    if (hiI !== li) mark(hiI, '52-wk high', true);
    if (loI !== li && loI !== hiI) mark(loI, '52-wk low', false);
    /* this week: the dot and its number */
    var lx = X(li), ly = Y(m.last.net);
    var lab = netWords(m.last.net) + (li === hiI ? ', 52-wk high' : li === loI ? ', 52-wk low' : '');
    var below = ly - T < fs * 2.6 || (li === loI && netB - ly > fs * 2.6);
    items.push({ t: 'dot', x: lx, y: ly, r: o.big ? 8 : 5.5, ink: 'net', ring: 'surface' });
    items.push({ t: 'text', x: lx, y: below ? ly + 10 : ly - 10, s: lab, ink: 'text', size: Math.round(fs * 1.12), weight: 800, align: 'right', base: below ? 'top' : 'bottom' });
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

  /* ---------------------------------------------------------------- painters */
  var SVG_INK = { net: 'var(--chart-1)', netFill: 'var(--chart-1)', price: 'var(--chart-2)', grid: 'var(--chart-grid)',
    zero: 'var(--text-muted)', axis: 'var(--chart-text)', text: 'var(--text)', muted: 'var(--text-muted)', surface: 'var(--surface)' };
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
    axis: 'rgba(233,237,235,.72)', text: '#e9edeb', muted: 'rgba(233,237,235,.74)', surface: '#101415' };
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
        ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.strokeStyle = PNG_INK.surface; ctx.strokeText(it.s, it.x, ty, it.wrap || undefined);
        ctx.fillText(it.s, it.x, ty, it.wrap || undefined);
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
  /* The 1200x675 picture: headline, chart, source and dates, agsist.com/cot.
     -> {canvas, texts} (texts: every string drawn, for the tests) */
  function image(m, doc) {
    var W = 1200, H = 675, P = 56;
    var c = (doc || document).createElement('canvas'); c.width = W; c.height = H;
    var ctx = c.getContext('2d'), texts = [];
    function text(s, x, y, font, ink, al) { ctx.font = font; ctx.fillStyle = ink; ctx.textAlign = al || 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(s, x, y); texts.push(s); }
    ctx.fillStyle = '#0a0c0d'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#d4a23f'; ctx.fillRect(0, 0, W, 8);
    text('agsist.com/cot', P, 62, '800 26px ' + FONT, '#d4a23f');
    text(m.asOf, W - P, 62, '600 22px ' + FONT, 'rgba(233,237,235,.80)', 'right');
    var head = m.headline || ('Managed money in ' + m.name.toLowerCase() + ': ' + netWords(m.last.net) + ' contracts.');
    ctx.font = '800 38px ' + FONT;
    var hl = wrapLines(ctx, head, W - 2 * P).slice(0, 2);
    hl.forEach(function (s, i) { text(s, P, 122 + i * 48, '800 38px ' + FONT, '#e9edeb'); });
    var top = 122 + (hl.length - 1) * 48 + 30;
    text('Managed money net position, ' + m.name.toLowerCase() + ', last 52 weeks (contracts)', P, top + 4, '600 20px ' + FONT, 'rgba(233,237,235,.74)');
    var gh = H - top - 96, g = layout(m, W - 2 * P, gh, { fs: 19, big: true });
    paint(ctx, g, P, top + 18);
    g.items.forEach(function (it) { if (it.t === 'text') texts.push(it.s); });
    ctx.font = '400 17px ' + FONT;
    var src = wrapLines(ctx, 'Source: ' + m.src, W - 2 * P).slice(0, 2);
    src.forEach(function (s, i) { text(s, P, H - 46 + i * 22, '400 17px ' + FONT, 'rgba(233,237,235,.70)'); });
    return { canvas: c, texts: texts };
  }

  /* ---------------------------------------------------------------- the page */
  var api = { model: model, layout: layout, toSvg: toSvg, image: image, netWords: netWords, kTick: kTick, px: px, CHIP: CHIP };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgCotChart = api;
  var doc = root.document, box = doc && doc.getElementById('cot-chart-box');
  if (!box) return;
  var D = { cot: null, hist: null, cx: null }, cur = null, geo = null, M = null;
  function $(id) { return doc.getElementById(id); }
  function gtag(name, p) { try { if (typeof root.gtag === 'function') root.gtag('event', name, p); } catch (e) {} }

  (function initKey() {
    var q = null; try { q = new URLSearchParams(root.location.search).get('m'); } catch (e) {}
    cur = G.keyOf(q) || 'corn';
  })();
  /* the chips */
  var chips = $('cc-chips');
  chips.innerHTML = ORDER.map(function (k) {
    return '<button type="button" class="cc-chip" data-k="' + k + '" aria-pressed="' + (k === cur) + '">' + esc(CHIP[k]) + '</button>';
  }).join('');
  chips.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.cc-chip') : null;
    if (b) { select(b.getAttribute('data-k'), true); gtag('cot_chart_market', { market: G.SLUG[cur] }); }
  });
  function markChips() {
    Array.prototype.forEach.call(chips.querySelectorAll('.cc-chip'), function (b) {
      var on = b.getAttribute('data-k') === cur;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on && b.scrollIntoView && chips.scrollWidth > chips.clientWidth) {
        var l = b.offsetLeft - chips.offsetLeft, r = l + b.offsetWidth;
        if (l < chips.scrollLeft || r > chips.scrollLeft + chips.clientWidth) chips.scrollLeft = Math.max(0, l - 16);
      }
    });
  }
  function select(k, push) {
    if (!G.SLUG[k]) return;
    cur = k; markChips(); draw();
    if (push) {
      try {
        var u = new URL(root.location.href);
        u.searchParams.set('m', G.SLUG[k]);
        root.history.replaceState(root.history.state, '', u.pathname + u.search + u.hash);
      } catch (e) {}
    }
  }
  api.select = select;
  api.current = function () { return cur; };
  api.shareUrl = function () { return SITE + G.href(cur); };

  function draw() {
    var plot = $('cc-plot'), svg = $('cc-svg'), msg = $('cc-msg');
    if (!D.hist) return;
    M = model(cur, D.hist, D.cot, D.cx);
    $('cc-head').innerHTML = M && M.headlineHtml ? M.headlineHtml : esc(CHIP[cur]) + ': managed money net position';
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
  function hide() { at = -1; if (tip) tip.hidden = true; var r = $('cc-rule'), h = $('cc-hot'); if (r) r.setAttribute('visibility', 'hidden'); if (h) h.setAttribute('visibility', 'hidden'); }
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
  $('cc-share').addEventListener('click', function () {
    var url = api.shareUrl(), title = 'Funds in ' + (CHIP[cur] || '').toLowerCase() + ', 52 weeks | AGSIST';
    var text = M && M.headline ? M.headline : title;
    gtag('cot_chart_share', { market: G.SLUG[cur], how: root.navigator.share && coarse() ? 'sheet' : 'copy' });
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
    if (!M) return;
    var ready = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
    ready.then(function () {
      var im = image(M, doc);
      api.lastImage = { w: im.canvas.width, h: im.canvas.height, texts: im.texts };
      var name = 'agsist-cot-' + G.SLUG[cur] + '-' + M.last.date + '.png';
      im.canvas.toBlob(function (blob) {
        if (!blob) { note('Could not draw the image here.'); return; }
        var file = null; try { file = new File([blob], name, { type: 'image/png' }); } catch (e) {}
        gtag('cot_chart_image', { market: G.SLUG[cur] });
        if (file && coarse() && root.navigator.canShare && root.navigator.canShare({ files: [file] })) {
          root.navigator.share({ files: [file], title: 'Funds in ' + CHIP[cur].toLowerCase(), text: (M.headline || '') + ' ' + api.shareUrl() }).catch(function () {});
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
  };
  var rz = 0;
  root.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(draw, 120); });
  markChips();
})(typeof window !== 'undefined' ? window : this);
