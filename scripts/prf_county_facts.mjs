/* scripts/prf_county_facts.mjs: the figures each /prf/<state>/<county> page prints.
 *
 * WHY. A county page answers "PRF in <county>": which grids, what each pair of
 * months costs there, how often each pair fell under 90% of normal since the
 * record starts, and what the last few years did. Those are counts and middles
 * over USDA's own rates and index history for the grids that touch the county,
 * worked out with the arithmetic the calculator uses (components/prf-math.js).
 *
 * It writes nothing. It prints one JSON object to stdout, keyed by the
 * county's five-digit code, and scripts/build_prf_counties.py formats it. So no
 * extra data file is published: the pages carry the figures, the calculator
 * keeps reading data/prf as before.
 *
 * Every figure is from complete years only (meta.years.first to last_complete),
 * except the "so far" row, which is the open year's published intervals and is
 * labeled that way on the page.
 *
 *   node scripts/prf_county_facts.mjs              print the JSON
 *   node scripts/prf_county_facts.mjs --selftest
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const M = require(path.join(ROOT, 'components/prf-math.js'));

/* nearest-rank quantile, the same rule as scripts/prf_facts.mjs */
export function quantile(values, p) {
  const v = values.slice().sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1))];
}
/* the year as a whole, as a share of normal: the six intervals that do not
   share a month (Jan-Feb, Mar-Apr, ... Nov-Dec), each weighted by its normal.
   null when any of the six is missing. */
export const NONOVERLAP = [0, 2, 4, 6, 8, 10];
export function yearShare(row, avgMm) {
  let num = 0, den = 0;
  for (const i of NONOVERLAP) {
    if (row[i] == null || avgMm[i] == null) return null;
    num += row[i] * avgMm[i]; den += avgMm[i];
  }
  return den > 0 ? num / den : null;
}
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const span = (v) => (v.length ? { low: Math.min(...v), mid: quantile(v, 0.5), high: Math.max(...v) } : null);

/* The labeled example on each county page: the calculator's own opening
   policy (100 acres of grazing, 90% coverage, productivity factor 100, April
   to May and June to July split as evenly as the county allows; components/
   prf.js fit()) priced on every grid in the county with prf-math.js, rounded
   the way RMA's tool rounds. The page prints the middle grid by premium
   (nearest rank, so a real grid) and says which it is. null when the county
   does not offer both pairs of months for grazing, or no grid has a priced,
   complete record: the page then prints no example. */
export const EXAMPLE = { acres: 100, coverage: 90, productivity: 100, use: 0, on: [3, 5] };
export function countyExample(c, grids, G, subsidy) {
  const L = c.lim || (c.limc || {})[String(EXAMPLE.use)] || null;
  if (!L || c.b[EXAMPLE.use] == null) return null;
  const on = M.LABELS.map((_, i) => EXAMPLE.on.includes(i) && !!L[i]);
  if (on.filter(Boolean).length !== EXAMPLE.on.length) return null;
  const min = L.map((p) => (p ? p[0] : null)), max = L.map((p) => (p ? p[1] : null));
  const split = M.evenSplit(on, min, max);
  if (!split || !M.checkSplit(split, min, max, L.map(Boolean)).ok) return null;
  const rows = [];
  for (const g of grids) {
    const o = G[g];
    const bg = c.bg && c.bg[String(g)];
    const cbv = bg && bg[String(EXAMPLE.use)] != null ? bg[String(EXAMPLE.use)] : c.b[EXAMPLE.use];
    const pol = M.policy({ cbv, coverage: EXAMPLE.coverage, productivity: EXAMPLE.productivity, acres: EXAMPLE.acres, share: 100,
                           split, rates: o.rates[EXAMPLE.coverage], subsidy: subsidy[String(EXAMPLE.coverage)] });
    if (!pol.priced) continue;
    const sum = M.summarize(M.history(pol, o.index), pol);
    if (!sum.years || sum.incomplete.length) continue;
    rows.push({ g, premium: pol.total.premium, usda: pol.total.subsidy, you: pol.total.producer, paid_years: sum.paidYears, years: sum.years,
                avg: sum.avgIndemnity });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => a.you - b.you || a.g - b.g);
  const m = rows[Math.min(rows.length - 1, Math.max(0, Math.ceil(0.5 * rows.length) - 1))];
  return { split, grid: m.g, of: rows.length, premium: m.premium, usda: m.usda, you: m.you, you_acre: r2(m.you / EXAMPLE.acres),
           paid_years: m.paid_years, years: m.years, avg: r2(m.avg), avg_acre: r2(m.avg / EXAMPLE.acres) };
}

export function build(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const first = meta.years.first, last = meta.years.last_complete;
  const openYears = Object.keys(meta.years.open || {}).map(Number).filter((y) => y > last).sort();
  const cur = openYears.length ? openYears[openYears.length - 1] : null;
  /* every grid any county needs, opened once */
  const want = new Set();
  const counties = {};
  for (const s of meta.states) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, 's', s.st + '.json'), 'utf8'));
    for (const [code, c] of Object.entries(d.counties)) { counties[d.fips + code] = { st: s.st, c }; c.g.forEach((g) => want.add(g)); }
  }
  const G = {};
  const shards = new Set([...want].map((g) => M.shardKey(g)));
  for (const key of [...shards].sort()) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, 'g', key + '.json'), 'utf8'));
    if (d.cy !== meta.crop_year) throw new Error(key + ' is crop year ' + d.cy + ', meta.json is ' + meta.crop_year);
    const yf = path.join(dir, 'y', key + '.json');
    const y = fs.existsSync(yf) ? JSON.parse(fs.readFileSync(yf, 'utf8')) : { g: {} };
    for (const [id, rec] of Object.entries(d.g)) {
      if (!want.has(+id)) continue;
      const o = M.openGrid(rec, d.y0, d.y1, null), index = {};
      Object.keys(o.index).forEach((yy) => { if (+yy >= first && +yy <= last) index[yy] = o.index[yy]; });
      const openRow = cur && y.g[id] && y.g[id][String(cur)] ? y.g[id][String(cur)].map((v) => (v == null ? null : v / 1000)) : null;
      G[id] = { index, rates: o.rates, avgMm: o.avgMm, open: openRow };
    }
  }
  const recent = [];
  for (let yy = Math.max(first, last - 4); yy <= last; yy++) recent.push(yy);
  const out = { v: 1, crop_year: meta.crop_year, built_from: meta.built, years: { first, last, n: last - first + 1 }, recent, open_year: cur, counties: {} };
  for (const [fips, { c }] of Object.entries(counties).sort()) {
    const grids = c.g.slice().sort((a, b) => a - b).filter((g) => G[g]);
    const iv = M.LABELS.map(() => ({ rate: [], below: [], normal: [] }));
    const pb = [];
    const rows = [];
    for (const g of grids) {
      const o = G[g];
      for (let i = 0; i < M.N; i++) {
        if (o.avgMm[i] != null) iv[i].normal.push(o.avgMm[i] / 25.4);
        const rate = o.rates[90][i];
        if (rate == null || !(rate > 0)) continue;
        let n = 0, below = 0, sum = 0, gap = false;
        for (const yy of Object.keys(o.index)) {
          const v = o.index[yy][i];
          if (v == null) { gap = true; break; }
          n++; if (v < 0.9 - 1e-12) { below++; sum += (0.9 - v) / 0.9; }
        }
        if (gap || !n) continue;
        iv[i].rate.push(rate * 100); iv[i].below.push(below); pb.push(sum / n / rate);
      }
      /* the grid's year as a whole */
      let normalYr = 0, okN = true;
      for (const i of NONOVERLAP) { if (o.avgMm[i] == null) okN = false; else normalYr += o.avgMm[i]; }
      let dry = null, under = 0, nYr = 0;
      for (const yy of Object.keys(o.index)) {
        const s = yearShare(o.index[yy], o.avgMm);
        if (s == null) continue;
        nYr++; if (s < 0.9 - 1e-12) under++;
        if (!dry || s < dry.share - 1e-12) dry = { year: +yy, share: s };
      }
      const lastShare = o.index[last] ? yearShare(o.index[last], o.avgMm) : null;
      rows.push({ g, normal_in: okN ? r2(normalYr / 25.4) : null, dry_year: dry ? dry.year : null, dry_pct: dry ? Math.round(dry.share * 100) : null,
                  last_pct: lastShare == null ? null : Math.round(lastShare * 100), years_under_90: nYr ? under : null, years: nYr });
    }
    /* the last few complete years and the open one: per interval, the middle grid's index and how many grids came in under 90% */
    const yearRow = (getRow) => M.LABELS.map((_, i) => {
      const v = grids.map((g) => getRow(G[g])).filter((r) => r && r[i] != null).map((r) => r[i]);
      return v.length ? { mid: Math.round(quantile(v, 0.5) * 100), under: v.filter((x) => x < 0.9 - 1e-12).length, n: v.length } : null;
    });
    const hist = recent.map((yy) => ({ year: yy, iv: yearRow((o) => o.index[yy]) }));
    if (cur) hist.push({ year: cur, open: true, iv: yearRow((o) => o.open) });
    out.counties[fips] = {
      grids,
      payback_mid_90: pb.length ? r2(quantile(pb, 0.5)) : null, payback_n_90: pb.length,
      intervals: iv.map((a, i) => ({
        rate: a.rate.length ? { low: r2(Math.min(...a.rate)), mid: r2(quantile(a.rate, 0.5)), high: r2(Math.max(...a.rate)) } : null,
        below: span(a.below), normal_in: a.normal.length ? r2(quantile(a.normal, 0.5)) : null, n: a.rate.length,
      })),
      grid_rows: rows,
      recent: hist,
      example: countyExample(c, grids, G, meta.subsidy),
    };
  }
  return out;
}

const arg = process.argv[2];
if (arg === '--selftest') {
  let bad = 0; const ok = (c, w) => { if (!c) { bad++; console.error('FAIL', w); } };
  ok(quantile([5, 1, 3], 0.5) === 3, 'middle of three');
  ok(quantile([1, 2, 3, 4], 0.5) === 2, 'nearest rank, even count');
  /* equal normals: the year is the plain mean of the six non-overlapping intervals */
  const row = [0.5, 9, 1.0, 9, 1.5, 9, 1.0, 9, 0.5, 9, 1.5], mm = new Array(11).fill(10);
  ok(Math.abs(yearShare(row, mm) - 1.0) < 1e-12, 'year share, equal normals');
  /* weights: Jan-Feb 30 mm at 0.5 and the rest 10 mm at 1.0 -> (15 + 50) / 80 */
  const mm2 = mm.slice(); mm2[0] = 30;
  ok(Math.abs(yearShare([0.5, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1], mm2) - 65 / 80) < 1e-12, 'year share, weighted');
  ok(yearShare([null, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1], mm) === null, 'a missing interval gives no year');
  ok(r3(0.12345) === 0.123, 'rounding');
  console.log(bad ? 'selftest: ' + bad + ' failed' : 'selftest: all passed'); process.exit(bad ? 1 : 0);
}
if (import.meta.url === 'file://' + process.argv[1]) {
  process.stdout.write(JSON.stringify(build(path.join(ROOT, 'data/prf'))));
}
