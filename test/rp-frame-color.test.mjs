/* The framed Rain Print's frame color (Sig, Nov 4: "yes build it, oak default ... add the frame specs
 * to our what you get"). Oak, picked first, or black, the same $89. The choice is a radio pair under
 * the picker (framed only), one on the review sheet and one on the order form; the CSS mockup follows
 * it; it travels with the order record (POST /rp-order), the backup form, the outbox, the gift and
 * gift card posts; an old record without it reads black (every framed print sold before Nov 4 was
 * black). Sig's emails name the color (scripts/rp_buyer_email.py selftest, form_digest, morning_report).
 *
 * Every browser run blocks every outside host (BUILD-RULES 58: test/fixtures/rp-site-mock.mjs routes
 * PLACES_ROUTE, aborts the rest) and service workers.
 *
 *   node --test test/rp-frame-color.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { checkout } from "./fixtures/rp-checkout.mjs";
import { mocks, serve } from "./fixtures/rp-site-mock.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const ctxVm = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctxVm.window = ctxVm;
vm.runInNewContext(read("components/rain-print.js"), ctxVm);
const RP = ctxVm.RainPrint;
const HTML = read("rain-print.html");
const q = (o) => new URLSearchParams(o).toString();
const SIG = { place: "Chetek, WI", station: "471667 2", year: 2025, style: "r1", name: "Gustum Farm", markers: [{ date: "2025-04-01", label: "Moved in" }] };
const SIG_Q = { place: "Chetek, WI", year: "2025", station: "471667 2", style: "r1", name: "Gustum Farm", m1: "2025-04-01 Moved in" };

/* No reader copy says the framed print comes in a black frame alone. A picture's own words (an alt,
 * a figcaption of a photo or mockup that IS black) may say what it shows. Scripts that draw a black
 * frame into an image (share_cards.py, process_photo.py) are not copy. */
test("no reader copy still promises only a black frame", () => {
  const files = readdirSync(ROOT).filter((f) => f.endsWith(".html")).concat(
    readdirSync(ROOT + "components").filter((f) => f.endsWith(".js")).map((f) => "components/" + f),
    ["scripts/rp_buyer_email.py", "scripts/rp_buyer_render.mjs", "scripts/rp_design_email.py", "data/rain-print.json", "llms.txt"],
    existsSync(ROOT + "data/whats-new") ? readdirSync(ROOT + "data/whats-new").filter((f) => f.endsWith(".json")).map((f) => "data/whats-new/" + f) : []);
  const bad = [];
  for (const f of files) {
    if (!existsSync(ROOT + f)) continue;
    // a script's own selftest is not copy
    let t = read(f);
    if (t.includes("\ndef selftest(")) t = t.slice(0, t.indexOf("\ndef selftest("));
    t = t.replace(/alt="[^"]*"/g, "").replace(/<figcaption>[\s\S]*?<\/figcaption>/g, "");
    // "oak or black frame" is the offer; "(black frame)" names the color a buyer chose
    for (const m of t.matchAll(/(.{0,40})\bblack frame\b/gi)) if (!/(oak or (an? )?|\()$/i.test(m[1])) bad.push(f + ": ..." + m[0]);
  }
  assert.deepEqual(bad, []);
  // the offer, the FAQ and its structured data say oak or black
  assert.match(HTML, /"name": "Framed print, 13 x 19 frame in oak wood or black, acid-free white mat, 2 mm tempered glass, shipping included"/);
  assert.match(HTML, /The framed one comes in a 13 x 19 frame in oak wood or black, with an acid-free white mat and 2 mm tempered glass, ready to hang\./);
});

test("the frame specs follow the maker's listings: wood is oak only, 2 mm glass, no UV claim", () => {
  // Sig, Nov 4 (the maker's listings): oak is an oak wood frame, black is MDF with a black finish, so a
  // "wood frame" said of both is wrong; the glass is 2 mm tempered; the "75% UV protection" claim is the
  // maker's and unverified, so it is never repeated.
  const files = ["rain-print.html", "rp-gift.html", "rain-print-business.html", "birth-year-weather-gift.html",
    "wedding-year-weather-gift.html", "components/rain-print.js", "scripts/rp_buyer_email.py"];
  for (const f of files) {
    const t = read(f).replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(t, /(?<!oak )wood frame/i, f + ": black is not wood");
    assert.doesNotMatch(t, /\bUV\b|75\s?%/, f + ": no UV claim");
    if (/tempered glass/.test(t)) assert.doesNotMatch(t, /(?<!2 mm )\btempered glass/i, f + ": the glass is 2 mm");
  }
  const S = read("components/rain-print.js");
  assert.match(S, /framed12x18: '13 x 19 frame in oak wood or black, acid-free white mat, 2 mm tempered glass\.'/);
  assert.match(S, /\(FRAME === 'oak' \? 'Oak wood' : 'Black'\) \+ ', 13 x 19 frame, acid-free white mat, 2 mm tempered glass'/);
});

test("What you get lists the frame plainly, and the mat opening is the one the sheet is drawn for", () => {
  const box = HTML.match(/<h3>Framed<\/h3><ul>([\s\S]*?)<\/ul>/)[1];
  const items = [...box.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  for (const want of ["A 13 x 19 in frame, oak wood or black, your pick", "An acid-free white mat cut for 11 x 17, a 16.5 x 10.5 in opening", "2 mm tempered glass front",
    "14.3 x 20.3 in outside, 0.9 in frame, sturdy backboard, hanging hardware included", "Packed with corner guards and foam, double-boxed"]) assert.ok(items.includes(want), want);
  const S = read("components/rain-print.js");
  const sheet = /var SHEET = \{ w: 19, h: 13, art: \{ w: 16\.5, h: 11 \}, mat: \{ w: 16\.5, h: 10\.5 \}, safe: \{ w: 16\.25, h: 10\.25 \} \};/;
  assert.match(S, sheet, "the mat opening and safe area the page promises are the drawn ones");
  assert.doesNotMatch(box, /https?:|<a /, "no store links");
  assert.doesNotMatch(box + HTML.match(/id="rp-fcolor"[\s\S]*?<\/fieldset>/)[0], /—/, "no em dash");
});

test("the record: a framed order carries its color, oak by default; a print none; an old record reads black", () => {
  const code = RP.encodeCode(SIG);
  assert.equal(RP.orderRecord(SIG, code, "framed12x18", 89, "black").frame_color, "black");
  assert.equal(RP.orderRecord(SIG, code, "framed12x18", 89, "oak").frame_color, "oak");
  assert.equal(RP.orderRecord(SIG, code, "framed12x18", 89).frame_color, "oak");
  assert.ok(!("frame_color" in RP.orderRecord(SIG, code, "print12x18", 45, "black")));
  assert.equal(RP.frameOf({ product: "framed12x18" }), "black");
  const W = read("workers/subs-worker.js");
  assert.match(W, /^ \* v5\.63 \(2026-11-04\): FRAME COLOR/m, "the worker's version line");  // pin-ok: the worker version note in source, not data
  assert.match(W, /frame_color: \[5, false, "rpframe"\]/, "the order form kind (and the gift card redeem) keeps it");
});

// ---------- in a browser ----------
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

async function withPage(fn, opts = {}) {
  const srv = await serve(ROOT), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width: opts.width || 1280, height: 900 }, serviceWorkers: "block" });
    await ctx.clock.setFixedTime(new Date("2026-11-04T17:00:00Z"));
    const log = { stripe: [], order: [], worker: [], formspree: [] };
    await mocks(ctx, opts, log);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, `http://127.0.0.1:${port}`, errors, log);
  } finally { await browser.close(); srv.close(); }
}
const drawn = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && !document.getElementById("rp-art").getAttribute("aria-busy"), null, { timeout: 30000 });
const frameBg = (page) => page.$eval("#rp-wall .rp-frame", (el) => getComputedStyle(el).backgroundColor);
const fsFields = (b) => Object.fromEntries([...b.matchAll(/name="([^"]+)"\r\n\r\n([\s\S]*?)\r\n--/g)].map((m) => [m[1], m[2]]));

for (const width of [390, 1280]) {
  test(`in a browser at ${width}: Oak is picked first, shown for the framed print only, and the mockup follows the pick`, { skip, timeout: 90000 }, async () => {
    await withPage(async (page, base, errors) => {
      await page.goto(base + "/rain-print.html?" + q(SIG_Q));
      await drawn(page);
      assert.equal(await page.$eval('input[name="rp-frame"][value="oak"]', (r) => r.checked), true, "oak checked");
      assert.equal(await page.isVisible("#rp-fcolor"), true);
      assert.equal(await page.getAttribute("#rp-wall", "data-frame"), "oak");
      assert.equal(await frameBg(page), "rgb(196, 154, 108)", "an oak tone");
      assert.match(await page.$eval("#rp-wall .rp-frame", (el) => getComputedStyle(el).backgroundImage), /repeating-linear-gradient/, "with a grain");
      assert.match(await page.textContent("#rp-sample-txt"), /13 x 19, oak frame, white mat\./);
      // 44 px targets
      for (const v of ["oak", "black"]) {
        const b = await page.locator(`.rp-fc:has(input[value="${v}"])`).boundingBox();
        assert.ok(b.height >= 44 && b.width >= 44, v + " " + JSON.stringify(b));
      }
      await page.locator('.rp-fc:has(input[value="black"])').click();
      assert.equal(await page.getAttribute("#rp-wall", "data-frame"), "black");
      assert.equal(await page.getAttribute("#rp-strip", "data-frame"), "black");
      assert.equal(await frameBg(page), "rgb(19, 19, 19)", "the black stays as it was");
      assert.match(await page.textContent("#rp-sample-txt"), /13 x 19, black frame, white mat\./);
      await page.waitForFunction(() => /[?&]frame=black\b/.test(location.search), null, { timeout: 5000 });
      // a print: no frame choice
      await page.locator('.rp-prod[data-choice="print12x18"]').click();
      assert.equal(await page.isVisible("#rp-fcolor"), false, "hidden for the print");
      assert.doesNotMatch(new URL(page.url()).search, /frame=/, "the address has no frame for a print");
      await page.locator('.rp-prod[data-choice="framed12x18"]').click();
      assert.equal(await page.isVisible("#rp-fcolor"), true);
      assert.equal(await page.$eval('input[name="rp-frame"][value="black"]', (r) => r.checked), true, "the pick held");
      // a reload keeps it (the address)
      await page.waitForFunction(() => /[?&]frame=black\b/.test(location.search), null, { timeout: 5000 });
      await page.reload();
      await drawn(page);
      assert.equal(await page.getAttribute("#rp-wall", "data-frame"), "black", "back after a reload");
      assert.deepEqual(errors, []);
    }, { width });
  });
}

test("in a browser: the review sheet shows the frame, switches it, and the order record carries it", { skip, timeout: 90000 }, async () => {
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?" + q(SIG_Q));
    await drawn(page);
    // default oak to Stripe
    let r = await checkout(page, "framed12x18");
    assert.equal(r.stage, "stripe", JSON.stringify(r));
    assert.equal(log.order.length, 1);
    assert.equal(log.order[0].body.frame_color, "oak", "oak, the default, in the record");
    assert.equal(log.order[0].body.product, "framed12x18");
    // black, picked on the review sheet
    await page.goto(base + "/rain-print.html?" + q(SIG_Q));
    await drawn(page);
    await page.locator("#rp-pay").scrollIntoViewIfNeeded();
    await page.click("#rp-pay");
    await page.waitForTimeout(300);
    assert.equal(await page.$eval("#rp-proof", (d) => d.open), true);
    assert.equal(await page.isVisible("#rp-pframe-wrap"), true);
    assert.match(await page.textContent("#rp-proof-sum"), /FrameOak wood, 13 x 19 frame, acid-free white mat, 2 mm tempered glass/);
    assert.equal(await page.getAttribute("#rp-proof", "data-frame"), "oak");
    await page.locator('#rp-pframe-wrap label:has(input[value="black"])').click();
    assert.equal(await page.getAttribute("#rp-proof", "data-frame"), "black");
    assert.match(await page.textContent("#rp-proof-sum"), /FrameBlack, 13 x 19 frame, acid-free white mat, 2 mm tempered glass/);
    assert.equal(await page.$eval("#rp-proof-frame", (el) => getComputedStyle(el).backgroundColor), "rgb(19, 19, 19)");
    assert.equal(await page.$eval('input[name="rp-frame"][value="black"]', (x) => x.checked), true, "step 3 follows the sheet");
    await page.check("#rp-proof-ok");
    const went = page.waitForURL(/buy\.stripe\.com/, { timeout: 10000 });
    await page.click("#rp-proof-order");
    await went;
    assert.equal(log.order.length, 2);
    assert.equal(log.order[1].body.frame_color, "black");
    // a print carries none
    await page.goto(base + "/rain-print.html?" + q(SIG_Q));
    await drawn(page);
    r = await checkout(page, "print12x18");
    assert.equal(r.stage, "stripe");
    assert.ok(!("frame_color" in log.order[2].body), "no frame on a print");
    assert.deepEqual(errors, []);
  });
});

test("in a browser, the worker out: a framed order's color goes to Sig by the backup form, and waits in the outbox if that fails too", { skip, timeout: 120000 }, async () => {
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?" + q(SIG_Q) + "&frame=black");
    await drawn(page);
    const r = await checkout(page, "framed12x18");
    assert.equal(r.stage, "stripe", JSON.stringify(r));
    const fs = log.formspree.map((x) => fsFields(x.body)).find((f) => f.form === "rain-print-press");
    assert.ok(fs, "the backup form went for a short framed design too");
    assert.equal(fs.frame_color, "black");
    assert.equal(fs.product, "framed12x18");
    assert.ok(!/@/.test(JSON.stringify(fs)), "nothing about the buyer");
    assert.deepEqual(errors, []);
  }, { worker: "blocked" });
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?" + q(SIG_Q));
    await drawn(page);
    const r = await checkout(page, "framed12x18");
    assert.equal(r.stage, "stripe", JSON.stringify(r));
    await page.goto(base + "/rain-print.html");
    await page.waitForTimeout(2500);
    const left = await page.evaluate(() => JSON.parse(localStorage.getItem("agsist-rp-outbox") || "[]"));
    assert.equal(left.length, 1, "kept in this browser");
    assert.equal(left[0].fields.frame_color, "oak");
    assert.deepEqual(errors, []);
  }, { worker: "blocked", formspree: "fail" });
  // a print with the worker out sends nothing extra (only a long design or a framed one needs the backup)
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?" + q(SIG_Q));
    await drawn(page);
    const r = await checkout(page, "print12x18");
    assert.equal(r.stage, "stripe", JSON.stringify(r));
    assert.equal(log.formspree.filter((x) => fsFields(x.body).form === "rain-print-press").length, 0);
    assert.deepEqual(errors, []);
  }, { worker: "blocked" });
});

test("in a browser: the order form (and a gift card's order) carries the frame color", { skip, timeout: 90000 }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?" + q(SIG_Q) + "&frame=black");
    await drawn(page);
    // the order form opens when a product has no checkout; here: call it the way the page does
    await page.evaluate(() => { document.getElementById("rp-order").hidden = false; const c = document.getElementById("ro-choice"); c.value = "framed12x18"; c.dispatchEvent(new Event("change")); });
    assert.equal(await page.isVisible("#ro-frame-wrap"), true);
    assert.equal(await page.inputValue("#ro-frame"), "black", "the order form starts on the pick");
    await page.selectOption("#ro-choice", "digital");
    assert.equal(await page.isVisible("#ro-frame-wrap"), false, "hidden for the file");
    await page.selectOption("#ro-choice", "framed12x18");
    await page.selectOption("#ro-frame", "oak");
    assert.equal(await page.getAttribute("#rp-wall", "data-frame"), "oak", "the mockup follows the form too");
    assert.deepEqual(errors, []);
  });
  // the gift card client passes frame_color with the redeem body
  const G = read("components/rp-gift.js");
  assert.match(G, /'choice', 'page', 'logo', 'frame_color'\]\.forEach/);
  const S = read("components/rain-print.js");
  assert.match(S, /if \(x\.choice === 'framed12x18'\) x\.frame_color = frameColor\(\$\('ro-frame'\)\.value\);/);
  assert.match(S, /if \(PICK === 'framed12x18'\) x\.frame_color = FRAME;/, "the review sheet's gift post");
});
