/* /hail-map asked for /data/hail/mesh/today-partial.json and got a 404 (Nov 10, on phone and desktop).
 * The page and the storm replay fetch that file on every load, and the radar job deleted it whenever there
 * was no rolling estimate (no data yet today, or the morning run finished the day). Now the job writes an
 * empty layer instead: the address always answers, and an empty layer reads exactly like "no live layer".
 * Browser run blocks every outside host and service workers (build rule 58).
 *
 *   node --test test/hail-map-partial.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("the radar job never deletes the live layer file", () => {
  const src = readFileSync(join(ROOT, "scripts/fetch_mesh.py"), "utf8");
  assert.doesNotMatch(src, /os\.remove\(/, "a deleted partial answers 404 to every reader");
  assert.match(src, /EMPTY_PARTIAL = \{"type": "FeatureCollection", "features": \[\], "meta": \{"partial": True, "empty": True\}\}/);
});

test("no rolling estimate, or a finished day: the job leaves an empty layer with no time on it", () => {
  const r = spawnSync("python3", ["-I", "-c", `
import sys, os, json, tempfile
sys.path.insert(0, ${JSON.stringify(join(ROOT, "scripts"))})
import fetch_mesh as m
d = tempfile.mkdtemp()
m.OUTDIR = d
m.process_day = lambda dt: None
m.update_index = lambda: None
p = os.path.join(d, "today-partial.json")
m.run_partial()
a = json.load(open(p))
assert a == m.EMPTY_PARTIAL and "as_of" not in a["meta"], a
json.dump({"type": "FeatureCollection", "features": [{"x": 1}], "meta": {"date": "2026-11-09", "as_of": "2026-11-09T21:00:00Z"}}, open(p, "w"))
sys.argv = ["fetch_mesh.py", "2026-11-09"]
m.main()
b = json.load(open(p))
assert b == m.EMPTY_PARTIAL, b
open(p, "w").write("not json")
m.main()
assert json.load(open(p)) == m.EMPTY_PARTIAL
print("ok")
`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /ok/);
});

function serve(hits) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/hail-map") p = "/hail-map.html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { hits.push([404, p]); res.writeHead(404); res.end(); return; }
    hits.push([200, p]);
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("/hail-map with the empty layer: no 404, no script error, no live-layer button", { skip, timeout: 60000 }, async () => {
  const hits = []; const srv = await serve(hits), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const errors = []; pg.on("pageerror", (e) => errors.push(String(e)));
    let asked = 0;
    await pg.route("**/*", (r) => {
      const u = r.request().url();
      if (/\/data\/hail\/mesh\/today-partial\.json/.test(u)) {
        asked++;
        return r.fulfill({ contentType: "application/json", body: JSON.stringify({ type: "FeatureCollection", features: [], meta: { partial: true, empty: true } }) });
      }
      if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
      return r.abort();
    });
    await pg.goto(`http://127.0.0.1:${port}/hail-map`, { waitUntil: "load" });
    await pg.waitForFunction(() => typeof window.L !== "undefined" || document.readyState === "complete", null, { timeout: 15000 });
    await pg.waitForTimeout(2500);
    assert.ok(asked >= 1, "the page asks for the live layer");
    assert.deepEqual(errors, []);
    assert.equal(await pg.$eval("#hm-live24", (b) => b.hidden).catch(() => true), true, "no live layer to show");
    assert.deepEqual(hits.filter(([s, p]) => s === 404 && /^\/data\//.test(p)), [], "no data file answered 404");
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
