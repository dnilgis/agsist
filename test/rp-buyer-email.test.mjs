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
import { renderOrder, pdfJpeg } from "../scripts/rp_buyer_render.mjs";

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
    assert.match(r.words[0], /^Your framed print of Chetek, WI, 2025 is ordered\. I email you a proof from sig@farmers1st\.com by /);
    assert.match(r.words.join(" "), /ships within 3 business days after your OK/);
    const d = await renderOrder(ctx, { design_url: SIG_URL, product: "digital" }, join(dir, "digital"), base);
    assert.equal(d.letter, null);
    assert.equal(d.letter_why, "digital");
    assert.match(d.words[0], /The finished file comes by email by /);
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
  });
});
