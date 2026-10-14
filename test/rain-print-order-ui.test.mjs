/* /rain-print in a real browser: the order path a buyer walks, with NOAA
 * (data.rcc-acis.org), the town lookup and the subs worker answered here
 * from made-up data, and Stripe answered by a stand-in page (checkout is in
 * the same tab since 2026-10-14).
 *
 * Checks:
 *   - rain-print?d=RPS-<id> and ?d=GIFT-RPS-<id> open the design through the
 *     short link (they said "damaged or cut short");
 *   - the approved flow (2026-10-14, Sig): example words are gray hints only,
 *     never pre-filled on a buyer's print; one picker, framed first, whose
 *     pick the button, the print, the phone bar and the review sheet follow;
 *     "Check it and pay" asks once about a missing name, opens the review
 *     sheet, which asks for the spelling tick and pays in the same tab; Back
 *     brings the design back; "Paid, thank you" on the way back from Stripe;
 *     marked days are a month and a day from lists (a typed date with its year
 *     landed on the 25th); the business section folds to one card;
 *   - "Your print": the print fills the window and is whole at Fit on a
 *     laptop and a phone, nothing scrolls sideways, the magnifier toggles
 *     actual size, Esc goes back to Fit and then closes, focus goes back to
 *     the button that opened it;
 *   - labels count to 13 letters and say what was cut, never silently, and
 *     run full width on a phone.
 *
 * Needs Playwright and Chromium. Where they are missing (CI without a
 * browser), the test is skipped and says so.
 *
 *   node --test test/rain-print-order-ui.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";
import { checkout, stripePage, refOf } from "./fixtures/rp-checkout.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const SHOTS = process.env.RP_ORDER_SHOTS || null;
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const ctxVm = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctxVm.window = ctxVm;
vm.runInNewContext(readFileSync(ROOT + "components/rain-print.js", "utf8"), ctxVm);
const RP = ctxVm.RainPrint;
const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));

// a long design: past Stripe's 200 characters, so checkout carries RPS-<id>
const LONG = { place: "Chetek, WI", station: "471667 2", year: 2025, style: "r1", cmp: "normal", name: "The Olson Family Farm",
  dedication: "For Grandpa Erling, sixty harvests on the home place. Love, all of us",
  markers: [{ date: "2025-05-08", label: "Planted beans" }, { date: "2025-07-04", label: "Hay all in" }, { date: "2025-10-24", label: "Harvest done" }] };
const LONG_CODE = RP.encodeCode(LONG);
const GIFT_CODE = RP.encodeCode({ ...LONG, year: 2026, markers: [{ date: "2026-05-08", label: "Planted beans" }] });
const SHORT = { K7Q2M: LONG_CODE, G1FT9: GIFT_CODE };

// ---------- made-up NOAA data, the same shape ACIS sends ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function yearDays(y) { const a = []; for (let t = Date.UTC(y, 0, 1); new Date(t).getUTCFullYear() === y; t += 864e5) a.push(new Date(t).toISOString().slice(0, 10)); return a; }
function series(y) {
  const r = rng(7 + y);
  return yearDays(y).map((d, i) => {
    if (d > "2026-10-09") return [d, "M", "M", "M", "M", "M"];
    const u = r(), p = u < 0.12 ? (r() * r() * 2).toFixed(2) : u < 0.16 ? "T" : "0.00";
    const t = Math.round(44 + 32 * Math.sin((i - 105) / 365 * 2 * Math.PI));
    return [d, p, String(t), "0.0", String(t + 9), String(t - 9)];
  });
}
const STN = { name: "CHETEK", sids: ["471667 2"], ll: [-91.65, 45.32], valid_daterange: [["1950-01-01", "2026-10-09"]], state: "WI" };

async function mocks(ctx, opts = {}) {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = new URL(r.request().url());
    if (u.host === "buy.stripe.com") return stripePage(r, opts.stripe);
    if (u.host === "agsist-subs.dnilgis.workers.dev") {
      if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
      if (u.pathname === "/where") return opts.where ? r.fulfill({ headers: h, json: { ok: true, city: "Chetek", region_code: "WI" } }) : r.fulfill({ status: 503, headers: h, body: "x" });
      const m = /^\/rp-short\/([0-9A-Z]+)$/.exec(u.pathname);
      if (m) return SHORT[m[1]] ? r.fulfill({ status: 200, headers: h, json: { ok: true, code: SHORT[m[1]] } }) : r.fulfill({ status: 404, headers: h, json: { ok: false } });
      if (u.pathname === "/rp-short") return r.fulfill({ status: 200, headers: h, json: { ok: true, id: "K7Q2M" } });
      return r.fulfill({ status: 503, headers: h, body: "x" });
    }
    if (u.host === "geocoding-api.open-meteo.com") return r.fulfill({ json: { results: [{ name: "Chetek", latitude: 45.3141, longitude: -91.651, admin1: "Wisconsin", country_code: "US" }] } });
    if (u.host === "data.rcc-acis.org") {
      if (u.pathname === "/StnMeta") return r.fulfill({ json: { meta: [STN] } });
      let sdate = u.searchParams.get("sdate"), normal = false;
      if (u.searchParams.get("params")) { const p = JSON.parse(u.searchParams.get("params")); sdate = p.sdate; normal = true; }
      if (normal) return r.fulfill({ json: { data: yearDays(+String(sdate).slice(0, 4)).map((d) => [d, "0.08"]) } });
      if (sdate === "por") { let data = []; for (let y = 1995; y <= 2025; y++) data = data.concat(series(y)); return r.fulfill({ json: { data } }); }
      return r.fulfill({ json: { meta: { name: STN.name, state: "WI", ll: STN.ll }, data: series(+String(sdate).slice(0, 4)) } });
    }
    return r.abort();
  });
}

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png" };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function withPage(fn, { width = 390, height = 844, theme = "light", where = false } = {}) {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", colorScheme: theme });
    await ctx.clock.setFixedTime(new Date("2026-10-14T17:00:00Z"));
    const stripe = [];
    await mocks(ctx, { stripe, where });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, `http://127.0.0.1:${port}`, errors, stripe);
  } finally { await browser.close(); srv.close(); }
}
const drawn = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled, null, { timeout: 30000 });
const onScreen = (page, sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; });
const settle = (page) => page.waitForTimeout(900);
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: SHOTS + "/" + name + ".png" }); } };
const q = (o) => new URLSearchParams(o).toString();
const plain = (x) => JSON.parse(JSON.stringify(x));
test("rain-print?d=RPS-<id> opens the design; GIFT-RPS-<id> keeps the gift flag", { skip }, async () => {
  assert.ok(LONG_CODE.length > 200 && RP.checkoutRef(LONG_CODE, false, "HTTPS://AGSIST.COM/R?K7Q2M") === "RPS-K7Q2M");
  for (const theme of ["light", "dark"]) await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?d=RPS-K7Q2M");
    await drawn(page);
    await settle(page);
    await shot(page, "rps-open-390-" + theme);
    assert.equal(await page.inputValue("#rp-name"), LONG.name);
    assert.equal(await page.inputValue("#rp-m1l"), "Planted beans");
    assert.equal(await page.isHidden("#rp-link-note"), true, "no 'damaged or cut short' note");
    await page.goto(base + "/rain-print.html?d=GIFT-RPS-G1FT9");
    await drawn(page);
    assert.equal(await page.inputValue("#rp-name"), LONG.name);
    assert.match(page.url(), /[?&]gift=1(&|$)/, "the January gift flag stays on the design");
    await page.goto(base + "/rain-print.html?d=RPS-ZZZZZ");
    await page.waitForFunction(() => !document.getElementById("rp-link-note").hidden, null, { timeout: 15000 });
    assert.match(await page.textContent("#rp-link-note"), /RPS-ZZZZZ isn’t one the site knows/);
    assert.deepEqual(errors, []);
  }, { theme });
});

// ---------- the approved flow (2026-10-14, Sig: "yes to all three, build it") ----------
const MINE = { place: "Chetek, WI", year: "2025", station: "471667 2", style: "r1", name: "Olson" };
const decodeRef = (u) => RP.decodeCode(refOf(u));

test("a new visit: empty boxes with the example as gray hints; the print at the top wears it, labeled, until the reader acts; none of it reaches the order", { skip }, async () => {
  for (const theme of ["light", "dark"]) await withPage(async (page, base, errors, stripe) => {
    await page.goto(base + "/rain-print.html");
    await drawn(page);
    await settle(page);
    for (const [id, ph] of [["rp-name", "The Johnson Farm"], ["rp-ded", "For Dad, his 40th crop. Love, Kate"], ["rp-m1l", "Planted"]]) {
      assert.equal(await page.inputValue("#" + id), "", id + " starts empty");
      assert.equal(await page.getAttribute("#" + id, "placeholder"), ph, id + " shows the example as a gray hint");
    }
    assert.match(await page.innerHTML("#rp-art"), /The Johnson Farm/, "the print at the top shows what a print can carry");
    assert.equal(await page.textContent("#rp-sample-txt"), "Example words on your area, Chetek, WI, 2025. Yours start blank.");
    assert.ok(!/name=/.test(page.url()), "the example is never in the design: " + page.url());
    await shot(page, "landing-390-" + theme);
    // straight to checkout with nothing typed: one question about the name, then the reader's own blank print
    const r0 = await checkout(page, null, { name: false });
    assert.equal(r0.stage, "noname");
    assert.equal(await page.textContent("#rp-noname p"), "There’s no name on it yet.");
    assert.ok(!/Johnson/.test(await page.innerHTML("#rp-art")), "the example came off the print at the first tap");
    await page.click("#rp-noname-go");
    await page.waitForSelector("#rp-proof[open]");
    assert.ok(!/Johnson|Kate/.test(await page.innerHTML("#rp-proof-art") + await page.textContent("#rp-proof-sum")), "the review sheet shows the reader's own print");
    await page.check("#rp-proof-ok");
    await Promise.all([page.waitForURL(/buy\.stripe\.com/), page.click("#rp-proof-order")]);
    const d = decodeRef(stripe[0]);
    assert.deepEqual([d.name, d.dedication, d.markers.length, d.records], ["", "", 0, false], "no example words, remarkable days off");
    assert.deepEqual(errors, []);
  }, { theme, where: true });
  // the Chetek sample (no answer from /where): the same rule, and typing takes the example off
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html");
    await drawn(page);
    await settle(page);
    assert.equal(await page.textContent("#rp-sample-txt"), "Sample: Chetek, WI, 2025, with example words. Yours start blank.");
    assert.equal(await page.isVisible("#rp-sample-use"), true);
    await page.fill("#rp-name", "The Olson Place");
    await settle(page);
    const art = await page.innerHTML("#rp-art");
    assert.ok(/The Olson Place/.test(art) && !/Johnson|Harvest done/.test(art), "the reader's words, and only theirs");
    assert.deepEqual(errors, []);
  });
});

test("one picker, framed first: the button, the print's look, the phone bar and the review sheet all follow the pick", { skip }, async () => {
  for (const theme of ["light", "dark"]) await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?" + q(MINE));
    await drawn(page);
    await settle(page);
    assert.equal(await page.$eval('input[name="rp-product"]:checked', (r) => r.value), "framed12x18", "framed is picked first");
    assert.equal(await page.textContent("#rp-pay"), "Check it and pay $" + J.framed12x18);
    assert.match(await page.textContent("#rp-sub-framed12x18"), /^Black frame, real glass\. Order by Dec 9 for Christmas delivery\.$/);
    assert.match(await page.textContent("#rp-sub-print12x18"), /Order by Dec 10 for Christmas delivery\./);
    assert.equal(await page.textContent("#rp-xmas-top"), "For Christmas: order framed by Dec 9, a print by Dec 10.");
    await page.click('.rp-prod[data-choice="print12x18"]');
    assert.equal(await page.textContent("#rp-pay"), "Check it and pay $" + J.print12x18);
    assert.equal(await page.getAttribute("#rp-wall", "data-view"), "print", "the print at the top shows the pick");
    // the bar: after a draw, at the top of the page
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page);
    assert.equal(await page.isVisible("#rp-bar"), true, "the phone bar shows after a draw");
    assert.equal(await page.textContent("#rp-bar-what"), "Print only · $" + J.print12x18);
    assert.equal(await page.textContent("#rp-bar-go"), "Check it and pay");
    await shot(page, "bar-390-" + theme);
    // not while a box has the keyboard
    await page.focus("#rp-place");
    await settle(page);
    assert.equal(await page.isVisible("#rp-bar"), false, "no bar over a box being typed in");
    await page.evaluate(() => document.activeElement.blur());
    // not while the step 3 button is on screen
    await page.locator("#rp-pay").scrollIntoViewIfNeeded();
    await settle(page);
    assert.equal(await page.isVisible("#rp-bar"), false, "no bar while the step 3 button shows");
    // the slim copy pins under the menu, and a focused box stays below it
    await page.evaluate(() => window.scrollTo(0, document.getElementById("rp-design").getBoundingClientRect().top + scrollY - 40));
    await settle(page);
    assert.equal(await page.isVisible("#rp-strip"), true, "the print pins under the menu once it scrolls away");
    await page.focus("#rp-ded");
    await settle(page);
    const gap = await page.evaluate(() => document.getElementById("rp-ded").getBoundingClientRect().top - document.getElementById("rp-strip").getBoundingClientRect().bottom);
    assert.ok(gap >= 0, "the focused box is below the pinned print (" + gap + " px)");
    await shot(page, "strip-390-" + theme);
    await page.evaluate(() => document.activeElement.blur());
    // the bar opens the review sheet, which mirrors the picker both ways
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page);
    await page.click("#rp-bar-go");
    await page.waitForSelector("#rp-proof[open]");
    assert.equal(await page.$eval('input[name="rp-pproduct"]:checked', (r) => r.value), "print12x18");
    assert.equal(await page.textContent("#rp-proof-order"), "Pay $" + J.print12x18 + " at checkout");
    await page.click('#rp-proof label:has(input[name="rp-pproduct"][value="digital"])');
    assert.equal(await page.textContent("#rp-proof-order"), "Pay $" + J.digital + " at checkout");
    assert.match(await page.textContent("#rp-proof-first"), /No proof for the file/);
    assert.equal(await page.$eval('input[name="rp-product"][value="digital"]', (r) => r.checked), true, "one product state: step 3 follows the sheet");
    await page.click("#rp-proof-close");
    assert.equal(await page.textContent("#rp-pay"), "Check it and pay $" + J.digital);
    assert.deepEqual(errors, []);
  }, { theme });
});

test("Check it and pay: no name asks once; the review sheet asks for the tick; checkout is this tab; Back brings the design back", { skip }, async () => {
  for (const [width, theme] of [[390, "light"], [1280, "dark"]]) await withPage(async (page, base, errors, stripe) => {
    await page.goto(base + "/rain-print.html?" + q({ ...MINE, name: "" }));
    await drawn(page);
    await settle(page);
    await page.locator("#rp-pay").scrollIntoViewIfNeeded();
    await page.click("#rp-pay");
    assert.equal(await page.isVisible("#rp-noname"), true, "no name: asked once, right under the button");
    assert.ok(await onScreen(page, "#rp-noname-go"));
    await shot(page, `noname-${width}-${theme}`);
    await page.click("#rp-noname-add");
    assert.equal(await page.evaluate(() => document.activeElement.id), "rp-name", "Add a name goes to the box");
    await page.keyboard.type("Lindquist Farm");
    await page.locator("#rp-pay").scrollIntoViewIfNeeded();
    await page.click("#rp-pay");
    await page.waitForSelector("#rp-proof[open]");
    assert.equal(await page.isVisible("#rp-noname"), false, "a name typed: no question");
    // the sheet: the details in words, then the tick, then the button
    assert.match(await page.textContent("#rp-proof-sum"), /NameLindquist Farm/);
    assert.match(await page.textContent("#rp-proof-ok-wrap"), /The spelling and the dates are right/);
    await page.click("#rp-proof-order");
    assert.equal(await page.textContent("#rp-proof-msg"), "Tick the box once the spelling and the dates are right.");
    assert.deepEqual(stripe, [], "nothing paid before the tick");
    await shot(page, `review-${width}-${theme}`);
    await page.check("#rp-proof-ok");
    await Promise.all([page.waitForURL(/buy\.stripe\.com/), page.click("#rp-proof-order")]);
    assert.equal(stripe.length, 1, "checkout opens in this tab, once");
    assert.ok(stripe[0].startsWith(J.payment_links.framed12x18 + "?client_reference_id="), stripe[0]);
    assert.equal(decodeRef(stripe[0]).name, "Lindquist Farm");
    // Back from Stripe: the same design, the same pick
    await page.goBack();
    await drawn(page);
    assert.equal(await page.inputValue("#rp-name"), "Lindquist Farm");
    assert.equal(await page.$eval("#rp-proof", (d) => d.open), false, "no sheet left open");
    assert.deepEqual(errors, []);
  }, { width, height: width < 600 ? 844 : 800, theme });
});

test("a marked day is a month and a day from lists: the day picked is the day ordered (05022025 landed on the 25th)", { skip }, async () => {
  await withPage(async (page, base, errors, stripe) => {
    await page.goto(base + "/rain-print.html?" + q(MINE));
    await drawn(page);
    assert.equal(await page.$('input[type="date"]'), null, "no date box: its min and max locked the year, so a typed year went into the day");
    assert.equal(await page.isVisible("#rp-m2row"), false, "one row to start");
    // a label idea fills the first empty label and sends the reader to its month
    await page.click('#rp-presets button:text-is("Planted")');
    assert.equal(await page.inputValue("#rp-m1l"), "Planted");
    assert.equal(await page.evaluate(() => document.activeElement.id), "rp-m1mo");
    assert.match(await page.textContent("#rp-date-msg"), /Day 1 \(“Planted”\) needs a month and a day to go on the print\./, "a half-picked day says it won't print");
    // keyboard, the way a 60-year-old fills it: focus the month, type, tab, type
    await page.keyboard.type("May");
    await page.keyboard.press("Tab");
    await page.keyboard.type("2");
    await settle(page);
    assert.deepEqual([await page.inputValue("#rp-m1mo"), await page.inputValue("#rp-m1dy")], ["05", "02"]);
    assert.equal(await page.isHidden("#rp-date-msg"), true);
    // two more days
    await page.click("#rp-add-day");
    await page.selectOption("#rp-m2mo", "06"); await page.selectOption("#rp-m2dy", "21"); await page.fill("#rp-m2l", "Hail");
    await page.click("#rp-add-day");
    assert.equal(await page.isVisible("#rp-add-day"), false, "three is the most");
    await page.selectOption("#rp-m3mo", "10"); await page.selectOption("#rp-m3dy", "30"); await page.fill("#rp-m3l", "Combined");
    assert.equal(await page.$$eval("#rp-m2dy option", (o) => o.length - 1), 30, "June has 30 days");
    await settle(page);
    const r = await checkout(page, "framed12x18");
    assert.equal(r.stage, "stripe");
    assert.deepEqual(plain(decodeRef(r.url).markers.map((m) => m.date + " " + m.label)), ["2025-05-02 Planted", "2025-06-21 Hail", "2025-10-30 Combined"]);
    // Feb 29 and a year without one: said, not moved
    await page.goto(base + "/rain-print.html?" + q({ ...MINE, year: "2024", m1: "2024-02-29 Leap day" }));
    await drawn(page);
    assert.deepEqual([await page.inputValue("#rp-m1mo"), await page.inputValue("#rp-m1dy")], ["02", "29"]);
    await page.selectOption("#rp-year", "2025");
    await drawn(page);
    assert.match(await page.textContent("#rp-date-msg"), /isn’t in 2025, so it won’t be on the print/);
    assert.deepEqual(errors, []);
  });
});

test("Paid, thank you: what was ordered, when the proof comes, Christmas, one purchase for Analytics, a clean address", { skip }, async () => {
  // the words, from the pure function (no browser)
  const today = "2026-10-14", saved = { choice: "framed12x18", place: "Chetek, WI", year: 2012 };
  assert.deepEqual(plain(RP.paidText({ choice: "framed12x18", today, prices: J, saved })), [
    "Your framed print of Chetek, WI, 2012 is ordered. I email you a proof from sig@farmers1st.com by Thursday, Oct 15. Reply OK, or tell me what to change.",
    "It ships within 3 business days after your OK, and ordered by Dec 9 it arrives by Christmas.",
    "Nothing by then? Check spam, or write to me at sig@farmers1st.com."]);
  assert.deepEqual(plain(RP.paidText({ choice: "digital", today: "2026-10-16", prices: J, saved: null })), [
    "The finished file comes by email by Monday, Oct 19. Want anything changed? Reply and I’ll redo it, no charge.",
    "Nothing by then? Check spam, or write to me at sig@farmers1st.com."], "a Friday order: Monday; no saved design: no order line");
  assert.equal(RP.paidText({ choice: "print12x18", today: "2026-11-25", prices: J, saved: null })[0], "I email you a proof from sig@farmers1st.com by Friday, Nov 27. Reply OK, or tell me what to change.", "Thanksgiving is skipped");
  assert.equal(RP.paidText({ choice: "framed12x18", today: "2026-12-12", prices: J, saved: null })[1], "It ships within 3 business days after your OK. Ordered now, it arrives after Christmas.");
  assert.match(RP.paidText({ choice: "framed12x18", today, prices: J, saved: { ...saved, year: 2026, gift: true } })[0], /^Your framed print of Chetek, WI, 2026 is ordered\. Your gift card to print comes by email by Thursday, Oct 15\. The print follows in January, with a proof to you first\.$/);
  assert.equal(RP.paidText({ choice: "digital", today, prices: J, saved }).length, 2, "a saved framed design is not this file: no order line");
  assert.equal(RP.paidFromUrl("?paid=framed12x18&s={CHECKOUT_SESSION_ID}").session, "", "an unfilled session id is not one");
  assert.equal(RP.paidFromUrl("?paid=poster&s=cs_test_a1b2c3d4"), null);
  // in the page, after a real checkout in this tab
  await withPage(async (page, base, errors, stripe) => {
    await page.goto(base + "/rain-print.html?" + q({ ...MINE, year: "2012" }));
    await drawn(page);
    const r = await checkout(page, "framed12x18");
    assert.equal(r.stage, "stripe");
    await page.goto(base + "/rain-print.html?paid=framed12x18&s=cs_test_a1b2c3d4e5f6");
    await page.waitForFunction(() => !document.getElementById("rp-paid").hidden);
    await drawn(page);
    await settle(page);
    const box = await page.innerText("#rp-paid");
    assert.match(box, /^Paid\. Thank you\.\s+Your framed print of Chetek, WI, 2012 is ordered\. I email you a proof from sig@farmers1st\.com by Thursday, Oct 15\./);
    assert.match(box, /ordered by Dec 9 it arrives by Christmas\.[\s\S]*Make another$/);
    assert.equal(await page.evaluate(() => document.activeElement.id), "rp-paid", "the box takes focus");
    assert.ok(!/paid=|[?&]s=/.test(page.url()), "the address bar loses paid and s: " + page.url());
    assert.equal(await page.inputValue("#rp-name"), "Olson", "the design ordered draws again under it");
    const buys = () => page.evaluate(() => (window.dataLayer || []).filter((a) => a && a[0] === "event" && a[1] === "purchase").map((a) => [a[2].transaction_id, a[2].value, a[2].currency]));
    assert.deepEqual(await buys(), [["cs_test_a1b2c3d4e5f6", J.framed12x18, "USD"]]);
    await shot(page, "paid-390");
    // a reload of the same return: thanks again, no second purchase
    await page.goto(base + "/rain-print.html?paid=framed12x18&s=cs_test_a1b2c3d4e5f6");
    await page.waitForFunction(() => !document.getElementById("rp-paid").hidden);
    await settle(page);
    assert.deepEqual(await buys(), [], "one purchase per checkout session");
    assert.deepEqual(errors, []);
  });
});

test("the business section folds to one card, and a link to it opens it", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?" + q(MINE));
    await drawn(page);
    assert.equal(await page.isVisible("#rb-form"), false, "folded");
    assert.match(await page.textContent("#rp-biz-d > summary"), /Ordering 5 or more for customers\?.*Get a quote/s);
    await page.click("#rp-biz-d > summary");
    assert.equal(await page.isVisible("#rb-form"), true, "the quote form, as it was");
    await page.goto(base + "/rain-print.html?" + q(MINE) + "#rp-biz");
    await drawn(page);
    assert.equal(await page.isVisible("#rb-form"), true, "a link to #rp-biz opens it");
    assert.deepEqual(errors, []);
  });
});

test("labels: a counter to 13 letters, a paste past it says what was cut, a linked cut label is flagged on the proof, full width on a phone", { skip }, async () => {
  for (const theme of ["light", "dark"]) await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?" + q({ place: "Chetek, WI", year: "2025", station: "471667 2", name: "Olson", m1: "2025-06-22 Our wedding day", m2: "2025-10-24 Harvest done" }));
    await drawn(page);
    assert.equal(await page.inputValue("#rp-m1l"), "Our wedding d");
    assert.match(await page.textContent("#rp-m1l-n"), /Only 13 letters fit, so “Our wedding day” is cut to “Our wedding d”/);
    assert.equal(await page.textContent("#rp-m2l-n"), "12 of 13 letters");
    // phone: each label box runs the full width, so "Harvest done" isn't clipped
    const w = await page.$eval("#rp-m2l", (el) => [el.getBoundingClientRect().width, el.scrollWidth, el.clientWidth, document.getElementById("rp-name").getBoundingClientRect().width]);
    assert.ok(Math.abs(w[0] - w[3]) < 2, `label box is as wide as the name box on a phone: ${w[0]} vs ${w[3]}`);
    assert.ok(w[1] <= w[2], "no text clipped in the box");
    await page.locator("#rp-m1l").scrollIntoViewIfNeeded();
    await shot(page, "labels-390-" + theme);
    // the proof flags it
    await page.click("#rp-zoom");
    await page.waitForSelector("#rp-proof[open]");
    assert.match(await page.textContent("#rp-proof-sum"), /“Our wedding d” \(cut off: only 13 letters fit, the link had “Our wedding day”\)/);
    await page.click("#rp-proof-close");
    // typing: the box stops at 13, and the counter says that's the most (a third day is one tap away)
    await page.click("#rp-add-day");
    await page.fill("#rp-m3l", "");
    await page.type("#rp-m3l", "Sold the cows today");
    assert.equal(await page.inputValue("#rp-m3l"), "Sold the cows");
    assert.equal(await page.textContent("#rp-m3l-n"), "13 of 13 letters. That’s the most that fits.");
    // a paste past the limit is cut by the box, and the counter names it
    await page.fill("#rp-m3l", "");
    await page.focus("#rp-m3l");
    await page.evaluate(() => {
      const el = document.getElementById("rp-m3l"), dt = new DataTransfer();
      dt.setData("text/plain", "Dad's last crop");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      el.value = "Dad's last crop".slice(0, 13); el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(50);
    assert.match(await page.textContent("#rp-m3l-n"), /“Dad's last crop” is cut to “Dad's last cr”/);
    // changing the label clears it
    await page.fill("#rp-m3l", "Last crop");
    assert.equal(await page.textContent("#rp-m3l-n"), "9 of 13 letters");
    assert.deepEqual(errors, []);
  }, { theme });
});

// "Your print", rebuilt 2026-10-14 (Sig: "all scrunched and very hard to see")
const proofBox = (page) => page.evaluate(() => {
  const f = document.getElementById("rp-proof-frame").getBoundingClientRect(), st = document.getElementById("rp-proof-stage").getBoundingClientRect(), d = document.getElementById("rp-proof");
  return { inView: f.width > 0 && f.left >= st.left - 1 && f.right <= st.right + 1 && f.top >= st.top - 1 && f.bottom <= st.bottom + 1 && f.bottom <= innerHeight,
    share: (f.width * f.height) / (innerWidth * innerHeight), w: f.width, vw: innerWidth,
    sideways: d.scrollWidth > d.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1 };
});

for (const [width, height] of [[1366, 768], [1890, 870], [390, 844], [360, 740]]) {
  test(`Your print at ${width} x ${height}: the print is whole and the biggest thing at Fit, nothing scrolls sideways`, { skip }, async () => {
    await withPage(async (page, base, errors) => {
      await page.goto(base + "/rain-print.html?" + q({ place: "Chetek, WI", year: "2025", station: "471667 2", name: "Olson", m1: "2025-06-22 Married" }));
      await drawn(page);
      await page.click("#rp-zoom");
      await page.waitForSelector("#rp-proof[open]");
      for (const [view, pick] of [["framed", "framed12x18"], ["print", "print12x18"]]) {
        await page.click(`#rp-proof label:has(input[name="rp-pproduct"][value="${pick}"])`);
        assert.equal(await page.getAttribute("#rp-proof", "data-view"), view);
        const b = await proofBox(page);
        assert.ok(b.inView, view + ": the whole print is in view at Fit");
        assert.ok(!b.sideways, view + ": nothing scrolls sideways");
        if (width >= 900) assert.ok(b.share > 0.4, `${view}: the print takes ${Math.round(b.share * 100)}% of the window`);
        else assert.ok(b.w >= b.vw - 40, `${view}: the print runs the phone's width (${b.w} of ${b.vw})`);
      }
      assert.ok(await onScreen(page, "#rp-proof-close"), "Close is on screen");
      if (width >= 900) assert.ok(await onScreen(page, "#rp-proof-order"), "the pay button is on screen beside the print");
      assert.deepEqual(errors, []);
    }, { width, height });
  });
}

test("Your print: labeled controls, the magnifier, Esc back to Fit then closed, focus back on the opener", { skip }, async () => {
  await withPage(async (page, base, errors, stripe) => {
    await page.goto(base + "/rain-print.html?" + q({ place: "Chetek, WI", year: "2025", station: "471667 2", name: "Olson", m1: "2025-06-22 Married" }));
    await drawn(page);
    await page.focus("#rp-zoom");
    await page.keyboard.press("Enter");
    await page.waitForSelector("#rp-proof[open]");
    assert.equal(await page.getAttribute("#rp-proof-close", "aria-label"), "Close");
    assert.equal(await page.textContent("#rp-proof-h"), "Your print");
    assert.equal(await page.getAttribute("#rp-proof", "data-zoom"), "fit", "it opens at Fit");
    assert.match(await page.getAttribute("#rp-proof-stage", "aria-label"), /^The print\. +Place and year: Chetek, WI, 2025\. .*Name: Olson\./, "the print has its words");
    // the details: label above value, in the order a buyer checks them
    assert.deepEqual(await page.$$eval("#rp-proof-sum dt", (a) => a.map((x) => x.textContent)), ["Place and year", "Weather station", "Name", "Line under it", "Dates", "Compared with", "Style", "When"]);
    // one product state (2026-10-14): the sheet's picker is step 3's, no Style or Look of its own
    assert.deepEqual(await page.$$eval("#rp-proof [role=radiogroup]", (a) => a.map((g) => document.getElementById(g.getAttribute("aria-labelledby")).textContent)), ["You get"]);
    await page.click('#rp-proof label:has(input[name="rp-pproduct"][value="print12x18"])');
    assert.ok(await page.$eval('input[name="rp-product"][value="print12x18"]', (r) => r.checked), "step 3 follows");
    assert.equal(await page.getAttribute("#rp-wall", "data-view"), "print", "and so does the print at the top");
    // the magnifier: actual size, 18 in wide, then Esc back to Fit, with the dialog still open
    await page.click("#rp-proof-zoom");
    assert.equal(await page.getAttribute("#rp-proof", "data-zoom"), "full");
    assert.equal(await page.getAttribute("#rp-proof-zoom", "aria-pressed"), "true");
    assert.equal(await page.textContent("#rp-proof-zoom-t"), "Fit");
    assert.equal(await page.$eval("#rp-proof-art svg", (s) => Math.round(s.getBoundingClientRect().width)), 18 * 96, "actual size is 18 in");
    await page.keyboard.press("Escape");
    assert.equal(await page.getAttribute("#rp-proof", "data-zoom"), "fit", "Esc goes back to Fit");
    assert.equal(await page.$eval("#rp-proof", (d) => d.open), true, "and leaves it open");
    // clicking a spot on the print shows that spot at actual size
    await page.click("#rp-proof-frame", { position: { x: 20, y: 20 } });
    assert.equal(await page.getAttribute("#rp-proof", "data-zoom"), "full");
    await page.click("#rp-proof-zoom");
    assert.equal(await page.getAttribute("#rp-proof", "data-zoom"), "fit");
    // focus stays inside, then Esc closes and focus goes back to the button that opened it
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      assert.ok(await page.evaluate(() => document.getElementById("rp-proof").contains(document.activeElement)), "focus stays in the dialog");
    }
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("rp-proof").open);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "rp-zoom", "focus is back on the opener");
    assert.deepEqual(stripe, [], "nothing ordered");
    assert.deepEqual(errors, []);
  }, { width: 1366, height: 768 });
});

test("Up close on a new visit's print: the sheet shows the reader's own print; Change something goes to Your words; the sample says Draw your own", { skip }, async () => {
  await withPage(async (page, base, errors, stripe) => {
    await page.goto(base + "/rain-print.html");
    await drawn(page);
    await settle(page);
    assert.match(await page.textContent("#rp-sample-txt"), /^Sample: Chetek, WI/);
    await page.click("#rp-zoom");
    await page.waitForSelector("#rp-proof[open]");
    assert.ok(!/Johnson/.test(await page.innerHTML("#rp-proof-art")), "no example words in the sheet");
    assert.equal(await page.textContent("#rp-proof-order"), "Draw your own");
    assert.match(await page.textContent("#rp-proof-first"), /This is a sample\. Type the town nearest the farm to draw your own\./);
    await page.click("#rp-proof-change");
    await settle(page);
    assert.equal(await page.$eval("#rp-proof", (d) => d.open), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), "rp-name", "Change something lands on the words");
    assert.deepEqual(stripe, []);
    assert.deepEqual(errors, []);
  });
});
