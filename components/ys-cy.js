/* components/ys-cy.js: /conditions-yield lines of the "Your area" box (components/your-state.js). */
(function (Y) {
  'use strict';
  var h = Y.h;
  function build(o, st, name, out, src) {
    var stats = h.stat(o.d['state-stats'], st), fit = o.d['cond-yield/fit'], yr = new Date(o.now).getUTCFullYear(), any = false;
    if (stats) {
      var sl = h.statLine(stats, name), fy = stats.year - 1, f = [];
      [['corn', 'nass/corn-yield'], ['soybeans', 'nass/soy-yield']].forEach(function (c) {
        var v = h.finals(o.d[c[1]], name);
        if (v && h.num(v[fy])) f.push(c[0] + ' ' + h.num(v[fy]));
      });
      if (sl) { out.push('<b>' + sl.replace(' (', '</b> (') + (f.length ? ' ' + fy + ' finals: ' + f.join(', ') + '.' : '')); src.push('USDA NASS state forecast, ' + h.nassDay(stats) + (f.length ? '; NASS finals' : '')); }
    }
    [['corn', 'Corn'], ['soybeans', 'Soybeans']].forEach(function (c) {
      var S = fit && fit.crops && fit.crops[c[0]] && fit.crops[c[0]].states && fit.crops[c[0]].states[st], L = S && S.latest, wk = 0, w;
      if (!L || L.year !== yr || typeof L.ge !== 'number') return;
      /* ISO week -> its Sunday, the day NASS's week ends */
      var j4 = Date.UTC(yr, 0, 4), end = new Date(j4 + ((7 - (new Date(j4).getUTCDay() || 7)) + (L.week - 1) * 7) * 864e5).toISOString().slice(0, 10);
      if (h.age(end, o.now) > 21) return;
      Object.keys(S.weeks || {}).forEach(function (k) { if (+k <= L.week && +k > wk) wk = +k; });
      w = wk && S.weeks[wk];
      var s = '<b>' + c[1] + '</b> rated ' + h.num(L.ge) + '% good/excellent in ' + h.esc(name) + ', week ending ' + h.day(end) + '.';
      if (w && typeof w.r2 === 'number') {
        var r2 = w.r2;
        s += (wk === L.week ? ' At this week' : ' At week ' + wk + ', the latest with enough years') + ', ' + h.esc(name) + '’s rating has explained ' + Math.round(r2 * 100) +
          '% of how its final yield landed against trend (' + (r2 < 0.25 ? 'mostly noise' : r2 < 0.5 ? 'weak' : r2 < 0.7 ? 'meaningful' : 'strong') + ', ' + w.n + ' years).';
      }
      out.push(s); any = true;
    });
    if (any) src.push('USDA NASS weekly condition ratings; the fit is AGSIST arithmetic, in-sample, since 2000');
    out.push('Our nowcast above is national. No state yield is printed from it: there is no state-level backtest to put a band on one.');
    o.links.push('<a href="#research">' + h.esc(name) + ' in the research below</a>');
  }
  /* point the page's two state pickers at the reader's state; true once both are set */
  function after(o, doc) {
    var ok = true;
    ['cy-state', 'vp-sel'].forEach(function (id) {
      var s = doc.getElementById(id);
      if (!s || !s.querySelector('option[value="' + o.loc.state + '"]')) { ok = false; return; }
      if (s.value !== o.loc.state) { s.value = o.loc.state; s.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    return ok;
  }
  Y.mode('cy', { files: ['state-stats', 'cond-yield/fit', 'nass/corn-yield', 'nass/soy-yield'], build: build, after: after });
})(typeof module === 'object' && module.exports ? require('./your-state.js') : window.AGSIST_YOUR_STATE);
