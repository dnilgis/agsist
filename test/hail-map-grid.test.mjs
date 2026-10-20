/* /hail-map opens on one file, not five (2026-10-20).
 *
 *   "All 5 years" used to fetch every year file (about 330 KB gzipped) before
 *   the first heat paint on a phone. It now paints from data/hail/all-grid.json,
 *   the same reports summed into 0.1 degree bins at their weighted centre
 *   (scripts/fetch_hail.py write_grid). A year file is fetched only when the
 *   reader picks that year, presses play, or zooms the all-years view past 5,
 *   and each one only once.
 *
 *   Since the same day the bare page opens on the last 24 hours
 *   (test/hail-map-now.test.mjs), so this opens the 5-year view by name,
 *   ?view=all, which is the same first paint a reader gets one tap later.
 *
 *   node --test test/hail-map-grid.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "hail-map.html", "utf8");
const MAN = JSON.parse(readFileSync(ROOT + "data/hail/manifest.json", "utf8"));
const GRID = JSON.parse(readFileSync(ROOT + "data/hail/all-grid.json", "utf8"));

test("the shipped grid holds every report of every manifest year, weight for weight", () => {
  assert.deepEqual(GRID.years, MAN.years, "grid years match the manifest");
  let n = 0, w = 0;
  for (const y of MAN.years) {
    const d = JSON.parse(readFileSync(ROOT + `data/hail/${y}.json`, "utf8"));
    n += d.points.length; for (const p of d.points) w += p[2];
  }
  assert.equal(GRID.count, n, "count is the sum of the year files");
  const gw = GRID.points.reduce((s, p) => s + p[2], 0);
  assert.ok(Math.abs(gw - w) < GRID.points.length * 0.005 + 1e-6, `weights ${gw} vs ${w}`);
  assert.ok(GRID.points.length < n, "binned");
  // gzip size is what a phone pays; keep the opening file well under the 150 KB first-view goal
  const gz = execFileSync("gzip", ["-6c", ROOT + "data/hail/all-grid.json"]).length;
  assert.ok(gz < 140 * 1024, `all-grid.json gzipped ${gz} bytes`);
});

test("grid_points: a bin sits at its weighted centre with the summed weight", () => {
  const out = execFileSync("python3", ["-I", "-c",
    "import sys,json; sys.path.insert(0, sys.argv[1]); import fetch_hail as f;" +
    "print(json.dumps(f.grid_points([[[40.01,-95.02,1.0],[40.05,-95.06,3.0]],[[41.55,-93.62,0.3]]])))",
    ROOT + "scripts"], { encoding: "utf8" });
  const g = JSON.parse(out);
  assert.equal(g.length, 2);
  assert.deepEqual(g.find((p) => p[0] < 41), [40.04, -95.05, 4.0]);
  assert.deepEqual(g.find((p) => p[0] > 41), [41.55, -93.62, 0.3]);
});

test("the monthly rebuild writes the grid after the year files", () => {
  const py = readFileSync(ROOT + "scripts/fetch_hail.py", "utf8");
  const main = py.slice(py.indexOf("def main():"));
  assert.ok(main.indexOf("write_grid(years)") > main.indexOf('"%s/%d.json" % (OUT_DIR, y), "w"'), "grid follows the year files");
  assert.match(HTML, /fetch\(DATA\+'all-grid\.json'\)/);
  assert.match(HTML, /String\(g\.years\)===String\(manifest\.years\)/, "a stale grid falls back to the year files");
});

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve(hits) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    hits.push(p);
    if (p === "/hail-map") p = "/hail-map.html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
const yearHits = (hits) => hits.filter((p) => /^\/data\/hail\/\d{4}\.json$/.test(p));
const count = () => document.getElementById("hm-count").textContent;

test("first load fetches only the grid; a picked year is fetched once; zooming in loads the years once", { skip }, async () => {
  const hits = [];
  const srv = await serve(hits), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const errors = []; pg.on("pageerror", (e) => errors.push(String(e)));
    await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
    await pg.goto(`http://127.0.0.1:${port}/hail-map?view=all`);
    await pg.waitForFunction((c) => document.getElementById("hm-count").textContent === c, GRID.count.toLocaleString("en-US"), { timeout: 30000 });
    await pg.waitForTimeout(1500);
    assert.deepEqual(yearHits(hits), [], "no year file on first load");
    assert.equal(hits.filter((p) => p === "/data/hail/all-grid.json").length, 1);
    assert.ok(!hits.some((p) => /events-\d{4}\.json$/.test(p)), "no lookup files on first load");
    assert.match(await pg.textContent("#hm-scope"), /across 5 years/);
    assert.match(await pg.textContent("#hm-yearbadge"), /5-Year/);

    const y = String(MAN.years[1]);
    const want = MAN.counts[y].toLocaleString("en-US");
    await pg.click(`#hm-controls [data-key="${y}"]`);
    await pg.waitForFunction((c) => document.getElementById("hm-count").textContent === c, want, { timeout: 30000 });
    await pg.click('#hm-controls [data-key="all"]');
    await pg.waitForFunction((c) => document.getElementById("hm-count").textContent === c, GRID.count.toLocaleString("en-US"));
    await pg.click(`#hm-controls [data-key="${y}"]`);
    await pg.waitForFunction((c) => document.getElementById("hm-count").textContent === c, want);
    assert.deepEqual(yearHits(hits), [`/data/hail/${y}.json`], "the picked year, once");

    // back to all years and zoom in past 5: the real year files, each once
    await pg.click('#hm-controls [data-key="all"]');
    for (let i = 0; i < 4; i++) { await pg.click(".leaflet-control-zoom-in"); await pg.waitForTimeout(500); }
    await pg.waitForFunction((n) => [...performance.getEntriesByType("resource")].filter((e) => /\/data\/hail\/\d{4}\.json$/.test(e.name)).length >= n, MAN.years.length, { timeout: 30000 });
    await pg.waitForTimeout(800);
    const yh = yearHits(hits);
    assert.equal(yh.length, MAN.years.length, "each year once: " + yh.join(","));
    assert.equal(new Set(yh).size, MAN.years.length);
    assert.equal(await pg.evaluate(count), GRID.count.toLocaleString("en-US"), "same count from the year files");
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
