// One table of Claude models (Nov 10, 2026): scripts/claude_models.py names the model for every job, its prices
// and its thinking word. No other script or workflow assigns a model id, so moving a job to a newer model is one
// line, and a price, a thinking word or a cost line can never disagree with the model a job really calls.
// The guard reads the source of every file that calls the API, and every workflow, for a model id assigned as a
// default (MODEL = "claude-...", "model": "claude-...", vars.X || 'claude-...'). A model named inside a test's
// assertion is fine: it checks the registry, it does not choose a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");

const ASSIGN = [
  /^\s*[A-Z_]*MODEL[A-Z_]*\s*=\s*(os\.environ\.get\([^)]*\)\s*(\.strip\(\))?\s*or\s*)?["']claude-/m,
  /["']model["']\s*:\s*["']claude-/,
  /\|\|\s*['"]claude-/,
];

function offenders(path) {
  const out = [];
  read(path).split("\n").forEach((line, i) => {
    if (/^\s*(#|\/\/)/.test(line)) return;
    for (const re of ASSIGN) if (re.test(line)) out.push(`${path}:${i + 1}: ${line.trim()}`);
  });
  return out;
}

test("every Claude job takes its model from scripts/claude_models.py", () => {
  const callers = readdirSync(ROOT + "scripts").filter((f) => f.endsWith(".py") && f !== "claude_models.py" && !f.startsWith("test_"))
    .map((f) => "scripts/" + f).filter((p) => /anthropic|claude_models/.test(read(p)));
  for (const need of ["scripts/generate_daily.py", "scripts/critique_briefing.py", "scripts/fact_check_briefing.py",
                      "scripts/atlas_reads.py", "scripts/api_jobs.py", "scripts/accuracy_pass.py"]) {
    assert.ok(callers.includes(need), `${need} is read by this guard`);
    assert.match(read(need), /import claude_models/, `${need} imports the registry`);
  }
  const wfs = readdirSync(ROOT + ".github/workflows").filter((f) => /\.ya?ml$/.test(f)).map((f) => ".github/workflows/" + f);
  const bad = [...callers, ...wfs].flatMap(offenders);
  assert.deepEqual(bad, [], "a model id is chosen outside scripts/claude_models.py:\n" + bad.join("\n"));
});

test("the guard catches the shapes it is meant to catch", () => {
  const hit = (s) => ASSIGN.some((re) => re.test(s));
  assert.ok(hit('MODEL = "claude-opus-5-5"'));
  assert.ok(hit('STORY_MODEL = "claude-opus-5-5"   # stories'));
  assert.ok(hit('MODEL = os.environ.get("X", "").strip() or "claude-haiku-5-5"'));
  assert.ok(hit('        "model": "claude-sonnet-5-5",'));
  assert.ok(hit("FACT_CHECK_MODEL: ${{ vars.FACT_CHECK_MODEL || 'claude-opus-5-5' }}"));
  assert.ok(!hit("MODEL = claude_models.STORY"));
  assert.ok(!hit('assert p["model"] == "claude-fable-5-2"'));
});

test("the registry: current models, exact ids, no date suffix, a price and a cache minimum for each", () => {
  const src = read("scripts/claude_models.py");
  const roles = Object.fromEntries([...src.matchAll(/^([A-Z_]+) = "(claude-[a-z0-9-]+)"$/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(roles, {
    WRITER: "claude-sonnet-5-5", WRITER_FALLBACK: "claude-sonnet-5", CHECKER: "claude-haiku-5-5",
    REVIEWER: "claude-fable-5-2", REVIEWER_FALLBACK: "claude-opus-5-5",
    STORY: "claude-opus-5-5", RESEARCH: "claude-sonnet-5-5", ACCURACY: "claude-opus-5-5",
  });
  assert.doesNotMatch(src, /"claude-[a-z0-9-]*-20\d{6}"/, "no date-suffixed model id");
  assert.doesNotMatch(src, /"claude-(sonnet-4|haiku-4|sonnet-4-6|opus-4)/, "no retired generation in the table");
  assert.match(execFileSync("python3", ["scripts/claude_models.py", "--selftest"], { cwd: ROOT, encoding: "utf8" }),
    /claude_models selftest ok/);
});

test("the paid cache probe never runs without --live", () => {
  let err;
  try {
    execFileSync("python3", ["scripts/claude_models.py", "--cache-probe"], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ANTHROPIC_API_KEY: "" } });
  } catch (e) { err = e; }
  assert.ok(err, "exits non-zero");
  assert.match(String(err.stderr), /add --live/);
});
