/* components/ethanol-bids.js: the "Ethanol plants paying" fold on /cash-bids.
   Reads data/ethanol-bids.json (scripts/fetch_ethanol_mars.py, from USDA AMS's
   National Daily Ethanol Report and National Weekly Grain Co-Products Report)
   and only formats it: every number, check and withhold is done there.
   USDA names no plants, so neither does this. A missing file or a withheld
   table says so in words; a report more than 5 days old says it is the latest
   one there is. Tests: test/ethanol-bids.test.mjs. */
(function (root) {
  'use strict';
  var FR = { 0: '', 25: '¼', 50: '½', 75: '¾' }, OLD_DAYS = 5;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  /* $4.3575 -> $4.35 3/4 (USDA prints quarter cents) */
  function bid(p) {
    var q = Math.round(p * 400) / 4, c = Math.floor(q + 1e-9), f = Math.round((q - c) * 100);
    return '$' + (Math.floor(c / 100)) + '.' + ('0' + (c % 100)).slice(-2) + (FR[f] || '');
  }
  function basis(c) { c = Math.round(c); return c > 0 ? '+' + c : String(c); }
  function day(iso) {
    var d = new Date(iso + 'T12:00:00Z');
    return isNaN(d) ? esc(iso) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  function ageDays(iso, now) { var d = Date.parse(iso + 'T12:00:00Z'); return isNaN(d) ? 0 : Math.floor((now - d) / 864e5); }
  function money(p, unit) { return unit === 'cents/lb' ? p.toFixed(2) + '¢/lb' : '$' + p.toFixed(2) + '/ton'; }

  function cornHtml(c, now) {
    if (!c) return '';
    if (c.withheld) return '<p class="eth-note">Plant corn bids: not shown. ' + esc(c.withheld) + '</p>';
    var fut = esc(c.futures || ''), h = '';
    h += '<p class="eth-lead">What ethanol plants bid for corn, by state: ' + esc(c.terms || '') + '. Basis is in cents against ' + fut + ' futures.</p>';
    h += '<div class="eth-wrap"><table class="eth-t"><thead><tr><th>State</th><th class="r">Bids, $/bu</th><th class="r">Basis vs ' + fut + '</th><th class="r">USDA average</th><th class="r">Year ago</th></tr></thead><tbody>';
    c.rows.forEach(function (r) {
      h += '<tr><td>' + esc(r.label) + '</td><td class="r">' + bid(r.bid_lo) + (r.bid_hi !== r.bid_lo ? ' to ' + bid(r.bid_hi) : '') + '</td>' +
        '<td class="r">' + basis(r.basis_lo) + (r.basis_hi !== r.basis_lo ? ' to ' + basis(r.basis_hi) : '') + '</td>' +
        '<td class="r">' + (r.avg == null ? 'not reported' : bid(r.avg)) + '</td>' +
        '<td class="r">' + (r.avg_year_ago == null ? 'not reported' : bid(r.avg_year_ago)) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<p class="eth-src">USDA AMS, ' + esc(c.report) + ', ' + day(c.report_date) + '. The report gives a range per state and names no plants.';
    if (ageDays(c.report_date, now) > OLD_DAYS) h += ' This is the latest report AGSIST has read; there may be a newer one.';
    return h + '</p>';
  }

  function coHtml(co, now) {
    if (!co) return '';
    if (co.withheld) return '<p class="eth-note">Co-product prices: not shown. ' + esc(co.withheld) + '</p>';
    var h = '<p class="eth-lead">What the plants sell back: distillers grains and corn oil, by area.</p>';
    h += '<div class="eth-wrap"><table class="eth-t"><thead><tr><th>Product</th><th>Area</th><th class="r">Price</th><th class="r">Year ago</th></tr></thead><tbody>';
    co.rows.forEach(function (r) {
      h += '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.area) + '</td><td class="r">' + money(r.price, r.unit) + '</td>' +
        '<td class="r">' + (r.year_ago == null ? 'not reported' : money(r.year_ago, r.unit)) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<p class="eth-src">USDA AMS, ' + esc(co.report) + ', week of ' + day(co.week_of) +
      (co.year_ago_week_of ? '; year ago from the week of ' + day(co.year_ago_week_of) : '; no year-ago week was read') + '.';
    if (ageDays(co.week_of, now) > OLD_DAYS + 9) h += ' This is the latest report AGSIST has read; there may be a newer one.';
    return h + '</p>';
  }

  function render(data, now) {
    if (!data || data.schema !== 'agsist-ethanol-bids/1') return '<p class="eth-note">The USDA ethanol plant report is not available right now.</p>';
    now = now || Date.now();
    return cornHtml(data.corn, now) + coHtml(data.coproducts, now);
  }

  root.EthanolBids = { render: render, bid: bid, basis: basis };
  if (typeof document === 'undefined') return;
  /* the file is read when the fold is first opened, not on every visit */
  function go() {
    var box = document.getElementById('eth-bids'), fold = document.getElementById('eth-box'), done = false;
    if (!box || !fold) return;
    function load() {
      if (done || !fold.open) return;
      done = true;
      fetch('/data/ethanol-bids.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { box.innerHTML = render(d); })
      .catch(function () { box.innerHTML = render(null); });
    }
    fold.addEventListener('toggle', load);
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})(typeof window !== 'undefined' ? window : globalThis);
