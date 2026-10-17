/* /field-scout, Oct 16 "to 50" pass.
 *
 *   1. Speed: Leaflet and Leaflet.draw come from agsist.com; the tracing tool loads on the
 *      first Trace tap, and a failed load costs only the trace. One field read takes one
 *      state's tenure/AFIDA slice and the nearby hail cells, not the national files.
 *   2. Accuracy: acres on the WGS84 ellipsoid (a one-mile section reads 640.00), preset
 *      boxes are exact, the CSR2 example is worked by hand, the slices match their sources.
 *   3. Honesty: a failed bid read is not "none nearby"; a five-year average is not "normal";
 *      crop history says how often five points inside the field agree.
 *   4. First screen: a finished read is one tap from the map, and on a phone the bottom
 *      line shows under the map without a scroll.
 *
 * The browser tests need Playwright and Chromium and skip without them. Every outside host
 * (the Field Scout worker, Open-Meteo, Nominatim, map tiles, the bid network) is answered
 * from fixtures below, so nothing here reaches the network.
 *
 *   node --test test/field-scout-to50.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "field-scout.html", "utf8");
// The page script is split (Oct 16, 2026): field-scout.js is the first screen, the read and the
// extras load on demand. Text checks below run over all three, the way the browser ends up with them.
const CORE = readFileSync(ROOT + "field-scout.js", "utf8");
const JS = [CORE, readFileSync(ROOT + "field-scout-read.js", "utf8"), readFileSync(ROOT + "field-scout-extras.js", "utf8")].join("\n");
const CSS = readFileSync(ROOT + "components/field-scout.css", "utf8");
const json = (p) => JSON.parse(readFileSync(ROOT + p, "utf8"));

function block(src, begin, end) {
  const i = src.indexOf(begin), j = src.indexOf(end, i);
  assert.ok(i >= 0 && j > i, "block " + begin);
  return src.slice(i, j);
}
const acresOfRing = new Function(block(JS, "// FS-ACRES-BEGIN", "// FS-ACRES-END") + "; return acresOfRing;")();
const boxRing = new Function(block(JS, "  var BOX_DIMS", "  var ghostPoly") + "; return boxRing;")();

// ── hand references on the WGS84 ellipsoid ─────────────────────────────
const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F);
function squareAt(lat0, ewM, nsM, lng0 = -93) {
  const p = lat0 * Math.PI / 180, w = 1 - E2 * Math.sin(p) ** 2;
  const M = A * (1 - E2) / w ** 1.5, N = A / Math.sqrt(w);           // meridian and prime-vertical radii
  const dLat = nsM / M * 180 / Math.PI, dLng = ewM / (N * Math.cos(p)) * 180 / Math.PI;
  return [[lat0 + dLat / 2, lng0 - dLng / 2], [lat0 + dLat / 2, lng0 + dLng / 2], [lat0 - dLat / 2, lng0 + dLng / 2], [lat0 - dLat / 2, lng0 - dLng / 2]]
    .map(([lat, lng]) => ({ lat, lng }));
}
const MILE = 1609.344;

test("acres: a one-mile section reads 640.00, a quarter-quarter 40.00, a long eighty 80.00", () => {
  for (const [lat, ew, ns, want] of [[41.5, MILE, MILE, 640], [30, MILE, MILE, 640], [47, MILE, MILE, 640],
    [42, MILE / 4, MILE / 4, 40], [38, MILE / 2, MILE / 2, 160], [44.5, MILE / 4, MILE / 2, 80]]) {
    const got = acresOfRing(squareAt(lat, ew, ns));
    assert.ok(Math.abs(got - want) < 0.01, `${want} ac at ${lat} N read ${got.toFixed(3)}`);
  }
  // The old sphere at the equator's radius read 640.46 at 41.5 N: the new number must not.
  assert.ok(Math.abs(acresOfRing(squareAt(41.5, MILE, MILE)) - 640.46) > 0.4);
  // Winding direction does not matter.
  assert.ok(Math.abs(acresOfRing(squareAt(41.5, MILE, MILE).reverse()) - 640) < 0.01);
});

test("acres: the 20/40/80/160 preset boxes are those acres at any latitude", () => {
  for (const lat of [29, 36, 42, 48.5]) {
    for (const ac of [20, 40, 80, 160]) {
      const got = acresOfRing(boxRing(lat, -95, ac).map(([la, ln]) => ({ lat: la, lng: ln })));
      assert.ok(Math.abs(got - ac) < 0.01, `${ac} box at ${lat} read ${got.toFixed(3)}`);
    }
  }
});

test("CSR2 worked example on the page is right, and the code weights by rated acres only", () => {
  assert.equal(Math.round((85 * 80 + 70 * 60) / 140 * 10) / 10, 78.6);
  assert.match(HTML, /\(85 &times; 80 \+ 70 &times; 60\) &divide; 140 = <b>78\.6<\/b>/);
  assert.match(JS, /var csr2 = csrAc>0 && csrAc>=0\.5\*total0 \? Math\.round\(csrSum\/csrAc\*10\)\/10 : null;/);
});

test("Leaflet and Leaflet.draw are served from agsist.com; the tracing tool loads on demand", () => {
  assert.doesNotMatch(HTML, /unpkg\.com|cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet/);
  assert.match(HTML, /<script defer src="\/vendor\/leaflet-1\.9\.4\/leaflet\.js"><\/script>/);
  assert.match(HTML, /href="\/vendor\/leaflet-1\.9\.4\/leaflet\.css"/);
  assert.doesNotMatch(HTML, /leaflet\.draw/, "no Leaflet.draw tag in the page: it loads on the first Trace tap");
  for (const f of ["leaflet.draw.js", "leaflet.draw.css", "LICENSE", "images/spritesheet.png", "images/spritesheet-2x.png", "images/spritesheet.svg"]) {
    assert.ok(existsSync(ROOT + "vendor/leaflet-draw-1.0.4/" + f), f);
  }
  assert.match(readFileSync(ROOT + "vendor/leaflet-draw-1.0.4/leaflet.draw.js", "utf8").slice(0, 200), /Leaflet\.draw 1\.0\.4/);
  assert.match(JS, /DRAW_JS='\/vendor\/leaflet-draw-1\.0\.4\/leaflet\.draw\.js'/);
  assert.doesNotMatch(JS, /showFatal\('The field-drawing tool failed/, "a missing draw tool must not blank the map");
  assert.match(HTML, /href="\/components\/field-scout\.css\?v=\d+"/);
  assert.ok(Buffer.byteLength(HTML) < 60 * 1024, "page HTML stays small (styles live in components/field-scout.css)");
});

test("county slices hold exactly the national tenure and AFIDA records, by state", () => {
  const ten = json("data/tenure/tenure.json"), afi = json("data/afida/county.json");
  const dir = ROOT + "data/field-scout/county/";
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 50, "every state has a file");
  const seenT = {}, seenA = {};
  for (const f of files) {
    const s = json("data/field-scout/county/" + f);
    assert.deepEqual(s.tenure.years, ten.years);
    for (const [k, v] of Object.entries(s.tenure.counties)) { assert.deepEqual(v, ten.counties[k], k); seenT[k] = 1; }
    for (const [k, v] of Object.entries(s.afida)) { assert.deepEqual(v, afi[k], k); seenA[k] = 1; }
  }
  const fipsSt = { "19": "IA", "17": "IL", "20": "KS", "55": "WI", "48": "TX" };
  for (const [pre, st] of Object.entries(fipsSt)) {
    const s = json(`data/field-scout/county/${st}.json`);
    assert.ok(Object.keys(s.tenure.counties).every((k) => k.startsWith(pre)), st);
    assert.ok(Object.keys(s.afida).every((k) => k.startsWith(pre)), st);
  }
  const lost = (o, seen) => Object.keys(o).filter((k) => !seen[k] && /^\d{5}$/.test(k) && !/^(60|66|69|72|78)/.test(k));
  assert.deepEqual(lost(ten.counties, seenT), [], "every tenure county is in a state slice");
  assert.deepEqual(lost(afi, seenA), [], "every AFIDA county is in a state slice");
  assert.match(JS, /getJSON\('\/data\/field-scout\/county\/'\+encodeURIComponent\(abbr\)\+'\.json'\)/);
  assert.doesNotMatch(JS, /\/data\/tenure\/tenure\.json|\/data\/afida\/county\.json/, "a field read never pulls the national files");
});

test("hail cells: every year incl. this one, each report in its own 2-degree cell, totals match the national files", () => {
  const ix = json("data/field-scout/hail/index.json");
  const years = readdirSync(ROOT + "data/hail").map((f) => /^events-(\d{4})\.json$/.exec(f)).filter(Boolean).map((m) => +m[1]).sort();
  assert.deepEqual(ix.years, years, "every year, the current one too, is in the cells (hail-data.yml rebuilds them each run)");
  assert.equal(ix.cell, 2);
  const per = {};
  for (const k of ix.cells) {
    const [la, lo] = k.split("_").map(Number);
    const c = json(`data/field-scout/hail/${k}.json`);
    assert.deepEqual(c.years, ix.years);
    for (const e of c.ev) {
      assert.ok(e[0] >= la && e[0] < la + 2 && e[1] >= lo && e[1] < lo + 2, `${k} holds ${e[0]},${e[1]}`);
      assert.ok(ix.years.includes(e[4]));
      per[e[4]] = (per[e[4]] || 0) + 1;
    }
  }
  // A monthly hail run can add a late report to a closed year; past 2% the cells are stale.
  for (const y of ix.years) {
    const n = json(`data/hail/events-${y}.json`).ev.length;
    assert.ok(Math.abs((per[y] || 0) - n) <= Math.max(5, n * 0.02), `${y}: cells ${per[y]} vs national ${n}; run python3 scripts/build_field_scout_data.py`);
  }
});

test("hail cells near a field cover the whole 40-mile circle", () => {
  const near = new Function(block(JS, "  function _hailCellsNear", "  function _hailFilesNear") + "; return _hailCellsNear;")();
  const R = 3958.8;
  for (const [lat, lng] of [[42.345, -93.39], [41.99, -96.01], [47.9, -97.1], [30.1, -97.9], [48.99, -122.0]]) {
    const cells = new Set(near(lat, lng, 41, 2));
    for (let a = 0; a < 360; a += 10) {
      const t = a * Math.PI / 180, d = 40 / R;
      const p1 = lat * Math.PI / 180, l1 = lng * Math.PI / 180;
      const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
      const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
      const la = p2 * 180 / Math.PI, lo = l2 * 180 / Math.PI;
      const k = `${Math.floor(la / 2) * 2}_${Math.floor(lo / 2) * 2}`;
      assert.ok(cells.has(k), `${lat},${lng}: edge point ${la.toFixed(2)},${lo.toFixed(2)} in ${k}`);
    }
  }
});

test("honest wording: failed bid read, five-year average, no em dashes", () => {
  assert.match(JS, /else if\(b\.err\)\{ bidV='-'; bidSub='feed didn\\u2019t answer'; \}/);
  assert.match(JS, /FIELD\.bids=\{corn:null,bean:null,zip:'',count:0,err:1\}/);
  assert.doesNotMatch(JS, /≈ normal</);
  assert.doesNotMatch(JS, /above normal and GDUs|ahead of a normal year|behind a normal year|tracking close to the normal pace/);
  assert.match(HTML, /it is not a 30-year normal/);
  const visible = HTML.replace(/<!--[\s\S]*?-->/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
  assert.doesNotMatch(visible, /—|&mdash;|&#8212;/);
  const code = JS.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/(^|[^:'"\\])\/\/.*$/, "$1")).join("\n");
  assert.doesNotMatch(code, /—|\\u2014|&mdash;/);
});

test("byline, date and credential", () => {
  assert.match(HTML, /<p class="fs-by">Sigurd Lindquist, CCA, Chetek, Wisconsin &middot; Updated [A-Z][a-z]{2} \d{1,2}, 20\d\d &middot; <a href="#fs-math">How the field math works<\/a><\/p>/);
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(HTML)[1]);
  const app = ld["@graph"].find((g) => g["@type"] === "WebApplication");
  assert.equal(app.author.name, "Sigurd Lindquist");
  assert.equal(app.author.jobTitle, "Certified Crop Adviser (CCA)");
  assert.match(app.dateModified, /^20\d\d-\d\d-\d\d$/);
  assert.match(HTML, /<section class="fs-math" id="fs-math"/);
});

// ── browser ─────────────────────────────────────────────────────────────
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/field-scout") p = "/field-scout.html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64");
const SOIL = { ext: true, Table: [
  ["k", "L138B", "Clarion loam, 2 to 6 percent slopes", "16.2", "2", "4", "0.86", "0.86", "0.80", "Moderately well drained", "88", "All areas are prime farmland", "None", "0", "e"],
  ["k", "L107", "Webster clay loam, 0 to 2 percent slopes", "12.1", "2", "1", "0.82", "0.82", "0.78", "Poorly drained", "86", "Prime farmland if drained", "None", "95", "w"],
  ["k", "L55", "Nicollet loam, 1 to 3 percent slopes", "11.7", "1", "2", "0.88", "0.88", "0.82", "Somewhat poorly drained", "91", "All areas are prime farmland", "None", "3", ""],
] };
function cdlFor(lon) {   // a corn-soybean field whose east side was grass in 2021
  const h = []; for (let y = 2025; y >= 2016; y--) h.push({ year: y, code: (lon > -93.389 && y === 2021) ? 176 : (y % 2 ? 1 : 5) });
  return { rotation: h.slice(0, 5), history: h };
}

async function openPage(browser, port, width, opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 844 }, isMobile: width < 500, hasTouch: width < 500 });
  const pg = await ctx.newPage();
  const errors = [], requests = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  pg.on("request", (r) => requests.push(r.url()));
  if (opts.saved) await pg.addInitScript((s) => { try { localStorage.setItem("agsist-fs-fields", JSON.stringify(s)); } catch (e) {} }, opts.saved);
  await pg.addInitScript((bidsDown) => {
    window.AGSIST_BIDS_NET = bidsDown
      ? { snapshotForZip: () => Promise.reject(new Error("down")), reachable: () => Promise.resolve(false) }
      : { snapshotForZip: () => Promise.resolve({ bids: [{ facility: "Test Co-op", branch: "", town: "Eldora", state: "IA", distance: 6.2, commodity: "Corn", crop: "corn", cashPrice: 3.86, basisCents: -34, period: "2099-12", delivery: "Dec", pricedAt: "2026-10-15T15:00:00Z" }] }), reachable: () => Promise.resolve(true) };
  }, !!opts.bidsDown);
  await pg.route("**/*", (r) => {
    const u = new URL(r.request().url()), h = u.hostname;
    const J = (o) => r.fulfill({ body: JSON.stringify(o), contentType: "application/json", headers: { "access-control-allow-origin": "*" } });
    if (h === "127.0.0.1") return (opts.noDraw && u.pathname.includes("leaflet-draw")) ? r.abort() : r.continue();
    if (h.includes("fieldscout")) {
      if (u.pathname.startsWith("/soil")) return J(SOIL);
      if (u.pathname.startsWith("/cdl")) return J(cdlFor(+u.searchParams.get("lon")));
      if (u.pathname.startsWith("/drought")) return J({ DroughtClass: 0, approx: "county-dominant", mapWeek: "2026-10-13" });
      if (u.pathname.startsWith("/indices")) return J({ series: [] });
      return r.fulfill({ body: PNG, contentType: "image/png" });
    }
    if (h === "api.open-meteo.com") return J({ current: { time: "2026-10-16T14:15", temperature_2m: 54, relative_humidity_2m: 61, precipitation: 0, wind_speed_10m: 9 }, daily: { precipitation_sum: [0, 0.1, 0, 0.4, 0, 0, 0.2, 0] } });
    if (h === "archive-api.open-meteo.com") return J({});
    if (h === "nominatim.openstreetmap.org") return J(u.pathname.includes("reverse") ? { address: { postcode: "50126", county: "Hardin County", state: "Iowa" } } : [{ lat: "42.345", lon: "-93.39" }]);
    if (/arcgisonline|cartocdn/.test(h)) return r.fulfill({ body: PNG, contentType: "image/png" });
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}/field-scout`);
  await pg.waitForFunction(() => document.querySelector("#fs-map.leaflet-container"), null, { timeout: 20000 });
  return { pg, errors, requests, ctx };
}

test("phone: a finished read is one tap from the first screen and its bottom line shows without a scroll", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors, requests } = await openPage(browser, port, 390);
    const btn = await pg.locator("#fs-demo2").boundingBox();
    assert.ok(btn && btn.y + btn.height <= 844, "example button on the first screen");
    assert.ok(!requests.some((u) => /leaflet\.draw|unpkg|cdnjs/.test(u)), "no draw tool or CDN on load");
    await pg.click("#fs-demo2");
    await pg.waitForFunction(() => /Bottom line/.test(document.getElementById("fs-peek").textContent), null, { timeout: 20000 });
    await pg.evaluate(() => window.scrollTo(0, 0));
    const pk = await pg.evaluate(() => { const v = document.querySelector("#fs-peek .fs-peek-v").getBoundingClientRect(); return { top: v.top, bottom: v.bottom }; });
    assert.ok(pk.bottom <= 844, `bottom line ends at ${Math.round(pk.bottom)} px, inside an 844 px screen`);
    assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth), 390, "no sideways scroll");
    // The field read used the small slices, never the national files.
    await pg.waitForFunction(() => /rented ground|No census tenure/.test(document.getElementById("fs-hood").textContent), null, { timeout: 20000 });
    assert.ok(requests.some((u) => u.includes("/data/field-scout/county/IA.json")));
    assert.ok(!requests.some((u) => /\/data\/(tenure\/tenure|afida\/county)\.json/.test(u)));
    const ix = json("data/field-scout/hail/index.json");
    await pg.waitForFunction(() => /Hail reports nearby|hail/i.test(document.getElementById("fs-risk").textContent), null, { timeout: 20000 });
    for (const y of ix.years) assert.ok(!requests.some((u) => u.endsWith(`/data/hail/events-${y}.json`)), `closed year ${y} comes from cells`);
    // Crop history agreement across points inside the outline.
    await pg.waitForFunction(() => /Checked at \d points/.test((document.getElementById("fs-rot-spread") || {}).textContent || ""), null, { timeout: 20000 });
    const spread = await pg.textContent("#fs-rot-spread");
    assert.match(spread, /they agree in 9 of 10 years\. 2021: corn 3, grass\/pasture 2\./);
    // Bids carry the day they were posted; weather and drought carry their read dates.
    await pg.waitForFunction(() => /posted/.test(document.getElementById("fs-bids").textContent), null, { timeout: 20000 });
    assert.match(await pg.textContent("#fs-bids"), /posted Oct 15/);
    assert.match(await pg.textContent("#fs-wx"), /Open-Meteo, now \(2:15 PM local\) · US Drought Monitor, map of Oct 13/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("a failed bid read says so in the readout, not 'none nearby'", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await openPage(browser, port, 1280, { bidsDown: true });
    await pg.click("#fs-demo2");
    // #fs-bids and #fs-vitals exist only once field-scout-read.js has loaded and drawn the deck, which can
    // land after the first poll. A predicate that throws on the missing node ends waitForFunction at once
    // (it does not retry), so the test failed or passed on load order. Read a missing node as empty text.
    const shows = (id, re) => pg.waitForFunction(([id, re]) => new RegExp(re).test((document.getElementById(id) || {}).textContent || ""), [id, re], { timeout: 20000 });
    await shows("fs-bids", "reach the cash-bid feed");
    await shows("fs-vitals", "feed didn.t answer");
    assert.doesNotMatch(await pg.textContent("#fs-vitals"), /none nearby/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("the tracing tool loads on the first Trace tap, and a blocked load leaves the map working", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const noDraw of [false, true]) {
      const { pg, errors, requests, ctx } = await openPage(browser, port, 1280, { noDraw });
      await pg.fill("#fs-addr", "Eldora Iowa"); await pg.click("#fs-addr-go");
      await pg.waitForTimeout(600);
      assert.ok(!requests.some((u) => u.includes("leaflet.draw")), "not loaded before Trace");
      await pg.click("#fs-draw");
      if (!noDraw) {
        await pg.waitForFunction(() => !document.getElementById("fs-tracebar").hidden, null, { timeout: 10000 });
        assert.ok(requests.some((u) => u.endsWith("/vendor/leaflet-draw-1.0.4/leaflet.draw.js")));
      } else {
        await pg.waitForFunction(() => /tracing tool didn.t load/.test(document.getElementById("fs-hint").textContent), null, { timeout: 10000 });
        // the rest of the tool still works: a tap drops a field
        const box = await pg.locator("#fs-map").boundingBox();
        await pg.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await pg.waitForFunction(() => /ac$/.test(document.getElementById("fs-appbar-ctx").textContent), null, { timeout: 10000 });
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("a device with a saved field offers it again on the first screen", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const saved = [{ id: 7, name: "Home 80", pts: [[42.3468, -93.3924], [42.3468, -93.3876], [42.3432, -93.3876], [42.3432, -93.3924]], acres: 39.1 }];
    const { pg, errors } = await openPage(browser, port, 390, { saved });
    assert.equal((await pg.textContent("#fs-last")).trim(), "Open Home 80 again");
    await pg.click("#fs-last");
    await pg.waitForFunction(() => /ac$/.test(document.getElementById("fs-appbar-ctx").textContent), null, { timeout: 10000 });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
