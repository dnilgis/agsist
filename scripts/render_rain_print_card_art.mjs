#!/usr/bin/env node
/* scripts/render_rain_print_card_art.mjs: the Rain Print drawn on the /rain-print
 * share image (img/og/rain-print.jpg), made by the shipped engine from real
 * NOAA answers.
 *
 * It opens components/rain-print.js and rain-print-art.js in Chromium, serves
 * the saved answers in data/rain-print-examples/<slug>.json for every request
 * the engine makes (the town lookup, the station lists, each station's days,
 * the 30-year normal), and runs RainPrint.previewArt() on the example link, the
 * same chain the page runs. Nothing is drawn by hand and nothing is asked of
 * NOAA here. A request with no saved answer fails the run.
 *
 * Writes scripts/cardart/rain-print-<slug>.jpg (the flat print, 1800 x 1200).
 * scripts/build_share_images.py frames it and draws the card with Pillow, so
 * the data workflows never need a browser. Run this again only when the art
 * engine changes the look:
 *
 *   node scripts/render_rain_print_card_art.mjs [slug]     default 2012-ames-ia
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { answerOf } from "./rain_print_examples_pack.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const slug = process.argv[2] || "2012-ames-ia";
const ex = JSON.parse(readFileSync(ROOT + "data/rain-print-examples/" + slug + ".json", "utf8"));
const answers = new Map(ex.requests.map((r) => [r.url, r]));

const TYPES = { ".js": "text/javascript", ".woff2": "font/woff2", ".html": "text/html", ".css": "text/css" };
const server = createServer((req, res) => {
  const p = normalize(join(ROOT, decodeURIComponent(req.url.split("?")[0])));
  if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;

// the page's own font faces, as rain-print.html declares them
const faces = [...readFileSync(ROOT + "rain-print.html", "utf8").matchAll(/@font-face\{[^}]*rp-[^}]*\}/g)].map((m) => m[0]).join("\n");
const harness = `<!doctype html><meta charset="utf-8"><style>${faces}html,body{margin:0;background:#fff}#art svg{display:block;width:1800px;height:1200px}</style>
<div id="art"></div>
<script src="/components/util.js"></script><script src="/components/qr.js"></script><script src="/components/rp-logo.js"></script>
<script src="/components/rain-print-art.js"></script><script src="/components/rain-print.js"></script>`;

const { chromium } = await import(PW);
const browser = await chromium.launch({ executablePath: CHROME });
const missed = [];
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 1 });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url === base + "/__card.html") return route.continue();
    const a = answers.get(url);
    if (!a) { missed.push(url); return route.fulfill({ status: 599, body: "" }); }
    return route.fulfill({ status: a.status, contentType: "application/json", body: JSON.stringify(answerOf(a)) });
  });
  await page.route(base + "/__card.html", (route) => route.fulfill({ status: 200, contentType: "text/html", body: harness }));
  await page.goto(base + "/__card.html");
  const got = await page.evaluate(async (query) => {
    // the art measures its words, so every face has to be in before it draws
    await Promise.all(["300 40px Fraunces", "600 40px Fraunces", "italic 400 40px Fraunces", "300 40px 'IBM Plex Sans'",
      "600 40px 'IBM Plex Sans'", "italic 400 40px 'IBM Plex Sans'", "400 40px 'IBM Plex Mono'", "500 40px 'IBM Plex Mono'"]
      .map((f) => document.fonts.load(f)));
    const s = window.RainPrint.fromParams(query);
    s.station = "";
    const r = await window.RainPrint.previewArt(window.RainPrint.encodeCode(s), {});
    document.getElementById("art").innerHTML = r.svg;
    await document.fonts.ready;
    return { station: r.station, days: r.days, preview: r.preview, place: r.place };
  }, ex.link.split("?")[1]);
  if (missed.length) throw new Error("no saved answer for: " + missed.join(", "));
  if (got.preview) throw new Error("drew as a preview, not a finished year");
  if (got.station !== ex.station) throw new Error("picked " + got.station + ", the saved run picked " + ex.station);
  await page.waitForTimeout(300);
  mkdirSync(ROOT + "scripts/cardart", { recursive: true });
  const out = ROOT + "scripts/cardart/rain-print-" + slug + ".jpg";
  writeFileSync(out, await page.locator("#art svg").screenshot({ type: "jpeg", quality: 92 }));
  console.log("wrote", out.slice(ROOT.length), JSON.stringify(got));
} finally {
  await browser.close();
  server.close();
}
