/* Shared harness for the CLS sweep tests (test/cls-sweep-*.test.mjs, Nov 10, 2026; the sweep is
 * notes/audits/cls-sweep-2026-11-10.md in the private notes). The page is served as committed, with the committed
 * data: nothing is mocked. Scripts and stylesheets arrive after 800 ms and /data/ files after 1.5 s (a phone network),
 * every outside host is held 1.5 s and then refused, service workers are blocked. "saved" is a returning reader near
 * Chetek, WI 54728 (the location box record geo.js writes, plus both saved-ZIP keys). The number is the sum of layout
 * shifts without input from navigation to settle (load, network idle or 12 s, then 2.5 s), the number the sweep ranked.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
/* PLAYWRIGHT_PATH and CHROMIUM_PATH win (the PR checks set both); otherwise the first of the usual places that is
   there. A browser that is not found skips the cases with its reason printed to stderr, never quietly. */
const isFile = (f) => { try { return statSync(f).isFile(); } catch (e) { return false; } };
const PW_AT = process.env.PLAYWRIGHT_PATH ? [process.env.PLAYWRIGHT_PATH] : ["/opt/node-tools/node_modules/playwright/index.mjs", "/home/user/node_modules/playwright/index.mjs"];
const CHROME_AT = process.env.CHROMIUM_PATH ? [process.env.CHROMIUM_PATH] : ["/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", "/opt/pw-browsers/chromium/chrome-linux64/chrome"];
const PW = PW_AT.find(isFile);
const CHROME = CHROME_AT.find(isFile);
let chromium = null, why = "";
try { if (PW) ({ chromium } = await import(PW)); } catch (e) { chromium = null; why = String(e && e.message || e).slice(0, 200); }
export const skip = !chromium
  ? `Playwright not loaded (tried ${PW_AT.join(", ")}${why ? ": " + why : ""}); set PLAYWRIGHT_PATH`
  : !CHROME ? `Chromium not found (tried ${CHROME_AT.join(", ")}); set CHROMIUM_PATH` : false;
if (skip) process.stderr.write(`\n*** CLS SWEEP BROWSER CASES SKIPPED: ${skip}. A skipped case is not a pass. ***\n\n`);
export const MODES = [[390, false], [390, true], [1280, false], [1280, true]];
export const LOC = { lat: 45.3172, lon: -91.6513, label: "Chetek, WI", zip: "54728", state: "WI", county: "Barron", zipTyped: true, ts: 1 };
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".webp": "image/webp" };

export function read(p) { return readFileSync(join(ROOT, p), "utf8"); }

/* one server and one browser for a file's cases; close() when done */
export async function open() {
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f = normalize(join(ROOT, p));
    if (!p.endsWith("/") && existsSync(f + ".html")) f += ".html";
    else if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    const wait = p.startsWith("/data/") ? 1500 : /\.(js|css)$/.test(f) ? 800 : 0;
    setTimeout(() => { res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream" }); res.end(readFileSync(f)); }, wait);
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  /* saved: false (nothing), true (the Chetek WI reader above), or an object of localStorage keys to set */
  async function cls(path, w, saved) { return run(path, w, saved, {}); }
  /* block: a RegExp of local paths answered with 404 (a script that did not load); waitMs: how long to watch */
  async function probe(path, w, saved, block, waitMs, fn) { return run(path, w, saved, { block, waitMs, fn }); }
  async function run(path, w, saved, o) {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: w < 600 ? 844 : 900 }, isMobile: w < 600, hasTouch: w < 600 });
    try {
      await ctx.route("**/*", async (r) => {
        const u = r.request().url();
        if (u.startsWith(`http://127.0.0.1:${port}/`)) return o.block && o.block.test(new URL(u).pathname) ? r.fulfill({ status: 404, body: "" }) : r.continue();
        await new Promise((ok) => setTimeout(ok, 1500));
        return r.abort();
      });
      const pg = await ctx.newPage();
      const keys = saved === true ? { "agsist-wx-loc": JSON.stringify(LOC), agsist_zip: LOC.zip, agsist_user_zip: LOC.zip } : saved || {};
      if (Object.keys(keys).length) await pg.addInitScript((K) => { try { for (const k in K) localStorage.setItem(k, K[k]); } catch (e) {} }, keys);
      await pg.addInitScript(() => {
        window.__cls = 0; window.__who = [];
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) {
          window.__cls += e.value;
          if (e.value > 0.002) window.__who.push(Math.round(e.startTime) + "ms " + e.value.toFixed(4) + " " + (e.sources || []).map((s) => { const n = s.node; return !n ? "?" : n.nodeType !== 1 ? "#text" : n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") + (typeof n.className === "string" && n.className ? "." + n.className.trim().split(/\s+/).join(".") : ""); }).join(", "));
        } }).observe({ type: "layout-shift", buffered: true });
      });
      await pg.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load", timeout: 60000 });
      if (o.fn) { await pg.waitForTimeout(o.waitMs || 0); return { cls: await pg.evaluate(() => window.__cls), who: await pg.evaluate(() => window.__who), out: await pg.evaluate(o.fn) }; }
      try { await pg.waitForLoadState("networkidle", { timeout: 12000 }); } catch (e) { /* a page that keeps polling: settle on the clock */ }
      await pg.waitForTimeout(2500);
      return await pg.evaluate(() => ({ cls: window.__cls, who: window.__who }));
    } finally { await ctx.close(); }
  }
  return { cls, probe, close: async () => { await browser.close(); srv.close(); } };
}
