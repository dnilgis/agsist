// A change-log row with no state never writes a nameless sparkline file (Nov 4, 2026).
//
// The real case: data/basis/changes-2026-08-03.json holds one row with an empty state
// (HILLSIDE GRAIN, LLC | GOLDEN CITY, MO, soybeans ZSX26). scripts/build_basis_sparklines.py wrote
// f"{state}.json", so every bids run rewrote data/basis-sparklines/.json, a file no page can ask for,
// and it rode along in about 3,182 commits. The builder now reads the state from the city field the
// way build_basis_history.py does (row_state), skips a row with nothing to read, and refuses to
// write any file that is not a two-letter state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the sparkline builder selftest: a blank state is read from the city field or skipped, never written', () => {
  const out = execFileSync('python3', ['scripts/build_basis_sparklines.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /blank state read from the city field \(MO\), 2 stateless rows skipped, no nameless file/);
});

test('a tracked sparkline file named for no state is one the builder removes on its next run', () => {
  // main carried data/basis-sparklines/.json until the first bids run after this fix; that run deletes it
  // (remove_strays) and the bids job's git add records the deletion. Deleting it in the pull request
  // instead conflicted with every 15-minute bids commit, so the checks never ran.
  const files = execFileSync('git', ['ls-files', '--', 'data/basis-sparklines'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 })
    .split('\n').filter(Boolean);
  const bad = files.filter((f) => !/^[A-Z]{2}\.json$/.test(path.basename(f)));
  for (const f of bad) {
    const d = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
    assert.ok(d && typeof d === 'object' && 'series' in d && 'units' in d, f + ' is not a sparkline payload the builder would remove');
  }
  const src = fs.readFileSync(path.join(root, 'scripts/build_basis_sparklines.py'), 'utf8');
  assert.match(src, /for path in remove_strays\(\):/, 'the builder removes strays after it writes');
  const job = fs.readFileSync(path.join(root, '.github/workflows/fetch_bids.yml'), 'utf8');
  assert.match(job, /git add [^\n]*data\/basis-sparklines(\s|$)/m, 'the bids job stages the folder, deletions included');
});

test('the history and sparkline builders share one rule for a row\'s state', () => {
  const out = execFileSync('python3', ['-c', [
    'import sys; sys.path.insert(0, "scripts")',
    'from build_basis_history import row_state as r',
    'print(r("", "GOLDEN CITY, MO"), r(None, "SOMEWHERE"), r("IA", "AMES, MO"), r(" ", "X, ZZ"))',
  ].join('\n')], { cwd: root, encoding: 'utf8' });
  assert.equal(out.trim(), 'MO None IA None');
});
