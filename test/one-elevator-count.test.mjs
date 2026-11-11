/* One elevator count (Nov 11, 2026). Pages printed 2,091 "elevators", 2,095 "bid boards" and 2,052
 * "locations" at the same time: three definitions, no label to say so. The count a reader sees is one
 * built field, data/elevator-counts.json `bids.elevators` (elevators with a current bid; `bids.towns`
 * beside it), and every page reads it or has it baked in from it.
 *
 * This test: no public page or script types an elevator count by hand. A count may only sit inside a
 * block a builder writes from the data (SEED, CB-OPEN, CO-FAQ, CO-LINE, structured data, meta, title).
 * Dated history is exempt: the changelog and the monthly Cash Bid Index edition count a past day.
 *
 *   node --test test/one-elevator-count.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const COUNT = /\b\d{1,2},?\d{3}\+?\s+(?:grain\s+)?(?:elevators?|elevator boards|bid boards|boards|elevator locations|locations)\b/gi;
const DATED = new Set(['changelog.html', 'cash-bid-index.html']);
const BAKED = [
  /<!--SEED:([\w:-]+)-->[\s\S]*?<!--\/SEED-->/g,
  /<!--(CB-OPEN|CO-FAQ|CO-LINE)-->[\s\S]*?<!--\/\1-->/g,
  /<script type="application\/ld\+json">[\s\S]*?<\/script>/g,
  /<meta [^>]*>/g,
  /<title>[\s\S]*?<\/title>/g,
  /<!--[\s\S]*?-->/g,
];
const jsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

function handTyped() {
  const hits = [];
  const pages = fs.readdirSync(root).filter((f) => f.endsWith('.html') && !DATED.has(f));
  for (const f of pages) {
    let s = read(f);
    for (const r of BAKED) s = s.replace(r, '');
    s = s.replace(/<script\b(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g, (m, body) => `<script>${jsComments(body)}</script>`);
    for (const m of s.matchAll(COUNT)) hits.push(`${f}: ${m[0]}`);
  }
  for (const f of fs.readdirSync(path.join(root, 'components')).filter((x) => x.endsWith('.js'))) {
    const s = jsComments(read(`components/${f}`));
    for (const m of s.matchAll(COUNT)) hits.push(`components/${f}: ${m[0]}`);
  }
  return hits;
}

test('no public page or component types an elevator count by hand', () => {
  assert.deepEqual(handTyped(), [], 'read data/elevator-counts.json (bids.elevators) or bake it in a builder block');
});

test('the scan catches a hand-typed count and lets a baked one through', () => {
  let s = '<p>AGSIST shows bids from 2,052 locations.</p><!--SEED:x--><b>2,091 elevators</b><!--/SEED-->';
  for (const r of BAKED) s = s.replace(r, '');
  assert.deepEqual([...s.matchAll(COUNT)].map((m) => m[0]), ['2,052 locations']);
});

test('the one field exists and the readers use it', () => {
  const c = JSON.parse(read('data/elevator-counts.json'));
  // live data: the count may be withheld on a bad run, but when present it is a whole positive number
  if (c.bids && c.bids.elevators !== undefined) assert.ok(Number.isInteger(c.bids.elevators) && c.bids.elevators > 0);
  const idx = read('index.html');
  const s = idx.indexOf("getElementById('idx1-trust-ledger')");
  const block = idx.slice(s, idx.indexOf('</script>', s));
  assert.match(block, /\/data\/elevator-counts\.json/, 'home reads the one field');
  assert.doesNotMatch(block, /stats\.locations|bids-stats\.json/, 'home no longer prints the bids file\'s location count');
  const fut = read('components/futures.js');
  assert.match(fut, /var k=c&&c\.bids;/, 'futures pages read bids.elevators');
  assert.doesNotMatch(fut, /it knows are read directly/);
  const cb = read('scripts/build_cash_bid_pages.py');
  assert.doesNotMatch(cb, /bid boards, out of/, '/cash-bids prints one count, not the boards-read tally beside it');
  for (const f of ['scripts/seed_static.py', 'scripts/build_cash_bid_pages.py', 'scripts/dev/nav/refresh_baked.py']) {
    assert.match(read(f), /elevator-counts\.json/, `${f} bakes from the one file`);
  }
});
