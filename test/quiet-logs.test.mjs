// Quiet Actions logs (Nov 5, 2026: the repository and its logs are public). scripts/dev/quiet.py runs a
// command and prints only "<name>: ok" or "<name>: failed (exit N), <last line>" plus allow-listed lines
// (DELIVERY, SEND-CAP, ::warning:: and ::error::, marker count lines); the full output stays on the runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Q = 'scripts/dev/quiet.py';

test('the wrapper selftest passes', () => {
  const r = spawnSync('python3', [Q, '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /all quiet checks passed/);
});

test('it keeps the exit code and the allow-listed lines, and prints nothing else', () => {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'quiet-'));
  const env = { ...process.env, QUIET_LOG_DIR: tmp };
  delete env.QUIET_OFF;
  const script = [
    'echo "IA 19055: skipping a station (0.00 for 8 days)"',
    'echo "DELIVERY sender=land-alert sent_readers=4 waiting=0 dry=0"',
    'echo "::warning::one state failed"',
    'echo "::error::the page build refused"',
    'echo "COUNTS pages=12 states=3"',
    'echo "  ok   a test name that says how" 1>&2',
    'echo "SEND-CAP sender=daily kind=preflight sent=10"',
    'echo "the last line"',
    'exit 5',
  ].join('\n');
  const r = spawnSync('python3', [Q, 'demo', '--', 'bash', '-c', script], { cwd: root, encoding: 'utf8', env });
  assert.equal(r.status, 5, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
  assert.deepEqual(r.stdout.trimEnd().split('\n'), [
    'DELIVERY sender=land-alert sent_readers=4 waiting=0 dry=0',
    '::warning::one state failed',
    '::error::the page build refused',
    'COUNTS pages=12 states=3',
    'SEND-CAP sender=daily kind=preflight sent=10',
    'demo: failed (exit 5), the last line',
  ]);
  const log = fs.readFileSync(path.join(tmp, 'demo.log'), 'utf8');
  assert.match(log, /skipping a station/);
  assert.match(log, /a test name that says how/);
  const ok = spawnSync('python3', [Q, 'demo2', '--', 'bash', '-c', 'echo detail; echo more detail'], { cwd: root, encoding: 'utf8', env });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, 'demo2: ok\n');
  const bad = spawnSync('python3', [Q, 'demo3'], { cwd: root, encoding: 'utf8', env });
  assert.equal(bad.status, 2);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// The five workflows whose logs printed the most method detail. Every selftest and builder line in them
// runs through the wrapper, and no wrapped command has its stdout redirected (the wrapper prints there).
const WRAPPED = ['land-data.yml', 'county-rain.yml', 'fetch_bids.yml', 'sponsor-report.yml', 'croptour.yml'];

test('the noisiest workflows run their selftests and builders through the wrapper', () => {
  for (const f of WRAPPED) {
    const y = fs.readFileSync(path.join(root, '.github/workflows', f), 'utf8');
    const lines = y.split('\n').filter((l) => !l.trim().startsWith('#'));
    const wrapped = lines.filter((l) => l.includes(Q));
    assert.ok(wrapped.length >= 5, `${f}: only ${wrapped.length} wrapped lines`);
    for (const l of lines) {
      if (/\bpython3? scripts\/\S+\.py --selftest\b/.test(l)) assert.ok(l.includes(Q), `${f}: a selftest prints in the public log: ${l.trim()}`);
    }
    for (const l of wrapped) {
      const after = l.slice(l.indexOf(Q));
      assert.doesNotMatch(after.split('||')[0], /(^|\s)\d?>{1,2}\s*\S|\|\s*(tee|tail|head)\b/, `${f}: a wrapped command's output is redirected: ${l.trim()}`);
      assert.match(after, /^scripts\/dev\/quiet\.py [a-z0-9-]+ -- /, `${f}: ${l.trim()}`);
    }
  }
});

test('the full logs stay on the runner: nothing uploads or commits the quiet folder', () => {
  for (const f of WRAPPED) {
    const y = fs.readFileSync(path.join(root, '.github/workflows', f), 'utf8');
    assert.doesNotMatch(y, /upload-artifact[\s\S]{0,400}quiet/, `${f} uploads the quiet logs`);
    assert.doesNotMatch(y, /git add[^\n]*(quiet|county-rain\.log)/, `${f} commits a full log`);
  }
});
