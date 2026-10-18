/* Sig, Oct 18, 2026: "I don't want my name on the top of any pages." The name goes in one
 * quiet line at the end of the page (class by-end) or a source note lower down; structured
 * data keeps the author. This holds every hand-built page, every Daily issue, and the
 * ARC/PLC, custom-rate and Cash Bid Index pages to it: no visible "Sigurd Lindquist" between
 * the start of the page and the first 1,500 characters of text after the H1.
 *
 *   node --test test/byline-bottom.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const list = (d) => existsSync(join(ROOT, d)) ? readdirSync(join(ROOT, d)).filter((f) => f.endsWith(".html")).map((f) => d + "/" + f) : [];
// pages whose whole subject is who runs the site
const ABOUT_SIG = new Set(["about.html", "contact.html", "terms.html", "privacy.html", "developer.html", "accessibility.html",
  "editorial-standards.html", "data-sources.html", "list-your-elevator.html", "prf-sponsor.html", "prf-sponsor-kit.html", "sponsor-kit.html", "sponsor-report.html"]);

function topText(html) {
  const body = html.replace(/<p class="by-end"[\s\S]*?<\/p>/g, "").replace(/<head[\s\S]*?<\/head>/, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  const h = body.indexOf("<h1");
  if (h < 0) return "";
  const text = (s) => s.replace(/<[^>]+>/g, "");
  const before = text(body.slice(0, h));
  return before + text(body.slice(h)).slice(0, 1500);
}

test("no name at the top of a page", () => {
  const files = readdirSync(ROOT).filter((f) => f.endsWith(".html") && !ABOUT_SIG.has(f))
    .concat(list("daily"), list("custom-rates"), list("arc-plc"));
  for (const d of readdirSync(join(ROOT, "arc-plc"), { withFileTypes: true })) if (d.isDirectory()) files.push(...list("arc-plc/" + d.name));
  const bad = files.filter((f) => /Sigurd Lindquist/.test(topText(read(f))));
  assert.deepEqual(bad.slice(0, 20), [], bad.length + " pages carry the name near the top");
  assert.ok(files.length > 3000, String(files.length));
});

test("the builders write the name at the end, not under the headline", () => {
  assert.doesNotMatch(read("scripts/build_arc_plc.py"), /ap-byline">By <a href="\/about">Sigurd Lindquist/);
  assert.doesNotMatch(read("scripts/build_custom_rates.py"), /<p class="by">Sigurd Lindquist/);
  assert.doesNotMatch(read("scripts/cash_bid_index.py"), /<p class="by">By <a href="\/about" rel="author">Sigurd Lindquist/);
  assert.match(read("scripts/generate_daily.py"), /parts = \[\]/);
  assert.match(read("scripts/build_arc_plc.py"), /Made by <a href="\/about">Sigurd Lindquist, CCA<\/a>, Chetek, Wisconsin\./);
});
