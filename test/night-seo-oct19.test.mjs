/* Night audits, Oct 19, 2026 (SEO and AI answer engines): small guards.
 *  - robots.txt keeps crawlers out of /test/ (13 fixture pages are captures of real businesses'
 *    pages, e.g. test/fixtures/coop-fert/mulvane_2026-10-15.html, served by Pages with no noindex),
 *    and never out of /components/ (the CSS and JS live there).
 *  - freshness.yml pings IndexNow for the pages it pushed: it pushes with the default token, so
 *    indexnow.yml's on: push never fires for it.
 *   node --test test/night-seo-oct19.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

/* SEO #8: hand pages' JSON-LD page name is the title (without " | AGSIST"). 34 had drifted when
 * titles were rewritten. bake_seo.py stamps the name on the pages whose titles it bakes;
 * scripts/build_glossary.py reads the page's title. A WebApplication's name is the tool's name
 * and is not held to the title. */
test("root pages: the JSON-LD WebPage name matches the title", () => {
  const strip = (t) => t.replace(/\s*\|\s*AGSIST$/, "");
  const ent = (s) => s.replace(/&rsquo;/g, "\u2019").replace(/&lsquo;/g, "\u2018").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const bad = [];
  for (const f of readdirSync(ROOT).filter((x) => x.endsWith(".html"))) {
    const s = read(f);
    if (/name="robots" content="[^"]*noindex/.test(s) || /http-equiv="refresh"/.test(s)) continue;
    const tm = /<title>([\s\S]*?)<\/title>/.exec(s);
    if (!tm) continue;
    const title = strip(ent(tm[1]).trim());
    for (const b of s.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      let d; try { d = JSON.parse(b[1]); } catch { continue; }
      const nodes = Array.isArray(d) ? d : (d["@graph"] || [d]);
      for (const n of nodes) {
        if (n && ["WebPage", "AboutPage", "ContactPage", "CollectionPage"].includes(n["@type"]) && n.name && strip(n.name) !== title) {
          bad.push(`${f}: "${n.name}" vs title "${title}"`);
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});
