/**
 * The engine checkout (Sig, Oct 20 2026: "move bids code private", the agsist
 * scripts and tests too). The collection code (.github/engine-paths: scripts/,
 * test/, build/) lives on the engine-agsist branch of dnilgis/feedbag.
 * Every workflow job that runs it starts with the "Engine checkout" step
 * (.github/actions/engine), which copies it into the workspace with
 * PRIVATE_REPO_TOKEN when the repository variable ENGINE_MODE is private, and
 * otherwise uses this repository's own copy.
 *
 * - every job that runs engine code has the step, with the key and the mode at
 *   step level, after its own checkout and before the first step that needs it
 * - sparse checkouts carry the action's two files
 * - no workflow prints the key; the key is never left on disk
 * - engine.sh: a failed checkout fails before anything runs and says
 *   "engine checkout failing"; while this repository still tracks the code the
 *   copy never overwrites a tracked file (so a rebase cannot stop on one); a
 *   bare `git add -A` never stages engine files; the local pull/save round trip
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const WF = path.join(root, '.github/workflows');
const workflows = fs.readdirSync(WF).filter((f) => f.endsWith('.yml'));
const ENGINE = path.join(root, '.github/actions/engine/engine.sh');
const NEEDS = /\b(scripts|test|build)\/|\bcd (scripts|test|build)\b|node --test/;
const KEY = 'token: ${{ secrets.PRIVATE_REPO_TOKEN }}';
const MODE = 'mode: ${{ vars.ENGINE_MODE }}';

const noComments = (s) => s.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

// jobs (two-space keys under `jobs:`) and their steps (six spaces, as every workflow here writes them)
function jobs(file) {
  const y = read(`.github/workflows/${file}`);
  const body = y.slice(y.search(/^jobs:\s*$/m));
  const parts = body.split(/\n(?=  [A-Za-z0-9_-]+:\s*(#.*)?\n)/).slice(1).filter(Boolean).filter((p) => /^  [A-Za-z0-9_-]+:/.test(p));
  return parts.map((p) => {
    const name = p.match(/^  ([A-Za-z0-9_-]+):/)[1];
    const head = p.split(/\n    steps:\s*\n/)[0];
    const steps = (p.split(/\n    steps:\s*\n/)[1] || '').split(/\n(?=      - )/).map((s) => ({ text: s, code: noComments(s) }));
    return { name, head, steps };
  });
}
const isOwnCheckout = (s) => /uses: actions\/checkout@/.test(s.code) && !/^\s+(repository|path):/m.test(s.code);
const isEngine = (s) => /uses: \.\/\.github\/actions\/engine\s*$/m.test(s.code);
const runText = (s) => (s.code.match(/(?:^|\n)\s+(?:- )?run: [\s\S]*/) || [''])[0];
const needsCode = (job, s) => NEEDS.test(runText(s)) || /working-directory: (scripts|test)/.test(job.head);

test('every job that runs engine code has the Engine checkout step, key and mode at step level, after its checkout and before the code', () => {
  const bad = [];
  let n = 0;
  for (const f of workflows) {
    for (const j of jobs(f)) {
      const first = j.steps.findIndex((s) => needsCode(j, s));
      if (first < 0) continue;
      n++;
      const e = j.steps.findIndex(isEngine);
      const co = j.steps.findIndex(isOwnCheckout);
      if (e < 0) { bad.push(`${f} ${j.name}: no Engine checkout step`); continue; }
      const st = j.steps[e].code;
      if (!st.includes(KEY)) bad.push(`${f} ${j.name}: the step does not pass the key`);
      if (!st.includes(MODE)) bad.push(`${f} ${j.name}: the step does not pass ENGINE_MODE`);
      if (!(co >= 0 && co < e)) bad.push(`${f} ${j.name}: the step is not after the job's own checkout`);
      if (!(e < first)) bad.push(`${f} ${j.name}: a step runs code before the engine is in place`);
      if (j.steps.filter(isEngine).length !== 1) bad.push(`${f} ${j.name}: more than one Engine checkout`);
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(n > 100, `found ${n} jobs that run engine code; the parser lost them`);
});


// Oct 20: email-bids.yml skips its checkout outside 5am-1pm Central; the Engine
// checkout step ran anyway, found no action files and failed every idle run.
test('an Engine checkout step runs only when its job\'s checkout ran (same if:)', () => {
  const cond = (s) => ((s.code.match(/^\s+(?:- )?if:\s*(.+?)\s*$/m) || [])[1] || '').replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  const bad = [];
  for (const f of workflows) {
    for (const j of jobs(f)) {
      const e = j.steps.findIndex(isEngine);
      if (e < 0) continue;
      const co = j.steps.slice(0, e).map((s, i) => [s, i]).filter(([s]) => isOwnCheckout(s)).pop();
      if (co && cond(co[0]) !== cond(j.steps[e])) bad.push(`${f} ${j.name}: checkout if "${cond(co[0])}", Engine checkout if "${cond(j.steps[e])}"`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the key lives at step level only: never in a workflow or job env, never inline in a run script', () => {
  const bad = [];
  for (const f of workflows) {
    const y = read(`.github/workflows/${f}`);
    y.split('\n').forEach((l, i) => {
      if (l.trim().startsWith('#')) return;
      if (/PRIVATE_REPO_TOKEN/.test(l) && (l.length - l.trimStart().length) < 8) bad.push(`${f}:${i + 1} key above step level`);
    });
    for (const j of jobs(f)) for (const s of j.steps) {
      const r = runText(s);
      if (/secrets\.PRIVATE_REPO_TOKEN/.test(r)) bad.push(`${f} ${j.name}: secret inline in a run script`);
      if (/(echo|printf|cat)\b[^\n|]*\$\{?PRIVATE_REPO_TOKEN/.test(r)) bad.push(`${f} ${j.name}: prints the key`);
      if (/PRIVATE_REPO_TOKEN/.test(r) && /^\s*set -[a-z]*x/m.test(r)) bad.push(`${f} ${j.name}: set -x with the key in reach`);
    }
  }
  assert.deepEqual(bad, []);
});

test('sparse checkouts in engine jobs carry the action files', () => {
  const bad = [];
  for (const f of workflows) for (const j of jobs(f)) {
    const co = j.steps.find(isOwnCheckout);
    if (!co || !j.steps.some(isEngine) || !/sparse-checkout:/.test(co.code)) continue;
    const cone = !/sparse-checkout-cone-mode: false/.test(co.code);
    const ok = cone ? /^\s+\.github\s*$/m.test(co.code)
      : /^\s+\/?\.github\/actions\/engine\/?\s*$/m.test(co.code) && /^\s+\/?\.github\/engine-paths\s*$/m.test(co.code);
    if (!ok) bad.push(`${f} ${j.name}`);
  }
  assert.deepEqual(bad, []);
});

test('the action: pinned checkout, key not left on disk, a failed checkout reaches the loud failure', () => {
  const a = read('.github/actions/engine/action.yml');
  assert.match(a, /uses: actions\/checkout@[0-9a-f]{40}/);
  assert.match(a, /persist-credentials: false/);
  assert.match(a, /continue-on-error: true/);
  assert.match(a, /CHECKOUT_OUTCOME: \$\{\{ steps\.checkout\.outcome \}\}/);
  assert.match(a, /HAVE_TOKEN: \$\{\{ inputs\.token != '' \}\}/);
  assert.equal((a.match(/inputs\.token/g) || []).length, 2, 'the key goes to the checkout and the yes/no check, nowhere else');
  const sh = read('.github/actions/engine/engine.sh');
  assert.doesNotMatch(sh, /\$\{?(PRIVATE_REPO_TOKEN|INPUT_TOKEN|TOKEN)\b/, 'engine.sh never reads the key');
  const conf = read('.github/engine-paths');
  assert.match(conf, /^repo dnilgis\/feedbag$/m);
  assert.match(conf, /^branch engine-agsist$/m);
  for (const p of ['scripts', 'test', 'build']) assert.match(conf, new RegExp(`^path ${p}$`, 'm'));
});

// ---- engine.sh in throwaway repositories ----
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'engine-'));
const sh = (cwd, cmd, env = {}) => spawnSync('bash', ['-c', cmd], { cwd, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '', ...env } });
const g = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (dir, rel, s) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), s); };

function publicRepo({ tracked = true } = {}) {
  const d = tmp();
  g(d, 'init', '-q', '-b', 'main');
  write(d, '.github/engine-paths', 'repo dnilgis/feedbag\nbranch engine-agsist\npath scripts\npath test\npath build\n');
  write(d, '.github/actions/engine/engine.sh', fs.readFileSync(ENGINE, 'utf8'));
  write(d, 'data/x.json', '1\n');
  if (tracked) { write(d, 'scripts/a.py', 'public a\n'); write(d, 'test/t.mjs', 'public t\n'); write(d, 'build/b.sh', 'b\n'); }
  g(d, 'add', '-A'); g(d, 'commit', '-qm', 'init');
  return d;
}
function engineDir(base) {
  const e = path.join(base, '.engine-src');
  g(base, 'init', '-q', e);
  write(e, 'scripts/a.py', 'ENGINE a\n'); write(e, 'scripts/new.py', 'engine only\n');
  write(e, 'test/t.mjs', 'public t\n'); write(e, 'build/b.sh', 'b\n');
  g(e, 'add', '-A'); g(e, 'commit', '-qm', 'engine');
  return e;
}
const E = 'bash .github/actions/engine/engine.sh';
// what the removal commit adds to .gitignore (the local session relies on it)
const PATHS_IGNORE = '\n/scripts/\n/test/\n/build/\n';

test('engine.sh plan: in-repo when the code is here; loud failure when it is gone or the key is missing', () => {
  const d = publicRepo();
  const out = path.join(d, '.out'); const sum = path.join(d, '.sum');
  let r = sh(d, `${E} plan`, { GITHUB_OUTPUT: out });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(fs.readFileSync(out, 'utf8'), /^private=false$/m);
  r = sh(d, `${E} plan`, { MODE: 'private', HAVE_TOKEN: 'false', GITHUB_STEP_SUMMARY: sum });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /::error title=engine checkout failing::PRIVATE_REPO_TOKEN is not set/);
  assert.match(fs.readFileSync(sum, 'utf8'), /Nothing was run or published/);
  fs.writeFileSync(out, '');
  r = sh(d, `${E} plan`, { MODE: 'private', HAVE_TOKEN: 'true', GITHUB_OUTPUT: out });
  assert.equal(r.status, 0);
  assert.match(fs.readFileSync(out, 'utf8'), /private=true\nrepo=dnilgis\/feedbag\nref=engine-agsist/);
  const gone = publicRepo({ tracked: false });
  r = sh(gone, `${E} plan`);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /engine checkout failing::the code is not in this repository.*ENGINE_MODE=private/);
  r = sh(d, `${E} plan`, { MODE: 'sometimes' });
  assert.equal(r.status, 1);
  // after the removal the config says `mode private`, whatever the variable says
  fs.appendFileSync(path.join(gone, '.github/engine-paths'), 'mode private\n');
  fs.writeFileSync(out, '');
  r = sh(gone, `${E} plan`, { MODE: '', HAVE_TOKEN: 'true', GITHUB_OUTPUT: out });
  assert.equal(r.status, 0, r.stdout);
  assert.match(fs.readFileSync(out, 'utf8'), /^private=true$/m);
});

test('engine.sh overlay, code still tracked here: never overwrites a tracked file, the checkout stays clean, a rebase over a code change works', () => {
  const up = tmp();
  g(up, 'init', '-q', '--bare', '-b', 'main');
  const d = publicRepo();
  g(d, 'remote', 'add', 'origin', up); g(d, 'push', '-q', 'origin', 'main');
  engineDir(d);
  const r = sh(d, `${E} overlay .engine-src`, { CHECKOUT_OUTCOME: 'success' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /engine: [0-9a-f]{40} from engine-agsist/);
  assert.match(r.stdout, /::notice title=engine older than this repository::1 file\(s\) differ/);
  assert.equal(fs.readFileSync(path.join(d, 'scripts/a.py'), 'utf8'), 'public a\n', 'tracked file kept');
  assert.equal(fs.readFileSync(path.join(d, 'scripts/new.py'), 'utf8'), 'engine only\n', 'missing file added');
  assert.ok(!fs.existsSync(path.join(d, '.engine-src')), 'scratch checkout removed');
  assert.equal(g(d, 'status', '--porcelain'), '', 'nothing to commit');
  write(d, 'data/x.json', '2\n');
  g(d, 'add', '-A');
  assert.equal(g(d, 'diff', '--cached', '--name-only').trim(), 'data/x.json', 'a bare git add -A stages data only');
  g(d, 'commit', '-qm', 'data');
  // somebody pushes a code change meanwhile; the job's rebase must not stop on it
  const o = tmp(); g(o, 'clone', '-q', up, '.'); write(o, 'scripts/a.py', 'public a v2\n');
  g(o, 'commit', '-qam', 'code'); g(o, 'push', '-q', 'origin', 'main');
  g(d, 'pull', '-q', '--rebase', 'origin', 'main');
  g(d, 'push', '-q', 'origin', 'main');
  assert.equal(fs.readFileSync(path.join(d, 'scripts/a.py'), 'utf8'), 'public a v2\n');
  assert.equal(g(d, 'status', '--porcelain'), '');
});

test('engine.sh overlay, code gone from here: the engine is the only copy and git add -A never stages it', () => {
  const d = publicRepo({ tracked: false });
  engineDir(d);
  const r = sh(d, `${E} overlay .engine-src`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(path.join(d, 'scripts/a.py'), 'utf8'), 'ENGINE a\n');
  assert.doesNotMatch(r.stdout, /notice/);
  g(d, 'add', '-A');
  assert.equal(g(d, 'diff', '--cached', '--name-only').trim(), '', 'engine files are excluded');
  const ex = fs.readFileSync(path.join(d, '.git/info/exclude'), 'utf8');
  for (const p of ['/.engine-src/', '/scripts', '/test', '/build']) assert.ok(ex.split('\n').includes(p), p);
});

test('engine.sh overlay: a failed checkout or an incomplete engine fails loudly and changes nothing', () => {
  const d = publicRepo({ tracked: false });
  const sum = path.join(d, '.sum');
  let r = sh(d, `${E} overlay .engine-src`, { CHECKOUT_OUTCOME: 'failure', GITHUB_STEP_SUMMARY: sum });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /::error title=engine checkout failing::could not check out dnilgis\/feedbag engine-agsist/);
  assert.match(fs.readFileSync(sum, 'utf8'), /### Engine checkout failing/);
  assert.ok(!fs.existsSync(path.join(d, 'scripts')));
  const e = engineDir(d);
  fs.rmSync(path.join(e, 'build'), { recursive: true });
  r = sh(d, `${E} overlay .engine-src`);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /engine checkout failing::the engine branch engine-agsist has no build/);
  assert.ok(!fs.existsSync(path.join(d, 'scripts')), 'nothing copied');
});

test('engine.sh pull and save: a local session gets the engine and saves its changes back as a commit there', () => {
  const base = tmp();
  const bare = path.join(base, 'engine.git');
  const seed = path.join(base, 'seed');
  g(base, 'init', '-q', '--bare', '-b', 'engine-agsist', bare);
  fs.mkdirSync(seed); g(seed, 'init', '-q', '-b', 'engine-agsist');
  for (const [p, s] of [['scripts/a.py', 'ENGINE a\n'], ['test/t.mjs', 't\n'], ['build/b.sh', 'b\n']]) write(seed, p, s);
  g(seed, 'add', '-A'); g(seed, 'commit', '-qm', 'seed'); g(seed, 'push', '-q', bare, 'engine-agsist');
  const d = path.join(base, 'agsist');
  fs.mkdirSync(d);
  const pub = publicRepo({ tracked: false });
  fs.cpSync(pub, d, { recursive: true });
  fs.appendFileSync(path.join(d, '.gitignore'), PATHS_IGNORE);
  g(d, 'add', '.gitignore'); g(d, 'commit', '-qm', 'ignore the engine paths');
  const env = { ENGINE_REMOTE: bare };
  let r = sh(d, `${E} pull`, env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(base, 'agsist-engine/.git')), 'cloned next to the checkout');
  assert.equal(fs.readFileSync(path.join(d, 'scripts/a.py'), 'utf8'), 'ENGINE a\n');
  write(d, 'scripts/a.py', 'ENGINE a v2\n');
  r = sh(d, `${E} save "a: v2"`, env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /engine: committed [0-9a-f]+ a: v2/);
  assert.match(r.stdout, /push it: git -C .*agsist-engine push origin engine-agsist/);
  assert.equal(execFileSync('git', ['show', 'HEAD:scripts/a.py'], { cwd: path.join(base, 'agsist-engine'), encoding: 'utf8' }), 'ENGINE a v2\n');
  r = sh(d, `${E} save`, env);
  assert.match(r.stdout, /nothing to save/);
  assert.equal(g(d, 'status', '--porcelain'), '', 'the public checkout never sees the engine files');
  assert.doesNotMatch(fs.readFileSync(path.join(d, '.git/info/exclude'), 'utf8').replace(/^#.*$/mg, ''), /\S/, 'a local pull leaves info/exclude alone (shared by every worktree)');
});
