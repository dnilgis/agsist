#!/usr/bin/env node
/* scripts/render_print_of_day.mjs: the Daily's "Print of the day" picture.
 *
 * Draws the county's Rain Print with the county print engine itself
 * (components/rain-county-print.js, the drawing every county rain page shows),
 * from the same data-* fields the county page carries and the same
 * data/rain/daily/<st>.json days, in headless Chromium, and saves it as a PNG.
 * Nothing is drawn by hand. The engine refuses (and this script fails) when
 * the days do not match the page, exactly as on the county page.
 *
 *   node scripts/render_print_of_day.mjs <pick.json> <out.png>
 *
 * pick.json is scripts/print_of_day.py's answer. Exit 0 = PNG written;
 * anything else = no picture, and the Daily leaves the slot out.
 * Playwright: PLAYWRIGHT_PATH (default /home/user/node_modules/playwright/index.mjs,
 * or the "playwright" package); Chromium: CHROMIUM_PATH (default: Playwright's own).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize, dirname } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const [pickPath, outPath] = process.argv.slice(2);
if (!pickPath || !outPath) { console.error("usage: render_print_of_day.mjs <pick.json> <out.png>"); process.exit(2); }
const pick = JSON.parse(readFileSync(pickPath, "utf8"));
if (!pick || !pick.fig || !pick.fig.st || !pick.fig.fips) { console.error("no pick"); process.exit(3); }

const WIDTH = 560;          // CSS px (the email card's width); saved at 2x
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const attrs = Object.entries(pick.fig).filter(([k]) => /^[a-z]+$/.test(k))
  .map(([k, v]) => ` data-${k}="${esc(v)}"`).join("");
const harness = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#ffffff}
#rc-print{margin:0;width:${WIDTH}px}.rc-print-art svg{display:block;width:${WIDTH}px;height:auto}</style>
<figure id="rc-print"${attrs}><div class="rc-print-art"></div></figure>
<script src="/components/rain-county-print.js"></script>`;

const TYPES = { ".js": "text/javascript", ".woff2": "font/woff2", ".json": "application/json", ".css": "text/css" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split("?")[0]);
  if (path === "/__pod.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(harness); return; }
  const p = normalize(join(ROOT, path));
  if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;

let pw;
try { pw = await import(process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs"); }
catch { pw = await import("playwright"); }
const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH }
  : (existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {});
const browser = await pw.chromium.launch(launch);
let code = 1;
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 400 }, deviceScaleFactor: 2 });
  // only our own files: nothing is fetched from anywhere else
  await page.route("**/*", (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await page.goto(base + "/__pod.html");
  const drawn = await page.waitForFunction(() => {
    const f = document.getElementById("rc-print");
    return f && f.classList.contains("rc-print-on") && f.querySelector(".rc-print-art svg");
  }, null, { timeout: 45000 }).then(() => true, () => false);
  if (!drawn) {
    console.error("render: the county print engine did not draw this county (days or total do not match, or a file failed)");
  } else {
    await page.evaluate(() => document.fonts && document.fonts.ready);
    const el = await page.$(".rc-print-art svg");
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, await el.screenshot({ type: "png" }));
    console.log("render: wrote " + outPath);
    code = 0;
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(code);
