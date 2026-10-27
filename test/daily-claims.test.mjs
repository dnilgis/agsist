/* The five worst Daily lines of Oct 11-25 2026 (outside review, Oct 25) and the
 * guards written from them (scripts/daily_claims.py).
 *   - each corrected issue: the old line is gone from the body, kept word for
 *     word in a dated correction note, in the archive JSON and the published page;
 *   - the guards: their selftest (the real lines fail, the corrected ones pass),
 *     the corrected issues pass them, and the generator, the critic and the gate
 *     all run them.
 *   node --test test/daily-claims.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const py = (args) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8" });

const FIXED = [
  ["2026-10-16", "Hogs sat flat at $75.55, no fresh news to move them either way."],
  ["2026-10-11", "Every bushel of old-crop corn sitting in the bin is worth about 19 cents less than it was Thursday."],
  ["2026-10-18", "Cash cattle firm above Friday's (Oct 23) $227.55 close supports the rally; steady or lower fades it."],
  ["2026-10-22", "the first higher close after a streak of lower ones."],
  ["2026-10-25", "Diesel and fertilizer costs follow crude, so higher oil matters for next season's input bills."],
  ["2026-10-25", "favors beans when acres are planned for next spring."],
  // the next three, found by running the guards over the whole archive (Oct 27)
  ["2026-10-10", "Every bushel still in the bin is worth less than it was Thursday morning."],
  ["2026-10-15", "Hogs are nearly flat at $75.55, just below Wednesday's $75.60."],
  ["2026-10-15", "The pullback follows word that the administration may ease sanctions on tankers moving Russian, Iranian and Venezuelan oil, adding supply to a tight tanker market."],
  ["2026-10-26", "A bushel of beans is worth about 16 cents less than it was at Friday's close."],
  ["2026-10-21", "Corn closed Tuesday at $4.59½, its sixth lower close in a row, and soybeans at $12.45 made it seven."],
  ["2026-10-21", "A corn bushel is worth about 15 cents less than a week ago."],
  // the Oct 21 headline (and email subject): the 5:46 a.m. trades counted as the end of a run of lower settles
  ["2026-10-21", "Corn down 6 straight days to $4.59½; beans down 7 to $12.45"],
];
const esc = (s) => s.replace(/"/g, "&quot;");

for (const [d, old] of FIXED) {
  test(`Daily ${d}: "${old.slice(0, 40)}..." corrected in place, with a dated note`, () => {
    const j = JSON.parse(read(`data/daily-archive/${d}.json`));
    const { corrections, ...body } = j;
    assert.ok(!JSON.stringify(body).includes(old), "old line still in the body");
    const note = (corrections || []).find((c) => c.date === "2026-10-27" && c.text.includes(old));
    assert.ok(note, "no Oct 27 correction quoting the old line");
    assert.ok(!/—/.test(note.text), "em dash in the note");
    const html = read(`daily/${d}.html`);
    const at = html.indexOf('<aside class="dv3-corrections"');
    assert.ok(at > 0, "page has no corrections block");
    assert.ok(!html.slice(0, at).includes(old) && !html.slice(0, at).includes(esc(old)), "old line still on the page");
    assert.ok(html.includes("Correction, Oct 27, 2026:</strong> " + esc(note.text).slice(0, 60)), "note not on the page");
    assert.ok(html.slice(0, at).includes("(Corrected Oct 27, see the note below.)"), "no marker at the corrected line");
  });
}

test("claim guards: selftest from the real lines", () => {
  assert.match(py(["scripts/daily_claims.py", "--selftest"]), /daily_claims selftest: ok/);
});

test("claim guards: the corrected issues pass them", () => {
  const out = py(["-c", `
import json, sys
sys.path.insert(0, "scripts")
import daily_claims as dc
from datetime import date
bad = []
for d in ("2026-10-10", "2026-10-11", "2026-10-15", "2026-10-16", "2026-10-18", "2026-10-21", "2026-10-22", "2026-10-25", "2026-10-26"):
    b = json.load(open(f"data/daily-archive/{d}.json"))
    ctx = dc.context({"planting_ratio": {"crop_year": 2027, "value": 2.47}}, dc.issue_date(b), b.get("quote_strip"))
    bad += [(d,) + h for h in dc.lint(b, ctx)]
print(len(bad), bad)
`]);
  assert.match(out, /^0 /, out);
});

test("Oct 15 hogs: the old line fails and the corrected one passes, against prices.json as the issue read it", () => {
  // data/prices.json at git c168ae6c570 (2026-10-15 10:46 UTC): HEV26 75.55 and HEZ26 66.075, both the Oct 14 settles
  const out = py(["-c", `
import json, sys
sys.path.insert(0, "scripts")
import daily_claims as dc
from datetime import date
prices = {"quotes": {
    "hogs": {"ticker": "HE=F", "close": 75.55, "close_date": "2026-10-14"},
    "hogs-oct26": {"ticker": "HEV26.CME", "close": 75.55, "close_date": "2026-10-14"},
    "hogs-dec26": {"ticker": "HEZ26.CME", "close": 66.075, "close_date": "2026-10-14"}}}
b = json.load(open("data/daily-archive/2026-10-15.json"))
ctx = dc.context(prices, date(2026, 10, 15), b.get("quote_strip"))
old = {"sections": [{"body": "- Hogs are nearly flat at $75.55, just below Wednesday's $75.60."}]}
print([r for r, _, _ in dc.lint(old, ctx)], [r for r, _, _ in dc.lint(b, ctx)])
`]);
  assert.match(out, /^\['expired-contract'\] \[\]/, out);
});

test("claim guards run in the prompt, the generator's cut, the critic and the gate", () => {
  const g = read("scripts/generate_daily.py"), c = read("scripts/critique_briefing.py"), gate = read("scripts/briefing_gate.py");
  assert.ok(g.includes("{CLAIM_RULES_LOCAL}") && g.includes("_dc.PROMPT_RULES"), "prompt rules not in the system prompt");
  assert.ok(g.includes("_dc.strip(briefing"), "generator does not cut");
  assert.ok(g.includes("PLANTING RATIO"), "the model is not handed next year's ratio");
  assert.ok(c.includes("daily_claims.strip(briefing"), "critic does not cut after a rewrite");
  assert.ok(gate.includes("daily_claims.lint(daily"), "gate does not check");
  assert.ok(read(".github/workflows/daily.yml").includes("python scripts/daily_claims.py --selftest"), "daily run skips the selftest");
  const out = py(["-c", `
import sys; sys.path.insert(0, "scripts")
import generate_daily as g
p = g.build_system_prompt({"is_closed": False, "reason": "", "day_name": "Tuesday", "note": ""}, [], None, None, "", "", [], [], "")
print("CLAIM LIMITS" in p and "Never attach a close" in p)
`]);
  assert.match(out, /True/);
});

test("gate blocks the Oct 18 and Oct 22 lines as they went out", () => {
  const out = py(["-c", `
import sys, datetime as dt; sys.path.insert(0, "scripts")
import briefing_gate as bg
b18 = {"date": "Sunday, October 18, 2026", "watch_list": [{"time": "Next week's cash trade",
       "desc": "Cash cattle firm above Friday's (Oct 23) $227.55 close supports the rally; steady or lower fades it."}]}
b22 = {"date": "Thursday, October 22, 2026", "sections": [{"title": "Corn", "body": "- Dec corn is at **$4.64** overnight, up \\u00be cent, the first higher close after a streak of lower ones."}],
       "quote_strip": {"quotes": [{"key": "corn-dec", "last": 4.64, "prev": 4.6325, "kind": "last"}]}}
for b in (b18, b22):
    ok, iss = bg.run(b, None, today=dt.date(2026, 10, 27), archive_dir=None)
    print([c for s, c, m in iss if s == "FAIL" and c.startswith("claim:")])
`]);
  assert.match(out, /\['claim:future-as-past'\]\n\['claim:close-before-settle'\]/, out);
});

test("rebuild_archive_html --text-only selftest", () => {
  assert.match(py(["scripts/rebuild_archive_html.py", "--selftest"]), /selftest: ok/);
});

test("gate flags the Oct 21 headline as it went out, and not the corrected one", () => {
  // the issue's own strip: 5:46 a.m. CT trades, Oct 20 settles as prev. A headline cannot be
  // cut; since Oct 27 the gate FAILS it (scripts/headline_fix.py rewrites it before the gate).
  const out = py(["-c", `
import json, sys, datetime as dt; sys.path.insert(0, "scripts")
import briefing_gate as bg
b = json.load(open("data/daily-archive/2026-10-21.json"))
old = {"date": b["date"], "headline": "Corn down 6 straight days to $4.59\\u00bd; beans down 7 to $12.45", "quote_strip": b["quote_strip"]}
new = {"date": b["date"], "headline": b["headline"], "quote_strip": b["quote_strip"]}
for x in (old, new):
    ok, iss = bg.run(x, None, today=dt.date(2026, 10, 27), archive_dir=None)
    print([s + " " + c for s, c, m in iss if c.startswith("claim:") and m.startswith("headline")])
`]);
  assert.match(out, /\['FAIL claim:close-before-settle'\]\n\[\]/, out);
});

test("every archived issue passes the cause rule (Oct 27, option C: 73 older lines reworded in place)", () => {
  // Reader-facing fields of every data/daily-archive/<date>.json, plus the headline and teaser
  // copies in index.json (archive lists, feed). Dated correction notes quote old wording and are
  // not read. A new hit means a line states a market cause with no one named as saying so.
  const out = py(["-c", `
import glob, json, os, re, sys
sys.path.insert(0, "scripts")
import daily_claims as dc
bad = []
n = 0
for f in sorted(glob.glob("data/daily-archive/2*.json")):
    b = json.load(open(f))
    n += 1
    for loc, text in dc.fields(b):
        for line in text.split("\\n"):
            for s in dc.sentences(re.sub(r"^\\s*-\\s+", "", line)):
                if dc.r_cause_without_source(s.replace("**", ""), {}):
                    bad.append((os.path.basename(f), loc, s))
for e in json.load(open("data/daily-archive/index.json"))["briefings"]:
    for k in ("headline", "teaser"):
        for s in dc.sentences(e.get(k) or ""):
            if dc.r_cause_without_source(s.replace("**", ""), {}):
                bad.append(("index.json", e["date"] + "." + k, s))
print(n, len(bad), bad[:10])
`]);
  const [n, hits] = out.trim().split(" ").map(Number);
  assert.ok(n > 200, "archive not read: " + out);
  assert.equal(hits, 0, out);
});

test("reworded cause lines: the old wording is gone from the page and the new is there", () => {
  // three of the 73 (private before/after log has the rest)
  const cases = [
    ["2026-09-09", "Brent hits $100; grains and cattle follow", "Brent hits $100; grains and cattle higher too"],
    ["2026-10-13", "Both markets are flat because USDA", "Both markets are flat with USDA&#x27;s record crop numbers already out."],
    ["2026-07-04", "a 4% session move driven by fund liquidation", "a 4% session move ahead of the July 4 holiday"],
  ];
  for (const [d, old, now] of cases) {
    const html = read(`daily/${d}.html`);
    assert.ok(!html.includes(old), `${d}: old wording still on the page`);
    assert.ok(html.includes(now) || html.includes(now.replace("&#x27;", "'")) || html.includes(now.replace("&#x27;", "&#39;")), `${d}: new wording missing`);
  }
});
