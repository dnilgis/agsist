/* Land first on the county home (Sig, Oct 29, 2026: the property view is top priority; panel record
 * notes/panels/property-2026-10-29, steps 1 and 3).
 *
 *   node --test test/atlas-land-first.test.mjs
 *
 * What it holds the shipped pages to:
 *   - every Atlas county home whose county has a /land-sales/<state>/<county> page opens with the land
 *     block, in the panel's order: sales through, Sold for, newest sales (town, not parcel; names behind
 *     a tap), rent, nearest bid, rain, "Every sale here" and "Pick my field", the plain disclaimer;
 *   - one source, read from the two shipped pages: the county home and its land-sales page print the
 *     same middle, the same count and the same middle half, or both withhold it with the same count;
 *   - the land comes before the census value and "Stands out"; no value estimate, no rent-to-price
 *     ratio inside the block; no buyer or seller name in it;
 *   - counties without a land-sales page keep the old order (no block);
 *   - in a browser at 390 wide: the middle sits above the fold on IL, IN and WI county homes; with a
 *     Field Scout field saved at the Chetek 40 the gauge reads 22 miles from that field (11 from the
 *     county middle without it), each row names the point, and the hail map link never carries the
 *     reader's own point. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const J = (p) => JSON.parse(read(p));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const STATES = { il: "illinois", wi: "wisconsin", in: "indiana" };
const INDEX = J("farmland-atlas/data/counties-index.json");   // [fips, "Story County, IA", url]
const atlasOf = (fips) => { const r = INDEX.find((x) => x[0] === fips); return r ? r[2].slice(1) + ".html" : null; };
const unesc = (s) => s.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

function lfOf(h) {
  const m = h.match(/<section class="lf" aria-label="[^"]*">([\s\S]*?)<\/section>/);
  return m ? m[1] : null;
}

test("every county with a land-sales page opens with the land, and both pages print the same middle", () => {
  let shown = 0, held = 0;
  for (const [st, slug] of Object.entries(STATES)) {
    const S = J(`data/land-sales/${st}.json`);
    for (const [fips, c] of Object.entries(S.counties)) {
      const lp = `land-sales/${slug}/${c.slug}.html`, ap = atlasOf(fips);
      if (!existsSync(join(ROOT, lp)) || !ap || !existsSync(join(ROOT, ap))) continue;
      const h = read(ap), lf = lfOf(h), L = unesc(read(lp));
      assert.ok(lf, `${ap}: the land block`);
      // one source: read both shipped pages
      const lm = L.match(/Market middle: (\$[\d,]+) an acre, the middle of (\d+) bare farmland sales of 20 acres or more at \$500 an acre or more, [^(]*\(middle half (\$[\d,]+) to (\$[\d,]+)\)/);
      if (lm) {
        assert.ok(lf.includes(`<div class="lf-v">${lm[1]}<small>/ac</small></div>`), `${ap}: the middle ${lm[1]} as on ${lp}`);
        assert.ok(lf.includes(`Middle of ${lm[2]} bare farmland sales of 20+ acres,`), `${ap}: n ${lm[2]} as on ${lp}`);
        assert.ok(lf.includes(`Middle half ${lm[3]} to ${lm[4]}.`), `${ap}: the middle half as on ${lp}`);
        assert.doesNotMatch(lf, /Too few sales/);
        shown++;
      } else {
        const lw = L.match(/No market middle: (no|\d+) bare farmland sales? of 20 acres or more/);
        assert.ok(lw, `${lp}: either a middle or the withheld words`);
        assert.ok(lf.includes('<div class="lf-v lf-few">Too few sales</div>'), `${ap}: too few sales`);
        assert.ok(lf.includes(`${lw[1] === "no" ? "No" : lw[1]} bare farmland sale${lw[1] === "1" ? "" : "s"} of 20+ acres,`), `${ap}: the same count as ${lp}`);
        assert.doesNotMatch(lf, /lf-v">\$/, `${ap}: no price under 5 sales`);
        held++;
      }
      // the panel's order, then the doors and the disclaimer
      const order = ["lf-thru", "data-lf-mid", "Newest sales", '<span class="l">Rent</span>', 'data-k="lf-bid"', 'data-k="lf-rain"', ">Every sale here</a>", ">Pick my field</a>", "Recorded prices. Not an appraisal. No adjustments."];
      let at = -1;
      for (const w of order) { const i = lf.indexOf(w); assert.ok(i > at, `${ap}: ${w} in order`); at = i; }
      assert.ok(lf.includes(`href="/land-sales/${slug}/${c.slug}">Every sale here</a>`), `${ap}: Every sale here opens ${lp}`);
      assert.ok(lf.includes(`href="/field-scout?fips=${fips}">Pick my field</a>`), `${ap}: Pick my field`);
      assert.match(lf, /town, not parcel/);
      // the newest three, each with the names tap and no name
      const rows = (c.s || []).slice(0, 3);
      assert.equal([...lf.matchAll(/<button type="button" class="ls-nm" data-ls-id="([^"]+)" data-ls-f="\/data\/land\/names\/[a-z]{2}\/\d{5}\.json">Show buyer and seller<\/button>/g)].map((m) => m[1]).join(","),
        rows.map((r) => r[0]).join(","), `${ap}: the three newest sales of the same file`);
      assert.doesNotMatch(lf, /Seller:|Buyer:|grantor|grantee/i, `${ap}: no names`);
      // no value estimate, no census value, no rent-to-price ratio in the block
      assert.doesNotMatch(lf, /\bestimated?\b|\bappraised\b|\bworth\b|land and buildings|\bcensus\b|% of (the )?(price|value)|rent as/i, `${ap}: nothing but recorded prices`);
      // the land comes first: before the page's other sections
      const i = h.indexOf('<section class="lf"');
      for (const w of ['<section class="so"', 'aria-label="Key figures"', '<p class="sub">']) {
        const j = h.indexOf(w);
        if (j >= 0) assert.ok(i < j, `${ap}: the land before ${w}`);
      }
      // names-free sales box: land-sales.js is told not to draw a second one
      assert.match(h, /id="ch-live"[^>]* data-ls-done="1"/, `${ap}: no second latest-sales box`);
    }
  }
  assert.ok(shown > 200 && held > 3, `${shown} middles, ${held} withheld`);
});

test("counties without a land-sales page keep the old order", () => {
  for (const f of ["19169", "27053", "31109"]) {
    const ap = atlasOf(f);
    if (!ap) continue;
    const h = read(ap);
    assert.equal(lfOf(h), null, ap + ": no land block");
    assert.doesNotMatch(h, /data-ls-done/);
  }
  // Indiana keeps the monthly email ask in its Land card
  const ih = read(atlasOf("18001"));
  assert.match(ih, /<div data-land-alert data-source="page:farmland-atlas\/indiana\/adams-county"><\/div>/);
});

test("the county outline is on the page for the reader's own point, and the script reads only this device", () => {
  const h = read(atlasOf("55005"));
  const m = h.match(/id="ch-live"[^>]* data-ring="([^"]+)"/);
  assert.ok(m, "the ring");
  assert.ok(m[1].split(/[ ;]/).length <= 90, "thinned");
  const js = read("components/county-home.js");
  assert.match(js, /agsist-fs-fields/);
  assert.match(js, /agsist-wx-loc/);
  assert.doesNotMatch(js, /hail-map\?lat=' \+ lat\b/, "the hail link never carries the reader's own point");
  assert.match(js, /lat: cLat, lng: cLng/, "This week here stays on the county middle");
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html"; else if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

const CHETEK_40 = JSON.stringify([{ id: 1, name: "Chetek 40", acres: 40,
  pts: [[45.3762, -91.6285], [45.3798, -91.6285], [45.3798, -91.6235], [45.3762, -91.6235]] }]);

test("at 390 wide: the middle above the fold on IL, IN and WI; miles from the reader's field", { skip, timeout: 240000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    async function open(path, ls) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, timezoneId: "America/Chicago" });
      await ctx.route("**/*", (r) => (new URL(r.request().url()).host === `127.0.0.1:${port}` ? r.continue() : r.abort()));
      if (ls) await ctx.addInitScript((o) => { for (const k in o) localStorage.setItem(k, o[k]); }, ls);
      const pg = await ctx.newPage();
      await pg.goto(`http://127.0.0.1:${port}${path}`);
      return { ctx, pg };
    }
    for (const p of ["/farmland-atlas/illinois/champaign-county", "/farmland-atlas/indiana/adams-county", "/farmland-atlas/wisconsin/barron-county"]) {
      const { ctx, pg } = await open(p);
      const r = await pg.evaluate(() => { const e = document.querySelector("[data-lf-mid]"); const b = e.getBoundingClientRect(); return { bottom: b.bottom + scrollY, sw: document.documentElement.scrollWidth }; });
      assert.ok(r.bottom < 844, `${p}: the middle ends at ${Math.round(r.bottom)} px, above the 844 px fold`);
      assert.equal(r.sw, 390, p + ": no sideways scroll");
      await ctx.close();
    }
    const rain = async (ls) => {
      const { ctx, pg } = await open("/farmland-atlas/wisconsin/barron-county", ls);
      await pg.waitForFunction(() => ["lf-rain", "lf-bid", "rain", "hail"].every((k) => { const e = document.querySelector('.lv[data-k="' + k + '"] .r'); return e && e.textContent.trim(); }), null, { timeout: 60000 });
      const o = await pg.evaluate(() => {
        const t = (k) => document.querySelector('.lv[data-k="' + k + '"]').textContent;
        const hl = document.querySelector('.lv[data-k="hail"] a[href^="/hail-map"]');
        return { lf: t("lf-rain"), rain: t("rain"), bid: t("lf-bid"), hail: t("hail"), hailHref: hl ? hl.getAttribute("href") : "" };
      });
      await ctx.close();
      return o;
    };
    const mid = await rain(null);
    assert.match(mid.lf, /Cumberland gauge, 11 miles from the county middle\./, mid.lf);
    assert.match(mid.rain, /11 miles from the county middle\./, mid.rain);
    const own = await rain({ "agsist-fs-fields": CHETEK_40 });
    assert.match(own.lf, /Cumberland gauge, 22 miles from your field “Chetek 40”\./, own.lf);
    assert.match(own.rain, /22 miles from your field “Chetek 40”\./, own.rain);
    assert.match(own.bid, /Not in right now|from your field “Chetek 40”\./, own.bid);
    assert.match(own.hail, /your field “Chetek 40”/, own.hail);
    assert.doesNotMatch(own.hailHref, /45\.37|91\.62/, "the hail map link is the county middle's, not the field's");
    // a saved place outside the county is not used
    const away = await rain({ "agsist-wx-loc": JSON.stringify({ lat: 44.5, lon: -89.6 }) });
    assert.match(away.lf, /from the county middle\./, away.lf);
    const near = await rain({ "agsist-wx-loc": JSON.stringify({ lat: 45.378, lon: -91.626 }) });
    assert.match(near.lf, /22 miles from your saved place\./, near.lf);
  } finally { await browser.close(); srv.close(); }
});
