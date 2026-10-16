/**
 * Raw build inputs live on the `raw` branch, not main (2026-10-16).
 *
 * GitHub Pages publishes all of main. data/ was at 290 of its 300 MB budget,
 * and about 80 MB of it was raw inputs no page fetches: the Farmland Atlas
 * pulls (data/atlas/raw) and each workflow's probe captures. They moved to the
 * `raw` branch at the same paths; nothing was deleted (Sig: "don't throw away
 * anything important"). This keeps them from coming back to main, checks every
 * workflow that writes them saves them to raw instead, and runs
 * scripts/push_raw.sh and scripts/pull_raw.sh against a throwaway remote.
 *
 * Kept on main on purpose: data/fsa (build_arc_plc.py --check reads it in every
 * ship check), data/atlas/raw/drought.json (test/drought-county-week.test.mjs
 * reads it) and each probe's listing.json (the normal run reads it).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const MOVED = [
  'data/cattle-auction-raw', 'data/cattle-cash-raw', 'data/ccc-loan-raw', 'data/dairy-raw',
  'data/fall-nitrogen-raw', 'data/fert-ams-raw', 'data/hay-ams-raw', 'data/hay-raw', 'data/drought/probe',
];
const ATLAS_MOVED = ['heat', 'water', 'loss', 'sob', 'value', 'crp', 'energy', 'wells', 'practices',
  'climate', 'storms', 'livestock', 'frost', 'wells_states'];
const KEPT = ['data/atlas/raw/drought.json', 'data/cattle-auction-raw/listing.json', 'data/hay-ams-raw/listing.json'];

// workflow -> [raw folder, main FILES line]
const PROBES = {
  'cattle-auction': ['data/cattle-auction-raw', 'FILES="data/cattle-auction.json data/cattle-auction-raw/listing.json"'],
  'cattle-cash': ['data/cattle-cash-raw', 'FILES="data/cattle-cash.json"'],
  'ccc-loan': ['data/ccc-loan-raw', 'FILES="data/ccc-loan.json data/ccc-loan"'],
  'dairy': ['data/dairy-raw', 'FILES="data/dairy-data.json data/dairy-history.json data/dairy-mailbox.json"'],
  'fall-nitrogen': ['data/fall-nitrogen-raw', 'FILES="data/fall-nitrogen.json fall-nitrogen.html"'],
  'fertilizer-ams': ['data/fert-ams-raw', 'FILES="data/fertilizer-ams.json data/fertilizer-ams-history.json"'],
  'hay-ams': ['data/hay-ams-raw', 'FILES="data/hay/ams-hay.json data/hay-ams-raw/listing.json"'],
  'hay-prices': ['data/hay-raw', 'FILES="data/hay"'],
  'drought-county-week': ['data/drought/probe', 'FILES="data/drought/county-week.json"'],
};

const tracked = (p) => git(['ls-files', '--', p]).split('\n').filter(Boolean);

test('the moved raw inputs are not tracked on main (what is tracked is what Pages publishes)', () => {
  for (const d of MOVED) {
    const left = tracked(d).filter((f) => !KEPT.includes(f));
    assert.deepEqual(left, [], `${d} is back on main`);
  }
  const atlas = tracked('data/atlas/raw');
  assert.deepEqual(atlas, ['data/atlas/raw/drought.json'], 'only drought.json stays in data/atlas/raw on main');
});

test('.gitignore keeps them off main, and keeps the files main still needs', () => {
  const ignored = (p) => spawnSync('git', ['check-ignore', '-q', '--no-index', p], { cwd: root }).status === 0;
  for (const n of ATLAS_MOVED) assert.ok(ignored(`data/atlas/raw/${n}.json`), `data/atlas/raw/${n}.json ignored`);
  assert.ok(ignored('data/atlas/raw/some-new-layer.json'), 'a new Atlas pull is ignored too');
  for (const d of MOVED) assert.ok(ignored(`${d}/x.txt`), `${d}/ ignored`);
  for (const k of KEPT) assert.ok(!ignored(k), `${k} is not ignored`);
  assert.ok(!ignored('data/fsa/2026_PLC.xlsx'), 'data/fsa stays on main (build_arc_plc.py --check reads it)');
  assert.ok(tracked('data/fsa').length > 10, 'data/fsa still on main');
});

test('every probe saves its captures to the raw branch and commits only built outputs to main', () => {
  for (const [wf, [dir, files]] of Object.entries(PROBES)) {
    const y = read(`.github/workflows/${wf}.yml`);
    assert.ok(y.includes(files + '\n'), `${wf}: main gets ${files}`);
    const step = `        if: \${{ !cancelled() && github.event_name == 'workflow_dispatch' && inputs.probe }}\n` +
      `        run: bash scripts/push_raw.sh "${wf} probe" ${dir}\n`;
    assert.ok(y.includes(step), `${wf}: probe captures go to raw, even after a partial probe`);
    assert.ok(y.indexOf('push_raw.sh') > y.indexOf('--probe'), `${wf}: saved after the probe runs`);
    const fl = y.split('\n').find((l) => l.includes('FILES="'));
    assert.ok(!new RegExp(`${dir.replace(/[/-]/g, '\\$&')}(["\\s]|$)`).test(fl), `${wf}: the raw folder is not committed to main`);
  }
});

test('the Atlas unpacks its pulls from raw before any fetch and saves them back after the build', () => {
  const y = read('.github/workflows/farmland-atlas.yml');
  const pull = y.indexOf('bash scripts/pull_raw.sh data/atlas/raw');
  assert.ok(pull > 0);
  assert.ok(pull < y.indexOf('python scripts/fetch_atlas_heat.py\n'), 'pulled before the first fetch');
  assert.ok(pull < y.indexOf('python scripts/build_farmland_atlas.py --seed'), 'pulled before the build');
  for (const n of ['heat', 'water', 'loss', 'sob', 'value', 'crp', 'energy']) {
    assert.match(y, new RegExp(`for f in [a-z ]*\\b${n}\\b`), `the run stops if ${n}.json did not come back`);
  }
  const push = y.indexOf('bash scripts/push_raw.sh "farmland atlas raw"');
  assert.ok(push > y.indexOf('python scripts/build_farmland_atlas.py --seed'), 'saved after the build');
  assert.match(y, /if: \$\{\{ !cancelled\(\) \}\}\n\s+run: bash scripts\/push_raw\.sh "farmland atlas raw" \$\(ls data\/atlas\/raw\/\*\.json \| grep -v '\/drought\\\.json\$'\)/,
    'saved even when the build fails; drought.json stays on main only');
  assert.match(y, /git add -A data\/atlas farmland-atlas\.html/, 'main commit unchanged; .gitignore keeps the pulls out');
});

// ---------------------------------------------------------------- the scripts, end to end

function sandbox() {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'rawbr-'));
  const g = (args, cwd) => git(['-c', 'user.name=t', '-c', 'user.email=t@x', '-c', 'init.defaultBranch=main', ...args], cwd);
  g(['init', '-q', '--bare', 'origin.git'], t);
  const w = path.join(t, 'work');
  g(['init', '-q', 'work'], t);
  fs.mkdirSync(path.join(w, 'scripts'));
  for (const s of ['push_raw.sh', 'pull_raw.sh']) fs.copyFileSync(path.join(root, 'scripts', s), path.join(w, 'scripts', s));
  fs.writeFileSync(path.join(w, '.gitignore'), '/data/x-raw/\n');
  g(['add', '-A'], w); g(['commit', '-qm', 'main'], w);
  g(['remote', 'add', 'origin', path.join(t, 'origin.git')], w);
  g(['push', '-q', 'origin', 'HEAD:main'], w);
  return { t, w, g };
}
function seedRaw({ t, g }, files) {
  const s = path.join(t, 'seed');
  g(['init', '-q', 'seed'], t);
  fs.writeFileSync(path.join(s, 'README.md'), 'raw\n');
  for (const [p, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(s, p)), { recursive: true }); fs.writeFileSync(path.join(s, p), c); }
  g(['add', '-A'], s); g(['commit', '-qm', 'seed'], s);
  g(['push', '-q', path.join(t, 'origin.git'), 'HEAD:raw'], s);
}
const run = (sb, script, args) => spawnSync('bash', [`scripts/${script}`, ...args], {
  cwd: sb.w, encoding: 'utf8', env: { ...process.env, RAW_WT: path.join(sb.t, 'rawwt'), RAW_SLEEP: '0' },
});
const onRaw = (sb) => git(['ls-tree', '-r', '--name-only', 'raw'], path.join(sb.t, 'origin.git')).split('\n').filter(Boolean).sort();
const rawFile = (sb, p) => git(['show', `raw:${p}`], path.join(sb.t, 'origin.git'));

test('push_raw.sh copies over raw, never deletes there, and leaves main alone', () => {
  const sb = sandbox();
  try {
    seedRaw(sb, { 'data/x-raw/old.txt': 'old\n', 'data/x-raw/same.txt': 'v1\n' });
    const mainBefore = git(['rev-parse', 'main'], path.join(sb.t, 'origin.git')).trim();
    fs.mkdirSync(path.join(sb.w, 'data/x-raw'), { recursive: true });
    fs.writeFileSync(path.join(sb.w, 'data/x-raw/new.txt'), 'new\n');
    fs.writeFileSync(path.join(sb.w, 'data/x-raw/same.txt'), 'v2\n');
    const r = run(sb, 'push_raw.sh', ['x probe', 'data/x-raw', 'data/never-written']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /data\/never-written was not written/);
    assert.deepEqual(onRaw(sb), ['README.md', 'data/x-raw/new.txt', 'data/x-raw/old.txt', 'data/x-raw/same.txt'], 'old.txt kept');
    assert.equal(rawFile(sb, 'data/x-raw/same.txt'), 'v2\n');
    assert.match(git(['log', '-1', '--format=%an %s', 'raw'], path.join(sb.t, 'origin.git')), /^agsist-bot x probe \d{4}-\d\d-\d\dT[\d:]+Z: 2 file\(s\)/);
    assert.equal(git(['rev-parse', 'main'], path.join(sb.t, 'origin.git')).trim(), mainBefore, 'main untouched');
    assert.equal(git(['status', '--porcelain'], sb.w), '', 'nothing staged or left on main');
    const again = run(sb, 'push_raw.sh', ['x probe', 'data/x-raw']);
    assert.equal(again.status, 0);
    assert.match(again.stdout, /raw: no change/);
  } finally { fs.rmSync(sb.t, { recursive: true, force: true }); }
});

test('push_raw.sh fails loudly when the raw branch is missing, and refuses paths outside the repo', () => {
  const sb = sandbox();
  try {
    fs.mkdirSync(path.join(sb.w, 'data/x-raw'), { recursive: true });
    fs.writeFileSync(path.join(sb.w, 'data/x-raw/a.txt'), 'a\n');
    const r = run(sb, 'push_raw.sh', ['x probe', 'data/x-raw']);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /::error::the raw branch is missing/);
    const out = run(sb, 'push_raw.sh', ['x probe', '../elsewhere']);
    assert.notEqual(out.status, 0);
    assert.match(out.stdout, /must be a path inside the repo/);
  } finally { fs.rmSync(sb.t, { recursive: true, force: true }); }
});

test('pull_raw.sh unpacks into the working tree only, and stops the run when a path is not on raw', () => {
  const sb = sandbox();
  try {
    seedRaw(sb, { 'data/x-raw/heat.json': '{"counties":{}}\n' });
    const r = run(sb, 'pull_raw.sh', ['data/x-raw']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(fs.readFileSync(path.join(sb.w, 'data/x-raw/heat.json'), 'utf8'), '{"counties":{}}\n');
    assert.equal(git(['status', '--porcelain'], sb.w), '', 'not staged; ignored on main');
    const miss = run(sb, 'pull_raw.sh', ['data/x-raw', 'data/not-there']);
    assert.notEqual(miss.status, 0);
    assert.match(miss.stdout, /::error::data\/not-there is not on the raw branch/);
  } finally { fs.rmSync(sb.t, { recursive: true, force: true }); }
});
