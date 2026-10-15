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

  /* Which sales day a today.json holds, when RMA posted it and when sales on
     it close. Uses the file's own sales_day, posted_utc and sales_close_utc
     (scripts/fetch_lrp.py) when present; posted_utc can be null, and an
     older file has only sed, so the close falls back to the RMA rule.
     closed(now) is true from the close on: those offers are never today's. */
  function salesDay(T) {
    /* ONE source for every date on the page: the sales day. RMA's file for
       day D carries sales date D, and sales on it close at 8:25 a.m. CT on
       D + 1 (a Friday's on Saturday). The caption, the posted line, the
       buy-by line and the closed banner all come from here. The file's own
       sales_close_ct is only checked against the rule (closeAgrees). */
    var day = T.sales_day ? String(T.sales_day).replace(/-/g, '') : String(T.sed || '');
    var closeCt = salesClose(day);
    var fileClose = T.sales_close_ct ? String(T.sales_close_ct).replace(/[-T:]/g, '') : null;
    var hm = '8:25 a.m. CT';
    var postedDay = T.posted_utc ? centralNow(new Date(T.posted_utc)).slice(0, 8) : '';
    var clock = T.posted_utc ? centralClock(T.posted_utc).replace(/^[A-Z][a-z]{2} \d+, /, '') : '';
    return {
      day: day, dayText: ymdLong(day), dayShort: wdShort(day), closeCt: closeCt,
      closeText: hm + ' on ' + wdShort(closeCt.slice(0, 8)) + ', ' + closeCt.slice(0, 4),
      buyBy: hm + ' ' + wdShort(closeCt.slice(0, 8)),
      postedDay: postedDay,
      /* the posting time; the date too when RMA posted on another day than the sales day */
      postedClock: clock ? (postedDay && postedDay !== day ? wdShort(postedDay) + ', ' : '') + clock : '',
      posted: clock,
      closeAgrees: fileClose == null || fileClose === closeCt,
      closed: function (now) { return centralNow(now || new Date()) >= closeCt; }
    };
  }

  /* The four places a date shows, all from salesDay(T). */
  function whenText(T) {
    var d = salesDay(T);
    return 'Offers for sales on ' + d.dayShort + ', ' + d.day.slice(0, 4) + (d.postedClock ? ', posted by RMA ' + d.postedClock : '') + '. Buy by ' + d.buyBy + '.';
  }
  function closedText(T) {
    return 'Sales on these offers closed at ' + salesDay(T).closeText + '. They can no longer be bought. RMA posts the next offers between about 2:15 and 4:30 p.m. CT on a sales day, and this page shows them within about an hour.';
  }
  function captionText(T, closed) {
    return 'For sales on ' + salesDay(T).dayShort + (closed ? ' (closed, for reference)' : '');
  }

  /* ---------------------------------------------------------------- dates */

  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function weekday(ymd) {
    return WD[new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))).getUTCDay()];
  }
  /* "Wed Oct 14" */
  function wdShort(ymd) { return weekday(ymd) + ' ' + MON[+ymd.slice(4, 6) - 1] + ' ' + (+ymd.slice(6, 8)); }

  /* the most recent weekday sales day whose offers should be out by `now`
     (RMA posts between about 2:15 and 4:30 p.m. CT; 5 p.m. leaves room) */
  function expectedSalesDay(now) {
    var c = centralNow(now), day = c.slice(0, 8), hm = +c.slice(8, 12);
    if (hm < 1700) day = addDays(day, -1);
    while (weekday(day) === 'Sat' || weekday(day) === 'Sun') day = addDays(day, -1);
    return day;
  }
  function prevWeekday(day) {
    day = addDays(day, -1);
    while (weekday(day) === 'Sat' || weekday(day) === 'Sun') day = addDays(day, -1);
    return day;
  }
  /* more than one sales day behind what should be out by now */
  function isStale(T, now) {
    var d = salesDay(T).day;
    return d < prevWeekday(expectedSalesDay(now));
  }

  /* ---------------------------------------------------------------- weight */

  var LEAN = 0.74;          /* live weight x 0.74 = lean: RMA LRP Handbook 2027 (FCIC-20010), section 25A(2) */
  var HEAD_LIMIT = { '0801': 12000, '0802': 12000, '0815': 70000 };   /* per endorsement: RMA LRP Handbook 2027 (FCIC-20010), sections 23B, 24B, 25B */

  /* what was typed in the weight box -> cwt a head, and how it was read.
     Over 30 is pounds (no animal LRP covers weighs 30 cwt). Hogs are typed
     live and insured lean. */
  function readWeight(raw, comm) {
    var v = parseFloat(String(raw == null ? '' : raw).replace(/,/g, ''));
    if (!(v > 0)) return { cwt: null, note: '' };
    var note = '', live = v;
    if (v > 30) { live = v / 100; note = 'Read as ' + group3(String(Math.round(v))) + ' lb = ' + live.toFixed(2) + ' cwt.'; }
    if (comm === '0815') {
      var lean = live * LEAN;
      return { cwt: lean, live: live, note: (note ? note + ' ' : '') + 'Live ' + live.toFixed(2) + ' cwt x 0.74 = ' + lean.toFixed(2) + ' cwt lean.' };
    }
    return { cwt: live, note: note };
  }

  /* why the totals are blank, or '' */
  function weightProblem(o, cwt, head) {
    var lo = +o.w[0], hi = +o.w[1], lim = HEAD_LIMIT[o.c];
    if (cwt != null && (cwt < lo - 1e-9 || cwt > hi + 1e-9)) {
      return 'RMA insures this type at ' + lo.toFixed(2) + ' to ' + hi.toFixed(2) + ' cwt a head' + (o.c === '0815' ? ' lean' : '') + ', so no totals.';
    }
    if (head > lim) return 'One endorsement covers up to ' + group3(String(lim)) + ' head (RMA LRP Handbook 2027, sections 23B to 25B), so no totals.';
    return '';
  }

  /* ---------------------------------------------------------------- record */

  function per100(share) { return Math.round(share * 100); }

  function startNote(rec, regimeFrom) {
    // a window that starts more than 90 days after the regime opens says when
    return rec.first && dayDiff(rec.first, String(regimeFrom - 1) + '0701') > 90 ? 'from ' + MON[+rec.first.slice(4, 6) - 1] + ' ' + rec.first.slice(0, 4) : '';
  }
  function dayDiff(a, b) {
    return (Date.UTC(+a.slice(0, 4), +a.slice(4, 6) - 1, +a.slice(6, 8)) - Date.UTC(+b.slice(0, 4), +b.slice(4, 6) - 1, +b.slice(6, 8))) / 864e5;
  }

  function recordCell(rec, minYears, field, regimeFrom) {
    if (!rec) return '<td class="na">not offered</td>';
    if (rec.years < minYears) return '<td class="na">' + rec.years + (rec.years === 1 ? ' year' : ' years') + ', too few</td>';
    var note = startNote(rec, regimeFrom);
    return '<td><b>' + money(rec[field]) + '</b><span>' + per100(rec.paid_share) + ' of 100</span>' +
      (note ? '<span class="nt">' + note + '</span>' : '') + '</td>';
  }

  /* The top-band record, lengths down, products across. field: net_now
     (today's subsidy) or net (the subsidy in force that year). */
  function recordTable(bt, regime, field, caption) {
    var minY = bt.method.min_years, base = bt.method.base;
    var rg = bt.method.regimes.filter(function (r) { return r.id === regime; })[0];
    var h = '<table class="lrp-t lrp-rec">' + (caption ? '<caption>' + caption + '</caption>' : '') + '<thead><tr><th scope="col">Length</th>';
    PRODUCTS.forEach(function (p) { h += '<th scope="col">' + p.name + '</th>'; });
    h += '</tr></thead><tbody>';
    LENGTHS.forEach(function (len) {
      var any = PRODUCTS.some(function (p) { return bt.record[regime + '/' + p.id + '/' + base + '/' + len]; });
      if (!any) return;
      h += '<tr><th scope="row">' + len + ' weeks</th>';
      PRODUCTS.forEach(function (p) { h += recordCell(bt.record[regime + '/' + p.id + '/' + base + '/' + len], minY, field || 'net', rg.fromRY); });
      h += '</tr>';
    });
    return h + '</tbody></table>';
  }

  /* average coverage level of the top band in a regime, all products and lengths */
  function topLevel(bt, regime) {
    var n = 0, s = 0;
    Object.keys(bt.record).forEach(function (k) {
      var r = bt.record[k];
      if (k.indexOf(regime + '/') === 0 && k.split('/')[2] === bt.method.base) { s += r.level * r.trials; n += r.trials; }
    });
    return n ? s / n : null;
  }

  /* What a producer got back for each $1 of premium after subsidy, top band:
     one number per product. now: at today's subsidy schedule. */
  function backPerDollar(bt, regime, len, now) {
    var out = [];
    PRODUCTS.forEach(function (p) {
      var r = bt.record[regime + '/' + p.id + '/' + bt.method.base + '/' + len];
      var c = r && (now ? r.cost_now : r.cost);
      if (r && r.years >= bt.method.min_years && c > 0) out.push({ product: p, back: r.paid / c, rec: r });
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
    if (t.test === 'best') return 'The level with the best record so far, instead of 95 to 100%';
    return bandLabel(t.test.slice(5)) + ' instead of 95 to 100%';
  }

  function verdict(t) {
    if (t.kept) return 'Kept';
    if (t.not_run) return 'Not enough history';
    if (t.test === 'paid' && t.mean < 0) return 'No: lost money in ' + (t.years_tested - t.years_positive) + ' of ' + t.years_tested + ' years';
    return 'Not kept';
  }

  function regimeName(bt, id) {
    for (var i = 0; i < bt.method.regimes.length; i++) {
      var r = bt.method.regimes[i];
      if (r.id === id) return id === 'all' ? 'Since July 2013 (insurance years 2014 on)' : 'Since July 2020 (insurance years 2021 on, today’s subsidy)';
    }
    return id;
  }

  function testsTable(bt) {
    var h = '';
    bt.method.regimes.forEach(function (rg) {
      h += '<h3>' + esc(regimeName(bt, rg.id)) + '</h3><div class="lrp-tw"><table class="lrp-t lrp-tests"><caption class="sr-only">' + esc(regimeName(bt, rg.id)) + ': every test</caption><thead><tr>' +
        '<th scope="col">What was tested</th><th scope="col">Verdict</th><th scope="col">Years ahead</th><th scope="col">Per $100</th>' +
        '<th scope="col" class="c-odds">Odds</th><th scope="col">Adjusted</th></tr></thead>';
      PRODUCTS.forEach(function (p) {
        h += '<tbody><tr class="grp"><th scope="colgroup" colspan="6">' + esc(p.name) + '</th></tr>';
        Object.keys(bt.tests).forEach(function (k) {
          var t = bt.tests[k];
          if (t.regime !== rg.id || t.product !== p.id) return;
          var cls = t.kept ? 'kept' : t.not_run ? 'nr' : 'no';
          h += '<tr class="' + cls + '"><th scope="row">' + esc(testLabel(t)) + '</th>' +
            '<td class="vd">' + esc(verdict(t)) + '</td>' +
            '<td>' + t.years_positive + ' of ' + t.years_tested + '</td>' +
            '<td>' + (t.mean == null ? '' : money(t.mean)) + '</td>' +
            '<td class="c-odds">' + (t.not_run ? '' : odds(t.p)) + '</td>' +
            '<td>' + (t.not_run ? '' : odds(t.p_holm)) + '</td></tr>';
        });
        h += '</tbody>';
      });
      h += '</table></div>';
    });
    return h;
  }

  /* The closest call: of the tests that ran and came out positive (not the
     "paid" test), the one with the smallest adjusted odds. */
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
    centralClock: centralClock, salesDay: salesDay, whenText: whenText, closedText: closedText, captionText: captionText, weekday: weekday, wdShort: wdShort, expectedSalesDay: expectedSalesDay,
    isStale: isStale, readWeight: readWeight, weightProblem: weightProblem, HEAD_LIMIT: HEAD_LIMIT, LEAN: LEAN,
    per100: per100, topLevel: topLevel, recordTable: recordTable, backPerDollar: backPerDollar, productName: productName,
    testLabel: testLabel, verdict: verdict, regimeName: regimeName, testsTable: testsTable, closestCall: closestCall,
    twin: twin
  };
})(typeof window !== 'undefined' ? window : this);
