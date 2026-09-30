// Runs the elevator-watch routes of workers/subs-worker.js against an in-memory KV. No network.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const src = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'workers', 'subs-worker.js');
const tmp = path.join(os.tmpdir(), 'subs-worker-under-test-ewatch.mjs');
fs.copyFileSync(src, tmp);
const w = (await import(pathToFileURL(tmp).href)).default;
const store = new Map();
const env = {
  UNSUB_SECRET: 'sec', LIST_TOKEN: 'tok', SUBS: {
    async get(k) { return store.has(k) ? store.get(k) : null },
    async put(k, v) { store.set(k, v) }, async delete(k) { store.delete(k) },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true } }
  }
};
const H = 'https://x.dev';
const call = (p, m = 'GET', b) => w.fetch(new Request(H + p, { method: m, headers: { 'Content-Type': 'application/json', Origin: 'https://agsist.com' }, body: b ? JSON.stringify(b) : undefined }), env);
const tok = (s) => crypto.createHmac('sha256', 'sec').update(s.toLowerCase()).digest('hex').slice(0, 16);
let ok = 0; const A = (c, m) => { if (!c) { console.log('FAIL', m); process.exit(1) } ok++ };

const WID = 'a1b2c3d4';
const LABEL = 'ADM Altamont, IL — corn';

let r = await call('/elevator-watch-subscribe', 'POST', { email: 'A@x.com', wid: WID, label: LABEL });
A(r.status == 200, 'sub');
A(JSON.parse(store.get('ewatch:a@x.com')).pend[WID].label === LABEL, 'pending carries label');
A(JSON.parse(store.get('ewatch:a@x.com')).pend[WID].m === 0, 'pending unmailed');

r = await call('/elevator-watch-subscribe', 'POST', { email: 'a@x.com', wid: 'not-hex!!', label: LABEL });
A(r.status == 400, 'bad wid');
r = await call('/elevator-watch-subscribe', 'POST', { email: 'a@x.com', wid: WID, label: '' });
A(r.status == 400, 'bad label');
r = await call('/elevator-watch-subscribe', 'POST', { email: 'nope', wid: WID, label: LABEL });
A(r.status == 400, 'bad email');
r = await call('/elevator-watch-subscribe', 'POST', { email: 'b@x.com', wid: WID, label: LABEL, _gotcha: 'x' });
A(!store.has('ewatch:b@x.com'), 'honeypot');

// confirm: GET mutates nothing, and shows the real label
let t = tok('a@x.com|ec|' + WID);
r = await call(`/elevator-watch-confirm?e=a@x.com&w=${WID}&t=${t}`);
let confirmPage = await r.text();
A(confirmPage.includes('Yes, watch it'), 'confirm page');
A(confirmPage.includes('ADM Altamont'), 'confirm page shows the real label, not a placeholder');
A(WID in JSON.parse(store.get('ewatch:a@x.com')).pend, 'GET did not confirm');

r = await call(`/elevator-watch-confirm?e=a@x.com&w=${WID}&t=0000000000000000`, 'POST');
A((await r.text()).includes("isn't valid"), 'bad token');

r = await call(`/elevator-watch-confirm?e=a@x.com&w=${WID}&t=${t}`, 'POST');
let confirmedText = await r.text();
A(confirmedText.includes('You are watching') && confirmedText.includes('ADM Altamont'), 'confirmed, names the elevator');
let rec = JSON.parse(store.get('ewatch:a@x.com'));
A(rec.w[WID].k === null && rec.w[WID].label === LABEL && !rec.pend[WID], 'moved to w, baseline pending, label kept');

// list + mark need token
r = await call('/elevator-watch-list');
A(r.status == 403, 'list needs token');
r = await call('/elevator-watch-list?token=tok');
let L = await r.json();
A(L.length == 1 && L[0].email == 'a@x.com', 'list');

r = await call('/elevator-watch-mark?token=tok', 'POST', { email: 'a@x.com', wid: WID, k: 'basis', s: { basis: -25 } });
rec = JSON.parse(store.get('ewatch:a@x.com'));
A(rec.w[WID].k == 'basis' && rec.w[WID].s.basis === -25, 'mark records the baseline');

// cap of 5
const others = ['11111111', '22222222', '33333333', '44444444'];
for (const wid of others) await call('/elevator-watch-subscribe', 'POST', { email: 'a@x.com', wid, label: 'Some Elevator — corn' });
r = await call('/elevator-watch-subscribe', 'POST', { email: 'a@x.com', wid: '55555555', label: 'One Too Many — corn' });
A(r.status == 429, 'cap 5');
r = await call('/elevator-watch-subscribe', 'POST', { email: 'a@x.com', wid: WID, label: LABEL });
A(r.status == 200, 'existing is silent ok, does not double-count against the cap');

// one-elevator unsubscribe, then all
t = tok('a@x.com|ew|' + WID);
r = await call(`/elevator-watch-unsubscribe?e=a@x.com&w=${WID}&t=${t}`);
A(JSON.parse(store.get('ewatch:a@x.com')).w[WID], 'GET unsub mutates nothing');
await call(`/elevator-watch-unsubscribe?e=a@x.com&w=${WID}&t=${t}`, 'POST');
A(!('' + WID in JSON.parse(store.get('ewatch:a@x.com')).w) === false || !(WID in JSON.parse(store.get('ewatch:a@x.com')).w), 'one gone');
await call(`/elevator-watch-unsubscribe?e=a@x.com&t=${tok('a@x.com|ew')}`, 'POST');
A(!store.has('ewatch:a@x.com'), 'all gone, key deleted');

// mark after unsubscribe is skipped
r = await call('/elevator-watch-mark?token=tok', 'POST', { email: 'a@x.com', wid: WID, k: 'z' });
A((await r.json()).skipped, 'mark skipped after unsubscribe');

// old county-watch and v4 routes untouched by this change
r = await call('/watch-subscribe', 'POST', { email: 'c@x.com', fips: '19169' });
A(r.status == 200 && store.has('watch:c@x.com'), 'county watch v5.0 still works, untouched');
r = await call('/subscribe', 'POST', { email: 'd@x.com' });
A(store.has('sub:d@x.com'), 'v4 subscribe still works');

console.log('elevator-watch worker ok', ok, 'checks');
