// Runs the v5.34 Rain Print order-record routes of workers/subs-worker.js
// (POST /rp-order, GET /rp-order/list, POST /rp-order/serial) against an
// in-memory KV and a stand-in for Stripe's Checkout Sessions list. No network.
//   node scripts/test_rp_order_worker.mjs
// The real case (2026-10-20): Sig paid $19 for a digital file and Stripe's
// payment page showed no design. The refs here are the formats the page sends:
// a design code, GIFT-<code>, RPS-<id> and GIFT-RPS-<id>.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url'; import vm from 'node:vm';
const here = path.dirname(new URL(import.meta.url).pathname);
const src = path.resolve(here, '..', 'workers', 'subs-worker.js');
const tmp = path.join(os.tmpdir(), 'subs-worker-rpo-test-' + process.pid + '.mjs');
fs.copyFileSync(src, tmp);
const w = (await import(pathToFileURL(tmp).href)).default;
fs.unlinkSync(tmp);

// the page's own record builder, so the worker is tested on what the page really sends
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob }; ctx.window = ctx;
vm.runInNewContext(fs.readFileSync(path.resolve(here, '..', 'components', 'rain-print.js'), 'utf8'), ctx);
const RP = ctx.RainPrint;

const store = new Map(), opts = new Map();
const env = { UNSUB_SECRET: 'sec', LIST_TOKEN: 'tok', SUBS: {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v, o) { store.set(k, v); opts.set(k, o || null); },
  async delete(k) { store.delete(k); },
  async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }; } } };
let ipN = 0;
const post = (b, h = {}) => w.fetch(new Request('https://x.dev/rp-order', { method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', Origin: 'https://agsist.com', 'CF-Connecting-IP': '10.1.0.' + (++ipN) }, h),
  body: typeof b === 'string' ? b : JSON.stringify(b) }), env);
const admin = (p, m = 'GET', b, auth = 'Bearer tok') => w.fetch(new Request('https://x.dev' + p, { method: m,
  headers: Object.assign({ 'Content-Type': 'application/json', Origin: 'https://agsist.com' }, auth ? { Authorization: auth } : {}),
  body: b ? JSON.stringify(b) : undefined }), env);
let n = 0; const A = (c, m) => { if (!c) { console.log('FAIL', m); process.exit(1); } n++; };
const recs = () => [...store.keys()].filter(k => k.startsWith('rpo:')).sort();
const newest = () => JSON.parse(store.get(recs().pop()));

// Sig's own test order, Oct 20: Chetek WI, Staircase, "Gustum Farm", Apr 1 "Moved in" (the year here is only for the test)
const sig = { place: 'Chetek, WI', station: '471667 2', year: 2025, style: 'r1', name: 'Gustum Farm', markers: [{ date: '2025-04-01', label: 'Moved in' }] };
const sigCode = RP.encodeCode(sig);
const sigRec = RP.orderRecord(sig, RP.checkoutRef(sigCode, false, null), 'digital', 19);
A(sigRec.ref === sigCode && sigCode.length <= 200, 'a short design goes to Stripe as its own code');

let r = await post(Object.assign({}, sigRec, { email: 'buyer@farm.com', address: '12 Main St', buyer: 'Jane' }));
let j = await r.json();
A(r.status === 200 && j.ok === true, 'order record stored');
A(r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com', 'CORS for agsist.com');
let k = recs()[0], rec = JSON.parse(store.get(k));
A(/^rpo:\d{13}:[0-9a-f]{8}$/.test(k), 'key rpo:<ts>:<rand>');
A(opts.get(k) && opts.get(k).expirationTtl === 120 * 24 * 3600, 'kept 120 days');
A(rec.ref === sigCode && rec.product === 'digital' && rec.price === 19 && rec.place === 'Chetek, WI' && rec.year === 2025 && rec.style === 'r1', 'design fields kept');
A(rec.name === 'Gustum Farm' && rec.markers === 'Apr 1 Moved in' && rec.gift === false, 'name and marker in words');
A(rec.design_url === 'https://agsist.com/rain-print?place=Chetek%2C+WI&year=2025&station=471667+2&layout=staircase&palette=paper&size=12x18&style=r1&name=Gustum+Farm&m1=2025-04-01+Moved+in', 'the full design link');
A(!('email' in rec) && !('address' in rec) && !('buyer' in rec) && !JSON.stringify(rec).includes('@'), 'never an email, an address or a buyer name');

// a long design: RPS-<id>, and a gift of one: GIFT-RPS-<id>; GIFT-<code> for a short gift
const long = { place: 'Chetek, WI', station: '471667 2', year: 2025, style: 'r2', name: 'Gustum Farm and Family',
  dedication: 'For every inch of rain on the home place since we moved in',
  markers: [1, 2, 3, 4, 5].map(i => ({ date: '2025-0' + i + '-1' + i, label: 'Label number ' + i })) };
const longRef = RP.checkoutRef(RP.encodeCode(long), false, 'HTTPS://AGSIST.COM/R?K7Q2M');
A(RP.encodeCode(long).length > 200 && longRef === 'RPS-K7Q2M', 'a long design goes as RPS-<id>');
r = await post(RP.orderRecord(long, longRef, 'framed12x18', 89)); A(r.status === 200, 'RPS ref stored');
A(newest().design_url.includes('dedication=For+every+inch') && newest().design_url.endsWith('&m5=2025-05-15+Label+number'), 'a long design keeps its whole link, not only the short id');
const lg = Object.assign({}, long, { gift: true });
const giftLongRef = RP.checkoutRef(RP.encodeCode(lg), true, 'HTTPS://AGSIST.COM/R?K7Q2M');
A(giftLongRef === 'GIFT-RPS-K7Q2M', 'a long gift goes as GIFT-RPS-<id>');
r = await post(RP.orderRecord(lg, giftLongRef, 'print12x18', 45)); A(r.status === 200, 'GIFT-RPS ref stored');
A(newest().gift === true && newest().design_url.endsWith('&gift=1'), 'gift flag and link');
const sg = Object.assign({}, sig, { gift: true });
r = await post(RP.orderRecord(sg, RP.checkoutRef(RP.encodeCode(sg), true, null), 'print12x18', 45)); A(r.status === 200, 'GIFT-<code> stored');
A(newest().ref.startsWith('GIFT-Mnx'), 'GIFT- code kept');

for (const [patch, why] of [[{ ref: '' }, 'no ref'], [{ ref: 'abc def' }, 'ref characters'], [{ ref: 'RPS-ILOU1' }, 'RPS id letters'],
    [{ ref: 'x'.repeat(201) }, 'ref over 200'], [{ ref: 'AAAAAAAAAAAA' }, 'not a design code'], [{ product: 'canvas' }, 'product'],
    [{ product: '' }, 'no product'], [{ design_url: 'https://evil.example/rain-print?x=1' }, 'url off-site'],
    [{ design_url: 'https://agsist.com/rain-print?x="><script>' }, 'url characters'], [{ design_url: '' }, 'no url']]) {
  r = await post(Object.assign({}, sigRec, patch)); A(r.status === 400, 'rejects ' + why);
}
r = await post(Object.assign({}, sigRec, { price: 'lots', year: 'soon', style: 'r9' }));
A(r.status === 200 && newest().price === null && newest().year === null && newest().style === '', 'odd price, year and style are dropped, the record kept');
store.delete(recs().pop());
r = await post('[1]'); A(r.status === 400, 'array body');
r = await post('{nope'); A(r.status === 400, 'bad json');
r = await post(Object.assign({}, sigRec, { name: 'x'.repeat(5000) })); A(r.status === 413, 'over 4 KB');
r = await post(sigRec, { Origin: 'https://evil.example' }); A(r.status === 403, 'foreign origin refused');
r = await post(sigRec, { 'Content-Type': 'text/plain' }); A(r.status === 415, 'not JSON refused');
A(recs().length === 4, 'four records so far');

// ---------- the list: Sig only ----------
r = await admin('/rp-order/list', 'GET', null, ''); A(r.status === 403, 'no token: refused');
r = await admin('/rp-order/list?token=tok', 'GET', null, ''); A(r.status === 403, '?token= refused');
r = await admin('/rp-order/list', 'GET', null, 'Bearer nope'); A(r.status === 403, 'wrong token refused');

// without STRIPE_READ_KEY: every record is "pay pressed", prints get suggested serials in the order pressed
r = await admin('/rp-order/list'); j = await r.json();
A(r.status === 200 && j.ok && j.stripe === 'no key' && j.orders.length === 4, 'listed without a Stripe key');
A(r.headers.get('Cache-Control') === 'no-store', 'not cached');
A(j.orders.every(o => o.status === 'pay pressed' && o.paid === null && o.serial === null), 'all pay pressed');
A(j.orders[0].ref.startsWith('GIFT-Mnx') && j.orders[3].ref === sigCode, 'newest first');
const dig = j.orders[3];
A(dig.fulfill_url === dig.design_url + '&maker=1' && dig.serial_next === null, 'a digital file: maker link, no serial');
const prints = j.orders.filter(o => o.product !== 'digital').reverse();
A(prints.map(o => o.serial_next).join() === '1,2,3', 'suggested serials start at 1 (0 is the test print), in the order pressed');
A(prints[0].fulfill_url.endsWith('&maker=1&serial=1'), 'a print: maker link with the serial');
A(j.serial_last === 0 && !store.has('rpo-serial'), 'nothing handed out without a confirmed payment');
A(!JSON.stringify(j).includes('@'), 'no email anywhere in the list');

// the last serial Sig already used
r = await admin('/rp-order/serial', 'POST', { last: -1 }); A(r.status === 400, 'serial: negative refused');
r = await admin('/rp-order/serial', 'POST', { last: 2.5 }); A(r.status === 400, 'serial: not whole refused');
r = await admin('/rp-order/serial', 'POST', { last: 3 }, ''); A(r.status === 403, 'serial: Sig only');
r = await admin('/rp-order/serial', 'POST', { last: 3 }); j = await r.json(); A(j.ok && j.next === 4, 'serial last set');
j = await (await admin('/rp-order/list')).json();
A(j.orders.filter(o => o.product !== 'digital').reverse().map(o => o.serial_next).join() === '4,5,6', 'suggestions follow the last serial');

// ---------- with STRIPE_READ_KEY: completed sessions mark the records paid ----------
const realFetch = globalThis.fetch;
const asked = [];
let sessions = [], stripeStatus = 200;
globalThis.fetch = async (u, o) => {
  asked.push({ u: String(u), auth: o && o.headers && o.headers.Authorization });
  if (stripeStatus !== 200) return new Response('{}', { status: stripeStatus });
  // customer_details is there in a real answer; the worker must never pass it on
  return new Response(JSON.stringify({ data: sessions, has_more: false }), { status: 200 });
};
env.STRIPE_READ_KEY = 'rk_test_x';
const all = recs().map(x => JSON.parse(store.get(x)));
const tsOf = (ref) => all.find(x => x.ref === ref).ts;
const cust = { email: 'buyer@farm.com', name: 'Jane Buyer', address: { line1: '12 Main St' } };
sessions = [
  // the real case: $19, the design code as client_reference_id
  { id: 'cs_live_sig19', client_reference_id: sigCode, payment_status: 'paid', amount_total: 1900, amount_subtotal: 1900, created: Math.floor(tsOf(sigCode) / 1000) + 5, customer_details: cust },
  // the framed RPS order, paid with the letter's code
  { id: 'cs_live_rps', client_reference_id: 'RPS-K7Q2M', payment_status: 'paid', amount_total: 7900, amount_subtotal: 8900, created: Math.floor(tsOf('RPS-K7Q2M') / 1000) + 9, customer_details: cust },
  // a session not paid yet, and one with no reference (a bare payment link)
  { id: 'cs_live_open', client_reference_id: 'GIFT-RPS-K7Q2M', payment_status: 'unpaid', amount_total: 4500, amount_subtotal: 4500, created: Math.floor(Date.now() / 1000), customer_details: cust },
  { id: 'cs_live_bare', client_reference_id: null, payment_status: 'paid', amount_total: 4500, amount_subtotal: 4500, created: Math.floor(Date.now() / 1000) },
];
r = await admin('/rp-order/list'); j = await r.json();
A(j.stripe === 'ok', 'Stripe read');
A(asked.length === 1 && asked[0].u.startsWith('https://api.stripe.com/v1/checkout/sessions?') && asked[0].u.includes('status=complete') && asked[0].auth === 'Bearer rk_test_x', 'asked Stripe for completed sessions with the read key');
const byRef = (ref) => j.orders.find(o => o.ref === ref);
A(byRef(sigCode).status === 'paid' && byRef(sigCode).paid.amount === 19 && byRef(sigCode).paid.session === 'cs_live_sig19', 'the $19 file is paid');
A(byRef(sigCode).fulfill_url === byRef(sigCode).design_url + '&maker=1', 'the paid file opens in the maker view, no serial');
const fr = byRef('RPS-K7Q2M');
A(fr.status === 'paid' && fr.paid.amount === 79 && fr.paid.subtotal === 89 && fr.serial === 4 && fr.fulfill_url.endsWith('&maker=1&serial=4'), 'the paid framed print gets the next serial');
A(byRef('GIFT-RPS-K7Q2M').status === 'pay pressed' && byRef('GIFT-RPS-K7Q2M').serial === null && byRef('GIFT-RPS-K7Q2M').serial_next === null, 'an unpaid session leaves the press as pay pressed, no serial');
A(j.serial_last === 4 && JSON.parse(store.get('rpo-serial')).last === 4, 'the counter moved once');
A(!JSON.stringify(j).includes('@') && !JSON.stringify(j).includes('Jane') && !JSON.stringify(j).includes('Main St'), 'nothing about the buyer');
A(!JSON.stringify([...store.values()]).includes('@'), 'nothing about the buyer in the store');
// kept: a second read matches nothing new and hands out no new serial, even with Stripe gone
stripeStatus = 401;
j = await (await admin('/rp-order/list')).json();
A(j.stripe === 'could not be read (HTTP 401)', 'a bad key is said');
const again = (ref) => j.orders.find(o => o.ref === ref);
A(again(sigCode).status === 'paid' && again('RPS-K7Q2M').serial === 4 && j.serial_last === 4, 'paid and serial stay in the record');
A(again('GIFT-RPS-K7Q2M').serial_next === 5, 'with Stripe unreadable, a press gets a suggested serial again');
const kRps = recs().find(x => JSON.parse(store.get(x)).ref === 'RPS-K7Q2M');
A(opts.get(kRps) && opts.get(kRps).expiration >= Math.floor(JSON.parse(store.get(kRps)).ts / 1000) + 120 * 86400 - 1, 'a rewritten record keeps its 120 days');

// the same design pressed twice, paid once: the later press is the paid one
stripeStatus = 200;
await post(sigRec); await new Promise(res => setTimeout(res, 5)); await post(sigRec);
const twice = recs().map(x => JSON.parse(store.get(x))).filter(x => x.ref === sigCode && !x.paid).sort((a, b) => a.ts - b.ts);
A(twice.length === 2, 'two new presses of the same design');
sessions = [{ id: 'cs_live_again', client_reference_id: sigCode, payment_status: 'paid', amount_total: 1900, amount_subtotal: 1900, created: Math.floor(twice[1].ts / 1000) + 2 }];
j = await (await admin('/rp-order/list')).json();
const sigs = j.orders.filter(o => o.ref === sigCode);
A(sigs.length === 3 && sigs.filter(o => o.status === 'paid').length === 2, 'one more paid, one press left unpaid');
A(sigs.find(o => o.paid && o.paid.session === 'cs_live_again').ts === twice[1].ts, 'the session matched the latest press before it');
A(sigs.find(o => o.paid && o.paid.session === 'cs_live_sig19'), 'the first payment keeps its own press');

// days: old records are left out
j = await (await admin('/rp-order/list?days=0')).json(); A(j.days === 1, 'days at least 1');
j = await (await admin('/rp-order/list?days=999')).json(); A(j.days === 120, 'days at most 120');
globalThis.fetch = realFetch;
console.log('rp-order worker checks: ' + n + ' passed');

// ---------- the buyer email's once-only mark ----------
{
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 });
  const list = await (await admin('/rp-order/list')).json();
  const paidOne = list.orders.find(o => o.status === 'paid'), unpaid = list.orders.find(o => o.status !== 'paid');
  A(paidOne.mailed === null, 'not mailed yet');
  let m = await admin('/rp-order/mailed', 'POST', { key: paidOne.key }, ''); A(m.status === 403, 'mailed: Sig only');
  m = await admin('/rp-order/mailed', 'POST', { key: 'rpo:1:zz' }); A(m.status === 400, 'mailed: bad key');
  m = await admin('/rp-order/mailed', 'POST', { key: unpaid.key }); A(m.status === 409, 'mailed: an unpaid press is never mailed');
  m = await admin('/rp-order/mailed', 'POST', { key: paidOne.key }); let mj = await m.json();
  A(mj.ok && mj.already === false && mj.mailed.session === paidOne.paid.session, 'mailed: marked with the session');
  m = await admin('/rp-order/mailed', 'POST', { key: paidOne.key }); mj = await m.json();
  A(mj.ok && mj.already === true, 'mailed: a second mark changes nothing');
  const after = await (await admin('/rp-order/list')).json();
  A(after.orders.find(o => o.key === paidOne.key).mailed.session === paidOne.paid.session, 'the list says it was mailed');
  A(!JSON.stringify([...store.values()]).includes('@'), 'no address kept');
  globalThis.fetch = realFetch;
  console.log('rp-order mailed checks: ' + n + ' passed');
}

// ---------- the buyer's address, for the buyer email only ----------
{
  const list = await (await admin('/rp-order/list')).json();
  const paidOne = list.orders.find(o => o.status === 'paid'), unpaid = list.orders.find(o => o.status !== 'paid');
  const asks = [];
  globalThis.fetch = async (u, o) => { asks.push(String(u)); return new Response(JSON.stringify({ id: 'x', livemode: true, customer_details: { email: 'buyer@farm.com', name: 'Jane', address: { line1: '12 Main St' } } }), { status: 200 }); };
  let b = await admin('/rp-order/buyer?key=' + encodeURIComponent(paidOne.key), 'GET', null, ''); A(b.status === 403, 'buyer: Sig only');
  b = await admin('/rp-order/buyer?key=' + encodeURIComponent(unpaid.key)); A(b.status === 409, 'buyer: never for an unpaid press');
  b = await admin('/rp-order/buyer?key=x'); A(b.status === 400, 'buyer: bad key');
  const before = JSON.stringify([...store.entries()]);
  b = await admin('/rp-order/buyer?key=' + encodeURIComponent(paidOne.key)); const bj = await b.json();
  A(bj.ok && bj.email === 'buyer@farm.com' && bj.livemode === true && !('name' in bj) && !('address' in bj), 'buyer: the address and livemode only');
  A(asks.pop() === 'https://api.stripe.com/v1/checkout/sessions/' + paidOne.paid.session, 'buyer: that one session');
  A(JSON.stringify([...store.entries()]) === before, 'buyer: nothing stored');
  globalThis.fetch = async () => new Response('{}', { status: 401 });
  b = await admin('/rp-order/buyer?key=' + encodeURIComponent(paidOne.key)); A(b.status === 502, 'buyer: Stripe refused is said');
  const keep = env.STRIPE_READ_KEY; delete env.STRIPE_READ_KEY;
  b = await admin('/rp-order/buyer?key=' + encodeURIComponent(paidOne.key)); A(b.status === 503, 'buyer: no key');
  env.STRIPE_READ_KEY = keep;
  globalThis.fetch = realFetch;
  console.log('rp-order buyer checks: ' + n + ' passed');
}

// ---------- v5.35: the Stripe webhook ----------
{
  const cryptoN = await import('node:crypto');
  const SECRET = 'whsec_test_123';
  const signed = (body, t = Math.floor(Date.now() / 1000), secret = SECRET) =>
    't=' + t + ',v1=' + cryptoN.createHmac('sha256', secret).update(t + '.' + body).digest('hex');
  const hook = (body, sigHeader) => w.fetch(new Request('https://x.dev/rp-order/stripe', { method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, sigHeader === undefined ? {} : { 'Stripe-Signature': sigHeader }), body }), env);
  // a real-shaped event (Stripe's checkout.session.completed for a Payment Link), made-up buyer
  const event = (o = {}, type = 'checkout.session.completed') => JSON.stringify({ id: 'evt_1Q', object: 'event', api_version: '2024-06-20', type, livemode: true,
    data: { object: Object.assign({ id: 'cs_live_a1B2c3', object: 'checkout.session', mode: 'payment', status: 'complete', payment_status: 'paid',
      client_reference_id: sigCode, amount_subtotal: 1900, amount_total: 1900, currency: 'usd', created: Math.floor(Date.now() / 1000), livemode: true,
      payment_link: 'plink_1x', customer_details: { email: 'buyer@example.com', name: 'Pat Example', address: { line1: '1 Example Rd', city: 'Chetek' } } }, o) } });
  const dispatches = [];
  globalThis.fetch = async (u, o) => { dispatches.push({ u: String(u), body: o && o.body, auth: o && o.headers && o.headers.Authorization }); return new Response(null, { status: 204 }); };

  let h = await hook(event(), signed(event())); A(h.status === 503, 'webhook: no secret set, refused');
  env.STRIPE_WEBHOOK_SECRET = SECRET;
  // a fresh press of Sig's design to be paid
  await post(sigRec);
  const pressKey = recs().map(k => [k, JSON.parse(store.get(k))]).filter(([, r]) => r.ref === sigCode && !r.paid).sort((a, b) => b[1].ts - a[1].ts)[0][0];
  const body = event();
  h = await hook(body, undefined); A(h.status === 400, 'webhook: no signature, refused');
  h = await hook(body, signed(body, undefined, 'whsec_wrong')); A(h.status === 400 && (await h.json()).error === 'bad signature', 'webhook: wrong secret, refused');
  h = await hook(body, signed(body, Math.floor(Date.now() / 1000) - 400)); A(h.status === 400 && (await h.json()).error === 'stale', 'webhook: stale, refused');
  h = await hook(body.replace('1900,', '19,'), signed(body)); A(h.status === 400, 'webhook: body changed after signing, refused');
  A(!JSON.parse(store.get(pressKey)).paid, 'nothing marked by a refused event');
  h = await hook(body, signed(body)); let hj = await h.json();
  A(h.status === 200 && hj.ok && hj.job === 'no token', 'webhook: paid event taken; no dispatch token yet');
  let pr = JSON.parse(store.get(pressKey));
  A(pr.paid && pr.paid.session === 'cs_live_a1B2c3' && pr.paid.via === 'webhook' && pr.paid.amount === 19, 'webhook: the press is marked paid');
  A(!JSON.stringify([...store.values()]).includes('example.com') && !JSON.stringify([...store.values()]).includes('Pat Example'), 'webhook: nothing about the buyer kept');
  h = await hook(body, signed(body)); hj = await h.json(); A(hj.ok && hj.already === true, 'webhook: the same session again changes nothing');
  A(dispatches.length === 0, 'no dispatch without a token');
  // a framed print by webhook, with the dispatch token: serial and the job started, dry run until Sig says live
  env.GH_DISPATCH_TOKEN = 'ghp_x';
  await post(RP.orderRecord(long, longRef, 'framed12x18', 89));
  const before = JSON.parse(store.get('rpo-serial')).last;
  const b2 = event({ id: 'cs_live_framed2', client_reference_id: 'RPS-K7Q2M', amount_subtotal: 8900, amount_total: 8900 });
  h = await hook(b2, signed(b2)); hj = await h.json();
  A(hj.job === 'started' && dispatches.length === 1 && dispatches[0].u === 'https://api.github.com/repos/dnilgis/agsist/actions/workflows/rp-buyer-email.yml/dispatches', 'webhook: starts the email job');
  A(JSON.parse(dispatches[0].body).inputs.dry_run === 'true', 'dry run until RP_BUYER_EMAIL_LIVE is 1');
  const fr2 = recs().map(k => JSON.parse(store.get(k))).find(r => r.paid && r.paid.session === 'cs_live_framed2');
  A(fr2 && fr2.serial === before + 1 && JSON.parse(store.get('rpo-serial')).last === before + 1, 'webhook: a framed print gets the next serial');
  env.RP_BUYER_EMAIL_LIVE = '1';
  // async: completed but unpaid is ignored, async_payment_succeeded counts
  const b3 = event({ id: 'cs_live_async3', payment_status: 'unpaid', client_reference_id: 'GIFT-RPS-K7Q2M', amount_subtotal: 4500, amount_total: 4500 });
  h = await hook(b3, signed(b3)); hj = await h.json(); A(hj.ignored === 'checkout.session.completed', 'webhook: an unpaid completion is ignored');
  const b4 = event({ id: 'cs_live_async3', payment_status: 'paid', client_reference_id: 'GIFT-RPS-K7Q2M', amount_subtotal: 4500, amount_total: 4500 }, 'checkout.session.async_payment_succeeded');
  h = await hook(b4, signed(b4)); hj = await h.json();
  A(hj.job === 'started' && JSON.parse(dispatches[1].body).inputs.dry_run === 'false', 'webhook: async success counts; live when Sig says');
  // a paid session with no press: its own record, so Sig still sees it
  const b5 = event({ id: 'cs_live_bare5', client_reference_id: null, amount_subtotal: 4500, amount_total: 4500 });
  h = await hook(b5, signed(b5)); A((await h.json()).ok, 'webhook: a bare payment link is taken');
  const bare = recs().map(k => JSON.parse(store.get(k))).find(r => r.paid && r.paid.session === 'cs_live_bare5');
  A(bare && bare.no_press && bare.product === 'print12x18' && bare.design_url === '' && bare.serial > 0, 'webhook: no press, kept with product from the price');
  const other = event({}, 'payment_intent.succeeded');
  h = await hook(other, signed(other)); A((await h.json()).ignored === 'payment_intent.succeeded', 'webhook: other events ignored');
  // the poll does not mark a webhook-paid session again
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ id: 'cs_live_a1B2c3', client_reference_id: sigCode, payment_status: 'paid', amount_total: 1900, amount_subtotal: 1900, created: Math.floor(Date.now() / 1000) }], has_more: false }), { status: 200 });
  const L = await (await admin('/rp-order/list')).json();
  A(L.orders.filter(o => o.paid && o.paid.session === 'cs_live_a1B2c3').length === 1, 'the poll leaves a webhook-paid session alone');
  A(L.orders.some(o => o.no_press && o.fulfill_url === ''), 'a record with no design has no maker link');
  // the alert mark
  let m = await admin('/rp-order/alerted', 'POST', { key: pressKey }); let mj = await m.json();
  A(mj.ok && mj.already === false && mj.alerted.session === 'cs_live_a1B2c3', 'alerted: marked');
  m = await admin('/rp-order/alerted', 'POST', { key: pressKey }); A((await m.json()).already === true, 'alerted: once');
  globalThis.fetch = realFetch;
  console.log('rp-order webhook checks: ' + n + ' passed');
}
