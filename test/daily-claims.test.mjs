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
for d in ("2026-10-11", "2026-10-16", "2026-10-18", "2026-10-22", "2026-10-25"):
    b = json.load(open(f"data/daily-archive/{d}.json"))
    ctx = dc.context({"planting_ratio": {"crop_year": 2027, "value": 2.47}}, dc.issue_date(b), b.get("quote_strip"))
    bad += [(d,) + h for h in dc.lint(b, ctx)]
print(len(bad), bad)
`]);
  assert.match(out, /^0 /, out);
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
