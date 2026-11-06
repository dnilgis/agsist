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
    // a legal that names its own buyer or seller is held for the tap (scripts/land_names.py): the panel shows the tap hint
    case "legal": return F.legalHeld(r) ? ["names a buyer or seller: shown with Show buyer and seller"] : v ? [esc(F.clean(v))] : ["not in the record"];
    case "legal_named": return [];
    // the section key (scripts/land_keys.py): the panel's "Section, township, range" line reads it
    case "str": return v ? ["Section, township, range", esc(F.strOf(r.legal) || F.keyText(v))] : ["Section, township, range"];
    case "exempt": return [v ? "Exemption claimed" : "No exemption claimed"];
    // names never show in the panel itself (Sig, Oct 27; lead, Nov 4, 2026): a names-free county file offers the tap,
    // an older one still holding names says they come with the next update
    case "grantor": case "grantee": return f.names ? (f.names_file ? ["Show buyer and seller"] : ["names come after the next update"]) : ["not in our copy"];
    case "si": case "bi": return f.names && f.names_file ? ["Show buyer and seller"] : [];
    case "ac1": return v != null ? [esc(v)] : (+r.np > 1 ? ["not in the record"] : []);
    case "rr": return [v != null ? esc(({ none: "None", life: "The seller keeps a life estate (use of the land for life).", ease: "The seller keeps an easement.", other: "The seller keeps other rights in the land." })[v] || v) : "not in the record"];
    case "mfl": return [v != null ? esc(String(+v)) + " acres" : "not in the record"];
    case "pp": return [v != null ? (+v > 0 ? F.fmtMoney(+v) + " (taken out of the net price above)" : "None") : "not in the record"];
    case "fin": return [v != null ? esc(v) : "not in the record"];
    case "use0": return [v != null ? "Before the sale: " + esc(String(v).replace(/^\d+\.\s*/, "")) : "not in the record"];
    case "use1": return [];
    case "glv": return [v != null ? F.fmtMoney(+v) : "not in the record"];
    case "lsf": return [v != null ? (+v > 0 ? esc((+v).toLocaleString("en-US")) + " square feet (main lot)" : "None on the main lot") : "not in the record"];
    case "yb": return [v != null ? esc(v) + " (main lot)" : "not in the record"];
    case "avl": return [v != null ? F.fmtMoney(+v) + " land" : "not in the record"];
    case "avb": return r.avl != null && v != null ? [F.fmtMoney(+v) + " buildings"] : [];
    case "avy": return r.avl != null && v != null ? [esc(v) + " tax list"] : [];
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
        if ((c === "grantor" || c === "grantee") && r[c] && String(r[c]).length > 4) assert.ok(!h.includes(esc(r[c])), `${st}/${fips} doc ${r.doc}: no name in the panel before the tap`);
        if (c === "legal" && F.legalHeld(r)) assert.ok(!h.includes("[LEGAL WITH A NAME"), `${st}/${fips} doc ${r.doc}: the mark itself is never shown`);
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
  fetched_utc: "2026-10-17T18:32:11Z", names_file: "/data/land/wi/names/55005.json", coverage: { from: "2019-01-01", to: "2026-09-26", filed_from: "2021-01-15", filed_to: "2026-09-30" }, acres_rule: 2, cols: COLS,
  munis: { "0": ["Chetek town", 45.31, -91.65] }, rows });

test("a held legal (it names its own buyer or seller) shows the tap hint in the panel, never the mark or a section guess from it", () => {
  const f = Object.assign(wiFile([["900040", "2025-03-03", 500000, 100, null, 1, "4", "Warranty Deed, Sale", "022-4", "0", "", 0, null, null, null, ""]]),
    { cols: COLS.filter((c) => c !== "grantor" && c !== "grantee").concat(["str", "si", "bi"]) });
  f.rows = [["900040", "2025-03-03", 500000, 100, null, 1, "4", "Warranty Deed, Sale", "022-4", "0", "[LEGAL WITH A NAME 0123456789] UNDIVIDED", 0, null, "", "12-33N-10W", 0, 0]];
  const r = F.rowObjs(f)[0];
  assert.ok(F.legalHeld(r));
  const h = F.saleDetailHTML(r, f, []);
  for (const c of f.cols) for (const w of expectFor(c, r, f) || []) assert.ok(h.includes(w), "held row: column " + c + " shows " + JSON.stringify(w));
  assert.doesNotMatch(h, /LEGAL WITH A NAME/);
  assert.match(h, /Section 12, T33N, R10W/, "the section comes from the key, which was read before the legal was held");
});

test("blank fields say 'not in the record'; fields we do not keep say 'not in our copy'", () => {
  const f = wiFile([["", "", null, null, null, 1, "", "", "", "9", "", 0, "", "", null, ""]]);
  const r = F.rowObjs(f)[0];
  const h = F.saleDetailHTML(r, f, []);
  const blanks = (h.match(/not in the record/g) || []).length;
  assert.ok(blanks >= 8, "deed date, recorded, price, acres, deed type, class, parcel, legal: " + blanks);   // seller and buyer: on the tap
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
  assert.doesNotMatch(h, /SYNTHETIC/, "no name before the tap");
  assert.match(h, /<span id="fl-sd-who"><button type="button" class="fl-btn" data-sd="names">Show buyer and seller<\/button>/);
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
  assert.doesNotMatch(h, /SYNTHETIC/, "the other transfers list no name either");
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
  // the names: the county file's own column (files written before Nov 4, 2026) or its names file
  const gi = f.cols.indexOf("grantee"), nfp = `data/land/${String(f.state).toLowerCase()}/names/${f.fips}.json`;
  const pool = gi >= 0 ? f.rows.map((r) => r[gi]) : existsSync(join(ROOT, nfp)) ? JSON.parse(read(nfp)).b : [];
  const names = [...new Set(pool.filter((x) => x && x.length > 14))].slice(0, 40);
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
  assert.match(read("field-report.html"), /field-scout-land\.js\?v=18/);
  assert.match(read("field-scout-read.js"), /FS_LAND_SRC='\/field-scout-land\.js\?v=18'/);
  // the same nearest-first list from rows (hand-checked: 2, 6, 10, 14 and 20 mi; the 30 mi sale is out)
  const c = { lat: 45.0, lng: -91.0 };
  const mk = (doc, dLat) => ({ doc, date: "2025-01-01", price: 400000, acres: 80, cls: "4", conv: "Warranty Deed", lat: 45.0 + dLat, lng: -91.0, muniName: "T" });
  const list = F.filterComps([mk("c", 14 / 69.09), mk("a", 2 / 69.09), mk("d", 30 / 69.09), mk("b", 6 / 69.09), mk("f", 20 / 69.09), mk("e", 10 / 69.09)], { maxMi: 25, minAc: 10, since: "2023-01-01", sort: "mi", dir: "asc" }, c);
  assert.deepEqual(list.map((r) => r.doc), ["a", "b", "e", "c", "f"]);
  assert.deepEqual(list.map((r) => Math.round(r.mi)), [2, 6, 10, 14, 20]);
  assert.deepEqual(F.medianPpa(list), { ppa: 5000, n: 5 });
  assert.equal(F.medianPpa(list.slice(0, 4)), null, "4 sales: no middle (5 since Oct 29)");
});

test("no em dashes in the sale panel copy", () => {
  for (const f of ["field-scout-land.js", "components/field-report.js", "test/field-scout-sale-detail.test.mjs"]) assert.ok(!read(f).includes(String.fromCharCode(0x2014)), f);
});

test("names load only on the tap, from the names file, and only when it matches the county file's read", async () => {
  const f = Object.assign(wiFile([["900030", "2025-03-03", 500000, 100, null, 1, "4", "Warranty Deed, Sale", "022-3", "0", "", 0, null, null, null, ""]]),
    { cols: COLS.filter((c) => c !== "grantor" && c !== "grantee").concat(["si", "bi"]) });
  f.rows = [["900030", "2025-03-03", 500000, 100, null, 1, "4", "Warranty Deed, Sale", "022-3", "0", "[LEGAL WITH A NAME 0123456789]", 0, null, "", 0, 1]];
  const names = { n: 1, fetched_utc: f.fetched_utc, s: ["SYNTHETIC SELLER Z"], b: ["SYNTHETIC BUYER Y", "SYNTHETIC BUYER Z"], lg: { "0": "PT SW EXC TO Z SYNTHETIC" } };
  const seen = [];
  const keep = globalThis.fetch;
  globalThis.fetch = (u) => { seen.push(u); return Promise.resolve({ ok: true, json: () => Promise.resolve(u.endsWith("55005.json") ? names : null) }); };
  try {
    const r = F.rowObjs(f)[0];
    const before = F.saleDetailHTML(r, f, []);
    assert.doesNotMatch(before, /SYNTHETIC|LEGAL WITH A NAME/);
    assert.match(before, /<span id="fl-sd-legal"><span class="fl-miss">names a buyer or seller: shown with Show buyer and seller/, "a held legal waits for the tap");
    assert.equal(await F.loadNames([r]), 1);
    assert.equal(r.legalNamed, "PT SW EXC TO Z SYNTHETIC", "the tap brings the held legal");
    assert.deepEqual([r.grantor, r.grantee], ["SYNTHETIC SELLER Z", "SYNTHETIC BUYER Z"], "the row's si and bi pick its names");
    assert.deepEqual(seen, ["/data/land/wi/names/55005.json"], "one request, to the names file");
    const g = Object.assign({}, f, { fetched_utc: "2026-11-03T00:00:00Z", names_file: "/data/land/wi/names/55001.json", fips: "55001" });
    names.fetched_utc = "2026-10-01T00:00:00Z";
    globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(names) });
    const r2 = F.rowObjs(g)[0];
    assert.equal(await F.loadNames([r2]), 0, "a names file from another read is not used");
    assert.equal(r2.grantor, undefined);
  } finally { globalThis.fetch = keep; }
});
