/* components/nutrient-removal.js -- /nutrient-removal: what leaves the field
 * when grain, stalks, straw, silage or hay is hauled off, and what it costs to
 * put the P and K back at posted fertilizer prices.
 *
 * POUNDS: UW Extension A2809 (Laboski and Peters), Table 4.2, crop removal in
 * lb of P2O5 and K2O per unit of yield. Copy read from the references branch
 * (refs/uw-a2809-2026.txt, the March 2026 web posting; the 2022 Lafayette
 * County copy has the same numbers for every crop here). Straw, stover and hay
 * are per ton of DRY MATTER; silage per ton at 65% moisture; grain per bushel
 * at the moisture A2809 reports it.
 *
 * N and S: A2809 gives no lb-per-unit N or S removal. They stay null (shown
 * as "not shown yet") until a published table is saved and read. Never fill
 * them from memory.
 *
 * PRICES: data/fertilizer-prices.json only (the one shared price file; no
 * page types a price, test/fert-price-guard.test.mjs). Same picks as the
 * per_lb line in that file (scripts/build_fert_prices.py), which /fertilizer,
 * Fast Facts and /manure-value use:
 *   N   = urea;
 *   P2O5 = MAP (DAP if MAP has no price), after its N is credited at the urea
 *         price (no N price -> no P price; never charge the N to P silently);
 *   K2O = potash.
 * A missing price stays missing: the line says "no price", totals that need
 * it are withheld, never guessed.
 *
 * Pure parts (CROPS, grade, nutrientPrices, value, cropLine) run in node for
 * test/nutrient-removal.test.mjs; mount() draws the page.
 */
(function (root) {
  'use strict';

  /* A2809 Table 4.2. basis: 'bu' (per bushel at moist%), 'wet' (per ton at
     moist%), 'dm' (per ton of dry matter). range = A2809 yield range per acre.
     def = the starting yield in the calculator; every one is the reader's to
     change. defWhy says where each starting number comes from. */
  /* Corn stalks: other published removal figures, read from the copies on
     the references branch, each kept under its own name (never blended).
     A2809's 32 lb K2O is the high end; potash is most of the bill, so the
     reader picks which source the dollars use. Per DRY ton:
       ISU PM 1688 as quoted by ISU ICM (refs/bench-nutrient-removal-1.txt):
         4.8 lb P2O5 and 18.0 lb K2O per ton at 15% moisture -> / 0.85.
       Purdue, Camberato 2008 (refs/bench-nutrient-removal-6.txt):
         3.6 lb P2O5 and 20 lb K2O per ton of dry stover.
     ISU also says rain after harvest leaches K out of stalks, so baled
     stover often tests under the at-maturity figure. */
  var STOVER_SRC = [
    { id: 'a2809', short: 'UW A2809', p: 4.6, k: 32,
      cite: 'UW Extension A2809 (Laboski and Peters), Table 4.2: 4.6 lb P₂O₅ and 32 lb K₂O per dry ton',
      url: 'https://cropsandsoils.extension.wisc.edu/files/2026/03/A2809-web.pdf' },
    { id: 'isu', short: 'Iowa State PM 1688', p: 4.8 / 0.85, k: 18 / 0.85,
      cite: 'Iowa State PM 1688 as quoted by Iowa State ICM (Sawyer, 2007): 4.8 lb P₂O₅ and 18 lb K₂O per ton at 15% moisture, 5.6 and 21.2 per dry ton',
      url: 'https://crops.extension.iastate.edu/encyclopedia/nutrient-removal-when-harvesting-corn-stover' },
    { id: 'purdue', short: 'Purdue', p: 3.6, k: 20,
      cite: 'Purdue Corny News (Camberato, 2008): 3.6 lb P₂O₅ and 20 lb K₂O per ton of dry stover',
      url: 'https://www.agry.purdue.edu/ext/corn/news/articles.08/stovernutrients-1010.html' }
  ];

  var CROPS = [
    { id: 'corn_stover', group: 'Corn', name: 'Corn stalks (stover) bales', basis: 'dm', unit: 'ton', p: 4.6, k: 32, n: null, s: null,
      range: '1 to 5 ton DM', def: 3, defWhy: 'middle of A2809’s 1 to 5 ton range', bale: true, alt: STOVER_SRC },
    { id: 'corn_silage', group: 'Corn', name: 'Corn silage', basis: 'wet', moist: 65, unit: 'ton', p: 3.6, k: 8.3, n: null, s: null,
      range: '10 to 40 ton', def: 20, defWhy: 'a round number inside A2809’s 10 to 40 ton range' },
    { id: 'corn_grain', group: 'Corn', name: 'Corn grain', basis: 'bu', moist: 15.5, unit: 'bu', p: 0.38, k: 0.29, n: null, s: null,
      range: '70 to 290 bu', def: 180, defWhy: 'the yield the corn program on /fertilizer is priced at' },
    { id: 'soy_straw', group: 'Soybeans', name: 'Soybean stubble (straw) bales', basis: 'dm', unit: 'ton', p: 5.4, k: 19, n: null, s: null,
      range: '2 to 4 ton DM', def: 3, defWhy: 'the straw yield A2809 assumes for soybeans (Table 7.4 note)', bale: true },
    { id: 'soy_grain', group: 'Soybeans', name: 'Soybean grain', basis: 'bu', moist: 13, unit: 'bu', p: 0.8, k: 1.4, n: null, s: null,
      range: '15 to 105 bu', def: 55, defWhy: 'the yield the soybean program on /fertilizer is priced at' },
    { id: 'wheat_straw', group: 'Small grains', name: 'Wheat straw bales', basis: 'dm', unit: 'ton', p: 6, k: 28, n: null, s: null,
      range: '1.5 to 3.5 ton DM', def: 2, defWhy: 'the straw yield A2809 assumes for wheat (Table 7.4 note)', bale: true },
    { id: 'wheat_grain', group: 'Small grains', name: 'Wheat grain', basis: 'bu', moist: 13.5, unit: 'bu', p: 0.5, k: 0.35, n: null, s: null,
      range: '20 to 120 bu', def: 70, defWhy: 'the yield the wheat program on /fertilizer is priced at' },
    { id: 'oat_straw', group: 'Small grains', name: 'Oat straw bales', basis: 'dm', unit: 'ton', p: 9.4, k: 47, n: null, s: null,
      range: '1 to 3 ton DM', def: 2, defWhy: 'the straw yield A2809 assumes for oats (Table 7.4 note)', bale: true },
    { id: 'oat_grain', group: 'Small grains', name: 'Oat grain', basis: 'bu', moist: 14, unit: 'bu', p: 0.29, k: 0.19, n: null, s: null,
      range: '30 to 120 bu', def: 80, defWhy: 'a round number inside A2809’s 30 to 120 bu range' },
    { id: 'barley_straw', group: 'Small grains', name: 'Barley straw bales', basis: 'dm', unit: 'ton', p: 10, k: 32, n: null, s: null,
      range: '1 to 3 ton DM', def: 2, defWhy: 'the straw yield A2809 assumes for barley (Table 7.4 note)', bale: true },
    { id: 'barley_grain', group: 'Small grains', name: 'Barley grain', basis: 'bu', moist: 14.5, unit: 'bu', p: 0.4, k: 0.35, n: null, s: null,
      range: '25 to 100 bu', def: 70, defWhy: 'a round number inside A2809’s 25 to 100 bu range' },
    { id: 'sg_silage', group: 'Small grains', name: 'Small grain silage', basis: 'dm', unit: 'ton', p: 11, k: 44, n: null, s: null,
      range: '2 to 3.5 ton DM', def: 2.5, defWhy: 'inside A2809’s 2 to 3.5 ton range', bale: true },
    { id: 'alfalfa', group: 'Hay', name: 'Alfalfa hay', basis: 'dm', unit: 'ton', p: 13, k: 60, n: null, s: null,
      range: '2.6 to 9.5 ton DM', def: 4, defWhy: 'a round number inside A2809’s 2.6 to 9.5 ton range', bale: true },
    { id: 'red_clover', group: 'Hay', name: 'Red clover hay', basis: 'dm', unit: 'ton', p: 13, k: 60, n: null, s: null,
      range: '1 to 6.5 ton DM', def: 3, defWhy: 'inside A2809’s 1 to 6.5 ton range', bale: true },
    { id: 'grass_hay', group: 'Hay', name: 'Grass hay', basis: 'dm', unit: 'ton', p: 15, k: 55, n: null, s: null,
      range: '0.5 to 8 ton DM', def: 3, defWhy: 'inside A2809’s 0.5 to 8 ton range', bale: true,
      note: 'Brome, fescue, orchardgrass, ryegrass and timothy (A2809).' },
    { id: 'mixed_hay_hi', group: 'Hay', name: 'Mixed hay, over 30% legume', basis: 'dm', unit: 'ton', p: 13, k: 60, n: null, s: null,
      range: '0.5 to 5 ton DM', def: 3, defWhy: 'inside A2809’s 0.5 to 5 ton range', bale: true,
      note: 'A2809 gives legume-grass figures under pasture; these are its over-30%-legume line.' },
    { id: 'mixed_hay_lo', group: 'Hay', name: 'Mixed hay, 30% legume or less', basis: 'dm', unit: 'ton', p: 13, k: 51, n: null, s: null,
      range: '0.5 to 5 ton DM', def: 3, defWhy: 'inside A2809’s 0.5 to 5 ton range', bale: true,
      note: 'A2809 gives legume-grass figures under pasture; these are its 30%-or-less-legume line.' }
  ];
  function crop(id) { for (var i = 0; i < CROPS.length; i++) if (CROPS[i].id === id) return CROPS[i]; return null; }

  function good(x) { return typeof x === 'number' && isFinite(x) && x > 0; }
  /* "11-52-0" -> {N:11,P:52,K:0}; "21-0-0-24S" keeps the first three. */
  function grade(sym) {
    var m = /^\s*(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/.exec(String(sym || ''));
    return m ? { N: +m[1], P: +m[2], K: +m[3] } : null;
  }

  /* data/fertilizer-prices.json -> $/lb of N, P2O5 and K2O, each with the
     product it came from, or null. The SAME pick as per_lb in that file
     (scripts/build_fert_prices.py nutrient_prices), /fertilizer's headline,
     Fast Facts and /manure-value: N from urea; P2O5 from MAP (DAP when MAP
     has no price) with its N credited at the urea price; K2O from potash.
     No urea price: no N credit, so no P price (never charge the N to P).
     test/nutrient-removal.test.mjs checks this matches per_lb exactly. */
  function nutrientPrices(data) {
    var rows = {};
    ((data && data.prices) || []).forEach(function (r) {
      if (!r || !good(r.price) || !grade(r.symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(r.as_of || '')) return;
      rows[r.key] = { key: r.key, name: r.name, symbol: r.symbol, price: r.price, as_of: r.as_of,
        label: r.src_label || r.as_of, region: r.region || null, coops: r.coops || [], g: grade(r.symbol) };
    });
    var out = { n: null, p: null, k: null };
    var u = rows.urea;
    if (u && u.g.N > 0) out.n = { usd: u.price / (20 * u.g.N), row: u };
    var ph = rows.map || rows.dap;
    if (ph && ph.g.P > 0 && out.n) {
      var nLb = 20 * ph.g.N, credit = nLb * out.n.usd, usd = (ph.price - credit) / (20 * ph.g.P);
      if (usd > 0) out.p = { usd: usd, row: ph, nLb: nLb, credit: credit, raw: ph.price / (20 * ph.g.P) };
    }
    var k = rows.potash;
    if (k && k.g.K > 0) out.k = { usd: k.price / (20 * k.g.K), row: k };
    return out;
  }

  /* lb in one unit of yield -> $ for that unit. P and K only make the total;
     N is priced separately (when a source gives it) because little of the N
     in stalks or straw is there for next year's crop. null if a price the
     total needs is missing. */
  function value(lb, pr) {
    var r = { p: null, k: null, n: null, pk: null };
    if (pr.p) r.p = lb.p * pr.p.usd;
    if (pr.k) r.k = lb.k * pr.k.usd;
    if (lb.n != null && pr.n) r.n = lb.n * pr.n.usd;
    if (r.p != null && r.k != null) r.pk = r.p + r.k;
    return r;
  }

  /* One calculator run. o: {crop, yield (units/ac), acres, baleLb, baleMoist,
     sale, saleUnit ('bale'|'ton'|'acre')}. Bales: yield and A2809 are per DRY
     ton; a ton as baled holds (1 - moisture) dry tons. */
  /* The removal figures a run uses: A2809 unless the crop has other read
     sources and o.src names one of them. */
  function source(c, id) {
    if (!c.alt) return null;
    for (var i = 0; i < c.alt.length; i++) if (c.alt[i].id === id) return c.alt[i];
    return c.alt[0];
  }
  /* Low and high P and K $ per unit across a crop's sources, with who gives
     each end. null when the crop has one source or a price is missing. */
  function spread(c, pr) {
    if (!c.alt || !pr.p || !pr.k) return null;
    var lo = null, hi = null;
    c.alt.forEach(function (x) {
      var v = x.p * pr.p.usd + x.k * pr.k.usd;
      if (!lo || v < lo.usd) lo = { usd: v, src: x };
      if (!hi || v > hi.usd) hi = { usd: v, src: x };
    });
    return { lo: lo, hi: hi };
  }

  function cropLine(o, pr) {
    var c = crop(o.crop); if (!c) return null;
    var sx = source(c, o.src);
    var lbUnit = sx ? { p: sx.p, k: sx.k, n: c.n } : { p: c.p, k: c.k, n: c.n };
    var y = good(o.yield) ? o.yield : 0, ac = good(o.acres) ? o.acres : 0;
    var per = value(lbUnit, pr);
    var r = { crop: c, src: sx, lb: lbUnit, spread: spread(c, pr), lbAc: { p: lbUnit.p * y, k: lbUnit.k * y }, perUnit: per, perAc: null, field: null, perBaledTon: null,
      perBale: null, balesAc: null, sale: null };
    if (per.pk != null) { r.perAc = per.pk * y; r.field = ac ? r.perAc * ac : null; }
    if (c.basis === 'dm') {
      var m = (typeof o.baleMoist === 'number' && o.baleMoist >= 0 && o.baleMoist < 100) ? o.baleMoist : null;
      if (m != null) {
        var dmShare = 1 - m / 100;
        if (per.pk != null) r.perBaledTon = per.pk * dmShare;
        if (good(o.baleLb)) {
          if (per.pk != null) r.perBale = r.perBaledTon * o.baleLb / 2000;
          if (y) r.balesAc = y / dmShare * 2000 / o.baleLb;
        }
      }
    }
    if (good(o.sale)) {
      var nv = o.saleUnit === 'bale' ? r.perBale : o.saleUnit === 'acre' ? r.perAc
        : (c.basis === 'dm' ? r.perBaledTon : per.pk);
      if (nv != null) r.sale = { sale: o.sale, unit: o.saleUnit, nutrient: nv, left: o.sale - nv, share: nv / o.sale };
    }
    return r;
  }

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function day(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? MON[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0] : ''; }
  function money(v, dec) {
    if (v == null || !isFinite(v)) return 'no price';
    var d = dec == null ? 2 : dec, neg = v < 0, s = Math.abs(v).toFixed(d).split('.');
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-$' : '$') + s.join('.');
  }
  function lbs(v) { return (Math.round(v * 10) / 10).toLocaleString('en-US'); }

  /* The how-it-was-figured lines, the same words the page prints. */
  function prod(r) { return r.name === r.symbol ? r.name : r.name + ' ' + r.symbol; }
  function derivation(pr) {
    var o = {};
    o.n = pr.n ? prod(pr.n.row) + ' at ' + money(pr.n.row.price) + ' a ton (' + pr.n.row.label + ') / (2,000 lb x ' + pr.n.row.g.N + '% N) = ' + money(pr.n.usd) + ' a lb of N.' : 'Nitrogen: no price in the list.';
    o.p = pr.p ? prod(pr.p.row) + ' at ' + money(pr.p.row.price) + ' a ton (' + pr.p.row.label + ')' +
      (pr.p.nLb ? ', less its ' + Math.round(pr.p.nLb) + ' lb of N at the ' + pr.n.row.name.toLowerCase() + ' price (' + money(pr.p.credit) + ')' : '') +
      ', / ' + Math.round(20 * pr.p.row.g.P) + ' lb of P2O5 = ' + money(pr.p.usd) + ' a lb of P2O5.' : 'Phosphate: no price in the list.';
    o.k = pr.k ? prod(pr.k.row) + ' at ' + money(pr.k.row.price) + ' a ton (' + pr.k.row.label + ') / (2,000 lb x ' + pr.k.row.g.K + '% K2O) = ' + money(pr.k.usd) + ' a lb of K2O.' : 'Potash: no price in the list.';
    return o;
  }

  var api = { CROPS: CROPS, STOVER_SRC: STOVER_SRC, source: source, spread: spread, crop: crop, grade: grade, nutrientPrices: nutrientPrices, value: value, cropLine: cropLine,
    derivation: derivation, money: money, day: day };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.NutrientRemoval = api;

  /* ---------- browser ---------- */
  var d = root.document;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function $(sel, el) { return (el || d).querySelector(sel); }
  function all(sel) { return Array.prototype.slice.call(d.querySelectorAll(sel)); }
  function unitWord(c) { return c.basis === 'bu' ? 'bu' : c.basis === 'dm' ? 'dry ton' : 'ton'; }

  function fillPrices(pr, data) {
    var box = $('#nr-prices'); if (!box) return;
    var items = [['N', 'n', 'lb N'], ['P₂O₅', 'p', 'lb P₂O₅'], ['K₂O', 'k', 'lb K₂O']].map(function (a) {
      var x = pr[a[1]];
      if (!x) return '<li>' + a[0] + ' a lb<b>no price</b>none in the list</li>';
      return '<li>' + a[0] + ' a lb<b>' + money(x.usd) + '</b>' + esc(x.row.name) + (a[1] === 'p' && x.nLb ? ', N credited at the urea price' : '') +
        '<br><span>' + esc(x.row.label) + '</span></li>';
    }).join('');
    box.innerHTML = items;
    var dv = derivation(pr), math = $('#nr-math');
    if (math) math.innerHTML = ['n', 'p', 'k'].map(function (x) { return '<li>' + esc(dv[x]) + '</li>'; }).join('');
    var regs = ['p', 'k'].filter(function (x) { return pr[x] && pr[x].row.region; }).map(function (x) { return pr[x].row.region; });
    all('[data-nr="region"]').forEach(function (el) { el.textContent = regs.length && regs[0] === regs[regs.length - 1] ? regs[0] + ' co-ops' : 'co-ops'; });
    all('[data-nr="asof"]').forEach(function (el) {
      var dates = ['p', 'k'].filter(function (x) { return pr[x]; }).map(function (x) { return pr[x].row.as_of; }).sort();
      el.textContent = dates.length ? day(dates[dates.length - 1]) : 'no date';
    });
  }

  function fillTable(pr) {
    all('tr[data-crop]').forEach(function (tr) {
      var c = crop(tr.getAttribute('data-crop')); if (!c) return;
      var v = value({ p: c.p, k: c.k, n: c.n }, pr);
      var cell = tr.querySelector('[data-o="usd"]');
      if (cell) cell.textContent = v.pk == null ? 'no price' : money(v.pk);
      var cb = tr.querySelector('[data-o="usd-baled"]');
      if (cb) cb.textContent = c.basis === 'dm' && v.pk != null ? money(v.pk * 0.85) : '';
    });
    var st = crop('corn_stover'), sp = spread(st, pr);
    all('[data-o="usd-alt"]').forEach(function (el) {
      var o = spread({ alt: st.alt.slice(1) }, pr);
      el.textContent = o ? money(o.lo.usd) + ' to ' + money(o.hi.usd) : 'no price';
    });
    all('[data-o="usd-alt-baled"]').forEach(function (el) {
      var o = spread({ alt: st.alt.slice(1) }, pr);
      el.textContent = o ? money(o.lo.usd * 0.85) + ' to ' + money(o.hi.usd * 0.85) : '';
    });
    all('[data-nr-spread]').forEach(function (el) {
      el.textContent = sp ? money(sp.lo.usd) + ' (' + sp.lo.src.short + ') to ' + money(sp.hi.usd) + ' (' + sp.hi.src.short + ')' : 'no price yet';
    });
    var hs = all('[data-nr-ans]');
    hs.forEach(function (el) {
      var c = crop(el.getAttribute('data-nr-ans')); if (!c) return;
      var v = value({ p: c.p, k: c.k, n: c.n }, pr), what = el.getAttribute('data-what');
      var x = what === 'p' ? v.p : what === 'k' ? v.k : v.pk;
      el.textContent = x == null ? 'no price yet' : money(x);
    });
  }

  function calc(pr) {
    var root2 = $('#nr-calc'); if (!root2) return;
    var opts = '', g = '';
    CROPS.forEach(function (c) {
      if (c.group !== g) { if (g) opts += '</optgroup>'; opts += '<optgroup label="' + esc(c.group) + '">'; g = c.group; }
      opts += '<option value="' + c.id + '"' + (c.id === 'corn_stover' ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    });
    opts += '</optgroup>';
    root2.innerHTML =
      '<div class="nr-form">' +
      '<label class="nr-wide">Crop or what you are hauling off<select data-k="crop">' + opts + '</select></label>' +
      '<label><span data-o="y-lab">Dry tons an acre</span><input data-k="yield" type="number" inputmode="decimal" min="0" step="any"></label>' +
      '<label class="nr-wide" data-src>Pounds from<select data-k="src">' + STOVER_SRC.map(function (x) {
        return '<option value="' + x.id + '">' + esc(x.short) + ': ' + (Math.round(x.p * 10) / 10) + ' lb P₂O₅, ' + (Math.round(x.k * 10) / 10) + ' lb K₂O a dry ton</option>';
      }).join('') + '</select></label>' +
      '<label>Acres<input data-k="acres" type="number" inputmode="decimal" min="0" step="any" value="80"></label>' +
      '<label data-bale>Bale weight, lb<input data-k="baleLb" type="number" inputmode="decimal" min="0" step="any" value="1000"></label>' +
      '<label data-bale>Bale moisture, %<input data-k="baleMoist" type="number" inputmode="decimal" min="0" max="80" step="any" value="15"></label>' +
      '<label>Sale price (optional)<input data-k="sale" type="number" inputmode="decimal" min="0" step="any" placeholder="blank = not selling"></label>' +
      '<label>per<select data-k="saleUnit"><option value="bale">bale</option><option value="ton">ton</option><option value="acre">acre</option></select></label>' +
      '</div><p class="nr-fine" data-o="hint"></p><div class="nr-out" data-o="out" aria-live="polite"></div>';
    function q(k) { return root2.querySelector('[data-k="' + k + '"]'); }
    function num(k) { var x = parseFloat(q(k).value); return isFinite(x) ? x : null; }
    var last = null;
    function onCrop() {
      var c = crop(q('crop').value);
      q('yield').value = c.def;
      root2.querySelector('[data-o="y-lab"]').textContent = c.basis === 'bu' ? 'Bushels an acre' : c.basis === 'dm' ? 'Dry tons an acre' : 'Tons an acre at ' + c.moist + '% moisture';
      all('[data-bale]').forEach(function (el) { el.hidden = !c.bale; });
      all('[data-src]').forEach(function (el) { el.hidden = !c.alt; });
      var su = q('saleUnit');
      su.querySelector('option[value="bale"]').hidden = !c.bale;
      su.querySelector('option[value="ton"]').textContent = c.basis === 'bu' ? 'bushel' : c.basis === 'dm' ? 'ton as baled' : 'ton';
      if (!c.bale && su.value === 'bale') su.value = 'ton';
      root2.querySelector('[data-o="hint"]').textContent = 'Starting yield ' + c.def + ' ' + (c.basis === 'bu' ? 'bu' : c.basis === 'dm' ? 'dry ton' : 'ton') + ': ' + c.defWhy + '. Put in yours.' +
        (c.bale ? ' A2809 counts stalks, straw and hay by the dry ton, so bale weight and moisture turn it into bales. Weigh a few bales; 1,000 lb and 15% are only a start.' : '');
      run();
    }
    function run() {
      var c = crop(q('crop').value);
      var o = { crop: c.id, src: q('src').value, yield: num('yield'), acres: num('acres'), baleLb: num('baleLb'), baleMoist: num('baleMoist'),
        sale: num('sale'), saleUnit: q('saleUnit').value };
      var r = cropLine(o, pr); last = r;
      var out = root2.querySelector('[data-o="out"]'), u = c.basis === 'bu' ? 'bushel' : c.basis === 'dm' ? 'dry ton' : 'ton at ' + c.moist + '%';
      var h = '<div class="nr-big"><div><span class="nr-k">P and K hauled off an acre</span><b>' + lbs(r.lbAc.p) + '</b> lb P₂O₅ &middot; <b>' + lbs(r.lbAc.k) + '</b> lb K₂O</div>' +
        '<div><span class="nr-k">Cost to put it back, an acre</span><b class="nr-gold">' + money(r.perAc) + '</b></div></div>';
      h += '<table class="nr-t nr-res"><tbody>' +
        '<tr><th scope="row">P₂O₅, per ' + u + '</th><td>' + lbs(r.lb.p) + ' lb</td><td>' + money(r.perUnit.p) + '</td></tr>' +
        '<tr><th scope="row">K₂O, per ' + u + '</th><td>' + lbs(r.lb.k) + ' lb</td><td>' + money(r.perUnit.k) + '</td></tr>' +
        '<tr><th scope="row">P and K, per ' + u + '</th><td></td><td class="hi">' + money(r.perUnit.pk) + '</td></tr>';
      if (c.basis === 'dm') {
        h += '<tr><th scope="row">Per ton as baled' + (o.baleMoist != null ? ' (' + o.baleMoist + '% moisture)' : '') + '</th><td></td><td class="hi">' + (r.perBaledTon == null ? 'needs moisture' : money(r.perBaledTon)) + '</td></tr>';
        h += '<tr><th scope="row">Per bale' + (good(o.baleLb) ? ' (' + o.baleLb.toLocaleString('en-US') + ' lb)' : '') + '</th><td>' + (r.balesAc != null ? 'about ' + (Math.round(r.balesAc * 10) / 10) + ' bales an acre' : '') + '</td><td class="hi">' + (r.perBale == null ? 'needs weight' : money(r.perBale)) + '</td></tr>';
      }
      h += '<tr><th scope="row">An acre</th><td>' + (o.yield || 0) + ' ' + (c.basis === 'bu' ? 'bu' : c.basis === 'dm' ? 'dry ton' : 'ton') + '</td><td class="hi">' + money(r.perAc) + '</td></tr>';
      if (r.field != null) h += '<tr><th scope="row">' + o.acres.toLocaleString('en-US') + ' acres</th><td></td><td class="hi">' + money(r.field, 0) + '</td></tr>';
      h += '</tbody></table>';
      if (r.sale) {
        var w = r.sale.unit === 'bale' ? 'a bale' : r.sale.unit === 'acre' ? 'an acre' : c.basis === 'bu' ? 'a bushel' : 'a ton';
        h += '<div class="nr-sale"><p><b>You sell for ' + money(r.sale.sale) + ' ' + w + '.</b> The P and K going with it cost ' + money(r.sale.nutrient) + ' ' + w +
          ' to buy back at these prices, ' + Math.round(r.sale.share * 100) + '% of the sale. ' +
          (r.sale.left >= 0 ? money(r.sale.left) + ' ' + w + ' is left after the P and K.' : 'The P and K cost ' + money(-r.sale.left) + ' ' + w + ' more than the sale brings.') +
          '</p><p class="nr-fine">This is only the fertilizer side. Baling, hauling, organic matter, erosion and the next crop are yours to weigh.</p></div>';
      } else if (good(o.sale)) {
        h += '<p class="nr-fine">Sale comparison needs a price for P and K' + (o.saleUnit === 'bale' ? ', a bale weight and moisture' : '') + '.</p>';
      }
      if (r.src) {
        h += '<p class="nr-fine nr-src">The dollars above use <b>' + esc(r.src.short) + '</b>: ' + esc(r.src.cite) + '. ' +
          (r.spread ? 'Across the guides read here, a dry ton of stalks runs ' + money(r.spread.lo.usd) + ' (' + esc(r.spread.lo.src.short) + ') to ' +
            money(r.spread.hi.usd) + ' (' + esc(r.spread.hi.src.short) + ') at these prices. ' : '') +
          'Iowa State notes rain after harvest washes potash out of stalks, so bales made after a wet fall carry less than the plant held at maturity. A forage test settles it.</p>';
      }
      h += '<p class="nr-fine">Nitrogen and sulfur are not counted: ' + (c.basis === 'bu' ? 'A2809 gives no N or S removal for grain.' : 'A2809, the source for these pounds, gives no N or S removal per ton.') + ' ' + (c.note ? esc(c.note) : '') + '</p>';
      out.innerHTML = h;
    }
    q('crop').addEventListener('change', onCrop);
    ['yield', 'acres', 'baleLb', 'baleMoist', 'sale'].forEach(function (k) { q(k).addEventListener('input', run); });
    q('src').addEventListener('change', run);
    q('saleUnit').addEventListener('change', run);
    var pre = (root.location && /[?&]crop=([a-z_]+)/.exec(root.location.search || '')) || null;
    if (pre && crop(pre[1])) q('crop').value = pre[1];
    var preS = (root.location && /[?&]src=([a-z0-9]+)/.exec(root.location.search || '')) || null;
    if (preS && STOVER_SRC.some(function (x) { return x.id === preS[1]; })) q('src').value = preS[1];
    onCrop();
  }

  function noPrices() {
    var box = $('#nr-prices');
    if (box) box.innerHTML = '<li class="nr-empty">Prices did not load. The pounds below still hold; the dollars fill in from the posted price list when it loads.</li>';
    all('[data-o="usd"]').forEach(function (el) { el.textContent = 'no price'; });
    all('[data-nr-ans]').forEach(function (el) { el.textContent = 'no price yet'; });
  }

  function getJson(u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function start() {
    /* the reader's own state's co-op sheets first (components/fert-pick.js); no co-op is named */
    (root.AgFertPick ? root.AgFertPick.load() : getJson('/data/fertilizer-prices.json')).then(function (data) {
      var pr = data ? nutrientPrices(data) : { n: null, p: null, k: null };
      if (!data) noPrices(); else { fillPrices(pr, data); fillTable(pr); }
      calc(pr);
    });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : this);
