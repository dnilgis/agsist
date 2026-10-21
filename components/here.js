/* Fast Facts, My place (Oct 21, 2026; was /here, Oct 18). components/place.js holds the
   numbers and the row builders; this file finds the place, fetches only what the open tab
   shows, and draws it.

   The ZIP is asked once: a saved ZIP (the keys loader.js reads) opens the place with no
   question, and location is used only when "Use my location" is tapped. Once a place is
   open the box folds behind "Change place". Four cards follow, one dated, sourced row per
   number (#f-corn-bid ... #f-daily). "More about this county" (the year's rain drawn and
   ranked, state ranks, neighbors, the long view, elevators against their neighbors) loads
   only when it is opened or a report is printed. The State and US tabs use the same row
   builders. No buyer, seller, elevator or co-op name is drawn anywhere: the page is indexed.

   URL: ?q= &fips= &zip= &at=lat,lng &print=<parts>, and the short f z a p keys the printed
   QR carries. The tab is the #hash (the head script in fast-facts.html sets it before paint). */
(function () {
  'use strict';
  var P = window.AgPlace, L = window.AGLayers;
  if (!P) return;
  var GEO_API = 'https://geocoding-api.open-meteo.com/v1/search';
  var LS_ZIP = 'agsist_user_zip';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var SALES_JS = '/components/atlas-sales.js?v=c3fa7673';
  var S = { seq: 0, where: null, prof: null, county: null, pct: null, sales: {}, depth: null, print: { parts: P.PRINT_PARTS.slice(), more: false }, started: false, state: null };
  var memo = {};

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function track(n, p) { try { if (typeof gtag === 'function') gtag('event', n, p || {}); } catch (e) {} }
  function getJSON(u, ms) {
    if (memo[u]) return memo[u];
    var p = new Promise(function (ok) {
      var done = false, t = setTimeout(function () { if (!done) { done = true; ok(null); } }, ms || 12000);
      fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (j) { if (!done) { done = true; clearTimeout(t); ok(j); } });
    });
    memo[u] = p.then(function (j) { if (j == null) delete memo[u]; return j; });
    return memo[u];
  }
  function getText(u) { return fetch(u).then(function (r) { return r.ok ? r.text() : null; }).catch(function () { return null; }); }
  function mdy(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : ''; }
  function say(msg, err) { var el = $('h-status'); if (!el) return; el.textContent = msg || ''; el.className = 'h-status' + (err ? ' err' : ''); }
  function na(why) { return '<p class="h-na">Not available: ' + esc(why) + '.</p>'; }
  function px(c, mode) { return window.AG && AG.px ? AG.px.price(c, mode ? { mode: mode } : null) : '$' + (c / 100).toFixed(2); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
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
  /* The rain drawing's stylesheet (the county rain page's), fetched with the depth only. */
  function css(href) {
    if (document.querySelector('link[href="' + href + '"]')) return Promise.resolve();
    return new Promise(function (ok) {
      var l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = href; l.onload = l.onerror = function () { ok(); };
      document.head.appendChild(l);
      setTimeout(ok, 4000);
    });
  }
  function tab() { return document.documentElement.getAttribute('data-fx') || 'place'; }

  /* ── one row ─────────────────────────────────────────────────────── */
  /* A fact from place.js into its row: the value, one line of context, the date and its source. */
  function factHtml(f) {
    var d = /^\d{4}-\d{2}-\d{2}$/.test(f.date || '') ? mdy(f.date) : (f.date || '');
    var a = f.src ? (f.src[1] ? '<a href="' + esc(f.src[1]) + '">' + esc(f.src[0]) + '</a>' : esc(f.src[0])) : '';
    var s = (d || a) ? '<span class="fx-s">' + [esc(d), a].filter(Boolean).join(' &middot; ') + '</span>' : '';
    if (f.value == null) return '<p class="fx-b"><span class="fx-v fx-na">Not available</span>. <span class="fx-c">' + esc(cap(f.why)) + '.</span></p>' + s;
    return '<p class="fx-b"><span class="fx-v' + (f.long ? ' fx-vl' : '') + '">' + esc(f.value) + '</span>' + (f.ctx ? (f.join || '. ') + '<span class="fx-c">' + esc(f.ctx) + '</span>' : '') + '</p>' + s;
  }
  function fill(id, f) {
    var el = $(id); if (!el || !f) return;
    var l = el.querySelector('.fx-l'); if (l && f.label) l.textContent = f.label;
    var b = el.querySelector('.fx-w'); if (b) b.innerHTML = factHtml(f);
    el.classList.toggle('fx-off', f.value == null);
  }
  function waitRows(ids) { ids.forEach(function (id) { var el = $(id), b = el && el.querySelector('.fx-w'); if (b) b.innerHTML = '<p class="fx-b fx-wait">Reading&hellip;</p>'; }); }

  /* ── the shared files, one builder per number ─────────────────────── */
  function futures(prefix) {
    getJSON('/data/prices.json').then(function (f) {
      var nb = (f && f.nearby) || {}, q = (f && f.quotes) || {};
      [['corn', 'Corn', '/corn-futures-prices'], ['beans', 'Soybean', '/soybean-futures-prices'], ['wheat', 'Wheat', '/wheat-futures-prices']].forEach(function (c) {
        var k = nb[c[0]] || {};
        fill(prefix + (c[0] === 'beans' ? 'soy' : c[0]) + '-fut', P.factFutures(f ? q[k.key] || q[c[0]] : null, c[1], k.label || '', c[2], px));
      });
    });
  }
  function basis(prefix, st) {
    Promise.all([getJSON('/data/basis-states.json'), getJSON('/data/transport/basis.json')]).then(function (a) {
      var s = a[0] && a[0].states && a[0].states[st], href = s && s.path ? s.path : '/basis';
      [['corn', 'Corn'], ['soybeans', 'Soybeans']].forEach(function (c) {
        fill(prefix + (c[0] === 'corn' ? 'corn' : 'soy') + '-basis', P.factBasis(a[0] ? P.stateBasis(a[0], st, c[0]) : { status: 'none', why: 'the basis file did not load' }, a[1] ? P.basisVsNormal(a[1], st, c[1]) : null, c[0], st, href));
      });
    });
  }
  function progress(id, st, crop) { getJSON('/data/crop-progress.json').then(function (f) { fill(id, P.factProgress(f, st, crop)); }); }
  function usda(id) {
    getText('/usda-calendar.ics').then(function (t) {
      var r = P.nextReport(t, new Date());
      fill(id, P.factUsda(r, r ? r.at.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''));
    });
  }
  function fert(id) { getJSON('/data/fertilizer-prices.json').then(function (f) { fill(id, P.factFert(f)); }); }
  function daily(id) { getJSON('/data/daily.json').then(function (f) { fill(id, P.factDaily(f)); }); }

  /* ── finding the place ───────────────────────────────────────────── */
  function geocode(name) {
    return fetch(GEO_API + '?name=' + encodeURIComponent(name) + '&count=10&language=en&format=json&countryCode=US')
      .then(function (r) { if (!r.ok) throw new Error('geo ' + r.status); return r.json(); })
      .then(function (d) { return (d && d.results) || []; });
  }
  function stFile(st) { return getJSON('/data/atlas/pct/' + st + '.json'); }
  function geoFile() { return getJSON('/data/atlas/counties.geo.json', 30000); }
  function pointToCounty(lat, lng) { return geoFile().then(function (g) { return g ? P.countyAt(g, lat, lng) : null; }); }
  function rowToCounty(r) {
    var st = P.stateFromName(r.admin1);
    if (!st) return Promise.resolve(null);
    return stFile(st).then(function (pct) {
      var f = pct && r.admin2 ? P.countyInState(pct, r.admin2) : null;
      return f || pointToCounty(r.latitude, r.longitude);
    });
  }
  function go(text, how) {
    var c = P.classify(text), my = ++S.seq;
    $('h-choices').innerHTML = '';
    if (c.kind === 'empty') { say('Type a ZIP, a town and state, or a county.', true); return Promise.resolve(false); }
    track('here_find', { by: how || c.kind });
    if (c.kind === 'zip') return byZip(c.zip, my);
    if (c.kind === 'point') return byPoint(c.at, my, null);
    if (c.kind === 'county') return byCounty(c.name, c.st, my);
    return byTown(c.name, c.st, my, text);
  }
  function byZip(zip, my) {
    say('Looking up ZIP ' + zip + '…');
    return geocode(zip).then(function (res) {
      if (my !== S.seq) return false;
      var r = res.filter(function (x) { return (x.postcodes || []).indexOf(zip) >= 0; })[0] || res[0];
      if (!r) throw new Error('no zip');
      return rowToCounty(r).then(function (f) {
        if (my !== S.seq) return false;
        if (!f) throw new Error('no county');
        return open(f, { zip: zip, lat: r.latitude, lng: r.longitude, label: r.name + ', ' + (P.stateFromName(r.admin1) || ''), how: 'zip' }, my);
      });
    }).catch(function () {
      if (my !== S.seq) return false;
      /* The place lookup did not answer: the ZIP table the cash bid search uses, then the county map. */
      var net = window.AGSIST_BIDS_NET;
      return (net && net.zipCoord ? net.zipCoord(zip) : Promise.resolve(null)).then(function (pt) {
        if (my !== S.seq) return false;
        if (!pt) { say('No ZIP ' + zip + ' in the place lookup. Try the town and state, or the county.', true); return false; }
        return pointToCounty(pt.lat, pt.lon).then(function (f) {
          if (my !== S.seq) return false;
          if (!f) { say('ZIP ' + zip + ' did not land in a county. Try the town and state.', true); return false; }
          return open(f, { zip: zip, lat: pt.lat, lng: pt.lon, label: 'ZIP ' + zip, how: 'zip' }, my);
        });
      });
    });
  }
  function byPoint(at, my, label) {
    say('Finding the county…');
    return pointToCounty(at.lat, at.lng).then(function (f) {
      if (my !== S.seq) return false;
      if (!f) { say('That point is not inside a US county. The county figures cover the 50 states.', true); return false; }
      return open(f, { lat: at.lat, lng: at.lng, point: true, label: label || (at.lat.toFixed(4) + ', ' + at.lng.toFixed(4)), how: 'point' }, my);
    });
  }
  function byCounty(name, st, my) {
    say('Looking up ' + name + (st ? ', ' + st : '') + '…');
    return getJSON('/data/atlas/pct/index.json').then(function (idx) {
      if (my !== S.seq) return false;
      if (!idx) { say('The county list did not load. Try again in a minute.', true); return false; }
      var hits = P.findCounty(idx, name, st);
      if (!hits.length) { say('No county called “' + name + '”' + (st ? ' in ' + P.STATES[st] : '') + '. Check the spelling, or type a town or ZIP.', true); return false; }
      if (hits.length === 1) return open(hits[0].fips, { label: hits[0].name + ', ' + hits[0].st, how: 'county' }, my);
      choose(hits.map(function (h) { return { text: h.name + ', ' + h.st, fips: h.fips }; }), 'More than one “' + name + '”. Pick yours:');
      return false;
    });
  }
  function byTown(name, st, my, typed) {
    say('Looking up ' + typed + '…');
    return geocode(name).then(function (res) {
      if (my !== S.seq) return false;
      if (st) res = res.filter(function (r) { return P.stateFromName(r.admin1) === st; });
      var seen = {}, uniq = [];
      res.forEach(function (r) { var k = r.admin1 + '|' + (r.admin2 || r.name); if (!seen[k] && P.stateFromName(r.admin1)) { seen[k] = 1; uniq.push(r); } });
      if (!uniq.length) { say('No place called “' + name + '”' + (st ? ' in ' + P.STATES[st] : '') + '. Try a ZIP, or the county.', true); return false; }
      if (uniq.length === 1) return townOpen(uniq[0], my);
      choose(uniq.slice(0, 8).map(function (r) { return { text: r.name + ', ' + (r.admin2 ? r.admin2 + ', ' : '') + P.stateFromName(r.admin1), row: r }; }), 'More than one “' + name + '”. Pick yours:');
      return false;
    }).catch(function () {
      if (my !== S.seq) return false;
      say('The place lookup did not answer. Type the county (“Barron County, WI”), or pick on the map.', true);
      return false;
    });
  }
  function townOpen(r, my) {
    return rowToCounty(r).then(function (f) {
      if (my !== S.seq) return false;
      if (!f) { say('That town did not land in a county.', true); return false; }
      return open(f, { lat: r.latitude, lng: r.longitude, label: r.name + ', ' + P.stateFromName(r.admin1), how: 'town' }, my);
    });
  }
  function choose(list, lead) {
    say(lead);
    var box = $('h-choices');
    box.innerHTML = list.map(function (c, i) { return '<button type="button" class="h-chip" data-i="' + i + '">' + esc(c.text) + '</button>'; }).join('');
    box.onclick = function (e) {
      var b = e.target.closest('button[data-i]'); if (!b) return;
      var c = list[+b.getAttribute('data-i')], my = ++S.seq;
      box.innerHTML = '';
      if (c.fips) open(c.fips, { label: c.text, how: 'county' }, my); else townOpen(c.row, my);
    };
  }
  /* The ZIP saved on this device, from the keys loader.js reads: agsist-wx-loc, then
     agsist_user_zip, then agsist_zip. */
  function savedZip() {
    var o = null;
    try { o = JSON.parse(lsGet('agsist-wx-loc') || 'null'); } catch (e) { o = null; }
    if (o && /^\d{5}$/.test(String(o.zip || ''))) return String(o.zip);
    var z = String(lsGet('agsist_user_zip') || lsGet('agsist_zip') || '');
    return /^\d{5}$/.test(z) ? z : null;
  }
  function savedState() {
    var o = null;
    try { o = JSON.parse(lsGet('agsist-wx-loc') || 'null'); } catch (e) { o = null; }
    return o && P.STATES[o.state] ? o.state : null;
  }

  /* ── one county ──────────────────────────────────────────────────── */
  function open(fips, where, my) {
    var st = P.stateOf(fips);
    if (!st) { say('That is not a county code we know.', true); return Promise.resolve(false); }
    say('Reading the county figures…');
    return Promise.all([stFile(st), getJSON('/data/atlas/counties/' + fips + '.json'), getJSON('/data/layers.json')]).then(function (a) {
      if (my != null && my !== S.seq) return false;
      var pct = a[0], county = a[1], reg = null;
      try { reg = a[2] && L ? L.load(a[2]) : null; } catch (e) { reg = null; }
      var prof = pct ? P.profile(pct, fips, reg) : null;
      if (!prof) { say('The county figures did not load. Refresh in a minute.', true); return false; }
      where = where || {};
      if (where.lat == null && prof.center) { where.lat = prof.center.lat; where.lng = prof.center.lng; where.center = true; }
      S.where = where; S.prof = prof; S.county = county; S.pct = pct; S.depth = null;
      if (where.zip) lsSet(LS_ZIP, where.zip);
      say('');
      render();
      writeUrl();
      loadCards(fips);
      if ($('h-more') && $('h-more').open) loadDepth();
      if (tab() === 'state') drawState();
      return true;
    });
  }
  function writeUrl() {
    var w = S.where || {}, p = S.prof, q = [];
    if (!p) return;
    q.push('fips=' + p.fips);
    if (w.zip) q.push('zip=' + w.zip);
    else if (w.lat != null && !w.center) q.push('at=' + (+w.lat).toFixed(4) + ',' + (+w.lng).toFixed(4));
    if (w.how === 'town' && w.label) q.push('q=' + encodeURIComponent(w.label));
    var pr = P.printParam(S.print);
    if (pr) q.push('print=' + pr);
    try { history.replaceState(null, '', location.pathname + '?' + q.join('&') + location.hash); } catch (e) {}
    buildQr();
  }
  function fromWords(w) { return w.zip ? 'ZIP ' + w.zip : w.center ? 'the county center' : w.how === 'town' ? w.label : 'this spot'; }

  /* ── drawing ─────────────────────────────────────────────────────── */
  function salesIn(st) {
    if (!(st in S.sales)) S.sales[st] = getJSON('/data/land/' + st.toLowerCase() + '/index.json', 10000).then(function (ix) { return !!(ix && ix.counties && ix.counties.length); });
    return S.sales[st];
  }
  function drawDeeper(sales) {
    var p = S.prof, w = S.where || {};
    if (!p) return;
    var list = P.deeper({ fips: p.fips, st: p.st, slug: p.slug, flags: p.flags, lat: w.lat, lng: w.lng, zip: w.zip, point: !!w.point && !w.center, sales: !!sales });
    $('h-links').innerHTML = list.map(function (l) { return '<a href="' + esc(l.href) + '" data-k="' + l.id + '">' + esc(l.text) + '</a>'; }).join('');
  }
  function render() {
    var p = S.prof, w = S.where;
    document.documentElement.classList.add('h-has');
    $('h-title').textContent = p.name + ', ' + p.stName;
    var from = w.zip ? 'ZIP ' + w.zip + (w.label && w.label !== 'ZIP ' + w.zip ? ' (' + w.label + ')' : '') : w.how === 'town' ? w.label : w.point ? 'the point ' + w.label : null;
    $('h-where').textContent = (from ? 'From ' + from + ', in ' + p.name + '. ' : '') + 'County figures; ranks are among ' + p.stName + ' counties.';
    $('h-sent').textContent = p.sentence;
    $('h-find').hidden = true;
    $('h-change').hidden = false;
    $('h-change-l').textContent = from || (p.name + ', ' + p.st);
    drawDeeper(false);
    var fips = p.fips;
    salesIn(p.st).then(function (has) { if (has && S.prof && S.prof.fips === fips) drawDeeper(true); });
    var nb = p.neighbors.filter(function (n) { return n.name; });
    $('h-nb').innerHTML = nb.length ? 'Next door: ' + nb.map(function (n) { return '<a href="?fips=' + n.fips + '" data-fips="' + n.fips + '">' + esc(n.name) + '</a>'; }).join(' · ') : '';
    drawOdd(p);
    drawCover(p);
    resetDepth();
    applyPrint();
    $('h-place').hidden = false;
    var none = $('h-pr-none'); if (none) none.hidden = true;
    var pb = $('h-pr-box'); if (pb) pb.hidden = false;
    var pn = $('h-pr-name'); if (pn) pn.textContent = p.name + ', ' + p.stName;
    if ($('h-map-box').open) drawMap();
  }

  /* What stands out here against its own record: at most three lines from the county's own
     Atlas record, each with the years it was weighed against. Nothing shows when none passes. */
  function drawOdd(p) {
    var box = $('h-odd'), list = P.unusualHere(S.county, thisYear()).slice(0, 3);
    S.odd = list;
    if (!list.length) { box.hidden = true; $('h-odd-l').innerHTML = ''; return; }
    box.hidden = false;
    $('h-odd-l').innerHTML = list.map(function (l) {
      return '<li><span>' + esc(l.words) + '</span> <span class="h-src">' + esc(l.source) + ', ' + esc(mdy((S.county && S.county.generated) || p.atlasGenerated)) + '.</span></li>';
    }).join('');
  }

  /* The four cards. Every row is in the page already (an anchor a link can open); each fills
     in as its file answers, or says why not. */
  var PLACE_ROWS = ['f-corn-bid', 'f-soy-bid', 'f-corn-basis', 'f-soy-basis', 'f-corn-fut', 'f-soy-fut', 'f-rain', 'f-drought', 'f-hail', 'f-progress',
    'f-rent', 'f-land', 'f-sales', 'f-loss', 'f-arcplc', 'f-usda', 'f-fert', 'f-daily'];
  function loadCards(fips) {
    var p = S.prof, st = p.st, w = S.where, slug = P.stSlug(st);
    function mine() { return S.prof && S.prof.fips === fips; }
    waitRows(PLACE_ROWS);
    var by = {};
    p.cols.forEach(function (c) { by[c.id] = c; });
    var atlas = p.flags.indexOf('a') >= 0 ? '/farmland-atlas/' + slug + '/' + p.slug : '/farmland-atlas';
    fill('f-rent', P.factCol(by.rent, 'Cash rent', (' ' + P.NO_PAGE.rent + ' ').indexOf(' ' + st + ' ') < 0 ? '/rent/' + slug : atlas));
    fill('f-land', P.factCol(by.land_value, 'Farmland value', atlas));
    fill('f-loss', P.factCol(by.loss_ratio, 'Crop insurance paid out per $1 of premium', atlas));
    loadBids(fips, w);
    basis('f-', st);
    futures('f-');
    progress('f-progress', st, 'corn');
    getJSON('/data/rain/' + st.toLowerCase() + '.json').then(function (f) {
      if (!mine()) return;
      fill('f-rain', P.factRain(P.rainSoFar(f, fips), p.flags.indexOf('r') >= 0 ? '/rain/' + slug + '/' + p.slug : '/rain/' + slug));
    });
    getJSON('/data/drought/county-week.json').then(function (f) { if (mine()) fill('f-drought', P.factDrought(P.droughtNow(f, fips))); });
    getJSON('/data/hail/recent.json').then(function (f) {
      if (!mine()) return;
      fill('f-hail', P.factHail(P.hailNear(f, w.lat, w.lng), w.center ? 'the county center' : w.zip ? 'ZIP ' + w.zip : 'this spot', '/hail-map?lat=' + (+w.lat).toFixed(4) + '&lon=' + (+w.lng).toFixed(4)));
    });
    loadSales(fips, st, atlas, mine);
    getJSON('/data/arc-plc.json').then(function (f) {
      if (!mine()) return;
      var today = new Date().toISOString().slice(0, 10);
      fill('f-arcplc', P.factArcPlc(f, today, p.flags.indexOf('c') >= 0 ? '/arc-plc/' + slug + '/' + p.slug : '/arc-plc'));
    });
    usda('f-usda');
    fert('f-fert');
    daily('f-daily');
  }
  function loadSales(fips, st, href, mine) {
    var A = window.AtlasSales;
    if (!/^(IL|WI)$/.test(st) && !(A && A.STATES && A.STATES[st])) { fill('f-sales', P.factSales(null, st)); return; }
    loadScript(SALES_JS, function () { return !!(window.AtlasSales && window.AtlasSales.tile); }).then(function (ok) {
      if (!mine()) return;
      if (!ok) { fill('f-sales', { label: 'Recorded farm sales', value: null, why: 'the sales summary did not load' }); return; }
      getJSON(window.AtlasSales.url(st)).then(function (sum) {
        if (!mine()) return;
        fill('f-sales', sum ? P.factSales(window.AtlasSales.tile(sum, fips), st, href) : { label: 'Recorded farm sales', value: null, why: 'the sales summary did not load' });
      });
    });
  }
  function loadBids(fips, w) {
    var net = window.AGSIST_BIDS_NET, lat = +w.lat, lng = +w.lng;
    var from = fromWords(w), href = w.zip ? '/cash-bids?zip=' + w.zip : '/cash-bids';
    function draw(snap) {
      if (!S.prof || S.prof.fips !== fips) return;
      var b = P.bestBids(snap, lat, lng, 50), when = snap && snap.fetched ? snap.fetched : '';
      fill('f-corn-bid', P.factBid(b.corn, 'corn', from, when, href));
      fill('f-soy-bid', P.factBid(b.soybeans, 'soybeans', from, when, href));
    }
    var live = net && net.snapshot && isFinite(lat) && isFinite(lng) ? net.snapshot(lat, lng, { radiusMi: 50 }) : Promise.resolve(null);
    live.then(function (snap) {
      if (snap && snap.bids && snap.bids.length) { draw(snap); return; }
      getJSON('/data/bids.json').then(draw);
    }, function () { getJSON('/data/bids.json').then(draw); });
  }

  /* ── State and US tabs: the same builders ─────────────────────────── */
  function drawState(st) {
    st = st || (S.prof && S.prof.st) || S.state || savedState();
    var pick = $('s-pick'), body = $('s-body');
    if (!pick || !body) return;
    if (!st) { body.hidden = true; $('s-none').hidden = false; return; }
    S.state = st;
    pick.value = st;
    $('s-none').hidden = true;
    body.hidden = false;
    $('s-name').textContent = P.STATES[st];
    waitRows(['s-corn-basis', 's-soy-basis', 's-corn-prog', 's-soy-prog']);
    basis('s-', st);
    progress('s-corn-prog', st, 'corn');
    progress('s-soy-prog', st, 'soybeans');
    getJSON('/data/basis-states.json').then(function (f) {
      if (S.state !== st) return;
      $('s-links').innerHTML = P.stateLinks(st, f).map(function (l) { return '<a href="' + esc(l.href) + '" data-k="' + l.id + '">' + esc(l.text) + '</a>'; }).join('');
    });
  }
  var usDone = false;
  function drawUS() {
    if (usDone) return;
    usDone = true;
    futures('u-');
    progress('u-corn-prog', null, 'corn');
    progress('u-soy-prog', null, 'soybeans');
    usda('u-usda');
    fert('u-fert');
    daily('u-daily');
  }

  /* ── More about this county: loads on open, or for a printed report ───── */
  function resetDepth() {
    S.depth = null;
    ['h-rank', 'h-rank-sub', 'h-rp-box', 'h-fp', 'h-fp-t', 'h-un', 'h-long', 'h-elev-b'].forEach(function (id) { var el = $(id); if (el) el.innerHTML = ''; });
    var t = $('h-years'); if (t) t.hidden = true;
  }
  function loadDepth() {
    var p = S.prof;
    if (!p) return Promise.resolve(false);
    if (S.depth) return S.depth;
    track('here_more', {});
    drawFingerprint(p);
    drawUnusual(p);
    drawLong(S.county);
    S.depth = Promise.all([css('/components/rain-county.css?v=5'), drawFirst(p), loadElev(p.fips, S.where)]);
    return S.depth;
  }
  function drawFingerprint(p) {
    var cols = p.cols, have = cols.filter(function (c) { return c.pos != null; }).length;
    $('h-fp-h').textContent = 'How ' + p.name + ' ranks in ' + p.stName;
    $('h-fp').innerHTML = cols.map(function (c) {
      var h = c.pos == null ? 0 : Math.max(3, Math.round(c.pos * 100));
      var cls = 'fp-c' + (c.band ? ' fp-' + c.band : '') + (c.pos == null ? ' fp-na' : '');
      var tip = c.label + ': ' + (c.value == null ? 'not available' : P.fmt(c.value, c) + (c.words ? ', ' + c.words : ''));
      return '<button type="button" class="' + cls + '" data-i="' + c.i + '" aria-label="' + esc(tip) + '"><span class="fp-bar"><span class="fp-fill" style="height:' + h + '%"></span></span><span class="fp-l">' + esc(c.short) + '</span></button>';
    }).join('');
    $('h-fp').setAttribute('aria-label', 'Where ' + p.name + ' sits among ' + p.stName + ' counties on ' + have + ' figures, lowest county at the bottom, highest at the top. The same numbers are in the table below.');
    $('h-fp-d').textContent = 'Tap a column for its number. Gold: top or bottom tenth of ' + p.stName + ' counties.';
    $('h-fp').onclick = function (e) {
      var b = e.target.closest('button[data-i]'); if (!b) return;
      var c = p.cols[+b.getAttribute('data-i')];
      $('h-fp-d').textContent = c.label + ': ' + (c.value == null ? 'not available. ' + (c.reason || '') : P.fmt(c.value, c) + (c.words ? ', ' + c.words : '') + '. ' + (c.source || '') + ', ' + c.years + '.');
    };
    $('h-fp-t').innerHTML = '<caption class="sr-only">Each figure, its value here, where it sits in the state, and its source</caption><thead><tr><th scope="col">Figure</th><th scope="col">Here</th><th scope="col">Where it sits in ' + esc(p.stName) + '</th><th scope="col">Source</th></tr></thead><tbody>' +
      cols.map(function (c) {
        var here = c.value == null ? '<span class="h-na">Not available</span>' + (c.other ? ' (' + esc(P.fmt(c.other.value, c)) + ' in ' + esc(c.other.year) + ')' : '') : esc(P.fmt(c.value, c));
        var where = c.value == null ? esc(c.reason || '') : esc(c.words || '') + (c.band ? ' <span class="h-flag">' + (c.band === 'top' ? 'top tenth' : 'bottom tenth') + '</span>' : '');
        return '<tr><th scope="row">' + esc(c.label) + '</th><td>' + here + '</td><td>' + where + '</td><td>' + esc(c.source || '') + ', ' + esc(c.years) + '</td></tr>';
      }).join('') + '</tbody>';
  }

  /* The printed sheet's first page (print only): the place, the sentence, six headline
     figures with their state rank and source, and every figure's place in the state. */
  function printedOn() { var now = new Date(); return 'Printed ' + MONTHS[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear(); }
  var HEAD = ['rent', 'land_value', 'yield', 'loss_ratio', 'drought', 'gs_rain'];
  function drawCover(p) {
    var w = S.where || {}, by = {};
    p.cols.forEach(function (c) { by[c.id] = c; });
    var from = w.zip ? 'ZIP ' + w.zip + (w.label && w.label !== 'ZIP ' + w.zip ? ', ' + w.label : '') : w.how === 'town' ? w.label : w.point ? 'the point ' + w.label : '';
    var tiles = HEAD.map(function (id) {
      var c = by[id]; if (!c) return '';
      var v = c.value == null ? '<span class="pc-na">Not available</span>' : esc(P.fmtShort(c.value, c));
      return '<div class="pc-t' + (c.band ? ' pc-band' : '') + '"><p class="pc-l">' + esc(c.short) + '</p><p class="pc-v">' + v + '</p>' +
        '<p class="pc-r">' + esc(c.value == null ? (c.reason || '') : (c.words || '')) + (c.band ? ' <b>' + (c.band === 'top' ? 'Top tenth' : 'Bottom tenth') + '</b>' : '') + '</p>' +
        '<p class="pc-s">' + esc(c.source || '') + ', ' + esc(c.years || '') + '</p></div>';
    }).join('');
    var rows = p.cols.map(function (c) {
      var pos = c.pos == null ? null : Math.max(0, Math.min(1, c.pos));
      return '<div class="pd-r' + (c.band ? ' pd-band' : '') + (pos == null ? ' pd-na' : '') + '"><span class="pd-l">' + esc(c.short) + '</span>' +
        '<span class="pd-tr">' + (pos == null ? '' : '<span class="pd-dot" style="left:' + (pos * 100).toFixed(1) + '%"></span>') + '</span>' +
        '<span class="pd-v">' + (c.value == null ? 'n/a' : esc(P.fmtShort(c.value, c))) + '</span></div>';
    }).join('');
    var srcs = {}, list = [];
    p.cols.forEach(function (c) { if (c.source && !srcs[c.source]) { srcs[c.source] = 1; list.push(c.source); } });
    $('h-pr-cover').innerHTML =
      '<div class="pc-head"><span class="pc-brand">AGSIST</span><span>Fast Facts</span><span id="h-pr-date">' + esc(printedOn()) + '</span></div>' +
      '<div class="pc-top"><div><h2 class="pc-name">' + esc(p.name) + ', ' + esc(p.stName) + '</h2>' +
      '<p class="pc-from">' + (from ? 'From ' + esc(from) + '. ' : '') + 'County figures. Ranks are among ' + esc(p.stName) + ' counties.</p></div>' +
      '<div class="pc-qr" id="h-pr-qr1"></div></div>' +
      '<p class="pc-sent h-part-sentence-pr">' + esc(p.sentence) + '</p>' +
      '<div class="pc-fp"><div class="pc-tiles">' + tiles + '</div>' +
      '<h3 class="pc-h">Where ' + esc(p.name) + ' sits among ' + esc(p.stName) + ' counties</h3>' +
      '<div class="pd"><div class="pd-r pd-ax"><span class="pd-l"></span><span class="pd-tr"><span>Lowest county</span><span>Middle</span><span>Highest county</span></span><span class="pd-v">Here</span></div>' + rows + '</div>' +
      '<p class="pc-key">Black dot: top or bottom tenth of the state. n/a: the source does not publish it here.</p></div>';
    $('h-src-l').innerHTML = list.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var st = $('h-pr-page');
    if (!st) { st = document.createElement('style'); st.id = 'h-pr-page'; document.head.appendChild(st); }
    st.textContent = '@media print{@page{@top-right{content:"' + (p.name + ', ' + p.st).replace(/["\\]/g, '') + '"}}@page:first{@top-right{content:none}}}';
  }
  function drawUnusual(p) {
    var list = p.unusual, any = list.some(function (u) { return u.unusual; });
    var lead = !list.length ? 'Too few neighboring counties carry the same figures to compare.' :
      any ? 'The figures furthest from the counties next door (their middle value):' : 'Nothing here sits far from its neighbors. The three biggest gaps:';
    $('h-un').innerHTML = '<p>' + esc(lead) + '</p>' + (list.length ? '<ul class="h-un">' + list.map(function (u) {
      return '<li><b>' + esc(u.label) + '</b>: ' + esc(P.fmtShort(u.value, u.col)) + ' here, ' + esc(P.fmtShort(u.nb, u.col)) + ' across ' + u.nbN + ' neighboring counties' +
        (u.dir === 'same' ? '.' : ', ' + u.dir + ' than its neighbors.') + (u.unusual ? ' <span class="h-flag">unusual</span>' : '') + '</li>';
    }).join('') + '</ul>' : '');
  }
  function drawLong(county) {
    var rows = P.longView(county), box = $('h-long');
    if (!rows.length) { box.innerHTML = '<p class="h-na">Not available: the county record has too few years of yield, rent, drought or insurance figures to draw.</p>'; return; }
    var y0 = Infinity, y1 = -Infinity;
    rows.forEach(function (r) { r.pts.forEach(function (p) { if (p[0] < y0) y0 = p[0]; if (p[0] > y1) y1 = p[0]; }); });
    var W = 600, H = 46, span = Math.max(1, y1 - y0 + 1), bw = W / span;
    box.innerHTML = '<div class="lv-grid">' + rows.map(function (r) {
      var max = 0, min = Infinity, hi = null, lo = null;
      r.pts.forEach(function (p) { if (p[1] > max) { max = p[1]; hi = p; } if (p[1] < min) { min = p[1]; lo = p; } });
      var bars = r.pts.map(function (p) {
        var h = max > 0 ? Math.max(1, p[1] / max * H) : 1;
        return '<rect x="' + ((p[0] - y0) * bw + 0.5).toFixed(1) + '" y="' + (H - h).toFixed(1) + '" width="' + Math.max(1, bw - 1).toFixed(1) + '" height="' + h.toFixed(1) + '"' + (p === hi ? ' class="hi"' : '') + '><title>' + p[0] + ': ' + p[1] + '</title></rect>';
      }).join('');
      var u = r.unit === '$/ac' ? function (v) { return '$' + Math.round(v); } : function (v) { return String(v); };
      return '<div class="lv-row"><div class="lv-h"><b>' + esc(r.label) + '</b> <span>' + esc(r.unit) + ', ' + r.pts[0][0] + '-' + r.pts[r.pts.length - 1][0] + '. High ' + esc(u(hi[1])) + ' (' + hi[0] + '), low ' + esc(u(lo[1])) + ' (' + lo[0] + '). ' + (r.partial ? r.partial + ' is the year so far. ' : '') + esc(r.source) + '.</span></div>' +
        '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" class="lv-svg" aria-hidden="true">' + bars + '</svg>' +
        '<div class="lv-ax" aria-hidden="true"><span>' + y0 + '</span><span>' + y1 + '</span></div></div>';
    }).join('') + '</div>' +
      '<details class="h-tbl"><summary>The years, as a table</summary><div class="h-tw"><table><thead><tr><th scope="col">Year</th>' + rows.map(function (r) { return '<th scope="col">' + esc(r.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (function () { var out = ''; for (var y = y1; y >= y0; y--) { out += '<tr><th scope="row">' + y + '</th>' + rows.map(function (r) { var p = r.pts.filter(function (x) { return x[0] === y; })[0]; return '<td>' + (p ? esc(p[1]) : '') + '</td>'; }).join('') + '</tr>'; } return out; })() +
      '</tbody></table></div></details>';
  }

  /* The county station's year of rain, drawn by the county rain page's own Rain Print, and
     ranked against the same days of every earlier year the station kept in full (NOAA). */
  var ACIS = 'https://data.rcc-acis.org/StnData', RCP = '/components/rain-county-print.js?v=36';
  var porMemo = {};
  function porRows(sid) {
    if (porMemo[sid]) return porMemo[sid];
    var u = ACIS + '?' + new URLSearchParams({ sid: sid, sdate: 'por', edate: 'por', elems: 'pcpn' }).toString();
    var p = new Promise(function (ok) {
      var done = false, t = setTimeout(function () { if (!done) { done = true; ok(null); } }, 20000);
      fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (j) { if (!done) { done = true; clearTimeout(t); ok(j && !j.error && Array.isArray(j.data) ? j.data : null); } });
    });
    porMemo[sid] = p.then(function (rows) { if (!rows) delete porMemo[sid]; return rows; });
    return porMemo[sid];
  }
  function thisYear() { try { return +new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', year: 'numeric' }); } catch (e) { return new Date().getFullYear(); } }
  function drawFirst(p) {
    var fips = p.fips, st = p.st;
    function mine() { return S.prof && S.prof.fips === fips; }
    $('h-rank').innerHTML = '<span class="h-wait">Reading this year&rsquo;s rain at the county station&hellip;</span>';
    $('h-rp-box').innerHTML = '<div class="h-rp-ph" aria-hidden="true"></div>';
    return getJSON('/data/rain/' + st.toLowerCase() + '.json').then(function (f) {
      if (!mine()) return;
      var fig = P.rainFigure(f, fips);
      if (!fig) {
        var r = P.rainSoFar(f, fips);
        $('h-rank').innerHTML = '<span class="h-na">No rain drawing for ' + esc(p.name) + ': ' + esc(r.why || 'no county rain record') + '.</span>';
        $('h-rp-box').innerHTML = '';
        return;
      }
      S.fig = fig;
      drawFigure(fig);
      var head = '<b>' + fig.year + ' at ' + esc(fig.station.name) + '</b>: ' + fig.total.toFixed(2) + ' in' + (fig.done ? '' : ' so far') + (fig.pct != null ? ', ' + fig.pct + '% of a usual year to date' : '') + ' (Jan 1 to ' + esc(mdy(fig.asOf).replace(/, \d{4}$/, '')) + ').';
      $('h-rank').innerHTML = head + ' <span class="h-wait">Ranking it against this station&rsquo;s own record&hellip;</span>';
      $('h-rank-sub').innerHTML = esc(fig.gauge) + '. NOAA daily records, as on the <a href="/rain/' + P.stSlug(st) + '/' + esc(p.slug) + '">county rain page</a>.';
      return rankIt(fig, head, mine);
    });
  }
  function rankIt(fig, head, mine) {
    return porRows(fig.station.sid).then(function (rows) {
      if (!mine()) return;
      if (!rows) {
        $('h-rank').innerHTML = head + ' <span class="h-na">Not ranked: NOAA&rsquo;s station record did not answer.</span> <button type="button" class="h-lnk" id="h-rank-retry">Try again</button>';
        var b = $('h-rank-retry'); if (b) b.onclick = function () { $('h-rank').innerHTML = head + ' <span class="h-wait">Asking NOAA again&hellip;</span>'; rankIt(fig, head, mine); };
        return;
      }
      var r = P.rankSoFar(rows, fig);
      S.rank = r;
      if (r.status !== 'ok') { $('h-rank').innerHTML = head + ' <span class="h-na">Not ranked: ' + esc(r.why) + '.</span>'; years(r, fig); return; }
      track('here_rank', { n: r.n });
      $('h-rank').innerHTML = '<span class="h-rank-l">' + esc(P.rankWordsRain(r, fig)) + '</span> <span class="h-rank-t">' + fig.total.toFixed(2) + ' in' + (fig.pct != null ? ', ' + fig.pct + '% of a usual year to date' : '') + '. ' + r.n + ' years with every day reported.</span>';
      years(r, fig);
    });
  }
  /* Every year at the station, wettest first, built when a reader opens it. */
  function years(r, fig) {
    var d = $('h-years'); if (!d) return;
    var rows = (r.years || []).concat([[fig.year, r.total]]).sort(function (a, b) { return b[1] - a[1] || a[0] - b[0]; });
    d.hidden = rows.length < 2;
    d.open = false;
    var b = d.querySelector('.h-math-b'); b.innerHTML = '';
    d.ontoggle = function () {
      if (!d.open || b.firstChild) return;
      b.innerHTML = '<p class="h-src">Rain from ' + esc(r.span) + ', NOAA daily records via RCC-ACIS, ' + esc(fig.noun) + ' ' + esc(String(fig.station.sid).split(' ')[0]) + '.</p><div class="h-tw"><table><caption class="sr-only">Each year, wettest first</caption><thead><tr><th scope="col">Year</th><th scope="col">Inches, ' + esc(r.span) + '</th></tr></thead><tbody>' +
        rows.map(function (y) { var me = y[0] === fig.year; return '<tr' + (me ? ' class="h-me"' : '') + '><th scope="row">' + y[0] + (me ? ' (this year)' : '') + '</th><td>' + y[1].toFixed(2) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    };
  }
  function drawFigure(fig) {
    var cap = 'Inches of rain added up day by day from Jan 1' + (fig.usual != null ? ', solid line, against the usual year at this ' + fig.noun + ' (dashed), counted on the same days' : '') + '. Days with no report add nothing.';
    var pcap = 'Every day of ' + fig.year + (fig.done ? '' : ' so far') + ' at this ' + fig.noun + ', drawn by Rain Print. A gap is a day with no report.' + (fig.done ? '' : ' The empty months are still to come.') +
      (fig.mn ? ' The dashed line is the usual year: NOAA&rsquo;s ' + (fig.norm === '1991-2020' ? '1991 to 2020' : '30-year') + ' normals for this ' + fig.noun + ', added up over the days it reported.' : '');
    $('h-rp-box').innerHTML = '<figure class="rc-chart rc-print h-rp" id="h-rp" data-st="' + esc(fig.st) + '" data-fips="' + esc(fig.fips) + '" data-year="' + fig.year + '" data-days="' + fig.days + '" data-total="' + fig.total.toFixed(2) + '" data-place="' + esc(fig.place) + '" data-gauge="' + esc(fig.gauge) + '"' +
      (fig.mn ? ' data-mn="' + esc(fig.mn) + '" data-usual="' + fig.usual.toFixed(2) + '" data-norm="' + esc(fig.norm) + '"' : '') + '>' +
      '<div class="rc-print-styles" role="group" aria-label="Print style" hidden><button type="button" data-style="r1" aria-pressed="true">Staircase</button><button type="button" data-style="r2" aria-pressed="false">Roots</button><button type="button" class="rc-zoom" aria-pressed="false">Up close</button></div>' +
      '<div class="rc-print-art">' + P.rainChart(fig) + '</div><figcaption><span class="rc-cap-chart">' + esc(cap) + '</span><span class="rc-cap-print" hidden>' + pcap + '</span></figcaption></figure>';
    var el = $('h-rp');
    loadScript(RCP, function () { return !!(window.AgRainCountyPrint && window.AgRainCountyPrint.mount); }).then(function (ok) {
      if (ok && el.isConnected) window.AgRainCountyPrint.mount(el);
    });
  }

  /* Elevators near the place against their neighbors (place.js basisNeighbors), from the bids
     network's live index, and against their own history joined on the permanent id. Each is
     described by miles and delivery, never by name. */
  var CROPN = { corn: 'Corn', soybeans: 'Soybeans' };
  function basisTxt(c) { if (c == null) return ''; var a = Math.round(Math.abs(c) * 2) / 2; return (a === 0 ? '' : c < 0 ? '−' : '+') + (a % 1 ? a.toFixed(1) : a) + '¢'; }
  function loadElev(fips, w) {
    var net = window.AGSIST_BIDS_NET, lat = +w.lat, lng = +w.lng, box = $('h-elev-b');
    if (!box) return Promise.resolve();
    function mine() { return S.prof && S.prof.fips === fips; }
    box.innerHTML = '<span class="wk-wait">Reading the elevator bids&hellip;</span>';
    var ask = net && net.index && isFinite(lat) && isFinite(lng) ? net.index() : Promise.resolve(null);
    return ask.then(function (idx) {
      if (!mine()) return;
      var from = fromWords(w);
      if (!idx || !idx.places) { box.innerHTML = na('the elevator bids did not answer'); return; }
      var by = P.basisNeighbors(idx.places, lat, lng), rows = [].concat(by.corn || [], by.soybeans || []);
      if (!rows.length) { box.innerHTML = na('no elevator within ' + P.EL.NEAR + ' miles of ' + from + ' posts a usable corn or soybean bid'); return; }
      box.innerHTML = '<ul class="h-el">' + rows.map(function (r, i) {
        var head = '<b>' + CROPN[r.crop] + '</b>, ' + r.mi + ' mi from ' + esc(from) + ': basis ' + basisTxt(r.basis) + (r.delivery ? ' (delivery ' + esc(r.delivery) + ')' : '');
        var vs = r.status === 'ok' ? ', ' + (r.gap === 0 ? 'the same as' : Math.abs(r.gap) + '¢ ' + (r.gap > 0 ? 'stronger than' : 'weaker than')) + ' the middle of ' + r.nbN + ' elevators within ' + r.radius + ' miles posting the same delivery (' + basisTxt(r.nbMedian) + ').'
          : '. Against its neighbors: not available, ' + esc(r.why) + '.';
        return '<li id="h-el-' + i + '">' + head + vs + ' <span class="h-el-h" id="h-el-h' + i + '"></span></li>';
      }).join('') + '</ul><p class="h-src" id="h-el-thin" hidden></p><p class="h-src">Posted bids' + (idx.generated ? ', ' + esc(mdy(idx.generated)) : '') + '. Basis history starts June 2026. <a href="' + (w.zip ? '/cash-bids?zip=' + w.zip : '/cash-bids') + '">Who pays what near here</a></p>';
      elevHistory(rows, mine);
    }, function () { if (mine()) box.innerHTML = na('the elevator bids did not answer'); });
  }
  function thinNote(rows) {
    var t = rows.filter(function (r) { return r.hist && r.hist.status === 'thin'; }), el = $('h-el-thin');
    if (!el || !t.length) return;
    var f = t.map(function (r) { return r.hist.first; }).filter(Boolean).sort(), d = function (x) { return mdy(x).replace(/, \d{4}$/, ''); };
    el.hidden = false;
    el.textContent = 'Against its own history: not yet for ' + (t.length === rows.length ? 'any of these' : t.length + ' of these') + '. ' +
      (f.length ? 'Those deliveries were first seen ' + (f[0] === f[f.length - 1] ? d(f[0]) : 'between ' + d(f[0]) + ' and ' + d(f[f.length - 1])) + '; ' : '') +
      'a comparison waits for ' + P.EL.HIST_DAYS + ' days of one delivery.';
  }
  function elevHistory(rows, mine) {
    var net = window.AGSIST_BIDS_NET, today = new Date().toISOString().slice(0, 10), sts = {};
    rows.forEach(function (r) { if (r.st) sts[r.st] = 1; });
    Object.keys(sts).forEach(function (st) {
      if (!/^[A-Z]{2}$/.test(st)) return;
      Promise.all([getJSON('/data/ids/basis-join/' + st + '.json', 8000), getJSON('/data/basis/' + st + '.json', 8000)]).then(function (a) {
        if (!mine()) return;
        var join = a[0], map = P.basisHistMap(a[1]);
        rows.forEach(function (r, i) {
          if (r.st !== st) return;
          var el = $('h-el-h' + i); if (!el) return;
          var key = join && join.k && r.elevId ? join.k[r.elevId] : null;
          if (!key) { el.textContent = join && join.multi && join.multi[r.elevId] ? 'Its own history: not joined (listed more than one way).' : ''; return; }
          if (!map || !net || !net.shard || !r.shard) return;
          net.shard(r.shard).then(function (sh) {
            if (!mine() || !sh || !Array.isArray(sh.bids)) return;
            var row = null;
            sh.bids.forEach(function (b) { if (!row && b && b.crop === r.crop && String(b.period || '') === r.period && String(b.delivery || '') === r.delivery && typeof b.cash === 'number' && Math.abs(b.cash - r.cash) < 0.0001) row = b; });
            if (!row) return;
            var h = P.basisHistory(map, key, r.crop, row.futuresMonth || '', row.delivery || '', r.basis, today);
            r.hist = h;
            if (h.status === 'thin') thinNote(rows);
            else if (h.status === 'ok') el.textContent = 'Its own history (since ' + mdy(h.first).replace(/, 2026$/, '') + '): ' +
              (h.kind === 'same' ? 'no change since then.' : h.kind === 'moved' ? 'changed ' + mdy(h.date).replace(/, 2026$/, '') + ', was ' + basisTxt(h.from) + '.' : 'was ' + basisTxt(h.from) + ' when last seen ' + mdy(h.date).replace(/, 2026$/, '') + '; it moved since.');
          }, function () {});
        });
      });
    });
  }

  /* ── print report ────────────────────────────────────────────────── */
  // The Print tab: checkboxes pick the parts (all ticked by default); More detail prints the
  // figure table and the table of years open. Classes on <html> do the hiding, print media only.
  var PART_EL = { sentence: 'h-part-sentence', week: 'h-sec-week', fingerprint: 'h-sec-fingerprint', unusual: 'h-sec-unusual', long: 'h-sec-long', sources: 'h-part-sources' };
  function applyPrint() {
    var root = document.documentElement, c = S.print;
    P.PRINT_PARTS.forEach(function (k) {
      root.classList.toggle('pr-off-' + k, c.parts.indexOf(k) < 0);
      var el = $(PART_EL[k]); if (el) el.classList.add('h-part');
    });
    root.classList.toggle('pr-more', !!c.more);
    var box = $('h-pr-box');
    if (box) {
      [].forEach.call(box.querySelectorAll('input[name=part]'), function (i) { i.checked = c.parts.indexOf(i.value) >= 0; });
      $('h-pr-more').checked = !!c.more;
    }
  }
  function readPanel() {
    var parts = [].filter.call($('h-pr-box').querySelectorAll('input[name=part]'), function (i) { return i.checked; }).map(function (i) { return i.value; });
    S.print = { parts: P.PRINT_PARTS.filter(function (k) { return parts.indexOf(k) >= 0; }), more: $('h-pr-more').checked };
    applyPrint();
    writeUrl();
  }
  var opened = [];
  function beforePrint() {
    if (!S.prof) return;
    loadDepth();
    var d = $('h-pr-date'); if (d) d.textContent = printedOn();
    buildQr();
    var more = $('h-more'); if (more && !more.open) { more.open = true; opened.push(more); }
    if (S.print.more) [].forEach.call(document.querySelectorAll('#h-place details.h-tbl'), function (x) { if (!x.open) { x.open = true; opened.push(x); } });
  }
  function buildQr() {
    var w = S.where || {}, p = S.prof;
    if (!p) return;
    var url = P.qrLink({ fips: p.fips, zip: w.zip, at: w.lat != null && !w.center && !w.zip ? { lat: w.lat, lng: w.lng } : null, print: S.print });
    var qr = $('h-pr-qr1'), end = $('h-pr-qr'), bare = esc(url.replace(/^HTTPS:\/\/AGSIST\.COM/, 'agsist.com'));
    if (qr && qr.getAttribute('data-url') !== url) {
      var svg = '';
      try { svg = window.AgQR ? window.AgQR.svg(url, 'QR code for this page', 10, 'mixed') : ''; } catch (e) { svg = ''; }
      qr.innerHTML = svg ? svg + '<p>Scan for the live page</p>' : '';
      qr.setAttribute('data-url', url);
    }
    if (end) end.innerHTML = '<p>This report, live and up to date: ' + bare + '</p>';
  }
  function afterPrint() { opened.forEach(function (d) { d.open = false; }); opened = []; }
  function wirePrint() {
    var box = $('h-pr-box');
    if (!box) return;
    box.addEventListener('change', readPanel);
    $('h-pr-go').addEventListener('click', function () {
      readPanel();
      track('here_print', { parts: S.print.parts.length, more: S.print.more ? 1 : 0 });
      var btn = $('h-pr-go');
      btn.disabled = true;
      /* the depth is drawn before the sheet goes out; a slow source gets six seconds */
      Promise.race([loadDepth(), new Promise(function (ok) { setTimeout(ok, 6000); })]).then(function () {
        btn.disabled = false;
        beforePrint();
        try { window.print(); } catch (e) {}
      });
    });
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
  }

  /* ── the map ─────────────────────────────────────────────────────── */
  function proj(features) {
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    function each(g, fn) { (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]).forEach(function (poly) { poly.forEach(function (ring) { ring.forEach(fn); }); }); }
    features.forEach(function (f) { each(f.geometry, function (p) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }); });
    var k = Math.cos((y0 + y1) / 2 * Math.PI / 180), W = 600, sx = W / Math.max(1e-6, (x1 - x0) * k), H = Math.round((y1 - y0) * sx);
    function path(g) {
      return (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]).map(function (poly) {
        return poly.map(function (ring) { return 'M' + ring.map(function (p) { return ((p[0] - x0) * k * sx).toFixed(1) + ',' + ((y1 - p[1]) * sx).toFixed(1); }).join('L') + 'Z'; }).join('');
      }).join('');
    }
    return { W: W, H: Math.max(1, H), path: path };
  }
  function drawMap(st) {
    var box = $('h-map');
    if (st === undefined) st = S.prof && S.prof.st;
    if (!st) {
      box.innerHTML = '<p class="h-src">Loading the state map…</p>';
      getJSON('/data/us-states.geo.json').then(function (g) {
        if (!g) { box.innerHTML = na('the state map did not load'); return; }
        var fs = g.features.filter(function (f) { var s = f.properties && f.properties.postal; return f.properties.iso_a2 === 'US' && P.STATES[s] && s !== 'AK' && s !== 'HI'; });
        var pr = proj(fs);
        box.innerHTML = '<p class="h-src">Tap a state, then a county. Alaska and Hawaii: type the county.</p><svg viewBox="0 0 ' + pr.W + ' ' + pr.H + '" class="h-svg" role="group" aria-label="US states">' +
          fs.map(function (f) { var s = f.properties.postal; return '<path d="' + pr.path(f.geometry) + '" data-st="' + s + '" tabindex="0" role="button" aria-label="' + esc(P.STATES[s]) + '"><title>' + esc(P.STATES[s]) + '</title></path>'; }).join('') + '</svg>';
        box.onclick = function (e) { var t = e.target.closest('[data-st]'); if (t) drawMap(t.getAttribute('data-st')); };
        box.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { var t = e.target.closest('[data-st]'); if (t) { e.preventDefault(); drawMap(t.getAttribute('data-st')); } } };
      });
      return;
    }
    box.innerHTML = '<p class="h-src">Loading the ' + esc(P.STATES[st]) + ' county map…</p>';
    geoFile().then(function (g) {
      if (!g) { box.innerHTML = na('the county map did not load'); return; }
      var fs = g.features.filter(function (f) { return f.properties && f.properties.st === st; });
      var pr = proj(fs), cur = S.prof && S.prof.fips;
      box.innerHTML = '<p class="h-src">' + esc(P.STATES[st]) + ': tap a county. <button type="button" class="h-lnk" data-us="1">All states</button></p><svg viewBox="0 0 ' + pr.W + ' ' + pr.H + '" class="h-svg" role="group" aria-label="' + esc(P.STATES[st]) + ' counties">' +
        fs.map(function (f) { return '<path d="' + pr.path(f.geometry) + '" data-fips="' + f.id + '" tabindex="0" role="button"' + (f.id === cur ? ' class="cur"' : '') + ' aria-label="' + esc(f.properties.name) + '"><title>' + esc(f.properties.name) + '</title></path>'; }).join('') + '</svg>';
      function pick(t) { track('here_find', { by: 'map' }); open(t.getAttribute('data-fips'), { how: 'county' }, ++S.seq); }
      box.onclick = function (e) {
        if (e.target.closest('[data-us]')) { drawMap(null); return; }
        var t = e.target.closest('[data-fips]'); if (t) pick(t);
      };
      box.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { var t = e.target.closest('[data-fips]'); if (t) { e.preventDefault(); pick(t); } } };
    });
  }

  /* ── start ───────────────────────────────────────────────────────── */
  /* The place loads when a tab that shows it opens (My place, State, Print), not on the
     reference tables, so a reader there pays for nothing they did not open. */
  function begin() {
    if (S.started) return;
    S.started = true;
    var q = P.parseQuery(location.search), my = ++S.seq;
    if (q.print) { S.print = q.print; applyPrint(); }
    if (q.fips) {
      var w = { how: q.q ? 'town' : 'county', label: q.q || null };
      if (q.zip) { w.zip = q.zip; w.how = 'zip'; }
      if (q.at) { w.lat = q.at.lat; w.lng = q.at.lng; w.point = !q.q; if (!q.q) w.label = q.at.lat.toFixed(4) + ', ' + q.at.lng.toFixed(4); }
      if (q.zip && !q.at) {
        /* a ZIP link: the county is in the link; the ZIP's own point comes from the bid search's ZIP table when it answers */
        var net = window.AGSIST_BIDS_NET;
        $('h-q').value = q.zip;
        (net && net.zipCoord ? net.zipCoord(q.zip) : Promise.resolve(null)).then(function (pt) {
          if (pt) { w.lat = pt.lat; w.lng = pt.lon; }
          open(q.fips, w, my);
        }, function () { open(q.fips, w, my); });
        return;
      }
      if (q.q) $('h-q').value = q.q;
      open(q.fips, w, my);
    } else if (q.zip) { $('h-q').value = q.zip; byZip(q.zip, my); }
    else if (q.at) byPoint(q.at, my, null);
    else if (q.q) { $('h-q').value = q.q; go(q.q, 'link'); }
    else { var z = savedZip(); if (z) { $('h-q').value = z; byZip(z, my); } }
  }
  function onTab(t) {
    if (t === 'place' || t === 'print') begin();
    if (t === 'state') { begin(); drawState(); }
    if (t === 'us') drawUS();
  }
  function start() {
    wirePrint();
    $('h-form').addEventListener('submit', function (e) { e.preventDefault(); go($('h-q').value); });
    $('h-locate').addEventListener('click', function () {
      if (!navigator.geolocation) { say('This browser does not share a location. Type a ZIP or town.', true); return; }
      say('Asking the browser for your location…');
      var my = ++S.seq;
      navigator.geolocation.getCurrentPosition(function (pos) {
        if (my !== S.seq) return;
        track('here_find', { by: 'location' });
        byPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude }, my, 'your location');
      }, function () { if (my === S.seq) say('The browser did not share a location. Type a ZIP or town.', true); }, { timeout: 12000, maximumAge: 600000 });
    });
    $('h-change').addEventListener('click', function () {
      $('h-find').hidden = false;
      $('h-change').hidden = true;
      $('h-q').value = '';
      $('h-q').focus();
    });
    $('h-map-box').addEventListener('toggle', function () { if ($('h-map-box').open && !$('h-map').firstChild) drawMap(); });
    var more = $('h-more');
    if (more) more.addEventListener('toggle', function () { if (more.open) loadDepth(); });
    var pick = $('s-pick');
    if (pick) pick.insertAdjacentHTML('beforeend', Object.keys(P.STATES).map(function (k) { return '<option value="' + k + '">' + esc(P.STATES[k]) + '</option>'; }).join(''));
    if (pick) pick.addEventListener('change', function () { if (P.STATES[pick.value]) drawState(pick.value); });
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[data-fips]');
      if (!a) return;
      e.preventDefault();
      open(a.getAttribute('data-fips'), { how: 'county' }, ++S.seq);
      var t = $('h-title'); if (t) window.scrollTo({ top: Math.max(0, t.getBoundingClientRect().top + window.scrollY - 80), behavior: 'smooth' });
    });
    document.documentElement.addEventListener('fx-tab', function (e) { onTab(e.detail); });
    onTab(tab());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.AgHere = { go: go, open: open, state: S, beforePrint: beforePrint, afterPrint: afterPrint, loadDepth: loadDepth, drawState: drawState };
})();
