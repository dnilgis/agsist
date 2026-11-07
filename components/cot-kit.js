/* Shared pieces of the COT kit (kit v2, Nov 6, 2026, Sig: the share kit panel's chart spec): number and date words,
   futures prices in a farmer's units, the round y ticks, the dated month and year axis, and the buying or selling run.
   components/cot-chart.js (the page chart and the saved pictures) and components/cot-print.js (the printed sheet)
   both use them, so every asset says a number, a date and a run the same way. Kept out of cot-chart.js so that file
   stays under its size budget. Exports window.AgCotKit (and module.exports for the tests). */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MINUS = '−';
  /* the share kit core (components/share-kit.js): the link tags every kit shares; without it a link has no tags */
  function SK() { return root.AgShareKit || (typeof require === 'function' ? require('./share-kit.js') : null); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function commas(n) { return Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  /* 193781 -> "193,781 long"; -74606 -> "74,606 short"; 0 -> "0" */
  function netWords(n) { return n === 0 ? '0' : commas(n) + (n > 0 ? ' long' : ' short'); }
  /* axis ticks: 100000 -> "100k", -50000 -> "-50k" (a true minus) */
  function kTick(v) {
    if (v === 0) return '0';
    var a = Math.abs(v), s = a >= 1000 ? (a % 1000 ? (a / 1000).toFixed(1) : String(a / 1000)) + 'k' : String(a);
    return (v < 0 ? MINUS : '') + s;
  }
  /* 95867 -> "95.9k short", 414460 -> "414.5k long": words, never a minus sign */
  function kWords(n) { return n === 0 ? '0' : kTick(Math.abs(n) >= 1000 ? Math.round(Math.abs(n) / 100) * 100 : Math.abs(n)) + (n > 0 ? ' long' : ' short'); }
  function dt(s) { return new Date(String(s) + 'T12:00:00'); }
  function mdy(s) { var d = dt(s); return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
  function md(s) { var d = dt(s); return MON[d.getMonth()] + ' ' + d.getDate(); }
  /* the width a label takes, estimated (Inter's figures run about 0.6 em) */
  function tw(s, size) { return String(s).length * size * 0.56; }

  /* Futures closes as the price file stores them (enrich_cot_prices.py: exchange units), in a farmer's units. */
  function cents(c) { /* 1229.25 cents -> "$12.29¼" */
    var q = Math.round(c * 4) / 4, whole = Math.floor(q + 1e-9), f = Math.round((q - whole) * 4);
    var d = Math.floor(whole / 100), r = whole % 100;
    return '$' + d + '.' + ('0' + r).slice(-2) + ['', '¼', '½', '¾'][f];
  }
  function bu(p) { return cents(p) + '/bu'; }
  function cwt(p) { return '$' + p.toFixed(2) + '/cwt'; }
  var UNIT = { corn: bu, beans: bu, wheat: bu, kcwheat: bu, mplswheat: bu,
    soymeal: function (p) { return '$' + p.toFixed(2) + '/ton'; }, soyoil: function (p) { return p.toFixed(2) + '¢/lb'; },
    livecattle: cwt, feedercattle: cwt, leanhogs: cwt, milk: cwt };
  function px(key, p) { return typeof p === 'number' && UNIT[key] ? UNIT[key](p) : ''; }
  /* the price scale's own labels: the close without the unit ("$5.37", "$230.00", "60.12¢") */
  function pxShort(key, p) { return px(key, p).replace(/\/(bu|ton|cwt|lb)$/, ''); }

  /* Round ticks: a step of 1, 2, 2.5 or 5 x 10^n giving nMin to nMax ticks, zero always one of them, the top tick at
     most half a step past the highest value (and the bottom tick likewise), so the plot is not left half empty.
     -> {step, vals, lo, hi}: lo and hi are the plotted span (the ticks, widened to the data where it runs past). */
  function ticks(min, max, nMin, nMax) {
    var span = max - min || 1, best = null;
    for (var e = Math.floor(Math.log(span) / Math.LN10) - 2; e <= Math.floor(Math.log(span) / Math.LN10) + 1; e++) {
      [1, 2, 2.5, 5].forEach(function (b) {
        var st = b * Math.pow(10, e);
        var top = Math.floor(max / st) * st, bot = Math.ceil(min / st) * st;
        if (max - top > st / 2) top += st;
        if (bot - min > st / 2) bot -= st;
        var n = Math.round((top - bot) / st) + 1, miss = n < nMin ? nMin - n : n > nMax ? n - nMax : 0;
        if (!best || miss < best.miss || (miss === best.miss && n < best.n && !miss)) best = { st: st, top: top, bot: bot, n: n, miss: miss };
      });
    }
    var vals = [];
    for (var v = best.bot; v <= best.top + best.st / 2; v += best.st) vals.push(Math.round(v / best.st) * best.st);
    var lo = Math.min(best.bot, min), hi = Math.max(best.top, max);
    if (hi === lo) hi = lo + best.st;
    return { step: best.st, vals: vals, lo: lo, hi: hi };
  }

  /* A run of buying or selling: the weeks in a row, ending with the last row, when the net moved the same way each
     week (weekly reports only; a gap of more than 8 days ends it). rows: [{date, net}] sorted.
     -> {dir: 'bought'|'sold', weeks, total, start (the row the run starts from), text} for 3 weeks or more, else null */
  function run(rows) {
    var sign = 0, weeks = 0, total = 0;
    for (var i = rows.length - 1; i > 0; i--) {
      if ((dt(rows[i].date) - dt(rows[i - 1].date)) / 86400000 > 8) break;
      var d = rows[i].net - rows[i - 1].net, s = d > 0 ? 1 : d < 0 ? -1 : 0;
      if (!s || (sign && s !== sign)) break;
      sign = s; weeks++; total += d;
    }
    if (weeks < 3) return null;
    var dir = sign > 0 ? 'bought' : 'sold';
    return { dir: dir, weeks: weeks, total: total, start: rows.length - 1 - weeks,
      text: (dir === 'bought' ? 'Bought' : 'Sold') + ' in each of the last ' + weeks + ' weeks, ' + commas(total) + ' contracts in all.',
      tag: (dir === 'bought' ? 'Bought ' : 'Sold ') + weeks + ' weeks: ' + commas(total) };
  }

  /* The time axis under a chart placed by date: a 1 px tick at the first report of each month, a month name every
     k-th month (k by the room per label), the year on a second row under the first label and under each January,
     and the latest date in full and bold at the right end. A label that would come within 0.6 em of another is
     dropped. dates: ISO days; X(i): the x of dates[i]; top: the axis line's y. -> chart items */
  function axis(dates, X, top, fs) {
    var items = [], n = dates.length, lx = X(n - 1), per = (lx - X(0)) / fs, k = per < 30 ? 3 : per < 50 ? 2 : 1;
    var ly = top + fs * 0.45, yy = top + fs * 1.7, row1 = [], row2 = [], gap = fs * 0.6;
    function clear(row, b) { return b[0] >= 0 && !row.some(function (o) { return b[0] < o[1] + gap && b[1] > o[0] - gap; }); }
    items.push({ t: 'line', pts: [[X(0), top], [lx, top]], ink: 'grid', width: 1 });
    var lt = mdy(dates[n - 1]);
    row1.push([lx - tw(lt, fs), lx]);
    items.push({ t: 'text', x: lx, y: ly, s: lt, ink: 'text', size: fs, weight: 700, align: 'right', base: 'top' });
    var prev = -1, first = null;
    dates.forEach(function (ds, i) {
      var d = dt(ds), mo = d.getMonth(), tick = i ? mo !== prev : d.getDate() <= 7;
      prev = mo;
      if (!tick) return;
      var x = X(i);
      items.push({ t: 'line', pts: [[x, top], [x, top + fs * 0.35]], ink: 'axis', width: 1 });
      if (mo % k) return;
      var s = MON[mo], b = [x - tw(s, fs) / 2, x + tw(s, fs) / 2];
      if (!clear(row1, b)) return;
      row1.push(b);
      items.push({ t: 'text', x: x, y: ly, s: s, ink: 'muted', size: fs, align: 'center', base: 'top' });
      var yr = String(d.getFullYear()), yb = [x - tw(yr, fs) / 2, x + tw(yr, fs) / 2];
      if ((first === null || mo === 0) && clear(row2, yb)) { row2.push(yb); items.push({ t: 'text', x: x, y: yy, s: yr, ink: 'muted', size: fs, weight: 600, align: 'center', base: 'top' }); }
      if (first === null) first = yr;
    });
    /* the first week's year at the left end when the first month named is in a later year */
    var y0 = String(dt(dates[0]).getFullYear()), b0 = [X(0), X(0) + tw(y0, fs)];
    if (y0 !== first && clear(row2, b0)) items.push({ t: 'text', x: X(0), y: yy, s: y0, ink: 'muted', size: fs, weight: 600, align: 'left', base: 'top' });
    return items;
  }

  /* Contracts in the crop's own units (kit v2 part 2, Sig Nov 6: "contracts shown in bushels too"). The size of one
     futures contract, from the exchange contract specifications (CBOT corn, soybeans, Chicago SRW wheat, KC HRW wheat
     and Minneapolis HRS wheat 5,000 bushels; soybean meal 100 short tons; soybean oil 60,000 pounds; CME live cattle
     40,000 pounds, feeder cattle 50,000 pounds, lean hogs 40,000 pounds, Class III milk 200,000 pounds). A public fact
     about the contract, not price data. Said as "about", rounded to 2 significant figures. */
  var SPEC = { corn: [5000, 'bushels'], beans: [5000, 'bushels'], wheat: [5000, 'bushels'], kcwheat: [5000, 'bushels'],
    mplswheat: [5000, 'bushels'], soymeal: [100, 'short tons'], soyoil: [60000, 'pounds'], livecattle: [40000, 'pounds'],
    feedercattle: [50000, 'pounds'], leanhogs: [40000, 'pounds'], milk: [200000, 'pounds'] };
  var SPEC_SRC = 'Contract sizes: exchange contract specifications.';
  /* 43975000 -> "44 million"; 361590000 -> "360 million"; 2500000000 -> "2.5 billion"; 250000 -> "250,000" */
  function about(v) {
    v = Math.abs(v);
    if (!v) return '0';
    var e = Math.floor(Math.log(v) / Math.LN10), r = Math.round(v / Math.pow(10, e - 1)) * Math.pow(10, e - 1);
    var u = r >= 1e9 ? [1e9, ' billion'] : r >= 1e6 ? [1e6, ' million'] : null;
    if (!u) return commas(r);
    var x = r / u[0];
    return String(Math.round(x * 100) / 100) + u[1];
  }
  /* (key, 72318) -> "about 360 million bushels"; '' for a market without a size */
  function qty(key, n) { var s = SPEC[key]; return s && typeof n === 'number' ? 'about ' + about(n * s[0]) + ' ' + s[1] : ''; }
  /* One line for a picture or a sheet: "In bushels: about 360 million sold, about 44 million net long."
     The unit named first; the week's change, then where funds stand. '' without a size or a net. */
  function qtyLine(key, net, chg) {
    var s = SPEC[key];
    if (!s || typeof net !== 'number') return '';
    var parts = [];
    if (typeof chg === 'number' && chg) parts.push('about ' + about(chg * s[0]) + (chg > 0 ? ' bought' : ' sold'));
    parts.push(net ? 'about ' + about(net * s[0]) + ' net ' + (net > 0 ? 'long' : 'short') : 'no net position');
    return 'In ' + s[1] + ': ' + parts.join(', ') + '.';
  }

  /* One link convention for every kit asset (kit v2 part 2, the growth seat; the tags from AgShareKit.tags): the market and the report week in the
     address (Facebook keeps one preview per address), and utm_source share|print|email, utm_medium
     picture|sheet|qr|forward|link, utm_campaign cot-<report date>; the hash opens the chart on that market.
     (key, '2026-11-03', 'share', 'picture') -> https://agsist.com/cot?m=soybeans&w=2026-11-03&utm_source=share&... */
  function link(keys, week, src, med, hash) {
    var SL = (root.AgCotGlance || (typeof require === 'function' ? require('./cot-glance.js') : {})).SLUG || {};
    var ks = [].concat(keys || []).map(function (k) { return SL[k] || k; }).join(',');
    var q = [];
    if (ks) q.push('m=' + ks);
    if (ks && /^\d{4}-\d{2}-\d{2}$/.test(week || '')) q.push('w=' + week);   /* a market's preview, per week */
    if (src && SK()) q.push(SK().tags(src, med, 'cot' + (week ? '-' + week : '')));
    return 'https://agsist.com/cot' + (q.length ? '?' + q.join('&') : '') + (hash === undefined ? (ks && ks.indexOf(',') < 0 ? '#' + ks : '') : hash);
  }

  var api = { MON: MON, MINUS: MINUS, esc: esc, commas: commas, netWords: netWords, kTick: kTick, kWords: kWords, dt: dt, mdy: mdy, md: md,
    tw: tw, px: px, pxShort: pxShort, ticks: ticks, run: run, axis: axis,
    SPEC: SPEC, SPEC_SRC: SPEC_SRC, about: about, qty: qty, qtyLine: qtyLine, link: link };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgCotKit = api;
})(typeof window !== 'undefined' ? window : this);
