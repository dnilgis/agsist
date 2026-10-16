/* grain-emc.js: equilibrium moisture content (EMC) of grain from air
 * temperature and relative humidity, and the fan calls built on it. Pure
 * math, no page code, so node tests and the page run the same lines. Loaded
 * by /grain-emc (grain-emc-ui.js) and by scripts/build_grain_emc.mjs, which
 * bakes the static EMC charts into the page.
 *
 * EQUATIONS (checked 2026-10-15; see the page's method note)
 *  fits[0] is the main (low) fit: a "dries" call needs it a full point under
 *  target. Every fit must be under target too, and wet calls use the wettest.
 *  Corn, main: Modified Chung-Pfost, the shelled corn constants credited to
 *    ASABE D245.6 (2007), from Chen and Morey (1989):
 *      RH = exp( -A / (T + C) * exp(-B * M) )    A 374.34, B 0.18662, C 31.696
 *  Corn, second: the classic Henderson corn fit, which reproduces the
 *    University of Kentucky corn table within 0.3 point at 40-70% RH and
 *    0.6 point at 30-90% RH, 35 to 90 F:
 *      1 - RH = exp( -K * (T + C) * M^N )        K 8.6541e-5, N 1.8634, C 49.81
 *    It reads wetter than Chung-Pfost. Any "wets" or "over target" call for
 *    corn uses the WETTER of the two; a "dries" call needs Chung-Pfost a full
 *    point under target AND Henderson under target.
 *  Wheat: Modified Henderson, ASAE D245.5 wheat constants:
 *      K 2.3007e-5, N 2.2857, C 55.815
 *    Reproduces University of Minnesota Extension's wheat table at 60 F
 *    (Managing stored grain with aeration, Table 4: 12.3, 13.7, 15.2, 16.9%
 *    at 50, 60, 70, 80% RH) within 0.05 point.
 *  Soybeans (checked 2026-10-16), shown as a range like corn:
 *    Low: Modified Henderson soybean constants long carried in ASAE D245:
 *      1 - RH = exp( -K * (T + C) * M^N )        K 30.5327e-5, N 1.2164, C 134.136
 *    They reproduce University of Minnesota Extension's soybean row at 60 F
 *    (Managing stored grain with aeration, Table 4: 8.6, 10.5, 12.8, 15.7% at
 *    50, 60, 70, 80% RH) within 0.05 point, and two numbers from NDSU's Ken
 *    Hellevang: 10.2% at 70 F and 60% (2015 slide hosted by Cornell) and
 *    about 13.5% at 42 F and 70% (Jan 2020 release). It does NOT match NDSU's
 *    own 2011 soybean table (32-80 F, 50-90% RH; checked 2026-10-16): 22 of
 *    its 30 cells fall outside the two-fit range, up to 0.5 point over the
 *    high fit at 50-60% RH and at or under the low fit at 80-90%. The 1.0
 *    point dry margin still keeps every "dries" call under target by that
 *    table (test/grain-emc-soybeans.test.mjs).
 *    High: Modified Halsey, the form University of Kentucky labels "ASAE Data
 *    D245.5 / modified-Halsey equation" on its soybean table:
 *      RH = exp( -exp(A + B * T) / M^C )         A 2.87, B -0.0054, C 1.38
 *    Those three constants reproduce every printed soybean cell, rounded to
 *    0.1, of Kentucky Table 2 (70 cells, 10-90% RH, 35-90 F) and Arkansas
 *    FSA1074 Table B (196 cells, 25-90% RH, 35-100 F): 266 of 266. The
 *    standard itself could not be read; the constants are the ones those
 *    tables were printed from, recovered and checked cell by cell.
 *    Halsey reads wetter from 25 F up (up to 1.1 points at 40-70% RH, 2 to
 *    8 points at 80-90%; at 20 to 25 F the two meet within 0.06 point), so
 *    it carries the wet calls and Henderson is the main (low) fit.
 *  RH decimal, T deg C, M percent DRY basis; readers see WET basis,
 *  wb = 100 M / (100 + M).
 *
 * FAN HEAT: RH2 = RH1 * es(T1) / es(T2); es(T) = 6.1094 exp(17.625 T / (T + 243.04))
 *  hPa (Alduchov and Eskridge 1996).
 *
 * LIMITS (my rule): numbers for air 20 to 100 F and 20 to 90% RH. Over 90%
 *  the shown number is the 90% value as a floor ("over"); the wet call may
 *  still use the equation at the real humidity, since EMC only rises with RH.
 *  Every call is made on numbers rounded to 0.1, the same ones the reader sees.
 */
(function (root) {
  'use strict';

  var GRAINS = {
    corn: {
      key: 'corn', name: 'Corn', target: 15.5,
      fits: [
        { model: 'chung-pfost', A: 374.34, B: 0.18662, C: 31.696 },
        { model: 'henderson', K: 8.6541e-5, N: 1.8634, C: 49.81 }
      ]
    },
    wheat: {
      key: 'wheat', name: 'Wheat', target: 13.5,
      fits: [{ model: 'henderson', K: 2.3007e-5, N: 2.2857, C: 55.815 }]
    },
    soybeans: {
      key: 'soybeans', name: 'Soybeans', target: 13,
      fits: [
        { model: 'henderson', K: 30.5327e-5, N: 1.2164, C: 134.136 },
        { model: 'halsey', A: 2.87, B: -0.0054, C: 1.38 }
      ]
    }
  };
  var LIMITS = { tMinF: 20, tMaxF: 100, rhMin: 20, rhMax: 90, targetMin: 10, targetMax: 20, fanMax: 15 };
  var MARGIN = 1.0;      // "dries to target" needs the main fit this far under target
  var COOL_GAP_F = 10;   // UMN aeration: 24-h average 10 F or more under the grain cools it (Iowa State: 10-20 F)
  var COLD_AVG_F = 40;   // NDSU: natural air does little until air averages about 40 F
  var HUMID_AVG = 75;    // UMN natural-air drying: works best at 55-75% RH

  function num(x) { return typeof x === 'number' && isFinite(x); }
  function fToC(f) { return (f - 32) * 5 / 9; }
  function dbToWb(m) { return 100 * m / (100 + m); }
  function wbToDb(w) { return 100 * w / (100 - w); }
  function r1(x) { return Math.round(x * 10) / 10; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function grain(k) { if (!has(GRAINS, k)) throw new Error('unknown grain ' + k); return GRAINS[k]; }

  function fitDb(f, tC, rh) {
    if (f.model === 'chung-pfost') return -Math.log(-Math.log(rh) * (tC + f.C) / f.A) / f.B;
    if (f.model === 'halsey') return Math.pow(Math.exp(f.A + f.B * tC) / -Math.log(rh), 1 / f.C);
    return Math.pow(-Math.log(1 - rh) / (f.K * (tC + f.C)), 1 / f.N);
  }
  function fitRh(f, tC, mDb) {
    if (f.model === 'chung-pfost') return Math.exp(-f.A / (tC + f.C) * Math.exp(-f.B * mDb));
    if (f.model === 'halsey') return Math.exp(-Math.exp(f.A + f.B * tC) / Math.pow(mDb, f.C));
    return 1 - Math.exp(-f.K * (tC + f.C) * Math.pow(mDb, f.N));
  }
  /* Wet-basis EMC from every fit of a grain at tF, rh (0..1, exclusive). */
  function fitsWb(g, tF, rh) {
    var tC = fToC(tF);
    return g.fits.map(function (f) { return dbToWb(fitDb(f, tC, rh)); });
  }

  /* EMC for air at tF and rhPct.
   * {ok:true, wb (main fit), wet (wettest fit), bound:null|'over'|'under', rhPct}
   * or {ok:false, reason}. */
  function emc(k, tF, rhPct) {
    var g = grain(k);
    if (!num(tF) || !num(rhPct)) return { ok: false, reason: 'no reading' };
    if (rhPct < 0 || rhPct > 100) return { ok: false, reason: 'humidity must be 0 to 100%' };
    if (tF < LIMITS.tMinF) return { ok: false, reason: 'air under ' + LIMITS.tMinF + ' F, colder than the equations were checked for' };
    if (tF > LIMITS.tMaxF) return { ok: false, reason: 'air over ' + LIMITS.tMaxF + ' F, warmer than the equations were checked for' };
    var bound = null, rh = rhPct;
    if (rhPct > LIMITS.rhMax) { bound = 'over'; rh = LIMITS.rhMax; }
    else if (rhPct < LIMITS.rhMin) { bound = 'under'; rh = LIMITS.rhMin; }
    var v = fitsWb(g, tF, rh / 100);
    return { ok: true, wb: v[0], wet: Math.max.apply(null, v), bound: bound, tF: tF, rhPct: rhPct };
  }

  /* Wettest-fit EMC at the real humidity, used only to decide "wets" past the
   * 90% end. Infinity at saturation. */
  function wetAtReal(k, e) {
    if (e.rhPct >= 100) return Infinity;
    var v = fitsWb(grain(k), e.tF, e.rhPct / 100);
    return Math.max.apply(null, v);
  }

  /* Highest outside RH (percent) at tF whose air holds grain at or under mWb
   * on every fit (the conservative line). {rh, inRange} or null. */
  function rhFor(k, tF, mWb, fit) {
    var g = grain(k);
    if (!num(tF) || !num(mWb) || tF < LIMITS.tMinF || tF > LIMITS.tMaxF || mWb <= 0 || mWb >= 40) return null;
    var tC = fToC(tF), fits = fit == null ? g.fits : [g.fits[fit]];
    var r = Math.min.apply(null, fits.map(function (f) { return fitRh(f, tC, wbToDb(mWb)); })) * 100;
    if (!num(r)) return null;
    return { rh: r, inRange: r >= LIMITS.rhMin && r <= LIMITS.rhMax };
  }
  /* Highest RH that earns a "dries to target" call: main fit at target - margin
   * and every fit under target. */
  function rhDries(k, tF, target) {
    var a = rhFor(k, tF, target - MARGIN, 0), b = rhFor(k, tF, target);
    if (!a || !b) return null;
    var r = Math.min(a.rh, b.rh);
    return { rh: r, inRange: r >= LIMITS.rhMin && r <= LIMITS.rhMax };
  }

  function satVp(tC) { return 6.1094 * Math.exp(17.625 * tC / (tC + 243.04)); }
  /* Air warmed addF with no water added. null when either reading is missing. */
  function warm(tF, rhPct, addF) {
    if (!num(tF) || !num(rhPct)) return null;
    var a = num(addF) && addF > 0 ? addF : 0;
    if (!a) return { tF: tF, rh: rhPct };
    var t2 = tF + a;
    return { tF: t2, rh: rhPct * satVp(fToC(tF)) / satVp(fToC(t2)) };
  }
  /* Outside RH that becomes rhFan after the fan adds addF. */
  function unwarmRh(tF, rhFan, addF) {
    var a = num(addF) && addF > 0 ? addF : 0;
    return rhFan * satVp(fToC(tF + a)) / satVp(fToC(tF));
  }

  /* Open-Meteo / WMO weather code -> 'fog' | 'rain' | 'snow' | null. */
  function wxKind(code) {
    if (!num(code)) return null;
    if (code === 45 || code === 48) return 'fog';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
    return null;
  }

  /* HOLDING dry grain at target T: 'dry' | 'close' | 'wet' | null. */
  function holdCall(k, e, T) {
    if (!e || !e.ok || !num(T)) return null;
    if (e.bound === 'over') {
      if (r1(e.wet) > T || wetAtReal(k, e) > T) return 'wet';
      return null;
    }
    var w = r1(e.wet), m = r1(e.wb);
    if (w > T) return 'wet';
    if (e.bound === 'under') return m <= T - MARGIN ? 'dry' : null;
    return m <= T - MARGIN ? 'dry' : 'close';
  }

  /* DRYING grain now at M toward target T:
   * 'dry' (dries to target) | 'part' (dries, not to target) | 'wet' | null. */
  function dryCall(k, e, M, T, wx) {
    if (wx === 'rain' || wx === 'fog' || wx === 'snow') return 'wet';
    if (!e || !e.ok || !num(T) || !num(M)) return null;
    var w = r1(e.wet), m = r1(e.wb);
    if (e.bound === 'over') return (w >= M || wetAtReal(k, e) >= M) ? 'wet' : 'part';
    if (w >= M) return 'wet';
    if (m <= T - MARGIN && w <= T) return 'dry';
    return 'part';
  }

  /* COOLING grain at grainF: by temperature only. 'cool' (10 F or more under
   * the grain) | 'mild' (under, by less) | 'warm' (not under) | 'skip' (rain
   * or fog on grain that is already dry) | null. */
  function coolCall(fanTF, grainF, wx, grainDry) {
    if (!num(fanTF) || !num(grainF)) return null;
    if (grainDry && (wx === 'rain' || wx === 'fog')) return 'skip';
    if (fanTF <= grainF - COOL_GAP_F) return 'cool';
    if (fanTF < grainF) return 'mild';
    return 'warm';
  }

  /* One reading through the fan. o: {mode, grain, target, current, fan, grainF, grainDry, wx} */
  function assess(o, tF, rhPct) {
    var air = warm(tF, rhPct, o.fan);
    var out = { tF: tF, rh: rhPct, fanTF: air ? air.tF : null, fanRh: air ? air.rh : null, wx: o.wx || null };
    out.emc = air ? emc(o.grain, air.tF, air.rh) : { ok: false, reason: 'no reading' };
    if (o.mode === 'cool') out.call = coolCall(out.fanTF, o.grainF, out.wx, o.grainDry);
    else if (o.mode === 'dry') out.call = air || out.wx ? dryCall(o.grain, out.emc, o.current, o.target, out.wx) : null;
    else out.call = holdCall(o.grain, out.emc, o.target);
    return out;
  }

  /* hours: [{t (ms), tF, rh, code}] -> rows with .call, .missing. */
  function hourly(o, hours) {
    return (hours || []).map(function (h) {
      var a = assess({ mode: o.mode, grain: o.grain, target: o.target, current: o.current, fan: o.fan, grainF: o.grainF, grainDry: o.grainDry, wx: wxKind(h.code) }, h.tF, h.rh);
      a.t = h.t;
      a.missing = !num(h.tF) || !num(h.rh);
      return a;
    });
  }

  function count(rows, call) { var n = 0; for (var i = 0; i < rows.length; i++) if (rows[i].call === call) n++; return n; }

  /* Back-to-back runs of the same call: [{call, start, end, len}]. */
  function runs(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i].call, last = out[out.length - 1];
      if (last && last.call === c) { last.end = i; last.len++; } else out.push({ call: c, start: i, end: i, len: 1 });
    }
    return out;
  }

  /* Longest run of `call` (first wins a tie), at least minLen. {start,end,len,worst} */
  function bestWindow(rows, call, minLen) {
    var best = null;
    runs(rows).forEach(function (r) {
      if (r.call !== call || r.len < (minLen || 2)) return;
      if (!best || r.len > best.len) {
        var worst = null;
        for (var i = r.start; i <= r.end; i++) {
          var x = rows[i].emc && rows[i].emc.ok ? rows[i].emc.wet : null;
          if (x != null && (worst == null || x > worst)) worst = x;
        }
        best = { start: r.start, end: r.end, len: r.len, worst: worst };
      }
    });
    return best;
  }

  /* Average of a field over rows that have it; {avg, n}. */
  function avg(rows, field, from, to) {
    var s = 0, n = 0;
    for (var i = from || 0; i < (to == null ? rows.length : to); i++) {
      var v = rows[i] && rows[i][field];
      if (num(v)) { s += v; n++; }
    }
    return n ? { avg: s / n, n: n } : null;
  }

  /* Drying-mode warnings from the forecast: cold (24 h mean under 40 F) and
   * humid (whole-forecast mean RH over 75%). */
  function dryWarnings(rows) {
    var w = [];
    var cold = avg(rows, 'tF', 0, 24);
    if (cold && cold.n >= 12 && cold.avg < COLD_AVG_F) w.push({ kind: 'cold', avg: cold.avg });
    var hum = avg(rows, 'rh');
    if (hum && hum.n >= 24 && hum.avg > HUMID_AVG) w.push({ kind: 'humid', avg: hum.avg });
    return w;
  }

  /* Fan hours for one cooling front: 15 / (cfm per bu). */
  function coolingHours(cfm) {
    if (!num(cfm) || cfm <= 0 || cfm > 5) return null;
    return 15 / cfm;
  }

  var api = {
    GRAINS: GRAINS, LIMITS: LIMITS, MARGIN: MARGIN, COOL_GAP_F: COOL_GAP_F, COLD_AVG_F: COLD_AVG_F, HUMID_AVG: HUMID_AVG,
    num: num, r1: r1, has: has, fToC: fToC, dbToWb: dbToWb, wbToDb: wbToDb, fitDb: fitDb, fitRh: fitRh,
    emc: emc, rhFor: rhFor, rhDries: rhDries, satVp: satVp, warm: warm, unwarmRh: unwarmRh, wxKind: wxKind,
    holdCall: holdCall, dryCall: dryCall, coolCall: coolCall, assess: assess, hourly: hourly,
    count: count, runs: runs, bestWindow: bestWindow, avg: avg, dryWarnings: dryWarnings, coolingHours: coolingHours
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgEMC = api;
})(typeof self !== 'undefined' ? self : this);
