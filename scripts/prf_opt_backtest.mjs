#!/usr/bin/env node
/* scripts/prf_opt_backtest.mjs: the walk-forward test of components/prf-optimize.js
   across a broad sample of PRF grids, written to data/prf/opt.json for the
   "What the numbers would pick" panel on /prf.

   WHAT IT TESTS
     For each sampled grid (one county that offers it, that county's interval
     limits), at 90% and 70% coverage, and for both scores ('net' and 'dry'):
     each year Y from 1981 to the last complete year, pick the split using only
     what was known on Dec 1 of Y-1: the years before Y, less Oct-Nov and
     Nov-Dec of Y-1, which end after the sales closing (and, for the ENSO variant, the Aug-Oct reading of
     Y-1), and score it on Y at 2027 rates and the producer's share. Compare
     with an even spread, the page's default (Apr-May and Jun-Jul, half each)
     and a "two driest months" rule.

   MORE CLIMATE PREDICTORS
     At the 'net' score, each predictor in O.PREDICTORS that the data can
     support is tried as a tilt on the same rate-led pick, year by year, with
     the same no-look-ahead rule. data/prf/climate-indices.json (written by
     scripts/fetch_climate_indices.py) feeds the PDO and AMO ones; without it
     they are skipped and listed as not tested yet. Each is tested year by
     year (the average gain across grids, sign-flip, 20,000 flips), and the
     odds are adjusted (Holm) over the whole promised family, O.FAMILY,
     counting comparisons not yet run as p = 1. A predictor is "kept", and may
     move the panel's pick, only if its adjusted odds are under 0.05 with a
     positive gain at both 90% and 70%.

   THE SAMPLE
     Every grid whose ID is a multiple of STEP (default 9), so the sample is
     fixed, spread across every state, and the same on every run. --step 1
     runs all 13,414 grids (about 20 minutes).

   WHAT IT WRITES
     data/prf/opt.json, a few KB: the sample, and for each coverage and score
     the out-of-sample record against each comparison, by year, by region and
     by the season the pick leans to. Every figure is per $100 of protection.

   node scripts/prf_opt_backtest.mjs [--step 9] [--out data/prf/opt.json] [--quiet] */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const M = require(ROOT + "components/prf-math.js");
const O = require(ROOT + "components/prf-optimize.js");

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const STEP = +arg("--step", 9), OUT = arg("--out", ROOT + "data/prf/opt.json"), QUIET = process.argv.includes("--quiet");
const COVS = [90, 70], OBJS = ["net", "dry"];
const CLIMATE_FILE = arg("--climate", ROOT + "data/prf/climate-indices.json");
const DRAWS = 20000;   /* sign flips for the predictor tests: enough to resolve odds well under 0.05/16 */

/* the climate indices, when the climate-indices workflow has written them; a
   predictor that needs a missing series is skipped and the file says why */
let climate = existsSync(CLIMATE_FILE) ? JSON.parse(readFileSync(CLIMATE_FILE, "utf8")) : null;
/* the seasonal forecast models, when the seasonal-models workflow has written
   them (scripts/fetch_seasonal_models.py); without the file every model is
   listed as not tested yet and still counted in the family */
const SEASONAL_FILE = arg("--seasonal", ROOT + "data/prf/seasonal-fc.json");
const seasonal = existsSync(SEASONAL_FILE) ? JSON.parse(readFileSync(SEASONAL_FILE, "utf8")) : null;
if (seasonal) climate = { ...(climate || { series: {} }), seasonal };
const PRED_IDS = O.PREDICTORS.filter((p) => !p.untestable && !p.structural).map((p) => p.id);
let RUN_IDS = [];

const REGION = {
  "Northern Plains": ["ND", "SD", "NE", "KS"],
  "Southern Plains": ["TX", "OK"],
  "Mountain": ["MT", "WY", "CO", "NM", "ID", "UT", "NV", "AZ"],
  "Pacific": ["WA", "OR", "CA"],
  "Midwest": ["MN", "IA", "MO", "IL", "IN", "OH", "MI", "WI"],
  "South": ["AR", "LA", "MS", "AL", "GA", "FL", "TN", "KY", "SC", "NC", "VA", "WV"],
  "Northeast": ["PA", "NY", "NJ", "DE", "MD", "CT", "RI", "MA", "VT", "NH", "ME"]
};
const regionOf = {};
for (const [r, sts] of Object.entries(REGION)) for (const s of sts) regionOf[s] = r;
const SEASON = (i) => (i === 0 || i === 10 ? "winter" : i <= 3 ? "spring" : i <= 7 ? "summer" : "fall");

const meta = JSON.parse(readFileSync(ROOT + "data/prf/meta.json", "utf8"));
const byFips = {};
for (const s of meta.states) byFips[s.fips] = s.st;
const states = {};
for (const s of meta.states) states[s.st] = JSON.parse(readFileSync(ROOT + `data/prf/s/${s.st}.json`, "utf8"));

/* the sample: grid IDs that are multiples of STEP, each with the first county (in the grid's own list) that offers it */
const sample = [];
for (const f of readdirSync(ROOT + "data/prf/g").sort()) {
  const sh = JSON.parse(readFileSync(ROOT + "data/prf/g/" + f, "utf8"));
  for (const id of Object.keys(sh.g).sort((a, b) => a - b)) {
    if (+id % STEP) continue;
    const rec = sh.g[id];
    let pickCo = null;
    for (const code of rec.c || []) {
      const st = byFips[code.slice(0, 2)], co = st && states[st].counties[code.slice(2)];
      if (co && co.g.includes(+id)) { pickCo = { st, code, co }; break; }
    }
    if (!pickCo) continue;
    const o = M.openGrid(rec, sh.y0, sh.y1, null);
    sample.push({ id: +id, st: pickCo.st, county: pickCo.code, lim: pickCo.co.lim, o });
  }
}
sample.sort((a, b) => a.id - b.id);
const stCount = {};
sample.forEach((g) => { stCount[g.st] = (stCount[g.st] || 0) + 1; });
if (!QUIET) console.error(`sample: ${sample.length} grids in ${Object.keys(stCount).length} states (every grid ID divisible by ${STEP})`);

const inputFor = (g, cov) => ({ index: g.o.index, rates: g.o.rates[cov], coverage: cov, subsidy: meta.subsidy[String(cov)], grid: g.id,
  min: g.lim.map((p) => (p ? p[0] : null)), max: g.lim.map((p) => (p ? p[1] : null)), avgMm: g.o.avgMm, lastComplete: meta.years.last_complete });

/* the skill tables, one per forecast id and policy year, each from the years
   before it only (O.forecastSkill), over every sampled grid */
const FIRST_Y = 1981, LAST_Y = meta.years.last_complete;
if (seasonal) {
  const t0 = Date.now(), obs = sample.map((g) => O.prepare(inputFor(g, 90)));
  climate.seasonalSkill = {};
  for (const p of O.PREDICTORS.filter((q) => q.family === "forecast")) {
    const tbl = {};
    for (let Y = FIRST_Y; Y <= meta.crop_year; Y++) tbl[Y] = O.forecastSkill(seasonal, p.id, Y, obs);
    climate.seasonalSkill[p.id] = tbl;
  }
  if (!QUIET) console.error(`skill tables: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
RUN_IDS = PRED_IDS.filter((id) => !O.predictorUnavailable(id, climate));

const r4 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 10000) / 100); /* per $1 -> per $100, 2 places */
const round4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);

/* each predictor against the plain rate-led pick, the same grids and years */
function predictorStats(grids, years, byYear) {
  const out = {};
  const ids = grids.length && grids[0].rows[0].tilt ? Object.keys(grids[0].rows[0].tilt) : [];
  for (const id of ids) {
    let gy = 0, sum = 0, sumT = 0, better = 0, worse = 0, moved = 0, known = 0;
    const perGrid = [], reg = {};
    for (const g of grids) {
      let d = 0;
      for (const r of g.rows) {
        const x = r.tilt[id] - r.opt;
        gy++; sum += x; sumT += r.tilt[id]; d += x;
        if (x > 1e-9) better++; else if (x < -1e-9) worse++;
        if (r.tiltPick[id].join() !== r.pick.join()) moved++;
        if (r.tiltState[id] != null) known++;
      }
      d /= g.rows.length;
      perGrid.push(d);
      const o = (reg[g.region] = reg[g.region] || { grids: 0, better: 0, worse: 0, diff: 0, byYear: {} });
      o.grids++; o.diff += d; if (d > 1e-12) o.better++; else if (d < -1e-12) o.worse++;
      for (const r of g.rows) { const b = (o.byYear[r.year] = o.byYear[r.year] || [0, 0]); b[0] += r.tilt[id] - r.opt; b[1]++; }
    }
    const yd = years.map((y) => (byYear[y].tilt[id] - byYear[y].opt) / byYear[y].n);
    const byRegion = {};
    for (const [k, o] of Object.entries(reg)) {
      const ry = Object.keys(o.byYear).sort().map((y) => o.byYear[y][0] / o.byYear[y][1]);
      byRegion[k] = { grids: o.grids, betterPct: pct(o.better, o.grids), worsePct: pct(o.worse, o.grids), meanDiff: r4(o.diff / o.grids),
                      yearsBetter: ry.filter((x) => x > 1e-12).length, p: Math.round(O.flipTest(ry, DRAWS) * 10000) / 10000 };
    }
    out[id] = {
      mean: r4(sumT / gy), meanDiff: r4(sum / gy), meanDiffPer100Raw: (100 * sum) / gy,
      gridYearsBetterPct: pct(better, gy), gridYearsWorsePct: pct(worse, gy), pickMovedPct: pct(moved, gy), readingKnownPct: pct(known, gy),
      gridsBetterPct: pct(perGrid.filter((d) => d > 1e-12).length, perGrid.length), gridsWorsePct: pct(perGrid.filter((d) => d < -1e-12).length, perGrid.length),
      yearsBetter: yd.filter((x) => x > 1e-12).length, yearsWorse: yd.filter((x) => x < -1e-12).length,
      p: O.flipTest(yd, DRAWS), byRegion
    };
  }
  return out;
}

function run(cov, obj) {
  const grids = [];
  const byYear = {};
  const t0 = Date.now();
  for (const g of sample) {
    const G = O.prepare(inputFor(g, cov));
    if (G.years.length < 30 || G.allowed.filter(Boolean).length < 2) continue;
    const wf = O.walkForward(G, { objective: obj, predictors: obj === "net" ? RUN_IDS : [], climate });
    if (!wf.rows.length || !wf.even) continue;
    const s = O.summarizeBacktest(wf);
    const full = O.pick(G, { objective: obj });
    const all = G.years.map(() => true);
    const top = full.split.indexOf(Math.max(...full.split));
    /* in-sample: the full-record pick scored on the same record, against an even spread */
    const inS = O.record(G, full.split).mean - O.record(G, wf.even).mean;
    const fullH = O.pick(G, { objective: obj, estimator: "history" });
    const inSHist = O.record(G, fullH.split).mean - O.record(G, wf.even).mean;
    const dryMask = O.scoreYears(G, all, "dry").mask;
    const inSdry = O.record(G, full.split, dryMask).mean - O.record(G, wf.even, dryMask).mean;
    const cmp = obj === "dry" ? s.dryVsEven : s.vsEven;
    grids.push({ id: g.id, st: g.st, region: regionOf[g.st], season: SEASON(top), s, inS: obj === "dry" ? inSdry : inS, inSHist, cmp,
                 verdict: O.verdict(cmp).key, rows: wf.rows });
    for (const r of wf.rows) {
      const b = (byYear[r.year] = byYear[r.year] || { n: 0, opt: 0, enso: 0, even: 0, def: 0, nDef: 0, dry2: 0, nDry2: 0, dry: 0 });
      b.n++; b.opt += r.opt; b.enso += r.optEnso; b.even += r.even;
      if (r.def != null) { b.def += r.def; b.nDef++; }
      if (r.dry2 != null) { b.dry2 += r.dry2; b.nDry2++; }
      if (r.dry) b.dry++;
      if (r.tilt) {
        b.tilt = b.tilt || {};
        for (const id of Object.keys(r.tilt)) b.tilt[id] = (b.tilt[id] || 0) + r.tilt[id];
      }
    }
  }
  /* grid-years */
  let sHist = 0, histW = 0;
  let gy = 0, wins = 0, losses = 0, sOpt = 0, sEven = 0, sEnso = 0, ensoW = 0, ensoL = 0, sDef = 0, nDef = 0, defW = 0, sDry2 = 0, nDry2 = 0, dry2W = 0;
  let dgy = 0, dW = 0, dOpt = 0, dEven = 0, dDef = 0, dnDef = 0, dDry2 = 0, dnDry2 = 0;
  const optDef = [], optDry2 = [];
  for (const g of grids) for (const r of g.rows) {
    gy++; sOpt += r.opt; sEven += r.even; sEnso += r.optEnso; sHist += r.hist; if (r.hist > r.even + 1e-9) histW++;
    if (r.opt > r.even + 1e-9) wins++; else if (r.opt < r.even - 1e-9) losses++;
    if (r.optEnso > r.opt + 1e-9) ensoW++; else if (r.optEnso < r.opt - 1e-9) ensoL++;
    if (r.def != null) { sDef += r.def; nDef++; optDef.push(r.opt); if (r.opt > r.def + 1e-9) defW++; }
    if (r.dry2 != null) { sDry2 += r.dry2; nDry2++; optDry2.push(r.opt); if (r.opt > r.dry2 + 1e-9) dry2W++; }
    if (r.dry) {
      dgy++; dOpt += r.opt; dEven += r.even; if (r.opt > r.even + 1e-9) dW++;
      if (r.def != null) { dDef += r.def; dnDef++; }
      if (r.dry2 != null) { dDry2 += r.dry2; dnDry2++; }
    }
  }
  const meanOf = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  const yearRows = years.map((y) => { const b = byYear[y]; return { y, opt: r4(b.opt / b.n), even: r4(b.even / b.n), enso: r4(b.enso / b.n), dryShare: pct(b.dry, b.n) }; });
  const yearsAhead = years.filter((y) => byYear[y].opt > byYear[y].even).length;
  /* years are the closer thing to independent draws: test the average edge across grids, year by year */
  const yearP = O.flipTest(years.map((y) => (byYear[y].opt - byYear[y].even) / byYear[y].n));
  const ensoYearP = O.flipTest(years.map((y) => (byYear[y].enso - byYear[y].opt) / byYear[y].n));
  const ensoYearsAhead = years.filter((y) => byYear[y].enso > byYear[y].opt + 1e-12).length;
  const ensoYearsBehind = years.filter((y) => byYear[y].enso < byYear[y].opt - 1e-12).length;
  const group = (key) => {
    const out = {};
    for (const g of grids) {
      const k = g[key], o = (out[k] = out[k] || { grids: 0, ahead: 0, held: 0, behind: 0, diff: 0 });
      o.grids++; o.diff += g.cmp.meanDiff;
      if (g.cmp.meanDiff > 0) o.ahead++;
      if (g.verdict === "held") o.held++;
      if (g.verdict === "behind") o.behind++;
    }
    for (const k of Object.keys(out)) { const o = out[k]; out[k] = { grids: o.grids, aheadPct: pct(o.ahead, o.grids), held: o.held, meanDiff: r4(o.diff / o.grids) }; }
    return out;
  };
  const n = grids.length;
  const ahead = grids.filter((g) => g.cmp.meanDiff > 0).length;
  const held = grids.filter((g) => g.verdict === "held").length;
  const res = {
    grids: n, gridYears: gy, years: { first: years[0], last: years[years.length - 1], n: years.length },
    estimator: O.estimatorFor({ objective: obj }),
    mean: { opt: r4(sOpt / gy), even: r4(sEven / gy), optEnso: r4(sEnso / gy), hist: r4(sHist / gy),
            optWhereDefault: r4(meanOf(optDef)), def: r4(sDef / (nDef || 1)), optWhereDry2: r4(meanOf(optDry2)), dry2: r4(sDry2 / (nDry2 || 1)) },
    gridYearsAheadOfEvenPct: pct(wins, gy), gridYearsBehindEvenPct: pct(losses, gy),
    gridYearsAheadOfDefaultPct: pct(defW, nDef), gridYearsAheadOfDry2Pct: pct(dry2W, nDry2),
    gridsAheadOfEvenPct: pct(ahead, n),
    histGridYearsAheadOfEvenPct: pct(histW, gy),
    histGridsAheadOfEvenPct: pct(grids.filter((g) => g.s.histVsEven.meanDiff > 0).length, n),
    histInSampleEdge: r4(meanOf(grids.map((g) => g.inSHist))),
    histOutOfSampleEdge: r4(meanOf(grids.map((g) => g.s.histVsEven.meanDiff))),
    gridsHeldUp: held, gridsHeldUpByChance: Math.round(n * 0.025),
    gridsBehind: grids.filter((g) => g.verdict === "behind").length,
    yearsAheadOfEven: yearsAhead, yearsTestP: Math.round(yearP * 1000) / 1000,
    inSampleEdge: r4(meanOf(grids.map((g) => g.inS))),
    outOfSampleEdge: r4(meanOf(grids.map((g) => g.cmp.meanDiff))),
    dryYears: { gridYears: dgy, opt: r4(dOpt / (dgy || 1)), even: r4(dEven / (dgy || 1)), def: r4(dDef / (dnDef || 1)), dry2: r4(dDry2 / (dnDry2 || 1)), aheadOfEvenPct: pct(dW, dgy) },
    enso: { gridYearsBetterPct: pct(ensoW, gy), gridYearsWorsePct: pct(ensoL, gy), meanDiff: r4((sEnso - sOpt) / gy), yearsBetter: ensoYearsAhead, yearsWorse: ensoYearsBehind, yearsTestP: Math.round(ensoYearP * 1000) / 1000 },
    picksChangedPerGrid: Math.round((10 * grids.reduce((a, g) => a + g.s.changes, 0)) / (n || 1)) / 10,
    byRegion: group("region"), bySeason: group("season"),
    byYear: yearRows
  };
  res.ensoFamilyP = O.flipTest(years.map((y) => (byYear[y].enso - byYear[y].opt) / byYear[y].n), DRAWS);
  if (obj === "net") res.predictors = predictorStats(grids, years, byYear);
  if (!QUIET) console.error(`  ${cov}% ${obj}: ${n} grids, ${gy} grid-years, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return res;
}

/* ---------------------------------------------------------------- structure */
/* Two tests that pick something other than the months, on the same grids and
   years with the same Dec 1 rule:
     cov-pick  each fall, the coverage level (70 to 90%) with the most expected
               return on the producer's premium (O.coverageEdge), its rate-led
               split, against always buying 90% and always buying 70%. Scored
               as dollars back per $100 the producer paid (the measure the pick
               chases), and per $100 of protection. A family member.
     spread    at 90% and at 70%, the steadier split (O.spreadPick: within 5% of
               the best expected score, fewest earlier years with no payment)
               against the rate-led pick: years with no payment at all, the
               average, and the year-to-year swing. A risk feature, not a
               return edge, so it is tested in a family of its own (two). */
function runStructure() {
  const COV_ALL = meta.coverage;
  const yr = {}, t0 = Date.now();
  let grids = 0;
  const covCount = {};
  const spreadGrid = { 90: [], 70: [] };
  for (const g of sample) {
    const Gs = {};
    for (const c of COV_ALL) Gs[c] = O.prepare(inputFor(g, c));
    const G90 = Gs[90];
    if (G90.years.length < 30 || COV_ALL.some((c) => Gs[c].allowed.filter(Boolean).length < 2)) continue;
    grids++;
    const kOf = {};
    for (const c of COV_ALL) { kOf[c] = {}; Gs[c].years.forEach((y, k) => { kOf[c][y] = k; }); }
    const sg = { 90: { plainNets: [], spreadNets: [] }, 70: { plainNets: [], spreadNets: [] } };
    for (let t = 0; t < G90.years.length; t++) {
      const Y = G90.years[t];
      if (Y < FIRST_Y || t < 30 || COV_ALL.some((c) => kOf[c][Y] == null)) continue;
      const picks = {}, ratio = {}, net = {};
      let ok = true;
      for (const c of COV_ALL) {
        const G = Gs[c], use = G.years.map((y) => y < Y), k = kOf[c][Y];
        const a = O.pick(G, { use, asOf: Y });
        if (!a) { ok = false; break; }
        picks[c] = a;
        net[c] = O.netIn(G, a.split, k);
        ratio[c] = net[c] / O.premiumOf(G, a.split);
      }
      if (!ok) continue;
      const best = O.coverageEdge(Gs, G90.years.map((y) => y < Y), Y);
      const b = (yr[Y] = yr[Y] || { n: 0, r90: 0, r70: 0, p90: 0, p70: 0, pick: 0, rPick: 0, pickNet: 0, net90: 0, net70: 0, s: { 90: { n: 0, zp: 0, zs: 0, np: 0, ns: 0 }, 70: { n: 0, zp: 0, zs: 0, np: 0, ns: 0 } } });
      b.n++;
      b.rPick += ratio[best.coverage]; b.r90 += ratio[90]; b.r70 += ratio[70];
      b.pickNet += net[best.coverage]; b.net90 += net[90]; b.net70 += net[70];
      covCount[best.coverage] = (covCount[best.coverage] || 0) + 1;
      for (const c of [90, 70]) {
        const G = Gs[c], use = G.years.map((y) => y < Y), k = kOf[c][Y];
        const sp = O.spreadPick(G, { use, asOf: Y });
        if (!sp) continue;
        const paid = (split) => split.some((p, i) => p && G.P[k][i] > 0);
        const ns = O.netIn(G, sp.split, k), np = net[c];
        const o = b.s[c];
        o.n++; o.np += np; o.ns += ns;
        if (!paid(picks[c].split)) o.zp++;
        if (!paid(sp.split)) o.zs++;
        sg[c].plainNets.push(np); sg[c].spreadNets.push(ns);
      }
    }
    for (const c of [90, 70]) if (sg[c].plainNets.length > 2) spreadGrid[c].push(sg[c]);
  }
  const years = Object.keys(yr).map(Number).sort((a, b) => a - b);
  const sum = (f) => years.reduce((a, y) => a + f(yr[y]), 0);
  const gy = sum((b) => b.n);
  const covPick = {};
  for (const base of [90, 70]) {
    const key = "r" + base, nk = "net" + base;
    const yd = years.map((y) => (yr[y].rPick - yr[y][key]) / yr[y].n);
    covPick[base] = {
      years: years.length, gridYears: gy,
      perPaid: { pick: r4(sum((b) => b.rPick) / gy), base: r4(sum((b) => b[key]) / gy), meanDiff: r4(sum((b) => b.rPick - b[key]) / gy) },
      perProtection: { pick: r4(sum((b) => b.pickNet) / gy), base: r4(sum((b) => b[nk]) / gy), meanDiff: r4(sum((b) => b.pickNet - b[nk]) / gy) },
      yearsBetter: yd.filter((x) => x > 1e-12).length, yearsWorse: yd.filter((x) => x < -1e-12).length,
      p: O.flipTest(yd, DRAWS)
    };
  }
  const chosen = {};
  for (const c of COV_ALL) chosen[c] = pct(covCount[c] || 0, gy);
  const spread = {};
  for (const c of [90, 70]) {
    const n = sum((b) => b.s[c].n);
    const zd = years.map((y) => (yr[y].s[c].zs - yr[y].s[c].zp) / (yr[y].s[c].n || 1));
    const nd = years.map((y) => (yr[y].s[c].ns - yr[y].s[c].np) / (yr[y].s[c].n || 1));
    const sd = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
    const sdP = spreadGrid[c].map((q) => sd(q.plainNets)), sdS = spreadGrid[c].map((q) => sd(q.spreadNets));
    const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
    spread[c] = {
      gridYears: n, years: years.length,
      noPaymentPct: { plain: pct(sum((b) => b.s[c].zp), n), steadier: pct(sum((b) => b.s[c].zs), n) },
      mean: { plain: r4(sum((b) => b.s[c].np) / n), steadier: r4(sum((b) => b.s[c].ns) / n), meanDiff: r4(sum((b) => b.s[c].ns - b.s[c].np) / n), p: round4(O.flipTest(nd, DRAWS)) },
      swing: { plain: r4(avg(sdP)), steadier: r4(avg(sdS)), what: "average across grids of the standard deviation of a grid's yearly net, per $100 of protection" },
      yearsFewerMisses: zd.filter((x) => x < -1e-12).length, yearsMoreMisses: zd.filter((x) => x > 1e-12).length,
      p: O.flipTest(zd, DRAWS)
    };
  }
  if (!QUIET) console.error(`  structure: ${grids} grids, ${gy} grid-years, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { grids, covPick, chosenPct: chosen, spread };
}

const out = {
  v: 2, crop_year: meta.crop_year, built_from: meta.built, last_complete: meta.years.last_complete,
  what: "Walk-forward test of the PRF interval optimizer (components/prf-optimize.js). Each year from 1981 the split is picked from what a buyer had at the Dec 1 sales closing the fall before (earlier years, less that fall's Oct-Nov and Nov-Dec, which were not final yet) and scored on that year at 2027 rates and the producer's share of premium. Figures are dollars per $100 of protection per year.",
  caveats: [
    "Every year is scored at 2027 rates; RMA set them with the whole record in view. Past rates are not in the data.",
    "USDA's index is percent of a 1951-2025 normal, so early years are measured against a normal that includes later ones. This applies equally to every strategy.",
    "NOAA's own seasonal outlook maps are not tested: no archive of past outlooks is in the data. The forecast models behind them are tested where their archive is in.",
    ...(seasonal ? ["Forecast models are scored on re-forecasts (hindcasts) for the years before each model was running: the model was built later, with those years in view, so its skill there can look better than it was in real time."] : []),
    "Grids next to each other share weather, so grid-years are not independent; the year counts are the closer measure."
  ],
  sample: { step: STEP, grids: sample.length, states: Object.keys(stCount).length, rule: `every grid ID divisible by ${STEP}, first county listed that offers it, its interval limits` },
  oni: O.ONI_SOURCE, ensoBoost: 1,
  results: {}
};
for (const cov of COVS) for (const obj of OBJS) out.results[`${cov}_${obj}`] = run(cov, obj);
const structure = runStructure();

/* ---------------------------------------------------------------- the family, adjusted */
/* Every comparison promised in O.FAMILY counts, run or not (a missing one is
   p = 1), so adding a predictor later cannot flatter one tested now. */
const fam = {};
for (const cov of O.FAMILY_COVERAGES) {
  const r = out.results[`${cov}_net`];
  fam[`enso@${cov}`] = r.ensoFamilyP;
  for (const [id, st] of Object.entries(r.predictors || {})) fam[`${id}@${cov}`] = st.p;
  fam[`cov-pick@${cov}`] = structure.covPick[cov].p;
}
const adj = O.holm(fam, O.FAMILY);
const money = (x) => (x < 0 ? "-$" : "+$") + Math.abs(x).toFixed(2);
const oddsWords = (p) => (p < 0.001 ? "under 1 in 1,000" : p >= 0.5 ? "better than even" : "about 1 in " + Math.max(1, Math.round(1 / p)));
const predictors = {};
const describe = (id, name, stats) => {
  /* stats: { cov: { meanDiff, yearsBetter, years, p, adj } } */
  const c90 = stats[90], c70 = stats[70];
  const kept = O.FAMILY_COVERAGES.every((c) => stats[c] && stats[c].adj < 0.05 && stats[c].meanDiff > 0);
  const tail = ` (${money(c90.meanDiff)} per $100 of protection a year at 90% coverage, ${money(c70.meanDiff)} at 70%; better in ${c90.yearsBetter} of ${c90.years} years at 90%)`;
  let line;
  if (kept) line = `${name}: held up after counting all ${O.FAMILY.length} tests${tail}. Odds luck alone does this, after the count: ${oddsWords(Math.max(c90.adj, c70.adj))}.`;
  else if (O.FAMILY_COVERAGES.some((c) => stats[c].adj < 0.05 && stats[c].meanDiff > 0)) {
    const ok = O.FAMILY_COVERAGES.filter((c) => stats[c].adj < 0.05 && stats[c].meanDiff > 0), no = O.FAMILY_COVERAGES.filter((c) => !ok.includes(c));
    line = `${name}: held up at ${ok.join("% and ")}% coverage after counting all ${O.FAMILY.length} tests, but not at ${no.join("% and ")}%, so it does not move the pick${tail}.`;
  } else if (c90.meanDiff <= 0 && c70.meanDiff <= 0) line = `${name}: no edge; it did worse than the plain pick${tail}.`;
  else line = `${name}: no edge after adjustment${tail}. Once all ${O.FAMILY.length} tests are counted, luck could produce that.`;
  return { name, kept, line, tested: true, byCoverage: stats };
};
{
  const st = {};
  for (const cov of O.FAMILY_COVERAGES) {
    const r = out.results[`${cov}_net`];
    st[cov] = { meanDiff: r.enso.meanDiff, yearsBetter: r.enso.yearsBetter, years: r.years.n, p: round4(fam[`enso@${cov}`]), adj: round4(adj[`enso@${cov}`]) };
  }
  predictors.enso = describe("enso", "El Niño or La Niña in the fall before (already in the panel when the outlook file or the reader sets it)", st);
}
for (const p of O.PREDICTORS) {
  if (p.structural) {
    const st = {};
    for (const cov of O.FAMILY_COVERAGES) {
      const c = structure.covPick[cov];
      st[cov] = { meanDiff: c.perPaid.meanDiff, perPaid: c.perPaid, perProtection: c.perProtection, yearsBetter: c.yearsBetter, yearsWorse: c.yearsWorse,
                  years: c.years, p: round4(c.p), adj: round4(adj[`${p.id}@${cov}`]) };
    }
    const kept = O.FAMILY_COVERAGES.every((c) => st[c].adj < 0.05 && st[c].meanDiff > 0);
    const ch = structure.chosenPct;
    const tail = `${money(st[90].perPaid.meanDiff)} back per $100 you pay against always buying 90%, ${money(st[70].perPaid.meanDiff)} against always buying 70%; `
      + `per $100 of protection ${money(st[90].perProtection.meanDiff)} and ${money(st[70].perProtection.meanDiff)}. It chose 70% in ${ch[70]}% of grid-years, 75% in ${ch[75]}%, 80% in ${ch[80]}%, 85% in ${ch[85]}% and 90% in ${ch[90]}%`;
    const verdictWords = kept ? `held up after counting all ${O.FAMILY.length} tests` : (st[90].meanDiff <= 0 && st[70].meanDiff <= 0) ? "no edge; it did worse"
      : O.FAMILY_COVERAGES.some((c) => st[c].adj < 0.05 && st[c].meanDiff > 0) ? `held up against ${O.FAMILY_COVERAGES.filter((c) => st[c].adj < 0.05 && st[c].meanDiff > 0).join("% and ")}% only, so it is not counted as a find`
      : `no edge after counting all ${O.FAMILY.length} tests`;
    predictors[p.id] = { name: p.name, kept, tested: true, structural: true, byCoverage: st, line: `${p.name}: ${verdictWords} (${tail}).` };
    continue;
  }
  if (p.untestable) { predictors[p.id] = { name: p.name, kept: false, tested: false, line: `${p.name}: not tested. ${p.untestable}` }; continue; }
  const why = O.predictorUnavailable(p.id, climate);
  if (why) {
    predictors[p.id] = { name: p.name, kept: false, tested: false, why,
      line: p.family === "forecast" ? `${p.name}: not tested yet. Its past forecasts are not in the data yet; the seasonal models job (scripts/fetch_seasonal_models.py) fetches them.`
          : p.stub ? `${p.name}: not tested yet. NOAA's archive of past forecasts is not in the data; the access path is written up in scripts/fetch_climate_indices.py.`
                   : `${p.name}: not tested yet. It waits on NOAA's ${(p.needs || []).map((n) => n.toUpperCase()).join(" and ")} series, which the climate indices workflow fetches.` };
    continue;
  }
  const st = {};
  for (const cov of O.FAMILY_COVERAGES) {
    const r = out.results[`${cov}_net`], s = r.predictors[p.id];
    st[cov] = { meanDiff: s.meanDiff, mean: s.mean, base: r.mean.opt, yearsBetter: s.yearsBetter, yearsWorse: s.yearsWorse, years: r.years.n,
                gridsBetterPct: s.gridsBetterPct, gridsWorsePct: s.gridsWorsePct, gridYearsBetterPct: s.gridYearsBetterPct, gridYearsWorsePct: s.gridYearsWorsePct,
                pickMovedPct: s.pickMovedPct, readingKnownPct: s.readingKnownPct, p: round4(s.p), adj: round4(adj[`${p.id}@${cov}`]), byRegion: s.byRegion };
  }
  predictors[p.id] = describe(p.id, p.name, st);
}
for (const cov of O.FAMILY_COVERAGES) {
  const r = out.results[`${cov}_net`];
  for (const s of Object.values(r.predictors || {})) delete s.byRegion;   /* kept once, under predictors */
}
out.predictors = predictors;
/* the steadier spread: its own family of two (90 and 70), Holm */
{
  const sp = structure.spread, a2 = O.holm({ 90: sp[90].p, 70: sp[70].p }, ["90", "70"]);
  for (const c of [90, 70]) { sp[c].p = round4(sp[c].p); sp[c].adj = round4(a2[c]); }
  const fewer = [90, 70].every((c) => sp[c].adj < 0.05 && sp[c].noPaymentPct.steadier < sp[c].noPaymentPct.plain);
  const s9 = sp[90], s7 = sp[70];
  out.risk = {
    name: "A steadier split: intervals that do not dry out together, at about the same expected dollars",
    rule: `of every split the rules allow, those within ${Math.round(O.SPREAD_NEAR * 100)}% of the best expected score; the one whose intervals together missed paying in the fewest earlier years`,
    held: fewer, byCoverage: sp,
    line: `A steadier split (intervals that do not dry out together, at about the same expected dollars): `
      + `years with no payment at all went from ${s9.noPaymentPct.plain}% to ${s9.noPaymentPct.steadier}% at 90% coverage and from ${s7.noPaymentPct.plain}% to ${s7.noPaymentPct.steadier}% at 70%, `
      + `with the average ${money(s9.mean.meanDiff)} and ${money(s7.mean.meanDiff)} per $100 of protection a year against the plain pick. `
      + (fewer ? "Fewer empty years held up after counting both tests. It is a way to steady the check, not to earn more." : "The drop in empty years did not hold up once luck is allowed for, so it is not counted as a find.")
  };
  out.productivity = "Productivity factor (60 to 150%) scales protection, premium and payments alike; the rate and USDA's share do not change with it. It changes how many dollars ride on the policy, not the return per dollar you pay, so there is nothing for a test to pick.";
  out.stationDensity = "Not tested: how many rain gauges sit near a grid is not in the data here, and NOAA's gauge counts could not be reached from where this was built.";
  out.structure = { grids: structure.grids, chosenPct: structure.chosenPct };
}
/* the current skill table for any forecast that held up, so the panel can use it */
{
  const keptFc = Object.entries(predictors).filter(([id, p]) => p.kept && (O.predictorById(id) || {}).family === "forecast").map(([id]) => id);
  if (keptFc.length) out.seasonalSkill = Object.fromEntries(keptFc.map((id) => [id, { [meta.crop_year]: climate.seasonalSkill[id][meta.crop_year] }]));
}
out.family = { size: O.FAMILY.length, run: Object.keys(fam).length, members: O.FAMILY, adjustment: "Holm step-down over the whole family; comparisons not yet run count as p = 1",
               expectedByChanceAt5pct: Math.round(O.FAMILY.length * 0.05 * 10) / 10, test: `year-by-year sign-flip test of the average gain across grids, ${DRAWS} flips, fixed seed`,
               rule: "a predictor may move the panel's pick only if its adjusted odds are under 0.05 and its gain is positive at both 90% and 70% coverage" };
out.climate = climate && climate.series ? Object.fromEntries(Object.entries(climate.series).map(([k, v]) => [k, { url: v.url, as_of: v.as_of }])) : null;
out.seasonal = seasonal ? Object.fromEntries(Object.entries(seasonal.models || {}).map(([k, v]) => [k, { source: v.source, system: v.system, first: v.first, last: v.last, intervals: v.intervals }])) : null;
writeFileSync(OUT, JSON.stringify(out) + "\n");
if (!QUIET) {
  for (const [k, r] of Object.entries(out.results)) {
    const { byYear, ...rest } = r;
    console.log(k, JSON.stringify(rest, null, 1));
  }
  console.error(`wrote ${OUT} (${JSON.stringify(out).length} bytes)`);
}
