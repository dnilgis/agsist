/* /rain-print: "Email me when <year> is finished" (2026-10-19, board Bet 1).
 * After a print of the year still going is drawn, one quiet card under Pay
 * offers the county rain pages' own January notice, rainyear:<year>:<fips>
 * (worker v5.28 POST /notice, scripts/send_rain_year.py). The county comes
 * from the town lookup's county matched in data/rain/<st>.json; no match, no
 * card. A finished year gets no card. NOAA, the town lookup and the subs
 * worker are answered here from made-up data; data/rain is the real file.
 *
 *   - 2026 Chetek, WI: the card shows under Pay, posts rainyear:2026:55005
 *     with source page:rain-print, and Analytics gets rain_print_year_signup
 *     with no address, design code or place;
 *   - 1984 Chetek: no card; a town lookup with no county: no card;
 *   - Pay sits where it sat without the card, at 390 and 1280 px;
 *   - no page errors.
 *
 * Needs Playwright and Chromium; skipped where they are missing.
 *   node --test test/rain-print-year-ask.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = process.env.RP_ROOT || fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const SHOTS = process.env.RP_SHOTS || "";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const read = (p) => readFileSync(ROOT + p, "utf8");

test("countyFips: one county by name in the state's rain file, or nothing", () => {
  const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
  ctx.window = ctx;
  vm.runInNewContext(read("components/rain-print.js"), ctx);
  const f = ctx.RainPrint.countyFips;
  const wi = JSON.parse(read("data/rain/wi.json")).counties;
  assert.equal(f("Barron County", wi), "55005");
  assert.equal(f("Barron", wi), "55005", "Open-Meteo sometimes drops the word County");
  assert.equal(f("St. Croix County", wi), f("Saint Croix County", wi));
  assert.equal(f("", wi), "", "no county named: nothing");
  assert.equal(f("Nowhere County", wi), "", "a county not in the file: nothing");
  assert.equal(f("Twin", { "01001": { name: "Twin County" }, "01003": { name: "Twin Parish" } }), "", "two matches: no guess");
});

test("the page holds one empty card under Pay, and the sender reads the same topic and source", () => {
  const h = read("rain-print.html");
  assert.equal((h.match(/id="rp-yearask"/g) || []).length, 1);
  assert.ok(h.indexOf('id="rp-pay"') < h.indexOf('id="rp-yearask"') && h.indexOf('id="rp-yearask"') < h.indexOf('id="rp-onwall"'), "under Pay, before the wall picture");
  assert.match(h, /<div class="rp-yearask" id="rp-yearask" hidden><\/div>/);
  assert.equal((h.match(/data-signup-ask/g) || []).length, 0, "no ask in the HTML: it is written only after a draw");
  const js = read("components/rain-print.js");
  assert.ok(js.includes('data-topic="rainyear:\' + y + \':\' + fips + \'" data-source="page:rain-print"'));
  const py = read("scripts/send_rain_year.py");
  assert.ok(py.includes('RP_SRC = "page:rain-print"'));
});

const CHETEK = { name: "CHETEK", sids: ["471667 2"], ll: [-91.65, 45.32], valid_daterange: [["1950-01-01", "2026-10-15"]], state: "WI" };
function yearDays(y, last) { const a = []; for (let t = Date.UTC(y, 0, 1); new Date(t).getUTCFullYear() === y; t += 864e5) { const d = new Date(t).toISOString().slice(0, 10); if (!last || d <= last) a.push(d); } return a; }
function series(y) {
  let s = 11 + y;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return yearDays(y).map((d, i) => {
    if (d > "2026-10-14") return [d, "M", "M", "M", "M", "M"];
    const u = r(), p = u < 0.12 ? (r() * r() * 2).toFixed(2) : u < 0.16 ? "T" : "0.00";
    const t = Math.round(44 + 32 * Math.sin((i - 105) / 365 * 2 * Math.PI));
    return [d, p, String(t), "0.0", String(t + 9), String(t - 9)];
  });
}
async function mocks(ctx, opts) {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = new URL(r.request().url());
    if (u.host === "agsist-subs.dnilgis.workers.dev") {
      if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
      if (u.pathname === "/notice") { const b = JSON.parse(r.request().postData() || "{}"); opts.posts.push(b); return r.fulfill({ status: 200, headers: h, json: { ok: true, topic: b.topic, daily: !!b.daily } }); }
      if (u.pathname === "/rp-short") return r.fulfill({ status: 200, headers: h, json: { ok: true, id: "K7Q2M" } });
      return r.fulfill({ status: 503, headers: h, body: "x" });
    }
    if (u.host === "geocoding-api.open-meteo.com") {
      const hit = { name: "Chetek", latitude: 45.3141, longitude: -91.651, admin1: "Wisconsin", country_code: "US" };
      if (!opts.noCounty) hit.admin2 = "Barron County";
      return r.fulfill({ json: { results: [hit] } });
    }
    if (u.host === "data.rcc-acis.org") {
      if (u.pathname === "/StnMeta") return r.fulfill({ json: { meta: [CHETEK] } });
      let sdate = u.searchParams.get("sdate"), normal = false;
      if (u.searchParams.get("params")) { sdate = JSON.parse(u.searchParams.get("params")).sdate; normal = true; }
      if (normal) return r.fulfill({ json: { data: yearDays(+String(sdate).slice(0, 4)).map((d) => [d, "0.08"]) } });
      if (sdate === "por") { let data = []; for (let y = 1951; y <= 2025; y++) data = data.concat(series(y).map((x) => x.slice(0, 3))); return r.fulfill({ json: { data } }); }
      const y = +String(sdate).slice(0, 4);
      return r.fulfill({ json: { meta: { name: CHETEK.name, state: "WI", ll: CHETEK.ll }, data: series(y).filter((x) => x[0] <= (u.searchParams.get("edate") || "9999")) } });
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
  opts.posts = [];
  try {
    const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", hasTouch: width < 900, isMobile: false });
    await ctx.clock.setFixedTime(new Date("2026-10-19T17:00:00Z"));
    await mocks(ctx, opts);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, `http://127.0.0.1:${port}`, errors, opts.posts);
  } finally { await browser.close(); srv.close(); }
}
const idle = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && !document.getElementById("rp-art").getAttribute("aria-busy"), null, { timeout: 30000 });
async function draw(page, base, year) {
  await page.goto(base + "/rain-print.html?place=Chetek%2C+WI&year=" + year);
  await idle(page);
  await page.waitForTimeout(800);
}
const top = (page, sel) => page.$eval(sel, (el) => Math.round(el.getBoundingClientRect().top + scrollY));

for (const width of [390, 1280]) {
  test(`2026 Chetek at ${width} px: the card shows under Pay and posts rainyear:2026:55005`, { skip, timeout: 90000 }, async () => {
    await withPage(async (page, base, errors, posts) => {
      await draw(page, base, 2026);
      const card = page.locator("#rp-yearask [data-sa-topic]");
      await card.waitFor({ timeout: 10000 });
      assert.equal(await card.getAttribute("data-sa-topic"), "rainyear:2026:55005");
      assert.equal(await page.locator("#rp-yearask").isVisible(), true);
      assert.equal(await card.locator(".sa-l").textContent(), "Email me when 2026 is finished.");
      assert.match(await card.locator(".sa-n").textContent(), /^One email: Barron County’s full 2026 rain total, and word that the whole year can be printed\.$/);
      assert.equal(await card.locator(".sa-d input").isChecked(), false, "the morning briefing box starts empty here");
      const lab = await card.locator(".sa-l").boundingBox(), inp = await card.locator(".sa-in").boundingBox();
      assert.ok(lab.height < 48 && inp.width > 150 && inp.y > lab.y + lab.height - 2, `the line on top, the field under it: ${JSON.stringify({ lab, inp })}`);
      // Pay sits above the card, and where it sits with the card taken out
      const pay = await top(page, "#rp-pay"), at = await top(page, "#rp-yearask");
      assert.ok(pay < at, `Pay ${pay} above the card ${at}`);
      const payNo = await page.evaluate(() => { const w = document.getElementById("rp-yearask"); w.hidden = true; const t = Math.round(document.getElementById("rp-pay").getBoundingClientRect().top + scrollY); w.hidden = false; return t; });
      assert.equal(pay, payNo, "the card never moves Pay");
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.locator("#rp-yearask").scrollIntoViewIfNeeded();
        await page.evaluate(() => scrollBy(0, -260));
        await page.screenshot({ path: `${SHOTS}/yearask-${width}.png` });
      }
      await card.locator(".sa-in").fill("reader@example.com");
      await card.locator(".sa-b").click();
      await card.locator(".sa-ok").waitFor();
      assert.equal(await card.locator(".sa-ok").textContent(), "Done. One email in January, once NOAA has all of 2026 for Barron County.");
      assert.equal(posts.length, 1);
      assert.deepEqual({ ...posts[0] }, { email: "reader@example.com", source: "page:rain-print", topic: "rainyear:2026:55005", daily: false });
      const ev = await page.evaluate(() => (window.dataLayer || []).filter((a) => a && a[0] === "event" && a[1] === "rain_print_year_signup").map((a) => a[2]));
      assert.deepEqual(ev.map((p) => ({ ...p })), [{ daily: 0 }], "one funnel event, no address, design code or place");
      const all = JSON.stringify(await page.evaluate(() => (window.dataLayer || []).map((a) => Array.from(a))));
      assert.ok(!all.includes("reader@example.com"), "no address in Analytics");
      if (SHOTS) { await page.evaluate(() => scrollBy(0, 0)); await page.screenshot({ path: `${SHOTS}/yearask-${width}-done.png` }); }
      assert.deepEqual(errors, []);
    }, { width, height: width < 900 ? 844 : 900 });
  });
}

test("1984 Chetek: a finished year, no card; then 2026 shows it and 1984 again takes it away", { skip, timeout: 90000 }, async () => {
  await withPage(async (page, base, errors) => {
    await draw(page, base, 1984);
    await page.waitForTimeout(1200);
    assert.equal(await page.locator("#rp-yearask").isHidden(), true);
    assert.equal(await page.locator("#rp-yearask [data-signup-ask]").count(), 0);
    await page.selectOption("#rp-year", "2026");
    await page.click("#rp-go");
    await page.locator("#rp-yearask [data-sa-topic='rainyear:2026:55005']").waitFor({ timeout: 30000 });
    await page.selectOption("#rp-year", "1984");
    await page.click("#rp-go");
    await page.waitForTimeout(300);
    await idle(page);
    await page.waitForTimeout(800);
    assert.equal(await page.locator("#rp-yearask").isHidden(), true, "back to a finished year: the card goes");
    assert.deepEqual(errors, []);
  });
});

test("2026 with a town lookup that names no county: no card, no guess", { skip, timeout: 90000 }, async () => {
  await withPage(async (page, base, errors) => {
    await draw(page, base, 2026);
    await page.waitForTimeout(1200);
    assert.equal(await page.locator("#rp-yearask").isHidden(), true);
    assert.deepEqual(errors, []);
  }, { noCounty: true });
});
