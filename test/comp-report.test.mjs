/* /comp-report: the free comparable sales report (Oct 18, 2026).
 *
 *   node --test test/comp-report.test.mjs
 *
 * Link settings, the comp filters and their counts, numbering that matches the map, no summary
 * under 3 comps, the CSV, noindex and no names on indexed pages, and (where Playwright and
 * Chromium exist) a real Wisconsin, Illinois and no-data page with a sane printed page count. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { readFileSync, existsSync, readdirSync } from "node:fs";
import path, { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const require = createRequire(import.meta.url);
const F = require(join(ROOT, "field-scout-land.js"));
const CR = require(join(ROOT, "components/comp-report.js"));
const TODAY = "2026-10-18";

// ---------------------------------------------------------------- link settings
test("defaults: 25 miles, last 3 years through today, 10 acres and up, market sales, 15 nearest", () => {
  const P = CR.parseParams("?lat=45.3&lon=-91.7", TODAY);
  assert.equal(P.ok, true);
  assert.equal(P.subject.kind, "point");
  assert.deepEqual([P.r, P.from, P.to, P.amin, P.amax, P.cls, P.all, P.n, P.sort], [25, "2023-10-18", TODAY, 10, null, null, false, 15, "mi"]);
});

test("every setting reads, clamps and swaps", () => {
  const P = CR.parseParams("?lat=40.1&lon=-88.2&at=town&r=500&from=2025-06-01&to=2024-01-31&amin=200&amax=40&cls=4,5m&all=1&n=99&sort=date&pid=17-24-09-376-015&fips=17019", TODAY);
  assert.equal(P.subject.kind, "town");
  assert.equal(P.r, 60);
  assert.deepEqual([P.from, P.to], ["2024-01-31", "2025-06-01"]);
  assert.deepEqual([P.amin, P.amax], [40, 200]);
  assert.deepEqual(P.cls, ["4", "5M"]);
  assert.equal(P.all, true);
  assert.equal(P.n, 40);
  assert.equal(P.sort, "date");
  assert.equal(P.pid, "17-24-09-376-015");
  assert.equal(P.fips, "17019");
  const Q = CR.parseParams("?lat=40.1&lon=-88.2&from=any&amin=any&n=0&r=-3&from=2023-02-30", TODAY);
  assert.equal(Q.r, 25);
  assert.equal(Q.n, 15);
  assert.equal(Q.amin, null);
  assert.equal(CR.parseParams("?lat=1&lon=1&from=2023-02-30", TODAY).from, "2023-10-18", "an impossible date falls back to the default");
  assert.equal(CR.parseParams("?lat=1&lon=1&from=any", TODAY).from, null);
});

test("subjects: a field outline, a parcel by number, nothing usable", () => {
  const f = "45.29750,-91.70250~45.29750,-91.69750~45.30250,-91.69750~45.30250,-91.70250";
  const A = CR.parseParams("?f=" + encodeURIComponent(f), TODAY);
  assert.equal(A.subject.kind, "field");
  assert.equal(A.subject.pts.length, 4);
  assert.ok(Math.abs(A.subject.c.lat - 45.3) < 1e-9);
  const B = CR.parseParams("?pid=036-0400-11-000&fips=55005", TODAY);
  assert.equal(B.subject.kind, "parcel");
  for (const bad of ["", "?r=10", "?lat=0&lon=0", "?lat=99&lon=1", "?pid=<script>&fips=55005", "?pid=1-2&fips=5500", "?f=1,2~3"]) {
    assert.equal(CR.parseParams(bad, TODAY).ok, false, bad);
  }
});

test("the written-out link reproduces the same settings", () => {
  const P = CR.parseParams("?lat=40.12&lon=-88.2&r=15&from=2024-01-01&to=2026-06-30&amin=20&amax=300&cls=4&n=12&sort=date&pid=30-21-13-400-013&fips=17019", TODAY);
  const Q = CR.parseParams("?" + CR.toQuery(P), "2030-01-01");
  for (const k of ["r", "from", "to", "amin", "amax", "cls", "all", "n", "sort", "pid", "fips"]) assert.deepEqual(Q[k], P[k], k);
  assert.deepEqual(Q.subject.c, P.subject.c);
  const D = CR.parseParams("?lat=40&lon=-88", TODAY);
  assert.equal(CR.parseParams("?" + CR.toQuery(D), "2030-01-01").from, "2023-10-18", "the default date is written out, so the link does not drift");
});

test("Field Scout's report link carries its filters into the report", () => {
  const pts = [{ lat: 45.2975, lng: -91.7025 }, { lat: 45.2975, lng: -91.6975 }, { lat: 45.3025, lng: -91.6975 }];
  const f = { maxMi: 12, since: "2024-03-01", minAc: 35, maxAc: 160, cls: ["4", "5"], all: true };
  const u = F.compReportURL({ pts }, f);
  assert.match(u, /^\/comp-report\?/);
  const P = CR.parseParams(u.slice(u.indexOf("?")), TODAY);
  assert.equal(P.subject.kind, "field");
  assert.deepEqual([P.r, P.from, P.amin, P.amax, P.cls, P.all], [12, "2024-03-01", 35, 160, ["4", "5"], true]);
  // a sale's parcel from the sale panel; Field Scout's "any date" and no acre floor stay that way
  const s = F.compReportURL({ pid: "036-0400-11-000", fips: "55005", lat: 45.43, lng: -91.72, town: true }, { maxMi: 25, since: null, minAc: null });
  const S = CR.parseParams(s.slice(s.indexOf("?")), TODAY);
  assert.deepEqual([S.subject.kind, S.pid, S.fips, S.from, S.amin], ["town", "036-0400-11-000", "55005", null, null]);
  assert.match(read("field-scout-land.js"), /id="fl-comprep"/, "button under Sold land nearby");
  assert.match(read("field-scout-land.js"), /id="fl-sd-cr"/, "button in the sale panel");
});

// ---------------------------------------------------------------- filters and counts
const town = { lat: 45.30, lng: -91.70 };
// each made-up sale is its own parcel, so the one-sale-per-parcel rule (deeds of one parcel within 31 days) does not merge them
let seq = 0;
const row = (o) => Object.assign({ doc: "D" + Math.random().toString(36).slice(2, 8), date: "2025-05-01", price: 400000, acres: 80, np: 1, cls: "4", conv: "Warranty Deed", pid: "1-2-" + (++seq), muniName: "Town A", lat: town.lat, lng: town.lng, county: "Barron", st: "WI", exempt: 0, legal: "SW SW SEC 8 T34N R11W" }, o);

test("each filter step drops what it says and the counts add up", () => {
  const rows = [
    row({ doc: "ok1" }),
    row({ doc: "noprice", price: 0 }),
    row({ doc: "quit", conv: "Quit Claim Deed" }),
    row({ doc: "rel", conv: "Warranty Deed, Related Parties" }),
    row({ doc: "exempt", exempt: 1 }),
    row({ doc: "share", legal: "HIS UNDIVIDED ONE-THIRD INTEREST IN THE SW SW" }),
    row({ doc: "old", date: "2019-04-01" }),
    row({ doc: "small", acres: 4 }),
    row({ doc: "unsure", acres: null, acUnsure: true, np: 3 }),
    row({ doc: "forest", cls: "6" }),
    row({ doc: "far", lat: 46.5 }),
    row({ doc: "subject", pid: "036-0400-11-000" }),
    row({ doc: "ok2", date: "2026-01-10", lat: 45.35 }),
  ];
  const P = CR.parseParams("?lat=45.3&lon=-91.7&cls=4", TODAY);
  const sel = CR.selectComps(rows, P, { lat: 45.3, lng: -91.7 }, ["036 0400 11 000"]);
  assert.deepEqual(sel.list.map((r) => r.doc), ["ok1", "ok2"], "nearest first");
  assert.deepEqual(sel.list.map((r) => r.no), [1, 2]);
  const n = sel.funnel.map((x) => x.n);
  // 13 records; one row per sale (none merged); price and acres (-noprice); not dated after today; market (-quit, rel, exempt);
  // whole interests (-share); dates (-old); acres (-small, unsure); class 4 (-forest); a location (none lost); 25 miles (-far); subject (-subject)
  assert.deepEqual(n, [13, 13, 12, 12, 9, 8, 7, 5, 4, 4, 3, 2, 2]);
  assert.ok(sel.funnel.every((x, i) => i === 0 || x.n <= sel.funnel[i - 1].n));
  assert.match(sel.funnel[sel.funnel.length - 1].t, /nearest 2/);
  // every deed type: the screens step away, the rest stays
  const all = CR.selectComps(rows, CR.parseParams("?lat=45.3&lon=-91.7&all=1&amin=any&from=any", TODAY), { lat: 45.3, lng: -91.7 }, []);
  assert.ok(all.list.some((r) => r.doc === "quit") && all.list.some((r) => r.doc === "share") && all.list.some((r) => r.doc === "unsure"));
  assert.match(CR.screenText(rows[5]), /^No: .*share/);
  assert.match(CR.screenText(rows[0]), /^Passes/);
});

test("the one-sale rule, the location line, future dates and the summary of every match", () => {
  const P = CR.parseParams("?lat=45.3&lon=-91.7&from=any&amin=any", TODAY);
  const rows = [
    row({ doc: "a1", pid: "9-9-9", date: "2025-08-26", price: 300000, acres: 80, grantee: "SYNTHETIC ONE" }),
    row({ doc: "a2", pid: "9-9-9", date: "2025-08-28", price: 200000, acres: 80, grantee: "SYNTHETIC ONE" }),
    row({ doc: "noloc", lat: null, lng: null }),
    row({ doc: "future", date: "2027-02-01" }),
    row({ doc: "low", price: 20000, acres: 80 }),
    row({ doc: "b1", price: 480000 }), row({ doc: "b2", price: 560000 }), row({ doc: "b3", price: 640000 }),
    row({ doc: "house", price: 900000, cls: "4 1" }),
  ];
  const sel = CR.selectComps(rows, P, { lat: 45.3, lng: -91.7 }, [], TODAY);
  const t = sel.funnel.map((x) => x.n + " " + x.t).join("\n");
  assert.match(t, /^8 one row per sale.*\(1 sale was filed as several deeds\)$/m);
  assert.match(t, /^6 with a location to measure from: 1 left out, no location in the record/m);
  assert.match(t, /^7 not dated after today/m);
  const g = sel.all.find((r) => r.grp);
  assert.deepEqual([g.grp, g.price, g.ppa], [2, 500000, 6250]);
  // the summary is every match: bare land 6250, 6000, 7000, 8000 (the $250 sale is listed, never figured), the house on its own line
  const s = CR.summary(sel.all);
  assert.deepEqual([s.n, s.med, s.lo, s.hi, s.low, s.nImp], [4, 6625, 6000, 8000, 1, 1]);
  const h = CR.summaryHTML(s, { matched: sel.matched, listed: 3, newest: "2026-09-30" });
  assert.match(h, /Typical bare-land price paid near you: <b>\$6,625\/ac<\/b>, 4 sales, dated May 1, 2025 to Aug 26, 2025, newest sale in our copy Sep 30, 2026\./);
  assert.match(h, /6 sales matched; the 3 nearest are listed below\./);
  assert.match(h, /Sales with buildings[^<]*: 1, too few/);
  assert.match(h, /1 sale is under \$500 an acre/);
  // Illinois: no bare-land claim
  const il = CR.summary(sel.all.map((r) => Object.assign({}, r, { st: "IL", cls: "4" })));
  assert.match(CR.summaryHTML(il, 6), /Typical price paid near you[\s\S]*Illinois records do not say whether buildings were included/);
  assert.doesNotMatch(CR.summaryHTML(il, 6), /bare-land/);
  // shared town centers: whole miles, marked approximate, and said
  const tbl = CR.compsHTML(sel.list, false, TODAY);
  assert.match(tbl, /data-l="Miles">(about \d+|under 1)</);
  assert.match(tbl, /Miles run to the center of the town or township where each sale was filed/);
  assert.match(tbl, /Unverified: taken from public transfer records, not confirmed with a party to the sale\./);
  assert.match(tbl, /filed as 2 deeds from Aug 26, 2025 to Aug 28, 2025, \$500,000 in all/);
  assert.match(tbl, /far below the range, likely not a whole open-market sale/);
  assert.match(tbl, /<th scope="col"/);
});

test("labels per state: Indiana's sales disclosure ID and classes, no Wisconsin class off Wisconsin", () => {
  const r = row({ st: "IN", doc: "C79-2026-1", cls: "4 7", no: 1, mi: 2 });
  const h = CR.compsHTML([r], false, TODAY);
  assert.match(h, /Indiana sales disclosure ID C79-2026-1/);
  assert.match(h, /Farm land, Farm buildings/);
  assert.doesNotMatch(F.saleDetailHTML(r, { state: "IN", cols: ["cls"] }, []), /Wisconsin class/);
  assert.doesNotMatch(F.saleDetailHTML(Object.assign({}, r, { st: "IL", cls: "4" }), { state: "IL", cols: ["cls"] }, []), /Wisconsin class/);
  for (const st of ["IL", "IN"]) assert.doesNotMatch(F.saleDetailHTML(Object.assign({}, r, { st }), { state: st, cols: [] }, []), /any personal property in the price/);
  const js = read("components/comp-report.js");
  assert.match(js, /Personal property was taken out of the price on the form/);
});

test("newest-first listing and the n cap", () => {
  const rows = [1, 2, 3, 4, 5].map((i) => row({ doc: "d" + i, date: "2025-0" + i + "-15", lat: 45.3 + i * 0.01 }));
  const P = CR.parseParams("?lat=45.3&lon=-91.7&sort=date&n=3", TODAY);
  const sel = CR.selectComps(rows, P, { lat: 45.3, lng: -91.7 }, []);
  assert.deepEqual(sel.list.map((r) => r.doc), ["d5", "d4", "d3"]);
  assert.equal(sel.matched, 5);
});

// ---------------------------------------------------------------- summary
test("summary: nothing under 3 comps with known acres; median, low, high by hand", () => {
  assert.equal(CR.summary([]).withheld, true);
  const two = [{ ppa: 5000, acres: 40, date: "2025-01-02" }, { ppa: 6000, acres: 80, date: "2025-02-02" }, { ppa: null, acUnsure: true, date: "2025-02-03" }];
  const s2 = CR.summary(two);
  assert.equal(s2.withheld, true);
  assert.match(CR.summaryHTML(s2, 3), /No summary\..*at least 3/);
  assert.doesNotMatch(CR.summaryHTML(s2, 3), /\$5,000|\$6,000|\$5,500/, "no figure leaks out when withheld");
  // 4 sales: 4000, 5000, 7000, 9000 -> median (5000+7000)/2 = 6000; low 4000; high 9000
  const four = [
    { ppa: 7000, acres: 40, date: "2025-04-10" }, { ppa: 4000, acres: 160, date: "2025-05-10" },
    { ppa: 9000, acres: 35, date: "2025-06-10" }, { ppa: 5000, acres: 80, date: "2026-01-10" }, { ppa: null, acUnsure: true, date: "2026-01-11" },
  ];
  const s = CR.summary(four);
  assert.deepEqual([s.n, s.med, s.lo, s.hi, s.unsure, s.acMed], [4, 6000, 4000, 9000, 1, 60]);
  // quarters: 2025 Q2 holds 3 (4000, 7000, 9000 -> 7000); 2026 Q1 holds 1 (no middle)
  assert.deepEqual(s.q, [{ q: "2025 Q2", n: 3, med: 7000 }, { q: "2026 Q1", n: 1, med: null }]);
  const h = CR.summaryHTML(s, 5);
  assert.match(h, /\$6,000/);
  assert.match(h, /under 3 sales/);
  assert.match(h, /No trend line is fitted/);
  assert.doesNotMatch(h, /per year|trend of|rising|falling|slope of/i, "no fitted trend claims");
});

// ---------------------------------------------------------------- map and table numbers
test("the map numbers are the table numbers, one marker per comp, shared towns ringed", () => {
  const rows = [1, 2, 3, 4, 5, 6].map((i) => row({ doc: "m" + i, date: "2025-0" + i + "-01", lat: i <= 4 ? 45.32 : 45.25, lng: i <= 4 ? -91.68 : -91.75, muniName: i <= 4 ? "Town A" : "Town B" }));
  const P = CR.parseParams("?lat=45.3&lon=-91.7", TODAY);
  const sel = CR.selectComps(rows, P, { lat: 45.3, lng: -91.7 }, []);
  sel.list[5].ploc = { lat: 45.27, lng: -91.71 };   // one comp placed on its parcel
  const svg = CR.mapSVG({ c: { lat: 45.3, lng: -91.7 }, list: sel.list, r: 25, counties: [], towns: [{ name: "Town A", lat: 45.32, lng: -91.68 }] });
  const mapNos = [...svg.matchAll(/<g data-no="(\d+)">/g)].map((m) => +m[1]);
  const tbl = CR.compsHTML(sel.list, true);
  const tblNos = [...tbl.matchAll(/<tbody class="cr-c" data-no="(\d+)">/g)].map((m) => +m[1]);
  assert.deepEqual(mapNos, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(tblNos, mapNos);
  for (const r of sel.list) assert.match(tbl, new RegExp(`data-l="No.">${r.no}</td>`));
  assert.equal((svg.match(/data-subject="1"/g) || []).length, 1, "one subject mark");
  const ring = sel.list.filter((r) => r.muniName === "Town A").map((r) => r._xy);
  assert.equal(new Set(ring.map((p) => p.x.toFixed(1) + "," + p.y.toFixed(1))).size, ring.length, "comps in one town do not sit on top of each other");
  assert.match(svg, /fill="#1f2a14" stroke="#1f2a14" stroke-width="1.6"\/><text[^>]*>6</, "a parcel-placed comp is drawn solid");
  assert.match(svg, />Town A</);
});

test("the comps table carries every field the brief lists", () => {
  const r = row({ doc: "923949", pid: "1-2-3", grantor: "SYNTHETIC SELLER", grantee: "SYNTHETIC BUYER", rec: "2026-09-30", legal: "The SW1/4-SW1/4, Section 8, Township 34 N, Range 11 W", conv: "Land Contract, Sale", cls: "4 1", np: 2, ppa: 6640, price: 464000, acres: 69.88, mi: 3.24, soil: { np: 0.61, cs: null }, no: 1 });
  const h = CR.compsHTML([r], true);
  for (const want of ["Sep 30, 2026", "$464,000", "69.9", "$6,640", "1-2-3", "first of 2", "Section 8, T34N, R11W", "Land Contract, Sale", "Arm’s-length screen: Passes", "SYNTHETIC SELLER", "SYNTHETIC BUYER", "3.2", "Town A", "Agricultural, Residential", "61/100 NCCPI", "doc 923949", "buildings"]) assert.ok(h.includes(want), want);
  assert.match(CR.compsHTML([Object.assign({}, r, { soil: null, soilWhy: "no parcel map here" })], false), /no parcel map here[\s\S]*Seller and buyer not in our copy/);
  assert.match(CR.compsHTML([], true), /No recorded sale matches/);
});

// ---------------------------------------------------------------- CSV
test("CSV: one row per comp, quoted where needed, names cannot run as formulas", () => {
  const r = row({ no: 1, pid: "1-2-3", grantor: '=HYPERLINK("x")', grantee: 'SMITH, JOHN "JACK"', ppa: 5000, mi: 2.04, price: 400000, acres: 80, src: "Wisconsin transfer return" });
  const csv = CR.csv([r, Object.assign({}, r, { no: 2, grantor: "-cmd", grantee: "+1" })], true);
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[0].split(",").length, CR.CSV_COLS.length);
  assert.ok(lines[1].startsWith("1,2025-05-01,,400000,80,5000,1-2-3,1,"));
  assert.ok(lines[1].includes(`"'=HYPERLINK(""x"")"`), "formula prefixed and quotes doubled");
  assert.ok(lines[1].includes(`"SMITH, JOHN ""JACK"""`));
  assert.ok(lines[2].includes(",'-cmd,'+1,"));
  assert.ok(lines[1].includes(",2.0,"), "miles to town center");
  assert.ok(!CR.csv([r], false).includes("HYPERLINK"), "no names when the file carries none");
});

// ---------------------------------------------------------------- real data
test("real county files: a Wisconsin and an Illinois subject find comps and number them", () => {
  for (const [st, fips, c] of [["wi", "55005", { lat: 45.3, lng: -91.7 }], ["il", "17019", { lat: 40.12, lng: -88.2 }]]) {
    const p = `data/land/${st}/${fips}.json`;
    if (!existsSync(join(ROOT, p))) continue;
    const rows = F.rowObjs(JSON.parse(read(p)));
    const P = CR.parseParams(`?lat=${c.lat}&lon=${c.lng}&from=any&r=40`, TODAY);
    const sel = CR.selectComps(rows, P, c, []);
    assert.ok(sel.list.length >= 3, st + " has comps");
    sel.list.forEach((r, i) => { assert.equal(r.no, i + 1); assert.ok(r.mi <= 40); assert.ok(F.marketSale(r)); assert.ok(!CR.partial(r)); });
    assert.equal(CR.summary(sel.list).withheld, false);
  }
});

// ---------------------------------------------------------------- page rules
test("one shared noindex page, not in a sitemap, no per-parcel files, no em dashes", () => {
  const h = read("comp-report.html");
  assert.match(h, /<meta name="robots" content="noindex, follow">/);
  assert.match(h, /<title>Comparable sales report \| AGSIST Field Scout<\/title>/);
  assert.match(h, /Sigurd Lindquist, CCA/);
  assert.match(h, /Recorded sales from public records\. Not an appraisal; no adjustments made\./);
  assert.match(h, /Made with AGSIST \(free\)/);
  assert.match(h, /@page\{size:letter/);
  assert.match(h, /components\/comp-report\.js\?v=2/);
  for (const sm of readdirSync(ROOT).filter((f) => /^sitemap.*\.xml$/.test(f))) assert.doesNotMatch(read(sm), /comp-report/);
  assert.ok(!existsSync(join(ROOT, "comp-report")), "no folder of per-parcel report files");
  for (const f of ["comp-report.html", "components/comp-report.js"]) assert.ok(!read(f).includes("—"), f + " has an em dash");
});

test("names never reach an indexed page: only noindex pages load the report or the land card", () => {
  const pages = readdirSync(ROOT).filter((f) => f.endsWith(".html"));
  for (const f of pages) {
    const s = read(f);
    if (!/comp-report\.js|field-scout-land\.js/.test(s)) continue;
    assert.match(s, /name="robots" content="noindex/, f + " loads sale names but is indexable");
  }
  // the page itself holds no names; they come from /data/land, which robots.txt keeps out
  const h = read("comp-report.html").replace(/<!-- static-nav:(header|footer)[\s\S]*?<!-- \/static-nav:\1 -->/g, "");
  const f = JSON.parse(read("data/land/wi/55005.json"));
  for (const r of f.rows.slice(0, 50)) for (const n of [r[12], r[13]]) if (n && n.length > 6) assert.ok(!h.includes(n), "name in page source: " + n);
  assert.match(read("robots.txt"), /Disallow: \/data\/land\//);
});

// ---------------------------------------------------------------- in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function openPage(browser, port, url, width = 1280) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 }, acceptDownloads: true });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e)));
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
  return { pg, ctx, errs };
}

test("a real Wisconsin and Illinois report: table and map agree, CSV downloads, prints to a sane page count", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const url of ["/comp-report.html?f=" + encodeURIComponent("45.29750,-91.70250~45.29750,-91.69750~45.30250,-91.69750~45.30250,-91.70250"), "/comp-report.html?lat=40.12&lon=-88.2"]) {
      const { pg, ctx, errs } = await openPage(browser, port, url);
      await pg.waitForSelector("tbody.cr-c", { timeout: 30000 });
      await pg.waitForFunction(() => !document.querySelector("#cr-comps .cr-dim") || ![...document.querySelectorAll("#cr-comps td[data-l=Soil]")].some((t) => t.textContent === "reading"), null, { timeout: 30000 });
      const t = await pg.$$eval("tbody.cr-c", (x) => x.map((e) => +e.dataset.no));
      const m = await pg.$$eval("#cr-map g[data-no]", (x) => x.map((e) => +e.dataset.no));
      assert.ok(t.length >= 3, url + " comps listed");
      assert.deepEqual(m, t);
      assert.deepEqual(t, t.map((_, i) => i + 1));
      assert.match(await pg.textContent("#cr-sum"), /Middle \(median\) \$\/acre/);
      const [dl] = await Promise.all([pg.waitForEvent("download"), pg.click("#cr-csv")]);
      const csv = fs.readFileSync(await dl.path(), "utf8").trim().split("\r\n");
      assert.equal(csv.length, t.length + 1);
      const pdf = await pg.pdf({ format: "Letter", preferCSSPageSize: true });
      const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
      assert.ok(pages >= 4 && pages <= 14, url + " printed pages: " + pages);
      await pg.emulateMedia({ media: "print" });
      assert.equal(await pg.$eval("#topnav, nav.nav", (e) => getComputedStyle(e).display).catch(() => "none"), "none", "site menu hidden in print");
      assert.deepEqual(errs, []);
      await ctx.close();
    }
    // a state we hold no sales for: says so, and shows what it can
    const { pg, ctx } = await openPage(browser, port, "/comp-report.html?lat=42.03&lon=-93.62", 390);
    await pg.waitForFunction(() => /We do not hold Iowa recorded sales yet/.test(document.body.textContent), null, { timeout: 30000 });
    assert.equal(await pg.isHidden("#cr-sec-comps"), true);
    assert.equal(await pg.isHidden("#cr-csv"), true);
    assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth <= 390), true, "no sideways scroll on a phone");
    await ctx.close();
    // no subject
    const n = await openPage(browser, port, "/comp-report.html");
    assert.equal(await n.pg.isVisible("#cr-none"), true);
    await n.ctx.close();
  } finally { await browser.close(); srv.close(); }
});

// ---------------------------------------------------------------- privacy and failure modes
test("Analytics gets the bare path: no parcel number, county, outline or spot leaves in the page address", () => {
  const h = read("comp-report.html");
  assert.match(h, /gtag\('set',\{page_location:location\.origin\+location\.pathname\}\)/);
  assert.match(h, /gtag\('config','G-6KXCTD5Z9H',\{page_location:location\.origin\+location\.pathname,page_referrer:document\.referrer\?document\.referrer\.split\('\?'\)\[0\]:''\}\)/);
  assert.doesNotMatch(h, /gtag\('config','G-6KXCTD5Z9H'\)/, "no config call that would send the full address");
});

test("page rules in the source: late parcel answers ignored, rows patched in place, links only http(s), print says what did not finish", () => {
  const js = read("components/comp-report.js"), h = read("comp-report.html");
  assert.match(js, /setTimeout\(function \(\) \{ timedOut = true; ok\(\); \}, 15000\)/);
  assert.match(js, /if \(timedOut\) return ok\(\);\n\s+S\.parcels = ps;/, "a parcel answer after the cap does not move the subject");
  assert.match(js, /function patchComp\(r\)/);
  assert.match(js, /sec\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(js, /role="status" aria-live="polite"/);
  assert.match(js, /function safeURL\(u\) \{ return \/\^https\?:/);
  assert.doesNotMatch(js, /href="' \+ esc\(l\.url\)/, "source links pass through safeURL");
  assert.match(js, /addEventListener\('beforeprint'/);
  assert.match(h, /\.fs-loading::after,\.cr-wait::after\{content:"not available at time of printing"/);
  assert.match(js, /'<h4>Parcel '/, "per-parcel headings sit under the h3");
  // the report's order: summary, the list, the map, then the subject, the search and the sources
  const order = ["cr-sec-sum", "cr-sec-comps", "cr-sec-map", "cr-subject", "cr-soil", "cr-cdl", "cr-params", "cr-funnel", "cr-src"].map((id) => h.indexOf('id="' + id + '"'));
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), "section order " + order);
});

test("in Chromium: county files that do not load say so; a county map that does not load says so; nothing is left reading", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  async function open(url, block) {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
    const pg = await ctx.newPage();
    const errs = []; pg.on("pageerror", (e) => errs.push(String(e)));
    await pg.route("**/*", (r) => { const u = r.request().url(); return u.startsWith(`http://127.0.0.1:${port}`) && !block.test(u) ? r.continue() : r.abort(); });
    await pg.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
    return { pg, ctx, errs };
  }
  try {
    const a = await open("/comp-report.html?lat=40.12&lon=-88.2", /\/data\/land\/il\/\d{5}\.json/);
    await a.pg.waitForFunction(() => /county sales files did not load/.test(document.body.textContent), null, { timeout: 30000 });
    assert.doesNotMatch(await a.pg.textContent("body"), /We do not hold Illinois recorded sales/);
    assert.equal(await a.pg.isHidden("#cr-csv"), true);
    assert.deepEqual(a.errs, []);
    await a.ctx.close();
    const b = await open("/comp-report.html?lat=40.12&lon=-88.2", /counties\.geo\.json/);
    await b.pg.waitForFunction(() => /county map did not load/.test(document.body.textContent), null, { timeout: 30000 });
    assert.equal(await b.pg.$$eval("#cr-body .fs-loading", (x) => x.length), 0, "nothing left reading");
    await b.ctx.close();
    // a Field Scout link carries the county: the report runs without the county map
    const f = "40.11750,-88.20250~40.11750,-88.19750~40.12250,-88.19750~40.12250,-88.20250";
    const c = await open("/comp-report.html?f=" + encodeURIComponent(f) + "&fips=17019", /counties\.geo\.json/);
    await c.pg.waitForSelector("tbody.cr-c", { timeout: 30000 });
    assert.match(await c.pg.textContent("#cr-h"), /Champaign County, Illinois/);
    assert.match(await c.pg.textContent("#cr-sum"), /Typical price paid near you[\s\S]*sales matched/);
    await c.pg.waitForFunction(() => !document.querySelector("#cr-sec-comps[aria-busy]"), null, { timeout: 30000 });
    assert.match(await c.pg.textContent("#cr-status"), /read for all \d+ listed sales/);
    await c.ctx.close();
  } finally { await browser.close(); srv.close(); }
});
