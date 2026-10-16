// milk-prices.html: the mailbox price by AMS reporting area (Oct 16 head to
// head, change 1) and the futures "Change, last session" column.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../milk-prices.html', import.meta.url), 'utf8');
const mb = JSON.parse(readFileSync(new URL('../data/dairy-mailbox.json', import.meta.url), 'utf8'));
const box = (html.match(/<!--SEED:milkmbareas-->([\s\S]*?)<!--\/SEED-->/) || [])[1] || '';

test('every area row on the page is the number in the data file, same month as the average', () => {
  assert.ok(mb.areas, 'areas in data/dairy-mailbox.json');
  assert.equal(mb.areas.month_key, mb.month_key);
  assert.equal(mb.areas.rows.length, 20);
  for (const r of mb.areas.rows) {
    const re = new RegExp('<th scope="row">' + r.area.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?: <span[^>]*>[^<]*</span>)?</th><td class="num">\\$' + r.value.toFixed(2) + '</td>');
    assert.match(box, re, r.area);
  }
  assert.match(box, new RegExp('All federal order areas</th><td class="num">\\$' + mb.value.toFixed(2)));
});

test('hand-checked against MMPR-0626 (Sep 23, 2026): WI 18.13, MN 18.04, IA 18.29 vs national 20.18', () => {
  const v = Object.fromEntries(mb.areas.rows.map(r => [r.area, r]));
  assert.equal(v.Wisconsin.value, 18.13);
  assert.equal(v.Wisconsin.prev, 19.13);
  assert.equal(v.Wisconsin.year_ago, 21.15);
  assert.equal(v.Minnesota.value, 18.04);
  assert.equal(v.Iowa.value, 18.29);
  assert.equal(mb.value, 20.18);
  // WI vs May: 18.13 - 19.13 = -1.00; vs Jun 2025: 18.13 - 21.15 = -3.02
  assert.match(box, /Wisconsin<\/th><td class="num">\$18\.13<\/td><td class="num dp-neg">▼ −\$1\.00<\/td><td class="num dp-neg">▼ −\$3\.02<\/td>/);
});

test('the table says what a mailbox price is, that some areas are groups, and links AMS', () => {
  assert.match(box, /some are groups of states/);
  assert.match(box, /after hauling and co-op deductions/);
  assert.match(box, /viewReport\/3357/);
  assert.ok(!box.includes('—'), 'no em dash');
});

test('futures: the change column hides when no row carries a finished-session change', () => {
  assert.match(html, /id="dp-fut-chg-h">Change, last session<\/th>/);
  assert.match(html, /chgH\.hidden=!anyChg/);
  assert.match(html, /if\(anyChg\)tr\.appendChild\(t2\)/);
});
