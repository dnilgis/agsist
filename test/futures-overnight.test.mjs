// The overnight (electronic) grain trade, shown when the price file has one.
// Sig, Oct 20 2026: "Just don't forget about overnight market trading, I want
// that displayed if it is available." Fixtures are the real data/prices.json
// from main at two moments that night:
//   prices-2026-10-20T0046Z.json (7:46 pm CT Oct 19): settle not in yet.
//     Dec corn close 466.75 (the 1:20 pm last trade, close_kind last),
//     settled:true, last 465.50 at 00:45:52Z, last_net -1.25; settle Oct 16 474.25.
//   prices-2026-10-20T0446Z.json (11:46 pm CT Oct 19): the Oct 19 settle 467.00
//     is in; close 465.00 is the overnight trade (close_time 04:45:54Z), -2.00.
// Livestock has no overnight session: cattle shows nothing extra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const P = require(path.join(root, 'components/price-local.js'));
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const fx = (n) => JSON.parse(read(`test/fixtures/futures-overnight/prices-2026-10-20T${n}.json`));
const EVE = fx('0046Z'), NIGHT = fx('0446Z');
const now = (d) => Date.parse(d.fetched);
// the corn page's own formatters, in plain text (AG.px glyph style)
const FR = { 0: '', 25: '¼', 50: '½', 75: '¾' };
const cents = (c) => { const q = Math.round(c * 4) / 4, w = Math.floor(q), f = Math.round((q - w) * 100); return [w, FR[f]]; };
const fmt = (c) => { const [w, f] = cents(c); return '$' + Math.floor(w / 100) + '.' + String(w % 100).padStart(2, '0') + f; };
const move = (n) => { const [w, f] = cents(Math.abs(n)); return (n > 0 ? '+' : n < 0 ? '−' : '') + (w || !f ? w : '') + f + '¢'; };
const text = (h) => h.replace(/<[^>]+>/g, '').replace(/&middot;/g, '·').replace(/ /g, ' ');

test('evening file, settle not posted: the overnight trade under the day session price', () => {
  const q = EVE.quotes.corn;
  const o = P.overnight(q);
  assert.deepEqual(o, { px: 465.5, net: -1.25, at: '2026-10-20T00:45:52Z', hero: false,
    ref: { px: 466.75, date: '2026-10-19', kind: 'last' } });
  assert.equal(text(P.overnightHtml(q, fmt, move, now(EVE))),
    'Overnight electronic trade $4.65½ (−1¼¢) at 7:45 pm CT. Oct 19 settle not posted yet.');
  assert.equal(text(P.overnightHtml(q, fmt, move, now(EVE), { short: true })), 'Overnight $4.65½ (−1¼¢), 7:45 pm CT');
  // the main price stays the day's last trade, called that
  assert.equal(text(P.stamp(q, EVE.fetched, now(EVE))), 'Last trade as of 1:20 pm CT');
  for (const k of ['beans-nov', 'wheat', 'kcwheat', 'oats', 'corn-dec27']) assert.ok(P.overnight(EVE.quotes[k]), k);
});

test('overnight file, settle posted: the overnight trade is the price, the settle beside it', () => {
  const q = NIGHT.quotes.corn;
  const o = P.overnight(q);
  assert.deepEqual(o, { px: 465, net: -2, at: '2026-10-20T04:45:54Z', hero: true,
    ref: { px: 467, date: '2026-10-19', kind: 'settle' } });
  assert.equal(text(P.stamp(q, NIGHT.fetched, now(NIGHT))), 'Overnight trade as of 11:45 pm CT');
  assert.equal(text(P.overnightHtml(q, fmt, move, now(NIGHT))), 'Overnight electronic trade at 11:45 pm CT. Oct 19 settle $4.67.');
  assert.equal(text(P.overnightHtml(q, fmt, move, now(NIGHT), { short: true })), 'Overnight at 11:45 pm CT · Oct 19 settle $4.67');
  assert.match(text(P.overnightHtml(NIGHT.quotes['beans-nov'], fmt, move, now(NIGHT))), /Oct 19 settle \$12\.53½\.$/);
});

test('no overnight line for livestock, energy, a settle or a day-session trade', () => {
  for (const d of [EVE, NIGHT]) for (const k of ['cattle', 'feeders', 'hogs', 'cattle-nearby', 'crude', 'gold', 'dollar']) {
    assert.equal(P.overnight(d.quotes[k]), null, k);
    assert.equal(P.overnightHtml(d.quotes[k], fmt, move), '', k);
  }
  const day = { ...NIGHT.quotes.corn, close_time: '2026-10-20T17:00:00Z' };   // 12:00 pm CT
  assert.equal(P.overnight(day), null, 'a day-session trade is not overnight');
  assert.equal(P.overnight({ ...NIGHT.quotes.corn, close_kind: 'settle' }), null);
  assert.equal(P.overnight({ ...NIGHT.quotes.corn, roll: true }), null, 'no change across a roll');
  assert.equal(P.overnight(null), null);
});

test('every page that leads with a grain price draws the overnight line', () => {
  const fut = read('components/futures.js');
  assert.match(fut, /heroOvernight\(front\);/);
  assert.match(fut, /function heroOvernight\(q\)\{[\s\S]{0,400}AgPxStamp\.overnightHtml\(q,grain\$/);
  assert.match(fut, /\/\^\(Last\|Overnight\) trade\//, 'the hero line takes the overnight stamp');
  assert.match(read('markets.html'), /AgPxStamp\.overnightHtml\(d,/);
  assert.match(read('index.html'), /AgPxStamp\.overnightHtml\(x,[\s\S]{0,200}\{short:true\}/);
  assert.match(read('components/geo.js'), /meta\.grain && meta\.priceEl && q && window\.AgPxStamp && AgPxStamp\.overnightHtml/);
  assert.match(read('components/home-yield.js'), /AgPxStamp\.overnightHtml\(fq,/, 'the swapped deferred card shows its own contract');
  for (const p of ['corn', 'soybean', 'wheat']) assert.match(read(`${p}-futures-prices.html`), /price-local\.js\?v=7[\s\S]*futures\.js\?v=25/, p);
  // the line's box is reserved from the first paint in the overnight hours (no layout shift, test/futures-seed-note-cls)
  for (const p of ['corn', 'soybean', 'wheat']) assert.match(read(`${p}-futures-prices.html`), /id="hero-chg">[\s\S]{0,120}<\/div><div class="ph-ovn" id="hero-ovn" hidden><\/div><script>[^<]*m>=1140&&d!=='Fri'&&d!=='Sat'\)\|\|\(m<465&&d!=='Sat'&&d!=='Sun'\)/, p);
  for (const p of ['index.html', 'markets.html']) assert.match(read(p), /price-local\.js\?v=7/, p);
  assert.match(read('index.html'), /geo\.js\?v=32/);
  assert.match(read('index.html'), /home-yield\.js\?v=9/);
});

test('the bake calls an overnight price an overnight trade and titles the settle', () => {
  const py = `
import sys, json
sys.path.insert(0, ${JSON.stringify(path.join(root, 'scripts'))})
import seed_static as s
out = {}
for n in ("0046Z", "0446Z"):
    d = json.load(open(${JSON.stringify(path.join(root, 'test/fixtures/futures-overnight'))} + "/prices-2026-10-20T" + n + ".json"))
    q = d["quotes"]["corn"]
    out[n] = [s.quote_when(q, d["fetched"]), s.overnight_trade(q), s.settled_close(q, d["fetched"]),
              s.overnight_trade(d["quotes"]["cattle"])]
print(json.dumps(out))
`;
  const r = JSON.parse(execFileSync('python3', ['-c', py], { encoding: 'utf8' }));
  assert.equal(r['0046Z'][0], 'Last trade Oct 19, 1:20 p.m. CT');
  assert.equal(r['0046Z'][1], false);
  assert.equal(r['0046Z'][2].date, '2026-10-16', 'before the settle lands the bake still has Oct 16');
  assert.equal(r['0446Z'][0], 'Overnight trade Oct 19, 11:45 p.m. CT');
  assert.equal(r['0446Z'][1], true);
  assert.deepEqual([r['0446Z'][2].px, r['0446Z'][2].date], [467, '2026-10-19'], 'the 04:50 UTC run titles the Oct 19 settle');
  assert.equal(r['0446Z'][3], false, 'cattle has no overnight trade');
});

test('the overnight words carry no em dash', () => {
  const src = read('components/price-local.js');
  const i = src.indexOf('THE OVERNIGHT (ELECTRONIC) TRADE');
  assert.ok(i > 0 && !src.slice(i, i + 4000).includes('—'));
});
