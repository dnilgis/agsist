// cattle-futures-prices.html: the cash side (5-area fed steers, boxed beef
// cutout) from data/cattle-cash.json, written by scripts/fetch_cattle_cash.py
// in the cattle-cash workflow from public USDA AMS reports. 2026-10-15 head to
// head: the page was futures only. Nothing shows until the file exists, every
// figure carries its report date, and an old one becomes a dash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(root, 'cattle-futures-prices.html'), 'utf8');

function cashView() {
  const m = /\/\*cash:start\*\/([\s\S]*?)\/\*cash:end\*\//.exec(page);
  assert.ok(m, 'the page carries the cash view');
  // eslint-disable-next-line no-new-func
  return new Function(m[1] + '\nreturn cashView;')();
}

const D = {
  fed_steer: { week_ending: '2026-10-11', price: 232.65, head: 17153 },
  cutout: { date: '2026-10-12', choice: 375.56, select: 354.13 },
};
const NOW = Date.parse('2026-10-15T18:00:00Z');

test('the block ships hidden and empty: no number before the file exists', () => {
  assert.match(page, /<section class="fwd-card" id="ct-cash" hidden/);
  const i = page.indexOf('id="ct-cash"');
  const html = page.slice(i, page.indexOf('</section>', i));
  assert.doesNotMatch(html, /\$\d/, 'no baked dollar figure');
  assert.equal(cashView()(null, NOW), null);
  assert.equal(cashView()({}, NOW), null);
});

test('each figure is shown with its own report date', () => {
  const v = cashView()(D, NOW);
  assert.equal(v.steer.val, '$232.65');
  assert.equal(v.steer.meta, 'Week ending Oct 11, 2026 · 17,153 head · live, all grades · USDA AMS');
  assert.equal(v.cut.val, '$375.56');
  assert.equal(v.cut.meta, 'Oct 12, 2026 · Select $354.13 · carcass basis · USDA AMS');
});

test('an old figure is a dash with the date held, never the number', () => {
  const v = cashView()(D, Date.parse('2026-11-05T18:00:00Z'));
  assert.equal(v.steer.val, '-');
  assert.equal(v.steer.meta, 'Latest held: week ending Oct 11, 2026. Too old to show.');
  assert.equal(v.cut.val, '-');
  assert.match(v.cut.meta, /^Latest held: Oct 12, 2026\./);
});

test('a missing or zero value shows nothing for that card', () => {
  const v = cashView()({ cutout: { date: '2026-10-12', choice: 0 }, fed_steer: D.fed_steer }, NOW);
  assert.equal(v.cut, null);
  assert.equal(v.steer.val, '$232.65');
});

test('the fetcher selftest passes and the workflow runs it before any fetch', () => {
  const out = execFileSync('python3', ['scripts/fetch_cattle_cash.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /all cattle cash checks pass/);
  const wf = fs.readFileSync(path.join(root, '.github/workflows/cattle-cash.yml'), 'utf8');
  assert.ok(wf.indexOf('--selftest') < wf.indexOf('run: python scripts/fetch_cattle_cash.py\n'), 'selftest first');
  // main gets the feed only; the probe's PDFs and text go to the raw branch (never deployed)
  assert.match(wf, /FILES="data\/cattle-cash\.json"/);
  assert.match(wf, /bash scripts\/push_raw\.sh "cattle-cash probe" data\/cattle-cash-raw\n/);
});

test('the mailbox fetcher selftest passes and the dairy workflow runs it', () => {
  const out = execFileSync('python3', ['scripts/fetch_mailbox.py', '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /all mailbox checks pass/);
  const wf = fs.readFileSync(path.join(root, '.github/workflows/dairy.yml'), 'utf8');
  assert.match(wf, /python scripts\/fetch_mailbox\.py --selftest/);
  assert.match(wf, /run: python scripts\/fetch_mailbox\.py\n/);
  assert.match(wf, /data\/dairy-mailbox\.json/);
});
