/* No Open-Meteo host anywhere the site serves (scripts/no-open-meteo.mjs, 2026-10-29).
 *
 * Sig, Oct 29: no paid Open-Meteo key, and its terms count an ad-supported site as commercial use.
 * This runs the scan over the whole checkout and proves it catches a host planted in each kind of
 * file a browser gets: a root page, a component, a root .js file, a data JSON file, a preconnect.
 *
 *   node --test test/no-open-meteo.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scan, servedText } from "../scripts/no-open-meteo.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

function site(files) {
  const d = mkdtempSync(join(tmpdir(), "nometeo-"));
  for (const [p, t] of Object.entries(files)) {
    const parts = p.split("/"); if (parts.length > 1) mkdirSync(join(d, ...parts.slice(0, -1)), { recursive: true });
    writeFileSync(join(d, p), t);
  }
  return d;
}

test("the site as it stands: every served text file read, no Open-Meteo host outside the recorded examples", () => {
  const r = scan(ROOT);
  assert.ok(r.files > 5000, `read ${r.files} files`);
  assert.deepEqual(r.found, []);
  for (const a of r.allowed) assert.match(a, /^data\/rain-print-examples\//);
  const names = new Set(servedText(ROOT));
  for (const f of ["index.html", "spray.html", "gdu-calculator.html", "embed/gdu.html", "components/geo.js", "components/nws.js", "sw.js", "field-scout.js", "data/fall-nitrogen.json"]) assert.ok(names.has(f), "reads " + f);
});

test("a planted host is caught in a page, a component, a root script, a data file and a preconnect", () => {
  const d = site({
    "spray.html": '<link rel="preconnect" href="https://api.open-meteo.com">',
    "components/x.js": "fetch('https://archive-api.open-meteo.com/v1/archive?latitude=1')",
    "field-scout.js": "var U='https://api.open-meteo.com/v1/forecast';",
    "data/thing.json": '{"src":"https://geocoding-api.open-meteo.com/v1/search"}',
    "data/rain-print-examples/x.json": '{"url":"https://geocoding-api.open-meteo.com/v1/search"}',
    "test/x.test.mjs": "/open-meteo\\.com/",
    "scripts/y.mjs": "'https://open-meteo.com'",
    "about.html": "Open-Meteo, the name alone, is not a call.",
  });
  const r = scan(d);
  assert.deepEqual(r.found.sort(), [
    "components/x.js -> archive-api.open-meteo.com",
    "data/thing.json -> geocoding-api.open-meteo.com",
    "field-scout.js -> api.open-meteo.com",
    "spray.html -> api.open-meteo.com",
  ]);
  assert.equal(r.allowed.length, 1);
});

test("the script runs clean here and its selftest passes", () => {
  const a = spawnSync(process.execPath, [join(ROOT, "scripts/no-open-meteo.mjs")], { encoding: "utf8" });
  assert.equal(a.status, 0, a.stdout + a.stderr);
  const b = spawnSync(process.execPath, [join(ROOT, "scripts/no-open-meteo.mjs"), "--selftest"], { encoding: "utf8" });
  assert.equal(b.status, 0, b.stdout + b.stderr);
});
