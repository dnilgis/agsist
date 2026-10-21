// Runs the v5.45 route of workers/subs-worker.js (GET /count-area) against an
// in-memory KV that pages list() by limit and cursor and keeps metadata, as
// Cloudflare KV does. No network. Every address, ZIP and place here is made up.
//   node scripts/test_count_area_worker.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url';
const here = path.dirname(new URL(import.meta.url).pathname);
const src = path.resolve(here, '..', 'workers', 'subs-worker.js');
const tmp = path.join(os.tmpdir(), 'subs-worker-area-test-' + process.pid + '.mjs');
fs.copyFileSync(src, tmp);
const w = (await import(pathToFileURL(tmp).href)).default;
fs.unlinkSync(tmp);

const store = new Map(), meta = new Map();
const ops = { n: 0, writes: 0, perCall: 0 };
const KV = {
  async get(k) { ops.n++; ops.perCall++; return store.has(k) ? store.get(k) : null; },
  async put(k, v, o) { ops.writes++; store.set(k, v); if (o && o.metadata !== undefined) meta.set(k, o.metadata); },
  async delete(k) { ops.writes++; store.delete(k); meta.delete(k); },
  async list({ prefix = '', limit = 1000, cursor } = {}) {
    ops.n++; ops.perCall++;
    if (limit > 1000) throw new Error('KV list limit is 1000');
    const all = [...store.keys()].filter(k => k.startsWith(prefix)).sort();
    const at = cursor ? Number(cursor) : 0, end = Math.min(all.length, at + limit);
    return { keys: all.slice(at, end).map(name => Object.assign({ name }, meta.has(name) ? { metadata: meta.get(name) } : {})),
             list_complete: end >= all.length, cursor: end >= all.length ? undefined : String(end) };
  },
};
const env = { UNSUB_SECRET: 'sec', LIST_TOKEN: 'tok-made-up', SUBS: KV };
const get = (p, auth = 'Bearer tok-made-up', m = 'GET') => w.fetch(new Request('https://x.dev' + p,
  { method: m, headers: auth ? { Authorization: auth } : {} }), env);
let n = 0; const A = (c, m) => { if (!c) { console.log('FAIL', m); process.exit(1); } n++; };

// made-up data shaped like the real store
const zips = ['54728', '54728', '54728', '54729', '50010', '50011', '', '9999'];
for (let i = 0; i < 905; i++) {
  const r = { ts: 1760000000000 + i, src: i % 2 ? 'cash-bids' : 'footer', reports: true, zip: zips[i % zips.length] || undefined };
  store.set('sub:reader' + i + '@example.test', JSON.stringify(r));
  if (i % 3) meta.set('sub:reader' + i + '@example.test', r);       // a third without metadata: read from the value
}
store.set('alert:a1@example.test', JSON.stringify({ lat: 45.3, lon: -91.6, place: 'Chetek, WI', radius_mi: 5, ts: 1 }));
store.set('alert:a2@example.test', JSON.stringify({ lat: 42.0, lon: -93.6, place: '123 Main St, Ames, IA 50010', radius_mi: 10, ts: 1 }));
store.set('alert:a3@example.test', JSON.stringify({ lat: 42.0, lon: -93.6, place: 'my farm', radius_mi: 10, ts: 1 }));
store.set('watch:w1@example.test', JSON.stringify({ pend: {}, w: { '55005': null, '55033': { k: '' }, '19169': null } }));
store.set('watch:w2@example.test', JSON.stringify({ pend: { '55005': { ts: 1 } }, w: {} }));
store.set('ewatch:e1@example.test', JSON.stringify({ pend: {}, w: { 'abcdef0123': { label: 'Co-op, Town' } } }));
store.set('pwatch:p1@example.test', JSON.stringify({ pend: {}, w: { x: { symbol: 'corn-dec' }, y: { symbol: 'corn-dec' } } }));
store.set('note:n1@example.test', JSON.stringify({ t: { 'rent:wi': { ts: 1 }, 'rainyear:2026:55005': { ts: 1 }, 'rain-gauge': { ts: 1, zip: '54728', note: 'near the creek' } } }));
const code = (place, year) => Buffer.from(['2', place, 'USC00471667', String(year), 'abcda', 'Our farm'].join('|')).toString('base64url');
store.set('rps:aaaaaaa', code('Chetek, WI', 2025));
store.set('rps:bbbbbbb', code('Regina, SK', 1998));
store.set('rps:ccccccc', 'not a design code');
store.set('rpo:1760000000000:0a0b0c0d', JSON.stringify({ ts: 1760000000000, product: 'print12x18', price: 69, place: 'Chetek, WI', paid: { amount: 69 } }));
store.set('rpo:1760000000001:0a0b0c0e', JSON.stringify({ ts: 1760000000001, product: 'digital', price: 19, place: 'Ames, IA' }));
store.set('rpo-serial', JSON.stringify({ last: 3 }));

// gate
for (const [p, a, why] of [['/count-area?part=daily', null, 'no token'], ['/count-area?part=daily', 'Bearer nope', 'wrong token'],
  ['/count-area?part=daily&token=tok-made-up', null, '?token= alone'], ['/count-area?part=daily&token=tok-made-up', 'Bearer tok-made-up', '?token= even with the Bearer']]) {
  const r = await get(p, a); const body = await r.text();
  A(r.status === 403 && !body.includes('@') && r.headers.get('Cache-Control') === 'no-store', why + ': 403, nothing leaks');
}
A((await get('/count-area?part=daily', 'Bearer tok-made-up', 'POST')).status === 405, 'GET only');
A((await get('/count-area?part=sub')).status === 400, 'an unknown part: 400');
A((await get('/count-area?part=__proto__')).status === 400, 'no prototype keys');

async function all(part, limit) {
  const tot = {}; let cursor = '', calls = 0, recs = 0;
  do {
    ops.perCall = 0;
    const r = await get(`/count-area?part=${part}${limit ? '&limit=' + limit : ''}${cursor ? '&cursor=' + cursor : ''}`);
    const body = await r.text();
    A(r.status === 200 && r.headers.get('Cache-Control') === 'no-store', part + ': 200 no-store');
    A(!body.includes('@') && !/\b5472[89]\b|\b5001[01]\b/.test(body), part + ': no address and no full ZIP in the answer');
    A(!/Main St|Chetek|Ames|creek|Our farm/.test(body), part + ': no place name, note or design text');
    A(ops.perCall <= 1000, part + ': under 1,000 KV operations a call (' + ops.perCall + ')');
    const d = JSON.parse(body);
    for (const [dim, m] of Object.entries(d.counts)) for (const [k, v] of Object.entries(m)) { tot[dim] = tot[dim] || {}; tot[dim][k] = (tot[dim][k] || 0) + v; }
    recs += d.n; cursor = d.cursor; calls++;
  } while (cursor);
  return { tot, calls, recs };
}
const before = ops.writes;
const daily = await all('daily');
A(daily.calls === 3 && daily.recs === 905, 'daily: 905 records over 3 pages of 400');
const expZip = {}; for (let i = 0; i < 905; i++) { const z = zips[i % zips.length]; const k = /^\d{5}$/.test(z) ? z.slice(0, 3) : 'none'; expZip[k] = (expZip[k] || 0) + 1; }
A(JSON.stringify(daily.tot.zip3) === JSON.stringify(Object.fromEntries(Object.entries(expZip))), 'daily: ZIP3 counts, bad or missing ZIP as none ' + JSON.stringify(daily.tot.zip3));
A(daily.tot.src['cash-bids'] === 452 && daily.tot.src.footer === 453, 'daily: by sign-up page');
const al = await all('alerts');
A(al.tot.state.WI === 1 && al.tot.state.IA === 1 && al.tot.state['?'] === 1, 'alerts: state from the place, ? without one ' + JSON.stringify(al.tot));
const wa = await all('watch');
A(wa.recs === 1 && wa.tot.st_fips['55'] === 1 && wa.tot.st_fips['19'] === 1, 'watch: confirmed only, each state once per address');
const ew = await all('ewatch'), pw = await all('pwatch');
A(ew.tot.confirmed.yes === 1 && pw.tot.symbol['corn-dec'] === 1, 'elevator and price watches: totals, price by symbol once per address');
const no = await all('notices');
A(no.tot.rent_state.WI === 1 && no.tot.rainyear_st_fips['55'] === 1 && no.tot.gauge_zip3['547'] === 1 && no.tot.kind['rain-gauge'] === 1, 'notices: by kind, rent state, rain-year state, gauge ZIP3');
const ro = await all('rp_orders');
A(ro.recs === 2 && ro.tot.state.WI === 1 && ro.tot.paid_state.WI === 1 && !ro.tot.paid_state.IA && ro.tot.product.digital === 1, 'Rain Print orders: by state, paid, product; the serial counter is not an order');
const rd = await all('rp_designs');
A(rd.recs === 2 && rd.tot.state.WI === 1 && rd.tot.state.SK === 1 && rd.tot.year['2025'] === 1 && rd.tot.year['1998'] === 1,
  'Rain Print designs: by state or province and year; a value that is not a design is skipped ' + JSON.stringify(rd.tot));
A(ops.writes === before, 'read-only: nothing written');
const one = await all('daily', 7);
A(one.recs === 905 && one.calls === 130, 'any page size adds up to the same records');
console.log(`count-area checks: ${n} passed`);
