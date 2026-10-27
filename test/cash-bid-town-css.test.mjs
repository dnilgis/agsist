/* The cash-bid page CSS is one shared file (Oct 27, 2026).
 *
 * The real case: scripts/build_cash_bid_pages.py wrote the same 4.7 KB
 * inline <style> (.cbt-*) into every town, state and company page, 1,807
 * pages and about 8 MB of the site (cadott.html 27,306 bytes, 5,132 of them
 * that block and the long GA guard comment). The rules now live in
 * components/cash-bid-town.css; each page links it where the <style> was, at
 * the end of the head, so the cascade and the first paint are the same.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const R = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const BUILDER = R("scripts/build_cash_bid_pages.py");
const LINK = /CSS_LINK = '(<link rel="stylesheet" href="\/components\/cash-bid-town\.css\?v=\d+">)'/.exec(BUILDER);

function* pages(dir) {
  for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* pages(rel);
    else if (ent.name.endsWith(".html")) yield rel;
  }
}

test("the builder links the shared file and types no inline page CSS", () => {
  assert.ok(LINK, "build_cash_bid_pages.py has no CSS_LINK to components/cash-bid-town.css");
  assert.ok(!/\.cbt-wrap\{/.test(BUILDER), "the .cbt-* rules are back inline in the builder");
  const css = R("components/cash-bid-town.css");
  for (const rule of [".cbt-wrap{max-width:900px", ".cbt-t td.n{font-family:'JetBrains Mono',monospace}",
                      ".cbt-hist summary{cursor:pointer", "@media (max-width:640px){.cbt-stat{min-width:0"]) {
    assert.ok(css.includes(rule), `cash-bid-town.css lost ${rule}`);
  }
});

test("every built cash-bid page links it once, at the end of the head, with no inline copy", () => {
  let built = 0;
  const bad = [];
  for (const rel of pages("cash-bids")) {
    const h = fs.readFileSync(path.join(ROOT, rel), "utf8");
    if (h.includes('name="agsist-pointer"')) continue; // a moved town's pointer page has no site chrome
    built++;
    const head = h.slice(0, h.indexOf("</head>"));
    if (head.split(LINK[1]).length - 1 !== 1) bad.push(`${rel}: not one link to the current cash-bid-town.css`);
    if (h.includes(".cbt-wrap{")) bad.push(`${rel}: inline .cbt-* CSS`);
    // the link sits after the JSON-LD, where the <style> was, so later rules still win as before
    if (head.lastIndexOf("application/ld+json") > head.indexOf(LINK[1])) bad.push(`${rel}: link moved before the JSON-LD`);
  }
  assert.ok(built >= 1500, `only ${built} cash-bid pages walked`);
  assert.deepEqual(bad.slice(0, 20), [], `${bad.length} problems`);
});
