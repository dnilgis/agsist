import { open, done, overflow } from './harness.mjs';
const W = +(process.argv[2] || 390);
const geocode = {
  '54728': { results: [{ name: 'Chetek', latitude: 45.31413, longitude: -91.651, admin1: 'Wisconsin', admin2: 'Barron' }] },
  '30454': { results: [{ name: 'Rockledge', latitude: 32.53, longitude: -82.53, admin1: 'Georgia', admin2: 'Laurens' }] },
  'Valentine': { results: [{ name: 'Valentine', latitude: 42.87278, longitude: -100.55097, admin1: 'Nebraska', admin2: 'Cherry' }, { name: 'Valentine', latitude: 31.0, longitude: -104.5, admin1: 'Texas', admin2: 'Jeff Davis' }] },
  'Springfield': { results: [{ name: 'Springfield', latitude: 37.215, longitude: -93.298, admin1: 'Missouri', admin2: 'Greene' }, { name: 'Springfield', latitude: 39.8, longitude: -89.65, admin1: 'Illinois', admin2: 'Sangamon' }] },
};
const o = await open({ width: W, height: 844, geocode, geo: { latitude: 44.80, longitude: -121.78 } });
const p = o.page, t = (s) => p.locator(s).first().innerText().catch(() => '(none)');
const say = async (lab) => console.log(lab, '|', (await t('#prf-where-h')), '|', (await t('#prf-find-msg')).slice(0, 160), '|', (await t('.prf-verdict')).slice(0, 170));
await p.goto(o.BASE + '/prf.html'); await p.waitForTimeout(500);
await o.shot('n-cold-' + W, { full: false });
console.log('cold status:', await t('#prf-status'), '| app hidden', await p.locator('#prf-app').isHidden());
await p.click('#prf-eg'); await p.waitForSelector('.prf-figs');
await say('example');
console.log(' policy line:', await t('#prf-printsum'));
console.log(' figs:', (await t('.prf-figs')).replace(/\n/g, ' | '));
console.log(' back:', await t('.prf-back'));
await o.shot('n-answer-' + W);
await p.fill('#prf-q', '54728'); await p.click('.prf-btn-go'); await p.waitForTimeout(600); await say('zip 54728');
console.log(' where:', (await t('#prf-where-t')).slice(0, 400));
await p.fill('#prf-q', '30454'); await p.click('.prf-btn-go'); await p.waitForTimeout(600); await say('zip 30454');
console.log(' where:', (await t('#prf-where-t')).slice(-200));
await p.fill('#prf-q', '46.72, -92.30'); await p.click('.prf-btn-go'); await p.waitForTimeout(700); await say('coords Carlton/StLouis');
console.log(' co-how:', await t('#prf-co-how'));
await p.fill('#prf-q', 'Valentine NE'); await p.click('.prf-btn-go'); await p.waitForTimeout(600); await say('Valentine NE');
await p.fill('#prf-q', 'Springfield'); await p.click('.prf-btn-go'); await p.waitForTimeout(600); await say('Springfield');
const chips = await p.locator('[data-choice]').count(); console.log(' choices', chips);
if (chips) { await p.locator('[data-choice]').nth(1).click(); await p.waitForTimeout(700); await say(' picked 2nd'); }
await p.fill('#prf-q', 'grid 30454'); await p.click('.prf-btn-go'); await p.waitForTimeout(600); await say('grid 30454');
await p.click('#prf-loc'); await p.waitForTimeout(900); await say('location OR');
console.log(' co-how:', await t('#prf-co-how'), '| ask?', await p.locator('.prf-co-wrap.is-ask').count());
await o.shot('n-ask-' + W, { full: false });
// pick a county if asked
if (await p.locator('.prf-co-wrap.is-ask').count()) { const v = await p.locator('#prf-co option').nth(1).getAttribute('value'); await p.selectOption('#prf-co', v); await p.waitForTimeout(400); await say(' after picking county'); }
// back to example and break rules
await p.click('#prf-eg').catch(() => {}); await p.goto(o.BASE + '/prf.html?g=30454&c=55005&u=0&ac=100&sh=100&a=90_100_0.0.0.50.0.50.0.0.0.0.0'); await p.waitForSelector('.prf-figs');
await p.click('#prf-acres'); await p.keyboard.type('3000'); await p.waitForTimeout(200); console.log('acres typed 3000 ->', await p.inputValue('#prf-acres'), '|', await t('.prf-figs dd'));
await p.fill('#prf-share', '0'); await p.waitForTimeout(150); console.log('share 0 ->', await t('.prf-verdict'));
await p.fill('#prf-share', '100'); await p.fill('#prf-acres', '100');
await p.click('#prf-clear'); await p.check('[data-iv-on="0"]'); await p.check('[data-iv-on="2"]');
for (let i = 0; i < 12; i++) { await p.click('[data-iv-step="5"][data-i="0"]').catch(() => {}); await p.click('[data-iv-step="5"][data-i="2"]').catch(() => {}); }
console.log('caps dead end ->', await t('.prf-verdict'));
await p.click('#prf-even'); console.log(' even ->', await t('#prf-iv-total'));
await p.click('#prf-clear'); console.log('clear button now:', await t('#prf-clear')); await p.click('#prf-clear'); console.log(' undo ->', await t('#prf-iv-total'));
await p.goto(o.BASE + '/prf.html?g=30454&c=55005&u=0&ac=100&sh=100&a=90_100_0.0.0.50.0.50.0.0.0.0.0'); await p.waitForSelector('.prf-figs');
for (const w of [30, 10, 0]) { await p.click(`[data-win="${w}"]`); await p.waitForTimeout(100); console.log('window', w, '->', (await t('.prf-verdict')).slice(0, 120)); }
for (const id of ['prf-years-d', 'prf-pol-d', 'prf-rec-d', 'prf-lad-d', 'prf-idx-d', 'prf-nb-d']) { await p.locator('#' + id + ' > summary').click(); }
await p.waitForTimeout(600);
console.log('policy table:', (await t('#prf-pol')).replace(/\n/g, ' | ').slice(0, 500));
console.log('record first rows:', (await t('#prf-rec tbody')).split('\n').slice(0, 3).join(' || '));
console.log('ladder:', (await t('#prf-lad tbody')).replace(/\n/g, ' | '));
console.log('nb:', (await t('#prf-nb')).replace(/\n/g, ' ').slice(0, 300));
console.log('idx rows:', await p.locator('#prf-idx tbody tr').count());
await p.click('[data-yr="-1"]'); console.log('year step:', (await t('#prf-read')).slice(0, 200));
await p.click('#prf-addb'); await p.waitForTimeout(300); await p.click('[data-cov="75"]');
console.log('compare:', (await t('#prf-cmp')).replace(/\n/g, ' | ').slice(0, 700));
await o.shot('n-full-' + W);
console.log('overflow', JSON.stringify(await overflow(p)), 'errors', o.errs);
await o.browser.close(); done();
