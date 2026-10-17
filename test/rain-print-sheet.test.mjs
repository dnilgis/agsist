/* Rain Print on 13 x 19 paper (2026-10-17, Sig): the print file is the 13 x 19 in
 * sheet, untrimmed, with the 3:2 art scaled to 16.5 x 11 in in the middle. The
 * framed print has a white mat (window about 16.5 x 10.5 in), so every mark the
 * art makes (name, dates, numbers, foot line, station line, QR and serial,
 * marked-day labels, remarkable days, logo) must sit inside the centred safe
 * window, RainPrint.SHEET.safe (one constant, in components/rain-print.js).
 *
 * The browser test draws the real art (components/rain-print-art.js, the print's
 * own fonts) for the saved 2012 Ames NOAA year onto the sheet exactly as
 * RainPrint.sheetBoxes() places it, and measures the box of every inked pixel
 * against the safe window: both styles, five marked days, the longest name and
 * line the page allows, remarkable days, the normals and a logo (wide and tall).
 * Needs Playwright and Chromium; that part is skipped where they are missing.
 *
 *   node --test test/rain-print-sheet.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { answerOf } from "../scripts/rain_print_examples_pack.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctx.window = ctx;
for (const f of ["components/qr.js", "components/rain-print.js", "components/rain-print-records.js"]) vm.runInNewContext(read(f), ctx);
const RP = ctx.RainPrint, REC = ctx.AgRainRecords;
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("the sheet: 13 x 19 paper, the 3:2 art at 16.5 x 11 centred, the mat and safe windows centred inside it", () => {
  const S = RP.SHEET, B = RP.sheetBoxes();
  assert.deepEqual([S.w, S.h], [19, 13], "landscape 13 x 19 paper");
  assert.deepEqual([S.art.w, S.art.h], [16.5, 11]);
  assert.equal(S.art.w / S.art.h, 1800 / 1200, "the art keeps its 3:2 shape");
  for (const k of ["art", "mat", "safe"]) {
    assert.ok(Math.abs(B[k].x * 2 + B[k].w - S.w) < 1e-9 && Math.abs(B[k].y * 2 + B[k].h - S.h) < 1e-9, k + " is centred");
  }
  assert.ok(S.safe.w <= S.mat.w && S.safe.h <= S.mat.h, "the safe window is inside the mat window");
  assert.ok(S.safe.w <= S.art.w && S.safe.h <= S.art.h, "and inside the art");
  const k = RP.safeInArt();
  assert.ok(Math.abs(k.y0 - 40.909) < 0.01 && Math.abs(k.x0 - 13.636) < 0.01, "the safe window in art units: " + JSON.stringify(k));
  // the print file uses these boxes, at 300 dpi, with no bleed and no crop marks; the digital file is the art alone
  const js = read("components/rain-print.js"), dc = js.slice(js.indexOf("function drawCanvas("), js.indexOf("function toBlob("));
  assert.match(dc, /sheet = sheetBoxes\(\);\n\s+pxW = Math\.round\(SHEET\.w \* DPI\); pxH = Math\.round\(SHEET\.h \* DPI\);/);
  assert.match(dc, /cx\.fillStyle = '#FFFFFF'; cx\.fillRect\(0, 0, pxW, pxH\);/, "the margin is the print's own white");
  assert.match(dc, /cx\.drawImage\(img, artAt\[0\], artAt\[1\], artPx\[0\], artPx\[1\]\);/);
  assert.match(dc, /pxW = P\.w \* DPI; pxH = P\.h \* DPI;/, "the digital file: the art alone, 18 x 12 in at 300 dpi");
  assert.ok(!/bleed|crop/i.test(dc.replace(/\/\*[\s\S]*?\*\//g, "")), "untrimmed: no bleed, no crop marks");
  assert.match(js, /pdfFromJpeg\(new Uint8Array\(buf\), c\.width, c\.height, SHEET\)/, "the PDF is the sheet's size");
});

// the 2012 Ames year, as the page reads it, with its normal and its remarkable days
function amesInput() {
  const ex = JSON.parse(read("data/rain-print-examples/2012-ames-ia.json"));
  const sidOf = (u) => new URL(u).searchParams.get("sid"), isPor = (u) => new URL(u).searchParams.get("sdate") === "por";
  const q = ex.requests.filter((r) => r.url.includes("StnData?sid=") && sidOf(r.url) === ex.station && !isPor(r.url)).pop();
  const p = ex.requests.filter((r) => r.url.includes("StnData?sid=") && sidOf(r.url) === ex.station && isPor(r.url)).pop();
  const days = RP.closeOpenS(q.body.data.map((row, i) => {
    const v = RP.parsePcpn(row[1]), dt = new Date(row[0] + "T00:00:00");
    return { date: row[0], v: v.v, flag: v.flag, t: null, s: row[3] !== undefined ? RP.parsePcpn(row[3]).v : null, m: dt.getMonth(), d: dt.getDate(), doy: i };
  }));
  const D = RP.derive(days);
  const nq = ex.requests.find((r) => r.url.includes("StnData?params=") && decodeURIComponent(r.url).includes('"normal"'));
  const byDate = new Map();
  nq.body.data.forEach((row) => { const v = RP.parsePcpn(row[1]).v; if (v !== null) byDate.set(row[0].slice(5), v); });
  const records = REC.find({ year: 2012, sid: ex.station, daily: q.body, por: answerOf(p), dailyElems: ["pcpn", "avgt", "snow", "maxt", "mint"], porElems: ["pcpn", "avgt"] }, {});
  return { days, D, showDry: RP.showDry(D), axisLen: D.n, ov: RP.overlayDaily(days, byDate), ovNote: RP.cmpNoteFor("normal"), showNormals: true, records, year: 2012 };
}

test("every mark on the print stays inside the mat's safe window: both styles, five days, the longest words, a logo", { skip }, async () => {
  const base = amesInput();
  const marks = RP.markersOn([["2012-03-02", "Calving start"], ["2012-05-01", "Planted corn"], ["2012-07-04", "Our wedding!"], ["2012-09-20", "First frost"], ["2012-10-20", "Harvest done"]]
    .map(([date, label]) => ({ date, label })), 2012, base.D.n);
  const L = RP.LIMITS;
  const words = [
    { name: "The Lindquist Home Farms".slice(0, L.name), dedication: "For Dad, his 40th crop on the home place. Love, Kate, Erik and the kids".slice(0, L.dedication) },
    { name: "W".repeat(L.name), dedication: "W".repeat(L.dedication) },
  ];
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x"), f = normalize(join(ROOT, decodeURIComponent(u.pathname)));
    if (!f.startsWith(ROOT) || !existsSync(f) || u.pathname === "/") { res.writeHead(u.pathname === "/" ? 200 : 404, { "content-type": "text/html" }); res.end("<!doctype html><title>t</title>"); return; }
    res.writeHead(200, { "content-type": { ".js": "text/javascript; charset=utf-8", ".woff2": "font/woff2" }[extname(f)] || "application/octet-stream" }); res.end(readFileSync(f));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("http://127.0.0.1:" + srv.address().port + "/");
    await page.addStyleTag({ content: [["Fraunces", "300 600", "normal", "rp-fraunces-opsz"], ["Fraunces", "400", "italic", "rp-fraunces-opsz-400i"], ["IBM Plex Sans", "300 600", "normal", "rp-plex-sans-var"], ["IBM Plex Sans", "400", "italic", "rp-plex-sans-400i"]]
      .map(([f, w, s, file]) => `@font-face{font-family:'${f}';font-weight:${w};font-style:${s};src:url(/fonts/${file}.woff2) format('woff2')}`).join("") });
    for (const f of ["components/qr.js", "components/rain-print.js", "components/rain-print-art.js"]) await page.addScriptTag({ url: "/" + f });
    await page.evaluate(() => Promise.all(["300 40px 'Fraunces'", "600 52px 'Fraunces'", "italic 400 21px 'Fraunces'", "400 16px 'IBM Plex Sans'", "500 16px 'IBM Plex Sans'", "italic 400 17px 'IBM Plex Sans'"].map((f) => document.fonts.load(f))));
    assert.deepEqual(errors, [], "the scripts load cleanly");
    const cases = [];
    for (const style of ["r1", "r2"]) for (const w of words) for (const logo of [null, [3, 1], [1, 1.4]]) cases.push({ style, ...w, logo });
    const results = await page.evaluate(async ({ base, marks, cases }) => {
      const RP = window.RainPrint, A = window.AgRainArt, B = RP.sheetBoxes(), PPI = 40;
      const logoUrl = (ar) => { const c = document.createElement("canvas"); c.width = Math.round(300 * ar[0]); c.height = Math.round(300 * ar[1]); const x = c.getContext("2d"); x.fillStyle = "#1E2125"; x.fillRect(0, 0, c.width, c.height); return { href: c.toDataURL("image/png"), w: c.width, h: c.height }; };
      const out = [];
      for (const k of cases) {
        const I = Object.assign({}, base, { style: k.style, place: "Ames, Iowa", name: k.name, dedication: k.dedication, markers: marks, qr: { matrix: RP.standardMatrix(), serial: "No. 0001" },
          gauge: "Weather station: Ames, IA, 2.0 mi from Ames", logo: k.logo ? logoUrl(k.logo) : null, px: [Math.round(B.art.w * PPI), Math.round(B.art.h * PPI)] });
        const svg = A.render(I);
        const img = new Image(); img.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })); await img.decode();
        const c = document.createElement("canvas"); c.width = Math.round(B.sheet.w * PPI); c.height = Math.round(B.sheet.h * PPI);
        const x = c.getContext("2d"); x.fillStyle = "#FFFFFF"; x.fillRect(0, 0, c.width, c.height);
        x.drawImage(img, Math.round(B.art.x * PPI), Math.round(B.art.y * PPI), Math.round(B.art.w * PPI), Math.round(B.art.h * PPI));
        const d = x.getImageData(0, 0, c.width, c.height).data;
        let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        for (let yy = 0; yy < c.height; yy++) for (let xx = 0; xx < c.width; xx++) {
          const i = (yy * c.width + xx) * 4;
          if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
        }
        out.push({ k: { style: k.style, name: k.name, logo: k.logo }, ink: { x0: x0 / PPI, y0: y0 / PPI, x1: (x1 + 1) / PPI, y1: (y1 + 1) / PPI }, safe: B.safe, unplaced: A.lastUnplaced(), logoAt: A.lastLogo() });
      }
      return out;
    }, { base, marks, cases });
    assert.equal(results.length, cases.length);
    for (const r of results) {
      const s = r.safe, i = r.ink, tag = JSON.stringify(r.k) + " ink " + JSON.stringify(i);
      assert.ok(i.x1 > i.x0 && i.y1 > i.y0, "something was drawn: " + tag);
      assert.ok(i.x0 >= s.x - 1e-6 && i.y0 >= s.y - 1e-6 && i.x1 <= s.x + s.w + 1e-6 && i.y1 <= s.y + s.h + 1e-6, "inside the safe window " + JSON.stringify(s) + ": " + tag);
      if (r.k.logo) assert.ok(r.logoAt, "the logo was drawn: " + tag);
    }
  } finally { await browser.close(); srv.close(); }
});
