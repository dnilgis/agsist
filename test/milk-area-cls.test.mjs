// /milk-prices "Your area" moves nothing when it fills (Oct 28, 2026). Before this, a reader with a saved
// place saw the summary first, then components/milk-tools.js swapped in the taller area card and pushed
// the page down (CLS 0.048 at 390, 0.044 at 1280). The page's before-paint script now lays the card out
// (blank bars, or the ask for a split state) from the saved place; this checks it picks what
// milk-tools.js picks, and measures the shift in a real browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const page = fs.readFileSync(join(ROOT, 'milk-prices.html'), 'utf8');
const M = require('../components/milk-tools.js');
const EARLY = /<script>(\/\* before paint \(agsist-milk-area-early\)[\s\S]*?)<\/script>/.exec(page);
const OPTIONS = [...page.matchAll(/<option value="([^"]*)">/g)].map((m) => m[1])
  .filter((v, i, a) => a.indexOf(v) === i && (v === '' || /^[A-Z]/.test(v)));
const AREAS = [...new Set(Object.values(M.BY_STATE).concat(...Object.values(M.SPLIT)))];

/* run the before-paint script against a fake card and storage; returns what it laid out */
function early(store) {
  const kids = [], attrs = {}, cls = new Set();
  const out = {
    get firstChild() { return kids[0] || null; },
    insertBefore(n) { kids.unshift(n); },
    insertAdjacentHTML(_, h) { kids.push({ html: h }); },
    setAttribute(k, v) { attrs[k] = v; },
    querySelector() { return null; },
  };
  const sel = { options: OPTIONS.map((value) => ({ value })), value: '' };
  const els = { 'dp-area-out': out, 'dp-area-sel': sel, 'dp-area': { classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) } },
    'dp-area-sum': { textContent: 'Mailbox price, June 2026, against Jun 2025: fell most in Wisconsin' } };
  const document = {
    getElementById: (id) => els[id] || null,
    createElement: () => { const n = { attrs: {}, setAttribute(k, v) { n.attrs[k] = v; } }; return n; },
  };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null) };
  vm.runInNewContext(EARLY[1], { document, localStorage, setTimeout: () => 0, Date, JSON, String });
  const sk = kids.find((k) => k.html);
  const ask = kids.find((k) => k.attrs && 'data-early' in k.attrs);
  return {
    area: sk ? /data-area="([^"]*)"/.exec(sk.html)[1] : '', ask: ask ? ask.innerHTML : '', html: sk ? sk.html : '',
    waiting: cls.has('dp-area-wait'), busy: attrs['aria-busy'] === 'true', sel: sel.value,
  };
}
/* what components/milk-tools.js shows for the same storage: {area} or {ask} */
function final(store) {
  const ls = { getItem: (k) => (k in store ? store[k] : null) };
  const saved = store['agsist-milk-area'];
  const st = M.readState(ls);
  if (saved && OPTIONS.includes(saved) && saved) return { area: saved, ask: '' };
  const a = M.areaForState(st);
  if (a && a.area) return { area: a.area, ask: '' };
  return { area: '', ask: a ? M.askHtml(st, a).replace(/^<p class="dp-area-sum">|<\/p>$/g, '') : '' };
}

test('the before-paint script is on the page, after the card, outside the seed', () => {
  assert.ok(EARLY, 'agsist-milk-area-early script present');
  const at = page.indexOf(EARLY[0]);
  assert.ok(at > page.indexOf('<div id="dp-area-out"') && at < page.indexOf('<section class="dp-dmc"'), 'between the card and the DMC card');
  assert.ok(page.lastIndexOf('<!--/SEED-->', at) > page.lastIndexOf('<!--SEED:milkarea-->', at), 'not inside the seeded part');
  assert.match(EARLY[1], /^\/\*[\s\S]*?\*\/try\{/, 'storage blocked: it does nothing and throws nothing');
  assert.match(EARLY[1], /setTimeout\(/, 'gives the summary back if the numbers never come');
  assert.equal(/var Z3 = '([^']+)'/.exec(fs.readFileSync(join(ROOT, 'components/milk-tools.js'), 'utf8'))[1], /Z='([^']+)'/.exec(EARLY[1])[1], 'the same ZIP table');
  // the card's body is held unseen from the head until that script has run (a slow line paints half pages)
  const pend = /<script>(\/\* agsist-milk-area-pend[\s\S]*?)<\/script>/.exec(page);
  assert.ok(pend && page.indexOf(pend[0]) < page.indexOf('</head>'), 'the hold is set in the head');
  assert.match(pend[1], /^\/\*[\s\S]*?\*\/try\{/, 'storage blocked: no hold, nothing thrown');
  assert.match(pend[1], /setTimeout\(function\(\)\{d\.classList\.remove\('dp-area-pend'\);\},3000\)/, 'let go after 3 s regardless');
  assert.match(page, /\.dp-area-pend #dp-area-out\{visibility:hidden;\}/, 'unseen, its space kept');
  // the DMC countdown under the card is recounted on the reader's clock at the end of the page; a day-old bake
  // ("51 days left" to "50") slid the rest of that line 3.8px in Inter (seen here Oct 29: 0.0001 at 1280)
  assert.match(page, /#dp-dmc-words,#dp-dmc-lever\{font-variant-numeric:tabular-nums;\}/);
  assert.match(EARLY[0], /\}catch\(_\)\{\}try\{document\.documentElement\.classList\.remove\('dp-area-pend'\);\}catch\(_\)\{\}<\/script>$/, 'let go as soon as it has run, whatever it did');
  // the crawler nav (static-nav:header) is unseen while scripts run, its space kept, and shown after 3 s regardless;
  // the rule lives once, in components/styles.css (test/crawler-nav-cls.test.mjs), not in this page
  const shell = fs.readFileSync(join(ROOT, 'components/styles.css'), 'utf8');
  assert.match(shell, /@media \(scripting:enabled\)\{#site-header>header nav\{animation:snav-wait 3s step-end both\}\}/);
  assert.match(shell, /@keyframes snav-wait\{from\{visibility:hidden\}to\{visibility:visible\}\}/);
  assert.doesNotMatch(page, /snav-wait/, 'one copy: none left in the page');
  assert.equal(AREAS.length, 20);
  for (const a of AREAS) assert.ok(OPTIONS.includes(a), a);
});

test('it lays out what milk-tools.js shows: every state, every ZIP prefix, a saved area, nothing saved', () => {
  const cases = [{}, { 'agsist-wx-loc': 'not json' }, { 'agsist-wx-loc': '{"state":"ZZ"}' }, { 'agsist-milk-area': 'Atlantis' }];
  for (const st of Object.keys(M.BY_STATE).concat(Object.keys(M.SPLIT), ['MT', 'ND', 'CO', 'DC', 'HI'])) cases.push({ 'agsist-wx-loc': JSON.stringify({ state: st }) });
  const z3 = /var Z3 = '([^']+)'/.exec(fs.readFileSync(join(ROOT, 'components/milk-tools.js'), 'utf8'))[1];
  for (let i = 0; i < z3.length; i += 5) {
    const zip = String(+z3.substr(i, 3) + 0).padStart(3, '0') + '01';
    cases.push({ agsist_user_zip: zip }, { agsist_zip: zip }, { 'agsist-wx-loc': JSON.stringify({ zip }) });
    cases.push({ 'agsist-wx-loc': JSON.stringify({ zip }), agsist_user_zip: '53701' }); // a saved place's own ZIP wins
  }
  for (const a of AREAS) cases.push({ 'agsist-milk-area': a }, { 'agsist-milk-area': a, 'agsist-wx-loc': JSON.stringify({ state: 'TX' }) });
  for (const c of cases) {
    const e = early(c), f = final(c), k = JSON.stringify(c);
    assert.equal(e.area, f.area, `${k}: the same area`);
    assert.equal(e.ask, f.ask, `${k}: the same ask, word for word`);
    assert.equal(e.waiting, !!f.area, `${k}: bars only when an area will fill`);
    assert.equal(e.busy, !!f.area, k);
    if (f.area) assert.equal(e.sel, f.area, `${k}: the picker shows the area at once`);
  }
});

test('the bars carry no number a reader could take for a price', () => {
  const e = early({ 'agsist-wx-loc': JSON.stringify({ state: 'WI' }) });
  assert.match(e.html, /^<div class="dp-area-skel" aria-hidden="true"/);
  assert.match(page, /\.dp-area-skel p,\.dp-area-skel span\{color:transparent;/);
  assert.match(page, /\.dp-area-wait #dp-area-out>:not\(\.dp-area-skel\)\{display:none;\}/);
  // the picker's width is set, not taken from its options: a slow machine paints while the parser is still
  // inside the <select> (42px with no options yet), and the later options widened it until it wrapped below
  // the heading at 390 (CI, Oct 28: 0.0104). 13.5em holds "Western Pennsylvania" in Inter and its fallbacks.
  assert.match(page, /\.dp-area-pick select\{width:13\.5em;[^}]*max-width:100%;/);
  // the all-milk line only where milk-tools.js can print one (a single-state area)
  assert.match(e.html, /Wisconsin all-milk price/);
  assert.match(early({ 'agsist-wx-loc': JSON.stringify({ state: 'VT' }) }).html, /Vermont all-milk price/);
  assert.doesNotMatch(early({ 'agsist-milk-area': 'New England States' }).html, /all-milk price/);
});

/* ---------- in a real browser ---------- */
const PW = process.env.PLAYWRIGHT_PATH || '/home/user/node_modules/playwright/index.mjs';
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? 'Playwright or Chromium not found here' : false;

function serve(chunk = 0, pauseAt = -1) {
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html'; else if (!extname(p)) p += '.html';
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' });
    const buf = fs.readFileSync(f);
    // the parser stopped at one byte: the page up to it, a pause long enough to paint, then the rest
    if (pauseAt >= 0 && extname(f) === '.html') { res.write(buf.subarray(0, pauseAt)); setTimeout(() => res.end(buf.subarray(pauseAt)), 400); return; }
    if (!chunk || extname(f) !== '.html') { res.end(buf); return; }
    // a slow line: the page comes in pieces, so the browser paints parts of it before the rest arrives
    let at = 0;
    const next = () => { res.write(buf.subarray(at, at + chunk)); at += chunk; if (at >= buf.length) res.end(); else setTimeout(next, 40); };
    next();
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

test('Your area fills without moving anything, at 390 and 1280, light and dark, with and without a saved place', { skip, timeout: 240000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const places = [
    ['Wisconsin place', { 'agsist-wx-loc': JSON.stringify({ state: 'WI' }) }, 'Wisconsin'],
    ['saved area', { 'agsist-milk-area': 'Northwest States' }, 'Northwest States'],
    ['ZIP only', { agsist_user_zip: '55401' }, 'Minnesota'],
    ['split state', { 'agsist-wx-loc': JSON.stringify({ state: 'PA' }) }, ''],
    ['unreported state', { 'agsist-wx-loc': JSON.stringify({ state: 'MT' }) }, ''],
    ['no saved place', {}, ''],
  ];
  try {
    for (const w of [390, 1280]) for (const theme of ['light', 'dark']) for (const [name, store, area] of places) {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: 900 }, colorScheme: theme });
      // the mailbox file comes late, so the page paints well before the card fills
      await ctx.route('**/*', async (r) => {
        const u = new URL(r.request().url());
        if (u.hostname !== '127.0.0.1') return r.abort();
        if (u.pathname === '/data/dairy-mailbox.json') await new Promise((ok) => setTimeout(ok, 700));
        return r.continue();
      });
      await ctx.addInitScript(([s, t]) => {
        try { localStorage.setItem('agsist-theme', t); for (const k of Object.keys(s)) localStorage.setItem(k, s[k]); } catch (e) {}
        window.__cls = 0; window.__late = 0; window.__shifts = []; window.__t0 = Infinity;
        // the card fills after the page's data lands (the agsist-milk event); shifts from then on are the card's
        document.addEventListener('agsist-milk', () => { window.__t0 = performance.now(); });
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) {
            if (e.hadRecentInput) continue;
            window.__cls += e.value; if (e.startTime >= window.__t0) window.__late += e.value;
            window.__shifts.push(e.value.toFixed(4) + ' ' + (e.sources || []).map((s) => { const n = s.node, pe = n && n.parentElement; return n ? (pe ? (pe.id || pe.className) + '>' : '') + (n.id || n.nodeName) + ' "' + String(n.textContent || '').slice(0, 30) + '" ' + [s.previousRect.x, s.previousRect.y, s.previousRect.width, s.previousRect.height].map(Math.round).join('/') + '->' + [s.currentRect.x, s.currentRect.y, s.currentRect.width, s.currentRect.height].map(Math.round).join('/') + ' at ' + Math.round(e.startTime) + 'ms' : '?'; }).join(','));
          }
        }).observe({ type: 'layout-shift', buffered: true });
      }, [store, theme]);
      const pg = await ctx.newPage();
      const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
      await pg.goto(`http://127.0.0.1:${port}/milk-prices`, { waitUntil: 'load' });
      const tag = `${w} ${theme} ${name}`;
      if (area) assert.equal(await pg.locator('#dp-area-sel').inputValue(), area, `${tag}: the picker shows the area before the numbers`);
      if (area) await pg.waitForFunction(() => document.querySelector('#dp-area-out > .dp-area-big'), null, { timeout: 20000 });
      else await pg.waitForFunction(() => window.agsistMilk, null, { timeout: 20000 });
      await pg.waitForTimeout(400);
      const r = await pg.evaluate(() => ({ cls: window.__cls, late: window.__late, t0: window.__t0, shifts: window.__shifts, skel: !!document.querySelector('.dp-area-skel'),
        wait: document.getElementById('dp-area').classList.contains('dp-area-wait'), busy: document.getElementById('dp-area-out').getAttribute('aria-busy'),
        text: document.getElementById('dp-area-out').innerText, sw: document.documentElement.scrollWidth }));
      assert.ok(isFinite(r.t0), `${tag}: the page's data landed`);
      assert.equal(r.late, 0, `${tag}: layout shift while Your area filled ${r.late} (${r.shifts.join(' | ')})`);
      // the whole load: under a busy machine Chrome can log a speck (under 0.0001) at first paint, above the card
      // (the page kicker, a heading icon) before the card has data; main measured 0.0075 to 0.048 from the card
      assert.ok(r.cls < 0.001, `${tag}: layout shift ${r.cls} (${r.shifts.join(' | ')})`);
      assert.equal(r.skel, false, `${tag}: the bars are gone`);
      assert.equal(r.wait, false, tag);
      assert.equal(r.busy, null, tag);
      assert.ok(r.sw <= w, `${tag}: no sideways scroll (${r.sw})`);
      if (area) assert.match(r.text, new RegExp(`^${area} mailbox price, \\w+ \\d{4}`), `${tag}: the area's own price`);
      else assert.match(r.text, /Pick your area for its own price first/, `${tag}: the summary stays`);
      if (name === 'split state') assert.equal((r.text.match(/is split between AMS mailbox areas/g) || []).length, 1, `${tag}: the ask once`);
      if (name === 'unreported state') assert.equal((r.text.match(/does not report a mailbox price for Montana/g) || []).length, 1, `${tag}: the ask once`);
      // a reader's own pick may move the page (that is input), and lets go of the held height
      if (area) {
        await pg.selectOption('#dp-area-sel', 'California');
        assert.equal(await pg.evaluate(() => document.getElementById('dp-area-out').style.minHeight), '', `${tag}: no held height after a pick`);
        assert.match(await pg.locator('#dp-area-out').innerText(), /^California mailbox price/);
      }
      assert.deepEqual(errs, [], tag);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

test('the mailbox file does not answer: the summary comes back, no bars left behind', { skip, timeout: 60000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 900 } });
    await ctx.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.hostname !== '127.0.0.1' || u.pathname === '/data/dairy-mailbox.json') return r.abort();
      return r.continue();
    });
    await ctx.addInitScript(() => { try { localStorage.setItem('agsist-wx-loc', JSON.stringify({ state: 'WI' })); } catch (e) {} });
    const pg = await ctx.newPage();
    await pg.goto(`http://127.0.0.1:${port}/milk-prices`, { waitUntil: 'load' });
    await pg.waitForFunction(() => !document.querySelector('.dp-area-skel'), null, { timeout: 15000 });
    assert.match(await pg.locator('#dp-area-out').innerText(), /Pick your area for its own price first/);
    assert.equal(await pg.locator('#dp-area-sum').isVisible(), true);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

// Oct 29: CI caught 0.0104 at 390 in the split state. Two ways a paint could land before the card's own
// script ran: the parser still inside the <select> (picker 42px wide, then wider, wrapping under the heading),
// and the summary painted where the ask then pushed it down (0.0339 when the page comes in 4 KB pieces).
test('a slow line that paints half the page: Your area still moves nothing', { skip, timeout: 120000 }, async () => {
  const srv = await serve(4096), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const places = [
    ['split state', { 'agsist-wx-loc': JSON.stringify({ state: 'PA' }) }],
    ['unreported state', { 'agsist-wx-loc': JSON.stringify({ state: 'MT' }) }],
    ['Wisconsin place', { 'agsist-wx-loc': JSON.stringify({ state: 'WI' }) }],
    ['no saved place', {}],
  ];
  try {
    for (const w of [390, 1280]) for (const [name, store] of places) {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: 900 } });
      await ctx.route('**/*', (r) => (new URL(r.request().url()).hostname !== '127.0.0.1' ? r.abort() : r.continue()));
      await ctx.addInitScript((s) => {
        try { for (const k of Object.keys(s)) localStorage.setItem(k, s[k]); } catch (e) {}
        window.__cls = 0; window.__shifts = [];
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) {
            if (e.hadRecentInput) continue;
            window.__cls += e.value;
            window.__shifts.push(e.value.toFixed(4) + ' ' + (e.sources || []).map((x) => (x.node ? (x.node.id || x.node.nodeName) + ' "' + String(x.node.textContent || '').slice(0, 30) + '" y' + Math.round(x.previousRect.y) + '->' + Math.round(x.currentRect.y) : '?')).join(',') + ' at ' + Math.round(e.startTime) + 'ms');
          }
        }).observe({ type: 'layout-shift', buffered: true });
      }, store);
      const pg = await ctx.newPage();
      await pg.goto(`http://127.0.0.1:${port}/milk-prices`, { waitUntil: 'load' });
      await pg.waitForFunction(() => window.agsistMilk && !document.querySelector('.dp-area-skel'), null, { timeout: 20000 });
      await pg.waitForTimeout(300);
      const r = await pg.evaluate(() => ({ cls: window.__cls, shifts: window.__shifts, pend: document.documentElement.classList.contains('dp-area-pend'),
        vis: getComputedStyle(document.getElementById('dp-area-out')).visibility }));
      const tag = `${w} ${name} (slow line)`;
      assert.ok(r.cls < 0.001, `${tag}: layout shift ${r.cls} (${r.shifts.join(' | ')})`);
      assert.equal(r.pend, false, `${tag}: the card is let go`);
      assert.equal(r.vis, 'visible', tag);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

// Oct 29 (CI, 390 dark unreported state, 0.0129 at 217 ms): the shift was in the crawler nav, not the card. That
// nav is one unwrapped line with its <br>s hidden; a paint while the parser sat just past "<br>" and its
// newline left that whitespace with no place yet, and the next group put it 1500px along the line (clipped,
// so the box Chrome reports did not move). Pausing the page there does it every time on the old page.
test('a paint while the parser is inside the crawler nav moves nothing', { skip, timeout: 120000 }, async () => {
  const buf = fs.readFileSync(join(ROOT, 'milk-prices.html'));
  const s = buf.toString('latin1'), nav = s.indexOf('<nav aria-label="AGSIST main navigation"');
  assert.ok(nav > 0, 'the crawler nav is on the page');
  const stops = [];
  for (let at = s.indexOf('<br>\n', nav); at > 0 && at < s.indexOf('</nav>', nav); at = s.indexOf('<br>\n', at + 1)) stops.push(at + '<br>\n        '.length);
  assert.ok(stops.length >= 3, 'its groups are split by <br>');
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const w of [390, 1280]) for (const stop of [stops[0], stops[2]]) {
      const srv = await serve(0, stop), port = srv.address().port;
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: 900 } });
      try {
      await ctx.route('**/*', (r) => (new URL(r.request().url()).hostname !== '127.0.0.1' ? r.abort() : r.continue()));
      await ctx.addInitScript(() => {
        window.__cls = 0; window.__shifts = [];
        new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.hadRecentInput) continue; window.__cls += e.value;
          window.__shifts.push(e.value.toFixed(4) + ' ' + (e.sources || []).map((x) => (x.node ? (x.node.parentElement ? x.node.parentElement.tagName : '') + '>' + x.node.nodeName : '?')).join(',') + ' at ' + Math.round(e.startTime) + 'ms'); } })
          .observe({ type: 'layout-shift', buffered: true });
      });
      const pg = await ctx.newPage();
      await pg.goto(`http://127.0.0.1:${port}/milk-prices`, { waitUntil: 'load' });
      await pg.waitForTimeout(500);
      const r = await pg.evaluate(() => ({ cls: window.__cls, shifts: window.__shifts }));
      assert.ok(r.cls < 0.001, `${w}, paused at byte ${stop}: layout shift ${r.cls} (${r.shifts.join(' | ')})`);
      } finally { await ctx.close(); srv.close(); }
    }
  } finally { await browser.close(); }
});

test('no live nav (its script never runs): the crawler nav still shows, after 3 s', { skip, timeout: 60000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 900 } });
    await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); return u.hostname !== '127.0.0.1' || u.pathname === '/components/loader.js' ? r.abort() : r.continue(); });
    const pg = await ctx.newPage();
    await pg.goto(`http://127.0.0.1:${port}/milk-prices`, { waitUntil: 'load' });
    const vis = () => pg.evaluate(() => { const n = document.querySelector('#site-header>header nav'); return { v: n ? getComputedStyle(n).visibility : 'gone', t: performance.now() }; });
    const first = await vis();
    if (first.t < 2500) assert.equal(first.v, 'hidden', 'unseen at first');  // a slow machine can reach 3 s before load
    await pg.waitForTimeout(3300);
    assert.equal((await vis()).v, 'visible', 'shown once the wait is up');
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
