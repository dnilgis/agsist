/**
 * No script does work when asked for --help (Oct 29, 2026: twice a helper ran a repo script with --help to
 * learn it, scripts/dev/test_map.py rewrote scripts/dev/test-map.json and scripts/prerender_wpi_scorecard.py ran).
 *
 * Every script in scripts/ and scripts/dev/ (python, node, shell) is run in a temporary copy of the code
 * folders with --help and -h: it must exit 0, print its usage, and leave every file in the copy as it was.
 * A script that guards itself (scripts/_argguard.py, .mjs, .sh) must also exit 2 on a flag it does not name.
 * The guard changes nothing for a script's real arguments: a flag named in quotes in the script passes.
 *   node --test test/script-help-guard.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CODE = ["scripts", "components", "workers", "build", "references"].filter((d) => fs.existsSync(path.join(ROOT, d)));

const scripts = [];
for (const dir of ["scripts", "scripts/dev"]) {
  for (const f of fs.readdirSync(path.join(ROOT, dir)).sort()) {
    if (/\.(py|mjs|sh)$/.test(f) && !f.startsWith("_argguard")) scripts.push(`${dir}/${f}`);
  }
}

const RUN = { ".py": "python3", ".mjs": "node", ".sh": "bash" };
// A script that builds its flag names at run time is guarded for --help only (see _argguard.py).
const DYNAMIC = /["'`]--?["'`]\s*\+|f["']--?\{|`--?\$\{/;

function tree(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { out.set(path.relative(dir, p) + "/", "dir"); walk(p); }
      else out.set(path.relative(dir, p), crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex"));
    }
  };
  walk(dir);
  return out;
}

function diff(a, b) {
  const d = [];
  for (const [k, v] of b) if (a.get(k) !== v) d.push(k);
  for (const k of a.keys()) if (!b.has(k)) d.push(k + " (removed)");
  return d;
}

function run(cmd, args, cwd, home) {
  return new Promise((resolve) => {
    const env = { PATH: process.env.PATH, HOME: home, TMPDIR: home, LANG: "C.UTF-8", PYTHONDONTWRITEBYTECODE: "1" };
    const p = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let out = "", err = "";
    p.stdout.on("data", (b) => { out += b; });
    p.stderr.on("data", (b) => { err += b; });
    const t = setTimeout(() => { try { process.kill(-p.pid, "SIGKILL"); } catch {} }, 20000);
    p.on("close", (code, sig) => { clearTimeout(t); resolve({ code, sig, out, err }); });
  });
}

test("the shell, node and python guards exist and agree on the contract", () => {
  for (const f of ["scripts/_argguard.py", "scripts/_argguard.mjs", "scripts/_argguard.sh"]) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  }
  assert.ok(scripts.length > 300, "the script list was read: " + scripts.length);
});

test("--help and -h print usage, exit 0 and change no file, for every script (and a bad flag exits 2)", async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "help-guard-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "help-guard-home-"));
  try {
    for (const d of CODE) fs.cpSync(path.join(ROOT, d), path.join(work, d), { recursive: true });
    const before = tree(work);
    const problems = [];
    const queue = scripts.slice();
    const one = async (rel) => {
      const ext = path.extname(rel);
      const guarded = /_argguard/.test(fs.readFileSync(path.join(ROOT, rel), "utf8"));
      for (const flag of ["--help", "-h"]) {
        const r = await run(RUN[ext], [rel, flag], work, home);
        if (r.code !== 0) problems.push(`${rel} ${flag}: exit ${r.code}${r.sig ? " " + r.sig : ""}, wanted 0`);
        if (guarded && !/^usage: /.test(r.out)) problems.push(`${rel} ${flag}: no usage line (${JSON.stringify(r.out.slice(0, 60))})`);
      }
      if (guarded && !DYNAMIC.test(fs.readFileSync(path.join(ROOT, rel), "utf8"))) {
        const r = await run(RUN[ext], [rel, "--no-such-flag-xyz"], work, home);
        if (r.code !== 2) problems.push(`${rel} --no-such-flag-xyz: exit ${r.code}, wanted 2`);
        if (r.err.split("\n").filter(Boolean).length !== 1) problems.push(`${rel}: the bad-flag message is not one line`);
      }
    };
    const lane = async () => { while (queue.length) await one(queue.shift()); };
    await Promise.all(Array.from({ length: 6 }, lane));
    const changed = diff(before, tree(work));
    if (changed.length) problems.push(`files changed in the copy: ${changed.slice(0, 8).join(", ")}`);
    assert.deepEqual(problems, [], "A new script must answer --help without doing work: add the two guard lines (see scripts/_argguard.py, .mjs, .sh) after its docstring or imports.\n" + problems.slice(0, 20).join("\n"));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("real arguments still pass: a flag the script names is not called unknown", () => {
  // scripts/dev/test_map.py --check is real; the guard must let it reach the script (it reads files, so run it in the repo read-only).
  const r = spawnSync("python3", ["-c",
    "import sys; sys.path.insert(0,'scripts'); import _argguard as g; " +
    "g.guard('scripts/dev/test_map.py', argv=['--split','1/2','--select','x']); print('ok')"],
  { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const bad = spawnSync("python3", ["-c",
    "import sys; sys.path.insert(0,'scripts'); import _argguard as g; g.guard('scripts/dev/test_map.py', argv=['--nope'])"],
  { cwd: ROOT, encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown option --nope/);
});
