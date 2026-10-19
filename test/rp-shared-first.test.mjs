/* A Rain Print link that carries a design opens with that print first
 * (Sig, 2026-10-19). The phone audit found a real ?d= link (made with
 * RainPrint.shortUrl(), Ames 2012) opening on the generic headline and the
 * Chetek photo, with the shared print starting at 954 px, under the 844 px
 * fold, while the phone bar already named Ames. Now:
 *
 *   - ?d=<code>, ?d=GIFT-<code> and ?d=RPS-<id> (a Stripe reference, looked
 *     up the way /r does) put the drawn print in the first screen at 390 x 844
 *     and 1280 x 800, from the first frame, with no layout shift (/r?<id>
 *     opens /rain-print?d=<code>, the first case), and an RPS- design wears no
 *     example words (it did: SHOW_EX stayed on for a design looked up late);
 *   - a line over it says which print it is (name, place and year, what the
 *     print itself shows) with a Make your own button to the town box;
 *   - an ordinary visit keeps its order and never shows the line;
 *   - a damaged code, a short link the worker doesn't know, Sig's print files
 *     page (maker) and the paid view keep the ordinary order;
 *   - a reader who draws another town is told the print is theirs now, with a
 *     link back to the one shared.
 *
 * NOAA, the town lookup and the subs worker are answered here from made-up data.
 * Needs Playwright and Chromium; skipped where they are missing.
 *   node --test test/rp-shared-first.test.mjs
 */
import { makerFlag } from "./fixtures/rp-maker.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = process.env.RP_ROOT || fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const ctxVm = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctxVm.window = ctxVm;
vm.runInNewContext(readFileSync(ROOT + "components/rain-print.js", "utf8"), ctxVm);
const RP = ctxVm.RainPrint;

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
const STN = { name: "AMES", sids: ["130200 2"], ll: [-93.62, 42.03], valid_daterange: [["1950-01-01", "2026-10-09"]], state: "IA" };
const GEO = {
  ames: [{ name: "Ames", latitude: 42.0347, longitude: -93.62, admin1: "Iowa", country_code: "US" }],
  chetek: [{ name: "Chetek", latitude: 45.3141, longitude: -91.651, admin1: "Wisconsin", country_code: "US" }],
};
// the design the audit used: Ames 2012, here with a name on it
const CODE = RP.encodeCode({ place: "Ames, IA", year: 2012, style: "r1", cmp: "normal", normals: true, name: "Test Farm" });

async function mocks(ctx, opts) {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = new URL(r.request().url());
    if (u.host === "agsist-subs.dnilgis.workers.dev") {
      if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
      const m = /^\/rp-short\/([0-9A-Z]{5,8})$/.exec(u.pathname);
      if (m) return m[1] === "K7Q2M" ? r.fulfill({ status: 200, headers: h, json: { code: CODE } }) : r.fulfill({ status: 404, headers: h, json: { missing: true } });
      if (u.pathname === "/rp-short") return r.fulfill({ status: 200, headers: h, json: { ok: true, id: "K7Q2M" } });
      return r.fulfill({ status: 503, headers: h, body: "x" });
    }
    if (u.host === "geocoding-api.open-meteo.com") {
      const name = (u.searchParams.get("name") || "").toLowerCase();
      return r.fulfill({ json: { results: GEO[name] || GEO.ames } });
    }
    if (u.host === "data.rcc-acis.org") {
      if (u.pathname === "/StnMeta") return r.fulfill({ json: { meta: [STN] } });
      let sdate = u.searchParams.get("sdate"), normal = false;
      if (u.searchParams.get("params")) { sdate = JSON.parse(u.searchParams.get("params")).sdate; normal = true; }
      if (normal) return r.fulfill({ json: { data: yearDays(+String(sdate).slice(0, 4)).map((d) => [d, "0.08"]) } });
      if (sdate === "por") { let data = []; for (let y = 1995; y <= 2025; y++) data = data.concat(series(y).map((x) => x.slice(0, 3))); return r.fulfill({ json: { data } }); }
      return r.fulfill({ json: { meta: { name: STN.name, state: STN.state, ll: STN.ll }, data: series(+String(sdate).slice(0, 4)) } });
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
async function withPage(fn, { width = 390, height = 844, maker = false, ...opts } = {}) {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", hasTouch: width < 900, isMobile: false });
    if (maker) await makerFlag(ctx);
    await ctx.clock.setFixedTime(new Date("2026-10-15T17:00:00Z"));
    await mocks(ctx, opts);
    // from the first frame: where the print's box sits, and every layout shift
    await ctx.addInitScript(() => {
      window.__tops = []; window.__cls = 0; window.__shifts = [];
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__shifts.push((e.sources || []).map((s) => (s.node && (s.node.id || s.node.className)) + ":" + s.previousRect.y + ">" + s.currentRect.y).join(" ")); } }).observe({ type: "layout-shift", buffered: true }); } catch (e) {}
      let n = 0;
      const tick = () => { const a = document.getElementById("rp-art"); if (a) { const r = a.getBoundingClientRect(), v = Math.round(r.top + scrollY) + "/" + Math.round(r.height), l = window.__tops; if (l[l.length - 1] !== v) l.push(v); } if (++n < 600) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, `http://127.0.0.1:${port}`, errors, ctx);
  } finally { await browser.close(); srv.close(); }
}
const idle = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && !document.getElementById("rp-art").getAttribute("aria-busy"), null, { timeout: 30000 });
const layout = (page) => page.evaluate(() => {
  const y = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.height ? { top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY) } : null; };
  return { from: document.documentElement.classList.contains("rp-from-link"), line: y("#rp-shared"), lineText: document.getElementById("rp-shared-t").textContent,
    own: !document.getElementById("rp-shared-own").hidden, art: y("#rp-art"), h1: y("h1"), photo: y("#rp-photo"), place: y("#rp-place"), scrollY,
    svg: document.querySelector("#rp-art svg")?.textContent || "", tops: window.__tops, cls: window.__cls, shifts: window.__shifts,
    bar: document.getElementById("rp-bar").hidden ? "" : document.getElementById("rp-bar").innerText.replace(/\s+/g, " ") };
});

for (const [label, q] of [["?d=<code>", "?d=" + CODE], ["?d=GIFT-<code>", "?d=GIFT-" + CODE], ["?d=RPS-<id> (a Stripe reference)", "?d=RPS-K7Q2M"]]) {
  test(`phone, ${label}: the shared print is in the first screen from the first frame, named in the line over it`, { skip }, async () => {
    await withPage(async (page, base, errors) => {
      await page.goto(base + "/rain-print.html" + q);
      await idle(page);
      await page.waitForTimeout(800);
      const L = await layout(page);
      assert.equal(L.from, true, "the page is marked as opened from a design link");
      assert.equal(L.scrollY, 0);
      assert.ok(L.line && L.line.top < L.art.top, "the line sits over the print");
      assert.equal(L.lineText, "Shared with you: Ames, IA, 2012 (Test Farm)");
      assert.equal(L.own, true, "Make your own shows");
      assert.ok(L.art.bottom <= 844, `the whole print is in the first screen: ${JSON.stringify(L.art)}`);
      assert.match(L.svg, /2012/, "the print drawn is the shared one");
      assert.doesNotMatch(L.svg, /Johnson|For Dad|Hail/, "no example words on a design from a link");
      assert.ok(L.h1.top > L.art.bottom && L.photo.top > L.art.bottom, "the headline and the photo come after the print");
      assert.ok(L.place.top > L.h1.top, "the steps follow the headline");
      // no jump: the print's box never moved or resized once it was on screen, and nothing shifted
      assert.equal(new Set(L.tops).size, 1, "the print's box held still: " + L.tops.join(" "));
      assert.ok(L.cls < 0.005, `layout shift ${L.cls.toFixed(4)}: ${L.shifts.join(" | ")}`);
      // the phone bar names the print on screen
      if (L.bar) assert.match(L.bar, /Ames, IA 2012/);
      assert.deepEqual(errors, []);
    });
  });
}

test("laptop, ?d=<code>: the print is in the first screen at 1280 x 800", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?d=" + CODE);
    await idle(page);
    await page.waitForTimeout(500);
    const L = await layout(page);
    assert.equal(L.from, true);
    assert.equal(L.lineText, "Shared with you: Ames, IA, 2012 (Test Farm)");
    assert.ok(L.line.top < L.art.top && L.art.top < 400 && L.art.bottom <= 800, JSON.stringify(L.art));
    assert.ok(L.h1.top > L.art.bottom, "the headline comes after");
    assert.equal(new Set(L.tops).size, 1, "the print's box held still: " + L.tops.join(" "));
    assert.deepEqual(errors, []);
  }, { width: 1280, height: 800 });
});

test("Make your own goes to the town box, its text selected to type over", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?d=" + CODE);
    await idle(page);
    await page.click("#rp-shared-own");
    await page.waitForTimeout(700);
    const s = await page.evaluate(() => { const p = document.getElementById("rp-place"), r = p.getBoundingClientRect(); return { focus: document.activeElement === p, sel: p.value.slice(p.selectionStart, p.selectionEnd), inView: r.top >= 0 && r.bottom <= innerHeight }; });
    assert.deepEqual(s, { focus: true, sel: "Ames, IA", inView: true });
    // the reader draws their own town: the line says the print is theirs now, and links back to the shared one
    await page.keyboard.type("Chetek, WI");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /Chetek/.test(document.querySelector("#rp-art svg")?.textContent || ""), null, { timeout: 30000 });
    await idle(page);
    await page.waitForTimeout(400);
    const L = await layout(page);
    assert.equal(L.lineText, "Shared with you: Ames, IA, 2012 (Test Farm). The print here is yours now.");
    assert.equal(L.own, false);
    assert.match(await page.getAttribute("#rp-shared-t a", "href"), new RegExp("\\?d=" + CODE + "$"));
    if (L.bar) assert.match(L.bar, /Chetek/, "the phone bar names the print on screen");
    assert.deepEqual(errors, []);
  });
});

test("an ordinary visit keeps its order and never shows the line", { skip }, async () => {
  for (const [w, h] of [[390, 844], [1280, 800]]) await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html");
    await page.waitForTimeout(1500);
    const L = await layout(page);
    assert.equal(L.from, false);
    assert.equal(L.line, null, "no line");
    assert.ok(L.h1.top < L.art.top, "the headline first");
    const d = await page.evaluate(() => [getComputedStyle(document.getElementById("rp-head")).display, getComputedStyle(document.querySelector(".rp-flow")).display]);
    assert.deepEqual(d, ["block", w < 900 ? "flex" : "grid"], "the wrapper adds no layout of its own");
    // the first screen as it was: the headline at the top, the photo, then the print (390: 954 px; 1280: 492 px, both before this change).
    // 2026-10-19 (board B): the Christmas line names last year by Christmas and this year in January, two lines longer at 390 (1019)
    assert.equal(L.art.top, w < 900 ? 1019 : 492, `${w}: the print's box where it always was`);
    assert.deepEqual(errors, []);
  }, { width: w, height: h });
});

test("links that keep the ordinary order: a damaged code, an unknown short link, the print files page, the paid view", { skip }, async () => {
  const cases = [
    ["?d=zzzzzzzzzzzz", "a damaged code", false],
    ["?d=RPS-ZZZZ9", "a short link the worker doesn't know", false],
    ["?d=" + CODE + "&maker=1", "Sig's print files page", true],
    ["?paid=framed12x18&d=" + CODE, "the paid view", false],
  ];
  for (const [q, what, maker] of cases) await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html" + q);
    await page.waitForTimeout(2500);
    const L = await layout(page);
    assert.equal(L.from, false, what + ": no mark");
    assert.equal(L.line, null, what + ": no line");
    assert.ok(L.h1.top < L.art.top, what + ": the headline first");
    assert.deepEqual(errors, [], what);
  }, { maker });
});
