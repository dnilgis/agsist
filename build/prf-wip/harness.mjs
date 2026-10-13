// Drive /prf in a real browser. usage: node harness.mjs <scenario> [width]
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
/* the repo this file sits in, and shots beside it; PRF_ROOT and PRF_SHOTS override */
const ROOT = process.env.PRF_ROOT || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = process.env.PRF_SHOTS || path.join(ROOT, 'build/shots'); fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/prf') p = '/prf.html'; if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
}).listen(0);
const PORT = server.address().port, BASE = 'http://localhost:' + PORT;
export async function open(opts = {}) {
  const browser = await chromium.launch(process.env.PRF_CHROMIUM ? { executablePath: process.env.PRF_CHROMIUM } : {});
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: opts.width || 1280, height: opts.height || 900 }, deviceScaleFactor: 1, colorScheme: opts.light ? 'light' : 'dark', geolocation: opts.geo, permissions: opts.geo ? ['geolocation'] : [] });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE)) return route.continue();
    if (u.includes('geocoding-api.open-meteo.com')) {
      const q = new URL(u).searchParams.get('name');
      if (opts.geocode && opts.geocode[q] !== undefined) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(opts.geocode[q]) });
      return route.fulfill({ contentType: 'application/json', body: '{}' });
    }
    return route.abort();
  });
  if (opts.routes) for (const [pat, fn] of opts.routes) await page.route(pat, fn);
  return { browser, page, errs, BASE, shot: (n, o = {}) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: o.full !== false, ...o }) };
}
export function done() { server.close(); }
export const overflow = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
/* On a phone, step 2 (the policy controls) is folded to one line until it is tapped; the productivity factor sits under "Productivity factor". */
export const openSetup = (page) => page.evaluate(() => { const b = document.getElementById('prf-setup-sum'); if (b && b.offsetParent && b.getAttribute('aria-expanded') !== 'true') b.click(); const m = document.getElementById('prf-more'); if (m) m.open = true; });
