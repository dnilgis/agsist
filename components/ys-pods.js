/* components/ys-pods.js: /pod-counts lines of the "Your area" box (components/your-state.js). */
(function (Y) {
  'use strict';
  var h = Y.h, BU = 0.0227, BAND = 6;
  function build(o, st, name, out, src) {
    var t = o.d['crop-tour'], T = h.tour(t, st), x = T.me, stats = h.stat(o.d['state-stats'], st), H = t && t.state_history && t.state_history[st] || [];
    if (!t) return;
    var ok = stats && stats.forecast && typeof stats.bean_yield === 'number';
    if (!x || typeof x.s.pods !== 'number' || !H.length) {
      out.push('<b>The tour does not count pods in ' + h.esc(name) + '.</b> Its states: ' + h.esc(T.names) + '.');
      if (ok) { out.push(h.usda(stats) + ': soybeans ' + h.num(stats.bean_yield) + ' bu/acre.'); src.push('USDA NASS state forecast, ' + h.nassDay(stats)); }
      return;
    }
    var yrs = H[0].year + '-' + H[H.length - 1].year, mean = H.reduce(function (a, r) { return a + r.pods; }, 0) / H.length, dp = x.s.pods - mean, bu = dp * BU;
    out.push('<b>' + h.esc(name) + '</b>: ' + t.tour.year + ' pod count ' + h.commas(x.s.pods, 2) + ' against a ' + h.commas(mean, 2) + ' average for ' + yrs + ' (' + h.sg(dp) + '). That is about ' + h.sg(bu) +
      ' bu against ' + h.esc(name) + '’s own average yield for those years, band ' + h.sg(bu - BAND) + ' to ' + h.sg(bu + BAND) + ' (AGSIST calibration, not a Pro Farmer number).');
    src.push('Pro Farmer ' + t.tour.year + ' state pod counts as published');
    var f = h.finals(o.d['nass/soy-yield'], name), v = H.map(function (r) { return f && f[r.year]; });
    if (ok && v.every(function (y) { return typeof y === 'number'; })) {
      var avg = v.reduce(function (a, y) { return a + y; }, 0) / v.length, dd = stats.bean_yield - avg;
      out.push(h.usda(stats) + ': ' + h.num(stats.bean_yield) + ' bu/acre, ' + h.sg(dd) + ' against the ' + avg.toFixed(1) + ' NASS average for ' + yrs + ', ' + (dd >= bu - BAND && dd <= bu + BAND ? 'inside' : 'outside') + ' the pod-count band.');
      src.push('NASS finals and state forecast, ' + h.nassDay(stats));
    }
    o.row = name;
  }
  /* the reader's state row to the top of the 2026 table, marked */
  function after(o, doc) {
    if (!o.row) return true;
    var rows = doc.querySelectorAll('#pc-2026 tbody tr'), i;
    for (i = 0; i < rows.length; i++) if (rows[i].cells[0] && rows[i].cells[0].textContent === o.row) {
      rows[i].className += ' hl'; rows[i].parentNode.insertBefore(rows[i], rows[i].parentNode.firstChild); return true;
    }
    return !!rows.length;
  }
  Y.mode('pods', { files: ['crop-tour', 'state-stats', 'nass/soy-yield'], build: build, after: after });
})(typeof module === 'object' && module.exports ? require('./your-state.js') : window.AGSIST_YOUR_STATE);
