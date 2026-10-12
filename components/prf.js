/* components/prf.js: the /prf page. Finds a PRF grid, lets the reader set a
   policy, and shows what that policy would have paid in every year on record.

   WHAT COMPUTES WHAT (honest-numbers rule 9)
     components/prf-math.js owns every dollar. This file owns the screen: it
     reads data/prf/ (scripts/fetch_prf.py), hands the numbers to AgPrfMath and
     prints what comes back. If a figure is wrong, fix it there, not here.

   WHAT THE PAGE WILL NOT PRINT
     * a total over years that are not complete. Totals run over the years up
       to meta.years.last_complete, the same years for every setup, so two
       setups are always compared on one sample. The open year is listed on
       its own line and never added in.
     * a number when the split breaks a rule, the county does not offer the
       use, or RMA publishes no rate for a chosen interval at this grid. The
       reason is printed instead.
     * a best split. The record says what paid in the past.
     * anything when the grid file and meta.json disagree about the crop year.

   The page before this script runs is the page a crawler reads: every rule,
   date and the method are in prf.html. Nothing here writes those. */
(function () {
  'use strict';
  var M = window.AgPrfMath, root = document.querySelector('[data-prf]');
  if (!M || !root) return;
  var SRC = root.getAttribute('data-src') || '/data/prf/';
  var KEY = 'agsist_prf';
  var N = M.N, LABELS = M.LABELS;
  var GEO = 'https://geocoding-api.open-meteo.com/v1/search';

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function usd(v) { if (v == null || !isFinite(v)) return '—'; var n = Math.round(v); return (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US'); }
  function usd2(v) { if (v == null || !isFinite(v)) return '—'; return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function signed(v) { if (v == null || !isFinite(v)) return '—'; var n = Math.round(v); return (n > 0 ? '+' : n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US'); }
  function pctOfNormal(v) { return v == null ? '—' : (Math.round(v * 1000) / 10).toFixed(1); }
  var DASH = '\u2014';
  function nw(t) { return '<span class="prf-nw">' + t + '</span>'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function track(name, p) { try { if (typeof window.gtag === 'function') window.gtag('event', name, p || {}); } catch (e) {} }

  /* ---------------------------------------------------------------- data */
  var meta = null, states = {}, shards = {}, inflight = {};
  function getJSON(url, optional) {
    if (inflight[url]) return inflight[url];
    inflight[url] = fetch(url).then(function (r) {
      if (r.status === 404 && optional) return null;
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
    inflight[url].catch(function () { delete inflight[url]; });
    return inflight[url];
  }
  function stateByFips(f) { for (var i = 0; i < meta.states.length; i++) if (meta.states[i].fips === f) return meta.states[i]; return null; }
  function loadState(st) {
    if (states[st]) return Promise.resolve(states[st]);
    return getJSON(SRC + 's/' + st + '.json').then(function (d) { states[st] = d; return d; });
  }
  function loadShard(key) {
    if (shards[key]) return Promise.resolve(shards[key]);
    return Promise.all([getJSON(SRC + 'g/' + key + '.json', true), getJSON(SRC + 'y/' + key + '.json', true)]).then(function (r) {
      shards[key] = { g: r[0], y: r[1] || { g: {} } };
      return shards[key];
    });
  }
  /* One grid, opened: the index by year, split into the complete years (every
     total uses these and only these) and the years still open. */
  function openGrid(id) {
    var sh = shards[M.shardKey(id)];
    if (!sh || !sh.g || !sh.g.g || !sh.g.g[String(id)]) return null;
    if (sh.g.cy !== meta.crop_year) return { stale: true };
    var o = M.openGrid(sh.g.g[String(id)], sh.g.y0, sh.g.y1, null), done = {}, open = {};
    Object.keys(o.index).forEach(function (y) { if (+y <= meta.years.last_complete) done[y] = o.index[y]; });
    var later = (sh.y.g || {})[String(id)] || {};
    Object.keys(later).forEach(function (y) {
      if (+y > meta.years.last_complete) open[y] = later[y].map(function (v) { return v == null ? null : v / 1000; });
    });
    return { done: done, open: open, rates: o.rates, avgMm: o.avgMm, counties: o.counties };
  }

  /* ---------------------------------------------------------------- state */
  function blank() { var a = []; for (var i = 0; i < N; i++) a.push(0); return a; }
  var S = { grid: null, st: null, co: null, pt: null, use: 0, acres: 100, share: 100,
            A: { cov: 90, pf: 100, split: blank(), even: true }, B: null, on: 'A' };
  function cur() { return S[S.on] || S.A; }
  function county() { return S.st && states[S.st] && S.co ? states[S.st].counties[S.co] : null; }
  function limits() { var c = county(); if (!c) return null; return c.lim || (c.limc || {})[String(S.use)] || null; }
  function baseValue() {
    var c = county(); if (!c) return null;
    var o = c.bg && c.bg[String(S.grid)];
    return o && o[String(S.use)] != null ? o[String(S.use)] : c.b[S.use];
  }
  function minmax() {
    var L = limits(), mn = [], mx = [], ok = [];
    for (var i = 0; i < N; i++) { var p = L ? L[i] : null; mn.push(p ? p[0] : null); mx.push(p ? p[1] : null); ok.push(!!p); }
    return { min: mn, max: mx, valid: ok };
  }

  /* Everything one setup comes to. ok is false, with the reason in words,
     whenever a figure would be wrong to print. */
  function compute(setup) {
    var g = openGrid(S.grid), c = county(), out = { ok: false, why: '', setup: setup };
    if (!g) { out.why = 'No grid chosen yet.'; return out; }
    if (g.stale) { out.why = 'The data files for this grid are from two different crop years, so nothing is shown. Reload the page in a minute.'; return out; }
    if (!c) { out.why = 'Pick the county the land is in.'; return out; }
    var cbv = baseValue(), mm = minmax();
    out.g = g; out.mm = mm; out.cbv = cbv;
    if (cbv == null) { out.why = 'USDA lists no county base value for this use in ' + c.n + ' County. Pick another use.'; return out; }
    if (!(S.acres > 0)) { out.why = 'Enter the acres to insure.'; return out; }
    var rates = g.rates[setup.cov], chk = M.checkSplit(setup.split, mm.min, mm.max, mm.valid);
    out.check = chk; out.rates = rates;
    var msgs = [];
    chk.errors.forEach(function (e) {
      if (e.why === 'sum') msgs.push(e.sum < 100 ? 'The months add to ' + e.sum + '%. Place ' + (100 - e.sum) + '% more.' : 'The months add to ' + e.sum + '%. Take ' + (e.sum - 100) + '% off.');
      else if (e.why === 'below') msgs.push(LABELS[e.i] + ' needs at least ' + e.limit + '%.');
      else if (e.why === 'above') msgs.push(LABELS[e.i] + ' is capped at ' + e.limit + '% in this county.');
      else if (e.why === 'adjacent') msgs.push(LABELS[e.other] + ' and ' + LABELS[e.i] + ' share a month. Keep one.');
      else if (e.why === 'unavailable') msgs.push(LABELS[e.i] + ' is not offered in this county.');
    });
    if (chk.used === 0) msgs = ['Pick the two-month intervals to insure. At least two.'];
    else if (chk.used < 2) msgs.unshift('Pick at least two intervals.');
    for (var i = 0; i < N; i++) if (setup.split[i] > 0 && rates[i] == null && mm.valid[i]) msgs.push('USDA publishes no ' + setup.cov + '% rate for ' + LABELS[i] + ' at this grid.');
    if (msgs.length) { out.why = msgs.join(' '); out.msgs = msgs; return out; }
    var pol = M.policy({ cbv: cbv, coverage: setup.cov, productivity: setup.pf, acres: S.acres, share: S.share,
                         split: setup.split, rates: rates, subsidy: meta.subsidy[String(setup.cov)] });
    var hist = M.history(pol, g.done), sum = M.summarize(hist, pol);
    if (!sum.years) { out.why = 'USDA has published no index for these intervals at this grid.'; return out; }
    out.ok = true; out.pol = pol; out.hist = hist; out.sum = sum; out.dry = M.longestDry(hist);
    out.open = M.history(pol, g.open);
    out.subsidy = meta.subsidy[String(setup.cov)];
    return out;
  }

  /* ---------------------------------------------------------------- url + storage */
  function setupStr(s) { return [s.cov, s.pf, s.split.join('.')].join('_'); }
  function parseSetup(str) {
    var p = String(str || '').split('_'); if (p.length !== 3) return null;
    var cov = +p[0], pf = +p[1], sp = p[2].split('.').map(function (x) { return Math.max(0, Math.min(100, Math.round(+x) || 0)); });
    if (M.COVERAGE.indexOf(cov) < 0 || !(pf >= 60 && pf <= 150) || sp.length !== N) return null;
    return { cov: cov, pf: Math.round(pf), split: sp, even: false };
  }
  function shareUrl() {
    var q = ['g=' + S.grid, 'c=' + (stateFips() + S.co), 'u=' + S.use, 'ac=' + S.acres, 'sh=' + S.share, 'a=' + setupStr(S.A)];
    if (S.B) q.push('b=' + setupStr(S.B));
    return location.origin + location.pathname + '?' + q.join('&');
  }
  function stateFips() { return states[S.st] ? states[S.st].fips : ''; }
  function remember() {
    if (!S.grid || !S.co) return;
    try { history.replaceState(null, '', shareUrl().replace(location.origin, '')); } catch (e) {}
    try { localStorage.setItem(KEY, JSON.stringify({ g: S.grid, c: stateFips() + S.co, u: S.use, ac: S.acres, sh: S.share, a: setupStr(S.A), b: S.B ? setupStr(S.B) : '', pt: S.pt })); } catch (e) {}
  }
  function saved() {
    var q = {}, had = false;
    location.search.replace(/^\?/, '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) { q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); had = true; } });
    if (had && q.g) return q;
    try { var o = JSON.parse(localStorage.getItem(KEY) || 'null'); if (o && o.g) return o; } catch (e) {}
    return null;
  }

  /* ---------------------------------------------------------------- choosing a grid */
  function say(msg, bad) { var el = $('prf-find-msg'); el.textContent = msg || ''; el.classList.toggle('is-bad', !!bad); }
  function norm(s) { return String(s || '').toLowerCase().replace(/\bcounty\b|\bparish\b/g, '').replace(/[^a-z]/g, ''); }

  /* Move to a grid. want: { county: 'SSCCC' } or { countyName, stateName }. */
  function goGrid(id, want, keep) {
    id = +id;
    var key = M.shardKey(id);
    if (!key) { say('That is not a grid in the 48 contiguous states.', true); return Promise.resolve(false); }
    say('Reading grid ' + id + '…');
    return loadShard(key).then(function (sh) {
      var rec = sh.g && sh.g.g ? sh.g.g[String(id)] : null;
      if (!rec) { say('USDA offers no PRF grid there. Grids cover the 48 contiguous states; Hawaii is a separate program and is not on this page.', true); return false; }
      var codes = rec.c || [], sts = {};
      codes.forEach(function (c) { var s = stateByFips(c.slice(0, 2)); if (s) sts[s.st] = 1; });
      return Promise.all(Object.keys(sts).map(loadState)).then(function () {
        var pick = null;
        if (want && want.county && codes.indexOf(want.county) >= 0) pick = want.county;
        if (!pick && want && want.countyName) {
          codes.forEach(function (c) {
            var s = stateByFips(c.slice(0, 2)), d = s && states[s.st], co = d && d.counties[c.slice(2)];
            if (!pick && co && norm(co.n) === norm(want.countyName) && (!want.stateName || norm(d.name) === norm(want.stateName))) pick = c;
          });
        }
        if (!pick && S.co && codes.indexOf(stateFips() + S.co) >= 0) pick = stateFips() + S.co;
        if (!pick) pick = codes.filter(function (c) { var s = stateByFips(c.slice(0, 2)); return s && states[s.st] && states[s.st].counties[c.slice(2)]; })[0];
        if (!pick) { say('Grid ' + id + ' has no county with PRF offers in the data.', true); return false; }
        S.grid = id; S.st = stateByFips(pick.slice(0, 2)).st; S.co = pick.slice(2);
        if (!keep) S.pt = want && want.pt ? want.pt : null;
        afterGrid();
        say('');
        return true;
      });
    }).catch(function () { say('The data for that grid did not load. Check the connection and try again.', true); return false; });
  }

  /* After the grid or county changes: the use must be one the county offers,
     and each setup's split must fit the county's limits. */
  function afterGrid() {
    var c = county();
    if (c.b[S.use] == null) { for (var i = 0; i < c.b.length; i++) if (c.b[i] != null) { S.use = i; break; } }
    ['A', 'B'].forEach(function (k) { if (S[k]) fit(S[k]); });
    $('prf-tool').hidden = false;
    $('prf-start').hidden = true;
    drawWhere(); buildUse(); buildIv(); render();
    track('prf_grid', { grid: S.grid, state: S.st });
  }
  /* A split that no longer fits (a month not offered here, a cap) is rebuilt
     evenly from the months it had. An empty one gets the page's example. */
  function fit(setup) {
    var mm = minmax(), on = setup.split.map(function (p, i) { return p > 0 && mm.valid[i]; });
    /* two months that share a month cannot both stay (a hand-edited link can ask for them): the earlier one is kept */
    for (var k = 1; k < N; k++) if (on[k] && on[k - 1]) on[k] = false;
    if (!on.some(Boolean)) { on = blank().map(function (_, i) { return (i === 3 || i === 5) && mm.valid[i]; }); setup.even = true; }
    if (!on.some(Boolean)) { setup.split = blank(); return; }
    var chk = M.checkSplit(setup.split, mm.min, mm.max, mm.valid);
    if (chk.ok && chk.used >= 2) return;
    var ev = M.evenSplit(on, mm.min, mm.max);
    if (ev) { setup.split = ev; setup.even = true; }
  }

  function find(q) {
    q = String(q || '').trim();
    if (!q) { say('Type a ZIP, a town, or a latitude and longitude.', true); return; }
    var m = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(q);
    if (m) {
      var lat = +m[1], lon = +m[2];
      if (lon > 0) lon = -lon;                     /* a US longitude typed without its minus sign */
      return atPoint(lat, lon, lat.toFixed(4) + ', ' + lon.toFixed(4), null);
    }
    m = /^grid\s*#?\s*(\d{1,5})$/i.exec(q);
    if (m) return goGrid(+m[1], null).then(function (ok) { if (ok && window.innerWidth < 980) $('prf-where-h').scrollIntoView({ block: 'start' }); });
    say('Looking that up…');
    var isZip = /^\d{5}$/.test(q);
    fetch(GEO + '?name=' + encodeURIComponent(q) + '&count=5&language=en&format=json&countryCode=US')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var r = d && d.results && d.results[0];
        if (!r) {
          if (/^\d{1,5}$/.test(q)) return goGrid(+q, null);
          say('No place found for “' + q + '”. Try a ZIP or a latitude and longitude.', true); return;
        }
        var place = isZip ? 'the middle of ZIP ' + q : (r.name + (r.admin1 ? ', ' + r.admin1 : ''));
        return atPoint(r.latitude, r.longitude, place, { countyName: r.admin2, stateName: r.admin1 }).then(function (ok) {
          if (ok && isZip && M.shardKey(+q)) {
            var el = $('prf-find-msg');
            el.innerHTML = 'Showing the grid at the middle of ZIP ' + esc(q) + '. <button type="button" class="prf-link" id="prf-asgrid">Meant grid ID ' + esc(q) + '?</button>';
            $('prf-asgrid').addEventListener('click', function () { goGrid(+q, null); });
          }
        });
      })
      .catch(function () { say('The place lookup did not answer. Enter a latitude and longitude, or pick by state and county below.', true); });
  }
  function atPoint(lat, lon, label, want) {
    var id = M.gridFromLatLon(lat, lon);
    if (!id) { say('That point is outside the 48 contiguous states.', true); return Promise.resolve(false); }
    want = want || {}; want.pt = { lat: +lat, lon: +lon, label: label };
    return goGrid(id, want).then(function (ok) {
      /* on one column the answer sits below the fold of the search box: bring the grid to the top */
      if (ok && window.innerWidth < 980) $('prf-where-h').scrollIntoView({ block: 'start' });
      return ok;
    });
  }

  /* ---------------------------------------------------------------- where: the grid, drawn */
  function miles(lat) { return { ns: 0.25 * 69.05, ew: 0.25 * 69.17 * Math.cos(lat * Math.PI / 180) }; }
  function drawWhere() {
    var c = county(), d = states[S.st], b = M.gridBounds(S.grid), rc = M.gridRowCol(S.grid);
    var mi = miles((b.south + b.north) / 2);
    var inCounty = {}, inState = {};
    c.g.forEach(function (g) { inCounty[g] = 1; });
    Object.keys(d.counties).forEach(function (k) { d.counties[k].g.forEach(function (g) { inState[g] = 1; }); });
    var W = 186, cell = 60, pad = 3, svg = [];
    svg.push('<svg viewBox="0 0 ' + W + ' ' + W + '" role="group" aria-label="Grid ' + S.grid + ' and the eight grids around it. North is up.">');
    for (var dr = 1; dr >= -1; dr--) for (var dc = -1; dc <= 1; dc++) {
      var r = rc.row + dr, cc = rc.col + dc, x = pad + (dc + 1) * cell, y = pad + (1 - dr) * cell;
      if (r < 0 || cc < 0 || r >= 120 || cc >= 300) continue;
      var id = r * 300 + cc + 1, here = dr === 0 && dc === 0;
      var cls = here ? 'is-here' : inCounty[id] ? 'is-county' : inState[id] ? 'is-state' : 'is-out';
      svg.push('<g class="prf-cell ' + cls + '"' + (here ? '' : ' data-grid="' + id + '" role="button" tabindex="0" aria-label="Switch to grid ' + id + (inCounty[id] ? ', also in ' + esc(c.n) + ' County' : '') + '"') + '>'
        + '<rect x="' + x + '" y="' + y + '" width="' + (cell - 2) + '" height="' + (cell - 2) + '" rx="3"/>'
        + '<text x="' + (x + cell / 2 - 1) + '" y="' + (y + cell / 2 + 4) + '" text-anchor="middle">' + id + '</text></g>');
    }
    var note = '';
    if (S.pt && M.gridFromLatLon(S.pt.lat, S.pt.lon) === S.grid) {
      var fx = (S.pt.lon - b.west) / 0.25, fy = (b.north - S.pt.lat) / 0.25;
      svg.push('<circle class="prf-pin" cx="' + (pad + cell + fx * (cell - 2)).toFixed(1) + '" cy="' + (pad + cell + fy * (cell - 2)).toFixed(1) + '" r="4"/>');
      var edges = [['north', (b.north - S.pt.lat) / 0.25 * mi.ns], ['south', (S.pt.lat - b.south) / 0.25 * mi.ns],
                   ['east', (b.east - S.pt.lon) / 0.25 * mi.ew], ['west', (S.pt.lon - b.west) / 0.25 * mi.ew]].sort(function (a, z) { return a[1] - z[1]; });
      note = ' The dot is ' + esc(S.pt.label) + ', about ' + edges[0][1].toFixed(1) + ' miles from the grid’s ' + edges[0][0] + ' edge.';
    }
    svg.push('</svg>');
    $('prf-map').innerHTML = svg.join('');
    $('prf-where-h').textContent = 'Grid ' + S.grid + ' · ' + c.n + ' County, ' + d.name;
    $('prf-where-t').innerHTML = 'Covers ' + b.south.toFixed(2) + '° to ' + b.north.toFixed(2) + '° N, ' + Math.abs(b.east).toFixed(2) + '° to ' + Math.abs(b.west).toFixed(2) + '° W: about '
      + mi.ns.toFixed(0) + ' miles north to south and ' + mi.ew.toFixed(0) + ' east to west.' + note
      + ' Your agent sets the grid from a point on the land you insure, using <a href="https://public-rma.fpac.usda.gov/apps/PRF" rel="noopener">USDA’s grid locator</a>.';
    /* county: a grid can lie in more than one */
    var codes = (shards[M.shardKey(S.grid)].g.g[String(S.grid)].c || []).filter(function (code) {
      var s = stateByFips(code.slice(0, 2)); return s && states[s.st] && states[s.st].counties[code.slice(2)];
    });
    var sel = $('prf-co'), wrap = $('prf-co-wrap');
    sel.innerHTML = codes.map(function (code) {
      var s = stateByFips(code.slice(0, 2)), co = states[s.st].counties[code.slice(2)];
      return '<option value="' + code + '"' + (s.st === S.st && code.slice(2) === S.co ? ' selected' : '') + '>' + esc(co.n) + ', ' + s.st + '</option>';
    }).join('');
    wrap.hidden = codes.length < 2;
    $('prf-co-n').textContent = codes.length;
    /* the browse boxes follow */
    if ($('prf-b-st').value !== S.st) { $('prf-b-st').value = S.st; fillBrowseCounties(); }
    $('prf-b-co').value = S.co; fillBrowseGrids();
  }
  function fillBrowseCounties() {
    var st = $('prf-b-st').value, co = $('prf-b-co');
    $('prf-b-grids').innerHTML = '';
    if (!st) { co.innerHTML = '<option value="">Pick a state first</option>'; co.disabled = true; return Promise.resolve(); }
    return loadState(st).then(function (d) {
      var ks = Object.keys(d.counties).sort(function (a, b) { return d.counties[a].n < d.counties[b].n ? -1 : 1; });
      co.innerHTML = '<option value="">Pick a county</option>' + ks.map(function (k) { return '<option value="' + k + '">' + esc(d.counties[k].n) + '</option>'; }).join('');
      co.disabled = false;
    }).catch(function () { say('That state’s file did not load. Try again.', true); });
  }
  function fillBrowseGrids() {
    var st = $('prf-b-st').value, k = $('prf-b-co').value, box = $('prf-b-grids');
    if (!st || !k || !states[st] || !states[st].counties[k]) { box.innerHTML = ''; return; }
    var c = states[st].counties[k], f = states[st].fips;
    box.innerHTML = '<span class="prf-b-l">' + plural(c.g.length, 'grid touches', 'grids touch') + ' ' + esc(c.n) + ' County:</span> '
      + c.g.map(function (g) { return '<button type="button" class="prf-chip' + (g === S.grid && st === S.st && k === S.co ? ' is-on' : '') + '" data-grid="' + g + '" data-county="' + f + k + '">' + g + '</button>'; }).join('');
  }

  /* ---------------------------------------------------------------- the setup controls */
  function buildUse() {
    var c = county(), d = states[S.st], sel = $('prf-use');
    sel.innerHTML = d.combos.map(function (name, i) {
      return c.b[i] == null ? '' : '<option value="' + i + '"' + (i === S.use ? ' selected' : '') + '>' + esc(name) + '</option>';
    }).join('');
  }
  function buildIv() {
    var rows = '';
    for (var i = 0; i < N; i++) {
      rows += '<tr data-i="' + i + '"><th scope="row"><label class="prf-ivl"><input type="checkbox" data-iv-on="' + i + '"><span class="prf-ivm"><span>' + LABELS[i] + '</span><small data-iv-note="' + i + '"></small></span></label></th>'
        + '<td class="prf-ivp"><button type="button" class="prf-step" data-iv-step="-5" data-i="' + i + '" aria-label="5 percent less in ' + M.LONG[i] + '">−</button>'
        + '<input type="number" inputmode="numeric" min="0" max="100" step="1" data-iv-pct="' + i + '" aria-label="Percent of value in ' + M.LONG[i] + '">'
        + '<button type="button" class="prf-step" data-iv-step="5" data-i="' + i + '" aria-label="5 percent more in ' + M.LONG[i] + '">+</button><span class="prf-pc">%</span></td></tr>';
    }
    $('prf-iv-body').innerHTML = rows;
  }
  /* Bring every control into line with the state, without rebuilding the
     inputs (a rebuilt input drops the reader's cursor mid-number). */
  function syncControls() {
    var s = cur(), mm = minmax(), g = openGrid(S.grid);
    $('prf-use').value = String(S.use);
    $('prf-acres').value !== String(S.acres) && document.activeElement !== $('prf-acres') && ($('prf-acres').value = S.acres);
    document.activeElement !== $('prf-share') && ($('prf-share').value = S.share);
    document.activeElement !== $('prf-pf-n') && ($('prf-pf-n').value = s.pf);
    $('prf-pf').value = s.pf;
    Array.prototype.forEach.call(document.querySelectorAll('[data-cov]'), function (b) {
      var on = +b.getAttribute('data-cov') === s.cov; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var rates = g && g.rates ? g.rates[s.cov] : null;
    for (var i = 0; i < N; i++) {
      var tr = document.querySelector('#prf-iv-body tr[data-i="' + i + '"]'); if (!tr) continue;
      var cb = tr.querySelector('[data-iv-on]'), inp = tr.querySelector('[data-iv-pct]'), note = tr.querySelector('[data-iv-note]');
      var on = s.split[i] > 0, offered = mm.valid[i];
      var nb = (i > 0 && s.split[i - 1] > 0) ? i - 1 : (i < N - 1 && s.split[i + 1] > 0) ? i + 1 : -1;
      var blocked = !on && (nb >= 0 || !offered);
      cb.checked = on; cb.disabled = blocked;
      inp.disabled = !on; if (document.activeElement !== inp) inp.value = on ? s.split[i] : '';
      Array.prototype.forEach.call(tr.querySelectorAll('.prf-step'), function (b) { b.disabled = !on; });
      tr.classList.toggle('is-on', on); tr.classList.toggle('is-off', blocked);
      var t = '';
      if (!offered) t = 'not offered in this county';
      else if (!on && nb >= 0) t = 'shares a month with ' + LABELS[nb];
      else {
        t = mm.min[i] + ' to ' + mm.max[i] + '%';
        if (rates && rates[i] == null) t += ' · no rate at this grid';
      }
      note.textContent = t;
    }
    var chk = M.checkSplit(s.split, mm.min, mm.max, mm.valid), tot = $('prf-iv-total');
    tot.textContent = chk.sum === 100 ? '100% placed' : chk.sum < 100 ? chk.sum + '% placed, ' + (100 - chk.sum) + '% to go' : chk.sum + '% placed, ' + (chk.sum - 100) + '% over';
    tot.classList.toggle('is-bad', chk.sum !== 100);
    /* tabs */
    $('prf-tabs').hidden = !S.B;
    $('prf-tab-a').classList.toggle('is-on', S.on === 'A'); $('prf-tab-a').setAttribute('aria-pressed', S.on === 'A' ? 'true' : 'false');
    $('prf-tab-b').classList.toggle('is-on', S.on === 'B'); $('prf-tab-b').setAttribute('aria-pressed', S.on === 'B' ? 'true' : 'false');
    $('prf-addb').hidden = !!S.B;
    $('prf-setup-h').textContent = S.B ? 'Setup ' + S.on : 'Your policy';
  }
  function rebalance(s) {
    var mm = minmax(), ev = M.evenSplit(s.split.map(function (p) { return p > 0; }), mm.min, mm.max);
    if (ev) s.split = ev;
  }
  function toggleIv(i, on) {
    var s = cur(), mm = minmax();
    if (on) {
      if (!mm.valid[i] || (i > 0 && s.split[i - 1] > 0) || (i < N - 1 && s.split[i + 1] > 0)) return;
      s.split[i] = mm.min[i] || 10;
    } else s.split[i] = 0;
    if (s.even) rebalance(s);
    render();
  }
  function setPct(i, v) {
    var s = cur();
    v = Math.max(0, Math.min(100, Math.round(+v) || 0));
    if (s.split[i] === v) return;
    s.split[i] = v; s.even = false;
    render();
  }

  /* ---------------------------------------------------------------- the answer */
  function yearsPhrase(sum) { return sum.years + ' years on record, ' + sum.first + ' to ' + sum.last; }
  function drawAnswer(R) {
    var box = $('prf-answer');
    if (!R.ok) {
      box.innerHTML = '<p class="prf-verdict prf-wait">' + esc(R.why) + '</p>';
      box.classList.add('is-wait');
      return;
    }
    box.classList.remove('is-wait');
    var s = R.sum, p = R.pol, t = p.total, per = t.producer / S.acres;
    var back = t.producer > 0 ? s.avgIndemnity / t.producer : null, backFull = t.premium > 0 ? s.avgIndemnity / t.premium : null;
    var verdict;
    if (s.paidYears === 0) verdict = 'In the ' + yearsPhrase(s) + ', this policy would not have paid once.';
    else verdict = 'In the ' + yearsPhrase(s) + ', this policy would have paid something in ' + s.paidYears
      + ' and paid more than your premium in ' + s.aheadYears + '.';
    var best = s.best && s.best.indemnity > 0 ? usd(s.best.indemnity) + ' <span class="prf-sub">in ' + s.best.year + '</span>' : '—';
    var dry = R.dry ? plural(R.dry.n, 'year', 'years') + ' <span class="prf-sub">' + (R.dry.n > 1 ? R.dry.from + ' to ' + R.dry.to : R.dry.from) + '</span>' : 'none';
    var h = '<p class="prf-verdict">' + verdict + '</p>'
      + '<dl class="prf-figs">'
      + '<div><dt>You pay, a year</dt><dd>' + usd(t.producer) + ' <span class="prf-sub">' + usd2(per) + ' an acre</span></dd></div>'
      + '<div><dt>USDA pays</dt><dd>' + usd(t.subsidy) + ' <span class="prf-sub">' + Math.round(R.subsidy * 100) + '% of the ' + usd(t.premium) + ' premium</span></dd></div>'
      + '<div><dt>Protection</dt><dd>' + usd(t.protection) + ' <span class="prf-sub">' + usd2(p.protectionPerAcre) + ' an acre</span></dd></div>'
      + '<div><dt>Paid in an average year</dt><dd>' + usd(s.avgIndemnity) + ' <span class="prf-sub">all ' + s.years + ' years, the zeros counted</span></dd></div>'
      + '<div><dt>Most in one year</dt><dd>' + best + '</dd></div>'
      + '<div><dt>Longest run with no payment</dt><dd>' + dry + '</dd></div>'
      + '</dl>';
    if (back != null) {
      h += '<p class="prf-back">Over those ' + s.years + ' years the record pays back <b>' + usd2(back) + '</b> for each $1 of premium you pay, and <b>' + usd2(backFull)
        + '</b> for each $1 of the whole premium. The gap is USDA’s share of the bill.</p>';
    }
    h += '<p class="prf-caveat">Every year is priced at ' + meta.crop_year + ' rates and county values, on the rain record USDA publishes for ' + meta.crop_year
      + '. It is not what PRF paid in those years, and it says nothing about next year’s rain. '
      + '<button type="button" class="prf-link" data-jump="prf-not">What this insurance does not do</button></p>';
    box.innerHTML = h;
  }

  /* ---------------------------------------------------------------- the year chart */
  var chartState = null, READ_HINT = '<span class="prf-read-h">Point at a year, or tap one, for its figures.</span>';
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)), m = v / p;
    var steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) if (m <= steps[i]) return steps[i] * p;
    return 10 * p;
  }
  /* R: the setup being edited, drawn as bars. other: the second setup, when
     there is one and it can be priced, drawn as dots. names: ['A','B'] or null. */
  function drawChart(R, other, names) {
    var box = $('prf-chart'), fig = $('prf-chart-fig');
    if (!R.ok) { fig.hidden = true; chartState = null; return; }
    fig.hidden = false;
    var RB = other && other.ok ? other : null;
    var hist = R.hist, hb = RB ? RB.hist : null, n = hist.length;
    /* drawn at the width it is shown at, so the axis type is the same size on a phone as on a desk */
    var W = Math.max(280, Math.round(box.clientWidth || 760)), small = W < 520;
    var H = small ? 210 : 250, L = 44, Rr = 6, T = 12, Bm = 24, pw = W - L - Rr, ph = H - T - Bm, every = small ? 20 : 10;
    var mx = 0;
    hist.forEach(function (h) { if (h.indemnity > mx) mx = h.indemnity; });
    if (hb) hb.forEach(function (h) { if (h.indemnity > mx) mx = h.indemnity; });
    mx = niceMax(Math.max(mx, R.pol.total.producer * 1.15));
    var y = function (v) { return T + ph - (v / mx) * ph; }, bw = pw / n;
    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Payment by year, ' + hist[0].year + ' to ' + hist[n - 1].year + '. The table below holds every figure.">'];
    [0, 0.5, 1].forEach(function (f) {
      var v = mx * f;
      s.push('<line class="prf-grid" x1="' + L + '" x2="' + (W - Rr) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>');
      s.push('<text class="prf-ax" x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + (v >= 1000 ? '$' + (v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'k' : '$' + Math.round(v)) + '</text>');
    });
    hist.forEach(function (h, i) {
      var x = L + i * bw, hh = (h.indemnity / mx) * ph;
      if (h.year % every === 0) s.push('<text class="prf-ax" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + h.year + '</text>');
      if (h.indemnity > 0) s.push('<rect class="prf-bar" data-k="' + i + '" x="' + (x + (small ? 0.5 : 1)).toFixed(1) + '" y="' + (T + ph - Math.max(hh, 1.5)).toFixed(1) + '" width="' + Math.max(bw - (small ? 1 : 2), 1).toFixed(1) + '" height="' + Math.max(hh, 1.5).toFixed(1) + '" rx="1.5"/>');
    });
    if (hb) hb.forEach(function (h, i) {
      s.push('<circle class="prf-dot" cx="' + (L + i * bw + bw / 2).toFixed(1) + '" cy="' + y(h.indemnity).toFixed(1) + '" r="2.6"/>');
    });
    var py = y(R.pol.total.producer);
    s.push('<line class="prf-prem" x1="' + L + '" x2="' + (W - Rr) + '" y1="' + py.toFixed(1) + '" y2="' + py.toFixed(1) + '"/>');
    s.push('<line class="prf-cross" id="prf-cross" x1="0" x2="0" y1="' + T + '" y2="' + (T + ph) + '" visibility="hidden"/>');
    s.push('</svg>');
    box.innerHTML = s.join('');
    $('prf-read').innerHTML = READ_HINT;
    $('prf-legend').innerHTML = '<span class="prf-lg"><i class="prf-sw prf-sw-bar"></i>' + (names ? 'Setup ' + names[0] + ', paid that year' : 'Paid that year') + '</span>'
      + (hb ? '<span class="prf-lg"><i class="prf-sw prf-sw-dot"></i>Setup ' + names[1] + ', paid that year</span>' : '')
      + '<span class="prf-lg"><i class="prf-sw prf-sw-line"></i>Your premium' + (names ? ', setup ' + names[0] : '') + ': ' + usd(R.pol.total.producer) + ' a year</span>';
    chartState = { hist: hist, hb: hb, L: L, pw: pw, W: W, R: R, RB: RB, names: names, args: [R, other, names] };
  }
  function tipFor(k) {
    var c = chartState, h = c.hist[k], b = c.hb ? c.hb[k] : null;
    function lines(hh, R, tag) {
      return '<span class="prf-read-l">' + (tag ? '<b>' + tag + '</b> ' : '') + 'paid <b>' + usd(hh.indemnity) + '</b>, ' + signed(hh.net) + ' after premium'
        + ' <span class="prf-read-s">(' + hh.cells.map(function (cl) { return nw(LABELS[cl.i] + ' index ' + pctOfNormal(cl.index)) + ', ' + usd(cl.paid); }).join('; ') + ')</span></span>';
    }
    return '<b class="prf-read-y">' + h.year + '</b> ' + lines(h, c.R, c.names ? c.names[0] : '') + (b ? lines(b, c.RB, c.names[1]) : '');
  }
  function chartMove(ev) {
    var c = chartState, box = $('prf-chart'); if (!c) return;
    var svg = box.querySelector('svg'); if (!svg) return;
    var r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * c.W;
    var k = Math.floor((x - c.L) / (c.pw / c.hist.length));
    if (k < 0 || k >= c.hist.length) return;
    var cx = c.L + (k + 0.5) * (c.pw / c.hist.length), cross = $('prf-cross');
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    Array.prototype.forEach.call(svg.querySelectorAll('.prf-bar.is-hot'), function (b) { b.classList.remove('is-hot'); });
    var bar = svg.querySelector('.prf-bar[data-k="' + k + '"]'); if (bar) bar.classList.add('is-hot');
    $('prf-read').innerHTML = tipFor(k);
  }
  /* a mouse leaving clears the readout; a finger lifting leaves the year it chose */
  function chartOut(ev) {
    if (ev && ev.pointerType && ev.pointerType !== 'mouse') return;
    var cross = $('prf-cross');
    if (cross) cross.setAttribute('visibility', 'hidden');
    Array.prototype.forEach.call(document.querySelectorAll('.prf-bar.is-hot'), function (b) { b.classList.remove('is-hot'); });
    if ($('prf-read')) $('prf-read').innerHTML = READ_HINT;
  }
  var resizeT = null;
  function chartResize() {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      if (!chartState) return;
      var w = Math.round($('prf-chart').clientWidth);
      if (w && Math.abs(w - chartState.W) > 2) drawChart.apply(null, chartState.args);
    }, 150);
  }

  /* ---------------------------------------------------------------- every year, as a table */
  function drawYears(R) {
    var box = $('prf-years');
    if (!$('prf-years-d').open) { box.innerHTML = ''; return; }
    if (!R.ok) { box.innerHTML = '<p class="prf-fine">' + esc(R.why) + '</p>'; return; }
    var used = R.pol.rows.filter(function (r) { return r.pct > 0; });
    /* the totals come first so they stay on a phone's screen; the intervals scroll */
    var h = '<div class="prf-scroll"><table class="prf-t"><thead><tr><th scope="col">Year</th><th scope="col">Paid</th><th scope="col">After premium</th>'
      + used.map(function (r) { return '<th scope="col" colspan="2">' + nw(LABELS[r.i]) + ' <span class="prf-th-s">' + r.pct + '%</span></th>'; }).join('')
      + '</tr><tr class="prf-t-sub"><th></th><th></th><th></th>' + used.map(function () { return '<th scope="col">index</th><th scope="col">paid</th>'; }).join('') + '</tr></thead><tbody>';
    function row(hh, openYear) {
      var whole = hh.complete;
      return '<tr' + (openYear ? ' class="is-open"' : '') + '><th scope="row">' + hh.year + (openYear ? ' <span class="prf-th-s">' + (whole ? 'not in totals' : 'so far') + '</span>' : '') + '</th>'
        + '<td>' + (whole ? usd(hh.indemnity) : DASH) + '</td><td class="' + (whole && hh.net > 0 ? 'is-up' : '') + '">' + (whole ? signed(hh.net) : DASH) + '</td>'
        + hh.cells.map(function (c) { return '<td>' + pctOfNormal(c.index) + '</td><td>' + (c.paid == null ? DASH : usd(c.paid)) + '</td>'; }).join('') + '</tr>';
    }
    R.open.slice().reverse().forEach(function (hh) { h += row(hh, true); });
    R.hist.slice().reverse().forEach(function (hh) { h += row(hh, false); });
    h += '</tbody></table></div>';
    if (R.open.length) h += '<p class="prf-fine">' + R.open.map(function (o) { return o.year; }).join(', ') + ' is listed and not counted: the figures above stop at ' + meta.years.last_complete
      + ', so every setup is judged on the same years. A dash is an interval USDA has not published yet. These are the ' + meta.crop_year + ' record\u2019s figures and may differ from the index a ' + R.open[0].year + ' policy is paid on.</p>';
    h += '<p class="prf-fine">Index is rain in the grid as a percent of its ' + meta.years.first + ' to ' + meta.years.last_complete + ' average for those two months. Below ' + R.setup.cov + ' it pays.</p>';
    box.innerHTML = h;
  }
  function csv(R) {
    var used = R.pol.rows.filter(function (r) { return r.pct > 0; });
    var out = [['year'].concat(used.reduce(function (a, r) { return a.concat([LABELS[r.i] + ' index', LABELS[r.i] + ' paid']); }, []), ['paid', 'producer premium', 'after premium'])];
    R.hist.forEach(function (h) {
      out.push([h.year].concat(h.cells.reduce(function (a, c) { return a.concat([pctOfNormal(c.index), c.paid]); }, []), [h.indemnity, R.pol.total.producer, h.net]));
    });
    var c = county(), head = '# AGSIST agsist.com/prf. Grid ' + S.grid + ', ' + c.n + ' County ' + S.st + ', ' + states[S.st].combos[S.use] + ', ' + R.setup.cov + '% coverage, productivity ' + R.setup.pf
      + ', ' + S.acres + ' acres, share ' + S.share + '%. Crop year ' + meta.crop_year + ' rates on every year. Not what PRF paid in those years.\n';
    var blob = new Blob([head + out.map(function (r) { return r.join(','); }).join('\n') + '\n'], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'prf-grid-' + S.grid + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    track('prf_csv', { grid: S.grid });
  }

  /* ---------------------------------------------------------------- each interval on its own */
  function drawRecord() {
    var box = $('prf-rec');
    if (!$('prf-rec-d').open) { box.innerHTML = ''; return; }
    var g = openGrid(S.grid), s = cur(), mm = minmax();
    if (!g || g.stale) { box.innerHTML = ''; return; }
    var sub = meta.subsidy[String(s.cov)], ny = meta.years.last_complete - meta.years.first + 1;
    var h = '<div class="prf-scroll"><table class="prf-t"><thead><tr><th scope="col">Interval</th><th scope="col">Paid in</th><th scope="col">Lowest index</th><th scope="col">Premium per $100</th><th scope="col">Your share per $100</th><th scope="col">Paid per $100, average year</th></tr></thead><tbody>';
    for (var i = 0; i < N; i++) {
      var r = M.intervalRecord(g.done, i, s.cov, g.rates[s.cov][i]);
      if (!mm.valid[i]) { h += '<tr class="is-off"><th scope="row">' + LABELS[i] + '</th><td colspan="5" class="prf-td-l">not offered in this county</td></tr>'; continue; }
      h += '<tr' + (s.split[i] > 0 ? ' class="is-on"' : '') + '><th scope="row">' + LABELS[i] + '</th>'
        + '<td>' + (r.years ? r.below + ' of ' + r.years : '—') + '</td>'
        + '<td>' + (r.lowest ? pctOfNormal(r.lowest.index) + ' <span class="prf-th-s">' + r.lowest.year + '</span>' : '—') + '</td>'
        + '<td>' + (r.ratePer100 == null ? '—' : usd2(r.ratePer100)) + '</td>'
        + '<td>' + (r.ratePer100 == null ? '—' : usd2(r.ratePer100 * (1 - sub))) + '</td>'
        + '<td>' + (r.costPer100 == null ? '—' : usd2(r.costPer100)) + '</td></tr>';
    }
    h += '</tbody></table></div><p class="prf-fine">At ' + s.cov + '% coverage, per $100 of protection placed in that interval, over the ' + ny + ' years ' + meta.years.first + ' to ' + meta.years.last_complete
      + '. Your share is the premium less USDA’s ' + Math.round(sub * 100) + '%. A dash is a rate USDA does not publish for this grid.</p>';
    box.innerHTML = h;
  }

  /* ---------------------------------------------------------------- A against B */
  function drawCompare(RA, RB) {
    var box = $('prf-cmp'), wrap = $('prf-cmp-wrap');
    wrap.hidden = !S.B;
    if (!S.B) { box.innerHTML = ''; return; }
    function col(R, f) { return R.ok ? f(R) : '—'; }
    function months(st) { return st.split.map(function (p, i) { return p > 0 ? nw(LABELS[i] + ' ' + p + '%') : ''; }).filter(Boolean).join('<br>') || DASH; }
    var rows = [
      ['Coverage, productivity', function (R) { return R.setup.cov + '%, ' + R.setup.pf; }, true],
      ['Months', function (R) { return months(R.setup); }, true],
      ['You pay, a year', function (R) { return usd(R.pol.total.producer); }],
      ['Protection', function (R) { return usd(R.pol.total.protection); }],
      ['Years it paid', function (R) { return R.sum.paidYears + ' of ' + R.sum.years; }],
      ['Years it paid more than the premium', function (R) { return R.sum.aheadYears + ' of ' + R.sum.years; }],
      ['Paid in an average year', function (R) { return usd(R.sum.avgIndemnity); }],
      ['Paid back per $1 you pay', function (R) { return R.pol.total.producer > 0 ? usd2(R.sum.avgIndemnity / R.pol.total.producer) : '—'; }],
      ['Most in one year', function (R) { return R.sum.best && R.sum.best.indemnity > 0 ? usd(R.sum.best.indemnity) + ' (' + R.sum.best.year + ')' : '—'; }],
      ['Longest run with no payment', function (R) { return R.dry ? plural(R.dry.n, 'year', 'years') : 'none'; }]
    ];
    var h = '<div class="prf-scroll"><table class="prf-t prf-t-cmp"><thead><tr><th scope="col"></th><th scope="col">Setup A</th><th scope="col">Setup B</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var a = r[2] ? r[1]({ setup: S.A }) : col(RA, r[1]), b = r[2] ? r[1]({ setup: S.B }) : col(RB, r[1]);
      h += '<tr><th scope="row">' + r[0] + '</th><td>' + a + '</td><td>' + b + '</td></tr>';
    });
    h += '</tbody></table></div>';
    if (!RA.ok) h += '<p class="prf-fine">Setup A: ' + esc(RA.why) + '</p>';
    if (!RB.ok) h += '<p class="prf-fine">Setup B: ' + esc(RB.why) + '</p>';
    if (RA.ok && RB.ok) {
      var d = RA.hist.map(function (ha, i) { return { year: ha.year, a: ha.indemnity, b: RB.hist[i].indemnity, d: ha.indemnity - RB.hist[i].indemnity }; });
      var onlyA = d.filter(function (x) { return x.a > 0 && x.b === 0; }).length, onlyB = d.filter(function (x) { return x.b > 0 && x.a === 0; }).length;
      var top = d.slice().sort(function (x, z) { return Math.abs(z.d) - Math.abs(x.d); }).slice(0, 5).filter(function (x) { return x.d !== 0; });
      h += '<p class="prf-fine">Both setups are run over the same ' + RA.sum.years + ' years. Only A paid in ' + plural(onlyA, 'year', 'years') + '; only B paid in ' + plural(onlyB, 'year', 'years') + '.'
        + (top.length ? ' Furthest apart: ' + top.map(function (x) { return x.year + ' (A ' + usd(x.a) + ', B ' + usd(x.b) + ')'; }).join('; ') + '.' : '') + '</p>';
    }
    box.innerHTML = h;
  }

  /* ---------------------------------------------------------------- the grids next door */
  function drawNeighbors() {
    var box = $('prf-nb');
    if (!$('prf-nb-d').open) { box.innerHTML = ''; return; }
    var c = county(), rc = M.gridRowCol(S.grid), s = cur(), ids = [], want = {};
    for (var dr = 1; dr >= -1; dr--) for (var dc = -1; dc <= 1; dc++) {
      var r = rc.row + dr, cc = rc.col + dc;
      if (r < 0 || cc < 0 || r >= 120 || cc >= 300) { ids.push(null); continue; }
      var id = r * 300 + cc + 1; ids.push(id);
      if (c.g.indexOf(id) >= 0) want[M.shardKey(id)] = 1;
    }
    var grid = S.grid, co = S.co, tag = setupStr(s) + S.use + S.acres + S.share;
    box.innerHTML = '<p class="prf-fine">Reading the grids next door…</p>';
    Promise.all(Object.keys(want).map(loadShard)).then(function () {
      if (grid !== S.grid || co !== S.co || tag !== setupStr(cur()) + S.use + S.acres + S.share || !$('prf-nb-d').open) return;
      var h = '<div class="prf-nb-g">', shown = 0;
      ids.forEach(function (id) {
        if (id == null) { h += '<div class="prf-nb-c is-out"></div>'; return; }
        if (c.g.indexOf(id) < 0) { h += '<div class="prf-nb-c is-out"><span class="prf-nb-id">' + id + '</span><span class="prf-nb-x">not in ' + esc(c.n) + ' County</span></div>'; return; }
        var keepG = S.grid; S.grid = id;
        var R = compute(s); S.grid = keepG;
        shown++;
        h += '<' + (id === grid ? 'div' : 'button type="button" data-grid="' + id + '" data-county="' + stateFips() + S.co + '"') + ' class="prf-nb-c' + (id === grid ? ' is-here' : '') + '">'
          + '<span class="prf-nb-id">' + id + (id === grid ? ' · yours' : '') + '</span>'
          + (R.ok ? '<span class="prf-nb-v">' + usd(R.sum.avgIndemnity) + '</span><span class="prf-nb-x">a year on average · paid ' + R.sum.paidYears + ' of ' + R.sum.years + ' · you pay ' + usd(R.pol.total.producer) + '</span>'
                  : '<span class="prf-nb-x">' + esc(R.why) + '</span>')
          + '</' + (id === grid ? 'div' : 'button') + '>';
      });
      h += '</div><p class="prf-fine">The same policy on each grid’s own rain record and rates, ' + c.n + ' County values. North is up. Land that runs across a grid line can be insured in either grid or split between them; your agent can say which applies.</p>';
      box.innerHTML = shown > 1 ? h : '<p class="prf-fine">Grid ' + grid + ' is the only grid in ' + esc(c.n) + ' County with PRF offers next to itself.</p>';
    }).catch(function () { box.innerHTML = '<p class="prf-fine">The neighboring grids did not load. Try again.</p>'; });
  }

  /* ---------------------------------------------------------------- the pinned line */
  var answerSeen = true;
  function drawBar(R) {
    var bar = $('prf-bar');
    if (R) {
      bar.setAttribute('data-ok', R.ok ? '1' : '0');
      bar.innerHTML = R.ok
        ? 'You pay <b>' + usd(R.pol.total.producer) + '</b> \u00b7 paid <b>' + R.sum.paidYears + ' of ' + R.sum.years + '</b> yrs \u00b7 avg <b>' + usd(R.sum.avgIndemnity) + '</b>'
        : esc(R.why);
    }
    var nav = document.querySelector('.nav');
    bar.style.top = Math.max(0, nav ? nav.getBoundingClientRect().bottom : 0) + 'px';
    bar.hidden = answerSeen || !S.grid || $('prf-tool').hidden;
  }
  /* Measured on scroll rather than observed: the answer card is "seen" while
     any of it is between the site header and the bottom of the screen. */
  function watchAnswer() {
    var queued = false;
    function look() {
      queued = false;
      var nav = document.querySelector('.nav'), top = nav ? nav.getBoundingClientRect().bottom : 0;
      var r = $('prf-answer').getBoundingClientRect();
      var seen = r.bottom > top + 8 && r.top < window.innerHeight;
      if (seen !== answerSeen || !seen) { answerSeen = seen; drawBar(null); }
    }
    function ask() { if (!queued) { queued = true; (window.requestAnimationFrame || setTimeout)(look); } }
    window.addEventListener('scroll', ask, { passive: true });
    window.addEventListener('resize', ask);
  }

  /* ---------------------------------------------------------------- draw everything */
  var lastR = null;
  function render() {
    if (!S.grid || !county()) return;
    syncControls();
    var RA = compute(S.A), RB = S.B ? compute(S.B) : null, onB = S.on === 'B' && !!RB, R = onB ? RB : RA;
    lastR = R;
    drawAnswer(R);
    drawChart(R, S.B ? (onB ? RA : RB) : null, S.B ? (onB ? ['B', 'A'] : ['A', 'B']) : null);
    drawYears(R); drawRecord(); drawCompare(RA, RB); drawNeighbors();
    $('prf-acts').hidden = !R.ok;
    /* the policy in one line, for the printed sheet (the controls do not print) */
    var c0 = county();
    $('prf-printsum').textContent = states[S.st].combos[S.use] + ' \u00b7 ' + S.acres.toLocaleString('en-US') + ' acres \u00b7 share ' + S.share + '% \u00b7 coverage ' + R.setup.cov + '% \u00b7 productivity factor ' + R.setup.pf
      + ' \u00b7 ' + (R.setup.split.map(function (p, i) { return p > 0 ? LABELS[i] + ' ' + p + '%' : ''; }).filter(Boolean).join(', ') || 'no months picked')
      + ' \u00b7 ' + c0.n + ' County, ' + S.st + ' \u00b7 crop year ' + meta.crop_year + ' \u00b7 agsist.com/prf';
    drawBar(R);
    $('prf-answer-h').textContent = S.B ? 'Setup ' + S.on + ': what the record says' : 'What the record says';
    remember();
  }

  /* ---------------------------------------------------------------- wiring */
  function wire() {
    $('prf-find').addEventListener('submit', function (e) { e.preventDefault(); find($('prf-q').value); });
    $('prf-loc').addEventListener('click', function () {
      if (!navigator.geolocation) { say('This browser will not share a location. Type a ZIP.', true); return; }
      say('Asking the browser for your location…');
      navigator.geolocation.getCurrentPosition(function (p) { atPoint(p.coords.latitude, p.coords.longitude, 'your location', null); },
        function () { say('The browser did not share a location. Type a ZIP, or pick by state and county.', true); }, { timeout: 12000, maximumAge: 600000 });
    });
    $('prf-eg').addEventListener('click', function () { goGrid(30454, { county: '55005' }); });
    $('prf-b-st').addEventListener('change', fillBrowseCounties);
    $('prf-b-co').addEventListener('change', fillBrowseGrids);
    root.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-grid]') : null;
      if (t && !t.closest('#prf-map')) { goGrid(+t.getAttribute('data-grid'), { county: t.getAttribute('data-county') }, true); return; }
      t = e.target.closest ? e.target.closest('[data-jump]') : null;
      if (t) { var d = $(t.getAttribute('data-jump')); if (d) { d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }
    });
    function mapPick(e) {
      var t = e.target.closest ? e.target.closest('[data-grid]') : null;
      if (!t) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      goGrid(+t.getAttribute('data-grid'), { county: stateFips() + S.co }, false);
    }
    $('prf-map').addEventListener('click', mapPick);
    $('prf-map').addEventListener('keydown', mapPick);
    $('prf-co').addEventListener('change', function () {
      var v = this.value; S.st = stateByFips(v.slice(0, 2)).st; S.co = v.slice(2); afterGrid();
    });
    $('prf-use').addEventListener('change', function () { S.use = +this.value; ['A', 'B'].forEach(function (k) { if (S[k]) fit(S[k]); }); render(); });
    $('prf-acres').addEventListener('input', function () { var v = Math.round(+this.value); S.acres = v > 0 && v <= 5000000 ? v : 0; render(); });
    $('prf-share').addEventListener('input', function () { var v = Math.round(+this.value); S.share = v >= 1 && v <= 100 ? v : 100; render(); });
    $('prf-pf').addEventListener('input', function () { cur().pf = +this.value; render(); });
    $('prf-pf-n').addEventListener('input', function () { var v = Math.round(+this.value); if (v >= 60 && v <= 150) { cur().pf = v; render(); } });
    $('prf-pf-n').addEventListener('blur', function () { this.value = cur().pf; });
    $('prf-cov').addEventListener('click', function (e) { var b = e.target.closest ? e.target.closest('[data-cov]') : null; if (b) { cur().cov = +b.getAttribute('data-cov'); render(); } });
    var body = $('prf-iv-body');
    body.addEventListener('change', function (e) {
      var t = e.target;
      if (t.hasAttribute('data-iv-on')) toggleIv(+t.getAttribute('data-iv-on'), t.checked);
    });
    /* A percent being typed: an empty box or a zero is a number half typed,
       not "turn this month off". The month goes off when the box is left that way. */
    body.addEventListener('input', function (e) {
      var t = e.target; if (!t.hasAttribute('data-iv-pct')) return;
      var v = Math.round(+t.value);
      if (t.value === '' || !(v > 0)) return;
      setPct(+t.getAttribute('data-iv-pct'), v);
    });
    body.addEventListener('focusout', function (e) {
      var t = e.target; if (!t.hasAttribute || !t.hasAttribute('data-iv-pct')) return;
      var i = +t.getAttribute('data-iv-pct'), v = Math.round(+t.value);
      if (t.value === '' || !(v > 0)) { if (cur().split[i] > 0) { cur().split[i] = 0; if (cur().even) rebalance(cur()); render(); } return; }
      t.value = cur().split[i] || '';
    });
    body.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-iv-step]') : null; if (!b) return;
      var i = +b.getAttribute('data-i'), s = cur(), mm = minmax(), v = s.split[i] + +b.getAttribute('data-iv-step');
      v = Math.max(mm.min[i] || 10, Math.min(mm.max[i] || 100, v));
      var inp = body.querySelector('[data-iv-pct="' + i + '"]'); if (inp) inp.value = v;
      setPct(i, v);
    });
    $('prf-even').addEventListener('click', function () { var s = cur(); s.even = true; rebalance(s); render(); });
    $('prf-clear').addEventListener('click', function () { var s = cur(); s.split = blank(); s.even = true; render(); });
    $('prf-addb').addEventListener('click', function () { S.B = { cov: S.A.cov, pf: S.A.pf, split: S.A.split.slice(), even: S.A.even }; S.on = 'B'; render(); track('prf_compare', {}); $('prf-setup-h').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    $('prf-tab-a').addEventListener('click', function () { S.on = 'A'; render(); });
    $('prf-tab-b').addEventListener('click', function () { S.on = 'B'; render(); });
    $('prf-dropb').addEventListener('click', function () { S.B = null; S.on = 'A'; render(); });
    ['prf-years-d', 'prf-rec-d', 'prf-nb-d'].forEach(function (id) { $(id).addEventListener('toggle', render); });
    watchAnswer();
    var ch = $('prf-chart');
    ch.addEventListener('pointermove', chartMove); ch.addEventListener('pointerdown', chartMove); ch.addEventListener('pointerleave', chartOut);
    window.addEventListener('resize', chartResize);
    $('prf-csv').addEventListener('click', function () { if (lastR && lastR.ok) csv(lastR); });
    $('prf-print').addEventListener('click', function () { $('prf-years-d').open = true; render(); window.print(); });
    $('prf-share-b').addEventListener('click', function () {
      var u = shareUrl(), b = this, done = function () { b.textContent = 'Link copied'; setTimeout(function () { b.textContent = 'Copy a link to this'; }, 2200); };
      track('prf_share', { grid: S.grid });
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(done, function () { window.prompt('Copy this link', u); });
      else window.prompt('Copy this link', u);
    });
  }

  function start() {
    var st = $('prf-status');
    getJSON(SRC + 'meta.json').then(function (m) {
      meta = m;
      if (!meta || !meta.states || !meta.years || !meta.subsidy) throw new Error('meta');
      $('prf-b-st').innerHTML = '<option value="">Pick a state</option>' + meta.states.map(function (s) { return '<option value="' + s.st + '">' + esc(s.name) + '</option>'; }).join('');
      wire();
      st.hidden = true;
      $('prf-app').hidden = false;
      var o = saved();
      if (o && o.g) {
        var a = parseSetup(o.a), b = parseSetup(o.b);
        if (a) S.A = a;
        if (b) S.B = b;
        if (o.u != null && +o.u >= 0 && +o.u < 7) S.use = +o.u;
        if (+o.ac > 0) S.acres = Math.round(+o.ac);
        if (+o.sh >= 1 && +o.sh <= 100) S.share = Math.round(+o.sh);
        var pt = o.pt && isFinite(o.pt.lat) && isFinite(o.pt.lon) ? o.pt : null;
        goGrid(+o.g, { county: o.c, pt: pt });
      }
    }).catch(function () {
      st.textContent = 'The rain record did not load, so the calculator is off. Reload the page, or try again in a few minutes. The rules and dates below do not need it.';
      st.classList.add('is-bad');
    });
  }
  window.AgPrf = { state: S, compute: compute, find: find, goGrid: goGrid, shareUrl: shareUrl };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
