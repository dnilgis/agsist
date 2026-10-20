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
 * data/fsa (FSA's ARC/PLC xlsx and pdf, 34 MB) followed on Oct 20: only
 * build_arc_plc.py reads it, and arc-plc-refresh.yml and scripts/dev/checks.sh
 * unpack it with pull_raw.sh first. Its URL list and manifest stay on main.
 *
 * Kept on main on purpose: data/atlas/raw/drought.json (test/drought-county-week.test.mjs
 * reads it) and each probe's listing.json (the normal run reads it).
 *
 * Oct 20 (Sig): the raw and references branches moved off the public repo, to
 * the private repo dnilgis/feedbag. Every step that saves or reads them
 * passes the PRIVATE_REPO_TOKEN secret; scripts/private_remote.sh turns it into
 * the remote. A save that fails in a job that publishes site data is a warning
 * (RAW_SOFT=1), never the reason the data did not ship; a missing build input
 * still stops the build.
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
  'drought-county-week': ['data/drought/probe', 'FILES="data/drought/county-week.json data/drought/summary.json"'],
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
  assert.ok(ignored('data/atlas/raw/climate_monthly.json.gz'), 'the monthly climate file never reaches main');
  for (const d of MOVED) assert.ok(ignored(`${d}/x.txt`), `${d}/ ignored`);
  for (const k of KEPT) assert.ok(!ignored(k), `${k} is not ignored`);
  assert.ok(ignored('data/fsa/2026_PLC.xlsx'), 'FSA files are kept off main');
  assert.ok(ignored('data/fsa/arcco_2027_data_2027-01-15.xlsx'), 'a new FSA file is kept off main too');
  for (const k of ['data/fsa/urls.txt', 'data/fsa/manifest.tsv']) assert.ok(!ignored(k), `${k} stays on main`);
  assert.deepEqual(tracked('data/fsa'), ['data/fsa/manifest.tsv', 'data/fsa/urls.txt'], 'only the URL list and manifest are on main');
});

test('FSA files: every reader unpacks them from raw, every writer saves them there', () => {
  const r = read('.github/workflows/arc-plc-refresh.yml');
  const pull = r.indexOf('bash scripts/pull_raw.sh data/fsa');
  assert.ok(pull > 0 && pull < r.indexOf('build_arc_plc.py --selftest'), 'arc-plc-refresh pulls before the selftest and build');
  assert.doesNotMatch(r, /git add[^\n]*data\/fsa/, 'arc-plc-refresh never commits data/fsa');
  for (const wf of ['fetch-fsa-arcplc', 'fetch-fsa-files']) {
    const y = read(`.github/workflows/${wf}.yml`);
    assert.match(y, /bash scripts\/push_raw\.sh "FSA ARC\/PLC files" data\/fsa\n/, `${wf}: files saved to raw`);
    assert.match(y, /git add data\/fsa\/manifest\.tsv\n/, `${wf}: main gets only the manifest`);
    assert.doesNotMatch(y, /git add data\/fsa\n/, `${wf}: the folder is not committed to main`);
  }
  const c = read('scripts/dev/checks.sh');
  assert.ok(c.indexOf('pull_raw.sh data/fsa') > 0 && c.indexOf('pull_raw.sh data/fsa') < c.indexOf('run node-test'), 'ship checks unpack them first');
  assert.match(read('scripts/build_arc_plc.py'), /no FSA county files in \{FSA_DIR\}\/\. They live on the raw branch/, 'a build without them stops, never falls back to estimates');
});

test('every probe saves its captures to the raw branch and commits only built outputs to main', () => {
  for (const [wf, [dir, files]] of Object.entries(PROBES)) {
    const y = read(`.github/workflows/${wf}.yml`);
    assert.ok(y.includes(files + '\n'), `${wf}: main gets ${files}`);
    const step = `        if: \${{ !cancelled() && github.event_name == 'workflow_dispatch' && inputs.probe }}\n` +
      `        env:\n          PRIVATE_REPO_TOKEN: \${{ secrets.PRIVATE_REPO_TOKEN }}\n          RAW_SOFT: '1'\n` +
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
  assert.match(y, /if: \$\{\{ !cancelled\(\) \}\}\n(\s+#.*\n)*\s+env:\n\s+PRIVATE_REPO_TOKEN: \$\{\{ secrets\.PRIVATE_REPO_TOKEN \}\}\n\s+RAW_SOFT: '1'\n\s+run: bash scripts\/push_raw\.sh "farmland atlas raw" \$\(ls data\/atlas\/raw\/\*\.json data\/atlas\/raw\/\*\.json\.gz 2>\/dev\/null \| grep -v '\/drought\\\.json\$'\)/,
    'saved even when the build fails, the gzipped monthly climate file with them; drought.json stays on main only');
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
  for (const s of ['push_raw.sh', 'pull_raw.sh', 'fetch_private.sh', 'private_remote.sh', 'redact_secrets.py']) fs.copyFileSync(path.join(root, 'scripts', s), path.join(w, 'scripts', s));
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
// The sandbox's own origin: never the real private repo, whatever this shell has set.
const baseEnv = () => { const e = { ...process.env }; for (const k of ['PRIVATE_REPO_TOKEN', 'RAW_REMOTE', 'RAW_SOFT', 'RAW_BRANCH', 'GITHUB_STEP_SUMMARY']) delete e[k]; return e; };
const run = (sb, script, args, extra = {}) => spawnSync('bash', [`scripts/${script}`, ...args], {
  cwd: sb.w, encoding: 'utf8', env: { ...baseEnv(), RAW_WT: path.join(sb.t, 'rawwt'), RAW_SLEEP: '0', ...extra },
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

test('push_raw.sh takes secret-looking strings out of the raw copy, not the original (push protection)', () => {
  const sb = sandbox();
  try {
    seedRaw(sb, {});
    // assembled from parts so this file itself carries no key
    const key = ['AI', 'za', 'Sy', 'Q1w2E3r4T5y6U7i8O9p0A1s2D3f4G5h6J7k'].join('');
    const stripe = ['pk', '_live_', '51HcAb12Cd34Ef56Gh78'].join('');
    fs.mkdirSync(path.join(sb.w, 'data/x-raw'), { recursive: true });
    const page = `<script src="https://maps.googleapis.com/maps/api/js?key=${key}"></script> Corn 3.85 ${stripe}`;
    fs.writeFileSync(path.join(sb.w, 'data/x-raw/page.html'), page);
    fs.writeFileSync(path.join(sb.w, 'data/x-raw/b.json'), JSON.stringify({ html: page }));
    const r = run(sb, 'push_raw.sh', ['x probe', 'data/x-raw']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /redact: 4 secret-looking string\(s\) replaced in 2 file\(s\)/);
    const saved = rawFile(sb, 'data/x-raw/page.html');
    assert.ok(!saved.includes(key) && !saved.includes(stripe) && saved.includes('Corn 3.85') && saved.includes('key=[redacted]'), saved);
    assert.equal(JSON.parse(rawFile(sb, 'data/x-raw/b.json')).html.includes('[redacted]'), true, 'JSON stays valid');
    assert.equal(fs.readFileSync(path.join(sb.w, 'data/x-raw/page.html'), 'utf8'), page, 'the original is left alone');
  } finally { fs.rmSync(sb.t, { recursive: true, force: true }); }
});

test('the redactor selftest passes (planted keys of every kind, readable text and JSON kept)', () => {
  const r = spawnSync('python3', [path.join(root, 'scripts/redact_secrets.py'), 'selftest'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /redact selftest ok/);
});
