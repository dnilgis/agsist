/* Audit Nov 2, 2026 item 18: the changelog linked "/cash-bids/", a folder with no
 * index.html, so the link 404'd; the page is cash-bids.html, served at /cash-bids.
 * The old entry in data/changelog.json stays as written (build rule 25); the
 * builders' shared live_href (scripts/build_changelog.py) links the page instead.
 *
 *   node --test test/changelog-folder-links.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("live_href: a folder link with no index goes to the page; a real folder index stays", () => {
  const out = execFileSync("python3", ["-c",
    "import sys; sys.path.insert(0, 'scripts'); import build_changelog as B; " +
    "print('|'.join(B.live_href(p) for p in ('/cash-bids/', '/cash-bids/#x', '/rent/', '/cash-bids')))"],
  { cwd: ROOT, encoding: "utf8" }).trim();
  assert.equal(out, "/cash-bids|/cash-bids#x|/rent/|/cash-bids");
});

test("every folder link the changelog prints has an index.html behind it", () => {
  const html = fs.readFileSync(path.join(ROOT, "changelog.html"), "utf8");
  const hrefs = [...html.matchAll(/class="cl-page" href="(\/[^"#?]*\/)(?:#[^"]*)?"/g)].map((m) => m[1]);
  const bad = [...new Set(hrefs)].filter((h) => !fs.existsSync(path.join(ROOT, h, "index.html")));
  assert.deepEqual(bad, [], "folder links with no index.html: " + bad.join(", "));
  assert.ok(!html.includes('href="/cash-bids/"'), "the Nov 2 case");
});
