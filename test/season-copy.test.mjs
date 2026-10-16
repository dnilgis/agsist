/* Season-aware copy (2026-10-16 audit): in the fall the GDU calculator leads
 * with black layer and frost, the yield estimator calls its number a field
 * estimate, and the spray calendar opens on harvest aid and fall burndown.
 * The rest of the year each page reads as written.
 *
 * Needs Playwright and Chromium; skipped where they are missing.
 *
 *   node --test test/season-copy.test.mjs
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
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function at(browser, port, path, iso, fn) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  await ctx.addInitScript((t) => {
    const T = Date.parse(t), R = Date;
    class F extends R { constructor(...a) { super(...(a.length ? a : [T])); } static now() { return T; } }
    window.Date = F;
  }, iso);
  const pg = await ctx.newPage();
  await pg.route("**/*", (r) => r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort());
  await pg.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "domcontentloaded" });
  try { return await pg.evaluate(fn); } finally { await ctx.close(); }
}
const OCT = "2026-10-16T15:00:00Z", JUL = "2026-07-16T15:00:00Z", JAN = "2027-01-16T15:00:00Z";

test("no em dashes in the new season copy", () => {
  for (const f of ["gdu-calculator.html", "yield-estimator.html", "spray.html"]) {
    const h = readFileSync(ROOT + f, "utf8");
    for (const m of h.matchAll(/2026-10-16 audit[\s\S]*?<\/script>/g)) assert.ok(!m[0].includes("—"), f);
  }
});

test("fall: GDU leads with black layer and frost; summer as written", { skip, timeout: 240000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const probe = () => {
      const card = document.getElementById("gdu-mat-card"), gauge = document.querySelector(".gauge-wrap");
      const first = card.querySelector(".r-row, .mat-grid");
      return { cardFirst: !!(card.compareDocumentPosition(gauge) & Node.DOCUMENT_POSITION_FOLLOWING),
               firstRow: first.id || first.className, lede: document.querySelector(".gdu-hero .page-lede").textContent };
    };
    const o = await at(browser, port, "/gdu-calculator", OCT, probe);
    assert.ok(o.cardFirst, "maturity card above the gauge in October");
    assert.equal(o.firstRow, "r-mat-row", "black layer is the card's first line");
    assert.match(o.lede, /^Is it at black layer, and will frost beat it\?/);
    const j = await at(browser, port, "/gdu-calculator", JUL, probe);
    assert.ok(!j.cardFirst, "gauge first in July");
    assert.equal(j.firstRow, "mat-grid");
    assert.match(j.lede, /^Heat units since planting/);
  } finally { await browser.close(); srv.close(); }
});

test("fall: the yield estimator says field estimate; summer as written", { skip, timeout: 240000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const probe = () => ({ c: document.getElementById("c-yield-lab").textContent, b: document.getElementById("b-yield-lab").textContent,
      lede: document.querySelector(".ye-hero .page-lede").textContent, kick: document.querySelector(".ye-hero .ye-eyebrow").textContent.trim() });
    const o = await at(browser, port, "/yield-estimator", OCT, probe);
    assert.equal(o.c, "Field estimate"); assert.equal(o.b, "Field estimate");
    assert.match(o.lede, /^Harvest is on: a field estimate/);
    assert.equal(o.kick, "Field estimate: count before you cut");
    const j = await at(browser, port, "/yield-estimator", JUL, probe);
    assert.equal(j.c, "Est. Yield");
    assert.equal(j.kick, "Pre-harvest field estimate");
  } finally { await browser.close(); srv.close(); }
});

test("spray calendar opens on this month's window", { skip, timeout: 240000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const probe = () => { const c = document.querySelector(".season-grid .season-card"); return { m: c.querySelector(".season-card-month").textContent, t: c.querySelector(".season-card-title").textContent, n: document.querySelectorAll(".season-grid .season-card").length }; };
    const o = await at(browser, port, "/spray", OCT, probe);
    assert.equal(o.m, "Sept–Oct Now"); assert.equal(o.t, "Harvest aid and cover crop burndown"); assert.equal(o.n, 6);
    const j = await at(browser, port, "/spray", JUL, probe);
    assert.equal(j.m, "July Now");
    const w = await at(browser, port, "/spray", JAN, probe);
    assert.equal(w.m, "April Next");
  } finally { await browser.close(); srv.close(); }
});
