/**
 * Chapter 12 (family farmer and fisherman) bankruptcy filings, Oct 28 2026.
 * data/farm-stress/chapter12.json is built by scripts/build_chapter12.py from the
 * U.S. Courts Table F-2 PDFs (references branch). These rows were read by hand
 * from those tables, so a parser change that moves any of them fails here:
 *   12 months to Sep 30, 2026: national 361 (footnote "12 (361)"), IA,N 4, IA,S 7, WI,E 6, AR 34
 *   2025: national 315, NE 17     2024: national 216, WI,W 0     2023: national 139, KS 10
 *   2017: AR,E 4 + AR,W 5 (separate courts then)     2010: MN 11 (old layout, 4th number)
 * The state Farmland Atlas pages carry one small line with the U.S. Courts credit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const doc = JSON.parse(read('data/farm-stress/chapter12.json'));
const nat = Object.fromEntries(doc.periods.map((p) => [p.end, p.national]));

test('national totals match the F-2 tables', () => {
  assert.equal(nat['2026-09-30'], 361);
  assert.equal(nat['2025-12-31'], 315);
  assert.equal(nat['2024-12-31'], 216);
  assert.equal(nat['2023-12-31'], 139);
  assert.equal(doc.periods.at(-1).end, '2026-09-30');
  assert.match(doc.periods.at(-1).note, /chapters 9 \(3\), 12 \(361\) and 15 \(259\)/);
});

test('district rows match the F-2 tables, both layouts', () => {
  const d = doc.districts;
  assert.equal(d['IA,N']['2026-09-30'], 4);
  assert.equal(d['IA,S']['2026-09-30'], 7);
  assert.equal(d['WI,E']['2026-09-30'], 6);
  assert.equal(d['AR']['2026-09-30'], 34);
  assert.equal(d['NE']['2025-12-31'], 17);
  assert.equal(d['WI,W']['2024-12-31'], 0);
  assert.equal(d['KS']['2023-12-31'], 10);
  assert.equal(d['MN']['2010-12-31'], 11);
  assert.equal(d['AR,E']['2017-12-31'], 4);
  assert.equal(d['AR,W']['2017-12-31'], 5);
});

test('a state is the sum of its districts; every period adds up', () => {
  assert.equal(doc.states.IA.n['2026-09-30'], 11);
  assert.deepEqual(doc.states.IA.districts, ['IA,N', 'IA,S']);
  assert.equal(doc.states.AR.n['2017-12-31'], 9);
  assert.deepEqual(doc.states.AR.districts, ['AR']);
  for (const p of doc.periods) {
    const sum = Object.values(doc.districts).reduce((a, v) => a + (v[p.end] || 0), 0);
    assert.equal(sum, p.national, p.end);
    assert.match(p.url, /^https:\/\/www\.uscourts\.gov\//, p.end);
  }
  assert.equal(Object.keys(doc.states).length, 51);
});

test('12-month periods only, never a quarter', () => {
  for (const p of doc.periods) assert.match(p.label, /^(12 months to (Mar 31|Jun 30|Sep 30), \d{4}|calendar \d{4})$/);
});

test('builder selftest and --check pass', () => {
  execFileSync('python3', ['scripts/build_chapter12.py', '--selftest'], { cwd: root, stdio: 'pipe' });
  execFileSync('python3', ['scripts/build_chapter12.py', '--check'], { cwd: root, stdio: 'pipe' });
});

test('every state Atlas page carries the line, credited and linked to the table', () => {
  const dirs = fs.readdirSync(path.join(root, 'farmland-atlas')).filter((s) => fs.existsSync(path.join(root, 'farmland-atlas', s, 'index.html')) && s !== 'states');
  assert.equal(dirs.length, 50);
  for (const s of dirs) {
    const t = read(`farmland-atlas/${s}/index.html`);
    const m = t.match(/<div class="fact st ch12">[\s\S]*?<\/div>/);
    assert.ok(m, s);
    assert.match(m[0], /Farm bankruptcies \(Chapter 12\)/, s);
    assert.match(m[0], /\d+ filings?</, s);
    assert.match(m[0], /12 months to Sep 30, 2026/, s);
    assert.match(m[0], /U\.S\. Courts, Table F-2</, s); // named in text; no direct link to the table (Oct 29)
    assert.doesNotMatch(m[0], /href="https:\/\/www\.uscourts\.gov/, s);
    assert.doesNotMatch(m[0], /—|quarter|per farm| farms/i, s);
  }
  const ia = read('farmland-atlas/iowa/index.html').match(/<div class="fact st ch12">[\s\S]*?<\/div>/)[0];
  assert.match(ia, /11 filings<small>family farm and fishing cases filed, 12 months to Sep 30, 2026 · 18 in 2025, 7 in 2024 · Iowa&#x27;s two federal court districts added together/);
  assert.match(read('farmland-atlas/arkansas/index.html'), /34 filings<small>[^<]*one court for both Arkansas districts/);
});

test('the Daily fact: dated, sourced, the table\'s own words', () => {
  const f = JSON.parse(read('data/daily-facts.json')).facts.find((x) => x.id === 'ch12-latest');
  assert.ok(f);
  assert.match(f.fact, /filed 361 Chapter 12 bankruptcy cases in the 12 months to Sep 30, 2026\./);
  assert.match(f.fact, /not a farm sold or closed/);
  assert.equal(f.url, 'https://www.uscourts.gov/sites/default/files/document/bf_f2_0930.2026.pdf');
  assert.match(f.quote, /12 \(361\)/);
  assert.match(f.checked, /^\d{4}-\d{2}-\d{2}$/);
  assert.doesNotMatch(f.fact, /—/);
});

test('the updater runs by hand only (a schedule needs Sig\'s OK)', () => {
  const y = read('.github/workflows/chapter12.yml');
  assert.doesNotMatch(y.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n'), /schedule:|cron:/);
  assert.match(y, /workflow_dispatch:/);
  assert.match(read('.github/workflows/farmland-atlas-pages.yml'), /"Chapter 12 filings"/);
});
