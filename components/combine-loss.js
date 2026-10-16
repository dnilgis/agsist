/* combine-loss.js: the arithmetic behind /combine-loss (2026-10-16).
 *
 * Pure functions, no DOM. The page (combine-loss-ui.js) and the tests
 * (test/combine-loss.test.mjs) run this same file.
 *
 * SOYBEANS. Nebraska CropWatch (2023, "How to estimate harvest losses in
 * soybean and corn fields"): beans per square foot that make 1 bu/ac of
 * loss, by seed size: small 5, medium 4, large 3. Their example: 7 beans in
 * 1 sq ft / 4 = 1.75 bu/ac. Iowa State and NDSU use 4 for average beans.
 * With a seed count instead of a size, the same rule is arithmetic:
 *   beans per sq ft for 1 bu/ac = seeds per lb x 60 lb / 43,560 sq ft
 *   (4 a sq ft is about 2,900 seeds a pound.)
 *
 * CORN, loose kernels. Iowa State ICM (Hanna, 2010) and NDSU: 2 kernels a
 * square foot = 1 bu/ac. No size adjustment is given for corn, so none here.
 *
 * CORN, dropped ears. One 3/4 lb ear in 1/100 acre = 1 bu/ac (UW Extension;
 * Iowa State gives one ear in 436 sq ft). A 1/2 lb ear is about 2/3 bu, so
 * ears scale by weight: bu/ac = ears x (ear lb / 0.75) x (0.01 / acres
 * walked). 1/100 acre is 435.6 sq ft: feet of row = 435.6 / (rows x row
 * width in feet), 29 ft across a 6-row 30-inch head.
 *
 * PREHARVEST. CropWatch counts ahead of the combine too (shatter and drop
 * before the head) and adds it for total loss. Here: behind minus ahead is
 * what the combine lost.
 */
(function (root) {
  'use strict';

  var SQFT_ACRE = 43560;
  var BEAN_SIZES = { small: 5, medium: 4, large: 3 };   /* per sq ft = 1 bu/ac */
  var CORN_KERNELS = 2;                                  /* per sq ft = 1 bu/ac */
  var EAR_LB = 0.75;                                     /* one ear per 1/100 ac = 1 bu/ac */
  var LB_BU = { soybeans: 60, corn: 56 };

  function num(v) { return typeof v === 'number' && isFinite(v); }
  function pos(v) { return num(v) && v > 0; }

  /* Beans a square foot that make 1 bu/ac, from seeds per pound. */
  function perSqFtFromSeeds(seedsPerLb, lbPerBu) {
    if (!pos(seedsPerLb)) return null;
    return seedsPerLb * (lbPerBu || 60) / SQFT_ACRE;
  }
  /* Seeds a pound that a per-sq-ft rule assumes (4 beans -> 2,904). */
  function seedsFromPerSqFt(per, lbPerBu) {
    if (!pos(per)) return null;
    return per * SQFT_ACRE / (lbPerBu || 60);
  }

  /* Beans or kernels a square foot that make 1 bu/ac.
     o = {crop, size:'small'|'medium'|'large', seedsPerLb} */
  function rule(o) {
    o = o || {};
    if (o.crop === 'corn') return CORN_KERNELS;
    if (pos(o.seedsPerLb)) return perSqFtFromSeeds(o.seedsPerLb, LB_BU.soybeans);
    return BEAN_SIZES[o.size] || BEAN_SIZES.medium;
  }

  /* Average count per spot over the spots counted. */
  function avg(counts) {
    var c = (counts || []).filter(function (x) { return num(x) && x >= 0; });
    if (!c.length) return null;
    return c.reduce(function (a, b) { return a + b; }, 0) / c.length;
  }

  /* bu/ac from grains counted in a frame of `area` sq ft. */
  function grainsBu(count, area, per) {
    if (!num(count) || count < 0 || !pos(area) || !pos(per)) return null;
    return count / area / per;
  }

  /* Feet of row that make 1/100 acre across a head. */
  function rowFeet(rows, rowIn) {
    if (!pos(rows) || !pos(rowIn)) return null;
    return SQFT_ACRE / 100 / (rows * rowIn / 12);
  }
  /* bu/ac from ears on the ground. acres walked defaults to 1/100. */
  function earsBu(ears, earLb, acres) {
    if (!num(ears) || ears < 0) return null;
    var lb = pos(earLb) ? earLb : EAR_LB, ac = pos(acres) ? acres : 0.01;
    return ears * (lb / EAR_LB) * (0.01 / ac);
  }

  /* The answer. o = {crop, behind:[counts], ahead:[counts], area, size,
     seedsPerLb, ears, earLb, bid, yieldBu, acres} */
  function loss(o) {
    o = o || {};
    var per = rule(o), area = pos(o.area) ? o.area : 10;
    var b = avg(o.behind), a = avg(o.ahead);
    var behindBu = b == null ? null : grainsBu(b, area, per);
    var aheadBu = a == null ? null : grainsBu(a, area, per);
    var earBu = o.crop === 'corn' && num(o.ears) && o.ears > 0 ? earsBu(o.ears, o.earLb) : 0;
    if (behindBu == null && !earBu) return null;
    var total = (behindBu || 0) + (earBu || 0);
    /* Ears are counted after the combine; the ahead count is loose grain
       only, taken off the loose grain behind and never below zero. */
    var machine = aheadBu == null ? null : Math.max(0, (behindBu || 0) - aheadBu) + (earBu || 0);
    var lost = machine == null ? total : machine;
    var out = {
      per: per, area: area, behindAvg: b, aheadAvg: a, spots: (o.behind || []).filter(num).length,
      behindBu: behindBu, aheadBu: aheadBu, earBu: earBu, totalBu: total, machineBu: machine, lostBu: lost,
      perAcre: null, pctYield: null, farm: null, totalPerAcre: null
    };
    if (pos(o.bid)) {
      out.perAcre = lost * o.bid;
      out.totalPerAcre = total * o.bid;
      if (pos(o.acres)) out.farm = out.perAcre * o.acres;
    }
    if (pos(o.yieldBu)) out.pctYield = 100 * lost / (o.yieldBu + lost);
    return out;
  }

  var api = {
    SQFT_ACRE: SQFT_ACRE, BEAN_SIZES: BEAN_SIZES, CORN_KERNELS: CORN_KERNELS, EAR_LB: EAR_LB, LB_BU: LB_BU,
    num: num, perSqFtFromSeeds: perSqFtFromSeeds, seedsFromPerSqFt: seedsFromPerSqFt, rule: rule, avg: avg,
    grainsBu: grainsBu, rowFeet: rowFeet, earsBu: earsBu, loss: loss
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgCombineLoss = api;
})(typeof self !== 'undefined' ? self : this);
