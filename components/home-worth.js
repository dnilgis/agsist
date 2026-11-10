/* components/home-worth.js -- the home page's "Worth a look" strip (Nov 2, 2026),
   right under the three jobs. Three cards:
     1. Rain Print: the promo card from components/rain-print-promo.js, which keeps its own
        wording and dates (the Christmas order-by date from data/rain-print.json). Its
        [data-rp-card-early] marker lives in this strip, so the card is on the page once.
     2. The rain gauge waitlist: baked in index.html with the gauge hook's words
        (data/rain-print.json gauge_hook; test/home-jobs.test.mjs checks they agree).
     3. "New on AGSIST": one recent page from What's new (data/whats-new.json, newest first).
        The newest few entries no older than 30 days, one page each, skipping the home page
        itself and the two cards beside it; which one shows turns over by the Central date,
        so every reader sees the same one on a given day. Nothing recent: the baked
        "See what's new" link stays.
   The cards hold their size from the first paint (css/home.css, .wl); this file only swaps
   the words and the link of card 3. Fail soft: any error leaves the baked card. */
(function (root) {
  'use strict';
  var ISO = /^\d{4}-\d{2}-\d{2}$/;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var KEEP = 3, MAX_AGE = 30;
  // pages that already have their own card in the strip, or are the home page
  var SKIP = /^\/(?:rain-print|rain-gauge|gifts-for-farmers)(?:[/?#.-]|$)/;
  function chicagoToday(now) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now || new Date()); }
    catch (e) { return (now || new Date()).toISOString().slice(0, 10); }
  }
  function dayNum(iso) { var p = iso.split('-').map(Number); return Math.floor(Date.UTC(p[0], p[1] - 1, p[2]) / 864e5); }
  function shortDate(iso) { var p = iso.split('-').map(Number); return MON[p[1] - 1] + '\u00a0' + p[2]; }
  function pagePath(href) { return String(href).split('#')[0].split('?')[0].replace(/\/+$/, ''); }
  /* The pool: up to KEEP entries, newest first, dated today or in the last MAX_AGE days,
     one per page, internal links only. */
  function pool(items, today) {
    if (!Array.isArray(items) || !ISO.test(today || '')) return [];
    var t = dayNum(today), seen = {}, out = [];
    for (var i = 0; i < items.length && out.length < KEEP; i++) {
      var it = items[i];
      if (!it || !ISO.test(it.date || '') || typeof it.title !== 'string' || !it.title.trim()) continue;
      var href = typeof it.link === 'string' ? it.link.trim() : '';
      if (href.charAt(0) !== '/' || href.charAt(1) === '/') continue;
      var age = t - dayNum(it.date);
      if (age < 0 || age > MAX_AGE) continue;
      var p = pagePath(href);
      if (!p || SKIP.test(p) || seen[p]) continue;
      seen[p] = 1;
      out.push({ id: String(it.id || ''), title: it.title.trim(), href: href, date: it.date });
    }
    return out;
  }
  /* Today's pick: the same for everyone on a Central date, the next one tomorrow. */
  function pickNew(items, today) {
    var p = pool(items, today);
    if (!p.length) return null;
    var e = p[dayNum(today) % p.length];
    return { id: e.id, href: e.href, date: e.date, line: e.title.replace(/[.\s]+$/, '') + '. Added ' + shortDate(e.date) + '.', cta: 'Take a look' };
  }
  var api = { pool: pool, pickNew: pickNew, chicagoToday: chicagoToday };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AgsistWorth = api;

  var doc = root.document;
  if (!doc || !doc.getElementById || !root.fetch) return;
  var card = doc.getElementById('wl-new');
  if (!card) return;
  fetch('/data/whats-new.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      var n = pickNew(d && d.items, chicagoToday());
      if (!n) return;
      var x = doc.getElementById('wl-new-x'), a = doc.getElementById('wl-new-a');
      if (!x || !a) return;
      x.textContent = n.line;
      a.textContent = n.cta + ' →';
      card.setAttribute('href', n.href);
      card.setAttribute('data-placement', 'worth-new-' + n.id);
    })
    .catch(function () {});
  // Rain Print off or its data missing: the promo leaves its card hidden; fold the empty cell away
  function foldRp() {
    var cell = doc.querySelector('.wl-rp'), aside = cell && cell.querySelector('[data-rain-print-promo]');
    if (cell && aside && aside.hidden) cell.hidden = true;
  }
  root.addEventListener('load', function () { setTimeout(foldRp, 6000); });
})(typeof window !== 'undefined' ? window : this);
