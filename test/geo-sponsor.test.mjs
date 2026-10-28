/* State-targeted sponsor (Sig, Oct 28, 2026; RootLot in CA, NV, TX; Oregon dropped the same day).
 * components/geo-sponsor.js, data/geo-sponsors.json, the hook in components/loader.js.
 * The pure part runs in node; the page cases run in Chromium with Playwright routes
 * answering data/geo-sponsors.json and the worker's GET /where.
 *   node --test test/geo-sponsor.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const G = createRequire(import.meta.url)(join(ROOT, "components/geo-sponsor.js"));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const SHOTS = process.env.GEO_SHOTS || "";

const ENTRY = {
  id: "rootlot", name: "RootLot", states: ["CA", "NV", "TX"], active: true, start: null, end: null,
  headline: "Fixture headline", body: "Fixture body for the test.", facts: ["12 fixture facts"],
  cta_text: "See it", url: "https://example.com/start?x=1", phone: null, logo: null, utm_campaign: "geo-test",
};
const DATA = (o = {}) => ({ sponsors: [Object.assign({}, ENTRY, o)] });
// the pages draw the shipped RootLot entry, switched on (what readers will see once Sig says start)
const LIVE = (o = {}) => ({ sponsors: [Object.assign({}, JSON.parse(read("data/geo-sponsors.json")).sponsors.find((x) => x.id === "rootlot"), { active: true }, o)] });

test("the shipped RootLot entry: CA, NV, TX, off, no dates, Sig's copy, no logo, phone or facts", () => {
  const d = JSON.parse(read("data/geo-sponsors.json"));
  const e = d.sponsors.find((x) => x.id === "rootlot");
  assert.ok(e, "RootLot entry present");
  assert.deepEqual(e.states, ["CA", "NV", "TX"]);
  assert.equal(e.active, false);
  assert.equal(e.start, null); assert.equal(e.end, null);
  assert.equal(e.headline, "Trees Direct From the Grower");
  assert.equal(e.body, "Browse trees and plants shipped directly from the grower.");
  assert.equal(e.cta_text, "Browse Plants");
  assert.equal(e.url, "https://rootlot.com/shop");
  assert.deepEqual(e.facts, []);
  assert.equal(e.logo, null); assert.equal(e.phone, null);
  assert.equal(e.utm_campaign, "geo-test");
  assert.doesNotMatch(JSON.stringify(e), /@|\u2014/, "no email, no em dash");
  for (const st of ["CA", "NV", "TX", "OR", "IA"]) assert.equal(G.choose(d, st, "2026-10-28", false), null, st + ": off until Sig switches it on");
  for (const st of ["CA", "NV", "TX"]) assert.equal(G.choose(d, st, "2026-10-28", true), e, st + ": the preview shows it");
  for (const st of ["OR", "IA"]) assert.equal(G.choose(d, st, "2026-10-28", true), null, st);
  assert.equal(G.anyLive(d, "2026-10-28"), false, "no live entry, so no page asks /where");
  // switched on with null dates it runs any day
  const on = { sponsors: [Object.assign({}, e, { active: true })] };
  for (const day of ["2026-10-28", "2027-06-01", "2030-01-01"]) assert.equal(G.choose(on, "TX", day), on.sponsors[0]);
  const ad = G.toAd(on.sponsors[0], "state-page");
  assert.equal(ad.cta_url, "https://rootlot.com/shop?utm_source=agsist&utm_medium=sponsor&utm_campaign=geo-test&utm_content=state-page");
  assert.equal(ad.logo, ""); assert.equal(ad.phone, ""); assert.deepEqual(ad.facts, []);
  const A = createRequire(import.meta.url)(join(ROOT, "components/sponsor-ad.js"));
  const h = A.render(ad, "state-page", { slot: "geo-rootlot" });
  assert.doesNotMatch(h, /<img|sa-logo|sa-facts|sa-phone|tel:|mailto:/, "text only: no logo, facts, phone or email");
  assert.match(h, /Trees Direct From the Grower/); assert.match(h, /Browse Plants/);
});

test("page state comes from the path: CA, OR and NV state and county pages", () => {
  const cases = {
    "/rain/california": "CA", "/rain/california.html": "CA", "/rain/california/alameda-county": "CA",
    "/rain/oregon/baker-county.html": "OR", "/rain/nevada": "NV", "/prf/nevada/clark-county": "NV",
    "/rain/texas": "TX", "/rain/texas/travis-county.html": "TX", "/cash-bids/texas/amarillo": "TX", "/prf/texas/hale-county": "TX",
    "/arc-plc/california/fresno-county": "CA", "/farmland-atlas/oregon/marion-county": "OR",
    "/rent/nevada": "NV", "/yield/california": "CA", "/hail-map/oregon": "OR", "/cash-bids/oregon/lexington": "OR",
    "/cash-bids/oregon/": "OR", "/rain/iowa/story-county": "IA", "/": "", "/rain": "", "/prf": "",
    "/daily/2026-10-27": "", "/cash-bids/company/x": "", "/rain/californiax": "",
  };
  for (const [p, st] of Object.entries(cases)) assert.equal(G.pageState(p), st, p);
});

test("every CA, NV and TX page the path rule covers exists and loads the loader (count by state)", () => {
  const SECT = ["rain", "prf", "arc-plc", "farmland-atlas", "rent", "yield", "hail-map", "cash-bids"];
  const count = { CA: 0, NV: 0, TX: 0 };
  for (const [slug, st] of [["california", "CA"], ["nevada", "NV"], ["texas", "TX"]]) {
    for (const s of SECT) {
      const files = [];
      if (existsSync(join(ROOT, s, slug + ".html"))) files.push(join(s, slug + ".html"));
      if (existsSync(join(ROOT, s, slug))) for (const f of readdirSync(join(ROOT, s, slug))) if (f.endsWith(".html")) files.push(join(s, slug, f));
      for (const f of files) {
        const url = "/" + f.replace(/\.html$/, "").replace(/\/index$/, "/");
        assert.equal(G.pageState(url), st, url);
        if (/loader\.js/.test(read(f))) count[st]++;
      }
    }
  }
  assert.ok(count.CA >= 200 && count.NV >= 60 && count.TX >= 500, JSON.stringify(count));
  console.log("# geo pages with the loader: " + JSON.stringify(count));
});

test("inactive, unfinished and out-of-date entries draw nothing; null dates mean no limit (Chicago day)", () => {
  assert.ok(G.choose(DATA(), "CA", "2026-10-28"));
  assert.equal(G.choose(DATA({ active: false }), "CA", "2026-10-28"), null);
  assert.equal(G.choose(DATA({ active: "true" }), "CA", "2026-10-28"), null);
  assert.equal(G.choose(DATA({ headline: null }), "CA", "2026-10-28"), null);
  assert.equal(G.choose(DATA({ url: "http://example.com" }), "CA", "2026-10-28"), null, "https only");
  assert.equal(G.choose(DATA({ url: "javascript:alert(1)" }), "CA", "2026-10-28"), null);
  assert.equal(G.choose(DATA(), "IA", "2026-10-28"), null);
  assert.equal(G.choose(DATA(), "-", "2026-10-28"), null);
  assert.equal(G.choose(DATA(), "", "2026-10-28"), null);
  assert.equal(G.choose(DATA({ start: "2026-10-29" }), "CA", "2026-10-28"), null);
  assert.ok(G.choose(DATA({ start: "2026-10-28" }), "CA", "2026-10-28"));
  assert.ok(G.choose(DATA({ end: "2026-10-28" }), "CA", "2026-10-28"));
  assert.equal(G.choose(DATA({ end: "2026-10-27" }), "CA", "2026-10-28"), null);
  assert.equal(G.choose(DATA({ start: "Oct 1" }), "CA", "2026-10-28"), null, "a bad date is not no limit");
  // 03:30 UTC on Oct 29 is still Oct 28 in Chicago: an entry ending Oct 28 still shows
  const day = G.today(new Date("2026-10-29T03:30:00Z"));
  assert.equal(day, "2026-10-28");
  assert.ok(G.choose(DATA({ end: "2026-10-28" }), "CA", day));
  assert.equal(G.choose(DATA({ start: "2026-10-29" }), "CA", day), null);
  // a preview ignores active and dates, not copy
  assert.ok(G.choose(DATA({ active: false, end: "2020-01-01" }), "CA", "2026-10-28", true));
});

test("every link carries the utm tags, appended correctly to any url", () => {
  const T = "utm_source=agsist&utm_medium=sponsor&utm_campaign=geo-test&utm_content=state-page";
  assert.equal(G.withUtm("https://rootlot.com", "geo-test", "state-page"), "https://rootlot.com?" + T);
  assert.equal(G.withUtm("https://rootlot.com/", "geo-test", "state-page"), "https://rootlot.com/?" + T);
  assert.equal(G.withUtm("https://rootlot.com/a?b=1", "geo-test", "state-page"), "https://rootlot.com/a?b=1&" + T);
  assert.equal(G.withUtm("https://rootlot.com/a?", "geo-test", "state-page"), "https://rootlot.com/a?" + T);
  assert.equal(G.withUtm("https://rootlot.com/a?b=1&", "geo-test", "state-page"), "https://rootlot.com/a?b=1&" + T);
  assert.equal(G.withUtm("https://rootlot.com/a?b=1#top", "geo-test", "reader-state"),
    "https://rootlot.com/a?b=1&utm_source=agsist&utm_medium=sponsor&utm_campaign=geo-test&utm_content=reader-state#top");
  const ad = G.toAd(Object.assign({}, ENTRY, { utm_campaign: undefined }), "reader-state");
  assert.match(ad.cta_url, /utm_campaign=geo-rootlot&utm_content=reader-state$/);
  assert.equal(ad.label, "Sponsor");
});

test("the ad renders through AgsistAd with the slot geo-<id>; the reader's state is in no count", () => {
  const A = createRequire(import.meta.url)(join(ROOT, "components/sponsor-ad.js"));
  const h = A.render(G.toAd(ENTRY, "state-page"), "state-page", { slot: "geo-rootlot" });
  assert.match(h, /class="sa-ad"/);
  assert.match(h, /data-sponsor-slot="geo-rootlot"/);
  assert.match(h, /data-sponsor-click="geo-rootlot"/);
  assert.match(h, />Sponsor</);
  assert.match(h, /utm_content=state-page/);
  assert.doesNotMatch(h, /\$\d|price|per month/i, "no price text");
  const src = read("components/geo-sponsor.js");
  assert.doesNotMatch(src, /gtag|dataLayer|sponsor_viewable/, "the geo file sends no event itself");
  assert.doesNotMatch(src, /localStorage|document\.cookie/, "nothing kept past the session");
  const calls = [...read("components/sponsor-metrics.js").matchAll(/ga\('sponsor_\w+', \{([^}]*)\}/g)].map((m) => m[1]);
  assert.equal(calls.length, 2);
  for (const c of calls) assert.deepEqual(c.match(/\b(\w+):/g).filter((k) => !/^(slot|page|dwell_ms):$/.test(k)), [], "events carry slot and page only: " + c);
  // only the 2-letter state from /where is ever kept
  assert.equal(G.regionOf({ ok: true, city: "Fresno", region_code: "CA", lat: 36.7, lon: -119.8 }), "CA");
  assert.equal(G.regionOf({ ok: false }), "-");
  assert.equal(G.regionOf({ ok: true, region_code: "ON" }), "ON");
  assert.equal(G.regionOf({ ok: true, region_code: "<b>" }), "-");
  assert.equal(G.regionOf(null), "-");
  assert.doesNotMatch(src.slice(src.indexOf("function lookup")), /setItem\(KEY, (?!rc\))/, "stores rc only");
});

test("excluded pages: the loader never loads the component there, and the component refuses them too", () => {
  const L = read("components/loader.js");
  const m = /var GEO_SKIP = (\/.+\/);\n/.exec(L);
  assert.ok(m, "loader names the excluded pages");
  const SKIP = eval(m[1]);
  for (const p of ["/rain-print", "/rain-print.html", "/rain-print-business", "/rain-print-approve", "/rp-gift", "/rp-gift.html",
    "/rain-gauge", "/gifts-for-farmers", "/birth-year-weather-gift", "/wedding-year-weather-gift", "/farm-anniversary-gifts",
    "/farmer-retirement-gifts.html"]) {
    assert.ok(SKIP.test(p), "loader skips " + p);
    assert.ok(G.excluded(p), "component skips " + p);
  }
  for (const p of ["/", "/rain/california", "/rain", "/rain-radar", "/prf/california"]) {
    assert.ok(!SKIP.test(p), p); assert.ok(!G.excluded(p), p);
  }
  assert.match(L, /if \(noSponsor \|\| window\.__geoSponsor \|\| GEO_SKIP\.test\(location\.pathname\)\) return;/);
});

/* ---------- in the browser ---------- */
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f = normalize(join(ROOT, p));
    if (f.endsWith("/")) f += "index.html";
    if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
const H = { "access-control-allow-origin": "*" };
/* o: {data: object | "real", where: object | "fail" | "hang", pageSponsors: object, w: width} */
async function open(browser, port, path, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: o.w || 390, height: 844 }, serviceWorkers: "block" });
  const pg = await ctx.newPage();
  const log = { where: 0, geo: 0, data: 0, errs: [] };
  pg.on("pageerror", (e) => log.errs.push(String(e)));
  await pg.addInitScript(() => {
    window.__cls = []; window.__ins = 0;
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) {
        const g = document.querySelector(".geo-spon");
        const srcs = (e.sources || []).map((x) => x.node).filter(Boolean);
        // a shift the ad could cause: a node inside it or after it in the page
        const byAd = !!g && srcs.some((n) => g === n || g.contains(n) || (g.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING));
        window.__cls.push({ v: e.value, t: e.startTime, byAd, src: srcs.map((n) => (n.id || n.className || n.nodeName) + "").join(",") });
      } })
        .observe({ type: "layout-shift", buffered: true });
    } catch (e) {}
    new MutationObserver(() => { if (!window.__ins && document.querySelector(".geo-spon")) window.__ins = performance.now(); })
      .observe(document, { childList: true, subtree: true });
  });
  await pg.route((u) => !/^(127\.0\.0\.1|agsist-api\.dnilgis\.workers\.dev)$/.test(u.hostname), (r) => r.abort());
  await pg.route((u) => u.hostname === "agsist-api.dnilgis.workers.dev", async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname !== "/where") return r.abort();
    log.where++;
    if (o.where === "hang") return;
    if (!o.where || o.where === "fail") return r.fulfill({ status: 503, headers: H, body: "x" });
    return r.fulfill({ status: 200, headers: H, contentType: "application/json", body: JSON.stringify(o.where) });
  });
  await pg.route((u) => u.pathname === "/components/geo-sponsor.js", async (r) => { log.geo++; await r.continue(); });
  await pg.route((u) => u.pathname === "/data/geo-sponsors.json", (r) => {
    log.data++;
    return o.data === "real" ? r.continue() : r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o.data || LIVE()) });
  });
  if (o.pageSponsors) await pg.route((u) => u.pathname === "/data/page-sponsors.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o.pageSponsors) }));
  await pg.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load" });
  await pg.waitForTimeout(o.wait || 1800);
  return { ctx, pg, log };
}
const drawn = (pg) => pg.waitForSelector(".geo-spon .sa-ad", { timeout: 8000 }).catch(() => null);
const ad = (pg) => pg.evaluate(() => {
  const a = document.querySelector(".geo-spon .sa-ad");
  if (!a) return null;
  const r = a.getBoundingClientRect();
  return { slot: a.getAttribute("data-sponsor-slot"), href: a.querySelector("a.sa-cta").getAttribute("href"), text: a.textContent,
    belowFold: r.top + scrollY >= innerHeight, sideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});
async function shot(pg, file) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await pg.addStyleTag({ content: "#site-header,header,.tk-bar,.ticker,[class*=ticker],[class*=tick-]{visibility:hidden!important}" });
  await pg.evaluate(() => window.scrollTo(0, document.querySelector(".geo-spon").getBoundingClientRect().top + scrollY - 200));
  await pg.waitForTimeout(800);
  const b = await pg.evaluate(() => { const r = document.querySelector(".geo-spon").getBoundingClientRect(); return { y: r.top + scrollY, h: r.height }; });
  await pg.screenshot({ path: join(SHOTS, file), fullPage: true, clip: { x: 0, y: Math.max(0, b.y - 160), width: pg.viewportSize().width, height: b.h + 320 } });
}
const cls = (pg) => pg.evaluate(() => ({
  total: window.__cls.reduce((s, e) => s + e.v, 0),
  late: window.__ins ? window.__cls.filter((e) => e.t >= window.__ins - 1) : [],
  afterAd: window.__cls.filter((e) => e.byAd).reduce((s, e) => s + e.v, 0),
}));
async function browserRun(fn) {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try { await fn(browser, port); } finally { await browser.close(); srv.close(); }
}
const CA_COUNTY = "/rain/california/alameda-county.html";

test("browser: a CA county rain page draws the ad with no lookup, below the fold, no shift, at 390 and 1280", { skip, timeout: 180000 }, async () => {
  await browserRun(async (browser, port) => {
    for (const w of [390, 1280]) {
      const { ctx, pg, log } = await open(browser, port, CA_COUNTY, { w });
      await drawn(pg);
      const a = await ad(pg);
      assert.ok(a, w + ": drawn");
      assert.equal(a.slot, "geo-rootlot");
      assert.equal(a.href, "https://rootlot.com/shop?utm_source=agsist&utm_medium=sponsor&utm_campaign=geo-test&utm_content=state-page");
      assert.match(a.text, /Sponsor/); assert.match(a.text, /Trees Direct From the Grower/); assert.match(a.text, /Browse Plants/);
      assert.equal(await pg.$(".geo-spon img, .geo-spon .sa-logo, .geo-spon .sa-phone"), null, w + ": text only");
      assert.ok(a.belowFold, w + ": below the fold");
      assert.ok(a.sideScroll <= 0, w + ": no sideways scroll");
      assert.equal(log.where, 0, w + ": no lookup on a state page");
      const c = await cls(pg);
      assert.equal(c.afterAd, 0, w + ": the ad moved nothing on screen");
      console.log(`# CLS ${CA_COUNTY} @${w}: total ${c.total.toFixed(4)}, after the ad ${c.afterAd}`);
      await shot(pg, `ca-county-${w}.png`);
      // the shift check is not blind: the same box put at the top of the page is caught
      await pg.evaluate(() => window.scrollTo(0, 0));
      await pg.waitForTimeout(300);
      await pg.evaluate(() => { const b = document.createElement("div"); b.className = "geo-spon"; b.style.height = "300px"; const m = document.querySelector("main .rc"); m.insertBefore(b, m.firstChild); });
      await pg.waitForTimeout(500);
      assert.ok((await cls(pg)).afterAd > 0.05, w + ": a box above the fold would have counted");
      assert.deepEqual(log.errs, []);
      await ctx.close();
    }
  });
});

test("browser: the home page draws for a CA answer from /where, keeps only CA, asks once a session", { skip, timeout: 180000 }, async () => {
  await browserRun(async (browser, port) => {
    for (const w of [390, 1280]) {
      const { ctx, pg, log } = await open(browser, port, "/", { w, where: { ok: true, city: "Fresno", region: "California", region_code: "CA", lat: 36.74, lon: -119.79 } });
      await drawn(pg);
      const a = await ad(pg);
      assert.ok(a, w + ": drawn");
      assert.match(a.href, /utm_content=reader-state$/);
      assert.ok(a.belowFold);
      assert.equal(log.where, 1);
      const kept = await pg.evaluate(() => { const o = {}; for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); o[k] = sessionStorage.getItem(k); } return o; });
      assert.equal(kept["agsist-geo-rc"], "CA");
      assert.doesNotMatch(JSON.stringify(kept), /Fresno|36\.7|119\.7/, "no town or place kept");
      const c = await cls(pg);
      assert.equal(c.afterAd, 0, w + ": no shift from the ad " + JSON.stringify(c.late));
      console.log(`# CLS / with CA @${w}: total ${c.total.toFixed(4)}, after the ad ${c.afterAd}`);
      await shot(pg, `home-ca-${w}.png`);
      // the next page in the same session does not ask again
      await pg.goto(`http://127.0.0.1:${port}/rain/iowa.html`, { waitUntil: "load" });
      await pg.waitForTimeout(1500);
      assert.equal(log.where, 1, "one lookup per session");
      await drawn(pg);
      assert.ok(await ad(pg), "a CA reader sees it on an Iowa page too");
      await ctx.close();
    }
  });
});

test("browser: TX and NV county pages draw with no lookup; an Oregon page (dropped Oct 28) does not", { skip, timeout: 180000 }, async () => {
  await browserRun(async (browser, port) => {
    for (const path of ["/rain/texas/travis-county.html", "/rain/nevada/carson-city.html", "/rain/texas.html", "/prf/nevada/clark-county.html"]) {
      const { ctx, pg, log } = await open(browser, port, path);
      await drawn(pg);
      const a = await ad(pg);
      assert.ok(a, path + ": drawn");
      assert.match(a.href, /utm_content=state-page$/);
      assert.equal(log.where, 0, path + ": no lookup");
      await ctx.close();
    }
    const o = await open(browser, port, "/rain/oregon/baker-county.html", { where: { ok: true, region_code: "OR", city: "Baker City", lat: 44.7, lon: -117.8 } });
    assert.equal(await ad(o.pg), null, "Oregon page, Oregon reader: nothing");
    assert.equal(o.log.where, 1, "an Oregon page is an other-state page now: it asks");
    await o.ctx.close();
    for (const rc of ["TX", "NV"]) {
      const { ctx, pg } = await open(browser, port, "/", { where: { ok: true, region_code: rc, city: "x", lat: 30, lon: -97 } });
      await drawn(pg);
      const a = await ad(pg);
      assert.ok(a, "/where " + rc + " draws");
      assert.match(a.href, /utm_content=reader-state$/);
      await ctx.close();
    }
  });
});

test("browser: /where IA, a failed and a hung /where, and an other-state page draw nothing", { skip, timeout: 180000 }, async () => {
  await browserRun(async (browser, port) => {
    for (const [path, where] of [["/", { ok: true, region_code: "IA", city: "Ames", lat: 42, lon: -93.6 }], ["/", "fail"], ["/", "hang"], ["/", { ok: false }],
      ["/rain/iowa/story-county.html", { ok: true, region_code: "IA", city: "Ames", lat: 42, lon: -93.6 }], ["/rain/iowa/story-county.html", "fail"]]) {
      const { ctx, pg, log } = await open(browser, port, path, { where, wait: where === "hang" ? 3500 : 1800 });
      assert.equal(await ad(pg), null, path + " " + JSON.stringify(where));
      assert.equal(log.where, 1, "asked once");
      assert.equal(await pg.evaluate(() => document.querySelectorAll(".geo-spon").length), 0);
      assert.deepEqual(log.errs, []);
      await ctx.close();
    }
  });
});

test("browser: the shipped (inactive) file draws nothing and makes no lookup, even on a CA page", { skip, timeout: 120000 }, async () => {
  await browserRun(async (browser, port) => {
    for (const path of [CA_COUNTY, "/"]) {
      const { ctx, pg, log } = await open(browser, port, path, { data: "real", where: { ok: true, region_code: "CA", city: "Fresno", lat: 36, lon: -119 } });
      assert.equal(await ad(pg), null, path);
      assert.equal(log.where, 0, path + ": no live entry, no lookup");
      await ctx.close();
    }
    const { ctx, pg } = await open(browser, port, CA_COUNTY, { data: LIVE({ start: "2099-01-01" }) });
    assert.equal(await ad(pg), null, "a future start draws nothing");
    await ctx.close();
  });
});

test("browser: a sold page sponsor wins over the geo ad", { skip, timeout: 120000 }, async () => {
  await browserRun(async (browser, port) => {
    const ps = { slots: { "cash-bids-texas": { company: "Sold Co", url: "https://example.org/", start: "2026-01-01", active: true } } };
    const sold = await open(browser, port, "/cash-bids/texas/booker.html", { pageSponsors: ps });
    assert.equal(await ad(sold.pg), null);
    assert.ok(await sold.pg.$("aside.ag-sponsor-ribbon--sold"));
    await sold.ctx.close();
    const open2 = await open(browser, port, "/cash-bids/texas/booker.html", { pageSponsors: { slots: {} } });
    await drawn(open2.pg);
    const a = await ad(open2.pg);
    assert.ok(a, "unsold: the geo ad takes the open line's place");
    assert.equal(await open2.pg.evaluate(() => document.querySelector("aside.ag-sponsor-ribbon").hidden), true);
    await open2.ctx.close();
  });
});

test("browser: excluded pages never load the component, even with a preview flag", { skip, timeout: 180000 }, async () => {
  await browserRun(async (browser, port) => {
    for (const path of ["/rain-print.html?geo-preview=CA", "/rain-gauge.html?geo-preview=CA", "/rain-print-business.html?geo-preview=CA",
      "/gifts-for-farmers.html?geo-preview=CA", "/birth-year-weather-gift.html?geo-preview=CA"]) {
      const { ctx, pg, log } = await open(browser, port, path, { where: { ok: true, region_code: "CA", city: "Fresno", lat: 36, lon: -119 }, wait: 1500 });
      assert.equal(log.geo, 0, path + " loaded geo-sponsor.js");
      assert.equal(log.data, 0, path + " read geo-sponsors.json");  // (Rain Print asks /where for its own town; that is not this)
      assert.equal(await pg.$(".sa-ad"), null, path);
      await ctx.close();
    }
  });
});

test("browser: ?geo-preview=TX shows the shipped inactive entry with copy, counts nothing, asks nothing", { skip, timeout: 120000 }, async () => {
  await browserRun(async (browser, port) => {
    const { ctx, pg, log } = await open(browser, port, "/?geo-preview=TX", { data: "real" });
    await drawn(pg);
    const a = await ad(pg);
    assert.ok(a, "preview drawn");
    assert.equal(a.slot, null, "no measurement slot in a preview");
    assert.match(a.href, /utm_content=preview$/);
    assert.equal(log.where, 0);
    await shot(pg, "home-preview-390.png");
    await ctx.close();
    const n = await open(browser, port, "/?geo-preview=OR", { data: "real" });
    assert.equal(await ad(n.pg), null, "a preview for a state with no entry draws nothing");
    await n.ctx.close();
  });
});

test("browser: RootLot's portal: free test muted under its label, ad counts 0 and not started, its states, no errors", { skip, timeout: 120000 }, async () => {
  const conf = JSON.parse(read("data/sponsors.json"));
  const rl = conf.sponsors.find((s) => s.slug === "rootlot");
  assert.ok(rl && /^[0-9a-f]{16}$/.test(rl.token));
  assert.ok(existsSync(join(ROOT, "data/sponsors", "rootlot-" + rl.token + ".json")), "the portal file is built");
  await browserRun(async (browser, port) => {
    for (const w of [390, 1280]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, serviceWorkers: "block" });
      const pg = await ctx.newPage();
      const errs = []; pg.on("pageerror", (e) => errs.push(String(e)));
      await pg.route((u) => u.hostname !== "127.0.0.1", (r) => r.abort());
      await pg.goto(`http://127.0.0.1:${port}/sponsor-report.html?r=rootlot-${rl.token}`, { waitUntil: "load" });
      await pg.waitForSelector("#states", { timeout: 8000 });
      const t = await pg.evaluate(() => document.getElementById("cp").innerText);
      assert.match(t, /State-targeted sponsor/);
      assert.match(t, /California, Nevada and Texas/);
      assert.match(t, /Free test: no charge/i);
      assert.match(t, /Trees Direct From the Grower/);
      assert.ok(await pg.$("#billing.cp-free .cp-bill.cp-muted"), w + ": billing kept, muted");
      assert.equal(await pg.evaluate(() => [...document.querySelectorAll("#results .cp-kpi-n")].slice(0, 2).map((e) => e.textContent).join(",")), "0,0");
      assert.match(await pg.textContent("#results"), /not started/);
      const reg = await pg.textContent("#states");
      for (const n of ["California", "Nevada", "Texas", "Everywhere else", "not started", "Readers in your states"]) assert.ok(reg.includes(n), w + ": " + n);
      const aud = JSON.parse(read("data/audience.json"));
      const towns = ((aud.servers || {}).towns || []).filter((x) => ["California", "Nevada", "Texas"].includes(x.region));
      if (towns.length) for (const x of towns) assert.ok(reg.includes(x.city + ", " + x.region), "server town named: " + x.city);
      else assert.doesNotMatch(reg, /Data-center traffic left out/);
      assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0, true, w + ": no sideways scroll");
      assert.deepEqual(errs, []);
      await ctx.close();
    }
  });
});
