#!/usr/bin/env node
/* scripts/prf_opt_backtest.mjs: the walk-forward test of components/prf-optimize.js
   across a broad sample of PRF grids, written to data/prf/opt.json for the
   "What the numbers would pick" panel on /prf.

   WHAT IT TESTS
     For each sampled grid (one county that offers it, that county's interval
     limits), at 90% and 70% coverage, and for both scores ('net' and 'dry'):
     each year Y from 1981 to the last complete year, pick the split using only
     the years before Y (and, for the ENSO variant, the Aug-Oct reading of
     Y-1), and score it on Y at 2027 rates and the producer's share. Compare
     with an even spread, the page's default (Apr-May and Jun-Jul, half each)
     and a "two driest months" rule.

   THE SAMPLE
     Every grid whose ID is a multiple of STEP (default 9), so the sample is
     fixed, spread across every state, and the same on every run. --step 1
     runs all 13,414 grids (about 20 minutes).

   WHAT IT WRITES
     data/prf/opt.json, a few KB: the sample, and for each coverage and score
     the out-of-sample record against each comparison, by year, by region and
     by the season the pick leans to. Every figure is per $100 of protection.

   node scripts/prf_opt_backtest.mjs [--step 9] [--out data/prf/opt.json] [--quiet] */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const M = require(ROOT + "components/prf-math.js");
const O = require(ROOT + "components/prf-optimize.js");

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const STEP = +arg("--step", 9), OUT = arg("--out", ROOT + "data/prf/opt.json"), QUIET = process.argv.includes("--quiet");
const COVS = [90, 70], OBJS = ["net", "dry"];

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

const r4 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 10000) / 100); /* per $1 -> per $100, 2 places */
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);

function run(cov, obj) {
  const grids = [];
  const byYear = {};
  const t0 = Date.now();
  for (const g of sample) {
    const input = { index: g.o.index, rates: g.o.rates[cov], coverage: cov, subsidy: meta.subsidy[String(cov)],
                    min: g.lim.map((p) => (p ? p[0] : null)), max: g.lim.map((p) => (p ? p[1] : null)),
                    avgMm: g.o.avgMm, lastComplete: meta.years.last_complete };
    const G = O.prepare(input);
    if (G.years.length < 30 || G.allowed.filter(Boolean).length < 2) continue;
    const wf = O.walkForward(G, { objective: obj });
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
  if (!QUIET) console.error(`  ${cov}% ${obj}: ${n} grids, ${gy} grid-years, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return res;
}

const out = {
  v: 1, crop_year: meta.crop_year, built_from: meta.built, last_complete: meta.years.last_complete,
  what: "Walk-forward test of the PRF interval optimizer (components/prf-optimize.js). Each year from 1981 the split is picked from earlier years only and scored on that year at 2027 rates and the producer's share of premium. Figures are dollars per $100 of protection per year.",
  caveats: [
    "Every year is scored at 2027 rates; RMA set them with the whole record in view. Past rates are not in the data.",
    "USDA's index is percent of a 1951-2025 normal, so early years are measured against a normal that includes later ones. This applies equally to every strategy.",
    "NOAA seasonal outlooks are not tested: no archive of past outlooks is in the data.",
    "Grids next to each other share weather, so grid-years are not independent; the year counts are the closer measure."
  ],
  sample: { step: STEP, grids: sample.length, states: Object.keys(stCount).length, rule: `every grid ID divisible by ${STEP}, first county listed that offers it, its interval limits` },
  oni: O.ONI_SOURCE, ensoBoost: 1,
  results: {}
};
for (const cov of COVS) for (const obj of OBJS) out.results[`${cov}_${obj}`] = run(cov, obj);
writeFileSync(OUT, JSON.stringify(out) + "\n");
if (!QUIET) {
  for (const [k, r] of Object.entries(out.results)) {
    const { byYear, ...rest } = r;
    console.log(k, JSON.stringify(rest, null, 1));
  }
  console.error(`wrote ${OUT} (${JSON.stringify(out).length} bytes)`);
}
