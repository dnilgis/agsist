/* components/infographic.js: the Friday Chart (subtitle "Infographic of the Week", Sig Nov 7), drawn from its spec (data/infographics/<date>.json,
   made by scripts/build_infographic.py from our own data files; the page carries the same spec inline as
   <script type="application/json" id="ig-spec">). Nov 7, 2026.

   Three shapes from one spec, on the share kit core (components/share-kit.js: the dark card, the pen, the QR code,
   the sheet, the print hook, sharing):
   - the phone picture, 1080 x 1350: the hook, the big number, the chart, the facts, the source and a QR code;
   - the link preview picture, 1200 x 630: the hook, the big number and the chart;
   - the one-page print sheet (Letter, fits A4), black on white, with a QR code back to the page;
   - the Friday Chart poster from spec.poster (Nov 7): dark, 1080 x 2400, a canvas picture to save or share; and
     paper, an SVG print sheet on 11 x 17 (Letter as the fallback), each with a QR code (see "the poster" below).
   Chart types: bars (each row: this year's value as a bar, the 5-year average as a tick) and line (weekly points).
   Fails soft: without share-kit.js the buttons stay hidden (a spec without a poster block hides the poster buttons) and the page (its picture, chart and facts are plain
   HTML) is whole. Every number drawn comes from the spec; nothing is computed here but positions.
   Exports window.AgInfographic (and module.exports for the tests). */
(function (root) {
  'use strict';
  var PHONE = [1080, 1350], LINK = [1200, 630];
  var SITE = 'https://agsist.com';

  function SK() { return root.AgShareKit || (typeof require === 'function' ? require('./share-kit.js') : null); }
  function fmt(n) { return Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function bigText(b) { return (b.value < 0 ? '\u2212' : '') + fmt(b.value); }
  function unitText(b) { return b.unit === '%' ? '%' : ' ' + b.unit; }
  function pageUrl(spec) { return SITE + '/infographic/' + spec.date; }
  function shown(spec) { return 'agsist.com/infographic/' + spec.date; }
  function campaign(spec) { return 'infographic-' + spec.date; }
  function tagged(spec, src, med) { var K = SK(); return pageUrl(spec) + '?' + K.tags(src, med, campaign(spec)); }
  function srcLine(spec) {
    return 'Source: ' + (spec.sources || []).map(function (s) { return s.name + ' (' + s.period + ')'; }).join('; ') + '. Facts only, not advice.';
  }

  /* ---------------------------------------------------------------- the chart on a canvas */
  /* bars: rows [{label, values [now, avg]}]; a bar for now, a tick for the average; highlighted rows in gold */
  function paintBars(ctx, p, spec, panel, x, y, w, h, o) {
    var K = SK(), rows = panel.rows.slice(0, o.maxRows || panel.rows.length), hi = {};
    (spec.chart.highlight || []).forEach(function (k) { hi[k] = 1; });
    var rh = Math.min(o.rowMax || 46, Math.floor(h / Math.max(1, rows.length))), lw = o.labelW || 250, vw = o.valW || 170;
    var bx = x + lw, bw = w - lw - vw, fs = Math.max(20, Math.min(o.font || 26, rh - 12));
    rows.forEach(function (r, i) {
      var cy = y + i * rh, on = hi[r.key], v = r.values[0], a = r.values[1];
      p.text(r.label, x, cy + rh / 2 + fs * 0.36, fs, on ? 800 : 500, on ? K.GOLD : K.INK);
      ctx.fillStyle = 'rgba(233,237,235,.10)'; ctx.fillRect(bx, cy + rh * 0.2, bw, rh * 0.6);
      ctx.fillStyle = on ? K.GOLD : 'rgba(233,237,235,.62)'; ctx.fillRect(bx, cy + rh * 0.2, bw * Math.max(0, Math.min(100, v)) / 100, rh * 0.6);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(bx + bw * Math.max(0, Math.min(100, a)) / 100 - 2, cy + rh * 0.06, 4, rh * 0.88);
      p.text(v + ' vs ' + a, x + w, cy + rh / 2 + fs * 0.36, fs, on ? 800 : 600, on ? K.GOLD : K.INK, 'right');
    });
    return y + rows.length * rh;
  }
  /* line: points [{label, y}]; the first and the last labelled with their values */
  function paintLine(ctx, p, spec, x, y, w, h, o) {
    var K = SK(), pts = spec.chart.points, ys = pts.map(function (q) { return q.y; });
    var lo = Math.min.apply(null, ys.concat([0])), hi = Math.max.apply(null, ys.concat([0])), pad = (hi - lo) * 0.08 || 1;
    lo -= pad; hi += pad;
    var top = y + 50, bot = y + h - 40, fs = o.font || 24;
    var room = o.endRoom || 150;
    function px(i) { return x + 20 + (w - 40 - room) * (pts.length === 1 ? 0.5 : i / (pts.length - 1)); }
    function py(v) { return bot - (bot - top) * (v - lo) / (hi - lo); }
    var step = pts.length > 1 ? (w - 40 - room) / (pts.length - 1) : 1e9;
    ctx.strokeStyle = 'rgba(233,237,235,.35)'; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.moveTo(x, py(0)); ctx.lineTo(x + w, py(0)); ctx.stroke(); ctx.setLineDash([]);
    p.text('0', x, py(0) - 8, 20, 600, K.DIM);
    ctx.strokeStyle = K.GOLD; ctx.lineWidth = 6; ctx.beginPath();
    pts.forEach(function (q, i) { if (i) ctx.lineTo(px(i), py(q.y)); else ctx.moveTo(px(i), py(q.y)); }); ctx.stroke();
    pts.forEach(function (q, i) {
      ctx.fillStyle = K.GOLD; ctx.beginPath(); ctx.arc(px(i), py(q.y), 9, 0, Math.PI * 2); ctx.fill();
      /* every week's date when they fit, else the first and the last */
      if (step >= 96 || i === 0 || i === pts.length - 1) p.text(q.label, px(i), bot + 32, fs - 4, 500, K.DIM, 'center');
    });
    var f = pts[0], l = pts[pts.length - 1];
    p.text(fmt(f.y), px(0), py(f.y) - 22, fs + 4, 800, K.INK, 'left');
    p.text(fmt(l.y), px(pts.length - 1) + 18, py(l.y) + 9, fs + 4, 800, K.INK, 'left');
    return y + h;
  }

  /* the hook at the largest size (from sizes) that fits in maxLines; -> the last line's baseline */
  function hook(p, s, x, y, sizes, width, maxLines) {
    var sz = sizes[sizes.length - 1];
    for (var i = 0; i < sizes.length; i++) { p.font(sizes[i], 800); if (p.wrap(s, width).length <= maxLines) { sz = sizes[i]; break; } }
    var lh = Math.round(sz * 1.12);
    p.lines(s, x, y, sz, 800, SK().INK, lh, maxLines, width);
    p.font(sz, 800);
    return y + (Math.min(maxLines, p.wrap(s, width).length) - 1) * lh;
  }

  /* ---------------------------------------------------------------- the pictures
     shape 'phone' (1080 x 1350) or 'link' (1200 x 630). o.qr: the QR matrix (AgQR.matrix) or null.
     -> {canvas, texts, sizes, w, h} */
  function picture(spec, doc, shape, o) {
    o = o || {};
    var K = SK(), d = shape === 'link' ? LINK : PHONE, W = d[0], H = d[1], P = 60;
    var c = K.canvas(doc, W, H), ctx = c.getContext('2d'), p = K.pen(ctx);
    K.frame(ctx, W, H, 12);
    K.head(p, P, 'agsist.com', 'Friday Chart: Infographic of the Week, ' + K.mdy(spec.date));
    var b = spec.big, big = bigText(b), u = unitText(b), y;
    if (shape === 'link') {
      y = hook(p, spec.title, P, 200, [46, 42, 38, 34], 560, 3) + 22;
      var lp = b.unit === '%', lt = big + (lp ? '%' : ''), bs = p.fit(lt, 96, 48, 800, 560);
      p.text(lt, P, y + bs * 0.9, bs, 800, K.GOLD);
      p.lines((lp ? '' : b.unit.charAt(0).toUpperCase() + b.unit.slice(1) + '. ') + b.label, P, y + bs + 34, 24, 500, K.DIM, 30, 3, 560);
      var cx = 660, cw = W - cx - P;
      if (spec.chart.type === 'bars') {
        var pan = spec.chart.panels[0];
        p.text(pan.title.replace(/ by state, week ending.*$/, ', this year vs average'), cx, 196, 22, 600, K.DIM);
        paintBars(ctx, p, spec, pan, cx, 214, cw, H - 214 - 60, { maxRows: 8, labelW: 170, valW: 110, font: 24, rowMax: 44 });
      } else paintLine(ctx, p, spec, cx, 170, cw, H - 170 - 60, { font: 22, endRoom: 110 });
      p.text(srcLine(spec).replace(/ Facts only, not advice\.$/, ''), P, H - 26, p.fit(srcLine(spec), 20, 16, 400, W - 2 * P), 400, K.DIM);
      return { canvas: c, texts: p.texts, sizes: p.sizes, ys: p.ys, w: W, h: H };
    }
    y = hook(p, spec.title, P, 218, [62, 56, 50, 44], W - 2 * P, 3);
    /* the big number, its unit and label in a column at its right (under it when the number is wide) */
    var pct = b.unit === '%', bt = big + (pct ? '%' : ''), bsz = p.fit(bt, 120, 60, 800, W - 2 * P), bw;
    var base = y + 30 + Math.round(bsz * 0.8);
    p.text(bt, P, base, bsz, 800, K.GOLD);
    ctx.font = '800 ' + bsz + 'px ' + K.FONT; bw = ctx.measureText(bt).width;
    var side = (pct ? '' : b.unit.charAt(0).toUpperCase() + b.unit.slice(1) + '. ') + b.label, cx0 = P + bw + 36, cw0 = W - P - cx0;
    ctx.font = '500 28px ' + K.FONT;
    if (cw0 >= 360 && p.wrap(side, cw0).length <= 3) {
      var nl = p.wrap(side, cw0).length;
      p.lines(side, cx0, base - Math.round(bsz * 0.4) - (nl - 1) * 17 + 10, 28, 500, K.DIM, 34, 3, cw0);
      y = base + 26;
    } else y = p.lines(side, P, base + 44, 28, 500, K.DIM, 34, 2, W - 2 * P) - 8;
    /* the footer first (the QR code and the source), then the chart fills what is left above the facts */
    var m = o.qr, qn = m ? m.length + 8 : 0, mod = m ? Math.max(3, Math.floor(170 / qn)) : 0, qs = qn * mod;
    var LW = W - 2 * P - (m ? qs + 30 : 0);
    ctx.font = '400 20px ' + K.FONT;
    var sl = p.wrap(srcLine(spec), LW).slice(0, 4), footTop = H - 40 - Math.max(qs, sl.length * 26 + 70);
    var facts = (spec.facts || []).slice(0, 3), factH = 0;
    ctx.font = '500 26px ' + K.FONT;
    facts.forEach(function (f) { factH += Math.min(2, p.wrap(f.text, W - 2 * P - 30).length) * 32 + 12; });
    /* a line chart's date labels sit under its plot: 28 px more air between them and the first fact */
    var gap = spec.chart.type === 'line' ? 28 : 0, chartTop = y + 6, chartBot = footTop - factH - 30 - gap;
    p.text(spec.chart.type === 'bars' ? spec.chart.panels[0].title + ' (bar: ' + spec.chart.series[0] + ', tick: ' + spec.chart.series[1].toLowerCase() + ')' : spec.chart.title,
      P, chartTop + 26, p.fit(spec.chart.type === 'bars' ? spec.chart.panels[0].title + ' (bar: ' + spec.chart.series[0] + ', tick: ' + spec.chart.series[1].toLowerCase() + ')' : spec.chart.title, 26, 20, 600, W - 2 * P), 600, K.DIM);
    if (spec.chart.type === 'bars') paintBars(ctx, p, spec, spec.chart.panels[0], P, chartTop + 46, W - 2 * P, chartBot - chartTop - 46, { font: 26 });
    else paintLine(ctx, p, spec, P, chartTop + 30, W - 2 * P, chartBot - chartTop - 30, { font: 26 });
    var fy = chartBot + 34 + gap;
    facts.forEach(function (f) {
      ctx.fillStyle = K.GOLD; ctx.fillRect(P, fy - 20, 8, 22);
      fy = p.lines(f.text, P + 30, fy, 26, 500, K.INK, 32, 2, W - 2 * P - 30) + 12;
    });
    if (m) K.qr(ctx, m, W - P - qs, H - 40 - qs, mod);
    var ay = H - 40 - (sl.length - 1) * 26 - 34;
    p.text(shown(spec), P, ay, p.fit(shown(spec), 28, 20, 700, LW), 700, K.GOLD);
    sl.forEach(function (l, i) { p.text(l, P, H - 40 - (sl.length - 1 - i) * 26, 20, 400, K.DIM); });
    return { canvas: c, texts: p.texts, sizes: p.sizes, ys: p.ys, w: W, h: H };
  }

  /* ---------------------------------------------------------------- the print sheet */
  function esc(s) { return SK().esc(s); }
  function barsSvg(spec, panel) {
    var rows = panel.rows, hi = {}, rh = 18, lw = 96, vw = 62, w = 340, bw = w - lw - vw, h = rows.length * rh + 4, out = [];
    (spec.chart.highlight || []).forEach(function (k) { hi[k] = 1; });
    rows.forEach(function (r, i) {
      var y = i * rh + 2, on = hi[r.key], v = Math.max(0, Math.min(100, r.values[0])), a = Math.max(0, Math.min(100, r.values[1]));
      out.push('<text x="0" y="' + (y + 12) + '" font-size="11.5"' + (on ? ' font-weight="800"' : '') + '>' + esc(r.label) + '</text>'
        + '<rect x="' + lw + '" y="' + (y + 3) + '" width="' + bw + '" height="10" fill="#eee"/>'
        + '<rect x="' + lw + '" y="' + (y + 3) + '" width="' + (bw * v / 100).toFixed(1) + '" height="10" fill="' + (on ? '#8a6514' : '#555') + '"/>'
        + '<rect x="' + (lw + bw * a / 100 - 1).toFixed(1) + '" y="' + (y + 0.5) + '" width="2" height="15" fill="#000"/>'
        + '<text x="' + w + '" y="' + (y + 12) + '" font-size="11.5" text-anchor="end"' + (on ? ' font-weight="800"' : '') + '>' + r.values[0] + ' vs ' + r.values[1] + '</text>');
    });
    return '<svg class="igs-svg" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(panel.title) + '">' + out.join('') + '</svg>';
  }
  function lineSvg(spec) {
    var pts = spec.chart.points, w = 560, h = 230, ys = pts.map(function (q) { return q.y; });
    var lo = Math.min.apply(null, ys.concat([0])), hi = Math.max.apply(null, ys.concat([0])), pad = (hi - lo) * 0.1 || 1;
    lo -= pad; hi += pad;
    function px(i) { return 30 + (w - 60) * (pts.length === 1 ? 0.5 : i / (pts.length - 1)); }
    function py(v) { return 20 + (h - 50) * (1 - (v - lo) / (hi - lo)); }
    var d = pts.map(function (q, i) { return (i ? 'L' : 'M') + px(i).toFixed(1) + ' ' + py(q.y).toFixed(1); }).join(' ');
    var out = '<line x1="0" x2="' + w + '" y1="' + py(0).toFixed(1) + '" y2="' + py(0).toFixed(1) + '" stroke="#999" stroke-dasharray="4 4"/>'
      + '<path d="' + d + '" fill="none" stroke="#8a6514" stroke-width="3"/>';
    pts.forEach(function (q, i) {
      out += '<circle cx="' + px(i).toFixed(1) + '" cy="' + py(q.y).toFixed(1) + '" r="4" fill="#000"/>'
        + '<text x="' + px(i).toFixed(1) + '" y="' + (h - 8) + '" font-size="10" text-anchor="middle">' + esc(q.label) + '</text>'
        + '<text x="' + px(i).toFixed(1) + '" y="' + (py(q.y) - 9).toFixed(1) + '" font-size="10" text-anchor="middle" font-weight="700">' + fmt(q.y) + '</text>';
    });
    return '<svg class="igs-svg" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(spec.chart.title) + '">' + out + '</svg>';
  }
  /* qr: an inline SVG (AgQR.svg) or '' */
  function sheetHtml(spec, qr) {
    var K = SK(), b = spec.big, ch = spec.chart, charts;
    if (ch.type === 'bars') charts = ch.panels.map(function (pn) { return '<figure class="igs-fig"><h3>' + esc(pn.title) + '</h3>' + barsSvg(spec, pn) + '</figure>'; }).join('');
    else charts = '<figure class="igs-fig"><h3>' + esc(ch.title) + '</h3>' + lineSvg(spec) + '</figure>';
    var key = ch.type === 'bars' ? '<p class="igs-key">Bar: ' + esc(ch.series[0]) + '. Black tick: ' + esc(ch.series[1].toLowerCase()) + '. Figures: percent harvested, this year vs average.</p>' : '';
    return '<div class="igs-bar"></div><div class="igs-top"><div><p class="igs-kick">AGSIST Friday Chart \u00b7 Infographic of the Week</p><h1 class="igs-h1">' + esc(spec.title) + '</h1>'
      + '<p class="igs-date">' + esc(K.mdy(spec.date)) + '</p></div><p class="igs-url">agsist.com</p></div>'
      + '<div class="igs-big"><b>' + esc(bigText(b)) + '<small>' + esc(unitText(b)) + '</small></b><span>' + esc(b.label) + '</span></div>'
      + '<div class="igs-charts">' + charts + '</div>' + key
      + '<ul class="igs-facts">' + (spec.facts || []).map(function (f) { return '<li>' + esc(f.text) + ' <span>' + esc(f.source) + '.</span></li>'; }).join('') + '</ul>'
      + '<div class="igs-foot"><div><p class="igs-src">' + esc(srcLine(spec)) + '</p><p class="igs-live">Live page: <b>' + esc(shown(spec)) + '</b></p></div>'
      + (qr ? '<div class="igs-qr">' + qr + '<p>Scan for the page</p></div>' : '') + '</div>';
  }

  /* ---------------------------------------------------------------- the poster (Friday Chart, Sig Nov 7)
     One layout, two looks: dark (the phone poster, 1080 x 2400, a canvas picture to save or share) and paper (the
     print poster, an SVG on an 11 x 17 sheet, Letter as the fallback). The layout is a list of drawing steps
     (rect, text, circle, arc, line, path, qr) painted on a canvas or written as SVG, so both looks match. Every
     number comes from spec.poster (scripts/build_infographic.py); nothing here but positions, colors and icons
     (our own shapes, no outside art). -> {W, H, ops, texts, boxes} */
  var SANS = "Inter, 'Inter Fallback', system-ui, sans-serif", SERIF = "Fraunces, Georgia, 'Times New Roman', serif";
  var THEMES = {
    dark: { bg: '#0b0d0f', panel: '#14181b', line: '#262c30', ink: '#f1efe8', dim: '#a9aea9', gold: '#d4a43b', b2: '#e0683f', b1: '#9a4f37',
      a2: '#57b3a0', a1: '#2f6f64', even: '#6d7378', none: '#1a1f22', nonel: '#4a5156', tileink: '#0b0d0f', tilesoft: '#f1efe8',
      ringbg: '#262c30', tick: '#f1efe8', corn: '#d4a43b', serif: false },
    paper: { bg: '#f3ecdc', panel: '#fbf6ea', line: '#d9ccb0', ink: '#1f1b14', dim: '#5e5546', gold: '#9a6c12', b2: '#b9472a', b1: '#e3a088',
      a2: '#2d6e62', a1: '#93c2b5', even: '#7d7667', none: '#e8dfcb', nonel: '#b8ab90', tileink: '#fbf6ea', tilesoft: '#1f1b14',
      ringbg: '#e3d8c0', tick: '#1f1b14', corn: '#b98a22', serif: true }
  };
  var LAYOUTS = {
    phone: { W: 1080, H: 2400, pad: 44, gap: 14, hgap: 16, title: 92, tile: 55 },
    print: { W: 1320, H: 0, minH: 2040, pad: 44, gap: 16, hgap: 18, title: 78, tile: 58 }
  };
  /* the shapes: data/us-states-map.svg, the one shared real map (components/usmap.js, scripts/build_us_map.py), read once.
     GEO = {vw, vh, list: [{st, d, c: [x, y], o: [x, y] or null, bb: [x0, y0, x1, y1]}]}; null until posterFonts has loaded it. */
  var GEO = null, GEO_P = null, MAP_SRC = '/data/us-states-map.svg?v=1';
  function bbox(d) {
    var x = 0, y = 0, b = [1e9, 1e9, -1e9, -1e9];
    (d.match(/[Ml][^Ml]*/g) || []).forEach(function (seg) {
      var n = seg.slice(1).trim().split(/[\s,]+/).map(Number), rel = seg.charAt(0) === 'l';
      for (var i = 0; i + 1 < n.length; i += 2) {
        x = rel ? x + n[i] : n[i]; y = rel ? y + n[i + 1] : n[i + 1];
        if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
      }
    });
    return b;
  }
  function setMap(txt) {
    var vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(txt), out = { vw: +vb[1], vh: +vb[2], list: [] }, re = /<path id="([A-Z]{2})"([^>]*?) d="([^"]+)"/g, m;
    while ((m = re.exec(txt))) {
      var c = /data-c="([\d.]+),([\d.]+)"/.exec(m[2]), o = /data-o="([\d.]+),([\d.]+)"/.exec(m[2]);
      out.list.push({ st: m[1], d: m[3], c: [+c[1], +c[2]], o: o ? [+o[1], +o[2]] : null, bb: bbox(m[3]) });
    }
    GEO = out;
    return out;
  }
  function loadMap() {
    if (GEO) return Promise.resolve(GEO);
    if (!GEO_P) GEO_P = (root.fetch ? root.fetch(MAP_SRC) : Promise.reject()).then(function (r) { if (!r.ok) throw 0; return r.text(); }).then(setMap).catch(function () { GEO_P = null; return null; });
    return GEO_P;
  }
  /* our own icons, drawn in a 48 (64 for the combine, 32 for the small ones) unit box */
  var ICON = {
    corn: function (g, x, y, s, fill, kern) {
      var k = s / 48;
      g.path('M24 3c6 0 9 7 9 17s-3 20-9 20-9-10-9-20 3-17 9-17z', x, y, k, fill);
      for (var r = 0; r < 6; r++) for (var c = 0; c < 3; c++) g.circle(x + (19 + c * 5) * k, y + (9 + r * 5.2) * k, 1.7 * k, kern);
      g.path('M24 44c-7-1-14-7-15-19 5 3 9 8 12 14z', x, y, k, fill, 0.75);
      g.path('M24 44c7-1 14-7 15-19-5 3-9 8-12 14z', x, y, k, fill, 0.75);
    },
    bean: function (g, x, y, s, fill, bg) {
      var k = s / 48;
      g.path('M10 38c-4-4-2-10 3-13l14-12c5-4 12-4 15 0s1 10-4 13L24 38c-5 4-10 4-14 0z', x, y, k, fill);
      [[17, 31], [25, 24], [33, 17]].forEach(function (q) { g.circle(x + q[0] * k, y + q[1] * k, 4.5 * k, bg, 0.55); });
      g.path('M41 12c2-3 3-6 2-9', x, y, k, null, 1, fill, 3);
    },
    combine: function (g, x, y, s, c, bg) {
      var k = s / 64;
      g.rect(x + 20 * k, y + 10 * k, 26 * k, 20 * k, 3 * k, c); g.rect(x + 34 * k, y + 4 * k, 12 * k, 12 * k, 2 * k, c);
      g.rect(x + 37 * k, y + 7 * k, 6 * k, 6 * k, 1 * k, bg); g.rect(x + 2 * k, y + 24 * k, 20 * k, 6 * k, 2 * k, c);
      g.path('M2 30h18l-2 6H4z', x, y, k, c); g.path('M46 14l12-8 3 3-12 9z', x, y, k, c);
      g.circle(x + 26 * k, y + 36 * k, 9 * k, c); g.circle(x + 26 * k, y + 36 * k, 3.5 * k, bg);
      g.circle(x + 45 * k, y + 38 * k, 6 * k, c); g.circle(x + 45 * k, y + 38 * k, 2.3 * k, bg);
    },
    info: function (g, x, y, s, c, bg) {
      var k = s / 32;
      g.circle(x + 16 * k, y + 16 * k, 15 * k, c); g.rect(x + 14 * k, y + 13 * k, 4 * k, 12 * k, 2 * k, bg); g.circle(x + 16 * k, y + 8.5 * k, 2.4 * k, bg);
    },
    map: function (g, x, y, s, c) {
      var k = s / 32;
      g.path('M3 8l8-3 10 3 8-3v19l-8 3-10-3-8 3z', x, y, k, c, 0.5);
      g.path('M11 5v19M21 8v19', x, y, k, null, 1, c, 2);
    },
    chart: function (g, x, y, s, c) {
      var k = s / 32;
      g.rect(x + 3 * k, y + 18 * k, 6 * k, 11 * k, 1.5 * k, c, 0.5); g.rect(x + 13 * k, y + 11 * k, 6 * k, 18 * k, 1.5 * k, c);
      g.rect(x + 23 * k, y + 4 * k, 6 * k, 25 * k, 1.5 * k, c, 0.5);
    }
  };

  function num(n) { return (n < 0 ? '−' : '') + fmt(n); }
  function sgn(n) { return (n > 0 ? '+' : '') + num(n); }

  /* the drawing list and its measuring pen (ctx: any 2d context with the poster's fonts loaded) */
  function Draw(ctx, T) {
    var g = { ops: [], texts: [], boxes: [], box: -1 };
    function face(size, weight, serif) { return (serif ? Math.min(weight, 600) : weight) + ' ' + size + 'px ' + (serif ? SERIF : SANS); }
    g.w = function (s, size, weight, serif, ls) { ctx.font = face(size, weight, serif); return ctx.measureText(String(s)).width + (ls || 0) * String(s).length; };
    g.text = function (s, x, y, size, weight, fill, al, serif, ls) {
      s = String(s);
      var w = g.w(s, size, weight, serif, ls), x0 = al === 'right' ? x - w : al === 'center' ? x - w / 2 : x;
      g.ops.push({ t: 'text', s: s, x: x0, y: y, size: size, weight: serif ? Math.min(weight, 600) : weight, fill: fill, serif: !!serif, ls: ls || 0, font: face(size, weight, serif) });
      g.texts.push({ s: s, x0: x0, x1: x0 + w, top: y - size * 0.72, bot: y + size * 0.2, size: size, box: g.box });
      return w;
    };
    /* the largest size (down in steps of 2, not under min) at which s fits width */
    g.fit = function (s, size, min, weight, width, serif, ls) { while (size > min && g.w(s, size, weight, serif, ls) > width) size -= 2; return size; };
    g.wrap = function (s, size, weight, width, serif) {
      var out = [], cur = '';
      String(s).split(' ').forEach(function (word) { var t = cur ? cur + ' ' + word : word; if (cur && g.w(t, size, weight, serif) > width) { out.push(cur); cur = word; } else cur = t; });
      if (cur) out.push(cur);
      return out;
    };
    /* plain lines: -> the baseline after the last line */
    g.lines = function (s, x, y, size, weight, fill, lh, width, serif) {
      g.wrap(s, size, weight, width, serif).forEach(function (l) { g.text(l, x, y, size, weight, fill, 'left', serif); y += lh; });
      return y;
    };
    /* mixed spans [{s, b (bold), fill, weight}] wrapped together: -> the baseline after the last line */
    g.rich = function (spans, x, y, width, size, lh, base, serif) {
      var words = [], cur = null;
      spans.forEach(function (sp) {
        String(sp.s).split(' ').forEach(function (part, i) {
          if (i > 0 && cur) { words.push(cur); cur = null; }
          if (part) { cur = cur || []; cur.push({ s: part, sp: sp }); }
        });
      });
      if (cur) words.push(cur);
      function wt(sp) { return sp.weight || (sp.b ? 700 : base.weight); }
      function ww(word) { return word.reduce(function (a, p) { return a + g.w(p.s, size, wt(p.sp), serif); }, 0); }
      var space = g.w(' ', size, base.weight, serif), lines = [[]], lw = 0;
      words.forEach(function (word) {
        var w = ww(word), cur = lines[lines.length - 1];
        if (cur.length && lw + space + w > width) { lines.push([word]); lw = w; } else { cur.push(word); lw += (cur.length > 1 ? space : 0) + w; }
      });
      lines.forEach(function (line) {
        var cx = x;
        line.forEach(function (word, i) {
          if (i) cx += space;
          word.forEach(function (p) { cx += g.text(p.s, cx, y, size, wt(p.sp), p.sp.fill || (p.sp.b ? T.ink : base.fill), 'left', serif); });
        });
        y += lh;
      });
      return y;
    };
    g.rect = function (x, y, w, h, r, fill, alpha, stroke, lw) { g.ops.push({ t: 'rect', x: x, y: y, w: w, h: h, r: r || 0, fill: fill, alpha: alpha == null ? 1 : alpha, stroke: stroke, lw: lw }); };
    g.circle = function (cx, cy, r, fill, alpha, stroke, lw) { g.ops.push({ t: 'circle', cx: cx, cy: cy, r: r, fill: fill, alpha: alpha == null ? 1 : alpha, stroke: stroke, lw: lw }); };
    g.arc = function (cx, cy, r, a0, a1, stroke, lw) { g.ops.push({ t: 'arc', cx: cx, cy: cy, r: r, a0: a0, a1: a1, stroke: stroke, lw: lw }); };
    g.line = function (x1, y1, x2, y2, stroke, lw, cap, dash) { g.ops.push({ t: 'line', x1: x1, y1: y1, x2: x2, y2: y2, stroke: stroke, lw: lw, cap: cap || 'butt', dash: dash || null }); };
    g.poly = function (pts, stroke, lw) { g.ops.push({ t: 'poly', pts: pts, stroke: stroke, lw: lw }); };
    g.path = function (d, x, y, k, fill, alpha, stroke, lw) { g.ops.push({ t: 'path', d: d, x: x, y: y, k: k, fill: fill, alpha: alpha == null ? 1 : alpha, stroke: stroke, lw: lw }); };
    g.qr = function (m, x, y, mod) { g.ops.push({ t: 'qr', m: m, x: x, y: y, mod: mod }); return (m.length + 8) * mod; };
    g.open = function (id, x, y, w) { g.boxes.push({ id: id, x: x, y: y, w: w, h: 0 }); g.box = g.boxes.length - 1; };
    return g;
  }

  /* ---- the panels: each draws its body at (x, y), inner width w, and returns the y under it */
  var PANEL = {};
  PANEL.map = function (g, T, P, x, y, w, L) {
    y = g.lines(String(P.hint).replace('Each tile is a state.', 'Each state is colored by its gap.'), x, y + 14, 18, 500, T.dim, 24, w) - 6;
    var legW = 0;
    P.bins.concat([{ label: 'No NASS average' }]).forEach(function (b) { legW = Math.max(legW, 34 + g.w(b.label, 17, 600)); });
    legW = Math.max(legW, g.w(P.legend_title.toUpperCase(), 15, 800, false, 1.5));
    /* the real map, as wide as the room beside the legend allows and no taller than the tile grid it replaced was (about 415 px) */
    var mapW = Math.min(w - legW - 22, 400 * (GEO ? GEO.vw / GEO.vh : 1.57)), k = GEO ? mapW / GEO.vw : 1, mw = mapW, mh = GEO ? GEO.vh * k : 0, by = {};
    P.tiles.forEach(function (t) { by[t.key] = t; });
    function shade(st) {
      var t = by[st];
      if (!t) return null;
      var bin = P.bins.filter(function (b) { return (b.lo == null || t.gap >= b.lo) && (b.hi == null || t.gap <= b.hi); })[0] || { c: 'even' };
      return { fill: T[bin.c], ink: bin.c === 'b1' || bin.c === 'a1' ? T.tilesoft : T.tileink, gap: t.gap };
    }
    if (GEO) {
      /* states with no number first, outlined; the colored ones on top, so a colored state keeps its whole edge */
      [false, true].forEach(function (on) {
        GEO.list.forEach(function (s) {
          var sh = shade(s.st);
          if (!!sh !== on) return;
          g.path(s.d, x, y, k, sh ? sh.fill : T.none, 1, sh ? T.panel : T.nonel, sh ? 1.2 : 0.9);
          g.ops[g.ops.length - 1].st = s.st;
        });
      });
      GEO.list.forEach(function (s) {
        if (s.o) g.line(x + s.c[0] * k, y + s.c[1] * k, x + (s.o[0] - 30) * k, y + s.o[1] * k, T.nonel, 1.3);
      });
      GEO.list.forEach(function (s) {
        var sh = shade(s.st), sz = Math.max(13, Math.round(17 * k)), gz = Math.max(13, Math.round(15 * k)), cx, cy;
        if (s.o) {
          cx = x + s.o[0] * k; cy = y + s.o[1] * k;
          g.rect(cx - 30 * k, cy - 30.5 * k, 60 * k, 61 * k, 7, sh ? sh.fill : T.none);
          if (!sh) { g.text(s.st, cx, cy + sz * 0.35, sz, 700, T.nonel, 'center'); return; }
          g.text(s.st, cx, cy - 3, sz, 800, sh.ink, 'center');
          g.text(sh.gap ? sgn(sh.gap) : '0', cx, cy + gz + 1, gz, 800, sh.ink, 'center');
          return;
        }
        cx = x + s.c[0] * k; cy = y + s.c[1] * k;
        var bw = (s.bb[2] - s.bb[0]) * k, bh = (s.bb[3] - s.bb[1]) * k, gt = sh ? (sh.gap ? sgn(sh.gap) : '0') : '';
        if (!sh) { if (bw > g.w(s.st, sz, 600) + 8 && bh > sz + 6) g.text(s.st, cx, cy + sz * 0.35, sz, 600, T.nonel, 'center'); return; }
        /* the code and the gap under it when the state is big enough for both; the code alone when it is not */
        if (bw >= g.w(gt, gz, 800) + 10 && bh >= sz + gz + 12) {
          g.text(s.st, cx, cy - 1, sz, 800, sh.ink, 'center');
          g.text(gt, cx, cy + gz, gz, 800, sh.ink, 'center');
        } else g.text(s.st, cx, cy + sz * 0.35, sz, 800, sh.ink, 'center');
      });
    } else {
      g.lines('The map did not load here.', x, y + 20, 18, 500, T.dim, 24, w);
      mh = 60; mw = w - legW - 22;
    }
    var lx = x + mw + 22, rows = P.bins.length + 1, lh = 33, ly = y + Math.max(0, (mh - (rows * lh + 26)) / 2);
    g.text(P.legend_title.toUpperCase(), lx, ly + 15, 15, 800, T.ink, 'left', false, 1.5);
    P.bins.concat([{ label: 'No NASS average', c: 'none' }]).forEach(function (b, i) {
      var yy = ly + 30 + i * lh;
      g.rect(lx, yy, 24, 24, 5, T[b.c]);
      g.text(b.label, lx + 34, yy + 18, 17, 600, T.dim);
    });
    return y + mh;
  };
  PANEL.count = function (g, T, P, x, y, w) {
    var n = g.fit(P.big, 84, 48, 900, w, T.serif);
    g.text(P.big, x, y + Math.round(n * 0.78), n, 900, T.b2, 'left', T.serif);
    y += Math.round(n * 0.9) + 14;
    y = g.lines(P.line, x, y + 22, 27, 700, T.ink, 32, w, false);
    y = g.lines(P.sub, x, y - 4, 18, 500, T.dim, 23, w) + 4;
    var cols = Math.max(1, Math.min(9, P.icons.length, Math.floor(w / 46))), cw = w / cols, s = Math.min(44, Math.floor(cw) - 4);
    P.icons.forEach(function (ic, i) {
      var cx = x + (i % cols) * cw + cw / 2, cy = y + Math.floor(i / cols) * (s + 22);
      ICON.corn(g, cx - s / 2, cy, s, ic.side < 0 ? T.b2 : ic.side > 0 ? T.a2 : T.even, T.panel);
      g.text(ic.key, cx, cy + s + 13, 13, 700, T.dim, 'center');
    });
    y += Math.ceil(P.icons.length / cols) * (s + 22) + 6;
    var kx = x;
    [['Behind', T.b2], ['Even', T.even], ['Ahead', T.a2]].forEach(function (k) {
      g.circle(kx + 7, y + 10, 7, k[1]);
      kx += 21 + g.text(k[0], kx + 21, y + 16, 16, 600, T.dim) + 16;
    });
    return y + 22;
  };
  PANEL.crops = function (g, T, P, x, y, w) {
    var mid = 46, cw = (w - mid) / 2, size = Math.min(150, Math.floor(cw)), bottom = y;
    P.crops.forEach(function (c, i) {
      var cx = x + (i ? cw + mid : 0) + cw / 2, yy = y + 4;
      var hw = 38 + g.w(c.name, 24, 800);
      (c.icon === 'bean' ? ICON.bean : ICON.corn)(g, cx - hw / 2, yy, 30, T.corn, T.panel);
      g.text(c.name, cx - hw / 2 + 38, yy + 24, 24, 800, T.ink);
      yy += 40;
      var r = size / 2 - 13, cy = yy + size / 2, col = c.gap < 0 ? T.b2 : T.a2;
      g.circle(cx, cy, r, null, 1, T.ringbg, 17);
      if (c.pct > 0) g.arc(cx, cy, r, -90, -90 + 3.6 * Math.min(100, c.pct), col, 17);
      var a = (c.avg5 / 100 * 360 - 90) * Math.PI / 180;
      g.line(cx + (r - 16) * Math.cos(a), cy + (r - 16) * Math.sin(a), cx + (r + 16) * Math.cos(a), cy + (r + 16) * Math.sin(a), T.tick, 5, 'round');
      g.text(c.pct + '%', cx, cy + 8, 38, 900, T.ink, 'center');
      g.text('harvested', cx, cy + 30, 14, 600, T.dim, 'center');
      yy += size + 26;
      g.text(c.words, cx, yy, 22, 800, c.gap < 0 ? T.b2 : c.gap > 0 ? T.a2 : T.even, 'center');
      yy += 22;
      g.text(c.pct + '% vs ' + c.avg5 + '% avg', cx, yy, 16, 500, T.dim, 'center');
      if (c.week_gain != null) { yy += 20; g.text(sgn(c.week_gain) + ' pts this week', cx, yy, 16, 500, T.dim, 'center'); }
      bottom = Math.max(bottom, yy + 6);
      if (i === 0) g.text('vs', x + cw + mid / 2, cy + 12, 34, 900, T.gold, 'center', T.serif);
    });
    var kw = 12 + g.w(P.key, 16, 500), kx = x + w / 2 - kw / 2, ky = bottom + 22;
    g.rect(kx, ky - 13, 4, 16, 2, T.tick);
    g.text(P.key, kx + 12, ky, 16, 500, T.dim);
    return ky + 6;
  };
  PANEL.lists = function (g, T, P, x, y, w, L) {
    var side = w >= 700, gap = 26, cw = side ? (w - gap) / 2 : w, top = y, bottom = y, pitch = L.W > 1100 ? 31 : 34;
    P.cols.forEach(function (c, i) {
      var cx = side ? x + i * (cw + gap) : x, yy = side ? top : (i ? bottom + 16 : top), col = c.side < 0 ? T.b2 : T.a2;
      g.text(c.head.toUpperCase(), cx, yy + 15, 15, 800, col, 'left', false, 1.8);
      yy += 24;
      var nameW = 0;
      c.rows.forEach(function (r) { nameW = Math.max(nameW, g.w(r.label, 19, 600)); });
      var nw = Math.min(Math.max(120, Math.ceil(nameW) + 12), cw * 0.45), vw = 50;
      c.rows.forEach(function (r) {
        var fs = g.fit(r.label, 19, 14, 600, nw - 8);
        g.text(r.label, cx, yy + pitch / 2 + 7, fs, 600, T.ink);
        var tx = cx + nw, tw = cw - nw - vw - 10;
        g.rect(tx, yy + pitch / 2 - 8, tw, 16, 8, T.ringbg);
        g.rect(tx, yy + pitch / 2 - 8, Math.max(16, tw * Math.abs(r.gap) / P.scale), 16, 8, col);
        g.text(sgn(r.gap), cx + cw, yy + pitch / 2 + 7, 19, 800, T.ink, 'right');
        yy += pitch;
      });
      if (c.tie) yy = g.lines(c.tie, cx, yy + 18, 15, 500, T.dim, 20, cw) - 14;
      bottom = Math.max(bottom, yy);
    });
    return bottom + 4;
  };
  PANEL.means = function (g, T, P, x, y, w, L) {
    var two = w >= 600, gap = L.W > 1100 ? 48 : 22, cw = two ? (w - gap) / 2 : w, bottom = y;
    [['It means', P.yes, T.gold], ['It does not mean', P.no, T.dim]].forEach(function (c, i) {
      var cx = two ? x + i * (cw + gap) : x, yy = two ? y : (i ? bottom + 14 : y);
      g.text(c[0].toUpperCase(), cx, yy + 15, 15, 800, T.gold, 'left', false, 1.8);
      yy += 24;
      c[1].forEach(function (li) {
        g.rect(cx, yy + 7, 8, 8, 2, c[2]);
        yy = g.lines(li, cx + 18, yy + 18, 18, 500, T.ink, 24.5, cw - 18) - 18 + 6;
      });
      bottom = Math.max(bottom, yy);
    });
    return bottom;
  };
  PANEL.line = function (g, T, P, x, y, w, L) {
    y = g.lines(String(P.hint).replace('Each tile is a state.', 'Each state is colored by its gap.'), x, y + 14, 18, 500, T.dim, 24, w) - 6;
    var pts = P.points, ys = pts.map(function (q) { return q.y; }), lo = Math.min.apply(null, ys.concat([0])), hi = Math.max.apply(null, ys.concat([0]));
    var span = hi - lo || 1, stepv = Math.pow(10, Math.floor(Math.log(span / 3) / Math.LN10)), k;
    [1, 2, 2.5, 5, 10].some(function (m) { k = m * stepv; return span / k <= 5; });
    lo = Math.floor(lo / k) * k; hi = Math.ceil(hi / k) * k;
    var lw = 0, ticks = [];
    for (var v = lo; v <= hi + k / 2; v += k) { ticks.push(v); lw = Math.max(lw, g.w(num(v), 15, 600)); }
    var h = L.W > 1100 ? 300 : 340, px0 = x + lw + 14, pw = w - lw - 14 - 90, top = y + 16, bot = top + h - 40;
    function px(i) { return px0 + 20 + (pw - 40) * (pts.length === 1 ? 0.5 : i / (pts.length - 1)); }
    function py(v) { return bot - (bot - top) * (v - lo) / (hi - lo || 1); }
    ticks.forEach(function (v) {
      g.line(px0, py(v), px0 + pw, py(v), T.line, v === 0 ? 3 : 1.5, 'butt', v === 0 ? [8, 6] : null);
      g.text(num(v), px0 - 10, py(v) + 5, 15, 600, T.dim, 'right');
    });
    g.poly(pts.map(function (q, i) { return [px(i), py(q.y)]; }), T.gold, 6);
    var stepx = pts.length > 1 ? (pw - 40) / (pts.length - 1) : 1e9;
    pts.forEach(function (q, i) {
      g.circle(px(i), py(q.y), 8, T.gold);
      if (stepx >= 64 || i === 0 || i === pts.length - 1) g.text(q.label, px(i), bot + 28, 15, 600, T.dim, 'center');
    });
    var f = pts[0], l = pts[pts.length - 1];
    g.text(num(f.y), px(0) + 14, py(f.y) - 14, 20, 800, T.ink, 'left');
    g.text(num(l.y), px(pts.length - 1) + 16, py(l.y) + 7, 20, 800, T.ink, 'left');
    return bot + 36;
  };
  PANEL.split = function (g, T, P, x, y, w) {
    var mx = 1;
    P.weeks.forEach(function (wk) { mx = Math.max(mx, wk.long, wk.short); });
    var lab = Math.max(g.w('Longs', 16, 600), g.w('Shorts', 16, 600)) + 12, vw = 0;
    P.weeks.forEach(function (wk) { vw = Math.max(vw, g.w(fmt(wk.long), 17, 800), g.w(fmt(wk.short), 17, 800)); });
    vw += 10;
    P.weeks.forEach(function (wk) {
      g.text(wk.label, x, y + 20, 18, 700, T.ink);
      y += 30;
      [['Longs', wk.long, T.a2], ['Shorts', wk.short, T.b2]].forEach(function (b) {
        g.text(b[0], x, y + 17, 16, 600, T.dim);
        var bw = w - lab - vw;
        g.rect(x + lab, y + 3, bw, 16, 8, T.ringbg);
        g.rect(x + lab, y + 3, Math.max(16, bw * b[1] / mx), 16, 8, b[2]);
        g.text(fmt(b[1]), x + w, y + 18, 17, 800, T.ink, 'right');
        y += 28;
      });
      y += 8;
    });
    var ch = P.change, s = 'This week: longs ' + sgn(ch.long) + ', shorts ' + sgn(ch.short) + (ch.label ? ' (' + ch.label + ').' : '.');
    return g.lines(s, x, y + 14, 16, 500, T.dim, 21, w) - 10;
  };
  PANEL.changes = function (g, T, P, x, y, w) {
    var mx = 1, lab = 0, vw = 0;
    P.rows.forEach(function (r) { mx = Math.max(mx, Math.abs(r.chg)); lab = Math.max(lab, g.w(r.label, 17, 600)); vw = Math.max(vw, g.w(sgn(r.chg), 17, 800)); });
    lab += 12; vw += 12;
    var neg = P.rows.some(function (r) { return r.chg < 0; }), pos = P.rows.some(function (r) { return r.chg > 0; });
    var bx = x + lab, bw = w - lab - vw, zero = neg && pos ? bx + bw / 2 : neg ? bx + bw : bx, half = neg && pos ? bw / 2 : bw;
    P.rows.forEach(function (r) {
      g.text(r.label, x, y + 21, 17, 600, T.ink);
      var len = Math.max(4, half * Math.abs(r.chg) / mx);
      g.rect(r.chg < 0 ? zero - len : zero, y + 8, len, 16, 4, r.chg < 0 ? T.b2 : T.a2);
      g.text(sgn(r.chg), x + w, y + 21, 17, 800, T.ink, 'right');
      y += 30;
    });
    g.line(zero, y - 30 * P.rows.length + 2, zero, y - 2, T.dim, 2);
    if (P.of > P.rows.length) y = g.lines('The last ' + P.rows.length + ' of ' + P.of + ' weeks.', x, y + 16, 15, 500, T.dim, 20, w) - 14;
    return y + 2;
  };
  PANEL.rank = function (g, T, P, x, y, w) {
    var big = Math.round(P.pctl) + '%', n = 72;
    g.text(big, x, y + Math.round(n * 0.78), n, 900, T.gold, 'left', T.serif);
    y += Math.round(n * 0.9) + 8;
    y = g.lines(P.line, x, y + 20, 20, 600, T.ink, 26, w);
    y = g.lines(P.sub, x, y - 2, 16, 500, T.dim, 21, w) + 12;
    var gx = x + 8, gw = w - 16;
    g.rect(gx, y + 22, gw, 14, 7, T.ringbg);
    g.rect(gx, y + 22, Math.max(14, gw * P.pctl / 100), 14, 7, T.gold, 0.55);
    if (P.pctl_prev != null) {
      var qx = gx + gw * P.pctl_prev / 100;
      g.circle(qx, y + 29, 9, T.panel, 1, T.dim, 3);
      g.text('Last week', Math.min(Math.max(qx, gx + 40), gx + gw - 40), y + 60, 14, 600, T.dim, 'center');
    }
    var px = gx + gw * P.pctl / 100;
    g.circle(px, y + 29, 11, T.ink);
    g.text('This week', Math.min(Math.max(px, gx + 40), gx + gw - 40), y + 12, 14, 700, T.ink, 'center');
    g.text('Lowest', gx, y + (P.pctl_prev != null ? 82 : 60), 13, 600, T.dim);
    g.text('Highest', gx + gw, y + (P.pctl_prev != null ? 82 : 60), 13, 600, T.dim, 'right');
    return y + (P.pctl_prev != null ? 88 : 66);
  };
  var PANEL_ICON = { map: 'map', crops: 'combine', means: 'info', line: 'chart' };

  function posterRows(spec, layout) {
    var have = {};
    spec.poster.panels.forEach(function (p) { have[p.id] = p; });
    var want = spec.kind === 'funds-corn'
      ? (layout === 'print' ? [['line'], ['split', 'changes', 'rank'], ['means']] : [['line'], ['split', 'changes'], ['rank'], ['means']])
      : (layout === 'print' ? [['map'], ['count', 'crops', 'lists'], ['means']] : [['map'], ['count', 'crops'], ['lists'], ['means']]);
    return want.map(function (r) { return r.filter(function (id) { return have[id]; }).map(function (id) { return have[id]; }); })
      .filter(function (r) { return r.length; });
  }

  /* o: {qr: matrix or null, extra: px added to each gap (filling the phone height)} */
  function posterLayout(spec, ctx, theme, layout, o) {
    o = o || {};
    var T = THEMES[theme] || THEMES.dark, L = LAYOUTS[layout] || LAYOUTS.phone, K = SK(), PO = spec.poster, W = L.W, X = L.pad, IW = W - 2 * L.pad;
    var g = Draw(ctx, T), gap = L.gap + (o.extra || 0), step = 1, hook = PO.panels.filter(function (p) { return p.id === 'hook'; })[0];
    /* 1. the head: kicker, the headline, the lede, the big number row, its source */
    g.open('head', X, L.pad, IW);
    var y = L.pad;
    g.circle(X + 16, y + 16, 16, T.gold);
    g.text(String(step++), X + 16, y + 22, 17, 800, T.bg, 'center');
    var kick = ('Friday Chart · ' + PO.kicker).toUpperCase();
    g.text(kick, X + 44, y + 23, 18, 700, T.gold, 'left', false, 2.5);
    var dt = K.mdy(spec.date).toUpperCase(), dw = g.w(dt, 14, 700, false, 1.7);
    g.rect(X + IW - dw - 20, y + 2, dw + 20, 28, 6, null, 1, T.gold, 2);
    g.text(dt, X + IW - dw - 10, y + 21, 14, 700, T.gold, 'left', false, 1.7);
    y += 32 + 16;
    var ts = L.title, hl = PO.headline;
    y = g.rich([{ s: hl.lead }, { s: hl.em, fill: T.gold }, { s: hl.tail }], X, y + Math.round(ts * 0.8), IW, ts, Math.round(ts * 0.96), { weight: 900, fill: T.ink }, T.serif);
    y = g.rich(PO.lede, X, y - Math.round(ts * 0.96) + Math.round(ts * 0.2) + 10 + 28, IW, 28, 37, { weight: 500, fill: T.dim }) - 37 + 10;
    if (hook) {
      var top = y + 18, B = hook.big, unit = B.unit === '%' ? '%' : '', bigS = num(B.value);
      var vsS = 'vs ' + num(B.vs), note = hook.note, labW = 0;
      B.label.forEach(function (l) { labW = Math.max(labW, g.w(l, 19, 600)); });
      var vsW = Math.max(labW, g.w(vsS, 52, 800, T.serif) + (unit ? g.w(unit, 26, 800, T.serif) : 0));
      var noteW = 0;
      if (note) { noteW = g.w(note.value, 40, 800, T.serif); note.label.forEach(function (l) { noteW = Math.max(noteW, g.w(l, 19, 600)); }); }
      var room = IW - 52 - vsW - 26 - (note ? noteW + 26 : 0), bs = 150;
      while (bs > 70 && g.w(bigS, bs, 900, T.serif) + (unit ? g.w(unit, Math.round(bs * 0.45), 900, T.serif) : 0) > room) bs -= 4;
      var rowH = 18 + Math.round(bs * 0.74) + 22, base = top + 18 + Math.round(bs * 0.74);
      g.rect(X, top, IW, rowH, 18, T.panel, 1, T.line, 1);
      var bx = X + 26, bw = g.text(bigS, bx, base, bs, 900, T.b2, 'left', T.serif);
      if (unit) bw += g.text(unit, bx + bw, base, Math.round(bs * 0.45), 900, T.b2, 'left', T.serif);
      var vx = bx + bw + 26, lb = top + rowH - 22;
      B.label.forEach(function (l, i) { g.text(l, vx, lb - (B.label.length - 1 - i) * 25, 19, 600, T.dim); });
      var vb = lb - (B.label.length - 1) * 25 - 30, vw2 = g.text(vsS, vx, vb, 52, 800, T.ink, 'left', T.serif);
      if (unit) g.text(unit, vx + vw2, vb, 26, 800, T.ink, 'left', T.serif);
      if (note) {
        var nx = X + IW - 26;
        note.label.forEach(function (l, i) { g.text(l, nx, lb - (note.label.length - 1 - i) * 25, 19, 600, T.dim, 'right'); });
        g.text(note.value, nx, lb - (note.label.length - 1) * 25 - 30, 40, 800, T.ink, 'right', T.serif);
      }
      y = top + rowH;
      y = g.lines(hook.source, X, y + 10 + 15, 15, 500, T.dim, 20, IW) - 20;
    }
    g.boxes[g.box].h = y + 4 - L.pad;
    y += 4;
    /* 2. the panels, a row at a time; panels in a row share its height; each source sits at its panel's foot */
    posterRows(spec, layout).forEach(function (row) {
      y += gap;
      var n = row.length, pw = (IW - (n - 1) * L.hgap) / n, ends = [], srcs = [], marks = [];
      row.forEach(function (P, i) {
        var px = X + i * (pw + L.hgap), ix = px + 26, iw = pw - 52, iy = y + 22;
        g.open(P.id, px, y, pw);
        marks.push(g.ops.length);
        g.ops.push(null);   /* the panel's own box, filled in once the row's height is known */
        g.circle(ix + 19, iy + 19, 19, T.gold);
        g.text(String(step++), ix + 19, iy + 26, 20, 800, T.bg, 'center');
        var icon = PANEL_ICON[P.id], iconW = icon === 'combine' ? 58 : icon ? 34 : 0;
        var tw = iw - 50 - (iconW ? iconW + 10 : 0), tsz = g.fit(P.title, 30, 26, 800, tw, T.serif), tl = g.wrap(P.title, tsz, 800, tw, T.serif), ty = iy + 29;
        if (tl.length > 1) ty = iy + 26;
        tl.forEach(function (l, k) { g.text(l, ix + 50, ty + k * 34, tsz, 800, T.ink, 'left', T.serif); });
        if (icon) ICON[icon](g, ix + iw - iconW, iy + (icon === 'combine' ? -2 : 2), iconW, T.gold, T.panel);
        var by = iy + Math.max(38, tl.length * 34) + 12;
        ends.push(PANEL[P.id](g, T, P, ix, by, iw, L));
        srcs.push(g.wrap(P.source, 15, 500, iw));
      });
      var h = 0;
      row.forEach(function (P, i) { h = Math.max(h, ends[i] - y + 10 + srcs[i].length * 19.5 + 16); });
      row.forEach(function (P, i) {
        var px = X + i * (pw + L.hgap), bi = g.boxes.length - n + i;
        g.box = bi;
        g.boxes[bi].h = h;
        g.ops[marks[i]] = { t: 'rect', x: px, y: y, w: pw, h: h, r: 18, fill: T.panel, alpha: 1, stroke: T.line, lw: 1 };
        srcs[i].forEach(function (l, k) { g.text(l, px + 26, y + h - 16 - (srcs[i].length - 1 - k) * 19.5 - 4, 15, 500, T.dim); });
      });
      y += h;
    });
    /* 3. the foot: the address, the series name with its date, the data line, the QR code */
    y += gap + 2;
    g.open('foot', X, y, IW);
    g.line(X, y + 1, X + IW, y + 1, T.gold, 2);
    var fy = y + 20, m = o.qr, qs = 0;
    if (m) { var mod = Math.max(2, Math.floor(126 / (m.length + 8))); qs = (m.length + 8) * mod; g.qr(m, X + IW - qs, fy, mod); }
    var aw = g.text('agsist', X, fy + 46, 40, 900, T.ink, 'left', T.serif);
    g.text('.com', X + aw, fy + 46, 40, 900, T.gold, 'left', T.serif);
    var mx = X + Math.max(220, aw + g.w('.com', 40, 900, T.serif) + 26), mw = X + IW - (qs ? qs + 22 : 0) - mx;
    var lab = ('Friday Chart · Infographic of the Week · ' + K.mdy(spec.date)).toUpperCase();
    var ls = g.fit(lab, 16, 12, 700, mw, false, 1);
    g.text(lab, mx, fy + 24, ls, 700, T.dim, 'left', false, 1);
    var ey = g.lines(PO.data_line, mx, fy + 46, 14, 500, T.dim, 19, mw);
    ey = g.lines('Scan the code or visit ' + shown(spec) + ' for the live page.', mx, ey + 2, 14, 600, T.dim, 19, mw);
    var fb = Math.max(fy + qs, ey - 10, fy + 56);
    g.boxes[g.box].h = fb - y;
    var H = L.H || Math.max(L.minH || 0, Math.ceil(fb + L.pad));
    return { W: W, H: H, bottom: fb, ops: g.ops, texts: g.texts, boxes: g.boxes, theme: theme, layout: layout, bg: T.bg };
  }

  /* lay out, then on the phone spread what is left of the height over the gaps (a little each) */
  function poster(spec, ctx, theme, layout, o) {
    o = o || {};
    var L = LAYOUTS[layout] || LAYOUTS.phone, r = posterLayout(spec, ctx, theme, layout, o), tall = L.H || L.minH;
    if (tall && r.bottom < tall - L.pad) {
      /* the phone height, or the 11 x 17 shape on paper: spread what is left over the gaps (up to 40 px each) */
      var gaps = posterRows(spec, layout).length + 1, extra = Math.min(L.H ? 30 : 40, Math.floor((tall - L.pad - r.bottom) / gaps));
      if (extra > 0) r = posterLayout(spec, ctx, theme, layout, { qr: o.qr, extra: extra });
    } else if (L.H && r.bottom > L.H - 28) {
      /* a little over: tighten the gaps (not under 6 px) before giving up */
      var n = posterRows(spec, layout).length + 1, cut = Math.min(L.gap - 6, Math.ceil((r.bottom - (L.H - 28)) / n));
      r = posterLayout(spec, ctx, theme, layout, { qr: o.qr, extra: -cut });
    }
    r.fits = r.bottom <= (L.H ? L.H - 20 : r.H);
    r.room = (L.H || r.H) - r.bottom;
    return r;
  }

  /* ---- the two painters */
  function paintOps(ctx, r) {
    ctx.fillStyle = r.bg; ctx.fillRect(0, 0, r.W, r.H);
    r.ops.forEach(function (q) {
      ctx.save();
      ctx.globalAlpha = q.alpha == null ? 1 : q.alpha;
      if (q.t === 'rect') {
        ctx.beginPath();
        if (q.r && ctx.roundRect) ctx.roundRect(q.x, q.y, q.w, q.h, Math.min(q.r, q.w / 2, q.h / 2)); else ctx.rect(q.x, q.y, q.w, q.h);
        if (q.fill) { ctx.fillStyle = q.fill; ctx.fill(); }
        if (q.stroke) { ctx.strokeStyle = q.stroke; ctx.lineWidth = q.lw || 1; ctx.stroke(); }
      } else if (q.t === 'circle') {
        ctx.beginPath(); ctx.arc(q.cx, q.cy, q.r, 0, Math.PI * 2);
        if (q.fill) { ctx.fillStyle = q.fill; ctx.fill(); }
        if (q.stroke) { ctx.strokeStyle = q.stroke; ctx.lineWidth = q.lw || 1; ctx.stroke(); }
      } else if (q.t === 'arc') {
        ctx.beginPath(); ctx.arc(q.cx, q.cy, q.r, q.a0 * Math.PI / 180, q.a1 * Math.PI / 180);
        ctx.strokeStyle = q.stroke; ctx.lineWidth = q.lw; ctx.stroke();
      } else if (q.t === 'line') {
        ctx.beginPath(); ctx.moveTo(q.x1, q.y1); ctx.lineTo(q.x2, q.y2);
        ctx.strokeStyle = q.stroke; ctx.lineWidth = q.lw; ctx.lineCap = q.cap; if (q.dash) ctx.setLineDash(q.dash); ctx.stroke();
      } else if (q.t === 'poly') {
        ctx.beginPath(); q.pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
        ctx.strokeStyle = q.stroke; ctx.lineWidth = q.lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
      } else if (q.t === 'path') {
        ctx.translate(q.x, q.y); ctx.scale(q.k, q.k);
        var p2 = new root.Path2D(q.d);
        if (q.fill) { ctx.fillStyle = q.fill; ctx.fill(p2); }
        if (q.stroke) { ctx.strokeStyle = q.stroke; ctx.lineWidth = q.lw; ctx.lineCap = 'round'; ctx.stroke(p2); }
      } else if (q.t === 'qr') {
        SK().qr(ctx, q.m, q.x, q.y, q.mod);
      } else if (q.t === 'text') {
        ctx.font = q.font; ctx.fillStyle = q.fill; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        if (!q.ls) ctx.fillText(q.s, q.x, q.y);
        else { var cx = q.x; q.s.split('').forEach(function (ch) { ctx.fillText(ch, cx, q.y); cx += ctx.measureText(ch).width + q.ls; }); }
      }
      ctx.restore();
    });
  }
  function f1(n) { return Math.round(n * 10) / 10; }
  function opsSvg(r, label) {
    var e = SK().esc, out = ['<svg xmlns="http://www.w3.org/2000/svg" class="igp-svg" viewBox="0 0 ' + r.W + ' ' + r.H + '" role="img" aria-label="' + e(label) + '">',
      '<rect width="' + r.W + '" height="' + r.H + '" fill="' + r.bg + '"/>'];
    function paint(q) { return (q.fill ? ' fill="' + q.fill + '"' : ' fill="none"') + (q.stroke ? ' stroke="' + q.stroke + '" stroke-width="' + q.lw + '"' : '') + (q.alpha != null && q.alpha < 1 ? ' opacity="' + q.alpha + '"' : ''); }
    r.ops.forEach(function (q) {
      if (q.t === 'rect') out.push('<rect x="' + f1(q.x) + '" y="' + f1(q.y) + '" width="' + f1(q.w) + '" height="' + f1(q.h) + '"' + (q.r ? ' rx="' + f1(Math.min(q.r, q.w / 2, q.h / 2)) + '"' : '') + paint(q) + '/>');
      else if (q.t === 'circle') out.push('<circle cx="' + f1(q.cx) + '" cy="' + f1(q.cy) + '" r="' + f1(q.r) + '"' + paint(q) + '/>');
      else if (q.t === 'arc') {
        var a0 = q.a0 * Math.PI / 180, a1 = q.a1 * Math.PI / 180;
        if (q.a1 - q.a0 >= 359.9) out.push('<circle cx="' + f1(q.cx) + '" cy="' + f1(q.cy) + '" r="' + f1(q.r) + '" fill="none" stroke="' + q.stroke + '" stroke-width="' + q.lw + '"/>');
        else out.push('<path d="M' + f1(q.cx + q.r * Math.cos(a0)) + ' ' + f1(q.cy + q.r * Math.sin(a0)) + 'A' + f1(q.r) + ' ' + f1(q.r) + ' 0 ' + (q.a1 - q.a0 > 180 ? 1 : 0) + ' 1 '
          + f1(q.cx + q.r * Math.cos(a1)) + ' ' + f1(q.cy + q.r * Math.sin(a1)) + '" fill="none" stroke="' + q.stroke + '" stroke-width="' + q.lw + '"/>');
      } else if (q.t === 'line') out.push('<line x1="' + f1(q.x1) + '" y1="' + f1(q.y1) + '" x2="' + f1(q.x2) + '" y2="' + f1(q.y2) + '" stroke="' + q.stroke + '" stroke-width="' + q.lw + '" stroke-linecap="' + q.cap + '"' + (q.dash ? ' stroke-dasharray="' + q.dash.join(' ') + '"' : '') + '/>');
      else if (q.t === 'poly') out.push('<polyline points="' + q.pts.map(function (p) { return f1(p[0]) + ',' + f1(p[1]); }).join(' ') + '" fill="none" stroke="' + q.stroke + '" stroke-width="' + q.lw + '" stroke-linejoin="round" stroke-linecap="round"/>');
      else if (q.t === 'path') out.push('<path transform="translate(' + f1(q.x) + ' ' + f1(q.y) + ') scale(' + (Math.round(q.k * 1000) / 1000) + ')" d="' + q.d + '"' + paint(q) + (q.stroke ? ' stroke-linecap="round"' : '') + '/>');
      else if (q.t === 'qr') {
        var d = [];
        q.m.forEach(function (row, ri) {
          for (var c = 0; c < row.length; c++) if (row[c]) { var s = c; while (c + 1 < row.length && row[c + 1]) c++; d.push('M' + (q.x + (s + 4) * q.mod) + ' ' + (q.y + (ri + 4) * q.mod) + 'h' + (c - s + 1) * q.mod + 'v' + q.mod + 'h-' + (c - s + 1) * q.mod + 'z'); }
        });
        var side = (q.m.length + 8) * q.mod;
        out.push('<rect x="' + q.x + '" y="' + q.y + '" width="' + side + '" height="' + side + '" fill="#fff"/><path d="' + d.join('') + '" fill="#000"/>');
      } else if (q.t === 'text') out.push('<text x="' + f1(q.x) + '" y="' + f1(q.y) + '" font-family="' + e(q.serif ? SERIF : SANS) + '" font-size="' + q.size + '" font-weight="' + q.weight + '" fill="' + q.fill + '"'
        + (q.ls ? ' letter-spacing="' + q.ls + '"' : '') + '>' + e(q.s) + '</text>');
    });
    out.push('</svg>');
    return out.join('');
  }
  /* the fonts and the map shapes the poster draws with, loaded before it is measured (the page's own fonts are optional) */
  function posterFonts(doc, theme) {
    var f = doc && doc.fonts, want = ['900 40px Inter', '800 40px Inter', '700 40px Inter', '600 40px Inter', '500 40px Inter'];
    if (theme === 'paper') want.push('600 40px Fraunces');
    if (!f || !f.load) return loadMap().then(function () {});
    return Promise.all(want.map(function (w) { return f.load(w).catch(function () { return null; }); }).concat([loadMap()])).then(function () { return f.ready; });
  }
  /* the dark phone poster as a canvas (o.theme, o.layout to draw another; o.qr: the QR matrix) -> {canvas, layout} */
  function posterCanvas(spec, doc, o) {
    o = o || {};
    var th = o.theme || 'dark', lay = o.layout || 'phone', probe = SK().canvas(doc, 10, 10).getContext('2d');
    var r = poster(spec, probe, th, lay, o), c = SK().canvas(doc, r.W, r.H);
    paintOps(c.getContext('2d'), r);
    return { canvas: c, layout: r };
  }
  /* the print poster sheet: the SVG alone on the page (the sheet's class picks 11 x 17 or Letter) */
  function posterSheetHtml(svg) { return '<div class="igp-page">' + svg + '</div>'; }
  /* the paper poster as SVG (o.theme, o.layout) -> {svg, layout} */
  function posterSvg(spec, doc, o) {
    o = o || {};
    var th = o.theme || 'paper', lay = o.layout || 'print', probe = SK().canvas(doc, 10, 10).getContext('2d');
    var r = poster(spec, probe, th, lay, o);
    return { svg: opsSvg(r, spec.title + '. Friday Chart, Infographic of the Week, ' + SK().mdy(spec.date)), layout: r };
  }

  var api = { PHONE: PHONE, LINK: LINK, picture: picture, sheetHtml: sheetHtml, srcLine: srcLine, pageUrl: pageUrl, tagged: tagged, bigText: bigText,
    THEMES: THEMES, LAYOUTS: LAYOUTS, poster: poster, posterCanvas: posterCanvas, posterSvg: posterSvg, posterFonts: posterFonts, loadMap: loadMap, setMap: setMap, posterSheetHtml: posterSheetHtml };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgInfographic = api;

  /* ---------------------------------------------------------------- the page */
  var doc = root.document, el = doc && doc.getElementById('ig-spec');
  if (!el) return;
  var SPEC = null;
  try { SPEC = JSON.parse(el.textContent); } catch (e) { SPEC = null; }
  if (!SPEC || !SPEC.chart) return;
  var K = root.AgShareKit, tools = doc.getElementById('ig-tools'), st = doc.getElementById('ig-st');
  if (!K || !tools) return;           /* no share kit: the buttons stay hidden; the page is whole without them */
  tools.hidden = false;
  function say(words) { if (st) st.textContent = words; }
  function matrix(u) { try { return root.AgQR ? root.AgQR.matrix(u, null, null, 10) : null; } catch (e) { return null; } }
  function qrSvg(u) { try { return root.AgQR ? root.AgQR.svg(u, 'QR code to ' + shown(SPEC), 10) : ''; } catch (e) { return ''; } }
  function build() {
    var s = K.sheet(doc, 'igs', 'igs');
    s.innerHTML = sheetHtml(SPEC, qrSvg(tagged(SPEC, 'print', 'qr')));
    var r = K.measure(s, function () { return s.offsetHeight / (10 * 96 - 8); });
    s.style.zoom = r > 1 ? String(Math.floor(100 / r) / 100) : '';
    s.setAttribute('data-fit', r > 1 ? '0' : '1');
    api.lastSheet = { ratio: r };
    return s;
  }
  api.build = build;
  var HTML = doc.documentElement.classList;
  /* any browser print shows the one-page sheet, unless the poster's own Print button started it */
  function on() { if (HTML.contains('igp-on')) return; if (!HTML.contains('igs-on')) { build(); K.show(doc, 'igs-on', true); } K.ga(K.EV.print, { page: campaign(SPEC) }); }
  function off() { K.show(doc, 'igs-on', false); HTML.remove('igp-on'); }
  K.printHook(root, on, off);
  var pb = doc.getElementById('ig-print');
  if (pb) pb.addEventListener('click', function (e) { e.preventDefault(); build(); K.show(doc, 'igs-on', true); K.printNow(root, off); });
  /* hand the picture to the phone's share sheet, else save it */
  function deliver(canvas, name, kind) {
    canvas.toBlob(function (blob) {
      if (!blob) { say('Could not draw the picture here.'); return; }
      var f = K.file(blob, name);
      function saved() { K.download(doc, blob, name); K.ga(K.EV.download, { page: campaign(SPEC), kind: kind }); say('Picture saved.'); }
      if (K.canShareFile(root, f)) { K.share(root, { files: [f], title: SPEC.title, text: tagged(SPEC, 'share', 'picture') }, function () { K.ga(K.EV.done, { page: campaign(SPEC) }); }, saved); return; }
      saved();
    }, 'image/png');
  }
  function save(shape) {
    var ready = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
    K.ga(K.EV.open, { page: campaign(SPEC), kind: shape });
    ready.then(function () {
      var im = picture(SPEC, doc, shape, { qr: shape === 'phone' ? matrix(tagged(SPEC, 'share', 'qr')) : null });
      api.lastImage = { shape: shape, w: im.w, h: im.h, texts: im.texts, sizes: im.sizes };
      deliver(im.canvas, 'agsist-infographic-' + SPEC.date + (shape === 'link' ? '-wide' : '') + '.png', shape);
    });
  }
  /* the Friday Chart poster: dark to save or share, paper to print (11 x 17, or Letter) */
  var hasPoster = !!(SPEC.poster && SPEC.poster.panels && SPEC.poster.panels.length && root.Path2D);
  function savePoster() {
    K.ga(K.EV.open, { page: campaign(SPEC), kind: 'poster' });
    say('Drawing the poster...');
    return posterFonts(doc, 'dark').then(function () {
      var r = posterCanvas(SPEC, doc, { qr: matrix(tagged(SPEC, 'share', 'qr')) });
      api.lastPoster = { kind: 'dark', w: r.layout.W, h: r.layout.H, fits: r.layout.fits };
      deliver(r.canvas, 'agsist-friday-chart-' + SPEC.date + '.png', 'poster');
      return r;
    });
  }
  function buildPoster(size) {
    return posterFonts(doc, 'paper').then(function () {
      var s = K.sheet(doc, 'igp', 'igp'), r = posterSvg(SPEC, doc, { qr: matrix(tagged(SPEC, 'print', 'qr')) });
      s.className = 'igp sk-sheet igp-' + (size === 'letter' ? 'letter' : '17');
      s.innerHTML = posterSheetHtml(r.svg);
      api.lastPoster = { kind: 'paper', size: size, w: r.layout.W, h: r.layout.H, fits: r.layout.fits };
      return s;
    });
  }
  api.buildPoster = buildPoster;
  api.savePoster = savePoster;
  function printPoster(size) {
    say('Making the poster...');
    buildPoster(size).then(function () {
      K.show(doc, 'igs-on', false); K.show(doc, 'igp-on', true);
      K.ga(K.EV.print, { page: campaign(SPEC), kind: 'poster-' + size });
      say('');
      K.printNow(root, off);
    }, function () { say('Could not make the poster here.'); });
  }
  ['ig-poster', 'ig-poster-17', 'ig-poster-letter'].forEach(function (id) {
    var b = doc.getElementById(id);
    if (!b) return;
    if (!hasPoster) { b.hidden = true; return; }
    b.addEventListener('click', function (e) {
      e.preventDefault();
      if (id === 'ig-poster') savePoster(); else printPoster(id === 'ig-poster-letter' ? 'letter' : '17');
    });
  });
  var ph = doc.getElementById('ig-pic'), lk = doc.getElementById('ig-wide'), cp = doc.getElementById('ig-link');
  if (ph) ph.addEventListener('click', function () { save('phone'); });
  if (lk) lk.addEventListener('click', function () { save('link'); });
  if (cp) cp.addEventListener('click', function () {
    var u = tagged(SPEC, 'share', 'link');
    K.copy(root, u, function () { say('Link copied.'); }, function () { if (!K.execCopy(doc, u)) root.prompt('Copy this link', u); else say('Link copied.'); });
  });
})(typeof window !== 'undefined' ? window : this);
