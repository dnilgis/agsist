// Runs the v5.42 routes of workers/subs-worker.js (GET/POST /daily-elev,
// POST /daily-elev/me and /daily-elev/set) against an in-memory KV. No network.
//   node scripts/test_daily_elev_worker.mjs
// Made-up readers only. The link in the Daily's footer proves the address the
// way the unsubscribe link does; the page then holds a random key and never
// the address.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const here = path.dirname(new URL(import.meta.url).pathname);
const src = path.resolve(here, '..', 'workers', 'subs-worker.js');
const tmp = path.join(os.tmpdir(), 'subs-worker-de-test-' + process.pid + '.mjs');
fs.copyFileSync(src, tmp);
const w = (await import(pathToFileURL(tmp).href)).default;
fs.unlinkSync(tmp);

const store = new Map(), meta = new Map(), opts = new Map();
const env = { UNSUB_SECRET: 'sec', LIST_TOKEN: 'tok', SUBS: {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v, o) { store.set(k, v); opts.set(k, o || null); meta.set(k, (o && o.metadata) || null); },
  async delete(k) { store.delete(k); meta.delete(k); },
  async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name, metadata: meta.get(name) })), list_complete: true }; } } };
let n = 0; const A = (c, m) => { if (!c) { console.log('FAIL', m); process.exit(1); } n++; };
const t16 = (s) => crypto.createHmac('sha256', 'sec').update(s.toLowerCase()).digest('hex').slice(0, 16);
let ip = 0;
const call = (p, m = 'GET', body, h = {}) => w.fetch(new Request('https://x.dev' + p, { method: m,
  headers: Object.assign({ 'Content-Type': 'application/json', Origin: 'https://agsist.com', 'CF-Connecting-IP': '10.9.0.' + (++ip) }, h),
  body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) }), env);
const page = (p, m) => w.fetch(new Request('https://x.dev' + p, { method: m, headers: { 'CF-Connecting-IP': '10.8.0.' + (++ip) } }), env);

const E = 'made-up-reader@example.com';
const sub = { ts: 1760000000000, src: 'hero', zip: '54728', reports: true };
store.set('sub:' + E, JSON.stringify(sub)); meta.set('sub:' + E, sub);
const link = '/daily-elev?e=' + encodeURIComponent(E) + '&t=' + t16(E + '|de');

// ---------- the link page ----------
let r = await page(link, 'GET'), h = await r.text();
A(r.status === 200 && /Put your saved elevators in your morning email\?/.test(h) && /Yes, link this browser/.test(h), 'GET shows one button');
A(![...store.keys()].some(k => k.startsWith('dk:')), 'GET changes nothing');
r = await page('/daily-elev?e=' + encodeURIComponent(E) + '&t=' + t16(E + '|ec'), 'GET');
A(/That link isn't valid/.test(await r.text()), 'a token made for another route is refused');
r = await page('/daily-elev?e=' + encodeURIComponent('other@example.com') + '&t=' + t16(E + '|de'), 'GET');
A(/That link isn't valid/.test(await r.text()), "another address with this reader's token is refused");
r = await page('/daily-elev?e=' + encodeURIComponent(E), 'GET');
A(/That link isn't valid/.test(await r.text()), 'no token, no page');
const NOT = 'not-on-list@example.com';
r = await page('/daily-elev?e=' + encodeURIComponent(NOT) + '&t=' + t16(NOT + '|de'), 'POST');
A(/not on AGSIST Daily/.test(await r.text()) && ![...store.keys()].some(k => k.startsWith('dk:')), 'an address not on the Daily gets no key');

r = await page(link, 'POST'); h = await r.text();
const m = /https:\/\/agsist\.com\/cash-bids#dk=([0-9a-z]{24})/.exec(h);
A(r.status === 200 && m, 'POST links to /cash-bids#dk=<key>');
const K = m[1];
A(/^[0-9abcdefghjkmnpqrstvwxyz]{24}$/.test(K), 'key letters');
A(!h.includes('dk=' + encodeURIComponent(E)) && !/#dk=[^"]*@/.test(h), 'the address is not in the link');
const dk = JSON.parse(store.get('dk:' + K));
A(dk.e === E && dk.ts === sub.ts, 'key record: the address and the record ts, kept in the worker');
A(opts.get('dk:' + K).expirationTtl === 400 * 86400, 'kept 400 days');
A(r.headers.get('Content-Security-Policy') && r.headers.get('Cache-Control'), 'link pages: CSP and no caching');

// ---------- me / set ----------
r = await call('/daily-elev/me', 'POST', { k: K }); let j = await r.json();
A(r.status === 200 && j.ok && Array.isArray(j.ids) && j.ids.length === 0 && j.max === 6, 'me: none yet');
A(!JSON.stringify(j).includes('@'), 'me never answers the address');
A(r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com', 'CORS for agsist.com');
r = await call('/daily-elev/set', 'POST', { k: K, ids: ['0068bbc9', 'ABCDEF01'] }); j = await r.json();
A(r.status === 200 && j.ok && j.n === 2 && !JSON.stringify(j).includes('@'), 'set two ids');
let rec = JSON.parse(store.get('sub:' + E));
A(JSON.stringify(rec.el) === JSON.stringify(['0068bbc9', 'abcdef01']), 'el stored lowercase, in order');
A(rec.ts === sub.ts && rec.zip === '54728' && rec.src === 'hero' && rec.reports === true, 'the rest of the Daily record kept');
A(JSON.stringify(meta.get('sub:' + E)) === JSON.stringify(rec), 'metadata is the record (/list reads it)');
for (const [b, why] of [[{ k: K, ids: ['xyz'] }, 'not hex'], [{ k: K, ids: ['0068bbc9', '0068bbc9'] }, 'a repeat'],
    [{ k: K, ids: ['1', '2', '3', '4', '5', '6', '7'].map(x => x.repeat(8)) }, 'seven'], [{ k: K, ids: 'abc' }, 'not a list'],
    [{ k: K }, 'no ids']]) {
  r = await call('/daily-elev/set', 'POST', b); A(r.status === 400, 'refuses ' + why);
}
A(JSON.parse(store.get('sub:' + E)).el.length === 2, 'a refused set changes nothing');
r = await call('/daily-elev/set', 'POST', { k: 'a'.repeat(24), ids: [] }); A(r.status === 404, 'an unknown key is not linked');
r = await call('/daily-elev/set', 'POST', { k: 'short', ids: [] }); A(r.status === 400, 'a malformed key');
r = await call('/daily-elev/me', 'POST', { k: K }, { Origin: 'https://evil.example' }); A(r.status === 403, 'foreign origin refused');
r = await call('/daily-elev/me', 'POST', { k: K }, { 'Content-Type': 'text/plain' }); A(r.status === 415, 'not JSON refused');
r = await call('/daily-elev/me', 'POST', 'x'.repeat(3000)); A(r.status === 413, 'over 2 KB');

// ---------- /list and /count ----------
const OTHER = 'plain-reader@example.com', os_ = { ts: 1760000000001, src: 'daily', reports: true };
store.set('sub:' + OTHER, JSON.stringify(os_)); meta.set('sub:' + OTHER, os_);
r = await call('/list?token=tok&format=json'); j = await r.json();
const mine = j.find(x => x.email === E), other = j.find(x => x.email === OTHER);
A(JSON.stringify(mine.el) === JSON.stringify(['0068bbc9', 'abcdef01']), '/list carries el');
const lidOf = (e) => [...crypto.createHmac('sha256', 'sec').update('lid|' + e.toLowerCase()).digest().subarray(0, 16)].map(b => '0123456789abcdefghjkmnpqrstvwxyz'[b & 31]).join('');
A(!('el' in other) && JSON.stringify(other) === JSON.stringify({ email: OTHER, zip: null, src: 'daily', ts: 1760000000001, reports: true, lid: lidOf(OTHER) }), 'a record without el is as before (plus the v5.46 lid)');
r = await call('/count?token=tok'); j = await r.json();
A(j.daily === 2 && j.daily_with_elevators === 1, '/count daily_with_elevators');

// ---------- a second sign-up keeps them; forget; unsubscribe ends the key ----------
r = await call('/subscribe', 'POST', { email: E, source: 'rain', zip: '54728' }); A(r.status === 200, 'signs up again');
A(JSON.parse(store.get('sub:' + E)).el.length === 2, 'a second sign-up keeps the saved elevators');
r = await call('/daily-elev/set', 'POST', { k: K, ids: [], forget: true }); j = await r.json();
A(j.ok && j.n === 0 && !('el' in JSON.parse(store.get('sub:' + E))) && !store.has('dk:' + K), 'Stop clears the list and the key');
r = await page(link, 'POST'); const K2 = /#dk=([0-9a-z]{24})/.exec(await r.text())[1];
A(K2 !== K, 'a new key each time');
await w.fetch(new Request('https://x.dev/unsubscribe?e=' + encodeURIComponent(E) + '&t=' + t16(E), { method: 'POST' }), env);
r = await call('/daily-elev/set', 'POST', { k: K2, ids: ['0068bbc9'] }); A(r.status === 404 && !store.has('sub:' + E), 'after an unsubscribe the key writes nothing');
A(!store.has('dk:' + K2), 'and is removed');
store.set('sub:' + E, JSON.stringify(Object.assign({}, sub, { ts: sub.ts + 5 })));
r = await page(link, 'POST'); const K3 = /#dk=([0-9a-z]{24})/.exec(await r.text())[1];
store.set('sub:' + E, JSON.stringify(Object.assign({}, sub, { ts: sub.ts + 9 })));
r = await call('/daily-elev/me', 'POST', { k: K3 }); A(r.status === 404, 'a key from before a re-subscribe has ended');

// ---------- no secret ----------
const env2 = Object.assign({}, env, { UNSUB_SECRET: '' });
r = await w.fetch(new Request('https://x.dev' + link, { method: 'GET' }), env2);
A(r.status === 503, 'no secret: the link page refuses (503), never unchecked');

console.log('daily-elev worker checks: ' + n + ' passed');
