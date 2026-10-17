/* components/breakeven.js: the /breakeven calculator.

   breakeven.html keeps what the bakers rewrite and crawlers read: CROP_DEFAULTS
   (scripts/bake_fert_defaults.py, scripts/bake_seo.py), var FERT (the posted
   $/lb and per-bushel rates, baked), BUDGETS (farmdoc's 2027 Illinois budget
   lines, typed from Table 1 of the Sep 1, 2026 article), the FAQ and the
   example line. This file does the arithmetic and the drawing.

   Where each number comes from is shown under its line and kept honest:
     budget  a farmdoc 2027 line (region named)
     fert    fertilizer priced at the posted $/lb for the yield on screen
     county  NASS county rent or the county trend yield
     arc     AGSIST's ARC/PLC estimate for the county (an estimate, per base acre)
     user    a number the reader typed (or saved before)
   County detail is one small file per state, data/breakeven/<ST>.json
   (scripts/build_breakeven_data.py), loaded only when a state is picked or the
   site already has the reader's saved location.

   Tests: test/breakeven-h2h.test.mjs, test/breakeven-best.test.mjs. */
(function () {
  'use strict';
  var D = document, W = window;
  var CROP_DEFAULTS = W.CROP_DEFAULTS, BUDGETS = W.BUDGETS || null, FERT = W.FERT || null;
  var CROP_PRICE_KEY = { corn: 'corn-dec', soybeans: 'beans-nov', wheat: 'wheat' };
  var CROP_CONTRACT = { corn: 'Dec corn', soybeans: 'Nov soybeans', wheat: 'Wheat (Chicago SRW nearby, not your class)' };
  var CROP_NAMES = { corn: 'Corn', soybeans: 'Soybeans', wheat: 'Wheat' };
  var COST_COLORS = { seed: '#3a8b3c', fertilizer: '#4a8fba', chemicals: '#7a6fad', insurance: '#daa520', machinery: '#b84c2a', labor: '#c87a28', land: '#5a9e6f', overhead: '#8a8a80' };
  var COST_LABELS = { seed: 'Seed', fertilizer: 'Fertilizer', chemicals: 'Chemicals', insurance: 'Insurance', machinery: 'Machinery', labor: 'Labor', land: 'Land', overhead: 'Overhead' };
  var COST_KEYS = ['seed', 'fertilizer', 'chemicals', 'insurance', 'machinery', 'labor', 'land', 'overhead'];
  var BUDGET_KEYS = ['yield', 'seed', 'chemicals', 'insurance', 'machinery', 'labor', 'land', 'overhead'];
  var FIELD_KEYS = ['yield', 'price', 'basis', 'seed', 'fertilizer', 'chemicals', 'insurance', 'machinery', 'labor', 'land', 'overhead', 'other', 'rentAcres', 'rentRate', 'ownAcres', 'ownRate'];
  var TAGGED = ['yield', 'seed', 'fertilizer', 'chemicals', 'insurance', 'machinery', 'labor', 'land', 'overhead', 'other'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var $ = function (id) { return D.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var num = function (id) { var e = $(id); return e ? parseFloat(e.value) : NaN; };
  function day(iso) { var m = /^(\d{4})-(\d\d)-(\d\d)/.exec(iso || ''); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : ''; }
  function money(v) { return '$' + (Math.abs(v) % 1 ? Math.abs(v).toFixed(2) : Math.round(Math.abs(v)).toLocaleString('en-US')); }

  var _livePrices = null, _pricesFetched = null, _beYear = '0', _suppressSeed = false, _region = 'n';
  var SRC = {};          /* field id -> {k: kind, t: text} */
  var _ls = null; try { _ls = W.localStorage; } catch (e) { _ls = null; }
  function lsGet(k) { try { return _ls ? _ls.getItem(k) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { if (_ls) _ls.setItem(k, v); } catch (e) { } }

  /* ------------------------------------------------------------ provenance */
  function crop() { return ($('crop') || {}).value || 'corn'; }
  function region() { return BUDGETS && BUDGETS.r[_region] ? BUDGETS.r[_region] : null; }
  function budgetLine(c, k) { var r = region(); return r && r[c] && r[c][k] != null ? r[c][k] : null; }
  function regionTag() {
    var r = region(); if (!r) return '';
    return 'from farmdoc\u2019s 2027 budget, ' + r.name + ' (Aug 2026)';
  }
  function fertFor(c, y) {
    if (!FERT || !FERT.r || !FERT.r[c] || !(y > 0)) return null;
    var rr = FERT.r[c], lb = [Math.round(y * rr[0]), Math.round(y * rr[1]), Math.round(y * rr[2])];
    return { usd: Math.round(lb[0] * FERT.n + lb[1] * FERT.p + lb[2] * FERT.k), lb: lb };
  }
  function setSrc(id, k, t) { SRC[id] = { k: k, t: t || '' }; }
  function defaultSrc(c) {
    var budget = c !== 'wheat' && region();
    BUDGET_KEYS.forEach(function (k) {
      if (budget) setSrc(k, 'budget', k === 'land' ? 'farmdoc\u2019s 2027 budget: ' + region().name + ' average cash rent' : k === 'yield' ? 'farmdoc\u2019s 2027 budget: ' + region().name + ' trend yield' : regionTag());
      else setSrc(k, 'example', 'this page\u2019s own example, not a published budget');
    });
    setSrc('fertilizer', FERT ? 'fert' : 'user', '');
    setSrc('other', 'none', '');
  }
  function renderSrc() {
    var c = crop(), y = num('yield');
    TAGGED.forEach(function (id) {
      var el = $('src-' + id); if (!el) return;
      var s = SRC[id] || {}, t = '';
      if (s.k === 'user') t = 'Your number.';
      else if (s.k === 'fert') {
        var f = fertFor(c, y);
        t = f ? (c === 'soybeans' ? '' : f.lb[0] + ' lb N, ') + f.lb[1] + ' lb P\u2082O\u2085, ' + f.lb[2] + ' lb K\u2082O for ' + Math.round(y) + ' bu at co-op prices posted through ' + day(FERT.asof) + '. Follows your yield.' : '';
      } else if (s.t) t = (/^farmdoc/.test(s.t) ? s.t : s.t.charAt(0).toUpperCase() + s.t.slice(1)) + '.';
      el.textContent = t; el.hidden = !t;
    });
  }

  /* ------------------------------------------------------------ state */
  function priceIsSeeded() { var el = $('price'); return !!(el && el.dataset.seeded === '1'); }
  function saveState() {
    try {
      var st = JSON.parse(lsGet('agsist-breakeven') || '{}'), c = crop(); st.crop = c; st.perCrop = st.perCrop || {};
      var o = {}; FIELD_KEYS.forEach(function (k) { var el = $(k); if (el) o[k] = el.value; });
      if (priceIsSeeded() || !($('price') && $('price').dataset.userEdited === '1')) delete o.price;
      var src = {}; TAGGED.forEach(function (k) { if (SRC[k] && SRC[k].k !== 'user') src[k] = SRC[k]; }); o._src = src;
      st.perCrop[c] = o; st.acres = $('acres').value; st.year = _beYear; st.region = _region;
      lsSet('agsist-breakeven', JSON.stringify(st));
    } catch (e) { }
  }
  function markPriceOwnedIfSaved(c) {
    try {
      var st = JSON.parse(lsGet('agsist-breakeven') || 'null'), o = st && st.perCrop && st.perCrop[c], el = $('price'); if (!el) return;
      if (o && o.price != null && o.price !== '') { el.dataset.userEdited = '1'; delete el.dataset.seeded; } else delete el.dataset.userEdited;
    } catch (e) { }
  }
  /* Saved numbers come back as they were. A line that still equals what the
     budget or county put there keeps that label; anything else is his. */
  function applySaved(c, o) {
    FIELD_KEYS.forEach(function (k) { var el = $(k); if (el && o[k] != null && o[k] !== '') el.value = o[k]; });
    var src = o._src || {};
    TAGGED.forEach(function (k) {
      var el = $(k); if (!el) return;
      var v = el.value, s = src[k];
      /* an auto fertilizer line follows today's posted prices, not the day it was saved */
      if (k === 'fertilizer') { var ff = fertFor(c, parseFloat($('yield').value)); if (FERT && ((s && s.k === 'fert') || (ff && String(ff.usd) === String(v)))) { setSrc(k, 'fert'); return; } if (String(v) === '' && !FERT) return; }
      if (s && s.k && s.k !== 'user' && s.k !== 'fert') { SRC[k] = s; return; }
      var b = c === 'wheat' ? null : budgetLine(c, k);
      if (b != null && String(b) === String(v)) return;   /* still the budget's number: defaultSrc label stands */
      if (k === 'other' && String(v) === '') return;
      if (c === 'wheat' && CROP_DEFAULTS.wheat[k] != null && String(CROP_DEFAULTS.wheat[k]) === String(v)) return;
      setSrc(k, 'user');
    });
  }
  function restoreState() {
    try {
      var st = JSON.parse(lsGet('agsist-breakeven') || 'null'); if (!st) return false;
      if (st.region && BUDGETS && BUDGETS.r[st.region]) _region = st.region;
      if (st.crop) $('crop').value = st.crop;
      var c = crop(); applyDefaults(c);
      var o = (st.perCrop || {})[c]; if (o) applySaved(c, o);
      markPriceOwnedIfSaved(c);
      if (st.acres) $('acres').value = st.acres;
      if (st.year === '1') _beYear = '1';
      return !!o;
    } catch (e) { return false; }
  }
  function applyDefaults(c) {
    var d = CROP_DEFAULTS[c], r = c !== 'wheat' ? region() : null;
    Object.keys(d).forEach(function (k) { var el = $(k); if (!el) return; var b = r && r[c] && r[c][k] != null ? r[c][k] : d[k]; el.value = b; });
    var ot = $('other'); if (ot) { ot.value = ''; delete ot.dataset.arc; }
    defaultSrc(c);
    if (FERT) { var f = fertFor(c, parseFloat($('yield').value)); if (f) $('fertilizer').value = f.usd; }
    syncRegionUI();
  }
  function onCropChange() {
    var c = crop(); applyDefaults(c); var saved = false;
    try { var st = JSON.parse(lsGet('agsist-breakeven') || 'null'), o = st && st.perCrop && st.perCrop[c]; if (o) { saved = true; applySaved(c, o); } } catch (e) { }
    markPriceOwnedIfSaved(c);
    coFill(!saved);
    updateLiveBar(); calcBreakeven();
  }
  function resetDefaults() {
    var c = crop();
    try { var st = JSON.parse(lsGet('agsist-breakeven') || '{}'); if (st.perCrop) delete st.perCrop[c]; lsSet('agsist-breakeven', JSON.stringify(st)); } catch (e) { }
    applyDefaults(c);
    var pe = $('price'); if (pe) { delete pe.dataset.userEdited; delete pe.dataset.seeded; }
    _suppressSeed = true; try { updateLiveBar(); } finally { _suppressSeed = false; }
    coFill(true);
    calcBreakeven();
  }

  /* ------------------------------------------------------------ budget region */
  function syncRegionUI() {
    var sel = $('be-region'), note = $('be-region-note'), c = crop();
    if (!sel || !BUDGETS) return;
    sel.value = _region; sel.disabled = c === 'wheat';
    if (note) {
      var y1 = _beYear === '1';
      note.innerHTML = c === 'wheat'
        ? 'Wheat: the lines below are this page&rsquo;s own example. farmdoc&rsquo;s 2027 tables we have are corn and soybeans only.'
        : 'Seed, chemicals, insurance, machinery, labor and overhead: <a href="' + esc(BUDGETS.url) + '">' + esc(BUDGETS.src) + '</a>. ' +
          'Machinery is farmdoc&rsquo;s power costs (hire, repair, fuel, depreciation); overhead is drying, storage, buildings, farm insurance, misc and interest; labor is hired labor only. ' +
          (y1 ? 'These are 2027 costs.' : 'These are 2027 costs, the newest published; for the 2026 crop, type what you spent.');
    }
  }
  function onRegionChange() {
    var sel = $('be-region'); if (!sel || !BUDGETS || !BUDGETS.r[sel.value]) return;
    _region = sel.value; var c = crop(); if (c === 'wheat') return;
    var r = region()[c];
    /* the budget's lines replace the budget's lines; his own numbers and the
       county's rent and yield stay */
    BUDGET_KEYS.forEach(function (k) {
      var s = SRC[k] || {};
      if (s.k === 'user' || s.k === 'county') return;
      $(k).value = r[k];
      setSrc(k, 'budget', k === 'land' ? 'farmdoc\u2019s 2027 budget: ' + region().name + ' average cash rent' : k === 'yield' ? 'farmdoc\u2019s 2027 budget: ' + region().name + ' trend yield' : regionTag());
    });
    syncRegionUI(); calcBreakeven();
  }

  /* ------------------------------------------------------------ the math */
  var _statusT = null;
  function syncFert() {
    var s = SRC.fertilizer; if (!s || s.k !== 'fert') return;
    var f = fertFor(crop(), num('yield')); if (f) $('fertilizer').value = f.usd;
  }
  function calcBreakeven() {
    syncFert();
    var yldVal = num('yield') || 0, price = num('price') || 0, costs = {};
    var basis = num('basis') || 0, cash = price + basis;
    var sp = $('split-panel'), splitOn = sp && !sp.hidden;
    var rA = splitOn ? (num('rentAcres') || 0) : 0, rR = splitOn ? (num('rentRate') || 0) : 0;
    var oA = splitOn ? (num('ownAcres') || 0) : 0, oR = splitOn ? (num('ownRate') || 0) : 0;
    /* A side counts only once it has BOTH acres and a rate: typing 500 rented
       acres before the rate used to blend land to $0 and save it. */
    var rOK = rA > 0 && rR > 0, oOK = oA > 0 && oR > 0;
    var splitLive = splitOn && (rOK || oOK) && !(rA > 0 && rR <= 0) && !(oA > 0 && oR <= 0);
    var landEl = $('land');
    if (landEl && !landEl.hasAttribute('readonly') && landEl.dataset.userVal !== landEl.value) landEl.dataset.userVal = landEl.value;
    if (splitLive) {
      var acB = rA + oA, blended = acB > 0 ? (rA * rR + oA * oR) / acB : 0;
      landEl.value = blended.toFixed(2); landEl.setAttribute('readonly', '');
      var acEl = $('acres'); if (acEl) acEl.value = Math.round(acB);
    } else if (landEl && landEl.hasAttribute('readonly')) {
      landEl.removeAttribute('readonly');
      if (landEl.dataset.userVal != null && landEl.dataset.userVal !== '') landEl.value = landEl.dataset.userVal;
    }
    /* A BLANK COST LINE IS NOT $0. A typed 0 still counts. */
    var cBlank = [];
    COST_KEYS.forEach(function (k) { var v = $(k).value; if (String(v).trim() === '' || !isFinite(parseFloat(v))) cBlank.push(COST_LABELS[k] || k); costs[k] = Math.max(0, parseFloat(v) || 0); });
    var totalCost = 0; COST_KEYS.forEach(function (k) { totalCost += costs[k]; });
    /* OTHER REVENUE comes off the cost the crop has to cover: it lowers the
       break-even and adds to profit; Cost/Bushel stays the full cost. */
    var other = Math.max(0, num('other') || 0), netCost = Math.max(0, totalCost - other);
    var yBad = yldVal > 1000, pBad = price > 100, bBad = Math.abs(basis) > 3, cOK = totalCost > 0 && !cBlank.length;
    var costPerBu = (yldVal > 0 && !yBad) ? totalCost / yldVal : 0, beBu = (yldVal > 0 && !yBad) ? netCost / yldVal : 0;
    var revenue = yldVal * cash, profit = revenue + other - totalCost, yldNeeded = cash > 0 ? netCost / cash : 0;
    var roiPct = totalCost > 0 ? profit / totalCost * 100 : 0, acres = num('acres') || 0, farmTotal = profit * acres;
    saveState();
    var ok = yldVal > 0 && !yBad, beOK = ok && cOK, pOK = price > 0 && !pBad && !bBad, calc = ok && pOK && !cBlank.length, DASH = '-';
    var BWHY = 'basis looks like cents: enter dollars, e.g. -0.30', YWHY = yBad ? 'yield above 1000' : 'enter a yield';
    var WHYP = DASH + ' \xb7 ' + (pBad ? 'price above 100' : bBad ? BWHY : 'enter a price');
    var CWHY = DASH + ' \xb7 ' + (cBlank.length ? (cBlank.length === 1 ? cBlank[0] + ' is blank' : cBlank.length + ' cost lines are blank') + ', type 0 if none' : 'enter your costs');
    var WHY = !ok ? DASH + ' \xb7 ' + YWHY : !pOK ? WHYP : cBlank.length ? CWHY : WHYP, BEWHY = !ok ? DASH + ' \xb7 ' + YWHY : CWHY, AWHY = DASH + ' \xb7 enter acres';
    var fM = function (n) { return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString(); };
    var sgn = function (n) { return (n >= 0 ? '+$' : '-$') + Math.abs(Math.round(n)).toLocaleString(); };
    $('totalCost').textContent = cBlank.length ? CWHY : fM(totalCost) + '/ac';
    $('costPerBu').textContent = beOK ? '$' + costPerBu.toFixed(2) + '/bu' : BEWHY;
    $('yieldNeeded').textContent = !pOK ? WHYP : !cOK ? CWHY : (cash > 0 ? Math.ceil(yldNeeded - 1e-9) + ' bu/ac' : DASH + ' \xb7 basis is larger than the price');
    $('revenue').textContent = (ok && pOK) ? fM(revenue) + '/ac' : (!ok ? DASH + ' \xb7 ' + YWHY : WHYP);
    var beEl = $('breakeven'), beState = !pOK ? '' : (cash > beBu && beBu > 0) ? ', below your price' : (cash < beBu && beBu > 0) ? ', above your price' : '';
    var bsEl = $('be-sub');
    if (bsEl) {
      var b0 = ok && beState && basis === 0, bsx = [];
      if (beOK && other > 0) bsx.push('After $' + (other % 1 ? other.toFixed(2) : Math.round(other)) + '/ac other revenue. Before it: $' + costPerBu.toFixed(2) + '/bu.');
      if (b0) bsx.push('Basis is 0, so cash and futures are the same.');
      bsEl.hidden = !bsx.length; bsEl.textContent = bsx.join(' ');
    }
    beEl.textContent = beOK ? ('$' + beBu.toFixed(2) + '/bu' + beState) : BEWHY;
    beEl.className = 'result-value be-highlight ' + (!calc || !beOK ? 'highlight' : cash > beBu && beBu > 0 ? 'positive' : cash < beBu && beBu > 0 ? 'negative' : 'highlight');
    var fnEl = $('futNeeded'); if (fnEl) fnEl.textContent = !beOK ? BEWHY : bBad ? DASH + ' \xb7 ' + BWHY : '$' + (beBu - basis).toFixed(2) + '/bu';
    var snEl = $('split-note');
    if (snEl) {
      if (splitLive && ok && (rOK || oOK)) {
        var landNow = costs.land, parts = [];
        if (rOK) parts.push('rented break-even <b>$' + (Math.max(0, totalCost - other - landNow + rR) / yldVal).toFixed(2) + '/bu</b> (' + Math.round(rA) + ' ac @ $' + (rR % 1 ? rR.toFixed(2) : Math.round(rR)) + ')');
        if (oOK) parts.push('owned <b>$' + (Math.max(0, totalCost - other - landNow + oR) / yldVal).toFixed(2) + '/bu</b> (' + Math.round(oA) + ' ac @ $' + (oR % 1 ? oR.toFixed(2) : Math.round(oR)) + ')');
        snEl.hidden = false;
        snEl.innerHTML = 'By ground: ' + parts.join(' &middot; ') + '.' + ((rOK && oOK) ? ' Owned bushels clear the market first; many contract rented-ground bushels only above the rented number.' : '');
      } else snEl.hidden = true;
    }
    clearTimeout(_statusT);
    _statusT = setTimeout(function () { var st = $('calc-status'); if (st) st.textContent = (!ok) ? 'Enter a yield between 0 and 1000 to compute results.' : (!cOK) ? 'Enter your costs to compute results.' : (!pOK) ? (bBad && !pBad && price > 0 ? 'Basis looks like cents; enter it in dollars, for example -0.30.' : 'Enter a price between 0 and 100 to compute results.') : ('Break-even ' + beBu.toFixed(2) + ' dollars per bushel, profit ' + (profit >= 0 ? 'plus ' : 'minus ') + Math.abs(Math.round(profit)) + ' dollars per acre.'); }, 800);
    var profEl = $('profit'); profEl.textContent = calc ? sgn(profit) + '/ac' : WHY; profEl.className = 'result-value ' + (!calc ? '' : profit >= 0 ? 'positive' : 'negative');
    var roiEl = $('roi'); roiEl.textContent = !calc ? WHY : !cOK ? CWHY : (roiPct >= 0 ? '+' : '') + roiPct.toFixed(1) + '%'; roiEl.className = 'result-value ' + (!calc || !cOK ? '' : roiPct >= 0 ? 'positive' : 'negative');
    var fOK = calc && acres > 0, farmEl = $('farmTotal'); farmEl.textContent = !calc ? WHY : !fOK ? AWHY : sgn(farmTotal); farmEl.style.color = !fOK ? '' : farmTotal >= 0 ? 'var(--green)' : 'var(--red)';
    var cropName = CROP_NAMES[crop()] || 'Corn';
    var psCrop = $('print-crop'); if (psCrop) psCrop.textContent = cropName + ', ' + Math.round(yldVal) + ' bu/ac \xd7 ' + acres + ' acres';
    var psbe = $('ps-breakeven'); if (psbe) psbe.textContent = beOK ? '$' + beBu.toFixed(2) + '/bu' : BEWHY;
    var psp = $('ps-price'); if (psp) psp.textContent = pOK ? '$' + cash.toFixed(2) + '/bu' : WHYP;
    var pspr = $('ps-profit'); if (pspr) { pspr.textContent = calc ? sgn(profit) + '/ac' : WHY; pspr.className = 'print-stat-value ' + (!calc ? '' : profit >= 0 ? 'pos' : 'neg'); }
    var psal = $('ps-acres-label'); if (psal) psal.textContent = Math.round(acres).toLocaleString();
    var psf = $('ps-farm'); if (psf) { psf.textContent = !calc ? WHY : !fOK ? AWHY : sgn(farmTotal); psf.className = 'print-stat-value ' + (!fOK ? '' : farmTotal >= 0 ? 'pos' : 'neg'); }
    updateCostBar(costs, totalCost);
    updateGauge(calc ? profit : null, WHY.replace(' \xb7 ', ' '));
    updateSensitivity(ok ? yldVal : 0, (pOK && !cBlank.length) ? price : 0, netCost, basis);
    updateAnswer({ ok: ok, beOK: beOK, calc: calc, pOK: pOK, beBu: beBu, basis: basis, bBad: bBad, yld: yldVal, net: netCost, profit: profit, acres: acres, why: BEWHY, price: price, cash: cash });
    var mb = $('mini-bar');
    if (mb) { mb.querySelector('#mb-be').textContent = beOK ? '$' + beBu.toFixed(2) + '/bu' : BEWHY; var mbp = mb.querySelector('#mb-profit'); mbp.textContent = calc ? sgn(profit) + '/ac' : WHY; mbp.style.color = !calc ? '' : profit >= 0 ? 'var(--green)' : 'var(--red)'; }
    renderSrc();
  }

  /* "Each 50 cents on futures moves this field $X an acre": a futures move
     reaches cash one for one at a fixed basis, so it is 0.50 x yield. The
     yield half is the break-even at 10 bu less, minus the break-even now. */
  function sensWords(yld, net, acres) {
    if (!(yld > 10) || !(net > 0)) return '';
    var perAc = 0.5 * yld, up = net / (yld - 10) - net / yld;
    return 'Each 50 cents on futures moves this field ' + money(perAc) + ' an acre' + (acres > 0 ? ' (' + money(perAc * acres) + ' on ' + Math.round(acres).toLocaleString('en-US') + ' acres)' : '') +
      '; 10 bushels less yield raises the break-even ' + Math.round(up * 100) + ' cents.';
  }
  function updateAnswer(r) {
    var a = $('ans-be'), u = $('ans-u'), s = $('ans-sens'), f = $('ans-fut'); if (!a) return;
    if (!r.beOK) { a.textContent = '-'; u.textContent = r.why.replace(/^- \xb7 /, ''); s.textContent = ''; if (f) f.textContent = ''; return; }
    a.textContent = '$' + r.beBu.toFixed(2); u.textContent = 'a bushel, cash';
    if (f) {
      var t = r.bBad ? '' : 'Futures needed at your basis: $' + (r.beBu - r.basis).toFixed(2) + '.';
      var pd = (W.AG && W.AG.px && W.AG.px.priceDollars) ? W.AG.px.priceDollars(r.price) : '$' + r.price.toFixed(2);
      if (r.calc) t += ' At ' + pd + ' futures' + (r.basis ? ' and ' + (r.basis > 0 ? '+' : '') + r.basis.toFixed(2) + ' basis' : '') + ' you ' + (r.profit >= 0 ? 'make ' : 'lose ') + money(Math.round(r.profit)) + ' an acre.';
      f.textContent = t.trim();
    }
    s.textContent = sensWords(r.yld, r.net, r.acres);
    var fr = $('ans-from');
    if (fr) {
      var cn = $('co-co'), cnty = cn && cn.value && cn.selectedIndex > 0 ? cn.options[cn.selectedIndex].text + (_coSt === 'LA' ? ' Parish' : ' County') + ', ' + _coSt : '';
      var bits = [], k = function (id) { return (SRC[id] || {}).k; };
      if (cnty && (k('land') === 'county' || k('yield') === 'county')) bits.push((k('land') === 'county' && k('yield') === 'county' ? 'Rent and trend yield' : k('land') === 'county' ? 'Rent' : 'Trend yield') + ' from ' + cnty + (_coAuto ? ' (your saved location)' : ''));
      if (k('other') === 'arc') bits.push('an ARC/PLC estimate in other revenue');
      var rr = region(); if (crop() !== 'wheat' && rr && ['seed', 'chemicals', 'machinery'].some(function (x) { return k(x) === 'budget'; })) bits.push('other costs from farmdoc\u2019s 2027 ' + rr.name + ' budget');
      if (k('fertilizer') === 'fert') bits.push('fertilizer at co-op prices posted through ' + day(FERT.asof));
      var t = bits.join('; ');
      fr.textContent = t ? t.charAt(0).toUpperCase() + t.slice(1) + '.' : '';
    }
    var sn = $('sens-say'); if (sn) sn.textContent = r.calc ? sensWords(r.yld, r.net, r.acres) : '';
  }
  function updateCostBar(costs, total) {
    var bar = $('cost-bar'), leg = $('cost-legend');
    if (total <= 0) { bar.innerHTML = ''; leg.innerHTML = ''; return; }
    var b = '', l = '';
    COST_KEYS.forEach(function (k) { var pct = costs[k] / total * 100; if (pct < 0.5) return; b += '<div class="cost-bar-seg" style="width:' + pct.toFixed(1) + '%;background:' + COST_COLORS[k] + '"><span class="seg-tip">' + COST_LABELS[k] + ': $' + Math.round(costs[k]) + '/ac (' + pct.toFixed(0) + '%)</span></div>'; l += '<span class="cost-legend-item"><span class="cost-legend-dot" style="background:' + COST_COLORS[k] + '"></span>' + COST_LABELS[k] + ' $' + Math.round(costs[k]) + ' (' + pct.toFixed(0) + '%)</span>'; });
    bar.innerHTML = b; leg.innerHTML = l;
  }
  function updateGauge(profit, why) {
    var gm = $('gauge-mid'), mk = $('gauge-marker'), fill = $('gauge-fill');
    if (profit == null) { mk.style.visibility = 'hidden'; fill.style.width = '0%'; fill.style.background = 'var(--text-dim)'; if (gm) gm.textContent = why || 'enter a price'; return; }
    mk.style.visibility = ''; if (gm) gm.textContent = 'Break-Even';
    var pct = ((Math.max(-200, Math.min(200, profit)) + 200) / 400 * 100);
    mk.style.left = pct + '%'; fill.style.width = pct + '%';
    fill.style.background = profit >= 0 ? 'linear-gradient(90deg,var(--border) 50%,var(--green) ' + pct + '%)' : 'linear-gradient(90deg,var(--red) 0%,var(--border) ' + pct + '%)';
  }
  /* The what-if grid. Cells are profit per acre; on a phone the dollar signs
     and thousands commas go (the header says $/ac) so seven columns fit 390 px
     with no sideways scroll. */
  function updateSensitivity(baseYield, basePrice, net, basis) {
    basis = basis || 0;
    var tb = $('sens-table'), sn = $('sens-note');
    if (baseYield <= 0 || basePrice <= 0) {
      tb.innerHTML = '<tr><td class="sens-zero" style="padding:1rem;text-align:center">Enter a yield, a futures price and every cost line (0 if none) to see the what-if grid.</td></tr>';
      if (sn) sn.textContent = ''; var ss = $('sens-say'); if (ss) ss.textContent = '';
      return;
    }
    var c = crop();
    var yD = c === 'corn' ? [-30, -20, -10, 0, 10, 20] : c === 'soybeans' ? [-10, -7, -3, 0, 3, 7] : [-15, -10, -5, 0, 5, 10];
    var pD = c === 'corn' ? [-0.60, -0.40, -0.20, 0, 0.20, 0.40] : c === 'soybeans' ? [-1.50, -1.00, -0.50, 0, 0.50, 1.00] : [-0.75, -0.50, -0.25, 0, 0.25, 0.50];
    /* the d=0 row and column use the exact inputs, so the outlined cell is the headline profit */
    var ys = yD.map(function (d) { return d === 0 ? baseYield : Math.round(baseYield + d); }).filter(function (y) { return y > 0; });
    var ps = pD.map(function (d) { return d === 0 ? basePrice : +(basePrice + d).toFixed(2); }).filter(function (p) { return p > 0; });
    var h = '<tr><th class="corner" scope="col"><span class="wide">Yield \u2193 / Futures \u2192</span><span class="narrow">bu \\ $</span></th>' + ps.map(function (p) { return '<th scope="col">$' + p.toFixed(2) + '</th>'; }).join('') + '</tr>';
    ys.forEach(function (y) {
      h += '<tr><th class="row-head" scope="row">' + (y % 1 ? y.toFixed(1) : y) + '<span class="wide"> bu</span></th>';
      ps.forEach(function (p) {
        var prof = (y * (p + basis)) - net, cls = prof > 5 ? 'sens-positive' : prof < -5 ? 'sens-negative' : 'sens-zero', cur = y === baseYield && p === basePrice;
        var r = Math.abs(Math.round(prof));
        h += '<td class="' + cls + (cur ? ' sens-current' : '') + '">' + (prof >= 0 ? '+' : '-') + '<span class="wide">$</span>' + r + '</td>';
      });
      h += '</tr>';
    });
    tb.innerHTML = h;
    if (sn) sn.textContent = 'Profit or loss per acre. ' + (basis ? ('At your ' + (basis > 0 ? '+' : '') + basis.toFixed(2) + ' basis; columns are futures prices.') : 'Columns are futures prices; set your basis above for cash-adjusted profit.');
  }
  function printReport() {
    $('print-date').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    calcBreakeven(); setTimeout(function () { W.print(); }, 150);
  }

  /* ------------------------------------------------------------ the board */
  function fetchLivePrices() {
    fetch('/data/prices.json', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) { _livePrices = data.quotes || {}; _pricesFetched = data.fetched || null; updateLiveBar(); calcBreakeven(); }).catch(function () { });
  }
  /* "Settle" only when the file says the price is that day's recorded
     settle; otherwise it is the last trade the reader saw. The change shown
     is settle to settle, from the file's own settles, or none at all. */
  function quoteWords(q) {
    var st = q.settles || {}, cd = q.close_date, isSettle = !!(cd && st[cd] != null && Math.abs(st[cd] - q.close) < 1e-9);
    var prev = q.prev_date && st[q.prev_date] != null ? st[q.prev_date] : null;
    if (isSettle) {
      var ch = prev != null ? q.close - prev : null;
      var md = cd.slice(5).split('-'), when = MON[+md[0] - 1] + ' ' + (+md[1]);
      return { chg: ch, prev: prev, text: when + ' settle' + (ch != null ? ', change from ' + day(q.prev_date).replace(/, \d{4}$/, '') : '') };
    }
    var t = '';
    if (_pricesFetched) { try { var ft = new Date(_pricesFetched); t = ' as of ' + ft.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { } }
    return { chg: null, text: 'last trade' + t };
  }
  function updateLiveBar() {
    var bar = $('live-bar'); if (!_livePrices) { bar.style.display = 'none'; return; }
    var c = crop(), ck = contractFor(c), q = _livePrices[ck]; syncYearSelect(c);
    if (!q || q.close == null) { bar.style.display = 'none'; return; }
    var ft = _pricesFetched ? new Date(_pricesFetched).getTime() : NaN, stale = !(isFinite(ft) && (Date.now() - ft) <= 60 * 3600000);
    var ub = bar.querySelector('button'), ce = $('live-chg-val');
    $('live-crop-name').textContent = contractLabel(c, ck);
    if (stale) { $('live-price-val').textContent = '-'; delete bar.dataset.price; if (ub) ub.style.display = 'none'; ce.textContent = 'price file is stale, enter your own price'; ce.className = 'chg-tag'; bar.style.display = 'flex'; return; }
    if (ub) ub.style.display = '';
    $('live-price-val').textContent = ((W.AG && W.AG.px) ? W.AG.px.price(q.close) : '$' + (q.close / 100).toFixed(2)) + '/bu';
    bar.dataset.price = String(+(q.close / 100).toFixed(4)); /* exact board price, quarter cents kept */
    var w = quoteWords(q);
    if (w.chg != null && W.AG && W.AG.px && W.AG.px.change) { var cw = W.AG.px.change(w.chg, w.prev ? w.chg / w.prev * 100 : null); ce.textContent = cw.t + ' \u00b7 ' + w.text; ce.className = 'chg-tag ' + (cw.c === 'nc' ? '' : cw.c); }
    else { ce.textContent = w.text; ce.className = 'chg-tag'; }
    bar.style.display = 'flex';
    seedLivePriceIfUntouched();
  }
  /* The live quote is the honest starting price when the reader has not
     typed one and has nothing saved. Wheat stays his: ZW=F is SRW nearby. */
  function seedLivePriceIfUntouched() {
    try {
      var el = $('price'); if (!el || _suppressSeed || crop() === 'wheat') return;
      if (el.dataset.userEdited === '1' || String(el.value).trim() !== '') return;
      el.dataset.seeded = '1'; useLivePrice();
    } catch (e) { }
  }
  function useLivePrice() { var p = $('live-bar').dataset.price; if (p) { $('price').value = p; calcBreakeven(); } }

  /* CROP YEAR: the Dec (Nov) contract and the same month a year out, read off
     the board file's own ticker so it rolls over by itself. */
  var MONTHS = { F: 'Jan', G: 'Feb', H: 'Mar', J: 'Apr', K: 'May', M: 'Jun', N: 'Jul', Q: 'Aug', U: 'Sep', V: 'Oct', X: 'Nov', Z: 'Dec' };
  function tickerYM(key) { var q = _livePrices && _livePrices[key], m = q && /([FGHJKMNQUVXZ])(\d\d)\.CBT$/.exec(q.ticker || ''); return m ? { mon: MONTHS[m[1]], yy: +m[2] } : null; }
  function nextYearKey(c) { if (c === 'wheat') return null; var ym = tickerYM(CROP_PRICE_KEY[c]); if (!ym) return null; var k = (c === 'corn' ? 'corn-dec' : 'beans-nov') + String(ym.yy + 1).padStart(2, '0'), q = _livePrices && _livePrices[k]; return (q && q.close != null) ? k : null; }
  function contractFor(c) { if (_beYear === '1') { var k = nextYearKey(c); if (k) return k; } return CROP_PRICE_KEY[c]; }
  function contractLabel(c, key) { if (c === 'wheat') return CROP_CONTRACT.wheat; var ym = tickerYM(key); if (!ym) return CROP_CONTRACT[c] || CROP_NAMES[c]; return ym.mon + " '" + String(ym.yy).padStart(2, '0') + ' ' + (c === 'corn' ? 'corn' : 'soybeans') + ' (' + (2000 + ym.yy) + ' crop)'; }
  /* The program and trend year that go with the pick. Before the board loads
     it is this year's crop plus the pick. */
  function cropYear() {
    var ym = tickerYM(CROP_PRICE_KEY.corn);
    var base = ym ? 2000 + ym.yy : new Date().getFullYear();
    return base + (_beYear === '1' ? 1 : 0);
  }
  function syncYearSelect(c) {
    var sel = $('be-year'), nw = $('live-name-wrap'), nt = $('yr-note'); if (!sel) return;
    var k0 = CROP_PRICE_KEY[c], k1 = nextYearKey(c);
    if (!k1) { sel.hidden = true; if (nw) nw.hidden = false; if (nt) nt.hidden = true; return; }
    sel.innerHTML = '<option value="0">' + contractLabel(c, k0) + '</option><option value="1">' + contractLabel(c, k1) + '</option>';
    sel.value = _beYear; sel.hidden = false; if (nw) nw.hidden = true;
    if (nt) { var ym = tickerYM(k1); nt.hidden = _beYear !== '1'; if (ym) nt.innerHTML = 'Planning the ' + (2000 + ym.yy) + ' crop: the cost lines are farmdoc&rsquo;s ' + (2000 + ym.yy) + ' budget and fertilizer at this fall&rsquo;s posted prices. Put in your own as you book them.'; }
  }
  function onYearChange() {
    var sel = $('be-year'); _beYear = sel && sel.value === '1' ? '1' : '0';
    var el = $('price'); if (el && el.dataset.userEdited !== '1') { el.value = ''; delete el.dataset.seeded; }   /* a board price follows the contract; a typed one stays his */
    updateLiveBar(); syncRegionUI(); coFill(true, true); calcBreakeven();
  }

  /* ------------------------------------------------------------ your county */
  var CO_STATES = { AL: 'Alabama', AR: 'Arkansas', AZ: 'Arizona', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', IA: 'Iowa', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', MA: 'Massachusetts', MD: 'Maryland', ME: 'Maine', MI: 'Michigan', MN: 'Minnesota', MO: 'Missouri', MS: 'Mississippi', MT: 'Montana', NC: 'North Carolina', ND: 'North Dakota', NE: 'Nebraska', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NV: 'Nevada', NY: 'New York', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VA: 'Virginia', VT: 'Vermont', WA: 'Washington', WI: 'Wisconsin', WV: 'West Virginia', WY: 'Wyoming' };
  var PRACTICE = { nonirr: 'non-irrigated', irr: 'irrigated', all: 'all-practice' };
  var NO_ARC_PAGE = { CT: 1 };
  var _coData = null, _coSt = '', _coAuto = '';
  function coSave() { var c = $('co-co'); lsSet('agsist-be-county', _coSt && c && c.value ? _coSt + '|' + c.value : ''); }
  function coLoad(st, fips, fill, auto) {
    var cs = $('co-co'), note = $('co-note'); _coData = null; _coSt = st; cs.disabled = true;
    cs.innerHTML = '<option value="">' + (st ? 'Loading counties...' : 'Pick a state first') + '</option>';
    if (!st) { note.hidden = true; coSave(); return; }
    fetch('/data/breakeven/' + st + '.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
      if (_coSt !== st) return; _coData = d;
      cs.innerHTML = '<option value="">Pick a county</option>' + (d.c || []).map(function (c) { return '<option value="' + esc(c.f) + '">' + esc(c.n) + '</option>'; }).join('');
      cs.disabled = false;
      if (typeof fips === 'function') fips = fips(d);
      if (fips && (d.c || []).some(function (c) { return c.f === fips; })) { cs.value = fips; if (auto) { _coAuto = auto; coSave(); } coFill(fill); }
    }).catch(function () { if (_coSt !== st) return; cs.innerHTML = '<option value="">Could not load</option>'; note.hidden = false; note.textContent = 'The county file did not load. Type your own rent and yield.'; });
  }
  function onCoState() { _coAuto = ''; coLoad($('co-st').value, '', false); }
  function onCoCounty() { _coAuto = ''; coFill(true, false, true); coSave(); }
  function stateSlug(st) { return (CO_STATES[st] || '').toLowerCase().replace(/ /g, '-'); }
  /* The ARC/PLC estimate that goes with this county, crop and crop year.
     The build's own verdict picks the program; close or neither takes the
     larger expected payment. Payments are per base acre. */
  function arcFor(c, cr, yr) {
    var a = c && c.a && c.a[cr], row = a && a[String(yr)];
    if (!row) return { why: a && a.why === 'two practices' ? 'irrigated and non-irrigated estimates differ here' : 'no estimate for this county and crop' };
    var v = row[0];
    if (v === 'withheld') return { why: 'not enough county history to estimate' };
    if (v === 'mismatch') return { why: 'FSA&rsquo;s county PLC yield is above the benchmark, so there is no typical-farm estimate' };
    if (v === 'noprice') return { why: 'no ' + yr + ' price outlook to estimate from yet' };
    if (v === 'pending') return { why: 'waiting on the price that sets the ' + yr + ' reference price' };
    if (row.length < 3) return { why: 'no estimate' };
    var plc = row[1], arc = row[2], prog = /plc/.test(v) ? 'PLC' : /arc/.test(v) ? 'ARC-CO' : (plc > arc ? 'PLC' : 'ARC-CO');
    var cents = prog === 'PLC' ? plc : arc;
    return { prog: prog, usd: cents / 100, other: prog === 'PLC' ? ['ARC-CO', arc / 100] : ['PLC', plc / 100], verdict: v };
  }
  /* fill writes into the fields; force (a county he just picked) writes over
     his rent and yield too; yearOnly (a new crop year) leaves the rent. */
  function coFill(fill, yearOnly, force) {
    var note = $('co-note'), cs = $('co-co'); if (!note || !cs) return;
    var fips = cs.value, c = _coData && fips ? (_coData.c || []).filter(function (x) { return x.f === fips; })[0] : null;
    var ot = $('other');
    if (!c) {
      note.hidden = true;
      if (ot && ot.dataset.arc === '1' && fill) { ot.value = ''; delete ot.dataset.arc; setSrc('other', 'none'); }
      return;
    }
    var cr = crop(), unit = _coSt === 'LA' ? ' Parish' : ' County', nm = esc(c.n) + unit, out = [], yr = cropYear();
    var ty = parseInt(String(_coData.rent_gen || '').slice(0, 4), 10) || yr;
    if (_coAuto) out.push('<b>' + nm + ', ' + esc(_coSt) + '</b>, from the location you saved on AGSIST. Pick another county any time.');
    var r = c.r;
    if (r && !yearOnly) {
      var sp = $('split-panel'), land = $('land'), tgt = (sp && !sp.hidden && land && land.hasAttribute('readonly')) ? $('rentRate') : land;
      if (fill && tgt && (force || (SRC.land || {}).k !== 'user')) { tgt.value = r[0]; if (tgt === land) { land.dataset.userVal = String(r[0]); setSrc('land', 'county', 'USDA NASS ' + r[1] + ' cash rent, ' + nm); } }
    }
    if (r) out.push('Land rent <b>' + money(r[0]) + '/ac</b>: USDA NASS ' + r[1] + ' county average cash rent, ' + PRACTICE[r[2]] + ' cropland, ' + nm + '.');
    else out.push('NASS publishes no cropland cash rent for ' + nm + ', so land rent is left as it was.');
    if (cr === 'corn' || cr === 'soybeans') {
      var t = c.y && c.y[cr === 'corn' ? 'corn' : 'beans'];
      if (t && t.v != null) {
        /* the trend is a straight line: one more year adds one slope */
        var tv = t.v + (t.s != null ? t.s * (yr - ty) : 0), shown = Math.round(tv), py = t.s != null ? yr : ty;
        if (fill && (force || (SRC.yield || {}).k !== 'user')) { $('yield').value = shown; setSrc('yield', 'county', 'county trend projected to ' + py + ', ' + nm); }
        out.push('Yield <b>' + shown + ' bu/ac</b>: the county&rsquo;s 15-year trend projected to ' + py + ', a straight line through NASS ' + PRACTICE[t.b] + ' county yields. A fit, not a forecast; your own APH is better.');
      } else out.push('No county trend yield' + (t && t.w ? ': ' + esc(t.w) : '') + '. Yield is left as it was.');
      /* ARC/PLC into other revenue, as an estimate, only where his own number is not */
      var e = arcFor(c, cr, yr), page = (_coData.c && c.s && !NO_ARC_PAGE[_coSt]) ? '/arc-plc/' + stateSlug(_coSt) + '/' + c.s : '';
      var mine = ot && (SRC.other || {}).k === 'user';
      if (e.prog) {
        var pay = _coData.pay && _coData.pay[String(yr)];
        if (fill && ot && !mine) { ot.value = e.usd % 1 ? e.usd.toFixed(2) : String(e.usd); ot.dataset.arc = '1'; setSrc('other', 'arc', 'estimate: ' + e.prog + ', ' + nm + ', ' + yr + ' program year'); }
        out.push('Other revenue ' + (mine ? '(yours kept; our estimate is ' : '<b>') + money(e.usd) + '/ac' + (mine ? ')' : '</b>') + ': AGSIST&rsquo;s ' + e.prog + ' estimate for ' + (cr === 'corn' ? 'corn' : 'soybean') + ' base acres in ' + nm + ', ' + yr + ' program year (' + e.other[0] + ' ' + money(e.other[1]) + '). ' +
          'Per base acre at FSA&rsquo;s 85% payment acres, before sequestration' + (pay ? ', paid after ' + day(pay) : '') + '. It counts one base acre for each planted acre; change it if yours differ. An estimate, not a sure payment.' +
          (page ? ' <a href="' + page + '">How the estimate is figured</a>.' : ''));
      } else {
        if (fill && ot && ot.dataset.arc === '1') { ot.value = ''; delete ot.dataset.arc; setSrc('other', 'none'); }
        out.push('No ARC/PLC estimate in other revenue: ' + e.why + '.' + (page ? ' <a href="' + page + '">' + nm + ' on AGSIST ARC or PLC</a>.' : ''));
      }
    } else {
      out.push('County yield fills for corn and soybeans only.');
      var stn = CO_STATES[_coSt] || ''; if (stn && !NO_ARC_PAGE[_coSt]) out.push('ARC or PLC estimates for your county: <a href="/arc-plc/' + stateSlug(_coSt) + '">' + esc(stn) + ' on AGSIST ARC or PLC</a>.');
    }
    note.innerHTML = '<p>' + out.join('</p><p>') + '</p>'; note.hidden = false;
    if (fill) calcBreakeven(); else renderSrc();
  }
  /* The site's saved location (geo.js writes agsist-wx-loc with the state and
     county; cash bids and the ZIP box feed it). Read only, never sent. A ZIP
     with no county saved is not enough to pick a county here. */
  function savedLoc() {
    var o = null; try { o = JSON.parse(lsGet('agsist-wx-loc') || 'null'); } catch (e) { o = null; }
    if (!o || typeof o !== 'object') return null;
    var st = /^[A-Z]{2}$/.test(o.state || '') ? o.state : '';
    return st ? { state: st, county: String(o.county || '') } : null;
  }
  function normCounty(s) { return String(s || '').toLowerCase().replace(/\b(county|parish|borough|census area)\b/g, '').replace(/\bsaint\b/g, 'st').replace(/[^a-z]/g, ''); }
  function initCounty(hadSaved) {
    var s = $('co-st'); if (!s) return;
    s.innerHTML = '<option value="">Pick a state</option>' + Object.keys(CO_STATES).sort(function (a, b) { return CO_STATES[a].localeCompare(CO_STATES[b]); }).map(function (k) { return '<option value="' + k + '">' + CO_STATES[k] + '</option>'; }).join('');
    var sv = (lsGet('agsist-be-county') || '').split('|');
    if (sv[0] && CO_STATES[sv[0]]) { s.value = sv[0]; coLoad(sv[0], sv[1] || '', false); return; }
    var loc = savedLoc(); if (!loc || !CO_STATES[loc.state]) return;
    s.value = loc.state;
    var want = normCounty(loc.county);
    /* a first visit fills from the saved county; a returning reader's own numbers stand */
    coLoad(loc.state, function (d) { if (!want) return ''; var m = (d.c || []).filter(function (c) { return normCounty(c.n) === want; }); return m.length === 1 ? m[0].f : ''; }, !hadSaved, 'saved');
  }

  /* ------------------------------------------------------------ wiring */
  function bind() {
    D.addEventListener('input', function (ev) {
      var t = ev && ev.target; if (!t || !t.id) return;
      if (t.id === 'price') { t.dataset.userEdited = '1'; delete t.dataset.seeded; }
      if (TAGGED.indexOf(t.id) >= 0) { setSrc(t.id, 'user'); if (t.id === 'other') delete t.dataset.arc; }
      if (FIELD_KEYS.indexOf(t.id) >= 0 || t.id === 'acres') calcBreakeven();
    }, true);
    var on = function (id, ev, fn) { var e = $(id); if (e) e.addEventListener(ev, fn); };
    on('crop', 'change', onCropChange); on('be-year', 'change', onYearChange); on('be-region', 'change', onRegionChange);
    on('co-st', 'change', onCoState); on('co-co', 'change', onCoCounty);
    on('be-use', 'click', useLivePrice); on('be-print', 'click', printReport); on('be-reset', 'click', resetDefaults);
    function closeAllHints() { D.querySelectorAll('.hint-popup.hint-open').forEach(function (p) { p.classList.remove('hint-open'); p.setAttribute('inert', ''); }); D.querySelectorAll('.hint-icon.active').forEach(function (i) { i.classList.remove('active'); i.setAttribute('aria-expanded', 'false'); }); }
    D.querySelectorAll('.hint-icon').forEach(function (icon) {
      icon.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var popup = this.closest('.input-wrap').querySelector('.hint-popup'); if (!popup) return;
        var was = popup.classList.contains('hint-open'); closeAllHints();
        if (!was) { popup.classList.add('hint-open'); popup.removeAttribute('inert'); this.classList.add('active'); this.setAttribute('aria-expanded', 'true'); }
      });
    });
    D.addEventListener('click', function (e) {
      if (!e.target.closest('.hint-icon') && !e.target.closest('.hint-popup')) closeAllHints();
      var seg = e.target.closest('.cost-bar-seg'); if (!seg) return; var tip = seg.querySelector('.seg-tip'); if (!tip) return;
      e.stopPropagation(); D.querySelectorAll('.seg-tip.seg-open').forEach(function (t) { if (t !== tip) t.classList.remove('seg-open'); });
      tip.classList.toggle('seg-open'); if (tip.classList.contains('seg-open')) setTimeout(function () { tip.classList.remove('seg-open'); }, 3000);
    });
    if (W.matchMedia && W.matchMedia('(hover:none)').matches) D.querySelectorAll('input[type="number"],select').forEach(function (input) { input.addEventListener('focus', function () { closeAllHints(); setTimeout(function () { input.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 300); }); });
    var t = $('split-toggle'), p = $('split-panel');
    if (t && p) {
      var setOpen = function (o) { p.hidden = !o; t.setAttribute('aria-expanded', o ? 'true' : 'false'); t.textContent = o ? 'Hide owned/rented split' : 'Split owned vs rented ground \u2192'; lsSet('agsist-be-split', o ? '1' : '0'); var l = $('land'); if (!o && l) l.removeAttribute('readonly'); calcBreakeven(); };
      t.addEventListener('click', function () { setOpen(p.hidden); });
      if (lsGet('agsist-be-split') === '1') { p.hidden = false; t.setAttribute('aria-expanded', 'true'); t.textContent = 'Hide owned/rented split'; }
    }
    D.querySelectorAll('.be-faq-q').forEach(function (q) {
      q.addEventListener('click', function () { var it = this.closest('.be-faq-item'), op = it.classList.contains('open'); D.querySelectorAll('.be-faq-item').forEach(function (i) { i.classList.remove('open'); i.querySelector('.be-faq-q').setAttribute('aria-expanded', 'false'); }); if (!op) { it.classList.add('open'); q.setAttribute('aria-expanded', 'true'); } });
      q.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); q.click(); } });
    });
  }

  function boot() {
    if (!CROP_DEFAULTS) return;
    bind();
    var had = restoreState();
    if (!had) applyDefaults(crop());
    syncRegionUI();
    calcBreakeven();
    fetchLivePrices();
    initCounty(had);
  }
  W.AgBreakeven = { calc: function () { calcBreakeven(); }, sens: sensWords, arcFor: arcFor, fertFor: fertFor, normCounty: normCounty };
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot); else boot();
})();
