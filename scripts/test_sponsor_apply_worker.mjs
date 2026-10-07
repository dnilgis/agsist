// Runs the v5.5 sponsor-application routes of workers/subs-worker.js against an in-memory KV. No network.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const src = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'workers', 'subs-worker.js');
const tmp = path.join(os.tmpdir(), 'subs-worker-sponsor-test.mjs');
fs.copyFileSync(src, tmp);
const w = (await import(pathToFileURL(tmp).href)).default;
const store = new Map();
const env = { UNSUB_SECRET: 'sec', LIST_TOKEN: 'tok', SUBS: {
  async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, v); },
  async delete(k) { store.delete(k); },
  async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } } };
const call = (p, m = 'GET', b) => w.fetch(new Request('https://x.dev' + p, { method: m,
  headers: { 'Content-Type': 'application/json', Origin: 'https://agsist.com' }, body: b ? JSON.stringify(b) : undefined }), env);
const tok = s => crypto.createHmac('sha256', 'sec').update(s.toLowerCase()).digest('hex').slice(0, 16);
let n = 0; const A = (c, m) => { if (!c) { console.log('FAIL', m); process.exit(1); } n++; };
const rec = id => JSON.parse(store.get('sapp:' + id));
const PNG = 'data:image/png;base64,' + Buffer.from('fakepng').toString('base64');
const good = { tier: 'page', slot: 'spray', company: 'Smith Seed', contact: 'Al Smith', email: 'Al@Smith.com', phone: '715-555-0100',
  headline: 'Seed that yields', body: 'Local seed, local service.', url: 'smithseed.com', logo: PNG, terms: true };

let r = await call('/sponsor-apply', 'POST', good); let j = await r.json();
A(r.status === 200 && /^[0-9a-f]{12}$/.test(j.id), 'apply ok');
const id = j.id; let a = rec(id);
A(a.status === 'pending' && a.email === 'al@smith.com' && a.url === 'https://smithseed.com' && a.slot === 'spray', 'stored, email lowercased, url completed');
A(store.get('sapp-logo:' + id) === PNG && a.logo_len === PNG.length && !('logo' in a), 'logo kept apart');
for (const [patch, why] of [[{ terms: false }, 'terms'], [{ company: 'x' }, 'company'], [{ url: 'javascript:alert(1)' }, 'url'],
    [{ email: 'nope' }, 'email'], [{ tier: 'banner' }, 'tier'], [{ slot: '../etc' }, 'slot'], [{ headline: '' }, 'headline'],
    [{ logo: 'data:image/svg+xml;base64,PHN2Zz4=' }, 'svg refused'], [{ logo: 'data:image/png;base64,' + 'A'.repeat(400000) }, 'logo size']]) {
  r = await call('/sponsor-apply', 'POST', Object.assign({}, good, patch)); A(r.status === 400, 'rejects ' + why);
}
r = await call('/sponsor-apply', 'POST', Object.assign({}, good, { tier: 'supporter', headline: '', slot: 'anything' }));
j = await r.json(); A(r.status === 200 && rec(j.id).slot === 'footer', 'supporter: no headline needed, slot fixed');
r = await call('/sponsor-apply', 'POST', Object.assign({}, good, { _gotcha: 'x', email: 'bot@x.com' }));
A(![...store.values()].some(v => v.includes('bot@x.com')), 'honeypot');
r = await call('/sponsor-apply', 'POST', good); A(r.status === 200, 'third open ok');
r = await call('/sponsor-apply', 'POST', good); A(r.status === 429, 'fourth open refused');

// confirm: GET changes nothing, bad token refused, POST confirms
let t = tok(id + '|sc');
r = await call(`/sponsor-confirm?i=${id}&t=${t}`); A((await r.text()).includes('Yes, send it to Sig') && rec(id).status === 'pending', 'confirm GET is a button');
r = await call(`/sponsor-confirm?i=${id}&t=0000000000000000`, 'POST'); A((await r.text()).includes("isn't valid") && rec(id).status === 'pending', 'bad token');
r = await call(`/sponsor-confirm?i=${id}&t=${t}`, 'POST'); A(rec(id).status === 'confirmed', 'confirmed');

// Sig's decisions: the applicant's confirm token cannot approve
r = await call(`/sponsor-decide?i=${id}&d=approve&t=${t}`, 'POST'); A(rec(id).status === 'confirmed', 'confirm token cannot approve');
r = await call(`/sponsor-decide?i=${id}&d=end&t=${tok(id + '|sd|end')}`, 'POST'); A(rec(id).status === 'confirmed', 'cannot end what is not live');
const ap = tok(id + '|sd|approve');
r = await call(`/sponsor-decide?i=${id}&d=approve&t=${ap}`); A(rec(id).status === 'confirmed', 'approve GET changes nothing');
r = await call(`/sponsor-decide?i=${id}&d=approve&t=${ap}`, 'POST'); A(rec(id).status === 'approved', 'approved');

// the job: token required, logo apart, only its own moves
r = await call('/sponsor-apps'); A(r.status === 403, 'list needs token');
r = await call('/sponsor-apps?token=tok'); j = await r.json(); A(j.length === 3 && j.every(x => !('logo' in x)), 'list without logo bytes');
r = await call(`/sponsor-logo?token=tok&i=${id}`); A((await r.json()).logo === PNG, 'logo');
r = await call('/sponsor-mark?token=tok', 'POST', { id, set: { status: 'declined' } }); A(r.status === 409, 'job cannot decline');
r = await call('/sponsor-mark?token=tok', 'POST', { id, set: { status: 'live', start: '2026-10-08', slug: 'smith-seed', m: 1 } });
a = rec(id); A(a.status === 'live' && a.start === '2026-10-08' && a.slug === 'smith-seed' && a.m === 1, 'go live');
r = await call(`/sponsor-decide?i=${id}&d=end&t=${tok(id + '|sd|end')}`, 'POST'); A(rec(id).status === 'ending', 'Sig ends it');
r = await call('/sponsor-mark?token=tok', 'POST', { id, set: { status: 'ended' } }); A(rec(id).status === 'ended' && !store.has('sapp-logo:' + id), 'ended, logo dropped');

// expiry: a pending application older than 14 days cannot be confirmed
r = await call('/sponsor-apply', 'POST', Object.assign({}, good, { email: 'old@x.com' })); const old = (await r.json()).id;
const o = rec(old); o.ts -= 15 * 864e5; store.set('sapp:' + old, JSON.stringify(o));
r = await call(`/sponsor-confirm?i=${old}&t=${tok(old + '|sc')}`, 'POST'); A((await r.text()).includes('expired') && !store.has('sapp:' + old), 'expired and removed');

// everything older still answers
r = await call('/subscribe', 'POST', { email: 'c@x.com' }); A(store.has('sub:c@x.com'), 'v4 subscribe intact');
console.log('sponsor worker ok', n, 'checks');
