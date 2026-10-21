/* /grain-transport, "Grain on the move" (2026-10-21): freight beside basis.
 * Holds the page to its sources (every source the fetcher reads is credited on the
 * page, with a link), to honest wording (correlation, never cause), to working with
 * no keys, to its data budget, and to rendering from fixtures at 390 and 1280 and
 * with every source missing.
 *
 * The browser tests need Playwright and Chromium; they are skipped where missing.
 *   node --test test/grain-transport.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const page = readFileSync(join(ROOT, "grain-transport.html"), "utf8");
const py = readFileSync(join(ROOT, "scripts/fetch_grain_moves.py"), "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const body = page.slice(page.indexOf("<main"), page.indexOf("</main>"));
const srcKeys = [...py.matchAll(/^    "([a-z_]+)": \{"ds": /gm)].map((m) => m[1]);

test("every source the fetcher reads is credited on the page with a link", () => {
  assert.ok(srcKeys.length >= 12, `SRC keys found: ${srcKeys}`);
  const credits = /<ul class="gt-src" id="gt-credits">([\s\S]*?)<\/ul>/.exec(page)[1];
  const covered = new Set([...credits.matchAll(/data-src="([^"]+)"/g)].flatMap((m) => m[1].split(",")));
  for (const k of srcKeys) assert.ok(covered.has(k), `no credit line for source ${k}`);
  for (const who of ["USDA Agricultural Marketing Service", "Army Corps of Engineers", "Surface Transportation Board",
    "Association of American Railroads", "Federal Grain Inspection Service", "U.S. Geological Survey", "AGSIST elevator network"]) {
    assert.ok(credits.includes(who), `credit missing: ${who}`);
  }
  for (const li of credits.split("</li>").filter((x) => x.includes("<li"))) assert.match(li, /<a href="https?:\/\/|<a href="\//, li.slice(0, 80));
  // every dataset id that has its own credit line links to it
  for (const id of ["n4pw-9ygw", "57pa-stwn", "2wy9-nmz4", "tb7q-kn5i", "sruw-w49i", "v85y-3hep"]) assert.ok(credits.includes(`/d/${id}`), id);
});

test("correlation only: the page and the pipeline never say freight caused a basis move", () => {
  const words = body + py.slice(py.indexOf("def verdict"), py.indexOf("def connection")) + py.slice(py.indexOf("def basis_line"), py.indexOf("def answer"));
  assert.doesNotMatch(words, /\b(caused|causes|drove|drives|because of (the )?(freight|barge|rail))\b/i);
  assert.match(body, /Moving together is not the same as one causing the other/);
  assert.match(py, /Moving together is not proof one moved the other/);
  assert.match(py, /MIN_EFF_N = 20/);
  assert.match(py, /Not enough history to say\./);
});

test("works with no keys: no token, key or secret is read or sent", () => {
  assert.doesNotMatch(py, /os\.environ\.get\("[A-Z_]*(KEY|TOKEN|SECRET)/);
  assert.doesNotMatch(py, /X-App-Token|Authorization|api_key|apikey/i);
  assert.doesNotMatch(page, /api[_-]?key|token=/i);
  const wf = readFileSync(join(ROOT, ".github/workflows/transport.yml"), "utf8");
  const step = wf.slice(wf.indexOf("Grain on the move"), wf.indexOf("- name: Commit"));
  assert.match(step, /continue-on-error: true/, "a failed source never blocks the basis files");
  assert.doesNotMatch(step, /secrets\./);
  assert.match(wf, /git add data\/transport\/ grain-transport\.html/);
  assert.match(wf, /cron: '43 11 \* \* 5'/, "rides the existing Friday schedule; no new schedule");
});

test("degraded sources say so on the page", () => {
  assert.match(page, /Not available: /);
  assert.match(page, /could not be read this week/);
  assert.match(page, /could not be read<\/b>/);
  assert.match(page, /The long record could not be built this week/);
  assert.match(page, /A source that could not be read keeps its last good week here, marked old, and says why\./);
});

test("first screen: the answer, the basis line and six numbers, baked for crawlers", () => {
  assert.match(page, /<!--SEED:gtans-->[^<]+<!--\/SEED:gtans-->/);
  assert.match(page, /<!--SEED:gtbasis-->[^<]+<!--\/SEED:gtbasis-->/);
  const now = /<!--SEED:gtnow-->([\s\S]*?)<!--\/SEED:gtnow-->/.exec(page)[1];
  assert.equal((now.match(/class="gt-tile/g) || []).length, 6);
  for (const s of ["barge-st-louis", "railcar-bnsf-shuttle", "railcar-up-shuttle", "locks-lock27", "carorders-all", "ocean-spread"]) assert.ok(now.includes(`data-s="${s}"`), s);
  assert.match(page, /<link rel="canonical" href="https:\/\/agsist\.com\/grain-transport">/);
  assert.match(page, /"jobTitle":"Certified Crop Adviser \(CCA\)"/);
  assert.match(page, /class="by-end"/);
});

test("data budget: data/transport/moves stays under 5 MB, one file per series", () => {
  const d = join(ROOT, "data/transport/moves");
  if (!existsSync(d)) return;
  const files = readdirSync(d);
  const total = files.reduce((a, f) => a + statSync(join(d, f)).size, 0);
  assert.ok(total < 5 * 1024 * 1024, `${total} bytes`);
  assert.match(py, /BUDGET_BYTES = 5 \* 1024 \* 1024/);
});

test("fetch_grain_moves selftest passes (parsers, series math, correlation gate, degraded source)", { timeout: 240000 }, () => {
  const out = execFileSync("python3", ["scripts/fetch_grain_moves.py", "--selftest"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  assert.match(out, /selftest ok/);
});

// The page as a build with no data at all bakes it (the committed page carries the
// last real week, baked by the weekly run), so "every source missing" is tested
// against what a reader would get, not against last week's numbers.
function unbakedPage() {
  const tmp = mkdtempSync(join(tmpdir(), "gt-page-"));
  const f = join(tmp, "grain-transport.html");
  writeFileSync(f, readFileSync(join(ROOT, "grain-transport.html")));
  execFileSync("python3", ["-c", "import sys; sys.path.insert(0, 'scripts'); import fetch_grain_moves as g; g.bake(sys.argv[1], {}, {})", f],
    { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  return f;
}

function serve(movesDir) {
  const page = movesDir ? null : unbakedPage();
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png" };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f;
    if (p.startsWith("/data/transport/moves/")) {
      if (!movesDir) { res.writeHead(404); res.end(); return; }
      f = normalize(join(movesDir, p.slice("/data/transport/moves/".length)));
      if (!f.startsWith(movesDir)) { res.writeHead(404); res.end(); return; }
    } else if (page && p === "/grain-transport.html") f = page;
    else f = normalize(join(ROOT, p));
    if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function open(browser, port, w) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: 900 } });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.goto(`http://127.0.0.1:${port}/grain-transport.html`, { waitUntil: "load" });
  return { pg, errs, ctx };
}

test("renders from fixtures at 390 and 1280: six numbers, charts, the record, no sideways scroll", { skip, timeout: 240000 }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), "gt-"));
  execFileSync("python3", ["scripts/fetch_grain_moves.py", "--fixtures", join(tmp, "moves")], { cwd: ROOT, stdio: "ignore", env: { ...process.env, TMPDIR: tmp } });
  const srv = await serve(join(tmp, "moves")), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const w of [390, 1280]) {
      const { pg, errs, ctx } = await open(browser, port, w);
      await pg.waitForFunction(() => document.querySelectorAll("#gt-conn .gt-panel").length === 2, null, { timeout: 20000 });
      assert.equal(await pg.$$eval("#gt-now .gt-tile:not(.gt-miss)", (x) => x.length), 6, `${w}: six numbers`);
      assert.ok(await pg.$$eval("#gt-charts svg.gt-ch", (x) => x.length) >= 6, `${w}: charts`);
      assert.match(await pg.$eval("#gt-ans", (e) => e.textContent), /River freight is (dearer|cheaper) than normal/);
      assert.match(await pg.$eval("#gt-conn", (e) => e.textContent), /pairs tested in all/);
      assert.match(await pg.$eval("#gt-ours", (e) => e.textContent), /weeks so far/);
      assert.match(await pg.$eval("#gt-credits", (e) => e.textContent), /read Oct/);
      assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${w}: no sideways scroll`);
      assert.deepEqual(errs, []);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); rmSync(tmp, { recursive: true, force: true }); }
});

test("with every source missing the page still reads: dashes with a reason, no errors", { skip, timeout: 60000 }, async () => {
  const srv = await serve(null), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errs } = await open(browser, port, 390);
    await pg.waitForFunction(() => !/Loading/.test(document.getElementById("gt-conn").textContent), null, { timeout: 20000 });
    assert.equal(await pg.$$eval("#gt-now .gt-miss", (x) => x.length), 6);
    assert.match(await pg.$eval("#gt-now", (e) => e.textContent), /Not available: not read yet/);
    assert.match(await pg.$eval("#gt-conn", (e) => e.textContent), /could not be built/);
    assert.deepEqual(errs, []);
  } finally { await browser.close(); srv.close(); }
});
