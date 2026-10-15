#!/usr/bin/env node
/* scripts/lrp_backtest.mjs: what LRP would have paid a producer, every sales
   day RMA has published (July 1 2013 on), and which coverage choices held up,
   written to data/lrp/bt.json for /lrp.

   THE DATA
     The lrp-history branch (scripts/fetch_lrp.py --history): each sales day's
     posted offers, one copy, and the actual ending values (AEV), kept per
     reinsurance year because RMA reuses type codes. Nothing here is estimated:
     the coverage price, cost per cwt and AEV are RMA's own. An offer whose
     end date has passed but whose AEV is not published is dropped and counted.

   ONE TRIAL
     One product, one sales day, one length, one coverage band. Per $100 of
     coverage (coverage price), for the producer:
       paid  = max(0, coverage price - AEV)
       cost  = posted cost per cwt x (1 - subsidy)
       net   = (paid - cost) / coverage price x 100
     Subsidy by the policy's reinsurance year (RMA applied the RY2021 table
     retroactively to July 1 2020, so that is what producers paid):
       RY2014-2019 13% at every level; RY2020 25 / 30 / 35 / 35 / 35;
       RY2021 on 35 / 40 / 45 / 50 / 55 (95-100, 90-95, 85-90, 80-85, 70-80).
     Beginning and veteran producers get more; the page models the standard one.
     Products: feeder cattle steers weight 2 (type 810, factor 1.00), fed
     cattle (820), swine (997). Other feeder types settle on the same index
     times their factor, so per $100 they are the same test.

   COVERAGE BANDS
     The five subsidy bands. Before RY2025 RMA offered dollar coverage prices,
     so levels were odd numbers; from RY2025 twelve fixed levels. In each band
     the trial takes the highest level offered that day (the most protection
     at that band's subsidy).

   THE TESTS (one declared family, Holm)
     For each regime (RY2014 on; RY2021 on, the current subsidy and premium
     at the end) and each product:
       paid    the 95-100 band's net is above zero: did it pay on average
       band:X  band X minus the 95-100 band, same day and length (four)
       best    "the band that did best so far": on each day, the band with the
               best record among endorsements of that length that had settled
               (end date at least 14 days before, so the AEV was out), scored
               at that day's subsidy; minus the 95-100 band. No pick (fewer
               than MIN_SETTLED settled trials in a band) leaves the day out.
     36 tests. A result is "kept" only if its Holm-adjusted odds are under
     0.05, its effect is positive, and it is positive at every length with
     enough data. The rest are listed as tested and not kept.

   OVERLAP
     Trials overlap: a 52-week endorsement bought each day shares most of its
     price path with the next day's. Each test averages trials into 13-week
     purchase windows and uses a Newey-West (Bartlett) standard error with lags
     covering the longest endorsement (3 windows), and Student's t on the
     window count. The file states trials, windows, and the effective number of
     independent windows (windows x plain variance / long-run variance).

   node scripts/lrp_backtest.mjs --history DIR [--out data/lrp/bt.json] */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const PRODUCTS = [
  { id: "feeder", comm: "0801", type: "810", name: "Feeder cattle (steers, weight 2)" },
  { id: "fed", comm: "0802", type: "820", name: "Fed cattle" },
  { id: "swine", comm: "0815", type: "997", name: "Swine" },
];
export const BANDS = [
  { id: "95-100", lo: 0.95, hi: 1.000001 },
  { id: "90-95", lo: 0.90, hi: 0.95 },
  { id: "85-90", lo: 0.85, hi: 0.90 },
  { id: "80-85", lo: 0.80, hi: 0.85 },
  { id: "70-80", lo: 0.70, hi: 0.80 },
];
export const BASE = "95-100";
export const REGIMES = [{ id: "all", fromRY: 2014, name: "RY2014 on" }, { id: "current", fromRY: 2021, name: "RY2021 on" }];
export const WINDOW_DAYS = 91;
export const HAC_LAGS = 3;
export const MIN_SETTLED = 60;
export const SETTLE_LAG_DAYS = 14;
export const MIN_WINDOWS_PER_LENGTH = 4;
const EPOCH = Date.UTC(2013, 6, 1);

export function subsidy(ry, level) {
  const b = bandOf(level);
  if (!b) return null;
  if (ry <= 2019) return 0.13;
  if (ry === 2020) return { "95-100": 0.25, "90-95": 0.30, "85-90": 0.35, "80-85": 0.35, "70-80": 0.35 }[b];
  return { "95-100": 0.35, "90-95": 0.40, "85-90": 0.45, "80-85": 0.50, "70-80": 0.55 }[b];
}

export function bandOf(level) {
  const b = BANDS.find((x) => level >= x.lo - 1e-9 && level < x.hi - 1e-9);
  return b ? b.id : null;
}

export const dayNum = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) / 864e5;

/* one offer entry (from the history) -> {band: row} with the highest level in each band */
export function pickBands(rows) {
  const out = {};
  for (const r of rows) {
    const level = r[0] / 1e6, b = bandOf(level);
    if (!b) continue;
    if (!out[b] || out[b][0] < r[0]) out[b] = r;
  }
  return out;
}

/* paid and cost per $100 of coverage, before subsidy */
export function trialParts(row, aevMilli) {
  const cp = row[1] / 1000, cost = row[3] / 1000, aev = aevMilli / 1000;
  return { paid: (Math.max(0, cp - aev) / cp) * 100, cost: (cost / cp) * 100, level: row[0] / 1e6 };
}

export const netOf = (t, s) => t.paid - t.cost * (1 - s);

/* ------------------------------------------------------------ statistics */

function lnGamma(z) {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function betacf(a, b, x) {
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return h;
}

function ibeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/* two-sided p for Student's t with df degrees of freedom */
export function tTwoSided(t, df) {
  if (!isFinite(t)) return 0;
  return ibeta(df / (df + t * t), df / 2, 0.5);
}

/* mean of a series, its Newey-West (Bartlett) standard error, and the
   effective number of independent points */
export function hac(xs, lags = HAC_LAGS) {
  const n = xs.length;
  if (n < 2) return { n, mean: n ? xs[0] : null, se: null, t: null, p: null, nEff: n };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const d = xs.map((x) => x - mean);
  const g = (k) => { let s = 0; for (let i = k; i < n; i++) s += d[i] * d[i - k]; return s / n; };
  const g0 = g(0);
  let lr = g0;
  for (let k = 1; k <= Math.min(lags, n - 1); k++) lr += 2 * (1 - k / (lags + 1)) * g(k);
  lr = Math.max(lr, g0 / n);           /* a negative long-run variance is not information */
  const se = Math.sqrt(lr / n);
  const t = se > 0 ? mean / se : (mean === 0 ? 0 : Infinity);
  const nEff = g0 > 0 ? Math.min(n, (n * g0) / lr) : n;
  return { n, mean, se, t, p: tTwoSided(t, n - 1), nEff };
}

export function holm(ps) {
  const keys = Object.keys(ps), m = keys.length;
  const rows = keys.map((k) => ({ k, p: ps[k] == null ? 1 : ps[k] })).sort((a, b) => a.p - b.p || (a.k < b.k ? -1 : 1));
  const out = {};
  let run = 0;
  rows.forEach((r, i) => { run = Math.max(run, Math.min(1, (m - i) * r.p)); out[r.k] = run; });
  return out;
}

/* ------------------------------------------------------------ the history */

export function aevLookup(store) {
  /* store: {ry: {"comm/type/end": {value: [sales dates]}}} -> f(ry, comm, type, end, sed) */
  return (ry, comm, type, end, sed) => {
    const inv = store[ry] && store[ry][`${comm}/${type}/${end}`];
    if (!inv) return null;
    const vals = Object.keys(inv);
    if (vals.length === 1) return +vals[0];
    for (const v of vals) if (inv[v].includes(sed) || inv[v].includes("*")) return +v;
    return null;
  };
}

export function loadHistory(dir) {
  const offers = [];
  const od = `${dir}/offers`;
  const want = new Map(PRODUCTS.map((p) => [`${p.comm}/${p.type}`, p.id]));
  for (const ry of readdirSync(od).sort()) {
    for (const f of readdirSync(`${od}/${ry}`).sort()) {
      const day = JSON.parse(readFileSync(`${od}/${ry}/${f}`, "utf8"));
      for (const [key, e] of Object.entries(day.o)) {
        const [comm, type, , len] = key.split("/");
        const pid = want.get(`${comm}/${type}`);
        if (pid) offers.push({ pid, comm, type, ry: +day.ry, sed: day.sed, len: +len, end: e.end, rows: e.r });
      }
    }
  }
  const aev = {};
  if (existsSync(`${dir}/aev`)) {
    for (const f of readdirSync(`${dir}/aev`)) aev[f.slice(0, 4)] = JSON.parse(readFileSync(`${dir}/aev/${f}`, "utf8"));
  }
  return { offers, aev };
}

/* offers + AEVs -> trials. asOf: the last sales date in the history; an
   offer ending later than SETTLE_LAG_DAYS before it may not have its AEV out
   yet, so it counts as open, not missing. */
export function buildTrials(offers, aevStore, asOf) {
  const look = aevLookup(aevStore);
  const trials = [], missing = {}, open = {};
  for (const o of offers) {
    const bands = pickBands(o.rows);
    const a = look(String(o.ry), o.comm, o.type, o.end, o.sed);
    for (const [band, row] of Object.entries(bands)) {
      if (a == null) {
        const bucket = dayNum(o.end) > dayNum(asOf) - SETTLE_LAG_DAYS ? open : missing;
        bucket[o.pid] = (bucket[o.pid] || 0) + 1;
        continue;
      }
      const t = trialParts(row, a);
      trials.push({ pid: o.pid, ry: o.ry, sed: o.sed, d: dayNum(o.sed), endD: dayNum(o.end), len: o.len, band,
        level: t.level, paid: t.paid, cost: t.cost, net: netOf(t, subsidy(o.ry, t.level)) });
    }
  }
  return { trials, missing, open };
}

/* "the band that did best so far": for each trial day, the band whose
   settled record (end at least SETTLE_LAG_DAYS before the day) is best at that
   day's subsidy. Returns Map("pid|len|sed" -> band or null). */
export function pastBest(trials) {
  const byKey = new Map();
  for (const t of trials) {
    const k = `${t.pid}|${t.len}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(t);
  }
  const pick = new Map();
  for (const [k, ts] of byKey) {
    const byEnd = ts.slice().sort((a, b) => a.endD - b.endD);
    const days = [...new Set(ts.map((t) => t.sed))].sort();
    const sums = {};
    for (const b of BANDS) sums[b.id] = { n: 0, paid: 0, cost: 0 };
    let i = 0;
    const ryOf = new Map(ts.map((t) => [t.sed, t.ry]));
    for (const sed of days) {
      const d = dayNum(sed);
      while (i < byEnd.length && byEnd[i].endD <= d - SETTLE_LAG_DAYS) {
        const s = sums[byEnd[i].band]; s.n++; s.paid += byEnd[i].paid; s.cost += byEnd[i].cost; i++;
      }
      let best = null, bestNet = -Infinity;
      if (BANDS.every((b) => sums[b.id].n >= MIN_SETTLED)) {
        for (const b of BANDS) {
          const s = sums[b.id], sub = subsidy(ryOf.get(sed), (b.lo + Math.min(b.hi, 1)) / 2);
          const net = (s.paid - s.cost * (1 - sub)) / s.n;
          if (net > bestNet + 1e-12) { bestNet = net; best = b.id; }
        }
      }
      pick.set(`${k}|${sed}`, best);
    }
  }
  return pick;
}

const windowOf = (d) => Math.floor((d * 864e5 - EPOCH) / (WINDOW_DAYS * 864e5));

/* a list of {d, len, x} -> the HAC test on 13-week window means, plus per length */
export function testSeries(points) {
  const win = new Map(), perLen = new Map();
  for (const p of points) {
    const w = windowOf(p.d);
    if (!win.has(w)) win.set(w, []);
    win.get(w).push(p.x);
    const lk = p.len;
    if (!perLen.has(lk)) perLen.set(lk, new Map());
    const m = perLen.get(lk);
    if (!m.has(w)) m.set(w, []);
    m.get(w).push(p.x);
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const ws = [...win.keys()].sort((a, b) => a - b).map((w) => mean(win.get(w)));
  const h = hac(ws);
  const lengths = {};
  for (const [len, m] of [...perLen].sort((a, b) => a[0] - b[0])) {
    const xs = [...m.keys()].sort((a, b) => a - b).map((w) => mean(m.get(w)));
    lengths[len] = { windows: xs.length, mean: round(mean(xs), 3) };
  }
  return { trials: points.length, windows: h.n, nEff: round(h.nEff, 1), mean: round(h.mean, 3), se: round(h.se, 3),
    p: h.p == null ? null : +h.p.toPrecision(3), lengths };
}

export function round(x, k) {
  if (x == null || !isFinite(x)) return x == null ? null : x;
  const f = 10 ** k;
  return Math.round(x * f) / f;
}

export function runBacktest(trials) {
  const tests = {}, family = [];
  const best = pastBest(trials);
  const idx = new Map();
  for (const t of trials) idx.set(`${t.pid}|${t.len}|${t.sed}|${t.band}`, t);
  for (const rg of REGIMES) {
    for (const p of PRODUCTS) {
      const ts = trials.filter((t) => t.pid === p.id && t.ry >= rg.fromRY);
      const base = ts.filter((t) => t.band === BASE);
      const add = (id, what, points) => {
        const key = `${rg.id}/${p.id}/${id}`;
        family.push(key);
        tests[key] = { regime: rg.id, product: p.id, test: id, what, ...testSeries(points) };
      };
      add("paid", `the ${BASE} band paid more than it cost`, base.map((t) => ({ d: t.d, len: t.len, x: t.net })));
      for (const b of BANDS) {
        if (b.id === BASE) continue;
        const pts = [];
        for (const t of base) {
          const o = idx.get(`${t.pid}|${t.len}|${t.sed}|${b.id}`);
          if (o) pts.push({ d: t.d, len: t.len, x: o.net - t.net });
        }
        add(`band:${b.id}`, `the ${b.id} band instead of ${BASE}`, pts);
      }
      const pts = [];
      let noPick = 0;
      for (const t of base) {
        const b = best.get(`${t.pid}|${t.len}|${t.sed}`);
        if (!b) { noPick++; continue; }
        const o = idx.get(`${t.pid}|${t.len}|${t.sed}|${b}`);
        if (o) pts.push({ d: t.d, len: t.len, x: o.net - t.net });
      }
      add("best", `the band that did best so far instead of ${BASE}`, pts);
      tests[`${rg.id}/${p.id}/best`].no_pick_trials = noPick;
    }
  }
  const adj = holm(Object.fromEntries(family.map((k) => [k, tests[k].p])));
  for (const k of family) {
    const t = tests[k];
    t.p_holm = +adj[k].toPrecision(3);
    const lens = Object.values(t.lengths).filter((l) => l.windows >= MIN_WINDOWS_PER_LENGTH);
    t.positive_every_length = lens.length > 0 && lens.every((l) => l.mean > 0);
    t.kept = t.p_holm < 0.05 && t.mean > 0 && t.positive_every_length;
  }
  return { family, tests };
}

/* the plain record: per product, regime, band and length, what an endorsement
   bought every sales day would have done */
export function summarize(trials) {
  const out = {};
  for (const rg of REGIMES) {
    for (const p of PRODUCTS) {
      for (const b of BANDS) {
        const ts = trials.filter((t) => t.pid === p.id && t.ry >= rg.fromRY && t.band === b.id);
        const lens = [...new Set(ts.map((t) => t.len))].sort((a, c) => a - c);
        for (const len of lens) {
          const xs = ts.filter((t) => t.len === len);
          const s = testSeries(xs.map((t) => ({ d: t.d, len, x: t.net })));
          out[`${rg.id}/${p.id}/${b.id}/${len}`] = {
            trials: xs.length, windows: s.windows, nEff: s.nEff,
            net: s.mean, paid_share: round(xs.filter((t) => t.paid > 0).length / xs.length, 3),
            paid: round(xs.reduce((a, t) => a + t.paid, 0) / xs.length, 3),
            cost: round(xs.reduce((a, t) => a + t.cost * (1 - subsidy(t.ry, t.level)), 0) / xs.length, 3),
            level: round(xs.reduce((a, t) => a + t.level, 0) / xs.length, 4),
            first: xs.reduce((a, t) => (t.sed < a ? t.sed : a), "99999999"),
            last: xs.reduce((a, t) => (t.sed > a ? t.sed : a), "00000000"),
          };
        }
      }
    }
  }
  return out;
}

/* The table above against what producers were actually given (Summary of
   Business rows, tallied by fetch_lrp.py into meta.json "sob_subsidy":
   {ry: {level percent: {subsidy percent: rows}}}). Per reinsurance year:
   rows at the table's share, above it (beginning and veteran producers get
   more), and below it. */
export function subsidyCheck(sob) {
  const out = {};
  for (const [ry, levels] of Object.entries(sob || {})) {
    const r = { rows: 0, agree: 0, above: 0, below: 0 };
    for (const [lv, pcts] of Object.entries(levels)) {
      const want = subsidy(+ry, +lv / 100);
      if (want == null) continue;
      for (const [pct, n] of Object.entries(pcts)) {
        r.rows += n;
        const d = +pct - Math.round(want * 100);
        if (d === 0) r.agree += n; else if (d > 0) r.above += n; else r.below += n;
      }
    }
    r.agree_share = r.rows ? round(r.agree / r.rows, 4) : null;
    out[ry] = r;
  }
  return out;
}

function main() {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const ROOT = fileURLToPath(new URL("../", import.meta.url));
  const dir = arg("--history", null), out = arg("--out", ROOT + "data/lrp/bt.json");
  const metaPath = arg("--meta", dirname(out) + "/meta.json");
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {};
  if (!dir) { console.error("pass --history DIR (a checkout of the lrp-history branch)"); process.exit(2); }
  const t0 = Date.now();
  const { offers, aev } = loadHistory(dir);
  const asOf = offers.reduce((a, o) => (o.sed > a ? o.sed : a), "00000000");
  const { trials, missing, open } = buildTrials(offers, aev, asOf);
  const { family, tests } = runBacktest(trials);
  const res = {
    v: 1, as_of: asOf, method: {
      per: "dollars per $100 of coverage, to the producer, after subsidy",
      bands: BANDS.map((b) => b.id), base: BASE, window_days: WINDOW_DAYS, hac_lags: HAC_LAGS,
      min_settled: MIN_SETTLED, settle_lag_days: SETTLE_LAG_DAYS, min_windows_per_length: MIN_WINDOWS_PER_LENGTH,
      regimes: REGIMES, products: PRODUCTS,
    },
    counts: { offers: offers.length, trials: trials.length, aev_missing: missing, still_open: open },
    family_size: family.length, kept: family.filter((k) => tests[k].kept),
    subsidy_check: subsidyCheck(meta.sob_subsidy),
    tests, record: summarize(trials),
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(res) + "\n");
  console.error(`lrp backtest: ${trials.length} trials, ${family.length} tests, kept ${res.kept.length}; ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
