/* components/fert-sheets.js -- "Booking prices (price sheets by email)" on
 * /fertilizer.
 *
 * Reads the "sheets" list of data/fertilizer-prices.json, which
 * scripts/build_fert_prices.py copies from data/fert-sheets/*.json: price
 * sheets a co-op emailed to Sig, entered from the sheet (Sig, 2026-10-16).
 *
 * RULES
 *   * A sheet is a booking/prepay price for a coming season, not today's
 *     price. It is drawn here only, apart from every other number, and never
 *     feeds the cheapest box, the $/lb table or the calculator.
 *   * Every sheet names the co-op, region, sheet date, season and that it
 *     came by email. A row the sheet prints as n/a is listed as not priced,
 *     never as a number.
 *   * Today's co-op middle for the same product sits beside it on its own
 *     line, with its own region and date. The two are never averaged.
 *   * No current sheet: nothing is drawn. A sheet past its show_until date is
 *     not drawn even if the file was not rebuilt.
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
  function longDate(iso) {
    if (!isDate(iso)) return '';
    var p = iso.split('-');
    return MON[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0];
  }
  function good(x) { return typeof x === 'number' && isFinite(x) && x > 0; }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function cents(n) { return '$' + n.toFixed(2); }
  function list(xs) { return xs.length < 3 ? xs.join(' and ') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; }
  function localToday() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* The sheets that may be drawn today. */
  function current(doc, today) {
    today = today || localToday();
    return ((doc && doc.sheets) || []).filter(function (s) {
      return s && s.coop && s.region && isDate(s.sheet_date) && s.season && isDate(s.show_until) &&
        s.sheet_date <= today && today <= s.show_until && Array.isArray(s.rows) &&
        s.rows.some(function (r) { return r && (good(r.cash) || good(r.charge)); });
    });
  }

  /* Plain names for a printed grade, only where the sheet's label is a bare grade. */
  var KNOWN = { urea: 'urea', potash: 'potash', ams: 'ammonium sulfate' };
  function cell(v) { return good(v) ? money(v) : '<span class="fsh-na">not priced</span>'; }

  function sheetBlock(s) {
    var priced = s.rows.filter(function (r) { return r && (good(r.cash) || good(r.charge)); });
    var unpriced = s.rows.filter(function (r) { return r && !good(r.cash) && !good(r.charge); });
    var star = priced.some(function (r) { return r.changed; });
    var trs = priced.map(function (r) {
      var n = r.per_lb_n, nl = '';
      if (n && good(n.lb_n_per_ton)) {
        nl = (good(r.cash) ? cents(r.cash / n.lb_n_per_ton) : '-') + ' / ' + (good(r.charge) ? cents(r.charge / n.lb_n_per_ton) : '-');
      }
      return '<tr><td class="prod">' + (r.changed ? '<span class="fsh-star" title="price changed from the previous sheet">*</span> ' : '') +
        esc(r.raw) + (KNOWN[r.key] ? ' <span class="fcp-town">' + KNOWN[r.key] + '</span>' : '') + '</td><td>' + cell(r.cash) + '</td><td>' + cell(r.charge) + '</td><td>' + (nl || '<span class="fsh-na">n/a</span>') + '</td></tr>';
    }).join('');
    var math = priced.filter(function (r) { return r.per_lb_n && good(r.per_lb_n.lb_n_per_ton) && good(r.cash); }).map(function (r) {
      var lb = r.per_lb_n.lb_n_per_ton, pct = Math.round(lb / 20 * 10) / 10;
      return esc(r.raw) + ': ' + money(r.cash) + ' a ton / (2,000 lb x ' + pct + '% N) = ' + cents(r.cash / lb) + ' a lb of N';
    });
    var today = priced.filter(function (r) { return r.today && good(r.today.price); }).map(function (r) {
      return '<li><b>' + esc(r.raw) + '</b> on this sheet: ' + money(r.cash) + ' cash, booked for ' + esc(s.season.replace(/ booking$/i, '')) +
        '. ' + esc(r.today.region) + ' co-ops today: ' + esc(String(r.today.name).toLowerCase()) + ' ' + money(r.today.price) +
        ' a ton cash (' + esc(r.today.src_label) + ').</li>';
    });
    var applies = s.applies ? ' The sheet says: &ldquo;' + esc(s.applies) + '&rdquo;.' : '';
    return '<div class="fsh-sheet">' +
      '<h3 class="fert-coop-h3">' + esc(s.coop) + ', ' + esc(s.region) + '</h3>' +
      '<p class="fert-coop-src">' + esc(s.title || 'Price sheet') + '. Sheet dated <strong>' + esc(longDate(s.sheet_date)) + '</strong>, ' +
      esc(s.how_received) + ', entered from the sheet. ' + esc(s.season) + ' price, not today&rsquo;s price.' + applies + '</p>' +
      '<div class="fert-coop-wrap"><table class="fert-nutrient-table fert-coop-table fsh-table"><thead><tr><th scope="col">Product</th>' +
      '<th scope="col">Cash $/ton</th><th scope="col">Charge $/ton</th><th scope="col">$/lb of N<br><small>cash / charge</small></th></tr></thead><tbody>' + trs + '</tbody></table></div>' +
      (star ? '<p class="fert-coop-src">' + esc(s.star_note || '* price changed from the previous sheet') + '</p>' : '') +
      (unpriced.length ? '<p class="fert-coop-src">On the sheet but not priced yet (printed n/a): ' + esc(list(unpriced.map(function (r) { return r.raw; }))) + '.</p>' : '') +
      (math.length ? '<p class="fert-coop-src">$/lb of N from the cash price: ' + math.join('; ') + '.</p>' : '') +
      (today.length ? '<p class="fert-coop-note">Side by side, never averaged (different region, different season):</p><ul class="fert-coop-rows">' + today.join('') + '</ul>' : '') +
      ((s.notes && s.notes.length) ? '<p class="fert-coop-note">The sheet&rsquo;s own notes:</p><ul class="fert-coop-rows fsh-notes">' +
        s.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '') +
      '<p class="fert-coop-note">Call ' + esc(s.coop) + ' to confirm and to book. Shown here until ' +
      esc(longDate(s.show_until)) + '.</p></div>';
  }

  /* The whole section, or '' when no sheet is current. */
  function section(doc, today) {
    var ss = current(doc, today);
    if (!ss.length) return '';
    var seasons = {};
    ss.forEach(function (s) { seasons[s.season] = 1; });
    var ks = Object.keys(seasons);
    var head = ks.length === 1 ? ks[0].replace(/ booking$/i, '') + ' booking prices' : 'Booking prices';
    return '<h2 class="fert-related-title" id="fert-sheets-h">' + esc(head) + ' (price sheets by email)</h2>' +
      '<p class="fert-coops-sub">Price sheets a co-op emailed, entered from the sheet. These are prices to book or prepay for a coming season, ' +
      'not today&rsquo;s price, so they are kept out of the cheapest box, the cost per pound table and the calculator.</p>' +
      ss.map(sheetBlock).join('');
  }

  var api = { section: section, current: current };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FertSheets = api;
})(typeof window !== 'undefined' ? window : this);
