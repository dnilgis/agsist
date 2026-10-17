/* components/ys-cattle.js: /cattle-futures-prices lines of the "Your area" box (components/your-state.js). */
(function (Y) {
  'use strict';
  var h = Y.h, NEAR = 250;
  function miles(a, b) {
    var r = Math.PI / 180, x = Math.sin((b.lat - a.lat) * r / 2), y = Math.sin((b.lon - a.lon) * r / 2);
    return 7917.6 * Math.asin(Math.min(1, Math.sqrt(x * x + Math.cos(a.lat * r) * Math.cos(b.lat * r) * y * y)));
  }
  function build(o, st, name, out, src) {
    var A = o.d['cattle-auction'], q = o.d.prices && o.d.prices.quotes && o.d.prices.quotes['feeders-nearby'], p = o.loc, geo = p.lat !== null, list = [];
    (A && A.barns || []).forEach(function (b) {
      var s = b.sales && b.sales[0], mi = geo && typeof b.lat === 'number' ? miles(p, b) : null;
      if (s && s.classes && h.age(s.date, o.now) <= 21 && (geo ? mi !== null && mi <= NEAR : b.state === st)) list.push({ b: b, s: s, mi: mi });
    });
    list.sort(function (x, y) { return geo ? x.mi - y.mi : x.s.date < y.s.date ? 1 : -1; });
    var board = q && typeof q.close === 'number' && h.age(q.close_date, o.now) <= 5 ? q : null, k = board && h.esc(board.contract || 'nearby'), n = 0;
    list.slice(0, 3).forEach(function (x) {
      var c = x.s.classes['steers|1-2'] ? 'steers|1-2' : 'steers|1', K = x.s.classes[c] || {}, parts = [], e = K['800'];
      [['500', '5-weight'], ['800', '8-weight']].forEach(function (w) { var r = K[w[0]]; if (r && r.cwt) parts.push(w[1] + ' steers ' + h.money(r.cwt) + '/cwt (' + r.head + ' head)'); });
      if (!parts.length) return;
      var s = '<b>' + h.esc(x.b.town + ', ' + x.b.state) + '</b>' + (geo ? ', ' + Math.round(x.mi) + ' mi' : '') + ', sale ' + h.day(x.s.date) + ': ' + parts.join(', ') + ', Medium and Large ' + c.slice(7) + '.';
      var set = board && board.settles && board.settles[x.s.date];
      if (typeof set === 'number' && e && e.cwt) {
        set = Math.round(set * 100) / 100;
        var d = Math.round((e.cwt - set) * 100) / 100;
        s += ' 8-weights were ' + h.money(d) + ' ' + (d < 0 ? 'under' : 'over') + ' ' + k + ' feeder futures (' + h.money(set) + ') that day.';
      }
      out.push(s); n++;
    });
    if (!n) out.push('No sale barn in the USDA reports we read ' + (geo ? 'is within ' + NEAR + ' miles of you' : 'is in ' + h.esc(name)) + ' with a sale in the last three weeks.');
    if (board) out.push('Feeder futures, ' + k + ', settled ' + h.money(board.close) + ' on ' + h.day(board.close_date) + '. A barn average is not the CME index; the gap is AGSIST arithmetic, same day only.');
    if (n) src.push('USDA AMS auction reports, each barn’s latest sale' + (geo ? '; straight-line miles from your saved spot' : ''));
    if (board) src.push('CME settles as Yahoo Finance reports them');
    o.links.push('<a href="/cattle-auction-prices">Every barn and weight class &rarr;</a>');
  }
  Y.mode('cattle', { files: ['cattle-auction', 'prices'], build: build });
  Y.miles = miles;
})(typeof module === 'object' && module.exports ? require('./your-state.js') : window.AGSIST_YOUR_STATE);
