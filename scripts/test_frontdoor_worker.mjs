// Runs the v5.48 front-door routes of workers/subs-worker.js (GET/POST
// /fd/<route>) against an in-memory KV. No network. Made-up readers only.
//   node scripts/test_frontdoor_worker.mjs
// agsist.com/e asks these from the reader's browser: the same signed params
// as the old worker link, answered in JSON with CORS for agsist.com. GET
// changes nothing; POST does what the old page's button did. Old links still work.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const here = path.dirname(new URL(import.meta.url).pathname);
const src = path.resolve(here, '..', 'workers', 'subs-worker.js');
const tmp = path.join(os.tmpdir(), 'subs-worker-fd-test-' + process.pid + '.mjs');
fs.copyFileSync(src, tmp);
const w = (await import(pathToFileURL(tmp).href)).default;
fs.unlinkSync(tmp);

const store = new Map();
const kv = {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v) { store.set(k, v); },
  async delete(k) { store.delete(k); },
  async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }; } };
const env = { UNSUB_SECRET: 'sec', LIST_TOKEN: 'tok', SUBS: kv };
let n = 0; const A = (c, m) => { if (!c) { console.log('FAIL', m); process.exit(1); } n++; };
const t16 = (s) => crypto.createHmac('sha256', 'sec').update(s.toLowerCase()).digest('hex').slice(0, 16);
let ip = 0;
const fd = (p, m = 'GET', e = env, origin = 'https://agsist.com') => w.fetch(new Request('https://x.dev/fd/' + p, { method: m,
  headers: Object.assign({ 'CF-Connecting-IP': '10.7.0.' + (++ip) }, origin ? { Origin: origin } : {}) }), e);
const j = async (r) => { A(/json/.test(r.headers.get('Content-Type') || ''), 'answers JSON'); return r.json(); };

const E = 'made-up-reader@example.com', L = 'abcdefghjkmnpqrs';
store.set('lid:' + L, E);
store.set('sub:' + E, JSON.stringify({ ts: 1760000000000, src: 'hero' }));

// ---------- the Daily stop ----------
let r = await fd('unsubscribe?k=' + L + '&t=' + t16(L)), x = await j(r);
A(r.status === 200 && x.ok && x.title === 'Unsubscribe from AGSIST Daily?' && x.button === 'Yes, unsubscribe', 'GET: the question and its button');
A(x.lines.some(l => /Nothing happens until you press the button/.test(l)), 'GET: the plain line');
A(!JSON.stringify(x).includes('@') && !JSON.stringify(x).includes('example.com'), 'the address is never in the JSON');
A(r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com', 'CORS for agsist.com');
A(r.headers.get('Cache-Control') === 'no-store', 'not cached');
A(store.has('sub:' + E), 'GET changes nothing');
r = await fd('unsubscribe?k=' + L + '&t=' + t16(L + 'x')); x = await j(r);
A(x.ok === false && /no longer works/.test(x.title) && !x.button && store.has('sub:' + E), 'a bad t: not valid, nothing changed');
A(x.lines.some((l) => /Older AGSIST links stop working/.test(l)) && x.lines.every((l) => !l.includes('@')), 'v5.52: a bad stop link says why, never an address in the JSON');
r = await fd('unsubscribe?k=zzzzzzzzzzzzzzzz&t=' + t16('zzzzzzzzzzzzzzzz')); x = await j(r);
A(x.ok === false && r.status === 200, 'an id with no record: not valid (as JSON, 200 so the page can read it)');
r = await fd('unsubscribe?k=' + L + '&t=' + t16(L), 'POST'); x = await j(r);
A(x.ok && /unsubscribed/i.test(x.title) && !x.button && !store.has('sub:' + E), 'POST: stopped');

// ---------- old links still work, as HTML ----------
store.set('sub:' + E, JSON.stringify({ ts: 1760000000000, src: 'hero' }));
r = await w.fetch(new Request('https://x.dev/unsubscribe?k=' + L + '&t=' + t16(L)), env);
A(r.status === 200 && /text\/html/.test(r.headers.get('Content-Type')) && /Yes, unsubscribe/.test(await r.text()), 'old k= link: the HTML page as before');
r = await w.fetch(new Request('https://x.dev/unsubscribe?e=' + encodeURIComponent(E) + '&t=' + t16(E)), env);
A(/Yes, unsubscribe/.test(await r.text()), 'old e= link: the HTML page as before');

// ---------- the Daily's elevators link ----------
r = await fd('daily-elev?k=' + L + '&t=' + t16(L + '|de')); x = await j(r);
A(x.ok && x.button === 'Yes, link this browser' && ![...store.keys()].some(k => k.startsWith('dk:')), 'daily-elev GET: asks, makes no key');
r = await fd('daily-elev?k=' + L + '&t=' + t16(L + '|de'), 'POST'); x = await j(r);
A(x.ok && x.go && /^https:\/\/agsist\.com\/cash-bids#dk=[0-9a-z]{24}$/.test(x.go.href) && /saved elevators/.test(x.go.text), 'daily-elev POST: the agsist.com link with the key');

// ---------- county watch confirm and stop, notices ----------
store.set('watch:' + E, JSON.stringify({ pend: { '19169': { ts: Date.now(), m: 0 } }, w: {} }));
r = await fd('watch-confirm?k=' + L + '&f=19169&t=' + t16(L + '|c|19169')); x = await j(r);
A(x.ok && /Watch county 19169/.test(x.title) && x.button === 'Yes, watch it', 'watch-confirm GET');
r = await fd('watch-confirm?k=' + L + '&f=19169&t=' + t16(L + '|c|19169'), 'POST'); x = await j(r);
A(x.ok && /You are watching this county/.test(x.title) && JSON.parse(store.get('watch:' + E)).w['19169'] === null, 'watch-confirm POST');
r = await fd('watch-unsubscribe?k=' + L + '&t=' + t16(L + '|w'), 'POST'); x = await j(r);
A(x.ok && /No more county watch emails/.test(x.title) && !store.has('watch:' + E), 'stop all watches');
store.set('note:' + E, JSON.stringify({ ts: 1, t: { 'rent:wi': { ts: 1 }, cot: { ts: 1 } } }));
r = await fd('notice-unsubscribe?k=' + L + '&t=' + t16(L) + '&topic=cot', 'POST'); x = await j(r);
A(x.ok && Object.keys(JSON.parse(store.get('note:' + E)).t).join() === 'rent:wi', 'stop one notice, the other kept');

// ---------- Rain Print reminder stop, sponsor confirm ----------
const RK = 'rpr:0123456789abcdef:0123456789abcdef';
store.set(RK, JSON.stringify({ ts: Date.now() }));
const rt = t16('rp-remind-stop|' + RK);
r = await fd('rp-remind/stop?k=' + encodeURIComponent(RK) + '&t=' + rt); x = await j(r);
A(x.ok && x.button === 'Yes, stop it' && !JSON.parse(store.get(RK)).done, 'rp-remind stop GET changes nothing');
r = await fd('rp-remind/stop?k=' + encodeURIComponent(RK) + '&t=' + rt, 'POST'); x = await j(r);
A(x.ok && /Stopped/.test(x.title) && JSON.parse(store.get(RK)).done, 'rp-remind stop POST');
store.set('sapp:0123456789ab', JSON.stringify({ status: 'pending', ts: Date.now(), company: 'Made Up Co & Sons', tier: 'page', slot: 'x' }));
r = await fd('sponsor-confirm?i=0123456789ab&t=' + t16('0123456789ab|sc')); x = await j(r);
A(x.ok && /Confirm your AGSIST ad: Made Up Co & Sons/.test(x.title) && x.button === 'Yes, send it to Sig', 'sponsor-confirm GET, entities decoded');
r = await fd('sponsor-confirm?i=0123456789ab&t=' + t16('0123456789ab|sc'), 'POST'); x = await j(r);
A(x.ok && JSON.parse(store.get('sapp:0123456789ab')).status === 'confirmed', 'sponsor-confirm POST');

// ---------- only the emailed routes; no secret is JSON too ----------
for (const p of ['list?format=json&token=tok', 'export?token=tok', 'subscribe', 'count?token=tok']) {
  r = await fd(p); x = await j(r);
  A(r.status === 404 && x.ok === false && r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com', 'not a front-door route: ' + p);
}
r = await fd('unsubscribe?k=' + L + '&t=' + t16(L), 'PUT'); A(r.status === 404, 'PUT refused');
r = await fd('watch-confirm?k=' + L + '&f=19169&t=x', 'GET', { SUBS: kv }); x = await j(r);
A(r.status === 503 && x.ok === false && r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com', 'no secret: 503 JSON with CORS');
r = await w.fetch(new Request('https://x.dev/fd/unsubscribe', { method: 'OPTIONS', headers: { Origin: 'https://agsist.com' } }), env);
A(r.status === 204, 'preflight answered');
r = await fd('unsubscribe?k=' + L + '&t=' + t16(L), 'GET', env, 'https://evil.example');
A(r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com', 'another site gets no CORS for itself');

console.log('test_frontdoor_worker: ' + n + ' passed');
