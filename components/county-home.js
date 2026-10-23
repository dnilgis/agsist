/* County farm facts, the rows that change every day (Oct 23, 2026).

   The Farmland Atlas county page is the county home. Its figures that move once a year are
   baked into the page by scripts/build_atlas_pages.py; the ones that move daily load here,
   from the same shared files and through the same row builders Fast Facts uses
   (components/place.js), so the county page and Fast Facts never print two different
   numbers for one thing:
     bids within 50 mi of the county middle (best and nearest, never a buyer's name),
     basis, corn and soybean futures, the livestock and hay lines the county's own head
     counts earn (data-lv, chosen by the builder), rain since Jan 1 at the county gauge,
     drought this week, hail in the last 30 days, the state's harvest pace, ARC/PLC sign-up.

   One definition per measure (county-spec.md, vision panel Oct 22): drought "this week" is
   the share of the county; the only drought week count on the page is the Atlas one (half
   the county or more in D2 or worse), so the "some of the county, N weeks in a row" streak
   Fast Facts adds is left off here.

   Fails soft: a file that does not answer turns its row into "not in right now", never a
   blank or an old number shown as new. Every row names its source and date. */
(function () {
  'use strict';
  var box = document.getElementById('ch-live');
  if (!box) return;
  var D = box.dataset, fips = D.fips, st = D.st;
  var lat = D.lat != null ? +D.lat : null, lng = D.lng != null ? +D.lng : null;
  var lines = (D.lv || '').split(',').filter(Boolean);
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var memo = {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function mdy(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : ''; }
  function md(iso) { return mdy(iso).replace(/, \d{4}$/, ''); }
  function getJSON(u, ms) {
    if (memo[u]) return memo[u];
    memo[u] = new Promise(function (ok) {
      var done = false, t = setTimeout(function () { if (!done) { done = true; ok(null); } }, ms || 12000);
      fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (j) { if (!done) { done = true; clearTimeout(t); ok(j); } });
    });
    return memo[u];
  }
  function loadScript(src, ready) {
    if (ready()) return Promise.resolve(true);
    return new Promise(function (ok) {
      var el = document.createElement('script');
      el.src = src; el.async = true;
      el.onload = function () { ok(ready()); };
      el.onerror = function () { ok(false); };
      document.head.appendChild(el);
    });
  }
  /* cents a bushel in the market's own eighths: 460.25 -> $4.60¼ */
  var EIGHTHS = { 0: '', 1: '⅛', 2: '¼', 3: '⅜', 4: '½', 5: '⅝', 6: '¾', 7: '⅞' };
  function px(c) {
    if (typeof c !== 'number' || !isFinite(c)) return '';
    var e = Math.round(c * 8), whole = Math.floor(e / 8), f = e - whole * 8;
    var d = Math.floor(whole / 100), r = whole - d * 100;
    return '$' + d + '.' + (r < 10 ? '0' : '') + r + EIGHTHS[f];
  }

  function rows(k) { return document.querySelectorAll('.lv[data-k="' + k + '"]'); }
  function html(f) {
    var d = /^\d{4}-\d{2}-\d{2}$/.test(f.date || '') ? mdy(f.date) : (f.date || '');
    var a = f.src ? (f.src[1] ? '<a href="' + esc(f.src[1]) + '">' + esc(f.src[0]) + '</a>' : esc(f.src[0])) : '';
    var s = (d || a) ? '<span class="ls">' + [esc(d), a].filter(Boolean).join(' &middot; ') + '</span>' : '';
    if (f.value == null) return '<span class="lvv na">Not in right now.</span> <span class="lc">' + esc(cap(f.why || 'the file did not load')) + '.</span>' + s;
    return '<span class="lvv">' + esc(f.value) + '</span>' + (f.ctx ? ' <span class="lc">' + esc(f.ctx) + '</span>' : '') + s;
  }
  function fill(k, f) {
    var els = rows(k);
    for (var i = 0; i < els.length; i++) {
      var el = els[i], r = el.querySelector('.r'), l = el.querySelector('.l');
      if (f.label && l) l.textContent = f.label;
      if (r) r.innerHTML = html(f);
      el.classList.toggle('lv-off', f.value == null);
    }
  }
  function fail(keys, why) { keys.forEach(function (k) { fill(k, { value: null, why: why }); }); }

  var P;
  var ALL = ['corn-bid', 'soy-bid', 'corn-basis', 'soy-basis', 'corn-fut', 'soy-fut', 'rain', 'drought', 'hail', 'corn-progress', 'soy-progress', 'arc'].concat(lines);
  var FROM = 'the county middle';

  /* ── bids and basis: the same pick as Fast Facts (P.bestBids over the live network, else the committed file) */
  function bids() {
    var net = window.AGSIST_BIDS_NET;
    function draw(snap) {
      var b = P.bestBids(snap, lat, lng, 50), when = snap && snap.fetched ? snap.fetched : '';
      fill('corn-bid', P.factBid(b.corn, 'corn', FROM, when, '/cash-bids'));
      fill('soy-bid', P.factBid(b.soybeans, 'soybeans', FROM, when, '/cash-bids'));
      b.when = when;
      return b;
    }
    var live = net && net.snapshot && lat != null && lng != null ? net.snapshot(lat, lng, { radiusMi: 50, maxPlaces: 100000 }) : Promise.resolve(null);
    return live.then(function (snap) {
      if (snap && snap.bids && snap.bids.length) return draw(snap);
      return getJSON('/data/bids.json').then(draw);
    }, function () { return getJSON('/data/bids.json').then(draw); });
  }
  function basis(local) {
    Promise.all([getJSON('/data/basis-states.json'), getJSON('/data/transport/basis.json'), local]).then(function (a) {
      var s = a[0] && a[0].states && a[0].states[st], href = s && s.path ? s.path : '/basis', b = a[2] || {};
      [['corn', 'Corn', 'corn-basis'], ['soybeans', 'Soybeans', 'soy-basis']].forEach(function (c) {
        var mine = b[c[0]] && b[c[0]].medianBasis != null ? { median: b[c[0]].medianBasis, n: b[c[0]].nBasis, when: b.when } : null;
        fill(c[2], P.factBasis(a[0] ? P.stateBasis(a[0], st, c[0]) : { status: 'none', why: 'the basis file did not load' }, a[1] ? P.basisVsNormal(a[1], st, c[1]) : null, c[0], st, href, mine, FROM));
      });
    });
  }

  /* ── futures, and the livestock lines in dollars a hundredweight */
  var LV = {
    milk: { name: 'Class III milk futures', head: 'milk cows', src: ['CME', '/milk-prices'] },
    feeders: { name: 'Feeder cattle futures', head: 'beef cows', src: ['CME', '/cattle-futures-prices'] },
    cattle: { name: 'Live cattle futures', head: 'cattle on feed', src: ['CME', '/cattle-futures-prices'] },
    hogs: { name: 'Lean hog futures', head: 'hogs', src: ['CME', null] }
  };
  function cwt(v) { return '$' + v.toFixed(2) + ' a cwt'; }
  function livestock(q, k, label) {
    var L = LV[k];
    if (!q || typeof q.close !== 'number') return { label: L.name, value: null, why: 'the price file did not load', src: L.src };
    var settle = q.close_kind === 'settle';
    var ch = typeof q.netChange === 'number' && isFinite(q.netChange) && q.prev_date
      ? ' ' + (Math.abs(q.netChange) < 0.005 ? 'Unchanged from' : (q.netChange > 0 ? 'Up $' : 'Down $') + Math.abs(q.netChange).toFixed(2) + ' from') + ' the ' + md(q.prev_date) + ' settle.' : '';
    var range = q.wk52_lo != null && q.wk52_hi != null ? ' 52-week range $' + q.wk52_lo.toFixed(2) + ' to $' + q.wk52_hi.toFixed(2) + '.' : '';
    var head = box.getAttribute('data-h-' + k);
    return { label: L.name, value: cwt(q.close), date: (settle ? q.settle_date || q.close_date : q.close_date) || '',
      ctx: (label ? label + ', ' : '') + (settle ? 'settle' : 'last trade, delayed') + '.' + ch + range + (head ? ' The county had ' + head + ' ' + L.head + ' in 2022.' : ''), src: L.src };
  }
  function futures() {
    getJSON('/data/prices.json').then(function (f) {
      var nb = (f && f.nearby) || {}, q = (f && f.quotes) || {};
      [['corn', 'Corn', '/corn-futures-prices', 'corn-fut'], ['beans', 'Soybean', '/soybean-futures-prices', 'soy-fut']].forEach(function (c) {
        var k = nb[c[0]] || {};
        fill(c[3], P.factFutures(f ? q[k.key] || q[c[0]] : null, c[1], k.label || '', c[2], px));
      });
      lines.forEach(function (k) {
        if (!LV[k]) return;
        var n = nb[k] || {};
        fill(k, livestock(f ? q[n.key] || q[k] : null, k, n.label || ''));
      });
    });
  }
  function hay() {
    if (lines.indexOf('hay') < 0) return;
    getJSON('/data/hay/hay-prices.json').then(function (h) {
      var label = 'Hay, ' + (P.STATES[st] || st) + ' price received', src = ['USDA NASS', '/hay-prices'];
      if (!h || !h.series || !h.months) { fill('hay', { label: label, value: null, why: 'the hay price file did not load', src: src }); return; }
      function last(kind) {
        var s = h.series[kind] && h.series[kind].states && h.series[kind].states[st];
        if (!s) return null;
        for (var i = s.length - 1; i >= 0; i--) if (typeof s[i] === 'number') return { v: s[i], m: h.months[i] };
        return null;
      }
      var a = last('alfalfa'), o = last('other');
      if (!a && !o) { fill('hay', { label: label, value: null, why: 'NASS published no hay price for ' + (P.STATES[st] || st) + ' in the months on file', src: src }); return; }
      var lead = a || o, mw = function (m) { var x = /^(\d{4})-(\d{2})$/.exec(m || ''); return x ? MONTHS[+x[2] - 1] + ' ' + x[1] : m; };
      fill('hay', { label: label, value: '$' + Math.round(lead.v) + ' a ton', date: h.released || '',
        ctx: (a ? 'Alfalfa' : 'Other hay') + ', ' + mw(lead.m) + '.' + (a && o ? ' Other hay $' + Math.round(o.v) + ' (' + mw(o.m) + ').' : '') + ' A state price; no county hay price exists.', src: src });
    });
  }

  /* ── weather and the season */
  var DNAME = ['abnormally dry', 'moderate drought', 'severe drought', 'extreme drought', 'exceptional drought'];
  function droughtRow(d) {
    var src = ['U.S. Drought Monitor', '/drought-monitor'];
    if (!d || d.status !== 'ok') return { label: 'Drought this week', value: null, why: d && d.why ? d.why : 'no Drought Monitor row', src: src };
    if (d.worst < 0) return { label: 'Drought this week', value: 'None', date: d.valid, ctx: 'No part of the county dry or in drought.', src: src };
    var k = d.now[1] > 0 ? 1 : 0;
    for (var i = 4; i >= 1; i--) if (d.now[i] >= 50) { k = i; break; }
    var pct = Math.round(d.now[k]), was = d.fourAgo && d.fourAgo[k] != null ? Math.round(d.fourAgo[k]) : null;
    var bits = ['Share of the county in D' + k + ' (' + DNAME[k] + ') or worse on the map.'];
    if (d.worst > k && d.now[d.worst] > 0) bits.push(Math.round(d.now[d.worst]) + '% in D' + d.worst + ' (' + DNAME[d.worst] + ').');
    bits.push(was == null ? 'No map four weeks earlier.' : was === pct ? 'Same as four weeks earlier.' : was + '% four weeks earlier.');
    return { label: 'Drought this week', value: pct + '% in D' + k + ' or worse', date: d.valid, ctx: bits.join(' '), src: src };
  }
  function weather() {
    getJSON('/data/rain/' + st.toLowerCase() + '.json').then(function (f) {
      fill('rain', P.factRain(P.rainSoFar(f, fips), D.rain || '/rain'));
    });
    getJSON('/data/drought/county-week.json').then(function (f) { fill('drought', droughtRow(P.droughtNow(f, fips))); });
    getJSON('/data/hail/recent.json').then(function (f) {
      fill('hail', P.factHail(P.hailNear(f, lat, lng), FROM, lat != null ? '/hail-map?lat=' + lat.toFixed(4) + '&lon=' + lng.toFixed(4) : '/hail-map'));
    });
  }
  function crops() {
    getJSON('/data/crop-progress.json').then(function (f) {
      fill('corn-progress', P.factProgress(f, st, 'corn'));
      fill('soy-progress', P.factProgress(f, st, 'soybeans'));
    });
  }
  function centralDay() { try { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); } catch (e) { return new Date().toISOString().slice(0, 10); } }
  function arc() { getJSON('/data/arc-plc.json').then(function (f) { fill('arc', P.factArcPlc(f, centralDay(), D.arc || '/arc-plc')); }); }

  function start() {
    loadScript('/components/place.js?v=5', function () { return !!window.AgPlace; }).then(function (ok) {
      if (!ok) { fail(ALL, 'this part did not load; try again in a minute'); return; }
      P = window.AgPlace;
      if (lat == null || lng == null) fail(['corn-bid', 'soy-bid'], 'no county middle on file to measure from');
      var b = lat == null ? Promise.resolve(null) : loadScript('/components/bids-network.js?v=8', function () { return !!window.AGSIST_BIDS_NET; }).then(bids);
      basis(b.then(null, function () { return null; }));
      futures(); hay(); weather(); crops(); arc();
    });
  }
  /* after the page has drawn: the shared files are the ones Fast Facts reads, so they are often cached */
  function soon() { if (window.requestIdleCallback) requestIdleCallback(start, { timeout: 1500 }); else setTimeout(start, 200); }
  if (document.readyState === 'complete') soon(); else window.addEventListener('load', soon);
})();
