/* The weekly bids history backup: scripts/bids_mirror.py copies every branch and tag of the bids
 * repository to a private backup repository, sends only what is new, never deletes or rewinds a ref on
 * the backup (an old tip is kept as a tag first), verifies tips and commits after the push, and fails
 * with one clear message when the backup repository is missing or the key cannot reach it.
 *   node --test test/bids-mirror.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/bids-mirror.yml"), "utf8");

test("bids_mirror selftest: steps, incremental weeks, kept tips, verify, the clear failure, no key printed", () => {
  const env = { ...process.env };
  delete env.PRIVATE_REPO_TOKEN;
  const r = spawnSync("python3", ["scripts/bids_mirror.py", "--selftest"], { cwd: ROOT, encoding: "utf8", env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const name of ["first copy: every branch and tag matches the source", "first copy: a refused step is halved and tried again",
    "a later week: only the new commits, tips match", "rewritten: the old tip is kept as a tag on the backup",
    "a branch the source deleted stays on the backup", "no backup repository: exit 1 with one clear message",
    "the key is never printed or written", "visibility check: a public repo"]) {
    assert.ok(r.stdout.includes("ok   " + name), name);
  }
});

test("bids-mirror.yml: backup named by a repo variable, the key at step level, status saved softly to private-data", () => {
  assert.match(wf, /BIDS_BACKUP_REPO: \$\{\{ vars\.BIDS_BACKUP_REPO \|\| 'dnilgis\/bids-backup' \}\}/);
  assert.match(wf, /python3 scripts\/bids_mirror\.py\n/);
  assert.match(wf, /MIRROR_STATUS: private\/stats\/bids-mirror\.log/);
  const save = wf.slice(wf.indexOf("- name: Save the status line"));
  assert.match(save, /if: \$\{\{ !cancelled\(\) \}\}/, "a failed run still records its line");
  assert.match(save, /RAW_BRANCH: private-data\n\s+RAW_SOFT: '1'/);
  assert.doesNotMatch(wf, /--mirror|--force|push -f/, "nothing on the backup is deleted or forced from the workflow");
  const py = fs.readFileSync(path.join(ROOT, "scripts/bids_mirror.py"), "utf8");
  assert.doesNotMatch(py, /"--mirror"|"--prune", dst|"--delete"/, "the script never mirrors deletions onto the backup");
});
