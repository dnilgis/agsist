/* /fertilizer, the 2026-10-15 head-to-head fixes:
 *  - the USDA AMS Illinois Production Cost Report (report 3195) beside the
 *    dealer sheet, from data/fertilizer-ams.json (scripts/fetch_fert_ams.py,
 *    .github/workflows/fertilizer-ams.yml); nothing drawn until it exists
 *  - anhydrous, UAN and DAP priced in the nutrient table and the fertility
 *    bill, each product from whichever source is newer, every row labeled
 *  - no "current" claim for an old sheet; change arrows name the date they
 *    compare against; the history file holds every sheet
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const HTML = read("fertilizer.html");
const require = createRequire(import.meta.url);
const FS = require(ROOT + "components/fert-sources.js");
const DEALER = JSON.parse(read("data/fertilizer.json"));

/* made-up AMS file in the shape fetch_fert_ams.py writes; never a USDA figure */
const AMS = {
  source: "USDA AMS Illinois Production Cost Report (Bi-weekly)", report_id: "3195",
  url: "https://www.ams.usda.gov/mnreports/ams_3195.pdf", page: "https://mymarketnews.ams.usda.gov/viewReport/3195",
  report_date: "2026-10-02", terms: null,
  products: [
    { key: "anhydrous", name: "Anhydrous ammonia", symbol: "82-0-0", low: 901, high: 999, avg: 950.1, unit: "$/ton" },
    { key: "uan28", name: "UAN 28%", symbol: "28-0-0", low: 401, high: 499, avg: 450.2, unit: "$/ton" },
    { key: "urea", name: "Urea", symbol: "46-0-0", low: 601, high: 699, avg: 650.4, unit: "$/ton" },
    { key: "dap", name: "DAP", symbol: "18-46-0", low: 801, high: 899, avg: 850.5, unit: "$/ton" },
    { key: "potash", name: "Potash", symbol: "0-0-60", low: 401, high: 499, avg: 450.6, unit: "$/ton" },
  ],
};
const clone = (o) => JSON.parse(JSON.stringify(o));

/* the page's own nutrient engine, lifted from the inline script */
const JS = HTML.slice(HTML.indexOf("function fmtDate("), HTML.indexOf("var STATE="));
function engine() {
  const ctx = { Math, Number, String, isFinite, isNaN, parseFloat, Date, esc: (s) => String(s) };
  vm.createContext(ctx);
  vm.runInContext(JS, ctx);
  return ctx;
}

test("no AMS file: the calculator rows are the dealer sheet, unchanged and labeled", () => {
  for (const bad of [null, {}, { report_date: "2026-10-02", products: [] },
    { report_date: "Oct 2", products: AMS.products },
    { report_date: "2026-10-02", products: [{ key: "urea", symbol: "46-0-0", low: 601, high: 699, avg: 0 }] },
    { report_date: "2026-10-02", products: [{ key: "urea", symbol: "46-0-0", low: 601, high: 699, avg: 950 }] }]) {
    assert.equal(FS.validAms(bad), null, JSON.stringify(bad));
    assert.equal(FS.amsBox(bad, Date.now()), "", "nothing is drawn for a missing or broken AMS file");
    assert.equal(FS.coverNote(bad), "Anhydrous ammonia, UAN and DAP are not priced on this page.");
  }
  const rows = FS.merge(DEALER.prices, null);
  assert.deepEqual(rows.map((r) => [r.name, r.price, r.as_of, r.src]),
    DEALER.prices.map((p) => [p.name, p.price, p.as_of, "dealer"]));
  assert.ok(rows.every((r) => r.srcLabel.startsWith("dealer sheet, ")));
});

test("AMS file: newer source wins per product, AMS-only products join, every row says whose", () => {
  const rows = FS.merge(DEALER.prices, AMS);
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(by.Urea.price, 650.4, "AMS Oct 2 is newer than the Sep 1 dealer urea");
  assert.equal(by.Urea.srcLabel, "USDA AMS Illinois avg, Oct 2");
  assert.equal(by["MAP + Sulfur"].src, "dealer", "a product only the dealer carries stays");
  for (const n of ["Anhydrous ammonia", "UAN 28%", "DAP"]) assert.equal(by[n].src, "ams", n);
  assert.equal(rows.filter((r) => r.name === "Urea").length, 1, "urea is listed once, not once per source");
  assert.equal(rows.length, DEALER.prices.length + 3);

  const older = clone(AMS); older.report_date = "2026-08-07";
  const r2 = Object.fromEntries(FS.merge(DEALER.prices, older).map((r) => [r.name, r]));
  assert.equal(r2.Urea.price, 590, "an older AMS report does not replace a newer dealer quote");
  assert.equal(r2.Urea.srcLabel, "dealer sheet, Sep 1");
  assert.equal(r2.DAP.srcLabel, "USDA AMS Illinois avg, Aug 7");
  const tie = clone(AMS); tie.report_date = "2026-09-01";
  assert.equal(FS.merge(DEALER.prices, tie).find((r) => r.name === "Urea").src, "dealer", "a tie keeps the dealer sheet");
});

test("the USDA box quotes the report: its date, its link, average and range, no other figure", () => {
  const box = FS.amsBox(AMS, Date.parse("2026-10-15T12:00:00Z"));
  assert.match(box, /USDA Illinois average, Oct 2, 2026/);
  assert.match(box, /mymarketnews\.ams\.usda\.gov\/viewReport\/3195/);
  assert.match(box, /ams_3195\.pdf/);
  assert.match(box, /\$950<\/div>/);
  assert.match(box, /range \$901 to \$999/);
  assert.doesNotMatch(box, /days ago/, "13 days old is not flagged");
  assert.match(FS.amsBox(AMS, Date.parse("2026-11-20T12:00:00Z")), /49 days ago/);
  assert.doesNotMatch(box, /UAN 32%/, "a product the report did not give is not shown");
  assert.equal(FS.coverNote(AMS),
    "Anhydrous ammonia, UAN and DAP come from the USDA AMS Illinois report of Oct 2, 2026. Each price names its source and date.");
  const noDap = clone(AMS); noDap.products = noDap.products.filter((p) => p.key !== "dap");
  assert.match(FS.coverNote(noDap), /^Anhydrous ammonia and UAN come from .* DAP is not priced on this page\./);
});

test("the fertility bill prices anhydrous and DAP from AMS, with the math checked by hand", () => {
  const c = engine();
  const prods = c.analyze(FS.merge(DEALER.prices, AMS));
  const nS = c.cheapest(prods, "N", c.mainlyN);
  assert.equal(nS.name, "Anhydrous ammonia");
  assert.ok(Math.abs(nS.cost - 950.1 / 1640) < 1e-9, "$/lb N = price / (20 x 82)");
  const prog = c.buildProgram(prods, "corn", 180, 0.9);
  const by = Object.fromEntries(prog.lines.map((l) => [l.role.split(" ")[0], l]));
  // P: 66.6 lb P2O5 / 0.46 = 144.78 lb DAP x $0.42525 = $61.57, which also brings 26.06 lb N
  assert.equal(by.Phosphate.product, "DAP");
  assert.equal(by.Phosphate.cost.toFixed(2), "61.57");
  // N: (162 - 26.06) / 0.82 = 165.78 lb NH3 x $0.47505 = $78.75
  assert.equal(by.Nitrogen.product, "Anhydrous ammonia");
  assert.equal(by.Nitrogen.cost.toFixed(2), "78.75");
  assert.equal(by.Nitrogen.srcLabel, "USDA AMS Illinois avg, Oct 2");
  // K: 43.2 / 0.60 = 72 lb x $0.2253 = $16.22 (AMS potash, newer than the dealer's)
  assert.equal(by.Potash.cost.toFixed(2), "16.22");
  assert.equal(prog.costPerAcre.toFixed(2), "156.54");
  // without the AMS file the bill is exactly the dealer bill checked in the head-to-head report
  const dealerOnly = c.buildProgram(c.analyze(FS.merge(DEALER.prices, null)), "corn", 180, 0.9);
  assert.equal(dealerOnly.costPerAcre.toFixed(2), "185.06");
});

test("the page wires the AMS file in and draws nothing for it by default", () => {
  assert.match(HTML, /<script src="\/components\/fert-sources\.js\?v=\d+"><\/script>/);
  assert.match(HTML, /<section id="fert-ams" aria-labelledby="fert-ams-h" hidden><\/section>/);
  assert.match(HTML, /fetch\('\/data\/fertilizer-ams\.json'\)\.then\(function\(r\)\{return r\.ok\?r\.json\(\):null;\}\)/,
    "a missing AMS file is quiet, not an error");
  assert.match(HTML, /FS\.merge\(data\.prices,ams\)/, "the calculator runs on the merged rows");
  assert.match(HTML, /provTag\(l,l\.asof\)/, "each bill line names its source");
  assert.match(HTML, /provTag\(p,p\.as_of\)/, "each table row names its source");
});

test("age is honest: no 'current' for an old sheet, arrows name the date they compare against", () => {
  const ld = [...HTML.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
  assert.doesNotMatch(ld, /\bcurrent\b/i, "the 43-day-old sheet was described as 'Current US fertilizer prices'");
  assert.doesNotMatch(HTML.replace(/<script[\s\S]*?<\/script>/g, ""), /Current prices are shown on this page/);
  const c = engine();
  assert.equal(c.shortDate("2026-07-20"), "Jul 20");
  assert.match(HTML, /arrow\+' \$'\+Math\.abs\(chg\)\.toFixed\(0\)\+\(vs\?' vs '\+vs:''\)/);
});

test("the history file holds the sheet on file (the Sep 1 sheet was missing)", () => {
  const hist = JSON.parse(read("data/fertilizer-history.json"));
  const row = hist.sheets.find((s) => s.date === DEALER.updated);
  assert.ok(row, `no history row for the ${DEALER.updated} sheet`);
  for (const p of DEALER.prices) assert.equal(row.prices[p.name], p.price, p.name);
  const dates = hist.sheets.map((s) => s.date);
  assert.deepEqual(dates, [...dates].sort());
});

test("the fetcher and the updater pass their own selftests", () => {
  for (const s of ["scripts/fetch_fert_ams.py", "scripts/update_fertilizer.py"]) {
    const out = execFileSync("python3", [ROOT + s, "--selftest"], { cwd: ROOT, encoding: "utf8" });
    assert.match(out, /selftest ok/i, s);
  }
});

test("the AMS workflow selftests first, commits only its own files, and any file it wrote is real", () => {
  const wf = read(".github/workflows/fertilizer-ams.yml");
  assert.ok(wf.indexOf("fetch_fert_ams.py --selftest") < wf.indexOf("run: python scripts/fetch_fert_ams.py\n"));
  assert.match(wf, /FILES="data\/fertilizer-ams\.json data\/fertilizer-ams-history\.json data\/fert-ams-raw"/);
  if (existsSync(ROOT + "data/fertilizer-ams.json")) {
    const a = JSON.parse(read("data/fertilizer-ams.json"));
    assert.equal(a.report_id, "3195");
    assert.ok(a.fetched && a.status, "written by the fetcher, not by hand");
  }
});
