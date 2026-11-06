// Nov 6: a push to main that changes engine paths checks the engine out again once engine-sync has had time, when
// the first checkout predates the push (.github/actions/engine/engine.sh behind). Runs the shipped script with a fake
// event and a throwaway engine clone; no key is involved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SH = join(ROOT, ".github/actions/engine/engine.sh");
const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "engwait-"));
const eng = join(dir, "engine");
function engineAt(date) {
  execFileSync("rm", ["-rf", eng]); execFileSync("git", ["init", "-q", eng]);
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date };
  execFileSync("git", ["-C", eng, "commit", "-q", "--allow-empty", "-m", "sync"], { env });
}
function run(name, event, wait = "0") {
  const ev = join(dir, "event.json"); writeFileSync(ev, JSON.stringify(event));
  const out = join(dir, "out"); writeFileSync(out, "");
  const log = execFileSync("bash", [SH, "behind", eng], { cwd: ROOT, encoding: "utf8",
    env: { ...process.env, GITHUB_EVENT_NAME: name, GITHUB_EVENT_PATH: ev, GITHUB_OUTPUT: out, WAIT_SECONDS: wait } });
  return { log, retry: /retry=true/.test(readFileSync(out, "utf8")) };
}
const pushed = "2026-11-06T14:41:20Z";
const code = { head_commit: { timestamp: pushed }, commits: [{ added: [], modified: ["scripts/sponsor-checks.mjs"], removed: [] }] };
const data = { head_commit: { timestamp: pushed }, commits: [{ added: [], modified: ["data/prices.json"], removed: [] }] };

test("an engine copy older than a push that changed engine paths asks for a second checkout", () => {
  engineAt("2026-11-06T14:00:00Z");
  const r = run("push", code);
  assert.equal(r.retry, true); assert.match(r.log, /predates this push/);
});

test("no second checkout when the engine is newer, the push changed no engine path, or it is not a push", () => {
  engineAt("2026-11-06T14:42:23Z");
  assert.equal(run("push", code).retry, false);
  engineAt("2026-11-06T14:00:00Z");
  assert.equal(run("push", data).retry, false);
  assert.equal(run("pull_request", code).retry, false);
});

test("the action: behind holds no key and runs after the checkout; the second checkout is pinned and leaves no key", () => {
  const a = readFileSync(join(ROOT, ".github/actions/engine/action.yml"), "utf8");
  const steps = Object.fromEntries(a.split(/\n(?=    - id: )/).slice(1).map((x) => [x.match(/- id: (\w+)/)[1], x]));
  assert.doesNotMatch(steps.behind, /inputs\.token/);
  assert.match(steps.behind, /github\.event_name == 'push' && github\.ref_name == 'main'/);
  assert.match(steps.recheckout, /uses: actions\/checkout@[0-9a-f]{40}/);
  assert.match(steps.recheckout, /persist-credentials: false/);
  assert.match(steps.recheckout, /path: \.engine-src/);
});
