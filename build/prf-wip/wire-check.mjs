// The two panels prf.js feeds: "What the numbers would pick" and the long-range outlook.
//   PRF_CHROMIUM=/opt/pw-browsers/chromium PRF_SHOTS=<dir> node build/prf-wip/wire-check.mjs
// ZIP 54728 -> grid 30454, Barron County, WI, at 390 and 1280 wide; then a returning
// visit with prf-optimize-ui.js arriving late (the race that left the panel empty).
import { open, done, openSetup } from './harness.mjs';
const geocode = { '54728': { results: [{ name: '54728', latitude: 45.3147, longitude: -91.6510, admin1: 'Wisconsin', admin2: 'Barron' }] } };
const fails = []; const ok = (c, what) => { if (!c) { fails.push(what); console.log('  FAIL', what); } };
const clean = (errs) => errs.filter(e => !/net::|504|Failed to load/.test(e));
for (const W of [390, 1280]) {
  const { browser, page, errs, BASE, shot } = await open({ width: W, height: 844, geocode });
  await page.goto(BASE + '/prf.html'); await page.waitForSelector('#prf-app:not([hidden])');
  await page.fill('#prf-q', '54728'); await page.click('#prf-find button[type=submit]');
  await page.waitForSelector('.prf-figs');
  await page.waitForSelector('#prf-optimize .po-use', { timeout: 10000 }).catch(() => {});
  const where = (await page.textContent('#prf-where-h')).replace(/\s+/g, ' ').trim();
  ok(where.startsWith('Grid 30454 · Barron County, Wisconsin'), W + ' zip finds 30454 Barron');
  const opt = await page.evaluate(() => document.querySelector('#prf-optimize [data-opt-body]').innerText);
  console.log(W, 'OPT body', opt.length, 'chars:', opt.replace(/\s+/g, ' ').slice(0, 220));
  ok(/The pick for grid 30454/.test(opt), W + ' pick heading');
  ok(await page.$$eval('#prf-optimize .po-iv', e => e.length) >= 2, W + ' pick has intervals');
  ok(await page.$$eval('#prf-optimize ul.po-why li', e => e.length) >= 2, W + ' reasons listed');
  ok(/\$\d/.test(opt) && /You pay a year|YOU PAY A YEAR/i.test(opt), W + ' figures in dollars');
  // outlook: with no data/prf/outlook.json the panel stays hidden (it only shows once the file loads)
  await openSetup(page); await page.waitForTimeout(150);
  const ol = await page.evaluate(() => { const s = document.getElementById('prf-outlook'); return { vis: !!s.offsetParent, t: s.innerText }; });
  console.log(W, 'OUTLOOK visible', ol.vis, '|', ol.t.replace(/\s+/g, ' ').slice(-140));
  ok(!ol.vis, W + ' outlook stays hidden without its data');
  // Use this setup -> calculator's intervals
  const want = await page.$eval('#prf-optimize .po-use', b => b.getAttribute('data-opt-use').split('.').map(Number));
  const before = await page.$eval('.prf-figs', e => e.innerText);
  const SHOTS = process.env.PRF_SHOTS || 'build/shots';
  await page.locator('#prf-optimize').screenshot({ path: `${SHOTS}/opt-${W}.png` });
  await page.click('#prf-optimize .po-use'); await page.waitForTimeout(300);
  const got = await page.evaluate(() => AgPrf.state[AgPrf.state.on].split.slice());
  const boxes = await page.$$eval('[data-iv-pct]', els => els.map(e => +e.value || 0));
  console.log(W, 'use: want', want.join(','), 'state', got.join(','), 'boxes', boxes.join(','));
  ok(want.join() === got.join() && want.join() === boxes.join(), W + ' Use this setup fills the intervals');
  ok((await page.$eval('.prf-figs', e => e.innerText)) !== before, W + ' page re-rendered with the pick');
  await page.waitForTimeout(600); await shot(`used-${W}`, { full: false });
  console.log(W, 'errors', clean(errs));
  ok(clean(errs).length === 0, W + ' no console errors');
  await shot(`wire-${W}`, { full: true });
  // returning visit, optimizer UI script late
  await page.route('**/prf-optimize-ui.js*', async r => { await new Promise(s => setTimeout(s, 1500)); r.continue(); });
  await page.reload(); await page.waitForSelector('.prf-figs');
  await page.waitForSelector('#prf-optimize .po-use', { timeout: 8000 }).catch(() => {});
  ok(!!(await page.$('#prf-optimize .po-use')), W + ' panel fills when its script arrives after the first render');
  await browser.close();
}
done();
console.log(fails.length ? fails.length + ' FAILED' : 'all wire checks pass');
process.exit(fails.length ? 1 : 0);
