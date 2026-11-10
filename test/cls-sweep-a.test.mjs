/* CLS sweep, Nov 10, 2026 (part a): /tariffs, /cattle-auction-prices, /harvest-price-tracker, /conditions, /hay-prices.
 * Sum of layout shifts before -> after, max of 390 and 1280, plain and saved (Chetek WI 54728):
 *   /tariffs                 0.430 -> 0.000  the status banner grew 54 to 144 px when the data landed
 *   /cattle-auction-prices   0.261 -> 0.000  the price glance started hidden and was shown at 2.5 s
 *   /harvest-price-tracker   0.249 -> 0.010  saved: the clear button, the state verdict and the state cards came in at 4 s
 *   /conditions              0.244 -> 0.003  1280: the map drew into an empty box and the verdict columns grew
 *   /hay-prices              0.215 -> 0.000  the AMS tables (1,200 to 1,800 px) replaced a short placeholder
 * Harness and throttling: test/cls-sweep-lib.mjs.
 *
 *   node --test test/cls-sweep-a.test.mjs
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { read, skip, MODES, open } from "./cls-sweep-lib.mjs";

const LIMIT = 0.04;
const PAGES = ["/tariffs", "/cattle-auction-prices", "/harvest-price-tracker", "/conditions", "/hay-prices"];

test("the holds are in the pages", () => {
  const T = read("tariffs.html"), C = read("cattle-auction-prices.html"), H = read("harvest-price-tracker.html"), D = read("conditions.html"), Y = read("hay-prices.html");
  assert.match(T, /\.tsb-note \{ min-height: [\d.]+em; \}/, "tariffs: the banner note holds its lines");
  assert.match(C, /\.sb-ghold \.sb-glance\{min-height:\d+px\}/, "cattle auction: the glance holds its room");
  assert.match(H, /classList\.add\('hp-st','hp-st-wait'\)/, "harvest tracker: a saved state is known before paint");
  assert.match(H, /\.hp-st-wait #pd-your\{min-height:\d+px\}/, "harvest tracker: the state cards' room is held");
  assert.equal((H.match(/classList\.remove\('hp-st-wait'\)|classList\.remove\('hp-st','hp-st-wait'\)/g) || []).length >= 4, true, "harvest tracker: every way out of the wait lets go of the hold");
  assert.match(D, /#cd-grid\{min-height:calc\(min\(100vw - 32px, 900px\) \* \.6381/, "conditions: the map box is held at usmap.js's ratio");
  assert.match(D, /\.cd-ver>div:last-child\{min-height:\d+px\}/, "conditions: the verdict column is held at desktop width");
  assert.match(Y, /<div id="hp-ams-live" class="hp-ams-wait"/, "hay: the AMS box starts held");
  assert.match(read("components/hay-ams.js"), /box\.classList\.remove\('hp-ams-wait'\)/, "hay: hay-ams.js lets go once it has drawn");
});

let h = null;
before(async () => { if (!skip) h = await open(); });
after(async () => { if (h) await h.close(); });
for (const p of PAGES) for (const [w, saved] of MODES) {
  test(`${p} at ${w}px, ${saved ? "saved ZIP 54728" : "nothing saved"}: layout shift under ${LIMIT}`, { skip, timeout: 90000 }, async () => {
    const r = await h.cls(p, w, saved);
    assert.ok(r.cls < LIMIT, `layout shift ${r.cls.toFixed(4)}: ${r.who.join(" | ")}`);
  });
}
