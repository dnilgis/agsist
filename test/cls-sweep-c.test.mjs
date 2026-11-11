/* CLS sweep, Nov 10, 2026 (part c): /urea, /combine-loss, /nutrient-removal, and the farm sale pages (a county page
 * and the hub, both built on main by scripts/build_land_sales.py; the fix is in components/land-sales.css).
 * Sum of layout shifts before -> after, max of 390 and 1280, plain and saved (Chetek WI 54728):
 *   /urea                                  0.078 -> 0.020  the price line started hidden in the hero
 *   /combine-loss                          0.067 -> 0.000  the soybean-only box was shown by the script
 *   /nutrient-removal                      0.059 -> 0.000  the price rows and the Your area box filled late
 *   /land-sales/wisconsin/barron-county    0.063 -> 0.001  the alert form was drawn into an empty box
 *   /land-sales/                           0.245 -> 0.007  the map drew into an empty box (not in the sweep; found here)
 * Harness and throttling: test/cls-sweep-lib.mjs.
 *
 *   node --test test/cls-sweep-c.test.mjs
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { read, skip, MODES, open } from "./cls-sweep-lib.mjs";

const LIMIT = 0.04;
const PAGES = ["/spray#urea",   // the urea tab of /spray since Nov 11, 2026
   "/combine-loss", "/nutrient-removal", "/land-sales/wisconsin/barron-county", "/land-sales/"];

test("the holds are in the pages and the builder", () => {
  const U = read("spray.html") + read("components/fold/urea.js"), C = read("combine-loss.html"), N = read("nutrient-removal.html"), L = read("components/land-sales.css");
  assert.match(U, /class="hero-sub up-wait" id="urea-price-line"/, "urea: the price line starts held");
  assert.match(U, /\.catch\(letGo\);\}catch\(e\)\{letGo\(\);\}/, "urea: a failed price file lets go of the hold");
  assert.match(C, /document\.documentElement\.setAttribute\('data-cl',clC\)/, "combine loss: the crop is set before paint");
  assert.match(N, /h\.classList\.add\('nr-wait'\)/, "nutrient removal: the price lines are held before paint");
  assert.match(N, /\.nr \.nr-prices\{min-height:\d+px\}/, "nutrient removal: the price rows hold their height");
  assert.match(read("components/nutrient-removal.js"), /\}, function \(\) \{ d\.documentElement\.classList\.remove\('nr-wait'\); \}\);/, "nutrient removal: a failed load lets go");
  assert.match(L, /\.ls-ask \{ min-height: \d+px; \}/, "land sales: the alert form's room is held");
  assert.match(L, /\.ls-usmap:not\(:has\(\.usm\)\)::before \{[^}]*aspect-ratio: 866\.9 \/ 553\.2;/, "land sales: the hub map's box is held");
  assert.match(read("scripts/build_land_sales.py"), /land-sales\.css\?v=4/, "land sales: the builder asks for the new stylesheet");
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
