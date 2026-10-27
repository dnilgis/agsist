// The weekly re-test engine (god's-eye panel build 3, task 25; Sig, Oct 27 2026: "yes to all").
// scripts/insight_engine.py re-runs every spec in scripts/insight_registry.json and appends the
// results to the private-data branch; scripts/insight_engine.sh runs it in Actions. These checks
// pin: the selftest (placebo and Holm on synthetic data with known answers, the gate, the ledger
// on disk), the registry rules, no schedule of its own (it rides the morning report gate), the
// private branch only, and nothing on Pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('insight_engine.py selftest passes (synthetic data, known answers, no network)', () => {
  const r = spawnSync('python3', ['scripts/insight_engine.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /insight_engine selftest: 0 failure\(s\)/);
  assert.doesNotMatch(r.stdout, /^\s+FAIL /m);
  for (const name of ['Holm: 0.005, 0.01, 0.03, 0.04 -> 0.02, 0.03, 0.06, 0.06', 'a planted lead is found',
    'no relationship: placebo p under 0.05', 'planted contagion is found', 'no contagion: placebo p above 0.05',
    'holdout window still open: WAIT', 'a spec edited after its first result: ERROR',
    'the change-time ledger absent: the run goes on', 'a second run the same day refuses']) {
    assert.ok(r.stdout.includes(name), `selftest covers: ${name}`);
  }
});

test('the registry: append-only rules hold, every spec pre-registered in full, no yes from Sig yet', () => {
  const r = spawnSync('python3', ['scripts/insight_engine.py', 'check-registry'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const reg = JSON.parse(read('scripts/insight_registry.json'));
  assert.equal(reg.schema, 'agsist-insight-registry/1');
  assert.ok(reg.ledger_prior.count >= 150, 'the tests spent before the registry still count');
  const ids = reg.specs.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of reg.specs) {
    for (const k of ['x', 'y', 'grain', 'holdout', 'family', 'expected_sign', 'benchmark', 'placebo', 'else_explains']) {
      assert.ok(s[k] !== undefined && s[k] !== '', `${s.id} has ${k}`);
    }
    assert.equal(s.sig_yes, null, `${s.id}: only Sig sets sig_yes`);
  }
  const fams = new Set(reg.specs.map((s) => s.family));
  assert.ok(fams.has('contagion') && fams.has('ratings-to-yield'));
  assert.ok(reg.specs.filter((s) => s.family === 'ratings-to-yield').length >= 3, 'every ratings week in one family');
});

test('rides the morning report gate: no schedule of its own, never holds up the email', () => {
  const y = read('.github/workflows/morning-report.yml');
  const i = y.indexOf('\n  insight-retest:');
  assert.ok(i > 0, 'morning-report.yml has the insight-retest job');
  const job = y.slice(i);
  assert.match(job, /needs: gate\n\s+if: needs\.gate\.outputs\.go == '1' && inputs\.dry_run != true/);
  assert.doesNotMatch(job, /needs: \[?gate, report|needs: report/, 'beside the email, not after it');
  assert.match(job, /continue-on-error: true/);
  assert.match(job, /- uses: actions\/checkout@v4[\s\S]*?\n\s+- name: Engine checkout\n\s+uses: \.\/\.github\/actions\/engine/);
  assert.match(job, /bash scripts\/insight_engine\.sh \|\| echo "::warning::/);
  assert.match(job, /numpy==\d+\.\d+\.\d+/, 'numpy pinned');
  for (const f of fs.readdirSync(path.join(root, '.github/workflows'))) {
    if (f === 'morning-report.yml') continue;
    assert.doesNotMatch(read(`.github/workflows/${f}`), /insight_engine/, `${f}: the engine runs from the morning report job only`);
  }
  const rep = y.slice(y.indexOf('\n  report:'), y.indexOf('\n  change-ledger:'));
  assert.match(rep, /RAW_BRANCH: private-data\n\s+RAW_SOFT: '1'\n\s+run: bash scripts\/pull_raw\.sh private\/ledger\/tests\/latest\.json/);
});

test('the run script: private-data for the ledger, inputs soft, saves only the ledger folder', () => {
  const s = read('scripts/insight_engine.sh');
  assert.match(s, /RAW_BRANCH=private-data bash scripts\/pull_raw\.sh "\$LEDGER"/);
  assert.match(s, /could not read the private-data branch; not starting"; exit 1/);
  assert.match(s, /RAW_BRANCH=private-data RAW_SOFT=1 bash scripts\/pull_raw\.sh private\/ledger\/bid-changes \|\| true/);
  assert.match(s, /RAW_BRANCH=private-data RAW_SOFT=1 bash scripts\/push_raw\.sh "re-test engine results" "\$LEDGER"/);
  assert.match(s, /insight_engine\.py due[\s\S]{0,80}\n\s*if \[ "\$due" -eq 3 \]; then exit 0; fi/);
  assert.doesNotMatch(s, /git push|origin main|holds\.json|data\/insight/, 'never pushes main or writes a page file');
  assert.match(read('scripts/insight_engine.py'), /^LEDGER_DIR = "private\/ledger\/tests"$/m);
});

test('nothing the engine writes reaches main or Pages, and it publishes nothing', () => {
  const ignored = (p) => spawnSync('git', ['check-ignore', '-q', '--no-index', p], { cwd: root }).status === 0;
  for (const p of ['private/ledger/tests/results/2026/2026-11-01.jsonl', 'private/ledger/tests/latest.json',
    'history/agtransport/barge_rates/2024.csv.gz']) {
    assert.ok(ignored(p), `${p} is ignored on main`);
  }
  const py = read('scripts/insight_engine.py');
  assert.doesNotMatch(py, /holds\.json|data\/insight|urlopen|requests\./, 'no page file, no network');
  assert.match(py, /open\(p, "x", encoding="utf-8"\)/, 'a day file is created once, never overwritten');
});
