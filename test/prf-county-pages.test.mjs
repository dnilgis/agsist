/* The PRF county pages (prf/<state>/<county>.html, scripts/build_prf_counties.py)
 * held to what a crawler and a reader need without running any script.
 *
 * WHY. These pages exist to answer "PRF <county>" and "PRF grid <id>" in plain
 * HTML. A generator change that moved the answer into script, dropped a grid
 * number, broke the JSON-LD or left a page out of sitemap-prf.xml would cost
 * the search traffic quietly. This reads the shipped files, not the builder.
 *
 *   node --test test/prf-county-pages.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const meta = JSON.parse(readFileSync(ROOT + "data/prf/meta.json", "utf8"));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sitemap = readFileSync(ROOT + "sitemap-prf.xml", "utf8");
const locs = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
const pages = [];
for (const st of meta.states) {
  const dir = ROOT + "prf/" + slug(st.name);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) if (f.endsWith(".html")) pages.push({ st, rel: "prf/" + slug(st.name) + "/" + f });
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const [sy, sm, sd] = meta.dates.sales_closing.split("-");
const SALES = `${MONTHS[+sm - 1]} ${+sd}, ${sy}`;

test("one page per county with PRF, each in sitemap-prf.xml", () => {
  assert.equal(pages.length, meta.counts.counties);
  assert.equal(locs.size, meta.counts.counties);
  for (const p of pages) assert.ok(locs.has("https://agsist.com/" + p.rel.replace(/\.html$/, "")), p.rel + " is not in sitemap-prf.xml");
  assert.ok(readFileSync(ROOT + "robots.txt", "utf8").includes("Sitemap: https://agsist.com/sitemap-prf.xml"), "robots.txt does not name sitemap-prf.xml");
});

test("the answer is in the HTML: grids by number, county values, the deadline, the tables", () => {
  const sample = pages.filter((_, i) => i % 97 === 0);
  assert.ok(sample.length >= 30);
  for (const p of sample) {
    const h = readFileSync(ROOT + p.rel, "utf8");
    const main = h.slice(h.indexOf("<main"), h.indexOf("</main>"));
    assert.match(main, /<h1>PRF insurance in [^<]+<\/h1>/, p.rel);
    assert.ok(main.includes(SALES), p.rel + " lacks the sales closing date");
    assert.match(main, /grids?: \d{5}/, p.rel + " lacks its grid numbers in the lede");
    assert.match(main, /Grazing, county base value per acre<\/dt><dd>\$\d/, p.rel);
    assert.equal((main.match(/<table /g) || []).length, 3, p.rel + " should carry the month, recent-year and grid tables");
    assert.ok(statSync(ROOT + p.rel).size < 40 * 1024, p.rel + " is over 40 KB");
  }
});

test("canonical, title and JSON-LD are right on every page", () => {
  const titles = new Set();
  for (const p of pages) {
    const h = readFileSync(ROOT + p.rel, "utf8");
    const url = "https://agsist.com/" + p.rel.replace(/\.html$/, "");
    assert.ok(h.includes(`<link rel="canonical" href="${url}">`), p.rel + " canonical");
    const t = h.match(/<title>([^<]+)<\/title>/)[1];
    assert.ok(!titles.has(t), "two pages share the title " + t);
    titles.add(t);
    const blocks = [...h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
    assert.deepEqual(blocks.map((b) => b["@type"]), ["WebPage", "FAQPage", "BreadcrumbList"], p.rel);
    assert.equal(blocks[2].itemListElement[3].item, url, p.rel + " breadcrumb");
    assert.ok(blocks[1].mainEntity.length >= 4, p.rel + " FAQ");
  }
});

test("each state page links every county row to its page", () => {
  for (const st of meta.states) {
    const h = readFileSync(ROOT + "prf/" + slug(st.name) + ".html", "utf8");
    const n = (h.match(new RegExp(`<th scope="row"><a href="/prf/${slug(st.name)}/`, "g")) || []).length;
    assert.equal(n, st.counties, st.name);
  }
});
