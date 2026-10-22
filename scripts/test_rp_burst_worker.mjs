// Rain Print orders through an outage and a burst (subs worker v5.47, BUILD-RULES 14).
// Runs workers/subs-worker.js against an in-memory KV that answers slowly and in
// any order (so two requests at once really interleave, as on Cloudflare) and
// refuses a second write to one key within a second (KV's own limit), and a
// stand-in for Stripe. No network.
//   node scripts/test_rp_burst_worker.mjs
// The real case (Oct 21 2026): the worker was blocked for a day; Stripe kept
// retrying the webhook; nothing was on record for the payments made meanwhile.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url'; import vm from 'node:vm'; import cryptoN from 'node:crypto';
const here = path.dirname(new URL(import.meta.url).pathname);
const src = path.resolve(here, '..', 'workers', 'subs-worker.js');
const tmp = path.join(os.tmpdir(), 'subs-worker-burst-test-' + process.pid + '.mjs');
fs.copyFileSync(src, tmp);
const w = (await import(pathToFileURL(tmp).href)).default;
fs.unlinkSync(tmp);
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob }; ctx.window = ctx;
vm.runInNewContext(fs.readFileSync(path.resolve(here, '..', 'components', 'rain-print.js'), 'utf8'), ctx);
const RP = ctx.RainPrint;

let n = 0; const A = (c, m) => { if (!c) { console.log('FAIL', m); process.exit(1); } n++; };
const nap = () => new Promise(r => setTimeout(r, Math.floor(Math.random() * 6)));
function kv(limit = true) {
  const store = new Map(), lastPut = new Map();
  let refused = 0;
  return { store, get refused() { return refused; }, api: {
    async get(k, o) { await nap(); const v = store.has(k) ? store.get(k) : null; return o && o.type === 'arrayBuffer' && v ? v : v; },
    async getWithMetadata(k) { await nap(); return { value: store.get(k) || null, metadata: null }; },
    async put(k, v) {
      await nap();
      // KV: one write a second to the same key; more is refused (429)
      const t = Date.now();
      if (limit && k === 'rpo-serial' && t - (lastPut.get(k) || 0) < 1000) { refused++; throw new Error('KV PUT failed: 429 Too Many Requests'); }
      lastPut.set(k, t); store.set(k, v);
    },
    async delete(k) { await nap(); store.delete(k); },
    async list({ prefix }) { await nap(); return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }; } } };
}
const SECRET = 'whsec_burst';
function setup(limit) {
  const K = kv(limit);
  const env = { UNSUB_SECRET: 'sec', LIST_TOKEN: 'tok', STRIPE_WEBHOOK_SECRET: SECRET, SUBS: K.api };
  return { K, env };
}
const signed = (body, t = Math.floor(Date.now() / 1000)) => 't=' + t + ',v1=' + cryptoN.createHmac('sha256', SECRET).update(t + '.' + body).digest('hex');
const event = (o) => JSON.stringify({ id: 'evt_' + o.id, object: 'event', type: 'checkout.session.completed', livemode: true,
  data: { object: Object.assign({ object: 'checkout.session', mode: 'payment', status: 'complete', payment_status: 'paid', amount_subtotal: 4500, amount_total: 4500,
    created: Math.floor(Date.now() / 1000), customer_details: { email: 'buyer@example.com', name: 'Pat Example' } }, o) } });
// Stripe signs every delivery, retries included, with the time it sends it
const hook = (env, body) => w.fetch(new Request('https://x.dev/rp-order/stripe', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signed(body) }, body }), env);
const list = async (env) => (await w.fetch(new Request('https://x.dev/rp-order/list?days=30', { headers: { Authorization: 'Bearer tok', Origin: 'https://agsist.com' } }), env)).json();
const rpo = (K) => [...K.store.keys()].filter(k => k.startsWith('rpo:')).map(k => Object.assign({ key: k }, JSON.parse(K.store.get(k))));
const design = (i) => ({ place: 'Chetek, WI', station: '471667 2', year: 2025, style: i % 2 ? 'r2' : 'r1', name: 'Farm ' + i });
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(null, { status: 204 });   // the email job dispatch, when a token is set

// ---------- a late webhook for a payment made while the worker was out ----------
{
  const { K, env } = setup();
  const code = RP.encodeCode(design(1));
  // paid a day ago; Stripe's retry arrives now, signed now
  const created = Math.floor(Date.now() / 1000) - 86400;
  const body = event({ id: 'cs_live_late1', client_reference_id: code, created, amount_subtotal: 8900, amount_total: 8900 });
  let r = await hook(env, body), j = await r.json();
  A(r.status === 200 && j.ok, 'a late, re-signed retry is taken: ' + JSON.stringify(j));
  let recs = rpo(K);
  A(recs.length === 1, 'one record');
  const x = recs[0];
  const sha = cryptoN.createHash('sha256').update('cs_live_late1').digest('hex').slice(0, 8);
  A(x.key === 'rpo:' + created * 1000 + ':' + sha, 'the key comes from the session: ' + x.key);
  A(x.paid && x.paid.session === 'cs_live_late1' && x.product === 'framed12x18' && x.from_stripe === true, 'paid, framed, from Stripe');
  A(x.design_url === 'https://agsist.com/rain-print?d=' + code && x.place === 'Chetek, WI' && x.year === 2025 && x.name === 'Farm 1' && x.style === 'r2', 'the whole design from the ref alone');
  A(x.no_press === false, 'not "no design": the design is on record');
  A(x.serial === 2, 'the first paid print is No. 0002');
  A(!JSON.stringify([...K.store.values()]).includes('example.com'), 'nothing about the buyer');
  // Stripe sends it again (it never saw our answer): nothing changes
  r = await hook(env, body); j = await r.json();
  A(j.already === true && rpo(K).length === 1 && rpo(K)[0].serial === 2, 'the same event again changes nothing');
  // the list shows it once, ready for the proof email
  const L = await list(env);
  A(L.orders.length === 1 && L.orders[0].status === 'paid' && L.orders[0].fulfill_url === x.design_url + '&maker=1&serial=2', 'listed once, with the maker link');
  console.log('rp burst: late webhook ' + n + ' passed');
}

// ---------- the same event delivered twice at once ----------
{
  const { K, env } = setup();
  const code = RP.encodeCode(design(2));
  const body = event({ id: 'cs_live_twice', client_reference_id: code, amount_subtotal: 1900, amount_total: 1900 });
  const rs = await Promise.all([hook(env, body), hook(env, body), hook(env, body)]);
  A(rs.every(r => r.status === 200), 'all three answered 200');
  const recs = rpo(K).filter(r => r.paid && r.paid.session === 'cs_live_twice');
  A(recs.length === 1, 'one record for the session, not ' + recs.length);
  const L = await list(env);
  A(L.orders.filter(o => o.paid && o.paid.session === 'cs_live_twice').length === 1, 'and one in the list (one proof email)');
  console.log('rp burst: duplicate delivery ' + n + ' passed');
}

// ---------- a burst: 40 orders paid at once, prints and files mixed ----------
// limit: KV refuses a second counter write within a second (most webhooks get no first pick);
// without it, every write lands and the webhooks' read-add-write picks really collide
for (const limit of [true, false]) {
  const { K, env } = setup(limit);
  const N = 40, bodies = [];
  for (let i = 0; i < N; i++) {
    const cents = i % 4 === 0 ? 1900 : i % 2 ? 4500 : 8900;
    bodies.push(event({ id: 'cs_live_burst' + String(i).padStart(2, '0'), client_reference_id: RP.encodeCode(design(100 + i)), amount_subtotal: cents, amount_total: cents, created: Math.floor(Date.now() / 1000) - (N - i) }));
  }
  const rs = await Promise.all(bodies.map(b => hook(env, b)));
  A(rs.every(r => r.status === 200), 'every webhook in the burst answered 200 (none left to fail)');
  let recs = rpo(K);
  A(recs.length === N, 'one record per order: ' + recs.length);
  const prints = recs.filter(r => r.product !== 'digital');
  const firstPick = prints.map(r => r.serial).filter(Boolean);
  const dupFirst = firstPick.length - new Set(firstPick).size;
  console.log('  (the webhooks\' own first picks: ' + firstPick.length + ' of ' + prints.length + ' prints, ' + dupFirst + ' duplicates, ' + K.refused + ' counter writes refused by KV)');
  A(limit ? K.refused > 0 : dupFirst > 0, 'the burst really raced (else this test proves nothing)');
  // the list pass settles them
  const L = await list(env);
  const ser = L.orders.filter(o => o.product !== 'digital').map(o => o.serial);
  A(ser.length === prints.length && ser.every(s => Number.isInteger(s) && s >= 2), 'every print has a serial');
  A(new Set(ser).size === ser.length, 'no serial twice: ' + ser.sort((a, b) => a - b).join(','));
  A(L.orders.filter(o => o.product === 'digital').every(o => o.serial === null), 'no serial on a digital file');
  A(Math.max(...ser) === L.serial_last && Math.min(...ser) === 2 && ser.length === L.serial_last - 1, 'numbered 2 up with no gap; serial_last is the highest');
  const held = new Map(L.orders.map(o => [o.key, o.serial]));
  // a second pass, and a late webhook after it: nothing moves, the new one gets the next
  await new Promise(r => setTimeout(r, 1100));
  const L2 = await list(env);
  A(L2.orders.every(o => held.get(o.key) === o.serial), 'a second pass changes no serial');
  await new Promise(r => setTimeout(r, 1100));
  const late = event({ id: 'cs_live_after', client_reference_id: RP.encodeCode(design(999)), amount_subtotal: 4500, amount_total: 4500 });
  await hook(env, late);
  A(JSON.parse(K.store.get('rpo-serial')).last >= L.serial_last, 'the counter caught up (a write KV refused is made on a later pass)');
  const L3 = await list(env);
  const s3 = L3.orders.filter(o => o.product !== 'digital').map(o => o.serial);
  A(new Set(s3).size === s3.length && L3.orders.find(o => o.paid.session === 'cs_live_after').serial === L.serial_last + 1, 'the next order after the burst is the next number');
  console.log('rp burst: 40 at once' + (limit ? ', KV write limit' : ', every write lands') + ' ' + n + ' passed');
}

// ---------- the poll alone: Stripe stopped retrying, the payments are still found ----------
{
  const { K, env } = setup();
  env.STRIPE_READ_KEY = 'rk_test';
  const day = Math.floor(Date.now() / 1000) - 5 * 86400;
  const code = RP.encodeCode(design(7)), gift = RP.encodeCode(Object.assign(design(8), { gift: true }));
  const long = RP.encodeCode(Object.assign(design(9), { dedication: 'x'.repeat(60), name: 'A long farm name here', markers: [1, 2, 3, 4, 5].map(i => ({ date: '2025-0' + i + '-1' + i, label: 'Label number ' + i })) }));
  const rph = RP.hashRef(long, false);
  A(long.length > 200 && /^RPH-/.test(rph), 'a long design\'s hash ref');
  const sessions = [
    { id: 'cs_live_p1', client_reference_id: code, payment_status: 'paid', amount_total: 4500, amount_subtotal: 4500, created: day },
    { id: 'cs_live_p2', client_reference_id: gift, payment_status: 'paid', amount_total: 8900, amount_subtotal: 8900, created: day + 60 },
    { id: 'cs_live_p3', client_reference_id: rph, payment_status: 'paid', amount_total: 1900, amount_subtotal: 1900, created: day + 120 },
    { id: 'cs_live_p4', client_reference_id: null, payment_status: 'paid', amount_total: 4500, amount_subtotal: 4500, created: day + 180 },
  ];
  const asked = [];
  globalThis.fetch = async (u) => { asked.push(String(u)); return new Response(JSON.stringify({ data: sessions, has_more: false }), { status: 200 }); };
  const L = await list(env);
  A(L.stripe === 'ok' && new URL(asked[0]).searchParams.get('created[gte]') <= String(Math.floor(Date.now() / 1000) - 30 * 86400), 'Stripe read for the whole window, with no record yet');
  const by = (s) => L.orders.find(o => o.paid && o.paid.session === s);
  A(by('cs_live_p1') && by('cs_live_p1').design_url.endsWith('?d=' + code) && by('cs_live_p1').paid.via === 'poll' && by('cs_live_p1').serial === 2, 'a print paid while the worker was out: found, with its design and serial');
  A(by('cs_live_p2') && by('cs_live_p2').gift === true && by('cs_live_p2').serial === 3, 'a gift: found, gift kept');
  A(by('cs_live_p3') && by('cs_live_p3').ref === rph && by('cs_live_p3').design_url === '' && rpo(K).find(r => r.ref === rph).design_by === 'backup form', 'a hash ref: found, the design is in the backup form email');
  A(!by('cs_live_p4'), 'a bare payment link with no reference is left to the webhook, as before');
  // the webhook for one of them arrives after all: no second record
  globalThis.fetch = async () => new Response(null, { status: 204 });
  const b = event({ id: 'cs_live_p1', client_reference_id: code, created: day });
  const r = await hook(env, b), j = await r.json();
  A(j.already === true && rpo(K).filter(x => x.paid && x.paid.session === 'cs_live_p1').length === 1, 'the late webhook finds the poll\'s record');
  // and the poll again finds nothing new
  globalThis.fetch = async () => new Response(JSON.stringify({ data: sessions, has_more: false }), { status: 200 });
  const before = rpo(K).length;
  await list(env);
  A(rpo(K).length === before, 'a second poll makes nothing new');
  console.log('rp burst: poll alone ' + n + ' passed');
}

// ---------- refs the page sends: RPH- on a press record ----------
{
  const { K, env } = setup();
  const long = Object.assign(design(5), { dedication: 'y'.repeat(70), markers: [1, 2, 3, 4, 5].map(i => ({ date: '2025-0' + i + '-1' + i, label: 'Label number ' + i })) });
  const ref = RP.hashRef(RP.encodeCode(long), false);
  const rec = RP.orderRecord(long, ref, 'framed12x18', 89);
  const r = await w.fetch(new Request('https://x.dev/rp-order', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://agsist.com', 'CF-Connecting-IP': '10.9.0.1' }, body: JSON.stringify(rec) }), env);
  A(r.status === 200, 'a press record with an RPH ref is kept');
  A(rpo(K)[0].ref === ref && rpo(K)[0].design_url === rec.design_url, 'with the full design link');
  for (const bad of ['RPH-ABC', 'RPH-ABCDEFGHIJK', 'RPH-ABCDEFGHIL', 'XRPH-ABCDEFGHJK']) {
    const r2 = await w.fetch(new Request('https://x.dev/rp-order', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://agsist.com', 'CF-Connecting-IP': '10.9.0.2' }, body: JSON.stringify(Object.assign({}, rec, { ref: bad })) }), env);
    A(r2.status === 400, 'refuses ref ' + bad);
  }
  // the webhook for it matches the press: the full design, not the hash
  const body = event({ id: 'cs_live_rph', client_reference_id: ref, amount_subtotal: 8900, amount_total: 8900 });
  await hook(env, body);
  const x = rpo(K).find(r => r.paid);
  A(x && x.design_url === rec.design_url && !x.no_press, 'paid on the press record with the whole design');
  console.log('rp burst: RPH refs ' + n + ' passed');
}

// ---------- a logo kept in the browser goes up under its own id ----------
{
  const { K, env } = setup();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAARUlEQVR4nO3OIREAIAAAMZKg0fTvBim4R0zMb8y1z89GHRAUrAOCgnVAULAOCArWAUHBOiAoWAcEBeuAoGAdEBSsA4KvXXbCKEgwypa0AAAAAElFTkSuQmCC', 'base64');
  const h = cryptoN.createHash('sha256').update(png).digest(), B32 = '0123456789abcdefghjkmnpqrstvwxyz';
  let own = ''; for (let i = 0; i < 12; i++) own += B32[h[i] & 31];
  const up = (q, ip) => w.fetch(new Request('https://x.dev/rp-logo' + q, { method: 'POST', headers: { 'Content-Type': 'image/png', Origin: 'https://agsist.com', 'CF-Connecting-IP': ip }, body: png }), env);
  let r = await up('?id=' + own, '10.8.0.1'), j = await r.json();
  A(r.status === 200 && j.id === own && K.store.has('rpl:' + own), 'its own id is taken');
  r = await up('?id=0123456789ab', '10.8.0.2'); j = await r.json();
  A(r.status === 400 && /not this logo/.test(j.error), 'another id is refused');
  r = await up('', '10.8.0.3'); j = await r.json();
  A(r.status === 200 && /^[0-9a-hjkmnp-tv-z]{12}$/.test(j.id) && j.id !== own, 'no id: a random one, as before');
  console.log('rp burst: logo ids ' + n + ' passed');
}
globalThis.fetch = realFetch;
console.log('rp burst worker checks: ' + n + ' passed');
