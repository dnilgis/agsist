/* components/fert-sources.js -- the two price sources on /fertilizer.
 *
 *   1. Sig's dealer sheet, data/fertilizer.json, typed in by hand about once
 *      a month (scripts/update_fertilizer.py). Each row has its own as_of.
 *   2. USDA AMS "Illinois Production Cost Report (Bi-weekly)", report 3195,
 *      data/fertilizer-ams.json, written by scripts/fetch_fert_ams.py on a
 *      GitHub runner. One report date for the whole report. The page shows
 *      the report's simple average, its range and its date.
 *
 * RULES
 *   * Until the AMS file exists and holds at least one real price, nothing
 *     about it is drawn: no box, no placeholder figure, no "coming soon".
 *   * For a product both sources carry (urea, potash), the calculator and the
 *     nutrient table use whichever is NEWER by its own date. On a tie the
 *     dealer sheet stays. Every row says which source and which date it is.
 *   * Products only AMS carries (anhydrous, UAN 28, UAN 32, DAP) join the
 *     list from AMS.
 *   * Nothing is averaged across the two sources, and a price is never moved
 *     to a date it was not quoted on.
 */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /* AMS key -> the dealer sheet's name for the same product */
  var SAME = { urea: 'Urea', potash: 'Potash' };

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

  function srcLabel(row) {
    if (row.src === 'ams') return 'USDA AMS Illinois avg, ' + shortDate(row.as_of);
    return 'dealer sheet, ' + shortDate(row.as_of);
  }

  /* dealer: data/fertilizer.json's prices; ams: validAms() or null.
     -> [{name, symbol, price, as_of, src, srcLabel}] in the dealer sheet's
        order, then AMS-only products in the report's order. */
  function merge(dealer, ams) {
    var a = validAms(ams);
    var byKey = {};
    if (a) a.products.forEach(function (p) { byKey[p.key] = p; });
    var used = {};
    var rows = (dealer || []).map(function (d) {
      var row = { name: d.name, symbol: d.symbol, price: d.price, as_of: d.as_of, src: 'dealer' };
      for (var k in SAME) {
        if (SAME[k] !== d.name || !byKey[k]) continue;
        used[k] = 1;
        var dAsOf = isDate(d.as_of) ? d.as_of : '';
        if (a.report_date > dAsOf || !good(Number(d.price))) {
          row = { name: d.name, symbol: byKey[k].symbol, price: byKey[k].avg, as_of: a.report_date, src: 'ams' };
        }
      }
      row.srcLabel = srcLabel(row);
      return row;
    });
    if (a) a.products.forEach(function (p) {
      if (used[p.key]) return;
      var row = { name: p.name, symbol: p.symbol, price: p.avg, as_of: a.report_date, src: 'ams' };
      row.srcLabel = srcLabel(row);
      rows.push(row);
    });
    return rows;
  }

  /* The note under "Cheapest of the products tracked here". */
  function coverNote(ams) {
    var a = validAms(ams);
    var has = {};
    if (a) a.products.forEach(function (p) { has[p.key] = 1; });
    var got = [], miss = [];
    [['anhydrous', 'Anhydrous ammonia'], ['uan', 'UAN'], ['dap', 'DAP']].forEach(function (x) {
      var on = x[0] === 'uan' ? (has.uan28 || has.uan32) : has[x[0]];
      (on ? got : miss).push(x[1]);
    });
    function list(xs) { return xs.length < 3 ? xs.join(' and ') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; }
    if (!got.length) return 'Anhydrous ammonia, UAN and DAP are not priced on this page.';
    var s = list(got) + (got.length > 1 ? ' come' : ' comes') + ' from the USDA AMS Illinois report of ' + shortDate(a.report_date, true) + '.';
    if (miss.length) s += ' ' + list(miss) + (miss.length > 1 ? ' are' : ' is') + ' not priced on this page.';
    return s + ' Each price names its source and date.';
  }

  /* The USDA box beside the dealer sheet. '' when there is nothing real to show. */
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

  var api = { validAms: validAms, merge: merge, coverNote: coverNote, amsBox: amsBox, srcLabel: srcLabel, shortDate: shortDate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FertSources = api;
})(typeof window !== 'undefined' ? window : this);
