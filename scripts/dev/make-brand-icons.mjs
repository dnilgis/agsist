/* AGSIST browser and home-screen icons, from one drawing.
 *
 * The mark: the lowercase "a" of the wordmark (same outline as
 * img/logo-agsist-*.svg) in cream on the wordmark green, with the gold square
 * of the "i" dot in the top right corner. Picked Oct 21, 2026 from four options
 * drawn for Sig (tab strip and home-screen mocks); the a with its own dot read
 * as a "d" at 16 px, so the square sits clear of the letter.
 *
 *   node scripts/dev/make-brand-icons.mjs          # write img/ icons + /favicon.ico
 *   node scripts/dev/make-brand-icons.mjs --check  # exit 1 if a written file differs from the drawing
 *
 * Writes:
 *   img/icon.svg               tab icon; a lighter tile under prefers-color-scheme: dark
 *   img/favicon.ico            16, 32, 48 (PNG entries); /favicon.ico is the same file for
 *                              pages with no icon link (redirect stubs, print sheets) and crawlers
 *   img/favicon-16.png, img/favicon-32.png
 *   img/apple-touch-icon.png   180, full bleed (iOS rounds the corners itself), mark at 80%
 *   img/icon-192.png, img/icon-512.png                    rounded tile, mark at 80%
 *   img/icon-192-maskable.png, img/icon-512-maskable.png  full bleed, mark at 72% (inside the
 *                                                          80% safe circle Android crops to)
 * Needs Playwright + Chromium (rasterizes the SVG the way the browser does).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";

export const GREEN = "#16301F";   // wordmark ink on light
export const CREAM = "#F4EFE1";   // wordmark ink on dark
export const GOLD = "#D4A23F";    // the i dot and .com
export const GREEN_ON_DARK = "#1E4A30"; // tile in dark tab strips, so its edge still shows

// "a" from the wordmark, font units, y up (x 28..617, y -8..566)
const A = "M274 566Q333 566 377.5 542.0Q422 518 446 479V558H617V0H446V79Q421 40 376.5 16.0Q332 -8 273 -8"
  + "Q205 -8 149.0 27.5Q93 63 60.5 128.5Q28 194 28 280Q28 366 60.5 431.0Q93 496 149.0 531.0Q205 566 274 566Z"
  + "M324 417Q273 417 237.5 380.5Q202 344 202 280Q202 216 237.5 178.5Q273 141 324 141Q375 141 410.5 178.0"
  + "Q446 215 446 279Q446 343 410.5 380.0Q375 417 324 417Z";

const r3 = (n) => +n.toFixed(3);

/** The icon on a 32 x 32 grid. k shrinks the mark about the centre; rx is the tile corner. */
export function drawIcon({ k = 1, rx = 7, dark = true } = {}) {
  const h = 17.5 * k, s = h / 574;                 // a is 574 units tall
  const cx = 16 + (14.6 - 16) * k, cy = 16 + (18.2 - 16) * k;
  const tx = r3(cx - s * (28 + 617) / 2), ty = r3(cy + s * (-8 + 566) / 2);
  const d = r3(5 * k), gx = r3(16 + 6.6 * k), gy = r3(16 - 11.6 * k);
  const style = dark ? `<style>@media (prefers-color-scheme:dark){.t{fill:${GREEN_ON_DARK}}}</style>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${style}`
    + `<rect class="t" width="32" height="32" rx="${rx}" fill="${GREEN}"/>`
    + `<path transform="translate(${tx} ${ty}) scale(${r3(s * 1000) / 1000} ${-r3(s * 1000) / 1000})" fill="${CREAM}" d="${A}"/>`
    + `<rect x="${gx}" y="${gy}" width="${d}" height="${d}" fill="${GOLD}"/></svg>\n`;
}

export const PNGS = [
  // [file, px, drawing]
  ["img/favicon-16.png", 16, { k: 1, rx: 7, dark: false }],
  ["img/favicon-32.png", 32, { k: 1, rx: 7, dark: false }],
  ["img/apple-touch-icon.png", 180, { k: 0.8, rx: 0, dark: false }],
  ["img/icon-192.png", 192, { k: 0.8, rx: 7, dark: false }],
  ["img/icon-512.png", 512, { k: 0.8, rx: 7, dark: false }],
  ["img/icon-192-maskable.png", 192, { k: 0.72, rx: 0, dark: false }],
  ["img/icon-512-maskable.png", 512, { k: 0.72, rx: 0, dark: false }],
];
export const ICO_SIZES = [16, 32, 48];

/** ICO container holding PNG images (every browser since IE 11 reads these). */
export function packIco(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(([px, buf], i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(px >= 256 ? 0 : px, e); head.writeUInt8(px >= 256 ? 0 : px, e + 1);
    head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(buf.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += buf.length;
  });
  return Buffer.concat([head, ...pngs.map(([, b]) => b)]);
}

async function rasterize(page, svg, px) {
  await page.setViewportSize({ width: px, height: px });
  const uri = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}img{display:block}</style>`
    + `<img src="${uri}" width="${px}" height="${px}">`);
  await page.waitForFunction(() => document.images[0].complete);
  return page.screenshot({ omitBackground: true, type: "png", clip: { x: 0, y: 0, width: px, height: px } });
}

async function main() {
  const check = process.argv.includes("--check");
  const out = new Map();
  out.set("img/icon.svg", Buffer.from(drawIcon()));
  if (check) {
    // PNG bytes vary with the Chromium build, so --check only re-draws the SVG and checks the files are there.
    let bad = 0;
    for (const [f, buf] of out) if (!existsSync(ROOT + f) || !readFileSync(ROOT + f).equals(buf)) { console.log("stale", f); bad++; }
    for (const f of [...PNGS.map((p) => p[0]), "img/favicon.ico", "favicon.ico"]) if (!existsSync(ROOT + f)) { console.log("missing", f); bad++; }
    if (bad) process.exit(1);
    console.log("brand icons ok");
    return;
  }
  const { chromium } = await import(PW);
  const b = await chromium.launch({ executablePath: CHROME });
  const page = await (await b.newContext({ deviceScaleFactor: 1 })).newPage();
  for (const [f, px, opt] of PNGS) out.set(f, await rasterize(page, drawIcon(opt), px));
  const ico = [];
  for (const px of ICO_SIZES) ico.push([px, await rasterize(page, drawIcon({ k: 1, rx: 7, dark: false }), px)]);
  await b.close();
  out.set("img/favicon.ico", packIco(ico));
  out.set("favicon.ico", out.get("img/favicon.ico"));
  for (const [f, buf] of out) { writeFileSync(ROOT + f, buf); console.log("wrote", f, buf.length, "bytes"); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
