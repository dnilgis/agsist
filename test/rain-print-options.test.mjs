/* Rain Print options of 2026-10-17 (Sig): crop stages, every year behind your year,
 * frost marks, the hottest and coldest day, the temperature ribbon.
 *
 * Pure checks, by hand from the sources:
 *   - growing degree days the GDU calculator's way (86/50, from the planting day);
 *   - corn and soybean stage days from components/gdu-stages.js on made-up weather;
 *   - a day with no temperature stops the count; harvest stops the season;
 *   - the days ahead of or behind a usual year;
 *   - full years, the remarkable-years picker and the rank note;
 *   - frost dates and the hottest and coldest day from the records layer, withheld when a gap could change them;
 *   - the design code, the query string and the short-link rule carry every option; old codes open as made.
 * In a real browser (skipped without Playwright): the page draws the options from a link, the
 * options panel follows, the URL, the code, the order's design link and the proof sheet carry them.
 * RP_SHOTS=<dir> saves the options panel at 390 and 1280 px.
 *
 *   node --test test/rain-print-options.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctx.window = ctx;
for (const f of ["components/qr.js", "components/rain-print.js", "components/rain-print-records.js", "components/gdu-stages.js", "components/rain-print-extras.js", "components/rain-print-art.js"]) vm.runInNewContext(read(f), ctx);
const RP = ctx.RainPrint, X = ctx.AgRainExtras, REC = ctx.AgRainRecords, ART = ctx.AgRainArt;
const plain = (o) => JSON.parse(JSON.stringify(o));
const DAY = 864e5;
const iso = (y, i) => new Date(Date.UTC(y, 0, 1) + i * DAY).toISOString().slice(0, 10);
const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
// a year of highs and lows: f(i) -> [hi, lo] or null for a day with no reading
const temps = (y, f) => { const rows = []; for (let i = 0; i < (leap(y) ? 366 : 365); i++) { const t = f(i); rows.push([iso(y, i), "0.00", "M", "0.0", t ? String(t[0]) : "M", t ? String(t[1]) : "M"]); } return rows; };

// ---------- growing degree days and the stages ----------
test("one day's growing degree days, the GDU calculator's 86/50", () => {
  assert.equal(X.gduDay(80, 60), 20);        // (80 + 60) / 2 - 50
  assert.equal(X.gduDay(95, 40), 18);        // both held: (86 + 50) / 2 - 50
  assert.equal(X.gduDay(45, 30), 0);         // a cold day counts nothing, never less
  assert.equal(X.gduDay(90, 70), 28);        // (86 + 70) / 2 - 50
  // the same rule the calculator page runs
  assert.match(read("gdu-calculator.html"), /86/);
});

test("corn stages by hand: 20 GDU a day from May 1 (Purdue NCH-40 thresholds in gdu-stages.js)", () => {
  const td = X.tempDays(temps(2025, () => [80, 60]), 2025);
  const r = X.cropStages("corn", td, "2025-05-01", "2025-10-31");
  // VE 120: 6 days counting May 1 -> May 6; V6 475: 24 days -> May 24; R1 1400: 70 days -> Jul 9; R5 2190: 110 days -> Aug 18; R6 2700: 135 days -> Sep 12
  assert.deepEqual(plain(r.stages.map((s) => [s.key, s.date])), [["VE", "2025-05-06"], ["V6", "2025-05-24"], ["R1", "2025-07-09"], ["R5", "2025-08-18"], ["R6", "2025-09-12"]]);
  assert.equal(r.stop, null);
  assert.deepEqual(plain(r.stages.map((s) => s.label)), ["Emerged", "V6", "Silk", "Dent", "Black layer"]);
  const g = ctx.AgGduStages.corn;
  assert.deepEqual(plain(r.stages.map((s) => s.gdu)), ["VE", "V6", "R1", "R5", "R6"].map((k) => g.find((x) => x.s === k).gdu), "the site's one table");
});

test("soybean stages by hand: 20 GDU a day from May 10; emergence and V3 only", () => {
  const td = X.tempDays(temps(2025, () => [80, 60]), 2025);
  const r = X.cropStages("soy", td, "2025-05-10", "2025-10-15");
  // VE 130: 7 days -> May 16; V3 400: 20 days -> May 29. Flowering, seed fill and maturity follow day length and variety: not drawn
  assert.deepEqual(plain(r.stages.map((s) => [s.key, s.date])), [["VE", "2025-05-16"], ["V3", "2025-05-29"]]);
  assert.equal(r.stop, null, "the season is done once V3 is placed");
  assert.equal(X.CROPS.soy.key, "V3", "the usual-year comparison is for V3");
  assert.match(X.CROPS.soy.foot, /soybean flowering and maturity depend on day length and variety, so they are not drawn/);
  // the usual-year note for soybeans, by hand: 24 a day reaches V3 400 on day 17 (May 26), 20 a day on day 20 (May 29): 3 days ahead
  const warm = X.tempDays(temps(2025, () => [84, 64]), 2025);
  const s = RP.normalize({ place: "Ames, IA", year: 2025, crop: "soy", cropPlant: "2025-05-10", cropHarvest: "2025-10-15", plants: true, ghost: true });
  const c = RP.cropInput(s, warm, td);
  assert.deepEqual(plain(c.note), { key: "V3", days: 3, text: "3 days ahead of a usual year" });
  assert.deepEqual(plain(c.ghost.map((g) => g.key)), ["VE", "V3"]);
});

test("a day with no high or low stops the count; harvest ends the season; nothing is filled in", () => {
  const gap = X.tempDays(temps(2025, (i) => (i === 130 ? null : [80, 60])), 2025);   // May 11 missing
  const r = X.cropStages("corn", gap, "2025-05-01", "2025-10-31");
  assert.deepEqual(plain(r.stages.map((s) => s.key)), ["VE"], "only the stage reached before the gap");
  assert.equal(r.stop, "missing");
  assert.equal(r.stopDate, "2025-05-11");
  const early = X.cropStages("corn", X.tempDays(temps(2025, () => [80, 60]), 2025), "2025-05-01", "2025-08-01");
  assert.deepEqual(plain(early.stages.map((s) => s.key)), ["VE", "V6", "R1"], "dent and black layer come after harvest: not drawn");
  assert.equal(early.stop, "harvest");
  assert.equal(X.cropStages("corn", gap, "2025-10-01", "2025-05-01"), null, "harvest before planting: nothing");
  assert.equal(X.cropStages("sunflower", gap, "2025-05-01", "2025-10-01"), null, "no sunflowers until the source is read");
  assert.equal(X.SUNFLOWERS, false);
  assert.ok(!/sunflower/i.test(read("rain-print.html")), "and the page doesn't offer them");
});

test("days ahead of or behind a usual year: the key stage only, and only when both reached it", () => {
  const warm = X.tempDays(temps(2025, () => [84, 64]), 2025), usual = X.tempDays(temps(2025, () => [80, 60]), 2025);
  // 24 GDU a day: R1 1400 in 59 days (Jun 28); usual 20 a day: 70 days (Jul 9): 11 days ahead
  const a = X.cropStages("corn", warm, "2025-05-01", "2025-10-31"), b = X.cropStages("corn", usual, "2025-05-01", "2025-10-31");
  assert.deepEqual(plain(X.compare(a, b, "R1")), { key: "R1", days: 11, text: "11 days ahead of a usual year" });
  assert.equal(X.compare(b, a, "R1").text, "11 days behind a usual year");
  assert.equal(X.compare(a, a, "R1").text, "Same day as a usual year");
  const cut = X.cropStages("corn", usual, "2025-05-01", "2025-06-01");
  assert.equal(X.compare(cut, b, "R1"), null, "not reached by harvest: no note");
  // the engine's crop input carries it, with its foot-line words
  const s = RP.normalize({ place: "Ames, IA", year: 2025, crop: "corn", cropPlant: "2025-05-01", cropHarvest: "2025-10-31", plants: true, ghost: true });
  const c = RP.cropInput(s, warm, usual);
  assert.equal(c.note.text, "11 days ahead of a usual year");
  assert.ok(c.foot.some((t) => /Purdue NCH-40/.test(t)) && c.foot.some((t) => /NOAA 1991 to 2020 normal temperatures/.test(t)));
  assert.equal(RP.cropInput(Object.assign({}, s, { ghost: false }), warm, usual).note, null, "no usual year asked: no note");
});

test("NOAA normal highs and lows read the ACIS normal answer's columns", () => {
  const n = X.normalTemps([["2025-01-01", "24", "8"], ["2025-01-02", "M", "8"]], 2025);
  assert.equal(n.hi[0], 24); assert.equal(n.lo[0], 8); assert.equal(n.hi[1], null);
  assert.equal(X.tempGaps(n, 0, 1), 1);
});

// ---------- every year behind your year ----------
const por = (from, to, f) => { const rows = []; for (let y = from; y <= to; y++) for (let i = 0; i < (leap(y) ? 366 : 365); i++) rows.push([iso(y, i), f(y, i)]); return rows; };
test("full years: every day reported, an S run closed by its A day; the rest are left out", () => {
  const rows = por(2001, 2004, (y, i) => (y === 2002 && i === 40 ? "M" : y === 2003 && i === 10 ? "S" : y === 2003 && i === 11 ? "0.40A" : y === 2004 && i === 365 ? "S" : i % 10 === 0 ? "0.10" : "0.00"));
  const f = X.fullYears(rows, 1);
  assert.deepEqual(plain(f.map((x) => x.year)), [2001, 2003], "2002 has a missing day, 2004 ends on an open S run");
  assert.equal(f[0].cum.length, 365);
  assert.equal(f[0].total, 3.7, "37 tenths: days 0, 10, ..., 360");
  assert.equal(f[1].total, 4, "day 10 is S (0, its 0.10 rolled in), day 11 the A day of 0.40: 3.60 + 0.40");
  assert.deepEqual(plain(X.fullYears(por(2004, 2004, () => "T"), 1).map((x) => [x.year, x.cum.length, x.total])), [[2004, 366, 0]], "a leap year has 366 days; a trace is 0");
});

test("the remarkable years: the 2 wettest and 2 driest of the other full years", () => {
  const full = [[1990, 30], [1991, 41.2], [1992, 22.5], [1993, 50.1], [1994, 29], [1995, 18.4], [1996, 33]].map(([year, total]) => ({ year, total, cum: [] }));
  assert.deepEqual(plain(X.remarkableYears(full, 1996)), { dry: [1995, 1992], wet: [1993, 1991] });
  // the buyer's own year is never one of them, even when it is the driest
  assert.deepEqual(plain(X.remarkableYears(full, 1995)), { dry: [1992, 1994], wet: [1993, 1991] });
  assert.deepEqual(plain(X.remarkableYears(full.slice(0, 4), 1990)), { dry: [], wet: [] }, "under 4 others: none");
});

test("the rank note: from the nearer end, a tie said as a tie, only for a full year", () => {
  const full = [10, 20, 30, 40, 50, 60].map((t, k) => ({ year: 2000 + k, total: t, cum: [] }));
  assert.equal(X.rank(full, 2001).text, "2nd driest of the 6 full years this station has kept");
  assert.equal(X.rank(full, 2000).text, "The driest of the 6 full years this station has kept");
  assert.equal(X.rank(full, 2005).text, "The wettest of the 6 full years this station has kept");
  assert.equal(X.rank(full, 2004).text, "2nd wettest of the 6 full years this station has kept");
  const tied = full.concat([{ year: 2010, total: 20, cum: [] }]);
  assert.equal(X.rank(tied, 2001).text, "Tied for 2nd driest of the 7 full years this station has kept");
  assert.equal(X.rank(full, 2020), null, "a year that isn't full gets no rank");
  // the engine's history input: nothing under 30 full years
  const many = Array.from({ length: 30 }, (_, k) => ({ year: 1990 + k, total: 20 + k, cum: [1, 2] }));
  assert.equal(RP.histInput(many.slice(0, 29), 2000), null, "29 full years: no threads");
  const h = RP.histInput(many, 2000);
  assert.equal(h.threads.length, 29, "the other 29 years");
  assert.ok(!h.threads.some((t) => t.year === 2000), "the buyer's year is not a thread");
  assert.deepEqual(plain(h.labels), { dry: [1990, 1991], wet: [2019, 2018] });
  assert.equal(h.note, "11th driest of the 30 full years this station has kept");
  assert.match(h.foot, /the other 29 full years this station kept, 1990 to 2019 \(the nearest station with 30 or more\)/);
});

// ---------- frost, the hottest and coldest day ----------
const ELEMS = ["pcpn", "avgt", "snow", "maxt", "mint"];
test("frost dates and the hottest and coldest day, by hand; withheld when a gap could change them", () => {
  // lows: 25 F through Apr 10 (day 99), 40 F after; a 31 F low on Oct 3 (day 275); highs 70, one 99 F day on Jul 20 (day 200), coldest -8 F on Jan 15 (day 14)
  const f = (i) => [i === 200 ? 99 : 70, i === 14 ? -8 : i <= 99 ? 25 : i >= 275 ? 31 : 40];
  const rows = temps(2025, f);
  const found = REC.find({ year: 2025, daily: { data: rows }, dailyElems: ELEMS }, { kinds: RP.TEMP_KINDS });
  const s = RP.normalize({ place: "X", year: 2025, frost: true, heat: true, ribbon: true });
  const td = X.tempDays(rows, 2025);
  const t = RP.tempInput(s, td, found, { same: false, name: "Ames Municipal Airport", words: "3.1 mi away" }, false);
  assert.deepEqual(plain(t.frost), [{ key: "last", doy: 99, date: "2025-04-10" }, { key: "first", doy: 275, date: "2025-10-03" }]);
  assert.deepEqual(plain(t.foot), ["Temperatures: Ames Municipal Airport, 3.1 mi away; frost is a low of 32°F or colder", "Hottest day: 99°F Jul 20", "Coldest: -8°F Jan 15"]);
  // no normals asked for yet (undefined): no stripes, and nothing said yet; the hottest and coldest go in the foot line as before
  assert.equal(t.ribbon, null);
  // a missing low after the last frost could hide a later one: no last frost claimed
  const gap = temps(2025, (i) => (i === 120 ? null : f(i)));
  const g2 = REC.find({ year: 2025, daily: { data: gap }, dailyElems: ELEMS }, { kinds: RP.TEMP_KINDS });
  const t2 = RP.tempInput(s, X.tempDays(gap, 2025), g2, { same: true }, false);
  assert.deepEqual(plain(t2.frost.map((x) => x.key)), ["first"], "the last frost is withheld");
  assert.equal(t2.foot[0], "Temperatures from the same station; frost is a low of 32°F or colder");
  // switches off: nothing
  assert.equal(RP.tempInput(RP.normalize({ place: "X", year: 2025 }), td, found, { same: true }, false), null);
  // more than 10 days missing: the station is not used for temperatures at all
  const thin = X.tempDays(temps(2025, (i) => (i % 30 === 0 ? null : [70, 50])), 2025);
  assert.equal(RP.tempStationOk(thin), false);
  assert.equal(RP.tempStationOk(td), true);
  assert.equal(X.ribbonScale(X.tempDays(temps(2025, (i) => (i < 200 ? null : [70, 50])), 2025)), null, "the ribbon needs half the year read");
});

// ---------- the temperature stripes (option C, Sig 2026-10-21) ----------
test("stripes: each day's average against the station's normal for that date, by hand; missing days blank, never filled", () => {
  // highs and lows: 80/60 every day (average 70), except day 10 (90/70, average 80), day 20 (no low) and day 30 (40/20, average 30)
  const f = (i) => (i === 10 ? [90, 70] : i === 20 ? [75, null] : i === 30 ? [40, 20] : [80, 60]);
  const rows = temps(2025, (i) => f(i)).map((r, i) => (i === 20 ? [r[0], r[1], r[2], r[3], r[4], "M"] : r));
  const td = X.tempDays(rows, 2025);
  // normals: 74/56 (average 65) every day, none on day 40 (NOAA left the date out), 74.6/55.9 on day 50
  const nrows = Array.from({ length: 365 }, (_, i) => [X.isoOf(2025, i), i === 50 ? "74.6" : "74", i === 50 ? "55.9" : "56"]).filter((r, i) => i !== 40);
  const tdN = X.normalTemps(nrows, 2025);
  const sp = X.stripes(td, tdN);
  assert.equal(sp.dev.length, 365);
  assert.equal(sp.dev[0], 5, "70 against 65");
  assert.equal(sp.dev[10], 15, "80 against 65");
  assert.equal(sp.dev[30], -35, "30 against 65");
  assert.equal(sp.dev[50], 4.8, "70 against 65.25, to a tenth");
  assert.equal(sp.dev[20], null, "no low: blank");
  assert.equal(sp.dev[40], null, "no normal for the date: blank");
  assert.equal(sp.days, 363); assert.equal(sp.blank, 2);
  assert.equal(X.stripes(td, null), null, "no normals, no stripes");
  assert.equal(X.stripes(X.tempDays(temps(2025, (i) => (i < 200 ? null : [70, 50])), 2025), tdN), null, "fewer than half the days: none");
  // the steps: symmetric, 3, 9 and 15 F each way
  const st = ART.stripeStep;
  assert.deepEqual(plain([-20, -15, -14.9, -9, -8.9, -3, -2.9, 0, 2.9, 3, 8.9, 9, 14.9, 15, 20].map(st)), [-3, -3, -2, -2, -1, -1, 0, 0, 0, 1, 1, 2, 2, 3, 3]);
  for (let v = 0; v <= 30; v += 0.5) assert.equal(st(-v), -st(v) || 0, "symmetric at " + v);
  assert.equal(ART.STRIPE_INK.length, 7);
  assert.deepEqual(plain(ART.STRIPE_STEPS), [3, 9, 15]);
});

test("stripes: the hottest and coldest days are named from the records finder (ties, withholding), and the fallbacks say so", () => {
  // highs 70 with 99 F on Jul 20 (day 200) and again Aug 2 (day 213); lows 50 with -8 F on Jan 15 (day 14)
  const f = (i) => [i === 200 || i === 213 ? 99 : 70, i === 14 ? -8 : 50];
  const rows = temps(2025, f), td = X.tempDays(rows, 2025);
  const tdN = X.normalTemps(Array.from({ length: 365 }, (_, i) => [X.isoOf(2025, i), "72", "48"]), 2025);
  const found = REC.find({ year: 2025, daily: { data: rows }, dailyElems: ELEMS }, { kinds: RP.TEMP_KINDS });
  const s = RP.normalize({ place: "X", year: 2025, ribbon: true });
  const t = RP.tempInput(s, td, found, { same: true }, false, tdN);
  assert.equal(t.ribbon.dev[0], 0);
  assert.deepEqual(plain(t.ribbon.hot), { doy: 200, v: 99, date: "Jul 20", also: "also Aug 2" });
  assert.deepEqual(plain(t.ribbon.cold), { doy: 14, v: -8, date: "Jan 15", also: "" });
  assert.deepEqual(plain(t.foot), ["Temperatures from the same station"], "named on the strip, not twice in the foot line");
  // with the hottest and coldest day also on, still named once (on the strip)
  const both = RP.tempInput(RP.normalize({ place: "X", year: 2025, ribbon: true, heat: true }), td, found, { same: true }, false, tdN);
  assert.ok(!both.foot.some((x) => /Hottest/.test(x)) && both.ribbon.hot.v === 99);
  // the art names them, with dates and values, and draws the key and the foot line
  const I = { style: "r1", year: 2025, place: "X", name: "", days: DAYS, D: RP.derive(DAYS), axisLen: 365, markers: [], records: [], temp: t, qr: { matrix: RP.standardMatrix(), serial: "" } };
  for (const style of ["r1", "r2"]) {
    const svg = ART.render(Object.assign({}, I, { style })), tx = texts(svg);
    assert.ok(tx.includes("Hottest day: 99°F Jul 20 (also Aug 2)"), style + ": hottest named: " + tx.filter((x) => /Hott/.test(x)));
    assert.ok(tx.includes("Coldest day: −8°F Jan 15"), style + ": coldest named");
    assert.match(svg, /<g data-rp="temp:0">/); assert.match(svg, /<g data-rp="temp:1">/);
    const key = /<g data-rp="tkey">([\s\S]*?)<\/g>/.exec(svg);
    assert.ok(key, style + ": the key");
    assert.equal((key[1].match(/<rect /g) || []).length, 7, style + ": seven swatches");
    for (const c of ART.STRIPE_INK) assert.ok(key[1].includes(c), style + ": swatch " + c);
    assert.ok(texts(key[0]).includes("colder") && texts(key[0]).includes("warmer"), style + ": colder and warmer said");
    assert.ok(tx.some((x) => /^Stripes: each day’s average temperature \(its high and low, averaged\) against this station’s 1991 to 2020 normal for that date; blue colder, rust warmer, in steps of 3, 9 and 15°F; a blank is a day with no reading/.test(x)), style + ": the foot line says what a stripe is (the average, against the normal)");
  }
  // a gap in the highs the finder can't rule out: the hottest is withheld, never guessed
  const gap = temps(2025, (i) => (i % 20 === 5 ? [null, 50] : f(i)));
  const g2 = REC.find({ year: 2025, daily: { data: gap }, dailyElems: ELEMS }, { kinds: RP.TEMP_KINDS });
  const t2 = RP.tempInput(s, X.tempDays(gap, 2025), g2, { same: true }, false, tdN);
  assert.equal(t2.ribbon.hot, null, "too many missing highs: no hottest day named");
  assert.equal(t2.ribbon.dev[5], null, "that day blank");
  // no normals for the station: no stripes, and the foot line says so and names the days instead
  const t3 = RP.tempInput(s, td, found, { same: true }, false, null);
  assert.equal(t3.ribbon, null);
  assert.deepEqual(plain(t3.foot), ["Temperatures from the same station", "Temperature stripes left off: NOAA has no daily normal temperatures for this station", "Hottest day: 99°F Jul 20 (also Aug 2)", "Coldest: -8°F Jan 15"]);
  const t4 = RP.tempInput(s, td, found, { same: true }, false, false);
  assert.match(t4.foot[1], /didn’t load just now/);
  const svg3 = ART.render(Object.assign({}, I, { temp: t3 }));
  assert.ok(!/data-rp="ribbon"/.test(svg3) && texts(svg3).some((x) => /Temperature stripes left off: NOAA has no daily normal temperatures/.test(x)), "the print says the stripes are off and why");
});

test("the remarkable days give up their temperature days to the temperature layer, so nothing prints twice", () => {
  const recs = [{ kind: "coldest", label: "Coldest day: -8°F" }, { kind: "snowDay", label: "Biggest snow: 8.0 in" }, { kind: "lastFrost", label: "Last frost: 25°F" }];
  assert.deepEqual(plain(RP.withoutTemp(recs, { frost: true }).map((r) => r.kind)), ["snowDay"]);
  assert.deepEqual(plain(RP.withoutTemp(recs, { frost: false, heat: false }).map((r) => r.kind)), ["coldest", "snowDay", "lastFrost"], "an old design keeps its own");
});

// ---------- the design code, the link, the short link ----------
const OPT = { place: "Ames, IA", station: "130200 2", year: 2012, style: "r1", cmp: "normal", name: "The Olson Farm",
  markers: [{ date: "2012-05-01", label: "Planted" }, { date: "2012-10-20", label: "Harvest done" }],
  crop: "corn", cropPlant: "2012-05-01", cropHarvest: "2012-10-20", plants: true, ghost: true, hist: true, frost: true, heat: true, ribbon: true };
test("every option round-trips through the design code and the query string", () => {
  const s = RP.normalize(OPT), code = RP.encodeCode(s), back = RP.decodeCode(code);
  for (const k of ["crop", "cropPlant", "cropHarvest", "plants", "ghost", "hist", "frost", "heat", "ribbon"]) assert.deepEqual(back[k], s[k], k);
  const fromQ = RP.fromParams("?" + RP.toParams(s));
  for (const k of ["crop", "cropPlant", "cropHarvest", "plants", "ghost", "hist", "frost", "heat", "ribbon"]) assert.deepEqual(fromQ[k], s[k], "query " + k);
  assert.match(RP.toParams(s), /crop=corn&plant=2012-05-01&harvest=2012-10-20&plants=1&ghost=1&hist=1&frost=1&heat=1&ribbon=1/);
  // each switch alone
  for (const k of ["plants", "ghost", "hist", "frost", "heat", "ribbon"]) {
    const one = RP.normalize(Object.assign({}, OPT, { plants: false, ghost: false, hist: false, frost: false, heat: false, ribbon: false }, { [k]: true }));
    const d = RP.decodeCode(RP.encodeCode(one));
    for (const j of ["plants", "ghost", "hist", "frost", "heat", "ribbon"]) assert.equal(d[j], j === k, k + " alone: " + j);
  }
  // a gift code and the short-link rule keep them
  assert.equal(RP.decodeCode(RP.encodeCode(Object.assign({}, s, { gift: true }))).crop, "corn");
  const W = read("workers/subs-worker.js"), rule = /if \(!\(v2 \? (\/.*?\/) : \/\^\[a-z0-9\]\{4\}\$\/\)\.test\(f\[4\]\)\) return false;/.exec(W)[1];
  const re = new Function("return " + rule)();
  const key = atob(code.replace(/-/g, "+").replace(/_/g, "/")).split("|")[4];
  assert.ok(re.test(key), "the short-link worker takes the key field " + key);
  assert.ok(!re.test(key.replace("~", "~x")), "and refuses a letter it doesn't know");
});

test("a code or tool link made before the options opens as it was made; a hand link and a new visit get every layer (Sig, Oct 22)", () => {
  const old = Buffer.from("2|Ames, IA|130200 2|2012|spnad|The Olson Farm", "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const d = RP.decodeCode(old);
  assert.ok(d && !d.frost && !d.heat && !d.crop && !d.hist && !d.ribbon, "an old code: no new options");
  const tool = RP.fromParams("?place=Ames%2C+IA&year=2012&style=r1");
  assert.ok(!tool.frost && !tool.heat && !tool.ribbon && !tool.hist && !tool.normals && !tool.records, "a tool link (style=) without them: off, as it was made");
  const hand = RP.fromParams("?place=Ames%2C+IA&year=2012");
  assert.ok(hand.frost && hand.heat && hand.ribbon && hand.hist && hand.normals && hand.records && hand.cmp === "normal" && !hand.crop && !hand.plants && !hand.ghost,
    "a hand link: every layer on (frost, hottest and coldest, the daily stripes, every year behind, normals, remarkable days); the crop waits for its days");
  assert.ok(!RP.fromParams("?place=Ames%2C+IA&year=2012&frost=0").frost, "unless it says frost=0");
  for (const k of ["ribbon", "hist"]) assert.equal(RP.fromParams("?place=Ames%2C+IA&year=2012&" + k + "=0")[k], false, "unless it says " + k + "=0");
  // a code made by the tool before Oct 22 with only frost and heat on (key "~fh") opens with just those, and so does its link
  const was = RP.normalize({ place: "Ames, IA", station: "130200 2", year: 2012, cmp: "normal", normals: true, records: true, frost: true, heat: true });
  const wasCode = RP.encodeCode(was), back = RP.decodeCode(wasCode);
  assert.ok(back.frost && back.heat && !back.ribbon && !back.hist, "an Oct 21 code: frost and heat, no stripes, no threads");
  assert.deepEqual(RP.fromParams("?d=" + wasCode), back, "the same through ?d=");
  const wasLink = RP.fromParams("?" + RP.toParams(was));
  assert.ok(wasLink.frost && wasLink.heat && !wasLink.ribbon && !wasLink.hist, "and through the tool's own link");
  // a crop with its days out of order, or without days, is no crop; the plant switches mean nothing without one
  assert.equal(RP.normalize(Object.assign({}, OPT, { cropHarvest: "2012-04-01" })).crop, "");
  assert.equal(RP.normalize(Object.assign({}, OPT, { cropPlant: "" })).plants, false);
  assert.equal(RP.normalize(Object.assign({}, OPT, { crop: "sunflower" })).crop, "", "no sunflowers");
});

test("the order mail reads the options out of the design link", () => {
  const src = read("scripts/form_digest.py");
  assert.match(src, /def rp_options\(url\)/);
  assert.match(src, /rows\.append\(\("Options", rp_options\(p\.get\("design_url"\)\)\)\)/);
});

// ---------- the art: each option in both styles ----------
const DAYS = (() => {
  const out = [];
  for (let i = 0; i < 365; i++) {
    const d = iso(2025, i), p = i % 6 === 0 ? (0.15 + (i % 5) * 0.12).toFixed(2) : "0.00";
    const v = RP.parsePcpn(p), dt = new Date(d + "T00:00:00Z");
    out.push({ date: d, v: v.v, flag: v.flag, t: null, s: i < 50 && i % 11 === 0 ? 3 : 0, m: dt.getUTCMonth(), d: dt.getUTCDate(), doy: i });
  }
  return out;
})();
const T25 = temps(2025, (i) => { const t = 50 + 32 * Math.sin((i - 105) / 365 * 2 * Math.PI); return [Math.round(t + 10), Math.round(t - 10)]; });
function artInput(style, opts) {
  const D = RP.derive(DAYS), byDate = new Map(); DAYS.forEach((x) => byDate.set(x.date.slice(5), 0.09));
  const s = RP.normalize(Object.assign({ place: "Ames, IA", year: 2025, style, markers: [{ date: "2025-05-01", label: "Planted" }, { date: "2025-07-04", label: "Our wedding" }, { date: "2025-10-20", label: "Harvest done" }] }, opts));
  const td = X.tempDays(T25, 2025), tdN = X.normalTemps(T25.map((r) => [r[0], String(+r[4] - 2), String(+r[5] - 2)]), 2025);
  const found = REC.find({ year: 2025, daily: { data: T25 }, dailyElems: ELEMS }, { kinds: RP.TEMP_KINDS });
  const crop = RP.cropInput(s, td, s.ghost ? tdN : null);
  // 45 full years, 1981 to 2025, the print's own year among them (so the rank note prints)
  const full = Array.from({ length: 45 }, (_, k) => ({ year: 1981 + k, total: 18 + (k * 7) % 25, cum: Array.from({ length: 365 }, (_, i) => (18 + (k * 7) % 25) * (i + 1) / 365) }));
  return { style, year: 2025, place: "Ames, Iowa", name: "The Olson Farm", dedication: "For Dad", days: DAYS, D, showDry: RP.showDry(D), axisLen: 365,
    ov: RP.overlayDaily(DAYS, byDate), ovNote: "A usual year: NOAA’s 30-year normal", showNormals: true, markers: RP.markersOn(s.markers, 2025, 365), records: [],
    gauge: "Weather station: Ames, IA, 2.0 mi from Ames", crop, temp: RP.tempInput(s, td, found, { same: false, name: "Ames Municipal Airport", words: "3.1 mi away" }, !!crop, tdN),
    hist: s.hist && style === "r1" ? RP.histInput(full, 2025) : null, qr: { matrix: RP.standardMatrix(), serial: "" } };
}
const texts = (svg) => [...svg.matchAll(/<text[^>]*>((?:[^<]|<\/?tspan[^>]*>)*)<\/text>/g)].map((m) => m[1].replace(/<\/?tspan[^>]*>/g, ""));
const CROPON = { crop: "corn", cropPlant: "2025-05-01", cropHarvest: "2025-10-20" };
test("each option draws in both styles: plants on the soil line, stage words, frost marks, the ribbon, the threads", async () => {
  const { check, HARD, measure } = await import("./fixtures/rp-label-check.mjs");
  for (const style of ["r1", "r2"]) {
    const cases = { plants: { ...CROPON, plants: true }, labels: { ...CROPON }, ghost: { ...CROPON, plants: true, ghost: true }, soy: { crop: "soy", cropPlant: "2025-05-01", cropHarvest: "2025-10-20", plants: true },
      frost: { frost: true }, heat: { heat: true }, ribbon: { ribbon: true }, hist: { hist: true }, all: { ...CROPON, plants: true, ghost: true, frost: true, heat: true, ribbon: true, hist: true } };
    for (const [name, o] of Object.entries(cases)) {
      const I = artInput(style, o); I.measure = measure;
      const svg = ART.render(I), t = texts(svg), id = style + " " + name;
      assert.deepEqual(HARD(check(svg)).map((b) => b.kind + ": " + b.a + " / " + b.b), [], id + ": nothing overlaps, nothing small, nothing outside the safe area");
      if (o.crop) {
        const all = t.join(" | ");
        for (const s of I.crop.stages.filter((x) => x.doy <= I.crop.harvest)) assert.ok(all.includes(s.label), id + ": stage " + s.label + " is said");
        assert.ok(t.some((x) => /growing degree days \(86\/50\) from planting/.test(x)), id + ": the foot line says how");
        const plantGs = [...svg.matchAll(/<g fill="none" stroke="#5B616B" stroke-width="0.9"[^>]*>([\s\S]*?)<\/g>/g)].map((m) => m[1]);
        const plants = plantGs.length ? [null, plantGs.join("")] : null;
        if (o.plants) assert.ok(plants, id + ": plant drawings");
        else assert.ok(!/stroke="#5B616B" stroke-width="0.9" stroke-linecap="round"/.test(svg), id + ": no plant drawings when off");
        // the plants stand on the soil line: their lowest ink is the axis (Staircase) or the ground (Roots)
        if (o.plants) {
          const ys = [...plants[1].matchAll(/M[\d.]+,([\d.]+)V/g)].map((m) => +m[1]);
          const soil = style === "r1" ? 716 : 477;
          assert.ok(ys.length && ys.every((y) => Math.abs(y - soil) < 0.01 || (style === "r1" && I.temp && I.temp.ribbon && Math.abs(y - 664) < 0.01)), id + ": every stalk starts on the soil line: " + ys.join(","));
        }
        if (o.ghost) {
          assert.ok(/stroke="#CFCBC4"/.test(svg), id + ": gray usual-year plants");
          assert.ok(I.crop.note && t.some((x) => x.includes(I.crop.note.text)), id + ": the key stage says " + (I.crop.note && I.crop.note.text));
        }
      }
      if (o.frost) {
        assert.equal(I.temp.frost.length, 2);
        for (const f of I.temp.frost) assert.ok(t.some((x) => x === (f.key === "last" ? "Last frost " : "First frost ") + f.date.replace(/^2025-0?(\d+)-0?(\d+)$/, (m, a, b) => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][a - 1] + " " + b)) || t.some((x) => x.includes(f.key === "last" ? "Last frost" : "First frost")), id + ": " + f.key + " frost labeled");
        assert.equal((svg.match(/<g data-rp="frost:\d">/g) || []).length, 2, id + ": two tiny marks");
        assert.ok(t.some((x) => /frost is a low of 32°F or colder/.test(x)), id + ": the threshold in the foot line");
      }
      if (o.heat) assert.ok(t.some((x) => /Hottest day: \d+°F/.test(x)) && t.some((x) => /Coldest( day)?: [-−]?\d+°F/.test(x)), id + ": hottest and coldest named (the foot line, or the stripes when they are on)");
      if (o.ribbon) {
        const rib = /<g data-rp="ribbon">([\s\S]*?)<\/g>/.exec(svg);
        assert.ok(rib, id + ": the stripes");
        // one stripe a day (neighbours of one step share a rect): the rects cover every day the strip has a value for
        const rects = [...rib[1].matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="(#[0-9A-F]{6})"/g)];
        const days = I.temp.ribbon.dev.filter((v) => v !== null).length, wDay = (rects.length && (style === "r1" ? (1590 - 196) : (1690 - 205)) / 365);
        assert.ok(Math.abs(rects.reduce((a, m) => a + +m[3], 0) / wDay - days) < 0.01, id + ": a stripe for every day with a value");
        assert.ok(rects.every((m) => ART.STRIPE_INK.includes(m[5])), id + ": only the seven inks");
        assert.ok(rects.every((m) => +m[4] === 20), id + ": 20 units tall");
        assert.ok(/<g data-rp="tkey">/.test(svg), id + ": the key");
        assert.ok(t.some((x) => /Stripes: each day’s average temperature/.test(x)), id + ": the foot line says what a stripe is");
        assert.ok(t.some((x) => /^Hottest day: \d+°F/.test(x)) && t.some((x) => /^Coldest day: −?\d+°F/.test(x)), id + ": hottest and coldest named on the strip");
      }
      if (o.hist) {
        if (style === "r1") {
          assert.ok(/<g data-rp="hist">/.test(svg), id + ": the threads");
          for (const y of [...I.hist.labels.wet, ...I.hist.labels.dry]) assert.ok(t.includes(String(y)), id + ": " + y + " labeled at its thread's end");
          assert.ok(I.hist.note && t.includes(I.hist.note), id + ": the rank note " + I.hist.note);
        } else assert.ok(!/<g data-rp="hist">/.test(svg), id + ": Roots draws no threads");
      }
    }
  }
});

test("frost marks keep off the marked days' drop lines and the plants", () => {
  for (const style of ["r1", "r2"]) {
    const I = artInput(style, { ...CROPON, plants: true, frost: true });
    const svg = ART.render(I);
    const frostX = [...svg.matchAll(/<g data-rp="frost:\d"><path d="M([\d.]+),[\d.]+L([\d.]+)/g)].map((m) => (+m[1] + +m[2]) / 2);
    const stalks = [...(/<g data-rp="crop">([\s\S]*?)<\/g><\/g>/.exec(svg) || ["", ""])[1].matchAll(/M([\d.]+),[\d.]+V/g)].map((m) => +m[1]);
    for (const fx of frostX) for (const sx of stalks) assert.ok(Math.abs(fx - sx) >= 5, style + ": a frost mark at " + fx + " clears the plant at " + sx);
  }
});

// ---------- in a browser: the page ----------
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const SHOTS = process.env.RP_SHOTS || null;
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function series(y) {
  const r = rng(7 + y), out = [];
  for (let i = 0; i < (leap(y) ? 366 : 365); i++) {
    const d = iso(y, i);
    if (d > "2026-10-09") { out.push([d, "M", "M", "M", "M", "M"]); continue; }
    const u = r(), p = u < 0.12 ? (r() * r() * 2).toFixed(2) : u < 0.16 ? "T" : "0.00";
    const t = Math.round(44 + 32 * Math.sin((i - 105) / 365 * 2 * Math.PI));
    out.push([d, p, String(t), i < 60 && i % 9 === 0 ? "2.0" : "0.0", String(t + 10), String(t - 10)]);
  }
  return out;
}
const STN = { name: "CHETEK", sids: ["471667 2"], ll: [-91.65, 45.32], valid_daterange: [["1950-01-01", "2026-10-09"]], state: "WI", elev: 1050 };
async function mocks(c) {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  await c.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = new URL(r.request().url());
    if (u.host === "agsist-api.dnilgis.workers.dev") return r.request().method() === "OPTIONS" ? r.fulfill({ status: 204, headers: h }) : r.fulfill({ status: 503, headers: h, body: "x" });
    if (u.host === "geocoding-api.open-meteo.com") return r.fulfill({ json: { results: [{ name: "Chetek", latitude: 45.3141, longitude: -91.651, admin1: "Wisconsin", country_code: "US" }] } });
    if (u.host === "data.rcc-acis.org") {
      if (u.pathname === "/StnMeta") return r.fulfill({ json: { meta: [STN] } });
      let sdate = u.searchParams.get("sdate");
      if (u.searchParams.get("params")) {
        const p = JSON.parse(u.searchParams.get("params")), y = +String(p.sdate).slice(0, 4), days = [];
        for (let i = 0; i < (leap(y) ? 366 : 365); i++) days.push(iso(y, i));
        if (p.elems[0].name === "maxt") return r.fulfill({ json: { data: days.map((d, i) => { const t = Math.round(42 + 32 * Math.sin((i - 105) / 365 * 2 * Math.PI)); return [d, String(t + 10), String(t - 10)]; }) } });
        return r.fulfill({ json: { data: days.map((d) => [d, "0.08"]) } });
      }
      if (sdate === "por") { let data = []; for (let y = 1990; y <= 2025; y++) data = data.concat(series(y).map((x) => [x[0], x[1], x[2]])); return r.fulfill({ json: { data } }); }
      return r.fulfill({ json: { meta: { name: STN.name, state: "WI", ll: STN.ll }, data: series(+String(sdate).slice(0, 4)) } });
    }
    return r.abort();
  });
}
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x"), p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" }); res.end(readFileSync(p));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
const drawn = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled, null, { timeout: 30000 });

test("the page: options from a link draw, the panel follows, and the URL, code, order link and proof carry them", { skip }, async () => {
  const srv = await serve(), base = "http://127.0.0.1:" + srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [1280, 390]) {
      const c = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
      await c.clock.setFixedTime(new Date("2026-10-17T17:00:00Z"));
      await mocks(c);
      const page = await c.newPage(), errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      const q = new URLSearchParams({ place: "Chetek, WI", year: "2025", station: "471667 2", style: "r1", cmp: "normal", normals: "1", name: "The Olson Farm",
        m1: "2025-05-08 Planted", m2: "2025-10-24 Harvest done", crop: "corn", plant: "2025-05-08", harvest: "2025-10-24", plants: "1", ghost: "1", frost: "1", heat: "1", ribbon: "1" });
      await page.goto(base + "/rain-print.html?" + q);
      await drawn(page);
      await page.waitForFunction(() => /data-rp="crop"/.test(document.getElementById("rp-art").innerHTML) && /data-rp="ribbon"/.test(document.getElementById("rp-art").innerHTML), null, { timeout: 30000 });
      const artHtml = await page.$eval("#rp-art", (e) => e.innerHTML);
      assert.ok(/stroke="#CFCBC4"/.test(artHtml), "the usual-year plants");
      assert.ok(/data-rp="frost:0"/.test(artHtml), "the frost marks");
      assert.ok(/Hottest day: \d+°F/.test(artHtml), "the hottest day in the foot line");
      // the panel follows the link
      assert.equal(await page.$eval("#rp-crop", (e) => e.value), "corn");
      assert.equal(await page.$eval("#rp-crop-plant", (e) => e.value), "2025-05-08");
      assert.equal(await page.$eval("#rp-crop-harvest", (e) => e.value), "2025-10-24");
      for (const id of ["rp-plants", "rp-ghost", "rp-frost", "rp-heat", "rp-ribbon"]) assert.ok(await page.$eval("#" + id, (e) => e.checked), id);
      // every layer is in view in the Layers card (2026-10-22): no fold to open; hottest and coldest are "included" with the stripes on
      assert.match(await page.textContent("#rp-lcount"), /^10 in all, 8 on$/, "usual year, month normals, frost, hottest and coldest (included), stripes, crop, plants, usual-year plants; not remarkable days or history");
      assert.ok(await page.$eval("#rp-heat-chip", (e) => e.classList.contains("rp-inc")), "hottest and coldest: included with the stripes");
      assert.equal(await page.getAttribute('[data-crop="corn"]', "aria-pressed"), "true");
      assert.match(await page.textContent("#rp-temp-why"), /Temperatures from the same station/);
      // the URL, the code, the order's design link
      await page.waitForTimeout(700);
      const url = new URL(page.url());
      for (const [k, v] of [["crop", "corn"], ["plant", "2025-05-08"], ["harvest", "2025-10-24"], ["plants", "1"], ["ghost", "1"], ["frost", "1"], ["heat", "1"], ["ribbon", "1"]]) assert.equal(url.searchParams.get(k), v, "URL " + k);
      const code = await page.textContent("#rp-code"), d = RP.decodeCode(code);
      assert.ok(d && d.crop === "corn" && d.plants && d.ghost && d.frost && d.heat && d.ribbon && d.cropPlant === "2025-05-08", "the design code carries every option");
      const order = new URL(await page.$eval("#ro-design", (e) => e.value));
      assert.equal(order.searchParams.get("crop"), "corn", "the order's design link");
      assert.equal(order.searchParams.get("ribbon"), "1");
      // the proof sheet says them
      await page.click("#rp-zoom");
      await page.waitForSelector("#rp-proof[open]");
      const dts = await page.$$eval("#rp-proof-sum dt", (a) => a.map((x) => x.textContent));
      assert.ok(dts.includes("Crop") && dts.includes("Temperatures"), dts.join(", "));
      const sum = await page.textContent("#rp-proof-sum");
      assert.match(sum, /Corn, planted May 8, harvested Oct 24, with plant drawings, against a usual year/);
      assert.match(sum, /frost marks, hottest and coldest day, daily temperature stripes; from the same station/);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      // a switch off: the print and the code follow
      await page.click('label:has(#rp-ribbon)');
      await page.waitForTimeout(400);
      assert.ok(!/data-rp="ribbon"/.test(await page.$eval("#rp-art", (e) => e.innerHTML)), "ribbon off");
      assert.equal(RP.decodeCode(await page.textContent("#rp-code")).ribbon, false);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.click('label:has(#rp-ribbon)');
        await page.waitForTimeout(400);
        const el = await page.$("#rp-temp-set");
        await el.scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, -120));
        const box = await page.evaluate(() => { const a = document.getElementById("rp-temp-set").getBoundingClientRect(), b = document.getElementById("rp-hist-set").getBoundingClientRect(); return { x: 0, y: a.top + scrollY - 70, w: innerWidth, h: b.bottom - a.top + 90 }; });
        await page.screenshot({ path: SHOTS + "/options-panel-" + width + ".png", fullPage: true, clip: { x: 0, y: Math.max(0, box.y), width: box.w, height: box.h } });
      }
      // every year behind: the station is the nearest with 30 full years, and the threads draw
      await page.click('label:has(#rp-hist)');
      await drawn(page);
      await page.waitForFunction(() => /data-rp="hist"/.test(document.getElementById("rp-art").innerHTML), null, { timeout: 30000 });
      assert.ok(RP.decodeCode(await page.textContent("#rp-code")).hist, "hist in the code");
      assert.match(await page.$eval("#rp-art", (e) => e.innerHTML), /full years this station has kept/, "the rank note");
      // Roots: no threads, and the switch says why
      await page.click('label:has(input[name="rp-style"][value="r2"])');
      await page.waitForTimeout(500);
      assert.ok(!/data-rp="hist"/.test(await page.$eval("#rp-art", (e) => e.innerHTML)));
      assert.ok(/data-rp="crop"/.test(await page.$eval("#rp-art", (e) => e.innerHTML)), "Roots keeps the crop");
      assert.ok(await page.$eval("#rp-hist", (e) => e.disabled));
      assert.match(await page.textContent("#rp-hist-why"), /Staircase only/);
      assert.deepEqual(errors, [], "no page errors");
      await c.close();
    }
  } finally { await browser.close(); srv.close(); }
});
