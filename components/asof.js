/* ══════════════════════════════════════════════════════════════════════════
   AGSIST "Updated" stamps, one copy for every page.

   Every number on the site says when it was updated, the same way:
     Updated 9:42 am            (today, Central time)
     Updated yesterday 4:10 pm
     Updated Oct 6              (older; a year is added when it is not this year)
   as a <time datetime> element. Past its feed's limit the stamp turns
   stale: class "is-stale", data-stale, and a plain note ("2 days old").

   Feeds and when they go stale:
     prices   more than 30 minutes of CBOT grain trading hours since the
              stamp (Sun-Fri 7:00 pm-7:45 am and Mon-Fri 8:30 am-1:20 pm CT;
              exchange holidays are not known here)
     bids     not from today (Central time)
     weather  older than 3 hours
     usda     older than 8 days (weekly USDA and CFTC data)
     drought  older than 9 days (Drought Monitor map, valid Tuesday, out Thursday)
     daily    a later morning's 9 am CT has passed since the stamp, i.e. the
              next daily build was due (the brief runs every day)

   Only real timestamps from the data go in. No stamp in the data: the slot
   is hidden, never filled with a guess.

   Use:
     AgAsOf.set(el, ts, 'prices')        fill el with the stamp (hidden if no ts)
     AgAsOf.html(ts, 'bids')             the <time> markup as a string ('' if no ts)
     AgAsOf.when(ts)                     "9:42 am" / "yesterday 4:10 pm" / "Oct 6"
   Static markup works too and is refreshed every minute:
     <time class="asof" data-asof="bids" datetime="2026-10-08T19:10:00-05:00">Updated Oct 8, 7:10 pm</time>

   The offline line ("Offline. Showing prices from 9:42 am.") lives at the
   bottom of this file; sw.js tells the page when it answered from its saved
   copy.
   ══════════════════════════════════════════════════════════════════════════ */
(function (w, d) {
  'use strict';
  if (w.AgAsOf) return;

  var TZ = 'America/Chicago';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  var fmt = null;
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23' });
  } catch (e) {}

  /* Central-time wall clock for a Date. */
  function ct(t) {
    var o = {};
    if (fmt) {
      fmt.formatToParts(t).forEach(function (p) { o[p.type] = p.value; });
      return { y: +o.year, m: +o.month, d: +o.day, hh: (+o.hour) % 24, mm: +o.minute, dow: DOW[o.weekday] };
    }
    var x = new Date(t.getTime() - 6 * 36e5); /* no Intl: CST, close enough to place a day */
    return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), hh: x.getUTCHours(),
      mm: x.getUTCMinutes(), dow: x.getUTCDay() };
  }
  function dayNum(p) { return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 864e5); }

  /* -> {t: Date, dateOnly: bool} or null. Accepts ISO strings, epoch ms or
     seconds, Date objects, and plain "YYYY-MM-DD" days (a report date). */
  function parse(ts) {
    if (ts == null || ts === '') return null;
    if (ts instanceof Date) return isNaN(ts) ? null : { t: ts, dateOnly: false };
    if (typeof ts === 'number') {
      var n = ts < 1e12 ? ts * 1000 : ts;
      var dn = new Date(n);
      return isNaN(dn) ? null : { t: dn, dateOnly: false };
    }
    var s = String(ts).trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return { t: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 17)), dateOnly: true }; /* noon CT */
    var t = new Date(s);
    return isNaN(t) ? null : { t: t, dateOnly: false };
  }

  function hm(p) {
    var h = p.hh % 12 || 12;
    return h + ':' + (p.mm < 10 ? '0' : '') + p.mm + '\u00a0' + (p.hh < 12 ? 'am' : 'pm');   /* never "8:46 / pm" */
  }

  /* "9:42 am" | "yesterday 4:10 pm" | "Oct 6" (| "Oct 6, 2025") */
  function when(ts, now) {
    var r = parse(ts);
    if (!r) return '';
    var p = ct(r.t), q = ct(now || new Date());
    var gap = dayNum(q) - dayNum(p);
    if (gap <= 0 && r.dateOnly) return 'today';   /* a UTC-dated file can read a day ahead of Central */
    if (gap === 0) return hm(p);
    if (gap === 1) return r.dateOnly ? 'yesterday' : 'yesterday ' + hm(p);
    return MON[p.m - 1] + ' ' + p.d + (p.y !== q.y ? ', ' + p.y : '');
  }

  function full(r) {
    var p = ct(r.t);
    return MON[p.m - 1] + ' ' + p.d + ', ' + p.y + (r.dateOnly ? '' : ', ' + hm(p) + ' CT');
  }

  /* CBOT grains, Central time. Monday 0:00-7:45 is the Sunday-night session. */
  function open(p) {
    var m = p.hh * 60 + p.mm, wd = p.dow >= 1 && p.dow <= 5;
    if (wd && m >= 510 && m < 800) return true;   /* 8:30 am-1:20 pm */
    if (wd && m < 465) return true;               /* overnight, to 7:45 am */
    if (p.dow <= 4 && m >= 1140) return true;     /* 7:00 pm on, Sun-Thu */
    return false;
  }
  function tradingMinutes(from, to, cap) {
    var step = 5 * 6e4, n = 0, t = from.getTime() + step;
    var end = to.getTime(), offs = {};
    if (end - from.getTime() > 5 * 864e5) return cap + 1;   /* no closure runs five days */
    for (; t <= end; t += step) {
      var hk = Math.floor(t / 36e5);
      if (offs[hk] == null) {
        var p0 = ct(new Date(hk * 36e5));
        offs[hk] = Date.UTC(p0.y, p0.m - 1, p0.d, p0.hh, p0.mm) - hk * 36e5;
      }
      var x = new Date(t + offs[hk]);
      if (open({ hh: x.getUTCHours(), mm: x.getUTCMinutes(), dow: x.getUTCDay() })) {
        n += 5;
        if (n > cap) return n;
      }
    }
    return n;
  }

  function ageNote(ms, dateOnly) {
    var min = Math.max(0, Math.round(ms / 6e4));
    if (dateOnly || min >= 48 * 60) { var dd = Math.max(1, Math.round(min / 1440)); return dd + (dd === 1 ? ' day old' : ' days old'); }
    if (min >= 90) { var h = Math.round(min / 60); return h + ' hours old'; }
    if (min >= 60) return '1 hour old';
    return min + ' min old';
  }

  /* -> {stale: bool, note: "2 days old" | ""} */
  function staleness(ts, feed, now) {
    var r = parse(ts);
    now = now || new Date();
    if (!r) return { stale: false, note: '' };
    var age = now - r.t, s = false;
    var p = ct(r.t), q = ct(now);
    if (feed === 'prices') s = tradingMinutes(r.t, now, 30) > 30;
    else if (feed === 'bids') s = dayNum(q) !== dayNum(p);
    else if (feed === 'weather') s = age > 3 * 36e5;
    else if (feed === 'usda') s = age > 8 * 864e5;
    else if (feed === 'drought') s = age > 9 * 864e5;   /* valid Tuesday, out Thursday, next one a week on */
    else if (feed === 'daily') {
      /* a later morning's 9 am CT has passed (the brief runs every day, by about 8:30) */
      var gapD = dayNum(q) - dayNum(p);
      s = gapD > 1 || (gapD === 1 && q.hh >= 9);
    }
    if (r.dateOnly && feed !== 'usda' && feed !== 'daily') s = s && dayNum(q) - dayNum(p) > 0;
    return { stale: s, note: s ? ageNote(Math.max(0, age), r.dateOnly) : '' };
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* What the slot says, as markup inside the <time>. */
  function inner(r, feed, prefix, now) {
    var src = r.dateOnly ? isoDay(r.t) : r.t;
    var st = staleness(src, feed, now);
    var txt = (prefix == null ? 'Updated' : prefix);
    var w0 = when(src, now);
    return { stale: st.stale, html: '<span class="asof-t">' + esc((txt ? txt + ' ' : '') + w0) + '</span>' +
      (st.stale ? '<span class="asof-note"> &middot; ' + esc(st.note) + '</span>' : '') };
  }
  function isoDay(t) { var p = ct(t); return p.y + '-' + (p.m < 10 ? '0' : '') + p.m + '-' + (p.d < 10 ? '0' : '') + p.d; }

  var seen = {};   /* newest stamp shown per feed, for the offline line */
  function note(feed, r) { if (feed && r && (!seen[feed] || r.t > seen[feed].t)) seen[feed] = r; if (w.AgAsOf) w.AgAsOf._offlineRefresh(); }

  /* <time> markup, or '' when there is no stamp. opts: {prefix: 'Updated'} */
  function html(ts, feed, opts) {
    var r = parse(ts);
    if (!r) return '';
    opts = opts || {};
    note(feed, r);
    var x = inner(r, feed, opts.prefix);
    var dt = r.dateOnly ? isoDay(r.t) : r.t.toISOString();
    return '<time class="asof' + (x.stale ? ' is-stale' : '') + '" datetime="' + dt + '" data-asof="' + esc(feed || '') + '"' +
      (opts.prefix != null ? ' data-asof-prefix="' + esc(opts.prefix) + '"' : '') +
      (x.stale ? ' data-stale=""' : '') + ' title="' + esc(full(r)) + '">' + x.html + '</time>';
  }

  /* Fill el with the stamp; hide el when there is none. */
  function set(el, ts, feed, opts) {
    if (typeof el === 'string') el = d.getElementById(el);
    if (!el) return false;
    var h = html(ts, feed, opts);
    el.innerHTML = h;
    el.hidden = !h;
    return !!h;
  }

  /* Re-render static or older stamps (the clock moves; a page left open on
     the dash goes stale on its own). */
  function refresh(root) {
    var els = (root || d).querySelectorAll('time.asof[data-asof][datetime], time[data-asof][datetime]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], r = parse(el.getAttribute('datetime'));
      if (!r) continue;
      var feed = el.getAttribute('data-asof');
      note(feed, r);
      var pre = el.getAttribute('data-asof-prefix');
      var x = inner(r, feed, pre);
      if (!el.classList.contains('asof')) el.classList.add('asof');
      el.classList.toggle('is-stale', x.stale);
      if (x.stale) el.setAttribute('data-stale', ''); else el.removeAttribute('data-stale');
      if (!el.title) el.title = full(r);
      if (el.innerHTML !== x.html) el.innerHTML = x.html;
    }
  }

  w.AgAsOf = { parse: parse, when: when, staleness: staleness, html: html, set: set, refresh: refresh, seen: seen,
    _offlineRefresh: function () {} };

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', function () { refresh(); });
  else refresh();
  setInterval(function () { refresh(); }, 60000);

  /* ── Offline line ─────────────────────────────────────────────────────
     sw.js posts {type:'agsist-saved-data', feed, dataTime, saved, reason}
     when it answers a data request from its saved copy (network down, or no
     answer in 3 seconds). The line names the data's own time: the stamp the
     page showed, else the time inside the saved file, else when it was saved. */
  var cached = {}, bar = null;
  var NAMES = { prices: 'prices', bids: 'bids', daily: 'the daily brief', weather: 'weather' };
  var ORDER = ['prices', 'bids', 'daily', 'weather'];
  var weak = false;

  function offlineText() {
    var bits = [], any = Object.keys(cached).length > 0;
    ORDER.forEach(function (f) {
      if (any ? !(f in cached) : (navigator.onLine || !seen[f])) return;
      var ts = seen[f] ? seen[f].t : parse(cached[f]) && parse(cached[f]).t;
      var wn = ts ? when(ts) : '';
      if (wn) bits.push(NAMES[f] + ' from ' + wn);
    });
    var off = !navigator.onLine || !weak;
    var lead = off ? 'Offline.' : 'Weak signal.';
    if (!bits.length) return navigator.onLine ? '' : 'Offline. Showing the last copy saved on this phone.';
    return lead + ' Showing ' + bits.slice(0, 2).join(' and ') + '.';
  }

  function render() {
    var txt = offlineText();
    if (!txt) { if (bar) bar.hidden = true; return; }
    if (!bar) {
      bar = d.createElement('p');
      bar.className = 'asof-offline';
      bar.setAttribute('role', 'status');
      var host = d.querySelector('main') || d.body;
      if (!host) return;
      host.insertBefore(bar, host.firstChild);
    }
    bar.textContent = txt;
    bar.hidden = false;
  }
  w.AgAsOf._offlineRefresh = function () { if (bar || !navigator.onLine || Object.keys(cached).length) render(); };
  w.AgAsOf.offlineText = offlineText;

  if ('serviceWorker' in navigator) {
    try {
      navigator.serviceWorker.addEventListener('message', function (e) {
        var m = e.data || {};
        if (m.type !== 'agsist-saved-data' || !m.feed) return;
        /* the file's own time; the save time only when the file names none */
        var when0 = m.dataTime || m.saved || '';
        if (!(m.feed in cached) || when0 > cached[m.feed]) cached[m.feed] = when0;
        weak = m.reason === 'timeout';
        if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', render); else render();
      });
    } catch (e) {}
  }
  w.addEventListener('offline', render);
  w.addEventListener('online', function () { weak = false; if (!Object.keys(cached).length && bar) bar.hidden = true; else render(); });
  if (!navigator.onLine) { if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', render); else render(); }
})(window, document);
