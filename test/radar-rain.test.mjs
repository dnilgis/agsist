// /rain-radar: the MRMS decoder (Python, on a real cropped NOAA file), the
// state file round trip (Python writes, the browser reader reads), point
// lookup, the gauge comparison, the page's honesty, and the schedule.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const R = require(path.join(ROOT, "components/radar-rain.js"));
const FIX = path.join(ROOT, "test/fixtures/radar-rain");
const page = fs.readFileSync(path.join(ROOT, "rain-radar.html"), "utf8");

function pyHas() {
  try { execFileSync("python3", ["-c", "import numpy, PIL"], { stdio: "ignore" }); return true; } catch (e) { return false; }
}

test("python selftest: GRIB2 decoder on the real crop, encoder, lookup, spike filter", (t) => {
  if (!pyHas()) return t.skip("python3 with numpy and Pillow not available");
  const out = execFileSync("python3", ["scripts/radar_rain.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /radar rain selftest: ok/);
});

test("the browser reader decodes the Python-written file exactly, every window", async () => {
  const exp = JSON.parse(fs.readFileSync(path.join(FIX, "sample.expect.json"), "utf8"));
  const f = await R.parse(fs.readFileSync(path.join(FIX, "sample.bin")));
  assert.equal(f.header.nx, exp.nx);
  assert.equal(f.header.ny, exp.ny);
  const ids = f.header.windows.map((w) => w.id);
  assert.deepEqual(ids, ["24h", "3d", "7d", "month"]);
  assert.ok(f.header.windows.some((w) => w.t === "i4"), "fixture exercises a wide residual");
  for (const id of ids) assert.deepEqual(Array.from(f.grids[id]), exp.grids[id], id);
});

test("the Python writer and the browser reader agree on a fresh file", async (t) => {
  if (!pyHas()) return t.skip("python3 with numpy and Pillow not available");
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "rr-"));
  const bin = path.join(tmp, "x.bin");
  const py = `
import sys, json, numpy as np
sys.path.insert(0, 'scripts'); import radar_rain as R
rng = np.random.default_rng(3)
a = rng.integers(-1, 400, size=(41, 67)).astype(np.int16)
b = np.where(a < 0, -1, a + rng.integers(0, 90, size=a.shape)).astype(np.int16)
R.write_bin(sys.argv[1], {"x0": -95.0, "y0": 43.0, "d": 0.02, "nx": 67, "ny": 41, "gauges": []}, [({"id": "24h"}, a), ({"id": "3d"}, b)])
print(json.dumps({"a": a.ravel().tolist(), "b": b.ravel().tolist(), "pt": int(a[10, 20])}))`;
  const exp = JSON.parse(execFileSync("python3", ["-c", py, bin], { cwd: ROOT, encoding: "utf8" }));
  const f = await R.parse(fs.readFileSync(bin));
  assert.deepEqual(Array.from(f.grids["24h"]), exp.a);
  assert.deepEqual(Array.from(f.grids["3d"]), exp.b);
  const v = R.lookup(f.header, f.grids["24h"], 43.0 - 10 * 0.02, -95.0 + 20 * 0.02);
  assert.equal(v, exp.pt < 0 ? null : exp.pt);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("point lookup: nearest cell, no data and outside give null", async () => {
  const exp = JSON.parse(fs.readFileSync(path.join(FIX, "sample.expect.json"), "utf8"));
  const f = await R.parse(fs.readFileSync(path.join(FIX, "sample.bin")));
  for (const [lat, lon, v] of exp.points) {
    assert.equal(R.lookup(f.header, f.grids["24h"], lat, lon), v < 0 ? null : v);
    assert.equal(R.lookup(f.header, f.grids["24h"], lat + 0.0099, lon - 0.0099), v < 0 ? null : v, "rounds to the nearest cell");
  }
  assert.equal(R.lookup(f.header, f.grids["24h"], 50, -66), null);
  assert.equal(R.lookup(f.header, f.grids["24h"], 33.5, -10), null);
});

test("a damaged file is refused, not misread", async () => {
  const b = Buffer.from(fs.readFileSync(path.join(FIX, "sample.bin")));
  b[0] = 0x58;
  await assert.rejects(R.parse(b), /bad-file/);
  const c = Buffer.from(fs.readFileSync(path.join(FIX, "sample.bin"))).subarray(0, 300);
  await assert.rejects(R.parse(c));
});

test("gauge week: sums 7 clean days, refuses a week with a missed day", () => {
  const g = { dates: ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8"], gauge: [5, 0, 10, 20, 0, 0, 30, 40], radar: [9, 1, 12, 15, 0, 2, 25, 44] };
  const w = R.gaugeWeek(g, 7);
  assert.deepEqual(w, { from: "d2", to: "d8", days: 7, gauge: 100, radar: 99 });
  assert.equal(R.gaugeWeek({ ...g, gauge: [5, 0, 10, null, 0, 0, 30, 40] }, 7), null);
  assert.equal(R.gaugeWeek({ dates: ["a"], gauge: [1], radar: [1] }, 7), null);
  assert.ok(Math.abs(R.miles(42, -93, 43, -93) - 69.1) < 0.3, "a degree of latitude is about 69 miles");
});

test("state pick: the box the point sits deepest in; outside the lower 48 is null", () => {
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "data/radar-rain/index.json"), "utf8"));
  assert.ok(Object.keys(idx.states).length >= 49, "every lower-48 state and DC");
  assert.equal(R.pickState(idx, 42.03, -93.62), "IA");
  assert.equal(R.pickState(idx, 31.0, -99.5), "TX");
  assert.equal(R.pickState(idx, 61.2, -149.9), null);
  assert.equal(R.pickState(idx, 21.3, -157.8), null);
});

test("published state files decode and cover the point they claim", async () => {
  const f = await R.parse(fs.readFileSync(path.join(ROOT, "data/radar-rain/ia.bin")));
  const h = f.header;
  assert.equal(h.st, "IA");
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, "data/radar-rain/validation.json"), "utf8"));
  assert.equal(h.d, 0.04, "the grid Sig chose (Oct 17): 0.04 degree");
  assert.equal(v.grid_deg, h.d, "the page's accuracy numbers were measured on the grid it ships");
  assert.ok(h.windows.some((w) => w.id === "24h"));
  for (const w of h.windows) {
    const q = f.grids[w.id];
    assert.equal(q.length, h.nx * h.ny);
    let mn = Infinity, mx = -Infinity;
    for (const v of q) { if (v < mn) mn = v; if (v > mx) mx = v; }
    assert.ok(mn >= -1 && mx < 6000, `${w.id} values in range (${mn}..${mx})`);
  }
  assert.notEqual(R.lookup(h, f.grids["24h"], 42.03, -93.62), undefined);
});

test("page: one shared page, honest label, the measured numbers, FAQ in structured data", () => {
  assert.match(page, /<title>[^<]*rain[^<]*<\/title>/i);
  assert.match(page, /<link rel="canonical"\s+href="https:\/\/agsist\.com\/rain-radar">/);
  assert.ok(page.includes("NOAA radar and gauge estimate (MRMS), not a rain gauge reading."));
  assert.ok(!/—/.test(page), "no em dashes");
  assert.ok(!/noindex/.test(page));
  assert.ok(page.includes('id="rr-stale"') && page.includes('id="rr-status"') && page.includes('id="rr-locbox"'), "stale, status and location states exist");
  assert.ok(page.includes("Sigurd Lindquist, CCA"));
  // every number in "How close" is the measured one in data/radar-rain/validation.json
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, "data/radar-rain/validation.json"), "utf8"));
  const fmt = (n) => n.toLocaleString("en-US");
  assert.ok(page.includes(fmt(v.stations) + " NOAA co-op rain gauges in " + v.states + " states"));
  assert.ok(page.includes("(" + fmt(v.gauge_days) + " gauge-days)"));
  assert.ok(page.includes("(" + fmt(v.wet_days.n) + " of them)"));
  assert.ok(page.includes("median " + v.wet_days.median_abs_in.toFixed(2) + " in apart"));
  assert.ok(page.includes(Math.abs(v.wet_days.mean_bias_in).toFixed(2) + " in under on average") && v.wet_days.mean_bias_in < 0);
  assert.ok(page.includes("(" + fmt(v.heavy_days.n) + ")") && page.includes(v.heavy_days.median_abs_in.toFixed(2) + " in, or " + v.heavy_days.median_abs_pct + "%"));
  assert.ok(page.includes("about " + Math.round((1 - v.heavy_days.median_radar_over_gauge) * 100) + "% under the gauge"));
  assert.ok(page.includes("the " + v.period_totals.n + " gauges") && page.includes(v.period_totals.median_abs_in.toFixed(2) + " in (" + v.period_totals.median_abs_pct + "%)"));
  assert.ok(page.includes("1 wet day in " + Math.round(1 / v.wet_days.radar_wet_gauge_dry_share)));
  assert.ok(page.includes("1 in " + Math.round(1 / v.wet_days.gauge_wet_radar_zero_share) + " the other way"));
  // structured data parses and the FAQ matches what is on the page
  const blocks = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const faq = blocks.flatMap((b) => b["@graph"] || [b]).find((x) => x["@type"] === "FAQPage");
  const shown = [...page.matchAll(/<details><summary>(.*?)<\/summary>/g)].map((m) => m[1].replace(/&rsquo;/g, "’"));
  assert.deepEqual(faq.mainEntity.map((q) => q.name), shown);
  assert.ok(page.includes("/components/radar-rain.js") && page.includes("/components/radar-rain-page.js"));
});

test("schedule: four runs a day off the hour, approved, never overlapping", () => {
  const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/radar-rain.yml"), "utf8");
  const crons = [...wf.matchAll(/cron:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(crons, ["17 1,7,13,19 * * *"]);
  assert.match(wf, /Sig approved Oct 17, 2026/);
  assert.match(wf, /concurrency:\s*\n\s*group: radar-rain\s*\n\s*cancel-in-progress: false/);
  assert.match(wf, /git diff --staged --quiet/);
});

test("a real map under the rain: USGS National Map only, credited, with a fallback", () => {
  const js = fs.readFileSync(path.join(ROOT, "components/radar-rain-page.js"), "utf8");
  // public domain, keyless USGS tiles, both views
  assert.ok(js.includes("https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}"));
  assert.ok(js.includes("https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}"));
  assert.doesNotMatch(js + page, /cartocdn|tile\.openstreetmap|api\.mapbox|maptiler|stadiamaps|arcgisonline/i);
  // credited in small type by the map and in the sources line
  assert.match(page, /class="rr-credit">Map: USGS The National Map</);
  assert.match(page, /Map: USGS The National Map \(map services and data from the U\.S\. Geological Survey, National Geospatial Program\)/);
  assert.match(js, /Map: USGS/);
  // the toggle and the note shown when tiles fail
  assert.match(page, /id="rr-base"[^>]*>[\s\S]*?data-base="topo"[\s\S]*?data-base="aerial"/);
  assert.match(page, /id="rr-basenote"/);
  assert.match(js, /tileerror[\s\S]*?setTimeout[\s\S]*?did not load/);
  // the rain still draws over the site's own outline and keeps the field pin
  assert.match(js, /\/data\/us-states\.geo\.json/);
  assert.match(js, /circleMarker\(\[pt\.lat, pt\.lon\]/);
  assert.ok(page.includes("/components/radar-rain-page.js?v=4"));
});
