/* Yield estimator math (/yield-estimator). Pure functions only, so the
 * shipped file runs in a bare context under test/yield-estimator.test.mjs.
 *
 * Corn, yield component method, 1/1000-acre sample:
 *   bu/ac = ears x kernel rows x kernels per row x 1000 / kernels per bushel
 * Kernels per bushel defaults to 85,000: Purdue's Bob Nielsen suggests 80,000
 * to 85,000 for today's hybrids; 90,000 was the method's original figure.
 * Soybeans:
 *   bu/ac = plants x 1000 x pods per plant x seeds per pod / (seeds per lb x 60)
 * Several sites: each site's yield, then the plain mean (every extension
 * guide says to count 5 or more sites and average them). Up to 5 sites.
 */
(function (root) {
  "use strict";
  var KPB_DEFAULT = 85000;
  var KPB_LO = 65000, KPB_HI = 95000; // the kernel-weight sweep shown as the range
  var MAX_SITES = 5;

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

  root.AgYield = { KPB_DEFAULT: KPB_DEFAULT, KPB_LO: KPB_LO, KPB_HI: KPB_HI, MAX_SITES: MAX_SITES,
                   cornYield: cornYield, beanYield: beanYield, average: average };
})(typeof window !== "undefined" ? window : this);
