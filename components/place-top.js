/* Fast Facts, My place: the answers at the top (Nov 11, 2026). components/here.js draws them; this
   file only words them, from the same objects the rows lower on the page are built from, so the top
   and the rows never disagree. Each card is null when its numbers are missing: the card is left out,
   never shown empty. Order: the best corn bid, the state spot, rain, cash rent, farmland sales.

     node --test test/place.test.mjs */
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make(require('./place.js'));
  else root.AgPlaceTop = make(root.AgPlace);
})(typeof window !== 'undefined' ? window : this, function (P) {
  'use strict';
  var MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function md(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? MON3[+m[2] - 1] + ' ' + (+m[3]) : ''; }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function one(x) { var r = Math.round(x * 10) / 10; return r % 1 ? r.toFixed(1) : String(r); }

  /* The best corn bid within the bid radius, with soybeans under it. b: P.bestBids(...) with the
     time the bids were read; the price is the lower row's own value (P.factBid). */
  function bid(b, when, partial) {
    var c = b && b.corn && b.corn.best;
    if (!c) return null;
    var row = P.factBid(b.corn, 'corn', '', when, '', partial), s = b.soybeans && b.soybeans.best;
    var sRow = s ? P.factBid(b.soybeans, 'soybeans', '', when, '', partial) : null;
    return { id: 'bid', price: row.value, mi: c.mi, delivery: P.deliveryWords(c), posted: md(when),
      soy: sRow && sRow.value != null ? { price: sRow.value, mi: s.mi } : null, partial: !!partial };
  }

  /* Drought in plain words: the worst category on at least half the county (else moderate drought
     if any, else abnormally dry), how much of the county, and against last week's map. The row lower
     on the page is built from this same object (droughtRow). */
  var NAMES = ['Abnormally dry', 'Moderate drought', 'Severe drought', 'Extreme drought', 'Exceptional drought'];
  function level(row) {
    if (!row || !(row[0] > 0)) return -1;
    var k = row[1] > 0 ? 1 : 0;
    for (var i = 4; i >= 1; i--) if (row[i] >= 50) { k = i; break; }
    return k;
  }
  function score(row) { return row ? row.reduce(function (a, v) { return a + (+v || 0); }, 0) : null; }
  function drought(file, fips) {
    var d = P.droughtNow(file, fips);
    if (!d || d.status !== 'ok') return null;
    var rows = file.c && file.c[fips], prev = rows ? rows[1] : (file.zero && file.zero.indexOf(fips) >= 0 ? [0, 0, 0, 0, 0] : null);
    var k = level(d.now), words, where;
    if (k < 0) { words = 'No drought'; where = 'and no part of the county is abnormally dry'; }
    else {
      var pct = Math.round(d.now[k]);
      words = NAMES[k];
      where = pct >= 100 ? 'across the whole county' : pct >= 50 ? 'across most of the county' : 'in ' + pct + '% of the county';
    }
    var change = null;
    if (prev) { var dl = score(d.now) - score(prev); change = Math.abs(dl) < 1 ? 'same as last week' : dl < 0 ? 'better than last week' : 'worse than last week'; }
    var rest = where + (change ? ', ' + change : '') + '.';
    return { id: 'drought', k: k, words: words, rest: rest, change: change, line: words + ' ' + rest, valid: d.valid };
  }
  function droughtRow(t) {
    var src = ['U.S. Drought Monitor', '/drought-monitor'];
    if (!t) return null;
    return { label: 'Drought', value: t.words, date: t.valid, join: ' ', ctx: t.rest, src: src, paper: 'U.S. Drought Monitor' };
  }

  /* Rain this month against normal (the same days, 1991 to 2020), and since Jan 1. r: P.rainSoFar. */
  function against(v, n) {
    if (!(n > 0)) return null;
    var x = v / n;
    if (x >= 1.95) return one(x) + ' times normal';
    if (x >= 0.9 && x <= 1.1) return 'about normal';
    return Math.round(x * 100) + '% of normal';
  }
  function rain(r) {
    if (!r || r.status !== 'ok' || !r.month || r.month.inches == null) return null;
    var m = r.month, ytd = r.pct == null ? null : r.pct >= 95 && r.pct <= 105 ? 'right at normal' : r.pct + '% of normal';
    return { id: 'rain', month: MONTHS[m.i], mon: MON3[m.i], inches: m.inches, normal: m.usual != null ? m.usual : null, words: against(m.inches, m.usual),
      year: r.inches, yearNormal: r.normal, yearWords: ytd, through: md(r.through), normals: r.normals,
      station: r.station && r.station.name ? r.station.name : null, mi: r.station ? Math.round(r.station.mi) : null };
  }

  /* Cash rent: the county's figure and its rank in the state. A survey more than three years old
     is left out (it shows as n/a on the rent pages). */
  function rent(col, stName, year) {
    if (!col || col.value == null) return null;
    if (col.year && year && year - col.year > 3) return null;
    var lead = col.pos == null ? '' : col.pos < 0.4 ? 'Lower than most of ' + stName : col.pos > 0.6 ? 'Higher than most of ' + stName : 'Near the middle of ' + stName;
    var w = String(col.words || '').replace(' ' + stName + ' counties', ' counties');
    return { id: 'rent', value: '$' + Math.round(col.value).toLocaleString('en-US'), year: col.year || null,
      rank: lead && w ? lead + ': ' + w + '.' : w ? cap(w) + '.' : '' };
  }

  /* What farmland sells for: the sales median the Atlas county page leads with. A: AtlasSales. */
  function land(sum, fips, A) {
    var c = sum && sum.counties && sum.counties[fips];
    if (!c || !c.med || c.med.med == null || !A) return null;
    var acres = sum.min_acres || 20;
    return { id: 'land', price: A.money(c.med.med), n: c.med.n, acres: acres, span: sum.windows && sum.windows.cur ? A.span(sum.windows.cur) : '', thru: A.thru(sum) };
  }

  /* The order on the page. The state spot sits under the first answer. */
  function order(cards) {
    var out = ['bid', 'rain', 'rent', 'land'].filter(function (k) { return cards[k]; });
    out.splice(out.length ? 1 : 0, 0, 'spot');
    return out;
  }

  return { bid: bid, drought: drought, droughtRow: droughtRow, rain: rain, against: against, rent: rent, land: land, order: order };
});
