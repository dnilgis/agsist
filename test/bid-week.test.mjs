/* The Saturday Daily's own-bid line: "Your bid at <elevator>: corn $X, up N cents from last Friday
 * (posted <time>)" (fx/bid-week). This Friday is the board's entry in data/bids-prev rows; last Friday
 * is the board's `fri` slot, one extra entry per key kept by scripts/build_bids_prev.py. The line is
 * built by scripts/daily_weekend.py bid_week, carried per ZIP by scripts/send_daily.py load_local_lines
 * and printed in The week in review by scripts/daily_v2.py.
 * Fixtures only (test/fixtures/bid-week/helper.py): made-up boards, fake readers, a fixed Saturday. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HELPER = join(ROOT, "test/fixtures/bid-week/helper.py");
const run = (c) => JSON.parse(execFileSync("python3", ["-I", HELPER, c], { encoding: "utf8" }));
const NOTE = "Each elevator's own posted board, last read each Friday. Not a contract. Call before you haul.";

test("both Fridays on the same board: one line a crop, the change and the posted time", () => {
  const r = run("both");
  assert.deepEqual(r.fri_dates, ["2026-10-30"], "on Saturday the slot holds last Friday"); // pin-ok: fixture
  assert.equal(r.rows_dates.at(-1), "2026-11-06", "and rows hold this Friday"); // pin-ok: fixture
  assert.ok(!r.rows_dates.includes("2026-10-30"), "rows alone (4 days) no longer reach last Friday"); // pin-ok: fixture
  assert.deepEqual(r.week.lines, [ // pin-ok: fixture (test/fixtures/bid-week/helper.py), a fixed Saturday, no live data
    "Your bid at Fixture Test Co-op, Plainsburg, KS: corn $4.15 1/4 for Nov delivery, up 5 1/4 cents from last Friday (posted Fri Nov 6, 1:15 PM CT)", // pin-ok: fixture
    "Your bid at Fixture Test Co-op, Plainsburg, KS: soybeans $10.18 for Nov delivery, down 7 cents from last Friday (posted Fri Nov 6, 1:15 PM CT)", // pin-ok: fixture
  ]);
  assert.equal(r.week.note, NOTE);
  assert.equal(r.not_saturday, null);
  assert.equal(r.sunday, null);
});

test("a missing Friday prints nothing; no other day stands in", () => {
  assert.equal(run("missing-last-friday"), null, "no sighting last Friday: no slot, no line");
  assert.equal(run("missing-this-friday"), null, "no sighting this Friday: Thursday is not used");
});

test("a delivery-period change drops that crop's line", () => {
  const r = run("period-change");
  assert.equal(r.lines.length, 1);
  assert.match(r.lines[0], /^Your bid at Fixture Test Co-op, Plainsburg, KS: soybeans /, "Nov corn last Friday is never compared with Dec corn");
});

test("a board that moved after Friday, or a posted time that is not Friday's price's, is withheld", () => {
  const r = run("moved-after-friday");
  assert.equal(r.moved, null);
  assert.equal(r.posted_saturday, null);
  assert.equal(r.no_posted, null);
});

test("send_daily: a Saturday reader with a ZIP gets the lines; no ZIP or a weekday gets none; counts only in the log", () => {
  const r = run("send");
  assert.equal(r.week.lines.length, 2);
  assert.equal(r.week.note, NOTE);
  assert.equal(r.no_zip_week, null);
  assert.equal(r.friday_week, null);
  assert.ok(r.log_has_no_address, "no address in the log");
  assert.deepEqual(r.log_count, ["weekly bid line (Friday vs last Friday): 1 reader(s)"]);
});

test("daily_v2 prints the reader's lines inside The week in review only", () => {
  const issue = join(ROOT, "test/fixtures/daily/2026-10-21-top-stories.json");
  const own = { lines: ["Your bid at Fixture Test Co-op, Plainsburg, KS: corn $4.15 1/4 for Nov delivery, up 5 1/4 cents from last Friday (posted Fri Nov 6, 1:15 PM CT)"], note: NOTE }; // pin-ok: fixture
  const out = JSON.parse(execFileSync("python3", ["-I", "-c", `import sys,json;sys.path.insert(0,${JSON.stringify(ROOT + "scripts")})
from datetime import date
import daily_v2 as V
d=json.load(open(${JSON.stringify(issue)}))
own=json.loads(${JSON.stringify(JSON.stringify(own))})
loc={"head":"Near Dodge City, KS: top corn bid $4.15 1/4 (Fixture Test Co-op, 4 mi).","detail":[],"note":"","week":own}
wr={"title":"The week in review","head":"Friday vs last Friday","stamp":"settle each Friday","lines":["Corn (Dec) $4.41 1/2, down 6 cents (−1.3%)"],"notes":[],"source":"CME futures via Yahoo Finance, delayed"}
wa={"title":"The week ahead","head":"Reports this week","lines":["Mon Nov 9: Crop Progress, 3:00 PM CT"],"notes":[],"source":"USDA and CFTC release calendars"}
sat=V.build(dict(d,week_review=wr),"https://agsist.com/daily/x.html",local=loc,fact={},today=date(2026,11,7))
sun=V.build(dict(d,week_ahead=wa),"https://agsist.com/daily/x.html",local=loc,fact={},today=date(2026,11,8))
wkd=V.build(d,"https://agsist.com/daily/x.html",local=loc,fact={},today=date(2026,10,21))
print(json.dumps([sat["text"],sat["html"],sat["slots"]["bid_week"],sun["text"],sun["slots"]["bid_week"],wkd["text"]]))`], { encoding: "utf8" }));
  const [satText, satHtml, satSlot, sunText, sunSlot, wkdText] = out;
  assert.ok(satSlot);
  const i = satText.indexOf("THE WEEK IN REVIEW"), j = satText.indexOf("Your bid at Fixture Test Co-op");
  assert.ok(i >= 0 && j > i, "the line sits in The week in review");
  assert.ok(satText.slice(j).includes(NOTE), "the note follows the lines");
  assert.ok(satHtml.includes("Your bid at Fixture Test Co-op") && satHtml.includes("Not a contract. Call before you haul."));
  assert.ok(!sunSlot && !sunText.includes("Your bid at"), "Sunday's block is the week ahead: no bid line");
  assert.ok(!wkdText.includes("Your bid at"), "a weekday issue has no line");
});

test("size: the fri slot adds at most one entry per key, not KEEP_DAYS more", () => {
  const r = run("size");
  assert.equal(r.max_entries_per_key, r.keep_days + 1);
  assert.equal(r.slots, r.keys);
  assert.ok(r.with <= r.without * 1.35, `a full slot costs ${Math.round((r.with / r.without - 1) * 100)}%, budget 35%`);
});

test("data/bids-prev: under its 2 MB budget, and any fri slot is one Friday whose keys are all in rows", () => {
  // Budget (fx/bid-week, Nov 7 2026): 1.10 MB before the slot; a slot on every key measured +16% on that
  // day's files (only keys seen on the Friday get one). Every state file is rewritten on each bids push,
  // so this folder's size is git churn as well as page weight. Raising it is a decision, said here.
  const dir = join(ROOT, "data/bids-prev");
  let total = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    total += statSync(join(dir, f)).size;
    const d = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (!d.fri) continue;
    const days = new Set(Object.values(d.fri).map((e) => e[0]));
    assert.ok(days.size <= 1, `${f}: fri slots on ${[...days].join(", ")}`);
    for (const day of days) assert.equal(new Date(day + "T12:00:00Z").getUTCDay(), 5, `${f}: fri slot ${day} is not a Friday`);
    for (const k of Object.keys(d.fri)) assert.ok(d.rows[k], `${f}: fri key ${k} has no rows`);
  }
  assert.ok(total < 2_000_000, `data/bids-prev is ${total} bytes`);
});

test("the builder keeps the slot out of rows, and its readers are unchanged", () => {
  const src = readFileSync(join(ROOT, "scripts/build_bids_prev.py"), "utf8");
  assert.match(src, /KEEP_DAYS = 4\b/, "rows still keep 4 days");
  assert.match(src, /doc\["fri"\] = /);
  const wk = readFileSync(join(ROOT, "scripts/daily_weekend.py"), "utf8");
  assert.ok(!/import\s+(local_bid|send_daily)\b/.test(wk), "daily_weekend stays pure: the board comes in from send_daily");
});
