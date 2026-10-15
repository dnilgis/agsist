/* /usda-calendar, the 2026-10-15 head-to-head fixes:
 *  - NASS livestock and dairy reports are on the calendar, with the dates and
 *    times USDA ESMIS lists under "Upcoming releases" (read 2026-10-15)
 *  - January 2027 says USDA has not posted its dates, instead of the list
 *    jumping from December to March
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CAL = readFileSync(ROOT + "usda-calendar.html", "utf8");

const REPORTS = (() => {
  const a = CAL.indexOf("const REPORTS = [");
  const b = CAL.indexOf("\n  ];", a);
  assert.ok(a > 0 && b > a, "REPORTS array found");
  return JSON.parse(JSON.stringify(vm.runInNewContext("(" + CAL.slice(a + "const REPORTS = ".length, b + 4) + ")")));
})();

// USDA ESMIS "Upcoming releases", each report's publication page, 2026-10-15.
const WANT = [
  ["2026-10-22", "Milk Production"], ["2026-11-20", "Milk Production"], ["2026-12-22", "Milk Production"],
  ["2026-10-23", "Cattle on Feed"], ["2026-11-20", "Cattle on Feed"], ["2026-12-18", "Cattle on Feed"],
  ["2026-10-23", "Cold Storage"], ["2026-11-24", "Cold Storage"], ["2026-12-23", "Cold Storage"],
  ["2026-12-23", "Quarterly Hogs and Pigs"],
];

test("livestock and dairy reports carry USDA's published dates, at 3:00 PM ET", () => {
  const got = REPORTS.filter((r) => r.type === "livestock").map((r) => [r.date, r.name]);
  assert.deepEqual(got.slice().sort(), WANT.slice().sort());
  for (const r of REPORTS.filter((x) => x.type === "livestock")) {
    assert.equal(r.time, "3:00 PM ET", r.name + " " + r.date);
    const dow = new Date(r.date + "T12:00:00Z").getUTCDay();
    assert.ok(dow >= 1 && dow <= 5, `${r.name} ${r.date} is not a weekday`);
    assert.ok(r.link && r.linkText, `${r.name} links to the matching AGSIST page`);
  }
});

test("a Livestock & Dairy filter, tag, legend and source", () => {
  assert.match(CAL, /filterReports\('livestock',this\)">Livestock &amp; Dairy<\/button>/);
  assert.match(CAL, /\.tag-livestock\{/);
  assert.match(CAL, /livestock:'Livestock'\}/);
  assert.match(CAL, /esmis\.nal\.usda\.gov\/release-calendar/);
  // livestock rows never borrow the ARC/PLC link text
  assert.match(CAL, /\$\{r\.link&&r\.type==='fsa'\?/);
});

test("January 2027 is a plain note until USDA posts the dates", () => {
  assert.ok(!REPORTS.some((r) => r.date.startsWith("2027-01")), "no guessed January 2027 dates");
  assert.match(CAL, /USDA has not posted its 2027 report dates yet\./);
  assert.match(CAL, /const JAN_KEY='2027-01', JAN_PENDING=!REPORTS\.some/);
});
