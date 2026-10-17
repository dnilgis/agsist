/* The homepage bid card and /cash-bids name the same best bid for one ZIP.
 *
 * Oct 17, 2026, ZIP 50010 (Ames IA): the homepage said "Top soybean bid within
 * 50 mi $12.21 1/4, ADM Des Moines, 28 mi" while /cash-bids said "Best
 * soybeans $12.26, AGP Eagle, 46 mi". The data was the same. Ames has 87
 * places inside 50 miles and components/bids-network.js kept only the nearest
 * 40, which stops near 36 miles; /cash-bids already kept the top bids per crop
 * first (netRankPlaces). The fix gives bids-network.js the same rule.
 *
 * The fixture below is built here, not copied: 90 boards around one point,
 * the best soybean bid at 46 miles (the 80th nearest), the best corn bid at
 * 22 miles. The node checks run the shipped functions; the browser check
 * opens both real pages on the same fixture and compares what they print.
 *
 *   node --test test/home-cashbids-agree.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

/* ---------- the fixture ---------- */
const ZIP = "50010", LAT = 42.0347, LON = -93.62;
const ctMonth = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).slice(0, 7);
function fixture() {
  const month = ctMonth();
  const pricedAt = new Date(Date.now() - 60e3).toISOString();
  const checkedAt = new Date().toISOString();
  const places = [], shards = {};
  for (let i = 0; i < 90; i++) {
    const d = 5 + i * 0.5;                       // 5.0 .. 49.5 mi, nearest first
    const ang = (i * 137.5) * Math.PI / 180;
    const lat = LAT + (d / 69.0) * Math.cos(ang);
    const lon = LON + (d / (69.17 * Math.cos(LAT * Math.PI / 180))) * Math.sin(ang);
    let soy = 11.85 + ((i * 7) % 30) / 100;      // 11.85 .. 12.14
    let corn = 4.20 + ((i * 11) % 25) / 100;     // 4.20 .. 4.44
    let name = `Test Co-op ${String(i + 1).padStart(2, "0")}`;
    if (i === 46) { soy = 12.21; name = "Near Soy Co-op"; }        // 28 mi
    if (i === 82) { soy = 12.26; name = "Far Soy Co-op"; }         // 46 mi
    if (i === 34) { corn = 4.59; name = "Corn Best Co-op"; }       // 22 mi
    const city = `Town${i + 1}`, place = `${name}||${city}|IA`;
    const shard = `merged/test-${i + 1}.json`;
    const row = (crop, cash, fut, sym) => ({
      place, operator: name, branch: null, city, state: "IA", zip: "", town: null, lat, lon,
      currency: "USD", country: "US", commodity: crop === "corn" ? "Corn" : "Soybeans", crop,
      delivery: month, period: month, periodPast: false, cash: Math.round(cash * 100) / 100,
      basis: Math.round((cash - fut) * 100) / 100, basisCents: Math.round((cash - fut) * 100),
      futuresMonth: sym, mappable: true, via: "scrape", sourceStatus: "ok", stale: false,
      pricedAt, checkedAt
    });
    const bids = [row("corn", corn, 4.70, "ZCZ26"), row("soybeans", soy, 12.61, "ZSX26")];
    const now = {};
    for (const b of bids) now[b.crop] = { cash: b.cash, basis: b.basis, basisCents: b.basisCents, period: b.period, commodity: b.commodity, delivery: b.delivery };
    places.push({ place, shard, operator: name, branch: null, city, town: null, state: "IA", lat, lon, mappable: true, via: "scrape",
      source: `test-${i + 1}`, currency: "USD", zip: "", crops: ["corn", "soybeans"], best: now, now, pricedAt, checkedAt });
    shards[shard] = { schema: "agsist-merged-place/1", place, operator: name, branch: null, phone: "", city, town: null, state: "IA",
      lat, lon, pricedAt, checkedAt, bids };
  }
  return {
    index: { schema: "test", generated: checkedAt, counts: { places: places.length }, places },
    zips: { [ZIP]: [LAT, LON] },
    shards
  };
}
const FX = fixture();
function bidsFile(path) {
  if (path === "data/merged-index.json") return FX.index;
  if (path === "data/zips/50.json") return FX.zips;
  if (path.startsWith("data/") && FX.shards[path.slice(5)]) return FX.shards[path.slice(5)];
  return null;
}

/* ---------- node: the shipped selection code ---------- */
function loadNet() {
  const win = { location: { search: "" }, dispatchEvent() {} };
  const ctx = {
    window: win, CustomEvent: class {}, setTimeout, clearTimeout, console,
    fetch: async (u) => { const j = bidsFile(String(u).replace(/^https:\/\/dnilgis\.github\.io\/bids\//, "")); return { ok: !!j, json: async () => j }; }
  };
  vm.runInNewContext(read("components/bids-network.js"), ctx);
  return win.AGSIST_BIDS_NET;
}
function lift(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  let depth = 0, seen = false;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") { depth++; seen = true; }
    else if (src[i] === "}") { depth--; if (seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`function ${name} never closes`);
}
/* The homepage's own options, read from its source, so the test asks for what the card asks for. */
function homeOpts() {
  const m = /NET\.snapshotForZip\(zip, (\{[^}]*\})\)/.exec(read("components/bids-homepage.js"));
  assert.ok(m, "bids-homepage.js no longer calls NET.snapshotForZip(zip, {...})");
  return Function(`return (${m[1]});`)();
}
function cashBidsPlaces() {
  const cb = read("components/cash-bids.js");
  const v = (n) => new RegExp(`var ${n}=[^;]*;`).exec(cb)[0];
  const f = Function([v("NET_MAX_PLACES"), v("NET_TOP_PER_CROP"), lift(cb, "netDistanceMi"), lift(cb, "netRankPlaces"), lift(cb, "netPlacesWithin"),
    "return {netPlacesWithin, NET_MAX_PLACES};"].join("\n"))();
  return f.netPlacesWithin(FX.index, [LAT, LON], 50, f.NET_MAX_PLACES);
}
const topNow = (list, crop, get) => list.slice().sort((a, b) => get(b, crop) - get(a, crop) || 0)[0];

test("the far best soybean bid is past the 40 nearest, so the fixture tests the bug", () => {
  const order = FX.index.places.map((p, i) => [i, p.now.soybeans.cash]).sort((a, b) => b[1] - a[1]);
  assert.equal(order[0][0], 82, "the best soybean bid is the 83rd nearest place");
});

test("homepage snapshot and /cash-bids place list hold the same best bid per crop", async () => {
  const NET = loadNet();
  const snap = await NET.snapshotForZip(ZIP, homeOpts());
  assert.ok(snap && snap.bids.length, "no snapshot");
  const cbp = cashBidsPlaces();
  for (const crop of ["corn", "soybeans"]) {
    const home = snap.bids.filter((b) => b.crop === crop).sort((a, b) => b.cashPrice - a.cashPrice || a.distance - b.distance)[0];
    const cbTop = cbp.filter((p) => p.now && p.now[crop]).sort((a, b) => b.now[crop].cash - a.now[crop].cash || a.distance - b.distance)[0];
    assert.equal(home.facility, cbTop.operator, `${crop}: homepage pool tops out at ${home.facility}, /cash-bids at ${cbTop.operator}`);
    assert.equal(home.cashPrice, cbTop.now[crop].cash, crop);
  }
  assert.equal(snap.bids.filter((b) => b.crop === "soybeans").sort((a, b) => b.cashPrice - a.cashPrice)[0].facility, "Far Soy Co-op");
  assert.equal(snap.nearestMiles, 5, "the nearest place is still the anchor");
});

test("pickPlaces keeps the nearest place and is a no-op under the cap", () => {
  const NET = loadNet();
  const list = Array.from({ length: 10 }, (_, i) => ({ p: { now: { corn: { cash: i } } }, d: i }));
  assert.equal(NET.pickPlaces(list, 20).length, 10);
  const two = NET.pickPlaces(list, 2);
  assert.deepEqual(Array.from(two, (x) => x.d), [0, 9], "nearest kept, then the top bid");
});

/* ---------- browser: both real pages, same fixture ---------- */
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
async function routed(browser, port) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, timezoneId: "America/Chicago" });
  await ctx.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.host === `127.0.0.1:${port}`) return r.continue();
    if (u.hostname === "dnilgis.github.io" && u.pathname.startsWith("/bids/")) {
      const j = bidsFile(u.pathname.slice(6));
      return r.fulfill({ status: j ? 200 : 404, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: j ? JSON.stringify(j) : "{}" });
    }
    /* The ZIP's town name, as the geocoders would give it (stand-ins; the sandbox has no outside network). */
    const J = (b) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(b) });
    if (u.hostname === "geocoding-api.open-meteo.com")
      return J({ results: [{ name: "Ames", latitude: LAT, longitude: LON, admin1: "Iowa", admin2: "Story", postcodes: [ZIP], country_code: "US" }] });
    if (u.hostname === "nominatim.openstreetmap.org")
      return u.pathname.includes("search")
        ? J([{ lat: String(LAT), lon: String(LON), display_name: `Ames, Story County, Iowa, ${ZIP}, United States` }])
        : J({ address: { city: "Ames", county: "Story County", state: "Iowa", postcode: ZIP } });
    if (u.hostname === "agsist.com") return r.continue({ url: `http://127.0.0.1:${port}${u.pathname}${u.search}` }).catch(() => r.abort());
    return r.abort();
  });
  return ctx;
}

test("at 390, the homepage hero and the /cash-bids Best card name the same elevator and price", { skip, timeout: 90000 }, async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await routed(browser, port);
    const home = await ctx.newPage();
    await home.goto(`http://127.0.0.1:${port}/`);
    await home.fill('input[placeholder="ZIP code"]', ZIP);
    await home.getByRole("button", { name: "Show bids" }).first().click();
    try { await home.waitForFunction(() => window.__agsistBidsTop && window.__agsistBidsTop.soybeans && window.__agsistBidsTop.corn, null, { timeout: 30000 }); }
    catch (e) { throw new Error("homepage never published both crops: " + JSON.stringify(await home.evaluate(() => [window.__agsistBidsTop, (document.getElementById("bids-list-area") || {}).innerText]))); }
    const top = await home.evaluate(() => window.__agsistBidsTop);

    const cb = await ctx.newPage();
    await cb.goto(`http://127.0.0.1:${port}/cash-bids?zip=${ZIP}`);
    await cb.waitForFunction(() => document.querySelectorAll(".best-bid-card.has-bid").length >= 2, null, { timeout: 30000 });
    const cards = await cb.evaluate(() => [...document.querySelectorAll(".best-bid-card.has-bid")].map((c) => ({ label: c.getAttribute("aria-label"), price: (c.querySelector(".bbc-price") || {}).textContent })));
    for (const [crop, word] of [["soybeans", "Soybeans"], ["corn", "Corn"]]) {
      const card = cards.find((c) => new RegExp(`^Best ${word}`, "i").test(c.label));
      assert.ok(card, `no Best ${word} card: ${JSON.stringify(cards)}`);
      assert.ok(card.label.endsWith(" at " + top[crop].name), `${crop}: homepage ${top[crop].name}, /cash-bids "${card.label}"`);
      assert.equal(Number(String(card.price).replace(/[^\d.]/g, "")), top[crop].cash, `${crop} price`);
    }
    assert.equal(top.soybeans.name, "Far Soy Co-op");
    assert.equal(top.corn.name, "Corn Best Co-op");
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
