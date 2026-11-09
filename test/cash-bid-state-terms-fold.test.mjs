/* Curtain round 2 (Nov 9): cash-bid state pages and elevator company pages end in one closed "Sources and terms"
 * fold (the old open "How these numbers are made" and "Where these come from" blocks), call-to-confirm inside, no
 * read-pass wording. Pages come from the builder's fixture (scripts/build_cash_bid_pages.py --selftest,
 * CBT_FIXTURE_DIR). node --test test/cash-bid-state-terms-fold.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const dir = mkdtempSync(tmpdir() + "/cbs-");
const r = spawnSync("python3", ["scripts/build_cash_bid_pages.py", "--selftest"], { cwd: ROOT, env: { ...process.env, CBT_FIXTURE_DIR: dir }, encoding: "utf8" });
const states = [], companies = [];
for (const st of existsSync(dir) ? readdirSync(dir) : []) {
  if (!existsSync(`${dir}/${st}/index.html`)) continue;
  if (st === "company") for (const f of readdirSync(`${dir}/company`)) { if (f !== "index.html") companies.push(`${dir}/company/${f}`); }
  else states.push(`${dir}/${st}/index.html`);
}
const BANNED = /Where these come from|How these numbers are made|read successfully|did not fail on the latest pass|read by AGSIST|no third-party bid feed|unchanged\s+over a weekend|at least \d+ elevators|\.json|\.py\b|workflow|pipeline/i;

test("selftest passes and writes state and company fixture pages", () => {
  assert.equal(r.status, 0, (r.stderr || "").slice(-600));
  assert.ok(states.length >= 2 && companies.length >= 1, `${states.length} states, ${companies.length} companies`);
});

for (const [label, list] of [["state", states], ["company", companies]]) {
  test(`${label} pages: one closed Sources and terms fold, last in the page body, notices inside`, () => {
    for (const p of list) {
      const h = readFileSync(p, "utf8");
      const main = h.slice(h.indexOf("<main"), h.indexOf("</main>"));
      const folds = main.match(/<details[^>]*><summary>Sources and terms<\/summary>/g) || [];
      assert.equal(folds.length, 1, p);
      assert.ok(!/\sopen[\s>]/.test(folds[0]), p + " closed");
      const i = main.indexOf(folds[0]), e = main.indexOf("</details>", i);
      assert.equal(main.slice(e + 10).trim(), "", p + ": last thing in the body");
      assert.match(main.slice(i, e), /call the elevator to confirm/i, p);
      assert.match(main.slice(i, e), /own posted bid board/, p);
      assert.ok(!/cbt-note"?>/.test(main.slice(0, i).replace(/<div class="cbt-note"><b>No (current bid|basis)/g, "")), p + ": no second source block above it");
    }
  });
  test(`${label} pages: no read-pass or pipeline wording in the page`, () => {
    for (const p of list) {
      const h = readFileSync(p, "utf8");
      const main = h.slice(h.indexOf("<main"), h.indexOf("</main>")).replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
      const m = main.match(BANNED);
      assert.equal(m, null, p + ": " + (m && m[0]));
    }
  });
}
