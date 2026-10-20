import { open, done, overflow } from './harness.mjs';
const o = await open({ width: 390, height: 900 });
await o.page.goto(o.BASE + '/prf/kansas.html'); await o.page.waitForTimeout(500);
const r = o.page.locator('aside.ag-sponsor-ribbon');
console.log('visible', await r.isVisible(), JSON.stringify(await overflow(o.page)), o.errs);
await r.scrollIntoViewIfNeeded(); await o.page.screenshot({ path: `${process.env.PRF_SHOTS || 'build/shots'}/rib-390.png` });
await o.browser.close(); done();
