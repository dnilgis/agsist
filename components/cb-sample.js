/* components/cb-sample.js: prices on /cash-bids before a ZIP is typed.

   WHY (2026-10-17 search-terms check): "grain bids by zip code" 907, "cash grain
   prices by zip code" 753, "cash grain bids" 972, "grain prices at local elevators"
   662. A first-time reader with no saved place saw a ZIP box and no price at all.
   A reader with a saved ZIP, a ?zip= link or a detected place already gets the
   bids near them on load (components/cash-bids.js); this file does nothing then.

   What it shows: the middle bid in the five states with the most network
   elevators, corn and soybeans. Each number is futures plus that state's median
   basis at AGSIST network elevators (data/basis-states.json), on the same contract,
   labeled "about", from components/price-local.js cell() so it says exactly what
   the state line on the futures pages says. No quote within 5 days: the basis
   alone, never a made-up cash price. No basis file, or one older than 10 days:
   nothing at all.

   Light on first load: nothing is fetched until the page has decided there is no
   ZIP to search, and then price-local.js, basis-states.json (12 KB) and prices.json
   (the two data files through AG.json, so a copy the page already asked for is reused).
   A search replaces the box, as it replaces the rest of the empty state.
   Tests: test/search-answers.test.mjs */
(function (root) {
  'use strict';
  var TOP = 5, CROPS = ['corn', 'soybeans'];

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* -> html for the box, or '' (pure: tests call it). cellFn = AgPxStamp.cell */
  function render(bs, prices, cellFn, now) {
    if (!bs || !bs.states || typeof cellFn !== 'function') return '';
    var sts = Object.keys(bs.states).filter(function (st) { return cellFn(bs, prices, st, 'corn', now); })
      .sort(function (a, b) { return (bs.states[b].elevators || 0) - (bs.states[a].elevators || 0) || (a < b ? -1 : 1); })
      .slice(0, TOP);
    if (!sts.length) return '';
    var on = '', asOf = '', rows = '';
    sts.forEach(function (st) {
      var tds = CROPS.map(function (crop) {
        var c = cellFn(bs, prices, st, crop, now);
        if (!c) return '<td class="cbs-n"><span class="cbs-m">too few</span></td>';
        if (c.on) on = c.on;
        asOf = c.asOf;
        var main = c.cash != null ? '$' + c.cash.toFixed(2) : c.basis;
        return '<td class="cbs-n"><b>' + esc(main) + '</b><span class="cbs-m">' + (c.cash != null ? esc(c.basis) + ' ' : '') +
          esc(c.fut + c.label) + ' &middot; ' + c.n + ' elev.</span></td>';
      }).join('');
      rows += '<tr><th scope="row"><a href="' + esc(bs.states[st].path || '/cash-bids') + '">' + esc(bs.states[st].name) + '</a></th>' + tds + '</tr>';
    });
    return '<h3 class="cbs-h">Today&rsquo;s middle bid, before you type a ZIP</h3>' +
      '<p class="cbs-f">The middle bid at elevators in each state. &ldquo;Under&rdquo; means that many cents a bushel below the futures month named; that gap is the basis. &ldquo;Elev.&rdquo; is how many elevators were counted.</p>' +
      '<table class="cbs-t"><thead><tr><th scope="col">State</th><th scope="col">Corn</th><th scope="col">Soybeans</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="cbs-f">About: ' + (on ? 'futures at ' + esc(on) + ' plus ' : '') + 'each state&rsquo;s median basis at AGSIST network elevators' +
      (asOf ? ', ' + esc(asOf) : '') + '. The five states with the most elevators. Your ZIP gives the real bids near you.</p>';
  }

  var api = { render: render, TOP: TOP };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgCbSample = api;
  var doc = root.document;
  if (!doc) return;

  /* AG.json (util.js) when the page has it: cash-bids.js and cb-vs-state.js have
     usually asked for these two files already, so this reuses that one request. */
  function get(u) {
    if (root.AG && typeof root.AG.json === 'function') return root.AG.json(u).catch(function () { return null; });
    return fetch(u, { cache: 'default' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function stamp() {
    if (root.AgPxStamp && root.AgPxStamp.cell) return Promise.resolve(root.AgPxStamp);
    return new Promise(function (ok) {
      var s = doc.createElement('script');
      s.src = '/components/price-local.js?v=3';
      s.onload = function () { ok(root.AgPxStamp || null); };
      s.onerror = function () { ok(null); };
      doc.head.appendChild(s);
    });
  }
  function noZip() {
    var z = doc.getElementById('cb-zip');
    var st = root.AGSIST_STATE;
    return z && !z.value.trim() && !(st && st.zip) && /[?&]zip=\d{5}/.test(root.location.search) === false;
  }
  /* SPEED (2026-10-18, phone pass): the files are asked for as soon as the page
     is parsed and there is no ZIP, not 400 ms later, and an empty box of about
     the table's height (in cash-bids.html, so it is there at first paint) holds
     the place, so the table does not push the page down when it lands (it was
     most of the page's layout shift). The table
     still waits the 400 ms for cash-bids.js to run a saved ZIP, and checks
     again before it draws. No table: the empty box goes. */
  function go() {
    var box = doc.querySelector('#cb-results .cb-empty');
    var el = doc.getElementById('cb-sample');   // the page's empty place holder, if it has one
    if (!box || !noZip()) { if (el && el.parentNode && !el.firstChild) el.parentNode.removeChild(el); return; }
    if (!el) {
      el = doc.createElement('div');
      el.className = 'cb-sample cb-sample-wait';
      el.id = 'cb-sample';
      el.setAttribute('aria-hidden', 'true');
      box.appendChild(el);
    }
    var wait = new Promise(function (ok) { setTimeout(ok, 400); });
    Promise.all([Promise.all([stamp(), get('/data/basis-states.json'), get('/data/prices.json')]), wait]).then(function (a) {
      var r = a[0], px = r[0], live = doc.querySelector('#cb-results .cb-empty');
      var h = px && live && el.isConnected && noZip() ? render(r[1], r[2], px.cell) : '';
      if (!h) { if (el.parentNode) el.parentNode.removeChild(el); return; }
      el.innerHTML = h;
      el.className = 'cb-sample';
      el.removeAttribute('aria-hidden');
    });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', go); else go();
})(typeof window !== 'undefined' ? window : this);
