/* components/arc-plc.js: the ARC or PLC calculator (window.AgArcPlc).

   Program numbers (effective reference prices, benchmark prices, loan rates,
   county benchmark yield estimates) come from data/arc-plc-2027.json, built
   by scripts/build_arc_plc.py, which carries the sources and the selftest.
   This file only applies the payment rules to what the reader types:

     PLC rate  = ERP - max(season-average price, loan rate), not below 0
     PLC $     = rate x PLC yield x 85% x base acres
     ARC rate  = min(max(0, 90% x BY x BP - county yield x max(price, loan)), 12% x BY x BP)
     ARC $     = rate x 85% x base acres

   ranges() and rangeText() mirror ranges() and ranges_text() in the build
   script; test/arc-plc.test.mjs runs this file in a bare context (no
   document), which loads only the math, and checks both against hand math.

   Nothing here forecasts a price. The futures quote is shown as a reference
   the reader can choose to use, labeled as what it is. */
(function (w) {
  'use strict';
  if (w.AgArcPlc) return;

  var PA = 0.85, G = 0.90, CAP = 0.12;

  function plcRate(erp, mya, loan) { return Math.max(0, erp - Math.max(mya, loan)); }
  function arcRate(by, bp, y, mya, loan, g, cap) {
    g = g == null ? G : g; cap = cap == null ? CAP : cap;
    var br = by * bp;
    return Math.min(Math.max(0, g * br - y * Math.max(mya, loan)), cap * br);
  }
  function perBase(rate, pa) { return rate * (pa == null ? PA : pa); }
  /* both programs, $ per base acre */
  function pay(c, price, y) {
    var plc = c.py > 0 ? perBase(plcRate(c.erp, price, c.loan) * c.py) : null;
    var arc = c.by > 0 && y >= 0 ? perBase(arcRate(c.by, c.bp, y, price, c.loan)) : null;
    return { plc: plc, arc: arc };
  }
  function winner(plc, arc) {
    var a = Math.round(arc * 100), b = Math.round(plc * 100);
    if (a === 0 && b === 0) return 'none';
    if (a === b) return 'same';
    return b > a ? 'plc' : 'arc';
  }
  /* Which pays more at each cent of price, at county yield y. Runs in cents, inclusive. */
  function ranges(c, y) {
    var loC = Math.round(c.loan * 100);
    var top = Math.max(c.erp, y > 0 ? G * c.by * c.bp / y : c.erp);
    var hiC = Math.ceil(top * 100) + 1, runs = [];
    for (var ct = loC; ct <= hiC; ct++) {
      var p = pay(c, ct / 100, y), wv = winner(p.plc, p.arc);
      if (runs.length && runs[runs.length - 1].w === wv) runs[runs.length - 1].hi = ct;
      else runs.push({ w: wv, lo: ct, hi: ct });
    }
    return runs;
  }
  function c2(ct) { return '$' + (ct / 100).toFixed(2); }
  var WORD = { plc: 'PLC', arc: 'ARC-CO' };
  function rangeText(runs) {
    var out = [], n = runs.length;
    runs.forEach(function (r, i) {
      var lo = c2(r.lo), hi = c2(r.hi);
      if (r.w === 'none') { out.push(i === n - 1 ? 'Neither pays at ' + lo + ' or higher.' : 'Neither pays from ' + lo + ' to ' + hi + '.'); return; }
      var who = r.w === 'same' ? 'Both pay the same' : WORD[r.w] + ' pays more';
      if (i === 0) out.push(who + ' at ' + hi + ' or lower.');
      else if (i === n - 1) out.push(who + ' at ' + lo + ' or higher.');
      else out.push(who + ' from ' + lo + ' to ' + hi + '.');
    });
    return out;
  }
  /* For the test's cross-check of the built file only; the page reads the JSON. */
  function olympic(v) {
    if (!v || v.length !== 5) return null;
    var s = v.slice().sort(function (a, b) { return a - b; });
    return (s[1] + s[2] + s[3]) / 3;
  }
  function r2(x) { return Math.round((x + 1e-9) * 100) / 100; }
  function erpCalc(myas, statutory, pct, capPct) {
    var avg = olympic(myas);
    return Math.min(r2(statutory * (capPct || 1.15)), Math.max(statutory, r2(avg * (pct || 0.88))));
  }
  function benchmarkPrice(myas, erp) { return r2(olympic(myas.map(function (m) { return Math.max(m, erp); }))); }

  var M = { plcRate: plcRate, arcRate: arcRate, perBase: perBase, pay: pay, winner: winner, ranges: ranges,
    rangeText: rangeText, olympic: olympic, erpCalc: erpCalc, benchmarkPrice: benchmarkPrice };
  w.AgArcPlc = M;

  if (typeof document === 'undefined' || !document.querySelector) return;

  /* ------------------------------------------------------------- the page */
  var d = document;
  function $(id) { return d.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function money(v, k) { k = k == null ? 2 : k; v = Number(v); v += v >= 0 ? 1e-9 : -1e-9; /* 27.455 is 27.45499.. in binary; print it as 27.46 */
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: k, maximumFractionDigits: k }); }
  function num(el) { var v = parseFloat(el && el.value); return isFinite(v) && v >= 0 ? v : null; }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  var CROP_IX = { corn: 3, soybeans: 4 };

  function init(root) {
    var D = null, fut = null, crop = root.getAttribute('data-crop') || 'corn';
    var out = $('ap-out'), stSel = $('ap-st'), coSel = $('ap-co');
    var yDirty = false;
    var q = {};
    try { (location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }); } catch (e) {}
    if (q.crop && /^(corn|soybeans|wheat)$/.test(q.crop)) crop = q.crop;

    function chips() {
      var bs = root.querySelectorAll('.ap-crops .chip');
      for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i].getAttribute('data-crop') === crop ? 'true' : 'false');
    }
    function county() {
      if (!D || !stSel.value || !coSel.value) return null;
      var S = D.states[stSel.value];
      if (!S) return null;
      for (var i = 0; i < S.c.length; i++) if (S.c[i][0] === coSel.value) return S.c[i];
      return null;
    }
    function estimate() {
      var r = county(), ix = CROP_IX[crop];
      if (!r) return { why: null };
      if (!ix) return { why: 'AGSIST has no county wheat yields, so there is no estimate. Type the official benchmark from your county FSA office.' };
      var v = r[ix];
      if (v && v.by) return { by: v.by, y: v.y };
      if (v && v.miss) return { why: 'No estimate: NASS did not publish a ' + (crop === 'soybeans' ? 'soybean' : crop) + ' yield for this county in ' + v.miss.join(', ') + '. Type the official benchmark.' };
      return { why: 'No estimate: NASS publishes no recent ' + (crop === 'soybeans' ? 'soybean' : crop) + ' yield for this county. Type the official benchmark.' };
    }
    function fillCounties(keep) {
      var S = D && D.states[stSel.value];
      coSel.innerHTML = '';
      if (!S) { coSel.disabled = true; coSel.innerHTML = '<option value="">Pick a state first</option>'; return; }
      var h = '<option value="">Pick a county</option>';
      S.c.forEach(function (r) { h += '<option value="' + esc(r[0]) + '">' + esc(r[1]) + '</option>'; });
      coSel.innerHTML = h; coSel.disabled = false;
      if (keep) coSel.value = keep;
    }
    function futLine() {
      var el = $('ap-fut'); if (!el) return;
      var c = D && D.crops[crop], key = c && c.futures.key;
      var qv = fut && fut.quotes && fut.quotes[key];
      function has(x) { return !!x && (Array.isArray(x) ? x.indexOf(key) >= 0 : Object.prototype.hasOwnProperty.call(x, key)); }
      var bad = fut && (has(fut.stale_keys) || has(fut.withheld_keys) || has(fut.retired_keys));
      if (!qv || bad || !(qv.close > 0)) { el.innerHTML = 'You set the price. We do not forecast it.'; return; }
      var px = Math.round(qv.close) / 100;
      el.innerHTML = esc(c.futures.label) + ' today: <b>' + money(px) + '</b> <button type="button" class="ap-use" data-px="' + px.toFixed(2) + '">Use this</button>' +
        ' <span class="ap-fut-note">Futures today, not a forecast of the season-average price. The season-average price usually runs below futures by about the national basis.</span> ' +
        (w.AgAsOf ? w.AgAsOf.html(fut.fetched, 'prices', { prefix: 'Futures as of' }) : '');
    }
    function cfg() {
      var c = D.crops[crop], e = estimate();
      var off = num($('ap-by'));
      var by = off != null && off > 0 ? off : (e.by || null);
      return { crop: c, erp: c.erp.erp, bp: c.bp.value, loan: c.loan, by: by, byOfficial: off != null && off > 0, est: e,
        py: num($('ap-py')), base: num($('ap-base')), price: num($('ap-p')), y: num($('ap-y')) };
    }
    function syncYield(c) {
      if (yDirty) return;
      $('ap-y').value = c.by ? String(c.by) : '';
    }
    function hint(c) {
      var h = $('ap-by-hint'); if (!h) return;
      if (c.byOfficial) h.textContent = 'Using the official benchmark you typed.';
      else if (c.est.by) h.innerHTML = 'Blank uses our estimate: <b>' + c.est.by.toFixed(1) + ' bu</b> (Olympic average of NASS county yields ' + c.est.y.join(', ') + '). FSA&rsquo;s official benchmark can differ.';
      else if (c.est.why) h.textContent = c.est.why;
      else h.textContent = 'Leave blank to use our estimate where we have one.';
    }

    function render() {
      if (!D) return;
      chips();
      var c = cfg();
      hint(c); syncYield(c);
      c = cfg();
      var cr = c.crop, h = '';
      var y = c.y != null ? c.y : c.by;
      var need = [];
      if (!(c.py > 0)) need.push('your PLC payment yield');
      if (!(c.by > 0)) need.push('a county benchmark yield');
      /* the single point */
      if (c.price != null && need.length === 0 && y != null) {
        var p = pay(c, c.price, y), wv = winner(p.plc, p.arc), base = c.base || 0;
        var verdict = wv === 'none' ? 'Neither program pays.' : wv === 'same' ? 'Both pay the same.' : (WORD[wv] + ' pays more.');
        h += '<div class="ap-verdict ap-w-' + wv + '"><p><b>' + verdict + '</b> At a ' + money(c.price) + ' season-average price and a ' + y + ' bu county yield, PLC pays ' +
          money(p.plc) + ' and ARC-CO pays ' + money(p.arc) + ' per base acre.</p></div>';
        var plcR = plcRate(c.erp, c.price, c.loan), arcR = arcRate(c.by, c.bp, y, c.price, c.loan);
        h += '<div class="ap-cards">' +
          card('PLC', money(plcR) + '/bu', money(p.plc), base ? money(p.plc * base, 0) + ' on ' + base + ' base acres' : '') +
          card('ARC-CO', money(arcR) + '/acre', money(p.arc), base ? money(p.arc * base, 0) + ' on ' + base + ' base acres' : '') + '</div>';
        if (base && Math.max(p.plc, p.arc) * base > D.params.payment_limit_base) h += '<p class="ap-small ap-warn">That is over the $155,000 base payment limit per person or entity (adjusted for inflation). How it applies depends on who is on the farm.</p>';
      } else if (need.length) {
        h += '<p class="ap-need">Add ' + need.join(' and ') + ' to compare the two programs.</p>';
      } else if (c.price == null) {
        h += '<p class="ap-need">Set a ' + PYR + ' season-average price to see the dollars at one price. The table below covers a range.</p>';
      }
      if (need.length === 0 && y != null && y > 0) {
        var runs = ranges(c, y);
        h += '<h3 class="ap-h3">Where they cross at a ' + y + ' bu county yield</h3><p class="ap-cross">' + esc(rangeText(runs).join(' ')) + '</p>';
        h += grid(c);
        h += '<p class="ap-small">ARC-CO pays more when the county yield drops while the price holds; PLC pays more when the national price falls.</p>';
      }
      h += math(c);
      out.innerHTML = h;
      out.removeAttribute('aria-busy');
      try { d.dispatchEvent(new CustomEvent('arcplc:render')); } catch (e) {}
    }
    var PYR = 2027;
    function card(k, rate, perAc, total) {
      return '<div class="ap-card"><span class="k">' + k + '</span><span class="v">' + perAc + '</span><span class="s">per base acre<br>rate ' + rate + (total ? '<br>' + total : '') + '</span></div>';
    }
    function grid(c) {
      var g = c.crop.grid, cols = [0.8, 0.9, 1, 1.1], rows = [];
      for (var p = g.lo; p <= g.hi + 1e-9; p += g.step) rows.push(Math.round(p * 100) / 100);
      var hd = '<tr><th class="num">Price</th><th class="num">PLC</th>' + cols.map(function (f) {
        return '<th class="num">' + Math.round(c.by * f) + ' bu<br><span class="ap-pct">' + (f === 1 ? 'bench' : (f > 1 ? '+' : '&minus;') + Math.round(Math.abs(f - 1) * 100) + '%') + '</span></th>';
      }).join('') + '</tr>';
      var near = c.price != null ? rows.reduce(function (a, b) { return Math.abs(b - c.price) < Math.abs(a - c.price) ? b : a; }, rows[0]) : null;
      var body = rows.map(function (p) {
        var plc = perBase(plcRate(c.erp, p, c.loan) * c.py);
        var tds = cols.map(function (f) {
          var arc = perBase(arcRate(c.by, c.bp, c.by * f, p, c.loan)), wv = winner(plc, arc);
          var v = wv === 'plc' ? plc : arc;
          return '<td class="num ap-w-' + wv + '">' + (wv === 'none' ? '$0' : money(v, 0)) + '<span class="ap-tag">' + (wv === 'none' ? 'neither' : wv === 'same' ? 'same' : WORD[wv]) + '</span></td>';
        }).join('');
        return '<tr' + (p === near ? ' class="ap-near"' : '') + '><th class="num" scope="row">' + money(p) + '</th><td class="num">' + money(plc, 0) + '</td>' + tds + '</tr>';
      }).join('');
      return '<h3 class="ap-h3">Which pays more, per base acre</h3><p class="ap-small">Rows: ' + PYR + ' national season-average price. Columns: ' + PYR +
        ' county yield (bench = benchmark yield). Each cell shows the bigger payment and which program pays it. The PLC column is the same at any county yield; it uses your ' + c.py + ' bu PLC yield.</p>' +
        '<div class="ap-scroll"><table class="tbl ap-t ap-grid-t"><thead>' + hd + '</thead><tbody>' + body + '</tbody></table></div>';
    }
    function math(c) {
      var cr = c.crop, e = cr.erp;
      var ys = Object.keys(cr.mya).map(function (k) { return k + ': ' + money(cr.mya[k]); }).join(' &middot; ');
      var src = c.byOfficial ? 'the official benchmark you typed' : (c.est.by ? 'our estimate from NASS county yields (FSA&rsquo;s official number can differ)' : 'none yet');
      return '<details class="ap-det"><summary>How this was figured</summary><ul class="ap-list">' +
        '<li>' + esc(cr.label) + ' ' + PYR + ' effective reference price <b>' + money(e.erp) + '</b>: 88% of the Olympic average of ' + ys + ' is ' + money(e.pct_value) +
        '; the statutory price is ' + money(e.statutory) + ', the cap ' + money(e.cap) + '.</li>' +
        '<li>Benchmark price <b>' + money(cr.bp.value) + '</b> (same five years, each raised to at least ' + money(e.erp) + ', high and low dropped). Loan rate ' + money(cr.loan) + '.</li>' +
        '<li>Benchmark yield ' + (c.by ? '<b>' + c.by + ' bu</b>' : '') + ': ' + src + '.</li>' +
        '<li>PLC = (ERP &minus; the higher of price or loan rate) &times; PLC yield &times; 85%. ARC-CO = 90% of benchmark revenue &minus; county yield &times; the higher of price or loan rate, capped at 12% of benchmark revenue, &times; 85%.</li>' +
        '<li>Before the 5.7% sequestration cut USDA has applied to recent payments, and before the payment limit. An estimate, not a USDA determination.</li></ul></details>';
    }

    root.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t.closest && t.closest('.ap-crops .chip')) {
        crop = t.closest('.chip').getAttribute('data-crop'); yDirty = false; futLine(); render(); store('ap-crop', crop);
      } else if (t.classList && t.classList.contains('ap-use')) {
        $('ap-p').value = t.getAttribute('data-px'); render();
      }
    });
    stSel.addEventListener('change', function () { fillCounties(); yDirty = false; store('ap-st', stSel.value || null); store('ap-co', null); render(); });
    coSel.addEventListener('change', function () { yDirty = false; store('ap-co', coSel.value || null); render(); });
    ['ap-base', 'ap-py', 'ap-by', 'ap-p'].forEach(function (id) { $(id).addEventListener('input', function () { if (id === 'ap-by') yDirty = false; render(); }); });
    $('ap-y').addEventListener('input', function () { yDirty = $('ap-y').value !== ''; render(); });

    if (w.AgStates) w.AgStates.skeleton(out, 3);
    function start() {
      return fetch(root.getAttribute('data-src'), { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error(r.status); return r.json();
      }).then(function (data) {
        D = data;
        PYR = D.program_year;
        var keys = Object.keys(D.states).sort(function (a, b) { return D.states[a].n < D.states[b].n ? -1 : 1; });
        stSel.innerHTML = '<option value="">Pick a state</option>' + keys.map(function (k) { return '<option value="' + k + '">' + esc(D.states[k].n) + '</option>'; }).join('');
        var st = q.st || root.getAttribute('data-state') || load('ap-st') || '';
        var fips = q.fips || root.getAttribute('data-fips') || (st === load('ap-st') ? load('ap-co') : '') || '';
        if (!root.getAttribute('data-state') && !q.crop) { var lc = load('ap-crop'); if (lc && D.crops[lc]) crop = lc; }
        if (D.states[st]) { stSel.value = st; fillCounties(fips); }
        ['py', 'by', 'p', 'base'].forEach(function (k) { if (q[k] && isFinite(parseFloat(q[k]))) $('ap-' + k).value = q[k]; });
        render(); futLine();
        fetch('/data/prices.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { fut = j; futLine(); if (w.AgAsOf) w.AgAsOf.refresh && w.AgAsOf.refresh(root); }).catch(function () { futLine(); });
      }).catch(function () {
        if (w.AgStates) w.AgStates.error(out, { msg: 'The county data didn’t load.', retry: start });
        else out.innerHTML = '<p class="ap-need">The county data didn&rsquo;t load. Reload the page to try again.</p>';
      });
    }
    start();
  }

  function boot() { var root = d.querySelector('[data-arcplc]'); if (root) init(root); }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : this);
