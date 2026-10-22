/* The place page's rain drawing and its elevator comparison (Oct 19, 2026), from real cases.
 * On Fast Facts since Oct 21: both sit in "More about this county" on the My place tab.
 *
 *   node --test test/here-first.test.mjs
 *
 * The ranked line: components/place.js rankSoFar on a real RCC-ACIS period of record (Des Moines
 * Intl AP, saved by the Rain Print examples), equal to the Rain Print engine's own rank on whole
 * years. The drawing: the same station, days, total and normals as the county rain page bakes.
 * What's unusual here: Barron WI, Champaign IL and Barton KS (no deeds) against their own past.
 * The elevators: real rows of the bids network's live index (test/fixtures/here-first, from
 * dnilgis/bids f64b07c8b) and the id join to the basis history (data/ids/basis-join). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { answerOf } from "../scripts/rain_print_examples_pack.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const P = require(ROOT + "components/place.js");
const J = (p) => JSON.parse(fs.readFileSync(ROOT + p, "utf8"));
const read = (p) => fs.readFileSync(ROOT + p, "utf8");

function extras() {
  const ctx = { window: {} };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(read("components/rain-print-extras.js"), ctx);
  return ctx.window.AgRainExtras;
}
const porOf = (slug) => answerOf(J("data/rain-print-examples/" + slug + ".json").requests.find((r) => /sdate=por/.test(r.url))).data;

test("ranked line: on whole years it is the Rain Print engine's own rank (real Des Moines record)", () => {
  const rows = porOf("1993-des-moines-ia"), X = extras(), full = X.fullYears(rows, 1);
  assert.ok(full.length > 60, "the record has its full years");
  // 1956 has fewer than 30 complete years before it: withheld, not ranked
  const y56 = full.find((f) => f.year === 1956);
  assert.equal(P.rankSoFar(rows, { year: 1956, asOf: "1956-12-31", total: y56.total, done: true, station: { name: "Des Moines" } }).status, "thin");
  for (const year of [1993, 1988, 2012, 1980, 2008]) {
    const me = full.find((f) => f.year === year);
    assert.ok(me, year + " is a full year in this record");
    const want = X.rank(full.filter((f) => f.year <= year), year);   // no look-ahead: only the years before it
    const got = P.rankSoFar(rows, { year, asOf: year + "-12-31", total: me.total, done: true, station: { name: "Des Moines" } });
    assert.equal(got.status, "ok", year + ": " + got.why);
    assert.equal(got.n, want.n, year + " n");
    assert.equal(got.rank, want.rank, year + " rank");
    assert.equal(got.dir, want.dir, year + " dir");
    assert.equal(got.tied > 0, want.tied, year + " tie");
  }
  const r93 = P.rankSoFar(rows, { year: 1993, asOf: "1993-12-31", total: full.find((f) => f.year === 1993).total, done: true, station: { name: "Des Moines" } });
  assert.equal(P.rankWordsRain(r93, { year: 1993, station: { name: "Des Moines" } }), "1993 at Des Moines: the wettest of 53 years (Jan 1 to Dec 31).");
});

test("ranked line so far: the same calendar days of every complete earlier year, counted by hand", () => {
  const rows = porOf("1993-des-moines-ia");
  // hand count for Jan 1 to Jul 31: sum each year's rows, a year with any M (or no row) left out
  const by = {};
  for (const r of rows) { const y = +r[0].slice(0, 4); if (r[0].slice(5) <= "07-31") (by[y] = by[y] || []).push(r[1]); }
  const tot = {};
  for (const [y, v] of Object.entries(by)) {
    const need = (Date.UTC(+y, 6, 31) - Date.UTC(+y, 0, 1)) / 864e5 + 1;
    if (v.length !== need || v.some((x) => x === "M" || x === "S" || /A$/.test(x))) continue;   // this record has no S/A days in these years
    tot[y] = Math.round(v.reduce((a, x) => a + (x === "T" ? 0 : +x), 0) * 100) / 100;
  }
  const me = tot[1993], earlier = Object.entries(tot).filter(([y]) => +y < 1993).map(([, t]) => t);
  const wetter = earlier.filter((t) => t - me >= 0.005).length, drier = earlier.filter((t) => me - t >= 0.005).length;
  const r = P.rankSoFar(rows, { year: 1993, asOf: "1993-07-31", total: me, done: false, station: { name: "Des Moines" } });
  assert.equal(r.status, "ok");
  assert.equal(r.n, earlier.length + 1);
  assert.equal(r.wetter, wetter);
  assert.equal(r.drier, drier);
  assert.equal(r.rank, Math.min(wetter, drier) + 1);
  assert.match(P.rankWordsRain(r, { year: 1993, station: { name: "Des Moines" } }), /^1993 at Des Moines: (the wettest|\d+(st|nd|rd|th) wettest) of \d+ years so far \(Jan 1 to Jul 31\)\.$/);
});

test("ranked line withheld: a short record, a missing day this year, a total that disagrees with the drawing", () => {
  // Ames 1.5 NNE, a CoCoRaHS gauge since the 2000s (real record): too few years
  const ames = porOf("2012-ames-ia"), X = extras(), me = X.fullYears(ames, 1).find((f) => f.year === 2012);
  const thin = P.rankSoFar(ames, { year: 2012, asOf: "2012-12-31", total: me.total, done: true, station: { name: "Ames" } });
  assert.equal(thin.status, "thin");
  assert.ok(thin.n < P.RANK_MIN && /ranking needs 30/.test(thin.why), thin.why);
  assert.equal(P.rankWordsRain(thin, {}), "");
  const dsm = porOf("1993-des-moines-ia");
  const t93 = X.fullYears(dsm, 1).find((f) => f.year === 1993).total;
  const off = P.rankSoFar(dsm, { year: 1993, asOf: "1993-12-31", total: t93 + 0.05, done: true, station: { name: "Des Moines" } });
  assert.equal(off.status, "none");
  assert.match(off.why, /now reads .* not the .* drawn/);
  const holed = dsm.map((r) => (r[0] === "1993-05-02" ? [r[0], "M"] : r));
  assert.equal(P.rankSoFar(holed, { year: 1993, asOf: "1993-12-31", total: t93, done: true, station: { name: "x" } }).status, "none");
  // an S run that has not closed by the window's end leaves the year out
  const w = P.windowTotals([["2001-01-01", "0.10"], ["2001-01-02", "S"], ["2001-01-03", "0.40A"], ["2002-01-01", "0.10"], ["2002-01-02", "S"]], "01-02");
  assert.equal(w[2001].ok, false);
  assert.equal(P.windowTotals([["2001-01-01", "0.10"], ["2001-01-02", "S"], ["2001-01-03", "0.40A"]], "01-03")[2001].total, 0.5);
});

test("the drawing is the county rain page's: same station, days, total and normals (Barron WI, Champaign IL, Barton KS)", () => {
  for (const [fips, st, page] of [["55005", "wi", "rain/wisconsin/barron-county.html"], ["17019", "il", "rain/illinois/champaign-county.html"], ["20009", "ks", "rain/kansas/barton-county.html"]]) {
    const f = P.rainFigure(J("data/rain/" + st + ".json"), fips), h = read(page);
    const attr = (k) => (new RegExp('id="rc-print"[^>]*data-' + k + '="([^"]*)"').exec(h) || [])[1];
    assert.ok(f, fips);
    assert.equal(f.gauge, attr("gauge").replace(/&amp;/g, "&"), fips + " gauge");
    assert.equal(String(f.days), attr("days"), fips + " days");
    assert.equal(f.total.toFixed(2), attr("total"), fips + " total");
    assert.equal(f.place, attr("place"), fips + " place");
    if (attr("mn")) { assert.equal(f.mn, attr("mn")); assert.equal(f.usual.toFixed(2), attr("usual")); assert.equal(f.norm, attr("norm")); }
    const svg = P.rainChart(f);
    assert.match(svg, /^<svg viewBox="0 0 420 210"/);
    assert.match(svg, /class="rc-yr"/);
  }
  assert.equal(P.rainFigure(J("data/rain/wi.json"), "99999"), null);
  assert.equal(P.milesFrom(0.4), "less than a mile from");
  assert.equal(P.milesFrom(2.5), "2 miles from");   // Python's round(), as the county page prints it
  assert.equal(P.milesFrom(11.3), "11 miles from");
});

test("rain-county-print.js mounts any figure; the county page mounts its own; versions agree", () => {
  const js = read("components/rain-county-print.js");
  assert.match(js, /mount: mount/);
  assert.match(js, /var own = doc && doc\.getElementById\('rc-print'\);\s*if \(own\) mount\(own\);/);
  assert.match(read("components/here.js"), /RCP = '\/components\/rain-county-print\.js\?v=37'/);
  assert.match(read("scripts/build_county_rain.py"), /rain-county-print\.js\?v=37/);
  assert.match(read("rain/wisconsin/barron-county.html"), /rain-county-print\.js\?v=37/);
});

test("what's unusual here: own past only, the rule's numbers, nothing when nothing passes", () => {
  const barron = J("data/atlas/counties/55005.json"), champ = J("data/atlas/counties/17019.json"), barton = J("data/atlas/counties/20009.json");
  // five figures checked for each; Barron and Barton show none
  assert.equal(P.ownPast(barron, 2026).length, 5);
  assert.deepEqual(P.unusualHere(barron, 2026), []);
  assert.deepEqual(P.unusualHere(barton, 2026), []);
  // Barron's July nights: warmer than 117 of 131 (89%), just inside the band, so not shown
  const jul = P.ownPast(barron, 2026).find((l) => l.id === "jul_nights");
  assert.equal(jul.below, 117); assert.equal(jul.n, 131); assert.equal(jul.status, "ordinary");
  const c = P.unusualHere(champ, 2026);
  assert.deepEqual(c.map((l) => l.words), [
    "12 weeks with at least half the county in severe drought or worse so far in 2026, already more than in 25 of the 26 earlier full years (2000 to 2025).",
    "April to September rain, 2026: 30.32 in, more than in 33 of the 35 earlier years (1991 to 2025).",
  ]);
  // a year still going is checked on the high side only; an old latest value is not "now"
  const low = { drought: { status: "ok", last_full_year: 2025, partial_year: { year: 2026, d2: 0, maps: 40 },
    series: Object.fromEntries(Array.from({ length: 26 }, (_, i) => [String(2000 + i), { d2: 5 + i, maps: 52 }])) } };
  assert.equal(P.ownPast(low, 2026)[0].status, "ordinary");
  const old = { climate: { status: "ok", gs_series: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [String(1990 + i), i === 29 ? 99 : 20])) } };
  assert.deepEqual(P.ownPast(old, 2026), []);
  // under 20 earlier values: not judged
  const short = { climate: { status: "ok", gs_series: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(2015 + i), i === 11 ? 99 : 20])) } };
  assert.equal(P.ownPast(short, 2026)[0].status, "thin");
});

const IDX = J("test/fixtures/here-first/index.json"), SH = J("test/fixtures/here-first/shards.json");
const PTS = { chetek: [45.31413, -91.651], champaign: [40.1164, -88.2434], greatbend: [38.36446, -98.76481] };

test("elevators against their neighbors, on the network's real rows", () => {
  const ch = P.basisNeighbors(IDX.places, ...PTS.chetek);
  assert.deepEqual(ch.corn.map((r) => [r.name, r.town, r.mi, r.basis, r.period, r.nbN, r.nbMedian, r.gap]), [
    ["Synergy Cooperative", "Cameron", 7, -75, "newcrop-2026", 6, -67.5, -7.5],
    ["Synergy Cooperative", "Rice Lake", 14, -70, "newcrop-2026", 4, -75, 5],
    ["Synergy Cooperative", "Ridgeland", 14, -75, "newcrop-2026", 7, -65, -10],
  ]);
  for (const r of [...ch.corn, ...ch.soybeans]) {
    // every neighbor posts the same delivery period, sits within 40 miles of the elevator, once per id
    assert.ok(r.neighbors.every((n) => n.mi <= P.EL.NB));
    assert.equal(new Set(r.neighbors.map((n) => n.name + n.town)).size <= r.neighbors.length, true);
    assert.ok(r.elevId && /^e[0-9a-z]{9}$/.test(r.elevId), r.elevId);
  }
  const cu = P.basisNeighbors(IDX.places, ...PTS.champaign);
  const thin = cu.soybeans.find((r) => r.status === "thin");
  assert.ok(thin && /the comparison needs 4/.test(thin.why), "a delivery nobody else posts gets no comparison");
  const gb = P.basisNeighbors(IDX.places, ...PTS.greatbend);
  assert.equal(gb.corn.length, 3);
  assert.equal(gb.corn[0].town, "Great Bend");
  // a place with no elevator within 30 miles: nothing, not a far one
  assert.deepEqual(P.basisNeighbors(IDX.places, 47.0, -120.0), { corn: [], soybeans: [] });
});

test("the id joins live bids to basis history: match rate on real rows, never on a name", () => {
  execFileSync("python3", [ROOT + "scripts/build_basis_join.py", "--check"], { stdio: "pipe" });
  execFileSync("python3", [ROOT + "scripts/build_basis_join.py", "--selftest"], { stdio: "pipe" });
  const idx = J("data/ids/basis-join/index.json");
  assert.equal(idx.counts.joined + idx.counts.multi, idx.counts.with_history);
  // the fixture's places (217 real rows near the three test places)
  let withId = 0, joined = 0, multi = 0, nameAgrees = 0;
  const norm = (s) => String(s || "").trim().toUpperCase().replace(/\s+/g, " ");
  for (const p of IDX.places) {
    if (!p.elevId) continue;
    withId++;
    const j = fs.existsSync(ROOT + "data/ids/basis-join/" + p.state + ".json") ? J("data/ids/basis-join/" + p.state + ".json") : { k: {}, multi: {} };
    if (j.multi[p.elevId]) multi++;
    const k = j.k[p.elevId];
    if (!k) continue;
    joined++;
    if (k === p.state + "|" + norm(p.operator) + "|" + norm(p.city)) nameAgrees++;
  }
  // measured Oct 19 on these rows; a drop means the ids or the bids repo changed
  assert.ok(withId >= 200, "places with an elevId: " + withId);
  assert.ok(joined / withId >= 0.8, `joined ${joined} of ${withId}`);
  assert.ok(nameAgrees / joined >= 0.95, `the joined key is the name key for ${nameAgrees} of ${joined}`);
  console.log(`# basis join on the fixture: ${withId} places with an id, ${joined} joined, ${multi} left out (two or more history names), name key agrees on ${nameAgrees}`);
});

test("its own history: real rows are too new to compare; the kinds on a hand-built row", () => {
  const map = P.basisHistMap(J("data/basis/WI.json"));
  const r = P.basisNeighbors(IDX.places, ...PTS.chetek).corn[0];
  const key = J("data/ids/basis-join/WI.json").k[r.elevId];
  assert.equal(key, "WI|SYNERGY COOPERATIVE|CAMERON");
  const row = SH[r.shard].bids.find((b) => b.crop === "corn" && b.period === r.period && b.delivery === r.delivery && b.cash === r.cash);
  assert.equal(row.futuresMonth, "ZCZ26");
  const h = P.basisHistory(map, key, "corn", row.futuresMonth, row.delivery, r.basis, "2026-10-19");
  assert.equal(h.status, "thin");
  assert.match(h.why, /first seen Oct 16 and we wait for 28 days/);
  const sh = { state: "WI", c: ["corn", "soybeans", "wheat", "other"], f: ["COOP X|CHETEK"], d: ["2026-06-16", "2026-10-09", "2026-10-18"],
    r: [[0, 0, "ZCZ26", "NOV26", -42, -55, 1, 0, 2], [0, 0, "ZCH27", "MAR27", -30, null, 1, 0, 2]] };
  const m = P.basisHistMap(sh);
  assert.deepEqual(P.basisHistory(m, "WI|COOP X|CHETEK", "corn", "ZCZ26", "NOV26", -42, "2026-10-19"), { status: "ok", kind: "moved", date: "2026-10-09", from: -55, first: "2026-06-16" });
  assert.deepEqual(P.basisHistory(m, "WI|COOP X|CHETEK", "corn", "ZCZ26", "NOV26", -40, "2026-10-19"), { status: "ok", kind: "after", date: "2026-10-18", from: -42, first: "2026-06-16" });
  assert.deepEqual(P.basisHistory(m, "WI|COOP X|CHETEK", "corn", "ZCH27", "MAR27", -30, "2026-10-19"), { status: "ok", kind: "same", first: "2026-06-16" });
  assert.equal(P.basisHistory(m, null, "corn", "ZCZ26", "NOV26", -42, "2026-10-19").status, "none");
  assert.equal(P.basisHistory(m, "WI|COOP X|CHETEK", "corn", "ZCZ26", "NOV26", 392, "2026-10-19").status, "none");
});

// the bids checkout: BIDS_PATH in CI (pr-checks.yml clones dnilgis/bids data there), the local clone otherwise
const BIDS = (process.env.BIDS_PATH || "/home/user/bids/").replace(/\/?$/, "/");
test("a real shard path from the bids index answers: data/ + the index's shard field", { skip: !existsSync(BIDS + "data/merged-index.json") && "no bids checkout at " + BIDS }, () => {
  const idx = JSON.parse(readFileSync(BIDS + "data/merged-index.json", "utf8"));
  assert.equal(idx.shards.dir, "data/merged");
  const withShard = idx.places.filter((p) => p.shard);
  assert.ok(withShard.length > 100);
  for (const p of withShard.slice(0, 25)) {
    assert.match(p.shard, /^merged\/[a-z0-9][a-z0-9._-]{0,160}\.json$/i);
    if (!idx.shards.orphaned.includes(p.shard.slice(7))) assert.ok(existsSync(BIDS + "data/" + p.shard), "data/" + p.shard + " is on disk");
  }
});

test("bids-network exports the index and a checked shard getter; versions bumped together", () => {
  const js = read("components/bids-network.js");
  assert.match(js, /index: index,\s*\n\s*shard: shard,/);
  assert.match(js, /\^merged\\\/\[a-z0-9\]/);
  // the shards sit under data/ (merged-index.json shards.dir "data/merged"; Oct 21 skeptic: merged/ alone was a 404)
  assert.match(js, /return get\('data\/' \+ path\);/);
  for (const f of ["fast-facts.html", "corn-futures-prices.html", "store-or-sell.html", "combine-loss.html"]) assert.match(read(f), /bids-network\.js\?v=8/, f);   // v8: shards under data/ (Oct 21)
  assert.match(read("components/bids-homepage.js"), /bids-network\.js\?v=8/);
  assert.match(read("fast-facts.html"), /place\.js\?v=5/);   // v5: one past main v4 (fx/fastfacts: Fast Facts row builders, two tabs, Oct 21-22)
  assert.match(read("fast-facts.html"), /here\.js\?v=21/);   // v21: two tabs and the shared print sheet (fx/fastfacts round 2, Oct 21); v20: Fast Facts My place, State and US tabs (fx/fastfacts, Oct 21);   // v19: rain-county-print.js v36, engine rain-print.js v65 (fx/rpfix: Chetek Oct 21); v17: rain-county-print.js v34, engine rain-print.js v64, art v20 (fx/rptemp: temperature stripes); v16: rain-county-print.js v33, engine rain-print.js v63 (ship23: buying lines, Watch it draw); v15: rain-county-print.js v32, engine rain-print.js v62 (Watch it draw, 2026-10-20); v14: rain-county-print.js v31, engine rain-print.js v61 (digital files, 2026-10-20); v13: rain-county-print.js v30, engine rain-print.js v60 (order tracking, 2026-10-20); v12: rain-county-print.js v29, engine rain-print.js v59 (new maker key, 2026-10-20); v11: rain-county-print.js v28, the county print as a hidden shell (2026-10-20); v10: summer snow traces skipped (v27)
  assert.match(read("components/here.js"), /css\('\/components\/rain-county\.css\?v=5'\)/);   // loaded with the depth only (Oct 21)   // v5: the month table fits a phone (2026-10-19)
});

// ---------------------------------------------------------------- in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const GEO = {
  "54728": [{ name: "Chetek", latitude: 45.31413, longitude: -91.651, admin1: "Wisconsin", admin2: "Barron", postcodes: ["54728"] }],
  "67530": [{ name: "Great Bend", latitude: 38.36446, longitude: -98.76481, admin1: "Kansas", admin2: "Barton", postcodes: ["67530"] }],
};
/* SYNTHETIC earlier years (the sandbox cannot reach RCC-ACIS): a fixed pseudo-random 1932-2025, plus
   this year's real days from data/rain/daily, so the drawn total matches. It tests the wiring only;
   the ranking itself is tested above on a real record. */
const RCP = (() => { const m = { exports: {} }; new Function("module", "exports", read("components/rain-county-print.js")).call(m.exports, m, m.exports); return m.exports.AgRainCountyPrint; })();
function synthPor(sid) {
  for (const st of ["wi", "il", "ks"]) {
    const f = J("data/rain/" + st + ".json"), d = J("data/rain/daily/" + st + ".json");
    for (const [fips, c] of Object.entries(f.counties)) if (c.station.sid === sid) {
      const rows = []; let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let y = 1932; y < f.year; y++) for (let t = Date.UTC(y, 0, 1); t < Date.UTC(y + 1, 0, 1); t += 864e5) {
        const r = rnd(); rows.push([new Date(t).toISOString().slice(0, 10), r < 0.7 ? "0.00" : (rnd() * 0.9).toFixed(2)]);
      }
      RCP.unpack(d.counties[fips].p).forEach((v, i) => rows.push([new Date(Date.UTC(f.year, 0, 1 + i)).toISOString().slice(0, 10), v]));
      return { meta: {}, data: rows };
    }
  }
  return { error: "no such station" };
}
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".ics": "text/calendar" };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/here" || p === "/fast-facts") p = p + ".html";
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function openPage(browser, port, url, width, opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e)));
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    if (u.includes("geocoding-api.open-meteo.com")) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ results: GEO[new URL(u).searchParams.get("name")] || [] }) });
    if (u.includes("data.rcc-acis.org")) return opts.noAcis ? r.abort() : r.fulfill({ contentType: "application/json", body: JSON.stringify(synthPor(new URL(u).searchParams.get("sid"))) });
    if (u.includes("dnilgis.github.io/bids/data/merged-index.json")) return r.fulfill({ contentType: "application/json", body: JSON.stringify(IDX) });
    // the shards live under data/ in the bids repo (merged-index.json shards.dir); Oct 21: this route used to serve the bare
    // merged/ path, which the live repo answers with a 404, so the test passed while production never showed the line
    const m = /dnilgis\.github\.io\/bids\/data\/(merged\/[^?]+)/.exec(u);
    if (m && SH[m[1]]) return r.fulfill({ contentType: "application/json", body: JSON.stringify(SH[m[1]]) });
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
  await pg.waitForSelector("#h-place:not([hidden])", { timeout: 30000 });
  // the drawing, the rank and the elevators load only when "More about this county" opens
  assert.equal(await pg.$("#h-rp"), null, "nothing of the depth before it is opened");
  await pg.click("#h-more summary");
  return { pg, ctx, errs };
}

test("in a browser: ranked line, the Rain Print, unusual lines only when unusual, elevators without names; the years on tap", { skip, timeout: 240000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [url, odd] of [["/fast-facts?zip=54728", 0], ["/fast-facts?q=Champaign%20County%2C%20IL", 2], ["/fast-facts?zip=67530", 0]]) {
      for (const w of [390, 1280]) {
        const { pg, ctx, errs } = await openPage(browser, port, url, w);
        // the plain running total is there before anything slow answers
        await pg.waitForSelector("#h-rp svg", { timeout: 20000 });
        await pg.waitForFunction(() => !document.querySelector("#h-rank .h-wait") && !document.querySelector("#h-elev-b .wk-wait"), null, { timeout: 30000 });
        await pg.waitForSelector("#h-rp.rc-print-on", { timeout: 30000 });
        assert.match(await pg.textContent(".h-rank-l"), /^2026 at .+: (the (wettest|driest)|\d+(st|nd|rd|th) (wettest|driest)) of \d+ years so far \(Jan 1 to [A-Z][a-z]{2} \d+\)\.$/);
        // the drawing leads the depth, under the cards
        assert.ok(await pg.evaluate(() => document.querySelector("#h-first").getBoundingClientRect().top < document.querySelector("#h-sec-fingerprint").getBoundingClientRect().top));
        assert.ok(await pg.evaluate(() => document.querySelector("#h-sec-week").getBoundingClientRect().top < document.querySelector("#h-first").getBoundingClientRect().top));
        assert.equal(await pg.$eval("#h-odd", (e) => e.hidden), odd === 0, url);
        assert.equal(await pg.$$eval("#h-odd-l > li", (l) => l.length), odd, url);
        assert.ok(await pg.$$eval("#h-odd-l > li", (l) => l.length) <= 3, "at most three lines stand out");
        for (const t of await pg.$$eval("#h-odd-l > li", (l) => l.map((x) => x.textContent))) assert.match(t, /of the \d+ earlier (full )?years \(\d{4} to \d{4}\)/, "each line carries its sample: " + t);
        // every year at the station loads on tap, not before
        assert.equal(await pg.$eval("#h-years .h-math-b", (b) => b.childElementCount), 0);
        await pg.click("#h-years summary");
        await pg.waitForSelector("#h-years .h-math-b table");
        assert.match(await pg.textContent("#h-years .h-math-b"), /RCC-ACIS/);
        assert.ok(await pg.$eval("#h-years tr.h-me", (r) => /this year/.test(r.textContent)));
        const els = await pg.$$eval("#h-elev-b .h-el > li", (l) => l.map((x) => x.textContent));
        assert.equal(els.length, 6, url);
        for (const t of els) assert.match(t, /^(Corn|Soybeans), \d+ mi from (ZIP \d{5}|the county center): basis /);
        // never a name: no operator in the network's rows shows anywhere on the tab
        const tabText = await pg.textContent("#place");
        for (const n of new Set(IDX.places.map((p) => String(p.operator || "").trim()).filter((n) => n.length > 3))) assert.ok(!tabText.includes(n), url + " names " + n);
        assert.match(await pg.textContent("#h-elev-b"), /Basis history starts June 2026/);
        assert.match(await pg.textContent("#h-el-thin"), /^Against its own history: too new to compare yet\.$/);
        const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
        assert.ok(sw <= w + 1, "no sideways scroll at " + w + ": " + sw);
        assert.deepEqual(errs, []);
        await ctx.close();
      }
    }
    // NOAA does not answer: the line says so, with a way to ask again; the drawing still shows
    const { pg, ctx, errs } = await openPage(browser, port, "/fast-facts?zip=54728", 390, { noAcis: true });
    await pg.waitForSelector("#h-rank-retry", { timeout: 40000 });
    // plain words, no plumbing (tone, Oct 21): which service did not answer is not the reader's business
    assert.match(await pg.textContent("#h-rank"), /Not ranked today\./);
    assert.doesNotMatch(await pg.textContent("#h-rank"), /NOAA.s station record did not answer/);
    assert.ok(await pg.$("#h-rp svg"));
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
