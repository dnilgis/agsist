/* The WASDE archive (brief 04, Oct 26; Sig: go): every past WASDE and each
 * figure's month-to-month revisions.
 *   - scripts/backfill_wasde.py: USDA's historical WASDE report data (2010 on) and
 *     the ESMIS inventory (1973 on) to the PRIVATE raw branch, history/wasde/;
 *   - scripts/build_wasde_history.py: the small per-crop files the site loads on
 *     demand, data/wasde-history/;
 *   - .github/workflows/wasde-archive.yml: dispatch only (no new schedule);
 *   - components/wasde-history.js: "How this estimate moved" on /whats-priced-in.
 *   - scripts/read_wasde_text.py (brief 09, Oct 27): each report's own U.S. tables, read
 *     from the ESMIS TXT or PDF text, since usda.gov's data page refuses the runners;
 *   - .github/workflows/wasde-watch.yml: one soft step keeps the archive current after
 *     each report (Sig, Oct 27: "Wasde should auto update"; no new schedule).
 * Fixtures only (test/fixtures/wasde-archive, invented numbers; test/fixtures/wasde-esmis,
 * an excerpt of the real October 2026 report plus invented layouts); no network.
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
  ['scripts/read_wasde_text.py', /read_wasde_text selftest: 0 failure\(s\)/],
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
  const r = read('test/fixtures/wasde-esmis/README.md');
  assert.match(r, /old-layout\.txt[\s\S]*Every number in this file is invented for the tests; none is a USDA figure/);
  assert.match(r, /wasde-2026-10-09\.txt[\s\S]*USDA's published figures/, 'the real excerpt says it is real');
});

test('wasde-archive.yml is dispatch only: no schedule, no other trigger', () => {
  const y = noComments(read('.github/workflows/wasde-archive.yml'));
  const on = y.slice(y.indexOf('\non:'), y.indexOf('\npermissions:'));
  assert.match(on, /^\s+workflow_dispatch:/m);
  assert.doesNotMatch(y, /schedule:|cron:|workflow_run:|\bpush:|pull_request:|repository_dispatch:/);
  assert.match(on, /options: \[csv, esmis, files\]/);
  assert.match(on, /publish:\n\s+description: [^\n]+\n\s+type: boolean\n\s+default: false/, 'publishing is a choice, off by default');
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
  const b = step('wasde-archive.yml', 'Build the site files');
  assert.match(b, /if: \$\{\{ inputs\.mode != 'esmis' \}\}/);
  assert.match(b, /if \[ "\$PUBLISH" = "true" \]; then out=data\/wasde-history; else out="\$RUNNER_TEMP\/wasde-history"; fi/,
    'unpublished, the build never touches data/wasde-history');
  assert.match(c, /if: \$\{\{ inputs\.mode != 'esmis' && inputs\.publish \}\}/, 'nothing is committed unless publish is set');
  assert.match(f, /--esmis-files "\$\{args\[@\]\}"/);
  assert.match(step('wasde-archive.yml', 'Install pdftotext'), /if: \$\{\{ inputs\.mode == 'files' \}\}/);
});

// ---------------------------------------------------------------- the auto-update (wasde-watch.yml)
test('wasde-watch: the archive update is one soft step in the existing job, no new schedule', () => {
  const y = read('.github/workflows/wasde-watch.yml');
  const crons = [...noComments(y).matchAll(/cron: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(crons, ['*/5 16-17 9-12 * *'], 'the one schedule it had');
  const jobs = noComments(y).slice(noComments(y).indexOf('\njobs:'));
  assert.deepEqual([...jobs.matchAll(/^  ([a-z][\w-]*):$/gm)].map((m) => m[1]), ['gate', 'grade'], 'no new job');
  const a = step('wasde-watch.yml', 'Update the WASDE archive from ESMIS');
  assert.match(a, /continue-on-error: true/, 'it can never turn the grading red');
  assert.match(a, /timeout-minutes: [1-9]\n/);
  assert.match(a, /if: \$\{\{ inputs\.dry_run != true \}\}/);
  const body = noComments(a);
  const gate = body.indexOf('--update-due');
  assert.ok(gate > 0 && gate < body.indexOf('pull_raw.sh'), 'the gate runs before any network');
  assert.match(body, /if \[ "\$rc" -eq 3 \]; then exit 0; fi/);
  assert.match(body, /if ! RAW_SOFT= bash scripts\/pull_raw\.sh history\/wasde; then/, 'never runs on without the saved manifest');
  assert.match(a, /RAW_SOFT: '1'/, 'the save is soft, as every publishing job saves');
  assert.match(body, /--esmis --pages 2\n/);
  assert.match(body, /--esmis-files --newest 3\n/);
  assert.match(body, /\n\s+bash scripts\/push_raw\.sh "wasde archive update" history\/wasde\n/);
  assert.match(body, /python3 scripts\/build_wasde_history\.py/);
  const steps = [...y.matchAll(/^      - name: (.+)$/gm)].map((m) => m[1]);
  assert.ok(steps.indexOf('Update the WASDE archive from ESMIS') > steps.indexOf("Rebuild the page's data")
    && steps.indexOf('Update the WASDE archive from ESMIS') < steps.indexOf('Commit'), 'after the grading, before the commit');
  const c = step('wasde-watch.yml', 'Commit');
  assert.match(c, /steps\.archive\.outputs\.new == '1'/);
  assert.match(c, /\n\s+if \[ -d data\/wasde-history \]; then git add data\/wasde-history; fi\n/, 'its own git add, so a missing folder never empties the grading commit');
  assert.doesNotMatch(c, /git add [^\n]*history\/wasde/, 'raw history never reaches main');
});

test('raw WASDE history is ignored on main', () => {
  for (const p of ['history/wasde/manifest.json', 'history/wasde/files/oce-wasde-report-data-2026-10.csv.gz', 'history/wasde/us-grains/x.csv.gz',
    'history/wasde/esmis/manifest.json', 'history/wasde/esmis/text/2026-10-09.txt.gz']) {
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
  assert.match(sec, /Source: <a href="https:\/\/esmis\.nal\.usda\.gov\/publication\/world-agricultural-supply-and-demand-estimates"[^>]*>USDA World Agricultural Outlook Board, monthly WASDE reports<\/a> \(USDA ESMIS archive\)/,
    'the credit names the archive the figures are read from');
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

test('component: older market years come from their decade file, named only as the build names them', () => {
  const W = lib();
  const doc = { years: { '2026/27': {} }, parts: [{ name: 'corn-1990s.json', years: ['1995/96', '1996/97'] },
    { name: '../x.json', years: ['1980/81'] }, { name: 'https://x.example/corn-1970s.json', years: ['1975/76'] }] };
  assert.deepEqual(W.partFor(doc, '1996/97'), doc.parts[0]);
  assert.equal(W.partFor(doc, '2026/27'), null, 'a year the crop file holds');
  assert.equal(W.partFor(doc, '1980/81'), null, 'a path is refused');
  assert.equal(W.partFor(doc, '1975/76'), null, 'another host is refused');
  assert.deepEqual(W.allYears(doc), ['2026/27', '1996/97', '1995/96', '1980/81', '1975/76']);
  doc.years['1996/97'] = {};
  assert.equal(W.partFor(doc, '1996/97'), null, 'once loaded, not fetched again');
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
