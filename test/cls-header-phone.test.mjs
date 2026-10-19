/* The phone header placeholder, sitewide (Oct 19, 2026).
 *
 * Under 520px the live nav (components/header.html, swapped in by loader.js)
 * is 62px tall. The static crawlable nav that thousands of generated pages
 * carry inside #site-header could stand taller there (69px on the homepage),
 * and the page moved up when the live nav landed. fx/cls held it on the
 * homepage only (css/home.css); the rule now lives once in
 * components/styles.css.
 *
 * Measured before the fix (Oct 19): at the browser's default 16px font the
 * static nav on /cash-bids and the ARC/PLC county pages is 54px, inside the
 * 62px min-height, and only the homepage stood 69px. A reader who sets a
 * larger default font (styles.css --base respects it since styles.css?v=25)
 * gets a taller static nav: at 20px it is 67.5px on /cash-bids and every
 * ARC/PLC county page, and the page jumped when the 62px live nav landed.
 *
 * The browser check serves the committed pages, loads them at 390 x 844 with
 * the CPU at a quarter speed, at a 16px and a 20px default font, and records
 * where <main> sits just before and just after the placeholder is replaced.
 * It must not move.
 *
 *   node --test test/cls-header-phone.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("styles.css holds the phone placeholder to the live nav's 62px, once", () => {
  const css = strip(read("components/styles.css"));
  assert.match(css, /@media \(max-width:520px\)\{#site-header\{min-height:62px;height:62px;overflow:hidden\}\}/);
  // home.css no longer carries its own copy of the same rule
  assert.doesNotMatch(strip(read("css/home.css")), /#site-header\{height:62px/);
});

// a county rain page (empty placeholder) and an ARC/PLC county page (static nav)
const rainState = "iowa";
const rainCounty = readdirSync(join(ROOT, "rain", rainState)).filter((f) => /-county\.html$/.test(f)).sort()[0];
const PAGES = ["/rain/" + rainState + "/" + rainCounty.replace(/\.html$/, ""), "/cash-bids", "/arc-plc/iowa/adair-county"];

test("the pages under test are the kinds this guards", () => {
  assert.ok(read("cash-bids.html").includes("static-nav:header"), "/cash-bids carries the static nav");
  assert.ok(read("arc-plc/iowa/adair-county.html").includes("static-nav:header"), "ARC/PLC county pages carry the static nav");
  assert.ok(read("rain/" + rainState + "/" + rainCounty).includes('id="site-header"'), "the rain county page has the placeholder");
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".xml": "application/xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function headerShift(browser, port, path, font) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: "America/Chicago" });
  const pg = await ctx.newPage();
  const cdp = await ctx.newCDPSession(pg);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Page.enable");
  await cdp.send("Page.setFontSizes", { fontSizes: { standard: font } });
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.addInitScript(() => {
    window.__hdr = null;
    document.addEventListener("DOMContentLoaded", () => {
      const ph = document.getElementById("site-header"), main = document.querySelector("main");
      if (!ph || !main) return;
      const at = () => main.getBoundingClientRect().top + window.scrollY;
      const rec = { placeholder: ph.getBoundingClientRect().height, before: at(), after: null };
      window.__hdr = rec;
      new MutationObserver((ms, mo) => {
        if (ph.isConnected) return;
        rec.after = at();
        const nav = document.querySelector("body > nav, nav.nav");
        rec.nav = nav ? nav.getBoundingClientRect().height : null;
        mo.disconnect();
      }).observe(ph.parentNode, { childList: true });
    });
  });
  await pg.goto(`http://127.0.0.1:${port}${path}`);
  await pg.waitForFunction(() => window.__hdr && window.__hdr.after !== null, null, { timeout: 30000 });
  const r = await pg.evaluate(() => window.__hdr);
  await ctx.close();
  return r;
}

test("browser: no header shift at 390, default and large font, on a county rain page, /cash-bids and an ARC/PLC county page", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const path of PAGES) {
      for (const font of [16, 20]) {
        const r = await headerShift(browser, port, path, font);
        const at = `${path} (default font ${font}px)`;
        assert.ok(Math.abs(r.after - r.before) < 0.5, `${at}: <main> moved ${(r.after - r.before).toFixed(1)}px when the live nav landed (placeholder ${r.placeholder}px, nav ${r.nav}px)`);
        assert.equal(r.placeholder, 62, `${at}: the placeholder is the live nav's height`);
      }
    }
  } finally { await browser.close(); srv.close(); }
});
