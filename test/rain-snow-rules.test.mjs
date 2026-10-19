/* Rain Print snowfall and dry runs on real county days (2026-10-19 audit).
 *
 *   R2: in a year still going, the days after a station's last snowfall value
 *       have not come in yet and do not count against the 10-day snowfall
 *       allowance. Eagle River WI (Vilas County) had 70.0 in of snow and missed
 *       only Mar 9 and Oct 1 to 13, and drew no snow. Every copy of the rule
 *       must agree: rain-print.js derive and snowStateOf, rain-print-art.js
 *       model, and scripts/build_county_rain.py print_snow (its own selftest).
 *   R4: a 0.00A day is a dry day, as derive counts it; the county page's
 *       Python copy (scripts/county_rain.py summarize) now agrees: Allerton IA
 *       (Wayne County), Feb 7 0.00A then 12 days at 0.00, is 13 days.
 *
 * Days: test/fixtures/rain-snow/days.json (copied from data/rain/daily).
 *
 *   R1: the county pick's copy of snowCountry and the snow slack
 *       (scripts/county_rain.py snow_country, snow_limit_mi) answers as
 *       rain-print.js does.
 *
 *   node --test test/rain-snow-rules.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob, Map, Promise };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["components/qr.js", "components/rain-print.js", "components/rain-print-art.js", "components/rain-county-print.js"])
  vm.runInContext(readFileSync(ROOT + f, "utf8"), ctx, { filename: f });
const RP = ctx.RainPrint, ART = ctx.AgRainArt, { daysOf, unpack } = ctx.AgRainCountyPrint;
const FX = JSON.parse(readFileSync(ROOT + "test/fixtures/rain-snow/days.json", "utf8"));
const pack = (a) => a.join(",");
const artState = (days) => {
  const D = RP.derive(days);
  return ART.model({ style: "r1", year: 2026, place: "x", name: "", dedication: "", days, D, showDry: RP.showDry(D), axisLen: 365,
    ov: null, ovNote: "", showNormals: false, markers: [], records: [], qr: null }).snowState;
};

test("Eagle River WI: snowfall not in yet after Oct 1 is not 13 gaps; the snow is drawn in every copy", () => {
  const days = daysOf(RP, 2026, FX.vilas_wi);
  assert.equal(days.length, 286);
  assert.equal(RP.snowCount(days).miss, 1, "only Mar 9 counts");
  assert.equal(RP.derive(days).snow, 70.0);
  assert.equal(RP.snowStateOf(days), "full");
  assert.equal(artState(days), "full");
});

test("a finished year still counts every reported day without a snowfall value", () => {
  const p = unpack(FX.vilas_wi.p), s = unpack(FX.vilas_wi.s), pad = 365 - p.length;
  const days = daysOf(RP, 2026, { p: pack(p.concat(Array(pad).fill("0.00"))), s: pack(s.concat(Array(pad).fill("M"))) });
  assert.equal(days[days.length - 1].date, "2026-12-31");
  assert.equal(RP.derive(days).snow, null);
  assert.equal(RP.snowStateOf(days), "unknown");
  assert.equal(artState(days), "unknown");
});

test("gaps before the last snowfall value still count", () => {
  const s = unpack(FX.vilas_wi.s);
  for (let i = 100; i < 111; i++) s[i] = "M";
  const days = daysOf(RP, 2026, { p: FX.vilas_wi.p, s: pack(s) });
  assert.equal(RP.derive(days).snow, null);
  assert.equal(RP.snowStateOf(days), "unknown");
  assert.equal(artState(days), "unknown");
});

test("a station with no snowfall value at all is still unknown", () => {
  const p = unpack(FX.vilas_wi.p);
  const days = daysOf(RP, 2026, { p: FX.vilas_wi.p, s: pack(p.map(() => "M")) });
  assert.equal(RP.snowStateOf(days), "unknown");
  assert.equal(artState(days), "unknown");
});

test("Ames 1.5 NNE (CoCoRaHS, Story County IA) still has too many snowfall gaps", () => {
  const days = daysOf(RP, 2026, FX.story_ia);
  assert.equal(RP.snowStateOf(days), "unknown");
  assert.equal(RP.derive(days).snow, null);
});

test("Allerton IA: the dry run takes in the Feb 7 0.00A day, 13 days (the page's Python copy agrees, its selftest)", () => {
  const d = RP.derive(daysOf(RP, 2026, FX.wayne_ia));
  assert.equal(d.dryMax.len, 13);
  assert.equal(d.dryMax.end, "2026-02-19");
});

test("county_rain.snow_country and snow_limit_mi answer as rain-print.js snowCountry and snowLimitKm", () => {
  const pts = [];
  for (const state of ["IA", "WI", "FL", "HI", "PR", "TX", "NM", "LA", "GA", "SC", "AL", "MS", "CA", "AZ", "NV", "OK", "NC", "WA"])
    for (const lat of [25, 30.9, 31, 32.5, 33, 36, 45, NaN]) for (const elev of [null, 100, 499, 500, 2999, 3000, 7000]) pts.push({ state, lat, elev });
  const py = JSON.parse(execFileSync("python3", ["-I", "-c", [
    "import json,sys", "sys.path.insert(0, sys.argv[1])", "import county_rain as R",
    "pts = json.loads(sys.argv[2])",
    "print(json.dumps({'c': [R.snow_country(p['state'], p['lat'], p['elev']) for p in pts], 'l': [R.snow_limit_mi(m) for m in (0, 2, 7.8, 10, 25)]}))"
  ].join("\n"), ROOT + "scripts", JSON.stringify(pts.map((p) => ({ ...p, lat: Number.isNaN(p.lat) ? "x" : p.lat })))], { encoding: "utf8" }));
  pts.forEach((p, i) => assert.equal(py.c[i], RP.snowCountry({ state: p.state, lat: p.lat, elev: p.elev }), JSON.stringify(p)));
  [0, 2, 7.8, 10, 25].forEach((m, i) => assert.ok(Math.abs(py.l[i] - RP.snowLimitKm(m / 0.621371) * 0.621371) < 1e-9, "limit at " + m + " mi"));
});
