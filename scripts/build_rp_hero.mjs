#!/usr/bin/env node
/* scripts/build_rp_hero.mjs: the year behind the drawing loop at the top of
 * /rain-print (components/rain-print-hero.js, Sig 2026-10-21), baked into
 * data/rain-print-hero.json so the loop never asks NOAA anything.
 *
 * The year is 1993 at Des Moines, Iowa (the flood year), from the real NOAA
 * answers already saved for the page's example link
 * (data/rain-print-examples/1993-des-moines-ia.json, scripts/fetch_rain_print_examples.mjs).
 * The page's own engine draws it in Chromium, every option on: the 30-year
 * normals, the remarkable days, snow (the station keeps snowfall), the
 * temperature stripes, frost, corn stages with plant drawings against a usual
 * year, and hail near town from our own records (data/hail). The name is
 * "Example Farm" and the three marked days are made-up sample dates, which the
 * page says with an "Example print" tag.
 *
 * One answer is not in the saved file: the station's 1991-2020 normal daily
 * highs and lows (ACIS StnData maxt/mint normal "91"), which the stripes and
 * the usual-year corn need. This script asks NOAA for that one live, the same
 * URL the page asks. RCC-ACIS can't be reached from the sandbox this was
 * built in; GitHub Actions can (.github/workflows/rain-print-examples.yml runs
 * this after the fetch). Without those normals nothing is written: the page
 * then keeps its example picture, never a loop with the stripes left off.
 *
 * The file keeps the art's input with the days as columns and numbers to 4
 * places; before writing, the script draws the print from the file
 * (AgRainHero.expand) and from the engine's own input and requires the two
 * SVGs to be the same, character for character.
 *
 *   node scripts/build_rp_hero.mjs           build (needs NOAA ACIS, Playwright and Chromium)
 *   node scripts/build_rp_hero.mjs --check   check the saved file (offline)
 * Env: PLAYWRIGHT_PATH, CHROMIUM_PATH; RP_HERO_OUT (another output path, for a look without
 * touching the real file); RP_HERO_NORMALS (a saved ACIS answer to use instead of asking NOAA:
 * for a look in the sandbox only; the file is then marked standin and --check refuses it).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { answerOf } from "./rain_print_examples_pack.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT = process.env.RP_HERO_OUT || ROOT + "data/rain-print-hero.json";
const SLUG = "1993-des-moines-ia", PLACE = "Des Moines, IA", YEAR = 1993;
// made-up sample days, said so on the page; planting and harvest are two of them, so the corn has its season
const MARKS = [["1993-05-12", "Planted"], ["1993-06-14", "First cutting"], ["1993-10-22", "Harvest done"]];
const MAX_KB = 24;   // gzip keeps it a few KB on the wire
export const QUERY = { place: PLACE, year: String(YEAR), cmp: "normal", style: "r1", normals: "1", records: "1", frost: "1", heat: "1", ribbon: "1",
  crop: "corn", plant: MARKS[0][0], harvest: MARKS[2][0], plants: "1", ghost: "1", name: "Example Farm" };
MARKS.forEach(([d, l], i) => { QUERY["m" + (i + 1)] = d + " " + l; });

const r4 = (v) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v);
function round(o) { if (Array.isArray(o)) return o.map(round); if (o && typeof o === "object") { const x = {}; for (const k of Object.keys(o)) x[k] = round(o[k]); return x; } return r4(o); }
/* the art input -> the file's compact input: days as columns, no QR matrix (the page has the standard one), numbers to 4 places */
export function compact(I) {
  const keep = {};
  for (const k of Object.keys(I)) if (!["days", "qr", "fontCss", "watermark", "bleed", "px", "idPrefix"].includes(k) && I[k] !== undefined) keep[k] = I[k];
  const d = I.days, cols = { v: d.map((x) => x.v), flag: d.map((x) => (x.flag ? x.flag.charAt(0) : " ")).join(""), t: d.map((x) => x.t), s: d.map((x) => x.s), sT: d.map((x, i) => (x.sT ? i : -1)).filter((i) => i >= 0) };
  const other = new Set(); d.forEach((x) => Object.keys(x).forEach((k) => { if (!["date", "v", "flag", "t", "s", "m", "d", "doy", "sT"].includes(k)) other.add(k); }));
  if (other.size) throw new Error("a day field the file doesn't keep: " + [...other].join(", "));
  if (d.some((x) => x.flag && x.flag.length > 1)) throw new Error("a day flag longer than one letter");
  return round(Object.assign(keep, { days: cols }));
}

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
async function browser() {
  const pw = await import(process.env.PLAYWRIGHT_PATH ? pathToFileURL(process.env.PLAYWRIGHT_PATH).href : "playwright");
  return pw.chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
}

// draw the file and the input it came from; the SVGs must match
async function sameSvg(page, file, input) {
  return page.evaluate(({ file, input }) => {
    const m = RainPrint.standardMatrix();
    const a = AgRainArt.render(Object.assign({}, input, { qr: { matrix: m, serial: "" } }));
    const b = AgRainArt.render(AgRainHero.expand(file, m));
    return a === b ? "" : "differs at " + [...a].findIndex((c, i) => c !== b[i]) + " of " + a.length;
  }, { file, input });
}

async function build() {
  const ex = JSON.parse(readFileSync(ROOT + "data/rain-print-examples/" + SLUG + ".json", "utf8"));
  const answers = new Map(ex.requests.map((q) => [q.url, answerOf(q)]));
  const standin = process.env.RP_HERO_NORMALS ? JSON.parse(readFileSync(process.env.RP_HERO_NORMALS, "utf8")) : null;
  const srv = await serve(), base = "http://127.0.0.1:" + srv.address().port, b = await browser();
  try {
    const c = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    const missed = [], live = [];
    await c.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
      const url = r.request().url(), host = new URL(url).host, h = { "Access-Control-Allow-Origin": "*" };
      if (answers.has(url)) return r.fulfill({ json: answers.get(url), headers: h });
      // the one live ask: the station's normal daily highs and lows
      if (host === "data.rcc-acis.org" && /"name":"maxt","normal":"91"/.test(decodeURIComponent(url))) {
        if (standin) return r.fulfill({ json: standin[YEAR] || standin, headers: h });
        try {
          const res = await fetch(url, { headers: { "User-Agent": "agsist.com rain print hero (https://agsist.com/rain-print; by hand)" } });
          const j = await res.json(); live.push(url + " " + res.status);
          return r.fulfill({ json: j, headers: h });
        } catch (e) { missed.push(url + " (" + e.message + ")"); return r.fulfill({ json: { error: "unreachable" }, headers: h }); }
      }
      missed.push(url);
      return r.fulfill({ json: { error: "not saved" }, headers: h });
    });
    const page = await c.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base + "/rain-print.html?" + new URLSearchParams(QUERY));
    await page.waitForFunction(() => window.RainPrint && RainPrint.drawInput && RainPrint.drawInput() && /data-rp="crop"/.test(document.getElementById("rp-art").innerHTML), null, { timeout: 90000 });
    await page.waitForFunction(() => { const t = RainPrint.drawInput().input.temp; return t && (t.ribbon || t.foot.some((x) => /stripes left off/.test(x))); }, null, { timeout: 60000 });
    const d = await page.evaluate(async () => {
      const x = RainPrint.drawInput();
      const hail = await AgRainDraw.loadHail(x).catch(() => null);
      return { x, hail };
    });
    const I = d.x.input;
    if (errors.length) throw new Error("page errors: " + errors.join("; "));
    if (!I.temp || !I.temp.ribbon) throw new Error("no temperature stripes: the station's normal highs and lows did not come (" + (missed.join(", ") || "no answer") + "). Nothing written.");
    if (!I.crop || !I.crop.ghost) throw new Error("no usual-year corn: the normals did not come. Nothing written.");
    const file = {
      schema: "agsist-rain-print-hero/1",
      about: "The drawing loop at the top of /rain-print (components/rain-print-hero.js). A real NOAA year with every option on; the name and the three marked days are made up for the example. Made by scripts/build_rp_hero.mjs.",
      source: "NOAA RCC-ACIS daily records and 1991-2020 normals, through components/rain-print.js; hail near town: " + ((d.hail && d.hail.srcs && d.hail.srcs.join(", ")) || "none in our records"),
      made: new Date().toISOString().slice(0, 10), standin: !!standin,
      place: d.x.place, year: d.x.year, lat: d.x.lat, lon: d.x.lon, link: "/rain-print?" + new URLSearchParams(QUERY),
      hail: d.hail && d.hail.list ? { list: d.hail.list.map((h) => round(h)), srcs: d.hail.srcs } : null,
      input: compact(I)
    };
    await page.addScriptTag({ url: base + "/components/rain-print-hero.js" });
    const diff = await sameSvg(page, file, I);
    if (diff) throw new Error("the file does not draw the same print: " + diff);
    const json = JSON.stringify(file);
    if (json.length > MAX_KB * 1024) throw new Error("the file is " + Math.round(json.length / 1024) + " KB, over " + MAX_KB);
    writeFileSync(OUT, json + "\n");
    console.log("wrote " + OUT + " (" + Math.round(json.length / 102.4) / 10 + " KB" + (standin ? ", STAND-IN normals: not for the site" : "") + "); live: " + (live.join(", ") || "none") + "; hail days: " + (file.hail ? file.hail.list.length : 0));
  } finally { await b.close(); srv.close(); }
}

async function check() {
  if (!existsSync(OUT)) { console.log("no " + OUT + " yet (the page keeps its example picture)"); return; }
  const f = JSON.parse(readFileSync(OUT, "utf8"));
  const bad = [];
  if (f.schema !== "agsist-rain-print-hero/1") bad.push("schema");
  if (f.standin) bad.push("made with stand-in normals, not NOAA's");
  if (!f.input || !f.input.temp || !f.input.temp.ribbon) bad.push("no temperature stripes");
  if (f.input && f.input.name !== "Example Farm") bad.push("the name is not Example Farm");
  if (JSON.stringify(f).length > MAX_KB * 1024) bad.push("over " + MAX_KB + " KB");
  if (bad.length) { console.error("rain-print-hero.json: " + bad.join("; ")); process.exit(1); }
  console.log("rain-print-hero.json ok (" + f.place + " " + f.year + ", made " + f.made + ")");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--check")) await check();
  else await build().catch((e) => { console.error(String(e && e.message || e)); process.exit(1); });
}
