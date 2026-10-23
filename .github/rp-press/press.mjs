#!/usr/bin/env node
/* Press images through the page's own maker "Test print PDF (standard code)" path:
 * rain-print.html served from SITE, NOAA/Open-Meteo answered from saved files only
 * (anything not saved fails and is listed), the 13 x 19 sheet PDF taken, its JPEG
 * pulled out and the 16.5 x 11 in art box cut from it (4950 x 3300).
 *   node press.mjs <site dir> <query> <out.jpg> <saved.json>...
 * prints JSON: {status, source, missed[], why[], errors[]}
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

const [SITE0, query, outJpg, ...saved] = process.argv.slice(2);
const SITE = normalize(SITE0 + "/");
const { answerOf } = await import(pathToFileURL(SITE + "scripts/rain_print_examples_pack.mjs").href);
const { pdfJpeg } = await import(pathToFileURL(SITE + "scripts/rp_buyer_render.mjs").href);
const MAKER_HASH = /var MAKER_HASH = '([0-9a-f]{64})'/.exec(readFileSync(SITE + "components/rain-print.js", "utf8"))[1];
const answers = new Map();
for (const f of saved) for (const q of JSON.parse(readFileSync(f, "utf8")).requests) if (q.status === 200) answers.set(q.url, answerOf(q));
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs");

const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const srv = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let p = normalize(join(SITE, decodeURIComponent(u.pathname)));
  if (!extname(p) && existsSync(p + ".html")) p += ".html";
  if (!p.startsWith(SITE) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
  res.end(readFileSync(p));
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const base = "http://127.0.0.1:" + srv.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const missed = [], errors = [], blocked = new Set();
let result = {};
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block", acceptDownloads: true });
  await ctx.addInitScript((h) => { try { localStorage.setItem("rp-maker", h); } catch (e) {} }, MAKER_HASH);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const url = r.request().url(), host = new URL(url).host;
    if (host === "data.rcc-acis.org" || host === "geocoding-api.open-meteo.com") {
      if (answers.has(url)) return r.fulfill({ json: answers.get(url), headers: { "Access-Control-Allow-Origin": "*" } });
      missed.push(url);
      return r.fulfill({ status: 503, json: { error: "not saved" }, headers: { "Access-Control-Allow-Origin": "*" } });
    }
    blocked.add(host);
    return r.abort();
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  await page.goto(base + "/rain-print.html?" + query + "&maker=1");
  await page.waitForFunction(() => {
    const st = (document.getElementById("rp-status") || {}).textContent || "";
    return document.querySelector("#rp-art svg") && /days recorded/.test(document.getElementById("rp-source").textContent) &&
      /^Drawn from the records/.test(st) && !/Still reading|Adding the 30-year normal/.test(st);
  }, null, { timeout: 120000 });
  await page.waitForTimeout(8000);
  result = await page.evaluate(() => ({
    status: document.getElementById("rp-status").textContent.trim(),
    source: document.getElementById("rp-source").textContent.trim(),
    station: (document.getElementById("rp-station") || {}).value || "",
    why: [...document.querySelectorAll("[id$='-why']")].filter((e) => !e.hidden && e.textContent.trim()).map((e) => e.id + ": " + e.textContent.trim()),
    art: [...document.querySelectorAll("#rp-art svg text")].map((t) => t.textContent.trim()).filter(Boolean),
    preview: (() => { const p = document.getElementById("rp-preview-line"); return p && !p.hidden ? p.textContent.trim() : ""; })(),
  }));
  const btn = 'button[data-qr="standard"]';
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.$eval(btn, (b) => b.click())]);
  const chunks = []; for await (const c of await d.createReadStream()) chunks.push(c);
  const pdf = Buffer.concat(chunks);
  result.note = await page.evaluate(() => document.getElementById("rp-dl-note").textContent.trim());
  writeFileSync(outJpg, pdfJpeg(pdf));
  result.file = d.suggestedFilename();
} catch (e) { errors.push("run: " + String(e).slice(0, 300)); }
finally { await browser.close(); srv.close(); }
console.log(JSON.stringify(Object.assign(result, { missed, blocked: [...blocked], errors }), null, 1));
