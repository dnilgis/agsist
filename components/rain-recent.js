/* rain-recent.js: the "Lately" box on a county rain page takes the radar's newer numbers (Nov 19, 2026).

   WHY. A county page is built once a day with the radar's county averages as that run saw them
   (scripts/build_county_rain.py recent_box, from data/rain/recent/<st>.json). The radar runs every 6 hours and
   writes data/radar-rain/county-<st>.json (scripts/radar_county.py). When that file ends later than the baked box,
   this puts its numbers and end time in the same places, in the same words, so the box never moves.

   RULES
   - Only a newer end time replaces anything; an older, broken or missing file leaves the baked box as it is.
   - Both numbers or neither: a county with a null window keeps the baked pair and time.
   - The time is said as the builder says it (recent_when): "1 am Central, Nov 19", the state's zone named.
   - Nothing is sent anywhere; one GET of our own file.

   window.AgRainRecent = { when, apply }; node: module.exports (test/rain-recent.test.mjs). */
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
  /* the zone's name as the builder says it (TZ_OF in scripts/build_county_rain.py) */
  var TZN = { 'America/New_York': 'Eastern', 'America/Chicago': 'Central', 'America/Denver': 'Mountain', 'America/Phoenix': 'Mountain', 'America/Los_Angeles': 'Pacific' };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* '2026-11-19T07:00:00Z', 'America/Chicago', 'Central' -> '1 am Central, Nov 19' */
  function when(iso, tz, tzn) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hourCycle: 'h23', month: 'numeric', day: 'numeric' })
      .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    var h = +p.hour % 24, m = +p.minute, h12 = h % 12 || 12;
    return h12 + (m ? ':' + (m < 10 ? '0' : '') + m : '') + ' ' + (h < 12 ? 'am' : 'pm') + ' ' + tzn + ', ' + MON[+p.month - 1] + ' ' + (+p.day);
  }

  /* Put doc's numbers in box when doc ends later. -> true when the box changed. */
  function apply(box, doc) {
    if (!box || !doc || typeof doc !== 'object') return false;
    var fips = box.getAttribute('data-fips'), have = box.getAttribute('data-end') || '';
    var end = String(doc.data_end || '');
    var v = doc.counties && doc.counties[fips];
    if (!end || !(Date.parse(end) > Date.parse(have))) return false;
    if (!v || v.length < 2 || v[0] == null || v[1] == null || !isFinite(v[0]) || !isFinite(v[1])) return false;
    var dds = box.querySelectorAll('dd'), t = box.querySelector('time'), tz = box.getAttribute('data-tz');
    if (dds.length !== 2 || !t || !TZN[tz]) return false;
    var said = when(end, tz, TZN[tz]);
    if (!said) return false;
    for (var i = 0; i < 2; i++) {
      var n = dds[i].firstChild;
      if (n && n.nodeType === 3) n.nodeValue = (v[i] / 100).toFixed(2) + ' ';
    }
    t.textContent = said;
    box.setAttribute('data-end', end);
    return true;
  }

  function boot(w) {
    var box = w.document.querySelector('.rc-now[data-st][data-fips]');
    if (!box || typeof w.fetch !== 'function') return;
    var st = String(box.getAttribute('data-st') || '').toLowerCase();
    if (!/^[a-z]{2}$/.test(st)) return;
    w.fetch('/data/radar-rain/county-' + st + '.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (doc) { apply(box, doc); })
      .catch(function () {});
  }

  return { when: when, apply: apply, boot: boot };
});
