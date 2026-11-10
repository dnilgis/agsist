/**
 * River key (Sig, Nov 9 2026): each elevator with a street-placed point is a river terminal (a USACE grain
 * dock within 0.5 mile), near (a National Waterway Network line within 10 miles) or inland; a town or county
 * centre point is unsure, never guessed. The inputs come from a one-time pull (river-pull.yml, dispatch only)
 * saved to the private raw branch, so the site does not grow.
 *
 * Fixtures (test/fixtures/river): real boards copied from data/ids/elevators.json and the bids repo directory
 * on Nov 9: Illinois River terminals (Havana, Lacon, Hennepin), Mississippi River terminals (Burlington,
 * Winona, Cairo), an Illinois River board with no grain dock in the fixture (Creve Coeur: near), two town
 * points beside the river (Havana Cargill, Hardin: unsure) and inland boards (Tolono, Champaign, Tuscola,
 * Nevada IA). The fixture docks beside the terminals are placed by hand and say so; the La Grange MO dock is
 * the one real USACE dock row we hold. The river lines are rough courses through the river towns.
 *   node --test test/river-key.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const FIX = 'test/fixtures/river';
const py = (args) => spawnSync('python3', args, { cwd: root, encoding: 'utf8' });

test('both scripts pass their selftests', () => {
  for (const s of ['scripts/fetch_river.py', 'scripts/river_key.py']) {
    const r = py([s, '--selftest']);
    assert.equal(r.status, 0, s + ': ' + r.stdout + r.stderr);
  }
});

test('real Illinois and Mississippi River terminals, a river board without a dock, town points and inland boards', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'river-key-'));
  const out = path.join(dir, 'river.json');
  try {
    const r = py(['scripts/river_key.py', '--river-dir', FIX, '--bids-dir', `${FIX}/bids`,
      '--elevators', `${FIX}/elevators.json`, '--out', out]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
    const want = {
      terminal: ['eb7vhtjz7n', 'ej8re5fxpt', 'e4nyfacaf8', 'es6mcndxfs', 'ea2szt0mc0', 'egdaqern6p', 'er3a6bgdh9', 'e6xmtjmw7j'],
      near: ['evvtekpwh1'],
      unsure: ['e0f6f4jd63', 'eh7q2e9ev0'],
      inland: ['e0jpfbvn1q', 'e9db7c07p8', 'e9bmh9n9p4', 'emknz275z3'],
    };
    for (const [c, ids] of Object.entries(want)) {
      for (const id of ids) assert.equal(doc.river[id]?.class, c, `${id}: ${JSON.stringify(doc.river[id])}`);
    }
    assert.equal(doc.river.a00001, undefined, 'a facility with no point is left out');
    assert.deepEqual(doc.counts, { terminal: 8, near: 1, inland: 4, unsure: 2, no_point: 1 });
    // a town point gets a reason and no distance, even with a dock 0.1 mile from it
    assert.deepEqual(doc.river.e0f6f4jd63, { class: 'unsure', why: 'the point is the town centre, not the site' });
    for (const id of want.terminal) assert.ok(doc.river[id].dock_mi <= 0.5, id);
    for (const id of want.inland) assert.ok(doc.river[id].water_mi > 10, id);
    assert.ok(doc.river.evvtekpwh1.dock_mi > 0.5 && doc.river.evvtekpwh1.water_mi <= 10);
    assert.equal(doc.rule, 'river-key/1');
    assert.equal(doc.sources.docks.source_date, '2026-10-28');
    assert.equal(doc.sources.waterways.source_date, '2026-11-09');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no river inputs on disk: nothing written, exit 0 (the last river key stays)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'river-key-none-'));
  const out = path.join(dir, 'river.json');
  try {
    const r = py(['scripts/river_key.py', '--river-dir', dir, '--bids-dir', `${FIX}/bids`,
      '--elevators', `${FIX}/elevators.json`, '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(out));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('river-pull.yml: dispatch only, read-only token, saves to the raw branch with the private-repo key', () => {
  const y = read('.github/workflows/river-pull.yml');
  const on = y.slice(y.indexOf('\non:'), y.indexOf('\npermissions:'));
  assert.match(on, /workflow_dispatch:/);
  assert.doesNotMatch(y, /^\s*(schedule|cron|push|pull_request|workflow_run):/m, 'no schedule or other trigger');
  assert.match(y, /^permissions:\n  contents: read$/m);
  assert.match(y, /persist-credentials: false/);
  assert.match(y, /scripts\/push_raw\.sh "[^"]+" river\b/);
  assert.match(y, /PRIVATE_REPO_TOKEN: \$\{\{ secrets\.PRIVATE_REPO_TOKEN \}\}\n\s+run: bash scripts\/push_raw\.sh/);
  assert.match(read('.gitignore'), /^\/river\/$/m, 'the pulled files are never committed to main');
});

test('the bids job rebuilds the river key from the raw copy and commits only data/ids/river.json', () => {
  const y = read('.github/workflows/fetch_bids.yml');
  const step = y.slice(y.indexOf('- name: River key for the elevator ids'), y.indexOf('- name: Elevator contacts'));
  assert.match(step, /continue-on-error: true/);
  assert.match(step, /contents\/river\/\$f\.json\?ref=raw/);
  assert.match(step, /scripts\/river_key\.py --river-dir "\$r"/);
  assert.ok(y.indexOf('- name: Rebuild the elevator ids') < y.indexOf('- name: River key for the elevator ids'));
  assert.match(y, /\[ -f data\/ids\/river\.json \] && git add data\/ids\/river\.json \|\| true/);
});
