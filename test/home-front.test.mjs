/* Homepage, in a real browser.
 *
 *   Yield nowcast trend line: it said "Our 12-year trend: 188.7", taking the
 *   number of backtest years, but the line is fit on 2010-2025 (16 finals). It
 *   is now labeled by its window, as /conditions-yield does, with USDA's own
 *   183.0 corn trend beside it.
 *
 * Needs Playwright and Chromium; skipped where they are missing.
 *
 *   node --test test/home-front.test.mjs
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

const NOWCAST = {
  generated: "2026-10-13T10:36:18Z",
  crops: {
    corn: { week_ending: "2026-10-04", nowcast: 180.6, band80: 6.9, mae: 4.2, band_method: "expanding-window", trend: 188.7, trend_window: "2010-2025", trend_n: 16, backtest_years: 12, backtest_window: "2011-2024" },
    soybeans: { week_ending: "2026-10-04", nowcast: 53.5, band80: 2.4, mae: 1.3, band_method: "expanding-window", trend: 53.9, trend_window: "2010-2025", trend_n: 16, backtest_years: 13, backtest_window: "2011-2024" },
  },
};

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    else if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, port, path, routes = {}, width = 1280, init = null) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
  if (init) await ctx.addInitScript(init);
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", async (r) => {
    const u = r.request().url();
    for (const [frag, body] of Object.entries(routes)) {
      if (u.includes(frag)) return body === null ? r.abort() : r.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    }
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}${path}`);
  return { pg, errors, ctx };
}

test("homepage nowcast labels our trend by its fit window and shows USDA's corn trend beside it", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port, "/", { "/data/yield-nowcast.json": NOWCAST, "/data/wasde.json": null });
    await pg.waitForSelector("#nc-corn-trend", { state: "attached", timeout: 15000 });
    const corn = await pg.textContent("#nc-corn-trend");
    assert.equal(corn, "Our straight-line trend: 188.7 (2010–2025 finals) · USDA’s trend: 183.0 · backtest miss averages 4.2 bu");
    assert.ok(!/12-year/.test(corn), corn);
    const beans = await pg.textContent("#nc-beans-trend");
    assert.equal(beans, "Our straight-line trend: 53.9 (2010–2025 finals) · backtest miss averages 1.3 bu");
    assert.equal(await pg.textContent("#nc-years"), "12");
    assert.match(await pg.textContent("#tip-nowcast"), /12 past years, each estimated from earlier years only/);
  } finally { await browser.close(); srv.close(); }
});

/* With no ZIP and no location the "Today" cell in the first band sat as a gray
 * bar, then read "Weather didn't load", when the reason was no ZIP. It now
 * says "Set ZIP" and a tap opens the ZIP box. */
test("homepage Today cell asks for a ZIP when there is no location, and a tap opens the ZIP box", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port, "/", {}, 390);
    // Headless Chromium leaves the location prompt hanging, as a reader who
    // ignores it does: no ZIP saved, "Detecting location..." below.
    await pg.waitForFunction(() => document.getElementById("hb-wx-v").textContent.trim() === "Set ZIP", null, { timeout: 15000 });
    assert.equal((await pg.textContent("#hb-wx-v")).trim(), "Set ZIP");
    assert.equal((await pg.textContent("#hb-wx-s")).trim(), "for weather and spray days");
    await pg.waitForTimeout(10500);
    assert.ok(!/didn/.test(await pg.textContent("#hb-wx-s")), "after 10 s it still says why, not didn't load");
    await pg.click("#hb-wx");
    assert.equal(await pg.$eval("#hb-zip-form", (f) => f.classList.contains("is-open")), true);
  } finally { await browser.close(); srv.close(); }
});

test("with a ZIP saved the Today cell never asks for one", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const init = () => { try { localStorage.setItem("agsist-wx-loc", JSON.stringify({ zip: "50010", lat: 42.03, lon: -93.62, label: "Ames, IA", ts: Date.now() })); } catch (e) {} };
    const { pg } = await open(browser, port, "/", {}, 390, init);
    await pg.waitForTimeout(11000);
    assert.notEqual((await pg.textContent("#hb-wx-v")).trim(), "Set ZIP");
  } finally { await browser.close(); srv.close(); }
});
