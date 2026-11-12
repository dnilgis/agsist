/* components/land-map.js: farm sales of 20 acres or more on a map (land sales hub, Nov 12, 2026).
   The section (#land-map) is written by the land sales builder with a headline, filters, a box of reserved
   height, one key, a counts line and an empty list. When the box comes near the screen this loads Leaflet (vendor/), then the state
   files (data/land-sales/map/<st>.json, one per state, built on main), and draws:
     - one pin per sale of 20 acres or more over 24 months, placed at its section, township, town, ZIP or county
       center (never the parcel; each pin says which), fanned out a little when several share a spot;
     - a round pin is a sale recorded with the state (transfer return); a SQUARE pin is an auction result reported by the
       auction company (land_auctions.py), at its county center, with its company and result page in the popup;
     - color: price per acre against the sale's own county's 24-month median and usual range; size: acres;
     - ONE meaning of unusual: outside the county's usual range. Its pins carry a gold edge (and, from zoom 9, a triangle up for
       over or down for under); the headline, the lead, the "Unusual only" filter and the list all count the same pins.
       The largest 1% by price or acres is in the popup only;
     - white pins are not compared (buildings, forest, auctions of several tracts, counties with under 5 sales) and are counted;
       family, quit claim and part-interest deeds (left out of every median) are hollow and off until the reader turns them on;
     - zoomed out the same pins as small dots, no separate ring layer; a tap on a stack zooms in; a topo or aerial USGS base map;
     - a tap shows date, acres, $/acre, price, the county median and how far off, the placement and only the
       links whose page exists (the sale's row, Field Scout at that spot, the Farmland Atlas county page);
     - the headline, the counts and the list follow the filters (state, months, acres); Share and Save the picture
       (1200 x 630) carry the view. No buyer or seller name is in any file this reads.
   Exports window.AgLandMap (and module.exports) for the tests: story, popupHtml, links, placeNote, filterPts, counts. */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var NUMW = { 2: 'two', 3: 'three', 4: 'four', 5: 'five' };
  var COL = { '-2': '#1f5fa8', '-1': '#4ea3e0', '0': '#b4b2ab', '1': '#ec7a36', '2': '#b8212f' };
  var GOLD = '#d4a23f';
  var KINDW = { f: 'farmland', b: 'with buildings', w: 'forest', s: 'small parcel', a: 'auction result' };
  var NMW = { r: 'a related-party sale', q: 'a quit claim or other non-sale deed', x: 'exempt from the transfer tax', p: 'a part interest' };
  var UP_WHY = 'a house or buildings, timber or hunting ground, a building site or development land, or a neighbor paying more for the piece next door';
  var DOWN_WHY = 'a family or neighbor sale, a part interest, wooded, wet or poorer ground, no road access, or a land contract';
  var LEAFLET = '/vendor/leaflet-1.9.4/';
  var BASES = { topo: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    aerial: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}' };
  var PINZ = 9;          // zoom from which pins take their full size and unusual pins carry a triangle; below it they shrink to dots
  var STACKZ = 7;        // below this zoom a tap on a pin zooms in to it instead of opening one pin of a stack
  var MIN_ACRES = 20;
  // point columns (scripts/land_map.py PT_COLS)
  var LAT = 0, LNG = 1, K = 2, CO = 3, WHEN = 4, AC = 5, PR = 6, PPA = 7, KIND = 8, C = 9, A = 10, PC = 11, PN = 12, ID = 13, NM = 14;
  // county columns (CO_COLS)
  var CF = 0, CNAME = 1, CSLUG = 2, CMED = 5, CQ1 = 6, CQ3 = 7, CLO = 8, CHI = 9, CN = 10, CATLAS = 11;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n0(v) { return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function usd(v) { return '$' + n0(v); }
  function day(s) { return MON[+s.slice(5, 7) - 1] + ' ' + (+s.slice(8, 10)) + ', ' + s.slice(0, 4); }
  function acres(a) { return (a >= 100 ? n0(a) : String(Math.round(a * 10) / 10)) + ' acres'; }
  function monthsBack(iso, n) {
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7) - n, d = +iso.slice(8, 10);
    while (m <= 0) { m += 12; y -= 1; }
    var last = [31, (y % 4 === 0 && (y % 100 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (Math.min(d, last) < 10 ? '0' : '') + Math.min(d, last);
  }
  function latestOf(files) { var t = ''; files.forEach(function (f) { f.pts.forEach(function (p) { if (p[WHEN] > t) t = p[WHEN]; }); }); return t; }

  /* the headline and the line under it (scripts/land_map.py headline writes the same from the same data): each state's
     last `months` months to its newest record, within the acres chosen; only bare farmland sales recorded with the state and
     judged against their county count; ONE meaning of unusual: outside the county's usual range (class bits 1 and 2);
     auction results (kind a) are never in these counts */
  function acreWords(amin, amax) { return amax ? amin + ' to ' + amax + ' acres' : amin + ' acres or more'; }
  function story(files, states, months, amin, amax) {
    amin = amin || MIN_ACRES; amax = amax || 0;
    var sts = files.filter(function (f) { return states.indexOf(f.st) >= 0 && f.pts && f.pts.some(function (p) { return p[KIND] !== 'a'; }); });
    if (!sts.length) return { head: 'No state-recorded farm sales to show.', take: '' };
    var judged = 0, over = 0, under = 0;
    sts.forEach(function (f) {
      var cut = monthsBack(f.through, months);
      f.pts.forEach(function (p) {
        if (p[NM] || p[KIND] === 'a' || p[WHEN] <= cut || p[C] === null || p[AC] < amin || (amax && p[AC] > amax)) return;
        judged++;
        if (p[A] & 1) over++;
        if (p[A] & 2) under++;
      });
    });
    var where = sts.length === 1 ? sts[0].name : (NUMW[sts.length] || sts.length) + ' states';
    var span = sts.length === 1 ? 'in the ' + months + ' months to ' + day(sts[0].through) : 'in the ' + months + " months to each state's newest record";
    var odd = over + under;
    return { head: n0(odd) + ' of ' + n0(judged) + ' bare farmland ' + (judged === 1 ? 'sale' : 'sales') + ' of ' + acreWords(amin, amax) + ' in ' + where +
      " sold outside their county's usual price range " + span + '.',
      take: n0(over) + ' over the range, ' + n0(under) + " under. A gold edge marks them; auction results get one too but are counted apart. The largest 1% by price or acres is in the pin's popup only." };
  }

  function placeNote(code, words, county) {
    if (code === 's' || code === 'm') return 'Placed at the center of ' + words + ', not the exact parcel.';
    if (code === 'z') return 'Placed at the middle of the ' + words + ' ZIP code, not the exact parcel.';
    return 'Placed at the center of ' + county + ' County, not the exact parcel.';
  }
  function fieldScoutCovers(lat, lng) { return typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 72 && lng >= -180 && lng <= -60; }
  /* [[label, href]]: only the links whose page exists (scripts/land_map.py links, the same list) */
  function links(f, p) {
    var co = f.counties[p[CO]], out = [];
    if (p[ID]) out.push(['Sale details', '/land-sales/' + f.slug + '/' + co[CSLUG] + '#s-' + p[ID]]);
    if (fieldScoutCovers(p[LAT], p[LNG])) out.push(['Field Scout', '/field-scout?at=' + p[LAT].toFixed(4) + ',' + p[LNG].toFixed(4) + '&fips=' + co[CF]]);
    if (co[CATLAS]) out.push(['Farmland Atlas', '/farmland-atlas/' + f.slug + '/' + co[CSLUG]]);
    return out;
  }
  function offPct(f, p) {
    var co = f.counties[p[CO]];
    return (p[C] !== null && co[CMED] && p[PPA] !== null) ? Math.round((p[PPA] / co[CMED] - 1) * 100) : null;
  }
  function popupHtml(f, p) {
    var co = f.counties[p[CO]], cn = co[CNAME] + ' County, ' + f.st, h = [], why = [], auc = p[KIND] === 'a', au = auc && f.au ? f.au[p[ID]] : null;
    var basis = f.basis === 'auction' ? ' auction per-acre figures, 24 months' : ' bare farmland sales, 24 months';
    h.push('<div class="lm-pop">');
    if (auc) h.push('<p class="lm-tag"><b>Auction result</b>' + (au ? ', reported by ' + esc(au[0]) : ', reported by the auction company') + '</p>');
    h.push('<p><b>' + (p[PPA] !== null ? usd(p[PPA]) + ' an acre' : auc ? 'No single per-acre figure' : 'Price per acre not stated') + '</b>, ' + acres(p[AC]) + ', ' +
      (p[PR] ? (auc ? usd(p[PR]) + ' total sold' : usd(p[PR])) : 'total sold not published') + '<br>' +
      (auc ? 'Auction day ' : '') + day(p[WHEN]) + ', ' + esc(cn) + (auc ? '' : ', ' + esc(KINDW[p[KIND]] || '')) + '</p>');
    if (auc && au && au[2]) h.push('<p>' + esc(au[2]) + '. Each tract\'s figure is in the sale details.</p>');
    if (p[NM]) {
      h.push('<p>Left out of every median: ' + NMW[p[NM]] + '.</p>');
    } else if (p[C] !== null) {
      var pct = offPct(f, p);
      h.push('<p>' + (pct === 0 ? 'Right at' : Math.abs(pct) + '% ' + (pct > 0 ? 'above' : 'below')) + ' the county median of ' + usd(co[CMED]) +
        ' an acre (' + co[CN] + basis + '; usual range ' + (co[CLO] > 0 ? usd(co[CLO]) + ' to ' : 'up to ') + usd(co[CHI]) + ').</p>');
      if (p[A] & 1) why.push('<p class="lm-note">Over the usual range. Possible reasons: ' + UP_WHY + '.</p>');
      if (p[A] & 2) why.push('<p class="lm-note">Under the usual range. Possible reasons: ' + DOWN_WHY + '.</p>');
    } else if (!co[CMED]) {
      h.push('<p>Not compared: ' + esc(co[CNAME]) + ' County has too few ' + (f.basis === 'auction' ? 'auction per-acre figures' : 'bare farmland sales') + ' in 24 months for a median.</p>');
    } else {
      h.push('<p>Not compared with the county median: ' + (auc ? 'an auction of several tracts has no single per-acre figure' : esc(KINDW[p[KIND]] || 'not bare farmland')) + '.</p>');
    }
    var L0 = links(f, p);
    if (au && au[1]) L0.push(['Result on ' + au[0] + "'s site", au[1]]);
    if (L0.length) h.push('<p class="lm-go">' + L0.map(function (l) { return '<a href="' + esc(l[1]) + '"' + (/^https?:/.test(l[1]) ? ' rel="noopener nofollow"' : '') + '>' + esc(l[0]) + '</a>'; }).join('') + '</p>');
    var top = (p[A] & 4 ? ['price'] : []).concat(p[A] & 8 ? ['acres'] : []);
    if (top.length) h.push('<p>Among the largest 1% of ' + esc(f.name) + ' ' + (f.basis === 'auction' ? 'auction results' : 'sales') + ' by ' + top.join(' and by ') + '.</p>');
    h.push('<p class="lm-note">' + esc(placeNote(p[PC], f.places[p[PN]], co[CNAME])) + '</p>');
    h = h.concat(why);
    h.push('</div>');
    return h.join('');
  }

  /* the pins a filter keeps: [{f, p}] */
  function filterPts(files, q) {
    var out = [];
    files.forEach(function (f) {
      if (q.st && f.st !== q.st) return;
      var cut = monthsBack(f.through, q.mo);
      f.pts.forEach(function (p) {
        if (p[WHEN] <= cut || p[AC] < q.amin || (q.amax && p[AC] > q.amax)) return;
        if (p[NM] && !q.nm) return;
        if (q.odd && !(p[A] & 3)) return;
        out.push({ f: f, p: p });
      });
    });
    return out;
  }

  /* the counts line under the key, from the pins a filter keeps: how many are on the map, how many are not compared and why,
     how many are auction results (squares); family, quit claim and part-interest deeds are counted apart */
  function counts(shown, hiddenNm) {
    var n = 0, nc = 0, au = 0, nm = 0;
    shown.forEach(function (o) {
      var p = o.p;
      if (p[NM]) { nm++; return; }
      n++;
      if (p[KIND] === 'a') au++;
      if (p[C] === null) nc++;
    });
    var t = n0(n) + (n === 1 ? ' pin' : ' pins') + ' with these filters' + (au ? ', ' + n0(au) + ' of them auction results (squares)' : '') + '. ' +
      n0(nc) + (nc === 1 ? ' is' : ' are') + ' white and not compared: buildings, forest, auctions of several tracts or counties with under 5 sales.';
    if (nm) t += ' ' + n0(nm) + ' family, quit claim or part-interest ' + (nm === 1 ? 'deed is' : 'deeds are') + ' shown hollow.';
    else if (hiddenNm) t += ' ' + n0(hiddenNm) + ' family, quit claim or part-interest deeds are hidden until ticked.';
    return t;
  }

  var api = { story: story, counts: counts, popupHtml: popupHtml, links: links, placeNote: placeNote, filterPts: filterPts, monthsBack: monthsBack, fieldScoutCovers: fieldScoutCovers };
  root.AgLandMap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  /* ------------------------------------------------------------ the page */
  var sec = document.getElementById('land-map');
  if (!sec) return;
  var form = document.getElementById('lm-f'), box = document.getElementById('lm-box'), wait = document.getElementById('lm-wait');
  var headEl = document.getElementById('lm-head'), takeEl = document.getElementById('lm-take'), list = document.getElementById('lm-list'), ln = document.getElementById('lm-ln');
  var tools = document.getElementById('lm-tools'), sumEl = document.getElementById('lm-lh');
  var reduce = false; try { reduce = root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var files = [], map = null, tiles = null, pinLayer = null, markLayer = null, shown = [], latest = '', L = null, marks = [], hereSt = '';
  var q = { st: '', mo: +sec.getAttribute('data-open') || 12, amin: MIN_ACRES, amax: 0, odd: false, nm: false, base: 'topo' };

  function readUrl() {
    var s = location.search || '', g = function (k) { var m = new RegExp('[?&]' + k + '=([^&]*)').exec(s); return m ? decodeURIComponent(m[1]) : null; };
    var st = (g('st') || '').toUpperCase(); if (/^[A-Z]{2}$/.test(st)) q.st = st;     // checked against the files once they load
    var mo = +g('mo'); if ([3, 6, 12, 24].indexOf(mo) >= 0) q.mo = mo;
    var a0 = +g('amin'); if ([20, 40, 80, 160, 320].indexOf(a0) >= 0) q.amin = a0;
    var a1 = +g('amax'); if ([40, 80, 160, 320].indexOf(a1) >= 0) q.amax = a1;
    q.odd = g('odd') === '1'; q.nm = g('nm') === '1'; q.base = g('base') === 'aerial' ? 'aerial' : 'topo';
    var at = /^(-?\d+\.?\d*),(-?\d+\.?\d*),(\d+(?:\.\d)?)$/.exec(g('at') || '');
    q.at = at ? [+at[1], +at[2], +at[3]] : null;
  }
  function toForm() {
    form.lst.value = q.st.toLowerCase(); form.lmo.value = String(q.mo); form.lamin.value = String(q.amin); form.lamax.value = q.amax ? String(q.amax) : '';
    form.lodd.checked = q.odd; form.lnm.checked = q.nm;
  }
  function fromForm() {
    q.st = (form.lst.value || '').toUpperCase(); q.mo = +form.lmo.value; q.amin = +form.lamin.value; q.amax = +form.lamax.value || 0;
    q.odd = form.lodd.checked; q.nm = form.lnm.checked;
  }
  function viewUrl() {
    var u = location.origin + location.pathname + '?', p = [];
    if (q.st) p.push('st=' + q.st.toLowerCase());
    if (q.mo !== 12) p.push('mo=' + q.mo);
    if (q.amin !== MIN_ACRES) p.push('amin=' + q.amin);
    if (q.amax) p.push('amax=' + q.amax);
    if (q.odd) p.push('odd=1');
    if (q.nm) p.push('nm=1');
    if (q.base === 'aerial') p.push('base=aerial');
    if (map) { var c = map.getCenter(); p.push('at=' + c.lat.toFixed(3) + ',' + c.lng.toFixed(3) + ',' + map.getZoom()); }
    return u + p.join('&') + '#land-map';
  }

  function loadScript(src) { return new Promise(function (ok) { var s = document.createElement('script'); s.src = src; s.onload = function () { ok(true); }; s.onerror = function () { ok(false); }; document.head.appendChild(s); }); }
  function loadCss(href) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }
  function getJSON(u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function near(el, fn) {
    if (typeof IntersectionObserver === 'undefined') { fn(); return; }
    var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); fn(); } }, { rootMargin: '400px 0px' });
    io.observe(el);
  }

  function spot(p) {
    if (!p[K]) return [p[LAT], p[LNG]];
    var r = 0.0022 * Math.sqrt(p[K]), t = p[K] * 2.399963;
    return [p[LAT] + r * Math.sin(t), p[LNG] + r * Math.cos(t) / Math.cos(p[LAT] * Math.PI / 180)];
  }
  function radius(p, z) {
    var r = 3 + 1.6 * Math.sqrt(p[AC] / MIN_ACRES);
    if (z < 7) r *= 0.42; else if (z < PINZ) r *= 0.62;
    return Math.max(z < PINZ ? 2 : 3, Math.min(13, r));
  }
  function band(z) { return z < STACKZ ? 0 : z < PINZ ? 1 : 2; }
  /* the saved state of this reader (the weather location the site keeps on the device), when the map has it: a phone opens there */
  function savedState() {
    try { var w = JSON.parse(root.localStorage.getItem('agsist-wx-loc') || 'null'); return w && /^[A-Z]{2}$/.test(String(w.state || '').toUpperCase()) ? String(w.state).toUpperCase() : ''; } catch (e) { return ''; }
  }

  function draw(fit) {
    shown = filterPts(files, q);
    var sts = q.st ? [q.st] : files.map(function (f) { return f.st; });
    var st = story(files, sts, q.mo, q.amin, q.amax);
    headEl.textContent = st.head; takeEl.textContent = st.take;
    var ncEl = document.getElementById('lm-nc');
    if (ncEl) ncEl.textContent = counts(shown, q.nm ? 0 : filterPts(files, { st: q.st, mo: q.mo, amin: q.amin, amax: q.amax, odd: q.odd, nm: true }).length - shown.length);
    if (!map) return;
    if (fit) {
      var use = shown;
      if (fit !== 'url' && !q.st && hereSt && root.innerWidth < 700) { var mine = shown.filter(function (o) { return o.f.st === hereSt; }); if (mine.length) use = mine; }
      var b = use.length ? L.latLngBounds(use.map(function (o) { return [o.p[LAT], o.p[LNG]]; })) : null;
      if (q.at && fit === 'url') map.setView([q.at[0], q.at[1]], q.at[2], { animate: false });
      else if (b && b.isValid()) map.fitBounds(b, { padding: [8, 8], animate: false, maxZoom: 11 });
    }
    var z = map.getZoom(), bd = band(z);
    pinLayer.clearLayers(); markLayer.clearLayers(); marks = [];
    var small = z < PINZ, order = shown.slice().sort(function (a, b) { return (a.p[A] & 3 ? 1 : 0) - (b.p[A] & 3 ? 1 : 0); });
    order.forEach(function (o) {
      var p = o.p, at = spot(p), odd = !!(p[A] & 3), r = radius(p, z), m;
      var gold = odd ? { color: GOLD, weight: bd === 0 ? 1 : bd === 1 ? 2 : 2.5 } : null, fo = bd === 0 && !odd ? 0.7 : 0.92;
      if (p[KIND] === 'a') {
        /* an auction result: a SQUARE, same size rule, same color classes, gold edge when unusual */
        var sz = Math.round(r * 2 + 2);
        m = L.marker(at, { icon: L.divIcon({ className: 'lm-mk', iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2],
          html: '<span class="lm-sqm ' + (p[C] === null ? 'lm-wh' : 'lm-c' + p[C]) + (odd ? ' lm-od' : '') + '" style="width:' + sz + 'px;height:' + sz + 'px"></span>' }), keyboard: false });
      } else if (p[NM]) m = L.circleMarker(at, { radius: r, color: '#7d7d79', weight: small ? 1 : 1.5, dashArray: small ? null : '3 2', fill: true, fillColor: '#ffffff', fillOpacity: 0.15 });
      else if (p[C] === null) m = L.circleMarker(at, { radius: r, color: gold ? gold.color : '#444', weight: gold ? gold.weight : (small ? 0.6 : 1.2), fillColor: '#ffffff', fillOpacity: 0.9 });
      else m = L.circleMarker(at, { radius: r, color: gold ? gold.color : '#ffffff', weight: gold ? gold.weight : (small ? 0.6 : 1.2), fillColor: COL[String(p[C])], fillOpacity: fo });
      if (bd === 0) m.on('click', function () { map.setView(at, PINZ, { animate: !reduce }); });
      else m.bindPopup(function () { return popupHtml(o.f, p); }, { maxWidth: Math.min(290, box.clientWidth - 50), maxHeight: box.clientHeight - 70, autoPan: true, autoPanPadding: [8, 8], keepInView: true });
      m.addTo(pinLayer); o.m = m; marks.push(o);
      /* a cue besides color: from zoom 9 a triangle up (over the range) or down (under) on the pin */
      if (odd && z >= PINZ) L.marker(at, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'lm-mk', iconSize: [14, 14], iconAnchor: [7, 8],
        html: '<span>' + (p[A] & 1 ? '\u25b2' : '\u25bc') + '</span>' }) }).addTo(markLayer);
    });
    drawList();
  }

  function drawList() {
    var odd = shown.filter(function (o) { return !o.p[NM] && (o.p[A] & 3); });
    odd.sort(function (a, b) { return Math.abs(offPct(b.f, b.p) || 0) - Math.abs(offPct(a.f, a.p) || 0); });
    var cap = 60, keep = odd.slice(0, cap);
    if (sumEl) sumEl.textContent = 'Unusual sales with these filters: ' + n0(odd.length);
    ln.textContent = odd.length ? (odd.length > cap ? 'The ' + cap + ' furthest from their county median of ' + n0(odd.length) + '. Tap one to see it on the map.' : n0(odd.length) + ' with these filters. Tap one to see it on the map.') : 'None with these filters.';
    list.innerHTML = keep.map(function (o, i) {
      var p = o.p, co = o.f.counties[p[CO]], pct = offPct(o.f, p);
      return '<li><button type="button" data-i="' + i + '"><b>' + usd(p[PPA]) + ' an acre</b>, ' + (pct > 0 ? pct + '% above' : Math.abs(pct) + '% below') + ' the county median. ' +
        '<span>' + acres(p[AC]) + ', ' + esc(co[CNAME]) + ' County, ' + o.f.st + ', ' + day(p[WHEN]) + '</span></button></li>';
    }).join('');
    [].slice.call(list.querySelectorAll('button')).forEach(function (b) {
      b.addEventListener('click', function () {
        var o = keep[+b.getAttribute('data-i')];
        if (!map) return;
        var go = function () { if (!o.m) draw(false); var t = marks.filter(function (x) { return x.p === o.p; })[0]; if (t) t.m.openPopup(); };
        map.once('moveend', go);
        map.setView(spot(o.p), Math.max(map.getZoom(), 12), { animate: !reduce });
        try { box.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }); } catch (e) {}
      });
    });
  }

  /* ------------------------------------------------------------ share and the picture */
  function fit(x, s, max, sizes, wt) {
    for (var i = 0; i < sizes.length; i++) {
      x.font = wt + ' ' + sizes[i] + 'px Inter, system-ui, sans-serif';
      var words = s.split(' '), lines = [], cur = '';
      words.forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (x.measureText(t).width > max && cur) { lines.push(cur); cur = w; } else cur = t; });
      if (cur) lines.push(cur);
      if (lines.length <= 2) return { size: sizes[i], lines: lines };
    }
    return { size: sizes[sizes.length - 1], lines: lines.slice(0, 2) };
  }
  function card(done) {
    var W = 1200, H = 630, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var x = cv.getContext('2d'); if (!x || !map) { done(null); return; }
    var F = 'px Inter, system-ui, sans-serif', st = story(files, q.st ? [q.st] : files.map(function (f) { return f.st; }), q.mo, q.amin, q.amax);
    x.fillStyle = '#0a0c0d'; x.fillRect(0, 0, W, H); x.fillStyle = GOLD; x.fillRect(0, 0, W, 10);
    x.font = '800 34' + F; x.fillStyle = '#e9edeb'; x.fillText('agsist', 48, 62);
    var aw = x.measureText('agsist').width; x.font = '700 20' + F; x.fillStyle = GOLD; x.fillText('.com', 50 + aw, 62);
    x.font = '600 20' + F; x.fillStyle = 'rgba(233,237,235,.72)'; x.textAlign = 'right'; x.fillText('Farm sales map, newest record ' + day(latest), W - 48, 60); x.textAlign = 'left';
    var hd = fit(x, st.head, W - 96, [38, 34, 30], '800'), y = 80 + hd.size;
    x.font = '800 ' + hd.size + F; x.fillStyle = '#e9edeb'; hd.lines.forEach(function (l) { x.fillText(l, 48, y); y += hd.size * 1.2; });
    // the pins of the view, on a plain plate (tiles cannot go into a picture)
    var top = y + 6, bot = H - 70, left = 48, right = W - 330, b = map.getBounds();
    var n = b.getNorth(), s = b.getSouth(), w = b.getWest(), e = b.getEast(), kx = Math.cos((n + s) / 2 * Math.PI / 180);
    var sc = Math.min((right - left) / ((e - w) * kx), (bot - top) / (n - s)), ox = left + ((right - left) - (e - w) * kx * sc) / 2, oy = top + ((bot - top) - (n - s) * sc) / 2;
    x.fillStyle = '#141a18'; x.fillRect(left - 8, top - 8, right - left + 16, bot - top + 16);
    var px = function (lat, lng) { return [ox + (lng - w) * kx * sc, oy + (n - lat) * sc]; };
    var inb = shown.filter(function (o) { var a = spot(o.p); return a[0] <= n && a[0] >= s && a[1] >= w && a[1] <= e; });
    var dot = Math.max(1.6, Math.min(5, 900 / Math.sqrt(inb.length + 1) / 8));
    inb.forEach(function (o) {
      var a = px.apply(null, spot(o.p)), p = o.p;
      var rr = dot * (0.8 + 0.4 * Math.sqrt(p[AC] / 80));
      if (p[KIND] === 'a') {
        x.fillStyle = p[C] === null ? 'rgba(235,235,230,.85)' : COL[String(p[C])]; x.fillRect(a[0] - rr, a[1] - rr, rr * 2, rr * 2);
        x.strokeStyle = p[A] & 3 ? GOLD : 'rgba(255,255,255,.8)'; x.lineWidth = p[A] & 3 ? 2 : 1; x.strokeRect(a[0] - rr, a[1] - rr, rr * 2, rr * 2);
        return;
      }
      x.beginPath(); x.arc(a[0], a[1], rr, 0, 6.283);
      if (p[NM]) { x.strokeStyle = 'rgba(160,160,155,.7)'; x.lineWidth = 1; x.stroke(); return; }
      x.fillStyle = p[C] === null ? 'rgba(235,235,230,.75)' : COL[String(p[C])]; x.fill();
      if (p[A] & 3) { x.strokeStyle = GOLD; x.lineWidth = 2; x.stroke(); }
    });
    // key: the same one as the page (title, five classes, not compared, gold edge, hollow deeds, the two pin shapes)
    var ky = top + 6, kx0 = right + 36;
    x.font = '700 17' + F; x.fillStyle = '#e9edeb'; x.fillText('Price per acre against', kx0, ky + 12); x.fillText("the county's farmland sales", kx0, ky + 34); ky += 62;
    var row = function (t) { x.font = '400 17' + F; x.fillStyle = 'rgba(233,237,235,.86)'; x.fillText(t, kx0 + 28, ky); };
    [['2', 'Over the usual range'], ['1', 'Upper quarter'], ['0', 'Middle half'], ['-1', 'Lower quarter'], ['-2', 'Under the usual range']].forEach(function (k) {
      x.beginPath(); x.arc(kx0 + 9, ky - 6, 7, 0, 6.283); x.fillStyle = COL[k[0]]; x.fill(); row(k[1]); ky += 29;
    });
    x.beginPath(); x.arc(kx0 + 9, ky - 6, 7, 0, 6.283); x.fillStyle = 'rgba(235,235,230,.85)'; x.fill(); row('Not compared'); ky += 29;
    x.beginPath(); x.arc(kx0 + 9, ky - 6, 7, 0, 6.283); x.strokeStyle = GOLD; x.lineWidth = 2.5; x.stroke(); row('Gold edge: unusual'); ky += 29;
    x.beginPath(); x.arc(kx0 + 9, ky - 6, 7, 0, 6.283); x.fillStyle = COL['0']; x.fill(); row('Round: recorded sale'); ky += 29;
    x.fillStyle = COL['0']; x.fillRect(kx0 + 2, ky - 13, 14, 14); row('Square: auction result'); ky += 33;
    x.font = '700 17' + F; x.fillStyle = '#e9edeb'; x.fillText(n0(shown.filter(function (o) { return !o.p[NM]; }).length) + ' pins in this view', kx0, ky);
    x.font = '400 16' + F; x.fillStyle = 'rgba(233,237,235,.72)';
    x.fillText('Sales of 20+ acres, last 24 months: state transfer records and auction company results.', 48, H - 42);
    x.font = '700 19' + F; x.fillStyle = GOLD; x.fillText('agsist.com/land-sales', 48, H - 16);
    cv.toBlob(function (bl) { done(bl); }, 'image/png');
  }
  function setupTools() {
    var nav = root.navigator || {}, canFiles = false;
    try { canFiles = !!(nav.share && nav.canShare && root.File && nav.canShare({ files: [new root.File([''], 'x.png', { type: 'image/png' })] })); } catch (e) {}
    tools.innerHTML = (canFiles ? '<button type="button" class="lm-share">Share</button>' : '<button type="button" class="lm-copy">Copy link</button>') + '<button type="button" class="lm-save">Save the picture</button>';
    var save = function (b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'agsist-farm-sales-map.png'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); };
    var flash = function (b, t) { var o = b.textContent; b.textContent = t; setTimeout(function () { b.textContent = o; }, 1800); };
    tools.querySelector('.lm-save').addEventListener('click', function () { card(function (b) { if (b) save(b); }); });
    var cp = tools.querySelector('.lm-copy');
    if (cp) cp.addEventListener('click', function () { var u = viewUrl(); try { nav.clipboard.writeText(u).then(function () { flash(cp, 'Link copied'); }, function () { flash(cp, 'Copy failed'); }); } catch (e) { flash(cp, 'Copy failed'); } });
    var sb = tools.querySelector('.lm-share');
    if (sb) sb.addEventListener('click', function () {
      var u = viewUrl();
      card(function (b) {
        var data = { title: 'Farm sales map | AGSIST', text: headEl.textContent, url: u };
        try { if (b) data.files = [new root.File([b], 'agsist-farm-sales-map.png', { type: 'image/png' })]; } catch (e) {}
        nav.share(data).catch(function (e) { if (!(e && e.name === 'AbortError') && b) save(b); });
      });
    });
  }

  function setBase(b) {
    q.base = b;
    if (tiles) map.removeLayer(tiles);
    tiles = L.tileLayer(BASES[b], { maxNativeZoom: 16, maxZoom: 16, attribution: 'Map: USGS' }).addTo(map);
    tiles.bringToBack();
    [].slice.call(box.querySelectorAll('.lm-base button')).forEach(function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-b') === b)); });
  }
  function baseControl() {
    var C = L.Control.extend({ options: { position: 'bottomleft' }, onAdd: function () {
      var d = L.DomUtil.create('div', 'lm-base');
      d.setAttribute('role', 'group'); d.setAttribute('aria-label', 'Base map');
      d.innerHTML = '<button type="button" data-b="topo" aria-pressed="' + (q.base === 'topo') + '">Topo</button><button type="button" data-b="aerial" aria-pressed="' + (q.base === 'aerial') + '">Aerial</button>';
      L.DomEvent.disableClickPropagation(d);
      [].slice.call(d.querySelectorAll('button')).forEach(function (b) { b.addEventListener('click', function () { setBase(b.getAttribute('data-b')); }); });
      return d;
    } });
    new C().addTo(map);
  }

  function start() {
    loadCss(LEAFLET + 'leaflet.css');
    loadScript(LEAFLET + 'leaflet.js').then(function (ok) {
      if (!ok || !root.L) { wait.textContent = 'The map did not load. Every unusual sale is in the list below, and every sale is on its county page.'; return null; }
      L = root.L;
      return Promise.all([true].concat((sec.getAttribute('data-files') || '').split(',').filter(Boolean).map(getJSON)));
    }).then(function (got) {
      if (!got) return;
      files = got.slice(1).filter(function (f) { return f && f.pts; });
      if (!files.length) { wait.textContent = 'The sale files did not load. Every sale is on its county page.'; return; }
      latest = latestOf(files);
      wait.parentNode.removeChild(wait);
      if (q.st && !files.some(function (f) { return f.st === q.st; })) q.st = '';
      hereSt = savedState();
      toForm();
      map = L.map(box, { renderer: L.canvas({ tolerance: 10 }), scrollWheelZoom: false, zoomSnap: 0.25, worldCopyJump: false, minZoom: 4, maxZoom: 16 });
      map.attributionControl.setPrefix(false);
      setBase(q.base);
      baseControl();
      pinLayer = L.layerGroup().addTo(map); markLayer = L.layerGroup().addTo(map);
      map.setView([41, -88], 5, { animate: false });
      draw(q.at ? 'url' : true);
      var lastZ = map.getZoom();
      map.on('zoomend', function () { var z = map.getZoom(); if (band(z) !== band(lastZ) || Math.abs(z - lastZ) >= 1) draw(false); lastZ = z; });
      setupTools();
    });
  }

  readUrl(); toForm();
  form.addEventListener('change', function (ev) { fromForm(); q.at = null; draw(ev.target && (ev.target.name === 'lst' || ev.target.name === 'lmo') ? true : false); });
  form.addEventListener('submit', function (ev) { ev.preventDefault(); });
  near(box, start);
})(typeof window !== 'undefined' ? window : globalThis);
