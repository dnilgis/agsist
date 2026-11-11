/* The PRF county fold (Nov 2026): the 3,070 county pages (prf/<state>/<county>.html) folded into their
 * state pages (prf/<state>.html, scripts/build_prf_states.py). A county is now a view on its state page,
 * laid out by components/prf-county.js from prf/<state>/<county>.json (scripts/build_prf_counties.py);
 * the old county address is a forward to /prf/<state>?county=<county>#county.
 *
 * WHY. The county pages took few visits for 61 MB and 3,070 addresses. What a county page said must
 * still be one pick away, with the same numbers, and every old link and bookmark must still land on its
 * county. This reads the shipped files, and frozen copies of six county pages as they were before the
 * fold (test/fixtures/prf-county-fold, from the same USDA files), not the builder.
 *
 *   node --test test/prf-county-pages.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const meta = JSON.parse(read("data/prf/meta.json"));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const PC = createRequire(import.meta.url)(ROOT + "components/prf-county.js");
const FIX = ROOT + "test/fixtures/prf-county-fold/";
const SAMPLES = readdirSync(FIX).filter((f) => /^\d{5}\.json$/.test(f)).map((f) => JSON.parse(readFileSync(FIX + f, "utf8")));
/* the county addresses sitemap-prf.xml listed the day before the fold */
const OLD = readFileSync(FIX + "old-county-urls.txt", "utf8").split("\n").filter(Boolean);
const views = [];
for (const st of meta.states) {
  const dir = ROOT + "prf/" + slug(st.name);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) if (f.endsWith(".json")) views.push({ st, rel: "prf/" + slug(st.name) + "/" + f });
}
const text = (h) => h.replace(/<br>/g, "").replace(/<[^>]+>/g, "").replace(/&mdash;/g, "\u2014").replace(/&ndash;/g, "\u2013")
  .replace(/&rsquo;/g, "\u2019").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

test("every county address the sitemap listed before the fold forwards to its state page, opened on the county, and the county is there", () => {
  assert.equal(OLD.length, 3070);
  for (const u of OLD) {
    const [stSlug, c] = u.split("/");
    const rel = "prf/" + u + ".html";
    assert.ok(existsSync(ROOT + rel), rel + " is gone: the old address would 404");
    const h = read(rel);
    assert.ok(existsSync(ROOT + "prf/" + stSlug + ".html"), rel + ": no state page to land on");
    if (h.includes('name="agsist-pointer"')) {   // a county that left USDA's files later: a pointer to a real page
      assert.match(h, /<meta http-equiv="refresh" content="0; url=\/prf(\/[a-z-]+)?">/, rel);
      continue;
    }
    const to = `/prf/${stSlug}?county=${c}#county`;
    assert.ok(statSync(ROOT + rel).size < 1536, rel + " is a small forward");
    assert.ok(h.includes('<meta name="robots" content="noindex, follow">'), rel + ": noindex");
    assert.ok(h.includes(`<link rel="canonical" href="https://agsist.com/prf/${stSlug}">`), rel + ": canonical to the state page");
    assert.ok(h.includes(`<meta http-equiv="refresh" content="0; url=${to}">`), rel + ": instant refresh to the county on the state page");
    assert.ok(h.includes(`<script>location.replace("${to}")</script>`), rel + ": and by script");
    assert.ok(h.includes(`<a href="${to}">`), rel + ": a link for readers without either");
    assert.ok(!/[\u2014\u2013]/.test(h), rel + ": no dash");
    /* the target opens on the county: the state page lists it and its view is there */
    const state = read("prf/" + stSlug + ".html");
    assert.ok(state.includes(`<a href="#county=${c}" data-c="${c}">`), rel + ": the state page's county table names " + c);
    const v = JSON.parse(read("prf/" + u + ".json"));
    assert.equal(v.v, 1, rel);
  }
});

test("no county address in any sitemap; sitemap-prf.xml lists the state pages and the explainer", () => {
  for (const f of readdirSync(ROOT).filter((f) => /^sitemap.*\.xml$/.test(f))) {
    const locs = [...read(f).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    for (const l of locs) assert.ok(!/^https:\/\/agsist\.com\/prf\/[^/]+\/[^/]+$/.test(l), `${f} lists the county address ${l}`);
  }
  const locs = [...read("sitemap-prf.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs.sort(), [...meta.states.map((s) => "https://agsist.com/prf/" + slug(s.name)), "https://agsist.com/prf/how-prf-works"].sort());
  for (const l of locs) assert.ok(!read("sitemap.xml").includes(`<loc>${l}</loc>`), l + " is in two sitemaps");
  assert.ok(read("robots.txt").includes("Sitemap: https://agsist.com/sitemap-prf.xml"), "robots.txt names sitemap-prf.xml");
  for (const st of meta.states) {
    const h = read("prf/" + slug(st.name) + ".html");
    assert.ok(h.includes(`<link rel="canonical" href="https://agsist.com/prf/${slug(st.name)}">`), st.name + ": the state page keeps its canonical");
  }
});

test("each state page: the county view's section, every county row opens it, and the script that fills it", () => {
  for (const st of meta.states) {
    const s = slug(st.name), h = read("prf/" + s + ".html");
    assert.ok(h.includes(`<section class="prf-county" id="county" data-prf-county data-state="${s}" aria-labelledby="county-h">`), st.name);
    assert.equal((h.match(/<th scope="row"><a href="#county=[a-z0-9-]+" data-c="[a-z0-9-]+">/g) || []).length, st.counties, st.name + ": every county row");
    assert.match(h, /<script src="\/components\/prf-county\.js\?v=\d+" defer><\/script>/, st.name);
    assert.ok(statSync(ROOT + "prf/" + s + ".html").size < 150 * 1024, st.name + " is over the 150 KB page cap");
  }
});

test("one county view per county with PRF, small, and it lays out with the grids, county values and tables", () => {
  assert.equal(views.length, meta.counts.counties);
  const sample = views.filter((_, i) => i % 97 === 0);
  for (const p of views) assert.ok(statSync(ROOT + p.rel).size < 12 * 1024, p.rel + " is over 12 KB");
  for (const p of sample) {
    const d = JSON.parse(read(p.rel)), h = PC.render(d);
    assert.equal(d.cy, meta.crop_year, p.rel);
    assert.match(h, /<h3 class="prf-cp-h" tabindex="-1">PRF in [^<]+<\/h3>/, p.rel);
    assert.match(h, /<table class="prf-t prf-co-t">[\s\S]*?<th scope="row">\d{4,5}<\/th>/, p.rel + " lacks its grid numbers in the grids table");
    assert.match(h, /Grazing, county base value per acre<\/dt><dd>\$\d/, p.rel);
    assert.equal((h.match(/<table /g) || []).length, 3, p.rel + " should carry the month, recent-year and grid tables");
    assert.ok(!/\u2014/.test(h.replace(/&mdash;/g, "")), p.rel + ": no em dash typed in");
  }
});

test("the view shows a county's numbers exactly as its page did: six counties, frozen from before the fold", () => {
  assert.ok(SAMPLES.length >= 5);
  for (const fx of SAMPLES) {
    const h = PC.render(fx.view), old = fx.old;
    const ex = h.match(/<p class="prf-note prf-ex"[^>]*>(.*?)<\/p>/s);
    assert.ok(ex, fx.page + ": no example");
    assert.equal(ex[1], old.example, fx.page + ": the example");
    const tables = h.match(/<table [^>]*>.*?<\/table>/gs);
    assert.deepEqual(tables, old.tables, fx.page + ": the month, recent-year and grid tables, cell for cell");
    for (const [dt, dd] of old.figs) {
      if (dt === "Sign-up deadline") continue;   // on the state page, once
      assert.ok(h.includes(`<div><dt>${dt}</dt><dd>${dd}</dd></div>`), `${fx.page}: ${dt} ${dd}`);
    }
    for (const para of old.paras) assert.ok(h.includes(para + "</p>"), `${fx.page}: ${para.slice(0, 80)}`);
  }
});

test("the live views are the frozen ones while USDA's files are the same", () => {
  /* a later data run may move any figure; then there is nothing to hold, and the frozen check above stands */
  for (const fx of SAMPLES) {
    const live = JSON.parse(read(fx.page.replace(/\.html$/, ".json")));
    if (live.read !== fx.view.read || live.open !== fx.view.open) continue;
    const { story, ...a } = live, { story: s2, ...b } = fx.view;
    assert.deepEqual(a, b, fx.page);
  }
});

import vm from "node:vm";
/* The labeled 100-acre example under the stat tiles. Worked out again here
 * from USDA's files with components/prf-math.js, apart from the builder, and
 * tied to the calculator's own example (data/prf/facts.json, grid 30454 in
 * Barron County, the figures RMA's tool was matched against): a page that
 * printed another policy's numbers, or rounded its own way, fails. */
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

test("each county view prints the 100-acre example on its middle grid by premium, labeled, or says why there is none", () => {
  const sample = views.filter((_, i) => i % 61 === 0);
  const byState = {};
  let priced = 0, none = 0;
  for (const p of sample) {
    const main = PC.render(JSON.parse(readFileSync(ROOT + p.rel, "utf8")));
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
    /* Oct 20: it leads the page with what you pay, dated by the USDA files read, and stays labeled */
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
});

test("prf.html's JSON-LD carries a dateModified that moved with its wording", () => {
  const h = readFileSync(ROOT + "prf.html", "utf8");
  const rev = revisedIn("scripts/stamp_prf.py"), built = meta.built.slice(0, 10);
  const blocks = [...h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const app = blocks.find((b) => b["@type"] === "WebApplication");
  assert.equal(app.dateModified, rev > built ? rev : built);
  assert.ok(rev >= "2026-10-15", "the folded sections and the pick card changed the page on 2026-10-15");
});

// ---------------------------------------------------------------- in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const SHOTS = process.env.PRF_FOLD_SHOTS || "";

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png" };
  const srv = createServer((req, res) => {
    let f = path.normalize(path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    /* as Pages does: /prf/iowa is prf/iowa.html even with a prf/iowa/ folder beside it */
    if ((!existsSync(f) || statSync(f).isDirectory()) && existsSync(f + ".html")) f += ".html";
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("in a browser: an old county address lands on the state page with that county's numbers, as its page showed them, at 390 and 1280", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
      const pg = await ctx.newPage();
      const errors = [];
      pg.on("pageerror", (e) => errors.push(e.message));
      await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
      for (const fx of SAMPLES) {
        const [, st, c] = fx.page.match(/^prf\/([a-z-]+)\/([a-z0-9-]+)\.html$/);
        await pg.goto(`http://127.0.0.1:${port}/prf/${st}/${c}`, { waitUntil: "load" });
        await pg.waitForURL(`**/prf/${st}?county=${c}#county`);
        const cp = pg.locator("[data-pc-body] .prf-cp");
        await cp.waitFor();
        assert.equal(await pg.locator("#prf-county-pick").inputValue(), c, fx.page + ": the picker shows the county");
        const live = JSON.parse(read(fx.page.replace(/\.html$/, ".json")));
        if (live.read !== fx.view.read || live.open !== fx.view.open) continue;   // USDA's files moved since the freeze
        assert.equal(await cp.locator(".prf-ex").textContent(), text(fx.old.example), fx.page + ": the example");
        const tables = await cp.locator("table").evaluateAll((ts) => ts.map((t) => t.textContent));
        assert.deepEqual(tables.map((t) => t.replace(/\s+/g, " ").trim()), fx.old.tables.map(text), fx.page + ": the tables");
        const wide = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        assert.equal(wide, false, `${fx.page} at ${width}: no sideways scroll`);
        if (SHOTS && fx.page.endsWith("adair-county.html")) await pg.screenshot({ path: path.join(SHOTS, `fold-${c}-${width}.png`) });
      }
      /* picking another county from the list swaps the view and the address keeps it */
      await pg.goto(`http://127.0.0.1:${port}/prf/iowa`, { waitUntil: "load" });
      await pg.locator("#prf-county-pick").selectOption("story-county");
      await pg.locator("[data-pc-body] .prf-cp-h", { hasText: "Story County, Iowa" }).waitFor();
      assert.ok(pg.url().endsWith("/prf/iowa#county=story-county"), pg.url());
      /* and a county name in the table opens it */
      await pg.locator('a[data-c="polk-county"]').click();
      await pg.locator("[data-pc-body] .prf-cp-h", { hasText: "Polk County, Iowa" }).waitFor();
      assert.deepEqual(errors, [], "no script errors");
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
