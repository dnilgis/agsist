/* Rain Print on a phone: a press under the pinned strip keeps its click (2026-10-22).
 *
 * While a box has focus the strip folds to its line of words (its picture and Up close go, rain-print.html).
 * A jump to a card lands just under that folded strip (scroll-padding-top follows it). The press on the card
 * takes the focus from the box, the strip unfolded over the place pressed, and the release landed on the
 * strip, so the click went to neither: the Print card stayed unpicked and "Order by Dec 9" stayed up
 * (CI on Oct 22, rain-print-convert). The strip shows only while a box has focus (the print is pinned
 * otherwise), so it unfolds exactly at that press.
 *
 *   node --test test/rain-print-strip-hold.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function yearDays(y) { const a = []; for (let t = Date.UTC(y, 0, 1); new Date(t).getUTCFullYear() === y; t += 864e5) a.push(new Date(t).toISOString().slice(0, 10)); return a; }
const series = (y) => yearDays(y).map((d, i) => [d, i % 9 ? "0.00" : "0.40", "50", "0.0", "60", "40"]);
const STN = { name: "CHETEK", sids: ["471667 2"], ll: [-91.65, 45.32], valid_daterange: [["1950-01-01", "2026-10-09"]], state: "WI" };

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

async function withPhone(fn) {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await ctx.clock.setFixedTime(new Date("2026-10-14T17:00:00Z"));
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
      const u = new URL(r.request().url());
      if (u.host === "geocoding-api.open-meteo.com") return r.fulfill({ json: { results: [{ name: "Chetek", latitude: 45.3141, longitude: -91.651, admin1: "Wisconsin", country_code: "US" }] } });
      if (u.host === "data.rcc-acis.org") {
        if (u.pathname === "/StnMeta") return r.fulfill({ json: { meta: [STN] } });
        if (u.searchParams.get("params")) return r.fulfill({ json: { data: yearDays(2012).map((d) => [d, "0.08"]) } });
        const sd = u.searchParams.get("sdate");
        if (sd === "por") return r.fulfill({ json: { data: [] } });
        return r.fulfill({ json: { meta: { name: STN.name, state: "WI", ll: STN.ll }, data: series(+String(sd).slice(0, 4)) } });
      }
      return r.abort();
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${srv.address().port}/rain-print.html?` + new URLSearchParams({ place: "Chetek, WI", year: "2012", station: "471667 2", style: "r1" }));
    await page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled, null, { timeout: 30000 });
    await fn(page, errors);
  } finally { await browser.close(); srv.close(); }
}
const picked = (page) => page.evaluate(() => document.querySelector('input[name="rp-product"]:checked').value);
// folded, with its picture drawn (while it is folded, when the page is idle) so it has something to unfold
const folded = (page) => page.waitForFunction(() => { const s = document.getElementById("rp-strip"); return !s.hidden && getComputedStyle(document.getElementById("rp-mini")).display === "none" && !!document.querySelector("#rp-mini svg"); }, null, { timeout: 10000 });
// html scrolls smoothly: jump at once, then wait for the frame
const jump = (page, sel, dy) => page.evaluate(([sel, dy]) => new Promise((ok) => { scrollTo({ top: document.querySelector(sel).getBoundingClientRect().top + scrollY + dy, behavior: "instant" }); requestAnimationFrame(() => requestAnimationFrame(ok)); }), [sel, dy]);

/* Put el just under the folded strip, on screen, and check the unfolded strip would cover its middle: the
   place a tap lands (CI, Oct 22: the Print card's middle at y 188, the strip growing from 115 to 200). */
async function underStrip(page, sel) {
  const r = await page.evaluate((sel) => new Promise((ok) => {
    const st = document.getElementById("rp-strip"), el = document.querySelector(sel);
    scrollTo({ top: el.getBoundingClientRect().top + scrollY - st.getBoundingClientRect().bottom - 4, behavior: "instant" });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const a = el.getBoundingClientRect(), s = st.getBoundingClientRect();
      // how far the strip reaches unfolded: its folded bottom plus the picture it puts back
      const add = Math.round(Math.min(st.offsetWidth * 0.44, 200) * 2 / 3);
      ok({ top: a.top, mid: (a.top + a.bottom) / 2, folded: s.bottom, unfolded: s.bottom + add, h: innerHeight });
    }));
  }), sel);
  assert.ok(r.top > r.folded && r.mid < r.h, sel + " is on screen, under the folded strip: " + JSON.stringify(r));
  assert.ok(r.mid < r.unfolded, sel + "'s middle is where the unfolded strip reaches: " + JSON.stringify(r));
}

for (const [box, label] of [["#rp-m1dy", "a day list"], ["#rp-name", "the name box"]]) {
  test(`${label} in focus, a tap on the Print card under the folded strip picks Print`, { skip }, async () => {
    await withPhone(async (page, errors) => {
      // the strip shows (folded) once the box has focus and the print is scrolled away
      await page.focus(box);
      await jump(page, box, -300);
      await folded(page);
      const h = await page.$eval("#rp-strip", (s) => s.offsetHeight);
      // the card scrolled up to just under the folded strip: its middle is where the unfolded strip reaches
      const card = '.rp-prod[data-choice="print12x18"]';
      await underStrip(page, card);
      await page.locator(card).click();
      assert.equal(await picked(page), "print12x18", "the tap went to the card");
      assert.equal(await page.textContent("#rp-arrive"), "Order by Dec 10 for Christmas delivery.");
      // the focus went with the tap: once the click is done the strip unfolds (or goes, the print pinned again)
      await page.waitForFunction((h) => { const s = document.getElementById("rp-strip"); return s.hidden || s.offsetHeight > h; }, h, { timeout: 5000 });
      assert.deepEqual(errors, []);
    });
  });
}

test("a day label in focus, + Mark another day under the folded strip opens the next day", { skip }, async () => {
  await withPhone(async (page, errors) => {
    await page.focus("#rp-m1l");
    await jump(page, "#rp-m1l", -300);
    await folded(page);
    // + Mark another day scrolled up to just under the folded strip
    await underStrip(page, "#rp-add-day");
    await page.locator("#rp-add-day").click();
    assert.equal(await page.isVisible("#rp-m2row"), true, "a second day opened");
    assert.equal(await page.evaluate(() => document.activeElement.id), "rp-m2mo", "and its month has the focus");
    assert.deepEqual(errors, []);
  });
});
