/* /fertilizer, after the 2026-10-15 rebuild:
 *  - the prices are co-op posted prices (data/fertilizer-coops.json) and,
 *    where co-ops do not cover a product, the USDA AMS Illinois report
 *    (data/fertilizer-ams.json). scripts/build_fert_prices.py picks one live
 *    source per product into data/fertilizer-prices.json, which the cheapest
 *    box, the nutrient table and the fertility bill read. Every row labeled.
 *  - the hand-typed dealer sheet (data/fertilizer.json, its history,
 *    scripts/update_fertilizer.py, fertilizer-update.yml) is gone, and
 *    nothing may read it.
 *  - the USDA box quotes the report: its date, link, average and range.
 * (Until 2026-10-15 this file tested the dealer sheet merged with AMS; those
 * tests went with the sheet.)
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
/* made-up price list in the shape build_fert_prices.py writes */
const CO = (n, k, sym, price) => ({ key: k, name: n, symbol: sym, price, unit: "$/ton", as_of: "2026-10-06", src: "coop", n: 4,
  src_label: "middle cash price of 4 co-ops, posted Sep 24, 2026 to Oct 6, 2026" });
const PRICES = { updated: "2026-10-06", prices: [
  CO("Urea", "urea", "46-0-0", 650.4), CO("Anhydrous ammonia", "anhydrous", "82-0-0", 950.1), CO("UAN 28%", "uan28", "28-0-0", 450.2),
  { key: "uan32", name: "UAN 32%", symbol: "32-0-0", price: 530, unit: "$/ton", as_of: "2026-10-02", src: "ams",
    src_label: "USDA AMS Illinois average, report of Oct 2, 2026" },
  CO("DAP", "dap", "18-46-0", 850.5), CO("Potash", "potash", "0-0-60", 450.6)] };
const clone = (o) => JSON.parse(JSON.stringify(o));

/* the page's own nutrient engine, lifted from the inline script */
const JS = HTML.slice(HTML.indexOf("function fmtDate("), HTML.indexOf("var STATE="));
function engine() {
  const ctx = { Math, Number, String, isFinite, isNaN, parseFloat, Date, esc: (s) => String(s) };
  vm.createContext(ctx);
  vm.runInContext(JS, ctx);
  return ctx;
}

test("no price file, or nothing real in it: no rows, and nothing drawn for USDA", () => {
  for (const bad of [null, {}, { prices: [] }, { prices: [{ key: "urea", name: "Urea", symbol: "46-0-0", price: 0, as_of: "2026-10-06" }] },
    { prices: [{ key: "urea", name: "Urea", symbol: "46-0-0", price: 650, as_of: "Oct 6" }] }]) {
    assert.deepEqual(FS.rows(bad), [], JSON.stringify(bad));
    assert.equal(FS.coverNote(bad), "No product has a live price right now.");
  }
  for (const bad of [null, {}, { report_date: "2026-10-02", products: [] }, { report_date: "Oct 2", products: AMS.products },
    { report_date: "2026-10-02", products: [{ key: "urea", symbol: "46-0-0", low: 601, high: 699, avg: 950 }] }]) {
    assert.equal(FS.validAms(bad), null, JSON.stringify(bad));
    assert.equal(FS.amsBox(bad, Date.now()), "", "nothing is drawn for a missing or broken AMS file");
  }
});

test("rows come from the shared price list as written, every row says whose and when", () => {
  const rows = FS.rows(PRICES);
  assert.deepEqual(rows.map((r) => [r.name, r.price, r.as_of, r.src]),
    PRICES.prices.map((p) => [p.name, p.price, p.as_of, p.src]));
  assert.equal(rows.find((r) => r.key === "uan32").srcLabel, "USDA AMS Illinois average, report of Oct 2, 2026");
  assert.ok(rows.filter((r) => r.src === "coop").every((r) => r.srcLabel.startsWith("middle cash price of 4 co-ops")));
  assert.equal(FS.coverNote(PRICES),
    "Urea, Anhydrous ammonia, UAN 28%, DAP and Potash: co-op middle cash price. UAN 32%: USDA AMS Illinois average, where co-ops do not post enough. Each price names its source and date.");
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
  // The real Oct 2 report gives UAN 32 one price (530 to 530): say so instead of "range $530 to $530".
  const one = clone(AMS); one.products = one.products.map((p) => p.key === "dap" ? { ...p, low: 930, high: 930, avg: 930 } : p);
  one.terms = "Distributor (Dollars Per Ton)";
  const oneBox = FS.amsBox(one, Date.parse("2026-10-15T12:00:00Z"));
  assert.match(oneBox, /one price reported/);
  assert.doesNotMatch(oneBox, /range \$930 to \$930/);
  assert.match(oneBox, /Its prices are labeled &ldquo;Distributor \(Dollars Per Ton\)&rdquo;\./);
});

test("the fertility bill prices from the shared list, with the math checked by hand", () => {
  const c = engine();
  const prods = c.analyze(FS.rows(PRICES));
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
  assert.equal(by.Nitrogen.srcLabel, "middle cash price of 4 co-ops, posted Sep 24, 2026 to Oct 6, 2026");
  // K: 43.2 / 0.60 = 72 lb x $0.2253 = $16.22
  assert.equal(by.Potash.cost.toFixed(2), "16.22");
  assert.equal(prog.costPerAcre.toFixed(2), "156.54");
  // no potash price: the bill says so instead of using an old number
  const noK = c.buildProgram(c.analyze(FS.rows({ prices: PRICES.prices.filter((p) => p.key !== "potash") })), "corn", 180, 0.9);
  assert.ok(noK.missing.includes("potash source"));
});

test("the page wires the three files in and draws nothing for a missing one", () => {
  assert.match(HTML, /<script src="\/components\/fert-sources\.js\?v=\d+"><\/script>/);
  assert.match(HTML, /<section id="fert-ams" aria-labelledby="fert-ams-h" hidden><\/section>/);
  assert.match(HTML, /<section id="fert-coops" aria-labelledby="fert-coops-h" hidden><\/section>/);
  for (const f of ["fertilizer-coops", "fertilizer-ams", "fertilizer-prices"]) assert.ok(HTML.includes(`getJ('/data/${f}.json')`), f);
  assert.match(HTML, /function getJ\(u\)\{return fetch\(u\)\.then\(function\(r\)\{return r\.ok\?r\.json\(\):null;\}\)\.catch\(function\(\)\{return null;\}\);\}/,
    "a missing file is quiet, not an error");
  assert.match(HTML, /var rows=FS\.rows\(prices\);/, "the calculator runs on the shared list");
  assert.match(HTML, /provTag\(l,l\.asof\)/, "each bill line names its source");
  assert.match(HTML, /provTag\(p,p\.as_of\)/, "each table row names its source");
  // co-op prices lead the page: the co-op cards come before the USDA box
  assert.ok(HTML.indexOf('id="fert-coops"') < HTML.indexOf('id="fert-ams"'));
  assert.ok(HTML.indexOf('id="fert-coops"') < HTML.indexOf('id="fert-verdict"'));
});

test("the dealer sheet is gone: no file, no reader, no 'dealer quotes' claim", () => {
  for (const f of ["data/fertilizer.json", "data/fertilizer-history.json", "scripts/update_fertilizer.py", ".github/workflows/fertilizer-update.yml"]) {
    assert.ok(!existsSync(ROOT + f), f + " is back");
  }
  const ld = [...HTML.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
  assert.doesNotMatch(ld, /\bcurrent\b/i, "the 43-day-old sheet was described as 'Current US fertilizer prices'");
  assert.match(ld, /"contentUrl":"https:\/\/agsist\.com\/data\/fertilizer-prices\.json"/);
  assert.doesNotMatch(HTML.replace(/<!--[\s\S]*?-->/g, ""), /dealer quotes?|dealer sheet|collected by hand/i);
  const c = engine();
  assert.equal(c.shortDate("2026-07-20"), "Jul 20");
});

test("the readers and builders pass their own selftests", () => {
  for (const s of ["scripts/fetch_fert_ams.py", "scripts/fetch_coop_fert.py", "scripts/build_fert_prices.py", "scripts/bake_fert_defaults.py"]) {
    const out = execFileSync("python3", [ROOT + s, "--selftest"], { cwd: ROOT, encoding: "utf8" });
    assert.match(out, /selftest ok/i, s);
  }
});

test("both fertilizer workflows selftest first, then rebuild the shared list and every baked page", () => {
  const wf = read(".github/workflows/fertilizer-ams.yml");
  assert.ok(wf.indexOf("fetch_fert_ams.py --selftest") < wf.indexOf("run: python scripts/fetch_fert_ams.py\n"));
  assert.match(wf, /FILES="data\/fertilizer-ams\.json data\/fertilizer-ams-history\.json data\/fert-ams-raw"/);
  for (const f of [".github/workflows/fertilizer-ams.yml", ".github/workflows/fertilizer-coops.yml"]) {
    const w = read(f);
    assert.match(w, /build_fert_prices\.py --selftest/, f);
    assert.match(w, /bash scripts\/fert_after_prices\.sh/, f);
    assert.match(w, /BAKED="data\/fertilizer-prices\.json fertilizer\.html breakeven\.html manure-value\.html fast-facts\.html img\/og"/, f);
  }
  const sh = read("scripts/fert_after_prices.sh");
  for (const step of ["build_fert_prices.py", "bake_fert_defaults.py", "bake_manure_value.mjs", "bake_seo.py --page fertilizer.html", "bake_seo.py --page breakeven.html", "build_share_images.py --only manure-value,fertilizer"]) {
    assert.ok(sh.includes(step), step);
  }
  if (existsSync(ROOT + "data/fertilizer-ams.json")) {
    const a = JSON.parse(read("data/fertilizer-ams.json"));
    assert.equal(a.report_id, "3195");
    assert.ok(a.fetched && a.status, "written by the fetcher, not by hand");
  }
});
