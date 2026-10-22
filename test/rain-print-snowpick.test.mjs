/* Rain Print: the auto pick takes a station that records snowfall too
 * (2026-10-15, Sig: "find the nearest station with a full set of data, in my
 * case that includes snow and rain"). Chetek 2025 picked CoCoRaHS gauge
 * US1WIBR0002, 1.9 mi off, which keeps no snowfall, so the print drew none.
 *
 * Checks, on the shipped components/rain-print.js:
 *   - the pick prefers a snow station within max(10 mi farther, 2x as far);
 *   - falls back to the nearest rain record outside that slack, and says so;
 *   - ignores snow where snow is not normal (Florida, Hawaii, low deserts);
 *   - re-picks when a station NOAA lists for snowfall draws 'unknown';
 *   - never re-picks a design that names its station (links, short links,
 *     gift cards, saved designs);
 *   - the words by the station line and in the station list.
 * NOAA (data.rcc-acis.org) is answered here from made-up data shaped like
 * Chetek's real case. The browser part needs Playwright and Chromium and is
 * skipped where they are missing.
 *
 *   node --test test/rain-print-snowpick.test.mjs
 *   RP_SNOW_SHOTS=dir node --test test/rain-print-snowpick.test.mjs   (screenshots)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctx.window = ctx;
vm.runInNewContext(readFileSync(ROOT + "components/rain-print.js", "utf8"), ctx);
const RP = ctx.RainPrint;
const plain = (x) => JSON.parse(JSON.stringify(x));
const KM = 1 / 0.621371;   // km in a mile

// ---------- a year of days, the shape daily() hands the pick ----------
function yearDays(y) { const a = []; for (let t = Date.UTC(y, 0, 1); new Date(t).getUTCFullYear() === y; t += 864e5) a.push(new Date(t).toISOString().slice(0, 10)); return a; }
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
// snow: 'full' (a snowfall reading every day), 'none' (no snowfall column), 'holes' (a reading some days only)
function acisRows(y, { snow = "full", missing = 0, seed = 1 } = {}) {
  const r = rng(seed + y);
  return yearDays(y).map((d, i) => {
    const winter = d.slice(5, 7) <= "03" || d.slice(5, 7) >= "11";
    const u = r(), p = i < missing ? "M" : u < 0.14 ? (r() * 1.4).toFixed(2) : "0.00";
    const t = Math.round(44 + 32 * Math.sin((i - 105) / 365 * 2 * Math.PI));
    const sn = snow === "none" ? "M" : snow === "holes" && i % 3 ? "M" : winter && p !== "M" && +p > 0 ? (+p * 10).toFixed(1) : "0.0";
    return [d, p, String(t), sn, String(t + 9), String(t - 9)];
  });
}
function dailyOf(rows) {
  const days = rows.map((row, i) => {
    const p = RP.parsePcpn(row[1]), sn = RP.parsePcpn(row[3]).v, dt = new Date(row[0] + "T00:00:00");
    return { date: row[0], v: p.v, flag: p.flag, t: +row[2], s: sn, m: dt.getMonth(), d: dt.getDate(), doy: i };
  });
  return { meta: {}, days, d: RP.derive(days), raw: rows };
}
// stations as stations() hands them: km from the town, snowOk from the snowfall StnMeta ask
const st = (sid, name, mi, snowOk, extra = {}) => ({ sid, name, km: mi * KM, snowOk, state: "WI", elev: 1050, ll: [-91.65, 45.31 + mi / 69], valid_daterange: [["1990-01-01", "2026-10-01"]], ...extra });
const GAUGE = st("US1WIBR0002", "CHETEK 1.9 SSW", 1.9, false);
const RICE = st("477113 2", "RICE LAKE", 9, true);
const CAMERON = st("471205 2", "CAMERON 2 NE", 10.5, true);

function reader(byStation) {
  const asked = [];
  const read = (sid, year) => { asked.push(sid); const o = byStation[sid]; return o ? Promise.resolve(dailyOf(acisRows(year, o))) : Promise.reject(new Error("no answer")); };
  return { read, asked };
}

test("Chetek 2025: a station 9 mi off that records snowfall wins over the gauge 1.9 mi off that doesn't", async () => {
  const R = reader({ [GAUGE.sid]: { snow: "none" }, [RICE.sid]: { snow: "full" }, [CAMERON.sid]: { snow: "full" } });
  const got = await RP.pickStation([GAUGE, RICE, CAMERON], 2025, R.read, { lat: 45.3141 });
  assert.equal(got.chosen.sid, RICE.sid, "Rice Lake keeps both");
  assert.notEqual(RP.snowStateOf(got.picked.days), "unknown", "and its year draws snow");
  assert.equal(got.why.over.sid, GAUGE.sid, "picked over the gauge");
  assert.equal(RP.pickWhy(got.why, 2025), "Picked over a gauge 1.9 mi away because it records snowfall too.");
  // the nearest three are read at once (2026-10-15, for speed), each once; the answers are judged nearest first
  assert.deepEqual(plain(R.asked), [GAUGE.sid, RICE.sid, CAMERON.sid], "the three nearest, read at once, none twice");
  assert.equal(got.seen[GAUGE.sid], "unknown");
  assert.equal(RP.snowWord(GAUGE, got.seen), "rain only");
  assert.equal(RP.snowWord(RICE, got.seen), "rain and snow");
  assert.equal(RP.snowWord(CAMERON, got.seen), "rain and snow", "not read: NOAA's list says it keeps snowfall");
  assert.equal(RP.snowWord({ sid: "x", snowOk: null }, {}), "", "not known: no word at all");
  // a NOAA station passed over is called a station, not a gauge
  assert.equal(RP.pickWhy({ over: { sid: "471667 2", km: 3 * KM } }, 2025), "Picked over a station 3.0 mi away because it records snowfall too.");
});

test("the slack is the larger of 10 mi farther and twice as far; past it the rain station stays and the page says so", async () => {
  assert.ok(Math.abs(RP.snowLimitKm(1.9 * KM) - 11.9 * KM) < 1e-9, "1.9 mi: 10 mi farther (11.9) beats twice (3.8)");
  assert.ok(Math.abs(RP.snowLimitKm(15 * KM) - 30 * KM) < 1e-9, "15 mi: twice (30) beats 10 mi farther (25)");
  const FAR = st("477113 2", "RICE LAKE", 12.5, true);
  const R = reader({ [GAUGE.sid]: { snow: "none" }, [FAR.sid]: { snow: "full" } });
  const got = await RP.pickStation([GAUGE, FAR], 2025, R.read, { lat: 45.3141 });
  assert.equal(got.chosen.sid, GAUGE.sid, "12.5 mi is past 11.9: the gauge stays");
  assert.deepEqual(plain(R.asked), [GAUGE.sid, FAR.sid], "both read at once with the rain candidates, once each; the far one still isn't taken");
  assert.equal(got.why.none, true);
  assert.equal(RP.pickWhy(got.why, 2025), "None of the stations within 12 mi kept a full snowfall record for 2025, so the print draws no snow.");
  // twice as far: rain 15 mi, snow 28 mi is inside 30
  const A = st("A", "ALPHA", 15, false), B = st("B", "BRAVO", 28, true);
  const R2 = reader({ A: { snow: "none" }, B: { snow: "full" } });
  assert.equal((await RP.pickStation([A, B], 2025, R2.read, { lat: 45.3 })).chosen.sid, "B");
});

test("where snow isn't normal, no miles are traded for a snowfall record", async () => {
  const where = [
    [{ state: "FL", lat: 27.9, elev: 20 }, false, "Florida"], [{ state: "HI", lat: 21.3, elev: 10 }, false, "Hawaii"], [{ state: "PR", lat: 18.4 }, false, "Puerto Rico"],
    [{ state: "AZ", lat: 33.4, elev: 1100 }, false, "Phoenix"], [{ state: "NV", lat: 36.1, elev: 2000 }, false, "Las Vegas"], [{ state: "CA", lat: 34.0, elev: 300 }, false, "Los Angeles"],
    [{ state: "TX", lat: 29.8, elev: 50 }, false, "Houston"], [{ state: "TX", lat: 32.9, elev: 600 }, false, "Dallas"], [{ state: "LA", lat: 30.0, elev: 5 }, false, "New Orleans"], [{ state: "SC", lat: 32.8, elev: 40 }, false, "Charleston"],
    [{ state: "WI", lat: 45.3, elev: 1050 }, true, "Chetek"], [{ state: "AZ", lat: 35.2, elev: 7000 }, true, "Flagstaff"], [{ state: "NV", lat: 39.5, elev: 4400 }, true, "Reno"],
    [{ state: "GA", lat: 33.7, elev: 1000 }, true, "Atlanta"], [{ state: "TX", lat: 33.6, elev: 3200 }, true, "Lubbock"], [{ state: "WA", lat: 47.6, elev: 200 }, true, "Seattle"],
  ];
  for (const [o, want, name] of where) assert.equal(RP.snowCountry(o), want, name);
  const FLG = st("US1FLHB0001", "TAMPA 2 N", 1.5, false, { state: "FL", elev: 20 }), FLC = st("088788 2", "TAMPA INTL AP", 6, true, { state: "FL", elev: 20 });
  const R = reader({ [FLG.sid]: { snow: "none" }, [FLC.sid]: { snow: "full" } });
  const got = await RP.pickStation([FLG, FLC], 2025, R.read, { lat: 27.9 });
  assert.equal(got.chosen.sid, FLG.sid, "Tampa keeps the nearest rain record");
  assert.equal(got.why, null, "and says nothing about snow");
  assert.deepEqual(plain(R.asked), [FLG.sid, FLC.sid], "read at once with the rain candidates; the farther one isn't taken for its snow");
});

test("a station NOAA lists for snowfall whose year comes back 'unknown' is passed for the next one", async () => {
  // Rice Lake is on NOAA's snowfall list but its 2025 snowfall has holes: the art would draw no snow
  const R = reader({ [GAUGE.sid]: { snow: "none" }, [RICE.sid]: { snow: "holes" }, [CAMERON.sid]: { snow: "full" } });
  const got = await RP.pickStation([GAUGE, RICE, CAMERON], 2025, R.read, { lat: 45.3141 });
  assert.equal(got.chosen.sid, CAMERON.sid);
  assert.equal(got.seen[RICE.sid], "unknown");
  assert.equal(RP.snowWord(RICE, got.seen), "rain only", "the list says so once its days are read");
  // the nearest rain station itself on the snowfall list but drawing 'unknown': the same
  const G2 = { ...GAUGE, snowOk: true };
  const R2 = reader({ [G2.sid]: { snow: "holes" }, [RICE.sid]: { snow: "full" } });
  assert.equal((await RP.pickStation([G2, RICE], 2025, R2.read, { lat: 45.3141 })).chosen.sid, RICE.sid);
  // a snow station with a poor rain year is no trade
  const R3 = reader({ [GAUGE.sid]: { snow: "none" }, [RICE.sid]: { snow: "full", missing: 40 }, [CAMERON.sid]: { snow: "full" } });
  assert.equal((await RP.pickStation([GAUGE, RICE, CAMERON], 2025, R3.read, { lat: 45.3141 })).chosen.sid, CAMERON.sid);
  // every snow station fails: the gauge stays; one that didn't answer means the page can't say "none kept"
  const R4 = reader({ [GAUGE.sid]: { snow: "none" }, [RICE.sid]: { snow: "holes" } });
  const got4 = await RP.pickStation([GAUGE, RICE, CAMERON], 2025, R4.read, { lat: 45.3141 });
  assert.equal(got4.chosen.sid, GAUGE.sid);
  assert.equal(got4.why.sure, false);
  assert.equal(RP.pickWhy(got4.why, 2025), "The nearest stations that keep snowfall didn’t send a full 2025 of it, so the print draws no snow.");
});

test("a nearest station that draws snow is kept, with no extra reads and nothing said", async () => {
  const CHETEK = st("471667 2", "CHETEK", 0.4, true);
  const R = reader({ [CHETEK.sid]: { snow: "full" }, [RICE.sid]: { snow: "full" } });
  const got = await RP.pickStation([CHETEK, GAUGE, RICE], 2025, R.read, { lat: 45.3141 });
  assert.equal(got.chosen.sid, CHETEK.sid);
  assert.equal(got.why, null);
  assert.deepEqual(plain(R.asked), [CHETEK.sid, GAUGE.sid, RICE.sid], "the nearest three at once, nothing more");
  // a station that records snowfall but had no snow is 'none', not 'unknown': kept
  assert.equal(RP.snowStateOf(dailyOf(acisRows(2025, { snow: "full" }).map((r) => [r[0], r[1], r[2], "0.0", r[4], r[5]])).days), "none");
  // the rain rule is today's: the nearest three, the first with a near-complete year
  const R2 = reader({ [GAUGE.sid]: { snow: "none", missing: 40 }, [RICE.sid]: { snow: "full" } });
  const got2 = await RP.pickStation([GAUGE, RICE], 2025, R2.read, { lat: 45.3141 });
  assert.equal(got2.chosen.sid, RICE.sid);
  assert.equal(got2.why, null, "picked for its rain record, nothing traded");
});

test("the candidates are read in parallel: all three asks are out before the first answer, and the pick is the same as one at a time", async () => {
  const asked = [], wait = [];
  const read = (sid, year) => { asked.push(sid); return new Promise((ok) => wait.push(() => ok(dailyOf(acisRows(year, { snow: sid === GAUGE.sid ? "none" : "full" }))))); };
  const p = RP.pickStation([GAUGE, RICE, CAMERON], 2025, read, { lat: 45.3141 });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(plain(asked), [GAUGE.sid, RICE.sid, CAMERON.sid], "three asks out at once");
  wait.reverse().forEach((f) => f());   // answers come back farthest first
  const got = await p;
  assert.equal(got.chosen.sid, RICE.sid, "judged nearest first all the same: Rice Lake, for its snowfall");
  assert.equal(got.why.over.sid, GAUGE.sid);
});

test("the page wiring: only a design without its own station is picked; a link, a code or a gift card keeps it", () => {
  const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
  const run = S.slice(S.indexOf("STATIONS = list;"), S.indexOf("ST.station = chosen.sid;"));
  assert.match(run, /if \(want\) return daily\(want\.sid, ST\.year\)\.then\(function \(d\) \{ chosen = want; picked = d;/, "a named station draws as it is");
  assert.equal((run.match(/pickStation\(/g) || []).length, 1, "the pick runs in nearest() only");
  assert.match(run, /function nearest\(skip\) \{[\s\S]*?var readNow = function \(sid, y\) \{ return my === reqToken \? daily\(sid, y\)[\s\S]*?: Promise\.reject\('stale'\); \};\s*return pickStation\(pool, ST\.year, readNow,/, "daily(), stopping once a newer draw starts");
  assert.match(S, /why: autoPick \? why : null/, "the why sentence only for an auto pick");
  const card = S.slice(S.indexOf("function previewArt(code, opts)"), S.indexOf("function paidFromUrl"));
  assert.match(card, /if \(s\.station\) \{\s*return daily\(s\.station, s\.year\)/, "the gift card keeps its station");
  // the snowfall ask is its own StnMeta call; the precipitation list is asked as before
  assert.match(S, /elems: 'pcpn', sdate: year \+ '-01-01', edate: lastDayOf\(year\), meta: 'name,sids,ll,valid_daterange,state,elev'/);
  assert.match(S, /elems: 'snow', sdate: year \+ '-01-01', edate: lastDayOf\(year\), meta: 'sids,valid_daterange'/);
});

// ---------------------------------------------------------------- in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const SHOTS = process.env.RP_SNOW_SHOTS || null;
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

// Chetek's case, as StnMeta and StnData would send it
const TOWN = { lat: 45.3141, lon: -91.651 };
const META = [
  { name: "CHETEK 1.9 SSW", sids: ["US1WIBR0002 6"], ll: [TOWN.lon, TOWN.lat - 1.9 / 69], state: "WI", elev: 1060, valid_daterange: [["2009-05-01", "2026-10-10"]], snow: [], data: { snow: "none" } },
  { name: "RICE LAKE", sids: ["477113 2"], ll: [-91.651, TOWN.lat + 9 / 69], state: "WI", elev: 1110, valid_daterange: [["1893-01-01", "2026-10-10"]], snow: ["1893-01-01", "2026-10-10"], data: { snow: "full" } },
  { name: "CAMERON 2 NE", sids: ["471205 2"], ll: [-91.651, TOWN.lat - 10.5 / 69], state: "WI", elev: 1100, valid_daterange: [["1950-01-01", "2026-10-10"]], snow: ["1950-01-01", "2026-10-10"], data: { snow: "full" } },
];
async function mocks(context, meta, log) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = new URL(r.request().url());
    if (u.host === "agsist-api.dnilgis.workers.dev") {
      const m = /^\/rp-short\/([0-9A-Z]+)$/.exec(u.pathname);
      if (m && m[1] === "SN0W1") return r.fulfill({ headers: { "Access-Control-Allow-Origin": "*" }, json: { ok: true, code: RP.encodeCode({ place: "Chetek, WI", year: 2025, station: "US1WIBR0002 6", style: "r2" }) } });
      return r.fulfill({ status: 503, headers: { "Access-Control-Allow-Origin": "*" }, body: "x" });
    }
    if (u.host === "geocoding-api.open-meteo.com") return r.fulfill({ json: { results: [{ name: "Chetek", latitude: TOWN.lat, longitude: TOWN.lon, admin1: "Wisconsin", country_code: "US" }] } });
    if (u.host === "data.rcc-acis.org") {
      if (u.pathname === "/StnMeta") {
        const snow = u.searchParams.get("elems") === "snow";
        return r.fulfill({ json: { meta: meta.filter((m) => !snow || m.snow.length).map((m) => ({ name: m.name, sids: m.sids, ll: m.ll, state: m.state, elev: m.elev, valid_daterange: [snow ? m.snow : m.valid_daterange[0]] })) } });
      }
      let sid = u.searchParams.get("sid"), sdate = u.searchParams.get("sdate"), normal = false;
      if (u.searchParams.get("params")) { const p = JSON.parse(u.searchParams.get("params")); sid = p.sid; sdate = p.sdate; normal = true; }
      if (normal) return r.fulfill({ json: { data: yearDays(+String(sdate).slice(0, 4)).map((d) => [d, "0.08"]) } });
      const m = meta.find((x) => x.sids[0].split(" ")[0] === String(sid).split(" ")[0]);
      if (!m) return r.fulfill({ json: { error: "no such station" } });
      if (sdate === "por") { let data = []; for (let y = 2010; y <= 2025; y++) data = data.concat(acisRows(y, m.data).map((x) => x.slice(0, 3))); return r.fulfill({ json: { data } }); }
      log.push(m.sids[0]);
      return r.fulfill({ json: { meta: { name: m.name, state: m.state, ll: m.ll }, data: acisRows(+String(sdate).slice(0, 4), m.data) } });
    }
    return r.abort();
  });
}
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png" };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function withPage(fn, { width = 390, height = 844, meta = META } = {}) {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
    await context.clock.setFixedTime(new Date("2026-10-15T17:00:00Z"));
    const log = [];
    await mocks(context, meta, log);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, `http://127.0.0.1:${port}`, log, errors);
  } finally { await browser.close(); srv.close(); }
}
const drawn = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && /days recorded/.test(document.getElementById("rp-source").textContent), null, { timeout: 30000 });
const options = (page) => page.$$eval("#rp-station option", (a) => a.map((o) => o.textContent));
async function shots(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.$eval("#rp-source", (el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOTS + "/" + name + "-line.png" });
  await page.evaluate(() => { document.getElementById("rp-more").open = true; document.getElementById("rp-station").scrollIntoView({ block: "center", behavior: "instant" }); });
  // the list itself, as the open select would show it
  await page.evaluate(() => { const s = document.getElementById("rp-station"); s.size = s.options.length; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOTS + "/" + name + "-list.png" });
  await page.evaluate(() => { document.getElementById("rp-station").size = 0; });
}

test("browser: Chetek 2025 draws from Rice Lake, says why by the station line, and the list marks each station", { skip }, async () => {
  for (const width of [390, 1280]) await withPage(async (page, base, log, errors) => {
    await page.goto(base + "/rain-print.html?place=Chetek%2C+WI&year=2025&style=r2");
    await drawn(page);
    const src = await page.textContent("#rp-source");
    assert.match(src, /^Weather station: Rice Lake, WI, 9\.0 mi from Chetek \(NOAA co-op station 477113\)\. Picked over a gauge 1\.9 mi away because it records snowfall too\. Change station\. /);
    assert.equal(await page.inputValue("#rp-station"), "477113 2");
    const o = await options(page);
    assert.match(o[0], /^Chetek, 1\.9 mi SSW, 1\.9 mi, 2009–2026, rain only$/);
    assert.match(o[1], /^Rice Lake, 9\.0 mi, 1893–2026, rain and snow$/);
    assert.match(o[2], /, rain and snow$/);
    assert.match(await page.$eval("#rp-art svg", (s) => s.textContent), /Rice Lake/, "the print names Rice Lake");
    assert.match(page.url(), /station=477113/, "the link carries the picked station, so it never re-picks");
    await shots(page, "chetek-" + width);
    // Change station still takes any of them; a station the buyer picks is drawn with no reason given
    await page.evaluate(() => { document.getElementById("rp-more").open = true; });
    await page.selectOption("#rp-station", "US1WIBR0002 6");
    await page.waitForFunction(() => /volunteer gauge US1WIBR0002/.test(document.getElementById("rp-source").textContent) && !document.getElementById("rp-go").disabled, null, { timeout: 30000 });
    assert.ok(!/Picked over/.test(await page.textContent("#rp-source")));
    assert.deepEqual(errors, []);
  }, { width, height: width < 600 ? 844 : 900 });
});

test("browser: a link, a short link or a saved design that names the gauge keeps the gauge", { skip }, async () => {
  await withPage(async (page, base, log, errors) => {
    await page.goto(base + "/rain-print.html?place=Chetek%2C+WI&year=2025&station=US1WIBR0002+6&style=r2");
    await drawn(page);
    assert.equal(await page.inputValue("#rp-station"), "US1WIBR0002 6");
    // a station named for the buyer's own town: one distance only, from the town (2026-10-15; it said "(1.9 mi SSW of Chetek), 1.9 mi from Chetek")
    assert.match(await page.textContent("#rp-source"), /^Weather station: Chetek, WI, 1\.9 mi from Chetek \(volunteer gauge US1WIBR0002\) Change station\./);
    assert.ok(!log.some((s) => /^4771/.test(s)), "Rice Lake's year is never read");
    await page.goto(base + "/rain-print.html?d=RPS-SN0W1");
    await drawn(page);
    assert.match(await page.textContent("#rp-source"), /volunteer gauge US1WIBR0002/, "the short link keeps its station");
    assert.ok(!/Picked over/.test(await page.textContent("#rp-source")));
    assert.deepEqual(errors, []);
  });
});

test("browser: no snow station inside the slack: the gauge draws and the line says so", { skip }, async () => {
  const far = META.map((m) => m.sids[0] === "US1WIBR0002 6" ? m : { ...m, ll: [m.ll[0], TOWN.lat + (m.ll[1] > TOWN.lat ? 1 : -1) * 14 / 69] });
  await withPage(async (page, base, log, errors) => {
    await page.goto(base + "/rain-print.html?place=Chetek%2C+WI&year=2025");
    await drawn(page);
    assert.match(await page.textContent("#rp-source"), /volunteer gauge US1WIBR0002\)\. None of the stations within 12 mi kept a full snowfall record for 2025, so the print draws no snow\. Change station\./);
    assert.deepEqual(log, ["US1WIBR0002 6", "477113 2", "471205 2"], "the nearest three read at once, each once; none past the slack is taken");
    assert.deepEqual(errors, []);
  }, { meta: far });
});

test("browser: the gauge on NOAA's snowfall list, but its 2025 draws no snow: Rice Lake is taken after the real days are read", { skip }, async () => {
  const listed = META.map((m) => m.sids[0] === "US1WIBR0002 6" ? { ...m, snow: ["2009-05-01", "2026-10-10"], data: { snow: "holes" } } : m);
  await withPage(async (page, base, log, errors) => {
    await page.goto(base + "/rain-print.html?place=Chetek%2C+WI&year=2025");
    await drawn(page);
    assert.match(await page.textContent("#rp-source"), /^Weather station: Rice Lake, WI, 9\.0 mi from Chetek \(NOAA co-op station 477113\)\. Picked over a gauge 1\.9 mi away because it records snowfall too\./);
    assert.deepEqual(log.slice(0, 2), ["US1WIBR0002 6", "477113 2"]);
    assert.match((await options(page))[0], /, rain only$/, "the list goes by the days read, not NOAA's list");
    assert.deepEqual(errors, []);
  }, { meta: listed });
});
