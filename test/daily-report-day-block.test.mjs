/* Nov 11, 2026, the morning after the Nov 10 WASDE: the writer stated Tuesday's report-day moves
   from memory or from a last trade ("barely moved", "settled up 43½ at $12.25¾", "Friday's (Nov 6)
   report-day gain"). scripts/report_day_settles.py hands it Tuesday's settles as their own block,
   built from prices.json settles only; the generator puts it in the writer's message (which the
   fact check reads), and briefing_gate checks a figure that names the report day against it.
   Frozen fixture: prices.json's shape at 13:01 UTC Nov 11 (corn Dec 439.25 -> 449.0, Nov beans
   1182.25 -> 1224.5); the issue date is passed in, never read from the clock. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = path.join(ROOT, "scripts");

function py(code) {
  return JSON.parse(execFileSync("python3", ["-I", "-c",
    `import sys, json\nsys.path.insert(0, ${JSON.stringify(SCRIPTS)})\n` + code],
    { cwd: ROOT, encoding: "utf8" }).trim().split("\n").pop());
}

const FIXTURE = `
from datetime import date
import report_day_settles as rds
prices = rds._fixture()
`;

test("the block names Tuesday, Nov 10 and gives each contract's settle and change", () => {
  const t = py(FIXTURE + `print(json.dumps(rds.text(rds.build(prices, date(2026, 11, 11), None))))`);
  assert.match(t, /^YESTERDAY WAS REPORT DAY \(HARD RULE\): Tuesday, Nov 10, 2026, WASDE/);
  assert.match(t, /Corn Dec '26: settled \$4\.49 up 9¾¢ \(\+2\.2%\) from Monday's \$4\.39¼/);
  assert.match(t, /Soybeans Nov '26: settled \$12\.24½ up 42¼¢ \(\+3\.6%\) from Monday's \$11\.82¼/);
  assert.match(t, /Soybeans Jan '27: settled \$12\.28 up 39¾¢/);
  assert.match(t, /Wheat Dec '26: settled \$5\.92¾ up 4¾¢/);
  assert.match(t, /Put the report-day move and today's move in separate sentences\./);
  assert.doesNotMatch(t, /Nov 17|Friday/);
});

test("a settle not on file yet says so and carries no move; a last trade is never used", () => {
  const t = py(FIXTURE + `
q = prices["quotes"]["beans-nov"]
q["settles"].pop("2026-11-10")
q.update(close=1225.75, close_kind="last", netChange=43.5, day_last={"2026-11-10": {"px": 1225.75}})
print(json.dumps(rds.text(rds.build(prices, date(2026, 11, 11), None))))`);
  assert.match(t, /Soybeans Nov '26: settle not in yet; state no move for it/);
  assert.doesNotMatch(t, /12\.25|43/);
});

test("no block the morning after an ordinary day", () => {
  const t = py(FIXTURE + `print(json.dumps(rds.text(rds.build(prices, date(2026, 11, 13), None))))`);
  assert.equal(t, "");
});

test("the writer's message carries the block (and so the saved inputs the fact check reads)", () => {
  const t = py(`
import tempfile, os
import generate_daily as g
import report_day_settles as rds
from datetime import date
d = tempfile.mkdtemp()
p = os.path.join(d, "prices.json")
json.dump(rds._fixture(), open(p, "w"))
print(json.dumps(g.report_day_block(date(2026, 11, 11), p)))`);
  assert.match(t, /Corn Dec '26: settled \$4\.49 up 9¾¢/);
  const src = execFileSync("grep", ["-c", "_rd = report_day_block(now.date())", path.join(SCRIPTS, "generate_daily.py")], { encoding: "utf8" });
  assert.equal(src.trim(), "1");
});

const verdict = (sentence) => py(FIXTURE + `
import tempfile
import briefing_gate as G
cur = {"date": "2026-11-11", "generated_at": "2026-11-11T12:40:00+00:00", "headline": "h", "lead": "l",
       "locked_prices": {"corn": 4.465, "beans": 12.195},
       "locked_changes": {"corn": {"prev": 4.49, "pct": -0.557}, "beans": {"prev": 12.245, "pct": -0.408}},
       "sections": [{"title": "Grains", "body": ${JSON.stringify(sentence)}, "bottom_line": ""}]}
issues = []
G.check_number_binding(cur, lambda c, m: issues.append(("FAIL", c, m)), lambda c, m: issues.append(("WARN", c, m)),
                       archive_dir=tempfile.mkdtemp(), prices=prices)
print(json.dumps([i[0] + " " + i[1] for i in issues if i[1].startswith("bind:cents") or i[1].startswith("bind:pct")]))`);

test("gate: the report-day settle move, named as Tuesday's, with its contract month, passes", () => {
  for (const line of [
    "Dec corn settled Tuesday up 9¾ cents at $4.49.",
    "Jan soybeans settled Tuesday up 39¾ cents.",
    "Nov soybeans settled up 42¼ cents on Tuesday.",
    "Soybeans jumped 42¼ cents Tuesday.",
  ]) assert.deepEqual(verdict(line), [], line);
});

/* Checker lines (board: corn -2.5¢ today, beans -5¢; report day corn +9.75, Nov beans +42.25,
   Jan +39.75, wheat +4.75). Each must still be flagged by the gate. */
const MUST_FAIL = [
  "Corn is up 9¾ cents this morning, after Tuesday's report.",
  "Corn is up 9¾ cents overnight following Tuesday's WASDE.",
  "Corn fell 9¾ cents Tuesday.",
  "Corn lost 2.2% on Tuesday.",
  "Jan soybeans settled Tuesday up 42¼ cents.",
  "Nov soybeans settled Tuesday up 39¾ cents.",
  "March corn settled Tuesday up 9¾ cents.",
  "Corn could move 9¾ cents on next Tuesday's report.",
  "Corn may drop 9¾ cents by Tuesday, Nov 17.",
  "Corn is up 9¾ cents today in a typical post report-day bounce.",
  "Nov soybeans rose 40¼ cents Tuesday.",
  "Nov soybeans rose 42¾ cents",
  "Corn rose 10¼ cents Tuesday.",
  "Corn is up 9¾ cents.",
  "Soybeans settled Tuesday up 43½ cents at $12.25¾.",
  // second round: no month named binds to the board's own contract (Nov beans), not Jan
  "Soybeans jumped 39¾ cents Tuesday.",
  // today's move phrasings
  "Corn trades 9¾ cents higher after Tuesday's report.",
  "Corn opened 9¾ cents higher after Tuesday's report.",
  // numeric dates are other dates
  "Corn rose 9¾ cents on 11/17, a Tuesday.",
  "december corn settled up 9¾ cents Tuesday, 11/17.",
  // another weekday or a span
  "Corn rose 9¾ cents the Tuesday before last.",
  "Corn rose 9¾ cents Tuesday and Wednesday combined.",
  // negation
  "Corn did not gain 9¾ cents Tuesday.",
  "Corn failed to hold a 9¾ cent gain Tuesday.",
];

test("gate: every line that is not plainly the report day's settle move is still flagged", () => {
  for (const line of MUST_FAIL) {
    const got = verdict(line);
    assert.ok(got.length > 0, `not flagged: ${line}`);
    if (/cents/.test(line)) assert.ok(got.some((x) => x.startsWith("FAIL bind:cents")), `cents not blocking: ${line} ${got}`);
  }
});

test("the report-day match itself refuses each checker line", () => {
  const got = py(FIXTURE + `
b = rds.build(prices, date(2026, 11, 11), None)
import briefing_gate as G
lines = ${JSON.stringify(MUST_FAIL)}
out = []
for s in lines:
    key = "beans" if "oybean" in s else "corn"
    vals = [v for v, _ in G._cent_claims(s)] + [float(m.group(1)) for m in G.PCT.finditer(s)]
    kinds = ["cents"] * len(G._cent_claims(s)) + ["pct"] * len(list(G.PCT.finditer(s)))
    out.append([s for v, k in zip(vals, kinds) if rds.matches(s, key, v, b, k)])
print(json.dumps([x for x in out if x]))`);
  assert.deepEqual(got, []);
});
