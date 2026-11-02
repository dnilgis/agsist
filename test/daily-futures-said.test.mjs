/* When the move is futures, say futures (outside review, Oct 29, 2026). The Oct 29 Daily, as it went
 * out: headline "Hogs fall 5.5% to $58.60 while corn holds $4.51", teaser "Hogs drop 5.5% to $58.60
 * ...", and in the lead "Every hog sold this week brought less than it would have Tuesday." under a
 * lean hog futures drop. scripts/daily_claims.py now flags all three (the lead line by
 * cash-from-futures, the headline and teaser by futures-unnamed); the prompt states the rule; the gate
 * WARNs on both, as on every wording rule, so no send is held by a prose heuristic.
 *   node --test test/daily-futures-said.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const py = (code) => execFileSync("python3", ["-c", `import sys, json; sys.path.insert(0, "scripts")\n` + code], { cwd: ROOT, encoding: "utf8" }).trim();

const OCT29 = {
  date: "2026-10-29",
  headline: "Hogs fall 5.5% to $58.60 while corn holds $4.51",
  teaser: "Hogs drop 5.5% to $58.60 while corn holds near $4.51 and beans slip 7¾ cents.",
  lead: "Lean hogs settled Wednesday at $58.60, down 5.5% and the biggest drop on the board, only 1% off their 52-week low. Every hog sold this week brought less than it would have Tuesday.",
};

test("the Oct 29 lines as they went out are flagged, and only those", () => {
  const out = JSON.parse(py(`
import daily_claims as dc
from datetime import date
b = json.loads(${JSON.stringify(JSON.stringify(OCT29))})
print(json.dumps(sorted([r, l] for r, l, _ in dc.lint(b, dc.context({}, date(2026, 10, 29))))))
`));
  assert.deepEqual(out, [["cash-from-futures", "lead"], ["futures-unnamed", "headline"], ["futures-unnamed", "teaser"]]);
});

test("the corrected lines pass", () => {
  const fixed = {
    headline: "Hog futures fall 5.5% to $58.60 while corn holds $4.51",
    teaser: "December hogs drop 5.5% to $58.60 while corn futures hold near $4.51 and beans slip 7¾ cents.",
    lead: "Lean hog futures settled Wednesday at $58.60, down 5.5%. What hogs sold this week brought depends on the cash trade and your contract.",
  };
  const out = py(`
import daily_claims as dc
from datetime import date
print(len(dc.lint(json.loads(${JSON.stringify(JSON.stringify(fixed))}), dc.context({}, date(2026, 10, 29)))))
`);
  assert.equal(out, "0");
});

test("the prompt states it, headline_fix knows its words, and the gate warns rather than holds", () => {
  const out = py(`
import daily_claims as dc, headline_fix as hf
print("futures-unnamed" in hf.RULE_TEXT and "Hog futures fall 5.5% to $58.60" in hf.RULE_TEXT["futures-unnamed"])
print("futures-unnamed" not in dc.BLOCKING and "cash-from-futures" not in dc.BLOCKING)
print("a hog or steer sold" in dc.PROMPT_RULES)
`);
  assert.equal(out, "True\nTrue\nTrue");
});
