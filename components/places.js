/* components/places.js: our own place lookup (2026-10-29).
 *
 * A ZIP code or a town name to a point, from files we serve (data/places/, built by
 * scripts/build_places.py from GeoNames and the zipcodes table the bids repo uses).
 * It replaced Open-Meteo's geocoder, whose terms count ad-supported sites as
 * commercial use. It answers in the shape the pages already read:
 *   {results: [{name, latitude, longitude, admin1 (state or province, full name),
 *               admin2 (county), country_code, postcodes, population, approx}]}
 * approx is true for a town known only from its ZIP codes: its point is the middle
 * of those ZIP points, not the town's own.
 *
 *   AGSIST_PLACES.search(q, {country: 'US' | 'CA', count: 10, get: fetchLike})
 *   AGSIST_PLACES.zip('54728', {get})   -> one result or null
 *   AGSIST_PLACES.fold('St. Paul')      -> 'saintpaul' (the same key the build uses)
 *
 * A file that does not answer rejects (the caller says the lookup did not answer);
 * a place that is not in the files resolves to {results: []}.
 */
(function (root) {
  'use strict';
  var BASE = '/data/places/';
  var STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
    DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
    KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
    MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
    NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
    SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
    WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico' };
  var PROVS = { AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador', NS: 'Nova Scotia',
    NT: 'Northwest Territories', NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon' };

  // the same folding as scripts/build_places.py fold()
  function fold(s) {
    s = String(s == null ? '' : s);
    if (s.normalize) s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    s = s.toLowerCase().replace(/[-'’.,]/g, ' ');
    s = s.replace(/\bste\s+/g, 'sainte ').replace(/\bst\s+/g, 'saint ').replace(/\bmt\s+/g, 'mount ').replace(/\bft\s+/g, 'fort ');
    return s.replace(/[^a-z]/g, '');
  }
  function shardKey(k) { return (k + '__').slice(0, 2); }

  function defaultGet(url) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, 10000) : null;
    return fetch(url, ctl ? { signal: ctl.signal } : undefined).then(function (r) { if (t) clearTimeout(t); return r; }, function (e) { if (t) clearTimeout(t); throw e; });
  }

  function make(o) {
    o = o || {};
    var base = o.base || BASE, cache = {};
    function file(url, get) {
      if (!cache[url]) {
        cache[url] = (get || o.get || defaultGet)(url).then(function (r) {
          if (r.status === 404) return null;   // no such shard: nothing by that name
          if (!r.ok) throw new Error('places ' + r.status);
          return r.json();
        }).then(null, function (e) { delete cache[url]; throw e; });
      }
      return cache[url];
    }
    function zipRow(code, v) {
      return { name: v[2] || code, latitude: +v[0], longitude: +v[1], admin1: STATES[v[3]] || v[3] || '', admin2: v[4] || '',
        country_code: 'US', postcodes: [code], zip: code, st: v[3] || '', src: 'zip' };
    }
    function zip(code, opt) {
      code = String(code || '').trim().slice(0, 5);
      if (!/^\d{5}$/.test(code)) return Promise.resolve(null);
      return file(base + 'zip/' + code.slice(0, 2) + '.json', opt && opt.get).then(function (t) {
        var v = t && t[code];
        return Array.isArray(v) && isFinite(+v[0]) && isFinite(+v[1]) ? zipRow(code, v) : null;
      });
    }
    function townRow(p, cc) {
      var zips = p[6] ? String(p[6]).split(' ') : [];
      return { name: p[0], latitude: +p[2], longitude: +p[3], admin1: (cc === 'CA' ? PROVS : STATES)[p[1]] || p[1], admin2: p[4] || '',
        country_code: cc, postcodes: zips, population: p[5] || 0, st: p[1], approx: p[7] === 'z', src: p[7] === 'z' ? 'zip-town' : 'town' };
    }
    function search(q, opt) {
      opt = opt || {};
      var cc = String(opt.country || 'US').toUpperCase() === 'CA' ? 'CA' : 'US', count = opt.count || 10;
      q = String(q == null ? '' : q).trim();
      if (cc === 'US' && /^\d{5}(-\d{4})?$/.test(q)) return zip(q, opt).then(function (r) { return { results: r ? [r] : [] }; });
      var k = fold(q);
      if (!k) return Promise.resolve({ results: [] });
      return file(base + cc.toLowerCase() + '/' + shardKey(k) + '.json', opt.get).then(function (t) {
        var list = (t && t.p) || [], hit = list.filter(function (p) { return fold(p[0]) === k; });
        if (!hit.length && k.length >= 3) hit = list.filter(function (p) { return fold(p[0]).indexOf(k) === 0; });
        return { results: hit.slice(0, count).map(function (p) { return townRow(p, cc); }) };
      });
    }
    return { search: search, zip: zip, fold: fold, STATES: STATES, PROVS: PROVS };
  }

  var api = make();
  api.make = make;
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AGSIST_PLACES = api;
})(typeof window !== 'undefined' ? window : this);
