// Feeder cattle boxes (Sig, Oct 20): RMA's feeder steer value beside the futures,
// and AGSIST weekly sale barn prices by region and weight. Numbers come from
// scripts/build_feeder_index.py (its --selftest holds the hand-worked math:
// pounds weighting, head and barn gates, regions, week boundaries, the RMA type
// picked by meaning). This file tests what the pages draw and that each page
// carries the box, its credit and the "not the index" wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const comp = fs.readFileSync(path.join(root, 'components/feeder-index.js'), 'utf8');

function views() {
  const m = /\/\*feeder:start\*\/([\s\S]*?)\/\*feeder:end\*\//.exec(comp);
  assert.ok(m, 'the component carries its view functions');
  // eslint-disable-next-line no-new-func
  return new Function(m[1] + '\nreturn {rmaView, tableView, sliceView, cellView};')();
}
const V = views();
const NOW = Date.parse('2026-10-21T15:00:00Z');

const hist = [];
for (let i = 0; i < 30; i++) hist.push(['2026-09-' + String(i + 1).padStart(2, '0'), 330 + i]);
const D = {
  rma: { ok: true, label: "RMA's LRP actual ending value, feeder steers 6 to 10 cwt (factor 1.00)", basis_note: 'note',
    date: '2026-10-12', value: 341.47, fut: { ticker: 'GFV26', settle: 340, date: '2026-10-12' }, diff: 1.47, hist },
  auction: {
    name: 'AGSIST feeder cattle prices, by region and weight',
    week: { start: '2026-10-12', end: '2026-10-18' }, prior: { start: '2026-10-05', end: '2026-10-11' },
    gates: { barns: 3, head: 300 },
    regions: [{ id: 'us', name: 'All barns', states: [] }, { id: 'midwest', name: 'Midwest', states: ['IA', 'IL'] }],
    table: { steers: {
      us: { '400': { p: 504.75, head: 9755, barns: 57, prev: 515.21, both: 12, chg: -10.46 },
        '500': { p: null, head: 250, barns: 5, why: 'too few sales', prev: null, both: 0, chg: null },
        '600': { p: 399.07, head: 10190, barns: 54, prev: 390, both: 2, chg: null },
        '700': { p: 354.41, head: 4932, barns: 48, prev: null, both: 0, chg: null },
        '800': { p: null, head: 0, barns: 0, why: 'no sales', prev: null, both: 0, chg: null },
        '700-899': { p: 347.85, head: 9595, barns: 55, prev: null, both: 0, chg: null } },
      midwest: {} } },
  },
  check: { week: '2026-10-12', agsist: 347.85, rma: 341.0, rma_days: 3, gap: 6.85 },
};

test('RMA box: value with its date, futures for the same day, and the difference', () => {
  const v = V.rmaView(D, NOW);
  assert.equal(v.val, '$341.47');
  assert.equal(v.date, 'Oct 12, 2026');
  assert.match(v.meta, /^Ending value, steers 6 to 10 cwt, <a href="https:\/\/pubfs-rma\.fpac\.usda\.gov\/pub\/References\/adm_livestock\/" rel="noopener">USDA RMA<\/a>\.$/);
  assert.equal(v.fut, 'RMA minus GFV26 settle $340.00');
  assert.equal(v.diff, '+$1.47');
  assert.match(v.range, /^Since Sep 1, 2026: low \$330\.00 on Sep 1, 2026, high \$359\.00 on Sep 30, 2026 \(30 days with a value\)\.$/);
});

test('RMA box: the label never calls the value the CME index', () => {
  const v = V.rmaView(D, NOW);
  assert.doesNotMatch(v.label, /index/i);
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data/feeder-index.json'), 'utf8'));
  assert.doesNotMatch(data.rma.label, /index/i);
  assert.match(data.rma.basis_note, /does not call it the index/);
});

test('RMA box: no settle for the day says so, an old value is a dash, a missing file says it did not load', () => {
  const noFut = V.rmaView({ ...D, rma: { ...D.rma, fut: null, diff: null } }, NOW);
  assert.equal(noFut.diff, null);
  assert.match(noFut.futNote, /^No futures settle held for Oct 12\.$/);
  const old = V.rmaView(D, Date.parse('2026-11-05T15:00:00Z'));
  assert.equal(old.val, '-');
  assert.match(old.meta, /^Latest held: Oct 12, 2026\. RMA has not posted a newer value/);
  assert.equal(old.diff, null);
  assert.equal(V.rmaView(null, NOW).down, true);
  assert.match(V.rmaView(null, NOW).msg, /did not load/);
  assert.equal(V.rmaView({ rma: { ok: false } }, NOW).down, true);
  assert.equal(V.rmaView({ rma: { ...D.rma, value: 0 } }, NOW).down, true, 'a zero is never drawn');
});

test('weekly table: prices with barns and head, withheld cells say why, change only when earned', () => {
  const v = V.tableView(D, 'steers', 'us', NOW);
  assert.equal(v.week, 'Oct 12 to 18, 2026');
  assert.deepEqual(v.rows.map(r => r.p), ['$504.75', '-', '$399.07', '$354.41', '-']);
  assert.equal(v.rows[0].n, '57 barns, 9,755 head');
  assert.equal(v.rows[0].chg, '-$10.46');
  assert.equal(v.rows[1].why, 'too few sales');
  assert.equal(v.rows[1].n, '5 barns, 250 head', 'the sample is shown even when the price is withheld');
  assert.equal(v.rows[2].chg, 'fewer than 3 barns both weeks');
  assert.equal(v.rows[3].chg, 'prior week too few sales');
  assert.equal(v.rows[4].why, 'no sales');
  assert.match(v.gates, /3 or more barns sold 300 or more head/);
  assert.equal(v.shown, 3);
});

test('weekly table: a region with nothing shows dashes, an old week is held back with a reason', () => {
  const mw = V.tableView(D, 'steers', 'midwest', NOW);
  assert.equal(mw.region, 'Midwest');
  assert.equal(mw.states, 'IA, IL');
  assert.ok(mw.rows.every(r => r.p === '-'));
  const old = V.tableView(D, 'steers', 'us', Date.parse('2026-11-10T15:00:00Z'));
  assert.equal(old.down, true);
  assert.match(old.msg, /No new USDA barn reports have been read since the week of Oct 12 to 18, 2026/);
  assert.equal(V.tableView(null, 'steers', 'us', NOW).down, true);
});

test('700-899 lb national line and its RMA comparison', () => {
  const s = V.sliceView(D);
  assert.equal(s.p, '$347.85');
  assert.equal(s.n, '55 barns, 9,595 head');
  assert.match(s.check, /averaged \$341\.00 over the 3 days it posted that week, so these barns ran \+\$6\.85 against it/);
  const thin = V.sliceView({ ...D, check: { rma: 341.47, rma_days: 1, gap: null } });
  assert.match(thin.check, /once RMA has posted 3 days of that week \(it has posted 1\)/);
});

test('each page carries its box and the component; credits and the not-the-index line are in the component', () => {
  const pages = { 'cattle-futures-prices.html': ['rma'], 'cattle-auction-prices.html': ['table', 'rma'], 'lrp.html': ['rma'] };
  for (const [p, kinds] of Object.entries(pages)) {
    const html = fs.readFileSync(path.join(root, p), 'utf8');
    for (const k of kinds) assert.match(html, new RegExp('data-feeder="' + k + '"[^>]*hidden'), p + ' ships the ' + k + ' box hidden');
    assert.match(html, /<script src="\/components\/feeder-index\.js\?v=\d+" defer><\/script>/, p);
    const i = html.indexOf('data-feeder=');
    assert.doesNotMatch(html.slice(i, html.indexOf('</section>', i)), /\$\d/, p + ': no number baked into the box');
  }
  assert.match(comp, /<a href="https:\/\/pubfs-rma\.fpac\.usda\.gov\/pub\/References\/adm_livestock\/" rel="noopener">USDA RMA<\/a>/);
  assert.match(comp, /<a href="https:\/\/mymarketnews\.ams\.usda\.gov\/" rel="noopener">USDA AMS<\/a>/);
  assert.match(comp, /RMA LRP Handbook FCIC-20010<\/a>, section 23C/);
  assert.match(comp, /Our own figure, not the CME Feeder Cattle Index\./);
  assert.doesNotMatch(comp, /—/, 'no em dashes');
});

test('the builder selftest passes and the cattle auction workflow builds and commits the file', () => {
  const out = execFileSync('python3', ['scripts/build_feeder_index.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /FAILS=0/);
  const wf = fs.readFileSync(path.join(root, '.github/workflows/cattle-auction.yml'), 'utf8');
  assert.match(wf, /python scripts\/build_feeder_index\.py --selftest/);
  assert.match(wf, /run: python scripts\/build_feeder_index\.py\n/);
  assert.match(wf, /FILES="[^"]*data\/feeder-index\.json"/);
});

test('the committed file keeps the gates and stays small', () => {
  const f = path.join(root, 'data/feeder-index.json');
  assert.ok(fs.statSync(f).size < 150 * 1024, 'under 150 KB');
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const g = d.auction.gates;
  for (const sex of Object.keys(d.auction.table)) {
    for (const [r, row] of Object.entries(d.auction.table[sex])) {
      for (const [c, o] of Object.entries(row)) {
        if (o.p !== null) assert.ok(o.barns >= g.barns && o.head >= g.head, `${sex} ${r} ${c} shown under the gate`);
        if (o.chg !== null) assert.ok(o.both >= g.barns && o.prev !== null, `${sex} ${r} ${c} change without enough barns both weeks`);
      }
    }
  }
});
