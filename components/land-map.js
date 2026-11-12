/* components/land-map.js: every farm sale on a map (land sales hub, Nov 12, 2026).
   The section (#land-map) is written by the land sales builder with a headline, filters, a box of reserved
   height, a key and an empty list. When the box comes near the screen this loads Leaflet and the heat layer
   (vendor/), then the state files (data/land-sales/map/<st>.json, one per state, built on main), and draws:
     - one pin per sale of 20 acres or more over 24 months, placed at its section, township, town or county
       center (never the parcel; each pin says which), fanned out a little when several share a spot;
     - colour: the sale's price per acre against its own county's 24-month median and usual range;
       size: acres; a gold ring: outside the usual range or among the largest 1% of the state's sales;
       family and other deeds (left out of every median) hollow and grey, off until the reader turns them on;
     - zoomed out: a heat layer (where sales are, or where prices run over the county median) under the
       ringed pins; zoomed in, every pin;
     - a tap shows date, acres, $/acre, price, the county median and how far off, the placement and only the
       links whose page exists (the sale's row, Field Scout at that spot, the Farmland Atlas county page);
     - the headline and the list of unusual sales follow the filters; Share and Save the picture
       (1200 x 630) carry the view. No buyer or seller name is in any file this reads.
   Exports window.AgLandMap (and module.exports) for the tests: story, popupHtml, links, placeNote, filterPts. */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var NAMES = { IL: 'Illinois', IN: 'Indiana', WI: 'Wisconsin', NJ: 'New Jersey', VT: 'Vermont' };
  var SLUGS = { IL: 'illinois', IN: 'indiana', WI: 'wisconsin', NJ: 'new-jersey', VT: 'vermont' };
  var NUMW = { 2: 'two', 3: 'three', 4: 'four', 5: 'five' };
  var COL = { '-2': '#1f5fa8', '-1': '#4ea3e0', '0': '#b4b2ab', '1': '#ec7a36', '2': '#b8212f' };
  var GOLD = '#d4a23f';
  var KINDW = { f: 'farmland', b: 'with buildings', w: 'forest', s: 'small parcel' };
  var NMW = { r: 'a related-party sale', q: 'a quit claim or other non-sale deed', x: 'exempt from the transfer tax', p: 'a part interest' };
  var UP_WHY = 'a house or buildings, timber or hunting ground, a building site or development land, or a neighbor paying more for the piece next door';
  var DOWN_WHY = 'a family or neighbor sale, a part interest, wooded, wet or poorer ground, no road access, or a land contract';
  var LEAFLET = '/vendor/leaflet-1.9.4/', HEAT = '/vendor/leaflet.heat-0.2.0/leaflet-heat.js';
  var TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}';
  var PINZ = 9;          // zoom from which every pin shows; below it the heat layer and the ringed pins
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

  /* the headline and the line under it (scripts/land_map.py headline writes the same from the same data) */
  function story(files, states, months) {
    var sts = files.filter(function (f) { return states.indexOf(f.st) >= 0; });
    var latest = latestOf(sts);
    if (!latest) return { head: 'No recorded farm sales to show.', take: '' };
    var cut = monthsBack(latest, months), n = 0, big = 0, odd = 0;
    sts.forEach(function (f) {
      f.pts.forEach(function (p) {
        if (p[NM] || p[WHEN] <= cut) return;
        n++;
        var co = f.counties[p[CO]];
        if (p[C] !== null && p[PPA] !== null && co[CMED] && p[PPA] >= 1.5 * co[CMED]) big++;
        if (p[A] & 3) odd++;
      });
    });
    var where = sts.length === 1 ? NAMES[sts[0].st] : (NUMW[sts.length] || sts.length) + ' states';
    var span = months === 1 ? 'in the last month' : 'in the last ' + months + ' months';
    var head = big ? n0(big) + ' ' + (big === 1 ? 'sale' : 'sales') + ' in ' + where + ' ' + span + " priced more than 50% above their county's median."
      : n0(n) + ' farm ' + (n === 1 ? 'sale' : 'sales') + ' in ' + where + ' ' + span + ", none priced more than 50% above their county's median.";
    return { head: head, take: n0(odd) + ' of ' + n0(n) + ' sales of ' + MIN_ACRES + " acres or more sold outside their county's usual price range." };
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
    if (p[ID]) out.push(['Sale details', '/land-sales/' + SLUGS[f.st] + '/' + co[CSLUG] + '#s-' + p[ID]]);
    if (fieldScoutCovers(p[LAT], p[LNG])) out.push(['Field Scout', '/field-scout?at=' + p[LAT].toFixed(4) + ',' + p[LNG].toFixed(4) + '&fips=' + co[CF]]);
    if (co[CATLAS]) out.push(['Farmland Atlas', '/farmland-atlas/' + SLUGS[f.st] + '/' + co[CSLUG]]);
    return out;
  }
  function offPct(f, p) {
    var co = f.counties[p[CO]];
    return (p[C] !== null && co[CMED] && p[PPA] !== null) ? Math.round((p[PPA] / co[CMED] - 1) * 100) : null;
  }
  function popupHtml(f, p) {
    var co = f.counties[p[CO]], cn = co[CNAME] + ' County, ' + f.st, h = [], why = [];
    h.push('<div class="lm-pop">');
    h.push('<p><b>' + (p[PPA] !== null ? usd(p[PPA]) + ' an acre' : 'Price per acre not stated') + '</b><br>' + acres(p[AC]) + ' for ' + usd(p[PR]) + '</p>');
    h.push('<p>' + day(p[WHEN]) + ' &middot; ' + esc(cn) + ', ' + esc(KINDW[p[KIND]] || '') + '</p>');
    if (p[NM]) {
      h.push('<p>Left out of every median: ' + NMW[p[NM]] + '.</p>');
    } else if (p[C] !== null) {
      var pct = offPct(f, p);
      h.push('<p>' + (pct === 0 ? 'Right at' : Math.abs(pct) + '% ' + (pct > 0 ? 'above' : 'below')) + ' the ' + esc(co[CNAME]) + ' County median of ' + usd(co[CMED]) +
        ' an acre (' + co[CN] + ' bare farmland sales over 24 months; usual range ' + (co[CLO] > 0 ? usd(co[CLO]) + ' to ' : 'up to ') + usd(co[CHI]) + ').</p>');
      if (p[A] & 1) why.push('<p class="lm-note">Over the usual range. Possible reasons: ' + UP_WHY + '.</p>');
      if (p[A] & 2) why.push('<p class="lm-note">Under the usual range. Possible reasons: ' + DOWN_WHY + '.</p>');
    } else if (!co[CMED]) {
      h.push('<p>' + esc(co[CNAME]) + ' County has under 5 bare farmland sales in 24 months, so no median.</p>');
    } else {
      h.push('<p>Not judged against the county median: ' + esc(KINDW[p[KIND]] || 'not bare farmland') + '.</p>');
    }
    if (p[A] & 4) h.push('<p>Among the largest 1% of ' + NAMES[f.st] + ' sales by price.</p>');
    if (p[A] & 8) h.push('<p>Among the largest 1% of ' + NAMES[f.st] + ' sales by acres.</p>');
    h.push('<p class="lm-note">' + esc(placeNote(p[PC], f.places[p[PN]], co[CNAME])) + '</p>');
    var L0 = links(f, p);
    if (L0.length) h.push('<p class="lm-go">' + L0.map(function (l) { return '<a href="' + esc(l[1]) + '">' + esc(l[0]) + '</a>'; }).join('') + '</p>');
    h = h.concat(why);
    h.push('</div>');
    return h.join('');
  }

  /* the pins a filter keeps: [{f, p}] */
  function filterPts(files, q, latest) {
    var cut = monthsBack(latest, q.mo), out = [];
    files.forEach(function (f) {
      if (q.st && f.st !== q.st) return;
      f.pts.forEach(function (p) {
        if (p[WHEN] <= cut || p[AC] < q.amin || (q.amax && p[AC] > q.amax)) return;
        if (p[NM] && !q.nm) return;
        if (q.odd && !(p[A] & 15)) return;
        out.push({ f: f, p: p });
      });
    });
    return out;
  }

  var api = { story: story, popupHtml: popupHtml, links: links, placeNote: placeNote, filterPts: filterPts, monthsBack: monthsBack, fieldScoutCovers: fieldScoutCovers };
  root.AgLandMap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  /* ------------------------------------------------------------ the page */
  var sec = document.getElementById('land-map');
  if (!sec) return;
  var form = document.getElementById('lm-f'), box = document.getElementById('lm-box'), wait = document.getElementById('lm-wait');
  var headEl = document.getElementById('lm-head'), takeEl = document.getElementById('lm-take'), list = document.getElementById('lm-list'), ln = document.getElementById('lm-ln');
  var tools = document.getElementById('lm-tools');
  var reduce = false; try { reduce = root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var files = [], map = null, heat = null, pinLayer = null, ringLayer = null, shown = [], latest = '', L = null, marks = [];
  var q = { st: '', mo: +sec.getAttribute('data-open') || 12, amin: MIN_ACRES, amax: 0, odd: false, nm: false, heat: 'n' };

  function readUrl() {
    var s = location.search || '', g = function (k) { var m = new RegExp('[?&]' + k + '=([^&]*)').exec(s); return m ? decodeURIComponent(m[1]) : null; };
    var st = (g('st') || '').toUpperCase(); if (NAMES[st]) q.st = st;
    var mo = +g('mo'); if ([3, 6, 12, 24].indexOf(mo) >= 0) q.mo = mo;
    var a0 = +g('amin'); if ([20, 40, 80, 160, 320].indexOf(a0) >= 0) q.amin = a0;
    var a1 = +g('amax'); if ([40, 80, 160, 320].indexOf(a1) >= 0) q.amax = a1;
    q.odd = g('odd') === '1'; q.nm = g('nm') === '1'; q.heat = g('heat') === 'p' ? 'p' : 'n';
    var at = /^(-?\d+\.?\d*),(-?\d+\.?\d*),(\d+(?:\.\d)?)$/.exec(g('at') || '');
    q.at = at ? [+at[1], +at[2], +at[3]] : null;
  }
  function toForm() {
    form.lst.value = q.st.toLowerCase(); form.lmo.value = String(q.mo); form.lamin.value = String(q.amin); form.lamax.value = q.amax ? String(q.amax) : '';
    form.lodd.checked = q.odd; form.lnm.checked = q.nm; form.lheat.value = q.heat;
  }
  function fromForm() {
    q.st = (form.lst.value || '').toUpperCase(); q.mo = +form.lmo.value; q.amin = +form.lamin.value; q.amax = +form.lamax.value || 0;
    q.odd = form.lodd.checked; q.nm = form.lnm.checked; q.heat = form.lheat.value;
  }
  function viewUrl() {
    var u = location.origin + location.pathname + '?', p = [];
    if (q.st) p.push('st=' + q.st.toLowerCase());
    if (q.mo !== 12) p.push('mo=' + q.mo);
    if (q.amin !== MIN_ACRES) p.push('amin=' + q.amin);
    if (q.amax) p.push('amax=' + q.amax);
    if (q.odd) p.push('odd=1');
    if (q.nm) p.push('nm=1');
    if (q.heat === 'p') p.push('heat=p');
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
    if (z < PINZ) r *= 0.75;
    return Math.max(3, Math.min(13, r));
  }

  function draw(fit) {
    shown = filterPts(files, q, latest);
    var st = story(files, q.st ? [q.st] : files.map(function (f) { return f.st; }), q.mo);
    headEl.textContent = st.head; takeEl.textContent = st.take;
    if (!map) return;
    if (fit) {
      var b = shown.length ? L.latLngBounds(shown.map(function (o) { return [o.p[LAT], o.p[LNG]]; })) : null;
      if (q.at && fit === 'url') map.setView([q.at[0], q.at[1]], q.at[2], { animate: false });
      else if (b && b.isValid()) map.fitBounds(b, { padding: [12, 12], animate: false, maxZoom: 11 });
    }
    var z = map.getZoom();
    pinLayer.clearLayers(); ringLayer.clearLayers(); marks = [];
    var hp = [];
    shown.forEach(function (o) {
      var p = o.p, at = spot(p), ring = !!(p[A] & 15), all = z >= PINZ;
      if (!p[NM]) {
        var w = q.heat === 'p' ? (p[C] !== null && o.f.counties[p[CO]][CMED] ? Math.max(0, Math.min(2, p[PPA] / o.f.counties[p[CO]][CMED] - 1)) : 0) : 0.5;
        if (w > 0) hp.push([at[0], at[1], w]);
      }
      if (!all && !ring) return;
      var r = radius(p, z), m;
      if (p[NM]) m = L.circleMarker(at, { radius: r, color: '#7d7d79', weight: 1.5, dashArray: '3 2', fill: true, fillColor: '#ffffff', fillOpacity: 0.15 });
      else if (p[C] === null) m = L.circleMarker(at, { radius: r, color: '#444', weight: 1.2, fillColor: '#ffffff', fillOpacity: 0.9 });
      else m = L.circleMarker(at, { radius: r, color: '#ffffff', weight: 1.2, fillColor: COL[String(p[C])], fillOpacity: 0.92 });
      m.bindPopup(function () { return popupHtml(o.f, p); }, { maxWidth: 290, maxHeight: box.clientHeight - 60, autoPanPadding: [10, 10] });
      m.addTo(pinLayer); o.m = m; marks.push(o);
      if (ring) L.circleMarker(at, { radius: r + 3, color: GOLD, weight: 2.5, fill: false, interactive: false }).addTo(ringLayer);
    });
    if (heat) {
      heat.options.max = q.heat === 'p' ? 1 : 2.5;
      if (z >= PINZ) { if (map.hasLayer(heat)) map.removeLayer(heat); heat._latlngs = hp; }
      else if (map.hasLayer(heat)) heat.setLatLngs(hp);
      else { heat._latlngs = hp; heat.addTo(map); }
    }
    drawList();
  }

  function drawList() {
    var odd = shown.filter(function (o) { return !o.p[NM] && (o.p[A] & 3); });
    odd.sort(function (a, b) { return Math.abs(offPct(b.f, b.p) || 0) - Math.abs(offPct(a.f, a.p) || 0); });
    var cap = 60, keep = odd.slice(0, cap);
    ln.textContent = odd.length ? (odd.length > cap ? 'The ' + cap + ' furthest from their county median of ' + n0(odd.length) + '. Tap one to see it on the map.' : n0(odd.length) + ' in this view. Tap one to see it on the map.') : 'None in this view.';
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
    var F = 'px Inter, system-ui, sans-serif', st = story(files, q.st ? [q.st] : files.map(function (f) { return f.st; }), q.mo);
    x.fillStyle = '#0a0c0d'; x.fillRect(0, 0, W, H); x.fillStyle = GOLD; x.fillRect(0, 0, W, 10);
    x.font = '800 34' + F; x.fillStyle = '#e9edeb'; x.fillText('agsist', 48, 62);
    var aw = x.measureText('agsist').width; x.font = '700 20' + F; x.fillStyle = GOLD; x.fillText('.com', 50 + aw, 62);
    x.font = '600 20' + F; x.fillStyle = 'rgba(233,237,235,.72)'; x.textAlign = 'right'; x.fillText('Farm sales map · ' + day(latest), W - 48, 60); x.textAlign = 'left';
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
      x.beginPath(); x.arc(a[0], a[1], dot * (0.8 + 0.4 * Math.sqrt(p[AC] / 80)), 0, 6.283);
      if (p[NM]) { x.strokeStyle = 'rgba(160,160,155,.7)'; x.lineWidth = 1; x.stroke(); return; }
      x.fillStyle = p[C] === null ? 'rgba(235,235,230,.75)' : COL[String(p[C])]; x.fill();
      if (p[A] & 15) { x.beginPath(); x.arc(a[0], a[1], dot * 1.6 + 2.5, 0, 6.283); x.strokeStyle = GOLD; x.lineWidth = 2; x.stroke(); }
    });
    // key
    var ky = top + 6, kx0 = right + 36;
    x.font = '700 20' + F; x.fillStyle = '#e9edeb'; x.fillText('Price per acre vs county median', kx0, ky + 14); ky += 44;
    [['2', 'Over the usual range'], ['1', 'Upper quarter'], ['0', 'Middle half'], ['-1', 'Lower quarter'], ['-2', 'Under the usual range']].forEach(function (k) {
      x.beginPath(); x.arc(kx0 + 9, ky - 6, 8, 0, 6.283); x.fillStyle = COL[k[0]]; x.fill();
      x.font = '400 19' + F; x.fillStyle = 'rgba(233,237,235,.86)'; x.fillText(k[1], kx0 + 28, ky); ky += 34;
    });
    x.beginPath(); x.arc(kx0 + 9, ky - 6, 9, 0, 6.283); x.strokeStyle = GOLD; x.lineWidth = 2.5; x.stroke();
    x.fillText('Unusual or largest 1%', kx0 + 28, ky); ky += 34;
    x.fillText(n0(inb.length) + ' sales in this view', kx0, ky + 10);
    x.font = '400 16' + F; x.fillStyle = 'rgba(233,237,235,.72)';
    x.fillText('State transfer records, 20+ acres. Pins at section, town or county center, not the parcel.', 48, H - 42);
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

  function start() {
    loadCss(LEAFLET + 'leaflet.css');
    loadScript(LEAFLET + 'leaflet.js').then(function (ok) {
      if (!ok || !root.L) { wait.textContent = 'The map did not load. Every unusual sale is in the list below, and every sale is on its county page.'; return null; }
      L = root.L;
      return Promise.all([loadScript(HEAT)].concat((sec.getAttribute('data-files') || '').split(',').filter(Boolean).map(getJSON)));
    }).then(function (got) {
      if (!got) return;
      files = got.slice(1).filter(function (f) { return f && f.pts; });
      if (!files.length) { wait.textContent = 'The sale files did not load. Every sale is on its county page.'; return; }
      latest = latestOf(files);
      wait.parentNode.removeChild(wait);
      map = L.map(box, { preferCanvas: true, scrollWheelZoom: false, zoomSnap: 0.5, worldCopyJump: false, minZoom: 4, maxZoom: 16 });
      map.attributionControl.setPrefix(false);
      L.tileLayer(TILES, { maxNativeZoom: 16, maxZoom: 16, attribution: 'Map: USGS' }).addTo(map);
      pinLayer = L.layerGroup().addTo(map); ringLayer = L.layerGroup().addTo(map);
      if (L.heatLayer) heat = L.heatLayer([], { radius: 16, blur: 18, minOpacity: 0.25, maxZoom: PINZ, gradient: { 0.2: '#4ea3e0', 0.45: '#f2d36b', 0.7: '#ec7a36', 1: '#b8212f' } });
      map.setView([41, -88], 5, { animate: false });
      draw(q.at ? 'url' : true);
      var lastZ = map.getZoom();
      map.on('zoomend', function () { var z = map.getZoom(); if ((z >= PINZ) !== (lastZ >= PINZ) || Math.abs(z - lastZ) >= 1) draw(false); lastZ = z; });
      setupTools();
    });
  }

  readUrl(); toForm();
  form.addEventListener('change', function (ev) { fromForm(); q.at = null; draw(ev.target && (ev.target.name === 'lst' || ev.target.name === 'lmo') ? true : false); });
  form.addEventListener('submit', function (ev) { ev.preventDefault(); });
  near(box, start);
})(typeof window !== 'undefined' ? window : globalThis);
