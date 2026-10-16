/* components/grain-bin.js -- the math behind /grain-bin-calculator.
 *
 * ONE COPY. The page loads this file and calls it; test/grain-bin.test.mjs
 * runs the same file in node and checks it against bins worked by hand and
 * against the numbers baked into the page (FAQ, dealer check table).
 *
 * No document needed: everything here is plain math on numbers.
 *
 * Basis
 *   1 US bushel = 2,150.42 in3 = 1.2445 ft3, so 0.8036 bu per ft3.
 *   Plain setting: grain peak 25 deg, no pack (what this page always did).
 *   Dealer setting: grain peak 28 deg, 6% pack. GSI prints that basis on its
 *   40-Series capacity chart ("based on 28 degree angle of repose and 6%
 *   compaction factor") and counts grain from the top of a 12 in plenum.
 *   Pack itself is what ASABE EP413.2 (WPACKING) predicts; Bhadra et al. 2015
 *   (Trans. ASABE, doi 10.13031/trans.58.11033) found WPACKING within 0.90% of
 *   the measured grain on average in 51 corn bins. 6% is the dealer's round
 *   number, not a measured one for your bin.
 *   Shrink: water shrink per point = 100 / (100 - target moisture), 1.183 at
 *   15.5% (Purdue NCH-61). Whatever the per-point factor adds above that is
 *   handling loss.
 *   Drying: commercial dryers bill per point per WET bushel (ISU Extension).
 */
(function (w) {
  'use strict';

  var BU_PER_CUFT = 0.8036;
  var PLAIN = { peakDeg: 25, packPct: 0 };
  var DEALER = { peakDeg: 28, packPct: 6 };
  var DRAW_DEG = 25;          // funnel left by unloading; dealers do not chart it
  var RINGS_IN = [32, 44];    // GSI 32 in rings (9 rings = 24'2", 12 = 32'2"); Sukup 44 in sheets

  function tanD(a) { return Math.tan(a * Math.PI / 180); }
  function cone(r, deg) { return Math.PI * r * r * r * tanD(deg) / 3; }

  /* Grain that is gH deep at the wall, with a surface (or floor) that changes
     depth by k ft per ft toward the center: depth at distance u from the wall
     is gH - u*k, clipped at zero. Integral of 2*pi*(r-u)*(gH-u*k) du over the
     part with grain. k < 0 means the grain gets deeper toward the center (a
     hopper bottom steeper than the draw funnel). With the whole floor covered
     this is pi r^2 gH - pi k r^3 / 3, i.e. cylinder minus (or plus) a cone. */
  function wedge(r, gH, k) {
    var L = (k > 0) ? Math.min(r, gH / k) : r;
    return 2 * Math.PI * (r * gH * L - (r * k + gH) * L * L / 2 + k * L * L * L / 3);
  }

  /* Round flat-floor bin. d ft, grainH = grain depth at the wall in ft.
     Returns ft3: cyl, adj (surface), total. */
  function roundBin(o) {
    var r = o.d / 2, gH = o.grainH, peak = o.peakDeg || PLAIN.peakDeg;
    if (!(gH > 0) || !(r > 0)) return { cyl: 0, adj: 0, hopper: 0, total: 0 };
    var cyl = Math.PI * r * r * gH, adj = 0;
    if (o.surface === 'peaked') adj = cone(r, peak);
    else if (o.surface === 'draw') adj = wedge(r, gH, tanD(DRAW_DEG)) - cyl;
    return { cyl: cyl, adj: adj, hopper: 0, total: Math.max(0, cyl + adj) };
  }

  /* Hopper bin: grainH = grain depth in the cylinder above the hopper. The
     hopper cone is full whenever any grain is in the cylinder, and also at 0 ft
     (an empty cylinder over a full hopper). A draw funnel over a hopper: the
     grain lies between the hopper wall and the 25 deg funnel, depth
     gH + u*tan(hopper) - u*tan(25) at distance u from the wall. Figured to a
     point; the outlet is ignored (a small overstatement). */
  function hopperBin(o) {
    var r = o.d / 2, gH = Math.max(0, o.grainH || 0), peak = o.peakDeg || PLAIN.peakDeg;
    if (!(r > 0)) return { cyl: 0, adj: 0, hopper: 0, total: 0 };
    var hop = cone(r, o.hopperDeg), cyl = Math.PI * r * r * gH, adj = 0;
    if (o.surface === 'peaked') adj = gH > 0 ? cone(r, peak) : 0;
    else if (o.surface === 'draw') adj = wedge(r, gH, tanD(DRAW_DEG) - tanD(o.hopperDeg)) - cyl - hop;
    return { cyl: cyl, adj: adj, hopper: hop, total: Math.max(0, cyl + adj + hop) };
  }

  function bushels(ft3, packPct) { return ft3 * BU_PER_CUFT * (1 + (packPct || 0) / 100); }

  /* Volume bushels (1.2445 ft3 each) to market bushels (56 lb for corn). */
  function marketBu(volBu, testWt, stdLb) { return volBu * testWt / stdLb; }

  /* perPt is the % shrink per point the elevator uses (1.3 by default). */
  function shrink(moistIn, target, perPt) {
    var pts = Math.max(0, moistIn - target);
    var total = pts * perPt;
    var waterPerPt = 100 / (100 - target);
    var water = pts * waterPerPt;
    return { pts: pts, total: total, water: water, handling: total - water, waterPerPt: waterPerPt };
  }

  /* $ to dry: points x $/pt per wet bushel x wet bushels. */
  function dryingCost(pts, ratePerPt, wetBu) { return pts * ratePerPt * wetBu; }

  /* Bin sizing: for each diameter, the fewest rings that hold the target on the
     chosen basis. Eave = rings x ring height (real bins run an inch or two more). */
  var SIZE_DIAMS = [18, 21, 24, 27, 30, 33, 36, 42, 48, 54, 60];
  function sizeOptions(target, ringIn, dealer, max) {
    var ring = ringIn / 12, b = dealer ? DEALER : PLAIN, out = [];
    for (var i = 0; i < SIZE_DIAMS.length && out.length < (max || 6); i++) {
      var d = SIZE_DIAMS[i], r = d / 2, area = Math.PI * r * r;
      var top = dealer ? cone(r, b.peakDeg) : 0;
      var needH = (target / (BU_PER_CUFT * (1 + b.packPct / 100)) - top) / area;
      var rings = Math.max(Math.ceil(8 / ring - 1e-9), Math.ceil(needH / ring - 1e-9));
      var eave = rings * ring;
      if (eave > 48 || eave > 2.2 * d) continue;      // implausible tall-skinny builds skipped
      var cap = bushels(area * eave + top, b.packPct);
      out.push({ d: d, rings: rings, eave: eave, bu: cap });
    }
    return out;
  }

  /* Real bins checked against the dealers' printed capacities. Chart numbers
     are as printed by the dealer; floorIn is grain that sits on an aeration
     floor (GSI's chart counts from a 12 in plenum). */
  var CHECK_BINS = [
    { name: 'GSI 30 ft, 9 rings', maker: 'GSI 40-Series chart', d: 30, eaveIn: 24 * 12 + 2, floorIn: 12, chart: 15337 },
    { name: 'GSI 36 ft, 12 rings', maker: 'GSI 40-Series chart', d: 36, eaveIn: 32 * 12 + 2, floorIn: 12, chart: 29404 },
    { name: 'Brock 48 ft, 8 rings (7-04808)', maker: 'Brock BR-2286 narrow corrugation chart (Jan 2022)', d: 48, eaveIn: 21 * 12 + 6, floorIn: 0, belowEaveIn: 1, chart: 39053 }
  ];
  /* belowEaveIn: Brock's footnote starts the 28 deg peak "one inch (25 mm)
     below the eave", so the dealer column does the same. The plain column is
     the bin filled to the eave, what a farmer gets typing the eave height. */
  function checkBin(b) {
    var gH = (b.eaveIn - b.floorIn) / 12;
    var gDealer = gH - (b.belowEaveIn || 0) / 12;
    var dealer = bushels(roundBin({ d: b.d, grainH: gDealer, surface: 'peaked', peakDeg: DEALER.peakDeg }).total, DEALER.packPct);
    var plain = bushels(roundBin({ d: b.d, grainH: gH, surface: 'peaked', peakDeg: PLAIN.peakDeg }).total, 0);
    return { grainH: gH, dealerGrainH: gDealer, dealer: dealer, plain: plain,
             dealerPct: (dealer / b.chart - 1) * 100, plainPct: (plain / b.chart - 1) * 100 };
  }

  /* Depth at the wall from a tape: grain sits `below` ft under the eave (or
     under the top of a flat bin). maxH is the eave less any aeration floor.
     Returns null for a blank or unusable reading. */
  function depthFromBelow(maxH, below) {
    if (!(maxH > 0) || !isFinite(below) || below < 0) return null;
    return Math.max(0, maxH - below);
  }

  /* Room left in the bin, in bushels on the same basis as the grain now in it.
     o: { shape: 'round' | 'hopper', d, maxH (eave less floor, or the hopper's
     cylinder), grainH, surface, peakDeg, hopperDeg, packPct }.
     toEave: filled level to the eave. toPeak: filled to the eave and peaked at
     peakDeg. A peak already above the eave can make toEave negative; it is
     reported as 0 with over = true. */
  function roomLeft(o) {
    var f = o.shape === 'hopper' ? hopperBin : roundBin;
    var base = { d: o.d, hopperDeg: o.hopperDeg, peakDeg: o.peakDeg };
    var at = function (gH, sf) { var b = {}; for (var k in base) b[k] = base[k]; b.grainH = gH; b.surface = sf;
      return bushels(f(b).total, o.packPct); };
    var now = at(o.grainH, o.surface);
    var eave = at(o.maxH, 'level'), peak = at(o.maxH, 'peaked');
    var toEave = eave - now, toPeak = peak - now;
    return { now: now, full: peak, fullLevel: eave, toEave: Math.max(0, toEave), toPeak: Math.max(0, toPeak), over: toEave < -1e-6 };
  }

  function ftIn(ft) {
    var tot = Math.round(ft * 12), f = Math.floor(tot / 12), i = tot - f * 12;
    return i ? f + ' ft ' + i + ' in' : f + ' ft';
  }

  w.AgGrainBin = {
    BU_PER_CUFT: BU_PER_CUFT, PLAIN: PLAIN, DEALER: DEALER, DRAW_DEG: DRAW_DEG, RINGS_IN: RINGS_IN,
    cone: cone, wedge: wedge, roundBin: roundBin, hopperBin: hopperBin, bushels: bushels,
    marketBu: marketBu, shrink: shrink, dryingCost: dryingCost, sizeOptions: sizeOptions,
    CHECK_BINS: CHECK_BINS, checkBin: checkBin, ftIn: ftIn,
    depthFromBelow: depthFromBelow, roomLeft: roomLeft
  };
})(typeof window !== 'undefined' ? window : this);
