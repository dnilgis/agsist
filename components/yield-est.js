/* Yield estimator math (/yield-estimator). Pure functions only, so the
 * shipped file runs in a bare context under test/yield-estimator.test.mjs.
 *
 * Corn, yield component method, 1/1000-acre sample:
 *   bu/ac = ears x kernel rows x kernels per row x 1000 / kernels per bushel
 * Kernels per bushel is the guess in this method. Purdue's Bob Nielsen
 * (Estimating Corn Grain Yield Prior to Harvest, Aug 2021) says to work it at
 * 65, 75 and 85 thousand, and 90 to 100 after a stressful grain fill; his
 * recent trials ranged 67,000 to 94,000 and averaged about 76,000. 90,000 was
 * the method's original figure. The page shows 75k, 85k and 95k side by side
 * (KPB_SET) and headlines 85,000, the middle of the three.
 * Soybeans:
 *   bu/ac = plants x 1000 x pods per plant x seeds per pod / (seeds per lb x 60)
 * Several sites: each site's yield, then the plain mean (every extension
 * guide says to count 5 or more sites and average them). Up to 10 sites.
 */
(function (root) {
  "use strict";
  var KPB_DEFAULT = 85000;
  var KPB_SET = [75000, 85000, 95000]; // shown side by side on every result
  var KPB_PURDUE_AVG = 76000;           // Purdue's recent-trial average
  var MAX_SITES = 10;

  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }

  function cornYield(ears, rows, kpr, kpb) {
    ears = num(ears); rows = num(rows); kpr = num(kpr); kpb = num(kpb) || KPB_DEFAULT;
    if (ears == null || rows == null || kpr == null) return null;
    return ears * 1000 * rows * kpr / kpb;
  }

  function beanYield(plants, pods, seeds, slb) {
    plants = num(plants); pods = num(pods); seeds = num(seeds); slb = num(slb);
    if (plants == null || pods == null || seeds == null || !slb) return null;
    return plants * 1000 * pods * seeds / (slb * 60);
  }

  /* [y1, y2, ...] (nulls are incomplete sites, left out and counted)
     -> {mean, lo, hi, n, skipped} or null when no site is complete */
  function average(ys) {
    var ok = [], skipped = 0;
    for (var i = 0; i < ys.length; i++) {
      if (num(ys[i]) == null) skipped++; else ok.push(ys[i]);
    }
    if (!ok.length) return null;
    var s = 0;
    for (var j = 0; j < ok.length; j++) s += ok[j];
    return { mean: s / ok.length, lo: Math.min.apply(null, ok), hi: Math.max.apply(null, ok),
             n: ok.length, skipped: skipped };
  }

  /* A yield worked at one kernels-per-bushel figure, restated at another.
     Same counts, so it is a straight ratio. */
  function atKpb(y, from, to) {
    y = num(y); from = num(from); to = num(to);
    if (y == null || !from || !to) return null;
    return y * from / to;
  }

  root.AgYield = { KPB_DEFAULT: KPB_DEFAULT, KPB_SET: KPB_SET, KPB_PURDUE_AVG: KPB_PURDUE_AVG,
                   MAX_SITES: MAX_SITES, cornYield: cornYield, beanYield: beanYield,
                   average: average, atKpb: atKpb };
})(typeof window !== "undefined" ? window : this);
