/* components/infographic.js: the Infographic of the Week, drawn from its spec (data/infographics/<date>.json,
   made by scripts/build_infographic.py from our own data files; the page carries the same spec inline as
   <script type="application/json" id="ig-spec">). Nov 7, 2026.

   Three shapes from one spec, on the share kit core (components/share-kit.js: the dark card, the pen, the QR code,
   the sheet, the print hook, sharing):
   - the phone picture, 1080 x 1350: the hook, the big number, the chart, the facts, the source and a QR code;
   - the link preview picture, 1200 x 630: the hook, the big number and the chart;
   - the one-page print sheet (Letter, fits A4), black on white, with a QR code back to the page.
   Chart types: bars (each row: this year's value as a bar, the 5-year average as a tick) and line (weekly points).
   Fails soft: without share-kit.js the buttons stay hidden and the page (its picture, chart and facts are plain
   HTML) is whole. Every number drawn comes from the spec; nothing is computed here but positions.
   Exports window.AgInfographic (and module.exports for the tests). */
(function (root) {
  'use strict';
  var PHONE = [1080, 1350], LINK = [1200, 630];
  var SITE = 'https://agsist.com';

  function SK() { return root.AgShareKit || (typeof require === 'function' ? require('./share-kit.js') : null); }
  function fmt(n) { return Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function bigText(b) { return (b.value < 0 ? '−' : '') + fmt(b.value); }
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
    function px(i) { return x + 20 + (w - 40) * (pts.length === 1 ? 0.5 : i / (pts.length - 1)); }
    function py(v) { return bot - (bot - top) * (v - lo) / (hi - lo); }
    ctx.strokeStyle = 'rgba(233,237,235,.35)'; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.moveTo(x, py(0)); ctx.lineTo(x + w, py(0)); ctx.stroke(); ctx.setLineDash([]);
    p.text('0', x, py(0) - 8, 20, 600, K.DIM);
    ctx.strokeStyle = K.GOLD; ctx.lineWidth = 6; ctx.beginPath();
    pts.forEach(function (q, i) { if (i) ctx.lineTo(px(i), py(q.y)); else ctx.moveTo(px(i), py(q.y)); }); ctx.stroke();
    pts.forEach(function (q, i) {
      ctx.fillStyle = K.GOLD; ctx.beginPath(); ctx.arc(px(i), py(q.y), 9, 0, Math.PI * 2); ctx.fill();
      p.text(q.label, px(i), bot + 32, fs - 4, 500, K.DIM, i === 0 ? 'left' : i === pts.length - 1 ? 'right' : 'center');
    });
    var f = pts[0], l = pts[pts.length - 1];
    p.text(fmt(f.y), px(0), py(f.y) - 22, fs + 4, 800, K.INK, 'left');
    p.text(fmt(l.y), px(pts.length - 1), py(l.y) - 22, fs + 4, 800, K.INK, 'right');
    return y + h;
  }

  /* ---------------------------------------------------------------- the pictures
     shape 'phone' (1080 x 1350) or 'link' (1200 x 630). o.qr: the QR matrix (AgQR.matrix) or null.
     -> {canvas, texts, sizes, w, h} */
  function picture(spec, doc, shape, o) {
    o = o || {};
    var K = SK(), d = shape === 'link' ? LINK : PHONE, W = d[0], H = d[1], P = 60;
    var c = K.canvas(doc, W, H), ctx = c.getContext('2d'), p = K.pen(ctx);
    K.frame(ctx, W, H, 12);
    K.head(p, P, 'agsist.com', 'Infographic of the Week, ' + K.mdy(spec.date));
    var b = spec.big, big = bigText(b), u = unitText(b), y;
    if (shape === 'link') {
      y = p.lines(spec.title, P, 206, 46, 800, K.INK, 54, 2, 560) + 20;
      var bs = p.fit(big + u, 96, 48, 800, 560);
      p.text(big, P, y + bs * 0.9, bs, 800, K.GOLD);
      ctx.font = '800 ' + bs + 'px ' + K.FONT;
      p.text(u, P + ctx.measureText(big).width + 4, y + bs * 0.9, Math.round(bs * 0.42), 700, K.GOLD);
      p.lines(b.label, P, y + bs + 34, 24, 500, K.DIM, 30, 2, 560);
      var cx = 660, cw = W - cx - P;
      if (spec.chart.type === 'bars') {
        var pan = spec.chart.panels[0];
        p.text(pan.title.replace(/ by state, week ending.*$/, ', this year vs average'), cx, 196, 22, 600, K.DIM);
        paintBars(ctx, p, spec, pan, cx, 214, cw, H - 214 - 60, { maxRows: 8, labelW: 170, valW: 110, font: 24, rowMax: 44 });
      } else paintLine(ctx, p, spec, cx, 170, cw, H - 170 - 60, { font: 22 });
      p.text(srcLine(spec).replace(/ Facts only, not advice\.$/, ''), P, H - 26, p.fit(srcLine(spec), 20, 16, 400, W - 2 * P), 400, K.DIM);
      return { canvas: c, texts: p.texts, sizes: p.sizes, w: W, h: H };
    }
    y = p.lines(spec.title, P, 222, 62, 800, K.INK, 70, 3, W - 2 * P) + 16;
    var bsz = p.fit(big + u, 120, 60, 800, W - 2 * P);
    p.text(big, P, y + bsz * 0.88, bsz, 800, K.GOLD);
    ctx.font = '800 ' + bsz + 'px ' + K.FONT;
    p.text(u, P + ctx.measureText(big).width + 6, y + bsz * 0.88, Math.round(bsz * 0.4), 700, K.GOLD);
    y = p.lines(b.label, P, y + bsz + 30, 28, 500, K.DIM, 34, 2, W - 2 * P) + 10;
    /* the footer first (the QR code and the source), then the chart fills what is left above the facts */
    var m = o.qr, qn = m ? m.length + 8 : 0, mod = m ? Math.max(3, Math.floor(170 / qn)) : 0, qs = qn * mod;
    var LW = W - 2 * P - (m ? qs + 30 : 0);
    ctx.font = '400 20px ' + K.FONT;
    var sl = p.wrap(srcLine(spec), LW).slice(0, 4), footTop = H - 40 - Math.max(qs, sl.length * 26 + 70);
    var facts = (spec.facts || []).slice(0, 3), factH = 0;
    ctx.font = '500 26px ' + K.FONT;
    facts.forEach(function (f) { factH += Math.min(2, p.wrap(f.text, W - 2 * P - 30).length) * 32 + 12; });
    var chartTop = y + 6, chartBot = footTop - factH - 30;
    p.text(spec.chart.type === 'bars' ? spec.chart.panels[0].title + ' (bar: ' + spec.chart.series[0] + ', tick: ' + spec.chart.series[1].toLowerCase() + ')' : spec.chart.title,
      P, chartTop + 26, p.fit(spec.chart.type === 'bars' ? spec.chart.panels[0].title + ' (bar: ' + spec.chart.series[0] + ', tick: ' + spec.chart.series[1].toLowerCase() + ')' : spec.chart.title, 26, 20, 600, W - 2 * P), 600, K.DIM);
    if (spec.chart.type === 'bars') paintBars(ctx, p, spec, spec.chart.panels[0], P, chartTop + 46, W - 2 * P, chartBot - chartTop - 46, { font: 26 });
    else paintLine(ctx, p, spec, P, chartTop + 30, W - 2 * P, chartBot - chartTop - 30, { font: 26 });
    var fy = chartBot + 34;
    facts.forEach(function (f) {
      ctx.fillStyle = K.GOLD; ctx.fillRect(P, fy - 20, 8, 22);
      fy = p.lines(f.text, P + 30, fy, 26, 500, K.INK, 32, 2, W - 2 * P - 30) + 12;
    });
    if (m) K.qr(ctx, m, W - P - qs, H - 40 - qs, mod);
    var ay = H - 40 - (sl.length - 1) * 26 - 34;
    p.text(shown(spec), P, ay, p.fit(shown(spec), 28, 20, 700, LW), 700, K.GOLD);
    sl.forEach(function (l, i) { p.text(l, P, H - 40 - (sl.length - 1 - i) * 26, 20, 400, K.DIM); });
    return { canvas: c, texts: p.texts, sizes: p.sizes, w: W, h: H };
  }

  /* ---------------------------------------------------------------- the print sheet */
  function esc(s) { return SK().esc(s); }
  function barsSvg(spec, panel) {
    var rows = panel.rows, hi = {}, rh = 17, lw = 118, vw = 62, w = 560, bw = w - lw - vw, h = rows.length * rh + 4, out = [];
    (spec.chart.highlight || []).forEach(function (k) { hi[k] = 1; });
    rows.forEach(function (r, i) {
      var y = i * rh + 2, on = hi[r.key], v = Math.max(0, Math.min(100, r.values[0])), a = Math.max(0, Math.min(100, r.values[1]));
      out.push('<text x="0" y="' + (y + 12) + '" font-size="10.5"' + (on ? ' font-weight="800"' : '') + '>' + esc(r.label) + '</text>'
        + '<rect x="' + lw + '" y="' + (y + 3) + '" width="' + bw + '" height="10" fill="#eee"/>'
        + '<rect x="' + lw + '" y="' + (y + 3) + '" width="' + (bw * v / 100).toFixed(1) + '" height="10" fill="' + (on ? '#8a6514' : '#555') + '"/>'
        + '<rect x="' + (lw + bw * a / 100 - 1).toFixed(1) + '" y="' + (y + 0.5) + '" width="2" height="15" fill="#000"/>'
        + '<text x="' + w + '" y="' + (y + 12) + '" font-size="10.5" text-anchor="end"' + (on ? ' font-weight="800"' : '') + '>' + r.values[0] + ' vs ' + r.values[1] + '</text>');
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
    return '<div class="igs-bar"></div><div class="igs-top"><div><p class="igs-kick">AGSIST Infographic of the Week</p><h1 class="igs-h1">' + esc(spec.title) + '</h1>'
      + '<p class="igs-date">' + esc(K.mdy(spec.date)) + '</p></div><p class="igs-url">agsist.com</p></div>'
      + '<div class="igs-big"><b>' + esc(bigText(b)) + '<small>' + esc(unitText(b)) + '</small></b><span>' + esc(b.label) + '</span></div>'
      + '<div class="igs-charts">' + charts + '</div>' + key
      + '<ul class="igs-facts">' + (spec.facts || []).map(function (f) { return '<li>' + esc(f.text) + ' <span>' + esc(f.source) + '.</span></li>'; }).join('') + '</ul>'
      + '<div class="igs-foot"><div><p class="igs-src">' + esc(srcLine(spec)) + '</p><p class="igs-live">Live page: <b>' + esc(shown(spec)) + '</b></p></div>'
      + (qr ? '<div class="igs-qr">' + qr + '<p>Scan for the page</p></div>' : '') + '</div>';
  }

  var api = { PHONE: PHONE, LINK: LINK, picture: picture, sheetHtml: sheetHtml, srcLine: srcLine, pageUrl: pageUrl, tagged: tagged, bigText: bigText };
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
  function on() { if (!doc.documentElement.classList.contains('igs-on')) { build(); K.show(doc, 'igs-on', true); } K.ga(K.EV.print, { page: campaign(SPEC) }); }
  function off() { K.show(doc, 'igs-on', false); }
  K.printHook(root, on, off);
  var pb = doc.getElementById('ig-print');
  if (pb) pb.addEventListener('click', function (e) { e.preventDefault(); build(); K.show(doc, 'igs-on', true); K.printNow(root, off); });
  function save(shape) {
    var ready = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
    K.ga(K.EV.open, { page: campaign(SPEC), kind: shape });
    ready.then(function () {
      var im = picture(SPEC, doc, shape, { qr: shape === 'phone' ? matrix(tagged(SPEC, 'share', 'qr')) : null });
      api.lastImage = { shape: shape, w: im.w, h: im.h, texts: im.texts, sizes: im.sizes };
      im.canvas.toBlob(function (blob) {
        if (!blob) { say('Could not draw the picture here.'); return; }
        var name = 'agsist-infographic-' + SPEC.date + (shape === 'link' ? '-wide' : '') + '.png', f = K.file(blob, name);
        function saved() { K.download(doc, blob, name); K.ga(K.EV.download, { page: campaign(SPEC), kind: shape }); say('Picture saved.'); }
        if (K.canShareFile(root, f)) { K.share(root, { files: [f], title: SPEC.title, text: tagged(SPEC, 'share', 'picture') }, function () { K.ga(K.EV.done, { page: campaign(SPEC) }); }, saved); return; }
        saved();
      }, 'image/png');
    });
  }
  var ph = doc.getElementById('ig-pic'), lk = doc.getElementById('ig-wide'), cp = doc.getElementById('ig-link');
  if (ph) ph.addEventListener('click', function () { save('phone'); });
  if (lk) lk.addEventListener('click', function () { save('link'); });
  if (cp) cp.addEventListener('click', function () {
    var u = tagged(SPEC, 'share', 'link');
    K.copy(root, u, function () { say('Link copied.'); }, function () { if (!K.execCopy(doc, u)) root.prompt('Copy this link', u); else say('Link copied.'); });
  });
})(typeof window !== 'undefined' ? window : this);
