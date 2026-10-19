/* Farmland Atlas headline tiles, Sig's Oct 19, 2026 decisions:
 *   1. IL and WI county pages (and the printable sheet) show a recorded-sales tile in the top
 *      tiles: the median $/acre the "Recorded farm sales" block leads with (market sales of 20+
 *      acres with known acres, last 12 months), its count and the through date. Under 5 sales:
 *      n/a with the count and the reason. No names. Indiana has no published summary yet
 *      (build_land_summary.py SOURCES), so no tile there.
 *   2. Any rent tile, dry or irrigated, more than three survey years old shows n/a with its last
 *      year. Before: 134 county pages led with a dry rent from 2009 to 2022 (Iroquois IL: $205,
 *      2022; Gallatin KY: 2017, also drawn into "Dry rent per bushel of corn").
 *
 * Real cases, worked by hand from test/fixtures/atlas-tile/summaries.json (fetched Oct 18, 2026,
 * sales through Sep 30, 2026, last 12 months Oct 2025 to Sep 2026):
 *   Dane WI 55025: med 14,399 on 42 sales -> "$14,399" "/ac", "42 recorded market sales, ..."
 *   Alexander IL 17003: no med, k12 4 -> n/a, "not shown: 4 recorded market sales of 20+ acres ..."
 *   Florence WI 55037: no med, k12 0 -> n/a, "not shown: 0 recorded market sales ..."
 *   Saline KS 20169: no deeds file -> no tile.
 *
 *   node --test test/atlas-sales-tile.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, mkdtempSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { join, extname, normalize } from "node:path";
import os from "node:os";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const require = createRequire(import.meta.url);
const S = require(join(ROOT, "components/atlas-sales.js"));
const FX = JSON.parse(read("test/fixtures/atlas-tile/summaries.json")).states;
const unesc = (s) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const KEY = (label) => new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '</div><div class="v">(.*?)</div><div class="s">([^<]*)');
const SALES = /<div class="k" style="grid-column:1\/-1" data-as-tile="([\d-]+)"><div class="t">([^<]*)<\/div><div class="v">(.*?)<\/div><div class="s">([^<]*)<\/div>/;

test("AtlasSales.tile on the real Dane, Alexander and Florence entries", () => {
  const dane = S.tile(FX.WI, "55025");
  assert.deepEqual(dane, { label: "Median sale price, 20+ acres", val: "$14,399", unit: "/ac", through: "2026-09-30",
    sub: "42 recorded market sales, Oct 2025 to Sep 2026; sales dated through Sep 30, 2026" });
  // the same median and count the county block leads with
  assert.match(S.countyHTML(FX.WI, "55025", null), /\$14,399\/ac<small>42 sales with known acres/);
  const alex = S.tile(FX.IL, "17003");
  assert.equal(alex.val, null);
  assert.equal(alex.sub, "not shown: 4 recorded market sales of 20+ acres in Oct 2025 to Sep 2026, a median needs 5; sales dated through Sep 30, 2026");
  assert.equal(S.tile(FX.WI, "55037").sub.slice(0, 41), "not shown: 0 recorded market sales of 20+");
  assert.equal(S.tile(null, "20169"), null);
  assert.match(S.tile(FX.WI, "55999").sub, /^no Wisconsin DOR Real Estate Transfer Returns \(RETR\) file on hand/);
  assert.match(S.tileHTML(alex), /<div class="v"><small>n\/a<\/small><\/div>/);
});

test("the builder: real counties get the tiles Sig asked for, and KS gets no sales tile", () => {
  const out = mkdtempSync(join(os.tmpdir(), "atlas-tile-"));
  execFileSync("python3", ["scripts/build_atlas_pages.py", "--only", "55025", "55073", "17003", "17075", "20169", "21077", "--out", out],
    { cwd: ROOT, env: { ...process.env, PYTHONHASHSEED: "0" }, stdio: "pipe" });
  const pg = (p) => readFileSync(join(out, "farmland-atlas", p + ".html"), "utf8");
  const sum = { WI: JSON.parse(read("data/land/wi/summary.json")), IL: JSON.parse(read("data/land/il/summary.json")) };
  for (const [p, st, f] of [["wisconsin/dane-county", "WI", "55025"], ["wisconsin/marathon-county", "WI", "55073"], ["illinois/alexander-county", "IL", "17003"], ["illinois/iroquois-county", "IL", "17075"]]) {
    const h = pg(p), m = SALES.exec(h), t = S.tile(sum[st], f);
    assert.ok(m, p + " has the sales tile");
    assert.ok(h.indexOf(m[0]) < h.indexOf("</section>", h.indexOf('class="keys"')), p + ": the tile is in the top tiles");
    // the baked tile says exactly what AtlasSales.tile says from the same file
    assert.deepEqual([m[1], unesc(m[2]), unesc(m[3].replace(/<small>(.*?)<\/small>/, "|$1")), unesc(m[4])],
      [t.through, t.label, t.val == null ? "|n/a" : t.val + "|" + t.unit, t.sub], p);
  }
  assert.match(SALES.exec(pg("wisconsin/dane-county"))[3], /^\$14,399<small>\/ac<\/small>$/);
  assert.equal(SALES.exec(pg("illinois/alexander-county"))[3], "<small>n/a</small>");
  assert.doesNotMatch(pg("kansas/saline-county"), /data-as-tile|Median sale price/);
  // the dry rent rule: Iroquois 2022 and Gallatin 2017 are n/a with their year; Marathon's 2026 prints
  const dry = KEY("Cash rent, non-irrigated");
  assert.deepEqual(dry.exec(pg("illinois/iroquois-county")).slice(1), ["<small>n/a</small>", "last published 2022, more than three survey years old"]);
  assert.deepEqual(dry.exec(pg("kentucky/gallatin-county")).slice(1), ["<small>n/a</small>", "last published 2017, more than three survey years old"]);
  assert.match(dry.exec(pg("wisconsin/marathon-county"))[2], /^2026 county average/);
  // no rent per bushel from the 2017 rent
  assert.doesNotMatch(pg("kentucky/gallatin-county"), /Dry rent per bushel of corn<\/div>/);
  // Marathon's 2011 irrigated rent stays n/a (fx/phone)
  assert.equal(KEY("Cash rent, irrigated").exec(pg("wisconsin/marathon-county"))[1], "<small>n/a</small>");
});

test("the published pages: every IL and WI county carries the tile, it matches the summary, and no headline rent is stale", () => {
  const dir = join(ROOT, "farmland-atlas"), tiles = { dry: [], irr: [] };
  const sum = { illinois: JSON.parse(read("data/land/il/summary.json")), wisconsin: JSON.parse(read("data/land/wi/summary.json")) };
  let n = 0;
  for (const st of readdirSync(dir, { withFileTypes: true })) {
    if (!st.isDirectory()) continue;
    for (const f of readdirSync(join(dir, st.name))) {
      if (!f.endsWith(".html") || f === "index.html") continue;
      const h = readFileSync(join(dir, st.name, f), "utf8");
      const fips = (/data-fips="(\d{5})"/.exec(h) || /FIPS (\d{5})/.exec(h) || [])[1];
      for (const [k, re] of [["dry", KEY("Cash rent, non-irrigated")], ["irr", KEY("Cash rent, irrigated")]]) {
        const m = re.exec(h);
        if (m) tiles[k].push([st.name + "/" + f, m[2]]);
      }
      const m = SALES.exec(h);
      if (sum[st.name]) {
        assert.ok(m, `${st.name}/${f}: no sales tile`);
        const t = S.tile(sum[st.name], fips);
        assert.equal(unesc(m[4]), t.sub, `${st.name}/${f}`);
        n++;
      } else assert.equal(m, null, `${st.name}/${f}: a sales tile outside IL and WI`);
      assert.doesNotMatch(m ? m[0] : "", /grantor|grantee|buyer|seller|parcel|document/i);
    }
  }
  assert.ok(n >= 170, "IL and WI county pages: " + n);
  const yr = (s) => +(/^(\d{4}) county average/.exec(s) || [0, 0])[1];
  const latest = Math.max(...tiles.dry.map((t) => yr(t[1])));
  assert.ok(latest >= 2026 && tiles.dry.length > 2500, "dry tiles: " + tiles.dry.length);
  for (const k of ["dry", "irr"]) {
    const old = tiles[k].filter((t) => yr(t[1]) && yr(t[1]) < latest - 3);
    assert.deepEqual(old.slice(0, 5), [], `${old.length} stale ${k} rent tiles`);
  }
  assert.ok(tiles.dry.filter((t) => /^last published 20\d\d, more than three survey years old$/.test(t[1])).length >= 130);
});

test("the sheet and the map panel carry the same rules", () => {
  const sh = read("farmland-atlas/sheet.html");
  assert.match(sh, /window\.AtlasSales\.tile\(SALES,F\)/);
  assert.match(sh, /rvOld\?key\('Cash rent, non-irrigated', null/);
  assert.match(sh, /riOld\?key\('Cash rent, irrigated', null/);
  assert.match(sh, /rpb!=null&&!rvOld/);
  const hub = read("farmland-atlas.html");
  assert.match(hub, /old_\(R\.irr\)\?tile\('fa-t-rent','Cash rent, irrigated', null/);
  assert.match(hub, /old_\(rv\)\?tile\('fa-t-rent','Cash rent, non-irrigated', null/);
  assert.match(read(".github/workflows/farmland-atlas-pages.yml"), /workflows: \["farmland-atlas", "Land data \(parcel services \+ transfers\)"\]/);
  assert.match(read(".github/workflows/land-data.yml"), /^name: Land data \(parcel services \+ transfers\)$/m);
});

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("in Chromium: Dane's tile and sheet, a newer summary redraws the tile, Gallatin's sheet rent is n/a", { skip }, async () => {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  let newer = false;
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    let body = readFileSync(f);
    if (newer && p === "/data/land/wi/summary.json") {
      // a month of new deeds came in after the page was built
      const d = JSON.parse(body);
      d.through = "2026-10-31"; d.counties["55025"].med = { med: 15001, n: 43, q1: 10872, q3: 22471 };
      body = JSON.stringify(d);
    }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(body);
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = srv.address().port, base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const w of [390, 1280]) {
      for (const nw of [false, true]) {
        newer = nw;
        const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: 900 } });
        const pg = await ctx.newPage();
        const errors = [];
        pg.on("pageerror", (e) => errors.push(String(e)));
        await pg.route("**/*", (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
        await pg.goto(base + "/farmland-atlas/wisconsin/dane-county");
        assert.match(await pg.textContent("[data-as-tile]"), /\$14,399\/ac42 recorded market sales/);
        await pg.locator("section.as").scrollIntoViewIfNeeded();
        await pg.waitForSelector("section.as[data-ready]", { timeout: 30000 });
        const tile = await pg.textContent("[data-as-tile]"), block = await pg.textContent("section.as");
        if (nw) {
          assert.match(tile, /\$15,001\/ac43 recorded market sales.*through Oct 31, 2026/);
          assert.match(block, /\$15,001\/ac/);
        } else assert.match(tile, /\$14,399\/ac42 recorded market sales.*through Sep 30, 2026/);
        const [sw, iw] = await pg.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
        assert.ok(sw <= iw, `Dane at ${w}: ${sw}px in ${iw}px`);
        assert.deepEqual(errors, []);
        await ctx.close();
      }
    }
    newer = false;
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
    const pg = await ctx.newPage();
    await pg.route("**/*", (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
    await pg.goto(base + "/farmland-atlas/sheet#55025");
    await pg.waitForSelector("section.keys.k7", { timeout: 30000 });
    const keys = await pg.textContent("section.keys");
    assert.match(keys, /Median sale price, 20\+ acres\$14,399\/ac42 recorded market sales, Oct 2025 to Sep 2026; sales dated through Sep 30, 2026/);
    await pg.goto(base + "/farmland-atlas/sheet#21077");
    await pg.waitForFunction(() => /Gallatin/.test(document.title), null, { timeout: 30000 });
    await pg.waitForSelector("section.keys", { timeout: 30000 });
    const g = await pg.textContent("section.keys");
    assert.match(g, /Cash rent, non-irrigatedn\/alast published 2017, more than three survey years old/);
    assert.doesNotMatch(g, /Dry rent per bushel|Median sale price/);
    await pg.goto(base + "/farmland-atlas/sheet#55073");
    await pg.waitForFunction(() => /Marathon/.test(document.title), null, { timeout: 30000 });
    await pg.waitForSelector("section.keys.k7", { timeout: 30000 });
    assert.match(await pg.textContent("section.keys"), /Cash rent, irrigatedn\/alast published 2011, more than three survey years old/);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
