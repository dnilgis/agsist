/* The /prf panel fixes of Nov 9, 2026 (notes/panels prf skeptic, section 4), each pinned on the real case it was
 * found on. No browser needed: the panel's own helpers run in a vm, and the pages are read as files.
 *
 *   node --test test/prf-panel-nov9.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const box = { window: {}, Buffer };
for (const f of ["prf-math", "prf-optimize", "prf-optimize-ui"]) vm.runInNewContext(read(`components/${f}.js`), box);
const O = box.window.AgPrfOptimize, U = box.window.AgPrfOptUI;
const OPT = JSON.parse(read("data/prf/opt.json"));
const FX = JSON.parse(read("test/fixtures/prf/opt-grid-28914.json"));
const lim = FX.lim;
const INPUT = { index: FX.index, rates: FX.rates[90], coverage: 90, subsidy: FX.subsidy["90"], min: lim.map((p) => (p ? p[0] : null)),
  max: lim.map((p) => (p ? p[1] : null)), valid: lim.map(Boolean), avgMm: FX.avgMm, lastComplete: FX.last_complete, grid: FX.grid };

test("fix 1: the real outlook.json shape ({status, issued}) prints CPC's status, and the 28914 pick does not move", () => {
  const real = { enso: { status: "El Nino Advisory", issued: "2026-10-08" } };
  const line = U.ensoLine(real.enso, OPT);
  assert.equal(line, "NOAA’s Climate Prediction Center: El Nino Advisory, Oct 8. Our test across grids found no edge from El Niño or La Niña, so it does not move the pick.");  // pin-ok: inline fixture `real` two lines up
  assert.equal(OPT.predictors.enso.kept, false, "the published test rejects ENSO; if that changes, this wording must change");
  const o = O.outlookFor(real, FX.grid);
  assert.equal(o.enso, null, "a status is never turned into a phase that tilts the pick");
  const plain = O.recommend(INPUT, { objective: "net" });
  assert.deepEqual(Array.from(plain.rec.split), [0, 30, 0, 0, 0, 0, 0, 0, 0, 70, 0], "grid 28914's pick, as the panel saw it");
  assert.ok(!plain.forecast, "no forecast pick from the real file");
  /* the shipped file is the case */
  const shipped = JSON.parse(read("data/prf/outlook.json")).enso;
  if (shipped && shipped.status) assert.match(U.ensoLine(shipped, OPT), /Advisory|Watch|Not Active|La Ni|El Ni/);
});

test("fix 1: no reader-set ENSO choice, and the header no longer claims a current outlook (Sig, Nov 9)", () => {
  const ui = read("components/prf-optimize-ui.js");
  assert.ok(!ui.includes("prf-opt-enso"), "the El Nino or La Nina select is gone");
  assert.ok(!/history and current outlook/.test(ui + read("scripts/make_prf_html.py") + read("prf.html")), "header wording");
  assert.match(U.NOTE, /history and the rates point to, not advice/);
  /* the engine still names the reading when a caller passes one */
  const r = O.recommend(INPUT, { objective: "net", enso: "el-nino" });
  assert.ok(r.forecast.notes.some((t) => /^The El Niño or La Niña reading (moved|did not change)/.test(t)), r.forecast.notes.join(" | "));
});

test("fix 2: the steadier line compares against the pick on the card (28914 with El Nino: 61, not 54)", () => {
  const r = O.recommend(INPUT, { objective: "net", steadier: true, enso: "el-nino" });
  assert.ok(r.forecast && r.steadier, "the case has both a forecast pick and a steadier option");
  const w = U.steadierWords(r.forecast, r.steadier);
  assert.equal(w.paid, "Paid in 70 of 75 years here, against 61 for the pick.");
  const gap = 100 * (r.forecast.record.mean - r.steadier.record.mean);
  assert.ok(gap < 0 && w.gap.endsWith(" more"), "beside the shown pick the steadier option averages more, not $0.46 less: " + w.gap);
  assert.equal(U.steadierWords(r.rec, r.steadier).paid, "Paid in 70 of 75 years here, against 54 for the pick.", "the record-alone pick keeps its own count");
  assert.ok(/steadierWords\(pk, st\)/.test(read("components/prf-optimize-ui.js")), "the card passes the pick it shows");
});

test("fix 3: the cancellation date prints from meta.json with its year; the unsourced termination date is left as it was", () => {
  const meta = JSON.parse(read("data/prf/meta.json")), h = read("prf.html");
  const [y, m, d] = meta.dates.cancellation.split("-").map(Number);
  const long = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] + " " + d + ", " + y;
  assert.ok(h.includes(`<li><span class="d"><!--prf:cancel_long-->${long}<!--/prf:cancel_long--></span><span>Cancellation date. To drop the policy or stop it renewing, tell your agent by this date.</span></li>`), long);
  assert.ok(!/cancel[^]{0,80}in writing/i.test(h), "'in writing' is not printed: unverified");
});

test("fix 4 and Sig's item 3: one name for the fee, the $30 and the beginning-farmer points as RMA states them", () => {
  const h = read("prf.html"), js = read("components/prf.js");
  assert.ok(!/policy fee/.test(h + js), "the fee has one name: administrative fee");
  assert.ok(h.includes("plus an administrative fee of $30 per crop per county for buy-up coverage, which beginning and veteran farmers and ranchers do not pay"));
  assert.ok(h.includes("15 more points in their first two crop years, 13 in the third, 11 in the fourth and 10 in years five through ten, from the 2027 crop year for PRF"));
  assert.equal((h.match(/check with your agent for your policy/gi) || []).length, 1, "said once");
  assert.ok(!/beginning|veteran/i.test(js.replace(/Beginning and veteran farmers get a larger share\./, "")), "the calculator does not model the points (no new modeling)");
});

test("fix 6: the Normal column counts rated grids only, and the dry-two line names what it counts", { timeout: 120000 }, async () => {
  const { execFileSync } = await import("node:child_process");
  const f = JSON.parse(execFileSync("node", [ROOT + "scripts/prf_facts.mjs", "--print"], { cwd: ROOT, maxBuffer: 64 << 20 }).toString());
  const n = f.intervals_at_90.map((r) => r.mid_normal_in);
  assert.equal(n[3], 5.87, "Apr-May over rated grids (5.77 over all 13,414)");
  assert.equal(n[4], 6.79, "May-Jun over rated grids (6.57 over all)");
  assert.equal(n[5], 6.24); assert.equal(n[6], 5.71);
  assert.ok(f.intervals_at_90.every((r) => r.grids > 0));
  assert.match(f.largest_net_in_two_driest.what, /average payment less your share of the premium/);
  const h = read("prf.html");
  assert.ok(h.includes("grids, the interval with the most average payment after your share of the premium is one of the grid&rsquo;s two driest."));
  assert.ok(!/brings the most of USDA&rsquo;s share is one of/.test(h), "the old label counted another measure");
});

const OPEN = /<details\b[^>]*>\s*<summary\b[^>]*>(?:<h2\b[^>]*>)?\s*Sources and terms\s*</g;
test("fix 7: /prf has one closed Sources and terms fold, the last thing in main, with no formula block", () => {
  const h = read("prf.html"), main = h.slice(h.indexOf('<main'), h.indexOf("</main>"));
  const m = [...main.matchAll(OPEN)];
  assert.equal(m.length, 1);
  assert.ok(!/\bopen\b/.test(m[0][0].slice(0, m[0][0].indexOf(">"))), "closed on load");
  const after = main.slice(main.indexOf("</details>", m[0].index) + 10).replace(/<\/?div[^>]*>|\s/g, "");
  assert.equal(after, "", "nothing after the fold in main: " + after.slice(0, 80));
  assert.ok(!/<pre class="prf-math"/.test(h) && !/interval premium\s+=/.test(h), "the formula block is cut");
  const fold = main.slice(m[0].index);
  for (const keep of ["Actuarial Data Master", "Census Bureau", "GeoNames", "Last checked against RMA", "Hawaii", "agent locator"]) assert.ok(fold.includes(keep), keep + " kept, inside the fold");
  assert.ok(!/<p class="prf-byline">[^<]*(?:<a[^>]*>[^<]*<\/a>[^<]*)*Last checked against RMA/.test(h), "the check line left the byline for the fold");
  assert.match(read("components/prf.js"), /wide && !d\.classList\.contains\('prf-terms'\)/, "wide screens do not open it");
});

test("fix 7: the state pages and how-prf-works get the fold from the builder, last in main, and the page bytes do not grow", () => {
  const b = read("scripts/build_prf_states.py");
  assert.equal((b.match(/\{terms\(f"Figures from USDA RMA/g) || []).length, 2, "the fold on the state page and the guide");
  assert.match(b, /<details class="prf-terms"><summary>Sources and terms<\/summary><p>\{body\}<\/p><\/details>/);
  for (const pg of [b.slice(b.indexOf("def page("), b.indexOf("def dollars(")), b.slice(b.indexOf("def guide("), b.indexOf("def main("))]) {
    const tail = pg.slice(pg.indexOf("{terms("), pg.indexOf("</main>"));
    assert.ok(/^\{terms\([^\n]*\)\}\n  <\/div>\n  $/.test(tail), "the fold closes main: " + tail.slice(-60));
    assert.ok(!/Figures from USDA RMA[^\n]*\n[^\n]*<p class="prf-byline">/.test(pg));
  }
  assert.ok(!/middle grid for the pair<\/th>/.test(b), "the repeated column words are cut (bytes for the fold)");
  assert.ok(!b.includes("Productivity Factor ({cy}) | AGSIST"), "how-prf-works title is short");
  const title = /title = "([^"]+)"/.exec(b.slice(b.indexOf("def guide(")))[1];
  assert.ok(title.length <= 65, title.length + ": " + title);
});

test("fix 9: the small items", () => {
  const js = read("components/prf.js"), ui = read("components/prf-optimize-ui.js"), now = read("components/prf-now.js"), h = read("prf.html");
  assert.ok(js.includes("' an acre of protection' + (S.share < 100 ? ', before your share' : '')"), "per-acre protection says it leaves the share out");
  assert.ok(now.includes("'Already above: won’t pay'") && !now.includes("'Already there'"));
  assert.ok(ui.includes('<th scope="col">Average after premium, in the years the pick was chosen from</th>'), "compare column says the figure is in-sample");
  assert.ok(h.includes('"name": "PRF insurance calculator", "item": "https://agsist.com/prf"') && !h.includes("PRF rainfall insurance\""), "one name in the breadcrumb");
  assert.ok(!/\$\('prf-q'\)\.blur\(\)/.test(js), "Find no longer drops focus to the body");
  assert.match(js, /var h = \$\('prf-where-h'\); h\.setAttribute\('tabindex', '-1'\); try \{ h\.focus\(/);
});

test("Sig, Nov 9: the calculator opens on non-irrigated haying, grazing still offered", () => {
  const js = read("components/prf.js");
  const order = JSON.parse(/var USE_ORDER = (\[[^\]]+\])/.exec(js)[1]);
  const combos = JSON.parse(read("data/prf/s/SD.json")).combos;
  assert.equal(combos[order[0]], "Haying, non-irrigated");
  assert.equal(combos[order[1]], "Haying, irrigated");
  assert.equal(combos[order[2]], "Grazing", "grazing is the fallback where no hay is offered");
  assert.match(js, /use: USE_DEFAULT,/);
  assert.match(js, /for \(var i = 0; i < USE_ORDER\.length; i\+\+\) if \(c\.b\[USE_ORDER\[i\]\] != null\)/);
  assert.equal(new Set(order).size, combos.length, "every use stays selectable");
});
