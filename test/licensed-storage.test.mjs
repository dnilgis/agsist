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

/**
 * North Dakota and Wisconsin (fx/ndwicap, Oct 28 2026). Shared join: scripts/licensed_storage.py.
 * ND: GrainEntities_624.pdf (ND Dept. of Agriculture; PDF dated Jun 7, 2024; read Oct 28, 2026,
 *   sha256 a4963ca3...). Counted by hand from its text: 257 entities (one bond line each), 147 capacity
 *   figures adding to 529,961,407 bu; licences 354 grain warehouse, 37 processor, 121 roving buyer,
 *   1 broker. Northwood Equity Elevator Company (1050): Hatton (3261) and Northwood (53), 4,074,000 bu
 *   for the two. Voss Grain Company (1082): Voss (13), 258,000 bu. Warehouse licence 1249 is printed
 *   under both Taft Elevator (Amenia) and Great Northern Ag (Bowman).
 * WI: LicensedGrainDealersAndWarehouseKeepers.xls (DATCP; sheet "as of May 4, 2026"; read Oct 28, 2026,
 *   sha256 3a49582f...). Its count row: 205 dealer, 83 warehouse keeper licenses; no capacity column.
 *   121 Farms LLC, Independence: dealer 560300, warehouse keeper 559335.
 */
const nd = JSON.parse(read('data/licensed-storage/ND.json'));
const wi = JSON.parse(read('data/licensed-storage/WI.json'));

for (const [st, d] of [['ND', nd], ['WI', wi]]) {
  test(`${st}: one row per location, joins one to one, listed when not (any list)`, () => {
    assert.equal(d.locations.length, d.totals.locations);
    const ids = d.locations.filter((r) => r.id).map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, 'one facility claimed by two rows');
    assert.equal(ids.length + d.unjoined.length + d.ambiguous.length, d.locations.length);
    assert.equal(d.join.joined, ids.length);
    for (const a of d.ambiguous) assert.equal(d.locations[a.i].id, null);
    for (const r of d.locations) {
      assert.equal(r.st === st || r.id === null, true, `${r.lic}: joined outside ${st}`);
      assert.ok(r.id === null || ['name+town', 'alias+town'].includes(r.how), r.how);
    }
    // no contact data from the lists: no email, phone or street address
    const raw = JSON.stringify(d);
    assert.doesNotMatch(raw, /@|\(\d{3}\) ?\d{3}-\d{4}|\bP\.? ?O\.? Box\b/i);
  });
}

test('ND: the list as counted by hand', { skip: nd.source.file_date !== '2024-06-07' && 'a newer list is in the file' }, () => {
  assert.equal(nd.source.url, 'https://www.ndda.nd.gov/sites/www/files/documents/files/GrainEntities_624.pdf');
  assert.equal(nd.source.sha256, 'a4963ca33f2056365b7cd2601e47300bbb385a9fcda518fea76e98bef21b8bec');
  assert.equal(nd.totals.entities, 257);
  assert.equal(nd.totals.with_capacity, 147);
  assert.equal(nd.totals.bushels, 529961407);
  assert.deepEqual(nd.totals.licences, { warehouse: 354, processor: 37, roving: 121, broker: 1 });
  const by = (lic, city) => nd.locations.find((r) => r.lic === lic && r.city === city);
  for (const [lic, city] of [['3261', 'Hatton'], ['53', 'Northwood']]) {
    const r = by(lic, city);
    assert.deepEqual([r.ent, r.ent_bu, r.ent_n], ['1050', 4074000, 2], `${city}`);
  }
  assert.deepEqual([by('13', 'Voss').ent_bu, by('13', 'Voss').ent_n], [258000, 1]);
  const twice = nd.locations.filter((r) => r.lic === '1249');
  assert.deepEqual(twice.map((r) => [r.wh, r.lic_twice]).sort(), [['Amenia', true], ['Great Northern Ag- Bowman', true]]);
  // a licensee's capacity is shared, never split: every row of an entity carries the same total
  const ents = new Map();
  for (const r of nd.locations) {
    const e = ents.get(r.ent) || { bu: r.ent_bu, n: 0 };
    assert.equal(e.bu, r.ent_bu, `entity ${r.ent}`);
    e.n += 1; ents.set(r.ent, e);
  }
  for (const [k, e] of ents) assert.equal(nd.locations.find((r) => r.ent === k).ent_n, e.n, `entity ${k}`);
  assert.equal([...ents.values()].reduce((a, e) => a + e.bu, 0), nd.totals.bushels);
});

test('WI: the list as counted by hand; no capacity anywhere', { skip: wi.source.as_of !== '2026-05-04' && 'a newer list is in the file' }, () => {
  assert.equal(wi.source.url, 'https://datcp.wi.gov/Documents/LicensedGrainDealersAndWarehouseKeepers.xls');
  assert.equal(wi.source.sha256, '3a49582f7d4397fba226a28e5bc54ab910da2e0ebce1030818816948ecead860');
  assert.equal(wi.totals.dealer_licences, 205);
  assert.equal(wi.totals.warehouse_keepers, 83);
  const r = wi.locations.find((x) => x.lic === '559335');
  assert.deepEqual([r.name, r.city, r.dealer], ['121 Farms LLC', 'Independence', '560300']);
  for (const x of wi.locations) assert.ok(!('bu' in x) && !('ent_bu' in x), `${x.lic} carries a capacity`);
});

test('ND and WI: selftests from real rows, the files still hold, the pages read every state', () => {
  for (const s of ['fetch_nd_storage', 'fetch_wi_storage']) {
    execFileSync('python3', [`scripts/${s}.py`, '--selftest'], { cwd: root, stdio: 'pipe' });
    execFileSync('python3', [`scripts/${s}.py`, '--check'], { cwd: root, stdio: 'pipe' });
  }
  const ls = read('scripts/licensed_storage.py');
  const readers = ls.slice(ls.indexOf('def readers'));
  for (const m of ['fetch_ne_capacity', 'fetch_nd_storage', 'fetch_wi_storage']) assert.match(readers, new RegExp(`import ${m}`));
  const b = read('scripts/build_cash_bid_pages.py');
  const fn = b.slice(b.indexOf('def attach_storage'), b.indexOf('def build_all('));
  assert.match(fn, /LSTO\.readers\(\)/);
  assert.match(fn, /r\["st"\] == t\["state"\]/, 'a row lands only on its own state\'s pages');
  assert.match(fn, /places\[bd\["source"\]\] == 1/, 'a board posting at several places gets no line');
  // the readers use the shared join, not their own copy
  for (const s of ['fetch_ne_capacity', 'fetch_nd_storage', 'fetch_wi_storage']) {
    const py = read(`scripts/${s}.py`);
    assert.match(py, /LS\.join\(/, `${s} joins through licensed_storage`);
    assert.doesNotMatch(py, /def join\([^)]*\):\n(?:(?!\ndef ).)*by_town/s, `${s} carries its own join`);
    assert.ok(!py.includes(String.fromCharCode(0x2014)), `${s}: no em dash`);
  }
});

test('ND and WI: credited and linked where the line shows; WI never prints bushels', () => {
  const ndp = read('scripts/fetch_nd_storage.py');
  const ndl = ndp.slice(ndp.indexOf('def _credit'), ndp.indexOf('def state_note_html'));
  assert.match(ndl, /<a href="\{esc\(s\["url"\]\)\}"[^>]*>\{esc\(s\["short"\]\)\}<\/a> list, /);
  assert.match(ndl, /file dated/);
  assert.match(ndl, /no figure per location/, 'a licensee total is said as a total');
  assert.equal(nd.source.short, 'ND Dept. of Agriculture');
  const wip = read('scripts/fetch_wi_storage.py');
  const wil = wip.slice(wip.indexOf('def _credit'), wip.indexOf('def state_note_html'));
  assert.match(wil, /<a href="\{esc\(s\["url"\]\)\}"[^>]*>\{esc\(s\["short"\]\)\}<\/a>/);
  assert.match(wil, /Licensed grain warehouse keeper \(/);
  assert.doesNotMatch(wil, /bushel|ent_bu|\["bu"\]/);
  assert.equal(wi.source.short, 'WI DATCP');
});

test('ND and WI: the reference copy is listed and the updater runs by hand only', () => {
  const src = JSON.parse(read('references/sources.json')).sources;
  assert.ok(src.some((s) => s.id === 'nd-grain-entities-624' && s.kind === 'pdf' && s.url === nd.source.url));
  const y = read('.github/workflows/nd-wi-storage.yml');
  assert.doesNotMatch(y.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n'), /schedule:|cron:/);
  assert.match(y, /workflow_dispatch:/);
  assert.match(y, /fetch_nd_storage\.py --pdf/);
  assert.match(y, /fetch_wi_storage\.py --xls/);
  assert.match(y, /xlrd==2\.0\.1/);
});
