// Runs the v5.43 "Email me this design" routes of workers/subs-worker.js
// (POST /rp-remind, GET /rp-remind/list, POST /rp-remind/mark, /rp-remind/stop)
// against an in-memory KV and a stand-in for GitHub's dispatch API. No network.
//   node scripts/test_rp_remind_worker.mjs
// The design codes are the page's own (components/rain-print.js encodeCode).
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url'; import vm from 'node:vm';
const here = path.dirname(new URL(import.meta.url).pathname);
const src = path.resolve(here, '..', 'workers', 'subs-worker.js');
const tmp = path.join(os.tmpdir(), 'subs-worker-rpr-test-' + process.pid + '.mjs');
fs.copyFileSync(src, tmp);
const w = (await import(pathToFileURL(tmp).href)).default;
fs.unlinkSync(tmp);

const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob }; ctx.window = ctx;
vm.runInNewContext(fs.readFileSync(path.resolve(here, '..', 'components', 'rain-print.js'), 'utf8'), ctx);
const RP = ctx.RainPrint;

const store = new Map(), opts = new Map(), dispatched = [];
const env = { UNSUB_SECRET: 'sec', LIST_TOKEN: 'tok', GH_DISPATCH_TOKEN: 'gh', SUBS: {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v, o) { store.set(k, v); opts.set(k, o || null); },
  async delete(k) { store.delete(k); },
  async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }; } } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  if (String(u).startsWith('https://api.github.com/')) { dispatched.push({ url: String(u), body: JSON.parse(o.body) }); return new Response(null, { status: 204 }); }
  throw new Error('no network in this test: ' + u);
};
let ipN = 0;
const post = (b, h = {}) => w.fetch(new Request('https://x.dev/rp-remind', { method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', Origin: 'https://agsist.com', 'CF-Connecting-IP': '10.2.0.' + (++ipN) }, h),
  body: typeof b === 'string' ? b : JSON.stringify(b) }), env);
const admin = (p, m = 'GET', b, auth = 'Bearer tok') => w.fetch(new Request('https://x.dev' + p, { method: m,
  headers: Object.assign({ 'Content-Type': 'application/json', Origin: 'https://agsist.com' }, auth ? { Authorization: auth } : {}),
  body: b ? JSON.stringify(b) : undefined }), env);
let n = 0; const A = (c, m) => { if (!c) { console.log('FAIL', m); process.exit(1); } n++; };
const recs = () => [...store.keys()].filter(k => k.startsWith('rpr:')).sort();

const design = { place: 'Chetek, WI', station: '471667 2', year: 2025, style: 'r1', name: 'Gustum Farm', markers: [{ date: '2025-04-01', label: 'Moved in' }] };
const code = RP.encodeCode(design);

// the ask: stored once, the job started once, no email in the answer
let r = await post({ email: 'Reader@Farm.com', code, ref: '', daily: false, source: 'page:rain-print' });
let j = await r.json();
A(r.status === 200 && j.ok === true && j.job === 'started', 'stored and the job started: ' + JSON.stringify(j));
A(r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com', 'CORS for agsist.com');
A(!JSON.stringify(j).includes('@'), 'the answer never echoes the address');
A(recs().length === 1, 'one record');
const k = recs()[0], rec = JSON.parse(store.get(k));
A(/^rpr:[0-9a-f]{16}:[0-9a-f]{16}$/.test(k), 'key rpr:<who>:<design>, no address in the key');
A(rec.email === 'reader@farm.com' && rec.code === code && rec.ref === '' && rec.sent === null && rec.reminded === null && rec.done === null, 'record fields');
A(opts.get(k) && opts.get(k).expiration > Date.now() / 1000 + 6.9 * 86400 && opts.get(k).expiration < Date.now() / 1000 + 7.1 * 86400, 'kept 7 days');
A(dispatched.length === 1 && dispatched[0].url.endsWith('/actions/workflows/rp-design-email.yml/dispatches'), 'dispatches the design email job');
A(dispatched[0].body.ref === 'main' && dispatched[0].body.inputs.dry_run === 'true', 'a dry run unless RP_DESIGN_EMAIL_LIVE is 1');
A(!store.has('sub:reader@farm.com'), 'not on the Daily: the box was not ticked');

// the same address and design again: nothing new, no second job
r = await post({ email: 'reader@farm.com', code });
j = await r.json();
A(r.status === 200 && j.dup === true && recs().length === 1 && dispatched.length === 1, 'the same ask again changes nothing');

// the Daily box ticked: joins the Daily too; a live worker asks for a live run
env.RP_DESIGN_EMAIL_LIVE = '1';
const other = RP.encodeCode(Object.assign({}, design, { year: 2012 }));
r = await post({ email: 'reader@farm.com', code: other, daily: true, source: 'page:rain-print' });
A(r.status === 200 && store.has('sub:reader@farm.com'), 'daily:true joins the Daily');
A(dispatched.length === 2 && dispatched[1].body.inputs.dry_run === 'false', 'live when RP_DESIGN_EMAIL_LIVE is 1');
delete env.RP_DESIGN_EMAIL_LIVE;

// refusals
for (const [b, why, st] of [[{ email: 'nope', code }, 'bad email', 400], [{ email: 'a@b.com', code: 'AAAAAAAAAAAA' }, 'not a design code', 400],
    [{ email: 'a@b.com', code: 'GIFT-' + code }, 'a gift code', 400], [{ email: 'a@b.com', code, ref: 'RPS-ILOU1' }, 'a bad ref', 400],
    [{ email: 'a@b.com', code, ref: 'GIFT-RPS-K7Q2M' }, 'a gift ref', 400], [{ email: 'a@b.com', code: code + 'x'.repeat(3000) }, 'too large', 413]]) {
  r = await post(b); A(r.status === st, 'refuses ' + why + ': ' + r.status);
}
r = await post({ email: 'a@b.com', code, ref: 'RPS-K7Q2M' }); A(r.status === 200 && JSON.parse(store.get(recs().find(x => JSON.parse(store.get(x)).email === 'a@b.com'))).ref === 'RPS-K7Q2M', 'a long design keeps its RPS ref');
r = await post({ email: 'bot@b.com', code, _gotcha: 'x' }); A(r.status === 200 && !recs().some(x => JSON.parse(store.get(x)).email === 'bot@b.com'), 'the honeypot stores nothing');
r = await w.fetch(new Request('https://x.dev/rp-remind', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ email: 'a@b.com', code }) }), env);
A(r.status === 403, 'another site cannot post');

// at most 5 designs an address at a time
for (let y = 2000; y < 2010; y++) await post({ email: 'many@b.com', code: RP.encodeCode(Object.assign({}, design, { year: y })) });
A(recs().filter(x => JSON.parse(store.get(x)).email === 'many@b.com').length === 5, 'five designs an address at most');

// list and mark: Sig only
r = await admin('/rp-remind/list', 'GET', null, null); A(r.status === 403, 'list needs the token');
r = await admin('/rp-remind/list?token=tok', 'GET', null, null); A(r.status === 403, 'never ?token= (Bearer only)');
r = await admin('/rp-remind/list'); j = await r.json();
A(r.status === 200 && j.ok && j.rows.length === recs().length, 'list');
const row = j.rows.find(x => x.key === k);
A(row.email === 'reader@farm.com' && row.code === code && /^[0-9a-f]{16}$/.test(row.stop_t), 'row with the stop token');

r = await admin('/rp-remind/mark', 'POST', { key: k, stage: 'sent' }, null); A(r.status === 403, 'mark needs the token');
r = await admin('/rp-remind/mark', 'POST', { key: k, stage: 'sent' }); j = await r.json();
A(j.ok && j.already === false && JSON.parse(store.get(k)).sent.at, 'sent marked');
r = await admin('/rp-remind/mark', 'POST', { key: k, stage: 'sent' }); j = await r.json();
A(j.ok && j.already === true, 'sent once: a second mark says already');
r = await admin('/rp-remind/mark', 'POST', { key: k, stage: 'done', why: 'paid' }); j = await r.json();
A(j.ok && JSON.parse(store.get(k)).done.why === 'paid', 'done (a paid order matched)');
r = await admin('/rp-remind/mark', 'POST', { key: k, stage: 'reminded' }); j = await r.json();
A(j.ok && j.already === true && !JSON.parse(store.get(k)).reminded, 'no reminder after done: a paid order wins');
for (const b of [{ key: 'rpr:zz', stage: 'sent' }, { key: k, stage: 'paid' }]) { r = await admin('/rp-remind/mark', 'POST', b); A(r.status === 400, 'mark refuses ' + JSON.stringify(b)); }

// the stop link: asks first, then stops; a wrong token does nothing
const k2 = recs().find(x => JSON.parse(store.get(x)).email === 'a@b.com');
const t2 = (await (await admin('/rp-remind/list')).json()).rows.find(x => x.key === k2).stop_t;
r = await w.fetch(new Request('https://x.dev/rp-remind/stop?k=' + k2 + '&t=0000000000000000'), env);
A(/isn.t valid/.test(await r.text()), 'a wrong stop token');
r = await w.fetch(new Request('https://x.dev/rp-remind/stop?k=' + k2 + '&t=' + t2), env);
A(/Stop the reminder/.test(await r.text()) && !JSON.parse(store.get(k2)).done, 'GET only asks');
r = await w.fetch(new Request('https://x.dev/rp-remind/stop?k=' + k2 + '&t=' + t2, { method: 'POST' }), env);
A(/Stopped/.test(await r.text()) && JSON.parse(store.get(k2)).done.why === 'stopped', 'POST stops it');

// no address in anything the worker logs
const logs = [];
const keep = { log: console.log, error: console.error, warn: console.warn };
console.log = console.error = console.warn = (...a) => logs.push(a.join(' '));
await post({ email: 'quiet@b.com', code: RP.encodeCode(Object.assign({}, design, { year: 1999 })) });
await admin('/rp-remind/list');
Object.assign(console, keep);
A(!logs.some(l => l.includes('@')), 'no address in the log');

globalThis.fetch = realFetch;
console.log('rp-remind worker: ' + n + ' checks pass');
