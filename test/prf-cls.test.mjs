/* Layout shift on /prf (panel, Nov 9, 2026). The skeptic measured CLS 0.1149 at 390 px without mobile emulation
 * and 0.000 to 0.041 with it; 0.058 to 0.063 at 1280. The cause: "Loading the rain record" printed in a status
 * block above the hidden find card, then the status emptied and the 313 px card was unhidden, pushing the byline
 * from y=497 to 659 to 827. Now the card ships visible with its buttons off and the loading line inside it, in a
 * slot that keeps its height (components/prf.js, scripts/make_prf_html.py).
 *
 * Measured with the committed page and data, every outside host refused, service workers blocked (BUILD-RULES 58),
 * the CPU at a quarter speed and /data held 1.5 s (a phone network), at 390 px with and without mobile emulation and
 * at 1280 px. Needs Playwright and Chromium; skipped where missing.
 *
 *   node --test test/prf-cls.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("prf.html: no status block above the find card; the card ships visible with the loading line inside it", () => {
  const h = read("prf.html");
  assert.ok(!/<p class="prf-status" id="prf-status"/.test(h), "no separate status block above the card");
  assert.match(h, /<div id="prf-app">/, "the app is not shipped hidden");
  assert.match(h, /<noscript>[^]*?#prf-app\{display:none\}[^]*?<\/noscript>/, "without JavaScript the dead form stays out of sight");
  const card = h.slice(h.indexOf('<section class="prf-card prf-step-find"'), h.indexOf("</section>", h.indexOf('<section class="prf-card prf-step-find"')));
  assert.match(card, /<p class="prf-find-msg prf-hold" id="prf-find-msg" role="status" aria-live="polite">Loading the rain record…<\/p>/);
  for (const id of ["prf-loc", "prf-eg"]) assert.match(card, new RegExp(`id="${id}" disabled data-wait`), id + " is off until the record loads");
  assert.match(card, /class="btn btn-primary prf-btn-go" disabled data-wait/, "Find is off until the record loads (no early submit reloads the page)");
  assert.match(read("components/prf.css"), /\.prf-find-msg\.prf-hold \{[^}]*min-height/, "the loading line's slot keeps its height");
});

function serve(hold) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    const send = () => { res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" }); res.end(readFileSync(f)); };
    if (hold && p.startsWith("/data/")) setTimeout(send, hold); else send();
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function measure(browser, port, width, height, mobile) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height }, isMobile: mobile, hasTouch: mobile, timezoneId: "America/Chicago" });
  const pg = await ctx.newPage();
  const cdp = await ctx.newCDPSession(pg);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.addInitScript(() => {
    window.__cls = 0; window.__src = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__cls += e.value;
        window.__src.push(e.value.toFixed(4) + " " + (e.sources || []).map((s) => (s.node ? s.node.nodeName + "#" + (s.node.id || "") + "." + (typeof s.node.className === "string" ? s.node.className : "") : "?")
          + " y" + Math.round(s.previousRect.y) + ">" + Math.round(s.currentRect.y)).join(", "));
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await pg.goto(`http://127.0.0.1:${port}/prf`);
  await pg.waitForSelector("#prf-app[data-ready]", { timeout: 30000 });
  await pg.waitForTimeout(2000);
  const r = await pg.evaluate(() => ({ cls: window.__cls, src: window.__src, msg: document.getElementById("prf-find-msg").textContent,
    off: document.querySelectorAll("#prf-app [disabled][data-wait]").length, terms: !!document.querySelector("details#terms[open]") }));
  await ctx.close();
  return r;
}

test("browser: /prf on a fresh visit shifts under 0.05, at 390 (with and without mobile emulation) and 1280", { skip, timeout: 240000 }, async () => {
  const srv = await serve(1500), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [w, h, mobile] of [[390, 844, true], [390, 844, false], [1280, 800, false]]) {
      const r = await measure(browser, port, w, h, mobile);
      assert.ok(r.cls < 0.05, `/prf ${w}${mobile ? " mobile" : ""}: CLS ${r.cls.toFixed(4)} ${JSON.stringify(r.src)}`);
      assert.equal(r.msg, "", `${w}: the loading line is cleared once the record is in`);
      assert.equal(r.off, 0, `${w}: the buttons are on once the record is in`);
      assert.equal(r.terms, false, `${w}: Sources and terms stays closed, wide screens too`);
    }
  } finally { await browser.close(); srv.close(); }
});

test("browser: the example grid opens on non-irrigated haying, and grazing can still be picked (Sig, Nov 9)", { skip, timeout: 120000 }, async () => {
  const srv = await serve(0), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
    await pg.goto(`http://127.0.0.1:${port}/prf`);
    await pg.waitForSelector("#prf-app[data-ready]");
    await pg.click("#prf-eg");
    await pg.waitForSelector("#prf-answer .prf-figs", { state: "attached", timeout: 20000 });
    const use = await pg.$eval("#prf-use", (s) => ({ v: s.value, t: s.options[s.selectedIndex].text, all: [...s.options].map((o) => o.text) }));
    assert.equal(use.t, "Haying, non-irrigated", JSON.stringify(use));
    assert.ok(use.all.includes("Grazing"), "grazing is still offered");
    await pg.click("#prf-setup-sum");   /* on a phone the setup sits behind "Change" */
    await pg.selectOption("#prf-use", { label: "Grazing" });
    await pg.waitForFunction(() => /\$150 /.test(document.querySelector("#prf-answer .prf-figs dd").textContent));
    assert.equal(await pg.$eval("#prf-use", (s) => s.options[s.selectedIndex].text), "Grazing");
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
