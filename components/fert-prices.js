/* components/fert-prices.js: the charts on /fertilizer-prices and its state pages (Nov 20, 2026).
 * The table above each chart is baked into the page from data/fert-prices/<report>.json (scripts/fetch_fert_reports.py);
 * this draws one chart per product for the report shown, from the same file's "series": that report's own rows for
 * that product, listed the same way (name, unit, freight), so a line never joins two reports or two products.
 * The figures are in the page from the start, each in a held box (a product with fewer than MIN reports on file
 * carries a line saying so instead), so drawing a chart moves nothing below it.
 * Tests: test/fert-reports.test.mjs. */
(function (root) {
  'use strict';
  var MIN = 4;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function short(d) { return MON[+d.slice(5, 7) - 1] + ' ' + (+d.slice(8, 10)); }
  function long(d) { return short(d) + ', ' + d.slice(0, 4); }
  /* to the cent, as USDA prints it and as the table above shows it (scripts/fetch_fert_reports.py money) */
  function money(v) { return '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function cents(v) { return Math.round(v * 100) / 100; }

  /* the points for one product: [[day, low, high, avg]] -> [{d, v, lo, hi}] */
  function points(rows) {
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      return Array.isArray(r) && /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && typeof r[3] === 'number' && r[3] > 0;
    }).map(function (r) { return { d: r[0], v: r[3], lo: r[1], hi: r[2] }; });
  }

  /* the headline from the points shown: first and last point of the same line */
  function head(region, label, pts) {
    // "the same as" only when the move is zero to the cent: the table's own test (change_text)
    var a = pts[0], b = pts[pts.length - 1], by = cents(b.v - a.v);
    return label + ' in ' + region + ': ' + money(b.v) + ' a ton on ' + short(b.d) + ', ' + (by ? (by > 0 ? 'up ' : 'down ') + money(by) : 'the same as') + ' from ' + money(a.v) + ' on ' + long(a.d) + '.';
  }

  function config(doc, p, pts) {
    return {
      series: [{ key: 'avg', name: p.label + ' average', points: pts, color: 'var(--gold,#d4a23f)', card: '#e0ac45' }],
      unit: '$/ton', fmt: money, gaps: { weekly: 10, biweekly: 21, monthly: 45 }[doc.cadence] || 21,
      ranges: [{ label: 'All', days: 0, aria: 'every report on file' }], range: 'All', minPoints: MIN,
      height: { phone: 190, wide: 240 },
      story: function (view) {
        var s = view.series[0].points;
        if (!s.length) return { head: '', summary: '' };
        var h = head(doc.region, p.label, s);
        return { head: h, summary: h + ' Dealer asking price, average, dollars per ton. Source: ' + doc.source + '.' };
      },
      readout: function (view, d) {
        var q = pts.filter(function (x) { return x.d === d; })[0];
        if (!q) return '';
        return long(d) + ': average ' + money(q.v) + (q.lo === q.hi ? ', one price' : ', range ' + money(q.lo) + ' to ' + money(q.hi));
      },
      share: { url: 'https://agsist.com/fertilizer-prices', title: doc.region + ' ' + p.label + ' price', file: 'agsist-fertilizer-' + doc.id + '-' + p.key + '-' + doc.published + '.png',
        kicker: doc.region + ' ' + p.label, date: doc.published, source: 'Dealer asking price, $ per ton, ' + p.freight + ' · ' + doc.source }
    };
  }

  /* the page holds a figure per product (scripts/fetch_fert_reports.py figures()); a held box gets its chart */
  function draw(box, doc) {
    var K = root.AgChart;
    (doc.products || []).forEach(function (p) {
      var fig = box.querySelector('.fp-chart[data-k="' + p.key + '"]'), pts = points((doc.series || {})[p.key]);
      if (!fig || fig.getAttribute('data-drawn')) return;
      var plot = fig.querySelector('.fp-plot');
      fig.setAttribute('data-drawn', '1');
      if (!K || pts.length < MIN) { plot.innerHTML = '<p class="fp-few">The chart did not load.</p>'; return; }
      var cfg = config(doc, p, pts);
      cfg.headEl = fig.querySelector('h3');
      K.mount(plot, cfg);
    });
  }

  /* the file did not come (or is not this report's): every held box says so, never stays blank */
  function failed(box) {
    [].forEach.call(box.querySelectorAll('.fp-chart[data-k]:not([data-drawn]) .fp-plot'), function (plot) {
      plot.innerHTML = '<p class="fp-few">The chart did not load.</p>';
    });
  }

  var loaded = {};
  function show(id) {
    var box = id && root.document.querySelector('.fp-charts[data-rep="' + id + '"]');
    if (!box || loaded[id] || !box.querySelector('.fp-plot')) return;
    loaded[id] = 1;
    root.fetch('/data/fert-prices/' + id + '.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (doc) { if (doc && doc.id === id) draw(box, doc); else failed(box); })
      .catch(function () { failed(box); });
  }

  var api = { points: points, head: head, config: config, failed: failed, MIN: MIN };
  root.AgFertPrices = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (root.document && root.fetch) {
    root.addEventListener('fp-report', function (e) { show(e.detail); });
    var start = function () {
      var ps = root.document.querySelectorAll('.fp-panel');
      for (var i = 0; i < ps.length; i++) if (!ps[i].hidden) show(ps[i].getAttribute('data-rep'));
    };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start); else start();
  }
})(typeof window !== 'undefined' ? window : this);
