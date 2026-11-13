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

  /* The reader's own state when the page already knows it (2026-11-09 panel: a
     Chetek WI reader saw IA, NE, KS, IL, MN and no Wisconsin). From the place the
     page saved or detected, never a guess: the first two-letter code found in the
     live geo state, the saved place, or the state the reader picked. -> 'WI' or ''. */
  function ownState(w) {
    var c = [], s, o;
    try { s = w.AGSIST_STATE; if (s) { c.push(s.state); if (s.weather) c.push(s.weather.state); } } catch (e) {}
    try { o = JSON.parse(w.localStorage.getItem('agsist-wx-loc') || 'null'); if (o) c.push(o.state); } catch (e) {}
    try { c.push(w.localStorage.getItem('agsist_state')); } catch (e) {}
    for (var i = 0; i < c.length; i++) if (typeof c[i] === 'string' && /^[A-Za-z]{2}$/.test(c[i])) return c[i].toUpperCase();
    return '';
  }

  /* The picture: each state's corn median bid on a ramp (cash where the futures quote is fresh, else the basis),
     from the same cells as the table. -> {states:{ST:{fill,text,href}}, lo, hi, n, metric:'cash'|'basis'} or null.
     Pure: the tests call it. */
  var RAMP = ['#f3e3b0', '#e2c36a', '#c99a2e', '#9c6f12', '#6b4a08'];
  function fmtV(v, metric) { return metric === 'cash' ? '$' + v.toFixed(2) : (v < 0 ? '' : '+') + Math.round(v * 100) + '¢'; }
  function mapData(bs, prices, cellFn, now) {
    if (!bs || !bs.states || typeof cellFn !== 'function') return null;
    var rows = [];
    Object.keys(bs.states).forEach(function (st) {
      var c = cellFn(bs, prices, st, 'corn', now);
      if (c) rows.push({ st: st, c: c });
    });
    if (rows.length < 3) return null;
    var metric = rows.every(function (r) { return r.c.cash != null; }) ? 'cash' : 'basis';
    var val = function (r) { return metric === 'cash' ? r.c.cash : r.c.median; };
    var lo = Infinity, hi = -Infinity;
    rows.forEach(function (r) { var v = val(r); if (v < lo) lo = v; if (v > hi) hi = v; });
    var out = {};
    rows.forEach(function (r) {
      var v = val(r), k = hi > lo ? Math.min(RAMP.length - 1, Math.floor((v - lo) / (hi - lo) * RAMP.length)) : 2;
      out[r.st] = { fill: RAMP[k], href: bs.states[r.st].path || '/cash-bids',
        text: (metric === 'cash' ? fmtV(v, 'cash') + ' corn' : r.c.basis + ' ' + r.c.fut + r.c.label + ' corn') + ', median of ' + r.c.n + ' elevators' };
    });
    return { states: out, lo: lo, hi: hi, n: rows.length, metric: metric };
  }

  /* -> html for the box, or '' (pure: tests call it). cellFn = AgPxStamp.cell,
     own = the reader's state code or ''. map = mapData() or null. */
  function render(bs, prices, cellFn, now, own, map) {
    if (!bs || !bs.states || typeof cellFn !== 'function') return '';
    var ranked = Object.keys(bs.states).filter(function (st) { return cellFn(bs, prices, st, 'corn', now); })
      .sort(function (a, b) { return (bs.states[b].elevators || 0) - (bs.states[a].elevators || 0) || (a < b ? -1 : 1); });
    own = String(own || '').toUpperCase();
    var mine = own && ranked.indexOf(own) >= 0;
    var sts = (mine ? [own].concat(ranked.filter(function (st) { return st !== own; })) : ranked).slice(0, TOP);
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
          esc(c.fut + c.label) + '<br>' + c.n + ' elevators</span></td>';
      }).join('');
      rows += '<tr><th scope="row"><a href="' + esc(bs.states[st].path || '/cash-bids') + '">' + esc(bs.states[st].name) + '</a></th>' + tds + '</tr>';
    });
    var pic = '';
    if (map) {
      pic = '<figure class="cbs-fig">' +
        '<div class="cbs-map" id="cbs-map" role="group" aria-label="Map of corn median bids by state"><div class="usm"><div class="usm-box"></div><p class="usm-read">&nbsp;</p></div></div>' +
        '<div class="cbs-row"><div class="cbs-leg" aria-hidden="true"><span>' + esc(fmtV(map.lo, map.metric)) + '</span>' +
        RAMP.map(function (f) { return '<i style="background:' + f + '"></i>'; }).join('') +
        '<span>' + esc(fmtV(map.hi, map.metric)) + '' + '</span></div>' +
        '<button type="button" class="cb-kit-btn" id="cbs-save">Save the picture</button></div>' +
        '<span class="skb-st" id="cbs-save-st" role="status" aria-live="polite"></span></figure>';
    }
    var line = '<p class="cbs-f">Estimates, not posted bids: ' + (on ? 'futures at ' + esc(on) + ' plus ' : '') + 'each state&rsquo;s median bid at the elevators AGSIST reads' +
      (asOf ? ', ' + esc(asOf) : '') + '.</p>';
    return '<h3 class="cbs-h">Median corn bid by state</h3>' + line + pic +
      '<table class="cbs-t">' + (mine ? '<caption class="cbs-cap">Your state first, then the states with the most elevators</caption>' : '') + '<thead><tr><th scope="col">State</th><th scope="col">Corn</th><th scope="col">Soybeans</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  /* "Save the picture": the map, its title, legend, date and source, as one PNG drawn here (no outside file). */
  function savePicture(doc, host, map, asOf, on, done) {
    var svg = host.querySelector('svg');
    if (!svg) return done(false);
    var c = svg.cloneNode(true), vb = (svg.getAttribute('viewBox') || '0 0 866.9 553.2').split(/\s+/).map(Number);
    [].forEach.call(c.querySelectorAll('.usm-s'), function (g, i) {
      var src = svg.querySelectorAll('.usm-s')[i], on1 = !/usm-off/.test(src.getAttribute('class') || '');
      var path = g.querySelector('path'), sp = src.querySelector('path'), tx = g.querySelector('text'), st = src.querySelector('text');
      path.setAttribute('fill', on1 ? (sp.style.fill || '#444') : '#2a3032'); path.setAttribute('stroke', '#0a0c0d'); path.setAttribute('stroke-width', '.9');
      var chip = g.querySelector('.usm-chip rect'), sc = src.querySelector('.usm-chip rect');
      if (chip) { chip.setAttribute('fill', on1 ? (sc.style.fill || '#444') : '#2a3032'); chip.setAttribute('stroke', '#0a0c0d'); }
      tx.setAttribute('fill', on1 ? (st.style.fill || '#fff') : '#9aa5a2'); tx.setAttribute('font-family', 'monospace'); tx.setAttribute('font-weight', '700');
      tx.setAttribute('font-size', tx.getAttribute('class') ? '26' : '17'); tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('dominant-baseline', 'central');
    });
    [].forEach.call(c.querySelectorAll('.usm-lead'), function (l) { l.setAttribute('stroke', '#9aa5a2'); l.setAttribute('stroke-width', '1.3'); l.setAttribute('fill', 'none'); });
    c.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); c.setAttribute('width', 1000); c.setAttribute('height', Math.round(1000 * vb[3] / vb[2]));
    var img = new root.Image(), W = 1080, MH = Math.round(1000 * vb[3] / vb[2]), H = MH + 330;
    img.onload = function () {
      try {
        var cv = doc.createElement('canvas'); cv.width = W; cv.height = H; var x = cv.getContext('2d');
        x.fillStyle = '#0a0c0d'; x.fillRect(0, 0, W, H); x.fillStyle = '#d4a23f'; x.fillRect(0, 0, W, 10);
        x.textBaseline = 'alphabetic'; x.fillStyle = '#d4a23f'; x.font = '800 44px sans-serif'; x.fillText('Corn, median ' + (map.metric === 'cash' ? 'bid' : 'basis') + ' by state', 40, 90);
        x.fillStyle = '#e9edeb'; x.font = '500 28px sans-serif'; x.fillText('Dollars per bushel' + (map.metric === 'cash' ? '' : ', cents under or over futures') + (asOf ? ', ' + asOf : ''), 40, 136);
        x.drawImage(img, 40, 170, 1000, MH);
        var y = 170 + MH + 50, w = 120;
        x.fillStyle = '#e9edeb'; x.font = '600 26px monospace'; x.fillText(fmtV(map.lo, map.metric), 40, y + 24);
        RAMP.forEach(function (f, i) { x.fillStyle = f; x.fillRect(190 + i * w, y, w, 34); });
        x.fillStyle = '#e9edeb'; x.fillText(fmtV(map.hi, map.metric), 190 + RAMP.length * w + 16, y + 24);
        x.fillStyle = 'rgba(233,237,235,.82)'; x.font = '500 24px sans-serif';
        x.fillText('Estimates, not posted bids' + (on ? ': futures at ' + on + ' plus' : ':') + ' each state’s median bid at the elevators AGSIST reads.', 40, y + 96);
        x.fillText('Source: AGSIST elevator bids and CME futures via Yahoo Finance. agsist.com/cash-bids', 40, y + 134);
        cv.toBlob(function (b) {
          if (!b) return done(false);
          var u = root.URL.createObjectURL(b), a = doc.createElement('a'); a.href = u; a.download = 'agsist-corn-median-bid-by-state.png';
          doc.body.appendChild(a); a.click(); doc.body.removeChild(a); setTimeout(function () { root.URL.revokeObjectURL(u); }, 4000); done(true);
        }, 'image/png');
      } catch (e) { done(false); }
    };
    img.onerror = function () { done(false); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new root.XMLSerializer().serializeToString(c));
  }

  var api = { render: render, mapData: mapData, ownState: ownState, TOP: TOP };
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
      s.src = '/components/price-local.js?v=15';
      s.onload = function () { ok(root.AgPxStamp || null); };
      s.onerror = function () { ok(null); };
      doc.head.appendChild(s);
    });
  }
  function mapLib() {
    if (root.AgUSMap) return Promise.resolve(root.AgUSMap);
    return new Promise(function (ok) {
      var s = doc.createElement('script');
      s.src = '/components/usmap.js?v=1';
      s.onload = function () { ok(root.AgUSMap || null); };
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
      var ok = px && live && el.isConnected && noZip(), own = ownState(root);
      var md = ok ? mapData(r[1], r[2], px.cell) : null;
      var h = ok ? render(r[1], r[2], px.cell, undefined, own, md) : '';
      if (!h) { if (el.parentNode) el.parentNode.removeChild(el); return; }
      el.innerHTML = h;
      el.className = 'cb-sample';
      el.removeAttribute('aria-hidden');
      var host = el.querySelector('#cbs-map');
      if (md && host) {
        mapLib().then(function (M) {
          if (!M || !host.isConnected) { if (host.parentNode) host.parentNode.removeChild(host.closest('figure') || host); return; }
          M.mount(host, { states: md.states, selected: md.states[own] ? own : null, name: 'Corn median bid by state', plain: true, hint: 'Tap a state to open its bids. ' + (md.metric === 'cash' ? 'Dollars a bushel.' : 'Cents a bushel against futures.') });
        });
        var btn = el.querySelector('#cbs-save'), say = el.querySelector('#cbs-save-st');
        if (btn) btn.addEventListener('click', function () {
          var c0 = px.cell(r[1], r[2], Object.keys(md.states)[0], 'corn');
          savePicture(doc, host, md, c0 ? c0.asOf : '', c0 ? c0.on : '', function (okk) {
            say.textContent = okk ? 'Picture saved.' : 'The picture could not be made here.';
            try { if (typeof root.gtag === 'function') root.gtag('event', 'picture_download', { page: 'cash-bids-map' }); } catch (e) {}
          });
        });
      }
    });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', go); else go();
})(typeof window !== 'undefined' ? window : this);
