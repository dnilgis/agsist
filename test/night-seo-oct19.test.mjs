/* Night audits, Oct 19, 2026 (SEO and AI answer engines): small guards.
 *  - robots.txt keeps crawlers out of /test/ (13 fixture pages are captures of real businesses'
 *    pages, e.g. test/fixtures/coop-fert/mulvane_2026-10-15.html, served by Pages with no noindex),
 *    and never out of /components/ (the CSS and JS live there).
 *  - freshness.yml pings IndexNow for the pages it pushed: it pushes with the default token, so
 *    indexnow.yml's on: push never fires for it.
 *   node --test test/night-seo-oct19.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

test("robots.txt: /test/ disallowed, /components/ and /data/ open", () => {
  const r = read("robots.txt");
  assert.match(r, /^Disallow: \/test\/$/m);
  assert.doesNotMatch(r, /^Disallow: \/components/m);
  assert.doesNotMatch(r, /^Disallow: \/data\/$/m);
});

test("freshness.yml: IndexNow ping after its push, only for what it pushed", () => {
  const w = read(".github/workflows/freshness.yml");
  const c = w.indexOf("- name: Commit if changed"), p = w.indexOf("- name: IndexNow ping");
  assert.ok(c > 0 && p > c, "the ping step comes after the commit step");
  assert.match(w.slice(c, p), /id: commit/);
  assert.match(w.slice(c, p), /git show --name-only --format= HEAD > \/tmp\/fresh-changed\.txt\n\s+echo "pushed=1" >> "\$GITHUB_OUTPUT"/);
  const step = w.slice(p);
  assert.match(step, /if: steps\.commit\.outputs\.pushed == '1'/);
  assert.match(step, /continue-on-error: true/);
  assert.match(step, /indexnow_submit\.py --changed \$files/);
});
