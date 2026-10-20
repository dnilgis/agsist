/* AGSIST feeder cattle sale barn prices (cattle-auction-prices.html).
 *
 * Reads data/cattle-auction.json, written by scripts/fetch_cattle_auction.py
 * from USDA AMS auction reports. Shows the barns nearest a ZIP (or one state),
 * each with its latest USDA-reported sale by 100 lb class: head, weighted
 * average $/cwt, range, $/head, and the change from that barn's prior sale.
 *
 * Barns USDA does not report (`own` in the data file: the Wisconsin and
 * Minnesota barns, Equity markets and the like) are listed nearest first with
 * their sale day and a link to their own report. A barn-posted price range
 * shows only after the fetch's parser for it was checked against a saved
 * report; until then the card says so and shows no number.
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
  /* barns USDA does not report: those within `within` miles, nearest first, at most max */
  function nearOwn(own, here, max, within) {
    return (own || []).filter(function (b) { return isFinite(b.lat) && isFinite(b.lon); })
      .map(function (b) { return { barn: b, mi: miles(here, b) }; })
      .filter(function (x) { return x.mi <= within; })
      .sort(function (x, y) { return x.mi - y.mi; }).slice(0, max);
  }
  /* a barn-posted sale's ranges for one sex, lightest first; [] without one */
  function ownRanges(b, sex) {
    var s0 = b && b.sales && b.sales[0];
    return s0 && s0.ranges ? s0.ranges.filter(function (r) { return r.sex === sex; }).sort(function (x, y) { return x.lo - y.lo; }) : [];
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


  /* Value of gain from one report (2026-10-20, panel seat C): what the barn paid for each pound a
   * calf added, from that report's own lighter and heavier class of the same sex and grade.
   *   (heavy $/head - light $/head) / (heavy avg wt - light avg wt)
   * $/head is the report's dollars over head (cwt price times weight, row by row); without it,
   * cwt x avg wt / 100. Light is the 500 lb class (else 400, else 600), heavy the 800 lb class
   * (else 700), each with VOG_MIN_HEAD head or more, at least VOG_MIN_GAP lb apart. Withheld, with
   * the reason, when the sale is more than STALE_DAYS old or a class is missing or thin. One report
   * only: never two barns, two sales or steers against heifers. Pure. */
  var VOG_LIGHT = [500, 400, 600], VOG_HEAVY = [800, 700], VOG_MIN_HEAD = 10, VOG_MIN_GAP = 150;
  function perHead(r) { return isFinite(r.per_head) && r.per_head > 0 ? r.per_head : r.cwt * r.avg_wt / 100; }
  function valueOfGain(sale, key, todayIso) {
    if (!sale || !sale.classes) return { ok: false, why: 'no sale on file' };
    var age = todayIso ? daysBetween(sale.date, todayIso) : 0;
    if (age > STALE_DAYS) return { ok: false, why: 'this sale is ' + age + ' days old', stale: true, age: age };
    var c = sale.classes[key] || {};
    function ok(cls) { var r = c[String(cls)]; return r && r.head >= VOG_MIN_HEAD && r.avg_wt > 0 && (r.cwt > 0 || r.per_head > 0) ? r : null; }
    var L = null, lc = null, H = null, hc = null, i;
    for (i = 0; i < VOG_LIGHT.length && !L; i++) if (ok(VOG_LIGHT[i])) { lc = VOG_LIGHT[i]; L = ok(lc); }
    if (!L) return { ok: false, why: 'no 400, 500 or 600 lb class with ' + VOG_MIN_HEAD + ' head or more on this report' };
    for (i = 0; i < VOG_HEAVY.length && !H; i++) {
      var r = ok(VOG_HEAVY[i]);
      if (r && r.avg_wt - L.avg_wt >= VOG_MIN_GAP) { hc = VOG_HEAVY[i]; H = r; }
    }
    if (!H) return { ok: false, why: 'no 700 or 800 lb class with ' + VOG_MIN_HEAD + ' head or more on this report' };
    var lp = perHead(L), hp = perHead(H), lb = H.avg_wt - L.avg_wt;
    return { ok: true, date: sale.date,
      light: { cls: lc, head: L.head, avg_wt: L.avg_wt, cwt: L.cwt, per_head: Math.round(lp * 100) / 100 },
      heavy: { cls: hc, head: H.head, avg_wt: H.avg_wt, cwt: H.cwt, per_head: Math.round(hp * 100) / 100 },
      lb: lb, added: Math.round((hp - lp) * 100) / 100, vog: Math.round((hp - lp) / lb * 100) / 100 };
  }
  /* "background or sell": the reader's cost of gain ($/lb) against one report's value of gain.
   * Gain pays when value of gain is above cost of gain. null without a usable cost. Pure. */
  function gainVerdict(v, cog) {
    if (!v || !v.ok || cog == null || !isFinite(cog) || cog <= 0 || cog > 20) return null;
    var per = Math.round((v.vog - cog) * 100) / 100;
    return { pays: per > 0, even: per === 0, per_lb: per, per_head: Math.round(per * v.lb * 100) / 100 };
  }

  var api = { valueOfGain: valueOfGain, gainVerdict: gainVerdict, VOG_MIN_HEAD: VOG_MIN_HEAD, VOG_MIN_GAP: VOG_MIN_GAP, STALE_DAYS: STALE_DAYS, nearOwn: nearOwn, ownRanges: ownRanges, glance: glance, GLANCE_N: GLANCE_N, miles: miles, daysBetween: daysBetween, nearest: nearest, classRows: classRows, money: money, signed: signed,
    niceDate: niceDate, hasSales: hasSales, CLASSES: CLASSES, PRIOR_DAYS: PRIOR_DAYS, MIN_HEAD: MIN_HEAD, NEAR_MILES: NEAR_MILES };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgSaleBarn = api;
  if (typeof document === 'undefined') return;

  /* ---------- page ---------- */
  var S = { data: null, sex: 'steers', grade: '1', here: null, label: '', state: '', seq: 0, shown: [], vogPick: '' };
  function $(id) { return document.getElementById(id); }
  function status(msg, err) { var el = $('sb-status'); el.textContent = msg || ''; el.className = 'sb-status' + (err ? ' err' : ''); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ sex: S.sex, grade: S.grade, zip: $('sb-zip').value || '', state: S.state, cog: ($('vog-cog') || {}).value || '' })); } catch (e) {} }
  function getJSON(url, ms) {
    var c = typeof AbortController === 'function' ? new AbortController() : null, to;
    var timer = new Promise(function (_, rej) { to = setTimeout(function () { if (c) c.abort(); rej(new Error('timeout')); }, ms || 9000); });
    var req = fetch(url, c ? { signal: c.signal } : {}).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    return Promise.race([req, timer]).then(function (j) { clearTimeout(to); return j; }, function (e) { clearTimeout(to); throw e; });
  }
  function today() { return new Date().toISOString().slice(0, 10); }

  function title(b) { return b.name || (b.state + ' auctions, ' + (b.label || 'weekly summary').replace(/ summary$/, '')); }
  function sexWord() { return S.sex === 'steers' ? 'steers' : 'heifers'; }
  function vogLine(v) {
    if (!v.ok) return '<p class="sb-src sb-vogno">Value of gain not shown: ' + esc(v.why) + '.</p>';
    return '<p class="sb-vog"><b>Value of gain ' + money(v.vog) + ' a lb</b> from ' + v.light.avg_wt + ' to ' + v.heavy.avg_wt + ' lb ' + sexWord() + ': ' +
      money(v.heavy.per_head, 0) + ' a head minus ' + money(v.light.per_head, 0) + ', over ' + v.lb + ' lb. <a href="#vog">Background or sell?</a></p>';
  }
  function card(b, mi) {
    var s0 = b.sales[0], key = S.sex + '|' + S.grade;
    var rows = classRows(b, key);
    var age = daysBetween(s0.date, today());
    var kind = b.label || 'weekly summary';
    var where = b.town ? esc(b.town) + ', ' + esc(b.state) : esc(b.state) + ' ' + esc(kind);
    var h = '<section class="sb-card"><header><h3>' + esc(title(b)) + '</h3>' +
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
      h += '</tbody></table></div>' + vogLine(valueOfGain(s0, key, today()));
    }
    h += '<p class="sb-src">' + (s0.noted_head ? s0.noted_head + ' head with a note on the report (value added, fleshy, unweaned and the like) are left out of the averages. ' : '') +
      'Reported by USDA AMS, not the barn. <a href="' + esc(b.source_url) + '" rel="noopener">The USDA report</a></p></section>';
    return h;
  }

  function ownCard(b, mi) {
    var rs = ownRanges(b, S.sex), s0 = b.sales && b.sales[0];
    var h = '<section class="sb-card sb-own"><header><h3>' + esc(b.name) + '</h3><p class="sb-where">' + esc(b.town) + ', ' + esc(b.state) +
      (mi != null ? ' &middot; ' + Math.round(mi) + ' mi' : '') + '</p></header>';
    if (b.sale) h += '<p class="sb-sale">Sale day: ' + esc(b.sale) + '</p>';
    if (s0 && rs.length) {
      h += '<p class="sb-sale">Barn report of <b>' + niceDate(s0.date) + '</b>' + (s0.receipts ? ' &middot; ' + s0.receipts.toLocaleString('en-US') + ' head' : '') + '</p>' +
        (s0.note ? '<p class="sb-src">' + esc(s0.note) + '.</p>' : '');
      h += '<div class="sb-tw"><table class="sb-t"><thead><tr><th scope="col">Weight<small>lb</small></th><th scope="col">Range<small>$/cwt</small></th></tr></thead><tbody>';
      rs.forEach(function (r) { h += '<tr><th scope="row">' + r.lo + '-' + r.hi + '</th><td>' + r.plo.toFixed(2) + '-' + r.phi.toFixed(2) + '</td></tr>'; });
      h += '</tbody></table></div><p class="sb-src">Posted by the barn, not USDA: a low and high, no average or head count by class. <a href="' + esc(s0.source_url || b.site) + '" rel="noopener">The barn&#x27;s report</a></p>';
    } else {
      h += '<p class="sb-none">Prices: USDA does not report this barn, and AGSIST has not read and checked its own report yet, so no price is shown here.</p>' +
        '<p class="sb-src">' + (b.site ? '<a href="' + esc(b.site) + '" rel="noopener">See the barn&#x27;s own report</a>' : 'Ask the barn for its latest market report.') + '</p>';
    }
    return h + '</section>';
  }

  var ST = { AL: 'Alabama', AR: 'Arkansas', CO: 'Colorado', FL: 'Florida', GA: 'Georgia', IA: 'Iowa', ID: 'Idaho', IL: 'Illinois',
    IN: 'Indiana', KS: 'Kansas', KY: 'Kentucky', MN: 'Minnesota', MO: 'Missouri', MS: 'Mississippi', MT: 'Montana', NC: 'North Carolina', ND: 'North Dakota',
    NE: 'Nebraska', NM: 'New Mexico', OK: 'Oklahoma', OR: 'Oregon', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
    UT: 'Utah', VA: 'Virginia', WA: 'Washington', WI: 'Wisconsin', WY: 'Wyoming' };
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
    var barns = (D.barns || []).filter(hasSales), states = (D.states || []).filter(hasSales), own = D.own || [];
    if (!barns.length && !states.length) return;
    renderGlance(states);
    $('sb-empty').hidden = true;
    var h = '', shown = [];
    if (S.state) {
      var inState = barns.filter(function (b) { return b.state === S.state; });
      var sum = states.filter(function (b) { return b.state === S.state; });
      var ownIn = own.filter(function (b) { return b.state === S.state; });
      sum.concat(inState).forEach(function (b) { shown.push(b); h += card(b, S.here ? miles(S.here, b) : null); });
      if (ownIn.length) {
        h += '<h3 class="sb-ownh">' + esc(ST[S.state] || S.state) + ' barns USDA does not report</h3>';
        ownIn.forEach(function (b) { h += ownCard(b, S.here ? miles(S.here, b) : null); });
      }
      $('sb-head').textContent = inState.length || sum.length || ownIn.length ? 'Barns in ' + S.state : 'No barn on file in ' + S.state + ' yet';
    } else if (S.here) {
      var n = nearest(barns, S.here, MAX_NEAR, NEAR_MILES);
      n.list.forEach(function (x) { shown.push(x.barn); h += card(x.barn, x.mi); });
      var no = nearOwn(own, S.here, MAX_NEAR, NEAR_MILES);
      if (no.length) {
        h += '<h3 class="sb-ownh">Near you, not in a USDA report</h3>';
        no.forEach(function (x) { h += ownCard(x.barn, x.mi); });
      }
      $('sb-head').textContent = n.far ? 'No barn on file within ' + NEAR_MILES + ' miles of ' + S.label + '. The closest:' : 'Nearest barns to ' + S.label;
    } else {
      $('sb-head').textContent = 'Enter a ZIP or pick a state';
    }
    out.innerHTML = h;
    S.shown = shown.length ? shown : states.slice().sort(function (a, b) { return (b.sales[0].receipts || 0) - (a.sales[0].receipts || 0); });
    renderVog();
    var latest = barns.concat(states).map(function (b) { return b.sales[0].date; }).sort().pop();
    $('sb-asof').textContent = barns.length + ' barns with a sale on file' + (own.length ? ', and ' + own.length + ' more listed that USDA does not report' : '') +
      '. Newest sale ' + niceDate(latest) + '. Checked ' + niceDate(String(D.updated).slice(0, 10)) + '.';
  }

  /* "Background or sell": one report at a time, picked from the reports on screen (the state
   * summaries, biggest first, before a ZIP or state is picked). */
  function renderVog() {
    var box = $('vog'), sel = $('vog-barn'), out = $('vog-out');
    if (!box || !sel || !out) return;
    var key = S.sex + '|' + S.grade, t = today();
    var opts = S.shown.map(function (b) { return { b: b, v: valueOfGain(b.sales[0], key, t), id: b.id || b.state }; })
      .filter(function (o) { return o.v.ok; });
    box.hidden = false;
    var keep = S.vogPick || sel.value;
    sel.innerHTML = opts.map(function (o) {
      return '<option value="' + esc(o.id) + '">' + esc(title(o.b)) + ', ' + esc(niceDate(o.v.date).replace(/, \d{4}$/, '')) + '</option>';
    }).join('');
    sel.disabled = !opts.length;
    if (!opts.length) {
      out.innerHTML = 'No report on screen has both a lighter and a heavier class of Medium and Large ' + esc(S.grade) + ' ' + sexWord() +
        ' (10 head or more each) from a sale in the last 14 days, so no value of gain is shown.';
      return;
    }
    var pick = opts.filter(function (o) { return o.id === keep; })[0] || opts[0];
    sel.value = pick.id;
    var v = pick.v, raw = String($('vog-cog').value || '').replace(/[$\s]/g, '');
    var cog = raw === '' ? null : parseFloat(raw), g = gainVerdict(v, cog);
    var who = esc(title(pick.b)) + ' (sale of ' + niceDate(v.date) + ')';
    var base = 'At ' + who + ', ' + v.light.avg_wt + ' lb ' + sexWord() + ' brought ' + money(v.light.per_head, 0) + ' a head and ' +
      v.heavy.avg_wt + ' lb ' + sexWord() + ' ' + money(v.heavy.per_head, 0) + ': ' + money(v.added, 0) + ' more for ' + v.lb +
      ' more lb, a value of gain of <b>' + money(v.vog) + ' a lb</b>.';
    if (raw === '') { out.innerHTML = base + ' Type your cost of gain to compare.'; return; }
    if (!g) { out.innerHTML = base + ' Type your cost of gain in dollars a pound, more than zero (not cents).'; return; }
    var yours = ' Your gain costs ' + money(cog) + ' a lb';
    if (g.even) out.innerHTML = '<b>Even at these prices.</b> ' + base + yours + ', the same.';
    else if (g.pays) out.innerHTML = '<b>Gain pays at these prices.</b> ' + base + yours + ', so you keep about ' + money(g.per_lb) +
      ' a lb, or ' + money(g.per_head, 0) + ' a head over the ' + v.lb + ' lb.';
    else out.innerHTML = '<b>Gain does not pay at these prices.</b> ' + base + yours + ', ' + money(-g.per_lb) + ' a lb more than the sale paid, or about ' +
      money(-g.per_head, 0) + ' a head short over the ' + v.lb + ' lb. Selling at ' + v.light.avg_wt + ' lb brings more.';
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
      if ($('vog-cog') && /^\$?\d{0,2}(\.\d{0,3})?$/.test(saved.cog || '')) $('vog-cog').value = saved.cog || '';
    }
    if ($('vog-cog')) {
      $('vog-cog').addEventListener('input', function () { save(); renderVog(); });
      $('vog-barn').addEventListener('change', function () { S.vogPick = this.value; renderVog(); });
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
      (d.own || []).forEach(function (b) { if (/^[A-Z]{2}$/.test(b.state || '')) st[b.state] = 1; });
      Object.keys(st).sort().forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = k; sel.appendChild(o); });
      $('sb-controls').hidden = false;
      if (S.state && st[S.state]) sel.value = S.state; else S.state = '';
      if (!S.state && $('sb-zip').value) byZip(); else render();
    }).catch(function () { /* no file yet: the empty box stays */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof self !== 'undefined' ? self : this);
