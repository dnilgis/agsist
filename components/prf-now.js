/* components/prf-now.js: the "This interval so far" card on /prf and the PRF
   county pages.

   WHAT IT SHOWS, for one grid, for each pair of months still open
     * rain so far (NOAA CPC's real-time daily gauge analysis) against the
       grid's average for the whole interval in RMA's record
     * the index so far: rain so far / that average x 100, preliminary
     * the days left, and for each coverage level, the rain still to come that
       would lift the index to that level (a policy at that level pays only
       when the final index ends under it)
     * how close CPC has come to RMA's final index in the backtest
   An interval that has ended and that RMA has not published yet shows the
   CPC total for the whole interval, labeled as an estimate.

   WHAT IT WILL NOT SAY
     * a forecast. The index so far only counts rain that has fallen.
     * any number when CPC's newest day is more than MAX_AGE days old, when a
       grid has a gap in CPC's data, or for an interval the builder withheld.
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
        left: left > 0 ? left : 0, ended: left <= 0, withheld: m.withheld || null };
      if (!iv.withheld) {
        var p = cell && cell[0] != null ? cell[0] / 10 : null, a = cell && cell[1] != null ? cell[1] / 10 : null;
        if (p == null || !a) iv.withheld = 'CPC has a gap at this grid in these months, so there is no number for it.';
        else {
          iv.precipIn = inches(p); iv.avgIn = inches(a); iv.index = indexSoFar(p, a);
          iv.need = COV.map(function (c) { var r = rainToReach(p, a, c); return { cov: c, mm: r, inches: inches(r) }; });
        }
      }
      out.ivs.push(iv);
    }
    return out;
  }

  function accLine(acc) {
    if (!acc || !acc.n) return 'Not yet checked against RMA&rsquo;s final index, so how close it runs is not known.';
    return 'How close this has run: over ' + acc.n.toLocaleString('en-US') + ' grid and interval pairs (' + acc.grids +
      ' grids, ' + acc.first + ' to ' + acc.last + '), CPC&rsquo;s total for the whole interval landed a median ' +
      acc.median_abs.toFixed(1) + ' points from RMA&rsquo;s final index, and within ' + acc.p90_abs.toFixed(1) +
      ' points 9 times in 10.';
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function ivHtml(iv, through) {
    var h = '<div class="pn-iv"><h3 class="pn-iv-h">' + esc(iv.long) + ' ' + iv.y + '</h3>';
    if (iv.ended) h += '<p class="pn-when">Ended ' + fmtDate(iv.to) + '. RMA has not published the final index yet.</p>';
    else h += '<p class="pn-when">Day ' + (iv.days - iv.left) + ' of ' + iv.days + ', ' + iv.left + (iv.left === 1 ? ' day' : ' days') + ' left (to ' + fmtDate(iv.to) + ').</p>';
    if (iv.withheld) return h + '<p class="pn-held">' + esc(iv.withheld) + '</p></div>';
    h += '<dl class="pn-figs">' +
      '<div><dt>' + (iv.ended ? 'Rain, whole interval' : 'Rain so far') + '</dt><dd>' + fmtIn(iv.precipIn) + '</dd></div>' +
      '<div><dt>Average, whole interval</dt><dd>' + fmtIn(iv.avgIn) + '</dd></div>' +
      '<div><dt>' + (iv.ended ? 'Index, estimate' : 'Index so far') + '</dt><dd>' + iv.index.toFixed(1) + ' <span class="pn-pre">preliminary</span></dd></div>' +
      '</dl>';
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
    if (m.state === 'nodata') return '<p class="pn-held">The interval so far shows here after the first read of NOAA&rsquo;s daily rain.</p>';
    if (m.state === 'nogrid') return '<p class="pn-held">No interval-so-far numbers for grid ' + esc(m.grid) + ' in this file.</p>';
    var h = '';
    if (m.state === 'stale') return '<p class="pn-held">NOAA&rsquo;s newest day here is ' + fmtDateY(m.through) + ', more than ' + MAX_AGE + ' days ago, so the numbers are held back until it updates.</p>';
    m.ivs.forEach(function (iv) { h += ivHtml(iv, m.through); });
    h += '<p class="pn-fine pn-src"><b>An estimate, not RMA&rsquo;s index.</b> Rain from NOAA CPC&rsquo;s real-time daily gauge analysis through ' + fmtDateY(m.through) +
      ' (preliminary; CPC reworks each day once more gauges report). The final index RMA publishes can differ. The index so far counts only rain that has fallen against the whole interval&rsquo;s average, so it climbs as the interval goes on. It is not a forecast. ' +
      accLine(m.acc) + ' RMA moves the index to NOAA NCEI&rsquo;s nClimGrid from crop year 2027. ' +
      '<a href="https://ftp.cpc.ncep.noaa.gov/precip/CPC_UNI_PRCP/GAUGE_CONUS/" rel="noopener">CPC data</a></p>';
    return h;
  }

  var api = { model: model, render: render, indexSoFar: indexSoFar, rainToReach: rainToReach, accLine: accLine, MAX_AGE: MAX_AGE };
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
    '.pn-need{border-collapse:collapse;font-size:.9rem;margin:0 0 .3rem;font-variant-numeric:tabular-nums}' +
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

    function show() {
      if (!cur.st || !cur.grid) { el.hidden = true; return; }
      el.hidden = false;
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
