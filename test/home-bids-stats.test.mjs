/* Homepage without a location: the "All feeds" counts line reads
 * data/bids-stats.json (under 1 KB), never the 230 KB data/bids.json.
 * scripts/fetch_bids.py writes both on the same run (bids_stats_doc).
 *
 *   node --test test/home-bids-stats.test.mjs
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
const read = (p) => readFileSync(join(ROOT, p), "utf8");

test("the stats file holds the bids file's counts and time, and nothing bulky", () => {
  const s = JSON.parse(read("data/bids-stats.json"));
  assert.equal(s.schema, "agsist-bids-stats/1");
  for (const k of ["total_bids", "facilities", "locations", "states"]) assert.equal(typeof s.stats[k], "number", k);
  assert.ok(!Number.isNaN(Date.parse(s.fetched)));
  assert.ok(statSync(join(ROOT, "data/bids-stats.json")).size < 1024, "bids-stats.json grew past 1 KB");
  assert.equal(s.bids, undefined);
});

test("the writer and the commit step both know the stats file", () => {
  assert.match(read("scripts/fetch_bids.py"), /STATS_PATH = "data\/bids-stats\.json"/);
  assert.match(read("scripts/fetch_bids.py"), /json\.dump\(bids_stats_doc\(output\), f/);
  assert.match(read(".github/workflows/fetch_bids.yml"), /git add data\/bids-stats\.json/);
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

test("no location at 390: the counts line fills from the stats file and data/bids.json is never fetched", { skip }, async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const asked = [];
    await pg.route("**/*", (r) => {
      const u = r.request().url();
      if (!u.startsWith(`http://127.0.0.1:${port}`)) return r.abort();
      asked.push(new URL(u).pathname);
      return r.continue();
    });
    await pg.goto(`http://127.0.0.1:${port}/`);
    await pg.waitForFunction(() => /All feeds: [\d,]+ bids from [\d,]+ locations/.test(document.getElementById("idx1-trust-ledger").textContent), null, { timeout: 15000 });
    await pg.waitForTimeout(1500);
    const s = JSON.parse(read("data/bids-stats.json"));
    assert.match(await pg.textContent("#idx1-trust-ledger"), new RegExp(`All feeds: ${s.stats.total_bids.toLocaleString("en-US")} bids from ${s.stats.locations.toLocaleString("en-US")} locations`));
    assert.ok(asked.includes("/data/bids-stats.json"));
    assert.ok(!asked.includes("/data/bids.json"), "the homepage still fetches data/bids.json with no location");
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("a missing stats file falls back to data/bids.json, so the line never goes blank", { skip }, async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    await pg.route("**/*", (r) => {
      const u = r.request().url();
      if (!u.startsWith(`http://127.0.0.1:${port}`)) return r.abort();
      if (u.endsWith("/data/bids-stats.json")) return r.fulfill({ status: 404, body: "" });
      return r.continue();
    });
    await pg.goto(`http://127.0.0.1:${port}/`);
    await pg.waitForFunction(() => /All feeds: [\d,]+ bids from/.test(document.getElementById("idx1-trust-ledger").textContent), null, { timeout: 15000 });
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
