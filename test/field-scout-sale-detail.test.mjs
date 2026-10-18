/* Field Scout: tap a land sale for everything on its record (Oct 18, 2026), and the
 * printable land report's sales section.
 *
 *   node --test test/field-scout-sale-detail.test.mjs
 *
 * Real county files (data/land/wi, data/land/il) are read when present: every column a
 * file carries must reach the panel. Synthetic rows (SYNTHETIC names) cover the blanks. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const require = createRequire(import.meta.url);
const F = require(join(ROOT, "field-scout-land.js"));
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const landFile = (st, fips) => { const p = `data/land/${st}/${fips}.json`; return existsSync(join(ROOT, p)) ? JSON.parse(read(p)) : null; };

// What each column must look like in the panel, for a row r of file f.
function expectFor(c, r, f) {
  const v = r[c];
  switch (c) {
    case "doc": return v ? [esc(v)] : [];
    case "date": return v ? [F.fmtDate(v)] : ["not in the record"];
    case "rec": return v ? [F.fmtDate(v)] : ["not in the record"];
    case "price": return v > 0 ? [F.fmtMoney(v)] : v === 0 ? ["$0 on the"] : ["not in the record"];
    case "acres": return r.acres > 0 ? [String(+(+r.acres).toFixed(2))] : r.acUnsure ? ["uncertain"] : ["not in the record"];
    case "tac": return v != null ? [esc(v)] : [];
    case "np": return [`Parcels in this sale</th><td>${+v || 1}`];
    case "cls": return v ? [esc(F.classLabel(v, f.state))] : ["not in the record"];
    case "conv": return v ? [esc(v)] : ["not in the record"];
    case "pid": return v ? [esc(v)] : ["not in the record"];
    case "muni": return r.muniName ? [esc(r.muniName)] : ["not in the record"];
    case "legal": return v ? [esc(F.clean(v))] : ["not in the record"];
    case "exempt": return [v ? "Exemption claimed" : "No exemption claimed"];
    case "grantor": case "grantee": return f.names ? (v ? [esc(v)] : ["not in the record"]) : ["not in our copy"];
    case "ac1": return v != null ? [esc(v)] : (+r.np > 1 ? ["not in the record"] : []);
    default: return null;
  }
}

test("every column a real transfer file carries reaches the panel (WI and IL)", () => {
  let checked = 0;
  for (const [st, fips] of [["wi", "55017"], ["wi", "55001"], ["il", "17001"], ["il", "17105"]]) {
    const f = landFile(st, fips);
    if (!f) continue;
    const rows = F.rowObjs(f);
    // the first 150 rows, plus every multi-parcel row (ac1, uncertain acres) and any row with tac
    const pick = rows.slice(0, 150).concat(rows.filter((r) => +r.np > 1 || r.tac != null).slice(0, 60));
    for (const r of pick) {
      const h = F.saleDetailHTML(r, f, []);
      for (const c of f.cols) {
        const want = expectFor(c, r, f);
        assert.ok(want, `${st} column ${c} has no panel line; add it to saleDetailHTML and to this test`);
        for (const w of want) assert.ok(h.includes(w), `${st}/${fips} doc ${r.doc}: column ${c} should show ${JSON.stringify(w)}`);
      }
      assert.ok(h.includes(esc(f.source)), "source named");
      for (const l of f.links || []) assert.ok(h.includes(esc(l.url)), "source link " + l.url);
      checked++;
    }
  }
  assert.ok(checked > 0 || !existsSync(join(ROOT, "data/land/wi")), "no real rows were checked");
});

const COLS = ["doc", "date", "price", "acres", "tac", "np", "cls", "conv", "pid", "muni", "legal", "exempt", "grantor", "grantee", "ac1", "rec"];
const wiFile = (rows) => ({ state: "WI", county: "Barron", fips: "55005", names: true, source: "Wisconsin Department of Revenue, electronic Real Estate Transfer Returns",
  source_short: "Wisconsin transfer return", links: [{ t: "Wisconsin DOR transfer return data", url: "https://www.revenue.wi.gov/Pages/ERETR/data-home.aspx" }],
  fetched_utc: "2026-10-17T18:32:11Z", coverage: { from: "2019-01-01", to: "2026-09-26", filed_from: "2021-01-15", filed_to: "2026-09-30" }, acres_rule: 2, cols: COLS,
  munis: { "0": ["Chetek town", 45.31, -91.65] }, rows });

test("blank fields say 'not in the record'; fields we do not keep say 'not in our copy'", () => {
  const f = wiFile([["", "", null, null, null, 1, "", "", "", "9", "", 0, "", "", null, ""]]);
  const r = F.rowObjs(f)[0];
  const h = F.saleDetailHTML(r, f, []);
  const blanks = (h.match(/not in the record/g) || []).length;
  assert.ok(blanks >= 9, "deed date, recorded, price, acres, deed type, class, seller, buyer, parcel, legal: " + blanks);
  assert.match(h, /Street address<\/th><td><span class="fl-miss">not in our copy of the record/);
  assert.match(h, /\$\/acre<\/th><td><span class="fl-miss">not figured/);   // never $0/ac or a guess
  assert.doesNotMatch(h, /NaN|undefined|null/);
  // Illinois files keep no recording date: say so, never show the deed date twice
  const il = Object.assign(wiFile([["2026R-1", "2026-09-04", 400000, 40, null, 1, "4", "Warranty Deed", "13-13-18-100-001", "0", "NE NE SEC 18", 0, "SYNTHETIC SELLER", "SYNTHETIC BUYER"]]),
    { state: "IL", cols: COLS.slice(0, 14) });
  const hi = F.saleDetailHTML(F.rowObjs(il)[0], il, []);
  assert.match(hi, /Recorded \(filed\)<\/th><td><span class="fl-miss">not in our copy of the record/);
  assert.match(hi, /Line 13 of Form PTAX-203/);
  assert.match(hi, /Barron County Clerk and Recorder/);
  assert.doesNotMatch(hi, /County County/);
});

test("the panel by hand: a two-parcel related-party land contract", () => {
  // 60 + 40 acres on one return, $500,000: $500,000 / 100 = $5,000/ac
  const f = wiFile([["900010", "2025-03-03", 500000, 100, null, 2, "4 7", "Land Contract, Related Parties, Sale", "022-1234-56-000", "0",
    "The NE 1/4 of the SW 1/4 of Section Twenty-nine (29), Township Thirty-three (33) North, Range Ten (10) West", 1, "SYNTHETIC, SELLER A", "SYNTHETIC, BUYER B; SYNTHETIC, BUYER C", 60, "2025-03-05"]]);
  const r = F.rowObjs(f)[0]; r.mi = 3.4;
  const h = F.saleDetailHTML(r, f, []);
  assert.equal(r.ppa, 5000);
  assert.match(h, /\$5,000/);
  assert.match(h, /Mar 3, 2025/); assert.match(h, /Mar 5, 2025/);
  assert.match(h, /Agricultural, Other \(farm buildings\)/);
  assert.match(h, /<span class="fl-warn">Yes<\/span>, the return says so/);
  assert.match(h, /Exemption claimed \(an exemption number is on the return\)/);
  assert.match(h, /No: exempt from the transfer fee; buyer and seller related/);
  assert.match(h, /Our copy keeps the first parcel number only; the other 1 are on the return/);
  assert.match(h, /Acres on the first parcel line<\/th><td>60/);
  assert.match(h, /Section 29, T33N, R10W/);
  assert.match(h, /About 3 miles to the center of Chetek town/);
  assert.match(h, /Barron County Register of Deeds/);
  assert.match(h, /SYNTHETIC, BUYER B; SYNTHETIC, BUYER C/);
  assert.match(h, /not an appraisal/);
});

test("other recorded transfers of the same parcel are listed, each opening its own record", () => {
  const f = wiFile([
    ["900011", "2025-03-03", 500000, 100, null, 1, "4", "Warranty Deed, Sale", "022-1234-56-000", "0", "", 0, "SYNTHETIC A", "SYNTHETIC B", null, ""],
    ["900012", "2019-06-01", 300000, 100, null, 1, "4", "Warranty Deed, Sale", "22-1234-56", "0", "", 0, "SYNTHETIC C", "SYNTHETIC A", null, ""],
    ["900013", "2019-06-01", 1, 1, null, 1, "4", "Warranty Deed, Sale", "022-9999-00-000", "0", "", 0, "X", "Y", null, ""]]);
  const rows = F.rowObjs(f);
  const others = F.matchTransfers({ ids: [rows[0].pid] }, rows.filter((x) => x.doc !== rows[0].doc));
  assert.equal(others.length, 1);
  const h = F.saleDetailHTML(rows[0], f, others);
  assert.match(h, /data-other="0"[^>]*><span class="d">Jun 1, 2019/);
  assert.match(h, /SYNTHETIC C &rarr; SYNTHETIC A/);
  assert.match(h, /county formatting set aside/);
  assert.match(F.saleDetailHTML(rows[2], f, []), /No other transfer of parcel 022-9999-00-000 is in our copy/);
});

test("section, township, range from numerals and from words (WI north and west, IL south)", () => {
  assert.equal(F.strOf("SE NE SEC 12 T33N R10W"), "Section 12, T33N, R10W");
  assert.equal(F.strOf("The Northeast One-quarter (1/4) of the Southwest One-quarter (1/4) of Section Twenty-nine (29), Township fifteen (15) North, Range Six (6) E"), "Section 29, T15N, R6E");
  assert.equal(F.strOf("THE SOUTH HALF OF THE SOUTHWEST QUARTER OF SECTION 17 SITUATED IN TOWNSHIP 2 SOUTH OF THE BASE LINE, RANGE 7 WEST OF THE FOURTH PRINCIPAL ME"), "Section 17, T2S, R7W");
  assert.equal(F.strOf("THE NORTHWEST QUARTER OF SECTION 17, TOWNSHIP 28 NORTH, RANGE 3 EAST OF THE THIRD PRINCIPAL MERIDIAN"), "Section 17, T28N, R3E, Third Principal Meridian");
  assert.equal(F.strOf("Lot Eight (8), Tall Pines, a recorded subdivision"), null);
  assert.equal(F.strOf(""), null);
});

test("parcel lookup: the where clause holds only the parcel number, quotes doubled; one match or none", () => {
  const svc = { fields: { pid: ["PARCELID"], pid2: ["TAXPARCELID"] } };
  assert.equal(F.parcelWhere(svc, "022-1234-56-000"), "PARCELID IN ('022-1234-56-000','022123456000') OR TAXPARCELID IN ('022-1234-56-000','022123456000')");
  assert.equal(F.parcelWhere(svc, "12'3"), "PARCELID IN ('12''3','123') OR TAXPARCELID IN ('12''3','123')");
  assert.equal(F.parcelWhere(svc, ""), null);
  assert.equal(F.parcelWhere({ fields: {} }, "123"), null);
  const a = { ids: ["022-1234-56-000"], county: "BARRON" }, b = { ids: ["022-1234-56-000"], county: "DUNN" };
  assert.equal(F.pickParcel([a, b], "0221234 56000", "Barron"), a);   // same number in two counties: the sale's county
  assert.equal(F.pickParcel([a, { ids: ["022-1234-56-000"], county: "Barron County" }], "022-1234-56-000", "Barron"), null);   // two hits: no pick
  assert.equal(F.pickParcel([{ ids: ["9"], county: "BARRON" }], "022-1234-56-000", "Barron"), null);
});

test("Field Scout's filters ride to the printable report and come back the same", () => {
  const f = { maxMi: 25, minAc: 10, maxAc: 200, minPpa: 3000, since: "2023-10-18", cls: ["5M", "6"], all: true };
  const s = F.encodeFilter(f);
  assert.equal(s, "mi:25,ac:10,ax:200,p1:3000,s:2023-10-18,c:5M.6,a:1");
  assert.deepEqual(F.decodeFilter(s), f);
  assert.equal(F.decodeFilter("mi:<script>,s:yesterday"), null);
  assert.equal(F.decodeFilter(""), null);
  assert.equal(F.filterText({ maxMi: 25, minAc: 10, since: "2023-10-18" }), "market sales, 10 acres or more, within 25 miles, since Oct 18, 2023");
});

test("rows are buttons a keyboard and a screen reader can use; the panel is a dialog that closes on Escape", () => {
  const f = wiFile([["900020", "2025-03-03", 500000, 100, null, 1, "4", "Warranty Deed, Sale", "022-1", "0", "", 0, "SYNTHETIC A", "SYNTHETIC B", null, ""]]);
  const t = F.compsTable(F.rowObjs(f), 40, { detail: true });
  assert.match(t, /<button type="button" class="fl-sale" data-sale="0" aria-haspopup="dialog" aria-label="Everything on the sale of Mar 3, 2025, \$500,000, 100\.0 acres, Chetek town">Mar 3, 2025<\/button>/);
  assert.doesNotMatch(F.compsTable(F.rowObjs(f), 40, {}), /fl-sale|data-sort/);   // the printed report has no buttons
  assert.match(F.compsTable(F.rowObjs(f), 10, { src: true }), /<th scope="col"[^>]*>Source<\/th>[\s\S]*Wisconsin transfer return 900020/);
  const js = read("field-scout-land.js");
  assert.match(js, /setAttribute\('role', 'dialog'\)/);
  assert.match(js, /setAttribute\('aria-modal', 'true'\)/);
  assert.match(js, /aria-label="Close sale details"/);
  assert.match(js, /e\.key === 'Escape'/);
  assert.match(js, /e\.key === 'Tab'/);                    // focus stays in the panel
  assert.match(js, /back\.focus\(\)/);                     // and goes back to the sale on close
  // phones: a sheet from the bottom; 900px and wider: a side panel
  assert.match(js, /\.fl-sd\{position:fixed;z-index:10001;left:0;right:0;bottom:0;max-height:88vh/);
  assert.match(js, /@media\(min-width:900px\)\{\.fl-sd\{top:0;left:auto;width:min\(460px,94vw\)/);
  assert.match(js, /\.fl-sd-x\{[^}]*min-width:44px;min-height:44px/);
});

test("names stay off indexed pages: /data/land is blocked, the report is noindex, Field Scout renders names only from /data/land", () => {
  assert.match(read("robots.txt"), /^Disallow: \/data\/land\/$/m);
  assert.match(read("field-report.html"), /<meta name="robots" content="noindex, follow">/);
  assert.doesNotMatch(read("field-scout.html"), /field-scout-land\.js|grantor|grantee/);
  const sitemaps = readdirSync(ROOT).filter((x) => /^sitemap.*\.xml$/.test(x)).map(read).join("\n");
  assert.doesNotMatch(sitemaps, /data\/land|field-report/);
  // a sample of real names must appear in no page the sitemaps list
  const f = landFile("wi", "55017") || landFile("il", "17001");
  if (!f) return;
  const gi = f.cols.indexOf("grantee");
  const names = [...new Set(f.rows.map((r) => r[gi]).filter((x) => x && x.length > 14))].slice(0, 40);
  const pages = [...sitemaps.matchAll(/<loc>https:\/\/agsist\.com\/([^<]*)<\/loc>/g)].map((m) => m[1]).map((p) => p === "" ? "index.html" : p.endsWith("/") ? p + "index.html" : /\.[a-z]+$/.test(p) ? p : p + ".html");
  let seen = 0;
  for (const p of pages) {
    if (!existsSync(join(ROOT, p))) continue;
    const h = read(p); seen++;
    for (const n of names) assert.ok(!h.includes(n), `${p} carries a name from the transfer data`);
  }
  assert.ok(seen > 20, "sitemap pages read: " + seen);
});

test("printable report: your filters or 3-year defaults, median with n, the 10 nearest with source, not an appraisal", () => {
  const js = read("components/field-report.js");
  assert.match(js, /\[\?&\]cf=/);
  assert.match(js, /F\.decodeFilter\(/);
  assert.match(js, /setFullYear\(since\.getFullYear\(\) - 3\); f = \{ maxMi: 25, minAc: 10/);
  assert.match(js, /f\.sort = 'mi'; f\.dir = 'asc'/);
  assert.match(js, /F\.compsTable\(list, 10, \{ src: true \}\)/);
  assert.match(js, /Recorded sales in our data, through ' \+ F\.fmtDate\(thru\) \+ '; not an appraisal\./);
  assert.match(js, /middle of ' \+ med\.n \+ ' sales/);
  assert.match(read("field-scout-land.js"), /rep\.setAttribute\('href', base \+ \(cf \? '&cf=' \+ encodeURIComponent\(cf\) : ''\)\)/);
  assert.match(read("field-report.html"), /field-scout-land\.js\?v=7/);
  assert.match(read("field-scout-read.js"), /FS_LAND_SRC='\/field-scout-land\.js\?v=7'/);
  // the same nearest-first list from rows (hand-checked: 2 mi, 6 mi, 14 mi; the 30 mi sale is out)
  const c = { lat: 45.0, lng: -91.0 };
  const mk = (doc, dLat) => ({ doc, date: "2025-01-01", price: 400000, acres: 80, cls: "4", conv: "Warranty Deed", lat: 45.0 + dLat, lng: -91.0, muniName: "T" });
  const list = F.filterComps([mk("c", 14 / 69.09), mk("a", 2 / 69.09), mk("d", 30 / 69.09), mk("b", 6 / 69.09)], { maxMi: 25, minAc: 10, since: "2023-01-01", sort: "mi", dir: "asc" }, c);
  assert.deepEqual(list.map((r) => r.doc), ["a", "b", "c"]);
  assert.deepEqual(list.map((r) => Math.round(r.mi)), [2, 6, 14]);
  assert.deepEqual(F.medianPpa(list), { ppa: 5000, n: 3 });
});

test("no em dashes in the sale panel copy", () => {
  for (const f of ["field-scout-land.js", "components/field-report.js", "test/field-scout-sale-detail.test.mjs"]) assert.ok(!read(f).includes(String.fromCharCode(0x2014)), f);
});
