// harvest-price-tracker.html, held to data/harvest-prices.json (2026-10-15
// head to head): the running number belongs in the title and H1, the evening's
// own day is provisional and never called a settle, the note about RMA's figure
// says which days ours covers instead of claiming a lag that ran the other way,
// the October arithmetic is on the card, and the page routes nobody to an agent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(root, 'harvest-price-tracker.html'), 'utf8');
const d = JSON.parse(fs.readFileSync(path.join(root, 'data/harvest-prices.json'), 'utf8'));
const by = Object.fromEntries(d.commodities.map((c) => [c.label, c]));
const corn = by.Corn, soy = by.Soybeans;
const running = corn.harvest.status === 'running' && soy.harvest.status === 'running';

test('title, description and H1 carry the running number while October runs', () => {
  const title = /<title>([^<]*)<\/title>/.exec(page)[1];
  const h1 = /<!--SEED:hph1-->([\s\S]*?)<!--\/SEED:hph1-->/.exec(page)[1];
  if (running) {
    const c = corn.harvest.running_avg.toFixed(2), s = soy.harvest.running_avg.toFixed(2);
    assert.equal(title, `${d.crop_year} Harvest Price So Far: Corn $${c}, Soybeans $${s} | AGSIST`);
    assert.equal(h1, `${d.crop_year} harvest price so far: corn $${c}, soybeans $${s}`);
    assert.match(page, new RegExp(`<meta property="og:title" content="${d.crop_year} Harvest Price So Far: Corn \\$${c}`));
    const desc = /<meta name="description" content="([^"]*)"/.exec(page)[1];
    assert.ok(desc.length <= 160 && !/%/.test(desc), desc);
  } else {
    assert.ok(!/So Far/.test(title), title);
  }
  assert.match(page, /<p class="hp-sub">When does your <em>price<\/em> get set\?<\/p>/);
});

test('the evening\'s own day is provisional, and the RMA note says which days ours covers', () => {
  const seed = /<!--SEED:hpcards-->([\s\S]*?)<!--\/SEED:hpcards-->/.exec(page)[1];
  assert.doesNotMatch(seed, /lag/, 'the running average is not behind RMA; it was a day ahead');
  const ser = corn.harvest.series || [];
  if (running && ser.length) {
    const last = ser[ser.length - 1];
    const md = new Date(last.d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    assert.match(seed, new RegExp(`Ours counts through ${md}\\.`));
    if (last.p) {
      assert.match(seed, new RegExp(`${ser.length} of ${corn.harvest.days_total} days, ${md} provisional`));
      assert.doesNotMatch(seed, new RegExp(`${ser.length} of ${corn.harvest.days_total} settles`));
    }
    assert.match(seed, /class="hpc-math">For the harvest price to finish (below|above) the \$4\.62 projected price, the \d+ settles left would have to average \$\d+\.\d\d or (less|more)/);
  }
});

test('no agent, and the reviewer is a CCA', () => {
  assert.doesNotMatch(page, /\bagent\b/i);
  assert.match(page, /check your policy(&rsquo;|')s price at RMA/);
  assert.match(page, /"jobTitle":"Certified Crop Adviser \(CCA\)"/);
});

test('RMA\'s figure is labeled with the day it covers when that is certain', () => {
  assert.match(page, /function rmaThrough\(g\)\{/);
  assert.match(page, /return hit\.length===1\?hit\[0\]\.d:null;/);
});

test('fetch_harvest_prices selftest passes', () => {
  const out = execFileSync('python3', ['scripts/fetch_harvest_prices.py', '--selftest'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assert.match(out, /selftest ok/);
});
