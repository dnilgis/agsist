// Runs the v5.8/v5.9/v5.10/v5.12 form routes of workers/subs-worker.js (/form, /form-list, /form-mark, /count forms)
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
r = await post(Object.assign({}, biz, { quantity: '10', product: 'digital', ship: 'one' })); A(r.status === 200 && rbNew(rbBefore).quantity === '10', 'business: quantity 10, the least');
rbBefore = rbKeys();
r = await post(Object.assign({}, biz, { quantity: '025' })); A(r.status === 200 && rbNew(rbBefore).quantity === '25', 'business: "025" stored as 25');
for (const [patch, why] of [[{ business: '' }, 'business required'], [{ name: '' }, 'contact name required'], [{ email: '' }, 'email required'],
    [{ email: 'nope' }, 'bad email'], [{ quantity: '' }, 'quantity required'], [{ towns: '  ' }, 'towns required'], [{ product: '' }, 'product required'],
    [{ ship: '' }, 'ship required'], [{ product: 'canvas' }, 'bad product'], [{ product: 'framed12x18' }, 'consumer choice is not a product here'],
    [{ ship: 'pickup' }, 'bad ship'], [{ ship: 'EACH' }, 'enum is exact'], [{ quantity: '0' }, 'quantity 0'], [{ quantity: '1' }, 'quantity 1'], [{ quantity: '9' }, 'quantity 9, under the business minimum'], [{ quantity: 9 }, 'numeric 9'], [{ quantity: '009' }, '"009"'], [{ quantity: '501' }, 'quantity 501'],
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

// older routes still answer the same
r = await call('/subscribe', 'POST', { email: 'c@x.com' }); A(store.has('sub:c@x.com'), 'subscribe intact');
r = await call('/nope'); A(r.status === 404, 'unknown path 404');
r = await call('/form'); A(r.status === 404, 'GET /form is 404');
console.log('form worker ok', n, 'checks');
