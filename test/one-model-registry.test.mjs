// One table of models (Nov 10, 2026): scripts/claude_models.py names the model for every job, its prices
// and its thinking word. No other script or workflow assigns a model id, so moving a job to a newer model is one
// line, and a price, a thinking word or a cost line can never disagree with the model a job really calls.
// The guard reads the source of every file that calls the API, and every workflow, for a model id assigned as a
// default (MODEL = "claude-...", "model": "claude-...", vars.X || 'claude-...'). A model named inside a test's
// assertion is fine: it checks the registry, it does not choose a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");

// A model id: claude-<family>-<n>..., e.g. claude-opus-5-5, claude-haiku-4-5-20251001.
const ID = /claude-[a-z]+-\d[a-z0-9-]*/;
const QUOTED = /(["'`])claude-[a-z]+-\d[a-z0-9-]*\1/;
// Lines that check the registry rather than choose a model: comments and test assertions.
const SKIP = /^\s*(#|\/\/|\*|assert[ .(]|ok\(|check\(|ck\()/;

function codeHits(text, path) {
  return text.split("\n").flatMap((line, i) => (!SKIP.test(line) && QUOTED.test(line) ? [`${path}:${i + 1}: ${line.trim()}`] : []));
}

function yamlHits(text, path) {
  return text.split("\n").flatMap((line, i) => (!/^\s*#/.test(line) && ID.test(line) ? [`${path}:${i + 1}: ${line.trim()}`] : []));
}

function walk(dir, keep) {
  if (!existsSync(ROOT + dir)) return [];
  return readdirSync(ROOT + dir, { withFileTypes: true }).flatMap((d) => {
    const p = `${dir}/${d.name}`;
    if (d.isDirectory()) return d.name === "__pycache__" || d.name === "node_modules" ? [] : walk(p, keep);
    return keep(d.name) ? [p] : [];
  });
}

// Code files: every script under scripts/ (nested folders too), workers/ and build/; tests are not scanned
// (they assert what the registry says). The registry itself is the one place an id is written.
const CODE = ["scripts", "workers", "build"].flatMap((d) => walk(d, (f) => /\.(py|mjs|js|cjs|sh)$/.test(f)))
  .filter((p) => p !== "scripts/claude_models.py" && !/(^|\/)test_[^/]*\.py$/.test(p));
const YAML = [".github/workflows", ".github/actions"].flatMap((d) => walk(d, (f) => /\.ya?ml$/.test(f)));

test("every model job takes its model from scripts/claude_models.py", () => {
  for (const need of ["scripts/generate_daily.py", "scripts/critique_briefing.py", "scripts/fact_check_briefing.py",
                      "scripts/atlas_reads.py", "scripts/api_jobs.py", "scripts/accuracy_pass.py"]) {
    assert.ok(CODE.includes(need), `${need} is read by this guard`);
    assert.match(read(need), /import claude_models/, `${need} imports the registry`);
  }
  assert.ok(CODE.some((p) => p.startsWith("scripts/dev/")), "nested script folders are scanned");
  assert.ok(YAML.includes(".github/workflows/daily.yml"));
  const bad = [...CODE.flatMap((p) => codeHits(read(p), p)), ...YAML.flatMap((p) => yamlHits(read(p), p))];
  assert.deepEqual(bad, [], "a model id is written outside scripts/claude_models.py:\n" + bad.join("\n"));
});

test("the guard catches every shape a model id can hide in", () => {
  const code = (s) => codeHits(s, "x.py").length > 0;
  const yaml = (s) => yamlHits(s, "x.yml").length > 0;
  const probes = [
    'MODEL = "claude-opus-5-5"',
    'STORY_MODEL = "claude-opus-5-5"   # stories',
    'MODEL = os.environ.get("ATLAS_READS_MODEL", "claude-haiku-5-5")',
    'def review(payload, model="claude-sonnet-5-5"):',
    'model = "claude-fable-5-2"',
    '        "model": "claude-sonnet-5-5",',
    "PRICES_2 = {'claude-opus-5-5': (4.0, 20.0)}",
    'reviewer = os.getenv("R") or "claude-haiku-4-5-20251001"',
    "const model = `claude-opus-5`;",
    'FALLBACKS = ("claude-opus-4-8",)',
  ];
  for (const p of probes) assert.ok(code(p), `not caught: ${p}`);
  for (const p of ["FACT_CHECK_MODEL: ${{ vars.FACT_CHECK_MODEL || 'claude-opus-5-5' }}", "  MODEL: claude-opus-5-5",
                   '        default: "claude-sonnet-5-5"', "        description: else claude-haiku-5-5"]) {
    assert.ok(yaml(p), `not caught in a workflow: ${p}`);
  }
  for (const p of ["MODEL = claude_models.STORY", 'assert p["model"] == "claude-fable-5-2"', '# was "claude-sonnet-4-6"',
                   'ok(p["model"] == "claude-opus-5-5", "story")', '    """claude-haiku-5-5 is the cheaper model"""']) {
    assert.ok(!code(p), `wrongly caught: ${p}`);
  }
  assert.ok(!yaml("# the reviewer is claude-opus-5-5"));
});

test("the registry: current models, exact ids, no date suffix, a price and a cache minimum for each", () => {
  const src = read("scripts/claude_models.py");
  const roles = Object.fromEntries([...src.matchAll(/^([A-Z_]+) = "(claude-[a-z0-9-]+)"$/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(roles, {
    WRITER: "claude-sonnet-5-5", WRITER_FALLBACK: "claude-sonnet-5", CHECKER: "claude-haiku-5-5",
    REVIEWER: "claude-opus-5-5", REVIEWER_FALLBACK: "claude-opus-5",
    STORY: "claude-opus-5-5", RESEARCH: "claude-sonnet-5-5", ACCURACY: "claude-opus-5-5",
  });
  assert.doesNotMatch(src, /"claude-[a-z0-9-]*-20\d{6}"/, "no date-suffixed model id");
  assert.doesNotMatch(src, /"claude-(sonnet-4|haiku-4)/, "no retired generation in the table");
  // the models a server side fallback can answer on are priced, so their answers are billed honestly
  for (const m of ["claude-opus-5", "claude-opus-4-8"]) assert.match(src, new RegExp(`^    "${m}": \\(5\\.00, 25\\.00,`, "m"), m);
  assert.match(execFileSync("python3", ["scripts/claude_models.py", "--selftest"], { cwd: ROOT, encoding: "utf8" }),
    /claude_models selftest ok/);
});

test("the paid cache probe never runs without --live; claude_models.py stays a leaf every job can import", () => {
  let err;
  try {
    execFileSync("python3", ["scripts/cache_probe.py"], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ANTHROPIC_API_KEY: "" } });
  } catch (e) { err = e; }
  assert.ok(err, "exits non-zero");
  assert.match(String(err.stderr), /--live to run it/);
  assert.match(execFileSync("python3", ["scripts/cache_probe.py", "--selftest"], { cwd: ROOT, encoding: "utf8" }),
    /cache_probe selftest ok/);
  // generated_sets.py counts a builder's whole import closure as its code: claude_models.py imports no script
  const out = execFileSync("python3", ["-c",
    "import sys; sys.path.insert(0, 'scripts'); import generated_sets as G; print(sorted(G.py_closure('scripts/claude_models.py', G.ROOT)))"],
    { cwd: ROOT, encoding: "utf8" });
  assert.equal(out.trim(), "['scripts/claude_models.py']");
});
