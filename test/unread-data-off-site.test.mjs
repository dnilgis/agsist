// Nov 6: data files builders and jobs read, but no page loads, are left out of the published site
// (scripts/check_site_budget.py NOT_READER_FACING). If a page, component or the service worker ever names one, it
// must come off that list first, or the page would load a file the deploy left out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = readFileSync(join(ROOT, "scripts/check_site_budget.py"), "utf8");
const block = src.slice(src.indexOf("# Nov 6: data files that builders and jobs read"));
const files = [...block.matchAll(/^\s+"(data\/[a-z0-9-]+\.json)",/gm)].map((m) => m[1]).slice(0, 24);

test("each left-out data file is named by no page, component or the service worker", () => {
  assert.equal(files.length, 24);
  const texts = [
    ...readdirSync(ROOT).filter((f) => f.endsWith(".html")).map((f) => [f, readFileSync(join(ROOT, f), "utf8")]),
    ...readdirSync(join(ROOT, "components")).filter((f) => /\.(js|html)$/.test(f)).map((f) => [`components/${f}`, readFileSync(join(ROOT, "components", f), "utf8")]),
    ["sw.js", readFileSync(join(ROOT, "sw.js"), "utf8")],
  ];
  for (const f of files) {
    const stem = f.slice(5, -5);
    for (const [name, t] of texts) assert.ok(!t.includes(stem), `${name} names ${f}, which the deploy leaves out`);
  }
});
