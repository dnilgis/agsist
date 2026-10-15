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
});

// The schedule came once the full history was in (6,922 files, every check
// passed, 2026-10-15). What runs on it is only the watch: a look at the
// listings, and the incremental read of the open years when a file is new.
test('the scheduled path only watches, and reads only the open years', () => {
  const wf = fs.readFileSync(path.join(root, '.github/workflows/lrp.yml'), 'utf8');
  assert.match(wf, /workflow_run:\s*\n\s*workflows: \["Fetch Grain Bids"\]/, 'clocked by Fetch Grain Bids');
  assert.match(wf, /scripts\/cron_gate\.py lrp --lrp-file data\/lrp\/today\.json/, 'gated on today\'s offers');
  const watch = wf.slice(wf.indexOf('\n  watch:'), wf.indexOf('\n  lrp:'));
  assert.ok(watch.length > 100, 'a watch job');
  assert.match(watch, /--watch "\$HIST"/);
  assert.doesNotMatch(watch, /--history|--publish/, 'a look never reads or publishes');
  assert.match(watch, /--filter=blob:none/, 'a look fetches no offer files from lrp-history');
  assert.match(wf, /IN_YEARS: \$\{\{ inputs\.years \|\| needs\.watch\.outputs\.years \}\}/,
    'a scheduled read covers only the years with a new file');
  for (const cron of wf.matchAll(/cron: '(\S+) (\S+) /g)) {
    assert.ok(!['0', '30'].includes(cron[1]), `cron off :00 and :30 (${cron[0]})`);
  }
});
