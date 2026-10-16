/* grain-shrink.js: the arithmetic behind /grain-shrink (2026-10-16).
 *
 * Pure functions, no DOM. The page (grain-shrink-ui.js) and the tests
 * (test/grain-shrink.test.mjs) run this same file.
 *
 * WET GRAIN TO TOWN. The buyer pays for dry bushels at the base moisture.
 *   Water shrink, % of wet weight = 100 x (Mw - Mb) / (100 - Mb)
 *     (NCH-61, Hicks and Cloud, Univ. of Minnesota, Purdue's National Corn
 *     Handbook; NDSU Hellevang 2009 gives the same formula.)
 *   Buyers add handling loss two ways (NCH-61):
 *     'water'  : water shrink plus a flat handling % (drying tables, 0.5%)
 *     'factor' : a flat % per point removed (typically 1.2 to 1.5)
 *   Dry bushels = wet bushels x (1 - total shrink / 100)
 *   Drying charge, per WET bushel: cents per point removed, or a flat charge
 *   from the elevator's own table for the band the moisture falls in.
 *     (ISU ICM 2019: 4.8 cents a wet bushel a point, 1.4% a point.)
 *
 * DRY IT MYSELF (ISU ICM 2019 and 2022 "dry on-farm before selling"; Purdue GQ-3).
 *   Dry matter = wet lb x (100 - Mw) / 100; weight at base = dry matter / (1 - Mb/100)
 *   Handling loss = a % of the WET weight (ISU: 1% of 56,000 lb = 560 lb)
 *   Bushels to sell = (weight at base - handling lb) / test weight
 *   Drying, either:
 *     fuel  : gallons LP a bushel a point x wet bu x points x $ a gallon
 *             (ISU: 0.018 average, 0.010 to 0.025), plus electricity by
 *             Purdue GQ-3 Eq. 2: HP x 0.746 x $/kWh / dry bu an hour, per dry bu
 *     allin : cents a wet bushel a point (ISU's A2-32 figure: 3 cents in 2019,
 *             4 cents in 2022)
 *   Hauling = miles x cents a bushel a mile x wet bu (ISU: 1 cent, 4 miles, $40)
 *   Fuel, power and hauling only: no labor, dryer payments or repairs.
 *
 * DELIVERED TOO DRY. A bushel under base moisture is still weighed at the
 * standard test weight, so the water you dried off was grain you could have
 * sold. Bushels you would have had at base moisture:
 *   bu at base = bu delivered x (100 - Ma) / (100 - Mb)
 *   (dry matter is the same; Nebraska CropWatch, "Harvest soybeans at 13%")
 */
(function (root) {
  'use strict';

  /* Base moisture and test weight. Every one is editable on the page:
     the elevator's scale ticket is the authority. */
  var CROPS = {
    corn:     { name: 'corn',     base: 15.5, tw: 56, method: 'factor', factor: 1.4, handling: 0.5, futures: 'corn' },
    soybeans: { name: 'soybeans', base: 13,   tw: 60, method: 'water',  factor: 1.3, handling: 0.5, futures: 'soybeans' },
    wheat:    { name: 'wheat',    base: 13.5, tw: 60, method: 'water',  factor: 1.3, handling: 0.5, futures: 'wheat' },
    sorghum:  { name: 'sorghum',  base: 14,   tw: 56, method: 'water',  factor: 1.3, handling: 0.5, futures: null }
  };

  function num(v) { return typeof v === 'number' && isFinite(v); }
  function r(v, d) { var p = Math.pow(10, d || 0); return Math.round(v * p) / p; }

  /* % of wet weight lost to water alone, drying from m to base. */
  function waterShrink(m, base) {
    if (!num(m) || !num(base) || base >= 100 || m <= base) return 0;
    return 100 * (m - base) / (100 - base);
  }
  /* Water shrink per point removed for a final moisture: 1.183 at 15.5. */
  function waterFactor(base) { return 100 / (100 - base); }

  /* Total pencil shrink, %. o = {method:'water'|'factor', handling, factor} */
  function totalShrink(m, base, o) {
    o = o || {};
    var pts = m - base;
    if (!num(pts) || pts <= 0) return 0;
    if (o.method === 'factor') return pts * (num(o.factor) ? o.factor : 1.4);
    return waterShrink(m, base) + (num(o.handling) ? o.handling : 0.5);
  }
  /* What the buyer's shrink assumes beyond water: NCH-61 Table 2. Iowa State
     measured 0.22 to 1.71% on farms, 0.64 to 1.33% at commercial dryers. */
  function handlingIn(m, base, o) {
    var t = totalShrink(m, base, o);
    return t ? t - waterShrink(m, base) : 0;
  }

  /* Drying charge in dollars per wet bushel.
     d = {kind:'none'} | {kind:'point', cents} | {kind:'table', rows:[{upTo, cents}], over}
     Table rows: moisture up to and including upTo pays a flat cents a wet
     bushel; rows are read in order of upTo. Over the last row: 'over'
     cents if given, else null (the page says it has no answer). */
  function dryingPerBu(m, base, d) {
    d = d || { kind: 'none' };
    var pts = m - base;
    if (!(pts > 0)) return 0;
    if (d.kind === 'point') return num(d.cents) ? pts * d.cents / 100 : 0;
    if (d.kind === 'table') {
      var rows = (d.rows || []).filter(function (x) { return x && num(x.upTo) && num(x.cents); })
        .slice().sort(function (a, b) { return a.upTo - b.upTo; });
      for (var i = 0; i < rows.length; i++) if (m <= rows[i].upTo + 1e-9) return rows[i].cents / 100;
      return num(d.over) ? d.over / 100 : null;
    }
    return 0;
  }

  /* One load of wet grain. o = {crop, m, base, lbs, tw, bid, method, factor, handling, drying}
     Returns null on input that cannot be answered honestly. */
  function wet(o) {
    if (!o || !num(o.m) || !num(o.base) || !num(o.lbs) || !num(o.tw) || o.lbs <= 0 || o.tw <= 0) return null;
    if (o.m <= 0 || o.m >= 60 || o.base <= 0 || o.base >= 40) return null;
    var wetBu = o.lbs / o.tw, pts = Math.max(0, o.m - o.base);
    var shrink = totalShrink(o.m, o.base, o);
    if (shrink >= 100) return null;
    var dryBu = wetBu * (1 - shrink / 100);
    var water = waterShrink(o.m, o.base);
    var dpb = dryingPerBu(o.m, o.base, o.drying);
    var out = {
      wetBu: wetBu, points: pts, shrinkPct: shrink, waterPct: water, handlingPct: shrink ? shrink - water : 0,
      dryBu: dryBu, shrinkBu: wetBu - dryBu,
      dryingPerBu: dpb, drying: dpb == null ? null : dpb * wetBu
    };
    if (num(o.bid) && o.bid > 0) {
      out.gross = dryBu * o.bid;
      out.net = out.drying == null ? null : out.gross - out.drying;
      out.netPerWetBu = out.net == null ? null : out.net / wetBu;
      /* What the moisture cost: the load paid as if every wet bushel were
         dry, less what it actually brings. */
      out.shrinkDollars = (wetBu - dryBu) * o.bid;
      out.cost = out.net == null ? null : wetBu * o.bid - out.net;
      out.costPerWetBu = out.cost == null ? null : out.cost / wetBu;
    }
    return out;
  }

  /* Drying it on the farm, then selling at base moisture.
     o = {m, base, lbs, tw, bid, handling (% of wet weight), mode:'fuel'|'allin',
          gal, lp, hp, kwh, buHr, allin (cents), miles, haul (cents a bu a mile)}
     Fuel mode needs gal and lp; electricity counts only with all three of
     hp, kwh and buHr. Returns null when it cannot be answered. */
  function farm(o) {
    if (!o || !num(o.m) || !num(o.base) || !num(o.lbs) || !num(o.tw) || o.lbs <= 0 || o.tw <= 0) return null;
    if (o.m <= o.base || o.m >= 60 || o.base <= 0 || o.base >= 40) return null;
    var h = num(o.handling) && o.handling >= 0 ? o.handling : 1;
    var wetBu = o.lbs / o.tw, pts = o.m - o.base;
    var dm = o.lbs * (100 - o.m) / 100, atBase = dm / (1 - o.base / 100), hLb = o.lbs * h / 100;
    var dryBu = (atBase - hLb) / o.tw;
    if (!(dryBu > 0)) return null;
    var fuel = null, power = 0, powerCounted = false, drying = null;
    if (o.mode === 'allin') {
      if (num(o.allin) && o.allin >= 0) drying = o.allin / 100 * pts * wetBu;
    } else if (num(o.gal) && o.gal > 0 && num(o.lp) && o.lp >= 0) {
      fuel = o.gal * wetBu * pts * o.lp;
      if (num(o.hp) && o.hp > 0 && num(o.kwh) && o.kwh >= 0 && num(o.buHr) && o.buHr > 0) {
        power = o.hp * 0.746 * o.kwh / o.buHr * dryBu; powerCounted = true;
      }
      drying = fuel + power;
    }
    var haul = num(o.miles) && o.miles > 0 && num(o.haul) && o.haul >= 0 ? o.miles * o.haul / 100 * wetBu : 0;
    var out = {
      wetBu: wetBu, points: pts, dryMatterLb: dm, atBaseLb: atBase, handlingLb: hLb, handlingPct: h,
      sellLb: atBase - hLb, dryBu: dryBu, shrinkBu: wetBu - dryBu, shrinkPct: 100 * (1 - dryBu / wetBu),
      fuel: fuel, power: power, powerCounted: powerCounted, drying: drying, haul: haul,
      gallons: fuel != null ? o.gal * wetBu * pts : null
    };
    if (num(o.bid) && o.bid > 0) {
      out.gross = dryBu * o.bid;
      out.net = drying == null ? null : out.gross - drying - haul;
      out.netPerWetBu = out.net == null ? null : out.net / wetBu;
    }
    return out;
  }

  /* Grain delivered under base moisture. o = {m, base, bu (delivered, or lbs+tw), bid, yieldBu, acres} */
  function overdry(o) {
    if (!o || !num(o.m) || !num(o.base) || o.m <= 0 || o.base <= 0 || o.base >= 40) return null;
    if (o.m >= o.base) return { under: 0, ratio: 1, extraPer1000: 0, lossPct: 0 };
    var ratio = (100 - o.m) / (100 - o.base);
    var out = {
      under: o.base - o.m,
      ratio: ratio,
      extraPer1000: 1000 * (ratio - 1),
      /* As Nebraska CropWatch states it: the share of the crop's base-moisture
         bushels that never got paid for. 9% beans vs 13%: 4.4%. */
      lossPct: 100 * (1 - 1 / ratio)
    };
    var bu = num(o.bu) ? o.bu : (num(o.lbs) && num(o.tw) && o.tw > 0 ? o.lbs / o.tw : null);
    if (num(bu) && bu > 0) { out.bu = bu; out.atBase = bu * ratio; out.extraBu = bu * (ratio - 1); }
    if (num(o.yieldBu) && o.yieldBu > 0) out.extraPerAcre = o.yieldBu * (ratio - 1);
    if (num(o.bid) && o.bid > 0) {
      if (out.extraBu != null) out.dollars = out.extraBu * o.bid;
      out.dollarsPer1000 = out.extraPer1000 * o.bid;
      if (out.extraPerAcre != null) out.dollarsPerAcre = out.extraPerAcre * o.bid;
      if (out.dollarsPerAcre != null && num(o.acres) && o.acres > 0) out.dollarsFarm = out.dollarsPerAcre * o.acres;
    }
    return out;
  }

  /* A default bid when no ZIP: the futures contract most of the state's
     elevators price against, plus that state's median basis
     (data/basis-states.json). Null when either is missing; never guessed. */
  var BASIS_KEYS = { corn: ['corn'], soybeans: ['soybeans'], wheat: ['wheat_hrw', 'wheat_srw', 'wheat_hrs'], sorghum: [] };
  function quoteFor(prices, contract) {
    var q = prices && prices.quotes;
    if (!q || !contract) return null;
    for (var k in q) {
      if (!Object.prototype.hasOwnProperty.call(q, k)) continue;
      var t = q[k] && q[k].ticker;
      if (t && t.split('.')[0] === contract && num(q[k].close)) {
        var d = q[k].close_date || null, st = q[k].settles;
        /* A settle only when the file records one for that day at that price.
           A close_date of today with no recorded settle is a delayed quote
           read mid-session (474.25 at 10:01 am CT on Oct 16, 2026). */
        var settled = !!(d && st && num(st[d]) && st[d] === q[k].close);
        return { key: k, close: q[k].close / 100, date: d, settled: settled, read: settled ? null : (prices.fetched || null) };
      }
    }
    return null;
  }
  function defaultBid(prices, basis, st, crop) {
    var s = basis && basis.states && basis.states[st];
    if (!s || !s.crops) return null;
    var keys = BASIS_KEYS[crop] || [], best = null;
    keys.forEach(function (k) {
      var c = s.crops[k];
      if (c && num(c.median) && num(c.n) && (!best || c.n > best.c.n)) best = { k: k, c: c };
    });
    if (!best) return null;
    var fq = quoteFor(prices, best.c.contract);
    if (!fq) return null;
    return {
      bid: r(fq.close + best.c.median, 4), futures: fq.close, futuresDate: fq.date, settled: fq.settled, futuresRead: fq.read, contract: best.c.contract,
      label: best.c.label || best.c.contract, basis: best.c.median, n: best.c.n, state: st, stateName: s.name || st,
      cls: best.k, asOf: basis.generated || null
    };
  }

  /* How the futures price is named: "settle Oct 15" only for a recorded
     settle; otherwise "delayed, Oct 16 10:01 am CT" from the file's read time.
     A quote with neither is "delayed" and no time is made up. */
  function ctStamp(iso) {
    var d = new Date(iso); if (!iso || isNaN(d)) return '';
    try {
      return d.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' }) + ' ' +
        d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }).toLowerCase() + ' CT';
    } catch (e) { return ''; }
  }
  function futuresWhen(q) {
    if (!q) return '';
    if (q.settled && q.date) {
      var d = new Date(String(q.date).slice(0, 10) + 'T12:00:00Z');
      return isNaN(d) ? 'settle' : 'settle ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    }
    var t = ctStamp(q.read);
    return t ? 'delayed, ' + t : 'delayed';
  }

  /* THE ZIP BID, ON THE SAME RULE AS /cash-bids (components/cb-rank.js).
     A board posted before today (Central) is yesterday's market. If it states
     its futures month and data/prices.json holds a later price for that
     contract, the bid is re-marked to basis + that price and shown with "≈"
     beside what the elevator posted; otherwise the posted price stands,
     flagged "not updated for today's futures". The ranking module decides;
     this only hands it the row. rank: window.cbRank (or the vm copy in tests).
     n: a bids-network row; sym: the board's own futuresMonth, or ''. */
  function zipBid(n, sym, rank, now) {
    if (!n || !num(n.cashPrice)) return null;
    var out = { price: n.cashPrice, posted: n.cashPrice, remark: null, old: false, note: '', text: '' };
    if (!rank || typeof rank.assess !== 'function') return out;
    var row = {
      via: 'direct', asOf: n.pricedAt || n.checkedAt || '', category: n.crop, commodity: n.commodity || n.crop,
      symbol: sym || '', basis: n.basis
    };
    var bc = num(n.basisCents) ? n.basisCents : null;
    /* cb-rank re-marks only inside a plausible band; here that is a dollar
       either side of what the board posted, so a garbled basis is never
       carried into a price. */
    var rk = rank.assess(row, { cash: n.cashPrice, basisC: bc, band: [Math.max(0.01, n.cashPrice - 1), n.cashPrice + 1], now: now });
    if (!rk || rk.exclude) return out;
    out.price = rk.price != null ? rk.price : n.cashPrice;
    out.remark = rk.remark; out.old = !!rk.old;
    out.note = typeof rank.note === 'function' ? rank.note(rk) : '';
    out.text = typeof rank.priceText === 'function' ? rank.priceText(rk) : '';
    return out;
  }

  /* The nearest elevator's row for this crop from a bids-network snapshot. */
  function nearestBid(snap, crop) {
    var rows = (snap && snap.bids || []).filter(function (b) { return b.crop === crop && num(b.cashPrice) && b.cashPrice > 0; });
    rows.sort(function (a, b) { return (a.distance || 0) - (b.distance || 0); });
    return rows[0] || null;
  }

  var api = {
    CROPS: CROPS, num: num, r: r, waterShrink: waterShrink, waterFactor: waterFactor, totalShrink: totalShrink,
    handlingIn: handlingIn, dryingPerBu: dryingPerBu, wet: wet, farm: farm, overdry: overdry,
    quoteFor: quoteFor, defaultBid: defaultBid, nearestBid: nearestBid, futuresWhen: futuresWhen, zipBid: zipBid
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgShrink = api;
})(typeof self !== 'undefined' ? self : this);
