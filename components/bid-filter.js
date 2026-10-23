/* components/bid-filter.js -- THE ONE TEST FOR "CAN THIS ROW BE A BEST BID".

   A best, highest or top bid is the best price a farmer can sell the plain
   commodity at. A row is left out of that pick when it is
     - a special grade (organic, non-GMO, white, feed, durum, spring wheat...),
       which is a different product from the one the futures price;
     - not a bushel price (meal, hulls, oil, peas, a cwt quote);
     - outside its own crop's price band, which is a unit mismatch, not a price.
   Such a row is still shown on the elevator's own board; it never sets the
   number that says "highest".

   WHY THIS FILE EXISTS. 2026-10-23: the corn futures page showed Baring
   Elevator, MO, "Organic Yellow Corn" at $11.50 as the highest checked bid in
   the sample for 13 of 50 grid ZIPs. The home page and the Daily already kept
   special grades out; the futures page had no such filter. Each page had grown
   its own copy of the word list, and one copy was missing.

   THE REGEX AND THE BANDS LIVE HERE AND IN scripts/local_bid.py. The copies
   that still sit in components/cash-bids.js, components/bids-homepage.js,
   components/daily-local.js and scripts/daily_edge.py cannot be removed
   without breaking the tests that lift those functions by name, so
   test/bid-filter.test.mjs reads every copy and fails the day one drifts from
   this file.

   Loaded as a plain script (window.AG.bidFilter) and as a module in tests. */
(function (root) {
  'use strict';

  /* The words the feed actually carries for a different product. */
  var SPECIAL_GRADE = /non[- ]?gmo|organic|\bwhite\b|\bfeed\b|durum|\bsww\b|spring|\bhrs\b|\bdns\b|dark northern|mgex/i;
  var NOT_PER_BUSHEL = /\b(meal|hulls?|pellets?|oil|flour|ddg|distillers|gluten|canola|peas?)\b/i;
  var PER_CWT = /\bcwt\b|hundredweight/i;
  var PPU_BAND = { corn: [2, 12], soybeans: [6, 32], wheat: [3, 20], sorghum: [2, 6], oats: [1, 8] };

  function name(b) { return String(b && (b.commodity || b.commodityName || b.commodity_name || b.crop) || ''); }
  function isSpecialGrade(b) { return SPECIAL_GRADE.test(name(b)); }
  function notPerBushel(b) { return NOT_PER_BUSHEL.test(name(b)); }
  function ppu(raw) { return raw == null ? null : (raw > 30 ? raw / 100 : raw); }

  /* Which band: the row's category when it has one (the feed's own word), else
     read from the commodity name. A row with no band is not our call. */
  function categoryOf(b) {
    if (b && b.category && PPU_BAND[b.category]) return b.category;
    var n = name(b).toLowerCase();
    if (n.indexOf('corn') >= 0) return 'corn';
    if (n.indexOf('soy') >= 0 || n === 'beans') return 'soybeans';
    if (n.indexOf('wheat') >= 0) return 'wheat';
    return null;
  }
  function cashOf(b) {
    var v = b.cashPrice != null ? b.cashPrice : b.bid_price != null ? b.bid_price : b.bidPrice != null ? b.bidPrice : b.price;
    var n = Number(v);
    return v == null || !isFinite(n) ? null : n;
  }
  function plausible(b) {
    var band = PPU_BAND[categoryOf(b)];
    if (!band) return true;
    if (PER_CWT.test(name(b))) return false;
    var p = ppu(cashOf(b));
    return p != null && p >= band[0] && p <= band[1];
  }

  /* The one question. */
  function canSetBest(b) { return !!b && !isSpecialGrade(b) && !notPerBushel(b) && plausible(b); }

  var api = {
    SPECIAL_GRADE: SPECIAL_GRADE, NOT_PER_BUSHEL: NOT_PER_BUSHEL, PER_CWT: PER_CWT, PPU_BAND: PPU_BAND,
    isSpecialGrade: isSpecialGrade, notPerBushel: notPerBushel, plausible: plausible, ppu: ppu,
    canSetBest: canSetBest
  };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AG = root.AG || {};
  root.AG.bidFilter = api;
})(typeof window !== 'undefined' ? window : this);
