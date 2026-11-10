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
  return new Function(m[1] + '\nreturn {rmaView, tableView, indexView, cellView};')();
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
  index: {
    name: 'AGSIST USDA feeder steer index', label: 'AGSIST USDA feeder steer index, not the CME index',
    gates: { barns: 30, head: 4000, states: 8, max_state_pct: 50 }, draws: 1000, final_days: 10, start: '2026-10-05',
    latest: '2026-10-12', last_ok: '2026-10-12',
    weeks: [
      { start: '2026-10-05', end: '2026-10-11', p: null, barns: 12, head: 1480, states: 6, avg_wt: 790, top: [['OK', 40]], final: true,
        why: ['12 barns, 30 needed', '1,480 head, 4,000 needed', '6 states, 8 needed'], both: 0, chg: null, chg_why: 'this week withheld' },
      { start: '2026-10-12', end: '2026-10-18', p: 347.85, barns: 55, head: 9595, states: 15, avg_wt: 798,
        top: [['OK', 31], ['MO', 20], ['SD', 11]], final: false, lo: 345.16, hi: 351.28, both: 0, chg: null, chg_why: 'prior week withheld' },
    ],
  },
};
const W2 = { start: '2026-10-19', end: '2026-10-25', p: 351.6, barns: 66, head: 11162, states: 16, avg_wt: 804, top: [['OK', 27]], final: false,
  lo: 348.68, hi: 354.76, both: 44, chg: 3.75, chg_lo: 0.38, chg_hi: 6.82, move: 'up' };
const NOW2 = Date.parse('2026-10-28T15:00:00Z');
function withWeeks(extra, patch = {}) {
  return { ...D, index: { ...D.index, ...patch, weeks: D.index.weeks.concat(extra) }, check: { week: '2026-10-19', agsist: 351.6, rma: 344.43, rma_days: 5, gap: 7.17 } };
}

test('RMA box: value with its date, futures for the same day, and the difference', () => {
  const v = V.rmaView(D, NOW);
  assert.equal(v.val, '$341.47');
  assert.equal(v.date, 'Oct 12, 2026');
  assert.match(v.meta, /^Ending value, steers 6 to 10 cwt, USDA RMA\.$/);
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

test('index box: the week, its sample, the redrawn range, and RMA beside it', () => {
  const v = V.indexView(withWeeks([W2], { latest: '2026-10-19', last_ok: '2026-10-19' }), NOW2);
  assert.equal(v.label, 'AGSIST USDA feeder steer index, not the CME index');
  assert.equal(v.val, '$351.60');
  assert.equal(v.week, 'Oct 19 to 25, 2026');
  assert.equal(v.n, '66 barns in 16 states, 11,162 head, average 804 lb');
  assert.match(v.range, /lands from \$348\.68 to \$354\.76 nine times in ten\.$/);
  assert.equal(v.chgHead, 'Higher than the week before');
  assert.equal(v.chgLine, '+$3.75.');
  assert.equal(v.chgRange, 'Redrawing the barns of both weeks puts the change at +$0.38 to +$6.82 (44 barns sold both weeks).');
  assert.match(v.check, /averaged \$344\.43 over the 5 days RMA posted that week; the index ran \+\$7\.17 against it\.$/);
  assert.match(v.first, /^First count\. USDA reports filed late can still add sales to this week for 10 days/);
  assert.match(v.gates, /30 or more barns in 8 or more states sold 4,000 or more head, and no one state sold more than 50%/);
  assert.equal(v.shownWeeks, 2);
  assert.deepEqual(v.series.map(x => x.p), [null, 347.85, 351.6], 'a withheld week stays in the record as a gap');
  assert.equal(v.rows[0].week, 'Oct 19 to 25, 2026', 'newest week first');
  assert.equal(v.rows[2].p, '-');
  assert.match(v.rows[2].why, /12 barns, 30 needed/);
  assert.equal(v.since, 'Oct 5, 2026');
});

test('index box: a change inside the noise is no clear change; no change without one earned', () => {
  const flat = V.indexView(withWeeks([{ ...W2, chg: 0.71, chg_lo: -2.1, chg_hi: 3.4, move: 'flat' }]), NOW2);
  assert.equal(flat.chgHead, 'No clear change from the week before');
  assert.equal(flat.chgLine, '+$0.71.');
  assert.match(flat.chgRange, / -\$2\.10 to \+\$3\.40/);
  const down = V.indexView(withWeeks([{ ...W2, chg: -6, chg_lo: -9, chg_hi: -2, move: 'down' }]), NOW2);
  assert.equal(down.chgHead, 'Lower than the week before');
  const first = V.indexView(D, NOW);
  assert.equal(first.chgHead, '');
  assert.equal(first.chgLine, 'No change shown: prior week withheld.');
  assert.match(first.check, /averaged \$341\.00 over the 3 days/);
  assert.equal(V.indexView({ ...D, check: { ...D.check, week: '2026-10-05' } }, NOW).check, '', 'RMA is set beside it only for the same week');
  assert.match(V.indexView({ ...D, check: { ...D.check, gap: null, rma_days: 1 } }, NOW).check, /once RMA has posted 3 days of that week \(it has posted 1\)/);
});

test('index box: a withheld week shows its counts and reasons, never a number', () => {
  const held = { start: '2026-10-19', end: '2026-10-25', p: null, barns: 21, head: 3100, states: 7, avg_wt: 801, top: [['OK', 52]], final: false,
    why: ['21 barns, 30 needed', '3,100 head, 4,000 needed', '7 states, 8 needed', 'OK sold 52% of the head, 50% at most'], both: 0, chg: null, chg_why: 'this week withheld' };
  const v = V.indexView(withWeeks([held], { latest: '2026-10-19' }), NOW2);
  assert.equal(v.withheld, true);
  assert.equal(v.val, '-');
  assert.equal(v.n, '21 barns in 7 states, 3,100 head, average 801 lb');
  assert.equal(v.why, 'Withheld: 21 barns, 30 needed; 3,100 head, 4,000 needed; 7 states, 8 needed; OK sold 52% of the head, 50% at most.');
  assert.equal(v.last, 'Last week with a figure: Oct 12 to 18, 2026, $347.85.', 'the last published week is named with its own dates');
  assert.equal(v.range, '');
  assert.equal(v.check, '');
});

test('index box: an old record is held back, a missing file says so', () => {
  const old = V.indexView(D, Date.parse('2026-11-10T15:00:00Z'));
  assert.equal(old.down, true);
  assert.match(old.msg, /since the week of Oct 12 to 18, 2026, so the index is held back/);
  assert.match(V.indexView(null, NOW).msg, /did not load/);
  assert.match(V.indexView({ index: { weeks: [] } }, NOW).msg, /could not be built/);
});

test('the committed index: gates hold on every published week, the record has no holes, the RMA check reads it', () => {
  const d = JSON.parse(fs.readFileSync(path.join(root, 'data/feeder-index.json'), 'utf8'));
  const ix = d.index, g = ix.gates;
  assert.equal(ix.label, 'AGSIST USDA feeder steer index, not the CME index');
  assert.equal(ix.start, '2026-10-12');
  assert.ok(ix.weeks.length >= 1);
  ix.weeks.forEach((w, i) => {
    if (i) assert.equal(Date.parse(w.start) - Date.parse(ix.weeks[i - 1].start), 7 * 864e5, 'one entry per week, in order');
    if (w.p !== null) {
      assert.ok(w.barns >= g.barns && w.head >= g.head && w.states >= g.states, w.start + ' published under the gate');
      assert.ok(w.top[0][1] <= g.max_state_pct, w.start + ' one state over the cap');
      assert.ok(w.lo <= w.p && w.p <= w.hi, w.start + ' range brackets the price');
    } else assert.ok(w.why && w.why.length, w.start + ' withheld without a reason');
    if (w.chg !== null) {
      assert.ok(w.both >= g.barns && ix.weeks[i - 1].p !== null, w.start + ' change without both weeks');
      assert.equal(Math.round((w.p - ix.weeks[i - 1].p) * 100), Math.round(w.chg * 100), w.start + ' change is the difference of the two published weeks');
      assert.equal(w.move, w.chg_lo > 0 ? 'up' : w.chg_hi < 0 ? 'down' : 'flat');
    }
  });
  const last = ix.weeks[ix.weeks.length - 1];
  assert.equal(last.start, d.auction.week.start, 'the index and the table show the same week');
  if (last.p !== null) assert.equal(last.p, d.auction.table.steers.us['700-899'].p, 'the index equals the table\'s national 700-899 steer line');
  if (d.check) assert.equal(d.check.agsist, last.p);
  assert.doesNotMatch(JSON.stringify(ix), /cme feeder cattle index/i, 'the index file never draws on the CME index');
});

test('each page carries its box and the component; credits and the not-the-index line are in the component', () => {
  const pages = { 'cattle-futures-prices.html': ['index', 'rma'], 'cattle-auction-prices.html': ['index', 'table', 'rma'], 'lrp.html': ['index', 'rma'] };
  for (const [p, kinds] of Object.entries(pages)) {
    const html = fs.readFileSync(path.join(root, p), 'utf8');
    for (const k of kinds) assert.match(html, new RegExp('data-feeder="' + k + '"[^>]*hidden'), p + ' ships the ' + k + ' box hidden');
    assert.match(html, /<script src="\/components\/feeder-index\.js\?v=\d+" defer><\/script>/, p);
    for (const k of kinds) {
      const i = html.indexOf('data-feeder="' + k + '"');
      assert.doesNotMatch(html.slice(i, html.indexOf('</section>', i)), /\$\d/, p + ': no number baked into the ' + k + ' box');
    }
    // Sig, Nov 10 2026: RMA's value (with its RMA-minus-futures line) is its own section, never
    // paired with our index, so the two do not read as a comparison. Something else always sits between.
    assert.doesNotMatch(html, /class="fx-pair"/, p + ': no pair box');
    const ix = html.indexOf('data-feeder="index"'), rm = html.indexOf('data-feeder="rma"');
    const between = ix < rm ? html.slice(html.indexOf('</section>', ix), rm) : html.slice(html.indexOf('</section>', rm), ix);
    assert.match(between, /<(section|details|h2|p)\b/, p + ': the RMA box and the index are apart');
  }
  assert.match(comp, /AGSIST USDA feeder steer index, not the CME index/);
  assert.match(comp, /It is not the CME Feeder Cattle Index, and no CME data goes into it\./);
  // the sources are named, not linked (no direct links to data sources, Oct 29, 2026)
  assert.match(comp, /Source: USDA RMA, Livestock Risk Protection actual ending values\./);
  assert.match(comp, /USDA AMS/);
  assert.doesNotMatch(comp, /href="https:\/\/(pubfs-rma\.fpac\.usda\.gov|mymarketnews\.ams\.usda\.gov)/);
  assert.match(comp, /RMA LRP Handbook FCIC-20010, section 23C/);
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
