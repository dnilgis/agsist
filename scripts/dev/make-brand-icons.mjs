/* AGSIST browser and home-screen icons, from one drawing.
 *
 * The mark: a red barn with a gold door and a gold hay-loft square under a
 * cream roof line, on the wordmark green tile. Sig picked it Oct 21, 2026
 * ("the red barn with the gold door, on the tile") from ten drawn options
 * (tab strip and home-screen mocks); the drawing is the one
 * src/art_options.py drew for that board (barn-tile, barn-app, barn-mask).
 *
 *   node scripts/dev/make-brand-icons.mjs          # write img/ icons, /favicon.ico, rain-print.html's inline icons
 *   node scripts/dev/make-brand-icons.mjs --check  # exit 1 if a written file differs from the drawing
 *
 * Writes:
 *   img/icon.svg               tab icon, the tile; a lighter tile under prefers-color-scheme: dark
 *   img/favicon.ico            16, 32, 48 (PNG entries); /favicon.ico is the same file for
 *                              pages with no icon link (redirect stubs, print sheets) and crawlers
 *   img/favicon-16.png, img/favicon-32.png                 the tile
 *   img/apple-touch-icon.png   180, full bleed (iOS rounds the corners itself), barn at 80%
 *   img/icon-192.png, img/icon-512.png                    rounded tile, barn at 80%
 *   img/icon-192-maskable.png, img/icon-512-maskable.png  full bleed, barn at 72% (inside the
 *                                                          80% safe circle Android crops to)
 *   rain-print.html            its two inline PNG icons (16 and 32) are img/favicon-16/32.png
 * Needs Playwright + Chromium (rasterizes the SVG the way the browser does).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";

export const GREEN = "#16301F";   // wordmark green, the tile
export const CREAM = "#F4EFE1";   // wordmark ink on dark, the roof line
export const GOLD = "#D4A23F";    // the i dot and .com, the door and loft
export const GREEN_ON_DARK = "#1E4A30"; // tile in dark tab strips, so its edge still shows

export const RED = "#B5442E";     // the barn

// On the 32 x 32 grid: the barn (body), the roof line over it, the door with its
// cross brace cut out, and the loft square.
const BARN = "M4.5 29.5V15.5L8.5 9L16 4.8L23.5 9L27.5 15.5V29.5Z";
const ROOF = "M3.6 16.2L8 8.6L16 4L24 8.6L28.4 16.2";
const BRACE = "M12.2 19.6L19.8 28.6M19.8 19.6L12.2 28.6";

/** The icon on a 32 x 32 grid. k shrinks the barn about the centre; rx is the tile corner. */
export function drawIcon({ k = 0.84, rx = 7, dark = true } = {}) {
  const style = dark ? `<style>@media (prefers-color-scheme:dark){.t{fill:${GREEN_ON_DARK}}}</style>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${style}`
    + `<rect class="t" width="32" height="32" rx="${rx}" fill="${GREEN}"/>`
    + `<g transform="translate(16 16) scale(${k}) translate(-16 -16)">`
    + `<mask id="b" maskUnits="userSpaceOnUse" x="-8" y="-8" width="48" height="48"><rect x="-8" y="-8" width="48" height="48" fill="#fff"/>`
    + `<path d="${BRACE}" stroke="#000" stroke-width="1.3" fill="none"/></mask>`
    + `<path fill="${RED}" d="${BARN}"/>`
    + `<path fill="none" stroke="${CREAM}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" d="${ROOF}"/>`
    + `<rect fill="${GOLD}" mask="url(#b)" x="11.5" y="19" width="9" height="10.5"/>`
    + `<rect fill="${GOLD}" x="14" y="10.6" width="4" height="4"/></g></svg>\n`;
}

const TILE = { k: 0.84, rx: 7, dark: false };
export const PNGS = [
  // [file, px, drawing]
  ["img/favicon-16.png", 16, TILE],
  ["img/favicon-32.png", 32, TILE],
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

/** rain-print.html with its two inline PNG icons set to these 16 and 32 px files. */
export const INLINE_PAGE = "rain-print.html";
export function withInlineIcons(html, png16, png32) {
  let n = 0;
  const out = html.replace(/(<link rel="icon" type="image\/png" sizes="(16|32)x\2" href="data:image\/png;base64,)[A-Za-z0-9+\/=]+"/g,
    (m, head, s) => { n++; return head + (s === "16" ? png16 : png32).toString("base64") + '"'; });
  if (n !== 2) throw new Error(INLINE_PAGE + ": expected its 16 and 32 px inline icons, found " + n);
  return out;
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
    if (!bad) {
      if (!readFileSync(ROOT + "favicon.ico").equals(readFileSync(ROOT + "img/favicon.ico"))) { console.log("stale favicon.ico (not img/favicon.ico)"); bad++; }
      const page = readFileSync(ROOT + INLINE_PAGE, "utf8");
      if (withInlineIcons(page, readFileSync(ROOT + "img/favicon-16.png"), readFileSync(ROOT + "img/favicon-32.png")) !== page) { console.log("stale", INLINE_PAGE, "inline icons"); bad++; }
    }
    if (bad) process.exit(1);
    console.log("brand icons ok");
    return;
  }
  const { chromium } = await import(PW);
  const b = await chromium.launch({ executablePath: CHROME });
  const page = await (await b.newContext({ deviceScaleFactor: 1 })).newPage();
  for (const [f, px, opt] of PNGS) out.set(f, await rasterize(page, drawIcon(opt), px));
  const ico = [];
  for (const px of ICO_SIZES) ico.push([px, await rasterize(page, drawIcon(TILE), px)]);
  await b.close();
  out.set("img/favicon.ico", packIco(ico));
  out.set("favicon.ico", out.get("img/favicon.ico"));
  out.set(INLINE_PAGE, Buffer.from(withInlineIcons(readFileSync(ROOT + INLINE_PAGE, "utf8"), out.get("img/favicon-16.png"), out.get("img/favicon-32.png"))));
  for (const [f, buf] of out) { writeFileSync(ROOT + f, buf); console.log("wrote", f, buf.length, "bytes"); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
