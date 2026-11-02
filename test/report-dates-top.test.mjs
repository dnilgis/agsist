/* The survey day and the release day, plainly at the top (benchmark review, Oct 29, 2026):
 * COT positions are held Tuesday and released Friday; Crop Progress covers a week ending Sunday
 * and comes out the Monday after. A reader should never take either for a live count.
 *   node --test test/report-dates-top.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const py = (code) => execFileSync("python3", ["-c", `import sys; sys.path.insert(0, ${JSON.stringify(ROOT + "scripts")})\n` + code], { encoding: "utf8", cwd: ROOT }).trim();

test("COT: the baked summary names the Tuesday and the release day", () => {
  const cot = JSON.parse(read("data/cot.json"));
  const h = read("cot.html");
  const m = /<!-- PRERENDER:cot-summary -->Managed-money positioning on <b>Tuesday, ([A-Z][a-z]+ \d{1,2}, \d{4})<\/b>, released ([A-Z][a-z]+day), ([A-Z][a-z]+ \d{1,2}): /.exec(h);
  assert.ok(m, "the dated summary");
  assert.equal(m[1], cot.report_date);
  assert.ok(h.indexOf(m[0]) < h.indexOf('id="cot-verdict-banner"'), "above the verdict");
  // Oct 20, 2026 -> Friday Oct 23 (cot_calendar.release_date); a Thanksgiving week -> the Monday after
  assert.equal(py("import cot_calendar, datetime; print(cot_calendar.release_date(datetime.date(2026,10,20)))"), "2026-10-23");
  assert.equal(py("import cot_calendar, datetime; print(cot_calendar.release_date(datetime.date(2026,11,24)))"), "2026-11-30");
});

test("COT: the live banner says the same, with the release day only from the same report", () => {
  const js = read("components/cot-page.js");
  const m = /function cotReleased\(\)\{[\s\S]*?\n\}/.exec(js);
  assert.ok(m);
  const run = (cx, loaded) => {
    const c = { CX_A: cx, COT_LOADED: loaded };
    vm.runInNewContext(/function cxAligned\(\)\{[\s\S]*?\n\}/.exec(js)[0] + m[0] + "; this.out = cotReleased();", c);
    return c.out;
  };
  assert.equal(run({ report_date: "2026-10-20", release_date: "2026-10-23" }, "October 20, 2026"), " · released Fri Oct 23");
  assert.equal(run({ report_date: "2026-10-13", release_date: "2026-10-16" }, "October 20, 2026"), "", "last week's analysis file says nothing");
  assert.match(js, /date\.textContent = 'Positions held Tuesday, ' \+ summary\.report_date \+ cotReleased\(\) \+ ' · CFTC Disaggregated, futures only';/);
  assert.match(read("cot.html"), /cot-page\.js\?v=4/);
});

test("Crop conditions: the top line names the week ending and the release day", () => {
  const cp = JSON.parse(read("data/crop-progress.json"));
  if (!cp.in_season) return;
  const h = read("conditions.html");
  const m = /<!--SEED:condweek-->Week ending ([A-Z][a-z]{2} \d{1,2}, \d{4}), released ([A-Z][a-z]{2}), ([A-Z][a-z]{2} \d{1,2}) \(USDA NASS\)/.exec(h);
  assert.ok(m, "the dated top line");
  assert.equal(py("import seed_static as s, datetime; print(s._cp_released(datetime.date(2026,10,25)))"), ", released Mon, Oct 26");
  assert.equal(py("import seed_static as s, datetime; print(s._cp_released(datetime.date(2026,9,6)))"), ", released Tue, Sep 8", "Labor Day moves it to Tuesday");
});
