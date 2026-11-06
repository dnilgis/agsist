// /cash-bids "Ethanol plants paying" fold: data/ethanol-bids.json, written by
// scripts/fetch_ethanol_mars.py in the cattle-cash workflow from USDA My Market
// News reports 3617 (National Daily Ethanol Report) and 3618 (National Weekly
// Grain Co-Products Report). Fixtures: the real answers of Nov 2, 2026 (3617
// trimmed to 40 detail rows; the Nov 2 day is whole) from the MARS map probe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const FX = path.join(root, 'test/fixtures/ethanol-mars');
const py = (args) => execFileSync('python3', [path.join(root, 'scripts/fetch_ethanol_mars.py'), ...args], { cwd: root, encoding: 'utf8' });

function fromFixtures() {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eth-')), 'eth.json');
  py(['--from-files', path.join(FX, '3617.json'), path.join(FX, '3618.json'), '--out', out, '--now', '2026-11-03T02:00:00Z']);
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}
function component() {
  const ctx = { globalThis: {} };
  ctx.globalThis = ctx;
  vm.runInNewContext(read('components/ethanol-bids.js'), ctx);
  return ctx.EthanolBids;
}

test('the reader selftest passes', () => {
  assert.match(py(['--selftest']), /selftest: \d+ checks passed/);
});

test('the real Nov 2 report: every state row, numbers as USDA sent them', () => {
  const d = fromFixtures();
  const c = d.corn;
  assert.equal(c.report_date, '2026-11-02');
  assert.equal(c.futures, 'December');
  assert.equal(c.rows.length, 12, '11 states, Iowa East and West');
  const mn = c.rows.find((r) => r.label === 'Minnesota');
  assert.deepEqual([mn.bid_lo, mn.bid_hi, mn.basis_lo, mn.basis_hi, mn.avg, mn.avg_year_ago], [3.6775, 4.0775, -80, -40, 3.9308, 3.84]);
  const iaw = c.rows.find((r) => r.label === 'Iowa West');
  assert.deepEqual([iaw.bid_lo, iaw.bid_hi, iaw.basis_lo, iaw.basis_hi], [4.0575, 4.3775, -42, -10]);
  // every kept row: bid minus basis is one futures price at both ends
  for (const r of c.rows) assert.ok(Math.abs((r.bid_lo - r.basis_lo / 100) - (r.bid_hi - r.basis_hi / 100)) <= 0.005, r.label);
  assert.equal(d.daily_line, 'Ethanol plants bid $3.67 to $4.93 for corn in 11 states, basis -80 to +45 cents against December futures (USDA AMS, National Daily Ethanol Report, Nov 2, 2026).');
  assert.ok(d.daily_line.length <= 170);
});

test('co-products: distillers grains $/ton and corn oil, blanks left out, no year ago without the year-ago report', () => {
  const co = fromFixtures().coproducts;
  assert.equal(co.week_of, '2026-10-26');
  const iowaDry = co.rows.find((r) => r.product === 'ddgs' && r.area === 'Iowa');
  assert.equal(iowaDry.price, 170.65);
  assert.equal(iowaDry.unit, '$/ton');
  assert.equal(co.rows.find((r) => r.product === 'corn_oil' && r.area === 'Kansas').price, 67.5);
  assert.ok(co.rows.every((r) => r.price > 0 && ['ddgs', 'mwdg', 'wdg', 'corn_oil'].includes(r.product)), 'no soybean meal, hulls or blanks');
  assert.ok(co.rows.every((r) => r.year_ago === null), 'the $/bu year-ago value is never passed off as $/ton');
  assert.equal(co.rows.filter((r) => r.product === 'ddgs').length, 11);
});

test('the shipped data file has the shape the page reads and names its source', () => {
  const d = JSON.parse(read('data/ethanol-bids.json'));
  assert.equal(d.schema, 'agsist-ethanol-bids/1');
  assert.match(d.credit, /USDA AMS/);
  assert.ok(d.corn.rows?.length >= 3 || d.corn.withheld, 'rows or a reason');
  assert.ok(!('results' in d) && !JSON.stringify(d).includes('office_code'), 'no raw MARS answer in data/');
});

test('the page formats only: quarter cents, signed basis, source and date in plain text, no link, no em dash', () => {
  const E = component();
  assert.equal(E.bid(4.3575), '$4.35¾');
  assert.equal(E.bid(4.3), '$4.30');
  assert.equal(E.bid(4.0125), '$4.01¼');
  assert.equal(E.basis(30), '+30');
  assert.equal(E.basis(-12), '-12');
  const html = E.render(fromFixtures(), Date.parse('2026-11-03T18:00:00Z'));
  assert.match(html, /USDA AMS, National Daily Ethanol Report, Nov 2, 2026/);
  assert.match(html, /USDA AMS, National Weekly Grain Co-Products Report, week of Oct 26, 2026/);
  assert.match(html, /<td>Minnesota<\/td><td class="r">\$3\.67\u00be to <span class="eth-nw">\$4\.07\u00be<\/span><\/td><td class="r"><span class="eth-nw">-80 to -40<\/span><\/td>/);
  assert.match(html, /<td>Iowa<\/td><td class="r">\$170\.65<\/td>/);
  assert.doesNotMatch(html, /<a\s/i, 'sources named, never linked');
  assert.doesNotMatch(html, /—/);
  assert.doesNotMatch(html, /latest report AGSIST has read/, 'fresh report: no old-report note');
  assert.match(E.render(fromFixtures(), Date.parse('2026-11-12T18:00:00Z')), /latest report AGSIST has read/, 'an old report says so');
  assert.match(E.render(null), /not available right now/);
  assert.match(E.render({ schema: 'agsist-ethanol-bids/1', corn: { withheld: 'Fewer than 3 states.' }, coproducts: null }), /not shown\. Fewer than 3 states\./);
});

test('/cash-bids carries the fold, loads the component with a version, and sw.js has slot 332', () => {
  const page = read('cash-bids.html');
  assert.match(page, /<details class="cb-glance-box eth-box" id="eth-box">/);
  assert.match(page, /<script src="\/components\/ethanol-bids\.js\?v=1" defer><\/script>/);
  assert.match(page, /\.eth-box #eth-bids\{min-height:6rem/, 'space held for the filled box');
  assert.ok(Number(/^var CACHE_VERSION = (\d+);/m.exec(read('sw.js'))[1]) >= 332, 'CACHE_VERSION at or past 332');
});

test('the cattle-cash workflow runs the selftest before the fetch, passes the key only there, and commits the file', () => {
  const wf = read('.github/workflows/cattle-cash.yml');
  const step = wf.slice(wf.indexOf('- name: Fetch and write data/ethanol-bids.json'), wf.indexOf('- name: Commit if changed'));
  assert.match(step, /continue-on-error: true/);
  assert.match(step, /MARS_API_KEY: \$\{\{ secrets\.MARS_API_KEY \}\}/);
  assert.match(step, /fetch_ethanol_mars\.py --selftest && python scripts\/fetch_ethanol_mars\.py/);
  // the key env line sits in exactly two steps: this one and the hog probe (fx/hogprobe), never the cattle or hog fetch
  const keySteps = wf.split('\n      - name: ').slice(1).filter((st) => st.includes('MARS_API_KEY')).map((st) => st.split('\n')[0]);
  assert.deepEqual(keySteps, ['Hog probe (LM_HG201, LM_HG203, LM_PK602 by every route)', 'Fetch and write data/ethanol-bids.json (USDA MARS 3617, 3618)']);
  assert.equal((wf.match(/MARS_API_KEY/g) || []).length, 4, 'the env lines and the key reference only');
  assert.match(wf, /FILES="\$FILES data\/ethanol-bids\.json"/);
});
