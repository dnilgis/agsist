/* Field Scout "on and around this field" card (Oct 18, 2026).
 *
 *   node --test test/field-scout-layers.test.mjs
 *
 * The fixtures in test/fixtures/field-layers/ are built by hand in the shape of each
 * service's documented answer (the sandbox cannot reach the services; each file says so
 * in _note). The test field is a 0.0048 x 0.0036 degree square in Story County, Iowa
 * (about 397 x 398 m, 39 acres). Every expected number is worked by hand beside it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const require = createRequire(import.meta.url);
const F = require(join(ROOT, "field-scout-layers.js"));
const fx = (n) => JSON.parse(read("test/fixtures/field-layers/" + n + ".json")).body;

const W = -93.5, E = -93.4952, S = 42.06, N = 42.0636;
const RING = [[W, S], [E, S], [E, N], [W, N], [W, S]];
const C = { lat: 42.0618, lng: -93.4976 };
const PTS = F.gridIn(RING, 400);

test("grid: about 400 points, all inside the field", () => {
  // 397 m x 398 m / 400 points -> 19.9 m spacing -> 20 x 20 = 400
  assert.ok(PTS.length >= 380 && PTS.length <= 420, String(PTS.length));
  assert.ok(PTS.every((p) => p[0] > W && p[0] < E && p[1] > S && p[1] < N));
});

test("point in polygon, with a hole", () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  assert.equal(F.inRings(1, 1, [outer, hole]), true);
  assert.equal(F.inRings(5, 5, [outer, hole]), false);   // inside the hole
  assert.equal(F.inRings(11, 5, [outer, hole]), false);
});

test("flood: share in the 1% zone and in shaded X, panel date", () => {
  const fl = F.floodSummary(fx("nfhl-zones-ia").features, PTS, F.panelOf(fx("nfhl-panel-ia")));
  // AE covers W..-93.4976 = 0.0024 of 0.0048 degrees wide = 50%
  assert.ok(Math.abs(fl.sfhaPct - 50) <= 3, String(fl.sfhaPct));
  // shaded X covers -93.4964..E = 0.0012 / 0.0048 = 25%
  assert.ok(Math.abs(fl.x02Pct - 25) <= 3, String(fl.x02Pct));
  assert.equal(fl.floodwayPct, 0);
  assert.deepEqual(fl.zones, ["AE", "X"]);
  // 1210636800000 ms = 2008-05-13 00:00 UTC
  assert.equal(fl.panelDate, "2008-05-13");
  assert.equal(fl.panel, "19169C0215F");
  const o = F.lines({ flood: fl });
  assert.match(o.flood.v, /^About 5\d% in the 1% flood zone, 2\d% in 0\.2% \(shaded X\)$/);
});

test("flood: no zone and no panel says there is no digital map, not zero", () => {
  const fl = F.floodSummary([], PTS, null);
  assert.equal(fl.mapped, false);
  assert.match(F.lines({ flood: fl }).flood.v, /No digital FEMA flood map/);
  const mapped = F.floodSummary([], PTS, { id: "x", date: "2010-01-01" });
  assert.equal(F.lines({ flood: mapped }).flood.v, "None in the 1% flood zone");
});

test("wetlands: acres by type", () => {
  const w = F.wetSummary(fx("nwi-ia").features, PTS, 40);
  // emergent strip S..42.06036 = 0.00036 / 0.0036 = 10% of 40 ac = 4.0 ac; the riverine polygon sits east of the field
  assert.ok(Math.abs(w.acres - 4) <= 0.5, String(w.acres));
  assert.equal(w.types.length, 1);
  assert.equal(w.types[0].type, "Freshwater Emergent Wetland");
  assert.equal(w.touching, 2);
  assert.match(F.lines({ wet: w }).wet.v, /^About 4(\.\d)? ac mapped \(emergent wetland\)$/);
  assert.equal(F.lines({ wet: F.wetSummary([], PTS, 40) }).wet.v, "None mapped");
});

test("slope: a tilted plane reads its own slope", () => {
  const g = F.slopeGrid(RING, 600);
  const m = { x: 111320 * Math.cos(((S + N) / 2) * Math.PI / 180) };
  // z = 300 m + 3% of meters east -> 3.0% everywhere
  const mk = (pct) => g.pts.map((p, k) => ({ locationId: k, value: String(300 + (p[0] - W) * m.x * pct / 100) }));
  const a = F.slopeStats(g, mk(3));
  assert.equal(a.mean, 3);
  assert.equal(a.over6Pct, 0);
  // fall across the field: 397 m x 3% = 11.9 m = 39 ft (grid points inside sit a half cell in, so 36..40)
  assert.ok(a.hiFt - a.loFt >= 36 && a.hiFt - a.loFt <= 40, String(a.hiFt - a.loFt));
  const b = F.slopeStats(g, mk(8));
  assert.equal(b.mean, 8);
  assert.equal(b.over6Pct, 100);
  // NoData and too few samples: withheld
  assert.equal(F.slopeStats(g, fx("dep-ia")), null);
  assert.equal(F.slopeStats(g, []), null);
});

test("energy: turbines, solar, power lines", () => {
  const w = F.windSummary(fx("wind-ia"), C, 5);
  assert.equal(w.n, 2);              // 1 mi north and 4.9 mi east; the one 6 mi south is out
  assert.equal(w.nearestMi, 1);
  assert.equal(w.projects, 1);
  const s = F.solarSummary(fx("solar-ia"), C, 10);
  assert.equal(s.n, 1);              // 3 mi in, 12 mi out
  assert.equal(s.nearestMi, 3);
  assert.equal(s.nearestMw, 5);
  const g = F.gridSummary(fx("osm-ia"), C, 5);
  assert.deepEqual(g.line, { mi: 0.5, kv: 161 });   // the line 0.5 mi north, highest of 161 and 69 kV
  assert.deepEqual(g.sub, { mi: 2, kv: 69 });
  assert.equal(F.kv("345000;161000"), 345);
  assert.equal(F.kv(""), null);
  assert.equal(F.kv("medium"), null);
  const o = F.lines({ wind: w, solar: s, grid: g });
  assert.equal(o.energy.v, "2 wind turbines within 5 mi, nearest 1 mi · 1 large solar site within 10 mi, nearest 3 mi (5 MW) · power line 0.5 mi (161 kV) · substation 2 mi");
  assert.match(F.overpassQuery(C, 8047), /around:8047,42\.06180,-93\.49760/);
});

test("segment distance", () => {
  // a point 1 mile north of a long east-west segment
  const d = F.segMiles({ lat: 42 + 1 / 69, lng: -93 }, { lat: 42, lng: -94 }, { lat: 42, lng: -92 });
  assert.ok(Math.abs(d - 0.9997) < 0.01, String(d));
});

test("livestock: counts and size class only, never a name", () => {
  const cap = F.capField(fx("feed-meta-ia").fields);
  assert.deepEqual(cap, { name: "TOTAL_AU", au: true });
  assert.equal(F.capField([{ name: "HEAD_COUNT", type: "esriFieldTypeInteger" }]), null);   // head counts get no class
  const f = F.feedSummary(fx("feed-ia").features, cap, C, 3);
  assert.equal(f.n, 4);
  assert.equal(f.nearestMi, 1);
  assert.deepEqual(f.cls, { small: 1, medium: 1, large: 1, unknown: 1 });   // 1200, 500, 120, blank
  const o = F.lines({ feed: f });
  assert.equal(o.feed.v, "4 within 3 mi, nearest 1 mi (1 large, 1 medium, 1 small, 1 size not listed)");
  // the page asks for the id and size fields only
  const src = read("field-scout-layers.js");
  assert.match(src, /outFields: oid \+ \(cap \? ',' \+ cap\.name : ''\)/);
  assert.doesNotMatch(src, /FACILITY_NAME|OWNER|FacName/i);
});

test("easements", () => {
  const e = F.easeSummary(fx("nced-ia").features, PTS, 40);
  // the easement covers 42.0627..N = 0.0009 / 0.0036 = 25% of 40 ac = 10 ac
  assert.ok(Math.abs(e.acres - 10) <= 1, String(e.acres));
  assert.deepEqual(e.holders, ["Federal"]);
  const o = F.lines({ ease: e });
  assert.match(o.ease.v, /^About \d+(\.\d)? ac under a recorded easement \(federal\)$/);
  assert.doesNotMatch(JSON.stringify(o), /SYNTHETIC NAME/);
  assert.equal(F.lines({ ease: F.easeSummary([], PTS, 40) }).ease.v, "None recorded");
});

test("soil: area-weighted from the soil card's rows", () => {
  const s = F.soilSummary({ classes: [
    { ac: 30, nicc: 1, nccpiCorn: 0.8, nccpiSoy: 0.7, csr2: 85, hydric: 0 },
    { ac: 10, nicc: 2, nccpiCorn: 0.6, nccpiSoy: 0.5, csr2: 60, hydric: 100 }] });
  assert.equal(s.nccpiCorn, 0.75);    // (30*0.8 + 10*0.6) / 40
  assert.equal(s.nccpiSoy, 0.65);     // (30*0.7 + 10*0.5) / 40
  assert.equal(s.csr2, 79);           // (30*85 + 10*60) / 40 = 78.75
  assert.equal(s.lccTop, 1);
  assert.equal(s.lccTopPct, 75);
  assert.equal(s.lcc12Pct, 100);
  assert.equal(s.hydricPct, 25);      // 10 of 40 ac all hydric
  assert.equal(F.lines({ soil: s }).soil.v, "NCCPI corn 0.75, soy 0.65 · CSR2 79 · mostly class 1 (100% class 1 to 2) · 25% hydric");
  // CSR2 on under half the acres (outside Iowa): withheld
  const wi = F.soilSummary({ classes: [{ ac: 30, nicc: 2, nccpiCorn: 0.5 }, { ac: 10, nicc: 3, csr2: 40 }] });
  assert.equal(wi.csr2, null);
  assert.equal(F.soilSummary(null), null);
  assert.equal(F.soilSummary({ classes: [{ ac: 0 }] }), null);
});

test("withheld, never guessed: nothing back means no line", () => {
  assert.deepEqual(F.lines({}), {});
  assert.equal(F.lines({ wet: { acres: null, types: [], touching: 0 } }).wet, null);
  assert.equal(F.summary({}), "");
});

test("summary line reads short", () => {
  const o = F.lines({
    soil: { nccpiCorn: 0.75, nccpiSoy: 0.65, csr2: 79, lccTop: 1, lcc12Pct: 100, hydricPct: 25 },
    flood: F.floodSummary([], PTS, { id: "p", date: "2010-01-01" }),
    wet: F.wetSummary(fx("nwi-ia").features, PTS, 40),
    slope: { mean: 2.1, over6Pct: 4, loFt: 1001, hiFt: 1023, spacingFt: 65 },
    feed: { n: 3, nearestMi: 1.2, cls: { small: 0, medium: 0, large: 0, unknown: 3 }, sized: false, within: 3 }
  });
  assert.match(F.summary(o), /^NCCPI corn 0\.75 · no 1% flood zone · 4(\.\d)? ac wetland · 2\.1% slope · 3 feedlots within 3 mi$/);
});

test("page wiring: one hook in field-scout.js, its own file, collapsed card", () => {
  const core = read("field-scout.js");
  assert.match(core, /var FS_LAYERS_SRC='\/field-scout-layers\.js\?v=\d+'/);
  assert.match(core, /fsScript\(FS_LAYERS_SRC, '__fsLayers'\)/);
  assert.match(read("field-scout.html"), /\/field-scout\.js\?v=23"/);
  const src = read("field-scout-layers.js");
  assert.match(src, /G\.__fsLayers = function \(FSX\)/);
  assert.match(src, /<details class="fsl" id="fsl">/);           // closed by default
  assert.doesNotMatch(src, /<details class="fsl"[^>]*\sopen/);
  assert.ok(Buffer.byteLength(src) < 45000, "module stays small");
  // every service over https
  for (const m of src.matchAll(/'(https?:\/\/[^']+)'/g)) assert.match(m[1], /^https:\/\//);
});

test("copy: no em dashes, honest empty states", () => {
  const src = read("field-scout-layers.js");
  assert.doesNotMatch(src, /—|&mdash;/);
  assert.match(src, /The service didn&rsquo;t answer/);
  assert.match(src, /Left blank rather than guessed/);
  assert.match(src, /Not a wetland determination/);
  for (const f of readdirSync(join(ROOT, "test/fixtures/field-layers"))) {
    assert.match(JSON.parse(read("test/fixtures/field-layers/" + f))._note, /Built by hand/, f);
  }
});

test("probe: dispatch only, in land-data.yml", () => {
  const wf = read(".github/workflows/land-data.yml");
  assert.match(wf, /python scripts\/probe_field_layers\.py --selftest/);
  assert.match(wf, /github\.event_name == 'workflow_dispatch' && \(inputs\.task == 'layers' \|\| inputs\.task == 'layers-discover'\)/);
});

// ── the live answers (land-data.yml layers-discover, Oct 18, 2026) ──
// The hand-built fixtures above test the arithmetic; these hold the page to the
// field names and shapes the services really sent back.
const live = (n) => JSON.parse(read("test/fixtures/field-layers-live/" + n + ".json")).body;
const names = (n) => live(n).fields.map((f) => f.name);

test("live: every field the page asks for exists on the service", () => {
  const src = read("field-scout-layers.js");
  for (const f of ["FLD_ZONE", "ZONE_SUBTY", "SFHA_TF"]) assert.ok(names("nfhl-28-meta").includes(f), f);
  for (const f of ["FIRM_PAN", "EFF_DATE"]) assert.ok(names("nfhl-3-meta").includes(f), f);
  for (const f of ["WETLAND_TYPE", "ATTRIBUTE"]) assert.ok(names("nwi-meta").includes(f), f);
  assert.match(src, /'FLD_ZONE,ZONE_SUBTY,SFHA_TF'/);
  assert.match(src, /'WETLAND_TYPE,ATTRIBUTE'/);
  // the active filters name real fields with values the services really use
  assert.ok(names("feed-meta-ia").includes("opStatus"));
  assert.ok(names("feed-meta-mn").includes("status_fdlt"));
  assert.ok(live("feed-ia").features.some((f) => f.attributes.opStatus === "Active"));
  assert.ok(live("feed-mn").features.some((f) => f.attributes.status_fdlt === "active"));
  assert.equal(F.FEEDLOTS.IA.active, "opStatus = 'Active'");
  assert.equal(F.FEEDLOTS.MN.active, "status_fdlt = 'active'");
  assert.match(src, /where: F\.active \|\| '1=1'/);
});

test("live: feedlot size field found in both states", () => {
  assert.deepEqual(F.capField(live("feed-meta-ia").fields), { name: "AnimalUnit", au: true });
  assert.deepEqual(F.capField(live("feed-meta-mn").fields), { name: "au_count", au: true });
  // Minnesota, active only (what the page's where clause asks for): 15 of 18 at the test point
  const pt = { lat: 45.1, lng: -94.9 };
  const act = live("feed-mn").features.filter((f) => f.attributes.status_fdlt === "active");
  assert.equal(act.length, 15);
  const s = F.feedSummary(act, { name: "au_count", au: true }, pt, 3);
  assert.equal(s.n, act.length);
  assert.equal(s.cls.small + s.cls.medium + s.cls.large + s.cls.unknown, s.n);
  assert.ok(s.cls.unknown >= 1);   // blank au_count reads "size not listed", never small
});

test("live: flood zones, panel date, wetlands, slope samples", () => {
  const z = live("nfhl-zones-ia").features.map((f) => f.attributes);
  assert.ok(z.some((a) => a.SFHA_TF === "T" && a.FLD_ZONE === "A"));
  assert.ok(z.some((a) => a.FLD_ZONE === "X" && /0\.2 PCT/i.test(a.ZONE_SUBTY)));
  const p = F.panelOf(live("nfhl-panel-ia"));
  assert.equal(p.id, "19169C0186F");
  assert.ok(p.date && /2021/.test(p.date), String(p.date));   // 1610668800000 = Jan 15, 2021
  assert.deepEqual(live("nwi-ia").features, []);
  for (const s of live("dep-ia").samples) { assert.equal(typeof s.locationId, "number"); assert.ok(isFinite(parseFloat(s.value))); }
});

test("live: wind, solar and power lines read as the page expects", () => {
  const c = { lat: 42.0618, lng: -93.4976 };
  const w = F.windSummary(live("wind-ia"), c, 5);
  assert.ok(w.n >= 1 && w.projects >= 1);
  const s = F.solarSummary(live("solar-ia"), c, 10);
  assert.ok(s.n >= 1 && s.nearestMw > 0);
  const g = F.gridSummary(live("osm-ia"), c, 5);
  assert.ok(g.line && g.line.kv >= 69, JSON.stringify(g));
  assert.ok(g.sub && g.sub.mi <= 5);
  assert.equal(F.URLS.osm.length, 2);   // a second server: the first was full for the WI field
  assert.match(live("osm-wi"), /at capacity/);
});

test("live: easement service wants a token, so the card says so", () => {
  assert.equal(live("nced-ia").error.message, "Token Required");
  assert.equal(F.URLS.nced, null);
  assert.match(read("field-scout-layers.js"), /The national easement map now needs a sign-in/);
});
