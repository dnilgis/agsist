/* One elevator count on the home page (Nov 4, 2026, site panel; Nov 2 audit item 22).
 *
 * The real case: home showed "2,109 of 8,052 elevators read directly, updated 1:47 pm" beside "23,273 bids
 * from 2,069 locations, updated 6:22 pm": two counts, two labels, two times for one network. The bids file's
 * location count is the one kept; the other line and its fetch of data/elevator-counts.json are gone.
 * Browser run blocks every outside host and service workers (build rule 58).
 *
 *   node --test test/home-one-count.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");

test("the home page source prints one count: no 'read directly' line and no fetch of the second counts file", () => {
  const s = IDX.indexOf("var el = document.getElementById('idx1-trust-ledger');");
  assert.ok(s > 0);
  const block = IDX.slice(s, IDX.indexOf("</script>", s));
  assert.doesNotMatch(block, /read directly/);
  assert.doesNotMatch(block, /elevator-counts\.json|elevator-coverage/);
  assert.equal((block.match(/bids from '/g) || []).length, 1);
  assert.doesNotMatch(IDX, /r7-cov'/, "the second line's element is not made any more");
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    else if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("home at 390: one elevator count, with one label and one time", { skip }, async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const pg = await ctx.newPage();
    const asked = [];
    pg.on("request", (r) => asked.push(r.url()));
    await pg.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: "domcontentloaded" });
    await pg.waitForFunction(() => /bids from [\d,]+ locations/.test(document.getElementById("idx1-trust-ledger").textContent), null, { timeout: 15000 });
    await pg.waitForTimeout(800);
    const txt = await pg.evaluate(() => document.body.innerText);
    assert.doesNotMatch(txt, /elevators read directly/);
    assert.equal((txt.match(/bids from [\d,]+ locations/g) || []).length, 1);
    assert.equal(await pg.$$eval(".r7-cov", (x) => x.length), 0);
    assert.ok(!asked.some((u) => /elevator-counts\.json|elevator-coverage/.test(u)), "the second counts file is not read");
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
