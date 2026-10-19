/* /here: one box, one page about a place (Oct 18, 2026).
   Type a ZIP, a town, a county, or coordinates, or tap a map; get the county's
   numbers on one page. The numbers come from components/place.js; this file
   finds the county, fetches only what the page shows, and draws it.

   What loads for one place: data/atlas/pct/<ST>.json (the state's ranked
   figures), data/atlas/counties/<fips>.json (the county's own record),
   data/layers.json (source names), then the This week files. The county map
   (data/atlas/counties.geo.json) loads only for a map pick or a coordinate.

   URL: ?q= &fips= &zip= &at=lat,lng &print=<parts>. Every reader sees every
   section in one order (Sig, Oct 19: the role chips are gone; an old link with
   &for= opens normally and the param is dropped). &print= holds the Print
   report choices so a shared link prints the same; it is never required.
   The recorded sales index (data/land/<st>/index.json) is read only to decide
   whether the Go deeper row offers the comparable sales report.

   THE FIRST SCREEN (Oct 19): the county station's year of rain, drawn by the
   county rain page's own Rain Print (components/rain-county-print.js mount(),
   the same station, days and checks as /rain/<state>/<county>); the plain
   running total shows at once from data/rain/<st>.json and stays if the print
   cannot draw. Over it, one ranked line: this year from Jan 1 to the last
   reported day against the same days of every earlier year the station kept
   in full (place.js rankSoFar), from the station's period of record at
   RCC-ACIS, the call /rain-print makes; it shows a placeholder while NOAA
   answers and says so when it does not. Under it, "What's unusual here": at
   most five figures from the county's own Atlas record that sit outside 90% of
   their own past (place.js unusualHere); nothing shows when none does. Every
   line opens its math on tap. In This week, the nearest elevators' basis
   against their neighbors (place.js basisNeighbors), from the bids network's
   live index, and against their own history joined on the permanent id
   (data/ids/basis-join/<ST>.json, data/basis/<ST>.json). */
(function () {
  'use strict';
  var P = window.AgPlace, L = window.AGLayers;
  if (!P) return;
  var GEO_API = 'https://geocoding-api.open-meteo.com/v1/search';
  var LS_ZIP = 'agsist_user_zip';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var S = { seq: 0, where: null, prof: null, county: null, pct: null, week: {}, sales: {}, print: { parts: P.PRINT_PARTS.slice(), more: false } };
  var memo = {};

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
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
  function getText(u) {
    return fetch(u).then(function (r) { return r.ok ? r.text() : null; }).catch(function () { return null; });
  }
  function mdy(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : '';
  }
  function money(v) { return v == null ? '' : '$' + Number(v).toFixed(2); }
  function cents(v) { if (v == null) return ''; var c = Math.round(v * 100); return (c < 0 ? '−' : '+') + Math.abs(c) + '¢'; }
  function say(msg, err) { var el = $('h-status'); if (!el) return; el.textContent = msg || ''; el.className = 'h-status' + (err ? ' err' : ''); }
  function sayHtml(html, err) { var el = $('h-status'); if (!el) return; el.innerHTML = html || ''; el.className = 'h-status' + (err ? ' err' : ''); }

  /* ── finding the county ───────────────────────────────────────── */
  function geocode(name) {
    return fetch(GEO_API + '?name=' + encodeURIComponent(name) + '&count=10&language=en&format=json&countryCode=US')
      .then(function (r) { if (!r.ok) throw new Error('geo ' + r.status); return r.json(); })
      .then(function (d) { return (d && d.results) || []; });
  }
  function stFile(st) { return getJSON('/data/atlas/pct/' + st + '.json'); }
  function geoFile() { return getJSON('/data/atlas/counties.geo.json', 30000); }
  function pointToCounty(lat, lng) {
    return geoFile().then(function (g) { return g ? P.countyAt(g, lat, lng) : null; });
  }
  /* A geocoder row to a county: the county name it gives, matched in the state's file; else the point. */
  function rowToCounty(r) {
    var st = P.stateFromName(r.admin1);
    var at = { lat: r.latitude, lng: r.longitude };
    if (!st) return Promise.resolve(null);
    return stFile(st).then(function (pct) {
      var f = pct && r.admin2 ? P.countyInState(pct, r.admin2) : null;
      return f || pointToCounty(at.lat, at.lng);
    });
  }

  function go(text, how) {
    var c = P.classify(text);
    var my = ++S.seq;
    $('h-choices').innerHTML = '';
    if (c.kind === 'empty') { say('Type a ZIP, a town and state, a county, or coordinates.', true); return Promise.resolve(false); }
    track('here_find', { by: how || c.kind });
    if (c.kind === 'zip') return byZip(c.zip, my);
    if (c.kind === 'point') return byPoint(c.at, my, null);
    if (c.kind === 'county') return byCounty(c.name, c.st, my);
    return byTown(c.name, c.st, my, text);
  }
  function byZip(zip, my, extra) {
    say('Looking up ZIP ' + zip + '…');
    return geocode(zip).then(function (res) {
      if (my !== S.seq) return false;
      var r = res.filter(function (x) { return (x.postcodes || []).indexOf(zip) >= 0; })[0] || res[0];
      if (!r) throw new Error('no zip');
      return rowToCounty(r).then(function (f) {
        if (my !== S.seq) return false;
        if (!f) throw new Error('no county');
        return open(f, { zip: zip, lat: r.latitude, lng: r.longitude, label: r.name + ', ' + (P.stateFromName(r.admin1) || ''), how: 'zip' }, my, extra);
      });
    }).catch(function () {
      if (my !== S.seq) return false;
      /* The place lookup did not answer: the ZIP table the cash bid search uses, then the county map. */
      var net = window.AGSIST_BIDS_NET;
      var c = net && net.zipCoord ? net.zipCoord(zip) : Promise.resolve(null);
      return c.then(function (pt) {
        if (my !== S.seq) return false;
        if (!pt) { say('No ZIP ' + zip + ' in the place lookup. Try the town and state, or the county.', true); return false; }
        return pointToCounty(pt.lat, pt.lon).then(function (f) {
          if (my !== S.seq) return false;
          if (!f) { say('ZIP ' + zip + ' did not land in a county we have. Try the town and state.', true); return false; }
          return open(f, { zip: zip, lat: pt.lat, lng: pt.lon, label: 'ZIP ' + zip, how: 'zip' }, my, extra);
        });
      });
    });
  }
  function byPoint(at, my, label, extra) {
    say('Finding the county at ' + at.lat.toFixed(4) + ', ' + at.lng.toFixed(4) + '…');
    return pointToCounty(at.lat, at.lng).then(function (f) {
      if (my !== S.seq) return false;
      if (!f) { say('That point is not inside a US county we have. The county figures cover the 50 states.', true); return false; }
      return open(f, { lat: at.lat, lng: at.lng, point: true, label: label || (at.lat.toFixed(4) + ', ' + at.lng.toFixed(4)), how: 'point' }, my, extra);
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
      say('The place lookup did not answer. Type the county (“Barron County, WI”), coordinates, or pick on the map.', true);
      return false;
    });
  }
  function townOpen(r, my) {
    return rowToCounty(r).then(function (f) {
      if (my !== S.seq) return false;
      if (!f) { say('That town did not land in a county we have.', true); return false; }
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

  /* ── one county ───────────────────────────────────────────────── */
  function open(fips, where, my, extra) {
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
      S.where = where; S.prof = prof; S.county = county; S.pct = pct; S.week = {};
      if (where.zip) lsSet(LS_ZIP, where.zip);
      say('');
      render();
      writeUrl(extra);
      loadWeek(fips, my);
      return true;
    });
  }
  function writeUrl(extra) {
    var w = S.where || {}, p = S.prof, q = [];
    if (!p) return;
    q.push('fips=' + p.fips);
    if (w.zip) q.push('zip=' + w.zip);
    else if (w.lat != null && !w.center) q.push('at=' + (+w.lat).toFixed(4) + ',' + (+w.lng).toFixed(4));
    if (w.how === 'town' && w.label) q.push('q=' + encodeURIComponent(w.label));
    var pr = P.printParam(S.print);
    if (pr) q.push('print=' + pr);
    try { history.replaceState(null, '', location.pathname + '?' + q.join('&')); } catch (e) {}
    buildQr();
  }

  /* ── drawing ──────────────────────────────────────────────────── */
  /* Does AGSIST hold recorded sales for this state? One small index file per state, read once. */
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
    document.title = p.name + ', ' + p.st + ': the numbers in one place | AGSIST';
    var from = w.zip ? 'ZIP ' + w.zip + (w.label && w.label !== 'ZIP ' + w.zip ? ' (' + w.label + ')' : '') : w.how === 'town' ? w.label : w.point ? 'the point ' + w.label : null;
    $('h-where').innerHTML = (from ? 'From ' + esc(from) + ', in ' + esc(p.name) + '. ' : '') + 'County figures; ranks are among ' + esc(p.stName) + ' counties that carry the figure, never among fields.';
    $('h-sent').textContent = p.sentence;
    $('h-sent-src').innerHTML = 'Every number in that line is in the table below with its source and year. Farmland Atlas county files of ' + esc(mdy(p.atlasGenerated)) + '.';
    drawDeeper(false);
    var fips = p.fips;
    salesIn(p.st).then(function (has) { if (has && S.prof && S.prof.fips === fips) drawDeeper(true); });
    var nb = p.neighbors.filter(function (n) { return n.name; });
    $('h-nb').innerHTML = nb.length ? 'Next door: ' + nb.map(function (n) { return '<a href="?fips=' + n.fips + '" data-fips="' + n.fips + '">' + esc(n.name) + '</a>'; }).join(' · ') : '';
    drawFirst(p);
    drawFingerprint(p);
    drawCover(p);
    drawUnusual(p);
    drawLong(S.county);
    drawWeek();
    applyPrint();
    $('h-place').hidden = false;
    if ($('h-map-box').open) drawMap();
  }

  function drawFingerprint(p) {
    var cols = p.cols, have = cols.filter(function (c) { return c.pos != null; }).length;
    $('h-fp-h').textContent = 'How ' + p.name + ' ranks in ' + p.stName;
    var strip = cols.map(function (c) {
      var h = c.pos == null ? 0 : Math.max(3, Math.round(c.pos * 100));
      var cls = 'fp-c' + (c.band ? ' fp-' + c.band : '') + (c.pos == null ? ' fp-na' : '');
      var tip = c.label + ': ' + (c.value == null ? 'not available' : P.fmt(c.value, c) + (c.words ? ', ' + c.words : ''));
      return '<button type="button" class="' + cls + '" data-i="' + c.i + '" aria-label="' + esc(tip) + '"><span class="fp-bar"><span class="fp-fill" style="height:' + h + '%"></span></span><span class="fp-l">' + esc(c.short) + '</span></button>';
    }).join('');
    $('h-fp').innerHTML = strip;
    $('h-fp').setAttribute('aria-label', 'Where ' + p.name + ' sits among ' + p.stName + ' counties on ' + have + ' figures. Each column runs from the lowest county at the bottom to the highest at the top. The same numbers are in the table below.');
    $('h-fp-d').textContent = 'Tap a column for its number. Gold: top or bottom tenth of ' + p.stName + ' counties. Gray outline: not available here.';
    $('h-fp').onclick = function (e) {
      var b = e.target.closest('button[data-i]'); if (!b) return;
      var c = p.cols[+b.getAttribute('data-i')];
      $('h-fp-d').textContent = c.label + ': ' + (c.value == null ? 'not available. ' + (c.reason || '') : P.fmt(c.value, c) + (c.words ? ', ' + c.words : '') + '. ' + (c.source || '') + ', ' + c.years + '.');
    };
    $('h-fp-t').innerHTML = '<thead><tr><th scope="col">Figure</th><th scope="col">Here</th><th scope="col">Where it sits in ' + esc(p.stName) + '</th><th scope="col">Source</th></tr></thead><tbody>' +
      cols.map(function (c) {
        var here = c.value == null ? '<span class="h-na">Not available</span>' + (c.other ? ' (' + esc(P.fmt(c.other.value, c)) + ' in ' + esc(c.other.year) + ')' : '') : esc(P.fmt(c.value, c));
        var where = c.value == null ? esc(c.reason || '') : esc(c.words || '') + (c.band ? ' <span class="h-flag">' + (c.band === 'top' ? 'top tenth' : 'bottom tenth') + '</span>' : '');
        var src = c.source ? (c.sourceUrl ? '<a href="' + esc(c.sourceUrl) + '" rel="noopener">' + esc(c.source) + '</a>' : esc(c.source)) : '';
        return '<tr><th scope="row">' + esc(c.label) + '</th><td>' + here + '</td><td>' + where + '</td><td>' + src + ', ' + esc(c.years) + '</td></tr>';
      }).join('') + '</tbody>';
  }

  /* The printed sheet's first page (print only): the place, the sentence, six headline
     figures in large type with their state rank and source, and every figure's place in
     the state as one dot plot. Built from the same profile as the screen; nothing new. */
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
    var srcs = p.cols.map(function (c) { return '<b>' + esc(c.short) + '</b> ' + esc(c.source || '') + ', ' + esc(c.years || ''); }).join('; ');
    $('h-pr-cover').innerHTML =
      '<div class="pc-head"><span class="pc-brand">AGSIST</span><span>One place, all its numbers</span><span id="h-pr-date">' + esc(printedOn()) + '</span></div>' +
      '<div class="pc-top"><div><h2 class="pc-name">' + esc(p.name) + ', ' + esc(p.stName) + '</h2>' +
      '<p class="pc-from">' + (from ? 'From ' + esc(from) + '. ' : '') + 'County figures. Ranks are among ' + esc(p.stName) + ' counties that carry the figure, never among fields.</p></div>' +
      '<div class="pc-qr" id="h-pr-qr1"></div></div>' +
      '<p class="pc-sent h-part-sentence-pr">' + esc(p.sentence) + '</p>' +
      '<div class="pc-fp"><div class="pc-tiles">' + tiles + '</div>' +
      '<h3 class="pc-h">Where ' + esc(p.name) + ' sits among ' + esc(p.stName) + ' counties</h3>' +
      '<div class="pd"><div class="pd-r pd-ax"><span class="pd-l"></span><span class="pd-tr"><span>Lowest county</span><span>Middle</span><span>Highest county</span></span><span class="pd-v">Here</span></div>' + rows + '</div>' +
      '<p class="pc-key">Black dot: top or bottom tenth of the state. n/a: the source does not publish it here. Sources: ' + srcs + '. Farmland Atlas county files of ' + esc(mdy(p.atlasGenerated)) + '.</p></div>';
    var st = $('h-pr-page');
    if (!st) { st = document.createElement('style'); st.id = 'h-pr-page'; document.head.appendChild(st); }
    st.textContent = '@media print{@page{@top-right{content:"' + (p.name + ', ' + p.st).replace(/["\\]/g, '') + '"}}@page:first{@top-right{content:none}}}';
  }

  function drawUnusual(p) {
    var list = p.unusual, any = list.some(function (u) { return u.unusual; });
    var lead = !list.length ? 'Too few neighboring counties carry the same figures to compare.' :
      any ? 'The figures that sit furthest from the counties next door (the middle value across those that carry it):' :
        'Nothing here sits far from its neighbors by our rule. The three biggest gaps:';
    $('h-un').innerHTML = '<p>' + esc(lead) + '</p>' + (list.length ? '<ul class="h-un">' + list.map(function (u) {
      return '<li><b>' + esc(u.label) + '</b>: ' + esc(P.fmtShort(u.value, u.col)) + ' here, ' + esc(P.fmtShort(u.nb, u.col)) + ' across ' + u.nbN + ' neighboring counties' +
        (u.dir === 'same' ? '.' : ', ' + u.dir + ' than its neighbors.') + (u.unusual ? ' <span class="h-flag">unusual</span>' : '') + '</li>';
    }).join('') + '</ul>' : '') +
      '<p class="h-src">The rule: a gap counts as unusual when it is at least one national middle-half width (the spread of the middle 50% of US counties) from the neighbors’ middle value, with 3 or more neighbors carrying the figure. Same sources and years as the table above.</p>';
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

  /* ── this week ────────────────────────────────────────────────── */
  var TILES = [['bids', 'Best bids nearby'], ['basis', 'Basis vs normal'], ['rain', 'Rain so far this year'], ['drought', 'Drought this week'], ['hail', 'Hail, last 30 days'], ['usda', 'Next USDA report']];
  function drawWeek() {
    $('h-week').innerHTML = TILES.map(function (t) {
      return '<div class="wk" id="wk-' + t[0] + '"><h3>' + t[1] + '</h3><div class="wk-b">' + (S.week[t[0]] || '<span class="wk-wait">Reading…</span>') + '</div></div>';
    }).join('');
  }
  function tile(id, html) { S.week[id] = html; var el = $('wk-' + id); if (el) el.querySelector('.wk-b').innerHTML = html; }
  function na(why) { return '<p class="h-na">Not available: ' + esc(why) + '.</p>'; }
  function loadWeek(fips, my) {
    var p = S.prof, st = p.st, w = S.where;
    function mine() { return S.prof && S.prof.fips === fips; }
    getJSON('/data/rain/' + st.toLowerCase() + '.json').then(function (f) {
      if (!mine()) return;
      var r = P.rainSoFar(f, fips);
      tile('rain', r.status !== 'ok' ? na(r.why) : '<p class="wk-n">' + r.inches.toFixed(2) + ' in</p><p>' + (r.pct != null ? r.pct + '% of the ' + esc(r.normals) + ' normal (' + r.normal.toFixed(2) + ' in) for Jan 1 to ' + esc(mdy(r.through).replace(/, \d{4}$/, '')) : 'no normal for this date') + '.</p><p class="h-src">County average of NOAA daily station records, through ' + esc(mdy(r.through)) + '.' + (p.flags.indexOf('r') >= 0 ? ' <a href="/rain/' + P.stSlug(st) + '/' + p.slug + '">The whole year</a>' : '') + '</p>');
    });
    getJSON('/data/drought/county-week.json').then(function (f) {
      if (!mine()) return;
      var d = P.droughtNow(f, fips);
      if (d.status !== 'ok') { tile('drought', na(d.why)); return; }
      var lead = d.worst < 0 ? 'None' : d.worstPct.toFixed(0) + '% in ' + d.worstWords.split(' ')[0];
      /* The drought line under the drawing counts weeks this year; say what the newest map shows beside it. */
      (S.odd || []).forEach(function (l, i) {
        if (l.id !== 'drought') return;
        var li = $('h-odd-m' + i), d2 = d.now[2] || 0;
        if (li && !li.parentNode.querySelector('.h-odd-now')) li.insertAdjacentHTML('beforebegin', '<span class="h-src h-odd-now">The newest map (' + esc(mdy(d.valid)) + '): ' + d2.toFixed(0) + '% of the county in severe drought or worse.</span> ');
      });
      tile('drought', '<p class="wk-n">' + esc(lead) + '</p><p>' + (d.worst < 0 ? 'No part of the county is dry or in drought on the map of ' + esc(mdy(d.valid)) + '.' :
        d.worstPct.toFixed(0) + '% of the county in ' + esc(d.worstWords) + ' or worse on the map of ' + esc(mdy(d.valid)) + '. In drought (D1 or worse): ' + d.d1.toFixed(0) + '% now, ' + (d.d1FourAgo == null ? 'no map' : d.d1FourAgo.toFixed(0) + '%') + ' four weeks earlier.') +
        '</p><p class="h-src">U.S. Drought Monitor county statistics (NDMC, University of Nebraska-Lincoln). <a href="/drought-monitor">Drought map</a></p>');
    });
    getJSON('/data/hail/recent.json').then(function (f) {
      if (!mine()) return;
      var h = P.hailNear(f, w.lat, w.lng);
      if (h.status !== 'ok') { tile('hail', na(h.why)); return; }
      var at = w.center ? 'the county center' : 'this spot';
      tile('hail', '<p class="wk-n">' + (h.n ? h.n + ' report' + (h.n === 1 ? '' : 's') : 'None') + '</p><p>' + (h.n ? 'National Weather Service hail reports within ' + h.radius + ' miles of ' + at + ' in the last ' + h.days + ' days. Biggest ' + h.biggest.toFixed(2) + ' in; latest ' + esc(mdy(h.latest.date)) + ', ' + esc(h.latest.city) + ' ' + esc(h.latest.st) + '.' :
        'No National Weather Service hail report within ' + h.radius + ' miles of ' + at + ' in the last ' + h.days + ' days. A missing report is not proof of no hail.') + '</p><p class="h-src">NWS storm reports through ' + esc(mdy(h.through)) + '. <a href="/hail-map?lat=' + (+w.lat).toFixed(4) + '&lon=' + (+w.lng).toFixed(4) + '">Five years of hail here</a></p>');
    });
    Promise.all([getJSON('/data/transport/basis.json'), getJSON('/data/basis-states.json')]).then(function (a) {
      if (!mine()) return;
      var out = [];
      ['corn', 'soybeans'].forEach(function (crop) {
        var b = P.stateBasis(a[1], st, crop), n = P.basisVsNormal(a[0], st, crop === 'corn' ? 'Corn' : 'Soybeans');
        var line = '<p><b>' + (crop === 'corn' ? 'Corn' : 'Soybeans') + '</b>: ';
        line += b.status === 'ok' ? 'middle basis ' + Math.abs(Math.round(b.median * 100)) + '¢ ' + (b.median < 0 ? 'under' : 'over') + ' ' + esc(b.label) + ' futures at ' + b.n + ' ' + esc(P.STATES[st]) + ' elevators we read' : 'state middle basis not available (' + esc(b.why) + ')';
        line += n.status === 'ok' ? '. USDA’s ' + esc(n.region) + ' region: ' + cents(n.latest) + ' against a 5-year normal of ' + cents(n.normal) + ' for the week of ' + esc(mdy(n.week)) + ', ' + Math.abs(Math.round(n.delta * 100)) + '¢ ' + (n.delta < 0 ? 'weaker' : 'stronger') + ' than normal.' : '. Against normal: not available, ' + esc(n.why) + '.';
        out.push(line + '</p>');
      });
      var asOf = a[1] && a[1].generated ? mdy(a[1].generated) : '';
      tile('basis', out.join('') + '<p class="h-src">State medians: AGSIST network elevators' + (asOf ? ', ' + esc(asOf) : '') + '. Normal: USDA AgTransport regional elevator basis. <a href="/basis">Basis vs normal</a></p>');
    });
    getText('/usda-calendar.ics').then(function (t) {
      if (!mine()) return;
      var r = P.nextReport(t, new Date());
      if (!r) { tile('usda', na('the report calendar did not load')); return; }
      var et = r.at.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      tile('usda', '<p class="wk-n">' + esc(r.name) + '</p><p>' + esc(et) + ' ET.</p><p class="h-src">From the <a href="/usda-calendar">USDA report calendar</a>. Weekly Crop Progress and Export Sales are not in this list.</p>');
    });
    loadBids(fips, w);
    loadElev(fips, w);
  }
  function loadBids(fips, w) {
    var net = window.AGSIST_BIDS_NET, lat = +w.lat, lng = +w.lng;
    function draw(snap, live) {
      if (!S.prof || S.prof.fips !== fips) return;
      var b = P.bestBids(snap, lat, lng, 50), out = [];
      ['corn', 'soybeans', 'wheat'].forEach(function (c) {
        var o = b[c]; if (!o || !o.best) return;
        var name = c === 'corn' ? 'Corn' : c === 'soybeans' ? 'Soybeans' : 'Wheat';
        out.push('<p><b>' + name + ' ' + money(o.best.price) + '</b> at ' + esc(o.best.facility) + (o.best.town ? ', ' + esc(o.best.town) : '') + ' ' + esc(o.best.st) + ', ' + o.best.mi + ' mi' + (o.best.delivery ? ' (' + esc(o.best.delivery) + ')' : '') + (o.n === 1 ? '. The only one within 50 mi' : '. Best of ' + o.n + ' within 50 mi') + (o.left_out ? ', ' + o.left_out + ' left out as misread or far off the rest' : '') + '.</p>');
      });
      var from = w.center ? 'the county center' : w.zip ? 'ZIP ' + w.zip : 'this spot';
      var when = snap && snap.fetched ? mdy(snap.fetched) : '';
      tile('bids', (out.length ? out.join('') : na('no elevator we read posts a corn, soybean or wheat bid within 50 miles of ' + from)) +
        '<p class="h-src">Distances from ' + esc(from) + '. ' + (live ? 'Elevator boards AGSIST reads' : 'The site’s saved bid file (a sample, not every elevator)') + (when ? ', ' + esc(when) : '') + '. <a href="' + (w.zip ? '/cash-bids?zip=' + w.zip : '/cash-bids') + '">All bids near here</a></p>');
    }
    var live = net && net.snapshot && isFinite(lat) && isFinite(lng) ? net.snapshot(lat, lng, { radiusMi: 50 }) : Promise.resolve(null);
    live.then(function (snap) {
      if (snap && snap.bids && snap.bids.length) { draw(snap, true); return; }
      getJSON('/data/bids.json').then(function (f) { draw(f, false); });
    });
  }

  /* ── the first screen ─────────────────────────────────────────── */
  var ACIS = 'https://data.rcc-acis.org/StnData', RCP = '/components/rain-county-print.js?v=20';
  var porMemo = {};
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
  /* The station's whole daily record, precipitation only: the call components/rain-print.js
     stationExtremes() makes (there with avgt too). Null when NOAA does not answer in 20 s. */
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
    $('h-first').hidden = false;
    $('h-rank').innerHTML = '<span class="h-wait">Reading this year&rsquo;s rain at the county station&hellip;</span>';
    $('h-rank-sub').innerHTML = '';
    $('h-rp-box').innerHTML = '<div class="h-rp-ph" aria-hidden="true"></div>';
    drawOdd(p);
    getJSON('/data/rain/' + st.toLowerCase() + '.json').then(function (f) {
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
      $('h-rank-sub').innerHTML = esc(fig.gauge) + '. NOAA daily records through RCC-ACIS, as on the <a href="/rain/' + P.stSlug(st) + '/' + esc(p.slug) + '">county rain page</a>.';
      rankIt(fig, head, mine);
    });
  }
  function rankIt(fig, head, mine) {
    porRows(fig.station.sid).then(function (rows) {
      if (!mine()) return;
      if (!rows) {
        $('h-rank').innerHTML = head + ' <span class="h-na">Not ranked: NOAA&rsquo;s station record did not answer.</span> <button type="button" class="h-lnk" id="h-rank-retry">Try again</button>';
        var b = $('h-rank-retry'); if (b) b.onclick = function () { $('h-rank').innerHTML = head + ' <span class="h-wait">Asking NOAA again&hellip;</span>'; rankIt(fig, head, mine); };
        return;
      }
      var r = P.rankSoFar(rows, fig);
      S.rank = r;
      if (r.status !== 'ok') { $('h-rank').innerHTML = head + ' <span class="h-na">Not ranked: ' + esc(r.why) + '.</span>' + mathBox('h-rank-m'); wireMath('h-rank-m', function () { return rankMath(r, fig); }); return; }
      track('here_rank', { n: r.n });
      $('h-rank').innerHTML = '<span class="h-rank-l">' + esc(P.rankWordsRain(r, fig)) + '</span> <span class="h-rank-t">' + fig.total.toFixed(2) + ' in' + (fig.pct != null ? ', ' + fig.pct + '% of a usual year to date' : '') + '.</span>' + mathBox('h-rank-m');
      wireMath('h-rank-m', function () { return rankMath(r, fig); });
    });
  }
  function mathBox(id) { return '<details class="h-math" id="' + id + '"><summary>Show the math</summary><div class="h-math-b"></div></details>'; }
  /* The math is built only when a reader opens it. */
  function wireMath(id, build) {
    var d = $(id); if (!d) return;
    d.addEventListener('toggle', function () { var b = d.querySelector('.h-math-b'); if (d.open && !b.firstChild) b.innerHTML = build(); });
  }
  function rankMath(r, fig) {
    var rows = (r.years || []).concat([[fig.year, r.total]]).sort(function (a, b) { return b[1] - a[1] || a[0] - b[0]; });
    var out = '<p>Rain from ' + esc(r.span) + ' in every year the ' + esc(fig.noun) + ' recorded every one of those days' + (r.first ? ' (' + r.first + ' to ' + r.last + ', plus ' + fig.year + ')' : '') + ': ' + r.n + ' years. ' +
      (r.skipped ? r.skipped + ' earlier year' + (r.skipped === 1 ? '' : 's') + ' left out for a day with no report or a several-day total that ran past the window. ' : '') +
      (r.status === 'ok' ? 'Wetter: ' + r.wetter + '. Drier: ' + r.drier + '. Tied (within 0.005 in): ' + r.tied + '. Ranked from the nearer end, wettest or driest. ' : '') +
      'We rank only with ' + r.min + ' years or more, and only when ' + fig.year + ' has a report for every day and its total matches the ' + fig.total.toFixed(2) + ' in drawn.</p>' +
      '<p class="h-src">Source: NOAA daily records through RCC-ACIS (data.rcc-acis.org), ' + esc(fig.noun) + ' ' + esc(String(fig.station.sid).split(' ')[0]) + ', read just now. ' + fig.year + ' days: the county rain file through ' + esc(mdy(fig.asOf)) + '.</p>';
    if (rows.length > 1) out += '<div class="h-tw"><table><caption class="sr-only">Each year, wettest first</caption><thead><tr><th scope="col">Year</th><th scope="col">Inches, ' + esc(r.span) + '</th></tr></thead><tbody>' +
      rows.map(function (y) { var me = y[0] === fig.year; return '<tr' + (me ? ' class="h-me"' : '') + '><th scope="row">' + y[0] + (me ? ' (this year)' : '') + '</th><td>' + y[1].toFixed(2) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    return out;
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
  /* What's unusual here: the county's own past (Atlas county file), at most five lines. */
  function drawOdd(p) {
    var box = $('h-odd'), list = P.unusualHere(S.county, thisYear());
    S.odd = list;
    if (!list.length) { box.hidden = true; $('h-odd-l').innerHTML = ''; return; }
    box.hidden = false;
    $('h-odd-l').innerHTML = list.map(function (l, i) {
      return '<li><span>' + esc(l.words) + '</span> <span class="h-src">' + esc(l.source) + ', Farmland Atlas county file of ' + esc(mdy((S.county && S.county.generated) || p.atlasGenerated)) + '.</span>' + mathBox('h-odd-m' + i) + '</li>';
    }).join('');
    list.forEach(function (l, i) { wireMath('h-odd-m' + i, function () { return oddMath(l); }); });
  }
  function oddMath(l) {
    var fmtV = function (v) { return l.unit === 'in' ? v.toFixed(2) + ' in' : l.unit === 'deg F' ? v.toFixed(1) + '°F' : l.unit === 'weeks' ? v + ' wk' : v.toFixed(2); };
    var e = l.earlier.slice().sort(function (a, b) { return b[1] - a[1] || a[0] - b[0]; });
    return '<p>' + l.latest.year + ': ' + esc(fmtV(l.latest.v)) + (l.partial ? ' so far (' + l.latest.maps + ' weekly maps in)' : '') + '. Earlier ' + (l.partial ? 'full ' : '') + 'years: ' + l.n + ' (' + l.from + ' to ' + l.to + '). ' +
      'Strictly higher than ' + l.below + ', strictly lower than ' + l.above + ', the same as ' + (l.n - l.below - l.above) + '.</p>' +
      '<p>The rule, set before any county was run: a line shows only when the newest value is higher than at least 90% of the place&rsquo;s own earlier values' + (l.highOnly ? '' : ' or lower than at least 90% of them') + ', with ' + P.OWN_MIN + ' or more earlier values. ' +
      (l.partial ? 'A year still going is checked on the high side only: its count can only grow. ' : '') +
      'We check five figures (April to September rain, July and August nights, weeks in drought, the insurance loss ratio). In an ordinary year about one of them lands here by chance, so a line means unusual for this place, not a cause.</p>' +
      '<div class="h-tw"><table><caption class="sr-only">Earlier values, highest first</caption><thead><tr><th scope="col">Year</th><th scope="col">Value</th></tr></thead><tbody>' +
      e.map(function (x) { return '<tr><th scope="row">' + x[0] + '</th><td>' + esc(fmtV(x[1])) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }

  /* ── my elevator against its neighbors (This week) ──────────────── */
  var CROPN = { corn: 'Corn', soybeans: 'Soybeans' };
  /* cents, signed; a neighbors' middle can fall on a half cent and says so */
  function basisTxt(c) { if (c == null) return ''; var a = Math.round(Math.abs(c) * 2) / 2; return (a === 0 ? '' : c < 0 ? '−' : '+') + (a % 1 ? a.toFixed(1) : a) + '¢'; }
  function loadElev(fips, w) {
    var net = window.AGSIST_BIDS_NET, lat = +w.lat, lng = +w.lng, box = $('h-elev-b');
    if (!box) return;
    function mine() { return S.prof && S.prof.fips === fips; }
    box.innerHTML = '<span class="wk-wait">Reading the elevator boards&hellip;</span>';
    var ask = net && net.index && isFinite(lat) && isFinite(lng) ? net.index() : Promise.resolve(null);
    ask.then(function (idx) {
      if (!mine()) return;
      if (!idx || !idx.places) { box.innerHTML = na('the elevator network did not answer'); return; }
      var by = P.basisNeighbors(idx.places, lat, lng), from = w.center ? 'the county center' : w.zip ? 'ZIP ' + w.zip : 'this spot';
      var rows = [].concat(by.corn || [], by.soybeans || []);
      if (!rows.length) { box.innerHTML = na('no elevator we read within ' + P.EL.NEAR + ' miles of ' + from + ' posts a usable corn or soybean bid'); return; }
      S.elev = rows;
      box.innerHTML = '<ul class="h-el">' + rows.map(function (r, i) {
        var head = '<b>' + CROPN[r.crop] + '</b> at ' + esc(r.name) + (r.town ? ', ' + esc(r.town) : '') + ' ' + esc(r.st) + ' (' + r.mi + ' mi): basis ' + basisTxt(r.basis) + (r.delivery ? ' (delivery ' + esc(r.delivery) + ')' : '');
        var vs = r.status === 'ok' ? ', ' + (r.gap === 0 ? 'the same as' : Math.abs(r.gap) + '¢ ' + (r.gap > 0 ? 'stronger than' : 'weaker than')) + ' the middle of ' + r.nbN + ' elevators' + (r.nbCos < r.nbN ? ' (' + r.nbCos + ' compan' + (r.nbCos === 1 ? 'y' : 'ies') + ')' : '') + ' within ' + r.radius + ' miles posting the same delivery (' + basisTxt(r.nbMedian) + ').'
          : '. Against its neighbors: not available, ' + esc(r.why) + '.';
        return '<li id="h-el-' + i + '">' + head + vs + ' <span class="h-el-h" id="h-el-h' + i + '"></span>' + mathBox('h-el-m' + i) + '</li>';
      }).join('') + '</ul><p class="h-src" id="h-el-thin" hidden></p><p class="h-src">Distances from ' + esc(from) + '. Live elevator boards AGSIST reads (the bids network)' + (idx.generated ? ', ' + esc(mdy(idx.generated)) : '') + '. Each elevator&rsquo;s nearest open delivery. Basis history starts June 2026. <a href="' + (w.zip ? '/cash-bids?zip=' + w.zip : '/cash-bids') + '">All bids near here</a></p>';
      rows.forEach(function (r, i) { wireMath('h-el-m' + i, function () { return elevMath(r); }); });
      elevHistory(rows, mine);
    });
  }
  function elevMath(r) {
    return '<p>Its bid: ' + esc(r.name) + ', ' + esc(r.town) + ' ' + esc(r.st) + ', ' + esc(CROPN[r.crop].toLowerCase()) + ' $' + r.cash.toFixed(2) + ', basis ' + basisTxt(r.basis) + ', delivery &ldquo;' + esc(r.delivery) + '&rdquo; (' + esc(r.period) + ').' + (r.elevId ? ' Elevator id ' + esc(r.elevId) + '.' : '') + '</p>' +
      '<p>The rule, set before any place was run: the ' + P.EL.EACH + ' nearest elevators within ' + P.EL.NEAR + ' miles with a usable bid; their neighbors are every other elevator within ' + r.radius + ' miles of each one posting the same crop for the same delivery period, one per elevator id; at least ' + r.min + ' neighbors, else no comparison. The gap is its basis minus the neighbors&rsquo; middle basis. Other branches of the same company count as neighbors; the line says how many companies they are.</p>' +
      (r.neighbors.length ? '<div class="h-tw"><table><caption class="sr-only">The neighbors, weakest basis first</caption><thead><tr><th scope="col">Elevator</th><th scope="col">Miles from it</th><th scope="col">Basis</th></tr></thead><tbody>' +
        r.neighbors.map(function (n) { return '<tr><th scope="row">' + esc(n.name) + (n.town ? ', ' + esc(n.town) : '') + ' ' + esc(n.st) + '</th><td>' + n.mi + '</td><td>' + basisTxt(n.basis) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="h-na">No neighbor posts the same delivery.</p>');
  }
  /* Rows whose own history is too short share one line under the list, not one each. */
  function thinNote(rows) {
    var t = rows.filter(function (r) { return r.hist && r.hist.status === 'thin'; }), el = $('h-el-thin');
    if (!el || !t.length) return;
    var f = t.map(function (r) { return r.hist.first; }).filter(Boolean).sort(), d = function (x) { return mdy(x).replace(/, \d{4}$/, ''); };
    el.hidden = false;
    el.textContent = 'Against its own history: not yet for ' + (t.length === rows.length ? 'any of these' : t.length + ' of these') + '. ' +
      (f.length ? 'Those deliveries were first seen ' + (f[0] === f[f.length - 1] ? d(f[0]) : 'between ' + d(f[0]) + ' and ' + d(f[f.length - 1])) + '; ' : '') +
      'a comparison waits for ' + P.EL.HIST_DAYS + ' days of one delivery.';
  }
  /* Its own history: the id -> history key join, the state's basis file, and the place's shard
     for the row's contract. Any missing piece leaves the line empty, never a guess. */
  function elevHistory(rows, mine) {
    var net = window.AGSIST_BIDS_NET, today = new Date().toISOString().slice(0, 10);
    var sts = {};
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
          if (!key) { el.textContent = join && join.multi && join.multi[r.elevId] ? 'Its own history: listed under ' + join.multi[r.elevId] + ' names in the history, so not joined.' : ''; return; }
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
          });
        });
      });
    });
  }

  /* ── print report ─────────────────────────────────────────────── */
  // The sheet: checkboxes pick the parts (all ticked by default); More detail prints the
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
  /* Just before printing: the date, the QR back to this exact link, and the tables opened for More detail. */
  var opened = [];
  function beforePrint() {
    if (!S.prof) return;
    var d = $('h-pr-date'); if (d) d.textContent = printedOn();
    buildQr();
    /* The Print button runs this and the browser's beforeprint runs it again: keep the first list. */
    if (S.print.more) [].forEach.call(document.querySelectorAll('#h-place details.h-tbl'), function (d) { if (!d.open) { d.open = true; opened.push(d); } });
  }
  function buildQr() {
    var w = S.where || {}, p = S.prof;
    if (!p) return;
    var url = P.qrLink({ fips: p.fips, zip: w.zip, at: w.lat != null && !w.center && !w.zip ? { lat: w.lat, lng: w.lng } : null, print: S.print });
    var qr = $('h-pr-qr1'), end = $('h-pr-qr'), bare = esc(url.replace(/^HTTPS:\/\/AGSIST\.COM/, 'agsist.com'));
    if (qr && qr.getAttribute('data-url') !== url) {
      var svg = '';
      try { svg = window.AgQR ? window.AgQR.svg(url, 'QR code for this page') : ''; } catch (e) { svg = ''; }
      qr.innerHTML = svg ? svg + '<p>Scan for the live page</p>' : '';
      qr.setAttribute('data-url', url);
    }
    if (end) end.innerHTML = '<p>This report, live and up to date: ' + bare + '</p>';
  }
  function afterPrint() { opened.forEach(function (d) { d.open = false; }); opened = []; }
  function wirePrint() {
    var btn = $('h-pr-btn'), box = $('h-pr-box');
    btn.addEventListener('click', function () {
      box.hidden = !box.hidden;
      btn.setAttribute('aria-expanded', String(!box.hidden));
    });
    box.addEventListener('change', readPanel);
    $('h-pr-go').addEventListener('click', function () {
      readPanel();
      track('here_print', { parts: S.print.parts.length, more: S.print.more ? 1 : 0 });
      beforePrint();
      try { window.print(); } catch (e) {}
    });
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
  }

  /* ── the map ──────────────────────────────────────────────────── */
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
    return { W: W, H: Math.max(1, H), path: path, x0: x0, y1: y1, k: k, sx: sx };
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
      function pick(t) { var f = t.getAttribute('data-fips'); track('here_find', { by: 'map' }); open(f, { how: 'county' }, ++S.seq); window.scrollTo({ top: $('h-title').getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' }); }
      box.onclick = function (e) {
        if (e.target.closest('[data-us]')) { drawMap(null); return; }
        var t = e.target.closest('[data-fips]'); if (t) pick(t);
      };
      box.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { var t = e.target.closest('[data-fips]'); if (t) { e.preventDefault(); pick(t); } } };
    });
  }

  /* ── start ────────────────────────────────────────────────────── */
  function start() {
    var q = P.parseQuery(location.search);
    if (q.print) S.print = q.print;
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
    $('h-map-box').addEventListener('toggle', function () { if ($('h-map-box').open && !$('h-map').firstChild) drawMap(); });
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[data-fips]');
      if (!a) return;
      e.preventDefault();
      open(a.getAttribute('data-fips'), { how: 'county' }, ++S.seq);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    var my = ++S.seq;
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
        });
        return;
      }
      if (q.q) $('h-q').value = q.q;
      open(q.fips, w, my);
    } else if (q.zip) { $('h-q').value = q.zip; byZip(q.zip, my); }
    else if (q.at) byPoint(q.at, my, null);
    else if (q.q) { $('h-q').value = q.q; go(q.q, 'link'); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.AgHere = { go: go, open: open, state: S, beforePrint: beforePrint, afterPrint: afterPrint };
})();
