// Private basis forecast ledger (2026-10-28). fetch_bids.yml freezes the day's basis
// forecasts right after the day's snapshot is on raw, in the same job (no new schedule),
// saves them to the private raw branch with scripts/push_raw.sh, and can never fail the
// run. Nothing reaches main or the site: Sig decides when the record is shown.
// The rules themselves (frozen calls, missing targets ungraded, replay apart from live,
// conflicts dropped, no look-ahead) are pinned by scripts/basis_ledger.py --selftest.
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

test('basis_ledger.py selftest passes, with every rule it pins', () => {
  const r = spawnSync('python3', ['scripts/basis_ledger.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /selftest: 0 failure\(s\)/);
  const oks = (r.stdout.match(/^ok {3}/gm) || []).length;
  assert.ok(oks >= 50, `only ${oks} checks ran; the selftest lost cases`);
  for (const must of [
    /^ok {3}a frozen call file is never rewritten with different content$/m,
    /^ok {3}a target day with no snapshot stays ungraded$/m,
    /^ok {3}a series missing from the target day stays ungraded$/m,
    /^ok {3}replay goes to its own folder$/m,
    /^ok {3}a replay file in the live folder is refused$/m,
    /^ok {3}a later snapshot cannot change a call made earlier$/m,
    /^ok {3}a conflicting key is dropped and counted, never picked$/m,
    /^ok {3}real rows: /m,
  ]) assert.match(r.stdout, must);
});

test('the ledger runs in the bids job after the snapshot, once a day, and never fails the run', () => {
  const s = step('Basis forecast ledger to the raw branch');
  const at = (n) => yml.indexOf(`- name: ${n}`);
  assert.ok(at('Daily bid snapshot to the raw branch') < at('Basis forecast ledger to the raw branch'), 'after the snapshot');
  assert.match(s, /continue-on-error: true/);
  assert.match(s, /if: github\.event\.inputs\.dry_run != 'true'/);
  assert.match(s, /RAW_SOFT: '1'/);
  assert.match(s, /python3 scripts\/bid_snapshots\.py due/, 'only inside the daily window');
  assert.match(s, /have "\$f" && \{ echo "basis ledger: \$f is already on raw"; exit 0; \}/, 'one run a day');
  assert.match(s, /have "\$snap" \|\|/, 'waits for the day\'s snapshot on raw');
  assert.match(s, /basis_ledger\.py run --live-day "\$day" --ref origin\/raw/);
  assert.match(s, /bash scripts\/push_raw\.sh "basis ledger \$day" basis-ledger \\\n\s+\|\| echo "::warning::/, 'push failure is a warning');
  // no new schedule: the job's triggers are what they were
  assert.doesNotMatch(s, /cron/);
});

test('the ledger never reaches main or the site', () => {
  assert.match(read('.gitignore'), /^\/basis-ledger\/$/m);
  const py = read('scripts/basis_ledger.py');
  assert.match(py, /OUT = "basis-ledger"/);
  assert.doesNotMatch(py, /["']data\//, 'writes nothing under data/ (main)');
  for (const f of fs.readdirSync(root).filter((x) => x.endsWith('.html'))) {
    assert.ok(!read(f).includes('basis-ledger'), `${f} reads the private ledger`);
  }
});
