/* components/fert-sources.js -- the price sources on /fertilizer.
 *
 *   1. data/fertilizer-prices.json (scripts/build_fert_prices.py): the one
 *      list every page prices from. Each product is the middle cash price of
 *      the co-ops that post it (data/fertilizer-coops.json), or, where the
 *      co-ops do not cover it, the USDA AMS Illinois average
 *      (data/fertilizer-ams.json). The pipeline makes that choice; this file
 *      only turns the rows into the calculator's rows. Until 2026-10-15 a
 *      hand-typed dealer sheet was merged in here; it is gone.
 *   2. data/fertilizer-ams.json for the USDA box: the report's average, its
 *      range and its date.
 *
 * RULES
 *   * Until a file exists and holds at least one real price, nothing about it
 *     is drawn: no box, no placeholder figure, no "coming soon".
 *   * Every row says which source and which date it is.
 *   * Nothing is averaged across sources here, and a price is never moved to
 *     a date it was not posted on.
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

  /* The AMS file, or null when it is missing, undated or holds no real price. */
  function validAms(a) {
    if (!a || !isDate(a.report_date) || !Array.isArray(a.products)) return null;
    var ps = a.products.filter(function (p) {
      return p && p.key && p.symbol && good(p.avg) && good(p.low) && good(p.high) && p.low <= p.avg && p.avg <= p.high;
    });
    if (!ps.length) return null;
    var out = {};
    for (var k in a) if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k];
    out.products = ps;
    return out;
  }

  /* data/fertilizer-prices.json -> [{name, symbol, price, as_of, src, srcLabel}]
     in the file's order. A row without a real price or date is left out. */
  function rows(prices) {
    return ((prices && prices.prices) || []).filter(function (p) {
      return p && p.name && p.symbol && good(p.price) && isDate(p.as_of);
    }).map(function (p) {
      return { key: p.key, name: p.name, symbol: p.symbol, price: p.price, as_of: p.as_of, src: p.src, region: p.region || null,
        other: p.other || null,
        srcLabel: p.src_label || (p.src === 'ams' ? 'USDA Illinois average, ' + shortDate(p.as_of) : shortDate(p.as_of)) };
    });
  }

  /* The note under "Cheapest of the products priced here". */
  function coverNote(prices) {
    var r = rows(prices);
    if (!r.length) return 'No product has a live price right now.';
    function list(xs) { return xs.length < 3 ? xs.join(' and ') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; }
    var groups = {}, order = [];
    r.forEach(function (x) {
      var g = x.src === 'coop' ? (x.region || 'Co-op') + ' co-ops&rsquo; middle cash price' : 'USDA ' + (x.region || 'Illinois') + ' average';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(x.name);
    });
    return order.map(function (g) { return list(groups[g]) + ': ' + g + '.'; }).join(' ') +
      ' Each product uses whichever source posted more recently; each price names its region and date.';
  }

  /* The USDA box. '' when there is nothing real to show. */
  function amsBox(ams, today) {
    var a = validAms(ams);
    if (!a) return '';
    var days = null;
    if (today) { var t = Date.parse(a.report_date + 'T12:00:00Z'); if (!isNaN(t)) days = Math.floor((today - t) / 86400000); }
    var cards = a.products.map(function (p) {
      return '<div class="fert-price-card fert-ams-card"><div class="fpc-head"><span class="fpc-name">' + esc(p.name) +
        '</span><span class="fpc-sym">' + esc(p.symbol) + '</span></div><div class="fpc-price">$' + Math.round(p.avg).toLocaleString('en-US') +
        '</div><div class="fpc-unit">$/ton, average</div><div class="fpc-loc">' + (Math.round(p.low) === Math.round(p.high)
          ? 'one price reported'
          : 'range $' + Math.round(p.low).toLocaleString('en-US') + ' to $' + Math.round(p.high).toLocaleString('en-US')) + '</div></div>';
    }).join('');
    return '<h2 class="fert-related-title" id="fert-ams-h">USDA Illinois average, ' + esc(shortDate(a.report_date, true)) + '</h2>' +
      '<p class="fert-ams-sub">From the <a href="' + esc(a.page || a.url) + '" target="_blank" rel="noopener">USDA AMS Illinois Production Cost Report</a> ' +
      '(<a href="' + esc(a.url) + '" target="_blank" rel="noopener">PDF</a>), which comes out every other week. Report dated ' + esc(shortDate(a.report_date, true)) +
      (days != null && days > 21 ? ', ' + days + ' days ago' : '') + '.' +
      (a.terms ? ' Its prices are labeled &ldquo;' + esc(a.terms) + '&rdquo;.' : '') + '</p>' +
      '<div class="fert-cards">' + cards + '</div>';
  }

  var api = { validAms: validAms, rows: rows, coverNote: coverNote, amsBox: amsBox, shortDate: shortDate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FertSources = api;
})(typeof window !== 'undefined' ? window : this);
