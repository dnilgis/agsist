/* components/fert-usda.js: the USDA dealer survey on /fertilizer, one section below the co-op answer, labelled a
 * cross-check (Nov 24, 2026). It reads data/fert-prices/index.json and one report file
 * (scripts/fetch_fert_reports.py writes them) and prints that report's newest figures as USDA printed them:
 * average, low to high, freight, the change since the report before and since a year ago only where the same
 * report priced the same product the same way (the file says which), the report's name and its date.
 *
 * It writes only into #usda-out. It never touches the co-op cards, the top line, the cost per pound or the
 * fertility bill, and it never reads or writes data/fertilizer-prices.json: nothing here can become the page's price.
 * The state chips are in the page's own HTML (#usda-<state>); a link to #usda-iowa opens that state's report.
 * Tests: test/fert-usda-check.test.mjs. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.AgFertUsda = api; if (root.document) api.start(root); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var NAME = { IA: 'Iowa', IL: 'Illinois', OK: 'Oklahoma', NC: 'North Carolina', UT: 'Utah', ID: 'Idaho', CO: 'Colorado',
    WY: 'Wyoming', OR: 'Oregon', WA: 'Washington' };
  var GRADE = { anhydrous: '82-0-0', urea: '46-0-0', uan28: '28-0-0', uan30: '30-0-0', uan32: '32-0-0', dap: '18-46-0',
    map: '11-52-0', potash: '0-0-60', ams: '21-0-0-24S', '10-34-0': '10-34-0', ats: '12-0-0-26S' };
  var WHY = { no_prev_report: 'no earlier report on file', not_in_prev: 'not in that report', different_terms: 'priced differently then',
    usda_change_differs: 'not shown: figures disagree', no_year_report: 'no report a year earlier on file', not_in_year: 'not in that report' };
  var CAD = { weekly: 'weekly', biweekly: 'every two weeks', monthly: 'monthly' };
  var STALE_DAYS = 30;

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function isDay(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function md(s, year) { return MON[+s.slice(5, 7) - 1] + ' ' + (+s.slice(8, 10)) + (year ? ', ' + s.slice(0, 4) : ''); }
  /* USDA's figure to the cent, as printed, so a price, its change and the earlier price add up */
  function money(v) { return '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  /* a low or high: whole dollars when USDA printed whole dollars */
  function dollars(v) { return Number.isInteger(v) ? '$' + v.toLocaleString('en-US') : money(v); }
  function num(v) { return typeof v === 'number' && isFinite(v) && v > 0; }
  /* '+$39.42', '-$12.00', 'no change' only when the change is zero to the cent */
  function changeText(c) {
    var v = Math.round(c * 100) / 100;
    return v === 0 ? 'no change' : (v > 0 ? '+' : '-') + money(v);
  }
  function andList(xs) { return xs.length === 1 ? xs[0] : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; }
  function ageDays(published, now) {
    var a = Date.parse(published + 'T12:00:00Z');
    return isNaN(a) ? null : Math.floor((now - a) / 86400000);
  }

  function cell(chg, why) {
    if (chg && num(chg.avg) && typeof chg.change === 'number') {
      var v = Math.round(chg.change * 100) / 100, cls = v > 0 ? 'up' : v < 0 ? 'dn' : 'eq';
      return '<td class="usda-c ' + cls + '">' + esc(changeText(chg.change)) + '<span class="usda-was">from ' + esc(money(chg.avg)) + '</span></td>';
    }
    return '<td class="usda-c usda-na">' + esc(WHY[why] || 'not shown') + '</td>';
  }

  /* the table and its lines for one report file; '' when the file has no usable product */
  function render(d, st, now) {
    if (!d || !Array.isArray(d.products) || !isDay(d.published)) return '';
    var ps = d.products.filter(function (p) { return p && p.label && num(p.avg) && num(p.low) && num(p.high); });
    if (!ps.length) return '';
    var prev = null, year = null;
    ps.forEach(function (p) {
      if (!prev && p.prev && isDay(p.prev.published)) prev = p.prev.published;
      if (!year && p.year && isDay(p.year.published)) year = p.year.published;
    });
    var rows = ps.map(function (p) {
      var rng = p.thin ? 'one price' : dollars(p.low) + ' to ' + dollars(p.high);
      var terms = p.freight === 'F.O.B.' ? p.freight : String(p.freight || '').toLowerCase();
      return '<tr><th scope="row"><span class="usda-n">' + esc(p.label) + '</span>' +
        (GRADE[p.key] ? '<span class="usda-g">' + esc(GRADE[p.key]) + '</span>' : '') + '</th>' +
        '<td class="usda-v"><b>' + esc(money(p.avg)) + '</b><span class="usda-r">' + esc(rng + (terms ? ', ' + terms : '')) + '</span></td>' +
        cell(p.prev, p.why_prev) + (year ? cell(p.year, p.why_year) : '') + '</tr>';
    }).join('');
    var head = '<tr><th scope="col">Product</th><th scope="col">Average, $/ton</th><th scope="col">Since ' +
      esc(prev ? md(prev, false) : 'the last report') + '</th>' + (year ? '<th scope="col">Since ' + esc(md(year, true)) + '</th>' : '') + '</tr>';
    var states = (d.states || []).map(function (s) { return NAME[s] || s; });
    var alone = d.states && d.states.length > 1 && st
      ? '<p class="usda-alone">USDA has no report for ' + esc(NAME[st] || st) + ' alone; the ' + esc(d.region) + ' report covers ' + esc(andList(states)) + '.</p>' : '';
    var age = ageDays(d.published, now);
    var old = age !== null && age > STALE_DAYS ? ' This report is ' + age + ' days old.' : '';
    return '<h3 class="usda-h">' + esc(d.region) + ' dealer prices, ' + esc(md(d.published, true)) + '</h3>' + alone +
      '<div class="usda-tw"><table class="usda-t"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="usda-src">Source: ' + esc(d.credit || d.source || 'USDA AMS') + '. Dealer asking prices in ' + esc(andList(states.length ? states : [d.region])) +
      ', as USDA printed them.' + (CAD[d.cadence] ? ' USDA publishes this report ' + CAD[d.cadence] + '.' : '') + esc(old) + '</p>' +
      '<p class="usda-note">Not our price. The co-op prices above are this site&rsquo;s price; this survey is shown only to compare.</p>';
  }

  /* the state a link or the page opens: #usda-<slug> names a chip; anything else (#usda-check, none) opens Iowa */
  function stateFor(hash, chips) {
    var m = /^#usda-([a-z-]+)$/.exec(hash || '');
    if (m) for (var i = 0; i < chips.length; i++) if (chips[i].id === 'usda-' + m[1]) return chips[i].st;
    return 'IA';
  }
  function reportFor(idx, st) {
    var rs = (idx && Array.isArray(idx.reports)) ? idx.reports : [];
    for (var i = 0; i < rs.length; i++) if (rs[i] && Array.isArray(rs[i].states) && rs[i].states.indexOf(st) >= 0) return rs[i];
    return null;
  }

  function start(w) {
    var doc = w.document, out = doc.getElementById('usda-out');
    if (!out) return;
    var nav = doc.querySelectorAll('.usda-states a[data-st]'), chips = [], docs = {}, idx = null, seq = 0;
    for (var i = 0; i < nav.length; i++) chips.push({ el: nav[i], id: nav[i].id, st: nav[i].getAttribute('data-st') });
    function getJ(u) { return w.fetch(u, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
    function none(t) { out.innerHTML = '<p class="usda-none">' + esc(t) + '</p>'; }
    function mark(st) {
      chips.forEach(function (c) { if (c.st === st) c.el.setAttribute('aria-current', 'true'); else c.el.removeAttribute('aria-current'); });
    }
    function show(st) {
      var n = ++seq;
      mark(st);
      if (!idx) { none('Could not read the USDA reports just now.'); return; }
      var r = reportFor(idx, st);
      if (!r) { none('No USDA report is on file for ' + (NAME[st] || st) + ' right now.'); return; }
      var done = function (d) {
        if (n !== seq) return;
        var h = render(d, st, Date.now());
        if (h) out.innerHTML = h; else none('Could not read the USDA report for ' + (NAME[st] || st) + ' just now.');
      };
      if (docs[r.id]) done(docs[r.id]);
      else getJ('/data/fert-prices/' + r.id + '.json').then(function (d) { if (d) docs[r.id] = d; done(d); });
    }
    function open() { show(stateFor(w.location.hash, chips)); }
    getJ('/data/fert-prices/index.json').then(function (d) { idx = d; open(); });
    /* only a link into this section moves the table; any other hash on the page leaves the state as it is */
    w.addEventListener('hashchange', function () { if (idx && /^#usda-/.test(w.location.hash)) open(); });
  }

  return { render: render, stateFor: stateFor, reportFor: reportFor, cell: cell, money: money, dollars: dollars, changeText: changeText, start: start };
});
