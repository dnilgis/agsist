/**
 * AGSIST homepage extras — added 2026-09-30.
 * r7-bids 2026-10-01: carry prefilled from the Dec-Mar corn futures spread.
 * Three real, wired features that were prototyped as a design-canvas mockup
 * and are now live here, reading real site data instead of illustrative
 * placeholders:
 *   1. Store-or-sell calculator, anchored to the real cash bid the ZIP
 *      lookup returns (window.AGSIST_STATE.bids / the `agsist:bids` event
 *      components/bids-homepage.js already dispatches).
 *   2. "vs. nearby elevators" basis comparison, computed from the same
 *      bid pool bids-homepage.js already fetched — no new request, no
 *      invented county-average number.
 *   (3, "since your last visit", removed 2026-10-01: it keyed on
 *   data/daily.json `basis.headline`, a field the Daily never writes, so it
 *   refetched the Daily on every load and could never display.)
 *   4. Add-to-home-screen banner, wired to the real `beforeinstallprompt`
 *      event — the actual browser API, not a fake button. manifest.json and
 *      sw.js are already registered site-wide; this only adds the UI.
 *
 * Everything here is additive: no existing id, function, or event this file
 * reads is modified by this file. If this script fails to load entirely,
 * the four new elements it controls stay at their default hidden/inert
 * state and the rest of the page is unaffected.
 */
(function(){
  'use strict';

  function $(id){ return document.getElementById(id); }

  // ── 1 + 2: store-or-sell calculator + nearby-basis comparison ──────────
  // Both live inside the cash-bids card and both need the same trigger: a
  // successful ZIP lookup. bids-homepage.js already dispatches this event
  // with everything both features need in `detail`.
  var lastBid = null;

  /* WAVE1-A 2026-10-03: INTEREST AND SHRINK, OPTIONAL, AND THE MATH SHOWN.
       net per bushel stored = carry
                             - storage cost x months
                             - price now x annual rate x months / 12   (money tied up, simple interest)
                             - shrink % x (price now + carry)          (bushels lost before the later sale)
     A blank optional box is left out and the result says it was not
     counted; it is never treated as a zero someone typed. */
  function money(v){ return '$' + Math.abs(v).toFixed(2); }
  function calcStoreOrSell(){
    var priceEl = $('idx1-calc-price'), costEl = $('idx1-calc-cost'),
        monthsEl = $('idx1-calc-months'), carryEl = $('idx1-calc-carry'),
        resultEl = $('idx1-calc-result'), rateEl = $('idx1-calc-rate'), shrinkEl = $('idx1-calc-shrink'),
        mathEl = $('idx1-calc-math');
    if(!priceEl || !costEl || !monthsEl || !carryEl || !resultEl) return;
    function math(t){ if(mathEl){ mathEl.textContent = t; var w = mathEl.closest && mathEl.closest('details'); if(w) w.hidden = !t; } }
    var priceRaw = priceEl.value, costRaw = costEl.value, monthsRaw = monthsEl.value, carryRaw = carryEl.value;
    var rateRaw = rateEl ? rateEl.value : '', shrinkRaw = shrinkEl ? shrinkEl.value : '';
    if(priceRaw === '' || costRaw === '' || monthsRaw === '' || carryRaw === ''){
      resultEl.style.color = 'var(--text-dim)';
      resultEl.textContent = 'Enter your numbers above.';
      math('');
      return;
    }
    var price = parseFloat(priceRaw), cost = parseFloat(costRaw), months = parseFloat(monthsRaw), carry = parseFloat(carryRaw);
    var rate = rateRaw === '' ? null : parseFloat(rateRaw), shrink = shrinkRaw === '' ? null : parseFloat(shrinkRaw);
    if(!isFinite(price) || !isFinite(cost) || !isFinite(months) || !isFinite(carry) || (rate !== null && !isFinite(rate)) || (shrink !== null && !isFinite(shrink))){
      resultEl.style.color = 'var(--red,#ef4444)';
      resultEl.textContent = 'That number is out of range — try a realistic $/bu or month value.';
      math('');
      return;
    }
    if(price < 0 || cost < 0 || months < 0 || carry < 0 || (rate !== null && (rate < 0 || rate > 30)) || (shrink !== null && (shrink < 0 || shrink > 20))){
      resultEl.style.color = 'var(--red,#ef4444)';
      resultEl.textContent = 'Price, storage cost, months and carry can’t be negative; interest runs 0 to 30% a year and shrink 0 to 20%.';
      math('');
      return;
    }
    var totalCost = cost * months;
    var interest = rate === null ? 0 : price * (rate / 100) * months / 12;
    var shrinkLoss = shrink === null ? 0 : (shrink / 100) * (price + carry);
    var net = carry - totalCost - interest - shrinkLoss, cav = carryCaveat(months);
    var left = [];
    if(rate === null) left.push('interest');
    if(shrink === null) left.push('shrink');
    var notCounted = left.length ? ' ' + left.join(' and ').replace(/^./, function(c){ return c.toUpperCase(); }) + ' not counted.' : '';
    var lines = ['Carry you expect          +' + money(carry),
      '− storage ' + money(cost) + ' × ' + months + ' mo     −' + money(totalCost)];
    lines.push(rate === null ? '− interest                not counted (no rate entered)'
      : '− interest ' + money(price) + ' × ' + rate + '% × ' + months + '/12   −' + money(interest));
    lines.push(shrink === null ? '− shrink                  not counted (no shrink entered)'
      : '− shrink ' + shrink + '% × (' + money(price) + ' + ' + money(carry) + ')   −' + money(shrinkLoss));
    lines.push('= ' + (net >= 0 ? '+' : '−') + money(net) + ' per bushel stored, against selling at ' + money(price) + ' now');
    math(lines.join('\n'));
    if(net > 0.001){
      resultEl.style.color = 'var(--green)';
      resultEl.textContent = 'Storing pencils out by +$' + net.toFixed(2) + '/bu over selling at $' + price.toFixed(2) + ' now, if your carry estimate holds.' + notCounted + cav;
    } else if(net < -0.001){
      resultEl.style.color = 'var(--red,#ef4444)';
      resultEl.textContent = 'Storing costs $' + Math.abs(net).toFixed(2) + '/bu more than selling at $' + price.toFixed(2) + ' now, at these numbers.' + notCounted + cav;
    } else {
      resultEl.style.color = 'var(--text)';
      resultEl.textContent = 'Breakeven — storing and selling now cost the same at these numbers.' + notCounted + cav;
    }
  }
  var calcDebounce = null;
  function calcStoreOrSellDebounced(){
    clearTimeout(calcDebounce);
    calcDebounce = setTimeout(calcStoreOrSell, 400);
  }
  ['idx1-calc-price', 'idx1-calc-cost', 'idx1-calc-months', 'idx1-calc-carry', 'idx1-calc-rate', 'idx1-calc-shrink'].forEach(function(id){
    var el = $(id);
    if(el) el.addEventListener('input', function(){ el.dataset.autofilled = 'false'; calcStoreOrSellDebounced(); });
  });


  /* r7-bids 2026-10-01 (7b): THE CARRY BOX STARTS FROM THE ELEVATOR'S OWN
     BOARD. When the looked-up elevator posts a later delivery for the same
     crop (bids-homepage.js publishes it as sum.boardCarry), that difference
     is the carry, labelled with both periods. Only when the board posts no
     later period does it fall back to the Dec-to-Mar corn futures spread,
     labelled as futures carry with basis change excluded. Either way the
     note says which months the carry covers, and the result line says so
     when "months you would store" differs. Nothing is scaled. */
  var carryCover = null;   // {months, from, to} of the prefilled carry
  function carryCaveat(months){
    var el = $('idx1-calc-carry');
    if(!carryCover || !el || el.dataset.autofilled !== 'true' || carryCover.months == null || months === carryCover.months) return '';
    return ' The carry above covers ' + carryCover.from + ' to ' + carryCover.to + ' (' + carryCover.months + ' month' + (carryCover.months === 1 ? '' : 's') + '), not your ' + months + '; it is not scaled.';
  }
  function qc(c){ var a = Math.abs(c), w = Math.floor(a + 1e-9), f = Math.round((a - w) * 4); if(f === 4){ w++; f = 0; } return w + (f ? ' ' + ['', '1/4', '1/2', '3/4'][f] : '') + '¢'; }
  function prefillCarry(sum){
    var carryEl = $('idx1-calc-carry'), card = $('idx1-store-sell');
    if(!carryEl || !card || !sum) return;
    var note = $('idx1-calc-carry-src');
    if(!note){ note = document.createElement('div'); note.id = 'idx1-calc-carry-src'; note.className = 'idx1-extras-fine';
      var res = $('idx1-calc-result'); if(res && res.parentNode) res.parentNode.insertBefore(note, res); }
    function fill(v){
      if(carryEl.value === '' || carryEl.dataset.autofilled === 'true'){
        carryEl.value = v; carryEl.dataset.autofilled = 'true';
      }
      calcStoreOrSell();
    }
    var bc = sum.boardCarry;
    if(bc && bc.from && bc.to && isFinite(bc.cents)){
      if(bc.cents <= 0){
        carryCover = null;
        note.textContent = 'This elevator’s board pays ' + qc(bc.cents) + ' less for ' + bc.to + ' than ' + bc.from + ': no carry on its own board, so the box is left for your number.';
        return;
      }
      carryCover = { months: bc.months, from: bc.from, to: bc.to };
      note.textContent = String(sum.where || 'This elevator') + ' board (the bid filled above): ' + bc.from + ' $' + (+bc.fromCash).toFixed(2) + ' → ' + bc.to + ' $' + (+bc.toCash).toFixed(2) + ', +' + qc(bc.cents) + ' per bu' + (bc.months != null ? ' over ' + bc.months + ' month' + (bc.months === 1 ? '' : 's') : '') + '.';
      fill((bc.cents / 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));
      return;
    }
    /* WAVE1-A: the futures-spread fallback is corn only; another crop with no
       later bid on its own board leaves the box for the reader. */
    if(sum.crop !== 'corn'){
      carryCover = null;
      if(carryEl.dataset.autofilled === 'true'){ carryEl.value = ''; carryEl.dataset.autofilled = 'false'; }
      note.textContent = 'Carry: this elevator posts no later ' + String(sum.cropName || sum.crop || 'bid').toLowerCase() + ' bid. Enter your own.';
      calcStoreOrSell();
      return;
    }
    var p = window.__agsistPricesP || (window.__agsistPricesP = fetch('/data/prices.json', { cache: 'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; }));
    p.then(function(pd){
      var q = (pd && pd.quotes) || {}, dec = q['corn-dec'];
      var m = dec && /^ZCZ(\d{2})\./.exec(String(dec.ticker || ''));
      var my = m ? ('0' + (+m[1] + 1)).slice(-2) : '';
      var mar = m ? q['corn-mar' + my] : null;
      if(!dec || dec.close == null || !mar || mar.close == null){
        carryCover = null;
        note.textContent = 'Carry: this elevator posts no later corn bid, and the futures spread is not loaded yet. Enter your own.'; return;
      }
      var c = mar.close - dec.close, yy = m[1], when = '';
      try{ var d = new Date(pd.fetched); if(!isNaN(d)) when = d.toLocaleString('en-US', {month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZone:'America/Chicago'}) + ' CT'; }catch(e){}
      if(c <= 0){
        carryCover = null;
        note.textContent = 'This elevator posts no later corn bid, and Mar \'' + my + ' corn futures are ' + qc(c) + ' under Dec \'' + yy + ': no futures carry either. Enter your own.';
        return;
      }
      carryCover = { months: 3, from: 'Dec \'' + yy, to: 'Mar \'' + my };
      note.textContent = 'This elevator posts no later corn bid. Futures carry Dec \'' + yy + ' → Mar \'' + my + ' only, ' + qc(c) + ' per bu' + (when ? ' at ' + when : '') + '; basis gain not included.';
      fill((c / 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));
    });
  }

  function onBidsPublished(evt){
    var sum = (evt && evt.detail) || (window.AGSIST_STATE && window.AGSIST_STATE.bids);
    if(!sum || sum.cash == null) return;
    lastBid = sum;

    var card = $('idx1-store-sell'), priceEl = $('idx1-calc-price');
    if(card){
      card.style.display = 'block';
      // Only overwrite the price field if the visitor hasn't already typed
      // their own number — a fresh lookup shouldn't clobber someone mid-edit.
      if(priceEl && (priceEl.value === '' || priceEl.dataset.autofilled === 'true')){
        priceEl.value = sum.cash.toFixed(2);
        priceEl.dataset.autofilled = 'true';
        calcStoreOrSell();
      }
    }
    var picked = fillPicker(sum);

    /* Both comparison lines require at least 2 OTHER bids before showing a
       "better/worse" verdict -- "the average of 1 other bid" is just one
       other price dressed up as an average, and gave the same confident
       wording as a real average of 10. Below that floor, withhold the line
       rather than show a misleadingly small-sample claim (caught by the
       adversarial audit panel run on this feature before shipping). */
    var MIN_COMPARE_N = 2;

    var cmp = $('idx1-search-compare');
    if(cmp){
      if(sum.avgBasis != null && (sum.avgBasisElevators || 0) >= 3 && sum.basis != null){
        var diff = sum.basis - sum.avgBasis;
        var cents = Math.abs(Math.round(diff * 100));
        var verb = diff > 0.005 ? 'better' : diff < -0.005 ? 'worse' : 'even with';
        var clause = (diff > 0.005 || diff < -0.005) ? (cents + '¢/bu ' + verb + ' than') : verb;
        cmp.innerHTML = '<strong>Best bid vs. this search:</strong> basis is <strong style="color:' + (diff > 0.005 ? 'var(--green)' : diff < -0.005 ? 'var(--red,#ef4444)' : 'var(--text-dim)') + '">' + clause + '</strong> the average at ' + sum.avgBasisElevators + ' other elevators within 50 mi, same delivery month.';
        cmp.style.display = 'block';
      } else {
        cmp.style.display = 'none';
      }
    }
    var ccmp = $('idx1-distance-compare');
    if(ccmp){
      if(sum.nearbyRadiusMiles && (sum.avgBasisNearbyElevators || 0) >= MIN_COMPARE_N && sum.avgBasisNearby != null && sum.basis != null){
        var cdiff = sum.basis - sum.avgBasisNearby;
        var ccents = Math.abs(Math.round(cdiff * 100));
        var cverb = cdiff > 0.005 ? 'better' : cdiff < -0.005 ? 'worse' : 'even with';
        var cclause = (cdiff > 0.005 || cdiff < -0.005) ? (ccents + '¢/bu ' + cverb + ' than') : cverb;
        ccmp.innerHTML = '<strong>Within ' + sum.nearbyRadiusMiles + ' mi, straight-line:</strong> basis is <strong style="color:' + (cdiff > 0.005 ? 'var(--green)' : cdiff < -0.005 ? 'var(--red,#ef4444)' : 'var(--text-dim)') + '">' + cclause + '</strong> the average at ' + sum.avgBasisNearbyElevators + ' other elevators in that fixed ring, not road miles.';
        ccmp.style.display = 'block';
      } else {
        ccmp.style.display = 'none';
      }
    }
    renderBasisChart(picked);
    prefillCarry(picked);
  }

  /* WAVE1-A: WHICH BID FILLED THE CALCULATOR, AND WHY, AND A CHOICE.
     bids-homepage.js picks the highest corn cash among bids for the nearest
     open delivery month (sum.pickRule, sum.pickCount) and lists every
     elevator's nearest open bid per crop in sum.options. */
  var pickOptions = [];
  function optLabel(o){
    return o.where + (townOf(o) ? ', ' + townOf(o) : '') + ' · ' + o.cropName + ' ' + o.monthLabel + ' · $' + (+o.cash).toFixed(2) + (o.miles != null ? ' · ' + Math.round(o.miles) + ' mi' : '');
  }
  /* Said only when a listed elevator with the same crop is actually closer. */
  function nearer(o){
    return o.miles != null && pickOptions.some(function(x){ return x !== o && x.crop === o.crop && x.miles != null && x.miles < o.miles; });
  }
  function townOf(o){
    var c = String(o.city || ''), t = c.replace(/,\s*[A-Z]{2}$/, '');
    return t && t.toLowerCase() === String(o.where || '').toLowerCase() ? c.replace(/^.*?,\s*/, '') : c;
  }
  function whyText(o, sum){
    if(o.isBest) return 'Filled from ' + o.where + (o.city ? ' (' + o.city + ')' : '') + ': the ' + (sum.pickRule || 'highest corn bid nearby')
      + (sum.monthLabel ? ' for ' + sum.monthLabel + ' delivery' : '') + (sum.pickCount ? ', out of ' + sum.pickCount + ' corn bid' + (sum.pickCount === 1 ? '' : 's') + ' for that month' : '') + '.' + (nearer(o) ? ' Not the nearest elevator; pick another above.' : ' Pick another elevator above.');
    return 'Filled from ' + o.where + (o.city ? ' (' + o.city + ')' : '') + ', your pick: ' + o.cropName.toLowerCase() + ' for ' + o.monthLabel + ' delivery.';
  }
  function fillPicker(sum){
    var sel = $('idx1-calc-pick'), why = $('idx1-calc-why');
    pickOptions = (sum.options || []).filter(function(o){ return o && o.cash != null && isFinite(o.cash); });
    var best = null;
    pickOptions.forEach(function(o){ if(o.isBest) best = o; });
    if(!best) best = { where: sum.where, city: sum.city, crop: 'corn', cropName: 'Corn', cash: sum.cash, monthKey: sum.monthKey, monthLabel: sum.monthLabel || '', boardCarry: sum.boardCarry, miles: sum.miles, isBest: true };
    if(sel){
      sel.innerHTML = '';
      (pickOptions.length ? pickOptions : [best]).forEach(function(o, i){
        var op = document.createElement('option'); op.value = String(i); op.textContent = optLabel(o) + (o.isBest ? ' (filled)' : '');
        if(o === best) op.selected = true; sel.appendChild(op);
      });
      if(!pickOptions.length) pickOptions = [best];
      sel.onchange = function(){
        var o = pickOptions[+sel.value]; if(!o) return;
        var priceEl = $('idx1-calc-price');
        if(priceEl){ priceEl.value = (+o.cash).toFixed(2); priceEl.dataset.autofilled = 'true'; }
        var carryEl = $('idx1-calc-carry'); if(carryEl && carryEl.dataset.autofilled !== 'false') carryEl.dataset.autofilled = 'true';
        if(why) why.textContent = whyText(o, sum);
        renderBasisChart(o);
        prefillCarry(o);
        calcStoreOrSell();
      };
    }
    if(why) why.textContent = whyText(best, sum);
    return best;
  }
  window.addEventListener('agsist:bids', onBidsPublished);
  // In case bids already loaded before this script attached its listener.
  if(window.AGSIST_STATE && window.AGSIST_STATE.bids) onBidsPublished(null);

  // ── 5: basis history chart ──────────────────────────────────────────
  // Real change-points from scripts/build_basis_sparklines.py, replayed from
  // data/basis/changes-*.json. No file exists for a state until it has had a
  // change logged, and the headline bid's facility+city may not be in it --
  // both are real "nothing to show" cases, not bugs, and the chart just
  // stays hidden. Never interpolates or fills a gap.
  var sparkCache = {};
  function normKey(s){ return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  /* WAVE1-A: the network writes "Badger Grain Supply, LLC" and the basis log
     writes "BADGER GRAIN SUPPLY", so the exact match never found the chart.
     Case, punctuation, "&"/"and", and trailing legal words and co-op words
     are dropped before comparing. The town must still match exactly. */
  var FAC_TAIL = {LLC:1,LC:1,INC:1,INCORPORATED:1,CO:1,CORP:1,CORPORATION:1,LTD:1,LIMITED:1,LP:1,LLP:1,COMPANY:1,COOP:1,COOPERATIVE:1,ASSN:1,ASSOCIATION:1};
  function normFac(s){
    var t = String(s || '').toUpperCase().replace(/&/g, ' AND ').replace(/\bCO[\s.-]*OP\b/g, 'COOP')
      .replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(function(x){ return x; });
    while(t.length > 1 && FAC_TAIL[t[t.length - 1]]) t.pop();
    return t.join('');
  }
  function foldTitle(withChart){
    var f = $('idx1-basis-chart'), d = f && f.closest && f.closest('details'), sp = d && d.querySelector('summary span');
    if(sp) sp.textContent = withChart ? 'Store or sell? Basis history' : 'Store or sell?';
  }
  function fetchSparklines(state){
    if(sparkCache[state]) return sparkCache[state];
    sparkCache[state] = fetch('/data/basis-sparklines/' + state + '.json')
      .then(function(r){ return r.ok ? r.json() : null; })
      .catch(function(){ return null; });
    return sparkCache[state];
  }
  function renderBasisChart(sum){
    var card = $('idx1-basis-chart'), svg = $('idx1-basis-svg'), fine = $('idx1-basis-chart-fine');
    if(!card || !svg || !fine) return;
    var hide = function(){ card.style.display = 'none'; foldTitle(false); };
    var wantCrop = sum.crop || 'corn';
    if(['corn','soybeans','wheat'].indexOf(wantCrop) < 0){ hide(); return; }
    var cityState = String(sum.city || '');
    var m = /^(.*?),\s*([A-Z]{2})$/.exec(cityState.trim());
    if(!m){ hide(); return; }
    var cityName = m[1], state = m[2];
    var facilityName = String(sum.where || '').split('·')[0].trim();
    if(!facilityName){ hide(); return; }
    var wantFac = normFac(facilityName), wantCity = normKey(cityName);

    fetchSparklines(state).then(function(data){
      if(!data || !data.series){ hide(); return; }
      var best = null, bestLen = 0, bestMon = '', wantMon = '';
      var MM = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
      var mk = /^(\d{4})-(\d{2})$/.exec(sum.monthKey || '');
      if(mk) wantMon = MM[+mk[2] - 1] + mk[1].slice(2);
      var bestMatch = false;
      Object.keys(data.series).forEach(function(key){
        var parts = key.split('|');
        if(parts.length < 6) return;
        var fac = parts[1], city = parts[2], commodity = parts[3];
        if(commodity !== wantCrop) return;
        if(normFac(fac) !== wantFac || normKey(city) !== wantCity) return;
        var pts = data.series[key], match = !!wantMon && parts[5] === wantMon;
        if((match && !bestMatch) || (match === bestMatch && pts.length > bestLen)){ best = pts; bestLen = pts.length; bestMon = parts[5]; bestMatch = match; }
      });
      if(!best || best.length < 2){ hide(); return; }

      var pts = best.slice(-20); // most recent real change-points only
      var cents = pts.map(function(p){ return p.cents; });
      var lo = Math.min.apply(null, cents), hi = Math.max.apply(null, cents);
      var rawLo = lo, rawHi = hi;   // printed; lo/hi below may be widened for drawing only
      if(lo === hi){ lo -= 1; hi += 1; }
      var w = 300, h = 70, pad = 4;
      /* x by date, so a three-month gap looks like one. */
      var tms = pts.map(function(p){ return Date.parse(p.date); });
      var t0 = tms[0], t1 = tms[tms.length - 1];
      var xs = tms.map(function(tm, i){ return (pts.length === 1 || !(t1 > t0)) ? pad + i * (w - 2 * pad) / Math.max(1, pts.length - 1) : pad + (tm - t0) * (w - 2 * pad) / (t1 - t0); });
      var ys = cents.map(function(c){ return h - pad - (c - lo) * (h - 2 * pad) / (hi - lo); });
      var zeroY = (lo <= 0 && hi >= 0) ? (h - pad - (0 - lo) * (h - 2 * pad) / (hi - lo)) : null;
      var poly = xs.map(function(x, i){ return x.toFixed(1) + ',' + ys[i].toFixed(1); }).join(' ');
      var last = cents[cents.length - 1];
      /* WAVE1-A: one colour. A negative basis is not bad news by itself. */
      var lineColor = 'var(--gold)';

      var svgHtml = '';
      if(zeroY != null){
        svgHtml += '<line x1="0" y1="' + zeroY.toFixed(1) + '" x2="' + w + '" y2="' + zeroY.toFixed(1) + '" stroke="var(--border)" stroke-width="1" stroke-dasharray="2,2"/>';
      }
      svgHtml += '<polyline points="' + poly + '" fill="none" stroke="' + lineColor + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      svg.innerHTML = svgHtml;
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Basis at this elevator ranged from ' + rawLo + ' to ' + rawHi + ' cents over the last ' + pts.length + ' logged changes, most recently ' + last + ' cents.');

      var firstDate = pts[0].date;
      var monTxt = /^[A-Z]{3}\d{2}$/.test(bestMon) ? bestMon.charAt(0) + bestMon.slice(1, 3).toLowerCase() + ' \u2019' + bestMon.slice(3) + ' delivery' : 'one delivery month';
      fine.textContent = pts.length + ' basis change' + (pts.length === 1 ? '' : 's') + ' logged at this elevator for ' + monTxt + ', ' + firstDate + ' through ' + pts[pts.length - 1].date + ', ' + rawLo + '\u00a2 to ' + rawHi + '\u00a2.'
        + (bestMatch ? '' : ' Not the month quoted above.');
      var ttl = card.querySelector('.idx1-extras-title');
      if(ttl && ttl.lastChild && ttl.lastChild.nodeType === 3) ttl.lastChild.textContent = ' Basis history at this elevator, ' + wantCrop;
      card.style.display = 'block';
      foldTitle(true);
    });
  }

  // ── 4: add-to-home-screen, wired to the real browser install prompt ───
  var DISMISS_KEY = 'agsist_home_prompt_dismissed_v1';
  var deferredInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    deferredInstallPrompt = e;
    var dismissed = false;
    try { dismissed = window.localStorage.getItem(DISMISS_KEY) === 'true'; } catch(err){}
    if(!dismissed){
      var banner = $('idx1-home-prompt');
      if(banner) banner.style.display = 'flex';
    }
  });
  var addBtn = $('idx1-home-add');
  if(addBtn){
    addBtn.addEventListener('click', function(){
      if(!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.finally(function(){
        deferredInstallPrompt = null;
        var banner = $('idx1-home-prompt');
        if(banner) banner.style.display = 'none';
      });
    });
  }
  var dismissBtn = $('idx1-home-dismiss');
  if(dismissBtn){
    dismissBtn.addEventListener('click', function(){
      var banner = $('idx1-home-prompt');
      if(banner) banner.style.display = 'none';
      try { window.localStorage.setItem(DISMISS_KEY, 'true'); } catch(e){}
    });
  }

  // ── 6: Watch this elevator ──────────────────────────────────────────
  // Double opt-in, same shape as the Farmland Atlas county watch that has
  // been mailing real readers since 2026-09-25 -- see workers/subs-worker.js
  // and scripts/send_elevator_watch.py for the server side. This file only
  // ever POSTs a short hash and a label; it never tells the worker a
  // facility name. `agsist_watching` in localStorage is a courtesy so a
  // returning visitor sees "Watching" instead of the button again -- it is
  // NOT the source of truth (double opt-in email confirmation is), so it is
  // never trusted for anything but that one line of UI.
  var WATCH_WORKER = 'https://agsist-subs.dnilgis.workers.dev';
  var WATCH_KEY = 'agsist_watching';
  function watchedSet(){
    try{ return JSON.parse(window.localStorage.getItem(WATCH_KEY) || '{}'); }catch(e){ return {}; }
  }
  function markWatched(wid){
    try{
      var s = watchedSet(); s[wid] = Date.now();
      window.localStorage.setItem(WATCH_KEY, JSON.stringify(s));
    }catch(e){}
  }
  var bidsArea = $('bids-list-area');
  if(bidsArea){
    bidsArea.addEventListener('click', function(evt){
      var btn = evt.target.closest && evt.target.closest('.watch-elevator-btn');
      if(!btn) return;
      var wrap = btn.closest('.watch-elevator-wrap');
      if(!wrap) return;
      var wid = wrap.getAttribute('data-wid'), label = wrap.getAttribute('data-label');
      if(!wid || !label) return;
      if(watchedSet()[wid]){
        wrap.innerHTML = '<span style="font-size:.66rem;color:var(--green)">Watching this elevator — check your email to confirm</span>';
        return;
      }
      wrap.innerHTML = '<div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap">'
        + '<input type="email" class="watch-elevator-email" placeholder="your@email.com" autocomplete="email" aria-label="Email to watch ' + label + '" style="flex:1;min-width:140px;padding:.35rem .5rem;background:var(--surface2);border:1px solid var(--border);border-radius:5px;font-size:.72rem;color:var(--text)">'
        + '<button type="button" class="watch-elevator-go" style="padding:.35rem .6rem;background:var(--gold);color:#0a0c0d;border:none;border-radius:5px;font-size:.7rem;font-weight:700;cursor:pointer;white-space:nowrap">Watch — free</button>'
        + '</div><div class="watch-elevator-status" style="font-size:.64rem;color:var(--text-muted);margin-top:.25rem"></div>';
      wrap.setAttribute('data-wid', wid);
      wrap.setAttribute('data-label', label);
      var input = wrap.querySelector('.watch-elevator-email');
      if(input) input.focus();
      var go = wrap.querySelector('.watch-elevator-go');
      var status = wrap.querySelector('.watch-elevator-status');
      function submit(){
        var email = (input.value || '').trim();
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){
          status.textContent = 'Enter a real email address.';
          status.style.color = 'var(--red,#ef4444)';
          return;
        }
        go.disabled = true; go.textContent = 'Sending…';
        status.textContent = '';
        fetch(WATCH_WORKER + '/elevator-watch-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, wid: wid, label: label })
        }).then(function(r){ return r.json().catch(function(){ return {}; }); })
          .then(function(data){
            if(data && data.error === 'limit'){
              status.textContent = 'You are already watching 5 elevators — the most one address can track at once.';
              status.style.color = 'var(--red,#ef4444)';
              go.disabled = false; go.textContent = 'Watch — free';
              return;
            }
            markWatched(wid);
            wrap.innerHTML = '<span style="font-size:.66rem;color:var(--green)">Check your email to confirm — nothing is sent until you do.</span>';
          })
          .catch(function(){
            status.textContent = 'Could not reach the watch service — try again in a minute.';
            status.style.color = 'var(--red,#ef4444)';
            go.disabled = false; go.textContent = 'Watch — free';
          });
      }
      if(go) go.addEventListener('click', submit);
      if(input) input.addEventListener('keydown', function(e){ if(e.key === 'Enter') submit(); });
    });
  }
})();
