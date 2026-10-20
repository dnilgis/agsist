#!/usr/bin/env node
/* The pictures and the "what happens next" words for a Rain Print buyer's
 * email (scripts/rp_buyer_email.py), made by the real page in a headless
 * browser, the same way the page makes them:
 *   proof.jpg   the page's own "Download a preview" PNG of the exact design
 *               (watermarked, as every preview is), cut to 1200 px wide;
 *   letter.jpg  for a print or framed print, the insert letter that goes in
 *               the box, with the gift note when there is one: the maker
 *               view's "Insert letter PDF", its page cut to 850 px wide.
 *               None for a digital file (no box) or a year not finished yet
 *               (the letter is made from the full year, like the print).
 *   words       RainPrint.paidText(): the same lines the thank-you page shows.
 * Nothing is uploaded anywhere: the email script attaches the files inline.
 *
 * THE FILES (files: true in in.json; Sig 2026-10-20: a digital file goes out
 * the moment the buyer approves the proof): renderFiles() makes, on the same
 * maker view Sig uses, the buyer's files at full size with no watermark and
 * the print's own short-link QR, no serial:
 *   the PDF   the art alone, 18 x 12 in (12 x 18 landscape), 300 dpi;
 *   the PNG   5400 x 3600 px, marked 300 dpi;
 *   the JPG   5400 x 3600 px, marked 300 dpi (shops that take only JPG);
 *   the guide "How to read your Rain Print", one 8.5 x 11 page (rp-insert.js,
 *             guide mode), with the gift note when there is one.
 * Each is checked here (pixel size, page size) before it is handed back.
 *
 *   node scripts/rp_buyer_render.mjs in.json outdir     -> prints JSON
 *   in.json: {design_url, product, gift_note?, files?, base? (default https://agsist.com)}
 * Needs Playwright (PLAYWRIGHT_PATH or the playwright package) and Chromium
 * (CHROMIUM_PATH, or Playwright's own). test/rp-buyer-email.test.mjs runs
 * renderOrder() against a local copy of the site with made-up rain data.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MAKER_HASH = /var MAKER_HASH = '([0-9a-f]{64})'/.exec(readFileSync(ROOT + "components/rain-print.js", "utf8"))[1];
const PRODUCTS = ["digital", "print12x18", "framed12x18"];

// the JPEG inside the page's one-page PDF (pdfFromJpeg in components/rain-print.js)
export function pdfJpeg(buf) {
  const s = Buffer.from(buf).toString("latin1");
  const i = s.indexOf("/DCTDecode");
  const m = /\/Length (\d+) >>\nstream\n/.exec(s.slice(i));
  if (i < 0 || !m) throw new Error("no JPEG in the letter PDF");
  const at = i + m.index + m[0].length;
  return Buffer.from(buf).subarray(at, at + Number(m[1]));
}

async function shrink(page, bytes, mime, width) {
  const b64 = await page.evaluate(async ([b64, mime, width]) => {
    const im = new Image();
    await new Promise((ok, bad) => { im.onload = ok; im.onerror = bad; im.src = "data:" + mime + ";base64," + b64; });
    const h = Math.round(im.naturalHeight * width / im.naturalWidth);
    const c = document.createElement("canvas"); c.width = width; c.height = h;
    const cx = c.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, width, h); cx.drawImage(im, 0, 0, width, h);
    return c.toDataURL("image/jpeg", 0.86).split(",")[1];
  }, [Buffer.from(bytes).toString("base64"), mime, width]);
  return Buffer.from(b64, "base64");
}

async function download(page, click) {
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), click()]);
  const chunks = [];
  for await (const c of await d.createReadStream()) chunks.push(c);
  return Buffer.concat(chunks);
}

// the sizes a file says it has: PNG IHDR, JPEG SOF, a one-page PDF's MediaBox (points)
export function pngSize(b) {
  b = Buffer.from(b);
  return b.length > 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString("latin1", 12, 16) === "IHDR" ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null;
}
export function jpegInfo(b) {
  b = Buffer.from(b);
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let dpi = null;
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m === 0xe0 && b.toString("latin1", i + 4, i + 8) === "JFIF" && b[i + 11] === 1) dpi = [b.readUInt16BE(i + 12), b.readUInt16BE(i + 14)];
    if (m >= 0xc0 && m <= 0xc2) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5), dpi };
    i += 2 + len;
  }
  return null;
}
export function pdfPage(b) {
  const s = Buffer.from(b).toString("latin1");
  if (!s.startsWith("%PDF-") || !/%%EOF\s*$/.test(s)) return null;
  const m = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(s), n = /\/Count (\d+)/.exec(s);
  return m ? { w: +m[1], h: +m[2], pages: n ? +n[1] : 0 } : null;
}
// what each file must be, or it is not sent (the art is 18 x 12 in at 300 dpi, the guide a letter page)
export const FILE_SPEC = { png: [5400, 3600], jpg: [5400, 3600], pdf: [1296, 864], guide: [612, 792] };
export function checkFile(kind, buf) {
  const want = FILE_SPEC[kind];
  if (kind === "png") { const z = pngSize(buf); return !!z && z[0] === want[0] && z[1] === want[1]; }
  if (kind === "jpg") { const z = jpegInfo(buf); return !!z && z.w === want[0] && z.h === want[1] && !!z.dpi && z.dpi[0] === 300 && z.dpi[1] === 300; }
  const p = pdfPage(buf);
  return !!p && p.pages === 1 && Math.abs(p.w - want[0]) < 0.5 && Math.abs(p.h - want[1]) < 0.5;
}

async function openMaker(ctx, order, base) {
  const u = String(order.design_url || "");
  if (!/^https:\/\/agsist\.com\/rain-print\?[A-Za-z0-9%+._~=&-]+$/.test(u)) throw new Error("not a design link");
  if (!PRODUCTS.includes(order.product)) throw new Error("not a product");
  await ctx.addInitScript((h) => { try { localStorage.setItem("rp-maker", h); } catch (e) {} }, MAKER_HASH);
  const page = await ctx.newPage();
  await page.goto(base + "/rain-print?" + u.split("?")[1] + "&maker=1", { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled &&
    !document.getElementById("rp-art").getAttribute("aria-busy") && !document.getElementById("rp-dl").disabled, null, { timeout: 90000 });
  return page;
}

/* The buyer's files for a digital file (see THE FILES above). -> {files: [{kind, path, name, bytes}]}.
   Refused for anything but a digital file, and for a year not finished (no file is made from part of a year). */
export async function renderFiles(ctx, order, outDir, base = "https://agsist.com") {
  if (order.product !== "digital") throw new Error("files are for a digital file");
  mkdirSync(outDir, { recursive: true });
  const page = await openMaker(ctx, order, base);
  try {
    const preview = await page.evaluate(() => { const p = document.getElementById("rp-preview-line"); return !!(p && !p.hidden); });
    if (preview) throw new Error("year not finished");
    await page.$eval("#rp-ins-gift", (t, v) => { t.value = v; }, String(order.gift_note || "").slice(0, 300));
    const files = [];
    for (const [kind, sel] of [["pdf", 'button[data-size="digital"][data-fmt="pdf"]'], ["png", 'button[data-size="digital"][data-fmt="png"]'],
      ["jpg", 'button[data-size="digital"][data-fmt="jpg"]'], ["guide", 'button[data-size="guide"]']]) {
      const [d] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.$eval(sel, (b) => b.click())]);
      const chunks = [];
      for await (const c of await d.createReadStream()) chunks.push(c);
      const buf = Buffer.concat(chunks);
      if (!checkFile(kind, buf)) throw new Error("the " + kind + " file is not the right size");
      const name = d.suggestedFilename().replace(/[^A-Za-z0-9._-]/g, "-");
      const path = join(outDir, name);
      writeFileSync(path, buf);
      files.push({ kind, path, name, bytes: buf.length });
    }
    return { files };
  } finally { await page.close(); }
}

/* ctx: a Playwright browser context. -> {proof, letter, letter_why, words, preview} (file paths in outDir) */
export async function renderOrder(ctx, order, outDir, base = "https://agsist.com") {
  const u = String(order.design_url || "");
  if (!/^https:\/\/agsist\.com\/rain-print\?[A-Za-z0-9%+._~=&-]+$/.test(u)) throw new Error("not a design link");
  if (!PRODUCTS.includes(order.product)) throw new Error("not a product");
  mkdirSync(outDir, { recursive: true });
  await ctx.addInitScript((h) => { try { localStorage.setItem("rp-maker", h); } catch (e) {} }, MAKER_HASH);
  const page = await ctx.newPage();
  try {
    await page.goto(base + "/rain-print?" + u.split("?")[1] + "&maker=1", { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled &&
      !document.getElementById("rp-art").getAttribute("aria-busy") && !document.getElementById("rp-dl").disabled, null, { timeout: 90000 });
    const preview = await page.evaluate(() => { const p = document.getElementById("rp-preview-line"); return !!(p && !p.hidden); });
    const png = await download(page, () => page.$eval("#rp-dl", (b) => b.click()));
    const proof = join(outDir, "proof.jpg");
    writeFileSync(proof, await shrink(page, png, "image/png", 1200));
    let letter = null, letterWhy = "";
    if (order.product === "digital") letterWhy = "digital";
    else if (preview) letterWhy = "year not finished";
    else {
      await page.$eval("#rp-ins-gift", (t, v) => { t.value = v; }, String(order.gift_note || "").slice(0, 300));
      const pdf = await download(page, () => page.$eval('button[data-size="insert"]', (b) => b.click()));
      letter = join(outDir, "letter.jpg");
      writeFileSync(letter, await shrink(page, pdfJpeg(pdf), "image/jpeg", 850));
    }
    const words = await page.evaluate(async ([choice, gift, preview]) => {
      const RP = window.RainPrint, j = await (await fetch("/data/rain-print.json")).json();
      const s = RP.fromParams(location.search);
      return RP.paidText({ choice, today: RP.chicagoToday(), prices: j,
        saved: { choice, place: s.place, year: s.year, gift: !!gift, settle: !!preview && !gift } });
    }, [order.product, !!order.gift, preview]);
    return { proof, letter, letter_why: letterWhy, words, preview };
  } finally { await page.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const [inFile, outDir] = process.argv.slice(2);
  const order = JSON.parse(readFileSync(inFile, "utf8"));
  let pw;
  try { pw = await import(process.env.PLAYWRIGHT_PATH ? pathToFileURL(process.env.PLAYWRIGHT_PATH).href : "playwright"); }
  catch (e) { console.log(JSON.stringify({ ok: false, error: "Playwright is not installed" })); process.exit(2); }
  const browser = await pw.chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block", acceptDownloads: true });
    const r = order.files ? await renderFiles(ctx, order, outDir, order.base || "https://agsist.com") : await renderOrder(ctx, order, outDir, order.base || "https://agsist.com");
    console.log(JSON.stringify(Object.assign({ ok: true }, r)));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String(e && e.message || e).slice(0, 200) }));
    process.exitCode = 1;
  } finally { await browser.close(); }
}
