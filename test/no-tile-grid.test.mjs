/* No state tile grid anywhere (Nov 8, 2026): every US map is the real map (data/us-states-map.svg, components/usmap.js).
 * Guards: no source file carries a table of state codes with row and column positions, and no tile-grid class or name comes
 * back; the share image picture draws 51 real shapes.
 *
 *   node --test test/no-tile-grid.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const files = execFileSync("git", ["ls-files", "-z", "--", "*.py", "*.js", "*.mjs", "*.html", "*.css"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 })
  .split("\0").filter((f) => f && !/^(vendor|data|test|node_modules)\//.test(f) && !/^scripts\/dev\//.test(f));
// a table that puts several state codes at [row, col] / (col, row) positions
const CELLS = /\b(?:WA|OR|CA|ID|MT|IA|IL|TX|FL|NY|ME|VT)["']?\s*[:=]\s*[\[(]\s*\d{1,2}\s*,\s*\d{1,2}\s*[\])]/g;
const NAMES = /\b(?:TILE_GRID|tile-?grid|state-?tiles?|usm?-tile|tilemap)\b/i;

test("no source file draws states as a grid of tiles", () => {
  const bad = [];
  for (const f of files) {
    const s = readFileSync(join(ROOT, f), "utf8");
    if ((s.match(CELLS) || []).length >= 3) bad.push(f + ": a table of state positions");
    s.split("\n").forEach((ln, i) => { if (NAMES.test(ln) && !/never a|not a (state )?tile|instead of the (state )?tile/i.test(ln)) bad.push(`${f}:${i + 1}: ${ln.trim().slice(0, 80)}`); });
  }
  assert.deepEqual(bad, []);
});

test("the share image picture draws the 51 real shapes, once each, and renders", () => {
  const code = `
import sys, json
sys.path.insert(0, "scripts")
import share_cards as SC
shapes, vw, vh = SC.us_map()
p = {"counts": {"IA": 400, "IL": 120, "TX": 90, "NJ": 5, "AK": 1}, "big": "2,080", "lines": ["elevators in 1,641 towns.", "IA leads with 400."]}
jpg = SC.card_c([("Cash grain bids", False)], "meta", "cap", ("tiles", p))
print(json.dumps({"n": len(shapes), "ids": sorted(s["st"] for s in shapes), "drawn": p["_shapes"], "jpg": len(jpg) > 5000}))`;
  const r = spawnSync("python3", ["-I", "-c", code.replace('sys.path.insert(0, "scripts")', `sys.path.insert(0, ${JSON.stringify(join(ROOT, "scripts"))})`)], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.n, 51); assert.equal(new Set(o.ids).size, 51); assert.equal(o.drawn, 51); assert.ok(o.jpg);
});
