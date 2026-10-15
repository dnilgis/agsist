/* grain-emc.js: equilibrium moisture content (EMC) of grain from air
 * temperature and relative humidity. Pure math, no page code, so node tests
 * and the page run the same lines. Loaded by /grain-emc (grain-emc-ui.js).
 *
 * WHAT EACH GRAIN USES, AND WHERE IT WAS CHECKED (2026-10-15)
 *  Corn: Modified Chung-Pfost, the shelled corn constants in ASABE D245.6
 *    (Oct 2007), from Chen and Morey (1989):
 *      RH = exp( -A / (T + C) * exp(-B * M) )
 *      A = 374.34, B = 0.18662, C = 31.696
 *    The same three numbers are read off the D245.6 table and in USDA-ARS,
 *    "Development of equilibrium moisture relationships for storage moisture
 *    monitoring of corn", which names them "ASAE Standard D245.6 for shelled
 *    corn, derived from Chen and Morey (1989b)".
 *  Wheat: Modified Henderson, the ASAE D245.5 wheat constants:
 *      1 - RH = exp( -K * (T + C) * M^N )
 *      K = 2.3007e-5, N = 2.2857, C = 55.815
 *    These reproduce University of Minnesota Extension's wheat table at 60 F
 *    (7.9, 11.0, 13.7 and 16.9% at 20, 40, 60 and 80% RH) to within 0.05
 *    point, which is how I know the constants and the form are right.
 *  RH is a decimal, T is deg C, M is moisture in percent DRY basis. Readers
 *  see WET basis: wb = 100 * M / (100 + M).
 *  Soybeans are left off on purpose: I could not read the D245.6 soybean
 *  constants at a source, and a guessed constant is worse than none.
 *
 * FAN HEAT: air warmed by the fan keeps its water, so its vapor pressure is
 *  unchanged and RH2 = RH1 * es(T1) / es(T2), with saturation vapor pressure
 *  from the Magnus form (Alduchov and Eskridge 1996, J. Appl. Meteor. 35:601):
 *      es(T) = 6.1094 * exp(17.625 * T / (T + 243.04))  hPa, T in deg C
 *
 * LIMITS (my rule, printed on the page): numbers only for air 20 to 100 F and
 *  20 to 90% RH. Past the humidity ends the answer is a bound ("over 19.8%"),
 *  never a made-up point; past the temperature ends, nothing.
 */
(function (root) {
  'use strict';

  var GRAINS = {
    corn: {
      key: 'corn', name: 'Corn', model: 'chung-pfost',
      A: 374.34, B: 0.18662, C: 31.696, target: 15.5,
      source: 'ASABE D245.6 (2007), shelled corn, Modified Chung-Pfost'
    },
    wheat: {
      key: 'wheat', name: 'Wheat', model: 'henderson',
      K: 2.3007e-5, N: 2.2857, C: 55.815, target: 13.5,
      source: 'ASAE D245.5, wheat, Modified Henderson'
    }
  };

  var LIMITS = { tMinF: 20, tMaxF: 100, rhMin: 20, rhMax: 90 };
  /* An hour counts as drying only when the air's EMC is at least this far
   * under the target. Published tables for the same corn air differ by up to
   * about a point (Minnesota 16.0 and Kentucky 16.2 against this equation's
   * 15.3 at 40 F and 70%), so a smaller gap is called a close call. */
  var MARGIN = 1.0;
  /* Cooling: run fans when outdoor air is 10 to 15 F cooler than the grain
   * (NDSU Extension). I use the low end. */
  var COOL_GAP_F = 10;

  function fToC(f) { return (f - 32) * 5 / 9; }
  function cToF(c) { return c * 9 / 5 + 32; }
  function dbToWb(m) { return 100 * m / (100 + m); }
  function wbToDb(w) { return 100 * w / (100 - w); }
  function num(x) { return typeof x === 'number' && isFinite(x); }

  /* EMC, percent dry basis, for a grain at tC (deg C) and rh (0..1). */
  function emcDb(g, tC, rh) {
    if (g.model === 'chung-pfost') {
      return -Math.log(-Math.log(rh) * (tC + g.C) / g.A) / g.B;
    }
    if (g.model === 'henderson') {
      return Math.pow(-Math.log(1 - rh) / (g.K * (tC + g.C)), 1 / g.N);
    }
    throw new Error('unknown model ' + g.model);
  }

  /* RH (0..1) at which a grain's EMC is mDb (percent dry basis). */
  function rhAtDb(g, tC, mDb) {
    if (g.model === 'chung-pfost') {
      return Math.exp(-g.A / (tC + g.C) * Math.exp(-g.B * mDb));
    }
    return 1 - Math.exp(-g.K * (tC + g.C) * Math.pow(mDb, g.N));
  }

  function grain(k) {
    var g = GRAINS[k];
    if (!g) throw new Error('unknown grain ' + k);
    return g;
  }

  /* EMC in wet basis for air at tF (F) and rhPct (0..100).
   * {ok:true, wb, bound:null|'under'|'over'} or {ok:false, reason}. */
  function emc(k, tF, rhPct) {
    var g = grain(k);
    if (!num(tF) || !num(rhPct)) return { ok: false, reason: 'no reading' };
    if (rhPct < 0 || rhPct > 100) return { ok: false, reason: 'humidity must be 0 to 100%' };
    if (tF < LIMITS.tMinF) return { ok: false, reason: 'air under ' + LIMITS.tMinF + ' F, past what the equation was checked for' };
    if (tF > LIMITS.tMaxF) return { ok: false, reason: 'air over ' + LIMITS.tMaxF + ' F, past what the equation was checked for' };
    var bound = null, rh = rhPct;
    if (rhPct > LIMITS.rhMax) { bound = 'over'; rh = LIMITS.rhMax; }
    else if (rhPct < LIMITS.rhMin) { bound = 'under'; rh = LIMITS.rhMin; }
    var wb = dbToWb(emcDb(g, fToC(tF), rh / 100));
    return { ok: true, wb: wb, bound: bound };
  }

  /* Highest RH (percent) at tF where air still brings grain down to targetWb.
   * null when tF is out of range or the answer falls outside 20..90%. */
  function rhFor(k, tF, targetWb) {
    var g = grain(k);
    if (!num(tF) || !num(targetWb) || tF < LIMITS.tMinF || tF > LIMITS.tMaxF) return null;
    if (targetWb <= 0 || targetWb >= 40) return null;
    var r = rhAtDb(g, fToC(tF), wbToDb(targetWb)) * 100;
    if (!num(r)) return null;
    return { rh: r, inRange: r >= LIMITS.rhMin && r <= LIMITS.rhMax };
  }

  /* Saturation vapor pressure, hPa, Magnus form (Alduchov and Eskridge 1996). */
  function satVp(tC) { return 6.1094 * Math.exp(17.625 * tC / (tC + 243.04)); }

  /* Air at tF, rhPct warmed by addF with no water added: new {tF, rh}. */
  function warm(tF, rhPct, addF) {
    var a = num(addF) && addF > 0 ? addF : 0;
    if (!a) return { tF: tF, rh: rhPct };
    var t2 = tF + a;
    return { tF: t2, rh: rhPct * satVp(fToC(tF)) / satVp(fToC(t2)) };
  }

  /* 'dry' | 'close' | 'wet' | null (no answer). */
  function verdict(r, target) {
    if (!r || !r.ok || !num(target)) return null;
    if (r.bound === 'over') return r.wb > target ? 'wet' : null;
    if (r.bound === 'under') return r.wb <= target - MARGIN ? 'dry' : null;
    if (r.wb <= target - MARGIN) return 'dry';
    if (r.wb <= target) return 'close';
    return 'wet';
  }

  /* One reading through the fan: what the grain sees. */
  function assess(k, tF, rhPct, target, addF) {
    var air = warm(tF, rhPct, addF);
    var r = emc(k, air.tF, air.rh);
    return { tF: tF, rh: rhPct, fanTF: air.tF, fanRh: air.rh, emc: r, verdict: verdict(r, target) };
  }

  /* hours: [{t:'2026-10-15T21:00', tF, rh}] -> each with its assessment.
   * grainF (optional): a cooling hour is one with outside air at least
   * COOL_GAP_F under the grain that does not wet it. */
  function hourly(k, hours, target, addF, grainF) {
    return (hours || []).map(function (h) {
      var a = assess(k, h.tF, h.rh, target, addF);
      a.t = h.t;
      a.cool = num(grainF) && num(h.tF) && h.tF <= grainF - COOL_GAP_F && a.verdict !== 'wet' && a.verdict !== null;
      return a;
    });
  }

  function count(rows, v) {
    var n = 0;
    for (var i = 0; i < rows.length; i++) if (rows[i].verdict === v) n++;
    return n;
  }

  /* Longest run of back-to-back 'dry' hours (first one wins a tie), at least
   * minLen long. {start, end, len, worst} with worst = the highest EMC in it. */
  function bestWindow(rows, minLen) {
    var min = minLen || 2, best = null, i = 0;
    while (i < rows.length) {
      if (rows[i].verdict !== 'dry') { i++; continue; }
      var j = i, worst = -1;
      while (j < rows.length && rows[j].verdict === 'dry') {
        if (rows[j].emc.wb > worst) worst = rows[j].emc.wb;
        j++;
      }
      var len = j - i;
      if (len >= min && (!best || len > best.len)) best = { start: i, end: j - 1, len: len, worst: worst };
      i = j;
    }
    return best;
  }

  /* Fan hours to push one cooling front through the bin: 15 / (cfm per bu),
   * the rule of thumb Cornell Cooperative Extension gives. */
  function coolingHours(cfmPerBu) {
    if (!num(cfmPerBu) || cfmPerBu <= 0 || cfmPerBu > 5) return null;
    return 15 / cfmPerBu;
  }

  var api = {
    GRAINS: GRAINS, LIMITS: LIMITS, MARGIN: MARGIN, COOL_GAP_F: COOL_GAP_F,
    fToC: fToC, cToF: cToF, dbToWb: dbToWb, wbToDb: wbToDb,
    emcDb: emcDb, rhAtDb: rhAtDb, emc: emc, rhFor: rhFor,
    satVp: satVp, warm: warm, verdict: verdict, assess: assess,
    hourly: hourly, count: count, bestWindow: bestWindow, coolingHours: coolingHours
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgEMC = api;
})(typeof self !== 'undefined' ? self : this);
