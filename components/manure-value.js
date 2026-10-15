/* components/manure-value.js -- what manure is worth at today's posted fertilizer
 * prices, per 1,000 gallons or per ton, per acre and for the whole field.
 * The headline is the value of ALL the N, P2O5 and K2O in the manure. Beside
 * it is the part a crop can use the first year. A reader's own manure test
 * (total pounds) replaces the book pounds.
 *
 * ONE COPY. /manure-value and the Manure tab on /fast-facts both load this
 * file. The nutrient table (TYPES), the price math and the calculator live
 * here and nowhere else; test/manure-value.test.mjs fails if a page grows its
 * own copy, or if a page's table or baked numbers drift from this file.
 *
 * Pure parts (TYPES, nutrientPrices, perUnit, fieldValue, bakeValues) run with no
 * document, so node can test the copy the browser runs. The DOM part mounts
 * a calculator into every [data-mv-calc] and refreshes every [data-mv] number
 * from /data/fertilizer-prices.json on load.
 *
 * Source: UW Extension A2809, "Nutrient Application Guidelines for Field,
 * Vegetable, and Fruit Crops in Wisconsin" (Laboski and Peters, R-11-2012;
 * the copy UW posted March 2026, cropsandsoils.extension.wisc.edu/files/2026/03/A2809-web.pdf),
 * chapter 9:
 *   tot   Table 9.2, typical TOTAL N, P2O5, K2O of Wisconsin manures tested
 *         1998-2012, lb/ton (solid) or lb/1,000 gal (liquid).
 *   n,p,k Table 9.3, estimated first-year AVAILABLE nutrients: N by time to
 *         incorporation (> 72 hours or not, 1 to 72 hours, < 1 hour or
 *         injected), then P2O5 and K2O. Table 9.3 is Table 9.2 x Table 9.1,
 *         rounded by UW; the test checks every row against that.
 *   nPct  Table 9.1, first-year N availability, % of total, same three
 *         timings. P2O5 and K2O are 80% for every species (PK_PCT). Used to
 *         turn a reader's test (total pounds) into first-year pounds.
 *   n2    second-year N, 10% of total N (Table 9.1), rounded.
 *
 * Prices: data/fertilizer-prices.json (scripts/build_fert_prices.py): each
 * product's middle cash price posted by co-ops, or where the co-ops do not
 * cover it the USDA AMS Illinois average; each row with its source and date.
 * Nothing typed by hand. A product with no live price gives "no price".
 *   N     urea 46-0-0:      $/ton / (2000 x 0.46)
 *   P2O5  MAP 11-52-0, or DAP 18-46-0 when MAP has no price:
 *         ($/ton - N lb a ton x N $/lb) / (2000 x P2O5 share)
 *         MAP carries 220 lb of N a ton, DAP 360. Charging the whole ton to P
 *         makes phosphate look dearer than it is, so the N is credited at the
 *         urea price.
 *   K2O   potash 0-0-60 (or the grade the source names): $/ton / (2000 x K2O share)
 *
 * Until 2026-10-15 these came from a hand-typed dealer sheet (with MAP +
 * sulfur 12-40-0-10S for P). That sheet is gone: every price here now has a
 * live source.
 */
(function (w) {
  'use strict';

  var LB_PER_GAL = 8.34;                       // water; liquid manure runs close to it
  var TONS_PER_KGAL = 1000 * LB_PER_GAL / 2000; // 4.17 tons in 1,000 gallons

  /* tot: [N, P2O5, K2O] total (A2809 Table 9.2). n: first-year N [not within
     3 days, 1 hour to 3 days, within 1 hour], p, k: first-year P2O5, K2O
     (Table 9.3). nPct: first-year N % of total (Table 9.1). n2: second-year N. */
  var TYPES = [
    { id: 'dairy_solid_gt20',  group: 'Dairy',   label: 'Solid, over 20% dry matter',   liquid: false, a2809: 'Dairy: solid (> 20.0% DM)',            tot: [9, 4, 7],    nPct: [25, 30, 35], n: [2, 3, 3],    n2: 1, p: 3,  k: 6 },
    { id: 'dairy_solid_11_20', group: 'Dairy',   label: 'Solid, 11 to 20% dry matter',  liquid: false, a2809: 'Dairy: semi-solid (11.1-20.0% DM)',    tot: [8, 4, 6],    nPct: [25, 30, 35], n: [2, 2, 3],    n2: 1, p: 3,  k: 5 },
    { id: 'dairy_liq_4_11',    group: 'Dairy',   label: 'Liquid, 4 to 11% dry matter',  liquid: true,  a2809: 'Dairy: slurry (4.1-11.0% DM)',         tot: [24, 8, 21],  nPct: [30, 40, 50], n: [7, 10, 12],  n2: 2, p: 6,  k: 17 },
    { id: 'dairy_liq_lt4',     group: 'Dairy',   label: 'Liquid, under 4% dry matter',  liquid: true,  a2809: 'Dairy: liquid (< 4.0% DM)',            tot: [14, 4, 14],  nPct: [30, 40, 50], n: [4, 6, 7],    n2: 1, p: 3,  k: 11 },
    { id: 'beef_solid',        group: 'Beef',    label: 'Solid',                         liquid: false, a2809: 'Beef (solid)',                         tot: [13, 8, 12],  nPct: [25, 30, 35], n: [3, 4, 5],    n2: 1, p: 6,  k: 10 },
    { id: 'beef_liq',          group: 'Beef',    label: 'Liquid',                        liquid: true,  a2809: 'Beef (liquid)',                        tot: [16, 7, 15],  nPct: [30, 40, 50], n: [5, 6, 8],    n2: 2, p: 6,  k: 12 },
    { id: 'swine_solid',       group: 'Hog',     label: 'Solid',                         liquid: false, a2809: 'Swine (solid)',                        tot: [18, 13, 10], nPct: [40, 50, 65], n: [7, 9, 12],   n2: 2, p: 10, k: 8 },
    { id: 'swine_liq_fin_in',  group: 'Hog',     label: 'Liquid, finishing, indoor pit', liquid: true,  a2809: 'Swine: finish (indoor pit)',           tot: [43, 18, 28], nPct: [40, 50, 65], n: [17, 22, 28], n2: 4, p: 14, k: 22 },
    { id: 'swine_liq_fin_out', group: 'Hog',     label: 'Liquid, finishing, outdoor storage', liquid: true, a2809: 'Swine: finish (outdoor pit)',     tot: [18, 7, 10],  nPct: [40, 50, 65], n: [7, 9, 12],   n2: 2, p: 6,  k: 8 },
    { id: 'chicken_solid',     group: 'Poultry', label: 'Chicken, solid',                liquid: false, a2809: 'Poultry: chicken',                     tot: [49, 44, 33], nPct: [50, 55, 60], n: [24, 27, 29], n2: 5, p: 35, k: 26 },
    { id: 'turkey_solid',      group: 'Poultry', label: 'Turkey, solid',                 liquid: false, a2809: 'Poultry: turkey',                      tot: [51, 44, 31], nPct: [50, 55, 60], n: [26, 28, 31], n2: 5, p: 35, k: 25 },
    { id: 'horse_solid',       group: 'Horse',   label: 'Solid',                         liquid: false, a2809: 'Horse',                                tot: [10, 6, 8],   nPct: [25, 30, 35], n: [2, 3, 4],    n2: 1, p: 5,  k: 6 }
  ];
  var PK_PCT = 80;   // A2809 Table 9.1: first-year P2O5 and K2O, % of total, every species
  var TIMING = [
    { id: 'gt3day',  i: 0, label: 'Not worked in within 3 days' },
    { id: '1to3day', i: 1, label: 'Worked in 1 hour to 3 days' },
    { id: 'lt1hr',   i: 2, label: 'Worked in or injected within 1 hour' }
  ];
  function type(id) { for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i]; return null; }
  function timing(id) { for (var i = 0; i < TIMING.length; i++) if (TIMING[i].id === id) return TIMING[i]; return null; }

  /* "12-40-0-10S" -> {N:12,P:40,K:0,S:10} */
  function grade(sym) {
    var a = String(sym || '').trim().split('-');
    if (a.length < 3) return null;
    var g = { N: +a[0], P: +a[1], K: +a[2], S: 0 };
    if (isNaN(g.N) || isNaN(g.P) || isNaN(g.K)) return null;
    for (var i = 3; i < a.length; i++) { var m = /([\d.]+)\s*S$/i.exec(a[i]); if (m) g.S = +m[1]; }
    return g;
  }
  function byKey(data, key) {
    var list = (data && data.prices) || [];
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return null;
  }
  function ok(p) { return p && typeof p.price === 'number' && isFinite(p.price) && p.price > 0; }
  function srcOf(p) {
    return { key: p.key, name: p.name, symbol: p.symbol, price: p.price, as_of: p.as_of || null, label: p.src_label || null, src: p.src || null };
  }

  /* $/lb of N, P2O5 and K2O from fertilizer-prices.json. A product with no
     usable price gives null for its nutrient, never zero. */
  function nutrientPrices(data) {
    var urea = byKey(data, 'urea');
    var phos = ok(byKey(data, 'map')) ? byKey(data, 'map') : byKey(data, 'dap');
    var pot = byKey(data, 'potash');
    var out = { n: null, p: null, k: null, pRaw: null, pNlb: null, pNcredit: null, src: {} };
    if (ok(urea)) {
      var gu = grade(urea.symbol) || { N: 46 };
      out.n = urea.price / (2000 * gu.N / 100);
      out.src.n = srcOf(urea);
      out.src.n.share = gu.N;
    }
    if (ok(phos)) {
      var gm = grade(phos.symbol);
      if (gm && gm.P > 0) {
        out.pRaw = phos.price / (2000 * gm.P / 100);
        out.pNlb = 2000 * gm.N / 100;
        out.src.p = srcOf(phos);
        out.src.p.share = gm.P;
        out.src.p.nShare = gm.N;
        if (out.n != null) {                       // no N price, no credit: print nothing rather than guess
          out.pNcredit = out.pNlb * out.n;
          out.p = (phos.price - out.pNcredit) / (2000 * gm.P / 100);
        }
      }
    }
    if (ok(pot)) {
      var gk = grade(pot.symbol) || { K: 60 };
      out.k = pot.price / (2000 * gk.K / 100);
      out.src.k = srcOf(pot);
      out.src.k.share = gk.K;
    }
    return out;
  }

  /* A reader's manure test: {n, p, k} lb per unit, each a number >= 0 or
     null. A filled box replaces that nutrient's book value; a blank one
     leaves the book value. Returns null when no box is filled. */
  function cleanTest(test) {
    if (!test) return null;
    var out = {}, any = false;
    ['n', 'p', 'k'].forEach(function (x) {
      var v = test[x];
      if (v === '' || v == null) { out[x] = null; return; }
      v = +v;
      if (isFinite(v) && v >= 0) { out[x] = v; any = true; } else out[x] = null;
    });
    return any ? out : null;
  }

  function price(lb, prices) {
    var usd = {}, total = 0, missing = [];
    ['n', 'p', 'k'].forEach(function (x) {
      if (prices[x] == null) { usd[x] = null; missing.push(x); return; }
      usd[x] = lb[x] * prices[x]; total += usd[x];
    });
    return { usd: usd, total: missing.length ? null : total, missing: missing };
  }

  /* Pounds and dollars in one unit (1 ton solid, 1,000 gal liquid).
     lb/usd/total: ALL the N, P2O5 and K2O in the manure (A2809 Table 9.2, or
     the reader's test). fy: the part a crop can use the first year (Table
     9.3; a test's pounds times the Table 9.1 shares). Test pounds (optional
     4th argument, total pounds as a lab reports them) replace the book
     nutrient by nutrient. */
  function perUnit(typeId, timingId, prices, test) {
    var t = type(typeId), tm = timing(timingId);
    if (!t || !tm) return null;
    var lb = { n: t.tot[0], p: t.tot[1], k: t.tot[2] };
    var fyLb = { n: t.n[tm.i], p: t.p, k: t.k };
    var share = { n: t.nPct[tm.i] / 100, p: PK_PCT / 100, k: PK_PCT / 100 };
    var fromTest = {}, ct = cleanTest(test);
    ['n', 'p', 'k'].forEach(function (x) {
      fromTest[x] = !!(ct && ct[x] != null);
      if (fromTest[x]) { lb[x] = ct[x]; fyLb[x] = ct[x] * share[x]; }
    });
    var all = price(lb, prices), fy = price(fyLb, prices);
    return { unit: t.liquid ? '1000gal' : 'ton', lb: lb, usd: all.usd, total: all.total, missing: all.missing, fromTest: fromTest,
             fy: { lb: fyLb, usd: fy.usd, total: fy.total } };
  }
  /* Value of all the nutrients per ton, any type. Liquids convert at
     8.34 lb a gallon. */
  function perTon(typeId, timingId, prices) {
    var u = perUnit(typeId, timingId, prices);
    if (!u || u.total == null) return null;
    return type(typeId).liquid ? u.total / TONS_PER_KGAL : u.total;
  }

  /* The value of the manure on a field. o: {type, timing, rate (gal or
     tons an acre), acres, prices, test (optional {n, p, k} total lb per
     unit)}. Pounds and dollars of each nutrient an acre and for the field,
     the total per unit, per ton, per acre and for the field, and the same
     for the first-year part under fy. */
  function fieldValue(o) {
    var t = type(o.type);
    if (!t) return null;
    var u = perUnit(o.type, o.timing, o.prices, o.test);
    if (!u) return null;
    if (u.total == null) return { missing: true };
    var units = t.liquid ? Math.max(0, o.rate || 0) / 1000 : Math.max(0, o.rate || 0);   // units an acre
    var acres = Math.max(0, o.acres || 0);
    function spread(lb, usd, total) {
      var r = { lbAc: {}, usdAc: {}, usdField: {} };
      ['n', 'p', 'k'].forEach(function (x) { r.lbAc[x] = lb[x] * units; r.usdAc[x] = usd[x] * units; r.usdField[x] = r.usdAc[x] * acres; });
      r.perUnitUsd = usd; r.perUnit = total; r.perTon = t.liquid ? total / TONS_PER_KGAL : total;
      r.perAcre = total * units; r.field = total * units * acres;
      return r;
    }
    var out = spread(u.lb, u.usd, u.total);
    out.unit = u.unit; out.units = units; out.acres = acres; out.fromTest = u.fromTest;
    out.fy = spread(u.fy.lb, u.fy.usd, u.fy.total);
    return out;
  }

  function money(v, dec) {
    if (v == null || !isFinite(v)) return '';
    var neg = v < 0, a = Math.abs(v);
    var s = dec === 0 ? Math.round(a).toLocaleString('en-US') : a.toFixed(dec == null ? 2 : dec).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-$' : '$') + s;
  }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? MON[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : '';
  }

  /* The worked example on /manure-value: liquid dairy manure on 80 acres. */
  var EXAMPLE = { type: 'dairy_liq_4_11', timing: '1to3day', rate: 6000, acres: 80 };

  /* Every number the pages print from prices, by key. The bake script writes
     these into the HTML; the page rewrites them from live data on load. One
     function for both, so they cannot disagree. Missing price -> 'no price'.
       all-<type>            all the nutrients, per ton or 1,000 gal
       all-ton-<type>        the same per ton
       fy-<type>-<timing>    the first-year part, per ton or 1,000 gal
       fy-ton-<type>-<timing>
       ex-*                  the worked example (EXAMPLE) */
  /* The arithmetic behind each $/lb, in words, with the source and date. */
  function derivation(pr) {
    var s = pr.src, out = { n: NQ, p: NQ, k: NQ };
    function src(x) { return x.label ? ' (' + x.label + ')' : (x.as_of ? ' (' + day(x.as_of) + ')' : ''); }
    if (s.n && pr.n != null) out.n = 'Urea ' + s.n.symbol + ' at ' + money(s.n.price) + ' a ton' + src(s.n) + ' / (2,000 lb x ' + s.n.share + '% N) = ' + money(pr.n) + ' a lb of N.';
    if (s.p && pr.pRaw != null) {
      var plb = Math.round(2000 * s.p.share / 100);
      out.p = s.p.name + ' ' + s.p.symbol + ' at ' + money(s.p.price) + ' a ton' + src(s.p) +
        (pr.p != null ? ', less its ' + Math.round(pr.pNlb) + ' lb of N at the urea price (' + money(pr.pNcredit, 0) + '), / ' + plb + ' lb of P2O5 = ' + money(pr.p) + ' a lb of P2O5.'
          : ' / ' + plb + ' lb of P2O5 = ' + money(pr.pRaw) + ' a lb, with no N credit (urea has no price).');
    }
    if (s.k && pr.k != null) out.k = 'Potash ' + s.k.symbol + ' at ' + money(s.k.price) + ' a ton' + src(s.k) + ' / (2,000 lb x ' + s.k.share + '% K2O) = ' + money(pr.k) + ' a lb of K2O.';
    return out;
  }
  var NQ = 'no price';

  function bakeValues(data) {
    var pr = nutrientPrices(data), v = {};
    v['price-n'] = pr.n != null ? money(pr.n) : NQ;
    v['price-p'] = pr.p != null ? money(pr.p) : NQ;
    v['price-p-raw'] = pr.pRaw != null ? money(pr.pRaw) : NQ;
    v['price-k'] = pr.k != null ? money(pr.k) : NQ;
    v['p-ncredit'] = pr.pNcredit != null ? money(pr.pNcredit, 0) : NQ;
    v['p-nlb'] = pr.pNlb != null ? String(Math.round(pr.pNlb)) : NQ;
    v['p-prod'] = pr.src.p ? pr.src.p.name + ' ' + pr.src.p.symbol : NQ;
    v['p-name'] = pr.src.p ? pr.src.p.name : 'MAP or DAP';
    var dv = derivation(pr);
    ['n', 'p', 'k'].forEach(function (x) {
      var s = pr.src[x];
      v['ton-' + x] = s ? money(s.price, 0) : NQ;
      v['asof-' + x] = s && s.as_of ? day(s.as_of) : NQ;
      v['src-' + x] = s && s.label ? s.label : NQ;
      v['deriv-' + x] = dv[x];
    });
    function perTonOf(t, x) { return x == null ? NQ : money(t.liquid ? x / TONS_PER_KGAL : x); }
    TYPES.forEach(function (t) {
      var u0 = perUnit(t.id, TIMING[0].id, pr);
      v['all-' + t.id] = u0 && u0.total != null ? money(u0.total) : NQ;
      v['all-ton-' + t.id] = perTonOf(t, u0 && u0.total);
      TIMING.forEach(function (tm) {
        var u = perUnit(t.id, tm.id, pr);
        var key = t.id + '-' + tm.id;
        v['fy-' + key] = u && u.fy.total != null ? money(u.fy.total) : NQ;
        v['fy-ton-' + key] = perTonOf(t, u && u.fy.total);
      });
    });
    var e = fieldValue(Object.assign({ prices: pr }, EXAMPLE));
    var EX = ['ex-n-lb', 'ex-p-lb', 'ex-k-lb', 'ex-n-unit', 'ex-p-unit', 'ex-k-unit', 'ex-n-ac', 'ex-p-ac', 'ex-k-ac',
              'ex-n-field', 'ex-p-field', 'ex-k-field', 'ex-all', 'ex-all-ton', 'ex-all-ac', 'ex-all-field',
              'ex-fy-n-lb', 'ex-fy-p-lb', 'ex-fy-k-lb', 'ex-fy', 'ex-fy-ac', 'ex-fy-field'];
    if (e && !e.missing) {
      ['n', 'p', 'k'].forEach(function (x) {
        v['ex-' + x + '-lb'] = String(Math.round(e.lbAc[x]));
        v['ex-' + x + '-unit'] = money(e.perUnitUsd[x]);
        v['ex-' + x + '-ac'] = money(e.usdAc[x]);
        v['ex-' + x + '-field'] = money(e.usdField[x], 0);
        v['ex-fy-' + x + '-lb'] = String(Math.round(e.fy.lbAc[x]));
      });
      v['ex-all'] = money(e.perUnit); v['ex-all-ton'] = money(e.perTon); v['ex-all-ac'] = money(e.perAcre);
      v['ex-all-field'] = money(e.field, 0);
      v['ex-fy'] = money(e.fy.perUnit); v['ex-fy-ac'] = money(e.fy.perAcre); v['ex-fy-field'] = money(e.fy.field, 0);
    } else {
      EX.forEach(function (k) { v[k] = NQ; });
    }
    return v;
  }

  var API = { TYPES: TYPES, TIMING: TIMING, PK_PCT: PK_PCT, TONS_PER_KGAL: TONS_PER_KGAL, LB_PER_GAL: LB_PER_GAL, EXAMPLE: EXAMPLE,
              type: type, timing: timing, grade: grade, cleanTest: cleanTest, nutrientPrices: nutrientPrices, derivation: derivation, perUnit: perUnit,
              perTon: perTon, fieldValue: fieldValue, money: money, day: day, bakeValues: bakeValues };
  w.AgManure = API;

  /* ───────────── DOM: the calculator and live numbers ───────────── */
  var d = w.document;
  if (!d || !d.querySelectorAll) return;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var uid = 0;

  var BOOK_SRC = 'Book pounds: UW Extension A2809, Table 9.2 (typical totals in Wisconsin manure) and Table 9.3 (first year). Farm manure varies a lot, so your own test beats the book.';
  function calcHTML(id) {
    var opts = '', g = '';
    TYPES.forEach(function (t) {
      if (t.group !== g) { opts += (g ? '</optgroup>' : '') + '<optgroup label="' + t.group + '">'; g = t.group; }
      opts += '<option value="' + t.id + '"' + (t.id === 'dairy_liq_4_11' ? ' selected' : '') + '>' + esc(t.group + ' ' + t.label.charAt(0).toLowerCase() + t.label.slice(1)) + '</option>';
    });
    opts += '</optgroup>';
    var tim = TIMING.map(function (t) { return '<option value="' + t.id + '"' + (t.id === '1to3day' ? ' selected' : '') + '>' + t.label + '</option>'; }).join('');
    return '' +
      '<div class="mvc-grid">' +
        '<label class="mvc-f mvc-wide"><span>Manure</span><select data-k="type">' + opts + '</select></label>' +
        '<label class="mvc-f mvc-wide"><span>Worked into the soil</span><select data-k="timing">' + tim + '</select></label>' +
        '<label class="mvc-f"><span data-u="rate">Rate, gallons an acre</span><input data-k="rate" type="number" inputmode="decimal" min="0" step="500" value="6000"></label>' +
        '<label class="mvc-f"><span>Acres</span><input data-k="acres" type="number" inputmode="decimal" min="0" step="5" value="80"></label>' +
      '</div>' +
      '<details class="mvc-prices mvc-test"><summary>Use my manure test <span data-o="test-sum"></span></summary>' +
        '<p class="mvc-hint">Type the total pounds from your lab report, <span data-u="test">per 1,000 gallons</span>, as P&#8322;O&#8325; and K&#8322;O. Every pound you enter counts. A blank box keeps the book value.</p>' +
        '<div class="mvc-grid">' +
          '<label class="mvc-f"><span>lb N</span><input data-k="tn" type="number" inputmode="decimal" min="0" step="0.1"></label>' +
          '<label class="mvc-f"><span>lb P&#8322;O&#8325;</span><input data-k="tp" type="number" inputmode="decimal" min="0" step="0.1"></label>' +
          '<label class="mvc-f"><span>lb K&#8322;O</span><input data-k="tk" type="number" inputmode="decimal" min="0" step="0.1"></label>' +
        '</div></details>' +
      '<details class="mvc-prices"><summary>Fertilizer prices used <span data-o="price-sum"></span></summary>' +
        '<div class="mvc-grid">' +
          '<label class="mvc-f"><span>$ per lb N</span><input data-k="pn" type="number" inputmode="decimal" min="0" step="0.01"></label>' +
          '<label class="mvc-f"><span>$ per lb P&#8322;O&#8325;</span><input data-k="pp" type="number" inputmode="decimal" min="0" step="0.01"></label>' +
          '<label class="mvc-f"><span>$ per lb K&#8322;O</span><input data-k="pk" type="number" inputmode="decimal" min="0" step="0.01"></label>' +
        '</div><p class="mvc-hint" data-o="price-src">Loading prices&hellip;</p></details>' +
      '<div class="mvc-out" aria-live="polite">' +
        '<div class="mvc-big"><span data-o="big-h">All the nutrients in the manure</span><strong data-o="unit">&nbsp;</strong><small data-o="unit-sub"></small></div>' +
        '<table class="mvc-t"><thead><tr><th scope="col">Nutrient</th><th scope="col">lb an acre</th><th scope="col">$ an acre</th><th scope="col" data-o="field-h">Field</th></tr></thead><tbody>' +
          '<tr><th scope="row" data-o="n-h">N</th><td data-o="n-lb"></td><td data-o="n-usd"></td><td data-o="n-field"></td></tr>' +
          '<tr><th scope="row" data-o="p-h">P&#8322;O&#8325;</th><td data-o="p-lb"></td><td data-o="p-usd"></td><td data-o="p-field"></td></tr>' +
          '<tr><th scope="row" data-o="k-h">K&#8322;O</th><td data-o="k-lb"></td><td data-o="k-usd"></td><td data-o="k-field"></td></tr>' +
          '<tr class="mvc-sum"><th scope="row">All of it</th><td></td><td data-o="ac"></td><td data-o="field"></td></tr>' +
        '</tbody></table>' +
        '<p class="mvc-fy" data-o="fy"></p>' +
        '<p class="mvc-hint" data-o="lb-src">' + BOOK_SRC + '</p>' +
      '</div>';
  }

  function mount(root, live) {
    var id = 'mvc' + (++uid);
    root.innerHTML = calcHTML(id);
    function q(sel) { return root.querySelector(sel); }
    function val(k) { var el = q('[data-k="' + k + '"]'); return el ? el.value : ''; }
    function num(k) { var x = parseFloat(val(k)); return isFinite(x) ? x : 0; }
    function set(k, html) { var el = q('[data-o="' + k + '"]'); if (el) el.innerHTML = html; }
    function prices() {
      function pv(k) { var el = q('[data-k="' + k + '"]'), s = el ? el.value : ''; if (s === '') return null;
        if (el.getAttribute('data-full') && el.getAttribute('data-shown') === s) return +el.getAttribute('data-full');  // the posted price, unrounded
        var x = parseFloat(s); return isFinite(x) && x >= 0 ? x : null; }
      return { n: pv('pn'), p: pv('pp'), k: pv('pk') };
    }
    var lastType = null;
    function run() {
      var t = type(val('type'));
      if (t && t.id !== lastType) {
        var wasLiquid = lastType ? type(lastType).liquid : true;
        if (wasLiquid !== t.liquid) {
          var r = q('[data-k="rate"]');
          r.value = t.liquid ? 6000 : 15; r.step = t.liquid ? 500 : 1;
        }
        lastType = t.id;
      }
      var u = t.liquid ? '1,000 gal' : 'ton';
      q('[data-u="rate"]').textContent = t.liquid ? 'Rate, gallons an acre' : 'Rate, tons an acre';
      q('[data-u="test"]').textContent = t.liquid ? 'per 1,000 gallons' : 'per ton';
      var test = cleanTest({ n: val('tn'), p: val('tp'), k: val('tk') });
      var res = fieldValue({ type: t.id, timing: val('timing'), rate: num('rate'), acres: num('acres'), prices: prices(), test: test });
      var NAME = { n: 'N', p: 'P&#8322;O&#8325;', k: 'K&#8322;O' };
      ['n', 'p', 'k'].forEach(function (x) { set(x + '-h', NAME[x] + (test && test[x] != null ? ', your test' : '')); });
      var nt = test ? ['n', 'p', 'k'].filter(function (x) { return test[x] != null; }).length : 0;
      set('test-sum', nt ? '(' + (nt === 3 ? 'all three' : nt + ' of 3') + ' from your test)' : '');
      set('big-h', nt === 3 ? 'All the nutrients, from your test' : nt ? 'All the nutrients, part from your test' : 'All the nutrients in the manure');
      set('lb-src', nt === 3 ? 'All the pounds are from your test, each one priced. The first-year part is your pounds times UW A2809&rsquo;s first-year shares (Table 9.1).' :
        nt ? 'Pounds marked &ldquo;your test&rdquo; are yours; the rest are UW Extension A2809 book pounds (Table 9.2 totals, Table 9.3 first year).' :
        BOOK_SRC);
      if (!res || res.missing) {
        set('unit', 'No price'); set('unit-sub', 'Enter a fertilizer price under "Fertilizer prices used" to see a value.');
        ['n-lb', 'n-usd', 'n-field', 'p-lb', 'p-usd', 'p-field', 'k-lb', 'k-usd', 'k-field', 'ac', 'field', 'fy'].forEach(function (k) { set(k, ''); });
        return;
      }
      var rate = t.liquid ? Math.round(num('rate')).toLocaleString('en-US') + ' gallons' : num('rate') + ' tons';
      set('unit', money(res.perUnit) + ' <span>per ' + u + '</span>');
      set('unit-sub', (t.liquid ? 'About ' + money(res.perTon) + ' a ton. ' : '') +
        money(res.perAcre) + ' an acre at ' + rate + (res.acres ? '. ' + money(res.field, 0) + ' for ' + res.acres.toLocaleString('en-US') + ' acres.' : '.'));
      set('field-h', res.acres ? res.acres.toLocaleString('en-US') + ' acres' : 'Field');
      ['n', 'p', 'k'].forEach(function (x) {
        set(x + '-lb', Math.round(res.lbAc[x]).toLocaleString('en-US'));
        set(x + '-usd', money(res.usdAc[x]));
        set(x + '-field', money(res.usdField[x], 0));
      });
      set('ac', money(res.perAcre));
      set('field', money(res.field, 0));
      var f = res.fy;
      set('fy', '<b>What the crop can use the first year: ' + money(f.perAcre) + ' an acre</b>' +
        (res.acres ? ', ' + money(f.field, 0) + ' for the field' : '') + ' (' + money(f.perUnit) + ' per ' + u + '). ' +
        Math.round(f.lbAc.n) + ' lb N, ' + Math.round(f.lbAc.p) + ' lb P&#8322;O&#8325; and ' + Math.round(f.lbAc.k) +
        ' lb K&#8322;O an acre, worked in as picked. The P and K not counted this year shows up in later soil tests; UW counts a little more of the N over the next two years, and some is lost to the air.');
    }
    root.addEventListener('input', run);
    root.addEventListener('change', run);
    function fill(pr) {
      [['pn', pr.n], ['pp', pr.p], ['pk', pr.k]].forEach(function (a) { var el = q('[data-k="' + a[0] + '"]'); if (el && a[1] != null) { el.value = a[1].toFixed(2); el.setAttribute('data-shown', el.value); el.setAttribute('data-full', String(a[1])); } });
      var s = [];
      var dv = derivation(pr);
      ['n', 'p', 'k'].forEach(function (x) { if (dv[x] !== NQ) s.push(dv[x].replace(/&/g, '&amp;').replace(/</g, '&lt;')); });
      set('price-src', s.length ? s.join(' ') + ' Type your own prices to redo it.' : 'Prices did not load. Type your own prices.');
      set('price-sum', pr.n != null ? '(N ' + money(pr.n) + ', P ' + (pr.p != null ? money(pr.p) : NQ) + ', K ' + (pr.k != null ? money(pr.k) : NQ) + ' a lb)' : '');
    }
    root._mvFill = function (pr) { fill(pr); run(); };
    run();
  }

  function liveNumbers(data) {
    var v = bakeValues(data);
    Array.prototype.forEach.call(d.querySelectorAll('[data-mv]'), function (el) {
      var k = el.getAttribute('data-mv');
      if (Object.prototype.hasOwnProperty.call(v, k)) el.textContent = v[k];
    });
  }

  function start() {
    var roots = d.querySelectorAll('[data-mv-calc]');
    Array.prototype.forEach.call(roots, function (r) { mount(r); });
    var get = w.AG && w.AG.json ? w.AG.json('/data/fertilizer-prices.json')
      : fetch('/data/fertilizer-prices.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
    get.then(function (data) {
      var pr = nutrientPrices(data);
      Array.prototype.forEach.call(roots, function (r) { if (r._mvFill) r._mvFill(pr); });
      liveNumbers(data);
    }).catch(function () {
      Array.prototype.forEach.call(roots, function (r) { if (r._mvFill) r._mvFill({ n: null, p: null, k: null, src: {} }); });
    });
  }
  API.mount = mount;
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : this);
