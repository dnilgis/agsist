// agsist-clock v2 against a fake GitHub API. No network.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const src = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'workers', 'agsist-clock.js');
const tmp = path.join(os.tmpdir(), 'agsist-clock-test.mjs'); fs.copyFileSync(src, tmp);
const w = (await import(pathToFileURL(tmp).href)).default;
let n = 0; const A = (c, m) => { if (!c) { console.log('FAIL', m); process.exit(1); } n++; };
let running = { in_progress: 0, queued: 0 }, calls = [];
globalThis.fetch = async (url, init) => {
  calls.push((init && init.method || 'GET') + ' ' + url.replace('https://api.github.com/repos/dnilgis/agsist', ''));
  const m = /status=(in_progress|queued)/.exec(url);
  if (m) return new Response(JSON.stringify({ total_count: running[m[1]] }), { status: 200 });
  return new Response(null, { status: 204 });
};
const env = { GH_TOKEN: 't' };
const fire = async iso => { calls = []; await w.scheduled({ scheduledTime: Date.parse(iso) }, env, {}); return calls.filter(c => c.startsWith('POST')); };
// Wed 2026-10-07 14:07 UTC = 09:07 CDT: day session, no loop -> start prices; :07 in bids window -> bids too
let p = await fire('2026-10-07T14:07:00Z');
A(p.some(c => c.includes('prices.yml/dispatches')) && p.some(c => c.includes('fetch_bids.yml/dispatches')), 'gap filled + bids as before');
running.in_progress = 1;
p = await fire('2026-10-07T14:22:00Z');
A(p.length === 0, 'loop running: start nothing (and :22 is not a bids minute)');
running.in_progress = 0; running.queued = 1;
p = await fire('2026-10-07T14:52:00Z'); A(p.length === 0, 'a queued loop counts as running');
running.queued = 0;
p = await fire('2026-10-07T20:22:00Z'); A(p.length === 0, '15:22 CDT: after the window, nothing');
p = await fire('2026-10-07T23:52:00Z'); A(p.some(c => c.includes('prices.yml')), '18:52 CDT Wed: Globex evening, gap filled');
p = await fire('2026-10-10T23:52:00Z'); A(p.length === 0, 'Fri evening: market shut, nothing');
p = await fire('2026-10-11T23:52:00Z'); A(p.some(c => c.includes('prices.yml')), 'Sun evening: reopen, gap filled');
p = await fire('2026-10-08T07:07:00Z'); A(p.some(c => c.includes('prices.yml')), '02:07 CDT Thu: past midnight still covered');
p = await fire('2026-10-08T08:07:00Z'); A(p.length === 0, '03:07 CDT: quiet hours, nothing');
p = await fire('2026-12-09T11:07:00Z'); A(p.some(c => c.includes('prices.yml')), 'winter: 05:07 CST counts (DST handled)');
// an API error must not start a second loop
globalThis.fetch = async (url, init) => { calls.push(url); return url.includes('status=') ? new Response('x', { status: 500 }) : new Response(null, { status: 204 }); };
calls = []; await w.scheduled({ scheduledTime: Date.parse('2026-10-07T14:22:00Z') }, env, {});
A(!calls.some(c => String(c).includes('prices.yml/dispatches')), 'unknown state: never start a second loop');
console.log('agsist-clock ok', n, 'checks');
