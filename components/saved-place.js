/* saved-place.js: the one reader of the place a reader saved on this browser (Nov 4, 2026, site panel).

   WHY. Two keys hold the saved place: agsist-wx-loc (geo.js, the header chip; a record with lat, lon,
   label, zip, state, county) and agsist_zip (the ZIP box on /cash-bids, the Daily box, the stocks page;
   a bare ZIP). Home, rent, ARC/PLC and custom rates read only agsist-wx-loc, so a ZIP typed on
   /cash-bids showed "Bids near 50010" in the header and "Set your ZIP" in the home hero.

   RULES
   - read() is the place. A typed ZIP (agsist_zip, else agsist_user_zip) wins when the saved record has no
     ZIP, holds a different ZIP the reader also typed (the bare key was written later: every writer of the
     record writes both keys), or has no coordinates. A place found from the device (no zipTyped) keeps
     its own ZIP, as geo.js does ("never replaces a typed one" works the other way there).
   - sync() runs on load: when the typed ZIP wins, the record becomes {zip, zipTyped} with no coordinates,
     so every older reader of agsist-wx-loc sees the ZIP, and geo.js looks it up ("a ZIP saved without
     coordinates: look it up, never the device").
   - full() fills town, state, county and coordinates from our own ZIP table (data/places/zip/<2>.json,
     [lat, lon, town, state, county]) and writes them back to the record when the ZIP still matches.
   - save(zip) is what a ZIP box calls: both keys and the record, at once.
   Nothing here leaves the browser.

   window.AgSavedPlace = { read, sync, full, save, county }; node: module.exports (test/saved-place.test.mjs). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object' && typeof root.document !== 'undefined') {
    root.AgSavedPlace = api.bind(root);
    try { root.AgSavedPlace.sync(); } catch (e) {}
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var ZIP = /^\d{5}$/, ST = /^[A-Z]{2}$/;
  function county(s) { return String(s || '').replace(/\s+(County|Parish|Borough|Census Area|City and Borough|Municipality)$/i, '').trim(); }
  function town(label) { var t = String(label || '').split(',')[0].trim(); return (/\d/.test(t) || t.length > 28) ? '' : t; }
  function bind(w) {
    function store() { try { return w.localStorage || null; } catch (e) { return null; } }
    function get(k) { var s = store(); try { return s ? s.getItem(k) : null; } catch (e) { return null; } }
    function set(k, v) { var s = store(); try { if (s) s.setItem(k, v); } catch (e) {} }
    function rec() { var o = null; try { o = JSON.parse(get('agsist-wx-loc') || 'null'); } catch (e) { o = null; } return o && typeof o === 'object' ? o : null; }
    function typed() { var z = String(get('agsist_zip') || ''); if (!ZIP.test(z)) z = String(get('agsist_user_zip') || ''); return ZIP.test(z) ? z : ''; }
    function coords(o) { return !!(o && o.lat != null && o.lon != null && isFinite(+o.lat) && isFinite(+o.lon)); }
    function typedWins(o, z) {
      if (!z) return false;
      var oz = o && ZIP.test(String(o.zip || '')) ? String(o.zip) : '';
      if (z === oz) return false;
      return !oz || !!o.zipTyped || !coords(o);
    }
    function read() {
      var o = rec(), z = typed();
      if (typedWins(o, z)) return { zip: z, state: '', county: '', town: '', lat: null, lon: null, typed: true };
      if (!o) return null;
      var oz = ZIP.test(String(o.zip || '')) ? String(o.zip) : '';
      if (!oz && !coords(o)) return null;
      return { zip: oz, state: ST.test(String(o.state || '')) ? o.state : '', county: county(o.county), town: town(o.label),
               lat: coords(o) ? +o.lat : null, lon: coords(o) ? +o.lon : null, typed: !!o.zipTyped };
    }
    function sync() {
      var o = rec(), z = typed();
      if (!typedWins(o, z)) return false;
      set('agsist-wx-loc', JSON.stringify({ zip: z, state: '', county: '', label: z, ts: Date.now(), zipTyped: true }));
      return true;
    }
    function tell(p) { try { w.dispatchEvent(new w.CustomEvent('agsist-place', { detail: p })); } catch (e) {} }
    var pending = null;
    function full() {
      var p = read();
      if (!p || !p.zip) return Promise.resolve(p);
      if (p.state && p.county && p.lat != null && p.town) return Promise.resolve(p);
      if (pending && pending.zip === p.zip) return pending.p;
      var z = p.zip;
      var pr = w.fetch('/data/places/zip/' + z.slice(0, 2) + '.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (t) {
          var r = t && t[z], q = read();
          if (!Array.isArray(r) || !q || q.zip !== z) return q;
          var st = ST.test(String(r[3] || '')) ? r[3] : '';
          var o = rec() || {};
          if (String(o.zip || '') === z) {
            if (!coords(o)) { o.lat = +r[0]; o.lon = +r[1]; o.label = r[2] ? r[2] + (st ? ', ' + st : '') : z; }
            if (!ST.test(String(o.state || ''))) o.state = st;
            if (!o.county && r[4]) o.county = String(r[4]);
            set('agsist-wx-loc', JSON.stringify(o));
          }
          var out = read() || q;
          if (!out.state) out.state = st;
          if (!out.county) out.county = county(r[4]);
          if (!out.town) out.town = town(r[2]);
          if (out.lat == null) { out.lat = +r[0]; out.lon = +r[1]; }
          tell(out);
          return out;
        })
        .catch(function () { return read(); });
      pending = { zip: z, p: pr };
      return pr;
    }
    function save(zip) {
      var z = String(zip || '');
      if (!ZIP.test(z)) return false;
      set('agsist_zip', z); set('agsist_user_zip', z);
      var o = rec();
      if (!o || String(o.zip || '') !== z) set('agsist-wx-loc', JSON.stringify({ zip: z, state: '', county: '', label: z, ts: Date.now(), zipTyped: true }));
      return true;
    }
    return { read: read, sync: sync, full: full, save: save, county: county };
  }
  return { bind: bind, county: county };
});
