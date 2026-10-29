/* /field-scout, Oct 29, 2026: our own data first, and a field read that does not hang on one
 * outside service.
 *
 *   1. County from our own boundaries (the Atlas's counties.geo.json), Nominatim only when that
 *      file does not load or the point is in no county. The six county cards (rent, parcel and
 *      sales, the county record, selling, who farms, statewide) render with EVERY outside host
 *      blocked, at 390 and 1280, in Illinois and Wisconsin.
 *   2. Rain from the county gauge (data/rain), drought from our USDM county file, bids from our
 *      own network measured from the field point (its committed copy when the live read fails).
 *      No Barchart proxy, no Open-Meteo (its free tier excludes sites with ads; Sig, Oct 29: no
 *      paid key), weather now from the National Weather Service.
 *   3. First screen: county name, last year's crop, rain vs normal, nearest bid with miles.
 *      NDRE is labelled red-edge, not nitrogen. The hail card's contact is one quiet line.
 *
 *   node --test test/field-scout-local-first.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "field-scout.html", "utf8");
const CORE = readFileSync(ROOT + "field-scout.js", "utf8");
const READ = readFileSync(ROOT + "field-scout-read.js", "utf8");
const EXTRAS = readFileSync(ROOT + "field-scout-extras.js", "utf8");
const JS = [CORE, READ, EXTRAS].join("\n");
const json = (p) => JSON.parse(readFileSync(ROOT + p, "utf8"));
function block(src, begin, end) {
  const i = src.indexOf(begin), j = src.indexOf(end, i);
  assert.ok(i >= 0 && j > i, "block " + begin);
  return src.slice(i, j);
}

test("no Open-Meteo, no Barchart proxy, no Esri or CARTO anywhere in Field Scout's code", () => {
  for (const f of ["field-scout.js", "field-scout-read.js", "field-scout-extras.js", "field-scout-land.js", "field-scout-layers.js", "field-scout-backup.js", "field-scout.html"]) {
    const t = readFileSync(ROOT + f, "utf8");
    assert.doesNotMatch(t, /open-meteo\.com/i, f);
    assert.doesNotMatch(t, /agsist-barchart|getGrainBids|BIDS_PROXY/, f);
    assert.doesNotMatch(t, /arcgisonline|cartocdn/, f);
  }
  assert.match(READ, /https:\/\/api\.weather\.gov/);
  assert.match(READ, /https:\/\/data\.rcc-acis\.org\/GridData/);
  assert.match(READ, /getJSON\('\/data\/rain\/'\+st\+'\.json'\)/);
  assert.match(READ, /getJSON\('\/data\/drought\/county-week\.json', 20000\)/);
  assert.match(READ, /NET\.snapshot\(c\.lat, c\.lng/);
  assert.match(READ, /getJSON\('\/data\/bids\.json', 20000\)/);
});

test("the county comes from our boundaries first; Nominatim only as the fallback", () => {
  const lc = block(READ, "  function loadCounty(c){", "  function countyByNominatim(");
  assert.match(lc, /fipsByPoint\(c, null\)/);
  assert.doesNotMatch(lc, /geoRev\(/, "no reverse geocode on the first path");
  assert.match(lc, /countyByNominatim\(c, gen\)/);
  // nothing else in a field read asks Nominatim (the bids card no longer needs a ZIP)
  const calls = (READ.match(/(?<!function )geoRev\(c/g) || []).length;
  assert.equal(calls, 1, "one reverse geocode call site, the fallback");
  assert.match(READ, /getJSON\('\/data\/atlas\/counties\.geo\.json', 30000\)/);
});

test("7-day gauge rain: the last seven reported days, trace as zero, withheld with two missing", () => {
  const unpack = block(READ, "  function unpackDays(str){", "  // FS-WEEKRAIN-BEGIN");
  const wr = new Function(unpack + block(READ, "  // FS-WEEKRAIN-BEGIN", "  // FS-WEEKRAIN-END") + "; return weekRain;")();
  // Jan 1-10: 0.10, then T, then six days 0.20,0,0,0.05,M,0
  const r = wr("10,T,0*2,20,0*3,5,M,0", 2026);
  assert.equal(r.inches, 0.25);
  assert.equal(r.through, "2026-01-11");
  assert.equal(r.missing, 1);
  assert.equal(wr("0*5,M,M", 2026), null, "two missing days: no number");
  assert.equal(wr("10,20", 2026), null, "under a week of days: no number");
});

test("county drought from our USDM file: worst category over half the county, None only when the map says so", () => {
  const f = new Function(block(READ, "  // FS-DROUGHTCOUNTY-BEGIN", "  // FS-DROUGHTCOUNTY-END") + "; return droughtFromCounty;")();
  const d = { valid: "2026-10-20", c: { "17019": [[64, 30, 0, 0, 0], [60, 20, 0, 0, 0], [0, 0, 0, 0, 0]], "17001": [[100, 80, 51, 0, 0], [], []] }, zero: ["17031"] };
  assert.deepEqual(f(d, "17019"), { lvl: 0, share: 64, d0: 64, wk: "2026-10-20" });
  assert.equal(f(d, "17001").lvl, 2);
  assert.equal(f(d, "17031").lvl, -1, "a county listed with no drought in 53 maps is None");
  assert.equal(f(d, "99999"), null, "a county not in the file is unknown, never None");
  // the real file has the shape this reads
  const real = json("data/drought/county-week.json");
  assert.ok(real.valid && real.c && Object.keys(real.c).length > 2000);
});

test("first screen: last year's crop, rain vs normal, nearest bid with miles, county name", () => {
  const rv = block(READ, "  function renderVitals(){", "  function renderPeek(k){");
  assert.match(rv, /vCell\(lastY\?lastY\+' CROP':'LAST CROP'/);
  assert.match(rv, /vCell\('RAIN', rainV, rainSub, 'rain'\)/);
  assert.match(rv, /vCell\('NEAREST BID', bidV, bidSub, 'basis'\)/);
  assert.match(rv, /Math\.round\(bid\.dist\)\+' mi'/);
  assert.match(READ, /id="fs-deck-co"/);
  // honest wording kept from Oct 16: a failed bid read is not "none nearby"
  assert.match(rv, /else if\(b\.err\)\{ bidV='-'; bidSub='feed didn\\u2019t answer'; \}/);
});

test("NDRE is labelled red-edge, never 'Nitrogen' on the chip, legend or report", () => {
  assert.match(HTML, /data-god="ndre"[^>]*>[\s\S]*?Red-edge \(NDRE\)<\/button>/);
  assert.doesNotMatch(HTML, /<\/span>Nitrogen<\/button>/);
  assert.match(CORE, /fs-leg-ttl">Red-edge \(NDRE\)</);
  assert.doesNotMatch(JS, /Nitrogen \(NDRE\)|Nitrogen \/ chlorophyll|'NDRE \\u00b7 nitrogen'|Nitrogen signal \(NDRE/);
  assert.match(READ, /not a nitrogen test/);
});

test("the hail card keeps Sig's contact as one quiet line: no button, no arrow, no brand color", () => {
  const i = READ.indexOf("A starting risk read from public data"), seg = READ.slice(i, i + 600);
  assert.match(seg, /<p class="fs-risk-ask" style="margin:\.35rem 0 0;font-size:\.78rem;color:var\(--text-muted\)">Questions about this read: <a href="mailto:sig@agsist\.com" style="color:inherit">sig@agsist\.com<\/a><\/p>/);
  assert.doesNotMatch(seg, /&rarr;|<button|--brand/);
});

test("the page credits every new source where its data shows", () => {
  assert.match(HTML, /USGS National Map/);
  assert.match(HTML, /National Weather Service/);
  assert.match(HTML, /RCC-ACIS/);
  assert.match(HTML, /PRISM/);
  assert.match(READ, /'National Weather Service, '\+esc\(wx\.stn/);
  assert.match(READ, /NOAA daily records via RCC-ACIS/);
  assert.match(READ, /PRISM daily grid via RCC-ACIS, an estimate/);
  assert.match(READ, /AGSIST elevator network/);
  assert.match(CORE, /attribution:USGS_ATTR_SAT/);
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
// a 40-acre square (a quarter-quarter) around a point, as the share link carries it
function hashFor(lat, lng) {
  const d = 402.336 / 2 / 111320, k = 1 / Math.cos(lat * Math.PI / 180);
  return [[lat + d, lng - d * k], [lat + d, lng + d * k], [lat - d, lng + d * k], [lat - d, lng - d * k]].map((p) => p.map((x) => x.toFixed(5)).join(",")).join("~");
}
async function readField(browser, port, width, lat, lng, opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 844 }, isMobile: width < 500, hasTouch: width < 500, timezoneId: "America/Chicago" });
  const pg = await ctx.newPage();
  const errors = [], outside = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === "127.0.0.1") {
      if (opts.blockLocal && opts.blockLocal.some((x) => u.pathname.startsWith(x))) return r.abort();
      return r.continue();
    }
    outside.push(u.host);
    if (opts.nominatim && u.hostname === "nominatim.openstreetmap.org")
      return r.fulfill({ body: JSON.stringify(opts.nominatim), contentType: "application/json", headers: { "access-control-allow-origin": "*" } });
    return r.abort();   // every outside host blocked
  });
  await pg.goto(`http://127.0.0.1:${port}/field-scout#f=${hashFor(lat, lng)}`);
  return { pg, errors, outside, ctx };
}
const text = (pg, id) => pg.evaluate((id) => (document.getElementById(id) || {}).textContent || "", id);
const settled = (pg, id) => pg.waitForFunction((id) => { const e = document.getElementById(id); return e && !e.querySelector(".fs-loading") && e.textContent.trim().length > 0; }, id, { timeout: 30000 });

const FIELDS = [
  { name: "Champaign IL", lat: 40.086, lng: -88.37, county: "Champaign County, Illinois", st: "IL", short: "Champaign County, IL" },
  { name: "Barron WI near Chetek", lat: 45.33, lng: -91.72, county: "Barron County, Wisconsin", st: "WI", short: "Barron County, WI" },
];

for (const F of FIELDS) {
  for (const width of [390, 1280]) {
    test(`${F.name} at ${width}: every outside host blocked, the six county cards still render from our own files`, { skip, timeout: 120000 }, async () => {
      const srv = await serve(), port = srv.address().port;
      const browser = await chromium.launch({ executablePath: CHROME });
      try {
        const { pg, errors, outside } = await readField(browser, port, width, F.lat, F.lng);
        await pg.waitForFunction((c) => ((document.querySelector("#fs-results .coords") || {}).textContent || "").includes(c), F.county, { timeout: 30000 });
        for (const id of ["fs-rent", "fs-land", "fs-atlas", "fs-market", "fs-hood", "fs-cond"]) {
          await settled(pg, id);
          const t = await text(pg, id);
          assert.doesNotMatch(t, /pin down the county|didn.t resolve to a US county|Couldn.t match .* to a county code/, `${id}: ${t.slice(0, 160)}`);
        }
        assert.match(await text(pg, "fs-rent"), /\$\d+/, "rent from data/cash-rent");
        assert.match(await text(pg, "fs-hood"), /rented ground|No census tenure/);
        assert.match(await text(pg, "fs-cond"), /Good|doesn.t rate/);
        // rain from the county gauge, drought from our file, bids from the committed network copy
        await settled(pg, "fs-season");
        assert.match(await text(pg, "fs-season"), /Rain since Jan 1[\s\S]*gauge, \d+ mi from this field[\s\S]*1991-2020 normal/);
        await pg.waitForFunction(() => /US Drought Monitor county statistics, map of/.test((document.getElementById("fs-wx") || {}).textContent || ""), null, { timeout: 30000 });
        assert.match(await text(pg, "fs-wx"), /National Weather Service observations not answering right now/);
        await settled(pg, "fs-bids");
        assert.match(await text(pg, "fs-bids"), /Miles are from the middle of this field\. AGSIST elevator network \(the copy saved/);
        // first screen: county, rain vs normal, nearest bid with miles
        assert.match(await text(pg, "fs-vitals"), /RAIN\S*\s*\d+%of normal since Jan 1/i);
        assert.match(await text(pg, "fs-vitals"), /NEAREST BID[\s\S]*\$\d+\.\d\d[\s\S]*\d+ mi/);
        if (width < 500) assert.match(await text(pg, "fs-peek"), new RegExp(F.short.replace(/ /g, "\\s*")));
        else assert.equal((await text(pg, "fs-deck-co")).trim(), F.short);
        assert.ok(!outside.some((h) => /nominatim|open-meteo|barchart/.test(h)), "never asked: " + [...new Set(outside)].join(", "));
        assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth), width, "no sideways scroll");
        assert.deepEqual(errors, []);
      } finally { await browser.close(); srv.close(); }
    });
  }
}

test("the county boundary file blocked: Nominatim fills in the county, and the cards still render", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors, outside } = await readField(browser, port, 1280, 40.086, -88.37,
      { blockLocal: ["/data/atlas/counties.geo.json"], nominatim: { address: { county: "Champaign County", state: "Illinois", "ISO3166-2-lvl4": "US-IL" } } });
    await pg.waitForFunction(() => /Champaign County, Illinois/.test((document.querySelector("#fs-results .coords") || {}).textContent || ""), null, { timeout: 30000 });
    assert.ok(outside.includes("nominatim.openstreetmap.org"));
    await settled(pg, "fs-rent");
    assert.match(await text(pg, "fs-rent"), /\$\d+/);
    await settled(pg, "fs-hood");
    assert.match(await text(pg, "fs-hood"), /rented ground/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("both the boundary file and Nominatim down: the county cards say what failed, nothing hangs", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await readField(browser, port, 1280, 40.086, -88.37, { blockLocal: ["/data/atlas/counties.geo.json"] });
    await pg.waitForFunction(() => /boundary file did not load and the place lookup did not answer/.test((document.getElementById("fs-rent") || {}).textContent || ""), null, { timeout: 30000 });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
