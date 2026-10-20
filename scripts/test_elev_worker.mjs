// Runs the v5.20 elevator portal routes of workers/subs-worker.js
// (/elev/admin/create, /elev/admin/rekey, /elev/admin/active, /elev/admin/list,
// /elev/me, /elev/save, /elev/feed), the v5.34 hand paste (/elev/admin/paste,
// /elev/paste/<site>, /elev/paste-status) and the v5.21 listing requests (POST /form
// kind elevator-listing, /elev/admin/requests, /elev/admin/request) against an
// in-memory KV. No network.
//     node scripts/test_elev_worker.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url'; import crypto from 'node:crypto';
const src = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'workers', 'subs-worker.js');
const tmp = path.join(os.tmpdir(), 'subs-worker-elev-test-' + process.pid + '.mjs');
fs.copyFileSync(src, tmp);
const w = (await import(pathToFileURL(tmp).href)).default;
fs.unlinkSync(tmp);
const store = new Map(), meta = new Map();
const SUBS = {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v, o) { store.set(k, v); if (o && o.metadata !== undefined) meta.set(k, o.metadata); else meta.delete(k); },
  async delete(k) { store.delete(k); meta.delete(k); },
  async list({ prefix, limit }) {
    const all = [...store.keys()].filter(k => k.startsWith(prefix)).sort();
    const lim = limit || 1000;
    return { keys: all.slice(0, lim).map(name => meta.has(name) ? { name, metadata: meta.get(name) } : { name }), list_complete: all.length <= lim };
  } };
const env = { UNSUB_SECRET: 'sec', LIST_TOKEN: 'tok', SUBS };
let ipN = 0;
const freshIp = () => { ipN++; return '10.' + (ipN >> 16 & 255) + '.' + (ipN >> 8 & 255) + '.' + (ipN & 255); };
const H = 'https://x.dev';
const pub = (p, b, h = {}, e = env) => w.fetch(new Request(H + p, { method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', Origin: 'https://agsist.com', 'CF-Connecting-IP': freshIp() }, h),
  body: typeof b === 'string' ? b : JSON.stringify(b) }), e);
const admin = (p, b, tok = 'tok', e = env) => w.fetch(new Request(H + p, { method: b ? 'POST' : 'GET',
  headers: { 'Content-Type': 'application/json', Origin: 'https://agsist.com', Authorization: 'Bearer ' + tok },
  body: b ? JSON.stringify(b) : undefined }), e);
const get = (p, h = {}) => w.fetch(new Request(H + p, { headers: Object.assign({ Origin: 'https://agsist.com' }, h) }), env);
let n = 0; const A = (c, m) => { if (!c) { console.log('FAIL', m); process.exit(1); } n++; };
const rec = id => JSON.parse(store.get('elev:' + id));
const keyOf = link => new URL(link).searchParams.get('k');

const BUNGE = { id: 'bunge-ladoga-in', name: 'Bunge', town: 'Ladoga', state: 'in', zip: '47954', lat: 39.9134, lon: -86.8014,
  contact: { name: 'Wyatt', phone: '765-555-0100' }, email: 'Wyatt@Example.com',
  hours: { text: 'Mon-Fri 7-5, Sat 7-12', harvest: '7am-9pm through Nov 15' } };

// ---- admin: token ----
let r = await admin('/elev/admin/create', BUNGE, 'nope'); A(r.status === 403, 'create needs the token');
r = await w.fetch(new Request(H + '/elev/admin/create?token=tok', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(BUNGE) }), env);
A(r.status === 403, 'create refuses ?token= (Bearer only)');
r = await admin('/elev/admin/list', null, 'nope'); A(r.status === 403, 'list needs the token');
A(!store.has('elev:bunge-ladoga-in'), 'nothing stored without the token');

// ---- admin: create ----
r = await admin('/elev/admin/create', BUNGE); let j = await r.json();
A(r.status === 200 && j.ok && j.id === 'bunge-ladoga-in', 'create ok');
A(r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com', 'admin answers carry CORS for agsist.com');
A(/^https:\/\/agsist\.com\/post\?k=[a-z2-7]{24}$/.test(j.link), 'link is agsist.com/post?k=<24 base32>: ' + j.link);
const K1 = keyOf(j.link);
let R = rec('bunge-ladoga-in');
A(R.state === 'IN' && R.email === 'wyatt@example.com' && R.active === true && Array.isArray(R.bids) && R.bids.length === 0, 'record cleaned');
A(R.contact.name === 'Wyatt' && R.contact.phone === '765-555-0100' && R.hours.harvest === '7am-9pm through Nov 15', 'contact and hours kept');
A(R.closed_until === null && R.note === null && R.created_at && R.info_updated_at, 'empty fields null; times set');
const hk = 'elevkey:' + crypto.createHmac('sha256', 'sec').update('elev|' + K1).digest('hex').slice(0, 16);
A(store.get(hk) === 'bunge-ladoga-in', 'elevkey:<hmac16("elev|"+key)> = id');
A(![...store.values()].some(v => String(v).includes(K1)) && ![...store.keys()].some(k => k.includes(K1)), 'the key itself is stored nowhere');
r = await admin('/elev/admin/create', BUNGE); A(r.status === 409, 'existing id refused');
for (const [patch, why] of [[{ id: 'Bunge Ladoga' }, 'id with caps and space'], [{ id: 'ab' }, 'id too short'], [{ id: '-bunge' }, 'id leading dash'],
    [{ name: '' }, 'name required'], [{ state: 'Indiana' }, 'state'], [{ zip: '4795' }, 'zip'], [{ lat: 'x' }, 'lat'], [{ lon: 86.8 }, 'lon east'],
    [{ email: 'nope' }, 'email'], [{ contact: { name: 'W', phone: 'call me' } }, 'phone'], [{ hours: { text: 'h'.repeat(81) } }, 'hours too long'],
    [{ name: 'n'.repeat(81) }, 'name too long']]) {
  r = await admin('/elev/admin/create', Object.assign({}, BUNGE, { id: 'x-' + n }, patch)); A(r.status === 400, 'create rejects ' + why);
}

// ---- /elev/me ----
r = await pub('/elev/me', { k: K1 }); j = await r.json();
A(r.status === 200 && j.ok && j.record.id === 'bunge-ladoga-in' && j.record.name === 'Bunge', 'me opens the record');
A(!('email' in j.record), 'me never answers the email');
A(r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com' && r.headers.get('Cache-Control') === 'no-store', 'me: CORS, no-store');
r = await pub('/elev/me', { k: K1.toUpperCase() }); A(r.status === 200, 'key read any case');
for (const [k, why] of [['', 'empty'], ['abc', 'short'], ['a'.repeat(24), 'well formed but unknown'], [K1 + 'a', 'one too long'], [123, 'number'], [null, 'null']]) {
  r = await pub('/elev/me', { k }); A(r.status === 404, 'bad key ' + why);
}
r = await pub('/elev/me', { k: K1 }, { Origin: 'https://evil.example' }); A(r.status === 403, 'foreign origin refused');
r = await pub('/elev/me', { k: K1 }, { Origin: '' }); A(r.status === 403, 'no origin refused');
r = await pub('/elev/me', 'k=' + K1, { 'Content-Type': 'application/x-www-form-urlencoded' }); A(r.status === 415, 'form body refused');
r = await pub('/elev/me', '{nope'); A(r.status === 400, 'bad json');
r = await pub('/elev/me', '[1]'); A(r.status === 400, 'array body');
r = await pub('/elev/me', JSON.stringify({ k: K1, pad: 'x'.repeat(17000) })); A(r.status === 413, 'over 16 KB');

// ---- /elev/save ----
const ROWS = [
  { crop: 'corn', period: 'Oct/Nov', start: '2026-10-01', end: '2026-11-30', futures: 'ZCZ26', basis: -0.35 },
  { crop: 'corn', period: 'Jan', start: '2027-01-01', end: '2027-01-31', futures: 'zch27', basis: '-0.22' },
  { crop: 'soybeans', period: 'Oct/Nov', start: '2026-10-01', end: '2026-11-30', futures: 'ZSX26', basis: -0.6, extra: 'dropped' },
];
const before = rec('bunge-ladoga-in');
r = await pub('/elev/save', { k: K1, bids: ROWS, email: 'evil@x.com', active: false, id: 'other', bids_updated_at: '2000-01-01T00:00:00Z' }); j = await r.json();
A(r.status === 200 && j.ok, 'save ok');
R = rec('bunge-ladoga-in');
A(R.bids.length === 3 && R.bids[1].futures === 'ZCH27' && R.bids[1].basis === -0.22 && !('extra' in R.bids[2]), 'rows cleaned (futures upper case, basis a number, unknown row field dropped)');
A(R.email === 'wyatt@example.com' && R.active === true && R.id === 'bunge-ladoga-in', 'unknown and private fields ignored');
A(R.bids_updated_at && R.bids_updated_at !== '2000-01-01T00:00:00Z' && R.info_updated_at === before.info_updated_at, 'bids time set, info time unchanged');
A(!('email' in j.record) && j.record.bids.length === 3, 'save answers the saved record without the email');
const t1 = R.bids_updated_at;
await new Promise(res => setTimeout(res, 5));
r = await pub('/elev/save', { k: K1, bids: ROWS }); A(r.status === 200 && rec('bunge-ladoga-in').bids_updated_at === t1, 'same bids again: time not moved');
r = await pub('/elev/save', { k: K1, no_change: true }); j = await r.json();
A(r.status === 200 && rec('bunge-ladoga-in').bids_updated_at > t1 && rec('bunge-ladoga-in').bids.length === 3, 'no_change bumps only the bids time');
r = await pub('/elev/save', { k: K1, no_change: 'yes' }); A(r.status === 400, 'no_change must be true; nothing else to save');
r = await pub('/elev/save', { k: K1 }); A(r.status === 400, 'nothing to save');
r = await pub('/elev/save', { k: K1, basis: 1, color: 'red' }); A(r.status === 400, 'only unknown fields is nothing to save');

const row = ROWS[0];
const t2 = rec('bunge-ladoga-in').bids_updated_at;
for (const [patch, why] of [
    [{ basis: -3.01 }, 'basis below -3.00'], [{ basis: 2.01 }, 'basis above +2.00'], [{ basis: 'abc' }, 'basis text'], [{ basis: null }, 'basis null'],
    [{ basis: '' }, 'basis empty'], [{ basis: Infinity }, 'basis infinite'],
    [{ futures: 'ZSZ26' }, 'soybean board on a corn row'], [{ futures: 'ZCX26' }, 'corn has no November'], [{ futures: 'ZCZ2026' }, 'four-digit year'],
    [{ futures: 'CZ26' }, 'short root'], [{ futures: 'ZCZ' }, 'no year'], [{ futures: '' }, 'empty futures'],
    [{ crop: 'oats' }, 'unknown crop'], [{ crop: 'toString' }, 'inherited crop name'], [{ crop: '__proto__' }, 'proto crop'],
    [{ period: '' }, 'empty period'], [{ period: 'p'.repeat(17) }, 'period over 16'],
    [{ start: '2026-02-30' }, 'no such day'], [{ start: '10/01/2026' }, 'date shape'], [{ end: '2026-09-30' }, 'ends before it starts']]) {
  r = await pub('/elev/save', { k: K1, bids: [Object.assign({}, row, patch)] }); A(r.status === 400, 'save rejects ' + why);
}
r = await pub('/elev/save', { k: K1, bids: Array(13).fill(row) }); A(r.status === 400, '13 rows refused');
r = await pub('/elev/save', { k: K1, bids: Array(12).fill(row) }); A(r.status === 200 && rec('bunge-ladoga-in').bids.length === 12, '12 rows taken');
r = await pub('/elev/save', { k: K1, bids: 'corn' }); A(r.status === 400, 'bids not a list');
r = await pub('/elev/save', { k: K1, bids: [Object.assign({}, row, { basis: -0.354 })] });
A(r.status === 200 && rec('bunge-ladoga-in').bids[0].basis === -0.35, 'basis kept to the cent');
r = await pub('/elev/save', { k: K1, bids: [Object.assign({}, row, { basis: -3 }), Object.assign({}, row, { basis: 2 }), Object.assign({}, row, { basis: -0 })] });
A(r.status === 200 && rec('bunge-ladoga-in').bids.map(x => x.basis).join() === '-3,2,0', 'range ends -3.00 and +2.00 taken; -0 stored as 0');
r = await pub('/elev/save', { k: K1, bids: [] }); A(r.status === 200 && rec('bunge-ladoga-in').bids.length === 0, 'zero rows taken');
r = await pub('/elev/save', { k: K1, bids: ROWS });

// a bad field anywhere stores nothing at all
const snap = store.get('elev:bunge-ladoga-in');
r = await pub('/elev/save', { k: K1, note: 'Dump pit 2 open', hours: { text: 'h'.repeat(81) } }); A(r.status === 400 && store.get('elev:bunge-ladoga-in') === snap, 'one bad field: nothing saved');
r = await pub('/elev/save', { k: K1, bids: [], note: 'n'.repeat(141) }); A(r.status === 400 && store.get('elev:bunge-ladoga-in') === snap, 'long note: nothing saved, bids kept');

// info fields
const t3 = rec('bunge-ladoga-in').bids_updated_at, i3 = rec('bunge-ladoga-in').info_updated_at;
await new Promise(res => setTimeout(res, 5));
r = await pub('/elev/save', { k: K1, note: 'Corn dump\nopen till 9 tonight', hours: { text: 'Mon-Fri 7-5', harvest: '' }, contact: { name: 'Wyatt', phone: '(765) 555-0101' } });
R = rec('bunge-ladoga-in');
A(r.status === 200 && R.note === 'Corn dump open till 9 tonight' && R.hours.harvest === null && R.contact.phone === '(765) 555-0101', 'note one line, empty harvest is null, phone kept');
A(R.bids_updated_at === t3 && R.info_updated_at > i3, 'info change moves info time only');
r = await pub('/elev/save', { k: K1, note: 'n'.repeat(140) }); A(r.status === 200 && rec('bunge-ladoga-in').note.length === 140, '140-character note taken');
r = await pub('/elev/save', { k: K1, note: '' }); A(r.status === 200 && rec('bunge-ladoga-in').note === null, 'empty note clears to null');
r = await pub('/elev/save', { k: K1, note: 5 }); A(r.status === 400, 'note a number');
r = await pub('/elev/save', { k: K1, contact: { name: 'Wyatt', phone: 'call' } }); A(r.status === 400, 'bad phone');
r = await pub('/elev/save', { k: K1, contact: 'Wyatt' }); A(r.status === 400, 'contact not an object');
r = await pub('/elev/save', { k: K1, closed_today: 'yes' }); A(r.status === 400, 'closed_today must be true or false');
r = await pub('/elev/save', { k: K1, closed_today: true }); R = rec('bunge-ladoga-in');
A(r.status === 200 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(R.closed_until), 'closed today sets closed_until');
const cu = new Date(R.closed_until);
const ct = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(cu);
const ctDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d);
A(ct === '23:59:59' && ctDay(cu) === ctDay(new Date()), 'closed_until is the last second of today, Central time: ' + R.closed_until);
r = await pub('/elev/save', { k: K1, closed_today: false }); A(rec('bunge-ladoga-in').closed_until === null, 'open again clears it');

// ---- feed ----
r = await get('/elev/feed'); j = await r.json(); let raw = JSON.stringify(j);
A(r.status === 200 && j.ok && j.generated_at && j.elevators.length === 1 && j.elevators[0].id === 'bunge-ladoga-in', 'feed lists the active elevator');
A(r.headers.get('Cache-Control') === 'public, max-age=60', 'feed cache 60 s');
A(r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com', 'feed CORS for agsist.com');
r = await get('/elev/feed', { Origin: 'https://evil.example' });
A(r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com', 'feed never echoes a foreign origin');
A(!raw.includes('wyatt@example.com') && !raw.includes('"email"') && !raw.includes(K1) && !raw.includes('elevkey'), 'feed carries no email, key or key hash');
A(j.elevators[0].bids.length === 3 && j.elevators[0].contact.phone === '(765) 555-0101', 'feed carries bids and contact');

// ---- rekey ----
r = await admin('/elev/admin/rekey', { id: 'bunge-ladoga-in' }); j = await r.json();
const K2 = keyOf(j.link);
A(r.status === 200 && j.ok && K2 && K2 !== K1, 'rekey makes a new link');
r = await pub('/elev/me', { k: K1 }); A(r.status === 404, 'old key stops working');
r = await pub('/elev/save', { k: K1, no_change: true }); A(r.status === 404, 'old key cannot save');
r = await pub('/elev/me', { k: K2 }); A(r.status === 200, 'new key works');
A([...store.keys()].filter(k => k.startsWith('elevkey:')).length === 1, 'one pointer left after rekey');
// a pointer written without metadata is still found and dropped
const legacy = 'elevkey:' + crypto.createHmac('sha256', 'sec').update('elev|' + 'b'.repeat(24)).digest('hex').slice(0, 16);
store.set(legacy, 'bunge-ladoga-in');
r = await admin('/elev/admin/rekey', { id: 'bunge-ladoga-in' }); const K3 = keyOf((await r.json()).link);
A(!store.has(legacy) && (await pub('/elev/me', { k: 'b'.repeat(24) })).status === 404 && (await pub('/elev/me', { k: K3 })).status === 200, 'rekey drops a pointer without metadata too');
r = await admin('/elev/admin/rekey', { id: 'nobody-here' }); A(r.status === 404, 'rekey unknown id');
r = await admin('/elev/admin/rekey', { id: 'bunge-ladoga-in' }, 'nope'); A(r.status === 403, 'rekey needs the token');

// ---- a second elevator, other keys untouched ----
r = await admin('/elev/admin/create', Object.assign({}, BUNGE, { id: 'coop-two-in', name: 'Co-op Two', email: '' })); j = await r.json();
const KB = keyOf(j.link);
A(r.status === 200 && rec('coop-two-in').email === '', 'email may be empty');
const K4 = keyOf((await (await admin('/elev/admin/rekey', { id: 'bunge-ladoga-in' })).json()).link);
r = await pub('/elev/me', { k: KB }); A(r.status === 200, "a rekey leaves other elevators' links alone");

// ---- active ----
r = await admin('/elev/admin/active', { id: 'coop-two-in', active: 'no' }); A(r.status === 400, 'active must be a boolean');
r = await admin('/elev/admin/active', { id: 'coop-two-in', active: false }); j = await r.json();
A(r.status === 200 && j.active === false && rec('coop-two-in').active === false, 'turned off');
r = await pub('/elev/me', { k: KB }); j = await r.json(); A(r.status === 403 && !j.ok && !j.record, 'disabled: me refused');
r = await pub('/elev/save', { k: KB, no_change: true }); A(r.status === 403, 'disabled: save refused');
r = await get('/elev/feed'); j = await r.json(); A(j.elevators.every(e => e.id !== 'coop-two-in'), 'disabled: not in the feed');
r = await admin('/elev/admin/list'); j = await r.json();
A(r.status === 200 && j.elevators.length === 2 && j.elevators.find(e => e.id === 'bunge-ladoga-in').email === 'wyatt@example.com', 'admin list has every record with email');
A(r.headers.get('Cache-Control') === 'no-store', 'admin list not cached');
r = await admin('/elev/admin/active', { id: 'coop-two-in', active: true });
r = await pub('/elev/me', { k: KB }); A(r.status === 200, 'turned back on: link works again');
r = await admin('/elev/admin/active', { id: 'nobody-here', active: true }); A(r.status === 404, 'active unknown id');

// ---- CORS preflight ----
r = await w.fetch(new Request(H + '/elev/save', { method: 'OPTIONS', headers: { Origin: 'https://www.agsist.com' } }), env);
A(r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === 'https://www.agsist.com' && /POST/.test(r.headers.get('Access-Control-Allow-Methods')), 'preflight');
r = await w.fetch(new Request(H + '/elev/admin/list', { method: 'OPTIONS', headers: { Origin: 'https://agsist.com' } }), env);
A(/Authorization/.test(r.headers.get('Access-Control-Allow-Headers')), 'preflight allows Authorization for the admin page');

// ---- rate limit: 60 an hour per address on /elev/me ----
{
  const ip = '10.200.0.1';
  let last = 0;
  for (let i = 0; i < 61; i++) last = (await pub('/elev/me', { k: K4 }, { 'CF-Connecting-IP': ip })).status;
  A(last === 429, '61st /elev/me from one address in an hour refused');
  r = await pub('/elev/save', { k: K4, no_change: true }, { 'CF-Connecting-IP': ip }); A(r.status === 200, 'save counts apart from me');
  r = await pub('/elev/me', { k: K4 }, { 'CF-Connecting-IP': '10.200.0.2' }); A(r.status === 200, 'another address is not held');
}

// ---- no secret: a clear refusal, never an unsigned key ----
{
  const e2 = Object.assign({}, env, { UNSUB_SECRET: '' });
  r = await pub('/elev/me', { k: K3 }, {}, e2); A(r.status === 503, 'no UNSUB_SECRET: me 503');
  r = await admin('/elev/admin/create', Object.assign({}, BUNGE, { id: 'no-secret-in' }), 'tok', e2);
  A(r.status === 503 && (await r.json()).ok === false, 'no UNSUB_SECRET: create 503 json');
}

// ---- v5.21: an elevator asks to post its own bids ----
{
  const reqKeys = () => [...store.keys()].filter(k => k.startsWith('form:elevator-listing:')).sort();
  const ASK = { kind: 'elevator-listing', elevator: '  Farmers Elevator Co ', town: 'Lingle', state: 'wy', zip: '82223', name: 'Pat Doe',
    role: 'Manager', phone: '(307) 555-0100', email: 'Pat@Example.COM', crops: ['wheat', 'corn', 'corn'], how: 'phone',
    note: 'Call after 3.\r\nAsk for Pat.', dir_id: 'reg:WY|westplainsllc|lingle', page: '/list-your-elevator', extra: 'dropped' };
  r = await pub('/form', ASK); j = await r.json();
  A(r.status === 200 && j.ok, 'listing request stored');
  A(r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com', 'request answer carries CORS');
  const k0 = reqKeys()[0];
  A(/^form:elevator-listing:\d{13}:[0-9a-f]{8}$/.test(k0), 'request key shape: ' + k0);
  let q = JSON.parse(store.get(k0));
  A(q.kind === 'elevator-listing' && q.n === 0 && q.elevator === 'Farmers Elevator Co' && q.state === 'WY' && q.email === 'pat@example.com', 'request cleaned');
  A(q.crops === 'corn, wheat', 'crops: known, once each, in order: ' + q.crops);
  A(q.note === 'Call after 3.\nAsk for Pat.' && q.dir_id === 'reg:WY|westplainsllc|lingle' && !('extra' in q) && !('status' in q), 'note keeps its line break; id kept; unknown field dropped');
  r = await pub('/form', Object.assign({}, ASK, { crops: 'soybeans,corn' }));
  A(r.status === 200 && JSON.parse(store.get(reqKeys().find(x => x !== k0))).crops === 'corn, soybeans', 'crops as text');
  for (const [patch, why] of [[{ elevator: '' }, 'elevator required'], [{ town: '' }, 'town required'], [{ state: 'Wyo' }, 'state'],
      [{ zip: '8222' }, 'short zip'], [{ zip: '82223-1234' }, 'zip+4'], [{ name: '' }, 'name required'], [{ role: '' }, 'role required'],
      [{ phone: '' }, 'phone required'], [{ phone: '555-0100' }, 'phone too few digits'], [{ phone: 'call me at 3075550100' }, 'phone with words'],
      [{ email: 'nope' }, 'email'], [{ crops: [] }, 'no crop'], [{ crops: 'corn, hay' }, 'unknown crop'], [{ how: 'fax' }, 'how'], [{ how: '' }, 'how required'],
      [{ note: 'n'.repeat(601) }, 'note too long'], [{ dir_id: 'x:1' }, 'dir_id prefix'], [{ dir_id: 'known:<script>' }, 'dir_id markup'],
      [{ elevator: 'e'.repeat(121) }, 'elevator too long']]) {
    const before = reqKeys().length;
    r = await pub('/form', Object.assign({}, ASK, patch));
    A(r.status === 400 && reqKeys().length === before, 'request rejects ' + why + ' (' + r.status + ')');
  }
  const before = reqKeys().length;
  r = await pub('/form', Object.assign({}, ASK, { _gotcha: 'bot' })); A(r.status === 200 && reqKeys().length === before, 'honeypot: ok, nothing stored');
  r = await pub('/form', ASK, { Origin: 'https://evil.example' }); A(r.status === 403 && reqKeys().length === before, 'foreign origin refused');
  r = await pub('/form', 'elevator=x', { 'Content-Type': 'application/x-www-form-urlencoded' }); A(r.status === 415, 'form body refused');
  { // 8 an hour per address across every form kind
    const ip = '10.201.0.1'; let last = 0;
    for (let i = 0; i < 9; i++) last = (await pub('/form', ASK, { 'CF-Connecting-IP': ip })).status;
    A(last === 429, 'ninth request from one address in an hour refused');
  }
  // admin: list
  r = await admin('/elev/admin/requests', null, 'nope'); A(r.status === 403, 'requests needs the token');
  r = await w.fetch(new Request(H + '/elev/admin/requests?token=tok', { headers: { Origin: 'https://agsist.com' } }), env); A(r.status === 403, 'requests refuses ?token=');
  r = await admin('/elev/admin/requests'); j = await r.json();
  A(r.status === 200 && j.ok && j.requests.length === reqKeys().length && j.requests.every(x => x.key && x.status === 'pending'), 'requests listed, all pending');
  A(j.requests.every((x, i, a) => i === 0 || a[i - 1].ts >= x.ts), 'newest first');
  A(r.headers.get('Cache-Control') === 'no-store' && r.headers.get('Access-Control-Allow-Origin') === 'https://agsist.com', 'requests: no-store, CORS');
  // admin: mark
  r = await admin('/elev/admin/request', { key: k0, status: 'created', id: 'westplains-lingle-wy' }, 'nope'); A(r.status === 403, 'mark needs the token');
  r = await admin('/elev/admin/request', { key: k0, status: 'created', id: 'westplains-lingle-wy' }); j = await r.json();
  q = JSON.parse(store.get(k0));
  A(r.status === 200 && j.ok && q.status === 'created' && q.elev_id === 'westplains-lingle-wy' && q.status_ts > 0, 'marked created with the listing id');
  A(q.elevator === 'Farmers Elevator Co' && q.n === 0, 'marking keeps the request');
  r = await admin('/elev/admin/request', { key: k0, status: 'dismissed' }); q = JSON.parse(store.get(k0));
  A(r.status === 200 && q.status === 'dismissed' && !('elev_id' in q), 'dismissed; id cleared');
  for (const [body, code, why] of [[{ key: k0, status: 'done' }, 400, 'unknown status'], [{ key: k0, status: 'dismissed', id: 'x-y' }, 400, 'id only with created'],
      [{ key: k0, status: 'created', id: 'Bad Id' }, 400, 'bad id'], [{ key: 'form:claim:1700000000000:0a1b2c3d', status: 'dismissed' }, 404, 'another kind'],
      [{ key: 'elev:bunge-ladoga-in', status: 'dismissed' }, 404, 'not a form key'], [{ key: 'form:elevator-listing:1700000000000:00000000', status: 'dismissed' }, 404, 'missing'],
      [{ status: 'dismissed' }, 404, 'no key']]) {
    r = await admin('/elev/admin/request', body); A(r.status === code, 'mark refuses ' + why + ' (' + r.status + ')');
  }
  // the digest's /form-mark keeps the status
  r = await w.fetch(new Request(H + '/form-mark', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' }, body: JSON.stringify({ keys: [k0] }) }), env);
  q = JSON.parse(store.get(k0)); A(q.n === 1 && q.status === 'dismissed', 'form-mark keeps the status');
  r = await w.fetch(new Request(H + '/form-list?kind=elevator-listing', { headers: { Authorization: 'Bearer tok' } }), env); j = await r.json();
  A(Array.isArray(j) && j.length === reqKeys().length, 'form-list knows the kind');
  r = await w.fetch(new Request(H + '/count', { headers: { Authorization: 'Bearer tok' } }), env); j = await r.json();
  A(j.forms && j.forms['elevator-listing'] === reqKeys().length, '/count forms elevator-listing');
  // a request never reaches the public feed
  r = await get('/elev/feed'); A(!(await r.text()).includes('Farmers Elevator Co'), 'requests are not in the feed');
}

// ---- v5.34: a board Sig pastes by hand (NEW Cooperative, Oct 20) ----
{
  const AFTON = { commodity: 'Corn', delivery: '10/1/2026 - 10/31/2026', cash: '$4.26', basis: '-35', future: '461-4', change: '-5-4' };
  const P = { site: 'newcoop', locations: [{ name: 'Afton', rows: [AFTON] }, { name: 'Creston 1', rows: [Object.assign({}, AFTON, { cash: '$4.21', basis: '-40' })] }] };
  r = await get('/elev/paste/newcoop'); A(r.status === 404, 'nothing pasted yet is a 404');
  r = await admin('/elev/admin/paste', P, 'nope'); A(r.status === 403 && !store.has('paste:newcoop'), 'paste needs the token');
  r = await w.fetch(new Request(H + '/elev/admin/paste?token=tok', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(P) }), env);
  A(r.status === 403, 'paste refuses ?token=');
  for (const [patch, why] of [[{ site: 'cargill' }, 'unknown site'], [{ locations: [] }, 'no locations'],
      [{ locations: [{ name: 'Afton', rows: [] }] }, 'zero rows'],
      [{ locations: [{ name: 'Afton', rows: [Object.assign({}, AFTON, { future: '461.50' })] }] }, 'futures not in ticks'],
      [{ locations: [{ name: 'Afton', rows: [Object.assign({}, AFTON, { cash: 'Just a moment...' })] }] }, 'a bot check page'],
      [{ locations: [{ name: '<b>x</b>', rows: [AFTON] }] }, 'markup in a name'],
      [{ locations: [{ name: 'Afton', rows: [Object.assign({}, AFTON, { delivery: 'Oct' })] }] }, 'delivery not a range']]) {
    r = await admin('/elev/admin/paste', Object.assign({}, P, patch)); A(r.status === 400 && !store.has('paste:newcoop'), 'paste rejects ' + why);
  }
  const t0 = Date.now();
  r = await admin('/elev/admin/paste', P); j = await r.json();
  A(r.status === 200 && j.ok && j.rows === 2 && j.locations === 2, 'paste saved: ' + JSON.stringify(j));
  A(Math.abs(Date.parse(j.pastedAt) - t0) < 5000, 'pastedAt is the Worker clock at save');
  const S = JSON.parse(store.get('paste:newcoop'));
  A(S.source === "posted from NEW Cooperative's public bid page" && S.locations[0].rows[0].future === '461-4', 'stored as printed, with its source line');
  r = await w.fetch(new Request(H + '/elev/paste/newcoop'), env); j = await r.json();
  A(r.status === 200 && j.ok && j.site === 'newcoop' && j.pastedAt === S.pastedAt && j.locations.length === 2, 'public read for dnilgis/bids (no Origin needed)');
  A(/max-age=60/.test(r.headers.get('Cache-Control') || ''), 'cached a minute');
  r = await get('/elev/paste/other'); A(r.status === 404, 'unknown site 404');
  r = await get('/elev/paste-status'); j = await r.json();
  A(j.ok && j.sites.newcoop.rows === 2 && j.sites.newcoop.pastedAt === S.pastedAt, 'paste-status');
  const big = { site: 'newcoop', locations: [{ name: 'Afton', rows: [AFTON] }], pad: 'x'.repeat(300 * 1024) };
  r = await admin('/elev/admin/paste', big); A(r.status === 413, 'paste over 256 KB refused');
  // a paste the size of the real board (69 locations, 12 rows each) fits
  const full = { site: 'newcoop', locations: Array.from({ length: 69 }, (_, i) => ({ name: 'Loc ' + i, rows: Array.from({ length: 12 }, () => AFTON) })) };
  r = await admin('/elev/admin/paste', full); j = await r.json(); A(r.status === 200 && j.rows === 828, 'a full board fits: ' + JSON.stringify(full).length + ' bytes');
}

// ---- every existing route still answers ----
r = await w.fetch(new Request(H + '/nope'), env); A(r.status === 404, 'unknown path 404');
r = await get('/elev/me'); A(r.status === 404, 'GET /elev/me is not a route');

console.log('elevator portal worker: ' + n + ' checks passed');
