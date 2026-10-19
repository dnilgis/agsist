// Daily cash bid snapshots on the raw branch (Bet 7, Sig 2026-10-19).
// fetch_bids.yml saves one compact snapshot a trading day (first run at or
// after 15:00 CT) with scripts/push_raw.sh, after the bids are committed, and
// the save can never fail the job. The full-file-only "_" fields it reads
// (board id, posted time, futures price) never reach data/bids.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const yml = read('.github/workflows/fetch_bids.yml');

function step(name) {
  const i = yml.indexOf(`- name: ${name}`);
  assert.ok(i >= 0, `fetch_bids.yml has the step "${name}"`);
  const rest = yml.slice(i + 1);
  const j = rest.search(/\n      - name: /);
  return j < 0 ? rest : rest.slice(0, j);
}

test('bid_snapshots.py selftest passes', () => {
  const r = spawnSync('python3', ['scripts/bid_snapshots.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /selftest: 0 failure\(s\)/);
});

test('the snapshot is saved after the bids commit, once a day, and never fails the run', () => {
  const s = step('Daily bid snapshot to the raw branch');
  assert.ok(yml.indexOf('- name: Commit and push') < yml.indexOf('- name: Daily bid snapshot to the raw branch'), 'after the commit');
  assert.match(s, /continue-on-error: true/);
  assert.match(s, /if: github\.event\.inputs\.dry_run != 'true'/);
  assert.match(s, /python3 scripts\/bid_snapshots\.py due/, 'only inside the daily window');
  assert.match(s, /contents\/\$f\?ref=raw/, 'skips a day already on raw');
  assert.match(s, /build --from bids-full\.json/, 'built from the full set, not the slim file');
  assert.match(s, /bash scripts\/push_raw\.sh "bid snapshot \$day" "\$f" \\\n\s+\|\| echo "::warning::/, 'push failure is a warning');
  assert.match(s, /bids-daily\/\$\{day:0:4\}\/\$\{day\}\.json\.gz/);
  assert.match(yml, /bid_snapshot:\n\s+description:/, 'a manual run can take (and replace) the day');
});

test('the snapshot never reaches main, and the slim file drops the "_" fields', () => {
  assert.match(read('.gitignore'), /^\/bids-daily\/$/m);
  const fb = read('scripts/fetch_bids.py');
  assert.match(fb, /output\["bids"\] = slim_dump_rows\(slim\)/);
  assert.match(fb, /"_board": b\.get\("source"\)/);
});
