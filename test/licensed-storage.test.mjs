/**
 * Licensed grain storage, Nebraska PSC Location Capacity Report (fx/necap, Oct 28 2026).
 * data/licensed-storage/NE.json is written by scripts/fetch_ne_capacity.py from the PSC PDF
 * (references branch, id ne-psc-capacity-2026-10-28). Rows below were read by hand from that report:
 *   191 LOCATIONS, TOTAL CAPACITY 451,999,873; 12 of them in Kansas under Nebraska licences
 *   licence 279 Farmers Cooperative, Dorchester (Saline) 6,855,106; licence 279 subtotal 108,999,343
 *   licence 852 Country Partners Cooperative, Gothenburg (Dawson) 7,116,155
 *   licence 279 Frankfort North, KS (Marshall KS) 6,248,529 (city and county run together in the text)
 * The cash-bid town pages print "Licensed storage: X bushels (Nebraska PSC, report of <date>)" for a
 * matched elevator, and the Nebraska state page the report's totals.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const doc = JSON.parse(read('data/licensed-storage/NE.json'));
const row = (lic, city) => doc.locations.find((r) => r.lic === lic && r.city === city);

test('the file adds up to its own totals (any report)', () => {
  assert.equal(doc.locations.length, doc.totals.locations);
  assert.equal(doc.locations.reduce((a, r) => a + r.bu, 0), doc.totals.bushels);
  const ne = doc.locations.filter((r) => r.st === 'NE');
  assert.equal(ne.length, doc.totals.by_state.NE.locations);
  assert.equal(ne.reduce((a, r) => a + r.bu, 0), doc.totals.by_state.NE.bushels);
  assert.match(doc.source.url, /^https:\/\/psc\.nebraska\.gov\//);
  assert.match(doc.source.as_of, /^\d{4}-\d{2}-\d{2}$/);
  // a join is one id per row and one row per id; unjoined and ambiguous rows are listed, never guessed
  const ids = doc.locations.filter((r) => r.id).map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'one facility claimed by two rows');
  assert.equal(ids.length + doc.unjoined.length + doc.ambiguous.length, doc.locations.length);
  for (const a of doc.ambiguous) assert.equal(doc.locations[a.i].id, null);
  for (const r of doc.locations) assert.ok(r.id === null || ['name+town', 'alias+town'].includes(r.how), r.how);
});

test('the Oct 28, 2026 report, read by hand', { skip: doc.source.as_of !== '2026-10-28' && 'a newer report is in the file' }, () => {
  assert.equal(doc.totals.locations, 191);
  assert.equal(doc.totals.bushels, 451999873);
  assert.deepEqual(doc.totals.by_state.KS, { locations: 12, bushels: 30673483 });
  assert.equal(row('279', 'Dorchester').bu, 6855106);
  assert.equal(row('279', 'Dorchester').fips, '31151');
  assert.equal(row('852', 'Gothenburg').bu, 7116155);
  const fk = row('279', 'Frankfort North');
  assert.deepEqual([fk.st, fk.county, fk.bu], ['KS', 'Marshall', 6248529]);
  assert.equal(doc.locations.filter((r) => r.lic === '279').reduce((a, r) => a + r.bu, 0), 108999343);
  assert.equal(row('852', 'Gothenburg').how, 'name+town');
  assert.equal(row('279', 'Dorchester').how, 'alias+town');
  // "Farmers Cooperative" (licence 405, Pilger) is only legal words: no join on the name
  assert.equal(row('405', 'Pilger').id, null);
});

test('parser, join and page lines: selftests from real rows', () => {
  execFileSync('python3', ['scripts/fetch_ne_capacity.py', '--selftest'], { cwd: root, stdio: 'pipe' });
  execFileSync('python3', ['scripts/fetch_ne_capacity.py', '--check'], { cwd: root, stdio: 'pipe' });
});

test('the source is credited and linked where the number shows; no em dash', () => {
  const py = read('scripts/fetch_ne_capacity.py');
  const fn = py.slice(py.indexOf('def storage_line_html'), py.indexOf('def state_note_html'));
  assert.match(fn, /Licensed storage: \{row\["bu"\]:,\} bushels/);
  assert.match(fn, /<a href="\{esc\(s\["url"\]\)\}"[^>]*>\{esc\(s\["short"\]\)\}<\/a>, report of/);
  assert.equal(doc.source.short, 'Nebraska PSC');
  const note = py.slice(py.indexOf('def state_note_html'), py.indexOf('# ---------------------------------------------------------------- CLI'));
  assert.match(note, /esc\(s\["short"\]\)/);
  assert.ok(!py.includes(String.fromCharCode(0x2014)), 'no em dash');
});

test('the reference copy is listed and the updater runs by hand only', () => {
  const src = JSON.parse(read('references/sources.json')).sources;
  assert.ok(src.some((s) => s.id === 'ne-psc-capacity-2026-10-28' && s.kind === 'pdf'
    && s.url === 'https://psc.nebraska.gov/sites/default/files/doc/2026-10-28%20Location%20Capacity%20Report.pdf'));
  const y = read('.github/workflows/ne-capacity.yml');
  assert.doesNotMatch(y.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n'), /schedule:|cron:/);
  assert.match(y, /workflow_dispatch:/);
  assert.match(y, /fetch_ne_capacity\.py --txt/);
  assert.match(read('scripts/build_cash_bid_pages.py'), /attach_storage\(towns, ctx, root\)/);
});
