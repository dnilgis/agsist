/* scripts/prf_facts.mjs: the country-wide figures /prf prints, from data/prf/.
 *
 * WHY. The page says a few things about PRF as a whole: what the record pays
 * back per premium dollar, how many counties cap January to February, what a
 * plain example policy costs. Each is a count or a quantile over USDA's own
 * rates and index history. They are worked out here, once, with the same
 * arithmetic the page uses (components/prf-math.js), and written to
 * data/prf/facts.json. scripts/stamp_prf.py copies them into prf.html. The
 * page script never computes a national figure.
 *
 * THE MAIN ONE: "payback". For one grid, one interval and one coverage level,
 * payback = (average payment factor over the complete years) / (premium rate).
 * It is what $1 of full premium placed there would have returned, averaged
 * over every complete year at this crop year's rate. It is unrounded and has
 * no acres in it. Every grid-interval-level USDA publishes a rate for, and
 * has a full history for, is one observation. The file gives the count, the
 * middle and the 5th and 95th percentiles, overall and by level and interval.
 * These are NOT independent observations (neighbouring grids and overlapping
 * intervals move together); the page states the spread, not a significance.
 *
 *   node scripts/prf_facts.mjs            write data/prf/facts.json
 *   node scripts/prf_facts.mjs --check    exit 1 if the file is not what this would write
 *   node scripts/prf_facts.mjs --selftest
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const M = require(path.join(ROOT, 'components/prf-math.js'));
const DIR = path.join(ROOT, 'data/prf');

/* quantile by the nearest-rank rule on a sorted copy: the value at position ceil(p * n), 1-based */
export function quantile(values, p) {
  const v = values.slice().sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1))];
}
/* the average payment factor of one interval over the complete years, or null when any year is missing */
export function meanFactor(index, i, coverage) {
  const trig = coverage / 100; let n = 0, sum = 0;
  for (const y of Object.keys(index)) {
    const v = index[y][i];
    if (v == null) return null;
    n++; if (v < trig - 1e-12) sum += (trig - v) / trig;
  }
  return n ? sum / n : null;
}
const r2 = (x) => Math.round(x * 100) / 100;

export function build(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const first = meta.years.first, last = meta.years.last_complete;
  /* ---- states and counties ---- */
  const states = [], capCount = {}, minSeen = new Set(), maxSeen = new Set(), exceptions = [];
  let counties = 0, sodCounties = 0;
  const SOD = new Set(['IA', 'MN', 'MT', 'NE', 'ND', 'SD']);
  const countyOf = {};
  for (const s of meta.states) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, 's', s.st + '.json'), 'utf8'));
    const grids = new Set();
    for (const [code, c] of Object.entries(d.counties)) {
      counties++; if (SOD.has(s.st)) sodCounties++;
      countyOf[d.fips + code] = { c, st: s.st, combos: d.combos };
      c.g.forEach((g) => grids.add(g));
      const lims = c.lim ? [c.lim] : Object.values(c.limc || {});
      lims.forEach((L) => L.forEach((p, i) => {
        if (!p) return;
        minSeen.add(p[0]);
        if (i === 0) { capCount[p[1]] = (capCount[p[1]] || 0); } else maxSeen.add(p[1]);
      }));
      const jf = (c.lim || Object.values(c.limc || {})[0] || [])[0];
      if (jf) { capCount[jf[1]] = (capCount[jf[1]] || 0) + 1; if (jf[1] !== 25) exceptions.push(c.n + ', ' + s.st); }
    }
    states.push({ st: s.st, name: s.name, counties: Object.keys(d.counties).length, grids: grids.size });
  }
  /* ---- every grid: payback, and which grids touch more than one county ---- */
  const all = [], byCov = {}, byIv = M.LABELS.map(() => []), rate90 = M.LABELS.map(() => []), paidYears90 = M.LABELS.map(() => []), normal = M.LABELS.map(() => []);
  M.COVERAGE.forEach((c) => { byCov[c] = []; });
  let grids = 0, multi = 0, example = null;
  for (const f of fs.readdirSync(path.join(dir, 'g')).filter((x) => x.endsWith('.json')).sort()) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, 'g', f), 'utf8'));
    if (d.cy !== meta.crop_year) throw new Error(f + ' is crop year ' + d.cy + ', meta.json is ' + meta.crop_year);
    for (const [id, rec] of Object.entries(d.g)) {
      grids++;
      const o = M.openGrid(rec, d.y0, d.y1, null), index = {};
      Object.keys(o.index).forEach((y) => { if (+y >= first && +y <= last) index[y] = o.index[y]; });
      if ((rec.c || []).filter((code) => countyOf[code]).length > 1) multi++;
      if (+id === 30454) example = { rec, o, index };
      for (let i = 0; i < M.N; i++) {
        if (o.avgMm && o.avgMm[i] != null) normal[i].push(o.avgMm[i] / 25.4);
        for (const cov of M.COVERAGE) {
          const rate = o.rates[cov][i]; if (rate == null || !(rate > 0)) continue;
          const mf = meanFactor(index, i, cov); if (mf == null) continue;
          const pb = mf / rate;
          all.push(pb); byCov[cov].push(pb);
          if (cov === 90) {
            byIv[i].push(pb); rate90[i].push(rate * 100);
            let below = 0; Object.keys(index).forEach((y) => { if (index[y][i] < 0.9 - 1e-12) below++; });
            paidYears90[i].push(below);
          }
        }
      }
    }
  }
  if (grids !== meta.counts.grids) throw new Error('found ' + grids + ' grids, meta.json says ' + meta.counts.grids);
  if (counties !== meta.counts.counties) throw new Error('found ' + counties + ' counties, meta.json says ' + meta.counts.counties);
  if (!example) throw new Error('the example grid 30454 is not in the data');
  /* ---- the worked example: grid 30454, Barron County, Wisconsin ---- */
  const ex = (useIdx) => {
    const c = countyOf['55005'], split = [0, 0, 0, 50, 0, 50, 0, 0, 0, 0, 0];
    const cbv = c.c.bg && c.c.bg['30454'] && c.c.bg['30454'][String(useIdx)] != null ? c.c.bg['30454'][String(useIdx)] : c.c.b[useIdx];
    const pol = M.policy({ cbv, coverage: 90, productivity: 100, acres: 100, share: 100, split, rates: example.o.rates[90], subsidy: meta.subsidy['90'] });
    const hist = M.history(pol, example.index), sum = M.summarize(hist, pol);
    return { use: c.combos[useIdx], cbv, premium: pol.total.premium, usda: pol.total.subsidy, you: pol.total.producer, per_acre: r2(pol.total.producer / 100),
             protection: pol.total.protection, years: sum.years, paid_years: sum.paidYears, ahead_years: sum.aheadYears, avg: Math.round(sum.avgIndemnity) };
  };
  const q = (v) => ({ n: v.length, p05: r2(quantile(v, 0.05)), mid: r2(quantile(v, 0.5)), p95: r2(quantile(v, 0.95)) });
  return {
    v: 1, crop_year: meta.crop_year, built_from: meta.built, years: { first, last, n: last - first + 1 },
    payback: { what: 'average payment factor over the complete years, divided by the premium rate: dollars back per $1 of full premium',
               all: q(all), by_coverage: Object.fromEntries(M.COVERAGE.map((c) => [c, q(byCov[c])])),
               by_interval_at_90: M.LABELS.map((l, i) => ({ interval: l, ...q(byIv[i]) })) },
    intervals_at_90: M.LABELS.map((l, i) => ({ interval: l, grids: rate90[i].length, mid_rate_per_100: r2(quantile(rate90[i], 0.5)),
                                              mid_years_below: quantile(paidYears90[i], 0.5), mid_normal_in: r2(quantile(normal[i], 0.5)) })),
    limits: { jan_feb_max: capCount, jan_feb_not_25: exceptions.sort(), min_pct: [...minSeen].sort((a, b) => a - b), other_max: [...maxSeen].sort((a, b) => a - b) },
    grids_in_more_than_one_county: multi, native_sod_state_counties: sodCounties,
    states: states.sort((a, b) => (a.name < b.name ? -1 : 1)),
    example: { grid: 30454, county: 'Barron County, Wisconsin', acres: 100, coverage: 90, months: 'April to May and June to July, half in each', grazing: ex(0), hay: ex(4) },
  };
}

const arg = process.argv[2];
if (arg === '--selftest') {
  let bad = 0; const ok = (c, w) => { if (!c) { bad++; console.error('FAIL', w); } };
  ok(quantile([5, 1, 3], 0.5) === 3, 'middle of three');
  ok(quantile([1, 2, 3, 4], 0.5) === 2, 'nearest rank, even count');
  ok(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95) === 10 && quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.05) === 1, 'tails');
  /* four years at 90% coverage: indexes 0.45, 0.90, 1.20, 0.81 pay (0.9-0.45)/0.9 = 0.5, nothing, nothing, 0.1: mean 0.15 */
  ok(Math.abs(meanFactor({ 1: [0.45], 2: [0.90], 3: [1.2], 4: [0.81] }, 0, 90) - 0.15) < 1e-12, 'mean factor by hand');
  ok(meanFactor({ 1: [0.45], 2: [null] }, 0, 90) === null, 'a missing year gives no figure');
  console.log(bad ? 'selftest: ' + bad + ' failed' : 'selftest: all passed'); process.exit(bad ? 1 : 0);
}
const out = JSON.stringify(build(DIR), null, 1) + '\n', file = path.join(DIR, 'facts.json');
if (arg === '--check') {
  const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (have !== out) { console.error('data/prf/facts.json is not what scripts/prf_facts.mjs writes from data/prf. Run it.'); process.exit(1); }
  console.log('data/prf/facts.json matches data/prf');
} else {
  fs.writeFileSync(file, out);
  console.log('facts.json written', out.length, 'bytes');
}
