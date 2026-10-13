/* The extra climate predictors in components/prf-optimize.js (PREDICTORS):
 * recency weighting, last fall on the grid, PDO with ENSO, AMO, and the
 * stubs. Held to:
 *
 *   * no look-ahead, for every predictor: each pick for year Y reads index
 *     years before Y only, climate months no later than the sales closing
 *     allowed (Aug-Oct of Y-1 for the PDO, Jul-Sep for the AMO), and
 *     rewriting everything after that leaves the pick alone;
 *   * a missing climate file skips the predictors that need it, cleanly;
 *   * every tilted pick obeys every rule;
 *   * the same inputs give the same answer;
 *   * the family count and the adjustment, by hand;
 *   * data/prf/opt.json lists every predictor with a line, and keeps only
 *     what passed the rule it states.
 *
 *   node --test test/prf-climate.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
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

const fxInput = (cov, index) => ({ index: index || FX.index, rates: FX.rates[cov], coverage: cov, subsidy: FX.subsidy[String(cov)],
  min: FX.lim.map((p) => (p ? p[0] : null)), max: FX.lim.map((p) => (p ? p[1] : null)), avgMm: FX.avgMm, lastComplete: meta.years.last_complete });

/* a synthetic climate file in the shape scripts/fetch_climate_indices.py writes */
function fakeClimate(edit) {
  const series = {};
  for (const [name, f] of [["pdo", (y, m) => Math.sin(y * 0.7 + m * 0.3) * 1.2], ["amo", (y, m) => Math.cos(y * 0.23 + m * 0.1) * 0.3]]) {
    const monthly = {};
    for (let y = 1940; y <= 2026; y++) monthly[y] = Array.from({ length: 12 }, (_, m) => (y === 2026 && m > 8 ? null : Math.round(f(y, m) * 1000) / 1000));
    series[name] = { url: "https://example.invalid/" + name, as_of: "2026-09", monthly };
  }
  if (edit) edit(series);
  return { v: 1, written_by: "scripts/fetch_climate_indices.py", series };
}
const CLIMATE = fakeClimate();
const RUN = O.PREDICTORS.filter((p) => !p.untestable && !p.stub).map((p) => p.id);

function assertLegal(split, input, where) {
  const valid = input.min.map((m, i) => m != null && input.rates[i] != null);
  const chk = M.checkSplit(split, input.min, input.max, valid);
  assert.ok(chk.ok && chk.used >= 2, `${where}: ${JSON.stringify(chk.errors)} for ${split}`);
  assert.ok(split.every((p) => Number.isInteger(p) && p >= 0), where);
}

/* ------------------------------------------------------------ the registry and the count */
test("the family counts every promised comparison, at both coverages, the stubs included", () => {
  const testable = O.PREDICTORS.filter((p) => !p.untestable);
  assert.equal(O.FAMILY.length, (testable.length + 1) * O.FAMILY_COVERAGES.length);
  for (const c of O.FAMILY_COVERAGES) {
    assert.ok(O.FAMILY.includes("enso@" + c));
    for (const p of testable) assert.ok(O.FAMILY.includes(`${p.id}@${c}`), p.id);
  }
  assert.ok(O.predictorById("nmme").stub, "NMME is a stub until its archive is in");
  assert.ok(/four months after/.test(O.predictorById("swe").untestable), "April 1 snowpack cannot be known at sign-up");
  assert.ok(!O.FAMILY.some((k) => k.startsWith("swe@")), "an untestable idea is not a comparison");
});

test("Holm's adjustment, by hand, with untried comparisons counted as p = 1", () => {
  const a = O.holm({ a: 0.001, b: 0.04 }, ["a", "b", "c", "d"]);
  assert.ok(Math.abs(a.a - 0.004) < 1e-12 && Math.abs(a.b - 0.12) < 1e-12, JSON.stringify(a));
  const b = O.holm({ a: 0.03, b: 0.01, c: 0.04 }, ["a", "b", "c"]);
  assert.ok(Math.abs(b.b - 0.03) < 1e-12 && Math.abs(b.a - 0.06) < 1e-12 && Math.abs(b.c - 0.06) < 1e-12, JSON.stringify(b));
  assert.equal(O.holm({ a: 0.9 }, ["a", "b"]).a, 1);
});

test("recency weights, by hand, and never a year at or after the policy year", () => {
  assert.equal(O.recencyWeight(2024, { asOf: 2025, halfLife: 15 }), 1);
  assert.ok(Math.abs(O.recencyWeight(2009, { asOf: 2025, halfLife: 15 }) - 0.5) < 1e-12);
  assert.ok(Math.abs(O.recencyWeight(1964, { asOf: 2025, halfLife: 30 }) - 0.25) < 1e-12);
  assert.equal(O.recencyWeight(1995, { asOf: 2025, lastN: 30 }), 1);
  assert.equal(O.recencyWeight(1994, { asOf: 2025, lastN: 30 }), 0);
  for (const r of [{ halfLife: 15 }, { halfLife: 30 }, { lastN: 30 }]) {
    assert.equal(O.recencyWeight(2025, { asOf: 2025, ...r }), 0);
    assert.equal(O.recencyWeight(2030, { asOf: 2025, ...r }), 0);
  }
});

test("last fall on the grid: thirds from the years in use, the Sep-Oct index of the year before, Jan-Feb and Feb-Mar only", () => {
  const G = O.prepare(fxInput(90));
  const Y = 2000, use = G.years.map((y) => y < Y);
  const tf = O.tiltFor(G, "fall", Y, use, null);
  const v = G.years.filter((y) => y < Y).map((y) => G.X[G.years.indexOf(y)][8]).sort((a, b) => a - b);
  const lo = O.quantile(v, 1 / 3), hi = O.quantile(v, 2 / 3);
  const x = G.X[G.years.indexOf(1999)][8];
  assert.equal(tf.state, x <= lo ? "dry" : x <= hi ? "mid" : "wet");
  const an = tf.opts.analogs[0];
  assert.deepEqual(Array.from(an.intervals), [0, 1]);
  const W = O.weights(G, use, tf.opts);
  G.years.forEach((y, k) => {
    if (y >= Y) { assert.ok(W[k].every((w) => w === 0), `${y} has weight`); return; }
    const match = an.labels[y] === tf.state;
    assert.equal(W[k][0], match ? 2 : 1, String(y));
    assert.equal(W[k][1], match ? 2 : 1, String(y));
    for (let i = 2; i < 11; i++) assert.equal(W[k][i], 1, `${y} interval ${i}`);
  });
});

test("PDO with ENSO and AMO: the readings are the fall before, from the months a buyer had", () => {
  const G = O.prepare(fxInput(90));
  const Y = 1998, use = G.years.map((y) => y < Y);
  const pd = O.tiltFor(G, "pdo-enso", Y, use, CLIMATE);
  const pdo = (CLIMATE.series.pdo.monthly[1997][7] + CLIMATE.series.pdo.monthly[1997][8] + CLIMATE.series.pdo.monthly[1997][9]) / 3;
  assert.equal(pd.state, "el-nino/" + (pdo >= 0 ? "warm" : "cold"));
  const am = O.tiltFor(G, "amo", Y, use, CLIMATE);
  const amo = (CLIMATE.series.amo.monthly[1997][6] + CLIMATE.series.amo.monthly[1997][7] + CLIMATE.series.amo.monthly[1997][8]) / 3;
  assert.equal(am.state, amo >= 0 ? "warm" : "cold");
  assert.equal(O.seasonMean(CLIMATE, "pdo", 2026, [8, 9, 10]), null, "a month not yet posted gives no reading");
});

/* ------------------------------------------------------------ no look-ahead */
const LIMIT = { pdo: 10, amo: 9 };
test("no look-ahead, every predictor: index years before Y only, climate months no later than the sales closing allowed", () => {
  const G = O.prepare(fxInput(90));
  let calls = 0;
  O.walkForward(G, { predictors: RUN, climate: CLIMATE, onTilt: (Y, id, used) => {
    calls++;
    assert.ok(used, `${id} ${Y}: nothing recorded`);
    assert.ok(used.years.length >= 30 && used.years.every((y) => y < Y), `${id} ${Y}: saw ${used.years.filter((y) => y >= Y)}`);
    for (const m of used.climate) {
      const [, name, yy, mm] = m.match(/^(\w+):(\d{4})-(\d{2})$/);
      assert.ok(+yy < Y - 1 || (+yy === Y - 1 && +mm <= LIMIT[name]), `${id} ${Y}: read ${m}`);
    }
    if (id === "pdo-enso" || id === "amo") assert.ok(used.climate.length > 0, `${id} ${Y}: read no climate at all`);
  } });
  assert.equal(calls, 45 * RUN.length);
});

test("no look-ahead, every predictor: rewriting everything a buyer could not have known leaves the pick for Y alone", () => {
  const base = O.walkForward(O.prepare(fxInput(90)), { predictors: RUN, climate: CLIMATE });
  for (const Y of [1981, 1996, 2011, 2025]) {
    const idx = {};
    for (const [y, row] of Object.entries(FX.index)) {
      if (+y >= Y) idx[y] = row.map((v, i) => (v == null ? null : ((v * 7 + i) % 2.5)));
      else idx[y] = row;
    }
    const clim = fakeClimate((s) => {
      for (const [name, lim] of Object.entries(LIMIT)) for (const [yy, r] of Object.entries(s[name].monthly)) {
        for (let m = 0; m < 12; m++) if (+yy > Y - 1 || (+yy === Y - 1 && m + 1 > lim)) r[m] = r[m] == null ? null : -r[m] + 0.77;
      }
    });
    const wf = O.walkForward(O.prepare(fxInput(90, idx)), { predictors: RUN, climate: clim });
    const a = base.rows.find((r) => r.year === Y), b = wf.rows.find((r) => r.year === Y);
    for (const id of RUN) {
      assert.deepEqual(Array.from(b.tiltPick[id]), Array.from(a.tiltPick[id]), `${id} ${Y}: the pick moved when only later data changed`);
      assert.equal(b.tiltState[id], a.tiltState[id], `${id} ${Y}`);
    }
  }
});

test("last fall uses Sep-Oct only: Oct-Nov and Nov-Dec of the year before (not final by Dec 1) do not change its reading", () => {
  const base = O.prepare(fxInput(90));
  for (const Y of [1985, 2003, 2020]) {
    const idx = {};
    for (const [y, row] of Object.entries(FX.index)) idx[y] = +y === Y - 1 ? row.map((v, i) => (i >= 9 && v != null ? 2.4 - v : v)) : row;
    const G = O.prepare(fxInput(90, idx));
    const use = (g) => g.years.map((y) => y < Y);
    assert.equal(O.tiltFor(G, "fall", Y, use(G), null).state, O.tiltFor(base, "fall", Y, use(base), null).state, String(Y));
  }
});

/* ------------------------------------------------------------ missing data */
test("no climate file: PDO and AMO are skipped cleanly, the rest still run", () => {
  assert.match(O.predictorUnavailable("pdo-enso", null), /climate-indices\.json has no PDO/);
  assert.match(O.predictorUnavailable("amo", { series: {} }), /no AMO/);
  assert.equal(O.predictorUnavailable("recent30", null), null);
  assert.equal(O.predictorUnavailable("fall", null), null);
  assert.ok(O.predictorUnavailable("nmme", CLIMATE), "the NMME stub never runs");
  const wf = O.walkForward(O.prepare(fxInput(90)), { predictors: RUN, climate: null });
  assert.deepEqual(Array.from(wf.predictors), ["recent15", "recent30", "last30", "fall"]);
  for (const r of wf.rows) assert.ok(!("pdo-enso" in r.tilt) && !("amo" in r.tilt));
  assert.equal(O.tiltFor(O.prepare(fxInput(90)), "amo", 2000, [], null), null);
});

/* ------------------------------------------------------------ rules and determinism */
test("every tilted pick obeys every rule, at 70% and 90%, in every year of the test", () => {
  let n = 0;
  for (const cov of [70, 90]) {
    const input = fxInput(cov);
    const wf = O.walkForward(O.prepare(input), { predictors: RUN, climate: CLIMATE });
    for (const r of wf.rows) for (const id of RUN) { assertLegal(r.tiltPick[id], input, `${cov} ${r.year} ${id}`); n++; }
  }
  assert.equal(n, 2 * 45 * RUN.length);
  /* and a broader set of real grids, one per state shard */
  const byFips = {};
  for (const s of meta.states) byFips[s.fips] = s.st;
  let grids = 0;
  for (const st of ["TX", "MT", "NE", "CA", "GA", "WI"]) {
    const sd = JSON.parse(readFileSync(ROOT + `data/prf/s/${st}.json`, "utf8"));
    const co = sd.counties[Object.keys(sd.counties).sort()[0]];
    const id = co.g[0], sh = JSON.parse(readFileSync(ROOT + `data/prf/g/${M.shardKey(id)}.json`, "utf8"));
    if (!sh.g[id]) continue;
    const o = M.openGrid(sh.g[id], sh.y0, sh.y1, null);
    const input = { index: o.index, rates: o.rates[90], coverage: 90, subsidy: meta.subsidy["90"], min: co.lim.map((p) => (p ? p[0] : null)),
                    max: co.lim.map((p) => (p ? p[1] : null)), avgMm: o.avgMm, lastComplete: meta.years.last_complete };
    const wf = O.walkForward(O.prepare(input), { predictors: RUN, climate: CLIMATE });
    for (const r of wf.rows) for (const id of RUN) assertLegal(r.tiltPick[id], input, `${st} ${id} ${r.year}`);
    grids++;
  }
  assert.ok(grids >= 5);
});

test("the same inputs give the same answer, in any key order", () => {
  const a = O.walkForward(O.prepare(fxInput(90)), { predictors: RUN, climate: CLIMATE });
  const shuffled = {};
  for (const y of Object.keys(FX.index).reverse()) shuffled[y] = FX.index[y];
  const b = O.walkForward(O.prepare(fxInput(90, shuffled)), { predictors: RUN, climate: CLIMATE });
  const c = O.walkForward(O.prepare(fxInput(90)), { predictors: RUN, climate: CLIMATE });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify(a), JSON.stringify(c));
});

/* ------------------------------------------------------------ the panel's side */
test("only what the published test kept can move the pick", () => {
  assert.deepEqual(Array.from(O.keptPredictors(null)), []);
  assert.deepEqual(Array.from(O.keptPredictors({ predictors: { recent30: { kept: "yes" }, fall: { kept: false }, nmme: { kept: true }, swe: { kept: true } } })), []);
  assert.deepEqual(Array.from(O.keptPredictors({ predictors: { last30: { kept: true } } })), ["last30"]);
  const plain = O.recommend(fxInput(90), { backtest: false });
  assert.equal(plain.forecast, null);
  const r = O.recommend(fxInput(90), { backtest: false, tilts: ["last30"] });
  assert.ok(r.forecast && Array.from(r.forecast.tilts).join() === "last30");
  assertLegal(r.forecast.split, fxInput(90), "kept tilt");
  /* last fall's reading for the coming year is not in the complete years: it says so and moves nothing */
  const f = O.recommend(fxInput(90), { backtest: false, tilts: ["fall"], policyYear: 2027 });
  assert.equal(f.forecast, null);
  assert.ok(/not known yet/.test(f.tiltNotes.join(" ")), f.tiltNotes.join(" "));
  const d = O.recommend(fxInput(90), { backtest: false, tilts: ["last30"], objective: "dry" });
  assert.equal(d.forecast, null, "the tilts were tested on the rate-led pick only");
});

test("data/prf/opt.json: one plain line for every idea, the family stated, and kept only by the rule", () => {
  const d = JSON.parse(readFileSync(ROOT + "data/prf/opt.json", "utf8"));
  assert.equal(d.family.size, O.FAMILY.length);
  assert.deepEqual(d.family.members, Array.from(O.FAMILY));
  for (const id of ["enso", ...O.PREDICTORS.map((p) => p.id)]) {
    const p = d.predictors[id];
    assert.ok(p && typeof p.line === "string" && p.line.length > 20, id);
    assert.ok(!p.line.includes("—") && !/NaN|undefined|null/.test(p.line), `${id}: ${p.line}`);
    if (p.tested) {
      const ok = O.FAMILY_COVERAGES.every((c) => p.byCoverage[c].adj < 0.05 && p.byCoverage[c].meanDiff > 0);
      assert.equal(p.kept, ok, `${id}: kept does not follow the stated rule`);
      for (const c of O.FAMILY_COVERAGES) assert.ok(p.byCoverage[c].adj >= p.byCoverage[c].p - 1e-12, `${id}: adjusted odds below raw`);
    } else assert.equal(p.kept, false, id);
  }
  const climate = existsSync(ROOT + "data/prf/climate-indices.json");
  assert.equal(d.predictors["pdo-enso"].tested, climate, "PDO is tested exactly when the climate file is there");
  assert.equal(d.predictors.fall.tested, true);
  assert.equal(d.predictors.recent15.tested, true);
});

test("scripts/fetch_climate_indices.py passes its own selftest (fixtures, no network)", () => {
  const r = spawnSync("python3", [ROOT + "scripts/fetch_climate_indices.py", "--selftest"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /selftest ok/);
});
