/* /rain-print, the confirmed findings of the 2026-10-14 "rock solid" panel
 * (panel 3, group A), in a real browser with NOAA, the town lookup, the subs
 * worker and Stripe answered here and the clock set per case:
 *   - P2: a town typed and not drawn is never ordered as the old design, and
 *     a new year draws on its own (2026-10-14, the approved flow);
 *   - P1: a logo still saving, or one that didn't load, keeps checkout shut;
 *   - P3: a locked gift card that lets the name change shows the giver's name,
 *     not the example's, and no "your area" caption;
 *   - P4: in January, last year waits for NOAA's December: a station behind on
 *     December is still listed, the late days are not gaps, the order says it
 *     is made once the full year is in; full_year_from in data/rain-print.json
 *     moves the date a year counts as finished;
 *   - P5: Print only picked in step 3 shows on the print and in Up close;
 *   - P7, P8: the Christmas box from Dec 10 and after Dec 25, the gifts page too;
 *   - P14: gift mode: no Christmas dates line, the card said once, the Stripe
 *     note names the card;
 *   - P6: words that happen to match the example's are the buyer's own and
 *     order as they are, with no question (the example is a gray hint only);
 *   - P12: a ?d=RPS- link that doesn't open keeps the link, and on the maker
 *     page draws nothing else.
 * Needs Playwright and Chromium; skipped where they are missing.
 *
 *   node --test test/rain-print-solid.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { deflateSync } from "node:zlib";
import vm from "node:vm";
import { checkout, stripePage, refOf } from "./fixtures/rp-checkout.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const ctxVm = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctxVm.window = ctxVm;
vm.runInNewContext(readFileSync(ROOT + "components/rain-print.js", "utf8"), ctxVm);
const RP = ctxVm.RainPrint;
const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));

// ---------- made-up NOAA data, the shape ACIS sends ----------
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

// a small real PNG (a dark bar), for the logo picker
function png(w, h) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = 30; raw[o + 1] = 60; raw[o + 2] = 40; raw[o + 3] = 255; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const LOGO_PNG = png(600, 300);

// a gift card code with a good check character (worker v5.16 rules)
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function cardCode() {
  const mk = (body) => { let m = 0; for (const c of body) m = (m * 32 + B32.indexOf(c)) % 37; return m < 32 ? body + B32[m] : null; };
  let body = "7K3MQ9TWH2F", i = 0;
  while (!mk(body)) body = body.slice(0, 10) + B32[(++i) % 32];
  const c = mk(body);
  return "RP-" + c.slice(0, 4) + "-" + c.slice(4, 8) + "-" + c.slice(8);
}

/* opts: time (ISO), upto (last day NOAA has), stnEnd (the station list's
   record end), where (answer GET /where), logoDelay (ms), logoGone (GET 404),
   prices (fields over data/rain-print.json), gift (the /rp-gift/check answer) */
async function mocks(ctx, opts, log) {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  const upto = opts.upto || "2026-10-09", stnEnd = opts.stnEnd || upto;
  const SHORT = {};
  let logoBytes = null;
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const req = r.request(), u = new URL(req.url());
    if (u.host === "agsist-subs.dnilgis.workers.dev") {
      if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
      if (u.pathname === "/where") return opts.where ? r.fulfill({ headers: h, json: { ok: true, city: "Chetek", region_code: "WI" } }) : r.fulfill({ status: 500, headers: h, body: "x" });
      if (u.pathname === "/rp-short" && req.method() === "POST") { const b = JSON.parse(req.postData()); SHORT.K7Q2M = b.code; return r.fulfill({ headers: h, json: { ok: true, id: "K7Q2M" } }); }
      let m = /^\/rp-short\/([0-9A-Z]+)$/.exec(u.pathname);
      if (m) return SHORT[m[1]] ? r.fulfill({ headers: h, json: { ok: true, code: SHORT[m[1]] } }) : r.fulfill({ status: 404, headers: h, json: { ok: false } });
      if (u.pathname === "/rp-logo" && req.method() === "POST") {
        if (opts.logoDelay) await new Promise((res) => setTimeout(res, opts.logoDelay));
        logoBytes = req.postDataBuffer();
        return r.fulfill({ headers: h, json: { ok: true, id: "abcdefghjkmn", w: 600, h: 300 } });
      }
      m = /^\/rp-logo\/([0-9a-z]{12})$/.exec(u.pathname);
      if (m) return opts.logoGone || !logoBytes ? r.fulfill({ status: 404, headers: h, body: "nf" }) : r.fulfill({ status: 200, headers: h, contentType: "image/png", body: logoBytes });
      if (u.pathname === "/rp-gift/check" && opts.gift) { await new Promise((res) => setTimeout(res, 900)); return r.fulfill({ headers: h, json: opts.gift }); }
      if (u.pathname === "/rp-gift/redeem") { log.redeem = JSON.parse(req.postData()); return r.fulfill({ headers: h, json: { ok: true, ships: "january" } }); }
      return r.fulfill({ status: 503, headers: h, body: "x" });
    }
    // Stripe, in the same tab: a stand-in page, and the address it was sent to
    if (u.host === "buy.stripe.com") return stripePage(r, log.stripe);
    if (u.host === "geocoding-api.open-meteo.com") return r.fulfill({ json: { results: [{ name: "Chetek", latitude: 45.3141, longitude: -91.651, admin1: "Wisconsin", country_code: "US" }] } });
    if (u.host === "data.rcc-acis.org") {
      if (u.pathname === "/StnMeta") return r.fulfill({ json: { meta: [{ name: "CHETEK", sids: ["471667 2"], ll: [-91.65, 45.32], valid_daterange: [["1950-01-01", stnEnd]], state: "WI" }] } });
      let sdate = u.searchParams.get("sdate"), normal = false;
      if (u.searchParams.get("params")) { sdate = JSON.parse(u.searchParams.get("params")).sdate; normal = true; }
      if (normal) return r.fulfill({ json: { data: yearDays(+String(sdate).slice(0, 4)).map((d) => [d, "0.08"]) } });
      if (sdate === "por") { let data = []; for (let y = 1995; y <= 2025; y++) data = data.concat(series(y, upto).map((x) => x.slice(0, 3))); return r.fulfill({ json: { data } }); }
      return r.fulfill({ json: { meta: { name: "CHETEK", state: "WI", ll: [-91.65, 45.32] }, data: series(+String(sdate).slice(0, 4), upto) } });
    }
    return r.abort();
  });
  if (opts.prices) await ctx.route(/\/data\/rain-print\.json/, (r) => r.fulfill({ json: Object.assign({}, J, opts.prices) }));
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
    const ctx = await browser.newContext({ viewport: { width: opts.width || 1280, height: opts.height || 900 }, serviceWorkers: "block" });
    await ctx.clock.setFixedTime(new Date(opts.time || "2026-10-14T17:00:00Z"));
    const log = { stripe: [] };
    await mocks(ctx, opts, log);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, `http://127.0.0.1:${port}`, errors, log);
  } finally { await browser.close(); srv.close(); }
}
const drawn = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && !document.getElementById("rp-art").getAttribute("aria-busy"), null, { timeout: 30000 });
const idle = (page) => page.waitForFunction(() => !document.getElementById("rp-go").disabled && !document.getElementById("rp-art").getAttribute("aria-busy"), null, { timeout: 30000 });
const settle = (page) => page.waitForTimeout(700);
const q = (o) => new URLSearchParams(o).toString();
const MINE = { place: "Chetek, WI", year: "2025", station: "471667 2", style: "r1", name: "The Olson Farm" };

// ---------- P2 ----------
test("P2: a town typed and not drawn is never ordered as the old design; a new year draws on its own", { skip }, async () => {
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?" + q(MINE));
    await drawn(page);
    await settle(page);
    // the year: picked, drawn, no Draw my year press (2026-10-14: it sat stale until checkout said so)
    await page.selectOption("#rp-year", "2024");
    await drawn(page);
    await settle(page);
    assert.match(await page.textContent("#rp-source"), /days recorded/);
    let r = await checkout(page, "print12x18");
    assert.equal(r.stage, "stripe");
    assert.equal(RP.decodeCode(refOf(r.url)).year, 2024, "the year picked is the year ordered");
    await page.goBack(); await drawn(page); await settle(page);
    // the town, typed and not drawn: the line by the print says so, and the order waits
    await page.fill("#rp-place", "Rice Lake, WI");
    assert.match(await page.textContent("#rp-pending"), /Not drawn yet: Rice Lake, WI, 2024\. Press Draw my year\./);
    // words typed now still go on the print that is up (they used to freeze until Draw it); set without
    // moving focus, since leaving the town box draws it (the next step)
    await page.evaluate(() => { const n = document.getElementById("rp-name"); n.value = "The Olson Place"; n.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.waitForTimeout(400);   // the drawing follows typing after a short pause (2026-10-15)
    assert.match(await page.innerHTML("#rp-art"), /The Olson Place/);
    await page.evaluate(() => document.getElementById("rp-pay").click());
    await page.waitForTimeout(150);
    assert.match(await page.textContent("#rp-buy-note"), /You changed the town but haven’t drawn it\. Press Draw my year first, so you order what you see\./);
    assert.equal(await page.$eval("#rp-proof", (d) => d.open), false, "no review sheet for the old town");
    assert.equal(log.stripe.length, 1);
    // leaving the box draws it
    await page.locator("#rp-place").blur();
    await page.waitForFunction(() => document.getElementById("rp-pending").hidden && !document.getElementById("rp-go").disabled, null, { timeout: 15000 });
    await drawn(page); await settle(page);
    r = await checkout(page, "framed12x18");
    assert.equal(r.stage, "stripe");
    const d = RP.decodeCode(refOf(r.url));
    assert.deepEqual([d.place, d.year, d.name], ["Rice Lake, WI", 2024, "The Olson Place"]);
    assert.deepEqual(errors, []);
  });
});

// ---------- P1 ----------
test("P1: a logo still saving, or one that didn't load, keeps checkout shut and says why", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?" + q(MINE));
    await drawn(page);
    await page.setInputFiles("#rp-logo-file", { name: "logo.png", mimeType: "image/png", buffer: LOGO_PNG });
    await page.waitForFunction(() => /Saving the logo/.test(document.getElementById("rp-logo-msg").textContent), null, { timeout: 10000 });
    let r = await checkout(page, "framed12x18");
    assert.equal(r.stage, "note", "no checkout without the logo id");
    assert.match(r.note, /The logo is still saving\. Tap again in a moment\./);
    await page.waitForFunction(() => /Logo added|may print soft/.test(document.getElementById("rp-logo-msg").textContent), null, { timeout: 15000 });
    r = await checkout(page, "framed12x18");
    assert.equal(r.stage, "stripe", "once saved, it orders");
    assert.equal(RP.decodeCode(refOf(r.url)).logo, "abcdefghjkmn", "the order carries the logo");
    assert.deepEqual(errors, []);
  }, { logoDelay: 3500 });
  // a design whose logo is gone from the worker
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?" + RP.toParams(Object.assign(RP.normalize({ ...MINE, year: 2025 }), { logo: "abcdefghjkmn", logoInk: true })));
    await drawn(page);
    await page.waitForFunction(() => /isn’t on the print/.test(document.getElementById("rp-logo-msg").textContent), null, { timeout: 15000 });
    const r = await checkout(page, "print12x18");
    assert.equal(r.stage, "note");
    assert.deepEqual(log.stripe, []);
    assert.match(r.note, /The logo didn’t load, so it isn’t on the print\. Remove it or choose the file again, then order\./);
    assert.equal(await page.evaluate(() => document.getElementById("rp-more").open), true, "a design with a logo opens More options, so the logo box is in sight");
  }, { logoGone: true });
});

// ---------- P3 ----------
test("P3: a locked card that lets the name change shows the giver's name and redeems; no 'your area' caption", { skip }, async () => {
  const lock = RP.encodeCode({ place: "Chetek, WI", station: "471667 2", year: 2025, style: "r1", cmp: "normal", name: "For Dad", markers: [] });
  const gift = { ok: true, kind: "locked", product: "framed12x18", to: "Dad", from_line: "Kate", ships: "now", status: "issued", lock: { design_code: lock, edit: "name" } };
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?gift=" + cardCode());
    await page.waitForFunction(() => !document.getElementById("rp-gift-use-wrap").hidden, null, { timeout: 15000 });
    // a locked card turns Draw it off, so wait on the art itself
    await page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-art").getAttribute("aria-busy") && /Drawn from/.test(document.getElementById("rp-status").textContent), null, { timeout: 30000 });
    await settle(page);
    assert.equal(await page.inputValue("#rp-name"), "For Dad", "the giver's name, not the example");
    assert.ok(!/Your area/.test(await page.textContent("#rp-sample-txt")), "no 'your area' line under a town the reader can't change");
    await page.click("#rp-gift-use");
    await page.fill("#ro-name", "Dad Olson"); await page.fill("#ro-email", "dad@example.com"); await page.fill("#ro-address", "12 Main St, Chetek WI 54728");
    await page.click("#ro-submit");
    await page.waitForTimeout(1500);
    assert.ok(log.redeem, "the redeem is sent");
    assert.equal(RP.decodeCode(log.redeem.design_code).name, "For Dad");
    assert.deepEqual(errors, []);
  }, { where: true, gift });
});

// ---------- P4 ----------
const LAST = { place: "Chetek, WI", year: "2026", style: "r1", name: "The Olson Farm" };
test("P4: on Jan 4, a station behind on December still draws last year, as a preview, and the order waits for the full year", { skip }, async () => {
  for (const stnEnd of ["2026-12-28", "2026-12-31"]) await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?" + q(LAST));
    await drawn(page);
    await settle(page);
    const src = await page.textContent("#rp-source");
    assert.match(src, /so far, January 1 through December 28/, "drawn as the year so far (" + stnEnd + ")");
    assert.ok(!/no report on/.test(src), "the days NOAA hasn't sent are not gaps: " + src);
    assert.match(await page.textContent("#rp-sub-framed12x18"), /Made once NOAA has all of 2026 in, with a proof first\./, "the picker says so before the button");
    const r = await checkout(page, "framed12x18", { tick: false });
    assert.equal(r.stage, "sheet");
    assert.match(await page.textContent("#rp-proof-sum"), /NOAA doesn’t have all of 2026 in yet\. I make this one once the full year is in, and send the proof then\./, "the review sheet says it before paying");
    await page.click('#rp-proof label:has(input[name="rp-pproduct"][value="digital"])');
    assert.match(await page.textContent("#rp-proof-sum"), /send the finished file then/);
    assert.equal(await page.$eval('input[name="rp-product"][value="digital"]', (r) => r.checked), true, "the sheet's picker is step 3's picker");
    assert.match(await page.textContent("#rp-dig-when"), /once the full year is in/);
    // and the page Stripe sends them back to says it again
    await page.check("#rp-proof-ok");
    await Promise.all([page.waitForURL(/buy\.stripe\.com/), page.click("#rp-proof-order")]);
    await page.goto(base + "/rain-print.html?paid=digital&s=cs_test_settle0001");
    await page.waitForFunction(() => !document.getElementById("rp-paid").hidden);
    assert.match(await page.textContent("#rp-paid"), /NOAA doesn’t have all of 2026 in yet\. I make it once the full year is in, and email you the finished file/);
    assert.deepEqual(errors, []);
  }, { time: "2027-01-04T18:00:00Z", upto: "2026-12-28", stnEnd });
});
test("P4: past the settling window, a finished year with late days shows them as gaps (unchanged)", { skip }, async () => {
  await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html?" + q(LAST));
    await drawn(page);
    await settle(page);
    assert.match(await page.textContent("#rp-source"), /sent no report on 3 days/);
    await checkout(page, "framed12x18", { tick: false });
    assert.match(await page.textContent("#rp-proof-sum"), /A proof by email within 1 business day; it ships within 3 business days of your OK\./);
  }, { time: "2027-02-15T18:00:00Z", upto: "2026-12-28", stnEnd: "2026-12-31" });
});
test("P4: full_year_from in data/rain-print.json sets the day last year counts as finished", { skip }, async () => {
  assert.equal(J.full_year_from, "01-01", "default: the year is finished once NOAA has December in");
  assert.match(J._about, /full_year_from/);
  for (const [prices, waits] of [[null, false], [{ full_year_from: "02-01" }, true]]) await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html?" + q(LAST));
    await drawn(page);
    await settle(page);
    await checkout(page, "print12x18", { tick: false });
    const note = await page.textContent("#rp-proof-sum");
    assert.equal(/once the full year is in/.test(note), waits, note);
  }, { time: "2027-01-20T18:00:00Z", upto: "2026-12-31", prices });
});
test("P13: the Year box names the January a gift ships in", { skip }, async () => {
  assert.equal(J.gift_year_label, "{year} (ships January {next})");
  await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html?" + q(MINE));
    await drawn(page);
    await settle(page);
    assert.equal(await page.$eval('#rp-year option[value="2027"]', (o) => o.textContent), "2027 (ships January 2028)");
  }, { time: "2027-01-04T18:00:00Z", upto: "2026-12-31" });
});

// ---------- P5 ----------
test("P5: Print only picked in step 3 shows on the print and in Up close; Up close is not a choice", { skip }, async () => {
  for (const width of [390, 1280]) await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?" + q(MINE));
    await drawn(page);
    assert.equal(await page.$('.rp-view .chip[data-view]'), null, "no Framed / Print only chips under the print (they looked like a purchase choice)");
    await page.click('.rp-prod[data-choice="print12x18"]');
    assert.equal(await page.getAttribute("#rp-wall", "data-view"), "print");
    await page.click("#rp-zoom");
    await settle(page);
    assert.equal(await page.getAttribute("#rp-proof", "data-view"), "print");
    assert.equal(await page.getAttribute("#rp-wall", "data-view"), "print");
    assert.equal(await page.getAttribute("#rp-zoom", "aria-pressed"), null, "Up close is not a view chip");
    assert.deepEqual(errors, []);
  }, { width, height: width < 600 ? 844 : 900 });
});

// ---------- P10 ----------
test("P10: an asterisk in the words survives the order link", () => {
  const u = RP.designUrl(RP.normalize({ place: "Chetek, WI", year: 2025, station: "471667 2", name: "A*B Farm", markers: [{ date: "2025-05-08", label: "Plant*" }] }));
  assert.ok(!u.includes("*"), u);
  assert.match(u, /A%2AB/);
  assert.equal(RP.fromParams(u.split("?")[1]).name, "A*B Farm");
});

// ---------- P7, P8 ----------
test("P7, P8: the Christmas box on Dec 10 and after Dec 25, and the gifts page after Christmas", { skip }, async () => {
  await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html?" + q(MINE));
    await drawn(page);
    await settle(page);
    assert.equal(await page.textContent("#rp-xmas-top"), "For Christmas: order a print by Dec 10. A framed print ordered now ships after Christmas.");
  }, { time: "2026-12-10T18:00:00Z", upto: "2026-12-01" });
  await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html?" + q(MINE));
    await drawn(page);
    await settle(page);
    assert.equal(await page.isHidden("#rp-xmas-top"), true, "no 'for Christmas' line after Christmas");
    await page.goto(base + "/gifts-for-farmers.html");
    await page.waitForTimeout(1500);
    assert.equal(await page.isHidden("#gf-xmas"), true, "the gifts page box goes too");
  }, { time: "2026-12-27T18:00:00Z", upto: "2026-12-20" });
});

// ---------- P14 ----------
test("P14: gift mode: no Christmas dates line, the card said once, and the checkout note names the card", { skip }, async () => {
  assert.ok(!/gift card comes by email/i.test(J.gift_delivery), "the card is said once, in the line under the boxes");
  await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html?" + q({ ...MINE, year: "2026" }));
    await drawn(page);
    await settle(page);
    assert.equal(await page.isHidden("#rp-xmas-why"), true);
    const box = await page.innerText("#rp-gift");
    assert.equal((box.match(/gift card/g) || []).length, 1, box);
    // the gift-card words stay on the picker's rows for this year (2026-10-14)
    for (const id of ["framed12x18", "print12x18", "digital"]) assert.match(await page.textContent("#rp-sub-" + id), /gift card to print by email within 1 business day/, id);
    assert.equal(await page.isHidden("#rp-gift-line"), true, "the plain gift line gives way to the Ordering 2026 box");
    await checkout(page, "framed12x18", { tick: false });
    assert.match(await page.textContent("#rp-proof-sum"), /Within 1 business day I email you a gift card to print\./);
  }, { time: "2026-10-14T17:00:00Z" });
});

// ---------- P6 ----------
test("P6: words that match the example's are the buyer's own: they order as they are, with no question", { skip }, async () => {
  await withPage(async (page, base, errors, log) => {
    await page.goto(base + "/rain-print.html?" + q({ ...MINE, name: "The Johnson Farm", m1: "2025-05-08 Planted" }));
    await drawn(page);
    await settle(page);
    const r = await checkout(page, "print12x18");
    assert.equal(r.stage, "stripe", "straight through the review sheet to checkout");
    const d = RP.decodeCode(refOf(r.url));
    assert.equal(d.name, "The Johnson Farm");
    assert.deepEqual([...d.markers].map((m) => m.label), ["Planted"]);
    assert.equal(log.stripe.length, 1);
    assert.deepEqual(errors, []);
  });
});

// ---------- P12 ----------
test("P12: a ?d=RPS- link that doesn't open keeps the link, and the maker page draws nothing else", { skip }, async () => {
  await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html?d=RPS-ZZZZZ");
    await page.waitForFunction(() => !document.getElementById("rp-link-note").hidden, null, { timeout: 15000 });
    await drawn(page);
    await settle(page);
    assert.match(page.url(), /[?&]d=RPS-ZZZZZ/, "the reference stays in the address bar");
    await page.goto(base + "/rain-print.html?d=RPS-ZZZZZ&maker=1");
    await page.waitForFunction(() => !document.getElementById("rp-link-note").hidden, null, { timeout: 15000 });
    await page.waitForTimeout(3500);
    assert.equal(await page.$("#rp-art svg"), null, "nothing drawn in place of the design Sig asked for");
    assert.match(page.url(), /d=RPS-ZZZZZ&maker=1/);
  }, { where: true });
});

// ---------- copy and small code (no browser) ----------
const HTML = readFileSync(ROOT + "rain-print.html", "utf8");
const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
test("T9 (page copy): plain words: the nearest weather station, never NOAA's own for every station and never the program name (Sig, 2026-10-15)", () => {
  for (const re of [/<meta name="description" content="[^"]*/, /og:description"\s+content="[^"]*/, /twitter:description"\s+content="[^"]*/, /"description": "Draws[^"]*/, /<p class="rp-lede">[^<]*/]) {
    const m = HTML.match(re)[0];
    assert.ok(/weather station/.test(m) && !/NOAA (weather )?station/.test(m) && !/CoCoRaHS/.test(m), m);
  }
  assert.match(HTML, /<summary>Where does the rain data come from\?<\/summary><p>From the nearest weather station with a good record for that year, from NOAA&rsquo;s daily records\. Some are National Weather Service stations, some are rain gauges kept by volunteers/);
  assert.ok(!/CoCoRaHS/.test(HTML), "no program name on the page");
  assert.ok(readFileSync(ROOT + "llms.txt", "utf8").includes("one year of daily rain at the nearest weather station"));
});
test("T11, T13, T3, P9: logo rights, a mailto, the lost-or-damaged steps, the maker's logo note", () => {
  for (const id of ["rp-logo-help", "rb-logo-help"]) assert.match(HTML.match(new RegExp('id="' + id + '">[^<]*'))[0], /Only a logo you own or have permission to use\./);
  assert.match(HTML, /Your logo is stored on AGSIST&rsquo;s server so the print can use it\./);
  assert.match(HTML, /Write to me at <a href="mailto:sig@farmers1st\.com">sig@farmers1st\.com<\/a>\.<\/p><\/details>/);
  const faq = HTML.match(/<details><summary>What if something[\s\S]*?<\/details>/)[0];
  assert.match(faq, /If it arrives damaged, glass included, send a photo\. If tracking shows it lost, write to me\./);
  assert.ok(!/lost in the mail[^.]*send a photo/.test(faq), "no photo of a parcel that never came");
  assert.match(S, /save this file with the order/);
});

// ---------- panel 3, group B lens (data and failure modes) ----------
// rain-print.js with qr.js and the art in a bare context, fetch answered here
function engine(answer) {
  const c = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob, Map, Promise, setTimeout, clearTimeout, AbortController, Uint8Array };
  c.window = c;
  c.asked = [];
  c.fetch = (u) => { c.asked.push(String(u)); const a = answer(String(u)); return Promise.resolve(a); };
  for (const f of ["components/qr.js", "components/rain-print-art.js", "components/rain-print.js"]) vm.runInNewContext(readFileSync(ROOT + f, "utf8"), c);
  return c;
}
const jsonRes = (j) => ({ ok: true, status: 200, json: () => Promise.resolve(j) });
const textRes = (t) => ({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON")) });

test("D1: a gauge stuck at 0.00 for months against a wet normal is found; a real dry spell in dry country is not", () => {
  const days = (n, f) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10); return Object.assign({ date: d, v: 0, flag: "", s: 0 }, f(i)); });
  const wet = new Map(), dry = new Map();
  for (let i = 0; i < 365; i++) { const md = new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(5, 10); wet.set(md, 0.1); dry.set(md, 0.02); }
  const stuck = days(365, (i) => (i >= 120 && i < 200 ? {} : i % 4 === 0 ? { v: 0.3 } : {}));
  const r = RP.stuckRun(stuck, wet);
  assert.ok(r && r.n >= 80 && r.usual >= 8, JSON.stringify(r));
  assert.equal(RP.stuckRun(stuck, dry), null, "under 4 in of normal over the run: a dry season, not a stuck gauge");
  assert.equal(RP.stuckRun(days(365, (i) => (i % 30 === 0 ? { v: 0.5 } : {})), wet), null, "no 60-day run");
  assert.equal(RP.stuckRun(days(365, (i) => (i >= 120 && i < 200 && i % 10 === 0 ? { flag: "T" } : i % 4 === 0 ? { v: 0.3 } : {})), wet), null, "a trace breaks the run");
  assert.equal(RP.stuckRun(stuck, null), null, "no normal, no check");
  const S2 = readFileSync(ROOT + "components/rain-print.js", "utf8");
  assert.match(S2, /records: ST\.records && !STUCK \? recordsFor\(\) : \[\]/);
  assert.match(S2, /showDry: showDry\(DATA\.d\) && !STUCK/);
  assert.match(S2, /The gauge may have been stuck, so the print leaves off the dry stretch and the remarkable days\./);
});

test("D4: the normal asks ACIS for 1991-2020 ('91') first, and code 1 only when that has nothing", async () => {
  const c = engine((u) => {
    const p = JSON.parse(new URL(u).searchParams.get("params"));
    const code = p.elems[0].normal;
    if (p.sid === "A" && code === "91") return jsonRes({ data: [["2025-01-01", "0.05"], ["2025-01-02", "0.06"]] });
    if (p.sid === "B" && code === "91") return jsonRes({ error: "no normals" });
    return jsonRes({ data: [["2025-01-01", "0.04"]] });
  });
  const a = await c.RainPrint.stationNormal("A", 2025);
  assert.equal(a.get("01-02"), 0.06);
  assert.equal(c.asked.length, 1, "one call when '91' answers");
  const b = await c.RainPrint.stationNormal("B", 2025);
  assert.equal(b.get("01-01"), 0.04);
  assert.deepEqual(c.asked.slice(1).map((u) => JSON.parse(new URL(u).searchParams.get("params")).elems[0].normal), ["91", 1]);
});

test("F7: an answer that isn't data says so in words, with Try again", async () => {
  const c = engine(() => textRes("<html>"));
  await assert.rejects(c.RainPrint.stationNormal("A", 2025), (e) => e.retry === true && /NOAA’s data service sent back something that isn’t data\. Try again in a minute\./.test(e.message));
});

test("D8: the gift card's preview carries no QR of its own and makes no short link", async () => {
  const code = RP.encodeCode({ place: "Chetek, WI", station: "471667 2", year: 2026, cmp: "none", name: "For Dad", markers: [] });
  const c = engine((u) => {
    const url = new URL(u);
    if (url.host === "geocoding-api.open-meteo.com") return jsonRes({ results: [{ name: "Chetek", latitude: 45.3141, longitude: -91.651, admin1: "Wisconsin", country_code: "US" }] });
    if (url.pathname === "/StnData") return jsonRes({ meta: { name: "CHETEK", state: "WI", ll: [-91.65, 45.32] }, data: series(2026, "2026-10-09") });
    return jsonRes({});
  });
  let shortAsked = 0;
  c.AgRpShort = { getShortLink: () => { shortAsked++; return Promise.resolve("HTTPS://AGSIST.COM/R?K7Q2M"); }, peek: () => null };
  const withQr = await c.RainPrint.previewArt(code, { idPrefix: "gc" });
  assert.match(withQr.svg, /data-rp="qr"/, "the page's own preview still has its QR");
  const before = shortAsked;
  const card = await c.RainPrint.previewArt(code, { idPrefix: "gc", noQr: true });
  assert.ok(!/data-rp="qr"/.test(card.svg), "one QR on the card: the card's own");
  assert.equal(shortAsked, before, "no short link asked for");
  assert.match(readFileSync(ROOT + "rp-gift.html", "utf8"), /previewArt\(C\.lock\.design_code, \{ idPrefix: 'gc', later: later\(s\.year\), noQr: true \}\)/);
});

test("F2: NOAA down on the first visit: no error the reader didn't cause; their own Draw says so calmly, with Try again", { skip }, async () => {
  const srvOpts = { where: false };
  await withPage(async (page, base, errors) => {
    let asked = 0;
    await page.route(/data\.rcc-acis\.org/, (r) => { asked++; return r.fulfill({ status: 503, body: "down" }); });
    await page.goto(base + "/rain-print.html");
    // the sample tries NOAA and fails behind the example print
    for (let i = 0; i < 60 && !asked; i++) await page.waitForTimeout(250);
    assert.ok(asked > 0, "the sample asked NOAA");
    await idle(page);
    await page.waitForTimeout(500);
    // 2026-10-16 (benchmark R1): nothing pressed, so nothing said; the example print stays up
    assert.equal((await page.textContent("#rp-status")).trim(), "", "no status line on load");
    assert.equal(await page.isVisible("#rp-retry-row"), false, "no Try again on load");
    assert.equal(await page.$eval("#rp-status", (el) => el.classList.contains("rp-bad")), false);
    assert.ok(await page.$("#rp-art .rp-ex img"), "the example print is still in the frame");
    assert.ok(!/NOAA.{0,40}(answer|slow|reached)/.test(await page.innerText("body")), "no NOAA error anywhere on the page");
    // the reader's own Draw: a plain note, not the warning color, and Try again
    await page.fill("#rp-place", "Chetek, WI");
    await page.click("#rp-go");
    await page.waitForFunction(() => !document.getElementById("rp-retry-row").hidden, null, { timeout: 30000 });
    assert.match(await page.textContent("#rp-status"), /Try again in a minute|try again/i);
    assert.equal(await page.$eval("#rp-status", (el) => el.classList.contains("rp-bad")), false, "calm, not red");
    // NOAA back: Try again draws the reader's town
    await page.unroute(/data\.rcc-acis\.org/);
    await page.click("#rp-retry");
    await page.waitForFunction(() => document.querySelector("#rp-art svg"), null, { timeout: 30000 });
    assert.match(await page.textContent("#rp-sample-txt"), /Chetek, WI/);
    assert.ok(!/^Sample:/.test(await page.textContent("#rp-sample-txt")), "the reader's own print, not the sample");
    assert.deepEqual(errors, []);
  }, srvOpts);
});

test("T2: the privacy page is true today: Rain Print links, logos, orders, gift cards, Stripe, RCC-ACIS, the area lookup", () => {
  const P = readFileSync(ROOT + "privacy.html", "utf8");
  const W = readFileSync(ROOT + "workers/subs-worker.js", "utf8");
  assert.ok(!/three forms/.test(P), "the forms are not three");
  assert.match(P, /Last updated: Oct 14, 2026/);
  assert.ok(!/—|&mdash;/.test(P.replace(/<script[\s\S]*?<\/script>/g, "")), "no em dashes");
  for (const want of [/<h2 id="rain-print">Rain Print<\/h2>/, /<strong>Stripe<\/strong>: takes payment for Rain Print orders/, /RCC-ACIS, data\.rcc-acis\.org/,
    /rough town Cloudflare works out from your IP address\. The worker sends it back and keeps nothing\./, /Anyone with the link can open the design\. It is kept with no end date/,
    /the Rain Print order request and business quote request/, /who it is for, how to deliver it/, /No payment details: Stripe handles them/,
    /<code>agsist-rps:&lt;design&gt;<\/code>/, /<code>agsist-rp-gift<\/code>/, /Rain gauge updates/]) assert.match(P, want);
  // the retention it states is the worker's
  assert.match(W, /const RPL_TTL_S = 400 \* 24 \* 3600;/);
  assert.match(P, /It is kept 400 days, or for good once it is on an order request, a business quote or a gift card\./);
  assert.match(W, /const FORM_TTL_S = 365 \* 24 \* 3600;/);
  assert.match(P, /keeps what you sent for up to a year/);
  assert.match(W, /rps:<id> = a plain design code, no expiry/);
  assert.ok(!/gauge-lab/.test(P));
});

test("Sig, 2026-10-14: the page shows $15 to reprint after the prices load (not a backreference's '5')", { skip }, async () => {
  for (const prices of [null, { reprint_fee: 20 }]) await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html?" + q(MINE));
    await drawn(page);
    await settle(page);
    const faq = await page.evaluate(() => [...document.querySelectorAll("details")].find((d) => /What if something/.test(d.textContent)).textContent);
    assert.match(faq, prices ? /reframe it for \$20, with the same serial number/ : /reframe it for \$15, with the same serial number/);
  }, { prices });
});
