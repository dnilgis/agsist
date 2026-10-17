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
 *   - v5.11 notices: /notice, daily:true with a ZIP, /notice-list, /notice-mark,
 *     /notice-unsubscribe, and the daily unsubscribe removing notices
 *   - v5.13 hardening: the origin and content-type gate on every public POST,
 *     the shared rate limit (per address an hour and a day, IPv6 by /64, a
 *     daily total per route, the in-isolate burst hold), /list from key
 *     metadata with the get() fallback and cursor pages, control characters
 *     stripped, token checks, the HTML page headers, the sponsor tier lookup,
 *     the sponsor-apply index and the logo's magic bytes
 *
 * The in-memory KV keeps put()'s metadata and honours list()'s limit and
 * cursor, as Cloudflare KV does.
 */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url';

const src = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'workers', 'subs-worker.js');
const tmp = path.join(os.tmpdir(), 'subs-worker-checks-' + process.pid + '.mjs');
fs.copyFileSync(src, tmp);
const w = (await import(pathToFileURL(tmp).href)).default;
fs.unlinkSync(tmp);

// An in-memory KV. put() keeps metadata and options, list() returns metadata
// and pages by limit and cursor, the way Cloudflare KV does.
function makeKV(store, meta = new Map(), opts = new Map(), log = { get: 0, list: [] }) {
  return {
    async get(k) { log.get++; return store.has(k) ? store.get(k) : null; },
    async put(k, v, o) { store.set(k, v); opts.set(k, o || null); if (o && o.metadata !== undefined) meta.set(k, JSON.parse(JSON.stringify(o.metadata))); else meta.delete(k); },
    async delete(k) { store.delete(k); meta.delete(k); },
    async list({ prefix, limit, cursor }) {
      log.list.push(prefix);
      const all = [...store.keys()].filter(k => k.startsWith(prefix)).sort();
      const at = cursor ? Number(cursor) : 0, end = Math.min(all.length, at + (limit || 1000));
      return { keys: all.slice(at, end).map(name => meta.has(name) ? { name, metadata: meta.get(name) } : { name }),
               list_complete: end >= all.length, cursor: end >= all.length ? undefined : String(end) };
    },
  };
}
const store = new Map();
const env = { UNSUB_SECRET: 'sec', LIST_TOKEN: 'tok', SUBS: makeKV(store) };
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

// 13. v5.11 one-time notices: rent release and ARC/PLC reminder
const note = (e) => JSON.parse(store.get('note:' + e));
const plainNow = async () => (await (await call('/list?token=tok')).text()).split('\n');
const iso = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const D1 = iso(60), D2 = iso(150);
r = await call('/notice', 'POST', { email: 'Rent@Farm.com', topic: 'rent:WI', source: 'rent:wi' });
let j = await r.json();
A(r.status === 200 && j.ok === true && j.topic === 'rent:wi' && j.daily === false, 'notice: rent:wi stored, answers {ok, topic, daily:false}');
A(r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com', 'notice: CORS for agsist.com');
A(note('rent@farm.com').t['rent:wi'].src === 'rent:wi' && Number.isFinite(note('rent@farm.com').t['rent:wi'].ts), 'notice: topic keeps its source and time');
A(!store.has('sub:rent@farm.com'), 'notice alone does NOT put the address on the daily list');
A(!(await plainNow()).includes('rent@farm.com'), 'notice alone is not on /list');
const nts = note('rent@farm.com').t['rent:wi'].ts;
await sleep(3);
r = await call('/notice', 'POST', { email: 'rent@farm.com', topic: 'rent:wi', source: 'other' });
A(r.status === 200 && note('rent@farm.com').t['rent:wi'].ts === nts && note('rent@farm.com').t['rent:wi'].src === 'rent:wi', 'notice: asking twice keeps the first sign-up');
r = await call('/notice', 'POST', { email: 'rent@farm.com', topic: 'arcplc:' + D1, source: 'arcplc:wi/dane-county' });
A(r.status === 200 && Object.keys(note('rent@farm.com').t).length === 2, 'notice: a second topic on the same address');
A(!store.has('sub:rent@farm.com'), 'still not on the daily list');
// the morning briefing box: daily:true also subscribes, with the ZIP
r = await call('/notice', 'POST', { email: 'both@farm.com', topic: 'arcplc:' + D1, source: 'arcplc:ia/story-county', daily: true, zip: '50010' });
j = await r.json();
A(j.ok === true && j.daily === true && store.has('note:both@farm.com'), 'notice with daily:true: notice stored');
A(rec('both@farm.com').zip === '50010' && rec('both@farm.com').reports === true && rec('both@farm.com').src === 'arcplc:ia/story-county', 'notice with daily:true: on the daily list with zip, reports, source');
r = await call('/notice', 'POST', { email: 'both2@farm.com', topic: 'rent:ia', daily: 'on', zip: '5001' });
A(store.has('sub:both2@farm.com') && !('zip' in rec('both2@farm.com')), 'daily "on" subscribes; a 4-digit ZIP is dropped, the address kept');
r = await call('/notice', 'POST', { email: 'nod@farm.com', topic: 'rent:ia', daily: 'false', zip: '50010' });
A(!store.has('sub:nod@farm.com'), 'daily "false": not subscribed, zip not stored anywhere daily');
// a daily reader who adds a notice keeps the daily record as it was
const zr = store.get('sub:z@farm.com');
r = await call('/notice', 'POST', { email: 'z@farm.com', topic: 'rent:ks' });
A(store.get('sub:z@farm.com') === zr, 'notice without daily leaves an existing daily record untouched');
// refusals
for (const [b, why] of [[{ email: 'nope', topic: 'rent:wi' }, 'bad email'], [{ email: 'x@farm.com', topic: 'rent:xx' }, 'unknown state'],
    [{ email: 'x@farm.com', topic: 'rent:wisconsin' }, 'long state'], [{ email: 'x@farm.com', topic: 'daily' }, 'unknown topic'],
    [{ email: 'x@farm.com' }, 'no topic'], [{ email: 'x@farm.com', topic: 'arcplc:2026-02-30' }, 'impossible date'],
    [{ email: 'x@farm.com', topic: 'arcplc:' + iso(-5) }, 'past deadline'], [{ email: 'x@farm.com', topic: 'arcplc:' + iso(500) }, 'deadline too far out'],
    [{ email: 'x@farm.com', topic: '__proto__' }, 'proto topic']]) {
  r = await call('/notice', 'POST', b);
  A(r.status === 400 && (await r.json()).ok === false, 'notice refuses ' + why);
}
A(!store.has('note:x@farm.com') && !store.has('sub:x@farm.com'), 'a refused notice stores nothing');
r = await w.fetch(new Request(H + '/notice', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://agsist.com' }, body: '{nope' }), env);
A(r.status === 400, 'notice: bad json is a 400 (no email)');
r = await call('/notice', 'POST', { email: 'trap2@farm.com', topic: 'rent:wi', _gotcha: 'x', daily: true });
A(r.status === 200 && !store.has('note:trap2@farm.com') && !store.has('sub:trap2@farm.com'), 'notice honeypot swallows');
for (let i = 0; i < 25; i++) await call('/notice', 'POST', { email: 'many@farm.com', topic: 'rent:' + ['al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks','ky','la','me','md','ma','mi','mn','ms','mo'][i] });
A(Object.keys(note('many@farm.com').t).length === 20, 'notice: at most 20 topics an address');
// /notice-list and /notice-mark
for (const p of ['/notice-list', '/notice-list?token=bad']) { r = await call(p); A(r.status === 403, p + ' 403'); }
r = await call('/notice-mark', 'POST', { email: 'rent@farm.com', topic: 'rent:wi' });
A(r.status === 403, '/notice-mark without the token is 403');
r = await call('/notice-list?token=tok&topic=rent:wi');
let NL = await r.json();
A(NL.length === 1 && NL.every(x => x.topic === 'rent:wi') && NL.some(x => x.email === 'rent@farm.com' && x.src === 'rent:wi' && x.sent === null), '/notice-list?topic=rent:wi');
r = await call('/notice-list?token=tok&topic=arcplc:');
NL = await r.json();
A(NL.length === 2 && NL.every(x => x.topic === 'arcplc:' + D1), '/notice-list?topic=arcplc: (prefix)');
r = await call('/notice-mark?token=tok', 'POST', { email: 'rent@farm.com', topic: 'rent:wi' });
A((await r.json()).ok === true && Number.isFinite(note('rent@farm.com').t['rent:wi'].sent), '/notice-mark records sent');
r = await call('/notice-list?token=tok&topic=rent:wi&unsent=1');
A((await r.json()).every(x => x.email !== 'rent@farm.com'), '&unsent=1 leaves out a sent notice');
r = await call('/notice-mark?token=tok', 'POST', { email: 'nobody@farm.com', topic: 'rent:wi' });
A((await r.json()).skipped === true, '/notice-mark on a stopped notice skips');
// /count
r = await call('/count?token=tok');
const C2 = await r.json();
A(C2.notice === [...store.keys()].filter(k => k.startsWith('note:')).length && C2.notices['rent:wi'] === 1 && C2.notices['rent:ia'] === 3 && C2.notices['arcplc:' + D1] === 2, '/count notice and notices');
A(C2.daily === (await plainNow()).length, '/count daily still counts only the daily list');
// unsubscribes
const sig = async (e) => { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('sec'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(e)))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16); };
let t = await sig('rent@farm.com');
r = await call('/notice-unsubscribe?e=rent@farm.com&t=' + t + '&topic=rent:wi');
A(r.status === 200 && (await r.text()).includes('Nothing happens') && 'rent:wi' in note('rent@farm.com').t, 'notice unsubscribe GET changes nothing');
r = await call('/notice-unsubscribe?e=rent@farm.com&t=bad', 'POST');
A((await r.text()).includes("isn't valid") && store.has('note:rent@farm.com'), 'notice unsubscribe with a bad token removes nothing');
r = await call('/notice-unsubscribe?e=rent@farm.com&t=' + t + '&topic=rent:wi', 'POST');
A(!('rent:wi' in note('rent@farm.com').t) && ('arcplc:' + D1) in note('rent@farm.com').t, 'notice unsubscribe one topic');
r = await call('/notice-unsubscribe?e=rent@farm.com&t=' + t, 'POST');
A(!store.has('note:rent@farm.com'), 'notice unsubscribe all');
t = await sig('both@farm.com');
r = await call('/unsubscribe?e=both@farm.com&t=' + t, 'POST');
A(!store.has('sub:both@farm.com') && !store.has('note:both@farm.com'), 'the daily unsubscribe also stops the notices');

// v5.28: rainyear:<YYYY>:<county FIPS>, the January full-year rain email
{
  const now = new Date(), cy = now.getUTCFullYear(), jan = now.getUTCMonth() === 0;
  r = await call('/notice', 'POST', { email: 'Rain@Example.com', topic: 'rainyear:' + cy + ':19169', source: 'page:rain/iowa/story-county', daily: true, zip: '50010' });
  j = await r.json();
  A(r.status === 200 && j.ok === true && j.topic === 'rainyear:' + cy + ':19169' && j.daily === true, 'rainyear: this year and a county FIPS is stored');
  A(note('rain@example.com').t['rainyear:' + cy + ':19169'].src === 'page:rain/iowa/story-county', 'rainyear: keeps the page it came from');
  A(rec('rain@example.com').zip === '50010', 'rainyear with daily:true: on the daily list with its ZIP');
  for (const [tp, why] of [['rainyear:' + (cy - 2) + ':19169', 'a year two back'], ['rainyear:' + (cy + 1) + ':19169', 'next year'],
      ['rainyear:' + cy + ':99001', 'no such state'], ['rainyear:' + cy + ':03001', 'state code 03'], ['rainyear:' + cy + ':19000', 'a state, not a county'],
      ['rainyear:' + cy + ':1916', 'four digits'], ['rainyear:' + cy, 'no county'], ['rainyear:' + cy + ':19169:x', 'extra part']]) {
    r = await call('/notice', 'POST', { email: 'rainbad@example.com', topic: tp });
    A(r.status === 400 && (await r.json()).ok === false, 'rainyear refuses ' + why);
  }
  r = await call('/notice', 'POST', { email: 'rainbad@example.com', topic: 'rainyear:' + (cy - 1) + ':19169' });
  A(r.status === (jan ? 200 : 400), 'rainyear: last year only during January');
  A(!store.has('note:rainbad@example.com') || jan, 'a refused rainyear stores nothing');
  r = await call('/notice-list?token=tok&topic=rainyear:');
  const RL = await r.json();
  A(RL.length >= 1 && RL.every(x => x.topic.startsWith('rainyear:')) && RL.some(x => x.email === 'rain@example.com'), '/notice-list?topic=rainyear: (prefix)');
  r = await call('/notice-mark?token=tok', 'POST', { email: 'rain@example.com', topic: 'rainyear:' + cy + ':19169' });
  A((await r.json()).ok === true && Number.isFinite(note('rain@example.com').t['rainyear:' + cy + ':19169'].sent), 'rainyear: /notice-mark records sent');
  store.set('note:old@example.com', JSON.stringify({ ts: 1, t: { 'rainyear:2020:19169': { ts: 1, src: 'x' } } }));
  r = await call('/notice-mark?token=tok', 'POST', { email: 'old@example.com', topic: 'rainyear:2020:19169' });
  A((await r.json()).ok === true && Number.isFinite(note('old@example.com').t['rainyear:2020:19169'].sent), 'rainyear: /notice-mark takes any year');
}

// ───────────────────────── v5.13 hardening ─────────────────────────
// Each block gets its own store, so the counts above are not disturbed.
const fresh = (extra = {}) => { const st = new Map(), meta = new Map(), opts = new Map(), log = { get: 0, list: [] };
  return { st, meta, opts, log, env: Object.assign({ UNSUB_SECRET: 'sec', LIST_TOKEN: 'tok', SUBS: makeKV(st, meta, opts, log) }, extra) }; };
const req = (E, p, { m = 'POST', body, headers = {} } = {}) => w.fetch(new Request(H + p, { method: m,
  headers: Object.assign({ 'Content-Type': 'application/json', Origin: 'https://agsist.com' }, headers),
  body: body === undefined ? undefined : (typeof body === 'string' || body instanceof FormData ? body : JSON.stringify(body)) }), E);
const strip = (h) => { const o = {}; for (const k in h) if (h[k] !== null) o[k] = h[k]; return o; };
const reqH = (E, p, b, headers) => w.fetch(new Request(H + p, { method: 'POST', headers: strip(Object.assign({ 'Content-Type': 'application/json', Origin: 'https://agsist.com' }, headers)),
  body: typeof b === 'string' || b instanceof FormData ? b : JSON.stringify(b) }), E);
const iso2 = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const goodBodies = {
  '/subscribe': { email: 'g@farm.com' },
  '/notice': { email: 'g@farm.com', topic: 'rent:wi' },
  '/alert-subscribe': { email: 'g@farm.com', lat: 45.3, lon: -91.6, place: 'Chetek', radius_mi: 5 },
  '/watch-subscribe': { email: 'g@farm.com', fips: '55005' },
  '/elevator-watch-subscribe': { email: 'g@farm.com', wid: 'abcdef12', label: 'Chetek Co-op corn' },
  '/price-watch-subscribe': { email: 'g@farm.com', pid: 'abcdef12', symbol: 'corn', direction: 'above', target_cents: 450, label: 'Corn above $4.50' },
  '/sponsor-apply': { tier: 'supporter', company: 'Smith Seed', contact: 'Al', email: 'g@farm.com', url: 'smithseed.com', terms: true },
  '/form': { kind: 'atlas-feedback', email: 'g@farm.com', source: 'x' },
};

// 14. the gate: Origin must be agsist.com or www, Content-Type must be JSON
for (const [p, b] of Object.entries(goodBodies)) {
  for (const [hdrs, code, why] of [
      [{ Origin: 'https://evil.example' }, 403, 'a foreign origin'],
      [{ Origin: null }, 403, 'no origin'],
      [{ Origin: 'https://agsist.com.evil.example' }, 403, 'a look-alike origin'],
      [{ Origin: 'http://agsist.com' }, 403, 'plain http'],
      [{ 'Content-Type': 'text/plain' }, 415, 'text/plain (the no-preflight trick)'],
      [{ 'Content-Type': null }, 415, 'no content type']]) {
    const F = fresh();
    r = await reqH(F.env, p, b, hdrs);
    A(r.status === code, p + ' refuses ' + why + ' with ' + code + ' (got ' + r.status + ')');
    A(F.st.size === 0, p + ': ' + why + ' stores nothing');
    A(r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com', p + ': the refusal still names agsist.com for CORS');
  }
  for (const hdrs of [{}, { Origin: 'https://www.agsist.com' }, { 'Content-Type': 'application/json; charset=utf-8' }]) {
    const F = fresh();
    r = await reqH(F.env, p, b, hdrs);
    A(r.status === 200 && (await r.json()).ok === true, p + ' still takes a real page request ' + JSON.stringify(hdrs));
  }
}
{
  const F = fresh(); const fd = new FormData(); fd.append('email', 'x@farm.com'); fd.append('topic', 'rent:wi');
  r = await w.fetch(new Request(H + '/notice', { method: 'POST', body: fd, headers: { Origin: 'https://agsist.com' } }), F.env);
  A(r.status === 415 && F.st.size === 0, 'a form body is JSON-only on /notice');
  const fd2 = new FormData(); fd2.append('email', 'x@farm.com');
  r = await w.fetch(new Request(H + '/subscribe', { method: 'POST', body: fd2, headers: { Origin: 'https://evil.example' } }), F.env);
  A(r.status === 403 && F.st.size === 0, 'a cross-site form post to /subscribe is refused');
  r = await w.fetch(new Request(H + '/subscribe', { method: 'POST', body: 'email=x%40farm.com', headers: { Origin: 'https://agsist.com', 'Content-Type': 'application/x-www-form-urlencoded' } }), F.env);
  A(r.status === 200 && F.st.has('sub:x@farm.com'), "daily.html's no-script form (urlencoded, from agsist.com) still subscribes");
  r = await w.fetch(new Request(H + '/subscribe', { method: 'POST', body: 'email=y%40farm.com', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }), F.env);
  A(r.status === 403 && !F.st.has('sub:y@farm.com'), 'a form post with no Origin is refused');
  r = await w.fetch(new Request(H + '/subscribe', { method: 'OPTIONS', headers: { Origin: 'https://www.agsist.com' } }), F.env);
  A(r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === 'https://www.agsist.com' && /Content-Type/.test(r.headers.get('Access-Control-Allow-Headers')), 'the preflight still answers the page');
  r = await req(F.env, '/list?token=tok', { m: 'GET', headers: { Origin: 'https://evil.example' } });
  A(r.status === 200, 'token routes are not behind the page gate (the jobs send no Origin)');
}

// 15. the shared rate limit
{
  const F = fresh(); const ip = { 'CF-Connecting-IP': '198.51.100.7' };
  const codes = [];
  for (let i = 0; i < 11; i++) codes.push((await reqH(F.env, '/subscribe', { email: 'r' + i + '@farm.com' }, ip)).status);
  A(codes.slice(0, 10).every(c => c === 200) && codes[10] === 429, 'subscribe: the 11th in an hour from one address is refused ' + codes);
  A(!F.st.has('sub:r10@farm.com'), 'a refused sign-up is not stored');
  r = await reqH(F.env, '/subscribe', { email: 'other@farm.com' }, { 'CF-Connecting-IP': '198.51.100.8' });
  A(r.status === 200, 'another address is not held back');
  r = await reqH(F.env, '/notice', { email: 'n@farm.com', topic: 'rent:wi' }, ip);
  A(r.status === 200, 'each route counts on its own');
  const rl = [...F.st.keys()].filter(k => k.startsWith('rlq:subscribe:'));
  A(rl.length === 11 && rl.every(k => F.opts.get(k) && F.opts.get(k).expirationTtl === 172800), 'one key per accepted post, each expiring in two days');
  A(![...F.st.keys()].some(k => k.includes('198.51.100')) && ![...F.st.values()].some(v => String(v).includes('198.51.100')), 'the IP is never stored in the clear');
  A(rl.every(k => /^rlq:subscribe:\d{8}:[0-9a-f]{16}:\d{2}:[0-9a-f]{8}$/.test(k)), 'rate keys: route, day, HMAC of the address, hour, random');
  const r429 = await reqH(F.env, '/subscribe', { email: 'r11@farm.com' }, ip);
  A(r429.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com' && (await r429.json()).ok === false, 'the 429 is readable by the page');
}
{
  // a day cap: an address that already posted 30 times today, in earlier hours
  const F = fresh(); const ip = '198.51.100.20';
  r = await reqH(F.env, '/subscribe', { email: 'd0@farm.com' }, { 'CF-Connecting-IP': ip });
  const mine = [...F.st.keys()].find(k => k.startsWith('rlq:subscribe:'));
  const [, , day, who] = mine.split(':');
  for (let i = 0; i < 29; i++) F.st.set(`rlq:subscribe:${day}:${who}:${String(i % 24).padStart(2, '0') === mine.split(':')[4] ? '99' : String(i % 24).padStart(2, '0')}:${String(i).padStart(8, '0')}`, '');
  // make sure no more than 9 of those landed in this hour, so the hour cap is not what refuses
  const hh = mine.split(':')[4];
  A([...F.st.keys()].filter(k => k.startsWith(`rlq:subscribe:${day}:${who}:${hh}:`)).length < 10, 'test setup: under the hourly cap');
  r = await reqH(F.env, '/subscribe', { email: 'd1@farm.com' }, { 'CF-Connecting-IP': ip });
  A(r.status === 429 && !F.st.has('sub:d1@farm.com'), 'the 31st post in a day from one address is refused');
}
{
  // the daily total per route: 50 watch confirmations a day, from any number of addresses
  const F = fresh(); const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  for (let i = 0; i < 49; i++) F.st.set(`rlq:watch-subscribe:${day}:${String(i).padStart(16, '0')}:00:00000000`, '');
  r = await reqH(F.env, '/watch-subscribe', { email: 'w49@farm.com', fips: '55005' }, { 'CF-Connecting-IP': '203.0.113.1' });
  A(r.status === 200, 'the 50th watch subscribe of the day is taken');
  r = await reqH(F.env, '/watch-subscribe', { email: 'w50@farm.com', fips: '55005' }, { 'CF-Connecting-IP': '203.0.113.2' });
  A(r.status === 429 && !F.st.has('watch:w50@farm.com'), 'the 51st of the day is refused, whatever address it comes from');
  r = await reqH(F.env, '/watch-subscribe', { email: 'w51@farm.com', fips: '55005' });
  A(r.status === 429, '... and with no client IP at all');
  F.st.set(`rlq:watch-subscribe:20000101:${'0'.repeat(16)}:00:00000000`, '');
  r = await reqH(F.env, '/subscribe', { email: 's@farm.com' }, { 'CF-Connecting-IP': '203.0.113.3' });
  A(r.status === 200, 'the daily list has its own total');
}
{
  // IPv6 counts by /64
  const F = fresh(); const codes = [];
  for (let i = 0; i < 10; i++) codes.push((await reqH(F.env, '/alert-subscribe', Object.assign({}, goodBodies['/alert-subscribe'], { email: 'v' + i + '@farm.com' }), { 'CF-Connecting-IP': '2001:db8:1:2::' + (i + 1).toString(16) })).status);
  codes.push((await reqH(F.env, '/alert-subscribe', Object.assign({}, goodBodies['/alert-subscribe'], { email: 'v10@farm.com' }), { 'CF-Connecting-IP': '2001:0db8:0001:0002:ffff:ffff:ffff:ffff' })).status);
  A(codes.slice(0, 10).every(c => c === 200) && codes[10] === 429, 'IPv6: every address in one /64 shares a count ' + codes);
  r = await reqH(F.env, '/alert-subscribe', Object.assign({}, goodBodies['/alert-subscribe'], { email: 'v11@farm.com' }), { 'CF-Connecting-IP': '2001:db8:1:3::1' });
  A(r.status === 200, 'IPv6: the next /64 has its own count');
}
{
  // the burst hold: KV that has not caught up (list() never sees the new keys) still stops at the hourly number
  const F = fresh(); F.env.SUBS.list = async () => ({ keys: [], list_complete: true });
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await reqH(F.env, '/price-watch-subscribe', Object.assign({}, goodBodies['/price-watch-subscribe'], { email: 'b' + i + '@farm.com' }), { 'CF-Connecting-IP': '192.0.2.200' })).status);
  A(codes.slice(0, 10).every(c => c === 200) && codes.slice(10).every(c => c === 429), 'a burst against stale KV is held to the hourly number ' + codes);
  // parallel: 20 at once from one address, KV stale
  const G = fresh(); G.env.SUBS.list = async () => ({ keys: [], list_complete: true });
  const par = await Promise.all(Array.from({ length: 20 }, (_, i) => reqH(G.env, '/elevator-watch-subscribe', Object.assign({}, goodBodies['/elevator-watch-subscribe'], { email: 'p' + i + '@farm.com' }), { 'CF-Connecting-IP': '192.0.2.201' })));
  A(par.filter(x => x.status === 200).length === 10 && par.filter(x => x.status === 429).length === 10, '20 parallel posts: 10 taken, 10 refused');
}
{
  // validation answers before the limit, and the honeypot never counts
  const F = fresh(); const ip = { 'CF-Connecting-IP': '192.0.2.210' };
  for (let i = 0; i < 15; i++) await reqH(F.env, '/subscribe', { email: 'nope' }, ip);
  for (let i = 0; i < 15; i++) await reqH(F.env, '/subscribe', { email: 'h@farm.com', _gotcha: 'x' }, ip);
  r = await reqH(F.env, '/subscribe', { email: 'real@farm.com' }, ip);
  A(r.status === 200, 'refused and honeypot posts do not use up the limit');
}

// 16. /list?format=json from key metadata, the get() fallback, and cursor pages
{
  const F = fresh();
  for (const [e, z] of [['a1@farm.com', '54728'], ['a2@farm.com', ''], ['a3@farm.com', '67801'], ['a4@farm.com', '']])
    await reqH(F.env, '/subscribe', { email: e, zip: z, source: 'hero', reports: e !== 'a3@farm.com' });
  F.st.set('sub:old1@farm.com', JSON.stringify({ ts: 1700000000000, src: 'import' }));          // written before v5.13: no metadata
  F.st.set('sub:old2@farm.com', JSON.stringify({ ts: 1700000000001, src: 'bar', zip: '50010', reports: false }));
  F.st.set('sub:old3@farm.com', 'not json');
  A(F.meta.has('sub:a1@farm.com') && JSON.stringify(F.meta.get('sub:a1@farm.com')) === F.st.get('sub:a1@farm.com'), 'a v5.13 subscribe stores its record as key metadata too');
  // what v5.12 answered: one get per key, in list order
  const want = [...F.st.keys()].filter(k => k.startsWith('sub:')).sort().map(k => {
    let x = null; try { x = JSON.parse(F.st.get(k)); } catch (e) { x = null; } if (!x || typeof x !== 'object') x = {};
    return { email: k.slice(4), zip: /^\d{5}$/.test(String(x.zip || '')) ? x.zip : null, src: String(x.src || ''), ts: Number.isFinite(x.ts) ? x.ts : null, reports: x.reports !== false }; });
  F.log.get = 0;
  r = await req(F.env, '/list?token=tok&format=json', { m: 'GET' });
  const got = await r.text();
  A(got === JSON.stringify(want), '/list?format=json is byte-for-byte the v5.12 answer');
  A(F.log.get === 3, 'only the three old records are read with get() (got ' + F.log.get + ')');
  A(r.headers.get('X-Next-Cursor') === null, 'no cursor header without paging');
  // pages
  let cur = '', pages = [], all = [];
  do {
    r = await req(F.env, '/list?token=tok&format=json&limit=3' + (cur ? '&cursor=' + encodeURIComponent(cur) : ''), { m: 'GET' });
    const pg = await r.json(); pages.push(pg.length); all.push(...pg);
    cur = r.headers.get('X-Next-Cursor');
    A(cur !== null, 'every page carries X-Next-Cursor');
    A(/X-Next-Cursor/.test(r.headers.get('Access-Control-Expose-Headers') || ''), 'the dashboard can read the cursor header');
  } while (cur && pages.length < 10);
  A(JSON.stringify(all) === JSON.stringify(want) && JSON.stringify(pages) === '[3,3,1]', 'three pages of 3, 3 and 1 add up to the whole list ' + pages);
  r = await req(F.env, '/list?token=tok&format=json&limit=0', { m: 'GET' });
  A((await r.json()).length === 7 && r.headers.get('X-Next-Cursor') === '', 'limit=0 means a full page; the last page says ""');
  r = await req(F.env, '/list?token=tok&format=json&limit=abc&cursor=', { m: 'GET' });
  A((await r.json()).length === 7, 'a junk limit still answers');
  r = await req(F.env, '/list?format=json&limit=2', { m: 'GET' });
  A(r.status === 403, 'a page still needs the token');
  // a resubscribe backfills the metadata
  await reqH(F.env, '/subscribe', { email: 'old2@farm.com' });
  A(F.meta.has('sub:old2@farm.com') && F.meta.get('sub:old2@farm.com').zip === '50010' && F.meta.get('sub:old2@farm.com').reports === false && F.meta.get('sub:old2@farm.com').ts === 1700000000001, 'an old record gains metadata, unchanged, the next time it is written');
  // /import writes metadata
  r = await w.fetch(new Request(H + '/import?token=tok', { method: 'POST', body: 'imp@farm.com' }), F.env);
  A(F.meta.get('sub:imp@farm.com') && F.meta.get('sub:imp@farm.com').src === 'import', '/import writes metadata too');
  // /count reads metadata and still adds up
  F.log.get = 0;
  r = await req(F.env, '/count?token=tok', { m: 'GET' });
  const cc = await r.json();
  A(cc.daily === 8 && cc.daily_with_zip === 3 && cc.by_source.hero === 4, '/count from metadata ' + JSON.stringify(cc));
  A(F.log.get === 2, '/count reads only the two records still without metadata (got ' + F.log.get + ')');
  // stale metadata is never trusted over nothing: a metadata object without ts falls back to get()
  F.meta.set('sub:a2@farm.com', { junk: 1 });
  r = await req(F.env, '/list?token=tok&format=json', { m: 'GET' });
  A((await r.json()).find(x => x.email === 'a2@farm.com').src === 'hero', 'unusable metadata falls back to the stored record');
  // plain text unchanged
  r = await req(F.env, '/list?token=tok', { m: 'GET' });
  A((await r.text()) === [...F.st.keys()].filter(k => k.startsWith('sub:')).sort().map(k => k.slice(4)).join('\n'), 'the plain list is unchanged');
  // 1,200 readers: one list() page of 1,000 plus one of 200, no get() at all
  const B = fresh();
  for (let i = 0; i < 1200; i++) { const rec = { ts: 1, src: 's', reports: true }; await B.env.SUBS.put('sub:u' + String(i).padStart(4, '0') + '@farm.com', JSON.stringify(rec), { metadata: rec }); }
  B.log.get = 0; B.log.list = [];
  r = await req(B.env, '/list?token=tok&format=json', { m: 'GET' });
  A((await r.json()).length === 1200 && B.log.get === 0 && B.log.list.length === 2, '1,200 readers: 2 KV operations, not 1,200');
}

// 17. control characters never reach a stored label, place, company or contact
{
  const F = fresh();
  r = await reqH(F.env, '/alert-subscribe', Object.assign({}, goodBodies['/alert-subscribe'], { place: 'Chetek, WI\r\nBcc: x@evil.example\u0000\u2028' }));
  const pl = JSON.parse(F.st.get('alert:g@farm.com')).place;
  A(r.status === 200 && pl === 'Chetek, WI Bcc: x@evil.example' && !/[\r\n\u0000-\u001f\u2028]/.test(pl), 'hail place: CR/LF and control characters stripped ' + JSON.stringify(pl));
  r = await reqH(F.env, '/elevator-watch-subscribe', Object.assign({}, goodBodies['/elevator-watch-subscribe'], { label: 'Co-op\r\nSubject: reset\tnow\u0085' }));
  const el = JSON.parse(F.st.get('ewatch:g@farm.com')).pend.abcdef12.label;
  A(el === 'Co-op Subject: reset now', 'elevator label stripped ' + JSON.stringify(el));
  r = await reqH(F.env, '/price-watch-subscribe', Object.assign({}, goodBodies['/price-watch-subscribe'], { label: '\r\n\r\n' }));
  A(r.status === 400 && !F.st.has('pwatch:g@farm.com'), 'a label that is only line breaks is no label');
  r = await reqH(F.env, '/price-watch-subscribe', Object.assign({}, goodBodies['/price-watch-subscribe'], { label: 'Corn\nabove $4.50' }));
  A(JSON.parse(F.st.get('pwatch:g@farm.com')).pend.abcdef12.label === 'Corn above $4.50', 'price label stripped');
  r = await reqH(F.env, '/sponsor-apply', Object.assign({}, goodBodies['/sponsor-apply'], { company: 'Smith\r\nSeed', contact: 'Al\u007f\nSmith\u2029' }));
  const sa = JSON.parse(F.st.get('sapp:' + (await r.json()).id));
  A(sa.company === 'Smith Seed' && sa.contact === 'Al Smith', 'sponsor company and contact stripped ' + JSON.stringify([sa.company, sa.contact]));
  r = await reqH(F.env, '/alert-subscribe', 'null');
  A(r.status === 400, 'a body of null is a 400, not a crash');
}

// 18. token checks: exact match only (the comparison itself is constant-time)
{
  const F = fresh();
  for (const t of ['to', 'tok0', 'TOK', 'tok ', ' tok', 'tk', '']) {
    r = await req(F.env, '/list?token=' + encodeURIComponent(t), { m: 'GET' });
    A(r.status === 403, 'LIST_TOKEN: ' + JSON.stringify(t) + ' is refused');
  }
  r = await req(F.env, '/list?token=tok', { m: 'GET' }); A(r.status === 200, 'LIST_TOKEN: the token itself works');
  const N = fresh({ LIST_TOKEN: '' });
  r = await req(N.env, '/list?token=', { m: 'GET' }); A(r.status === 403, 'an unset LIST_TOKEN still never matches an empty token');
  const t = await sig('u@farm.com');
  F.st.set('sub:u@farm.com', '{}');
  for (const bad of [t.slice(0, 15), t + '0', t.toUpperCase(), t.slice(1) + t[0], '']) {
    r = await req(F.env, '/unsubscribe?e=u@farm.com&t=' + bad, { m: 'POST' });
    A((await r.text()).includes("isn't valid") && F.st.has('sub:u@farm.com'), 'unsubscribe refuses a near-miss token ' + JSON.stringify(bad));
  }
  r = await req(F.env, '/unsubscribe?e=u@farm.com&t=' + t, { m: 'POST' });
  A(!F.st.has('sub:u@farm.com'), 'the right token still unsubscribes');
}

// 19. the worker's HTML pages carry security headers
{
  const F = fresh(); const t = await sig('h@farm.com');
  for (const p of ['/unsubscribe?e=h@farm.com&t=' + t, '/unsubscribe?e=h@farm.com&t=bad', '/alert-unsubscribe?e=h@farm.com&t=' + t,
                   '/notice-unsubscribe?e=h@farm.com&t=' + t, '/watch-confirm?e=h@farm.com&f=55005&t=bad', '/sponsor-confirm?i=000000000000&t=x',
                   '/sponsor-decide?i=000000000000&d=approve&t=x']) {
    r = await req(F.env, p, { m: 'GET' });
    const csp = r.headers.get('Content-Security-Policy') || '';
    A(/text\/html/.test(r.headers.get('Content-Type')), p + ' is an HTML page');
    A(/default-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp) && /form-action 'self'/.test(csp) && !/script-src/.test(csp), p + ': CSP ' + csp);
    A(r.headers.get('X-Content-Type-Options') === 'nosniff' && r.headers.get('Referrer-Policy') === 'no-referrer' &&
      r.headers.get('X-Frame-Options') === 'DENY' && r.headers.get('Cache-Control') === 'no-store', p + ': nosniff, no-referrer, DENY, no-store');
  }
  r = await req(F.env, '/unsubscribe?e=h@farm.com&t=' + t, { m: 'GET' });
  A((await r.text()).includes('<form method="POST" action="/unsubscribe?e=h%40farm.com&t=' + t + '">'), 'the unsubscribe button still posts back to the same page');
}

// 20. sponsor applications: tier lookup, the per-address index, the logo's bytes
{
  const F = fresh();
  const b64 = (bytes) => Buffer.from(bytes).toString('base64');
  const PNG = 'data:image/png;base64,' + b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const JPG = b64([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
  const WEBP = 'data:image/webp;base64,' + b64([...Buffer.from('RIFF'), 36, 0, 0, 0, ...Buffer.from('WEBPVP8 ')]);
  const base = { tier: 'page', slot: 'spray', company: 'Smith Seed', contact: 'Al', email: 's1@farm.com', headline: 'Seed that yields', url: 'smithseed.com', terms: true };
  for (const tier of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    r = await reqH(F.env, '/sponsor-apply', Object.assign({}, base, { tier }));
    A(r.status === 400 && (await r.json()).error === 'pick a placement', 'tier ' + tier + ' is not a placement');
  }
  r = await req(F.env, '/sponsor-decide?i=000000000000&d=constructor&t=x', { m: 'GET' });
  A((await r.text()).includes("isn't valid"), 'decision "constructor" is not a decision');
  for (const [logo, why] of [['data:image/png;base64,' + b64(Buffer.from('fakepng')), 'text called a PNG'],
      ['data:image/png;base64,' + b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), 'an SVG called a PNG'],
      ['data:image/jpeg;base64,' + b64([0x89, 0x50, 0x4e]), 'three bytes'], ['data:image/webp;base64,' + b64(Buffer.from('RIFF0000WAVEfmt ')), 'a WAV file'],
      ['data:image/png;base64,' + b64(Buffer.from('MZ\x90\x00 exe')), 'a program']]) {
    r = await reqH(F.env, '/sponsor-apply', Object.assign({}, base, { logo }));
    A(r.status === 400 && /PNG, JPG or WebP/.test((await r.json()).error), 'logo refused: ' + why);
  }
  A(![...F.st.keys()].some(k => k.startsWith('sapp')), 'a refused logo stores nothing');
  for (const [logo, kind] of [[PNG, 'png'], ['data:image/jpeg;base64,' + JPG, 'jpeg'], [WEBP, 'webp']]) {
    r = await reqH(F.env, '/sponsor-apply', Object.assign({}, base, { email: kind + '@farm.com', logo }));
    const id = (await r.json()).id;
    A(r.status === 200 && F.st.get('sapp-logo:' + id) === logo, 'a real ' + kind + ' logo is kept as sent');
  }
  r = await reqH(F.env, '/sponsor-apply', Object.assign({}, base, { email: 'mislabel@farm.com', logo: 'data:image/png;base64,' + JPG }));
  let id = (await r.json()).id;
  A(r.status === 200 && F.st.get('sapp-logo:' + id) === 'data:image/jpeg;base64,' + JPG, 'a JPEG sent as image/png is kept, relabelled image/jpeg');
  // the open-application cap reads the index, never every application
  F.log.list = [];
  const ids = [];
  for (let i = 0; i < 4; i++) { r = await reqH(F.env, '/sponsor-apply', Object.assign({}, base, { email: 'cap@farm.com' })); ids.push([r.status, (await r.clone().json()).id]); }
  A(ids.slice(0, 3).every(x => x[0] === 200) && ids[3][0] === 429, 'three open applications, the fourth refused ' + ids.map(x => x[0]));
  A(!F.log.list.includes('sapp:'), 'sponsor-apply never lists sapp: (got ' + JSON.stringify(F.log.list) + ')');
  A(JSON.stringify(JSON.parse(F.st.get('sapp-by:cap@farm.com'))) === JSON.stringify(ids.slice(0, 3).map(x => x[1])) && F.opts.get('sapp-by:cap@farm.com').expirationTtl === 90 * 86400, 'the index holds the three ids and expires');
  const rec = JSON.parse(F.st.get('sapp:' + ids[0][1])); rec.status = 'declined'; F.st.set('sapp:' + ids[0][1], JSON.stringify(rec));
  r = await reqH(F.env, '/sponsor-apply', Object.assign({}, base, { email: 'cap@farm.com' }));
  A(r.status === 200, 'a declined application frees a place');
  A(JSON.parse(F.st.get('sapp-by:cap@farm.com')).length === 3 && !JSON.parse(F.st.get('sapp-by:cap@farm.com')).includes(ids[0][1]), 'the index drops the closed one');
  F.st.set('sapp-by:junk@farm.com', '{"x":1}');
  r = await reqH(F.env, '/sponsor-apply', Object.assign({}, base, { email: 'junk@farm.com' }));
  A(r.status === 200, 'a broken index never blocks an application');
  r = await req(F.env, '/sponsor-apps?token=tok', { m: 'GET' });
  A((await r.json()).every(x => /^[0-9a-f]{12}$/.test(x.id)), '/sponsor-apps lists only applications, never the index');
}

// 21. UNSUB_SECRET: stop links always work; confirms and IP hashes need the secret
{
  // a link from mail sent before v5.13: the Actions jobs signed it with UNSUB_SECRET (sig() above is that recipe)
  const F = fresh();
  F.st.set('sub:old@farm.com', '{}'); F.st.set('alert:old@farm.com', '{}');
  F.st.set('watch:old@farm.com', JSON.stringify({ pend: {}, w: { '55005': null } }));
  r = await req(F.env, '/unsubscribe?e=old@farm.com&t=' + await sig('old@farm.com'), { m: 'POST' });
  A(r.status === 200 && !F.st.has('sub:old@farm.com'), 'secret set: an old daily stop link still unsubscribes');
  r = await req(F.env, '/alert-unsubscribe?e=old@farm.com&t=' + await sig('old@farm.com'), { m: 'POST' });
  A(!F.st.has('alert:old@farm.com'), 'secret set: an old hail stop link still works');
  r = await req(F.env, '/watch-unsubscribe?e=old@farm.com&t=' + await sig('old@farm.com|w'), { m: 'POST' });
  A(!F.st.has('watch:old@farm.com'), 'secret set: an old county stop link still works');
  F.st.set('sub:old2@farm.com', '{}');
  r = await req(F.env, '/unsubscribe?e=old2@farm.com&t=0123456789abcdef', { m: 'POST' });
  A(F.st.has('sub:old2@farm.com'), 'secret set: a made-up token still changes nothing');
  r = await req(F.env, '/count?token=tok', { m: 'GET' });
  const cs = await r.json();
  A(cs.secret === true && !Object.values(cs).includes('sec') && !JSON.stringify(cs).includes('"sec"'), '/count reports secret: true (a boolean, never the value)');
}
{
  const F = fresh({ UNSUB_SECRET: undefined });
  const errs = []; const ce = console.error; console.error = (m) => errs.push(String(m));
  F.st.set('sub:x@farm.com', '{}'); F.st.set('note:x@farm.com', '{"t":{}}'); F.st.set('alert:x@farm.com', '{}');
  F.st.set('watch:x@farm.com', JSON.stringify({ pend: { '55005': { ts: Date.now(), m: 0 } }, w: {} }));
  F.st.set('ewatch:x@farm.com', JSON.stringify({ pend: {}, w: { abcdef12: { label: 'L' } } }));
  F.st.set('pwatch:x@farm.com', JSON.stringify({ pend: {}, w: { abcdef12: { label: 'L' } } }));
  r = await req(F.env, '/unsubscribe?e=x@farm.com&t=c0ffee0123456789', { m: 'GET' });
  A(r.status === 200 && (await r.text()).includes('Yes, unsubscribe') && F.st.has('sub:x@farm.com'), 'secret unset: the stop page still shows its button and changes nothing on GET');
  r = await req(F.env, '/unsubscribe?e=x@farm.com&t=c0ffee0123456789', { m: 'POST' });
  A(r.status === 200 && !F.st.has('sub:x@farm.com') && !F.st.has('note:x@farm.com'), 'secret unset: an old daily stop link still unsubscribes');
  for (const [p, key] of [['/alert-unsubscribe?e=x@farm.com&t=1', 'alert:'], ['/elevator-watch-unsubscribe?e=x@farm.com&t=1', 'ewatch:'], ['/price-watch-unsubscribe?e=x@farm.com&w=&t=1', 'pwatch:']]) {
    r = await req(F.env, p, { m: 'POST' });
    A(r.status === 200 && !F.st.has(key + 'x@farm.com'), 'secret unset: ' + p.split('?')[0] + ' still works');
  }
  r = await req(F.env, '/unsubscribe?e=not-an-email&t=1', { m: 'POST' });
  A((await r.text()).includes("isn't valid"), 'secret unset: a bad address is still refused');
  A(errs.some(m => /UNSUB_SECRET is not set; honouring an unsubscribe WITHOUT checking/.test(m)), 'secret unset: each unchecked unsubscribe logs a loud error');
  errs.length = 0;
  // confirming (a new subscription) needs the secret
  r = await req(F.env, '/watch-confirm?e=x@farm.com&f=55005&t=whatever', { m: 'POST' });
  A(r.status === 503 && JSON.parse(F.st.get('watch:x@farm.com')).pend['55005'] && /html/.test(r.headers.get('Content-Type')), 'secret unset: a confirm is a 503 and confirms nothing');
  for (const p of ['/elevator-watch-confirm?e=x@farm.com&w=abcdef12&t=1', '/price-watch-confirm?e=x@farm.com&p=abcdef12&t=1', '/sponsor-confirm?i=000000000000&t=1']) {
    r = await req(F.env, p, { m: 'POST' });
    A(r.status === 503 || (await r.text()).includes("isn't valid"), 'secret unset: ' + p.split('?')[0] + ' confirms nothing');
  }
  r = await reqH(F.env, '/subscribe', { email: 'y@farm.com' }, { 'CF-Connecting-IP': '192.0.2.250' });
  A(r.status === 503 && !F.st.has('sub:y@farm.com') && (await r.json()).ok === false, 'secret unset: a public POST that needs the IP hash is refused, as JSON');
  A(![...F.st.keys()].some(k => k.startsWith('rlq:') || k.startsWith('rl:')), 'no rate key hashed with a public constant');
  r = await req(F.env, '/count?token=tok', { m: 'GET' });
  const cj = await r.json();
  A(cj.secret === false, '/count reports secret: false');
  console.error = ce;
  A(errs.length >= 2 && errs.every(m => /UNSUB_SECRET is not set/.test(m)), 'each refusal logs the reason');
}

// 22. the token as "Authorization: Bearer", beside ?token=
{
  const F = fresh(); F.st.set('sub:b@farm.com', '{}');
  r = await req(F.env, '/list', { m: 'GET', headers: { Authorization: 'Bearer tok' } }); A(r.status === 200 && (await r.text()) === 'b@farm.com', 'Bearer token works on /list');
  r = await req(F.env, '/count', { m: 'GET', headers: { Authorization: 'bearer   tok' } }); A(r.status === 200, 'the scheme is not case-sensitive');
  for (const h of ['Bearer tokx', 'Bearer ', 'Basic dG9rOg==', 'tok', 'Bearer tok extra'])
    { r = await req(F.env, '/list', { m: 'GET', headers: { Authorization: h } }); A(r.status === 403, 'refused: Authorization ' + JSON.stringify(h)); }
  r = await req(F.env, '/list?token=tok', { m: 'GET', headers: { Authorization: 'Bearer wrong' } }); A(r.status === 403, 'a wrong Bearer is not rescued by ?token=');
  r = await req(F.env, '/list?token=tok', { m: 'GET' }); A(r.status === 200, '?token= alone still works');
  r = await req(F.env, '/flag?k=x', { m: 'POST', headers: { Authorization: 'Bearer tok' } }); A(r.status === 200 && F.st.has('flag:x'), 'Bearer works on a write route');
  r = await req(F.env, '/list', { m: 'OPTIONS' }); A(/Authorization/.test(r.headers.get('Access-Control-Allow-Headers')), 'the preflight allows Authorization');
}

if (fails.length) { for (const f of fails) console.log('FAIL', f); console.log(ok + ' passed, ' + fails.length + ' failed'); process.exit(1); }
console.log('subs-worker-checks: ' + ok + ' passed');
