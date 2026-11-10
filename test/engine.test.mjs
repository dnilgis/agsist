/**
 * The engine checkout (Oct 20 2026, the agsist
 * scripts and tests too). The collection code (.github/engine-paths: scripts/,
 * test/, build/) lives on the engine-agsist branch of the private repo.
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
// code from the engine paths: a path under them, a cd into them, a test runner, a module run (Nov 5, P1)
const NEEDS = /\b(scripts|test|build)\/|\bcd (scripts|test|build)\b|node --test|\bnpm (test|run)\b|\bnpx playwright test\b|python3? -m (scripts|test|build)\b|\b(from|import) (scripts|test|build)\b/;
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
// a run script, or an actions/github-script body (script:), from its key to the end of the step
const runText = (s) => (s.code.match(/(?:^|\n)\s+(?:- )?(?:run|script): [\s\S]*/) || [''])[0];
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

// Oct 21: the history collectors' one new workflow (dispatch only). Its job runs engine code
// (scripts/backfill_*.py), so the Engine checkout is the very next step after its checkout,
// with the same if:, the key and the mode, and it comes before every step that runs code.
test('history-backfill.yml: Engine checkout right after the checkout, same if:, before any code', () => {
  const cond = (s) => ((s.code.match(/^\s+(?:- )?if:\s*(.+?)\s*$/m) || [])[1] || '').replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  const js = jobs('history-backfill.yml');
  assert.equal(js.length, 1, 'one job');
  for (const j of js) {
    const co = j.steps.findIndex(isOwnCheckout), e = j.steps.findIndex(isEngine);
    assert.ok(co >= 0 && e === co + 1, `${j.name}: Engine checkout is the step right after the checkout`);
    assert.equal(cond(j.steps[e]), cond(j.steps[co]), `${j.name}: same if:`);
    assert.ok(j.steps[e].code.includes(KEY) && j.steps[e].code.includes(MODE), `${j.name}: key and mode at step level`);
    const first = j.steps.findIndex((s) => needsCode(j, s));
    assert.ok(first > e, `${j.name}: no code before the engine is in place`);
  }
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
  assert.match(a, /CHECKOUT_OUTCOME: \$\{\{ steps\.recheckout\.outcome == 'failure' && 'failure' \|\| steps\.checkout\.outcome \}\}/);
  assert.match(a, /HAVE_TOKEN: \$\{\{ inputs\.token != '' \}\}/);
  // the key goes to the two checkouts (the run's same-named engine branch, then the default) and the
  // yes/no check, nowhere else; each checkout that takes it leaves no credentials behind
  assert.equal((a.match(/inputs\.token/g) || []).length, 4, 'the key goes to the three checkouts and the yes/no check, nowhere else');
  const steps = a.split(/\n(?=    - id: )/).slice(1);
  for (const st of steps.filter((x) => /inputs\.token/.test(x) && !/HAVE_TOKEN/.test(x))) {
    assert.match(st, /uses: actions\/checkout@[0-9a-f]{40}/, 'only a checkout step takes the key');
    assert.match(st, /persist-credentials: false/, 'a checkout that takes the key leaves it off disk');
    assert.equal((st.match(/inputs\.token/g) || []).length, 1);
  }
  assert.equal(steps.filter((x) => /inputs\.token/.test(x)).length, 4);
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

// Each repository is built where the test uses it, never copied: newer git (2.56 on the runners in
// run 40910004159) ends a commit with `git maintenance run --auto --detach`, whose detached child still
// holds .git/objects/maintenance.lock after the commit returns. A recursive copy of that .git lists
// the lock, the child removes it, and the copy fails with ENOENT on .git/objects (PR #190, shard 1/4).
function publicRepo({ tracked = true, dir = tmp() } = {}) {
  const d = dir;
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
  const r = sh(d, `${E} overlay .engine-src`, { CHECKOUT_OUTCOME: 'success', GITHUB_EVENT_NAME: 'workflow_run' });
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
  const r = sh(d, `${E} overlay .engine-src`, { GITHUB_EVENT_NAME: 'pull_request' }); // gone from here: the engine is the only copy, even on a pull request
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(path.join(d, 'scripts/a.py'), 'utf8'), 'ENGINE a\n');
  assert.doesNotMatch(r.stdout, /notice/);
  g(d, 'add', '-A');
  assert.equal(g(d, 'diff', '--cached', '--name-only').trim(), '', 'engine files are excluded');
  const ex = fs.readFileSync(path.join(d, '.git/info/exclude'), 'utf8');
  for (const p of ['/.engine-src/', '/scripts', '/test', '/build']) assert.ok(ex.split('\n').includes(p), p);
});

test('engine.sh overlay on a pull request: tests come from the commit being tested (PR #319, Nov 4, 2026)', () => {
  // The real case: #319's checks ran on a commit from before #318 while the engine already had #318. The
  // overlay added #318's new test (missing here) and kept this commit's older merge bot, so the test failed.
  const engineWith318 = (d) => {
    const e = engineDir(d);
    write(e, 'test/ai-footer-check.test.mjs', 'the #318 test\n');
    write(e, 'scripts/dev/ai_footer_check.py', 'the #318 check\n');
    write(e, 'scripts/dev/merge_when_green.py', 'the #318 merge bot\n');
    g(e, 'add', '-A'); g(e, 'commit', '-qm', '#318');
  };
  const pre318 = () => {
    const d = publicRepo();
    write(d, 'scripts/dev/merge_when_green.py', 'the merge bot before #318\n');
    g(d, 'add', '-A'); g(d, 'commit', '-qm', 'before #318');
    engineWith318(d);
    return d;
  };
  for (const ev of ['pull_request', 'pull_request_target']) {
    const d = pre318();
    const r = sh(d, `${E} overlay .engine-src`, { GITHUB_EVENT_NAME: ev });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(!fs.existsSync(path.join(d, 'test/ai-footer-check.test.mjs')), ev + ': the engine\'s newer test was added to an older commit');
    assert.ok(!fs.existsSync(path.join(d, 'scripts/dev/ai_footer_check.py')), ev + ': a dev tool this commit lacks was added');
    assert.equal(fs.readFileSync(path.join(d, 'scripts/dev/merge_when_green.py'), 'utf8'), 'the merge bot before #318\n');
    assert.equal(fs.readFileSync(path.join(d, 'scripts/new.py'), 'utf8'), 'engine only\n', 'collection code this commit lacks is still added');
    assert.match(r.stdout, /::notice title=tests from this commit::2 engine file\(s\)/);
    assert.equal(g(d, 'status', '--porcelain'), '', 'nothing to commit');
  }
  // main's runs still get everything the engine adds
  for (const ev of ['push', 'schedule', 'workflow_run', 'workflow_dispatch', '']) {
    const d = pre318();
    const r = sh(d, `${E} overlay .engine-src`, { GITHUB_EVENT_NAME: ev });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(fs.existsSync(path.join(d, 'test/ai-footer-check.test.mjs')), (ev || 'no event') + ': a main run lost an engine test');
    assert.ok(fs.existsSync(path.join(d, 'scripts/dev/ai_footer_check.py')));
    assert.doesNotMatch(r.stdout, /tests from this commit/);
  }
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
  publicRepo({ tracked: false, dir: d });
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

// ---- curtain step P1 (Nov 5, 2026): the engine copy wins in private mode, and a run uses its own branch ----
// A run on main in private mode uses the engine's copy of every engine path, even while this repository
// still tracks the code; a run on fx/x uses the engine branch fx/x when the engine has one (a pull
// request's head, or a dispatch on that branch: build rule 62 and 66). With ENGINE_MODE unset nothing
// changes. The tracked copy is set aside with a sparse checkout, so status stays clean, a bare
// `git add -A` stages data only and a rebase over a code change on main still goes through.
function engineAt(base, dir, files) {
  const e = path.join(base, dir);
  g(base, 'init', '-q', e);
  for (const [p, s] of Object.entries(files)) write(e, p, s);
  g(e, 'add', '-A'); g(e, 'commit', '-qm', 'engine');
  return e;
}
const ENGINE_FILES = { 'scripts/a.py': 'ENGINE a\n', 'scripts/new.py': 'engine only\n', 'test/t.mjs': 'ENGINE t\n', 'build/b.sh': 'b\n' };
const PAIR_FILES = { 'scripts/a.py': 'PAIRED a\n', 'test/t.mjs': 'paired t\n', 'test/newer.test.mjs': 'the branch test\n', 'build/b.sh': 'b\n' };

test('plan: a run on fx/x tries the same-named engine branch first; main, the default branch and odd names do not', () => {
  const d = publicRepo();
  const out = path.join(tmp(), 'out');
  const plan = (env) => { fs.writeFileSync(out, ''); const r = sh(d, `${E} plan`, { GITHUB_OUTPUT: out, MODE: 'private', HAVE_TOKEN: 'true', ...env }); assert.equal(r.status, 0, r.stdout + r.stderr); return fs.readFileSync(out, 'utf8'); };
  assert.match(plan({ RUN_BRANCH: 'fx/curtainp1' }), /^paired=fx\/curtainp1$/m);
  for (const b of ['main', 'engine-agsist', '', 'fx/a..b', 'fx/x;rm -rf /', 'fx/$(id)', '-x', 'fx/x.lock']) {
    assert.match(plan({ RUN_BRANCH: b }), /^paired=$/m, `"${b}" must not pair`);
  }
  // dual mode, the variable unset: in-repo, no pairing, nothing set aside
  fs.writeFileSync(out, '');
  const r = sh(d, `${E} plan`, { GITHUB_OUTPUT: out, MODE: '', HAVE_TOKEN: 'true', RUN_BRANCH: 'fx/curtainp1' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(out, 'utf8'), 'private=false\n');
  assert.equal(fs.readFileSync(path.join(d, 'scripts/a.py'), 'utf8'), 'public a\n');
  assert.equal(spawnSync('git', ['config', 'core.sparseCheckout'], { cwd: d, encoding: 'utf8' }).stdout.trim(), '');
  assert.equal(g(d, 'status', '--porcelain'), '');
});

test('the action: with ENGINE_MODE unset every engine step is skipped; the default checkout runs only when no paired branch was checked out', () => {
  const a = read('.github/actions/engine/action.yml');
  const steps = Object.fromEntries(a.split(/\n(?=    - id: )/).slice(1).map((x) => [x.match(/- id: (\w+)/)[1], x]));
  assert.deepEqual(Object.keys(steps), ['plan', 'paired', 'checkout', 'behind', 'recheckout', 'overlay']);
  assert.match(steps.behind, /if: steps\.plan\.outputs\.private == 'true'/, 'behind runs only in private mode');
  assert.match(steps.recheckout, /if: steps\.behind\.outputs\.retry == 'true'/, 'the second checkout runs only after behind asked for it');
  for (const k of ['paired', 'checkout', 'overlay']) assert.match(steps[k], /if: steps\.plan\.outputs\.private == 'true'/, `${k} runs only in private mode`);
  assert.match(steps.paired, /if: .*steps\.plan\.outputs\.paired != ''/);
  assert.match(steps.paired, /ref: \$\{\{ steps\.plan\.outputs\.paired \}\}/);
  assert.match(steps.paired, /path: \.engine-pair/);
  assert.match(steps.paired, /continue-on-error: true/, 'a missing paired branch falls back, never fails the job');
  assert.match(steps.checkout, /if: .*steps\.paired\.outcome != 'success'/);
  assert.match(steps.checkout, /ref: \$\{\{ steps\.plan\.outputs\.ref \}\}/);
  // never paired on pull_request_target (merge-when-green.yml runs it with a write token)
  for (const k of ['plan', 'overlay']) assert.match(steps[k], /RUN_BRANCH: \$\{\{ github\.event_name != 'pull_request_target' && \(github\.head_ref \|\| github\.ref_name\) \|\| '' \}\}/);
  assert.match(steps.overlay, /PAIRED_OUTCOME: \$\{\{ steps\.paired\.outcome \}\}/);
});

test('overlay on main in private mode: the engine copy wins, status stays clean, add -A stages data only, a rebase over a code change works', () => {
  const up = tmp();
  g(up, 'init', '-q', '--bare', '-b', 'main');
  const d = publicRepo();
  write(d, 'scripts/only_here.py', 'merged a minute ago\n'); write(d, 'scripts/run.sh', '#!/bin/sh\necho hi\n');
  fs.chmodSync(path.join(d, 'scripts/run.sh'), 0o755);
  g(d, 'add', '-A'); g(d, 'commit', '-qm', 'newer code');
  g(d, 'remote', 'add', 'origin', up); g(d, 'push', '-q', 'origin', 'main');
  engineAt(d, '.engine-src', ENGINE_FILES);
  const r = sh(d, `${E} overlay .engine-src`, { CHECKOUT_OUTCOME: 'success', GITHUB_EVENT_NAME: 'schedule', RUN_BRANCH: 'main', PAIRED_OUTCOME: 'skipped', PAIRED: '' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /engine: [0-9a-f]{40} from engine-agsist .*the engine copy$/m);
  assert.equal(fs.readFileSync(path.join(d, 'scripts/a.py'), 'utf8'), 'ENGINE a\n', 'the engine copy is the one that runs');
  assert.equal(fs.readFileSync(path.join(d, 'test/t.mjs'), 'utf8'), 'ENGINE t\n');
  assert.equal(fs.readFileSync(path.join(d, 'scripts/new.py'), 'utf8'), 'engine only\n');
  assert.equal(fs.readFileSync(path.join(d, 'scripts/only_here.py'), 'utf8'), 'merged a minute ago\n', 'a file the engine lacks comes from this commit');
  assert.ok(fs.statSync(path.join(d, 'scripts/run.sh')).mode & 0o100, 'kept executable');
  assert.match(r.stdout, /::notice title=engine behind this commit::2 file\(s\)/);
  assert.match(r.stdout, /::notice title=engine differs from this commit::2 file\(s\)/);
  assert.ok(!fs.existsSync(path.join(d, '.engine-src')));
  assert.equal(g(d, 'status', '--porcelain'), '', 'nothing to commit');
  write(d, 'data/x.json', '2\n');
  g(d, 'add', '-A');
  assert.equal(g(d, 'diff', '--cached', '--name-only').trim(), 'data/x.json', 'a bare git add -A stages data only');
  g(d, 'commit', '-qm', 'data');
  const o = tmp(); g(o, 'clone', '-q', up, '.'); write(o, 'scripts/a.py', 'public a v2\n'); write(o, 'scripts/added.py', 'x\n');
  g(o, 'add', '-A'); g(o, 'commit', '-qm', 'code'); g(o, 'push', '-q', 'origin', 'main');
  g(d, 'pull', '-q', '--rebase', 'origin', 'main');
  g(d, 'push', '-q', 'origin', 'main');
  assert.equal(fs.readFileSync(path.join(d, 'scripts/a.py'), 'utf8'), 'ENGINE a\n', 'the rebase left the engine copy alone');
  assert.equal(g(d, 'status', '--porcelain'), '');
  assert.equal(execFileSync('git', ['show', 'origin/main:scripts/a.py'], { cwd: d, encoding: 'utf8' }), 'public a v2\n', 'the public code was never touched');
  assert.equal(execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: d, encoding: 'utf8' }).trim(), 'data/x.json');
  assert.equal(spawnSync('git', ['config', 'agsist.engineSparse'], { cwd: d, encoding: 'utf8' }).stdout.trim(), 'full', 'the site budget still walks it as a full checkout');
});

test('overlay on main in private mode keeps a job\'s own sparse checkout and still sets the code aside', () => {
  const d = publicRepo();
  write(d, 'other/page.html', 'p\n'); g(d, 'add', '-A'); g(d, 'commit', '-qm', 'page');
  g(d, 'sparse-checkout', 'set', '--no-cone', '/scripts/a.py', '/data/x.json', '/.github/');
  assert.ok(!fs.existsSync(path.join(d, 'other/page.html')));
  engineAt(d, '.engine-src', ENGINE_FILES);
  const r = sh(d, `${E} overlay .engine-src`, { GITHUB_EVENT_NAME: 'workflow_run', RUN_BRANCH: 'main' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(path.join(d, 'scripts/a.py'), 'utf8'), 'ENGINE a\n');
  assert.ok(!fs.existsSync(path.join(d, 'other/page.html')), 'the job\'s own pattern still leaves the page out');
  assert.equal(fs.readFileSync(path.join(d, 'data/x.json'), 'utf8'), '1\n');
  assert.equal(spawnSync('git', ['config', 'agsist.engineSparse'], { cwd: d, encoding: 'utf8' }).stdout.trim(), '', 'a partial checkout stays partial');
  assert.equal(g(d, 'status', '--porcelain'), '');
});

test('overlay on a pull request: the same-named engine branch wins, tests included; with none, the commit\'s own code is tested', () => {
  for (const ev of ['pull_request']) {
    const d = publicRepo();
    engineAt(d, '.engine-src', ENGINE_FILES);
    engineAt(d, '.engine-pair', PAIR_FILES);
    const r = sh(d, `${E} overlay .engine-src`, { GITHUB_EVENT_NAME: ev, RUN_BRANCH: 'fx/x', PAIRED: 'fx/x', PAIRED_OUTCOME: 'success', CHECKOUT_OUTCOME: 'skipped' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /engine: [0-9a-f]{40} from fx\/x /);
    assert.equal(fs.readFileSync(path.join(d, 'scripts/a.py'), 'utf8'), 'PAIRED a\n');
    assert.equal(fs.readFileSync(path.join(d, 'test/newer.test.mjs'), 'utf8'), 'the branch test\n', 'the branch\'s own tests run');
    assert.ok(!fs.existsSync(path.join(d, 'scripts/new.py')), 'nothing from the default engine branch');
    assert.ok(!fs.existsSync(path.join(d, '.engine-pair')) && !fs.existsSync(path.join(d, '.engine-src')));
    assert.equal(g(d, 'status', '--porcelain'), '');
  }
  // no paired branch (its checkout failed): the default engine adds what is missing, this commit's code is kept
  const d = publicRepo();
  engineAt(d, '.engine-src', ENGINE_FILES);
  const r = sh(d, `${E} overlay .engine-src`, { GITHUB_EVENT_NAME: 'pull_request', RUN_BRANCH: 'fx/x', PAIRED: 'fx/x', PAIRED_OUTCOME: 'failure', CHECKOUT_OUTCOME: 'success' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /from engine-agsist .*this commit's copy/);
  assert.equal(fs.readFileSync(path.join(d, 'scripts/a.py'), 'utf8'), 'public a\n');
  assert.equal(spawnSync('git', ['config', 'core.sparseCheckout'], { cwd: d, encoding: 'utf8' }).stdout.trim(), '');
  // both checkouts failed: loud failure, nothing run
  const f = publicRepo({ tracked: false });
  const rf = sh(f, `${E} overlay .engine-src`, { GITHUB_EVENT_NAME: 'pull_request', RUN_BRANCH: 'fx/x', PAIRED: 'fx/x', PAIRED_OUTCOME: 'failure', CHECKOUT_OUTCOME: 'failure' });
  assert.equal(rf.status, 1);
  assert.match(rf.stdout, /engine checkout failing/);
});

test('overlay on a branch run with no engine branch of its name (a dispatch on fx/x): this commit\'s code, as today', () => {
  const d = publicRepo();
  engineAt(d, '.engine-src', ENGINE_FILES);
  const r = sh(d, `${E} overlay .engine-src`, { GITHUB_EVENT_NAME: 'workflow_dispatch', RUN_BRANCH: 'fx/x', PAIRED: 'fx/x', PAIRED_OUTCOME: 'failure' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(path.join(d, 'scripts/a.py'), 'utf8'), 'public a\n');
  // with one, the dispatch runs the branch's engine code even when the job checked out main (build rule 62)
  const p = publicRepo();
  engineAt(p, '.engine-src', ENGINE_FILES); engineAt(p, '.engine-pair', PAIR_FILES);
  const rp = sh(p, `${E} overlay .engine-src`, { GITHUB_EVENT_NAME: 'workflow_dispatch', RUN_BRANCH: 'fx/x', PAIRED: 'fx/x', PAIRED_OUTCOME: 'success' });
  assert.equal(rp.status, 0, rp.stdout + rp.stderr);
  assert.equal(fs.readFileSync(path.join(p, 'scripts/a.py'), 'utf8'), 'PAIRED a\n');
});

test('pair and pull with local bare repositories: fx/x uses the engine branch fx/x when it exists, else the default', () => {
  const base = tmp();
  const bare = path.join(base, 'engine.git');
  const seed = path.join(base, 'seed');
  g(base, 'init', '-q', '--bare', '-b', 'engine-agsist', bare);
  fs.mkdirSync(seed); g(seed, 'init', '-q', '-b', 'engine-agsist');
  for (const [p, s] of Object.entries(ENGINE_FILES)) write(seed, p, s);
  g(seed, 'add', '-A'); g(seed, 'commit', '-qm', 'seed'); g(seed, 'push', '-q', bare, 'engine-agsist');
  g(seed, 'checkout', '-q', '-b', 'fx/x'); write(seed, 'scripts/new.py', 'paired new\n');
  g(seed, 'commit', '-qam', 'fx/x'); g(seed, 'push', '-q', bare, 'fx/x');
  const d = path.join(base, 'agsist');
  fs.mkdirSync(d);
  publicRepo({ tracked: false, dir: d });
  fs.appendFileSync(path.join(d, '.gitignore'), PATHS_IGNORE);
  g(d, 'add', '.gitignore'); g(d, 'commit', '-qm', 'ignore the engine paths');
  const env = { ENGINE_REMOTE: bare };
  const pair = (b) => sh(d, `${E} pair ${b}`, env).stdout.trim();
  assert.equal(pair('fx/x'), 'fx/x');
  assert.equal(pair('fx/y'), 'engine-agsist');
  assert.equal(pair('main'), 'engine-agsist');
  assert.equal(pair("'fx/x;id'"), 'engine-agsist');
  g(d, 'checkout', '-q', '-b', 'fx/x');
  assert.equal(sh(d, `${E} pair`, env).stdout.trim(), 'fx/x', 'defaults to this checkout\'s branch');
  let r = sh(d, `${E} pull`, env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\(fx\/x\)/);
  assert.equal(fs.readFileSync(path.join(d, 'scripts/new.py'), 'utf8'), 'paired new\n');
  g(d, 'checkout', '-q', '-b', 'fx/y');
  r = sh(d, `${E} pull`, env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\(engine-agsist\)/);
  assert.equal(fs.readFileSync(path.join(d, 'scripts/new.py'), 'utf8'), 'engine only\n');
  assert.equal(g(d, 'status', '--porcelain'), '');
});

test('pull_request_target never pairs: a head branch named like an engine branch cannot pick the code a write-token run uses', () => {
  // merge-when-green.yml runs on pull_request_target with a write token; fx/flsales and fx/flgrab exist on the engine
  const d = publicRepo();
  const out = path.join(tmp(), 'out');
  const r = sh(d, `${E} plan`, { GITHUB_OUTPUT: out, MODE: 'private', HAVE_TOKEN: 'true', GITHUB_EVENT_NAME: 'pull_request_target', RUN_BRANCH: 'fx/flsales' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(fs.readFileSync(out, 'utf8'), /^paired=$/m);
  // even if a paired checkout were somehow present and reported success, the overlay ignores it
  engineAt(d, '.engine-src', ENGINE_FILES);
  engineAt(d, '.engine-pair', PAIR_FILES);
  const o = sh(d, `${E} overlay .engine-src`, { GITHUB_EVENT_NAME: 'pull_request_target', RUN_BRANCH: 'fx/flsales', PAIRED: 'fx/flsales', PAIRED_OUTCOME: 'success', CHECKOUT_OUTCOME: 'success' });
  assert.equal(o.status, 0, o.stdout + o.stderr);
  assert.match(o.stdout, /from engine-agsist /);
  assert.notEqual(fs.readFileSync(path.join(d, 'scripts/a.py'), 'utf8'), 'PAIRED a\n');
  assert.ok(!fs.existsSync(path.join(d, 'test/newer.test.mjs')), 'nothing from the paired branch');
  assert.ok(!fs.existsSync(path.join(d, '.engine-pair')), 'the paired checkout is removed');
  // the same branch name on a plain pull_request still pairs
  fs.writeFileSync(out, '');
  sh(d, `${E} plan`, { GITHUB_OUTPUT: out, MODE: 'private', HAVE_TOKEN: 'true', GITHUB_EVENT_NAME: 'pull_request', RUN_BRANCH: 'fx/flsales' });
  assert.match(fs.readFileSync(out, 'utf8'), /^paired=fx\/flsales$/m);
});
