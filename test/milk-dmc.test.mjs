// /milk-prices DMC signup (dairy board, Oct 27-28, 2026, item 1). The page said
// "2026 enrollment already closed (Feb 26)" while the 2027 signup was open
// Oct 5 to Dec 18, 2026 (FSA, Sep 30, 2026). The window now lives once, in
// data/farm-bill.json (byOperation.dairy.signup), and the page is baked from it
// by scripts/seed_static.py and recounted on the reader's clock by the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const page = fs.readFileSync(new URL('milk-prices.html', root), 'utf8');
const fb = JSON.parse(fs.readFileSync(new URL('data/farm-bill.json', root), 'utf8'));
const su = fb.byOperation.dairy.signup;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const seedOf = (tag) => {
  const m = new RegExp(`<!--SEED:${tag}-->([\\s\\S]*?)<!--/SEED-->`).exec(page);
  assert.ok(m, `SEED:${tag} marker is on the page`);
  return m[1];
};

test('no copy of the old "enrollment closed" text anywhere on the page', () => {
  assert.doesNotMatch(page, /enrollment already closed/i);
  assert.doesNotMatch(page, /closed \(Feb 26\)/);
});

test('the farm-bill signup dates and its signup line say the same thing', () => {
  assert.equal(su.year, 2027);
  assert.equal(su.open, '2026-10-05');
  assert.equal(su.close, '2026-12-18');
  const [, om, od] = su.open.split('-').map(Number);
  const [cy, cm, cd] = su.close.split('-').map(Number);
  const line = fb.byOperation.dairy.lines.find((l) => /DMC signup/.test(l.t));
  assert.ok(line, 'the dairy lines carry the signup line');
  assert.ok(line.t.includes(`${MON[om - 1]} ${od} to ${MON[cm - 1]} ${cd}, ${cy}`), line.t);
});

test('the card, the lever and the FAQ carry the file\'s window and its source', () => {
  for (const tag of ['milkdmccard', 'milkdmc']) {
    const s = seedOf(tag);
    assert.ok(s.includes(`data-open="${su.open}" data-close="${su.close}" data-year="${su.year}"`), tag);
    assert.match(s, /DMC signup (is open now|opens|closed)/, tag);
  }
  assert.ok(seedOf('milkdmccard').includes(fb.byOperation._sources[su.src]), 'FSA source beside the card');
  assert.match(seedOf('milkdmcfaq'), /DMC signup/);
  // the FAQPage copy is derived from the visible FAQ (bake_faq.py)
  assert.match(page, /"name": "When can I sign up for 2027 Dairy Margin Coverage\?"/);
  assert.ok(page.indexOf('id="dp-dmc"') < page.indexOf('id="dp-mkt-sec"'), 'the card sits above the prices');
});

test('the page clock words match the baked words, on the same frozen days', () => {
  const m = /\/\* DMC signup countdown[\s\S]*?<\/script>/.exec(page);
  assert.ok(m, 'countdown script on the page');
  const src = m[0].replace(/^\/\*[\s\S]*?\*\//, '').replace(/<\/script>$/, '');
  const win = {};
  const el = (attrs) => ({ getAttribute: (k) => attrs[k] ?? null, textContent: '' });
  vm.runInNewContext(src, { window: win, document: { getElementById: () => null }, Date });
  const e = el({ 'data-open': '2026-10-05', 'data-close': '2026-12-18', 'data-year': '2027' });
  const at = (y, mo, d) => win.agsistDmcWords(e, new Date(y, mo - 1, d, 15, 0));
  assert.equal(at(2026, 10, 28), '2027 DMC signup is open now, to Friday, Dec 18, 2026, at your FSA office. 51 days left.');
  assert.equal(at(2026, 10, 1), '2027 DMC signup opens Monday, Oct 5, 2026, and runs to Dec 18, 2026.');
  assert.equal(at(2026, 12, 17), '2027 DMC signup is open now, to Friday, Dec 18, 2026, at your FSA office. 1 day left.');
  assert.equal(at(2026, 12, 18), '2027 DMC signup is open now, to Friday, Dec 18, 2026, at your FSA office. Today is the last day.');
  assert.equal(at(2026, 12, 19), 'The 2027 DMC signup closed Dec 18, 2026.');
  // across the Nov 1 clock change the count is still whole days
  assert.equal(at(2026, 11, 2), '2027 DMC signup is open now, to Friday, Dec 18, 2026, at your FSA office. 46 days left.');
});

test('the seeder\'s own offline checks pass (scripts/test_milk_seed.py)', () => {
  const out = execFileSync('python3', ['scripts/test_milk_seed.py'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /all milk seed checks pass/);
});
