/* AGSIST feeder cattle sale barn prices (cattle-auction-prices.html).
 *
 * Reads data/cattle-auction.json, written by scripts/fetch_cattle_auction.py
 * from USDA AMS auction reports. Shows the barns nearest a ZIP (or one state),
 * each with its latest USDA-reported sale by 100 lb class: head, weighted
 * average $/cwt, range, $/head, and the change from that barn's prior sale.
 *
 * Until the data file exists the page keeps its "prices load after the first
 * USDA read" box. Nothing here invents or fills a number.
 *
 * The pure functions are exported for test/cattle-auction.test.mjs.
 */
(function (root) {
  'use strict';
  var DATA = '/data/cattle-auction.json';
  var ZIPS = 'https://dnilgis.github.io/bids/data/zips/';
  var KEY = 'agsist-salebarn';
  var CLASSES = [300, 400, 500, 600, 700, 800];
  var NEAR_MILES = 400;
  var MAX_NEAR = 6;
  var PRIOR_DAYS = 21;     // a prior sale older than this is not "last week"
  var MIN_HEAD = 5;        // fewer head than this on either sale: no change shown
  var STALE_DAYS = 14;

  /* ---------- pure ---------- */
  function miles(a, b) {
    var R = 3958.8, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function daysBetween(a, b) { // ISO dates, b - a in whole days
    return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
  }
  function hasSales(b) { return !!(b && b.sales && b.sales.length && b.sales[0].classes); }
  function nearest(barns, here, max, within) {
    var list = (barns || []).filter(function (b) { return hasSales(b) && isFinite(b.lat) && isFinite(b.lon); })
      .map(function (b) { return { barn: b, mi: miles(here, b) }; })
      .sort(function (x, y) { return x.mi - y.mi; });
    var close = list.filter(function (x) { return x.mi <= within; });
    return { list: (close.length ? close : list.slice(0, 3)).slice(0, max), far: !close.length };
  }
  /* rows for one sex|grade of a barn's latest sale, with the change from the
   * prior sale when that sale is recent and both have enough head */
  function classRows(barn, key) {
    var s0 = barn.sales[0], s1 = barn.sales[1];
    var c0 = (s0.classes || {})[key] || {};
    var c1 = s1 && daysBetween(s1.date, s0.date) <= PRIOR_DAYS && daysBetween(s1.date, s0.date) > 0 ? (s1.classes || {})[key] || {} : null;
    var out = [];
    CLASSES.forEach(function (c) {
      var r = c0[String(c)];
      if (!r) return;
      var row = { cls: c, head: r.head, avg_wt: r.avg_wt, cwt: r.cwt, lo: r.lo, hi: r.hi, per_head: r.per_head, chg: null, chgWhy: '' };
      var p = c1 && c1[String(c)];
      if (!c1) row.chgWhy = s1 ? 'no sale in the 3 weeks before' : 'first sale on file';
      else if (!p) row.chgWhy = 'class not sold last time';
      else if (p.head < MIN_HEAD || r.head < MIN_HEAD) row.chgWhy = 'too few head';
      else row.chg = Math.round((r.cwt - p.cwt) * 100) / 100;
      out.push(row);
    });
    return out;
  }
  function money(x, dp) {
    if (x == null || !isFinite(x)) return '';
    var s = Math.abs(x).toFixed(dp == null ? 2 : dp).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (x < 0 ? '-' : '') + '$' + s;
  }
  function signed(x) {
    if (x == null) return '';
    if (x === 0) return 'unch';
    return (x > 0 ? '+' : '-') + Math.abs(x).toFixed(2);
  }
  function niceDate(iso) {
    var d = new Date(iso + 'T12:00:00Z');
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* The no-ZIP first line (2026-10-17 search-terms check: "cattle prices today" 655, "feeder calf
   * prices today" 109 saw no price before a ZIP). The USDA state summaries already in the data
   * file, largest receipts first, sales within STALE_DAYS of today: for one sex|grade, the 500 and
   * 700 lb classes (or whichever of 300 to 800 the report has, lightest first). Pure. */
  var GLANCE_N = 3, GLANCE_CLS = [500, 700];
  function glance(states, key, todayIso) {
    return (states || []).filter(function (b) {
      return hasSales(b) && daysBetween(b.sales[0].date, todayIso) <= STALE_DAYS && daysBetween(b.sales[0].date, todayIso) >= 0 &&
        (b.sales[0].classes || {})[key];
    }).sort(function (a, b) { return (b.sales[0].receipts || 0) - (a.sales[0].receipts || 0) || (a.state < b.state ? -1 : 1); })
      .slice(0, GLANCE_N).map(function (b) {
        var rows = classRows(b, key), pick = rows.filter(function (r) { return GLANCE_CLS.indexOf(r.cls) >= 0; });
        if (!pick.length) pick = rows.slice(0, 2);
        return { state: b.state, date: b.sales[0].date, receipts: b.sales[0].receipts || 0, source_url: b.source_url,
          cells: pick.map(function (r) { return { cls: r.cls, cwt: r.cwt, head: r.head }; }) };
      }).filter(function (g) { return g.cells.length; });
  }

  var api = { glance: glance, GLANCE_N: GLANCE_N, miles: miles, daysBetween: daysBetween, nearest: nearest, classRows: classRows, money: money, signed: signed,
    niceDate: niceDate, hasSales: hasSales, CLASSES: CLASSES, PRIOR_DAYS: PRIOR_DAYS, MIN_HEAD: MIN_HEAD, NEAR_MILES: NEAR_MILES };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgSaleBarn = api;
  if (typeof document === 'undefined') return;

  /* ---------- page ---------- */
  var S = { data: null, sex: 'steers', grade: '1', here: null, label: '', state: '', seq: 0 };
  function $(id) { return document.getElementById(id); }
  function status(msg, err) { var el = $('sb-status'); el.textContent = msg || ''; el.className = 'sb-status' + (err ? ' err' : ''); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ sex: S.sex, grade: S.grade, zip: $('sb-zip').value || '', state: S.state })); } catch (e) {} }
  function getJSON(url, ms) {
    var c = typeof AbortController === 'function' ? new AbortController() : null, to;
    var timer = new Promise(function (_, rej) { to = setTimeout(function () { if (c) c.abort(); rej(new Error('timeout')); }, ms || 9000); });
    var req = fetch(url, c ? { signal: c.signal } : {}).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    return Promise.race([req, timer]).then(function (j) { clearTimeout(to); return j; }, function (e) { clearTimeout(to); throw e; });
  }
  function today() { return new Date().toISOString().slice(0, 10); }

  function card(b, mi) {
    var s0 = b.sales[0], key = S.sex + '|' + S.grade;
    var rows = classRows(b, key);
    var age = daysBetween(s0.date, today());
    var kind = b.label || 'weekly summary';
    var where = b.town ? esc(b.town) + ', ' + esc(b.state) : esc(b.state) + ' ' + esc(kind);
    var h = '<section class="sb-card"><header><h3>' + esc(b.name || (b.state + ' auctions, ' + kind.replace(/ summary$/, ''))) + '</h3>' +
      '<p class="sb-where">' + where + (mi != null ? ' &middot; ' + Math.round(mi) + ' mi' : '') + '</p></header>';
    h += '<p class="sb-sale">Sale of <b>' + niceDate(s0.date) + '</b>' + (s0.receipts ? ' &middot; ' + s0.receipts.toLocaleString('en-US') + ' head on the report' : '') +
      (age > STALE_DAYS ? ' <span class="sb-old">' + age + ' days old</span>' : '') + '</p>';
    var barnWhy = rows.length && rows.every(function (r) { return r.chg == null && /sale/.test(r.chgWhy) && r.chgWhy === rows[0].chgWhy; }) ? rows[0].chgWhy : '';
    if (barnWhy === 'first sale on file') h += '<p class="sb-src">First sale on file; the change shows after the next USDA report.</p>';
    else if (barnWhy) h += '<p class="sb-src">No change shown: ' + esc(barnWhy) + '.</p>';
    if (!rows.length) {
      h += '<p class="sb-none">No ' + (S.sex === 'steers' ? 'steers' : 'heifers') + ' graded Medium and Large ' + S.grade + ' in the 300 to 899 lb classes on this report.</p>';
    } else {
      h += '<div class="sb-tw"><table class="sb-t"><thead><tr><th scope="col">Weight<small>lb</small></th><th scope="col">Head</th><th scope="col">Avg $/cwt<small>range</small></th><th scope="col">$/head<small>at avg wt</small></th><th scope="col">vs prior<small>$/cwt</small></th></tr></thead><tbody>';
      rows.forEach(function (r) {
        var chg = r.chg == null ? (barnWhy ? '' : '<span class="sb-dim">' + esc(r.chgWhy) + '</span>')
          : '<span class="' + (r.chg > 0 ? 'up' : r.chg < 0 ? 'dn' : '') + '">' + signed(r.chg) + '</span>';
        h += '<tr><th scope="row">' + r.cls + '-' + (r.cls + 99) + '</th><td>' + r.head + '</td><td><b>' + r.cwt.toFixed(2) + '</b><small>' +
          r.lo.toFixed(2) + '-' + r.hi.toFixed(2) + '</small></td><td>' + money(r.per_head, 0) + '<small>' + r.avg_wt + ' lb</small></td><td>' + chg + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '<p class="sb-src">' + (s0.noted_head ? s0.noted_head + ' head with a note on the report (value added, fleshy, unweaned and the like) are left out of the averages. ' : '') +
      'Reported by USDA AMS, not the barn. <a href="' + esc(b.source_url) + '" rel="noopener">The USDA report</a></p></section>';
    return h;
  }

  var ST = { AL: 'Alabama', AR: 'Arkansas', CO: 'Colorado', FL: 'Florida', GA: 'Georgia', IA: 'Iowa', ID: 'Idaho', IL: 'Illinois',
    KS: 'Kansas', KY: 'Kentucky', MO: 'Missouri', MS: 'Mississippi', MT: 'Montana', NC: 'North Carolina', ND: 'North Dakota',
    NE: 'Nebraska', NM: 'New Mexico', OK: 'Oklahoma', OR: 'Oregon', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
    VA: 'Virginia', WY: 'Wyoming' };
  function renderGlance(states) {
    var el = $('sb-glance');
    if (!el) return;
    var g = S.here || S.state ? [] : glance(states, S.sex + '|' + S.grade, today());
    if (!g.length) { el.hidden = true; el.innerHTML = ''; return; }
    var who = 'Medium and Large ' + S.grade + ' ' + (S.sex === 'steers' ? 'steers' : 'heifers');
    el.innerHTML = '<p class="sb-gh"><b>Cattle prices today:</b> biggest USDA state auction reports, ' + esc(who) + ', $/cwt</p><ul>' +
      g.map(function (x) {
        return '<li><b>' + esc(ST[x.state] || x.state) + '</b>, report of ' + esc(niceDate(x.date).replace(/, \d{4}$/, '')) + ' (' + x.receipts.toLocaleString('en-US') + ' head): ' +
          x.cells.map(function (c) { return c.cls + '-' + (c.cls + 99) + ' lb <b>$' + c.cwt.toFixed(2) + '</b>'; }).join(' &middot; ') + '</li>';
      }).join('') + '</ul>';
    el.hidden = false;
  }

  function render() {
    var out = $('sb-results'), D = S.data;
    if (!D) return;
    var barns = (D.barns || []).filter(hasSales), states = (D.states || []).filter(hasSales);
    if (!barns.length && !states.length) return;
    renderGlance(states);
    $('sb-empty').hidden = true;
    var h = '';
    if (S.state) {
      var inState = barns.filter(function (b) { return b.state === S.state; });
      var sum = states.filter(function (b) { return b.state === S.state; });
      sum.concat(inState).forEach(function (b) { h += card(b, S.here ? miles(S.here, b) : null); });
      $('sb-head').textContent = inState.length || sum.length ? 'Barns in ' + S.state : 'No barn on file in ' + S.state + ' yet';
    } else if (S.here) {
      var n = nearest(barns, S.here, MAX_NEAR, NEAR_MILES);
      n.list.forEach(function (x) { h += card(x.barn, x.mi); });
      $('sb-head').textContent = n.far ? 'No barn on file within ' + NEAR_MILES + ' miles of ' + S.label + '. The closest:' : 'Nearest barns to ' + S.label;
    } else {
      $('sb-head').textContent = 'Enter a ZIP or pick a state';
    }
    out.innerHTML = h;
    var latest = barns.concat(states).map(function (b) { return b.sales[0].date; }).sort().pop();
    $('sb-asof').textContent = barns.length + ' barns with a sale on file. Newest sale ' + niceDate(latest) + '. Checked ' + niceDate(String(D.updated).slice(0, 10)) + '.';
  }

  function byZip() {
    var z = String($('sb-zip').value || '').replace(/\D/g, '').slice(0, 5);
    if (z.length !== 5) { status('Enter a 5-digit ZIP.', true); return; }
    $('sb-zip').value = z; S.state = ''; $('sb-state').value = ''; save();
    status('Looking up ' + z + '...');
    var my = ++S.seq;
    getJSON(ZIPS + z.slice(0, 2) + '.json', 6000).then(function (t) {
      var p = t && t[z];
      if (Array.isArray(p) && isFinite(+p[0]) && isFinite(+p[1]) && !(+p[0] === 0 && +p[1] === 0)) return { lat: +p[0], lon: +p[1] };
      throw new Error('not in table');
    }).catch(function () {
      return getJSON('https://geocoding-api.open-meteo.com/v1/search?name=' + z + '&count=1&language=en&format=json&countryCode=US', 6000).then(function (d) {
        var r = d && d.results && d.results[0];
        if (!r) throw new Error('none');
        return { lat: r.latitude, lon: r.longitude };
      });
    }).then(function (p) { if (my !== S.seq) return; S.here = p; S.label = 'ZIP ' + z; status(''); render(); })
      .catch(function () { if (my === S.seq) status('Could not find ZIP ' + z + '. Check it and try again.', true); });
  }
  function seg(attr, set) {
    var bs = document.querySelectorAll('[' + attr + ']');
    for (var i = 0; i < bs.length; i++) bs[i].addEventListener('click', function () {
      set(this.getAttribute(attr)); sync(); save(); render();
    });
  }
  function sync() {
    var a = document.querySelectorAll('[data-sex]'), g = document.querySelectorAll('[data-grade]'), i;
    for (i = 0; i < a.length; i++) a[i].setAttribute('aria-pressed', String(a[i].getAttribute('data-sex') === S.sex));
    for (i = 0; i < g.length; i++) g[i].setAttribute('aria-pressed', String(g[i].getAttribute('data-grade') === S.grade));
  }
  function init() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (saved) {
      if (saved.sex === 'steers' || saved.sex === 'heifers') S.sex = saved.sex;
      if (saved.grade === '1' || saved.grade === '1-2') S.grade = saved.grade;
      if (/^\d{5}$/.test(saved.zip || '')) $('sb-zip').value = saved.zip;
      if (/^[A-Z]{2}$/.test(saved.state || '')) S.state = saved.state;
    }
    sync();
    seg('data-sex', function (v) { S.sex = v; });
    seg('data-grade', function (v) { S.grade = v; });
    $('sb-go').addEventListener('click', byZip);
    $('sb-zip').addEventListener('keydown', function (e) { if (e.key === 'Enter') byZip(); });
    $('sb-state').addEventListener('change', function () { S.state = this.value; save(); render(); });
    getJSON(DATA + '?t=' + Math.floor(Date.now() / 6e5), 9000).then(function (d) {
      if (!d || !((d.barns || []).some(hasSales) || (d.states || []).some(hasSales))) return;
      S.data = d;
      var st = {}, sel = $('sb-state');
      (d.barns || []).concat(d.states || []).forEach(function (b) { if (hasSales(b)) st[b.state] = 1; });
      Object.keys(st).sort().forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = k; sel.appendChild(o); });
      $('sb-controls').hidden = false;
      if (S.state && st[S.state]) sel.value = S.state; else S.state = '';
      if (!S.state && $('sb-zip').value) byZip(); else render();
    }).catch(function () { /* no file yet: the empty box stays */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof self !== 'undefined' ? self : this);
