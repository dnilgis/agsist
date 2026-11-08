/* The home Local conditions card, Nov 4, 2026 (Sig: "Remove the spray days stuff from the weather card. I would like
 * the YTD rain and GDUs to be displayed year round, as well as the 30-day amounts for each, and the departure from
 * normal. There is too much wasted space in the card").
 *
 *   - the five-day spray table is gone from the card (today's read stays as one line); /spray and Field Scout keep theirs
 *   - Season so far (components/season-wx.js) reads the county rain files only, on a summer and a winter fixture
 *   - departures worked from the fixtures by hand
 *   - the card's figures are the county rain page's own for the same county (a fixture fetch and build)
 *   - the card is 30% or more shorter than before at 390 and 1280, taps 44px, text 12px, nothing moves when it fills
 *
 *   node --test test/wxcard.test.mjs
 * Fixtures: test/fixtures/wxcard (MADE UP; frozen, never read live). Browser runs block every outside host. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { nwsAnswer } from "./fixtures/nws-mock.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const A = createRequire(import.meta.url)(ROOT + "components/season-wx.js");
const RW = createRequire(import.meta.url)(ROOT + "components/rain-wx.js");
const FX = JSON.parse(read("test/fixtures/wxcard/rain-ia.json"));
const WX = JSON.parse(read("test/fixtures/wxcard/wx-ia.json"));
const HTML = read("index.html");
const clone = (x) => JSON.parse(JSON.stringify(x));
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/&rsquo;/g, "'").replace(/&deg;/g, "°").replace(/\s+/g, " ").trim();
function card() {
  const a = HTML.indexOf('<div class="card wx-card'), b = HTML.indexOf('<details class="m-fold m-fold--radar"', a);
  assert.ok(a > 0 && b > a, "the Local conditions card is in index.html");
  return HTML.slice(a, b);
}

/* ---------- the spray table ---------- */
test("the spray days table, its How it's rated and the Today spray line are gone from the card", () => {
  const c = card();
  for (const x of ["spray-days-strip", "spray-windows", "Spray days", "tip-s7-spray", "How it&rsquo;s rated"]) assert.ok(!c.includes(x), x);
  // Nov 5 (Sig): the one Today spray line left the card too (test/wxcard2.test.mjs), and the hero band's read with it
  // (test/homeseasonal.test.mjs)
  assert.ok(!/id="wx-today-summary"/.test(c), "no Today spray line in the card");
  assert.ok(!/spray days/i.test(c), "no 'spray days' copy left in the card");
  const hs = read("components/home-season.js");
  assert.ok(!/spray-days-strip|spray-day-name/.test(hs), "home-season.js paints no spray table");
  assert.ok(!/agsist:spray|function sprayRule/.test(hs), "home-season.js carries no spray rule now that home shows no spray read");
  // the other pages keep their spray days (count the copies)
  assert.match(read("spray.html"), /spray/i);
  assert.ok(existsSync(ROOT + "components/spray-windows.js"), "/spray's spray windows stay");
  assert.match(read("field-scout-read.js"), /Too windy to spray right now/, "Field Scout keeps its spray read");
  assert.match(read("spray.html"), /components\/spray-windows\.js|spray-wind\.js/, "/spray keeps its spray windows");
});

test("the old GDU and 30-day precip boxes, their PRISM history and the fold are gone; Season so far replaces them", () => {
  const c = card();
  for (const x of ["gdu-stat", "precip-stat", "gdu-chart-panel", "precip-chart-panel", "wx-fold-btn", "30-Day Precip", "GDU Since"]) assert.ok(!c.includes(x), x);
  assert.match(c, /<section class="wx-season"[^>]*><h3 class="wxs-h" id="wxs-h">Season so far, against normal<\/h3>\s*<div id="wx-season">/);
  assert.ok(!/AgPRISM|prism\.js/.test(read("components/home-planting.js").replace(/\/\*[\s\S]*?\*\//g, "")), "home-planting.js reads no PRISM history");
  assert.ok(!/components\/prism\.js/.test(HTML), "the home page loads no prism.js");
  assert.match(HTML, /<script src="\/components\/season-wx\.js\?v=2" defer><\/script>/);
  assert.ok(!/wx-fold-btn/.test(read("components/home.js")), "no phone fold for the GDU tile");
});

/* ---------- the reader ---------- */
test("summer: every figure from the files, with its dates; departures by hand", () => {
  const m = A.model(FX, WX, A.fipsFor(FX, "Story"));
  // rain: 55.03 in against 34.60 usual: +20.43, 159% (the file's percent)
  assert.deepEqual([m.rain.value, m.rain.normal, +m.rain.dep.toFixed(2), m.rain.pct, m.rain.from, m.rain.to], [55.03, 34.6, 20.43, 159, "2026-01-01", "2026-11-03"]);
  // 30 days, Oct 5 to Nov 3: 2.71 against 2.80: -0.09, 97%
  assert.deepEqual([m.rain30.value, m.rain30.normal, +m.rain30.dep.toFixed(2), m.rain30.pct, m.rain30.from], [2.71, 2.8, -0.09, 97, "2026-10-05"]);
  // GDDs from May 1: 2,912 against 2,759: +153, 106%; 30 days 312 against 290: +22, 108%
  assert.deepEqual([m.gdd.value, m.gdd.normal, m.gdd.dep, m.gdd.pct, m.gdd.from, m.gdd.to], [2912, 2759, 153, 106, "2026-05-01", "2026-11-03"]);
  assert.deepEqual([m.gdd30.value, m.gdd30.dep, m.gdd30.pct, m.gdd30.from, m.gdd30.to], [312, 22, 108, "2026-10-05", "2026-11-03"]);
  const h = A.html(m, "2026-11-04"), t = text(h);
  for (const x of ["Rain, Jan 1 to Nov 3 55.03 in +20.43 in (159%)", "Rain, Oct 5 to Nov 3 2.71 in −0.09 in (97%)",
    "GDDs, May 1 to Nov 3 2,912 GDDs +153 (106%)", "GDDs, Oct 5 to Nov 3 312 GDDs +22 (108%)"]) assert.ok(t.includes(x), x + "\n" + t);
  // Nov 8 (Sig crossed it out): no stations and sources paragraph on the home card; the county rain page keeps its method text
  assert.doesNotMatch(t, /Stations and sources|Gilbert|RCC-ACIS|CoCoRaHS|weather station 8 miles/, "no source text on the home card");
  assert.doesNotMatch(h, /<details|wxs-src/, "no sources fold");
  assert.doesNotMatch(h, /<a\b/, "no link to a data source");
  assert.doesNotMatch(h + A.chart(m) + A.chartGdd(m), /—/, "no em dash");
  assert.ok(!/\.wxs-src/.test(read("css/home.css")), "the fold's CSS went with it");
  const ch = A.chart(m);
  assert.match(ch, /<title>Nov 1\.61 in<\/title>/, "the month chart is the county page's month table");
  assert.match(ch, /<title>Jan 1\.41 in, 1 day not reported<\/title>/);
  assert.match(ch, /Usual <span class="wxs-sw wxs-cy"><\/span>2026, Jan 1 to Nov 3/);
});

test("winter: no season yet, last season's GDDs with their year; withheld figures say so; a finished year names its year", () => {
  const r = clone(FX), w = clone(WX), c = r.counties["19169"];
  r.year = 2027; c.as_of = "2027-03-14"; c.days = 73; c.missing = 4; c.total = null; c.r30 = "m";   // a row the builder withheld
  w.year = 2027; w.edate = "2027-03-14";
  w.counties["19169"] = { a: 314, g30: [9, 0, 30, 30, null], gp: { y: 2026, a: 1231, g: [2950, 1, 2840, 30, 104], s: ["8 miles west-southwest of Ames", "130203 2", 10] } };
  const m = A.model(r, w, "19169"), t = text(A.html(m, "2027-03-15"));
  assert.equal(m.rain.status, "thin");
  assert.ok(t.includes("Rain, Jan 1 to Mar 14 Not enough days reported"), t);
  assert.ok(t.includes("Rain, Feb 13 to Mar 14 Not enough days reported"), t);
  assert.ok(t.includes("GDDs, 2026 season, May 1 to Dec 31 2,950 GDDs +110 (104%)"), "off season: last season's total, 2,950 - 2,840 = +110\n" + t);
  assert.ok(t.includes("GDDs, Feb 13 to Mar 14 9 GDDs −21"), "a 30-day figure with no percent under 50 GDDs of normal: 9 - 30 = -21\n" + t);
  assert.ok(!/GDDs, Feb 13 to Mar 14 9 GDDs −21 \(/.test(t), "no percent on a tiny normal");
  assert.doesNotMatch(t, /Last season's GDDs: |mi off/, "no station line on the home card (Nov 8)");
  // the county page's rule, not the card's: a row in the file is shown. 7 of 73 missing (9.6%, past 5% but inside
  // county_rain.MIN_SHARE 0.90) shows its total on the page, so on the card too
  c.missing = 7; c.total = 1.2;
  assert.equal(A.model(r, w, "19169").rain.status, "ok");
  // January reads the finished year: the label says 2026
  const j = clone(FX);
  j.counties["19169"].as_of = "2026-12-31";
  assert.match(text(A.html(A.model(j, WX, "19169"), "2027-01-05")), /Rain, Jan 1 to Dec 31, 2026 55\.03 in/);
  // no season and nothing carried: said, no number
  w.counties["19169"] = { a: 314 };
  assert.match(text(A.html(A.model(r, w, "19169"), "2027-03-15")), /GDDs, from May 1 Counted from May 1/);
});

test("county names match the rain file however the ZIP table writes them; a county with no station reads its neighbor, named", () => {
  const f = { counties: { "55109": { name: "St. Croix County" }, "22033": { name: "East Baton Rouge Parish" } }, none: { "19081": { name: "Hancock County", near: "19169" } } };
  assert.equal(A.fipsFor(f, "St. Croix"), "55109");
  assert.equal(A.fipsFor(f, "Saint Croix County"), "55109");
  assert.equal(A.fipsFor(f, "East Baton Rouge"), "22033");
  assert.equal(A.fipsFor(f, "Hancock"), "19081");
  assert.equal(A.fipsFor(f, "Polk"), null);
  const m = A.model(FX, WX, "19081");
  assert.equal(m.rain.value, 55.03);
  assert.match(text(A.html(m, "2026-11-04")), /Hancock County has no NOAA station with a full record this year; these are Story County's, next door\./);
});

test("no weather file yet (before the fetch has run): the rain shows, the GDDs say Not loaded yet", () => {
  const t = text(A.html(A.model(FX, null, "19169"), "2026-11-04"));
  assert.ok(t.includes("Rain, Jan 1 to Nov 3 55.03 in"), t);
  assert.ok(t.includes("GDDs, from May 1 Not loaded yet") && t.includes("GDDs, last 30 days Not loaded yet"), t);
  const old = clone(FX);
  delete old.counties["19169"].r30;
  assert.ok(text(A.html(A.model(old, WX, "19169"), "2026-11-04")).includes("Rain, last 30 days Not loaded yet"), "a rain file from before r30: not loaded, never a guess");
});

/* ---------- the month charts (Sig, Nov 8: "add back the gdu by month chart like the precip chart"; "make sure the
   month by month chart is perfect and readable clickable and shareable") ---------- */
const bars = (svg, cls) => [...svg.matchAll(new RegExp('<rect x="[\\d.]+" y="([\\d.]+)" width="[\\d.]+" height="([\\d.]+)" class="' + cls + '(?: wxs-part)?"><title>([^<]+)</title>', "g"))].map((x) => ({ y: +x[1], h: +x[2], t: x[3] }));
test("GDDs by month, summer: a second button beside Rain by month, the same drawing, readouts worked by hand", () => {
  const m = A.model(FX, WX, "19169"), h = A.html(m, "2026-11-04");
  assert.match(h, /<div class="wxs-foot"><button type="button" class="wxs-b" id="wxs-chart-b" aria-expanded="false" aria-controls="wxs-chart">Rain by month<\/button><button type="button" class="wxs-b" id="wxs-gchart-b" aria-expanded="false" aria-controls="wxs-gchart">GDDs by month<\/button><\/div>/);
  assert.match(h, /<div class="wxs-chart" id="wxs-gchart" data-kind="gdd" hidden><\/div>/, "a hidden panel, drawn when opened");
  const g = A.spec(m, "gdd"), r = A.spec(m, "rain");
  // the fixture's months add to its season: May to Nov 352 + 640 + 712 + 655 + 420 + 125 + 8 = 2,912 against 2,759
  assert.equal(m.gmonths.slice(4).reduce((a, x) => a + x[0], 0), m.gdd.value);
  assert.equal(A.readout(g, 6), "Jul: 712 GDDs, usual 680, +32 (105%)", "712 - 680 = 32; 712 / 680 = 104.7%");
  assert.equal(A.readout(g, 7), "Aug: 655 GDDs, usual 640, +15 (102%), 1 day not reported", "655 / 640 = 102.3%; 30 of 31 days");
  assert.equal(A.readout(g, 0), "Jan: 0 GDDs, usual 4, −4", "no percent on a usual under 50 GDDs");
  assert.equal(A.readout(g, 10), "Nov 1 to 3, so far: 8 GDDs, usual 7, +1", "the month still running is named so far");
  assert.equal(A.readout(g, 11), "Dec: still to come");
  // rain from the county page's month table: Sep 5.96 against 3.63 = +2.33, 164%; Jan 1.41 against 0.95, 30 of 31 days
  assert.equal(A.readout(r, 8), "Sep: 5.96 in, usual 3.63 in, +2.33 in (164%)");
  assert.equal(A.readout(r, 0), "Jan: 1.41 in, usual 0.95 in, +0.46 in (148%), 1 day not reported");
  assert.equal(A.readout(r, 10), "Nov 1 to 3, so far: 1.61 in, usual 0.24 in, +1.37 in", "no percent on a usual under 0.50 in");
  const ch = A.chartGdd(m, 340);
  assert.match(ch, /<title>Jul 712 GDDs<\/title>/);
  assert.match(ch, /<title>Jul usual 680 GDDs<\/title>/);
  assert.match(ch, /<title>Aug 655 GDDs, 1 day not reported<\/title>/);
  assert.match(ch, /Usual <span class="wxs-sw wxs-cy"><\/span>2026, Jan 1 to Nov 3 <span class="wxs-sw wxs-cy wxs-part"><\/span>Nov so far<\/p>/, "legend with the as-of day and the month so far");
  // the scale: top 800 (next of 1, 2, 4, 6, 8 x 100 over 712), a middle gridline at 400; rain top 10 in, middle 5
  assert.match(ch, />800 GDDs<\/text>/);
  assert.match(ch, />400<\/text>/);
  assert.match(A.chart(m, 340), />10 in<\/text>[\s\S]*>5<\/text>/);
  // bar heights: value / 800 x 124 px of plot (156 high, 10 at the top, 22 under the bars)
  const yb = bars(ch, "wxs-cy"), ub = bars(ch, "wxs-cu");
  assert.equal(yb.length, 11);
  m.gmonths.forEach((x, i) => {
    assert.equal(yb[i].h, +((x[0] / 800) * 124).toFixed(1), M(i) + " height");
    assert.equal(ub[i].h, +((x[1] / 800) * 124).toFixed(1), M(i) + " usual height");
    assert.ok(Math.abs(yb[i].y + yb[i].h - 134) < 0.11, "bars stand on the baseline");
  });
  assert.equal(yb[6].h, 110.4, "July by hand: 712 / 800 x 124 = 110.36");
  assert.match(ch, /class="wxs-cy wxs-part"><title>Nov 8 GDDs/, "November drawn lighter");
  assert.equal((ch.match(/<g class="wxs-m"/g) || []).length, 11, "one tap target a month with data");
  assert.match(ch, /<g class="wxs-m" data-i="10" tabindex="0" role="button" aria-label="Nov 1 to 3, so far: 8 GDDs, usual 7, \+1"><rect class="wxs-hit" x="[\d.]+" y="0" width="22\.8" height="156"\/>/, "the target is the full column, the latest month in the tab order");
  assert.match(ch, /<p class="wxs-read" id="wxs-gread" aria-live="polite">/);
  assert.match(ch, /<button type="button" class="wxs-b wxs-pic" data-kind="gdd">Save picture<\/button>/);
  assert.match(ch, /<svg class="wxs-svg" width="340" height="156" viewBox="0 0 340 156"/, "drawn at the panel's width, so 12px text stays 12px");
});
function M(i) { return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][i]; }

test("GDDs by month, winter: the new year's few GDDs, a withheld month, a station with no normals; old files show no button", () => {
  const r = clone(FX), w = clone(WX), c = r.counties["19169"];
  r.year = 2027; c.as_of = "2027-03-14"; c.months = [[1.1, 0.9, 31, 31], [0.8, 1.0, 28, 28], [0.5, 0.6, 14, 14]];
  w.year = 2027; w.edate = "2027-03-14";
  w.counties["19169"] = { a: 314, g30: [9, 0, 30, 30, null], gm: [[2, 4, 31, 31], null, [12, 9, 13, 14]] };
  const m = A.model(r, w, "19169"), g = A.spec(m, "gdd");
  assert.match(A.html(m, "2027-03-15"), /id="wxs-gchart-b"/);
  assert.equal(A.readout(g, 1), "Feb: not enough days reported", "a month the builder withheld");
  assert.equal(A.readout(g, 2), "Mar 1 to 14, so far: 12 GDDs, usual 9, +3, 1 day not reported");
  const ch = A.chartGdd(m, 340);
  assert.match(ch, />20 GDDs<\/text>/, "top 20 over the tallest 12");
  assert.match(ch, />10<\/text>/);
  assert.equal(bars(ch, "wxs-cy").length, 2, "no bar for the withheld month");
  assert.match(ch, /<g class="wxs-m" data-i="1" tabindex="-1" role="button" aria-label="Feb: not enough days reported">/, "but it can still be read");
  assert.equal(bars(ch, "wxs-cy")[1].h, +((12 / 20) * 124).toFixed(1));
  assert.match(ch, /2027, Jan 1 to Mar 14 <span class="wxs-sw wxs-cy wxs-part"><\/span>Mar so far/);
  // no normals cached for the station: the figure alone, no usual bar
  w.counties["19169"].gm = [[2, null, 31, 31], [5, null, 28, 28], [12, null, 14, 14]];
  const g2 = A.spec(A.model(r, w, "19169"), "gdd"), ch2 = A.chartGdd(A.model(r, w, "19169"), 340);
  assert.equal(A.readout(g2, 0), "Jan: 2 GDDs, no normal for this station");
  assert.equal(bars(ch2, "wxs-cu").length, 0);
  // a weather file from before gm: no GDD button, the rain chart as before
  const h = A.html(A.model(FX, (() => { const o = clone(WX); delete o.counties["19169"].gm; return o; })(), "19169"), "2026-11-04");
  assert.ok(!/wxs-gchart/.test(h) && /id="wxs-chart-b"/.test(h), "no GDD button without gm");
  assert.equal(A.chartGdd(A.model(FX, null, "19169")), "");
  // nothing at all: no buttons, no empty foot
  const bare = clone(FX); delete bare.counties["19169"].months;
  assert.ok(!/wxs-foot/.test(A.html(A.model(bare, null, "19169"), "2026-11-04")));
});

/* ---------- the same numbers as the county rain page ---------- */
test("the card's figures are the county rain page's own for the same county (fixture fetch and build)", () => {
  const t = mkdtempSync(join(tmpdir(), "wxcard-"));
  try {
    const py = String.raw`
import json, os, subprocess, sys
sys.path.insert(0, "scripts")
import build_county_rain as B
t = sys.argv[1]; data = os.path.join(t, "files")  # a temp folder of fixture output, not the live data/
r = subprocess.run([sys.executable, "scripts/fetch_county_rain.py", "--fixtures", "test/fixtures/rain", "--out", data, "--states", "IA", "--edate", "2026-10-12"], capture_output=True, text=True)
assert r.returncode == 0, r.stdout[-400:]
sx = json.load(open(os.path.join(data, "ia.json")))
os.makedirs(os.path.join(data, "wx"))
wx = {"schema": "agsist-rain-wx/1", "state": "IA", "year": sx["year"], "edate": sx["edate"], "fetched": sx["fetched"],
      "counties": {"19169": {"a": 1012, "g": [2912, 2, 2759, 30, 106], "g30": [301, 0, 288, 30, 105], "mh": 2, "ml": 0, "n": 285,
                             "s": ["8 miles west-southwest of Ames", "130203 2", 10]}}}
json.dump(wx, open(os.path.join(data, "wx", "ia.json"), "w"))
pages = B.build(data)
# the same county with its total a hair over its usual (0.0045 in): the page's sign and rounding, built again
sz = json.loads(json.dumps(sx)); cz = sz["counties"]["19169"]; cz["total"] = cz["usual"] + 0.0045
json.dump(sz, open(os.path.join(data, "ia.json"), "w"))
pz = B.build(data)["rain/iowa/story-county.html"]
print(json.dumps({"rain": sx, "wx": wx, "page": pages["rain/iowa/story-county.html"], "rainZ": sz, "pageZ": pz}))
`;
    const out = JSON.parse(execFileSync("python3", ["-c", py, t], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 }));
    const c = out.rain.counties["19169"], page = out.page;
    assert.ok(c && page, "the fixture fetch and build gave Story County");
    const m = A.model(out.rain, out.wx, A.fipsFor(out.rain, "Story")), card = text(A.html(m, "2026-10-13"));
    const dd = (k) => { const x = new RegExp("<dt>" + k + "</dt><dd>([\\d.,]+) ").exec(page); return x && x[1]; };
    assert.equal(dd("Rain so far"), m.rain.value.toFixed(2), "year to date: the page's Rain so far");
    assert.equal(dd("Usual by Oct 12"), m.rain.normal.toFixed(2), "its usual");
    assert.match(page, new RegExp("<dt>Percent of usual</dt><dd>" + m.rain.pct + "%</dd>"), "its percent");
    assert.ok(card.includes("Rain, Jan 1 to Oct 12 " + dd("Rain so far") + " in"), card);
    // the month table's So far row: its departure, sign and all, is the card's
    const soFar = (pg) => /<th scope="row"><b>(?:So far|Year)<\/b><\/th><td><b>[\d.]+<\/b><\/td><td><b>[\d.]+<\/b><\/td><td><b>([^<]+)<\/b><\/td>/.exec(pg)[1].replace("&minus;", "\u2212");
    assert.ok(card.includes("Rain, Jan 1 to Oct 12 " + dd("Rain so far") + " in " + soFar(page) + " in"), soFar(page) + "\n" + card);
    // a departure that rounds to zero: the page prints "+0.00", and so does the card
    const cardZ = text(A.html(A.model(out.rainZ, out.wx, "19169"), "2026-10-13"));
    assert.equal(soFar(out.pageZ), "+0.00");
    assert.ok(cardZ.includes(" in +0.00 in"), cardZ);
    // the last 30 days: the page shows it only when every day has its reading, and so does the card
    const p30 = /<dt>Last 30 days, Sep 13 to Oct 12<\/dt><dd>([\d.]+) /.exec(page);
    if (p30) {
      assert.equal(m.rain30.status, "ok");
      assert.equal(m.rain30.value.toFixed(2), p30[1], "the last 30 days: the page's figure");
      assert.ok(card.includes("Rain, Sep 13 to Oct 12 " + p30[1] + " in"), card);
    } else {
      assert.equal(c.r30, "m", "no page figure: the card withholds too");
      assert.ok(card.includes("Rain, Sep 13 to Oct 12 Not enough days reported"), card);
    }
    // GDDs: the page's fold line and its opened body (components/rain-wx.js) print the same 2,912 and 106%
    assert.match(page, /2,912 corn GDDs May 1 to Oct 12, 106% of the 1991-2020 average/);
    assert.match(RW.render(out.wx.counties["19169"], "gauge"), /Corn GDDs, May 1 to Oct 12:<\/b> 2,912, 106% of the 1991 to 2020 average for the same days \(2,759, 30 years\)/);
    assert.ok(card.includes("GDDs, May 1 to Oct 12 2,912 GDDs +153 (106%)"), card);
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test("the fetchers' arithmetic: the 30-day rain and GDDs, the winter normal, last season carried", () => {
  assert.match(execFileSync("python3", ["scripts/fetch_rain_weather.py", "--selftest"], { cwd: ROOT, encoding: "utf8" }), /fetch_rain_weather selftest: ok/);
  assert.match(execFileSync("python3", ["scripts/fetch_county_rain.py", "--selftest"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), /county rain fetch selftest: ok/);
});

/* ---------- the card on the page ---------- */
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
// The card before this change, measured Nov 4, 2026 with the same forecast stand-in, a 5-year history stand-in and a
// saved ZIP in Ames (scratch harness; the before screenshots are with the PR): 1547px at 390, 1469px at 1280.
const BEFORE = { 390: 1547, 1280: 1469 };

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const fix = { "/data/rain/ia.json": "test/fixtures/wxcard/rain-ia.json", "/data/rain/wx/ia.json": "test/fixtures/wxcard/wx-ia.json" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html"; else if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, fix[p] || p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("on the page: Season so far fills from the files, no spray table, 30% shorter, 44px taps, 12px text, nothing moves", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
      await ctx.addInitScript(() => {
        try { localStorage.setItem("agsist-wx-loc", JSON.stringify({ zip: "50010", lat: 42.03, lon: -93.62, label: "Ames, IA", city: "Ames, IA", state: "IA" })); } catch (e) {}
        window.__shifts = [];
        try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__shifts.push({ v: e.value, s: (e.sources || []).map((x) => x.node && x.node.closest && x.node.closest(".wx-card") ? "card" : "page") }); }).observe({ type: "layout-shift", buffered: true }); } catch (e) {}
      });
      const pg = await ctx.newPage();
      const errors = [];
      pg.on("pageerror", (e) => errors.push(String(e)));
      // BUILD-RULES 58: our own copy only; the forecast from the stand-in; every other outside host aborted
      await pg.route("**/*", (r) => {
        const u = r.request().url();
        if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
        if (/^https:\/\/api\.weather\.gov\//.test(u)) { const a = nwsAnswer(u, {}); return r.fulfill({ status: a.status, contentType: "application/geo+json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(a.body) }); }
        return r.abort();
      });
      await pg.goto(`http://127.0.0.1:${port}/`);
      await pg.waitForFunction(() => document.querySelector('#wx-season .wxs-t[data-k="gdd30"] .wxs-v'), null, { timeout: 20000 });
      await pg.waitForFunction(() => { const t = document.getElementById("wx-temp"); return t && /\d/.test(t.textContent); }, null, { timeout: 20000 });
      await pg.waitForTimeout(1500);
      const got = await pg.evaluate(() => {
        const c = document.querySelector(".wx-card"), s = document.getElementById("wx-season");
        const small = [], taps = [];
        for (const el of c.querySelectorAll("*")) {
          const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
          if (!r.width || !r.height || cs.visibility === "hidden") continue;
          if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(cs.fontSize) < 12) small.push(el.className + ":" + cs.fontSize);
          // a glossary term inside a sentence (.gl-term, site-wide) is an inline target, exempt as inline links are
          if (el.matches("button,summary,a[href]") && !el.matches(".gl-term") && r.height < 44) taps.push((el.id || el.className || el.tagName) + ":" + Math.round(r.height));
        }
        return { h: Math.round(c.getBoundingClientRect().height), text: s.innerText, small, taps, strip: !!document.getElementById("spray-days-strip"), season: Math.round(s.getBoundingClientRect().height), min: parseFloat(getComputedStyle(s).minHeight) };
      });
      assert.ok(!got.strip, "no spray table on the page");
      // the page reads today's year for its labels: after 2026 the fixture year is named, so the year is optional here
      assert.match(got.text, /Rain, Jan 1 to Nov 3(?:, 2026)?\s+55\.03 in\s+\+20\.43 in \(159%\)/);
      assert.match(got.text, /GDDs, Oct 5 to Nov 3(?:, 2026)?\s+312 GDDs\s+\+22 \(108%\)/);
      assert.ok(got.h <= Math.round(BEFORE[width] * 0.7), `card ${got.h}px at ${width}, before ${BEFORE[width]}px: at least 30% less wanted`);
      assert.deepEqual(got.small, [], "text 12px or more");
      assert.deepEqual(got.taps, [], "taps 44px or more");
      assert.ok(got.season <= got.min + 1, `Season so far fills inside its held space (${got.season}px, held ${got.min}px)`);
      const shifts = await pg.evaluate(() => window.__shifts.filter((x) => x.s.includes("card")));
      assert.deepEqual(shifts, [], "nothing in the card moves the page");
      // the chart and the stations open on tap, in place
      await pg.click("#wxs-chart-b");
      assert.equal(await pg.getAttribute("#wxs-chart-b", "aria-expanded"), "true");
      assert.ok(await pg.isVisible("#wxs-chart svg"));
      await pg.click(".wxs-src > summary");
      assert.match(await pg.textContent(".wxs-src p"), /Gilbert, 0\.2 mi W/);
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
