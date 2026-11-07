/* The Saturday and Sunday Dailies' code-built blocks (scripts/daily_weekend.py, fx/weekend-daily).
 * Saturday "The week in review": Friday vs last Friday on the same dated contract both Fridays.
 * Sunday "The week ahead": Reports this week from usda_dates and cot_calendar.
 * Fixtures only (test/fixtures/weekend-daily): the numbers are the approved Nov 7 2026 sample's,
 * built from frozen files, never from live data or today's date. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FX = join(ROOT, "test/fixtures/weekend-daily");
const py = (code) => JSON.parse(execFileSync("python3", ["-I", "-c",
  `import sys,json;sys.path.insert(0,${JSON.stringify(ROOT + "scripts")})\nfrom datetime import date\nimport daily_weekend as W\n${code}`],
  { encoding: "utf8" }));
const review = (archive, prices = join(FX, "prices.json"), day = "2026, 11, 7") =>
  py(`p=json.load(open(${JSON.stringify(prices)}))\nprint(json.dumps(W.week_review(date(${day}), p, ${JSON.stringify(archive)})))`);
const row = (b, name) => b.rows.find((r) => r.name.startsWith(name));

test("Saturday Nov 7: the sample's numbers come back from the fixture files", () => {
  const b = review(join(FX, "archive"));
  assert.equal(b.head, "Friday vs last Friday");
  assert.equal(b.stamp, "last trade each Friday, not the settle");
  assert.deepEqual(b.rows.map((r) => r.name), ["Corn (Dec)", "Soybeans (Nov)", "Chicago wheat (Dec)", "Live cattle (Dec)",
    "Feeder cattle (Nov)", "Lean hogs (Dec)"]);
  const corn = row(b, "Corn");
  assert.equal(corn.prev, 447.5); // pin-ok: fixture
  assert.equal(corn.now, 442.25); // pin-ok: fixture
  assert.equal(corn.line, "Corn (Dec) $4.42 1/4, down 5 1/4 cents (−1.2%); Nov 6 last trade 1:20 PM CT"); // pin-ok: fixture
  const cattle = row(b, "Live cattle");
  assert.equal(cattle.key, "cattle-dec26", "the dated contract, not the front-month alias");
  assert.equal(cattle.prev, 220.775); // pin-ok: fixture
  assert.equal(cattle.now, 214.175); // pin-ok: fixture
  assert.equal(cattle.change, "down $6.60"); // pin-ok: fixture
  const hogs = row(b, "Lean hogs");
  assert.equal(hogs.extreme, "a 52-week low");
  assert.match(hogs.line, /\$53\.38, down \$5\.63 \(−9\.5%\), a 52-week low/); // pin-ok: fixture
  assert.ok(!b.rows.some((r) => r !== hogs && r.extreme), "only the close at its range end is marked");
  assert.equal(b.closes["corn-dec26"].px, 442.25, "this Friday's closes are stored for next Saturday"); // pin-ok: fixture
});

test("a contract roll drops the row; the other rows stay", () => {
  // the older stored issue: locked prices with contract labels; cattle was the Oct contract that Friday
  const b = review(join(FX, "archive-labels"));
  assert.ok(!b.rows.some((r) => r.name.startsWith("Live cattle")), "Oct vs Dec cattle is never compared");
  assert.equal(b.rows.length, 5);
  assert.equal(row(b, "Corn").prev, 447.5, "grain locked in dollars reads back in cents"); // pin-ok: fixture
});

test("no stored issue for last Friday, or no contract label: no block at all", () => {
  const empty = mkdtempSync(join(tmpdir(), "wk-"));
  assert.equal(review(empty), null);
  writeFileSync(join(empty, "2026-10-31.json"), JSON.stringify({ locked_prices: { corn: 4.475 }, // pin-ok: fixture
    locked_changes: { corn: { kind: "last", date: "2026-10-30" } } }));
  assert.equal(review(empty), null, "a locked price without its contract is not a baseline");
});

test("the settle wins when the file has one for that Friday, and the block says which", () => {
  const p = JSON.parse(readFileSync(join(FX, "prices.json"), "utf8"));
  p.quotes["corn-dec26"].settles["2026-11-06"] = 441.5; // pin-ok: fixture
  const dir = mkdtempSync(join(tmpdir(), "wk-"));
  writeFileSync(join(dir, "prices.json"), JSON.stringify(p));
  const b = review(join(FX, "archive"), join(dir, "prices.json"));
  const corn = row(b, "Corn");
  assert.equal(corn.now, 441.5); // pin-ok: fixture
  assert.equal(corn.now_basis, "settle");
  assert.equal(b.stamp, "settle or last trade, as marked");
  assert.match(corn.line, /; Nov 6 settle, Oct 30 last trade 1:20 PM CT$/);
  assert.match(row(b, "Lean hogs").line, /; Nov 6 last trade 2:05 PM CT, Oct 30 last trade 2:05 PM CT$/);
});

test("Sunday Nov 8: reports this week, Veterans Day and the COT move said plainly", () => {
  const b = py(`print(json.dumps(W.week_ahead(date(2026, 11, 8))))`);
  assert.equal(b.head, "Reports this week");
  assert.deepEqual(b.lines, [
    "Mon Nov 9: Crop Progress, 3:00 PM CT",
    "Tue Nov 10: WASDE and Crop Production, 11:00 AM CT",
    "Wed Nov 11: Veterans Day (federal offices closed)",
    "Thu Nov 12: Export Sales, 7:30 AM CT",
  ]);
  assert.deepEqual(b.notes, ["The COT report for Nov 10 moves to Mon Nov 16, 2:30 PM CT, because of Veterans Day."]);
  const next = py(`print(json.dumps(W.week_ahead(date(2026, 11, 15))))`);
  assert.equal(next.lines[0], "Mon Nov 16: COT report for Nov 10, 2:30 PM CT (moved by Veterans Day)");
  assert.ok(next.lines.includes("Fri Nov 20: COT report, 2:30 PM CT"));
  const col = py(`print(json.dumps(W.week_ahead(date(2026, 10, 11))))`);
  assert.ok(col.lines.includes("Tue Oct 13: Crop Progress, 3:00 PM CT (moved from Monday by Columbus Day)"));
});

test("weekday issues are unchanged: no block, no section", () => {
  const r = py(`print(json.dumps([W.for_issue(date(2026, 11, d)) for d in range(2, 7)]))`);
  assert.deepEqual(r, Array(5).fill([null, null]));
  const issue = join(ROOT, "test/fixtures/daily/2026-10-21-top-stories.json");
  const out = py(`import daily_v2 as V
d=json.load(open(${JSON.stringify(issue)}))
a=V.build(d,"https://agsist.com/daily/x.html",fact={},today=date(2026,10,21))
d2=dict(d,week_review={"title":"The week in review","head":"Friday vs last Friday","stamp":"settle each Friday","lines":["Corn (Dec) $4.41 1/2, down 6 cents (−1.3%)"],"notes":[],"source":"CME futures via Yahoo Finance, delayed"})
b=V.build(d2,"https://agsist.com/daily/x.html",fact={},today=date(2026,10,21))
print(json.dumps([a["slots"]["weekend"], "WEEK IN REVIEW" in a["text"], b["slots"]["weekend"], b["text"], b["html"]]))`);
  assert.equal(out[0], false);
  assert.equal(out[1], false);
  assert.equal(out[2], true);
  assert.match(out[3], /THE WEEK IN REVIEW\nFriday vs last Friday \(settle each Friday\)\n  Corn \(Dec\) \$4\.41 1\/2/);
  assert.match(out[4], /The week in review/);
  assert.ok(!/href="[^"]*yahoo/i.test(out[4]), "the source is named, never linked");
});

test("the archive page and the live page draw the stored block; the writer is told it exists", () => {
  const issue = { week_ahead: { head: "Reports this week", lines: ["Mon Nov 9: Crop Progress, 3:00 PM CT"], notes: ["A note."], source: "USDA and CFTC release calendars" } };
  const html = py(`import generate_daily as g\nprint(json.dumps(g.render_adds_html(json.loads(${JSON.stringify(JSON.stringify(issue))}))))`);
  assert.match(html, /<strong>Reports this week<\/strong>/);
  assert.match(html, /Mon Nov 9: Crop Progress, 3:00 PM CT/);
  const live = readFileSync(ROOT + "daily.html", "utf8");
  assert.ok(live.includes("'week_review','week_ahead'"), "daily.html draws both blocks (twin of render_adds_html)");
  const gen = readFileSync(ROOT + "scripts/generate_daily.py", "utf8");
  assert.ok(gen.includes("WEEK IN REVIEW TABLE") && gen.includes("WEEK AHEAD CALENDAR"), "weekend prompt names both blocks");
  assert.ok(gen.includes("_dwk.prompt_lines("), "the block's lines go to the writer");
  const fc = readFileSync(ROOT + "scripts/fact_check_briefing.py", "utf8");
  assert.ok(/"week_review", "week_ahead"/.test(fc), "code-built fields are source data for the fact check");
  const p = py(`print(json.dumps(W.prompt_lines("week_ahead", W.week_ahead(date(2026, 11, 8)))))`);
  assert.match(p, /never state any of these numbers, days or times differently/);
});

test("Infographic slot renders nothing until data/infographics/ exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "ig-"));
  const gone = join(dir, "infographics");
  assert.equal(py(`print(json.dumps(W.infographic(date(2026, 11, 7), ${JSON.stringify(gone)})))`), null);
  mkdirSync(gone);
  assert.equal(py(`print(json.dumps(W.infographic(date(2026, 11, 7), ${JSON.stringify(gone)})))`), null);
});

test("daily_weekend imports no reader of the moved COT history", () => {
  const src = readFileSync(ROOT + "scripts/daily_weekend.py", "utf8");
  assert.ok(!/import\s+(send_cot_weekly|cot_analysis|cot_deep)\b/.test(src));
  assert.ok(!src.includes("cot-deep"));
});
