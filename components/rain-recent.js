/* rain-recent.js: the "Lately" line on a county rain page takes the radar's newer numbers (Nov 19, 2026).

   WHY. A county page is built once a day with the radar's county averages as that run saw them
   (scripts/build_county_rain.py recent_box, from data/rain/recent/<st>.json). The radar runs every 6 hours and
   writes data/radar-rain/county-<st>.json (scripts/radar_county.py). When that file ends later than the baked line,
   this puts its two numbers and its end time in the same places, in the same words, so the line never moves (the
   numbers sit in fixed-width boxes, components/rain-county.css).

   RULES
   - Only a newer end time replaces anything; an older, broken or missing file leaves the baked line as it is.
   - Both numbers or neither: a county with a null window keeps the baked pair and time.
   - The time is said as the builder says it (recent_when): "1 am Central, Nov 19", the state's zone named.
   - The state and its zone come from the county's FIPS code (twins of TZ_OF in the builder), so the page carries
     only the FIPS code and the end time (the rain set sits at its folder budget).
   - Nothing is sent anywhere; one GET of our own file.

   window.AgRainRecent = { when, apply, stateOf }; node: module.exports (test/rain-cb-first.test.mjs). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object' && typeof root.document !== 'undefined') {
    root.AgRainRecent = api;
    var run = function () { try { api.boot(root); } catch (e) {} };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', run); else run();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var ST = {};
  ('01AL 02AK 04AZ 05AR 06CA 08CO 09CT 10DE 11DC 12FL 13GA 15HI 16ID 17IL 18IN 19IA 20KS 21KY 22LA 23ME 24MD 25MA 26MI ' +
   '27MN 28MS 29MO 30MT 31NE 32NV 33NH 34NJ 35NM 36NY 37NC 38ND 39OH 40OK 41OR 42PA 44RI 45SC 46SD 47TN 48TX 49UT 50VT ' +
   '51VA 53WA 54WV 55WI 56WY').split(' ').forEach(function (x) { ST[x.slice(0, 2)] = x.slice(2); });
  var ZONES = [
    ['America/New_York', 'Eastern', 'CT DC DE FL GA IN KY MA MD ME MI NC NH NJ NY OH PA RI SC VA VT WV'],
    ['America/Chicago', 'Central', 'AL AR IA IL KS LA MN MO MS ND NE OK SD TN TX WI'],
    ['America/Denver', 'Mountain', 'CO ID MT NM UT WY'],
    ['America/Phoenix', 'Mountain', 'AZ'],
    ['America/Los_Angeles', 'Pacific', 'CA NV OR WA']
  ];
  var TZ = {};
  ZONES.forEach(function (z) { z[2].split(' ').forEach(function (s) { TZ[s] = [z[0], z[1]]; }); });

  /* '19167' -> 'IA' ('' when unknown) */
  function stateOf(fips) { return ST[String(fips || '').slice(0, 2)] || ''; }

  /* '2026-11-19T07:00:00Z', 'IA' -> '1 am Central, Nov 19' */
  function when(iso, st) {
    var d = new Date(iso), z = TZ[st];
    if (isNaN(d) || !z) return '';
    var p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: z[0], hour: 'numeric', minute: '2-digit', hourCycle: 'h23', month: 'numeric', day: 'numeric' })
      .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    var h = +p.hour % 24, m = +p.minute, h12 = h % 12 || 12;
    return h12 + (m ? ':' + (m < 10 ? '0' : '') + m : '') + ' ' + (h < 12 ? 'am' : 'pm') + ' ' + z[1] + ', ' + MON[+p.month - 1] + ' ' + (+p.day);
  }

  /* Put doc's numbers in the line when doc ends later. -> true when the line changed. */
  function apply(line, doc) {
    if (!line || !doc || typeof doc !== 'object') return false;
    var fips = line.getAttribute('data-f'), have = line.getAttribute('data-e') || '';
    var end = String(doc.data_end || '');
    var v = doc.counties && doc.counties[fips];
    if (!end || !(Date.parse(end) > Date.parse(have))) return false;
    if (!v || v.length < 2 || v[0] == null || v[1] == null || !isFinite(v[0]) || !isFinite(v[1])) return false;
    var bs = line.querySelectorAll('b'), t = line.querySelector('time');
    if (bs.length !== 3 || !t) return false;      // Lately, then the two numbers
    var said = when(end, stateOf(fips));
    if (!said) return false;
    bs[1].textContent = (v[0] / 100).toFixed(2);
    bs[2].textContent = (v[1] / 100).toFixed(2);
    t.textContent = said;
    line.setAttribute('data-e', end);
    return true;
  }

  function boot(w) {
    var line = w.document.querySelector('.rc-now[data-f]');
    if (!line || typeof w.fetch !== 'function') return;
    var st = stateOf(line.getAttribute('data-f')).toLowerCase();
    if (!st) return;
    w.fetch('/data/radar-rain/county-' + st + '.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (doc) { apply(line, doc); })
      .catch(function () {});
  }

  return { when: when, apply: apply, stateOf: stateOf, boot: boot };
});
