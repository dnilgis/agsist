/**
 * pr-checks.yml runs the ship checks on every pull request to main (Sig, Oct 21 2026:
 * "make shipping faster without checking less"). scripts/dev/checks.sh stays the one
 * list of checks; the workflow calls it (node-test in shards, then --skip-node), so a
 * check added to checks.sh runs in the PR checks with no change to the workflow.
 *
 * - checks.sh --list / --only / --skip-node / --shard behave, and an unknown name fails
 * - the shards plus --skip-node cover every line of checks.sh, exactly once
 * - the shard matrix and the --shard=N/M total agree; Node 22 (it has --test-shard)
 * - the browser tests find Playwright and Chromium under the names they read, and the
 *   job fails if Chromium cannot launch (a skipped browser test is not a pass)
 * - FSA files are pulled before the checks, the key at step level only
 * - one "all checks" status that is red unless every job is green
 * - no schedule, contents: read, superseded runs cancelled, actions pinned to a SHA
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const WF = '.github/workflows/pr-checks.yml';
const y = read(WF);
const code = y.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
const checks = (...args) => spawnSync('bash', ['scripts/dev/checks.sh', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, TMPDIR: fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'prc-')) } });
const list = (...args) => { const r = checks('--list', ...args); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout.trim().split('\n').filter(Boolean); };

// jobs (two-space keys under `jobs:`): name -> text
const jobs = Object.fromEntries(code.slice(code.search(/^jobs:\s*$/m)).split(/\n(?=  [A-Za-z0-9_-]+:\s*\n)/).slice(1)
  .map((p) => [p.match(/^  ([A-Za-z0-9_-]+):/)[1], p]));
const steps = (job) => (jobs[job].split(/\n    steps:\s*\n/)[1] || '').split(/\n(?=      - )/);

test('checks.sh --list names every check once, runs nothing, and --skip-node is the same list without node-test', () => {
  const all = list();
  assert.equal(new Set(all).size, all.length, 'no name twice');
  assert.equal(all[0], 'node-test');
  for (const n of ['seo', 'budget', 'nav', 'feeds', 'worker', 'share', 'llms', 'numbers', 'build_arc_plc']) assert.ok(all.includes(n), n);
  assert.deepEqual(list('--skip-node'), all.filter((n) => n !== 'node-test'));
  assert.deepEqual(list('--only=nav,seo'), ['seo', 'nav'], 'in checks.sh order');
  assert.deepEqual(list('--only=node-test', '--shard=2/4'), ['node-test']);
  assert.ok(!/^(ok|FAIL) /m.test(checks('--list').stdout), 'nothing ran');
});

test('every line of checks.sh is in the list: the literal run lines and each loop item that exists', () => {
  const all = new Set(list());
  const src = read('scripts/dev/checks.sh');
  const lit = [...src.matchAll(/^run ([A-Za-z0-9_.-]+) /mg)].map((m) => m[1]);
  assert.ok(lit.length >= 12, `found ${lit.length} run lines; the parser lost them`);
  for (const n of lit) assert.ok(all.has(n), `run ${n} is not in --list`);
  for (const m of src.matchAll(/^for \w+ in ([^;]+); do (.*)$/mg)) {
    for (const item of m[1].trim().split(/\s+/)) {
      if (/\[ -f /.test(m[2]) && !fs.existsSync(path.join(root, /\//.test(item) ? item : `scripts/${item}.py`))) continue;
      const n = /\//.test(item) ? path.basename(item) : item;
      assert.ok(all.has(n), `loop item ${n} is not in --list`);
    }
  }
});

test('checks.sh: an unknown check name, option or shard fails instead of passing', () => {
  let r = checks('--list', '--only=seo,no-such-check');
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /FAIL unknown check 'no-such-check'/);
  for (const bad of ['--shard=0/4', '--shard=5/4', '--shard=1', '--shard=a/b', '--everything']) {
    r = checks('--list', bad);
    assert.equal(r.status, 2, `${bad}: ${r.stdout}${r.stderr}`);
  }
});

test('the workflow: the shards and --skip-node together run every check, and the shard total agrees', () => {
  const m = jobs['node-tests'].match(/matrix:\s*\n\s+shard: \[([\d, ]+)\]/);
  assert.ok(m, 'node-tests has a shard matrix');
  const shards = m[1].split(',').map((s) => +s.trim());
  const N = shards.length;
  assert.equal(N, 4, 'four shards (Sig, Oct 21)');
  assert.deepEqual(shards, Array.from({ length: N }, (_, i) => i + 1));
  assert.match(jobs['node-tests'], /fail-fast: false/, 'one red shard does not hide the others');
  const runs = steps('node-tests').filter((s) => /checks\.sh/.test(s));
  assert.equal(runs.length, 1);
  assert.match(runs[0], new RegExp(`run: bash scripts/dev/checks\\.sh --only=node-test --shard=\\$\\{\\{ matrix\\.shard \\}\\}/${N}\\s*$`));
  assert.ok(jobs['node-tests'].includes(`name: node tests (\${{ matrix.shard }}/${N})`));
  const other = steps('other-checks').filter((s) => /checks\.sh/.test(s)).join('\n');
  assert.match(other, /^\s+bash scripts\/dev\/checks\.sh --skip-node\s*$/m, 'other-checks runs every other line');
  assert.doesNotMatch(other, /--only=/, 'and does not pick a subset');
  // no other job runs checks, and no job runs a check by hand beside the list
  for (const j of Object.keys(jobs)) if (!['node-tests', 'other-checks'].includes(j)) assert.doesNotMatch(jobs[j], /checks\.sh|node --test|python3? scripts\//, j);
  for (const j of ['node-tests', 'other-checks']) assert.doesNotMatch(jobs[j], /node --test|python3? scripts\//, `${j} runs checks only through checks.sh`);
  for (const j of ['node-tests', 'other-checks']) assert.match(jobs[j], /node-version: '22'/, `${j}: Node 22`);
});

test('the browser tests find Playwright and Chromium under the names they read, and a browser that cannot launch fails the job', () => {
  const tests = fs.readdirSync(path.join(root, 'test')).filter((f) => f.endsWith('.mjs')).map((f) => read(`test/${f}`));
  const browser = tests.filter((t) => /process\.env\.CHROMIUM_PATH/.test(t));
  assert.ok(browser.length > 50, `${browser.length} browser tests`);
  for (const t of browser) assert.match(t, /process\.env\.PLAYWRIGHT_PATH|from ['"]playwright['"]/);
  const s = steps('node-tests');
  const install = s.findIndex((x) => /playwright" install --with-deps chromium/.test(x));
  const launch = s.findIndex((x) => /chromium\.launch\(\{ executablePath: process\.env\.CHROMIUM_PATH \}\)/.test(x));
  const run = s.findIndex((x) => /checks\.sh/.test(x));
  assert.ok(install >= 0 && launch > install && run > launch, 'install, then launch, then the tests');
  for (const v of ['PLAYWRIGHT_PATH', 'CHROMIUM_PATH', 'JSQR_PATH']) assert.match(s[install], new RegExp(`echo "${v}=`), v);
  assert.match(s[install], /\[ -x "\$CH" \] \|\| \{ echo "::error::/, 'no binary is an error, not a skip');
  assert.match(code, /path: ~\/\.cache\/ms-playwright\n\s+key: pw-chromium-\$\{\{ runner\.os \}\}-\$\{\{ env\.PW_VERSION \}\}/, 'the browser is cached per Playwright version');
});

test('the FSA files are pulled before the checks in every job that runs them, with the key at step level', () => {
  for (const j of ['node-tests', 'other-checks']) {
    const s = steps(j);
    const pull = s.findIndex((x) => /run: bash scripts\/pull_raw\.sh data\/fsa\s*$/.test(x));
    const run = s.findIndex((x) => /checks\.sh/.test(x));
    assert.ok(pull >= 0 && pull < run, `${j}: pull before the checks`);
    assert.match(s[pull], /\n        env:\n          PRIVATE_REPO_TOKEN: \$\{\{ secrets\.PRIVATE_REPO_TOKEN \}\}\n/);
    assert.equal(s.filter((x) => /PRIVATE_REPO_TOKEN: /.test(x)).length, 1, `${j}: the key reaches the pull step only`);
  }
});

test('"all checks" is red unless every other job is green', () => {
  const a = jobs['all-checks'];
  assert.ok(a, 'all-checks job');
  assert.match(a, /name: all checks\n/);
  assert.match(a, /if: always\(\)/, 'it reports even when a job failed or was skipped');
  const needs = a.match(/needs: \[([^\]]+)\]/)[1].split(',').map((s) => s.trim()).sort();
  assert.deepEqual(needs, Object.keys(jobs).filter((j) => j !== 'all-checks').sort(), 'it needs every other job');
  for (const j of needs) assert.ok(a.includes(`\${{ needs.${j}.result }}`), j);
  assert.match(a, /\[ "\$NODE_TESTS" = success \] && \[ "\$OTHER_CHECKS" = success \]/, 'success only, not skipped or cancelled');
});

test('the workflow: pull requests to main and by hand, no schedule, contents: read, superseded runs cancelled, actions pinned', () => {
  assert.match(code, /^on:\n  pull_request:\n    branches: \[main\]\n  workflow_dispatch:\n\n/m);
  assert.doesNotMatch(code, /schedule:|cron:/, 'no new timer without Sig');
  assert.doesNotMatch(code, /pull_request_target/, 'never runs a fork\'s code with secrets');
  assert.match(code, /^permissions:\n  contents: read\n\n/m);
  assert.equal((code.match(/permissions:/g) || []).length, 1, 'no job widens it');
  assert.match(code, /^concurrency:\n  group: pr-checks-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n  cancel-in-progress: true\n/m);
  const uses = [...code.matchAll(/uses: (\S+)/g)].map((m) => m[1]).filter((u) => !u.startsWith('./'));
  assert.ok(uses.length >= 8);
  for (const u of uses) assert.match(u, /^[\w-]+\/[\w/-]+@[0-9a-f]{40}$/, `${u} is pinned to a commit`);
  for (const j of ['node-tests', 'other-checks']) assert.match(steps(j)[0], /persist-credentials: false/, `${j}: no token left in .git/config`);
});

// scripts/dev/quick.sh: the build-time subset. It picks by rule and says why; it never claims to be a ship check.
test('quick.sh --dry-run: the core, tests that name a changed file, selftests, the worker test, each with a reason', () => {
  const q = (...f) => { const r = spawnSync('bash', ['scripts/dev/quick.sh', '--dry-run', ...f], { cwd: root, encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
  const core = q(`no/such/x${process.pid}y${Date.now()}.none`);
  for (const t of ['test/engine.test.mjs', 'test/ses-ready.test.mjs', 'test/email-links.test.mjs']) assert.match(core, new RegExp(`^  ${t.replace(/[./]/g, '\\$&')} +core$`, 'm'));
  assert.match(core, /^  nav +core$/m);
  assert.doesNotMatch(core, /names |selftest|worker/);
  const w = q('workers/subs-worker.js');
  assert.match(w, /^  worker +workers\/subs-worker\.js changed$/m);
  assert.match(w, /^  test\/\S+ +names subs-worker\.js$/m);
  const py = q('scripts/build_ids.py');
  assert.match(py, /^  scripts\/build_ids\.py +changed, has --selftest$/m);
  assert.match(py, /^  ids +checks\.sh line runs build_ids\.py$/m);
  assert.match(py, /^  test\/ids\.test\.mjs +names build_ids\.py$/m);
  const self = q('test/pr-checks.test.mjs');
  assert.match(self, /^  test\/pr-checks\.test\.mjs +changed$/m);
  assert.match(read('scripts/dev/quick.sh'), /open the PR and wait for pr-checks/);
});

test('the node test shards fail on a skipped test, not only on a failed one (Sig, Oct 22: a skip is not a pass)', () => {
  const run = steps('node-tests').find((s) => /checks\.sh --only=node-test/.test(s));
  assert.ok(run, 'the shard step');
  assert.match(run, /^\s+AGSIST_NO_SKIPS: '1'\s*$/m, 'the shard step sets AGSIST_NO_SKIPS=1');
  const line = read('scripts/dev/checks.sh').split('\n').find((l) => l.startsWith('run node-test '));
  assert.match(line, /AGSIST_NO_SKIPS/, 'checks.sh node-test reads it');
  assert.match(line, /\^# skipped 0\$/, 'and wants "# skipped 0" when it is set');
  // the real thing: a test file that skips fails the line with the variable set, passes without it
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'noskip-'));
  fs.writeFileSync(path.join(dir, 'a.test.mjs'), "import { test } from 'node:test'; test('runs', () => {}); test('needs a tool', (t) => t.skip('not here'));\n");
  // run that one line as checks.sh would, with run() reduced to "run the command"
  const run2 = (env) => spawnSync('bash', ['-c', `NT='${path.join(dir, 'nt.out')}'; SHARD=; run(){ shift; "$@"; }\n${line}`], { cwd: dir, encoding: 'utf8', env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), ...env } });
  assert.equal(run2({ AGSIST_NO_SKIPS: '' }).status, 0, 'a skip passes locally without the variable');
  const r = run2({ AGSIST_NO_SKIPS: '1' });
  assert.equal(r.status, 1, 'and fails with it');
  assert.match(r.stdout, /needs a tool # SKIP/, 'naming the skipped test');
});
