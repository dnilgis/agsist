// The Today list (elev-today.html, components/today-core.js) against the real
// dnilgis/bids index of 2026-10-20 15:40 UTC (test/fixtures, trimmed to the
// fields it reads). scripts/morning_report.py does the same sums for the email;
// its selftest reads the same fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const T = req('../components/today-core.js'), P = req('../components/paste-bids.js');
const IDX = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/today-bids-index-2026-10-20.json.gz', import.meta.url))));
const NOW = Date.parse(IDX.generated);

test('health: boards with a current price', () => {
  const h = T.health(IDX, NOW);
  assert.deepEqual(h, { current: 2046, total: 2281, pct: 90 });
});

test('hand-paste sites, biggest town count first: NEW Cooperative, then Frontier, then Central United', () => {
  const ps = T.handPaste(IDX, NOW, P.siteFor);
  assert.deepEqual(ps.slice(0, 3).map((p) => [p.host, p.why, p.boards, T.townsText(p), p.site]), [
    ['newcoop.com', 'bot check', 66, '66 Iowa towns', 'newcoop'],
    ['frontiercooperative.com', 'refused', 42, '42 towns in Iowa, Nebraska', null],
    ['centralunitedcoop.com', 'bot check', 16, '16 Minnesota towns', null]]);
  assert.equal(ps[0].lastGood, '2026-10-19T15:30:29.149Z', 'the last good read, Oct 19 10:30 AM CT');
  assert.equal(T.ct(ps[0].lastGood), 'Oct 19, 10:30 AM CT');
  /* a host whose refused board was read well within 6 h is not on the list */
  assert.ok(!ps.some((p) => p.host === 'stanfordgrain.com' || p.host === 'keystonecoop.com'), ps.map((p) => p.host).join(' '));
  for (let i = 1; i < ps.length; i++) assert.ok(ps[i - 1].towns >= ps[i].towns);
});

test('a site Sig pasted stays on the list while the reader is still blocked, with its paste time', () => {
  const pa = '2026-10-20T14:05:00.000Z';
  const idx = { sources: IDX.sources.map((s) => /^newcoop-/.test(s.id)
    ? Object.assign({}, s, { health: 'live', status: 'ok', pasted: true, pastedAt: pa, checkedAt: pa }) : s) };
  const h = T.health(idx, NOW);
  assert.equal(h.current, 2046 + 66, 'the 66 pasted boards count as current');
  const p = T.handPaste(idx, NOW, P.siteFor).find((x) => x.host === 'newcoop.com');
  assert.ok(p && p.pastedAt === pa && p.boards === 66, JSON.stringify(p));
  /* seven days and a minute on, the pasted boards are not current */
  assert.equal(T.health(idx, Date.parse(pa) + 168 * 36e5 + 60e3).current < 2046 + 66, true);
});

test('the bookmarklet\'s host finds the paste reader; any other host has none', () => {
  assert.equal(P.siteFor('www.newcoop.com'), 'newcoop');
  assert.equal(P.siteFor('newcoop.com'), 'newcoop');
  assert.equal(P.siteFor('newcoop'), 'newcoop');
  assert.equal(P.siteFor('centralunitedcoop.com'), null);
});

test('elev-today.html: the bookmarklet copies and opens the paste box, and carries no token', () => {
  const h = readFileSync(new URL('../elev-today.html', import.meta.url), 'utf8');
  const bm = /var BM = "(javascript:[^"]+)";/.exec(h)[1];
  assert.match(bm, /document\.documentElement\.outerHTML/);
  assert.match(bm, /navigator\.clipboard\.writeText/);
  assert.match(bm, /https:\/\/agsist\.com\/elev-admin\.html\?paste=/);
  assert.doesNotMatch(bm, /fetch\(|XMLHttpRequest|sendBeacon|token|Bearer|workers\.dev/i, 'it sends nothing anywhere and holds no token');
  assert.doesNotMatch(h, /—/);
  assert.match(h, /localStorage/, 'done ticks are kept in this browser');
  assert.doesNotMatch(h, /\.email\b|\.phone\b/, 'names only: no email or phone is shown');
});
