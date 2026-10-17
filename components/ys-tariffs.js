/* components/ys-tariffs.js: /tariffs lines of the "Your area" box (components/your-state.js). */
(function (Y) {
  'use strict';
  var h = Y.h;
  /* cents to a board's quarter: 56.5 -> "56½" (as components/your-area.js prints it) */
  function qc(c) {
    var q = Math.round(Math.abs(c) * 4) / 4, w = Math.floor(q), f = Math.round((q - w) * 100);
    return (w || !f ? String(w) : '') + { 0: '', 25: '¼', 50: '½', 75: '¾' }[f];
  }
  function build(o, st, name, out, src) {
    var stats = h.stat(o.d['state-stats'], st), w = o.d.wasde && o.d.wasde.wasde_pdf, bs = o.d['basis-states'];
    var bst = bs && bs.states && bs.states[st], bok = bst && h.age(bs.generated, o.now) <= 10, used = false, based = false;
    [['soybeans', 'bean', 'Soybeans'], ['corn', 'corn', 'Corn']].forEach(function (c) {
      var s = '', U = w && w.crops && w.crops[c[0]], p = U && U.production, sp = stats && stats[c[1] + '_prod'], b = bok && bst.crops && bst.crops[c[0]];
      if (stats && stats.forecast && p && typeof sp === 'number' && String(stats.forecast_month || '').indexOf(U.month) === 0 && String(U.marketing_year || '').indexOf(String(stats.year)) === 0) {
        var us = p.unit === 'bil bu' ? p.value * 1000 : p.unit === 'mil bu' ? p.value : NaN;
        if (us > 0) { s = h.esc(name) + '’s crop, ' + h.commas(sp, 0) + ' million bu, is ' + (Math.round(sp / us * 1000) / 10).toFixed(1) + '% of the ' + h.commas(us, 0) + ' million bu US crop.'; used = true; }
      }
      if (b && typeof b.median === 'number' && isFinite(b.median)) {
        var cc = Math.round(b.median * 1e6) / 1e4;
        s += (s ? ' ' : '') + 'Basis ' + (Math.abs(cc) < 0.125 ? 'even with' : qc(cc) + '¢ ' + (cc < 0 ? 'under' : 'over')) + ' ' + h.esc(b.label || b.contract) +
          (typeof b.wow === 'number' && b.wow ? ', ' + qc(b.wow) + '¢ ' + (b.wow > 0 ? 'stronger' : 'weaker') + ' on the week' : '') + ' (' + b.n + ' elevator' + (b.n === 1 ? '' : 's') + ').';
        based = true;
      }
      if (s) out.push('<b>' + c[2] + '</b>: ' + s);
    });
    if (used) src.push('USDA ' + h.esc(stats.forecast_month) + ' state forecast and WASDE, ' + h.day(w.date || ''));
    if (based) src.push('Median basis of AGSIST network elevators in ' + h.esc(name) + ', bids as of ' + h.day(bs.generated));
    out.push('A China tariff is national. It reaches ' + h.esc(name) + ' through futures and basis. USDA does not publish exports by state, so no state export share is printed here.');
    if (bst && bst.path) o.links.push('<a href="' + h.esc(bst.path) + '">' + h.esc(name) + ' basis map</a>');
  }
  Y.mode('tariffs', { files: ['state-stats', 'wasde', 'basis-states'], build: build });
  Y.qc = qc;
})(typeof module === 'object' && module.exports ? require('./your-state.js') : window.AGSIST_YOUR_STATE);
