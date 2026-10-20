/* components/prf-optimize.js: "what the numbers would pick" for a PRF grid
   (window.AgPrfOptimize). Used by components/prf-optimize-ui.js on /prf.

   WHAT IT DOES
     For one grid, one county's interval limits and one coverage level, it
     finds the split of the policy across the eleven two-month intervals that
     scores best on the grid's own index record, 1951 to the last complete
     year, at 2027 rates and the producer's share of the premium. Then it
     checks itself: a walk-forward test picks each year from 1981 on using only
     the years before it, scores the pick on that year, and compares it with
     an even spread, the page's default and a "two driest months" rule.

   THE TWO SCORES (say which one is shown)
     'net'  expected payment minus producer premium, per $1 of protection,
            over every year on record.
     'dry'  the same, over only the driest fifth of years by the grid's whole-
            year precipitation (the six intervals that share no month,
            weighted by their normal inches). A downside measure: what the
            policy would have done in the years a rancher most needs it.

   TWO WAYS TO ESTIMATE AN INTERVAL'S AVERAGE PAYMENT (estimator)
     'history'  the grid's own record for that interval. This is the naive
                machine pick, and the walk-forward test found it does worse
                than an even spread out of sample: seventy years of one
                interval are too few to tell a dry interval from a lucky one.
     'priced'   RMA's rate for the interval times the grid's payback on its
                rates, pooled over all its intervals, tilted by the outlook.
                The default for 'net', and the one that held up. It leans
                to the months RMA charges most for, because USDA pays a fixed
                share of whatever premium is owed.
     'dry' always uses 'history': a dry-year average has no rate behind it.

   WHY THE SEARCH IS EXACT
     Both scores are linear in the split: score = sum of pct_i x value_i, where
     value_i = average payment factor of interval i (over the chosen years)
     minus rate_i x (1 - subsidy). So for any set of intervals the best split
     gives each its minimum and pours what is left into the highest values up
     to their caps, in whole steps (greedy fill of a box with a fixed sum,
     integral when the limits are whole steps). The search runs that fill
     over every set of intervals the rules allow (at least two, none sharing a
     month, each offered and priced): at most 232 sets for eleven intervals.
     Dollar rounding per unit is left out; it moves a figure by cents.

   NO LOOK-AHEAD IN THE TEST, AND WHAT IT CANNOT AVOID
     * The pick for year Y sees only what a buyer had on Dec 1 of Y-1: the
       years before Y, less Oct-Nov and Nov-Dec of Y-1, which end after the
       sales closing (lateUnknown; walkForward's onTrain hook lets the test
       prove it), and only the ENSO reading of the fall before Y (Aug-Oct of
       Y-1), which was published before the Dec 1 sales closing. Before
       2026-10-13 the test read all of Y-1; that flattered it slightly.
     * It cannot avoid two things, and the panel says so: every year is
       scored at 2027 rates, which RMA set with the whole record in view (past
       rates are not in the data), and USDA's index is percent of a normal
       computed over 1951 to 2025. Both apply equally to every strategy.
     * NOAA's seasonal outlooks cannot be tested: no archive of past outlooks
       is in the data. The outlook tilt is shown, never scored.

   MORE CLIMATE PREDICTORS (PREDICTORS, tiltFor)
     Recency weighting, last fall's index on the grid, PDO with ENSO (and the
     two in the same phase), AMO, eleven seasonal forecast models and their
     average (tested once their archive is in), and April 1 snowpack, which
     cannot be tested at all. Each reweights past years on top of the rate-led pick, with
     settings fixed before the test. The walk-forward test runs them, counts
     every one (FAMILY) and adjusts; recommend() applies only the ids the
     published test kept (opts.tilts, from keptPredictors(opt.json)).

   THE ENSO TABLE
     ONI_ASO below: the Nino 3.4 sea surface anomaly averaged over August,
     September and October of each year, in degrees C. 1950 to 2021 are the
     September (ASO-centered) three-month values of the Nino 3.4 series shipped
     with the Pyleoclim package (LinkedEarth/Pyleoclim_util,
     pyleoclim/data/oni.csv). That series starts in 1871, so it is a long
     reconstruction, not CPC's ERSSTv5 ONI, and values can differ from CPC's
     by a tenth or two. 2022 to 2024 are CPC's ONI (v5) for ASO as
     transcribed: -1.0, 1.5, -0.2; the phase of those three is not in doubt.
     CPC's page could not be reached from the machine that built this
     (www.cpc.ncep.noaa.gov refused). scripts/check_prf_oni.py compares this
     table with CPC's file and lists every phase that differs; run it where
     NOAA is reachable before trusting a phase call near 0.5.
     Phases: El Nino at +0.5 or above, La Nina at -0.5 or below, else neutral.

   No DOM. Loads in a browser after prf-math.js, or under node. */
(function (root) {
  'use strict';
  var M = root.AgPrfMath || (typeof require === 'function' ? require('./prf-math.js') : null);
  var N = 11;
  var LABELS = M ? M.LABELS : ['Jan-Feb', 'Feb-Mar', 'Mar-Apr', 'Apr-May', 'May-Jun', 'Jun-Jul',
                               'Jul-Aug', 'Aug-Sep', 'Sep-Oct', 'Oct-Nov', 'Nov-Dec'];
  /* the six intervals that share no month and cover the whole year */
  var YEAR_SET = [0, 2, 4, 6, 8, 10];

  /* Oct-Nov and Nov-Dec (9, 10) end Nov 30 and Dec 31: not final by the Dec 1
     sales closing, so the pick for policy year Y never reads them for Y-1. */
  var FIRST_LATE = 9;
  function lateUnknown(G, k, i, asOf) { return asOf != null && G.years[k] === asOf - 1 && i >= FIRST_LATE; }

  var ONI_FIRST = 1950;
  var ONI_ASO = [
    /* 1950 */ -0.26, 0.99, 0.15, 0.78, -0.90, -1.09, -0.46, 1.33, 0.39, -0.09,
    /* 1960 */ 0.27, -0.30, -0.11, 1.22, -0.76, 1.85, -0.05, -0.30, 0.45, 0.79,
    /* 1970 */ -0.77, -0.82, 1.58, -1.45, -0.41, -1.37, 0.62, 0.57, -0.42, 0.33,
    /* 1980 */ -0.07, -0.16, 1.58, -0.45, -0.24, -0.40, 0.71, 1.65, -1.19, -0.24,
    /* 1990 */ 0.39, 0.62, -0.13, 0.15, 0.55, -0.81, -0.35, 2.14, -1.31, -1.16,
    /* 2000 */ -0.55, -0.19, 1.01, 0.26, 0.70, -0.11, 0.53, -1.08, -0.25, 0.71,
    /* 2010 */ -1.55, -0.83, 0.36, -0.26, 0.22, 2.16, -0.62, -0.38, 0.51, 0.20,
    /* 2020 */ -0.88, -0.68, -1.0, 1.5, -0.2
  ];
  var ONI_SOURCE = {
    what: 'Nino 3.4 sea surface temperature anomaly, August to October, degrees C',
    years: '1950-2021: Pyleoclim package Nino 3.4 series (github.com/LinkedEarth/Pyleoclim_util, pyleoclim/data/oni.csv), September-centered three-month value. 2022-2024: NOAA CPC ONI v5, ASO.',
    cpc: 'https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt',
    thresholds: 'El Nino at +0.5 or above, La Nina at -0.5 or below'
  };
  var PHASE_NAME = { 'el-nino': 'El Niño', 'la-nina': 'La Niña', neutral: 'neutral' };

  function oniASO(year) {
    var k = year - ONI_FIRST;
    return k >= 0 && k < ONI_ASO.length ? ONI_ASO[k] : null;
  }
  function ensoPhase(v) {
    if (v == null || !isFinite(v)) return null;
    return v >= 0.5 - 1e-9 ? 'el-nino' : v <= -0.5 + 1e-9 ? 'la-nina' : 'neutral';
  }
  /* The ENSO reading a buyer had for policy year Y: Aug-Oct of Y-1, out in
     early November, before the Dec 1 sales closing. Never year Y itself. */
  function phaseKnownFor(policyYear) { return ensoPhase(oniASO(policyYear - 1)); }
  function normPhase(p) {
    if (p == null) return null;
    var s = String(p).toLowerCase().replace(/[^a-z]/g, '');
    if (s === 'elnino' || s === 'warm') return 'el-nino';
    if (s === 'lanina' || s === 'cold' || s === 'cool') return 'la-nina';
    if (s === 'neutral') return 'neutral';
    return null;
  }

  /* ------------------------------------------------------------ preparing a grid */
  /* input: {
       index:   { year: [11 fractions of normal, or null] }   (complete years)
       rates:   [11] premium rates at the chosen coverage, null where none
       coverage: 70..90
       subsidy: fraction USDA pays at that coverage (0.51)
       min, max: [11] whole-percent limits for the county, null where not offered
       valid:   [11] booleans, offered in the county (optional; min/max decide)
       avgMm:   [11] normal precipitation, any unit (for the dry-year measure)
       lastComplete: last year that may be counted (optional)
     } */
  function prepare(input) {
    var cov = +input.coverage, T = cov / 100, sub = +input.subsidy;
    var allowed = [], cost = [], lo = [], hi = [];
    for (var i = 0; i < N; i++) {
      var r = input.rates ? input.rates[i] : null;
      var mn = input.min ? input.min[i] : null, mx = input.max ? input.max[i] : null;
      var ok = r != null && isFinite(r) && mn != null && mx != null && mx >= mn && (!input.valid || input.valid[i] !== false);
      allowed.push(ok);
      cost.push(ok ? r * (1 - sub) : null);
      lo.push(ok ? +mn : null); hi.push(ok ? +mx : null);
    }
    var years = Object.keys(input.index || {}).map(Number).filter(function (y) {
      if (input.lastComplete != null && y > input.lastComplete) return false;
      var row = input.index[y];
      if (!row) return false;
      for (var j = 0; j < N; j++) if (allowed[j] && row[j] == null) return false;
      return true;
    }).sort(function (a, b) { return a - b; });
    var P = [], X = [], A = [];
    var mm = input.avgMm || [], mmOk = YEAR_SET.every(function (j) { return mm[j] != null && mm[j] > 0; });
    years.forEach(function (y) {
      var row = input.index[y], p = new Array(N), x = new Array(N);
      for (var j = 0; j < N; j++) {
        var v = row[j];
        x[j] = v == null ? null : v;
        p[j] = v == null ? null : (v < T - 1e-12 ? (T - v) / T : 0);
      }
      var num = 0, den = 0, have = true;
      YEAR_SET.forEach(function (j) {
        if (row[j] == null) { have = false; return; }
        var w = mmOk ? mm[j] : 1; num += w * row[j]; den += w;
      });
      P.push(p); X.push(x); A.push(have ? num / den : null);
    });
    return { years: years, P: P, X: X, annual: A, allowed: allowed, cost: cost, lo: lo, hi: hi,
             coverage: cov, subsidy: sub, rates: input.rates, avgMm: mm, grid: input.grid == null ? null : +input.grid };
  }

  /* ------------------------------------------------------------ small statistics */
  function quantile(sorted, q) {
    var n = sorted.length; if (!n) return null;
    var h = (n - 1) * q, a = Math.floor(h), b = Math.min(n - 1, a + 1);
    return sorted[a] + (h - a) * (sorted[b] - sorted[a]);
  }
  /* exact two-sided sign test: the odds that a fair coin gives a split at
     least this lopsided */
  function signTest(wins, losses) {
    var n = wins + losses; if (!n) return 1;
    var k = Math.min(wins, losses), p = 0, c = 1;
    for (var i = 0; i <= n; i++) {
      if (i > 0) c = c * (n - i + 1) / i;
      if (i <= k) p += c;
    }
    p = 2 * p / Math.pow(2, n);
    return Math.min(1, p);
  }

  /* Odds that pure luck gives an average difference this far from zero: flip
     the sign of each year's difference at random (2,000 times, fixed seed, so
     the answer is the same every run) and count how often the average comes
     out at least as far from zero. Two-sided. Fit for skewed payoffs, where
     a sign test is not: a policy can be behind in most years and ahead on
     average. */
  function flipTest(diffs, draws) {
    var n = diffs.length; if (!n) return 1;
    draws = draws || 2000;
    var obs = 0, i; for (i = 0; i < n; i++) obs += diffs[i];
    obs = Math.abs(obs);
    var seed = 20261012, hit = 0;
    for (var d = 0; d < draws; d++) {
      var s = 0;
      for (i = 0; i < n; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        s += (seed & 0x80000000) ? -diffs[i] : diffs[i];
      }
      if (Math.abs(s) >= obs - 1e-12) hit++;
    }
    return (hit + 1) / (draws + 1);
  }

  /* ------------------------------------------------------------ more climate predictors */
  /* Each is an optional tilt on the rate-led pick: it reweights past years and
     nothing else, so the rates, the pooled payback and the rules stay as they
     are. Every setting below was fixed before the walk-forward test was run
     and none was tuned on it. scripts/prf_opt_backtest.mjs tests every one,
     counts all of them (FAMILY) and adjusts for the count; data/prf/opt.json
     says which held up, and only those may move the panel's pick.

     What a buyer can know at the Dec 1 sales closing for policy year Y:
       * the grid's index for every complete year before Y, and for Sep-Oct of
         Y-1 (it ends Oct 31; RMA's final index is out in November). Oct-Nov
         of Y-1 ends Nov 30 and is not final by Dec 1, so it is not used;
       * PDO for August to October of Y-1 (NOAA NCEI posts each month early in
         the next), AMO for July to September of Y-1 (NOAA PSL posts with a
         longer lag, so one month earlier to be safe);
       * seasonal forecasts started in November of Y-1 (NMME posts about Nov
         8-10, Copernicus on the 13th). For years before a model existed the
         test uses its re-forecasts (hindcasts), run later by a model built
         with those years in view; that flatters the models and the panel
         says so;
       * not April 1 snowpack: it is measured four months after sign-up. */
  var PREDICTORS = [
    { id: 'recent15', family: 'trend', recency: { halfLife: 15 },
      name: 'Recent years count more (weight halves every 15 years)' },
    { id: 'recent30', family: 'trend', recency: { halfLife: 30 },
      name: 'Recent years count more (weight halves every 30 years)' },
    { id: 'last30', family: 'trend', recency: { lastN: 30 },
      name: 'The last 30 years only' },
    { id: 'fall', family: 'persistence', intervals: [0, 1],
      name: 'Last fall on this grid (its Sep-Oct index, dry, middle or wet third) tilting Jan-Feb and Feb-Mar' },
    { id: 'pdo-enso', family: 'ocean', needs: ['pdo'],
      name: 'Pacific Decadal Oscillation phase together with El Niño or La Niña' },
    { id: 'amo', family: 'ocean', needs: ['amo'],
      name: 'Atlantic Multidecadal Oscillation phase, warm or cold' },
    { id: 'pdo-enso-same', family: 'ocean', needs: ['pdo'],
      name: 'El Niño with a warm PDO, or La Niña with a cold PDO (the two pushing the same way)' },
    /* Seasonal forecast models, November starts. Each tilts only the intervals
       and places where its own past forecasts tracked the index (SKILL), with
       the skill worked out from earlier years only. Data: data/prf/seasonal-fc.json
       (scripts/fetch_seasonal_models.py); NOAA's CFSv2 and Canada's CanSIPS
       come from the NMME archive, which reaches back further than Copernicus's
       copies of the same two models, so they are counted once. */
    { id: 'fc-cfsv2', family: 'forecast', needs: ['seasonal'], model: 'cfsv2', name: 'NOAA’s CFSv2 seasonal forecast, made in November, where it has shown skill' },
    { id: 'fc-spear', family: 'forecast', needs: ['seasonal'], model: 'spear', name: 'NOAA GFDL’s SPEAR seasonal forecast, made in November, where it has shown skill' },
    { id: 'fc-geos', family: 'forecast', needs: ['seasonal'], model: 'geos', name: 'NASA’s GEOS seasonal forecast, made in November, where it has shown skill' },
    { id: 'fc-cesm', family: 'forecast', needs: ['seasonal'], model: 'cesm', name: 'NCAR’s CESM seasonal forecast, made in November, where it has shown skill' },
    { id: 'fc-cansips', family: 'forecast', needs: ['seasonal'], model: 'cansips', name: 'Environment Canada’s CanSIPS seasonal forecast, made in November, where it has shown skill' },
    { id: 'fc-ecmwf', family: 'forecast', needs: ['seasonal'], model: 'ecmwf', name: 'The European Centre’s (ECMWF) seasonal forecast, made in November, where it has shown skill' },
    { id: 'fc-ukmo', family: 'forecast', needs: ['seasonal'], model: 'ukmo', name: 'The UK Met Office seasonal forecast, made in November, where it has shown skill' },
    { id: 'fc-meteofrance', family: 'forecast', needs: ['seasonal'], model: 'meteofrance', name: 'Météo-France’s seasonal forecast, made in November, where it has shown skill' },
    { id: 'fc-dwd', family: 'forecast', needs: ['seasonal'], model: 'dwd', name: 'Germany’s weather service (DWD) seasonal forecast, made in November, where it has shown skill' },
    { id: 'fc-cmcc', family: 'forecast', needs: ['seasonal'], model: 'cmcc', name: 'Italy’s CMCC seasonal forecast, made in November, where it has shown skill' },
    { id: 'fc-jma', family: 'forecast', needs: ['seasonal'], model: 'jma', name: 'The Japan Meteorological Agency seasonal forecast, made in November, where it has shown skill' },
    { id: 'fc-mmm', family: 'forecast', needs: ['seasonal'], model: '*', name: 'All the seasonal forecast models averaged together, made in November, where the average has shown skill' },
    /* Not a tilt: picks the coverage level each fall (the test in
       scripts/prf_opt_backtest.mjs, coverageEdge below). At 90 it is scored
       against always buying 90%, at 70 against always buying 70%. */
    { id: 'cov-pick', family: 'structure', structural: true,
      name: 'Picking the coverage level each fall (70 to 90%) for the most expected return on what you pay' },
    { id: 'swe', family: 'snow', untestable: 'April 1 snowpack is measured four months after the Dec 1 sales closing, so no buyer can know it when choosing.',
      name: 'April 1 mountain snowpack' }
  ];
  /* Every comparison the test makes or has promised to make: the ENSO tilt
     and each testable predictor above, at 90% and 70% coverage. The
     adjustment divides by this whole count, including the ones still waiting
     on data, so running them later cannot make an earlier one look better. */
  var FAMILY_COVERAGES = [90, 70];
  var FAMILY = (function () {
    var ids = ['enso'];
    PREDICTORS.forEach(function (p) { if (!p.untestable) ids.push(p.id); });
    var out = [];
    FAMILY_COVERAGES.forEach(function (c) { ids.forEach(function (id) { out.push(id + '@' + c); }); });
    return out;
  })();
  var CLIMATE_MONTHS = { pdo: [8, 9, 10], amo: [7, 8, 9] };
  var FALL_INTERVAL = 8;   /* Sep-Oct */

  function predictorById(id) { for (var i = 0; i < PREDICTORS.length; i++) if (PREDICTORS[i].id === id) return PREDICTORS[i]; return null; }

  /* How much a past year counts toward policy year asOf. age 0 is the year
     before. halfLife h: 0.5^(age/h). lastN n: 1 for the n most recent years,
     0 before. A year at or after asOf counts 0, whatever the caller passed. */
  function recencyWeight(year, r) {
    var age = r.asOf - 1 - year;
    if (!(age >= 0)) return 0;
    if (r.lastN) return age < r.lastN ? 1 : 0;
    if (r.halfLife) return Math.pow(0.5, age / r.halfLife);
    return 1;
  }

  /* A climate series' mean over months (1-12) of one year, or null if any
     month is missing. log, if given, collects every month read ('pdo:2019-08'),
     so the test can check none was later than the sales closing allowed. */
  function seasonMean(climate, name, year, months, log) {
    var s = climate && climate.series && climate.series[name];
    if (!s || !s.monthly) return null;
    var row = s.monthly[String(year)], sum = 0;
    for (var i = 0; i < months.length; i++) {
      if (log) log.push(name + ':' + year + '-' + (months[i] < 10 ? '0' : '') + months[i]);
      var v = row ? row[months[i] - 1] : null;
      if (v == null || !isFinite(v)) return null;
      sum += +v;
    }
    return sum / months.length;
  }
  function signPhase(v) { return v == null ? null : v >= 0 ? 'warm' : 'cold'; }

  /* Why a predictor cannot run with this data, or null when it can. */
  function predictorUnavailable(id, climate) {
    var p = predictorById(id);
    if (!p) return 'unknown predictor';
    if (p.untestable) return p.untestable;
    if (p.stub) return 'no archive in the data yet';
    if (p.structural) return null;
    if (p.family === 'forecast') {
      var sea = climate && climate.seasonal, ms = sea && sea.models;
      var have = ms ? (p.model === '*' ? FORECAST_MODELS.filter(function (m) { return ms[m]; }).length >= SKILL.minModels : !!ms[p.model]) : false;
      if (!have) return 'data/prf/seasonal-fc.json has no ' + (p.model === '*' ? 'two models' : p.model) + ' forecasts yet';
      if (!climate.seasonalSkill || !climate.seasonalSkill[id]) return 'no skill table for ' + id;
      return null;
    }
    var needs = p.needs || [];
    for (var i = 0; i < needs.length; i++) {
      var s = climate && climate.series && climate.series[needs[i]];
      if (!s || !s.monthly || !Object.keys(s.monthly).length) return 'data/prf/climate-indices.json has no ' + needs[i].toUpperCase() + ' series';
    }
    return null;
  }

  /* The weights options for one predictor, for policy year Y, from the years
     in use (all before Y in the test) and what was known at the sales closing.
     Returns { opts, state, used } where state is this year's reading (null:
     unknown, so the pick is the plain one) and used lists what was read:
     used.years the index years, used.climate the months. */
  function tiltFor(G, id, Y, use, climate) {
    var p = predictorById(id), used = { years: [], climate: [] }, opts = {};
    if (!p || predictorUnavailable(id, climate)) return null;
    G.years.forEach(function (y, k) { if (use[k]) used.years.push(y); });
    if (p.recency) {
      opts.recency = { asOf: Y, halfLife: p.recency.halfLife, lastN: p.recency.lastN };
      return { opts: opts, state: 'recency', used: used };
    }
    var labels = {}, state = null;
    if (id === 'fall') {
      var kOf = {}, v = [];
      G.years.forEach(function (y, k) { kOf[y] = k; });
      for (var k = 0; k < G.years.length; k++) if (use[k] && G.X[k][FALL_INTERVAL] != null) v.push(G.X[k][FALL_INTERVAL]);
      if (v.length < 9) return { opts: opts, state: null, used: used };
      v.sort(function (a, b) { return a - b; });
      var lo = quantile(v, 1 / 3), hi = quantile(v, 2 / 3);
      var third = function (y) {
        var kk = kOf[y];
        if (kk == null || !use[kk]) return null;   /* only years in use, all before Y */
        var x = G.X[kk][FALL_INTERVAL];
        return x == null ? null : x <= lo ? 'dry' : x <= hi ? 'mid' : 'wet';
      };
      G.years.forEach(function (y, k2) { if (use[k2]) labels[y] = third(y - 1); });
      state = third(Y - 1);
      opts.analogs = [{ labels: labels, phase: state, boost: 1, intervals: p.intervals }];
      return { opts: opts, state: state, used: used };
    }
    if (p.family === 'forecast') {
      /* the forecast for Y (started November of Y-1), standardized on the
         model's own forecasts for years before Y, on the intervals where the
         skill table (from years before Y only) clears SKILL.minR here */
      used.climate.push('seasonal:' + p.model + ':' + (Y - 1) + '-11');
      var sk = climate.seasonalSkill[id][Y], box = boxOf(G.grid), blk = blockOf(G.grid);
      if (!sk || !box || !sk[blk]) return { opts: opts, state: null, used: used };
      var outl = [], any = false;
      for (var i = 0; i < N; i++) {
        var r = sk[blk][i];
        var zs = r != null && r >= SKILL.minR ? zSeries(climate.seasonal, p.model, box, i, Y) : null;
        if (!zs || zs.now == null) { outl.push(null); continue; }
        outl.push(outlookFromZ(zs.now, r)); any = true;
      }
      if (!any) return { opts: opts, state: null, used: used };
      opts.outlook = outl;
      return { opts: opts, state: 'forecast', used: used };
    }
    var log = used.climate;
    var labelFor = function (y) {   /* the reading a buyer had for policy year y */
      if (id === 'pdo-enso-same') {
        /* only when the two push the same way; otherwise no reading, plain pick */
        var e2 = phaseKnownFor(y), pd2 = signPhase(seasonMean(climate, 'pdo', y - 1, CLIMATE_MONTHS.pdo, log));
        return (e2 === 'el-nino' && pd2 === 'warm') || (e2 === 'la-nina' && pd2 === 'cold') ? e2 + '/' + pd2 : null;
      }
      if (id === 'pdo-enso') {
        var e = phaseKnownFor(y), pd = signPhase(seasonMean(climate, 'pdo', y - 1, CLIMATE_MONTHS.pdo, log));
        return e && pd ? e + '/' + pd : null;
      }
      if (id === 'amo') return signPhase(seasonMean(climate, 'amo', y - 1, CLIMATE_MONTHS.amo, log));
      return null;
    };
    G.years.forEach(function (y, k) { if (use[k]) labels[y] = labelFor(y); });
    state = labelFor(Y);
    opts.analogs = [{ labels: labels, phase: state, boost: 1, intervals: p.intervals || null }];
    return { opts: opts, state: state, used: used };
  }

  /* ------------------------------------------------------------ seasonal forecast models */
  /* data/prf/seasonal-fc.json, written by scripts/fetch_seasonal_models.py:
       { v, box_deg: 2, models: { <model>: { first, last, intervals: [..],
         v: { "<row>_<col>": "<two base-36 characters per year and interval>" } } } }
     Each value is the model's ensemble-mean precipitation over the two months
     of the interval, whole millimetres, averaged over a 2-degree box (row and
     col count 2-degree steps from 20N 130W, the PRF grid's own corner), for
     the policy year (the forecast started in November of the year before).
     "--" is missing. Settings fixed before the test was run: */
  var FORECAST_MODELS = ['cfsv2', 'spear', 'geos', 'cesm', 'cansips', 'ecmwf', 'ukmo', 'meteofrance', 'dwd', 'cmcc', 'jma'];
  var SKILL = {
    minR: 0.3,        /* a model tilts an interval in a block only where its past forecasts correlated at least this well with the index */
    minYears: 10,     /* past forecasts needed before a model's forecast counts, and years needed for a skill figure */
    minModels: 2,     /* the average needs at least two models in a year */
    boxCells: 8,      /* 8 quarter-degree cells = the 2-degree box of the forecast file */
    blockRows: 24, blockCols: 32,   /* skill is judged over 6 x 8 degree blocks */
    maxR: 0.95
  };
  function rowCol(grid) {
    grid = +grid;
    if (!(grid >= 1) || grid !== Math.floor(grid)) return null;
    return { row: Math.floor((grid - 1) / 300), col: (grid - 1) % 300 };
  }
  function boxOf(grid) { var rc = rowCol(grid); return rc ? Math.floor(rc.row / SKILL.boxCells) + '_' + Math.floor(rc.col / SKILL.boxCells) : null; }
  function blockOf(grid) { var rc = rowCol(grid); return rc ? Math.floor(rc.row / SKILL.blockRows) + '_' + Math.floor(rc.col / SKILL.blockCols) : null; }
  function seasonalRaw(sea, model, box, i, Y) {
    var m = sea && sea.models && sea.models[model];
    if (!m || Y < m.first || Y > m.last) return null;
    var j = m.intervals.indexOf(i), s = m.v && m.v[box];
    if (j < 0 || !s) return null;
    var at = ((Y - m.first) * m.intervals.length + j) * 2, c = s.substr(at, 2);
    if (c.length < 2 || c === '--') return null;
    var v = parseInt(c, 36);
    return isFinite(v) ? v : null;
  }
  function standardize(past, now) {
    var ks = Object.keys(past);
    if (ks.length < SKILL.minYears) return null;
    var mu = 0, sd = 0;
    ks.forEach(function (t) { mu += past[t]; }); mu /= ks.length;
    ks.forEach(function (t) { sd += (past[t] - mu) * (past[t] - mu); }); sd = Math.sqrt(sd / (ks.length - 1));
    if (!(sd > 1e-9)) return null;
    var z = {};
    ks.forEach(function (t) { z[t] = (past[t] - mu) / sd; });
    return { past: z, now: now == null ? null : (now - mu) / sd, n: ks.length };
  }
  /* One model's forecasts for box and interval, standardized on its forecasts
     for years before Y only: { past: { year: z }, now: z for Y or null, n }.
     model '*': the average of the declared models' z, in years with at least
     SKILL.minModels of them, standardized again the same way. */
  function zSeries(sea, model, box, i, Y) {
    if (model !== '*') {
      var m = sea && sea.models && sea.models[model];
      if (!m) return null;
      var past = {};
      for (var t = m.first; t < Y && t <= m.last; t++) { var v = seasonalRaw(sea, model, box, i, t); if (v != null) past[t] = v; }
      return standardize(past, seasonalRaw(sea, model, box, i, Y));
    }
    var sum = {}, cnt = {}, nowS = 0, nowN = 0;
    FORECAST_MODELS.forEach(function (mm) {
      var zs = zSeries(sea, mm, box, i, Y);
      if (!zs) return;
      Object.keys(zs.past).forEach(function (t) { sum[t] = (sum[t] || 0) + zs.past[t]; cnt[t] = (cnt[t] || 0) + 1; });
      if (zs.now != null) { nowS += zs.now; nowN++; }
    });
    var avg = {};
    Object.keys(sum).forEach(function (t) { if (cnt[t] >= SKILL.minModels) avg[t] = sum[t] / cnt[t]; });
    return standardize(avg, nowN >= SKILL.minModels ? nowS / nowN : null);
  }
  /* the standard normal's cumulative odds (Abramowitz and Stegun 7.1.26, good to 1e-7) */
  function normCdf(x) {
    var a = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * a);
    var e = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
    return x >= 0 ? (1 + e) / 2 : (1 - e) / 2;
  }
  /* Odds of the dry, middle and wet thirds given a forecast z from a model
     whose forecasts correlate r with the index: the index, standardized, taken
     as normal around r z with spread sqrt(1 - r^2). r 0 gives a third each. */
  var THIRD = 0.4307273;   /* the normal's 2/3 point */
  function outlookFromZ(z, r) {
    r = Math.max(0, Math.min(SKILL.maxR, +r || 0));
    var s = Math.sqrt(1 - r * r), below = normCdf((-THIRD - r * z) / s), above = 1 - normCdf((THIRD - r * z) / s);
    return { below: below, near: Math.max(0, 1 - below - above), above: above };
  }
  /* The skill table for one forecast id and policy year Y: for each 6 x 8
     degree block and interval, the correlation, pooled over the grids given
     (obs: prepare() results with .grid set) and the years before Y, between
     the forecast's z (standardized on years before Y) and the grid's index.
     null where fewer than SKILL.minYears years pair up. Nothing from Y or
     later is read: not the forecast, not the index. Oct-Nov and Nov-Dec of
     Y-1 are left out too (not final by Dec 1), though no November-started
     forecast reaches them. */
  function forecastSkill(sea, id, Y, obs) {
    var p = predictorById(id);
    if (!p || p.family !== 'forecast') return null;
    var acc = {}, zc = {};
    obs.forEach(function (G) {
      var box = boxOf(G.grid), blk = blockOf(G.grid);
      if (!box) return;
      for (var i = 0; i < N; i++) {
        var key = box + ':' + i;
        if (!(key in zc)) zc[key] = zSeries(sea, p.model, box, i, Y);
        var zs = zc[key];
        if (!zs) continue;
        var a = (acc[blk] = acc[blk] || []);
        var c = (a[i] = a[i] || { n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, yrs: {} });
        for (var k = 0; k < G.years.length; k++) {
          var t = G.years[k];
          if (t >= Y || (t === Y - 1 && i >= FIRST_LATE)) continue;
          var z = zs.past[t], x = G.X[k][i];
          if (z == null || x == null) continue;
          c.n++; c.sx += z; c.sy += x; c.sxx += z * z; c.syy += x * x; c.sxy += z * x; c.yrs[t] = 1;
        }
      }
    });
    var out = {};
    Object.keys(acc).forEach(function (blk) {
      var row = [];
      for (var i = 0; i < N; i++) {
        var c = acc[blk][i];
        if (!c || Object.keys(c.yrs).length < SKILL.minYears) { row.push(null); continue; }
        var vx = c.sxx - c.sx * c.sx / c.n, vy = c.syy - c.sy * c.sy / c.n, cv = c.sxy - c.sx * c.sy / c.n;
        row.push(vx > 0 && vy > 0 ? Math.round(1000 * cv / Math.sqrt(vx * vy)) / 1000 : null);
      }
      out[blk] = row;
    });
    return out;
  }

  /* ------------------------------------------------------------ structure: coverage, and a steadier spread */
  /* Expected return on the producer's premium of the rate-led pick, per $1
     paid: payback / (1 - subsidy) - 1, the same for every split (each
     interval's value is its rate times payback, less its rate times the
     producer's share), so the coverage choice comes down to the grid's
     payback on its rates at each level and USDA's share at that level.
     Gs: { coverage: prepare() result }. Returns the coverage with the most,
     ties to the higher coverage, from the years in use and what was known at
     asOf. Productivity factor does not enter: it scales protection, premium
     and payments alike, so it changes dollars, not the return per dollar. */
  function coverageEdge(Gs, use, asOf) {
    var best = null;
    Object.keys(Gs).map(Number).sort(function (a, b) { return b - a; }).forEach(function (c) {
      var G = Gs[c];
      if (!G || G.allowed.filter(Boolean).length < 2) return;
      var u = use || allMask(G);
      var pv = pricedValues(G, weights(G, u, { asOf: asOf }), u, asOf);
      if (pv.payback == null || !(G.subsidy < 1)) return;
      var ret = pv.payback / (1 - G.subsidy) - 1;
      if (!best || ret > best.ret + 1e-12) best = { coverage: c, ret: ret, payback: pv.payback };
    });
    return best;
  }
  /* A steadier pick at about the same expected dollars: of every allowed set
     of intervals (each filled the rate-led way, and evenly), the ones within
     SPREAD_NEAR of the best expected score, the one whose intervals together
     missed paying in the fewest earlier years; ties to the higher score. Uses
     what was known at asOf only. Returns { split, score, misses } or null. */
  var SPREAD_NEAR = 0.05;
  function spreadPick(G, opts) {
    opts = opts || {};
    var use = opts.use || allMask(G);
    var a = pick(G, { use: use, asOf: opts.asOf, step: opts.step });
    if (!a) return null;
    var v = a.values, floor = a.score - SPREAD_NEAR * Math.abs(a.score);
    var sets = supports(G.allowed.map(function (ok, i) { return ok && v[i] != null; })), best = null;
    for (var s = 0; s < sets.length; s++) {
      var S = sets[s], on = [];
      for (var i = 0; i < N; i++) on.push(S.indexOf(i) >= 0);
      var cands = [allocate(G, v, S, opts.step), (function () { var sp = fill(G, on); return sp && { split: sp, score: scoreOf(sp, v) }; })()];
      for (var c = 0; c < cands.length; c++) {
        var cd = cands[c];
        if (!cd || cd.score < floor - 1e-12) continue;
        var miss = 0;
        for (var k = 0; k < G.years.length; k++) {
          if (!use[k]) continue;
          var hit = false, known = true;
          for (var q = 0; q < S.length; q++) {
            if (lateUnknown(G, k, S[q], opts.asOf)) { known = false; break; }
            if (G.P[k][S[q]] > 0) hit = true;
          }
          if (known && !hit) miss++;
        }
        if (!best || miss < best.misses || (miss === best.misses && cd.score > best.score + 1e-12)) best = { split: cd.split, score: cd.score, misses: miss };
      }
    }
    return best;
  }
  function scoreOf(split, v) { var s = 0; for (var i = 0; i < N; i++) if (split[i]) s += split[i] / 100 * v[i]; return s; }

  /* The predictors data/prf/opt.json says held up: kept is set by the
     backtest only when the adjusted odds clear 5% and the edge is positive
     at every coverage tested. Anything else, or no file, keeps nothing. */
  function keptPredictors(optJson) {
    var p = optJson && optJson.predictors, out = [];
    if (!p) return out;
    PREDICTORS.forEach(function (d) { if (p[d.id] && p[d.id].kept === true && !d.untestable && !d.stub && !d.structural) out.push(d.id); });
    return out;
  }

  /* Holm's step-down adjustment over a family of m comparisons. ps: { key: p }
     for those run; keys of the family not in ps count as p = 1. Returns
     { key: adjusted p } for the keys in ps. */
  function holm(ps, family) {
    var keys = family.slice();
    Object.keys(ps).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    var m = keys.length;
    var rows = keys.map(function (k) { return { k: k, p: ps[k] == null ? 1 : ps[k] }; });
    rows.sort(function (a, b) { return a.p - b.p || (a.k < b.k ? -1 : 1); });
    var out = {}, run = 0;
    rows.forEach(function (r, i) {
      run = Math.max(run, Math.min(1, (m - i) * r.p));
      if (ps[r.k] != null) out[r.k] = run;
    });
    return out;
  }

  /* ------------------------------------------------------------ weights */
  /* Per year and interval, how much a past year counts.
       enso:   the phase this year ('el-nino' | 'la-nina' | 'neutral'): years
               whose fall phase matched count (1 + ensoBoost) times.
       outlook: [11] of { below, near, above } probabilities, or null per
               interval: each past year counts 3 x the probability of the
               tercile it fell in (terciles of that interval over the years in
               use), so a 40/33/27 lean makes dry years count 1.2 and wet 0.81.
       recency: { asOf: policy year, halfLife | lastN }: recent years count
               more (see recencyWeight).
       analogs: [{ labels: { year: label }, phase, boost, intervals }]: years
               whose label equals phase count (1 + boost) times, on the listed
               intervals only (all when intervals is null). Built by tiltFor.
     Returns W[k][i], 0 for years not in use. */
  function weights(G, use, opts) {
    opts = opts || {};
    var W = [], boost = opts.ensoBoost == null ? 1 : +opts.ensoBoost, phase = normPhase(opts.enso);
    var cuts = null;
    if (opts.outlook) {
      cuts = [];
      for (var i = 0; i < N; i++) {
        var o = opts.outlook[i];
        if (!o) { cuts.push(null); continue; }
        var v = [];
        for (var k = 0; k < G.years.length; k++) if (use[k] && G.X[k][i] != null && !lateUnknown(G, k, i, opts.asOf)) v.push(G.X[k][i]);
        v.sort(function (a, b) { return a - b; });
        cuts.push(v.length >= 9 ? [quantile(v, 1 / 3), quantile(v, 2 / 3)] : null);
      }
    }
    var analogs = opts.analogs || [];
    for (var k2 = 0; k2 < G.years.length; k2++) {
      var row = new Array(N);
      var base = use[k2] ? 1 : 0;
      if (base && phase && phaseKnownFor(G.years[k2]) === phase) base *= 1 + boost;
      if (base && opts.recency) base *= recencyWeight(G.years[k2], opts.recency);
      for (var j = 0; j < N; j++) {
        var w = lateUnknown(G, k2, j, opts.asOf) ? 0 : base;
        for (var a = 0; a < analogs.length && w; a++) {
          var an = analogs[a];
          if (an.phase == null || (an.intervals && an.intervals.indexOf(j) < 0)) continue;
          if (an.labels[G.years[k2]] === an.phase) w *= 1 + (an.boost == null ? 1 : +an.boost);
        }
        if (w && cuts && cuts[j]) {
          var x = G.X[k2][j], o2 = opts.outlook[j];
          var p = x <= cuts[j][0] ? o2.below : x <= cuts[j][1] ? o2.near : o2.above;
          w *= 3 * (+p || 0);
        }
        row[j] = w;
      }
      W.push(row);
    }
    return W;
  }

  /* The years a score averages over. 'net': all in use. 'dry': the driest
     fifth of those by whole-year precipitation (ties in, so never fewer). */
  function scoreYears(G, use, objective, asOf) {
    var out = use.slice();
    if (objective !== 'dry') return { mask: out, cut: null };
    /* the whole-year total of Y-1 needs Nov-Dec, not final by Dec 1 of Y-1 */
    var ok = function (k) { return use[k] && G.annual[k] != null && !(asOf != null && G.years[k] === asOf - 1); };
    var a = [];
    for (var k = 0; k < G.years.length; k++) if (ok(k)) a.push(G.annual[k]);
    a.sort(function (x, y) { return x - y; });
    var cut = quantile(a, 0.2);
    for (var k2 = 0; k2 < G.years.length; k2++) out[k2] = !!(ok(k2) && G.annual[k2] <= cut + 1e-12);
    return { mask: out, cut: cut };
  }

  /* value_i: weighted average payment factor over the scored years, less the
     producer's premium rate. Per $1 of protection. */
  function values(G, W, mask) {
    var v = new Array(N);
    for (var i = 0; i < N; i++) {
      if (!G.allowed[i]) { v[i] = null; continue; }
      var s = 0, w = 0;
      for (var k = 0; k < G.years.length; k++) {
        if (!mask[k]) continue;
        var wk = W[k][i]; if (!wk) continue;
        s += wk * G.P[k][i]; w += wk;
      }
      v[i] = w > 0 ? s / w - G.cost[i] : null;
    }
    return v;
  }

  /* value_i the 'priced' way: RMA's rate for the interval times the grid's
     own payback on its rates (pooled over every offered interval, so seventy
     years of eleven intervals inform one number, not seventy years each),
     times a forecast tilt for the interval: its weighted average payment
     over its plain average (1 with no forecast). Less the producer premium.
     Why: the grid's per-interval history did not predict the next year in
     the walk-forward test (scripts/prf_opt_backtest.mjs); RMA's rate did
     better, because the subsidy is a fixed share of whatever premium is owed
     and RMA prices each interval to pay back about the same share. */
  function pricedValues(G, W, mask, asOf) {
    var num = 0, den = 0, v = new Array(N), i, k;
    for (k = 0; k < G.years.length; k++) {
      if (!mask[k]) continue;
      for (i = 0; i < N; i++) if (G.allowed[i] && !lateUnknown(G, k, i, asOf)) { num += G.P[k][i]; den += G.rates[i]; }
    }
    var payback = den > 0 ? num / den : null;
    for (i = 0; i < N; i++) {
      if (!G.allowed[i] || payback == null) { v[i] = null; continue; }
      var s = 0, w = 0, plain = 0, n = 0;
      for (k = 0; k < G.years.length; k++) {
        if (!mask[k] || lateUnknown(G, k, i, asOf)) continue;
        plain += G.P[k][i]; n++;
        var wk = W[k][i]; if (wk) { s += wk * G.P[k][i]; w += wk; }
      }
      var tilt = plain > 0 && w > 0 ? (s / w) / (plain / n) : 1;
      v[i] = G.rates[i] * payback * tilt - G.cost[i];
    }
    v.payback = payback;
    return v;
  }

  /* ------------------------------------------------------------ the search */
  /* every set of at least two intervals, no two sharing a month, all allowed */
  var supportCache = {};
  function supports(allowed) {
    var key = allowed.map(function (b) { return b ? 1 : 0; }).join('');
    if (supportCache[key]) return supportCache[key];
    var out = [];
    (function walk(i, cur) {
      if (i >= N) { if (cur.length >= 2) out.push(cur.slice()); return; }
      walk(i + 1, cur);
      if (allowed[i] && !(cur.length && cur[cur.length - 1] === i - 1)) { cur.push(i); walk(i + 1, cur); cur.pop(); }
    })(0, []);
    supportCache[key] = out;
    return out;
  }

  /* The best split for these values. step: whole percents per notch (1).
     Ties go to the first found, in a fixed order, so the answer never depends
     on anything but the inputs. */
  function allocate(G, v, S, step) {
    step = step || 1;
    var units = Math.round(100 / step), lo = [], hi = [], sumLo = 0, sumHi = 0;
    for (var t = 0; t < S.length; t++) {
      var a = Math.ceil(G.lo[S[t]] / step - 1e-9), b = Math.floor(G.hi[S[t]] / step + 1e-9);
      if (a < 1) a = 1;
      if (b < a) return null;
      lo.push(a); hi.push(b); sumLo += a; sumHi += b;
    }
    if (sumLo > units || sumHi < units) return null;
    var alloc = lo.slice(), left = units - sumLo;
    var order = S.map(function (_, q) { return q; }).sort(function (p, q) { return v[S[q]] - v[S[p]] || S[p] - S[q]; });
    for (var o = 0; o < order.length && left > 0; o++) {
      var q = order[o], room = hi[q] - alloc[q], put = Math.min(room, left);
      alloc[q] += put; left -= put;
    }
    var score = 0, split = new Array(N);
    for (var z = 0; z < N; z++) split[z] = 0;
    for (var t2 = 0; t2 < S.length; t2++) { split[S[t2]] = alloc[t2] * step; score += alloc[t2] * step / 100 * v[S[t2]]; }
    return { split: split, score: score };
  }
  function solve(G, v, step) {
    var best = null, sets = supports(G.allowed.map(function (a, i) { return a && v[i] != null; }));
    for (var s = 0; s < sets.length; s++) {
      var c = allocate(G, v, sets[s], step);
      if (c && (!best || c.score > best.score + 1e-12)) best = c;
    }
    return best;
  }

  /* ------------------------------------------------------------ fixed rules to compare against */
  function fill(G, on) {
    if (!M) return null;
    var ok = on.filter(Boolean).length >= 2 && on.every(function (b, i) { return !b || G.allowed[i]; });
    if (!ok) return null;
    var sp = M.evenSplit(on, G.lo, G.hi);
    if (!sp) return null;
    var chk = M.checkSplit(sp, G.lo, G.hi, G.allowed);
    return chk.ok && chk.used >= 2 ? sp : null;
  }
  /* An even spread over the six intervals that share no month (as even as the
     county's caps allow; Jan-Feb's 25% cap leaves 15/17/17/17/17/17), over
     the allowed ones of them; failing that, the other five. */
  function evenSpread(G) {
    var on = [], i;
    for (i = 0; i < N; i++) on.push(i % 2 === 0 && G.allowed[i]);
    var sp = fill(G, on);
    if (sp) return sp;
    on = []; for (i = 0; i < N; i++) on.push(i % 2 === 1 && G.allowed[i]);
    return fill(G, on);
  }
  /* The page's example: Apr-May and Jun-Jul, half and half. */
  function pageDefault(G) {
    var on = []; for (var i = 0; i < N; i++) on.push(i === 3 || i === 5);
    return fill(G, on);
  }
  /* "Insure the two driest months": the two allowed intervals, sharing no
     month, with the least normal precipitation between them, half and half
     (as near as the caps allow). A pair whose caps cannot reach 100 (Jan-Feb
     at 25 with a 70 cap beside it) is passed over for the next driest. */
  function driestTwo(G) {
    var mm = G.avgMm || [], pairs = [];
    for (var a = 0; a < N; a++) for (var b = a + 2; b < N; b++) {
      if (!G.allowed[a] || !G.allowed[b] || mm[a] == null || mm[b] == null) continue;
      pairs.push({ a: a, b: b, s: mm[a] + mm[b] });
    }
    pairs.sort(function (x, y) { return x.s - y.s || x.a - y.a || x.b - y.b; });
    for (var k = 0; k < pairs.length; k++) {
      var on = []; for (var i = 0; i < N; i++) on.push(i === pairs[k].a || i === pairs[k].b);
      var sp = fill(G, on);
      if (sp) return sp;
    }
    return null;
  }

  /* ------------------------------------------------------------ scoring */
  function netIn(G, split, k) {
    if (!split) return null;
    var s = 0;
    for (var i = 0; i < N; i++) if (split[i]) s += split[i] / 100 * (G.P[k][i] - G.cost[i]);
    return s;
  }
  function premiumOf(G, split) {
    var s = 0; for (var i = 0; i < N; i++) if (split[i]) s += split[i] / 100 * G.cost[i]; return s;
  }
  /* What a split would have done in every year in mask, per $1 of protection. */
  function record(G, split, mask) {
    var nets = [], paid = 0, yrs = [];
    for (var k = 0; k < G.years.length; k++) {
      if (mask && !mask[k]) continue;
      var n = netIn(G, split, k), any = false;
      for (var i = 0; i < N; i++) if (split[i] && G.P[k][i] > 0) any = true;
      if (any) paid++;
      nets.push(n); yrs.push(G.years[k]);
    }
    var srt = nets.slice().sort(function (a, b) { return a - b; }), sum = 0;
    nets.forEach(function (x) { sum += x; });
    var worst = null, best = null;
    nets.forEach(function (x, j) {
      if (!worst || x < worst.net) worst = { year: yrs[j], net: x };
      if (!best || x > best.net) best = { year: yrs[j], net: x };
    });
    var run = 0, longest = 0;
    for (var k2 = 0; k2 < G.years.length; k2++) {
      if (mask && !mask[k2]) continue;
      var hit = false;
      for (var i2 = 0; i2 < N; i2++) if (split[i2] && G.P[k2][i2] > 0) hit = true;
      run = hit ? 0 : run + 1; if (run > longest) longest = run;
    }
    return { n: nets.length, first: yrs[0], last: yrs[yrs.length - 1], mean: nets.length ? sum / nets.length : null,
             p10: quantile(srt, 0.1), mid: quantile(srt, 0.5), p90: quantile(srt, 0.9),
             worst: worst, best: best, paidYears: paid, premium: premiumOf(G, split), longestDry: longest };
  }

  function allMask(G) { return G.years.map(function () { return true; }); }

  /* ------------------------------------------------------------ one pick */
  /* opts: { objective: 'net'|'dry', estimator: 'priced'|'history', step,
             enso, ensoBoost, outlook, use (mask) }
     The estimator defaults to 'priced' for 'net' and is always 'history'
     for 'dry' (a dry-year average has no rate to anchor to). */
  function estimatorFor(opts) {
    if (opts.objective === 'dry') return 'history';
    return opts.estimator === 'history' ? 'history' : 'priced';
  }
  function pick(G, opts) {
    opts = opts || {};
    var use = opts.use || allMask(G);
    var W = weights(G, use, opts), sy = scoreYears(G, use, opts.objective, opts.asOf);
    var est = estimatorFor(opts);
    var v = est === 'priced' ? pricedValues(G, W, sy.mask, opts.asOf) : values(G, W, sy.mask);
    var best = solve(G, v, opts.step);
    if (!best) return null;
    return { split: best.split, score: best.score, values: v, scored: sy, estimator: est };
  }

  /* ------------------------------------------------------------ walk-forward */
  /* For each year Y from opts.from (1981) to the last year in G, with at least
     opts.minTrain (30) earlier years: pick with years < Y only, score on Y.
     opts.onTrain(Y, yearsUsed) is called with the exact years each pick saw. */
  function walkForward(G, opts) {
    opts = opts || {};
    var from = opts.from || 1981, minTrain = opts.minTrain || 30, objective = opts.objective || 'net';
    var even = evenSpread(G), def = pageDefault(G), dry2 = driestTwo(G);
    var rows = [];
    /* opts.predictors: ids from PREDICTORS to test alongside; those the data
       cannot support (opts.climate lacks the series) are left out */
    var preds = (opts.predictors || []).filter(function (id) { var p = predictorById(id); return p && !p.structural && !predictorUnavailable(id, opts.climate); });
    for (var t = 0; t < G.years.length; t++) {
      var Y = G.years[t];
      if (Y < from) continue;
      var use = G.years.map(function (y) { return y < Y; });
      var nTrain = use.filter(Boolean).length;
      if (nTrain < minTrain) continue;
      if (opts.onTrain) opts.onTrain(Y, G.years.filter(function (y, k) { return use[k]; }));
      /* asOf: what a buyer had on Dec 1 of Y-1 (see lateUnknown) */
      var a = pick(G, { objective: objective, estimator: opts.estimator, step: opts.step, use: use, asOf: Y });
      var phase = phaseKnownFor(Y);
      var b = phase ? pick(G, { objective: objective, estimator: opts.estimator, step: opts.step, use: use, asOf: Y, enso: phase, ensoBoost: opts.ensoBoost }) : a;
      if (!a) continue;
      var hst = a.estimator === 'history' ? a : pick(G, { objective: objective, estimator: 'history', step: opts.step, use: use, asOf: Y });
      /* was Y a dry year, by the cut from earlier years only */
      var cut = scoreYears(G, use, 'dry').cut, dryYear = G.annual[t] != null && cut != null && G.annual[t] <= cut + 1e-12;
      var row = { year: Y, phase: phase, dry: dryYear,
                  opt: netIn(G, a.split, t), optEnso: b ? netIn(G, b.split, t) : null, hist: netIn(G, hst.split, t),
                  even: netIn(G, even, t), def: netIn(G, def, t), dry2: netIn(G, dry2, t),
                  pick: a.split, pickEnso: b ? b.split : null };
      /* each predictor: the same pick, reweighted by what was known for Y.
         With no reading for Y (state null) it is the plain pick, so it scores
         the same as opt that year. */
      if (preds.length) {
        row.tilt = {}; row.tiltPick = {}; row.tiltState = {};
        for (var q = 0; q < preds.length; q++) {
          var tf = tiltFor(G, preds[q], Y, use, opts.climate);
          if (opts.onTilt) opts.onTilt(Y, preds[q], tf ? tf.used : null);
          var pk = tf && tf.state != null ? pick(G, Object.assign({ objective: objective, estimator: opts.estimator, step: opts.step, use: use, asOf: Y }, tf.opts)) : a;
          row.tilt[preds[q]] = netIn(G, (pk || a).split, t);
          row.tiltPick[preds[q]] = (pk || a).split;
          row.tiltState[preds[q]] = tf ? tf.state : null;
        }
      }
      rows.push(row);
    }
    return { rows: rows, even: even, def: def, dry2: dry2, objective: objective, estimator: estimatorFor({ objective: objective, estimator: opts.estimator }), predictors: preds };
  }

  /* compare one strategy's yearly nets with another's */
  function versus(rows, key, other, onlyDry) {
    var w = 0, l = 0, ties = 0, sum = 0, n = 0, a = 0, b = 0, diffs = [];
    rows.forEach(function (r) {
      if (onlyDry && !r.dry) return;
      if (r[key] == null || r[other] == null) return;
      var d = r[key] - r[other];
      n++; sum += d; a += r[key]; b += r[other]; diffs.push(d);
      if (d > 1e-9) w++; else if (d < -1e-9) l++; else ties++;
    });
    return { n: n, wins: w, losses: l, ties: ties, meanDiff: n ? sum / n : null,
             meanA: n ? a / n : null, meanB: n ? b / n : null, pSign: signTest(w, l), p: flipTest(diffs) };
  }

  /* A verdict in words, first, from the out-of-sample record against an even
     spread. Gates: fewer than 20 scored years says so instead. */
  function verdict(vs) {
    if (!vs || vs.n < 20) return { key: 'thin', text: 'Not enough history to say.' };
    if (vs.meanDiff <= 0) return { key: 'behind', text: 'Picking months this way would not have beaten an even spread here.' };
    if (vs.p < 0.05) return { key: 'held', text: 'Picking months this way held up here.' };
    return { key: 'luck', text: 'Picking months this way came out ahead here, by a margin luck could produce.' };
  }

  function summarizeBacktest(wf) {
    var rows = wf.rows;
    return {
      years: rows.length, first: rows.length ? rows[0].year : null, last: rows.length ? rows[rows.length - 1].year : null,
      objective: wf.objective, estimator: wf.estimator,
      histVsEven: versus(rows, 'hist', 'even'),
      vsEven: versus(rows, 'opt', 'even'), vsDefault: versus(rows, 'opt', 'def'), vsDry2: versus(rows, 'opt', 'dry2'),
      ensoVsHistory: versus(rows, 'optEnso', 'opt'), ensoVsEven: versus(rows, 'optEnso', 'even'),
      dryVsEven: versus(rows, 'opt', 'even', true),
      changes: rows.reduce(function (c, r, i) { return c + (i && r.pick.join() !== rows[i - 1].pick.join() ? 1 : 0); }, 0)
    };
  }

  /* ------------------------------------------------------------ outlook input */
  /* Turns data/prf/outlook.json (scripts/fetch_prf_outlook.py, not merged
     yet) into what weights() takes, for one grid. Shapes read:
       { enso: { phase, oni, season, issued }, intervals: { "625": {below,near,above}, ... } }
       { enso, grids: { "<grid id>": { "625": {...}, ... } } }
     Probabilities as fractions or percents. Anything else gives no tilt. */
  function outlookFor(json, gridId) {
    if (!json || typeof json !== 'object') return { outlook: null, enso: null, issued: null };
    var per = null;
    if (json.grids && json.grids[String(gridId)]) per = json.grids[String(gridId)];
    else if (json.intervals) per = json.intervals;
    var out = null, codes = M ? M.CODES : null;
    if (per && codes) {
      out = [];
      var any = false;
      for (var i = 0; i < N; i++) {
        var o = per[codes[i]] || per[LABELS[i]];
        if (!o) { out.push(null); continue; }
        var b = +o.below, n = +o.near, a = +o.above;
        if (!(isFinite(b) && isFinite(n) && isFinite(a))) { out.push(null); continue; }
        var s = b + n + a;
        if (!(s > 0)) { out.push(null); continue; }
        out.push({ below: b / s, near: n / s, above: a / s }); any = true;
      }
      if (!any) out = null;
    }
    var e = json.enso || null, phase = e ? normPhase(e.phase) || ensoPhase(e.oni) : null;
    return { outlook: out, enso: phase, ensoInfo: e, issued: json.issued || (e && e.issued) || null, source: json.source || null };
  }

  /* ------------------------------------------------------------ plain-English reasons */
  function pct(x) { return Math.round(x * 100) + '%'; }
  function per100(x) { return '$' + (Math.round(x * 10000) / 100).toFixed(2); }
  function listAnd(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }

  function reasons(G, rec, fc, bt, opts) {
    var out = [], sp = rec.split, used = [], n = G.years.length;
    for (var i = 0; i < N; i++) if (sp[i]) used.push(i);
    used.sort(function (a, b) { return sp[b] - sp[a] || a - b; });
    out.push('The split: ' + listAnd(used.map(function (j) { return LABELS[j] + ' ' + sp[j] + '%'; })) + '.');
    if (rec.estimator === 'priced' && rec.values.payback != null) {
      var ranked = [];
      for (var q = 0; q < N; q++) if (G.allowed[q]) ranked.push(q);
      ranked.sort(function (a, b) { return G.rates[b] - G.rates[a] || a - b; });
      out.push('RMA’s rate here is highest for ' + listAnd(ranked.slice(0, 2).map(function (j, x) { return LABELS[j] + ' (' + per100(G.rates[j]) + (x ? '' : ' per $100 of protection') + ')'; }))
        + ', lowest for ' + LABELS[ranked[ranked.length - 1]] + ' (' + per100(G.rates[ranked[ranked.length - 1]]) + '). USDA pays ' + pct(G.subsidy)
        + ' of the premium, so the highest-rate months carry the most USDA money.');
      out.push('Over ' + n + ' years (' + G.years[0] + ' to ' + G.years[n - 1] + '), all offered intervals paid back $' + rec.values.payback.toFixed(2) + ' per $1 of full premium, against the $'
        + (1 - G.subsidy).toFixed(2) + ' you pay. That gap times the rate is the expected net, so it is largest where the rate is.');
    }
    var trig = G.coverage;
    used.forEach(function (j) {
      var below = 0, sum = 0;
      for (var k = 0; k < n; k++) { if (G.P[k][j] > 0) below++; sum += G.P[k][j]; }
      out.push(LABELS[j] + ': under the ' + trig + '% trigger in ' + below + ' of ' + n + ' years. Paid ' + per100(sum / n) + ' a year per $100 of protection on average, against '
        + per100(G.cost[j]) + ' of your premium.');
    });
    used.forEach(function (j) {
      if (sp[j] === G.hi[j] && used.length > 1) out.push(LABELS[j] + ' is held to ' + G.hi[j] + '%, ' + (j === 0 ? 'the 2027 cap on January and February.' : 'this county’s cap for it.'));
    });
    if (fc && fc.notes) fc.notes.forEach(function (t) { out.push(t); });
    if (bt) {
      var vs = bt.objective === 'dry' ? bt.dryVsEven : bt.vsEven;
      out.push(bt.verdict.text + ' ' + (bt.objective === 'dry'
        ? 'In the ' + vs.n + ' dry years from ' + bt.first + ' to ' + bt.last + ', a pick made each fall from the years before it beat an even spread in ' + vs.wins + '.'
        : 'From ' + bt.first + ' to ' + bt.last + ', a pick made each fall from the years before it beat an even spread in ' + vs.wins + ' of ' + vs.n + ' years.')
        + ' On average it came out ' + (vs.meanDiff >= 0 ? 'ahead by ' : 'behind by ') + per100(Math.abs(vs.meanDiff)) + ' a year per $100 of protection.'
        + (vs.meanDiff > 0 && vs.losses > vs.wins ? ' It was behind in ' + vs.losses + ' of those years, when it cost more and paid nothing, and made up the gap in the years it paid.' : ''));
    }
    return out;
  }

  /* ------------------------------------------------------------ everything the panel needs */
  /* input as prepare(); opts: { objective, step, enso, outlook, ensoBoost, backtest: true } */
  function recommend(input, opts) {
    opts = opts || {};
    var objective = opts.objective === 'dry' ? 'dry' : 'net';
    var G = prepare(input);
    if (G.years.length < 30) return { ok: false, why: 'Fewer than 30 complete years on record for the offered intervals here, so the panel says nothing.' };
    var allowedN = G.allowed.filter(Boolean).length;
    if (allowedN < 2) return { ok: false, why: 'This county offers fewer than two priced intervals at this coverage, so there is nothing to choose.' };
    var all = allMask(G);
    var h = pick(G, { objective: objective, estimator: opts.estimator, step: opts.step });
    if (!h) return { ok: false, why: 'No split fits this county’s limits at this coverage.' };
    var dryMask = scoreYears(G, all, 'dry').mask;
    var rec = { split: h.split, score: h.score, values: h.values, estimator: h.estimator, record: record(G, h.split), dryRecord: record(G, h.split, dryMask) };
    var hh = h.estimator === 'history' ? h : pick(G, { objective: objective, estimator: 'history', step: opts.step });
    var naive = hh && { split: hh.split, record: record(G, hh.split) };
    var even = evenSpread(G), def = pageDefault(G), dry2 = driestTwo(G);
    var base = {
      even: even && { split: even, record: record(G, even), dryRecord: record(G, even, dryMask) },
      def: def && { split: def, record: record(G, def), dryRecord: record(G, def, dryMask) },
      dry2: dry2 && { split: dry2, record: record(G, dry2), dryRecord: record(G, dry2, dryMask) }
    };

    /* the forecast tilt, and any predictor that held up out of sample
       (opts.tilts: ids the published test kept; never one it did not) */
    var fc = null, phase = normPhase(opts.enso), outl = opts.outlook || null;
    var policyYear = opts.policyYear || G.years[G.years.length - 1] + 1, tiltOn = [], tiltOpts = { analogs: [] }, tiltNotes = [];
    (opts.tilts || []).forEach(function (id) {
      var p = predictorById(id);
      if (!p || objective !== 'net') return;
      var why = predictorUnavailable(id, opts.climate);
      var tf = why ? null : tiltFor(G, id, policyYear, all, opts.climate);
      if (!tf || tf.state == null) { tiltNotes.push(p.name + ': held up in the test, but this year’s reading is ' + (why ? 'missing (' + why + ')' : 'not known yet') + ', so it does not move the pick.'); return; }
      if (tf.opts.recency) tiltOpts.recency = tf.opts.recency;
      if (tf.opts.analogs) tiltOpts.analogs = tiltOpts.analogs.concat(tf.opts.analogs);
      tiltOn.push(id);
      tiltNotes.push(p.name + ': held up in the test across grids, so it is part of this pick.');
    });
    if (phase || outl || tiltOn.length) {
      var f = pick(G, { objective: objective, estimator: opts.estimator, step: opts.step, enso: phase, ensoBoost: opts.ensoBoost, outlook: outl, recency: tiltOpts.recency, analogs: tiltOpts.analogs });
      var moved = 0;
      for (var i = 0; i < N; i++) moved += Math.abs(f.split[i] - h.split[i]);
      moved /= 2;
      var notes = [];
      if (phase) {
        var match = G.years.filter(function (y) { return phaseKnownFor(y) === phase; });
        var top = h.split.indexOf(Math.max.apply(null, h.split));
        var short = 0;
        G.years.forEach(function (y, k) { if (phaseKnownFor(y) === phase && G.P[k][top] > 0) short++; });
        var allShort = 0; G.years.forEach(function (y, k) { if (G.P[k][top] > 0) allShort++; });
        notes.push('This fall reads ' + PHASE_NAME[phase] + '. In the ' + match.length + ' years on record that followed a ' + PHASE_NAME[phase] + ' fall, ' + LABELS[top]
          + ' came in under the trigger in ' + short + ' (' + (match.length ? pct(short / match.length) : 'none') + '), against ' + allShort + ' of ' + G.years.length + ' (' + pct(allShort / G.years.length) + ') in all years.');
      }
      if (outl) {
        for (var j = 0; j < N; j++) {
          var o = outl[j];
          if (!o || !(f.split[j] || h.split[j])) continue;
          var lean = o.below - o.above;
          if (Math.abs(lean) < 0.05) continue;
          notes.push('NOAA’s outlook leans ' + (lean > 0 ? 'dry' : 'wet') + ' for ' + LABELS[j] + ' (' + pct(o.below) + ' below normal, ' + pct(o.near) + ' near, ' + pct(o.above) + ' above).');
        }
      }
      tiltNotes.forEach(function (t) { notes.push(t); });
      notes.push(moved ? 'The outlook moved ' + moved + '% of the policy compared with the record alone.' : 'The outlook did not change the pick.');
      fc = { split: f.split, score: f.score, moved: moved, record: record(G, f.split), notes: notes, enso: phase, outlook: !!outl, tilts: tiltOn,
             historyScoreOfForecastPick: (function () { var s = 0; for (var q = 0; q < N; q++) if (f.split[q]) s += f.split[q] / 100 * h.values[q]; return s; })() };
    }

    /* the steadier split (spreadPick), only when the published test says it
       cut the years with no payment (opts.steadier) and it differs */
    var steadier = null;
    if (opts.steadier && objective === 'net') {
      var sp = spreadPick(G, { step: opts.step });
      if (sp && sp.split.join() !== h.split.join()) steadier = { split: sp.split, score: sp.score, record: record(G, sp.split) };
    }

    var bt = null;
    if (opts.backtest !== false) {
      var wf = walkForward(G, { objective: objective, estimator: opts.estimator, step: opts.step, ensoBoost: opts.ensoBoost });
      bt = summarizeBacktest(wf);
      bt.verdict = verdict(objective === 'dry' ? bt.dryVsEven : bt.vsEven);
      bt.rows = wf.rows.map(function (r) { return { year: r.year, opt: r.opt, optEnso: r.optEnso, hist: r.hist, even: r.even, def: r.def, dry2: r.dry2, dry: r.dry, phase: r.phase }; });
    }
    return { ok: true, objective: objective, coverage: G.coverage, subsidy: G.subsidy, years: { n: G.years.length, first: G.years[0], last: G.years[G.years.length - 1] },
             rec: rec, naive: naive, forecast: fc, steadier: steadier, base: base, tiltNotes: tiltNotes, backtest: bt, reasons: reasons(G, rec, fc, bt, opts), limits: { lo: G.lo, hi: G.hi, allowed: G.allowed } };
  }

  var api = {
    N: N, LABELS: LABELS, YEAR_SET: YEAR_SET,
    ONI_FIRST: ONI_FIRST, ONI_ASO: ONI_ASO, ONI_SOURCE: ONI_SOURCE, PHASE_NAME: PHASE_NAME,
    oniASO: oniASO, ensoPhase: ensoPhase, phaseKnownFor: phaseKnownFor, normPhase: normPhase,
    prepare: prepare, weights: weights, scoreYears: scoreYears, values: values, supports: supports, solve: solve,
    pick: pick, pricedValues: pricedValues, estimatorFor: estimatorFor, record: record, netIn: netIn, evenSpread: evenSpread, pageDefault: pageDefault, driestTwo: driestTwo,
    walkForward: walkForward, versus: versus, verdict: verdict, summarizeBacktest: summarizeBacktest,
    outlookFor: outlookFor, reasons: reasons, recommend: recommend, signTest: signTest, flipTest: flipTest, quantile: quantile,
    PREDICTORS: PREDICTORS, FAMILY: FAMILY, FAMILY_COVERAGES: FAMILY_COVERAGES, CLIMATE_MONTHS: CLIMATE_MONTHS, FALL_INTERVAL: FALL_INTERVAL,
    predictorById: predictorById, predictorUnavailable: predictorUnavailable, recencyWeight: recencyWeight, seasonMean: seasonMean,
    tiltFor: tiltFor, holm: holm, keptPredictors: keptPredictors,
    FORECAST_MODELS: FORECAST_MODELS, SKILL: SKILL, boxOf: boxOf, blockOf: blockOf, seasonalRaw: seasonalRaw, zSeries: zSeries,
    normCdf: normCdf, outlookFromZ: outlookFromZ, forecastSkill: forecastSkill,
    coverageEdge: coverageEdge, spreadPick: spreadPick, SPREAD_NEAR: SPREAD_NEAR, allocate: allocate, premiumOf: premiumOf, lateUnknown: lateUnknown
  };
  root.AgPrfOptimize = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
