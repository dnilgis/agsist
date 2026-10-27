/* The WASDE archive (brief 04, Oct 26; Sig: go): every past WASDE and each
 * figure's month-to-month revisions.
 *   - scripts/backfill_wasde.py: USDA's historical WASDE report data (2010 on) and
 *     the ESMIS inventory (1973 on) to the PRIVATE raw branch, history/wasde/;
 *   - scripts/build_wasde_history.py: the small per-crop files the site loads on
 *     demand, data/wasde-history/;
 *   - .github/workflows/wasde-archive.yml: dispatch only (no new schedule);
 *   - components/wasde-history.js: "How this estimate moved" on /whats-priced-in.
 * Fixtures only (test/fixtures/wasde-archive, invented numbers); no network.
 *
 *   node --test test/wasde-archive.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const noComments = (s) => s.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
const env = Object.assign({}, process.env, { HISTORY_PUSH: '' });
const run = (args) => spawnSync('python3', args, { cwd: root, encoding: 'utf8', env });

function step(file, name) {
  const y = read(`.github/workflows/${file}`);
  const i = y.indexOf(`- name: ${name}`);
  assert.ok(i >= 0, `${file} has the step "${name}"`);
  const rest = y.slice(i + 1);
  const j = rest.search(/\n      - (name|uses|id): /);
  return j < 0 ? rest : rest.slice(0, j);
}

for (const [script, done] of [
  ['scripts/backfill_wasde.py', /backfill_wasde selftest: 0 failure\(s\)/],
  ['scripts/build_wasde_history.py', /build_wasde_history selftest: 0 failure\(s\)/],
]) {
  test(`${script} --selftest (fixtures, no network)`, () => {
    const r = run([script, '--selftest']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, done);
  });
}

test('the fixtures say their numbers are invented', () => {
  assert.match(read('test/fixtures/wasde-archive/README.md'), /Every number here is invented for the tests; none is a USDA figure/);
});

test('wasde-archive.yml is dispatch only: no schedule, no other trigger', () => {
  const y = noComments(read('.github/workflows/wasde-archive.yml'));
  const on = y.slice(y.indexOf('\non:'), y.indexOf('\npermissions:'));
  assert.match(on, /^\s+workflow_dispatch:/m);
  assert.doesNotMatch(y, /schedule:|cron:|workflow_run:|\bpush:|pull_request:|repository_dispatch:/);
  assert.match(on, /options: \[csv, esmis\]/);
});

test('wasde-archive.yml: resumes from raw, saves the raw history there, commits only the small site files', () => {
  const m = step('wasde-archive.yml', 'The saved archive (private raw branch)');
  assert.match(m, /pull_raw\.sh history\/wasde/);
  assert.match(m, /grep -q "is not on the raw branch"/, 'a missing path is a first run');
  assert.match(m, /::error::could not read the raw branch; not starting"; exit 1/);
  const f = step('wasde-archive.yml', 'Fetch');
  assert.doesNotMatch(f, /\$\{\{ inputs\.(from|to|max_minutes) \}\}[^\n]*\n?[^\n]*python/, 'inputs reach the script through env');
  assert.match(f, /case "\$v" in \*\[!0-9\]\*\)/, 'years and minutes are numbers');
  assert.match(f, /HISTORY_PUSH: '1'/);
  const s = step('wasde-archive.yml', 'Save to the raw branch');
  assert.match(s, /bash scripts\/push_raw\.sh "wasde archive \$MODE" history\/wasde/);
  assert.doesNotMatch(s, /RAW_BRANCH/, 'the raw branch, beside the other history');
  const c = step('wasde-archive.yml', 'Commit the site files');
  assert.match(c, /git add data\/wasde-history\n/);
  assert.doesNotMatch(c, /git add [^\n]*history\/wasde/, 'raw history never reaches main');
  assert.match(step('wasde-archive.yml', 'Build the site files'), /if: \$\{\{ inputs\.mode == 'csv' \}\}/);
});

test('raw WASDE history is ignored on main', () => {
  for (const p of ['history/wasde/manifest.json', 'history/wasde/files/oce-wasde-report-data-2026-10.csv.gz', 'history/wasde/us-grains/x.csv.gz']) {
    const r = spawnSync('git', ['check-ignore', '-q', '--no-index', p], { cwd: root });
    assert.equal(r.status, 0, `${p} is ignored`);
  }
  assert.equal(spawnSync('git', ['ls-files', 'history'], { cwd: root, encoding: 'utf8' }).stdout.trim(), '');
});

test('the site files have a size cap, and any published copy is under it', () => {
  const b = read('scripts/build_wasde_history.py');
  const cap = +(b.match(/^MAX_FILE_BYTES = ([\d_]+)$/m) || [])[1]?.replace(/_/g, '');
  assert.ok(cap > 0 && cap <= 400000, `cap ${cap}`);
  const dir = path.join(root, 'data/wasde-history');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  for (const f of files) assert.ok(fs.statSync(path.join(dir, f)).size <= cap, `${f} over ${cap} bytes`);
});

// ---------------------------------------------------------------- the page
test('whats-priced-in: the section is hidden until history exists, credits USDA, loads its script deferred', () => {
  const h = read('whats-priced-in.html');
  const at = h.indexOf('<details class="fold" id="how-moved" hidden>');
  assert.ok(at > 0, 'hidden by default');
  const sec = h.slice(at, h.indexOf('</details>', at));
  assert.match(sec, /<h2>How this estimate moved<\/h2>/);
  assert.match(sec, /Source: <a href="https:\/\/www\.usda\.gov\/historical-wasde-report-data-3"/);
  assert.match(sec, /data-wh-body/);
  assert.doesNotMatch(sec, /—/, 'no em dash');
  assert.match(h, /<script src="\/components\/wasde-history\.js\?v=\d+" defer><\/script>/);
  assert.ok(h.indexOf('id="how-moved"') > h.indexOf('id="track-record"'), 'after the track record');
});

const require = createRequire(import.meta.url);
function lib() {
  delete require.cache[path.join(root, 'components/wasde-history.js')];
  require(path.join(root, 'components/wasde-history.js'));
  return globalThis.agsistWasdeHistory;
}

function built() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wasde-'));
  const py = `
import json, os, sys
sys.path.insert(0, "scripts")
import build_wasde_history as B
from backfill_wasde import FIX, extract, EXTRACT_HEAD
rows = []
for fn, label in [("data-2010-04-to-2015-12.csv", "a"), ("data-2026-09.csv", "b"), ("data-2026-10.csv", "c")]:
    ex, _ = extract(open(os.path.join(FIX, fn), encoding="utf-8").read(), label)
    rows += [dict(zip(EXTRACT_HEAD, r)) for r in ex]
docs, index = B.build(rows)
sys.exit(B.write(docs, index, sys.argv[1], 1))
`;
  const r = spawnSync('python3', ['-c', py, d], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return { dir: d, corn: JSON.parse(fs.readFileSync(path.join(d, 'corn.json'), 'utf8')), index: JSON.parse(fs.readFileSync(path.join(d, 'index.json'), 'utf8')) };
}

test('component: a line\'s path, oldest first, with each change and status', () => {
  const W = lib();
  const { corn } = built();
  const si = corn.series.findIndex((s) => s.line === 'Ending Stocks');
  const p = W.path(corn, '2026/27', si);
  assert.deepEqual(p.map((x) => [x.date, x.wasde, x.flag, x.value, x.change]),
    [['2026-09-11', '675', 'projected', 1500, ''], ['2026-10-09', '676', 'projected', 1800, '+300']]);
  assert.equal(W.summary('Corn', '2026/27', 'Ending Stocks', 'Million Bushels', p),
    'USDA first printed 2026/27 corn ending stocks at 1,500 million bushels (Sep 11, 2026). The latest, Oct 9, 2026, is 1,800: up 300 (+20.0%), changed in 1 of 1 later reports.');
  const old = W.path(corn, '2009/10', si);
  assert.deepEqual(old.map((x) => [x.flag, x.change]), [['projected', ''], ['estimated', '-20']]);
  assert.equal(W.summary('Corn', '2030/31', 'Ending Stocks', 'x', []), 'No figure on file for this line and year.');
  assert.deepEqual(W.path(corn, '2030/31', si), []);
});

test('component: share link round trip, and a bad one is ignored', () => {
  const W = lib();
  assert.deepEqual(W.parseShare('?a=1&wh=soybeans~2026%2F27~Ending%20Stocks'), { crop: 'soybeans', my: '2026/27', line: 'Ending Stocks' });
  assert.equal(W.parseShare('?a=1'), null);
  assert.equal(W.parseShare('?wh=%E0%A4%A'), null);
});

function fakePage(fetchImpl) {
  const box = { hidden: true, open: false, listeners: {}, querySelector: () => null,
    addEventListener(t, f) { this.listeners[t] = f; } };
  const doc = { getElementById: (id) => (id === 'how-moved' ? box : null) };
  const win = { fetch: fetchImpl, location: { search: '', href: 'https://agsist.com/whats-priced-in' } };
  return { box, doc, win };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

test('component: no history published keeps the section hidden; a published index shows it', async () => {
  const W = lib();
  const miss = fakePage(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('x')) }));
  W.init(miss.doc, miss.win);
  await settle();
  assert.equal(miss.box.hidden, true, '404 index: hidden');
  const down = fakePage(() => Promise.reject(new Error('offline')));
  W.init(down.doc, down.win);
  await settle();
  assert.equal(down.box.hidden, true, 'network error: hidden');
  const { index } = built();
  const ok = fakePage((u) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(u.endsWith('index.json') ? index : {}) }));
  W.init(ok.doc, ok.win);
  await settle();
  assert.equal(ok.box.hidden, false, 'index there: shown');
  assert.equal(typeof ok.box.listeners.toggle, 'function', 'the crop file waits for the reader to open it');
});

test('component: reads only this site\'s files and writes nothing about the reader', () => {
  const js = read('components/wasde-history.js');
  assert.match(js, /var BASE = '\/data\/wasde-history\/';/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|document\.cookie|sendBeacon|https?:\/\//);
  assert.doesNotMatch(js, /innerHTML/, 'text goes in as text');
  assert.doesNotMatch(js, /—/);
});
