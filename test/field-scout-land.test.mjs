/* Field Scout land card (Oct 17, 2026): parcel and owner, recorded transfers,
 * sold-land comps, and the printable land report.
 *
 *   node --test test/field-scout-land.test.mjs
 *
 * The parcel and sales rows below are made up for the test (SYNTHETIC names);
 * every number is worked by hand in the comment beside it. */
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
const REG = JSON.parse(read("data/land/parcel-services.json"));
const WI = REG.statewide.WI[0];

const rows = [
  { doc: "900001", date: "2024-03-15", price: 1250000, acres: 160, cls: "4", conv: "Warranty Deed", pid: "022-1234-56-000", muni: "TOWN OF CHETEK", legal: "SE NE SEC 12 T33N R10W", lat: 45.31, lng: -91.65 },
  { doc: "900002", date: "2019-06-01", price: 400000, acres: 80, cls: "4 7", conv: "Land Contract", pid: "0221234 56000", muni: "TOWN OF CHETEK", legal: "SE NE SEC 12 T33N R10W", lat: 45.31, lng: -91.65 },
  { doc: "900003", date: "2021-11-02", price: 0, acres: 40, cls: "5M", conv: "Quit Claim Deed", pid: "22-1234-56", muni: "TOWN OF CHETEK", legal: "", exempt: 1, lat: 45.31, lng: -91.65 },
  { doc: "900008", date: "2016-04-01", price: 150000, acres: 40, cls: "4", conv: "Warranty Deed", pid: "022-1234-99-000", muni: "TOWN OF CHETEK", legal: "SE NE SEC 12 T33N R10W", lat: 45.31, lng: -91.65 },
  { doc: "900009", date: "2016-04-01", price: 150000, acres: 40, cls: "4", conv: "Warranty Deed", pid: "022-1234-98-000", muni: "TOWN OF CHETEK", legal: "NW NE SEC 12 T33N R10W", lat: 45.31, lng: -91.65 },
  { doc: "900004", date: "2022-05-20", price: 210000, acres: 35, cls: "5", conv: "Warranty Deed", pid: "022-1300-01-000", muni: "VILLAGE OF PRAIRIE FARM", legal: "SW SW SEC 3 T32N R11W", lat: 45.24, lng: -91.98 },
  { doc: "900007", date: "2025-01-10", price: 560000, acres: 72, cls: "6", conv: "Warranty Deed", pid: "022-1500-02-000", muni: "TOWN OF DALLAS", legal: "NW SE SEC 20 T33N R11W", lat: 45.26, lng: -91.82 },
];
const parcel = { ids: ["022-1234-56-000"], legal: "SE NE SEC 12 T33N R10W", muni: "Town of Chetek" };

test("parcel numbers match across county formatting", () => {
  const a = F.parcelKeys("022-1234-56-000"), b = F.parcelKeys("0221234 56000"), c = F.parcelKeys("22-1234-56");
  assert.equal(a.strip, b.strip);                 // same digits, punctuation aside
  assert.notEqual(a.strip, c.strip);              // leading zero and trailing block dropped
  assert.equal(a.core, c.core);                   // but the same once those are set aside
  assert.equal(F.parcelKeys(""), null);
  assert.equal(F.parcelKeys("0000"), null);       // an all-zero placeholder is no parcel number
  assert.notEqual(F.parcelKeys("022-1234-56-000").core, F.parcelKeys("022-1234-57-000").core);
});

test("transfer history: exact, formatting and uncertain matches, newest first", () => {
  const m = F.matchTransfers(parcel, rows);
  assert.deepEqual(m.map((x) => x.r.doc), ["900001", "900003", "900002", "900008"]);
  assert.deepEqual(m.map((x) => x.how), ["exact", "format", "exact", "uncertain"]);
  // 900009: same section and town but another quarter, not this parcel
  assert.ok(!m.some((x) => x.r.doc === "900009"));
  // another town is never a legal-description match
  assert.equal(F.matchTransfers({ ids: ["999"], legal: "SE NE SEC 12 T33N R10W", muni: "Town of Dallas" }, rows).length, 0);
  // same day: the higher document number shows first
  const s = F.sortHistory([{ date: "2020-01-01", doc: "5" }, { date: "2020-01-01", doc: "7" }, { date: "2021-01-01", doc: "1" }]);
  assert.deepEqual(s.map((x) => x.doc), ["1", "7", "5"]);
});

test("legal descriptions: section, township, range and quarters", () => {
  assert.deepEqual(F.parseSTR("SE NE SEC 12 T33N R10W"), { sec: 12, twp: 33, rng: 10, dir: "W", q: "SE NE" });
  assert.deepEqual(F.parseSTR("NW1/4 of the SW1/4, Section 4, Township 101 N, Range 40 W").sec, 4);
  assert.equal(F.parseSTR("LOT 4 BLK 2"), null);
});

test("$/acre math against hand-worked figures", () => {
  assert.equal(F.perAcre(1250000, 160), 7813);    // 1,250,000 / 160 = 7,812.5, rounds to 7,813
  assert.equal(F.perAcre(400000, 80), 5000);
  assert.equal(F.perAcre("$210,000", "35"), 6000); // 210,000 / 35 = 6,000
  assert.equal(F.perAcre(560000, 72), 7778);      // 7,777.8
  assert.equal(F.perAcre(0, 40), null);           // no price, no number
  assert.equal(F.perAcre(100000, 0), null);
  assert.equal(F.perAcre(null, 10), null);
});

test("comps: market sales only by default, filters, sorting, distance", () => {
  const o = { lat: 45.31, lng: -91.65 };
  const all = F.filterComps(rows, {}, o);
  assert.ok(!all.some((r) => r.doc === "900003"), "a quit claim with no price is not a comp");
  assert.equal(all[0].doc, "900007");             // newest first by default
  const big = F.filterComps(rows, { minAc: 70, sort: "ppa", dir: "asc" }, o);
  assert.deepEqual(big.map((r) => r.doc), ["900002", "900007", "900001"]); // 5,000 then 7,778 then 7,813
  const near = F.filterComps(rows, { maxMi: 5 }, o);
  assert.ok(near.every((r) => r.muni === "TOWN OF CHETEK"));
  const since = F.filterComps(rows, { since: "2022-01-01" }, o);
  assert.deepEqual(since.map((r) => r.doc).sort(), ["900001", "900004", "900007"]);
  const forest = F.filterComps(rows, { cls: ["5M", "6"] }, o);
  assert.deepEqual(forest.map((r) => r.doc), ["900007"]);
  const every = F.filterComps(rows, { all: true }, o);
  assert.equal(every.length, rows.length - 1);    // still needs a price and acres to be listed
  // Prairie Farm is about 16 miles west of Chetek
  const pf = all.find((r) => r.doc === "900004");
  assert.ok(pf.mi > 14 && pf.mi < 18, "miles " + pf.mi);
  // a sale with no place sorts to the bottom of a distance sort either way
  const noPlace = F.filterComps(rows.concat([{ doc: "x", date: "2024-01-01", price: 100000, acres: 20, cls: "4", conv: "Warranty Deed" }]), { sort: "mi", dir: "asc" }, o);
  assert.equal(noPlace[noPlace.length - 1].doc, "x");
});

test("middle price: median, never from fewer than 3 sales", () => {
  assert.deepEqual(F.medianPpa([{ ppa: 5000 }, { ppa: 7813 }, { ppa: 6000 }]), { ppa: 6000, n: 3 });
  assert.deepEqual(F.medianPpa([{ ppa: 5000 }, { ppa: 6000 }, { ppa: 7000 }, { ppa: 9000 }]), { ppa: 6500, n: 4 });
  assert.equal(F.medianPpa([{ ppa: 5000 }, { ppa: 6000 }]), null);
});

test("Wisconsin parcel attributes read into the card's fields", () => {
  const p = F.parseParcel({ PARCELID: "022-1234-56-000", TAXPARCELID: "02212345600", OWNERNME1: "SYNTHETIC FARMS LLC", OWNERNME2: "SYNTHETIC FARMS LLC",
    PSTLADRESS: "123 SAMPLE RD CHETEK WI 54728", SITEADRESS: null, GISACRES: 39.87, DEEDACRES: "40", ASSDACRES: 40, LNDVALUE: 61200, IMPVALUE: 0,
    CNTASSDVALUE: 61200, ESTFMKVALUE: 189000, PROPCLASS: "4", AUXCLASS: null, CONAME: "BARRON", PLACENAME: "TOWN OF CHETEK", TAXROLLYEAR: "2024" }, WI);
  assert.equal(p.id, "022-1234-56-000");
  assert.deepEqual(p.ids, ["022-1234-56-000", "02212345600"]);
  assert.deepEqual(p.owner, ["SYNTHETIC FARMS LLC"]);   // the same name twice shows once
  assert.equal(p.mail, "123 SAMPLE RD CHETEK WI 54728");
  assert.equal(p.site, null);
  assert.equal(p.gisAc, 39.87); assert.equal(p.deedAc, 40);
  assert.equal(p.land, 61200); assert.equal(p.imp, 0);      // bare land: no improvements, a real $0
  assert.equal(p.total, 61200);
  assert.equal(F.classLabel(p.cls), "Agricultural");
});

test("blank parcel rolls (all zeros) print as missing, not as $0", () => {
  const p = F.parseParcel({ PARCELID: "1", LNDVALUE: 0, IMPVALUE: 0, CNTASSDVALUE: 0 }, WI);
  assert.equal(p.land, null); assert.equal(p.imp, null); assert.equal(p.total, null);
  assert.equal(p.owner, null);                              // no owner field filled, no owner shown
});

test("which parcel services a spot uses", () => {
  const wi = F.servicesFor(REG, "WI", "55005");
  assert.ok(wi.length >= 1 && wi.every((s) => s.builtin), "Wisconsin's statewide map is tried before the first check");
  assert.equal(F.servicesFor(REG, "IA", "19169").length, 0, "nothing for Iowa until a county service is verified");
  const reg = { statewide: { MN: [{ id: "mn", verified: true, covers: ["27001"] }] }, counties: { "27003": [{ id: "c", verified: true }], "27005": [{ id: "u", verified: false }] } };
  assert.deepEqual(F.servicesFor(reg, "MN", "27001").map((s) => s.id), ["mn"]);
  assert.deepEqual(F.servicesFor(reg, "MN", "27003").map((s) => s.id), ["c"]);  // a county that opted out of the state file
  assert.deepEqual(F.servicesFor(reg, "MN", "27005"), []);                      // unverified never shows
});

test("a state without a free parcel service gets a designed empty state, never a guess", () => {
  const e = F.parcelEmpty("Iowa", "Story", [{ t: "x", url: "https://example.gov" }]);
  assert.equal(e.title, "Parcel and owner lines for Iowa come from county offices.");
  assert.match(e.body, /Story County assessor/);
  assert.doesNotMatch(e.title + e.body, /estimat|likely|probabl/i);
});

test("the registry: only the checker marks a service verified; MN, IA, IL and the Oct 18 states are searched", () => {
  for (const [st, list] of Object.entries(REG.statewide)) for (const s of list) {
    assert.ok(!s.verified || s.checked_utc, `${st} ${s.id} verified without a check`);
    assert.match(s.url, /^https:\/\//);
    assert.ok(s.fields && s.fields.pid && s.fields.owner, `${s.id} names its parcel and owner fields`);
  }
  for (const [fips, list] of Object.entries(REG.counties || {})) for (const s of list) assert.ok(!s.verified || s.checked_utc, fips);
  assert.deepEqual(REG.discover.states.slice().sort(), ["IA", "IL", "IN", "KS", "MI", "MN", "MO", "ND", "NE", "OH", "SD"]);
});

test("transfer files turn into rows with $/acre and the town's place", () => {
  const file = { county: "Barron", fips: "55005", cols: ["doc", "date", "price", "acres", "muni"], munis: { "0": ["Chetek town", 45.3, -91.6] }, rows: [["1", "2024-01-02", 300000, 60, "0"]] };
  const r = F.rowObjs(file)[0];
  assert.equal(r.ppa, 5000); assert.equal(r.muniName, "Chetek town"); assert.equal(r.lat, 45.3); assert.equal(r.county, "Barron");
});

test("field outline: share link decodes and a quarter-quarter is 40 acres", () => {
  // 0.0036232 deg of latitude is 402.3 m; at 45 N, 402.3 m east is 0.005111 deg. 402.3 m squared is 40.0 acres.
  const s = "45.00000,-91.00000~45.00362,-91.00000~45.00362,-90.99489~45.00000,-90.99489";
  const pts = F.decodeField(encodeURIComponent(s));
  assert.equal(pts.length, 4);
  const ac = F.ringAcres(pts);
  assert.ok(Math.abs(ac - 40) < 0.4, "acres " + ac);
  assert.equal(F.decodeField("1,2~3,4"), null);
  assert.equal(F.decodeField("garbage"), null);
});

test("lazy: the land card is not on Field Scout's first screen and loads by version", () => {
  assert.doesNotMatch(read("field-scout.html"), /field-scout-land\.js/);
  assert.match(read("field-scout-read.js"), /var FS_LAND_SRC='\/field-scout-land\.js\?v=\d+'/);
  assert.match(read("field-scout-read.js"), /section\('land',ICONS\.rent,'Parcel, Owner &amp; Sales','fs-land'\)/);
  assert.match(read("field-scout.js"), /FS_READ_SRC='\/field-scout-read\.js\?v=12'/);   // v12: bids-network.js v8 (fx/fastfacts, past main v11)
});

test("the land report is one shared page with a query parameter, kept out of search", () => {
  const h = read("field-report.html");
  assert.match(h, /<meta name="robots" content="noindex, follow">/);
  assert.match(h, /Sigurd Lindquist, CCA/);
  assert.match(h, /free, no sign-up/);
  assert.match(read("components/field-report.js"), /\[\?&\]f=/);
  for (const sm of readdirSync(ROOT).filter((f) => /^sitemap.*\.xml$/.test(f))) assert.doesNotMatch(read(sm), /field-report/);
  assert.ok(!existsSync(join(ROOT, "field-report")), "no folder of per-field report files");
});

test("free means free: no email gate, sign-up or upgrade in the land pieces", () => {
  // the site's own header and footer (static-nav blocks) are left out: they link the sponsor page site-wide
  const all = ["field-scout-land.js", "components/field-report.js", "field-report.html"].map(read).join("\n").replace(/<!-- static-nav:(header|footer)[\s\S]*?<!-- \/static-nav:\1 -->/g, "");
  assert.doesNotMatch(all.replace(/no sign-up/gi, ""), /sign[ -]?up|subscribe|upgrade|enter your email|premium|sponsor/i);
});

test("no em dashes in the new copy", () => {
  for (const f of ["field-scout-land.js", "components/field-report.js", "field-report.html", "data/land/parcel-services.json",
    "scripts/probe_land_services.py", "scripts/fetch_land_sales.py", "scripts/wi_retr_browser.py", "scripts/land_keep_stamp_only.py", ".github/workflows/land-data.yml"]) {
    assert.ok(!read(f).includes("—"), f + " has an em dash");
  }
});

// Illinois MyDec rows shaped like the real Oct 2026 file (data/land/il/17105.json, 17113.json); names left out.
const IL_COLS = ["doc", "date", "price", "acres", "tac", "np", "cls", "conv", "pid", "muni", "legal", "exempt"];
const ilFile = (rows, extra) => Object.assign({ state: "IL", county: "Livingston", fips: "17105", cols: IL_COLS, munis: { "6": ["Nebraska township", 40.9, -88.6] }, rows }, extra || {});
const LIV_MULTI = ["2026R-03806", "2026-08-17", 2182500, 894.9, null, 2, "4", "Warranty Deed", "13-13-17-100-002", "6",
  "THE NORTHWEST QUARTER OF SECTION 17, TOWNSHIP 28 NORTH, RANGE 3 EAST OF THE THIRD PRINCIPAL MERIDIAN, LIVINGSTON COUNTY, ILLINOIS; EXCEPTING", 0];
const ONE = ["2026R-04000", "2026-09-04", 400000, 40, null, 1, "4", "Warranty Deed", "13-13-18-100-001", "6", "THE NORTHEAST QUARTER OF THE NORTHEAST QUARTER OF SECTION 18", 0];

test("Illinois multi-parcel acres: uncertain in a file built before the checked rule, no $/acre, out of the middle", () => {
  const [m, one] = F.rowObjs(ilFile([LIV_MULTI, ONE]));
  // a quarter section (160 ac, less the exception) plus one more parcel cannot be 894.9 acres; $2,182,500 / 894.9 = $2,439 was the bad figure
  assert.equal(m.acres, null); assert.equal(m.ppa, null); assert.equal(m.acUnsure, true);
  assert.equal(one.acres, 40); assert.equal(one.ppa, 10000);   // 400,000 / 40
  assert.ok(F.marketSale(m), "still a market sale, listed");
  const list = F.filterComps([m, one], {}, null);
  assert.equal(list.length, 2);
  assert.equal(F.medianPpa(list), null, "one known $/acre is not a middle price");
  assert.equal(F.filterComps([m, one], { minAc: 20 }, null).length, 1, "an acres filter drops unknown acres");
  assert.match(F.compsTable(list), /title="2 parcels on one return; acres uncertain">\?</);
  assert.match(F.historyHTML([{ r: m, how: "exact" }], F.covOf(ilFile([]))), /2 parcels, acres uncertain/);
  assert.doesNotMatch(F.historyHTML([{ r: m, how: "exact" }], F.covOf(ilFile([]))), /\/ac/);
});

test("Illinois multi-parcel acres: trusted from a file built with the checked rule, blank stays uncertain", () => {
  const ok = LIV_MULTI.slice(); ok[3] = 160;   // Line 3a 149.15 + the added PIN 10.85, each read once
  const blank = LIV_MULTI.slice(); blank[3] = null;
  const [a, b] = F.rowObjs(ilFile([ok, blank], { acres_rule: 2 }));
  assert.equal(a.acres, 160); assert.equal(a.ppa, 13641); assert.ok(!a.acUnsure);   // 2,182,500 / 160 = 13,640.6
  assert.equal(b.acres, null); assert.equal(b.acUnsure, true);
});

test("market sales leave out related parties, court and partition deeds (MyDec Line 10b)", () => {
  const base = { price: 1010587, acres: 1793.99, cls: "4", exempt: 0 };
  for (const c of ["Executor Deed, Related Parties", "Trustee Deed, Related Parties", "Warranty Deed, Related Parties", "Sheriff'S Deed",
    "Judicial Sale", "Judge'S Deed", "Deed Of Partition", "Mineral Deed", "Commissioner'S Deed", "Court Officer'S Deed", "Beneficial Interest", "Quit Claim Deed"]) {
    assert.equal(F.marketSale(Object.assign({ conv: c }, base)), false, c);
  }
  for (const c of ["Warranty Deed", "Trustee Deed", "Executor Deed", "Special Warranty Deed", "Deed In Trust", "Administrator'S Deed"]) {
    assert.equal(F.marketSale(Object.assign({ conv: c }, base)), true, c);
  }
  // and the median follows: 3 market rows give 9,000; the related-party $563/ac row is not in it
  const rows = [9000, 10000, 8000].map((p, i) => ({ price: p * 100, acres: 100, conv: "Warranty Deed", date: "2026-0" + (i + 1) + "-01" }))
    .concat([{ price: 1010587, acres: 1793.99, conv: "Executor Deed, Related Parties", date: "2026-05-01" }]);
  assert.deepEqual(F.medianPpa(F.filterComps(rows, {}, null)), { ppa: 9000, n: 3 });
});

test("coverage: filed dates when the file has them, MyDec's real start otherwise, never a 1999 deed date as the start", () => {
  const old = F.coverageText({ from: "1999-06-28", to: "2026-09-04", n: 2000 }, "IL");
  assert.equal(old, "Illinois MyDec declarations filed from 2014 to Sep 4, 2026; some filings carry older deed dates");
  assert.doesNotMatch(old, /1999/);
  const filed = F.coverageText({ from: "1999-06-28", to: "2026-09-04", filed_from: "2014-04-02", filed_to: "2026-10-09", older_deeds: 31 }, "IL");
  assert.equal(filed, "Declarations filed Apr 2, 2014 to Oct 9, 2026; 31 carry deed dates before 2014");
  assert.equal(F.coverageText({ from: "2016-01-04", to: "2026-01-02" }, "WI"), "Transfer returns from Jan 4, 2016 to Jan 2, 2026");
  assert.equal(F.coverageText({ from: "2020-11-30", to: "2026-09-30", filed_from: "2021-01-04", filed_to: "2026-09-30", older_deeds: 12 }, "WI"),
    "Returns filed Jan 4, 2021 to Sep 30, 2026; 12 carry deed dates before 2021");
  assert.match(F.historyHTML([], F.covOf(ilFile([], { coverage: { from: "1999-06-28", to: "2026-09-04" } }))), /filed from 2014 to Sep 4, 2026/);
});

test("sources list names only transfer data on file", () => {
  const h = read("field-scout.html");
  const li = h.match(/<li><strong>Recorded transfers and sold land<\/strong>[\s\S]*?<\/li>/)[0];
  const named = { Wisconsin: "wi", Illinois: "il", Minnesota: "mn", Iowa: "ia" };
  for (const [st, ab] of Object.entries(named)) {
    if (li.includes(st)) assert.ok(existsSync(join(ROOT, "data/land", ab, "index.json")), st + " named as a transfer source with no data on file");
  }
  assert.match(li, /Illinois/);
  assert.doesNotMatch(li, /revenue\.wi\.gov/);
});

// Wisconsin eRETR rows shaped like the Oct 2026 build (scripts/fetch_land_sales.py wi_row; names synthetic).
const WI_COLS = ["doc", "date", "price", "acres", "tac", "np", "cls", "conv", "pid", "muni", "legal", "exempt", "grantor", "grantee", "ac1"];
const wiFile = (rows) => ({ state: "WI", county: "Vernon", fips: "55123", acres_rule: 2, names: true, cols: WI_COLS,
  munis: { "0": ["Viroqua town", 43.55, -90.89] }, coverage: { from: "2026-07-30", to: "2026-09-29", filed_from: "2026-08-03", filed_to: "2026-09-30" }, rows });
// three parcels, each with its own acres, read once: 40 + 38.5 + 1.5 = 80 ac; $720,000 / 80 = $9,000/ac
const WI_SUM = ["900002", "2026-09-01", 720000, 80, null, 3, "4 1", "Warranty Deed, Sale", "036-00578-0000", "0", "SW NE SEC 20 T13N R4W", 0, "SYNTHETIC, SELLER B", "SYNTHETIC FARMS LLC", 40];
// the whole sale's 160 ac typed on the first parcel and 0.00 on the other two: acres left blank by the builder
const WI_ZERO = ["900003", "2026-09-19", 1400000, null, null, 3, "4", "Warranty Deed, Sale", "036-00600-0000", "0", "NW NW SEC 21 T13N R4W", 0, "SYNTHETIC, SELLER D", "SYNTHETIC, BUYER D", 160];
const WI_GIFT = ["900008", "2026-08-30", 0, 35, null, 1, "6", "Quit Claim Deed, Related Parties, Parent/Child Gift", "036-00700-0000", "0", "NE SE SEC 22 T13N R4W", 1, "SYNTHETIC LAND LLC", "SYNTHETIC, CHILD E", null];

test("Wisconsin returns: summed multi-parcel acres trusted, blanked ones uncertain, gifts not market sales", () => {
  const [sum, zero, gift] = F.rowObjs(wiFile([WI_SUM, WI_ZERO, WI_GIFT]));
  assert.equal(sum.acres, 80); assert.equal(sum.ppa, 9000); assert.equal(sum.muniName, "Viroqua town");
  assert.equal(zero.acres, null); assert.equal(zero.acUnsure, true); assert.equal(zero.ppa, null);
  assert.ok(F.marketSale(sum) && F.marketSale(zero));
  assert.ok(!F.marketSale(gift), "a related-party gift with no price is not a comp");
  assert.equal(F.filterComps([sum, zero, gift], {}, null).length, 2);
  assert.equal(F.coverageText(F.covOf(wiFile([])), "WI"), "Returns filed Aug 3, 2026 to Sep 30, 2026");
});

test("Wisconsin transfer files on disk, when present, carry the checked acres rule and no uncertain acres", () => {
  const dir = join(ROOT, "data/land/wi");
  if (!existsSync(join(dir, "index.json"))) return;
  const ix = JSON.parse(read("data/land/wi/index.json"));
  assert.equal(ix.state, "WI");
  assert.ok(ix.counties.length >= 60, "most of Wisconsin's 72 counties");
  for (const c of ix.counties.slice(0, 8)) {
    const f = JSON.parse(read("data/land/wi/" + c.fips + ".json"));
    assert.equal(f.acres_rule, 2);
    assert.ok(f.cols.includes("grantor") && f.cols.includes("ac1"));
    const ia = f.cols.indexOf("acres"), inp = f.cols.indexOf("np"), ic = f.cols.indexOf("cls");
    for (const r of f.rows) {
      assert.ok(/(^| )(4|5M|6)( |$)/.test(r[ic]), "farm or forest class: " + r[ic]);
      if (r[ia] != null) assert.ok(r[ia] > 0 && r[ia] / (r[inp] || 1) <= 640, "acres in range: " + r[ia]);
    }
  }
});

// The land builders' own selftests (synthetic rows): Wisconsin XML, acres rule 2, the newest-only
// merge (no row lost, none doubled), the month picker, and the timestamp-only restore.
test("land data selftests pass (newest-only merge, month picker, timestamp-only restore)", async () => {
  const { execFileSync } = await import("node:child_process");
  for (const s of ["scripts/fetch_land_sales.py", "scripts/wi_retr_browser.py", "scripts/land_keep_stamp_only.py"]) {
    const out = execFileSync("python3", [join(ROOT, s), "--selftest"], { cwd: ROOT, encoding: "utf8" });
    assert.match(out, /^FAILS=0$/m, s + "\n" + out.split("\n").filter((l) => l.startsWith("FAIL")).join("\n"));
  }
});

test("monthly land run: the 3rd, Sig's approval noted, one run at a time", () => {
  const y = read(".github/workflows/land-data.yml");
  assert.match(y, /# Sig approved Oct 17, 2026: monthly on the 3rd[\s\S]*?cron: '23 9 3 \* \*'/);
  assert.match(y, /concurrency:\s*\n\s*group: land-data/);
  assert.match(y, /--newest-only/); assert.match(y, /--merge/); assert.match(y, /land_keep_stamp_only\.py data\/land/);
});

test("Sold land nearby: the report's defaults (3 years), the counties searched and the state line said plainly", () => {
  const js = read("field-scout-land.js");
  assert.match(js, /since: FSLand\.yearsBefore\(FSLand\.today\(\), 3\), minAc: 10/);
  assert.match(js, /compReportURL\(\{ pts: S\.pts, fips: S\.fips \}, S\.f\)/, "the report link carries the county, so the report need not load the county map");
  assert.doesNotMatch(js, /\.slice\(0, 7\)/, "no hard cap of 7 counties");
  assert.equal(F.yearsBefore("2026-10-18", 3), "2023-10-18");
  // 20 counties on a line, one every 10 miles east of the field: the home county, then those within 25 + 15 miles
  const c = { lat: 40, lng: -89 };
  const ix = { counties: Array.from({ length: 20 }, (_, i) => ({ fips: String(17001 + 2 * i), name: "C" + i, lat: 40, lng: -89 + (i * 10) / 53 })) };
  const pick = F.countiesFor(ix, c, "17039", 25 + F.REACH_PAD);
  assert.equal(pick[0].fips, "17039", "home county first");
  assert.deepEqual(pick.slice(1).map((k) => k.name), ["C0", "C1", "C2", "C3", "C4"], "the rest nearest first, centers within 40 miles");
  const many = F.countiesFor(ix, c, null, 500);
  assert.equal(many.length, 15, "up to 15 counties");
  const t = F.searchedText({ searched: pick.map((k, i) => Object.assign({ ok: i !== 2 }, k)), reach: 40 }, "Illinois");
  assert.match(t, /^Counties searched \(5, centers within 40 miles, nearest first, up to 15\): C19, C0, C2, C3, C4\. Did not load just now: C1\. Only Illinois.s records are searched; sales across a state line are not\.$/);
  // a comps list always says the sales are unverified
  assert.match(F.compsTable([{ date: "2025-01-01", price: 400000, acres: 80, ppa: 5000 }]), /Unverified: taken from public transfer records, not confirmed with a party to the sale\./);
});
