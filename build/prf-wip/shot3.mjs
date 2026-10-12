import { open, done, overflow } from './harness.mjs';
for (const [w, light] of [[1280, false], [1280, true], [390, true]]) {
  const o = await open({ width: w, height: 900, light });
  await o.page.goto(o.BASE + '/prf.html?g=30454&c=55005&u=0&ac=100&sh=100&a=90_100_0.0.0.50.0.50.0.0.0.0.0');
  await o.page.waitForSelector('.prf-figs'); await o.page.waitForTimeout(400);
  if (light) await o.page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await o.page.waitForTimeout(200);
  await o.shot(`q-${w}-${light ? 'light' : 'dark'}`, { full: false });
  console.log(w, light, JSON.stringify(await overflow(o.page)), o.errs);
  await o.browser.close();
}
done();
