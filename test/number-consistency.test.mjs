// scripts/check_number_consistency.py (2026-10-17 cross-page audit): its rule
// selftests pass, and freshness.yml runs it after the bakes in report mode,
// with no schedule of its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("every rule's selftest passes", () => {
  const out = execFileSync("python3", ["scripts/check_number_consistency.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /selftest ok/);
  for (const r of ["settle-words", "futures-heads", "harvest-tracker", "arc-prices", "daily-basis", "basis-log",
    "removal-rates", "fert-head", "milk-mailbox", "staleness", "counts"]) assert.match(out, new RegExp("ok   " + r + ": "), r);
});

test("freshness runs it after the bakes, report only, and adds no schedule", () => {
  const wf = readFileSync(ROOT + ".github/workflows/freshness.yml", "utf8");
  const i = wf.indexOf("- name: Number consistency (report only)");
  assert.ok(i > wf.indexOf("python scripts/bake_faq.py\n"), "after the FAQ bake");
  assert.ok(i < wf.indexOf("- name: Commit if changed"), "before the commit");
  assert.match(wf.slice(i, i + 300), /continue-on-error: true/);
  assert.doesNotMatch(wf.slice(i, i + 300), /--strict/);
  assert.equal((wf.match(/^\s+- cron:/gm) || []).length, 3, "freshness keeps its three schedule lines");
  assert.match(readFileSync(ROOT + "scripts/dev/checks.sh", "utf8"), /check_number_consistency\.py --selftest/);
});
