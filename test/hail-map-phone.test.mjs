/* /hail-map, Oct 16 benchmark fixes.
 *
 *   1. One radius everywhere: the FAQ, the HowTo/FAQ structured data and the note
 *      under the lookup table say the radius the lookup really uses (10 miles by
 *      default, 5 or 25 if picked), and the note follows the picker.
 *   2. Phone: under 480 px each report stacks (date, size, distance, then place),
 *      so all four read at 390 px without a sideways swipe.
 *   3. The automatic radar line says it read the last 30 days, and how many storm
 *      days the archive holds, so "nothing here" is never read as the whole archive.
 *
 * Runs on the shipped data/hail files (Des Moines, the benchmark's case).
 * The browser tests need Playwright and Chromium and skip without them.
 *
 *   node --test test/hail-map-phone.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "hail-map.html", "utf8");

test("no 25-mile claim for the default lookup in the page or its generators", () => {
  assert.doesNotMatch(HTML, /within 25 miles/);
  assert.match(HTML, /within 10 miles over the last five years \(5 or 25 miles if you pick/);
  assert.match(HTML, /var lookupMi = 10;/);
  for (const f of ["scripts/generate_hail_events.py", "scripts/generate_hail_states.py"]) {
    assert.doesNotMatch(readFileSync(ROOT + f, "utf8"), /within 25 miles/, f);
  }
  // The structured data is valid JSON and says 10.
  const blocks = [...HTML.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const all = blocks.map((b) => JSON.stringify(JSON.parse(b))).join(" ");
  assert.match(all, /within 10 miles/);
  assert.doesNotMatch(all, /within 25 miles/);
});

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".geojson": "application/json" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/hail-map") p = "/hail-map.html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function open(browser, port, width) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 844 } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.goto(`http://127.0.0.1:${port}/hail-map?lat=41.5868&lon=-93.625`);
  await pg.waitForFunction(() => document.querySelectorAll("#hm-point-table tbody tr td").length > 3, null, { timeout: 30000 });
  return { pg, errors, ctx };
}

test("at 390 px every report row shows date, size, distance and place inside the screen", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, 390);
    const rows = await pg.$$eval("#hm-point-table tbody tr", (trs) => trs.filter((tr) => tr.cells.length >= 3).slice(0, 10).map((tr) =>
      [...tr.cells].map((c) => { const r = c.getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width, t: c.textContent.trim() }; })));
    assert.ok(rows.length >= 3, "Des Moines has reports");
    for (const cells of rows) {
      for (const c of cells) {
        if (!c.t) continue; // a report with no place name has no place line
        assert.ok(c.w > 0 && c.l >= 0 && c.r <= 390, "cell inside the screen: " + JSON.stringify(c));
      }
      assert.match(cells[1].t, /″|n\/a/);
      assert.match(cells[2].t, / mi$/);
    }
    const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 390, "no sideways page scroll: " + sw);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("desktop keeps the four-column table", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port, 1280);
    const disp = await pg.$eval("#hm-point-table thead", (e) => getComputedStyle(e).position);
    assert.notEqual(disp, "absolute");
    const tops = await pg.$eval("#hm-point-table tbody tr", (tr) => [...tr.cells].map((c) => Math.round(c.getBoundingClientRect().top)));
    assert.equal(new Set(tops).size, 1, "one line per report on desktop");
  } finally { await browser.close(); srv.close(); }
});

test("the note follows the radius picker, and the radar line names its 30-day scope", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port, 1280);
    assert.equal(await pg.$eval("#hm-note-mi", (e) => e.textContent), "10 miles");
    await pg.click('button[data-lr="25"]');
    await pg.waitForFunction(() => document.getElementById("hm-note-mi").textContent === "25 miles");
    // The automatic radar verdict, when it is a "nothing found" line, says 30 days and the archive size.
    await pg.waitForFunction(() => { const v = document.getElementById("hm-verdict"); return v && !v.hidden; }, null, { timeout: 30000 }).catch(() => {});
    const v = await pg.$eval("#hm-verdict", (e) => (e.hidden ? "" : e.textContent));
    if (v && /^No radar-estimated|radar record here stops/.test(v)) {
      assert.match(v, /in the last 30 days/);
      assert.match(v, /The radar archive holds \d+ storm days? back to/);
      assert.doesNotMatch(v, /on file, through/);
    }
  } finally { await browser.close(); srv.close(); }
});
