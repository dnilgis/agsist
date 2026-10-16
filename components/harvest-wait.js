/* harvest-wait.js: the arithmetic behind /harvest-or-wait (2026-10-16).
 *
 * Pure functions, no DOM. The page (harvest-wait-ui.js), the baker
 * (scripts/build_harvest_wait.mjs) and the tests (test/harvest-wait.test.mjs)
 * all run this same file.
 *
 * FIELD DRYDOWN, BY THE CALENDAR (what the page uses today).
 *   Points of moisture lost a week in standing corn, by month:
 *     Sep 4.5, Oct 2.5, Nov 1.0, Dec 0.5
 *   Hellevang, NDSU, "Post-harvest tips for later maturing corn" (2009), the
 *   "Estimated corn field drying" table; Iowa State ICM, "Options for fall
 *   grain drying and marketing" (Oct 20, 2022) gives the same four numbers.
 *   The same NDSU table gives the month's equilibrium moisture, the moisture
 *   standing corn dries toward: Sep 15, Oct 16, Nov 19, Dec 20. Corn at or
 *   under that is not dried any further here.
 *   Cross-check in the same NDSU paper: "Corn at 35% moisture content on
 *   October 11 might be expected to dry to about 27% by November 1 and about
 *   22% by December 1." The tests run that.
 *
 * FIELD DRYDOWN, BY FORECAST HEAT (built, switched off).
 *   GDD (86/50) per point of moisture by band. GDD_RULE.checked stays false
 *   until the band numbers are read in the cited source on the references
 *   branch (purdue-grain-drydown). While false the page shows the forecast
 *   heat for reference and never turns it into a moisture.
 *
 * DRYING COST.
 *   LP: gallons = 0.018 x wet bushels x points removed. Iowa State ICM 2022
 *   (same article): "0.018 gallons is an average propane usage estimate, this
 *   may range from 0.010 to 0.025 gallons per bushel per point of moisture
 *   removed depending on the drying system and outdoor temperature."
 *   Or the reader's own cents a bushel a point (their dryer, or the
 *   elevator's drying charge).
 *   Cross-check: Purdue GQ-3 (Uhrig and Maier, 1992) Table 1, BTU a bushel in
 *   a column dryer at 100 cfm/bu and 180 F, and LP at 92,000 BTU a gallon:
 *   fuel $/bu = BTU/bu x $/gal / 92,000. 28% to 15% at 60 cents: 13.5 cents.
 *
 * WAIT OR GO.
 *   Yield is dry bushels an acre at the dry-to moisture (15.5% unless the
 *   reader changes it). The dry matter on the stalk is the same either way;
 *   only the water changes. Wet bushels into the dryer:
 *     wet bu = dry bu x (100 - dry-to) / (100 - moisture)
 *   Drying saved by waiting = cost now - cost later, per acre.
 *   Field loss is the reader's number, in bushels an acre a week. With none
 *   entered the page gives the break-even: the loss that eats the savings,
 *     break-even bu/ac = drying saved / bid      (Purdue GQ-3's own framing:
 *     "a field loss of 3.5 bushels per acre would pay for the additional fuel")
 */
(function (root) {
  'use strict';

  function num(v) { return typeof v === 'number' && isFinite(v); }

  /* NDSU 2009 table, Sep through Dec; ISU 2022 agrees on the weekly points.
     Months outside are left out: the page does not guess them. */
  var CAL = {
    weekly: { 9: 4.5, 10: 2.5, 11: 1.0, 12: 0.5 },
    emc:    { 9: 15,  10: 16,  11: 19,  12: 20 }
  };

  /* Off until read in the source. See the header. */
  var GDD_RULE = {
    checked: false,
    source: 'purdue-grain-drydown',
    bands: [ { hi: 30, lo: 25, gddPerPt: 30 }, { hi: 25, lo: 20, gddPerPt: 45 } ]
  };

  var LP_BTU_PER_GAL = 92000;          /* Purdue GQ-3 Table 2 */
  var LP_GAL_PER_BU_PT = 0.018;        /* Iowa State ICM 2022 */
  var LP_GAL_RANGE = [0.010, 0.025];   /* same */

  /* Purdue GQ-3 Table 1: BTU a bushel, column dryer, 100 cfm/bu, 180 F.
     Rows: final moisture 17..13. Columns: initial moisture 22..30. */
  var GQ3 = {
    initial: [22, 24, 26, 28, 30],
    final: [17, 16, 15, 14, 13],
    btu: [
      [8744, 11714, 14487, 17086, 19545],
      [10596, 13506, 16241, 18784, 21188],
      [12589, 15447, 18118, 20624, 22978],
      [14582, 17388, 19994, 22463, 24768],
      [16774, 19528, 22088, 24486, 26744]
    ]
  };

  /* 86/50 corn GDD for one day (F). */
  function gddDay(hi, lo) {
    if (!num(hi) || !num(lo)) return null;
    var h = Math.min(Math.max(hi, 50), 86), l = Math.min(Math.max(lo, 50), 86);
    return (h + l) / 2 - 50;
  }

  function ymd(d) { return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
  function parseDay(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; }

  /* Moisture by the calendar rates, day by day from start (YYYY-MM-DD,
     the day the moisture was read). own: optional points a week the reader
     sets; it replaces the month rate but keeps the month's EMC floor.
     Returns [{date, month, rate, floor, m}] for days 0..days, or null when a
     day falls in a month the table does not cover. */
  function calendarDrydown(m0, start, days, own) {
    var d0 = parseDay(start);
    if (!num(m0) || !d0 || !(days >= 0)) return null;
    var out = [], m = m0;
    for (var i = 0; i <= days; i++) {
      var d = new Date(d0.getTime() + i * 864e5), mo = d.getUTCMonth() + 1;
      var wk = CAL.weekly[mo], floor = num(CAL.emc[mo]) ? CAL.emc[mo] : null;
      var mine = num(own) && own >= 0;
      if (!num(wk) && !mine) return null;
      var rate = mine ? own : wk;
      if (i > 0 && (floor == null || m > floor)) m = Math.max(floor == null ? 0 : floor, m - rate / 7);
      out.push({ date: ymd(d), month: mo, rate: rate, floor: floor, m: m });
    }
    return out;
  }

  /* Moisture by the GDD rule, from a list of daily GDD (day 1 first). Null
     while the rule is unchecked, or once the moisture leaves the bands. */
  function gddDrydown(m0, gdds, rule) {
    rule = rule || GDD_RULE;
    if (!rule.checked || !num(m0) || !gdds) return null;
    var bands = rule.bands.slice().sort(function (a, b) { return b.hi - a.hi; });
    var top = bands[0].hi, bottom = bands[bands.length - 1].lo;
    if (m0 > top || m0 <= bottom) return null;
    var m = m0, out = [m0];
    for (var i = 0; i < gdds.length; i++) {
      var g = gdds[i];
      if (!num(g)) return out.length > 1 ? out : null;
      while (g > 1e-9 && m > bottom + 1e-9) {
        var b = null;
        for (var k = 0; k < bands.length; k++) if (m <= bands[k].hi + 1e-9 && m > bands[k].lo + 1e-9) { b = bands[k]; break; }
        if (!b) break;
        var room = m - b.lo, can = g / b.gddPerPt;
        if (can <= room) { m -= can; g = 0; } else { m = b.lo; g -= room * b.gddPerPt; }
      }
      out.push(m);
    }
    return out;
  }

  /* Wet bushels per dry bushel at the dry-to moisture. */
  function wetPerDry(m, to) { return (100 - to) / (100 - m); }

  /* Drying cost in dollars per WET bushel.
     c = {kind:'lp', price, gal} | {kind:'point', cents} */
  function dryPerWetBu(m, to, c) {
    if (!c || !num(m) || !num(to)) return null;
    var pts = Math.max(0, m - to);
    if (c.kind === 'lp') {
      if (!num(c.price) || c.price < 0) return null;
      var g = num(c.gal) && c.gal > 0 ? c.gal : LP_GAL_PER_BU_PT;
      return g * pts * c.price;
    }
    if (c.kind === 'point') return num(c.cents) && c.cents >= 0 ? pts * c.cents / 100 : null;
    return null;
  }

  /* One acre: wet bushels and the drying bill at moisture m. */
  function acre(m, o) {
    var w = o.yieldBu * wetPerDry(m, o.to);
    var per = dryPerWetBu(m, o.to, o.cost);
    return { m: m, wetBu: w, points: Math.max(0, m - o.to), perWetBu: per, perAcre: per == null ? null : per * w };
  }

  /* Harvest now vs on day d. o = {yieldBu, to, cost, bid, lossPerWeek, acres}
     mNow, mThen: moisture now and on that day. Null on input that cannot be
     answered. Field loss and its dollars are only there when the reader gave
     a loss. */
  function compare(mNow, mThen, days, o) {
    if (!o || !num(mNow) || !num(mThen) || !num(o.yieldBu) || o.yieldBu <= 0 || !num(o.to)) return null;
    if (mNow <= 0 || mNow >= 60 || o.to <= 0 || o.to >= 30) return null;
    var a = acre(mNow, o), b = acre(mThen, o);
    var out = { days: days, now: a, then: b };
    if (a.perAcre == null || b.perAcre == null) return out;
    out.saved = a.perAcre - b.perAcre;
    if (num(o.bid) && o.bid > 0) {
      out.breakEvenBu = out.saved / o.bid;
      out.breakEvenPct = 100 * out.breakEvenBu / o.yieldBu;
      if (num(o.lossPerWeek) && o.lossPerWeek >= 0) {
        out.lossBu = o.lossPerWeek * days / 7;
        out.lossDollars = out.lossBu * o.bid;
        out.net = out.saved - out.lossDollars;
      }
    }
    if (num(o.acres) && o.acres > 0) {
      out.acres = o.acres;
      out.savedFarm = out.saved * o.acres;
      if (out.net != null) out.netFarm = out.net * o.acres;
    }
    return out;
  }

  /* Purdue GQ-3 Table 1, read linearly between its columns and rows. Null
     outside 22 to 30 initial and 13 to 17 final: the table stops there. */
  function gq3Btu(mi, mf) {
    var I = GQ3.initial, F = GQ3.final;
    if (!num(mi) || !num(mf) || mi < I[0] || mi > I[I.length - 1] || mf > F[0] || mf < F[F.length - 1]) return null;
    function idx(arr, v, asc) {
      for (var k = 0; k < arr.length - 1; k++) {
        var a = arr[k], b = arr[k + 1];
        if (asc ? (v >= a && v <= b) : (v <= a && v >= b)) return [k, (v - a) / (b - a)];
      }
      return [arr.length - 2, 1];
    }
    var ci = idx(I, mi, true), ri = idx(F, mf, false);
    var B = GQ3.btu, r0 = ri[0], c0 = ci[0], tr = ri[1], tc = ci[1];
    var top = B[r0][c0] + (B[r0][c0 + 1] - B[r0][c0]) * tc;
    var bot = B[r0 + 1][c0] + (B[r0 + 1][c0 + 1] - B[r0 + 1][c0]) * tc;
    return top + (bot - top) * tr;
  }
  function gq3FuelPerBu(mi, mf, price) {
    var b = gq3Btu(mi, mf);
    return b == null || !num(price) ? null : b * price / LP_BTU_PER_GAL;
  }

  root.AgHarvestWait = {
    CAL: CAL, GDD_RULE: GDD_RULE, GQ3: GQ3,
    LP_BTU_PER_GAL: LP_BTU_PER_GAL, LP_GAL_PER_BU_PT: LP_GAL_PER_BU_PT, LP_GAL_RANGE: LP_GAL_RANGE,
    gddDay: gddDay, calendarDrydown: calendarDrydown, gddDrydown: gddDrydown,
    wetPerDry: wetPerDry, dryPerWetBu: dryPerWetBu, acre: acre, compare: compare,
    gq3Btu: gq3Btu, gq3FuelPerBu: gq3FuelPerBu, ymd: ymd
  };
})(typeof window !== 'undefined' ? window : this);
