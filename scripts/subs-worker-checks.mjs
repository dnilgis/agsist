#!/usr/bin/env node
/* THE DAILY LIST ROUTES OF workers/subs-worker.js (v5.4), AGAINST AN IN-MEMORY KV.
 *
 *     node scripts/subs-worker-checks.mjs
 *
 * Runs the worker's own fetch handler. No network, no wrangler. Covers:
 *   - subscribe with and without a ZIP, JSON and form
 *   - an invalid ZIP is dropped and the address is still subscribed
 *   - a re-subscribe merges: first ts kept, zip/reports/src updated only when given
 *   - /list plain (unchanged bytes) and /list?format=json
 *   - /count
 *   - the token checks on /list, /list?format=json and /count
 *   - an old v5.3 record ({ts, src}) reads as reports:true with no zip
 */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url';

const src = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'workers', 'subs-worker.js');
const tmp = path.join(os.tmpdir(), 'subs-worker-checks-' + process.pid + '.mjs');
fs.copyFileSync(src, tmp);
const w = (await import(pathToFileURL(tmp).href)).default;
fs.unlinkSync(tmp);

const store = new Map();
const env = { UNSUB_SECRET: 'sec', LIST_TOKEN: 'tok', SUBS: {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v) { store.set(k, v); },
  async delete(k) { store.delete(k); },
  async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }; },
} };
const H = 'https://x.dev';
const call = (p, m = 'GET', b) => w.fetch(new Request(H + p, { method: m,
  headers: { 'Content-Type': 'application/json', Origin: 'https://agsist.com' },
  body: b ? JSON.stringify(b) : undefined }), env);
const form = (p, fields) => { const f = new FormData(); for (const k in fields) f.append(k, fields[k]);
  return w.fetch(new Request(H + p, { method: 'POST', body: f, headers: { Origin: 'https://agsist.com' } }), env); };
const rec = (e) => JSON.parse(store.get('sub:' + e));

let ok = 0; const fails = [];
const A = (c, m) => { if (c) ok++; else fails.push(m); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 1. subscribe without a zip: the v5.3 body, still answered {ok:true}
let r = await call('/subscribe', 'POST', { email: 'Plain@Farm.com', source: 'footer' });
A(r.status === 200, 'subscribe without zip: 200');
A(JSON.stringify(await r.json()) === '{"ok":true}', 'subscribe answers exactly {"ok":true}');
A(rec('plain@farm.com').src === 'footer', 'src kept');
A(!('zip' in rec('plain@farm.com')), 'no zip key when none given');
A(rec('plain@farm.com').reports === true, 'reports defaults to true');

// 2. subscribe with a zip
r = await call('/subscribe', 'POST', { email: 'z@farm.com', zip: '54728', source: 'hero', reports: true });
A(r.status === 200, 'subscribe with zip: 200');
A(rec('z@farm.com').zip === '54728', 'zip stored');
A(rec('z@farm.com').src === 'hero', 'hero source stored');

// 3. an invalid zip is dropped, the address is still subscribed
for (const bad of ['5472', '547289', 'abcde', '54 728', 54728.5, '']) {
  const e = 'bad' + String(bad).replace(/\W/g, '') + '@farm.com';
  r = await call('/subscribe', 'POST', { email: e, zip: bad, source: 'bar' });
  A(r.status === 200, 'invalid zip ' + JSON.stringify(bad) + ' does not reject');
  A(store.has('sub:' + e) && !('zip' in rec(e)), 'invalid zip ' + JSON.stringify(bad) + ' dropped, address kept');
}
// a numeric 5-digit zip from a careless client is still five digits
r = await call('/subscribe', 'POST', { email: 'num@farm.com', zip: 67801 });
A(rec('num@farm.com').zip === '67801', 'numeric 67801 accepted as "67801"');

// 4. re-subscribe merges
const ts0 = rec('z@farm.com').ts;
await sleep(5);
r = await call('/subscribe', 'POST', { email: 'z@farm.com' });
A(rec('z@farm.com').ts === ts0, 'resubscribe keeps the original ts');
A(rec('z@farm.com').zip === '54728', 'resubscribe without zip keeps the zip');
A(rec('z@farm.com').src === 'hero', 'resubscribe without source keeps src');
A(rec('z@farm.com').reports === true, 'resubscribe without reports keeps reports');
r = await call('/subscribe', 'POST', { email: 'z@farm.com', zip: '67801', source: 'bid-row', reports: false });
A(rec('z@farm.com').zip === '67801', 'resubscribe with zip updates zip');
A(rec('z@farm.com').src === 'bid-row', 'resubscribe with source updates src');
A(rec('z@farm.com').reports === false, 'resubscribe with reports:false updates reports');
A(rec('z@farm.com').ts === ts0, 'ts still the first one');
r = await call('/subscribe', 'POST', { email: 'z@farm.com', zip: 'nope' });
A(rec('z@farm.com').zip === '67801', 'a bad zip on resubscribe does not erase the good one');
A(rec('z@farm.com').reports === false, 'reports:false survives a resubscribe that does not say');
// a plain subscriber adds a zip later
r = await call('/subscribe', 'POST', { email: 'plain@farm.com', zip: '54728', source: 'email-forward' });
A(rec('plain@farm.com').zip === '54728' && rec('plain@farm.com').src === 'email-forward', 'zip added to an existing address');

// 5. form posts: zip and the words a checkbox sends
r = await form('/subscribe', { email: 'f@farm.com', zip: '54728', source: 'watch-optin', reports: 'off' });
A(r.status === 200, 'form subscribe 200');
A(rec('f@farm.com').zip === '54728' && rec('f@farm.com').reports === false, 'form zip and reports=off');
r = await form('/subscribe', { email: 'f@farm.com', reports: 'on' });
A(rec('f@farm.com').reports === true && rec('f@farm.com').zip === '54728', 'form reports=on, zip kept');

// 6. still refuses what it always refused
r = await call('/subscribe', 'POST', { email: 'nope', zip: '54728' });
A(r.status === 400, 'bad email still 400');
r = await call('/subscribe', 'POST', { email: 'trap@farm.com', zip: '54728', _gotcha: 'x' });
A(r.status === 200 && !store.has('sub:trap@farm.com'), 'honeypot still swallows');

// 7. an old record written by v5.3
store.set('sub:old@farm.com', JSON.stringify({ ts: 1700000000000, src: 'import' }));

// 8. /list plain: one address per line, sorted as KV lists them, nothing else
r = await call('/list?token=tok');
const plain = await r.text();
A(r.headers.get('Content-Type') === 'text/plain;charset=utf-8', 'plain list content type unchanged');
A(r.headers.get('Access-Control-Allow-Origin') === '*', 'plain list CORS unchanged');
A(plain === [...store.keys()].filter(k => k.startsWith('sub:')).sort().map(k => k.slice(4)).join('\n'), 'plain list bytes = addresses joined by \\n');
A(!plain.includes('{') && plain.split('\n').every(l => /^[^\s@]+@[^\s@]+$/.test(l)), 'plain list carries only addresses');

// 9. /list?format=json
r = await call('/list?token=tok&format=json');
A(r.status === 200 && (r.headers.get('Content-Type') || '').includes('application/json'), 'json list 200 application/json');
const L = await r.json();
A(Array.isArray(L) && L.length === plain.split('\n').length, 'json list has every address');
const by = Object.fromEntries(L.map(x => [x.email, x]));
A(JSON.stringify(Object.keys(by['plain@farm.com']).sort()) === JSON.stringify(['email', 'reports', 'src', 'ts', 'zip']), 'json record keys are exactly email,zip,src,ts,reports');
A(by['z@farm.com'].zip === '67801' && by['z@farm.com'].reports === false && by['z@farm.com'].ts === ts0, 'json record values');
A(by['old@farm.com'].zip === null && by['old@farm.com'].reports === true && by['old@farm.com'].src === 'import', 'v5.3 record reads as reports:true, zip null');
A(by['bad5472@farm.com'].zip === null, 'no zip -> null');
r = await call('/list?token=tok&format=xml');
A((await r.text()) === plain, 'an unknown format gets the plain list');

// 10. /count
store.set('alert:a@farm.com', '{}'); store.set('ewatch:a@farm.com', '{}'); store.set('ewatch:b@farm.com', '{}');
store.set('pwatch:a@farm.com', '{}'); store.set('watch:a@farm.com', '{}');
r = await call('/count?token=tok');
const C = await r.json();
const nsub = plain.split('\n').length;
A(r.status === 200 && C.ok === true, '/count 200 ok');
A(C.daily === nsub, '/count daily = list length');
A(C.daily_with_zip === L.filter(x => x.zip).length, '/count daily_with_zip');
A(C.alerts === 1 && C.ewatch === 2 && C.pwatch === 1 && C.watch === 1, '/count watch families counted apart (watch: does not swallow ewatch:/pwatch:)');
A(C.by_source.footer === undefined && C.by_source['email-forward'] === 1 && C.by_source.import === 1 && C.by_source['(none)'] >= 1, '/count by_source');
A(Object.values(C.by_source).reduce((a, b) => a + b, 0) === nsub, '/count by_source sums to daily');
A(!JSON.stringify(C).includes('@'), '/count carries no address');

// 11. auth
for (const p of ['/list', '/list?format=json', '/count', '/list?token=bad', '/list?token=bad&format=json', '/count?token=bad', '/count?token=']) {
  r = await call(p);
  A(r.status === 403, p + ' without the token is 403');
}
const envNoTok = Object.assign({}, env, { LIST_TOKEN: '' });
r = await w.fetch(new Request(H + '/count?token='), envNoTok);
A(r.status === 403, 'an unset LIST_TOKEN never authorises an empty token');

// 12. untouched neighbours
r = await call('/flag?k=briefed:2026-10-06&token=tok');
A((await r.json()).set === false, '/flag GET unchanged');
r = await call('/nowhere');
A(r.status === 404, 'unknown route 404');

if (fails.length) { for (const f of fails) console.log('FAIL', f); console.log(ok + ' passed, ' + fails.length + ' failed'); process.exit(1); }
console.log('subs-worker-checks: ' + ok + ' passed');
