// Fresh every morning (Nov 1 2026): never the same headline, number, story
// or fact twice in a row, 3 to 5 top stories with their links, weekends that do
// not rerun Friday. scripts/test_daily_fresh.py replays the 14 real issues Oct 19
// to Nov 1 and pins the gate, the story links, the feeds and the prompt; this
// file runs it with the selftests of the modules it touches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const py = (args) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", timeout: 300000 });

test("the replay, the gate, story links, feeds and prompt (scripts/test_daily_fresh.py)", () => {
  const out = py(["scripts/test_daily_fresh.py"]);
  assert.match(out, /test_daily_fresh: 0 failure\(s\)/, out.slice(-3000));
});

for (const s of ["daily_fresh", "briefing_cut"]) {
  test(`${s} selftest`, () => {
    assert.match(py([`scripts/${s}.py`, "--selftest"]), /selftest: (ok|0 failure)/);
  });
}

test("the replay names what would have gone back, Oct 19 to Nov 1", () => {
  const out = py(["scripts/daily_fresh.py", "--replay"]);
  assert.match(out, /5 of the issues would have been sent back for a hard repeat/);
  assert.match(out, /2026-11-01 Sun  sent back[\s\S]*?\[headline\][\s\S]*?100% the same words/);
  assert.match(out, /2026-10-29 Thu  sent back[\s\S]*?\[number\] one_number\.value: \$2\.4 billion/);
});

test("the generator runs the check, sends the draft back once and stamps the issue", () => {
  const g = readFileSync(join(ROOT, "scripts/generate_daily.py"), "utf8");
  const main = g.slice(g.indexOf("def main():"));
  const heal = main.indexOf("FRESHNESS self-heal");
  assert.ok(heal > main.indexOf("VOICE self-heal"), "after the voice self-heal");
  assert.ok(heal < main.indexOf("briefing_cut.enforce_budget(briefing)"), "before the cut");
  assert.match(main, /_dfr\.correction\(_fresh_found\)/);
  assert.match(main, /briefing\["freshness"\] = _dfr\.stamp/);
  // Nov 2. cut_repeats cuts the stories (drop_stories), sentences and the
  // day's number that still repeat after the one rewrite, and swaps a repeated headline for the top story.
  assert.match(main, /_dfr\.cut_repeats\(briefing, _fresh_found,/);
  assert.match(main, /attach_story_links\(briefing\)/);
  assert.equal((main.match(/usda_release=\(usda_release or ""\) \+ "\\n\\n" \+ _dfr\.correction/g) || []).length, 1, "one rewrite, not a loop");
});
