/* Land sales in the menu (Sig, Oct 29, 2026: the land sale page should be easy to find).
 * Every copy of the header carries Money & Land > Land sales to /land-sales/, next to the
 * Farmland Atlas: the live header (desktop panel and phone drawer), the no-JS fallback, the
 * menu table and the static header baked into every generated and root page.
 *   node --test test/land-menu.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const rd = (p) => readFileSync(join(ROOT, p), "utf8");

test("the live header and its fallback list Land sales right after the Farmland Atlas", () => {
  const h = rd("components/header.html");
  const land = h.indexOf('<div class="nav-q">Land</div>', h.indexOf('id="dd-money-panel"'));
  const panel = h.slice(land, h.indexOf('<div class="nav-col">', land));
  assert.match(panel, /<a href="\/farmland-atlas">.*?Farmland Atlas<\/a>\s*<a href="\/land-sales\/">.*?Land sales<\/a>/s, "desktop panel");
  const drawer = h.slice(h.indexOf('id="dg-money"'));
  assert.match(drawer, /<a href="\/farmland-atlas" class="draw-item">.*?Farmland Atlas<\/a>\s*<a href="\/land-sales\/" class="draw-item">.*?Land sales<\/a>/s, "phone drawer");
  assert.match(rd("components/header-fallback.html"), /<a href="\/farmland-atlas">Farmland Atlas<\/a> · <a href="\/land-sales\/">Land sales<\/a>/);
  assert.match(rd("scripts/dev/nav/gen_nav.py"), /\("\/land-sales\/", "Land sales", "i-land-plot"\)/);
  assert.ok(existsSync(join(ROOT, "land-sales/index.html")), "the page is there");
  // the Illinois index keeps its place and name (an "Illinois" label would put the state's name on every page)
  assert.match(rd("components/header-fallback.html"), /<a href="\/farmland-index">Farmland sale index<\/a>/);
});

test("every page with a baked static header carries the Land sales link", () => {
  let n = 0;
  const walk = (d) => {
    for (const f of readdirSync(join(ROOT, d))) {
      if (f.startsWith(".") || f === "node_modules") continue;
      const p = d ? d + "/" + f : f;
      if (statSync(join(ROOT, p)).isDirectory()) walk(p);
      else if (f.endsWith(".html")) {
        const t = rd(p), i = t.indexOf("<!-- static-nav:header");
        if (i < 0) continue;
        const blk = t.slice(i, t.indexOf("<!-- /static-nav:header -->", i));
        assert.ok(blk.includes('<a href="/land-sales/">Land sales</a>'), p);
        n++;
      }
    }
  };
  walk("");
  assert.ok(n > 4800, "baked headers: " + n);
});
