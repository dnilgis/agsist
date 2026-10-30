// Runs the v5.57 route of workers/subs-worker.js (GET/POST /daily-cw, and the
// same through the front door, /fd/daily-cw) against an in-memory KV. No network.
//   node scripts/test_daily_cw_worker.mjs
// Made-up readers only. A reader already on the Daily turns on "Your county
// this week" from a signed link; the box is never pre-ticked (opening the link
// changes nothing), only cw changes on the reader's record (and a ZIP where
// there was none), and every other record is left byte for byte.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { guard } from './_argguard.mjs'; guard(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname);
const src = path.resolve(here, '..', 'workers', 'subs-worker.js');
const tmp = path.join(os.tmpdir(), 'subs-worker-cw-test-' + process.pid + '.mjs');
fs.copyFileSync(src, tmp);
const w = (await import(pathToFileURL(tmp).href)).default;
fs.unlinkSync(tmp);

const store = new Map(), meta = new Map();
let writes = 0;
const env = { UNSUB_SECRET: 'sec', LIST_TOKEN: 'tok', SUBS: {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v, o) { if (k.startsWith('sub:')) writes++; store.set(k, v); meta.set(k, (o && o.metadata) || null); },
  async delete(k) { store.delete(k); meta.delete(k); },
  async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name, metadata: meta.get(name) })), list_complete: true }; } } };
let n = 0; const A = (c, m) => { if (!c) { console.log('FAIL', m); process.exit(1); } n++; };
const t16 = (s) => crypto.createHmac('sha256', 'sec').update(s.toLowerCase()).digest('hex').slice(0, 16);
const lidOf = (e) => [...crypto.createHmac('sha256', 'sec').update('lid|' + e.toLowerCase()).digest().subarray(0, 16)].map(b => '0123456789abcdefghjkmnpqrstvwxyz'[b & 31]).join('');
let ip = 0;
const req = (p, m = 'GET', body, ct) => w.fetch(new Request('https://x.dev' + p, { method: m,
  headers: Object.assign({ 'CF-Connecting-IP': '10.7.0.' + (++ip), Origin: 'https://agsist.com' }, ct ? { 'Content-Type': ct } : {}),
  body: body === undefined ? undefined : body }), env);

const E = 'made-up-cw-reader@example.com', NOZIP = 'made-up-nozip@example.com', OTHER = 'made-up-bystander@example.com';
const put = (e, r, raw) => { const s = raw || JSON.stringify(r); store.set('sub:' + e, s); meta.set('sub:' + e, JSON.parse(s)); };
const reset = () => {
  store.clear(); meta.clear(); writes = 0;
  put(E, { ts: 1760000000000, src: 'hero', zip: '54728', reports: false, el: ['0068bbc9'] });
  put(NOZIP, { ts: 1760000000002, src: 'bar', reports: true });
  // a bystander stored with odd spacing: any rewrite would show
  put(OTHER, null, '{"ts":1760000000001, "src":"daily","reports":true}');
  for (const e of [E, NOZIP, OTHER]) store.set('lid:' + lidOf(e), e);
};
const rec = (e) => store.get('sub:' + e);
const K = (e) => '/daily-cw?k=' + lidOf(e) + '&t=' + t16(lidOf(e) + '|cw');
const OLD = (e) => '/daily-cw?e=' + encodeURIComponent(e) + '&t=' + t16(e + '|cw');

// ---------- the signed link: valid and not ----------
reset();
let r = await req(K(E)), h = await r.text();
A(r.status === 200 && /Add what changed in your county on Thursdays\?/.test(h) && /Yes, add it/.test(h), 'k= link: GET asks, one button');
A(!/checked/i.test(h) && !h.includes(E), 'nothing pre-ticked, no address on the page');
A(!/name="zip"/.test(h), 'a reader with a ZIP is not asked for one');
A(writes === 0 && rec(E) === JSON.stringify({ ts: 1760000000000, src: 'hero', zip: '54728', reports: false, el: ['0068bbc9'] }), 'GET changes nothing');
r = await req(OLD(E)); A(r.status === 200 && /Yes, add it/.test(await r.text()), 'the old e= form checks too');
for (const [p, why] of [
  ['/daily-cw?k=' + lidOf(E) + '&t=' + t16(lidOf(E) + '|de'), 'a daily-elev token'],
  ['/daily-cw?k=' + lidOf(E) + '&t=' + t16(lidOf(E)), 'an unsubscribe token'],
  ['/daily-cw?k=' + lidOf(E) + '&t=0000000000000000', 'a made-up token'],
  ['/daily-cw?k=' + lidOf(E), 'no token'],
  ['/daily-cw?k=' + lidOf(NOZIP) + '&t=' + t16(lidOf(E) + '|cw'), "another reader's token"],
  ['/daily-cw?k=abcdefghjkmnpqrs&t=' + t16('abcdefghjkmnpqrs|cw'), 'an id with no lid record'],
  ['/daily-cw?e=' + encodeURIComponent(OTHER) + '&t=' + t16(E + '|cw'), "e= with another reader's token"]]) {
  for (const m of ['GET', 'POST']) {
    r = await req(p, m, m === 'POST' ? 'cw=1' : undefined, m === 'POST' ? 'application/x-www-form-urlencoded' : undefined);
    A(r.status === 403 && /That link isn't valid/.test(await r.text()), why + ' refused (' + m + ')');
  }
}
A(writes === 0, 'no refused link wrote anything');

// ---------- POST: on, only cw changes ----------
r = await req(K(E), 'POST', 'cw=1', 'application/x-www-form-urlencoded'); h = await r.text();
A(r.status === 200 && /Your county this week is on/.test(h), 'POST turns it on');
A(rec(E) === JSON.stringify({ ts: 1760000000000, src: 'hero', zip: '54728', reports: false, el: ['0068bbc9'], cw: true }), 'only cw added, every other field kept as stored');
A(JSON.stringify(meta.get('sub:' + E)) === rec(E), 'metadata is the record (/list reads it)');
A(rec(OTHER) === '{"ts":1760000000001, "src":"daily","reports":true}' && rec(NOZIP) === JSON.stringify({ ts: 1760000000002, src: 'bar', reports: true }), 'other records byte for byte');
const w1 = writes;
r = await req(K(E), 'POST', 'cw=1', 'application/x-www-form-urlencoded');
A(writes === w1 && /is on/.test(await r.text()), 'pressing again writes nothing');
r = await req(K(E)); h = await r.text();
A(/Your county this week is on\./.test(h) && /Turn it off/.test(h) && writes === w1, 'GET when on offers the way off, changes nothing');
r = await req(K(E), 'POST', 'cw=0', 'application/x-www-form-urlencoded');
A(/is off/.test(await r.text()) && rec(E) === JSON.stringify({ ts: 1760000000000, src: 'hero', zip: '54728', reports: false, el: ['0068bbc9'] }), 'cw=0 takes only cw off');
r = await req(K(E), 'POST'); A(/is on/.test(await r.text()) && JSON.parse(rec(E)).cw === true, 'a bare button press (no body) turns it on');

// ---------- no ZIP: asked for one; stored only when there was none ----------
r = await req(K(NOZIP)); h = await r.text();
A(/name="zip"/.test(h) && /Your ZIP tells us your county/.test(h) && !/value="\d{5}"/.test(h), 'no ZIP on file: an empty ZIP box');
r = await req(K(NOZIP), 'POST', 'cw=1', 'application/x-www-form-urlencoded'); h = await r.text();
A(/Add your ZIP to turn it on/.test(h) && !('cw' in JSON.parse(rec(NOZIP))), 'no ZIP given: asked again, nothing stored');
for (const z of ['5472', 'abcde', '00000', '547281']) {
  r = await req(K(NOZIP), 'POST', 'cw=1&zip=' + z, 'application/x-www-form-urlencoded');
  A(/Add your ZIP/.test(await r.text()) && rec(NOZIP) === JSON.stringify({ ts: 1760000000002, src: 'bar', reports: true }), 'a bad ZIP (' + z + ') stores nothing');
}
r = await req(K(NOZIP), 'POST', 'cw=1&zip=61611', 'application/x-www-form-urlencoded');
A(/is on/.test(await r.text()) && rec(NOZIP) === JSON.stringify({ ts: 1760000000002, src: 'bar', zip: '61611', reports: true, cw: true }), 'ZIP and cw stored, in the record order the worker writes');
r = await req(K(E), 'POST', JSON.stringify({ cw: true, zip: '61611' }), 'application/json');
A(JSON.parse(rec(E)).zip === '54728', 'a ZIP already on file is never changed');
r = await req(K(NOZIP), 'POST', 'cw=0&zip=50001', 'application/x-www-form-urlencoded');
A(JSON.parse(rec(NOZIP)).zip === '61611' && !('cw' in JSON.parse(rec(NOZIP))), 'turning it off never touches the ZIP');

// ---------- not on the Daily ----------
const GONE = 'made-up-gone@example.com';
store.set('lid:' + lidOf(GONE), GONE);
r = await req(K(GONE), 'POST', 'cw=1&zip=54728', 'application/x-www-form-urlencoded');
A(/not on AGSIST Daily/.test(await r.text()) && !store.has('sub:' + GONE), 'an address not on the Daily gets no record');

// ---------- the front door: JSON, the fields, the ZIP in the body only ----------
reset();
const FD = (e) => '/fd' + K(e);
r = await req(FD(NOZIP)); let j = await r.json();
A(j.ok && j.title === 'Add what changed in your county on Thursdays?' && j.button === 'Yes, add it', 'fd GET: the question and the button');
A(JSON.stringify(j.fields) === JSON.stringify([{ name: 'cw', type: 'hidden', value: '1', label: '' }, { name: 'zip', type: 'text', value: '', label: 'Your ZIP' }]), 'fd GET: the hidden cw and the empty ZIP box');
A(!JSON.stringify(j).includes('@') && !j.lines.some(l => /^ZIP$/.test(l)), 'fd GET: no address, no stray line');
A(writes === 0, 'fd GET changes nothing');
r = await req(FD(E)); j = await r.json();
A(JSON.stringify(j.fields) === JSON.stringify([{ name: 'cw', type: 'hidden', value: '1', label: '' }]), 'fd GET with a ZIP on file: no box');
r = await req(FD(NOZIP), 'POST', 'cw=1&zip=61611', 'application/x-www-form-urlencoded'); j = await r.json();
A(j.ok && j.title === 'Your county this week is on.' && JSON.parse(rec(NOZIP)).zip === '61611', 'fd POST: the ZIP in the body is stored');
r = await req(FD(E), 'POST', 'cw=1&zip=' + '1'.repeat(300), 'application/x-www-form-urlencoded');
A(r.status === 413 && !('cw' in JSON.parse(rec(E))), 'fd POST over 256 bytes refused');
// no other route gets a body or fields
store.set('sub:' + OTHER, '{"ts":1760000000001, "src":"daily","reports":true}');
r = await req('/fd/daily-elev?k=' + lidOf(OTHER) + '&t=' + t16(lidOf(OTHER) + '|de')); j = await r.json();
A(j.ok && !('fields' in j), 'another route answers as before (no fields)');
r = await req('/fd/unsubscribe?k=' + lidOf(OTHER) + '&t=' + t16(lidOf(OTHER)), 'POST', 'cw=1', 'application/x-www-form-urlencoded'); j = await r.json();
A(j.ok && !store.has('sub:' + OTHER), 'unsubscribe through the front door still works with a body sent');

// ---------- /list carries it, the bystander as before ----------
reset();
await req(K(E), 'POST', 'cw=1', 'application/x-www-form-urlencoded');
r = await w.fetch(new Request('https://x.dev/list?format=json', { headers: { Authorization: 'Bearer tok' } }), env); j = await r.json();
A(j.find(x => x.email === E).cw === true && !('cw' in j.find(x => x.email === OTHER)), '/list: cw on the reader who turned it on only');
r = await w.fetch(new Request('https://x.dev/count', { headers: { Authorization: 'Bearer tok' } }), env); j = await r.json();
A(j.daily_county_week === 1, '/count daily_county_week');

// ---------- no secret ----------
r = await w.fetch(new Request('https://x.dev' + OLD(E)), Object.assign({}, env, { UNSUB_SECRET: '' }));
A(r.status === 503, 'no secret: the page refuses (503), never unchecked');

console.log('daily-cw worker checks: ' + n + ' passed');
