/* COT at a glance (2026-11-04, Sig: "concise and to the point at first glance").
   One plain line per market, the same words on /cot and the home card:

     Funds are fairly heavily long soybeans (higher than 75% of weeks since 2010) and
     sold a net 27,544 contracts this week.

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
   Nov 5, Sig ("extremely repetitive wording"; "KISS, the chart I want can tell a
   lot of that story"): the pages no longer print one sentence per market. brief()
   is the one line over the 52-week chart for the market picked:
     Soybeans: funds long, fairly heavy, sold 27,544 this week
   row() is the same facts as table cells (market | long or short | rank | change),
   and verdict() the crowded line, short enough for one line where it fits.
   SLUG names each market in a link (/cot?m=soybeans). line() and lines() stay for
   anything that still wants a sentence.
   Nov 6, Sig ("get the cot page done now"): no ordinals. The rank is said in words,
   "higher than 48% of weeks since 2010" (a short: "a bigger net short than 67% of
   weeks since 2010"), from the pipeline's crowd.words. brief() keeps the weight word
   and leaves the rank to answer(), the one sentence under the chart title, which
   also names the Tuesday and the next report. release() is the state of the release
   bar at the top of /cot (countdown, out and updating, late, updated today), from
   cot.json's next_release (scripts/cot_calendar.py dates, holiday-aware).
   Exports window.AgCotGlance (and module.exports for the tests). */
(function (root) {
  'use strict';
  var NAMES = { corn: 'corn', beans: 'soybeans', wheat: 'Chicago wheat', kcwheat: 'KC wheat',
    mplswheat: 'Minneapolis wheat', soymeal: 'soybean meal', soyoil: 'soybean oil', livecattle: 'live cattle',
    feedercattle: 'feeder cattle', leanhogs: 'lean hogs', milk: 'Class III milk' };
  var ORDER = ['corn', 'beans', 'wheat', 'kcwheat', 'mplswheat', 'soymeal', 'soyoil', 'livecattle', 'feedercattle', 'leanhogs', 'milk'];
  /* the market in a link: /cot?m=soybeans (Nov 5) */
  var SLUG = { corn: 'corn', beans: 'soybeans', wheat: 'chicago-wheat', kcwheat: 'kc-wheat',
    mplswheat: 'mpls-wheat', soymeal: 'soybean-meal', soyoil: 'soybean-oil', livecattle: 'live-cattle',
    feedercattle: 'feeder-cattle', leanhogs: 'lean-hogs', milk: 'milk' };
  /* a slug (or the file's own key) -> the key, or null */
  function keyOf(m) {
    m = String(m || '').toLowerCase();
    for (var k in SLUG) if (SLUG[k] === m || k === m) return k;
    return null;
  }
  function href(k) { return '/cot?m=' + (SLUG[k] || k); }
  /* short market names for chips, table rows and the brief line */
  var SHORT = { corn: 'Corn', beans: 'Soybeans', wheat: 'Chicago wheat', kcwheat: 'KC wheat', mplswheat: 'MPLS wheat',
    soymeal: 'Soybean meal', soyoil: 'Soybean oil', livecattle: 'Live cattle', feedercattle: 'Feeder cattle',
    leanhogs: 'Lean hogs', milk: 'Class III milk' };
  var WEIGHT = { 'heavily': 'heavy', 'fairly heavily': 'fairly heavy', 'moderately': 'moderate', 'lightly': 'light' };
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

  /* The rank in words (never an ordinal): the pipeline's crowd.words when it is there,
     else the same rule from the printed whole number. */
  function rankWords(c) {
    var cr = c && c.crowd;
    if (!cr || typeof cr.shown !== 'number' || !cr.since) return '';
    if (cr.words) return cr.words;
    return c.net < 0 ? 'a bigger net short than ' + (100 - cr.shown) + '% of weeks since ' + cr.since
      : 'higher than ' + cr.shown + '% of weeks since ' + cr.since;
  }

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
     bare: true keeps the "how heavy" word but leaves out the bracketed percentile.
     -> {key, html, text} or null when there is no net. */
  function line(key, c, withPct, bare) {
    if (!c || typeof c.net !== 'number') return null;
    var name = NAMES[key] || key, net = c.net;
    var chg = typeof c.chg === 'number' ? c.chg : (typeof c.prev === 'number' ? net - c.prev : null);
    var side = c.side === 'flat' ? 'flat' : net > 0 ? 'long' : net < 0 ? 'short' : 'flat';
    var cr = withPct === false ? null : c.crowd;
    var p = cr && typeof cr.shown === 'number' ? cr.shown : null;
    var since = cr && cr.since ? String(cr.since) : '';
    var pct = p != null && since ? rankWords(c) + (c.crowded ? ', crowded' : '') : '';
    var head, tail;
    if (side === 'flat') head = 'Funds are about even in ';
    else { var dg = pct ? degree(side, p, c.crowded) : ''; head = 'Funds are ' + (dg ? dg + ' ' : '') + side + ' '; }
    if (chg == null) tail = '';
    else if (chg === 0) tail = ' and held steady this week';
    else tail = ' and ' + (chg > 0 ? 'bought' : 'sold') + ' a net ' + num(chg) + ' contracts this week';
    var prev = chg == null ? null : net - chg;
    if (side !== 'flat' && prev != null && prev !== 0 && (prev > 0) !== (net > 0)) tail += ', flipping to ' + side;
    var mid = pct && !bare ? ' (' + pct + ')' : '';
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

  /* One market's line without the bracketed percentile, the analysis upgrading
     it only when it is for the same week as cot.json (as lines() does). */
  function headline(key, cot, cx) {
    var a = cxFor(key, cot, cx), b = cot && cot[key];
    return a ? line(key, a, true, true) : (b ? line(key, b, false) : null);
  }

  /* The facts for one market, from the analysis when it is for the same week as
     cot.json, else from cot.json alone (no rank, no weight word: nothing guessed).
     -> {key, name, side, weight, rank, since, crowded, chg, flip} or null */
  function facts(key, cot, cx) {
    var a = cxFor(key, cot, cx), c = a || (cot && cot[key]);
    if (!c || typeof c.net !== 'number') return null;
    var net = c.net, chg = typeof c.chg === 'number' ? c.chg : (typeof c.prev === 'number' ? net - c.prev : null);
    var side = c.side === 'flat' ? 'flat' : net > 0 ? 'long' : net < 0 ? 'short' : 'flat';
    var cr = a && a.crowd, p = cr && typeof cr.shown === 'number' ? cr.shown : null, since = cr && cr.since ? String(cr.since) : '';
    if (!since) p = null;
    var prev = chg == null ? null : net - chg;
    return { key: key, name: SHORT[key] || key, side: side, net: net,
      weight: side === 'flat' || p == null ? '' : WEIGHT[degree(side, p, a.crowded)] || '',
      /* the table cell, short: "above 48%" (of weeks) for a long, "below 67%" for a short (the same N as the
         sentence's "a bigger net short than 67% of weeks") */
      rank: p == null ? '' : (net < 0 ? 'below ' + (100 - p) : 'above ' + p) + '%', words: p == null ? '' : rankWords(a),
      record: (a && a.crowd && a.crowd.record) || '', since: since, crowded: a ? a.crowded || null : null, chg: chg,
      flip: side !== 'flat' && prev != null && prev !== 0 && (prev > 0) !== (net > 0) };
  }

  /* "Soybeans: funds long, fairly heavy, sold 27,544 this week" (the rank in words is
     in answer(), right under it) -> {key, text, html} or null */
  function brief(key, cot, cx) {
    var f = facts(key, cot, cx);
    if (!f) return null;
    var pos = f.side === 'flat' ? 'funds about even' : 'funds ' + f.side + (f.weight ? ', ' + f.weight : '');
    var rk = f.crowded ? ', crowded' : '';
    var wk = f.chg == null ? '' : f.chg === 0 ? ', held steady this week' : ', ' + (f.chg > 0 ? 'bought ' : 'sold ') + num(f.chg) + ' this week';
    var fl = f.flip ? ', flipped to ' + f.side : '';
    var rest = pos + rk + wk + fl;
    return { key: key, text: f.name + ': ' + rest, html: '<b>' + esc(f.name) + ':</b> ' + esc(rest) };
  }

  /* Table cells: market | long or short | rank | change (signed, contracts) */
  function row(key, cot, cx) {
    var f = facts(key, cot, cx);
    if (!f) return null;
    var pos = f.side === 'flat' ? 'About even' : (f.side === 'long' ? 'Long' : 'Short') + (f.flip ? ', flipped' : f.crowded ? ', crowded' : f.weight ? ', ' + f.weight : '');
    var chg = f.chg == null ? '' : f.chg === 0 ? '0' : (f.chg > 0 ? '+' : MINUS) + num(f.chg);
    return { key: key, name: f.name, pos: pos, rank: f.rank, chg: chg, side: f.side, since: f.since };
  }
  function rows(cot, cx, keys) { var out = []; (keys || ORDER).forEach(function (k) { var r = row(k, cot, cx); if (r) out.push(r); }); return out; }

  /* The crowded verdict in its short form, for one line:
     "Crowded: soybean meal long; lean hogs, Class III milk short" | "No market crowded" | null */
  function verdict(cot, cx) {
    var v = crowdedLine(cot, cx);
    if (!v) return null;
    if (v.state === 'none') return v.text;
    var lg = [], sh = [];
    ORDER.forEach(function (k) { var c = cxFor(k, cot, cx); if (c && c.crowded === 'long') lg.push(NAMES[k]); else if (c && c.crowded === 'short') sh.push(NAMES[k]); });
    var parts = [];
    if (lg.length) parts.push(lg.join(', ') + ' long');
    if (sh.length) parts.push(sh.join(', ') + ' short');
    return 'Crowded: ' + parts.join('; ');
  }
  /* "As of Tue, Oct 27, released Fri, Oct 30" (short, for one line) */
  function asOfShort(cot, cx) {
    var rd = day(cot && cot.report_date);
    if (!rd) return '';
    var rel = cx && iso(cx.report_date) === iso(cot.report_date) ? day(cx.release_date) : null;
    return 'As of ' + DAY[rd.getDay()].slice(0, 3) + ', ' + short(rd) + (rel ? ', released ' + DAY[rel.getDay()].slice(0, 3) + ', ' + short(rel) : '');
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

  /* ---------------------------------------------------------------- the next report
     Times are New York wall clock (3:30 PM ET), right in EST and EDT. */
  var TZ = 'America/New_York';
  function etParts(ms) {
    var p = {};
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    } catch (e) { var d = new Date(ms - 5 * 3600000); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }; }
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour === 24 ? 0 : +p.hour, mi: +p.minute };
  }
  function etInstant(isoDay, hhmm) {
    var q = String(isoDay).split('-'), t = String(hhmm || '15:30').split(':');
    var y = +q[0], mo = +q[1] - 1, d = +q[2], hh = +t[0], mm = +t[1] || 0;
    var guess = Date.UTC(y, mo, d, hh + 4, mm), p = etParts(guess);
    var off = (guess - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi)) / 60000;   /* 240 in EDT, 300 in EST */
    return Date.UTC(y, mo, d, hh, mm) + off * 60000;
  }
  function etDay(ms) { var p = etParts(ms); return p.y + '-' + ('0' + p.m).slice(-2) + '-' + ('0' + p.d).slice(-2); }
  function clock(hhmm) {
    var t = String(hhmm || '15:30').split(':'), h = +t[0], m = +t[1] || 0;
    return (h % 12 || 12) + ':' + ('0' + m).slice(-2) + (h < 12 ? ' AM' : ' PM') + ' ET';
  }
  /* "Friday Nov 13, 3:30 PM ET" (with today: "today 3:30 PM ET") */
  function when(isoDay, hhmm, now) {
    var d = day(isoDay);
    if (!d) return '';
    if (now != null && etDay(now) === isoDay) return 'today ' + clock(hhmm);
    return DAY[d.getDay()] + ' ' + short(d) + ', ' + clock(hhmm);
  }
  function left(ms) {
    var m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    if (d > 0) return d + ' d ' + h + ' h';
    if (h > 0) return h + ' h ' + mm + ' m';
    return mm > 0 ? mm + ' m' : 'under 1 m';
  }
  /* The day the loaded report came out: cot.json release_date, else the analysis for the
     same week, else the Friday of the as-of week (the base rule). */
  function loadedRelease(cot, cx) {
    if (cot && /^\d{4}-\d{2}-\d{2}$/.test(cot.release_date || '')) return cot.release_date;
    var rd = iso(cot && cot.report_date);
    if (cx && iso(cx.report_date) === rd && /^\d{4}-\d{2}-\d{2}$/.test(cx.release_date || '')) return cx.release_date;
    var d = day(rd);
    if (!d) return '';
    d.setDate(d.getDate() + (5 - d.getDay() + 7) % 7);
    return iso(d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2));
  }
  /* The release bar's state at `now` (ms).
     -> {state: 'countdown'|'due'|'late'|'updated'|'none', text, next, due, moved, inbox}
     countdown: "New report in 2 h 14 m · Friday 3:30 PM ET"
     due (first 3 hours past the time, the page still on the old report): "New report out at 3:30 PM ET, updating"
     late: "The report due Friday Nov 6, 3:30 PM ET is late. Still checking."
     updated (the loaded report came out today ET): "Updated today with the report of Tuesday, Nov 3"
     next: the short phrase for the answer line ("Next report: today 3:30 PM ET"). */
  function release(cot, cx, now) {
    var nr = cot && cot.next_release, hm = (cot && cot.next_release_time_et) || '15:30';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nr || '')) return { state: 'none', text: '', next: '' };
    var due = etInstant(nr, hm), nd = day(nr), moved = nd.getDay() !== 5;
    var w = when(nr, hm, now), mv = moved ? ' (holiday week)' : '';
    var inbox = 'Get it in your inbox ' + DAY[nd.getDay()];
    var rel = loadedRelease(cot, cx), rd = day(cot.report_date);
    if (now >= due) {
      if (now < due + 3 * 3600000)
        return { state: 'due', due: due, moved: moved, inbox: inbox, text: 'New report out at ' + clock(hm) + ', updating',
          next: 'Next report: out ' + (etDay(now) === nr ? 'today' : 'on ' + DAY[nd.getDay()]) + ' at ' + clock(hm) + ', updating' };
      var dw = DAY[nd.getDay()] + ' ' + short(nd) + ', ' + clock(hm);
      return { state: 'late', due: due, moved: moved, inbox: inbox, text: 'The report due ' + dw + ' is late. Still checking.',
        next: 'Next report: due ' + dw + ', late' };
    }
    var nx = 'Next report: ' + w + mv;
    if (rel && rd && etDay(now) === rel && now >= etInstant(rel, hm))
      return { state: 'updated', due: due, moved: moved, inbox: inbox, next: nx,
        text: 'Updated today with the report of ' + DAY[rd.getDay()] + ', ' + short(rd) };
    return { state: 'countdown', due: due, moved: moved, inbox: inbox, next: nx,
      text: 'New report in ' + left(due - now) + ' \u00b7 ' + (etDay(now) === nr ? 'today ' + clock(hm) : DAY[nd.getDay()] + (due - now > 6 * 86400000 ? ' ' + short(nd) : '') + ' ' + clock(hm)) + mv };
  }

  /* The answer line under the chart title: what managed money did in the report week,
     in one sentence, with the rank in words, then the next report.
     "Managed money sold a net 83,310 contracts of corn in the week to Tuesday, Oct 27,
      leaving funds net long 81,113: higher than 48% of weeks since 2010 (share of open
      interest)." -> {did, next, text} or null. now (ms) is optional; without it no next. */
  function answer(key, cot, cx, now) {
    var f = facts(key, cot, cx), rd = day(cot && cot.report_date);
    if (!f || !rd) return null;
    var name = NAMES[key] || key, wk = ' in the week to ' + DAY[rd.getDay()] + ', ' + short(rd);
    var act = f.chg == null ? 'Managed money held ' + name + wk : f.chg === 0 ? 'Managed money held ' + name + ' steady' + wk
      : 'Managed money ' + (f.chg > 0 ? 'bought' : 'sold') + ' a net ' + num(f.chg) + ' contracts of ' + name + wk;
    var pos = f.side === 'flat' ? 'funds about even (net ' + (f.net < 0 ? 'short ' : 'long ') + num(f.net) + ')'
      : 'funds net ' + f.side + ' ' + num(f.net);
    var did = act + ', leaving ' + pos + (f.record ? ', ' + f.record : '') + (f.words ? ': ' + f.words + ' (share of open interest)' : '') + '.';
    var r = now != null ? release(cot, cx, now) : null, next = r && r.next ? r.next + '.' : '';
    return { did: did, next: next, text: did + (next ? ' ' + next : '') };
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

  var api = { NAMES: NAMES, ORDER: ORDER, SLUG: SLUG, SHORT: SHORT, keyOf: keyOf, href: href, headline: headline, iso: iso,
    facts: facts, brief: brief, answer: answer, release: release, rankWords: rankWords, etInstant: etInstant, etDay: etDay, when: when, left: left, row: row, rows: rows, verdict: verdict, asOfShort: asOfShort, degree: degree, line: line, lines: lines, asOf: asOf, cxFor: cxFor, ord: ord, crowdedLine: crowdedLine, MINUS: MINUS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgCotGlance = api;
})(typeof window !== 'undefined' ? window : this);
