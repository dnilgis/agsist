/* /hail-map lookup, field audit fixes (2026-10-17).
 *   1. The result leads with the year's NWS ground reports, then the radar's
 *      30-day line, labeled. It used to open on "No radar-estimated hail" with
 *      five reports from March in the table below.
 *   2. "Most recent" is the latest date and, on that date, the nearest report
 *      (it was ev[0], whichever row of the day came first: 8 mi instead of 1).
 *   3. The phone's pinned year bar sits under the site header (z-index 400).
 *
 *   node --test test/hail-year-first.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "hail-map.html", "utf8");
function lift(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name + " not found");
  let depth = 0, seen = false;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") { depth++; seen = true; }
    else if (src[i] === "}") { depth--; if (seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(name + " never closes");
}
const newestOf = Function(lift(HTML, "newestOf") + "\nreturn newestOf;")();
const fmtDate = (d) => d;
const esc = (s) => String(s);
const yearLine = (ev, mi) => Function("esc", "fmtDate", "newestOf", "lookupMi", lift(HTML, "yearLine") + "\nreturn yearLine;")(esc, fmtDate, newestOf, mi)(ev);
const Y = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).slice(0, 4);

test("most recent: the latest date, the nearest report on a tie, whatever the row order", () => {
  // 61701's case: five reports on the newest day, the 8.2 mi one listed first
  const ev = [{ date: "2026-03-26", mi: 8.2 }, { date: "2026-03-26", mi: 1.0 }, { date: "2026-03-26", mi: 4.3 }, { date: "2025-06-01", mi: 0.2 }];
  assert.equal(newestOf(ev).mi, 1.0);
  assert.equal(newestOf([{ date: "2025-01-01", mi: 1 }, { date: "2026-02-02", mi: 9 }]).date, "2026-02-02", "order does not matter");
  assert.equal(newestOf([]), null);
  assert.match(HTML, /var newest=newestOf\(ev\);/);
  assert.doesNotMatch(HTML, /var newest=ev\.length\?ev\[0\]:null;/);
});

test("the year line: count, nearest, latest; and an honest none", () => {
  const ev = [{ date: Y + "-03-26", mi: 8.2, mag: 1 }, { date: Y + "-03-26", mi: 1.0, mag: 1 }, { date: Y + "-05-02", mi: 4.0, mag: null }, { date: "2020-06-01", mi: 0.2, mag: 2 }];
  const t = yearLine(ev, 10);
  assert.match(t, new RegExp(`^<strong>${Y}: hail reported 3 times within 10 mi, on 2 days\\.</strong> Nearest: 1\\.0 mi away on ${Y}-03-26 \\(1\\.00\u2033\\)\\. Latest: ${Y}-05-02 \\(4\\.0 mi away\\)\\.`));
  assert.match(t, /\(NWS ground reports\)$/);
  const none = yearLine([{ date: "2020-06-01", mi: 2.5, mag: 1.25 }], 5);
  assert.match(none, new RegExp(`^<strong>${Y}: no hail reported within 5 mi so far\\.</strong> Last report: 2020-06-01, 1\\.25\u2033, 2\\.5 mi away\\.`));
  assert.match(yearLine([], 10), /None in the last 5 years either\./);
  assert.ok(!/\u2014/.test(lift(HTML, "yearLine")), "no em dashes");
});

test("the year line comes before the radar line, and every radar line is labeled", () => {
  assert.ok(HTML.indexOf('id="hm-yearline"') < HTML.indexOf('id="hm-verdict"'));
  const quiet = HTML.match(/v\.innerHTML=([^;\n]*)No radar-estimated hail \\u22650\.75\\u2033 '\+WHERE\+' in the last 30 days/);
  assert.ok(quiet && /VLAB/.test(quiet[1]), "the 30-day line starts with its label");
  assert.match(HTML, /var VLAB {2}= '<span class="hm-vlab">Radar'\+\(lookupDay\?', '\+esc\(fmtDate\(lookupDay\)\):', last 30 days'\)\+'<\/span>';/);
});

test("the phone's pinned year bar stays under the site header", () => {
  const m = HTML.match(/\.hm-controls, \.hm-meshnav\{position:sticky;bottom:8px;z-index:(\d+);/);
  assert.ok(m, "sticky rule found");
  assert.ok(+m[1] < 400, "z-index under the header's 400, got " + m[1]);
  assert.ok(+m[1] > 1, "still over the map (z-index 1)");
});
