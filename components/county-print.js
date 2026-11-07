/* County Print (Sig, Nov 7, 2026: "County print, yes"): one printable, shareable page for every Farmland Atlas
   county, in the family of the COT kit and Bin Print: the gold bar, agsist.com, the date with its year, a plain
   headline, the numbers big, one chart, the source line, black and white on paper, a QR code back to the county.

   NOTHING HERE WORKS OUT A FIGURE. The yearly figures come from the page itself (<script id="cp-data">, written
   by scripts/build_atlas_pages.py county_print_data() through the same formatters as the tiles and cards), the
   daily rows from the rows county-home.js draws (window.AgCountyFacts, 'county:fact'), so the sheet can never
   disagree with the page. A figure the page does not have is left out: no "n/a" rows, no guesses. The trend line
   on the chart is the page's own yearly trend (its slope through the middle of the published years, which is the
   least-squares line the page states).

   The sheet: US Letter portrait, fits A4 (measured at A4's printed width against Letter's printed height; a long
   county gets a shorter chart, then tighter spacing, and only past that is the whole sheet scaled). Six blocks:
   land, rent, crops, grain, weather, risk; the corn yield chart with its trend; the QR code ("Scan for this
   county's live page") and the address; the source line and "Not advice". Ctrl+P (beforeprint) prints it too.
   The picture: 1080 x 1350 for a phone, the four biggest numbers and the chart. Links: the county page with
   utm_source print|share, utm_medium qr|picture|link, utm_campaign county-<fips>.

   No names: no buyer, seller or elevator is named anywhere on the sheet or the picture, and a reader's own field
   name (county-home.js measures from it when this device has one) is printed as "your saved field".
   Exports window.AgCountyPrint (module.exports for the tests: sheet, html, chartModel, chartItems, toSvg, link). */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var NASS_NOTICE = 'This product uses the NASS API but is not endorsed or certified by NASS.';
  var CALC = 'Averages, trends and ratios are calculations by AGSIST.';
  var QR_CAP = 'Scan for this county’s live page';
  var CSS = '/components/county-print.css?v=1', QR_JS = '/components/qr.js?v=11';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mdy(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : ''; }
  /* the printed date, in the Central time the site's day runs on: "November 7, 2026" */
  function dateLine(now) {
    var d = new Date(now == null ? Date.now() : now), iso;
    try { iso = d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); } catch (e) { iso = d.toISOString().slice(0, 10); }
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
  }
  /* the county page with the kit's tags: (https://agsist.com/farmland-atlas/iowa/story-county, 'print', 'qr', '19169') */
  function link(url, src, med, fips) {
    return url + '?utm_source=' + src + '&utm_medium=' + med + '&utm_campaign=county-' + fips;
  }
  /* sentences of a live row's context, first n */
  function sentences(s, n) {
    var parts = String(s || '').match(/[^.]+(?:\.(?!\d)[^.]*)*?(?:\.(?=\s|$)|$)/g) || [];
    return parts.map(function (x) { return x.trim(); }).filter(Boolean).slice(0, n).join(' ');
  }
  /* a reader's own field name never goes on paper or a picture */
  function noNames(s) { return String(s || '').replace(/your field “[^”]*”/g, 'your saved field'); }

  /* ---------------------------------------------------------------- the sheet, as data
     cp: the page's yearly figures (cp-data). live: {key: row} as county-home.js drew them. c: {name, state, url,
     fips, now}. -> {title, blocks: [{key, h, rows: [{big, unit, text, size}]}], big4, chart, qr, url, src, notice} */
  function liveRow(f) { return f && f.value != null && !f.partial ? f : null; }
  function sheet(cp, live, c) {
    cp = cp || {}; live = live || {};
    var src = [], blocks = [], nass = false;
    function credit(s) { if (s && src.indexOf(s) < 0) src.push(s); if (/NASS/.test(s || '')) nass = true; }
    function block(key, h, rows) { rows = rows.filter(Boolean); if (rows.length) blocks.push({ key: key, h: h, rows: rows }); }
    function lv(k, label, n, size) {
      var f = liveRow(live[k]);
      if (!f) return null;
      credit(f.paper || (f.src && f.src[0]));
      var d = mdy(f.date) || f.date || '';
      return { big: f.value, cred: f.paper || (f.src && f.src[0]), text: noNames(label + (d ? ', ' + d : '') + (f.ctx && n ? '. ' + sentences(f.ctx, n) : '')).replace(/\.\./g, '.'), size: size, live: k };
    }
    var st = c.state || '';
    /* 1. land */
    var land = [];
    if (cp.v) { credit('USDA NASS Census of Agriculture'); land.push({ big: cp.v[0], unit: '/ac', text: 'Land and buildings, ' + cp.v[1] + ' census: operators’ own estimate, not a sale price' + (cp.v[2] ? '; ' + cp.v[2] : '') + '.' }); }
    if (cp.ss) { credit('USDA NASS Land Values'); land.push({ big: cp.ss[0], unit: '/ac', text: st + ' farm real estate, ' + cp.ss[1] + ' state survey: land and buildings, state average.' }); }
    if (cp.sl) { credit('recorded deeds (' + cp.sl[3] + ')'); land.push({ big: cp.sl[1], unit: '/ac', text: 'Median of ' + cp.sl[0] + ' recorded bare farmland sale' + (cp.sl[0] === 1 ? '' : 's') + ', ' + cp.sl[2] + '. No buyer or seller named.' }); }
    block('land', 'Land', land);
    /* 2. rent */
    var rent = [];
    if (cp.r) { credit('USDA NASS Cash Rents Survey'); rent.push({ big: cp.r[0], unit: '/ac', text: (cp.r[2] === 'irr' ? 'Irrigated' : 'Non-irrigated') + ' cash rent, ' + cp.r[1] + ' county average.' }); }
    if (cp.rb && cp.yt && cp.r) rent.push({ big: cp.rb, unit: '/bu', text: 'Rent per bushel: ' + cp.r[0] + ' ÷ ' + cp.yt[0] + ' bu, the corn ' + cp.yt[1] + '.' });
    block('rent', 'Rent', rent);
    /* 3. crops */
    var crops = [];
    if (cp.yt) { credit('USDA NASS county yields'); crops.push({ big: cp.yt[0], unit: ' bu/ac', text: 'Corn, ' + cp.yt[1] + (cp.yt[2] ? ', ' + cp.yt[2] : '') + '.' }); }
    if (cp.yl) { credit('USDA NASS county yields'); crops.push({ big: cp.yl[1], unit: ' bu/ac', text: 'Corn, ' + cp.yl[0] + ' county yield, all practices.' }); }
    block('crops', 'Crops', crops);
    /* 4. grain: today's rows, as the page drew them */
    block('grain', 'Grain', [lv('corn-bid', 'Best corn bid within 50 mi', 2), lv('soy-bid', 'Best soybean bid within 50 mi', 1),
      lv('corn-basis', 'Corn basis', 3), lv('soy-basis', 'Soybean basis', 0)]);
    /* 5. weather */
    var wx = [lv('rain', 'Rain since Jan 1', 1), lv('drought', 'Drought this week', 1), lv('hail', 'Hail reports, last 30 days', 2)];
    if (cp.hd) { credit('NOAA Storm Events'); wx.push({ big: cp.hd[0], unit: ' a year', text: 'Days with hail 1 inch or larger, reports ' + cp.hd[1] + '; a zero is no report, not proof of no hail.' }); }
    block('weather', 'Weather', wx);
    /* 6. risk */
    var risk = [];
    if (cp.lr) { credit('USDA RMA'); risk.push({ big: cp.lr[0], text: 'Crop insurance loss ratio, ' + cp.lr[1] + ': claims ÷ total premium, ' + cp.lr[2] + ' paid.' }); }
    if (cp.ov) risk.push({ big: cp.ov[0] + ' of ' + cp.ov[1], text: 'Crop years claims exceeded premium.' });
    if (cp.cc) { credit('USDA RMA'); risk.push({ big: cp.cc[0], text: 'Claims paid per $100 of coverage, ' + cp.cc[1] + '.' }); }
    if (cp.lc) { credit('USDA RMA'); risk.push({ text: 'Largest causes of loss, ' + cp.lc[1] + ': ' + cp.lc[0] + ', share of dollars paid.' }); }
    block('risk', 'Risk', risk);
    var m = chartModel(cp);
    if (m) credit('USDA NASS county yields');
    /* the four biggest numbers for the picture: land, rent, corn, then today's corn bid or the loss ratio */
    var big4 = [], pick = function (b, k) { var r = b && b.rows.filter(function (x) { return x.big; })[0]; if (r && big4.length < 4) big4.push({ key: k, big: r.big + (r.unit && r.unit.charAt(0) === '/' ? r.unit : ''), text: r.text, cred: r.cred }); };
    var by = {}; blocks.forEach(function (b) { by[b.key] = b; });
    pick(by.land, 'land'); pick(by.rent, 'rent'); pick(by.crops, 'crops');
    if (by.grain && by.grain.rows[0].live === 'corn-bid') pick(by.grain, 'grain'); else pick(by.risk, 'risk');
    if (big4.length < 4) pick(by.weather, 'weather');
    /* the picture's source line: the sources of what it shows (the four numbers and the chart), short */
    var pic = [];
    big4.forEach(function (b) { var k = { land: 'USDA NASS', rent: 'USDA NASS', crops: 'USDA NASS', risk: 'USDA RMA' }[b.key] || b.cred; if (k && pic.indexOf(k) < 0) pic.push(k); });
    if (m && pic.indexOf('USDA NASS') < 0) pic.push('USDA NASS');
    var picSrc = 'Sources: ' + (pic.join('; ') || 'public records') + '. ' + (pic.indexOf('USDA NASS') >= 0 ? NASS_NOTICE : '');
    var title = (c.name || 'This county') + (st ? ', ' + st : '') + ': County Print, ' + dateLine(c.now);
    var srcLine = 'Sources: ' + (src.length ? src.join('; ') : 'public records') + '. ' + (nass ? NASS_NOTICE + ' ' : '') + CALC;
    return { title: title, name: c.name, state: st, date: dateLine(c.now), blocks: blocks, big4: big4, chart: m,
      url: c.url, shown: String(c.url || '').replace(/^https?:\/\//, ''), qr: link(c.url, 'print', 'qr', c.fips), pic: link(c.url, 'share', 'picture', c.fips),
      src: srcLine, picSrc: picSrc.trim(), notice: 'Not advice and not an appraisal of any farm. County figures from public records, each with its year; today’s rows are as of the date shown. Bids are posted prices, not a contract: call before you haul.' };
  }

  /* ---------------------------------------------------------------- the chart
     The county corn yield by year (the page's own bars) with the page's yearly trend. -> model or null */
  function chartModel(cp) {
    if (!cp || !cp.y) return null;
    var y0 = cp.y[0], vals = String(cp.y[1]).split(','), pts = [];
    vals.forEach(function (v, i) { if (v !== '') pts.push({ yr: y0 + i, v: +v, s: v }); });
    if (pts.length < 3) return null;
    var hi = pts[0], lo = pts[0];
    pts.forEach(function (p) { if (p.v > hi.v) hi = p; if (p.v < lo.v) lo = p; });
    var m = { y0: y0, y1: y0 + vals.length - 1, pts: pts, hi: hi, lo: lo, trend: null };
    if (cp.ys) {
      var mx = 0, my = 0;
      pts.forEach(function (p) { mx += p.yr; my += p.v; });
      mx /= pts.length; my /= pts.length;
      m.trend = { slope: +cp.ys[0], words: cp.ys[1], window: cp.ys[2], at: function (yr) { return my + this.slope * (yr - mx); } };
    }
    return m;
  }
  function niceStep(max, n) {
    var steps = [10, 20, 25, 50, 100, 200];
    for (var i = 0; i < steps.length; i++) if (max / steps[i] <= n) return steps[i];
    return steps[steps.length - 1];
  }
  /* -> {items, w, h}: bars, the trend line, round y ticks from 0, the years under the bars (the last one bold),
     the high and the low labelled with their year. inks are named, painted by toSvg (paper) or paint (picture). */
  function chartItems(m, W, H, fs) {
    var items = [], tw = function (s) { return String(s).length * fs * 0.56; };
    var top = m.trend ? Math.max(m.hi.v, m.trend.at(m.y0), m.trend.at(m.y1)) : m.hi.v;
    var step = niceStep(top * 1.12, 4), yMax = Math.ceil(top * 1.12 / step) * step;
    var L = tw(String(yMax)) + fs * 0.6, T = fs * 1.6, B = H - fs * 1.9, R = W - fs * 0.4, n = m.y1 - m.y0 + 1;
    var slot = (R - L) / n, bw = Math.max(2, slot * 0.68);
    function X(yr) { return L + (yr - m.y0 + 0.5) * slot; }
    function Y(v) { return B - (v / yMax) * (B - T); }
    for (var t = 0; t <= yMax + 1e-9; t += step) {
      items.push({ t: 'line', pts: [[L, Y(t)], [R, Y(t)]], ink: t ? 'grid' : 'axis', width: t ? 1 : 1.5 });
      items.push({ t: 'text', x: L - fs * 0.3, y: Y(t), s: String(t), ink: 'muted', size: fs * 0.9, align: 'right', base: 'middle' });
    }
    m.pts.forEach(function (p) {
      var key = p === m.hi || p === m.lo;
      items.push({ t: 'rect', x: X(p.yr) - bw / 2, y: Y(p.v), w: bw, h: B - Y(p.v), ink: key ? 'barKey' : 'bar' });
    });
    /* years: every k-th, so labels never touch; the last year always, bold */
    var k = [1, 2, 3, 5, 10].filter(function (k) { return slot * k >= tw('2000') * 1.35; })[0] || 10, lastX = X(m.y1);
    for (var yr = m.y1; yr >= m.y0; yr -= k) {
      var x = X(yr);
      if (yr !== m.y1 && lastX - x < tw('2000') * 1.2) continue;
      items.push({ t: 'text', x: x, y: B + fs * 0.35, s: String(yr), ink: yr === m.y1 ? 'text' : 'muted', size: fs, weight: yr === m.y1 ? 700 : 400, align: 'center', base: 'top' });
    }
    if (m.trend) items.push({ t: 'line', pts: [[X(m.y0), Y(m.trend.at(m.y0))], [X(m.y1), Y(m.trend.at(m.y1))]], ink: 'trend', width: Math.max(2.5, fs * 0.2) });
    /* the high and the low, each over its own bar, kept inside the plot */
    [[m.hi, 'High '], [m.lo, 'Low ']].forEach(function (a) {
      var p = a[0], s = a[1] + p.yr + ': ' + p.s, w = tw(s) * 1.02, x = Math.min(Math.max(X(p.yr), L + w / 2), R - w / 2);
      items.push({ t: 'text', x: x, y: Y(p.v) - fs * 0.35, s: s, ink: 'text', size: fs, weight: 800, align: 'center', base: 'bottom', halo: true });
    });
    return { items: items, w: W, h: H };
  }
  var PAPER = { bar: '#c9c9c9', barKey: '#6e6e6e', trend: '#8a6514', grid: '#dddddd', axis: '#000', text: '#000', muted: '#333', surface: '#fff' };
  var DARK = { bar: 'rgba(233,237,235,.30)', barKey: 'rgba(233,237,235,.62)', trend: '#d4a23f', grid: 'rgba(233,237,235,.14)', axis: 'rgba(233,237,235,.5)', text: '#e9edeb', muted: 'rgba(233,237,235,.78)', surface: '#0a0c0d' };
  var FONT = "Inter, 'Inter Fallback', system-ui, sans-serif";
  function r1(v) { return Math.round(v * 10) / 10; }
  function toSvg(g, label) {
    var s = '';
    g.items.forEach(function (it) {
      if (it.t === 'rect') s += '<rect x="' + r1(it.x) + '" y="' + r1(it.y) + '" width="' + r1(it.w) + '" height="' + r1(it.h) + '" fill="' + PAPER[it.ink] + '"/>';
      else if (it.t === 'line') s += '<path d="M' + it.pts.map(function (p) { return r1(p[0]) + ' ' + r1(p[1]); }).join('L') + '" stroke="' + PAPER[it.ink] + '" stroke-width="' + it.width + '" fill="none"/>';
      else {
        var a = it.align === 'right' ? 'end' : it.align === 'center' ? 'middle' : 'start', b = it.base === 'top' ? 'hanging' : it.base === 'middle' ? 'central' : 'auto';
        s += '<text x="' + r1(it.x) + '" y="' + r1(it.y) + '" font-size="' + r1(it.size) + '" font-weight="' + (it.weight || 400) + '" text-anchor="' + a + '" dominant-baseline="' + b + '" fill="' + PAPER[it.ink] + '"'
          + (it.halo ? ' stroke="#fff" stroke-width="4" paint-order="stroke"' : '') + '>' + esc(it.s) + '</text>';
      }
    });
    return '<svg viewBox="0 0 ' + g.w + ' ' + g.h + '" role="img" aria-label="' + esc(label) + '" xmlns="http://www.w3.org/2000/svg" font-family="Inter, system-ui, Arial, sans-serif">' + s + '</svg>';
  }
  function paint(ctx, g, ox, oy) {
    ctx.save(); ctx.translate(ox, oy);
    g.items.forEach(function (it) {
      if (it.t === 'rect') { ctx.fillStyle = DARK[it.ink]; ctx.fillRect(it.x, it.y, it.w, it.h); }
      else if (it.t === 'line') { ctx.strokeStyle = DARK[it.ink]; ctx.lineWidth = it.width; ctx.beginPath(); it.pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.stroke(); }
      else {
        ctx.font = (it.weight || 400) + ' ' + it.size + 'px ' + FONT; ctx.textAlign = it.align || 'left';
        ctx.textBaseline = it.base === 'top' ? 'top' : it.base === 'middle' ? 'middle' : 'alphabetic';
        if (it.halo) { ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.strokeStyle = DARK.surface; ctx.strokeText(it.s, it.x, it.y); }
        ctx.fillStyle = DARK[it.ink]; ctx.fillText(it.s, it.x, it.y);
      }
    });
    ctx.restore();
  }
  function chartLabel(s) { return (s.name || 'County') + ' corn yield by year, bushels per acre' + (s.chart && s.chart.trend ? ', with the ' + s.chart.trend.window + ' trend' : ''); }
  function chartCaption(s) {
    var m = s.chart;
    return 'Corn yield, ' + (s.name || 'the county') + ', bushels per acre, all practices, each published year ' + m.y0 + '–' + m.y1 + '.'
      + (m.trend ? ' Gold line: the ' + m.trend.window + ' trend, ' + m.trend.words + ' bu/ac a year.' : '');
  }

  /* ---------------------------------------------------------------- the sheet, as HTML */
  function html(s, qr, chartH) {
    if (!s) return '';
    var grid = s.blocks.map(function (b) {
      return '<section class="cprs-b cprs-' + b.key + '"><h2 class="cprs-h">' + esc(b.h) + '</h2>' + b.rows.map(function (r, i) {
        return '<div class="cprs-r' + (i ? '' : ' cprs-lead') + (r.big ? '' : ' cprs-t') + '">' + (r.big ? '<b>' + esc(r.big) + (r.unit ? '<small>' + esc(r.unit) + '</small>' : '') + '</b>' : '')
          + '<span>' + esc(r.text) + '</span></div>';
      }).join('') + '</section>';
    }).join('');
    var chart = s.chart ? '<figure class="cprs-chart">' + toSvg(chartItems(s.chart, 560, chartH || 230, 15), chartLabel(s)) + '<figcaption>' + esc(chartCaption(s)) + '</figcaption></figure>' : '<div></div>';
    return '<div class="cprs-bar"></div><header class="cprs-top"><div><h1 class="cprs-h1">' + esc(s.title) + '</h1>'
      + '<p class="cprs-sub">One county on one page: land, rent, crops, grain, weather and risk.</p></div>'
      + '<div class="cprs-brand"><img class="cprs-logo" src="/img/logo-agsist-onlight.svg" alt="AGSIST" width="86" height="40"><p class="cprs-url">agsist.com</p></div></header>'
      + '<div class="cprs-grid">' + grid + '</div>'
      + '<div class="cprs-low">' + chart + '<aside class="cprs-side">' + (qr ? '<div class="cprs-qr">' + qr + '</div>' : '')
      + '<p class="cprs-scan">' + esc(QR_CAP) + '</p><p class="cprs-addr">' + esc(s.shown) + '</p></aside></div>'
      + '<p class="cprs-src">' + esc(s.src) + '</p><p class="cprs-na">' + esc(s.notice) + '</p>';
  }

  /* ---------------------------------------------------------------- the picture
     1080 x 1350, the dark card: agsist.com, the county, the date, the four biggest numbers, the chart, the QR code
     and the source. Every word 26 px or more but the one 20 px source line. o.qr: the QR matrix (AgQR.matrix of
     s.pic) or null. -> {canvas, texts, sizes} */
  function image(s, doc, o) {
    o = o || {};
    var W = 1080, H = 1350, P = 60, c = doc.createElement('canvas'); c.width = W; c.height = H;
    var ctx = c.getContext('2d'), texts = [], sizes = [];
    var INK = '#e9edeb', DIM = 'rgba(233,237,235,.82)', GOLD = '#d4a23f';
    function wrap(t, max) { var out = [], cur = ''; String(t).split(' ').forEach(function (w) { var x = cur ? cur + ' ' + w : w; if (ctx.measureText(x).width > max && cur) { out.push(cur); cur = w; } else cur = x; }); if (cur) out.push(cur); return out; }
    function text(t, x, y, size, weight, ink, al) { ctx.font = weight + ' ' + size + 'px ' + FONT; ctx.fillStyle = ink; ctx.textAlign = al || 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(t, x, y); texts.push(t); sizes.push(size); }
    function lines(t, x, y, size, weight, ink, lh, max, width) { ctx.font = weight + ' ' + size + 'px ' + FONT; wrap(t, width).slice(0, max).forEach(function (l) { text(l, x, y, size, weight, ink); y += lh; }); return y; }
    function fit(t, size, min, weight, width) { ctx.font = weight + ' ' + size + 'px ' + FONT; while (size > min && ctx.measureText(t).width > width) { size -= 2; ctx.font = weight + ' ' + size + 'px ' + FONT; } return size; }
    ctx.fillStyle = '#0a0c0d'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = GOLD; ctx.fillRect(0, 0, W, 12);
    text('agsist.com', P, 84, 36, 800, GOLD);
    text('County Print, ' + s.date, P, 132, 28, 600, DIM);
    var y = lines((s.name || '') + (s.state ? ', ' + s.state : ''), P, 214, 60, 800, INK, 70, 2, W - 2 * P) + 4;
    /* the four numbers, two by two; the second row starts under the taller of the first two */
    var cw = (W - 2 * P - 40) / 2, top = y, bottom = y;
    s.big4.forEach(function (b, i) {
      if (i === 2) top = bottom;
      var x = P + (i % 2) * (cw + 40), sz = fit(b.big, 60, 40, 800, cw);
      text(b.big, x, top + 56, sz, 800, INK);
      bottom = Math.max(bottom, lines(b.text.replace(/\.$/, ''), x, top + 94, 26, 500, DIM, 32, 2, cw) + 14);
    });
    /* the footer: the QR code at the right, its words and the source at the left */
    var m = o.qr, qn = m ? m.length + 8 : 0, mod = m ? Math.max(3, Math.floor(220 / qn)) : 0, qs = qn * mod;
    var LW = W - 2 * P - (m ? qs + 30 : 0), srcL;
    ctx.font = '400 20px ' + FONT; srcL = wrap(s.picSrc, LW).slice(0, 4);
    var foot = H - 40 - (srcL.length - 1) * 26;           /* the source line's first baseline */
    var addrSz = fit(s.shown, 26, 20, 700, LW), capY = foot - 30 - addrSz - 12 - 34;
    if (s.chart) {
      var capTxt = 'Corn yield by year, bu/ac' + (s.chart.trend ? '. Gold line: trend ' + s.chart.trend.window + ', ' + s.chart.trend.words + ' bu/ac a year' : '');
      var gTop = bottom + 4, footTop = Math.min(capY - 36, m ? H - 40 - qs : 1e9) - 24, gh = footTop - (gTop + 44);
      text(capTxt, P, gTop + 26, fit(capTxt, 26, 20, 600, W - 2 * P), 600, DIM);
      if (gh >= 200) {
        var g = chartItems(s.chart, W - 2 * P, gh, 26);
        paint(ctx, g, P, gTop + 44);
        g.items.forEach(function (it) { if (it.t === 'text') { texts.push(it.s); sizes.push(it.size); } });
      }
    }
    if (m) {
      var qx = W - P - qs, qy = H - 40 - qs;
      ctx.fillStyle = '#fff'; ctx.fillRect(qx, qy, qs, qs); ctx.fillStyle = '#000';
      m.forEach(function (row, r) { row.forEach(function (v, k) { if (v) ctx.fillRect(qx + (k + 4) * mod, qy + (r + 4) * mod, mod, mod); }); });
      text(QR_CAP, P, capY, 28, 700, GOLD);
    }
    text(s.shown, P, capY + 12 + addrSz + 4, addrSz, 700, INK);
    srcL.forEach(function (l, i) { text(l, P, foot + i * 26, 20, 400, DIM); });
    return { canvas: c, texts: texts, sizes: sizes };
  }

  var api = { sheet: sheet, html: html, image: image, chartModel: chartModel, chartItems: chartItems, toSvg: toSvg, link: link, dateLine: dateLine,
    sentences: sentences, noNames: noNames, QR_CAP: QR_CAP, PAPER: PAPER };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgCountyPrint = api;

  /* ---------------------------------------------------------------- the page */
  var doc = root.document, dataEl = doc && doc.getElementById('cp-data');
  if (!dataEl) return;
  var CP = {};
  try { CP = JSON.parse(dataEl.textContent) || {}; } catch (e) { CP = {}; }
  var live = doc.getElementById('ch-live'), canon = doc.querySelector('link[rel="canonical"]'), h1 = doc.querySelector('main h1');
  var FIPS = (live && live.getAttribute('data-fips')) || '', URL_ = canon ? canon.href : root.location.origin + root.location.pathname;
  var parts = h1 ? h1.textContent.split(', ') : [], NAME = parts.length > 1 ? parts.slice(0, -1).join(', ') : (parts[0] || ''), STATE = parts.length > 1 ? parts[parts.length - 1] : '';
  var MAX_PX = 10.2 * 96 - 8, $ = function (id) { return doc.getElementById(id); };
  function ga(n, p) { try { if (typeof root.gtag === 'function') root.gtag('event', n, p); } catch (e) {} }
  function load(tag, attrs) { var el = doc.createElement(tag); Object.keys(attrs).forEach(function (k) { el[k] = attrs[k]; }); doc.head.appendChild(el); return el; }
  if (!doc.querySelector('link[href^="/components/county-print.css"]')) load('link', { rel: 'stylesheet', href: CSS });
  if (!root.AgQR) load('script', { src: QR_JS, async: true }).onload = function () { soon(); };
  function current() { return sheet(CP, root.AgCountyFacts || {}, { name: NAME, state: STATE, url: URL_, fips: FIPS, now: Date.now() }); }
  function qrSvg(s) { try { return root.AgQR ? root.AgQR.svg(s.qr, QR_CAP + ': ' + s.shown, 10) : ''; } catch (e) { return ''; } }
  function measure(el) { el.classList.add('cprs-measure'); var h = el.offsetHeight; el.classList.remove('cprs-measure'); return h; }
  /* one page whatever the county carries: a shorter chart, then tighter spacing, then (only past that) scaled */
  function build() {
    var s = current(), el = $('cprs');
    if (!el) { el = doc.createElement('div'); el.id = 'cprs'; el.className = 'cprs'; el.setAttribute('aria-hidden', 'true'); doc.body.appendChild(el); }
    var code = qrSvg(s), fits = false;
    el.style.zoom = '';
    [230, 195, 165].some(function (h, i) {
      el.innerHTML = html(s, code, h);
      el.classList.toggle('cprs-tight', i === 2);
      fits = measure(el) <= MAX_PX;
      return fits;
    });
    if (!fits) { var z = Math.floor(MAX_PX / measure(el) * 100) / 100; el.style.zoom = String(z); el.setAttribute('data-zoom', String(z)); }
    else el.removeAttribute('data-zoom');
    el.setAttribute('data-fit', fits ? '1' : '0');
    api.last = s;
    return el;
  }
  api.build = build;
  api.current = current;
  var t = null;
  function soon() { clearTimeout(t); t = setTimeout(function () { try { build(); } catch (e) {} }, 250); }
  doc.addEventListener('county:fact', soon);
  if (doc.readyState === 'complete') soon(); else root.addEventListener('load', soon);
  /* any browser print (Ctrl+P, the menu, a phone's Print) gives the County Print, the same as the button */
  function on() {
    if (!doc.documentElement.classList.contains('cprs-on')) { build(); doc.documentElement.classList.add('cprs-on'); }
    ga('county_print', { kind: 'sheet', fips: FIPS });
  }
  function off() { doc.documentElement.classList.remove('cprs-on'); }
  root.addEventListener('beforeprint', on);
  root.addEventListener('afterprint', off);
  try {
    var mq = root.matchMedia && root.matchMedia('print'), ch = function (e) { if (e.matches) on(); else off(); };
    if (mq && mq.addEventListener) mq.addEventListener('change', ch); else if (mq && mq.addListener) mq.addListener(ch);
  } catch (e) {}
  var stEl = doc.querySelector('.cpr-st');
  function say(btn, words, back) {
    if (stEl) stEl.textContent = words;
    if (btn) { btn.textContent = words.replace(/\.$/, ''); setTimeout(function () { btn.textContent = back; }, 2200); }
  }
  var pb = $('cpr-print');
  if (pb) pb.addEventListener('click', function (e) {
    e.preventDefault();
    build(); doc.documentElement.classList.add('cprs-on');
    try { root.print(); } catch (x) { off(); }
  });
  function coarse() { return !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches); }
  function download(blob, name) {
    var a = doc.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = name; doc.body.appendChild(a); a.click(); doc.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }
  var pic = $('cpr-pic');
  if (pic) pic.addEventListener('click', function () {
    var ready = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
    ready.then(function () {
      var s = current(), m = null;
      try { m = root.AgQR ? root.AgQR.matrix(s.pic, null, null, 10) : null; } catch (e) { m = null; }
      var im = image(s, doc, { qr: m });
      api.lastImage = { w: im.canvas.width, h: im.canvas.height, texts: im.texts, sizes: im.sizes, qr: m ? s.pic : null };
      im.canvas.toBlob(function (blob) {
        if (!blob) { say(pic, 'Could not draw the picture here.', 'Save picture'); return; }
        var name = 'agsist-county-print-' + FIPS + '.png', file = null;
        ga('county_print', { kind: 'picture', fips: FIPS });
        try { file = new File([blob], name, { type: 'image/png' }); } catch (e) {}
        if (file && coarse() && root.navigator.canShare && root.navigator.canShare({ files: [file] })) {
          root.navigator.share({ files: [file], title: s.title, text: s.pic }).catch(function (e) { if (!e || e.name !== 'AbortError') { download(blob, name); say(pic, 'Picture saved.', 'Save picture'); } });
          return;
        }
        download(blob, name); say(pic, 'Picture saved.', 'Save picture');
      }, 'image/png');
    });
  });
  var lb = $('cpr-link');
  if (lb) lb.addEventListener('click', function () {
    var u = link(URL_, 'share', 'link', FIPS), nav = root.navigator;
    ga('county_print', { kind: 'link', fips: FIPS });
    function copied() { say(lb, 'Link copied.', 'Copy link'); }
    if (nav.clipboard && nav.clipboard.writeText) nav.clipboard.writeText(u).then(copied, function () { root.prompt('Copy this link', u); });
    else root.prompt('Copy this link', u);
  });
})(typeof window !== 'undefined' ? window : this);
