/* One failure path for a slow bids network (Nov 4, 2026, site panel): components/bids-fallback.js.
 *
 * The real case (farmer seat, every outside host aborted, which is what a cab phone sees past
 * bids-network.js DEADLINE_MS): home and /cash-bids said "did not load" and linked /cash-bids, which fails
 * the same way; the Atlas county page and Fast Facts read the short committed data/bids.json and printed
 * "$4.28, 48 mi. Best of 4 within 50 mi" under "the elevator network did not answer". Nothing counted it.
 *
 * Now: home and /cash-bids link the nearest baked town page with its time; the Atlas and Fast Facts rows
 * name the short list or withhold, never "Best of N within 50 mi"; each counts one GA event,
 * bids_net_fallback. Browser runs block every outside host and service workers (build rule 58).
 *
 *   node --test test/bids-fallback.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const BF = require(ROOT + "components/bids-fallback.js");
const P = require(ROOT + "components/place.js");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const SHOTS = process.env.WAVE1B_SHOTS || "";

/* a state basis table as scripts/build_cash_bid_pages.py writes it, towns included (fixture) */
const IA = {
  schema: "agsist-state-basis/1", state: "IA", name: "Iowa", generated: "2026-11-04T01:49:07Z",
  cols: ["crop", "elevator", "town", "path", "cash", "basis", "vs", "delivery", "wow_cents", "priced", "flag"],
  rows: [["corn", "Heart of Iowa Coop", "Nevada", "/cash-bids/iowa/nevada", 3.96, -0.45, "Dec '26", "Nov 2026", null, "2026-11-04T01:41:41Z", ""]],
  towns: [["/cash-bids/iowa/nevada", "Nevada", 42.0228, -93.4527, "2026-11-04T01:41:41Z"],
          ["/cash-bids/iowa/albert-city", "Albert City", 42.7819, -94.9486, "2026-11-04T01:30:00Z"]],
};
const AMES = [42.0379, -93.6003, "Ames", "IA", "Story"];

test("the nearest baked town page, its miles and its time; a table without towns falls back by name, then to the state page", () => {
  const t = BF.pick(IA, AMES);
  assert.deepEqual(t, { path: "/cash-bids/iowa/nevada", name: "Nevada", st: "IA", mi: 8, latest: "2026-11-04T01:41:41Z" });
  const h = BF.html(t);
  assert.match(h, /<a href="\/cash-bids\/iowa\/nevada">the Nevada, IA bids page<\/a>, 8 mi away, as of Nov 3, 7:41 PM CT\./);
  assert.equal(BF.pick({ ...IA, towns: [] }, [42.0228, -93.4527, "Nevada", "IA", "Story"]).path, "/cash-bids/iowa/nevada");
  const st = BF.pick({ ...IA, towns: [], rows: [] }, AMES);
  assert.equal(st.path, "/cash-bids/iowa/");
  assert.match(BF.html(st), /the Iowa cash bids page/);
  assert.equal(BF.pick({ ...IA, towns: [["/cash-bids/iowa/far", "Far", 40.0, -96.0, "x"]], rows: [] }, AMES).path, "/cash-bids/iowa/", "past 60 mi is not near");
  assert.equal(BF.pick(null, AMES), null);
});

test("the GA event goes once per page and reason, and carries no place", () => {
  const sent = [];
  const A = BF.bind({ gtag: (...a) => sent.push(a), fetch: () => Promise.reject(new Error("x")) });
  assert.equal(A.count("home", "slow"), true);
  assert.equal(A.count("home", "slow"), false);
  A.count("home", "failed");
  assert.deepEqual(sent, [["event", "bids_net_fallback", { page: "home", why: "slow" }], ["event", "bids_net_fallback", { page: "home", why: "failed" }]]);
});

test("a bid row from the short list names it and never says Best of N within 50 mi; none on it is withheld, not 'no bid within 50 mi'", () => {
  const o = { best: { price: 4.28, mi: 48 }, nearest: { price: 4.2, mi: 20 }, n: 4 };
  const full = P.factBid(o, "corn", "Nevada", "2026-11-04T01:00:00Z", "/cash-bids");
  assert.match(full.ctx, /Best of 4 within 50 mi/);
  const part = P.factBid(o, "corn", "Nevada", "2026-11-04T01:00:00Z", "/cash-bids", true);
  assert.doesNotMatch(part.ctx, /Best of|within 50 mi|Nearest:/);
  assert.match(part.ctx, /short list of bids the price pages use; the full elevator network was too slow to read this time/);
  assert.equal(part.value, "$4.28");
  const none = P.factBid(null, "corn", "Nevada", "", "/cash-bids", true);
  assert.equal(none.value, null);
  assert.match(none.why, /did not answer in time/);
  assert.doesNotMatch(none.why, /no posted corn bid within/);
});

test("the builder writes the towns; home, /cash-bids, Fast Facts and the Atlas county script use the one path", () => {
  assert.match(read("scripts/build_cash_bid_pages.py"), /"towns": \[\[m\["path"\], m\["name"\], m\["ll"\]\[0\], m\["ll"\]\[1\], iso_z\(m\["latest"\]\)\]/);
  assert.match(read("components/bids-homepage.js"), /AgBidsFallback\.line\(area\.querySelector\('\.bh-baked'\), zip, 'home'/);
  assert.match(read("components/cash-bids.js"), /AgBidsFallback\.line\(bk,zip,'cash-bids','failed'\)/);
  assert.match(read("components/here.js"), /AgBidsFallback\.count\('fast-facts'/);
  assert.match(read("components/county-home.js"), /AgBidsFallback\.count\('atlas-county'/);
  assert.match(read("index.html"), /bids-fallback\.js\?v=1" defer><\/script>\n<script src="\/components\/bids-homepage\.js\?v=46"/);
  assert.match(read("cash-bids.html"), /bids-fallback\.js\?v=1"><\/script><script src="\/components\/cash-bids\.js\?v=20"/);
  assert.match(read("fast-facts.html"), /bids-fallback\.js\?v=1/);
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    else if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
const WX = JSON.stringify({ lat: 42.0379, lon: -93.6003, label: "Ames, IA", zip: "50010", state: "IA", county: "Story", zipTyped: true, ts: 1 });
async function open(browser, items) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());     // the bids network, NWS, the worker: all "down"
  await ctx.route(/\/data\/state-basis\/IA\.json/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(IA) }));
  await ctx.addInitScript((it) => { try { for (const k in it) localStorage.setItem(k, it[k]); } catch (e) {} }, items);
  return [ctx, await ctx.newPage()];
}
const events = (pg) => pg.evaluate(() => (window.dataLayer || []).filter((a) => a && a[0] === "event" && a[1] === "bids_net_fallback").map((a) => a[2]));

test("home at 390, network down: the bids card links the nearest baked town page with its time, and counts it", { skip }, async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const [ctx, pg] = await open(browser, { "agsist-wx-loc": WX, agsist_zip: "50010" });
    await pg.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: "domcontentloaded" });
    await pg.waitForFunction(() => { const e = document.querySelector(".bh-baked"); return e && !e.hidden && /as of/.test(e.textContent); }, null, { timeout: 30000 });
    const a = await pg.$eval(".bh-baked a", (x) => [x.getAttribute("href"), x.textContent]);
    assert.deepEqual(a, ["/cash-bids/iowa/nevada", "the Nevada, IA bids page"]);
    assert.match(await pg.textContent(".bh-baked"), /8 mi away, as of Nov 3, 7:41 PM CT/);
    const ev = await events(pg);
    assert.ok(ev.length >= 1 && ev.every((e) => e.page === "home" && /^(slow|failed)$/.test(e.why) && Object.keys(e).length === 2), JSON.stringify(ev));
    if (SHOTS) { await pg.locator(".bh-err").scrollIntoViewIfNeeded(); await pg.locator(".bh-err").screenshot({ path: join(SHOTS, "home-bids-down-390.png") }); }
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("/cash-bids at 390, network down: the error links the nearest baked town page, not only Retry", { skip }, async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const [ctx, pg] = await open(browser, {});
    await pg.goto(`http://127.0.0.1:${srv.address().port}/cash-bids?zip=50010`, { waitUntil: "domcontentloaded" });
    await pg.waitForFunction(() => { const e = document.querySelector(".cb-baked"); return e && !e.hidden && /as of/.test(e.textContent); }, null, { timeout: 30000 });
    assert.equal(await pg.$eval(".cb-baked a", (x) => x.getAttribute("href")), "/cash-bids/iowa/nevada");
    assert.deepEqual((await events(pg)).map((e) => e.page), ["cash-bids"]);
    if (SHOTS) await pg.locator(".cb-empty").screenshot({ path: join(SHOTS, "cash-bids-down-390.png") });
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("Atlas county page and Fast Facts at 390, network down: no 'Best of N within 50 mi'; the short list is named or the row withheld", { skip }, async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [path, sel, page] of [["/farmland-atlas/iowa/story-county", '[data-k="corn-bid"]', "atlas-county"], ["/fast-facts?zip=50010", "#f-corn-bid", "fast-facts"]]) {
      const [ctx, pg] = await open(browser, { "agsist-wx-loc": WX, agsist_zip: "50010" });
      await pg.goto(`http://127.0.0.1:${srv.address().port}${path}`, { waitUntil: "domcontentloaded" });
      await pg.waitForFunction((s) => { const e = document.querySelector(s); return e && /short list|did not answer in time/.test(e.textContent); }, sel, { timeout: 30000 });
      const txt = await pg.evaluate(() => document.body.innerText);
      assert.doesNotMatch(txt, /Best of \d+ within 50 mi/, path);
      await pg.waitForFunction(() => (window.dataLayer || []).some((a) => a && a[0] === "event" && a[1] === "bids_net_fallback"), null, { timeout: 10000 });
      assert.deepEqual([...new Set((await events(pg)).map((e) => e.page))], [page]);
      if (SHOTS && page === "atlas-county") { await pg.locator(sel).first().scrollIntoViewIfNeeded(); await pg.screenshot({ path: join(SHOTS, "atlas-bids-down-390.png") }); }
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
