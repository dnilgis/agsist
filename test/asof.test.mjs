// components/asof.js: the "Updated" stamp wording and when each feed goes stale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../components/asof.js', import.meta.url), 'utf8');
function load() {
  const doc = { readyState: 'complete', querySelectorAll: () => [], getElementById: () => null, addEventListener() {} };
  const win = { addEventListener() {}, document: doc };
  const ctx = { window: win, document: doc, navigator: { onLine: true }, setInterval() {}, Intl, Date };
  vm.runInNewContext(src, ctx);
  return win.AgAsOf;
}
const A0 = load();
// times use a no-break space before am/pm; compare with a plain one
const A = { ...A0, when: (...a) => A0.when(...a).replace(/\u00a0/g, ' ') };
const at = (s) => new Date(s);

test('wording: today, yesterday, older, other year (Central time)', () => {
  const now = at('2026-10-09T15:00:00Z');                     // Fri Oct 9, 10:00 am CDT
  assert.equal(A.when('2026-10-09T14:42:00Z', now), '9:42 am');
  assert.equal(A.when('2026-10-08T21:10:00Z', now), 'yesterday 4:10 pm');
  assert.equal(A.when('2026-10-09T03:30:00Z', now), 'yesterday 10:30 pm'); // UTC Oct 9 is CT Oct 8
  assert.equal(A.when('2026-10-06T12:00:00Z', now), 'Oct 6');
  assert.equal(A.when('2025-12-30T18:00:00Z', now), 'Dec 30, 2025');
  assert.equal(A.when('2026-10-09', now), 'today');
  assert.equal(A.when('2026-10-05', now), 'Oct 5');
  assert.equal(A.when('', now), '');
  assert.equal(A.when('not a date', now), '');
});

test('prices: stale after 30 minutes of trading hours, not over a closed market', () => {
  // Thursday 10:00 am CDT, market open
  assert.equal(A.staleness('2026-10-08T14:40:00Z', 'prices', at('2026-10-08T15:00:00Z')).stale, false);
  const s = A.staleness('2026-10-08T14:00:00Z', 'prices', at('2026-10-08T15:00:00Z'));
  assert.equal(s.stale, true);
  assert.equal(s.note, '1 hour old');
  // Friday 1:20 pm close to Saturday noon: no trading time passed
  assert.equal(A.staleness('2026-10-09T18:25:00Z', 'prices', at('2026-10-10T17:00:00Z')).stale, false);
  // ...and to Sunday 8 pm CDT: an hour into the Sunday night session
  assert.equal(A.staleness('2026-10-09T18:25:00Z', 'prices', at('2026-10-12T01:00:00Z')).stale, true);
  // Thursday 1:46 pm (after close) to 6:45 pm (before reopen): fresh
  assert.equal(A.staleness('2026-10-08T18:46:00Z', 'prices', at('2026-10-08T23:45:00Z')).stale, false);
});

test('bids: same Central day only', () => {
  const now = at('2026-10-09T13:00:00Z'); // 8:00 am CDT
  assert.equal(A.staleness('2026-10-09T12:10:00Z', 'bids', now).stale, false);
  const y = A.staleness('2026-10-09T00:10:00Z', 'bids', now); // 7:10 pm CDT Oct 8
  assert.equal(y.stale, true);
  assert.equal(y.note, '13 hours old');
});

test('weather 3 h, usda 8 days, daily brief after the next morning', () => {
  const now = at('2026-10-09T15:00:00Z');
  assert.equal(A.staleness('2026-10-09T12:30:00Z', 'weather', now).stale, false);
  assert.equal(A.staleness('2026-10-09T11:30:00Z', 'weather', now).stale, true);
  assert.equal(A.staleness('2026-10-02T15:00:00Z', 'usda', now).stale, false);
  const u = A.staleness('2026-09-30', 'usda', now);
  assert.equal(u.stale, true);
  assert.equal(u.note, '9 days old');
  // brief made 5:47 am Thursday: fresh Thursday, fine Friday 8 am, stale Friday 10 am
  assert.equal(A.staleness('2026-10-08T10:47:00Z', 'daily', at('2026-10-08T20:00:00Z')).stale, false);
  assert.equal(A.staleness('2026-10-08T10:47:00Z', 'daily', at('2026-10-09T13:00:00Z')).stale, false);
  assert.equal(A.staleness('2026-10-08T10:47:00Z', 'daily', at('2026-10-09T15:00:00Z')).stale, true);
  // the brief runs weekends too: Friday's is old by Sunday
  assert.equal(A.staleness('2026-10-09T10:47:00Z', 'daily', at('2026-10-11T18:00:00Z')).stale, true);
  // drought map: valid Tuesday, current through the next Thursday morning
  assert.equal(A.staleness('2026-10-06', 'drought', at('2026-10-15T13:00:00Z')).stale, false);
  assert.equal(A.staleness('2026-10-06', 'drought', at('2026-10-15T19:00:00Z')).stale, true);
});

test('markup is a <time datetime>, stale ones say so, nothing without a stamp', () => {
  const h = A.html('2020-01-02T15:00:00Z', 'bids');
  assert.match(h, /^<time class="asof is-stale" datetime="2020-01-02T15:00:00.000Z" data-asof="bids" data-stale=""/);
  assert.match(h, /><span class="asof-t">Updated Jan 2, 2020<\/span><span class="asof-note"> &middot; \d+ days old<\/span><\/time>$/);
  assert.equal(A.html(null, 'bids'), '');
  assert.equal(A.html('garbage', 'bids'), '');
  const fresh = A.html(new Date().toISOString(), 'weather');
  assert.match(fresh, /^<time class="asof" /);
  assert.doesNotMatch(fresh, /asof-note/);
});
