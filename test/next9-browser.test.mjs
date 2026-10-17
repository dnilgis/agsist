/* Browser checks for two re-score 7 items (needs Playwright and Chromium;
 * skipped where they are missing):
 *  - /fertilizer: the co-op price record is fetched only when the trend box is
 *    opened, then drawn; the bill takes the reader's P and N picks and own
 *    application cost; no sideways scroll at 390.
 *  - an issue page: a reader with a saved location gets the local line above
 *    the quote strip; with none, the ZIP box stays below it.
 *   node --test test/next9-browser.test.mjs
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
    let f = normalize(join(ROOT, p));
    if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, port, path, init) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  if (init) await ctx.addInitScript(init);
  const pg = await ctx.newPage(), got = [], errs = [];
  pg.on("request", (r) => { const u = r.url(); if (u.startsWith(`http://127.0.0.1:${port}`)) got.push(new URL(u).pathname); });
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load" });
  return { ctx, pg, got, errs };
}

test("/fertilizer: record on open only; picks and own application cost priced", { skip, timeout: 60000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, got, errs } = await open(browser, port, "/fertilizer.html");
    await pg.waitForSelector("#fert-nutrient-body td[data-l]", { timeout: 15000 });
    assert.equal(got.filter((x) => x === "/data/fertilizer-coops-history.json").length, 0, "not fetched on load");
    await pg.click("#fert-trend > summary");
    await pg.waitForSelector(".ft-grid", { timeout: 10000 });
    assert.equal(got.filter((x) => x === "/data/fertilizer-coops-history.json").length, 1, "fetched once on open");
    await pg.selectOption("#calc-psrc", "DAP");
    await pg.selectOption("#calc-nsrc", "Anhydrous ammonia");
    const before = await pg.textContent(".calc-headline");
    await pg.fill("#calc-app", "14");
    const out = await pg.textContent("#calc-out");
    assert.match(out, /DAP \(your pick\)/);
    assert.match(out, /Anhydrous ammonia \(your pick\)/);
    assert.match(out, /Application\s*Your figure\s*\$14\.00/);
    const n = (t) => parseFloat(t.match(/\$([\d,]+\.\d\d)/)[1].replace(/,/g, ""));
    assert.ok(Math.abs(n(await pg.textContent(".calc-headline")) - n(before) - 14) < 0.011, "application adds the reader's own $14");
    const hs = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(hs, 0, "no sideways scroll at 390");
    assert.deepEqual(errs, []);
  } finally { await browser.close(); srv.close(); }
});

test("issue page: saved location puts the local line above the quote strip; no location keeps it below", { skip, timeout: 60000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const order = (pg) => pg.evaluate(() => {
    const d = document.querySelector("[data-daily-local]"), q = document.querySelector("article .dv3-quotes");
    return d.compareDocumentPosition(q) & Node.DOCUMENT_POSITION_FOLLOWING ? "local-first" : "quotes-first";
  });
  try {
    const a = await open(browser, port, "/daily/2026-10-17.html", () => localStorage.setItem("agsist_zip", "61761"));
    await a.pg.waitForTimeout(800);
    assert.equal(await order(a.pg), "local-first");
    const b = await open(browser, port, "/daily/2026-10-17.html");
    await b.pg.waitForSelector("#dl-zip", { timeout: 5000 });
    assert.equal(await order(b.pg), "quotes-first", "the ZIP ask stays below the quotes");
    assert.deepEqual(a.errs.concat(b.errs), []);
  } finally { await browser.close(); srv.close(); }
});
