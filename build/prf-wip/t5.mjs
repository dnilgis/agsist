import { open, done, overflow } from './harness.mjs';
const txt = (page, sel) => page.textContent(sel).then(t => (t || '').replace(/\s+/g, ' ').trim());
async function scen(name, opts, fn) {
  const o = await open({ width: 390, height: 844, ...opts });
  try { await fn(o.page, o); } catch (e) { console.log('  EXC', name, e.message.slice(0, 200)); }
  console.log(`[${name}] errors: ${JSON.stringify(o.errs)} overflow: ${JSON.stringify(await overflow(o.page))}`);
  await o.shot('z-' + name, { full: false });
  await o.browser.close();
}
const go = async (page, BASE, q) => { await page.goto(BASE + '/prf.html' + (q || '')); };
await scen('meta404', { routes: [['**/data/prf/meta.json', r => r.fulfill({ status: 404, body: 'nf' })]] }, async (page, o) => {
  await go(page, o.BASE); await page.waitForTimeout(1200);
  console.log('  status:', await txt(page, '#prf-status'), '| app hidden:', await page.$eval('#prf-app', e => e.hidden), '| h2s:', await page.$$eval('h2', h => h.length));
});
await scen('metaBad', { routes: [['**/data/prf/meta.json', r => r.fulfill({ contentType: 'application/json', body: '{"v":1}' })]] }, async (page, o) => {
  await go(page, o.BASE); await page.waitForTimeout(1200); console.log('  status:', await txt(page, '#prf-status'));
});
await scen('shard404', { routes: [['**/data/prf/g/**', r => r.fulfill({ status: 404, body: 'nf' })]] }, async (page, o) => {
  await go(page, o.BASE); await page.waitForSelector('#prf-app:not([hidden])'); await page.click('#prf-eg'); await page.waitForTimeout(1200);
  console.log('  msg:', await txt(page, '#prf-find-msg'), '| tool hidden:', await page.$eval('#prf-tool', e => e.hidden));
});
await scen('shard500', { routes: [['**/data/prf/g/**', r => r.fulfill({ status: 500, body: 'x' })]] }, async (page, o) => {
  await go(page, o.BASE); await page.waitForSelector('#prf-app:not([hidden])'); await page.click('#prf-eg'); await page.waitForTimeout(1200);
  console.log('  msg:', await txt(page, '#prf-find-msg'));
});
await scen('state404', { routes: [['**/data/prf/s/**', r => r.fulfill({ status: 404, body: 'nf' })]] }, async (page, o) => {
  await go(page, o.BASE); await page.waitForSelector('#prf-app:not([hidden])'); await page.click('#prf-eg'); await page.waitForTimeout(1200);
  console.log('  msg:', await txt(page, '#prf-find-msg'));
});
await scen('y404', { routes: [['**/data/prf/y/**', r => r.fulfill({ status: 404, body: 'nf' })]] }, async (page, o) => {
  await go(page, o.BASE); await page.waitForSelector('#prf-app:not([hidden])'); await page.click('#prf-eg'); await page.waitForSelector('.prf-figs');
  await page.click('#prf-years-d summary'); await page.waitForSelector('#prf-years table');
  console.log('  first row:', await txt(page, '#prf-years tbody tr:first-child'), '| notes:', await page.$$eval('#prf-years .prf-fine', p => p.length));
});
await scen('staleCropYear', { routes: [['**/data/prf/g/**', async r => { const resp = await r.fetch(); const j = await resp.json(); j.cy = 2026; r.fulfill({ contentType: 'application/json', body: JSON.stringify(j) }); }]] }, async (page, o) => {
  await go(page, o.BASE); await page.waitForSelector('#prf-app:not([hidden])'); await page.click('#prf-eg'); await page.waitForTimeout(1500);
  console.log('  answer:', await txt(page, '#prf-answer'), '| chart hidden:', await page.$eval('#prf-chart-fig', e => e.hidden), '| acts hidden:', await page.$eval('#prf-acts', e => e.hidden));
});
await scen('geocoderDown', { routes: [['**/geocoding-api.open-meteo.com/**', r => r.abort()]] }, async (page, o) => {
  await go(page, o.BASE); await page.waitForSelector('#prf-app:not([hidden])'); await page.fill('#prf-q', '54728'); await page.press('#prf-q', 'Enter'); await page.waitForTimeout(1000);
  console.log('  msg:', await txt(page, '#prf-find-msg'));
});
await scen('imperialCA', {}, async (page, o) => {
  await go(page, o.BASE, '?g=15056&c=06025&u=0&ac=1000&sh=100&a=90_100_0.0.0.50.0.50.0.0.0.0.0'); await page.waitForSelector('#prf-tool:not([hidden])'); await page.waitForTimeout(600);
  console.log('  where:', await txt(page, '#prf-where-h'), '| answer:', (await txt(page, '#prf-answer')).slice(0, 220));
  console.log('  split:', (await page.$$eval('[data-iv-pct]', e => e.map(x => x.value))).join(','), '| notes:', (await page.$$eval('[data-iv-note]', e => e.map(x => x.textContent))).join(' / '));
});
await scen('noRatePima', {}, async (page, o) => {
  await go(page, o.BASE, '?g=13873&c=04019&u=0&ac=1000&sh=100&a=90_100_0.0.0.0.50.0.0.50.0.0.0'); await page.waitForSelector('#prf-tool:not([hidden])'); await page.waitForTimeout(600);
  console.log('  where:', await txt(page, '#prf-where-h'), '| answer:', (await txt(page, '#prf-answer')).slice(0, 260));
  console.log('  notes:', (await page.$$eval('[data-iv-note]', e => e.map(x => x.textContent))).join(' / '));
  await page.click('#prf-rec-d summary'); await page.waitForSelector('#prf-rec table'); console.log('  rec May-Jun:', await txt(page, '#prf-rec tbody tr:nth-child(5)'));
});
await scen('eightCounties', {}, async (page, o) => {
  await go(page, o.BASE, '?g=25125&c=36061&u=0&ac=50&sh=100&a=85_120_0.0.0.50.0.50.0.0.0.0.0'); await page.waitForSelector('#prf-tool:not([hidden])'); await page.waitForTimeout(600);
  console.log('  where:', await txt(page, '#prf-where-h'), '| counties:', (await page.$$eval('#prf-co option', e => e.map(x => x.textContent))).join(', '), '| verdict:', (await txt(page, '#prf-answer')).slice(0, 160));
  await page.selectOption('#prf-co', '34003'); await page.waitForTimeout(400); console.log('  -> switched:', await txt(page, '#prf-where-h'), '|', (await txt(page, '.prf-figs div:nth-child(3)')));
});
await scen('noHayApache', {}, async (page, o) => {
  await go(page, o.BASE, '?g=15981&c=04001&u=4&ac=500&sh=100&a=90_100_0.0.0.50.0.50.0.0.0.0.0'); await page.waitForSelector('#prf-tool:not([hidden])'); await page.waitForTimeout(600);
  console.log('  uses:', (await page.$$eval('#prf-use option', e => e.map(x => x.textContent))).join(' | '), '| chosen:', await page.$eval('#prf-use', e => e.value), '|', (await txt(page, '#prf-answer')).slice(0, 120));
});
await scen('badLink', {}, async (page, o) => {
  await go(page, o.BASE, '?g=999999&c=99999&u=44&ac=-5&sh=900&a=95_900_1.2&b=x'); await page.waitForTimeout(1200);
  console.log('  msg:', await txt(page, '#prf-find-msg'), '| tool hidden:', await page.$eval('#prf-tool', e => e.hidden));
  await go(page, o.BASE, '?g=30454&c=27001&u=0&ac=100&sh=100&a=90_100_0.0.0.50.0.50.0.0.0.0.0'); await page.waitForTimeout(1200);
  console.log('  wrong county code ->', await txt(page, '#prf-where-h'));
  await go(page, o.BASE, '?g=30454&c=55005&u=0&ac=100&sh=100&a=90_100_40.40.20.0.0.0.0.0.0.0.0'); await page.waitForTimeout(1200);
  console.log('  illegal split in link ->', (await page.$$eval('[data-iv-pct]', e => e.map(x => x.value))).join(','), '|', (await txt(page, '#prf-answer')).slice(0, 140));
});
await scen('openYearDash', {}, async (page, o) => {
  await go(page, o.BASE, '?g=30454&c=55005&u=0&ac=100&sh=100&a=90_100_0.0.0.50.0.0.0.50.0.0.0'); await page.waitForSelector('.prf-figs');
  await page.click('#prf-years-d summary'); await page.waitForSelector('#prf-years table');
  console.log('  2026 row:', await page.$eval('#prf-years tbody tr:first-child', r => [...r.children].map(c => c.textContent).join(' | ')));
});
await scen('print', {}, async (page, o) => {
  await go(page, o.BASE, '?g=30454&c=55005&u=0&ac=100&sh=100&a=90_100_0.0.0.50.0.50.0.0.0.0.0'); await page.waitForSelector('.prf-figs');
  await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(300);
  console.log('  print: find visible?', await page.$eval('#prf-find', e => getComputedStyle(e).display), '| header:', await page.$eval('#site-header, .nav', e => getComputedStyle(e).display).catch(() => 'n/a'));
});
done();
