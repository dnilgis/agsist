/* happening.js: "Today and this week" in the hero, beside the futures (Nov 6, 2026).

   Up to three stacked releases, never a carousel. The first is the next release with a countdown (redrawn each
   minute, not announced) and one line built only from numbers this site already published; then up to two more in
   the next seven days, one line each. After a release time passes, its row says "Out today" with the headline
   number once our own data file carries the new report, or "Out at <time> ET, updating" until it does, for the
   rest of that day (Eastern).

   WHERE THE DATES COME FROM (nothing is typed here):
     COT        data/cot.json next_release (fetch_cot.py, from scripts/cot_calendar.py release_date), and for the
                weeks after it cotRelease, a line-for-line port of release_date: the Friday of the as-of week,
                one business day later for each federal holiday Wednesday to Friday (CFTC's Monday releases).
     USDA       /usda-calendar.ics (scripts/build_usda_ics.mjs, from the report list on /usda-calendar).
     Crop       Progress: Mondays 4:00 PM ET in season, the next business day after a Monday holiday, through the
                season's last Monday (CP_LAST, the table in scripts/usda_dates.py CROP_PROGRESS_LAST).
   Times are Eastern, as CFTC and USDA publish them and as the rest of the report rows on this page print them.

   NO LAYOUT SHIFT: scripts/seed_static.py (happening_seed) bakes the same rows server-side (the JS-off text), and
   css/home.css holds each line's room. The live region (#hap-say) speaks only when a row changes state.
   window.AgHappening (test/home-happening.test.mjs runs it in node on fixtures and a fixed clock).

   THE FUNDS THIS WEEK ASK (Nov 6: grow the Friday COT email list): when the first row is the COT report (its
   countdown, "updating" or "Out today"), a small "Email me Fridays" link sits at the right of its title line and opens
   the one Funds this week box on /cot (#cot-signup; no second signup path). It is placed over the row's own room
   (absolute, a 44 px target), so it moves nothing; the bake writes it too. GA4: funds_ask {where: home_happening}.

   LAST WEEK'S QUESTION, THIS WEEK'S ANSWER (kit v2 part 2, Nov 6): before the release the COT row's line is the
   week's question from data/cot-questions.json (scripts/cot_questions.py: fund positions only, never prices); once the
   new report is in cot.json the row is titled "Read this week's funds report" and its line answers ("Funds sold corn
   for 7 weeks in a row."): the question file's answer when it is for that report, else the corn run from cot-history.
   A question file for another week is never shown. */
(function (root) {
  'use strict';
  var DAY = 864e5;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONFULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var CP_LAST = { 2026: '2026-11-30' };
  /* CFTC closures that are not regular federal holidays (scripts/cot_calendar.py RELEASE_OVERRIDE) */
  var COT_OVERRIDE = { '2025-01-07': '2025-01-13' };
  /* the USDA rows shown here, in the order a merged row names them, and the page each one links */
  var USDA = [
    [/^WASDE$/, 'WASDE', '/usda-calendar'],
    [/^Crop Production/, null, '/usda-calendar'],
    [/^Grain Stocks/, 'Grain Stocks', '/usda-calendar'],
    [/^Prospective Plantings$/, null, '/usda-calendar'],
    [/^Acreage$/, null, '/usda-calendar'],
    [/^Small Grains/, null, '/usda-calendar'],
    [/^Cattle on Feed$/, null, '/cattle-futures-prices'],
    [/^Quarterly Hogs and Pigs$/, 'Hogs and Pigs', '/cattle-futures-prices'],
    [/^Milk Production$/, null, '/milk-prices']
  ];
  var COT_NAME = 'Funds report (COT)';

  /* ---- dates (ISO yyyy-mm-dd, UTC arithmetic so the weekday never depends on the reader's zone) ---- */
  function iso(d) { return d.toISOString().slice(0, 10); }
  function dt(s) { return new Date(s + 'T00:00:00Z'); }
  function add(s, n) { return iso(new Date(dt(s).getTime() + n * DAY)); }
  function wd(s) { return dt(s).getUTCDay(); }
  function nth(y, mo, w, n) { var d = new Date(Date.UTC(y, mo - 1, 1)); return iso(new Date(d.getTime() + (((w - d.getUTCDay() + 7) % 7) + 7 * (n - 1)) * DAY)); }
  function lastMon(y, mo) { var d = new Date(Date.UTC(y, mo, 0)); return iso(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY)); }
  function observed(y, mo, d) { var s = iso(new Date(Date.UTC(y, mo - 1, d))), w = wd(s); return w === 6 ? add(s, -1) : w === 0 ? add(s, 1) : s; }
  var HOL = {};
  /* observed US federal holidays (cot_calendar.federal_holidays; Juneteenth from 2021) */
  function holiday(s) {
    var y = +s.slice(0, 4);
    if (!HOL[y]) {
      var h = {};
      [observed(y, 1, 1), nth(y, 1, 1, 3), nth(y, 2, 1, 3), lastMon(y, 5), observed(y, 7, 4), nth(y, 9, 1, 1),
        nth(y, 10, 1, 2), observed(y, 11, 11), nth(y, 11, 4, 4), observed(y, 12, 25)].forEach(function (x) { h[x] = 1; });
      if (y >= 2021) h[observed(y, 6, 19)] = 1;
      HOL[y] = h;
    }
    return !!HOL[y][s];
  }
  function bizDay(s) { return wd(s) !== 0 && wd(s) !== 6 && !holiday(s); }
  function nextBiz(s) { do { s = add(s, 1); } while (!bizDay(s)); return s; }

  /* scripts/cot_calendar.py release_date(as_of), ported */
  function cotRelease(asOf) {
    if (COT_OVERRIDE[asOf]) return COT_OVERRIDE[asOf];
    var mon = add(asOf, -((wd(asOf) + 6) % 7)), delay = 0;
    for (var i = 2; i <= 4; i++) if (holiday(add(mon, i))) delay++;
    var d = add(mon, 4);
    for (var k = 0; k < Math.min(delay, 2); k++) d = nextBiz(d);
    while (!bizDay(d)) d = nextBiz(d);
    return d;
  }

  /* ---- Eastern time ---- */
  function etParts(ms) {
    var p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return { day: p.year + '-' + p.month + '-' + p.day, h: +p.hour % 24, mi: +p.minute };
  }
  function etMs(day, h, mi) {
    var g = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), h, mi), p = etParts(g);
    return g - (Date.UTC(+p.day.slice(0, 4), +p.day.slice(5, 7) - 1, +p.day.slice(8, 10), p.h, p.mi) - g);
  }
  function clock(h, mi) { return ((h % 12) || 12) + ':' + ('0' + mi).slice(-2) + ' ' + (h < 12 ? 'AM' : 'PM') + ' ET'; }
  function short(s) { return DOW[wd(s)] + ' ' + MON[+s.slice(5, 7) - 1] + ' ' + (+s.slice(8, 10)); }
  function md(s) { return MON[+s.slice(5, 7) - 1] + ' ' + (+s.slice(8, 10)); }
  function reportIso(s) {      /* cot.json report_date, "November 03, 2026" */
    var m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(String(s || '').trim()), i = m ? MONFULL.indexOf(m[1]) : -1;
    return i < 0 ? null : m[3] + '-' + ('0' + (i + 1)).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  }
  function commas(n) { return String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  /* ---- the releases ---- */
  function cotEvents(cot, nowMs) {
    var out = [], a0 = cot && reportIso(cot.report_date);
    if (!a0) return out;
    var nr = cot.next_release && /^\d{4}-\d{2}-\d{2}$/.test(cot.next_release) ? cot.next_release : null;
    var tm = /^(\d{1,2}):(\d{2})$/.exec(cot.next_release_time_et || '15:30') || [0, 15, 30];
    for (var k = 0; k <= 3; k++) {
      var asOf = add(a0, 7 * k), day = k === 1 && nr ? nr : cotRelease(asOf), normal = add(asOf, 4 - ((wd(asOf) + 6) % 7));
      out.push({ key: 'cot', name: COT_NAME, href: '/cot', day: day, h: +tm[1], mi: +tm[2], at: etMs(day, +tm[1], +tm[2]),
        moved: day > normal ? normal : null });
    }
    return out;
  }
  function icsEvents(text) {
    var out = [];
    String(text || '').replace(/\r/g, '').replace(/\n[ \t]/g, '').split('BEGIN:VEVENT').slice(1).forEach(function (b) {
      var s = /\nSUMMARY:([^\n]*)/.exec(b), d = /\nDTSTART:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}Z/.exec(b);
      if (!s || !d) return;                   /* all-day rows (FSA dates, the Outlook Forum) are not releases */
      var name = s[1].trim();
      for (var i = 0; i < USDA.length; i++) {
        if (!USDA[i][0].test(name)) continue;
        var at = Date.UTC(+d[1], +d[2] - 1, +d[3], +d[4], +d[5]), p = etParts(at);
        out.push({ key: name === 'WASDE' ? 'wasde' : 'usda', rank: i, name: USDA[i][1] || name, href: USDA[i][2], day: p.day, h: p.h, mi: p.mi, at: at });
        return;
      }
    });
    return out;
  }
  function cpEvents(nowMs) {
    var out = [], today = etParts(nowMs).day, mon = add(today, -((wd(today) + 6) % 7));
    for (var k = -1; k <= 2; k++) {
      var m = add(mon, 7 * k), y = +m.slice(0, 4);
      if (m < nth(y, 4, 1, 1) || m > (CP_LAST[y] || add(nth(y, 11, 4, 4), -3))) continue;
      var day = holiday(m) ? nextBiz(m) : m;
      out.push({ key: 'cp', name: 'Crop Progress', href: '/conditions', day: day, h: 16, mi: 0, at: etMs(day, 16, 0), moved: day !== m ? m : null });
    }
    return out;
  }

  /* The rows to show at nowMs: anything still to come, plus anything out earlier today (Eastern). Releases at the same
     minute are one row. The first row is unrestricted; the other two are within the next seven days. */
  function pick(events, nowMs) {
    var today = etParts(nowMs).day, g = {}, rows = [];
    (events || []).forEach(function (e) {
      if (!(e.at > nowMs || e.day === today)) return;
      var k = String(e.at);
      if (!g[k]) { g[k] = { at: e.at, day: e.day, h: e.h, mi: e.mi, parts: [] }; rows.push(g[k]); }
      if (!g[k].parts.some(function (x) { return x.name === e.name; })) g[k].parts.push(e);
    });
    rows.forEach(function (r) {
      r.parts.sort(function (a, b) { return (a.key === 'cot' ? -1 : a.rank == null ? 50 : a.rank) - (b.key === 'cot' ? -1 : b.rank == null ? 50 : b.rank); });
      r.name = r.parts.map(function (x) { return x.name; }).join(' and ');
      r.href = r.parts[0].href; r.key = r.parts[0].key;
      r.moved = r.parts[0].moved || null;
      r.out = r.at <= nowMs;
    });
    rows.sort(function (a, b) { return a.at - b.at; });
    return rows.slice(0, 1).concat(rows.slice(1).filter(function (r) { return r.at - nowMs <= 7 * DAY; }).slice(0, 2));
  }

  /* ---- the words ---- */
  function when(r, nowMs, bake) {
    var today = etParts(nowMs).day, t = clock(r.h, r.mi);
    var d = bake ? short(r.day) + ',' : r.day === today ? 'today' : r.day === add(today, 1) ? 'tomorrow' : short(r.day) + ',';
    return d + ' ' + t + (r.moved ? ', holiday week' : '');
  }
  function countdown(r, nowMs) {
    var ms = r.at - nowMs;
    if (ms <= 0) return '';
    var m = Math.ceil(ms / 6e4), h = Math.floor(m / 60);
    if (ms >= DAY) { var n = Math.round((dt(r.day) - dt(etParts(nowMs).day)) / DAY); return 'in ' + n + ' day' + (n === 1 ? '' : 's'); }
    return 'in ' + (h ? h + ' h ' : '') + (m % 60) + ' m';
  }
  function cotRows(hist, cot) {
    var h = (hist && hist.history && hist.history.corn) || [], rows = [];
    h.forEach(function (x) { if (x && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && typeof x.net === 'number') rows.push(x); });
    rows.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var a0 = cot && reportIso(cot.report_date), c = cot && cot.corn;
    /* cot.json is the report on /cot: history runs to its week, no further; history that has not caught up to it
       gets its week (and the week before) from cot.json's own net and prev, never invented */
    if (a0) rows = rows.filter(function (x) { return x.date <= a0; });
    if (a0 && c && typeof c.net === 'number' && (!rows.length || rows[rows.length - 1].date < a0)) {
      if (typeof c.prev === 'number' && (!rows.length || rows[rows.length - 1].date < add(a0, -7))) rows.push({ date: add(a0, -7), net: c.prev });
      rows.push({ date: a0, net: c.net });
    }
    return rows;
  }
  /* weeks in a row managed money's corn net moved the same way, newest first; consecutive weeks only */
  function streak(rows) {
    var n = 0, sign = 0;
    for (var i = rows.length - 1; i > 0; i--) {
      var gap = (dt(rows[i].date) - dt(rows[i - 1].date)) / DAY, ch = rows[i].net - rows[i - 1].net, s = ch > 0 ? 1 : ch < 0 ? -1 : 0;
      if (gap > 8 || !s || (sign && s !== sign)) break;
      sign = s; n++;
    }
    return { n: n, sign: sign, last: rows.length > 1 ? rows[rows.length - 1].net - rows[rows.length - 2].net : null, date: rows.length ? rows[rows.length - 1].date : null };
  }
  /* the question file, only when it is for the report cot.json carries */
  function qs(D) { var q = D.q, a0 = D.cot && reportIso(D.cot.report_date); return q && a0 && q.report_date === a0 ? q : null; }
  function teaser(r, D) {
    var cot = D.cot, w = D.wasde, cp = D.cp;
    if (r.key === 'cot') {
      var q = qs(D);
      if (q && q.this_week && q.this_week.question) return 'This week\u2019s question: ' + q.this_week.question;
      var s = streak(cotRows(D.hist, cot));
      if (s.n >= 2) return 'Funds ' + (s.sign < 0 ? 'sold' : 'bought') + ' corn ' + s.n + ' weeks straight. Did they keep ' + (s.sign < 0 ? 'selling' : 'buying') + '?';
      if (s.last) return 'Funds ' + (s.last < 0 ? 'sold ' : 'bought ') + commas(s.last) + ' corn contracts net in the week to ' + md(s.date) + '.';
      return '';
    }
    if (r.parts.some(function (x) { return x.key === 'wasde'; })) {
      var y = wasdeYield(w);
      return y && w.release < r.day ? MONFULL[+w.release.slice(5, 7) - 1] + ' WASDE: ' + y + '. What changes?' : '';
    }
    if (r.key === 'cp') {
      var c = cp && cp.corn;
      if (c && typeof c.harvest_pct === 'number' && c.harvest_pct < 100 && /^\d{4}-\d{2}-\d{2}$/.test(c.harvest_date || '') && c.harvest_date < r.day)
        return 'Corn harvest was ' + c.harvest_pct + '% done as of ' + md(c.harvest_date) + '.';
      return '';
    }
    return '';
  }
  function wasdeYield(w) {
    var m = w && w.metrics && w.metrics.filter(function (x) { return /^corn_yield_/.test(x.key || '') && typeof x.value === 'number'; })[0];
    return m && /^\d{4}-\d{2}-\d{2}$/.test(w.release || '') ? 'corn yield ' + m.value + ' bu/acre' : '';
  }
  /* a row whose time has passed today: the headline number when our file has the new report, else "updating";
     a report this site does not read a number from just says it is out */
  function outLine(r, D) {
    if (r.key === 'cot') {
      var a0 = D.cot && reportIso(D.cot.report_date), c = D.cot && D.cot.corn;
      if (a0 && a0 >= add(r.day, -7) && c && typeof c.net === 'number' && typeof c.prev === 'number') {
        var ch = c.net - c.prev, q = qs(D), lw = q && q.last_week, t = 'Read this week\u2019s funds report';
        if (lw && lw.answered === a0 && lw.answer) return { state: 'out', t: t, x: lw.answer.replace(/^(Yes|No)\. /, '') };
        var s = streak(cotRows(D.hist, D.cot));
        if (s.n >= 2 && s.date === a0) return { state: 'out', t: t, x: 'Funds ' + (s.sign < 0 ? 'sold' : 'bought') + ' corn for ' + s.n + ' weeks in a row.' };
        return { state: 'out', t: t, x: ch === 0 ? 'Funds left their corn net unchanged in the week to ' + md(a0) + '.'
          : 'Funds ' + (ch < 0 ? 'sold ' : 'bought ') + commas(ch) + ' corn contracts net in the week to ' + md(a0) + '.' };
      }
      return { state: 'wait' };
    }
    if (r.parts.some(function (x) { return x.key === 'wasde'; })) {
      if (D.wasde && D.wasde.release === r.day && wasdeYield(D.wasde)) return { state: 'out', x: 'USDA put the ' + wasdeYield(D.wasde) + '.' };
      return { state: 'wait' };
    }
    if (r.key === 'cp') {
      var cc = D.cp && D.cp.corn;
      if (cc && typeof cc.harvest_pct === 'number' && cc.harvest_date && cc.harvest_date >= add(r.day, -1)) return { state: 'out', x: 'Corn harvest ' + cc.harvest_pct + '% done as of ' + md(cc.harvest_date) + '.' };
      return { state: 'wait' };
    }
    return { state: 'out', x: '' };
  }
  /* {rows:[{t, w, cd, x, href, state}], say}: what each row prints at nowMs */
  function words(events, D, nowMs) {
    return pick(events, nowMs).map(function (r, i) {
      var o = { t: r.name, href: r.href, state: 'next', cd: '', x: '', ask: i === 0 && r.key === 'cot' };
      if (r.out) {
        var ol = outLine(r, D || {});
        o.state = ol.state;
        if (ol.t) o.t = ol.t;
        o.w = ol.state === 'wait' ? 'Out at ' + clock(r.h, r.mi) + ', updating' : 'Out today at ' + clock(r.h, r.mi);
        o.x = ol.state === 'wait' ? (i === 0 ? teaser(r, D || {}) : '') : ol.x;
      } else {
        o.w = when(r, nowMs);
        if (i === 0) { o.cd = countdown(r, nowMs); o.x = teaser(r, D || {}); }
      }
      return o;
    });
  }
  function rowHtml(o, i) {
    var e = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
    if (i === 0) return '<li class="hap-i hap-top' + (o.ask ? ' hap-asks' : '') + '" data-state="' + o.state + '"><a class="hap-a" href="' + e(o.href) + '" data-track="happening">' +
      '<span class="hap-t">' + e(o.t) + '</span><span class="hap-w"><span class="hap-wt">' + e(o.w) + '</span>' +
      '<span class="hap-cd">' + (o.cd ? ' &middot; ' + e(o.cd) : '') + '</span></span><span class="hap-x"' + (o.x ? ' title="' + e(o.x) + '"' : '') + '>' + e(o.x) + '</span></a>' +
      (o.ask ? ASK : '') + '</li>';
    return '<li class="hap-i" data-state="' + o.state + '"><a class="hap-a" href="' + e(o.href) + '" data-track="happening">' +
      '<span class="hap-w">' + e(o.w) + '</span><span class="hap-t">' + e(o.t) + (o.x ? ': ' + e(o.x) : '') + '</span></a></li>';
  }
  /* the same markup as scripts/seed_static.py HAP_ASK */
  var ASK = '<a class="hap-ask" href="/cot#cot-signup" data-track="funds-ask">Email me Fridays</a>';
  var FILL = '<li class="hap-i hap-all"><a class="hap-a" href="/usda-calendar" data-track="happening"><span class="hap-w">Every report date</span><span class="hap-t">USDA report calendar</span></a></li>';
  function listHtml(rows) {
    var h = rows.map(rowHtml).join('');
    for (var i = rows.length; i < 3; i++) h += i === rows.length ? FILL : '<li class="hap-i hap-none" aria-hidden="true"></li>';
    return h;
  }

  /* ---- the page ---- */
  var api = { cotRelease: cotRelease, cotEvents: cotEvents, icsEvents: icsEvents, cpEvents: cpEvents, pick: pick, words: words,
    streak: streak, cotRows: cotRows, listHtml: listHtml, etMs: etMs, holiday: holiday };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (!root || !root.document) return;
  root.AgHappening = api;

  function get(u, kind) {
    return fetch(u, { cache: 'no-cache' }).then(function (r) { return r.ok ? (kind === 'text' ? r.text() : r.json()) : null; }).catch(function () { return null; });
  }
  var D = {}, ev = [], sig = '', timer = 0, polled = 0;
  /* the releases the rows are drawn from, for the home kit's picture (components/home-kit.js) */
  api.events = function () { return ev.slice(); };
  function load() {
    return Promise.all([get('/data/cot.json'), get('/data/cot-history.json'), get('/data/wasde.json'), get('/data/crop-progress.json'), get('/data/cot-questions.json')])
      .then(function (a) { D.cot = a[0]; D.hist = a[1]; D.wasde = a[2]; D.cp = a[3]; D.q = a[4]; polled = Date.now(); });
  }
  function draw() {
    var list = document.getElementById('hap-list'), now = Date.now();
    if (!list) return;
    ev = cotEvents(D.cot, now).concat(icsEvents(D.ics), cpEvents(now));
    var rows = words(ev, D, now);
    if (!rows.length) return;                              /* nothing read: the baked rows stay */
    /* a change of state (a new row, out, updating) redraws and is spoken once; the minute only changes the countdown */
    var s = rows.map(function (o) { return o.t + '|' + o.w.replace(/^(today|tomorrow)/, '') + '|' + o.state + '|' + o.x + '|' + o.ask; }).join('/');
    if (s !== sig) {
      var first = !sig; sig = s;
      list.innerHTML = listHtml(rows);
      var say = document.getElementById('hap-say');
      if (say && !first) say.textContent = rows[0].t + ': ' + rows[0].w + (rows[0].state === 'out' && rows[0].x ? '. ' + rows[0].x : '');
    } else {
      var cd = list.querySelector('.hap-top .hap-cd'), wt = list.querySelector('.hap-top .hap-wt');
      if (cd) cd.textContent = rows[0].cd ? ' · ' + rows[0].cd : '';
      if (wt) wt.textContent = rows[0].w;
    }
    /* waiting on a release: look for the new file every five minutes */
    if (rows.some(function (o) { return o.state === 'wait'; }) && Date.now() - polled > 3e5) load().then(draw);
  }
  function tick() { draw(); clearTimeout(timer); timer = setTimeout(tick, 60000 - (Date.now() % 60000) + 50); }
  function go() {
    var list = document.getElementById('hap-list');
    if (!list) return;
    list.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('.hap-ask') : null;
      if (a) try { if (typeof root.gaEvent === 'function') root.gaEvent('funds_ask', { where: 'home_happening' }); } catch (x) {}
    });
    /* Nov 10: one request for the calendar file per page (AG.text, components/util.js), shared
       with the season strip, not a second fetch of the same file. */
    var icsP = root.AG && root.AG.text ? root.AG.text('/usda-calendar.ics').catch(function () { return null; }) : get('/usda-calendar.ics', 'text');
    Promise.all([load(), icsP.then(function (t) { D.ics = t; })]).then(function () { tick(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})(typeof self !== 'undefined' ? self : this);
