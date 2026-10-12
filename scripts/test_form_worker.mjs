// Runs the v5.8/v5.9/v5.10 form routes of workers/subs-worker.js (/form, /form-list, /form-mark, /count forms)
// against an in-memory KV. No network.   node scripts/test_form_worker.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url';
const src = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'workers', 'subs-worker.js');
const tmp = path.join(os.tmpdir(), 'subs-worker-form-test-' + process.pid + '.mjs');
fs.copyFileSync(src, tmp);
const w = (await import(pathToFileURL(tmp).href)).default;
fs.unlinkSync(tmp);
const store = new Map(), opts = new Map();
const env = { UNSUB_SECRET: 'sec', LIST_TOKEN: 'tok', SUBS: {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v, o) { store.set(k, v); opts.set(k, o || null); },
  async delete(k) { store.delete(k); },
  async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }; } } };
let ipN = 0;
const post = (b, h = {}) => w.fetch(new Request('https://x.dev/form', { method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', Origin: 'https://agsist.com', 'CF-Connecting-IP': '10.0.0.' + (++ipN) }, h),
  body: typeof b === 'string' ? b : JSON.stringify(b) }), env);
const call = (p, m = 'GET', b) => w.fetch(new Request('https://x.dev' + p, { method: m,
  headers: { 'Content-Type': 'application/json', Origin: 'https://agsist.com' }, body: b ? JSON.stringify(b) : undefined }), env);
let n = 0; const A = (c, m) => { if (!c) { console.log('FAIL', m); process.exit(1); } n++; };
const forms = () => [...store.keys()].filter(k => k.startsWith('form:'));

const claim = { kind: 'claim', elevator: 'Chetek Co-op', town: 'Chetek', state: 'wi', contact_name: 'Al Smith', role: 'Manager',
  email: 'Al@Chetek.coop', phone: '715-555-0100', bid_page_url: 'chetekcoop.com/bids', hosted_board: 'yes', page: '/elevators#claim', extra: 'dropped' };

let r = await post(claim); let j = await r.json();
A(r.status === 200 && j.ok === true, 'claim stored');
A(r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com', 'CORS for agsist.com');
let k = forms()[0]; let rec = JSON.parse(store.get(k));
A(/^form:claim:\d{13}:[0-9a-f]{8}$/.test(k), 'key form:claim:<ts>:<rand>');
A(rec.email === 'al@chetek.coop' && rec.state === 'WI' && rec.bid_page_url === 'https://chetekcoop.com/bids' && rec.hosted_board === 'yes', 'cleaned');
A(rec.n === 0 && rec.kind === 'claim' && !('extra' in rec), 'unknown field dropped, not yet mailed');
A(opts.get(k) && opts.get(k).expirationTtl === 365 * 24 * 3600, 'kept a year');
r = await post(Object.assign({}, claim, { hosted_board: undefined }));
A(JSON.parse(store.get(forms()[1])).hosted_board === 'no', 'unticked box is "no"');

for (const [patch, why] of [[{ email: 'nope' }, 'email'], [{ elevator: '' }, 'required elevator'], [{ state: 'Wisconsin' }, 'state'],
    [{ bid_page_url: 'javascript:alert(1)' }, 'url'], [{ town: 'x'.repeat(81) }, 'too long'], [{ kind: 'other' }, 'kind'],
    [{ kind: '__proto__' }, 'proto kind'], [{ kind: 'toString' }, 'inherited kind']]) {
  r = await post(Object.assign({}, claim, patch)); A(r.status === 400, 'rejects ' + why);
}
r = await post('[1,2]'); A(r.status === 400, 'array body');
r = await post('{nope'); A(r.status === 400, 'bad json');
r = await post(Object.assign({}, claim, { page: 'x'.repeat(17000) })); A(r.status === 413, 'over 16 KB');
r = await post(claim, { Origin: 'https://evil.example' }); A(r.status === 403, 'foreign origin refused');
r = await post(claim, { Origin: '' }); A(r.status === 403, 'no origin refused');
const before = forms().length;
r = await post(Object.assign({}, claim, { _gotcha: 'x', email: 'bot@x.com' }));
A(r.status === 200 && forms().length === before, 'honeypot: ok answer, nothing stored');

// sponsor feedback keeps line breaks, email optional
r = await post({ kind: 'sponsor-feedback', request: 'Approval', sponsor: 'Apex', proof: 'AB12', message: 'Line one\r\nLine two', subject: 'Approved' });
A(r.status === 200, 'sponsor feedback stored');
rec = JSON.parse(store.get(forms().find(x => x.startsWith('form:sponsor-feedback:'))));
A(rec.message === 'Line one\nLine two' && !('email' in rec), 'message keeps lines; no email key');
r = await post({ kind: 'sponsor-feedback', request: 'Note', message: '' }); A(r.status === 400, 'empty message refused');
r = await post({ kind: 'sponsor-feedback', request: 'Note', message: 'm'.repeat(6001) }); A(r.status === 400, 'message cap');
r = await post({ kind: 'atlas-feedback', email: 'a@farm.com', source: 'farmland-atlas' }); A(r.status === 200, 'atlas stored');
r = await post({ kind: 'atlas-feedback', email: '' }); A(r.status === 400, 'atlas needs email');

// v5.9/v5.10 rain print orders: address required for the print and the framed print, dropped for the file
const rp = { kind: 'rain-print-order', name: 'Jane Olson', email: 'Jane@Farm.com', choice: 'print12x18',
  address: '12 Main St\r\nChetek WI 54728', notes: 'Gift', design_code: 'MXxDaGV0ZWsgV0l8MTIzfDIwMjV8c3AwYXw',
  design_url: 'https://agsist.com/rain-print?place=Chetek%2C+WI&year=2025&layout=staircase', page: '/rain-print', extra: 'x' };
r = await post(rp); A(r.status === 200, 'rain print order stored');
rec = JSON.parse(store.get(forms().find(x => x.startsWith('form:rain-print-order:'))));
A(rec.email === 'jane@farm.com' && rec.address === '12 Main St\nChetek WI 54728' && rec.choice === 'print12x18' && !('extra' in rec), 'rain print order cleaned');
A(/^form:rain-print-order:\d{13}:[0-9a-f]{8}$/.test(forms().find(x => x.startsWith('form:rain-print-order:'))), 'rain print key matches FORM_KEY_RE shape');
/* The newest record is the key that was not there before the post: two posts in the same
   millisecond sort by their random suffix, so "last in sort order" picked the wrong one at times. */
const rpKeys = () => forms().filter(x => x.startsWith('form:rain-print-order:'));
const newKey = (before) => { const k = rpKeys().filter(x => !before.includes(x)); A(k.length === 1, 'exactly one new rain print record'); return k[0]; };
let rpBefore = rpKeys();
r = await post(Object.assign({}, rp, { choice: 'digital' })); A(r.status === 200, 'digital order stored');
rec = JSON.parse(store.get(newKey(rpBefore)));
A(rec.choice === 'digital' && !('address' in rec), 'digital order keeps no address');
r = await post(Object.assign({}, rp, { choice: 'digital', address: '' })); A(r.status === 200, 'digital order needs no address');
rpBefore = rpKeys();
r = await post(Object.assign({}, rp, { choice: 'framed12x18' })); A(r.status === 200, 'framed order stored');
rec = JSON.parse(store.get(newKey(rpBefore)));
A(rec.choice === 'framed12x18' && rec.address === '12 Main St\nChetek WI 54728', 'framed order keeps its address');
for (const [patch, why] of [[{ address: '' }, 'print needs an address'], [{ choice: 'framed12x18', address: '' }, 'framed print needs an address'],
    [{ choice: 'print18x24' }, '18 x 24 is no longer offered'], [{ address: '   ' }, 'blank address'],
    [{ choice: 'canvas' }, 'unknown choice'], [{ choice: '' }, 'choice required'], [{ name: '' }, 'name required'],
    [{ email: 'x' }, 'email'], [{ design_url: 'https://evil.example/rain-print?x=1' }, 'design url off-site'],
    [{ design_url: 'https://agsist.com/rain-print?x="><script>' }, 'design url odd characters'],
    [{ design_url: 'https://agsist.com/elevators?x=1' }, 'design url other page'], [{ design_url: '' }, 'design url required'],
    [{ design_code: 'abc def' }, 'design code characters'], [{ design_code: '' }, 'design code required'],
    [{ notes: 'n'.repeat(2001) }, 'notes cap'], [{ address: 'a'.repeat(601) }, 'address cap']]) {
  r = await post(Object.assign({}, rp, patch)); A(r.status === 400, 'rain print rejects ' + why);
}
A(!('gift_january' in JSON.parse(store.get(forms().filter(x => x.startsWith('form:rain-print-order:'))[0]))), 'an ordinary order carries no gift key');

// v5.10 gift orders: this year's print, made in January
// newest by insertion: two posts in the same millisecond sort by their random suffix
const newestRp = () => JSON.parse(store.get(forms().filter(x => x.startsWith('form:rain-print-order:')).pop()));
const gift = Object.assign({}, rp, { choice: 'framed12x18', gift_january: true, gift_to: 'Dad Olson', gift_deliver: 'recipient',
  gift_message: 'For every inch\r\nyou farmed', design_code: 'GIFT-MXxDaGV0ZWsgV0l8MTIzfDIwMjZ8c3AwYXw',
  design_url: 'https://agsist.com/rain-print?place=Chetek%2C+WI&year=2026&layout=staircase&gift=1' });
r = await post(gift); A(r.status === 200, 'gift order stored');
rec = newestRp();
A(rec.gift_january === 'yes' && rec.gift_to === 'Dad Olson' && rec.gift_deliver === 'recipient' && rec.gift_message === 'For every inch\nyou farmed', 'gift fields kept, message keeps its line');
A(rec.design_code.startsWith('GIFT-') && rec.address.includes('Main St') && !('gift_email' in rec), 'GIFT- code kept; a framed print ships to the address, no recipient email kept');
r = await post(Object.assign({}, gift, { gift_january: 'yes', gift_deliver: '' })); A(r.status === 200, 'gift flag as "yes", no deliver choice');
A(newestRp().gift_deliver === 'buyer', 'deliver defaults to the buyer');
r = await post(Object.assign({}, gift, { choice: 'digital', gift_email: 'Dad@Farm.com' })); A(r.status === 200, 'gift file straight to the recipient');
rec = newestRp(); A(rec.gift_email === 'dad@farm.com' && !('address' in rec), 'recipient email kept and cleaned for a gift file');
r = await post(Object.assign({}, rp, { gift_to: 'Dad', gift_message: 'hi', gift_deliver: 'recipient', gift_email: 'd@x.com' })); A(r.status === 200, 'gift fields without the flag');
rec = newestRp(); A(!Object.keys(rec).some(k => k.startsWith('gift_')), 'gift fields dropped without gift_january');
r = await post(Object.assign({}, gift, { gift_january: false })); A(r.status === 200 && !('gift_to' in newestRp()), 'gift_january false is an ordinary order');
for (const [patch, why] of [[{ gift_deliver: 'neighbor' }, 'unknown deliver'], [{ gift_message: 'm'.repeat(241) }, 'gift message cap'],
    [{ gift_to: 't'.repeat(81) }, 'gift_to cap'], [{ choice: 'digital', gift_email: '' }, 'gift file to the recipient needs their email'],
    [{ choice: 'digital', gift_email: 'nope' }, 'recipient email checked'], [{ design_code: 'GIFT MX' }, 'gift code characters']]) {
  r = await post(Object.assign({}, gift, patch)); A(r.status === 400, 'gift order rejects ' + why);
}
const rpStored = forms().filter(x => x.startsWith('form:rain-print-order:')).length;

// rate limit: 8 per IP an hour, all kinds together
const same = { 'CF-Connecting-IP': '192.0.2.9' };
let codes = [];
for (let i = 0; i < 9; i++) codes.push((await post({ kind: 'atlas-feedback', email: 'r' + i + '@farm.com' }, same)).status);
A(codes.slice(0, 8).every(c => c === 200) && codes[8] === 429, 'ninth post in the hour refused ' + codes);
A(![...store.keys()].some(x => x.includes('192.0.2.9')) && ![...store.values()].some(v => String(v).includes('192.0.2.9')), 'IP never stored in the clear');
const rl = [...store.keys()].find(x => x.startsWith('rl:form:'));
A(rl && opts.get(rl).expirationTtl === 7200, 'rate counter expires');
r = await post({ kind: 'claim', email: 'bad' }, same); A(r.status === 400, 'validation answers before the rate check');

// the digest job's routes
r = await call('/form-list'); A(r.status === 403, 'list needs token');
r = await call('/form-list?token=bad'); A(r.status === 403, 'bad token');
r = await call('/form-list?token=tok'); j = await r.json();
A(Array.isArray(j) && j.length === forms().length && j.every(x => x.key && x.kind), 'list all with keys');
A(j.every((x, i) => i === 0 || j[i - 1].ts <= x.ts), 'oldest first');
r = await call('/form-list?token=tok&kind=claim'); j = await r.json(); A(j.length === 2 && j.every(x => x.kind === 'claim'), 'by kind');
r = await call('/form-list?token=tok&kind=nope'); A(r.status === 400, 'unknown kind');
r = await call('/form-mark?token=tok', 'POST', { keys: [j[0].key, 'sub:x@y.com', 'form:claim:../x'] }); let m = await r.json();
A(m.ok && m.marked === 1, 'mark only form keys');
A(JSON.parse(store.get(j[0].key)).n === 1 && opts.get(j[0].key).expiration > Date.now() / 1000 + 360 * 86400, 'marked, expiry kept');
r = await call('/form-list?token=tok&kind=claim&new=1'); A((await r.json()).length === 1, 'new=1 skips mailed');
r = await call('/form-mark?token=tok', 'POST', { keys: [j[0].key] }); A((await r.json()).marked === 0, 'mark twice is a no-op');
r = await call('/form-mark', 'POST', { keys: [j[1].key] }); A(r.status === 403, 'mark needs token');

// /count
r = await call('/count?token=tok'); j = await r.json();
A(j.forms && j.forms.claim === 2 && j.forms['sponsor-feedback'] === 1 && j.forms['atlas-feedback'] === 9, '/count forms ' + JSON.stringify(j.forms));
A(rpStored === 9 && j.forms['rain-print-order'] === 9, '/count forms rain-print-order ' + JSON.stringify(j.forms));
A(!JSON.stringify(j).includes('@'), '/count carries no address');

// older routes still answer the same
r = await call('/subscribe', 'POST', { email: 'c@x.com' }); A(store.has('sub:c@x.com'), 'subscribe intact');
r = await call('/nope'); A(r.status === 404, 'unknown path 404');
r = await call('/form'); A(r.status === 404, 'GET /form is 404');
console.log('form worker ok', n, 'checks');
