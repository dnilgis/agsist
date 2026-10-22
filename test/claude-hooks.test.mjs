/**
 * The Claude Code hooks in .claude/settings.json (Sig, Oct 22 2026), run with the JSON a hook gets on stdin:
 * - scripts/dev/wip-push.sh: autosaves fx/* only (never main), never .env, keys, node_modules or big
 *   files, commits as dnilgis, pushes, silent no-op when nothing changed, always exit 0
 * - scripts/dev/verify-gate.mjs: blocks a stop (exit 2) on skipped>0 or a failure in .verify/last.json
 *   from this session, or on code changed since; passes on a clean run; stop_hook_active always exits 0
 * - scripts/dev/verify.sh: writes {pass, fail, skipped, at} from quick.sh's run; exit 3 on a skip
 * - scripts/dev/bash-guard.mjs: rm -rf outside /tmp, push to main and forced pushes are blocked
 * - scripts/dev/session-compact.sh: the head of HANDOFF "Now" (about 4 KB), or a one-line pointer
 * - settings.json: the documented shape, each hook's script exists, deny covers main and force pushes
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV = path.join(root, 'scripts/dev');
const tmp = (p) => fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), p));
// never let a hook under test reach the real checkout: CLAUDE_PROJECT_DIR always points at the fixture
const env = (dir, extra = {}) => { const e = { ...process.env, CLAUDE_PROJECT_DIR: dir, ...extra }; delete e.NODE_TEST_CONTEXT; for (const k of Object.keys(e)) if (k.startsWith('GIT_')) delete e[k]; return e; };
const run = (cmd, args, input, dir, extra) => spawnSync(cmd, args, { input: JSON.stringify(input), encoding: 'utf8', cwd: dir, env: env(dir, extra), timeout: 60000 });
const git = (dir, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: dir, encoding: 'utf8', env: env(dir), stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function repo() { // a checkout with a bare origin, main pushed
  const d = tmp('cch-');
  git(d, 'init', '-q', '--bare', '-b', 'main', 'origin.git');
  git(d, 'init', '-q', '-b', 'main', 'w');
  const w = path.join(d, 'w');
  git(w, 'remote', 'add', 'origin', path.join(d, 'origin.git'));
  fs.mkdirSync(path.join(w, 'scripts'));
  fs.writeFileSync(path.join(w, 'scripts/a.py'), 'print(1)\n');
  git(w, 'add', '-A'); git(w, 'commit', '-q', '-m', 'init'); git(w, 'push', '-q', 'origin', 'main');
  return { w, origin: path.join(d, 'origin.git') };
}
const remoteHead = (origin, br) => { try { return git(origin, 'rev-parse', `refs/heads/${br}`); } catch { return null; } };

test('wip-push: refuses main (no commit, nothing pushed), exit 0', () => {
  const { w, origin } = repo();
  const before = remoteHead(origin, 'main');
  fs.writeFileSync(path.join(w, 'scripts/a.py'), 'print(2)\n');
  const r = run('bash', [path.join(DEV, 'wip-push.sh')], { hook_event_name: 'Stop', cwd: w }, w);
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, '', 'silent');
  assert.equal(git(w, 'rev-list', '--count', 'HEAD'), '1', 'no commit on main');
  assert.equal(remoteHead(origin, 'main'), before, 'main on origin untouched');
  assert.match(git(w, 'status', '--porcelain'), /scripts\/a\.py/, 'the change is left as it was');
  // a branch that is not fx/* is refused too
  git(w, 'checkout', '-q', '-b', 'feature/x');
  run('bash', [path.join(DEV, 'wip-push.sh')], { cwd: w }, w);
  assert.equal(git(w, 'rev-list', '--count', 'HEAD'), '1', 'no commit on feature/x');
});

test('wip-push: on fx/* saves tracked changes and new source files, never secrets, node_modules or big files', () => {
  const { w, origin } = repo();
  git(w, 'checkout', '-q', '-b', 'fx/t');
  const put = (p, s) => { fs.mkdirSync(path.dirname(path.join(w, p)), { recursive: true }); fs.writeFileSync(path.join(w, p), s); };
  put('scripts/a.py', 'print(3)\n');                        // tracked change
  put('scripts/new.py', 'print(4)\n');                      // new source file
  put('page.html', '<p>new page</p>\n');                    // new top-level page
  put('.env', 'SECRET=1\n');
  put('scripts/.env.local', 'SECRET=1\n');
  put('scripts/deploy.pem', 'x\n');
  put('scripts/notes.txt', '-----BEGIN RSA PRIVATE KEY-----\nabc\n');   // a key by its shape
  put('scripts/node_modules/x/index.js', '1\n');
  put('scripts/big.bin', 'x'.repeat(4096));                 // over the (test) cap
  put('scratch/try.js', '1\n');                             // not a source folder
  put('randomdir/x.txt', '1\n');
  const r = run('bash', [path.join(DEV, 'wip-push.sh')], { hook_event_name: 'SubagentStop', cwd: w }, w, { WIP_MAX_BYTES: '1000' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, '', 'silent');
  assert.equal(git(w, 'log', '-1', '--format=%s|%an|%ae'), 'WIP autosave|dnilgis|dnilgis@gmail.com');
  const files = git(w, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort();
  assert.deepEqual(files, ['page.html', 'scripts/a.py', 'scripts/new.py']);
  assert.equal(remoteHead(origin, 'fx/t'), git(w, 'rev-parse', 'HEAD'), 'pushed to origin fx/t');
  assert.equal(remoteHead(origin, 'main'), git(w, 'rev-parse', 'main'), 'main untouched');

  // nothing changed since: silent no-op
  const n = git(w, 'rev-list', '--count', 'HEAD');
  const r2 = run('bash', [path.join(DEV, 'wip-push.sh')], { cwd: w }, w, { WIP_MAX_BYTES: '1000' });
  assert.equal(r2.status, 0); assert.equal(r2.stdout + r2.stderr, '');
  assert.equal(git(w, 'rev-list', '--count', 'HEAD'), n, 'no empty commit');
});

test('wip-push: a secret the helper staged stops the save for that checkout; bad stdin still exits 0', () => {
  const { w } = repo();
  git(w, 'checkout', '-q', '-b', 'fx/s');
  fs.writeFileSync(path.join(w, 'scripts/a.py'), 'print(5)\n');
  fs.writeFileSync(path.join(w, '.env'), 'TOKEN=1\n');
  git(w, 'add', '-f', '.env');
  const r = spawnSync('bash', [path.join(DEV, 'wip-push.sh')], { input: 'not json', encoding: 'utf8', cwd: w, env: env(w) });
  assert.equal(r.status, 0);
  assert.equal(git(w, 'rev-list', '--count', 'HEAD'), '1', 'nothing committed while .env is staged');
});

// the stop gate
function gateRepo(rec, { at = Date.now(), start = Date.now() - 60000 } = {}) {
  const { w } = repo();
  fs.mkdirSync(path.join(w, '.verify'));
  const f = path.join(w, '.verify/last.json');
  fs.writeFileSync(f, JSON.stringify({ pass: 10, fail: 0, skipped: 0, at: new Date(at).toISOString(), head: git(w, 'rev-parse', 'HEAD'), skips: [], ...rec }));
  fs.utimesSync(f, at / 1000, at / 1000);
  const tx = path.join(w, '..', 'tx.jsonl');
  fs.writeFileSync(tx, JSON.stringify({ type: 'user', timestamp: new Date(start).toISOString() }) + '\n');
  return { w, tx };
}
const gate = (input, w) => run('node', [path.join(DEV, 'verify-gate.mjs')], input, w);

test('verify gate: blocks on skipped>0 (exit 2, plain reason) and passes on 0', () => {
  const a = gateRepo({ skipped: 2, skips: ['needs jsqr (jsqr is not installed)'] });
  const r = gate({ hook_event_name: 'Stop', cwd: a.w, transcript_path: a.tx, stop_hook_active: false }, a.w);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /skipped 2 test/);
  assert.match(r.stderr, /needs jsqr/);
  assert.ok(!/\u2014/.test(r.stderr), 'no em dash');
  const b = gateRepo({ skipped: 0 });
  const r2 = gate({ hook_event_name: 'Stop', cwd: b.w, transcript_path: b.tx, stop_hook_active: false }, b.w);
  assert.equal(r2.status, 0, r2.stderr);
  const c = gateRepo({ fail: 1 });
  assert.equal(gate({ hook_event_name: 'SubagentStop', cwd: c.w, agent_transcript_path: c.tx, stop_hook_active: false }, c.w).status, 2, 'a failure blocks a helper too');
});

test('verify gate: stop_hook_active exits 0 so it cannot loop', () => {
  const a = gateRepo({ skipped: 3, fail: 2 });
  const r = gate({ hook_event_name: 'Stop', cwd: a.w, transcript_path: a.tx, stop_hook_active: true }, a.w);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
});

test('verify gate: no-op without a run this session; blocks when code changed since the last run', () => {
  const now = Date.now();
  // an old run with skips, from before this session, nothing changed since: not this turn's business
  const a = gateRepo({ skipped: 1 }, { at: now - 3600e3, start: now - 60e3 });
  assert.equal(gate({ hook_event_name: 'Stop', cwd: a.w, transcript_path: a.tx }, a.w).status, 0);
  // no record at all: no gate
  const { w } = repo();
  assert.equal(gate({ hook_event_name: 'Stop', cwd: w }, w).status, 0);
  // an old clean run, then scripts/ changed: run verify again first
  const b = gateRepo({ skipped: 0 }, { at: now - 3600e3, start: now - 60e3 });
  fs.writeFileSync(path.join(b.w, 'scripts/a.py'), 'print(9)\n');
  const r = gate({ hook_event_name: 'Stop', cwd: b.w, transcript_path: b.tx }, b.w);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /changed since the last test run: scripts\/a\.py/);
  // garbage on stdin never fails the turn
  assert.equal(spawnSync('node', [path.join(DEV, 'verify-gate.mjs')], { input: '{oops', encoding: 'utf8', env: env(w) }).status, 0);
});

test('verify.sh: records pass, fail, skipped and at from the run, and exits 3 on a skip', () => {
  const { w } = repo();
  fs.mkdirSync(path.join(w, 'scripts/dev'), { recursive: true });
  fs.copyFileSync(path.join(DEV, 'verify.sh'), path.join(w, 'scripts/dev/verify.sh'));
  // a stand-in quick.sh that leaves node --test output where the real one does
  fs.writeFileSync(path.join(w, 'scripts/dev/quick.sh'), '#!/bin/bash\nO="${TMPDIR:-/tmp}/agsist-quick"; mkdir -p "$O"\nprintf "ok 1 - runs\\nok 2 - reads the QR # SKIP jsqr is not installed\\n# pass 1\\n# fail 0\\n# skipped 1\\n" > "$O/nt.out"\necho "ok   node --test (1 files)"\n');
  const T = tmp('vq-');
  const r = spawnSync('bash', ['scripts/dev/verify.sh'], { cwd: w, encoding: 'utf8', env: env(w, { TMPDIR: T }) });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  const rec = JSON.parse(fs.readFileSync(path.join(w, '.verify/last.json'), 'utf8'));
  assert.equal(rec.pass, 1); assert.equal(rec.fail, 0); assert.equal(rec.skipped, 1);
  assert.ok(Date.parse(rec.at) > Date.now() - 600e3, 'at is now');
  assert.deepEqual(rec.skips, ['reads the QR (jsqr is not installed)']);
  assert.ok(fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n').includes('/.verify/'), '.verify/ is ignored');
});

test('bash guard: rm -rf outside /tmp, pushes to main and forced pushes are blocked; the rest passes', () => {
  const g = (command, cwd = '/home') => run('node', [path.join(DEV, 'bash-guard.mjs')], { hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd, tool_input: { command } }, os.tmpdir()).status;
  for (const c of ['rm -rf /home/user/agsist', 'rm -rf build', 'ls && rm -fr ~/x', 'rm -r -f "$W"', 'rm -Rf /', 'rm -rf /tmp/../etc',
    'git push origin main', 'git push -q origin HEAD:main', 'git push origin fx/a:refs/heads/main', 'git -C /x push origin main',
    'git push --force origin fx/a', 'git push --force-with-lease origin fx/a', 'git push -uf origin fx/a', 'git push origin +fx/a']) assert.equal(g(c), 2, c);
  for (const c of ['rm -rf /tmp/x/ccw', 'cd /tmp/x && rm -rf build', 'rm -f a.txt', 'rm -r olddir', 'git push origin fx/ccworkflow', 'git push -u origin fx/a',
    'git status', 'echo "rm -rf /"', 'node --test test/x.test.mjs']) assert.equal(g(c), 0, c);
});

test('session-compact: the head of HANDOFF "Now" (about 4 KB) when the notes are there, else a one-line pointer', () => {
  const fb = tmp('fb-'); fs.mkdirSync(path.join(fb, 'notes'));
  fs.writeFileSync(path.join(fb, 'notes/HANDOFF.md'), `# Handoff\n\nintro\n\n## Now (Oct 22)\n- first line\n${'- more words here\n'.repeat(600)}## Repos and keys\n- not this\n`);
  const { w } = repo();
  const r = run('bash', [path.join(DEV, 'session-compact.sh')], { hook_event_name: 'SessionStart', source: 'compact' }, w, { FEEDBAG_DIR: fb });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /## Now \(Oct 22\)\n- first line/);
  assert.ok(!r.stdout.includes('Repos and keys') && !r.stdout.includes('intro'), 'only the Now section');
  const now = r.stdout.slice(r.stdout.indexOf('## Now'), r.stdout.indexOf('Open fx/*'));
  assert.ok(now.length <= 4200 && now.length > 3500, `about 4 KB, got ${now.length}`);
  assert.match(r.stdout, /Open fx\/\* branches on origin/);
  const r2 = run('bash', [path.join(DEV, 'session-compact.sh')], { source: 'compact' }, w, { FEEDBAG_DIR: path.join(fb, 'none') });
  assert.equal(r2.status, 0);
  assert.match(r2.stdout.split('\n')[0], /^Private notes not cloned here: add dnilgis\/feedbag/);
});

test('settings.json: documented hook shape, every hook script exists, deny covers main, force pushes and rm -rf', () => {
  const s = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'));
  const known = new Set(['PreToolUse', 'Stop', 'SubagentStop', 'SessionStart']);
  for (const [ev, groups] of Object.entries(s.hooks)) {
    assert.ok(known.has(ev), ev);
    for (const gr of groups) for (const h of gr.hooks) {
      assert.equal(h.type, 'command');
      const m = h.command.match(/scripts\/dev\/[\w.-]+/); assert.ok(m && fs.existsSync(path.join(root, m[0])), `${ev}: ${h.command}`);
      assert.match(h.command, /\$CLAUDE_PROJECT_DIR/, 'runs from the project, whatever the cwd');
      assert.match(h.command, /\[ -f "\$f" \] \|\|/, 'a checkout without the script (engine mode) is a no-op, not an error');
    }
  }
  assert.ok(!('matcher' in s.hooks.Stop[0]), 'Stop takes no matcher');
  assert.equal(s.hooks.SessionStart[0].matcher, 'compact');
  assert.equal(s.hooks.PreToolUse[0].matcher, 'Bash');
  for (const ev of ['Stop', 'SubagentStop']) {
    const hs = s.hooks[ev][0].hooks;
    assert.ok(hs.some((h) => /verify-gate/.test(h.command) && !h.async), `${ev}: the gate runs in the foreground (an async hook cannot block)`);
    assert.ok(hs.some((h) => /wip-push/.test(h.command) && h.async === true), `${ev}: the autosave runs async`);
  }
  const { allow, deny } = s.permissions;
  for (const d of ['Bash(git push * main)', 'Bash(git push *:main)', 'Bash(git push --force*)', 'Bash(git push *--force*)', 'Bash(git push * -f)', 'Bash(git push * +*)', 'Bash(rm -rf /)']) assert.ok(deny.includes(d), d);
  assert.ok(!allow.some((a) => /\bmain\b|--force|\bBash\(\*?\)|^Bash$/.test(a)), 'no allow rule for main, force or every command');
  for (const a of ['Bash(git push origin fx/*)', 'Bash(node --test *)', 'Bash(python3 scripts/*)', 'Bash(bash scripts/dev/*)']) assert.ok(allow.includes(a), a);
});
