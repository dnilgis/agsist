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
  function half(x, places) { var f = Math.pow(10, places); return Math.floor(Math.abs(x) * f + 0.5 + 1e-7) / f * (x < 0 ? -1 : 1); }
  function usd2(v) { if (v == null || !isFinite(v)) return '—'; v = half(v, 2); return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function signed(v) { if (v == null || !isFinite(v)) return '—'; var n = Math.round(v); return (n > 0 ? '+' : n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US'); }
  function pctOfNormal(v) { return v == null ? '—' : half(v * 100, 1).toFixed(1); }
  var DASH = '\u2014';
  function nw(t) { return '<span class="prf-nw">' + t + '</span>'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function track(name, p) { try { if (typeof window.gtag === 'function') window.gtag('event', name, p || {}); } catch (e) {} }
  /* inches from the tenths of a millimetre USDA's average is stored in */
  function inches(mm) { return mm == null || !isFinite(mm) ? null : mm / 25.4; }
  function inTxt(mm) { var v = inches(mm); return v == null ? DASH : v.toFixed(v < 10 ? 2 : 1) + ' in'; }
  /* a per-$100 figure less a whole-percent share, in whole cents, halves up (5.355 is $5.36, not the $5.35 a float gives) */
  function lessPct(per100, pct) { var c = Math.round(per100 * 100) * (100 - pct); return Math.floor(c / 100 + 0.5) / 100; }

  /* ---------------------------------------------------------------- data */
  var meta = null, states = {}, shards = {}, cells = {}, inflight = {};
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
  /* The complete years the totals run over: all of them, or the last S.win. */
  function windowed(done) {
    if (!S.win) return done;
    var out = {}, from = meta.years.last_complete - S.win + 1;
    Object.keys(done).forEach(function (y) { if (+y >= from) out[y] = done[y]; });
    return out;
  }
  /* Which county a point is in (data/prf/c/, scripts/build_prf_county_cells.mjs).
     Resolves to a five-digit county code, or null when the point is within a
     cell of a county line, off the map, or the file did not load. null means
     ASK THE READER. It never means "take the first county listed". */
  function cellFile(key) {
    return cells[key] ? Promise.resolve(cells[key]) : getJSON(SRC + 'c/' + key + '.json', true).then(function (d) { cells[key] = d || { g: {} }; return cells[key]; });
  }
  /* A grid opened with no point and no county (a link with only ?g=, a grid ID
     typed in): the county that holds the most of the grid's cells, so the
     page opens on figures and says how it chose. null on a tie, a county with
     no PRF offers, or a file that did not load: then the page asks. */
  function countyMost(id, offered) {
    return cellFile(M.shardKey(id)).then(function (d) {
      var rec = d.g && d.g[String(id)];
      if (!rec || !rec.m) return null;
      var n = {}, best = null, second = 0;
      rec.m.replace(/([a-z?\-])(\d+)/g, function (_, ch, k) { if (ch !== '?' && ch !== '-') n[ch] = (n[ch] || 0) + +k; return ''; });
      Object.keys(n).forEach(function (ch) {
        if (!best || n[ch] > n[best]) { if (best) second = Math.max(second, n[best]); best = ch; } else second = Math.max(second, n[ch]);
      });
      if (!best || n[best] === second) return null;
      var code = rec.c[best.charCodeAt(0) - 97];
      return code && offered.indexOf(code) >= 0 ? code : null;
    }).catch(function () { return null; });
  }
  function countyAtPoint(id, lat, lon) {
    var key = M.shardKey(id);
    var got = cellFile(key);
    return got.then(function (d) {
      var rec = d.g && d.g[String(id)], n = d.n, b = M.gridBounds(id);
      if (!rec || !n || !b) return null;
      var r = Math.min(n - 1, Math.max(0, Math.floor((lat - b.south) / (0.25 / n)))), c = Math.min(n - 1, Math.max(0, Math.floor((lon - b.west) / (0.25 / n))));
      var want = r * n + c, at = 0, hit = null;
      rec.m.replace(/([a-z?\-])(\d+)/g, function (_, ch, k) { if (hit == null && want < at + +k) hit = ch; at += +k; return ''; });
      if (hit == null || hit === '?' || hit === '-') return null;
      return rec.c[hit.charCodeAt(0) - 97] || null;
    }).catch(function () { return null; });
  }

  /* ---------------------------------------------------------------- state */
  function blank() { var a = []; for (var i = 0; i < N; i++) a.push(0); return a; }
  /* touched: the reader has changed the policy. Until then the card says it is showing the page's example.
     win: 0 for every complete year, else the last 30, 20 or 10. alt: a five-digit entry that is also a grid ID. */
  var S = { grid: null, st: null, co: null, pt: null, use: 0, acres: 100, share: 100, win: 0, touched: false, alt: null, lost: false,
            A: { cov: 90, pf: 100, split: blank(), even: true }, B: null, on: 'A' };
  var WINDOWS = [0, 30, 20, 10];
  function cur() { return S[S.on] || S.A; }
  function county() { return S.st && states[S.st] && S.co ? states[S.st].counties[S.co] : null; }
  function limits() { var c = county(); if (!c) return null; return c.lim || (c.limc || {})[String(S.use)] || null; }
  /* irrigated hay worth less than non-irrigated in this county: say so, with no guessed reason */
  function irrNote() {
    var c = county(), names = states[S.st].combos, o = c && c.bg && c.bg[String(S.grid)];
    if (!c) return '';
    var vals = names.map(function (n, i) { return o && o[String(i)] != null ? o[String(i)] : c.b[i]; });
    var lo = M.irrigatedLower(names, vals, S.use);
    return lo ? ' USDA sets irrigated hay lower here: ' + usd2(lo.irr) + ' an acre, against ' + usd2(lo.non) + ' for non-irrigated.' : '';
  }
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
    if (!(S.acres > 0)) { out.why = 'Enter the acres to insure, in whole acres.'; return out; }
    if (!(S.share >= 1 && S.share <= 100)) { out.why = 'Enter your share of the hay or livestock, 1 to 100 percent.'; return out; }
    if (!(setup.pf >= 60 && setup.pf <= 150)) { out.why = 'The productivity factor runs from 60 to 150.'; return out; }
    var rates = g.rates[setup.cov], chk = M.checkSplit(setup.split, mm.min, mm.max, mm.valid);
    out.check = chk; out.rates = rates;
    var msgs = [], room = 0, picked = [];
    for (var k = 0; k < N; k++) if (setup.split[k] > 0 && mm.valid[k]) { room += mm.max[k]; picked.push(LABELS[k] + ' (' + mm.max[k] + '% at most)'); }
    chk.errors.forEach(function (e) {
      if (e.why === 'sum' && e.sum < 100 && picked.length >= 2 && room < 100) msgs.push(picked.join(' and ') + ' cannot reach 100% between them in this county. Add another pair of months.');
      else if (e.why === 'sum') msgs.push(e.sum < 100 ? 'The months add to ' + e.sum + '%. Place ' + (100 - e.sum) + '% more.' : 'The months add to ' + e.sum + '%. Take ' + (e.sum - 100) + '% off.');
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
    var hist = M.history(pol, windowed(g.done)), sum = M.summarize(hist, pol);
    if (!sum.years) { out.why = 'USDA has published no index for these intervals at this grid.'; return out; }
    /* a closed year with no index for a chosen interval is left out of every count, and the card says which */
    out.gaps = hist.filter(function (h) { return !h.complete; }).map(function (h) { return h.year; });
    hist = hist.filter(function (h) { return h.complete; });
    var paid = hist.map(function (h) { return h.indemnity; }).sort(function (a, z) { return a - z; }), nh = paid.length;
    out.mid = nh % 2 ? paid[(nh - 1) / 2] : (paid[nh / 2 - 1] + paid[nh / 2]) / 2;
    var top = 0; hist.forEach(function (h) { if (sum.best && h.indemnity === sum.best.indemnity) top++; });
    out.bestTies = top;
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
    if (S.win) q.push('w=' + S.win);
    return location.origin + '/prf?' + q.join('&');
  }
  function stateFips() { return states[S.st] ? states[S.st].fips : ''; }
  function remember() {
    if (!S.grid || !S.co) return;
    try { history.replaceState(null, '', shareUrl().replace(location.origin, '').replace(/^\/prf\?/, location.pathname + '?')); } catch (e) {}
    try { localStorage.setItem(KEY, JSON.stringify({ g: S.grid, c: stateFips() + S.co, u: S.use, ac: S.acres, sh: S.share, a: setupStr(S.A), b: S.B ? setupStr(S.B) : '', w: S.win, pt: S.pt, t: S.touched ? 1 : 0 })); } catch (e) {}
  }
  /* What to open with: a link's own figures, else what this browser last had.
     fromLink marks a link, whose every unreadable part is reported, not papered over. */
  function saved() {
    var q = {}, had = false;
    location.search.replace(/^\?/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('='); if (i <= 0) return;
      try { q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); had = true; } catch (e) {}
    });
    if (had && (q.g || q.c || q.st)) { q.fromLink = true; return q; }
    try { var o = JSON.parse(localStorage.getItem(KEY) || 'null'); if (o && o.g) return o; } catch (e) {}
    return null;
  }

  /* ---------------------------------------------------------------- choosing a grid */
  /* A search that found nothing leaves the last grid's figures on screen: say whose they are, here and on the pinned line. */
  function stillNote() { var c = county(); return S.grid && c && !$('prf-tool').hidden ? ' The figures below are still for grid ' + S.grid + ', ' + c.n + ' County, ' + S.st + '.' : ''; }
  function missed(msg, html) {
    var note = stillNote();
    if (html != null) sayHtml(html + esc(note), true); else say(msg + note, true);
    if (note) { S.lost = true; drawBar(lastR); }
  }
  function say(msg, bad) { var el = $('prf-find-msg'); el.textContent = msg || ''; el.classList.toggle('is-bad', !!bad); }
  function sayHtml(html, bad) { var el = $('prf-find-msg'); el.innerHTML = html; el.classList.toggle('is-bad', !!bad); }
  function norm(s) {
    return String(s || '').toLowerCase().replace(/\bcounty\b|\bparish\b/g, '').replace(/\bsainte\b/g, 'ste').replace(/\bsaint\b/g, 'st').replace(/[^a-z]/g, '');
  }
  function hasOffers(code) { var s = stateByFips(code.slice(0, 2)); return !!(s && states[s.st] && states[s.st].counties[code.slice(2)]); }
  function countyName(code) { var s = stateByFips(code.slice(0, 2)); return states[s.st].counties[code.slice(2)].n + ' County, ' + s.st; }
  function gridButton(id, text) { return '<button type="button" class="prf-link" data-asgrid="' + id + '">' + esc(text) + '</button>'; }

  /* Every search, tap and late answer takes a ticket. Only the newest one may
     change the page, so a slow file for the grid before last cannot land on
     top of the grid the reader is looking at now. */
  var ticket = 0;

  /* Move to a grid.
     want.county  'SSCCC', when the reader or a link named it
     want.pt      { lat, lon, label, zip } the point that led here
     want.countyName / stateName  what the place lookup said
     The county is taken, in order, from: the one named; the county the point
     is in (data/prf/c); the lookup's own county; the grid's only county. If
     none of those settles it the page ASKS. It does not price a guess. */
  function goGrid(id, want, keep) {
    id = +id; want = want || {};
    var my = ++ticket, key = M.shardKey(id);
    if (!key) { say('That is not a grid in the 48 contiguous states.', true); return Promise.resolve(false); }
    say('Reading grid ' + id + '…');
    return loadShard(key).then(function (sh) {
      if (my !== ticket) return false;
      var rec = sh.g && sh.g.g ? sh.g.g[String(id)] : null;
      if (!rec) { say('USDA offers no PRF grid there. Grids cover the 48 contiguous states; Hawaii is a separate program and is not on this page.', true); return false; }
      var codes = rec.c || [], sts = {};
      codes.forEach(function (c) { var s = stateByFips(c.slice(0, 2)); if (s) sts[s.st] = 1; });
      return Promise.all(Object.keys(sts).map(loadState)).then(function () {
        var offered = codes.filter(hasOffers);
        if (!offered.length) { if (my === ticket) say('Grid ' + id + ' has no county with PRF offers in the data.', true); return false; }
        var named = want.county && offered.indexOf(want.county) >= 0 ? want.county : null;
        var byPoint = !named && want.pt && offered.length > 1 ? countyAtPoint(id, want.pt.lat, want.pt.lon) : Promise.resolve(null);
        return byPoint.then(function (cell) {
          if (my !== ticket) return false;
          var pick = named, how = named ? 'named' : '';
          if (!pick && cell && offered.indexOf(cell) >= 0) { pick = cell; how = 'point'; }
          if (!pick && want.countyName) {
            offered.forEach(function (c) {
              var s = stateByFips(c.slice(0, 2)), d = states[s.st], co = d.counties[c.slice(2)];
              if (!pick && norm(co.n) === norm(want.countyName) && (!want.stateName || norm(d.name) === norm(want.stateName))) { pick = c; how = 'lookup'; }
            });
          }
          if (!pick && offered.length === 1) { pick = offered[0]; how = 'only'; }
          /* no point to place: open on the county with the most of the grid, and say so. A point
             near a county line still asks, because there the reader's land settles it. */
          var most = !pick && !want.pt ? countyMost(id, offered) : Promise.resolve(null);
          return most.then(function (m) {
          if (my !== ticket) return false;
          if (!pick && m) { pick = m; how = 'most'; }
          S.grid = id; S.lost = false; S.codes = offered; S.coHow = how; $('prf-tool').classList.remove('is-stale');
          S.st = stateByFips((pick || offered[0]).slice(0, 2)).st;
          S.co = pick ? pick.slice(2) : null;
          if (!keep) S.pt = want.pt || null;
          S.alt = want.alt || null;
          afterGrid();
          say('');
          return true;
          });
        });
      });
    }).catch(function () { if (my === ticket) say('The data for that grid did not load. Check the connection and try again.', true); return false; });
  }

  /* After the grid or county changes: the use must be one the county offers,
     and each setup's split must fit the county's limits. With no county yet,
     only the grid block and the question are shown. */
  function afterGrid() {
    var c = county(), tool = $('prf-tool');
    tool.hidden = false; $('prf-start').hidden = true;
    tool.classList.toggle('is-nocounty', !c);
    drawWhere();
    if (!c) {
      var box = $('prf-answer');
      box.innerHTML = '<p class="prf-verdict prf-wait">Grid ' + S.grid + ' lies across ' + S.codes.length + ' counties, and each has its own dollar values and limits. Pick the county the land is in, under the grid above.</p>';
      box.classList.add('is-wait'); $('prf-notes').innerHTML = ''; $('prf-yrs-p').innerHTML = ''; document.querySelector('.prf-o2').style.minHeight = '';
      $('prf-chart-fig').hidden = true; $('prf-acts').hidden = true; $('prf-cmp-wrap').hidden = true;
      drawBar({ ok: false, why: 'Pick the county the land is in.' });
      track('prf_grid', { grid: S.grid, state: S.st, county_from: 'ask' });
      return;
    }
    if (c.b[S.use] == null) { for (var i = 0; i < c.b.length; i++) if (c.b[i] != null) { S.use = i; break; } }
    ['A', 'B'].forEach(function (k) { if (S[k]) fit(S[k]); });
    buildUse(); buildIv(); render();
    track('prf_grid', { grid: S.grid, state: S.st, county_from: S.coHow || 'named' });
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

  /* "Valentine NE", "valentine, nebraska", "Las Cruces New Mexico": the state, when one ends the entry. */
  function splitState(q) {
    var name = q, st = null, m = /^(.*?)\s*,\s*(.+)$/.exec(q);
    function known(tok) {
      tok = String(tok || '').toLowerCase().replace(/\./g, '').trim();
      for (var i = 0; i < meta.states.length; i++) if (meta.states[i].st.toLowerCase() === tok || meta.states[i].name.toLowerCase() === tok) return meta.states[i];
      return null;
    }
    if (m) { st = known(m[2]); if (st) name = m[1]; }
    else {
      var w = q.split(/\s+/);
      if (w.length >= 3 && known(w.slice(-2).join(' '))) { st = known(w.slice(-2).join(' ')); name = w.slice(0, -2).join(' '); }
      else if (w.length >= 2 && known(w[w.length - 1])) { st = known(w[w.length - 1]); name = w.slice(0, -1).join(' '); }
    }
    return { name: name.trim(), st: st };
  }
  function lookup(name) {
    return fetch(GEO + '?name=' + encodeURIComponent(name) + '&count=10&language=en&format=json&countryCode=US')
      .then(function (r) { if (!r.ok) throw new Error('geo ' + r.status); return r.json(); })
      .then(function (d) { if (!d || d.error) throw new Error('geo'); return d.results || []; });
  }
  function find(q) {
    q = String(q || '').trim();
    if (!q) { say('Type a ZIP, a town and state, coordinates, or a grid ID.', true); return; }
    var m = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(q);
    if (m) {
      var lat = +m[1], lon = +m[2];
      if (lon > 0) lon = -lon;                     /* a US longitude typed without its minus sign */
      track('prf_find', { by: 'coordinates' });
      return atPoint(lat, lon, lat.toFixed(4) + ', ' + lon.toFixed(4), {});
    }
    m = /^grid\s*(?:id)?\s*#?\s*(\d{1,5})$/i.exec(q) || /^(\d{1,4})$/.exec(q);
    if (m) { track('prf_find', { by: 'grid' }); return goGrid(+m[1], {}).then(function (ok) { if (ok) toGrid(); return ok; }); }
    var my = ++ticket, isZip = /^\d{5}$/.test(q), asGrid = isZip && M.shardKey(+q) ? +q : null;
    say('Looking that up…');
    track('prf_find', { by: isZip ? 'zip' : 'town' });
    if (isZip) {
      return lookup(q).then(function (res) {
        if (my !== ticket) return false;
        var r = res[0];
        if (!r) {
          missed(null, 'The place lookup has no ZIP ' + esc(q) + '. Type the nearest town and state, or coordinates.' + (asGrid ? ' ' + gridButton(asGrid, 'Open grid ID ' + q) : ''));
          return false;
        }
        var town = r.name + (r.admin1 ? ', ' + r.admin1 : '');
        return atPoint(r.latitude, r.longitude, town, { countyName: r.admin2, stateName: r.admin1, alt: asGrid }, q);
      }).catch(function () {
        if (my !== ticket) return false;
        missed(null, 'The place lookup did not answer. Type coordinates, or pick by state and county below.' + (asGrid ? ' ' + gridButton(asGrid, 'Open grid ID ' + q) : ''));
        return false;
      });
    }
    var parts = splitState(q);
    return lookup(parts.name).then(function (res) {
      if (my !== ticket) return false;
      if (parts.st) res = res.filter(function (r) { return norm(r.admin1) === norm(parts.st.name); });
      /* one entry per state and county: the lookup lists a town and its township as two places */
      var seen = {}, uniq = [];
      res.forEach(function (r) { var k = norm(r.admin1) + '|' + norm(r.admin2); if (!seen[k]) { seen[k] = 1; uniq.push(r); } });
      if (!uniq.length) {
        missed(parts.st ? 'No place called “' + parts.name + '” found in ' + parts.st.name + '. Try a ZIP, or coordinates.' : 'No place found for “' + q + '”. Try a town with its state, a ZIP, or coordinates.');
        return false;
      }
      function go(r) { return atPoint(r.latitude, r.longitude, r.name + (r.admin1 ? ', ' + r.admin1 : ''), { countyName: r.admin2, stateName: r.admin1 }); }
      if (uniq.length === 1) return go(uniq[0]);
      choices = uniq.slice(0, 8);
      $('prf-tool').classList.add('is-stale');
      sayHtml('More than one “' + esc(parts.name) + '”. Pick yours: ' + choices.map(function (r, i) {
        return '<button type="button" class="prf-chip" data-choice="' + i + '">' + esc((r.admin2 ? r.admin2 + ', ' : '') + (r.admin1 || '')) + '</button>';
      }).join(' '));
      choiceGo = go;
      return false;
    }).catch(function () {
      if (my !== ticket) return false;
      missed('The place lookup did not answer. Type coordinates, or pick by state and county below.');
      return false;
    });
  }
  var choices = [], choiceGo = null;
  /* on one column the answer sits below the fold of the search box: bring the grid to the top */
  function motion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'; } catch (e) { return 'smooth'; } }
  function toGrid() {
    if (window.innerWidth < 980) {
      /* one column: the grid card just under the site header, unless that leaves the
         answer's first figures under the fold; then scroll on until they show */
      var nav = document.querySelector('.nav'), top = nav ? Math.max(0, nav.getBoundingClientRect().bottom) : 0, y0 = window.pageYOffset;
      var want = document.querySelector('.prf-o1').getBoundingClientRect().top + y0 - top - 8;
      var fig = document.querySelector('#prf-answer .prf-figs div');
      if (fig) want = Math.max(want, fig.getBoundingClientRect().bottom + y0 - window.innerHeight + 12);
      window.scrollTo(0, Math.max(0, want));
      return;
    }
    /* two columns: the search card to the top, so the answer beside the grid is on the first screen */
    var f = $('prf-find-h'); if (f.getBoundingClientRect().top > 160) f.scrollIntoView({ block: 'start' });
  }
  function atPoint(lat, lon, label, want, zip) {
    var id = M.gridFromLatLon(lat, lon);
    if (!id) { say('That point is outside the 48 contiguous states.', true); return Promise.resolve(false); }
    want = want || {}; want.pt = { lat: +lat, lon: +lon, label: label, zip: zip || null };
    return goGrid(id, want).then(function (ok) { if (ok) toGrid(); return ok; });
  }

  /* ---------------------------------------------------------------- where: the grid, drawn */
  function miles(lat) { return { ns: 0.25 * 69.05, ew: 0.25 * 69.17 * Math.cos(lat * Math.PI / 180) }; }
  function drawWhere() {
    var c = county(), b = M.gridBounds(S.grid), rc = M.gridRowCol(S.grid);
    var mi = miles((b.south + b.north) / 2);
    var inCounty = {}, inState = {};
    if (c) c.g.forEach(function (g) { inCounty[g] = 1; });
    S.codes.forEach(function (code) { var d = states[stateByFips(code.slice(0, 2)).st]; Object.keys(d.counties).forEach(function (k) { d.counties[k].g.forEach(function (g) { inState[g] = 1; }); }); });
    var W = 186, cell = 60, pad = 3, svg = [];
    svg.push('<svg viewBox="0 0 ' + W + ' ' + W + '" role="group" aria-label="Grid ' + S.grid + ' and the eight grids around it. North is up.">');
    for (var dr = 1; dr >= -1; dr--) for (var dc = -1; dc <= 1; dc++) {
      var r = rc.row + dr, cc = rc.col + dc, x = pad + (dc + 1) * cell, y = pad + (1 - dr) * cell;
      if (r < 0 || cc < 0 || r >= 120 || cc >= 300) continue;
      var id = r * 300 + cc + 1, here = dr === 0 && dc === 0;
      var cls = here ? 'is-here' : inCounty[id] ? 'is-county' : inState[id] ? 'is-state' : 'is-out';
      svg.push('<g class="prf-cell ' + cls + '"' + (here ? '' : ' data-grid="' + id + '" role="button" tabindex="0" aria-label="Show grid ' + id + (c && inCounty[id] ? ', also in ' + esc(c.n) + ' County' : '') + '"') + '>'
        + '<rect x="' + x + '" y="' + y + '" width="' + (cell - 2) + '" height="' + (cell - 2) + '" rx="3"/>'
        + '<text x="' + (x + cell / 2 - 1) + '" y="' + (y + cell / 2 + 4) + '" text-anchor="middle">' + id + '</text></g>');
    }
    var note = '';
    if (S.pt && M.gridFromLatLon(S.pt.lat, S.pt.lon) === S.grid) {
      var fx = (S.pt.lon - b.west) / 0.25, fy = (b.north - S.pt.lat) / 0.25;
      svg.push('<circle class="prf-pin" cx="' + (pad + cell + fx * (cell - 2)).toFixed(1) + '" cy="' + (pad + cell + fy * (cell - 2)).toFixed(1) + '" r="4"/>');
      var edges = [['north', (b.north - S.pt.lat) / 0.25 * mi.ns], ['south', (S.pt.lat - b.south) / 0.25 * mi.ns],
                   ['east', (b.east - S.pt.lon) / 0.25 * mi.ew], ['west', (S.pt.lon - b.west) / 0.25 * mi.ew]].sort(function (a, z) { return a[1] - z[1]; });
      note = ' The dot is ' + esc(S.pt.label) + (S.pt.zip ? ', the town for ZIP ' + esc(S.pt.zip) : '') + ', about ' + edges[0][1].toFixed(1) + ' miles from the grid’s ' + edges[0][0] + ' edge.'
        + (S.pt.zip ? ' A rural ZIP can cover several grids: if the land is elsewhere, tap its grid or type its coordinates.' : '');
    } else if (S.pt) {
      note = ' You are looking at a grid next to the one ' + esc(S.pt.label) + ' is in. ' + gridButton(M.gridFromLatLon(S.pt.lat, S.pt.lon), 'Back to grid ' + M.gridFromLatLon(S.pt.lat, S.pt.lon));
    }
    svg.push('</svg>');
    $('prf-map').innerHTML = svg.join('');
    $('prf-where-h').textContent = 'Grid ' + S.grid + ' · ' + (c ? c.n + ' County, ' + states[S.st].name : 'pick the county');
    /* where the dot is, and the rural-ZIP warning, stay in view; the edges and the policy rule fold under "Grid edges" */
    var covers = 'Covers ' + b.south.toFixed(2) + '° to ' + b.north.toFixed(2) + '° N, ' + Math.abs(b.east).toFixed(2) + '° to ' + Math.abs(b.west).toFixed(2) + '° W: about '
      + mi.ns.toFixed(0) + ' miles north to south and ' + mi.ew.toFixed(0) + ' east to west.';
    $('prf-where-t').innerHTML = (note ? note.replace(/^ /, '') : covers)
      + (S.alt ? ' ' + esc(String(S.alt)) + ' is also a grid ID. ' + gridButton(S.alt, 'Open grid ' + S.alt + ' instead') + '.' : '');
    $('prf-where-f').innerHTML = (note ? covers + ' ' : '') + 'On a policy, you pick a point inside the acres you insure and the grid and county follow from it. <a href="https://public-rma.fpac.usda.gov/apps/PRF" rel="noopener">USDA’s grid locator</a> is the official map.';
    /* county: a grid can lie in more than one, and the county sets the dollars */
    var sel = $('prf-co'), wrap = $('prf-co-wrap'), codes = S.codes;
    sel.innerHTML = (c ? '' : '<option value="" selected>Pick the county</option>') + codes.map(function (code) {
      var s = stateByFips(code.slice(0, 2)), co = states[s.st].counties[code.slice(2)];
      return '<option value="' + code + '"' + (c && s.st === S.st && code.slice(2) === S.co ? ' selected' : '') + '>' + esc(co.n) + ', ' + s.st + '</option>';
    }).join('');
    wrap.hidden = codes.length < 2;
    wrap.classList.toggle('is-ask', !c);
    $('prf-co-n').textContent = codes.length;
    /* why the county matters is said while the page asks; once the county is known, how it was found is enough */
    $('prf-co-why').hidden = !!c && !!S.coHow && S.coHow !== 'named';
    $('prf-co-how').textContent = !c ? 'This page could not tell which one the point is in.'
      : S.coHow === 'point' ? 'The point is in ' + c.n + ' County, by the Census Bureau’s county lines.'
      : S.coHow === 'lookup' ? c.n + ' County is the place lookup’s county for that town.'
      : S.coHow === 'most' ? 'Opened on ' + c.n + ' County, which holds the largest part of this grid. If your land is in another county, pick it here.' : '';
    /* the browse boxes follow */
    if (c) {
      if ($('prf-b-st').value !== S.st) { $('prf-b-st').value = S.st; fillBrowseCounties().then(function () { $('prf-b-co').value = S.co; fillBrowseGrids(); }); }
      else { $('prf-b-co').value = S.co; fillBrowseGrids(); }
    }
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
  /* The county's grids, laid out where they lie: north at the top, west at the
     left, one box per quarter degree. A row of numbers in ID order said nothing
     about which grid the land is in. */
  function fillBrowseGrids() {
    var st = $('prf-b-st').value, k = $('prf-b-co').value, box = $('prf-b-grids');
    if (!st || !k || !states[st] || !states[st].counties[k]) { box.innerHTML = ''; return; }
    var c = states[st].counties[k], f = states[st].fips, r0 = 1e9, r1 = -1, c0 = 1e9, c1 = -1;
    c.g.forEach(function (g) { var rc = M.gridRowCol(g); if (rc.row < r0) r0 = rc.row; if (rc.row > r1) r1 = rc.row; if (rc.col < c0) c0 = rc.col; if (rc.col > c1) c1 = rc.col; });
    var bn = M.gridBounds(r1 * 300 + c0 + 1), bs = M.gridBounds(r0 * 300 + c1 + 1);
    box.innerHTML = '<p class="prf-b-l">' + plural(c.g.length, 'grid touches', 'grids touch') + ' ' + esc(c.n) + ' County. They are drawn where they lie, north at the top: '
      + bn.north.toFixed(2) + '° N at the top edge, ' + bs.south.toFixed(2) + '° N at the bottom, ' + Math.abs(bn.west).toFixed(2) + '° W at the left, ' + Math.abs(bs.east).toFixed(2) + '° W at the right.</p><p class="prf-b-l" id="prf-b-start">Not sure which? Type the nearest town above.</p>'
      + '<div class="prf-b-scroll"><div class="prf-b-map" style="grid-template-columns:repeat(' + (c1 - c0 + 1) + ',minmax(3.4rem,1fr))">'
      + c.g.map(function (g) {
          var rc = M.gridRowCol(g);
          return '<button type="button" class="prf-chip' + (g === S.grid && st === S.st && k === S.co ? ' is-on' : '') + '" style="grid-row:' + (r1 - rc.row + 1) + ';grid-column:' + (rc.col - c0 + 1) + '" data-grid="' + g + '" data-county="' + f + k + '">' + g + '</button>';
        }).join('') + '</div></div>';
    /* Not sure which? The grid that holds the most of the county, from the county cells (data/prf/c, the
       Census Bureau's county lines). A tie, or a file that did not load, keeps the plain line. (Sig, Oct 20) */
    if (c.g.length > 1) countyBiggest(c.g, f + k).then(function (g) {
      var sp = document.getElementById('prf-b-start');
      if (!g || $('prf-b-co').value !== k || $('prf-b-st').value !== st || !sp) return;
      sp.innerHTML = 'Not sure? Start with grid ' + g + ', which covers most of the county, or type the nearest town above. <button type="button" class="prf-link" data-grid="' + g + '" data-county="' + f + k + '">Open grid ' + g + '</button>';
    });
  }
  /* The grid with the most of a county's cells, or null on a tie or a missing file. */
  function countyBiggest(grids, fips) {
    return Promise.all(grids.map(function (g) {
      return cellFile(M.shardKey(g)).then(function (d) { return M.countyCells(d.g && d.g[String(g)], fips); });
    })).then(function (ns) {
      var at = M.biggest(ns);
      return at < 0 ? null : grids[at];
    }).catch(function () { return null; });
  }

  /* ---------------------------------------------------------------- the setup controls */
  function useName() { return states[S.st].combos[S.use]; }
  function isGrazing() { return /^graz/i.test(useName()); }
  function buildUse() {
    var c = county(), d = states[S.st], sel = $('prf-use');
    sel.innerHTML = d.combos.map(function (name, i) {
      return c.b[i] == null ? '' : '<option value="' + i + '"' + (i === S.use ? ' selected' : '') + '>' + esc(name) + '</option>';
    }).join('');
  }
  function buildIv() {
    var rows = '';
    for (var i = 0; i < N; i++) {
      rows += '<tr data-i="' + i + '"><th scope="row"><label class="prf-ivl"><input type="checkbox" data-iv-on="' + i + '" aria-label="Insure ' + M.LONG[i] + '" aria-describedby="prf-ivn-' + i + '"><span class="prf-ivm">' + LABELS[i] + '</span></label></th>'
        + '<td class="prf-ivp"><button type="button" class="prf-step" data-iv-step="-5" data-i="' + i + '" aria-label="5 percent less in ' + M.LONG[i] + '">−</button>'
        + '<input type="number" inputmode="numeric" min="0" max="100" step="1" data-iv-pct="' + i + '" aria-label="Percent of the policy in ' + M.LONG[i] + '">'
        + '<button type="button" class="prf-step" data-iv-step="5" data-i="' + i + '" aria-label="5 percent more in ' + M.LONG[i] + '">+</button><span class="prf-pc">%</span></td>'
        + '<td class="prf-ivn"><small id="prf-ivn-' + i + '" data-iv-note="' + i + '"></small></td></tr>';
    }
    $('prf-iv-body').innerHTML = rows;
  }
  /* Bring every control into line with the state, without rebuilding the
     inputs (a rebuilt input drops the reader's cursor mid-number). */
  function syncControls() {
    var s = cur(), mm = minmax(), g = openGrid(S.grid);
    $('prf-use').value = String(S.use);
    if (document.activeElement !== $('prf-acres')) $('prf-acres').value = S.acres || '';
    if (document.activeElement !== $('prf-share')) $('prf-share').value = S.share == null ? '' : S.share;
    if (document.activeElement !== $('prf-pf-n')) $('prf-pf-n').value = s.pf;
    if (s.pf >= 60 && s.pf <= 150) $('prf-pf').value = s.pf;
    var cbv = baseValue();
    $('prf-pf-hint').textContent = cbv == null ? '' : 'How much to insure each acre for. 100 is USDA’s county value, ' + usd2(cbv) + ' an acre here for this use. 150 raises the premium and any payment by half. It does not change how often it pays.';
    $('prf-use-note').innerHTML = isGrazing()
      ? 'From 2027, grazing land needs your livestock on it: at least 25% of the stocking rate, or no payment is due and the premium is still owed. <button type="button" class="prf-link" data-jump="new">The rule</button>'
      : 'PRF covers perennial hay ground. Forage planted every year is a different policy, Annual Forage.' + irrNote();
    Array.prototype.forEach.call(document.querySelectorAll('[data-cov]'), function (b) {
      var on = +b.getAttribute('data-cov') === s.cov; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-win]'), function (b) {
      var w = +b.getAttribute('data-win'), on = w === S.win; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.textContent = w ? 'Last ' + w : 'All ' + (meta.years.last_complete - meta.years.first + 1);
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
      var t = '', mm_ = g && g.avgMm ? g.avgMm[i] : null;
      if (!offered) t = 'not offered in this county';
      else if (!on && nb >= 0) t = 'off: overlaps ' + LABELS[nb];
      else {
        t = mm.min[i] + '% to ' + mm.max[i] + '% allowed';
        if (mm_ != null) t += ' · normal ' + inTxt(mm_) + (on ? ', pays under ' + inTxt(mm_ * s.cov / 100) : '');
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
    $('prf-both').hidden = !S.B;
    $('prf-setup-h').textContent = S.B ? 'Describe your pasture, setup ' + S.on : 'Describe your pasture';
    $('prf-pf-sum').textContent = s.pf >= 60 && s.pf <= 150 ? String(s.pf) : '';
    $('prf-setup-sum-t').textContent = county() ? (S.touched ? '' : 'Example policy: ') + (S.B ? 'Setup ' + S.on + ': ' : '') + policyLine(s) : '';
    $('prf-iv-h').textContent = S.B ? 'Months to insure, setup ' + S.on : 'Months to insure';
  }
  function rebalance(s) {
    var mm = minmax(), ev = M.evenSplit(s.split.map(function (p) { return p > 0; }), mm.min, mm.max);
    if (ev) s.split = ev;
    return !!ev;
  }
  /* Clear can be undone until the next edit, or for eight seconds */
  var undo = null, undoT = null;
  function dropUndo() { undo = null; clearTimeout(undoT); var b = $('prf-clear'); if (b) b.textContent = 'Clear'; }
  function toggleIv(i, on) {
    dropUndo();
    var s = cur(), mm = minmax();
    if (on) {
      if (!mm.valid[i] || (i > 0 && s.split[i - 1] > 0) || (i < N - 1 && s.split[i + 1] > 0)) return;
      s.split[i] = mm.min[i] || 10;
    } else s.split[i] = 0;
    if (s.even) rebalance(s);
    S.touched = true;
    render();
  }
  function setPct(i, v) {
    var s = cur(); dropUndo();
    v = Math.max(0, Math.min(100, Math.round(+v) || 0));
    if (s.split[i] === v) return;
    s.split[i] = v; s.even = false; S.touched = true;
    render();
  }

  function sameYears(a, b) { return a.length === b.length && a.every(function (h, i) { return h.year === b[i].year; }); }
  /* ---------------------------------------------------------------- the answer */
  function yearsPhrase(sum) {
    var all = meta.years.last_complete - meta.years.first + 1;
    return (S.win && S.win < all ? 'last ' + S.win + ' years on record, ' : sum.years + ' years on record, ') + sum.first + ' to ' + sum.last;
  }
  function splitWords(setup) { return setup.split.map(function (p, i) { return p > 0 ? LABELS[i] + ' ' + p + '%' : ''; }).filter(Boolean).join(', ') || 'no months picked'; }
  function policyLine(setup) {
    var c = county();
    return useName() + ' · ' + (S.acres || 0).toLocaleString('en-US') + ' acres · ' + (S.share === 100 ? '' : 'share ' + S.share + '% · ') + setup.cov + '% coverage · '
      + (setup.pf === 100 ? '' : 'productivity factor ' + setup.pf + ' · ') + splitWords(setup) + ' · ' + c.n + ' County, ' + S.st + ' · grid ' + S.grid;
  }
  var SOD = { IA: 1, MN: 1, MT: 1, NE: 1, ND: 1, SD: 1 };
  function drawAnswer(R) {
    var box = $('prf-answer'), line = $('prf-printsum');
    line.innerHTML = (S.touched ? '' : '<span class="prf-noprint"><b>Example policy.</b> Change it in step 2. </span>') + esc(policyLine(R.setup)) + '<span class="prf-printonly"> · crop year ' + meta.crop_year + ' · agsist.com/prf</span>';
    if (!R.ok) {
      box.innerHTML = '<p class="prf-verdict prf-wait">' + esc(R.why) + '</p>';
      box.classList.add('is-wait');
      $('prf-notes').innerHTML = '';
      return;
    }
    box.classList.remove('is-wait');
    var s = R.sum, p = R.pol, t = p.total, per = t.producer / S.acres;
    var backFull = t.premium > 0 ? s.avgIndemnity / t.premium : null;
    var verdict;
    if (s.paidYears === 0) verdict = 'In the ' + yearsPhrase(s) + ', this policy would not have paid once.';
    else verdict = 'In the ' + yearsPhrase(s) + ', this policy would have paid something in ' + s.paidYears
      + ' and more than your premium in ' + s.aheadYears + '.';
    if (R.gaps && R.gaps.length) verdict += ' ' + R.gaps.join(', ') + (R.gaps.length > 1 ? ' are' : ' is') + ' left out: USDA publishes no index for a chosen interval in ' + (R.gaps.length > 1 ? 'those years' : 'that year') + '.';
    var best = s.best && s.best.indemnity > 0 ? usd(s.best.indemnity) + ' <span class="prf-sub">in ' + s.best.year + (R.bestTies > 1 ? ' and ' + plural(R.bestTies - 1, 'other year', 'other years') : '') + '</span>' : DASH + ' <span class="prf-sub">it never paid</span>';
    var dry = R.dry ? plural(R.dry.n, 'year', 'years') + ' <span class="prf-sub">' + (R.dry.n > 1 ? R.dry.from + ' to ' + R.dry.to : R.dry.from) + ', the first run that long</span>' : 'none <span class="prf-sub">it paid every year</span>';
    var pctSub = Math.round(R.subsidy * 100);
    var h = '<p class="prf-verdict">' + verdict + '</p>'
      + '<dl class="prf-figs">'
      + '<div><dt>You pay, a year</dt><dd>' + usd(t.producer) + ' <span class="prf-sub">' + usd2(per) + ' an acre, before the policy fee</span></dd></div>'
      + '<div><dt>USDA pays toward the premium</dt><dd>' + usd(t.subsidy) + ' <span class="prf-sub">' + pctSub + '% of the ' + usd(t.premium) + ' premium, if you qualify</span></dd></div>'
      + '<div><dt>Most it can pay in a year</dt><dd>' + usd(t.protection) + ' <span class="prf-sub">' + usd2(p.protectionPerAcre) + ' an acre of protection</span></dd></div>'
      + '<div><dt>Average payout a year</dt><dd>' + usd(s.avgIndemnity) + ' <span class="prf-sub">over all ' + s.years + ' years, the no-payment years included</span></dd></div>'
      + '</dl><dl class="prf-figs prf-figs-more">'
      + '<div><dt>Payout in the middle year</dt><dd>' + usd(R.mid) + ' <span class="prf-sub">' + (R.mid > 0 ? 'half the years paid this or less' : 'more than half the years would have paid nothing') + '</span></dd></div>'
      + '<div><dt>Most in one year</dt><dd>' + best + '</dd></div>'
      + '<div><dt>Longest run with no payment</dt><dd>' + dry + '</dd></div>'
      + '</dl>';
    box.innerHTML = h; h = '';
    if (backFull != null) {
      var lr = root.getAttribute('data-lr-mid'), lo = root.getAttribute('data-lr-lo'), hi = root.getAttribute('data-lr-hi'), all = meta.years.last_complete - meta.years.first + 1;
      h += '<p class="prf-back">For each $1 of the full premium, this policy would have paid back <b>' + usd2(backFull) + '</b> over those ' + s.years + ' years.'
        + (lr ? ' Across all ' + all + ' years and every grid, month and coverage level USDA rates, the middle is $' + lr + ', and nine in ten fall between $' + lo + ' and $' + hi + '. On the full premium, no grid, month or coverage level stands out.' : '')
        + '</p>';
    }
    h += '<ul class="prf-caveat">'
      + '<li>Every year is priced at ' + meta.crop_year + ' rates and county values, on the precipitation record USDA publishes for ' + meta.crop_year
      + '. It is not what PRF paid in those years, and it says nothing about next year.</li>'
      + '<li>USDA’s share is not automatic. It needs form AD-1026 on file with the Farm Service Agency by the premium billing date. Beginning and veteran farmers get a larger share.</li>'
      + (SOD[S.st] ? '<li>In ' + esc(states[S.st].name) + ', native sod broken in recent years gets less protection and 50 points less of USDA’s share. That rule is not applied here.</li>' : '')
      + '<li>An insurer’s own figure can differ from this by a few dollars of rounding. <button type="button" class="prf-link" data-jump="prf-not">What this insurance does not do</button></li>'
      + '</ul>';
    $('prf-notes').innerHTML = h;
  }

  /* ---------------------------------------------------------------- the year chart */
  var chartState = null, READ_HINT = '<span class="prf-read-h">Tap the chart, slide a finger across it, or use the arrows, for one year’s figures.</span>';
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)), m = v / p;
    var steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) if (m <= steps[i]) return steps[i] * p;
    return 10 * p;
  }
  /* RA is always the bars and RB, when there is a second setup that can be
     priced, is always the dots. The colours never swap with the tab. */
  function drawChart(RA, RB) {
    var box = $('prf-chart'), fig = $('prf-chart-fig');
    if (!RA.ok) { fig.hidden = true; chartState = null; $('prf-legend').innerHTML = ''; return; }
    fig.hidden = false;
    var two = !!S.B, hb = RB && RB.ok && sameYears(RB.hist, RA.hist) ? RB.hist : null;
    var hist = RA.hist, n = hist.length;
    /* drawn at the width it is shown at, so the axis type is the same size on a phone as on a desk */
    var W = Math.max(280, Math.round(box.clientWidth || 760)), small = W < 520;
    var H = small ? 210 : 250, L = 46, Rr = 6, T = 12, Bm = 24, pw = W - L - Rr, ph = H - T - Bm, every = n <= 30 ? 5 : small ? 20 : 10;
    var mx = 0;
    hist.forEach(function (h) { if (h.indemnity > mx) mx = h.indemnity; });
    if (hb) hb.forEach(function (h) { if (h.indemnity > mx) mx = h.indemnity; });
    mx = niceMax(Math.max(mx, RA.pol.total.producer * 1.15));
    var y = function (v) { return T + ph - (v / mx) * ph; }, bw = pw / n;
    var sm = RA.sum, alt = 'What the policy would have paid in each year, ' + hist[0].year + ' to ' + hist[n - 1].year + ': something in ' + sm.paidYears + ' of ' + sm.years + ' years'
      + (sm.best && sm.best.indemnity > 0 ? ', most ' + usd(sm.best.indemnity) + ' in ' + sm.best.year : '') + ', against a premium of ' + usd(RA.pol.total.producer) + ' a year. The table under “Every year, in numbers” holds every figure.';
    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(alt) + '">'];
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
    var py = y(RA.pol.total.producer);
    s.push('<line class="prf-prem" x1="' + L + '" x2="' + (W - Rr) + '" y1="' + py.toFixed(1) + '" y2="' + py.toFixed(1) + '"/>');
    s.push('<line class="prf-cross" id="prf-cross" x1="0" x2="0" y1="' + T + '" y2="' + (T + ph) + '" visibility="hidden"/>');
    s.push('</svg>');
    box.innerHTML = s.join('');
    $('prf-legend').innerHTML = '<span class="prf-lg"><i class="prf-sw prf-sw-bar"></i>' + (two ? 'Setup A, would have paid' : 'Would have paid that year') + '</span>'
      + (hb ? '<span class="prf-lg"><i class="prf-sw prf-sw-dot"></i>Setup B, would have paid</span>' : '')
      + '<span class="prf-lg"><i class="prf-sw prf-sw-line"></i>Your premium' + (two ? ', setup A' : '') + ': ' + usd(RA.pol.total.producer) + ' a year</span>';
    var keep = chartState && chartState.k != null && chartState.k < n && chartState.hist[chartState.k] && chartState.hist[chartState.k].year === hist[chartState.k].year ? chartState.k : null;
    chartState = { hist: hist, hb: hb, L: L, pw: pw, W: W, RA: RA, RB: RB, two: two, k: null, args: [RA, RB] };
    if (keep != null) pickYear(keep); else $('prf-read').innerHTML = READ_HINT;
  }
  function tipFor(k) {
    var c = chartState, h = c.hist[k], b = c.hb ? c.hb[k] : null, g = openGrid(S.grid);
    function lines(hh, tag) {
      return '<span class="prf-read-l">' + (tag ? '<b>' + tag + '</b> ' : '') + 'would have paid <b>' + usd(hh.indemnity) + '</b>, ' + signed(hh.net) + ' after premium'
        + ' <span class="prf-read-s">(' + hh.cells.map(function (cl) {
            var mm_ = g && g.avgMm ? g.avgMm[cl.i] : null;
            return nw(LABELS[cl.i] + ' ' + pctOfNormal(cl.index) + '% of normal') + (mm_ != null && cl.index != null ? ' ' + nw('(' + inTxt(mm_ * cl.index) + ')') : '') + ', ' + usd(cl.paid);
          }).join('; ') + ')</span></span>';
    }
    return '<b class="prf-read-y">' + h.year + '</b> ' + lines(h, c.two ? 'A' : '') + (b ? lines(b, 'B') : '');
  }
  function pickYear(k) {
    var c = chartState, svg = $('prf-chart').querySelector('svg'); if (!c || !svg) return;
    k = Math.max(0, Math.min(c.hist.length - 1, k)); c.k = k;
    var cx = c.L + (k + 0.5) * (c.pw / c.hist.length), cross = $('prf-cross');
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    Array.prototype.forEach.call(svg.querySelectorAll('.prf-bar.is-hot'), function (b) { b.classList.remove('is-hot'); });
    var bar = svg.querySelector('.prf-bar[data-k="' + k + '"]'); if (bar) bar.classList.add('is-hot');
    $('prf-read').innerHTML = tipFor(k);
  }
  function chartMove(ev) {
    var c = chartState, box = $('prf-chart'); if (!c) return;
    var svg = box.querySelector('svg'); if (!svg) return;
    var r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * c.W;
    var k = Math.floor((x - c.L) / (c.pw / c.hist.length));
    if (k < 0 || k >= c.hist.length) return;
    pickYear(k);
  }
  /* the year a reader chose stays on screen until another is chosen: a readout that clears itself reads as a glitch */
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
    var h = '<div class="prf-scroll" tabindex="0" role="region" aria-label="Table, scrolls sideways"><table class="prf-t"><caption class="prf-cap">' + (S.B ? 'Setup ' + S.on + ': ' : '') + esc(splitWords(R.setup)) + ', ' + R.setup.cov + '% coverage. What it would have paid, year by year.</caption><thead><tr><th scope="col">Year</th><th scope="col">Would have paid</th><th scope="col">After premium</th>'
      + used.map(function (r) { return '<th scope="col" colspan="2">' + nw(LABELS[r.i]) + ' <span class="prf-th-s">' + R.setup.split[r.i] + '%</span></th>'; }).join('')
      + '</tr><tr class="prf-t-sub"><td></td><td></td><td></td>' + used.map(function () { return '<th scope="col">% of normal</th><th scope="col">paid</th>'; }).join('') + '</tr></thead><tbody>';
    function row(hh, openYear) {
      var whole = hh.complete;
      return '<tr' + (openYear ? ' class="is-open"' : '') + '><th scope="row">' + hh.year + (openYear ? ' <span class="prf-th-s">' + (whole ? 'not in totals' : 'so far') + '</span>' : '') + '</th>'
        + '<td>' + (whole ? usd(hh.indemnity) : DASH) + '</td><td class="' + (whole && hh.net > 0 ? 'is-up' : '') + '">' + (whole ? signed(hh.net) : DASH) + '</td>'
        + hh.cells.map(function (c) { return '<td' + (c.paid > 0 ? ' class="is-pay"' : '') + '>' + pctOfNormal(c.index) + '</td><td>' + (c.paid == null ? DASH : usd(c.paid)) + '</td>'; }).join('') + '</tr>';
    }
    R.open.slice().reverse().forEach(function (hh) { h += row(hh, true); });
    R.hist.slice().reverse().forEach(function (hh) { h += row(hh, false); });
    h += '</tbody></table></div>';
    if (R.open.length) h += '<p class="prf-fine">' + R.open.map(function (o) { return o.year; }).join(', ') + ' is listed and not counted: the figures above stop at ' + meta.years.last_complete
      + ', so every setup is judged on the same years. A dash is an interval USDA has not published yet. These are the ' + meta.crop_year + ' record’s figures and may differ from the index a ' + R.open[0].year + ' policy is paid on.</p>';
    h += '<p class="prf-fine">Percent of normal is precipitation in the grid over those two months, rain and snow together, against its ' + meta.years.first + ' to ' + meta.years.last_complete + ' average. This is the policy’s “index”. Below ' + R.setup.cov + ' it pays.</p>';
    box.innerHTML = h;
  }
  /* The print sheet's year list: every counted year and what it would have
     paid, in seven blocks so the sheet stays one page. The same figures as the
     chart and the year table. Hidden on screen. */
  function drawPrintYears(R) {
    var box = $('prf-yrs-p');
    if (!R.ok) { box.innerHTML = ''; return; }
    var hs = R.hist, B = 8, per = Math.ceil(hs.length / B), h = '<table class="prf-t prf-t-yp"><caption class="prf-cap">' + (S.B ? 'Setup ' + S.on + ': w' : 'W') + 'hat it would have paid each year, ' + hs[0].year + ' to ' + hs[hs.length - 1].year + ' <span class="prf-cap-x">(shaded years paid something)</span></caption><thead><tr>';
    for (var c = 0; c < B; c++) h += '<th scope="col">Year</th><th scope="col">Paid</th>';
    h += '</tr></thead><tbody>';
    for (var r = 0; r < per; r++) {
      h += '<tr>';
      for (c = 0; c < B; c++) { var x = hs[c * per + r]; h += x ? '<th scope="row">' + x.year + '</th><td' + (x.indemnity > 0 ? ' class="is-pay"' : '') + '>' + usd(x.indemnity) + '</td>' : '<td></td><td></td>'; }
      h += '</tr>';
    }
    box.innerHTML = h + '</tbody></table>';
  }
  /* The rest of the print sheet (one Letter page; hidden on screen): the AGSIST header with the grid,
     county and state, the policy as chosen, one plain line under the answer, the chart and the year list,
     the sources with their dates, and a QR code back to this page with the same settings. */
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function longDay(d) { return MON[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear(); }
  function isoDay(iso) { var d = new Date(iso); return isNaN(d) ? '' : longDay(d); }
  function liveUrl() { return 'https://agsist.com' + shareUrl().replace(location.origin, ''); }
  function meansLine(R) {
    if (!R.ok) return '';
    var t = R.pol.total, avg = Math.round(R.sum.avgIndemnity), prem = Math.round(t.premium), you = Math.round(t.producer);
    if (avg >= prem) return 'What this means: the average payout covered the whole ' + usd(prem) + ' premium on this record, not only your share. That is the past, not a forecast.';
    if (avg > you) return 'What this means: the average payout is under the full ' + usd(prem) + ' premium; it comes out above your ' + usd(you) + ' share only because USDA pays the rest.';
    return 'What this means: the average payout is under the full ' + usd(prem) + ' premium, and under your ' + usd(you) + ' share too, even with USDA paying the rest.';
  }
  function drawPrintSheet(R) {
    var c = county(), st = states[S.st], setup = R.setup || cur(), now = new Date();
    $('prf-ph-g').textContent = 'Grid ' + S.grid + ' \u00b7 ' + c.n + ' County, ' + (st ? st.name : S.st);
    $('prf-ph-d').innerHTML = 'Crop year ' + meta.crop_year + ' rates \u00b7 printed ' + MON[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear();
    var pp = [['Use of the land', esc(useName())], ['Acres', (S.acres || 0).toLocaleString('en-US') + (S.share === 100 ? '' : ', your share ' + S.share + '%')],
      ['Coverage level', setup.cov + '%'], ['Productivity factor', String(setup.pf)], ['Months insured' + (S.B ? ', setup ' + S.on : ''), esc(splitWords(setup))]];
    /* a long sheet (many months, a share, a long county name) gets the tighter print sizes (prf.css .prf-ptight) */
    root.classList.toggle('prf-ptight', setup.split.filter(function (p) { return p > 0; }).length > 3 || S.share !== 100 || (c.n + (st ? st.name : '')).length > 24);
    $('prf-pp').innerHTML = pp.map(function (x) { return '<div><dt>' + x[0] + '</dt><dd>' + x[1] + '</dd></div>'; }).join('');
    $('prf-pm').textContent = meansLine(R);
    $('prf-chart-pm').textContent = R.ok ? 'Each bar is one year at ' + meta.crop_year + ' rates, not what PRF paid then. Above the dashed line, it paid more than you pay.' : '';
    var adm = meta.sources && meta.sources.adm_last_modified ? isoDay(meta.sources.adm_last_modified) : '';
    $('prf-psrc').innerHTML = '<b>Sources:</b> USDA RMA ' + meta.crop_year + ' rates, county base values and subsidy (actuarial data' + (adm ? ' posted ' + adm : '') + '); the rainfall index, '
      + meta.years.first + ' to ' + meta.years.last_complete + ', from RMA\u2019s PRF index service (NOAA NCEI data), read ' + isoDay(meta.built) + '.';
    var url = liveUrl(), q = '';
    try { if (window.AgQR) q = window.AgQR.svg(url, 'QR code for this policy on agsist.com'); } catch (e) { q = ''; }
    $('prf-pq').innerHTML = q + '<p class="prf-pq-t"><b>Scan to open this policy live.</b> Or go to agsist.com/prf and look up grid ' + S.grid + '.</p>';
  }
  function download(name, text) {
    var blob = new Blob([text], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function csvHead(extra) {
    var c = county();
    return '# AGSIST agsist.com/prf. Grid ' + S.grid + '; ' + c.n + ' County ' + S.st + '; ' + useName().replace(/,/g, '') + '; ' + S.acres + ' acres; share ' + S.share + '%. ' + extra
      + ' Crop year ' + meta.crop_year + ' rates and county values on every year. Not what PRF paid in those years.\n';
  }
  function csv(R) {
    var used = R.pol.rows.filter(function (r) { return r.pct > 0; });
    var out = [['year'].concat(used.reduce(function (a, r) { return a.concat([LABELS[r.i] + ' percent of normal', LABELS[r.i] + ' would have paid']); }, []), ['would have paid', 'you pay (producer premium)', 'after premium', 'counted in totals'])];
    function row(h, counted) {
      out.push([h.year].concat(h.cells.reduce(function (a, c) { return a.concat([c.index == null ? '' : pctOfNormal(c.index), c.paid == null ? '' : c.paid]); }, []),
        [h.indemnity == null ? '' : h.indemnity, R.pol.total.producer, h.net == null ? '' : h.net, counted ? 'yes' : 'no']));
    }
    R.hist.forEach(function (h) { row(h, true); });
    R.open.forEach(function (h) { row(h, false); });
    var head = csvHead((S.B ? 'Setup ' + S.on + '. ' : '') + R.setup.cov + '% coverage; productivity factor ' + R.setup.pf + '; ' + splitWords(R.setup).replace(/,/g, ';') + '.');
    download('prf-grid-' + S.grid + (S.B ? '-setup-' + S.on.toLowerCase() : '') + '.csv', head + out.map(function (r) { return r.join(','); }).join('\n') + '\n');
    track('prf_csv', { grid: S.grid, what: 'policy' });
  }

  /* ---------------------------------------------------------------- the policy, interval by interval */
  function drawPolicy(R) {
    var box = $('prf-pol');
    if (!$('prf-pol-d').open) { box.innerHTML = ''; return; }
    if (!R.ok) { box.innerHTML = '<p class="prf-fine">' + esc(R.why) + '</p>'; return; }
    var c = county(), p = R.pol, t = p.total, pctSub = Math.round(R.subsidy * 100);
    var h = '<div class="prf-scroll" tabindex="0" role="region" aria-label="Table, scrolls sideways"><table class="prf-t"><caption class="prf-cap">' + (S.B ? 'Setup ' + S.on + '. ' : '') + 'The policy as an insurer’s schedule lists it, one line for each interval.</caption><thead><tr><th scope="col">Months</th><th scope="col">% of the policy</th><th scope="col">Protection</th><th scope="col">Premium per $100</th><th scope="col">Premium</th><th scope="col">USDA pays</th><th scope="col">You pay</th></tr></thead><tbody>';
    p.rows.forEach(function (r) {
      if (!(r.pct > 0)) return;
      h += '<tr><th scope="row">' + LABELS[r.i] + '</th><td>' + R.setup.split[r.i] + '%</td><td>' + usd(r.protection) + '</td><td>' + usd2(r.rate * 100) + '</td><td>' + usd(r.premium) + '</td><td>' + usd(r.subsidy) + '</td><td>' + usd(r.producer) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><th scope="row">Whole policy</th><td>100%</td><td>' + usd(t.protection) + '</td><td></td><td>' + usd(t.premium) + '</td><td>' + usd(t.subsidy) + '</td><td>' + usd(t.producer) + '</td></tr></tfoot></table></div>'
      + '<p class="prf-fine">County base value for ' + esc(useName().toLowerCase()) + ' in ' + esc(c.n) + ' County: <b>' + usd2(R.cbv) + '</b> an acre. Protection per acre is that value times ' + R.setup.cov + '% coverage times a productivity factor of ' + R.setup.pf
      + ': <b>' + usd2(p.protectionPerAcre) + '</b>. Protection in an interval is that, times ' + S.acres.toLocaleString('en-US') + ' acres, times your ' + S.share + '% share, times the interval’s part of the policy. USDA’s part of the premium is ' + pctSub + '% at ' + R.setup.cov + '% coverage. Each line is rounded to the dollar, as on USDA’s own calculator.</p>';
    box.innerHTML = h;
  }

  /* ---------------------------------------------------------------- each interval on its own */
  function drawRecord() {
    var box = $('prf-rec');
    if (!$('prf-rec-d').open) { box.innerHTML = ''; return; }
    var g = openGrid(S.grid), s = cur(), mm = minmax();
    if (!g || g.stale) { box.innerHTML = ''; return; }
    var pctSub = Math.round(meta.subsidy[String(s.cov)] * 100), done = windowed(g.done), ys = Object.keys(done).map(Number), ny = ys.length;
    var h = '<div class="prf-scroll" tabindex="0" role="region" aria-label="Table, scrolls sideways"><table class="prf-t"><caption class="prf-cap">Every interval at this grid, ' + Math.min.apply(null, ys) + ' to ' + Math.max.apply(null, ys) + ', at ' + s.cov + '% coverage.</caption><thead><tr><th scope="col">Months</th><th scope="col">Normal precipitation</th><th scope="col">Pays under</th><th scope="col">Years it would have paid</th><th scope="col">Driest year, % of normal</th><th scope="col">Middle year, % of normal</th><th scope="col">Premium per $100</th><th scope="col">You pay per $100</th><th scope="col">Would have paid per $100, average year</th></tr></thead><tbody>';
    for (var i = 0; i < N; i++) {
      var r = M.intervalRecord(done, i, s.cov, g.rates[s.cov][i]), mm_ = g.avgMm ? g.avgMm[i] : null;
      if (!mm.valid[i]) { h += '<tr class="is-off"><th scope="row">' + LABELS[i] + '</th><td>' + inTxt(mm_) + '</td><td colspan="7" class="prf-td-l">not offered in this county</td></tr>'; continue; }
      h += '<tr' + (s.split[i] > 0 ? ' class="is-on"' : '') + '><th scope="row">' + LABELS[i] + '</th>'
        + '<td>' + inTxt(mm_) + '</td><td>' + (mm_ == null ? DASH : inTxt(mm_ * s.cov / 100)) + '</td>'
        + '<td>' + (r.years ? r.below + ' of ' + r.years : DASH) + '</td>'
        + '<td>' + (r.lowest ? pctOfNormal(r.lowest.index) + ' <span class="prf-th-s">' + r.lowest.year + '</span>' : DASH) + '</td>'
        + '<td>' + (r.middle == null ? DASH : pctOfNormal(r.middle)) + '</td>'
        + '<td>' + (r.ratePer100 == null ? DASH : usd2(r.ratePer100)) + '</td>'
        + '<td>' + (r.ratePer100 == null ? DASH : usd2(lessPct(r.ratePer100, pctSub))) + '</td>'
        + '<td>' + (r.costPer100 == null ? DASH : usd2(r.costPer100)) + '</td></tr>';
    }
    h += '</tbody></table></div><p class="prf-fine">Per $100 of protection placed in that interval, over the ' + ny + ' years shown. Normal precipitation is USDA’s ' + meta.years.first + ' to ' + meta.years.last_complete
      + ' average for the grid, rain and snow together, and “pays under” is ' + s.cov + '% of it. You pay the premium less USDA’s ' + pctSub + '%. The middle year is the one with half the years drier and half wetter: where it sits well under 100, a few very wet years carry the average and the interval lands below its trigger often. A dash is a rate USDA does not publish for this grid.</p>';
    box.innerHTML = h;
  }

  /* ---------------------------------------------------------------- the index, all eleven intervals */
  function indexRows() {
    var g = openGrid(S.grid), rows = [];
    Object.keys(g.done).map(Number).sort(function (a, z) { return a - z; }).forEach(function (y) { rows.push({ year: y, v: g.done[y], open: false }); });
    Object.keys(g.open).map(Number).sort(function (a, z) { return a - z; }).forEach(function (y) { rows.push({ year: y, v: g.open[y], open: true }); });
    return rows;
  }
  function drawIndex() {
    var box = $('prf-idx');
    if (!$('prf-idx-d').open) { box.innerHTML = ''; return; }
    var g = openGrid(S.grid), s = cur();
    if (!g || g.stale) { box.innerHTML = ''; return; }
    var h = '<p class="prf-fine"><button type="button" class="btn btn-secondary" id="prf-idx-csv">Download this table (CSV)</button></p><div class="prf-scroll prf-scroll-tall" tabindex="0" role="region" aria-label="Table, scrolls both ways"><table class="prf-t prf-t-idx"><caption class="prf-cap">Grid ' + S.grid + ': precipitation as a percent of normal, every interval, every year. Shaded cells are under ' + s.cov + ', where a policy at ' + s.cov + '% coverage pays.</caption><thead><tr><th scope="col">Year</th>'
      + LABELS.map(function (l) { return '<th scope="col">' + nw(l) + '</th>'; }).join('') + '</tr></thead><tbody>';
    indexRows().reverse().forEach(function (r) {
      h += '<tr' + (r.open ? ' class="is-open"' : '') + '><th scope="row">' + r.year + '</th>' + r.v.map(function (v) { return '<td' + (v != null && v < s.cov / 100 - 1e-12 ? ' class="is-pay"' : '') + '>' + pctOfNormal(v) + '</td>'; }).join('') + '</tr>';
    });
    h += '</tbody></table></div><p class="prf-fine">USDA’s ' + meta.crop_year + ' record for this grid. A dash is an interval not yet published.</p>';
    box.innerHTML = h;
  }
  function csvIndex() {
    var out = [['year'].concat(LABELS)];
    indexRows().forEach(function (r) { out.push([r.year].concat(r.v.map(function (v) { return v == null ? '' : pctOfNormal(v); }))); });
    download('prf-grid-' + S.grid + '-index.csv', '# AGSIST agsist.com/prf. Grid ' + S.grid + '. Precipitation as a percent of the ' + meta.years.first + ' to ' + meta.years.last_complete + ' average, by two-month interval. USDA RMA, crop year ' + meta.crop_year + ' record.\n'
      + out.map(function (r) { return r.join(','); }).join('\n') + '\n');
    track('prf_csv', { grid: S.grid, what: 'index' });
  }

  /* ---------------------------------------------------------------- the five coverage levels */
  function drawLadder() {
    var box = $('prf-lad');
    if (!$('prf-lad-d').open) { box.innerHTML = ''; return; }
    var s = cur();
    var h = '<div class="prf-scroll" tabindex="0" role="region" aria-label="Table, scrolls sideways"><table class="prf-t"><caption class="prf-cap">The same acres and months at each coverage level' + (S.B ? ', setup ' + S.on : '') + '.</caption><thead><tr><th scope="col">Coverage</th><th scope="col">You pay, a year</th><th scope="col">USDA pays</th><th scope="col">Most it can pay</th><th scope="col">Years it would have paid</th><th scope="col">Average payout</th><th scope="col">Middle year</th></tr></thead><tbody>', why = '';
    M.COVERAGE.forEach(function (cv) {
      var R = compute({ cov: cv, pf: s.pf, split: s.split, even: s.even });
      if (!R.ok) { why = R.why; h += '<tr><th scope="row">' + cv + '%</th><td colspan="6" class="prf-td-l">' + DASH + '</td></tr>'; return; }
      var t = R.pol.total;
      h += '<tr' + (cv === s.cov ? ' class="is-on"' : '') + '><th scope="row">' + cv + '%</th><td>' + usd(t.producer) + '</td><td>' + usd(t.subsidy) + ' <span class="prf-th-s">' + Math.round(R.subsidy * 100) + '%</span></td><td>' + usd(t.protection) + '</td><td>'
        + R.sum.paidYears + ' of ' + R.sum.years + '</td><td>' + usd(R.sum.avgIndemnity) + '</td><td>' + usd(R.mid) + '</td></tr>';
    });
    h += '</tbody></table></div><p class="prf-fine">' + (why ? esc(why) + ' ' : '') + 'A lower coverage level pays less often and costs less, and USDA covers a larger part of a smaller bill. On the full premium, the record does not favor one level: at each, it pays back about the same part of it.</p>';
    box.innerHTML = h;
  }

  /* ---------------------------------------------------------------- A against B */
  function drawCompare(RA, RB) {
    var box = $('prf-cmp'), wrap = $('prf-cmp-wrap');
    wrap.hidden = !S.B;
    if (!S.B) { box.innerHTML = ''; return; }
    function col(R, f) { return R.ok ? f(R) : DASH; }
    function months(st) { return st.split.map(function (p, i) { return p > 0 ? nw(LABELS[i] + ' ' + p + '%') : ''; }).filter(Boolean).join('<br>') || DASH; }
    var rows = [
      ['Coverage, productivity factor', function (R) { return R.setup.cov + '%, ' + R.setup.pf; }, true],
      ['Months', function (R) { return months(R.setup); }, true],
      ['You pay, a year', function (R) { return usd(R.pol.total.producer); }],
      ['Most it can pay in a year', function (R) { return usd(R.pol.total.protection); }],
      ['Years it would have paid', function (R) { return R.sum.paidYears + ' of ' + R.sum.years; }],
      ['Years it would have paid more than your share of the premium', function (R) { return R.sum.aheadYears + ' of ' + R.sum.years; }],
      ['Average payout a year', function (R) { return usd(R.sum.avgIndemnity); }],
      ['Payout in the middle year', function (R) { return usd(R.mid); }],
      ['Most in one year', function (R) { return R.sum.best && R.sum.best.indemnity > 0 ? usd(R.sum.best.indemnity) + ' (' + R.sum.best.year + ')' : DASH; }],
      ['Longest run with no payment', function (R) { return R.dry ? plural(R.dry.n, 'year', 'years') : 'none'; }]
    ];
    var c = county();
    var h = '<p class="prf-fine">Both setups: ' + esc(useName()) + ', ' + S.acres.toLocaleString('en-US') + ' acres, ' + S.share + '% share, grid ' + S.grid + ', ' + esc(c.n) + ' County.</p>'
      + '<div class="prf-scroll" tabindex="0" role="region" aria-label="Table, scrolls sideways"><table class="prf-t prf-t-cmp"><caption class="prf-sr">Setup A against setup B</caption><thead><tr><td></td><th scope="col">Setup A</th><th scope="col">Setup B</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var a = r[2] ? r[1]({ setup: S.A }) : col(RA, r[1]), b = r[2] ? r[1]({ setup: S.B }) : col(RB, r[1]);
      h += '<tr><th scope="row">' + r[0] + '</th><td>' + a + '</td><td>' + b + '</td></tr>';
    });
    h += '</tbody></table></div>';
    if (!RA.ok) h += '<p class="prf-fine">Setup A: ' + esc(RA.why) + '</p>';
    if (!RB.ok) h += '<p class="prf-fine">Setup B: ' + esc(RB.why) + '</p>';
    if (RA.ok && RB.ok) {
      if (!sameYears(RA.hist, RB.hist)) {
        h += '<p class="prf-fine">The two setups are not counted over the same years here: USDA publishes no index for some interval in one of them. Compare the year table, not the totals.</p>';
      } else {
        var d = RA.hist.map(function (ha, i) { return { year: ha.year, a: ha.indemnity, b: RB.hist[i].indemnity }; });
        var onlyA = d.filter(function (x) { return x.a > 0 && x.b === 0; }).length, onlyB = d.filter(function (x) { return x.b > 0 && x.a === 0; }).length, both = d.filter(function (x) { return x.a > 0 && x.b > 0; }).length;
        h += '<p class="prf-fine">Both setups are run over the same ' + RA.sum.years + ' years, ' + RA.sum.first + ' to ' + RA.sum.last + '. Both would have paid in ' + plural(both, 'year', 'years') + ', only A in ' + onlyA + ', only B in ' + onlyB + ', neither in ' + (d.length - both - onlyA - onlyB)
          + '. The table says what each would have done. It does not say which to buy: the months to insure are the ones when a dry spell costs you grass or hay.</p>';
      }
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
    var grid = S.grid, co = S.co, tag = setupStr(s) + S.use + S.acres + S.share + S.win;
    box.innerHTML = '<p class="prf-fine">Reading the grids next door…</p>';
    Promise.all(Object.keys(want).map(loadShard)).then(function () {
      if (grid !== S.grid || co !== S.co || tag !== setupStr(cur()) + S.use + S.acres + S.share + S.win || !$('prf-nb-d').open) return;
      var h = '<div class="prf-nb-g">', shown = 0;
      ids.forEach(function (id) {
        if (id == null) { h += '<div class="prf-nb-c is-out"></div>'; return; }
        if (c.g.indexOf(id) < 0) { h += '<div class="prf-nb-c is-out"><span class="prf-nb-id">' + id + '</span><span class="prf-nb-x">not in ' + esc(c.n) + ' County</span></div>'; return; }
        var keepG = S.grid; S.grid = id;
        var R = compute(s); S.grid = keepG;
        shown++;
        h += '<' + (id === grid ? 'div' : 'button type="button" data-grid="' + id + '" data-county="' + stateFips() + S.co + '"') + ' class="prf-nb-c' + (id === grid ? ' is-here' : '') + '">'
          + '<span class="prf-nb-id">' + id + (id === grid ? ' · shown above' : '') + '</span>'
          + (R.ok ? '<span class="prf-nb-v">' + usd(R.pol.total.producer) + '</span><span class="prf-nb-x">you pay · would have paid in ' + R.sum.paidYears + ' of ' + R.sum.years + ' · average ' + usd(R.sum.avgIndemnity) + '</span>'
                  : '<span class="prf-nb-x">' + esc(R.why) + '</span>')
          + '</' + (id === grid ? 'div' : 'button') + '>';
      });
      h += '</div><p class="prf-fine">The same policy on each grid’s own record and rates, with ' + esc(c.n) + ' County values. North is up. A grid that paid more also costs more: USDA sets each grid’s rate from its own record. Which grid a policy uses follows from where the land is. You pick a point inside the acres you insure, and land that lies across a grid line can go in either grid or be split between them (Rainfall Index Basic Provisions, section 6(f)).</p>';
      box.innerHTML = shown > 1 ? h : '<p class="prf-fine">Grid ' + grid + ' has no neighbor in ' + esc(c.n) + ' County with PRF offers.</p>';
    }).catch(function () { box.innerHTML = '<p class="prf-fine">The neighboring grids did not load. Try again.</p>'; });
  }

  /* ---------------------------------------------------------------- step 2 on a phone
     On one column the controls fold into one line that names the policy, so
     the answer is on the first screen once a grid is set. Tapping the line
     opens them; once open they stay open. Two columns show them always. */
  var setupIsOpen = false;
  function setupOpen(on) {
    setupIsOpen = !!on;
    $('prf-setup').classList.toggle('is-open', setupIsOpen);
    $('prf-setup-sum').setAttribute('aria-expanded', setupIsOpen ? 'true' : 'false');
    document.querySelector('.prf-setup-sum-a').textContent = setupIsOpen ? 'Close' : 'Change';
  }
  function openFor(el) { if (el && $('prf-setup-body').contains(el)) setupOpen(true); }

  /* ---------------------------------------------------------------- the pinned line */
  var answerSeen = true, lookNow = function () {};
  function drawBar(R) {
    var bar = $('prf-bar');
    if (R) {
      bar.setAttribute('data-ok', R.ok ? '1' : '0');
      bar.innerHTML = R.ok
        ? (S.lost ? 'Still grid ' + S.grid + ', ' + esc(county().n) + ' ' + S.st + ': ' : S.touched ? '' : 'Example: ') + S.acres.toLocaleString('en-US') + ' ac · you pay <b>' + usd(R.pol.total.producer) + '</b> · paid <b>' + R.sum.paidYears + ' of ' + R.sum.years + '</b> yrs · avg <b>' + usd(R.sum.avgIndemnity) + '</b>'
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
    lookNow = ask;
  }

  /* ---------------------------------------------------------------- draw everything */
  var lastR = null, sayT = null;
  /* one short line for a screen reader, a moment after the last change, in place of re-reading the whole card */
  function sayResult(R) {
    clearTimeout(sayT);
    var t = R.ok ? (S.B ? 'Setup ' + S.on + '. ' : '') + 'You pay ' + usd(R.pol.total.producer) + ' a year. Would have paid in ' + R.sum.paidYears + ' of ' + R.sum.years + ' years, ' + usd(R.sum.avgIndemnity) + ' in an average year.' : R.why;
    sayT = setTimeout(function () { $('prf-say').textContent = t; }, 900);
  }
  /* While a split is half made the card shrinks to one line. Hold the room the
     last good card took, so the control in use does not jump (iOS has no scroll
     anchoring); let go as soon as the figures are back. */
  function holdRoom(ok) {
    var el = document.querySelector('.prf-o2');
    if (!ok) { if (!el.style.minHeight) el.style.minHeight = el.offsetHeight + 'px'; }
    else el.style.minHeight = '';
  }
  function render() {
    if (!S.grid || !county()) return;
    syncControls();
    var RA = compute(S.A), RB = S.B ? compute(S.B) : null, onB = S.on === 'B' && !!RB, R = onB ? RB : RA;
    if (lastR && lastR.ok) holdRoom(R.ok); else if (R.ok) holdRoom(true);
    lastR = R;
    sayResult(R);
    drawAnswer(R);
    drawChart(RA, RB);
    drawYears(R); drawPrintYears(R); drawPrintSheet(R); drawPolicy(R); drawRecord(); drawIndex(); drawLadder(); drawCompare(RA, RB); drawNeighbors();
    $('prf-acts').hidden = !R.ok;
    drawBar(R);
    $('prf-answer-h').textContent = 'What it costs and what it would have paid' + (S.B ? ', setup ' + S.on : '');
    $('prf-chart-cap').textContent = 'What it would have paid, year by year' + (S.B ? ': setup A as bars' + (RB && RB.ok ? ', setup B as dots' : '') : '');
    remember();
    lookNow();
    // Panels that read the page's grid: the long-range outlook and "What the numbers would pick".
    try { document.dispatchEvent(new CustomEvent('prf:grid', { detail: { grid: S.grid, split: cur().split, st: S.st, stName: states[S.st] ? states[S.st].name : S.st } })); } catch (e) {}
    try {
      var g_ = openGrid(S.grid), s_ = cur();
      /* Kept on window.AgPrf.optCtx too: this can run before prf-optimize-ui.js has loaded (a returning
         reader's grid opens from cache), and that file picks the last one up when it arrives. */
      var optCtx = g_ && !g_.stale ? { grid: S.grid, county: county().n + ' County, ' + S.st, index: g_.done, rates: g_.rates, avgMm: g_.avgMm, limits: minmax(), cov: s_.cov, pf: s_.pf, acres: S.acres, share: S.share, cbv: baseValue(), subsidy: meta.subsidy, lastComplete: meta.years.last_complete, src: SRC,
        apply: function (sp) { var s = cur(); s.split = sp.slice(); s.even = false; S.touched = true; render(); $('prf-iv-h').scrollIntoView({ block: 'start' }); } } : null;
      if (window.AgPrf) window.AgPrf.optCtx = optCtx;
      if (optCtx && window.AgPrfOptUI) window.AgPrfOptUI.update(optCtx);
    } catch (e) {}
  }

  /* ---------------------------------------------------------------- wiring */
  function wire() {
    $('prf-find').addEventListener('submit', function (e) { e.preventDefault(); $('prf-q').blur(); find($('prf-q').value); });
    $('prf-loc').addEventListener('click', function () {
      if (!navigator.geolocation) { say('This browser will not share a location. Type a ZIP.', true); return; }
      var my = ++ticket;
      say('Asking the browser for your location…');
      track('prf_find', { by: 'location' });
      navigator.geolocation.getCurrentPosition(function (p) { if (my === ticket) atPoint(p.coords.latitude, p.coords.longitude, 'your location', {}); },
        function () { if (my === ticket) missed('The browser did not share a location. Type a ZIP, or pick by state and county.'); }, { timeout: 12000, maximumAge: 600000 });
    });
    $('prf-eg').addEventListener('click', function () { S.touched = false; goGrid(30454, { county: '55005' }); track('prf_find', { by: 'example' }); });
    $('prf-b-st').addEventListener('change', fillBrowseCounties);
    $('prf-b-co').addEventListener('change', fillBrowseGrids);
    root.addEventListener('click', function (e) {
      var cl = function (sel) { return e.target.closest ? e.target.closest(sel) : null; };
      var t = cl('[data-asgrid]');
      if (t) { goGrid(+t.getAttribute('data-asgrid'), {}).then(function (ok) { if (ok) toGrid(); }); return; }
      t = cl('[data-choice]');
      if (t && choiceGo) { var r = choices[+t.getAttribute('data-choice')]; if (r) choiceGo(r); return; }
      t = cl('[data-grid]');
      if (t && !t.closest('#prf-map')) { goGrid(+t.getAttribute('data-grid'), { county: t.getAttribute('data-county') }, true).then(function (ok) { if (ok && t.closest('#prf-b-grids')) toGrid(); }); return; }
      t = cl('[data-jump]');
      if (t) { var d = $(t.getAttribute('data-jump')); if (d) { openFor(d); d.scrollIntoView({ behavior: motion(), block: 'start' }); } return; }
      t = cl('[data-win]');
      if (t) { S.win = +t.getAttribute('data-win'); render(); track('prf_window', { years: S.win || 'all' }); return; }
      t = cl('[data-yr]');
      if (t && chartState) { pickYear(chartState.k == null ? (+t.getAttribute('data-yr') > 0 ? 0 : chartState.hist.length - 1) : chartState.k + +t.getAttribute('data-yr')); return; }
      if (cl('#prf-idx-csv')) { csvIndex(); return; }
      t = cl('a[data-out]');
      if (t) track('prf_out', { to: t.getAttribute('data-out') });
    });
    function mapPick(e) {
      var t = e.target.closest ? e.target.closest('[data-grid]') : null;
      if (!t) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      goGrid(+t.getAttribute('data-grid'), { county: S.co ? stateFips() + S.co : null }, true);
    }
    $('prf-map').addEventListener('click', mapPick);
    $('prf-map').addEventListener('keydown', mapPick);
    $('prf-co').addEventListener('change', function () {
      var v = this.value; if (!v) return;
      S.st = stateByFips(v.slice(0, 2)).st; S.co = v.slice(2); S.coHow = 'named'; afterGrid();
    });
    function touch() { S.touched = true; S.lost = false; }
    $('prf-use').addEventListener('change', function () { S.use = +this.value; touch(); ['A', 'B'].forEach(function (k) { if (S[k]) fit(S[k]); }); render(); });
    /* a number box that is tapped is about to be replaced, not added to: 100 then "3000" must not read 1003000 */
    /* select on focus, and keep the mouseup or tap that focused it from undoing the selection */
    function selectAll(el) {
      el.addEventListener('focus', function () { try { el.select(); } catch (e) {} el._sel = true; });
      el.addEventListener('mouseup', function (e) { if (el._sel) { e.preventDefault(); el._sel = false; } });
      el.addEventListener('blur', function () { el._sel = false; });
    }
    ['prf-acres', 'prf-share', 'prf-pf-n'].forEach(function (id) { selectAll($(id)); });
    $('prf-acres').addEventListener('input', function () { var v = +this.value; S.acres = v >= 1 && v <= 5000000 && v === Math.floor(v) ? v : 0; touch(); render(); });
    $('prf-acres').addEventListener('blur', function () { this.value = S.acres || ''; });
    $('prf-share').addEventListener('input', function () { var v = +this.value; S.share = this.value !== '' && v >= 1 && v <= 100 ? Math.round(v) : null; touch(); render(); });
    $('prf-share').addEventListener('blur', function () { if (S.share != null) this.value = S.share; });
    $('prf-pf').addEventListener('input', function () { cur().pf = +this.value; touch(); render(); });
    $('prf-pf-n').addEventListener('input', function () { var v = +this.value; cur().pf = this.value !== '' && v >= 60 && v <= 150 ? Math.round(v) : NaN; touch(); render(); });
    $('prf-pf-n').addEventListener('blur', function () { if (!(cur().pf >= 60)) { cur().pf = 100; render(); } this.value = cur().pf; });
    $('prf-cov').addEventListener('click', function (e) { var b = e.target.closest ? e.target.closest('[data-cov]') : null; if (b) { cur().cov = +b.getAttribute('data-cov'); touch(); render(); } });
    var body = $('prf-iv-body');
    body.addEventListener('change', function (e) {
      var t = e.target;
      if (t.hasAttribute('data-iv-on')) toggleIv(+t.getAttribute('data-iv-on'), t.checked);
    });
    body.addEventListener('focusin', function (e) { var t = e.target; if (t.hasAttribute && t.hasAttribute('data-iv-pct') && !t._selWired) { t._selWired = true; selectAll(t); try { t.select(); } catch (er) {} t._sel = true; } });
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
    $('prf-even').addEventListener('click', function () {
      var s = cur(), tot = $('prf-iv-total'); s.even = true; S.touched = true; dropUndo();
      var ok = rebalance(s); render();
      if (!ok) { tot.textContent = 'These months cannot be split to 100% within this county’s limits. Add or drop a pair.'; tot.classList.add('is-bad'); }
    });
    $('prf-clear').addEventListener('click', function () {
      var s = cur(), b = this;
      if (undo) { var back = undo; dropUndo(); s.split = back; render(); return; }
      var keep = s.split.slice(); s.split = blank(); s.even = true; S.touched = true; render();
      undo = keep; b.textContent = 'Undo clear'; undoT = setTimeout(dropUndo, 8000);
    });
    $('prf-addb').addEventListener('click', function () { S.B = { cov: S.A.cov, pf: S.A.pf, split: S.A.split.slice(), even: S.A.even }; S.on = 'B'; S.touched = true; render(); track('prf_compare', {}); setupOpen(true); $('prf-tabs').scrollIntoView({ behavior: motion(), block: 'start' }); });
    $('prf-setup-sum').addEventListener('click', function () { setupOpen(!setupIsOpen); if (setupIsOpen) $('prf-use').focus(); });
    $('prf-tab-a').addEventListener('click', function () { S.on = 'A'; render(); });
    $('prf-tab-b').addEventListener('click', function () { S.on = 'B'; render(); });
    $('prf-dropb').addEventListener('click', function () { S.B = null; S.on = 'A'; render(); });
    $('prf-more').addEventListener('toggle', function () { if (this.open) track('prf_open', { what: 'pf' }); });
    ['prf-years-d', 'prf-pol-d', 'prf-rec-d', 'prf-idx-d', 'prf-lad-d', 'prf-nb-d'].forEach(function (id) {
      $(id).addEventListener('toggle', function () { if (this.open) track('prf_open', { what: id.replace(/^prf-|-d$/g, '') }); render(); });
    });
    watchAnswer();
    var ch = $('prf-chart');
    ch.addEventListener('pointermove', chartMove); ch.addEventListener('pointerdown', chartMove);
    window.addEventListener('resize', chartResize);
    $('prf-csv').addEventListener('click', function () { if (lastR && lastR.ok) csv(lastR); });
    /* Print is one Letter page (Sig, Oct 18): the AGSIST header with the grid, county, state and a QR code back here, the policy as chosen,
       the answer, the chart, every year's payout, the conditions and sources, a sold state's sponsor box (prf-sponsor.js), the byline. */
    $('prf-print').addEventListener('click', function () { render(); track('prf_print', { grid: S.grid }); window.print(); });
    $('prf-share-b').addEventListener('click', function () {
      var u = shareUrl(), b = this, done = function () { b.textContent = 'Link copied'; setTimeout(function () { b.textContent = 'Copy a link to this'; }, 2200); };
      track('prf_share', { grid: S.grid });
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(done, function () { window.prompt('Copy this link', u); });
      else window.prompt('Copy this link', u);
    });
  }

  /* The two folded sections of the page (details.prf-fold): open on a wide
     screen, and whenever the address points at or inside one (/prf#new). */
  function openFolds() {
    var wide = false, h = (location.hash || '').slice(1);
    try { wide = window.matchMedia('(min-width: 980px)').matches; } catch (e) {}
    Array.prototype.forEach.call(document.querySelectorAll('details.prf-fold'), function (d) {
      var inside = false;
      try { inside = !!h && (d.id === h || !!d.querySelector('#' + CSS.escape(h))); } catch (e) {}
      if (wide || inside) d.open = true;
    });
  }
  window.addEventListener('hashchange', openFolds);

  function start() {
    var st = $('prf-status'), o = saved();
    openFolds();
    st.textContent = 'Loading the rain record…';
    /* a link or a return visit is about to draw the whole tool: hold the room for it so the page below does not jump */
    if (o && o.g) $('prf-app').style.minHeight = '100vh';
    getJSON(SRC + 'meta.json').then(function (m) {
      meta = m;
      if (!meta || !meta.states || !meta.years || !meta.subsidy) throw new Error('meta');
      $('prf-b-st').innerHTML = '<option value="">Pick a state</option>' + meta.states.map(function (s) { return '<option value="' + s.st + '">' + esc(s.name) + '</option>'; }).join('');
      wire();
      st.hidden = true; st.textContent = '';
      $('prf-app').hidden = false;
      if (o && o.g) {
        var bad = [], a = parseSetup(o.a), b = o.b ? parseSetup(o.b) : null, nyears = meta.years.last_complete - meta.years.first + 1;
        if (a) S.A = a; else if (o.fromLink && o.a != null) bad.push('the months and coverage');
        if (b) S.B = b; else if (o.fromLink && o.b) bad.push('the second setup');
        if (o.u != null) { if (/^\d$/.test(String(o.u)) && +o.u < 7) S.use = +o.u; else if (o.fromLink) bad.push('the use of the land'); }
        if (o.ac != null) { if (+o.ac >= 1 && +o.ac <= 5000000) S.acres = Math.round(+o.ac); else if (o.fromLink) bad.push('the acres'); }
        if (o.sh != null) { if (+o.sh >= 1 && +o.sh <= 100) S.share = Math.round(+o.sh); else if (o.fromLink) bad.push('the share'); }
        if (o.w != null && o.w !== '' && +o.w !== 0) { if (WINDOWS.indexOf(+o.w) > 0 && +o.w < nyears) S.win = +o.w; else if (o.fromLink) bad.push('the years counted'); }
        S.touched = o.fromLink ? true : !!o.t;
        var pt = o.pt && isFinite(o.pt.lat) && isFinite(o.pt.lon) ? o.pt : null;
        goGrid(/^\d{1,5}$/.test(String(o.g)) ? +o.g : NaN, { county: o.c, pt: pt }).then(function (ok) {
          $('prf-app').style.minHeight = '';
          if (ok && bad.length) say('This link’s figures for ' + bad.join(', ') + ' could not be read, so the page’s own are shown for ' + (bad.length > 1 ? 'those' : 'that') + '.', true);
          if (ok && o.fromLink) { toGrid(); lookNow(); }
        });
      } else if (o && (o.c || o.st)) {
        /* a link to a county or a state: open the picker there */
        var code = /^\d{5}$/.test(String(o.c || '')) ? String(o.c) : null, s0 = code ? stateByFips(code.slice(0, 2)) : null;
        if (!s0 && o.st) meta.states.forEach(function (s) { if (s.st === String(o.st).toUpperCase()) s0 = s; });
        if (s0) {
          document.querySelector('.prf-browse').open = true;
          $('prf-b-st').value = s0.st;
          fillBrowseCounties().then(function () { if (code && states[s0.st] && states[s0.st].counties[code.slice(2)]) { $('prf-b-co').value = code.slice(2); fillBrowseGrids(); } });
        }
      }
    }).catch(function () {
      $('prf-app').style.minHeight = '';
      st.hidden = false;
      st.textContent = 'The rain record did not load, so the calculator is off. Reload the page, or try again in a few minutes. The rules and dates below do not need it.';
      st.classList.add('is-bad');
    });
  }
  window.AgPrf = { state: S, compute: compute, find: find, goGrid: goGrid, shareUrl: shareUrl, countyAtPoint: countyAtPoint };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
