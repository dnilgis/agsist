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

   THE RULE LIVES HERE AND IN scripts/bid_rule.py (Python, the same rule row
   for row: test/bid-rule.test.mjs runs both on the same real rows). The word
   lists that still sit in components/cash-bids.js, components/bids-homepage.js
   and components/daily-local.js are kept for the tests that lift those
   functions by name; test/bid-filter.test.mjs fails the day one drifts from
   this file. Every "best" pick calls isPlainCurrent() or pickBest() below.

   Loaded as a plain script (window.AG.bidFilter) and as a module in tests. */
(function (root) {
  'use strict';

  /* The words the feed actually carries for a different product. Nov 20, 2026:
     "Plenish Soybean" (Yoder Grain, +105 basis) was the top soybean bid near
     Bluffton IN on the home page, the Daily and /daily while plain beans paid
     $1.05 less; "Ip Soybeans" (identity preserved) and high oleic, food grade,
     waxy, popcorn, conventional and the soy food words were missing too.
     Ethanol-plant corn ("Badger State Ethanol Corn" -20, "HCP Corn" -60 at
     Al-Corn) is plain #2 yellow delivered to a plant, with an ordinary basis,
     so it stays a plain bid. "Gmo Beans" is plain too (no "non"). */
  var SPECIAL_GRADE = /non[- ]?gmo|nongmo|organic|plenish|\bip\b|identity[- ]?pres|high[- ]?oleic|food[- ]?grade|\bfood\b|waxy|popcorn|conventional|vistive|clear hilum|tofu|natto|\bwhite\b|\bfeed\b|durum|\bsww\b|spring|\bhrs\b|\bdns\b|dark northern|mgex/i;
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
    var v = b.cashPrice != null ? b.cashPrice : b.cash != null ? b.cash : b.bid_price != null ? b.bid_price : b.bidPrice != null ? b.bidPrice : b.price;
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

  /* ── THE CURRENT DELIVERY WINDOW ──────────────────────────────────────────
     Nov 20, 2026: Adell Cooperative WI posts only "27 New Crop" (newcrop-2027,
     Sep-Dec 2027) and /cash-bids, Fast Facts, the Atlas county page and the
     County Print called its $4.25 the best corn beside current bids of $3.70 to
     $3.80. A bid for delivery ten months out is a different contract. A row is
     CURRENT when its period is
       spot                                   window "now"
       this month (Central time)              "now"
       a month 1 or 2 months out              that month (not more than 2 out)
       a range open now ending at most 2 out  "now" (a licensed feed window "Oct 1 to
                                              Jan 19" is current when January alone is)
       a range not open yet                   its first month, judged as a month is (1 or
                                              2 out), so 2027-01/2027-03 and 2027-01 agree
       this harvest's new crop while open     "now" inside Sep-Dec (corn, soybeans,
                                              sorghum) or Jun-Sep (wheat, oats);
                                              1 or 2 months before it, its first month
       an old crop inside its crop year       "now" (oldcrop-YYYY: the YYYY harvest,
                                              Sep YYYY to Aug YYYY+1; Jun to May for
                                              wheat, oats, barley)
     Anything else (next year's new crop, a month 3+ out, a closed month, a row
     with no period) is not current and never sets a best. The season windows are
     the ones in components/bid-period.js and dnilgis/bids merge_bids.mjs
     (test/bid-rule.test.mjs holds them equal). scripts/bid_rule.py is the same
     rule in Python, row for row (the parity test runs both on the same rows).

     A CROSS-BOARD BEST COMPARES ONE WINDOW. windowKey() is "now" or a "YYYY-MM";
     pickBest() keeps the earliest key any candidate has and takes the highest
     cash in it, so a December bid never beats a spot bid and a Harvest 2027
     bid never enters at all. When the plain current row is missing (the bids
     index `now` field can hold a premium row today), the board has no best:
     nothing is shown rather than the premium. */
  var WIN = { corn: [9, 12], soybeans: [9, 12], sorghum: [9, 12], wheat: [6, 9], oats: [6, 9] };
  var CY_START = { wheat: 6, oats: 6, barley: 6 };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* Months since year 0 of `now` in Central time. now: a Date, a millisecond
     count, or a "YYYY-MM[-DD]" day. */
  function nowMonth(now) {
    if (typeof now === 'string') {
      var s = /^(\d{4})-(\d{2})/.exec(now);
      return s ? +s[1] * 12 + (+s[2] - 1) : null;
    }
    var d = now == null ? new Date() : (now instanceof Date ? now : new Date(now));
    if (isNaN(d)) return null;
    var y, m;
    try {
      var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit' }).formatToParts(d);
      parts.forEach(function (p) { if (p.type === 'year') y = +p.value; if (p.type === 'month') m = +p.value; });
    } catch (e) { y = null; }
    if (!y || !m) { var c = new Date(d.getTime() - 6 * 36e5); y = c.getUTCFullYear(); m = c.getUTCMonth() + 1; }
    return y * 12 + (m - 1);
  }
  function ym(i) { return Math.floor(i / 12) + '-' + ('0' + (i % 12 + 1)).slice(-2); }
  function cropOf(b) {
    var c = String(b && (b.category || b.crop || b.netCrop) || '').toLowerCase();
    return WIN[c] || CY_START[c] ? c : (categoryOf(b) || c);
  }
  /* The row's period: the bids network's `period` ("2026-11", "2026-10/2026-12",
     "spot", "newcrop-2026"), a page row's deliveryPeriod or deliveryStart, with
     a "YYYY-MM-DD" deliveryEnd making a single month into a range. */
  function periodOf(b) {
    var p = String(b && (b.period || b.deliveryPeriod || b.deliveryStart) || '').trim().toLowerCase();
    var one = /^(\d{4})-(\d{2})(?:-\d{2})?(?:[ t].*)?$/.exec(p);
    var e = /^(\d{4})-(\d{2})/.exec(String(b && b.deliveryEnd || '').trim());
    if (one) return one[1] + '-' + one[2] + (e && (e[1] + '-' + e[2]) !== (one[1] + '-' + one[2]) ? '/' + e[1] + '-' + e[2] : '');
    if (!p && e) return e[1] + '-' + e[2];             /* only an end date: that month */
    return p;
  }
  /* "now", a "YYYY-MM" (a month 1-2 out), or null (not current). */
  function windowKey(b, now) {
    var cur = nowMonth(now);
    if (cur == null || !b || b.periodPast === true) return null;
    var p = periodOf(b), m;
    if (p === 'spot') return 'now';
    if ((m = /^(\d{4})-(\d{2})(?:\/(\d{4})-(\d{2}))?$/.exec(p))) {
      var st = +m[1] * 12 + (+m[2] - 1), en = m[3] ? +m[3] * 12 + (+m[4] - 1) : st;
      if (en < st || +m[2] < 1 || +m[2] > 12) return null;
      if (en < cur) return null;                     /* closed */
      if (st > cur) return st - cur <= 2 ? ym(st) : null;   /* not open yet: its START, as a month is judged */
      return en - cur <= 2 ? 'now' : null;           /* open now: its END at most 2 months out */
    }
    var s;
    if ((m = /^newcrop-(\d{4})$/.exec(p))) {
      var w = WIN[cropOf(b)];
      if (!w) return null;
      s = +m[1] * 12 + (w[0] - 1);
      var e2 = +m[1] * 12 + (w[1] - 1);
      if (cur >= s && cur <= e2) return 'now';
      return s > cur && s - cur <= 2 ? ym(s) : null;
    }
    if ((m = /^oldcrop-(\d{4})$/.exec(p))) {
      var a = CY_START[cropOf(b)] || 9;
      s = +m[1] * 12 + (a - 1);
      if (cur >= s && cur <= s + 11) return 'now';
      return s > cur && s - cur <= 2 ? ym(s) : null;
    }
    return null;
  }
  function isCurrent(b, now) { return windowKey(b, now) != null; }
  /* A page that ranks each wheat class on its own (HRS against HRS, never
     against SRW) passes { wheatClasses: true }: on a wheat row the class words
     are a class, not a grade. Every other special word still is. */
  var WHEAT_CLASS_WORDS = /spring|\bhrs\b|\bdns\b|dark northern|mgex|\bsww\b|soft white|hard white|white wheat|\bwhite\b|durum/ig;
  function gradeOk(b, opts) {
    if (!isSpecialGrade(b)) return true;
    if (!(opts && opts.wheatClasses) || cropOf(b) !== 'wheat') return false;
    return !SPECIAL_GRADE.test(name(b).replace(WHEAT_CLASS_WORDS, ' '));
  }
  /* THE question for every "best", "top" or "highest" bid. */
  function isPlainCurrent(b, now, opts) {
    return !!b && gradeOk(b, opts) && !notPerBushel(b) && plausible(b) && isCurrent(b, now);
  }
  /* The best of `items` (rows, or anything `opts.row` maps to a row): plain,
     current, in the earliest window any of them has, highest cash; the first
     one wins a tie (callers sort by distance first). null when none qualifies. */
  function pickBest(items, now, opts) {
    opts = opts || {};
    var rowOf = opts.row || function (x) { return x; };
    var cashFn = opts.cash || function (x) { return ppu(cashOf(rowOf(x))); };
    var pool = [], first = null;
    (items || []).forEach(function (x) {
      var r = rowOf(x);
      if (!isPlainCurrent(r, now, opts)) return;
      var c = cashFn(x);
      if (c == null || !isFinite(c)) return;
      var k = windowKey(r, now);
      pool.push({ x: x, k: k, c: c });
      if (first == null || k === 'now' || (first !== 'now' && k < first)) first = k;
    });
    var best = null;
    pool.forEach(function (o) { if (o.k === first && (!best || o.c > best.c)) best = o; });
    return best ? best.x : null;
  }
  /* What a best line prints for the delivery: '' for spot and this month,
     else "Dec", "Jan '27", "Oct-Dec" (a range open now), "Harvest 2026". */
  function deliveryWords(b, now) {
    var cur = nowMonth(now), p = periodOf(b), m;
    if (cur == null || p === 'spot') return '';
    var curY = Math.floor(cur / 12);
    function mon(i) { return MON[i % 12] + (Math.floor(i / 12) === curY ? '' : " '" + String(Math.floor(i / 12)).slice(2)); }
    if ((m = /^(\d{4})-(\d{2})(?:\/(\d{4})-(\d{2}))?$/.exec(p))) {
      var st = +m[1] * 12 + (+m[2] - 1), en = m[3] ? +m[3] * 12 + (+m[4] - 1) : st;
      if (en === st) return st === cur ? '' : mon(st);
      return mon(st) + '–' + mon(en);
    }
    if ((m = /^newcrop-(\d{4})$/.exec(p))) return 'Harvest ' + m[1];
    if ((m = /^oldcrop-(\d{4})$/.exec(p))) return 'Old crop ' + m[1];
    return '';
  }

  var api = {
    SPECIAL_GRADE: SPECIAL_GRADE, NOT_PER_BUSHEL: NOT_PER_BUSHEL, PER_CWT: PER_CWT, PPU_BAND: PPU_BAND,
    WINDOWS: WIN, CROP_YEAR_START: CY_START,
    isSpecialGrade: isSpecialGrade, notPerBushel: notPerBushel, plausible: plausible, ppu: ppu,
    canSetBest: canSetBest, gradeOk: gradeOk, WHEAT_CLASS_WORDS: WHEAT_CLASS_WORDS,
    periodOf: periodOf, windowKey: windowKey, isCurrent: isCurrent,
    isPlainCurrent: isPlainCurrent, pickBest: pickBest, deliveryWords: deliveryWords, nowMonth: nowMonth
  };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AG = root.AG || {};
  root.AG.bidFilter = api;
})(typeof window !== 'undefined' ? window : this);
