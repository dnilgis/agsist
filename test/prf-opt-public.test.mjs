/* The public PRF data carries what the panel prints and reads, nothing more.
 *
 *   * no file under data/prf/ names the script or job that wrote it, carries a
 *     written_by key, or lists the forecast model systems and their sources;
 *   * data/prf/opt.json holds only the keys the panel reads (sample, results,
 *     lines, verdicts, the family's two printed numbers), and its writer,
 *     scripts/prf_opt_backtest.mjs, no longer writes the method text, so it
 *     cannot come back on the next run;
 *   * the model inputs (climate indices, seasonal forecasts) are not in the
 *     public tree: the two jobs pull them from the private repo and save them
 *     back there, and commit only opt.json.
 *
 *   node --test test/prf-opt-public.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const gitGrep = (re) => {
  try { return execFileSync("git", ["grep", "-l", "-I", "-E", re, "--", "data/prf"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 }).split("\n").filter(Boolean); }
  catch (e) { if (e.status === 1) return []; throw e; }
};

test("no public file under data/prf/ names its writer or carries a written_by key", () => {
  assert.deepEqual(gitGrep("written_by"), [], "written_by key");
  assert.deepEqual(gitGrep("scripts/[A-Za-z0-9_-]+\\.(py|mjs|js|sh)"), [], "script path");
  assert.deepEqual(gitGrep("\\.github/workflows|[a-z-]+\\.yml"), [], "workflow name");
});

test("no public file under data/prf/ lists the forecast model systems or their sources", () => {
  /* the system identifiers and archive names the forecast fetcher records per model */
  assert.deepEqual(gitGrep("NCEP-CFSv2|GFDL-SPEAR|NASA-GEOSS2S|COLA-RSMAS|CanSIPS-IC4|IRI/LDEO|NMME|Pyleoclim|ersst|psl\\.noaa"), []);
});

test("the model inputs are not published; the jobs keep them private and commit only opt.json", () => {
  for (const f of ["climate-indices.json", "seasonal-fc.json"]) assert.ok(!existsSync(ROOT + "data/prf/" + f), "data/prf/" + f + " is not published");
  assert.ok(/^\/private\/$/m.test(read(".gitignore")), "/private/ stays out of main");
  for (const [wf, own] of [["climate-indices.yml", "climate-indices.json"], ["seasonal-models.yml", "seasonal-fc.json"]]) {
    const y = read(".github/workflows/" + wf);
    /* both inputs pulled (soft) before the fetch and the test; the job's own file saved back */
    for (const f of ["climate-indices.json", "seasonal-fc.json"]) assert.match(y, new RegExp("pull_raw\\.sh private/prf/" + f.replace(".", "\\.")), wf + " pulls " + f);
    assert.match(y, /RAW_BRANCH: private-data/, wf);
    assert.match(y, /RAW_SOFT: '1'/, wf + ": a missing input is skipped, as before");
    assert.match(y, new RegExp("push_raw\\.sh \"[a-z ]+\" private/prf/" + own.replace(".", "\\.")), wf + " saves " + own + " privately");
    assert.ok(y.indexOf("pull_raw.sh private/prf/") < y.indexOf("prf_opt_backtest.mjs"), wf + ": pulled before the test runs");
    const adds = y.split("\n").filter((l) => /git add /.test(l));
    assert.deepEqual(adds.map((l) => l.trim()), ["git add data/prf/opt.json"], wf + " commits only opt.json");
    assert.doesNotMatch(y, /data\/prf\/(climate-indices|seasonal-fc)\.json/, wf + " names no public copy");
  }
  /* the optimizer test and the fetchers read and write the private copies */
  const bt = read("scripts/prf_opt_backtest.mjs");
  assert.match(bt, /"--climate", ROOT \+ "private\/prf\/climate-indices\.json"/);
  assert.match(bt, /"--seasonal", ROOT \+ "private\/prf\/seasonal-fc\.json"/);
  assert.match(read("scripts/fetch_climate_indices.py"), /^OUT = "private\/prf\/climate-indices\.json"/m);
  assert.match(read("scripts/fetch_seasonal_models.py"), /^OUT = os\.path\.join\(ROOT, "private", "prf", "seasonal-fc\.json"\)/m);
});

test("the panel never asks for the model inputs", () => {
  for (const f of ["components/prf-optimize-ui.js", "components/prf-optimize.js"]) {
    const js = read(f);
    assert.doesNotMatch(js, /climate-indices\.json|seasonal-fc\.json/, f);
  }
});

/* every key the panel (components/prf-optimize-ui.js) and the tests read; anything
   else is method text and stays in the code or the run log */
const TOP = ["v", "crop_year", "built_from", "last_complete", "sample", "results", "predictors", "risk", "productivity", "family", "seasonalSkill"];
const PRED = ["name", "kept", "line", "tested", "byCoverage", "structural"];

test("data/prf/opt.json carries only what the panel prints and reads", () => {
  const d = JSON.parse(read("data/prf/opt.json"));
  assert.deepEqual(Object.keys(d).filter((k) => !TOP.includes(k)), [], "top-level keys the panel does not read");
  assert.deepEqual(Object.keys(d.sample).sort(), ["grids", "rule", "states"]);
  assert.deepEqual(Object.keys(d.family).sort(), ["expectedByChanceAt5pct", "size"]);
  assert.deepEqual(Object.keys(d.risk).sort(), ["byCoverage", "held", "line"]);
  for (const [c, r] of Object.entries(d.risk.byCoverage)) assert.ok(!("what" in r.swing), "risk " + c + ": no method text");
  for (const [id, p] of Object.entries(d.predictors)) {
    assert.deepEqual(Object.keys(p).filter((k) => !PRED.includes(k)), [], id);
    assert.doesNotMatch(p.line, /scripts\/|\.json|\.py|\.mjs|workflow|\bjob\b/, id + ": " + p.line);
  }
  /* the strings left are the lines the panel prints, the sample rule and the estimator tags */
  const strs = [];
  (function walk(o, at) {
    if (typeof o === "string") strs.push([at, o]);
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, at + "." + k);
  })(d, "");
  const ok = (at) => /^\.predictors\.[^.]+\.(name|line)$/.test(at) || [".risk.line", ".productivity", ".sample.rule", ".built_from"].includes(at) || /^\.results\.[^.]+\.estimator$/.test(at);
  assert.deepEqual(strs.filter(([at]) => !ok(at)).map(([at]) => at), [], "text the panel does not print");
});

test("the writer no longer writes the method text, so the next run cannot bring it back", () => {
  const bt = read("scripts/prf_opt_backtest.mjs");
  const code = bt.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const re of [/\bwhat:/, /\bcaveats:/, /\boni:/, /\bensoBoost:/, /\bmembers:/, /\badjustment:/, /out\.stationDensity/, /out\.structure/, /out\.climate\b/, /out\.seasonal\b/, /\bwhy,/, /written_by/])
    assert.doesNotMatch(code, re, "prf_opt_backtest.mjs still writes " + re);
  assert.match(code, /out\.family = \{ size: O\.FAMILY\.length, expectedByChanceAt5pct: /);
});
