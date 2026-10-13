// Runs the v5.8/v5.9/v5.10/v5.12 form routes of workers/subs-worker.js (/form, /form-list, /form-mark, /count forms)
// and the v5.14 Rain Print short links (POST /rp-short, GET /rp-short/<id>)
// against an in-memory KV. No network.   node scripts/test_form_worker.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url'; import crypto from 'node:crypto';
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
// v5.13: an approval must carry the portal link's r and its key k = hmac16("sponsor-portal|" + r)
const skey = (r_) => crypto.createHmac('sha256', 'sec').update(('sponsor-portal|' + r_).toLowerCase()).digest('hex').slice(0, 16);
const R1 = 'apex-c1c1e09865171cd1';
r = await post({ kind: 'sponsor-feedback', request: 'Approval', sponsor: 'Apex', proof: 'AB12', message: 'Line one\r\nLine two', subject: 'Approved', r: R1, k: skey(R1) });
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

// v5.12 Rain Print business quotes (after /count above, so those counts stay as they were)
const rbKeys = () => forms().filter(x => x.startsWith('form:rain-print-business:'));
const rbNew = (before) => { const k = rbKeys().filter(x => !before.includes(x)); A(k.length === 1, 'exactly one new business record'); return JSON.parse(store.get(k[0])); };
const biz = { kind: 'rain-print-business', business: 'Chetek Co-op', name: 'Al Smith', email: 'Al@Chetek.Coop', phone: '715-555-0100',
  quantity: '12', product: 'framed', towns: 'Chetek, WI 2025\r\nRice Lake, WI 2012', ship: 'each', notes: 'Card in each box', page: '/rain-print#rp-biz',
  extra: 'dropped', design_url: 'https://agsist.com/rain-print?x=1', gift_january: true };
let rbBefore = rbKeys();
r = await post(biz); j = await r.json();
A(r.status === 200 && j.ok === true, 'business quote stored');
rec = rbNew(rbBefore);
A(/^form:rain-print-business:\d{13}:[0-9a-f]{8}$/.test(rbKeys()[0]), 'business key matches FORM_KEY_RE shape');
A(rec.kind === 'rain-print-business' && rec.n === 0 && rec.email === 'al@chetek.coop' && rec.quantity === '12' && rec.product === 'framed' &&
  rec.ship === 'each' && rec.towns === 'Chetek, WI 2025\nRice Lake, WI 2012' && rec.phone === '715-555-0100', 'business quote cleaned, towns keep their lines');
A(!('extra' in rec) && !('design_url' in rec) && !('gift_january' in rec), 'business: unknown fields dropped, order fields not carried over');
const rbk = rbKeys()[0];
A(opts.get(rbk) && opts.get(rbk).expirationTtl === 365 * 24 * 3600, 'business quote kept a year');
rbBefore = rbKeys();
r = await post(Object.assign({}, biz, { phone: '', notes: '', quantity: 500, product: 'not-sure', ship: 'not-sure' })); A(r.status === 200, 'business: optional fields empty, quantity 500 as a number');
rec = rbNew(rbBefore); A(rec.quantity === '500' && !('phone' in rec) && !('notes' in rec) && rec.product === 'not-sure', 'business: numeric quantity stored as digits, no empty keys');
rbBefore = rbKeys();
r = await post(Object.assign({}, biz, { quantity: '5', product: 'digital', ship: 'one' })); A(r.status === 200 && rbNew(rbBefore).quantity === '5', 'business: quantity 5, the least (v5.17)');
rbBefore = rbKeys();
r = await post(Object.assign({}, biz, { quantity: '025' })); A(r.status === 200 && rbNew(rbBefore).quantity === '25', 'business: "025" stored as 25');
for (const [patch, why] of [[{ business: '' }, 'business required'], [{ name: '' }, 'contact name required'], [{ email: '' }, 'email required'],
    [{ email: 'nope' }, 'bad email'], [{ quantity: '' }, 'quantity required'], [{ towns: '  ' }, 'towns required'], [{ product: '' }, 'product required'],
    [{ ship: '' }, 'ship required'], [{ product: 'canvas' }, 'bad product'], [{ product: 'framed12x18' }, 'consumer choice is not a product here'],
    [{ ship: 'pickup' }, 'bad ship'], [{ ship: 'EACH' }, 'enum is exact'], [{ quantity: '0' }, 'quantity 0'], [{ quantity: '1' }, 'quantity 1'], [{ quantity: '4' }, 'quantity 4, under the business minimum (v5.17)'], [{ quantity: 4 }, 'numeric 4'], [{ quantity: '004' }, '"004"'], [{ quantity: '501' }, 'quantity 501'],
    [{ quantity: 1000 }, 'quantity 1000'], [{ quantity: '-5' }, 'negative quantity'], [{ quantity: '2.5' }, 'fractional quantity'],
    [{ quantity: 'ten' }, 'quantity words'], [{ quantity: '1e2' }, 'quantity exponent'], [{ towns: 't'.repeat(8001) }, 'towns cap'], [{ note_all: 'n'.repeat(301) }, 'note_all cap'],
    [{ business: 'b'.repeat(121) }, 'business cap'], [{ notes: 'n'.repeat(2001) }, 'notes cap'], [{ phone: '1'.repeat(31) }, 'phone cap']]) {
  r = await post(Object.assign({}, biz, patch)); A(r.status === 400 && (await r.json()).ok === false, 'business rejects ' + why);
}
r = await post(Object.assign({}, biz, { towns: 't'.repeat(8000) })); A(r.status === 200, 'business: towns at 8000 fits');
rbBefore = rbKeys();
r = await post(Object.assign({}, biz, { note_all: 'Thanks for another year.\r\nFrom all of us at the Chetek Co-op.' })); A(r.status === 200, 'business: note for every print');
rec = rbNew(rbBefore); A(rec.note_all === 'Thanks for another year.\nFrom all of us at the Chetek Co-op.', 'business: note_all kept, keeps its line');
rbBefore = rbKeys();
r = await post(Object.assign({}, biz, { note_all: 'n'.repeat(300) })); A(r.status === 200 && rbNew(rbBefore).note_all.length === 300, 'business: note_all at 300 fits');
rbBefore = rbKeys();
r = await post(biz); A(r.status === 200 && !('note_all' in rbNew(rbBefore)), 'business: no note_all key when none sent');

// v5.12 an ordinary order as a gift: gift:true keeps the gift_ fields, as gift_january does
const rpOrd = () => forms().filter(x => x.startsWith('form:rain-print-order:'));
const rpNew = (before) => { const k = rpOrd().filter(x => !before.includes(x)); A(k.length === 1, 'exactly one new order record'); return JSON.parse(store.get(k[0])); };
let ob = rpOrd();
r = await post(Object.assign({}, rp, { gift: true, gift_to: 'Dad Olson', gift_deliver: 'recipient', gift_message: 'For every inch\r\nyou farmed' }));
A(r.status === 200, 'plain gift order stored');
rec = rpNew(ob);
A(rec.gift === 'yes' && !('gift_january' in rec) && rec.gift_to === 'Dad Olson' && rec.gift_deliver === 'recipient' && rec.gift_message === 'For every inch\nyou farmed',
  'gift:true keeps gift_to, gift_deliver and gift_message');
A(rec.address === '12 Main St\nChetek WI 54728' && !('gift_email' in rec), 'plain gift print ships to the address, no recipient email kept');
ob = rpOrd();
r = await post(Object.assign({}, rp, { gift: 'yes', gift_to: 'Dad', gift_deliver: '' })); A(r.status === 200 && rpNew(ob).gift_deliver === 'buyer', 'plain gift: deliver defaults to the buyer');
ob = rpOrd();
r = await post(Object.assign({}, rp, { choice: 'digital', gift: true, gift_to: 'Dad', gift_deliver: 'recipient', gift_email: 'Dad@Farm.com' }));
rec = rpNew(ob); A(r.status === 200 && rec.gift_email === 'dad@farm.com' && !('address' in rec), 'plain gift file straight to the recipient keeps their email');
ob = rpOrd();
r = await post(Object.assign({}, rp, { gift: false, gift_to: 'Dad', gift_message: 'hi', gift_deliver: 'recipient' }));
rec = rpNew(ob); A(r.status === 200 && !('gift' in rec) && !Object.keys(rec).some(k => k.startsWith('gift')), 'gift:false is an ordinary order, gift fields dropped');
ob = rpOrd();
r = await post(Object.assign({}, rp, { gift_to: 'Dad', gift_message: 'hi' }));
rec = rpNew(ob); A(r.status === 200 && !Object.keys(rec).some(k => k.startsWith('gift')), 'a plain order still drops the gift fields');
ob = rpOrd();
r = await post(Object.assign({}, gift)); rec = rpNew(ob);
A(r.status === 200 && rec.gift_january === 'yes' && !('gift' in rec) && rec.gift_to === 'Dad Olson', 'gift_january still works on its own');
for (const [patch, why] of [[{ gift_message: 'm'.repeat(241) }, 'gift note cap'], [{ gift_to: 't'.repeat(81) }, 'gift_to cap'],
    [{ gift_deliver: 'neighbor' }, 'unknown deliver'], [{ choice: 'digital', gift_deliver: 'recipient', gift_email: '' }, 'gift file to them needs their email']]) {
  r = await post(Object.assign({}, rp, { gift: true, gift_to: 'Dad' }, patch)); A(r.status === 400, 'plain gift rejects ' + why);
}
r = await post(Object.assign({}, rp, { gift: true, gift_to: 'Dad', gift_message: 'm'.repeat(240) })); A(r.status === 200, 'plain gift note at 240 fits');
r = await post(biz, { Origin: 'https://evil.example' }); A(r.status === 403, 'business: foreign origin refused');
let rbCount = rbKeys().length;
r = await post(Object.assign({}, biz, { _gotcha: 'x' })); A(r.status === 200 && rbKeys().length === rbCount, 'business honeypot: ok answer, nothing stored');
// the rate limit is shared: business quotes and every other kind count against the same 8 an hour
const same2 = { 'CF-Connecting-IP': '192.0.2.77' };
codes = [];
for (let i = 0; i < 4; i++) codes.push((await post(Object.assign({}, biz, { business: 'B' + i }), same2)).status);
for (let i = 0; i < 4; i++) codes.push((await post(Object.assign({}, rp), same2)).status);
codes.push((await post(biz, same2)).status);
codes.push((await post(Object.assign({}, rp), same2)).status);
A(codes.slice(0, 8).every(c => c === 200) && codes[8] === 429 && codes[9] === 429, 'business and order posts share the 8-an-hour limit ' + codes);
rbCount = rbKeys().length;
r = await call('/form-list?token=tok&kind=rain-print-business'); j = await r.json();
A(r.status === 200 && j.length === rbCount && j.every(x => x.kind === 'rain-print-business'), '/form-list by kind rain-print-business');
r = await call('/count?token=tok'); j = await r.json();
A(j.forms['rain-print-business'] === rbCount && j.forms.claim === 2 && j.forms['sponsor-feedback'] === 1, '/count forms rain-print-business ' + JSON.stringify(j.forms));

// ───────────── v5.13: the sponsor approval box (M4) ─────────────
const sfKeys = () => forms().filter(x => x.startsWith('form:sponsor-feedback:'));
const sfNew = (before) => { const k = sfKeys().filter(x => !before.includes(x)); A(k.length === 1, 'exactly one new sponsor record'); return JSON.parse(store.get(k[0])); };
const appr = { kind: 'sponsor-feedback', request: 'Approval', sponsor: 'Apex Insurance Group', proof: 'd9f2ad22', message: 'I approve proof d9f2ad22.',
  subject: 'Approved: Apex Insurance Group ad, proof d9f2ad22' };
let sfb = sfKeys();
for (const [patch, why] of [[{}, 'no r and no k (an old link, or a forgery built from the public repo)'], [{ r: R1 }, 'r without k'],
    [{ r: R1, k: '0000000000000000' }, 'a made-up k'], [{ r: R1, k: skey('other-0000000000000000') }, "another sponsor's k"],
    [{ r: R1, k: skey(R1).slice(0, 15) }, 'a k one character short'], [{ r: R1, k: skey(R1) + '0' }, 'a k one character long'],
    [{ r: 'Apex C1!', k: skey('apex c1!') }, 'a junk r'], [{ request: 'approve', r: R1 }, 'lower-case "approve" without k'],
    [{ request: 'APPROVAL please', k: skey(R1) }, 'k without r']]) {
  r = await post(Object.assign({}, appr, patch)); j = await r.json();
  A(r.status === 400 && j.ok === false && /link Sig sent/.test(j.error), 'forged approval refused: ' + why);
}
A(sfKeys().length === sfb.length, 'a refused approval stores nothing');
r = await post(Object.assign({}, appr, { r: R1, k: skey(R1) })); A(r.status === 200, 'an approval from the real link is taken');
rec = sfNew(sfb);
A(rec.verified === 'yes' && rec.r === R1 && !('k' in rec), 'stored as verified, with r, without k');
A(rec.subject === 'Approved: Apex Insurance Group ad, proof d9f2ad22 (verified link ' + R1 + ')', 'the subject is built by the worker ' + rec.subject);
sfb = sfKeys();
r = await post(Object.assign({}, appr, { r: R1.toUpperCase(), k: skey(R1).toUpperCase() })); A(r.status === 200 && sfNew(sfb).verified === 'yes', 'r and k are not case-sensitive');
sfb = sfKeys();
r = await post({ kind: 'sponsor-feedback', request: 'Send a note', sponsor: 'Apex', message: 'Call me', subject: 'Approved: Apex ad, proof d9f2ad22' });
A(r.status === 200, 'a note from an old link is still taken');
rec = sfNew(sfb);
A(rec.verified === 'no' && rec.subject === '[unverified link] AGSIST portal: Send a note (Apex)', 'a note from an old link is marked unverified, and its own subject is not used ' + rec.subject);
sfb = sfKeys();
r = await post({ kind: 'sponsor-feedback', request: 'Cancel', sponsor: 'Apex', message: 'Stop', r: R1, k: skey(R1) });
rec = sfNew(sfb); A(rec.verified === 'yes' && rec.subject === 'AGSIST portal: Cancel (Apex)', 'a request from the real link is marked verified');
sfb = sfKeys();
r = await post({ kind: 'sponsor-feedback', request: 'Cancel\r\nBcc: x', sponsor: 'Apex\r\nInc', message: 'Stop', subject: 'x\r\nBcc: y@evil.example' });
rec = sfNew(sfb); A(!/[\r\n]/.test(rec.subject) && !rec.subject.includes('evil'), 'the subject never carries a line break or the visitor subject ' + JSON.stringify(rec.subject));
{
  const env2 = Object.assign({}, env, { UNSUB_SECRET: '' });
  const r2 = await w.fetch(new Request('https://x.dev/form', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://agsist.com' },
    body: JSON.stringify(Object.assign({}, appr, { r: R1, k: crypto.createHmac('sha256', '').update('x').digest('hex').slice(0, 16) })) }), env2);
  A(r2.status === 400, 'with no UNSUB_SECRET no approval can verify');
}

// ───────────── v5.13: gate, shared limit and one-line fields on /form ─────────────
r = await post(claim, { 'Content-Type': 'text/plain' }); A(r.status === 415, '/form: text/plain refused (it would skip the preflight)');
r = await post(claim, { Origin: 'https://www.agsist.com' }); A(r.status === 200, '/form: www.agsist.com is an AGSIST page');
let rbB = rpKeys();
r = await post(Object.assign({}, rp, { name: 'Jane\r\nBcc: x@evil.example\u0000' })); A(r.status === 200, 'order with a line break in the name');
A(JSON.parse(store.get(newKey(rbB))).name === 'Jane  Bcc: x@evil.example', 'the name is one line (each control character a space)');
{
  // the shared limiter's daily total for /form (500), from any number of addresses
  const store3 = new Map(), opts3 = new Map();
  const env3 = Object.assign({}, env, { SUBS: { async get(k) { return store3.has(k) ? store3.get(k) : null; }, async put(k, v, o) { store3.set(k, v); opts3.set(k, o || null); },
    async delete(k) { store3.delete(k); }, async list({ prefix }) { return { keys: [...store3.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }; } } });
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  for (let i = 0; i < 500; i++) store3.set(`rlq:form:${day}:${String(i).padStart(16, '0')}:00:${String(i).padStart(8, '0')}`, '');
  const p3 = (h) => w.fetch(new Request('https://x.dev/form', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', Origin: 'https://agsist.com' }, h),
    body: JSON.stringify({ kind: 'atlas-feedback', email: 'cap@farm.com' }) }), env3);
  r = await p3({ 'CF-Connecting-IP': '203.0.113.50' });
  A(r.status === 429 && ![...store3.keys()].some(k => k.startsWith('form:')), '/form: the 501st post of the day is refused');
  store3.clear();
  r = await p3({ 'CF-Connecting-IP': '203.0.113.51' });
  const rk = [...store3.keys()].find(k => k.startsWith('rlq:form:'));
  A(r.status === 200 && rk && opts3.get(rk).expirationTtl === 172800, '/form: a taken post leaves one shared rate key that expires');
  A([...store3.keys()].some(k => k.startsWith('rl:form:')), '/form: the v5.8 hourly counter still runs beside it');
}
{
  // no UNSUB_SECRET: the IP cannot be hashed, so the post is refused rather than hashed with a public constant
  const store4 = new Map();
  const env4 = { LIST_TOKEN: 'tok', SUBS: { async get(k) { return store4.has(k) ? store4.get(k) : null; }, async put(k, v) { store4.set(k, v); },
    async delete(k) { store4.delete(k); }, async list({ prefix }) { return { keys: [...store4.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } } };
  const errs = []; const ce = console.error; console.error = (m) => errs.push(String(m));
  r = await w.fetch(new Request('https://x.dev/form', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://agsist.com', 'CF-Connecting-IP': '203.0.113.60' },
    body: JSON.stringify({ kind: 'atlas-feedback', email: 'a@farm.com' }) }), env4);
  console.error = ce;
  A(r.status === 503 && store4.size === 0, '/form without UNSUB_SECRET: 503, nothing stored');
  A(errs.some(m => /UNSUB_SECRET is not set/.test(m)), 'and the Worker log says why');
  A(![...store4.keys()].some(k => k.startsWith('rl:')), 'no counter keyed by a public constant');
}
// ---------- v5.14: Rain Print short links ----------
const b64u = (t) => Buffer.from(t, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const { createHash } = await import('node:crypto');
const want = (code) => {   // Crockford base32 of SHA-256(code), worked out apart from the worker
  const d = createHash('sha256').update(code, 'utf8').digest();
  let bits = ''; for (const x of d.subarray(0, 5)) bits += x.toString(2).padStart(8, '0');
  return bits.match(/.{5}/g).map(b => B32[parseInt(b, 2)]).join('');
};
const rps = (b, h = {}) => w.fetch(new Request('https://x.dev/rp-short', { method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', Origin: 'https://agsist.com', 'CF-Connecting-IP': '10.9.0.' + (++ipN) }, h),
  body: typeof b === 'string' ? b : JSON.stringify(b) }), env);
const rpsGet = (id, h = {}) => w.fetch(new Request('https://x.dev/rp-short/' + id, { headers: Object.assign({ Origin: 'https://agsist.com' }, h) }), env);
const rpsKeys = () => [...store.keys()].filter(k => k.startsWith('rps:'));
const codeA = b64u('1|Chetek, WI|471667 2|2025|snna|The Olson Farm|3k|Planted|8b|Harvest done');
const codeB = b64u('1|Ames, IA|130200 2|2024|wpsa|');
A(rp.design_code.length && b64u('1|Chetek WI|123|2025|sp0a|') === rp.design_code, 'test helper builds the same codes the page does');

r = await rps({ code: codeA }); j = await r.json();
A(r.status === 200 && j.ok === true && j.id === want(codeA).slice(0, 5), 'rp-short: id is the first 5 of Crockford base32 of SHA-256 ' + j.id);
A(/^[0-9A-HJKMNP-TV-Z]{5}$/.test(j.id), 'rp-short: id has no I L O U');
A(r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com', 'rp-short: CORS for agsist.com');
const idA = j.id;
A(store.get('rps:' + idA) === codeA && opts.get('rps:' + idA) === null, 'rp-short: stored as rps:<id> with no expiry');
let nk = rpsKeys().length;
r = await rps({ code: codeA }); j = await r.json();
A(r.status === 200 && j.id === idA && rpsKeys().length === nk, 'rp-short: idempotent, same id and nothing new stored');
r = await rps({ code: codeB }); j = await r.json();
A(r.status === 200 && j.id === want(codeB).slice(0, 5) && j.id !== idA, 'rp-short: deterministic for a second code');
// a collision: the 5-letter id already holds a different code, so it grows to 6, then 7
const codeC = b64u('1|Chetek, WI|471667 2|2023|snna|The Olson Farm'), fullC = want(codeC);
store.set('rps:' + fullC.slice(0, 5), codeB);
r = await rps({ code: codeC }); j = await r.json();
A(r.status === 200 && j.id === fullC.slice(0, 6) && store.get('rps:' + fullC.slice(0, 6)) === codeC, 'rp-short: collision extends to 6 ' + j.id);
A(store.get('rps:' + fullC.slice(0, 5)) === codeB, 'rp-short: the colliding id keeps its own code');
r = await rps({ code: codeC }); j = await r.json(); A(j.id === fullC.slice(0, 6), 'rp-short: an extended id is idempotent too');
const codeD = b64u('1|Chetek, WI|471667 2|2022|snna|'), fullD = want(codeD);
store.set('rps:' + fullD.slice(0, 5), codeA); store.set('rps:' + fullD.slice(0, 6), codeB);
r = await rps({ code: codeD }); j = await r.json(); A(r.status === 200 && j.id === fullD.slice(0, 7), 'rp-short: second collision extends to 7');
const codeE = b64u('1|Chetek, WI|471667 2|2021|snna|'), fullE = want(codeE);
for (let L = 5; L <= 8; L++) store.set('rps:' + fullE.slice(0, L), codeA);
r = await rps({ code: codeE }); A(r.status === 409, 'rp-short: all four lengths taken is a 409, nothing overwritten');
A([5, 6, 7, 8].every(L => store.get('rps:' + fullE.slice(0, L)) === codeA), 'rp-short: no stored id overwritten');
// bad codes
nk = rpsKeys().length;
for (const [code, why] of [[undefined, 'missing'], ['', 'empty'], [123, 'a number'], ['abc def ghi', 'bad characters'], ['short', 'too short'],
    ['A'.repeat(401), 'too long'], [b64u('2|Chetek|1|2025|snna|'), 'wrong version'], [b64u('1|Chetek|1|2025|snna'), 'too few fields'],
    [b64u('1|Chetek|1|2025|snna||5'), 'odd marker fields'], [b64u('1|Chetek|1|1700|snna|'), 'year out of range'],
    [b64u('1|Chetek|1|2025|sn|'), 'bad option letters'], [b64u('1| |1|2025|snna|'), 'no place'], [b64u('1|Chetek|1|2025|snna||zz|x'), 'day past 365'],
    ['GIFT-' + codeA, 'a gift code'], ['/////////', 'not base64url']]) {
  r = await rps(code === undefined ? {} : { code }); A(r.status === 400, 'rp-short: rejects ' + why);
}
r = await rps('not json'); A(r.status === 400, 'rp-short: rejects bad json');
r = await rps({ code: codeA, pad: 'x'.repeat(2000) }); A(r.status === 413, 'rp-short: body over 1 KB refused');
A(rpsKeys().length === nk, 'rp-short: nothing stored for a refused post');
// origin check
r = await rps({ code: codeB }, { Origin: 'https://evil.example' }); A(r.status === 403, 'rp-short: foreign origin refused');
r = await rps({ code: codeB }, { Origin: '' }); A(r.status === 403, 'rp-short: no origin refused');
r = await rps({ code: codeB }, { Origin: 'https://www.agsist.com' }); A(r.status === 200, 'rp-short: www.agsist.com allowed');
// rate limit: own counter, new ids only, and it never touches the form posts' 8
const ip3 = { 'CF-Connecting-IP': '192.0.2.99' };
codes = [];
for (let i = 0; i < 61; i++) codes.push((await rps({ code: b64u('1|Town ' + i + '|1|2025|snna|') }, ip3)).status);
A(codes.slice(0, 60).every(c => c === 200) && codes[60] === 429, 'rp-short: 60 new ids an hour per IP, then 429');
r = await rps({ code: codeA }, ip3); A(r.status === 200, 'rp-short: a known code still answers past the limit');
r = await post(claim, ip3); A(r.status === 200, 'rp-short: links do not use up the form limit');
// GET
r = await rpsGet(idA); j = await r.json();
A(r.status === 200 && j.ok === true && j.code === codeA, 'rp-short GET: known id returns its code');
A(r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com', 'rp-short GET: CORS for agsist.com');
r = await rpsGet(idA.toLowerCase()); j = await r.json(); A(r.status === 200 && j.code === codeA, 'rp-short GET: lowercase id works');
r = await rpsGet(fullC.slice(0, 6)); j = await r.json(); A(j.code === codeC, 'rp-short GET: a 6-letter id works');
let unknown = 'ZZZZZ'; while (store.has('rps:' + unknown)) unknown = 'Z' + unknown;
r = await rpsGet(unknown); A(r.status === 404, 'rp-short GET: unknown id is 404');
for (const bad of ['', 'ABCD', 'ABCDEFGHJ', 'AB%2FCD', 'ABCU9', '..%2F..']) { r = await rpsGet(bad); A(r.status === 404, 'rp-short GET: malformed id 404 ' + JSON.stringify(bad)); }
r = await w.fetch(new Request('https://x.dev/rp-short/' + idA, { method: 'POST', headers: { Origin: 'https://agsist.com' } }), env);
A(r.status === 404, 'rp-short: POST to /rp-short/<id> is not a route');
r = await call('/rp-short'); A(r.status === 404, 'rp-short: GET /rp-short is 404');
r = await w.fetch(new Request('https://x.dev/rp-short', { method: 'OPTIONS', headers: { Origin: 'https://agsist.com' } }), env);
A(r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com', 'rp-short: preflight answered');
r = await call('/count?token=tok'); j = await r.json(); A(!('rps' in j) && !('rp-short' in j.forms), '/count unchanged by short links');
// v5.14: the shared gate and limiter, the GET's caching and the id-walk brake
r = await rps({ code: codeB }, { 'Content-Type': 'text/plain' }); A(r.status === 415, 'rp-short: text/plain refused by publicGate');
{
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rlq = () => [...store.keys()].filter(k => k.startsWith('rlq:rp-short:' + day + ':'));
  let before = rlq().length;
  r = await rps({ code: b64u('1|Rate key town|1|2025|snna|') }); A(r.status === 200 && rlq().length === before + 1, 'rp-short: a new id leaves one shared rate key');
  const rk = rlq().find(k => opts.get(k)); A(rk && opts.get(rk).expirationTtl === 172800, 'rp-short: the rate key expires');
  before = rlq().length;
  r = await rps({ code: codeA }); A(r.status === 200 && rlq().length === before, 'rp-short: a repeat leaves no rate key');
  // the daily total for everyone (600), from fresh addresses
  const have = rlq().length;
  for (let i = have; i < 600; i++) store.set(`rlq:rp-short:${day}:${String(i).padStart(16, '0')}:00:${String(i).padStart(8, '0')}`, '');
  nk = rpsKeys().length;
  r = await rps({ code: b64u('1|Day cap town|1|2025|snna|') }, { 'CF-Connecting-IP': '198.51.100.7' });
  A(r.status === 429 && rpsKeys().length === nk, 'rp-short: the 601st new id of the day is refused, nothing stored');
  r = await rps({ code: codeA }, { 'CF-Connecting-IP': '198.51.100.8' }); A(r.status === 200, 'rp-short: a known code still answers past the daily total');
  for (const k of [...store.keys()]) if (k.startsWith('rlq:rp-short:')) store.delete(k);
}
{
  // no UNSUB_SECRET: a new id needs the hashed address, so 503 and nothing stored
  const env5 = Object.assign({}, env, { UNSUB_SECRET: '' });
  const errs = []; const ce = console.error; console.error = (m) => errs.push(String(m));
  nk = rpsKeys().length;
  r = await w.fetch(new Request('https://x.dev/rp-short', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://agsist.com', 'CF-Connecting-IP': '198.51.100.9' },
    body: JSON.stringify({ code: b64u('1|No secret town|1|2025|snna|') }) }), env5);
  console.error = ce;
  A(r.status === 503 && rpsKeys().length === nk, 'rp-short without UNSUB_SECRET: 503 for a new id, nothing stored');
}
r = await rpsGet(idA); A(r.headers.get('Cache-Control') === 'public, max-age=604800, immutable' && /Origin/.test(r.headers.get('Vary') || ''), 'rp-short GET: a hit is cacheable and varies on Origin');
r = await rpsGet(unknown); A(r.headers.get('Cache-Control') === 'no-store', 'rp-short GET: a miss is not cached');
r = await rpsGet(idA, { Origin: 'https://evil.example' }); A(r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com', 'rp-short GET: no CORS for a foreign site');
{
  // walking ids from one address: 30 misses, then 429 for every GET, known or not
  const walk = { 'CF-Connecting-IP': '198.51.100.20' };
  const st = [];
  for (let i = 0; i < 31; i++) { let id = 'Z' + String(i).padStart(4, '0').replace(/[ILOU]/g, '0'); while (store.has('rps:' + id)) id = 'Y' + id.slice(1); st.push((await rpsGet(id, walk)).status); }
  A(st.slice(0, 30).every(c => c === 404) && st[30] === 429, 'rp-short GET: 30 unknown ids an hour per address, then 429 ' + st.slice(28));
  r = await rpsGet(idA, walk); A(r.status === 429, 'rp-short GET: past the miss cap a known id is not answered either');
  r = await rpsGet(idA, { 'CF-Connecting-IP': '198.51.100.21' }); A(r.status === 200, 'rp-short GET: another address is not held back');
  r = await rpsGet('ABCD', walk); A(r.status === 404, 'rp-short GET: a malformed id is a 404 without a lookup');
}
{
  // POSTs of any kind from one address: 240 an hour per isolate, then 429
  const many = { 'CF-Connecting-IP': '198.51.100.30' };
  let last = 0, okN = 0;
  for (let i = 0; i < 241; i++) { last = (await rps({ code: codeA }, many)).status; if (last === 200) okN++; }
  A(okN === 240 && last === 429, 'rp-short: 240 posts an hour per address, then 429');
}

// older routes still answer the same
r = await call('/subscribe', 'POST', { email: 'c@x.com' }); A(store.has('sub:c@x.com'), 'subscribe intact');
r = await call('/nope'); A(r.status === 404, 'unknown path 404');
r = await call('/form'); A(r.status === 404, 'GET /form is 404');
console.log('form worker ok', n, 'checks');
