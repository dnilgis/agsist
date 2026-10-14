/* The Rain Print order path a buyer takes since 2026-10-14 (the approved
 * three-step flow), for the browser tests: pick in step 3, "Check it and pay",
 * answer the no-name question, tick "The spelling and the dates are right" in
 * the review sheet, and pay. Checkout is Stripe in the same tab, so the tests
 * answer buy.stripe.com with a stand-in page (stripePage) and read where the
 * tab went.
 *
 * checkout(page, id, {name: false (stop at the no-name question), tick: false})
 *   -> {stage: 'stripe', url} the tab went to Stripe;
 *      {stage: 'note', note}  the step 3 button said why not (no review sheet);
 *      {stage: 'noname'}      the no-name question is showing;
 *      {stage: 'sheet', msg}  the review sheet stayed open (its message), or the
 *                             order form opened in its place.
 */
export const STRIPE_PAGE = "<!doctype html><title>Stripe checkout stand-in</title><p>Stripe checkout stand-in</p>";

export function stripePage(route, log) {
  log.push(route.request().url());
  return route.fulfill({ status: 200, contentType: "text/html", body: STRIPE_PAGE });
}

export async function checkout(page, id, o = {}) {
  if (id) await page.locator(`.rp-prod[data-choice="${id}"]`).click();
  await page.locator("#rp-pay").scrollIntoViewIfNeeded();
  await page.click("#rp-pay");
  await page.waitForTimeout(300);
  if (await page.isVisible("#rp-noname")) {
    if (o.name === false) return { stage: "noname" };
    await page.click("#rp-noname-go");
    await page.waitForTimeout(300);
  }
  if (!(await page.$eval("#rp-proof", (d) => d.open))) return { stage: "note", note: await page.textContent("#rp-buy-note") };
  if (o.tick !== false) await page.check("#rp-proof-ok");
  const went = page.waitForURL(/buy\.stripe\.com/, { timeout: o.wait || 10000 }).then(() => true, () => false);
  await page.click("#rp-proof-order");
  if (await went) return { stage: "stripe", url: page.url() };
  return { stage: "sheet", msg: (await page.$eval("#rp-proof-msg", (m) => (m.hidden ? "" : m.textContent))) || "" };
}

export const refOf = (u) => new URL(u).searchParams.get("client_reference_id");
