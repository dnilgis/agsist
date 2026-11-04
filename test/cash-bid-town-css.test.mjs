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
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const R = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const BUILDER = R("scripts/build_cash_bid_pages.py");
const LINK_RE = /CSS_LINK = '(<link rel="stylesheet" href="\/components\/cash-bid-town\.css\?v=\d+">)'/;
const LINK = LINK_RE.exec(BUILDER);

/* The committed pages are built on main only (scripts/generated_sets.py, Nov 4): the cash bid set reads the
   live network, so a pull request that changes the builder is not rebuilt in the PR checks and its pages are
   still the base's. There (AGSIST_GEN_BASE set and the builder changed against it) the walk holds the pages to
   the link the base's builder writes, and the builder's own link is checked on the frozen fixture below. On
   main, and anywhere else, the pages must carry the current link. */
function pagesLink() {
  const base = process.env.AGSIST_GEN_BASE;
  if (!base) return LINK[1];
  const d = spawnSync("git", ["diff", "--quiet", base, "HEAD", "--", "scripts/build_cash_bid_pages.py"], { cwd: ROOT });
  if (d.status !== 1) return LINK[1];
  const old = spawnSync("git", ["show", `${base}:scripts/build_cash_bid_pages.py`], { cwd: ROOT, encoding: "utf8" });
  assert.equal(old.status, 0, `cannot read the base builder (${base})`);
  const m = LINK_RE.exec(old.stdout);
  return m ? m[1] : LINK[1];
}

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
  const link = pagesLink();
  let built = 0;
  const bad = [];
  for (const rel of pages("cash-bids")) {
    const h = fs.readFileSync(path.join(ROOT, rel), "utf8");
    if (h.includes('name="agsist-pointer"')) continue; // a moved town's pointer page has no site chrome
    if (rel === "cash-bids/states.html" && h.includes("<title>Moved | AGSIST</title>")) continue; // forward page to /basis#states (scripts/moved_pages.py)
    built++;
    const head = h.slice(0, h.indexOf("</head>"));
    if (head.split(link).length - 1 !== 1) bad.push(`${rel}: not one link to the current cash-bid-town.css`);
    if (h.includes(".cbt-wrap{")) bad.push(`${rel}: inline .cbt-* CSS`);
    // the link sits after the JSON-LD, where the <style> was, so later rules still win as before
    if (head.lastIndexOf("application/ld+json") > head.indexOf(link)) bad.push(`${rel}: link moved before the JSON-LD`);
  }
  assert.ok(built >= 1500, `only ${built} cash-bid pages walked`);
  assert.deepEqual(bad.slice(0, 20), [], `${bad.length} problems`);
});

test("the builder's own town page (frozen Nevada, IA fixture) links the current file once, after the JSON-LD", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "cbtcss-"));
  try {
    const py = "import sys; sys.path.insert(0, sys.argv[1]); import build_cash_bid_pages as B; " +
      "B.BUY.load = lambda root='.': []; B.build_fixture_town(sys.argv[2], sys.argv[3] + '/cash-bids', root=sys.argv[3])";
    const r = spawnSync("python3", ["-c", py, path.join(ROOT, "scripts"), path.join(ROOT, "test/fixtures/sharebid/nevada-ia.json"), out],
      { cwd: ROOT, encoding: "utf8" });
    assert.equal(r.status, 0, `fixture build failed: ${(r.stderr || "").slice(-600)}`);
    const h = fs.readFileSync(path.join(out, "cash-bids/iowa/nevada.html"), "utf8");
    const head = h.slice(0, h.indexOf("</head>"));
    assert.equal(head.split(LINK[1]).length - 1, 1, "not one link to the current cash-bid-town.css");
    assert.ok(!h.includes(".cbt-wrap{"), "inline .cbt-* CSS");
    assert.ok(head.lastIndexOf("application/ld+json") < head.indexOf(LINK[1]), "link before the JSON-LD");
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
