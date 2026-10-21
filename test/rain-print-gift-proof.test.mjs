/* /rain-print: the gift is marked before Stripe (field audit, 2026-10-17).
 *
 * A gift buyer used to reach Stripe without one word about gifts on the last
 * AGSIST screen; the order form's "It's a gift" tick only showed on the
 * order-request path. Now the line above Pay offers it, the review sheet has
 * the tick and the fields, its summary shows them, and Pay posts them as a
 * rain-print-order (gift: yes) before checkout opens. NOAA, the town lookup,
 * the subs worker and Stripe are answered here from made-up data.
 *
 *   node --test test/rain-print-gift-proof.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = process.env.RP_ROOT || fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;


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
const CHETEK = { name: "CHETEK", sids: ["471667 2"], ll: [-91.65, 45.32], valid_daterange: [["1950-01-01", "2026-10-09"]], state: "WI" };
const RATHBUN = { name: "RATHBUN DAM", sids: ["136910 2"], ll: [-92.90, 40.82], valid_daterange: [["1950-01-01", "2026-10-09"]], state: "IA" };
const GEO = {
  chetek: [{ name: "Chetek", latitude: 45.3141, longitude: -91.651, admin1: "Wisconsin", country_code: "US" }],
  // another Rathbun, 300 km off (the lookup's first answer), and no Rathbun at all
  "rathbun-far": [{ name: "Rathbun", latitude: 43.0, longitude: -95.5, admin1: "Iowa", country_code: "US" }],
  "rathbun-none": [],
};

async function mocks(ctx, opts) {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = new URL(r.request().url());
    if (opts.log) opts.log.push(u.host + u.pathname + "?" + u.search.slice(0, 160));
    if (u.host === "agsist-subs.dnilgis.workers.dev") {
      if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
      if (u.pathname === "/rp-short") return opts.shortFail ? r.fulfill({ status: 503, headers: h, body: "x" }) : r.fulfill({ status: 200, headers: h, json: { ok: true, id: "K7Q2M" } });
      if (u.pathname === "/form") { if (opts.posts) opts.posts.push(r.request().postDataJSON()); return opts.formFail ? r.fulfill({ status: 400, headers: h, json: { error: "bad" } }) : r.fulfill({ status: 200, headers: h, json: { ok: true } }); }
      return r.fulfill({ status: 503, headers: h, body: "x" });
    }
    if (u.host === "buy.stripe.com") { if (opts.stripe) opts.stripe.push(u.href); } if (u.host === "buy.stripe.com") return r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><p>stripe</p>" });
    if (u.host === "geocoding-api.open-meteo.com") {
      const name = (u.searchParams.get("name") || "").toLowerCase();
      return r.fulfill({ json: { results: name === "rathbun" ? GEO[opts.rathbun || "rathbun-far"] : GEO.chetek } });
    }
    if (u.host === "data.rcc-acis.org") {
      const stn = opts.stn || CHETEK;
      if (u.pathname === "/StnMeta") return r.fulfill({ json: { meta: [stn] } });
      let sdate = u.searchParams.get("sdate"), normal = false;
      if (u.searchParams.get("params")) { sdate = JSON.parse(u.searchParams.get("params")).sdate; normal = true; }
      if (opts.failYear && String(sdate).startsWith(String(opts.failYear))) return r.fulfill({ status: 503, body: "<html>503</html>" });
      if (normal) return r.fulfill({ json: { data: yearDays(+String(sdate).slice(0, 4)).map((d) => [d, "0.08"]) } });
      if (sdate === "por") { let data = []; for (let y = 1995; y <= 2025; y++) data = data.concat(series(y).map((x) => x.slice(0, 3))); return r.fulfill({ json: { data } }); }
      return r.fulfill({ json: { meta: { name: stn.name, state: stn.state, ll: stn.ll }, data: series(+String(sdate).slice(0, 4)) } });
    }
    return r.abort();
  });
}
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function withPage(fn, { width = 390, height = 844, ...opts } = {}) {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", hasTouch: width < 900, isMobile: false });
    await ctx.clock.setFixedTime(new Date("2026-10-15T17:00:00Z"));
    await mocks(ctx, opts);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, `http://127.0.0.1:${port}`, errors, ctx);
  } finally { await browser.close(); srv.close(); }
}
const idle = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && !document.getElementById("rp-art").getAttribute("aria-busy"), null, { timeout: 30000 });

const HTML = readFileSync(ROOT + "rain-print.html", "utf8");
const JS = readFileSync(ROOT + "components/rain-print.js", "utf8");

test("the gift offer sits above the Pay button, and the review sheet carries the gift fields", () => {
  assert.ok(HTML.indexOf('id="rp-gift-pre"') > 0 && HTML.indexOf('id="rp-gift-pre"') < HTML.indexOf('id="rp-pay"'), "gift line before Pay");
  for (const id of ["rp-pg-on", "rp-pg-to", "rp-pg-msg", "rp-pg-deliver", "rp-pg-addr", "rp-pg-email", "rp-pg-name", "rp-pg-me", "rp-pg-sum"])
    assert.ok(HTML.indexOf(`id="${id}"`) > HTML.indexOf('id="rp-proof"'), id + " is on the review sheet");
  assert.match(JS, /if \(januaryGift\(\)\) x\.gift_january = true; else x\.gift = true;/, "posted with the order form's gift fields (this year's print as gift_january)");
  assert.match(JS, /\$\('ro-isgift'\)\.checked = \$\('rp-pg-on'\)\.checked/, "the sheet's tick is the order form's tick");
  const pre = HTML.match(/<p class="rp-note rp-gift-pre"[^>]*>([^<]*)/)[1];
  assert.ok(!/\u2014/.test(HTML.match(/id="rp-pgift"[\s\S]*?<\/div>\s*<\/div>/)[0] + pre), "no em dashes");
});

test("at 390: tick the gift, fill it in, Pay posts the gift and then opens Stripe", { skip, timeout: 90000 }, async () => {
  const posts = [], stripe = [];
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html");
    await idle(page);
    await page.fill("#rp-place", "Chetek, WI");
    await page.selectOption("#rp-year", "2025");
    await page.press("#rp-place", "Enter");
    await page.waitForTimeout(300);
    await idle(page);
    assert.equal(await page.isVisible("#rp-gift-pre"), true, "the gift line shows above Pay");
    await page.click("#rp-pay");
    if (await page.isVisible("#rp-noname-go")) await page.click("#rp-noname-go");
    await page.waitForSelector("#rp-proof[open]");
    assert.equal(await page.isVisible("#rp-pgift"), true, "the sheet offers the gift");
    assert.equal(await page.isVisible("#rp-pg-box"), false, "fields stay folded until ticked");
    await page.check("#rp-pg-on");
    await page.check("#rp-proof-ok");
    await page.click("#rp-proof-order");
    assert.match(await page.textContent("#rp-proof-msg"), /Say who the gift is for/);
    assert.equal(posts.length + stripe.length, 0, "nothing sent with a gift half filled in");
    await page.fill("#rp-pg-to", "Dad");
    await page.fill("#rp-pg-msg", "Every inch of the year you farmed.");
    // 2026-10-19 (board B): no address box when Stripe takes the address; the sheet says where it goes
    assert.equal(await page.isVisible("#rp-pg-addr"), false, "the address is not asked twice");
    assert.equal(await page.textContent("#rp-pg-ship"), "Where it ships: at checkout, Stripe asks for the shipping address. Give theirs.");
    await page.fill("#rp-pg-name", "Sig");
    await page.fill("#rp-pg-me", "buyer@example.com");
    const sum = (await page.textContent("#rp-pg-sum")).replace(/\s+/g, " ");
    assert.match(sum, /Gift for ?Dad/); assert.match(sum, /Note on the letter ?Every inch/);
    await page.click("#rp-proof-order");
    // the stub page itself, not any "stripe" in the page (the temperature stripes option says "stripes")
    await page.waitForFunction(() => location.host === "buy.stripe.com" || document.body.textContent.trim() === "stripe", null, { timeout: 15000 });
    assert.equal(posts.length, 1, "one order post");
    const p = posts[0];
    assert.equal(p.kind, "rain-print-order"); assert.equal(p.gift, true); assert.equal(p.gift_to, "Dad");
    assert.equal(p.gift_deliver, "recipient"); assert.equal(p.choice, "framed12x18");
    assert.match(p.address, /^The shipping address given at Stripe checkout, reference \S+ \(theirs\)$/, "the worker's address field says where the address is"); assert.equal(p.email, "buyer@example.com");
    assert.match(p.notes, /Paying now at Stripe checkout, reference /);
    assert.equal(stripe.length, 1, "then checkout");
    assert.ok(stripe[0].includes("client_reference_id=" + p.design_code) || /client_reference_id=/.test(stripe[0]));
    assert.deepEqual(errors, []);
  }, { posts, stripe });
});

test("a gift that can't be saved keeps the buyer on the sheet with a way on", { skip, timeout: 90000 }, async () => {
  const posts = [], stripe = [];
  await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html");
    await idle(page);
    await page.fill("#rp-place", "Chetek, WI");
    await page.selectOption("#rp-year", "2025");
    await page.press("#rp-place", "Enter");
    await page.waitForTimeout(300);
    await idle(page);
    await page.click('label[data-choice="digital"]');
    await page.click("#rp-pay");
    if (await page.isVisible("#rp-noname-go")) await page.click("#rp-noname-go");
    await page.waitForSelector("#rp-proof[open]");
    await page.check("#rp-pg-on");
    assert.equal(await page.isVisible("#rp-pg-addr"), false, "no street address for a file");
    assert.equal(await page.isVisible("#rp-pg-email"), true, "their email when it goes to them");
    await page.fill("#rp-pg-to", "Dad"); await page.fill("#rp-pg-email", "dad@example.com");
    await page.fill("#rp-pg-name", "Sig"); await page.fill("#rp-pg-me", "buyer@example.com");
    await page.check("#rp-proof-ok");
    await page.click("#rp-proof-order");
    await page.waitForFunction(() => /didn\u2019t save/.test(document.getElementById("rp-proof-msg").textContent), null, { timeout: 40000 });
    assert.equal(stripe.length, 0, "not sent to Stripe without the gift");
    assert.equal(await page.locator("#rp-proof-msg a").count(), 1, "a link to checkout is offered");
  }, { posts, stripe, formFail: true });
});

/* Sig, 2026-10-18: the page must not rely on Stripe for gift details. This
   year's print as a gift (made in January) asks who it's for and the card
   note on the page, and Pay posts them (gift_january) before checkout. */
test("this year's gift: no line says Stripe asks for the gift details", () => {
  assert.ok(!/At checkout you can say who it|add their name and your note at checkout|Payment Link asks who it's for/.test(JS), "no line leaves the gift to Stripe");
  assert.match(JS, /\$\('rp-gift-fields'\)\.hidden = false;/, "the step 3 boxes always show");
  assert.match(JS, /function pgOffered\(\) \{ return canOrder\(\) && !\(GIFT && GIFT\.usable\); \}/, "the review sheet offers the gift for this year's print too");
  // 2026-10-19 (board B, Sig): Stripe's shipping field stays on, so the sheet no longer asks for the address too
  assert.ok(!/Use the same one/.test(HTML + JS), "no 'type it again' line");
  assert.match(JS, /\$\('rp-pg-addr-wrap'\)\.hidden = file \|\| stripeShips;/, "the address box shows only without a payment link");
});

test("at 390: this year's gift carries who it's for and the card note from step 3 to the sheet, posts them, then opens Stripe", { skip, timeout: 90000 }, async () => {
  const posts = [], stripe = [];
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html");
    await idle(page);
    await page.fill("#rp-place", "Chetek, WI");
    await page.selectOption("#rp-year", "2026");
    await page.press("#rp-place", "Enter");
    await page.waitForTimeout(300);
    await idle(page);
    assert.equal(await page.isVisible("#rp-gift"), true, "the Christmas box shows for this year");
    assert.equal(await page.isVisible("#rp-gift-to"), true, "who it's for is asked on the page");
    assert.equal(await page.isVisible("#rp-gift-msg"), true, "the card note is asked on the page");
    assert.ok(!/at checkout/i.test(await page.textContent("#rp-gift-cardnote")));
    await page.fill("#rp-gift-to", "Mom");
    await page.fill("#rp-gift-msg", "For the dry year.");
    await page.click("#rp-pay");
    if (await page.isVisible("#rp-noname-go")) await page.click("#rp-noname-go");
    await page.waitForSelector("#rp-proof[open]");
    assert.equal(await page.isVisible("#rp-pgift"), true, "the sheet offers the gift");
    assert.equal(await page.isChecked("#rp-pg-on"), true, "ticked, since step 3 was filled in");
    assert.equal(await page.inputValue("#rp-pg-to"), "Mom");
    assert.equal(await page.inputValue("#rp-pg-msg"), "For the dry year.");
    assert.equal(await page.textContent("#rp-pg-msg-l"), "A message for the gift card (optional)");
    await page.fill("#rp-pg-to", "Mom and Dad");
    assert.equal(await page.inputValue("#rp-gift-to"), "Mom and Dad", "the two boxes stay in step");
    assert.equal(await page.isVisible("#rp-pg-addr"), false, "Stripe takes the address");
    await page.fill("#rp-pg-name", "Sig");
    await page.fill("#rp-pg-me", "buyer@example.com");
    assert.match((await page.textContent("#rp-pg-sum")).replace(/\s+/g, " "), /Note on the gift card ?For the dry year/);
    await page.check("#rp-proof-ok");
    await page.click("#rp-proof-order");
    // the stub page itself, not any "stripe" in the page (the temperature stripes option says "stripes")
    await page.waitForFunction(() => location.host === "buy.stripe.com" || document.body.textContent.trim() === "stripe", null, { timeout: 15000 });
    assert.equal(posts.length, 1, "one order post, before checkout");
    const p = posts[0];
    assert.equal(p.kind, "rain-print-order"); assert.equal(p.gift_january, true); assert.equal(p.gift, undefined);
    assert.equal(p.gift_to, "Mom and Dad"); assert.equal(p.gift_message, "For the dry year.");
    assert.match(p.notes, /Make it after January 1, once the full year is in\./);
    assert.equal(stripe.length, 1, "then checkout");
    assert.deepEqual(errors, []);
  }, { posts, stripe });
});
