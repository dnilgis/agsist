// What's Priced In, between reports (2026-10-15 head to head): the last
// result was folded into the track record after its five-day banner, so the
// first screen answered nothing for three weeks; the track record said "No note
// written on how the market took it" on rows whose settles were on file; and
// the November card said no COT file could be read while data/cot.json was there.
//
// lastLine() in the page and last_line() in the prerender are run on the same
// record and compared byte for byte, as wpi-numbers-strip.test.mjs does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = readFileSync(join(ROOT, "whats-priced-in.html"), "utf8");
const UTIL_SRC = readFileSync(join(ROOT, "components/util.js"), "utf8");

function lift(name) {
  const start = PAGE.indexOf("function " + name + "(");
  assert.notEqual(start, -1, name + "() is no longer in the page");
  let depth = 0;
  for (let p = PAGE.indexOf("{", start); p < PAGE.length; p++) {
    if (PAGE[p] === "{") depth++;
    else if (PAGE[p] === "}" && --depth === 0) return PAGE.slice(start, p + 1);
  }
  throw new Error("unbalanced " + name);
}

const jsLine = new Function("lr", `
  const window = {};
  ${UTIL_SRC}
  const esc = window.esc;
  function num(n,u){return (n==null)?'-':(n+(u?(' '+u):''));}
  var MON3=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  ${lift("lastLine")}
  return lastLine(lr);
`);

function pyLine(lr) {
  return execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, "scripts")
import prerender_wpi_scorecard as m
sys.stdout.write(m.last_line(json.load(sys.stdin)))
`], { cwd: ROOT, input: JSON.stringify(lr), encoding: "utf8" });
}

const OCT = {
  date: "2026-10-09", report: "October WASDE", metric_count: 7, in_line_count: 3,
  all_in_line: false,
  biggest_surprise: {
    metric: "2026/27 corn ending stocks", actual: 1.849, expected: 1.677, unit: "bil bu",
    gap_pct: 10.3, surprise: "bearish", reaction_from: "settles",
    reaction: "Dec '26 corn settled 20½¢ lower that day, $5.00¼ to $4.79¾ (CBOT daily settles as Yahoo Finance reports them).",
  },
};

test("the last result reads the same baked and live", () => {
  const js = jsLine(OCT);
  assert.equal(pyLine(OCT), js);
  assert.equal(js, '<div class="wp-last"><b>Last report, the October WASDE (Oct 9):</b> 3 of 7 graded '
    + 'figures landed in line. Biggest miss, 2026/27 corn ending stocks: 1.849 bil bu vs 1.677 bil bu '
    + "expected (+10.3%, bearish). Dec '26 corn settled 20½¢ lower that day, $5.00¼ to $4.79¾ "
    + '(CBOT daily settles as Yahoo Finance reports them). <a href="#track-record">Every figure</a></div>');
  for (const lr of [{ ...OCT, all_in_line: true, in_line_count: 7 },
                    { ...OCT, metric_count: 0 },
                    { ...OCT, biggest_surprise: { ...OCT.biggest_surprise, reaction_from: "typed",
                                                  metric: 'a "quoted" & <odd> one', expected: 800.0 } }]) {
    assert.equal(pyLine(lr), jsLine(lr));
  }
});

test("between reports the result sits above the page's jump links, baked from today's data", () => {
  const r = PAGE.indexOf('<div id="wp-result">'), j = PAGE.indexOf('<nav class="wp-jump"');
  assert.ok(r > 0 && r < j, "result block comes before the jump links");
  const d = JSON.parse(readFileSync(join(ROOT, "data/whats-priced-in.json"), "utf8"));
  const lr = d.latest_result;
  const age = Math.round((new Date(new Date().toISOString().slice(0, 10)) - new Date(lr.date)) / 864e5);
  if (age > 5 && age <= 45) assert.ok(PAGE.includes(pyLine(lr)), "the baked page carries the line");
});

test("the October rows carry the settle move from data on file, and the COT line fills", () => {
  const d = JSON.parse(readFileSync(join(ROOT, "data/whats-priced-in.json"), "utf8"));
  const oct = d.history.filter((r) => r.date === "2026-10-09");
  const corn = oct.find((r) => r.metric === "2026/27 corn ending stocks");
  assert.equal(corn.reaction, "Dec '26 corn settled 20½¢ lower that day, $5.00¼ to $4.79¾ (CBOT daily settles as Yahoo Finance reports them).");
  assert.equal(corn.reaction_from, "settles");
  const wheat = oct.find((r) => r.metric === "2026/27 wheat ending stocks");
  // no wheat settles on file: the wheat note is typed from DTN's dated review, sourced, and says it is unchecked
  assert.equal(wheat.reaction_from, "typed");
  assert.match(wheat.reaction, /Dec KC wheat finished 17¢ lower at \$7\.19¼/);
  assert.match(wheat.reaction, /Oct 9, 2026/);
  assert.match(wheat.reaction, /no wheat settles to check/);
  assert.match(wheat.reaction_source || "", /dtnpf\.com.*2026\/10\/09/);
  if (d.upcoming && /WASDE/.test(d.upcoming.report)) {
    assert.match(d.upcoming.positioning || "", /^Managed money: Corn net/);
    assert.ok(!(d.upcoming.withheld || {}).positioning);
  }
});

test("build_whats_priced_in selftest passes", () => {
  const out = execFileSync("python3", ["scripts/build_whats_priced_in.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /selftest ok/);
});
