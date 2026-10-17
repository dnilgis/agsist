/* /fast-facts calculators in a real browser, checked against hand math.
 *
 *   Lime tons follow UW A2809 Table 5.1 since 2026-10-16 (see
 *   test/fast-facts-a2809.test.mjs for the rounding, minimum and cap).
 *
 *   Lime cost: the page once multiplied tons of ordinary 75% aglime by a
 *   pelletized lime quote ("$646/ac at $285/ton pelletized"). Since 2026-10-15
 *   there is no lime price at all: the hand-typed dealer sheet that carried
 *   one is gone and no live source prices lime, so every lime option is
 *   priced only at the reader's own $/ton.
 *
 *   Fertilizer prices come from data/fertilizer-prices.json
 *   (scripts/build_fert_prices.py): the co-op posted prices Sig sent, only. The
 *   files below are made up in that shape; none is a real price.
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
    { key: "urea", name: "Urea", symbol: "46-0-0", price: 590, unit: "$/ton", as_of: "2026-09-01", src: "coop", n: 4, region: "Kansas",
      src_label: "Kansas co-ops, middle of 4, posted Sep 1, 2026", short_label: "Kansas co-ops, Sep 1" },
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
  // Since 2026-10-16 the N box asks for a state before it fills a corn price
  // (state basis by default). These tests are about the N price, so the reader
  // has already picked "Futures only" (test/fast-facts-nrate.test.mjs covers the ask).
  await ctx.addInitScript(() => localStorage.setItem("agsist-ff-state", "fut"));
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", async (r) => {
    const u = r.request().url();
    if (u.includes("/data/fertilizer-prices.json")) {
      if (opts.fail) return r.fulfill({ status: 404, body: "" });
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

test("lime cost is priced only at the reader's own $/ton, for every lime", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, "/fast-facts#soilhealth");
    await pg.waitForFunction(() => document.querySelector(".fert-pill"));
    // Default (UW A2809 Table 5.1): buffer 6.5, water 6.0, target 6.8 is
    // 195 - 28.4 x 6.5 + 0.144 x 6.0 = 11.264 t of 60-69 lime (11 t rounded);
    // 80-89 grade: 11.264 x 65/85 = 8.61 -> 8.5 t (half-ton rounding).
    assert.equal(await pg.textContent("#lime-base"), "11 ton");
    assert.equal(await pg.textContent("#lime-ag"), "8.5 ton");
    const c0 = await cost(pg);
    assert.ok(!/\$\d/.test(c0), "no dollar figure for lime without the reader's price: " + c0);
    assert.ok(!/pelletized/.test(c0), c0);
    assert.equal(c0, "Type your $/ton to see cost");
    // Reader types $40/ton spread: 8.5 t x $40 = $340/ac.
    await pg.fill("#lime-price", "40");
    assert.equal(await cost(pg), "$340/ac at your $40/ton");
    // 90-99 grade (NI 95): 11.264 x 65/95 = 7.71 -> 7.5 t x $40 = $300.
    await pg.selectOption("#lime-ni", "95");
    assert.equal(await cost(pg), "$300/ac at your $40/ton");
    // No price typed: no live lime price exists, so no number.
    await pg.fill("#lime-price", "");
    assert.equal(await cost(pg), "Type your $/ton to see cost");
    // 60-69 grade at the reader's $25: 11 t x $25 = $275.
    await pg.selectOption("#lime-ni", "65");
    await pg.fill("#lime-price", "25");
    assert.equal(await cost(pg), "$275/ac at your $25/ton");
    await pg.fill("#lime-price", "");
    assert.equal(await cost(pg), "Type your $/ton to see cost");
    // No lime needed: water pH 6.7 is within 0.2 of the 6.8 target.
    await pg.fill("#lime-wph", "6.7");
    assert.equal(await cost(pg), "None needed");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

/* N:Corn ratio: the urea auto-fill wrote the price into the box but did not
 * redraw, so when the price file landed after the first draw the result kept
 * the old 560 default ($0.61/lb N). There is no default now (the box is empty
 * until the posted price loads). Hand math at $590 urea:
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

test("every fertilizer pill names its source and date, and the arithmetic is written out", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const fert = { updated: "2026-10-06", prices: [
      { key: "urea", name: "Urea", symbol: "46-0-0", price: 622.98, as_of: "2026-10-06", src: "coop", n: 4, region: "Kansas",
        src_label: "Kansas co-ops, middle of 4, posted Oct 6, 2026", short_label: "Kansas co-ops, Oct 6" },
      { key: "uan32", name: "UAN 32%", symbol: "32-0-0", price: 451.05, as_of: "2026-09-24", src: "coop", n: 1, region: "Kansas",
        src_label: "Farmers Coop, Kansas, posted Sep 24, 2026", short_label: "Farmers Coop, Sep 24" } ] };
    const { pg, errors } = await open(browser, port, "/fast-facts#nitrogen", { fert });
    await pg.waitForFunction(() => document.querySelectorAll(".fert-pill").length === 2);
    const syms = await pg.$$eval(".fert-pill-sym", (els) => els.map((e) => e.textContent));
    assert.deepEqual(syms, ["46-0-0 · Kansas co-ops, Oct 6", "32-0-0 · Farmers Coop, Sep 24"]);
    const how = await pg.$$eval("#fert-deriv li", (els) => els.map((e) => e.textContent));
    // 622.98 / 920 = 0.6772 -> $0.68; 451.05 / 640 = 0.7048 -> $0.70
    assert.equal(how[0], "Urea $623 / (2,000 lb x 46% N) = $0.68 a lb of N (Kansas co-ops, middle of 4, posted Oct 6, 2026).");
    assert.equal(how[1], "UAN 32% $451 / (2,000 lb x 32% N) = $0.70 a lb of N (Farmers Coop, Kansas, posted Sep 24, 2026).");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

/* The MAP pill and its written-out math use the same P2O5 figure as the
 * calculator and data/fertilizer-prices.json per_lb.p: MAP less its 220 lb of
 * N at the urea price. 615.95 / 920 = 0.66951 a lb of N; 220 x 0.66951 =
 * 147.29; (980 - 147.29) / 1,040 = 0.8007 -> $0.80, not 980 / 1,040 = $0.94. */
test("the MAP pill credits its N, the same figure as the calculator", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const fert = { updated: "2026-10-12", prices: [
      { key: "urea", name: "Urea", symbol: "46-0-0", price: 615.95, as_of: "2026-10-06", src: "coop", n: 5, region: "Kansas and Wisconsin",
        src_label: "Kansas and Wisconsin co-ops, middle of 5, posted Sep 24 to Oct 6, 2026", short_label: "KS/WI co-ops, Oct 6" },
      { key: "map", name: "MAP", symbol: "11-52-0", price: 980, as_of: "2026-10-12", src: "coop", n: 2, region: "Kansas",
        src_label: "Kansas co-ops, average of 2, posted Oct 6 to Oct 12, 2026", short_label: "Kansas co-ops, Oct 12" } ] };
    const { pg, errors } = await open(browser, port, "/fast-facts#nitrogen", { fert });
    await pg.waitForFunction(() => document.querySelectorAll(".fert-pill").length === 2);
    const how = await pg.$$eval("#fert-deriv li", (els) => els.map((e) => e.textContent));
    assert.equal(how[1], "MAP $980 a ton, less 220 lb of N at the urea price ($147), / 1040 lb of P2O5 = $0.80 a lb of P2O5 (Kansas co-ops, average of 2, posted Oct 6 to Oct 12, 2026).");
    const label = await pg.$$eval(".fert-pill", (els) => els[1].getAttribute("aria-label"));
    assert.equal(label, "MAP $980/ton, Kansas co-ops, average of 2, posted Oct 6 to Oct 12, 2026: $0.801/lb P2O5");
    assert.equal(await pg.inputValue("#eco-p-pplb"), "0.80");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

/* Potash is priced at the grade its source names: a sheet quoting white
 * potash 0-0-62 gives $516.36 / (2000 x 0.62) = $0.4164/lb K2O,
 * not the 0-0-60 figure. (Was: the K-Mag pill at 22% K2O; K-Mag has no live
 * price source and is gone.) */
test("the potash pill prices K2O at the grade its source names", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const fert = { updated: "2026-10-02", prices: [
      { key: "potash", name: "Potash", symbol: "0-0-62", price: 516.36, as_of: "2026-10-02", src: "coop", n: 1, region: "Kansas",
        src_label: "Test Coop, Kansas, posted Oct 2, 2026" } ] };
    const { pg, errors } = await open(browser, port, "/fast-facts#nitrogen", { fert });
    await pg.waitForFunction(() => document.querySelectorAll(".fert-pill").length === 1);
    const label = await pg.$eval(".fert-pill", (e) => e.getAttribute("aria-label"));
    assert.equal(label, "Potash $516/ton, Test Coop, Kansas, posted Oct 2, 2026: $0.416/lb K2O");
    assert.equal(await pg.inputValue("#eco-k-pplb"), "0.42");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

/* No price file: the boxes stay empty and say so. Never a stale default. */
test("with no price file, no fertilizer number appears and the page says why", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, "/fast-facts#economics", { fail: true });
    await pg.waitForTimeout(800);
    assert.equal(await pg.inputValue("#nc-fertprice"), "");
    assert.equal(await pg.textContent("#nc-nlb"), "-");
    for (const id of ["#eco-n-pplb", "#eco-p-pplb", "#eco-k-pplb"]) assert.equal(await pg.inputValue(id), "", id);
    assert.match(await pg.textContent("#eco-price-note"), /No live price for N, P₂O₅, K₂O right now/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
