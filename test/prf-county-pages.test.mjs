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
    /* Sig, Oct 20: the grid numbers left the lede for the grids table; the FAQ still names them all */
    assert.match(main, /<table class="prf-t prf-co-t">[\s\S]*?<th scope="row">\d{4,5}<\/th>/, p.rel + " lacks its grid numbers in the grids table");
    assert.match(main, /Which PRF grid is [^<]+\?<\/summary><p>Grids? \d{4,5}/, p.rel + " lacks its grid numbers in the FAQ");
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

/* The labeled 100-acre example under the stat tiles. Worked out again here
 * from USDA's files with components/prf-math.js, apart from the builder, and
 * tied to the calculator's own example (data/prf/facts.json, grid 30454 in
 * Barron County, the figures RMA's tool was matched against): a page that
 * printed another policy's numbers, or rounded its own way, fails. */
import vm from "node:vm";
const mctx = { window: {}, Buffer };
vm.runInNewContext(readFileSync(ROOT + "components/prf-math.js", "utf8"), mctx);
const M = mctx.window.AgPrfMath;
const shardCache = {};
function gridRec(g) {
  const k = M.shardKey(g);
  if (!shardCache[k]) shardCache[k] = JSON.parse(readFileSync(ROOT + "data/prf/g/" + k + ".json", "utf8"));
  const d = shardCache[k], o = M.openGrid(d.g[String(g)], d.y0, d.y1, null), index = {};
  for (const y of Object.keys(o.index)) if (+y >= meta.years.first && +y <= meta.years.last_complete) index[y] = o.index[y];
  return { rates: o.rates, index };
}
function examplePolicy(c, g) {
  const L = c.lim, on = M.LABELS.map((_, i) => (i === 3 || i === 5) && !!L[i]);
  if (!on[3] || !on[5]) return null;
  const split = M.evenSplit(on, L.map((p) => (p ? p[0] : null)), L.map((p) => (p ? p[1] : null)));
  const r = gridRec(g);
  const pol = M.policy({ cbv: c.b[0], coverage: 90, productivity: 100, acres: 100, share: 100, split, rates: r.rates[90], subsidy: meta.subsidy["90"] });
  if (!pol.priced) return null;
  const sum = M.summarize(M.history(pol, r.index), pol);
  return { g, premium: pol.total.premium, usda: pol.total.subsidy, you: pol.total.producer, paid: sum.paidYears, years: sum.years, avg: sum.avgIndemnity };
}
const usd = (x) => "$" + Math.round(x).toLocaleString("en-US");

test("the example's arithmetic is the calculator's: grid 30454, Barron County, matches the main page's example", () => {
  const f = JSON.parse(readFileSync(ROOT + "data/prf/facts.json", "utf8")).example.grazing;
  const wi = JSON.parse(readFileSync(ROOT + "data/prf/s/WI.json", "utf8"));
  const x = examplePolicy(wi.counties["005"], 30454);
  assert.equal(x.premium, f.premium); assert.equal(x.usda, f.usda); assert.equal(x.you, f.you);
  assert.equal(x.paid, f.paid_years); assert.equal(x.years, f.years); assert.equal(Math.round(x.avg), f.avg);
});

test("each county page prints the 100-acre example on its middle grid by premium, labeled, or says why there is none", () => {
  const sample = pages.filter((_, i) => i % 61 === 0);
  const byState = {};
  let priced = 0, none = 0;
  for (const p of sample) {
    const h = readFileSync(ROOT + p.rel, "utf8");
    const main = h.slice(h.indexOf("<main"), h.indexOf("</main>"));
    const m = main.match(/<p class="prf-note prf-ex"[^>]*>(.*?)<\/p>/s);
    assert.ok(m, p.rel + " has no example line");
    const sd = byState[p.st.st] || (byState[p.st.st] = JSON.parse(readFileSync(ROOT + "data/prf/s/" + p.st.st + ".json", "utf8")));
    const code = Object.keys(sd.counties).find((k) => main.includes(`/prf?c=${sd.fips}${k}"`));
    const c = sd.counties[code];
    const rows = c.g.slice().sort((a, b) => a - b).map((g) => examplePolicy(c, g)).filter((x) => x && x.years === meta.years.last_complete - meta.years.first + 1);
    if (!rows.length) { none++; assert.match(m[1], /no example is priced here/, p.rel); continue; }
    priced++;
    rows.sort((a, b) => a.you - b.you || a.g - b.g);
    const x = rows[Math.ceil(rows.length / 2) - 1];
    const t = m[1];
    /* Sig, Oct 20: it leads the page with what you pay, dated by the USDA files read, and stays labeled */
    assert.ok(t.startsWith(`<b>What it costs here at ${meta.crop_year} rates (USDA files read `), p.rel + " example does not lead with the cost: " + t.slice(0, 80));
    assert.ok(t.endsWith("Example, not a recommendation."), p.rel + " example is not labeled");
    assert.ok(t.includes(`you pay ${usd(x.you)} a year, $${(x.you / 100).toFixed(2)} an acre, for 100 acres of grazing at 90% coverage`), `${p.rel}: ${t}`);
    assert.ok(t.includes(`on grid ${x.g}`), `${p.rel}: expected grid ${x.g}: ${t}`);
    assert.ok(t.includes(`USDA pays ${usd(x.usda)} of the ${usd(x.premium)} full premium`), `${p.rel}: ${t}`);
    assert.ok(main.indexOf('class="prf-note prf-ex"') < main.indexOf('class="btn btn-primary prf-cta"'), p.rel + ": the example is the first answer, above the button");
    assert.ok(t.includes(`paid in ${x.paid} of ${x.years} years, an average of ${usd(x.avg)} a year, or $${(Math.round(x.avg) / 100).toFixed(2)} an acre`) ||
              t.includes(`paid in ${x.paid} of ${x.years} years, an average of ${usd(x.avg)} a year, or $${(x.avg / 100).toFixed(2)} an acre`), `${p.rel}: ${t}`);
    assert.ok(/not a forecast/.test(t), p.rel);
    /* the average is set against the full premium, not only the farmer's share */
    const A = Math.round(x.avg), P = Math.round(x.premium), Y = Math.round(x.you);
    const want = A < P
      ? (A > Y ? `That average is under the full premium of ${usd(P)}; it comes out above your share only because USDA pays the rest.`
               : `That average is under the full premium of ${usd(P)}, and under your share too, even with USDA paying the rest.`)
      : `That average is at or above the full premium of ${usd(P)}, so it covered the whole premium;`;
    assert.ok(t.includes(want), `${p.rel}: expected "${want}": ${t}`);
  }
  assert.ok(priced >= 40, "too few priced examples in the sample: " + priced);
});

/* "What changed in PRF for 2027" on every state page: the section, its RMA
 * sources, the FAQ entry on the page and in the JSON-LD word for word, the
 * state's own count of counties with the January to February cap, and a
 * dateModified that moved with the wording (PAGE_REVISED in the builder). */
const revisedIn = (file) => readFileSync(ROOT + file, "utf8").match(/^PAGE_REVISED = "(\d{4}-\d{2}-\d{2})"/m)[1];
test("every state page says what changed for the crop year, with RMA's sources, in the FAQ and the JSON-LD", () => {
  const rev = revisedIn("scripts/build_prf_states.py"), built = meta.built.slice(0, 10);
  const strip = (x) => x.replace(/<[^>]+>/g, "").replace(/&rsquo;/g, "’").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  for (const st of meta.states) {
    const h = readFileSync(ROOT + "prf/" + slug(st.name) + ".html", "utf8");
    const main = h.slice(h.indexOf("<main"), h.indexOf("</main>"));
    assert.ok(main.includes(`<h2 id="changes">What changed in PRF for ${meta.crop_year}</h2>`), st.name);
    for (const u of ["usda-risk-management-agency-upgrades-rainfall-data-source", "pm-26-053-rainfall-index-crop", "pasture-rangeland-forage-stocking-rate"])
      assert.ok(main.includes(u), st.name + " lacks the RMA source " + u);
    const sd = JSON.parse(readFileSync(ROOT + "data/prf/s/" + st.st + ".json", "utf8"));
    const n = Object.values(sd.counties).length, n25 = Object.values(sd.counties).filter((c) => c.lim && c.lim[0] && c.lim[0][1] === 25).length;
    const want = n25 === n ? (n > 1 ? `all ${n} ${st.name} counties` : `the one ${st.name} county`) : `${n25} of the ${n} ${st.name} counties`;
    assert.ok(main.includes(`set that cap in ${want}.`), `${st.name}: expected "${want}"`);
    const blocks = [...h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
    const q = `What changed in PRF for ${meta.crop_year}?`;
    const ld = blocks[1].mainEntity.find((x) => x.name === q);
    assert.ok(ld, st.name + " JSON-LD lacks the question");
    const vis = main.match(new RegExp(`<details><summary>${q.replace("?", "\\?")}</summary><p>(.*?)</p></details>`, "s"));
    assert.ok(vis, st.name + " page lacks the question");
    assert.equal(strip(vis[1]), ld.acceptedAnswer.text, st.name + " FAQ and JSON-LD differ");
    assert.equal(blocks[0].dateModified, rev > built ? rev : built, st.name + " dateModified");
  }
  const anyCounty = readFileSync(ROOT + pages[0].rel, "utf8");
  const wp = JSON.parse(anyCounty.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.equal(wp.dateModified, rev > built ? rev : built, "county page dateModified");
});

test("prf.html's JSON-LD carries a dateModified that moved with its wording", () => {
  const h = readFileSync(ROOT + "prf.html", "utf8");
  const rev = revisedIn("scripts/stamp_prf.py"), built = meta.built.slice(0, 10);
  const blocks = [...h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const app = blocks.find((b) => b["@type"] === "WebApplication");
  assert.equal(app.dateModified, rev > built ? rev : built);
  assert.ok(rev >= "2026-10-15", "the folded sections and the pick card changed the page on 2026-10-15");
});
