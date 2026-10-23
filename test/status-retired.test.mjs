/* /status is retired (Sig, Oct 21, 2026: it put the feed plumbing on display).
 *
 *   node --test test/status-retired.test.mjs
 *
 * status.html is the site's standard redirect stub to the homepage (noindex, canonical /), and no
 * page, menu, footer, sitemap, llms.txt, search entry or Next block links to it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

test("status.html is the redirect stub to the homepage", () => {
  const s = read("status.html");
  assert.ok(Buffer.byteLength(s) < 1536, "stub under 1.5 KB");
  assert.match(s, /<meta name="robots" content="noindex,follow">/);
  assert.match(s, /<link rel="canonical" href="https:\/\/agsist\.com\/">/);
  assert.match(s, /<meta http-equiv="refresh" content="0; url=\/">/);
  assert.match(s, /location\.replace\("\/"\)/);
  assert.match(read("scripts/inject_static_nav.py"), /"\/here", "\/status"[,)]/, "on the nav check's retired list");
});

test("nothing links to /status: chrome, sitemap, llms.txt, search, Next blocks, every page", () => {
  const LINK = /href="\/status(?:[#?"])|agsist\.com\/status\b|"href": ?"\/status"/;
  for (const f of ["components/header.html", "components/footer.html", "components/header-fallback.html", "components/footer-fallback.html",
    "sitemap.xml", "llms.txt", "data/search-index.json", "data/next-links.json"]) assert.doesNotMatch(read(f), LINK, f);
  assert.doesNotMatch(read("data/search-index.json"), /"\/status"/);
  const bad = [];
  (function walk(d) {
    for (const n of readdirSync(path.join(ROOT, d))) {
      if (n.startsWith(".") || n === "node_modules" || n === "data" || n === "test") continue;
      const p = d ? d + "/" + n : n;
      if (statSync(path.join(ROOT, p)).isDirectory()) { walk(p); continue; }
      if (/\.html$/.test(n) && p !== "status.html" && LINK.test(read(p))) bad.push(p);
    }
  })("");
  assert.deepEqual(bad, [], "pages linking to /status");
  for (const n of readdirSync(path.join(ROOT, "data/next"))) assert.doesNotMatch(read("data/next/" + n), /"\/status"/, n);
});
