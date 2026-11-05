/* /tar-spot photo gallery (2026-11-05): the files are clean (no EXIF, GPS or other metadata), under
 * 200 KB, and every figure on the page names a file that exists with width and height set. In a browser
 * at 390 wide the gallery adds no layout shift and no sideways scroll, with every outside host refused
 * and service workers blocked (BUILD-RULES 58). Browser checks need PLAYWRIGHT_PATH and CHROMIUM_PATH. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIR = join(ROOT, "img/tar-spot");
const page = readFileSync(join(ROOT, "tar-spot.html"), "utf8");
const files = readdirSync(DIR).filter((f) => /\.(jpg|webp)$/.test(f));
const figs = [...page.matchAll(/<figure role="listitem">([\s\S]*?)<\/figure>/g)].map((m) => m[1]);

function jpegSegments(b) {
  const out = []; let i = 2;
  while (i < b.length && b[i] === 0xff) {
    const m = b[i + 1]; if (m === 0xda) break;
    const len = b.readUInt16BE(i + 2); out.push([m, b.subarray(i + 4, i + 2 + len)]); i += 2 + len;
  }
  return out;
}
function webpChunks(b) {
  const out = []; let i = 12;
  while (i + 8 <= b.length) { out.push(b.toString("latin1", i, i + 4)); i += 8 + b.readUInt32LE(i + 4) + (b.readUInt32LE(i + 4) & 1); }
  return out;
}

test("eight photos, each in 600 and 1200 px, WebP and JPEG", () => {
  assert.equal(files.length, 32);
  assert.equal(figs.length, 8);
});

test("no metadata in any image file, and each is under 200 KB", () => {
  for (const f of files) {
    const p = join(DIR, f), b = readFileSync(p);
    assert.ok(statSync(p).size <= 200000, `${f} is ${statSync(p).size} bytes`);
    if (f.endsWith(".jpg")) {
      for (const [m] of jpegSegments(b)) assert.ok(![0xe1, 0xe2, 0xed, 0xfe].includes(m), `${f} has marker ${m.toString(16)}`);
    } else {
      for (const c of webpChunks(b)) assert.ok(!["EXIF", "XMP ", "ICCP"].includes(c), `${f} has a ${c} chunk`);
    }
    const s = b.toString("latin1");
    assert.ok(!/Exif|GPS|<x:xmpmeta|Apple|iPhone/.test(s), `${f} has a metadata marker`);
  }
});

test("each figure names files that exist, sets width and height, and has alt and a caption", () => {
  figs.forEach((f, i) => {
    for (const u of f.matchAll(/(?:href="|src="|, |srcset=")(\/img\/tar-spot\/[^\s",]+)/g)) assert.ok(existsSync(join(ROOT, u[1])), u[1]);
    assert.match(f, /<img [^>]*width="\d+" height="\d+"/);
    assert.match(f, /alt="[^"]{10,}"/);
    assert.match(f, /<figcaption>[^<]{10,}<\/figcaption>/);
    assert.equal(/loading="lazy"/.test(f), i > 0, `figure ${i} lazy flag`);
  });
  assert.match(page, /Photos: AGSIST/);
  assert.ok(!/—/.test(figs.join("")));
});

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".webp": "image/webp", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

test("at 390 wide the gallery has no layout shift and no sideways scroll", { skip }, async () => {
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    await pg.route("**/*", (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
    await pg.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
    });
    await pg.goto(base + "/tar-spot", { waitUntil: "load" });
    await pg.locator("#identify").scrollIntoViewIfNeeded();
    const gal = pg.locator(".ts-gal");
    const box0 = await gal.boundingBox();
    await gal.scrollIntoViewIfNeeded();
    for (let y = 0; y < 3000; y += 400) { await pg.evaluate((v) => window.scrollTo(0, v), y); await pg.waitForTimeout(80); }
    await pg.waitForLoadState("networkidle");
    const r = await pg.evaluate(() => ({
      cls: window.__cls, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      n: document.querySelectorAll(".ts-gal img").length,
      broken: [...document.querySelectorAll(".ts-gal img")].filter((i) => i.complete && !i.naturalWidth).length,
    }));
    assert.equal(r.n, 8);
    assert.equal(r.broken, 0);
    assert.ok(r.sw <= r.cw, `sideways scroll ${r.sw} > ${r.cw}`);
    assert.ok(r.cls < 0.02, `layout shift ${r.cls}`);
    assert.ok(box0 && box0.height > 100);
  } finally { await browser.close(); srv.close(); }
});
