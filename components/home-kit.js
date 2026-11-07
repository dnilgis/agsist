/* The home kit (share kit wave 1 step 3, Nov 7, 2026): a "Today's markets" picture from the homepage, 1080 x 1350
   for a phone and 1200 x 630 wide, in the family of the COT kit and the Bids near kit: the gold bar, agsist.com,
   the date with its year, the futures board the page shows (corn, soybeans, wheat, live cattle, lean hogs: price,
   change and when each quote is from), the reader's top cash bid when the page already shows one, this week's big
   report from the page's own calendar, a QR code back to the homepage and "Free every morning: the AGSIST Daily at
   agsist.com".

   NOTHING HERE WORKS OUT A PRICE. Each futures row is read off the page's own board (#f-prices: the Corn and
   Soybeans cards, the Wheat, Live cattle and Lean hogs rows): the price, the change and the contract month exactly
   as printed there. When the quote is from is the page's own stamp (AgPxStamp.stamp in price-local.js: "Nov 6
   settle", "Last trade as of 1:46 pm CT"), for the same quote the board printed (window.AGSIST_PRICE_DATA).
   A quote is withheld, and its row says so, when the board has no price for it, when the page marks it stale
   (stale-tile, "not updated this run"), when the price file marks it stale, when it has no day to stamp, or when
   it is a session or more behind (AgPxStamp.settleAge: a settle or last trade older than the last session before
   today). The cash bid is the hero band's own top bid (window.__agsistBidsTop, the price as #hb-corn-v prints
   it), only when that cell is drawn, the bid is not marked old, has a posted time and is under 72 hours old. The
   report is the first big USDA release (WASDE, Crop Production, Grain Stocks, Prospective Plantings, Acreage) in
   the next seven days from the page's "Today and this week" calendar (AgHappening.events), else the first release
   of any kind there, else none. Times on the picture are Central, the time the site's day runs on.

   Link: https://agsist.com/ with utm_source=share, utm_medium=picture, utm_campaign=home-<date> (share-kit.js
   tags). GA4 (share-kit.js EV): share_open at each tap, share_done when the share sheet resolves,
   picture_download. Fail soft: without share-kit.js the page works as ever and the button says it is unavailable.
   Exports window.AgHomeKit (module.exports for the tests: model, image, link, centralWhen). */
(function (root) {
  'use strict';
  function SK() { return root.AgShareKit || (typeof require === 'function' ? require('./share-kit.js') : null); }
  var URL0 = 'https://agsist.com/';
  var ASK = 'Free every morning: the AGSIST Daily at agsist.com';
  var SRC = 'Futures: Yahoo Finance, delayed; a settle as the exchange posted it.', SRC_BID = ' Cash bid as the elevator posted it.', SRC_TZ = ' Times Central.';
  var QR_JS = '/components/qr.js?v=11', SK_JS = '/components/share-kit.js?v=1';
  var UP = '#5fd38a', DN = '#ff8a7a';
  /* the five markets on the board: key in the price file, name on the picture, the board element that holds the price */
  var MARKETS = [['corn', 'Corn', 'pcp-corn-near'], ['beans', 'Soybeans', 'pcp-bean-near'], ['wheat', 'Wheat, Chicago SRW', 'pcp-wheat'],
    ['cattle', 'Live cattle', 'pcp-cattle'], ['hogs', 'Lean hogs', 'pcp-hogs']];
  var BIG = /^(WASDE|Crop Production|Grain Stocks|Prospective Plantings|Acreage)/;

  function tidy(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function ctParts(ms, o) {
    var p = {};
    new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: 'America/Chicago' }, o)).formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return p;
  }
  /* a time in Central: (ms, true) "Tue Nov 10, 11:00 AM CT"; (ms) "Nov 7, 9:30 AM" */
  function centralWhen(ms, dow) {
    if (!isFinite(ms)) return '';
    try {
      var p = ctParts(ms, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
      var t = p.hour + ':' + p.minute + ' ' + String(p.dayPeriod || '').toUpperCase();
      return dow ? p.weekday + ' ' + p.month + ' ' + p.day + ', ' + t + ' CT' : p.month + ' ' + p.day + ', ' + t;
    } catch (e) { return ''; }
  }
  function ctDay(ms) { try { return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }).slice(0, 10); } catch (e) { return ''; } }
  function link(campaign, med) { return URL0 + '?' + SK().tags('share', med || 'picture', campaign); }

  /* ---------------------------------------------------------------- the picture, as data
     b: {fetched (ISO, the price file's read time), rows: [{key, name, month, price, unit, chg, dir up|dn|nc, mark
     (the page marks it stale), q (the quote the board printed)}], bids: [{label, cash, name, town, month, posted,
     stale, ageUnknown}], events: [{name, at, key, rank}]}. px: AgPxStamp (stamp, settleAge). now: ms. */
  function model(b, px, now) {
    b = b || {};
    now = now == null ? Date.now() : now;
    var K = SK(), asof = K.isoDay(now), camp = 'home-' + asof, held = 0;
    var rows = (b.rows || []).map(function (r) {
      var o = { key: r.key, name: r.name, month: tidy(r.month), price: tidy(r.price), unit: tidy(r.unit), chg: tidy(r.chg), dir: r.dir || 'nc', when: '', ok: false };
      var q = r.q, why = '';
      if (!o.price || /^-+$|--|not loaded/i.test(o.price) || !/\d/.test(o.price)) why = 'missing';
      else if (r.mark) why = 'stale';
      else if (!q || q.close == null) why = 'missing';
      else if (q.stale === true) why = 'stale';
      else if (!px || !px.stamp || !px.settleAge) why = 'stale';
      else {
        var day = q.close_kind === 'settle' ? (q.settle_date || q.close_date) : q.close_kind === 'last' ? ctDay(Date.parse(q.close_time || b.fetched || '')) : q.close_date;
        var age = /^\d{4}-\d{2}-\d{2}/.test(day || '') ? px.settleAge(day, new Date(now)) : null;
        if (!age || age.stale || String(day).slice(0, 10) > asof) why = 'stale';
        else { o.when = px.stamp(q, b.fetched, new Date(now)); if (!o.when) why = 'stale'; }
      }
      if (why) { o.why = why; held++; } else o.ok = true;
      return o;
    });
    var bids = (b.bids || []).filter(function (x) {
      var t = Date.parse(x && x.posted || '');
      return x && x.cash && /\d/.test(x.cash) && x.name && !x.stale && !x.ageUnknown && isFinite(t) && t <= now + 36e5 && now - t <= 72 * 36e5;
    }).map(function (x) { return { label: tidy(x.label), cash: tidy(x.cash), name: tidy(x.name), town: tidy(x.town), month: tidy(x.month), posted: centralWhen(Date.parse(x.posted)) }; });
    /* this week's big report: the first big USDA release from now (or out earlier today) to seven days on; else the
       first release of any kind in that window. Releases at the same minute are one line. */
    var today = ctDay(now), evs = (b.events || []).filter(function (e) { return e && e.name && isFinite(e.at) && (e.at > now || ctDay(e.at) === today) && e.at - now <= 7 * 864e5; })
      .sort(function (a, c) { return a.at - c.at; });
    var first = evs.filter(function (e) { return BIG.test(e.name); })[0] || evs[0], report = null;
    if (first) {
      var names = [];
      evs.filter(function (e) { return e.at === first.at; }).sort(function (a, c) { return (a.key === 'cot' ? -1 : a.rank == null ? 50 : a.rank) - (c.key === 'cot' ? -1 : c.rank == null ? 50 : c.rank); })
        .forEach(function (e) { if (names.indexOf(e.name) < 0) names.push(e.name); });
      report = { name: names.join(' and '), when: first.at <= now ? 'out today at ' + centralWhen(first.at).replace(/^[A-Z][a-z]{2} \d+, /, '') + ' CT' : centralWhen(first.at, true), at: first.at, big: BIG.test(first.name) };
    }
    return { title: 'Today\u2019s markets', date: K.dateLine(now), asof: asof, rows: rows, held: held, any: rows.some(function (r) { return r.ok; }),
      bids: bids, report: report, campaign: camp, pic: link(camp, 'picture'), ask: ASK, src: SRC + (bids.length ? SRC_BID : '') + SRC_TZ };
  }
  function reportLine(m) { return m.report ? (m.report.big ? 'This week: ' : 'Next report: ') + m.report.name + ', ' + m.report.when : ''; }

  /* ---------------------------------------------------------------- the picture
     The dark card: agsist.com and the date, "Today's markets", the five futures rows (name and contract month,
     price and unit; change, and when the quote is from), the top cash bid near the reader when the page shows one,
     this week's report, the QR code, the Daily line and the source. Every word 20 px or more.
     o.wide: 1200 x 630, else 1080 x 1350. o.qr: the QR matrix of m.pic. -> {canvas, texts, sizes} */
  function image(m, doc, o) {
    o = o || {};
    var K = SK(), wide = !!o.wide, W = wide ? 1200 : 1080, H = wide ? 630 : 1350, P = wide ? 48 : 60;
    var c = K.canvas(doc, W, H), ctx = c.getContext('2d'), p = K.pen(ctx), INK = K.INK, DIM = K.DIM, GOLD = K.GOLD;
    K.frame(ctx, W, H, wide ? 10 : 12);
    var q = o.qr, qn = q ? q.length + 8 : 0;
    function one(s, x, y, size, min, weight, ink, width, al) {
      var sz = p.fit(s, size, min, weight, width);
      p.font(sz, weight);
      while (s.length > 4 && ctx.measureText(s).width > width) s = s.slice(0, -2).replace(/\s+$/, '') + '…';
      p.text(s, al === 'right' ? x + width : x, y, sz, weight, ink, al);
      p.font(sz, weight);
      return ctx.measureText(s).width;
    }
    function rule(x, y, w) { ctx.fillStyle = 'rgba(233,237,235,.14)'; ctx.fillRect(x, y, w, 1); }
    function arrow(r) { return r.dir === 'up' ? '▲ ' : r.dir === 'dn' ? '▼ ' : ''; }
    /* a futures row: name and month at the left, price and unit at the right; under it the change in green or red
       and when the quote is from. A withheld quote: its name and "no current quote". */
    function row(r, x, y, w, s) {
      var pw = 0;
      if (r.ok) {
        p.font(s.u, 500); var uw = ctx.measureText(r.unit).width;
        p.text(r.unit, x + w, y, s.u, 500, DIM, 'right');
        p.font(s.p, 800); pw = ctx.measureText(r.price).width + uw + 12;
        p.text(r.price, x + w - uw - 12, y, s.p, 800, INK, 'right');
      }
      var nw = one(r.name, x, y, s.n, 20, 800, INK, w - pw - 140);
      if (r.month) one(r.month, x + nw + 14, y, s.m, 20, 600, DIM, Math.max(40, w - pw - nw - 30));
      var y2 = y + s.g;
      if (!r.ok) { one(r.why === 'missing' ? 'No quote on the page right now, not shown' : 'No current quote, not shown', x, y2, s.c, 20, 500, DIM, w); return; }
      var cw = one(arrow(r) + r.chg, x, y2, s.c, 20, 700, r.dir === 'up' ? UP : r.dir === 'dn' ? DN : DIM, w * 0.5);
      one(r.when, x + cw + 24, y2, s.c - 2, 20, 500, DIM, w - cw - 24, 'right');
    }
    function bid(bd, x, y, w, s) {
      one(bd.label, x, y, s.l, 20, 700, GOLD, w);
      one(bd.cash + '  ' + bd.name, x, y + s.g1, s.v, 20, 800, INK, w);
      one([bd.town, bd.month ? bd.month + ' delivery' : '', 'posted ' + bd.posted].filter(Boolean).join(' · '), x, y + s.g1 + s.g2, s.s, 20, 500, DIM, w);
    }
    if (wide) {
      var LW = 660, RX = P + LW + 44, RW = W - P - RX;
      var qmod = q ? Math.max(2, Math.floor(150 / qn)) : 0, qs = qn * qmod;
      one(m.title, P, 78, 46, 32, 800, INK, LW);
      p.text('agsist.com', P, 118, 26, 800, GOLD);
      p.font(26, 800);
      one(m.date + ', futures as of each time shown', P + ctx.measureText('agsist.com').width + 16, 118, 22, 20, 600, DIM, LW - 170);
      var y = 172;
      m.rows.forEach(function (r, i) { if (i) rule(P, y - 34, LW); row(r, P, y, LW, { n: 25, m: 20, p: 28, u: 20, c: 22, g: 30 }); y += 76; });
      if (q) K.qr(ctx, q, W - P - qs, 30, qmod);
      var ry = 30 + qs + 46;
      m.bids.slice(0, 2).forEach(function (bd) { bid(bd, RX, ry, RW, { l: 21, v: 24, s: 20, g1: 32, g2: 28 }); ry += 104; });
      if (m.report) { ry = Math.max(ry, H - 214); one(m.report.big ? 'This week' : 'Next report', RX, ry, 21, 20, 700, GOLD, RW); one(m.report.name, RX, ry + 32, 24, 20, 800, INK, RW); one(m.report.when, RX, ry + 62, 22, 20, 600, INK, RW); }
      if (q) { one('Scan for', RX, 30 + qs - 34, 20, 20, 600, DIM, RW - qs - 16); one('live prices', RX, 30 + qs - 8, 20, 20, 600, DIM, RW - qs - 16); }
      one(m.ask, P, H - 50, 24, 20, 800, INK, W - 2 * P);
      one(m.src, P, H - 20, 20, 20, 500, DIM, W - 2 * P);
      return { canvas: c, texts: p.texts, sizes: p.sizes };
    }
    K.head(p, P, 'agsist.com', m.date + ', futures as of each time shown');
    one(m.title, P, 220, 68, 44, 800, INK, W - 2 * P);
    var mod = q ? Math.max(3, Math.floor(210 / qn)) : 0, qs1 = qn * mod, FW = W - 2 * P - (q ? qs1 + 30 : 0);
    var y1 = 318, rh = m.bids.length ? 106 : 134;
    m.rows.forEach(function (r, i) { if (i) rule(P, y1 - 52, W - 2 * P); row(r, P, y1, W - 2 * P, { n: 34, m: 26, p: 42, u: 24, c: 26, g: 42 }); y1 += rh; });
    y1 += 8;
    m.bids.slice(0, 2).forEach(function (bd) { rule(P, y1 - 44, W - 2 * P); bid(bd, P, y1, W - 2 * P, { l: 26, v: 32, s: 23, g1: 42, g2: 34 }); y1 += 124; });
    var foot = H - 36;
    ctx.font = '500 20px ' + K.FONT;
    var srcL = p.wrap(m.src, FW).slice(0, 3), srcTop = foot - (srcL.length - 1) * 26;
    if (m.report) {
      var rt = Math.min(y1 + 4, srcTop - 170);
      rule(P, rt - 46, W - 2 * P);
      one(m.report.big ? 'This week' : 'Next report', P, rt, 26, 20, 700, GOLD, FW);
      one(m.report.name, P, rt + 42, 32, 22, 800, INK, FW);
      one(m.report.when, P, rt + 80, 28, 20, 600, INK, FW);
    }
    if (q) { K.qr(ctx, q, W - P - qs1, H - 36 - qs1, mod); }
    one(m.ask, P, srcTop - 44, 30, 22, 800, INK, FW);
    srcL.forEach(function (l, i) { p.text(l, P, srcTop + i * 26, 20, 500, DIM); });
    return { canvas: c, texts: p.texts, sizes: p.sizes };
  }

  var api = { model: model, image: image, link: link, centralWhen: centralWhen, reportLine: reportLine, MARKETS: MARKETS, ASK: ASK, SRC: SRC };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgHomeKit = api;

  /* ---------------------------------------------------------------- the page */
  var doc = root.document, $ = function (id) { return doc.getElementById(id); };
  var btn = doc && $('hk-pic');
  if (!btn) return;
  var BACK = btn.textContent;
  /* the board as the page prints it, right now */
  function board() {
    var Q = root.AGSIST_PRICE_DATA || {}, off = !!($('f-prices') && $('f-prices').classList.contains('px-off'));
    var fetched = '';
    var t = doc.querySelector('#prices-age time[datetime]');
    if (t) fetched = t.getAttribute('datetime') || '';
    var rows = MARKETS.map(function (mk) {
      var pe = $(mk[2]), card = pe && pe.closest ? pe.closest('.pc') : null, o = { key: mk[0], name: mk[1], q: Q[mk[0]] || null };
      if (!pe || !card || off) return o;
      o.price = pe.textContent;
      var unit = card.querySelector('.r7-unit');
      o.unit = unit ? unit.textContent : '';
      var cm = card.querySelector('.pc-contract') || card.querySelector('.r7-cm');
      o.month = cm ? tidy(cm.textContent).split(' · ')[0] : '';
      if (/^(front month|most-active|continuous)$/i.test(o.month)) o.month = '';
      var ce = card.querySelector('.pc-change .pc-chg-val') || card.querySelector('.r7-chg'), pc = card.querySelector('.r7-pct');
      var ch = tidy(ce ? ce.textContent : '').replace(/^[▲▼]\s*/, ''), pct = tidy(pc ? pc.textContent : '');
      o.chg = ch && pct && !card.querySelector('.pc-change') ? ch + ' (' + pct + ')' : ch;
      o.dir = ce && /\bup\b/.test(ce.className) ? 'up' : ce && /\bdn\b/.test(ce.className) ? 'dn' : 'nc';
      var dt = card.querySelector('.r7-dt');
      o.mark = card.classList.contains('stale-tile') || card.classList.contains('r7-noq') || !!(dt && /not updated/.test(dt.textContent));
      if (!o.chg) o.mark = true;
      return o;
    });
    var top = root.__agsistBidsTop || null, bids = [];
    [['corn', 'hb-corn'], ['soybeans', 'hb-soy']].forEach(function (a) {
      var x = top && top[a[0]], cell = $(a[1]), v = cell && cell.querySelector('#' + a[1] + '-v .hb-n'), k = $(a[1] + '-k');
      if (!x || !cell || cell.getAttribute('data-state') !== 'ok' || !v || cell.classList.contains('hb-stale') || cell.offsetParent === null) return;
      bids.push({ label: k ? k.textContent : '', cash: v.textContent, name: x.name, town: x.town, month: x.month, posted: x.posted, stale: x.stale, ageUnknown: x.ageUnknown });
    });
    var events = [];
    try { events = root.AgHappening && root.AgHappening.events ? root.AgHappening.events() : []; } catch (e) { events = []; }
    return { fetched: fetched, rows: rows, bids: bids, events: events };
  }
  function current() { return model(board(), root.AgPxStamp, Date.now()); }
  api.board = board;
  api.current = current;
  var K = null;
  function say(words) { btn.textContent = words.replace(/\.$/, ''); setTimeout(function () { btn.textContent = BACK; }, 2400); }
  function start() {
    if (K || !(K = root.AgShareKit)) return;
    if (!root.AgQR) { var s = doc.createElement('script'); s.src = QR_JS; s.async = true; doc.head.appendChild(s); }
    K.arrival(root, 'agsist_home_from');
    btn.addEventListener('click', function () {
      var m = current(), ga = K.ga, EV = K.EV;
      ga(EV.open, { asset: 'picture', page: 'home' });
      if (!m.any) { say('No current prices for a picture yet.'); return; }
      var wide = !K.coarse(root) && (root.innerWidth || 1200) >= 700;
      var ready = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
      ready.then(function () {
        var qm = null;
        try { qm = root.AgQR ? root.AgQR.matrix(m.pic, null, null, 10) : null; } catch (e) { qm = null; }
        var im = image(m, doc, { qr: qm, wide: wide });
        api.lastImage = { w: im.canvas.width, h: im.canvas.height, texts: im.texts, sizes: im.sizes, qr: qm ? m.pic : null };
        im.canvas.toBlob(function (blob) {
          if (!blob) { say('Could not draw the picture here.'); return; }
          var name = 'agsist-markets-' + m.asof + '.png', file = K.file(blob, name);
          function saved() { K.download(doc, blob, name); ga(EV.download, { page: 'home' }); say('Picture saved.'); }
          if (K.canShareFile(root, file)) {
            K.share(root, { files: [file], title: m.title, text: m.title + ', ' + m.date + ': ' + m.pic }, function () { ga(EV.done, { asset: 'picture', page: 'home' }); }, saved);
            return;
          }
          saved();
        }, 'image/png');
      });
    });
  }
  /* without the share kit core (blocked, offline) the page works as ever; the button says it is unavailable */
  function noKit() {
    if (K) return;
    btn.disabled = true; btn.setAttribute('aria-disabled', 'true'); btn.title = 'Not available right now. Reload the page to try again.';
  }
  if (root.AgShareKit) start();
  else { var sk = doc.createElement('script'); sk.src = SK_JS; sk.async = true; sk.onload = function () { start(); if (!K) noKit(); }; sk.onerror = noKit; doc.head.appendChild(sk); }
})(typeof window !== 'undefined' ? window : this);
