/* /usda-calendar: the 2026 releases an outside check found missing (Oct 24, 2026).
 *
 * The check compared the page with USDA and found no wrong date, but 2026
 * releases of Cattle on Feed, Crop Production and Hogs and Pigs absent. Each
 * date below is from NASS's own 2026 Agricultural Statistics Board Calendar
 * (nass.usda.gov/Publications/Calendar/2026/, copy fetched 2026-10-16), and
 * each must be on the page, in the .ics files, on the weekday USDA set.
 *
 * Not here: the twelve 2027 WASDE dates the same check read on usda.gov. They
 * were added 2026-10-27 after a second read of that page gave the same twelve;
 * test/usda-calendar-h2h.test.mjs checks them.
 *
 *   node --test test/usda-calendar-2026-gaps.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readPage } from "../scripts/build_usda_ics.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SRC = readFileSync(ROOT + "usda-calendar.html", "utf8");
const page = readPage(SRC);
const REPORTS = page.reports ?? page;

const WANT = {
  "Cattle on Feed": ["2026-01-23", "2026-02-20", "2026-03-20", "2026-04-17", "2026-05-22", "2026-06-18", "2026-07-24", "2026-08-21", "2026-09-18"],
  "Crop Production": ["2026-01-12", "2026-02-10", "2026-03-10", "2026-05-12", "2026-06-11", "2026-07-10", "2026-09-11"],
  "Quarterly Hogs and Pigs": ["2026-03-26", "2026-06-25", "2026-09-24"],
};
/* The NASS calendar's weekday for each, read off its column: Cattle on Feed on
   Fridays except Thu Jun 18 (Fri Jun 19 is the Juneteenth holiday on that
   calendar), Hogs and Pigs on Thursdays, Crop Production as dated. */
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY = { "Cattle on Feed": "Fri", "Quarterly Hogs and Pigs": "Thu" };

test("every 2026 release the check found missing is on the page", () => {
  let n = 0;
  for (const [name, dates] of Object.entries(WANT))
    for (const d of dates) {
      const row = REPORTS.find((r) => r.date === d && r.name === name);
      assert.ok(row, `${name} ${d} is on /usda-calendar`);
      assert.match(row.time, name === "Crop Production" ? /^12:00 PM ET$/ : /^3:00 PM ET$/, `${name} ${d} time`);
      if (WEEKDAY[name]) assert.equal(DOW[new Date(d + "T12:00:00Z").getUTCDay()], d === "2026-06-18" ? "Thu" : WEEKDAY[name], `${name} ${d} weekday`);
      n++;
    }
  assert.equal(n, 19);
});

test("the Annual Summary still stands beside January's Crop Production", () => {
  assert.ok(REPORTS.some((r) => r.date === "2026-01-12" && r.name === "Crop Production Annual Summary"));
});

test("no report appears twice on one day", () => {
  const seen = new Set();
  for (const r of REPORTS) {
    const k = r.date + "|" + r.name;
    assert.ok(!seen.has(k), `${k} twice`);
    seen.add(k);
  }
});

test("the subscribe files carry them too", () => {
  const ics = readFileSync(ROOT + "usda-calendar.ics", "utf8");
  for (const [name, dates] of Object.entries(WANT))
    for (const d of dates) {
      const stamp = d.replace(/-/g, "");
      assert.match(ics, new RegExp(`DTSTART[^:]*:${stamp}T[\\s\\S]{0,400}?SUMMARY:[^\\n]*${name.replace(/ /g, " ")}`), `${name} ${d} in usda-calendar.ics`);
    }
});
