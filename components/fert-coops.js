/* components/fert-coops.js -- "What co-ops are posting" on /fertilizer.
 *
 * Reads data/fertilizer-coops.json, written by scripts/fetch_coop_fert.py on a
 * GitHub runner (.github/workflows/fertilizer-coops.yml) from the prices farm
 * co-ops post on their own websites. Every statistic (the middle price, the
 * count, the range, stale and flagged rows) is computed there; this file only
 * draws it.
 *
 * RULES
 *   * Nothing is drawn until the file exists and holds at least one current
 *     summarized product: no box, no placeholder, no "coming soon".
 *   * A middle price shows only when the file gives one (enough co-ops).
 *     Otherwise the card shows the co-op count and the range in words.
 *   * Every co-op is named and linked to its own page. Prices are what the
 *     co-op posts; the copy says to call and confirm.
 *   * The USDA line compares like with like only where both have a figure,
 *     and says plainly that they are different measures.
 */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var BASIS = { prepay: 'pre-pay', charge: 'charge', list: 'ton price', cash: 'cash', discount: 'cash discount', cash_pickup: 'cash pickup' };

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
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function cents(n) { return Math.round(n) === n ? money(n) : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function safeUrl(u) { return /^https:\/\//.test(String(u || '')) ? String(u) : ''; }
  function list(xs) { return xs.length < 3 ? xs.join(' and ') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; }
  var WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  function count(n, one, many) { return (n < 10 ? WORDS[n] : String(n)) + ' ' + (n === 1 ? one : many); }

  /* The file, or null when it is missing or holds nothing current to show. */
  function valid(d) {
    if (!d || !Array.isArray(d.summary) || !Array.isArray(d.coops)) return null;
    var s = d.summary.filter(function (p) {
      return p && p.key && p.n >= 1 && good(p.low) && good(p.high) && p.low <= p.high &&
        (p.median == null || (good(p.median) && p.low <= p.median && p.median <= p.high)) &&
        ((isDate(p.oldest) && isDate(p.newest)) || (p.oldest == null && p.newest == null && p.undated === p.n));
    });
    if (!s.length) return null;
    var out = {};
    for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) out[k] = d[k];
    out.summary = s;
    return out;
  }

  function byId(d) { var m = {}; d.coops.forEach(function (c) { m[c.id] = c; }); return m; }

  /* The dates the co-ops show. An undated price is counted, never dated. */
  function dateSpan(p) {
    var s = !isDate(p.newest) ? '' : 'newest posted ' + shortDate(p.newest) + (p.oldest !== p.newest ? ', oldest ' + shortDate(p.oldest) : '');
    var u = p.undated > 0 ? (p.undated === p.n ? (p.n === 1 ? 'no date shown' : 'no dates shown') : p.undated + ' with no date shown') : '';
    return s && u ? s + ', ' + u : (s || u);
  }

  function card(p, coops, amsBy) {
    var big, under;
    if (p.median != null) {
      big = money(p.median);
      under = 'middle of ' + p.n + ' co-ops';
    } else if (p.n === 1) {
      var c = coops[p.coops[0]] || {};
      big = money(p.low);
      under = 'one co-op: ' + esc(c.name || '');
    } else if (Math.round(p.low) === Math.round(p.high)) {
      big = money(p.low);
      under = p.n + ' co-ops, same price';
    } else {
      big = money(p.low) + ' to ' + money(p.high);
      under = p.n + ' co-ops, too few for a middle price';
    }
    var range = p.n > 1 && p.median != null
      ? (Math.round(p.low) === Math.round(p.high) ? 'all at ' + money(p.low) : money(p.low) + ' to ' + money(p.high))
      : '';
    return '<div class="fert-price-card fert-coop-card"><div class="fpc-head"><span class="fpc-name">' + esc(p.name) +
      '</span>' + (p.symbol !== p.name ? '<span class="fpc-sym">' + esc(p.symbol) + '</span>' : '') + '</div><div class="fpc-price' + (p.median == null && Math.round(p.low) !== Math.round(p.high) ? ' fcp-range' : '') + '">' + big +
      '</div><div class="fpc-unit">$/ton cash</div><div class="fpc-loc">' + under + '</div>' + (range ? '<div class="fpc-loc">' + range + '</div>' : '') +
      '<div class="fpc-loc">' + dateSpan(p) + '</div>' +
      (amsBy && amsBy[p.key] ? '<div class="fpc-loc fcp-other">USDA Illinois avg ' + money(amsBy[p.key].avg) + ', ' + esc(shortDate(amsBy._date)) + '</div>' : '') +
      '</div>';
  }

  /* One plain line against the USDA Illinois figure already on the page. */
  function amsLine(d, ams) {
    if (!ams || !isDate(ams.report_date) || !Array.isArray(ams.products)) return '';
    var a = {};
    ams.products.forEach(function (p) { if (p && good(p.avg)) a[p.key] = p; });
    var parts = [];
    d.summary.forEach(function (p) {
      if (p.median != null && a[p.key]) parts.push(esc(p.name) + ' ' + money(p.median) + ' here, ' + money(a[p.key].avg) + ' USDA');
    });
    if (!parts.length) return '';
    return '<p class="fert-coop-ams">Against the USDA Illinois average of ' + esc(shortDate(ams.report_date, true)) + ': ' + parts.join('; ') +
      '. Not the same measure: USDA averages distributor prices in Illinois, these are retail cash prices posted by co-ops elsewhere.</p>';
  }

  function posted(c) {
    if (isDate(c.posted)) return shortDate(c.posted, true);
    var ds = c.rows.filter(function (r) { return isDate(r.date); }).map(function (r) { return r.date; }).sort();
    if (ds.length) return 'by row, to ' + shortDate(ds[ds.length - 1], true);
    return 'not shown';
  }

  function coopTable(d) {
    var rows = d.coops.map(function (c) {
      var cur = c.rows.filter(function (r) { return !r.stale && r.product !== 'other' && r.cash != null; }).length;
      var u = safeUrl(c.url);
      var name = u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(c.name) + '</a>' : esc(c.name);
      return '<tr><td class="prod">' + name + (c.town ? '<span class="fcp-town">' + esc(c.town) + '</span>' : '') +
        (c.ok === false ? '<span class="fcp-town">last read failed; older prices shown</span>' : '') + '</td><td>' + esc(c.state) +
        '</td><td>' + esc(posted(c)) + '</td><td>' + cur + '</td></tr>';
    }).join('');
    return '<div class="fert-coop-wrap"><table class="fert-nutrient-table fert-coop-table"><thead><tr><th scope="col">Co-op</th><th scope="col">State</th>' +
      '<th scope="col">Posted</th><th scope="col">Prices</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function rowWhy(r) {
    var w = [];
    if (r.stale) w.push(r.age_days != null ? r.age_days + ' days old, not counted' : 'no date, not counted');
    if (r.flags && r.flags.length) w.push(r.flags.join('; ') + ', not counted');
    if (r.far_from_others) w.push('far from the other co-ops; counted, the middle price is used');
    if (r.product === 'other' && !r.stale) w.push('not summarized');
    return w.join('; ');
  }

  function detail(d) {
    var blocks = d.coops.map(function (c) {
      var trs = c.rows.map(function (r) {
        var when = isDate(r.date) ? shortDate(r.date, true) : (isDate(r.first_seen) ? 'not shown; first seen ' + shortDate(r.first_seen, true) : 'not shown');
        if (r.date_text) when += ' (' + r.date_text + ')';
        var px = Object.keys(r.prices || {}).map(function (b) { return (BASIS[b] || b) + ' ' + cents(r.prices[b]); }).join(', ');
        var why = rowWhy(r);
        return '<li><b>' + esc(r.raw) + '</b> ' + (px || 'not posted per ton') + '<span class="fcp-when">' + esc(when) +
          (why ? '. ' + esc(why) : '') + '</span></li>';
      }).join('');
      var u = safeUrl(c.source_url || c.url);
      return '<h3 class="fert-coop-h3">' + esc(c.name) + ', ' + esc(c.state) + '</h3><p class="fert-coop-src">Read from ' +
        (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(u.replace(/^https:\/\/(www\.)?/, '')) + '</a>' : 'its site') +
        (c.fetched ? ' on ' + esc(shortDate(c.fetched.slice(0, 10), true)) : '') + '. Cash price used: ' + esc(c.cash_label || 'cash') + '.</p>' +
        '<ul class="fert-coop-rows">' + trs + '</ul>';
    }).join('');
    return '<details class="fert-coop-math"><summary>Every posted price and how the figures are made</summary>' +
      '<p class="fert-coop-src">' + esc(d.conventions || '') + ' Read ' + esc(shortDate(String(d.generated || '').slice(0, 10), true)) + '.</p>' + blocks + '</details>';
  }

  /* The whole section. '' when there is nothing real to show. */
  function farNote(d, coops) {
    var far = [];
    d.summary.forEach(function (p) {
      (p.far || []).forEach(function (id) {
        var c = coops[id];
        var r = c && c.rows.filter(function (x) { return x.product === p.key && x.far_from_others; })[0];
        if (c && r) far.push(esc(c.name) + '&rsquo;s ' + esc(p.name) + ' (' + money(r.cash) + ')');
      });
    });
    return far.length ? '<p class="fert-coop-ams">Far from the other co-ops: ' + far.join('; ') +
      '. Counted, but the middle price is shown so one sheet does not pull the figure.</p>' : '';
  }

  function credits(d) {
    return list(d.coops.map(function (c) {
      var u = safeUrl(c.url);
      return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(c.name) + '</a>' : esc(c.name);
    }));
  }

  /* The newest date any summarized co-op price shows, or null. */
  function newest(d) {
    var n = null;
    d.summary.forEach(function (p) { if (isDate(p.newest) && (!n || p.newest > n)) n = p.newest; });
    return n;
  }

  /* The line under the hero: newest posted date and the co-op count. */
  var STATE = { KS: 'Kansas', NE: 'Nebraska', OK: 'Oklahoma', IA: 'Iowa', MO: 'Missouri', IL: 'Illinois', CO: 'Colorado', TX: 'Texas', SD: 'South Dakota', ND: 'North Dakota', MN: 'Minnesota' };
  function regionOf(d) { return list(Object.keys(d.states || {}).sort().map(function (s) { return STATE[s] || s; })); }

  /* The line under the hero: which region each number is from, the newest
     posted date and the co-op count. */
  function bar(data, ams) {
    var d = valid(data);
    if (!d) return '';
    var n = newest(d), reg = regionOf(d);
    var a = ams && /^\d{4}-\d{2}-\d{2}$/.test(ams.report_date || '') ? shortDate(ams.report_date, true) : null;
    return 'Cards below: <strong>' + esc(reg || 'co-op') + '</strong> co-ops&rsquo; middle cash price, ' + count(d.coops_current, 'co-op', 'co-ops') +
      (n ? ', posted through <strong>' + esc(shortDate(n, true)) + '</strong>' : '') + '.' +
      (a ? ' USDA figures are the <strong>Illinois</strong> average, report of ' + esc(a) + '.' : '') +
      ' Read ' + esc(shortDate(String(d.generated || '').slice(0, 10), true)) + '.';
  }

  /* The top of the page: the co-op price cards. '' when there is nothing real. */
  function top(data, ams) {
    var d = valid(data);
    if (!d) return '';
    var coops = byId(d), reg = regionOf(d);
    var amsBy = null;
    if (ams && Array.isArray(ams.products) && /^\d{4}-\d{2}-\d{2}$/.test(ams.report_date || '')) {
      amsBy = { _date: ams.report_date };
      ams.products.forEach(function (x) { if (x && x.key && good(x.avg)) amsBy[x.key] = x; });
    }
    return '<h2 class="fert-related-title" id="fert-coops-h">What ' + esc(reg || '') + (reg ? ' ' : '') + 'co-ops are posting</h2>' +
      '<p class="fert-ams-sub">Read each weekday from the co-ops&rsquo; own websites. Cash is each co-op&rsquo;s own (cash, cash discount or cash pickup). Call to confirm.</p>' +
      '<div class="fert-cards">' + d.summary.map(function (p) { return card(p, coops, amsBy); }).join('') + '</div>' +
      farNote(d, coops) +
      '<p class="fert-coop-ams">Prices from ' + credits(d) + '. <a href="#fert-coops-more-h">Every co-op and every posted price</a>.</p>';
  }

  /* Lower down: the USDA line, the co-op table, every posted price. */
  function more(data, ams) {
    var d = valid(data);
    if (!d) return '';
    return '<h2 class="fert-related-title" id="fert-coops-more-h">Where the co-op prices come from</h2>' +
      amsLine(d, ams) +
      coopTable(d) +
      '<p class="fert-coop-ams">Rows over ' + esc(d.stale_days) + ' days old are listed below but not counted.</p>' +
      detail(d);
  }

  function section(data, ams) {
    var t = top(data, ams);
    return t ? t + more(data, ams) : '';
  }

  var api = { valid: valid, section: section, top: top, more: more, bar: bar, newest: newest,
    amsLine: amsLine, card: card, posted: posted, shortDate: shortDate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FertCoops = api;
})(typeof window !== 'undefined' ? window : this);
