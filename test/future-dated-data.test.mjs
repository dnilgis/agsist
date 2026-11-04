// No made-up future day under data/ (Nov 4, 2026).
//
// The real case: scripts/test_list_fallback.py runs the Daily's sender for a made-up day, 2099-01-01.
// The sender keeps its sent copy in data/daily-sent/<day>.json, and the test did not move that folder,
// so a local run on Oct 27 at 03:15 UTC wrote data/daily-sent/2099-01-01.json (the Oct 26 issue under
// a 2099 name) into the checkout. The next commit (817663ed676, fx/batch-oct27, #93) took it to main,
// where it sat as a public file for 8 days. No reader was mailed: the test's mail server is a fake.
//
// Three guards, one per copy of the mistake:
//   1. the repo: no tracked file under data/ is dated more than 2 days ahead, unless
//      .github/future-dated-data.txt lists it with a reason (this file; main-checks runs it);
//   2. the jobs: every job's Engine checkout step installs a pre-commit hook that leaves such a
//      new file out of the commit (.github/actions/engine/engine.sh hook), so a self-test that writes
//      into a data workflow's checkout cannot reach main;
//   3. the test itself keeps the sent copy in its temp folder (scripts/test_list_fallback.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOW = '.github/future-dated-data.txt';
const ENGINE = path.join(root, '.github/actions/engine/engine.sh');
const DAY_MS = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// the same rule as the hook: the earliest valid YYYY-MM-DD in the path
const DATE_RE = /(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])/g;
function earliestDate(p) {
  const ds = p.match(DATE_RE);
  return ds ? ds.sort()[0] : null;
}
function readAllow(text) {
  return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const [p, ...why] = l.split(/\s+/); return { path: p, why: why.join(' ') }; });
}
function allowed(p, allow) {
  return allow.some((a) => (a.path.endsWith('/') ? p.startsWith(a.path) : p === a.path));
}
function futureShaped(files, today, allow) {
  const lim = iso(Date.parse(today + 'T00:00:00Z') + 2 * DAY_MS);
  return files.filter((f) => f.startsWith('data/')).filter((f) => {
    const d = earliestDate(f);
    return d && d > lim && !allowed(f, allow);
  });
}

const allowList = readAllow(fs.readFileSync(path.join(root, ALLOW), 'utf8'));

test('the rule, from the real case: 2099-01-01 is a made-up day, today and the next 2 days are not', () => {
  const files = [
    'data/daily-sent/2099-01-01.json',            // the Oct 27 file
    'data/daily-sent/2026-11-04.json',            // today
    'data/daily-sent/2026-11-06.json',            // 2 days ahead: a time zone or a late run, allowed
    'data/daily-sent/2026-11-07.dry-run.json',    // 3 days ahead
    'data/whats-new/2026-10-27-wasde-2027-dates.json', // a slug that names a year, not a day
    'data/rp-sealed/2089dd3a09448d395642dc8667b4ea45.bin', // a hash that starts like a year
    'data/cash-index/acc-2026-11.json',           // a month, not a day
    'daily/2099-01-01.html',                      // outside data/: the page builders have their own checks
    'data/x/2026-11-04-to-2027-01-12.json',       // dated today, naming a later day: the earliest date counts
  ];
  assert.deepEqual(futureShaped(files, '2026-11-04', []), // pin-ok: inline fixture paths and a fixed today, no live data
    ['data/daily-sent/2099-01-01.json', 'data/daily-sent/2026-11-07.dry-run.json']);
  assert.deepEqual(futureShaped(['data/sched/2027-01-12.json', 'data/fc/a/2027-02-01.json', 'data/daily-sent/2099-01-01.json'], '2026-11-04', // pin-ok: inline fixture paths and a fixed today
    [{ path: 'data/sched/2027-01-12.json', why: 'x' }, { path: 'data/fc/', why: 'y' }]),
  ['data/daily-sent/2099-01-01.json'], 'a listed file or folder passes, nothing else');
});

test('no tracked file under data/ is dated more than 2 days ahead unless the list names it with a reason', () => {
  const files = execFileSync('git', ['ls-files', '-z', '--', 'data'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\0').filter(Boolean);
  assert.ok(files.length > 100, 'git ls-files found the data folder (' + files.length + ' files)');
  const bad = futureShaped(files, iso(Date.now()), allowList);
  assert.deepEqual(bad, [], bad.length + ' file(s) under data/ dated more than 2 days ahead: a test or a self-test wrote a ' +
    'made-up day into a real checkout. Delete it and keep that test in its temp folder; a real forecast or schedule goes in ' +
    ALLOW + ' with its reason');
  for (const a of allowList) {
    assert.ok(a.path.startsWith('data/'), ALLOW + ': ' + a.path + ' is not under data/');
    assert.ok(a.why.split(' ').length >= 3, ALLOW + ': ' + a.path + ' needs a reason (a few words)');
    assert.ok(files.some((f) => (a.path.endsWith('/') ? f.startsWith(a.path) : f === a.path)),
      ALLOW + ': ' + a.path + ' is listed but no tracked file matches it; take the line out');
  }
});

test('scripts/test_list_fallback.py keeps the sent copy of its made-up day in its temp folder', () => {
  const src = fs.readFileSync(path.join(root, 'scripts/test_list_fallback.py'), 'utf8');
  assert.match(src, /send_daily\.SENT = Path\(TMP\) \/ "daily-sent"/, 'the Daily\'s sent-copy folder points at the temp folder');
  const at = src.indexOf('send_daily.SENT = Path(TMP)');
  const firstMain = src.indexOf('send_daily.main');
  assert.ok(at > 0 && at < firstMain, 'the folder moves before the first send');
});

// ---- the hook every job gets, run in a throwaway repository ----
const g = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (dir, rel, s) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), s); };
const commit = (cwd, msg) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg], { cwd, encoding: 'utf8' });
const inHead = (cwd) => g(cwd, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n').filter(Boolean);

function jobRepo(allowText = '') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'futdate-'));
  g(d, 'init', '-q', '-b', 'main');
  write(d, '.github/engine-paths', 'repo dnilgis/feedbag\nbranch engine-agsist\npath scripts\npath test\npath build\n');
  write(d, '.github/actions/engine/engine.sh', fs.readFileSync(ENGINE, 'utf8'));
  write(d, '.github/future-dated-data.txt', allowText);
  write(d, 'scripts/a.py', 'a\n'); write(d, 'test/t.mjs', 't\n'); write(d, 'build/b.sh', 'b\n');
  write(d, 'data/x.json', '1\n');
  g(d, 'add', '-A'); g(d, 'commit', '-qm', 'init');
  // the Engine checkout step, as a job runs it
  const r = spawnSync('bash', ['.github/actions/engine/engine.sh', 'plan'], { cwd: d, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return d;
}
// the record as it sat on main, briefing left out
const realCase = JSON.stringify({ date: '2099-01-01', sent_at: '2026-10-27T03:15:48+00:00', format: 'current',
  subject: 'AGSIST · Crude −2.1% · Corn dips 3¢ to $4.53, beans lose 16¢ to $12.40' }, null, 2) + '\n';

test('a job\'s commit leaves out a made-up day and keeps the real sent copy (the Oct 27 commit, replayed)', () => {
  const d = jobRepo();
  const today = iso(Date.now());
  write(d, 'data/daily-sent/2099-01-01.json', realCase);
  write(d, 'data/daily-sent/' + today + '.json', '{"date":"' + today + '"}\n');
  write(d, 'data/daily-sent/' + iso(Date.now() + DAY_MS) + '.json', '{}\n');
  g(d, 'add', 'data/daily-sent/'); // the "Keep the sent copy" step adds the whole folder
  const r = commit(d, 'AGSIST Daily sent copy');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /::warning title=test-shaped file left out of the commit::data\/daily-sent\/2099-01-01\.json is dated 2099-01-01/); // pin-ok: the file this test wrote itself
  const head = inHead(d);
  assert.ok(!head.includes('data/daily-sent/2099-01-01.json'), 'the made-up day reached the commit'); // pin-ok: the file this test wrote itself
  assert.ok(head.includes('data/daily-sent/' + today + '.json'), 'today\'s sent copy was left out');
  assert.ok(head.includes('data/daily-sent/' + iso(Date.now() + DAY_MS) + '.json'), 'tomorrow\'s file (a time zone away) was left out');
});

test('a bare git add -A, a commit -a and a commit of nothing else: the made-up day never lands, no empty commit', () => {
  const d = jobRepo();
  const far = iso(Date.now() + 5 * DAY_MS);
  write(d, 'data/daily-sent/' + far + '.json', '{}\n');
  write(d, 'data/x.json', '2\n');
  g(d, 'add', '-A');
  let r = commit(d, 'data');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!inHead(d).includes('data/daily-sent/' + far + '.json'), 'a file 5 days ahead reached the commit');
  assert.equal(g(d, 'show', 'HEAD:data/x.json'), '2\n', 'the real data change still went in');

  const before = g(d, 'rev-parse', 'HEAD');
  write(d, 'data/hail/2099-01-01/a.json', '{}\n');
  g(d, 'add', '-A');
  r = commit(d, 'only the made-up day');
  assert.notEqual(r.status, 0, 'a commit with nothing left was made');
  assert.match(r.stdout + r.stderr, /nothing left to commit/); // git sends hook output to stderr
  assert.equal(g(d, 'rev-parse', 'HEAD'), before, 'HEAD moved');

  write(d, 'data/x.json', '3\n');
  r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-a', '-m', 'commit -a'], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!inHead(d).some((f) => f.includes('2099')), 'commit -a carried a staged made-up day');
});

test('a file or folder on the list commits, and the hook stays one hook when plan runs twice', () => {
  const d = jobRepo('# reasons\ndata/sched/2099-01-01.json the board of trade holiday list for that year\ndata/fc/ forecast runs are dated by their target day\n');
  write(d, 'data/sched/2099-01-01.json', '{}\n');
  write(d, 'data/fc/2099-02-01.json', '{}\n');
  write(d, 'data/other/2099-01-01.json', '{}\n');
  spawnSync('bash', ['.github/actions/engine/engine.sh', 'plan'], { cwd: d, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '' } });
  const hook = fs.readFileSync(path.join(d, '.git/hooks/pre-commit'), 'utf8');
  assert.equal(hook.split('agsist commit guard (engine.sh hook)').length - 1, 1);
  g(d, 'add', '-A');
  const r = commit(d, 'listed');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const head = inHead(d);
  assert.ok(head.includes('data/sched/2099-01-01.json') && head.includes('data/fc/2099-02-01.json'), 'a listed file was left out'); // pin-ok: files this test wrote itself
  assert.ok(!head.includes('data/other/2099-01-01.json'), 'an unlisted made-up day went in'); // pin-ok: a file this test wrote itself
});
