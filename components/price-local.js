/* components/price-local.js: two small things for the pages that lead with a
   futures price (corn, soybean, wheat and cattle futures, /markets, home).

   1. AgPxStamp: what the price stamp says. A quote the price file marks a
      settle (close_kind "settle") reads "Oct 16 settle"; a trade reads
      "Read 1:46 pm CT; quotes delayed 10 to 25 min" (when the site read it),
      or "Last trade at the 1:20 pm CT bell, change from the Nov 10 settle;
      settle not posted yet" after the close (change(): the one pair rule). A quote with no close_kind says "Updated <time> CT". Always
      Central time, always named.

   2. The state line under the price. Only for a reader whose state the site
      already saved (agsist-wx-loc from geo.js, else a saved ZIP's state). It
      never guesses a state and sends nothing. With a state it loads
      data/basis-states.json (and only then) and prints one line:
        Illinois corn: basis 31¢ under Dec '26 futures, about $4.43 cash
        on the Oct 16 settle. The median of 186 elevators, Oct 17. Bids near you ->
      The cash figure is futures plus the state median basis, for the same
      contract only, and is labeled "about". No state: nothing, or a small
      "Set your ZIP" link where the page asks for one (data-zip-link).
      On the futures pages the basis card finds the reader's nearest
      elevator (futures.js, bids-network.js). When that bid is local it sends
      "agsist:nearbid" and this line shows that bid instead.

   A page opts in with
     <p class="pl-line" data-state-bid="corn" hidden></p>   (corn, soybeans, wheat; several: "corn soybeans")
   and this script (defer). Tests: test/price-local.test.mjs */
(function (root) {
  'use strict';
  /* 'median of 203 elevators, 23 companies' beside a state basis middle (scripts/build_cash_bid_pages.py med_of, Nov 3 2026); a file without the company count says 'median of N elevators'. */
  function medOf(n, m) { var s = 'median of ' + n + ' elevator' + (n === 1 ? '' : 's'); return typeof m !== 'number' ? s : s + ', ' + m + ' compan' + (m === 1 ? 'y' : 'ies'); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var FR = { 0: '', 25: '¼', 50: '½', 75: '¾' }, DAY = 864e5, TZ = 'America/Chicago';
  var NAMES = {};
  ('AL Alabama|AK Alaska|AZ Arizona|AR Arkansas|CA California|CO Colorado|CT Connecticut|DE Delaware|FL Florida|GA Georgia|HI Hawaii|ID Idaho|IL Illinois|IN Indiana|IA Iowa|KS Kansas|KY Kentucky|LA Louisiana|ME Maine|MD Maryland|MA Massachusetts|MI Michigan|MN Minnesota|MS Mississippi|MO Missouri|MT Montana|NE Nebraska|NV Nevada|NH New Hampshire|NJ New Jersey|NM New Mexico|NY New York|NC North Carolina|ND North Dakota|OH Ohio|OK Oklahoma|OR Oregon|PA Pennsylvania|RI Rhode Island|SC South Carolina|SD South Dakota|TN Tennessee|TX Texas|UT Utah|VT Vermont|VA Virginia|WA Washington|WV West Virginia|WI Wisconsin|WY Wyoming')
    .split('|').forEach(function (s) { NAMES[s.slice(0, 2)] = s.slice(3); });
  /* ZIP prefix to state (same table as components/cb-vs-state.js) */
  var Z3 = '005NY006--010MA028RI030NH039ME050VT055MA056VT060CT070NJ090--100NY150PA197DE200DC201VA202DC206MD220VA247WV270NC290SC300GA320FL340--341FL350AL370TN386MS398GA400KY430OH460IN480MI500IA530WI550MN569DC570SD580ND590MT600IL630MO660KS680NE700LA716AR730OK733TX734OK750TX800CO820WY832ID840UT850AZ870NM885TX889NV900CA962--967HI969--970OR980WA995AK';
  function zipState(zip) {
    if (!/^\d{5}$/.test(zip || '')) return '';
    var p = +zip.slice(0, 3), st = '';
    for (var i = 0; i < Z3.length; i += 5) { if (+Z3.substr(i, 3) > p) break; st = Z3.substr(i + 3, 2); }
    return NAMES[st] ? st : '';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* Central-time parts of a time */
  function ct(t) {
    var d = t instanceof Date ? t : new Date(t), o = {};
    if (isNaN(d)) return null;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
        .formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
      return { y: +o.year, m: +o.month, d: +o.day, hh: (+o.hour) % 24, mm: +o.minute };
    } catch (e) {
      var x = new Date(d.getTime() - 6 * 36e5);
      return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), hh: x.getUTCHours(), mm: x.getUTCMinutes() };
    }
  }
  function hm(p) { var h = p.hh % 12 || 12; return h + ':' + (p.mm < 10 ? '0' : '') + p.mm + ' ' + (p.hh < 12 ? 'am' : 'pm'); }
  function sameDay(a, b) { return a && b && a.y === b.y && a.m === b.m && a.d === b.d; }
  /* "1:46 am CT" today, "Oct 16, 1:46 pm CT" another day */
  function clock(t, now) {
    var p = ct(t), q = ct(now || new Date());
    if (!p) return '';
    return (sameDay(p, q) ? '' : MON[p.m - 1] + ' ' + p.d + ', ' + (q && q.y !== p.y ? p.y + ', ' : '')) + hm(p) + ' CT';
  }
  /* "Oct 16", or "Sep 11, 2025" when the day is not in this year (Central time) */
  function isoDay(s, now) {
    var m = /^(\d{4})-(\d\d)-(\d\d)/.exec(s || '');
    if (!m) return '';
    var q = ct(now || new Date());
    return MON[+m[2] - 1] + ' ' + (+m[3]) + (q && q.y !== +m[1] ? ', ' + m[1] : '');
  }

  /* ---- the exchange calendar: twin of scripts/contract_calendar.py ----
     Full-closure holidays (market_holidays) and the expiry rules per product
     (dead_from). test/chaosfix.test.mjs runs both against the Python. */
  function isoOf(t) { return new Date(t).toISOString().slice(0, 10); }
  function tOf(iso) { return Date.parse(iso + 'T00:00:00Z'); }
  function wdOf(t) { return new Date(t).getUTCDay(); }
  function U(y, m, d) { return Date.UTC(y, m - 1, d); }
  function nthW(y, m, w, n) { var t = U(y, m, 1); t += ((w - wdOf(t) + 7) % 7) * DAY; return t + (n - 1) * 7 * DAY; }
  function lastW(y, m, w) { var t = Date.UTC(y, m, 0); return t - ((wdOf(t) - w + 7) % 7) * DAY; }
  function obs(t) { var x = wdOf(t); return x === 6 ? t - DAY : x === 0 ? t + DAY : t; }
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, mm = Math.floor((a + 11 * h + 22 * l) / 451);
    return U(y, Math.floor((h + l - 7 * mm + 114) / 31), ((h + l - 7 * mm + 114) % 31) + 1);
  }
  var HOL = {};
  function marketHolidays(y) {
    if (HOL[y]) return HOL[y];
    var o = {};
    [[obs(U(y, 1, 1)), "New Year's Day"], [nthW(y, 1, 1, 3), 'MLK Day'], [nthW(y, 2, 1, 3), 'Presidents Day'], [easter(y) - 2 * DAY, 'Good Friday'],
      [lastW(y, 5, 1), 'Memorial Day'], [obs(U(y, 6, 19)), 'Juneteenth'], [obs(U(y, 7, 4)), 'Independence Day'], [nthW(y, 9, 1, 1), 'Labor Day'],
      [nthW(y, 11, 4, 4), 'Thanksgiving'], [obs(U(y, 12, 25)), 'Christmas Day']].forEach(function (p) { o[isoOf(p[0])] = p[1]; });
    return (HOL[y] = o);
  }
  function holidayName(iso) {
    var y = +String(iso).slice(0, 4);
    for (var i = -1; i <= 1; i++) { var n = marketHolidays(y + i)[iso]; if (n) return n; }
    return null;
  }
  function isTradingDay(iso) { var w = wdOf(tOf(iso)); return w >= 1 && w <= 5 && !holidayName(iso); }
  function ctIso(now) { var p = ct(now || new Date()); return p ? p.y + '-' + (p.m < 10 ? '0' : '') + p.m + '-' + (p.d < 10 ? '0' : '') + p.d : ''; }

  /* HOW OLD A SETTLE IS (2026-10-17, chaos-1). lag: the trading sessions
     after the settle's day and before today (Central), each one a settle the
     file should have and does not. A Friday settle on Monday morning is lag 0;
     on Tuesday it is lag 1. stale (lag 1+) adds "N days old" to the stamp;
     old (lag OLD_SESSIONS+) also greys the price. */
  var OLD_SESSIONS = 4;
  function settleAge(dayIso, now) {
    var m = /^(\d{4}-\d{2}-\d{2})/.exec(dayIso || ''), today = ctIso(now);
    if (!m || !today) return null;
    var t = tOf(m[1]) + DAY, end = tOf(today), lag = 0, n = 0;
    for (; t < end && n < 800; t += DAY, n++) if (isTradingDay(isoOf(t))) lag++;
    var days = Math.max(0, Math.round((end - tOf(m[1])) / DAY));
    return { lag: lag, days: days, stale: lag >= 1, old: lag >= OLD_SESSIONS, note: lag >= 1 ? days + (days === 1 ? ' day old' : ' days old') : '' };
  }

  /* WHEN A CONTRACT STOPS TRADING (contract_calendar.py dead_from): the first
     Central-time day it is dead. GRAIN dead from the 15th; MONTH_END (live
     cattle, and milk unverified) from the 1st of the next month; LAST_THURSDAY
     (feeders; November: the Thursday before Thanksgiving) and
     TENTH_BUSINESS_DAY (hogs) from the day after. Unknown product: null. */
  var RULE = { ZC: 'G', ZS: 'G', ZW: 'G', KE: 'G', MW: 'G', ZO: 'G', ZM: 'G', ZL: 'G', LE: 'ME', DC: 'ME', GF: 'LT', HE: 'TB' };
  var FCODE = 'FGHJKMNQUVXZ';
  function deadFrom(ticker) {
    var x = /^([A-Z]{2})([FGHJKMNQUVXZ])(\d{2})\b/.exec(String(ticker || '')), r = x && RULE[x[1]];
    if (!r) return null;
    var y = 2000 + (+x[3]), m = FCODE.indexOf(x[2]) + 1;
    if (r === 'G') return isoOf(U(y, m, 15));
    if (r === 'ME') return isoOf(Date.UTC(y, m, 1));
    if (r === 'LT') return isoOf((m === 11 ? nthW(y, 11, 4, 3) : lastW(y, m, 4)) + DAY);
    for (var t = U(y, m, 1), seen = 0; ; t += DAY) if (isTradingDay(isoOf(t)) && ++seen === 10) return isoOf(t + DAY);
  }
  function expired(ticker, now) { var d = deadFrom(ticker); return !!d && ctIso(now) >= d; }
  function label(ticker) { var x = /^[A-Z]{2}([FGHJKMNQUVXZ])(\d{2})\b/.exec(String(ticker || '')); return x ? MON[FCODE.indexOf(x[1])] + " '" + x[2] : ''; }
  /* ROLL OFF EXPIRED CONTRACTS (chaos-1). A price file that stopped updating
     still names Dec '26 corn on Jan 2. -> a copy of quotes where every dead
     dated key (corn-dec26) is gone and every alias on a dead contract
     (corn-nearby, corn-dec, cattle) points at the nearest live month of the
     same product on file (the same month for a month alias: corn-dec -> the
     next Dec), labeled with its own contract, or is gone when none is. */
  var M3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function roll(quotes, now) {
    var out = {}, k;
    if (!quotes) return quotes;
    for (k in quotes) out[k] = pairGuard(quotes[k], k);
    function dead(x) { return !!(x && x.ticker && expired(x.ticker, now)); }
    for (k in out) if (/^[a-z]+-[a-z]{3}\d{2}$/.test(k) && dead(out[k])) delete out[k];
    for (k in out) {
      if (!dead(out[k])) continue;
      var root = k.split('-')[0], am = /^[a-z]+-([a-z]{3})$/.exec(k), mon = am && M3.indexOf(am[1]) >= 0 ? am[1] : null;
      var re = new RegExp('^' + root + '-(' + (mon || '[a-z]{3}') + ')(\\d{2})$'), best = null, bi = Infinity;
      for (var j in out) {
        var mm = re.exec(j), x = out[j];
        if (!mm || !x || x.close == null || M3.indexOf(mm[1]) < 0) continue;
        var i = (+mm[2]) * 12 + M3.indexOf(mm[1]);
        if (i < bi) { bi = i; best = x; }
      }
      if (best) { var c = {}; for (var f in best) c[f] = best[f]; c.contract = label(best.ticker) || c.contract; c.rolled_from = label(out[k].ticker); out[k] = c; }
      else delete out[k];
    }
    return out;
  }

  /* THE OVERNIGHT (ELECTRONIC) TRADE, 2026-10-20.
     CBOT grains trade electronically 7:00 pm to 7:45 am CT. The price file
     carries that trade in one of two shapes (fetch_prices v3.7):
       before the settle posts (about 7 to 11 pm CT): settled:true, close is
         the day session's last trade, and the evening trade is last /
         last_time / last_date / last_net (last_net from that close);
       after it posts (about 11 pm to 7:45 am CT): close is the overnight
         trade (close_kind "last", close_time in the overnight), netChange
         from settle / settle_date, the day just finished.
     Returns { px, net, at, hero, ref: { px, date, kind } } or null. hero:
     the page's main price already IS this trade (second shape). ref.kind is
     "settle" or "last" (the day's last trade, before the settle posts).
     An overnight trade is never a settle: titles keep the dated settle
     (seed_static.settled_close). Grain only; livestock has no overnight. */
  /* THE DAY CHANGE, ONE RULE (Nov 2026; twin of scripts/price_pair.py problem()).
     A printed change is the shown price against the settle of the session
     before it: in session the trade, after the bell the day's last trade, once
     the settle posts the settle, each against the previous session's settle.
     The price run withholds any other pair (change_withheld, nulls); this
     checks the file in hand as well, so an older file cannot print one: no
     change when a trading session (isTradingDay) or a settle on file falls
     between the two dates, when the change is not the price less the previous
     settle, or when that settle disagrees with the one on file for its day.
     Returns { net, pct, vs, kind } or null; vs is the ISO day of the settle
     the change is from ('' when the file does not say). */
  /* the markets that settle (price_pair.SETTLE_ROOTS); with no key, a futures ticker or a close_kind says so */
  var SETTLE_ROOTS = { corn: 1, beans: 1, wheat: 1, kcwheat: 1, mplswheat: 1, oats: 1, meal: 1, soyoil: 1, rice: 1, cattle: 1, feeders: 1,
    hogs: 1, milk: 1, cotton: 1, crude: 1, natgas: 1, gold: 1, silver: 1 };
  function judged(q, key) {
    if (key) return !!SETTLE_ROOTS[String(key).split('-')[0]];
    return !!(q.close_kind || /=F$|\.(CBT|CME|NYM|CMX|NYB)$/.test(String(q.ticker || '')));
  }
  var ISO = /^\d{4}-\d\d-\d\d$/;
  function pairBad(q, key) {
    var cd = q.close_date || '', pd = q.prev_date || '', o = q.open;
    if (num(o) && Math.abs(q.netChange - (q.close - o)) > 0.005) return true;
    if (!judged(q, key) || !ISO.test(cd) || !ISO.test(pd)) return false;
    /* pd must be THE session before cd: a trading day, earlier, with no trading day or settle on file between */
    if (pd >= cd || !isTradingDay(pd)) return true;
    var seen = Object.keys(q.settles || {}).concat(Object.keys(q.day_last || {}));
    for (var i = 0; i < seen.length; i++) if (seen[i] > pd && seen[i] < cd) return true;
    for (var t = tOf(pd) + DAY, n = 0; t < tOf(cd) && n < 40; t += DAY, n++) if (isTradingDay(isoOf(t))) return true;
    if (!num(o)) return true;                  /* a change with no previous settle beside it */
    var s = q.settles && q.settles[pd];
    return num(s) && !q.repaired_from && Math.abs(s - o) > 0.005;
  }
  function change(q, key) {
    if (!q || q.change_withheld || !num(q.close) || !num(q.netChange) || pairBad(q, key)) return null;
    return { net: q.netChange, pct: num(q.pctChange) ? q.pctChange : null, vs: q.prev_date || '', kind: q.prev_kind || '' };
  }
  /* a copy of q with no change when change() rejects its pair (roll() applies it to every quote) */
  function pairGuard(q, key) {
    if (!q || typeof q !== 'object' || q.change_withheld || !num(q.netChange) || !num(q.close) || !pairBad(q, key)) return q;
    var c = {}, f;
    for (f in q) c[f] = q[f];
    c.netChange = c.pctChange = c.open = c.prev_date = null;
    c.change_withheld = 'the change and the price are not one session pair';
    return c;
  }
  var OVN_ROOTS = { ZC: 1, ZS: 1, ZW: 1, KE: 1, MW: 1, ZO: 1, ZM: 1, ZL: 1, ZR: 1 };
  function inOvernight(t) { var p = ct(t); if (!p) return false; var m = p.hh * 60 + p.mm; return m >= 19 * 60 || m < 7 * 60 + 45; }
  function num(x) { return typeof x === 'number' && isFinite(x); }
  function overnight(q) {
    if (!q || !OVN_ROOTS[String(q.ticker || '').slice(0, 2)]) return null;
    if (q.settled && num(q.last) && q.last_time && num(q.close)) {
      /* the evening trade's change is from the day's settle; before it posts there is none */
      return { px: q.last, net: num(q.last_net) && q.close_kind === 'settle' ? q.last_net : null, at: q.last_time, hero: false,
        ref: { px: q.close, date: q.close_date || '', kind: q.close_kind === 'settle' ? 'settle' : 'last' } };
    }
    if (q.close_kind === 'last' && q.close_time && num(q.close) && inOvernight(q.close_time) &&
        num(q.settle) && q.settle_date && q.close_date && q.settle_date < q.close_date && !q.roll) {
      var c = change(q), net = c && c.vs === q.settle_date ? c.net : null;
      return { px: q.close, net: net, at: q.close_time, hero: true, ref: { px: q.settle, date: q.settle_date, kind: 'settle' } };
    }
    return null;
  }
  /* One line for under a price. fmt(px) and move(net) are the page's own
     formatters (plain text; this escapes them). With the overnight trade as
     the main price (o.hero) the line names the settle beside it; otherwise
     it gives the overnight trade under the day session's price.
       "Overnight electronic trade $4.65½ (-1¼¢) at 7:45 pm CT. Oct 19 settle not posted yet."
       "Overnight electronic trade at 11:45 pm CT. Oct 19 settle $4.67." */
  function overnightHtml(q, fmt, move, now, opts) {
    var o = overnight(q);
    if (!o || typeof fmt !== 'function') return '';
    var at = clock(o.at, now), day = isoDay(o.ref.date, now).replace(' ', '\u00a0');
    var mv = o.net === 0 ? 'unch' : o.net != null && typeof move === 'function' ? move(o.net) : '';
    var trade = '<b>' + esc(fmt(o.px)) + '</b>' + (mv ? ' (' + esc(mv) + ')' : '');
    var ref = o.ref.kind === 'settle' ? (day ? day + ' settle ' : 'Settle ') + '<b>' + esc(fmt(o.ref.px)) + '</b>' :
      (day ? day + ' settle' : 'The settle') + ' not posted yet';
    var cls = 'px-ovn' + (opts && opts.short ? ' px-ovn-s' : ''), dh = ' data-ovn="' + (o.hero ? 'hero' : 'line') + '"';
    /* short, for a small card:
       "Overnight $4.65½ (-1¼¢), 7:45 pm CT" | "Overnight at 11:45 pm CT · Oct 19 settle $4.67" */
    if (opts && opts.short) return '<span class="' + cls + '"' + dh + '><span class="px-ovn-k">Overnight</span> ' +
      (o.hero ? 'at ' + esc(at) + ' &middot; ' + ref : trade + ', ' + esc(at)) + '</span>';
    return '<span class="' + cls + '"' + dh + '><span class="px-ovn-k">Overnight electronic trade</span> ' +
      (o.hero ? 'at ' + esc(at) + '. ' : trade + ' at ' + esc(at) + '. ') + ref + '.</span>';
  }

  /* The one delay statement (Nov 10, 2026): Yahoo lists CBOT and
     CME futures about 10 minutes behind and the site reads them about every
     15 minutes, so a grain or livestock quote is 10 to 25 minutes old in
     session (editorial-standards, terms). Energy, metals and the dollar can
     lag longer: those say "delayed" with no minutes. */
  var DELAY = 'quotes delayed 10 to 25 min';
  var DELAY_ROOTS = /^(ZC|ZS|ZW|KE|MW|ZO|ZM|ZL|ZR|LE|GF|HE)/;
  function delayWords(q) { return DELAY_ROOTS.test(String((q && q.ticker) || '')) ? DELAY : 'delayed quote'; }
  /* When a trade price is from (stampParts): the time the site READ it, never
     "last trade as of" that time (2026-11-10: close_time is the fetch in
     session, fetch_prices.py). After the bell close_time is the bell itself,
     earlier than the read: that is the day session's last trade.
       {kind:'settle', at:'Oct 16'} | {kind:'read', at:'1:05 pm CT'} |
       {kind:'overnight', at:'11:45 pm CT'} | {kind:'bell', at:'1:20 pm CT', vs:'Nov 10'} |
       {kind:'updated', at:'1:46 am CT'} | null */
  function stampParts(q, fetched, now) {
    var k = q && q.close_kind;
    if (k === 'settle') { var d = isoDay(q.settle_date || q.close_date, now); if (d) return { kind: 'settle', at: d }; }
    if (k === 'last') {
      var ov = overnight(q), rd = fetched || q.close_time, ctm = q.close_time ? Date.parse(q.close_time) : NaN, ftm = fetched ? Date.parse(fetched) : NaN;
      if (ov && ov.hero) { var o = clock(rd, now); if (o) return { kind: 'overnight', at: o }; }
      else if (isFinite(ctm) && isFinite(ftm) && ctm < ftm - 60000) {
        /* after the bell: the day's last trade; vs names the settle its change is from */
        var b = clock(q.close_time, now), cv = change(q);
        if (b) return { kind: 'bell', at: b, vs: cv ? isoDay(cv.vs, now) : '' };
      }
      else { var r = clock(rd, now); if (r) return { kind: 'read', at: r }; }
    }
    var u = fetched ? clock(fetched, now) : '';
    return u ? { kind: 'updated', at: u } : null;
  }
  /* The stamp for one quote: "Oct 16 settle" | "Read 1:05 pm CT; quotes delayed 10 to 25 min" |
     "Overnight trade read 11:45 pm CT; quotes delayed 10 to 25 min" (overnight() hero) |
     "Last trade at the 1:20 pm CT bell, change from the Nov 10 settle; settle not posted yet" |
     "Updated 1:46 am CT" */
  /* withChange: the stamp sits beside a printed change (html()), so after the bell it names the settle that change is from */
  function stamp(q, fetched, now, withChange) {
    var s = stampParts(q, fetched, now);
    if (!s) return '';
    if (!withChange) s.vs = '';
    if (s.kind === 'settle') return s.at + ' settle';
    if (s.kind === 'read') return 'Read ' + s.at + '; ' + delayWords(q);
    if (s.kind === 'overnight') return 'Overnight trade read ' + s.at + '; ' + delayWords(q);
    if (s.kind === 'bell') return (DELAY_ROOTS.test(String(q.ticker || '')) ? 'Last trade at the ' + s.at + ' bell' : 'Last trade ' + s.at) +
      (s.vs ? ', change from the ' + s.vs + ' settle' : '') + (DELAY_ROOTS.test(String(q.ticker || '')) ? '; settle not posted yet' : '; delayed quote');
    return 'Updated ' + s.at;
  }
  /* A whole board: "Oct 16 settle where posted, latest delayed trade otherwise. Read 1:46 am CT" */
  /* 2026-10-20: cards on different settle dates show the range ("Oct 16 to
     Oct 19 settles"), never the newest alone (a card one session behind read
     as current). Twin: seed_static.py mk_board. */
  function board(quotes, keys, fetched, now) {
    var st = '', lo = '', last = 0, n = 0;
    (keys || Object.keys(quotes || {})).forEach(function (k) {
      var q = quotes && quotes[k];
      if (!q || q.close == null) return;
      n++;
      if (q.close_kind === 'settle') { var d = q.settle_date || q.close_date || ''; if (d > st) st = d; if (d && (!lo || d < lo)) lo = d; } else last++;
    });
    var read = fetched ? clock(fetched, now) : '', out;
    if (!n) return read ? 'Read ' + read : '';
    var sw = st ? (lo && lo !== st ? isoDay(lo, now) + ' to ' + isoDay(st, now) + ' settles' : isoDay(st, now) + ' settle') : '';
    if (st && !last) out = sw;
    else if (st) out = sw + ' where posted, latest delayed trade otherwise';
    else out = 'Latest delayed trades';
    return out + (read ? '. Read ' + read : '');
  }
  /* The same moment in the few words a small box holds (a card, the hero, a status line): the
     old "Last trade as of 1:46 pm CT" length, so the line does not wrap where it did not before.
     The full sentence, with the delay in minutes, is the title. */
  function shortStamp(q, fetched, now) {
    var s = stampParts(q, fetched, now);
    if (!s) return '';
    if (s.kind === 'settle') return s.at + ' settle';
    if (s.kind === 'read') return 'Read ' + s.at + ', delayed';
    if (s.kind === 'overnight') return 'Overnight, read ' + s.at;
    /* the settle the change is from is in the title (stamp withChange): a longer line wrapped and moved the page at 390 px */
    if (s.kind === 'bell') return 'Last trade, ' + s.at + ' bell';
    return 'Updated ' + s.at;
  }
  /* Markup: a <time> (no data-asof, so asof.js leaves the words alone), the short words, the full stamp as its title. */
  function html(q, fetched, now) {
    var s = shortStamp(q, fetched, now), full = stamp(q, fetched, now, true);
    if (!s) return '';
    var sp = stampParts(q, fetched, now), t = sp && sp.kind === 'bell' ? q.close_time : (fetched || (q && q.close_time) || '');
    var dt = (q && q.close_kind === 'settle' && (q.settle_date || q.close_date)) || t;
    /* a settle the file should have moved past says how old it is; past
       OLD_SESSIONS it is greyed like any stale stamp (asof.css is-stale) */
    var a = q && q.close_kind === 'settle' ? settleAge(q.settle_date || q.close_date, now) : null;
    return '<time class="px-stamp' + (a && a.old ? ' is-stale' : '') + '" datetime="' + esc(dt) + '"' + (a && a.old ? ' data-stale=""' : '') +
      ' title="' + esc(full) + (fetched && q && q.close_kind === 'settle' ? '. Price file read ' + esc(clock(fetched, now)) : '') + '">' + esc(s) + (a && a.stale ? '<span class="asof-note"> &middot; ' + esc(a.note) + '</span>' : '') + '</time>';
  }
  /* The age of a whole board: its OLDEST settle (2026-10-19, P4). The newest
     one let a board with one card days behind look current. Adds oldest and
     newest (ISO days) so the caller can say which. */
  function boardAge(quotes, keys, now) {
    var lo = '', hi = '';
    (keys || Object.keys(quotes || {})).forEach(function (k) {
      var q = quotes && quotes[k];
      if (q && q.close != null && q.close_kind === 'settle') {
        var d = q.settle_date || q.close_date || '';
        if (!d) return;
        if (!lo || d < lo) lo = d;
        if (d > hi) hi = d;
      }
    });
    var a = lo ? settleAge(lo, now) : null;
    if (a) { a.oldest = lo; a.newest = hi; a.oldestLabel = isoDay(lo, now); }
    return a;
  }

  /* ---- the state line ---- */
  function readState(ls) {
    var o = null, z = '';
    try { o = JSON.parse(ls.getItem('agsist-wx-loc') || 'null'); } catch (e) { o = null; }
    if (o && typeof o === 'object') {
      if (NAMES[o.state]) return o.state;
      if (/^\d{5}$/.test(o.zip || '')) return zipState(o.zip);
    }
    try { z = String(ls.getItem('agsist_zip') || ''); } catch (e) { z = ''; }
    return zipState(z);
  }
  function qc(c) { var q = Math.round(Math.abs(c) * 4) / 4, w = Math.floor(q), f = Math.round((q - w) * 100); return (w || !f ? String(w) : '') + FR[f]; }
  function basisWords(med) { var c = Math.round(med * 1e4) / 100; return Math.abs(c) < 0.125 ? 'even with' : qc(c) + '¢ ' + (c < 0 ? 'under' : 'over'); }
  var FUT = { ZC: '', ZS: '', ZW: 'Chicago ', KE: 'KC ', MW: 'Minneapolis ', MWO: 'Minneapolis ' };
  var CROPS = { corn: [['corn', 'corn']], soybeans: [['soybeans', 'soybeans']], wheat: [['wheat_srw', 'SRW wheat'], ['wheat_hrw', 'HRW wheat'], ['wheat_hrs', 'spring wheat']] };
  function quoteFor(prices, contract) {
    var q = prices && prices.quotes, t = contract + '.CBT';
    if (!q) return null;
    for (var k in q) if (q[k] && q[k].ticker === t && typeof q[k].close === 'number') return q[k];
    return null;
  }
  /* One state's middle bid for one crop, or null: {crop, label, name, fut, contract, median, basis (words),
     n, cash (a number, or null when the futures quote is missing or older than 5 days), on (whose close),
     asOf ("Oct 17")}. Wheat takes the class most of the state's elevators bid. Pure; lines() and the
     no-ZIP sample on /cash-bids (components/cb-sample.js) both read it, so the two never disagree. */
  function cell(bs, prices, st, crop, now) {
    now = now || Date.now();
    var s = bs && bs.states && bs.states[st];
    if (!s || !bs.generated || (now - Date.parse(bs.generated)) / DAY > 10) return null;
    var ok = (CROPS[crop] || []).filter(function (c) {
      var r = s.crops && s.crops[c[0]];
      return r && typeof r.median === 'number' && isFinite(r.median) && r.contract && r.n >= (bs.min_n || 3);
    }).sort(function (a, b) { return s.crops[b[0]].n - s.crops[a[0]].n; })[0];
    if (!ok) return null;
    var r = s.crops[ok[0]], asOf = ct(bs.generated);
    var root3 = /^(MWO|MW|ZC|ZS|ZW|KE)/.exec(r.contract), fut = root3 ? FUT[root3[1]] : '';
    var q = quoteFor(prices, r.contract), cash = null, on = '';
    if (q && q.close_date && (now - Date.parse(q.close_date + 'T18:00:00Z')) / DAY <= 5) {
      var v = Math.round(Math.round((q.close + r.median * 100) * 1e6) / 1e6) / 100;
      if (v > 0) { cash = v; on = q.close_kind === 'settle' ? 'the ' + isoDay(q.settle_date || q.close_date, now) + ' settle' : 'the latest delayed trade'; }
    }
    return { crop: ok[1], name: s.name, fut: fut, label: r.label || r.contract, contract: r.contract, median: r.median,
      basis: basisWords(r.median), n: r.n, companies: r.companies, cash: cash, on: on, asOf: asOf ? MON[asOf.m - 1] + ' ' + asOf.d : '' };
  }
  /* -> [{html}] for one state and the crops asked; pure, the tests call it */
  function lines(bs, prices, st, crops, now) {
    var out = [];
    (crops || []).forEach(function (crop) {
      var c = cell(bs, prices, st, crop, now);
      if (!c) return;
      var cash = c.cash != null ? ', about <b>$' + c.cash.toFixed(2) + '</b> cash on ' + c.on : '';
      out.push('<b>' + esc(c.name) + ' ' + c.crop + ':</b> basis <b>' + c.basis + '</b> ' + esc(c.fut + c.label) + ' futures' + cash +
        '. <span class="pl-s">The ' + medOf(c.n, c.companies) + ', ' + c.asOf + '.</span>');
    });
    return out;
  }
  function build(bs, prices, st, crops, now) {
    var l = lines(bs, prices, st, crops, now);
    if (!l.length) return '';
    return l.join('<br>') + ' <a href="/cash-bids">Bids near you &rarr;</a>';
  }
  /* The line's shape before its numbers: the same words with typical-width
     figures, for a reader with a saved state, so the page holds the space
     the line will take (2026-10-19 phone audit: the homepage moved down
     70 to 170px when it arrived). The page shows it hidden (.pl-wait). The longest
     common shape: "the latest delayed trade" and the company count (Nov 10 2026). */
  function placeholder(st, crops) {
    var l = [];
    (crops || []).forEach(function (crop) {
      var c = (CROPS[crop] || [])[0];
      if (c && NAMES[st]) l.push('<b>' + esc(NAMES[st]) + ' ' + c[1] + ':</b> basis <b>00¢ under</b> ' + (crop === 'soybeans' ? 'Nov' : 'Dec') + " '00 futures, about <b>$0.00</b> cash on the latest delayed trade. <span class=\"pl-s\">The median of 000 elevators, 00 companies, Oct 00.</span>");
    });
    return l.length ? l.join('<br>') + ' <a href="/cash-bids" tabindex="-1">Bids near you &rarr;</a>' : '';
  }
  /* a local bid from the futures basis card -> one line */
  function nearLine(b) {
    if (!b || !(b.price > 0) || !b.place) return '';
    return '<b>Nearest ' + esc(b.crop || '') + ' bid:</b> <b>$' + b.price.toFixed(2) + '</b> at ' + esc(b.place) + (b.basis != null && isFinite(b.basis) ? ', basis ' + basisWords(b.basis) + (b.contract ? ' ' + esc(b.contract) : '') : '') +
      (b.when ? '. <span class="pl-s">' + esc(b.when) + '.</span>' : '.') + ' <a href="/cash-bids">All bids near you &rarr;</a>';
  }

  /* THE HEADLINE CONTRACT (2026-11-04, the owner's screenshot): ONE choice for every
     headline corn and soybean futures price. It is <crop>-nearby, the month
     scripts/fetch_prices.py add_nearby picks: the nearest live month, rolled at
     CBOT first notice day (Nov '26 soybeans to Jan '27 from Oct 30; Dec '26
     corn to Mar '27 from Nov 30). Every elevator quotes basis against that
     month, so a headline on any other month puts cash off by the spread. The
     home page printed "Nov '26 bean futures $11.94" over a basis line against
     Jan '27. Twin: scripts/seed_static.py nearby_of. data: the price file or
     its quotes. -> {key, q, label} or null. With no alias on file: the
     nearest dated month, then the continuous series (no label for ZS=F). */
  function quotesOf(data) { return data && data.quotes ? data.quotes : (data || {}); }
  function headline(data, crop) {
    var q = quotesOf(data), n = q[crop + '-nearby'], nb = data && data.nearby && data.nearby[crop], k, bk = null, bi = Infinity;
    if (n && n.close != null) return { key: crop + '-nearby', q: n, label: label(n.ticker) || n.contract || (nb && nb.label) || null };
    var re = new RegExp('^' + crop + '-([a-z]{3})(\\d{2})$');
    for (k in q) {
      var mm = re.exec(k), mi = mm ? M3.indexOf(mm[1]) : -1;
      if (mi < 0 || !q[k] || q[k].close == null) continue;
      if ((+mm[2]) * 12 + mi < bi) { bi = (+mm[2]) * 12 + mi; bk = k; }
    }
    if (bk) return { key: bk, q: q[bk], label: label(q[bk].ticker) || null };
    var c = q[crop];
    return c && c.close != null ? { key: crop, q: c, label: label(c.ticker) || null } : null;
  }
  /* THE NEXT HARVEST CONTRACT: the Dec corn or Nov soybeans after the headline
     month. Dec '26 corn while Dec '26 is the headline is Dec '27; Nov soybeans
     with Jan '27 the headline is Nov '27 (Oct 1: never two cards of one
 contract; Nov 4: never a month past first notice). A card or ticker slot
     for "new crop" reads this and names the month. Twin: seed_static.py
     new_crop_quote (and futures.js newCropKey). -> {key, q, label} or null. */
  var HARVEST = { corn: 'dec', beans: 'nov' };
  function harvest(data, crop) {
    var q = quotesOf(data), mon = HARVEST[crop], h = headline(data, crop);
    if (!mon) return null;
    var x = h && /^[A-Z]{2}([FGHJKMNQUVXZ])(\d{2})\b/.exec(String(h.q.ticker || '')), key;
    if (x) {
      var hm = M3.indexOf(mon) + 1, ny = 2000 + (+x[2]), nm = FCODE.indexOf(x[1]) + 1;
      key = crop + '-' + mon + String(nm >= hm ? ny + 1 : ny).slice(-2);
    }
    var d = key && q[key];
    if (!(d && d.close != null)) {
      /* that month is not on file: the alias (corn-dec), only when it is a
         later month than the headline; never the headline's own month again */
      key = crop + '-' + mon; d = q[key];
      var a = d && /^[A-Z]{2}([FGHJKMNQUVXZ])(\d{2})\b/.exec(String(d.ticker || ''));
      if (x && (!a || (+a[2]) * 12 + FCODE.indexOf(a[1]) <= (+x[2]) * 12 + FCODE.indexOf(x[1]))) return null;
    }
    if (!(d && d.close != null)) return null;
    return { key: key, q: d, label: label(d.ticker) || null };
  }

  var api = { headline: headline, harvest: harvest, stamp: stamp, stampParts: stampParts, change: change, pairGuard: pairGuard, shortStamp: shortStamp, DELAY: DELAY, overnight: overnight, overnightHtml: overnightHtml, board: board, boardAge: boardAge, settleAge: settleAge, OLD_SESSIONS: OLD_SESSIONS, isTradingDay: isTradingDay, holidayName: holidayName,
    deadFrom: deadFrom, expired: expired, roll: roll, html: html, clock: clock, readState: readState, zipState: zipState, label: label, cell: cell, lines: lines, build: build, nearLine: nearLine, placeholder: placeholder, NAMES: NAMES };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgPxStamp = api;
  var doc = root.document;
  if (!doc) return;
  /* <p class="pl-line" data-state-bid ...> then <script>AgPxStamp.reserve(that p)</script>:
     with a saved state, the line holds its space from the first paint (hidden, aria-hidden). */
  api.reserve = function (el) {
    var st = '', h;
    try { st = readState(root.localStorage); } catch (e) { st = ''; }
    if (!el || !st || !(h = placeholder(st, String(el.getAttribute('data-state-bid') || '').split(/\s+/)))) return;
    el.innerHTML = h; el.className += ' pl-wait'; el.setAttribute('aria-hidden', 'true'); el.hidden = false;
  };
  function settle(el, h) {
    /* the line keeps at least the box it held, so a shorter line (a settle instead of "the latest
       delayed trade") never pulls the page up (CLS sweep, Nov 10 2026) */
    if (el.classList.contains('pl-wait') && h) { var hh = el.getBoundingClientRect().height; if (hh > 0) el.style.minHeight = hh + 'px'; }
    el.classList.remove('pl-wait'); el.removeAttribute('aria-hidden');
    if (h) { el.innerHTML = h; el.hidden = false; } else { el.hidden = true; el.innerHTML = ''; }
  }

  function get(u) { return fetch(u, { cache: 'default' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function prices() {
    if (root.__agsistPricesP) return root.__agsistPricesP;
    if (root.AG && typeof root.AG.json === 'function') return root.AG.json('/data/prices.json').catch(function () { return null; });
    return get('/data/prices.json');
  }
  function boot() {
    var els = doc.querySelectorAll('[data-state-bid]');
    if (!els.length) return;
    var st = '';
    try { st = readState(root.localStorage); } catch (e) { st = ''; }
    if (!st) {
      Array.prototype.forEach.call(els, function (el) {
        if (el.hasAttribute('data-zip-link')) { el.innerHTML = '<a href="/cash-bids">Set your ZIP</a> for your state&rsquo;s middle bid.'; el.hidden = false; }
      });
      return;
    }
    var near = {};
    root.addEventListener('agsist:nearbid', function (e) {
      var b = e && e.detail, h = nearLine(b);
      if (!h) return;
      Array.prototype.forEach.call(els, function (el) {
        if (String(el.getAttribute('data-state-bid')).split(/\s+/).indexOf(b.key) < 0) return;
        near[b.key] = 1; settle(el, h); el.setAttribute('data-src', 'nearest');
      });
    });
    Promise.all([get('/data/basis-states.json'), prices()]).then(function (r) {
      Array.prototype.forEach.call(els, function (el) {
        if (el.getAttribute('data-src') === 'nearest') return;
        var crops = String(el.getAttribute('data-state-bid') || '').split(/\s+/).filter(Boolean);
        var h = build(r[0], r[1], st, crops);
        if (h) { settle(el, h); el.setAttribute('data-src', 'state'); }
        else if (el.classList.contains('pl-wait')) settle(el, '');
      });
    });
  }
  /* ---- folds (details.fold): hide an empty one, open one a link points into, say when one opens ---- */
  function folds() {
    Array.prototype.forEach.call(doc.querySelectorAll('details.fold'), function (f) {
      var body = f.querySelector('.fold-body');
      if (!body) return;
      function check() {
        var vis = Array.prototype.some.call(body.children, function (c) { return c.tagName !== 'SCRIPT' && c.tagName !== 'STYLE' && getComputedStyle(c).display !== 'none' && !c.hidden; });
        f.hidden = !vis;
      }
      check();
      if ('MutationObserver' in root) new MutationObserver(check).observe(body, { attributes: true, subtree: false, childList: true, attributeFilter: ['style', 'hidden', 'class'] });
      Array.prototype.forEach.call(body.children, function (c) { if ('MutationObserver' in root) new MutationObserver(check).observe(c, { attributes: true, attributeFilter: ['style', 'hidden'] }); });
      f.addEventListener('toggle', function () {
        if (!f.open) return;
        try { root.dispatchEvent(new CustomEvent('agsist:fold-open', { detail: f.id })); root.dispatchEvent(new Event('resize')); } catch (e) { }
        try { if (root.gaEvent) root.gaEvent('fold_open', { id: f.id }); } catch (e) { }
      });
    });
    function toHash() {
      var id = (root.location.hash || '').slice(1), el = null;
      try { el = id && doc.getElementById(decodeURIComponent(id)); } catch (e) { el = null; }
      var f = el && el.closest && el.closest('details.fold');
      if (f && !f.open) { f.open = true; setTimeout(function () { el.scrollIntoView(); }, 0); }
    }
    root.addEventListener('hashchange', toHash);
    toHash();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', folds); else folds();

  var css = doc.createElement('style');
  css.textContent = '.pl-line.pl-wait{visibility:hidden}.pl-line{margin:.45rem 0 .2rem;padding:.45rem .7rem;border-left:3px solid var(--green,#3a7d44);background:var(--surface,transparent);border-radius:6px;font-size:.86rem;line-height:1.5;color:var(--text-dim)}.pl-line b{color:var(--text)}.pl-line .pl-s{color:var(--text-muted);font-size:.8rem}.pl-line a{color:var(--gold);white-space:nowrap}' +
    '.ph-ovn{margin:4px 0 0 auto;max-width:26rem}.pc-ovn{margin-top:3px}.pc-ovn[hidden],.ph-ovn[hidden]{display:none}.ph-price .ph-ovn{order:4;flex-basis:100%}.px-ovn{display:block;font-size:.85em;line-height:1.4;color:var(--text-muted,#666)}.px-ovn-k{font-weight:600;color:var(--text,inherit)}.px-ovn b{color:var(--text,inherit)}.px-stamp.is-stale{color:var(--text-muted)}.px-stamp .asof-note{font-weight:600;white-space:nowrap}.px-old{filter:grayscale(1);opacity:.75}';
  (doc.head || doc.documentElement).appendChild(css);
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : this);
