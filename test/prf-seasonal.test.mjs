/* Seasonal forecast models and the structural tests in components/prf-optimize.js:
 * the forecast file's decoding, each model's z from its own earlier forecasts,
 * the skill table (from earlier years only), the tilt it drives, ENSO with the
 * PDO in the same phase, the coverage pick and the steadier spread. Held to:
 *
 *   * no look-ahead: the pick for Y reads the forecast for Y (made in November
 *     of Y-1) and nothing later; skill comes from years before Y; rewriting
 *     every later forecast and index leaves the pick for Y alone;
 *   * where a model has not shown skill it moves nothing;
 *   * every pick obeys every rule;
 *   * the coverage pick and the steadier spread, by hand;
 *   * scripts/fetch_seasonal_models.py passes its own selftest, offline.
 *
 *   node --test test/prf-seasonal.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { window: {}, Buffer };
vm.runInNewContext(readFileSync(ROOT + "components/prf-math.js", "utf8"), ctx);
vm.runInNewContext(readFileSync(ROOT + "components/prf-optimize.js", "utf8"), ctx);
const M = ctx.window.AgPrfMath, O = ctx.window.AgPrfOptimize;
const FX = JSON.parse(readFileSync(ROOT + "test/fixtures/prf/opt-grid-30454.json", "utf8"));
const meta = JSON.parse(readFileSync(ROOT + "data/prf/meta.json", "utf8"));

const fxInput = (cov, index) => ({ index: index || FX.index, rates: FX.rates[cov], coverage: cov, subsidy: FX.subsidy[String(cov)], grid: FX.grid,
  min: FX.lim.map((p) => (p ? p[0] : null)), max: FX.lim.map((p) => (p ? p[1] : null)), avgMm: FX.avgMm, lastComplete: meta.years.last_complete });

function assertLegal(split, input, where) {
  const valid = input.min.map((m, i) => m != null && input.rates[i] != null);
  const chk = M.checkSplit(split, input.min, input.max, valid);
  assert.ok(chk.ok && chk.used >= 2, `${where}: ${JSON.stringify(chk.errors)} for ${split}`);
}

/* ------------------------------------------------------------ a synthetic forecast file */
const enc = (v) => (v == null ? "--" : Math.max(0, Math.min(1295, Math.round(v))).toString(36).padStart(2, "0"));
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const BOX = O.boxOf(FX.grid);
/* signal: how strongly a model's forecast follows the index (0 = pure noise) */
function fakeModel(signal, seed, first, last, intervals, edit) {
  const rnd = lcg(seed);
  let str = "";
  for (let y = first; y <= last; y++) for (const i of intervals) {
    const x = FX.index[y] ? FX.index[y][i] : null;
    let v = 120 + 80 * (rnd() - 0.5) * 2 * (1 - signal) + (x == null ? 0 : signal * 90 * (x - 1));
    if (edit) v = edit(y, i, v);
    str += enc(v);
  }
  return { first, last, intervals, v: { [BOX]: str } };
}
function fakeSeasonal(edit) {
  return { v: 1, box_deg: 2, models: {
    ecmwf: fakeModel(0.8, 11, 1993, 2026, [0, 1, 2, 3], edit),
    cfsv2: fakeModel(0.7, 12, 1982, 2026, [0, 1, 2, 3, 4, 5, 6], edit),
    jma: fakeModel(0, 13, 1993, 2026, [0, 1, 2, 3], edit)
  } };
}
const FC_IDS = ["fc-ecmwf", "fc-cfsv2", "fc-jma", "fc-mmm"];
function withSkill(sea, G, ids = FC_IDS) {
  const seasonalSkill = {};
  for (const id of ids) { seasonalSkill[id] = {}; for (let Y = 1981; Y <= 2026; Y++) seasonalSkill[id][Y] = O.forecastSkill(sea, id, Y, [G]); }
  return { series: {}, seasonal: sea, seasonalSkill };
}

test("the forecast file decodes the way scripts/fetch_seasonal_models.py writes it", () => {
  const sea = { models: { ecmwf: { first: 2000, last: 2001, intervals: [0, 3], v: { "3_4": "0a--zz10" } } } };
  assert.equal(O.seasonalRaw(sea, "ecmwf", "3_4", 0, 2000), 10);
  assert.equal(O.seasonalRaw(sea, "ecmwf", "3_4", 3, 2000), null, "-- is missing");
  assert.equal(O.seasonalRaw(sea, "ecmwf", "3_4", 0, 2001), 35 * 36 + 35);
  assert.equal(O.seasonalRaw(sea, "ecmwf", "3_4", 3, 2001), 36);
  assert.equal(O.seasonalRaw(sea, "ecmwf", "3_4", 1, 2000), null, "an interval the model does not reach");
  assert.equal(O.seasonalRaw(sea, "ecmwf", "3_4", 0, 2002), null);
  assert.equal(O.seasonalRaw(sea, "ukmo", "3_4", 0, 2000), null);
  /* the box: 2-degree steps from the grid's own corner; grid 30454 is 45.25N 91.75W */
  assert.equal(O.boxOf(30454), Math.floor(101 / 8) + "_" + Math.floor(153 / 8));
  assert.equal(O.blockOf(30454), Math.floor(101 / 24) + "_" + Math.floor(153 / 32));
});

test("a model's z for Y is standardized on its own forecasts before Y only, by hand", () => {
  const sea = fakeSeasonal();
  const Y = 2010, i = 2, past = [];
  for (let t = 1993; t < Y; t++) past.push(O.seasonalRaw(sea, "ecmwf", BOX, i, t));
  const mu = past.reduce((a, b) => a + b, 0) / past.length;
  const sd = Math.sqrt(past.reduce((a, b) => a + (b - mu) ** 2, 0) / (past.length - 1));
  const zs = O.zSeries(sea, "ecmwf", BOX, i, Y);
  assert.ok(Math.abs(zs.now - (O.seasonalRaw(sea, "ecmwf", BOX, i, Y) - mu) / sd) < 1e-12);
  assert.equal(zs.n, Y - 1993);
  assert.equal(O.zSeries(sea, "ecmwf", BOX, i, 2002), null, "fewer than ten earlier forecasts: no z");
  /* the average needs two models in a year: before 1993 only CFSv2 has forecasts */
  const mm = O.zSeries(sea, "*", BOX, i, Y);
  assert.ok(Object.keys(mm.past).every((t) => +t >= 1993 && +t < Y));
});

test("the odds of each third from z and r: a third each with no skill, and they add to one", () => {
  const o = O.outlookFromZ(1.5, 0);
  for (const k of ["below", "near", "above"]) assert.ok(Math.abs(o[k] - 1 / 3) < 1e-6, k);
  const w = O.outlookFromZ(1, 0.5), d = O.outlookFromZ(-1, 0.5);
  assert.ok(w.above > w.below && Math.abs(w.above - d.below) < 1e-9);
  assert.ok(Math.abs(w.below + w.near + w.above - 1) < 1e-12);
  assert.ok(Math.abs(O.normCdf(1.959964) - 0.975) < 1e-6);
});

test("the skill table, by hand for one interval, and nothing from Y or later goes into it", () => {
  const G = O.prepare(fxInput(90)), sea = fakeSeasonal(), Y = 2012, i = 1;
  const sk = O.forecastSkill(sea, "fc-ecmwf", Y, [G]);
  const zs = O.zSeries(sea, "ecmwf", BOX, i, Y), xs = [], zz = [];
  G.years.forEach((t, k) => { if (t < Y && zs.past[t] != null) { xs.push(G.X[k][i]); zz.push(zs.past[t]); } });
  const m = (a) => a.reduce((p, q) => p + q, 0) / a.length, mx = m(xs), mz = m(zz);
  let c = 0, vx = 0, vz = 0;
  xs.forEach((x, j) => { c += (x - mx) * (zz[j] - mz); vx += (x - mx) ** 2; vz += (zz[j] - mz) ** 2; });
  assert.ok(Math.abs(sk[O.blockOf(FX.grid)][i] - Math.round((1000 * c) / Math.sqrt(vx * vz)) / 1000) < 1e-9);
  assert.equal(sk[O.blockOf(FX.grid)][8], null, "an interval no model reaches has no skill figure");
  /* rewrite every forecast after Y-1 and every index year from Y on: the same table */
  const idx = {};
  for (const [y, row] of Object.entries(FX.index)) idx[y] = +y >= Y ? row.map((v) => (v == null ? null : 2.4 - v)) : row;
  const sea2 = fakeSeasonal((y, _i, v) => (y >= Y ? 900 - v : v));
  assert.deepEqual(O.forecastSkill(sea2, "fc-ecmwf", Y, [O.prepare(fxInput(90, idx))]), sk);
});

test("no look-ahead, every forecast tilt: the forecast for Y and earlier years only", () => {
  const G = O.prepare(fxInput(90)), sea = fakeSeasonal(), clim = withSkill(sea, G);
  let calls = 0, tilted = 0;
  const base = O.walkForward(G, { predictors: FC_IDS, climate: clim, onTilt: (Y, id, used) => {
    calls++;
    assert.ok(used.years.every((y) => y < Y), `${id} ${Y}`);
    assert.deepEqual(Array.from(used.climate), [`seasonal:${O.predictorById(id).model}:${Y - 1}-11`]);
  } });
  assert.equal(calls, 45 * FC_IDS.length);
  for (const r of base.rows) for (const id of FC_IDS) if (r.tiltState[id] != null) tilted++;
  assert.ok(tilted > 20, `the synthetic skill should tilt some years (${tilted})`);
  for (const Y of [1996, 2005, 2017, 2025]) {
    const idx = {};
    for (const [y, row] of Object.entries(FX.index)) idx[y] = +y >= Y ? row.map((v, i) => (v == null ? null : ((v * 7 + i) % 2.5))) : row;
    const G2 = O.prepare(fxInput(90, idx)), sea2 = fakeSeasonal((y, _i, v) => (y > Y ? 1200 - v : v));
    const wf = O.walkForward(G2, { predictors: FC_IDS, climate: withSkill(sea2, G2) });
    const a = base.rows.find((r) => r.year === Y), b = wf.rows.find((r) => r.year === Y);
    for (const id of FC_IDS) {
      assert.deepEqual(Array.from(b.tiltPick[id]), Array.from(a.tiltPick[id]), `${id} ${Y}: moved when only later data changed`);
      assert.equal(b.tiltState[id], a.tiltState[id], `${id} ${Y}`);
    }
  }
});

test("where a model has not shown skill it moves nothing; where it has, only those intervals", () => {
  const G = O.prepare(fxInput(90)), sea = fakeSeasonal(), clim = withSkill(sea, G);
  const blk = O.blockOf(FX.grid);
  let checked = 0;
  for (const Y of [2008, 2015, 2024]) for (const id of FC_IDS) {
    const use = G.years.map((y) => y < Y);
    const tf = O.tiltFor(G, id, Y, use, clim), sk = clim.seasonalSkill[id][Y][blk];
    if (!tf.opts.outlook) { assert.equal(tf.state, null); assert.ok(sk.every((r) => r == null || r < O.SKILL.minR), `${id} ${Y}`); continue; }
    tf.opts.outlook.forEach((o, i) => { if (o) { assert.ok(sk[i] >= O.SKILL.minR, `${id} ${Y} ${i}`); checked++; } else assert.ok(sk[i] == null || sk[i] < O.SKILL.minR || O.zSeries(sea, O.predictorById(id).model, O.boxOf(FX.grid), i, Y)?.now == null); });
  }
  assert.ok(checked > 0);
  /* a table with no skill anywhere: the plain pick */
  const flat = { ...clim, seasonalSkill: { "fc-ecmwf": Object.fromEntries(Object.entries(clim.seasonalSkill["fc-ecmwf"]).map(([y, t]) => [y, Object.fromEntries(Object.entries(t || {}).map(([b, row]) => [b, row.map((r) => (r == null ? null : 0.1))]))])) } };
  const wf = O.walkForward(G, { predictors: ["fc-ecmwf"], climate: flat });
  for (const r of wf.rows) { assert.equal(r.tiltState["fc-ecmwf"], null); assert.deepEqual(Array.from(r.tiltPick["fc-ecmwf"]), Array.from(r.pick)); }
});

test("every forecast-tilted pick obeys every rule, at 70% and 90%", () => {
  for (const cov of [70, 90]) {
    const input = fxInput(cov), G = O.prepare(input);
    const wf = O.walkForward(G, { predictors: FC_IDS, climate: withSkill(fakeSeasonal(), G) });
    for (const r of wf.rows) for (const id of FC_IDS) assertLegal(r.tiltPick[id], input, `${cov} ${r.year} ${id}`);
  }
});

/* ------------------------------------------------------------ ENSO with the PDO in the same phase */
test("ENSO with the PDO in the same phase: a reading only when the two push the same way", () => {
  const G = O.prepare(fxInput(90));
  const monthly = {};
  for (let y = 1940; y <= 2026; y++) monthly[y] = Array.from({ length: 12 }, () => (y % 2 ? 0.8 : -0.8));
  const clim = { series: { pdo: { monthly } } };
  let same = 0, mixed = 0;
  for (let Y = 1981; Y <= 2025; Y++) {
    const tf = O.tiltFor(G, "pdo-enso-same", Y, G.years.map((y) => y < Y), clim);
    const e = O.phaseKnownFor(Y), pd = (Y - 1) % 2 ? "warm" : "cold";
    const want = (e === "el-nino" && pd === "warm") || (e === "la-nina" && pd === "cold") ? e + "/" + pd : null;
    assert.equal(tf.state, want, String(Y));
    if (want) same++; else mixed++;
    for (const [y, lab] of Object.entries(tf.opts.analogs[0].labels)) assert.ok(lab == null || /^(el-nino\/warm|la-nina\/cold)$/.test(lab), `${y} ${lab}`);
  }
  assert.ok(same > 3 && mixed > 3);
});

/* ------------------------------------------------------------ the coverage pick */
test("coverage pick: return on what the producer pays is payback / (1 - subsidy) - 1 for any rate-led split, and it picks the most", () => {
  const Gs = {};
  for (const c of [70, 75, 80, 85, 90]) Gs[c] = O.prepare(fxInput(c));
  const Y = 2001, use = Gs[90].years.map((y) => y < Y);
  const best = O.coverageEdge(Gs, use, Y);
  let top = -Infinity, at = null;
  for (const c of [90, 85, 80, 75, 70]) {
    const G = Gs[c], pv = O.pricedValues(G, O.weights(G, use, { asOf: Y }), use, Y);
    const ret = pv.payback / (1 - G.subsidy) - 1;
    const pk = O.pick(G, { use, asOf: Y });
    assert.ok(Math.abs(pk.score / O.premiumOf(G, pk.split) - ret) < 1e-9, `${c}: the pick's own return`);
    const ev = O.evenSpread(G);
    const evScore = ev.reduce((s, p, i) => s + (p / 100) * pk.values[i], 0);
    assert.ok(Math.abs(evScore / O.premiumOf(G, ev) - ret) < 1e-9, `${c}: any split, same return`);
    if (ret > top + 1e-12) { top = ret; at = c; }
  }
  assert.equal(best.coverage, at);
  /* later years do not move it */
  const idx = {};
  for (const [y, row] of Object.entries(FX.index)) idx[y] = +y >= Y ? row.map(() => 0.05) : row;
  const Gs2 = {};
  for (const c of [70, 75, 80, 85, 90]) Gs2[c] = O.prepare(fxInput(c, idx));
  assert.deepEqual(O.coverageEdge(Gs2, use, Y), best);
});

/* ------------------------------------------------------------ the steadier spread */
test("steadier spread: within 5% of the best expected score, legal, and missing no more earlier years than the plain pick", () => {
  for (const cov of [70, 90]) {
    const input = fxInput(cov), G = O.prepare(input);
    for (const Y of [1985, 2000, 2015, 2025]) {
      const use = G.years.map((y) => y < Y);
      const a = O.pick(G, { use, asOf: Y }), s = O.spreadPick(G, { use, asOf: Y });
      assertLegal(s.split, input, `${cov} ${Y}`);
      assert.ok(s.score >= a.score - O.SPREAD_NEAR * Math.abs(a.score) - 1e-12);
      const misses = (split) => G.years.filter((y, k) => use[k] && !split.some((p, i) => p && G.P[k][i] > 0) && !split.some((p, i) => p && O.lateUnknown(G, k, i, Y))).length;
      assert.equal(s.misses, misses(s.split));
      assert.ok(s.misses <= misses(a.split), `${cov} ${Y}: ${s.misses} > ${misses(a.split)}`);
      /* later years do not move it */
      const idx = {};
      for (const [y, row] of Object.entries(FX.index)) idx[y] = +y >= Y ? row.map((v) => (v == null ? null : 2.4 - v)) : row;
      assert.deepEqual(O.spreadPick(O.prepare(fxInput(cov, idx)), { use, asOf: Y }), s);
    }
  }
});

test("scripts/fetch_seasonal_models.py passes its own selftest (synthetic data, no network, no key)", () => {
  const env = { ...process.env };
  delete env.CDS_API_KEY;
  const r = spawnSync("python3", [ROOT + "scripts/fetch_seasonal_models.py", "--selftest"], { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /selftest ok/);
});
