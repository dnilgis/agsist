/* components/ys-farmbill.js: /farm-bill lines of the "Your area" box (components/your-state.js). */
(function (Y) {
  'use strict';
  var h = Y.h;
  function build(o, st, name, out, src) {
    var a = o.d['arc-plc'], stats = h.stat(o.d['state-stats'], st), dy = a && a.default_year, n = 0;
    out.push((o.loc.county ? '<b>' + h.esc(o.loc.county) + '</b>, ' + h.esc(name) + ': ' : '') + h.countyLink(o.loc, name) + ' Your base acres and PLC yield are on your FSA farm records; we do not have them.');
    var yr = dy && (h.isoToday(o.now, 'America/Chicago') <= dy.until ? dy.before : dy.then), Y0 = a && a.years && a.years[yr];
    if (!Y0) return;
    [['corn', 'Corn', 'corn_acres_planted'], ['soybeans', 'Soybeans', 'bean_acres_planted'], ['wheat', 'Wheat', 'wheat_prod']].forEach(function (c) {
      var k = Y0.crops && Y0.crops[c[0]], e = k && k.erp && k.erp.erp, u = k && k.scen && k.scen.usda;
      if (typeof e !== 'number' || (stats && !(stats[c[2]] > 0))) return;
      var s = '<b>' + c[1] + '</b>' + (stats && c[0] !== 'wheat' ? ' (' + stats[c[2]].toFixed(1) + ' million acres planted in ' + h.esc(name) + ', ' + stats.year + ')' : '') +
        ': ' + yr + ' PLC pays below ' + h.money(e) + ' a bushel, the effective reference price (the 2025 law set ' + h.money(k.statutory) + ', up from ' + h.money(k.prior_statutory) + ').';
      if (typeof u === 'number') {
        /* PLC rate = effective reference price - the higher of the season-average price and the loan rate */
        var rate = Math.round(Math.max(0, e - Math.max(u, k.loan || 0)) * 100) / 100;
        s += ' At USDA’s ' + h.money(u) + ' season-average price (' + h.esc(k.scen.usda_date || '') + '), ' + (rate > 0 ? 'the PLC rate is ' + Math.round(rate * 100) + '¢ a bushel of your PLC yield, paid on ' + Math.round((a.params && a.params.payment_acres_pct || 0.85) * 100) + '% of base acres.' : 'no PLC payment.');
      }
      out.push(s); n++;
    });
    if (n) { out.push('Neither farm bill reopens these prices.'); src.push('FSA and P.L. 119-21, via AGSIST ARC/PLC data updated ' + h.day(a.updated) + (stats ? '; NASS planted acres' : '')); }
  }
  Y.mode('farmbill', { files: ['arc-plc', 'state-stats'], build: build });
})(typeof module === 'object' && module.exports ? require('./your-state.js') : window.AGSIST_YOUR_STATE);
