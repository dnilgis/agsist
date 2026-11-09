/* Curtain round 2 (Nov 9): every cash-bid town page ends in one closed "Sources and terms" fold (the old open
 * "Where these come from" block), with the call-to-confirm line and the bid source inside, and none of the
 * pipeline wording. The set is built from a live bid snapshot on main, so the pages come from the builder's own
 * fixture towns (scripts/build_cash_bid_pages.py --selftest, CBT_FIXTURE_DIR).
 * node --test test/cash-bid-terms-fold.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const dir = mkdtempSync(tmpdir() + "/cbt-");
const r = spawnSync("python3", ["scripts/build_cash_bid_pages.py", "--selftest"], { cwd: ROOT, env: { ...process.env, CBT_FIXTURE_DIR: dir }, encoding: "utf8" });
const pages = [];
for (const st of existsSync(dir) ? readdirSync(dir) : []) {
  const d = `${dir}/${st}`;
  try { for (const f of readdirSync(d)) if (f.endsWith(".html") && f !== "index.html") pages.push(`${d}/${f}`); } catch {}
}
const BANNED = /Where these come from|read successfully|did not fail on the latest pass|bid board directly|no third-party bid feed|daily basis log|\.json|\.py\b|\.yml|workflow|pipeline/i;

test("the builder selftest passes and writes fixture town pages", () => {
  assert.equal(r.status, 0, (r.stderr || "").slice(-600));
  assert.ok(pages.length >= 3, "town pages: " + pages.length);
});

test("every town page: one closed Sources and terms fold, last in the page body, notices inside", () => {
  for (const p of pages) {
    const h = readFileSync(p, "utf8");
    const main = h.slice(h.indexOf("<main"), h.indexOf("</main>"));
    const folds = main.match(/<details[^>]*><summary>Sources and terms<\/summary>/g) || [];
    assert.equal(folds.length, 1, p + ": exactly one fold");
    assert.ok(!/\sopen[\s>]/.test(folds[0]), p + ": closed");
    const i = main.indexOf(folds[0]), e = main.indexOf("</details>", i);
    const fold = main.slice(i, e);
    assert.equal(main.slice(e + 10).trim(), "", p + ": the fold is the last thing in the page body");
    assert.match(fold, /call the elevator to confirm/i, p);
    assert.match(fold, /each elevator(&rsquo;|')s own posted bid board/, p);
    assert.match(fold, /Basis is cash minus the futures contract/, p);
    assert.match(fold, /href="\/cash-bids\?zip=\d{5}"|live page/, p);
    assert.ok(!/<details[^>]*cbt-note/.test(main.slice(0, i)), p + ": no second source block above it");
  }
});

test("no pipeline or method wording on a town page", () => {
  for (const p of pages) {
    const h = readFileSync(p, "utf8");
    const text = h.slice(h.indexOf("<body")).replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "");
    const m = text.match(BANNED);
    assert.equal(m, null, p + ": " + (m && m[0]));
  }
});
