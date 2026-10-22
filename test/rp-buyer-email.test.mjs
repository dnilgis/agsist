/* The Rain Print buyer's email (Sig, 2026-10-20: "send the buyer a proof of
 * what they purchased and the letter that will accompany the gift").
 *   - scripts/rp_buyer_email.py --selftest: who gets it (the buyer, or Sig only
 *     for a dry run, a test-mode session or his own address), once per paid
 *     session, counts only in the log, the words;
 *   - scripts/rp_buyer_render.mjs in a real browser on a local copy of the
 *     site: the proof is the page's own preview of the exact design, the
 *     letter is the maker view's insert letter with the gift note, none for a
 *     digital file or a year not finished;
 *   - the email at 390 px: no sideways scroll (RP_SHOTS saves the picture).
 *
 *   node --test test/rp-buyer-email.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mocks, serve } from "./fixtures/rp-site-mock.mjs";
import { renderOrder, renderFiles, pdfJpeg, checkFile, pngSize, jpegInfo, pdfPage } from "../scripts/rp_buyer_render.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");

test("the email script's selftest", () => {
  const out = execFileSync("python3", [ROOT + "scripts/rp_buyer_email.py", "--selftest"], { encoding: "utf8" });
  assert.match(out, /rp_buyer_email: all checks pass/);
});

test("the workflow: run by hand only until Sig turns on a schedule, a dry run by default, the selftest first", () => {
  const W = read(".github/workflows/rp-buyer-email.yml");
  assert.doesNotMatch(W, /^\s*schedule:/m, "no schedule without Sig's OK");
  assert.doesNotMatch(W, /^\s*workflow_run:/m);
  assert.match(W, /workflow_dispatch:/);
  assert.match(W, /dry_run:[\s\S]*?default: true/);
  assert.match(W, /python3 scripts\/rp_buyer_email\.py --selftest/);
  assert.doesNotMatch(W, /secrets\.STRIPE_READ_KEY/, "the read key lives on the worker alone");
});

test("pdfJpeg finds the JPEG in the page's one-page PDF", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n4 0 obj\n<< /Type /XObject /Filter /DCTDecode /Length 9 >>\nstream\n", "latin1"), jpeg, Buffer.from("\nendstream", "latin1")]);
  assert.deepEqual([...pdfJpeg(pdf)], [...jpeg]);
});

test("checkFile: each file must be its promised size", () => {
  const png = (w, h) => { const b = Buffer.alloc(33); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write("IHDR", 12, "latin1"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
  assert.deepEqual(pngSize(png(5400, 3600)), [5400, 3600]);
  assert.ok(checkFile("png", png(5400, 3600)) && !checkFile("png", png(2000, 1333)), "the full 5400 x 3600, never the preview's 2000");
  const pdf = (w, h) => Buffer.from("%PDF-1.4\n<< /Type /Pages /Count 1 >>\n<< /MediaBox [0 0 " + w + " " + h + "] >>\n%%EOF\n", "latin1");
  assert.deepEqual(pdfPage(pdf("1296.00", "864.00")), { w: 1296, h: 864, pages: 1 });
  assert.ok(checkFile("pdf", pdf("1296.00", "864.00")) && !checkFile("pdf", pdf("1368.00", "936.00")), "18 x 12 in, not the 13 x 19 sheet");
  assert.ok(checkFile("guide", pdf("612.00", "792.00")) && !checkFile("guide", pdf("1296.00", "864.00")));
  assert.ok(!checkFile("pdf", Buffer.from("%PDF-1.4 cut off", "latin1")), "a cut-off PDF is refused");
  const jpg = (dpi) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, dpi ? 1 : 0, 1, 44, 1, 44, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x0e, 0x10, 0x15, 0x18, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(jpegInfo(jpg(true)), { w: 5400, h: 3600, dpi: [300, 300] });
  assert.ok(checkFile("jpg", jpg(true)) && !checkFile("jpg", jpg(false)), "the JPG says 300 dpi");
});

// ---------- in a browser ----------
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const jpegSize = (b) => { for (let i = 2; i < b.length - 9;) { const len = b.readUInt16BE(i + 2); if (b[i + 1] >= 0xc0 && b[i + 1] <= 0xc2) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; i += 2 + len; } return null; };
const SIG_URL = "https://agsist.com/rain-print?place=Chetek%2C+WI&year=2025&station=471667+2&layout=staircase&palette=paper&size=12x18&style=r1&name=Gustum+Farm&m1=2025-04-01+Moved+in";

async function withCtx(fn) {
  const srv = await serve(ROOT), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block", acceptDownloads: true });
    await ctx.clock.setFixedTime(new Date("2026-10-14T17:00:00Z"));
    await mocks(ctx, {}, { stripe: [], order: [] });
    await fn(ctx, `http://127.0.0.1:${port}`, browser);
  } finally { await browser.close(); srv.close(); }
}

test("in a browser: a framed gift gets the preview of its design and the box letter with the note; a file gets no letter; this year gets no letter", { skip, timeout: 240000 }, async () => {
  await withCtx(async (ctx, base, browser) => {
    const dir = mkdtempSync(join(tmpdir(), "rp-buyer-"));
    const r = await renderOrder(ctx, { design_url: SIG_URL, product: "framed12x18", gift_note: "For every inch you farmed. Love, Jane" }, join(dir, "framed"), base);
    assert.equal(r.preview, false);
    assert.deepEqual(jpegSize(readFileSync(r.proof)), [1200, 800], "the 3:2 art, 1200 px wide");
    assert.ok(r.letter, "a framed print has the box letter");
    assert.deepEqual(jpegSize(readFileSync(r.letter)), [850, 1100], "a letter page, 850 px wide");
    assert.match(r.words[0], /^Your framed print of Chetek, WI, 2025 is ordered\. Your proof comes by email by /);
    assert.match(r.words.join(" "), /ships within 3 business days after you approve it/);
    const d = await renderOrder(ctx, { design_url: SIG_URL, product: "digital" }, join(dir, "digital"), base);
    assert.equal(d.letter, null);
    assert.equal(d.letter_why, "digital");
    assert.match(d.words[0], /Your proof comes by email by .* Approve it there and your files come by email within minutes/);
    const g = await renderOrder(ctx, { design_url: SIG_URL.replace("year=2025", "year=2026").replace("2025-04-01", "2026-04-01") + "&gift=1", product: "print12x18", gift: true }, join(dir, "gift"), base);
    assert.equal(g.preview, true, "this year is not finished");
    assert.equal(g.letter, null);
    assert.match(g.words[0], /gift card to print comes by email/);
    await assert.rejects(renderOrder(ctx, { design_url: "https://evil.example/rain-print?x=1", product: "digital" }, join(dir, "bad"), base));

    // the email at 390 px, with these pictures
    const out = join(dir, "email.html");
    execFileSync("python3", [ROOT + "scripts/rp_buyer_email.py", "--sample", out], { env: Object.assign({}, process.env, { RENDER_DIR: join(dir, "framed"), RENDER_WORDS: JSON.stringify(r.words) }) });
    const html = readFileSync(out, "utf8");
    assert.ok(!html.includes("—"), "no em dashes");
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const p = await phone.newPage();
    await p.setContent(html, { waitUntil: "load" });
    const wide = await p.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(wide <= 390, "no sideways scroll at 390 px: " + wide);
    const imgs = await p.evaluate(() => [...document.images].map((i) => [i.naturalWidth, Math.round(i.getBoundingClientRect().width)]));
    assert.equal(imgs.length, 2);
    assert.ok(imgs.every(([n, w]) => n > 0 && w <= 374), JSON.stringify(imgs));
    if (process.env.RP_SHOTS) {
      await p.screenshot({ path: join(process.env.RP_SHOTS, "buyer-email-390.png"), fullPage: true });
      const wideCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const wp = await wideCtx.newPage();
      await wp.setContent(html, { waitUntil: "load" });
      await wp.screenshot({ path: join(process.env.RP_SHOTS, "buyer-email-1280.png"), fullPage: true });
      writeFileSync(join(process.env.RP_SHOTS, "buyer-email.html"), html);
    }
    // the email's two buttons
    assert.match(html, />Approve this print<\/a>/);
    assert.match(html, /href="mailto:sig@agsist\.com\?subject=Change%20to%20my%20Rain%20Print%20%28ref%20/);
    const href = /href="(https:\/\/agsist\.com\/rain-print-approve\?[^"]+)"/.exec(html)[1].replace(/&amp;/g, "&");
    assert.match(href, /^https:\/\/agsist\.com\/rain-print-approve\?k=rpo%3A\d+%3A[0-9a-f]{8}&t=[0-9a-f]{16}$/);
  });
});

test("in a browser: an approved digital file's files are the full art, no watermark, the right sizes, with the reading guide", { skip, timeout: 300000 }, async () => {
  await withCtx(async (ctx, base, browser) => {
    const dir = mkdtempSync(join(tmpdir(), "rp-files-"));
    const r = await renderFiles(ctx, { design_url: SIG_URL, product: "digital", gift_note: "For every inch you farmed. Love, Jane" }, join(dir, "f"), base);
    assert.deepEqual(r.files.map((f) => f.kind), ["pdf", "png", "jpg", "guide"]);
    const by = Object.fromEntries(r.files.map((f) => [f.kind, readFileSync(f.path)]));
    assert.deepEqual(pngSize(by.png), [5400, 3600], "12 x 18 in at 300 dpi");
    assert.ok(by.png.includes(Buffer.from("pHYs")), "the PNG is marked with its dpi");
    assert.deepEqual(jpegInfo(by.jpg), { w: 5400, h: 3600, dpi: [300, 300] });
    assert.deepEqual(pdfPage(by.pdf), { w: 1296, h: 864, pages: 1 }, "the PDF is the art alone, 18 x 12 in");
    assert.deepEqual(jpegSize(pdfJpeg(by.pdf)), [5400, 3600], "at 300 dpi");
    assert.deepEqual(pdfPage(by.guide), { w: 612, h: 792, pages: 1 }, "the guide is one letter page");
    assert.ok(r.files.every((f) => /^rain-print-chetek-wi-2025-r1-(12x18-300dpi\.(pdf|png|jpg)|how-to-read\.pdf)$/.test(f.name)), r.files.map((f) => f.name).join());
    const total = r.files.reduce((a, f) => a + f.bytes, 0);
    assert.ok(total < 15 * 1024 * 1024, "well under the attach limit: " + total);
    // no watermark: the preview's faint gray band text (PREVIEW · AGSIST.COM/RAIN-PRINT, 13% ink across the art) leaves many
    // pale gray pixels; the buyer's file has next to none. Both drawn at the same size and counted the same way.
    const prev = await renderOrder(ctx, { design_url: SIG_URL, product: "digital" }, join(dir, "pv"), base);
    const p = await browser.newPage();
    const pale = (b64, mime) => p.evaluate(async ([b64, mime]) => {
      const im = new Image(); await new Promise((ok) => { im.onload = ok; im.src = "data:" + mime + ";base64," + b64; });
      const c = document.createElement("canvas"); c.width = 1200; c.height = 800; const x = c.getContext("2d"); x.drawImage(im, 0, 0, 1200, 800);
      const d = x.getImageData(0, 0, 1200, 800).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) { const lo = Math.min(d[i], d[i + 1], d[i + 2]), hi = Math.max(d[i], d[i + 1], d[i + 2]); if (lo >= 205 && hi <= 240 && hi - lo < 10) n++; }
      return n / (1200 * 800);
    }, [b64, mime]);
    const pf = await pale(by.png.toString("base64"), "image/png"), pp = await pale(readFileSync(prev.proof).toString("base64"), "image/jpeg");
    assert.ok(pp > 0.01 && pf < pp / 4, "the preview is marked, the file is not: " + pf.toFixed(4) + " vs " + pp.toFixed(4));
    await p.close();
    if (process.env.RP_SHOTS) for (const f of r.files) writeFileSync(join(process.env.RP_SHOTS, f.name), readFileSync(f.path));
    await assert.rejects(renderFiles(ctx, { design_url: SIG_URL, product: "print12x18" }, join(dir, "p"), base), /digital/);
    await assert.rejects(renderFiles(ctx, { design_url: SIG_URL.replace("year=2025", "year=2026").replace("2025-04-01", "2026-04-01"), product: "digital" }, join(dir, "y"), base), /year not finished/);
    // the files email at 390 px
    const out = join(dir, "files-email.html");
    execFileSync("python3", [ROOT + "scripts/rp_buyer_email.py", "--sample-files", out], { env: Object.assign({}, process.env, { FILES_DIR: join(dir, "f") }) });
    const html = readFileSync(out, "utf8");
    assert.ok(!html.includes("\u2014") && !/sponsor/i.test(html));
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const pg = await phone.newPage();
    await pg.setContent(html, { waitUntil: "load" });
    assert.ok((await pg.evaluate(() => document.documentElement.scrollWidth)) <= 390, "no sideways scroll at 390 px");
    if (process.env.RP_SHOTS) await pg.screenshot({ path: join(process.env.RP_SHOTS, "files-email-390.png"), fullPage: true });
  });
});

test("in a browser: the approve page posts once, says approved, already approved, or that the link does not work", { skip, timeout: 120000 }, async () => {
  const srv = await serve(ROOT), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block" });
    const posts = [];
    let answer = { status: 200, json: { ok: true, already: false, at: "2026-10-21T14:00:00.000Z", product: "framed12x18" } };
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
      const req = r.request(), h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
      if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
      if (req.url() === "https://agsist-api.dnilgis.workers.dev/rp-order/approve") { posts.push(JSON.parse(req.postData())); return r.fulfill({ status: answer.status, headers: h, json: answer.json }); }
      return r.abort();
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const url = `http://127.0.0.1:${port}/rain-print-approve?k=rpo%3A1761000000000%3A0a1b2c3d&t=0123456789abcdef`;
    await page.goto(url);
    await page.waitForFunction(() => document.getElementById("msg").textContent !== "Approving your print");
    assert.equal(await page.textContent("#msg"), "Approved. Thank you.");
    assert.match(await page.textContent("#sub"), /^I make it, number it and initial it by hand, and it ships within 3 business days\./);
    assert.deepEqual(posts, [{ k: "rpo:1761000000000:0a1b2c3d", t: "0123456789abcdef" }], "one post, the key and token only");
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390);
    if (process.env.RP_SHOTS) await page.screenshot({ path: join(process.env.RP_SHOTS, "approve-390.png"), fullPage: true });
    answer = { status: 200, json: { ok: true, already: true, at: "2026-10-21T14:00:00.000Z", product: "digital" } };
    await page.goto(url);
    await page.waitForFunction(() => document.getElementById("msg").textContent !== "Approving your print");
    assert.equal(await page.textContent("#msg"), "Already approved. Thank you.");
    assert.match(await page.textContent("#sub"), /You approved it on Wednesday, October 21\. Your files went out by email when you approved it\. Not there\? Check spam, or write to me at sig@agsist\.com\./);
    answer = { status: 403, json: { ok: false, error: "bad link" } };
    await page.goto(url);
    await page.waitForFunction(() => document.getElementById("msg").textContent !== "Approving your print");
    assert.equal(await page.textContent("#msg"), "That approval link does not work");
    const n = posts.length;
    await page.goto(`http://127.0.0.1:${port}/rain-print-approve?k=rpo%3A1&t=zz`);
    assert.equal(await page.textContent("#msg"), "That approval link is not complete");
    assert.equal(posts.length, n, "a broken link posts nothing");
    assert.deepEqual(errors, []);
    const html = readFileSync(ROOT + "rain-print-approve.html", "utf8");
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.ok(!html.includes("\u2014"), "no em dashes");
  } finally { await browser.close(); srv.close(); }
});
