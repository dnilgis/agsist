/* Options positions on /cot (2026-11-06, Sig: feature options open interest and single out unusual positions).
   Reads /data/cot-options.json, which scripts/cot_options.py builds from CFTC data only; every figure there is
   computed by the builder, this file only words and places it. Facts only: no arrows, no direction words, no calls.
   Exports window.AgCotOptions (and module.exports for the tests). */
(function (root) {
  'use strict';
  var NAMES = { corn: 'Corn', beans: 'Soybeans', wheat: 'Chicago wheat', kcwheat: 'KC wheat', mplswheat: 'MPLS wheat',
    soymeal: 'Soybean meal', soyoil: 'Soybean oil', livecattle: 'Live cattle', feedercattle: 'Feeder cattle',
    leanhogs: 'Lean hogs', milk: 'Class III milk' };
  var ORDER = ['corn', 'beans', 'wheat', 'kcwheat', 'mplswheat', 'soymeal', 'soyoil', 'livecattle', 'feedercattle', 'leanhogs', 'milk'];
  var GROUP = { mm: 'managed money', pm: 'producers and merchants', swap: 'swap dealers', or: 'other reportables' };
  var GROUP_SHORT = { mm: 'Managed money', pm: 'Producers', swap: 'Swap dealers', or: 'Other reportables' };
  var GROUPS = ['mm', 'pm', 'swap', 'or'];
  var CONC = { g4l: ['4', 'longs'], g4s: ['4', 'shorts'], g8l: ['8', 'longs'], g8s: ['8', 'shorts'] };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MINUS = '−';

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function signed(n) { return n == null ? 'not reported' : (n > 0 ? '+' : n < 0 ? MINUS : '') + num(n); }
  function ord(n) { var v = n % 100, o = ['th', 'st', 'nd', 'rd']; return n + (o[(v - 20) % 10] || o[v] || o[0]); }
  function pc(v) { return v == null ? 'not reported' : (Math.round(v * 10) / 10).toFixed(1) + '%'; }
  /* "2026-10-27" -> "Oct 27, 2026" */
  function day(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? MON[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : '';
  }
  /* where a position sits in its own last three years */
  function where(p, weeks) {
    if (p == null) return 'not ranked';
    if (p === 0) return 'lowest in ' + weeks + ' weeks';
    if (p === 100) return 'highest in ' + weeks + ' weeks';
    return ord(p) + ' percentile of ' + weeks + ' weeks';
  }
  function moveText(p, weeks) {
    if (p === 100) return 'the largest weekly change in ' + weeks + ' weeks';
    return 'larger than ' + p + '% of weekly changes in ' + weeks + ' weeks';
  }

  /* The unusual lines, one per market and group (a level and a change for the same
     group read as one line), in the file's order. */
  function lines(d) {
    var out = [], seen = {};
    (d && d.unusual || []).forEach(function (u) {
      var name = NAMES[u.m] || u.m, txt;
      if (u.kind === 'level' || u.kind === 'change') {
        var key = u.m + '|' + u.g, part;
        if (u.kind === 'level') part = 'net options ' + signed(u.net) + ' contracts, ' + where(u.pct, u.weeks);
        else part = 'week change ' + signed(u.chg) + ', ' + moveText(u.pct, u.weeks);
        if (seen[key] != null) { out[seen[key]].parts.push(part); return; }
        seen[key] = out.length;
        out.push({ m: u.m, head: name + ', ' + (GROUP[u.g] || u.g), parts: [part], date: u.date });
        return;
      }
      var c = CONC[u.c];
      if (!c) return;
      txt = 'largest ' + c[0] + ' traders hold ' + pc(u.value) + ' of all ' + c[1] + ', ' +
        (u.kind === 'conc_hi' ? 'at the highest' : 'at the lowest') + ' in ' + u.weeks + ' weeks';
      out.push({ m: u.m, head: name, parts: [txt], date: u.date });
    });
    return out.map(function (l) {
      return '<li><b>' + esc(l.head) + '</b>: ' + esc(l.parts.join('; ')) + '. <span class="co-d">Week of ' + esc(day(l.date)) + '</span></li>';
    }).join('');
  }

  /* the count line: how many readings were scanned and how many an ordinary week turns up */
  function countLine(d) {
    if (!d || !d.scanned) return '';
    var nm = Object.keys(d.markets || {}).length;
    var s = d.flagged === 0 ? 'None of the ' + d.scanned + ' readings scanned across ' + nm + ' markets is at a 3-year extreme this week.'
      : d.flagged + ' of ' + d.scanned + ' readings scanned across ' + nm + ' markets ' + (d.flagged === 1 ? 'is' : 'are') + ' at 3-year extremes this week.';
    var t = d.typical;
    if (t && t.weeks) {
      s += ' In the ' + t.weeks + ' weeks before, a typical week had ' + t.median + ' (from ' + t.min + ' to ' + t.max +
        '). With this many readings, some land at an extreme in any week.';
    }
    return s;
  }

  function withheldText(m) {
    if (m.withheld === 'small') return 'Options are ' + pc(m.opt_share) + ' of open interest in this market, too small a share to rank the positions.';
    if (m.withheld === 'history') return 'Not enough history to rank these positions (' + m.weeks + ' weeks).';
    return '';
  }

  /* one market's block */
  function block(d, k) {
    var m = d && d.markets && d.markets[k];
    if (!m) return '<p class="co-note">No options figures for ' + esc(NAMES[k] || k) + ' this week.</p>';
    var h = '<p class="co-oi"><b>' + num(m.opt_oi) + '</b> contracts of options open interest, counted as futures equivalents, ' +
      pc(m.opt_share) + ' of all ' + num(m.oi_all) + ' contracts open. Week of ' + esc(day(m.date)) + '.</p>';
    var w = withheldText(m);
    if (w) h += '<p class="co-note">' + esc(w) + '</p>';
    h += '<div class="cg-tw"><table class="cg-table co-table"><caption class="sr-only">Net options position by trader group, ' +
      esc(NAMES[k] || k) + '</caption><thead><tr><th scope="col">Group</th><th scope="col">Net options</th><th scope="col">Week change</th><th scope="col">3-year rank</th></tr></thead><tbody>';
    GROUPS.forEach(function (g) {
      var r = m.groups && m.groups[g];
      if (!r) return;
      var rk = r.pct == null ? 'not ranked' : (r.pct === 0 ? 'lowest' : r.pct === 100 ? 'highest' : ord(r.pct)) + ' <span class="co-n">of ' + m.weeks + ' wks</span>';
      h += '<tr><th scope="row">' + GROUP_SHORT[g] + '</th><td>' + signed(r.net) + '</td><td>' + signed(r.chg) + '</td><td>' + rk + '</td></tr>';
    });
    h += '</tbody></table></div>';
    var c = m.conc || {};
    if (c.g4l != null) {
      h += '<p class="co-conc">Largest 4 traders hold ' + pc(c.g4l) + ' of all longs and ' + pc(c.g4s) + ' of all shorts; the largest 8, ' +
        pc(c.g8l) + ' and ' + pc(c.g8s) + '. Counting only what each trader holds net: ' + pc(c.n4l) + ' and ' + pc(c.n4s) +
        ' for the largest 4, ' + pc(c.n8l) + ' and ' + pc(c.n8s) + ' for the largest 8.</p>';
    }
    return h;
  }

  function sub(d, cotDate) {
    if (!d) return '';
    var s = 'Positions held on Tuesday, ' + day(d.report_date) + ', released ' + day(d.released) + '.';
    if (cotDate && cotDate > d.report_date) s += ' The options figures for the week of ' + day(cotDate) + ' are not in yet; these are the week before.';
    return s;
  }

  var api = { lines: lines, countLine: countLine, block: block, sub: sub, where: where, day: day, NAMES: NAMES, ORDER: ORDER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AgCotOptions = api;

  if (typeof document === 'undefined') return;
  function $(id) { return document.getElementById(id); }
  function isoOf(s) { var t = new Date(String(s || '') + ' 12:00'); return isNaN(t) ? '' : t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2); }
  function fail() {
    var s = $('co-sub');
    if (s) s.textContent = 'The options figures are not available right now. The weekly CFTC figures above are unaffected.';
    var u = $('co-unusual'); if (u) u.hidden = true;
    var b = $('co-markets'); if (b) b.hidden = true;
  }
  function render(d, cot) {
    var cotDate = cot && cot.report_date ? isoOf(cot.report_date) : '';
    $('co-sub').textContent = sub(d, cotDate);
    $('co-count').textContent = countLine(d);
    var ul = $('co-lines');
    ul.innerHTML = lines(d);
    ul.hidden = !ul.innerHTML;
    var sel = $('co-pick');
    var keys = ORDER.filter(function (k) { return d.markets && d.markets[k]; });
    sel.innerHTML = keys.map(function (k) { return '<option value="' + k + '">' + esc(NAMES[k]) + '</option>'; }).join('');
    function show() { $('co-block').innerHTML = block(d, sel.value); }
    sel.addEventListener('change', show);
    show();
  }
  function start() {
    if (!$('cot-opt')) return;
    var cot = fetch('/data/cot.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    fetch('/data/cot-options.json')
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (d) {
        if (!d || !d.markets || !d.report_date) throw new Error('empty');
        return cot.then(function (c) { render(d, c); });
      })
      .catch(fail);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : this);
