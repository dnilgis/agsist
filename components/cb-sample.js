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
   ZIP to search, and then price-local.js, basis-states.json (12 KB) and prices.json.
   A search replaces the box, as it replaces the rest of the empty state.
   Tests: test/cash-bids-answers.test.mjs */
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
      '<table class="cbs-t"><thead><tr><th scope="col">State</th><th scope="col">Corn</th><th scope="col">Soybeans</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="cbs-f">About: ' + (on ? 'futures at ' + esc(on) + ' plus ' : '') + 'each state&rsquo;s median basis at AGSIST network elevators' +
      (asOf ? ', ' + esc(asOf) : '') + '. The five states with the most elevators. Your ZIP gives the real bids near you.</p>';
  }

  var api = { render: render, TOP: TOP };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgCbSample = api;
  var doc = root.document;
  if (!doc) return;

  function get(u) { return fetch(u, { cache: 'default' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
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
  function go() {
    var box = doc.querySelector('#cb-results .cb-empty');
    if (!box || !noZip()) return;
    Promise.all([stamp(), get('/data/basis-states.json'), get('/data/prices.json')]).then(function (r) {
      var px = r[0], live = doc.querySelector('#cb-results .cb-empty');
      if (!px || !live || !live.isConnected || !noZip()) return;
      var h = render(r[1], r[2], px.cell);
      if (!h) return;
      var el = doc.createElement('div');
      el.className = 'cb-sample';
      el.id = 'cb-sample';
      el.innerHTML = h;
      live.appendChild(el);
    });
  }
  /* after cash-bids.js has had its chance to run a saved ZIP (it waits 300 ms) */
  function later() { setTimeout(go, 400); }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', later); else later();
})(typeof window !== 'undefined' ? window : this);
