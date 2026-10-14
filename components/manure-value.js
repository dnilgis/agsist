/* components/manure-value.js -- what manure is worth at today's fertilizer
 * prices: the value of all the N, P2O5 and K2O in it, per 1,000 gallons or
 * per ton, per acre and for the whole field.
 *
 * ONE COPY. /manure-value and the Manure tab on /fast-facts both load this
 * file. The nutrient table (TYPES), the price math and the calculator live
 * here and nowhere else; test/manure-value.test.mjs fails if a page grows its
 * own copy, or if a page's table or baked numbers drift from this file.
 *
 * Pure parts (TYPES, nutrientPrices, perUnit, fieldValue, bakeValues) run with no
 * document, so node can test the copy the browser runs. The DOM part mounts
 * a calculator into every [data-mv-calc] and refreshes every [data-mv] number
 * from /data/fertilizer.json on load.
 *
 * Nutrient numbers: first-year available N (by days to incorporation), and
 * P2O5 and K2O, per ton (solid) or per 1,000 gallons (liquid). Book values
 * from UW Extension A2809, "Nutrient Application Guidelines for Field,
 * Vegetable, and Fruit Crops in Wisconsin" (Laboski and Peters), manure
 * chapter. The same numbers the Fast Facts table has carried since it was
 * built.
 *
 * Prices: data/fertilizer.json, Midwest dealer quotes, each with its date.
 *   N     urea 46-0-0:      $/ton / (2000 x 0.46)
 *   P2O5  MAP 12-40-0-10S:  ($/ton - 240 lb N x N $/lb) / (2000 x 0.40)
 *         MAP carries 240 lb of N a ton. Charging the whole ton to P made
 *         phosphate look about 20% dearer than it is. The N is credited at
 *         the urea price. The 200 lb of sulfur is not credited, so P still
 *         runs a little high.
 *   K2O   potash 0-0-60:    $/ton / (2000 x 0.60)
 */
(function (w) {
  'use strict';

  var LB_PER_GAL = 8.34;                       // water; liquid manure runs close to it
  var TONS_PER_KGAL = 1000 * LB_PER_GAL / 2000; // 4.17 tons in 1,000 gallons

  /* n: [not within 3 days, 1 hour to 3 days, within 1 hour], n2: second year */
  var TYPES = [
    { id: 'dairy_solid_gt20',  group: 'Dairy',   label: 'Solid, over 20% dry matter',   liquid: false, n: [2, 3, 3],    n2: 1, p: 3,  k: 6 },
    { id: 'dairy_solid_11_20', group: 'Dairy',   label: 'Solid, 11 to 20% dry matter',  liquid: false, n: [2, 2, 3],    n2: 1, p: 3,  k: 5 },
    { id: 'dairy_liq_4_11',    group: 'Dairy',   label: 'Liquid, 4 to 11% dry matter',  liquid: true,  n: [7, 10, 12],  n2: 2, p: 6,  k: 17 },
    { id: 'dairy_liq_lt4',     group: 'Dairy',   label: 'Liquid, under 4% dry matter',  liquid: true,  n: [4, 6, 7],    n2: 1, p: 3,  k: 11 },
    { id: 'beef_solid',        group: 'Beef',    label: 'Solid',                         liquid: false, n: [3, 4, 5],    n2: 1, p: 6,  k: 10 },
    { id: 'beef_liq',          group: 'Beef',    label: 'Liquid',                        liquid: true,  n: [5, 6, 8],    n2: 2, p: 6,  k: 12 },
    { id: 'swine_solid',       group: 'Hog',     label: 'Solid',                         liquid: false, n: [7, 9, 12],   n2: 2, p: 10, k: 8 },
    { id: 'swine_liq_fin_in',  group: 'Hog',     label: 'Liquid, finishing, indoor pit', liquid: true,  n: [17, 22, 28], n2: 4, p: 14, k: 22 },
    { id: 'swine_liq_fin_out', group: 'Hog',     label: 'Liquid, finishing, outdoor storage', liquid: true, n: [7, 9, 12], n2: 2, p: 6, k: 8 },
    { id: 'chicken_solid',     group: 'Poultry', label: 'Chicken, solid',                liquid: false, n: [24, 27, 29], n2: 5, p: 35, k: 26 },
    { id: 'turkey_solid',      group: 'Poultry', label: 'Turkey, solid',                 liquid: false, n: [26, 28, 31], n2: 5, p: 35, k: 25 },
    { id: 'horse_solid',       group: 'Horse',   label: 'Solid',                         liquid: false, n: [2, 3, 4],    n2: 1, p: 5,  k: 6 }
  ];
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
  function find(data, name, pred) {
    var list = (data && data.prices) || [], i, g;
    for (i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    for (i = 0; i < list.length; i++) { g = grade(list[i].symbol); if (g && pred(g)) return list[i]; }
    return null;
  }
  function ok(p) { return p && typeof p.price === 'number' && isFinite(p.price) && p.price > 0; }

  /* $/lb of N, P2O5 and K2O from fertilizer.json. A product with no usable
     quote gives null for its nutrient, never zero. */
  function nutrientPrices(data) {
    var urea = find(data, 'Urea', function (g) { return g.N > 0 && !g.P && !g.K && !g.S; });
    var map = find(data, 'MAP + Sulfur', function (g) { return g.P > 0 && g.N > 0; });
    var pot = find(data, 'Potash', function (g) { return g.K > 0 && !g.N && !g.P; });
    var out = { n: null, p: null, k: null, pRaw: null, mapNlb: null, mapNcredit: null, src: {} };
    if (ok(urea)) {
      var gu = grade(urea.symbol) || { N: 46 };
      out.n = urea.price / (2000 * gu.N / 100);
      out.src.n = { name: urea.name, symbol: urea.symbol, price: urea.price, as_of: urea.as_of || data.updated || null };
    }
    if (ok(map)) {
      var gm = grade(map.symbol) || { N: 12, P: 40 };
      out.pRaw = map.price / (2000 * gm.P / 100);
      out.mapNlb = 2000 * gm.N / 100;
      out.src.p = { name: map.name, symbol: map.symbol, price: map.price, as_of: map.as_of || data.updated || null };
      if (out.n != null) {                       // no N price, no credit: print nothing rather than guess
        out.mapNcredit = out.mapNlb * out.n;
        out.p = (map.price - out.mapNcredit) / (2000 * gm.P / 100);
      }
    }
    if (ok(pot)) {
      var gk = grade(pot.symbol) || { K: 60 };
      out.k = pot.price / (2000 * gk.K / 100);
      out.src.k = { name: pot.name, symbol: pot.symbol, price: pot.price, as_of: pot.as_of || data.updated || null };
    }
    return out;
  }

  /* Pounds and dollars in one unit (1 ton solid, 1,000 gal liquid). All the
     N, P2O5 and K2O in it count. */
  function perUnit(typeId, timingId, prices) {
    var t = type(typeId), tm = timing(timingId);
    if (!t || !tm) return null;
    var lb = { n: t.n[tm.i], p: t.p, k: t.k }, usd = {}, total = 0, missing = [];
    ['n', 'p', 'k'].forEach(function (x) {
      if (prices[x] == null) { usd[x] = null; missing.push(x); return; }
      usd[x] = lb[x] * prices[x]; total += usd[x];
    });
    return { unit: t.liquid ? '1000gal' : 'ton', lb: lb, usd: usd, total: missing.length ? null : total, missing: missing };
  }
  /* Value (all three nutrients) per ton, any type. Liquids convert at
     8.34 lb a gallon. */
  function perTon(typeId, timingId, prices) {
    var u = perUnit(typeId, timingId, prices);
    if (!u || u.total == null) return null;
    return type(typeId).liquid ? u.total / TONS_PER_KGAL : u.total;
  }

  /* The value of all the manure on a field. o: {type, timing, rate (gal or
     tons an acre), acres, prices}. Pounds and dollars of each nutrient an
     acre and for the field, and the total per unit, per ton, per acre and
     for the field. */
  function fieldValue(o) {
    var t = type(o.type);
    if (!t) return null;
    var u = perUnit(o.type, o.timing, o.prices);
    if (!u) return null;
    if (u.total == null) return { missing: true };
    var units = t.liquid ? Math.max(0, o.rate || 0) / 1000 : Math.max(0, o.rate || 0);   // units an acre
    var acres = Math.max(0, o.acres || 0);
    var lbAc = {}, usdAc = {}, usdField = {};
    ['n', 'p', 'k'].forEach(function (x) { lbAc[x] = u.lb[x] * units; usdAc[x] = u.usd[x] * units; usdField[x] = usdAc[x] * acres; });
    return {
      unit: u.unit, units: units, acres: acres,
      perUnitUsd: u.usd, perUnit: u.total, perTon: t.liquid ? u.total / TONS_PER_KGAL : u.total,
      lbAc: lbAc, usdAc: usdAc, usdField: usdField,
      perAcre: u.total * units, field: u.total * units * acres
    };
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
     function for both, so they cannot disagree. Missing price -> 'no quote'. */
  function bakeValues(data) {
    var pr = nutrientPrices(data), v = {}, NQ = 'no quote';
    v['price-n'] = pr.n != null ? money(pr.n) : NQ;
    v['price-p'] = pr.p != null ? money(pr.p) : NQ;
    v['price-p-raw'] = pr.pRaw != null ? money(pr.pRaw) : NQ;
    v['price-k'] = pr.k != null ? money(pr.k) : NQ;
    v['map-ncredit'] = pr.mapNcredit != null ? money(pr.mapNcredit, 0) : NQ;
    ['n', 'p', 'k'].forEach(function (x) {
      var s = pr.src[x];
      v['ton-' + x] = s ? money(s.price, 0) : NQ;
      v['asof-' + x] = s && s.as_of ? day(s.as_of) : NQ;
    });
    TYPES.forEach(function (t) {
      TIMING.forEach(function (tm) {
        var u = perUnit(t.id, tm.id, pr);
        var key = t.id + '-' + tm.id;
        v['unit-' + key] = u && u.total != null ? money(u.total) : NQ;
        v['ton-' + key] = t.liquid ? (u && u.total != null ? money(u.total / TONS_PER_KGAL) : NQ) : v['unit-' + key];
      });
    });
    var e = fieldValue(Object.assign({ prices: pr }, EXAMPLE));
    var EX = ['ex-n-lb', 'ex-p-lb', 'ex-k-lb', 'ex-n-unit', 'ex-p-unit', 'ex-k-unit', 'ex-n-ac', 'ex-p-ac', 'ex-k-ac',
              'ex-n-field', 'ex-p-field', 'ex-k-field', 'ex-book', 'ex-book-ac', 'ex-book-ton', 'ex-field'];
    if (e && !e.missing) {
      ['n', 'p', 'k'].forEach(function (x) {
        v['ex-' + x + '-lb'] = String(Math.round(e.lbAc[x]));
        v['ex-' + x + '-unit'] = money(e.perUnitUsd[x]);
        v['ex-' + x + '-ac'] = money(e.usdAc[x]);
        v['ex-' + x + '-field'] = money(e.usdField[x], 0);
      });
      v['ex-book'] = money(e.perUnit); v['ex-book-ac'] = money(e.perAcre); v['ex-book-ton'] = money(e.perTon);
      v['ex-field'] = money(e.field, 0);
    } else {
      EX.forEach(function (k) { v[k] = NQ; });
    }
    return v;
  }

  var API = { TYPES: TYPES, TIMING: TIMING, TONS_PER_KGAL: TONS_PER_KGAL, LB_PER_GAL: LB_PER_GAL, EXAMPLE: EXAMPLE,
              type: type, timing: timing, grade: grade, nutrientPrices: nutrientPrices, perUnit: perUnit,
              perTon: perTon, fieldValue: fieldValue, money: money, day: day, bakeValues: bakeValues };
  w.AgManure = API;

  /* ───────────── DOM: the calculator and live numbers ───────────── */
  var d = w.document;
  if (!d || !d.querySelectorAll) return;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var uid = 0;

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
      '<details class="mvc-prices"><summary>Fertilizer prices used <span data-o="price-sum"></span></summary>' +
        '<div class="mvc-grid">' +
          '<label class="mvc-f"><span>$ per lb N</span><input data-k="pn" type="number" inputmode="decimal" min="0" step="0.01"></label>' +
          '<label class="mvc-f"><span>$ per lb P&#8322;O&#8325;</span><input data-k="pp" type="number" inputmode="decimal" min="0" step="0.01"></label>' +
          '<label class="mvc-f"><span>$ per lb K&#8322;O</span><input data-k="pk" type="number" inputmode="decimal" min="0" step="0.01"></label>' +
        '</div><p class="mvc-hint" data-o="price-src">Loading dealer prices&hellip;</p></details>' +
      '<div class="mvc-out" aria-live="polite">' +
        '<div class="mvc-big"><span>Value of the manure</span><strong data-o="unit">&nbsp;</strong><small data-o="unit-sub"></small></div>' +
        '<table class="mvc-t"><thead><tr><th scope="col">Nutrient</th><th scope="col">lb an acre</th><th scope="col">$ an acre</th><th scope="col" data-o="field-h">Field</th></tr></thead><tbody>' +
          '<tr><th scope="row">N, first year</th><td data-o="n-lb"></td><td data-o="n-usd"></td><td data-o="n-field"></td></tr>' +
          '<tr><th scope="row">P&#8322;O&#8325;</th><td data-o="p-lb"></td><td data-o="p-usd"></td><td data-o="p-field"></td></tr>' +
          '<tr><th scope="row">K&#8322;O</th><td data-o="k-lb"></td><td data-o="k-usd"></td><td data-o="k-field"></td></tr>' +
          '<tr class="mvc-sum"><th scope="row">Total</th><td></td><td data-o="ac"></td><td data-o="field"></td></tr>' +
        '</tbody></table>' +
        '<p class="mvc-hint">Book values from UW Extension A2809. A test of your own manure gives the real pounds.</p>' +
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
        if (el.getAttribute('data-full') && el.getAttribute('data-shown') === s) return +el.getAttribute('data-full');  // the dealer price, unrounded
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
      var res = fieldValue({ type: t.id, timing: val('timing'), rate: num('rate'), acres: num('acres'), prices: prices() });
      if (!res || res.missing) {
        set('unit', 'No price'); set('unit-sub', 'Enter a fertilizer price under "Fertilizer prices used" to see a value.');
        ['n-lb', 'n-usd', 'n-field', 'p-lb', 'p-usd', 'p-field', 'k-lb', 'k-usd', 'k-field', 'ac', 'field'].forEach(function (k) { set(k, ''); });
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
    }
    root.addEventListener('input', run);
    root.addEventListener('change', run);
    function fill(pr) {
      [['pn', pr.n], ['pp', pr.p], ['pk', pr.k]].forEach(function (a) { var el = q('[data-k="' + a[0] + '"]'); if (el && a[1] != null) { el.value = a[1].toFixed(2); el.setAttribute('data-shown', el.value); el.setAttribute('data-full', String(a[1])); } });
      var s = [];
      if (pr.src.n) s.push('N from urea ' + money(pr.src.n.price, 0) + ' a ton (' + day(pr.src.n.as_of) + ')');
      if (pr.src.p) s.push('P&#8322;O&#8325; from MAP 12-40-0-10S ' + money(pr.src.p.price, 0) + ' a ton (' + day(pr.src.p.as_of) + '), with its 240 lb of N credited at the urea price');
      if (pr.src.k) s.push('K&#8322;O from potash ' + money(pr.src.k.price, 0) + ' a ton (' + day(pr.src.k.as_of) + ')');
      set('price-src', s.length ? 'Midwest dealer quotes: ' + s.join('; ') + '. Type your own dealer&rsquo;s prices to redo it.' : 'Dealer prices did not load. Type your own prices.');
      set('price-sum', pr.n != null ? '(N ' + money(pr.n) + ', P ' + (pr.p != null ? money(pr.p) : 'no quote') + ', K ' + (pr.k != null ? money(pr.k) : 'no quote') + ' a lb)' : '');
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
    var get = w.AG && w.AG.json ? w.AG.json('/data/fertilizer.json')
      : fetch('/data/fertilizer.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
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
