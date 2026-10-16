/* /harvest-price-tracker#presell (old /presell-calculator), 2026-10-16 (gaps1): the step opened
 * empty until a state was picked. Now a worked example fills it, labeled "Example, not your farm",
 * computed by the page from its own files: Iowa's corn row (data/rma-prices/index.json ref_rows,
 * projected $4.62) and the running harvest average of data/harvest-prices.json (the H1's number).
 *
 * By hand, Oct 16 file: 12 settles averaging 4.905 -> $4.91 (the page rounds to the cent).
 *   200 bu APH x 80% = 160 bu/ac; guarantee 160 x 4.91 = 785.60 -> $786 /ac
 *   sell 160, raise 120: RP pays 785.60 - 120 x 4.91 = 785.60 - 589.20 = 196.40 -> $196 /ac,
 *   and 40 bu are bought back at the cash price; basis is not covered.
 * The test recomputes those from the files on disk, with the clock fixed at Oct 16 (window open).
 * The Acres box is full width on a phone (it was 103 px at 390, placeholder clipped).
 *
 * Needs Playwright and Chromium; skipped where they are missing.
 *   node --test test/harvest-tracker-presell.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

function expected() {
  const idx = JSON.parse(readFileSync(ROOT + "data/rma-prices/index.json", "utf8"));
  const hp = JSON.parse(readFileSync(ROOT + "data/harvest-prices.json", "utf8"));
  const row = idx.ref_rows.find((r) => r.crop === "Corn" && /^all\b/i.test(r.type) && r.practice !== "Organic");
  const w = hp.windows.find((x) => x.crop === "Corn" && x.start === row.h_start && x.end === row.h_end);
  const avg = Math.round(w.series.reduce((t, x) => t + +x.s, 0) / w.series.length * 100 + 1e-7) / 100;
  const p = row.p_price, H = Math.abs(avg - row.h_price) / row.h_price <= 0.03 ? avg : row.h_price;
  const Hc = Math.min(H, 2 * p), price = Hc > p ? Hc : p, gtee = 160 * price, ind = Math.max(0, gtee - 120 * Hc);
  return { gtee: Math.round(gtee), ind: Math.round(ind), price: price.toFixed(2), Hc: Hc.toFixed(2), n: w.series.length };
}

test("landing on #presell with no state: a labeled Iowa example, numbers from the files, by hand", { skip, timeout: 60000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    await pg.clock.setFixedTime(new Date("2026-10-16T17:00:00Z"));
    const errors = [];
    pg.on("pageerror", (e) => errors.push(String(e)));
    await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
    await pg.goto(`http://127.0.0.1:${port}/harvest-price-tracker.html#presell`);
    await pg.waitForSelector("#pd-psex:not([hidden])", { timeout: 15000 });
    const e = expected();
    const txt = await pg.$eval("#pd-psex", (x) => x.textContent.replace(/\s+/g, " "));
    assert.match(txt, /^Example, not your farm/);
    assert.match(txt, /160 bu\/ac/);
    assert.match(txt, /Iowa corn, 200 bu APH, 80% coverage: 200 × 80% = 160 bu an acre/);
    assert.ok(txt.includes(`revenue guarantee of $${e.gtee.toLocaleString("en-US")} /ac (160 × $${e.price}`), txt);
    assert.ok(txt.includes(`Sell 160 ahead and raise 120: RP pays about $${e.ind} /ac ($${e.gtee.toLocaleString("en-US")} minus 120 × $${e.Hc}`), txt);
    assert.match(txt, /you buy back 40 bu at the cash price\. Basis is not covered\./);
    assert.match(txt, new RegExp(`average of ${e.n} of \\d+ trading days through`));
    assert.equal(await pg.$eval("#pd-psbox", (x) => x.hidden), true, "no reader number without a state");
    const w = await pg.$eval("#pd-acres", (x) => x.getBoundingClientRect().width);
    assert.ok(w > 250, `Acres box ${w}px at 390`);
    // pick a state: the reader's own number replaces the example
    await pg.selectOption("#pd-state", "IA");
    await pg.waitForSelector("#pd-psbox:not([hidden])");
    assert.equal(await pg.$eval("#pd-psex", (x) => x.hidden), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
