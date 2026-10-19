// Runs the v5.30 hay board routes of workers/subs-worker.js (/hay/post,
// /hay/feed, /hay/contact, /hay/mine, /hay/edit, /hay/renew, /hay/delete,
// /hay/report, /hay/admin/*) against an in-memory KV. No network: the ZIP
// lookup is a stub.
//     node scripts/test_hay_worker.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url'; import crypto from 'node:crypto';
const src = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'workers', 'subs-worker.js');
const tmp = path.join(os.tmpdir(), 'subs-worker-hay-test-' + process.pid + '.mjs');
fs.copyFileSync(src, tmp);
const w = (await import(pathToFileURL(tmp).href)).default;
fs.unlinkSync(tmp);
const store = new Map(), opts = new Map();
const SUBS = {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v, o) { store.set(k, v); opts.set(k, o || null); },
  async delete(k) { store.delete(k); opts.delete(k); },
  async list({ prefix, limit }) {
    const all = [...store.keys()].filter(k => k.startsWith(prefix)).sort();
    const lim = limit || 1000;
    return { keys: all.slice(0, lim).map(name => ({ name })), list_complete: all.length <= lim };
  } };
const env = { UNSUB_SECRET: 'sec', LIST_TOKEN: 'tok', SUBS };
// ZIP table stub: only 54728 (Chetek) and 54868 (Rice Lake) are known.
const fetched = [];
globalThis.fetch = async (u) => {
  fetched.push(String(u));
  if (String(u).endsWith('/zips/54.json')) return new Response(JSON.stringify({ '54728': [45.31, -91.65], '54868': [45.5, -91.74] }));
  return new Response('{}', { status: 404 });
};
let ipN = 0;
const freshIp = () => { ipN++; return '10.' + (ipN >> 16 & 255) + '.' + (ipN >> 8 & 255) + '.' + (ipN & 255); };
const H = 'https://x.dev';
const pub = (p, b, h = {}) => w.fetch(new Request(H + p, { method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', Origin: 'https://agsist.com', 'CF-Connecting-IP': freshIp() }, h),
  body: typeof b === 'string' ? b : JSON.stringify(b) }), env);
const admin = (p, b, tok = 'tok') => w.fetch(new Request(H + p, { method: b ? 'POST' : 'GET',
  headers: { 'Content-Type': 'application/json', Origin: 'https://agsist.com', Authorization: 'Bearer ' + tok },
  body: b ? JSON.stringify(b) : undefined }), env);
const get = (p) => w.fetch(new Request(H + p, { headers: { Origin: 'https://agsist.com' } }), env);
let n = 0; const A = (c, m) => { if (!c) { console.log('FAIL', m); process.exit(1); } n++; };
const rec = id => JSON.parse(store.get('hay:' + id));
// The feed is memoised for 60 s on an isolate; writes clear it, so reads here are fresh.

const SALE = { kind: 'sale', zip: '54728', lat: 45.312, lng: -91.648, place: 'Chetek, WI', product: 'alfalfa', cutting: '2nd',
  bale: 'large-square', count: 120, price: 85, unit: 'bale', weight: 1200, rfv: 165, cp: 19.5, delivery: 50,
  note: 'Dry, <b>barn kept</b>, no rain on it.', name: 'Lindquist Farm', phone: '715-555-0100', email: 'Seller@Example.com' };

// ---- post ----
let r = await pub('/hay/post', SALE); let j = await r.json();
A(r.status === 200 && j.ok && /^[0-9a-hjkmnp-tv-z]{10}$/.test(j.id) && /^[0-9a-hjkmnp-tv-z]{24}$/.test(j.key), 'post answers id and key: ' + JSON.stringify(j));
A(j.status === 'live', 'a clean post is live at once');
A(r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com' && r.headers.get('Cache-Control') === 'no-store', 'post: CORS, no-store');
const ID = j.id, KEY = j.key;
let R = rec(ID);
A(R.note === 'Dry, barn kept , no rain on it.' || R.note === 'Dry, barn kept, no rain on it.', 'tags stripped: ' + R.note);
A(R.email === 'seller@example.com' && R.cutting === '2' && R.lat === 45.31 && R.lng === -91.65 && R.delivery === 50, 'record cleaned and rounded');
A(R.kh === crypto.createHmac('sha256', 'sec').update('hay|' + KEY).digest('hex').slice(0, 16), 'kh = hmac16("hay|"+key)');
A(![...store.values()].some(v => String(v).includes(KEY)) && ![...store.keys()].some(k => k.includes(KEY)), 'the key itself is stored nowhere');
const o = opts.get('hay:' + ID);
const ttl = o.expiration - Math.floor(Date.now() / 1000);
A(o && ttl > 30 * 86400 - 60 && ttl <= 30 * 86400 + 1, 'stored with a 30-day expiration: ' + ttl);
A(R.exp - R.ts === 30 * 86400 * 1000, 'exp is 30 days after the post');
A(fetched.length === 0, 'no ZIP lookup when the page sent lat/lng');

// ZIP lookup when lat/lng are absent
r = await pub('/hay/post', Object.assign({}, SALE, { lat: undefined, lng: undefined, zip: '54868', kind: 'wanted', note: 'Need hay for 40 cows' })); j = await r.json();
A(r.status === 200 && rec(j.id).lat === 45.5 && rec(j.id).lng === -91.74, 'lat/lng from the ZIP table');
A(fetched.some(u => u.endsWith('/zips/54.json')), 'ZIP table asked');
const WANT = j.id;
r = await pub('/hay/post', Object.assign({}, SALE, { lat: '', lng: '', zip: '99999' })); A(r.status === 400, 'unknown ZIP refused');

// ---- validation ----
for (const [patch, why] of [[{ kind: 'trade' }, 'kind'], [{ zip: '5472' }, 'zip'], [{ product: 'oats' }, 'product'],
    [{ cutting: '5th' }, 'cutting'], [{ bale: 'tiny' }, 'bale'], [{ count: 0 }, 'count 0'], [{ count: null }, 'sale needs a count'],
    [{ price: -3 }, 'price'], [{ unit: 'pound' }, 'unit'], [{ unit: '' }, 'unit needed with a price'], [{ weight: 9000 }, 'weight'],
    [{ rfv: 900 }, 'rfv'], [{ cp: 80 }, 'cp'], [{ delivery: 'maybe' }, 'delivery'], [{ note: 'n'.repeat(301) }, 'note too long'],
    [{ note: 'see https://hay.example' }, 'link in note'], [{ note: 'visit www.hayhay.biz' }, 'www link'], [{ note: 'go to hayforsale.com' }, 'bare domain'],
    [{ name: 'buy at cheaphay.net' }, 'link in name'], [{ note: 'call 715-555-0100' }, 'phone in note'], [{ note: 'mail me x@y.com' }, 'email in note'],
    [{ phone: '', email: '' }, 'no contact'], [{ phone: '555-01' }, 'short phone'], [{ email: 'nope' }, 'bad email'],
    [{ lat: 10, lng: -91 }, 'lat out of range'], [{ name: 'n'.repeat(61) }, 'name too long']]) {
  r = await pub('/hay/post', Object.assign({}, SALE, patch)); A(r.status === 400, 'post rejects ' + why + ' (' + r.status + ')');
}
r = await pub('/hay/post', Object.assign({}, SALE, { kind: 'wanted', bale: '', count: null, price: null, unit: '' }));
A(r.status === 200, 'a wanted post needs no bale, count or price');
r = await pub('/hay/post', Object.assign({}, SALE, { phone: '', email: 'only@example.com' })); A(r.status === 200, 'email alone is enough');
r = await pub('/hay/post', Object.assign({}, SALE, { email: '' })); A(r.status === 200, 'phone alone is enough');
r = await pub('/hay/post', Object.assign({}, SALE, { place: 'Evil <script>, XX' })); j = await r.json(); A(rec(j.id).place === '', 'odd place dropped');

// held by the screen
r = await pub('/hay/post', Object.assign({}, SALE, { note: 'BEST HAY IN THE COUNTY CALL NOW' })); j = await r.json();
A(r.status === 200 && j.status === 'held' && rec(j.id).why_hidden === 'all caps', 'all caps is held');
const HELD = j.id, HELDKEY = j.key;
r = await pub('/hay/post', Object.assign({}, SALE, { note: 'hay hay hay hay hay hay' })); j = await r.json();
A(j.status === 'held', 'repeated words held');
r = await pub('/hay/post', Object.assign({}, SALE, { note: 'gooooooooood hay' })); j = await r.json();
A(j.status === 'held', 'repeated letters held');

// gate, honeypot, size
r = await pub('/hay/post', SALE, { Origin: 'https://evil.example' }); A(r.status === 403, 'foreign origin refused');
r = await pub('/hay/post', SALE, { 'Content-Type': 'text/plain' }); A(r.status === 415, 'non-JSON refused');
const before = [...store.keys()].filter(k => k.startsWith('hay:')).length;
r = await pub('/hay/post', Object.assign({ _gotcha: 'x' }, SALE)); j = await r.json();
A(r.status === 200 && j.ok && !j.id, 'honeypot answers ok and stores nothing');
A([...store.keys()].filter(k => k.startsWith('hay:')).length === before, 'honeypot: nothing stored');
r = await pub('/hay/post', JSON.stringify(Object.assign({}, SALE, { note: 'x'.repeat(5000) }))); A(r.status === 413, 'over 4 KB refused');
r = await pub('/hay/post', '[1]'); A(r.status === 400, 'not an object');

// rate limit: 3 an hour from one address
const ip = { 'CF-Connecting-IP': '192.0.2.77' };
for (let i = 0; i < 3; i++) { r = await pub('/hay/post', SALE, ip); A(r.status === 200, 'post ' + (i + 1) + ' from one address'); }
r = await pub('/hay/post', SALE, ip); A(r.status === 429, 'the 4th post in an hour from one address is refused');

// ---- feed ----
r = await get('/hay/feed'); j = await r.json();
A(r.status === 200 && j.ok && Array.isArray(j.listings), 'feed answers');
A(r.headers.get('Cache-Control') === 'public, max-age=60', 'feed cached 60 s');
const txt = JSON.stringify(j);
A(!txt.includes('715-555-0100') && !txt.includes('@example.com') && !/"phone"|"email"|"kh"|"reports"|"who"/.test(txt), 'feed carries no contact, key hash or reports');
const mineRow = j.listings.find(x => x.id === ID);
A(mineRow && mineRow.has_phone === true && mineRow.has_email === true && mineRow.price === 85 && mineRow.weight === 1200, 'feed row: public fields and has_ flags');
A(!j.listings.some(x => x.id === HELD), 'held posts are not in the feed');
for (let i = 1; i < j.listings.length; i++) A(j.listings[i - 1].ts >= j.listings[i].ts, 'no location: newest first');
r = await get('/hay/feed?lat=45.5&lng=-91.74&mi=500'); j = await r.json();
A(j.listings[0].id === WANT && j.listings[0].mi === 0, 'nearest first, with miles');
for (let i = 1; i < j.listings.length; i++) A(j.listings[i - 1].mi <= j.listings[i].mi, 'sorted by distance');
r = await get('/hay/feed?lat=45.5&lng=-91.74&mi=5'); j = await r.json();
A(j.listings.length === 1 && j.listings[0].id === WANT, 'radius filter');
r = await get('/hay/feed?kind=wanted'); j = await r.json();
A(j.listings.length >= 1 && j.listings.every(x => x.kind === 'wanted'), 'kind filter');

// ---- contact ----
r = await pub('/hay/contact', { id: ID }); j = await r.json();
A(r.status === 200 && j.phone === '715-555-0100' && j.email === 'seller@example.com' && j.name === 'Lindquist Farm', 'contact route answers the contact');
A(r.headers.get('Cache-Control') === 'no-store', 'contact: no-store');
r = await pub('/hay/contact', { id: HELD }); A(r.status === 404, 'no contact for a held post');
r = await pub('/hay/contact', { id: 'zzzzzzzzzz' }); A(r.status === 404, 'unknown id');
const cip = { 'CF-Connecting-IP': '192.0.2.88' };
for (let i = 0; i < 20; i++) { r = await pub('/hay/contact', { id: ID }, cip); A(r.status === 200, 'contact ' + (i + 1)); }
r = await pub('/hay/contact', { id: ID }, cip); A(r.status === 429, 'contact rate limited per address');

// ---- owner routes ----
r = await pub('/hay/mine', { id: ID, key: KEY }); j = await r.json();
A(r.status === 200 && j.post.phone === '715-555-0100' && j.post.status === 'live', 'mine opens the post with its contact');
r = await pub('/hay/mine', { id: ID, key: KEY.toUpperCase() }); A(r.status === 200, 'key read any case');
for (const [b, why] of [[{ id: ID, key: 'a'.repeat(24) }, 'wrong key'], [{ id: ID }, 'no key'], [{ id: ID, key: HELDKEY }, 'another post\'s key'], [{ id: 'nope', key: KEY }, 'bad id']]) {
  r = await pub('/hay/edit', Object.assign({ price: 1 }, b)); A(r.status === 404, 'edit refuses ' + why);
  r = await pub('/hay/delete', b); A(r.status === 404, 'delete refuses ' + why);
  r = await pub('/hay/renew', b); A(r.status === 404, 'renew refuses ' + why);
}
A(rec(ID).price === 85, 'nothing changed by a wrong key');
r = await pub('/hay/edit', { id: ID, key: KEY, price: 90, note: 'Sold half. 60 left.' }); j = await r.json();
A(r.status === 200 && rec(ID).price === 90 && rec(ID).note === 'Sold half. 60 left.' && rec(ID).bale === 'large-square', 'edit changes the fields sent and keeps the rest');
r = await pub('/hay/edit', { id: ID, key: KEY, price: -1 }); A(r.status === 400 && rec(ID).price === 90, 'edit checks every field');
r = await pub('/hay/edit', { id: ID, key: KEY, note: 'see www.x.com' }); A(r.status === 400, 'edit refuses a link');
r = await pub('/hay/edit', { id: ID, key: KEY, zip: '54868' }); A(r.status === 200 && rec(ID).lat === 45.5, 'a new ZIP moves the pin');
r = await pub('/hay/edit', { id: HELD, key: HELDKEY, note: 'Good second crop, barn kept.' }); j = await r.json();
A(j.post.status === 'live', 'a held post fixed by its poster goes live');
const exp0 = rec(ID).exp;
r = await pub('/hay/renew', { id: ID, key: KEY }); j = await r.json();
A(r.status === 200 && rec(ID).exp > exp0 && rec(ID).exp <= Date.now() + 60 * 86400e3 + 1000, 'renew adds days, at most 60 ahead');
const ttl2 = opts.get('hay:' + ID).expiration - Math.floor(Date.now() / 1000);
A(ttl2 > 50 * 86400, 'renew moves the KV expiration too: ' + ttl2);
await pub('/hay/renew', { id: ID, key: KEY }); await pub('/hay/renew', { id: ID, key: KEY });
A(rec(ID).exp <= Date.now() + 60 * 86400e3 + 1000, 'renewing again stays within 60 days');

// ---- report ----
r = await pub('/hay/report', { id: WANT, why: 'spam' }, { 'CF-Connecting-IP': '198.51.100.1' }); A(r.status === 200, 'report 1');
r = await pub('/hay/report', { id: WANT, why: 'spam' }, { 'CF-Connecting-IP': '198.51.100.1' }); A(r.status === 200, 'same address again');
A(rec(WANT).reports.length === 1 && rec(WANT).status === 'live', 'one report per address; still live');
await pub('/hay/report', { id: WANT, why: 'scam' }, { 'CF-Connecting-IP': '198.51.100.2' });
A(rec(WANT).status === 'live', 'two reports: still live');
await pub('/hay/report', { id: WANT, why: 'sold' }, { 'CF-Connecting-IP': '198.51.100.3' });
A(rec(WANT).status === 'hidden' && rec(WANT).why_hidden === 'reports', 'three reports from different addresses hide it');
A(!rec(WANT).reports.some(x => x.who.includes('198.51')), 'report addresses kept only as hashes');
r = await get('/hay/feed'); j = await r.json(); A(!j.listings.some(x => x.id === WANT), 'hidden post out of the feed');
r = await pub('/hay/contact', { id: WANT }); A(r.status === 404, 'no contact for a hidden post');
r = await pub('/hay/edit', { id: WANT, key: 'x'.repeat(24) }); A(r.status === 404, 'still needs the key');

// ---- admin ----
r = await admin('/hay/admin/list', null, 'nope'); A(r.status === 403, 'admin list needs the token');
r = await w.fetch(new Request(H + '/hay/admin/list?token=tok'), env); A(r.status === 403, 'admin refuses ?token= (Bearer only)');
r = await admin('/hay/admin/clear', { id: WANT }, 'nope'); A(r.status === 403 && rec(WANT).status === 'hidden', 'clear needs the token');
r = await admin('/hay/admin/hide', { id: ID }, 'nope'); A(r.status === 403 && rec(ID).status === 'live', 'hide needs the token');
r = await admin('/hay/admin/list?new=1'); j = await r.json();
A(r.status === 200 && j.posts.length >= 3 && j.posts.every(p => !('kh' in p)), 'admin list: new posts, no key hash');
A(j.posts.find(p => p.id === WANT).reports.every(x => !('who' in x)), 'admin list: reports without the address hash');
r = await admin('/hay/admin/mark', { ids: j.posts.map(p => p.id) }); j = await r.json(); A(j.marked >= 3, 'mark');
r = await admin('/hay/admin/list?new=1'); j = await r.json(); A(j.posts.length === 0, 'nothing new after mark');
r = await admin('/hay/admin/clear', { id: WANT }); j = await r.json();
A(j.status === 'live' && rec(WANT).reports.length === 0, 'Sig clears a hidden post');
r = await admin('/hay/admin/hide', { id: ID }); A(rec(ID).status === 'hidden' && rec(ID).why_hidden === 'sig', 'Sig hides a post');
r = await pub('/hay/edit', { id: ID, key: KEY, note: 'Back up please' }); j = await r.json(); A(j.post.status === 'hidden', 'an edit does not undo a hide');
r = await admin('/hay/admin/list?new=1'); j = await r.json(); A(j.posts.length === 0, 'a hide by Sig is not news to Sig');
await pub('/hay/report', { id: WANT, why: 'spam' }, { 'CF-Connecting-IP': '198.51.100.4' });
A(rec(WANT).status === 'live', 'after a clear, it takes three new reports');

// ---- delete ----
r = await pub('/hay/delete', { id: WANT, key: KEY }); A(r.status === 404, 'delete with another post\'s key refused');
const wk = (await (await pub('/hay/post', Object.assign({}, SALE, { kind: 'wanted' }))).json());
r = await pub('/hay/delete', { id: wk.id, key: wk.key }); j = await r.json();
A(r.status === 200 && !store.has('hay:' + wk.id), 'delete removes the post');
r = await pub('/hay/mine', { id: wk.id, key: wk.key }); A(r.status === 404, 'gone after delete');

// ---- expiry: a post past exp leaves the feed even before KV drops it ----
const E = rec(ID); E.status = 'live'; E.exp = Date.now() - 1000; store.set('hay:' + ID, JSON.stringify(E));
await admin('/hay/admin/mark', { ids: [WANT] });
r = await get('/hay/feed'); j = await r.json(); A(!j.listings.some(x => x.id === ID), 'expired post out of the feed');
r = await pub('/hay/contact', { id: ID }); A(r.status === 404, 'no contact for an expired post');

// ---- other routes untouched ----
r = await get('/hay/nothing'); A(r.status === 404, 'unknown hay route 404');
r = await w.fetch(new Request(H + '/hay/post', { method: 'OPTIONS', headers: { Origin: 'https://agsist.com' } }), env);
A(r.status === 204, 'preflight answers');
r = await get('/elev/feed'); A(r.status === 200, 'elevator feed still answers');

console.log('hay board worker: ' + n + ' checks passed');
