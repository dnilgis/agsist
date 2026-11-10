/* The weather fold on county rain pages (fx/rainwx, Nov 4, 2026).
 *
 * scripts/fetch_rain_weather.py --selftest holds the arithmetic on hand-worked and saved (made-up) ACIS
 * answers: corn GDD known values, the 5% missing-day withhold, no rank under 20 years of record, no
 * figure without its date. build_county_rain.py --selftest holds the baked line and the FAQ answers.
 * This holds the fold's body (components/rain-wx.js) to the same rules, and the workflow to its step.
 *
 *   node --test test/rain-wx.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const py = (args) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const W = createRequire(import.meta.url)(ROOT + "components/rain-wx.js");

const ROW = {
  a: 1103, g: [2912, 2, 2759, 30, 106], mh: 2, ml: 0, n: 307, h: [97, 721, 2], l: [-18, 108, 0], d9: 12, d3: 8,
  fr: { s32: [412, 414, 30], s28: [403, 406, 30], f32: [1027, 1025, 30], f28: [0, 1102, 30] },
  nt: [["h", 10, 88, 1005, 2011, 76]],
};
const DATED = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\b/;
const items = (html) => [...html.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]);

test("the fetch arithmetic, on hand-worked and saved answers", () => {
  assert.match(py(["scripts/fetch_rain_weather.py", "--selftest"]), /fetch_rain_weather selftest: ok/);
});

test("every figure in the fold carries its date or its span", () => {
  const h = W.render(ROW, "station");
  const li = items(h);
  assert.ok(li.length >= 8, h);
  for (const x of li) assert.match(x, DATED, x);
  assert.match(h, /2,912, 106% of the 1991 to 2020 average for the same days \(2,759, 30 years\); 2 days not reported, left out of both\./);
  assert.match(h, /97&deg;F on Jul 21, and 2 days more at 97&deg;F/);
  assert.match(h, /&minus;18&deg;F on Jan 8/);
  assert.match(h, /<b>First fall freeze:<\/b> 32&deg;F on Oct 27 \(usual: Oct 25\); 28&deg;F none yet through Nov 3 \(usual: Nov 2\)\./);
  assert.match(h, /1991 to 2020 record; a usual freeze date is the middle year of 30 years\./);
  assert.match(h, /88&deg;F on Oct 5, the warmest October day here since 2011 \(76 years of record\)/);
  assert.match(h, /held between 50&deg;F and 86&deg;F, averaged, minus 50, the standard corn method/, "the method is said where it is read");
  assert.match(h, /NOAA daily records through RCC-ACIS/);
  assert.doesNotMatch(h, /<a\b/, "no link to a data source");
  assert.doesNotMatch(h, /—/, "no em dash");
});

test("a withheld figure says so, with no number", () => {
  const h = W.render({ ...ROW, g: "m", h: "m", d9: "m", fr: { f32: ["m", 1025, 30] }, nt: [] }, "station");
  const li = items(h);
  for (const k of ["Corn GDDs, May 1 to Nov 3", "Hottest day", "Days at 90&deg;F or above, Jan 1 to Nov 3"]) {
    const x = li.find((s) => s.startsWith("<b>" + k));
    assert.ok(x && x.endsWith("not enough days reported"), k + ": " + x);
  }
  assert.ok(li.find((s) => s.startsWith("<b>First fall freeze")).includes("32&deg;F not enough days reported"));
  assert.doesNotMatch(li.find((s) => s.startsWith("<b>Hottest")), /97/);
});

test("another station than the rain gauge is named, with its distance", () => {
  const h = W.render({ ...ROW, s: ["8 miles west-southwest of Ames", "130203 2", 10] }, "gauge");
  assert.match(h, /Highs and lows from the weather station 8 miles west-southwest of Ames, 10 miles from the rain gauge, which keeps no temperatures\. Jan 1 to Nov 3\./);
  const same = W.render(ROW, "station");
  assert.match(same, /Highs and lows from the same station, Jan 1 to Nov 3\./);
  assert.match(W.render({ ...ROW, g: [2912, 0] }, "station"), /2,912, no 1991 to 2020 average for this station yet\./);
});

test("the workflow runs the weather step best effort, after the rain, with its selftest first", () => {
  const wf = read(".github/workflows/county-rain.yml");
  assert.match(wf, /python scripts\/fetch_rain_weather\.py --selftest/);
  const step = wf.slice(wf.indexOf("- name: Weather (GDDs, extremes, freezes)"));
  assert.ok(wf.indexOf("- name: Weather (GDDs") > wf.indexOf("- name: Fetch"), "after the rain fetch");
  assert.ok(wf.indexOf("- name: Weather (GDDs") < wf.indexOf("- name: Check the data, build the pages"), "before the pages");
  assert.match(step.slice(0, 400), /continue-on-error: true/);
  assert.match(step.slice(0, 400), /timeout-minutes: 15/);
  assert.match(read("scripts/check_site_budget.py"), /"data\/rain\/wxnorm\/"/, "the normals cache is not served to readers");
  assert.match(read("scripts/build_county_rain.py"), /\/components\/rain-wx\.js\?v=1"/);
});
