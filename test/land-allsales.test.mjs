/* Every recorded land sale, and the one land rule (Sig, Oct 29, 2026; STANDING-DECISIONS Oct 29;
 * the property panel, notes/panels/property-2026-10-29/07-synthesis.md decision 2):
 *   - a /land-sales/ county page lists EVERY recorded market sale of any acreage, newest first, with
 *     date, acres, price, $/acre and type (farmland, with buildings, forest, small parcel); the page
 *     carries the newest 50 and "Show more" loads the rest from data/land-sales/<st>/<fips>.json;
 *   - one buildings test, by property class only (FSLand.hasBuildings, classes 1, 2, 3, 7), on the
 *     land-sales pages, the Atlas, Field Scout, the comp report and the email; never the deed text;
 *   - Wisconsin forest-class sales split from farm sales; every middle counts bare farm land;
 *   - the headline middle is the 24-month, 20+ acre, $500+/acre market rule, labeled as such;
 *   - 5 sales before any middle: the comp report and Field Scout too (both were 3);
 *   - Indiana's middle stays, labeled with the state's "not valid for trending" mark;
 *   - names stay behind the tap, from the robots-blocked folder.
 * The checks here recompute from the committed county transfer files with field-scout-land.js (the
 * browser's copy of the rule), not with the Python builder, so the two have to agree.
 *
 *   node --test test/land-allsales.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const json = (p) => JSON.parse(read(p));
const require = createRequire(import.meta.url);
const F = require(path.join(ROOT, "field-scout-land.js"));
const CR = require(path.join(ROOT, "components/comp-report.js"));
const S = require(path.join(ROOT, "components/atlas-sales.js"));
const STATES = { il: "illinois", wi: "wisconsin", in: "indiana", vt: "vermont", nj: "new-jersey" };
const CODE = { farm: "f", bldg: "b", forest: "w", small: "s" };
const money = (x) => "$" + Math.round(x).toLocaleString("en-US");
const slug = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-county";
const jsr = (x) => Math.floor(x + 0.5);
// build_land_sales.sale_id: the state, county, document and date of the first deed, and the price
const saleId = (st, r) => createHash("sha1").update([st, r.fips, r.doc == null ? "None" : r.doc, String(r.date || "").slice(0, 10), jsr(+r.price || 0)].join("|")).digest("hex").slice(0, 10);
const quant = (v, p) => { const h = (v.length - 1) * p, lo = Math.floor(h), hi = Math.min(lo + 1, v.length - 1); return v[lo] + (h - lo) * (v[hi] - v[lo]); };

// The county's market sales the way the browser reads them, each with the id, the shown day and the kind.
function browserSales(st, fips) {
  const ix = json(`data/land/${st}/index.json`), today = String(ix.fetched_utc).slice(0, 10);
  const f = json(`data/land/${st}/${fips}.json`), rec = (f.cols || []).includes("rec");
  return F.saleRows(F.rowObjs(f), today).filter((r) => F.marketSale(r, today)).map((r) => {
    // the day a page shows: the recorded (filed) day when the file carries one, else the deed date
    const when = (rec && String(r.rec || "").slice(0, 10)) || String(r.date || "").slice(0, 10) || null;
    return { r, id: saleId(st.toUpperCase(), r), when, kind: F.landType(r, st.toUpperCase()) };
  }).filter((x) => x.when && x.when <= today);
}
function listFile(st, fips) {
  const L = json(`data/land-sales/${st}/${fips}.json`);
  return L.s.map((a) => Object.fromEntries(L.cols.map((c, i) => [c, a[i]])));
}

test("every recorded market sale in the county file is in the county's list, once, newest first, with its kind", () => {
  let n = 0;
  for (const st of Object.keys(STATES)) {
    const S2 = json(`data/land-sales/${st}.json`);
    for (const fips of Object.keys(S2.counties)) {
      const want = browserSales(st, fips), got = listFile(st, fips);
      assert.equal(got.length, want.length, `${st} ${fips}: ${got.length} listed of ${want.length} recorded`);
      const byId = new Map(want.map((x) => [x.id, x]));
      assert.equal(new Set(got.map((x) => x.id)).size, got.length, `${st} ${fips}: a sale listed twice`);
      for (const g of got) {
        const w = byId.get(g.id);
        assert.ok(w, `${st} ${fips}: listed sale ${g.id} is not in the county file`);
        assert.equal(g.kind, CODE[w.kind], `${st} ${fips} ${g.id}: kind ${g.kind}, the browser's rule says ${w.kind}`);
        assert.equal(g.when, w.when, `${st} ${fips} ${g.id}: date`);
      }
      for (let i = 1; i < got.length; i++) assert.ok(got[i - 1].when >= got[i].when, `${st} ${fips}: newest first`);
      n += got.length;
    }
  }
  assert.ok(n > 60000, "every sale of the three states: " + n);
});

test("small parcels, unknown acres, buildings and forest are listed; the page holds the newest 50 and says how many more", () => {
  const kinds = new Set(), acresNull = [];
  for (const st of Object.keys(STATES)) for (const fips of Object.keys(json(`data/land-sales/${st}.json`).counties)) {
    for (const g of listFile(st, fips)) { kinds.add(st + g.kind); if (g.acres == null) acresNull.push(g.id); if (g.acres != null && g.acres < 1) kinds.add("tiny"); }
  }
  for (const k of ["wif", "wib", "wiw", "wis", "ilf", "ils", "inf", "inb", "ins", "vtf", "vtb", "vtw", "vts", "njf", "njb", "njs", "tiny"]) assert.ok(kinds.has(k), "listed: " + k);
  assert.ok(!kinds.has("ilb"), "Illinois declarations carry no building class: no Illinois sale is marked with buildings");
  assert.ok(!kinds.has("ilw") && !kinds.has("inw") && !kinds.has("njw"), "the forest split is Wisconsin's and Vermont's (timberland)");
  assert.ok(acresNull.length > 100, "sales with acres not stated are listed too: " + acresNull.length);
  const page = read("land-sales/wisconsin/barron-county.html"), all = listFile("wi", "55005");
  const rows = [...page.matchAll(/<tr data-k="([fbws])"><td>([A-Z][a-z]{2} \d+, \d{4}\*?)<\/td>/g)];
  assert.equal(rows.length, Math.min(50, all.length), "the newest 50 in the page");
  assert.match(page, new RegExp(`Showing the newest 50 of ${all.length} sales\\. <button type="button" class="ls-mo" hidden>Show 50 more</button>`));
  assert.match(page, /<div class="ls-flt" hidden data-ls-list="\/data\/land-sales\/wi\/55005\.json" data-ls-names="\/data\/land\/names\/wi\/55005\.json"/);
  assert.match(page, /<option value="w">Forest<\/option>/);
  assert.match(page, /<th scope="col">Type<\/th>/);
  // a small county shows every sale in the page and no Show more
  const small = Object.entries(json("data/land-sales/wi.json").counties).map(([f, c]) => [f, c, listFile("wi", f).length]).find(([, , n]) => n > 0 && n <= 50);
  const sp = read(`land-sales/wisconsin/${small[1].slug}.html`);
  assert.equal([...sp.matchAll(/<tr data-k=/g)].length, small[2]);
  assert.doesNotMatch(sp, /class="ls-more"/);
  // pages stay well under the generated-page cap with every sale listed
  for (const st of Object.values(STATES)) for (const n of fs.readdirSync(path.join(ROOT, "land-sales", st))) {
    const b = fs.statSync(path.join(ROOT, "land-sales", st, n)).size;
    assert.ok(b < 60 * 1024, `${st}/${n} is ${b} bytes`);
  }
});

test("the headline middle: 24 months, bare farm land of 20+ acres at $500+/acre, 5 or more, labeled; the same as the Atlas range", () => {
  let shown = 0, held = 0;
  for (const st of Object.keys(STATES)) {
    const S2 = json(`data/land-sales/${st}.json`), W = { il: 1, wi: 1 }[st] ? json(`data/land/${st}/summary.json`) : null;
    for (const [fips, c] of Object.entries(S2.counties)) {
      // recompute with the browser's rule
      // build_land_summary.windows: the 24 months ending with the through month
      const thr = S2.through, from = new Date(Date.UTC(+thr.slice(0, 4) - 2, +thr.slice(5, 7), 1)).toISOString().slice(0, 10);
      const v = browserSales(st, fips).map((x) => x.r).filter((r) => { const d = String(r.date || "").slice(0, 10); return d >= from && d <= thr && F.statOK(r) && F.landType(r, st.toUpperCase()) === "farm"; })
        .map((r) => r.ppa).sort((a, b) => a - b);
      const page = read(`land-sales/${STATES[st]}/${c.slug}.html`);
      if (v.length >= 5) {
        const med = jsr(quant(v, 0.5));
        assert.deepEqual(c.usual, { med, n: v.length }, `${st} ${fips}: the middle by the rule`);
        assert.ok(page.includes(`Market middle: ${money(med)} an acre, the middle of ${v.length} bare farmland sales of 20 acres or more at $500 an acre or more, `), `${st} ${fips}: the headline says the rule`);
        if (W) assert.deepEqual([W.counties[fips].r24.med, W.counties[fips].r24.n], [med, v.length], `${st} ${fips}: the Atlas range is the same middle`);
        shown++;
      } else {
        assert.equal(c.usual, null, `${st} ${fips}: withheld under 5`);
        assert.ok(page.includes(`No market middle: ${v.length || "no"} bare farmland sale${v.length === 1 ? "" : "s"} of 20 acres or more`), `${st} ${fips}: withheld, with the count`);
        held++;
      }
    }
  }
  assert.ok(shown > 200 && held > 5, `${shown} middles shown, ${held} withheld`);
  // Indiana: the middle stays, labeled with the state's mark and its count
  const ip = read("land-sales/indiana/adams-county.html");
  assert.match(ip, /Most Indiana sales are marked not valid for trending by the state: \d+ of the \d+ sales behind this middle carry that mark\./);
  assert.doesNotMatch(read("land-sales/wisconsin/barron-county.html"), /not valid for trending/);
});

test("one buildings test: the land-sales list, the Atlas largest sales, Field Scout and the comp report agree on every sale", () => {
  // the Atlas largest-sales rows carry the kind; match them to the list by date, acres and price
  for (const st of ["il", "wi"]) {
    const sum = json(`data/land/${st}/summary.json`);
    let seen = 0;
    for (const [fips, c] of Object.entries(sum.counties)) {
      if (!c.large) continue;
      const all = browserSales(st, fips);
      for (const L of c.large) {
        const hit = all.filter((x) => String(x.r.date).slice(0, 10) === L[0] && jsr(+x.r.price) === L[2] && Math.round(x.r.acres * 100) / 100 === L[1]);
        assert.ok(hit.length >= 1, `${st} ${fips}: an Atlas largest sale found in the county file`);
        assert.ok(hit.some((x) => x.kind === L[5]), `${st} ${fips} ${L[0]}: Atlas says ${L[5]}, Field Scout's rule says ${hit.map((x) => x.kind)}`);
        seen++;
      }
    }
    assert.ok(seen > 100, st + " Atlas rows checked: " + seen);
  }
  // Barron: the comp report's building and forest lines count the same sales the list marks
  const rows = browserSales("wi", "55005").map((x) => x.r), list = listFile("wi", "55005");
  const s = CR.summary(rows);
  assert.equal(s.nImp, list.filter((g) => g.kind === "b").length, "comp report sales with buildings = the list's");
  assert.equal(s.nForest, list.filter((g) => g.kind === "w").length, "comp report forest sales = the list's");
  // the deed text never decides: a class 4 sale whose deed says "with buildings" is farmland everywhere
  const r = { cls: "4", conv: "Warranty Deed; with buildings", acres: 80, ppa: 9000, st: "IN" };
  assert.equal(F.landType(r), "farm");
  assert.equal(F.hasBuildings(r.cls), false);
  for (const src of ["scripts/build_land_sales.py", "scripts/land_alert.py"]) assert.doesNotMatch(read(src), /"with buildings" in str\(r\.get\("conv"\)/, src + " reads buildings from the deed text");
  // and the Python port is the same pattern, character for character
  assert.equal(/^HAS_BLDG_RE = re\.compile\(r"(.*)"\)/m.exec(read("scripts/build_land_summary.py"))[1], /(^|[\s,;/])(1|2|3|7)($|[\s,;/])/.source);
  assert.match(F.hasBuildings.toString(), /\(\^\|\[\\s,;\/\]\)\(1\|2\|3\|7\)\(\$\|\[\\s,;\/\]\)/);
});

test("5 sales before a middle: the comp report and Field Scout withhold at 4, show at 5; bare land only", () => {
  const mk = (ppa, cls = "4", st = "WI") => ({ ppa, acres: 40, cls, st, date: "2025-06-10", price: ppa * 40 });
  const four = [5000, 6000, 7000, 8000].map((p) => mk(p)), five = four.concat([mk(9000)]);
  assert.equal(CR.MIN_N, 5);
  assert.equal(CR.summary(four).withheld, true);
  assert.match(CR.summaryHTML(CR.summary(four), 4), /needs at least 5\. Widen the settings/);
  assert.equal(CR.summary(five).withheld, false);
  assert.equal(CR.summary(five).med, 7000);
  assert.equal(F.MIN_N, 5);
  assert.equal(F.medianPpa(four), null);
  assert.deepEqual(F.medianPpa(five), { ppa: 7000, n: 5 });
  // a sale with buildings or a forest sale does not make up the five
  assert.equal(F.medianPpa(four.concat([mk(20000, "4 7")])), null);
  assert.equal(F.medianPpa(four.concat([mk(2000, "6")])), null);
  assert.deepEqual(F.medianPpa(four.concat([mk(2000, "6")]), { all: true }), { ppa: 6000, n: 5 }, "a reader who picked a class gets that class's middle");
  assert.equal(CR.summary(four.concat([mk(20000, "4 7")])).withheld, true);
  const sf = CR.summary(five.concat([mk(2000, "6"), mk(2100, "5M")]));
  assert.equal(sf.n, 5); assert.equal(sf.nForest, 2);
  assert.match(CR.impHTML(sf), /Forest sales \(forest classes, no farm class on the record\): 2, too few with a \$\/acre for a middle\. Not in the figures above\./);
  assert.equal(F.leftOutText(five.concat([mk(20000, "4 1"), mk(2000, "6")]), false), " 1 sale with buildings and 1 forest sale (by property class) are listed and left out of the middle.");
  assert.match(F.FEW_TEXT, /^Fewer than 5 /);
  // Field Scout's own render and the field report use the rule
  const fs1 = read("field-scout-land.js");
  assert.match(fs1, /all = FSLand\.middleAll\(f\), med = FSLand\.medianPpa\(list, \{ all: all \}\)/);
  assert.match(read("components/field-report.js"), /F\.medianPpa\(list, \{ all: all \}\)/);
});

test("no names in the indexed pages or the list files; names only from the blocked folder", () => {
  const robots = read("robots.txt");
  assert.match(robots, /^Disallow: \/data\/land\/$/m);
  for (const [st, fips, s] of [["wi", "55005", "wisconsin/barron-county"], ["il", "17001", "illinois/adams-county"], ["in", "18001", "indiana/adams-county"], ["vt", "50001", "vermont/addison-county"], ["vt", "50023", "vermont/washington-county"], ["nj", "34033", "new-jersey/salem-county"], ["nj", "34019", "new-jersey/hunterdon-county"]]) {
    const nf = json(`data/land/names/${st}/${fips}.json`), list = listFile(st, fips);
    for (const g of list) assert.ok(g.id in nf.sales, `${st} ${fips}: the tap finds every listed sale (${g.id})`);
    const L = read(`data/land-sales/${st}/${fips}.json`), P = read(`land-sales/${s}.html`);
    assert.deepEqual(Object.keys(JSON.parse(L)).sort(), ["cols", "county", "fips", "kinds", "names", "s", "st", "through"]);
    assert.deepEqual(JSON.parse(L).cols, ["id", "when", "recorded", "acres", "price", "ppa", "place", "kind", "flag"].concat(st === "vt" ? ["cu"] : []), `${st}: the list columns`);
    for (const v of Object.values(nf.sales)) for (const n of (Array.isArray(v) ? v : [])) {
      if (!n || n.length < 8 || /^(?:COUNTY OF [A-Z .']+|[A-Z .']+ COUNTY)(?:,? (?:ILLINOIS|WISCONSIN|INDIANA|VERMONT|NEW JERSEY))?$/i.test(n)) continue;
      assert.ok(!L.includes(n) && !P.includes(n), `${st} ${fips}: a name in the list file or the page`);
    }
  }
  const js = read("components/land-sales.js");
  assert.match(js, /\^\\\/data\\\/land-sales\\\/\[a-z\]\{2\}\\\/\\d\{5\}\\\.json\$/, "Show more reads only a county list file");
  assert.doesNotMatch(js, /grantor|grantee/);
});

test("the email lists sales of any acreage and keeps the 20+ acre bare-land middle", () => {
  const la = read("scripts/land_alert.py");
  assert.match(la, /listed = \[\(r, d\) for r, d in rows_in if \(BLS\.num\(r\.get\("acres"\)\) or 0\) > 0\]/);
  assert.match(la, /big = lambda rs: \[r for r in rs if BLS\.farm_comp\(r\)\]/);
  assert.doesNotMatch(read("scripts/send_land_alert.py"), /under %d acres/);
});

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("in Chromium at 390 and 1280: Show more adds 50 rows, the type filter shows only that type, no sideways scroll", { skip }, async () => {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    if (!path.extname(p)) p += ".html";
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  const shots = process.env.LS_SHOTS || null;
  const all = listFile("wi", "55005");
  try {
    for (const w of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: 900 } });
      const pg = await ctx.newPage();
      const errors = [];
      pg.on("pageerror", (e) => errors.push(String(e)));
      await pg.route("**/*", (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
      await pg.goto(base + "/land-sales/wisconsin/barron-county");
      await pg.waitForSelector(".ls-flt:not([hidden])", { timeout: 20000 });
      assert.equal(await pg.locator("#ls-all tbody tr").count(), 50);
      await pg.click("button.ls-mo");
      await pg.waitForFunction(() => document.querySelectorAll("#ls-all tbody tr").length === 100, null, { timeout: 20000 });
      assert.match(await pg.textContent(".ls-more"), new RegExp(`Showing the newest 100 of ${all.length} sales`));
      await pg.selectOption("select.ls-fk", "w");
      await pg.waitForFunction(() => [...document.querySelectorAll("#ls-all tbody tr")].every((t) => t.getAttribute("data-k") === "w"), null, { timeout: 20000 });
      const nf = all.filter((g) => g.kind === "w").length;
      assert.equal(await pg.locator("#ls-all tbody tr").count(), Math.min(50, nf));
      assert.match(await pg.textContent("#ls-all tbody tr td:nth-child(6)"), /^forest$/);
      // a screenshot (LS_SHOTS) is taken before any names tap, so it never holds a name
      if (shots) await pg.screenshot({ path: path.join(shots, `barron-${w}.png`), fullPage: false });
      // the names tap still works on a row drawn from the list file
      await pg.click("#ls-all tbody tr button.ls-nm");
      await pg.waitForSelector("#ls-all tbody tr .ls-nv", { timeout: 20000 });
      const [sw, iw] = await pg.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      assert.ok(sw <= iw, `Barron at ${w}: ${sw}px in ${iw}px`);
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
});
