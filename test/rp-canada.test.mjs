/* Rain Print for Canada (components/rp-canada.js, 2026-10-16).
 *
 * The year totals below were worked by hand from the saved GHCN-Daily rows in
 * test/fixtures/rp-canada/ (NOAA's S3 copy, fetched 2026-10-16), with awk, not
 * with this code: sum of PRCP (tenths of mm) on rows with no quality flag from
 * source C (ECCC) or N (CoCoRaHS), M-flag not P or I.
 *   Qu'Appelle 1, SK (CAN04016322), 2024: 366 of 366 days, 420.9 mm (16.571 in),
 *     snowfall 111.4 cm (1 day without a snowfall report), 86 days with rain,
 *     biggest day 32.4 mm on Jun 27; months 9.4 20.8 35.1 8.4 56.2 128.9 2.7 53.4
 *     40.7 8.5 34.6 22.2 mm.
 *   Pierreville, QC (CAN07026043), 2024: 358 of 366 days (8 missing), 956.9 mm,
 *     snowfall 98.7 cm on the reported days (2 days without a snowfall report),
 *     142 days with rain, biggest day 94.4 mm on Aug 9 (the remnants of Debby).
 * The engine (components/rain-print.js) reads them through the same byte-range
 * reader the browser uses, from a fake S3 that serves the fixture bytes.
 *
 *   node --test test/rp-canada.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");

// A copy of a station's file as S3 has it: other years around the saved one (the
// saved rows with the year changed), so the reader has to find the year by range.
function stationFile(fixture, year) {
  const lines = read(fixture).trim().split("\n");
  const head = lines[0], rows = lines.slice(1);
  const shift = (y) => rows.filter((r) => !r.split(",")[1].endsWith("0229")).map((r) => { const f = r.split(","); f[1] = y + f[1].slice(4); return f.join(","); });
  const out = [head];
  for (let y = year - 6; y < year; y++) out.push(...shift(y));
  out.push(...rows);
  out.push(...shift(year + 1));
  return out.join("\n") + "\n";
}
function makeCtx(files, log = []) {
  const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob, setTimeout, clearTimeout, AbortController, Intl, Date, Promise, Map };
  ctx.window = ctx;
  ctx.fetch = (url, opts = {}) => {
    log.push({ url, opts });
    const key = Object.keys(files).find((k) => url.includes(k));
    if (!key) return Promise.resolve({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), text: async () => "" });
    const body = files[key];
    const buf = Buffer.from(body, "latin1");
    let part = buf;
    const rg = opts.headers && opts.headers.Range && /bytes=(\d+)-(\d+)/.exec(opts.headers.Range);
    if (rg) part = buf.subarray(+rg[1], +rg[2] + 1);
    return Promise.resolve({
      ok: true, status: rg ? 206 : 200,
      headers: { get: (h) => (h.toLowerCase() === "content-length" ? String(buf.length) : null) },
      json: async () => JSON.parse(body), text: async () => (opts.method === "HEAD" ? "" : part.toString("latin1")),
    });
  };
  vm.runInNewContext(read("components/rp-canada.js"), ctx);
  vm.runInNewContext(read("components/rain-print.js"), ctx);
  return ctx;
}
const FILES = {
  "/data/rain-print-ca/stations.json": read("data/rain-print-ca/stations.json"),
  "/data/rain-print-ca/fsa.json": read("data/rain-print-ca/fsa.json"),
  "/csv/by_station/CAN04016322.csv": stationFile("test/fixtures/rp-canada/CAN04016322-2024.csv", 2024),
  "/csv/by_station/CAN07026043.csv": stationFile("test/fixtures/rp-canada/CAN07026043-2024.csv", 2024),
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test("Qu'Appelle, SK 2024 through the engine: hand-worked totals, months, snow, wettest day", async () => {
  const log = [];
  const ctx = makeCtx(FILES, log);
  const d = await ctx.RainPrint.daily("CAN04016322", 2024);
  assert.equal(d.days.length, 366);
  assert.equal(d.d.missing, 0);
  near(d.d.total * 25.4, 420.9, 0.05, "year total mm");
  const months = [9.4, 20.8, 35.1, 8.4, 56.2, 128.9, 2.7, 53.4, 40.7, 8.5, 34.6, 22.2];
  months.forEach((m, i) => near(d.d.month[i] * 25.4, m, 0.05, "month " + (i + 1)));
  near(d.d.snow * 2.54, 111.4, 0.13, "snowfall cm (engine rounds inches to a tenth)");
  assert.equal(d.d.wet, 86);
  assert.equal(d.d.max.date, "2024-06-27");
  near(d.d.max.v * 25.4, 32.4, 0.01, "wettest day mm");
  assert.equal(d.meta.name, "Qu'Appelle 1");
  assert.equal(d.meta.state, "SK");
  // found by byte ranges, not by downloading the whole file
  const ranges = log.filter((x) => x.opts.headers && x.opts.headers.Range);
  assert.ok(ranges.length >= 2 && ranges.length < 25, "ranges: " + ranges.length);
  assert.ok(log.some((x) => x.opts.method === "HEAD"));
});

test("Pierreville, QC 2024: 8 days missing stay gaps, never dry; totals match by hand", async () => {
  const ctx = makeCtx(FILES);
  const d = await ctx.RainPrint.daily("CAN07026043", 2024);
  assert.equal(d.days.length, 366);
  assert.equal(d.d.missing, 8);
  near(d.d.total * 25.4, 956.9, 0.05, "year total mm");
  assert.equal(d.d.wet, 142);
  assert.equal(d.d.max.date, "2024-08-09");
  near(d.d.max.v * 25.4, 94.4, 0.01, "biggest day");
  near(d.d.snow * 2.54, 98.7, 0.13, "snowfall cm");
  // a missing day is null, not 0
  assert.ok(d.days.filter((x) => x.v === null).length === 8);
});

test("the art prints metric and French from the same inches: totals, months, units, no inch left", async () => {
  const ctx = makeCtx(FILES);
  vm.runInNewContext(read("components/rain-print-art.js"), ctx);
  const d = await ctx.RainPrint.daily("CAN04016322", 2024);
  const base = { year: 2024, place: "Qu'Appelle (Saskatchewan)", name: "Ferme Côté", days: d.days, D: d.d, axisLen: d.d.n, showDry: true,
    gauge: "Station météo : Qu'Appelle 1, SK, 4,0 km de Qu'Appelle", markers: [], records: [] };
  for (const style of ["r1", "r2"]) {
    const fr = ctx.AgRainArt.render({ ...base, style, loc: { units: "mm", lang: "fr" } });
    assert.match(fr, /421 mm/, style + ": 420.9 mm prints as 421 mm");
    assert.match(fr, /111 cm/, style + ": snowfall in cm");
    assert.match(fr, /JUIN/, style + ": French months");
    assert.match(fr, /129/, style + ": June 128.9 mm prints as 129");
    assert.doesNotMatch(fr, /\d in\b|inches|\bJUN\b/, style + ": no inches, no English month");
    assert.doesNotMatch(fr, /—/, style + ": no em dash");
    assert.match(fr, /Jours de pluie ou de neige : 86/, style + ": French facts with the space before the colon");
    const en = ctx.AgRainArt.render({ ...base, style, loc: { units: "mm", lang: "en" }, place: "Qu'Appelle, Saskatchewan", gauge: "" });
    assert.match(en, /421 mm/);
    assert.match(en, /Days with rain or snow: 86/);
    assert.match(en, />JUN</);
    // inches and English: the print exactly as a US one
    const us = ctx.AgRainArt.render({ ...base, style, place: "Qu'Appelle, Saskatchewan", gauge: "" });
    assert.match(us, /16\.57 in/);
    assert.doesNotMatch(us, / mm\b| cm\b/);
  }
  // the biggest rain, French, the day before the month
  const r1 = ctx.AgRainArt.render({ ...base, style: "r1", loc: { units: "mm", lang: "fr" } });
  assert.match(r1, /Plus grosse pluie : 32,4 mm/);
  assert.match(r1, /27 juin/);
});

test("metric conversion: 25.4 mm to the inch, 2.54 cm, French commas and spaces", () => {
  const ctx = makeCtx(FILES);
  vm.runInNewContext(read("components/rain-print-art.js"), ctx);
  const days = [];
  for (let i = 0; i < 365; i++) days.push({ date: new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10), v: 0, flag: "", s: 0, m: new Date(Date.UTC(2023, 0, 1 + i)).getUTCMonth(), doy: i });
  days[100].v = 1; days[200].v = 0.5; days[10].v = 0.2; days[10].s = 2;   // 1.7 in = 43.18 mm; snow 2 in = 5.08 cm
  const D = ctx.RainPrint.derive(days);
  const svg = ctx.AgRainArt.render({ style: "r1", year: 2023, place: "Brandon, Manitoba", days, D, axisLen: 365, showDry: false, markers: [], records: [], loc: { units: "mm", lang: "en" } });
  assert.match(svg, /43 mm/);
  assert.match(svg, /Biggest rain: 25\.4 mm/);
  const fr = ctx.AgRainArt.render({ style: "r2", year: 2023, place: "Brandon (Manitoba)", days, D, axisLen: 365, showDry: false, markers: [], records: [], loc: { units: "mm", lang: "fr" } });
  assert.match(fr, /25,4 mm/);
  assert.match(fr, /5 cm/);
  // a wet coast year over a metre: a space between thousands in French
  const wet = days.map((x) => ({ ...x, v: 0.15, s: 0 }));
  const W = ctx.AgRainArt.render({ style: "r2", year: 2023, place: "Agassiz (Colombie-Britannique)", days: wet, D: ctx.RainPrint.derive(wet), axisLen: 365, showDry: false, markers: [], records: [], loc: { units: "mm", lang: "fr" } });
  assert.match(W, /1 391 mm/, "365 x 0.15 in = 1390.7 mm");
});

test("French strings are all there (FR-REVIEW list), plain words, no em dash", () => {
  const ctx = makeCtx(FILES);
  vm.runInNewContext(read("components/rain-print-art.js"), ctx);
  const FR = ctx.AgRainArt.FR;
  for (const k of ["rain and melted snow", "Biggest rain", "About a usual year", "Days with rain or snow", "Snow", "a usual year", "usual", "SNOWFALL", "PREVIEW"]) assert.ok(FR[k], k);
  const all = Object.values(FR).join(" ") + JSON.stringify(ctx.AgRpCanada.T.fr, (k, v) => (typeof v === "function" ? v("C") : v));
  assert.doesNotMatch(all, /—/);
  assert.match(all, /Source des données : Environnement et Changement climatique Canada/);
});

test("missing days: over 31 refuses the print, the same rule as the US path", async () => {
  // Pierreville with 30 more days taken out (38 missing): refused; with 20 taken out (28): drawn with gaps
  const rows = read("test/fixtures/rp-canada/CAN07026043-2024.csv").trim().split("\n");
  const cut = (n) => { let k = 0; return rows.filter((r) => !(r.includes(",PRCP,") && r.split(",")[1] >= "20240301" && k++ < n)).join("\n") + "\n"; };
  const files = { ...FILES };
  files["/csv/by_station/CAN07026043.csv"] = cut(30);
  const ctx = makeCtx(files);
  const d = await ctx.RainPrint.daily("CAN07026043", 2024);
  assert.equal(d.d.missing, 38);
  assert.ok(d.d.missing > 31, "the page blocks the print past MISS_BLOCK (31)");
  files["/csv/by_station/CAN07026043.csv"] = cut(20);
  const ctx2 = makeCtx(files);
  const d2 = await ctx2.RainPrint.daily("CAN07026043", 2024);
  assert.equal(d2.d.missing, 28);
  assert.ok(d2.days.filter((x) => x.v === null).length === 28);
});

test("a multi-day total is S days and an A day; a failed check or a summary source is missing", () => {
  const ctx = makeCtx(FILES);
  const C = ctx.AgRpCanada;
  const by = C.rowsByDate([
    "CA1XX0000001,20240101,PRCP,25,,,N,",
    "CA1XX0000001,20240102,PRCP,0,T,,N,",
    "CA1XX0000001,20240103,PRCP,0,P,,C,",
    "CA1XX0000001,20240104,PRCP,99,,X,C,",
    "CA1XX0000001,20240105,PRCP,12,,,S,",
    "CA1XX0000001,20240108,MDPR,40,,,N,",
    "CA1XX0000001,20240108,DAPR,3,,,N,",
    "CA1XX0000001,20240101,SNOW,30,,,N,",
  ]);
  const rows = C.acisRows(by, 2024, "");
  assert.equal(rows.length, 366);
  near(+rows[0][1], 2.5 / 25.4, 1e-6, "2.5 mm in inches");
  near(+rows[0][3], 30 / 25.4, 1e-6, "30 mm of snow in inches");
  assert.equal(rows[1][1], "T");
  assert.equal(rows[2][1], "M", "missing presumed zero is missing");
  assert.equal(rows[3][1], "M", "failed quality check");
  assert.equal(rows[4][1], "M", "made from hourly summaries");
  assert.deepEqual(Array.from(rows.slice(5, 8), (r) => r[1].replace(/[\d.]+A/, "nA")), ["S", "S", "nA"]);
});

test("town and postal code: provinces, French names, rural postal areas ask for a town", async () => {
  const ctx = makeCtx(FILES);
  const C = ctx.AgRpCanada;
  assert.deepEqual({ ...C.parseQuery("Regina, SK") }, { postal: "", fsa: "", town: "Regina", prov: "sk" });
  assert.equal(C.parseQuery("Saint-Hyacinthe Québec").prov, "qc");
  assert.equal(C.parseQuery("Saint-Hyacinthe, Quebec").town, "Saint-Hyacinthe");
  assert.equal(C.parseQuery("Brandon Manitoba").prov, "mb");
  assert.equal(C.parseQuery("Steinbach, MB, Canada").prov, "mb");
  assert.equal(C.parseQuery("s4p 3y2").fsa, "S4P");
  assert.equal(C.parseQuery("Chetek, WI"), null, "a US town stays on the US path");
  assert.equal(C.parseQuery("Ames IA"), null);
  assert.equal(C.parseQuery("54728"), null);
  const F = (u) => ctx.fetch(u);
  const hit = await C.geoAsk("S4L 1A1", F);
  assert.equal(hit.name, "Regina");
  assert.equal(hit.prov, "sk");
  await assert.rejects(C.geoAsk("T0A 1A0", F), (e) => e.rural && /rural postal area/.test(e.message) && /St\. Paul, AB/.test(e.message));
  await assert.rejects(C.geoAsk("J0H 1A0", F, "fr"), (e) => e.rural && /grande région rurale/.test(e.message));
  assert.equal(C.placeLong("Pierreville", "qc", "fr"), "Pierreville (Québec)");
  assert.equal(C.placeLong("Regina", "sk", "en"), "Regina, Saskatchewan");
  assert.equal(C.niceName("SAINT-GERMAIN-DE-GRANTHAM", "C"), "Saint-Germain-de-Grantham");
  assert.equal(C.niceName("REGINA 3.8 NW", "N"), "Regina");
  assert.equal(C.niceName("QU'APPELLE 1", "C"), "Qu'Appelle 1");
});

test("the station list: whole years first, nearest first; snow known from the list; defaults by province", async () => {
  const ctx = makeCtx(FILES);
  const C = ctx.AgRpCanada;
  const list = await C.stations((u) => ctx.fetch(u), 50.4452, -104.6189, 2024, { today: "2026-10-16", stale: 30 });   // Regina
  assert.ok(list.length > 3);
  const firstC = list.findIndex((s) => !s.whole);
  assert.ok(firstC === -1 || list.slice(firstC).every((s) => !s.whole), "whole years before the rest");
  assert.ok(list.every((s) => s.km <= 70));
  assert.ok(list.every((s) => s.ca && /^CA/.test(s.sid)));
  const qa = (await C.stations((u) => ctx.fetch(u), 50.5667, -103.9833, 2024, {}))[0];
  assert.equal(qa.sid, "CAN04016322");
  assert.equal(qa.snowOk, true);
  assert.deepEqual({ ...C.defaultsFor("qc") }, { units: "mm", lang: "fr" });
  assert.deepEqual({ ...C.defaultsFor("sk") }, { units: "mm", lang: "en" });
  // the comparison: the station's own 1991-2020 normals, spread over each month; a gauge without borrows a neighbour's, named
  const n = await C.normalJson((u) => ctx.fetch(u), "CAN04016322", 2024);
  const june = n.data.filter((r) => r[0].slice(5, 7) === "06").reduce((a, r) => a + +r[1], 0) * 25.4;
  near(june, 91.3, 0.01, "June normal at Qu'Appelle");
  assert.equal(C.normalFrom("CAN04016322").own, true);
});

test("design code and link carry units and language; a US code is unchanged", () => {
  const ctx = makeCtx(FILES);
  const RP = ctx.RainPrint;
  const plain = (x) => JSON.parse(JSON.stringify(x));
  const us = { place: "Chetek, WI", station: "471667 2", year: 2025, cmp: "normal", name: "The Olson Farm" };
  const usCode = RP.encodeCode(us);
  assert.equal(Buffer.from(usCode, "base64url").toString().split("|")[4].length, 5, "no letter added for a US design");
  for (const units of ["", "in", "mm"]) for (const lang of ["", "en", "fr"]) {
    const s = { place: "Pierreville, QC", station: "CAN07026043", year: 2024, name: "Ferme Côté", units, lang, logo: units === "mm" ? "abcdefghjk12" : "" };
    assert.deepEqual(plain(RP.decodeCode(RP.encodeCode(s))), plain(RP.normalize(s)), units + "/" + lang);
    assert.deepEqual(plain(RP.fromParams("?" + RP.toParams(s))), plain(RP.normalize(s)), "link " + units + "/" + lang);
  }
  assert.deepEqual({ ...RP.locOf(RP.normalize({ place: "Pierreville, QC" }), true, "qc") }, { units: "mm", lang: "fr" });
  assert.deepEqual({ ...RP.locOf(RP.normalize({ place: "Pierreville, QC", units: "in", lang: "en" }), true, "qc") }, { units: "in", lang: "en" });
  assert.deepEqual({ ...RP.locOf(RP.normalize({ place: "Chetek, WI" }), false, "") }, { units: "in", lang: "en" });
  assert.equal(RP.isCanada("Regina, SK"), true);
  assert.equal(RP.isCanada("CAN04016322"), true);
  assert.equal(RP.isCanada("Chetek, WI"), false);
});

test("remarkable days in metric and French, rebuilt from the records layer's values", () => {
  const ctx = makeCtx(FILES);
  const C = ctx.AgRpCanada;
  const loc = { units: "mm", lang: "fr" };
  assert.equal(C.recordLabel({ kind: "coldest", value: -22, label: "Coldest day: -22°F", ties: [] }, loc), "Journée la plus froide : -30 °C");
  assert.equal(C.recordLabel({ kind: "snowDay", value: 8, label: "Biggest snow: 8.0 in", ties: ["2024-02-03"] }, loc), "Plus grosse neige : 20,3 cm (aussi 3 févr.)");
  assert.equal(C.recordLabel({ kind: "wetWeek", value: 3.1, label: "Wettest week: 3.10 in" }, { units: "mm", lang: "en" }), "Wettest week: 79 mm");
  assert.equal(C.recordLabel({ kind: "wetYear", value: 30, label: "Wettest year since 1987" }, loc), "Année la plus arrosée depuis 1987");
  assert.equal(C.recordLabel({ kind: "wetMonth", value: 6.1, date: "2024-06-01", label: "x", basis: { rank: 1, tied: 0, of: 88 } }, loc), "Juin le plus arrosé en 88 années complètes : 155 mm");
  assert.equal(C.recordLabel({ kind: "lastFrost", value: 30, label: "Last frost: 30°F" }, { units: "mm", lang: "en" }), "Last frost: -1°C");
  assert.equal(C.recordLabel({ kind: "coldest", value: -22, label: "Coldest day: -22°F" }, {}), "Coldest day: -22°F", "US: as the layer said");
});

test("credits follow the ECCC licence wording; no em dash in the module", () => {
  const src = read("components/rp-canada.js");
  assert.match(src, /Data Source: Environment and Climate Change Canada/);
  assert.match(src, /eccc-msc\.github\.io\/open-data\/licence/);
  assert.doesNotMatch(src, /—/);
});
