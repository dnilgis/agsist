/* Nov 11, 2026: the morning after the Nov 10 WASDE every Daily try was blocked by the fact check
   on two dates that code had written, not the model:
   - the holiday-week Export Sales line "Thursday or Friday, Nov 12 or 13" was turned into
     "Thursday or Thursday" by the weekday fixer (scripts/generate_daily.py fix_weekday_labels);
   - "Tuesday's report gain" was dated as next Tuesday, "Tuesday's (Nov 17)", by
     scripts/watch_dates.py.
   Frozen dates only: the issue day is passed in, never read from the clock. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function py(code) {
  return JSON.parse(execFileSync("python3", ["-I", "-c", code], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, PYTHONPATH: path.join(ROOT, "scripts") },
  }).trim().split("\n").pop());
}

const fixLabels = (lines) => py(`
import sys, json
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, "scripts"))})
from datetime import date
import generate_daily as g
items = [{"time": t, "desc": ""} for t in ${JSON.stringify(lines)}]
b, fixes = g.fix_weekday_labels({"watch_list": items}, date(2026, 11, 11))
print(json.dumps([w["time"] for w in b["watch_list"]]))
`);

test("Nov 11: the holiday-week pair 'Thursday or Friday, Nov 12 or 13' is left as written", () => {
  const [a] = fixLabels(["Thursday or Friday, Nov 12 or 13, 7:30 AM CT"]);
  assert.equal(a, "Thursday or Friday, Nov 12 or 13, 7:30 AM CT");
});

test("Nov 11: a wrong weekday inside a pair is fixed against its own day number", () => {
  const [a, b] = fixLabels(["Thursday or Thursday, Nov 12 or 13", "Wednesday or Friday, Nov 12 or 13"]);
  assert.equal(a, "Thursday or Friday, Nov 12 or 13");
  assert.equal(b, "Thursday or Friday, Nov 12 or 13");
});

test("Nov 11: a pair with the month written twice is left as written, or fixed per day", () => {
  const [a, b] = fixLabels(["Thursday or Friday, Nov 12 or Nov 13", "Thursday or Thursday, Nov 12 or Nov 13"]);
  assert.equal(a, "Thursday or Friday, Nov 12 or Nov 13");
  assert.equal(b, "Thursday or Friday, Nov 12 or Nov 13");
});

test("Nov 11: a number after 'or' or 'to' that is not a day (13.5 million, 7 AM) is not read as one", () => {
  const [a, b] = fixLabels(["Monday to Friday, Nov 13 to 7 AM", "Thursday or Friday, Nov 12 or 13.5 million"]);
  assert.equal(a, "Monday to Friday, Nov 13 to 7 AM");
  assert.equal(b, "Thursday or Friday, Nov 12 or 13.5 million");
  assert.doesNotMatch(b, /Thursday or Thursday/);
});

test("Nov 11: a single wrong weekday is still fixed, and two dated days stay apart", () => {
  const [a, b] = fixLabels(["Friday, Nov 12, 7:30 AM CT", "Thursday, Nov 12 or Friday, Nov 13"]);
  assert.equal(a, "Thursday, Nov 12, 7:30 AM CT");
  assert.equal(b, "Thursday, Nov 12 or Friday, Nov 13");
});

const watchDates = (descs, wasde = "None", now = "datetime(2026, 11, 11, 6, 45)") => py(`
import sys, json
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, "scripts"))})
from datetime import datetime, date
import watch_dates
items = [{"time": "Ongoing", "desc": d} for d in ${JSON.stringify(descs)}]
b, _ = watch_dates.apply({"watch_list": items}, ${now}, [], ${wasde})
print(json.dumps([w["desc"] for w in b["watch_list"]]))
`);

test("Nov 11: Tuesday's report gain is dated Nov 10, never next Tuesday", () => {
  const [a, b] = watchDates([
    "Corn has to hold Tuesday's report gain above $4.40.",
    "Beans gave back Monday's drop overnight.",
  ]);
  assert.equal(a, "Corn has to hold Tuesday's (Nov 10) report gain above $4.40.");
  assert.equal(b, "Beans gave back Monday's (Nov 9) drop overnight.");
  assert.doesNotMatch(a, /Nov 17/);
});

test("Nov 11: a report still to come keeps its forward date", () => {
  const [a] = watchDates(["Friday's Export Sales report could show China buying."]);
  assert.equal(a, "Friday's (Nov 13) Export Sales report could show China buying.");
});

test("Nov 11: a move word inside a forward line does not turn it back", () => {
  const lines = {
    "Monday's Crop Progress could trigger selling.": "Monday's (Nov 16) Crop Progress could trigger selling.",
    "Friday's CPI could spark a selloff.": "Friday's (Nov 13) CPI could spark a selloff.",
    "Friday's report could spark a rally": "Friday's (Nov 13) report could spark a rally",
    "Friday's Export Sales may add to gains": "Friday's (Nov 13) Export Sales may add to gains",
    "Friday's data could trigger a drop": "Friday's (Nov 13) data could trigger a drop",
    "Next Tuesday's report could erase the gain": "Next Tuesday's (Nov 17) report could erase the gain",
    "Friday's report could trigger buying": "Friday's (Nov 13) report could trigger buying",
    "Thursday's sales may bring a rally": "Thursday's (Nov 12) sales may bring a rally",
  };
  for (const wasde of ["None", "date(2026, 11, 10)"]) {
    const got = watchDates(Object.keys(lines), wasde);
    assert.deepEqual(got, Object.values(lines), `wasde=${wasde}`);
  }
});

test("Nov 11: Tuesday's report, by the release calendar, is the Nov 10 WASDE", () => {
  const lines = {
    "Tuesday's report": "Tuesday's (Nov 10) report",
    "Tuesday's WASDE report": "Tuesday's (Nov 10) WASDE report",
    "Tuesday's report reaction": "Tuesday's (Nov 10) report reaction",
  };
  for (const wasde of ["None", "date(2026, 11, 10)"]) {
    assert.deepEqual(watchDates(Object.keys(lines), wasde), Object.values(lines), `wasde=${wasde}`);
  }
});

test("Oct 21: Tuesday's report with no release on the last Tuesday stays forward", () => {
  const [a] = watchDates(["Tuesday's report"], "None", "datetime(2026, 10, 21, 6, 45)");
  assert.equal(a, "Tuesday's (Oct 27) report");
});
