/* Land sales in the menu (Oct 29, 2026: the land sale page should be easy to find).
 * Every copy of the header carries Money & Land > Land sales to /land-sales/: the live header
 * (desktop panel and phone drawer), the no-JS fallback, the menu table and the static header baked
 * into every generated and root page. Nov 4, 2026 (lead, "not missable"): renamed "Farmland sales"
 * and moved first under Land. A generated set's pages take the new label when main rebuilds them
 * (scripts/generated_sets.py); until then they keep the link under its old name.
 *   node --test test/land-menu.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const rd = (p) => readFileSync(join(ROOT, p), "utf8");

test("the live header and its fallback list Farmland sales first under Land", () => {
  const h = rd("components/header.html");
  const land = h.indexOf('<div class="nav-q">Land</div>', h.indexOf('id="dd-money-panel"'));
  const panel = h.slice(land, h.indexOf('<div class="nav-col">', land));
  assert.match(panel, /^<div class="nav-q">Land<\/div>\s*<a href="\/land-sales\/">.*?Farmland sales<\/a>\s*<a href="\/rent\/">/s, "desktop panel");
  const drawer = h.slice(h.indexOf('id="dg-money"'));
  assert.match(drawer, /<h3 class="draw-sub">Land<\/h3>\s*<div class="draw-links">\s*<a href="\/land-sales\/" class="draw-item">.*?Farmland sales<\/a>\s*<a href="\/rent\/" class="draw-item">/s, "phone drawer");
  assert.match(rd("components/header-fallback.html"), /Land: <a href="\/land-sales\/">Farmland sales<\/a> · <a href="\/rent\/">Cash rent<\/a>/);
  assert.match(rd("scripts/dev/nav/gen_nav.py"), /\("Land", \[\("\/land-sales\/", "Farmland sales", "i-land-plot"\)/);
  assert.ok(existsSync(join(ROOT, "land-sales/index.html")), "the page is there");
  // Oct 29, 2026: the Illinois index is a section of the land sales hub, so its own menu line is gone
  assert.doesNotMatch(rd("components/header-fallback.html"), /href="\/farmland-index"/);
  assert.doesNotMatch(rd("components/header.html"), /href="\/farmland-index"/);
});

test("every page with a baked static header carries the land sales link: Farmland sales, the old name only on a generated set's page until main rebuilds it", () => {
  let n = 0;
  const old = [];
  const walk = (d) => {
    for (const f of readdirSync(join(ROOT, d))) {
      if (f.startsWith(".") || f === "node_modules") continue;
      const p = d ? d + "/" + f : f;
      if (statSync(join(ROOT, p)).isDirectory()) walk(p);
      else if (f.endsWith(".html")) {
        const t = rd(p), i = t.indexOf("<!-- static-nav:header");
        if (i < 0) continue;
        const blk = t.slice(i, t.indexOf("<!-- /static-nav:header -->", i));
        if (blk.includes('<a href="/land-sales/">Farmland sales</a>')) { n++; continue; }
        assert.ok(blk.includes('<a href="/land-sales/">Land sales</a>'), p);
        old.push(p);
        n++;
      }
    }
  };
  walk("");
  assert.ok(n > 4800, "baked headers: " + n);
  // the old name is allowed only on a generated set's own pages (scripts/generated_sets.py SETS outputs), which main
  // rebuilds; any other page (a root page, lrp/record.html from bake_lrp.mjs) must carry the new one now
  const owned = JSON.parse(execFileSync("python3", ["-c",
    "import json,sys; sys.path.insert(0,'scripts'); import generated_sets as G; print(json.dumps([p for p in json.load(sys.stdin) if not G.owner(p)]))"],
    { cwd: ROOT, encoding: "utf8", input: JSON.stringify(old), maxBuffer: 1 << 26 }));
  assert.deepEqual(owned, [], "pages outside the generated sets still say Land sales");
});
