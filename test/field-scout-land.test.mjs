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

test("the registry: only the checker marks a service verified; MN, IA and IL are searched", () => {
  for (const [st, list] of Object.entries(REG.statewide)) for (const s of list) {
    assert.ok(!s.verified || s.checked_utc, `${st} ${s.id} verified without a check`);
    assert.match(s.url, /^https:\/\//);
    assert.ok(s.fields && s.fields.pid && s.fields.owner, `${s.id} names its parcel and owner fields`);
  }
  for (const [fips, list] of Object.entries(REG.counties || {})) for (const s of list) assert.ok(!s.verified || s.checked_utc, fips);
  assert.deepEqual(REG.discover.states.slice().sort(), ["IA", "IL", "MN"]);
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
  assert.match(read("field-scout.js"), /FS_READ_SRC='\/field-scout-read\.js\?v=2'/);
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
    "scripts/probe_land_services.py", "scripts/fetch_land_sales.py", ".github/workflows/land-data.yml"]) {
    assert.ok(!read(f).includes("—"), f + " has an em dash");
  }
});
