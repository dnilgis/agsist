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

// ---------- v5.3 alert options ----------
r = await call('/elevator-watch-options');
let O = await r.json();
A(r.status == 200 && O.ok && O.kinds.join() === 'any,cash,basis,move' && O.max === 5, 'options route lists the kinds');
A(r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com', 'options route answers the page (CORS)');

const EW = 'e1e2e3e4', AID = 'f0f1f2f3';
const CASH = { email: 'o@x.com', wid: AID, label: 'Adell Cooperative, Adell, WI — corn Oct 2026 cash at or above $4.50',
  kind: 'cash', ewid: EW, crop: 'corn', period: '2026-10', plabel: 'Oct 2026', direction: 'above', target_cents: 450 };
// Each refusal must be for its own reason: the error is checked, so a body
// refused for some other field cannot pass as a test of this one.
const bad = async (patch, why, err) => {
  const before = store.get('ewatch:o@x.com');
  const rr = await call('/elevator-watch-subscribe', 'POST', Object.assign({}, CASH, patch));
  A(rr.status == 400, 'refused: ' + why);
  A((await rr.json()).error === err, 'refused for the right reason: ' + why);
  A(store.get('ewatch:o@x.com') === before, 'nothing stored: ' + why);
};
await bad({ kind: 'sideways', target_cents: 50 }, 'unknown kind', 'invalid kind');
await bad({ ewid: 'zz' }, 'bad elevator id', 'invalid elevator id');
await bad({ crop: 'barley' }, 'crop the card does not show', 'invalid crop');
await bad({ period: 'Oct 2026!' }, 'bad period key', 'invalid period');
await bad({ plabel: '' }, 'empty period label', 'invalid period label');
await bad({ direction: 'sideways' }, 'bad direction', 'invalid direction');
await bad({ target_cents: 99 }, 'cash under $1', 'invalid target');
await bad({ target_cents: 3201 }, 'cash over $32', 'invalid target');
await bad({ target_cents: 450.5 }, 'fractional cents', 'invalid target');
await bad({ target_cents: '450' }, 'cents sent as a string', 'invalid target');
await bad({ kind: 'basis', target_cents: -301 }, 'basis under -300', 'invalid target');
await bad({ kind: 'basis', target_cents: 301 }, 'basis over +300', 'invalid target');
await bad({ kind: 'move', move_cents: 0 }, 'move of 0', 'invalid move');
await bad({ kind: 'move', move_cents: 101 }, 'move over 100', 'invalid move');

// edges that must pass
r = await call('/elevator-watch-subscribe', 'POST', Object.assign({}, CASH, { target_cents: 100, wid: 'a0000001' }));
A(r.status == 200, 'cash $1.00 is allowed');
r = await call('/elevator-watch-subscribe', 'POST', Object.assign({}, CASH, { kind: 'basis', target_cents: -300, wid: 'a0000002' }));
A(r.status == 200, 'basis -300 is allowed');
r = await call('/elevator-watch-subscribe', 'POST', Object.assign({}, CASH, { kind: 'move', move_cents: 100, direction: undefined, target_cents: undefined, wid: 'a0000003' }));
A(r.status == 200, 'move of 100 is allowed, no direction needed');
rec = JSON.parse(store.get('ewatch:o@x.com'));
A(rec.pend.a0000003.kind === 'move' && rec.pend.a0000003.move_cents === 100 && !('target_cents' in rec.pend.a0000003), 'move stores only its own fields');

r = await call('/elevator-watch-subscribe', 'POST', CASH);
A(r.status == 200, 'cash target subscribe');
rec = JSON.parse(store.get('ewatch:o@x.com'));
let P = rec.pend[AID];
A(P.kind === 'cash' && P.ewid === EW && P.crop === 'corn' && P.period === '2026-10' && P.plabel === 'Oct 2026' && P.direction === 'above' && P.target_cents === 450 && P.m === 0, 'pending carries every option field');

// per-address cap counts option alerts too: 4 pending now, one more fits, the sixth does not
r = await call('/elevator-watch-subscribe', 'POST', Object.assign({}, CASH, { wid: 'a0000004' }));
A(r.status == 200, 'fifth alert fits');
r = await call('/elevator-watch-subscribe', 'POST', Object.assign({}, CASH, { wid: 'a0000005' }));
A(r.status == 429, 'sixth alert refused: cap of 5 per address');

// confirm keeps the options and says what it will do
t = tok('o@x.com|ec|' + AID);
r = await call(`/elevator-watch-confirm?e=o@x.com&w=${AID}&t=${t}`, 'POST');
let ctext = await r.text();
A(ctext.includes('one email when a new posting reaches your target'), 'confirm page says one-shot');
rec = JSON.parse(store.get('ewatch:o@x.com'));
A(rec.w[AID].kind === 'cash' && rec.w[AID].target_cents === 450 && rec.w[AID].k === null && rec.w[AID].label === CASH.label, 'confirmed alert keeps its options, baseline pending');

// mark records a level and keeps the options
r = await call('/elevator-watch-mark?token=tok', 'POST', { email: 'o@x.com', wid: AID, k: 'x', s: { pa: '2026-10-03T18:00:00Z', v: 436 } });
rec = JSON.parse(store.get('ewatch:o@x.com'));
A(rec.w[AID].kind === 'cash' && rec.w[AID].target_cents === 450 && rec.w[AID].s.v === 436 && rec.w[AID].k === 'x', 'mark keeps option fields');

// fired removes a one-shot, and a second fired is skipped
r = await call('/elevator-watch-mark?token=tok', 'POST', { email: 'o@x.com', wid: AID, fired: true });
A((await r.json()).ok && !(AID in JSON.parse(store.get('ewatch:o@x.com')).w), 'fired removes the alert');
r = await call('/elevator-watch-mark?token=tok', 'POST', { email: 'o@x.com', wid: AID, fired: true });
A((await r.json()).skipped, 'fired twice is skipped');

// move: confirm, mark (re-arm) keeps move_cents
t = tok('o@x.com|ec|a0000003');
r = await call(`/elevator-watch-confirm?e=o@x.com&w=a0000003&t=${t}`, 'POST');
A((await r.text()).includes('100¢ or more'), 'move confirm page names the size');
await call('/elevator-watch-mark?token=tok', 'POST', { email: 'o@x.com', wid: 'a0000003', k: 'y', s: { pa: 'p', v: -60 } });
rec = JSON.parse(store.get('ewatch:o@x.com'));
A(rec.w.a0000003.kind === 'move' && rec.w.a0000003.move_cents === 100 && rec.w.a0000003.s.v === -60, 're-armed move keeps its size');

// the older page's body (no kind) is still the plain watch
r = await call('/elevator-watch-subscribe', 'POST', { email: 'old@x.com', wid: WID, label: LABEL });
P = JSON.parse(store.get('ewatch:old@x.com')).pend[WID];
A(r.status == 200 && !('kind' in P) && Object.keys(P).sort().join() === 'label,m,ts', 'old page body stores exactly what v5.1 stored');

// ZIP-wide cash alert (components/cb-alerts.js, scripts/send_zip_alert.py): an
// ordinary kind=cash alert whose ewid is "ab" + ZIP + 3-digit miles. Stored by
// the v5.3 rules unchanged; only the confirm sentence knows it re-arms (v5.6).
const ZB = { email: 'zip@x.com', wid: 'b1c2d3e4', label: 'Corn at or above $4.50 within 25 mi of ZIP 54728', kind: 'cash',
  ewid: 'ab54728025', crop: 'corn', period: 'nearby', plabel: 'nearest delivery', direction: 'above', target_cents: 450 };
r = await call('/elevator-watch-subscribe', 'POST', ZB);
P = JSON.parse(store.get('ewatch:zip@x.com')).pend.b1c2d3e4;
A(r.status == 200 && P.ewid === 'ab54728025' && P.period === 'nearby' && P.target_cents === 450, 'worker stores a ZIP alert as it is');
t = tok('zip@x.com|ec|b1c2d3e4');
r = await call(`/elevator-watch-confirm?e=zip@x.com&w=b1c2d3e4&t=${t}`, 'POST');
ctext = await r.text();
A(ctext.includes('within 25 mi of ZIP 54728') && ctext.includes('one crosses again') && !ctext.includes('clears itself'), 'ZIP confirm page says it re-arms');
await call('/elevator-watch-mark?token=tok', 'POST', { email: 'zip@x.com', wid: 'b1c2d3e4', k: 'on|p|462', s: { on: true, v: 462, pa: 'p' } });
rec = JSON.parse(store.get('ewatch:zip@x.com'));
A(rec.w.b1c2d3e4.ewid === 'ab54728025' && rec.w.b1c2d3e4.s.on === true && rec.w.b1c2d3e4.k === 'on|p|462', 'state mark keeps the ZIP alert');
r = await call('/elevator-watch-subscribe', 'POST', Object.assign({}, ZB, { wid: 'b1c2d3e5', ewid: 'ab5472802' }));
A(r.status == 200, 'a 9-char ewid is still a hex id to the worker; the sender ignores it (parse_ewid)');

console.log('elevator-watch worker ok', ok, 'checks');
