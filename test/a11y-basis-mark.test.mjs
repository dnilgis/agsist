/* /cash-bids basis tone is not color alone (a11y audit 2026-10-19, item 1).
 *
 * ZIP 50601 showed "-40c" in red next to another "-40c" in grey with nothing
 * else to tell them apart. In light theme the page's green #2e7d4f and red
 * #c0492f are the same lightness (1.02:1), so a red-green colorblind reader
 * saw no difference, and a screen reader heard nothing at all.
 *
 * Two writers paint a toned basis: the bid rows (renderResults, .bid-basis)
 * and the Best cards (renderBestBids, .bbc-basis). Both now carry an arrow
 * (aria-hidden) and the words in .sr-only. This opens the real page on a
 * fixture of boards around one ZIP and reads every toned basis it drew.
 *
 *   node --test test/a11y-basis-mark.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const JS = readFileSync(ROOT + "components/cash-bids.js", "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("both basis writers call basisMark with the same tone they color by", () => {
  assert.match(JS, /function basisMark\(cls\)\{/);
  const rows = JS.match(/<span class="bid-basis '\+\(\(!perTon&&_tone&&_tone\(bid\)\)\|\|bf\.cls\)\+'">'\+bf\.str\+basisMark\(!perTon&&_tone&&_tone\(bid\)\)\+'<\/span>'/g) || [];
  assert.equal(rows.length, 1, "the bid row writes its arrow from the row tone");
  const best = JS.match(/bbc-basis '\+\(\(_btone&&_btone\(best\)\)\|\|'flat'\)\+'">basis '\+bf\.str\+basisMark\(_btone&&_btone\(best\)\)/g) || [];
  assert.equal(best.length, 1, "the Best card writes its arrow from the card tone");
  /* no third writer of a toned basis that skips the mark */
  const writers = JS.match(/class="(bid|bbc)-basis /g) || [];
  assert.equal(writers.length, 2, `expected 2 basis writers in cash-bids.js, found ${writers.length}`);
});

/* ---------- fixture: 14 boards around Waterloo IA, corn only ---------- */
const ZIP = "50601", LAT = 42.4928, LON = -92.3426;
function fixture() {
  const month = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).slice(0, 7);
  const pricedAt = new Date(Date.now() - 60e3).toISOString(), checkedAt = new Date().toISOString();
  const places = [], shards = {};
  /* basis in cents: a spread so some boards sit above, near and below the middle */
  const basis = [-40, -40, -25, -55, -38, -41, -30, -50, -40, -20, -60, -39, -45, -35];
  basis.forEach((bc, i) => {
    const d = 4 + i * 2, ang = (i * 137.5) * Math.PI / 180;
    const lat = LAT + (d / 69.0) * Math.cos(ang);
    const lon = LON + (d / (69.17 * Math.cos(LAT * Math.PI / 180))) * Math.sin(ang);
    const name = `Test Elevator ${i + 1}`, city = `Town${i + 1}`, place = `${name}||${city}|IA`, shard = `merged/t-${i + 1}.json`;
    const cash = Math.round((4.70 + bc / 100) * 100) / 100;
    const bid = { place, operator: name, branch: null, city, state: "IA", zip: "", town: null, lat, lon, currency: "USD", country: "US",
      commodity: "Corn", crop: "corn", delivery: month, period: month, periodPast: false, cash, basis: bc / 100, basisCents: bc,
      futuresMonth: "ZCZ26", mappable: true, via: "scrape", sourceStatus: "ok", stale: false, pricedAt, checkedAt };
    const now = { corn: { cash, basis: bc / 100, basisCents: bc, period: month, commodity: "Corn", delivery: month } };
    places.push({ place, shard, operator: name, branch: null, city, town: null, state: "IA", lat, lon, mappable: true, via: "scrape",
      source: `t-${i + 1}`, currency: "USD", zip: "", crops: ["corn"], best: now, now, pricedAt, checkedAt });
    shards[shard] = { schema: "agsist-merged-place/1", place, operator: name, branch: null, phone: "", city, town: null, state: "IA", lat, lon, pricedAt, checkedAt, bids: [bid] };
  });
  return { index: { schema: "test", generated: checkedAt, counts: { places: places.length }, places }, zips: { [ZIP]: [LAT, LON] }, shards };
}
const FX = fixture();
const bidsFile = (p) => p === "data/merged-index.json" ? FX.index : p === "data/zips/50.json" ? FX.zips
  : p.startsWith("data/") && FX.shards[p.slice(5)] ? FX.shards[p.slice(5)] : null;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html"; else if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, port, theme, width) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 }, timezoneId: "America/Chicago" });
  await ctx.addInitScript((t) => { try { localStorage.setItem("agsist-theme", t); } catch (e) {} }, theme);
  await ctx.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.host === `127.0.0.1:${port}`) return r.continue();
    const J = (b) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(b) });
    if (u.hostname === "dnilgis.github.io" && u.pathname.startsWith("/bids/")) {
      const j = bidsFile(u.pathname.slice(6));
      return r.fulfill({ status: j ? 200 : 404, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: j ? JSON.stringify(j) : "{}" });
    }
    if (u.hostname === "geocoding-api.open-meteo.com")
      return J({ results: [{ name: "Waterloo", latitude: LAT, longitude: LON, admin1: "Iowa", admin2: "Black Hawk", postcodes: [ZIP], country_code: "US" }] });
    if (u.hostname === "nominatim.openstreetmap.org")
      return u.pathname.includes("search") ? J([{ lat: String(LAT), lon: String(LON), display_name: `Waterloo, Iowa, ${ZIP}, United States` }])
        : J({ address: { city: "Waterloo", state: "Iowa", postcode: ZIP } });
    return r.abort();
  });
  const pg = await ctx.newPage();
  await pg.goto(`http://127.0.0.1:${port}/cash-bids?zip=${ZIP}`);
  await pg.waitForFunction(() => document.querySelectorAll(".bid-basis.bz-up, .bid-basis.bz-dn").length >= 4, null, { timeout: 30000 });
  return { ctx, pg };
}
const readBasis = (pg) => pg.evaluate(() => [...document.querySelectorAll(".bid-basis, .bbc-basis")].map((el) => {
  const mk = el.querySelector(".bz-mk"), sr = el.querySelector(".sr-only");
  const r = el.getBoundingClientRect(), row = el.parentElement.getBoundingClientRect();
  return { cls: el.className, text: el.textContent, mk: mk && mk.textContent, mkHidden: mk && mk.getAttribute("aria-hidden"),
    sr: sr && sr.textContent, srW: sr && sr.getBoundingClientRect().width, color: getComputedStyle(el).color,
    inRow: r.right <= row.right + 0.5 && r.left >= row.left - 0.5 };
}));

test("every toned basis on the real page carries an arrow and the words, in both writers", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { ctx, pg } = await open(browser, port, "light", 390);
    const all = await readBasis(pg);
    const up = all.filter((b) => /\bbz-up\b/.test(b.cls)), dn = all.filter((b) => /\bbz-dn\b/.test(b.cls));
    const mid = all.filter((b) => !/\bbz-(up|dn)\b/.test(b.cls));
    assert.ok(up.length >= 2 && dn.length >= 2 && mid.length >= 1, `fixture should tone both ways: ${up.length} up, ${dn.length} down, ${mid.length} grey`);
    assert.ok(all.some((b) => /bbc-basis/.test(b.cls) && /bz-up/.test(b.cls)), "the Best card's basis is toned and checked too");
    for (const b of up) {
      assert.equal(b.mk, "▲", `stronger basis ${b.text} has an up arrow`);
      assert.equal(b.mkHidden, "true");
      assert.equal(b.sr, " stronger than the middle of this search");
      assert.ok(b.srW <= 1, "the words are for screen readers, not drawn");
    }
    for (const b of dn) {
      assert.equal(b.mk, "▼", `weaker basis ${b.text} has a down arrow`);
      assert.equal(b.sr, " weaker than the middle of this search");
    }
    for (const b of mid) assert.equal(b.mk, null, `a grey basis ${b.text} has no arrow`);
    /* light theme: the row red is not the page's red, which matched the green's lightness */
    const rowUp = up.find((b) => /bid-basis/.test(b.cls)), rowDn = dn.find((b) => /bid-basis/.test(b.cls));
    assert.equal(rowDn.color, "rgb(168, 54, 31)", "light .bid-basis.bz-dn is #a8361f, like the Best card and the key");
    assert.notEqual(rowUp.color, rowDn.color);
    await ctx.close();
    /* the narrowest phone: the arrow stays inside the row */
    const n = await open(browser, port, "dark", 320);
    for (const b of (await readBasis(n.pg)).filter((b) => /bid-basis/.test(b.cls))) assert.ok(b.inRow, `basis ${b.text} spills out of its row at 320`);
    await n.ctx.close();
  } finally { await browser.close(); srv.close(); }
});
