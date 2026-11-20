/* components/fert-prices.js: the charts on /fertilizer-prices and its state pages (Nov 20, 2026).
 * The table above each chart is baked into the page from data/fert-prices/<report>.json (scripts/fetch_fert_reports.py);
 * this draws one chart per product for the report shown, from the same file's "series": that report's own rows for
 * that product, listed the same way (name, unit, freight), so a line never joins two reports or two products.
 * A product with fewer than MIN reports on file gets a line saying so instead of a chart.
 * Tests: test/fert-reports.test.mjs. */
(function (root) {
  'use strict';
  var MIN = 4;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function short(d) { return MON[+d.slice(5, 7) - 1] + ' ' + (+d.slice(8, 10)); }
  function long(d) { return short(d) + ', ' + d.slice(0, 4); }
  function money(v) { return '$' + Math.round(v).toLocaleString('en-US'); }

  /* the points for one product: [[day, low, high, avg]] -> [{d, v, lo, hi}] */
  function points(rows) {
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      return Array.isArray(r) && /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && typeof r[3] === 'number' && r[3] > 0;
    }).map(function (r) { return { d: r[0], v: r[3], lo: r[1], hi: r[2] }; });
  }

  /* the headline from the points shown: first and last point of the same line */
  function head(region, label, pts) {
    var a = pts[0], b = pts[pts.length - 1], by = Math.round(b.v - a.v);
    return label + ' in ' + region + ': ' + money(b.v) + ' a ton on ' + short(b.d) + ', ' + (by ? (by > 0 ? 'up ' : 'down ') + money(Math.abs(by)) : 'the same as') + ' from ' + money(a.v) + ' on ' + long(a.d) + '.';
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

  function draw(box, doc) {
    var K = root.AgChart;
    box.innerHTML = (doc.products || []).map(function (p, i) {
      return '<figure class="fp-chart" data-k="' + esc(p.key) + '"><h3 id="fp-ch-' + esc(doc.id) + '-' + i + '"></h3><div class="fp-plot"></div></figure>';
    }).join('');
    (doc.products || []).forEach(function (p, i) {
      var fig = box.children[i], pts = points((doc.series || {})[p.key]), h = fig.querySelector('h3');
      if (pts.length < MIN || !K) {
        h.textContent = p.label + ' in ' + doc.region;
        fig.querySelector('.fp-plot').innerHTML = '<p class="fp-few">' + (K ? 'A chart shows once ' + MIN + ' reports with this product are on file (' + pts.length + ' so far).' : 'The chart did not load.') + '</p>';
        return;
      }
      var cfg = config(doc, p, pts);
      cfg.headEl = h;
      K.mount(fig.querySelector('.fp-plot'), cfg);
    });
  }

  var loaded = {};
  function show(id) {
    var box = root.document.querySelector('.fp-charts[data-rep="' + id + '"]');
    if (!box || loaded[id]) return;
    loaded[id] = 1;
    root.fetch('/data/fert-prices/' + id + '.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (doc) { if (doc && doc.id === id) draw(box, doc); })
      .catch(function () { loaded[id] = 0; });
  }

  var api = { points: points, head: head, config: config, MIN: MIN };
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
