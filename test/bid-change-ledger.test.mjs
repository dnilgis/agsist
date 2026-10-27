// The bid change-time ledger (god's-eye panel build 1; Sig, Oct 27 2026: "yes to all").
// scripts/bid_change_ledger.py walks dnilgis/bids git history and dates every bid change
// between two consecutive good reads of its board; scripts/bid_change_ledger.sh runs it in
// Actions and saves to the private repo only. These checks pin: the selftest (a real git
// fixture: windows, partial reads, futures-only moves, whole days, resume, rebuilt
// snapshots), no schedule of its own, the private branches only, and nothing on Pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const noComments = (s) => s.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

test('bid_change_ledger.py selftest passes (git fixture, no network)', () => {
  const r = spawnSync('python3', ['scripts/bid_change_ledger.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /bid_change_ledger selftest: 0 failure\(s\)/);
  assert.doesNotMatch(r.stdout, /^FAIL /m);
});

test('bid-change-ledger.yml is dispatch only, one run at a time, Engine checkout right after the checkout', () => {
  const y = noComments(read('.github/workflows/bid-change-ledger.yml'));
  assert.match(y, /on:\n\s+workflow_dispatch:/);
  assert.doesNotMatch(y, /schedule:|cron:|workflow_run:|\bpush:|pull_request:|repository_dispatch:/);
  assert.match(y, /concurrency:\n\s+group: bid-change-ledger\n\s+cancel-in-progress: false/);
  assert.match(y, /- uses: actions\/checkout@v4[\s\S]*?\n\s+- name: Engine checkout\n\s+uses: \.\/\.github\/actions\/engine/);
  assert.match(y, /bash scripts\/bid_change_ledger\.sh/);
  assert.match(y, /RAW_SOFT: '1'/);
});

test('the nightly days ride the morning report gate: no schedule of their own, never hold up the email', () => {
  const y = read('.github/workflows/morning-report.yml');
  const i = y.indexOf('\n  change-ledger:');
  assert.ok(i > 0, 'morning-report.yml has the change-ledger job');
  const job = y.slice(i);
  assert.match(job, /needs: gate\n\s+if: needs\.gate\.outputs\.go == '1' && inputs\.dry_run != true/);
  assert.doesNotMatch(job, /needs: \[?gate, report|needs: report/, 'beside the email, not after it');
  assert.match(job, /continue-on-error: true/);
  assert.match(job, /group: bid-change-ledger/, 'never alongside the backfill');
  assert.match(job, /NIGHTLY: '1'/);
  assert.match(job, /bash scripts\/bid_change_ledger\.sh \|\| echo "::warning::/);
});

test('the run script: private branches only, blobless clone, whole days, the nightly run never starts the backfill', () => {
  const s = read('scripts/bid_change_ledger.sh');
  assert.match(s, /RAW_BRANCH=private-data bash scripts\/pull_raw\.sh "\$STATE"/);
  assert.match(s, /RAW_BRANCH=private-data RAW_SOFT=1 bash scripts\/push_raw\.sh "bid change ledger" "\$LEDGER"/);
  assert.match(s, /RAW_BRANCH=raw RAW_SOFT=1 bash scripts\/push_raw\.sh "bid snapshots rebuilt from bids history" bids-daily/);
  assert.match(s, /git clone -q --filter=blob:none --no-checkout/);
  assert.match(s, /--until-ct-midnight --fetch-blobs/);
  assert.match(s, /if \[ "\$\{NIGHTLY:-\}" = 1 \]; then[\s\S]{0,200}exit 0/);
  assert.match(s, /could not read the private-data branch; not starting"; exit 1/);
  assert.doesNotMatch(s, /git push|origin main|data\/bids/, 'never pushes main or touches the site data');
  assert.match(read('scripts/bid_change_ledger.py'), /^OUT_DIR = "private\/ledger\/bid-changes"$/m);
});

test('the ledger and the rebuilt snapshots never reach main or Pages', () => {
  const ignored = (p) => spawnSync('git', ['check-ignore', '-q', '--no-index', p], { cwd: root }).status === 0;
  for (const p of ['private/ledger/bid-changes/2026/2026-10-21.json.gz', 'private/ledger/bid-changes/state.json.gz',
    'bids-daily/2026/2026-08-27.json.gz']) {
    assert.ok(ignored(p), `${p} is ignored on main`);
  }
});

test('never fetches the big non-board files (merged-all.json, directory.json, data/merged/)', () => {
  const py = read('scripts/bid_change_ledger.py');
  assert.match(py, /^PATHSPEC = ":\(glob\)data\/\*\.json"$/m, 'top-level data/*.json only');
  for (const name of ['index', 'directory', 'merged-all', 'merged-index', 'coverage']) {
    assert.match(py, new RegExp(`"${name}"`), `${name}.json is not a board`);
  }
});
