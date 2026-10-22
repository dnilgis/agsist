/* Rain Print keeps taking orders with the subs worker out (BUILD-RULES 14,
 * after Oct 21 2026: Cloudflare blocked agsist-subs.dnilgis.workers.dev and
 * every route answered its 403 phishing page as HTML with no CORS headers, so
 * every fetch() from the page rejected).
 *
 * Every worker call here fails the way it did that day (blocked), or the
 * connection fails (down), or it never answers (hang). Pay must still land on
 * the right Stripe payment link with the right client_reference_id, with no
 * error for the buyer:
 *   - a short design: the full design code, so Stripe alone holds the design;
 *   - a long design (past Stripe's 200 characters, no short link to be had):
 *     RPH-<hash of the full code>, and the full design goes to Sig by the
 *     backup form (Formspree), kept in the browser until it is sent;
 *   - a gift from the review sheet: its details go by the backup form, then Stripe;
 *   - a Canadian design (the digital file, the US digital link);
 *   - a hung worker costs a few seconds, not the sale;
 *   - a logo whose upload fails stays on the print and in this browser
 *     (IndexedDB), the buyer is told what happens, and it uploads under the
 *     same id once the worker answers again.
 *
 * Needs Playwright and Chromium; skipped where they are missing.
 *   node --test test/rain-print-outage.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { checkout, refOf } from "./fixtures/rp-checkout.mjs";
import { mocks, serve } from "./fixtures/rp-site-mock.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const ctxVm = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctxVm.window = ctxVm;
vm.runInNewContext(read("components/rain-print.js"), ctxVm);
const RP = ctxVm.RainPrint;
const LINKS = JSON.parse(read("data/rain-print.json")).payment_links;

const SIG = { place: "Chetek, WI", station: "471667 2", year: 2025, style: "r1", name: "Gustum Farm", markers: [{ date: "2025-04-01", label: "Moved in" }] };
const LONG = { place: "Chetek, WI", station: "471667 2", year: 2025, style: "r1", cmp: "normal", name: "The Olson Family Farm",
  dedication: "For Grandpa Erling, sixty harvests on the home place. Love, all of us",
  markers: [{ date: "2025-05-13", label: "Beans went in" }, { date: "2025-07-04", label: "Hay all in" }, { date: "2025-10-27", label: "Last load in" }] };
const q = (o) => new URLSearchParams(o).toString();
const SIG_Q = { place: "Chetek, WI", year: "2025", station: "471667 2", style: "r1", name: "Gustum Farm", m1: "2025-04-01 Moved in" };

test("the hash reference: same code, same ref; any change, another; Stripe's characters; the gift flag", () => {
  const code = RP.encodeCode(LONG);
  assert.ok(code.length > 200);
  const ref = RP.hashRef(code, false);
  assert.match(ref, /^RPH-[0-9A-HJKMNP-TV-Z]{10}$/);
  assert.equal(RP.hashRef(code, false), ref, "the same design always gives the same ref");
  assert.notEqual(RP.hashRef(RP.encodeCode(Object.assign({}, LONG, { name: "The Olson Family Farms" })), false), ref, "one letter changes it");
  const g = RP.encodeCode(Object.assign({}, LONG, { gift: true }));
  assert.match(RP.hashRef(g, true), /^GIFT-RPH-[0-9A-HJKMNP-TV-Z]{10}$/);
  assert.equal(RP.checkoutRef(RP.encodeCode(SIG), false, null), RP.encodeCode(SIG), "a short design still goes as its own code");
});

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
    await ctx.clock.setFixedTime(new Date("2026-10-22T17:00:00Z"));
    const log = { stripe: [], order: [], worker: [], formspree: [] };
    await mocks(ctx, opts, log);
    if (opts.extra) await opts.extra(ctx, log);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, `http://127.0.0.1:${port}`, errors, log, ctx);
  } finally { await browser.close(); srv.close(); }
}
const drawn = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && !document.getElementById("rp-art").getAttribute("aria-busy"), null, { timeout: 30000 });
const fsFields = (b) => Object.fromEntries([...b.matchAll(/name="([^"]+)"\r\n\r\n([\s\S]*?)\r\n--/g)].map((m) => [m[1], m[2]]));

for (const mode of ["blocked", "down"]) {
  test(`worker ${mode}: a short design goes straight to Stripe with its full code, no error`, { skip, timeout: 90000 }, async () => {
    await withPage(async (page, base, errors, log) => {
      await page.goto(base + "/rain-print.html?" + q(SIG_Q));
      await drawn(page);
      const t0 = Date.now();
      const r = await checkout(page, "digital");
      assert.equal(r.stage, "stripe", JSON.stringify(r));
      assert.ok(r.url.startsWith(LINKS.digital + "?"), r.url);
      assert.equal(refOf(r.url), RP.encodeCode(SIG), "the whole design is in Stripe's own record");
      assert.equal(RP.decodeCode(refOf(r.url)).name, "Gustum Farm");
      assert.ok(Date.now() - t0 < 8000, "no long wait");
      assert.ok(log.worker.some((x) => x === "POST /rp-order"), "the press record was tried");
      assert.deepEqual(errors, []);
    }, { worker: mode });
  });
}

test("worker blocked: a long design goes to Stripe as RPH-<hash>, and the whole design goes to Sig by the backup form", { skip, timeout: 90000 }, async () => {
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?d=" + RP.encodeCode(LONG));
    await drawn(page);
    const r = await checkout(page, "framed12x18");
    assert.equal(r.stage, "stripe", JSON.stringify(r));
    assert.ok(r.url.startsWith(LINKS.framed12x18 + "?"), r.url);
    const ref = refOf(r.url);
    assert.equal(ref, RP.hashRef(RP.encodeCode(LONG), false));
    assert.ok(ref.length <= 200 && /^[A-Za-z0-9_-]+$/.test(ref), "Stripe takes it");
    assert.ok(log.worker.includes("POST /rp-short"), "the short link was asked first");
    const fs = log.formspree.map((x) => fsFields(x.body)).find((f) => f.form === "rain-print-press");
    assert.ok(fs, "the order record went by the backup form: " + JSON.stringify(log.formspree.map((x) => x.body.slice(0, 200))));
    assert.equal(fs.ref, ref);
    assert.equal(fs.product, "framed12x18");
    assert.equal(fs.design_code, RP.encodeCode(LONG), "the full design code, nothing dropped");
    assert.equal(RP.encodeCode(RP.fromParams(fs.design_url.split("?")[1])), RP.encodeCode(LONG), "and the full design link");
    assert.ok(!/@/.test(JSON.stringify(fs)), "nothing about the buyer");
    // sent, so nothing is left waiting in this browser
    assert.equal(await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("agsist-rp-outbox") || "[]").length; } catch (e) { return -1; } }), 0);
    assert.deepEqual(errors, []);
  }, { worker: "blocked" });
});

test("worker and backup form both out: a long design still pays; the record waits in this browser and goes on the next visit", { skip, timeout: 90000 }, async () => {
  const opts = { worker: "blocked", formspree: "fail" };
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?d=" + RP.encodeCode(LONG));
    await drawn(page);
    const r = await checkout(page, "print12x18");
    assert.equal(r.stage, "stripe", JSON.stringify(r));
    const ref = refOf(r.url);
    assert.equal(ref, RP.hashRef(RP.encodeCode(LONG), false));
    assert.ok(log.formspree.length >= 1, "the backup form was tried");
    // back from Stripe, the backup form still out: the record is still waiting here
    await page.goto(base + "/rain-print.html");
    await page.waitForTimeout(2500);
    const left = await page.evaluate(() => JSON.parse(localStorage.getItem("agsist-rp-outbox") || "[]"));
    assert.equal(left.length, 1, "kept, not lost");
    assert.equal(left[0].fields.ref, ref);
    assert.equal(left[0].fields.design_code, RP.encodeCode(LONG));
    // the backup form answers again: the next visit sends it, once
    opts.formspree = "ok";
    const n = log.formspree.length;
    await page.goto(base + "/rain-print.html");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("agsist-rp-outbox") || "[]").length === 0, null, { timeout: 20000 });
    const sent = log.formspree.slice(n).map((x) => fsFields(x.body)).filter((f) => f.form === "rain-print-press");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].ref, ref);
    assert.equal(sent[0].design_code, RP.encodeCode(LONG));
    assert.deepEqual(errors, []);
  }, opts);
});

test("worker hung: a short design reaches Stripe in a few seconds; a long one too", { skip, timeout: 120000 }, async () => {
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?" + q(SIG_Q));
    await drawn(page);
    let t0 = Date.now();
    let r = await checkout(page, "print12x18");
    assert.equal(r.stage, "stripe", JSON.stringify(r));
    assert.equal(refOf(r.url), RP.encodeCode(SIG));
    assert.ok(Date.now() - t0 < 6000, "short design waited " + (Date.now() - t0) + " ms");
    await page.goto(base + "/rain-print.html?d=" + RP.encodeCode(LONG));
    await drawn(page);
    t0 = Date.now();
    r = await checkout(page, "framed12x18", { wait: 20000 });
    assert.equal(r.stage, "stripe", JSON.stringify(r));
    assert.equal(refOf(r.url), RP.hashRef(RP.encodeCode(LONG), false));
    assert.ok(Date.now() - t0 < 11000, "long design waited " + (Date.now() - t0) + " ms");
    assert.deepEqual(errors, []);
  }, { worker: "hang" });
});

test("worker blocked: a gift from the review sheet goes by the backup form, then Stripe, with no error", { skip, timeout: 90000 }, async () => {
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?" + q(SIG_Q));
    await drawn(page);
    await page.locator('.rp-prod[data-choice="framed12x18"]').click();
    await page.click("#rp-pay");
    if (await page.isVisible("#rp-noname-go")) await page.click("#rp-noname-go");
    await page.waitForSelector("#rp-proof[open]");
    await page.check("#rp-pg-on");
    await page.fill("#rp-pg-to", "Dad");
    await page.fill("#rp-pg-msg", "Every inch of the year you farmed.");
    await page.fill("#rp-pg-name", "Sig");
    await page.fill("#rp-pg-me", "buyer@example.com");
    await page.check("#rp-proof-ok");
    const t0 = Date.now();
    await page.click("#rp-proof-order");
    await page.waitForURL(/buy\.stripe\.com/, { timeout: 15000 });
    assert.ok(Date.now() - t0 < 8000, "waited " + (Date.now() - t0) + " ms");
    assert.ok(page.url().startsWith(LINKS.framed12x18 + "?"), page.url());
    assert.equal(refOf(page.url()), RP.encodeCode(SIG));
    const g = log.formspree.map((x) => fsFields(x.body)).find((f) => f.form === "rain-print-order");
    assert.ok(g, "the gift went by the backup form");
    assert.equal(g.gift_to, "Dad");
    assert.equal(g.gift_message, "Every inch of the year you farmed.");
    assert.equal(g.design_code, RP.encodeCode(SIG));
    assert.ok(log.worker.includes("POST /form"), "the worker was tried first");
    assert.deepEqual(errors, []);
  }, { worker: "blocked" });
});

// Qu'Appelle, SK 2024 from the saved NOAA GHCN copy (test/fixtures/rp-canada), as rp-canada.test.mjs reads it
function stationFile(fixture, year) {
  const lines = read(fixture).trim().split("\n");
  const head = lines[0], rows = lines.slice(1);
  const shift = (y) => rows.filter((r) => !r.split(",")[1].endsWith("0229")).map((r) => { const f = r.split(","); f[1] = y + f[1].slice(4); return f.join(","); });
  const out = [head];
  for (let y = year - 6; y < year; y++) out.push(...shift(y));
  out.push(...rows);
  out.push(...shift(year + 1));
  return out.join("\n") + "\n";
}
async function canadaRoutes(ctx) {
  const csv = Buffer.from(stationFile("test/fixtures/rp-canada/CAN04016322-2024.csv", 2024), "latin1");
  await ctx.route(/noaa-ghcn-pds\.s3\.amazonaws\.com/, (r) => {
    const req = r.request(), u = new URL(req.url());
    if (!u.pathname.endsWith("/CAN04016322.csv")) return r.fulfill({ status: 404, body: "" });
    const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Length, Content-Range", "Content-Length": String(csv.length) };
    if (req.method() === "HEAD") return r.fulfill({ status: 200, headers: h, body: "" });
    const rg = /bytes=(\d+)-(\d+)/.exec(req.headers()["range"] || "");
    if (rg) { const part = csv.subarray(+rg[1], Math.min(+rg[2] + 1, csv.length)); return r.fulfill({ status: 206, headers: Object.assign({}, h, { "Content-Length": String(part.length), "Content-Range": `bytes ${rg[1]}-${+rg[1] + part.length - 1}/${csv.length}` }), body: part }); }
    return r.fulfill({ status: 200, headers: h, body: csv });
  });
  await ctx.route(/geocoding-api\.open-meteo\.com/, (r) => r.fulfill({ json: { results: [{ name: "Qu'Appelle", latitude: 50.55, longitude: -103.88, admin1: "Saskatchewan", country_code: "CA" }] } }));
}
test("worker blocked: a Canadian design (the digital file) goes to the digital link with its code", { skip, timeout: 120000 }, async () => {
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?" + q({ place: "Qu'Appelle, SK", year: "2024", station: "CAN04016322", style: "r1", name: "Home quarter" }));
    await drawn(page);
    assert.equal(await page.evaluate(() => /CAN04016322|Qu/.test(document.querySelector("#rp-art svg").textContent)), true, "the Canadian print drew");
    const r = await checkout(page, "digital");
    assert.equal(r.stage, "stripe", JSON.stringify(r));
    assert.ok(r.url.startsWith(LINKS.digital + "?"), r.url);
    const ref = refOf(r.url), d = RP.decodeCode(ref);
    assert.ok(d && d.place === "Qu'Appelle, SK" && d.station === "CAN04016322" && d.name === "Home quarter", "the Canadian design is in the ref: " + ref);
    assert.deepEqual(errors, []);
  }, { worker: "blocked", extra: canadaRoutes });
});

// a small real PNG (40 x 40, solid dark) for the logo box
const PNG8 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAARUlEQVR4nO3OIREAIAAAMZKg0fTvBim4R0zMb8y1z89GHRAUrAOCgnVAULAOCArWAUHBOiAoWAcEBeuAoGAdEBSsA4KvXXbCKEgwypa0AAAAAElFTkSuQmCC", "base64");
test("worker blocked: a logo that can't upload stays on the print and in this browser, the buyer is told, and it goes up under the same id later", { skip, timeout: 120000 }, async () => {
  const srv = await serve(ROOT), port = srv.address().port, base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    await ctx.clock.setFixedTime(new Date("2026-10-22T17:00:00Z"));
    const opts = { worker: "blocked" }, log = { stripe: [], order: [], worker: [], formspree: [] }, ups = [];
    await mocks(ctx, opts, log);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base + "/rain-print.html?" + q(SIG_Q));
    await drawn(page);
    await page.locator("#rp-logo-file").setInputFiles({ name: "farm.png", mimeType: "image/png", buffer: PNG8 });
    await page.waitForFunction(() => /saved in this browser/.test(document.getElementById("rp-logo-msg").textContent), null, { timeout: 20000 });
    const msg = await page.textContent("#rp-logo-msg");
    assert.match(msg, /on your print/);
    assert.doesNotMatch(msg, /not on the print/);
    const id = await page.evaluate(() => new URLSearchParams(location.search).get("logo") || "");
    assert.match(id, /^[0-9a-hjkmnp-tv-z]{12}$/, "the design carries the logo's id: " + id);
    assert.equal(await page.evaluate(() => !document.getElementById("rp-logo-thumb").hidden), true, "the logo shows");
    // pays as usual, the design code carries the logo
    const r = await checkout(page, "digital");
    assert.equal(r.stage, "stripe", JSON.stringify(r));
    const d = RP.decodeCode(refOf(r.url));
    assert.equal(d.logo, id, "the logo id is in the Stripe ref");
    // back on the page with the worker still out: the logo draws from this browser
    await page.goto(base + "/rain-print.html?" + q(Object.assign({}, SIG_Q, { logo: id, logoInk: "1" })));
    await drawn(page);
    await page.waitForFunction(() => !document.getElementById("rp-logo-thumb").hidden, null, { timeout: 15000 });
    assert.doesNotMatch(await page.textContent("#rp-logo-msg"), /didn.t load/);
    // the worker answers again: the kept logo goes up under its own id, once
    opts.worker = "";
    await ctx.route(/agsist-api\.dnilgis\.workers\.dev\/rp-logo/, (rt) => {
      const req = rt.request(), h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
      if (req.method() === "OPTIONS") return rt.fulfill({ status: 204, headers: h });
      if (req.method() === "POST") { ups.push({ url: req.url(), bytes: req.postDataBuffer() }); return rt.fulfill({ headers: h, json: { ok: true, id: new URL(req.url()).searchParams.get("id"), w: 40, h: 40 } }); }
      return rt.fulfill({ status: 404, headers: h, json: { ok: false } });
    });
    await page.goto(base + "/rain-print.html");
    await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem("agsist-rp-logo-wait") || "[]").length === 0; } catch (e) { return false; } }, null, { timeout: 20000 });
    assert.equal(ups.length, 1, "uploaded once");
    assert.equal(new URL(ups[0].url).searchParams.get("id"), id, "under the id the design already carries");
    assert.equal(ups[0].bytes.subarray(1, 4).toString(), "PNG");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
