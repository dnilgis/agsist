/* components/arc-plc.js: the ARC or PLC calculator (window.AgArcPlc).

   Program numbers (effective reference prices, benchmark prices, loan rates
   for 2026 and 2027, FSA's official county benchmark yields by practice) come
   from data/arc-plc.json, built by scripts/build_arc_plc.py, which carries the
   sources and the selftest. This file only applies the payment rules to what
   the reader types:

     PLC rate  = ERP - max(season-average price, loan rate), not below 0
     PLC $     = rate x PLC yield x 85% x base acres
     ARC rate  = min(max(0, 90% x BY x BP - county yield x max(price, loan)), 12% x BY x BP)
     ARC $     = rate x 85% x base acres; a farm with irrigated and
                 non-irrigated county figures is weighted by its historical
                 irrigated share (parts below)

   ranges() and rangeText() mirror ranges() and ranges_text() in the build
   script; test/arc-plc.test.mjs runs this file in a bare context (no
   document), which loads only the math.

   Nothing here forecasts a price, and no estimate stands in for FSA's county
   benchmark: with no FSA figure and nothing typed, ARC-CO is not computed. */
(function (w) {
  'use strict';
  if (w.AgArcPlc) return;

  var PA = 0.85, G = 0.90, CAP = 0.12;

  function cents(x) { return Math.floor(x * 100 + 0.5); }
  function plcRate(erp, mya, loan) { return Math.max(0, erp - Math.max(mya, loan)); }
  function arcRate(by, bp, y, mya, loan) {
    var br = by * bp;
    return Math.min(Math.max(0, G * br - y * Math.max(mya, loan)), CAP * br);
  }
  function perBase(rate) { return rate * PA; }
  /* c: {erp, bp, loan, py, parts: [{w, by, y}]}; ARC per base acre, weighted over parts */
  function arcPerBase(c, price, f) {
    var s = 0;
    for (var i = 0; i < c.parts.length; i++) {
      var p = c.parts[i], y = f == null ? p.y : (c.parts.length === 1 ? Math.round(p.by * f * 10) / 10 : p.by * f); /* single: the bushels shown in the grid header */
      s += p.w * perBase(arcRate(p.by, c.bp, y, price, c.loan));
    }
    return s;
  }
  function pay(c, price, f) {
    return { plc: c.py > 0 ? perBase(plcRate(c.erp, price, c.loan) * c.py) : null, arc: c.parts && c.parts.length ? arcPerBase(c, price, f) : null };
  }
  function winner(plc, arc) {
    var a = cents(arc), b = cents(plc);
    if (a === 0 && b === 0) return 'none';
    if (a === b) return 'same';
    return b > a ? 'plc' : 'arc';
  }
  /* Which pays more at each cent of price at the entered county yields. Runs
     in cents, inclusive. Stops at 1.5 x max(ERP, benchmark price). */
  function ranges(c) {
    var loC = cents(c.loan), trig = c.erp;
    c.parts.forEach(function (p) { if (p.y > 0) trig = Math.max(trig, G * p.by * c.bp / p.y); });
    var hiC = Math.min(Math.ceil(trig * 100) + 1, Math.ceil(Math.max(c.erp, c.bp) * 150)), runs = [];
    for (var ct = loC; ct <= Math.max(hiC, loC); ct++) {
      var p = pay(c, ct / 100), wv = winner(p.plc, p.arc);
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
    return Math.min(r2(statutory * (capPct || 1.15)), Math.max(statutory, r2(olympic(myas) * (pct || 0.88))));
  }
  function benchmarkPrice(myas, erp) { return r2(olympic(myas.map(function (m) { return Math.max(m, erp); }))); }
  /* Plain checks on what was typed. Returns [{field, msg, drop}] */
  function checks(v, ref) {
    var out = [];
    ['base', 'py', 'by', 'y', 'p'].forEach(function (k) {
      if (v[k] != null && !(v[k] > 0)) out.push({ field: k, drop: true, msg: { base: 'Base acres', py: 'PLC yield', by: 'Benchmark yield', y: 'County yield', p: 'Price' }[k] + ' must be more than zero.' });
    });
    if (v.p > 0 && ref.erp > 0 && (v.p < ref.erp * 0.5 || v.p > ref.erp * 2)) {
      var guess = v.p / 100;
      out.push({ field: 'p', msg: (v.p > ref.erp * 2 && guess >= ref.erp * 0.5 && guess <= ref.erp * 2) ? 'Did you mean $' + guess.toFixed(2) + ' per bushel?' :
        'That is far from the $' + ref.erp.toFixed(2) + ' reference price. Prices here are dollars per bushel.' });
    }
    if (v.py > 0 && ref.by > 0 && v.py > ref.by) out.push({ field: 'py', msg: 'PLC yield is usually below the county average. Is this your APH? Use the PLC yield on your FSA-156EZ.' });
    if (v.y > 0 && ref.by > 0 && v.y < ref.by * 0.1) out.push({ field: 'y', drop: true, msg: 'That county yield is under 10% of the benchmark, so it is ignored and the benchmark is used.' });
    return out;
  }

  /* Expected PLC and ARC-CO per base acre across past years. c.parts carry
     dy: {year: county yield / benchmark}; ratios: {year: MYA_t / MYA_t-1}.
     Scenario year t: price = center x r_t (or the reader's price), county
     yield = benchmark x d_t, the same real year for both. Mirrors scen_eval
     in scripts/build_arc_plc.py. */
  var MIN_SCEN = 8, MIN_GAP = 2;
  function scenarios(c, center, ratios, price) {
    var yrs = Object.keys(ratios).sort().filter(function (t) { return c.parts.every(function (p) { return p.dy && p.dy[t] != null; }); });
    var rows = yrs.map(function (t) {
      var pr = price != null ? price : center * ratios[t];
      var plc = perBase(plcRate(c.erp, pr, c.loan) * c.py);
      var arc = c.parts.reduce(function (s, p) { return s + p.w * perBase(arcRate(p.by, c.bp, p.by * p.dy[t], pr, c.loan)); }, 0);
      return { t: +t, p: pr, plc: plc, arc: arc };
    });
    var n = rows.length, out = { n: n, rows: rows };
    if (!n) { out.verdict = 'withheld'; return out; }
    var mp = 0, ma = 0; rows.forEach(function (r) { mp += r.plc / n; ma += r.arc / n; });
    var md = mp - ma, ss = 0;
    rows.forEach(function (r) { var x = r.plc - r.arc - md; ss += x * x; });
    var se = n > 1 ? Math.sqrt(ss / (n - 1)) / Math.sqrt(n) : 0;
    var pw = rows.filter(function (r) { return cents(r.plc) > cents(r.arc); }).length, aw = rows.filter(function (r) { return cents(r.arc) > cents(r.plc); }).length;
    var band = Math.max(MIN_GAP, 2 * se);
    out.plc = mp; out.arc = ma; out.diff = md; out.se = se; out.plcWins = pw; out.arcWins = aw; out.band = band;
    if (n < MIN_SCEN) out.verdict = 'withheld';
    else if (Math.abs(md) < band || (md > 0 && pw <= aw) || (md < 0 && aw <= pw)) out.verdict = 'close';
    else out.verdict = md > 0 ? 'plc' : 'arc';
    return out;
  }

  var M = { scenarios: scenarios, cents: cents, plcRate: plcRate, arcRate: arcRate, perBase: perBase, arcPerBase: arcPerBase, pay: pay, winner: winner,
    ranges: ranges, rangeText: rangeText, olympic: olympic, erpCalc: erpCalc, benchmarkPrice: benchmarkPrice, checks: checks };
  w.AgArcPlc = M;

  if (typeof document === 'undefined' || !document.querySelector) return;

  /* ------------------------------------------------------------- the page */
  var d = document;
  function $(id) { return d.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function money(v, k) { k = k == null ? 2 : k; v = Number(v); v += v >= 0 ? 1e-9 : -1e-9; /* 27.455 is 27.45499.. in binary; print 27.46 */
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: k, maximumFractionDigits: k }); }
  function num(el) { if (!el || el.value === '') return null; var v = parseFloat(el.value); return isFinite(v) ? v : null; }
  function sget(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function sset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var DL = { all: 'All practices', irr: 'Irrigated', non: 'Non-irrigated' };
  var PER_CROP = ['base', 'py', 'prac', 'share'], PER_YEAR = ['by', 'y', 'p'];
  var ID = { base: 'ap-base', py: 'ap-py', prac: 'ap-prac', share: 'ap-share', by: 'ap-by', y: 'ap-y', p: 'ap-p' };

  function init(root) {
    var D = null, fut = null, crop = root.getAttribute('data-crop') || 'corn', year = null, yTyped = false;
    var out = $('ap-out'), stSel = $('ap-st'), coSel = $('ap-co'), prSel = $('ap-prac');
    var q = {};
    try { (location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }); } catch (e) {}
    if (q.crop && /^(corn|soybeans|wheat)$/.test(q.crop)) crop = q.crop;

    function save() {
      var a = {}, b = {};
      PER_CROP.forEach(function (k) { a[k] = $(ID[k]).value; });
      PER_YEAR.forEach(function (k) { b[k] = $(ID[k]).value; });
      b.yTyped = yTyped;
      sset('ap2:c:' + crop, a); sset('ap2:cy:' + crop + ':' + year, b);
    }
    function restore() {
      var a = sget('ap2:c:' + crop) || {}, b = sget('ap2:cy:' + crop + ':' + year) || {};
      $('ap-base').value = a.base != null ? a.base : '100';
      $('ap-py').value = a.py || ''; $('ap-share').value = a.share != null ? a.share : '50';
      $('ap-by').value = b.by || ''; $('ap-p').value = b.p || ''; $('ap-y').value = b.y || '';
      yTyped = !!b.yTyped;
      fillPractice(a.prac);
    }
    function chips() {
      var bs = root.querySelectorAll('.chip');
      for (var i = 0; i < bs.length; i++) {
        var c = bs[i].getAttribute('data-crop'), y = bs[i].getAttribute('data-year');
        bs[i].setAttribute('aria-pressed', (c ? c === crop : String(y) === String(year)) ? 'true' : 'false');
      }
    }
    var SD = {};   /* per-state county files, loaded when a state is picked */
    function loadState(st) {
      if (!st || SD[st]) return Promise.resolve(SD[st]);
      return fetch(root.getAttribute('data-state-src') + st + '.json', { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error(r.status); return r.json();
      }).then(function (j) { SD[st] = j; return j; });
    }
    function county() {
      var S = D && SD[stSel.value];
      if (!S || !coSel.value) return null;
      for (var i = 0; i < S.c.length; i++) if (S.c[i].f === coSel.value) return S.c[i];
      return null;
    }
    function entries() { var c = county(); return (c && c.k[crop]) || []; }
    function fillPractice(keep) {
      var es = entries(), opts = es.map(function (e, i) { return { v: String(i), t: DL[e.d] + (e.sub ? ', ' + e.sub : '') + ' (' + e.by.toFixed(2) + ' bu)' }; });
      var hasI = -1, hasN = -1;
      es.forEach(function (e, i) { if (!e.sub && e.d === 'irr') hasI = i; if (!e.sub && e.d === 'non') hasN = i; });
      if (hasI >= 0 && hasN >= 0) opts.push({ v: 'both', t: 'Both, by this farm’s irrigated share' });
      prSel.innerHTML = opts.map(function (o) { return '<option value="' + o.v + '">' + esc(o.t) + '</option>'; }).join('');
      if (keep != null && opts.some(function (o) { return o.v === keep; })) prSel.value = keep;
      else { var dn = es.findIndex(function (e) { return e.d !== 'irr'; }); if (dn >= 0) prSel.value = String(dn); } /* non-irrigated by default */
      $('ap-prac-f').hidden = es.length < 2;
      $('ap-share-f').hidden = prSel.value !== 'both' || es.length < 2;
    }
    function fillCounties(keep) {
      var S = D && SD[stSel.value];
      if (!S) { coSel.disabled = true; coSel.innerHTML = '<option value="">Pick a state first</option>'; return; }
      coSel.innerHTML = '<option value="">Pick a county</option>' + S.c.map(function (r) { return '<option value="' + esc(r.f) + '">' + esc(r.n) + '</option>'; }).join('');
      coSel.disabled = false;
      if (keep) coSel.value = keep;
    }
    function yc() { return D.years[String(year)].crops[crop]; }
    function futLine() {
      var el = $('ap-fut'); if (!el || !D) return;
      var c = yc(), key = c.futures.key, qv = fut && fut.quotes && fut.quotes[key];
      function has(x) { return !!x && (Array.isArray(x) ? x.indexOf(key) >= 0 : Object.prototype.hasOwnProperty.call(x, key)); }
      var bad = fut && (has(fut.stale_keys) || has(fut.withheld_keys) || has(fut.retired_keys));
      if (!qv || bad || !(qv.close > 0)) { el.innerHTML = 'You set the price. We do not forecast it.'; return; }
      el.innerHTML = esc(c.futures.label) + ' today, not adjusted: <b>' + money(Math.round(qv.close) / 100) + '</b>. ' +
        '<span class="ap-fut-note">A futures price, not a forecast of the season-average price, which usually runs below futures by about the national basis.</span> ' +
        (w.AgAsOf ? w.AgAsOf.html(fut.fetched, 'prices', { prefix: 'Futures as of' }) : '');
    }
    function hints() {
      var c = yc();
      $('ap-p-hint').textContent = 'USDA national season-average price for ' + c.my + ', not your local cash price.';
      $('ap-p').placeholder = 'You set this (ERP $' + c.erp.erp.toFixed(2) + ')';
    }
    function cfg() {
      var c = yc(), es = entries(), base = { erp: c.erp.erp, bp: c.bp.value, loan: c.loan, crop: c };
      var v = { base: num($('ap-base')), py: num($('ap-py')), by: num($('ap-by')), y: num($('ap-y')), p: num($('ap-p')) };
      var both = prSel.value === 'both' && es.length > 1;
      var pick = both ? null : es[parseInt(prSel.value, 10) || 0];
      var official = pick ? pick.by : null;
      var by = v.by > 0 ? v.by : official;
      var msgs = checks(v, { erp: c.erp.erp, by: by });
      msgs.forEach(function (m) { if (m.drop) v[m.field] = null; });
      base.py = v.py; base.basev = v.base; base.price = v.p; base.msgs = msgs; base.typed = v.by > 0; base.both = both; base.official = official;
      if (both) {
        var sh = Math.min(100, Math.max(0, num($('ap-share')) == null ? 50 : num($('ap-share')))) / 100;
        var pi = es.filter(function (e) { return e.d === 'irr' && !e.sub; })[0], pn = es.filter(function (e) { return e.d === 'non' && !e.sub; })[0];
        var f = v.y != null ? v.y / 100 : 1;
        base.pct = f * 100;
        base.parts = [{ w: sh, by: pi.by, y: pi.by * f, d: 'irr', dy: pi.dy, dsrc: pi.dsrc }, { w: 1 - sh, by: pn.by, y: pn.by * f, d: 'non', dy: pn.dy, dsrc: pn.dsrc }];
        base.by = null;
      } else if (by > 0) {
        base.by = by;
        base.parts = [{ w: 1, by: by, y: v.y != null ? v.y : by, d: pick ? pick.d : 'all', dy: pick ? pick.dy : null, dsrc: pick ? pick.dsrc : null }];
      } else base.parts = [];
      return base;
    }
    function render() {
      if (!D) return;
      chips(); hints();
      var es = entries();
      $('ap-share-f').hidden = prSel.value !== 'both' || es.length < 2;
      var both = prSel.value === 'both' && es.length > 1;
      $('ap-y-l').textContent = both ? 'Expected county yield, % of each benchmark' : 'Expected ' + year + ' county yield (bu/acre)';
      var c0 = yc(), pick = both ? null : es[parseInt(prSel.value, 10) || 0];
      var bh = $('ap-by-hint');
      if (both) bh.textContent = 'Using FSA’s official irrigated and non-irrigated benchmarks.';
      else if (pick) bh.innerHTML = 'FSA official ' + D.fsa.py + ' benchmark: <b>' + pick.by.toFixed(2) + ' bu</b> (' + esc(DL[pick.d]) + ').' +
        (String(year) !== String(D.fsa.py) ? ' FSA posts the ' + year + ' benchmark later; it shifts the window one year.' : '') + ' Leave blank to use it.';
      else if (county() && !D.fsa) bh.textContent = 'FSA’s official 2026 benchmarks are not loaded here yet. Ask the county office for the ARC-CO benchmark yield for your county, crop and practice (irrigated or not), and type it here.';
      else if (county()) bh.textContent = 'FSA’s file has no ' + c0.label.toLowerCase() + ' benchmark for this county. Ask the county office for the ARC-CO benchmark yield for your county, crop and practice, and type it here.';
      else bh.textContent = 'Fills in from FSA’s official county file when we have it. You can type the number your county office gives you.';
      var pyh = $('ap-py-hint'), cty = county();
      pyh.textContent = 'On the FSA-156EZ for the farm. Each farm has its own.' + (cty && cty.plc && cty.plc[crop] ? ' County average on enrolled base: ' + cty.plc[crop].toFixed(1) + ' bu (FSA, ' + D.plc_county.py + ').' : '');
      if (!yTyped && !both) { var c1 = cfg(); $('ap-y').value = c1.by ? String(c1.by) : ''; }
      if (!yTyped && both) $('ap-y').value = '100';
      var c = cfg(), h = '';
      c.msgs.forEach(function (m) { h += '<p class="ap-warn">' + esc(m.msg) + '</p>'; });
      var need = [];
      if (!(c.py > 0)) need.push('your PLC payment yield');
      if (!c.parts.length) need.push('a county benchmark yield');
      if (!need.length) h += decide(c);
      if (c.price != null && !need.length) {
        var p = pay(c, c.price), wv = winner(p.plc, p.arc), base = c.basev || 0;
        var verdict = wv === 'none' ? 'One point check: at the price and yield you entered, neither program pays.' : wv === 'same' ? 'One point check: at the price and yield you entered, both pay the same.' :
          'One point check: at the price and yield you entered, ' + WORD[wv] + ' pays more.';
        var yl = c.both ? c.pct + '% of the benchmark yields' : 'a ' + c.parts[0].y + ' bu county yield';
        h += '<div class="ap-verdict ap-w-' + wv + '"><p><b>' + verdict + '</b> At ' + money(c.price) + ' and ' + yl + ', PLC pays ' + money(p.plc) + ' and ARC-CO pays ' + money(p.arc) + ' per base acre.</p>';
        var maxArc = c.parts.reduce(function (s, x) { return s + x.w * perBase(CAP * x.by * c.bp); }, 0);
        h += '<p class="ap-small">Most ARC-CO can pay: ' + money(maxArc) + ' per base acre. PLC at the ' + money(c.loan) + ' loan rate: ' + money(perBase(plcRate(c.erp, 0, c.loan) * c.py)) + ' per base acre.</p></div>';
        var plcR = plcRate(c.erp, c.price, c.loan), arcR = c.parts.reduce(function (s, x) { return s + x.w * arcRate(x.by, c.bp, x.y, c.price, c.loan); }, 0);
        h += '<div class="ap-cards">' + card('PLC', money(p.plc), 'per base acre<br>rate ' + money(plcR) + ' per bushel', p.plc, base) +
          card('ARC-CO', money(p.arc), 'per base acre<br>' + money(arcR) + ' per acre before the 85% factor', p.arc, base) + '</div>';
      } else if (need.length) {
        h += '<p class="ap-need">Add ' + need.join(' and ') + ' to compare the two programs.</p>';
      } else {
        h += '<p class="ap-need">Set a season-average price to see the dollars at one price. The table below covers a range.</p>';
      }
      if (!need.length) {
        var runs = ranges(c);
        h += '<h3 class="ap-h3">Where they cross at ' + (c.both ? c.pct + '% of the benchmarks' : 'a ' + c.parts[0].y + ' bu county yield') + '</h3><p class="ap-cross">' + esc(rangeText(runs).join(' ')) + '</p>';
        h += grid(c);
        h += '<p class="ap-small">ARC-CO pays more when the county yield drops while the price holds; PLC pays more when the national price falls.</p>';
      }
      h += math(c);
      out.innerHTML = h;
      out.removeAttribute('aria-busy');
      var sc = out.querySelector('.ap-scroll'), cue = out.querySelector('.ap-cue');
      if (sc && cue) cue.hidden = sc.scrollWidth <= sc.clientWidth + 2;
      save();
      try { d.dispatchEvent(new CustomEvent('arcplc:render')); } catch (e) {}
    }
    var VW = { plc: 'Pick PLC', arc: 'Pick ARC-CO', close: 'Too close to call', withheld: 'Not enough history to say' };
    function vline(Y, v) {
      if (v.verdict === 'withheld') return '<b>' + Y + ': not enough history to say.</b> ' + v.n + ' past years with both a price and a county yield; we need ' + MIN_SCEN + '.';
      return '<b>' + Y + ': ' + VW[v.verdict] + (v.verdict === 'close' ? ' (the gap is under ' + money(v.band) + ' per base acre)' : '') + '.</b> Expected ' + money(v.plc) + ' PLC vs ' +
        money(v.arc) + ' ARC-CO per base acre; PLC paid more in ' + v.plcWins + ' of ' + v.n + ' past-year scenarios, ARC-CO in ' + v.arcWins + '.';
    }
    function decide(c) {
      if (!c.parts.every(function (p) { return p.dy; })) return '<div class="ap-decide"><p class="ap-need">Pick your county to get a verdict: it uses the county&rsquo;s own yield history from FSA&rsquo;s files.</p></div>';
      var h = '<div class="ap-decide"><h3 class="ap-h3">ARC-CO or PLC for this farm</h3>', cur = null;
      [2026, 2027].forEach(function (Y) {
        var yd = D.years[String(Y)], cr = yd && yd.crops[crop];
        if (!cr || !cr.scen) return;
        var cy = { erp: cr.erp.erp, bp: cr.bp.value, loan: cr.loan, py: c.py, parts: c.parts };
        var v = scenarios(cy, cr.scen.center, cr.scen.ratios);
        if (Y === year) cur = { v: v, cr: cr, cy: cy };
        h += '<div class="ap-verdict ap-w-' + (v.verdict === 'plc' || v.verdict === 'arc' ? v.verdict : 'none') + (Y === year ? ' ap-cur' : '') + '"><p>' + vline(Y, v) + '</p></div>';
      });
      if (cur && cur.v.verdict !== 'withheld') {
        var v = cur.v, cr = cur.cr, cy = cur.cy;
        var maxP = perBase(plcRate(cy.erp, 0, cy.loan) * cy.py), maxA = cy.parts.reduce(function (s, p) { return s + p.w * perBase(CAP * p.by * cy.bp); }, 0);
        var paid = v.rows.filter(function (r) { return r.arc > 0; }).length;
        h += '<p><b>Why.</b> PLC pays on any season-average price below ' + money(cy.erp) + ', up to ' + money(maxP) + ' per base acre at the ' + money(cy.loan) +
          ' loan rate, so it protects against a deep price drop. ARC-CO is capped at ' + money(maxA) + ' per base acre but also pays when the county&rsquo;s yield is short; it paid something in ' +
          paid + ' of the ' + v.n + ' past-year scenarios. Centered on USDA&rsquo;s ' + money(cr.scen.center) + ' projection, PLC is expected to pay ' + money(v.plc) + ' and ARC-CO ' + money(v.arc) + ' per base acre.</p>';
        if (c.price != null) {
          var u = scenarios(cy, cr.scen.center, cr.scen.ratios, c.price);
          h += '<p>At your ' + money(c.price) + ' price, across the same ' + u.n + ' county-yield years: PLC ' + money(u.plc) + ' vs ARC-CO ' + money(u.arc) +
            ' per base acre; PLC more in ' + u.plcWins + ', ARC-CO in ' + u.arcWins + '. ' + (u.verdict === 'withheld' ? '' : VW[u.verdict] + ' at that price.') + '</p>';
        }
        var src = c.parts.some(function (p) { return p.dsrc === 'state'; }) ? 'the state average for this crop and practice (the county has too few years)' : 'this county&rsquo;s FSA yields';
        h += '<p class="ap-small">Scenarios: USDA&rsquo;s projected ' + money(cr.scen.center) + ' season-average price (FSA&rsquo;s table of ' + cr.scen.center_date + ') moved by each year&rsquo;s actual price change, ' +
          v.rows[0].t + ' to ' + v.rows[v.rows.length - 1].t + ' (' + v.n + ' years), paired with ' + src + ' in the same year. We call it only when the expected gap is more than twice its uncertainty and at least ' +
          money(MIN_GAP) + ', and the same program paid more in more years. SCO can now go with either program, so it is no reason to pick PLC. <a href="/arc-plc#method">Method and back-test</a>.</p>';
      }
      return h + '</div>';
    }
    function card(k, v, sub, per, base) {
      var tot = base ? per * base : 0, lim = D.params.payment_limit_2025;
      return '<div class="ap-card"><span class="k">' + k + '</span><span class="v">' + v + '</span><span class="s">' + sub +
        (base ? '<br>' + money(tot, 0) + ' on ' + base + ' base acres, before the 5.7% sequestration cut' : '') + '</span>' +
        (tot > lim ? '<span class="s ap-warn">If you pick ' + k + ', this alone is over ' + money(lim, 0) + ', USDA’s 2025 limit (' + year + ' not announced). The limit is per person across all crops and farms; actively engaged LLC and S corporation members can each carry one.</span>' : '') + '</div>';
    }
    function grid(c) {
      var g = c.crop.grid, cols = [0.8, 0.9, 1, 1.1], rows = [Math.round(c.loan * 100) / 100];
      for (var k = Math.ceil((c.loan + 1e-9) / g.step); k * g.step <= g.hi + 1e-9; k++) { var pp = Math.round(k * g.step * 100) / 100; if (pp > c.loan) rows.push(pp); }
      var hd = '<tr><th class="num">Price</th><th class="num">PLC</th>' + cols.map(function (f) {
        var lab = c.both ? Math.round(f * 100) + '%' : (Math.round(c.parts[0].by * f * 10) / 10).toFixed(1);
        return '<th class="num">' + lab + '<br><span class="ap-pct">' + (f === 1 ? 'bench' : (f > 1 ? '+' : '&minus;') + Math.round(Math.abs(f - 1) * 100) + '%') + '</span></th>';
      }).join('') + '</tr>';
      var near = c.price != null ? rows.reduce(function (a, b) { return Math.abs(b - c.price) < Math.abs(a - c.price) ? b : a; }, rows[0]) : null;
      var body = rows.map(function (p) {
        var plc = perBase(plcRate(c.erp, p, c.loan) * c.py);
        var tds = cols.map(function (f) {
          var arc = arcPerBase(c, p, f), wv = winner(plc, arc), v = wv === 'plc' ? plc : arc;
          return '<td class="num ap-w-' + wv + '">' + (wv === 'none' ? '$0' : money(v, 0)) + '<span class="ap-tag">' + (wv === 'none' ? 'neither' : wv === 'same' ? 'same' : WORD[wv]) + '</span></td>';
        }).join('');
        return '<tr' + (p === near ? ' class="ap-near"' : '') + '><th class="num" scope="row">' + money(p) + (p === rows[0] ? '<span class="ap-tag">loan rate</span>' : '') + '</th><td class="num">' + money(plc, 0) + '</td>' + tds + '</tr>';
      }).join('');
      return '<h3 class="ap-h3">Which pays more, per base acre</h3><p class="ap-small">Rows: ' + year + ' national season-average price, from the loan rate up. Columns: county yield' +
        (c.both ? ' as % of each benchmark' : ' in bu/acre') + ' (bench = benchmark). Each cell shows the bigger payment and which program pays it. The PLC column is the same at any county yield; it uses your ' + c.py + ' bu PLC yield.' +
        (near != null ? ' Shaded row: closest to your price.' : '') + '</p><p class="ap-small ap-cue" hidden>Swipe sideways for more columns.</p>' +
        '<div class="ap-scroll"><table class="tbl ap-t ap-grid-t"><thead>' + hd + '</thead><tbody>' + body + '</tbody></table></div>';
    }
    function math(c) {
      var cr = c.crop, e = cr.erp;
      var ys = Object.keys(cr.mya).map(function (k) { return k + ': ' + money(cr.mya[k]); }).join(' &middot; ');
      var src = c.typed ? 'the benchmark you typed' : (c.parts.length ? 'FSA&rsquo;s official ' + D.fsa.py + ' county file' + (String(year) !== String(D.fsa.py) ? ' (FSA posts ' + year + ' later)' : '') : 'none yet');
      return '<details class="ap-det"><summary>How this was figured</summary><ul class="ap-list">' +
        '<li>' + esc(cr.label) + ' ' + year + ' effective reference price <b>' + money(e.erp) + '</b>' + (String(year) === '2027' ? ' (est.)' : '') + ': 88% of the Olympic average of ' + ys + ' is ' + money(e.pct_value) +
        '; the statutory price is ' + money(e.statutory) + ', the cap ' + money(e.cap) + '.</li>' +
        '<li>Benchmark price <b>' + money(cr.bp.value) + '</b> (same five years, each raised to at least ' + money(e.erp) + ', high and low dropped). Loan rate ' + money(cr.loan) + '.</li>' +
        '<li>Benchmark yield: ' + src + '.</li>' +
        '<li>PLC = (ERP &minus; the higher of price or loan rate) &times; PLC yield &times; 85%. ARC-CO = 90% of benchmark revenue &minus; county yield &times; the higher of price or loan rate, capped at 12% of benchmark revenue, &times; 85%.' + (c.both ? ' Irrigated and non-irrigated are figured separately and weighted by the farm&rsquo;s irrigated share.' : '') + '</li>' +
        '<li>Before the 5.7% sequestration cut USDA has applied to recent payments, and before the payment limit. An estimate, not a USDA determination.</li></ul></details>';
    }

    root.addEventListener('click', function (ev) {
      var t = ev.target.closest && ev.target.closest('.chip');
      if (!t || !D) return;
      save();
      if (t.getAttribute('data-crop')) crop = t.getAttribute('data-crop');
      if (t.getAttribute('data-year')) { year = parseInt(t.getAttribute('data-year'), 10); sset('ap2:year', year); }
      sset('ap2:crop', crop);
      restore(); futLine(); render();
    });
    stSel.addEventListener('change', function () {
      yTyped = false; sset('ap2:st', stSel.value); sset('ap2:co', '');
      coSel.disabled = true;
      loadState(stSel.value).then(function () { fillCounties(); fillPractice(); render(); }).catch(function () {
        coSel.innerHTML = '<option value="">Counties didn\u2019t load. Pick the state again.</option>';
      });
    });
    coSel.addEventListener('change', function () { yTyped = false; sset('ap2:co', coSel.value); fillPractice(); render(); });
    prSel.addEventListener('change', function () { yTyped = false; render(); });
    ['ap-base', 'ap-py', 'ap-by', 'ap-p', 'ap-share'].forEach(function (id) { $(id).addEventListener('input', function () { if (id === 'ap-by') yTyped = false; render(); }); });
    $('ap-y').addEventListener('input', function () { yTyped = $('ap-y').value !== ''; render(); });

    if (w.AgStates) w.AgStates.skeleton(out, 3);
    function start() {
      return fetch(root.getAttribute('data-src'), { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error(r.status); return r.json();
      }).then(function (data) {
        D = data;
        var today = new Date().toISOString().slice(0, 10);
        year = parseInt(q.year, 10) || sget('ap2:year') || (today <= D.default_year.until ? D.default_year.before : D.default_year.then);
        if (!D.years[String(year)]) year = D.default_year.before;
        if (!root.getAttribute('data-state') && !q.crop) { var lc = sget('ap2:crop'); if (lc && D.years[String(year)].crops[lc]) crop = lc; }
        var keys = Object.keys(D.states).sort(function (a, b) { return D.states[a].n < D.states[b].n ? -1 : 1; });
        stSel.innerHTML = '<option value="">Pick a state</option>' + keys.map(function (k) { return '<option value="' + k + '">' + esc(D.states[k].n) + '</option>'; }).join('');
        var st = q.st || root.getAttribute('data-state') || sget('ap2:st') || '';
        var fips = q.fips || root.getAttribute('data-fips') || (st === sget('ap2:st') ? sget('ap2:co') : '') || '';
        function go() {
          restore();
          ['py', 'by', 'p', 'base'].forEach(function (k) { if (q[k] && isFinite(parseFloat(q[k]))) $(ID[k]).value = q[k]; });
          render(); futLine();
        }
        if (D.states[st]) { stSel.value = st; loadState(st).then(function () { fillCounties(fips); go(); }).catch(go); }
        else go();
        fetch('/data/prices.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { fut = j; futLine(); }).catch(function () { futLine(); });
      }).catch(function () {
        if (w.AgStates) w.AgStates.error(out, { msg: 'The program data didn’t load.', retry: start });
        else out.innerHTML = '<p class="ap-need">The program data didn&rsquo;t load. Reload the page to try again.</p>';
      });
    }
    start();
  }

  function boot() { var root = d.querySelector('[data-arcplc]'); if (root) init(root); }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : this);
