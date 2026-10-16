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

  /* ---------------------------------------------------------------- the calculator's state */

  /* The animal buttons, as they go in the URL (?a=fed). */
  var ANIMALS = { feeder: '0801', fed: '0802', hogs: '0815' };
  var ANIMAL_OF = { '0801': 'feeder', '0802': 'fed', '0815': 'hogs' };

  /* Classes the reader picks under "More types"; the weight picks the type
     inside a class (RMA LRP Handbook 2027, FCIC-20010, section 23A(3): steers
     1.00 to 5.99 cwt and 6.00 to 10.00 cwt, and so on). RY2027 type codes,
     the same year as TYPE_NAMES; each pair was checked against the price
     adjustment factors in RMA's daily file (an unborn class carries the factor
     of its born class, unborn bulls and heifers the average of steers and
     heifers). An unknown year falls back to choosing by weight alone. */
  var CLASSES = {
    '2027': {
      '0801': [
        { id: 'steers', name: 'Steers', types: ['809', '810'] },
        { id: 'heifers', name: 'Heifers', types: ['811', '812'] },
        { id: 'brahman', name: 'Mostly Brahman', types: ['813', '814'] },
        { id: 'dairy', name: 'Mostly dairy', types: ['815', '816'] },
        { id: 'unborn', name: 'Unborn bulls and heifers', types: ['817', '820'] },
        { id: 'unbrahman', name: 'Unborn, mostly Brahman', types: ['818', '821'] },
        { id: 'undairy', name: 'Unborn, mostly dairy', types: ['819', '822'] },
        { id: 'calves', name: 'Unborn calves, sold in their first two weeks', types: ['823'] }
      ],
      '0802': [
        { id: 'fed', name: 'Steers and heifers', types: ['820'] },
        { id: 'cull', name: 'Cull dairy cows', types: ['821'] }
      ],
      '0815': [
        { id: 'hogs', name: 'Market hogs', types: ['997'] },
        { id: 'unborn', name: 'Unborn hogs', types: ['821'] }
      ]
    }
  };

  function classesFor(comm, ry) {
    var y = CLASSES[String(ry)];
    return (y && y[comm]) || [];
  }

  /* The type for an animal, a class and a weight (cwt as RMA insures it, so
     lean for hogs): the type in the class whose weight range holds the
     weight, else the nearest range. With no weight, the heavier type (the
     usual one). offers: that sales day's offers. */
  function inferType(offers, comm, cls, cwt, ry) {
    var list = classesFor(comm, ry), want = null, i;
    for (i = 0; i < list.length; i++) if (list[i].id === cls) want = list[i];
    if (!want && list.length) want = list[0];
    var ranges = {};
    offers.forEach(function (o) {
      if (o.c !== comm) return;
      if (want && want.types.indexOf(o.t) < 0) return;
      if (!want && !o.tested) return;
      ranges[o.t] = [+o.w[0], +o.w[1]];
    });
    var ts = Object.keys(ranges).sort(function (a, b) { return ranges[a][0] - ranges[b][0]; });
    if (!ts.length) return null;
    if (cwt == null || !(cwt > 0)) return ts[ts.length - 1];
    var best = ts[0], gap = Infinity;
    ts.forEach(function (t) {
      var r = ranges[t], g = cwt < r[0] ? r[0] - cwt : cwt > r[1] ? cwt - r[1] : 0;
      if (g < gap - 1e-9) { gap = g; best = t; }
    });
    return best;
  }

  /* weight range of a class, cwt, over the types offered that day */
  function classRange(offers, comm, cls, ry) {
    var list = classesFor(comm, ry), want = null, lo = Infinity, hi = -Infinity;
    for (var i = 0; i < list.length; i++) if (list[i].id === cls) want = list[i];
    offers.forEach(function (o) {
      if (o.c !== comm || (want && want.types.indexOf(o.t) < 0)) return;
      lo = Math.min(lo, +o.w[0]); hi = Math.max(hi, +o.w[1]);
    });
    return lo <= hi ? [lo, hi] : null;
  }

  /* Changing the animal keeps the head and the typed weight; only the class
     and the length go back to that animal's usual ones. */
  function switchAnimal(s, a) {
    return { a: a, h: s.h, w: s.w, k: null, l: s.l };
  }

  /* ?a=fed&h=120&w=1400&l=13 (and k=heifers for a class other than the usual) */
  function parseQuery(search) {
    var s = {}, q = String(search || '').replace(/^\?/, '');
    q.split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('='), k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i)), v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
      if (k === 'a' && ANIMALS[v]) s.a = v;
      else if (k === 'h' && /^\d[\d,]*$/.test(v)) s.h = v.replace(/,/g, '');
      else if (k === 'w' && /^\d[\d,]*(\.\d+)?$/.test(v)) s.w = v.replace(/,/g, '');
      else if (k === 'l' && /^\d{1,2}$/.test(v)) s.l = +v;
      else if (k === 'k' && /^[a-z]{2,12}$/.test(v)) s.k = v;
    });
    return s;
  }
  function toQuery(s) {
    var p = [];
    if (s.a) p.push('a=' + s.a);
    if (s.h) p.push('h=' + encodeURIComponent(String(s.h).replace(/,/g, '')));
    if (s.w) p.push('w=' + encodeURIComponent(String(s.w).replace(/,/g, '')));
    if (s.l) p.push('l=' + s.l);
    if (s.k) p.push('k=' + s.k);
    return p.length ? '?' + p.join('&') : '';
  }

  /* the floor net of the premium, a cwt */
  function netFloor(row) { return row.yourPerCwt == null ? null : row.coverage - row.yourPerCwt; }

  /* What LRP pays a cwt if the actual ending value comes in `drop` under the
     expected ending value: the coverage price minus the ending value, when
     that is above zero (RMA LRP Handbook 2027, section 22D). */
  function payAt(row, eev, drop) { return Math.max(0, row.coverage - (eev - drop)); }

  /* Premium billing date: the first day of the second month after the end
     date (RMA LRP Handbook 2027, FCIC-20010, section 21E). */
  function billDate(end) {
    var y = +end.slice(0, 4), m = +end.slice(4, 6) + 2;
    if (m > 12) { m -= 12; y += 1; }
    return y + String(m).padStart(2, '0') + '01';
  }

  /* A hog weight typed in pounds that looks like a carcass weight: market hogs
     sell at about 250 to 300 lb live, and RMA's lean factor (0.74) is about
     what a carcass yields, so carcass / 0.74 is about the live weight. */
  function carcassHint(raw, comm) {
    if (comm !== '0815') return null;
    var v = parseFloat(String(raw == null ? '' : raw).replace(/,/g, ''));
    if (!(v >= 100 && v < 240)) return null;
    return { typed: Math.round(v), live: Math.round(v / LEAN / 5) * 5 };
  }

  /* The futures contract for an end date, from data/prices.json: the first
     month that expires on or after the end date. Expiry, roughly: live
     cattle the last business day of the month, feeder cattle the last
     Thursday (never before the 22nd), lean hogs the 10th business day (never
     before the 14th); the day used is the earliest it can be, so a contract
     is never named after it has expired. */
  var FUT = {
    '0802': { key: 'cattle', name: 'live cattle', day: 28, months: [2, 4, 6, 8, 10, 12] },
    '0801': { key: 'feeders', name: 'feeder cattle', day: 22, months: [1, 3, 4, 5, 8, 9, 10, 11] },
    '0815': { key: 'hogs', name: 'lean hog', day: 14, months: [2, 4, 5, 6, 7, 8, 10, 12] }
  };
  var MKEY = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  /* the CME contract month (listed months only); null when data/prices.json
     has no close for that one month: never a later month in its place */
  function futuresFor(prices, comm, end) {
    var f = FUT[comm], q = prices && prices.quotes;
    if (!f || !q) return null;
    var y = +end.slice(0, 4), m = +end.slice(4, 6), d = +end.slice(6, 8);
    if (d > f.day) { m += 1; if (m > 12) { m = 1; y += 1; } }
    while (f.months.indexOf(m) < 0) { m += 1; if (m > 12) { m = 1; y += 1; } }
    var k = f.key + '-' + MKEY[m - 1] + String(y).slice(2), x = q[k];
    if (!x || !isFinite(x.close) || !x.close_date) return null;
    return { key: k, name: MON[m - 1] + ' ' + y + ' ' + f.name + ' futures', close: +x.close, date: String(x.close_date).replace(/-/g, '') };
  }

  /* How to word a futures price from data/prices.json, by when the file was
     read, the way the futures pages and the homepage ticker do it
     (components/home-yield.js): a quote read while CME livestock trade
     (8:30 a.m. to 1:05 p.m. CT, weekdays) is a delayed last trade, never a
     close; one read in the 15 minutes after the bell may not be final; only
     a quote read after that, or one dated before the read day, is a close.
     These are Yahoo Finance prices, so a close is never called a settlement.
     Returns { kind: 'delayed'|'intraday'|'unsettled'|'close', text } where
     text follows the contract name. */
  function futuresStamp(f, fetchedIso, now) {
    var price = money(f.close), F = new Date(fetchedIso || '');
    var closeWords = 'closed at <b>' + price + '</b> on ' + ymdLong(f.date).replace(/, \d{4}$/, '') + ' (a Yahoo Finance close, not a CME settlement)';
    if (isNaN(F)) return { kind: 'close', text: closeWords };
    var c = centralNow(F), day = c.slice(0, 8), m = +c.slice(8, 10) * 60 + +c.slice(10, 12);
    var wd = weekday(day), trading = wd !== 'Sat' && wd !== 'Sun';
    if (!trading || f.date !== day || m < 510) return { kind: 'close', text: closeWords };
    var clock = centralClock(F.toISOString()).replace(/^[A-Z][a-z]{2} \d+, /, '');
    if (m < 785) {
      var age = ((now || new Date()).getTime() - F.getTime()) / 60000;
      if (age <= 45) return { kind: 'delayed', text: 'were at <b>' + price + '</b> at ' + clock + ' (delayed about 15 minutes, trading still open)' };
      return { kind: 'intraday', text: 'were at <b>' + price + '</b> at ' + clock + ' on ' + ymdLong(day).replace(/, \d{4}$/, '') + ', mid-session, before the close' };
    }
    if (m < 800) return { kind: 'unsettled', text: 'were at <b>' + price + '</b> at ' + clock + ', just after the 1:05 p.m. close; the closing price may not be final yet' };
    return { kind: 'close', text: closeWords };
  }

  root.AgLrp = {
    ANIMALS: ANIMALS, ANIMAL_OF: ANIMAL_OF, CLASSES: CLASSES, classesFor: classesFor, inferType: inferType, classRange: classRange,
    switchAnimal: switchAnimal, parseQuery: parseQuery, toQuery: toQuery, netFloor: netFloor, payAt: payAt, billDate: billDate,
    carcassHint: carcassHint, futuresFor: futuresFor, futuresStamp: futuresStamp,
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
