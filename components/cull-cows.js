/* AGSIST cull cow prices: the "Cull cows this week" sections on
 * cattle-auction-prices.html and milk-prices.html.
 *
 * Reads data/cull-cows.json, written by scripts/fetch_cull_cows.py from the
 * slaughter cow and bull tables in USDA AMS auction reports. Every number here
 * is the file's: each barn's own sale, and the regional middle the pipeline
 * computed (withheld under its barn floor). This file only picks which barns
 * sold in the last 14 days and words it.
 *
 * Without the file (or with a file that will not load) the section keeps its
 * plain fallback line and says the prices did not load. Nothing is filled in.
 *
 * Pure functions are exported for test/cull-cows.test.mjs.
 */
(function (root) {
  'use strict';
  var DATA = '/data/cull-cows.json';
  var WINDOW_DAYS = 14;     // same window as the pipeline's regional line
  var LATE_DAYS = 3;        // the file not refreshed for longer than this: say so
  var KEY = 'agsist-cullcows-state';
  var COLS = [['boner', 'Boner'], ['breaker', 'Breaker'], ['lean', 'Lean'], ['bulls', 'Bulls']];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var STATES = { IA: 'Iowa', IL: 'Illinois', IN: 'Indiana', KS: 'Kansas', KY: 'Kentucky', MO: 'Missouri', OK: 'Oklahoma',
    AR: 'Arkansas', NE: 'Nebraska', SD: 'South Dakota', ND: 'North Dakota', TX: 'Texas', TN: 'Tennessee', VA: 'Virginia',
    WI: 'Wisconsin', MN: 'Minnesota', CO: 'Colorado', MT: 'Montana', WY: 'Wyoming', NM: 'New Mexico', FL: 'Florida',
    UT: 'Utah', WA: 'Washington' };

  /* ---------- pure ---------- */
  function daysBetween(a, b) { // ISO dates, b - a in whole days
    return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
  }
  function isoToday(d) {
    d = d || new Date();
    // the reader's own calendar day
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function fmtDate(iso, today) {
    var p = String(iso).split('-');
    var s = MON[+p[1] - 1] + ' ' + (+p[2]);
    return (today && today.slice(0, 4) === p[0]) ? s : s + ', ' + p[0];
  }
  function money(n, cents) {
    var s = cents === false ? String(Math.round(n)) : (Math.round(n * 100) / 100).toFixed(2);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return '$' + parts.join('.');
  }
  function lb(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' lb'; }
  function listWords(xs) {
    if (xs.length < 2) return xs.join('');
    return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
  }
  /* barns whose newest sale is in the WINDOW_DAYS ending today (never a sale dated after today) */
  function recent(doc, today) {
    return ((doc && doc.barns) || []).filter(function (b) {
      var s = b.sales && b.sales[0];
      if (!s || !s.date) return false;
      var d = daysBetween(s.date, today);
      return d >= 0 && d < WINDOW_DAYS;
    }).sort(function (x, y) {
      return (x.state || '').localeCompare(y.state || '') || (x.town || '').localeCompare(y.town || '');
    });
  }
  /* the Average dressing line of one class: {row} when sold, {refused: why} when USDA's table
   * could not be read cleanly, {} when the class was not sold at that sale */
  function avgOf(sale, cls) {
    var rows = (sale.classes || {})[cls];
    if (rows) {
      for (var i = 0; i < rows.length; i++) if (rows[i].dressing === 'Average') return { row: rows[i] };
      return { other: rows.length };
    }
    var ref = (sale.refused || []).filter(function (r) { return r.class === cls; })[0];
    return ref ? { refused: ref.why } : {};
  }
  /* the regional sentence, from the pipeline's numbers only */
  function regionalLine(doc, today) {
    var r = doc && doc.regional;
    if (!r) return { ok: false, text: 'No regional cull cow price in this file.' };
    var age = daysBetween(doc.as_of, today);
    if (age >= WINDOW_DAYS) {
      return { ok: false, text: 'The last USDA read was ' + fmtDate(doc.as_of, today) + ', too long ago to give as this week’s price.' };
    }
    if (r.median_cwt == null) {
      return { ok: false, text: 'Not enough barns sold Boner cows of Average dressing in the ' + r.window_days +
        ' days to ' + fmtDate(r.to, today) + ' to give a middle price (' + r.barns + (r.barns === 1 ? ' barn' : ' barns') +
        '; it takes ' + r.min_barns + ').' };
    }
    var st = (r.states || []).map(function (s) { return STATES[s] || s; });
    return {
      ok: true,
      cwt: r.median_cwt,
      text: 'Boner cows of Average dressing brought a middle price of ' + money(r.median_cwt) + ' per cwt at ' + r.barns +
        ' barns in ' + listWords(st) + ' that sold ' + fmtDate(r.first_sale, today) + ' to ' + fmtDate(r.last_sale, today) +
        ' (lowest barn ' + money(r.low_cwt) + ', highest ' + money(r.high_cwt) + '). Middle weight ' + lb(r.median_wt) +
        ', middle price a head ' + money(r.median_per_head, false) + ' before selling costs.'
    };
  }
  function lateNote(doc, today) {
    var u = doc && doc.updated ? doc.updated.slice(0, 10) : null;
    if (!u) return '';
    var d = daysBetween(u, today);
    return d > LATE_DAYS ? 'Last read from USDA ' + fmtDate(u, today) + '; no newer read has come through since.' : '';
  }

  /* ---------- DOM ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var CSS = '.cc-line{font-size:1.02rem;line-height:1.5;margin:.4rem 0 .6rem;color:var(--text)}' +
    '.cc-late{color:var(--text-muted);font-size:.86rem;margin:.2rem 0}' +
    '.cc-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:10px;margin:.5rem 0}' +
    '.cc-t{border-collapse:collapse;width:100%;min-width:520px;font-size:.88rem}' +
    '.cc-t th,.cc-t td{padding:.45rem .55rem;border-bottom:1px solid var(--border);text-align:right;vertical-align:top}' +
    '.cc-t th:first-child,.cc-t td:first-child{text-align:left}' +
    '.cc-t th{font-weight:600;color:var(--text-muted);font-size:.8rem;background:var(--surface)}' +
    '.cc-t td small{display:block;color:var(--text-muted);font-size:.76rem;white-space:nowrap}' +
    '.cc-t td small.cc-dairy{white-space:normal;max-width:16rem}' +
    '.cc-t td.cc-no{color:var(--text-dim);font-size:.8rem}' +
    '.cc-t a{color:var(--text);text-decoration:underline;text-underline-offset:2px;text-decoration-thickness:1px}' +
    '.cc-bar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:.4rem 0;font-size:.88rem;color:var(--text-muted)}' +
    '.cc-bar select{font:inherit;padding:.3rem .4rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)}' +
    '.cc-words{font-size:.9rem;line-height:1.5;color:var(--text-muted);margin:.5rem 0}' +
    '.cc-words b{color:var(--text)}' +
    '.cc details{margin:.5rem 0;font-size:.88rem;color:var(--text-muted)}' +
    '.cc summary{cursor:pointer;color:var(--text);font-weight:600}' +
    '.cc-src{font-size:.8rem;color:var(--text-muted);margin:.4rem 0}' +
    '.cc-src a{color:var(--text-muted);text-decoration:underline}';
  function addCss(doc) {
    if (doc.getElementById('cc-css')) return;
    var s = doc.createElement('style');
    s.id = 'cc-css';
    s.textContent = CSS;
    doc.head.appendChild(s);
  }
  function cell(sale, cls) {
    var a = avgOf(sale, cls);
    if (a.row) {
      return '<td>' + money(a.row.cwt) + '<small>' + a.row.head + ' hd, ' + lb(a.row.avg_wt) + '</small><small>' +
        money(a.row.per_head, false) + ' a head</small></td>';
    }
    if (a.refused) return '<td class="cc-no" title="' + esc(a.refused) + '">not read</td>';
    if (a.other) return '<td class="cc-no">no Average line</td>';
    return '<td class="cc-no">none sold</td>';
  }
  /* some barns price dairy cows in their own tables: name those Average lines under the barn */
  function dairyNote(sale) {
    var out = [];
    [['dairy-breaker', 'Breaker'], ['dairy-boner', 'Boner'], ['dairy-lean', 'Lean']].forEach(function (c) {
      var a = avgOf(sale, c[0]);
      if (a.row) out.push(c[1] + ' ' + money(a.row.cwt) + ' (' + a.row.head + ' hd)');
    });
    return out.length ? '<small class="cc-dairy">Dairy cows priced apart: ' + esc(out.join(', ')) + '</small>' : '';
  }
  function table(barns, today) {
    var h = '<div class="cc-wrap"><table class="cc-t"><thead><tr><th>Barn and sale</th>';
    COLS.forEach(function (c) { h += '<th>' + c[1] + '<br>$/cwt</th>'; });
    h += '</tr></thead><tbody>';
    barns.forEach(function (b) {
      var s = b.sales[0];
      h += '<tr><td><a href="' + esc(s.url || b.source_url) + '" rel="noopener">' + esc(b.name) + '</a><small>' +
        esc(b.town) + ', ' + esc(b.state) + '</small><small>Sale of ' + fmtDate(s.date, today) + '</small>' + dairyNote(s) + '</td>';
      COLS.forEach(function (c) { h += cell(s, c[0]); });
      h += '</tr>';
    });
    return h + '</tbody></table></div>';
  }
  var WORDS = '<p class="cc-words"><b>What the words mean.</b> USDA sorts slaughter cows by how lean they are; the percent ' +
    'in each name is the share of lean meat. <b>Breakers</b> (75 to 80% lean) are the fleshiest cows, <b>Boners</b> (80 to 85%) ' +
    'carry moderate flesh, and <b>Leans</b> (85 to 90%) are the thinnest. <b>Dressing</b> (Average, High, Low) is how much carcass ' +
    'the buyer expects for her live weight; a High-dressing cow brings more a pound. The table shows each class’s Average ' +
    'dressing line. Cows sold to go back on feed, and light or heavy cows, are lines of their own in USDA’s report and are not in ' +
    'these numbers. Bulls are slaughter bulls, USDA yield grade 1-2.</p>';
  function mathBlock(doc, today) {
    var r = doc.regional || {};
    var refused = [];
    (doc.barns || []).forEach(function (b) {
      var s = b.sales && b.sales[0];
      (s && s.refused || []).forEach(function (x) { refused.push(b.name + ' (' + b.state + '), ' + x.class + ' table, report ' + s.report); });
    });
    return '<details><summary>How these numbers are figured</summary>' +
      '<p>Each barn’s newest sale in a USDA AMS auction report: the barn’s own feeder report when it prints a ' +
      'slaughter cattle part, or its slaughter and replacement report. USDA reports head, weight range, average weight, price ' +
      'range and average price for each line. Lines of one class and dressing are pooled by total weight; $/head is the sale’s ' +
      'dollars over its head. The regional middle is the median of each barn’s Boner Average $/cwt, one number per barn, over ' +
      'barns that sold in the ' + (r.window_days || WINDOW_DAYS) + ' days ending ' + (r.to ? fmtDate(r.to, today) : 'on the read day') +
      '. Under ' + (r.min_barns || 3) + ' barns it is not shown.</p>' +
      (refused.length ? '<p>USDA lines AGSIST could not read cleanly, left out whole: ' + esc(refused.join('; ')) + '.</p>' : '') +
      '<p>Read ' + esc(doc.updated ? fmtDate(doc.updated.slice(0, 10), today) : '') + '; ' + (doc.reports_checked || 0) +
      ' USDA reports checked.</p></details>';
  }
  function render(el, doc, today, ls) {
    var mode = el.getAttribute('data-cull-cows') || 'cattle';
    var line = regionalLine(doc, today);
    var late = lateNote(doc, today);
    var barns = recent(doc, today);
    var states = [];
    barns.forEach(function (b) { if (states.indexOf(b.state) < 0) states.push(b.state); });
    var pick = '';
    try { pick = (ls && ls.getItem(KEY)) || ''; } catch (e) { pick = ''; }
    if (states.indexOf(pick) < 0) pick = '';
    var h = '<p class="cc-line" data-cc="line">' + esc(line.text) + '</p>' + (late ? '<p class="cc-late">' + esc(late) + '</p>' : '');
    var body;
    if (!barns.length) {
      body = '<p class="cc-late">No barn on this list reported a cull cow sale in the last ' + WINDOW_DAYS + ' days.</p>';
    } else {
      var sel = '<div class="cc-bar"><label>Show <select data-cc="state" aria-label="State"><option value="">All ' + barns.length +
        ' barns</option>' + states.map(function (s) {
          return '<option value="' + esc(s) + '"' + (s === pick ? ' selected' : '') + '>' + esc(STATES[s] || s) + '</option>';
        }).join('') + '</select></label><span>Each barn’s own sale day.</span></div>';
      var shown = pick ? barns.filter(function (b) { return b.state === pick; }) : barns;
      body = sel + '<div data-cc="table">' + table(shown, today) + '</div>';
      // a short section on both pages: the barn table opens on a tap (40-odd barns is a long list on a phone)
      body = '<details class="cc-all"' + (mode === 'open' ? ' open' : '') + '><summary>Every barn’s cull cow sale (' +
        barns.length + ')</summary>' + body + '</details>';
    }
    h += body + WORDS + mathBlock(doc, today) +
      '<p class="cc-src">Source: USDA AMS Livestock, Poultry and Grain ' +
      'Market News auction reports, as reported by USDA, not the barns. Barn names link to each USDA report.</p>';
    var box = el.querySelector('[data-cc="body"]') || el;
    box.innerHTML = h;
    var s = box.querySelector('[data-cc="state"]');
    if (s) {
      s.addEventListener('change', function () {
        var v = s.value;
        try { if (ls) ls.setItem(KEY, v); } catch (e) {}
        box.querySelector('[data-cc="table"]').innerHTML = table(v ? barns.filter(function (b) { return b.state === v; }) : barns, today);
      });
    }
    el.hidden = false;
  }
  function fail(el) {
    var box = el.querySelector('[data-cc="body"]') || el;
    box.innerHTML = '<p class="cc-late">Cull cow prices did not load just now. The USDA auction reports are at ' +
      'USDA Market News.</p>';
  }
  function start() {
    var doc = root.document;
    var els = doc.querySelectorAll('[data-cull-cows]');
    if (!els.length) return;
    addCss(doc);
    var ls = null;
    try { ls = root.localStorage; } catch (e) { ls = null; }
    fetch(DATA, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      var today = isoToday();
      Array.prototype.forEach.call(els, function (el) { render(el, d, today, ls); });
    }).catch(function () {
      Array.prototype.forEach.call(els, fail);
    });
  }

  root.AgCullCows = { daysBetween: daysBetween, fmtDate: fmtDate, money: money, recent: recent, avgOf: avgOf,
    regionalLine: regionalLine, lateNote: lateNote, WINDOW_DAYS: WINDOW_DAYS };
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})(this);
