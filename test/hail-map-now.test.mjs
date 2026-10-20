/* /hail-map opens on now (2026-10-20).
 *
 *   Sig: "the hail map should open to current or active storms within the last
 *   24 hours". A bare /hail-map opens on the now view: NWS hail-tagged
 *   warnings in effect, the rolling 24-hour radar hail layer, and ground
 *   reports from the last 24 hours. When none has hail, one plain line says so,
 *   names the latest radar hail day and where, and offers that day and the
 *   5-year map. Every link that names a year, a swath date, a spot or a view
 *   opens exactly that, never now.
 *
 *   A state alone (Oct 20, Sig: "open to the last 24 yes, with the history
 *   readily available for viewers"): ?state=IA, the link on each of the 52
 *   state hail pages, opens on now zoomed to that state, the line says what
 *   happened in that state, and "Iowa: 5 years of hail" sits in the card.
 *   ?view=all&state=IA opens the state's 5-year map.
 *
 *   The live feeds (api.weather.gov, the Iowa Environmental Mesonet) are
 *   fixtures here; the sandbox cannot reach them and a test must not depend on
 *   the weather.
 *
 *   node --test test/hail-map-now.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "hail-map.html", "utf8");
const MESH = JSON.parse(readFileSync(ROOT + "data/hail/mesh/index.json", "utf8"));

function lift(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name + " not found");
  let depth = 0, seen = false;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") { depth++; seen = true; }
    else if (src[i] === "}") { depth--; if (seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(name + " never closes");
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const nowLine = Function("esc", lift(HTML, "plural") + "\n" + lift(HTML, "nowLineState") + "\n" + lift(HTML, "nowLine") + "\nreturn nowLine;")(esc);
const base = { warn: 0, warnStates: "", radar: "fresh", radarN: 0, radarWhere: "", radarAsof: "", pins: 0, pinStates: "",
  latest: { d: "2026-10-13", where: "Texas and Kansas" }, latestDay: "Oct 13, 2026", latestShort: "Oct 13" };
const text = (h) => h.replace(/<[^>]+>/g, "");

test("a quiet day says so in one line, with the latest radar hail day, where, and two buttons", () => {
  const r = nowLine(base);
  assert.equal(r.quiet, true);
  assert.match(text(r.html), /^No hail warnings or radar hail in the last 24 hours\. No ground reports of hail either\. Latest radar hail: Oct 13, 2026, Texas and Kansas\./);
  assert.match(text(r.html), /Ground reports post as spotters call them in/);
  assert.deepEqual(r.acts.map((a) => a[0]), ["day", "all"]);
  assert.equal(r.acts[0][1], "See Oct 13");
  assert.ok(!/—/.test(r.html), "no em dashes");
});

test("never says 'no radar hail' when the radar layer is old or missing", () => {
  const old = nowLine({ ...base, radar: "old", radarAsof: "Oct 19, 7:05 PM" });
  assert.doesNotMatch(old.html, /radar hail in the last 24/);
  assert.match(text(old.html), /^No hail warnings in the last 24 hours\./);
  assert.match(text(old.html), /The radar layer last updated Oct 19, 7:05 PM, so storms since then are not on it yet\./);
  const none = nowLine({ ...base, radar: "none" });
  assert.doesNotMatch(none.html, /radar hail in the last 24/);
  assert.match(text(none.html), /The 24-hour radar layer is not posted right now/);
});

test("a dead warning feed is said, never read as no warnings", () => {
  const r = nowLine({ ...base, warn: "err" });
  assert.doesNotMatch(r.html, /No hail warnings/);
  assert.match(text(r.html), /^No radar hail in the last 24 hours\./);
  assert.match(r.html, /The NWS warning feed did not answer/);
  const p = nowLine({ ...base, pins: "err" });
  assert.doesNotMatch(p.html, /No ground reports/);
  assert.match(p.html, /Ground reports did not load/);
});

test("active storms lead with what is happening and offer the zoom", () => {
  const r = nowLine({ ...base, warn: 2, warnStates: "Kansas, Oklahoma", radarN: 3, radarWhere: "Kansas", pins: 1, pinStates: "Kansas" });
  assert.equal(r.quiet, false);
  assert.equal(text(r.html), "Last 24 hours: 2 hail warnings in effect now (Kansas, Oklahoma); radar hail in Kansas; 1 ground report of hail in Kansas.");
  assert.deepEqual(r.acts.map((a) => a[0]), ["zoom", "all"]);
  const old = nowLine({ ...base, radar: "old", radarAsof: "Oct 19, 7:05 PM", radarN: 2, radarWhere: "Iowa" });
  assert.match(text(old.html), /radar hail in Iowa \(radar as of Oct 19, 7:05 PM\)/);
});

test("still asking: no verdict yet", () => {
  const r = nowLine({ ...base, warn: null });
  assert.equal(r.pending, true);
  assert.doesNotMatch(r.html, /No hail/);
});

// ── one state ────────────────────────────────────────────────────────────
const ia = { ...base, st: "IA", stName: "Iowa", sWarn: 0, sPins: 0, sRadarN: 0, elsewhere: "",
  sLatest: { d: "2026-10-08" }, sLatestDay: "Oct 8, 2026", sLatestShort: "Oct 8" };

test("a state, quiet: says so for that state, names its latest radar day, and its 5 years are the first button", () => {
  const r = nowLine(ia);
  assert.equal(r.quiet, true);
  assert.match(text(r.html), /^No hail warnings or radar hail in Iowa in the last 24 hours\. No ground reports of hail either\. Latest radar hail in Iowa: Oct 8, 2026\./);
  assert.deepEqual(r.acts.map((a) => [a[0], a[1], a[2]]), [["all", "Iowa: 5 years of hail", 1], ["day", "See Oct 8", 0]]);
  assert.ok(!/—/.test(r.html), "no em dashes");
});

test("a state, quiet, with storms elsewhere: says Iowa is quiet and names where the hail is", () => {
  const r = nowLine({ ...ia, warn: 2, warnStates: "Kansas", pins: 1, radarN: 1, elsewhere: "Kansas" });
  assert.equal(r.quiet, true);
  assert.match(text(r.html), /^No hail warnings or radar hail in Iowa in the last 24 hours\./);
  assert.match(text(r.html), /Elsewhere in the last 24 hours: Kansas\./);
});

test("a state with hail: counts only that state's warnings and reports, and keeps the 5 years one tap away", () => {
  const r = nowLine({ ...ia, warn: 3, sWarn: 1, radarN: 4, sRadarN: 2, pins: 5, sPins: 2, elsewhere: "Kansas" });
  assert.equal(r.quiet, false);
  assert.equal(text(r.html).split("Also")[0], "Last 24 hours in Iowa: 1 hail warning in effect now; radar hail; 2 ground reports of hail.");
  assert.match(text(r.html), /Also hail in the last 24 hours: Kansas\./);
  assert.deepEqual(r.acts.map((a) => a[1]), ["Iowa: 5 years of hail"]);
});

test("a state never says 'no radar hail' when the radar cannot be placed, is old, or is missing", () => {
  const unk = nowLine({ ...ia, sRadarN: "unk" });
  assert.doesNotMatch(unk.html, /radar hail in Iowa in the last 24/);
  assert.match(text(unk.html), /^No hail warnings in Iowa in the last 24 hours\./);
  assert.match(unk.html, /could not be matched to Iowa/);
  const old = nowLine({ ...ia, radar: "old", radarAsof: "Oct 19, 7:05 PM" });
  assert.doesNotMatch(old.html, /radar hail in Iowa in the last 24/);
  assert.match(old.html, /last updated Oct 19, 7:05 PM/);
  // the outline is still loading: no verdict yet
  assert.equal(nowLine({ ...ia, sRadarN: null }).pending, true);
  assert.doesNotMatch(nowLine({ ...ia, sRadarN: null }).html, /No hail/);
});

test("a state with no radar hail in the days on file says how far back it looked", () => {
  const r = nowLine({ ...ia, sLatest: { none: 30, from: "2026-09-19" }, sFrom: "Sep 19" });
  assert.match(text(r.html), /No radar hail in Iowa in the 30 days of radar on file since Sep 19\./);
  assert.deepEqual(r.acts.map((a) => a[0]), ["all"]);
  // still looking, or the walk missed a file: no claim either way
  assert.doesNotMatch(text(nowLine({ ...ia, sLatest: null }).html), /Latest radar hail|No radar hail in Iowa in the/);
});

test("the state helpers: a corner inside the real outline counts, a swath across the river in Nebraska does not", () => {
  const geo = JSON.parse(readFileSync(ROOT + "data/us-states.geo.json", "utf8"));
  const src = ["stateShape", "inRing", "inShape", "swathsIn"].map((n) => lift(HTML, n)).join("\n");
  const swathsIn = Function("usOutline", "var stateShapes={};\n" + src + "\nreturn swathsIn;")(geo);
  const fc = (...polys) => ({ features: polys.map((p) => ({ geometry: p })) });
  assert.equal(swathsIn(fc(sq0(-93.7, 41.6, 0.2)), "IA"), 1, "Des Moines is in Iowa");
  assert.equal(swathsIn(fc(sq0(-96.45, 41.15, 0.15)), "IA"), 0, "west of Omaha is Nebraska, though inside Iowa's rough box");
  assert.equal(swathsIn(fc(sq0(-96.45, 41.15, 0.15)), "NE"), 1);
  assert.equal(swathsIn(fc(sq0(-93.7, 41.6, 0.2), sq0(-97.5, 37.6, 0.3)), "KS"), 1);
  assert.equal(Function("usOutline", "var stateShapes={};\n" + src + "\nreturn swathsIn;")(false)(fc(sq0(-93.7, 41.6)), "IA"), "unk");
});
function sq0(lo, la, d = 0.4) { return { type: "Polygon", coordinates: [[[lo, la], [lo + d, la], [lo + d, la + d], [lo, la + d], [lo, la]]] }; }

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve(hits) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    hits.push(p);
    if (p === "/hail-map") p = "/hail-map.html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

const FC = (features) => JSON.stringify({ type: "FeatureCollection", features });
const sq = (lo, la, d = 0.4) => ({ type: "Polygon", coordinates: [[[lo, la], [lo + d, la], [lo + d, la + d], [lo, la + d], [lo, la]]] });
const FIX = {
  quiet: {
    nws: FC([{ type: "Feature", geometry: sq(-90, 40), properties: { areaDesc: "Peoria, IL", parameters: { maxHailSize: ["0.00"] } } }]),
    lsr: FC([{ type: "Feature", geometry: { type: "Point", coordinates: [-95, 39] }, properties: { typetext: "TSTM WND DMG", st: "MO" } }]),
    radar: [],
  },
  active: {
    nws: FC([{ type: "Feature", geometry: sq(-97.6, 37.5), properties: { areaDesc: "Sedgwick, KS; Butler, KS", parameters: { maxHailSize: ["1.75"] } } }]),
    lsr: FC([{ type: "Feature", geometry: { type: "Point", coordinates: [-97.33, 37.69] }, properties: { typetext: "HAIL", magnitude: 1.0, city: "Wichita", st: "KS" } }]),
    radar: [{ type: "Feature", properties: { thresh_in: 1.0 }, geometry: { type: "MultiPolygon", coordinates: [sq(-97.5, 37.6, 0.3).coordinates] } }],
  },
  iowa: {
    nws: FC([{ type: "Feature", geometry: sq(-93.8, 41.5), properties: { areaDesc: "Polk, IA; Dallas, IA", parameters: { maxHailSize: ["1.25"] } } },
             { type: "Feature", geometry: sq(-97.6, 37.5), properties: { areaDesc: "Sedgwick, KS", parameters: { maxHailSize: ["1.75"] } } }]),
    lsr: FC([{ type: "Feature", geometry: { type: "Point", coordinates: [-93.62, 41.59] }, properties: { typetext: "HAIL", magnitude: 1.0, city: "Des Moines", st: "IA" } },
             { type: "Feature", geometry: { type: "Point", coordinates: [-97.33, 37.69] }, properties: { typetext: "HAIL", magnitude: 1.0, city: "Wichita", st: "KS" } }]),
    // one swath in Iowa, one across the river in Nebraska (inside Iowa's rough box)
    radar: [{ type: "Feature", properties: { thresh_in: 1.0 }, geometry: { type: "MultiPolygon", coordinates: [sq(-93.7, 41.6, 0.2).coordinates, sq(-96.45, 41.15, 0.15).coordinates] } }],
  },
  nebraska: {
    nws: FC([]), lsr: FC([]),
    radar: [{ type: "Feature", properties: { thresh_in: 1.0 }, geometry: { type: "MultiPolygon", coordinates: [sq(-96.45, 41.15, 0.15).coordinates] } }],
  },
};

async function open(browser, port, path, fx, width = 390) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 844 } });
  const pg = await ctx.newPage();
  const errors = []; pg.on("pageerror", (e) => errors.push(String(e)));
  const ext = [];
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (/\/data\/hail\/mesh\/today-partial\.json/.test(u)) {
      return r.fulfill({ contentType: "application/json", body: JSON.stringify({ type: "FeatureCollection",
        meta: { date: "2026-10-20", partial: true, as_of: new Date(Date.now() - 30 * 60000).toISOString() }, features: FIX[fx].radar }) });
    }
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    ext.push(u);
    if (/api\.weather\.gov\/alerts\/active/.test(u)) return r.fulfill({ contentType: "application/geo+json", body: FIX[fx].nws });
    if (/mesonet\.agron\.iastate\.edu\/geojson\/lsr/.test(u)) return r.fulfill({ contentType: "application/json", body: FIX[fx].lsr });
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}${path}`);
  return { pg, ctx, errors, ext };
}
const nowText = () => { const b = document.getElementById("hm-now"); return b && !b.hidden ? b.textContent : ""; };

test("a bare /hail-map opens on now: a quiet day gets the one line, both buttons work, and no 5-year file loads", { skip, timeout: 90000 }, async () => {
  const hits = []; const srv = await serve(hits), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, ctx, errors, ext } = await open(browser, port, "/hail-map", "quiet");
    await pg.waitForFunction(() => /Latest radar hail:/.test((document.getElementById("hm-now") || {}).textContent || ""), null, { timeout: 30000 });
    const t = await pg.evaluate(nowText);
    assert.match(t, /^No hail warnings or radar hail in the last 24 hours\. No ground reports of hail either\. Latest radar hail: /);
    assert.equal(await pg.getAttribute('#hm-controls [data-key="now"]', "aria-pressed"), "true");
    assert.equal(await pg.textContent("#hm-count"), "0");
    assert.ok(ext.filter((u) => /api\.weather\.gov/.test(u)).length === 1, "the NWS is asked once on load: " + ext.join(" "));
    assert.ok(!hits.some((p) => p === "/data/hail/all-grid.json" || /^\/data\/hail\/\d{4}\.json$/.test(p)), "no 5-year data on a now load");
    // the latest day with radar hail on it, from the shipped archive
    let latest = null;
    for (const d of MESH.dates.slice(-10).reverse()) {
      const fc = JSON.parse(readFileSync(ROOT + `data/hail/mesh/${d}.json`, "utf8"));
      if (fc.features && fc.features.some((f) => f.geometry && f.geometry.coordinates.length)) { latest = d; break; }
    }
    assert.ok(latest, "the archive has a recent radar hail day");
    await pg.click('#hm-now [data-now="day"]');
    await pg.waitForFunction((d) => document.getElementById("hm-mesh-date").textContent === d, latest, { timeout: 15000 });
    assert.equal(await pg.isHidden("#hm-now"), true, "the line goes with the view");
    await pg.click('#hm-controls [data-key="now"]');
    await pg.waitForFunction(() => /Latest radar hail:/.test(document.getElementById("hm-now").textContent));
    assert.equal(new URL(pg.url()).search, "", "back on now, the swath date leaves the address");
    await pg.click('#hm-now [data-now="all"]');
    await pg.waitForFunction(() => /5-Year/.test(document.getElementById("hm-yearbadge").textContent), null, { timeout: 15000 });
    assert.equal(await pg.isHidden("#hm-now"), true);
    assert.equal(await pg.getAttribute("#hm-warnbtn", "aria-pressed"), "false", "the warnings the now view turned on go off with it");
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("active storms: the line leads with them and the layers are on the map", { skip, timeout: 90000 }, async () => {
  const hits = []; const srv = await serve(hits), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, ctx, errors } = await open(browser, port, "/hail-map", "active", 1280);
    await pg.waitForFunction(() => /ground report/.test((document.getElementById("hm-now") || {}).textContent || ""), null, { timeout: 30000 });
    const t = await pg.evaluate(nowText);
    assert.match(t, /^Last 24 hours: 1 hail warning in effect now \(Kansas\); radar hail in Kansas; 1 ground report of hail in Kansas\./);
    assert.equal(await pg.textContent("#hm-count"), "1");
    // the warning is drawn (its note carries the zoom) and the map is fitted to
    // the storms: the county table follows the map's centre, to Kansas
    await pg.waitForFunction(() => /1 active hail-tagged warning, Kansas/.test(document.getElementById("hm-livebar-note").textContent));
    await pg.waitForFunction(() => document.getElementById("hm-cty-select").value === "KS", null, { timeout: 15000 });
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("a state link opens on now zoomed to the state, says that state's 24 hours, and its 5 years are one tap", { skip, timeout: 120000 }, async () => {
  const hits = []; const srv = await serve(hits), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      hits.length = 0; // the last width asked for the 5 years; this one has not yet
      const { pg, ctx, errors } = await open(browser, port, "/hail-map?state=IA", "quiet", width);
      await pg.waitForFunction(() => /Latest radar hail in Iowa:|days of radar on file/.test((document.getElementById("hm-now") || {}).textContent || ""), null, { timeout: 30000 });
      const t = await pg.evaluate(nowText);
      assert.match(t, /^No hail warnings or radar hail in Iowa in the last 24 hours\. No ground reports of hail either\./, width + ": " + t);
      assert.equal(await pg.getAttribute('#hm-controls [data-key="now"]', "aria-pressed"), "true");
      assert.equal(await pg.textContent('#hm-now [data-now="all"]'), "Iowa: 5 years of hail");
      // zoomed to Iowa: the county table follows the map's centre
      await pg.waitForFunction(() => document.getElementById("hm-cty-select").value === "IA", null, { timeout: 15000 });
      assert.equal(new URL(pg.url()).search, "?state=IA");
      assert.ok(!hits.some((p) => p === "/data/hail/all-grid.json" || /^\/data\/hail\/\d{4}\.json$/.test(p)), "no 5-year data until asked");
      if (width === 390) {
        // the 5-year button and the All 5 years chip are on the first screen of a phone
        for (const sel of ['#hm-now [data-now="all"]', '#hm-controls [data-key="all"]']) {
          const b = await pg.locator(sel).boundingBox();
          assert.ok(b && b.y >= 0 && b.y + b.height <= 844, sel + " on the first screen: " + JSON.stringify(b));
        }
      }
      await pg.click('#hm-now [data-now="all"]');
      await pg.waitForFunction(() => /5-Year/.test(document.getElementById("hm-yearbadge").textContent), null, { timeout: 15000 });
      assert.equal(new URL(pg.url()).search, "?state=IA&view=all", "the address names what is on screen");
      assert.equal(await pg.isHidden("#hm-now"), true);
      assert.equal(await pg.evaluate(() => document.getElementById("hm-cty-select").value), "IA", "still on Iowa");
      // and back: Now keeps the state
      await pg.click('#hm-controls [data-key="now"]');
      await pg.waitForFunction(() => /in Iowa in the last 24 hours/.test(document.getElementById("hm-now").textContent));
      assert.equal(new URL(pg.url()).search, "?state=IA");
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("a state with storms: counts only what is in the state; a swath across the river is not Iowa's", { skip, timeout: 90000 }, async () => {
  const hits = []; const srv = await serve(hits), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    let { pg, ctx, errors } = await open(browser, port, "/hail-map?state=IA", "iowa", 1280);
    await pg.waitForFunction(() => /ground report/.test((document.getElementById("hm-now") || {}).textContent || ""), null, { timeout: 30000 });
    let t = await pg.evaluate(nowText);
    assert.match(t, /^Last 24 hours in Iowa: 1 hail warning in effect now; radar hail; 1 ground report of hail\./, t);
    assert.match(t, /Also hail in the last 24 hours: Kansas\./);
    assert.equal(await pg.textContent("#hm-count"), "1");
    await pg.waitForTimeout(500);
    assert.equal(await pg.evaluate(() => document.getElementById("hm-cty-select").value), "IA", "the storms in Kansas do not pull the map away");
    assert.deepEqual(errors, []);
    await ctx.close();
    ({ pg, ctx, errors } = await open(browser, port, "/hail-map?state=IA", "nebraska", 1280));
    await pg.waitForFunction(() => /No hail warnings or radar hail in Iowa/.test((document.getElementById("hm-now") || {}).textContent || ""), null, { timeout: 30000 });
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("the plain now view keeps the 5 years on a phone's first screen", { skip, timeout: 90000 }, async () => {
  const hits = []; const srv = await serve(hits), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, ctx, errors } = await open(browser, port, "/hail-map", "quiet", 390);
    await pg.waitForFunction(() => /Latest radar hail:/.test((document.getElementById("hm-now") || {}).textContent || ""), null, { timeout: 30000 });
    for (const sel of ['#hm-now [data-now="all"]', '#hm-controls [data-key="all"]']) {
      const b = await pg.locator(sel).boundingBox();
      assert.ok(b && b.y >= 0 && b.y + b.height <= 844, sel + " on the first screen: " + JSON.stringify(b));
    }
    assert.equal(await pg.textContent('#hm-now [data-now="all"]'), "5-year map");
    assert.equal(new URL(pg.url()).search, "");
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("named links open exactly what they name, never now", { skip, timeout: 120000 }, async () => {
  const hits = []; const srv = await serve(hits), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const swath = MESH.dates[MESH.dates.length - 2];
  const cases = [
    ["/hail-map?year=2024", () => /^2024/.test(document.getElementById("hm-yearbadge").textContent)],
    [`/hail-map?swath=${swath}`, (d) => document.getElementById("hm-mesh-date").textContent === d],
    ["/hail-map?view=all&state=IA", () => /5-Year/.test(document.getElementById("hm-yearbadge").textContent) && document.getElementById("hm-cty-select").value === "IA"],
    ["/hail-map?state=IA&year=2024", () => /^2024/.test(document.getElementById("hm-yearbadge").textContent)],
    ["/hail-map?view=all", () => /5-Year/.test(document.getElementById("hm-yearbadge").textContent)],
    ["/hail-map?view=recent", () => /Recent/.test(document.getElementById("hm-yearbadge").textContent)],
    ["/hail-map?lat=41.5868&lon=-93.625&mi=10&day=2025-06-14", () => /5-Year/.test(document.getElementById("hm-yearbadge").textContent) && document.querySelectorAll("#hm-point-table tbody tr").length > 0],
  ];
  try {
    for (const [path, ok] of cases) {
      const { pg, ctx, errors } = await open(browser, port, path, "active");
      await pg.waitForFunction(ok, swath, { timeout: 30000 });
      await pg.waitForTimeout(800);
      assert.equal(await pg.isHidden("#hm-now"), true, path + " shows no now line");
      assert.notEqual(await pg.getAttribute('#hm-controls [data-key="now"]', "aria-pressed"), "true", path);
      assert.deepEqual(errors, [], path);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
