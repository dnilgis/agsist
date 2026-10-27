/* /usda-calendar, the 2026-10-15 head-to-head fixes:
 *  - NASS livestock and dairy reports are on the calendar, with the dates and
 *    times USDA ESMIS lists under "Upcoming releases" (read 2026-10-15)
 *  - January 2027 says USDA has not posted its dates, instead of the list
 *    jumping from December to March (2026-10-27: the WASDE dates are posted,
 *    so January shows the WASDE and says the NASS dates are still to come)
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
  /* Earlier 2026 releases, added 2026-10-27 from NASS's own 2026 Agricultural
     Statistics Board Calendar (references branch copy, fetched 2026-10-16). */
  ["2026-01-23", "Cattle on Feed"], ["2026-02-20", "Cattle on Feed"], ["2026-03-20", "Cattle on Feed"],
  ["2026-04-17", "Cattle on Feed"], ["2026-05-22", "Cattle on Feed"], ["2026-06-18", "Cattle on Feed"],
  ["2026-07-24", "Cattle on Feed"], ["2026-08-21", "Cattle on Feed"], ["2026-09-18", "Cattle on Feed"],
  ["2026-03-26", "Quarterly Hogs and Pigs"], ["2026-06-25", "Quarterly Hogs and Pigs"], ["2026-09-24", "Quarterly Hogs and Pigs"],
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

test("January 2027 holds only what USDA has posted, and says what is still to come", () => {
  /* 2026-10-27: USDA's WASDE page posts the 2027 WASDE dates (read 2026-10-27
     and 2026-10-24); NASS has not posted its 2027 calendar. So January 2027
     carries the Jan 12 WASDE and nothing guessed, and says the Crop Production
     summary and Grain Stocks dates are still to come. */
  const jan = REPORTS.filter((r) => r.date.startsWith("2027-01"));
  assert.deepEqual(jan.map((r) => [r.date, r.name, r.time]), [["2027-01-12", "WASDE", "12:00 PM ET"]]);
  assert.ok(!REPORTS.some((r) => r.date >= "2027-01-01" && (r.type === "supply" || r.type === "stocks" || r.type === "livestock")),
    "no guessed 2027 NASS dates");
  assert.match(CAL, /USDA NASS has not posted its 2027 report dates yet\./);
  assert.match(CAL, /const JAN_NASS_PENDING=!REPORTS\.some\(r=>r\.date\.slice\(0,7\)===JAN_KEY&&\(r\.type==='supply'\|\|r\.type==='stocks'\)\)/);
  assert.match(CAL, /if\(key===JAN_KEY&&JAN_NASS_PENDING\)html\+=JAN_NASS_NOTE;/);
  // the whole-year note stays for a year whose WASDE dates are not posted either
  assert.match(CAL, /USDA has not posted its 2027 report dates yet\./);
});

test("the 2027 WASDE rows are the twelve USDA posted, the same table as scripts/usda_dates.py", () => {
  const PY = readFileSync(ROOT + "scripts/usda_dates.py", "utf8");
  const m = /WASDE_2027 = \{([^}]*)\}/.exec(PY);
  assert.ok(m, "WASDE_2027 in usda_dates.py");
  const tbl = [...m[1].matchAll(/date\(2027, (\d+), (\d+)\)/g)]
    .map(([, mo, d]) => "2027-" + mo.padStart(2, "0") + "-" + d.padStart(2, "0")).sort();
  const page = REPORTS.filter((r) => r.name === "WASDE" && r.date.startsWith("2027")).map((r) => r.date).sort();
  const usda = ["2027-01-12", "2027-02-10", "2027-03-10", "2027-04-09", "2027-05-12", "2027-06-11",
    "2027-07-09", "2027-08-12", "2027-09-10", "2027-10-08", "2027-11-10", "2027-12-10"];
  assert.deepEqual(page, usda);
  assert.deepEqual(tbl, usda);
  for (const r of REPORTS.filter((x) => x.name === "WASDE" && x.date.startsWith("2027"))) {
    assert.equal(r.time, "12:00 PM ET");
    const wd = new Date(r.date + "T12:00:00Z").getUTCDay();
    assert.ok(wd >= 1 && wd <= 5, r.date + " is a weekday");
  }
  assert.match(CAL, /2027 WASDE dates, read 2026-10-27 from USDA's WASDE page/);
});
