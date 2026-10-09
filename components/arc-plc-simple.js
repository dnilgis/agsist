/* components/arc-plc-simple.js: the ARC or PLC short-answer pages
   (scripts/build_arc_plc.py writes them with every answer already in the HTML).

   - Lower / About the same / Higher: shows the answer the build figured for a
     PLC yield 15% under, at, or 15% over the county average. Nothing is
     computed here; the three answers are in the page.
   - State and county pickers go to that county's page.
   - Use my location: asks the phone only when the button is tapped, then finds
     the county right here (point in polygon against the county shapes in
     data/arc-plc/geo/<ST>.json, cut by the build from the Farmland Atlas file).
     The location is never sent anywhere.
   - "Run every number for your farm" opens when the link asks for the
     calculator, or when this device has numbers saved for this county.

   window.AgArcFind (inRing, locate) is the math alone, for test/arc-plc.test.mjs.
   Mirrors in_ring and locate in scripts/build_arc_plc.py. */
(function (w, d) {
  'use strict';
  if (w.AgArcFind) return;

  function inRing(x, y, r) {
    var inside = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inBox(b, x, y) { return !!b && x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]; }
  /* states whose bounding box holds the point */
  function candidates(nav, lon, lat) {
    return Object.keys(nav.s).filter(function (k) { return inBox(nav.s[k].b, lon, lat); });
  }
  /* geos: {ST: geo file}; -> {st, rec} or null. rec: [fips, name, slug or null, bbox, polygons] */
  function locate(nav, geos, lon, lat) {
    var sts = candidates(nav, lon, lat);
    for (var a = 0; a < sts.length; a++) {
      var g = geos[sts[a]];
      if (!g) continue;
      for (var i = 0; i < g.c.length; i++) {
        var rec = g.c[i];
        if (!inBox(rec[3], lon, lat)) continue;
        for (var p = 0; p < rec[4].length; p++) {
          var n = 0, poly = rec[4][p];
          for (var q = 0; q < poly.length; q++) if (inRing(lon, lat, poly[q])) n++;
          if (n % 2 === 1) return { st: sts[a], rec: rec };
        }
      }
    }
    return null;
  }
  w.AgArcFind = { inRing: inRing, candidates: candidates, locate: locate };
  if (!d || !d.querySelector) return;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function getJSON(u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }

  function levels() {
    var seg = d.querySelector('.ap-seg');
    if (!seg) return;
    seg.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button[data-lv]');
      if (!b) return;
      var lv = b.getAttribute('data-lv'), bs = seg.querySelectorAll('button'), ls = d.querySelectorAll('.ap-lv'), i;
      for (i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i] === b ? 'true' : 'false');
      for (i = 0; i < ls.length; i++) ls[i].hidden = ls[i].getAttribute('data-lv') !== lv;
      var note = d.querySelector('.ap-seg-note');
      if (note && note.getAttribute('data-' + lv)) note.textContent = note.getAttribute('data-' + lv);
    });
  }

  function finder() {
    var root = d.querySelector('[data-arcfind]');
    if (!root) return;
    var st = d.getElementById('af-st'), co = d.getElementById('af-co'), msg = d.getElementById('af-msg'), loc = d.getElementById('af-loc');
    var NAV = null, GEO = {};
    function nav() { return NAV ? Promise.resolve(NAV) : getJSON(root.getAttribute('data-nav')).then(function (j) { NAV = j; return j; }); }
    function geo(s) { return GEO[s] ? Promise.resolve(GEO[s]) : getJSON(root.getAttribute('data-geo') + s + '.json').then(function (j) { GEO[s] = j; return j; }); }
    function say(html) { msg.innerHTML = html || ''; msg.classList.toggle('is-on', !!html); }
    function hub(s) { var x = NAV && NAV.s[s]; return x && x.slug ? ' <a href="/arc-plc/' + x.slug + '">Every ' + esc(x.n) + ' county</a>.' : ''; }
    function go(s, slug, label) {
      var x = NAV.s[s];
      say('Going to ' + esc(label) + '.');
      w.location.href = '/arc-plc/' + x.slug + '/' + slug;
    }
    st.addEventListener('change', function () {
      say('');
      if (!st.value) { co.innerHTML = '<option value="">Pick a state first</option>'; co.disabled = true; return; }
      co.disabled = true; co.innerHTML = '<option value="">Loading counties</option>';
      var want = st.value;
      nav().then(function (N) {
        if (st.value !== want) return;
        var x = N.s[want];
        co.innerHTML = '<option value="">Pick a county</option>' + x.c.map(function (c) {
          return '<option value="' + esc(c[0]) + '" data-s="' + esc(c[2]) + '">' + esc(c[1]) + '</option>'; }).join('');
        co.disabled = false;
      }).catch(function () {
        co.innerHTML = '<option value="">Counties did not load</option>';
        say('The county list did not load. Check the connection and pick the state again.');
      });
    });
    co.addEventListener('change', function () {
      var o = co.options[co.selectedIndex];
      if (!co.value || !o) return;
      var slug = o.getAttribute('data-s');
      var go2 = function (N) { var x = N.s[st.value]; if (x && slug) { say('Going to ' + esc(o.text) + '.'); w.location.href = '/arc-plc/' + x.slug + '/' + slug; } };
      nav().then(go2).catch(function () { say('That county page did not load. Check the connection and try again.'); });
    });
    if (!loc) return;
    loc.addEventListener('click', function () {
      if (!navigator.geolocation) { say('This browser cannot share a location. Pick your state and county above.'); return; }
      loc.disabled = true;
      say('Finding your county. Your location stays on this phone.');
      navigator.geolocation.getCurrentPosition(function (pos) {
        var lat = pos.coords.latitude, lon = pos.coords.longitude;
        nav().then(function (N) {
          var sts = candidates(N, lon, lat);
          if (!sts.length) return null;
          return Promise.all(sts.map(function (s) { return geo(s).catch(function () { return null; }); })).then(function () { return locate(N, GEO, lon, lat); });
        }).then(function (hit) {
          loc.disabled = false;
          if (!hit) { say('That spot is outside the US counties FSA lists. Pick your state and county above.'); return; }
          var rec = hit.rec, x = NAV.s[hit.st], nm = rec[1] + ', ' + (x ? x.n : hit.st);
          if (rec[2] && x && x.slug) { go(hit.st, rec[2], nm); return; }
          say('You look to be in ' + esc(nm) + '. FSA&rsquo;s 2026 file has no ARC-CO benchmark there, so there is no county page.' + hub(hit.st));
        }).catch(function () {
          loc.disabled = false;
          say('The county map did not load, so we could not find your county. Pick your state and county above.');
        });
      }, function (err) {
        loc.disabled = false;
        say(err && err.code === 1 ? 'Location is off for this site, so we could not find your county. Pick your state and county above, or turn location on and tap again.' :
          err && err.code === 3 ? 'Your phone did not give a location in time. Tap again, or pick your state and county above.' :
            'Your phone could not find a location. Pick your state and county above.');
      }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
    });
  }

  function runOpen() {
    var run = d.getElementById('run');
    if (!run) return;
    var want = /[?&](py|by|p|base|year|crop)=/.test(location.search) || location.hash === '#run' || location.hash === '#calculator';
    if (!want) {
      var calc = run.querySelector('[data-fips]'), f = calc && calc.getAttribute('data-fips');
      try {
        for (var i = 0; f && i < localStorage.length; i++) { var k = localStorage.key(i); if (/^ap3:[fy]:/.test(k) && k.indexOf('|' + f) > 0) { want = true; break; } }
      } catch (e) {}
    }
    if (want) run.open = true;
  }

  function boot() { levels(); finder(); runOpen(); }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : null);
