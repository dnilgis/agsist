/* components/lrp.js: the math and the tables behind /lrp, in one place.
 *
 * Used two ways, so the page and its baked copy never disagree:
 *   - in the browser (window.AgLrp), by components/lrp-ui.js for today's
 *     offers and the year-by-year detail;
 *   - by scripts/bake_lrp.mjs, which writes the record, the tests, the pick
 *     panel and the subsidy table into lrp.html from data/lrp/bt.json, so a
 *     reader with no JavaScript and a search engine see the same numbers.
 *
 * Nothing here estimates anything. Coverage prices, rates, cost per cwt and
 * the record come from RMA's files as data/lrp/ has them; the only thing
 * applied on top is the premium subsidy table (RMA PM-20-064, RY2021 on).
 */
(function (root) {
  'use strict';

  var MINUS = '−';
  var LENGTHS = [13, 17, 21, 26, 30, 34, 39, 43, 47, 52];
  var PRODUCTS = [
    { id: 'feeder', comm: '0801', name: 'Feeder cattle', short: 'Feeder' },
    { id: 'fed', comm: '0802', name: 'Fed cattle', short: 'Fed' },
    { id: 'swine', comm: '0815', name: 'Hogs', short: 'Hogs' }
  ];
  var BAND_IDS = ['95-100', '90-95', '85-90', '80-85', '70-80'];
  /* RY2021 on, by coverage band (RMA PM-20-064; RMA's own Summary of
     Business rows agree, see bt.json subsidy_check). Same table as
     scripts/lrp_backtest.mjs subsidy() for RY2021 on. */
  var SUBSIDY_NOW = { '95-100': 0.35, '90-95': 0.40, '85-90': 0.45, '80-85': 0.50, '70-80': 0.55 };

  /* Type names. RMA reuses type codes from one reinsurance year to the
     next, so names are kept per year; these are RY2027's, from RMA's
     Summary of Business for 2027 (818 and 821 by their class and commodity
     type codes in the daily file). An unknown year or code falls back to the
     code and the weight range RMA posts with it. */
  var TYPE_NAMES = {
    '2027': {
      '0801/809': 'Steers, weight 1', '0801/810': 'Steers, weight 2',
      '0801/811': 'Heifers, weight 1', '0801/812': 'Heifers, weight 2',
      '0801/813': 'Brahman, weight 1', '0801/814': 'Brahman, weight 2',
      '0801/815': 'Dairy, weight 1', '0801/816': 'Dairy, weight 2',
      '0801/817': 'Unborn bulls and heifers, weight 1', '0801/818': 'Unborn Brahman, weight 1',
      '0801/819': 'Unborn dairy, weight 1', '0801/820': 'Unborn bulls and heifers, weight 2',
      '0801/821': 'Unborn Brahman, weight 2', '0801/822': 'Unborn dairy, weight 2',
      '0801/823': 'Unborn calves',
      '0802/820': 'Steers and heifers', '0802/821': 'Cull cows',
      '0815/997': 'Hogs (no type)', '0815/821': 'Unborn hogs'
    }
  };

  function bandOf(level) {
    if (level >= 0.95 - 1e-9) return '95-100';
    if (level >= 0.90 - 1e-9) return '90-95';
    if (level >= 0.85 - 1e-9) return '85-90';
    if (level >= 0.80 - 1e-9) return '80-85';
    if (level >= 0.70 - 1e-9) return '70-80';
    return null;
  }

  function subsidyNow(level) {
    var b = bandOf(level);
    return b ? SUBSIDY_NOW[b] : null;
  }

  function productOf(comm) {
    for (var i = 0; i < PRODUCTS.length; i++) if (PRODUCTS[i].comm === comm) return PRODUCTS[i];
    return null;
  }

  function typeName(comm, type, ry, w) {
    var names = TYPE_NAMES[String(ry)];
    var n = names && names[comm + '/' + type];
    if (n) return n;
    return 'Type ' + type + (w ? ' (' + (+w[0]).toFixed(2) + ' to ' + (+w[1]).toFixed(2) + ' cwt)' : '');
  }

  /* ---------------------------------------------------------------- format */

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function ymdLong(s) {
    s = String(s || '');
    if (!/^\d{8}$/.test(s)) return '';
    return MON[+s.slice(4, 6) - 1] + ' ' + (+s.slice(6, 8)) + ', ' + s.slice(0, 4);
  }

  function addDays(ymd, n) {
    var d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + n));
    return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
  }

  function group3(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function money(v, nd) {
    if (v == null || !isFinite(v)) return '';
    nd = nd == null ? 2 : nd;
    var neg = v < 0 && Math.abs(v) >= 0.5 * Math.pow(10, -nd);
    var parts = Math.abs(v).toFixed(nd).split('.');
    return (neg ? MINUS : '') + '$' + group3(parts[0]) + (parts[1] ? '.' + parts[1] : '');
  }

  function pct(x, nd) {
    if (x == null || !isFinite(x)) return '';
    return (x * 100).toFixed(nd || 0) + '%';
  }

  function levelPct(level) {
    var p = level * 100;
    return (Math.abs(p - Math.round(p)) < 1e-6 ? String(Math.round(p)) : p.toFixed(2).replace(/0+$/, '')) + '%';
  }

  function odds(p) {
    if (p == null) return '';
    if (p >= 0.995) return '1';
    if (p < 0.001) return 'under 0.001';
    return p < 0.1 ? p.toFixed(3) : p.toFixed(2);
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function bandLabel(id) { return id.replace('-', ' to ') + '%'; }

  /* ---------------------------------------------------------------- offers */

  /* One posted offer row [level_e6, coverage_price_milli, rate_e6, cost_per_cwt_milli]
     -> dollars per cwt, with the producer's share after today's subsidy. */
  function offerRow(r) {
    var level = r[0] / 1e6, cp = r[1] / 1000, full = r[3] / 1000, s = subsidyNow(level);
    return {
      level: level, coverage: cp, rate: r[2] / 1e6, fullPerCwt: full, subsidy: s,
      yourPerCwt: s == null ? null : full * (1 - s)
    };
  }

  /* per head and for the lot, at a target weight in cwt */
  function forHerd(row, cwt, head) {
    var ok = cwt > 0 && head > 0;
    return {
      coverHead: ok ? row.coverage * cwt : null,
      premHead: ok && row.yourPerCwt != null ? row.yourPerCwt * cwt : null,
      premAll: ok && row.yourPerCwt != null ? row.yourPerCwt * cwt * head : null,
      coverAll: ok ? row.coverage * cwt * head : null
    };
  }

  /* RMA: sales close at 8:25 a.m. Central the calendar day after the offers
     post (a Friday's close Saturday). Returns the close as YYYYMMDDHHMM in
     Central time, to compare with centralNow(). */
  function salesClose(sed) { return addDays(sed, 1) + '0825'; }

  function centralNow(date) {
    var f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    var p = {};
    f.formatToParts(date || new Date()).forEach(function (x) { p[x.type] = x.value; });
    return p.year + p.month + p.day + p.hour + p.minute;
  }

  function centralClock(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit' }).format(d).replace(' AM', ' a.m.').replace(' PM', ' p.m.') + ' CT';
  }

  /* ---------------------------------------------------------------- record */

  function recordCell(rec, minYears) {
    if (!rec) return '<td class="na">not offered</td>';
    if (rec.years < minYears) return '<td class="na">' + rec.years + (rec.years === 1 ? ' year' : ' years') + ', too few</td>';
    return '<td><b>' + money(rec.net) + '</b><span>paid ' + pct(rec.paid_share) + ' of days</span></td>';
  }

  /* The 95-100% record, lengths down, products across. */
  function recordTable(bt, regime) {
    var minY = bt.method.min_years, base = bt.method.base;
    var h = '<table class="lrp-t lrp-rec"><thead><tr><th scope="col">Length</th>';
    PRODUCTS.forEach(function (p) { h += '<th scope="col">' + p.name + '</th>'; });
    h += '</tr></thead><tbody>';
    LENGTHS.forEach(function (len) {
      var any = PRODUCTS.some(function (p) { return bt.record[regime + '/' + p.id + '/' + base + '/' + len]; });
      if (!any) return;
      h += '<tr><th scope="row">' + len + ' weeks</th>';
      PRODUCTS.forEach(function (p) { h += recordCell(bt.record[regime + '/' + p.id + '/' + base + '/' + len], minY); });
      h += '</tr>';
    });
    return h + '</tbody></table>';
  }

  /* What a producer got back for each $1 of premium after subsidy, 95-100%,
     13 weeks: one number per product, from the record. */
  function backPerDollar(bt, regime, len) {
    var out = [];
    PRODUCTS.forEach(function (p) {
      var r = bt.record[regime + '/' + p.id + '/' + bt.method.base + '/' + len];
      if (r && r.years >= bt.method.min_years && r.cost > 0) out.push({ product: p, back: r.paid / r.cost, rec: r });
    });
    return out;
  }

  /* ---------------------------------------------------------------- tests */

  function productName(id) {
    for (var i = 0; i < PRODUCTS.length; i++) if (PRODUCTS[i].id === id) return PRODUCTS[i].name;
    return id;
  }

  function testLabel(t) {
    if (t.test === 'paid') return '95 to 100% paid more than it cost';
    if (t.test === 'best') return 'The band with the best record so far, instead of 95 to 100%';
    return bandLabel(t.test.slice(5)) + ' instead of 95 to 100%';
  }

  function verdict(t) {
    if (t.kept) return 'Kept';
    if (t.not_run) return 'Not enough history';
    return 'Not kept';
  }

  function regimeName(bt, id) {
    for (var i = 0; i < bt.method.regimes.length; i++) {
      var r = bt.method.regimes[i];
      if (r.id === id) return id === 'all' ? 'Since July 2013 (RY' + r.fromRY + ' on)' : 'Since July 2020 (RY' + r.fromRY + ' on, today’s subsidy)';
    }
    return id;
  }

  function testsTable(bt) {
    var h = '';
    bt.method.regimes.forEach(function (rg) {
      h += '<h3>' + esc(regimeName(bt, rg.id)) + '</h3><div class="lrp-tw"><table class="lrp-t lrp-tests"><thead><tr>' +
        '<th scope="col">What was tested</th><th scope="col">Years ahead</th><th scope="col">Per $100</th>' +
        '<th scope="col" class="c-odds">Odds</th><th scope="col">After Holm</th><th scope="col">Verdict</th></tr></thead><tbody>';
      PRODUCTS.forEach(function (p) {
        h += '<tr class="grp"><th scope="rowgroup" colspan="6">' + esc(p.name) + '</th></tr>';
        Object.keys(bt.tests).forEach(function (k) {
          var t = bt.tests[k];
          if (t.regime !== rg.id || t.product !== p.id) return;
          var cls = t.kept ? 'kept' : t.not_run ? 'nr' : 'no';
          h += '<tr class="' + cls + '"><th scope="row">' + esc(testLabel(t)) + '</th>' +
            '<td>' + t.years_positive + ' of ' + t.years_tested + '</td>' +
            '<td>' + (t.mean == null ? '' : money(t.mean)) + '</td>' +
            '<td class="c-odds">' + (t.not_run ? '' : odds(t.p)) + '</td>' +
            '<td>' + (t.not_run ? '' : odds(t.p_holm)) + '</td>' +
            '<td>' + verdict(t) + '</td></tr>';
        });
      });
      h += '</tbody></table></div>';
    });
    return h;
  }

  /* The closest call: of the tests that ran and came out positive (not the
     "paid" test), the one with the smallest Holm-adjusted odds. */
  function closestCall(bt) {
    var best = null;
    Object.keys(bt.tests).forEach(function (k) {
      var t = bt.tests[k];
      if (t.not_run || t.test === 'paid' || t.kept || !(t.mean > 0) || t.p == null) return;
      if (!best || t.p_holm < best.p_holm || (t.p_holm === best.p_holm && t.p < best.p)) best = t;
    });
    return best;
  }

  function twin(bt, t, regime) {
    return bt.tests[regime + '/' + t.product + '/' + t.test] || null;
  }

  root.AgLrp = {
    LENGTHS: LENGTHS, PRODUCTS: PRODUCTS, BAND_IDS: BAND_IDS, SUBSIDY_NOW: SUBSIDY_NOW, TYPE_NAMES: TYPE_NAMES,
    bandOf: bandOf, subsidyNow: subsidyNow, productOf: productOf, typeName: typeName,
    ymdLong: ymdLong, addDays: addDays, money: money, pct: pct, levelPct: levelPct, odds: odds, esc: esc,
    bandLabel: bandLabel, offerRow: offerRow, forHerd: forHerd, salesClose: salesClose, centralNow: centralNow,
    centralClock: centralClock, recordTable: recordTable, backPerDollar: backPerDollar, productName: productName,
    testLabel: testLabel, verdict: verdict, regimeName: regimeName, testsTable: testsTable, closestCall: closestCall,
    twin: twin
  };
})(typeof window !== 'undefined' ? window : this);
