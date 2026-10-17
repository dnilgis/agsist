/* /harvest-price-tracker#presell short-crop, contract price and season note. Needs Playwright; skipped without it. */
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


/* 2026-10-17 (scorecard presell todo 1-3): the reader's own short-crop line, an optional contract
 * price, and a season note after the harvest window closes. By hand with the Oct 16 file
 * (harvest running $4.91, projected $4.62), Iowa corn, APH 200, 80%:
 *   guarantee 160 x 4.91 = 785.60; raise 120 (60% of APH): 785.60 - 120 x 4.91 = 196.40 -> $196
 *   contract $4.40: 160 x 4.40 = 704 + 196.40 - 40 x 4.91 (196.40) = 704.00 -> $704
 *   typed raise 100: 785.60 - 491.00 = 294.60 -> $295; with contract 704 + 294.60 - 60 x 4.91 (294.60) = $704
 * The test recomputes from the files on disk. */
async function openIA(clock, width) {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 844 } });
  const pg = await ctx.newPage();
  await pg.clock.setFixedTime(new Date(clock));
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.goto(`http://127.0.0.1:${port}/harvest-price-tracker.html#presell`);
  await pg.waitForSelector("#pd-psex:not([hidden])", { timeout: 15000 });
  await pg.selectOption("#pd-state", "IA");
  await pg.waitForSelector("#pd-psbox:not([hidden])");
  await pg.fill("#pd-aph", "200");
  await pg.selectOption("#pd-cov", "0.80");
  return { pg, errors, done: async () => { await browser.close(); srv.close(); } };
}
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");

test("short-crop line and contract price come from the reader's inputs, by RP arithmetic", { skip, timeout: 60000 }, async () => {
  const { pg, errors, done } = await openIA("2026-10-16T17:00:00Z", 390);
  try {
    const e = expected(), H = +e.Hc, gtee = 160 * Math.max(+e.price, H);
    await pg.waitForSelector("#pd-psshort:not([hidden])");
    let t = (await pg.textContent("#pd-psshort")).replace(/\s+/g, " ");
    const ind = Math.max(0, gtee - 120 * H);
    assert.ok(t.includes(`RP pays about ${money(ind)} /ac`), t);
    assert.ok(t.includes(`Sell all 160 bu/ac ahead and raise 120 (60% of your APH)`), t);
    assert.ok(t.includes(`You still owe 40 bu/ac you did not raise`), t);
    assert.match(t, /Basis is not covered/);
    assert.doesNotMatch(t, /With your contract/);
    await pg.fill("#pd-cprice", "4.40");
    t = (await pg.textContent("#pd-psshort")).replace(/\s+/g, " ");
    assert.ok(t.includes(`With your contract at $4.40: about ${money(160 * 4.4 + ind - 40 * H)} /ac`), t);
    await pg.fill("#pd-raise", "100");
    t = (await pg.textContent("#pd-psshort")).replace(/\s+/g, " ");
    const ind2 = Math.max(0, gtee - 100 * H);
    assert.ok(t.includes(`RP pays about ${money(ind2)} /ac`) && t.includes("raise 100:"), t);
    assert.ok(t.includes(`about ${money(160 * 4.4 + ind2 - 60 * H)} /ac`), t);
    await pg.fill("#pd-raise", "170");
    assert.match(await pg.textContent("#pd-psshort"), /No shortfall/);
    assert.equal(await pg.$eval("#pd-psseason", (x) => x.hidden), true, "no season note while the window is open");
    assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal scroll");
    assert.deepEqual(errors, []);
  } finally { await done(); }
});

test("after the harvest window closes, a season note says the next projected price is set in February", { skip, timeout: 60000 }, async () => {
  const { pg, errors, done } = await openIA("2026-11-05T17:00:00Z", 1280);
  try {
    await pg.waitForSelector("#pd-psseason:not([hidden])");
    const t = (await pg.textContent("#pd-psseason")).replace(/\s+/g, " ");
    assert.match(t, /For 2027 crop policies, RMA sets a new projected price from settlements in February 2027/);
    assert.match(t, /the numbers above are 2026/);
    const html = readFileSync(ROOT + "harvest-price-tracker.html", "utf8");
    assert.match(html, /Common Crop Insurance Policy Basic Provisions and the Commodity Exchange Price Provisions/);
    assert.match(html, /75% mark is a common rule of thumb, not an RMA rule/);
    assert.deepEqual(errors, []);
  } finally { await done(); }
});
