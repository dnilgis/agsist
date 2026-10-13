/* The PRF interval optimizer (components/prf-optimize.js) held to the rules
 * and to itself.
 *
 *   * every pick obeys every rule: whole percents adding to 100, at least two
 *     intervals, no month in two, each between the county's minimum and
 *     maximum, only offered and priced intervals (checked with prf-math.js's
 *     own checkSplit, the one the calculator uses), across real grids in every
 *     state, both scores, with and without a forecast, and in every year of
 *     the walk-forward test;
 *   * the search is exact: it matches a brute force over every allowed split
 *     on small cases and on a real grid at 5% steps;
 *   * the walk-forward test cannot see the year it scores: it is told which
 *     years it used, and changing every later year leaves each pick alone;
 *   * the same inputs give the same answer, whatever order they arrive in;
 *   * data/prf/opt.json is the test the panel quotes, and stays small.
 *
 *   node --test test/prf-optimize.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { window: {}, Buffer };
vm.runInNewContext(readFileSync(ROOT + "components/prf-math.js", "utf8"), ctx);
vm.runInNewContext(readFileSync(ROOT + "components/prf-optimize.js", "utf8"), ctx);
const M = ctx.window.AgPrfMath, O = ctx.window.AgPrfOptimize;
const FX = JSON.parse(readFileSync(ROOT + "test/fixtures/prf/opt-grid-30454.json", "utf8"));
const meta = JSON.parse(readFileSync(ROOT + "data/prf/meta.json", "utf8"));

function inputFrom(o, lim, cov, subsidy) {
  return { index: o.index, rates: o.rates[cov], coverage: cov, subsidy: subsidy[String(cov)],
           min: lim.map((p) => (p ? p[0] : null)), max: lim.map((p) => (p ? p[1] : null)), avgMm: o.avgMm, lastComplete: meta.years.last_complete };
}
const fxInput = (cov) => inputFrom(FX, FX.lim, cov, FX.subsidy);

/* a pick is legal when the calculator's own check passes and every interval used is priced */
function assertLegal(split, input, where) {
  assert.equal(split.length, 11, where);
  assert.ok(split.every((p) => Number.isInteger(p) && p >= 0), `${where}: whole percents ${split}`);
  const valid = input.min.map((m, i) => m != null && input.rates[i] != null);
  const chk = M.checkSplit(split, input.min, input.max, valid);
  assert.ok(chk.ok, `${where}: ${JSON.stringify(chk.errors)} for ${split}`);
  assert.ok(chk.used >= 2, `${where}: fewer than two intervals ${split}`);
  if (split[0]) assert.ok(split[0] <= 25 || input.max[0] > 25, `${where}: Jan-Feb over its cap`);
}

/* ------------------------------------------------------------ a broad real sample */
const byFips = {};
for (const s of meta.states) byFips[s.fips] = s.st;
const states = {};
const SAMPLE = [];
{
  const want = {};
  for (const s of meta.states) {
    states[s.st] = JSON.parse(readFileSync(ROOT + `data/prf/s/${s.st}.json`, "utf8"));
    /* four grids per state, from four counties spread through the state's list */
    const cos = Object.keys(states[s.st].counties).sort();
    for (let k = 0; k < 4; k++) {
      const co = states[s.st].counties[cos[Math.floor((k * cos.length) / 4)]];
      const g = co.g[Math.floor(co.g.length / 2)];
      want[g] = { st: s.st, lim: co.lim };
    }
  }
  const shards = {};
  for (const id of Object.keys(want)) (shards[M.shardKey(+id)] = shards[M.shardKey(+id)] || []).push(+id);
  for (const [key, ids] of Object.entries(shards)) {
    const sh = JSON.parse(readFileSync(ROOT + `data/prf/g/${key}.json`, "utf8"));
    for (const id of ids) if (sh.g[id]) SAMPLE.push({ id, st: want[id].st, lim: want[id].lim, o: M.openGrid(sh.g[id], sh.y0, sh.y1, null) });
  }
}

test("the sample covers every state", () => {
  assert.equal(new Set(SAMPLE.map((g) => g.st)).size, 48);
  assert.ok(SAMPLE.length >= 150, `only ${SAMPLE.length} grids`);
});

test("every pick obeys every rule: real grids, both scores, three coverages, with and without a forecast", () => {
  let picks = 0;
  const outlook = Array.from({ length: 11 }, (_, i) => (i % 3 === 0 ? { below: 0.5, near: 0.3, above: 0.2 } : i % 3 === 1 ? { below: 0.2, near: 0.3, above: 0.5 } : null));
  for (const g of SAMPLE) for (const cov of [70, 80, 90]) for (const objective of ["net", "dry"]) for (const fc of [{}, { enso: "la-nina" }, { enso: "el-nino", outlook }]) {
    const input = inputFrom(g.o, g.lim, cov, meta.subsidy);
    const G = O.prepare(input);
    const p = O.pick(G, { objective, ...fc });
    assert.ok(p, `no pick for grid ${g.id}`);
    assertLegal(p.split, input, `grid ${g.id} ${cov}% ${objective} ${JSON.stringify(fc).slice(0, 30)}`);
    picks++;
  }
  assert.ok(picks >= 2700, `only ${picks} picks checked`);
});

test("every walk-forward pick obeys every rule, and so do the fixed rules it is compared with", () => {
  let n = 0;
  for (const g of SAMPLE.slice(0, 60)) {
    const input = inputFrom(g.o, g.lim, 90, meta.subsidy), G = O.prepare(input);
    const wf = O.walkForward(G, {});
    for (const r of wf.rows) { assertLegal(r.pick, input, `grid ${g.id} ${r.year}`); if (r.pickEnso) assertLegal(r.pickEnso, input, `grid ${g.id} ${r.year} enso`); n++; }
    for (const k of ["even", "def", "dry2"]) if (wf[k]) assertLegal(wf[k], input, `grid ${g.id} ${k}`);
  }
  assert.ok(n >= 2000, `only ${n} walk-forward picks`);
});

test("the January-February cap of 25% holds even when January-February is the best interval", () => {
  const input = fxInput(90);
  const G = O.prepare(input);
  const v = Array.from({ length: 11 }, (_, i) => (i === 0 ? 1 : 0.01 * i));
  const s = O.solve(G, v);
  assert.equal(s.split[0], 25);
  assertLegal(s.split, input, "jan-feb best");
});

/* ------------------------------------------------------------ exact */
function brute(G, v, step) {
  let best = -Infinity;
  const allowed = G.allowed.map((a, i) => a && v[i] != null);
  const units = 100 / step;
  (function walk(i, left, cur, last) {
    if (i === 11) {
      if (left !== 0) return;
      const used = cur.filter((x) => x > 0).length;
      if (used < 2) return;
      let s = 0; for (let k = 0; k < 11; k++) s += (cur[k] * step) / 100 * (v[k] || 0);
      if (s > best) best = s;
      return;
    }
    cur[i] = 0; walk(i + 1, left, cur, false);
    if (!allowed[i] || last) return;
    const lo = Math.ceil(G.lo[i] / step), hi = Math.floor(G.hi[i] / step);
    for (let u = Math.max(1, lo); u <= Math.min(hi, left); u++) { cur[i] = u; walk(i + 1, left - u, cur, true); }
    cur[i] = 0;
  })(0, units, new Array(11).fill(0), false);
  return best;
}
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

test("exact on small cases: matches a brute force over every 1% split, 300 random problems", () => {
  const rnd = lcg(7);
  for (let t = 0; t < 300; t++) {
    /* four or five allowed intervals scattered over the year, random caps, random values (some negative) */
    const allowed = new Array(11).fill(false);
    const k = 4 + (t % 2);
    while (allowed.filter(Boolean).length < k) allowed[Math.floor(rnd() * 11)] = true;
    const caps = [25, 40, 50, 60, 70];
    const G = { allowed, lo: allowed.map((a) => (a ? 10 : null)), hi: allowed.map((a, i) => (a ? (i === 0 ? 25 : caps[Math.floor(rnd() * caps.length)]) : null)) };
    const v = allowed.map((a) => (a ? rnd() * 0.2 - 0.05 : null));
    const s = O.solve(G, v, 1);
    const b = brute(G, v, 1);
    if (b === -Infinity) { assert.equal(s, null, `case ${t}: a pick where none fits`); continue; }
    assert.ok(s, `case ${t}: no pick where one fits`);
    assert.ok(Math.abs(s.score - b) < 1e-12, `case ${t}: solver ${s.score} brute ${b}`);
    const chk = M.checkSplit(s.split, G.lo, G.hi, G.allowed);
    assert.ok(chk.ok && chk.used >= 2, `case ${t}: ${JSON.stringify(chk.errors)}`);
  }
});

test("exact on a real grid: matches a brute force over every 5% split of all eleven intervals", () => {
  for (const cov of [70, 90]) for (const objective of ["net", "dry"]) {
    const G = O.prepare(fxInput(cov));
    const p = O.pick(G, { objective, step: 5 });
    const b = brute(G, p.values, 5);
    assert.ok(Math.abs(p.score - b) < 1e-12, `${cov} ${objective}: solver ${p.score} brute ${b}`);
  }
});

test("the 1% pick is at least as good as the 5% pick (the finer search can only do better)", () => {
  for (const g of SAMPLE.slice(0, 40)) {
    const G = O.prepare(inputFrom(g.o, g.lim, 90, meta.subsidy));
    const a = O.pick(G, {}), b = O.pick(G, { step: 5 });
    assert.ok(a.score >= b.score - 1e-12, `grid ${g.id}`);
  }
});

/* ------------------------------------------------------------ no look-ahead */
test("walk-forward: each pick is told the years it used, and every one is earlier than the year it scores", () => {
  let calls = 0;
  for (const g of SAMPLE.slice(0, 30)) {
    const G = O.prepare(inputFrom(g.o, g.lim, 90, meta.subsidy));
    O.walkForward(G, { onTrain: (Y, used) => {
      calls++;
      assert.ok(used.length >= 30, `${Y}: ${used.length} years`);
      assert.ok(used.every((y) => y < Y), `${Y} saw ${used.filter((y) => y >= Y)}`);
      assert.equal(used[used.length - 1], Y - 1, `${Y}: the year before was not used`);
    } });
  }
  assert.ok(calls >= 30 * 40, `only ${calls} picks seen`);
});

test("walk-forward: rewriting every year from Y on does not change the pick for Y", () => {
  const base = O.prepare(fxInput(90));
  const wf = O.walkForward(base, {});
  for (const Y of [1981, 1995, 2012, 2025]) {
    const idx = {};
    for (const [y, row] of Object.entries(FX.index)) idx[y] = +y >= Y ? row.map((v, i) => (v == null ? null : ((v * 7 + i) % 2.5))) : row;
    const G = O.prepare({ ...fxInput(90), index: idx });
    const wf2 = O.walkForward(G, {});
    const a = wf.rows.find((r) => r.year === Y), b = wf2.rows.find((r) => r.year === Y);
    assert.deepEqual(Array.from(b.pick), Array.from(a.pick), `${Y}: the pick moved when only later years changed`);
    assert.deepEqual(Array.from(b.pickEnso), Array.from(a.pickEnso), `${Y}: the ENSO pick moved when only later years changed`);
  }
});

test("the ENSO reading for policy year Y is the August-October reading of Y-1, never Y", () => {
  for (let y = 1951; y <= 2025; y++) assert.equal(O.phaseKnownFor(y), O.ensoPhase(O.oniASO(y - 1)), String(y));
  assert.equal(O.oniASO(1949), null);
  assert.equal(O.ONI_ASO.length, 2024 - 1950 + 1, "the table runs 1950 to 2024: the reading for the last complete year, 2025, is ASO 2024");
  assert.equal(O.ensoPhase(0.5), "el-nino"); assert.equal(O.ensoPhase(-0.5), "la-nina"); assert.equal(O.ensoPhase(0.49), "neutral");
  /* phases not in doubt */
  assert.equal(O.phaseKnownFor(1998), "el-nino");  /* 1997 */
  assert.equal(O.phaseKnownFor(2011), "la-nina");  /* 2010 */
  assert.equal(O.phaseKnownFor(2016), "el-nino");  /* 2015 */
  assert.equal(O.phaseKnownFor(2023), "la-nina");  /* 2022 */
  assert.equal(O.phaseKnownFor(2024), "el-nino");  /* 2023 */
});

/* ------------------------------------------------------------ determinism */
test("the same inputs give the same answer, in any key order, every time", () => {
  const a = O.recommend(fxInput(90), { enso: "la-nina" });
  const shuffled = {};
  for (const y of Object.keys(FX.index).reverse()) shuffled[y] = FX.index[y];
  const b = O.recommend({ ...fxInput(90), index: shuffled }, { enso: "la-nina" });
  const c = O.recommend(fxInput(90), { enso: "la-nina" });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify(a), JSON.stringify(c));
  assert.equal(O.flipTest([1, -2, 3, 0.5, -0.1]), O.flipTest([1, -2, 3, 0.5, -0.1]));
});

/* ------------------------------------------------------------ the pieces, by hand */
test("the outlook tilt: a 40/33/27 lean weights dry-tercile years 1.2, middle 0.99, wet 0.81", () => {
  const G = O.prepare(fxInput(90));
  const use = G.years.map(() => true);
  const outlook = new Array(11).fill(null); outlook[5] = { below: 0.4, near: 0.33, above: 0.27 };
  const W = O.weights(G, use, { outlook });
  const seen = new Set(W.map((r) => Math.round(r[5] * 100) / 100));
  assert.deepEqual([...seen].sort(), [0.81, 0.99, 1.2]);
  assert.ok(W.every((r) => r[4] === 1), "an interval with no outlook keeps weight 1");
});

test("ENSO weighting: years after a matching fall count double, the rest once", () => {
  const G = O.prepare(fxInput(90));
  const W = O.weights(G, G.years.map(() => true), { enso: "La Nina" });
  G.years.forEach((y, k) => assert.equal(W[k][3], O.phaseKnownFor(y) === "la-nina" ? 2 : 1, String(y)));
});

test("sign test and payment factor, by hand", () => {
  assert.ok(Math.abs(O.signTest(9, 1) - 22 / 1024) < 1e-12);
  assert.equal(O.signTest(5, 5), 1);
  const G = O.prepare({ ...fxInput(90), index: { 2000: [0.6, 0.9, 1.2, 0.45, 0.899, 1, 1, 1, 1, 1, 1] }, lastComplete: 2025 });
  assert.ok(Math.abs(G.P[0][0] - (0.9 - 0.6) / 0.9) < 1e-12);
  assert.equal(G.P[0][1], 0, "an index equal to the trigger pays nothing");
  assert.ok(G.P[0][4] > 0);
});

test("the recommendation says what it is and carries its record", () => {
  const r = O.recommend(fxInput(90), {});
  assert.ok(r.ok);
  assert.equal(r.objective, "net");
  assert.equal(r.rec.estimator, "priced");
  assert.equal(r.years.first, 1951); assert.equal(r.years.last, 2025); assert.equal(r.years.n, 75);
  assert.equal(r.backtest.first, 1981); assert.equal(r.backtest.years, 45);
  assert.ok(r.reasons.length >= 4 && r.reasons.every((t) => typeof t === "string" && !t.includes("—") && !/NaN|undefined|null/.test(t)), r.reasons.join("\n"));
  assert.equal(r.forecast, null, "no forecast unless one is given");
  const d = O.recommend(fxInput(90), { objective: "dry" });
  assert.equal(d.rec.estimator, "history");
  const thin = O.recommend({ ...fxInput(90), index: Object.fromEntries(Object.entries(FX.index).slice(0, 20)) }, {});
  assert.equal(thin.ok, false);
});

test("outlookFor reads the two shapes it promises and ignores anything else", () => {
  const a = O.outlookFor({ issued: "2026-10-15", enso: { phase: "La Niña", oni: -0.6 }, intervals: { "630": { below: 40, near: 33, above: 27 } } }, 30454);
  assert.equal(a.enso, "la-nina");
  assert.ok(Math.abs(a.outlook[5].below - 0.4) < 1e-12);
  assert.equal(a.outlook[0], null);
  const b = O.outlookFor({ grids: { "30454": { "625": { below: 0.2, near: 0.3, above: 0.5 } } } }, 30454);
  assert.ok(Math.abs(b.outlook[0].above - 0.5) < 1e-12);
  assert.equal(O.outlookFor({ nonsense: 1 }, 30454).outlook, null);
  assert.equal(O.outlookFor(null, 1).enso, null);
});

/* ------------------------------------------------------------ the published test */
test("data/prf/opt.json: the test the panel quotes, from at least 200 grids in all 48 states, and small", () => {
  const f = ROOT + "data/prf/opt.json";
  assert.ok(existsSync(f), "data/prf/opt.json is missing: run node scripts/prf_opt_backtest.mjs");
  assert.ok(statSync(f).size < 60 * 1024, "opt.json grew past 60 KB");
  const d = JSON.parse(readFileSync(f, "utf8"));
  assert.equal(d.crop_year, meta.crop_year);
  assert.equal(d.last_complete, meta.years.last_complete);
  assert.ok(d.sample.grids >= 200 && d.sample.states === 48);
  for (const k of ["90_net", "90_dry", "70_net", "70_dry"]) {
    const r = d.results[k];
    assert.ok(r && r.grids >= 200 && r.years.first === 1981 && r.years.last === meta.years.last_complete, k);
    assert.equal(r.gridYears, r.grids * r.years.n, `${k}: every grid scored every year`);
    for (const v of Object.values(r.mean)) assert.ok(Number.isFinite(v), k);
  }
});
