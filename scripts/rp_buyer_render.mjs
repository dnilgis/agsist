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
 *   node scripts/rp_buyer_render.mjs in.json outdir     -> prints JSON
 *   in.json: {design_url, product, gift_note?, base? (default https://agsist.com)}
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
    const r = await renderOrder(ctx, order, outDir, order.base || "https://agsist.com");
    console.log(JSON.stringify(Object.assign({ ok: true }, r)));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String(e && e.message || e).slice(0, 200) }));
    process.exitCode = 1;
  } finally { await browser.close(); }
}
