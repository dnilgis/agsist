/* build rule 63: engine sync is part of every merge that touches scripts/ (Nov 4, 2026).
 * On Nov 3 the engine copy (the private repo engine-agsist) was missing the Daily's new safety checks for hours:
 * the sync after a merge was a step the lead had to remember. Two guards, held here:
 *   - .github/workflows/engine-sync.yml copies main's engine paths to the engine branch on every push to main that
 *     changes them, after refusing when a file is only in the engine (a save would delete it), never forced;
 *   - the cron-health row engine-drift (scripts/cron_health.py --selftest has its unit cases) goes red when the
 *     engine has differed from main for more than 2 hours.
 *
 *   node --test test/engine-sync.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const E = path.join(ROOT, ".github/actions/engine/engine.sh");
const wf = read(".github/workflows/engine-sync.yml");
const code = wf.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
const paths = read(".github/engine-paths").split("\n").filter((l) => /^path /.test(l)).map((l) => l.split(/\s+/)[1]);

test("engine-sync.yml: runs on every push to main that changes an engine path, and can be started by hand", () => {
  assert.match(code, /\non:\n  push:\n    branches: \[main\]\n    paths:\n/);
  for (const p of paths) assert.ok(code.includes(`      - "${p}/**"`), `the push paths cover ${p}/`);
  assert.ok(code.includes('      - ".github/engine-paths"'), "and the paths file itself");
  assert.match(code, /\n  workflow_dispatch:\n/, "the merge bot starts it after a merge by its job token (no push run)");
  assert.doesNotMatch(code, /\n  schedule:/, "no new schedule (Sig decides schedules)");
  assert.match(code, /concurrency:\n  group: engine-sync\n  cancel-in-progress: false/, "one sync at a time, none dropped");
});

test("engine-sync.yml: refuses before the save, never forces, reads main's own copy, key only to the private checkout", () => {
  const refuse = code.indexOf("engine.sh only-engine .engine-sync");
  const save = code.indexOf("engine.sh save");
  assert.ok(refuse > 0 && save > refuse, "the only-in-the-engine refusal runs before the save");
  assert.match(code, /bash \.github\/actions\/engine\/engine\.sh only-engine "\$ED"\n/, "and again after a push race");
  assert.match(code, /git -C "\$ED" push -q origin HEAD:engine-agsist/);
  assert.doesNotMatch(code, /push[^\n]*(-f\b|--force)/, "never forced");
  assert.doesNotMatch(code, /uses: \.\/\.github\/actions\/engine\s*$/m, "no Engine checkout: main's own copy, not main with the engine laid over it");
  assert.match(code, /ref: main\n          persist-credentials: false/, "main's checkout keeps no credentials");
  assert.equal((code.match(/secrets\.PRIVATE_REPO_TOKEN/g) || []).length, 1, "the key appears once");
  assert.match(code, /repository: dnilgis\/feedbag\n          ref: engine-agsist\n          token: \$\{\{ secrets\.PRIVATE_REPO_TOKEN \}\}\n          path: \.engine-sync/);
  assert.doesNotMatch(code, /echo "\$out"\s*$/m, "the save's file list is not printed whole");
  assert.match(code, /^permissions:\n  contents: read$/m);
});

const g = (cwd, ...a) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...a], { encoding: "utf8" });
const write = (d, p, s) => { fs.mkdirSync(path.dirname(path.join(d, p)), { recursive: true }); fs.writeFileSync(path.join(d, p), s); };

function fixture() {
  const base = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "engsync-"));
  const pub = path.join(base, "agsist"), eng = path.join(base, "engine");
  for (const d of [pub, eng]) { fs.mkdirSync(d); g(d, "init", "-q"); }
  write(pub, ".github/engine-paths", read(".github/engine-paths"));
  for (const [p, s] of [["scripts/a.py", "a v2\n"], ["test/t.mjs", "t\n"], ["build/b.sh", "b\n"]]) { write(pub, p, s); write(eng, p, p === "scripts/a.py" ? "a v1\n" : s); }
  g(pub, "add", "-A"); g(pub, "commit", "-qm", "main");
  g(eng, "add", "-A"); g(eng, "commit", "-qm", "engine");
  return { base, pub, eng };
}

test("engine.sh only-engine: passes when main has every engine file, refuses (a count, no name) when one is only in the engine", () => {
  const { base, pub, eng } = fixture();
  let r = spawnSync("bash", [E, "only-engine", eng], { cwd: pub, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /no file only in the engine \(3 files under scripts test build\)/);
  write(eng, "scripts/private_only_xyz.py", "x\n"); g(eng, "add", "-A"); g(eng, "commit", "-qm", "an engine-only file");
  r = spawnSync("bash", [E, "only-engine", eng], { cwd: pub, encoding: "utf8" });
  assert.equal(r.status, 1, "refused");
  assert.match(r.stdout, /::error title=engine sync refused::1 file\(s\) exist only in the engine branch engine-agsist/);
  assert.doesNotMatch(r.stdout + r.stderr, /private_only_xyz/, "the file is not named");
  // an untracked file in the public checkout does not count as main's (HEAD is compared, not the working tree)
  write(pub, "scripts/private_only_xyz.py", "x\n");
  assert.equal(spawnSync("bash", [E, "only-engine", eng], { cwd: pub, encoding: "utf8" }).status, 1);
  fs.rmSync(base, { recursive: true, force: true });
});

test("engine.sh save after the refusal passes: the engine branch matches main by blob hash", () => {
  const { base, pub, eng } = fixture();
  assert.equal(spawnSync("bash", [E, "only-engine", eng], { cwd: pub, encoding: "utf8" }).status, 0);
  const r = spawnSync("bash", [E, "save", "sync engine to agsist main x (engine-sync.yml)"], { cwd: pub, encoding: "utf8", env: { ...process.env, ENGINE_DIR: eng } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /engine: committed [0-9a-f]+ sync engine to agsist main x/);
  const tree = (d) => g(d, "ls-tree", "-r", "HEAD", "--", ...paths).trim();
  assert.equal(tree(eng), tree(pub), "same blobs under the engine paths");
  fs.rmSync(base, { recursive: true, force: true });
});

test("cron-health engine-drift: the row is collected and its selftest passes", () => {
  const src = read("scripts/cron_health.py");
  assert.match(src, /rows, late = add_drift_row\(now, rows, late, prev\)/, "main() adds the row, with the last saved file for its clock");
  assert.match(src, /^ENGINE_DRIFT_HOURS = 2 /m);
  const r = spawnSync("python3", ["scripts/cron_health.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout.slice(-2000) + r.stderr);
  for (const l of ["engine-drift: same hashes, ok", "the same file still differs past 2 h: red", "no file name and no key in the engine-drift rows",
    "a new differing file is saved even when the status stays a warning"]) assert.ok(r.stdout.includes("ok   " + l), l);
  const ch = read(".github/workflows/cron-health.yml");
  const step = ch.slice(ch.indexOf("- name: Check every clock"), ch.indexOf("run: python3 scripts/cron_health.py --out private/data/cron-health.json"));
  assert.ok(step.length > 0 && step.includes("PRIVATE_REPO_TOKEN: ${{ secrets.PRIVATE_REPO_TOKEN }}"), "the check step has the key");
});

test("engine.sh only-engine: a file main deleted or renamed since the last sync is deleted from the engine too; one main never had is refused", () => {
  const base = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "engsync-"));
  const pub = path.join(base, "agsist"), eng = path.join(base, "engine");
  for (const d of [pub, eng]) { fs.mkdirSync(d); g(d, "init", "-q"); }
  write(pub, ".github/engine-paths", read(".github/engine-paths"));
  const files = [["scripts/keep.py", "k\n"], ["scripts/old.py", "old\n"], ["scripts/ren.py", "renamed body, long enough to match\n"], ["test/t.mjs", "t\n"], ["build/b.sh", "b\n"]];
  for (const [p, s] of files) { write(pub, p, s); write(eng, p, s); }
  g(pub, "add", "-A"); g(pub, "commit", "-qm", "main before");
  const synced = g(pub, "rev-parse", "--short", "HEAD").trim();
  g(eng, "add", "-A"); g(eng, "commit", "-qm", `sync engine to agsist main ${synced} (#1)`);
  g(pub, "rm", "-q", "scripts/old.py"); g(pub, "mv", "scripts/ren.py", "scripts/ren2.py"); g(pub, "commit", "-qm", "delete and rename");
  const only = () => spawnSync("bash", [E, "only-engine", eng], { cwd: pub, encoding: "utf8" });
  let r = only();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`2 file\\(s\\) only in the engine were deleted or renamed on main since ${synced}; the save deletes them there too`));
  assert.doesNotMatch(r.stdout, /old\.py|ren\.py/, "no names");
  const sv = spawnSync("bash", [E, "save", "sync engine to agsist main y (engine-sync.yml)"], { cwd: pub, encoding: "utf8", env: { ...process.env, ENGINE_DIR: eng } });
  assert.equal(sv.status, 0, sv.stdout + sv.stderr);
  const names = g(eng, "ls-tree", "-r", "--name-only", "HEAD").split("\n");
  assert.ok(!names.includes("scripts/old.py") && !names.includes("scripts/ren.py") && names.includes("scripts/ren2.py"), "deleted and renamed in the engine in the same commit");
  // a file main never had (added to the engine after the sync) is still a refusal
  write(eng, "scripts/never_on_main.py", "n\n"); g(eng, "add", "-A"); g(eng, "commit", "-qm", "engine only");
  r = only();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /::error title=engine sync refused::1 file\(s\) exist only in the engine branch engine-agsist \(main never had them since the last sync\)/);
  assert.doesNotMatch(r.stdout, /never_on_main/);
  // a file main deleted BEFORE the last sync is not covered by main's history since then: refused
  fs.rmSync(base, { recursive: true, force: true });
});

test("engine.sh only-engine: no sync commit in the engine's history, or one not in main's: refused", () => {
  const { base, pub, eng } = fixture();
  write(eng, "scripts/x.py", "x\n"); g(eng, "add", "-A"); g(eng, "commit", "-qm", "sync engine to agsist main deadbee (#9)");
  const r = spawnSync("bash", [E, "only-engine", eng], { cwd: pub, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /the last sync commit deadbee is not in this checkout's history/);
  fs.rmSync(base, { recursive: true, force: true });
});

test("engine.sh save commits a same-size, same-mtime edit (the index's stat data cannot hide it)", () => {
  const { base, pub, eng } = fixture();
  const old = new Date("2020-01-01T00:00:00Z");
  write(eng, "scripts/same.py", "aaaa\n"); fs.utimesSync(path.join(eng, "scripts/same.py"), old, old);
  // stat checks reduced to size and mtime, so only the content can tell the two apart
  g(eng, "config", "core.checkStat", "minimal"); g(eng, "config", "core.trustctime", "false");
  g(eng, "add", "-A"); g(eng, "commit", "-qm", "engine");
  write(pub, "scripts/same.py", "bbbb\n"); fs.utimesSync(path.join(pub, "scripts/same.py"), old, old);
  g(pub, "add", "-A"); g(pub, "commit", "-qm", "main edits same.py, same size");
  const r = spawnSync("bash", [E, "save", "sync engine to agsist main z (engine-sync.yml)"], { cwd: pub, encoding: "utf8", env: { ...process.env, ENGINE_DIR: eng } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /engine: committed [0-9a-f]+ sync engine to agsist main z/);
  assert.equal(g(eng, "show", "HEAD:scripts/same.py"), "bbbb\n");
  fs.rmSync(base, { recursive: true, force: true });
});
