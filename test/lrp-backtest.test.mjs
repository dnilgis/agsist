// scripts/lrp_backtest.mjs: the arithmetic of one LRP trial, the subsidy
// table, the overlap-aware test, Holm, and that "the band that did best so
// far" only ever sees endorsements that had settled. Hand-worked answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../scripts/lrp_backtest.mjs';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('subsidy by reinsurance year and band (RULES.md table)', () => {
  assert.equal(B.subsidy(2019, 0.99), 0.13);
  assert.equal(B.subsidy(2014, 0.72), 0.13);
  assert.equal(B.subsidy(2020, 0.99), 0.25);
  assert.equal(B.subsidy(2020, 0.92), 0.30);
  assert.equal(B.subsidy(2020, 0.75), 0.35);
  assert.equal(B.subsidy(2021, 1.0), 0.35);
  assert.equal(B.subsidy(2027, 0.95), 0.35);
  assert.equal(B.subsidy(2027, 0.949999), 0.40);
  assert.equal(B.subsidy(2027, 0.875), 0.45);
  assert.equal(B.subsidy(2027, 0.80), 0.50);
  assert.equal(B.subsidy(2027, 0.70), 0.55);
  assert.equal(B.subsidy(2027, 0.69), null);
});

test('each band takes the highest level offered in it', () => {
  // [level e6, coverage price milli, rate e6, cost milli], from the RY2027 fixture
  const rows = [[750000, 282480, 12282, 3469], [800000, 300000, 1, 1], [950000, 357810, 55261, 19773],
    [1000000, 376650, 76116, 28669], [930000, 1, 1, 1], [600000, 1, 1, 1]];
  const p = B.pickBands(rows);
  assert.deepEqual(Object.keys(p).sort(), ['70-80', '80-85', '90-95', '95-100']);
  assert.equal(p['95-100'][0], 1000000);
  assert.equal(p['70-80'][0], 750000);
});

test('one trial per $100 of coverage', () => {
  // coverage price $300, AEV $270, cost $6/cwt: paid $10, cost $2 per $100
  const t = B.trialParts([950000, 300000, 20000, 6000], 270000);
  close(t.paid, 10, 1e-9); close(t.cost, 2, 1e-9);
  close(B.netOf(t, 0.35), 8.7, 1e-9);
  // ending above the coverage price pays nothing: the net is the premium
  const u = B.trialParts([950000, 300000, 20000, 6000], 310000);
  assert.equal(u.paid, 0);
  close(B.netOf(u, 0.35), -1.3, 1e-9);
});

test("Student's t and the Newey-West test", () => {
  close(B.tTwoSided(2.0, 10), 0.07339, 2e-5, 't=2, df=10');
  close(B.tTwoSided(4.4721, 3), 0.02084, 5e-5, 't=4.47, df=3');
  // no lags: the plain test. [1,2,3,4]: mean 2.5, population variance 1.25
  const h = B.hac([1, 2, 3, 4], 0);
  close(h.se, Math.sqrt(1.25 / 4), 1e-12);
  close(h.p, 0.02084, 5e-5);
  assert.equal(h.nEff, 4);
  // a smooth, autocorrelated series: the long-run variance is larger, so
  // fewer independent points and a bigger standard error than the plain test
  const xs = [1, 1.2, 1.4, 1.3, 1.1, 0.9, 0.7, 0.8, 1.0, 1.2, 1.4, 1.5];
  const plain = B.hac(xs, 0), nw = B.hac(xs, 3);
  assert.ok(nw.se > plain.se && nw.nEff < xs.length, `${nw.se} ${plain.se} ${nw.nEff}`);
});

test('Holm', () => {
  const a = B.holm({ a: 0.01, b: 0.04, c: 0.03, d: null });
  close(a.a, 0.04, 1e-12);   // 0.01 x 4
  close(a.c, 0.09, 1e-12);   // 0.03 x 3
  close(a.b, 0.09, 1e-12);   // max(0.04 x 2, 0.09)
  assert.equal(a.d, 1);      // not run counts as p = 1
});

test('actual ending values by reinsurance year and sales date', () => {
  const look = B.aevLookup({
    2026: { '0801/809/20261007': { 370400: ['20251008', '20260107'] }, '0801/823/20261007': { 1340190: ['20260107'], 1417630: ['20260408'] } },
    2027: { '0801/809/20261007': { 999000: ['*'] } },
  });
  assert.equal(look('2026', '0801', '809', '20261007', '20250101'), 370400);
  assert.equal(look('2027', '0801', '809', '20261007', 'x'), 999000);
  assert.equal(look('2026', '0801', '823', '20261007', '20260408'), 1417630);
  assert.equal(look('2026', '0801', '823', '20261007', '20260101'), null);
  assert.equal(look('2025', '0801', '809', '20261007', 'x'), null);
});

test('missing ending values are counted, recent ones are open', () => {
  const offers = [
    { pid: 'feeder', comm: '0801', type: '810', ry: 2026, sed: '20260101', len: 13, end: '20260401', rows: [[1000000, 300000, 1, 6000]] },
    { pid: 'feeder', comm: '0801', type: '810', ry: 2026, sed: '20260102', len: 13, end: '20260402', rows: [[1000000, 300000, 1, 6000]] },
    { pid: 'feeder', comm: '0801', type: '810', ry: 2027, sed: '20260901', len: 13, end: '20261201', rows: [[1000000, 300000, 1, 6000]] },
  ];
  const aev = { 2026: { '0801/810/20260401': { 270000: ['*'] } } };
  const r = B.buildTrials(offers, aev, '20261010');
  assert.equal(r.trials.length, 1);
  close(r.trials[0].net, 10 - 2 * 0.65, 1e-9);
  assert.deepEqual(r.missing, { feeder: 1 });
  assert.deepEqual(r.open, { feeder: 1 });
});

function mk(sed, end, band, paid, cost, ry = 2022) {
  return { pid: 'feeder', ry, sed, d: B.dayNum(sed), endD: B.dayNum(end), len: 13, band, level: { '95-100': 1, '90-95': 0.9, '85-90': 0.85, '80-85': 0.8, '70-80': 0.75 }[band], paid, cost, net: 0 };
}

test('"did best so far" sees only endorsements that had settled 14 days before', () => {
  const bands = ['95-100', '90-95', '85-90', '80-85', '70-80'];
  const trials = [];
  // MIN_SETTLED settled trials per band, ending 2022-01-01; 70-80 did best
  for (let i = 0; i < B.MIN_SETTLED; i++) {
    for (const b of bands) trials.push(mk('20211001', '20220101', b, b === '70-80' ? 10 : 0, 1));
  }
  // on 2022-01-10 nothing has settled 14 days before: no pick
  for (const b of bands) trials.push(mk('20220110', '20220410', b, 0, 1));
  // on 2022-01-15 they have (ended Jan 1, 14 days): 70-80
  for (const b of bands) trials.push(mk('20220115', '20220415', b, 0, 1));
  // a later day whose own, unsettled outcome would favour 95-100 must not change the pick
  for (const b of bands) trials.push(mk('20220120', '20220420', b, b === '95-100' ? 1e6 : 0, 1));
  const pick = B.pastBest(trials);
  assert.equal(pick.get('feeder|13|20220110'), null);
  assert.equal(pick.get('feeder|13|20220115'), '70-80');
  assert.equal(pick.get('feeder|13|20220120'), '70-80');
});

test('the family is 36 tests and a flat record keeps nothing', () => {
  const trials = [];
  for (let w = 0; w < 60; w++) {
    const d = new Date(Date.UTC(2014, 0, 6) + w * 7 * 864e5);
    const sed = d.toISOString().slice(0, 10).replace(/-/g, '');
    for (const pid of ['feeder', 'fed', 'swine']) {
      for (const [band, level] of [['95-100', 1], ['90-95', 0.9], ['85-90', 0.85], ['80-85', 0.8], ['70-80', 0.75]]) {
        const x = (w % 2 ? 1 : -1);
        trials.push({ pid, ry: 2014 + Math.floor(w / 52), sed, d: B.dayNum(sed), endD: B.dayNum(sed) + 91, len: 13, band, level, paid: 0, cost: 0, net: x });
      }
    }
  }
  const r = B.runBacktest(trials);
  assert.equal(r.family.length, 36);
  assert.ok(r.family.every((k) => !r.tests[k].kept));
  const paid = r.tests['all/feeder/paid'];
  assert.equal(paid.trials, 60);
  assert.ok(paid.windows >= 4 && paid.nEff <= paid.windows);
  // the current regime (RY2021 on) has no trials here: nothing to test, p counted as 1
  assert.equal(r.tests['current/feeder/paid'].trials, 0);
  assert.equal(r.tests['current/feeder/paid'].p_holm, 1);
});

test('the subsidy table against what producers were given', () => {
  const c = B.subsidyCheck({
    2003: { 94: { 13: 2 } },                              // before RY2014: 13%, agrees
    2022: { 99: { 35: 5, 45: 1 }, 92: { 40: 3, 30: 1 }, 75: { 55: 2 } },
  });
  assert.deepEqual(c['2003'], { rows: 2, agree: 2, above: 0, below: 0, agree_share: 1 });
  assert.deepEqual(c['2022'], { rows: 12, agree: 10, above: 1, below: 1, agree_share: 0.8333 });
});
