/* components/prf-math.js: the arithmetic of USDA's Pasture, Rangeland, Forage
   rainfall-index policy (window.AgPrfMath). Used by components/prf.js on /prf.

   WHY THE PAGE COMPUTES AT ALL
     The reader chooses the coverage level, the acres and how the acres are
     split across two-month intervals, so the results cannot be baked. What is
     baked is every input: the grid's index history, its premium rates and the
     county base values, all published by USDA RMA and mirrored unchanged by
     scripts/fetch_prf.py. This file only multiplies and counts.

   IT MUST AGREE WITH RMA'S OWN TOOL, TO THE DOLLAR
     test/prf-math.test.mjs replays answers read from RMA's PRF tool for grid
     30152 (Barron County, Wisconsin) on 2026-10-12: four policies, two sample
     years each, and 75 years of estimated indemnities. The steps below are the
     ones that reproduce them. Measured, not taken from a handbook:

       protection per acre   = county base value x coverage x productivity,
                               ROUNDED TO THE CENT
       interval protection   = protection per acre x acres x share x split,
                               rounded to the dollar
       interval premium      = interval protection x rate, to the dollar
       premium subsidy       = interval premium x subsidy rate, to the dollar
       producer premium      = interval premium - subsidy
       trigger               = coverage x 100 (the expected index is 100)
       payment factor        = (trigger - index) / trigger, when index < trigger,
                               carried to 28 decimal places
       indemnity             = payment factor x interval protection, to the dollar

     Every rounding is half a unit up, away from zero.

     The payment factor is NOT rounded to three places first: at 90% coverage
     and an index of 70.8, three places gives $3,527 on $16,557 of protection
     and RMA's tool says $3,532.

     THE TWO LINES IN CAPITALS AND THE 28 PLACES CAME FROM THE FIRST LIVE CHECK,
     2026-10-12 (scripts/check_prf_rma.mjs, run 38193769189), which this file
     failed on 7 of 12 policies by $1 to $6:
       * The cent. Pike County AL, grazing, 85%, factor 88, 1,304 acres: RMA's
         total protection is $53,164, which is $40.77 an acre, the per-acre
         figure rounded to the cent; unrounded ($40.766) gives $53,158. New
         Castle DE and Androscoggin ME say the same. The saved answers for grid
         30152 could not show it: its per-acre figures happen to end on the cent.
       * The 28 places. Grid 30152, 4 acres of hay at 90%, Apr-May 1996, index
         72.5: 414 x (90 - 72.5) / 90 is $80.50 exactly, and RMA pays $80. Its
         three other half-dollar cases (protection, premium, subsidy) round up.
         A payment factor held as a 28-place decimal (0.19444...4, cut short)
         times 414 is a hair under $80.50. That is how a .NET decimal divides,
         and it is the only reading that fits all four. It is an inference from
         RMA's answers, not from RMA's code, and the live check carries a second
         half-dollar case of the opposite parity to prove or break it.

     RMA's tool disagrees with itself by cents: its Decision Support tab rounds
     the interval protection to the dollar before multiplying, and its
     Estimated Indemnities tab does not ($558 against $557.60 for grazing at
     85% on 100 acres with 20% in an interval). This file follows the Decision
     Support tab.

   WHAT IT WILL NOT DO
     Forecast rain, or name a best split. A split that paid most over the past
     is a fact about the past.

   No DOM in this file. Loads in a browser or under node. */
(function (root) {
  'use strict';

  var CODES = ['625', '626', '627', '628', '629', '630', '631', '632', '633', '634', '635'];
  var LABELS = ['Jan-Feb', 'Feb-Mar', 'Mar-Apr', 'Apr-May', 'May-Jun', 'Jun-Jul',
                'Jul-Aug', 'Aug-Sep', 'Sep-Oct', 'Oct-Nov', 'Nov-Dec'];
  var LONG = ['January and February', 'February and March', 'March and April', 'April and May',
              'May and June', 'June and July', 'July and August', 'August and September',
              'September and October', 'October and November', 'November and December'];
  var COVERAGE = [70, 75, 80, 85, 90];
  var N = 11;
  var MISSING = 65535;

  /* The grid: NOAA's quarter-degree boxes, 300 across and 120 up, numbered
     from the south-west corner at 20N 130W. Checked against RMA's grid layer
     (GRIDCODE 30454 is 45.25-45.5N, 91.75-91.5W; GRIDCODE 10019 is
     28.25-28.5N, 100.5-100.25W). Hawaii uses lettered grids and is not here. */
  var LAT0 = 20, LON0 = -130, STEP = 0.25, COLS = 300, ROWS = 120;

  function gridFromLatLon(lat, lon) {
    lat = +lat; lon = +lon;
    if (!isFinite(lat) || !isFinite(lon)) return null;
    var row = Math.floor((lat - LAT0) / STEP + 1e-9);
    var col = Math.floor((lon - LON0) / STEP + 1e-9);
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
    return row * COLS + col + 1;
  }
  function gridRowCol(id) {
    id = +id;
    if (!(id >= 1 && id <= ROWS * COLS) || id !== Math.floor(id)) return null;
    return { row: Math.floor((id - 1) / COLS), col: (id - 1) % COLS };
  }
  function gridBounds(id) {
    var rc = gridRowCol(id);
    if (!rc) return null;
    var s = LAT0 + rc.row * STEP, w = LON0 + rc.col * STEP;
    return { south: s, north: s + STEP, west: w, east: w + STEP };
  }
  /* Data files hold 20 grids across by one row up. */
  var BLOCK = 20;
  function shardKey(id) {
    var rc = gridRowCol(id);
    return rc ? rc.row + '_' + Math.floor(rc.col / BLOCK) : null;
  }

  /* Half away from zero at the dollar, after trimming binary noise: 1158.5
     must not arrive as 1158.4999999998. */
  function dollars(v) {
    if (v == null || !isFinite(v)) return null;
    var r = Math.round(Math.abs(v) * 1e6) / 1e6;
    var out = Math.floor(r + 0.5);
    return v < 0 ? -out : out;
  }
  /* the same rule at the cent */
  function cents(v) {
    if (v == null || !isFinite(v)) return null;
    var r = Math.round(Math.abs(v) * 1e8) / 1e8;
    var out = Math.floor(r * 100 + 0.5 + 1e-9) / 100;
    return v < 0 ? -out : out;
  }

  function decodeU16(b64) {
    var bytes;
    if (typeof atob === 'function') {
      var bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    }
    var out = new Array(bytes.length >> 1);
    for (var j = 0; j < out.length; j++) out[j] = bytes[2 * j] | (bytes[2 * j + 1] << 8);
    return out;
  }
  /* A grid record from data/prf/g/<key>.json, opened up.
     index[year] = eleven values, percent of normal as a fraction (0.708), or
     null where RMA has published none. rates[coverage] = eleven rates. */
  function openGrid(rec, y0, y1, cur) {
    var h = decodeU16(rec.h), r = decodeU16(rec.r), index = {}, rates = {}, y, i;
    for (y = y0; y <= y1; y++) {
      var row = new Array(N);
      for (i = 0; i < N; i++) {
        var v = h[(y - y0) * N + i];
        row[i] = (v == null || v === MISSING) ? null : v / 1000;
      }
      index[y] = row;
    }
    if (cur && cur.year != null && cur.values) {
      index[cur.year] = cur.values.map(function (v) { return v == null ? null : v / 1000; });
    }
    for (var c = 0; c < COVERAGE.length; c++) {
      var rr = new Array(N);
      for (i = 0; i < N; i++) {
        var q = r[c * N + i];
        rr[i] = (q == null || q === MISSING) ? null : q / 10000;
      }
      rates[COVERAGE[c]] = rr;
    }
    return { index: index, rates: rates, avgMm: (rec.a || []).map(function (v) { return v == null ? null : v / 10; }),
             counties: rec.c || [] };
  }

  /* The split: whole percents, eleven of them. Rules as RMA's page enforces
     them: they add to 100, each one used sits between the county's minimum
     and maximum for that interval, and no two used intervals share a month.
     Jan-Feb and Nov-Dec share none. */
  function checkSplit(split, minPct, maxPct, valid) {
    var errs = [], sum = 0, used = 0, i;
    for (i = 0; i < N; i++) {
      var p = +split[i] || 0;
      if (p < 0) errs.push({ i: i, why: 'negative' });
      if (!p) continue;
      used++;
      sum += p;
      if (valid && valid[i] === false) errs.push({ i: i, why: 'unavailable' });
      if (minPct && minPct[i] != null && p < minPct[i] - 1e-9) errs.push({ i: i, why: 'below', limit: minPct[i] });
      if (maxPct && maxPct[i] != null && p > maxPct[i] + 1e-9) errs.push({ i: i, why: 'above', limit: maxPct[i] });
      if (i > 0 && (+split[i - 1] || 0) > 0) errs.push({ i: i, why: 'adjacent', other: i - 1 });
    }
    if (Math.abs(sum - 100) > 1e-6) errs.push({ why: 'sum', sum: sum });
    return { ok: !errs.length, errors: errs, sum: sum, used: used };
  }

  /* One year's policy at today's terms.
     p: { cbv, coverage (70..90), productivity (60..150), acres, share (1..100),
          split [11 whole percents], rates [11], subsidy (0.51) }
     acres null or 0 -> figures per acre, unrounded (RMA's tool has no such
     view; its per-acre line is the rounded total divided by the acres). */
  function policy(p) {
    var perAcre = !(p.acres > 0);
    var acres = perAcre ? 1 : +p.acres;
    var share = perAcre ? 1 : (p.share == null ? 100 : +p.share) / 100;
    var cov = p.coverage / 100;
    var ppa = cents(p.cbv * cov * (p.productivity == null ? 100 : +p.productivity) / 100);
    var rows = [], tot = { protection: 0, premium: 0, subsidy: 0, producer: 0 };
    for (var i = 0; i < N; i++) {
      var f = (+p.split[i] || 0) / 100;
      var rate = p.rates ? p.rates[i] : null;
      var prot = ppa * acres * share * f, prem = null, sub = null, prod = null;
      if (!perAcre) prot = dollars(prot);
      if (f > 0 && rate != null) {
        prem = prot * rate;
        if (!perAcre) prem = dollars(prem);
        sub = prem * p.subsidy;
        if (!perAcre) sub = dollars(sub);
        prod = prem - sub;
        tot.protection += prot; tot.premium += prem; tot.subsidy += sub; tot.producer += prod;
      } else if (f > 0) {
        tot.protection += prot;
      }
      rows.push({ i: i, code: CODES[i], pct: f * 100, rate: rate, protection: f > 0 ? prot : 0,
                  premium: prem, subsidy: sub, producer: prod });
    }
    return { perAcre: perAcre, protectionPerAcre: ppa, coverage: p.coverage, rows: rows, total: tot,
             priced: rows.every(function (r) { return !r.pct || r.rate != null; }) };
  }

  /* What one interval would have paid, in plain arithmetic, not rounded. */
  function payment(protection, index, coverage) {
    if (index == null || protection == null) return null;
    var trig = coverage / 100;
    if (!(index < trig - 1e-12)) return 0;
    return protection * (trig - index) / trig;
  }

  /* The same, to the dollar, the way RMA's tool gets there: the payment factor
     is carried to 28 decimal places and no further (see the top of this file),
     so 414 x 17.5 / 90, which is $80.50 in plain arithmetic, is a hair under
     and pays $80. Whole numbers all the way, so no binary noise. */
  var P28 = typeof BigInt === 'function' ? BigInt('10000000000000000000000000000') : null;
  function pay(protection, index, coverage) {
    if (index == null || protection == null) return null;
    var T = Math.round(coverage * 10), I = Math.round(index * 1000);
    if (I >= T) return 0;
    if (!P28 || protection !== Math.floor(protection) || protection < 0) return dollars(payment(protection, index, coverage));
    var den = BigInt(T), two = BigInt(2);
    var pcf = (BigInt(T - I) * P28 * two + den) / (den * two);
    var whole = BigInt(protection) * pcf, d = whole / P28, rem = whole % P28;
    return Number(rem * two >= P28 ? d + BigInt(1) : d);
  }

  /* Every year on record for one policy.
     A year is "complete" only when RMA has published an index for every
     interval the split uses. An incomplete year is listed and left out of
     every total: a missing interval is not a zero. */
  function history(pol, index) {
    var years = Object.keys(index).map(Number).sort(function (a, b) { return a - b; });
    var out = [], used = pol.rows.filter(function (r) { return r.pct > 0; });
    years.forEach(function (y) {
      var row = index[y], cells = [], paid = 0, complete = true, any = false;
      used.forEach(function (r) {
        var idx = row ? row[r.i] : null;
        var got = pol.perAcre ? payment(r.protection, idx, pol.coverage) : pay(r.protection, idx, pol.coverage);
        if (got == null) complete = false; else { any = true; paid += got; }
        cells.push({ i: r.i, index: idx, paid: got });
      });
      if (!any) return;
      out.push({ year: y, cells: cells, complete: complete && pol.priced,
                 indemnity: complete ? paid : null,
                 net: complete && pol.priced ? paid - pol.total.producer : null });
    });
    return out;
  }

  function summarize(hist, pol) {
    var done = hist.filter(function (h) { return h.complete; });
    var n = done.length, paidYears = 0, sum = 0, ahead = 0, best = null, worst = null;
    done.forEach(function (h) {
      if (h.indemnity > 0) paidYears++;
      if (h.net > 0) ahead++;
      sum += h.indemnity;
      if (!best || h.net > best.net) best = h;
      if (!worst || h.net < worst.net) worst = h;
    });
    return {
      years: n, first: n ? done[0].year : null, last: n ? done[n - 1].year : null,
      incomplete: hist.filter(function (h) { return !h.complete; }).map(function (h) { return h.year; }),
      paidYears: paidYears, aheadYears: ahead,
      indemnity: sum, producer: pol.total.producer * n, premium: pol.total.premium * n,
      avgIndemnity: n ? sum / n : null, best: best, worst: worst
    };
  }

  /* One interval on its own, at one coverage level: how often the index fell
     below the trigger, and what that history cost per $100 of protection,
     beside the rate RMA charges for it now. */
  function intervalRecord(index, i, coverage, rate) {
    var trig = coverage / 100, n = 0, below = 0, cost = 0, lo = null, vals = [];
    Object.keys(index).forEach(function (y) {
      var v = index[y] ? index[y][i] : null;
      if (v == null) return;
      n++; vals.push(v);
      if (lo == null || v < lo.index) lo = { year: +y, index: v };
      if (v < trig - 1e-12) { below++; cost += (trig - v) / trig; }
    });
    vals.sort(function (a, b) { return a - b; });
    var mid = !n ? null : (n % 2 ? vals[(n - 1) / 2] : (vals[n / 2 - 1] + vals[n / 2]) / 2);
    return { i: i, years: n, below: below, lowest: lo, middle: mid,
             costPer100: n ? cost / n * 100 : null, ratePer100: rate == null ? null : rate * 100 };
  }

  /* A whole-percent split across the chosen intervals, as even as the county's
     limits allow (34/33/33, or 25/75 cut to what the caps permit). on: eleven
     booleans. Returns eleven percents, or null when the limits cannot reach
     100: two intervals capped at 25 and 70 stop at 95. */
  function evenSplit(on, minPct, maxPct) {
    var idx = [], out = new Array(N), i, left = 100;
    for (i = 0; i < N; i++) { out[i] = 0; if (on[i]) idx.push(i); }
    if (!idx.length) return out;
    idx.forEach(function (k) { out[k] = minPct && minPct[k] != null ? minPct[k] : 10; left -= out[k]; });
    if (left < 0) return null;
    while (left > 0) {
      var best = -1;
      for (i = 0; i < idx.length; i++) {
        var k = idx[i], cap = maxPct && maxPct[k] != null ? maxPct[k] : 100;
        if (out[k] < cap && (best < 0 || out[k] < out[best])) best = k;
      }
      if (best < 0) return null;
      out[best]++; left--;
    }
    return out;
  }

  /* The longest run of years in a row with no payment at all. A year that is
     not complete, or a gap in the years, ends a run: it is not a dry year. */
  function longestDry(hist) {
    var best = null, cur = null;
    hist.forEach(function (h) {
      if (!h.complete || h.indemnity > 0) { cur = null; return; }
      if (!cur || h.year !== cur.to + 1) cur = { from: h.year, to: h.year, n: 0 };
      cur.to = h.year; cur.n++;
      if (!best || cur.n > best.n) best = { from: cur.from, to: cur.to, n: cur.n };
    });
    return best;
  }

  /* Irrigated hay valued under non-irrigated (Sig, Oct 20; Anderson County, TX: $168 against $224).
     names: the state's uses in order; vals: the county value for each (null where not offered); use: the
     index shown. When the use is an irrigated hay line and its non-irrigated twin is worth more, returns
     { irr, non }, else null. No reason is given: USDA sets the values. */
  function irrigatedLower(names, vals, use) {
    var n = names && names[use];
    if (!n || !/irrigated/i.test(n) || /non-irrigated/i.test(n)) return null;
    var twin = names.indexOf(n.replace(/irrigated/i, 'non-irrigated'));
    if (twin < 0) return null;
    var irr = vals[use], non = vals[twin];
    return irr != null && non != null && irr < non ? { irr: irr, non: non } : null;
  }

  var api = {
    irrigatedLower: irrigatedLower,
    evenSplit: evenSplit, longestDry: longestDry,
    CODES: CODES, LABELS: LABELS, LONG: LONG, COVERAGE: COVERAGE, N: N, MISSING: MISSING, BLOCK: BLOCK,
    gridFromLatLon: gridFromLatLon, gridRowCol: gridRowCol, gridBounds: gridBounds, shardKey: shardKey,
    dollars: dollars, cents: cents, decodeU16: decodeU16, openGrid: openGrid,
    checkSplit: checkSplit, policy: policy, payment: payment, pay: pay, history: history,
    summarize: summarize, intervalRecord: intervalRecord
  };
  root.AgPrfMath = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
