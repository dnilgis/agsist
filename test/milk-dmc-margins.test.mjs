// /milk-prices DMC margins, May to Aug 2026 (fx/dmcmayaug, Oct 28, 2026). The workflow reads FSA's
// prices page through the Internet Archive, whose newest copy (Jun 10) ends at April 2026, so the
// page said May to Aug were left out. The owner captured FSA's live page on Oct 28, 2026 ("2026 Rates"
// table). The values below are typed from that capture, hand-checked: each feed cost is
// 1.0728 corn + 0.0137 premium alfalfa hay + 0.00735 soybean meal to the cent, milk minus feed is
// the margin, and Jan to Apr in the same capture match the file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => fs.readFileSync(join(ROOT, p), 'utf8');
const page = read('milk-prices.html');
const dmc = JSON.parse(read('data/dairy-dmc.json'));
const seedOf = (tag) => {
  const m = new RegExp(`<!--SEED:${tag}-->([\\s\\S]*?)<!--/SEED-->`).exec(page);
  assert.ok(m, `SEED:${tag} is on the page`);
  return m[1];
};

// month: corn $/bu, premium alfalfa $/ton, soybean meal $/ton, all milk, feed, margin ($/cwt)
const CAPTURE = {
  '2026-05': [4.48, 247.00, 338.72, 21.30, 10.68, 10.62],
  '2026-06': [4.28, 239.00, 319.68, 21.10, 10.22, 10.88],
  '2026-07': [4.26, 242.00, 337.96, 20.30, 10.37, 9.93],
  '2026-08': [4.45, 243.00, 320.30, 19.80, 10.46, 9.34],
};
const SAME_CAPTURE_JAN_APR = {
  '2026-01': [17.50, 9.69, 7.81], '2026-02': [18.30, 9.84, 8.46],
  '2026-03': [19.70, 10.13, 9.57], '2026-04': [20.80, 10.26, 10.54],
};

test('May to Aug 2026 margins are FSA\'s, as captured from its live page Oct 28, 2026', () => {
  for (const [k, [corn, hay, sbm, milk, feed, margin]] of Object.entries(CAPTURE)) {
    assert.deepEqual(dmc.margins[k], { all_milk: milk, feed, margin }, k);
    assert.deepEqual(dmc.screenshot.months[k], { corn, hay, sbm, all_milk: milk, feed, margin }, `${k} capture`);
    assert.ok(Math.abs(1.0728 * corn + 0.0137 * hay + 0.00735 * sbm - feed) <= 0.005, `${k} feed is FSA's formula`);
    assert.ok(Math.abs(milk - feed - margin) <= 0.006, `${k} milk minus feed is the margin`);
  }
  for (const [k, [milk, feed, margin]] of Object.entries(SAME_CAPTURE_JAN_APR)) {
    assert.deepEqual(dmc.margins[k], { all_milk: milk, feed, margin }, `${k} matches the same capture`);
  }
  assert.equal(dmc.screenshot.read, '2026-10-28');
  assert.equal(dmc.screenshot.via, 'screenshot');
  assert.equal(dmc.screenshot.source_url, 'https://www.fsa.usda.gov/resources/programs/dairy-margin-coverage-program-dmc/prices-updates');
  assert.equal(Object.keys(dmc.margins).sort().at(-1), '2026-08', 'nothing past what FSA posted');
  assert.equal(dmc.margins['2026-09'], undefined);
  // Months newer than the Oct 28 capture may be left out once NASS posts their all-milk price (Nov 2, 2026:
  // September), always with the reason; nothing at or before Aug 2026 may be.
  const held = (dmc.withheld && dmc.withheld.months) || [];
  assert.equal(dmc.withheld.count, held.length);
  assert.ok(held.every((k) => k > '2026-08'), 'only months after the capture are left out: ' + held);
  if (held.length) assert.match(dmc.withheld.why, /not in the copy of FSA's page I read/);
  const nass = JSON.parse(read('data/dairy-data.json')).all_milk;
  if (dmc.margins[nass.month_key]) assert.equal(dmc.margins[nass.month_key].all_milk, nass.value, 'FSA all-milk is the NASS month held');
});

test('the page shows them, credits the capture, and no longer says they are left out', () => {
  const paid = seedOf('milkdmcpaid');
  assert.match(paid, /What DMC would have paid at these published prices, Jan 2019 to Aug 2026, before premium/);
  assert.match(paid, /2026 is Jan to Aug only/);
  assert.match(paid, /May 2026 to Aug 2026: the same FSA page, read 2026-10-28 from a screen capture of FSA&rsquo;s live page/);
  // nothing from the captured months is left out; a later month may be, named with its reason
  const lo = [...paid.matchAll(/\(([A-Z][a-z]{2} \d{4}(?:, [A-Z][a-z]{2} \d{4})*)\) (?:is|are) left out/g)].flatMap((x) => x[1].split(', '));
  const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  assert.ok(lo.every((t) => { const [m, y] = t.split(' '); return +y * 100 + MON[m] > 202608; }), 'no captured month left out: ' + lo);
  if (/left out/.test(paid)) assert.ok(lo.length, 'a "left out" line names its months');
  // $9.50 in 2026: (1.69 + 1.04 + 0 + 0 + 0 + 0 + 0 + 0.16) / 8 months
  assert.match(paid, /<tr><th scope="row">\$9\.50<span class="dp-dmc-prem">[^<]*<\/span><\/th><td class="num">\$0\.36<\/td>/);
  const m = seedOf('milkdmcmargin');
  assert.match(m, /DMC margin, August 2026: \$9\.34\/cwt<\/strong> \(\$19\.80 all-milk minus \$10\.46 feed\)/);
  assert.match(m, /read 2026-10-28 from a screen capture of FSA&rsquo;s live page/);
  assert.doesNotMatch(paid + m, /—/, 'no em dash');
});
