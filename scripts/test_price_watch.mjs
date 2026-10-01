// Runs the price-watch routes of workers/subs-worker.js against an in-memory KV. No network.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const src = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'workers', 'subs-worker.js');
const tmp = path.join(os.tmpdir(), 'subs-worker-under-test-pwatch.mjs');
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

const PID = 'a1b2c3d4';
const LABEL = 'Corn (Dec \'26) above $4.50';

let r = await call('/price-watch-subscribe', 'POST', { email: 'A@x.com', pid: PID, symbol: 'corn-dec', direction: 'above', target_cents: 450, label: LABEL });
A(r.status == 200, 'sub');
let rec = JSON.parse(store.get('pwatch:a@x.com'));
A(rec.pend[PID].label === LABEL, 'pending carries label');
A(rec.pend[PID].symbol === 'corn-dec' && rec.pend[PID].direction === 'above' && rec.pend[PID].target_cents === 450, 'pending carries symbol/direction/target');
A(rec.pend[PID].m === 0, 'pending unmailed');

r = await call('/price-watch-subscribe', 'POST', { email: 'a@x.com', pid: 'not-hex!!', symbol: 'corn-dec', direction: 'above', target_cents: 450, label: LABEL });
A(r.status == 400, 'bad pid');
r = await call('/price-watch-subscribe', 'POST', { email: 'a@x.com', pid: PID, symbol: 'DROP TABLE', direction: 'above', target_cents: 450, label: LABEL });
A(r.status == 400, 'bad symbol (malformed)');
r = await call('/price-watch-subscribe', 'POST', { email: 'a@x.com', pid: PID, symbol: 'soyoil', direction: 'above', target_cents: 450, label: LABEL });
A(r.status == 400, 'bad symbol (well-formed but not on the whitelist)');
r = await call('/price-watch-subscribe', 'POST', { email: 'a@x.com', pid: PID, symbol: 'corn-dec', direction: 'sideways', target_cents: 450, label: LABEL });
A(r.status == 400, 'bad direction');
r = await call('/price-watch-subscribe', 'POST', { email: 'a@x.com', pid: PID, symbol: 'corn-dec', direction: 'above', target_cents: 0, label: LABEL });
A(r.status == 400, 'bad target (zero)');
r = await call('/price-watch-subscribe', 'POST', { email: 'a@x.com', pid: PID, symbol: 'corn-dec', direction: 'above', target_cents: 999999, label: LABEL });
A(r.status == 400, 'bad target (too large)');
r = await call('/price-watch-subscribe', 'POST', { email: 'a@x.com', pid: PID, symbol: 'corn-dec', direction: 'above', target_cents: 450, label: '' });
A(r.status == 400, 'bad label');
r = await call('/price-watch-subscribe', 'POST', { email: 'nope', pid: PID, symbol: 'corn-dec', direction: 'above', target_cents: 450, label: LABEL });
A(r.status == 400, 'bad email');
r = await call('/price-watch-subscribe', 'POST', { email: 'b@x.com', pid: PID, symbol: 'corn-dec', direction: 'above', target_cents: 450, label: LABEL, _gotcha: 'x' });
A(!store.has('pwatch:b@x.com'), 'honeypot');

// confirm: GET mutates nothing, and shows the real label
let t = tok('a@x.com|pc|' + PID);
r = await call(`/price-watch-confirm?e=a@x.com&p=${PID}&t=${t}`);
let confirmPage = await r.text();
A(confirmPage.includes('Yes, set it'), 'confirm page');
A(confirmPage.includes(LABEL), 'confirm page shows the real label, not a placeholder');
A(PID in JSON.parse(store.get('pwatch:a@x.com')).pend, 'GET did not confirm');

r = await call(`/price-watch-confirm?e=a@x.com&p=${PID}&t=0000000000000000`, 'POST');
A((await r.text()).includes("isn't valid"), 'bad token');

r = await call(`/price-watch-confirm?e=a@x.com&p=${PID}&t=${t}`, 'POST');
let confirmedText = await r.text();
A(confirmedText.includes('Alert set for') && confirmedText.includes(LABEL) && confirmedText.includes('clears itself'), 'confirmed, names the alert, states one-shot');
rec = JSON.parse(store.get('pwatch:a@x.com'));
A(rec.w[PID].symbol === 'corn-dec' && rec.w[PID].direction === 'above' && rec.w[PID].target_cents === 450 && !rec.pend[PID], 'moved to w with full details, pending cleared');

// list + mark need token
r = await call('/price-watch-list');
A(r.status == 403, 'list needs token');
r = await call('/price-watch-list?token=tok');
let L = await r.json();
A(L.length == 1 && L[0].email == 'a@x.com', 'list');

// mark fired: one-shot removal, never re-arms
r = await call('/price-watch-mark?token=tok', 'POST', { email: 'a@x.com', pid: PID, fired: true });
rec = JSON.parse(store.get('pwatch:a@x.com') || '{"w":{},"pend":{}}');
A(!(PID in (rec.w || {})), 'fired alert is removed, not re-armed');
A(!store.has('pwatch:a@x.com'), 'empty record is deleted entirely, not left as {}');

// a confirm-mailed mark on a separate pending alert just flips the flag, doesn't remove it
const PID2 = 'e5f6a7b8';
await call('/price-watch-subscribe', 'POST', { email: 'a@x.com', pid: PID2, symbol: 'beans-nov', direction: 'below', target_cents: 1000, label: 'Beans below $10.00' });
r = await call('/price-watch-mark?token=tok', 'POST', { email: 'a@x.com', pid: PID2, confirm_mailed: true });
rec = JSON.parse(store.get('pwatch:a@x.com'));
A(rec.pend[PID2].m === 1, 'confirm_mailed flips m without removing the pending alert');

// cap of 5 (PID was fired/removed above, so only PID2 counts as already pending;
// four more fills the cap exactly before the fifth-plus-one is rejected)
const others = ['11111111', '22222222', '33333333', '44444444'];
for (const pid of others) await call('/price-watch-subscribe', 'POST', { email: 'a@x.com', pid, symbol: 'wheat', direction: 'above', target_cents: 700, label: 'Wheat above $7.00' });
r = await call('/price-watch-subscribe', 'POST', { email: 'a@x.com', pid: '99999999', symbol: 'wheat', direction: 'above', target_cents: 700, label: 'One too many' });
A(r.status == 429, 'cap 5');

// unsubscribe one, then all
t = tok('a@x.com|pw|' + PID2);
r = await call(`/price-watch-unsubscribe?e=a@x.com&p=${PID2}&t=${t}`, 'POST');
A((await r.text()).includes('Cancelled'), 'unsub one');
A(!(PID2 in JSON.parse(store.get('pwatch:a@x.com')).pend), 'one alert removed');

t = tok('a@x.com|pw');
r = await call(`/price-watch-unsubscribe?e=a@x.com&t=${t}`, 'POST');
A((await r.text()).includes('No more price alert emails'), 'unsub all');
A(!store.has('pwatch:a@x.com'), 'all cleared, key deleted');

console.log('PASS', ok, 'checks');
