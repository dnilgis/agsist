/* /fertilizer: the middle-price trend line (components/fert-trend.js) and the
 * fertility bill's reader-picked P and N sources and own application cost.
 * Hand-worked replays, a frozen copy of the record checked against the
 * reader's own summary for that day, and the calculator against a hand-worked
 * bill. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const require = createRequire(import.meta.url);
const T = require(ROOT + "components/fert-trend.js");
const HTML = read("fertilizer.html");

const R = (seen, coop, prod, raw, cash, date, flag) => [seen, coop, prod, raw, cash, "cash", date].concat(flag ? ["flagged"] : []);

test("replay: middle per day, withheld under 2 co-ops, set changes named", () => {
  const h = { rows: [
    R("2026-10-01", "a", "urea", "46-0-0", 600, "2026-09-30"),
    R("2026-10-01", "b", "urea", "UREA", 640, "2026-09-29"),
    R("2026-10-01", "a", "dap", "18-46-0", 900, "2026-09-30"),
    R("2026-10-05", "b", "urea", "UREA", 620, "2026-10-04"),         // b moves: 600/620 -> 610
    R("2026-10-07", "c", "urea", "46-0-0", 700, "2026-10-06"),       // c joins: 600/620/700 -> 620
    R("2026-10-09", "c", "urea", "46-0-0", null, null),              // c stops posting it
    R("2026-10-09", "a", "urea", "46-0-0 bulk", 590, "2026-10-08"),  // a's second urea line: the first listed wins
  ] };
  const s = T.series(h, "2026-10-09");
  const u = s.products.urea.map((p) => [p.date, p.n, p.mid]);
  assert.deepEqual(u, [["2026-10-01", 2, 620], ["2026-10-05", 2, 610], ["2026-10-07", 3, 620], ["2026-10-09", 2, 610]]);
  assert.deepEqual(s.products.urea[2].added, ["c"]);
  assert.deepEqual(s.products.urea[3].dropped, ["c"]);
  const d = s.products.dap;
  assert.equal(d.length, 1);
  assert.equal(d[0].withheld, true, "one co-op: no middle");
  assert.equal(d[0].mid, null);
  assert.match(T.html(s, null), /withheld/);
  assert.match(T.html(s, null), /fewer than 2 co-ops/i);
});

test("replay: undated, flagged and over-60-day prices are not counted; the day one ages out is a point", () => {
  const h = { rows: [
    R("2026-08-01", "a", "potash", "0-0-60", 450, "2026-08-01"),
    R("2026-08-01", "b", "potash", "0-0-60", 470, "2026-08-01"),
    R("2026-08-01", "c", "potash", "0-0-60", 999, null),
    R("2026-08-01", "d", "potash", "0-0-60", 10, "2026-08-01", true),
    R("2026-09-15", "b", "potash", "0-0-60", 480, "2026-09-15"),
  ] };
  const s = T.series(h, "2026-10-15");
  const p = s.products.potash.map((x) => [x.date, x.n, x.mid]);
  // a (Aug 1) is 61 days old on Oct 1: out, and b alone is withheld
  assert.deepEqual(p, [["2026-08-01", 2, 460], ["2026-09-15", 2, 465], ["2026-10-01", 1, null]]);
  assert.equal(T.median([1, 2, 3, 4]), 2.5);
  assert.equal(T.median([608, 615.95, 630, 840]), 622.98);
});

test("frozen record (Oct 15 to 16, 2026): the replay equals the reader's own summary that day", () => {
  const h = JSON.parse(read("test/fixtures/fert-trend/history-2026-10-16.json"));
  const c = JSON.parse(read("test/fixtures/fert-trend/coops-2026-10-16.json"));
  const D = c.generated.slice(0, 10);
  for (const x of c.summary) {
    const p = T.pointAt(h.rows, x.key, D);
    assert.equal(p.n, x.n, x.key);
    assert.equal(p.mid, x.median, x.key);
    assert.deepEqual(p.coops, x.coops.slice().sort(), x.key);
  }
  const s = T.series(h, D);
  const u = s.products.urea;
  assert.deepEqual(u.map((p) => [p.date, p.n, p.mid]), [["2026-10-15", 4, 622.98], ["2026-10-16", 5, 615.95]]);
  assert.deepEqual(u[1].added, ["synergy-wi"], "the Oct 16 move is a new co-op, and the point says so");
  const out = T.html(s, c);
  assert.match(out, /added Synergy Cooperative/);
  assert.match(out, /class="ft-set"/, "the co-op set change is marked on the line");
  assert.ok(!out.includes("—"), "no em dashes");
});

test("the record loads only when the reader opens the box", () => {
  assert.match(HTML, /<details class="fert-trend" id="fert-trend">/);
  assert.match(HTML, /\/components\/fert-trend\.js\?v=1" defer/);
  assert.ok(!HTML.includes("fertilizer-coops-history.json"), "the page itself never fetches the record");
  const js = read("components/fert-trend.js");
  const toggle = js.indexOf("addEventListener('toggle'");
  assert.ok(toggle > 0 && js.indexOf("/data/fertilizer-coops-history.json") > toggle, "fetched inside the toggle handler");
  assert.ok(!js.includes("—"));
});

/* the page's own nutrient engine, lifted from the inline script */
const JS = HTML.slice(HTML.indexOf("function fmtDate("), HTML.indexOf("var STATE="));
function engine() {
  const ctx = { Math, Number, String, isFinite, isNaN, parseFloat, Date, esc: (s) => String(s) };
  vm.createContext(ctx);
  vm.runInContext(JS, ctx);
  return ctx;
}
const P = (name, symbol, price) => ({ name, symbol, price, as_of: "2026-10-06", srcLabel: "x" });
const LIST = [P("Urea", "46-0-0", 650.4), P("Anhydrous ammonia", "82-0-0", 950.1), P("UAN 28%", "28-0-0", 450.2),
  P("DAP", "18-46-0", 850.5), P("MAP", "11-52-0", 980), P("Potash", "0-0-60", 450.6)];

test("calculator: the reader's P and N picks are priced, DAP's N credited (hand-worked)", () => {
  const e = engine();
  const prods = e.analyze(LIST);
  const g = e.buildProgram(prods, "corn", 180, 0.9, { P: "DAP", N: "Anhydrous ammonia" });
  // P2O5 0.38 x 180 = 68.4 lb: 68.4 / 920 = 0.07435 ton DAP x $850.50 = $63.23, bringing 26.77 lb N
  // N 162 - 26.77 = 135.23 lb: / 1640 = 0.08246 ton NH3 x $950.10 = $78.35
  // K2O 0.29 x 180 = 52.2 lb: / 1200 = 0.0435 ton potash x $450.60 = $19.60. Total $161.18
  const by = Object.fromEntries(g.lines.map((l) => [l.role.slice(0, 3), l]));
  assert.equal(by.Pho.product, "DAP"); assert.equal(by.Pho.picked, true);
  assert.equal(by.Nit.product, "Anhydrous ammonia"); assert.equal(by.Nit.picked, true);
  assert.ok(Math.abs(by.Pho.cost - 63.23) < 0.01);
  assert.ok(Math.abs(by.Nit.cost - 78.35) < 0.01);
  assert.ok(Math.abs(g.costPerAcre - 161.18) < 0.01);
  const auto = e.buildProgram(prods, "corn", 180, 0.9, {});
  assert.ok(auto.lines.every((l) => !l.picked), "no pick: cheapest per lb, said so");
  const bad = e.buildProgram(prods, "corn", 180, 0.9, { N: "MAP" });
  assert.notEqual(bad.lines.find((l) => /^Nitrogen/.test(l.role)).product, "MAP", "a P product is never a nitrogen pick");
  assert.deepEqual(Array.from(e.sourcesFor(prods, "N")), ["Urea", "Anhydrous ammonia", "UAN 28%"]);
  assert.deepEqual(Array.from(e.sourcesFor(prods, "P")), ["DAP", "MAP"]);
});

test("calculator: application cost is the reader's own, with no default from us", () => {
  assert.match(HTML, /<input id="calc-app" type="number"[^>]*value=""/);
  assert.match(HTML, /AGSIST does not supply an application cost/);
  assert.ok(!/Applying it costs more than spreading urea/.test(HTML), "the uncited claim is gone");
  assert.match(HTML, /<select id="calc-psrc">/);
  assert.match(HTML, /<select id="calc-nsrc">/);
});

test("phone: the cost-per-pound table is one line per product with no n/a cells", () => {
  assert.match(HTML, /@media\(max-width:560px\)\{\.fert-nutrient>\.fert-nutrient-table thead\{display:none\}/);
  assert.match(HTML, /\.fert-nutrient>\.fert-nutrient-table td\.na:not\(\.nq\)\{display:none\}/);
});
