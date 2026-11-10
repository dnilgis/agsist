// USDA state cash grain (data/state-grain-ams.json) and daily FI slaughter (data/slaughter.json),
// read from USDA My Market News by scripts/fetch_state_grain_mars.py and scripts/fetch_slaughter_mars.py
// in the hay-ams workflow (Nov 2 2026). Real case: the saved report answers of Nov 2, 2026 in
// test/fixtures/mars-grain and test/fixtures/mars-slaughter. The 15 cent cross-check against our state
// medians is scripts/check_state_grain_ams.py: it reports and never fails a build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const py = (args, env = {}) => spawnSync('python3', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });

test('selftests pass (grain, slaughter, check)', () => {
  for (const [f, done] of [['scripts/fetch_state_grain_mars.py', /fetch_state_grain_mars selftest: all ok \(\d+ checks\)/],
    ['scripts/fetch_slaughter_mars.py', /fetch_slaughter_mars selftest: all ok/],
    ['scripts/check_state_grain_ams.py', /check_state_grain_ams selftest: all ok/]]) {
    const r = py([f, '--selftest']);
    assert.equal(r.status, 0, f + '\n' + r.stdout + r.stderr);
    assert.match(r.stdout, done, f);
    assert.doesNotMatch(r.stdout, /FAIL/, f);
  }
});

test('real case Nov 2, 2026: every report read, honest fields, no link, no em dash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-'));
  const out = path.join(dir, 'state-grain-ams.json');
  const r = py(['scripts/fetch_state_grain_mars.py', '--fixtures', 'test/fixtures/mars-grain', '--out', out, '--today', '2026-11-02']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /15 of 15 reports read/);
  const d = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(Object.keys(d.states).sort(), ['IA', 'IL', 'IN', 'KS', 'MN', 'MO', 'ND', 'NE', 'OH', 'SD']);
  assert.deepEqual(Object.keys(d.export).sort(), ['gulf', 'pnw']);
  assert.deepEqual(Object.keys(d.terminals).sort(), ['iowa_mn_barge', 'kansas_city_wheat', 'minneapolis']);
  const ia = d.states.IA;
  assert.equal(ia.source, 'USDA AMS, Iowa Daily Cash Grain Bids, Nov 2, 2026');
  assert.deepEqual(ia.crops.corn.current.avg_basis, { Z: -41 });
  assert.equal(ia.usda_state_avg.corn.basis, -42, "USDA's own stated Iowa average is kept as stated");
  // new crop never mixed into current
  assert.ok(d.states.IN.crops.wheat_srw.new_crop && d.states.IN.crops.wheat_srw.current);
  assert.notEqual(d.states.IN.crops.wheat_srw.new_crop.price_lo, d.states.IN.crops.wheat_srw.current.price_lo);
  // a state average from one region of a many-region report is withheld
  assert.equal(d.states.OH.crops.corn.current.avg_price, null);
  assert.equal(d.states.OH.crops.corn.current.avg_basis, undefined);
  for (const st of Object.values(d.states)) {
    if (st.daily_line) assert.ok(st.daily_line.endsWith(st.source + '.'), st.daily_line);
  }
  assert.match(d.daily_line, /^Gulf export bids, barge CIF: corn \d+ to \d+ over Dec; soybeans \d+ to \d+ over Nov\. USDA AMS, Louisiana and Texas Export Bids, Nov 2, 2026\.$/);
  const s = JSON.stringify(d);
  assert.doesNotMatch(s, /https?:/, 'no link to a data source (Oct 29 rule)');
  assert.doesNotMatch(s, /—/, 'no em dash');
  assert.ok(s.length < 60000, 'small derived file, not the raw answer: ' + s.length);
  // the check reads it beside our medians and only reports
  const c = py(['scripts/check_state_grain_ams.py', '--usda', out]);
  assert.equal(c.status, 0, c.stdout + c.stderr);
  assert.match(c.stdout, /state grain check: \d+ compared, \d+ flagged over 15c, \d+ not compared/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('slaughter real case: Nov 2 cattle and hogs with week-ago and year-ago', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));
  const out = path.join(dir, 'slaughter.json');
  const r = py(['scripts/fetch_slaughter_mars.py', '--fixtures', 'test/fixtures/mars-slaughter', '--out', out, '--today', '2026-11-02']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const d = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual([d.cattle.head, d.cattle.week_ago, d.cattle.year_ago], [104000, 106000, 110771]);
  assert.deepEqual([d.hogs.head, d.hogs.week_ago, d.hogs.year_ago], [492000, 484000, 496398]);
  assert.match(d.daily_line, /USDA AMS, Daily Livestock and Poultry Slaughter, Nov 2, 2026\.$/);
  assert.doesNotMatch(JSON.stringify(d), /https?:|—/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('no key: nothing fetched, nothing written, exit 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-'));
  for (const [f, name] of [['scripts/fetch_state_grain_mars.py', 'g.json'], ['scripts/fetch_slaughter_mars.py', 's.json']]) {
    const r = py([f, '--out', path.join(dir, name)], { MARS_API_KEY: '' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /no MARS_API_KEY/);
    assert.ok(!fs.existsSync(path.join(dir, name)));
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('workflow: rides the weekday hay-ams run (no new schedule), soft, key from secrets, files committed', () => {
  const wf = fs.readFileSync(path.join(root, '.github/workflows/hay-ams.yml'), 'utf8');
  const crons = [...wf.matchAll(/- cron: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(crons, ['17 23 * * 1-5', '41 14 * * 6'], 'the schedule is unchanged');
  const i = wf.indexOf('name: USDA state cash grain and daily slaughter');
  assert.ok(i > 0);
  const step = wf.slice(i, wf.indexOf('- name:', i + 10));
  assert.match(step, /continue-on-error: true/);
  assert.match(step, /MARS_API_KEY: \$\{\{ secrets\.MARS_API_KEY \}\}/);
  for (const s of ['fetch_state_grain_mars.py', 'fetch_slaughter_mars.py', 'check_state_grain_ams.py']) assert.ok(step.includes(s), s);
  assert.match(wf, /FILES="[^"]*data\/state-grain-ams\.json data\/slaughter\.json"/);
  // the key is never echoed
  assert.doesNotMatch(wf, /echo[^\n]*MARS_API_KEY/);
});
