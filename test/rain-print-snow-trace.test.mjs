/* A trace of snow on the Rain Print (Sig, 2026-10-20: "if a trace of snow falls we should not just
 * dismiss it, especially on the rain print, a trace should somehow show as a trace").
 *
 * NOAA's snowfall "T" (snow fell, under 0.1 in) used to read as 0 and draw nothing. Now the day
 * carries sT, the art marks it above the line on both styles, the foot line keys it, and a measured
 * snow total gets "plus N days with a trace" beside it (never in it). A snowfall trace is kept apart
 * from the gauge's own trace (flag 'T', D.trace).
 *
 * Real days: test/fixtures/snow-trace/days.json, copied from the shipped data/rain/daily files
 * (2026 through Oct 18): Belle Mina AL (Limestone County, only traces: 5 days, two of them with
 * measured rain, 1.42 in on Jan 25) and Grand Forks International Airport ND (24.4 in of snow
 * and 35 trace days, most on days the gauge also read T; its Jun 3 snowfall T, on the year's biggest rain,
 * is a summer trace and is not marked: Sig, 2026-10-20, "skip summer traces").
 *
 *   node --test test/rain-print-snow-trace.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob, Map, Promise };
ctx.window = ctx;
for (const f of ["components/qr.js", "components/rain-print.js", "components/rain-print-art.js", "components/rain-county-print.js"])
  vm.runInNewContext(readFileSync(ROOT + f, "utf8"), ctx);
const RP = ctx.RainPrint, ART = ctx.AgRainArt, RCP = ctx.AgRainCountyPrint;
const FX = JSON.parse(readFileSync(ROOT + "test/fixtures/snow-trace/days.json", "utf8"));
const read = (p) => readFileSync(ROOT + p, "utf8");

const daysOf = (k) => RCP.daysOf(RP, 2026, FX[k]);
function input(days, style, extra = {}) {
  const D = RP.derive(days);
  return Object.assign({ style, year: 2026, place: "Limestone County, Alabama", name: "", dedication: "", days, D, showDry: RP.showDry(D), axisLen: 365,
    ov: null, ovNote: "", showNormals: false, markers: [], records: [], qr: null, preview: { last: days[days.length - 1].date }, gauge: "" }, extra);
}
const texts = (svg) => [...svg.matchAll(/<text[^>]*>((?:[^<]|<\/?tspan[^>]*>)*)<\/text>/g)].map((m) => m[1].replace(/<\/?tspan[^>]*>/g, "").replace(/&amp;/g, "&"));
const strip = (days) => days.map((x) => { const y = Object.assign({}, x); delete y.sT; return y; });
// the flake's three strokes: one path per mark, in the snow ink
const FLAKE = /<path d="(M[\d.]+,[\d.]+L[\d.]+,[\d.]+){3}" fill="none" stroke="#4F7FA6" stroke-width="0.8" stroke-linecap="round"\/>/g;
const flakeCenters = (svg) => [...svg.matchAll(FLAKE)].map((m) => { const n = m[0].match(/[\d.]+/g).map(Number); return { x: (n[0] + n[2]) / 2, y: (n[1] + n[3]) / 2 }; });

test("the engine flags a snowfall T on the day and nowhere else", () => {
  assert.equal(RP.snowTraceRaw("T"), true);
  assert.equal(RP.snowTraceRaw(" T "), true);
  for (const v of ["0.0", "M", "0.1", "S", "", null, undefined]) assert.equal(RP.snowTraceRaw(v), false, String(v));
  const al = daysOf("limestone_al");
  assert.deepEqual([...al.filter((x) => x.sT).map((x) => x.date)], ["2026-01-24", "2026-01-25", "2026-01-26", "2026-02-01", "2026-03-17"]);
  // a snowfall trace counts 0 snow; its day keeps its measured rain (Jan 25: 1.42 in)
  const j25 = al.find((x) => x.date === "2026-01-25");
  assert.equal(j25.s, 0); assert.equal(j25.v, 1.42); assert.equal(j25.flag, "");
  // daily() reads the same: the snow column's T sets sT (the page's own fetch)
  assert.match(read("components/rain-print.js"), /if \(snowTraceRaw\(row\[3\], row\[0\]\)\) dy\.sT = true;/);
});

test("a summer trace (June 1 to August 31, by the day's date) is not marked; May keeps its flakes (Grand Forks ND 2026)", () => {
  // the rule, by date: the last day of May and the first of September are marked, June 1 and August 31 are not
  assert.equal(RP.snowTraceRaw("T", "2026-05-31"), true);
  assert.equal(RP.snowTraceRaw("T", "2026-06-01"), false);
  assert.equal(RP.snowTraceRaw("T", "2026-07-15"), false);
  assert.equal(RP.snowTraceRaw("T", "2026-08-31"), false);
  assert.equal(RP.snowTraceRaw("T", "2026-09-01"), true);
  assert.equal(RP.snowTraceRaw("0.0", "2026-01-10"), false);
  const gf = daysOf("grandforks_nd"), sT = gf.filter((x) => x.sT).map((x) => x.date);
  // Jun 3: NOAA's snowfall T on 1.88 in, the year's biggest rain; most likely hail logged as snow
  const j3 = gf.find((x) => x.date === "2026-06-03");
  assert.equal(j3.v, 1.88); assert.equal(j3.s, 0); assert.ok(!j3.sT, "Jun 3 carries no trace");
  assert.equal(sT.filter((d) => d >= "2026-06-01" && d <= "2026-08-31").length, 0, "no summer trace marked");
  assert.deepEqual([...sT.filter((d) => d.startsWith("2026-05"))], ["2026-05-04", "2026-05-05", "2026-05-06"], "the May days stay as recorded");
  assert.equal(sT.length, 35);
  // the biggest rain is still Jun 3 and no mark is drawn over June to August on either style
  for (const style of ["r1", "r2"]) {
    const E = ART.model(input(gf, style));
    assert.equal(E.wet.date, "2026-06-03");
    assert.ok(E.snowTr.every((i) => gf[i].m < 5 || gf[i].m > 7), style);
  }
  // a measured summer snow amount is not touched: it still counts as snow
  const ms = gf.map((x) => x.date === "2026-06-03" ? Object.assign({}, x, { s: 0.5 }) : x);
  assert.equal(ART.model(input(ms, "r1")).snowTot, ART.model(input(gf, "r1")).snowTot + 0.5);
});

test("a snowfall trace never changes a total: rain, snow, wet days and the gauge's own trace count stay as they were", () => {
  for (const k of ["limestone_al", "grandforks_nd"]) {
    const d = daysOf(k), a = RP.derive(d), b = RP.derive(strip(d));
    for (const f of ["total", "wet", "trace", "snow", "missing"]) assert.equal(a[f], b[f], k + " " + f);
    const ma = ART.model(input(d, "r1")), mb = ART.model(input(strip(d), "r1"));
    assert.equal(ma.snowTot, mb.snowTot, k); assert.equal(ma.snowState, mb.snowState, k); assert.equal(ma.daysText, mb.daysText, k);
  }
  // Grand Forks: the gauge's trace days (D.trace) and the snowfall trace days are two counts
  const gf = daysOf("grandforks_nd");
  assert.equal(ART.model(input(gf, "r1")).snowTr.length, 35);
  assert.notEqual(RP.derive(gf).trace, 35);
});

test("only traces (Limestone County AL): five marks above the line on both styles, the key says how many, no snow total", () => {
  const d = daysOf("limestone_al");
  for (const style of ["r1", "r2"]) {
    const I = input(d, style), E = ART.model(I), svg = ART.render(I), t = texts(svg).join(" | ");
    assert.equal(E.snowState, "none"); assert.equal(E.snowTr.length, 5);
    assert.equal(E.tracePlus, null, "no measured snow, so no 'plus' line");
    assert.match(t, /Trace of snow \(too little to measure\), 5 days/, style);
    assert.doesNotMatch(t, /Snow: |SNOWFALL/, style);
    // five on the chart and one in the key
    const fl = flakeCenters(svg);
    assert.equal(fl.length, 6, style);
    // every chart mark above its line: Staircase over the running total at that day, Roots over the ground
    const chart = fl.filter((p) => p.y < 1000);
    assert.equal(chart.length, 5, style);
    if (style === "r2") chart.forEach((p) => assert.ok(p.y < 478 - 3, "Roots: above the ground line " + p.y));
  }
});

test("Staircase: the mark sits above the step and clear of the next riser (Jan 25, 1.42 in, came the day after a trace)", () => {
  const d = daysOf("limestone_al"), svg = ART.render(input(d, "r1"));
  // the year's line, as drawn: every point of the path
  const path = svg.match(/<path d="(M[^"]+)" fill="none" stroke="#2B5C8A" stroke-width="4.6"/)[1];
  const pts = path.match(/[\d.]+,[\d.]+/g).map((s) => s.split(",").map(Number));
  for (const p of flakeCenters(svg).filter((q) => q.y < 1000)) {
    // the line's highest point within the mark's reach, plus half the stroke and the flake's size, is below the mark
    const near = pts.filter((q) => Math.abs(q[0] - p.x) <= 2.6 + 2.3 + 0.5);
    const top = Math.min(...near.map((q) => q[1]));
    assert.ok(p.y + 2.6 + 2.3 <= top + 0.01, `mark at ${p.x.toFixed(1)} (y ${p.y.toFixed(1)}) clears the line (top ${top.toFixed(1)})`);
  }
});

test("measured snow and traces (Grand Forks ND): total unchanged, 'plus 35 days with a trace' beside it, the key once", () => {
  const d = daysOf("grandforks_nd");
  const r1 = ART.render(input(d, "r1", { place: "Grand Forks County, North Dakota" }));
  const t1 = texts(r1).join(" | ");
  assert.match(t1, /Snow: 24\.4 in, the light blue steps, plus 35 days with a trace/);
  assert.equal((t1.match(/Trace of snow \(too little to measure\)/g) || []).length, 1);
  assert.doesNotMatch(t1, /too little to measure\), \d+ days/, "the count rides on the total when snow was measured");
  const r2 = ART.render(input(d, "r2", { place: "Grand Forks County, North Dakota" }));
  const t2 = texts(r2);
  assert.ok(t2.includes("24.4 in") && t2.includes("plus 35 days with a trace"), "Roots: under the SNOWFALL total");
  assert.equal(flakeCenters(r2).length, 36);
  assert.equal(flakeCenters(r1).length, 36);
});

test("no trace, no mark and no key; a station whose snowfall record has holes marks nothing", () => {
  const d = strip(daysOf("grandforks_nd"));
  for (const style of ["r1", "r2"]) {
    const svg = ART.render(input(d, style));
    assert.equal(flakeCenters(svg).length, 0, style);
    assert.doesNotMatch(texts(svg).join(" "), /Trace of snow|with a trace/, style);
  }
  // holes: 29 days in Feb with no snowfall value -> 'unknown', nothing marked
  const h = daysOf("grandforks_nd").map((x, i) => i > 30 && i < 60 ? Object.assign({}, x, { s: null }) : x);
  const E = ART.model(input(h, "r1"));
  assert.equal(E.snowState, "unknown"); assert.equal(E.snowTr.length, 0); assert.equal(E.traceKey, null);
});

test("the glyph is one constant, kept to the production limits", () => {
  const src = read("components/rain-print-art.js");
  assert.match(src, /var TRACE_MARK = 'flake', TRACE_R = 2\.6;/);
  for (const k of ["flake", "dot", "tick"]) {
    const g = ART.traceMark(100, 100, k), w = [...g.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => +m[1]);
    assert.ok(w.length && w.every((v) => v >= 0.7), k + " lines >= 0.7 u");
  }
  // small: no more than 6 u across on the 1800 u sheet, inside one day's column on Roots
  assert.ok(2 * ART.TRACE_R <= 6);
});

test("the county page's preview reads the same days (rain-county-print.js daysOf carries sT)", () => {
  assert.match(read("components/rain-county-print.js"), /RP\.snowTraceRaw\(s\[i\], iso\)\) dy\.sT = true/);
  assert.match(read("components/rain-county-print.js"), /ENGINE = '\/components\/rain-print\.js\?v=68'/);
  assert.match(read("components/rain-county-print.js"), /rain-print-art\.js\?v=20'/);
  for (const p of ["rain-print.html", "rp-gift.html"]) assert.match(read(p), /rain-print-art\.js\?v=20"/, p);
});
