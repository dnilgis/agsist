/* components/prism.js: daily weather history at a point from the PRISM grids (2026-10-29).
 *
 * It replaced Open-Meteo's ERA5 archive (Sig, Oct 29: Open-Meteo's terms count an ad-supported site as
 * commercial use). PRISM (Oregon State University, 4 km daily grids of observed max and min temperature
 * and precipitation, built from station reports) is read through RCC-ACIS GridData, grid 21, the same
 * host and grid Rain Print uses for a spot. Public, keyless. PRISM posts a day about a day late, so the
 * newest day or two can be missing; a missing day ("M" or -999) is null, never 0.
 *
 *   AgPRISM.daily(lat, lon, sdate, edate, {elems, get}) -> Promise of
 *     {daily: {time: [...], temperature_2m_max: [...], temperature_2m_min: [...], precipitation_sum: [...]},
 *      source: 'PRISM'}  (F and inches; the Open-Meteo field names the pages already read)
 *   rejects when ACIS does not answer or answers an error (the page fails soft).
 *   AgPRISM.url(lat, lon, sdate, edate, elems) -> the GridData address
 *   AgPRISM.credit -> {t, a, u, tail}
 */
(function (root) {
  'use strict';
  var HOST = 'https://data.rcc-acis.org/GridData';
  var NAMES = { maxt: 'temperature_2m_max', mint: 'temperature_2m_min', pcpn: 'precipitation_sum', avgt: 'temperature_2m_mean' };
  function url(lat, lon, sdate, edate, elems) {
    var p = JSON.stringify({ loc: (+lon).toFixed(3) + ',' + (+lat).toFixed(3), grid: '21', sdate: sdate, edate: edate, elems: (elems || ['maxt', 'mint', 'pcpn']).join(',') });
    return HOST + '?params=' + encodeURIComponent(p);
  }
  function val(x) { var n = +x; return (x !== null && x !== '' && x !== 'M' && isFinite(n) && n > -998) ? n : null; }
  function parse(j, elems) {
    if (!j || j.error || !Array.isArray(j.data)) throw new Error('PRISM: ' + ((j && j.error) || 'no data'));
    var D = { time: [] };
    elems.forEach(function (e) { D[NAMES[e] || e] = []; });
    j.data.forEach(function (r) {
      D.time.push(r[0]);
      elems.forEach(function (e, k) { D[NAMES[e] || e].push(val(r[k + 1])); });
    });
    return { daily: D, source: 'PRISM' };
  }
  function daily(lat, lon, sdate, edate, o) {
    o = o || {};
    var elems = o.elems || ['maxt', 'mint', 'pcpn'];
    return (o.get || fetch)(url(lat, lon, sdate, edate, elems)).then(function (r) {
      if (!r.ok) throw new Error('ACIS ' + r.status);
      return r.json();
    }).then(function (j) { return parse(j, elems); });
  }
  var OUT = { daily: daily, url: url, parse: parse,
    credit: { t: 'Weather history:', a: 'PRISM Climate Group, Oregon State University', u: 'https://prism.oregonstate.edu/', tail: 'daily 4 km grids, through RCC-ACIS (rcc-acis.org).' } };
  if (typeof module === 'object' && module.exports) module.exports = OUT;
  else root.AgPRISM = OUT;
})(typeof window !== 'undefined' ? window : this);
