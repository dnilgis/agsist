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
  /* the key's words when every file in scope is auction results only (no state transfer returns on this site for it) */
  var KT_DEF = null, KNOT_DEF = null;
  var KT_AUC = "Price per acre against the county's auction middle (auction results only):";
  var KNOT_AUC = 'Not compared: auctions with no single per-acre figure, or counties with too few auction figures';
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
  /* the day the records of the files in scope run to: the files' own through, never the newest pin (one date story, picture and page) */
  function throughNote(fs) {
    var t = fs.map(function (f) { return f.through; }).filter(Boolean).sort(), u = t.filter(function (x, i) { return t.indexOf(x) === i; });
    return !u.length ? '' : u.length === 1 ? day(u[0]) : day(u[u.length - 1]) + ' (newest state)';
  }

  /* the headline and the line under it (scripts/land_map.py headline writes the same from the same data): each state's
     last `months` months to its newest record, within the acres chosen; only bare farmland sales recorded with the state and
     judged against their county count; ONE meaning of unusual: outside the county's usual range (class bits 1 and 2);
     auction results (kind a) are never in these counts */
  function acreWords(amin, amax) { return amax ? amin + ' to ' + amax + ' acres' : amin + ' acres or more'; }
  /* only auction pins in the states chosen (no state transfer returns on this site): the auction results of the window, how many carry
     one per-acre figure in a county with an auction middle, how many of those are outside its usual range (scripts/land_map.py auction_headline) */
  function auctionStory(sts, months, amin, amax) {
    var n = 0, fig = 0, odd = 0;
    sts.forEach(function (f) {
      var cut = monthsBack(f.through, months);
      f.pts.forEach(function (p) {
        if (p[NM] || p[WHEN] <= cut || p[AC] < amin || (amax && p[AC] > amax)) return;
        n++; if (p[C] !== null) fig++; if (p[A] & 3) odd++;
      });
    });
    var one = sts.length === 1, where = one ? sts[0].name : (NUMW[sts.length] || sts.length) + ' states';
    var span = one ? 'in the ' + months + ' months to ' + day(sts[0].through) : 'in the ' + months + " months to each state's newest record";
    return { head: n0(n) + ' auction ' + (n === 1 ? 'result' : 'results') + ' of ' + acreWords(amin, amax) + ' in ' + where + ' ' + span + '.',
      take: (fig ? n0(fig) : 'None') + (fig === 1 ? ' carries' : ' carry') + ' one per-acre figure in a county with an auction middle; ' +
        (!odd ? 'none is outside its usual range' : odd === 1 ? '1 is outside its usual range' : n0(odd) + ' are outside their usual range') +
        '. No state transfer returns for ' + (one ? sts[0].name : 'these states') + ' are on this site yet.' };
  }
  function story(files, states, months, amin, amax) {
    amin = amin || MIN_ACRES; amax = amax || 0;
    var sts = files.filter(function (f) { return states.indexOf(f.st) >= 0 && f.pts && f.pts.some(function (p) { return p[KIND] !== 'a'; }); });
    if (!sts.length) {
      var ast = files.filter(function (f) { return states.indexOf(f.st) >= 0 && f.pts && f.pts.length; });
      return ast.length ? auctionStory(ast, months, amin, amax) : { head: 'No state-recorded farm sales to show.', take: '' };
    }
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

  function placeNote(code, words, county, ring) {
    if (ring === 'auction' || ring === 'auction-ring') return 'Placed at county center: the company gives the county only, so this pin is at the center of ' + county + ' County, not the exact parcel.' +
      (ring === 'auction-ring' ? ' Auctions in the same county sit in a small ring around that center, so each has its own pin.' : '');
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
  /* how far from the county middle, in words: past 1000% it says "about 156 times" (the ratio, so the biggest differ from each other) */
  function offWords(pct) { return pct === 0 ? 'right at' : pct > 1000 ? 'about ' + n0(Math.round(pct / 100 + 1)) + ' times' : n0(Math.abs(pct)) + '% ' + (pct > 0 ? 'above' : 'below'); }
  /* the result pages of a company: a link that more than one result of the file shares opens the company's whole list, not that result */
  function urlShared(f, url) {
    if (!f.au || !url) return false;
    if (!f._ucount) { f._ucount = {}; Object.keys(f.au).forEach(function (k) { var u = f.au[k] && f.au[k][1]; if (u) f._ucount[u] = (f._ucount[u] || 0) + 1; }); }
    return f._ucount[url] > 1;
  }
  function popupHtml(f, p, ring) {
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
      var ow = offWords(pct);
      h.push('<p>' + ow.charAt(0).toUpperCase() + ow.slice(1) + (f.basis === 'auction' ? " the county's auction middle of " : ' the county median of ') + usd(co[CMED]) +
        ' an acre (' + co[CN] + basis + '; usual range ' + (co[CLO] > 0 ? usd(co[CLO]) + ' to ' : 'up to ') + usd(co[CHI]) + ').</p>');
      if (p[A] & 1) why.push('<p class="lm-note">Over the usual range. Possible reasons: ' + UP_WHY + '.</p>');
      if (p[A] & 2) why.push('<p class="lm-note">Under the usual range. Possible reasons: ' + DOWN_WHY + '.</p>');
    } else if (auc && p[PPA] === null) {
      h.push('<p>Not compared: ' + (au && au[2] ? 'an auction of several tracts has no single per-acre figure.' : 'the company printed no single per-acre figure for this auction.') + '</p>');
    } else if (!co[CMED]) {
      h.push('<p>Not compared: ' + esc(co[CNAME]) + ' County has too few ' + (f.basis === 'auction' ? 'auction per-acre figures in 24 months for a middle (it takes 5 figures from 3 auctions)' : 'bare farmland sales in 24 months for a median') + '.</p>');
    } else {
      h.push('<p>Not compared with the county median: ' + (auc ? 'the figure is under $500 an acre' : esc(KINDW[p[KIND]] || 'not bare farmland')) + '.</p>');
    }
    var L0 = links(f, p);
    if (au && au[1]) L0.push([(urlShared(f, au[1]) ? 'Results list on ' : 'Result on ') + au[0] + "'s site", au[1]]);
    if (L0.length) h.push('<p class="lm-go">' + L0.map(function (l) { return '<a href="' + esc(l[1]) + '"' + (/^https?:/.test(l[1]) ? ' rel="noopener nofollow"' : '') + '>' + esc(l[0]) + '</a>'; }).join('') + '</p>');
    var top = (p[A] & 4 ? ['price'] : []).concat(p[A] & 8 ? ['acres'] : []);
    if (top.length) h.push('<p>Among the largest 1% of ' + esc(f.name) + ' ' + (f.basis === 'auction' ? 'auction results' : 'sales') + ' by ' + top.join(' and by ') + '.</p>');
    h.push('<p class="lm-note">' + esc(placeNote(p[PC], f.places[p[PN]], co[CNAME], auc && p[PC] === 'c' ? (ring ? 'auction-ring' : 'auction') : '')) + '</p>');
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
  function counts(shown, hiddenNm, off, st) {
    var n = 0, nc = 0, au = 0, nm = 0;
    shown.forEach(function (o) {
      var p = o.p;
      if (p[NM]) { nm++; return; }
      n++;
      if (p[KIND] === 'a') au++;
      if (p[C] === null) nc++;
    });
    var why = n && au === n ? 'auctions with no single per-acre figure or counties with too few auction figures'
      : 'buildings, forest, auctions with no single per-acre figure, or counties with too few sales to compare';
    var t = n0(n) + (n === 1 ? ' pin' : ' pins') + ' with these filters' + (au ? ', ' + n0(au) + ' of them auction results (squares)' : '') + '. ' +
      n0(nc) + (nc === 1 ? ' is' : ' are') + ' white and not compared: ' + why + '.';
    if (nm) t += ' ' + n0(nm) + ' family, quit claim or part-interest ' + (nm === 1 ? 'deed is' : 'deeds are') + ' shown hollow.';
    else if (hiddenNm) t += ' ' + n0(hiddenNm) + ' family, quit claim or part-interest deeds are hidden until ticked.';
    if (off) t += ' ' + n0(off) + ' auction ' + (off === 1 ? 'square is' : 'squares are') + ' outside this view: ' + (st ? 'zoom out to see them.' : 'zoom out or pick a state.');
    return t;
  }

  var api = { windowLine: windowLine, pictureModel: pictureModel, stateSpots: stateSpots, pointInRing: pointInRing, viewHead: viewHead, footNote: footNote, auctionOnly: auctionOnly, urlShared: urlShared, KT_AUC: KT_AUC, KNOT_AUC: KNOT_AUC, ringOffsets: ringOffsets, story: story, counts: counts, offWords: offWords, throughNote: throughNote, popupHtml: popupHtml, links: links, placeNote: placeNote, filterPts: filterPts, monthsBack: monthsBack, fieldScoutCovers: fieldScoutCovers };
  root.AgLandMap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  /* ------------------------------------------------------------ the page */
  var sec = document.getElementById('land-map');
  if (!sec) return;
  var form = document.getElementById('lm-f'), box = document.getElementById('lm-box'), wait = document.getElementById('lm-wait');
  var headEl = document.getElementById('lm-head'), takeEl = document.getElementById('lm-take'), list = document.getElementById('lm-list'), ln = document.getElementById('lm-ln');
  var tools = document.getElementById('lm-tools'), sumEl = document.getElementById('lm-lh');
  var ktEl = document.getElementById('lm-kt'), knotEl = document.getElementById('lm-knot');
  if (ktEl) KT_DEF = ktEl.textContent;
  if (knotEl && knotEl.lastChild) KNOT_DEF = knotEl.lastChild.textContent; else knotEl = null;
  var reduce = false; try { reduce = root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var files = [], map = null, tiles = null, pinLayer = null, markLayer = null, selLayer = null, shown = [], L = null, marks = [], hereSt = '';
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
  /* an auction is placed at its county center, so squares of one county share a spot: from zoom 7 they sit on a small ring around it,
     laid out in screen pixels (the same order every time: newest first, as the file is sorted), so each sale is its own pin */
  function ringOffsets(n, sz, turn) {
    if (n < 2) return [[0, 0]];
    var R = Math.max(14, sz + 4, n * (sz + 3) / 6.2832), out = [];
    for (var i = 0; i < n; i++) { var t = -Math.PI / 2 + (turn || 0) + i * 6.2832 / n; out.push([R * Math.cos(t), R * Math.sin(t)]); }
    return out;
  }
  function ringAuctions(list, z) {
    var g = {};
    list.forEach(function (o) { o.at = null; o.ringed = false; if (o.p[KIND] === 'a') { var k = o.p[LAT] + ',' + o.p[LNG]; (g[k] = g[k] || []).push(o); } });
    if (z < STACKZ || !map) return;
    Object.keys(g).forEach(function (k) {
      var gr = g[k], n = gr.length; if (n < 2) return;
      var c = map.latLngToLayerPoint([gr[0].p[LAT], gr[0].p[LNG]]), sz = 0;
      gr.forEach(function (o) { sz = Math.max(sz, sqSize(o.p, z)); });
      var off = ringOffsets(n, sz);
      gr.forEach(function (o, i) { o.at = map.layerPointToLatLng(L.point(c.x + off[i][0], c.y + off[i][1])); o.ringed = true; });
    });
  }
  function radius(p, z, tiny) {
    if (tiny) return 1.5;
    var r = 3 + 1.6 * Math.sqrt(p[AC] / MIN_ACRES);
    if (z < 7) r *= 0.42; else if (z < PINZ) r *= 0.62;
    return Math.max(z < PINZ ? 2 : 3, Math.min(13, r));
  }
  function band(z) { return z < STACKZ ? 0 : z < PINZ ? 1 : 2; }
  function sqSize(p, z) {
    var sz = Math.max(5, Math.round(radius(p, z, false) * (band(z) === 0 ? 1.5 : 1.8) + 1));
    return p[C] === null && z >= STACKZ ? Math.max(sz, 11) : sz;
  }
  /* the saved state of this reader (the weather location the site keeps on the device), when the map has it: a phone opens there */
  function savedState() {
    try { var w = JSON.parse(root.localStorage.getItem('agsist-wx-loc') || 'null'); return w && /^[A-Z]{2}$/.test(String(w.state || '').toUpperCase()) ? String(w.state).toUpperCase() : ''; } catch (e) { return ''; }
  }
  var offN = 0, selO = null;
  function narrow() { return (root.innerWidth || 1024) < 700; }
  function atOf(o) { return o.at ? [o.at.lat, o.at.lng] : spot(o.p); }
  /* a phone: a pin's details go in a panel under the map (a popup does not fit 390 px); a tap on the map's pin rings it */
  function select(o) {
    selO = o;
    var el = document.getElementById('lm-sel'); if (!el) return;
    el.innerHTML = popupHtml(o.f, o.p, o.ringed) + '<button type="button" class="lm-x">Close</button>';
    el.hidden = false;
    el.querySelector('.lm-x').addEventListener('click', function () { selO = null; el.hidden = true; drawMarks(); });
    drawMarks();
    try { el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }); } catch (e) {}
  }
  function drawMarks() { if (markLayer && map) { /* the ring around the chosen pin only: the triangles belong to draw() */ if (selLayer) selLayer.clearLayers(); if (selO && selLayer) { var a = atOf(selO), r = selO.p[KIND] === 'a' ? sqSize(selO.p, map.getZoom()) : radius(selO.p, map.getZoom(), false); L.circleMarker(a, { radius: r + 7, color: '#ffffff', weight: 5, fill: false, interactive: false }).addTo(selLayer); L.circleMarker(a, { radius: r + 7, color: '#111', weight: 2.5, fill: false, interactive: false }).addTo(selLayer); } } }

  function offCount() {
    if (!map) return 0;
    var b = map.getBounds(), n = 0;
    shown.forEach(function (o) { if (o.p[KIND] === 'a' && !o.p[NM]) { var a = spot(o.p); if (!(a[0] <= b.getNorth() && a[0] >= b.getSouth() && a[1] >= b.getWest() && a[1] <= b.getEast())) n++; } });
    return n;
  }
  function paintCounts() {
    var ncEl = document.getElementById('lm-nc');
    if (ncEl) ncEl.textContent = counts(shown, q.nm ? 0 : filterPts(files, { st: q.st, mo: q.mo, amin: q.amin, amax: q.amax, odd: q.odd, nm: true }).length - shown.length, offCount(), q.st);
  }

  function draw(fit) {
    shown = filterPts(files, q);
    var sts = q.st ? [q.st] : files.map(function (f) { return f.st; });
    var st = story(files, sts, q.mo, q.amin, q.amax);
    headEl.textContent = st.head; takeEl.textContent = st.take;
    var ao = auctionOnly(q.st ? files.filter(function (f) { return f.st === q.st; }) : files);
    if (ktEl) ktEl.textContent = ao ? KT_AUC : KT_DEF;
    if (knotEl) knotEl.lastChild.textContent = ao ? KNOT_AUC : KNOT_DEF;
    if (!map) { paintCounts(); return; }
    if (fit) {
      var use = shown;
      if (fit !== 'url' && !q.st && hereSt && root.innerWidth < 700) { var mine = shown.filter(function (o) { return o.f.st === hereSt; }); if (mine.length) use = mine; }
      /* auction squares sit at county centers across many states: they never stretch the opening view of the sales */
      var core = use.filter(function (o) { return o.p[KIND] !== 'a'; }); if (core.length) use = core;
      var b = use.length ? L.latLngBounds(use.map(function (o) { return [o.p[LAT], o.p[LNG]]; })) : null;
      if (q.at && fit === 'url') map.setView([q.at[0], q.at[1]], q.at[2], { animate: false });
      else if (b && b.isValid()) map.fitBounds(b, { paddingTopLeft: [64, 8], paddingBottomRight: [8, 60], animate: false, maxZoom: 11 });
    }
    var z = map.getZoom(), bd = band(z), tiny = z < 6 && box.clientWidth < 500;
    ringAuctions(shown, z);
    pinLayer.clearLayers(); markLayer.clearLayers(); marks = [];
    var small = z < PINZ, order = shown.slice().sort(function (a, b) { return (a.p[A] & 3 ? 1 : 0) - (b.p[A] & 3 ? 1 : 0); });
    order.forEach(function (o) {
      var p = o.p, at = o.at || spot(p), odd = !!(p[A] & 3), r = radius(p, z, tiny), m;
      var gold = odd ? { color: GOLD, weight: bd === 0 ? 1 : bd === 1 ? 2 : 2.5 } : null, fo = tiny ? 0.6 : bd === 0 && !odd ? 0.7 : 0.92;
      if (p[KIND] === 'a') {
        /* an auction result: a SQUARE, same size rule, same color classes, gold edge when unusual */
        var sz = tiny ? 5 : sqSize(p, z);
        m = L.marker(at, { icon: L.divIcon({ className: 'lm-mk', iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2],
          html: '<span class="lm-sqm ' + (p[C] === null ? 'lm-wh' : 'lm-c' + p[C]) + (odd ? ' lm-od' : '') + '" style="width:' + sz + 'px;height:' + sz + 'px"></span>' }), keyboard: false });
      } else if (p[NM]) m = L.circleMarker(at, { radius: r, color: '#7d7d79', weight: small ? 1 : 1.5, dashArray: small ? null : '3 2', fill: true, fillColor: '#ffffff', fillOpacity: 0.15 });
      else if (p[C] === null) m = L.circleMarker(at, { radius: r, color: gold ? gold.color : '#444', weight: gold ? gold.weight : tiny ? 0 : (small ? 0.6 : 1.2), fillColor: '#ffffff', fillOpacity: tiny ? 0.6 : 0.9 });
      else m = L.circleMarker(at, { radius: r, color: gold ? gold.color : '#ffffff', weight: gold ? gold.weight : tiny ? 0 : (small ? 0.6 : 1.2), fillColor: COL[String(p[C])], fillOpacity: fo });
      if (bd === 0) m.on('click', function () { map.setView(spot(p), PINZ, { animate: !reduce }); });
      else {
        if (narrow()) m.on('click', function () { select(o); });
        else m.bindPopup(function () { return popupHtml(o.f, p, o.ringed); }, { minWidth: Math.min(300, box.clientWidth - 50), maxWidth: Math.min(320, box.clientWidth - 50), maxHeight: box.clientHeight - 110, autoPan: true, autoPanPaddingTopLeft: [60, 8], autoPanPaddingBottomRight: [8, 56], keepInView: true });
      }
      m.addTo(pinLayer); o.m = m; marks.push(o);
      /* a cue besides color: from zoom 9 a triangle up (over the range) or down (under) on the pin */
      if (odd && z >= PINZ) L.marker(at, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'lm-mk', iconSize: [14, 14], iconAnchor: [7, 8],
        html: '<span>' + (p[A] & 1 ? '\u25b2' : '\u25bc') + '</span>' }) }).addTo(markLayer);
    });
    if (selO) { var keep = shown.filter(function (x) { return x.p === selO.p; })[0]; selO = keep || null; if (!keep) { var se = document.getElementById('lm-sel'); if (se) se.hidden = true; } }
    drawMarks();
    paintCounts();
    drawList();
  }

  function drawList() {
    var odd = shown.filter(function (o) { return !o.p[NM] && (o.p[A] & 3); });
    odd.sort(function (a, b) { return Math.abs(offPct(b.f, b.p) || 0) - Math.abs(offPct(a.f, a.p) || 0); });
    var cap = 60, keep = odd.slice(0, cap);
    var nA = odd.filter(function (o) { return o.p[KIND] === 'a'; }).length, nS = odd.length - nA;
    if (sumEl) sumEl.textContent = 'Unusual sales with these filters: ' + n0(nS) + (nA ? ', plus ' + n0(nA) + (nA === 1 ? ' auction result' : ' auction results') : '');
    var allA = keep.length && keep.every(function (o) { return o.f.basis === 'auction'; }), mw = allA ? "county's auction middle" : 'county median';
    ln.textContent = odd.length ? (odd.length > cap ? 'The ' + cap + ' furthest from their ' + mw + ', out of ' + n0(odd.length) + '. Tap one to see it on the map.' : n0(odd.length) + ' with these filters. Tap one to see it on the map.') : 'None with these filters.';
    list.innerHTML = keep.map(function (o, i) {
      var p = o.p, co = o.f.counties[p[CO]], pct = offPct(o.f, p);
      return '<li><button type="button" data-i="' + i + '">' + (p[KIND] === 'a' ? '<em>Auction result</em> ' : '') + '<b>' + usd(p[PPA]) + ' an acre</b>, ' + offWords(pct) + (o.f.basis === 'auction' ? " the county's auction middle. " : ' the county median. ') +
        '<span>' + acres(p[AC]) + ', ' + esc(co[CNAME]) + ' County, ' + o.f.st + ', ' + day(p[WHEN]) + '</span></button></li>';
    }).join('');
    [].slice.call(list.querySelectorAll('button')).forEach(function (b) {
      b.addEventListener('click', function () {
        var o = keep[+b.getAttribute('data-i')];
        if (!map) return;
        var go = function () { if (!o.m) draw(false); var t = marks.filter(function (x) { return x.p === o.p; })[0]; if (t) { if (narrow()) select(t); else t.m.openPopup(); } };
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
  var STATE_SHAPES = null;
  function loadShapes(cb) {
    if (STATE_SHAPES) { cb(STATE_SHAPES); return; }
    getJSON('/data/us-states.geo.json').then(function (g) { STATE_SHAPES = g && g.features ? g.features : []; cb(STATE_SHAPES); });
  }
  function rings(f) { var g = f.geometry || {}; return g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map(function (c) { return c[0]; }) : []; }
  /* ray cast: is the point (lng x, lat y) inside the ring [[lng, lat], ...] */
  function pointInRing(x, y, r) {
    var ins = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  }
  function ringArea(r) { var a = 0; for (var i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2); }
  /* the stretch of the ring, clipped to [x0, x1], that holds the longest run of the horizontal line at lat y: [from, to] or null */
  function runAt(r, y, x0, x1, near) {
    var xs = [];
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var yi = r[i][1], yj = r[j][1];
      if ((yi > y) !== (yj > y)) xs.push(r[i][0] + (y - yi) * (r[j][0] - r[i][0]) / (yj - yi));
    }
    xs.sort(function (a, b) { return a - b; });
    var best = null, bl = 0, hit = null;
    for (var k = 0; k + 1 < xs.length; k += 2) {
      var a = Math.max(xs[k], x0), b = Math.min(xs[k + 1], x1);
      if (b - a > bl) { bl = b - a; best = [a, b]; }
      if (near != null && a <= near && near <= b) hit = [a, b];
    }
    return hit || (near == null ? best : null);
  }
  /* where a state's name may go on the picture: the places inside the state's own largest ring, in the order center, north edge,
     south edge (the mean of the ring's vertices inside the window first, kept only if the ray cast puts it inside that ring).
     win = {cx, cy, halfX, halfY} (degrees, the plate's window). Returns {ring, spots: [{lng, lat, run: [lng0, lng1]}]} or null. */
  function stateSpots(f, win) {
    if ((f.properties || {}).iso_a2 === 'CA') return null;
    var rs = rings(f), ring = null, ba = -1;
    rs.forEach(function (r) { var a = ringArea(r); if (a > ba) { ba = a; ring = r; } });
    if (!ring) return null;
    var mn = 1e9, mx = -1e9, nn = 1e9, nx = -1e9;
    ring.forEach(function (c) { mn = Math.min(mn, c[0]); mx = Math.max(mx, c[0]); nn = Math.min(nn, c[1]); nx = Math.max(nx, c[1]); });
    var x0 = Math.max(mn, win.cx - win.halfX), x1 = Math.min(mx, win.cx + win.halfX), y0 = Math.max(nn, win.cy - win.halfY), y1 = Math.min(nx, win.cy + win.halfY);
    if (x1 <= x0 || y1 <= y0) return null;
    var inside = ring.filter(function (c) { return c[0] >= x0 && c[0] <= x1 && c[1] >= y0 && c[1] <= y1; }), spots = [];
    if (inside.length) {
      var mlng = inside.reduce(function (s, c) { return s + c[0]; }, 0) / inside.length, mlat = inside.reduce(function (s, c) { return s + c[1]; }, 0) / inside.length;
      if (pointInRing(mlng, mlat, ring)) { var run = runAt(ring, mlat, x0, x1, mlng); if (run) spots.push({ lng: mlng, lat: mlat, run: run }); }
    }
    [0.5, 0.16, 0.84, 0.32, 0.68].forEach(function (fr) {
      var lat = y1 - fr * (y1 - y0), run = runAt(ring, lat, x0, x1, null);
      if (run && run[1] > run[0]) spots.push({ lng: (run[0] + run[1]) / 2, lat: lat, run: run });
    });
    return spots.length ? { ring: ring, spots: spots } : null;
  }
  /* the words over the picture: the view's pins say what they are, the story only when the view holds every sale of the filters */
  function viewHead(pins, amin, amax) {
    var sts = [], seen = {}; pins.forEach(function (o) { if (!seen[o.f.st]) { seen[o.f.st] = 1; sts.push(o.f.name); } });
    sts.sort();
    var nA = pins.filter(function (o) { return o.p[KIND] === 'a'; }).length, nS = pins.length - nA, parts = [];
    if (!pins.length) return 'No pins in this view.';
    if (nS) parts.push(n0(nS) + (nS === 1 ? ' farm sale' : ' farm sales'));
    if (nA) parts.push(n0(nA) + (nA === 1 ? ' auction result' : ' auction results'));
    var where = sts.length <= 3 ? sts.join(sts.length === 2 ? ' and ' : ', ').replace(/, ([^,]*)$/, ', and $1') : (NUMW[sts.length] || sts.length) + ' states';
    return parts.join(' and ') + ' of ' + acreWords(amin || MIN_ACRES, amax || 0) + ' in this view of ' + where + '.';
  }
  function auctionOnly(scope) { return !!scope.length && scope.every(function (f) { return f.basis === 'auction'; }); }
  function stateNames(scope) { var n = scope.map(function (f) { return f.name; }).sort(); return n.length < 2 ? n.join('') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]; }
  /* the picture's top-right line: the window of the filters, never only the day the records run to (a reader cannot tell 12 months from 24 otherwise) */
  function windowLine(mo, thr) { return 'Farm sales map, ' + mo + ' months' + (thr ? ' to ' + thr : ''); }
  function footNote(scope, thr) {
    return (thr ? 'Records through ' + thr + '. ' : '') + (auctionOnly(scope) ? 'Auction company results of 20+ acres. No state transfer returns for ' + stateNames(scope) + ' on this site yet.'
      : 'Sales of 20+ acres: state transfer records and auction company results.');
  }

  /* the picture's layout with no canvas (the tests read it): the plate, where every pin sits (auctions of one county in a ring laid out
     in PLATE pixels, never in map pixels), the county names beside the pins that clear them, the state names after the pins.
     inb: [{f, p, lat, lng}] the pins in view (lat, lng = where the pin sits before any ring); shapes: state features;
     plate: {left, right, top, bot, n, s, w, e}; measure(text, size, weight) -> width. */
  function pictureModel(shapes, inb, plate, measure) {
    var left = plate.left, right = plate.right, top = plate.top, bot = plate.bot, MINSPAN = 0.6;
    var la = inb.map(function (o) { return o.lat; }), lo = inb.map(function (o) { return o.lng; });
    var pn = la.length ? Math.max.apply(null, la) : plate.n, ps = la.length ? Math.min.apply(null, la) : plate.s, pw = lo.length ? Math.min.apply(null, lo) : plate.w, pe = lo.length ? Math.max.apply(null, lo) : plate.e;
    var cy = (pn + ps) / 2, cx = (pw + pe) / 2, kx = Math.cos(cy * Math.PI / 180);
    var spanY = Math.max(pn - ps, MINSPAN) * 1.18, spanX = Math.max((pe - pw) * kx, MINSPAN * kx) * 1.18;
    var sc = Math.min((right - left) / spanX, (bot - top) / spanY);
    var ox = left + (right - left) / 2, oy = top + (bot - top) / 2;
    var px = function (lat, lng) { return [ox + (lng - cx) * kx * sc, oy - (lat - cy) * sc]; };
    var nPins = inb.filter(function (o) { return !o.p[NM]; }).length;
    var dot = Math.max(2.2, Math.min(nPins < 30 ? 7 : 6, 700 / Math.sqrt(inb.length + 1) / 8));
    var halfX = (right - left) / 2 / (kx * sc) + 0.1, halfY = (bot - top) / 2 / sc + 0.1, win = { cx: cx, cy: cy, halfX: halfX, halfY: halfY };
    // pins: auctions that share a spot (the county center) go on a ring, in plate pixels, newest first
    var groups = {}, pins = inb.map(function (o) {
      var a = px(o.lat, o.lng), rr = dot * (0.8 + 0.4 * Math.sqrt(o.p[AC] / 80)), r = { o: o, x: a[0], y: a[1], rr: rr };
      if (o.p[KIND] === 'a' && !o.p[NM]) { var k = o.p[LAT] + ',' + o.p[LNG]; (groups[k] = groups[k] || []).push(r); }
      r.rect = [r.x - rr - 2, r.y - rr - 2, r.x + rr + 2, r.y + rr + 2];
      return r;
    });
    /* biggest rings first; each ring starts at the first of eight turns (the same order every time) where it clears the pins already laid and stays on the plate */
    var inGroup = function (r) { var g = groups[r.o.p[LAT] + ',' + r.o.p[LNG]]; return r.o.p[KIND] === 'a' && !r.o.p[NM] && g && g.length > 1; };
    var laid = pins.filter(function (r) { return !inGroup(r); });
    var rectOf = function (r, x, y) { return [x - r.rr - 2, y - r.rr - 2, x + r.rr + 2, y + r.rr + 2]; };
    Object.keys(groups).map(function (k) { return groups[k]; }).filter(function (g) { return g.length > 1; }).sort(function (a, b) { return b.length - a.length; }).forEach(function (g) {
      var sz = 0; g.forEach(function (r) { sz = Math.max(sz, 2 * r.rr); });
      var best = null, bs = 1e9;
      for (var t = 0; t < 8 && bs > 0; t++) {
        var off = ringOffsets(g.length, sz, t * Math.PI / 4), bad = 0;
        g.forEach(function (r, i) {
          var rc = rectOf(r, r.x + off[i][0], r.y + off[i][1]);
          if (rc[0] < left || rc[2] > right || rc[1] < top || rc[3] > bot) bad += 3;
          laid.forEach(function (o) { if (rc[0] < o.rect[2] && rc[2] > o.rect[0] && rc[1] < o.rect[3] && rc[3] > o.rect[1]) bad++; });
        });
        if (bad < bs) { bs = bad; best = off; }
      }
      g.forEach(function (r, i) { r.cx = r.x; r.cy = r.y; r.x += best[i][0]; r.y += best[i][1]; r.ringed = true; r.rect = rectOf(r, r.x, r.y); laid.push(r); });
    });
    var taken = [];
    pins.forEach(function (r) { r.rect = [r.x - r.rr - 2, r.y - r.rr - 2, r.x + r.rr + 2, r.y + r.rr + 2]; taken.push(r.rect); });
    var hits = function (rc, list) { for (var i = 0; i < list.length; i++) { var o = list[i]; if (rc[0] < o[2] && rc[2] > o[0] && rc[1] < o[3] && rc[3] > o[1]) return true; } return false; };
    var inside = function (rc) { return rc[0] >= left && rc[2] <= right && rc[1] >= top && rc[3] <= bot; };
    // county names: colored and gold-edged counties first, then by pin count; right, left, above, below of the county's own pins, 15 px then 13 px
    var cos = {}, real = pins.filter(function (r) { return !r.o.p[NM]; });
    real.forEach(function (r) {
      var k = r.o.f.st + r.o.p[CO], c = cos[k] || (cos[k] = { o: r.o, n: 0, gold: false, col: false, b: [1e9, 1e9, -1e9, -1e9] });
      c.n++; if (r.o.p[A] & 3) c.gold = true; if (r.o.p[C] !== null) c.col = true;
      c.b = [Math.min(c.b[0], r.rect[0]), Math.min(c.b[1], r.rect[1]), Math.max(c.b[2], r.rect[2]), Math.max(c.b[3], r.rect[3])];
    });
    var order = Object.keys(cos).map(function (k) { return cos[k]; }).sort(function (a, b) { return ((a.gold || a.col) ? 0 : 1) - ((b.gold || b.col) ? 0 : 1) || (a.gold ? 0 : 1) - (b.gold ? 0 : 1) || b.n - a.n; });
    var COUNTY_CAP = 12, names = [];
    order.slice(0, COUNTY_CAP).forEach(function (c) {
      var t = c.o.f.counties[c.o.p[CO]][CNAME] + ' County', done = false;
      [15, 13].forEach(function (size) {
        if (done) return;
        var w = measure(t, size, '600'), b = c.b, my = (b[1] + b[3]) / 2;
        [[b[2] + 4, my + size * 0.35], [b[0] - 4 - w, my + size * 0.35], [(b[0] + b[2]) / 2 - w / 2, b[1] - 4], [(b[0] + b[2]) / 2 - w / 2, b[3] + 4 + size]].forEach(function (pos) {
          if (done) return;
          var rc = [pos[0] - 2, pos[1] - size, pos[0] + w + 2, pos[1] + 4];
          if (!inside(rc) || hits(rc, taken)) return;
          taken.push(rc); names.push({ text: t, x: pos[0], y: pos[1], size: size, rect: rc, st: c.o.f.st, co: c.o.p[CO] }); done = true;
        });
      });
    });
    var moreCounties = order.length - names.length;
    // state names after the pins and the county names: a dark plate under a state that has pins, the state's own ground, never Canada
    var withPins = {}; real.forEach(function (r) { withPins[r.o.f.st] = true; });
    var states = [], placed = [];
    var tryState = function (f, hasPins) {
      var ss = stateSpots(f, win); if (!ss) return;
      var nm = (f.properties || {}).name || '', pc = (f.properties || {}).postal || '';
      var made = null;
      [0, 1].forEach(function (pass) {
        if (made || (pass === 1 && !hasPins)) return;
        ss.spots.forEach(function (sp) {
          if (made) return;
          var a = px(sp.lat, sp.lng), runPx = (sp.run[1] - sp.run[0]) * kx * sc;
          [[nm.toUpperCase(), 15], [pc, 14]].forEach(function (v) {
            if (made || !v[0]) return;
            var w = measure(v[0], v[1], '700'); if (v[0] === nm.toUpperCase() && w + 16 > runPx) return;
            var pad = hasPins ? 4 : 2, rc = [a[0] - w / 2 - pad, a[1] - v[1] - pad + 4, a[0] + w / 2 + pad, a[1] + 4 + pad];
            if (!inside(rc) || hits(rc, placed)) return;
            if (hits(rc, names.map(function (n) { return n.rect; }))) return;
            if (pass === 0 && hits(rc, pins.map(function (r) { return r.rect; }))) return;
            made = { name: nm, code: pc, text: v[0], size: v[1], x: a[0] - w / 2, y: a[1], w: w, rect: rc, plate: hasPins, lng: sp.lng, lat: sp.lat, ring: ss.ring, st: pc, hasPins: hasPins };
          });
        });
      });
      if (made) { placed.push(made.rect); states.push(made); }
    };
    var feats = (shapes || []).filter(function (f) { return (f.properties || {}).iso_a2 !== 'CA'; });
    feats.filter(function (f) { return withPins[(f.properties || {}).postal]; }).forEach(function (f) { tryState(f, true); });
    feats.filter(function (f) { return !withPins[(f.properties || {}).postal]; }).forEach(function (f) { tryState(f, false); });
    return { px: px, sc: sc, kx: kx, cx: cx, cy: cy, win: win, dot: dot, pins: pins, counties: names, moreCounties: moreCounties, states: states, plate: plate };
  }
  function card(done) {
    if (!map) { done(null); return; }
    loadShapes(function (shapes) { cardDraw(done, shapes); });
  }
  function cardDraw(done, shapes) {
    var W = 1200, H = 630, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var x = cv.getContext('2d'); if (!x) { done(null); return; }
    var F = 'px Inter, system-ui, sans-serif', scope = q.st ? files.filter(function (f) { return f.st === q.st; }) : files, aonly = auctionOnly(scope);
    var st = story(files, q.st ? [q.st] : files.map(function (f) { return f.st; }), q.mo, q.amin, q.amax);
    var b = map.getBounds(), n = b.getNorth(), s = b.getSouth(), w = b.getWest(), e = b.getEast();
    var base = function (o) { return o.p[KIND] === 'a' ? [o.p[LAT], o.p[LNG]] : spot(o.p); };
    var inb = shown.filter(function (o) { var a = base(o); return a[0] <= n && a[0] >= s && a[1] >= w && a[1] <= e; });
    var pins = inb.filter(function (o) { return !o.p[NM]; }), total = shown.filter(function (o) { return !o.p[NM]; }).length;
    var core = shown.filter(function (o) { return !o.p[NM] && o.p[KIND] !== 'a'; }), coreIn = pins.filter(function (o) { return o.p[KIND] !== 'a'; });
    var full = core.length ? coreIn.length === core.length : pins.length === total;
    x.fillStyle = '#0a0c0d'; x.fillRect(0, 0, W, H); x.fillStyle = GOLD; x.fillRect(0, 0, W, 10);
    x.font = '800 34' + F; x.fillStyle = '#e9edeb'; x.fillText('agsist', 48, 62);
    var aw = x.measureText('agsist').width; x.font = '700 20' + F; x.fillStyle = GOLD; x.fillText('.com', 50 + aw, 62);
    var thr = throughNote(scope);
    x.font = '600 20' + F; x.fillStyle = 'rgba(233,237,235,.72)'; x.textAlign = 'right'; x.fillText(windowLine(q.mo, thr), W - 48, 60); x.textAlign = 'left';
    var headTxt = full ? st.head.replace(/ in the \d+ months to [^.]*\.$/, '.') : viewHead(pins, q.amin, q.amax);
    var hd = fit(x, headTxt, W - 96, [38, 34, 30], '800'), y = 80 + hd.size;
    x.font = '800 ' + hd.size + F; x.fillStyle = '#e9edeb'; hd.lines.forEach(function (l) { x.fillText(l, 48, y); y += hd.size * 1.2; });
    /* the plate: the bounds of the pins in the view (not the phone's portrait box), state outlines and place names behind them */
    var top = y + 6, bot = H - 70, left = 48, right = W - 330;
    var model = pictureModel(shapes, inb.map(function (o) { var a = base(o); return { f: o.f, p: o.p, lat: a[0], lng: a[1], src: o }; }),
      { left: left, right: right, top: top, bot: bot, n: n, s: s, w: w, e: e }, function (t, size, wt) { x.font = wt + ' ' + size + F; return x.measureText(t).width; });
    var px = model.px, cx = model.cx, cy = model.cy, halfX = model.win.halfX, halfY = model.win.halfY, dot = model.dot;
    x.lineJoin = 'round';
    x.fillStyle = '#141a18'; x.fillRect(left - 8, top - 8, right - left + 16, bot - top + 16);
    x.save(); x.beginPath(); x.rect(left - 8, top - 8, right - left + 16, bot - top + 16); x.clip();
    (shapes || []).forEach(function (f) {
      var rs = rings(f); if (!rs.length) return;
      var any = false;
      x.beginPath();
      rs.forEach(function (r) {
        var inside = r.some(function (c) { return Math.abs(c[0] - cx) < halfX && Math.abs(c[1] - cy) < halfY; });
        var minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9; r.forEach(function (c) { minx = Math.min(minx, c[0]); maxx = Math.max(maxx, c[0]); miny = Math.min(miny, c[1]); maxy = Math.max(maxy, c[1]); });
        if (!inside && !(minx < cx - halfX && maxx > cx + halfX && miny < cy - halfY && maxy > cy + halfY)) return;
        any = true;
        r.forEach(function (c, i) { var a = px(c[1], c[0]); if (i) x.lineTo(a[0], a[1]); else x.moveTo(a[0], a[1]); }); x.closePath();
      });
      if (any) { x.fillStyle = '#1b2220'; x.fill(); x.strokeStyle = 'rgba(233,237,235,.38)'; x.lineWidth = 1.2; x.stroke(); }
    });
    var NOTC = '#8a8f8c';
    var drawOrder = model.pins.slice().sort(function (a, c) { return (a.o.p[A] & 3 ? 1 : 0) - (c.o.p[A] & 3 ? 1 : 0); });
    drawOrder.forEach(function (r) {
      var p = r.o.p, rr = r.rr, odd = !!(p[A] & 3);
      if (p[KIND] === 'a') {
        x.fillStyle = p[C] === null ? '#ffffff' : COL[String(p[C])]; x.fillRect(r.x - rr, r.y - rr, rr * 2, rr * 2);
        x.strokeStyle = odd ? GOLD : p[C] === null ? NOTC : 'rgba(255,255,255,.85)'; x.lineWidth = odd ? 2.5 : 1.5; x.strokeRect(r.x - rr, r.y - rr, rr * 2, rr * 2);
        return;
      }
      x.beginPath(); x.arc(r.x, r.y, rr, 0, 6.283);
      if (p[NM]) { x.strokeStyle = 'rgba(160,160,155,.7)'; x.lineWidth = 1; x.stroke(); return; }
      x.fillStyle = p[C] === null ? '#ffffff' : COL[String(p[C])]; x.fill();
      x.strokeStyle = odd ? GOLD : p[C] === null ? NOTC : 'rgba(255,255,255,.6)'; x.lineWidth = odd ? 2.5 : p[C] === null ? 1.5 : 0.8; x.stroke();
    });
    /* county names beside their own pins, then the state names on top of everything */
    var outlined = function (t, ax, ay, size, col, wt) { x.font = wt + ' ' + size + F; x.lineWidth = 3; x.strokeStyle = 'rgba(10,12,13,.85)'; x.strokeText(t, ax, ay); x.fillStyle = col; x.fillText(t, ax, ay); };
    model.counties.forEach(function (c) { outlined(c.text, c.x, c.y, c.size, '#e9edeb', '600'); });
    model.states.forEach(function (sx) {
      if (sx.plate) { x.fillStyle = 'rgba(10,12,13,.82)'; x.fillRect(sx.rect[0], sx.rect[1], sx.rect[2] - sx.rect[0], sx.rect[3] - sx.rect[1]); x.font = '700 ' + sx.size + F; x.fillStyle = '#e9edeb'; x.fillText(sx.text, sx.x, sx.y); }
      else outlined(sx.text, sx.x, sx.y, sx.size, 'rgba(233,237,235,.5)', '700');
    });
    x.restore();
    // the key: the same words and order as the page (under the range to over it), outline-only shape rows, white for not compared
    var ky = top + 2, kx0 = right + 36;
    x.font = '700 17' + F; x.fillStyle = '#e9edeb'; x.fillText('Price per acre against', kx0, ky + 12); x.fillText(aonly ? "the county's auction middle" : "the county's own middle", kx0, ky + 34); ky += 56;
    var row = function (t) { x.font = '400 16' + F; x.fillStyle = 'rgba(233,237,235,.88)'; x.fillText(t, kx0 + 28, ky); };
    [['-2', 'Under the usual range'], ['-1', 'Lower quarter'], ['0', 'Middle half'], ['1', 'Upper quarter'], ['2', 'Over the usual range']].forEach(function (k) {
      x.beginPath(); x.arc(kx0 + 9, ky - 5, 7, 0, 6.283); x.fillStyle = COL[k[0]]; x.fill(); row(k[1]); ky += 26;
    });
    x.beginPath(); x.arc(kx0 + 9, ky - 5, 7, 0, 6.283); x.fillStyle = '#ffffff'; x.fill(); x.strokeStyle = NOTC; x.lineWidth = 1.5; x.stroke(); row('Not compared (white)'); ky += 26;
    x.beginPath(); x.arc(kx0 + 9, ky - 5, 7, 0, 6.283); x.strokeStyle = GOLD; x.lineWidth = 2.5; x.stroke(); row('Gold edge: unusual'); ky += 26;
    x.beginPath(); x.arc(kx0 + 9, ky - 5, 7, 0, 6.283); x.strokeStyle = '#e9edeb'; x.lineWidth = 1.5; x.stroke(); row('Round: recorded sale'); ky += 26;
    x.strokeStyle = '#e9edeb'; x.lineWidth = 1.5; x.strokeRect(kx0 + 2.5, ky - 12, 13, 13); row('Square: auction result'); ky += 30;
    x.font = '700 17' + F; x.fillStyle = '#e9edeb'; x.fillText(pins.length === total ? n0(total) + ' pins in this view' : n0(pins.length) + ' of ' + n0(total) + ' pins in this view', kx0, ky); ky += 22;
    x.font = '400 14' + F; x.fillStyle = 'rgba(233,237,235,.72)';
    if (model.moreCounties > 0) { x.fillText('+ ' + n0(model.moreCounties) + (model.moreCounties === 1 ? ' more county' : ' more counties'), kx0, ky); ky += 20; }
    x.fillText('Pins at county, town or section', kx0, ky); x.fillText('centers, never the parcel.', kx0, ky + 18);
    x.font = '400 16' + F; x.fillStyle = 'rgba(233,237,235,.72)';
    x.fillText(footNote(scope, thr), 48, H - 42);
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
      wait.parentNode.removeChild(wait);
      if (q.st && !files.some(function (f) { return f.st === q.st; })) q.st = '';
      hereSt = savedState();
      toForm();
      map = L.map(box, { renderer: L.canvas({ tolerance: 10 }), scrollWheelZoom: false, zoomSnap: 0.25, worldCopyJump: false, minZoom: 4, maxZoom: 16 });
      map.attributionControl.setPrefix(false);
      setBase(q.base);
      baseControl();
      pinLayer = L.layerGroup().addTo(map); markLayer = L.layerGroup().addTo(map); selLayer = L.layerGroup().addTo(map);
      map.setView([41, -88], 5, { animate: false });
      draw(q.at ? 'url' : true);
      var lastZ = map.getZoom();
      map.on('zoomend', function () { var z = map.getZoom(); if (band(z) !== band(lastZ) || Math.abs(z - lastZ) >= 1 || (z >= STACKZ && shown.some(function (o) { return o.ringed; }))) draw(false); lastZ = z; });
      map.on('moveend', paintCounts);
      setupTools();
    });
  }

  readUrl(); toForm();
  form.addEventListener('change', function (ev) { fromForm(); q.at = null; draw(ev.target && (ev.target.name === 'lst' || ev.target.name === 'lmo') ? true : false); });
  form.addEventListener('submit', function (ev) { ev.preventDefault(); });
  near(box, start);
})(typeof window !== 'undefined' ? window : globalThis);
