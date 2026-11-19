/* components/bid-age.js: the lines on the home "Today near me" card, in words a farmer reads in one go.

   1. ageLine(posted, now): the time line over the two top bids, BEFORE the day session.
      CBOT grains trade overnight (7:00 pm to 7:45 am CT, Sunday to Friday), pause, and open the day session at
      8:30 am. Elevators post new bids after that open, so at 7:20 am a bid posted after yesterday's close is the
      newest there is, not an old one. Between the last session and the next open (before 8:30 am on a trading
      day, or all day on a weekend or exchange holiday) a bid posted after the last session's close reads
        "Posted after yesterday's close, 1:47 pm."          ("Friday's close" on a Monday morning)
      Anything else returns null and the page keeps the site's "Updated" stamp (components/asof.js), whose old
      bid note stays: in the day session, after the close, and for a bid older than the last session.

   2. ovnLine(data, syms, now): the overnight line under it: the overnight futures moves. In the overnight hours of a trading session (ovnLive: AgPxStamp.ovnWindow, the futures pages' one
      clock rule, and that session is a trading day by AgPxStamp.isTradingDay), the move of the futures contract
      each card's bid is priced on, from the futures pages' own overnight read (AgPxStamp.overnight: the change
      against the prior settle), with the time of the quote:
        "Dec corn down 3¢, Jan soybeans down 5¢ overnight (7:01 am)."
      A bid with no contract named reads the front month (AgPxStamp.headline), named by its month; a bid whose
      named contract has no overnight quote reads the front month, marked "(front month)". A quote older than
      45 minutes, or none, says "not available", never an old number as current. Weekends and holidays: null.
      Futures only: no cash estimate is printed. The elevator's futures level at posting is not on file for every
      board, and the page would be mixing two files of different vintages into a new number (honest-numbers 8, 9).

   3. whatLine(month, basis, ref): "Harvest · 74¢ under Jan '27", the town pages' words ("62 under December").
      No contract named: "66¢ under futures", never a guessed month. Short on purpose: a half-width cell on a
      390 px phone holds about 26 characters, and the card holds three lines from first paint.

   Pure; test/home-today-card.test.mjs runs it in node. */
(function (root) {
  'use strict';
  var TZ = 'America/Chicago', DAY = 864e5, OPEN = 8 * 60 + 30, CLOSE = 13 * 60 + 20, QUOTE_MAX_MIN = 45;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var FCODE = 'FGHJKMNQUVXZ';
  var CROP = { ZC: 'corn', ZS: 'soybeans' }, PXKEY = { ZC: 'corn', ZS: 'beans' };
  var FR = { 1: ' 1/4', 2: ' 1/2', 3: ' 3/4' };

  function px() { return root.AgPxStamp || (typeof require === 'function' ? require('./price-local.js') : null); }
  function ct(t) {
    var d = t instanceof Date ? t : new Date(t), o = {};
    if (isNaN(d)) return null;
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, m: +o.month, d: +o.day, min: ((+o.hour) % 24) * 60 + (+o.minute) };
  }
  function iso(p) { return p.y + '-' + (p.m < 10 ? '0' : '') + p.m + '-' + (p.d < 10 ? '0' : '') + p.d; }
  function tOf(s) { return Date.parse(s + 'T00:00:00Z'); }
  function isoOf(t) { return new Date(t).toISOString().slice(0, 10); }
  function hm(min) { var h = Math.floor(min / 60), m = min % 60; return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + ' ' + (h < 12 ? 'am' : 'pm'); }
  /* cents, unsigned, quarters like the pit: 3 -> "3¢", 1.25 -> "1 1/4¢", 0.5 -> "1/2¢" */
  function cents(c) {
    var q = Math.round(Math.abs(c) * 4), w = Math.floor(q / 4), f = q % 4;
    return (w || !f ? String(w) : '') + (f ? (w ? FR[f] : FR[f].slice(1)) : '') + '¢';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* The last session before `now` that has closed, while the next has not opened:
     {session: 'YYYY-MM-DD', today: 'YYYY-MM-DD'} or null (in the day session or after today's close). */
  function between(now) {
    var P = px(), q = ct(now);
    if (!P || !q) return null;
    var today = iso(q);
    if (P.isTradingDay(today) && q.min >= OPEN) return null;
    var t = tOf(today) - DAY, n = 0;
    while (!P.isTradingDay(isoOf(t)) && n++ < 10) t -= DAY;
    return { session: isoOf(t), today: today };
  }
  function dayWord(session, today) {
    return tOf(today) - tOf(session) === DAY ? 'yesterday' : WD[new Date(tOf(session)).getUTCDay()];
  }

  /* The overnight hours of a trading session: the futures pages' window (7 pm Sunday to Thursday, until 8:30 am
     Monday to Friday) when the session it opens is a trading day (no line the night before Thanksgiving).
     -> {session, prev} (ISO days: the session trading, the one whose settle the move is from) or null. */
  function ovnLive(now) {
    var P = px(), q = ct(now);
    if (!P || !q || !P.ovnWindow || !P.ovnWindow(now)) return null;
    var t = tOf(iso(q)) + (q.min >= 19 * 60 ? DAY : 0), n = 0, p;
    if (!P.isTradingDay(isoOf(t))) return null;
    p = t - DAY;
    while (!P.isTradingDay(isoOf(p)) && n++ < 10) p -= DAY;
    return { session: isoOf(t), prev: isoOf(p) };
  }
  function cname(sym, live) {
    var m = /^(Z[CS])([FGHJKMNQUVXZ])(\d{2})/.exec(String(sym || ''));
    if (!m) return '';
    var mi = FCODE.indexOf(m[2]), sy = +live.session.slice(2, 4), sm = +live.session.slice(5, 7) - 1;
    var ahead = (+m[3]) * 12 + mi - (sy * 12 + sm);
    return MON[mi] + (ahead >= 11 ? " '" + m[3] : '') + ' ' + CROP[m[1]];
  }
  /* one quote's overnight move: {name, net (cents or null), at (ms)} | 'stale' | null (no overnight read) */
  function ovnOf(q, live, nt) {
    var P = px(), o = q && !q.roll && !q.move_withheld ? P.overnight(q) : null;
    if (!o) return null;
    var at = Date.parse(o.at);
    if (!isFinite(at) || at > nt + 60e3 || nt - at > QUOTE_MAX_MIN * 6e4 || !P.ovnWindow(new Date(at))) return 'stale';
    /* the move is from the settle of the session before this one, never an older pair */
    if (o.ref.date !== live.prev) return 'stale';
    var net = o.ref.kind === 'settle' && typeof o.net === 'number' ? Math.round(o.net * 4) / 4 : null;
    return { net: net, at: at };
  }
  function findSym(quotes, sym) {
    for (var k in quotes) if (quotes[k] && quotes[k].ticker === sym + '.CBT') return quotes[k];
    return null;
  }
  /* data: prices.json; syms: {ZC: 'ZCZ26' | null, ZS: 'ZSF27' | null}, each card's bid contract.
     -> {text, html, items, parts} or null (outside the overnight hours of a trading session).
     parts: the same words for each crop alone, {ZC: "Dec corn down 3¢ overnight (7:01 am).", ZS: ...}, or
     "Overnight quote not available." for a crop with none: on a phone each bid's own cell carries its line. */
  function ovnLine(data, syms, now) {
    now = now || new Date();
    var P = px(), live = ovnLive(now), nt = (now instanceof Date ? now : new Date(now)).getTime();
    if (!live) return null;
    var quotes = data && data.quotes, rolled = quotes && P.roll ? P.roll(quotes) : quotes, items = [], missing = [], by = {};
    ['ZC', 'ZS'].forEach(function (root) {
      var sym = syms && syms[root] && new RegExp('^' + root + '[FGHJKMNQUVXZ]\\d{2}$').test(syms[root]) ? syms[root] : '';
      var it = null, own = sym && quotes ? findSym(quotes, sym) : null, r = own ? ovnOf(own, live, nt) : null;
      if (r && r !== 'stale') it = { name: cname(sym, live), net: r.net, at: r.at, front: false };
      else if (r !== 'stale' && rolled) {
        var hl = P.headline ? P.headline({ quotes: rolled, nearby: data.nearby }, PXKEY[root]) : null, fq = hl && hl.q;
        var ft = fq && /^(Z[CS][FGHJKMNQUVXZ]\d{2})\.CBT$/.exec(String(fq.ticker || ''));
        var fr = ft && ft[1] !== sym ? ovnOf(fq, live, nt) : null;
        if (fr && fr !== 'stale') it = { name: cname(ft[1], live), net: fr.net, at: fr.at, front: !!sym };
      }
      if (it) { items.push(it); by[root] = it; } else missing.push(CROP[root]);
    });
    var word = function (it) {
      return it.name + (it.front ? ' (front month)' : '') + (it.net == null ? ' trading' : it.net === 0 ? ' unchanged' : (it.net < 0 ? ' down\u00a0' : ' up\u00a0') + cents(it.net));
    };
    var tm = function (t) { return hm(ct(new Date(t)).min); }, text = '';
    if (items.length) {
      var same = items.every(function (it) { return tm(it.at) === tm(items[0].at); });
      text = same ? items.map(word).join(', ') + ' overnight (' + tm(items[0].at) + ')'
        : items.map(function (it, i) { return word(it) + (i ? '' : ' overnight') + ' (' + tm(it.at) + ')'; }).join(', ');
      if (items.some(function (it) { return it.net == null; })) text += ', settle not posted yet';
      text += '.';
      if (missing.length) text += ' ' + (missing[0] === 'corn' ? 'Corn' : 'Soybean') + ' overnight quote not available.';
    } else text = 'Overnight quote not available.';
    var parts = {};
    ['ZC', 'ZS'].forEach(function (root) {
      var it = by[root];
      parts[root] = it ? word(it) + ' overnight (' + tm(it.at) + ')' + (it.net == null ? ', settle not posted yet' : '') + '.' : 'Overnight quote not available.';
    });
    return { text: text, items: items, html: esc(text), parts: parts };
  }

  /* -> {text, html, session} or null (keep the site's Updated stamp) */
  function ageLine(posted, now) {
    now = now || new Date();
    var t = posted ? Date.parse(posted) : NaN, win = between(now);
    if (!isFinite(t) || !win) return null;
    var p = ct(new Date(t)), pd = iso(p);
    /* before the last close (it is behind: the old-bid note stays), or today's own (the plain stamp) */
    if (pd < win.session || (pd === win.session && p.min < CLOSE) || pd >= win.today) return null;
    var dw = dayWord(win.session, win.today), when;
    if (pd === win.session) when = 'Posted after ' + dw + '’s close, ' + hm(p.min) + '.';
    else when = 'Posted ' + WD[new Date(tOf(pd)).getUTCDay()] + ', ' + hm(p.min) + '.';
    var text = when;
    var full = MON[p.m - 1] + ' ' + p.d + ', ' + p.y + ', ' + hm(p.min).replace(' ', ' ') + ' CT';
    return { text: text, session: win.session,
      html: '<time class="hb-asof-t" datetime="' + new Date(t).toISOString() + '" title="' + esc(full) + '">' + esc(when) + '</time>' };
  }

  /* "Harvest · 74¢ under Jan '27" as plain parts: {month, basis} (either may be '') */
  function whatLine(month, basis, ref) {
    var mo = month ? String(month) : '', b = '';
    if (basis != null && basis !== '' && isFinite(Number(basis))) {
      /* The contract comes from the row's own futures field (ZCZ26 -> "Dec '26"). A month the card worked out
         from the price ("(inferred)") is not the row's and reads "futures", like a row that names none. */
      var c = Math.round(Number(basis) * 100 * 4) / 4, r = String(ref || '');
      var fut = r && !/\(inferred\)/.test(r) ? r : 'futures';
      b = c === 0 ? 'even with ' + fut : cents(c) + (c < 0 ? ' under ' : ' over ') + fut;
    }
    return { month: mo, basis: b };
  }

  var api = { ageLine: ageLine, ovnLine: ovnLine, ovnLive: ovnLive, whatLine: whatLine, between: between, cents: cents };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgBidAge = api;
})(typeof window !== 'undefined' ? window : globalThis);
