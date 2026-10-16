/* Feeder cattle sale barn prices: /cattle-auction-prices, components/cattle-auction.js,
 * scripts/fetch_cattle_auction.py.
 *
 * The shipped files run here. Hand-worked answers are written out so a reader
 * can redo them. Browser checks need Playwright and Chromium and are skipped
 * without them.
 *
 *   node --test test/cattle-auction.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { extname, join, normalize } from "node:path";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = {};
const js = readFileSync(ROOT + "components/cattle-auction.js", "utf8");
vm.runInNewContext(js, ctx);
const A = ctx.AgSaleBarn;
const page = readFileSync(ROOT + "cattle-auction-prices.html", "utf8");
const py = readFileSync(ROOT + "scripts/fetch_cattle_auction.py", "utf8");
const srcs = JSON.parse(readFileSync(ROOT + "scripts/cattle_auction_sources.json", "utf8"));
const fixture = JSON.parse(readFileSync(ROOT + "test/fixtures/cattle-auction/feed.json", "utf8"));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");

/* ---------------- page ---------------- */

test("page: title, canonical, h1, byline, one script of its own", () => {
  assert.match(page, /<title>Feeder cattle sale barn prices near you[^<]*\| AGSIST<\/title>/);
  assert.match(page, /<link rel="canonical"\s+href="https:\/\/agsist\.com\/cattle-auction-prices">/);
  assert.equal((page.match(/<h1>/g) || []).length, 1);
  assert.match(page, /Sigurd Lindquist, CCA/);
  assert.match(page, /<script src="\/components\/cattle-auction\.js\?v=\d+" defer><\/script>/);
  assert.ok(page.length < 150 * 1024, "page under the 150 KB cap");
});

test("no em dashes and no AI-sounding filler in the page, the script, the parser or the barn list", () => {
  for (const [name, t] of [["page", page], ["js", js], ["py", py], ["sources", JSON.stringify(srcs)]]) {
    assert.ok(!t.includes("—"), name + " has an em dash");
    assert.ok(!/&mdash;/.test(t), name + " has &mdash;");
    assert.ok(!/\b(delve|seamless|leverage|unlock|empower|robust)\b/i.test(t), name + " has filler");
  }
});

test("honest empty state: shown by default, controls hidden until a checked file exists, nothing guessed", () => {
  assert.match(page, /<div id="sb-empty" class="sb-empty">\s*<h2>Prices load after the first USDA read<\/h2>/);
  assert.match(page, /<div id="sb-controls" hidden>/);
  assert.match(page, /No numbers are filled in or guessed/);
  // no price-looking number anywhere in the visible page text except the FAQ's worked example
  const nums = strip(page).match(/\$?\d{2,4}\.\d{2}\b/g) || [];
  assert.deepEqual(nums, ["$350.00"], "only the FAQ worked example");
  assert.ok(!existsSync(ROOT + "data/cattle-auction.json") || JSON.parse(readFileSync(ROOT + "data/cattle-auction.json", "utf8")).barns,
    "a shipped data file has the barns shape");
});

test("attribution: every card says USDA AMS reported it, not the barn, and links the report", () => {
  assert.match(js, /Reported by USDA AMS, not the barn\. <a href="' \+ esc\(b\.source_url\)/);
  assert.match(page, /Prices reported by USDA AMS market reporters at the sale, not by the barns\./);
});

test("caveats are on the page: weekly lag, averages hide the quality mix, pooling and notes explained", () => {
  const t = strip(page);
  assert.match(t, /Weekly lag\./);
  assert.match(t, /Averages hide the mix\./);
  assert.match(t, /weighted by total weight/);
  assert.match(t, /value added, fleshy, thin, unweaned/);
  assert.match(t, /within 3 weeks and both sales had at least 5 head/);
  assert.equal(A.PRIOR_DAYS, 21);
  assert.equal(A.MIN_HEAD, 5);
});

test("JSON-LD parses; its FAQ is the visible FAQ word for word", () => {
  const blocks = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.equal(blocks.length, 1);
  const faq = blocks[0]["@graph"].find((x) => x["@type"] === "FAQPage");
  const shown = [...page.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)]
    .map((m) => [m[1], m[2]].map((s) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, "&")));
  assert.equal(faq.mainEntity.length, shown.length);
  faq.mainEntity.forEach((q, i) => {
    assert.equal(q.name, shown[i][0]);
    assert.equal(q.acceptedAnswer.text, shown[i][1]);
  });
});

test("the barn list on the page is the list the fetch reads", () => {
  for (const b of srcs.barns) {
    const n = b.name.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");
    assert.ok(page.includes(n + ", " + b.town), b.id + " missing from the page list");
  }
});

test("FAQ worked example: 550 lb at $350.00/cwt is $1,925", () => {
  assert.match(page, /A 550 lb steer at \$350\.00 per cwt brings 350 x 5\.5 = \$1,925/);
  assert.equal(350 * 550 / 100, 1925);
});

/* ---------------- math ---------------- */

test("distance: Kansas City to St. Louis is about 238 miles; Carthage to Dodge City about 316", () => {
  near(A.miles({ lat: 39.0997, lon: -94.5786 }, { lat: 38.627, lon: -90.1994 }), 238, 3, "KC-STL");
  near(A.miles({ lat: 37.18, lon: -94.31 }, { lat: 37.75, lon: -100.02 }), 316, 3, "Carthage-Dodge");
});

test("nearest: sorted by miles, only barns with a sale, the 3 closest when none is within range", () => {
  const b = (id, lat, lon, sales = [{ date: "2026-10-12", classes: {} }]) => ({ id, lat, lon, sales });
  const barns = [b("far", 45, -100), b("close", 37.2, -94.3), b("empty", 37.18, -94.31, []), b("mid", 38, -97)];
  const n = A.nearest(barns, { lat: 37.18, lon: -94.31 }, 6, 400);
  assert.deepEqual(n.list.map((x) => x.barn.id), ["close", "mid"]);
  assert.equal(n.far, false);
  const f = A.nearest(barns, { lat: 30, lon: -80 }, 6, 100);
  assert.equal(f.far, true);
  assert.deepEqual(f.list.map((x) => x.barn.id), ["close", "mid", "far"]);
});

test("change vs prior sale, worked by hand from the fixture", () => {
  // Joplin, steers M&L 1, 400 class. Oct 12: 8 hd x 430 lb at 409.25 and 13 x 491 at 395.31
  // -> (34.40 x 409.25 + 63.83 x 395.31) / 98.23 = 39310.84 / 98.23 = 400.19.
  // Oct 5: the 430 lb row at 404.00 -> (13897.60 + 25232.64) / 98.23 = 398.35. Change +1.84.
  const j = fixture.barns.find((x) => x.id === "joplin-mo");
  const rows = A.classRows(j, "steers|1");
  const r4 = rows.find((r) => r.cls === 400);
  assert.equal(r4.cwt, 400.19);
  assert.equal(j.sales[1].classes["steers|1"]["400"].cwt, 398.35);
  assert.equal(r4.chg, 1.84);
  // 700 class: 305.80 against 308.10 is -2.30
  assert.equal(rows.find((r) => r.cls === 700).chg, -2.3);
  assert.equal(A.signed(-2.3), "-2.30");
  assert.equal(A.signed(0), "unch");
  // $/head = dollars / head: 39310.84 / 21 = 1871.94, and it equals cwt x avg wt / 100 within rounding
  assert.equal(r4.per_head, 1871.94);
  near(r4.cwt * (98.23 / 21), r4.per_head, 0.5, "per head");
});

test("no change shown when the prior sale is old, missing, or thin", () => {
  const cls = (head, cwt) => ({ "steers|1": { "500": { head, avg_wt: 550, cwt, per_head: cwt * 5.5, lo: cwt, hi: cwt } } });
  const barn = (d1, c1) => ({ sales: [{ date: "2026-10-12", classes: cls(20, 350) }, { date: d1, classes: c1 }] });
  assert.equal(A.classRows(barn("2026-09-14", cls(20, 340)), "steers|1")[0].chg, null, "28 days back");
  assert.equal(A.classRows(barn("2026-09-14", cls(20, 340)), "steers|1")[0].chgWhy, "no sale in the 3 weeks before");
  assert.equal(A.classRows(barn("2026-09-21", cls(20, 340)), "steers|1")[0].chg, 10, "21 days back counts");
  assert.equal(A.classRows(barn("2026-10-05", cls(4, 340)), "steers|1")[0].chgWhy, "too few head");
  assert.equal(A.classRows(barn("2026-10-05", {}), "steers|1")[0].chgWhy, "class not sold last time");
  assert.equal(A.classRows({ sales: [{ date: "2026-10-12", classes: cls(20, 350) }] }, "steers|1")[0].chgWhy, "first sale on file");
});

test("money and dates format plainly", () => {
  assert.equal(A.money(1871.94, 0), "$1,872");
  assert.equal(A.money(-12.5), "-$12.50");
  assert.equal(A.niceDate("2026-10-12"), "Oct 12, 2026");
  assert.equal(A.daysBetween("2026-10-05", "2026-10-12"), 7);
});

/* ---------------- fetch script ---------------- */

test("the parser's own selftest passes (hand-worked pooling, refusals, keep-last-good)", () => {
  const out = execFileSync("python3", [ROOT + "scripts/fetch_cattle_auction.py", "--selftest"], { encoding: "utf8" });
  assert.match(out, /all cattle auction checks pass/);
  assert.ok(!/FAIL/.test(out));
});

test("the parser says plainly it has not been checked against a real report yet", () => {
  assert.match(py, /LAYOUT: NOT YET CHECKED AGAINST A REAL REPORT/);
  assert.match(srcs.note, /NOT confirmed/);
  assert.match(readFileSync(ROOT + ".github/workflows/cattle-auction.yml", "utf8"), /inputs\.probe/);
});

test("the barn list: unique ids, town and lower-48 coordinates, a title pattern for every source", () => {
  const ids = srcs.barns.map((b) => b.id).concat(srcs.state_reports.map((b) => b.id));
  assert.equal(new Set(ids).size, ids.length);
  // 47 barns on Oct 16 2026 after the barn fill; the cap keeps the list a hand-checked set, not a dump
  assert.ok(srcs.barns.length >= 20 && srcs.barns.length <= 60);
  for (const b of srcs.barns) {
    assert.ok(b.town && /^[A-Z]{2}$/.test(b.state), b.id);
    assert.ok(b.lat > 24 && b.lat < 50 && b.lon > -125 && b.lon < -66, b.id + " coordinates");
    assert.ok(b.match && new RegExp(b.match, "i"), b.id + " match");
  }
});

test("the page's barn list names every barn the fetcher reads, and no other", () => {
  const ul = page.match(/<ul class="sb-barns">([\s\S]*?)<\/ul>/)[1];
  const listed = [...ul.matchAll(/<li><b>([A-Z]{2})<\/b> ([^<]*)<\/li>/g)]
    .flatMap((m) => m[2].split("; ").map((x) => m[1] + " " + x.replace(/&#x27;/g, "'").replace(/&amp;/g, "&")));
  const want = srcs.barns.map((b) => `${b.state} ${b.name}, ${b.town}`);
  assert.deepEqual([...listed].sort(), [...want].sort());
});

test("barns with a second sale day: also is a list of other report numbers, never the slug again", () => {
  for (const b of srcs.barns.concat(srcs.state_reports)) {
    if (b.slug != null) assert.match(b.slug, /^\d{3,5}$/, b.id);
    if (!("also" in b)) continue;
    assert.ok(Array.isArray(b.also) && b.also.length > 0, b.id);
    for (const s of b.also) {
      assert.match(s, /^\d{3,5}$/, b.id);
      assert.notEqual(s, b.slug, b.id);
    }
  }
  // no report number is claimed by two barns (a wrong number would show one barn twice)
  const all = srcs.barns.concat(srcs.state_reports).flatMap((b) => [b.slug].concat(b.also || [])).filter(Boolean);
  assert.equal(new Set(all).size, all.length);
});

test("a shipped data file, if any, holds only checked numbers", () => {
  const f = ROOT + "data/cattle-auction.json";
  if (!existsSync(f)) return;
  const d = JSON.parse(readFileSync(f, "utf8"));
  for (const b of (d.barns || []).concat(d.states || [])) {
    for (const s of b.sales || []) {
      assert.match(s.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(b.source_url && b.source_url.startsWith("https://mymarketnews.ams.usda.gov/"), b.id + " source");
      for (const cl of Object.values(s.classes || {})) for (const r of Object.values(cl)) {
        assert.ok(r.head > 0 && r.cwt >= 80 && r.cwt <= 1000 && r.lo <= r.cwt && r.cwt <= r.hi, b.id + " row");
        near(r.cwt * r.avg_wt / 100, r.per_head, Math.max(2, r.per_head * 0.002), b.id + " per head");
      }
    }
  }
});

/* ---------------- browser ---------------- */
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2" };
function serve(withData) {
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/data/cattle-auction.json") {
      if (!withData) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(fixture));
      return;
    }
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, srv) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    if (r.request().url().startsWith("https://dnilgis.github.io/bids/data/zips/"))
      return r.fulfill({ body: JSON.stringify({ "64836": [37.17, -94.31, "Carthage"] }), contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" } });
    return r.abort();
  });
  await p.goto(`http://127.0.0.1:${srv.address().port}/cattle-auction-prices`, { waitUntil: "load" });
  return { p, errs, ctx };
}

test("browser: no data file, the empty box stays and no controls or prices appear", { skip }, async () => {
  const srv = await serve(false), browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { p, errs } = await open(browser, srv);
    await p.waitForTimeout(600);
    assert.equal(await p.isVisible("#sb-empty"), true);
    assert.equal(await p.isVisible("#sb-controls"), false);
    assert.equal(await p.$$eval(".sb-card", (x) => x.length), 0);
    assert.deepEqual(errs, []);
  } finally { await browser.close(); srv.close(); }
});

test("browser: a ZIP shows the nearest barns with sale date, classes, change and USDA credit, no sideways scroll", { skip }, async () => {
  const srv = await serve(true), browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { p, errs } = await open(browser, srv);
    await p.waitForSelector("#sb-controls:not([hidden])");
    assert.equal(await p.isVisible("#sb-empty"), false);
    await p.fill("#sb-zip", "64836");
    await p.click("#sb-go");
    await p.waitForSelector(".sb-card");
    const cards = await p.$$eval(".sb-card h3", (x) => x.map((e) => e.textContent));
    assert.deepEqual(cards, ["Joplin Regional Stockyards", "Winter Livestock"]);
    const first = await p.textContent(".sb-card");
    assert.match(first, /Sale of Oct 12, 2026/);
    assert.match(first, /400-499.*21.*400\.19.*394\.00-418\.00.*\$1,872.*468 lb.*\+1\.84/s);
    assert.match(first, /Reported by USDA AMS, not the barn\./);
    const second = await p.$$eval(".sb-card", (x) => x[1].textContent);
    assert.match(second, /First sale on file; the change shows after the next USDA report\./);
    assert.doesNotMatch(second, /No change shown/);
    assert.match(second, /days old/);
    await p.click('[data-sex="heifers"]');
    assert.match(await p.textContent(".sb-card"), /400-499.*14.*391\.75/s);
    await p.click('[data-grade="1-2"]');
    assert.match(await p.textContent(".sb-card"), /No heifers graded Medium and Large 1-2/);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errs, []);
  } finally { await browser.close(); srv.close(); }
});
