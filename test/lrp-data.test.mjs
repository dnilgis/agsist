// LRP data (scripts/fetch_lrp.py, .github/workflows/lrp.yml). The parser is
// checked against real rows cut from RMA's ADM livestock files
// (test/fixtures/lrp/, from the probe of 2026-10-15): every state must carry
// the same offer, numbers are kept exactly, actual ending values stay per
// reinsurance year, and the full history never lands in the published tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('fetch_lrp selftest passes on the real RMA rows', () => {
  const out = execFileSync('python3', [path.join(root, 'scripts/fetch_lrp.py'), '--selftest'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(out, /fetch_lrp selftest: ok/);
});

test('the fixtures stay small', () => {
  const dir = path.join(root, 'test/fixtures/lrp');
  const files = fs.readdirSync(dir);
  assert.ok(files.length >= 4);
  for (const f of files) {
    assert.ok(fs.statSync(path.join(dir, f)).size < 8 * 1024, `${f} is over 8 KB`);
  }
});

test('raw captures and the history stay off the published tree', () => {
  assert.ok(!fs.existsSync(path.join(root, 'data/lrp-raw')), 'data/lrp-raw is not on main');
  const wf = fs.readFileSync(path.join(root, '.github/workflows/lrp.yml'), 'utf8');
  assert.match(wf, /HIST: \$\{\{ github\.workspace \}\}\/\.\.\/lrp-history/, 'history checkout outside the repo');
  assert.match(wf, /git push -q origin HEAD:lrp-history/);
  assert.match(wf, /P=data\/lrp; /, 'main only gets data/lrp');
  assert.doesNotMatch(wf, /--probe/, 'the probe is not run from the workflow');
  assert.doesNotMatch(wf, /^\s+schedule:/m, 'no schedule until the history is checked');
});
