/* Nov 2, 2026 (put AGSIST into the tools people already use): the four
 * futures pages and the /cash-bids hub carry one plain line to subscribe to the
 * USDA report dates (webcal and Google Calendar), the same files /usda-calendar
 * offers, firing the same ics_subscribe GA4 event the calendar page fires.
 *
 *   node --test test/usda-cal-subscribe-line.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PAGES = {
  "corn-futures-prices.html": "grain", "soybean-futures-prices.html": "grain", "wheat-futures-prices.html": "grain",
  "cattle-futures-prices.html": "livestock", "cash-bids.html": "grain",
};

test("each page has exactly one subscribe line, both links to its .ics, with the GA4 event", () => {
  const cal = readFileSync(ROOT + "usda-calendar.html", "utf8");
  assert.match(cal, /gtag\('event','ics_subscribe'/, "the calendar page's own event name");
  for (const [p, set] of Object.entries(PAGES)) {
    const html = readFileSync(ROOT + p, "utf8");
    const lines = html.match(/<!--usda-cal-sub--><p class="cal-sub"[^\n]*?<\/p>/g) || [];
    assert.equal(lines.length, 1, p + " one line");
    const ln = lines[0], f = `usda-calendar-${set}.ics`;
    assert.ok(existsSync(ROOT + f), f);
    assert.ok(ln.includes(`href="webcal://agsist.com/${f}"`), p + " webcal");
    assert.ok(ln.includes(`href="https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2Fagsist.com%2F${f}"`), p + " google");
    assert.equal((ln.match(/gtag\('event','ics_subscribe'/g) || []).length, 2, p + " event on both links");
    assert.ok(!/<(div|section|details)\b/.test(ln), p + " no nested box");
    assert.ok(!/[—]/.test(ln), p + " no em dash");
  }
});
