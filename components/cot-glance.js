/* COT at a glance (2026-11-04, Sig: "concise and to the point at first glance").
   One plain line per market, the same words on /cot and the home card:

     Funds are fairly heavily long soybeans (75th percentile since 2010) and sold
     a net 27,544 contracts this week.

   Long or short, how heavy, and the week's change. The percentile is
   cot_analysis.py `crowd` (managed-money net as a share of open interest,
   ranked against every week since the market's first week), so it always
   names its period. How heavy, on the side the position is on, read from the
   printed (rounded) percentile `shown`, so one printed number always gets one word:
     90th or more (10th or less when short)   heavily (the page's "crowded")
     75th to 89th (11th to 25th)              fairly heavily
     26th to 74th                             moderately
     under 26th while long (over 74th short)  lightly
   A market inside the pipeline's flat band reads "about even".
   Without the analysis file (or for a different week) the line drops the
   percentile and the "how heavy" word rather than guess them.
   Exports window.AgCotGlance (and module.exports for the tests). */
(function (root) {
  'use strict';
  var NAMES = { corn: 'corn', beans: 'soybeans', wheat: 'Chicago wheat', kcwheat: 'KC wheat',
    mplswheat: 'Minneapolis wheat', soymeal: 'soybean meal', soyoil: 'soybean oil', livecattle: 'live cattle',
    feedercattle: 'feeder cattle', leanhogs: 'lean hogs', milk: 'Class III milk' };
  var ORDER = ['corn', 'beans', 'wheat', 'kcwheat', 'mplswheat', 'soymeal', 'soyoil', 'livecattle', 'feedercattle', 'leanhogs', 'milk'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MINUS = '−';

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function ord(n) { var v = n % 100, o = ['th', 'st', 'nd', 'rd']; return n + (o[(v - 20) % 10] || o[v] || o[0]); }
  /* "2026-10-27" or "October 27, 2026" -> a Date at noon, local */
  function day(s) {
    s = String(s || '');
    var d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s);
    return isNaN(d) ? null : d;
  }
  function iso(s) { var d = day(s); return d ? d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) : ''; }
  function short(d) { return MON[d.getMonth()] + ' ' + d.getDate(); }

  /* the word for how heavy a position is (see the head of this file) */
  function degree(side, p, crowded) {
    if (p == null || !isFinite(p)) return '';
    var q = side === 'short' ? 100 - p : p;
    if (crowded === side || q >= 90) return 'heavily';
    if (q >= 75) return 'fairly heavily';
    if (q >= 26) return 'moderately';
    return 'lightly';
  }

  /* One market's line. c: a cot-analysis.json commodity (net, chg, side, crowd)
     or a cot.json entry (net, prev, side). withPct: false drops the percentile.
     -> {key, html, text} or null when there is no net. */
  function line(key, c, withPct) {
    if (!c || typeof c.net !== 'number') return null;
    var name = NAMES[key] || key, net = c.net;
    var chg = typeof c.chg === 'number' ? c.chg : (typeof c.prev === 'number' ? net - c.prev : null);
    var side = c.side === 'flat' ? 'flat' : net > 0 ? 'long' : net < 0 ? 'short' : 'flat';
    var cr = withPct === false ? null : c.crowd;
    var p = cr && typeof cr.shown === 'number' ? cr.shown : null;
    var since = cr && cr.since ? String(cr.since) : '';
    var pct = p != null && since ? ord(p) + ' percentile since ' + since + (c.crowded ? ', crowded' : '') : '';
    var head, tail;
    if (side === 'flat') head = 'Funds are about even in ';
    else { var dg = pct ? degree(side, p, c.crowded) : ''; head = 'Funds are ' + (dg ? dg + ' ' : '') + side + ' '; }
    if (chg == null) tail = '';
    else if (chg === 0) tail = ' and held steady this week';
    else tail = ' and ' + (chg > 0 ? 'bought' : 'sold') + ' a net ' + num(chg) + ' contracts this week';
    var prev = chg == null ? null : net - chg;
    if (side !== 'flat' && prev != null && prev !== 0 && (prev > 0) !== (net > 0)) tail += ', flipping to ' + side;
    var mid = pct ? ' (' + pct + ')' : '';
    return { key: key, side: side,
      html: esc(head) + '<b>' + esc(name) + '</b>' + esc(mid + tail) + '.',
      text: head + name + mid + tail + '.' };
  }

  /* The analysis entry for a market when it is for the same week as cot.json. */
  function cxFor(key, cot, cx) {
    var c = cx && cx.commodities && cx.commodities[key];
    return c && c.date && cot && iso(c.date) === iso(cot.report_date) ? c : null;
  }

  /* Lines for the markets in keys (default every market, page order), from
     cot.json, upgraded with the analysis file's percentile when it is the same week. */
  function lines(cot, cx, keys) {
    var out = [];
    (keys || ORDER).forEach(function (k) {
      var a = cxFor(k, cot, cx), b = cot && cot[k];
      var l = a ? line(k, a, true) : (b ? line(k, b, false) : null);
      if (l) out.push(l);
    });
    return out;
  }

  /* "Positions as of Tuesday, Oct 27, released Friday, Oct 30." The release day
     comes from the analysis file (cot_calendar.release_date) when it is the same
     week; without it the line names the Tuesday alone. */
  function asOf(cot, cx) {
    var rd = day(cot && cot.report_date);
    if (!rd) return '';
    var rel = cx && iso(cx.report_date) === iso(cot.report_date) ? day(cx.release_date) : null;
    return 'Positions as of ' + DAY[rd.getDay()] + ', ' + short(rd) + (rel ? ', released ' + DAY[rel.getDay()] + ', ' + short(rel) : '') + '.';
  }

  /* "a, b and c" */
  function and(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }

  /* The crowded verdict over every market in the analysis file for this week
     (the same `crowded` field the lines use), never a subset:
       {state: 'none', text: 'No market crowded'}
       {state: 'long'|'short'|'mixed', text: 'Crowded: soybean meal (long), lean hogs and Class III milk (short)'}
     null when no market has the analysis for this week (nothing is claimed). */
  function crowdedLine(cot, cx) {
    var have = 0, lg = [], sh = [];
    ORDER.forEach(function (k) {
      var c = cxFor(k, cot, cx);
      if (!c) return;
      have++;
      if (c.crowded === 'long') lg.push(NAMES[k]);
      else if (c.crowded === 'short') sh.push(NAMES[k]);
    });
    if (!have) return null;
    if (!lg.length && !sh.length) return { state: 'none', text: 'No market crowded', markets: have };
    var parts = [];
    if (lg.length) parts.push(and(lg) + ' (long)');
    if (sh.length) parts.push(and(sh) + ' (short)');
    return { state: lg.length && sh.length ? 'mixed' : lg.length ? 'long' : 'short', text: 'Crowded: ' + parts.join(', '), markets: have };
  }

  var api = { NAMES: NAMES, ORDER: ORDER, degree: degree, line: line, lines: lines, asOf: asOf, cxFor: cxFor, ord: ord, crowdedLine: crowdedLine, MINUS: MINUS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgCotGlance = api;
})(typeof window !== 'undefined' ? window : this);
