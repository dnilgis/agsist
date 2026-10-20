// Paste bids (components/paste-bids.js): Sig pastes NEW Cooperative's public
// bid page, opened in his own browser, into elev-admin.html. The fixtures are
// the real board's markup (trimmed from the Oct 2 capture, Afton's Oct 2026 corn
// row set to the Oct 20 numbers Sig saw: $4.26, -35, 461-4, -5-4) and that page's
// select-all text as Chromium renders it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('../components/paste-bids.js');
const F = (f) => readFileSync(new URL('./fixtures/paste-bids/' + f, import.meta.url), 'utf8');
const HTML = F('newcoop-page-source.html'), TEXT = F('newcoop-select-all.txt');
const AFTON = { commodity: 'Corn', delivery: '10/1/2026 - 10/31/2026', cash: '$4.26', basis: '-35', future: '461-4', change: '-5-4' };

test('page source: every location and row, cells as printed', () => {
  const r = P.read('newcoop', HTML);
  assert.equal(r.kind, 'page source');
  assert.deepEqual(r.matched[0].rows[0], AFTON);
  assert.deepEqual(r.matched.map((l) => l.id), ['newcoop-afton', 'newcoop-creston1', 'newcoop-creston2', 'newcoop-luverne']);
  assert.deepEqual(r.unmatched.map((u) => u.name), ['Mt. Ayr'], 'a location with no board is shown, not sent');
  assert.equal(r.missing.length, 66 - 4);
  assert.equal(r.rows, r.matched.reduce((a, l) => a + l.rows.length, 0));
  assert.ok(r.rows >= 40);
  assert.deepEqual(r.body.locations.map((l) => l.name), ['Afton', 'Creston 1', 'Creston 2', 'LuVerne']);
});

test('select-all text, tab separated (a computer) and a cell per line (a phone), reads the same', () => {
  const a = P.read('newcoop', HTML), b = P.read('newcoop', TEXT), c = P.read('newcoop', TEXT.replace(/\t/g, '\n'));
  assert.equal(b.kind, 'copied text');
  assert.deepEqual(b.body, a.body);
  assert.deepEqual(c.body, a.body);
});

test('"Lu Verne" is LuVerne, "Creston 1" and "Creston 2" stay apart, "Mt. Ayr" has no board', () => {
  const m = P.match('newcoop', [{ name: 'Lu Verne', rows: [AFTON] }, { name: 'Creston 1', rows: [AFTON] },
    { name: 'Creston 2', rows: [AFTON] }, { name: 'Mt. Ayr', rows: [AFTON] }]);
  assert.deepEqual(m.matched.map((x) => [x.id, x.name, x.printed]),
    [['newcoop-luverne', 'LuVerne', 'Lu Verne'], ['newcoop-creston1', 'Creston 1', 'Creston 1'], ['newcoop-creston2', 'Creston 2', 'Creston 2']]);
  assert.deepEqual(m.unmatched, [{ name: 'Mt. Ayr', rows: 1 }]);
});

test('a bot check page, an empty paste, or one with no rows is refused', () => {
  const check = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt={cType:"managed"};</script></body></html>';
  assert.match(P.read('newcoop', check).error, /bot check page/);
  assert.match(P.read('newcoop', 'Just a moment...\nVerify you are human by completing the action below.').error, /bot check/);
  assert.match(P.read('newcoop', '   ').error, /Nothing was pasted/);
  assert.match(P.read('newcoop', '<html><body><h1 class="text-4xl">Afton</h1><p>no table</p></body></html>').error, /No bid rows/);
  assert.match(P.read('cargill', HTML).error, /no paste reader/);
  assert.equal(P.botCheck(HTML), false, "Cloudflare's passive script on the real board is not a bot check");
});

test('the board list is the 66 dnilgis/bids newcoop boards', () => {
  assert.equal(P.NEWCOOP_BOARDS.length, 66);
  assert.equal(new Set(P.NEWCOOP_BOARDS.map((b) => b[0])).size, 66);
  assert.ok(P.NEWCOOP_BOARDS.every(([id]) => /^newcoop-[a-z0-9]+$/.test(id)));
});

test('every saved cell passes the Worker\'s own check (workers/subs-worker.js PASTE_CELL)', () => {
  const w = readFileSync(new URL('../workers/subs-worker.js', import.meta.url), 'utf8');
  const block = w.slice(w.indexOf('const PASTE_CELL = {'), w.indexOf('function pasteClean'));
  const re = {};
  for (const m of block.matchAll(/(\w+): (\/.*\/i?),\n/g)) re[m[1]] = eval(m[2]);
  assert.equal(Object.keys(re).length, 6);
  for (const l of P.read('newcoop', HTML).body.locations)
    for (const r of l.rows) for (const [f, x] of Object.entries(re)) assert.ok(x.test(r[f]), `${l.name} ${f} ${r[f]}`);
});
