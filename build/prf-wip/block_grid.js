  /* ---------------------------------------------------------------- choosing a grid */
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
          S.grid = id; S.codes = offered; S.coHow = how;
          S.st = stateByFips((pick || offered[0]).slice(0, 2)).st;
          S.co = pick ? pick.slice(2) : null;
          if (!keep) S.pt = want.pt || null;
          S.alt = want.alt || null;
          afterGrid();
          say('');
          return true;
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
      box.classList.add('is-wait');
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
          sayHtml('The place lookup has no ZIP ' + esc(q) + '. Type the nearest town and state, or coordinates.' + (asGrid ? ' ' + gridButton(asGrid, 'Open grid ID ' + q) : ''), true);
          return false;
        }
        var town = r.name + (r.admin1 ? ', ' + r.admin1 : '');
        return atPoint(r.latitude, r.longitude, town, { countyName: r.admin2, stateName: r.admin1, alt: asGrid }, q);
      }).catch(function () {
        if (my !== ticket) return false;
        sayHtml('The place lookup did not answer. Type coordinates, or pick by state and county below.' + (asGrid ? ' ' + gridButton(asGrid, 'Open grid ID ' + q) : ''), true);
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
        say(parts.st ? 'No place called “' + parts.name + '” found in ' + parts.st.name + '. Try a ZIP, or coordinates.' : 'No place found for “' + q + '”. Try a town with its state, a ZIP, or coordinates.', true);
        return false;
      }
      function go(r) { return atPoint(r.latitude, r.longitude, r.name + (r.admin1 ? ', ' + r.admin1 : ''), { countyName: r.admin2, stateName: r.admin1 }); }
      if (uniq.length === 1) return go(uniq[0]);
      choices = uniq.slice(0, 8);
      sayHtml('More than one “' + esc(parts.name) + '”. Pick yours: ' + choices.map(function (r, i) {
        return '<button type="button" class="prf-chip" data-choice="' + i + '">' + esc((r.admin2 ? r.admin2 + ', ' : '') + (r.admin1 || '')) + '</button>';
      }).join(' '));
      choiceGo = go;
      return false;
    }).catch(function () {
      if (my !== ticket) return false;
      say('The place lookup did not answer. Type coordinates, or pick by state and county below.', true);
      return false;
    });
  }
  var choices = [], choiceGo = null;
  /* on one column the answer sits below the fold of the search box: bring the grid to the top */
  function toGrid() { if (window.innerWidth < 980) $('prf-where-h').scrollIntoView({ block: 'start' }); }
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
      note = ' The dot is ' + esc(S.pt.label) + (S.pt.zip ? ', the town ZIP ' + esc(S.pt.zip) + ' is listed under' : '') + ', about ' + edges[0][1].toFixed(1) + ' miles from the grid’s ' + edges[0][0] + ' edge.'
        + (S.pt.zip ? ' A rural ZIP can cover several grids. If the land is somewhere else, tap its grid or type its coordinates.' : '');
    } else if (S.pt) {
      note = ' You are looking at a grid next to the one ' + esc(S.pt.label) + ' is in. ' + gridButton(M.gridFromLatLon(S.pt.lat, S.pt.lon), 'Back to grid ' + M.gridFromLatLon(S.pt.lat, S.pt.lon));
    }
    svg.push('</svg>');
    $('prf-map').innerHTML = svg.join('');
    $('prf-where-h').textContent = 'Grid ' + S.grid + ' · ' + (c ? c.n + ' County, ' + states[S.st].name : 'pick the county');
    $('prf-where-t').innerHTML = 'Covers ' + b.south.toFixed(2) + '° to ' + b.north.toFixed(2) + '° N, ' + Math.abs(b.east).toFixed(2) + '° to ' + Math.abs(b.west).toFixed(2) + '° W: about '
      + mi.ns.toFixed(0) + ' miles north to south and ' + mi.ew.toFixed(0) + ' east to west.' + note
      + (S.alt ? ' ' + esc(String(S.alt)) + ' is also a grid ID. ' + gridButton(S.alt, 'Open grid ' + S.alt + ' instead') + '.' : '')
      + ' On a policy, you pick a point inside the acres you insure and the grid and county follow from it. <a href="https://public-rma.fpac.usda.gov/apps/PRF" rel="noopener">USDA’s grid locator</a> is the official map.';
    /* county: a grid can lie in more than one, and the county sets the dollars */
    var sel = $('prf-co'), wrap = $('prf-co-wrap'), codes = S.codes;
    sel.innerHTML = (c ? '' : '<option value="" selected>Pick the county</option>') + codes.map(function (code) {
      var s = stateByFips(code.slice(0, 2)), co = states[s.st].counties[code.slice(2)];
      return '<option value="' + code + '"' + (c && s.st === S.st && code.slice(2) === S.co ? ' selected' : '') + '>' + esc(co.n) + ', ' + s.st + '</option>';
    }).join('');
    wrap.hidden = codes.length < 2;
    wrap.classList.toggle('is-ask', !c);
    $('prf-co-n').textContent = codes.length;
    $('prf-co-how').textContent = !c ? 'This page could not tell which one the point is in.'
      : S.coHow === 'point' ? 'The point is in ' + c.n + ' County, by the Census Bureau’s county lines.'
      : S.coHow === 'lookup' ? c.n + ' County is the place lookup’s county for that town.' : '';
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
      + bn.north.toFixed(2) + '° N at the top edge, ' + bs.south.toFixed(2) + '° N at the bottom, ' + Math.abs(bn.west).toFixed(2) + '° W at the left, ' + Math.abs(bs.east).toFixed(2) + '° W at the right. Not sure which? Type the nearest town above.</p>'
      + '<div class="prf-b-scroll"><div class="prf-b-map" style="grid-template-columns:repeat(' + (c1 - c0 + 1) + ',minmax(3.4rem,1fr))">'
      + c.g.map(function (g) {
          var rc = M.gridRowCol(g);
          return '<button type="button" class="prf-chip' + (g === S.grid && st === S.st && k === S.co ? ' is-on' : '') + '" style="grid-row:' + (r1 - rc.row + 1) + ';grid-column:' + (rc.col - c0 + 1) + '" data-grid="' + g + '" data-county="' + f + k + '">' + g + '</button>';
        }).join('') + '</div></div>';
  }

