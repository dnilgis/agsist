/* The Rain Print QR before and after payment (2026-10-14, Sig: "we should not
 * put a working QR on the mockup until someone pays ... just use a standard one
 * for the test prints and mockups that directs to agsist rain print").
 *   - every preview carries the standard code, HTTPS://AGSIST.COM/RAIN-PRINT,
 *     version 2 at level M (25 x 25, the short link's size), and a redraw asks
 *     the link service for nothing;
 *   - the maker's order files (12 x 18 PNG and PDF, digital PNG, SVG) mint the
 *     print's own short link at export, once, and carry it; when the service
 *     fails they save nothing and say so, with a Try again button;
 *   - the maker's "Test print PDF (standard code)" needs no service at all;
 *   - checkout and the order form mint at most one, and only when needed;
 *   - the gift card asks for none.
 * The QR is read back with jsQR (JSQR_PATH, or jsqr installed); without it,
 * and without Playwright and Chromium, those parts are skipped.
 *
 *   node --test test/rp-qr-paid.test.mjs
 */
import { makerFlag } from "./fixtures/rp-maker.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";
import { checkout, stripePage, refOf } from "./fixtures/rp-checkout.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
let jsQR = null;
for (const p of [process.env.JSQR_PATH, "jsqr"].filter(Boolean)) { try { jsQR = createRequire(import.meta.url)(p); break; } catch (e) { /* next */ } }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : !jsQR ? "jsqr is not installed (npm i jsqr@1.4.0, or set JSQR_PATH)" : false;

const STD = "HTTPS://AGSIST.COM/RAIN-PRINT";
const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
const H = readFileSync(ROOT + "rain-print.html", "utf8");
const ctxVm = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctxVm.window = ctxVm;
for (const f of ["components/qr.js", "components/rain-print.js"]) vm.runInNewContext(readFileSync(ROOT + f, "utf8"), ctxVm);
const RP = ctxVm.RainPrint, Q = ctxVm.AgQR;

/* The QR prints in muted gray (#A4A89F) on white; a phone's camera sets its own
   exposure, so the pixels are made black or white before jsQR reads them. */
function inked(d) {
  const o = new Uint8ClampedArray(d.length);
  for (let i = 0; i < d.length; i += 4) { const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 < 215 ? 0 : 255; o[i] = o[i + 1] = o[i + 2] = v; o[i + 3] = 255; }
  return o;
}
// a matrix (rows of booleans) to jsQR's pixels, quiet zone included
function readMatrix(m) {
  const s = 6, n = (m.length + 8) * s, px = new Uint8ClampedArray(n * n * 4).fill(255);
  m.forEach((row, y) => row.forEach((v, x) => {
    if (!v) return;
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) { const o = (((y + 4) * s + dy) * n + (x + 4) * s + dx) * 4; px[o] = px[o + 1] = px[o + 2] = 0; }
  }));
  const r = jsQR(px, n, n);
  return r ? r.data : null;
}

// ---------- the standard code itself ----------
test("the standard code: alphanumeric mode, version 2 (25 x 25) at level M, byte mode would be 29", () => {
  assert.equal(RP.STANDARD_LINK, STD);
  const m = RP.standardMatrix();
  assert.equal(m.length, 25, "version 2, the same 25 modules as the short link HTTPS://AGSIST.COM/R?ID");
  assert.equal(Q.matrix("HTTPS://AGSIST.COM/R?K7Q2M").length, 25);
  assert.equal(Q.matrix(STD).length, 29, "byte mode needs version 3, so alphanumeric is what keeps the size");
  assert.equal(Q.matrix(STD, null, "alnum").length, 25);
  assert.throws(() => Q.matrix("https://agsist.com", null, "alnum"), /alphanumeric/);
  // byte mode symbols are unchanged: the short link's matrix is the same with and without a mode
  assert.deepEqual(JSON.stringify(Q.matrix("HTTPS://AGSIST.COM/R?K7Q2M")), JSON.stringify(Q.matrix("HTTPS://AGSIST.COM/R?K7Q2M", null, undefined)));
});
test("the standard code reads back with jsQR", { skip: jsQR ? false : "jsqr is not installed" }, () => {
  assert.equal(readMatrix(RP.standardMatrix()), STD);
  assert.equal(readMatrix(Q.matrix(STD, null, "alnum")), STD);
});

test("the maker box has the test print button, labeled, and it skips the link service in the code", () => {
  assert.match(H, /<button class="btn btn-secondary" type="button" data-size="12x18" data-fmt="pdf" data-qr="standard">Test print PDF \(standard code\)<\/button>/);
  const i = S.indexOf("if (btn.getAttribute('data-qr') === 'standard') {"), j = S.indexOf("return;\n    }", i);
  assert.ok(i > 0 && j > i);
  const body = S.slice(i, j);
  assert.doesNotMatch(body, /AgRpShort|getShortLink|mint\(/, "no short link on the test print path");
  assert.match(body, /drawCanvas\(kind, null\)/, "no own matrix: the standard code");
});

// ---------- in a browser ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function yearDays(y) { const a = []; for (let t = Date.UTC(y, 0, 1); new Date(t).getUTCFullYear() === y; t += 864e5) a.push(new Date(t).toISOString().slice(0, 10)); return a; }
function series(y, upto) {
  const r = rng(7 + y);
  return yearDays(y).map((d, i) => {
    if (d > upto) return [d, "M", "M", "M", "M", "M"];
    const u = r(), p = u < 0.12 ? (r() * r() * 2).toFixed(2) : u < 0.16 ? "T" : "0.00";
    const t = Math.round(44 + 32 * Math.sin((i - 105) / 365 * 2 * Math.PI));
    return [d, p, String(t), "0.0", String(t + 9), String(t - 9)];
  });
}

/* opts.short: 'ok' (the default), 'fail' (429), 'down' (the first fail, then ok) */
async function mocks(ctx, opts, log) {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  const upto = "2026-10-09";
  const SHORT = {};
  log.posts = 0;
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const req = r.request(), u = new URL(req.url());
    if (u.host === "agsist-subs.dnilgis.workers.dev") {
      if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
      if (u.pathname === "/rp-short" && req.method() === "POST") {
        log.posts++;
        const mode = opts.short || "ok";
        if (mode === "fail" || (mode === "down" && log.posts === 1)) return r.fulfill({ status: 429, headers: h, json: { ok: false } });
        const b = JSON.parse(req.postData()); SHORT.K7Q2M = b.code;
        return r.fulfill({ headers: h, json: { ok: true, id: "K7Q2M" } });
      }
      const m = /^\/rp-short\/([0-9A-Z]+)$/.exec(u.pathname);
      if (m) return SHORT[m[1]] ? r.fulfill({ headers: h, json: { ok: true, code: SHORT[m[1]] } }) : r.fulfill({ status: 404, headers: h, json: { ok: false } });
      if (u.pathname === "/rp-gift/check" && opts.gift) return r.fulfill({ headers: h, json: opts.gift });
      return r.fulfill({ status: 503, headers: h, body: "x" });
    }
    if (u.host === "buy.stripe.com") return stripePage(r, log.stripe);
    if (u.host === "geocoding-api.open-meteo.com") return r.fulfill({ json: { results: [{ name: "Chetek", latitude: 45.3141, longitude: -91.651, admin1: "Wisconsin", country_code: "US" }] } });
    if (u.host === "data.rcc-acis.org") {
      if (u.pathname === "/StnMeta") return r.fulfill({ json: { meta: [{ name: "CHETEK", sids: ["471667 2"], ll: [-91.65, 45.32], valid_daterange: [["1950-01-01", upto]], state: "WI" }] } });
      let sdate = u.searchParams.get("sdate"), normal = false;
      if (u.searchParams.get("params")) { sdate = JSON.parse(u.searchParams.get("params")).sdate; normal = true; }
      if (normal) return r.fulfill({ json: { data: yearDays(+String(sdate).slice(0, 4)).map((d) => [d, "0.08"]) } });
      if (sdate === "por") { let data = []; for (let y = 1995; y <= 2025; y++) data = data.concat(series(y, upto).map((x) => x.slice(0, 3))); return r.fulfill({ json: { data } }); }
      return r.fulfill({ json: { meta: { name: "CHETEK", state: "WI", ll: [-91.65, 45.32] }, data: series(+String(sdate).slice(0, 4), upto) } });
    }
    return r.abort();
  });
}
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png" };
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
async function withPage(fn, opts = {}) {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block", acceptDownloads: true });
    await makerFlag(ctx);   // Sig's browser: maker mode is gated (fixtures/rp-maker.mjs)
    await ctx.clock.setFixedTime(new Date("2026-10-14T17:00:00Z"));
    const log = { stripe: [] };
    await mocks(ctx, opts, log);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, `http://127.0.0.1:${port}`, errors, log);
  } finally { await browser.close(); srv.close(); }
}
const drawn = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && !document.getElementById("rp-art").getAttribute("aria-busy"), null, { timeout: 30000 });
const q = (o) => new URLSearchParams(o).toString();
const MINE = { place: "Chetek, WI", year: "2025", station: "471667 2", style: "r1", name: "The Olson Farm" };

/* The QR in an SVG on the page (the art, the mini copy, the up-close view):
   its group alone, drawn big on a canvas, read by jsQR. */
async function svgQr(page, sel) {
  const img = await page.evaluate(async (sel) => {
    const g = document.querySelector(sel + ' g[data-rp="qr"]');
    if (!g) return null;
    const r = g.querySelector("rect"), x = +r.getAttribute("x"), y = +r.getAttribute("y"), w = +r.getAttribute("width");
    const src = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + x + " " + y + " " + w + " " + w + '" width="400" height="400">' + g.outerHTML + "</svg>";
    const im = new Image();
    await new Promise((ok, bad) => { im.onload = ok; im.onerror = bad; im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(src); });
    const c = document.createElement("canvas"); c.width = c.height = 400;
    const cx = c.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, 400, 400); cx.drawImage(im, 0, 0, 400, 400);
    return Array.from(cx.getImageData(0, 0, 400, 400).data);
  }, sel);
  if (!img) return null;
  const r = jsQR(inked(img), 400, 400);
  return r ? r.data : null;
}
// A saved file (PNG, or the JPEG inside a PDF): the bottom-right corner, read by jsQR.
async function fileQr(page, bytes, mime) {
  const px = await page.evaluate(async ([b64, mime]) => {
    const im = new Image();
    await new Promise((ok, bad) => { im.onload = ok; im.onerror = bad; im.src = "data:" + mime + ";base64," + b64; });
    const W = im.naturalWidth, Hh = im.naturalHeight, x0 = Math.round(W * 0.84), y0 = Math.round(Hh * 0.76), w = W - x0, h = Hh - y0;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(im, x0, y0, w, h, 0, 0, w, h);
    return { w, h, d: Array.from(c.getContext("2d").getImageData(0, 0, w, h).data) };
  }, [Buffer.from(bytes).toString("base64"), mime]);
  const r = jsQR(inked(px.d), px.w, px.h);
  return r ? r.data : null;
}
function pdfJpeg(buf) {
  const s = buf.toString("latin1"), i = s.indexOf("/Subtype /Image"), a = s.indexOf("stream\n", i) + 7, b = s.indexOf("\nendstream", a);
  return buf.subarray(a, b);
}
async function saved(page, click) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), click()]);
  const p = await dl.path();
  return { name: dl.suggestedFilename(), buf: readFileSync(p) };
}

test("the test print PDF carries the standard code and asks the link service for nothing", { skip }, async () => {
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?" + q(MINE) + "&maker=1");
    await drawn(page);
    await page.waitForTimeout(4000);   // past the old short-link wait, so a mint on draw would show
    const before = log.posts;
    const f = await saved(page, () => page.click('#rp-maker button[data-qr="standard"]'));
    assert.match(f.name, /-test-print-standard-code\.pdf$/);
    assert.equal(await fileQr(page, pdfJpeg(f.buf), "image/jpeg"), STD);
    await page.waitForTimeout(500);
    assert.equal(log.posts - before, 0, "no short link for a test print");
    assert.match(await page.textContent("#rp-dl-note"), /Test print PDF saved, with the standard code/);
    assert.deepEqual(errors, []);
  }, { short: "fail" });
});

// a saved SVG file: its QR group, read the same way as the page's
async function svgFileQr(page, text) {
  await page.evaluate((t) => { let d = document.getElementById("__svgfile"); if (!d) { d = document.createElement("div"); d.id = "__svgfile"; d.style.cssText = "position:absolute;left:-9999px;width:900px"; document.body.appendChild(d); } d.innerHTML = t; }, text);
  return svgQr(page, "#__svgfile");
}
const OWN = "HTTPS://AGSIST.COM/R?K7Q2M";
const LONG = { place: "Chetek, WI", station: "471667 2", year: 2025, style: "r1", cmp: "normal", name: "The Olson Family Farm",
  dedication: "For Grandpa Erling, sixty harvests on the home place. Love, all of us",
  markers: [{ date: "2025-05-13", label: "Beans went in" }, { date: "2025-07-04", label: "Hay all in" }, { date: "2025-10-27", label: "Last load in" }] };
const LONG_CODE = RP.encodeCode(LONG);

test("every preview carries the standard code, and redraws ask the link service for nothing", { skip }, async () => {
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?" + q(MINE));
    await drawn(page);
    assert.equal(await svgQr(page, "#rp-art"), STD, "the page art");
    // on a phone the print itself stays pinned under the menu while the steps scroll (2026-10-22: it replaces the
    // slim copy), still with the standard code
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, document.getElementById("rp-design").getBoundingClientRect().top + scrollY));
    await page.waitForFunction(() => { const r = document.getElementById("rp-art").getBoundingClientRect(); return r.top >= 0 && r.top < 200; }, null, { timeout: 10000 });
    assert.equal(await svgQr(page, "#rp-art"), STD, "the pinned print");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    // redraws: a new name, the other style, a dedication
    await page.fill("#rp-name", "The Lund Farm");
    await page.waitForTimeout(400);
    await page.check('input[name="rp-style"][value="r2"]');
    await page.fill("#rp-ded", "For Dad");
    await page.waitForTimeout(4000);   // past the old 3 s wait before a short link was asked for
    assert.equal(await svgQr(page, "#rp-art"), STD, "still the standard code after redraws");
    await page.click("#rp-zoom");
    await page.waitForFunction(() => document.querySelector("#rp-proof-art svg"), null, { timeout: 10000 });
    assert.equal(await svgQr(page, "#rp-proof-art"), STD, "the up-close view");
    await page.keyboard.press("Escape");
    await page.click("#rp-more summary");   // Download a preview and Copy link fold under Your words (2026-10-22)
    const f = await saved(page, () => page.click("#rp-dl"));
    assert.match(f.name, /-preview\.png$/);
    assert.equal(await fileQr(page, f.buf, "image/png"), STD, "the watermarked preview PNG");
    // Copy link makes none either
    await page.click("#rp-copy").catch(() => {});
    await page.waitForTimeout(300);
    assert.equal(log.posts, 0, "no short link made for any preview");
    assert.deepEqual(errors, []);
  });
});

test("the gift card's preview: the standard code with its QR, none with noQr, no short link either way", { skip }, async () => {
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?" + q(MINE));
    await drawn(page);
    const code = RP.encodeCode({ place: "Chetek, WI", station: "471667 2", year: 2025, name: "For Dad", markers: [] });
    const svgs = await page.evaluate(async (c) => {
      const a = await window.RainPrint.previewArt(c, { idPrefix: "gc" }), b = await window.RainPrint.previewArt(c, { idPrefix: "gd", noQr: true });
      return [a.svg, b.svg];
    }, code);
    assert.equal(await svgFileQr(page, svgs[0]), STD);
    assert.ok(!/data-rp="qr"/.test(svgs[1]), "the card itself shows no design QR");
    await page.waitForTimeout(500);
    assert.equal(log.posts, 0);
    assert.deepEqual(errors, []);
  });
});

test("the maker's order files make the print's own short link once, at export, and carry it", { skip }, async () => {
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?" + q(MINE) + "&maker=1&serial=7");
    await drawn(page);
    await page.waitForTimeout(4000);
    assert.equal(log.posts, 0, "nothing on the draw, maker page included");
    assert.equal(await svgQr(page, "#rp-art"), STD, "the maker's screen shows the standard code too");
    const png = await saved(page, () => page.click('#rp-maker button[data-size="12x18"][data-fmt="png"]'));
    assert.equal(log.posts, 1, "exactly one request, at export");
    assert.match(png.name, /-12x18-300dpi-no-0007\.png$/);
    assert.equal(await fileQr(page, png.buf, "image/png"), OWN, "the print PNG");
    assert.match(await page.textContent("#rp-dl-note"), /QR: HTTPS:\/\/AGSIST\.COM\/R\?K7Q2M\./);
    const pdf = await saved(page, () => page.click('#rp-maker button[data-size="12x18"][data-fmt="pdf"]:not([data-qr])'));
    assert.equal(await fileQr(page, pdfJpeg(pdf.buf), "image/jpeg"), OWN, "the print PDF");
    const dig = await saved(page, () => page.click('#rp-maker button[data-size="digital"]'));
    assert.equal(await fileQr(page, dig.buf, "image/png"), OWN, "the digital file");
    const svg = await saved(page, () => page.click('#rp-maker button[data-fmt="svg"]'));
    assert.equal(await svgFileQr(page, svg.buf.toString("utf8")), OWN, "the SVG");
    assert.equal(log.posts, 1, "one short link for the design, reused by every file");
    assert.equal(await svgQr(page, "#rp-art"), STD, "the page still shows the standard code after");
    // the test print, after all that: still the standard code
    const t = await saved(page, () => page.click('#rp-maker button[data-qr="standard"]'));
    assert.equal(await fileQr(page, pdfJpeg(t.buf), "image/jpeg"), STD);
    assert.equal(log.posts, 1);
    assert.deepEqual(errors, []);
  });
});

test("an order file with the link service down: no file, a plain message, Try again works", { skip }, async () => {
  await withPage(async (page, base, errors, log) => {
    let downloads = 0;
    page.on("download", () => downloads++);
    await page.goto(base + "/rain-print.html?" + q(MINE) + "&maker=1");
    await drawn(page);
    await page.click('#rp-maker button[data-size="12x18"][data-fmt="pdf"]:not([data-qr])');
    await page.waitForFunction(() => !document.getElementById("rp-maker-msg").hidden, null, { timeout: 15000 });
    const msg = await page.textContent("#rp-maker-msg");
    assert.match(msg, /The link service didn’t give this print its own short link \(it may be busy\), so no file was saved\. An order file never uses the standard code\./);
    assert.ok(!/—/.test(msg), "no em dash");
    assert.equal(log.posts, 1);
    await page.waitForTimeout(500);
    assert.equal(downloads, 0, "nothing saved, and never with the standard code");
    const f = await saved(page, () => page.click("#rp-maker-retry"));
    assert.equal(log.posts, 2, "Try again is one more request");
    assert.equal(await fileQr(page, pdfJpeg(f.buf), "image/jpeg"), OWN);
    assert.ok(await page.evaluate(() => document.getElementById("rp-maker-msg").hidden), "the message goes once the file is made");
    assert.deepEqual(errors, []);
  }, { short: "down" });
});

test("checkout: no short link for a design that fits; one, at the press, for a long one; Stripe with a hash ref if it fails", { skip }, async () => {
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?" + q(MINE));
    await drawn(page);
    let r = await checkout(page, "print12x18");
    assert.equal(r.stage, "stripe");
    assert.equal(log.posts, 0, "a code that fits goes to Stripe as it is");
    assert.equal(RP.decodeCode(refOf(r.url)).name, "The Olson Farm");
    // a long design
    assert.ok(LONG_CODE.length > 200);
    await page.goto(base + "/rain-print.html?d=" + LONG_CODE);
    await drawn(page);
    await page.waitForTimeout(4000);
    assert.equal(log.posts, 0, "nothing on the draw");
    r = await checkout(page, "print12x18");
    assert.equal(r.stage, "stripe", JSON.stringify(r));
    assert.ok(r.url.endsWith("client_reference_id=RPS-K7Q2M"), r.url);
    assert.equal(log.posts, 1, "one short link, at the press");
    await page.goBack();
    await drawn(page);
    r = await checkout(page, "framed12x18");
    assert.equal(r.stage, "stripe");
    assert.ok(r.url.endsWith("client_reference_id=RPS-K7Q2M"), "the same id: " + r.url);
    assert.equal(log.posts, 2, "a second press asks the worker again (2026-10-15: never a kept id alone), and gets the same id");
    assert.deepEqual(errors, []);
  });
  /* The link service failing (2026-10-22, BUILD-RULES 14: checkout never depends on the worker): the press still goes to
     Stripe, as RPH-<hash of the full code>, and the full design goes to Sig by the press record (here the worker's
     /rp-order still answers) and, if that fails too, the backup form. Never the order form for want of a short link. */
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?d=" + LONG_CODE);
    await drawn(page);
    /* the order form must never open on the way to Stripe: watched on the page itself from before the press
       (once the tab is on Stripe's page there is no #rp-order to look at) */
    const opened = [];
    await page.exposeFunction("rpOrderOpened", () => opened.push(1));
    assert.equal(await page.evaluate(() => {
      const el = document.getElementById("rp-order");
      if (!el) return false;
      new MutationObserver(() => { if (!el.hidden) window.rpOrderOpened(); }).observe(el, { attributes: true, attributeFilter: ["hidden"] });
      return el.hidden;
    }), true, "the order form is there and closed before the press");
    const r = await checkout(page, "print12x18", { wait: 10000 });
    assert.equal(r.stage, "stripe", JSON.stringify(r));
    assert.equal(log.posts, 1, "at most one short-link ask");
    assert.equal(refOf(r.url), RP.hashRef(LONG_CODE, false), "a reference Stripe takes, naming exactly this design");
    assert.ok(refOf(r.url).length <= 200);
    assert.equal(opened.length, 0, "no order form on the way to Stripe");
    assert.deepEqual(errors, []);
  }, { short: "fail" });
});
