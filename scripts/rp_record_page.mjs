#!/usr/bin/env node
/* scripts/rp_record_page.mjs: every NOAA (RCC-ACIS) and Open-Meteo geocoding
 * answer the real Rain Print page asks for while it draws a design with every
 * layer on, saved so the same page can draw it again offline, exactly.
 *
 * fetch_rain_print_examples.mjs runs the engine's previewArt() chain in node,
 * which never reaches the page-only layers (the temperature station and its
 * normals for the frost marks, hottest and coldest day and the daily
 * temperature stripes; the long-record station for "Every year behind"). This
 * opens rain-print.html itself in headless Chrome, served from this checkout,
 * lets the page ask NOAA for whatever it wants (route.fetch: the real network,
 * unchanged URLs), and keeps every answer as it came back. Nothing is made up
 * or filled in: a request that fails is saved as failed and the run says so.
 *
 *   node scripts/rp_record_page.mjs <out.json> <query> [<query> ...]
 *     query: what follows /rain-print.html? (a design link's query)
 *   RP_FAKE=<saved.json>: answer from a saved file instead of the network (a local dry run)
 *
 * Writes { fetched_at, source, pages: [{ query, status, source, station }], requests: [{ url, status, body | pack }] },
 * the full records (sdate=por) packed by rain_print_examples_pack.mjs.
 * Needs Playwright (PLAYWRIGHT_PATH, or playwright-core installed next to it) and Chrome or Chromium (CHROMIUM_PATH).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { pack, answerOf } from "./rain_print_examples_pack.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const DATA_HOSTS = new Set(["data.rcc-acis.org", "geocoding-api.open-meteo.com"]);
const { chromium } = await import(PW);
const out = (s) => process.stdout.write(s + "\n");
const note = (kind, s) => out("::" + kind + " title=rain print record::" + String(s).replace(/%/g, "%25").replace(/\n/g, "%0A"));

const [outFile, ...queries] = process.argv.slice(2);
if (!outFile || !queries.length) { out("usage: rp_record_page.mjs <out.json> <query>..."); process.exit(2); }
const fake = process.env.RP_FAKE ? new Map(JSON.parse(readFileSync(process.env.RP_FAKE, "utf8")).requests.map((q) => [q.url, answerOf(q)])) : null;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    let p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
    if (!extname(p) && existsSync(p + ".html")) p += ".html";
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

const saved = new Map();   // url -> { url, status, body }
const srv = await serve(), base = "http://127.0.0.1:" + srv.address().port;
const browser = await chromium.launch({ executablePath: CHROME });
const pages = [];
let failed = 0;
try {
  for (const query of queries) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    let inflight = 0, lastNet = Date.now();
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
      const url = r.request().url(), host = new URL(url).host;
      if (!DATA_HOSTS.has(host)) return r.abort();
      inflight++; lastNet = Date.now();
      try {
        if (saved.has(url) && saved.get(url).status === 200) return await r.fulfill({ json: saved.get(url).body, headers: { "Access-Control-Allow-Origin": "*" } });
        let status = 0, text = "";
        if (fake) { status = fake.has(url) ? 200 : 404; text = JSON.stringify(fake.has(url) ? fake.get(url) : { error: "not in RP_FAKE" }); }
        else {
          for (let t = 1; t <= 3; t++) {
            try { const res = await r.fetch({ timeout: 90000 }); status = res.status(); text = await res.text(); } catch (e) { status = 0; text = ""; }
            if (status === 200) break;
            await new Promise((ok) => setTimeout(ok, 5000 * t));
          }
        }
        let body = null; try { body = JSON.parse(text); } catch (e) { body = null; }
        saved.set(url, { url, status, body });
        out((status === 200 ? "  200 " : "  FAIL " + status + " ") + url.slice(0, 220));
        return await r.fulfill({ status: status || 502, body: text || "{}", headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } });
      } finally { inflight--; lastNet = Date.now(); }
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    out("page " + query);
    await page.goto(base + "/rain-print.html?" + query);
    try {
      await page.waitForFunction(() => {
        const st = document.getElementById("rp-status").textContent;
        return document.querySelector("#rp-art svg") && /days recorded/.test(document.getElementById("rp-source").textContent) &&
          window.AgRainRecords && /^Drawn from the records/.test(st) && !/Still reading|Adding the 30-year normal/.test(st);
      }, null, { timeout: 240000 });
      // the layers ask after the first drawing: wait until NOAA has been quiet for 15 s
      const t0 = Date.now();
      while ((inflight > 0 || Date.now() - lastNet < 15000) && Date.now() - t0 < 300000) await page.waitForTimeout(1000);
    } catch (e) { errors.push("not drawn: " + String(e).slice(0, 200)); }
    const info = await page.evaluate(() => ({
      status: document.getElementById("rp-status").textContent.trim(),
      source: document.getElementById("rp-source").textContent.trim(),
      station: (document.getElementById("rp-station") || {}).value || "",
      why: ["rp-temp-why", "rp-hist-why"].map((id) => { const el = document.getElementById(id); return el && !el.hidden ? el.textContent.trim() : ""; }).filter(Boolean),
    })).catch(() => ({}));
    pages.push(Object.assign({ query, errors }, info));
    note(errors.length ? "error" : "notice", query + "\n" + JSON.stringify(info) + (errors.length ? "\n" + errors.join("\n") : ""));
    if (errors.length) failed++;
    await context.close();
  }
} finally { await browser.close(); srv.close(); }

const bad = [...saved.values()].filter((q) => q.status !== 200 || q.body === null);
for (const q of bad) note("warning", "no usable answer: " + q.status + " " + q.url);
const isPor = (u) => u.startsWith("https://data.rcc-acis.org/StnData?") && new URL(u).searchParams.get("sdate") === "por";
writeFileSync(outFile, JSON.stringify({
  fetched_at: new Date().toISOString(), fake: !!fake,
  source: "NOAA RCC-ACIS (data.rcc-acis.org) and Open-Meteo geocoding, asked by rain-print.html itself (scripts/rp_record_page.mjs)",
  pages,
  requests: [...saved.values()].map((q) => { const p = q.status === 200 && isPor(q.url) ? pack(q.body) : null; return p ? { url: q.url, status: q.status, pack: p } : q; }),
}) + "\n");
out("saved " + saved.size + " answers (" + bad.length + " not usable) to " + outFile);
process.exit(failed ? 1 : 0);
