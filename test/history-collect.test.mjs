/* The history collectors for the insight machine (Sig, Oct 21: start the
 * collection jobs; HARD RULE: no new scheduled workflow, no new cron line).
 *   - one-time backfills (scripts/backfill_agtransport.py, backfill_usdm.py,
 *     backfill_nass_progress.py, backfill_ams_fert.py) behind ONE dispatch-only
 *     workflow, history-backfill.yml, saving to the private raw branch;
 *   - the ongoing pieces ride existing schedules: the weekly drought job, the
 *     Monday crop progress job, the cattle auction job, the morning report;
 *   - the daily bid snapshot's location floor;
 *   - worker v5.45 GET /count-area and the counts-only snapshot it feeds.
 * Every selftest runs on fixtures; nothing here touches the network.
 *
 *   node --test test/history-collect.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const WF = '.github/workflows';
const workflows = fs.readdirSync(path.join(root, WF)).filter((f) => f.endsWith('.yml'));
const noComments = (s) => s.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', env: Object.assign({}, process.env, { HISTORY_PUSH: '' }) });

function step(file, name) {
  const y = read(`${WF}/${file}`);
  const i = y.indexOf(`- name: ${name}`);
  assert.ok(i >= 0, `${file} has the step "${name}"`);
  const rest = y.slice(i + 1);
  const j = rest.search(/\n      - (name|uses|id): /);
  return j < 0 ? rest : rest.slice(0, j);
}

for (const [script, done] of [
  ['scripts/history_lib.py', /history_lib selftest: 0 failure\(s\)/],
  ['scripts/backfill_agtransport.py', /backfill_agtransport selftest: 0 failure\(s\)/],
  ['scripts/backfill_usdm.py', /backfill_usdm selftest: 0 failure\(s\)/],
  ['scripts/backfill_nass_progress.py', /backfill_nass_progress selftest: 0 failure\(s\)/],
  ['scripts/backfill_ams_fert.py', /backfill_ams_fert selftest: 0 failure\(s\)/],
  ['scripts/history_append.py', /history_append selftest: 0 failure\(s\)/],
  ['scripts/reader_area_counts.py', /reader_area_counts selftest: 0 failure\(s\)/],
  ['scripts/bid_snapshots.py', /selftest: 0 failure\(s\)/],
  ['scripts/fetch_drought_county_week.py', /selftest ok/],
]) {
  test(`${script} --selftest (fixtures, no network)`, () => {
    const r = run('python3', [script, '--selftest']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, done);
  });
}

test('worker /count-area (scripts/test_count_area_worker.mjs)', () => {
  const r = run(process.execPath, ['scripts/test_count_area_worker.mjs']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /count-area checks: \d+ passed/);
});

test('worker header v5.45 and the route is Bearer only, read-only, never cached', () => {
  const w = read('workers/subs-worker.js');
  assert.ok(w.includes(' * v5.45 (2026-10-21): READER COUNTS BY AREA'));
  const at = w.indexOf('if (path === "/count-area")');
  assert.ok(at > w.indexOf('const sig = !!bearer && authed;'), 'after the Bearer-only check is built');
  const route = w.slice(at, w.indexOf('\n    }\n', at));
  assert.match(route, /if \(!sig \|\| url\.searchParams\.has\("token"\)\) return json\(\{ ok: false \}, 403, ns\)/);
  assert.match(route, /"Cache-Control": "no-store"/);
  const page = w.slice(w.indexOf('async function areaPage'), w.indexOf('async function noticeCounts'));
  assert.ok(!/\.put\(|\.delete\(/.test(page), 'areaPage never writes');
  assert.ok(!/email|\.place\b(?!\))/.test(page.replace(/areaState\(r\.place\)/g, '')), 'no address or place text leaves the page');
});

// ---------------------------------------------------------------- the one new workflow
test('history-backfill.yml is dispatch only: no schedule, no push, no other trigger', () => {
  const y = noComments(read(`${WF}/history-backfill.yml`));
  const on = y.slice(y.indexOf('\non:'), y.indexOf('\npermissions:'));
  assert.match(on, /^\s+workflow_dispatch:/m);
  assert.doesNotMatch(y, /schedule:|cron:|workflow_run:|\bpush:|pull_request:|repository_dispatch:/);
  assert.match(on, /options: \[agtransport, usdm, nass, ams-fert\]/);
  assert.match(y, /permissions:\n  contents: read/, 'it never writes to this repo');
});

test('history-backfill.yml: resumes from the saved manifest, refuses to start blind, saves hard at the end', () => {
  const m = step('history-backfill.yml', 'The saved manifest (private raw branch)');
  assert.match(m, /pull_raw\.sh "\$DIR\/manifest\.json"/);
  assert.match(m, /grep -q "is not on the raw branch"/, 'a missing path is a first run');
  assert.match(m, /::error::could not read the raw branch; not starting"; exit 1/, 'an unreadable branch stops the run');
  const b = step('history-backfill.yml', 'Backfill');
  assert.match(b, /HISTORY_PUSH: '1'/, 'saves every 30 minutes as it goes');
  for (const k of ['NASS_API_KEY', 'MARS_API_KEY', 'SOCRATA_APP_TOKEN']) {
    assert.match(b, new RegExp(`${k}: \\$\\{\\{ inputs\\.source == '[a-z-]+' && secrets\\.${k} \\|\\| '' \\}\\}`), `${k} from secrets, only for its own source`);
  }
  assert.doesNotMatch(b, /\$\{\{ inputs\.(from|to|only|max_minutes) \}\}[^\n]*\n?[^\n]*python/, 'inputs reach the script through env, not pasted into the script');
  assert.match(b, /case "\$ONLY" in \*\[!A-Za-z0-9_,\]\*\)/, 'only takes names and commas');
  const s = step('history-backfill.yml', 'Save to the raw branch');
  assert.match(s, /bash scripts\/push_raw\.sh "history backfill \$SOURCE" "\$DIR"/);
  assert.doesNotMatch(s, /RAW_SOFT/, 'the last save is hard: a red run says the history did not land');
});

// ---------------------------------------------------------------- no new schedule (Sig, Oct 21)
function crons(text) {
  // quoted ('17 20 * * 1,2'), with or without a comment after it, or bare
  return noComments(text).split('\n').map((l) => {
    const m = l.match(/^\s*-?\s*cron:\s*(?:(['"])(.+?)\1|([^'"#\s][^#]*?))\s*(?:#.*)?$/);
    return m ? (m[2] || m[3]).trim() : null;
  }).filter(Boolean);
}
test('no workflow gained a schedule: every cron line is already on origin/main', (t) => {
  const has = spawnSync('git', ['rev-parse', '--verify', '-q', 'origin/main'], { cwd: root, encoding: 'utf8' });
  if (has.status !== 0) { t.skip('origin/main is not fetched here'); return; }
  const added = [];
  let n = 0;
  for (const f of workflows) {
    const now = crons(read(`${WF}/${f}`));
    const old = spawnSync('git', ['show', `origin/main:${WF}/${f}`], { cwd: root, encoding: 'utf8' });
    const before = old.status === 0 ? crons(old.stdout) : [];
    for (const c of now) {
      n++;
      if (!before.includes(c)) added.push(`${f}: cron '${c}'${old.status === 0 ? '' : ' (new workflow)'}`);
    }
  }
  assert.ok(n > 50, `found ${n} cron lines; the reader lost them`);
  // A schedule Sig has approved in so many words (STANDING-DECISIONS), exactly as approved and nothing else:
  //   Oct 23 2026: the monthly "my county's rain" email, "new list, sender and schedule approved", on the 2nd.
  //   Oct 23 2026: "County rain pages rebuild daily (was Mondays)": county-rain.yml every day at the old time.
  const APPROVED = { 'rain-monthly.yml': ['41 14 2 * *'], 'county-rain.yml': ['23 13 * * *'], 'stats-ingest.yml': ['47 12 * * *'] };  // stats-ingest: Sig, Oct 23 2026
  const left = added.filter((a) => !Object.entries(APPROVED).some(([f, cs]) => cs.some((c) => a === `${f}: cron '${c}' (new workflow)` || a === `${f}: cron '${c}'`)));
  assert.deepEqual(left, [], 'a new schedule is Sig\'s decision: list it in the report, do not add it');
});

// ---------------------------------------------------------------- the ongoing pieces ride existing jobs
test('drought: the weekly job writes this year\'s county maps to history and saves them softly', () => {
  assert.match(read('scripts/fetch_drought_county_week.py'), /from backfill_usdm import ongoing\n\s+ongoing\(rows, set\(failed\), today - timedelta\(days=WINDOW_DAYS\)\)/);
  const s = step('drought-county-week.yml', "Save this year's county maps to the raw history");
  assert.match(s, /bash scripts\/push_raw\.sh "drought county history" history\/usdm-county/);
  assert.match(s, /RAW_SOFT: '1'/);
  assert.match(s, /!\(github\.event_name == 'workflow_dispatch' && inputs\.probe\)/, 'not on a probe run');
  const y = read(`${WF}/drought-county-week.yml`);
  assert.ok(y.indexOf("Save this year's county maps") > y.indexOf('- name: Fetch and write data/drought/county-week.json'));
});

test('crop progress: the Monday job adds the last three years after its commit, never failing the run', () => {
  const s = step('crop_progress.yml', 'Crop progress history to the raw branch');
  assert.match(s, /continue-on-error: true/);
  assert.match(s, /NASS_API_KEY: \$\{\{ secrets\.NASS_API_KEY \}\}/);
  assert.match(s, /python scripts\/backfill_nass_progress\.py --current/);
  assert.match(s, /bash scripts\/push_raw\.sh "crop progress history" history\/nass-progress/);
  const y = read(`${WF}/crop_progress.yml`);
  assert.ok(y.indexOf('- name: Crop progress history') > y.indexOf('- name: Commit data/crop-progress.json'), 'after the commit');
});

test('cattle auctions: per-barn receipts history after the commit, never failing the run', () => {
  const s = step('cattle-auction.yml', 'Barn receipts history to the raw branch');
  assert.match(s, /continue-on-error: true/);
  assert.match(s, /python scripts\/history_append\.py cattle/);
  assert.match(s, /bash scripts\/push_raw\.sh "cattle receipts history" history\/cattle-auction/);
  const y = read(`${WF}/cattle-auction.yml`);
  assert.ok(y.indexOf('- name: Barn receipts history') > y.indexOf('- name: Commit if changed'), 'after the commit');
});

test('morning report: reader counts by area to private-data, after the email, never on a dry run', () => {
  const s = step('morning-report.yml', 'Reader counts by area to the private-data branch');
  assert.match(s, /continue-on-error: true/);
  assert.match(s, /inputs\.dry_run != true/);
  assert.match(s, /RAW_BRANCH: private-data/);
  assert.match(s, /python3 scripts\/reader_area_counts\.py/);
  assert.match(s, /bash scripts\/push_raw\.sh "reader counts by area" private\/data\/reader-area/);
  const y = read(`${WF}/morning-report.yml`);
  assert.ok(y.indexOf('- name: Reader counts by area') > y.indexOf('- name: Build and send'), 'after the email');
});

test('bid snapshots: a live day under 500 locations waits for the next run, and a refusal never pushes', () => {
  const b = read('scripts/bid_snapshots.py');
  assert.match(b, /^MIN_LOCS = 500$/m);
  assert.match(b, /if gate == "wait":\n\s+print\([^\n]+\)\n\s+return 3/);
  const s = step('fetch_bids.yml', 'Daily bid snapshot to the raw branch');
  assert.match(s, /build --from bids-full\.json --day "\$day" \\\n\s+\|\| \{ echo "::warning::bid snapshot for \$day not built[^\n]*; exit 0; \}/,
    'a refused build exits before the push, so the day is still due on the next run');
});

test('history never reaches main', () => {
  const ignored = (p) => spawnSync('git', ['check-ignore', '-q', '--no-index', p], { cwd: root }).status === 0;
  for (const p of ['history/usdm-county/2025/IA.csv.gz', 'history/agtransport/manifest.json', 'private/data/reader-area/2026/2026-10-21.json']) {
    assert.ok(ignored(p), `${p} is ignored on main`);
  }
});
