/* Rain Print records layer (components/rain-print-records.js): every kind's
 * rule against ACIS-shaped fixtures built here (missing days, S/A runs, ties,
 * short records, no temperature, leap years). The shipped file runs in a bare
 * context, so a green run checks the copy the browser loads.
 *
 *   node --test test/rain-print-records.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { URLSearchParams, Promise, Map };
ctx.window = ctx;
vm.runInNewContext(readFileSync(ROOT + "components/rain-print-records.js", "utf8"), ctx);
const R = ctx.AgRainRecords;
const plain = (x) => JSON.parse(JSON.stringify(x));

// ---------- fixture builders ----------
const DAY = 86400000;
function dates(from, to) {
  const out = [];
  for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
const h = (y, m) => ((y * 9301 + m * 49297) % 233280) / 233280;
/* ACIS-shaped period of record, columns pcpn,avgt. Every day has 0.08 in except:
   Jun 15 carries bump(y); June days carry june(y) instead of 0.08 when given;
   over[date] replaces the pcpn string; avgt is 40 + 30*h(y,m) unless temp(y,m) is given. */
function por({ from, to, bump = () => 0, june, temp, over = {}, gone = () => false }) {
  return { data: dates(from, to).filter((d) => !gone(d)).map((d) => {
    const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1;
    let p = m === 5 && june ? june(y) : 0.08;
    if (d.slice(5) === "06-15") p += bump(y);
    const pv = d in over ? over[d] : p.toFixed(2);
    return [d, pv, (temp ? temp(y, m) : 40 + 30 * h(y, m)).toFixed(1)];
  }) };
}
// one year's daily call, columns pcpn,avgt,snow,maxt,mint; f(date, i) returns overrides
function year(y, f = () => ({}), to = y + "-12-31") {
  return { data: dates(y + "-01-01", to).map((d, i) => {
    const o = Object.assign({ pcpn: "0.00", avgt: "50", snow: "0.0", maxt: "60", mint: "40" }, f(d, i));
    return [d, o.pcpn, o.avgt, o.snow, o.maxt, o.mint];
  }) };
}
// the year call taken from a por fixture, so the two agree
function yearFromPor(p, y) {
  return { data: p.data.filter((r) => r[0].startsWith(String(y))).map((r) => [r[0], r[1], r[2], "0.0", "60", "40"]) };
}
const one = (data, kind, opts = {}) => {
  const x = R.explain(data, Object.assign({ kinds: [kind] }, opts));
  return { f: x.found[0] && plain(x.found[0]), why: x.withheld[0] && x.withheld[0].reason };
};
const hist = (p, T, extra = {}) => Object.assign({ year: T, daily: yearFromPor(p, T), por: p, sid: "471667 2" }, extra);

// ---------- wettest / driest year ----------
test("wettest year since: the first full year that had more, every year between full and less", () => {
  const p = por({ from: "1950-01-01", to: "2025-12-31", bump: (y) => (y === 2025 ? 20 : y === 1993 ? 21 : 0) });
  const r = one(hist(p, 2025), "wetYear");
  assert.equal(r.f.label, "Wettest year since 1993");
  assert.equal(r.f.date, "2025-01-01");
  assert.equal(r.f.basis.settled, 31);
  assert.equal(r.f.basis.refValue, r.f.value + 1);
});

test("a patchy year stops the claim: wettest from the year after it to this year", () => {
  const p = por({ from: "1950-01-01", to: "2025-12-31", bump: (y) => (y === 2025 ? 20 : 0),
    gone: (d) => d >= "2000-03-01" && d < "2000-04-10" });
  const r = one(hist(p, 2025), "wetYear");
  assert.equal(r.f.label, "Wettest year from 2001 to 2025");
  assert.equal(r.f.basis.form, "broken");
});

test("a patchy year whose recorded total is already higher is the year it is since", () => {
  const p = por({ from: "1950-01-01", to: "2025-12-31", bump: (y) => (y === 2025 ? 20 : y === 2001 ? 30 : 0),
    gone: (d) => d >= "2001-03-01" && d < "2001-04-10" });
  const r = one(hist(p, 2025), "wetYear");
  assert.equal(r.f.label, "Wettest year since 2001");
});

test("too close to call (within 0.10 in) stops the claim the year after", () => {
  const p = por({ from: "1950-01-01", to: "2025-12-31", bump: (y) => (y === 2025 ? 20 : y === 1993 ? 19.95 : 0) });
  assert.equal(one(hist(p, 2025), "wetYear").f.label, "Wettest year from 1994 to 2025");
});

test("fewer than 19 settled years: not said", () => {
  const p = por({ from: "1950-01-01", to: "2025-12-31", bump: (y) => (y === 2025 ? 20 : y === 2015 ? 21 : 0) });
  const r = one(hist(p, 2025), "wetYear");
  assert.equal(r.f, undefined);
  assert.match(r.why, /^not remarkable: 9 years settled before 2015 had more, 19 needed$/);
});

test("short record: fewer than 30 full years, withheld", () => {
  const p = por({ from: "1999-01-01", to: "2025-12-31", bump: (y) => (y === 2025 ? 20 : 0) });
  const r = one(hist(p, 2025), "wetYear");
  assert.equal(r.f, undefined);
  assert.equal(r.why, "only 27 full years on record up to 2025");
});

test("on record here only with 50 or more years, all settled; shorter says in the station.s record, back to its start", () => {
  const long = por({ from: "1950-01-01", to: "2025-12-31", bump: (y) => (y === 2025 ? 20 : 0) });
  assert.equal(one(hist(long, 2025), "wetYear").f.label, "Wettest year on record here, back to 1950");
  const mid = por({ from: "1990-01-01", to: "2025-12-31", bump: (y) => (y === 2025 ? 20 : 0) });
  assert.equal(one(hist(mid, 2025), "wetYear").f.label, "Wettest year in this station\u2019s record, back to 1990");
});

test("no look-ahead: a 1990 print ignores a wetter 2019", () => {
  const p = por({ from: "1900-01-01", to: "2025-12-31", bump: (y) => (y === 1990 ? 20 : y === 2019 ? 25 : 0) });
  assert.equal(one(hist(p, 1990), "wetYear").f.label, "Wettest year on record here, back to 1900");
});

test("driest year: a patchy year with a higher recorded total is settled", () => {
  const p = por({ from: "1950-01-01", to: "2025-12-31", bump: (y) => (y === 2025 ? 0 : y === 1980 ? 0 : 5),
    over: { "2025-03-01": "0.00", "2025-03-02": "0.00" }, gone: (d) => d >= "2010-03-01" && d < "2010-04-10" });
  // 1980 has no bump either, but 2025 lost two 0.08 days, so 1980 was 0.16 in wetter (more than the 0.10 band).
  // 2010 is missing 40 days, yet its recorded total is already higher, so it is settled too.
  const r = one(hist(p, 2025), "dryYear");
  assert.equal(r.f.label, "Driest year on record here, back to 1950");
});

test("an S/A run across Dec 31 means the year is not full", () => {
  const p = por({ from: "1950-01-01", to: "2026-01-05", bump: (y) => (y === 2025 ? 20 : 0),
    over: { "2025-12-30": "S", "2025-12-31": "S", "2026-01-01": "0.50A" } });
  const r = one(hist(p, 2025), "wetYear");
  assert.equal(r.f, undefined);
  assert.match(r.why, /not a full year/);
});

test("withheld when the year call and the history disagree, or the record is threaded", () => {
  const p = por({ from: "1950-01-01", to: "2025-12-31", bump: (y) => (y === 2025 ? 20 : 0) });
  const d = yearFromPor(p, 2025); d.data[100][1] = "0.10";
  assert.equal(one(hist(p, 2025, { daily: d }), "wetYear").why, "the station record changed between requests");
  assert.equal(one(hist(p, 2025, { sid: "MSPthr 9" }), "wetYear").why, "this record joins several weather stations");
  assert.equal(one(hist(p, 2025, { por: null }), "wetYear").why, "the station history does not reach 2025");
});

// ---------- remarkable months ----------
test("record June: wettest of its own full months, value and span", () => {
  const p = por({ from: "1950-01-01", to: "2025-12-31", june: (y) => (y === 2025 ? 0.4 : 0.05 + 0.1 * h(y, 5)) });
  const r = one(hist(p, 2025), "wetMonth");
  assert.equal(r.f.label, "Wettest June of 76 full years: 12.00 in");
  assert.deepEqual(r.f.span, { from: "2025-06-01", to: "2025-06-30" });
});

test("a month within 0.05 in of another year's is a tie and not the record (n < 100)", () => {
  const p = por({ from: "1950-01-01", to: "2025-12-31", june: (y) => (y === 2025 ? 0.4 : y === 1970 ? 0.399 : 0.05 + 0.1 * h(y, 5)) });
  const r = one(hist(p, 2025), "wetMonth");
  assert.equal(r.f, undefined);
  assert.match(r.why, /^not remarkable/);
});

test("top 2% with a long record allows a rank, tied wording when within the band", () => {
  const p = por({ from: "1900-01-01", to: "2025-12-31", june: (y) => (y === 2025 ? 0.4 : y === 1960 ? 0.5 : y === 1970 ? 0.399 : 0.05 + 0.1 * h(y, 5)) });
  const r = one(hist(p, 2025), "wetMonth");
  assert.equal(r.f, undefined, "rank 2 plus a tie is 3 of 126, over the limit of 2");
  const q = por({ from: "1900-01-01", to: "2025-12-31", june: (y) => (y === 2025 ? 0.4 : y === 1960 ? 0.5 : 0.05 + 0.1 * h(y, 5)) });
  assert.equal(one(hist(q, 2025), "wetMonth").f.label, "2nd wettest June of 126 full years: 12.00 in");
});

test("dry month: a month that is usually near zero is never called a record", () => {
  const p = por({ from: "1950-01-01", to: "2025-12-31", june: () => 0.01 });
  const r = one(hist(p, 2025), "dryMonth");
  assert.equal(r.f, undefined);
});

test("warm and cold month from the station's daily means; months missing 4 days drop out", () => {
  const p = por({ from: "1950-01-01", to: "2025-12-31", temp: (y, m) => (m === 6 && y === 2025 ? 80 : m === 0 && y === 2025 ? 5 : 50 + 10 * h(y, m)) });
  assert.equal(one(hist(p, 2025), "warmMonth").f.label, "Warmest July of 76 full years: 80.0°F average");
  assert.equal(one(hist(p, 2025), "coldMonth").f.label, "Coldest January of 76 full years: 5.0°F average");
  for (const d of dates("2025-07-01", "2025-07-04")) p.data.find((r) => r[0] === d)[2] = "M";
  assert.notEqual(one(hist(p, 2025), "warmMonth").f?.date, "2025-07-01");
});

test("an S/A run across a month edge keeps both months out", () => {
  const p = por({ from: "1950-01-01", to: "2025-12-31", june: (y) => (y === 2025 ? 0.4 : 0.05 + 0.1 * h(y, 5)),
    over: { "2025-06-30": "S", "2025-07-01": "1.00A" } });
  assert.equal(one(hist(p, 2025), "wetMonth").f, undefined);
});

// ---------- days of the year ----------
test("coldest and hottest on their dates, ties noted, leap day counted", () => {
  const d = year(2024, (dt) => ({ mint: dt === "2024-02-29" || dt === "2024-12-20" ? "-31" : "10", maxt: dt === "2024-07-04" ? "97" : "80" }));
  assert.equal(d.data.length, 366);
  const c = one({ year: 2024, daily: d }, "coldest").f;
  assert.equal(c.date, "2024-02-29");
  assert.equal(c.label, "Coldest day: -31°F (also Dec 20)");
  assert.deepEqual(c.ties, ["2024-12-20"]);
  assert.deepEqual(one({ year: 2024, daily: d }, "hottest").f, { date: "2024-07-04", label: "Hottest day: 97°F", value: 97, unit: "°F", ties: [], kind: "hottest" });
  const three = year(2025, (dt) => ({ maxt: ["2025-07-01", "2025-07-02", "2025-08-09"].includes(dt) ? "95" : "80" }));
  assert.equal(one({ year: 2025, daily: three }, "hottest").f.label, "Hottest day: 95°F (on 3 days)");
});

test("temperatures withheld past 10 missing days, or when the call has no temperatures", () => {
  const d = year(2025, (dt, i) => ({ mint: i < 11 ? "M" : "20" }));
  assert.equal(one({ year: 2025, daily: d }, "coldest").why, "temperature missing on 11 days");
  const ten = year(2025, (dt, i) => ({ mint: i < 10 ? "M" : "20" }));
  assert.ok(one({ year: 2025, daily: ten }, "coldest").f);
  const noT = { year: 2025, daily: { data: dates("2025-01-01", "2025-12-31").map((x) => [x, "0.00"]) }, dailyElems: ["pcpn"] };
  assert.equal(one(noT, "coldest").why, "no mint in the data");
  assert.equal(one(noT, "hottest").why, "no maxt in the data");
});

test("frost dates: last spring and first fall low of 32 F, withheld if a missing low could hide one", () => {
  const f = (dt) => ({ mint: dt === "2025-05-12" ? "29" : dt === "2025-09-28" ? "31" : dt < "2025-04-01" || dt > "2025-11-01" ? "10" : "45" });
  const d = year(2025, f);
  assert.equal(one({ year: 2025, daily: d }, "lastFrost").f.label, "Last frost: 29°F");
  assert.equal(one({ year: 2025, daily: d }, "lastFrost").f.date, "2025-05-12");
  assert.equal(one({ year: 2025, daily: d }, "firstFrost").f.date, "2025-09-28");
  const holes = year(2025, (dt) => Object.assign(f(dt), dt === "2025-06-02" || dt === "2025-09-01" ? { mint: "M" } : {}));
  assert.equal(one({ year: 2025, daily: holes }, "lastFrost").why, "a missing low could hide a later frost");
  assert.equal(one({ year: 2025, daily: holes }, "firstFrost").why, "a missing low could hide an earlier frost");
  const warm = year(2025, () => ({ mint: "50" }));
  assert.match(one({ year: 2025, daily: warm }, "firstFrost").why, /^no low of 32/);
});

test("biggest snow day: several-day totals never count, and one at least as big withholds it", () => {
  const d = year(2025, (dt) => ({ snow: dt === "2025-11-10" ? "14.0" : dt === "2025-02-02" ? "14.0" : dt === "2025-03-01" ? "S" : dt === "2025-03-02" ? "9.0A" : "0.0" }));
  assert.equal(one({ year: 2025, daily: d }, "snowDay").f.label, "Biggest snow: 14.0 in (also Nov 10)");
  const a = year(2025, (dt) => ({ snow: dt === "2025-11-10" ? "14.0" : dt === "2025-03-01" ? "S" : dt === "2025-03-02" ? "16.0A" : "0.0" }));
  assert.equal(one({ year: 2025, daily: a }, "snowDay").why, "a several-day snowfall total could hide a bigger day");
  const bare = year(2025, () => ({ snow: "M" }));
  assert.equal(one({ year: 2025, daily: bare }, "snowDay").why, "snowfall missing on 365 days");
  const south = year(2025, () => ({ snow: "0.0" }));
  assert.equal(one({ year: 2025, daily: south }, "snowDay").why, "no day with 1.0 in of snow or more");
});

test("last and first snow dates need a full snowfall record on the days that could hold another", () => {
  const f = (dt) => ({ snow: dt === "2025-04-20" ? "0.5" : dt === "2025-10-30" ? "1.2" : dt === "2025-01-15" ? "3.0" : "0.0" });
  assert.equal(one({ year: 2025, daily: year(2025, f) }, "lastSnow").f.label, "Last snow: 0.5 in");
  assert.equal(one({ year: 2025, daily: year(2025, f) }, "firstSnow").f.date, "2025-10-30");
  const hole = year(2025, (dt) => Object.assign(f(dt), dt === "2025-05-05" ? { snow: "M" } : {}));
  assert.equal(one({ year: 2025, daily: hole }, "lastSnow").why, "a missing snowfall day could hide a later snow");
  const acc = year(2025, (dt) => Object.assign(f(dt), dt === "2025-04-25" ? { snow: "S" } : dt === "2025-04-26" ? { snow: "0.4A" } : {}));
  assert.equal(one({ year: 2025, daily: acc }, "lastSnow").why, "that snow was a several-day total, so its day is not known");
});

test("wettest week: span over its rainy days, S/A runs must sit inside the window", () => {
  const f = (dt) => ({ pcpn: { "2025-06-10": "1.00", "2025-06-12": "2.00", "2025-06-14": "0.50", "2025-08-01": "S", "2025-08-02": "S", "2025-08-03": "S", "2025-08-04": "S", "2025-08-05": "S", "2025-08-06": "S", "2025-08-07": "S", "2025-08-08": "5.00A" }[dt] || "0.00" });
  const r = one({ year: 2025, daily: year(2025, f) }, "wetWeek").f;
  assert.equal(r.label, "Wettest week: 3.50 in");
  assert.deepEqual(r.span, { from: "2025-06-10", to: "2025-06-14" });
  const g = (dt) => ({ pcpn: { "2025-06-10": "1.00", "2025-06-12": "2.00", "2025-09-01": "S", "2025-09-02": "4.00A" }[dt] || "0.00" });
  assert.equal(one({ year: 2025, daily: year(2025, g) }, "wetWeek").f.label, "Wettest week: 4.00 in");
  const tie = (dt) => ({ pcpn: { "2025-03-03": "2.00", "2025-10-10": "2.00" }[dt] || "0.00" });
  assert.equal(one({ year: 2025, daily: year(2025, tie) }, "wetWeek").f.label, "Wettest week: 2.00 in (also Oct 10)");
  const gaps = year(2025, (dt, i) => ({ pcpn: i < 11 ? "M" : "0.10" }));
  assert.equal(one({ year: 2025, daily: gaps }, "wetWeek").why, "rain missing on 11 days");
});

// ---------- shared rules ----------
test("an unfinished year gives nothing", () => {
  const x = R.explain({ year: 2026, daily: year(2026, () => ({ mint: "-5" }), "2026-10-10") }, { kinds: ["coldest", "wetWeek"] });
  assert.equal(x.found.length, 0);
  assert.deepEqual(plain(x.withheld).map((w) => w.reason), ["the year is not finished", "the year is not finished"]);
});

test("each kind is selectable on its own; unknown kinds are reported, not guessed", () => {
  const d = year(2025, (dt) => ({ mint: dt === "2025-01-05" ? "-20" : "10", maxt: dt === "2025-07-05" ? "99" : "80" }));
  assert.deepEqual(plain(R.find({ year: 2025, daily: d }, { kinds: ["hottest"] }).map((m) => m.kind)), ["hottest"]);
  const x = R.explain({ year: 2025, daily: d }, { kinds: ["hottest", "rainbows"] });
  assert.deepEqual(plain(x.withheld), [{ kind: "rainbows", reason: "unknown kind" }]);
});

test("labels are short and plain: no dashes of the long kind, no exclamation marks, 56 characters or fewer", () => {
  const p = por({ from: "1900-01-01", to: "2025-12-31", bump: (y) => (y === 2025 ? 20 : 0), june: (y) => (y === 2025 ? 0.4 : 0.05 + 0.1 * h(y, 5)) });
  const d = yearFromPor(p, 2025);
  d.data.forEach((r) => { if (r[0] === "2025-01-09") r[5] = "-31"; if (r[0] === "2025-12-19") r[3] = "14.0"; });
  const all = R.find({ year: 2025, daily: d, por: p }, {});
  assert.ok(all.length >= 6, all.map((m) => m.kind).join());
  for (const m of all) {
    assert.match(m.date, /^\d{4}-\d\d-\d\d$/);
    assert.ok(m.label.length <= 56, m.label);
    assert.doesNotMatch(m.label, /[–—!]/);
    assert.equal(typeof m.value, "number");
  }
});

test("elems and urls: one daily call with maxt,mint added; the por call only for history kinds", () => {
  assert.deepEqual(plain(R.elems(["coldest", "hottest"])), { daily: ["pcpn", "mint", "maxt"], por: [] });
  assert.deepEqual(plain(R.elems(["wetYear"])), { daily: ["pcpn"], por: ["pcpn", "avgt"] });
  const u = R.urls("471667 2", 2025, ["coldest"]);
  assert.match(u.daily, /elems=pcpn%2Cavgt%2Csnow%2Cmaxt%2Cmint/);
  assert.equal(u.por, null);
  assert.match(R.urls("471667 2", 2025, ["wetYear"]).por, /sdate=por&edate=por&elems=pcpn%2Cavgt$/);
});

test("load fetches each URL once and shares the por call across years", async () => {
  const seen = [];
  ctx.fetch = (u) => { seen.push(u); return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) }); };
  await R.load("X 2", 2024, ["wetYear"]);
  await R.load("X 2", 2025, ["wetYear"]);
  await R.load("X 2", 2025, ["wetYear"]);
  assert.equal(seen.length, 3);
  assert.equal(seen.filter((u) => /sdate=por/.test(u)).length, 1);
});

test("130 years of history in well under a second", () => {
  const p = por({ from: "1896-01-01", to: "2025-12-31", bump: (y) => (y === 2025 ? 20 : 0) });
  const t = Date.now();
  R.find(hist(p, 2025), { kinds: ["wetYear", "dryYear", "wetMonth", "dryMonth", "warmMonth", "coldMonth"] });
  assert.ok(Date.now() - t < 1000, Date.now() - t + " ms");
});

test("D5 (2026-10-14): 'driest' leaves room for what this year's missing days could hold", () => {
  const over = {};
  for (let d = 1; d <= 10; d++) over["2025-07-" + String(d).padStart(2, "0")] = "M";
  // 2025: a dry June and 10 July days missing (26.00 in recorded); 1990: the same dry June, all days in (26.80 in)
  const p = por({ from: "1950-01-01", to: "2025-12-31", june: (y) => (y === 2025 || y === 1990 ? 0 : 0.08), over });
  const r = one(hist(p, 2025), "dryYear");
  assert.ok(r.f, "still remarkable: " + r.why);
  assert.ok(!/on record/.test(r.f.label), "0.80 in drier than 1990 is inside what 10 missing days could hold: " + r.f.label);
  assert.equal(r.f.label, "Driest year from 1991 to 2025");
  // with every day in, the same gap is a record
  const full = one(hist(por({ from: "1950-01-01", to: "2025-12-31", june: (y) => (y === 2025 ? 0 : y === 1990 ? 0.0267 : 0.08) }), 2025), "dryYear");
  assert.match(full.f.label, /^Driest year on record here/);
});
