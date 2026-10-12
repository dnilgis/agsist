/* check_prf_rma.mjs: the shipped PRF arithmetic and the shipped data, against
 * USDA RMA's own tool, live.
 *
 * WHY
 *   test/prf-math.test.mjs replays answers RMA gave on one day for one grid.
 *   That proves the arithmetic, not today's data: a rate table read from the
 *   wrong column would still pass it. This asks RMA's service to price a dozen
 *   policies drawn from the files this run just wrote, prices the same
 *   policies with components/prf-math.js from those files, and compares every
 *   dollar. It runs in the prf workflow after the build and before the commit.
 *
 * WHAT IT ASKS
 *   Four policies on grid 30152, found by search, that land exactly on fifty
 *   cents over an even dollar in the protection, the premium, the subsidy and
 *   the indemnity. That is the one thing the saved answers cannot settle:
 *   whether RMA rounds a half dollar up or to the even dollar. This file's
 *   arithmetic rounds up. If RMA does not, these four say so on the first run.
 *   Then --random N policies (default 8) from anywhere in the country:
 *   a county, one of its grids, a use and practice it offers, a coverage
 *   level, a split inside the county's limits, odd acres, a past year.
 *   The draw is seeded by the date, so a failure can be run again the same day.
 *
 * WHAT COUNTS
 *   RMA answering differently  -> listed, exit 1. The workflow stops and the
 *                                 site keeps the data it had.
 *   RMA not answering          -> counted as not reached. Not a pass and not a
 *                                 failure. If nothing was reached the run says
 *                                 so in data/prf/check.json and on the page.
 *
 * Writes data/prf/check.json. Needs node 20+ (global fetch).
 *   node scripts/check_prf_rma.mjs [--random 8] [--seed 20261012] [--dir data/prf]
 *
 * --replay test/fixtures/prf/rma-30152.json asks nobody: the cases are the
 * eight policies saved in that file and the answers are RMA's saved answers.
 * test/prf-check.test.mjs uses it to prove this script can tell agreement from
 * a difference (rule 28: a guard that cannot execute the thing it guards is
 * not a guard).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : dflt; };
const DIR = ROOT + arg("dir", "data/prf") + "/";
const N_RANDOM = +arg("random", 8);
const today = new Date().toISOString().slice(0, 10);
const SEED = +arg("seed", today.replace(/-/g, ""));
const REPLAY = arg("replay", "");
const TIMEOUT = +arg("timeout", 120000), TRIES = +arg("tries", 3);
const API = "https://public-rma.fpac.usda.gov/apps/PrfWebApi/PrfExternalPricingRates/GetPricingRates";
const UA = "AGSIST-automation/1.0 (+https://agsist.com/prf)";
const COMBOS = [["007", "997", "997"], ["030", "002", "997"], ["030", "002", "001"], ["030", "002", "002"],
                ["030", "003", "997"], ["030", "003", "001"], ["030", "003", "002"]];

const ctx = { window: {}, Buffer };
vm.runInNewContext(readFileSync(ROOT + "components/prf-math.js", "utf8"), ctx);
const M = ctx.window.AgPrfMath;
const read = (p) => JSON.parse(readFileSync(DIR + p, "utf8"));
const meta = read("meta.json");

/* mulberry32: small, seeded, good enough to pick test cases */
let s = SEED >>> 0;
const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

const gridCache = {};
function grid(id) {
  const key = M.shardKey(id);
  if (!gridCache[key]) {
    const g = read("g/" + key + ".json");
    let y = { g: {} };
    try { y = read("y/" + key + ".json"); } catch (e) { /* no open year for this block */ }
    gridCache[key] = { g, y };
  }
  const { g, y } = gridCache[key];
  const rec = g.g[String(id)];
  if (!rec) return null;
  const open = M.openGrid(rec, g.y0, g.y1, null);
  for (const [yr, vals] of Object.entries((y.g || {})[String(id)] || {})) open.index[yr] = vals.map((v) => (v == null ? null : v / 1000));
  return open;
}

function limitsFor(county, combo) {
  return county.lim || (county.limc || {})[String(combo)] || null;
}
function baseValue(county, combo, gridId) {
  const o = county.bg && county.bg[String(gridId)];
  return o && o[String(combo)] != null ? o[String(combo)] : county.b[combo];
}

function caseFor(stateDoc, countyCode, gridId, combo, coverage, split, acres, pf, share, year, label) {
  return { label, st: stateDoc.st, state: stateDoc.fips, county: countyCode, countyName: stateDoc.counties[countyCode].n,
           grid: gridId, combo, coverage, split, acres, pf, share, year };
}

function mine(c, stateDoc) {
  const county = stateDoc.counties[c.county], g = grid(c.grid);
  const pol = M.policy({ cbv: baseValue(county, c.combo, c.grid), coverage: c.coverage, productivity: c.pf, acres: c.acres,
                         share: c.share, split: c.split, rates: g.rates[c.coverage], subsidy: meta.subsidy[String(c.coverage)] });
  const hist = M.history(pol, { [c.year]: g.index[c.year] });
  return { pol, index: g.index[c.year], indemnity: hist.length ? hist[0].indemnity : null, cells: hist.length ? hist[0].cells : [] };
}

async function ask(c) {
  if (c.replay) return c.replay;
  const q = new URLSearchParams({
    intervalType: "BiMonthly", irrigationPracticeCode: COMBOS[c.combo][1], organicPracticeCode: COMBOS[c.combo][2],
    intendedUseCode: COMBOS[c.combo][0], stateCode: c.state, countyCode: c.county, productivityFactor: c.pf,
    insurableInterest: c.share, insuredAcres: c.acres, sampleYear: c.year,
    intervalPercentOfValues: JSON.stringify(c.split), coverageLevelPercent: c.coverage, gridId: c.grid, gridName: String(c.grid),
  });
  let last = null;
  for (let attempt = 0; attempt < TRIES; attempt++) {
    try {
      const r = await fetch(API + "?" + q, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (!j || !j.returnData || !Array.isArray(j.returnData.PricingRateRows)) throw new Error("no PricingRateRows: " + JSON.stringify(j).slice(0, 200));
      return j.returnData;
    } catch (e) { last = e; await new Promise((res) => setTimeout(res, 5000 * (attempt + 1))); }
  }
  throw last;
}

function compare(c, m, rma) {
  const diffs = [];
  const eq = (what, a, b, tol = 0) => { if (a == null || b == null ? a !== b : Math.abs(a - b) > tol) diffs.push({ what, agsist: a, rma: b }); };
  eq("county base value", baseValue(states[c.st].counties[c.county], c.combo, c.grid), rma.PricingRateSummary.CountyBaseValue, 1e-9);
  eq("protection per acre", m.pol.protectionPerAcre, rma.PricingRateSummary.ProtectionPerAcre, 1e-6);
  eq("subsidy rate", meta.subsidy[String(c.coverage)], rma.PricingRateSummary.SubsidyLevel, 1e-9);
  let used = 0;
  for (const r of rma.PricingRateRows) {
    const i = M.CODES.indexOf(r.IntervalCode), row = m.pol.rows[i];
    if (i < 0) { diffs.push({ what: "interval code RMA sent", rma: r.IntervalCode }); continue; }
    eq(`rate ${M.LABELS[i]}`, row.rate, r.PremiumRate, 1e-9);
    eq(`index ${M.LABELS[i]} ${c.year}`, m.index ? m.index[i] : null, r.PercentOfNormal, 1e-9);
    if (!c.split[i]) continue;
    used++;
    eq(`protection ${M.LABELS[i]}`, row.protection, r.PolicyProtection);
    eq(`premium ${M.LABELS[i]}`, row.premium, r.TotalPremium);
    eq(`subsidy ${M.LABELS[i]}`, row.subsidy, r.PremiumSubsidy);
    eq(`producer premium ${M.LABELS[i]}`, row.producer, r.ProducerPremium);
    const cell = m.cells.find((x) => x.i === i);
    eq(`indemnity ${M.LABELS[i]} ${c.year}`, cell ? cell.paid : null, r.Indemnity);
  }
  if (used !== c.split.filter(Boolean).length) diffs.push({ what: "intervals RMA priced", agsist: c.split.filter(Boolean).length, rma: used });
  eq("total protection", m.pol.total.protection, rma.PricingRateRowTotalSummary.PolicyProtection);
  eq("total premium", m.pol.total.premium, rma.PricingRateRowTotalSummary.TotalPremium);
  eq("total subsidy", m.pol.total.subsidy, rma.PricingRateRowTotalSummary.PremiumSubsidy);
  eq("total producer premium", m.pol.total.producer, rma.PricingRateRowTotalSummary.ProducerPremium);
  eq(`total indemnity ${c.year}`, m.indemnity, rma.PricingRateRowTotalSummary.Indemnity);
  return diffs;
}

/* ---- cases ---- */
const states = {};
const stateDoc = (abbr) => (states[abbr] = states[abbr] || read("s/" + abbr + ".json"));
const cases = [];

if (REPLAY) {
  const fx = JSON.parse(readFileSync(ROOT + REPLAY, "utf8")), doc = stateDoc("WI");
  for (const [name, c] of Object.entries(fx.cases)) {
    const combo = COMBOS.findIndex((x) => x[0] === c.use && x[1] === c.irr && x[2] === c.org);
    for (const p of c.pricing) {
      const k = caseFor(doc, fx.county, fx.grid, combo, c.coverage, c.split, p.acres, p.pf, p.interest, p.year, `replay ${name} ${p.year}`);
      k.replay = { PricingRateRows: p.rows, PricingRateSummary: p.summary, PricingRateRowTotalSummary: p.total };
      cases.push(k);
    }
  }
}

/* The half-dollar cases, found by search in the built data rather than typed in. */
if (!REPLAY) (function fixed() {
  const wi = meta.states.find((x) => x.st === "WI") ? stateDoc("WI") : null;
  const county = wi && wi.counties["005"];
  if (!county || !county.g.includes(30152)) { console.log("grid 30152 is not in this build; the half-dollar cases are skipped"); return; }
  const g = grid(30152), combo = 4, cov = 90, split = [0, 0, 0, 50, 0, 50, 0, 0, 0, 0, 0];
  if (!g || county.b[combo] == null) { console.log("no non-irrigated hay on 30152 in this build; half-dollar cases skipped"); return; }
  const cbv = county.b[combo], rates = g.rates[cov], sub = meta.subsidy["90"];
  const years = Object.keys(g.index).map(Number).filter((y) => g.index[y][3] != null && g.index[y][5] != null);
  /* exactly fifty cents over an EVEN dollar: half-up gives the odd dollar above,
     round-half-to-even gives the even dollar below, so the two rules disagree */
  const frac5 = (v) => Math.abs(v - Math.floor(v) - 0.5) < 1e-7 && Math.floor(v) % 2 === 0;
  const found = { protection: null, premium: null, subsidy: null, indemnity: null };
  for (let acres = 1; acres <= 4000 && Object.values(found).some((v) => !v); acres++) {
    const exact = cbv * 0.9 * acres * 0.5;
    if (!found.protection && frac5(exact)) found.protection = { acres, year: years[years.length - 1] };
    const prot = M.dollars(exact);
    if (!found.premium && (frac5(prot * rates[3]) || frac5(prot * rates[5]))) found.premium = { acres, year: years[years.length - 1] };
    const prem = M.dollars(prot * rates[3]);
    if (!found.subsidy && frac5(prem * sub)) found.subsidy = { acres, year: years[years.length - 1] };
    if (!found.indemnity) {
      for (const y of years) {
        const p3 = M.payment(prot, g.index[y][3], cov), p5 = M.payment(prot, g.index[y][5], cov);
        if ((p3 > 0 && frac5(p3)) || (p5 > 0 && frac5(p5))) { found.indemnity = { acres, year: y }; break; }
      }
    }
  }
  for (const [what, f] of Object.entries(found)) {
    if (!f) { console.log(`no ${what} half-dollar case found on 30152`); continue; }
    cases.push(caseFor(wi, "005", 30152, combo, cov, split, f.acres, 100, 100, f.year, `half dollar in the ${what}`));
  }
})();

if (!REPLAY) (function random() {
  let guard = 0;
  while (cases.filter((c) => c.label.startsWith("random")).length < N_RANDOM && guard++ < 400) {
    const st = pick(meta.states), doc = stateDoc(st.st);
    const code = pick(Object.keys(doc.counties)), county = doc.counties[code];
    const combos = county.b.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
    if (!combos.length) continue;
    const combo = pick(combos), gridId = pick(county.g), g = grid(gridId), lim = limitsFor(county, combo);
    if (!g || !lim) continue;
    const coverage = pick(M.COVERAGE);
    /* two to four intervals, none sharing a month, each offered and priced */
    const want = 2 + Math.floor(rnd() * 3), chosen = [];
    const order = [...Array(11).keys()].sort(() => rnd() - 0.5);
    for (const i of order) {
      if (chosen.length >= want) break;
      if (!lim[i] || g.rates[coverage][i] == null) continue;
      if (chosen.some((j) => Math.abs(j - i) === 1)) continue;
      chosen.push(i);
    }
    if (chosen.length < 2) continue;
    /* whole percents inside the limits that add to 100 */
    const split = Array(11).fill(0);
    let left = 100;
    chosen.forEach((i) => { split[i] = lim[i][0]; left -= lim[i][0]; });
    let spins = 0;
    while (left > 0 && spins++ < 2000) {
      const i = pick(chosen);
      if (split[i] < lim[i][1]) { split[i]++; left--; }
    }
    if (left !== 0 || !M.checkSplit(split, lim.map((l) => (l ? l[0] : null)), lim.map((l) => (l ? l[1] : null))).ok) continue;
    const years = Object.keys(g.index).map(Number).filter((y) => chosen.every((i) => g.index[y][i] != null));
    if (!years.length) continue;
    const acres = 1 + Math.floor(rnd() * 4000), pf = 60 + Math.floor(rnd() * 91), share = pick([100, 100, 50, 33, 75]);
    cases.push(caseFor(doc, code, gridId, combo, coverage, split, acres, pf, share, pick(years), `random ${cases.length + 1}`));
  }
})();

/* ---- run ---- */
const results = [];
for (const c of cases) {
  const doc = stateDoc(c.st), m = mine(c, doc);
  const head = `${c.label}: ${c.countyName} ${c.st}, grid ${c.grid}, ${meta.combos[c.combo]}, ${c.coverage}%, ${c.acres} ac, factor ${c.pf}, share ${c.share}, ${c.year}, split ${JSON.stringify(c.split)}`;
  let rma;
  try { rma = await ask(c); } catch (e) {
    console.log(`NOT REACHED  ${head}: ${e && e.message}`);
    results.push({ ...c, reached: false });
    continue;
  }
  const diffs = compare(c, m, rma);
  console.log(`${diffs.length ? "DIFFERS     " : "agrees      "} ${head}`);
  for (const d of diffs) console.log(`             ${d.what}: agsist ${d.agsist}, RMA ${d.rma}`);
  delete c.replay;
  results.push({ ...c, reached: true, agrees: !diffs.length, differences: diffs,
                 premium: m.pol.total.premium, indemnity: m.indemnity });
}

const reached = results.filter((r) => r.reached), bad = reached.filter((r) => !r.agrees);
const out = {
  checked: new Date().toISOString().replace(/\.\d+Z$/, "Z"), seed: SEED, crop_year: meta.crop_year,
  asked: results.length, reached: reached.length, agreed: reached.length - bad.length,
  half_dollar_cases: results.filter((r) => r.label.startsWith("half")).map((r) => ({ what: r.label, reached: r.reached, agrees: r.reached ? r.agrees : null })),
  cases: results.map((r) => ({ label: r.label, st: r.st, county: r.countyName, grid: r.grid, use: meta.combos[r.combo], coverage: r.coverage,
                               acres: r.acres, factor: r.pf, share: r.share, year: r.year, split: r.split,
                               reached: r.reached, agrees: r.reached ? r.agrees : null, differences: r.differences || [] })),
};
writeFileSync(DIR + "check.json", JSON.stringify(out));
console.log(`\nasked ${out.asked}, reached ${out.reached}, agreed ${out.agreed}, differ ${bad.length}`);
if (!results.length) { console.log("no cases could be built from the data: that is a failure of this check"); process.exit(1); }
process.exit(bad.length ? 1 : 0);
