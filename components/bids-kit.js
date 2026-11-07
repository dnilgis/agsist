/* The Bids near kit (share kit wave 1, Nov 7, 2026): on /cash-bids and every cash bid town page, a "Bids near
   <town>" picture (1080 x 1350 for a phone, 1200 x 630 wide) and a one-page town bid sheet (US Letter, fits A4),
   in the family of the COT kit and County Print: the gold bar, agsist.com, the date with its year, the top 5 corn
   and the top 5 soybean bids, each with its elevator, town, cash price, basis and the time it was posted, and a QR
   code back to the page.

   NOTHING HERE WORKS OUT A PRICE. On a town page the rows come from the page itself (<script id="skb-data">,
   written by scripts/build_cash_bid_pages.py skb_rows(): each elevator on the page once, at the price the page
   prints for it, highest first). On /cash-bids they come from the page's own best-price ranking
   (window.cbKitData in components/cash-bids.js, the same ranking as the Best price cards), for the search on
   screen. A row with no posted time is withheld; a row past the moment it stops counting (its posted window or
   its delivery period, the builder's share_until()) is withheld too, so an old price never prints as today's.
   No row is invented to fill five. Basis is the board's own against the futures month named; no elevator-level
   normal basis is in the page's data, so none is shown.

   Links: the page with utm_source print|share, utm_medium qr|picture, utm_campaign <page>-<date> (share-kit.js
   tags). GA4 (share-kit.js EV): share_open at each tap, share_done when the share sheet resolves,
   picture_download, sheet_print at the print itself. An arrival from the kit marks the page's own Daily signup
   box (the town's bid email box, or /cash-bids' box) with where it came from, before that box reads it.
   Any browser print (Ctrl+P) gives the bid sheet once there are rows. Fail soft: without share-kit.js the page
   works as ever and the two buttons say they are unavailable.
   Exports window.AgBidsKit (module.exports for the tests: model, html, image, link, posted). */
(function (root) {
  'use strict';
  function SK() { return root.AgShareKit || (typeof require === 'function' ? require('./share-kit.js') : null); }
  var QR_CAP = 'Scan for the live bids';
  var NOTICE = 'Not a contract. Call before you haul.';
  var SRC = 'Prices as each elevator posted them on its own bid board, read by the AGSIST elevator network. Times are Central.';
  var CSS = '/components/bids-kit.css?v=1', QR_JS = '/components/qr.js?v=11';
  var SK_CSS = '/components/share-kit.css?v=1', SK_JS = '/components/share-kit.js?v=1';
  var CROPS = [['corn', 'Corn'], ['soybeans', 'Soybeans']];

  function esc(s) { return SK().esc(s); }
  /* the posted time in Central, the time the site's day runs on: "Nov 4, 1:30 PM" */
  function posted(iso) {
    var d = new Date(iso);
    if (!isFinite(d.getTime())) return '';
    try {
      var p = {};
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
        .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
      return p.month + ' ' + p.day + ', ' + p.hour + ':' + p.minute + ' ' + String(p.dayPeriod || '').toUpperCase();
    } catch (e) { return SK().mdy(d.toISOString()); }
  }
  /* the page with the kit's tags: (url, 'print', 'qr', 'cash-bids-iowa-nevada-2026-11-07') */
  function link(url, src, med, campaign) { return url + (String(url).indexOf('?') < 0 ? '?' : '&') + SK().tags(src, med, campaign); }

  /* ---------------------------------------------------------------- the rows, as data
     d: {place, town, url, page, n, from, rows: {corn: [row], soybeans: [row]}}, row {n name, t town, s state, mi miles
     or null, c cash as printed, d delivery month, dl delivery as posted, b basis or null, k its futures month, p
     posted (ISO), u stops counting (ISO, optional)}. now: ms. -> the sheet and picture model */
  function model(d, now) {
    d = d || {};
    now = now == null ? Date.now() : now;
    var K = SK(), n = d.n || 5, held = 0, asof = K.isoDay(now), camp = (d.page || 'cash-bids') + '-' + asof;
    var crops = CROPS.map(function (c) {
      var rows = [];
      ((d.rows || {})[c[0]] || []).forEach(function (r) {
        if (rows.length >= n) return;
        var p = Date.parse(r && r.p || ''), u = r && r.u ? Date.parse(r.u) : NaN;
        if (!r || !r.c || !r.n || !isFinite(p) || p > now + 36e5 || (isFinite(u) && now > u)) { held++; return; }
        rows.push({ name: r.n, town: r.t || '', st: r.s || '', mi: r.mi, cash: r.c, mon: r.d || '', del: r.dl || r.d || '',
          basis: r.b || '', fut: r.b ? (r.k || '') : '', posted: posted(r.p), at: r.p });
      });
      var mon = rows.length && rows.every(function (r) { return r.mon === rows[0].mon; }) ? rows[0].mon : '';
      return { key: c[0], label: c[1], rows: rows, mon: mon };
    });
    var url = d.url || '';
    return { place: d.place || '', title: 'Bids near ' + (d.place || 'you'), date: K.dateLine(now), asof: asof, crops: crops, held: held,
      any: crops.some(function (c) { return c.rows.length; }), from: d.from || '', url: url, shown: url.replace(/^https?:\/\//, ''),
      qr: link(url, 'print', 'qr', camp), pic: link(url, 'share', 'picture', camp), campaign: camp, page: d.page || '',
      src: SRC, notice: NOTICE };
  }
  function where(r, st) { return r.town + (r.st && r.st !== st ? ', ' + r.st : '') + (r.mi != null ? ', ' + (r.mi < 1 ? 'under 1' : Math.round(r.mi)) + ' mi' : ''); }
  function basisText(r, vs) { return r.basis ? (vs ? 'basis ' : '') + r.basis + (r.fut ? (vs ? ' vs ' : ' ') + r.fut : '') : 'basis not posted'; }
  function madeLine(m) {
    return 'Made ' + m.date + '. Each crop: the highest bid at each elevator on the page for its earliest delivery, highest first'
      + (m.from ? '; miles are straight-line from ' + m.from : '') + '. Basis is cash minus the futures month named.'
      + (m.held ? ' ' + m.held + ' bid' + (m.held === 1 ? '' : 's') + ' past the window ' + (m.held === 1 ? 'it was' : 'they were') + ' posted for, or with no posted time, left out.' : '');
  }

  /* ---------------------------------------------------------------- the sheet, as HTML */
  function html(m, qr) {
    if (!m) return '';
    var body = m.crops.map(function (c) {
      var rows = c.rows.map(function (r, i) {
        return '<tr><td class="skbs-i">' + (i + 1) + '</td><td><b>' + esc(r.name) + '</b></td><td>' + esc(where(r)) + '</td><td>' + esc(r.del) + '</td>'
          + '<td class="skbs-n skbs-c">' + esc(r.cash) + '</td><td class="skbs-n">' + esc(r.basis ? r.basis : 'not posted') + (r.fut ? '<small>vs ' + esc(r.fut) + '</small>' : '') + '</td>'
          + '<td>' + esc(r.posted) + '</td></tr>';
      }).join('');
      return '<section class="skbs-crop"><h2 class="skbs-h">' + esc(c.label) + (c.rows.length ? ', top ' + c.rows.length : '') + '</h2>'
        + (c.rows.length ? '<table class="skbs-t"><thead><tr><th></th><th>Elevator</th><th>Town</th><th>Delivery</th><th class="skbs-n">Cash $/bu</th><th class="skbs-n">Basis</th><th>Posted (CT)</th></tr></thead><tbody>' + rows + '</tbody></table>'
          : '<p class="skbs-none">No current ' + esc(c.label.toLowerCase()) + ' bid near ' + esc(m.place) + ' on the page right now.</p>') + '</section>';
    }).join('');
    var side = qr ? '<div class="skbs-side"><div class="skbs-qr">' + qr + '</div><p class="skbs-scan">' + esc(QR_CAP) + '</p></div>' : '';
    return '<div class="skbs-bar"></div><header class="skbs-top"><div class="skbs-ttl"><p class="skbs-kick">Bid sheet</p><h1 class="skbs-h1">' + esc(m.title) + '</h1>'
      + '<p class="skbs-date">' + esc(m.date) + ' · cash prices as posted, times Central</p></div>'
      + '<div class="skbs-brand"><img class="skbs-logo" src="/img/logo-agsist-onlight.svg" alt="AGSIST" width="86" height="40"><p class="skbs-url">agsist.com</p></div>' + side + '</header>'
      + body + '<p class="skbs-not">' + esc(m.notice) + '</p>'
      + '<p class="skbs-live">These bids, live, and the free morning bid email: <b>' + esc(m.shown) + '</b></p>'
      + '<p class="skbs-src">' + esc(m.src) + '</p><p class="skbs-na">' + esc(madeLine(m)) + '</p>';
  }

  /* ---------------------------------------------------------------- the picture
     The dark card: agsist.com, the date, "Bids near <town>", the corn and the soybean rows (elevator, cash; town,
     posted time, delivery and basis), the QR code, the notice and the source. Every word 20 px or more.
     o.wide: 1200 x 630 (two columns, the QR code at the top right), else 1080 x 1350. o.qr: the QR matrix of m.pic.
     -> {canvas, texts, sizes} */
  function image(m, doc, o) {
    o = o || {};
    var K = SK(), wide = !!o.wide, W = wide ? 1200 : 1080, H = wide ? 630 : 1350, P = wide ? 48 : 60;
    var c = K.canvas(doc, W, H), ctx = c.getContext('2d'), p = K.pen(ctx), INK = K.INK, DIM = K.DIM, GOLD = K.GOLD;
    K.frame(ctx, W, H, wide ? 10 : 12);
    var q = o.qr, qn = q ? q.length + 8 : 0;
    /* one line: the text, shrunk to fit and cut with an ellipsis only past the smallest size */
    function one(s, x, y, size, min, weight, ink, width, al) {
      var sz = p.fit(s, size, min, weight, width);
      p.font(sz, weight);
      while (s.length > 4 && ctx.measureText(s).width > width) s = s.slice(0, -2).replace(/\s+$/, '') + '…';
      p.text(s, al === 'right' ? x + width : x, y, sz, weight, ink, al);
      return sz;
    }
    /* a row: the elevator and its cash on the first line; under it the town and miles, the posted time, then the
       delivery month (in the crop's heading when every row shares it) and the basis at the right */
    function row(r, cr, x, y, w, big, small, o2) {
      o2 = o2 || {};
      p.font(big + 6, 800);
      var cw = ctx.measureText(r.cash).width;
      p.text(r.cash, x + w, y, big + 6, 800, INK, 'right');
      one(r.name, x, y, big, small + 2, 700, INK, w - cw - 18);
      var right = (cr.mon ? '' : r.mon + ' \u00b7 ') + basisText(r, !o2.short), y2 = y + small + (o2.short ? 11 : 8);
      p.font(small, 500);
      var rw = Math.min(ctx.measureText(right).width, w * 0.42);
      one(right, x + w - rw, y2, small, 20, 500, DIM, rw, 'right');
      one(where(r, o2.st) + (o2.short ? ' \u00b7 ' : ' \u00b7 posted ') + r.posted, x, y2, small, 20, 500, DIM, w - rw - 16);
    }
    function heading(cr) { return cr.label + (cr.rows.length ? ', top ' + cr.rows.length : '') + (cr.mon ? ', ' + cr.mon + ' delivery' : ''); }
    function rule(x, y, w) { ctx.fillStyle = 'rgba(233,237,235,.14)'; ctx.fillRect(x, y, w, 1); }
    function none(cr, x, y, w, size) { one('No current ' + cr.label.toLowerCase() + ' bid near ' + m.place + ' right now.', x, y, size, 20, 500, DIM, w); }
    if (wide) {
      var qmod = q ? Math.max(2, Math.floor(132 / qn)) : 0, qs = qn * qmod, st = (/, ([A-Z]{2})$/.exec(m.place) || [])[1];
      if (q) K.qr(ctx, q, W - P - qs, 26, qmod);
      one(m.title, P, 84, 50, 32, 800, INK, W - 2 * P - qs - 24);
      p.text('agsist.com', P, 128, 26, 800, GOLD);
      p.font(26, 800);
      one('Cash bids, ' + m.date + ', posted times Central', P + ctx.measureText('agsist.com').width + 16, 128, 24, 20, 600, DIM, W - 2 * P - qs - 190);
      var cw2 = (W - 2 * P - 40) / 2, top = 190, rh = 70;
      m.crops.forEach(function (cr, i) {
        var x = P + i * (cw2 + 40);
        one(heading(cr), x, top, 26, 20, 800, GOLD, cw2);
        if (!cr.rows.length) none(cr, x, top + 40, cw2, 22);
        cr.rows.forEach(function (r, k) { if (k) rule(x, top + 18 + k * rh, cw2); row(r, cr, x, top + 46 + k * rh, cw2, 23, 20, { short: true, st: st }); });
      });
      one(m.shown + (q ? '  \u00b7  ' + QR_CAP : '') + '  \u00b7  ' + m.notice, P, H - 46, 22, 20, 700, INK, W - 2 * P);
      one(m.src, P, H - 18, 20, 20, 500, DIM, W - 2 * P);
      return { canvas: c, texts: p.texts, sizes: p.sizes };
    }
    K.head(p, P, 'agsist.com', 'Cash bids, ' + m.date);
    var y = p.lines(m.title, P, 214, 60, 800, INK, 70, 2, W - 2 * P) - 40;
    /* the footer first: the QR code at the bottom right, its words, the address, the notice and the source at the left */
    var mod = q ? Math.max(3, Math.floor(200 / qn)) : 0, qs1 = qn * mod, LW = W - 2 * P - (q ? qs1 + 30 : 0);
    ctx.font = '400 20px ' + K.FONT;
    var srcL = p.wrap(m.src, LW).slice(0, 3), foot = H - 36 - (srcL.length - 1) * 26;
    var footTop = Math.min(foot - 26 - 34 - 36 - 40, q ? H - 36 - qs1 : 1e9) - 28;
    var nRows = m.crops.reduce(function (a, cr) { return a + Math.max(1, cr.rows.length); }, 0);
    var rh1 = Math.max(64, Math.min(86, Math.floor((footTop - y - m.crops.length * 66) / nRows)));
    m.crops.forEach(function (cr) {
      y += 52;
      one(heading(cr), P, y, 34, 24, 800, GOLD, W - 2 * P);
      y += 14;
      if (!cr.rows.length) { none(cr, P, y + 36, W - 2 * P, 26); y += rh1; }
      cr.rows.forEach(function (r, k) { if (k) rule(P, y + 9, W - 2 * P); row(r, cr, P, y + 40, W - 2 * P, 30, 22); y += rh1; });
    });
    if (q) { K.qr(ctx, q, W - P - qs1, H - 36 - qs1, mod); p.text(QR_CAP, P, foot - 26 - 34 - 36 - 8, 28, 700, GOLD); }
    one(m.notice, P, foot - 26 - 34, 30, 22, 800, INK, LW);
    one(m.shown, P, foot - 26 - 2, 26, 20, 700, INK, LW);
    srcL.forEach(function (l, i) { p.text(l, P, foot + i * 26, 20, 400, DIM); });
    return { canvas: c, texts: p.texts, sizes: p.sizes };
  }

  var api = { model: model, html: html, image: image, link: link, posted: posted, where: where, QR_CAP: QR_CAP, NOTICE: NOTICE };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgBidsKit = api;

  /* ---------------------------------------------------------------- the page */
  var doc = root.document, dataEl = doc && doc.getElementById('skb-data');
  var LIVE = !dataEl && doc && doc.getElementById('best-bids-section');
  if (!doc || (!dataEl && !LIVE)) return;
  /* An arrival from the kit (its picture, its sheet's QR code) marks the page's own Daily signup box with where it
     came from: this script runs before the box's (cb-signup.js), which reads data-source when it starts. */
  (function arrive() {
    var q = null; try { q = new URLSearchParams(root.location.search); } catch (e) {}
    var s = q && q.get('utm_source'), md = q && q.get('utm_medium');
    if (!s || !/^(share|print|email)$/.test(s)) return;
    var tag = '|' + s + '-' + String(md || '').replace(/[^a-z]/g, '').slice(0, 10);
    Array.prototype.forEach.call(doc.querySelectorAll('[data-bid-alerts][data-source],[data-signup-ask][data-source]'), function (el) {
      var v = el.getAttribute('data-source') || '';
      if (v && v.indexOf('|') < 0) el.setAttribute('data-source', (v + tag).slice(0, 60));
    });
  })();
  var DATA = null;
  try { DATA = dataEl ? JSON.parse(dataEl.textContent) : null; } catch (e) { DATA = null; }
  function data() { if (DATA) return DATA; try { return root.cbKitData ? root.cbKitData() : null; } catch (e) { return null; } }
  var $ = function (id) { return doc.getElementById(id); };
  var K = null;
  /* the printed area with half-inch margins: Letter 7.5 x 10 in, A4 7.27 x 10.69 in; the sheet must fit both */
  var PAPERS = [[7.5, 10], [7.27, 10.69]];
  function load(tag, attrs) { var el = doc.createElement(tag); Object.keys(attrs).forEach(function (k) { el[k] = attrs[k]; }); doc.head.appendChild(el); return el; }
  function current() { return model(data(), Date.now()); }
  function qrSvg(m) { try { return root.AgQR ? root.AgQR.svg(m.qr, QR_CAP + ': ' + m.shown, 10) : ''; } catch (e) { return ''; } }
  function fit(el) {
    var r = K.measure(el, function () { return Math.max.apply(null, PAPERS.map(function (pp) { el.style.width = pp[0] + 'in'; return el.offsetHeight / (pp[1] * 96 - 8); })); });
    el.style.width = '';
    return r;
  }
  function build() {
    var m = current(), el = K.sheet(doc, 'skbs', 'skbs');
    el.style.zoom = '';
    el.innerHTML = html(m, qrSvg(m));
    var r = fit(el);
    if (r > 1) { var z = Math.floor(100 / r) / 100; el.style.zoom = String(z); el.setAttribute('data-zoom', String(z)); } else el.removeAttribute('data-zoom');
    el.setAttribute('data-fit', r <= 1 ? '1' : '0');
    api.last = m;
    return { el: el, m: m };
  }
  api.build = function () { return K ? build() : null; };
  api.current = current;
  var stEl = doc.querySelector('.skb-st');
  function say(btn, words, back) {
    if (stEl) stEl.textContent = words;
    if (btn && back) { btn.textContent = words.replace(/\.$/, ''); setTimeout(function () { btn.textContent = back; }, 2400); }
  }
  function start() {
    if (K || !(K = root.AgShareKit)) return;
    if (!root.AgQR) load('script', { src: QR_JS, async: true });
    var ga = K.ga, EV = K.EV;
    K.arrival(root, 'agsist_bids_from');
    /* any browser print (Ctrl+P, the menu, a phone's Print) gives the bid sheet once there are rows */
    var printing = false;
    function on() {
      if (printing) return;
      var b = build();
      if (!b.m.any) return;
      printing = true;
      K.show(doc, 'skbs-on', true);
      ga(EV.print, { asset: 'sheet', page: b.m.page });
    }
    function off() { printing = false; K.show(doc, 'skbs-on', false); }
    K.printHook(root, on, off);
    var pb = $('skb-print');
    if (pb) pb.addEventListener('click', function () {
      var m = current();
      ga(EV.open, { asset: 'sheet', page: m.page });
      if (!m.any) { say(pb, 'No bids to print yet.', 'Print bid sheet'); return; }
      on();
      K.printNow(root, off);
    });
    var pic = $('skb-pic');
    if (pic) pic.addEventListener('click', function () {
      var m = current();
      ga(EV.open, { asset: 'picture', page: m.page });
      if (!m.any) { say(pic, 'No bids for a picture yet.', 'Save picture'); return; }
      var wide = !K.coarse(root) && (root.innerWidth || 1200) >= 700;
      var ready = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
      ready.then(function () {
        var q = null;
        try { q = root.AgQR ? root.AgQR.matrix(m.pic, null, null, 10) : null; } catch (e) { q = null; }
        var im = image(m, doc, { qr: q, wide: wide });
        api.lastImage = { w: im.canvas.width, h: im.canvas.height, texts: im.texts, sizes: im.sizes, qr: q ? m.pic : null };
        im.canvas.toBlob(function (blob) {
          if (!blob) { say(pic, 'Could not draw the picture here.', 'Save picture'); return; }
          var name = 'agsist-' + (m.page || 'cash-bids') + '-' + m.asof + '.png';
          var file = K.file(blob, name);
          function saved() { K.download(doc, blob, name); ga(EV.download, { page: m.page }); say(pic, 'Picture saved.', 'Save picture'); }
          if (K.canShareFile(root, file)) {
            K.share(root, { files: [file], title: m.title, text: m.title + ', ' + m.date + ': ' + m.pic }, function () { ga(EV.done, { asset: 'picture', page: m.page }); }, saved);
            return;
          }
          saved();
        }, 'image/png');
      });
    });
  }
  /* without the share kit core (blocked, offline) the page works as ever; the two buttons say they are unavailable */
  function noKit() {
    if (K) return;
    ['skb-pic', 'skb-print'].forEach(function (id) {
      var b = $(id); if (!b) return;
      b.disabled = true; b.setAttribute('aria-disabled', 'true'); b.title = 'Not available right now. Reload the page to try again.';
    });
    if (stEl) stEl.textContent = 'Save picture and Print bid sheet are not available right now.';
  }
  if (!doc.querySelector('link[href^="/components/share-kit.css"]')) load('link', { rel: 'stylesheet', href: SK_CSS });
  if (!doc.querySelector('link[href^="/components/bids-kit.css"]')) load('link', { rel: 'stylesheet', href: CSS });
  if (root.AgShareKit) start(); else { var sk = load('script', { src: SK_JS, async: true }); sk.onload = function () { start(); if (!K) noKit(); }; sk.onerror = noKit; }
})(typeof window !== 'undefined' ? window : this);
