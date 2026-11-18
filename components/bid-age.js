/* components/bid-age.js: two lines on the home "Today near me" card, in words a farmer reads in one go.

   1. ageLine(posted, now, quotes, sym): the time line over the two top bids, BEFORE the day session.
      CBOT grains trade overnight (7:00 pm to 7:45 am CT, Sunday to Friday), pause, and open the day session at
      8:30 am. Elevators post new bids after that open, so at 7:20 am a bid posted after yesterday's close is the
      newest there is, not an old one. Between the last session and the next open (before 8:30 am on a trading
      day, or all day on a weekend or exchange holiday) a bid posted after the last session's close reads
        "Posted after yesterday's close, 1:47 pm."          ("Friday's close" on a Monday morning)
      and, when the bid names its futures contract and the price file holds a fresh overnight trade for that
      same contract with a change from that session's settle,
        "Jan '27 soybeans are down 5¢ since yesterday's settle (overnight, 7:01 am)."
      Anything else returns null and the page keeps the site's "Updated" stamp (components/asof.js), whose old
      bid note stays: in the day session, after the close, and for a bid older than the last session.
      No cash estimate is printed: the elevator's futures level at posting is not on file for every board, and
      the page would be mixing two files of different vintages into a new number (honest-numbers 8 and 9).
      Sessions and holidays come from AgPxStamp.isTradingDay (components/price-local.js, the twin of
      scripts/contract_calendar.py); the change from AgPxStamp.change (the one pair rule).

   2. whatLine(month, basis, ref): "Harvest delivery · 74¢ under Jan '27 futures", the town pages' words.
      No contract named: "66¢ under futures", never a guessed month.

   Pure; test/home-today-card.test.mjs runs it in node. */
(function (root) {
  'use strict';
  var TZ = 'America/Chicago', DAY = 864e5, OPEN = 8 * 60 + 30, CLOSE = 13 * 60 + 20, QUOTE_MAX_MIN = 45;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var FCODE = 'FGHJKMNQUVXZ';
  var CROP = { ZC: 'corn is', ZS: 'soybeans are', ZW: 'Chicago wheat is', KE: 'KC wheat is', MW: 'Minneapolis wheat is' };
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

  /* A fresh overnight trade for the bid's own contract, with its change from the session's settle:
     {text} or null. sym: the bid's contract ("ZCZ26"); quotes: data/prices.json quotes. */
  function moveLine(quotes, sym, win, now) {
    var P = px(), m = /^(Z[CS]|ZW|KE|MW)([FGHJKMNQUVXZ])(\d{2})$/.exec(String(sym || ''));
    if (!P || !m || !quotes) return null;
    var q = null;
    for (var k in quotes) if (quotes[k] && quotes[k].ticker === sym + '.CBT') { q = quotes[k]; break; }
    if (!q || q.close_kind !== 'last' || q.settled || q.roll || q.close_date !== win.today || !q.close_time) return null;
    var at = Date.parse(q.close_time), nt = (now instanceof Date ? now : new Date(now)).getTime();
    if (!isFinite(at) || at > nt + 60e3 || nt - at > QUOTE_MAX_MIN * 6e4) return null;   /* past the delay limit: say nothing */
    var c = P.change(q);
    if (!c || c.vs !== win.session || typeof c.net !== 'number') return null;
    var a = ct(new Date(at));
    if (!a || iso(a) !== win.today) return null;
    var name = MON[FCODE.indexOf(m[2])] + " '" + m[3] + ' ' + CROP[m[1]];
    var dw = dayWord(win.session, win.today), mv = Math.round(c.net * 4) / 4;
    var how = mv === 0 ? ' unchanged since ' : (mv < 0 ? ' down ' : ' up ') + cents(mv) + ' since ';
    return { text: name + how + dw + '’s settle (overnight, ' + hm(a.min) + ').' };
  }

  /* -> {text, html, session} or null (keep the site's Updated stamp) */
  function ageLine(posted, now, quotes, sym) {
    now = now || new Date();
    var t = posted ? Date.parse(posted) : NaN, win = between(now);
    if (!isFinite(t) || !win) return null;
    var p = ct(new Date(t)), pd = iso(p);
    /* before the last close (it is behind: the old-bid note stays), or today's own (the plain stamp) */
    if (pd < win.session || (pd === win.session && p.min < CLOSE) || pd >= win.today) return null;
    var dw = dayWord(win.session, win.today), when;
    if (pd === win.session) when = 'Posted after ' + dw + '’s close, ' + hm(p.min) + '.';
    else when = 'Posted ' + WD[new Date(tOf(pd)).getUTCDay()] + ', ' + hm(p.min) + '.';
    var mv = moveLine(quotes, sym, win, now);
    var text = when + (mv ? ' ' + mv.text : '');
    var full = MON[p.m - 1] + ' ' + p.d + ', ' + p.y + ', ' + hm(p.min).replace(' ', ' ') + ' CT';
    return { text: text, session: win.session, move: mv ? mv.text : '',
      html: '<time class="hb-asof-t" datetime="' + new Date(t).toISOString() + '" title="' + esc(full) + '">' + esc(when) + '</time>' +
        (mv ? ' <span class="hb-asof-mv">' + esc(mv.text) + '</span>' : '') };
  }

  /* "Harvest delivery · 74¢ under Jan '27 futures" as plain parts: {month, basis} (either may be '') */
  function whatLine(month, basis, ref) {
    var mo = month ? String(month) + ' delivery' : '', b = '';
    if (basis != null && basis !== '' && isFinite(Number(basis))) {
      var c = Math.round(Number(basis) * 100 * 4) / 4, r = String(ref || ''), inf = / \(inferred\)$/.test(r);
      r = r.replace(/ \(inferred\)$/, '');
      var fut = (r ? r + ' futures' : 'futures') + (inf ? ' (month inferred)' : '');
      b = c === 0 ? 'even with ' + fut : cents(c) + (c < 0 ? ' under ' : ' over ') + fut;
    }
    return { month: mo, basis: b };
  }

  var api = { ageLine: ageLine, whatLine: whatLine, between: between, moveLine: moveLine, cents: cents };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgBidAge = api;
})(typeof window !== 'undefined' ? window : globalThis);
