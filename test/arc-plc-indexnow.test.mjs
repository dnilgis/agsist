/* arc-plc-refresh.yml pings IndexNow for the pages it pushed (panel B4, 2026-10-20).
 * It pushes with the default token, so indexnow.yml's on: push never fires for it and
 * ARC/PLC changes reached Bing only in the next Monday's full submission, 6 days later.
 *   node --test test/arc-plc-indexnow.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const w = readFileSync(ROOT + ".github/workflows/arc-plc-refresh.yml", "utf8");

test("arc-plc-refresh.yml: IndexNow ping after its push, only for what it pushed", () => {
  const c = w.indexOf("- name: Build and commit"), p = w.indexOf("- name: IndexNow ping");
  assert.ok(c > 0 && p > c, "the ping step comes after the commit step");
  assert.match(w.slice(c, p), /id: commit/);
  assert.match(w.slice(c, p), /if git push; then\n\s+echo "Pushed on attempt \$i\."\n\s+git show --name-only --format= HEAD > \/tmp\/arc-changed\.txt\n\s+echo "pushed=1" >> "\$GITHUB_OUTPUT"\n\s+exit 0/);
  const step = w.slice(p);
  assert.match(step, /if: steps\.commit\.outputs\.pushed == '1'/);
  assert.match(step, /continue-on-error: true/);
  assert.match(step, /grep -E '\\\.html\$' \/tmp\/arc-changed\.txt/);
  assert.match(step, /indexnow_submit\.py --changed \$files/);
  assert.doesNotMatch(step, /--urls|sitemap-arc-plc\.xml/, "never the whole set");
});
