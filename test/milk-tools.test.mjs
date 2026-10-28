// /milk-prices rebuild, part 1 (dairy board, Oct 27-28, 2026): your area first,
// read my check, and no hand-typed numbers. components/milk-tools.js holds the
// pure functions; the page bakes the no-JS copy (scripts/seed_static.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const M = require('../components/milk-tools.js');
const page = read('milk-prices.html');
const mb = JSON.parse(read('test/fixtures/milk/mailbox-2026-06.json'));
const hist = JSON.parse(read('test/fixtures/milk/history-2026-09.json'));
// September 2026 as USDA AMS announced it (data/dairy-data.json on Oct 28, 2026)
const SEP = {
  class_month_key: '2026-09', class_month: 'September 2026', class3: 16.04,
  components: { butterfat: 1.4762, protein: 2.6619, nonfat_solids: 1.5343, other_solids: 0.4147 },
  all_milk: { value: 19.8, month_key: '2026-08', year_ago: 20.9 },
  all_milk_states: { month_key: '2026-08', rows: [{ state: 'Wisconsin', value: 18.9, prev_month: 19.3, year_ago: 20.0 }] },
};
const ROWS = [
  { idx: 2026 * 12 + 9, label: 'Oct 2026', close: 15.25, date: '2026-10-26', kind: 'settle' },
  { idx: 2026 * 12 + 10, label: 'Nov 2026', close: 17.94, date: '2026-10-26', kind: 'settle' },
  { idx: 2026 * 12 + 11, label: 'Dec 2026', close: 16.61, date: '2026-10-26', kind: 'settle' },
];

test('seat 02 case: September at 4.2 / 3.3 / 5.9 is $17.43 per cwt before PPD', () => {
  const v = M.testValue({ fat: 4.2, pro: 3.3, os: 5.9 }, SEP.components);
  assert.equal(v.val.toFixed(2), '17.43');
  // the Class III test (3.5 fat, 0.965 x 3.30 protein, 0.965 x 6.00 other solids) gives back Class III
  const std = M.testValue({ fat: 3.5, pro: M.STD.pro, os: M.STD.os }, SEP.components);
  assert.ok(Math.abs(std.val - SEP.class3) < 0.01, String(std.val));
  assert.ok(Math.abs(SEP.class3 + M.adj({ fat: 4.2, pro: 3.3, os: 5.9 }, SEP.components) - 17.43) < 0.01);
});

test('read my check: value, deductions, gap to the reader\'s own cost, futures as a labeled range', () => {
  const t = { cwt: 2170, fat: 4.2, pro: 3.3, os: 5.9, ded: 1.4, cost: 19.5 };
  const h = M.checkHtml(t, SEP, hist, ROWS, true);
  assert.match(h, /Your milk at September 2026 component prices/);
  assert.match(h, /Federal minimum value at your tests<\/strong><\/span><span class="v"><strong>\$17\.43\/cwt/);
  assert.match(h, /Left before PPD and premiums<\/span><span class="v">\$16\.03\/cwt/);
  assert.match(h, /Against your cost of \$19\.50\/cwt<\/span><span class="v neg">−\$3\.47\/cwt, −\$7,528 on 2,170 cwt/);
  assert.match(h, /Market prices plus your inputs, not your check, not a forecast\./);
  // the next two months not yet announced (Oct, Nov), never Dec, never the announced September
  assert.match(h, /Oct 2026 at \$15\.25/);
  assert.match(h, /Nov 2026 at \$17\.94/);
  assert.doesNotMatch(h, /Dec 2026/);
  // a range over the component prices of the months held (Aug and Sep 2026)
  assert.match(h, /\$15\.\d\d to \$15\.\d\d\/cwt/);
  assert.match(h, /the last 2 announced months/);
});

test('read my check: no national cost, no old prices, bad tests asked again', () => {
  const t = { cwt: null, fat: 4.2, pro: 3.3, os: 5.9, ded: null, cost: null };
  const h = M.checkHtml(t, SEP, hist, ROWS, true);
  assert.doesNotMatch(h, /Against your cost/);
  assert.doesNotMatch(h, /\bERS\b|\$19\/cwt|national cost/);
  assert.match(M.checkHtml(t, SEP, hist, ROWS, false), /not the newest month, and I will not use old ones/);
  assert.match(M.checkHtml({ ...t, fat: 42 }, SEP, hist, ROWS, true), /butterfat test between 2 and 7/);
  assert.match(M.checkHtml({ ...t, fat: null }, SEP, hist, ROWS, true), /Type your butterfat/);
  assert.match(M.checkHtml(t, SEP, hist, [], true), /No current Class III futures/);
});

test('your area: Wisconsin first, with its month, rank, state all-milk and the next futures month', () => {
  const h = M.areaHtml(mb, SEP, ROWS, 'Wisconsin', 'WI', new Date(2026, 9, 28));
  assert.match(h, /Wisconsin <span>mailbox price, June 2026<\/span>/);
  assert.match(h, /\$18\.13<span>\/cwt/);
  assert.match(h, /−\$3\.02 vs Jun 2025/);
  assert.match(h, /19th of 20 areas \(1st is the highest\)/);
  assert.match(h, /Wisconsin all-milk price, August 2026: \$18\.90, −\$1\.10 vs a year earlier \(US \$19\.80, −\$1\.10\)/);
  assert.match(h, /Class III futures, Oct 2026: \$15\.25 \(CME settle Oct 26\)\. A market price, not your check\./);
  assert.match(h, /viewReport\/3357/);
  const mn = M.areaHtml(mb, SEP, ROWS, 'Minnesota', 'MN', new Date(2026, 9, 28));
  assert.match(mn, /20th of 20 areas/);
  assert.match(mn, /−\$2\.93 vs Jun 2025/);
  assert.match(M.areaHtml(mb, SEP, ROWS, 'Wisconsin', 'WI', new Date(2026, 10, 15)), /an older month/);
});

test('your area: a ZIP names the area; split or unreported states ask for the picker', () => {
  assert.equal(M.zipState('54701'), 'WI');
  assert.deepEqual(M.areaForState('WI'), { area: 'Wisconsin' });
  assert.deepEqual(M.areaForState('VT'), { area: 'New England States' });
  assert.ok(M.areaForState('PA').split.includes('Western Pennsylvania'));
  assert.ok(M.areaForState('MO').split.includes('Southern Missouri'));
  assert.ok(M.areaForState('TX').split);
  assert.equal(M.areaForState('ID').none, true);
  assert.match(M.askHtml('PA', M.areaForState('PA')), /Pennsylvania is split between AMS mailbox areas/);
  // every area a state maps to is one the report carries
  const names = new Set(mb.areas.rows.map((r) => r.area));
  for (const a of Object.values(M.BY_STATE)) assert.ok(names.has(a), a);
  for (const l of Object.values(M.SPLIT)) for (const a of l) assert.ok(names.has(a), a);
  // the picker lists exactly the report's areas
  const picker = /<select id="dp-area-sel">[\s\S]*?<\/select>/.exec(page)[0];   // the area picker, not the order select
  const opts = [...picker.matchAll(/<option value="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(opts, mb.areas.rows.map((r) => r.area));
  // ZIP table: the same as components/price-local.js
  const z3 = (s) => /var Z3 = '([^']+)'/.exec(s)[1];
  assert.equal(z3(read('components/milk-tools.js')), z3(read('components/price-local.js')));
});

test('the page: no hand-typed DMC, cost or pool figures, no Class IV futures promise', () => {
  for (const bad of ['9.34', '10.46', '57%', '21%', '42,966', '1,736', '$1 to $2', '&minus;$1 to $2', 'ERS avg herd',
    'Class III and IV futures', 'enrollment already closed']) {
    assert.ok(!page.includes(bad), bad);
  }
  for (const tag of ['milkarea', 'milkdmcpaid', 'milkdmcmargin', 'milkcostfaq', 'milkdmccard']) {
    assert.match(page, new RegExp(`<!--SEED:${tag}-->[\\s\\S]+?<!--/SEED-->`), tag);
  }
  assert.match(page, /<script src="\/components\/milk-tools\.js\?v=\d+" defer><\/script>/);
  // your area comes first: before the DMC card, the nav and the national strip
  const at = (s) => page.indexOf(s);
  assert.ok(at('id="dp-area"') > 0 && at('id="dp-area"') < at('id="dp-dmc"') && at('id="dp-dmc"') < at('id="dp-mkt-sec"'));
  assert.ok(at('fell most in Wisconsin') > 0 && at('fell most in Wisconsin') < at('id="dp-mkt-sec"'), 'Upper Midwest on the first screen');
  // what the reader types stays on the device
  const js = read('components/milk-tools.js');
  assert.doesNotMatch(js, /fetch\([^)]*(zip|cwt|ck-)/i);
  assert.match(js, /localStorage/);
  // no em dash in the copy a reader sees (CSS comments aside) or in the component
  assert.ok(!/\u2014/.test(js + page.replace(/<style>[\s\S]*?<\/style>/g, '')), 'no em dash');
});

// Part 2 (fx/dairy2): the reader's order's PPD, Order 30 first. Only the same month as the
// component prices; another month's PPD is never added (it swings by dollars month to month).
test('read my check: Order 30 PPD added for the same month only, labeled', () => {
  const t = { cwt: 2170, fat: 4.2, pro: 3.3, os: 5.9, ded: 1.4, cost: 19.5, order: '30' };
  const same = { latest: { month_key: '2026-09', ppd: -0.42, uniform: 15.62 } };
  const h = M.checkHtml(t, SEP, hist, ROWS, true, same);
  assert.match(h, /Plus Order 30 PPD, September 2026 \(Upper Midwest market administrator\)<\/span><span class="v">−\$0\.42/);
  assert.match(h, /With the PPD<\/strong><\/span><span class="v"><strong>\$15\.61\/cwt/);
  // the gap to the reader's own cost uses the PPD line: 15.61 - 19.50
  assert.match(h, /Against your cost of \$19\.50\/cwt<\/span><span class="v neg">−\$3\.89\/cwt/);
  assert.match(h, /leave out the PPD/);
  const old = { latest: { month_key: '2026-08', ppd: 0.31 } };
  const h2 = M.checkHtml(t, SEP, hist, ROWS, true, old);
  assert.doesNotMatch(h2, /Plus Order 30 PPD/);
  assert.match(h2, /differential for September 2026 is not held here yet/);
  assert.match(h2, /Against your cost of \$19\.50\/cwt<\/span><span class="v neg">−\$3\.47\/cwt/);
  // no order picked: no PPD line at all, even when the file has one
  assert.doesNotMatch(M.checkHtml({ ...t, order: '' }, SEP, hist, ROWS, true, same), /PPD,/);
  assert.equal(M.ppdFor({ months: { '2026-09': { month_key: '2026-09', ppd: 0.1 } } }, '2026-09').ppd, 0.1);
  assert.equal(M.ppdFor({ latest: { month_key: '2026-09', ppd: null } }, '2026-09'), null);
});

test('milk price day ask: the milk-month topic, never pre-ticks the Daily, and a sender reads it', () => {
  const m = /<div data-signup-ask="[^"]*" data-topic="milk-month"[^>]*>/.exec(page);
  assert.ok(m, 'the ask is on the page');
  assert.doesNotMatch(m[0], /data-daily/);
  assert.ok(read('scripts/send_milk_month.py').includes('TOPIC = "milk-month"'));
  assert.ok(read('workers/subs-worker.js').includes('const MILK_MONTH = "milk-month";'));
  const wf = read('.github/workflows/dairy.yml');
  assert.ok(wf.indexOf('python scripts/send_milk_month.py --selftest') > 0 &&
    wf.indexOf('python scripts/send_milk_month.py --selftest') < wf.indexOf('python3 scripts/send_milk_month.py\n'), 'selftest before the send');
  assert.match(wf, /SEND: .*github\.ref_name == 'main'/, 'only main sends to the list');
});
