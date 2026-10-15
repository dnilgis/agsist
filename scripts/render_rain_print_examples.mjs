#!/usr/bin/env node
/* scripts/render_rain_print_examples.mjs: the example prints at the top of
 * /rain-print, drawn by the page itself from the real NOAA answers saved in
 * data/rain-print-examples/ (scripts/fetch_rain_print_examples.mjs).
 *
 * Opens rain-print.html in Chromium with every outside call answered from
 * the saved file (the station's full history unpacked as NOAA sent it; a
 * request with no saved answer fails the run), lets the shipped engine pick
 * the station and draw the year in Staircase with the 30-year normals and the
 * remarkable days on, as a story link opens (2026-10-15), exactly as a
 * reader's browser would, and saves the drawn print at W x H as
 * img/rain-print-example-<slug>.webp and .jpg, each at most MAX_KB.
 * It prints the numbers the alt text uses (test/rain-print-examples.test.mjs
 * checks them against the saved data).
 *
 * Run by hand after the examples are fetched again or the art changes:
 *   node scripts/render_rain_print_examples.mjs
 *   PNG_DIR=dir node scripts/render_rain_print_examples.mjs   (also keeps the lossless W x H PNGs there)
 * Needs Playwright (PLAYWRIGHT_PATH) and Chromium (CHROMIUM_PATH).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { answerOf } from "./rain_print_examples_pack.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const W = 1200, H = 800, MAX_KB = 120;
const { chromium } = await import(PW);

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

const files = readdirSync(ROOT + "data/rain-print-examples").filter((f) => f.endsWith(".json")).sort().reverse();   // 2012 Ames first
const srv = await serve(), base = "http://127.0.0.1:" + srv.address().port;
const browser = await chromium.launch({ executablePath: CHROME });
try {
  for (const f of files) {
    const ex = JSON.parse(readFileSync(ROOT + "data/rain-print-examples/" + f, "utf8"));
    const answers = new Map(ex.requests.map((q) => [q.url, answerOf(q)]));
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    const missed = [];
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
      const url = r.request().url(), host = new URL(url).host;
      if (host === "data.rcc-acis.org" || host === "geocoding-api.open-meteo.com") {
        if (answers.has(url)) return r.fulfill({ json: answers.get(url), headers: { "Access-Control-Allow-Origin": "*" } });
        missed.push(url);
        return r.fulfill({ json: { error: "not saved" }, headers: { "Access-Control-Allow-Origin": "*" } });
      }
      return r.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base + ex.link.replace("/rain-print?", "/rain-print.html?"));
    // drawn, the normal in, the full record read and the remarkable days loaded
    await page.waitForFunction(() => {
      const st = document.getElementById("rp-status").textContent;
      return document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && /days recorded/.test(document.getElementById("rp-source").textContent) &&
        window.AgRainRecords && /^Drawn from the records/.test(st) && !/Still reading|Adding the 30-year normal/.test(st);
    }, null, { timeout: 60000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => document.fonts.ready);
    if (errors.length) throw new Error(ex.slug + ": page errors: " + errors.join("; "));
    if (missed.length) throw new Error(ex.slug + ": the page asked for something not saved: " + missed.join(", "));
    const boxes = await page.evaluate(() => ({ normals: document.getElementById("rp-normals").checked, records: document.getElementById("rp-records").checked, cmp: document.getElementById("rp-cmp").value }));
    if (!boxes.normals || !boxes.records || boxes.cmp !== "normal") throw new Error(ex.slug + ": the story link didn't open with the normals and remarkable days on: " + JSON.stringify(boxes));
    const src = await page.textContent("#rp-source");
    if (/didn.t load/.test(src)) throw new Error(ex.slug + ": " + src.trim());
    const station = await page.inputValue("#rp-station");
    if (station !== ex.station) throw new Error(ex.slug + ": the page picked " + station + ", the saved run picked " + ex.station);
    const svg = await page.$eval("#rp-art svg", (s) => s.outerHTML);
    const source = await page.textContent("#rp-source");
    const fontCss = await page.evaluate(() => [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n").match(/@font-face\{[^}]+\}/g).join("\n"));
    // the print alone, at W x H
    const shot = await context.newPage();
    await shot.setViewportSize({ width: W, height: H });
    await shot.goto(base + "/rain-print.html", { waitUntil: "commit" }).catch(() => {});
    await shot.setContent("<!doctype html><style>" + fontCss + "html,body{margin:0;background:#F7F6F1}svg{display:block;width:" + W + "px;height:" + H + "px}</style>" + svg, { waitUntil: "load" });
    await shot.evaluate(() => document.fonts.ready);
    await shot.waitForTimeout(300);
    const png = await shot.screenshot({ type: "png" });
    if (process.env.PNG_DIR) writeFileSync(join(process.env.PNG_DIR, "rain-print-example-" + ex.slug + ".png"), png);
    // encode in the browser: WebP and JPG, the best quality that fits MAX_KB
    const out = await shot.evaluate(async ({ b64, max }) => {
      const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      c.getContext("2d").drawImage(img, 0, 0);
      const enc = (type) => { for (let q = 0.9; q >= 0.4; q -= 0.05) { const d = c.toDataURL(type, q); if ((d.length - d.indexOf(",") - 1) * 0.75 <= max * 1024) return { d, q: Math.round(q * 100) / 100 }; } return null; };
      return { webp: enc("image/webp"), jpg: enc("image/jpeg") };
    }, { b64: png.toString("base64"), max: MAX_KB });
    for (const k of ["webp", "jpg"]) {
      if (!out[k]) throw new Error(ex.slug + ": " + k + " won't fit in " + MAX_KB + " KB");
      const buf = Buffer.from(out[k].d.split(",")[1], "base64");
      const path = "img/rain-print-example-" + ex.slug + "." + k;
      writeFileSync(ROOT + path, buf);
      console.log(path + ": " + (buf.length / 1024).toFixed(1) + " KB, quality " + out[k].q);
    }
    console.log(ex.slug + ": " + source.trim());
    await context.close();
  }
} finally { await browser.close(); srv.close(); }
