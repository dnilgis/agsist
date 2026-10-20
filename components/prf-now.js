/* components/prf-now.js: the "This interval so far" card on /prf and the PRF
   county pages.

   WHAT IT SHOWS, for one grid, for each pair of months still open
     * rain so far (NOAA NCEI's nClimGrid on RMA's grid, the data RMA's index
       is built from) against the grid's average for the whole interval in
       RMA's record
     * the index so far: rain so far / that average x 100, preliminary
     * the days left, and for each coverage level, the rain still to come that
       would lift the index to that level (a policy at that level pays only
       when the final index ends under it)
     * which NCEI file each month came from (final, preliminary month, or
       daily so far) and how close each kind has run to RMA's final index
   An interval that has ended shows its total for the whole interval: equal
   to RMA's when both months are final, an estimate otherwise.

   WHAT IT WILL NOT SAY
     * a forecast. The index so far only counts rain that has fallen.
     * any number when NCEI's newest day is more than MAX_AGE days old, when a
       grid has a gap in NCEI's data, or for an interval the builder withheld.
     * that the current month is solid: NCEI's early daily grids ran low in the
       one month checked, and the card says by how much.
     * anything about buying, coverage choices or agents. The page is neutral.

   DATA: data/prf/now/<ST>.json (scripts/fetch_prf_season.py), fetched only
   when the card has a grid. Cells are [rain so far, average], mm x 10.

   WIRING: mounts into <section id="prf-now">. On a county page the section
   carries data-st, data-grids (comma list) and data-grid (the one to open on)
   and the card offers the county's grids. On /prf it listens for the
   `prf:grid` event (detail { grid, st }) that components/prf.js sends.
   data-src (a JSON url) and data-today (YYYY-MM-DD) are for tests only.

   Pure functions are on window.AgPrfNow (test/prf-now.test.mjs). No em dashes. */
(function (root) {
  'use strict';

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var LONG = ['January to February', 'February to March', 'March to April', 'April to May', 'May to June',
    'June to July', 'July to August', 'August to September', 'September to October', 'October to November',
    'November to December'];
  var COV = [70, 75, 80, 85, 90];
  var MAX_AGE = 10;          // days; past this the card withholds its numbers
  var MIN_AVG_MM = 5;        // the same as MIN_AVG_MM in scripts/fetch_prf_season.py
  var MM = 25.4;

  function ymd(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : null; }
  function fmtDate(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) : ''; }
  function fmtDateY(s) { var m = /^(\d{4})/.exec(s || ''); return fmtDate(s) + (m ? ', ' + m[1] : ''); }
  function inches(mm) { return mm == null ? null : mm / MM; }
  function fmtIn(x) { return x == null ? '' : x.toFixed(2) + ' in'; }

  /* The arithmetic, the same as scripts/fetch_prf_season.py. */
  function indexSoFar(p, a) { return p == null || !a ? null : Math.round(p / a * 1000) / 10; }
  function rainToReach(p, a, cov) { return p == null || !a ? null : Math.max(0, Math.round((cov / 100 * a - p) * 10) / 10); }

  /* One grid's card, as data. doc = a state file, grid = number, today = YYYY-MM-DD. */
  function model(doc, grid, today) {
    if (!doc || !doc.g) return { state: 'nodata' };
    var row = doc.g[String(grid)];
    if (!row) return { state: 'nogrid', grid: grid };
    var age = ymd(today) - ymd(doc.through);
    if (!(age >= 0) && age !== 0) age = 0;
    var out = { state: 'ok', grid: grid, through: doc.through, age: age, acc: doc.acc || null, ivs: [] };
    if (age > MAX_AGE) { out.state = 'stale'; return out; }
    for (var k = 0; k < doc.iv.length; k++) {
      var m = doc.iv[k], cell = row[k];
      var left = ymd(m.to) - ymd(doc.through);
      var iv = { name: m.name, long: LONG[m.i], y: m.y, from: m.from, to: m.to, days: m.days, have: m.have,
        left: left > 0 ? left : 0, ended: left <= 0, withheld: m.withheld || null, how: m.how || [] };
      iv.allFinal = iv.ended && iv.how.length === 2 && iv.how[0][1] === 'final' && iv.how[1][1] === 'final';
      if (!iv.withheld) {
        var p = cell && cell[0] != null ? cell[0] / 10 : null, a = cell && cell[1] != null ? cell[1] / 10 : null;
        if (p == null || !a) iv.withheld = 'NCEI has no value at this grid for part of these months, so there is no number for it.';
        else if (a < MIN_AVG_MM) iv.withheld = 'The average for these months here is under 0.2 in, too little for an index so far to mean much.';
        else {
          iv.precipIn = inches(p); iv.avgIn = inches(a); iv.index = indexSoFar(p, a);
          iv.need = COV.map(function (c) { var r = rainToReach(p, a, c); return { cov: c, mm: r, inches: inches(r) }; });
        }
      }
      out.ivs.push(iv);
    }
    return out;
  }

  var KIND = { final: 'final', initial: 'preliminary month', daily: 'daily so far' };
  function howLine(how) {
    return how.map(function (h) { return h[0] + ': ' + (KIND[h[1]] || h[1]); }).join(' &middot; ');
  }

  function accLine(acc) {
    if (!acc || !acc.final_n) return 'Not yet checked against RMA&rsquo;s final index, so how close it runs is not known.';
    var n = function (x) { return Number(x).toLocaleString('en-US'); };
    return 'How close this runs: NCEI&rsquo;s final months gave RMA&rsquo;s published index exactly in ' + n(acc.final_exact) + ' of ' + n(acc.final_n) +
      ' grid and interval pairs checked (' + acc.final_grids + ' grids, ' + acc.final_first + ' to ' + acc.final_last + '). ' +
      'A preliminary month has not been checked against its final yet. ' +
      'The daily grids for the current month ran low in ' + acc.prelim_month + ', the one month checked: a median ' + acc.prelim_pct_under +
      '% under NCEI&rsquo;s month file, under at ' + acc.prelim_share_under + '% of grids, and the ' + acc.prelim_interval + ' index moved a median ' +
      acc.prelim_median_pts.toFixed(1) + ' points (9 in 10 within ' + acc.prelim_p90_pts.toFixed(1) + ') once NCEI wrote the month. ' +
      'So rain so far in the current month is likely a low reading, and the index so far likely low with it.';
  }

  /* RMA's record now follows NOAA NCEI (its 2027 record); a 2026 policy is still paid on
     RMA's 2026 index, built from NOAA CPC. The gap is the backtest's own median (card.cpc_median_abs),
     printed only while an interval on the card is from 2026 or before. */
  function cpcLine(acc, ivs) {
    if (!acc || acc.cpc_median_abs == null) return '';
    if (!(ivs || []).some(function (iv) { return iv.y <= 2026; })) return '';
    return ' This is RMA&rsquo;s 2027 rainfall record (NOAA NCEI). A 2026 policy is paid on RMA&rsquo;s 2026 index, built from NOAA CPC data, which ran a median ' +
      Number(acc.cpc_median_abs).toFixed(1) + ' points from it on the grids checked.';
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function ivHtml(iv, through) {
    var h = '<div class="pn-iv"><h3 class="pn-iv-h">' + esc(iv.long) + ' ' + iv.y + '</h3>';
    if (iv.ended) h += '<p class="pn-when">Ended ' + fmtDate(iv.to) + '. ' + (iv.allFinal ? 'Both months are NCEI&rsquo;s final data, the same data RMA&rsquo;s index uses.' : 'Not all final yet, so this is still an estimate.') + '</p>';
    else h += '<p class="pn-when">Day ' + (iv.days - iv.left) + ' of ' + iv.days + ', ' + iv.left + (iv.left === 1 ? ' day' : ' days') + ' left (to ' + fmtDate(iv.to) + ').</p>';
    if (iv.withheld) return h + '<p class="pn-held">' + esc(iv.withheld) + '</p></div>';
    h += '<dl class="pn-figs">' +
      '<div><dt>' + (iv.ended ? 'Rain, whole interval' : 'Rain so far') + '</dt><dd>' + fmtIn(iv.precipIn) + '</dd></div>' +
      '<div><dt>Average, whole interval</dt><dd>' + fmtIn(iv.avgIn) + '</dd></div>' +
      '<div><dt>' + (iv.allFinal ? 'Index' : iv.ended ? 'Index, estimate' : 'Index so far') + '</dt><dd>' + iv.index.toFixed(1) + ' <span class="pn-pre">' + (iv.allFinal ? 'from final data' : 'preliminary') + '</span></dd></div>' +
      '</dl><p class="pn-fine pn-how">' + howLine(iv.how) + '</p>';
    if (!iv.ended) {
      h += '<table class="pn-need"><caption>More rain by ' + fmtDate(iv.to) + ' that would lift the index to each coverage level</caption>' +
        '<thead><tr><th scope="col">Coverage</th><th scope="col">Rain still to fall</th></tr></thead><tbody>';
      iv.need.forEach(function (n) {
        h += '<tr><th scope="row">' + n.cov + '%</th><td>' + (n.mm > 0 ? fmtIn(n.inches) + ' more' : 'Already there') + '</td></tr>';
      });
      h += '</tbody></table><p class="pn-fine">A policy at a coverage level pays only when the final index ends under it. Past that much more rain, that level would not pay for ' + esc(iv.name) + '.</p>';
    }
    return h + '</div>';
  }

  function render(m) {
    if (m.state === 'nodata') return '<p class="pn-held">The interval so far shows here after the first read of NOAA&rsquo;s rain data.</p>';
    if (m.state === 'nogrid') return '<p class="pn-held">No interval-so-far numbers for grid ' + esc(m.grid) + ' in this file.</p>';
    var h = '';
    if (m.state === 'stale') return '<p class="pn-held">NOAA&rsquo;s newest day here is ' + fmtDateY(m.through) + ', more than ' + MAX_AGE + ' days ago, so the numbers are held back until it updates.</p>';
    m.ivs.forEach(function (iv) { h += ivHtml(iv, m.through); });
    h += '<p class="pn-fine pn-src"><b>An estimate, not RMA&rsquo;s index.</b> Rain from NOAA NCEI&rsquo;s nClimGrid on RMA&rsquo;s grid, the data RMA builds the index from, with daily grids through ' + fmtDateY(m.through) +
      ' (NCEI runs 3 days behind). Until both months are final, the index RMA publishes can differ. The index so far counts only rain that has fallen against the whole interval&rsquo;s average, so it climbs as the interval goes on. It is not a forecast. ' +
      accLine(m.acc) + cpcLine(m.acc, m.ivs) + ' <a href="https://www.ncei.noaa.gov/pub/data/cirs/usda/" rel="noopener">NCEI data</a></p>';
    return h;
  }

  var api = { model: model, render: render, indexSoFar: indexSoFar, rainToReach: rainToReach, accLine: accLine, cpcLine: cpcLine, howLine: howLine, MAX_AGE: MAX_AGE, MIN_AVG_MM: MIN_AVG_MM };
  root.AgPrfNow = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  var CSS = '.prf-now{margin:1.2rem 0;padding:1rem 1.1rem;border:1px solid var(--border,#333);border-radius:10px;background:var(--surface,transparent)}' +
    '.prf-now h2,.prf-now>h3{margin:0 0 .35rem;font-size:1.15rem}.pn-sub{margin:0 0 .6rem;font-size:.9rem;color:var(--text-muted,#999)}' +
    '.pn-iv{padding:.7rem 0;border-top:1px solid var(--border,#333)}.pn-iv-h{margin:0 0 .2rem;font-size:1rem}' +
    '.pn-when{margin:0 0 .5rem;font-size:.9rem;color:var(--text-muted,#999)}' +
    '.pn-figs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.5rem;margin:0 0 .6rem}.pn-figs div{min-width:0}' +
    '.pn-figs dt{font-size:.78rem;color:var(--text-muted,#999)}.pn-figs dd{margin:0;font-size:1.1rem;font-weight:600;font-variant-numeric:tabular-nums}' +
    '.pn-pre{display:block;font-size:.72rem;font-weight:400;color:var(--text-muted,#999)}' +
    '.pn-need{min-width:min(100%,24rem);border-collapse:collapse;font-size:.9rem;margin:0 0 .3rem;font-variant-numeric:tabular-nums}' +
    '.pn-need caption{text-align:left;font-size:.85rem;color:var(--text-muted,#999);padding-bottom:.25rem}' +
    '.pn-need th,.pn-need td{padding:.15rem .9rem .15rem 0;text-align:left;font-weight:400}.pn-need thead th{font-size:.78rem;color:var(--text-muted,#999)}' +
    '.pn-fine{font-size:.8rem;color:var(--text-muted,#999);margin:.3rem 0 0}.pn-src{border-top:1px solid var(--border,#333);padding-top:.6rem}' +
    '.pn-held{font-size:.9rem;color:var(--text-muted,#999)}.pn-pick{margin:0 0 .5rem;font-size:.9rem}.pn-pick select{margin-left:.35rem;max-width:100%}' +
    '@media (max-width:480px){.pn-figs{grid-template-columns:1fr 1fr}}';

  var docs = {};
  function load(st, src) {
    var url = src || ('/data/prf/now/' + st + '.json');
    if (!docs[url]) docs[url] = fetch(url, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return docs[url];
  }
  function todayStr(el) {
    if (el.dataset.today) return el.dataset.today;
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function start() {
    var el = document.getElementById('prf-now');
    if (!el) return;
    if (!document.getElementById('prf-now-css')) {
      var s = document.createElement('style'); s.id = 'prf-now-css'; s.textContent = CSS; document.head.appendChild(s);
    }
    var body = el.querySelector('[data-pn-body]');
    if (!body) { body = document.createElement('div'); body.setAttribute('data-pn-body', ''); el.appendChild(body); }
    var pick = el.querySelector('[data-pn-pick]');
    var cur = { st: el.dataset.st || '', grid: el.dataset.grid || '' };

    /* On /prf the card sits in a folded row of step 4 (details.prf-d, Oct 20): the row shows when the card does. */
    var row = el.closest ? el.closest('details.prf-d') : null;
    function show() {
      if (!cur.st || !cur.grid) { el.hidden = true; if (row) row.hidden = true; return; }
      el.hidden = false; if (row) row.hidden = false;
      if (pick) { var sel = pick.querySelector('select'); if (sel) sel.value = String(cur.grid); }
      load(cur.st, el.dataset.src).then(function (doc) {
        body.innerHTML = render(model(doc, +cur.grid, todayStr(el)));
      });
    }
    var grids = (el.dataset.grids || '').split(',').filter(Boolean);
    if (pick && grids.length > 1) {
      var sel = document.createElement('select');
      sel.id = 'prf-now-grid';
      grids.forEach(function (g) { var o = document.createElement('option'); o.value = g; o.textContent = 'Grid ' + g; sel.appendChild(o); });
      var lab = document.createElement('label'); lab.htmlFor = 'prf-now-grid'; lab.textContent = 'Your grid';
      pick.appendChild(lab); pick.appendChild(sel); pick.hidden = false;
      sel.addEventListener('change', function () { cur.grid = sel.value; show(); });
    }
    document.addEventListener('prf:grid', function (ev) {
      var d = ev.detail || {};
      if (!d.grid || !d.st) return;
      cur = { st: d.st, grid: String(d.grid) };
      var h = el.querySelector('[data-pn-grid]'); if (h) h.textContent = 'Grid ' + d.grid;
      show();
    });
    var S = root.AgPrf && root.AgPrf.state;
    if (!cur.grid && S && S.grid && S.st) cur = { st: S.st, grid: String(S.grid) };
    show();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : globalThis);
