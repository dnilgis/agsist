/* Rain Print, Oct 22, 2026 (Sig: "make sure the entire experience on rain print is easy and seamless. On my iPhone I
 * wish the padding next to containers was not so big ... show by default all options such as hi low temp, temp,
 * historical lines on staircase"; and "if someone is having problems they can always call me or email").
 *
 * Checks, on the shipped pages, from the Chetek fixture (test/fixtures/rp-chetek-oct21.mjs):
 *   - a new visit opens with every layer on: the usual year, month normals, remarkable days, frost, hottest and coldest,
 *     the daily temperature stripes and every year behind (the crop waits for its days);
 *   - a phone (390 and 375, touch): one 12px gutter, cards 12px inside, nothing wider than the screen, no word nearer the
 *     edge than the gutter, and every tap in the tool at least 44px tall;
 *   - the help line (call or text Sig, or email) sits by Pay on the review sheet, shows when a draw fails, and is on the
 *     gift card and business pages; the order form's failures carry the phone too.
 *
 *   node --test test/rain-print-rpdefaults.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PW, CHROME, serve, mocks } from "./fixtures/rp-chetek-oct21.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const HELP = /Questions or trouble\? Call or text Sig: <a href="tel:\+17157972428">715-797-2428<\/a> or email <a href="mailto:sig@agsist\.com">sig@agsist\.com<\/a>\./;

async function withPage(fn, { width = 390, phone = true, acis = null } = {}) {
  const srv = await serve(ROOT), base = "http://127.0.0.1:" + srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: "block", isMobile: phone, hasTouch: phone });
    await context.clock.setFixedTime(new Date("2026-10-21T15:00:00Z"));
    await mocks(context, { worker: "ok" });
    if (acis) await context.route(/data\.rcc-acis\.org/, acis);
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, base, errors);
  } finally { await browser.close(); srv.close(); }
}
const drawn = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && /days recorded/.test(document.getElementById("rp-source").textContent), null, { timeout: 60000 });

test("the help line: by Pay on the review sheet, under a failed draw, on the gift card and business pages, in the order form's failures", () => {
  const rp = read("rain-print.html");
  const pin = rp.slice(rp.indexOf('id="rp-proof-pin"'), rp.indexOf("</div>", rp.indexOf('id="rp-proof-call"')));
  assert.match(pin, /id="rp-proof-order"[\s\S]*id="rp-proof-call">/, "under the Pay button of the review sheet");
  assert.match(pin, HELP);
  const fail = rp.slice(rp.indexOf('id="rp-retry-row"'), rp.indexOf('id="rp-retry-row"') + 600);
  assert.match(fail, /<p class="rp-note rp-help" id="rp-help" hidden>/, "right under Try again, hidden until a draw fails");
  assert.match(fail, HELP);
  assert.equal((rp.match(/id="rp-call"/g) || []).length, 1, "the page's own call line is kept, once");
  assert.match(read("rp-gift.html"), /<p id="help">Questions or trouble\? Call or text Sig: <a href="tel:\+17157972428">715-797-2428<\/a> or email <a href="mailto:sig@agsist\.com">sig@agsist\.com<\/a>\.<\/p>/);
  assert.match(read("rain-print-business.html"), /id="rbz-call">Questions\? Call or text Sig at <a href="tel:\+17157972428"/);
  const js = read("components/rain-print.js");
  assert.match(js, /var HELP_HTML = 'Questions or trouble\? Call or text Sig: <a href="tel:\+17157972428">715-797-2428<\/a> or email <a href="mailto:' \+ ORDER_TO/);
  assert.match(js, /if \(why\) note\.innerHTML = esc\(why\) \+ ' ' \+ HELP_HTML;/, "checkout that couldn't open: the order form says so, with the phone");
  assert.equal((js.match(/written out below\. Or call or text Sig: <a href="tel:\+17157972428">715-797-2428<\/a>\./g) || []).length, 2, "an order or a quote that didn't go through");
  for (const h of [rp, read("rp-gift.html")]) assert.ok(!/Questions or trouble[^<]*—/.test(h), "no em dashes");
});

test("a new visit opens with every layer on; the crop waits for its days", { skip }, async () => {
  for (const width of [390, 1280]) await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html");
    await page.waitForTimeout(2000);
    for (const id of ["rp-normals", "rp-records", "rp-frost", "rp-heat", "rp-ribbon", "rp-hist"]) assert.equal(await page.$eval("#" + id, (e) => e.checked), true, id + " on");
    assert.equal(await page.$eval('input[name="rp-cmp"]:checked', (e) => e.value), "normal");
    assert.equal(await page.$eval("#rp-crop", (e) => e.value), "");
    await page.fill("#rp-place", "Chetek, WI");
    await page.press("#rp-place", "Enter");
    await drawn(page);
    const a = await page.$eval("#rp-art", (e) => e.innerHTML);
    assert.match(a, /data-rp="ribbon"/, "the daily temperature stripes are on the print");
    assert.match(a, /data-rp="hist"/, "every year behind yours is on the print");
    assert.match(a, /data-rp="frost:0"/, "the frost marks");
    assert.match(await page.$eval("#rp-lcount", (e) => e.textContent), /^10 in all, 7 on$/);
    assert.match(page.url(), /hist=1&frost=1&heat=1&ribbon=1/, "the link carries what is on");
    assert.deepEqual(errors, []);
  }, { width, phone: width < 500 });
});

test("a phone uses the screen: a 12px gutter, slim cards, nothing off the edge, 44px taps", { skip }, async () => {
  for (const width of [390, 375]) await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?" + new URLSearchParams({ place: "Chetek, WI", year: "2025", style: "r1", cmp: "normal", normals: "1", frost: "1" }));
    await drawn(page);
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const L = (s) => Math.round(document.querySelector(s).getBoundingClientRect().left);
      const pad = (s) => getComputedStyle(document.querySelector(s)).paddingLeft;
      let near = 999;
      for (const el of document.querySelectorAll("#main h1, #main h2, #main p, #main label, #main input, #main select, #main button")) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || el.closest("#rp-pv, .rp-strip, .rp-bar, dialog, .rp-sr, .sr-only, [hidden]")) continue;
        if (r.right <= 0 || r.left >= innerWidth || r.width <= 1) continue;   // parked off screen on purpose (screen-reader text), not on the page
        if (getComputedStyle(el).position === "absolute" && getComputedStyle(el).opacity === "0") continue;   // a chip's input under its label
        near = Math.min(near, Math.round(r.left), Math.round(innerWidth - r.right));
      }
      const taps = [...document.querySelectorAll("#rp-layers label, #rp-layers button, #rp-pv .rp-view .chip, #rp-pv .rp-view .rp-seg span")]
        .filter((e) => e.offsetParent).map((e) => ({ t: e.textContent.trim().slice(0, 24), h: Math.round(e.getBoundingClientRect().height) }));
      return { step: L("#rp-where"), stepPad: pad("#rp-where"), layers: L("#rp-layers"), place: L("#rp-place"), pv: L("#rp-pv"), pvW: Math.round(document.getElementById("rp-pv").getBoundingClientRect().width),
        sw: document.documentElement.scrollWidth, near, taps };
    });
    assert.equal(m.step, 12, "the cards start 12px in (was 31)");
    assert.equal(m.layers, 12);
    assert.equal(m.stepPad, "12px", "12px inside a card (was 14)");
    assert.equal(m.place, 25, "the town box: gutter, border, card padding (was 46)");
    assert.equal(m.pv, 0, "the pinned print runs edge to edge");
    assert.equal(m.pvW, width);
    assert.equal(m.sw, width, "nothing wider than the screen");
    assert.ok(m.near >= 12, "no word nearer the edge than the gutter: " + m.near);
    const small = m.taps.filter((x) => x.h < 44);
    assert.deepEqual(small, [], "every tap in the tool is at least 44px tall");
    assert.deepEqual(errors, []);
  }, { width });
});

test("a draw that fails says so with the help line; the next good draw puts it away", { skip }, async () => {
  let fail = true;
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html");
    await page.waitForTimeout(1500);
    await page.fill("#rp-place", "Chetek, WI");
    await page.press("#rp-place", "Enter");
    await page.waitForFunction(() => !document.getElementById("rp-help").hidden, null, { timeout: 60000 });
    assert.equal(await page.getAttribute("#rp-help a[href^='tel:']", "href"), "tel:+17157972428");
    assert.equal(await page.getAttribute("#rp-help a[href^='mailto:']", "href"), "mailto:sig@agsist.com");
    fail = false;
    await page.click("#rp-retry");
    await drawn(page);
    assert.equal(await page.$eval("#rp-help", (e) => e.hidden), true);
    assert.deepEqual(errors, []);
  }, { acis: (r) => (fail ? r.fulfill({ status: 503, body: "busy" }) : r.fallback()) });
});
