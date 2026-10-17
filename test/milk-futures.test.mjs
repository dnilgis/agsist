// milk-prices.html: the Class III futures table shows each contract's last
// FINISHED session. 2026-10-15 head to head: the table read Nov $17.07 and
// Dec $17.18. The 00:31 CT price file held Nov dated Oct 15 (a trade in a bar
// Yahoo had just opened) next to Oct and Dec dated Oct 14. The Oct 14 Nov
// close was $16.87, which is also that bar's open and close minus change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../milk-prices.html', import.meta.url), 'utf8');

function load() {
  const m = /\/\*settled:start\*\/([\s\S]*?)\/\*settled:end\*\//.exec(page);
  assert.ok(m, 'the page carries the settled-close helper');
  // eslint-disable-next-line no-new-func
  return new Function(m[1] + '\nreturn {settledQuote, ctParts};')();
}

// data/prices.json, fetched 2026-10-15T05:31:30Z (00:31 a.m. CT Oct 15)
const FETCHED = Date.parse('2026-10-15T05:31:30Z');
const Q = {
  'milk-oct26': { close: 15.05, netChange: 0.0, close_date: '2026-10-14', prev_date: '2026-10-13' },
  'milk-nov26': { close: 17.07, open: 16.87, netChange: 0.2, close_date: '2026-10-15', prev_date: '2026-10-14' },
  'milk-dec26': { close: 17.18, netChange: 0.21, close_date: '2026-10-14', prev_date: '2026-10-13' },
};

test('a bar dated the fetch day is a trade: the previous close is shown, dated, with no change', () => {
  const { settledQuote } = load();
  const s = settledQuote(Q['milk-nov26'], FETCHED);
  assert.deepEqual(s, { close: 16.87, date: '2026-10-14', chg: null });
});

test('a bar from a day that ended before the fetch is that day\'s close, with its change', () => {
  const { settledQuote } = load();
  assert.deepEqual(settledQuote(Q['milk-dec26'], FETCHED), { close: 17.18, date: '2026-10-14', chg: 0.21 });
  assert.deepEqual(settledQuote(Q['milk-oct26'], FETCHED), { close: 15.05, date: '2026-10-14', chg: 0 });
});

test('the day\'s bar before 11 p.m. CT is still a trade; from 11 p.m. CT it is the close', () => {
  const { settledQuote } = load();
  const bar = { close: 16.87, netChange: 0.34, close_date: '2026-10-14', prev_date: '2026-10-13' };
  assert.equal(settledQuote(bar, Date.parse('2026-10-14T20:00:00Z')).date, '2026-10-13');   // 3 p.m. CT
  assert.equal(settledQuote(bar, Date.parse('2026-10-15T04:01:00Z')).date, '2026-10-14');   // 11:01 p.m. CT
});

test('nothing safe to say means no row, never a zero', () => {
  const { settledQuote } = load();
  assert.equal(settledQuote({ close: 17.07, close_date: '2026-10-15' }, FETCHED), null, 'no change to step back with');
  assert.equal(settledQuote({ close: 0, close_date: '2026-10-14' }, FETCHED), null);
  assert.equal(settledQuote({ close: 17.07, netChange: 0.2, close_date: '2026-10-15', prev_date: '2026-10-14', roll: true }, FETCHED), null);
});

test('the table reads only the settled helper, and says what its numbers are', () => {
  const i = page.indexOf('function futures(p){');
  assert.ok(i > 0);
  const body = page.slice(i, page.indexOf('\n    }\n', i));
  assert.match(body, /settledQuote\(q\[k\],f\)/);
  assert.doesNotMatch(body, /close:o\.close/, 'no raw last trade in the table');
  // 2026-10-17 (N2): the words follow close_kind; never "not settlements" over a settle
  assert.match(page, /each at its last finished session \(<span id="dp-fut-kind">Yahoo Finance, delayed; a close can sit a tick off the CME settle<\/span>\)/);
  assert.match(body, /allSettle\?'CME settles, read from Yahoo Finance'/);
  assert.doesNotMatch(page, /not official CME settlements/);
});

test('close_kind from fetch_prices v3.7: a settle is the settle, a last trade steps back to the settle on file', () => {
  const { settledQuote } = load();
  const f = Date.parse('2026-10-17T14:35:00Z');
  assert.deepEqual(settledQuote({ close: 17.34, netChange: 0.09, close_date: '2026-10-16', prev_date: '2026-10-15',
    close_kind: 'settle', settle: 17.34, settle_date: '2026-10-16', settle_net: 0.09 }, f),
    { close: 17.34, date: '2026-10-16', chg: 0.09, kind: 'settle' });
  assert.deepEqual(settledQuote({ close: 17.5, netChange: 0.16, close_date: '2026-10-19', prev_date: '2026-10-16',
    close_kind: 'last', settle: 17.34, settle_date: '2026-10-16', settle_net: 0.09 }, f),
    { close: 17.34, date: '2026-10-16', chg: 0.09, kind: 'settle' });
  assert.equal(settledQuote({ close: 17.5, close_date: '2026-10-19', close_kind: 'last' }, f), null, 'a last trade with no settle on file shows nothing');
});
