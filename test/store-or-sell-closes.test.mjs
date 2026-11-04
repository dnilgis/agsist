/* /store-or-sell: the board line says "closes" only for a close (2026-10-16 benchmark,
 * competitor-benchmark/results/2026-10-16-store-or-sell.md (private repo, .claude/skills): it printed
 * "closes of 2026-10-16" for prices read at 11:01 am CT, mid-session).
 * CBOT corn, soybean and wheat day session ends 1:20 pm CT. Oct 16, 2026 is CDT (UTC-5):
 *   16:01Z = 11:01 am CT, before the close -> delayed quotes, with the read time
 *   18:46Z = 1:46 pm CT, after it          -> closes of Oct 16, 2026
 *   04:00Z Oct 17 = 11:00 pm CT Oct 16     -> closes of Oct 16, 2026
 *   a close_date of Oct 15 read Oct 16 at 10 am CT -> closes of Oct 15, 2026
 *   no read time -> the date only, never "closes"
 *
 *   node --test test/store-or-sell-closes.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const ctx = { document: { readyState: "loading", addEventListener() {} }, Intl, Date, console };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("components/store-or-sell.js", ROOT), "utf8"), ctx);
const { quoteWhen } = ctx.AgsistStoreOrSell;

test("closes only after the 1:20 pm CT close; a mid-session read says so, with its time", () => {
  assert.equal(quoteWhen("2026-10-16", "2026-10-16T16:01:00Z"), "delayed quotes read 11:01 am CT Oct 16, before the close");
  assert.equal(quoteWhen("2026-10-16", "2026-10-16T18:20:00Z"), "closes of Oct 16, 2026", "1:20 pm CT exactly");
  assert.equal(quoteWhen("2026-10-16", "2026-10-16T18:19:00Z"), "delayed quotes read 1:19 pm CT Oct 16, before the close");
  assert.equal(quoteWhen("2026-10-16", "2026-10-16T18:46:22Z"), "closes of Oct 16, 2026");
  assert.equal(quoteWhen("2026-10-16", "2026-10-17T04:00:00Z"), "closes of Oct 16, 2026");
  assert.equal(quoteWhen("2026-10-15", "2026-10-16T15:00:00Z"), "closes of Oct 15, 2026");
  assert.equal(quoteWhen("2026-10-16", null), "quotes of Oct 16, 2026");
  assert.equal(quoteWhen("", "2026-10-16T18:46:22Z"), "latest quotes");
});

test("the page says the same rule and no longer calls every quote a close", () => {
  const js = readFileSync(new URL("components/store-or-sell.js", ROOT), "utf8");
  const html = readFileSync(new URL("store-or-sell.html", ROOT), "utf8");
  assert.ok(!/'closes of ' \+ fm\.date/.test(js));
  assert.match(html, /labeled as closes only once read after the 1:20 pm CT day close/);
  assert.match(html, /store-or-sell\.js\?v=8/);
});

/* 2026-11-04 (site panel, skeptic row 7): a failed read was turned into an
 * empty list, and the page said "No elevator we read near 50010 posts a later
 * corn bid", blaming the elevators for a network that did not answer. */
test("a failed network read says the network did not answer, never that no elevator posts a later bid", () => {
  const { noLaterWords, readFailed } = ctx.AgsistStoreOrSell;
  assert.equal(readFailed({ list: [], farther: null, read: [], failed: true }), true, "the snapshot fetch threw");
  assert.equal(readFailed({ list: [{ model: { failed: true } }, { model: { failed: true } }] }), true, "every board read failed");
  assert.equal(readFailed({ list: [{ model: { failed: true } }, { model: { later: [] } }] }), false, "one board answered");
  assert.equal(readFailed({ list: [], farther: null, read: [] }), false, "no candidates is a real empty answer");
  const t = noLaterWords("50010", 0, null, true, "corn");
  assert.match(t, /^The elevator network did not answer for 50010/);
  assert.doesNotMatch(t, /No elevator|posts a later corn bid right now/);
  assert.match(noLaterWords("50010", 3, null, false, "corn"), /^No elevator we read near 50010 posts a later corn bid right now/);
  assert.match(noLaterWords("50010", 3, { row: {} }, false, "corn"), /^None of the 3 elevators nearest 50010 posts/);
});
