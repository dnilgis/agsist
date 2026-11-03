// Nov 3, 2026: ubuntu-latest moved to 26.04 and `playwright install --with-deps` exits 1 there
// ("Cannot install dependencies for ubuntu26.04-x64"). land-data's Wisconsin step died on it and
// the job never committed Illinois' October sales, so the land sale email had nothing to send.
// Any workflow that installs Playwright's system deps must run on a pinned runner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WF = join(ROOT, ".github", "workflows");

test("workflows that install Playwright deps pin their runner", () => {
  const bad = [];
  let seen = 0;
  for (const f of readdirSync(WF).filter((n) => /\.ya?ml$/.test(n))) {
    const s = readFileSync(join(WF, f), "utf8");
    if (!/playwright install --with-deps/.test(s)) continue;
    seen++;
    for (const m of s.matchAll(/runs-on:\s*([^\s#]+)/g)) if (m[1] === "ubuntu-latest") bad.push(f);
  }
  assert.ok(seen >= 6, `found ${seen} workflows installing Playwright deps`);
  assert.deepEqual([...new Set(bad)], []);
});

test("a Wisconsin browser failure never drops the land-data commit", () => {
  const s = readFileSync(join(WF, "land-data.yml"), "utf8");
  const i = s.indexOf("- name: Wisconsin transfer returns (browser)");
  assert.ok(i > 0);
  const step = s.slice(i, s.indexOf("\n      - name:", i + 10));
  assert.match(step, /\n\s+continue-on-error: true/);
});
