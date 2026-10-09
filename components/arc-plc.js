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
      var p = c.parts[i], y = f == null ? p.y : (c.parts.length === 1 && f !== 1 ? Math.round(p.by * f * 10) / 10 : p.by * f); /* single: the bushels shown in the grid header (the bench column shows the exact benchmark) */
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
  /* c.scale: ticks per dollar, 100 (cents) for bushel crops, 10000 for FSA's pound crops */
  function ranges(c) {
    var sc = c.scale || 100, loC = Math.floor(c.loan * sc + 0.5), trig = c.erp;
    c.parts.forEach(function (p) { if (p.y > 0) trig = Math.max(trig, G * p.by * c.bp / p.y); });
    var hiC = Math.min(Math.ceil(trig * sc) + 1, Math.ceil(Math.max(c.erp, c.bp) * (1.5 * sc))), runs = [];
    for (var ct = loC; ct <= Math.max(hiC, loC); ct++) {
      var p = pay(c, ct / sc), wv = winner(p.plc, p.arc);
      if (runs.length && runs[runs.length - 1].w === wv) runs[runs.length - 1].hi = ct;
      else runs.push({ w: wv, lo: ct, hi: ct });
    }
    return runs;
  }
  function c2(ct, sc) { sc = sc || 100; return '$' + (ct / sc).toFixed(sc === 100 ? 2 : 4); }
  var WORD = { plc: 'PLC', arc: 'ARC-CO' };
  function rangeText(runs, sc) {
    var out = [], n = runs.length;
    runs.forEach(function (r, i) {
      var lo = c2(r.lo, sc), hi = c2(r.hi, sc);
      if (r.w === 'none') { out.push(i === n - 1 ? 'Neither pays at ' + lo + ' or higher.' : r.lo === r.hi ? 'Neither pays at ' + lo + '.' : 'Neither pays from ' + lo + ' to ' + hi + '.'); return; }
      var who = r.w === 'same' ? 'Both pay the same' : WORD[r.w] + ' pays more';
      if (i === 0) out.push(who + ' at ' + hi + ' or lower.');
      else if (i === n - 1) out.push(who + ' at ' + lo + ' or higher.');
      else out.push(r.lo === r.hi ? who + ' at ' + lo + '.' : who + ' from ' + lo + ' to ' + hi + '.');
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
  /* Plain checks on what was typed. v: numbers, NaN for something that is
     not a number. ref: {erp, by, official, multi}. Returns [{field, msg, drop}];
     drop means the value is not used. */
  var LBL = { base: 'Base acres', py: 'PLC yield', by: 'Benchmark yield', y: 'County yield', p: 'Price' };
  function checks(v, ref) {
    var out = [], bad = {};
    function add(k, msg, drop) { out.push({ field: k, msg: msg, drop: !!drop }); if (drop) bad[k] = true; }
    ['base', 'py', 'by', 'y', 'p'].forEach(function (k) {
      var x = v[k];
      if (x == null) return;
      if (typeof x !== 'number' || !isFinite(x)) add(k, LBL[k] + ' needs a plain number, like ' + (k === 'p' ? '4.10' : k === 'base' ? '120' : '180') + '.', true);
      else if (!(x > 0)) add(k, LBL[k] + ' must be more than zero.', true);
      else if (k === 'base' && x > 100000) add(k, 'Base acres over 100,000 on one farm is not likely. Check the number.', true);
      else if (k !== 'base' && k !== 'p' && x > (ref.unit === 'lb' ? 20000 : 1000)) add(k, LBL[k] + (ref.unit === 'lb' ? ' over 20,000 lb/acre' : ' over 1,000 bu/acre') + ' is not a real yield. Check the number.', true);
    });
    if (!bad.p && v.p > 0 && ref.erp > 0 && (v.p < ref.erp * 0.5 || v.p > ref.erp * 2)) {
      var guess = v.p / 100, uw = ref.unit === 'lb' ? 'pound' : 'bushel', dd = ref.unit === 'lb' ? 4 : 2;
      add('p', (v.p > ref.erp * 2 && guess >= ref.erp * 0.5 && guess <= ref.erp * 2) ? 'Did you mean $' + guess.toFixed(dd) + ' per ' + uw + '?' :
        'That is far from the $' + ref.erp.toFixed(dd) + ' reference price. Prices here are dollars per ' + uw + '.', v.p > ref.erp * 10);
    }
    if (!bad.by && v.by > 0 && ref.official > 0 && Math.abs(v.by / ref.official - 1) > 0.5) {
      add('by', 'That is ' + Math.round(Math.abs(v.by / ref.official - 1) * 100) + '% ' + (v.by > ref.official ? 'above' : 'below') + ' FSA’s official ' +
        ref.official.toFixed(2) + ' ' + (ref.unit === 'lb' ? 'lb' : 'bu') + ' benchmark for this practice. Check the number.');
    }
    if (!bad.py && !bad.by && v.py > 0 && ref.by > 0 && v.py > ref.by) add('py', ref.multi ?
      'That PLC yield is above this practice’s benchmark yield (' + ref.by.toFixed(2) + ' ' + (ref.unit === 'lb' ? 'lb' : 'bu') + '); check the practice. Use the PLC yield on your FSA-156EZ.' :
      'PLC yield is usually below the county average. Is this your APH? Use the PLC yield on your FSA-156EZ.');
    if (!bad.y && v.y > 0 && ref.by > 0 && v.y < ref.by * 0.1) add('y', 'That county yield is under 10% of the benchmark, so it is ignored and the benchmark is used.', true);
    return out;
  }

  /* Expected PLC and ARC-CO per base acre across past years. c.parts carry
     dy: {year: county yield / benchmark}, or one number for every year (2026:
     the crop is harvested, so a normal crop, 1, or the county yield typed /
     benchmark); ratios: {year: price multiplier}. Scenario year t: price =
     center x r_t (or the reader's price), county yield = benchmark x d_t, the
     same real year for both. o.borrowed: the spread is borrowed from corn, so
     the call stops at Leans. o.alt: a second, futures-implied center; where it
     disagrees with the first on the leader or on Pick, Pick becomes Leans.
     Mirrors scen_eval and scen_call in scripts/build_arc_plc.py. */
  var MIN_SCEN = 8, MIN_GAP = 2, LEAN_GAP = 3, MIN_WINS = 3;
  var T975 = [0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
    2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
  function tcrit(df) { return df > 30 ? 1.96 : T975[Math.max(1, df)]; }
  function call(mp, ma, md, se, pw, aw, n, borrowed) {
    if (n < MIN_SCEN) return 'withheld';
    if (cents(mp) < 50 && cents(ma) < 50) return 'none';
    var side = md > 0 ? 'plc' : 'arc', lw = side === 'plc' ? pw : aw, g = Math.abs(md), v;
    if (g > tcrit(n - 1) * se && g >= MIN_GAP && lw >= MIN_WINS) v = side;
    else if (g >= LEAN_GAP && g >= se && lw >= MIN_WINS) v = 'lean_' + side;
    else v = 'close';
    if (borrowed && (v === 'plc' || v === 'arc')) v = 'lean_' + v;
    return v;
  }
  function scenarios(c, center, ratios, price, o) {
    o = o || {};
    function dyv(p, t) { return typeof p.dy === 'number' ? p.dy : p.dy[t]; }
    var yrs = Object.keys(ratios).sort().filter(function (t) { return c.parts.every(function (p) { return typeof p.dy === 'number' || (p.dy && p.dy[t] != null); }); });
    var rows = yrs.map(function (t) {
      var pr = price != null ? price : center * ratios[t];
      var plc = perBase(plcRate(c.erp, pr, c.loan) * c.py);
      var arc = c.parts.reduce(function (s, p) { return s + p.w * perBase(arcRate(p.by, c.bp, p.by * dyv(p, t), pr, c.loan)); }, 0);
      return { t: +t, p: pr, plc: plc, arc: arc };
    });
    var n = rows.length, out = { n: n, rows: rows };
    if (!n) { out.verdict = 'withheld'; return out; }
    var mp = 0, ma = 0; rows.forEach(function (r) { mp += r.plc; ma += r.arc; }); mp /= n; ma /= n;
    var md = mp - ma, ss = 0;
    rows.forEach(function (r) { var x = r.plc - r.arc - md; ss += x * x; });
    var se = n > 1 ? Math.sqrt(ss / (n - 1)) / Math.sqrt(n) : 0;
    var pw = rows.filter(function (r) { return cents(r.plc) > cents(r.arc); }).length, aw = rows.filter(function (r) { return cents(r.arc) > cents(r.plc); }).length;
    out.plc = mp; out.arc = ma; out.diff = md; out.se = se; out.plcWins = pw; out.arcWins = aw; out.t = n > 1 ? tcrit(n - 1) : null;
    var fixed = price != null;
    out.verdict = call(mp, ma, md, se, pw, aw, n, o.borrowed && !fixed);
    if (o.borrowed && !fixed) out.borrowed = true;
    if (o.alt != null && !fixed) {
      var a = scenarios(c, o.alt, ratios);
      out.alt = { plc: a.plc, arc: a.arc, diff: a.diff, se: a.se, verdict: a.verdict };
      if (out.verdict === 'plc' || out.verdict === 'arc') {
        var la = a.diff > 0 ? 'plc' : 'arc';
        if (la !== out.verdict || a.verdict !== out.verdict) { out.verdict = 'lean_' + out.verdict; out.altDown = true; }
      }
    }
    return out;
  }
  /* the typical-farm run the build does for each county (typical_eval): yields
     fixed at a normal crop when the year's scenarios say so */
  function typical(cd, py, e) {
    var sc = cd && cd.scen;
    if (!sc) return null;
    if (sc.kind === 'noprice') return { verdict: 'noprice', n: 0 };
    return scenarios({ erp: cd.erp.erp, bp: cd.bp.value, loan: cd.loan, py: py, parts: [{ w: 1, by: e.by, dy: sc.fix ? 1 : e.dy }] },
      sc.center, sc.ratios, null, { borrowed: !!sc.borrowed, alt: sc.alt });
  }

  var M = { scenarios: scenarios, call: call, tcrit: tcrit, typical: typical, cents: cents, plcRate: plcRate, arcRate: arcRate, perBase: perBase, arcPerBase: arcPerBase, pay: pay, winner: winner,
    ranges: ranges, rangeText: rangeText, olympic: olympic, erpCalc: erpCalc, benchmarkPrice: benchmarkPrice, checks: checks };
  w.AgArcPlc = M;

  if (typeof document === 'undefined' || !document.querySelector) return;

  /* ------------------------------------------------------------- the page */
  var d = document;
  function $(id) { return d.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function money(v, k) { k = k == null ? 2 : k; v = Number(v); v += v >= 0 ? 1e-9 : -1e-9; /* 27.455 is 27.45499.. in binary; print 27.46 */
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: k, maximumFractionDigits: k }); }
  function pay$(v, k) { return cents(v) === 0 ? '$0' : money(v, k); }
  /* a typed number as words: never 1e-7, NaN or Infinity */
  function n$(x) { x = Number(x); return isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''; }
  /* null: empty. NaN: something typed that is not a usable number. */
  function num(el) {
    if (!el) return null;
    if (el.validity && el.validity.badInput) return NaN;
    if (el.value === '') return null;
    var v = Number(el.value); return isFinite(v) ? v : NaN;
  }
  function sget(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function sset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function sdel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  var DL = { all: 'All practices', irr: 'Irrigated', non: 'Non-irrigated' };
  var ID = { base: 'ap-base', py: 'ap-py', prac: 'ap-prac', share: 'ap-share', by: 'ap-by', y: 'ap-y', p: 'ap-p', farm: 'ap-farm' };
  /* hint ids each field is described by; warnings are added per render */
  var HINT = { base: ['ap-base-hint'], py: ['ap-py-hint'], by: ['ap-by-hint'], y: ['ap-y-hint'], p: ['ap-p-hint', 'ap-fut'], share: ['ap-share-hint'], prac: ['ap-prac-hint'], farm: ['ap-farm-hint'] };
  var TYPED = ['base', 'py', 'by', 'y', 'p', 'share', 'farm'];

  function init(root) {
    var D = null, fut = null, crop = root.getAttribute('data-crop') || 'corn', year = null, yTyped = false, preYear = null;
    var out = $('ap-out'), stSel = $('ap-st'), coSel = $('ap-co'), prSel = $('ap-prac'), embed = !!root.getAttribute('data-embed');
    var early = {};   /* what the reader typed before the data arrived */
    var q = {};
    try { (location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }); } catch (e) {}
    if (q.crop && /^[a-z_]+$/.test(q.crop)) crop = q.crop;   /* checked against the data once it loads */
    out.removeAttribute('aria-live');   /* the one-sentence region below speaks instead */

    /* pieces the page adds once: a quiet live region, the "earlier numbers"
       line, the county average PLC yield button, the printed list of inputs */
    function mk(tag, cls, html) { var e = d.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; }
    var live = mk('p', 'sr-only'); live.setAttribute('aria-live', 'polite'); live.id = 'ap-live'; root.appendChild(live);
    var grid0 = root.querySelector('.ap-grid');
    var restored = mk('p', 'ap-restored', 'Using numbers you entered earlier on this device. <button type="button" class="ap-use" id="ap-clear">Clear</button>');
    restored.hidden = true;
    if (grid0) grid0.parentNode.insertBefore(restored, grid0);
    var stErr = mk('p', 'ap-warn ap-f-wide ap-st-err'); stErr.hidden = true; stErr.setAttribute('role', 'alert');
    var coF = coSel.closest ? coSel.closest('.ap-f') : null;
    if (coF && coF.parentNode) coF.parentNode.insertBefore(stErr, coF.nextSibling);
    var pyUse = mk('button', 'ap-use ap-pyuse'); pyUse.type = 'button'; pyUse.hidden = true;
    var pyHint = $('ap-py-hint'); if (pyHint) pyHint.parentNode.insertBefore(pyUse, pyHint.nextSibling);
    var printIn = mk('div', 'ap-printin'); out.parentNode.insertBefore(printIn, out);
    /* county pages: the typical-farm blocks, hidden from a printout of your own numbers */
    if (root.getAttribute('data-fips')) {
      var tq = d.querySelectorAll('#quick-answer, .ap-wrap > .ap-verdict');
      for (var ti = 0; ti < tq.length; ti++) tq[ti].classList.add('ap-typical');
    }

    /* Saved numbers. One farm (FSA farm number when given) + crop + county:
       base, PLC yield, practice, irrigated share. The county benchmark and
       county yield also key on year and practice; the price, a national
       number, on crop and year. Nothing carries from one county to another. */
    function fips() { return coSel.value || ''; }
    function farmNo() { var f = $('ap-farm'); return f ? f.value.trim() : ''; }
    function pracKey() {
      if (prSel.value === 'both') return 'both';
      var e = entries()[parseInt(prSel.value, 10) || 0];
      return e ? e.d + (e.sub ? ':' + e.sub : '') : '';
    }
    function kFarm() { return 'ap3:f:' + farmNo() + '|' + crop + '|' + fips(); }
    function kYear() { return 'ap3:y:' + crop + '|' + year + '|' + fips() + '|' + pracKey(); }
    function kPrice() { return 'ap3:p:' + crop + '|' + year; }
    function any(o) { for (var k in o) if (o[k] !== '' && o[k] != null && o[k] !== false) return true; return false; }
    function put(k, o) { if (any(o)) sset(k, o); else sdel(k); }
    function save() {
      if (!D) return;
      var a = { base: $('ap-base').value, py: $('ap-py').value, share: $('ap-share').value === '50' ? '' : $('ap-share').value };
      if (any(a)) a.prac = pracKey();
      put(kFarm(), a);
      if (fips()) put(kYear(), { by: $('ap-by').value, y: yTyped ? $('ap-y').value : '' });
      put(kPrice(), { p: $('ap-p').value });
      if (fips()) { if (farmNo()) sset('ap3:farmno:' + fips(), farmNo()); else sdel('ap3:farmno:' + fips()); }
    }
    /* how: 'blank' empties what has no saved copy (new crop or year);
       'keep' leaves the farm's typed numbers when nothing is saved (new county) */
    function restore(how) {
      var fe = $('ap-farm');
      if (fe && !fe.value && fips()) fe.value = sget('ap3:farmno:' + fips()) || '';
      var a = sget(kFarm()), hit = false;
      if (a && (a.base || a.py || a.share)) {
        hit = true;
        $('ap-base').value = a.base || ''; $('ap-py').value = a.py || ''; $('ap-share').value = a.share || '50';
      } else if (how !== 'keep') { $('ap-base').value = ''; $('ap-py').value = ''; $('ap-share').value = '50'; }
      fillPractice(a && a.prac);
      var b = (fips() && sget(kYear())) || {}, p = sget(kPrice()) || {};
      $('ap-by').value = b.by || ''; $('ap-y').value = b.y || ''; yTyped = !!b.y;
      if (p.p || how !== 'keep') $('ap-p').value = p.p || '';
      hit = hit || any(b) || any(p);
      restored.hidden = !hit;
    }
    function clearAll() {
      [kFarm(), kYear(), kPrice()].forEach(sdel);
      ['ap-base', 'ap-py', 'ap-by', 'ap-y', 'ap-p'].forEach(function (id) { $(id).value = ''; });
      $('ap-share').value = '50'; yTyped = false;
      if ($('ap-farm')) { $('ap-farm').value = ''; if (fips()) sdel('ap3:farmno:' + fips()); }
      restored.hidden = true; render();
      try { $('ap-py').focus(); } catch (e) {}
    }
    try { for (var li = localStorage.length - 1; li >= 0; li--) { var lk = localStorage.key(li); if (/^ap2:c(y)?:/.test(lk)) localStorage.removeItem(lk); } } catch (e) {}   /* the old keys carried numbers across counties */

    function chips() {
      var cs = $('ap-crop'); if (cs && cs.value !== crop) cs.value = crop;
      var bs = root.querySelectorAll('.chip');
      for (var i = 0; i < bs.length; i++) {
        var c = bs[i].getAttribute('data-crop'), y = bs[i].getAttribute('data-year');
        bs[i].setAttribute('aria-pressed', (c ? c === crop : String(y) === String(year != null ? year : preYear)) ? 'true' : 'false');
      }
    }
    var SD = {};   /* per-state county files, loaded when a state is picked */
    function loadState(st) {
      if (!st || SD[st]) return Promise.resolve(SD[st]);
      return fetch(root.getAttribute('data-state-src') + st + '.json', { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error(r.status); return r.json();
      }).then(function (j) { SD[st] = j; return j; });
    }
    /* a state's counties did not load: say so, with a retry that brings the county list back */
    function stateFailed(st, keep) {
      coSel.disabled = true;
      coSel.innerHTML = '<option value="">Counties did not load</option>';
      stErr.innerHTML = 'The ' + esc(D.states[st] ? D.states[st].n : st) + ' county list did not load. You can still type a benchmark yield below. <button type="button" class="ap-use">Try again</button>';
      stErr.hidden = false;
      stErr.querySelector('button').onclick = function () {
        stErr.innerHTML = 'Loading the county list.';
        pickState(st, keep);
      };
    }
    function pickState(st, keep) {
      coSel.disabled = true;
      return loadState(st).then(function () {
        if (stSel.value !== st) return;
        stErr.hidden = true;
        fillCounties(keep); restore('keep'); render();
      }).catch(function () { if (stSel.value === st) stateFailed(st, keep); });
    }
    function county() {
      var S = D && SD[stSel.value];
      if (!S || !coSel.value) return null;
      for (var i = 0; i < S.c.length; i++) if (S.c[i].f === coSel.value) return S.c[i];
      return null;
    }
    function entries() { var c = county(); return (c && c.k[crop]) || []; }
    function cropInfo() { var y = D && (D.years['2026'].crops[crop] || D.years['2027'].crops[crop]); return y || { unit: 'bu', label: crop }; }
    function U() { return cropInfo().unit === 'lb' ? 'lb' : 'bu'; }
    function YMAX() { return U() === 'lb' ? 20000 : 1000; }
    function pm(v) { var cr = cropInfo(); return cr.unit === 'lb' ? '$' + Number(v).toFixed(4) : (cr.dp > 2 ? '$' + Number(v).toFixed(4).replace(/(\.\d\d\d?)0+$/, '$1') : money(v)); }
    function fillPractice(keep) {
      var es = entries(), opts = es.map(function (e, i) { return { v: String(i), k: e.d + (e.sub ? ':' + e.sub : ''), t: DL[e.d] + (e.sub ? ', ' + e.sub : '') + ' (' + e.by.toFixed(2) + ' ' + U() + ')' }; });
      var hasI = -1, hasN = -1;
      es.forEach(function (e, i) { if (!e.sub && e.d === 'irr') hasI = i; if (!e.sub && e.d === 'non') hasN = i; });
      if (hasI >= 0 && hasN >= 0) opts.push({ v: 'both', k: 'both', t: 'Both, by this farm’s irrigated share' });
      prSel.innerHTML = opts.map(function (o) { return '<option value="' + o.v + '">' + esc(o.t) + '</option>'; }).join('');
      var kept = keep != null && opts.filter(function (o) { return o.k === keep; })[0];
      if (kept) prSel.value = kept.v;
      else {
        /* non-irrigated by default; irrigated when the county's average PLC
           yield is above the non-irrigated benchmark (most base there is irrigated) */
        var cty = county(), avg = cty && cty.plc && cty.plc[crop];
        var dn = es.findIndex(function (e) { return e.d !== 'irr'; });
        if (hasI >= 0 && hasN >= 0 && avg > es[hasN].by) dn = hasI;
        if (dn >= 0) prSel.value = String(dn);
      }
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
      var c = yc();
      if (!c || !c.futures) { el.innerHTML = 'You set the price. We do not forecast it.'; return; }
      var key = c.futures.key, qv = fut && fut.quotes && fut.quotes[key];
      function has(x) { return !!x && (Array.isArray(x) ? x.indexOf(key) >= 0 : Object.prototype.hasOwnProperty.call(x, key)); }
      var bad = fut && (has(fut.stale_keys) || has(fut.withheld_keys) || has(fut.retired_keys));
      if (!qv || bad || !(qv.close > 0)) { el.innerHTML = 'You set the price. We do not forecast it.'; return; }
      el.innerHTML = esc(c.futures.label) + ' today, not adjusted: <b>' + money(Math.round(qv.close) / 100) + '</b>. ' +
        '<span class="ap-fut-note">A futures price, not a forecast of the season-average price, which usually runs below futures by about the national basis.</span> ' +
        (w.AgAsOf ? w.AgAsOf.html(fut.fetched, 'prices', { prefix: 'Futures as of' }) : '');
      links();
    }
    function links() { if (!embed) return; var as = root.querySelectorAll('a[href]'); for (var i = 0; i < as.length; i++) { as[i].target = '_blank'; as[i].rel = 'noopener'; } }
    function hints() {
      var c = yc(), u = U();
      $('ap-p-hint').textContent = 'USDA national season-average price for ' + c.my + ', not your local cash price.';
      $('ap-p').placeholder = 'You set this (ERP ' + pm(c.erp.erp) + ')';
      $('ap-p').step = u === 'lb' ? '0.0001' : '0.01';
      $('ap-py-l').textContent = 'PLC payment yield (' + u + '/acre)';
      $('ap-by-l').textContent = 'ARC-CO benchmark yield (' + u + '/acre)';
      $('ap-p-l').textContent = 'Expected season-average price ($/' + u + ')';
    }
    function cfg() {
      var c = yc(), es = entries(), base = { erp: c.erp.erp, bp: c.bp.value, loan: c.loan, crop: c, scale: c.unit === 'lb' ? 10000 : 100 };
      var v = { base: num($('ap-base')), py: num($('ap-py')), by: num($('ap-by')), y: num($('ap-y')), p: num($('ap-p')) };
      var both = prSel.value === 'both' && es.length > 1;
      var pick = both ? null : es[parseInt(prSel.value, 10) || 0];
      var official = pick ? pick.by : null;
      var by = v.by > 0 && v.by <= YMAX() ? v.by : official;
      var msgs = checks(v, { erp: c.erp.erp, by: by, official: official, multi: es.length > 1, unit: c.unit });
      msgs.forEach(function (m) { if (m.drop) v[m.field] = null; });
      base.py = v.py; base.basev = v.base; base.price = v.p; base.msgs = msgs; base.typed = v.by > 0; base.both = both; base.official = official;
      if (both) {
        var s0 = num($('ap-share')), sh = s0 == null || !isFinite(s0) ? 50 : s0;
        if (s0 != null && !isFinite(s0)) msgs.push({ field: 'share', msg: 'Irrigated share needs a plain number from 0 to 100, so 50% is used.', drop: true });
        else if (sh < 0 || sh > 100) { var cl = Math.min(100, Math.max(0, sh)); msgs.push({ field: 'share', msg: 'Irrigated share runs from 0 to 100%, so ' + cl + '% is used.' }); sh = cl; }
        sh /= 100;
        base.share = sh;
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
    /* the fields' descriptions: their hints, plus any warning on them */
    function describe(msgs) {
      Object.keys(HINT).forEach(function (k) {
        var el = $(ID[k]); if (!el) return;
        var ids = HINT[k].filter(function (id) { return $(id); }), bad = false;
        msgs.forEach(function (m, i) { if (m.field === k) { ids.push('ap-warn-' + i); if (m.drop) bad = true; } });
        if (ids.length) el.setAttribute('aria-describedby', ids.join(' ')); else el.removeAttribute('aria-describedby');
        if (bad) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
      });
    }
    var cueRO = null;
    function cue() {
      var sc = out.querySelector('.ap-scroll'), cu = out.querySelector('.ap-cue');
      if (sc && cu) cu.hidden = sc.scrollWidth <= sc.clientWidth + 2;
    }
    var sayT = null, said = '';
    function say(txt) {
      clearTimeout(sayT);
      sayT = setTimeout(function () { if (txt && txt !== said) { said = txt; live.textContent = txt; } }, 500);
    }
    function printList(c) {
      var rows = [], S = D.states[stSel.value], es = entries();
      var co = coSel.value && coSel.selectedIndex >= 0 ? coSel.options[coSel.selectedIndex].text : '';
      if (S) rows.push(['County', co ? co + ', ' + S.n : S.n + ' (no county picked)']);
      if (es.length > 1 && prSel.selectedIndex >= 0) rows.push(['Practice', prSel.options[prSel.selectedIndex].text]);
      if (c.both) rows.push(['Irrigated share', n$(c.share * 100) + '%']);
      rows.push(['Crop and program year', c.crop.label + ', ' + year]);
      if (farmNo()) rows.push(['FSA farm number', farmNo()]);
      rows.push(['Base acres', c.basev > 0 ? n$(c.basev) : 'Not entered; results are per base acre']);
      rows.push(['PLC payment yield', n$(c.py) + ' ' + U()]);
      rows.push(['ARC-CO benchmark yield', c.both ? 'FSA official, irrigated ' + c.parts[0].by.toFixed(2) + ' ' + U() + ' and non-irrigated ' + c.parts[1].by.toFixed(2) + ' ' + U() :
        n$(c.parts[0].by) + ' ' + U() + ' (' + (c.typed ? 'typed in' : 'FSA official') + ')']);
      rows.push(['Expected county yield', c.both ? n$(c.pct) + '% of each benchmark' : n$(c.parts[0].y) + ' ' + U()]);
      rows.push(['Season-average price', c.price != null ? pm(c.price) + ' per ' + (U() === 'lb' ? 'pound' : 'bushel') : 'Not entered']);
      return '<h3 class="ap-h3">Numbers entered</h3><table class="tbl ap-t"><tbody>' + rows.map(function (r) {
        return '<tr><th scope="row">' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</tbody></table>';
    }
    function render() {
      if (!D) return;
      chips();
      if (!yc()) {   /* a crop whose figures for this year wait on a final price */
        var pn = (D.years[String(year)].pending || {})[crop];
        out.innerHTML = '<p class="ap-need">' + (pn || 'No ' + year + ' figures for this crop yet.') + ' Pick the other year.</p>';
        try { d.dispatchEvent(new CustomEvent('arcplc:render')); } catch (e) {}
        return;
      }
      hints();
      var es = entries();
      $('ap-share-f').hidden = prSel.value !== 'both' || es.length < 2;
      var both = prSel.value === 'both' && es.length > 1;
      $('ap-y-l').textContent = both ? 'Expected county yield, % of each benchmark' : 'Expected ' + year + ' county yield (' + U() + '/acre)';
      $('ap-y-hint').textContent = String(year) === '2026' ?
        'County average, not your farm. The 2026 crop is mostly harvested: left at the benchmark, the 2026 call figures a normal crop; type the county yield if you know it and the call uses it.' :
        'County average, not your farm. It sets the one-price check and where the programs cross; the 2027 call uses the county\u2019s own yields from past years.';
      var c0 = yc(), pick = both ? null : es[parseInt(prSel.value, 10) || 0];
      var bh = $('ap-by-hint');
      if (both) bh.textContent = 'Using FSA’s official irrigated and non-irrigated benchmarks.';
      else if (pick) bh.innerHTML = 'FSA official ' + D.fsa.py + ' benchmark: <b>' + pick.by.toFixed(2) + ' ' + U() + '</b> (' + esc(DL[pick.d]) + ').' +
        (String(year) !== String(D.fsa.py) ? ' FSA posts the ' + year + ' benchmark later; it shifts the window one year.' : '') + ' Leave blank to use it.';
      else if (county() && !D.fsa) bh.textContent = 'FSA’s official 2026 benchmarks are not loaded here yet. Ask the county office for the ARC-CO benchmark yield for your county, crop and practice (irrigated or not), and type it here.';
      else if (county()) bh.textContent = 'FSA’s file has no ' + c0.label.toLowerCase() + ' benchmark for this county. Ask the county office for the ARC-CO benchmark yield for your county, crop and practice, and type it here.';
      else bh.textContent = 'Fills in from FSA’s official county file when we have it. You can type the number your county office gives you.';
      var pyh = $('ap-py-hint'), cty = county(), avg = cty && cty.plc && cty.plc[crop];
      pyh.textContent = 'On the FSA-156EZ for the farm. Each farm has its own.' + (avg ? ' County average on enrolled base: ' + avg.toFixed(1) + ' ' + U() + ' (FSA, ' + D.plc_county.py + ').' : '');
      pyUse.hidden = !avg;
      if (avg) { pyUse.textContent = 'Use county average PLC yield (' + avg.toFixed(1) + ' ' + U() + ')'; pyUse.setAttribute('data-v', avg.toFixed(1)); }
      if (!yTyped && !both) { var c1 = cfg(); $('ap-y').value = c1.by ? String(c1.by) : ''; }
      if (!yTyped && both) $('ap-y').value = '100';
      var c = cfg(), h = '', said1 = '';
      c.msgs.forEach(function (m, i) { h += '<p class="ap-warn" id="ap-warn-' + i + '">' + esc(m.msg) + '</p>'; });
      describe(c.msgs);
      var need = [];
      if (!(c.py > 0)) need.push('your PLC payment yield');
      if (!c.parts.length) need.push('a county benchmark yield');
      if (!need.length) h += decide(c);
      if (c.price != null && !need.length) {
        var p = pay(c, c.price), wv = winner(p.plc, p.arc), base = c.basev || 0;
        var verdict = wv === 'none' ? 'One point check: at the price and yield you entered, neither program pays.' : wv === 'same' ? 'One point check: at the price and yield you entered, both pay the same.' :
          'One point check: at the price and yield you entered, ' + WORD[wv] + ' pays more.';
        var yl = c.both ? n$(c.pct) + '% of the benchmark yields' : 'a ' + n$(c.parts[0].y) + ' ' + U() + ' county yield';
        h += '<div class="ap-verdict ap-w-' + wv + '"><p><b>' + verdict + '</b> At ' + pm(c.price) + ' and ' + yl + ', PLC pays ' + pay$(p.plc) + ' and ARC-CO pays ' + pay$(p.arc) + ' per base acre.</p>';
        said1 = 'At ' + pm(c.price) + ': PLC ' + pay$(p.plc) + ', ARC-CO ' + pay$(p.arc) + ' per base acre.';
        var maxArc = c.parts.reduce(function (s, x) { return s + x.w * perBase(CAP * x.by * c.bp); }, 0);
        h += '<p class="ap-small">Most ARC-CO can pay: ' + pay$(maxArc) + ' per base acre. PLC at the ' + pm(c.loan) + ' loan rate: ' + pay$(perBase(plcRate(c.erp, 0, c.loan) * c.py)) + ' per base acre.</p></div>';
        var plcR = plcRate(c.erp, c.price, c.loan), arcR = c.parts.reduce(function (s, x) { return s + x.w * arcRate(x.by, c.bp, x.y, c.price, c.loan); }, 0);
        h += '<div class="ap-cards">' + card('PLC', pay$(p.plc), 'per base acre<br>rate ' + (plcR > 0 ? pm(plcR) : '$0') + ' per ' + (U() === 'lb' ? 'pound' : 'bushel'), p.plc, base) +
          card('ARC-CO', pay$(p.arc), 'per base acre<br>' + pay$(arcR) + ' per acre before the 85% factor', p.arc, base) + '</div>';
      } else if (need.length) {
        h += '<p class="ap-need">Add ' + need.join(' and ') + ' to compare the two programs.</p>';
      } else {
        h += '<p class="ap-need">Set a season-average price to see the dollars at one price. The table below covers a range.</p>';
      }
      if (!need.length) {
        var runs = ranges(c);
        var cross = rangeText(runs, c.scale);
        h += '<h3 class="ap-h3">Where they cross at ' + (c.both ? n$(c.pct) + '% of the benchmarks' : 'a ' + n$(c.parts[0].y) + ' ' + U() + ' county yield') + '</h3><p class="ap-cross">' + esc(cross.join(' ')) + '</p>';
        h += grid(c);
        h += '<p class="ap-small">ARC-CO pays more when the county yield drops while the price holds; PLC pays more when the national price falls.</p>';
      }
      h += math(c);
      var det = out.querySelector('.ap-det'), open = det && det.open;
      out.innerHTML = h;
      if (open && out.querySelector('.ap-det')) out.querySelector('.ap-det').open = true;
      out.removeAttribute('aria-busy');
      printIn.innerHTML = need.length ? '' : printList(c);
      root.classList.toggle('ap-has-out', !need.length);
      d.documentElement.classList.toggle('ap-calc-on', !need.length);
      cue();
      if (!cueRO && w.ResizeObserver) { try { cueRO = new ResizeObserver(cue); cueRO.observe(out); } catch (e) {} }
      links();
      /* one sentence for screen readers: this year's verdict and the point check */
      var cur = out.querySelector('.ap-decide .ap-cur b');
      say(need.length ? 'Add ' + need.join(' and ') + ' to compare the two programs.' : ((cur ? cur.textContent + ' ' : '') + said1).trim());
      save();
      try { d.dispatchEvent(new CustomEvent('arcplc:render')); } catch (e) {}
    }
    var VW = { plc: 'Pick PLC', arc: 'Pick ARC-CO', lean_plc: 'Leans PLC', lean_arc: 'Leans ARC-CO', close: 'Close, either one', none: 'Neither expected to pay',
      withheld: 'Not enough history to say', noprice: 'No ' + 2027 + ' price yet' };
    var VC = { plc: 'plc', arc: 'arc', lean_plc: 'lean-plc', lean_arc: 'lean-arc', close: 'close', none: 'neither' };
    function vcls(v) { return 'ap-w-' + (VC[v] || 'withheld'); }
    var why = '';
    /* one plain sentence, numbers beside the call; mirrors verdict_line in the build script */
    function vline(Y, v) {
      if (v.verdict === 'withheld') return '<b>' + Y + ': not enough history to say.</b> ' + v.n + ' past years with both a price and a county yield; we need ' + MIN_SCEN + '.' + (why ? ' ' + why : '');
      if (v.verdict === 'noprice') return '<b>' + Y + ': no ' + Y + ' price yet.</b> There is no ' + Y + ' price outlook for this crop we can check against past years, so no call. Type a price to see the dollars at that price.';
      var nums = 'Expected ' + pay$(v.plc) + ' PLC vs ' + pay$(v.arc) + ' ARC-CO per base acre; PLC paid more in ' + v.plcWins + ' of ' + v.n + ' past-year scenarios, ARC-CO in ' + v.arcWins + '.';
      if (v.verdict === 'none') return '<b>' + Y + ': neither expected to pay.</b> ' + nums;
      if (v.verdict === 'close') return '<b>' + Y + ': close, either one.</b> About ' + money(Math.abs(v.diff)) + ' apart, too small or too uncertain to call. ' + nums;
      var note = (v.borrowed && v.verdict.indexOf('lean_') === 0 ? ' Capped at Leans: this crop borrows corn&rsquo;s price swings.' : '') +
        (v.altDown ? ' Not a clear pick: a futures-based price start gives a different call.' : '');
      if (v.verdict.indexOf('lean_') === 0) {
        var side = v.verdict.slice(5), other = side === 'plc' ? 'arc' : 'plc', ow = side === 'plc' ? v.arcWins : v.plcWins;
        return '<b>' + Y + ': ' + VW[v.verdict] + ': expected about ' + money(Math.abs(v.diff)) + ' more per base acre; ' +
          (ow === 0 ? WORD[other] + ' did not pay more in any of the ' + v.n + ' years, but the gap is within the normal swing.' :
            'but the gap is within the normal swing, so ' + WORD[other] + ' is a defensible choice.') + '</b> ' + nums + note;
      }
      return '<b>' + Y + ': ' + VW[v.verdict] + '.</b> ' + nums + note;
    }
    function decide(c) {
      var h = '<div class="ap-decide"><h3 class="ap-h3">ARC-CO or PLC for this farm</h3>', cur = null;
      [2026, 2027].forEach(function (Y) {
        var yd = D.years[String(Y)], cr = yd && yd.crops[crop];
        if (!cr) {
          var pn = yd && (yd.pending || {})[crop];
          if (pn) h += '<div class="ap-verdict ap-w-withheld"><p><b>' + Y + ':</b> ' + pn + '</p></div>';
          return;
        }
        var sc = cr.scen;
        if (!sc) return;
        var parts = c.parts.map(function (p) { return { w: p.w, by: p.by, y: p.y, d: p.d, dsrc: p.dsrc, dy: sc.fix ? p.y / p.by : p.dy }; });
        if (!sc.fix && !parts.every(function (p) { return p.dy; })) {
          h += '<div class="ap-verdict ap-w-withheld"><p><b>' + Y + ':</b> pick your county to get a ' + Y + ' call: it uses the county&rsquo;s own yields from FSA&rsquo;s files.</p></div>';
          return;
        }
        var cy = { erp: cr.erp.erp, bp: cr.bp.value, loan: cr.loan, py: c.py, parts: parts };
        var v = sc.kind === 'noprice' ? { verdict: 'noprice', n: 0 } : scenarios(cy, sc.center, sc.ratios, null, { borrowed: !!sc.borrowed, alt: sc.alt });
        why = sc.why || '';
        if (Y === year) cur = { v: v, cr: cr, cy: cy, sc: sc };
        h += '<div class="ap-verdict ' + vcls(v.verdict) + (Y === year ? ' ap-cur' : '') + '"><p>' + vline(Y, v) + '</p></div>';
      });
      if (cur && cur.v.n) {
        var v = cur.v, cr = cur.cr, cy = cur.cy, sc = cur.sc;
        var maxP = perBase(plcRate(cy.erp, 0, cy.loan) * cy.py), maxA = cy.parts.reduce(function (s, p) { return s + p.w * perBase(CAP * p.by * cy.bp); }, 0);
        var paid = v.rows.filter(function (r) { return r.arc > 0; }).length;
        h += '<p><b>Why.</b> PLC pays on any season-average price below ' + pm(cy.erp) + ', up to ' + money(maxP) + ' per base acre at the ' + pm(cy.loan) +
          ' loan rate, so it protects against a deep price drop. ARC-CO is capped at ' + money(maxA) + ' per base acre but also pays when the county&rsquo;s yield is short; it paid something in ' +
          paid + ' of the ' + v.n + ' past-year scenarios. With prices centered at ' + pm(sc.center) + ', PLC is expected to pay ' + pay$(v.plc) + ' and ARC-CO ' + pay$(v.arc) + ' per base acre.</p>';
        if (c.price != null) {
          var u = scenarios(cy, sc.center, sc.ratios, c.price);
          h += '<p>At your ' + pm(c.price) + ' price, across the same ' + u.n + ' years: PLC ' + pay$(u.plc) + ' vs ARC-CO ' + pay$(u.arc) +
            ' per base acre; PLC more in ' + u.plcWins + ', ARC-CO in ' + u.arcWins + '. ' + (u.verdict === 'withheld' ? '' : VW[u.verdict] + ' at that price.') + '</p>';
        }
        var ysrc = sc.fix ? (yTyped ? 'the county yield you typed, every year (the ' + year + ' crop is harvested)' : 'a normal county crop (the benchmark) every year, since the ' + year + ' crop is mostly harvested') :
          (c.parts.some(function (p) { return p.dsrc === 'state'; }) ? 'the state average for this crop and practice (the county has too few years)' : 'this county&rsquo;s FSA yields') + ' in the same year';
        var how = { oct: 'how far each past year&rsquo;s season-average price ended from its October futures (scaled to average 1)', fut: 'each past year&rsquo;s price change, scaled to average 1',
          yoy_scaled: 'each past year&rsquo;s price change, scaled to average 1 and to the size of corn&rsquo;s October swings', corn_oct: 'corn&rsquo;s October swings (this crop has too few years of its own price history)',
          yoy: 'each past year&rsquo;s price change' }[sc.kind] || 'past price changes';
        h += '<p class="ap-small">Scenarios: ' + sc.center_label + ', ' + pm(sc.center) + ', moved by ' + how + ', ' +
          v.rows[0].t + ' to ' + v.rows[v.rows.length - 1].t + ' (' + v.n + ' years), paired with ' + ysrc + '.' +
          (sc.alt != null ? ' Futures-based start for comparison: ' + pm(sc.alt) + ' (' + esc(sc.alt_contract || '') + ' October average so far, ' + sc.alt_days + ' of ' + sc.alt_of + ' days, &times; ' + sc.oct_mean.toFixed(3) + ').' : '') +
          ' Pick: the gap is more than ' + (v.t ? v.t.toFixed(2) : '') + ' times its standard error, at least ' + money(MIN_GAP) + ', and the leader paid more in at least ' + MIN_WINS +
          ' years. Leans: at least ' + money(LEAN_GAP) + ' and one standard error, leader ahead in at least ' + MIN_WINS + ' years. SCO can now go with either program, so it is no reason to pick PLC. <a href="/arc-plc#method">Method and back-test</a>.</p>';
      }
      return h + '</div>';
    }
    function card(k, v, sub, per, base) {
      var tot = base ? per * base : 0, lim = D.params.payment_limit_2025;
      return '<div class="ap-card"><span class="k">' + k + '</span><span class="v">' + v + '</span><span class="s">' + sub +
        (base ? '<br>' + pay$(tot, 0) + ' on ' + n$(base) + ' base acres, before the 5.7% sequestration cut' : '') + '</span>' +
        (tot > lim ? '<span class="s ap-warn">If you pick ' + k + ', this alone is over ' + money(lim, 0) + ', USDA’s 2025 limit (' + year + ' not announced). The limit is per person across all crops and farms; actively engaged LLC and S corporation members can each carry one.</span>' : '') + '</div>';
    }
    function grid(c) {
      var g = c.crop.grid, cols = [0.8, 0.9, 1, 1.1], sc = c.scale || 100, rows = [Math.round(c.loan * sc) / sc];
      for (var k = Math.ceil((c.loan + 1e-9) / g.step); k * g.step <= g.hi + 1e-9; k++) { var pp = Math.round(k * g.step * sc) / sc; if (pp > c.loan) rows.push(pp); }
      var hd = '<tr><th class="num" scope="col">Price</th><th class="num" scope="col">PLC</th>' + cols.map(function (f) {
        var lab = c.both ? Math.round(f * 100) + '%' : (f === 1 ? n$(c.parts[0].by) : (Math.round(c.parts[0].by * f * 10) / 10).toFixed(1)) + '<span class="ap-u"> ' + U() + '</span>';
        return '<th class="num" scope="col">' + lab + '<br><span class="ap-pct">' + (f === 1 ? 'bench' : (f > 1 ? '+' : '&minus;') + Math.round(Math.abs(f - 1) * 100) + '%') + '</span></th>';
      }).join('') + '</tr>';
      var near = c.price != null ? rows.reduce(function (a, b) { return Math.abs(b - c.price) < Math.abs(a - c.price) ? b : a; }, rows[0]) : null;
      var body = rows.map(function (p) {
        var plc = perBase(plcRate(c.erp, p, c.loan) * c.py);
        var tds = cols.map(function (f) {
          var arc = arcPerBase(c, p, f), wv = winner(plc, arc), v = wv === 'plc' ? plc : arc;
          if (wv !== 'none' && Math.round(plc) === Math.round(arc)) wv = 'same';   /* the cell shows whole dollars */
          return '<td class="num ap-w-' + wv + '">' + pay$(v, 0) + ' <span class="ap-tag">' + (wv === 'none' ? 'neither' : wv === 'same' ? 'same' : WORD[wv]) + '</span></td>';
        }).join('');
        var tags = (p === rows[0] ? ' <span class="ap-tag">loan rate</span>' : '') + (p === near ? ' <span class="ap-tag">near your price</span>' : '');
        return '<tr' + (p === near ? ' class="ap-near" aria-current="true"' : '') + '><th class="num" scope="row">' + pm(p) + tags + '</th><td class="num">' + pay$(plc, 0) + '</td>' + tds + '</tr>';
      }).join('');
      return '<h3 class="ap-h3">Which pays more, per base acre</h3><p class="ap-small">Rows: ' + year + ' national season-average price, from the loan rate up. Columns: county yield' +
        (c.both ? ' as % of each benchmark' : ' in ' + U() + '/acre') + ' (bench = benchmark). Each cell shows the bigger payment and which program pays it. The PLC column is the same at any county yield; it uses your ' + n$(c.py) + ' ' + U() + ' PLC yield.' +
        (near != null ? ' Marked row: closest to your price.' : '') + '</p><p class="ap-small ap-cue" hidden>Swipe sideways for more columns.</p>' +
        '<div class="ap-scroll"><table class="tbl ap-t ap-grid-t"><caption class="sr-only">Which pays more per base acre: rows are the ' + year + ' season-average price, columns the county yield' +
        (c.both ? ' as a share of each benchmark' : '') + '</caption><thead>' + hd + '</thead><tbody>' + body + '</tbody></table></div>';
    }
    function math(c) {
      var cr = c.crop, e = cr.erp;
      var ys = Object.keys(cr.mya).map(function (k) { return k + ': ' + pm(cr.mya[k]); }).join(' &middot; ');
      var src = c.typed ? 'the benchmark you typed' : (c.parts.length ? 'FSA&rsquo;s official ' + D.fsa.py + ' county file' + (String(year) !== String(D.fsa.py) ? ' (FSA posts ' + year + ' later)' : '') : 'none yet');
      return '<details class="ap-det"><summary>How this was figured</summary><ul class="ap-list">' +
        '<li>' + esc(cr.label) + ' ' + year + ' effective reference price <b>' + pm(e.erp) + '</b>' + (String(year) === '2027' ? ' (est.)' : '') +
        (e.pct_value != null ? ': 88% of the Olympic average of ' + ys + ' is ' + pm(e.pct_value) : '. ' + (cr.note || '')) +
        '; the statutory price is ' + pm(e.statutory) + ', the cap ' + pm(e.cap) + '.</li>' +
        '<li>Benchmark price <b>' + pm(cr.bp.value) + '</b> (same five years, each raised to at least ' + pm(e.erp) + ', high and low dropped). Loan rate ' + pm(cr.loan) + '.</li>' +
        '<li>Benchmark yield: ' + src + '.</li>' +
        '<li>PLC = (ERP &minus; the higher of price or loan rate) &times; PLC yield &times; 85%. ARC-CO = 90% of benchmark revenue &minus; county yield &times; the higher of price or loan rate, capped at 12% of benchmark revenue, &times; 85%.' + (c.both ? ' Irrigated and non-irrigated are figured separately and weighted by the farm&rsquo;s irrigated share.' : '') + '</li>' +
        '<li>Before the 5.7% sequestration cut USDA has applied to recent payments, and before the payment limit. An estimate, not a USDA determination.</li></ul></details>';
    }

    var cropSel = $('ap-crop');
    if (cropSel) cropSel.addEventListener('change', function () {
      if (!D) return;
      save(); crop = cropSel.value; sset('ap2:crop', crop);
      restore(); futLine(); render();
    });
    root.addEventListener('click', function (ev) {
      var t = ev.target.closest && ev.target.closest('.chip');
      if (!t) return;
      if (!D) {   /* before the data arrives: remember the pick, apply it when it does */
        if (t.getAttribute('data-crop')) { crop = t.getAttribute('data-crop'); sset('ap2:crop', crop); }
        if (t.getAttribute('data-year')) { preYear = parseInt(t.getAttribute('data-year'), 10); sset('ap2:year', preYear); }
        chips(); return;
      }
      save();
      if (t.getAttribute('data-crop')) crop = t.getAttribute('data-crop');
      if (t.getAttribute('data-year')) { year = parseInt(t.getAttribute('data-year'), 10); sset('ap2:year', year); }
      sset('ap2:crop', crop);
      restore('blank'); futLine(); render();
    });
    restored.querySelector('button').addEventListener('click', clearAll);
    pyUse.addEventListener('click', function () { $('ap-py').value = pyUse.getAttribute('data-v') || ''; render(); });
    stSel.addEventListener('change', function () {
      if (!D) return;
      yTyped = false; sset('ap2:st', stSel.value); sset('ap2:co', '');
      $('ap-by').value = ''; $('ap-y').value = '';   /* a benchmark belongs to one county */
      stErr.hidden = true;
      if (!stSel.value) { fillCounties(); restore('keep'); render(); return; }
      pickState(stSel.value);
    });
    coSel.addEventListener('change', function () { yTyped = false; sset('ap2:co', coSel.value); restore('keep'); render(); });
    prSel.addEventListener('change', function () { yTyped = false; render(); });
    TYPED.forEach(function (k) {
      var el = $(ID[k]); if (!el) return;
      el.addEventListener('input', function () {
        if (!D) { early[k] = el.value; if (k === 'y') yTyped = el.value !== ''; return; }
        if (k === 'by') yTyped = false;
        if (k === 'y') yTyped = el.value !== '';
        if (k !== 'farm') render();
      });
    });
    if ($('ap-farm')) $('ap-farm').addEventListener('change', function () { if (D) { restore('keep'); render(); } });
    w.addEventListener('resize', cue);

    if (w.AgStates) w.AgStates.skeleton(out, 3);
    function start() {
      return fetch(root.getAttribute('data-src'), { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error(r.status); return r.json();
      }).then(function (data) {
        D = data;
        var today = new Date().toISOString().slice(0, 10);
        year = parseInt(q.year, 10) || preYear || sget('ap2:year') || (today <= D.default_year.until ? D.default_year.before : D.default_year.then);
        if (!D.years[String(year)]) year = D.default_year.before;
        if (!D.years['2026'].crops[crop]) crop = 'corn';
        if (!root.getAttribute('data-state') && !q.crop) { var lc = sget('ap2:crop'); if (lc && D.years[String(year)].crops[lc]) crop = lc; }
        var keys = Object.keys(D.states).sort(function (a, b) { return D.states[a].n < D.states[b].n ? -1 : 1; });
        stSel.innerHTML = '<option value="">Pick a state</option>' + keys.map(function (k) { return '<option value="' + k + '">' + esc(D.states[k].n) + '</option>'; }).join('');
        var st = q.st || root.getAttribute('data-state') || sget('ap2:st') || '';
        var fp = q.fips || root.getAttribute('data-fips') || (st === sget('ap2:st') ? sget('ap2:co') : '') || '';
        function go() {
          restore('blank');
          Object.keys(early).forEach(function (k) { $(ID[k]).value = early[k]; });   /* typed before the data came: keep it */
          if ('y' in early) yTyped = early.y !== ''; else if ('by' in early) yTyped = false;
          ['py', 'by', 'p', 'base'].forEach(function (k) { if (q[k] && isFinite(parseFloat(q[k]))) $(ID[k]).value = q[k]; });
          render(); futLine();
        }
        if (D.states[st]) {
          stSel.value = st; coSel.disabled = true;
          loadState(st).then(function () { fillCounties(fp); go(); }).catch(function () { go(); stateFailed(st, fp); });
        } else go();
        fetch('/data/prices.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { fut = j; futLine(); }).catch(function () { futLine(); });
      }).catch(function () {
        if (w.AgStates) w.AgStates.error(out, { msg: 'The program data didn’t load.', retry: start });
        else {
          out.removeAttribute('aria-busy');
          out.innerHTML = '<p class="ap-need" role="status">The program data didn&rsquo;t load. <button type="button" class="ap-use">Try again</button></p>';
          out.querySelector('button').onclick = function () { out.setAttribute('aria-busy', 'true'); out.innerHTML = '<p class="ap-need">Trying again.</p>'; start(); };
        }
      });
    }
    start();
  }

  function boot() { var root = d.querySelector('[data-arcplc]'); if (root) init(root); }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : this);
