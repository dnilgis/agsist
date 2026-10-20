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

/* ---------------- value of gain (real SD weekly rows, USDA AMS report 2027, sale of Oct 18, 2026) ---------------- */
const vfx = JSON.parse(readFileSync(ROOT + "test/fixtures/cattle-auction/vog-sd-2026-10-18.json", "utf8"));
const sdSale = vfx.states[0].sales[0];

test("value of gain, SD weekly Oct 18 steers M&L 1: (3,050.37 - 2,515.91) / (844 - 552) = $1.83 a lb", () => {
  const v = A.valueOfGain(sdSale, "steers|1", "2026-10-20");
  assert.equal(v.ok, true);
  assert.deepEqual([v.light.cls, v.light.avg_wt, v.light.per_head, v.light.head], [500, 552, 2515.91, 8914]);
  assert.deepEqual([v.heavy.cls, v.heavy.avg_wt, v.heavy.per_head, v.heavy.head], [800, 844, 3050.37, 667]);
  assert.equal(v.lb, 292);
  assert.equal(v.added, 534.46);           // 3050.37 - 2515.91
  assert.equal(v.vog, 1.83);               // 534.46 / 292 = 1.8303
  assert.equal(v.date, "2026-10-18");
});

test("value of gain, SD weekly Oct 18 heifers M&L 1: (2,730.68 - 2,323.96) / (853 - 541) = $1.30 a lb; steers and heifers never mixed", () => {
  const v = A.valueOfGain(sdSale, "heifers|1", "2026-10-20");
  assert.deepEqual([v.light.avg_wt, v.heavy.avg_wt, v.lb, v.added, v.vog], [541, 853, 312, 406.72, 1.3]);
  // heifers 1-2 has only 7 head at 800 and no 700 class: withheld, not borrowed from steers or 1s
  const w = A.valueOfGain(sdSale, "heifers|1-2", "2026-10-20");
  assert.equal(w.ok, false);
  assert.match(w.why, /no 700 or 800 lb class with 10 head or more/);
  // a report with steers light and only heifers heavy: withheld
  const mixed = { date: "2026-10-18", classes: { "steers|1": { "500": sdSale.classes["steers|1"]["500"] }, "heifers|1": { "800": sdSale.classes["heifers|1"]["800"] } } };
  assert.equal(A.valueOfGain(mixed, "steers|1", "2026-10-20").ok, false);
});

test("value of gain withheld when the sale is stale, a class is thin or the classes are too close", () => {
  const old = A.valueOfGain(sdSale, "steers|1", "2026-11-02");
  assert.equal(old.ok, false); assert.equal(old.stale, true);
  assert.equal(old.why, "this sale is 15 days old");
  assert.equal(A.valueOfGain(sdSale, "steers|1", "2026-11-01").ok, true, "14 days old still shows");
  const c = JSON.parse(JSON.stringify(sdSale.classes["steers|1"]));
  c["800"].head = 9; c["700"].head = 9;
  assert.match(A.valueOfGain({ date: "2026-10-18", classes: { "steers|1": c } }, "steers|1", "2026-10-20").why, /no 700 or 800/);
  // 800 thin, 700 fine: falls back to 700 (717 lb, $2,759.02): (2759.02 - 2515.91) / 165 = 1.473
  const c7 = JSON.parse(JSON.stringify(sdSale.classes["steers|1"])); c7["800"].head = 9;
  const v7 = A.valueOfGain({ date: "2026-10-18", classes: { "steers|1": c7 } }, "steers|1", "2026-10-20");
  assert.deepEqual([v7.heavy.cls, v7.lb, v7.vog], [700, 165, 1.47]);
  // 500 missing: 400 (464 lb) is the light class
  const c4 = JSON.parse(JSON.stringify(sdSale.classes["steers|1"])); delete c4["500"];
  const v4 = A.valueOfGain({ date: "2026-10-18", classes: { "steers|1": c4 } }, "steers|1", "2026-10-20");
  assert.deepEqual([v4.light.cls, v4.light.avg_wt, v4.heavy.avg_wt], [400, 464, 844]);
  // only 600 light (630 lb) and 700 heavy (717 lb): 87 lb apart, under 150, withheld
  const cg = { "600": sdSale.classes["steers|1"]["600"], "700": sdSale.classes["steers|1"]["700"] };
  assert.equal(A.valueOfGain({ date: "2026-10-18", classes: { "steers|1": cg } }, "steers|1", "2026-10-20").ok, false);
  assert.equal(A.VOG_MIN_HEAD, 10); assert.equal(A.VOG_MIN_GAP, 150); assert.equal(A.STALE_DAYS, 14);
});

test("value of gain: without $/head on the row, cwt x weight / 100", () => {
  const c = JSON.parse(JSON.stringify(sdSale.classes["steers|1"]));
  delete c["500"].per_head; delete c["800"].per_head;
  const v = A.valueOfGain({ date: "2026-10-18", classes: { "steers|1": c } }, "steers|1", "2026-10-20");
  // 455.55 x 5.52 = 2514.64; 361.58 x 8.44 = 3051.74; 537.10 / 292 = 1.839
  assert.deepEqual([v.light.per_head, v.heavy.per_head, v.vog], [2514.64, 3051.74, 1.84]);
});

test("background or sell: gain pays only when value of gain is above cost of gain; no cost, no verdict", () => {
  const v = A.valueOfGain(sdSale, "steers|1", "2026-10-20");
  assert.deepEqual({ ...A.gainVerdict(v, 1.10) }, { pays: true, even: false, per_lb: 0.73, per_head: 213.16 }); // 0.73 x 292
  assert.deepEqual({ ...A.gainVerdict(v, 2.00) }, { pays: false, even: false, per_lb: -0.17, per_head: -49.64 });
  assert.equal(A.gainVerdict(v, 1.83).even, true);
  assert.equal(A.gainVerdict(v, 1.83).pays, false);
  for (const bad of [null, NaN, 0, -1, 110]) assert.equal(A.gainVerdict(v, bad), null, String(bad));
  assert.equal(A.gainVerdict({ ok: false }, 1.1), null);
});

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
  // 47 barns on Oct 16 2026 after the barn fill, 88 on Oct 17 (Sig: more barns, Upper Midwest first);
  // the cap keeps the list a hand-picked set of feeder sales, not every report AMS has
  assert.ok(srcs.barns.length >= 20 && srcs.barns.length <= 120);
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

test("the page's list of barns USDA does not report is the own_reports list; unconfirmed sites get no link", () => {
  const sec = page.split("<h2>Barns USDA does not report</h2>")[1].split("</ul>")[0];
  const items = [...sec.matchAll(/<li><b>([A-Z]{2})<\/b> ([\s\S]*?) <span class="sb-day">\(([^)]*)\)<\/span><\/li>/g)].map((m) =>
    m[1] + " " + m[2].replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&"));
  assert.deepEqual(items.sort(), srcs.own_reports.map((b) => `${b.state} ${b.name}, ${b.town}`).sort());
  for (const b of srcs.own_reports) {
    const linked = sec.includes('href="' + b.site.replace(/&/g, "&amp;") + '"');
    if (b.check) assert.ok(!sec.includes(b.site), b.id + " unconfirmed site linked");
    else assert.ok(linked, b.id + " site not linked");
  }
  // Premier (Withee), Equity and Central Livestock are what Sig asked for by name
  for (const id of ["withee-wi", "lomira-wi", "stratford-wi", "reedsville-wi", "bonduel-wi", "johnson-creek-wi", "richland-center-wi", "rock-creek-mn", "zumbrota-mn"])
    assert.ok(srcs.own_reports.some((b) => b.id === id), id);
  // a barn-posted price ships only with a real saved report as its fixture, and the page names every such barn
  const intro = strip(page).split("Barns USDA does not report")[1].split("Sale days are as")[0];
  assert.match(intro, /own prices show here only once AGSIST has read its report and checked the reading by hand/);
  for (const b of srcs.own_reports.filter((x) => x.parser_checked)) {
    const f = ROOT + "test/fixtures/cattle-auction/own-" + b.id + ".html";
    assert.ok(existsSync(f), b.id + " checked without a saved report");
    assert.match(readFileSync(f, "utf8").slice(0, 300), /Saved copy of .* fetched 20\d\d-\d\d-\d\d/, b.id);
    assert.ok(intro.includes(b.town), b.id + " live but not named on the page");
  }
  for (const b of srcs.own_reports.filter((x) => !x.parser_checked)) {
    assert.ok(b.why, b.id + " not read and no reason given");
    assert.ok(!intro.includes(" " + b.town + ","), b.id + " named as live but not checked");
  }
});

test("barns USDA does not report: nearest first within range; ranges per sex, lightest first", () => {
  const own = [{ id: "w", lat: 44.95, lon: -90.6 }, { id: "s", lat: 44.8, lon: -90.08 }, { id: "z", lat: 44.29, lon: -92.67 }, { id: "far", lat: 30, lon: -97 }];
  // from Withee (44.95, -90.60): Stratford about 28 mi, Zumbrota about 115 mi
  const n = A.nearOwn(own, { lat: 44.95, lon: -90.6 }, 6, 400);
  assert.equal(n.map((x) => x.barn.id).join(), "w,s,z");
  near(n[1].mi, 28, 3, "Withee-Stratford");
  near(n[2].mi, 115, 6, "Withee-Zumbrota");
  assert.equal(A.nearOwn(own, { lat: 44.95, lon: -90.6 }, 2, 400).map((x) => x.barn.id).join(), "w,s");
  const st = fixture.own.find((b) => b.id === "stratford-wi");
  assert.equal(A.ownRanges(st, "steers").map((r) => r.lo).join(), "400,600");
  assert.equal(A.ownRanges(st, "heifers").map((r) => r.lo + "-" + r.hi).join(), "400-600,600-800");
  assert.equal(A.ownRanges(fixture.own.find((b) => b.id === "zumbrota-mn"), "steers").length, 0);
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
function serve(withData, fx = fixture) {
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/data/cattle-auction.json") {
      if (!withData) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(fx));
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
async function open(browser, srv, opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: opt.width || 390, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  if (opt.now) await p.clock.setFixedTime(new Date(opt.now));
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    if (r.request().url().startsWith("https://dnilgis.github.io/bids/data/zips/"))
      return r.fulfill({ body: JSON.stringify({ "64836": [37.17, -94.31, "Carthage"], "54498": [44.95, -90.6, "Withee"] }), contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" } });
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

test("browser: a Wisconsin ZIP lists the barns USDA does not report, nearest first, barn ranges only from a checked read", { skip }, async () => {
  const srv = await serve(true), browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { p, errs } = await open(browser, srv);
    await p.waitForSelector("#sb-controls:not([hidden])");
    await p.fill("#sb-zip", "54498");
    await p.click("#sb-go");
    await p.waitForSelector(".sb-own");
    assert.match(await p.textContent(".sb-ownh"), /Near you, not in a USDA report/);
    const own = await p.$$eval(".sb-own", (x) => x.map((e) => e.textContent));
    assert.equal(own.length, 3);
    assert.match(own[0], /Premier Livestock & Auctions.*Withee, WI.*0 mi.*Sale day: Feeder cattle the 1st, 2nd and 3rd Tuesday/s);
    // Withee and Stratford: what parse_own reads from the real saved pages (Oct 17 2026)
    assert.match(own[0], /Barn report of Oct 13, 2026.*1,080 head.*One report for the Oct 6 and Oct 13 sales \(835 and 245 head\)\./s);
    assert.match(own[0], /200-400.*375\.00-600\.00.*400-600.*310\.00-470\.00.*600-900.*235\.00-389\.00/s);
    assert.match(own[0], /Posted by the barn, not USDA/);
    assert.match(own[1], /Equity Livestock.*Stratford.*Barn report of Oct 16, 2026.*400-600.*300\.00-415\.00.*600-800.*250\.00-345\.00/s);
    assert.doesNotMatch(own[1], /\d head/);
    assert.match(own[2], /Zumbrota.*has not read and checked its own report yet, so no price is shown/s);
    assert.doesNotMatch(own[2], /\d{3}\.\d{2}/);
    assert.equal(await p.$$eval(".sb-own", (x) => x[2].querySelector("a").href), "https://www.centrallivestock.com/zumbrota-market-report.html");
    assert.equal(await p.$$eval(".sb-own", (x) => x[0].querySelector("a").href), "https://premierlivestockandauctions.com/market-reports/");
    await p.selectOption("#sb-state", "MN");
    assert.match(await p.textContent("#sb-results"), /Minnesota barns USDA does not report.*Central Livestock Association/s);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errs, []);
  } finally { await browser.close(); srv.close(); }
});

test("browser: value of gain on each card and the background or sell calculator, from the real SD weekly rows", { skip }, async () => {
  const srv = await serve(true, vfx), browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { p, errs } = await open(browser, srv, { now: "2026-10-20T15:00:00Z" });
    await p.waitForSelector("#vog:not([hidden])");
    // before a ZIP or state: the state summary, no cost typed, no verdict
    assert.match(await p.textContent("#vog-barn"), /SD auctions, weekly, Oct 18/);
    let out = await p.textContent("#vog-out");
    assert.match(out, /552 lb steers brought \$2,516 a head and 844 lb steers \$3,050: \$534 more for 292 more lb, a value of gain of \$1\.83 a lb\. Type your cost of gain to compare\./);
    assert.doesNotMatch(out, /pays/);
    await p.fill("#vog-cog", "1.10");
    out = await p.textContent("#vog-out");
    assert.match(out, /^Gain pays at these prices\..*Your gain costs \$1\.10 a lb, so you keep about \$0\.73 a lb, or \$213 a head over the 292 lb\./s);
    await p.fill("#vog-cog", "2");
    out = await p.textContent("#vog-out");
    assert.match(out, /^Gain does not pay at these prices\..*\$0\.17 a lb more than the sale paid, or about \$50 a head short over the 292 lb\. Selling at 552 lb brings more\./s);
    await p.fill("#vog-cog", "110");
    assert.match(await p.textContent("#vog-out"), /not cents/);
    // pick the state: two cards, each with its own value of gain from its own report
    await p.selectOption("#sb-state", "SD");
    await p.waitForSelector(".sb-vog");
    const cards = await p.$$eval(".sb-card", (x) => x.map((e) => e.textContent));
    assert.match(cards[0], /Value of gain \$1\.83 a lb from 552 to 844 lb steers: \$3,050 a head minus \$2,516, over 292 lb\./);
    assert.match(cards[1], /Fort Pierre.*Value of gain \$1\.89 a lb from 552 to 813 lb steers/s);
    assert.deepEqual(await p.$$eval("#vog-barn option", (x) => x.map((o) => o.textContent)), ["SD auctions, weekly, Oct 18", "Fort Pierre Livestock Auction, Oct 16"]);
    await p.selectOption("#vog-barn", "fort-pierre-sd");
    await p.fill("#vog-cog", "1.10");
    assert.match(await p.textContent("#vog-out"), /At Fort Pierre Livestock Auction \(sale of Oct 16, 2026\)/);
    await p.click('[data-sex="heifers"]');
    assert.match(await p.textContent(".sb-card"), /Value of gain \$1\.30 a lb from 541 to 853 lb heifers/);
    await p.click('[data-grade="1-2"]');
    assert.match(await p.textContent(".sb-card"), /Value of gain not shown: no 700 or 800 lb class with 10 head or more on this report\./);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    // the cost typed is kept for the next visit
    assert.match(await p.evaluate(() => localStorage.getItem("agsist-salebarn")), /"cog":"1.10"/);
    assert.deepEqual(errs, []);
  } finally { await browser.close(); srv.close(); }
});

test("browser: a stale report shows no value of gain and says why", { skip }, async () => {
  const srv = await serve(true, vfx), browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { p, errs } = await open(browser, srv, { now: "2026-11-10T15:00:00Z" });
    await p.waitForSelector("#sb-controls:not([hidden])");
    await p.selectOption("#sb-state", "SD");
    await p.waitForSelector(".sb-card");
    const t = await p.textContent(".sb-card");
    assert.match(t, /Value of gain not shown: this sale is 23 days old\./);
    assert.doesNotMatch(t, /Value of gain \$/);
    assert.match(await p.textContent("#vog-out"), /no value of gain is shown/);
    assert.equal(await p.$eval("#vog-barn", (s) => s.disabled), true);
    assert.deepEqual(errs, []);
  } finally { await browser.close(); srv.close(); }
});
