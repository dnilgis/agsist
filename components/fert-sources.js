/* components/fert-sources.js -- the price rows on /fertilizer.
 *
 * data/fertilizer-prices.json (scripts/build_fert_prices.py) is the one list
 * every page prices from: the middle cash price of the co-ops Sig sent that
 * post each product, and nothing else (Sig, 2026-10-15). This file only turns
 * its rows into the calculator's rows and writes the note under the
 * cheapest box. Until 2026-10-15 a hand-typed dealer sheet was merged here;
 * until 2026-10-16 it also drew a USDA AMS Illinois box. Both are gone.
 *
 * RULES
 *   * Until the file exists and holds at least one real price, nothing is
 *     drawn from it.
 *   * Every row names its co-ops, region and date.
 *   * A price is never moved to a date it was not posted on.
 */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function shortDate(iso, withYear) {
    if (!isDate(iso)) return '';
    var p = iso.split('-');
    return MON[+p[1] - 1] + ' ' + (+p[2]) + (withYear ? ', ' + p[0] : '');
  }
  function good(x) { return typeof x === 'number' && isFinite(x) && x > 0; }

  /* data/fertilizer-prices.json -> [{name, symbol, price, as_of, src, srcLabel}]
     in the file's order. A row without a real price or date is left out. */
  function rows(prices) {
    return ((prices && prices.prices) || []).filter(function (p) {
      return p && p.name && p.symbol && good(p.price) && isDate(p.as_of);
    }).map(function (p) {
      return { key: p.key, name: p.name, symbol: p.symbol, price: p.price, as_of: p.as_of, src: p.src, region: p.region || null,
        srcLabel: p.src_label || shortDate(p.as_of) };
    });
  }

  /* The note under "Cheapest of the products priced here". */
  function coverNote(prices) {
    var r = rows(prices);
    if (!r.length) return 'No product has a live price right now.';
    function list(xs) { return xs.length < 3 ? xs.join(' and ') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; }
    var groups = {}, order = [];
    r.forEach(function (x) {
      var g = (x.region || 'Co-op') + ' co-ops&rsquo; middle cash price';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(x.name);
    });
    return order.map(function (g) { return list(groups[g]) + ': ' + g + '.'; }).join(' ') +
      ' Each price names its co-ops, region and date.';
  }

  var api = { rows: rows, coverNote: coverNote, shortDate: shortDate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FertSources = api;
})(typeof window !== 'undefined' ? window : this);
