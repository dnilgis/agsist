/* The ARC or PLC calculator math (components/arc-plc.js) and the files it
 * reads (data/arc-plc.json and data/arc-plc/<ST>.json, built by
 * scripts/build_arc_plc.py from USDA NASS prices and FSA's official county file).
 *
 * The shipped file is run in a bare context (no document), which loads only
 * the math, so a green run checks the copy the browser runs. Every expected
 * value below was worked by hand; the arithmetic is in the comment beside it.
 *
 *   node --test test/arc-plc.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { window: {} };
vm.runInNewContext(readFileSync(ROOT + "components/arc-plc.js", "utf8"), ctx);
const A = ctx.window.AgArcPlc;
const fctx = { window: {} };
vm.runInNewContext(readFileSync(ROOT + "components/arc-plc-simple.js", "utf8"), fctx);
const F = fctx.window.AgArcFind;
const D = JSON.parse(readFileSync(ROOT + "data/arc-plc.json", "utf8"));
const near = (a, b, msg, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);
const one = (erp, bp, loan, py, by, y) => ({ erp, bp, loan, py, parts: [{ w: 1, by, y }] });
const text = (c) => Array.from(A.rangeText(A.ranges(c)));
const state = (st) => {
  const p = ROOT + `data/arc-plc/${st}.json`;
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
};

test("PLC rate: ERP minus the higher of price or loan rate, never below zero", () => {
  near(A.plcRate(4.34, 4.0, 2.42), 0.34, "4.34 - 4.00");
  near(A.plcRate(4.34, 2.0, 2.42), 1.92, "under the loan rate pays down to the loan rate: 4.34 - 2.42");
  assert.equal(A.plcRate(4.34, 4.5, 2.42), 0);
});

test("ARC-CO rate: 90% guarantee, 12% cap, loan-rate floor", () => {
  // BR 180 x 4.96 = 892.80; G 803.52; actual 162 x 4.00 = 648.00; shortfall 155.52 > cap 107.136
  near(A.arcRate(180, 4.96, 162, 4.0, 2.42), 107.136, "capped");
  // 803.52 - 170 x 4.40 = 55.52
  near(A.arcRate(180, 4.96, 170, 4.4, 2.42), 55.52, "uncapped");
  assert.equal(A.arcRate(180, 4.96, 180, 4.47, 2.42), 0);
  near(A.arcRate(180, 4.96, 170, 1.0, 2.42), 107.136, "loan floor then cap");
});

test("cents round half up, as the build script does", () => {
  assert.equal(A.cents(0.125), 13);
  assert.equal(A.cents(27.455), 2746); // 27.455 is 27.45499.. in binary: +0.5 then floor still gives 2746
});

test("both years' ERPs and benchmark prices re-derive from the built file's own inputs", () => {
  const exp = { 2026: { corn: [4.42, 5.03], soybeans: [10.71, 12.17], wheat: [6.35, 6.98] },
                2027: { corn: [4.34, 4.96], soybeans: [10.62, 12.11], wheat: [6.35, 6.98] } };
  for (const [y, crops] of Object.entries(exp)) {
    assert.deepEqual(Array.from(D.years[y].window), [y - 6, y - 5, y - 4, y - 3, y - 2]);
    for (const [k, [erp, bp]] of Object.entries(crops)) {
      const c = D.years[y].crops[k];
      const myas = D.years[y].window.map((yr) => c.mya[String(yr)]);
      assert.equal(A.erpCalc(myas, c.statutory, 0.88, 1.15), c.erp.erp, `${y} ${k} ERP JS vs build`);
      assert.equal(c.erp.erp, erp, `${y} ${k} ERP by hand`);
      assert.equal(A.benchmarkPrice(myas, c.erp.erp), c.bp.value, `${y} ${k} benchmark JS vs build`);
      assert.equal(c.bp.value, bp, `${y} ${k} benchmark by hand`);
    }
  }
  // 2027 corn: 6.00, 6.54, 4.55, 4.24, 4.16; drop 6.54 and 4.16; (6.00+4.55+4.24)/3 = 4.93; x 0.88 = 4.3384
  // 2026 corn: 4.53, 6.00, 6.54, 4.55, 4.24; drop 6.54 and 4.24; (4.53+6.00+4.55)/3 = 5.0267; x 0.88 = 4.4235
  assert.equal(A.erpCalc([10, 10, 10, 10, 10], 4.1, 0.88, 1.15), 4.72, "115% cap: 4.10 x 1.15 = 4.715 -> 4.72");
});

test("payment and crossover, single practice, by hand", () => {
  // 2026 corn, BY 170.2, PLC yield 150, price 4.00, county yield 170.2
  const c = one(4.42, 5.03, 2.42, 150, 170.2, 170.2);
  const p = A.pay(c, 4.0);
  near(p.plc, 0.42 * 150 * 0.85, "PLC 53.55");
  // BR 856.106, G 770.4954, actual 680.80, shortfall 89.6954 x 0.85 = 76.24109
  near(p.arc, 76.24109, "ARC 76.24", 1e-6);
  // ARC cap 102.73272 reached below (770.4954-102.73272)/170.2 = 3.9234; PLC 150 x (4.42 - P) beats it below 3.7351
  assert.deepEqual(text(c), ["PLC pays more at $3.73 or lower.", "ARC-CO pays more from $3.74 to $4.52.", "Neither pays at $4.53 or higher."]);
});

test("irrigated and non-irrigated weighted by the farm's irrigated share, by hand", () => {
  // 30% irrigated: BY 197.23 and 166.32, BP 5.03, county yields at benchmark, price 4.00
  const c = { erp: 4.42, bp: 5.03, loan: 2.42, py: 150, parts: [{ w: 0.3, by: 197.23, y: 197.23 }, { w: 0.7, by: 166.32, y: 166.32 }] };
  // irr: G 0.9 x 992.0669 = 892.86021, actual 788.92, short 103.94021; non: G 0.9 x 836.5896 = 752.93064, actual 665.28, short 87.65064
  // weighted: 0.3 x 103.94021 + 0.7 x 87.65064 = 92.53751; x 0.85 = 78.65688
  near(A.pay(c, 4.0).arc, 78.656884, "blended ARC", 1e-5);
});

test("the scan cannot run long, whatever is typed", () => {
  const c = one(4.42, 5.03, 2.42, 150, 170.2, 0.001);
  const runs = A.ranges(c);
  assert.ok(runs[runs.length - 1].hi <= Math.ceil(5.03 * 150), JSON.stringify(runs[runs.length - 1]));
});

test("input checks", () => {
  const msgs = (v, ref) => Array.from(A.checks(v, ref), (m) => m.msg);
  assert.deepEqual(msgs({ p: 410 }, { erp: 4.34 }), ["Did you mean $4.10 per bushel?"]);
  assert.match(msgs({ p: 1 }, { erp: 4.34 })[0], /far from the \$4\.34 reference price/);
  assert.deepEqual(msgs({ py: 200 }, { erp: 4.34, by: 170 }), ["PLC yield is usually below the county average. Is this your APH? Use the PLC yield on your FSA-156EZ."]);
  assert.deepEqual(msgs({ base: 0 }, { erp: 4.34 }), ["Base acres must be more than zero."]);
  const tiny = Array.from(A.checks({ y: 10 }, { erp: 4.34, by: 170 }));
  assert.equal(tiny.length, 1);
  assert.equal(tiny[0].drop, true);
});

test("without FSA's 2026 file, no county carries a benchmark the calculator could use", (t) => {
  if (D.fsa) return t.skip("official file loaded");
  const ia = state("IA");
  assert.ok(ia && ia.c.length > 50, "Iowa counties listed for typed benchmarks");
  for (const c of ia.c) assert.deepEqual(Object.keys(c.k), [], `${c.n} has no benchmark`);
  assert.ok(ia.c.some((c) => c.plc && c.plc.corn > 0), "FSA county average PLC yields present");
});

test("FSA official county figures, when the file is loaded", (t) => {
  if (!D.fsa) return t.skip("no FSA file in data/fsa");
  assert.equal(D.fsa.py, 2026);
  const ia = state("IA");
  assert.ok(ia && ia.c.length > 50, "Iowa has FSA counties");
  for (const c of ia.c) for (const es of Object.values(c.k)) for (const e of es) assert.ok(e.by > 0 && ["all", "irr", "non"].includes(e.d));
});

test("scenario engine, 8 hand-worked years", () => {
  // ERP 4.00, BP 5.00, loan 2.00, PLC yield 100, benchmark 100, center $4.00
  const ratios = { 2015: 1.0, 2016: 0.75, 2017: 1.25, 2018: 1.25, 2019: 1.0, 2020: 0.5, 2021: 1.1, 2022: 0.9 };
  const dy = { 2015: 1.0, 2016: 1.0, 2017: 1.0, 2018: 0.8, 2019: 1.2, 2020: 1.0, 2021: 0.9, 2022: 1.1 };
  const c = { erp: 4, bp: 5, loan: 2, py: 100, parts: [{ w: 1, by: 100, dy }] };
  const v = A.scenarios(c, 4, ratios);
  // PLC pays 85 (2016, $3.00), 170 (2020, $2.00), 34 (2022, $3.60): mean 289 / 8 = 36.125
  near(v.plc, 36.125, "mean PLC");
  // ARC: G = 450, cap 60 x .85 = 51: 42.5, 51, 0, 42.5, 0, 51, 45.9, 45.9: mean 278.8 / 8 = 34.85
  near(v.arc, 34.85, "mean ARC");
  assert.equal(v.plcWins, 2); assert.equal(v.arcWins, 4);
  // differences -42.5, 34, 0, -42.5, 0, 119, -45.9, -11.9: SD 54.99, SE 19.44; gap 1.275 is under $2
  near(v.se, 19.4408, "SE", 1e-3);
  assert.equal(v.verdict, "close");
  const fixed = A.scenarios(c, 4, ratios, 3.0);
  near(fixed.plc, 85, "PLC at $3.00"); near(fixed.arc, 51, "ARC at $3.00");
  assert.equal(fixed.verdict, "plc");
  // Leans: PLC yield 60 -> PLC 51, 102, 20.4: mean 21.675 vs ARC 34.85; ARC more in 4 (2016 ties), PLC in 1; gap 13.175 >= $3 and >= 1 SE, under 2.365 (7 df) x SE 11.636
  const lean = A.scenarios({ ...c, py: 60 }, 4, ratios);
  near(lean.plc, 21.675, "PLC at yield 60"); assert.equal(lean.arcWins, 4); assert.equal(lean.plcWins, 1);
  near(lean.se, 11.636, "SE", 1e-3);
  assert.equal(lean.verdict, "lean_arc");
  const seven = Object.fromEntries(Object.entries(ratios).filter(([t]) => t !== "2022"));
  assert.equal(A.scenarios(c, 4, seven).verdict, "withheld", "fewer than 8 years");
});

test("the call: t for the actual years, 3 winning years, one SE for Leans, $0/$0, borrowed cap (same cases as the build selftest)", () => {
  // 10 years, 9 df, t 2.262: $10 gap, SE 4.60 -> 10.41 > 10 -> Leans; SE 4.40 -> 9.95 -> Pick. 11 years, t 2.228: SE 4.60 -> 10.25 -> Leans; 4.45 -> 9.91 -> Pick
  assert.equal(A.call(10, 0, 10, 4.6, 5, 0, 10), "lean_plc");
  assert.equal(A.call(10, 0, 10, 4.4, 5, 0, 10), "plc");
  assert.equal(A.call(10, 0, 10, 4.6, 5, 0, 11), "lean_plc");
  assert.equal(A.call(10, 0, 10, 4.45, 5, 0, 11), "plc");
  assert.equal(A.tcrit(9), 2.262); assert.equal(A.tcrit(10), 2.228);
  assert.equal(A.call(0, 10, -10, 0.5, 0, 2, 10), "close", "leader won only 2 years");
  assert.equal(A.call(0, 10, -10, 0.5, 0, 3, 10), "arc");
  assert.equal(A.call(4, 0, 4, 4.1, 4, 0, 10), "close", "Leans needs one SE");
  assert.equal(A.call(4, 0, 4, 3.9, 4, 0, 10), "lean_plc");
  assert.equal(A.call(0.49, 0.2, 0.29, 0.1, 3, 0, 10), "none", "both round to $0");
  assert.equal(A.call(0.5, 0, 0.5, 0.1, 3, 0, 10), "close");
  assert.equal(A.call(10, 0, 10, 1, 8, 0, 10, true), "lean_plc", "borrowed spread caps at Leans");
});

test("2026 normal crop and the futures-center check (same case as the build selftest)", () => {
  const Rf = { 2015: 1.0, 2016: 0.98, 2017: 1.02, 2018: 1.0, 2019: 0.99, 2020: 1.01, 2021: 1.0, 2022: 1.0 };
  const c = { erp: 4, bp: 5, loan: 2, py: 100, parts: [{ w: 1, by: 100, dy: 1 }] };
  const v1 = A.scenarios(c, 3, Rf);
  near(v1.plc, 85, "PLC at a $3.00 start"); near(v1.arc, 51, "ARC capped"); assert.equal(v1.verdict, "plc");
  // futures start $4.50: PLC 0; ARC 7.65 at $4.41 and 3.825 at $4.455, mean 1.434 -> ARC leads -> Pick drops to Leans
  const v2 = A.scenarios(c, 3, Rf, null, { alt: 4.5 });
  assert.equal(v2.verdict, "lean_plc"); assert.equal(v2.altDown, true); near(v2.alt.arc, 11.475 / 8, "ARC at the futures start");
  assert.equal(A.scenarios(c, 3, Rf, null, { alt: 3.1 }).verdict, "plc");
  assert.equal(A.scenarios(c, 3, Rf, 3, { borrowed: true, alt: 4.5 }).verdict, "plc", "a typed price skips both checks");
});

test("a one-cent band reads 'at $X', and every band prints", () => {
  const runs = [{ w: "plc", lo: 300, hi: 359 }, { w: "arc", lo: 360, hi: 360 }, { w: "plc", lo: 361, hi: 400 }, { w: "none", lo: 401, hi: 500 }];
  assert.deepEqual(Array.from(A.rangeText(runs)), ["PLC pays more at $3.59 or lower.", "ARC-CO pays more at $3.60.", "PLC pays more from $3.61 to $4.00.", "Neither pays at $4.01 or higher."]);
});

test("every county page's answers equal the calculator's math on the state file: each crop card, all three PLC-yield buttons, both years", (t) => {
  if (!D.fsa) return t.skip("no FSA file");
  const states = {};
  let pages = 0, seen = 0, calls = 0;
  const unq = (x) => x.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'");
  for (const sd of readdirSync(ROOT + "arc-plc", { withFileTypes: true }).filter((x) => x.isDirectory())) {
    for (const f of readdirSync(ROOT + "arc-plc/" + sd.name)) {
      if (!f.endsWith(".html") || f.endsWith("-sheet.html")) continue;
      const html = readFileSync(ROOT + "arc-plc/" + sd.name + "/" + f, "utf8");
      const m0 = /data-arcplc [^>]*data-state="([A-Z]{2})" data-fips="(\d{5})"/.exec(html);
      assert.ok(m0, `${sd.name}/${f}: calculator carries its county`);
      const S = states[m0[1]] || (states[m0[1]] = state(m0[1]));
      const cty = S.c.find((c) => c.f === m0[2]);
      pages++;
      const re = /<div class="ap-lv" data-k="([a-z_]+)" data-e="([a-z]+)(?::([^"]*))?" data-py="([\d.]+)" data-t="([^"]+)" data-lv="(\w+)"(\s+hidden)?>/g;
      const shown = {};
      for (const m of html.matchAll(re)) {
        const [, k, d, sub, py, tt, lv, hid] = m;
        if (!hid) shown[k] = (shown[k] || 0) + 1;
        assert.equal(!hid, lv === "same", `${f} ${k}: only About the same shows first`);
        const e = cty.k[k].find((x) => x.d === d && (x.sub || "") === unq(sub || ""));
        assert.ok(e, `${f} ${k} ${d}: entry in the state file`);
        for (const part of tt.split("|")) {
          const [y, v, pc, ac] = part.split(":");
          const cd = D.years[y].crops[k];
          seen++;
          if (v === "pending") { assert.ok(!cd, `${f} ${k} ${y}: pending means no ${y} figures`); continue; }
          if (v === "mismatch") { assert.ok(+py > e.by, `${f} ${k} ${y} ${lv}: PLC yield ${py} above benchmark ${e.by}`); continue; }
          const r = A.typical(cd, +py, e);
          assert.equal(r.verdict, v, `${f} ${k} ${d} ${y} ${lv}: page says ${v}, calculator ${r.verdict}`);
          if (r.n) { assert.equal(A.cents(r.plc), +pc, `${f} ${k} ${y} ${lv} PLC`); assert.equal(A.cents(r.arc), +ac, `${f} ${k} ${y} ${lv} ARC-CO`); calls++; }
        }
      }
      for (const [k, n] of Object.entries(shown)) assert.equal(n, 1, `${f} ${k}: one answer shown`);
    }
  }
  assert.ok(pages >= 2700, `only ${pages} county pages read; the pages have moved`);
  assert.ok(calls >= 20000, `only ${calls} answers re-derived; the cards have moved`);
});

test("Use my location: point in polygon on a fixture, and Chippewa's coordinates land on Chippewa County, WI", () => {
  // a 10 x 10 square with a 2 x 2 hole: even-odd across the polygon's rings
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  const nav = { s: { XX: { b: [0, 0, 10, 10] } } };
  const geos = { XX: { c: [["99001", "Square", "square-county", [0, 0, 10, 10], [[sq, hole]]]] } };
  assert.equal(F.locate(nav, geos, 2, 2).rec[0], "99001");
  assert.equal(F.locate(nav, geos, 5, 5), null, "inside the hole");
  assert.equal(F.locate(nav, geos, 11, 5), null, "outside");
  assert.equal(F.inRing(9.999, 0.001, sq), true);
  const N = JSON.parse(readFileSync(ROOT + "data/arc-plc/nav.json", "utf8"));
  const cand = Array.from(F.candidates(N, -91.29, 44.94));
  const G = Object.fromEntries(cand.map((s) => [s, JSON.parse(readFileSync(ROOT + `data/arc-plc/geo/${s}.json`, "utf8"))]));
  const hit = F.locate(N, G, -91.29, 44.94);
  assert.equal(hit.st, "WI"); assert.equal(hit.rec[0], "55017"); assert.equal(hit.rec[2], "chippewa-county");
  assert.equal(N.s.WI.slug, "wisconsin");
  assert.equal(F.locate(N, {}, 2.35, 48.85), null, "Paris is outside");
  // every county with a page is reachable by its shape
  let withPage = 0;
  for (const s of Object.keys(N.s)) {
    const p = ROOT + `data/arc-plc/geo/${s}.json`;
    if (!existsSync(p)) continue;
    for (const r of JSON.parse(readFileSync(p, "utf8")).c) if (r[2]) withPage++;
  }
  assert.ok(withPage >= 2700, `${withPage} county shapes carry a page`);
});

test("no em dash in the calculator's words", () => {
  assert.ok(!readFileSync(ROOT + "components/arc-plc.js", "utf8").includes("—"));
});

test("a pound crop scans in hundredths of a cent (peanuts, by hand)", () => {
  // ERP .315, loan .195, PLC yield 3,300 lb, benchmark 4,000 lb at $.315, county yield 3,400 lb. ARC cap 151.20 x .85 = 128.52 binds below $.2891;
  // PLC 2,805 x (.315 - p) beats it below $.2692; ARC pays until 1,134 - 3,400p = 0 at $.3335. Same answer as the build script's selftest.
  const c = { erp: 0.315, bp: 0.315, loan: 0.195, py: 3300, parts: [{ w: 1, by: 4000, y: 3400 }], scale: 10000 };
  assert.deepEqual(Array.from(A.rangeText(A.ranges(c), 10000)),
    ["PLC pays more at $0.2691 or lower.", "ARC-CO pays more from $0.2692 to $0.3335.", "Neither pays at $0.3336 or higher."]);
  near(A.pay(c, 0.24).plc, 210.375, "PLC at $.24: .075 x 3,300 x .85", 1e-9);
});

test("every crop in the built file carries a unit, and pound crops have a 2026 ERP FSA printed", () => {
  for (const [k, c] of Object.entries(D.years["2026"].crops)) assert.ok(["bu", "lb"].includes(c.unit), k);
  assert.equal(D.years["2026"].crops.peanuts.erp.erp, 0.315);
  assert.equal(D.years["2026"].crops.peanuts.unit, "lb");
  assert.equal(D.years["2026"].crops.sorghum.erp.erp, 4.67);
});
