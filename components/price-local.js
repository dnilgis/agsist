/* components/price-local.js: two small things for the pages that lead with a
   futures price (corn, soybean, wheat and cattle futures, /markets, home).

   1. AgPxStamp: what the price stamp says. A quote the price file marks a
      settle (close_kind "settle") reads "Oct 16 settle"; a last trade reads
      "Last trade as of 1:46 pm CT" (close_time, else the time the file was
      read). A quote with no close_kind says "Updated <time> CT". Always
      Central time, always named.

   2. The state line under the price. Only for a reader whose state the site
      already saved (agsist-wx-loc from geo.js, else a saved ZIP's state). It
      never guesses a state and sends nothing. With a state it loads
      data/basis-states.json (and only then) and prints one line:
        Illinois corn: median basis 31¢ under Dec '26 futures, about $4.43 cash
        on the Oct 16 settle. 186 elevators, Oct 17. Bids near you ->
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
    for (k in quotes) out[k] = quotes[k];
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

  /* The stamp for one quote: "Oct 16 settle" | "Last trade as of 1:46 pm CT" | "Updated 1:46 am CT" */
  function stamp(q, fetched, now) {
    var k = q && q.close_kind;
    if (k === 'settle') { var d = isoDay(q.settle_date || q.close_date, now); if (d) return d + ' settle'; }
    if (k === 'last') { var t = clock(q.close_time || fetched, now); if (t) return 'Last trade as of ' + t; }
    var u = fetched ? clock(fetched, now) : '';
    return u ? 'Updated ' + u : '';
  }
  /* A whole board: "Oct 16 settle where posted, latest delayed trade otherwise. Read 1:46 am CT" */
  function board(quotes, keys, fetched, now) {
    var st = '', last = 0, n = 0;
    (keys || Object.keys(quotes || {})).forEach(function (k) {
      var q = quotes && quotes[k];
      if (!q || q.close == null) return;
      n++;
      if (q.close_kind === 'settle') { var d = q.settle_date || q.close_date || ''; if (d > st) st = d; } else last++;
    });
    var read = fetched ? clock(fetched, now) : '', out;
    if (!n) return read ? 'Read ' + read : '';
    if (st && !last) out = isoDay(st, now) + ' settle';
    else if (st) out = isoDay(st, now) + ' settle where posted, latest delayed trade otherwise';
    else out = 'Latest delayed trades';
    return out + (read ? '. Read ' + read : '');
  }
  /* Markup: a <time> (no data-asof, so asof.js leaves the words alone) with the full time as its title. */
  function html(q, fetched, now) {
    var s = stamp(q, fetched, now);
    if (!s) return '';
    var t = (q && q.close_kind === 'last' && q.close_time) || fetched || '';
    var dt = (q && q.close_kind === 'settle' && (q.settle_date || q.close_date)) || t;
    /* a settle the file should have moved past says how old it is; past
       OLD_SESSIONS it is greyed like any stale stamp (asof.css is-stale) */
    var a = q && q.close_kind === 'settle' ? settleAge(q.settle_date || q.close_date, now) : null;
    return '<time class="px-stamp' + (a && a.old ? ' is-stale' : '') + '" datetime="' + esc(dt) + '"' + (a && a.old ? ' data-stale=""' : '') +
      (fetched ? ' title="Price file read ' + esc(clock(fetched, now)) + '"' : '') + '>' + esc(s) + (a && a.stale ? '<span class="asof-note"> &middot; ' + esc(a.note) + '</span>' : '') + '</time>';
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
      basis: basisWords(r.median), n: r.n, cash: cash, on: on, asOf: asOf ? MON[asOf.m - 1] + ' ' + asOf.d : '' };
  }
  /* -> [{html}] for one state and the crops asked; pure, the tests call it */
  function lines(bs, prices, st, crops, now) {
    var out = [];
    (crops || []).forEach(function (crop) {
      var c = cell(bs, prices, st, crop, now);
      if (!c) return;
      var cash = c.cash != null ? ', about <b>$' + c.cash.toFixed(2) + '</b> cash on ' + c.on : '';
      out.push('<b>' + esc(c.name) + ' ' + c.crop + ':</b> median basis <b>' + c.basis + '</b> ' + esc(c.fut + c.label) + ' futures' + cash +
        '. <span class="pl-s">' + c.n + ' elevators, ' + c.asOf + '.</span>');
    });
    return out;
  }
  function build(bs, prices, st, crops, now) {
    var l = lines(bs, prices, st, crops, now);
    if (!l.length) return '';
    return l.join('<br>') + ' <a href="/cash-bids">Bids near you &rarr;</a>';
  }
  /* a local bid from the futures basis card -> one line */
  function nearLine(b) {
    if (!b || !(b.price > 0) || !b.place) return '';
    return '<b>Nearest ' + esc(b.crop || '') + ' bid:</b> <b>$' + b.price.toFixed(2) + '</b> at ' + esc(b.place) + (b.basis != null && isFinite(b.basis) ? ', basis ' + basisWords(b.basis) + (b.contract ? ' ' + esc(b.contract) : '') : '') +
      (b.when ? '. <span class="pl-s">' + esc(b.when) + '.</span>' : '.') + ' <a href="/cash-bids">All bids near you &rarr;</a>';
  }

  var api = { stamp: stamp, board: board, boardAge: boardAge, settleAge: settleAge, OLD_SESSIONS: OLD_SESSIONS, isTradingDay: isTradingDay, holidayName: holidayName,
    deadFrom: deadFrom, expired: expired, roll: roll, html: html, clock: clock, readState: readState, zipState: zipState, label: label, cell: cell, lines: lines, build: build, nearLine: nearLine, NAMES: NAMES };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgPxStamp = api;
  var doc = root.document;
  if (!doc) return;

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
        near[b.key] = 1; el.innerHTML = h; el.hidden = false; el.setAttribute('data-src', 'nearest');
      });
    });
    Promise.all([get('/data/basis-states.json'), prices()]).then(function (r) {
      Array.prototype.forEach.call(els, function (el) {
        if (el.getAttribute('data-src') === 'nearest') return;
        var crops = String(el.getAttribute('data-state-bid') || '').split(/\s+/).filter(Boolean);
        var h = build(r[0], r[1], st, crops);
        if (h) { el.innerHTML = h; el.hidden = false; el.setAttribute('data-src', 'state'); }
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
  css.textContent = '.pl-line{margin:.45rem 0 .2rem;padding:.45rem .7rem;border-left:3px solid var(--green,#3a7d44);background:var(--surface,transparent);border-radius:6px;font-size:.86rem;line-height:1.5;color:var(--text-dim)}.pl-line b{color:var(--text)}.pl-line .pl-s{color:var(--text-muted);font-size:.8rem}.pl-line a{color:var(--gold);white-space:nowrap}' +
    '.px-stamp.is-stale{color:var(--text-muted)}.px-stamp .asof-note{font-weight:600;white-space:nowrap}.px-old{filter:grayscale(1);opacity:.75}';
  (doc.head || doc.documentElement).appendChild(css);
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : this);
