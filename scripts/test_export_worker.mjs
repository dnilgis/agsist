// Runs the v5.39 backup route of workers/subs-worker.js (GET /export) against
// an in-memory KV that pages list() by limit and cursor and keeps metadata and
// expiration, as Cloudflare KV does. No network.
//   node scripts/test_export_worker.mjs
// Every address and value here is made up.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url';
const here = path.dirname(new URL(import.meta.url).pathname);
const src = path.resolve(here, '..', 'workers', 'subs-worker.js');
const tmp = path.join(os.tmpdir(), 'subs-worker-export-test-' + process.pid + '.mjs');
fs.copyFileSync(src, tmp);
const w = (await import(pathToFileURL(tmp).href)).default;
fs.unlinkSync(tmp);

const enc = new TextEncoder();
const store = new Map(), meta = new Map(), exp = new Map();
const ops = { n: 0, writes: 0 };
const cmp = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const bytesOf = (v) => typeof v === 'string' ? enc.encode(v) : new Uint8Array(v);
const KV = {
  async get(k, o) { ops.n++; if (!store.has(k)) return null; const b = store.get(k); const t = typeof o === 'string' ? o : o && o.type;
    return t === 'arrayBuffer' ? b.slice().buffer : new TextDecoder().decode(b); },
  async getWithMetadata(k, o) { ops.n++; if (!store.has(k)) return { value: null, metadata: null };
    const t = typeof o === 'string' ? o : o && o.type; const b = store.get(k);
    return { value: t === 'arrayBuffer' ? b.slice().buffer : new TextDecoder().decode(b), metadata: meta.has(k) ? meta.get(k) : null }; },
  async put(k, v, o) { ops.n++; ops.writes++; store.set(k, bytesOf(v)); if (o && o.metadata !== undefined) meta.set(k, JSON.parse(JSON.stringify(o.metadata))); else meta.delete(k);
    if (o && o.expiration) exp.set(k, o.expiration); else exp.delete(k); },
  async delete(k) { ops.n++; ops.writes++; store.delete(k); meta.delete(k); exp.delete(k); },
  async list({ prefix = '', limit = 1000, cursor } = {}) {
    ops.n++;
    if (limit > 1000) throw new Error('KV list limit is 1000');
    const all = [...store.keys()].filter(k => k.startsWith(prefix)).sort(cmp);
    // an opaque cursor that resumes after the last key handed out
    const after = cursor ? Buffer.from(cursor, 'base64').toString() : null;
    const at = after === null ? 0 : all.findIndex(k => cmp(k, after) > 0) < 0 ? all.length : all.findIndex(k => cmp(k, after) > 0);
    const end = Math.min(all.length, at + limit), page = all.slice(at, end);
    return { keys: page.map(name => Object.assign({ name }, meta.has(name) ? { metadata: meta.get(name) } : {}, exp.has(name) ? { expiration: exp.get(name) } : {})),
             list_complete: end >= all.length, cursor: end >= all.length ? undefined : Buffer.from(page[page.length - 1]).toString('base64') };
  },
};
const env = { UNSUB_SECRET: 'sec', LIST_TOKEN: 'tok-made-up', SUBS: KV };
const get = (p, auth = 'Bearer tok-made-up', m = 'GET') => w.fetch(new Request('https://x.dev' + p,
  { method: m, headers: auth ? { Authorization: auth } : {} }), env);
let n = 0; const A = (c, m) => { if (!c) { console.log('FAIL', m); process.exit(1); } n++; };

// made-up data shaped like the real store
const expect = new Map();
const set = (k, v, o) => { store.set(k, bytesOf(v)); if (o && o.metadata !== undefined) meta.set(k, o.metadata); if (o && o.expiration) exp.set(k, o.expiration); expect.set(k, { v: bytesOf(v), o: o || {} }); };
for (let i = 0; i < 2345; i++) { const e = 'reader' + i + '@example.test', r = { ts: 1760000000000 + i, src: 'footer', reports: true };
  set('sub:' + e, JSON.stringify(r), { metadata: r }); }
set('note:café@example.test', JSON.stringify({ t: { 'rain:WI': { ts: 1 } }, name: 'Søren "Ö" ✓ 🌽' }));
set('bom:x', '﻿starts with a byte order mark');
set('empty:x', '');
set('line:x', 'two\r\nlines\ttab\u0000nul');
const png = new Uint8Array(300); png.set([137, 80, 78, 71, 13, 10, 26, 10]); for (let i = 8; i < png.length; i++) png[i] = (i * 37) & 255;
set('rpl:abc123', png, { metadata: { w: 10, h: 10, ts: 5 }, expiration: 1900000000 });
set('rpo:1760000000000:0a0b0c0d', JSON.stringify({ ts: 1760000000000, product: 'digital', price: 19 }), { expiration: 1800000000 });
set('rpo-serial', JSON.stringify({ last: 3 }));
const TOTAL = expect.size;

// wrong, missing and query-string tokens
for (const [p, a, why] of [['/export', null, 'no token'], ['/export', 'Bearer nope', 'wrong token'], ['/export', 'Bearer ', 'empty bearer'],
  ['/export', 'tok-made-up', 'token without Bearer'], ['/export?token=tok-made-up', null, '?token= alone'],
  ['/export?token=tok-made-up', 'Bearer tok-made-up', '?token= even with the right Bearer'], ['/export?token=', 'Bearer tok-made-up', 'an empty ?token= too']]) {
  const before = ops.n;
  const r = await get(p, a); const body = await r.text();
  A(r.status === 403, why + ': 403');
  A(!body.includes('reader') && !body.includes('@'), why + ': nothing leaks');
  A(r.headers.get('Cache-Control') === 'no-store', why + ': no-store');
  A(ops.n - before <= 2, why + ': no store reads past the gate');
}
const noTok = Object.assign({}, env); delete noTok.LIST_TOKEN;
A((await w.fetch(new Request('https://x.dev/export', { headers: { Authorization: 'Bearer ' } }), noTok)).status === 403, 'no LIST_TOKEN set: 403');
A((await get('/export', 'Bearer tok-made-up', 'POST')).status === 405, 'GET only');
A((await get('/export?cursor=%%%')).status === 400, 'a bad cursor: 400');

// page through everything, default page size
async function pageAll(q = '') {
  const rows = []; let cursor = '', pages = 0, maxOps = 0;
  do {
    const before = ops.n;
    const r = await get('/export?' + q + (cursor ? (q ? '&' : '') + 'cursor=' + encodeURIComponent(cursor) : ''));
    maxOps = Math.max(maxOps, ops.n - before);
    A(r.status === 200, 'page ' + pages + ': 200');
    A(r.headers.get('Cache-Control') === 'no-store', 'page ' + pages + ': no-store');
    const j = await r.json();
    A(j.ok === true && j.count === j.keys.length && Array.isArray(j.keys), 'page ' + pages + ': shape');
    A(j.done === (j.cursor === null), 'page ' + pages + ': done when there is no cursor');
    rows.push(...j.keys); cursor = j.cursor; pages++;
    A(pages < 2000, 'pages end');
  } while (cursor);
  return { rows, pages, maxOps };
}
const writesBefore = ops.writes;
let P = await pageAll();
A(ops.writes === writesBefore, 'read-only: nothing written');
A(P.rows.length === TOTAL, 'every key, once: ' + P.rows.length + ' of ' + TOTAL);
A(new Set(P.rows.map(r => r.name)).size === TOTAL, 'no key twice');
A(P.pages === Math.ceil(TOTAL / 500), 'default 500 a page: ' + P.pages + ' pages');
A(P.maxOps <= 1000, 'under 1,000 KV operations a call: ' + P.maxOps);
function roundTrip(rows, label) {
  for (const r of rows) {
    const e = expect.get(r.name);
    A(e, label + ': a real key ' + r.name);
    const got = 'value_b64' in r ? new Uint8Array(Buffer.from(r.value_b64, 'base64')) : enc.encode(r.value);
    A(Buffer.compare(Buffer.from(got), Buffer.from(e.v)) === 0, label + ': value bytes round-trip exactly for ' + r.name);
    A(JSON.stringify(r.metadata) === JSON.stringify(e.o.metadata), label + ': metadata for ' + r.name);
    A(r.expiration === e.o.expiration, label + ': expiration for ' + r.name);
  }
}
roundTrip(P.rows, 'default pages');
const by = Object.fromEntries(P.rows.map(r => [r.name, r]));
A(typeof by['rpl:abc123'].value_b64 === 'string' && !('value' in by['rpl:abc123']), 'a PNG comes as value_b64');
A(by['bom:x'].value === '﻿starts with a byte order mark', 'a leading byte order mark is kept');
A(by['empty:x'].value === '' && !('value_b64' in by['empty:x']), 'an empty value stays an empty string');
A(JSON.parse(by['note:café@example.test'].value).name === 'Søren "Ö" ✓ 🌽', 'UTF-8 text stays text');
A(!('metadata' in by['rpo-serial']) && !('expiration' in by['rpo-serial']), 'no metadata or expiration keys when there are none');
A(JSON.parse(by['sub:reader7@example.test'].value).ts === 1760000000007, 'JSON values parse back');

// small pages, and the 900 cap
P = await pageAll('limit=7');
A(P.rows.length === TOTAL && new Set(P.rows.map(r => r.name)).size === TOTAL, 'limit=7 pages through everything');
A(P.pages === Math.ceil(TOTAL / 7), 'limit=7: ' + P.pages + ' pages');
roundTrip(P.rows, 'limit=7');
let r = await get('/export?limit=5000'); let j = await r.json();
A(j.count === 900, 'limit capped at 900');
r = await get('/export?limit=0'); j = await r.json(); A(j.count === 1, 'limit at least 1');
r = await get('/export?limit=abc'); j = await r.json(); A(j.count === 500, 'a bad limit is the default');

// big values: a page stops past 8 MB and the cursor resumes inside the KV page, nothing lost or twice
const big = new Uint8Array(3 * 1024 * 1024).fill(65);
for (let i = 0; i < 5; i++) set('big:' + i, big);
const T2 = expect.size;
P = await pageAll();
A(P.rows.length === T2 && new Set(P.rows.map(r => r.name)).size === T2, 'with 15 MB of values: every key once (' + P.rows.length + ')');
A(P.pages > Math.ceil(T2 / 500), 'the big page was split: ' + P.pages + ' pages');
roundTrip(P.rows, 'big values');

// a key gone between list and get is skipped, not an error
const realGet = KV.getWithMetadata;
KV.getWithMetadata = async (k, o) => k === 'rpo-serial' ? { value: null, metadata: null } : realGet(k, o);
P = await pageAll();
A(P.rows.length === T2 - 1 && !P.rows.some(r => r.name === 'rpo-serial'), 'a key that expired mid-backup is left out');
KV.getWithMetadata = realGet;

// a key deleted between pages does not stall or skip the next one
r = await get('/export?limit=3'); j = await r.json();
const lastName = j.keys[2].name; store.delete(lastName); expect.delete(lastName);
const rest = []; let cur = j.cursor;
while (cur) { const x = await (await get('/export?limit=3&cursor=' + encodeURIComponent(cur))).json(); rest.push(...x.keys); cur = x.cursor; }
A(j.keys.length + rest.length === expect.size + 1 && new Set(rest.map(x => x.name)).size === rest.length, 'a delete between pages: nothing skipped, nothing twice');

// the same inside a split page: the last key sent is deleted before the next call
for (const k of [...store.keys()]) if (!k.startsWith('big:')) { store.delete(k); expect.delete(k); }
const nBig = store.size;
r = await get('/export'); j = await r.json();
A(j.cursor && j.count < nBig, 'only big values: the page splits (' + j.count + ')');
store.delete(j.keys[j.keys.length - 1].name);
const more = []; cur = j.cursor;
while (cur) { const x = await (await get('/export?cursor=' + encodeURIComponent(cur))).json(); more.push(...x.keys); cur = x.cursor; }
A(nBig >= 4 && j.count + more.length === nBig && new Set(j.keys.concat(more).map(x => x.name)).size === nBig, 'a delete inside a split page: nothing skipped, nothing twice');

console.log('export checks: ' + n + ' passed');
