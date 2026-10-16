/* commodity-loan.js: the arithmetic behind /commodity-loan (2026-10-16).
 *
 * Pure functions, no DOM. The page (commodity-loan-ui.js) and the tests
 * (test/commodity-loan.test.mjs) run this same file.
 *
 * A marketing assistance loan (MAL) from the Commodity Credit Corporation,
 * made at the county FSA office, lends the county loan rate per bushel on
 * grain you keep, for up to nine months (7 U.S.C. 9032). Interest is at the
 * CCC commodity loan rate FSA sets each month.
 *
 * Here interest is figured simple, by the month, as an estimate:
 *   cost per bushel per month = loan rate x annual rate / 12
 *   cost for the loan         = bushels x loan rate x annual rate x months / 12
 * The county office figures the real payoff to the day.
 *
 * National 2026 loan rates, FSA news release Apr 8, 2026: corn $2.42 a
 * bushel, soybeans $6.82. Loans for these crops are available through
 * May 31, 2027. Each county has its own rate (data/ccc-loan/<ST>.json once
 * scripts/fetch_ccc_loan.py has read FSA's files).
 */
(function (root) {
  'use strict';

  var NATIONAL = {
    crop_year: 2026, corn: 2.42, soybeans: 6.82, released: '2026-04-08', available_through: '2027-05-31',
    source: 'https://www.fsa.usda.gov/news-events/news/04-08-2026/usda-announces-2026-marketing-assistance-loan-rates-wheat-feed-grains'
  };
  var MAX_MONTHS = 9;

  function num(v) { return typeof v === 'number' && isFinite(v); }
  function pos(v) { return num(v) && v > 0; }

  /* $ a bushel a month of interest. */
  function perBuMonth(loanRate, pct) {
    if (!pos(loanRate) || !num(pct) || pct < 0) return null;
    return loanRate * pct / 100 / 12;
  }

  /* o = {bu, loanRate, pct, months, carry ($/bu), bankPct} */
  function loan(o) {
    o = o || {};
    if (!pos(o.bu) || !pos(o.loanRate)) return null;
    var months = num(o.months) ? Math.max(1, Math.min(MAX_MONTHS, Math.round(o.months))) : MAX_MONTHS;
    var out = { bu: o.bu, loanRate: o.loanRate, months: months, principal: o.bu * o.loanRate,
      pct: null, perBuMonth: null, perBu: null, interest: null,
      carry: null, net: null, covers: null, bankPct: null, bankPerBu: null, bankInterest: null, saved: null };
    var pm = perBuMonth(o.loanRate, o.pct);
    if (pm == null) return out;
    out.pct = o.pct;
    out.perBuMonth = pm;
    out.perBu = pm * months;
    out.interest = out.perBu * o.bu;
    if (num(o.carry)) {
      out.carry = o.carry;
      out.net = o.carry - out.perBu;
      out.covers = out.perBu > 0 ? o.carry / out.perBu : null;
    }
    if (num(o.bankPct) && o.bankPct >= 0) {
      out.bankPct = o.bankPct;
      out.bankPerBu = perBuMonth(o.loanRate, o.bankPct) * months;
      out.bankInterest = out.bankPerBu * o.bu;
      out.saved = out.bankInterest - out.interest;
    }
    return out;
  }

  /* The county's row for a crop from a state file, or null. */
  function countyRate(stateFile, county, crop) {
    var rows = stateFile && stateFile.counties;
    if (!Array.isArray(rows)) return null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].county === county && pos(rows[i][crop])) return rows[i][crop];
    }
    return null;
  }

  /* The interest rate from data/ccc-loan.json, only if it is this month's
     or last month's (a stale rate is not shown as current). */
  function currentRate(feed, today) {
    var it = feed && feed.interest;
    if (!it || !pos(it.pct) || !/^\d{4}-\d{2}$/.test(String(it.month || ''))) return null;
    var d = today || new Date();
    var ym = d.getUTCFullYear() * 12 + d.getUTCMonth();
    var p = it.month.split('-'), im = (+p[0]) * 12 + (+p[1] - 1);
    if (im > ym || ym - im > 1) return null;
    return { pct: it.pct, month: it.month, source: it.source || null, stale: ym !== im };
  }

  var api = { NATIONAL: NATIONAL, MAX_MONTHS: MAX_MONTHS, num: num, perBuMonth: perBuMonth, loan: loan, countyRate: countyRate, currentRate: currentRate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgCccLoan = api;
})(typeof self !== 'undefined' ? self : this);
