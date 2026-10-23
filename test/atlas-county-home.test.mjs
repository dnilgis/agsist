/* County farm facts (Sig, Oct 23, 2026): the Farmland Atlas county page is the county home,
 * laid out like the vision panel's Barron mock and printed through /farmland-atlas/sheet.
 *
 *   node --test test/atlas-county-home.test.mjs
 *
 * What it holds the shipped pages to:
 *   - the page is named County farm facts, prints through the one shared sheet, and links the
 *     county's rain, PRF and ARC pages and Fast Facts for an exact place;
 *   - one definition per measure: the only rain percent is the gauge's year to date (loaded live),
 *     the only drought week count is "half the county or more in D2 or worse", and the live drought
 *     row never adds Fast Facts' "some of the county, N weeks in a row" streak;
 *   - price lines follow the county's own 2022 Census head counts (1,000 head), on every page;
 *   - nothing that changes daily is baked (no stale price in 3,148 files), and every live row is
 *     drawn with its source and date, or says it is not in right now;
 *   - no buyer, seller, elevator or co-op name and no sponsor inside the facts;
 *   - phones: 12 px gutter, no sideways scroll, taps of 44 px or more. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
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

const INDEX = J("farmland-atlas/data/counties-index.json");   // [fips, "Story County, IA", url]
const page = (fips) => { const r = INDEX.find((x) => x[0] === fips); return r && read(r[2].slice(1) + ".html"); };
const JS = read("components/county-home.js");
const CODE = JS.replace(/\/\*[\s\S]*?\*\//g, "");   // the script without its comments
const B = read("scripts/build_atlas_pages.py");
const HEADS = { milk: "milk_cows", feeders: "beef_cows", cattle: "on_feed", hogs: "hogs" };

test("Barron, Story and Champaign: named County farm facts, print through the sheet, link the county's other pages", () => {
  for (const [fips, slug] of [["55005", "wisconsin/barron-county"], ["19169", "iowa/story-county"], ["17019", "illinois/champaign-county"]]) {
    const h = page(fips);
    assert.ok(h, fips + " page on disk");
    assert.match(h, /<div class="kick">County farm facts<\/div>/, fips);
    assert.match(h, /<title>[^<]*Farm Facts · Cash Rent 20\d\d: \$[\d,]+\/Acre/, fips + ": the name and the rent in the title");
    assert.ok(h.includes(`<a class="pri" href="/farmland-atlas/sheet#${fips}">Print this sheet</a>`), fips + ": prints through the one shared sheet");
    assert.ok(h.includes(`href="/fast-facts?fips=${fips}">My place (Fast Facts)</a>`), fips + ": Fast Facts for an exact place");
    assert.ok(h.includes('<a href="#watch">Email me what changes</a>') && h.includes('<div id="watch"><form class="watch"'), fips + ": the email button opens the watch form");
    assert.ok(h.includes(`data-xl="rain" href="/rain/${slug}"`), fips + ": the county rain page (the marked link cross_links.py stamps)");
    assert.ok(h.includes(`href="/prf/${slug}"`), fips + ": the county PRF page");
    assert.ok(h.includes(`href="/arc-plc/${slug}"`), fips + ": the county ARC/PLC page");
    for (const id of ["c-grain", "c-wx", "c-crops", "c-land", "c-prog", "c-farms"]) assert.ok(h.includes(`id="${id}"`), fips + " card " + id);
    // what the Atlas page carried is still there
    for (const w of ["Key figures", "Open on the map", "Compare", "Download CSV", "Copy link", "Next door", "Cite this page", "Sources, dates and arithmetic", "Rent share calculator"])
      assert.ok(h.includes(w), fips + " keeps " + w);
  }
});

test("one definition per measure: one rain percent, one drought week count", () => {
  for (const r of INDEX.filter((_, i) => i % 9 === 0)) {
    const h = read(r[2].slice(1) + ".html");
    assert.doesNotMatch(h, /last ten years \d+% of it/, r[0] + ": the season rain normal is in inches, not a second rain percent");
    assert.doesNotMatch(h, /weeks in a row/, r[0] + ": no 'some of the county' streak baked");
  }
  assert.doesNotMatch(JS, /P\.factDrought\(/, "the live drought row is the county home's own, without the streak");
  assert.doesNotMatch(CODE, /weeks in a row|streak/, "no second drought week count in the live row");
  assert.match(JS, /Share of the county in D/);
  assert.match(B, /half the county or more in D2/);
});

test("price lines follow what the county raises (2022 Census, 1,000 head), on every page", () => {
  assert.match(B, /^HEAD_MIN = 1000$/m);
  let milk = 0, none = 0;
  for (const r of INDEX) {
    const d = J("data/atlas/counties/" + r[0] + ".json"), L = d.livestock || {};
    const h = read(r[2].slice(1) + ".html");
    const m = h.match(/<div id="ch-live" hidden [^>]*data-lv="([^"]*)"/);
    assert.ok(m, r[0] + ": the live box");
    const lv = m[1] ? m[1].split(",") : [];
    for (const [k, col] of Object.entries(HEADS)) {
      const v = L.status === "ok" && L[col] && typeof L[col].value === "number" ? L[col].value : 0;
      assert.equal(lv.includes(k), v >= 1000, `${r[0]} ${k}: ${v} head`);
      if (lv.includes(k)) assert.ok(h.includes(`data-k="${k}"`), r[0] + " row for " + k);
    }
    if (lv.includes("milk")) milk++;
    if (!lv.length) none++;
  }
  assert.ok(milk > 400 && milk < 800, `milk lines on ${milk} pages`);
  assert.ok(none > 0, "a county with no livestock to speak of gets no livestock line");
});

test("nothing that changes daily is baked; the page and its live script name no buyer and carry no sponsor in the facts", () => {
  const h = page("55005");
  const chg = h.split('<div class="chg">')[1].split('<div id="watch">')[0];
  for (const k of ["corn-bid", "soy-bid", "corn-basis", "soy-basis", "corn-fut", "soy-fut", "milk", "rain", "drought", "hail", "corn-progress", "soy-progress", "arc"])
    assert.ok(chg.includes(`<div class="fact st lv" data-k="${k}"><span class="l">`) && new RegExp(`data-k="${k}"><span class="l">[^<]*</span><span class="r"></span>`).test(chg), "empty live row " + k);
  assert.doesNotMatch(chg, /\$\d+\.\d\d(?:[¼½¾⅛⅜⅝⅞])? (?:a cwt|best)|¢ under (?:Dec|Nov)/, "no baked price");
  assert.doesNotMatch(chg, /sponsor/i, "no sponsor in the facts");
  assert.doesNotMatch(JS, /\.facility|\.operator|elevName|elevTown/, "the live rows never draw a buyer's name");
  assert.match(JS, /P\.factBid\(/);
  assert.match(B, /never a buyer\\'s name/);
});

test("the stands-out tiles are ranks against the county's own record, each with its length and source", () => {
  let n = 0;
  for (const r of INDEX.filter((_, i) => i % 5 === 0)) {
    const h = read(r[2].slice(1) + ".html");
    const so = h.split('<section class="so"')[1];
    if (!so) continue;
    const tiles = so.split("</section>")[0].split('<div class="so-t">').slice(1);
    assert.ok(tiles.length <= 3, r[0] + " at most three");
    for (const t of tiles) {
      n++;
      assert.match(t, /(the (highest|lowest) of \d+ (surveys|published years) since \d{4}|the (highest|lowest) since \d{4} \(\d+ (surveys|published years) on record since \d{4}\)|more than any full year since \d{4}|the most since \d{4} \(\d+ weeks\))/, r[0] + ": " + t);
      assert.match(t, /<p class="src">(USDA NASS|U\.S\. Drought Monitor)[^<]+<\/p>/, r[0] + " source");
    }
  }
  assert.ok(n > 50, `tiles checked: ${n}`);
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

test("on a phone and a desktop: every live row ends with its source and date, or says why not; 12 px gutter, 44 px taps", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 }, timezoneId: "America/Chicago" });
      // only our own files: the live bids network is off, so the committed bids file stands in (the fallback path)
      await ctx.route("**/*", (r) => (new URL(r.request().url()).host === `127.0.0.1:${port}` ? r.continue() : r.abort()));
      const pg = await ctx.newPage();
      await pg.goto(`http://127.0.0.1:${port}/farmland-atlas/wisconsin/barron-county`);
      await pg.waitForFunction(() => [...document.querySelectorAll(".lv .r")].every((r) => r.textContent.trim()), null, { timeout: 60000 });
      const rows = await pg.evaluate(() => [...document.querySelectorAll(".lv")].map((el) => ({
        k: el.dataset.k, text: el.textContent, src: !!el.querySelector(".ls"), off: el.classList.contains("lv-off") })));
      assert.ok(rows.length >= 13, `${rows.length} live rows`);
      for (const r of rows) {
        if (r.off) assert.match(r.text, /Not in right now\. \S/, r.k + " says why");
        else {
          assert.ok(r.src, r.k + " carries its source line");
          assert.match(r.text, /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, 20\d\d/, r.k + " dated");
        }
      }
      for (const k of ["corn-fut", "soy-fut", "milk", "drought", "rain", "corn-progress", "arc"])
        assert.ok(!rows.find((r) => r.k === k).off, k + " reads from the committed files");
      const lay = await pg.evaluate(() => {
        const m = document.querySelector("main.ap").getBoundingClientRect(), h1 = document.querySelector("main.ap h1").getBoundingClientRect();
        const small = [...document.querySelectorAll("main .ch-btns a, main .act a, main .act button, main .watch button")]
          .filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height < 44; }).map((e) => e.textContent.trim());
        return { sw: document.documentElement.scrollWidth, gutter: h1.left - m.left, small };
      });
      assert.equal(lay.sw, width, "no sideways scroll at " + width);
      if (width === 390) assert.equal(lay.gutter, 12, "12 px phone gutter");
      assert.deepEqual(lay.small, [], "taps under 44 px at " + width);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
