/* report-live.js: on a report day, the graded USDA result as soon as the worker has it, before
   the committed files reach the site. /usda-calendar (priced-in.js) and the homepage card use it;
   both keep showing the committed files when the worker has nothing for today.
   window.agsReportLive = {get, watch, toResult, todayCT}. */
(function () {
  'use strict';
  var API = 'https://agsist-api.dnilgis.workers.dev/report-live';
  var EVERY_MS = 15000, FOR_MS = 45 * 60000;
  function todayCT(d) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date()); }
    catch (e) { return ''; }
  }
  function minutesCT(d) {
    try {
      var p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(d || new Date());
      var h = 0, m = 0;
      p.forEach(function (x) { if (x.type === 'hour') h = +x.value; if (x.type === 'minute') m = +x.value; });
      return h * 60 + m;
    } catch (e) { return -1; }
  }
  function get(cb) {
    var done = false, t = setTimeout(function () { if (!done) { done = true; cb(null); } }, 8000);
    try {
      fetch(API, { cache: 'no-store', credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (done) return; done = true; clearTimeout(t); cb(d && d.live && !d.live.test ? d.live : null); })
        .catch(function () { if (!done) { done = true; clearTimeout(t); cb(null); } });
    } catch (e) { if (!done) { done = true; clearTimeout(t); cb(null); } }
  }
  /* Ask every 15 s, from 10:58 a.m. CT, for up to 45 minutes; call onRec once with today's record. */
  function watch(iso, onRec) {
    if (!iso || iso !== todayCT()) return;
    var start = Date.now(), stop = false;
    function tick() {
      if (stop || Date.now() - start > FOR_MS) return;
      if (minutesCT() < 10 * 60 + 58) { setTimeout(tick, EVERY_MS); return; }
      get(function (rec) {
        if (rec && rec.release === iso && rec.rows && rec.rows.length) { stop = true; onRec(rec); return; }
        setTimeout(tick, EVERY_MS);
      });
    }
    tick();
  }
  /* The record as the page's latest_result: the trade figures and sources from the committed
     upcoming card, USDA's figure and the grade from the record. */
  function toResult(rec, upcoming) {
    var by = {}, out = [], seen = {};
    ((upcoming && upcoming.date === rec.release && upcoming.numbers) || []).forEach(function (n) { by[n.key] = n; });
    rec.rows.forEach(function (r) {
      var n = by[r.key] ? JSON.parse(JSON.stringify(by[r.key])) : { key: r.key, label: r.label, unit: r.unit, expected: r.expected, low: r.low, high: r.high, usda_current: r.usda_current };
      n.actual = r.actual; n.surprise = r.surprise; n.gap_pct = r.gap_pct; n.context = r.context;
      out.push(n); seen[r.key] = 1;
    });
    Object.keys(by).forEach(function (k) { if (!seen[k]) out.push(by[k]); });
    var b = null;
    rec.rows.forEach(function (r) { if (r.key === rec.big) b = r; });
    var c = rec.counts || {};
    return {
      date: rec.release, report: rec.report, metric_count: c.metrics || 0, in_line_count: c.in_line || 0,
      ungraded_count: c.ungraded || 0, all_in_line: !!c.metrics && c.metrics === c.in_line,
      biggest_surprise: b ? { metric: b.label, expected: b.expected, actual: b.actual, unit: b.unit, surprise: b.surprise, gap_pct: b.gap_pct, context: b.context, low: b.low, high: b.high } : null,
      numbers: out, live: true
    };
  }
  window.agsReportLive = { get: get, watch: watch, toResult: toResult, todayCT: todayCT };

  /* THE HOMEPAGE CARD (index.html, baked by scripts/prerender_wpi_scorecard.py home_usda_card). */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function homeCard(rec) {
    var rows = rec.rows, graded = rows.filter(function (r) { return r.surprise === 'bullish' || r.surprise === 'bearish' || r.surprise === 'in line'; });
    var off = graded.filter(function (r) { return r.surprise !== 'in line'; }), ung = rows.length - graded.length, line;
    if (!graded.length) line = 'No figure in this report had a trade estimate to grade it against.';
    else if (!off.length) line = 'All ' + graded.length + ' graded figures landed in line with the trade average.';
    else {
      var b = off.reduce(function (a, r) { return Math.abs(r.gap_pct || 0) > Math.abs(a.gap_pct || 0) ? r : a; });
      line = (graded.length - off.length) + ' of ' + graded.length + ' graded figures in line with the trade. Biggest miss: ' + esc(b.label) + ', ' + ((b.gap_pct || 0) > 0 ? '+' : '') + b.gap_pct + '%, ' + b.surprise + '.';
    }
    if (ung) line += ' ' + ung + ' had no trade estimate.';
    var items = rows.map(function (r) {
      var u = r.unit ? ' ' + r.unit : '', words;
      if (r.expected == null) words = 'no trade estimate';
      else { words = r.surprise || 'not graded'; if (r.context) words += ', ' + r.context; words = 'trade ' + r.expected + '. ' + words.charAt(0).toUpperCase() + words.slice(1); }
      return '<p>' + esc(r.label) + ': ' + r.actual + esc(u) + ', ' + esc(words) + '.</p>';
    }).join('');
    var p = rec.release.split('-');
    return '<div class="gs-head"><span class="gs-t">' + esc(rec.report) + ' &middot; ' + MO[+p[1] - 1] + ' ' + (+p[2]) + '</span>'
      + '<a href="/usda-calendar#priced-in" class="gs-src">USDA, graded</a></div>'
      + '<div class="gs-line">' + line + '</div>'
      + '<details class="gs-more"><summary>Every figure against the trade</summary>' + items
      + '<p>Graded on the distance from the trade average: 0.5% for a yield, 1% for production, 2% for stocks. <a href="/usda-calendar#priced-in">What&rsquo;s Priced In</a></p></details>';
  }
  function home() {
    var card = document.querySelector('.usda-cal-card[data-next]');
    if (!card) return;
    var next = card.getAttribute('data-next');
    if (!next || card.getAttribute('data-shown') === next) return;
    watch(next, function (rec) { card.innerHTML = homeCard(rec); card.setAttribute('data-shown', rec.release); card.style.display = ''; });
  }
  window.agsReportLive.homeCard = homeCard;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', home); else home();
})();
