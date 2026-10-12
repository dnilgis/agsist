/* The PRF arithmetic (components/prf-math.js) against USDA RMA's own tool.
 *
 * test/fixtures/prf/rma-30152.json holds answers read from RMA's PRF tool on
 * 2026-10-12 for grid 30152, Barron County, Wisconsin, crop year 2027: four
 * policies, two sample years each, 76 years of estimated indemnities, and the
 * same county's rows from the 2027 Actuarial Data Master. Nothing in that file
 * was computed here. A green run means the shipped file gives RMA's dollars.
 *
 *   node --test test/prf-math.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { window: {}, Buffer };
vm.runInNewContext(readFileSync(ROOT + "components/prf-math.js", "utf8"), ctx);
const M = ctx.window.AgPrfMath;
const FX = JSON.parse(readFileSync(ROOT + "test/fixtures/prf/rma-30152.json", "utf8"));
const CASES = Object.entries(FX.cases);

/* A guard that loops must say how much it looked at. */
let pricedRows = 0, indemnityCells = 0;

test("the fixture is what it says: four policies, 76 years, eleven intervals", () => {
  assert.equal(CASES.length, 4);
  assert.deepEqual(Array.from(FX.codes), Array.from(M.CODES));
  const withData = Object.entries(FX.index).filter(([, r]) => r.some((v) => v != null));
  assert.equal(withData.length, 76);
  assert.equal(withData[0][0], "1951");
  assert.equal(withData.at(-1)[0], "2026");
});

for (const [name, c] of CASES) {
  const rates = c.valid.map((v) => v[1]);
  for (const p of c.pricing) {
    test(`${name}: ${p.acres} acres, factor ${p.pf}, share ${p.interest}, sample year ${p.year}, to the dollar`, () => {
      const pol = M.policy({
        cbv: p.summary.CountyBaseValue, coverage: c.coverage, productivity: p.pf,
        acres: p.acres, share: p.interest, split: c.split, rates, subsidy: p.summary.SubsidyLevel,
      });
      /* RMA's summary line prints the per-acre figure unrounded (37.638) and builds
         every row from it rounded to the cent (37.64): see the live cases below. */
      assert.equal(pol.protectionPerAcre, M.cents(p.summary.ProtectionPerAcre), "protection per acre");
      for (const r of p.rows) {
        const i = M.CODES.indexOf(r.IntervalCode), mine = pol.rows[i];
        assert.equal(mine.rate, r.PremiumRate, `rate ${r.IntervalCode}`);
        if (!r.PercentOfValue) { assert.equal(mine.protection, 0); continue; }
        pricedRows++;
        assert.equal(mine.protection, r.PolicyProtection, `protection ${r.IntervalCode}`);
        assert.equal(mine.premium, r.TotalPremium, `premium ${r.IntervalCode}`);
        assert.equal(mine.subsidy, r.PremiumSubsidy, `subsidy ${r.IntervalCode}`);
        assert.equal(mine.producer, r.ProducerPremium, `producer premium ${r.IntervalCode}`);
        assert.equal(FX.index[String(p.year)][i], r.PercentOfNormal, `index ${r.IntervalCode}`);
        assert.equal(M.pay(mine.protection, r.PercentOfNormal, c.coverage), r.Indemnity, `indemnity ${r.IntervalCode}`);
      }
      assert.equal(pol.total.protection, p.total.PolicyProtection, "total protection");
      assert.equal(pol.total.premium, p.total.TotalPremium, "total premium");
      assert.equal(pol.total.subsidy, p.total.PremiumSubsidy, "total subsidy");
      assert.equal(pol.total.producer, p.total.ProducerPremium, "total producer premium");
      const h = M.history(pol, { [p.year]: FX.index[String(p.year)] });
      assert.equal(h[0].indemnity, p.total.Indemnity, "the year's indemnity");
    });
  }

  /* RMA's Estimated Indemnities tab does NOT round the interval protection to
     the dollar before it multiplies, and its Decision Support tab does: grazing
     at 85% on 100 acres with 20% in an interval is $557.60 of protection on one
     tab and $558 on the other. So this replay uses the unrounded protection,
     and the per-year figures on /prf (which follow the Decision Support tab)
     can sit a few cents per interval away from that tab's export. */
  test(`${name}: every year RMA estimates, 100 acres`, () => {
    const cbv = c.pricing[0].summary.CountyBaseValue;
    let years = 0;
    for (const [y, est] of Object.entries(c.indemnities_100ac)) {
      const idx = FX.index[y];
      let any = false;
      c.split.forEach((pct, i) => {
        if (!pct) return;
        const prot = cbv * (c.coverage / 100) * 100 * (pct / 100);
        const mine = M.payment(prot, idx[i], c.coverage);
        if (est[i] == null) { assert.equal(mine, null, `${y} interval ${i}: RMA has no figure`); return; }
        any = true; indemnityCells++;
        assert.ok(Math.abs(mine - est[i]) < 0.006, `${y} interval ${i}: ${mine} vs RMA ${est[i]}`);
      });
      if (any) years++;
    }
    /* The probe asked that tab for 1948 to 2025; the record starts in 1951. */
    assert.equal(years, 75, "years with at least one figure");
  });

  test(`${name}: the Actuarial Data Master rows carry the same rate, base value and limits`, () => {
    const H = FX.adm_rows_header, col = (n) => H.indexOf(n);
    const rows = FX.adm_rows.filter((r) => r[col("use")] === c.use && r[col("irr")] === c.irr &&
      r[col("org")] === c.org && Math.round(parseFloat(r[col("coverage")]) * 100) === c.coverage);
    assert.equal(rows.length, 11);
    for (const r of rows) {
      const i = M.CODES.indexOf(r[col("interval")]);
      assert.equal(parseFloat(r[col("base_rate")]), c.valid[i][1], `rate ${i}`);
      assert.equal(parseFloat(r[col("cbv")]), c.pricing[0].summary.CountyBaseValue, "county base value");
      assert.equal(parseFloat(r[col("min")]), c.maxpct[i][1], `min ${i}`);
      assert.equal(parseFloat(r[col("max")]), c.maxpct[i][2], `max ${i}`);
    }
  });
}

test("the loops above looked at something", () => {
  assert.ok(pricedRows >= 20, `priced rows checked: ${pricedRows}`);
  assert.equal(indemnityCells, 75 * (2 + 2 + 4 + 2), `indemnity cells checked: ${indemnityCells}`);
});

test("the payment factor is not rounded to three places (RMA: $3,532, not $3,527)", () => {
  assert.equal(M.pay(16557, 0.708, 90), 3532);
  assert.equal(M.dollars(16557 * 0.213), 3527);
});

/* ---- fifty policies RMA priced on 2026-10-12, from all over the country ---- */
const LIVE = JSON.parse(readFileSync(ROOT + "test/fixtures/prf/rma-live-2026-10-12.json", "utf8"));
let liveRows = 0;
test("fifty live policies: protection, premium, subsidy and indemnity, every row to the dollar", () => {
  assert.equal(LIVE.cases.length, 50);
  assert.ok(new Set(LIVE.cases.map((c) => c.st)).size >= 20, "from at least twenty states");
  for (const c of LIVE.cases) {
    const pol = M.policy({ cbv: c.cbv, coverage: c.coverage, productivity: c.pf, acres: c.acres, share: c.share,
                           split: c.split, rates: c.rates, subsidy: c.subsidy });
    const tag = `${c.label} (${c.countyName} ${c.st}, grid ${c.grid})`;
    for (const r of c.rma.rows) {
      const i = M.CODES.indexOf(r.IntervalCode), mine = pol.rows[i];
      liveRows++;
      assert.equal(mine.rate, r.PremiumRate, `${tag}: rate ${r.IntervalCode}`);
      assert.equal(c.index[i], r.PercentOfNormal, `${tag}: index ${r.IntervalCode}`);
      assert.equal(mine.protection, r.PolicyProtection, `${tag}: protection ${r.IntervalCode}`);
      assert.equal(mine.premium, r.TotalPremium, `${tag}: premium ${r.IntervalCode}`);
      assert.equal(mine.subsidy, r.PremiumSubsidy, `${tag}: subsidy ${r.IntervalCode}`);
      assert.equal(mine.producer, r.ProducerPremium, `${tag}: producer premium ${r.IntervalCode}`);
      assert.equal(M.pay(mine.protection, c.index[i], c.coverage), r.Indemnity, `${tag}: indemnity ${r.IntervalCode}`);
    }
    assert.equal(pol.total.protection, c.rma.total.PolicyProtection, `${tag}: total protection`);
    assert.equal(pol.total.premium, c.rma.total.TotalPremium, `${tag}: total premium`);
    assert.equal(pol.total.producer, c.rma.total.ProducerPremium, `${tag}: total producer premium`);
    assert.equal(M.history(pol, { [c.year]: c.index })[0].indemnity, c.rma.total.Indemnity, `${tag}: the year's indemnity`);
  }
  assert.equal(liveRows, 152, "priced rows checked");
});

test("the cent: Pike County AL, grazing, 1,304 acres. $40.77 an acre, not $40.766", () => {
  const c = LIVE.cases.find((x) => x.countyName === "Pike" && x.st === "AL");
  assert.ok(c, "the Pike County case is in the fixture");
  const pol = M.policy({ cbv: c.cbv, coverage: c.coverage, productivity: c.pf, acres: c.acres, share: c.share, split: c.split, rates: c.rates, subsidy: c.subsidy });
  assert.equal(pol.protectionPerAcre, M.cents(c.cbv * c.coverage / 100 * c.pf / 100));
  assert.equal(pol.total.protection, c.rma.total.PolicyProtection);
  const unrounded = c.split.reduce((a, pct) => a + (pct ? M.dollars(c.cbv * c.coverage / 100 * c.pf / 100 * c.acres * c.share / 100 * pct / 100) : 0), 0);
  assert.notEqual(unrounded, c.rma.total.PolicyProtection, "without the cent it is off");
});

test("the half dollars RMA answered: three round up, and $80.50 of indemnity pays $80", () => {
  /* grid 30152, non-irrigated hay, 90%, half in Apr-May and half in Jun-Jul */
  const half = Object.fromEntries(LIVE.cases.filter((c) => c.label.startsWith("half")).map((c) => [c.label, c]));
  assert.equal(Object.keys(half).length, 5);
  assert.equal(M.dollars(310.5), 311);                                   /* protection, 3 acres: RMA 311 */
  assert.equal(half["half dollar in the protection"].rma.rows[0].PolicyProtection, 311);
  assert.equal(M.dollars(275000 * 0.1119), 30773);                       /* premium 30,772.50: RMA 30,773 */
  assert.equal(half["half dollar in the premium"].rma.rows[0].TotalPremium, 30773);
  assert.equal(M.dollars(950 * 0.51), 485);                              /* subsidy 484.50: RMA 485 */
  assert.equal(half["half dollar in the subsidy"].rma.rows[0].PremiumSubsidy, 485);
  assert.equal(M.pay(414, 0.725, 90), 80);                               /* 80.50 in plain arithmetic: RMA 80 */
  assert.equal(half["half dollar in the indemnity"].rma.rows[0].Indemnity, 80);
  assert.equal(M.pay(207, 0.85, 90), 12);                                /* 11.50 in plain arithmetic: RMA 12 */
  assert.equal(half["half dollar in the indemnity, odd dollar"].rma.rows[0].Indemnity, 12);
});

test("an index at or above the trigger pays nothing; a missing index is not a zero", () => {
  assert.equal(M.pay(1000, 0.9, 90), 0);
  assert.equal(M.pay(1000, 0.899, 90), 1);
  assert.equal(M.pay(1000, null, 90), null);
  assert.equal(M.pay(1000, 0.45, 90), 500);
  assert.equal(M.pay(1000, 0, 70), 1000);
  assert.equal(M.payment(1000, 0.9, 90), 0);
  assert.equal(M.payment(1000, 1.2, 90), 0);
  assert.equal(M.payment(1000, null, 90), null);
  assert.ok(Math.abs(M.payment(1000, 0.45, 90) - 500) < 1e-9);
  assert.ok(Math.abs(M.payment(1000, 0, 70) - 1000) < 1e-9);
});

test("grid numbers: RMA's own boxes", () => {
  /* GRIDCODE 30454 on RMA's layer: 45.25 to 45.5 N, 91.75 to 91.5 W. */
  assert.deepEqual({ ...M.gridBounds(30454) }, { south: 45.25, north: 45.5, west: -91.75, east: -91.5 });
  /* GRIDCODE 10019: 28.25 to 28.5 N, 100.5 to 100.25 W. */
  assert.deepEqual({ ...M.gridBounds(10019) }, { south: 28.25, north: 28.5, west: -100.5, east: -100.25 });
  /* RMA's layer answered 30454 for the point 45.31 N, 91.65 W. */
  assert.equal(M.gridFromLatLon(45.31, -91.65), 30454);
  assert.equal(M.gridFromLatLon(45.25, -91.75), 30454, "south-west corner belongs to the box");
  assert.equal(M.gridFromLatLon(45.5, -91.75), 30754, "north edge belongs to the next box up");
  assert.equal(M.gridFromLatLon(19.9, -100), null);
  assert.equal(M.gridFromLatLon(45, -129.99), 30001);
  assert.equal(M.gridFromLatLon("x", 1), null);
  assert.equal(M.shardKey(30152), "100_7");
  assert.equal(M.shardKey(30454), "101_7");
  assert.equal(M.gridBounds(0), null);
  assert.equal(M.gridBounds(36001), null);
});

test("split rules: adds to 100, inside the limits, no shared month", () => {
  const max = [25, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70], min = Array(11).fill(10);
  assert.ok(M.checkSplit([0, 0, 0, 50, 0, 50, 0, 0, 0, 0, 0], min, max).ok);
  const adj = M.checkSplit([0, 0, 0, 50, 50, 0, 0, 0, 0, 0, 0], min, max);
  assert.ok(!adj.ok && adj.errors.some((e) => e.why === "adjacent" && e.i === 4));
  const sum = M.checkSplit([0, 0, 0, 50, 0, 40, 0, 0, 0, 0, 0], min, max);
  assert.ok(!sum.ok && sum.errors.some((e) => e.why === "sum" && e.sum === 90));
  const hi = M.checkSplit([60, 0, 40, 0, 0, 0, 0, 0, 0, 0, 0], min, max);
  assert.ok(hi.errors.some((e) => e.why === "above" && e.i === 0 && e.limit === 25));
  const lo = M.checkSplit([0, 5, 0, 95, 0, 0, 0, 0, 0, 0, 0], min, max);
  assert.ok(lo.errors.some((e) => e.why === "below" && e.i === 1) && lo.errors.some((e) => e.why === "above" && e.i === 3));
  /* January-February and November-December share no month. */
  assert.ok(M.checkSplit([25, 0, 0, 0, 0, 0, 25, 0, 0, 0, 50], min, max).ok);
});

test("cents rounds half away from zero", () => {
  assert.equal(M.cents(40.766), 40.77);
  assert.equal(M.cents(255.833), 255.83);
  assert.equal(M.cents(1.005), 1.01);
  assert.equal(M.cents(279.45), 279.45);
  assert.equal(M.cents(null), null);
});

test("dollars rounds half away from zero and ignores binary noise", () => {
  assert.equal(M.dollars(1158.5), 1159);
  assert.equal(M.dollars(1158.4999999998), 1159);
  assert.equal(M.dollars(1158.49), 1158);
  assert.equal(M.dollars(-2.5), -3);
  assert.equal(M.dollars(null), null);
});

test("a grid record round-trips through the packed form the data files use", () => {
  const y0 = 1951, y1 = 2025, hist = [], idx = FX.index;
  for (let y = y0; y <= y1; y++) for (const v of idx[String(y)]) hist.push(v == null ? M.MISSING : Math.round(v * 1000));
  const c = FX.cases.hay_nonirr_90, rates = [];
  for (const cov of M.COVERAGE) for (let i = 0; i < 11; i++) rates.push(cov === 90 ? Math.round(c.valid[i][1] * 10000) : M.MISSING);
  const pack = (a) => Buffer.from(new Uint16Array(a).buffer).toString("base64");
  const g = M.openGrid({ h: pack(hist), r: pack(rates), a: FX.avg_mm.map((v) => Math.round(v * 10)), c: ["55005"] },
                       y0, y1, { year: 2026, values: idx["2026"].map((v) => (v == null ? null : Math.round(v * 1000))) });
  assert.equal(g.index[1951][0], 1.134);
  assert.equal(g.index[2025][9], 0.461);
  assert.equal(g.index[2026][5], 1.038);
  assert.equal(g.index[2026][6], null);
  assert.equal(g.rates[90][3], 0.1119);
  assert.equal(g.rates[70][3], null);
  assert.equal(Object.keys(g.index).length, 76);
});

test("a year missing an interval the split uses is listed and left out of every total", () => {
  const c = FX.cases.graze_85, rates = c.valid.map((v) => v[1]);
  const pol = M.policy({ cbv: 32.8, coverage: 85, productivity: 100, acres: 500, share: 100, split: c.split, rates, subsidy: 0.55 });
  const index = {}; for (const [y, r] of Object.entries(FX.index)) index[+y] = r;
  const hist = M.history(pol, index), s = M.summarize(hist, pol);
  /* The split uses Jul-Aug and Sep-Oct; 2026 had neither when the fixture was read. */
  assert.deepEqual(Array.from(s.incomplete), [2026]);
  assert.equal(s.years, 75);
  assert.equal(s.first, 1951); assert.equal(s.last, 2025);
  assert.equal(s.producer, pol.total.producer * 75);
  const byHand = hist.filter((h) => h.complete).reduce((a, h) => a + h.indemnity, 0);
  assert.equal(s.indemnity, byHand);
  assert.equal(s.paidYears, hist.filter((h) => h.complete && h.indemnity > 0).length);
  assert.ok(s.best.net >= s.worst.net);
  assert.equal(hist.find((h) => h.year === 2026).indemnity, null);
});

test("one interval's record: counts, lowest year, cost per $100 against the rate", () => {
  const index = { 2001: [0.5], 2002: [0.9], 2003: [1.2], 2004: [null], 2005: [0.45] };
  for (const y in index) while (index[y].length < 11) index[y].push(null);
  const r = M.intervalRecord(index, 0, 90, 0.2);
  assert.equal(r.years, 4);
  assert.equal(r.below, 2);
  assert.deepEqual({ ...r.lowest }, { year: 2005, index: 0.45 });
  /* (0.4/0.9 + 0 + 0 + 0.45/0.9) / 4 * 100 */
  assert.ok(Math.abs(r.costPer100 - (0.4 / 0.9 + 0.5) / 4 * 100) < 1e-9);
  assert.ok(Math.abs(r.ratePer100 - 20) < 1e-9);
  assert.ok(Math.abs(r.middle - 0.7) < 1e-12);
});

test("blank acres gives per-acre figures, unrounded", () => {
  const c = FX.cases.hay_nonirr_90, rates = c.valid.map((v) => v[1]);
  const pol = M.policy({ cbv: 230, coverage: 90, productivity: 100, acres: null, split: c.split, rates, subsidy: 0.51 });
  assert.ok(pol.perAcre);
  assert.equal(pol.protectionPerAcre, 207);
  assert.ok(Math.abs(pol.rows[3].protection - 103.5) < 1e-9);
  assert.ok(Math.abs(pol.rows[3].premium - 103.5 * 0.1119) < 1e-9);
  assert.ok(Math.abs(pol.total.producer - (103.5 * 0.1119 + 103.5 * 0.0942) * 0.49) < 1e-9);
});
