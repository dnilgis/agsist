// The /prf long-range outlook panel (components/prf-outlook.js) in a real
// browser, mounted on a minimal page with the synthetic sample file, at 390
// and 1280 wide, dark and light.
//
//   NODE_PATH=/home/user/node_modules node build/prf-wip/outlook-render.mjs [shots dir]
//
// Needs Playwright (not a repo dependency) and Chromium at /opt/pw-browsers/chromium,
// or set PW_CHROMIUM. Serves the repo on a random port in 20000-29999.
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_MODULE || '/home/user/node_modules/playwright');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHOTS = process.argv[2] || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const EXE = process.env.PW_CHROMIUM || findChromium('/opt/pw-browsers');

function findChromium(dir) {
  // /opt/pw-browsers/chromium-<rev>/chrome-linux/chrome, or a chromium binary given directly
  if (fs.existsSync(dir + '/chromium') && fs.statSync(dir + '/chromium').isFile()) return dir + '/chromium';
  for (const d of fs.readdirSync(dir)) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
      const p = path.join(dir, d, rel);
      if (/^chromium/.test(d) && fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

const PAGE = (today, src) => `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>outlook test</title>
<link rel="stylesheet" href="/components/styles.css">
<style>body{background:var(--bg);color:var(--text);margin:0}main{max-width:1120px;margin:0 auto;padding:0 16px 2rem}</style>
</head><body><main><h1>PRF test page</h1>
<section id="prf-outlook" data-src="${src}" data-today="${today}"></section>
</main><script src="/components/prf-outlook.js"></script></body></html>`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/t') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(PAGE(u.searchParams.get('today') || '2026-10-12', u.searchParams.get('src') || '/test/fixtures/prf-outlook/outlook-sample.json'));
  }
  const f = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
const PORT = 20000 + Math.floor(Math.random() * 10000);
await new Promise((ok) => server.listen(PORT, '127.0.0.1', ok));
const BASE = 'http://127.0.0.1:' + PORT;

const fails = [];
function check(c, what) { console.log((c ? '  ok    ' : '  FAIL  ') + what); if (!c) fails.push(what); }

const browser = await chromium.launch({ executablePath: EXE });
const TX = 13321, KS = 21721;
try {
  for (const width of [390, 1280]) {
    for (const theme of ['dark', 'light']) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
      const page = await ctx.newPage(); const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
      await page.goto(BASE + '/t');
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      const tag = `${width} ${theme}:`;
      check(/Find a grid above/.test(await page.textContent('#prf-outlook')), `${tag} waits for a grid`);
      // the grid arrives as prf.js would send it, with a split on Apr-May and Jun-Jul
      await page.evaluate((g) => document.dispatchEvent(new CustomEvent('prf:grid', { detail: { grid: g, split: [0, 0, 0, 50, 0, 50, 0, 0, 0, 0, 0] } })), TX);
      await page.waitForSelector('#prf-outlook .prfo-iv');
      const txt = await page.textContent('#prf-outlook');
      check(/ENSO:\s*El Nino Advisory/.test(txt), `${tag} ENSO line`);
      check(/D2 Severe drought at the grid’s centre/.test(txt), `${tag} drought category`);
      check(/October 2026 alone:/.test(txt) && /Leaning wet: 40 to 50% chance of above-normal/.test(txt), `${tag} one-month line`);
      check(/Seasons differ/.test(txt) && /CPC gives no figure for these two months alone/.test(txt), `${tag} straddle said in words`);
      check(/does not predict whether an interval will pay/.test(txt), `${tag} skill note`);
      check(!/\u2014/.test(txt), `${tag} no em dash`);
      const rows = await page.$$eval('#prf-outlook .prfo-iv tbody tr', (r) => r.length);
      check(rows === 11, `${tag} 11 interval rows (${rows})`);
      const heads = await page.$$eval('#prf-outlook .prfo-iv thead th[scope=col]', (r) => r.length);
      const rowHeads = await page.$$eval('#prf-outlook .prfo-iv tbody th[scope=row]', (r) => r.length);
      check(heads === 2 && rowHeads === 11, `${tag} column and row headers`);
      check((await page.$$eval('#prf-outlook .prfo-iv tbody th .prfo-mine', (r) => r.length)) === 2, `${tag} the reader's two intervals are marked`);
      const small = await page.$$eval('#prf-outlook a, #prf-outlook summary', (els) => els.filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.textContent));
      check(small.length === 0, `${tag} links and the summary are 44px tall ${small.join('|')}`);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(over <= 0, `${tag} no sideways scroll (${over}px)`);
      const fg = await page.$eval('#prf-outlook .prfo-iv td', (e) => getComputedStyle(e).color);
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      check(fg !== bg, `${tag} text and page colours differ (${fg} on ${bg})`);
      await page.click('#prf-outlook summary');
      check(await page.isVisible('#prf-outlook .prfo-enso'), `${tag} sources open, ENSO table inside`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/outlook-${width}-${theme}.png`, fullPage: true });
      // another grid replaces the panel
      await page.evaluate((g) => document.dispatchEvent(new CustomEvent('prf:grid', { detail: { grid: g } })), KS);
      await page.waitForFunction(() => /None: not in drought/.test(document.querySelector('#prf-outlook').textContent));
      check(/Equal chances/.test(await page.textContent('#prf-outlook')), `${tag} Kansas grid shown after the switch`);
      check(errs.length === 0, `${tag} no script errors ${errs.join(' | ')}`);
      await ctx.close();
    }
  }

  // old data is withheld with the reason; a missing file says so
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/t?today=2026-12-20');
  await page.evaluate((g) => document.dispatchEvent(new CustomEvent('prf:grid', { detail: { grid: g } })), TX);
  await page.waitForFunction(() => /Withheld/.test(document.querySelector('#prf-outlook').textContent));
  const t = await page.textContent('#prf-outlook');
  check(/Withheld\. The newest one here was issued Sep 17, 2026, 94 days ago/.test(t), 'stale seasonal outlook withheld with its date');
  check(!(await page.$('#prf-outlook .prfo-iv')), 'no interval table from a stale outlook');
  check(/Withheld\. The newest Drought Monitor map here is for Oct 6, 2026/.test(t), 'stale drought map withheld');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/outlook-390-stale.png`, fullPage: true });
  await page.goto(BASE + '/t?src=/nothing.json');
  await page.evaluate((g) => document.dispatchEvent(new CustomEvent('prf:grid', { detail: { grid: g } })), TX);
  await page.waitForFunction(() => /did not load/.test(document.querySelector('#prf-outlook').textContent));
  check(true, 'a missing file says it did not load');
  // without the event: the state prf.js already exposes is read
  await page.goto(BASE + '/t');
  await page.evaluate((g) => { window.AgPrf = { state: { grid: g, on: 'A', A: { split: [] } } }; }, KS);
  await page.waitForSelector('#prf-outlook .prfo-iv', { timeout: 5000 });
  check(/grid 21721/.test(await page.textContent('#prf-outlook .prfo-iv caption')), 'falls back to window.AgPrf.state');
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}
console.log(fails.length ? `outlook render: ${fails.length} failure(s)` : 'outlook render: all passed');
process.exit(fails.length ? 1 : 0);
