import { open, done, overflow } from './harness.mjs';
for (const w of [390, 1280]) {
  const o = await open({ width: w, height: 900 });
  await o.page.goto(o.BASE + '/prf/missouri.html'); await o.page.waitForTimeout(500);
  await o.shot('st-mo-' + w, { full: false });
  console.log(w, JSON.stringify(await overflow(o.page)), o.errs, (await o.page.locator('.prf-co-t tbody tr').count()), 'rows');
  if (w === 390) {
    await o.page.goto(o.BASE + '/prf.html?st=MO'); await o.page.waitForTimeout(800);
    console.log('?st=MO: state', await o.page.inputValue('#prf-b-st'), 'browse open', await o.page.locator('.prf-browse').getAttribute('open'));
    await o.page.goto(o.BASE + '/prf.html?c=29077'); await o.page.waitForTimeout(900);
    console.log('?c=29077:', await o.page.inputValue('#prf-b-co'), (await o.page.locator('#prf-b-grids').innerText()).slice(0, 160));
    await o.shot('st-c-390', { full: false });
  }
  await o.browser.close();
}
done();
