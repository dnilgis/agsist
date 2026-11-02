#!/usr/bin/env node
/* scripts/render_rp_letter_large.mjs: the large readable copies of the two sample box letters
 * (fx/letterzoom, 2026-10-31), opened full size by components/rp-letterzoom.js.
 *
 * The letters are the shipped one (components/rp-insert.js), drawn in Chromium with the Rain Print fonts
 * from the real 2012 Ames NOAA answers (data/rain-print-examples/2012-ames-ia.json), the same way as
 * scripts/render_rp_business_letter.mjs (the small business sample) and test/rain-print-insert.test.mjs
 * (the small retail sample). Saves, at W x H, at most MAX_KB each:
 *   img/rain-print-insert-letter-sample-lg.webp     (no note, like the retail sample)
 *   img/rain-print-business-letter-sample-lg.webp   (the business sample note)
 *
 * Run by hand after the letter changes:
 *   node scripts/render_rp_letter_large.mjs
 * Needs Playwright (PLAYWRIGHT_PATH), Chromium (CHROMIUM_PATH) and python3 with Pillow.
 */
import { readFileSync, existsSync, statSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { guard } from './_argguard.mjs'; guard(import.meta.url);

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const W = 1700, H = 2199, MAX_KB = 250;
export const NOTE = "Thanks for another year. This is 2012 at Ames, the dry one we all remember. From all of us at the co-op.";
export const FROM = "Your co-op";
export const NAME = "The Olson Farm";
const SETS = [
  { out: "img/rain-print-insert-letter-sample-lg.webp", note: "", from: "", name: "" },
  { out: "img/rain-print-business-letter-sample-lg.webp", note: NOTE, from: FROM, name: NAME }
];
const { chromium } = await import(PW);

const FONTS = readFileSync(join(ROOT, "rain-print.html"), "utf8").match(/@font-face\{[^}]*\/fonts\/rp-[^}]*\}/g).join("\n");
const types = { ".js": "text/javascript", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html" };
const PAGE = `<!doctype html><meta charset="utf-8"><style>${FONTS} body{margin:0;background:#fff}</style><div id="o"></div>
<script src="/components/qr.js"></script><script src="/components/rain-print.js"></script>
<script src="/components/rain-print-art.js"></script><script src="/components/rp-insert.js"></script>`;
const srv = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/__letter.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE); return; }
  const p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
  if (!p.startsWith(ROOT) || !existsSync(p) || !statSync(p).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
  res.end(readFileSync(p));
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + srv.address().port;

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(base + "/__letter.html", { waitUntil: "load" });

for (const set of SETS) {
const info = await page.evaluate(async ({ W, H, NOTE, FROM, NAME }) => {
  const RP = window.RainPrint, A = window.AgRainArt, INS = window.AgRpInsert;
  const ex = await (await fetch("/data/rain-print-examples/2012-ames-ia.json")).json();
  const sidOf = (u) => new URL(u).searchParams.get("sid");
  const q = ex.requests.filter((r) => r.url.includes("StnData?sid=") && sidOf(r.url) === ex.station && new URL(r.url).searchParams.get("sdate") !== "por").pop();
  const days = RP.closeOpenS(q.body.data.map((row, i) => {
    const p = RP.parsePcpn(row[1]), dt = new Date(row[0] + "T00:00:00");
    return { date: row[0], v: p.v, flag: p.flag, t: null, s: row[3] !== undefined ? RP.parsePcpn(row[3]).v : null, m: dt.getMonth(), d: dt.getDate(), doy: i };
  }));
  const D = RP.derive(days);
  const nq = ex.requests.find((r) => r.url.includes("StnData?params=") && decodeURIComponent(r.url).includes('"normal"'));
  const byDate = new Map();
  nq.body.data.forEach((row) => { const v = RP.parsePcpn(row[1]).v; if (v !== null) byDate.set(row[0].slice(5), v); });
  const ov = RP.overlayDaily(days, byDate);
  const I = {
    style: "r1", year: 2012, place: "Ames, Iowa", name: NAME, dedication: "", days, D, showDry: RP.showDry(D), axisLen: D.n,
    ov, ovNote: RP.cmpNoteFor("normal"), showNormals: true, markers: RP.markersOn([], 2012, D.n), records: [],
    qr: { matrix: RP.standardMatrix(), serial: "No. 0001" }, preview: null, gauge: "Weather station: Ames, IA, 2.0 mi from Ames"
  };
  await document.fonts.load("600 46px 'Fraunces'"); await document.fonts.load("400 16px 'IBM Plex Sans'");
  await document.fonts.load("500 12px 'IBM Plex Sans'"); await document.fonts.load("italic 400 16px 'Fraunces'");
  await document.fonts.ready;
  const art = A.render(I);
  const F = A.facts(I, { unplaced: A.lastUnplaced() });
  const svg = INS.render({ facts: F, mini: art, serial: "No. 0001", gift: NOTE, giftFrom: FROM || "", qr: RP.standardMatrix(), px: [W, H],
    station: { words: "Ames, IA", away: "2.0 miles", kind: "volunteer" }, source: "NOAA’s daily records", offer: null, today: "2026-10-19" });
  document.getElementById("o").innerHTML = svg;
  await document.fonts.ready;
  return { overflow: INS.lastOverflow(), total: F.totalText, verdict: F.verdict };
}, { W, H, NOTE: set.note, FROM: set.from, NAME: set.name });
await page.waitForTimeout(300);
const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "rpbl-"));
const png = join(dir, "letter.png");
await page.locator("#o > svg").screenshot({ path: png });
if (errs.length) throw new Error("page errors: " + errs.join(" | "));
if (info.overflow) throw new Error("the letter overflows: " + JSON.stringify(info.overflow));
const kb = execFileSync("python3", ["-I", "-c", `
import sys, os
from PIL import Image
src, out, cap = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert("RGB")
for q in (82, 76, 70, 64, 58, 52):
    im.save(out, "WEBP", quality=q, method=6)
    if os.path.getsize(out) <= cap * 1024: break
print(round(os.path.getsize(out) / 1024, 1))
`, png, join(ROOT, set.out), String(MAX_KB)]).toString().trim();
console.log(JSON.stringify({ out: set.out, kb: Number(kb), ...info }));
if (Number(kb) > MAX_KB) throw new Error("over " + MAX_KB + " KB");

}
await browser.close(); srv.close();
