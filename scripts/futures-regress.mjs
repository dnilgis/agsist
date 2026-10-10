/* futures-regress.mjs: render the corn, soybean and wheat futures pages from two
 * trees under the same fixed data and the same frozen clock, and print every
 * line of reader-visible text that differs.
 *
 * Built for the 2026-10-10 move of the three pages onto components/futures.js:
 * the old pages (before) and the new ones (after) had to read the same, except
 * for the fixes listed in the commit. Use it again for any edit to the shared
 * module: a difference that is not the change you meant is a regression.
 *
 *   node scripts/futures-regress.mjs <before-root> <after-root>
 *
 * Each root is a site tree (the repo, or an extracted copy of an older commit:
 * `git archive <ref> *futures-prices.html components css | tar -x -C dir`).
 * Data comes from test/fixtures/futures (base, plus open/roll overrides), never
 * from the tree's own data/, so both sides read identical numbers. Network
 * requests outside localhost are blocked. States: open (Thu 10:30 CT, in
 * session), closed (Saturday), roll (front month just rolled), zip (closed,
 * with a saved ZIP, breakeven and percent-priced). Widths 390 and 1280.
 * Exit 1 when any text, page error or horizontal overflow differs.
 */
import http from 'http'; import fs from 'fs'; import path from 'path'; import zlib from 'zlib';
import { fileURLToPath } from 'url';

const PW = process.env.PLAYWRIGHT || '/home/user/node_modules/playwright/index.mjs';
const CHROME = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
const { chromium } = await import(PW);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(HERE, '..', 'test', 'fixtures', 'futures');
const [beforeRoot, afterRoot] = process.argv.slice(2);
if (!beforeRoot || !afterRoot) { console.error('usage: node scripts/futures-regress.mjs <before-root> <after-root>'); process.exit(2); }
const PAGES = (process.env.PAGES || 'corn-futures-prices,soybean-futures-prices,wheat-futures-prices').split(',');
const STATES = { open: '2026-10-08T15:30:00Z', closed: '2026-10-10T16:00:00Z', roll: '2026-10-09T21:00:00Z', zip: '2026-10-10T16:00:00Z' };
const LS = { zip: { agsist_user_zip: '50010', agsist_be_corn: '4.50', agsist_be_beans: '11.20', agsist_be_wheat: '6.10',
  agsist_priced_corn: '40', agsist_priced_beans: '40', agsist_priced_wheat: '40' } };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webp': 'image/webp' };

function fixture(state, name) {
  for (const d of [state === 'zip' || state === 'closed' ? 'base' : state, 'base']) {
    const f = path.join(FX, d, name + '.gz');
    if (fs.existsSync(f)) return zlib.gunzipSync(fs.readFileSync(f));
  }
  return null;
}

async function render(root) {
  let state = 'closed';
  const srv = http.createServer((q, r) => {
    const p = decodeURIComponent(q.url.split('?')[0]);
    if (p.startsWith('/data/')) {
      const b = fixture(state, p.slice(6));
      if (b) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end(b); }
      r.writeHead(404); return r.end();
    }
    const f = path.join(root, p);
    const c = [f, f + '.html', path.join(f, 'index.html')].find(x => { try { return fs.statSync(x).isFile(); } catch { return false; } });
    if (!c) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': TYPES[path.extname(c)] || 'application/octet-stream' });
    fs.createReadStream(c).pipe(r);
  });
  await new Promise(res => srv.listen(0, res));
  const port = srv.address().port;
  const b = await chromium.launch({ executablePath: CHROME });
  const out = {};
  for (const [st, now] of Object.entries(STATES)) {
    state = st;
    for (const w of [390, 1280]) {
      const ctx = await b.newContext({ viewport: { width: w, height: 900 }, serviceWorkers: 'block', colorScheme: 'light', timezoneId: 'America/Chicago' });
      await ctx.route(u => !u.href.startsWith('http://localhost'), r => r.abort());
      if (LS[st]) await ctx.addInitScript(`(()=>{const o=${JSON.stringify(LS[st])};try{for(const k in o)localStorage.setItem(k,o[k]);}catch(e){}})()`);
      await ctx.addInitScript(`(()=>{const T=${Date.parse(now)};const D=Date;const t0=D.now();class FD extends D{constructor(...a){if(a.length===0){super(T+(D.now()-t0))}else{super(...a)}} static now(){return T+(D.now()-t0)}};FD.UTC=D.UTC;FD.parse=D.parse;window.Date=FD;})()`);
      for (const pg of PAGES) {
        const p = await ctx.newPage(); const errs = [];
        p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
        await p.goto(`http://localhost:${port}/${pg}`, { waitUntil: 'load' });
        await p.waitForTimeout(+(process.env.WAIT || 4500));
        const r = await p.evaluate(() => ({ text: document.body.innerText, w: document.documentElement.scrollWidth }));
        out[`${pg}|${st}|${w}`] = { text: r.text, overflow: r.w > w, errs };
        await p.close();
      }
      await ctx.close();
    }
  }
  await b.close(); srv.close();
  return out;
}

/* Line diff, longest-common-subsequence on lines. */
function diff(a, b) {
  const A = a.split('\n'), B = b.split('\n'), n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const o = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) o.push('- ' + A[i++]); else o.push('+ ' + B[j++]); }
  while (i < n) o.push('- ' + A[i++]); while (j < m) o.push('+ ' + B[j++]);
  return o;
}

const before = await render(path.resolve(beforeRoot));
const after = await render(path.resolve(afterRoot));
let bad = 0;
for (const k of Object.keys(before)) {
  const a = before[k], z = after[k];
  const d = diff(a.text, z.text);
  const problems = [];
  if (z.errs.length) problems.push('page errors after: ' + z.errs.join(' | '));
  if (z.overflow && !a.overflow) problems.push('horizontal overflow after');
  if (d.length || problems.length) {
    bad++;
    console.log(`== ${k}: ${d.length} line(s) differ`);
    d.forEach(l => console.log('   ' + l.slice(0, 300)));
    problems.forEach(l => console.log('   !! ' + l));
  }
}
console.log(`${Object.keys(before).length} renders compared, ${bad} with differences`);
process.exit(bad ? 1 : 0);
