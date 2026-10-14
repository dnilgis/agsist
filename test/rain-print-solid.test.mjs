/* /rain-print, the confirmed findings of the 2026-10-14 "rock solid" panel
 * (panel 3, group A), in a real browser with NOAA, the town lookup, the subs
 * worker and Stripe answered here and the clock set per case:
 *   - P2: the year or town changed without Draw it: no order of the old design;
 *   - P1: a logo still saving, or one that didn't load, keeps checkout shut;
 *   - P3: a locked gift card that lets the name change shows the giver's name,
 *     not the example's, and no "your area" caption;
 *   - P4: in January, last year waits for NOAA's December: a station behind on
 *     December is still listed, the late days are not gaps, the order says it
 *     is made once the full year is in; full_year_from in data/rain-print.json
 *     moves the date a year counts as finished;
 *   - P5: Zoom in leaves the Framed / Print only switch alone;
 *   - P7, P8: the Christmas box from Dec 10 and after Dec 25, the gifts page too;
 *   - P14: gift mode: no Christmas dates line, the card said once, the Stripe
 *     note names the card;
 *   - P6: a buyer's own date that matches an example date can be ordered as is;
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
    const log = {};
    await mocks(ctx, opts, log);
    await ctx.addInitScript(() => { window.__opened = []; window.open = function (u) { window.__opened.push(String(u)); return null; }; });
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
const opened = (page) => page.evaluate(() => window.__opened);
const refOf = (u) => new URL(u).searchParams.get("client_reference_id");

// ---------- P2 ----------
test("P2: a year or town changed without Draw it is never ordered as the old design", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?" + q(MINE));
    await drawn(page);
    await settle(page);
    await page.selectOption("#rp-year", "2024");
    await page.click('.rp-buy-btn[data-choice="print12x18"]');
    await settle(page);
    assert.deepEqual(await opened(page), [], "no checkout for the 2025 design the reader moved away from");
    assert.match(await page.textContent("#rp-buy-note"), /You changed the year but haven’t drawn it\. Press Draw it first, so you order what you see\./);
    // the up-close view's order button says the same
    await page.click("#rp-zoom");
    await page.click("#rp-proof-order");
    await settle(page);
    assert.deepEqual(await opened(page), []);
    // drawn: it orders, and the order is 2024
    await page.click("#rp-go");
    await drawn(page);
    await settle(page);
    await page.click('.rp-buy-btn[data-choice="print12x18"]');
    await settle(page);
    const o = await opened(page);
    assert.equal(o.length, 1);
    assert.equal(RP.decodeCode(refOf(o[0])).year, 2024);
    // the town, too
    await page.fill("#rp-place", "Rice Lake, WI");
    await page.click('.rp-buy-btn[data-choice="framed12x18"]');
    await settle(page);
    assert.equal((await opened(page)).length, 1);
    assert.match(await page.textContent("#rp-buy-note"), /You changed the town but haven’t drawn it\./);
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
    await page.click('.rp-buy-btn[data-choice="framed12x18"]');
    await settle(page);
    assert.deepEqual(await opened(page), [], "no checkout without the logo id");
    assert.match(await page.textContent("#rp-buy-note"), /The logo is still saving\. Tap again in a moment\./);
    await page.waitForFunction(() => /Logo added|may print soft/.test(document.getElementById("rp-logo-msg").textContent), null, { timeout: 15000 });
    await page.click('.rp-buy-btn[data-choice="framed12x18"]');
    await settle(page);
    const o = await opened(page);
    assert.equal(o.length, 1, "once saved, it orders");
    assert.equal(RP.decodeCode(refOf(o[0])).logo, "abcdefghjkmn", "the order carries the logo");
    assert.deepEqual(errors, []);
  }, { logoDelay: 3500 });
  // a design whose logo is gone from the worker
  await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html?" + RP.toParams(Object.assign(RP.normalize({ ...MINE, year: 2025 }), { logo: "abcdefghjkmn", logoInk: true })));
    await drawn(page);
    await page.waitForFunction(() => /isn’t on the print/.test(document.getElementById("rp-logo-msg").textContent), null, { timeout: 15000 });
    await page.click('.rp-buy-btn[data-choice="print12x18"]');
    await settle(page);
    assert.deepEqual(await opened(page), []);
    assert.match(await page.textContent("#rp-buy-note"), /The logo didn’t load, so it isn’t on the print\. Remove it or choose the file again, then order\./);
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
    await page.click('.rp-buy-btn[data-choice="framed12x18"]');
    await settle(page);
    assert.equal((await opened(page)).length, 1);
    assert.match(await page.textContent("#rp-buy-note"), /NOAA doesn’t have all of 2026 in yet\. I make this one once the full year is in/);
    await page.click('.rp-buy-btn[data-choice="digital"]');
    await settle(page);
    assert.match(await page.textContent("#rp-buy-note"), /send the finished file then/);
    assert.match(await page.textContent("#rp-dig-when"), /once the full year is in/);
    assert.deepEqual(errors, []);
  }, { time: "2027-01-04T18:00:00Z", upto: "2026-12-28", stnEnd });
});
test("P4: past the settling window, a finished year with late days shows them as gaps (unchanged)", { skip }, async () => {
  await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html?" + q(LAST));
    await drawn(page);
    await settle(page);
    assert.match(await page.textContent("#rp-source"), /sent no report on 3 days/);
    await page.click('.rp-buy-btn[data-choice="framed12x18"]');
    await settle(page);
    assert.match(await page.textContent("#rp-buy-note"), /I email you a proof before I print/);
  }, { time: "2027-02-15T18:00:00Z", upto: "2026-12-28", stnEnd: "2026-12-31" });
});
test("P4: full_year_from in data/rain-print.json sets the day last year counts as finished", { skip }, async () => {
  assert.equal(J.full_year_from, "01-01", "default: the year is finished once NOAA has December in");
  assert.match(J._about, /full_year_from/);
  for (const [prices, waits] of [[null, false], [{ full_year_from: "02-01" }, true]]) await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html?" + q(LAST));
    await drawn(page);
    await settle(page);
    await page.click('.rp-buy-btn[data-choice="print12x18"]');
    await settle(page);
    const note = await page.textContent("#rp-buy-note");
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
test("P5: Zoom in keeps Print only, and the up-close view opens on it", { skip }, async () => {
  for (const width of [390, 1280]) await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?" + q(MINE));
    await drawn(page);
    await page.click('.rp-view .chip[data-view="print"]');
    await page.click("#rp-zoom");
    await settle(page);
    assert.equal(await page.getAttribute("#rp-proof", "data-view"), "print");
    assert.equal(await page.getAttribute("#rp-wall", "data-view"), "print");
    assert.equal(await page.getAttribute("#rp-zoom", "aria-pressed"), null, "Zoom in is not a view chip");
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
    assert.equal(await page.textContent("#rp-xmas-past"), "Any past year can be there by Christmas as a print: order by Dec 10. A framed print ordered now ships after Christmas.");
  }, { time: "2026-12-10T18:00:00Z", upto: "2026-12-01" });
  await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html?" + q(MINE));
    await drawn(page);
    await settle(page);
    assert.equal(await page.isHidden("#rp-gift-hint"), true, "no 'by Christmas' after Christmas");
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
    await page.click('.rp-buy-btn[data-choice="framed12x18"]');
    await settle(page);
    assert.match(await page.textContent("#rp-buy-note"), /Within 1 business day I email you a gift card to print\./);
  }, { time: "2026-10-14T17:00:00Z" });
});

// ---------- P6 ----------
test("P6: a buyer's own date that matches an example date can be ordered as it is", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?" + q({ ...MINE, m1: "2025-05-08 Planted" }));
    await drawn(page);
    await settle(page);
    await page.click('.rp-buy-btn[data-choice="print12x18"]');
    await settle(page);
    assert.match(await page.textContent("#rp-buy-note"), /it clears only the example words listed/);
    assert.deepEqual(await opened(page), []);
    await page.click("#rp-ex-mine");
    await settle(page);
    const o = await opened(page);
    assert.equal(o.length, 1, "ordered as is");
    assert.deepEqual([...RP.decodeCode(refOf(o[0])).markers].map((m) => m.label), ["Planted"]);
    // and a second tap doesn't ask again
    await page.click('.rp-buy-btn[data-choice="print12x18"]');
    await settle(page);
    assert.equal((await opened(page)).length, 2);
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
test("T9 (page copy): the station can be a CoCoRaHS volunteer's gauge, not always NOAA's own", () => {
  const PH = "nearest NOAA weather station or CoCoRaHS volunteer gauge";
  for (const re of [/<meta name="description" content="[^"]*/, /og:description"\s+content="[^"]*/, /twitter:description"\s+content="[^"]*/, /"description": "Draws[^"]*/, /<p class="rp-lede">[^<]*/]) {
    const m = HTML.match(re)[0];
    assert.ok(m.includes(PH) || /NOAA (weather )?station or CoCoRaHS volunteer gauge nearest/.test(m), m);
  }
  assert.match(HTML, /<summary>Where does the rain data come from\?<\/summary><p>From the nearest NOAA weather station or CoCoRaHS volunteer gauge/);
  assert.ok(readFileSync(ROOT + "llms.txt", "utf8").includes("one year of daily rain at the " + PH));
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
