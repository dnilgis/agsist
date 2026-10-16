// /hay-prices, AMS section: this week's hay trades by grade and bale type from
// the USDA AMS state hay reports (scripts/fetch_hay_ams.py -> data/hay/ams-hay.json,
// components/hay-ams.js), beside the NASS monthly price received. The two are
// labeled apart and never blended; no file means the designed empty state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const A = require('../components/hay-ams.js');
const page = fs.readFileSync(path.join(root, 'hay-prices.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'components/hay-ams.js'), 'utf8');
const NOW = Date.parse('2026-10-16T23:00:00Z');

// South Dakota Direct Hay Report, Fri Oct 16, 2026 (AMS 3183), rows typed from
// the report (test/fixtures/hay-ams/ams_3183-2026-10-16.txt).
const row = (commodity, grade, bale, qty, lo, hi, avg) => ({ kind: 'hay', organic: false, commodity, grade, bale, qty, lo, hi, avg, freight: 'F.O.B.', desc: '' });
const SD = {
  id: 'sd-direct', state: 'SD', state_name: 'South Dakota', title: 'South Dakota Direct Hay Report', kind: 'direct',
  date: '2026-10-16', week_ending: '2026-10-16', last_reported: '2026-08-31', biweekly: false,
  tons: { hay: { week: 1625, last: 625, year: 1650 } }, comment: 'Good to very good demand for all classes of hay.',
  source_url: 'https://mymarketnews.ams.usda.gov/viewReport/3183', per_bale_tables: 0, status: { ok: true },
  rows: [
    row('Alfalfa', 'Supreme', 'Large Square 3x4', 250, 300, 300, 300),
    row('Alfalfa', 'Premium', 'Large Round', 200, 210, 210, 210),
    row('Alfalfa', 'Premium', 'Large Square 3x4', 250, 250, 250, 250),
    row('Alfalfa', 'Good/Premium', 'Large Round', 500, 200, 200, 200),
    row('Alfalfa', 'Fair', 'Large Round', 125, 180, 180, 180),
    row('Grass', 'Premium', 'Large Round', 100, 200, 200, 200),
    row('Grass', 'Good', 'Large Round', 200, 175, 175, 175),
  ],
};
const AL = {
  id: 'al-direct', state: 'AL', state_name: 'Alabama', title: 'Alabama Direct Report (Bi-Weekly)', biweekly: true,
  date: '2026-10-01', rows: [row('Bermuda Grass', 'Good', 'Medium Round', 372, 100, 120, 107.63),
    { ...row('Wheat', '', 'Small Square', 13.25, 300, 300, 300), kind: 'straw' },
    row('Bahia Grass', 'Premium', 'Small Square', 0.5, 400, 400, null)],
};

test('page: AMS section first, honest empty state, both sources labeled apart', () => {
  const ams = page.indexOf('id="hp-ams"'), nass = page.indexOf('id="hp-live"');
  assert.ok(ams > 0 && ams < nass, 'this week\'s trades come before the monthly table');
  assert.match(page, /<div id="hp-ams-live"[^>]*><p class="hp-empty[^"]*"><b>Trades load after the first USDA read\.<\/b>/);
  assert.match(page, /<script src="\/components\/hay-ams\.js\?v=\d+" defer><\/script>/);
  assert.match(page, /class="hp-ams-tag hp-ams-tag-n">NASS monthly</);
  assert.match(js, />AMS this week</);
  assert.match(js, /not this week&rsquo;s trades/, 'the NASS line says what it is not');
  for (const [n, s] of [['html', page], ['js', js]]) assert.doesNotMatch(s, /—|&mdash;|&#8212;/, n + ' em dash');
  assert.doesNotMatch(js, /\$\s?\d/, 'the script types no price');
});

test('no file, or a file with no rows: nothing drawn (the empty state stays)', () => {
  assert.equal(A.view(null, NOW), null);
  assert.equal(A.view({ reports: [] }, NOW), null);
  assert.equal(A.view({ reports: [{ ...SD, rows: [] }] }, NOW), null);
});

test('South Dakota, Oct 16, 2026: ranges and grade order, worked from the report', () => {
  const v = A.view({ reports: [SD, AL] }, NOW);
  assert.deepEqual(v.map((r) => r.state), ['AL', 'SD'], 'sorted by state name');
  const sd = v[1];
  // alfalfa: lowest Fair 180, highest Supreme 300, tons 250+200+250+500+125 = 1325
  assert.deepEqual(sd.sum.alfalfa, { lo: 180, hi: 300, tons: 1325 });
  // other hay (grass): 175 to 200 on 300 tons
  assert.deepEqual(sd.sum.other, { lo: 175, hi: 200, tons: 300 });
  assert.equal(sd.sum.straw, null);
  assert.deepEqual(sd.groups.map((g) => g.commodity), ['Alfalfa', 'Grass'], 'alfalfa first');
  assert.deepEqual(sd.groups[0].rows.map((r) => r.grade), ['Supreme', 'Premium', 'Premium', 'Good/Premium', 'Fair']);
  assert.equal(sd.age, 0);
  assert.equal(sd.old, false);
  assert.equal(A.gradeRank('Good/Premium') < A.gradeRank('Good'), true);
  assert.equal(A.gradeRank('odd grade'), A.GRADES.length, 'an unknown grade sorts last, never dropped');
});

test('Alabama: straw kept apart, a missing average stays missing, bi-weekly age', () => {
  const al = A.view({ reports: [AL] }, NOW)[0];
  assert.deepEqual(al.groups.map((g) => g.kind + ':' + g.commodity), ['hay:Bahia Grass', 'hay:Bermuda Grass', 'straw:Wheat']);
  assert.deepEqual(al.sum.straw, { lo: 300, hi: 300, tons: 13.25 });
  assert.equal(al.groups[0].rows[0].avg, null);
  assert.equal(al.age, 15);
  assert.equal(al.old, false, 'bi-weekly: 15 days is current');
  const later = A.view({ reports: [AL] }, Date.parse('2026-11-10T12:00:00Z'))[0];
  assert.equal(later.old, true, '40 days is old even for a bi-weekly report');
  const sdLate = A.view({ reports: [SD] }, Date.parse('2026-11-10T12:00:00Z'))[0];
  assert.equal(sdLate.old, true, 'a weekly report 25 days old is flagged');
});

test('NASS beside AMS: the state\'s newest month, labeled, never blended', () => {
  const nass = { latest: '2026-08', released: '2026-09-29', months: ['2026-07', '2026-08'],
    series: { alfalfa: { states: { SD: [100, 101] } }, other: { states: { SD: [91, 'S'] } } } };
  assert.deepEqual(A.nassFor(nass, 'SD', 'alfalfa'), { v: 101, flag: null, month: 'August 2026', released: 'Sep 29, 2026' });
  const o = A.nassFor(nass, 'SD', 'other');
  assert.equal(o.v, null, 'too few reports stays empty');
  assert.equal(o.flag, 'S');
  assert.equal(A.nassFor(nass, 'SD', 'all'), null);
  assert.equal(A.nassFor(null, 'SD', 'alfalfa'), null);
  const live = JSON.parse(fs.readFileSync(path.join(root, 'data/hay/hay-prices.json'), 'utf8'));
  const sd = A.nassFor(live, 'SD', 'alfalfa');
  assert.ok(sd && sd.month && (sd.v === null || sd.v > 0));
});

test('the reader selftest passes; the workflow runs it first and has a probe and a scan', () => {
  const out = execFileSync('python3', [path.join(root, 'scripts/fetch_hay_ams.py'), '--selftest'], { encoding: 'utf8' });
  assert.match(out, /all AMS hay checks pass/);
  const wf = fs.readFileSync(path.join(root, '.github/workflows/hay-ams.yml'), 'utf8');
  assert.ok(wf.indexOf('--selftest') < wf.indexOf('--probe'));
  assert.match(wf, /inputs\.probe/);
  assert.match(wf, /inputs\.scan/);
  assert.match(wf, /data\/hay\/ams-hay\.json data\/hay-ams-raw/);
});

test('a data file, when present, is shaped right and checks out', () => {
  const p = path.join(root, 'data/hay/ams-hay.json');
  if (!fs.existsSync(p)) return;
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.ok(Array.isArray(d.reports));
  for (const r of d.reports) {
    assert.match(r.state, /^[A-Z]{2}$/);
    for (const x of r.rows || []) {
      assert.ok(x.qty > 0 && x.lo > 0 && x.hi >= x.lo, r.id);
      if (x.avg != null) assert.ok(x.avg >= x.lo - 0.005 && x.avg <= x.hi + 0.005, r.id + ' avg in range');
    }
  }
});
