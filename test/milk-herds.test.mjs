// /milk-prices: licensed dairy herds (NASS) and the MPP-Dairy years (fx/dairy3, Oct 28, 2026).
// Numbers hand-checked against NASS's own releases read Oct 28: Milk Production, Feb 20, 2026,
// page 18 (US 2024 24,645, 2025 23,609; Wisconsin 2025 5,375; Pennsylvania 2025 4,360), NASS
// Wisconsin's monthly herd series (Aug 2003 16,264; Sep 2026 4,977) and its Oct 1, 2026 release
// (4,944); FSA's MPP calculations table (Jan 2014 margin 12.699105, Jun 2016 5.7535145).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => fs.readFileSync(join(ROOT, p), 'utf8');
const page = read('milk-prices.html');
const herds = JSON.parse(read('data/dairy-herds.json'));
const dmc = JSON.parse(read('data/dairy-dmc.json'));
const seedOf = (tag) => {
  const m = new RegExp(`<!--SEED:${tag}-->([\\s\\S]*?)<!--/SEED-->`).exec(page);
  assert.ok(m, `SEED:${tag} is on the page`);
  return m[1];
};

test('herds file: NASS numbers as released, hand-checked', () => {
  assert.equal(herds.us['2024'], 24645);
  assert.equal(herds.us['2025'], 23609);
  assert.equal(herds.us['2003'], 70375);
  assert.equal(herds.us['2002'], undefined, 'no 2002: NASS\'s series starts in 2003, nothing filled in');
  assert.match(herds.us_note, /starts in 2003; 2002 is not in it/);
  assert.equal(herds.states.WI['2025'], 5375);
  assert.equal(herds.states.PA['2025'], 4360);
  assert.equal(herds.states.OT, undefined, '"Other States" is not a state');
  const wm = herds.wi_monthly.months;
  assert.equal(wm['2003-08'], 16264);
  assert.equal(wm['2026-09'], 4977);
  assert.equal(wm['2026-10'], 4944);
  assert.deepEqual(herds.wi_monthly.gaps, []);
  assert.equal(herds.loaded, '2026-02-20');
  assert.ok(herds.status.ok);
  for (const [st, r] of Object.entries(herds.states)) {
    for (const [y, v] of Object.entries(r)) assert.ok(v <= herds.us[y], `${st} ${y} above the US`);
  }
});

test('the page bakes the lead line, the net-licence caveat and the NASS credit from the file', () => {
  const s = seedOf('milkherds');
  assert.ok(s.includes('<strong>23,609 licensed dairy herds in the US in 2025</strong>, &minus;1,036 from 2024'), s.slice(0, 200));
  assert.ok(s.includes('Wisconsin, October 1, 2026: 4,944, &minus;229 from a year earlier'));
  assert.ok(s.includes('A drop is net licences, not the exact number of farms that quit'));
  assert.match(s, /Source: USDA NASS/);
  assert.doesNotMatch(s, /href="https:\/\/quickstats/); // named, not linked (no direct links to data sources, Oct 29, 2026)
  assert.match(s, /newest year released Feb 20, 2026/);
  assert.match(s, /USDA NASS Wisconsin, herds on the state&rsquo;s Dairy Producer License list/);
  assert.match(page, /<h2 class="dp-sec-label" id="dp-herds-h">[\s\S]*?Licensed dairy herds \(NASS\)<\/h2>/);
});

test('the herd numbers are not inlined in the page: the chart loads the file on demand', () => {
  assert.ok(page.includes('<script src="/components/milk-herds.js?v=1" defer></script>'));
  const js = read('components/milk-herds.js');
  assert.match(js, /fetch\('\/data\/dairy-herds\.json'/);
  assert.match(js, /IntersectionObserver/);
  assert.ok(!page.includes('16,264') && !page.includes('"wi_monthly"'), 'the monthly series stays in the data file');
  assert.match(js, /did not load \(/, 'a failed load says so');
});

test('MPP years sit apart from the DMC table and say they are a different program', () => {
  const paid = seedOf('milkdmcpaid');
  assert.doesNotMatch(paid, /<th scope="col" class="num">201[4-8]/, 'no MPP year in the DMC payment table');
  for (const k of Object.keys(dmc.margins)) assert.ok(k >= '2019-01', `DMC margins hold ${k}`);
  const m = dmc.mpp.months;
  assert.equal(Object.keys(m).length, 55);
  assert.equal(m['2014-01'].margin, 12.699105);
  assert.equal(m['2016-06'].margin, 5.7535145);
  assert.equal(m['2018-07'].all_milk, 15.4);
  assert.deepEqual(dmc.mpp.withheld.months, ['2018-08', '2018-09', '2018-10', '2018-11', '2018-12']);
  const s = seedOf('milkmpp');
  assert.ok(page.indexOf('id="dp-mpp"') > page.indexOf('id="dp-dmc-paid"'));
  assert.match(s, /It was a different program, so these margins are not on the same footing as the DMC table above and no MPP payment is worked out here/);
  assert.match(s, /<th scope="row">Jan<\/th><td class="num">\$8\.12<\/td><td class="num">\$11\.06<\/td><td class="num">\$8\.10<\/td><td class="num">\$8\.34<\/td><td class="num">\$12\.70<\/td>/);
  assert.match(s, /Lowest month here: Jun 2016, \$5\.75/);
  assert.match(s, /Aug 2018 to Dec 2018 are left out: FSA's MPP table as read ends at July 2018/);
  assert.match(s, /FSA, MPP calculations \(Internet Archive copy of 2024-06-14\)/); // named, not linked (no direct links to data sources, Oct 29, 2026)
  assert.doesNotMatch(s + seedOf('milkherds'), /—/, 'no em dash');
});

test('the scripts\' own offline checks pass on the real reads', () => {
  assert.match(execFileSync('python3', ['scripts/fetch_dairy_herds.py', '--selftest'], { cwd: ROOT, encoding: 'utf8' }), /selftest: PASS/);
  assert.match(execFileSync('python3', ['scripts/fetch_dmc.py', '--selftest'], { cwd: ROOT, encoding: 'utf8' }), /selftest: PASS/);
});

/* ---------- the chart in a real browser ---------- */
const PW = process.env.PLAYWRIGHT_PATH || '/home/user/node_modules/playwright/index.mjs';
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? 'Playwright or Chromium not found here' : false;

function serve() {
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml' };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html'; else if (!extname(p)) p += '.html';
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

test('the chart draws from the file for the saved state, says each bar\'s change, and moves nothing', { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [w, st] of [[390, 'WI'], [1280, 'PA'], [390, '']]) {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: 900 } });
      await ctx.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort()));
      await ctx.addInitScript((s) => { try { if (s) localStorage.setItem('agsist-wx-loc', JSON.stringify({ state: s })); } catch (e) {} }, st);
      const pg = await ctx.newPage();
      const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
      let asked = 0; pg.on('request', (r) => { if (r.url().includes('/data/dairy-herds.json')) asked++; });
      await pg.goto(`http://127.0.0.1:${port}/milk-prices`, { waitUntil: 'load' });
      assert.equal(asked, 0, 'the file is not fetched before the reader gets near the chart');
      const plots = () => pg.evaluate(() => ['dp-hc-us', 'dp-hc-st', 'dp-herds-tbl', 'dp-do'].map((id) => { const e = document.getElementById(id); const r = e.getBoundingClientRect(); return [Math.round(r.top + scrollY), Math.round(r.height)]; }));
      const before = await plots();
      await pg.evaluate(() => document.getElementById('dp-herds').scrollIntoView());
      await pg.waitForFunction(() => document.querySelectorAll('#dp-hc-us .dp-hc-b').length > 0, null, { timeout: 20000 });
      await pg.waitForTimeout(300);
      assert.deepEqual(await plots(), before, `${w} ${st}: the chart filled its space without moving anything`);
      assert.equal(await pg.locator('#dp-hc-us .dp-hc-b').count(), 23, 'one bar a year, 2003 to 2025');
      assert.equal(await pg.locator('#dp-hc-us .dp-hc-b').last().getAttribute('data-tip'), '2025: 23,609 licensed herds, −1,036 from 2024');
      const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(sw <= w, `no sideways scroll at ${w} (${sw})`);
      if (st) {
        assert.equal(await pg.locator('#dp-herds-st').inputValue(), st, 'the saved place picks the state');
        assert.equal(await pg.locator('#dp-hc-st .dp-hc-b').count(), 23);
      } else {
        assert.equal(await pg.locator('#dp-hc-st .dp-hc-b').count(), 0);
        assert.match(await pg.locator('#dp-hc-st-n').textContent(), /Pick your state/);
      }
      assert.equal(await pg.locator('#dp-hc-wi-f').isVisible(), st === 'WI', 'Wisconsin by month only for Wisconsin');
      if (st === 'WI') {
        assert.match(await pg.locator('#dp-hc-wi-n').textContent(), /Aug 2003 to Oct 2026: 16,264 to 4,944\./);
        await pg.locator('#dp-herds-tbl summary').click();
        assert.match(await pg.locator('#dp-herds-tbl-in').innerText(), /2025\s+23,609\s+−1,036\s+5,375\s+−145/);
      }
      assert.equal(asked, 1, 'fetched once');
      assert.deepEqual(errs, []);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
