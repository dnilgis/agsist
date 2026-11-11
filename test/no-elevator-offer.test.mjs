// Nov 10, 2026
// No public page, sponsor component or rate card offers an elevator a paid listing. Pages that show
// an elevator's bids never sell that elevator anything: no "Featured elevator" or "Featured listing"
// box, no "$19" listing price, no "Feature your elevator" or "Claim this page" sales line, and no
// elevator tier on the rate card or the sign-up form. The change log and What's new are history and
// are left out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const SKIP_DIRS = new Set([".git", "node_modules", "test", "notes", "data", "scripts", "build", ".github"]);
const SKIP_FILES = new Set(["changelog.html"]);

function walk(dir, out) {
  for (const n of readdirSync(dir)) {
    if (SKIP_DIRS.has(n)) continue;
    const p = join(dir, n), st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(html|js)$/.test(n) && !SKIP_FILES.has(n)) out.push(p);
  }
  return out;
}

const OFFER = [
  /featured\s+(elevator|listing)/i,
  /feature\s+your\s+elevator/i,
  /(^|[>"'\s])claim\s+(this|your)\s+(elevator\s+)?(page|listing)\s*(<|&rarr;|"|')/i,
  /tier=elevator/i,
  /\$\s?19\s?(\/|a |per )\s?(mo|month)/i,
  /\$19\b[^<\n]{0,60}(elevator|listing)|(elevator|listing)[^<\n]{0,60}\$19\b/i,
  /call[- ]to[- ]sell/i,
];

test("no public page or component offers an elevator listing", () => {
  const files = walk(ROOT, []);
  assert.ok(files.length > 100, "found the pages: " + files.length);
  const bad = [];
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    for (const rx of OFFER) if (rx.test(s)) bad.push(f.slice(ROOT.length) + " matches " + rx);
  }
  assert.deepEqual(bad, []);
});

test("the cash bids page builder writes no listing offer", () => {
  for (const f of ["scripts/build_cash_bid_pages.py", "scripts/stamp_rates.py"]) {
    let s = "";
    try { s = readFileSync(ROOT + f, "utf8"); } catch (e) { continue; }
    for (const rx of OFFER) assert.doesNotMatch(s, rx, f + " matches " + rx);
  }
});

test("the rate card and the sign-up form have no elevator tier", () => {
  const card = JSON.parse(readFileSync(ROOT + "data/rate-card.json", "utf8"));
  assert.deepEqual(card.tiers.map((t) => t.id).filter((id) => /elevator/i.test(id)), []);
  assert.doesNotMatch(readFileSync(ROOT + "components/sponsor-apply.js", "utf8"), /'elevator'|spa-elev|spa-town/);
  assert.doesNotMatch(readFileSync(ROOT + "sponsor-apply.html", "utf8"), /data-tier="elevator"|spa-elev|spa-town/);
});
