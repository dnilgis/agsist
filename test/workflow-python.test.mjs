// Every script a workflow runs must compile on that workflow's Python.
// 2026-10-13: the first county rain run died on an f-string that Python 3.12
// accepts and the workflow's 3.11 does not; build_prf_counties.py had the same.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wfDir = path.join(root, ".github", "workflows");

function pythonFor(ver) {
  for (const p of [`/usr/bin/python${ver}`, `/usr/local/bin/python${ver}`]) if (existsSync(p)) return p;
  return null;
}

test("scripts compile on the Python version of every workflow that runs them", (t) => {
  const byVer = new Map();
  for (const f of readdirSync(wfDir).filter((x) => /\.ya?ml$/.test(x))) {
    const y = readFileSync(path.join(wfDir, f), "utf8");
    const m = /python-version:\s*["']?(3\.\d+)/.exec(y);
    if (!m) continue;
    for (const s of y.matchAll(/scripts\/([\w-]+\.py)/g)) {
      if (!byVer.has(m[1])) byVer.set(m[1], new Set());
      byVer.get(m[1]).add(s[1]);
    }
  }
  let checked = 0;
  for (const [ver, scripts] of byVer) {
    const py = pythonFor(ver);
    if (!py) { t.diagnostic(`python${ver} not installed here; skipped ${scripts.size} scripts`); continue; }
    for (const s of scripts) {
      const file = path.join(root, "scripts", s);
      if (!existsSync(file)) continue;
      try {
        execFileSync(py, ["-c", "import ast,sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1])", file], { stdio: "pipe" });
      } catch (err) {
        assert.fail(`${s} does not compile on Python ${ver}:\n${String(err.stderr)}`);
      }
      checked++;
    }
  }
  t.diagnostic(`${checked} script compiles checked`);
});
