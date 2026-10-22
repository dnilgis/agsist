/* Rain Print order records (2026-10-20). The real case: Sig paid $19 for a
 * digital file through the Stripe Payment Link, and the payment page in
 * Stripe showed the product, the customer and the amount but no design
 * (client_reference_id is kept on the Checkout Session, not on the payment).
 * Now every press of Pay that opens Stripe first posts one order record to
 * the subs worker (POST /rp-order): the same ref Stripe gets, the product, the
 * price shown, the full design link and the design in words, never the
 * buyer's email. Checkout opens whether or not the post works.
 *
 *   - the record the page builds (RainPrint.orderRecord), for short and long
 *     designs, gift and not, and Sig's own test design;
 *   - the worker routes (scripts/test_rp_order_worker.mjs);
 *   - in a browser: the post goes before Stripe with the same ref, once per
 *     press; a worker that fails or never answers still lets checkout open.
 *
 *   node --test test/rp-order.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import { checkout, refOf } from "./fixtures/rp-checkout.mjs";
import { mocks, serve } from "./fixtures/rp-site-mock.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const ctxVm = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctxVm.window = ctxVm;
vm.runInNewContext(read("components/rain-print.js"), ctxVm);
const RP = ctxVm.RainPrint;
const plain = (x) => JSON.parse(JSON.stringify(x));

// Sig's test order, Oct 20 (the year is only for the test; the real one is not known yet)
const SIG = { place: "Chetek, WI", station: "471667 2", year: 2025, style: "r1", name: "Gustum Farm", markers: [{ date: "2025-04-01", label: "Moved in" }] };
const LONG = { place: "Chetek, WI", station: "471667 2", year: 2025, style: "r1", cmp: "normal", name: "The Olson Family Farm",
  dedication: "For Grandpa Erling, sixty harvests on the home place. Love, all of us",
  markers: [{ date: "2025-05-13", label: "Beans went in" }, { date: "2025-07-04", label: "Hay all in" }, { date: "2025-10-27", label: "Last load in" }] };

test("the record for Sig's test design: the ref Stripe gets, the full link, the design in words, nothing about the buyer", () => {
  const code = RP.encodeCode(SIG);
  const r = plain(RP.orderRecord(SIG, RP.checkoutRef(code, false, null), "digital", 19));
  assert.deepEqual(r, {
    ref: code, product: "digital", price: 19,
    design_url: "https://agsist.com/rain-print?place=Chetek%2C+WI&year=2025&station=471667+2&layout=staircase&palette=paper&size=12x18&style=r1&name=Gustum+Farm&m1=2025-04-01+Moved+in",
    place: "Chetek, WI", year: 2025, style: "r1", name: "Gustum Farm", markers: "Apr 1 Moved in", dedication: "", gift: false,
  });
  // the link opens the same design, and the maker view of it is the link plus maker=1
  assert.equal(RP.encodeCode(RP.fromParams(r.design_url.split("?")[1])), code);
  assert.equal(RP.decodeCode(code).name, "Gustum Farm");
});

test("long designs and gifts: RPS-<id> and GIFT-RPS-<id> refs, and the record still carries the whole design", () => {
  const code = RP.encodeCode(LONG);
  assert.ok(code.length > 200);
  const ref = RP.checkoutRef(code, false, "HTTPS://AGSIST.COM/R?K7Q2M");
  assert.equal(ref, "RPS-K7Q2M");
  const r = RP.orderRecord(LONG, ref, "framed12x18", 89);
  assert.equal(r.ref, "RPS-K7Q2M");
  assert.match(r.design_url, /dedication=For\+Grandpa\+Erling/);
  assert.equal(r.markers, "May 13 Beans went in; Jul 4 Hay all in; Oct 27 Last load in");
  assert.equal(RP.encodeCode(RP.fromParams(r.design_url.split("?")[1])), code, "the link is the design, not the short id");
  const g = Object.assign({}, LONG, { gift: true });
  const gr = RP.orderRecord(g, RP.checkoutRef(RP.encodeCode(g), true, "HTTPS://AGSIST.COM/R?K7Q2M"), "print12x18", 45);
  assert.equal(gr.ref, "GIFT-RPS-K7Q2M");
  assert.equal(gr.gift, true);
  assert.match(gr.design_url, /&gift=1$/);
  assert.equal(RP.orderRecord(SIG, "x", "digital", "19").price, null, "a price that is not a number is not guessed");
});

test("the worker routes (scripts/test_rp_order_worker.mjs)", () => {
  const out = execFileSync(process.execPath, [ROOT + "scripts/test_rp_order_worker.mjs"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(out, /rp-order worker checks: \d+ passed/);
});

test("the page posts the record on the Stripe path only, waits at most 2 s, and never sends an email", () => {
  const S = read("components/rain-print.js");
  assert.match(S, /var ORDER_URL = 'https:\/\/agsist-subs\.dnilgis\.workers\.dev\/rp-order', PRESS_WAIT_MS = 2000/);
  const i = S.indexOf("if (link && code) {\n      var u = link"), j = S.indexOf("return;\n    }", i);
  assert.ok(i > 0 && j > i);
  const body = S.slice(i, j);
  assert.match(body, /pressPost\(orderRecord\(ST, code, id, /);
  assert.match(body, /\.then\(function \(\) \{ PRESS_BUSY = false; goTo\(u\); \}\)/, "Stripe opens after the post, whatever it answered");
  assert.equal((S.match(/pressPost\(/g) || []).length, 2, "one definition, one call");
  const rec = S.slice(S.indexOf("function orderRecord("), S.indexOf("/* Labels in a link"));
  assert.doesNotMatch(rec, /email|address|_replyto/);
  const W = read("workers/subs-worker.js");
  assert.match(W, /PUBLIC_POSTS\.add\("\/rp-order"\)/);
  assert.match(W, /"\/rp-order": \[30, 100, 2000\]/);
  for (const p of ["rain-print.html", "rain-print-business.html", "rp-gift.html"]) assert.match(read(p), /\/components\/rain-print\.js\?v=71"/, p);
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
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    await ctx.clock.setFixedTime(new Date("2026-10-14T17:00:00Z"));
    const log = { stripe: [], order: [] };
    await mocks(ctx, opts, log);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, `http://127.0.0.1:${port}`, errors, log);
  } finally { await browser.close(); srv.close(); }
}
const drawn = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && !document.getElementById("rp-art").getAttribute("aria-busy"), null, { timeout: 30000 });
const q = (o) => new URLSearchParams(o).toString();
const SIG_Q = { place: "Chetek, WI", year: "2025", station: "471667 2", style: "r1", name: "Gustum Farm", m1: "2025-04-01 Moved in" };

test("in a browser: Pay posts one record with Stripe's own ref before Stripe opens; a long design posts its RPS ref and full link", { skip }, async () => {
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?" + q(SIG_Q));
    await drawn(page);
    let r = await checkout(page, "digital");
    assert.equal(r.stage, "stripe", JSON.stringify(r));
    assert.equal(log.order.length, 1, "one record per press");
    const o = log.order[0];
    assert.equal(o.stripeBefore, 0, "posted before Stripe opened");
    assert.equal(o.body.ref, refOf(r.url), "the same ref Stripe got");
    assert.equal(RP.decodeCode(o.body.ref).name, "Gustum Farm");
    assert.equal(o.body.product, "digital");
    assert.equal(o.body.price, 19, "the price shown");
    assert.equal(o.body.markers, "Apr 1 Moved in");
    assert.match(o.body.design_url, /^https:\/\/agsist\.com\/rain-print\?place=Chetek%2C\+WI&year=2025&station=471667\+2&.*name=Gustum\+Farm&m1=2025-04-01\+Moved\+in/);
    assert.deepEqual(Object.keys(o.body).sort(), ["dedication", "design_url", "gift", "markers", "name", "place", "price", "product", "ref", "style", "year"], "nothing else, never an email");
    // a long design: the ref is the short id, the record has the whole design
    await page.goto(base + "/rain-print.html?d=" + RP.encodeCode(LONG));
    await drawn(page);
    r = await checkout(page, "framed12x18");
    assert.equal(r.stage, "stripe", JSON.stringify(r));
    assert.equal(log.order.length, 2);
    assert.equal(log.order[1].body.ref, "RPS-K7Q2M");
    assert.equal(refOf(r.url), "RPS-K7Q2M");
    assert.equal(log.order[1].body.price, 89);
    assert.equal(RP.encodeCode(RP.fromParams(log.order[1].body.design_url.split("?")[1])), RP.encodeCode(LONG), "the record's link is the full design");
    assert.deepEqual(errors, []);
  });
});

test("in a browser: checkout opens when the worker fails, and within about 2 s when it never answers", { skip }, async () => {
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?" + q(SIG_Q));
    await drawn(page);
    const r = await checkout(page, "print12x18");
    assert.equal(r.stage, "stripe", JSON.stringify(r));
    assert.equal(log.order.length, 1);
    assert.deepEqual(errors, []);
  }, { order: "fail" });
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?" + q(SIG_Q));
    await drawn(page);
    const r = await checkout(page, "print12x18");
    assert.equal(r.stage, "stripe", JSON.stringify(r));
    assert.equal(log.order.length, 1);
    const waited = log.stripeAt - log.order[0].at;
    assert.ok(waited >= 1500 && waited < 4500, "waited " + waited + " ms");
    assert.deepEqual(errors, []);
  }, { order: "hang" });
});
