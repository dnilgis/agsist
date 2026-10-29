/* No rented base map anywhere on the site (scripts/basemap-checks.mjs).
 *
 * Until 2026-10-29 that script ran nowhere (no checks.sh line, no test) and read only root
 * .html pages and components/*.js, so Field Scout's Esri World Imagery and CARTO dark_all
 * URLs in the root field-scout.js were never seen. This runs the script as part of the node
 * suite and proves it now catches a vendor URL planted in a root field-scout file.
 *
 *   node --test test/basemap-checks.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scanSite, servedFiles, tileAllowed } from "../scripts/basemap-checks.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

// the two lines Field Scout shipped until Oct 29, 2026, as they were
const ESRI = "satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom:19 });";
const CARTO = "mapLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom:19 });";
const USGS = "L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', {});";

function site(files) {
  const d = mkdtempSync(join(tmpdir(), "basemap-"));
  for (const [p, t] of Object.entries(files)) {
    const parts = p.split("/"); if (parts.length > 1) mkdirSync(join(d, ...parts.slice(0, -1)), { recursive: true });
    writeFileSync(join(d, p), t);
  }
  return d;
}

test("the site as it stands: every served file read, no rented tile host, every template USGS or NOAA radar", () => {
  const r = scanSite(ROOT);
  assert.ok(r.files > 1000, `read ${r.files} files`);
  assert.deepEqual(r.vendors, []);
  assert.deepEqual(r.templates, []);
  const names = new Set(servedFiles(ROOT));
  for (const f of ["field-scout.js", "field-scout-read.js", "field-scout-land.js", "field-scout-layers.js", "field-scout-extras.js", "components/radar-rain-page.js", "rain-radar.html", "field-scout.html"])
    assert.ok(names.has(f), f + " is scanned");
  assert.ok(r.okTemplates.some((x) => x.startsWith("field-scout.js -> https://basemap.nationalmap.gov/") && x.includes("USGSImageryOnly")), "Field Scout satellite is USGS");
  assert.ok(r.okTemplates.some((x) => x.startsWith("field-scout.js -> https://basemap.nationalmap.gov/") && x.includes("USGSTopo")), "Field Scout map is USGS");
});

test("a planted Esri URL in a root field-scout file is caught, and so is the old CARTO line", () => {
  const d = site({ "field-scout-planted.js": ESRI, "field-scout.js": CARTO, "ok.js": USGS, "index.html": "<p>hi</p>" });
  try {
    const r = scanSite(d);
    assert.ok(r.vendors.some((v) => v.startsWith("field-scout-planted.js -> ") && /arcgisonline/.test(v)), JSON.stringify(r.vendors));
    assert.ok(r.vendors.some((v) => v.startsWith("field-scout.js -> ") && /cartocdn/.test(v)));
    assert.ok(r.templates.some((v) => v.startsWith("field-scout-planted.js -> ")));
    assert.ok(!r.vendors.some((v) => v.startsWith("ok.js")));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("Esri or CARTO named in a nested page or a stylesheet is caught too; tests and scripts are not scanned", () => {
  const d = site({ "cash-bids/x/y.html": "<img src='https://services.arcgisonline.com/x'>", "css/a.css": "a{background:url(https://a.basemaps.cartocdn.com/q.png)}",
    "test/fixture.mjs": ESRI, "scripts/probe.mjs": CARTO, "data/a.json": ESRI });
  try {
    const r = scanSite(d);
    assert.ok(r.vendors.some((v) => v.startsWith("cash-bids/x/y.html")));
    assert.ok(r.vendors.some((v) => v.startsWith("css/a.css")));
    assert.ok(!r.vendors.some((v) => /^(test|scripts|data)\//.test(v)));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("USGS with a key, Esri, CARTO are refused; USGS Topo and Imagery Only are allowed", () => {
  assert.equal(tileAllowed("https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}"), true);
  assert.equal(tileAllowed("https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"), true);
  assert.equal(tileAllowed("https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}?token=x"), false);
  assert.equal(tileAllowed("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"), false);
  assert.equal(tileAllowed("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"), false);
});

test("the script passes on the site and its selftest passes", () => {
  const a = spawnSync(process.execPath, [join(ROOT, "scripts/basemap-checks.mjs")], { encoding: "utf8" });
  assert.equal(a.status, 0, a.stdout + a.stderr);
  assert.match(a.stdout, /0 failed/);
  const b = spawnSync(process.execPath, [join(ROOT, "scripts/basemap-checks.mjs"), "--selftest"], { encoding: "utf8" });
  assert.equal(b.status, 0, b.stdout + b.stderr);
  assert.match(b.stdout, /selftest passed/);
});
