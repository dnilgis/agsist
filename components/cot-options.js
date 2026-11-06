/* Positioning map and options positions on /cot (2026-11-06; Nov 6 polish: one tab stop on the map with arrow keys,
   the detail beside the map on a wide screen, the block's column says options, Sig: feature options open interest and single out
   unusual positions; "has to be epic", few words, no repeated wording).
   Reads /data/cot-options.json, which scripts/cot_options.py builds from CFTC data only. Every figure there is
   computed by the builder; this file only words and places it. Facts only: no arrows, no direction words, no calls.
     map()     markets down the side, the four trader groups across (futures and options for each); each cell is
               the position's percentile in its own last 3 years, colored low to high, the top and bottom 5% ringed
     detail()  the tapped cell: the number, the week change, its rank and a 3-year line
     cards()   "Unusual this week", one card per market and group
     block()   the options figures for the market picked on the 52-week chart
   Exports window.AgCotOptions (and module.exports for the tests). */
(function (root) {
  'use strict';
  var NAMES = { corn: 'Corn', beans: 'Soybeans', wheat: 'Chicago wheat', kcwheat: 'KC wheat', mplswheat: 'MPLS wheat',
    soymeal: 'Soybean meal', soyoil: 'Soybean oil', livecattle: 'Live cattle', feedercattle: 'Feeder cattle',
    leanhogs: 'Lean hogs', milk: 'Class III milk' };
  /* row labels on the map: short enough for a 390 px phone */
  var ROW = { corn: 'Corn', beans: 'Soybeans', wheat: 'Chi. wheat', kcwheat: 'KC wheat', mplswheat: 'MPLS wheat',
    soymeal: 'Meal', soyoil: 'Soy oil', livecattle: 'Live cattle', feedercattle: 'Feeders', leanhogs: 'Hogs', milk: 'Milk' };
  var ORDER = ['corn', 'beans', 'wheat', 'kcwheat', 'mplswheat', 'soymeal', 'soyoil', 'livecattle', 'feedercattle', 'leanhogs', 'milk'];
  var IN = { corn: 'corn', beans: 'soybeans', wheat: 'Chicago wheat', kcwheat: 'KC wheat', mplswheat: 'MPLS wheat', soymeal: 'soybean meal',
    soyoil: 'soybean oil', livecattle: 'live cattle', feedercattle: 'feeder cattle', leanhogs: 'lean hogs', milk: 'Class III milk' };
  var GROUPS = ['mm', 'pm', 'swap', 'or'];
  var GROUP = { mm: 'Funds', pm: 'Producers', swap: 'Swap dealers', or: 'Other big traders' };
  var GROUP_LOWER = { mm: 'funds', pm: 'producers', swap: 'swap dealers', or: 'other big traders' };
  var SIDE = { fut: 'futures', opt: 'options' };
  var CONC = { g4l: ['4', 'longs'], g4s: ['4', 'shorts'], g8l: ['8', 'longs'], g8s: ['8', 'shorts'] };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MINUS = '−';
  var SHOW = 6;   // cards shown before "Show all"

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function signed(n) { return n == null ? 'not reported' : (n > 0 ? '+' : n < 0 ? MINUS : '') + num(n); }
  function pc(v) { return v == null ? 'not reported' : (Math.round(v * 10) / 10).toFixed(1) + '%'; }
  /* "2026-10-27" -> "Oct 27, 2026" */
  function day(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? MON[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : '';
  }
  function where(p, weeks) {
    if (p == null) return 'not ranked';
    if (p === 0) return 'lowest in ' + weeks + ' weeks';
    if (p === 100) return 'highest in ' + weeks + ' weeks';
    /* in words, never an ordinal (2026-11-06); the map's yardstick is contracts over the last 3 years */
    return 'higher than ' + p + '% of the last ' + weeks + ' weeks, in contracts';
  }
  /* the five bins of the color scale, read from the printed percentile */
  function bin(p, edge) {
    if (p == null) return 'na';
    edge = edge == null ? 5 : edge;
    if (p <= edge) return 'x0';
    if (p < 25) return 'b1';
    if (p <= 75) return 'b2';
    if (p < 100 - edge) return 'b3';
    return 'x4';
  }
  function cell(d, k, side, g) {
    var m = d && d.markets && d.markets[k];
    if (!m) return null;
    var r = side === 'opt' ? m.groups && m.groups[g] : m.fut && m.fut[g];
    return r ? { m: m, r: r } : null;
  }

  /* ---------------------------------------------------------------- the map: a real table, one button per cell */
  function map(d) {
    var keys = ORDER.filter(function (k) { return d && d.markets && d.markets[k]; });
    var h = '<table class="cm-t"><caption class="sr-only">How each net position in contracts ranks against its own last 3 years, 0 lowest, 100 highest, by market and trader group, futures and options. Week of ' +
      esc(day(d.report_date)) + '.</caption><thead><tr><td class="cm-c0"></td>';
    GROUPS.forEach(function (g) { h += '<th scope="colgroup" colspan="2" class="cm-g">' + GROUP[g] + '</th>'; });
    h += '</tr><tr><td class="cm-c0"></td>';
    GROUPS.forEach(function () { h += '<th scope="col" class="cm-s"><abbr title="futures">Fut</abbr></th><th scope="col" class="cm-s"><abbr title="options">Opt</abbr></th>'; });
    h += '</tr></thead><tbody>';
    keys.forEach(function (k) {
      h += '<tr><th scope="row" class="cm-r">' + ROW[k] + '</th>';
      GROUPS.forEach(function (g) {
        ['fut', 'opt'].forEach(function (side) {
          var c = cell(d, k, side, g), p = c ? c.r.pct : null, b = bin(p, d.edge);
          var lab = NAMES[k] + ', ' + GROUP_LOWER[g] + ', ' + SIDE[side] + ': ' + where(p, c ? c.m.weeks : 0);
          h += '<td class="cm-x ' + b + (side === 'opt' ? ' cm-o' : '') + '"><button type="button" class="cm-b" data-k="' + k + '" data-s="' + side + '" data-g="' + g +
            '" aria-label="' + esc(lab) + '" aria-pressed="false" tabindex="-1">' + (p == null ? '<span aria-hidden="true">&middot;</span>' : p) + '</button></td>';
        });
      });
      h += '</tr>';
    });
    return h + '</tbody></table>';
  }

  /* ---------------------------------------------------------------- the tapped cell */
  function detail(d, k, side, g) {
    var c = cell(d, k, side, g);
    if (!c) return '';
    var m = c.m, r = c.r;
    var h = '<h3 class="cd-h">' + esc(NAMES[k]) + ': ' + GROUP_LOWER[g] + ', ' + SIDE[side] + '</h3>';
    h += '<p class="cd-big"><b>' + signed(r.net) + '</b> <span>' + (side === 'opt' ? 'contracts net, futures equivalent' : 'contracts net') + '</span></p>';
    var bits = [];
    if (r.pct != null) bits.push(cap(where(r.pct, m.weeks)) + '.');
    else if (side === 'opt' && m.withheld === 'small') bits.push('Options are ' + pc(m.opt_share) + ' of open interest here, too few to rank.');
    else bits.push('Not ranked: under ' + m.weeks + ' weeks of history.');
    if (r.chg != null) bits.push('Week change ' + signed(r.chg) + (r.chg_pct != null ? ', bigger than ' + Math.min(r.chg_pct, 99) + '% of weekly changes.' : '.'));
    h += '<p class="cd-txt">' + esc(bits.join(' ')) + '</p>';
    h += '<div class="cd-sp" data-k="' + k + '" data-s="' + side + '" data-g="' + g + '"></div>';
    return h;
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* the 3-year line as SVG, drawn at the real pixel width (no stretched text or dots) */
  function spark(vals, dates, w, h) {
    if (!vals || vals.length < 2) return '';
    var lo = Math.min.apply(null, vals.concat([0])), hi = Math.max.apply(null, vals.concat([0]));
    if (hi === lo) hi = lo + 1;
    var T = 6, B = h - 6, L = 4, R = w - 8;
    function X(i) { return L + (R - L) * i / (vals.length - 1); }
    function Y(v) { return B - (B - T) * (v - lo) / (hi - lo); }
    var pts = vals.map(function (v, i) { return X(i).toFixed(1) + ',' + Y(v).toFixed(1); }).join(' ');
    var n = vals.length - 1;
    return '<svg class="cd-svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Net position every fourth week from ' +
      esc(day(dates[0])) + ' to ' + esc(day(dates[n])) + '">' +
      '<line class="cd-zero" x1="' + L + '" x2="' + R + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '"/>' +
      '<polyline class="cd-line" points="' + pts + '"/>' +
      '<line class="cd-hair" x1="0" x2="0" y1="' + T + '" y2="' + B + '" hidden/>' +
      '<circle class="cd-dot" cx="' + X(n).toFixed(1) + '" cy="' + Y(vals[n]).toFixed(1) + '" r="4"/></svg>';
  }
  function sparkFoot(vals, dates) {
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    return '<p class="cd-foot"><span>' + esc(day(dates[0])) + '</span><span>' + esc(day(dates[dates.length - 1])) + '</span></p>' +
      '<p class="cd-rng">3-year high ' + signed(hi) + ', low ' + signed(lo) + '</p>';
  }

  /* ---------------------------------------------------------------- "Unusual this week" */
  var KIND_ORDER = { level: 0, change: 1 };
  function cardList(d) {
    var out = [], seen = {};
    (d && d.unusual || []).forEach(function (u) {
      if (u.kind === 'level' || u.kind === 'change') {
        var key = u.m + '|' + u.g;
        if (seen[key] == null) { seen[key] = out.length; out.push({ m: u.m, g: u.g, net: u.net, chg: u.chg, weeks: u.weeks, date: u.date }); }
        out[seen[key]][u.kind] = u.pct;
        return;
      }
      if (CONC[u.c]) out.push({ m: u.m, c: u.c, value: u.value, hi: u.kind === 'conc_hi', weeks: u.weeks, date: u.date });
    });
    return out;
  }
  function sentence(c) {
    if (c.c) return 'Largest ' + CONC[c.c][0] + ' traders hold this share of all ' + CONC[c.c][1] + ', the ' + (c.hi ? 'most' : 'least') + ' in ' + c.weeks + ' weeks.';
    var s = c.level != null ? cap(where(c.level, c.weeks)) : '';
    if (c.change != null) {
      var ch = 'week change of ' + signed(c.chg) + ' bigger than ' + Math.min(c.change, 99) + '% of weekly changes';
      s = s ? s + ', after a ' + ch : cap(ch);
    }
    return s + '.';
  }
  function cards(d) {
    return cardList(d).map(function (c, i) {
      var head = esc(NAMES[c.m]) + ' <span>' + (c.c ? 'big traders' : GROUP_LOWER[c.g] + ', options') + '</span>';
      var big = c.c ? pc(c.value) : signed(c.net);
      var tap = c.c ? '' : ' data-k="' + c.m + '" data-s="opt" data-g="' + c.g + '"';
      return '<li class="cu' + (i >= SHOW ? ' cu-more' : '') + '"' + tap + '><p class="cu-h"><span class="cu-n">' + head + '</span><time class="cu-d" datetime="' + esc(c.date) + '">' +
        esc(day(c.date).replace(/, \d{4}$/, '')) + '</time></p><p class="cu-big">' + big + '</p><p class="cu-s">' + esc(sentence(c)) + '</p></li>';
    }).join('');
  }
  function countLine(d) {
    if (!d || !d.scanned) return '';
    var t = d.typical, s;
    if (!d.flagged) s = 'None of ' + d.scanned + ' readings scanned is at a 3-year extreme this week.';
    else s = d.flagged + ' of ' + d.scanned + ' readings scanned ' + (d.flagged === 1 ? 'is' : 'are') + ' at 3-year extremes.';
    if (t && t.weeks) s += ' A typical week in the past year had ' + t.median + ' (' + t.min + ' to ' + t.max + '), so some turn up by chance.';
    return s;
  }

  /* ---------------------------------------------------------------- the market picked on the chart */
  function block(d, k) {
    var m = d && d.markets && d.markets[k];
    if (!m) return '';
    var h = '<h3 class="co-h3">Options in ' + esc(IN[k] || k) + '</h3>';
    h += '<p class="co-oi"><b>' + num(m.opt_oi) + '</b> futures-equivalent contracts, ' + pc(m.opt_share) + ' of all open interest.</p>';
    if (m.withheld === 'small') h += '<p class="co-note">Too few options here to rank the positions.</p>';
    else if (m.withheld === 'history') h += '<p class="co-note">Under ' + m.weeks + ' weeks of history: not ranked.</p>';
    h += '<div class="co-tw"><table class="co-t"><caption class="sr-only">Net options position by trader group, ' + esc(NAMES[k]) +
      ', week of ' + esc(day(m.date)) + '</caption><thead><tr><th scope="col">Group</th><th scope="col">Net options</th><th scope="col">Week</th><th scope="col">Rank, last 3 years, contracts</th></tr></thead><tbody>';
    GROUPS.forEach(function (g) {
      var r = m.groups && m.groups[g];
      if (!r) return;
      var rk = r.pct == null ? 'not ranked' : r.pct === 0 ? 'lowest' : r.pct === 100 ? 'highest' : 'higher than ' + r.pct + '%';
      h += '<tr><th scope="row">' + GROUP[g] + '</th><td>' + signed(r.net) + '</td><td>' + signed(r.chg) + '</td><td class="' + bin(r.pct, d.edge) + '">' + rk + '</td></tr>';
    });
    h += '</tbody></table></div>';
    var c = m.conc || {};
    if (c.g4l != null) {
      h += '<p class="co-conc">Largest 4 traders: ' + pc(c.g4l) + ' of longs, ' + pc(c.g4s) + ' of shorts. Largest 8: ' + pc(c.g8l) + ', ' + pc(c.g8s) + '.</p>';
    }
    return h;
  }

  function sub(d, cotDate) {
    if (!d) return '';
    var s = 'Held Tuesday, ' + day(d.report_date) + ', released ' + day(d.released) + '.';
    if (cotDate && cotDate > d.report_date) s += ' The week of ' + day(cotDate) + ' is not in yet.';
    return s;
  }

  var api = { map: map, detail: detail, spark: spark, cards: cards, cardList: cardList, sentence: sentence, countLine: countLine,
    block: block, sub: sub, where: where, bin: bin, day: day, NAMES: NAMES, ORDER: ORDER, SHOW: SHOW };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AgCotOptions = api;

  if (typeof document === 'undefined') return;
  function $(id) { return document.getElementById(id); }
  function isoOf(s) { var t = new Date(String(s || '') + ' 12:00'); return isNaN(t) ? '' : t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2); }
  var D = null, pick = null;

  function fail() {
    var s = $('co-sub');
    if (s) s.textContent = 'The positioning map is not available right now.';
    ['cm-wrap', 'co-unusual', 'cm-legend', 'cm-detail'].forEach(function (id) { var e = $(id); if (e) e.hidden = true; });
  }
  function drawSpark() {
    var box = document.querySelector('#cm-detail .cd-sp');
    if (!box || !D) return;
    var m = D.markets[box.getAttribute('data-k')], sp = m && m.spark;
    var vals = sp && sp[box.getAttribute('data-s')] && sp[box.getAttribute('data-s')][box.getAttribute('data-g')];
    if (!vals) { box.innerHTML = ''; return; }
    var w = Math.max(200, Math.floor(box.clientWidth || 300));
    box.innerHTML = spark(vals, sp.dates, w, 64) + '<p class="cd-tip" aria-hidden="true"></p>' + sparkFoot(vals, sp.dates);
    var svg = box.querySelector('svg'), hair = box.querySelector('.cd-hair'), tip = box.querySelector('.cd-tip');
    function at(ev) {
      var r = svg.getBoundingClientRect(), x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      var i = Math.max(0, Math.min(vals.length - 1, Math.round((x - 4) / (w - 12) * (vals.length - 1))));
      var hx = (4 + (w - 12) * i / (vals.length - 1)).toFixed(1);
      hair.setAttribute('x1', hx); hair.setAttribute('x2', hx); hair.removeAttribute('hidden');
      tip.textContent = day(sp.dates[i]) + ': ' + signed(vals[i]);
    }
    svg.addEventListener('pointermove', at);
    svg.addEventListener('pointerleave', function () { hair.setAttribute('hidden', ''); tip.textContent = ''; });
  }
  function select(k, s, g, focus) {
    pick = { k: k, s: s, g: g };
    document.querySelectorAll('#cm-wrap .cm-b').forEach(function (b) {
      var on = b.getAttribute('data-k') === k && b.getAttribute('data-s') === s && b.getAttribute('data-g') === g;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('tabindex', on ? '0' : '-1');
    });
    $('cm-detail').innerHTML = detail(D, k, s, g);
    drawSpark();
    if (focus) { var b = document.querySelector('#cm-wrap .cm-b[aria-pressed="true"]'); if (b) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  function chartMarket() {
    var C = root.AgCotChart, ks = C && C.selected ? C.selected() : null;
    if (ks && ks[0]) return ks[0];
    var b = document.querySelector('#cc-chips .cc-chip[aria-pressed="true"]');
    return b ? b.getAttribute('data-k') : 'corn';
  }
  function drawBlock() {
    var box = $('co-mkt');
    if (!box || !D) return;
    var cmp = root.AgCotChart && root.AgCotChart.compare && root.AgCotChart.compare();
    var html = cmp ? '' : block(D, chartMarket());
    box.innerHTML = html;
    box.hidden = !html;
  }
  function render(d, cot) {
    D = d;
    var cotDate = cot && cot.report_date ? isoOf(cot.report_date) : '';
    $('co-sub').textContent = sub(d, cotDate);
    $('cm-wrap').innerHTML = map(d);
    $('co-count').textContent = countLine(d);
    var ul = $('co-cards');
    ul.innerHTML = cards(d);
    ul.hidden = !ul.innerHTML;
    var n = ul.querySelectorAll('.cu').length, more = $('co-more');
    if (more) {
      more.hidden = n <= SHOW;
      more.textContent = 'Show all ' + n;
      more.onclick = function () { ul.classList.add('all'); more.hidden = true; };
    }
    $('cm-wrap').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.cm-b') : null;
      if (b) select(b.getAttribute('data-k'), b.getAttribute('data-s'), b.getAttribute('data-g'));
    });
    /* one tab stop for the whole map; arrows move, Home/End jump in the row, Enter or Space opens (a button's own click) */
    $('cm-wrap').addEventListener('keydown', function (e) {
      var b = e.target.closest ? e.target.closest('.cm-b') : null;
      if (!b) return;
      var rows = [].slice.call(document.querySelectorAll('#cm-wrap tbody tr')).map(function (tr) { return [].slice.call(tr.querySelectorAll('.cm-b')); });
      var r = -1, c = -1;
      rows.forEach(function (row, i) { var j = row.indexOf(b); if (j >= 0) { r = i; c = j; } });
      if (r < 0) return;
      var k = e.key;
      if (k === 'ArrowRight') c = Math.min(c + 1, rows[r].length - 1);
      else if (k === 'ArrowLeft') c = Math.max(c - 1, 0);
      else if (k === 'ArrowDown') r = Math.min(r + 1, rows.length - 1);
      else if (k === 'ArrowUp') r = Math.max(r - 1, 0);
      else if (k === 'Home') c = 0;
      else if (k === 'End') c = rows[r].length - 1;
      else return;
      e.preventDefault();
      var n = rows[r][Math.min(c, rows[r].length - 1)];
      b.setAttribute('tabindex', '-1');
      n.setAttribute('tabindex', '0');
      n.focus();
    });
    ul.addEventListener('click', function (e) {
      var li = e.target.closest ? e.target.closest('.cu[data-k]') : null;
      if (!li) return;
      select(li.getAttribute('data-k'), 'opt', li.getAttribute('data-g'), true);
      var t = $('cot-opt'); if (t && t.scrollIntoView) t.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    var first = cardList(d).filter(function (c) { return !c.c; })[0];
    if (first) select(first.m, 'opt', first.g); else select('corn', 'opt', 'mm');
    var chips = $('cc-chips');
    if (chips) chips.addEventListener('click', function () { setTimeout(drawBlock, 0); });
    var cmpBtn = $('cc-cmp');
    if (cmpBtn) cmpBtn.addEventListener('click', function () { setTimeout(drawBlock, 0); });
    root.addEventListener('popstate', function () { setTimeout(drawBlock, 0); });
    drawBlock();
    var rt = null;
    root.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(drawSpark, 150); });
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
