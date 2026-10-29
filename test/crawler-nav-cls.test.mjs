// The crawler nav does not shift the page while it parses (Oct 29, 2026).
//
// Every page with static-nav:header (scripts/inject_static_nav.py) carries a plain nav for crawlers and readers
// without scripts. styles.css lays it out as one unwrapped line (its <br>s hidden), about 8,700px long and
// clipped to the header. A paint while the parser sat just past a "<br>" and its newline left that whitespace
// with no place yet; the next group then put it about 1,500px along the line. Chrome scores text by where it
// starts, so it counted a move of 900px or more while the clipped box it reports stayed put (CI on #165:
// 0.0129 at 390 on /milk-prices). Pausing the page at that byte did it every time.
//
// styles.css now keeps that nav unseen (its space kept) while scripts are on, until loader.js swaps in the live
// nav, and shows it after 3 s regardless. Without scripts it shows as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CSS = fs.readFileSync(join(ROOT, 'components/styles.css'), 'utf8');
// the homepage and two generated sets (ARC/PLC county, cash-bids town)
const PAGES = [['/', 'index.html'], ['/arc-plc/iowa/adair-county', 'arc-plc/iowa/adair-county.html'], ['/cash-bids/wisconsin/cadott', 'cash-bids/wisconsin/cadott.html']];

test('the hold is in styles.css once, and no page keeps its own copy', () => {
  assert.equal((CSS.match(/@media \(scripting:enabled\)\{#site-header>header nav\{animation:snav-wait 3s step-end both\}\}/g) || []).length, 1);
  assert.equal((CSS.match(/@keyframes snav-wait\{from\{visibility:hidden\}to\{visibility:visible\}\}/g) || []).length, 1);
  const own = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && fs.readFileSync(join(ROOT, f), 'utf8').includes('snav-wait'));
  for (const [, f] of PAGES) if (fs.readFileSync(join(ROOT, f), 'utf8').includes('snav-wait')) own.push(f);
  assert.deepEqual(own, []);
  for (const [, f] of PAGES) {
    const s = fs.readFileSync(join(ROOT, f), 'utf8');
    assert.ok(s.includes('static-nav:header'), `${f} carries the crawler nav`);
    assert.ok(s.includes('/components/styles.css?v=28'), `${f} loads the styles.css that has the hold`);
  }
});

const PW = process.env.PLAYWRIGHT_PATH || '/home/user/node_modules/playwright/index.mjs';
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? 'Playwright or Chromium not found here' : false;

/* serves the repo; with pauseAt, the page `pausePage` comes up to that byte, then the rest after a pause */
function serve(pausePage = null, pauseAt = -1) {
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html'; else if (!extname(p)) p += '.html';
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' });
    const buf = fs.readFileSync(f);
    if (pausePage && f === join(ROOT, pausePage)) { res.write(buf.subarray(0, pauseAt)); setTimeout(() => res.end(buf.subarray(pauseAt)), 400); return; }
    res.end(buf);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}
const local = (r) => (new URL(r.request().url()).hostname !== '127.0.0.1' ? r.abort() : r.continue());

test('a paint while the parser is inside the crawler nav moves nothing: homepage and two generated pages, 390 and 1280', { skip, timeout: 180000 }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const bad = [];
  try {
    for (const [url, file] of PAGES) {
      const s = fs.readFileSync(join(ROOT, file)).toString('latin1');
      const nav = s.indexOf('<nav aria-label="AGSIST main navigation"'), end = s.indexOf('</nav>', nav), stops = [];
      for (let at = s.indexOf('<br>\n', nav); at > 0 && at < end; at = s.indexOf('<br>\n', at + 1)) stops.push(at + 5 + /^ */.exec(s.slice(at + 5))[0].length);
      assert.ok(stops.length >= 3, `${file}: the crawler nav's groups are split by <br>`);
      for (const w of [390, 1280]) for (const stop of [stops[0], stops[2]]) {
        const srv = await serve(file, stop);
        const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: 900 } });
        try {
          await ctx.route('**/*', local);
          await ctx.addInitScript(() => {
            window.__nav = []; // shifts with a source in the header, told apart when they happen (the header is swapped later)
            new PerformanceObserver((l) => { for (const e of l.getEntries()) {
              const src = (e.sources || []).filter((x) => x.node && (x.node.nodeType === 1 ? x.node : x.node.parentElement)?.closest('#site-header'));
              if (src.length) window.__nav.push(e.value.toFixed(4) + ' ' + src.map((x) => x.node.nodeName + ' ' + JSON.stringify(String(x.node.textContent).slice(0, 12))).join(',') + ' at ' + Math.round(e.startTime) + 'ms');
            } }).observe({ type: 'layout-shift', buffered: true });
          });
          const pg = await ctx.newPage();
          await pg.goto(`http://127.0.0.1:${srv.address().port}${url}`, { waitUntil: 'load' });
          await pg.waitForTimeout(500);
          const r = await pg.evaluate(() => window.__nav);
          if (r.length) bad.push(`${file} ${w} wide, paused at byte ${stop}: ${r.join(' | ')}`);
        } finally { await ctx.close(); srv.close(); }
      }
    }
  } finally { await browser.close(); }
  assert.deepEqual(bad, []);
});

test('without scripts the crawler nav shows at once, and nothing is held', { skip, timeout: 60000 }, async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [url, file] of PAGES) {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 900 }, javaScriptEnabled: false });
      await ctx.route('**/*', local);
      const pg = await ctx.newPage();
      await pg.goto(`http://127.0.0.1:${srv.address().port}${url}`, { waitUntil: 'load' });
      const nav = pg.locator('#site-header > header nav');
      assert.equal(await nav.evaluate((n) => getComputedStyle(n).visibility), 'visible', `${file}: shown`);
      assert.equal(await nav.evaluate((n) => getComputedStyle(n).animationName), 'none', `${file}: no hold without scripts`);
      assert.ok(await pg.locator('#site-header > header nav a[href="/cash-bids"]').isVisible(), `${file}: its links can be used`);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

test('the live nav never comes (loader.js blocked): the crawler nav shows after 3 s', { skip, timeout: 90000 }, async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [url, file] of PAGES) {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 900 } });
      await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); return u.hostname !== '127.0.0.1' || u.pathname === '/components/loader.js' ? r.abort() : r.continue(); });
      const pg = await ctx.newPage();
      await pg.goto(`http://127.0.0.1:${srv.address().port}${url}`, { waitUntil: 'load' });
      const vis = () => pg.evaluate(() => { const n = document.querySelector('#site-header > header nav'); return { v: n ? getComputedStyle(n).visibility : 'gone', t: performance.now() }; });
      const first = await vis();
      if (first.t < 2500) assert.equal(first.v, 'hidden', `${file}: unseen at first`); // a slow machine can pass 3 s before load
      await pg.waitForTimeout(Math.max(0, 3300 - first.t));
      assert.equal((await vis()).v, 'visible', `${file}: shown once the 3 s are up`);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
