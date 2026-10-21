/* The critic email stays quiet on a passing issue (Sig, Oct 20, 2026).
 *
 * Issue #221 averaged 7.2 (threshold 7) with seven rules under 7 and one
 * rewrite, and Sig got "AGSIST critic flagged 7 rule(s)" anyway, as on most
 * mornings. Now it mails only when the issue is weak: an average under the
 * threshold, or one rule at 3 or below. A missing daily.json or critic pass
 * still mails (main() checks those before should_alert).
 *
 *   node --test test/notify-critic-quiet.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const ask = (scores, t = 7) => execFileSync("python3", ["-c",
  "import sys,json; sys.path.insert(0,'scripts'); import notify_critic_status as n; print(n.should_alert(json.loads(sys.argv[1]), float(sys.argv[2])))",
  JSON.stringify(scores), String(t)], { encoding: "utf8" }).trim();

test("issue #221 (avg 7.2, seven rules under 7, none at 3) is quiet", () => {
  const s = { r10: 4, r11: 10, r12: 4, r13: 5, r14: 9, r15: 10, r16: 4, r1: 5, r2: 9, r3: 7, r4: 6, r5: 6, r6: 9, r7: 10, r8: 9, r9: 10, r17: 10, r18: 9 };
  assert.equal(ask(s), "False");
});
test("an average under the threshold mails", () => assert.equal(ask({ a: 6, b: 7, c: 6 }), "True"));
test("one rule at 3 mails even with a good average", () => assert.equal(ask({ a: 10, b: 10, c: 10, d: 3 }), "True"));
test("no numeric scores mails", () => assert.equal(ask({ a: "x" }), "True"));
test("the step still runs in daily.yml", async () => {
  const fs = await import("node:fs");
  assert.match(fs.readFileSync(".github/workflows/daily.yml", "utf8"), /run: python scripts\/notify_critic_status\.py/);
});
