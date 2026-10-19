/* Parcel key: "<county fips>:<normalized parcel number>", one per parcel, so every sale of a
   parcel joins however the county wrote its number. Twin of parcel_key() in scripts/build_ids.py;
   test/ids.test.mjs checks the two agree on data/ids/parcel-key-fixtures.json.
     IL  letters and digits, upper case (a county's PINs are fixed width). Cook (17031): a
         14-digit PIN ending in a 0000 unit is the 10-digit PIN.
     IN  digits of the 18-digit state parcel number; a 17-digit number gets its dropped leading
         zero back only when that makes the first two digits the county number, (fips + 1) / 2.
     WI  each run of digits without leading zeros, letters kept, joined with "-".
     any other state: letters and digits, upper case. */
(function (G) {
  'use strict';
  function clean(s) { return s == null ? '' : String(s).replace(/\s+/g, ' ').trim(); }
  function parcelKey(fips, pid) {
    var f = String(fips == null ? '' : fips).replace(/\D/g, ''), s = clean(pid).toUpperCase();
    if (f.length !== 5 || !s) return null;
    var strip = s.replace(/[^A-Z0-9]/g, '');
    if (!strip || /^0+$/.test(strip)) return null;
    var st = f.slice(0, 2);
    if (st === '17') {
      if (f === '17031' && /^\d{10}0000$/.test(strip)) strip = strip.slice(0, 10);
      return f + ':' + strip;
    }
    if (st === '18') {
      var d = s.replace(/\D/g, '');
      if (!d || /^0+$/.test(d)) return null;
      var n = Math.floor((parseInt(f.slice(2), 10) + 1) / 2), cn = (n < 10 ? '0' : '') + n;
      if (d.length === 17 && ('0' + d).slice(0, 2) === cn && d.slice(0, 2) !== cn) d = '0' + d;
      return f + ':' + d;
    }
    if (st === '55') {
      return f + ':' + (s.match(/[A-Z]+|[0-9]+/g) || []).map(function (r) { return /^[0-9]+$/.test(r) ? r.replace(/^0+(?=\d)/, '') : r; }).join('-');
    }
    return f + ':' + strip;
  }
  var api = { parcelKey: parcelKey };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  G.AGIds = G.AGIds || {};
  G.AGIds.parcelKey = parcelKey;
})(typeof window !== 'undefined' ? window : this);
