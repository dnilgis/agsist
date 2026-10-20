import { open, done } from './harness.mjs';
const o = await open({ width: 900, height: 1200 });
await o.page.goto(o.BASE + '/prf.html?g=30454&c=55005&u=4&ac=180&sh=100&a=90_100_0.0.0.50.0.50.0.0.0.0.0');
await o.page.waitForSelector('.prf-figs');
await o.page.evaluate(() => { window.print = () => {}; });
await o.page.click('#prf-print'); await o.page.waitForTimeout(300);
await o.page.pdf({ path: `${process.env.PRF_SHOTS || 'build/shots'}/prf-print.pdf`, format: 'Letter', printBackground: true });
console.log(o.errs); await o.browser.close(); done();
