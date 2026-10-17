/* Hail storm days follow the Storm Prediction Center's convective day,
 * 12:00 UTC to 12:00 UTC, labeled by its start date (accuracy pass, Oct 17 2026).
 * IEM's Local Storm Report times are UTC; grouping by the UTC date put the
 * 3.00 inch Coleman County, Texas stone of 8:01 pm CDT May 21, 2024
 * (01:01 UTC May 22) on the May 22 page.
 *
 *   node --test test/hail-storm-day.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

function py(code) {
  const pre = "import sys, json; sys.path.insert(0, 'scripts'); sys.dont_write_bytecode = True\n";
  return JSON.parse(execFileSync("python3", ["-c", pre + code], { cwd: ROOT, encoding: "utf8" }));
}

test("an 8:01 pm CDT May 21 report lands on May 21 (fixture: the Coleman County stone)", () => {
  const out = py(`
import fetch_hail as fh
coleman = {"valid": "202405220101", "valid2": "2024/05/22 01:01", "typetext": "HAIL",
           "mag": "3.00", "lat": "31.74", "lon": "-99.33", "state": "TX"}
v2only = {"valid2": "2024/05/22 01:01", "typetext": "HAIL", "mag": "3.00"}
morning = {"valid": "202405221159", "typetext": "HAIL"}   # 6:59 am CDT May 22: still the May 21 storm day
noon = {"valid": "202405221200", "typetext": "HAIL"}      # 7:00 am CDT May 22: May 22 begins
afternoon = {"valid": "202405212300", "typetext": "HAIL"} # 6:00 pm CDT May 21
no_time = {"valid2": "2024/05/22", "typetext": "HAIL"}
newyear = {"valid": "202501010500", "typetext": "HAIL", "lat": "30", "lon": "-95", "state": "TX"}
print(json.dumps({
  "coleman": fh._date_of(coleman), "v2only": fh._date_of(v2only),
  "morning": fh._date_of(morning), "noon": fh._date_of(noon),
  "afternoon": fh._date_of(afternoon), "no_time": fh._date_of(no_time),
  "month": fh._month_of(morning),
  "ev2024": fh.events_year([coleman, newyear], 2024),
  "ev2025": fh.events_year([newyear], 2025),
  "rule": fh.DAY_RULE,
}))`);
  assert.equal(out.coleman, "2024-05-21");
  assert.equal(out.v2only, "2024-05-21", "valid2 alone is read as UTC too");
  assert.equal(out.morning, "2024-05-21");
  assert.equal(out.noon, "2024-05-22");
  assert.equal(out.afternoon, "2024-05-21");
  assert.equal(out.no_time, null, "a bare date is not guessed into a storm day");
  assert.equal(out.month, 5);
  // 11 pm CST Dec 31, 2024 (05:00 UTC Jan 1) is the Dec 31 storm day: 2024's file, not 2025's
  assert.deepEqual(out.ev2024.map((e) => e[3]), ["05-21", "12-31"]);
  assert.deepEqual(out.ev2025, []);
  assert.equal(out.rule, "spc-12z");
});

test("the year request covers the storm days that start in that year (12Z to 12Z)", () => {
  const src = readFileSync(ROOT + "scripts/fetch_hail.py", "utf8");
  assert.match(src, /sts = "%d-01-01T%02d:00Z" % \(year, DAY_START_UTC_HOUR\)/);
  assert.match(src, /ets = "%d-01-01T%02d:00Z" % \(year \+ 1, DAY_START_UTC_HOUR\)/);
  assert.match(src, /"day_rules": day_rules/, "the manifest records the rule per year file");
  assert.match(src, /"day_rule": DAY_RULE, "count": len\(recent\)/, "recent.json records its rule");
});

test("day pages state the rule their data was built with", () => {
  const out = py(`
import generate_hail_events as g
spc = g._new_rec("events-2024.json", "spc-12z")
old = g._new_rec("events-2024.json", None)
for r in (spc, old):
    g._add_report(r, 31.74, -99.33, 3.0, "TX")
print(json.dumps({
  "spc": g.page_html("2024-05-21", spc, False, None, "2026-10-17", None),
  "old": g.page_html("2024-05-21", old, True, 2.5, "2026-10-17", None),
}))`);
  assert.match(out.spc, /A storm day runs 7 a\.m\. to 7 a\.m\. Central \(12:00 to 12:00 UTC\), as the Storm Prediction Center counts it/);
  assert.doesNotMatch(out.spc, /UTC calendar day/);
  assert.match(out.old, /grouped by UTC calendar day, 7 p\.m\. Central the evening before/);
  assert.match(out.old, /The radar swath covers the UTC calendar day/, "the swath's own day is stated");
  for (const h of [out.spc, out.old]) assert.doesNotMatch(h, /—/, "no em dashes");
});

test("published day pages carry a day-rule line that matches the manifest", () => {
  const man = JSON.parse(readFileSync(ROOT + "data/hail/manifest.json", "utf8"));
  const days = readdirSync(ROOT + "hail").filter((f) => /^20\d\d-\d\d-\d\d\.html$/.test(f));
  assert.ok(days.length > 0);
  for (const f of days.filter((f) => f < "2026-09-01")) {  // yearly-file days; newer ones may read recent.json
    const page = readFileSync(ROOT + "hail/" + f, "utf8");
    const spc = (man.day_rules || {})[f.slice(0, 4)] === "spc-12z";
    assert.match(page, spc ? /A storm day runs 7 a\.m\. to 7 a\.m\. Central/ : /grouped by UTC calendar day/, f);
  }
});

test("a hail size past the 8.0 in US record counts as unknown (a 65.0 in entry was a mis-filed wind gust)", () => {
  const out = execFileSync("python3", ["-c",
    "import sys; sys.path.insert(0, 'scripts'); import fetch_hail as f; " +
    "print(f.mag_of({'magnitude': '65.0'}), f.mag_of({'magnitude': '8.0'}), f.mag_of({'magnitude': '1.75'}), f.mag_of({'magnitude': '0'}))"],
    { encoding: "utf8" }).trim();
  assert.equal(out, "None 8.0 1.75 None");
});
