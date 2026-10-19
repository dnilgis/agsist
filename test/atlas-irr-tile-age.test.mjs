/* Phone audit, Oct 19, 2026: Marathon County, WI led its Atlas page with
 * "Cash rent, irrigated $114 /ac, 2011 county average", 15 years old, in the
 * headline tiles. The neighbor table on the same page already shows n/a for a
 * rent more than three survey years old; the tile now follows that rule and
 * keeps the year. Hall County, NE (2026 irrigated rent) keeps its dollar figure.
 *
 *   node --test test/atlas-irr-tile-age.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import os from "node:os";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const TILE = /Cash rent, irrigated<\/div><div class="v">(.*?)<\/div><div class="s">([^<]*)/;

test("the builder: a 2011 irrigated rent is n/a with its year, a 2026 one prints", () => {
  const out = mkdtempSync(join(os.tmpdir(), "atlas-irr-"));
  execFileSync("python3", ["scripts/build_atlas_pages.py", "--only", "55073", "31079", "--out", out],
    { cwd: ROOT, env: { ...process.env, PYTHONHASHSEED: "0" }, stdio: "pipe" });
  const mar = TILE.exec(readFileSync(join(out, "farmland-atlas/wisconsin/marathon-county.html"), "utf8"));
  assert.ok(mar, "Marathon has an irrigated tile");
  assert.equal(mar[1], "<small>n/a</small>");
  assert.equal(mar[2], "last published 2011, more than three survey years old");
  const hall = TILE.exec(readFileSync(join(out, "farmland-atlas/nebraska/hall-county.html"), "utf8"));
  assert.match(hall[1], /^\$\d+<small>\/ac<\/small>$/);
  assert.match(hall[2], /^2026 county average/);
});

test("the published pages: no headline irrigated rent more than three years older than the newest", () => {
  const dir = join(ROOT, "farmland-atlas");
  const tiles = [];
  for (const st of readdirSync(dir, { withFileTypes: true })) {
    if (!st.isDirectory()) continue;
    for (const f of readdirSync(join(dir, st.name))) {
      if (!f.endsWith("-county.html") && !f.endsWith(".html")) continue;
      const m = TILE.exec(readFileSync(join(dir, st.name, f), "utf8"));
      if (m) tiles.push([st.name + "/" + f, m[1], m[2]]);
    }
  }
  const years = tiles.map((t) => +(/^(\d{4}) county average/.exec(t[2]) || [0, 0])[1]).filter(Boolean);
  const latest = Math.max(...years);
  assert.ok(latest >= 2026 && tiles.length > 300, "tiles found: " + tiles.length);
  const old = tiles.filter((t) => { const y = /^(\d{4}) county average/.exec(t[2]); return y && +y[1] < latest - 3; });
  assert.deepEqual(old.slice(0, 5), [], old.length + " stale irrigated tiles");
});
