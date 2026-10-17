/* components/ys-tour.js: /crop-tour lines of the "Your area" box (components/your-state.js). */
(function (Y) {
  'use strict';
  var h = Y.h;
  function build(o, st, name, out, src) {
    var t = o.d['crop-tour'], T = h.tour(t, st), x = T.me, stats = h.stat(o.d['state-stats'], st), H = t && t.state_history && t.state_history[st] || [];
    if (!t) return;
    if (!x || typeof x.s.corn !== 'number') {
      out.push('<b>The tour does not sample ' + h.esc(name) + '.</b> Its states: ' + h.esc(T.names) + '.');
      if (stats && h.statLine(stats, name)) { out.push(h.statLine(stats, name)); src.push('USDA NASS state forecast, ' + h.nassDay(stats)); }
      return;
    }
    var yrs = H.length ? ' for ' + H[0].year + '-' + H[H.length - 1].year : '';
    out.push('<b>' + h.esc(name) + ' on the ' + t.tour.year + ' tour</b> (' + h.day(x.night.date) + '): corn sample ' + x.s.corn.toFixed(2) + ' bu/acre' +
      (H.length ? ', against ' + (H.reduce(function (a, r) { return a + r.corn; }, 0) / H.length).toFixed(2) + ' on average' + yrs : '') + '.');
    var f = h.finals(o.d['nass/corn-yield'], name), g = [];
    H.forEach(function (r) { if (f && typeof f[r.year] === 'number') g.push({ y: r.year, d: r.corn - f[r.year] }); });
    if (g.length) {
      var m = g.reduce(function (a, r) { return a + r.d; }, 0) / g.length;
      out.push('Against USDA’s January final, ' + h.esc(name) + '’s tour sample ran ' + Math.abs(m).toFixed(1) + ' bu ' + (m < 0 ? 'under' : 'over') + ' on average, ' + g[0].y + '-' + g[g.length - 1].y +
        ' (' + g.map(function (r) { return r.y + ': ' + h.sg(r.d); }).join(', ') + ').');
      src.push('Pro Farmer state results as published; NASS finals; the gap is AGSIST arithmetic');
    }
    if (stats && stats.forecast && typeof stats.corn_yield === 'number') {
      out.push(h.usda(stats) + ': ' + h.num(stats.corn_yield) + ' bu/acre, ' + h.sg(stats.corn_yield - x.s.corn) + ' from the tour sample.');
      src.push('USDA NASS state forecast, ' + h.nassDay(stats));
    }
  }
  Y.mode('tour', { files: ['crop-tour', 'state-stats', 'nass/corn-yield'], build: build });
})(typeof module === 'object' && module.exports ? require('./your-state.js') : window.AGSIST_YOUR_STATE);
