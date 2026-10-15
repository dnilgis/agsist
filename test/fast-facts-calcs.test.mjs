/* /fast-facts calculators in a real browser, checked against hand math.
 *
 *   Lime cost: the dealer quote in data/fertilizer.json is pelletized lime
 *   (SuperCal 98G). The page used to multiply tons of ordinary 75% aglime by
 *   that price: SMP 6.5 to pH 6.8 is 1.7 t CaCO3 = 2.3 t of 75% aglime, and it
 *   printed "$646/ac at $285/ton pelletized". The pelletized price now only
 *   prices the 98% pelletized option; aglime is priced only at the reader's
 *   own $/ton.
 *
 * Needs Playwright and Chromium; skipped where they are missing.
 *
 *   node --test test/fast-facts-calcs.test.mjs
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

const FERT = {
  updated: "2026-09-01",
  prices: [
    { name: "Urea", symbol: "46-0-0", price: 590, as_of: "2026-09-01" },
    { name: "Pell Lime", symbol: "SuperCal 98G", price: 285, as_of: "2026-07-20" },
  ],
};

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/fast-facts") p = "/fast-facts.html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, port, path, opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", async (r) => {
    const u = r.request().url();
    if (u.includes("/data/fertilizer.json")) {
      if (opts.fertDelay) await new Promise((ok) => setTimeout(ok, opts.fertDelay));
      return r.fulfill({ contentType: "application/json", body: JSON.stringify(opts.fert || FERT) });
    }
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}${path}`);
  return { pg, errors, ctx };
}
const cost = (pg) => pg.textContent("#lime-cost");

test("lime cost never prices aglime at the pelletized lime quote", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, "/fast-facts#soilhealth");
    await pg.waitForFunction(() => document.querySelector(".fert-pill"));
    // Default: SMP 6.5 -> pH 6.8 is 1.7 t CaCO3; at 75% CCE that is 1.7/0.75 = 2.27 t aglime.
    assert.equal(await pg.textContent("#lime-pure"), "1.7 ton");
    assert.equal(await pg.textContent("#lime-ag"), "2.3 ton");
    const c0 = await cost(pg);
    assert.ok(!/\$\d/.test(c0), "no dollar figure for aglime without the reader's price: " + c0);
    assert.ok(!/pelletized/.test(c0), c0);
    assert.equal(c0, "Type your $/ton to see cost");
    // Reader types $40/ton spread: 2.2667 t x $40 = $90.67 -> $91/ac.
    await pg.fill("#lime-price", "40");
    assert.equal(await cost(pg), "$91/ac at your $40/ton");
    // 90% CCE: 1.7/0.90 = 1.889 t x $40 = $75.56 -> $76.
    await pg.selectOption("#lime-cce", "90");
    assert.equal(await cost(pg), "$76/ac at your $40/ton");
    // 98% pelletized with no price typed uses the dated pelletized quote:
    // 1.7/0.98 = 1.7347 t x $285 = $494.39 -> $494.
    await pg.fill("#lime-price", "");
    await pg.selectOption("#lime-cce", "98");
    assert.equal(await cost(pg), "$494/ac at $285/ton pelletized, dealer quote Jul 20, 2026");
    // Back to 60% aglime: the pelletized price must not come back.
    await pg.selectOption("#lime-cce", "60");
    assert.equal(await cost(pg), "Type your $/ton to see cost");
    // No lime needed.
    await pg.fill("#lime-buf", "6.8");
    assert.equal(await cost(pg), "None needed");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

/* N:Corn ratio: the urea auto-fill wrote the dealer price into the box but did
 * not redraw, so when the fertilizer sheet landed after the first draw the
 * result kept the 560 default ($0.61/lb N). Hand math at $590 urea:
 * 590 / (2000 x 0.46) = $0.641/lb N; at $4.25 corn the ratio is 0.151. */
test("N:corn ratio redraws when the urea price fills the box, even when the sheet arrives late", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, "/fast-facts#nitrogen", { fertDelay: 1500 });
    await pg.waitForFunction(() => document.querySelector(".fert-pill"), null, { timeout: 15000 });
    assert.equal(await pg.inputValue("#nc-fertprice"), "590");
    assert.equal(await pg.textContent("#nc-nlb"), "$0.64");
    const corn = parseFloat(await pg.inputValue("#nc-corn"));
    const want = (590 / 920 / corn).toFixed(3);
    assert.equal(await pg.textContent("#nc-ratio"), want);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

/* Small wrong words from the Oct 15 review. Futures here are delayed quotes,
 * never "live"; Sonalan is ethalfluralin, not trifluralin; a fertilizer row
 * quoted on another day than the sheet carries its own date. */
test("Fast Facts never calls delayed futures live, names Sonalan's active right", () => {
  const html = readFileSync(join(ROOT, "fast-facts.html"), "utf8");
  assert.ok(!/CBOT &middot; live/.test(html), "price tiles say live");
  assert.equal((html.match(/CBOT, delayed/g) || []).length, 3);
  assert.ok(!/Live corn price|Live Market Prices|with live prices/.test(html));
  assert.ok(!/Sonalan \(trifluralin\)/.test(html));
  assert.ok(html.includes("Treflan (trifluralin), Sonalan (ethalfluralin)"));
});

test("a fertilizer pill quoted on another day than the sheet shows its own date", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const fert = { updated: "2026-09-01", prices: [
      { name: "Urea", symbol: "46-0-0", price: 590, as_of: "2026-09-01" },
      { name: "K-Mag Premium", symbol: "0-0-20-22S-11Mg", price: 650, as_of: "2026-07-20" } ] };
    const { pg, errors } = await open(browser, port, "/fast-facts#nitrogen", { fert });
    await pg.waitForFunction(() => document.querySelectorAll(".fert-pill").length === 2);
    const syms = await pg.$$eval(".fert-pill-sym", (els) => els.map((e) => e.textContent));
    assert.deepEqual(syms, ["46-0-0", "0-0-20-22S-11Mg · Jul 20"]);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
