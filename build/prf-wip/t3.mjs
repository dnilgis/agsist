import { open, done, overflow } from './harness.mjs';
const W = +process.argv[2] || 390;
const geocode = { '54728': { results: [{ name: '54728', latitude: 45.3147, longitude: -91.6510, admin1: 'Wisconsin', admin2: 'Barron' }] },
                  'Valentine, NE': { results: [{ name: 'Valentine', latitude: 42.8728, longitude: -100.5510, admin1: 'Nebraska', admin2: 'Cherry' }] }, 'zzzz': {} };
const { browser, page, errs, BASE, shot } = await open({ width: W, height: 844, geocode });
const fails = []; const ok = (c, what) => { if (!c) { fails.push(what); console.log('  FAIL', what); } };
const txt = (sel) => page.textContent(sel).then(t => (t || '').replace(/\s+/g, ' ').trim());
await page.goto(BASE + '/prf.html'); await page.waitForSelector('#prf-app:not([hidden])');
// 1. ZIP
await page.fill('#prf-q', '54728'); await page.click('#prf-find button[type=submit]');
await page.waitForSelector('.prf-figs');
console.log('ZIP ->', await txt('#prf-where-h'), '|', await txt('#prf-find-msg'));
ok((await txt('#prf-where-h')).startsWith('Grid 30454 · Barron County, Wisconsin'), 'zip finds 30454 Barron');
ok(await page.$('.prf-pin'), 'pin drawn');
console.log(' where:', await txt('#prf-where-t'));
const v0 = await txt('.prf-verdict'); console.log(' verdict:', v0);
await shot(`d-zip-${W}`, { full: false });
// order on phone: answer should come before policy
const yA = await page.$eval('#prf-answer', e => e.getBoundingClientRect().top + scrollY), yP = await page.$eval('#prf-use', e => e.getBoundingClientRect().top + scrollY);
console.log(' answer y', Math.round(yA), 'policy y', Math.round(yP));
// 2. coverage change
await page.click('[data-cov="75"]'); await page.waitForTimeout(100);
const v1 = await txt('.prf-verdict'); ok(v1 !== v0, 'coverage changes verdict'); console.log(' 75%:', v1, '|', await txt('.prf-figs div:nth-child(2)'));
ok((await txt('.prf-figs div:nth-child(2)')).includes('59%'), '75% shows 59% subsidy');
await page.click('[data-cov="90"]');
// 3. intervals: turn on Aug-Sep (even -> 34/33/33), adjacent disabled
await page.check('[data-iv-on="7"]'); await page.waitForTimeout(100);
const split = await page.$$eval('[data-iv-pct]', els => els.map(e => e.value)); console.log(' split after adding Aug-Sep', split.join(','));
ok(split[3] === '34' && split[5] === '33' && split[7] === '33', 'even split 34/33/33');
ok(await page.$eval('[data-iv-on="4"]', e => e.disabled) && await page.$eval('[data-iv-on="6"]', e => e.disabled), 'adjacent months disabled');
console.log(' note May-Jun:', await txt('[data-iv-note="4"]'), '| total:', await txt('#prf-iv-total'));
// 4. type a percent: select all, type 40 -> sum 106 -> message
await page.click('[data-iv-pct="3"]', { clickCount: 3 }); await page.keyboard.type('40'); await page.waitForTimeout(100);
console.log(' typed 40:', await txt('#prf-iv-total'), '|', await txt('#prf-answer'));
ok((await txt('#prf-answer')).includes('106%'), 'over 100 explained');
ok(await page.$eval('[data-iv-pct="3"]', e => document.activeElement === e), 'focus kept while typing');
await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await page.waitForTimeout(80);
ok(await page.$eval('[data-iv-pct="3"]', e => document.activeElement === e && !e.disabled), 'emptying the box does not kick the reader out');
await page.keyboard.type('34'); await page.waitForTimeout(80);
ok((await txt('#prf-iv-total')) === '100% placed', 'back to 100');
// stepper
await page.click('[data-iv-step="5"][data-i="3"]'); await page.waitForTimeout(60);
console.log(' stepper:', await txt('#prf-iv-total'));
await page.click('#prf-even'); await page.waitForTimeout(60);
ok((await txt('#prf-iv-total')) === '100% placed', 'split evenly restores');
// 5. Jan-Feb cap: clear, pick Jan-Feb + Mar-Apr -> 25/75? max 70 -> cannot reach 100
await page.click('#prf-clear'); await page.waitForTimeout(60);
console.log(' cleared:', await txt('#prf-answer'));
await page.check('[data-iv-on="0"]'); await page.check('[data-iv-on="2"]'); await page.waitForTimeout(80);
console.log(' Jan-Feb + Mar-Apr:', (await page.$$eval('[data-iv-pct]', els => els.map(e => e.value))).join(','), '|', await txt('#prf-iv-total'), '|', await txt('#prf-answer'));
await page.check('[data-iv-on="5"]'); await page.waitForTimeout(80);
console.log(' + Jun-Jul:', (await page.$$eval('[data-iv-pct]', els => els.map(e => e.value))).join(','), '|', await txt('#prf-iv-total'));
ok((await txt('#prf-iv-total')) === '100% placed', 'three with cap reach 100');
// 6. acres, pf, share
await page.fill('#prf-acres', '640'); await page.fill('#prf-pf-n', '150'); await page.fill('#prf-share', '50'); await page.waitForTimeout(100);
console.log(' 640ac pf150 share50:', await txt('.prf-figs'));
await page.fill('#prf-acres', ''); await page.waitForTimeout(60); console.log(' no acres:', await txt('#prf-answer'));
await page.fill('#prf-acres', '640'); await page.fill('#prf-share', '100'); await page.fill('#prf-pf-n', '100');
// 7. use change: haying non-irrigated
await page.selectOption('#prf-use', '4'); await page.waitForTimeout(80); console.log(' hay:', await txt('.prf-figs div:nth-child(3)'));
// 8. drawers
await page.click('#prf-years-d summary'); await page.waitForSelector('#prf-years table');
console.log(' year rows:', await page.$$eval('#prf-years tbody tr', r => r.length), '| first:', await txt('#prf-years tbody tr:first-child'), '| second:', await txt('#prf-years tbody tr:nth-child(2)'));
console.log(' year note:', await txt('#prf-years .prf-fine'));
await page.click('#prf-rec-d summary'); await page.waitForSelector('#prf-rec table');
console.log(' rec row Jan-Feb:', await txt('#prf-rec tbody tr:first-child'), '| Jun-Jul:', await txt('#prf-rec tbody tr:nth-child(6)'));
await page.click('#prf-nb-d summary'); await page.waitForSelector('.prf-nb-g', { timeout: 15000 });
console.log(' neighbors:', (await page.$$eval('.prf-nb-c', c => c.map(x => x.innerText.replace(/\n/g, ' ')))).join(' ;; '));
await shot(`e-drawers-${W}`);
// 9. compare
await page.click('#prf-addb'); await page.waitForTimeout(100);
await page.click('[data-cov="70"]'); await page.waitForTimeout(100);
console.log(' compare:', (await page.$$eval('#prf-cmp tbody tr', r => r.map(x => x.innerText.replace(/\n|\t/g, ' | ')))).join(' ;; '));
console.log(' compare note:', await txt('#prf-cmp .prf-fine'));
console.log(' legend:', await txt('#prf-legend'), '| dots:', await page.$$eval('.prf-dot', d => d.length), '| head:', await txt('#prf-answer-h'));
await shot(`f-compare-${W}`);
// 10. share link -> reload in a new page keeps everything
const url = await page.evaluate(() => window.AgPrf.shareUrl()); console.log(' share:', url);
const p2 = await page.context().newPage(); await p2.goto(url); await p2.waitForSelector('.prf-figs');
const s1 = await page.evaluate(() => JSON.stringify(window.AgPrf.state)), s2 = await p2.evaluate(() => JSON.stringify(window.AgPrf.state));
const strip = (s) => { const o = JSON.parse(s); delete o.pt; delete o.on; o.A.even = o.B.even = 0; return JSON.stringify(o); };
ok(strip(s1) === strip(s2), 'share link restores the same state'); if (strip(s1) !== strip(s2)) console.log(strip(s1), '\n', strip(s2));
await p2.close();
// 11. map click to a neighbour, then browse to a different state
await page.click('#prf-dropb'); await page.waitForTimeout(60);
await page.evaluate(() => scrollTo(0, 0));
await page.click('.prf-cell.is-county[data-grid]'); await page.waitForTimeout(500);
console.log(' after map click:', await txt('#prf-where-h'));
await page.click('.prf-browse summary'); await page.selectOption('#prf-b-st', 'TX'); await page.waitForFunction(() => document.querySelectorAll('#prf-b-co option').length > 200);
await page.selectOption('#prf-b-co', { label: 'Brewster' }); await page.waitForSelector('#prf-b-grids .prf-chip');
console.log(' Brewster TX chips:', await page.$$eval('#prf-b-grids .prf-chip', c => c.length));
await page.click('#prf-b-grids .prf-chip'); await page.waitForTimeout(700);
console.log(' ->', await txt('#prf-where-h'), '|', await txt('#prf-answer'));
// 12. town search, bad search, coordinates without minus, grid id, nonsense
await page.fill('#prf-q', 'Valentine, NE'); await page.press('#prf-q', 'Enter'); await page.waitForTimeout(700);
console.log(' town ->', await txt('#prf-where-h'));
await page.fill('#prf-q', 'zzzz'); await page.press('#prf-q', 'Enter'); await page.waitForTimeout(400); console.log(' nonsense ->', await txt('#prf-find-msg'));
await page.fill('#prf-q', '31.5 99.2'); await page.press('#prf-q', 'Enter'); await page.waitForTimeout(700); console.log(' coords no minus ->', await txt('#prf-where-h'), '|', await txt('#prf-where-t'));
await page.fill('#prf-q', 'grid 10019'); await page.press('#prf-q', 'Enter'); await page.waitForTimeout(700); console.log(' grid id ->', await txt('#prf-where-h'));
await page.fill('#prf-q', '21.3, -157.8'); await page.press('#prf-q', 'Enter'); await page.waitForTimeout(500); console.log(' Honolulu ->', await txt('#prf-find-msg'));
await page.fill('#prf-q', '44.0, -67.0'); await page.press('#prf-q', 'Enter'); await page.waitForTimeout(700); console.log(' ocean ->', await txt('#prf-find-msg'));
// 13. pinned bar when scrolled past the answer
await page.evaluate(() => document.getElementById('prf-iv-body').scrollIntoView()); await page.waitForTimeout(1500);
console.log(' bar hidden?', await page.$eval('#prf-bar', b => b.hidden), '| bar:', await txt('#prf-bar'));
await shot(`g-bar-${W}`, { full: false });
console.log('overflow', JSON.stringify(await overflow(page)), 'errors', JSON.stringify(errs), 'FAILS', JSON.stringify(fails));
await browser.close(); done();
