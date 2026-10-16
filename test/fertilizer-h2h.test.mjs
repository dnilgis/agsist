/* /fertilizer, after the 2026-10-15 rebuild:
 *  - the prices are the co-op posted prices Sig sent (data/fertilizer-coops.json)
 *    and nothing else: scripts/build_fert_prices.py writes the middle cash
 *    price per product into data/fertilizer-prices.json, which the cheapest
 *    box, the nutrient table and the fertility bill read. Every row labeled
 *    with its co-ops, region and date.
 *  - no USDA AMS Illinois figure on the page at all (Sig, 2026-10-16: "remove
 *    the illinois report from the fert page"): no box, no copy, no fetch.
 *  - the hand-typed dealer sheet (data/fertilizer.json, its history,
 *    scripts/update_fertilizer.py, fertilizer-update.yml) is gone, and
 *    nothing may read it.
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

/* made-up price list in the shape build_fert_prices.py writes */
const CO = (n, k, sym, price) => ({ key: k, name: n, symbol: sym, price, unit: "$/ton", as_of: "2026-10-06", src: "coop", n: 4,
  region: "Kansas", src_label: "Kansas co-ops, middle of 4, posted Oct 6, 2026" });
const PRICES = { updated: "2026-10-06", prices: [
  CO("Urea", "urea", "46-0-0", 650.4), CO("Anhydrous ammonia", "anhydrous", "82-0-0", 950.1), CO("UAN 28%", "uan28", "28-0-0", 450.2),
  { key: "uan32", name: "UAN 32%", symbol: "32-0-0", price: 530, unit: "$/ton", as_of: "2026-09-24", src: "coop", n: 1,
    region: "Kansas", src_label: "Farmers Coop, Kansas, posted Sep 24, 2026" },
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

test("no price file, or nothing real in it: no rows", () => {
  for (const bad of [null, {}, { prices: [] }, { prices: [{ key: "urea", name: "Urea", symbol: "46-0-0", price: 0, as_of: "2026-10-06" }] },
    { prices: [{ key: "urea", name: "Urea", symbol: "46-0-0", price: 650, as_of: "Oct 6" }] }]) {
    assert.deepEqual(FS.rows(bad), [], JSON.stringify(bad));
    assert.equal(FS.coverNote(bad), "No product has a live price right now.");
  }
});

test("rows come from the shared price list as written, every row says whose and when", () => {
  const rows = FS.rows(PRICES);
  assert.deepEqual(rows.map((r) => [r.name, r.price, r.as_of, r.src]),
    PRICES.prices.map((p) => [p.name, p.price, p.as_of, p.src]));
  assert.equal(rows.find((r) => r.key === "uan32").srcLabel, "Farmers Coop, Kansas, posted Sep 24, 2026", "one co-op: named");
  assert.ok(rows.filter((r) => r.key !== "uan32").every((r) => r.srcLabel === "Kansas co-ops, middle of 4, posted Oct 6, 2026"));
  assert.equal(FS.coverNote(PRICES),
    "Urea, Anhydrous ammonia, UAN 28%, UAN 32%, DAP and Potash: Kansas co-ops\u2019 middle cash price. Each price names its co-ops, region and date.");
  assert.ok(!FS.coverNote(PRICES).includes("&"), "the note is set as text: no HTML entity shows on the page");
});

test("no USDA AMS Illinois figure on /fertilizer: no box, no copy, no fetch, no code to draw one", () => {
  assert.ok(!HTML.includes("fertilizer-ams"), "the page loads the USDA file");
  assert.ok(!/id="fert-ams"/.test(HTML), "the USDA box is back");
  const text = HTML.replace(/<!--[\s\S]*?-->/g, " ").replace(/href="[^"]*"/g, " ");
  assert.doesNotMatch(text, /USDA AMS|Illinois|ams\.usda\.gov|Production Cost Report/i);
  assert.equal(FS.validAms, undefined);
  assert.equal(FS.amsBox, undefined);
});

test("the fertility bill prices from the shared list, with the math checked by hand", () => {
  const c = engine();
  const prods = c.analyze(FS.rows(PRICES));
  const nS = c.cheapest(prods, "N", c.mainlyN);
  assert.equal(nS.name, "Anhydrous ammonia");
  assert.ok(Math.abs(nS.cost - 950.1 / 1640) < 1e-9, "$/lb N = price / (20 x 82)");
  const prog = c.buildProgram(prods, "corn", 180, 0.9);
  const by = Object.fromEntries(prog.lines.map((l) => [l.role.split(" ")[0], l]));
  // Removal per bu from UW A2809 Table 4.2 (corn 0.38 P2O5, 0.29 K2O), synced with /nutrient-removal Oct 16.
  // P: 68.4 lb P2O5 / 0.46 = 148.70 lb DAP x $0.42525 = $63.23, which also brings 26.77 lb N
  assert.equal(by.Phosphate.product, "DAP");
  assert.equal(by.Phosphate.cost.toFixed(2), "63.23");
  // N: (162 - 26.77) / 0.82 = 164.92 lb NH3 x $0.47505 = $78.35
  assert.equal(by.Nitrogen.product, "Anhydrous ammonia");
  assert.equal(by.Nitrogen.cost.toFixed(2), "78.35");
  assert.equal(by.Nitrogen.srcLabel, "Kansas co-ops, middle of 4, posted Oct 6, 2026");
  // K: 52.2 / 0.60 = 87 lb x $0.2253 = $19.60
  assert.equal(by.Potash.cost.toFixed(2), "19.60");
  assert.equal(prog.costPerAcre.toFixed(2), "161.18");
  // no potash price: the bill says so instead of using an old number
  const noK = c.buildProgram(c.analyze(FS.rows({ prices: PRICES.prices.filter((p) => p.key !== "potash") })), "corn", 180, 0.9);
  assert.ok(noK.missing.includes("potash source"));
});

test("the page wires the two files in and draws nothing for a missing one", () => {
  assert.match(HTML, /<script src="\/components\/fert-sources\.js\?v=\d+"><\/script>/);
  assert.match(HTML, /<section id="fert-coops" aria-labelledby="fert-coops-h" hidden><\/section>/);
  for (const f of ["fertilizer-coops", "fertilizer-prices"]) assert.ok(HTML.includes(`getJ('/data/${f}.json')`), f);
  assert.match(HTML, /function getJ\(u\)\{return fetch\(u\)\.then\(function\(r\)\{return r\.ok\?r\.json\(\):null;\}\)\.catch\(function\(\)\{return null;\}\);\}/,
    "a missing file is quiet, not an error");
  assert.match(HTML, /var rows=FS\.rows\(prices\);/, "the calculator runs on the shared list");
  assert.match(HTML, /provTag\(l,l\.asof\)/, "each bill line names its source");
  assert.match(HTML, /provTag\(p,p\.as_of\)/, "each table row names its source");
  // co-op prices lead the page
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

test("the co-op workflow selftests first, then rebuilds the shared list and every baked page; USDA feeds none of it", () => {
  const wf = read(".github/workflows/fertilizer-ams.yml");
  assert.ok(wf.indexOf("fetch_fert_ams.py --selftest") < wf.indexOf("run: python scripts/fetch_fert_ams.py\n"));
  // main gets the feed only; the probe's raw text goes to the raw branch (never deployed)
  assert.match(wf, /FILES="data\/fertilizer-ams\.json data\/fertilizer-ams-history\.json"/);
  assert.match(wf, /bash scripts\/push_raw\.sh "fertilizer-ams probe" data\/fert-ams-raw\n/);
  assert.doesNotMatch(wf, /fert_after_prices|build_fert_prices/, "the USDA job must not rebuild the price list");
  const w = read(".github/workflows/fertilizer-coops.yml");
  assert.match(w, /build_fert_prices\.py --selftest/);
  assert.match(w, /bash scripts\/fert_after_prices\.sh/);
  assert.match(w, /BAKED="data\/fertilizer-prices\.json fertilizer\.html breakeven\.html manure-value\.html fast-facts\.html img\/og"/);
  assert.doesNotMatch(w, /discover/i, "nothing searches for co-ops (Sig, 2026-10-15)");
  assert.doesNotMatch(read("scripts/build_fert_prices.py"), /fertilizer-ams\.json/, "the price list reads only the co-op file");
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
