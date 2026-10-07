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
    /* WAVE3-H: each box is checked on its own, the first bad one is named
       and marked aria-invalid, and the rest are cleared. */
    var boxes = [priceEl, costEl, monthsEl, carryEl, rateEl, shrinkEl];
    function bad(el, msg){
      boxes.forEach(function(b){ if(b) b.removeAttribute('aria-invalid'); });
      if(el){ el.setAttribute('aria-invalid', 'true'); el.setAttribute('aria-describedby', 'idx1-calc-result'); }
      resultEl.style.color = 'var(--red,#ef4444)';
      resultEl.textContent = msg;
      math('');
    }
    boxes.forEach(function(b){ if(b) b.removeAttribute('aria-invalid'); });
    if(priceRaw === '' || costRaw === '' || monthsRaw === '' || carryRaw === ''){
      resultEl.style.color = 'var(--text-dim)';
      resultEl.textContent = 'Enter your numbers above.';
      math('');
      return;
    }
    var price = parseFloat(priceRaw), cost = parseFloat(costRaw), months = parseFloat(monthsRaw), carry = parseFloat(carryRaw);
    var rate = rateRaw === '' ? null : parseFloat(rateRaw), shrink = shrinkRaw === '' ? null : parseFloat(shrinkRaw);
    if(!isFinite(price) || price <= 0) return bad(priceEl, 'Cash price: enter a price above $0 per bushel.');
    if(!isFinite(cost) || cost < 0) return bad(costEl, 'Storage cost: enter $0 or more per bushel per month.');
    if(!isFinite(months) || months < 0 || Math.round(months) !== months) return bad(monthsEl, 'Months you would store: enter whole months, 0 to 24.');
    if(months > 24) return bad(monthsEl, 'Months you would store: 24 at most.');
    if(!isFinite(carry)) return bad(carryEl, 'Carry: enter a number in $/bu. Use a minus sign when the later month pays less.');
    if(rate !== null && !(isFinite(rate) && rate >= 0 && rate <= 30)) return bad(rateEl, 'Interest rate: 0 to 30% a year, or leave it blank.');
    if(shrink !== null && !(isFinite(shrink) && shrink >= 0 && shrink <= 20)) return bad(shrinkEl, 'Shrink: 0 to 20%, or leave it blank.');
    if(months === 0){
      resultEl.style.color = 'var(--text-dim)';
      resultEl.textContent = 'No storage period entered.';
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
    var lines = ['Carry you expect          ' + (carry < 0 ? '−' : '+') + money(carry),
      '− storage ' + money(cost) + ' × ' + months + ' mo     −' + money(totalCost)];
    lines.push(rate === null ? '− interest                not counted (no rate entered)'
      : '− interest ' + money(price) + ' × ' + rate + '% × ' + months + '/12   −' + money(interest));
    lines.push(shrink === null ? '− shrink                  not counted (no shrink entered)'
      : '− shrink ' + shrink + '% × (' + money(price) + ' ' + (carry < 0 ? '−' : '+') + ' ' + money(carry) + ')   −' + money(shrinkLoss));
    lines.push('= ' + (net >= 0 ? '+' : '−') + money(net) + ' per bushel stored, against selling at ' + money(price) + ' now');
    math(lines.join('\n'));
    /* WAVE3-H: the prefilled carry is for its own months. Months that differ
       pair one period's carry with another period's costs, so no verdict and
       no colour: the math stays visible and the line says what to fix. */
    if(cav){
      resultEl.style.color = 'var(--text)';
      resultEl.textContent = cav + ' Set months to ' + carryCover.months + ', or enter your own carry for ' + months + ' month' + (months === 1 ? '' : 's') + '. The math is below.';
      var box = mathEl && mathEl.closest && mathEl.closest('details'); if(box) box.open = true;
      return;
    }
    if(net > 0.001){
      resultEl.style.color = 'var(--green)';
      resultEl.textContent = 'Storing pencils out by +$' + net.toFixed(2) + '/bu over selling at $' + price.toFixed(2) + ' now, if your carry estimate holds.' + notCounted;
    } else if(net < -0.001){
      resultEl.style.color = 'var(--red,#ef4444)';
      resultEl.textContent = 'Storing costs $' + Math.abs(net).toFixed(2) + '/bu more than selling at $' + price.toFixed(2) + ' now, at these numbers.' + notCounted;
    } else {
      resultEl.style.color = 'var(--text)';
      resultEl.textContent = 'Breakeven — storing and selling now cost the same at these numbers.' + notCounted;
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
    return 'The carry covers ' + carryCover.months + ' month' + (carryCover.months === 1 ? '' : 's') + ' (' + carryCover.from + ' to ' + carryCover.to + '), not your ' + months + '.';
  }
  function qc(c){ var a = Math.abs(c), w = Math.floor(a + 1e-9), f = Math.round((a - w) * 4); if(f === 4){ w++; f = 0; } return w + (f ? ' ' + ['', '1/4', '1/2', '3/4'][f] : '') + '¢'; }
  /* WAVE3-H: a prefilled carry also fills "months you would store" with the
     carry's own months, so the two always describe the same period until the
     reader changes one. A pick with no carry clears both boxes if they were
     filled here, so a stale carry never sits beside a new price. */
  function clearAuto(){
    var carryEl = $('idx1-calc-carry'), monthsEl = $('idx1-calc-months');
    carryCover = null;
    if(carryEl && carryEl.dataset.autofilled === 'true'){ carryEl.value = ''; carryEl.dataset.autofilled = 'false'; }
    if(monthsEl && monthsEl.dataset.autofilled === 'true'){ monthsEl.value = ''; monthsEl.dataset.autofilled = 'false'; }
  }
  function prefillCarry(sum){
    var carryEl = $('idx1-calc-carry'), monthsEl = $('idx1-calc-months'), card = $('idx1-store-sell');
    if(!carryEl || !card || !sum) return;
    var note = $('idx1-calc-carry-src');
    if(!note){ note = document.createElement('div'); note.id = 'idx1-calc-carry-src'; note.className = 'idx1-extras-fine';
      var res = $('idx1-calc-result'); if(res && res.parentNode) res.parentNode.insertBefore(note, res); }
    function fill(v){
      if(carryEl.value === '' || carryEl.dataset.autofilled === 'true'){
        carryEl.value = v; carryEl.dataset.autofilled = 'true';
        if(monthsEl && carryCover && carryCover.months != null && (monthsEl.value === '' || monthsEl.dataset.autofilled === 'true')){
          monthsEl.value = String(carryCover.months); monthsEl.dataset.autofilled = 'true';
        }
      }
      calcStoreOrSell();
    }
    function span(c){ return c.from + ' to ' + c.to + (c.months != null ? ' (' + c.months + ' month' + (c.months === 1 ? '' : 's') + ')' : ''); }
    var bc = sum.boardCarry;
    if(bc && bc.from && bc.to && isFinite(bc.cents)){
      if(bc.cents <= 0){
        clearAuto();
        note.textContent = 'This elevator pays ' + (bc.cents < 0 ? qc(bc.cents) + ' less' : 'the same') + ' for ' + bc.to + ' as for ' + bc.from + ': no carry at this elevator, so the box is left for your number.';
        calcStoreOrSell();
        return;
      }
      carryCover = { months: bc.months, from: bc.from, to: bc.to };
      note.textContent = 'Carry at this elevator: +' + qc(bc.cents) + ' from ' + span(bc) + '.';
      fill((bc.cents / 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));
      return;
    }
    /* WAVE1-A: the futures-spread fallback is corn only; another crop with no
       later bid on its own board leaves the box for the reader. */
    if(sum.crop !== 'corn'){
      clearAuto();
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
        clearAuto();
        note.textContent = 'Carry: this elevator posts no later corn bid, and the futures spread is not loaded yet. Enter your own.';
        calcStoreOrSell();
        return;
      }
      var c = mar.close - dec.close, yy = m[1], when = '';
      try{ var d = new Date(pd.fetched); if(!isNaN(d)) when = d.toLocaleString('en-US', {month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZone:'America/Chicago'}) + ' CT'; }catch(e){}
      carryCover = { months: 3, from: 'Dec \'' + yy, to: 'Mar \'' + my };
      /* WAVE3-H: an inverted spread is filled as a negative carry. It is the
         market's real answer: it pays less to wait. */
      note.textContent = 'This elevator posts no later corn bid. Futures carry ' + span(carryCover) + ' only, '
        + (c < 0 ? '−' : c > 0 ? '+' : '') + qc(c) + ' per bu' + (c < 0 ? ' (Mar under Dec, an inverted market)' : '')
        + (when ? ' at ' + when : '') + '; basis gain not included.';
      fill((c / 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '') || '0');
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
  function townOf(o){
    var c = String(o.city || ''), t = c.replace(/,\s*[A-Z]{2}$/, '');
    return t && t.toLowerCase() === String(o.where || '').toLowerCase() ? c.replace(/^.*?,\s*/, '') : c;
  }
  function whyText(o, sum){
    /* The select above already names the elevator; this says why it was picked. */
    if(o.isBest){
      var r = sum.pickRule || 'highest corn bid nearby';
      return r.charAt(0).toUpperCase() + r.slice(1) + (sum.monthLabel ? ' for ' + sum.monthLabel : '')
        + (sum.pickCount ? ' (of ' + sum.pickCount + ')' : '') + '.';
    }
    return 'Your pick: ' + o.cropName.toLowerCase() + ', ' + o.monthLabel + ' delivery.';
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
        var op = document.createElement('option'); op.value = String(i); op.textContent = optLabel(o) + (o.isBest ? ' (in use)' : '');
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
    if(sp) sp.textContent = withChart ? 'Store or sell? · basis history' : 'Store or sell?';
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
      /* Printed with a true minus sign (U+2212), as the rest of the page writes basis. */
      var sc = function(c){ return (c < 0 ? '\u2212' : '') + Math.abs(c); };
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
      svg.setAttribute('aria-label', 'Basis at this elevator ranged from ' + sc(rawLo) + ' to ' + sc(rawHi) + ' cents over the last ' + pts.length + ' logged changes, most recently ' + sc(last) + ' cents.');

      var firstDate = pts[0].date;
      var monShort = /^[A-Z]{3}\d{2}$/.test(bestMon) ? bestMon.charAt(0) + bestMon.slice(1, 3).toLowerCase() + ' \u2019' + bestMon.slice(3) : '';
      var monTxt = monShort ? monShort + ' delivery' : 'one delivery month';
      /* WAVE3-H: say which month the chart is, and when it is not the bid's
         month, say that plainly with the bid's month named. */
      fine.textContent = pts.length + ' basis change' + (pts.length === 1 ? '' : 's') + ' logged at this elevator for ' + monTxt + ', ' + firstDate + ' through ' + pts[pts.length - 1].date + ', ' + sc(rawLo) + '\u00a2 to ' + sc(rawHi) + '\u00a2.'
        + (bestMatch ? '' : wantMon && sum.monthLabel ? ' The bid above is for ' + sum.monthLabel + '; no changes are logged for that month here.' : ' Not the month quoted above.');
      var ttl = card.querySelector('.idx1-extras-title');
      if(ttl && ttl.lastChild && ttl.lastChild.nodeType === 3) ttl.lastChild.textContent = ' Basis history at this elevator, ' + wantCrop + (monShort ? ', ' + monTxt : '');
      /* WAVE3-H: the two end values, printed under the line's two ends. */
      var ends = $('idx1-basis-ends');
      if(ends){
        var MS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var dl = function(d){ var x = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return x ? MS[+x[2] - 1] + ' ' + (+x[3]) : String(d || ''); };
        var cl = function(c){ return (c > 0 ? '+' : c < 0 ? '\u2212' : '') + Math.abs(c) + '\u00a2'; };
        ends.innerHTML = '';
        [[pts[0], 'idx1-basis-end-a'], [pts[pts.length - 1], 'idx1-basis-end-b']].forEach(function(e){
          var sp = document.createElement('span'); sp.className = e[1];
          sp.textContent = dl(e[0].date) + ': ' + cl(e[0].cents);
          ends.appendChild(sp);
        });
      }
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
  /* WAVE2-G 2026-10-03: ALERT OPTIONS. The worker is asked once whether it
     knows the options (GET /elevator-watch-options, worker v5.3). Until it
     answers yes -- an older worker, a slow network -- the form is exactly the
     plain "Watch -- free" one, so nothing breaks before or after Sig
     redeploys the worker. The rows offered come from the card itself
     (data-opts on the wrap, written by components/bids-homepage.js). */
  var optsProbe = null;
  function workerHasOptions(){
    if(!optsProbe){
      optsProbe = Promise.race([
        fetch(WATCH_WORKER + '/elevator-watch-options').then(function(r){ return r.ok ? r.json() : null; })
          .then(function(d){ return !!(d && d.ok && d.kinds && d.kinds.indexOf('cash') >= 0); }),
        new Promise(function(res){ setTimeout(function(){ res(false); }, 3000); })
      ]).catch(function(){ return false; });
    }
    return optsProbe;
  }
  function aidFor(ewid, kind, period, rest){
    var H = window.__agsistHomeBidsInternals;
    return H && H.widFor ? H.widFor(ewid, kind, period, rest) : '';
  }
  function fmtCash(c){ return '$' + (c / 100).toFixed(2); }
  function fmtBasis(c){ return c === 0 ? 'even' : (c > 0 ? '+' : '−') + Math.abs(c) + '¢'; }
  function escA(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  var FLD = 'display:flex;flex-direction:column;gap:.15rem;flex:1 1 9rem;min-width:0';
  var KEY = 'font-size:.8125rem;color:var(--text-muted)';
  var FIELD = 'padding:.4rem .5rem;background:var(--surface2);border:1px solid var(--border);border-radius:5px;font-size:.8rem;color:var(--text);min-height:36px;box-sizing:border-box';

  var bidsArea = $('bids-list-area');
  if(bidsArea){
    bidsArea.addEventListener('click', function(evt){
      var btn = evt.target.closest && evt.target.closest('.watch-elevator-btn');
      if(!btn) return;
      var wrap = btn.closest('.watch-elevator-wrap');
      if(!wrap) return;
      var wid = wrap.getAttribute('data-wid'), label = wrap.getAttribute('data-label');
      var name = wrap.getAttribute('data-name') || '';
      var opts = [];
      try{ opts = JSON.parse(wrap.getAttribute('data-opts') || '[]') || []; }catch(e){ opts = []; }
      if(!(wid && label) && !opts.length) return;
      if(!opts.length && watchedSet()[wid]){
        wrap.innerHTML = '<span style="font-size:.8125rem;color:var(--green)">Watching this elevator — check your email to confirm (it arrives within about 15 minutes)</span>';
        return;
      }
      btn.disabled = true; btn.textContent = 'Loading…';
      (opts.length ? workerHasOptions() : Promise.resolve(false)).then(function(full){
        if(!full && !wid){ btn.disabled = false; btn.textContent = 'Alerts are not available right now'; return; }
        drawForm(wrap, wid, label, name, full ? opts : []);
      });
    });
  }

  var formSeq = 0;
  function drawForm(wrap, wid, label, name, opts){
    var seen = watchedSet()[wid], sid = 'we-status-' + (++formSeq);
    var kinds = [];
    if(wid) kinds.push(['any', 'corn basis changes']);
    if(opts.length){
      kinds.push(['cash', 'cash price reaches']);
      kinds.push(['basis', 'basis reaches']);
      kinds.push(['move', 'basis moves by']);
    }
    var h = '<div class="we-form">';
    if(seen) h += '<div class="we-seen" style="font-size:.8125rem;color:var(--green);margin-bottom:.3rem">You asked to watch this elevator before. Check your email to confirm; it arrives within about 15 minutes.</div>';
    if(opts.length){
      h += '<div class="we-grid" style="display:flex;flex-wrap:wrap;gap:.4rem .5rem;align-items:flex-end">'
        + '<label class="we-f" style="' + FLD + '"><span class="we-k" style="' + KEY + '">Email me when</span><select class="we-kind" style="' + FIELD + '">'
        + kinds.map(function(k){ return '<option value="' + k[0] + '">' + k[1] + '</option>'; }).join('') + '</select></label>'
        + '<label class="we-f we-for" style="' + FLD + ';flex-basis:11rem"><span class="we-k" style="' + KEY + '">For</span><select class="we-row" style="' + FIELD + '">'
        + opts.map(function(o, i){ return '<option value="' + i + '">' + escA(o.n + ' · ' + o.l) + '</option>'; }).join('') + '</select></label>'
        + '<label class="we-f we-dirf" style="' + FLD + '"><span class="we-k" style="' + KEY + '">Side</span><select class="we-dir" style="' + FIELD + '"><option value="above">at or above</option><option value="below">at or below</option></select></label>'
        + '<label class="we-f we-valf" style="' + FLD + '"><span class="we-k we-unit" style="' + KEY + '">Price, $</span><input type="number" class="we-val" inputmode="decimal" style="' + FIELD + ';width:100%;font-family:\'JetBrains Mono\',monospace"></label>'
        + '</div>'
        + '<div class="we-now" aria-live="polite" style="font-family:\'JetBrains Mono\',monospace;font-size:.8125rem;color:var(--text-muted);margin-top:.3rem"></div>';
    }
    h += '<div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;margin-top:.35rem">'
      + '<input type="email" class="watch-elevator-email" placeholder="your@email.com" autocomplete="email" aria-label="Email for alerts on ' + escA(name || label) + '" style="flex:1;min-width:140px;' + FIELD + '">'
      + '<button type="button" class="watch-elevator-go" style="padding:.4rem .7rem;min-height:36px;background:var(--gold-fill,var(--gold));color:#0a0c0d;border:none;border-radius:5px;font-size:.8rem;font-weight:700;cursor:pointer;white-space:nowrap">Watch — free</button>'
      + '</div>'
      /* 2026-10-06: the labelled daily opt-in, ticked by default, shown only
         to a reader who has not signed up (components/signup-ask.js). */
      + (window.AgsistSignup && !window.AgsistSignup.isSignedUp()
        ? '<label class="sa-optin"><input type="checkbox" class="we-optin" checked> Also send me AGSIST Daily, free, every weekday morning</label>' : '')
      + '<div class="we-note" style="font-size:.8125rem;color:var(--text-muted);margin-top:.25rem">Email when the posted corn basis changes.</div>'
      + '<div class="watch-elevator-status" id="' + sid + '" role="status" tabindex="-1" style="font-size:.8125rem;color:var(--text-muted);margin-top:.25rem"></div></div>';
    wrap.innerHTML = h;
    wrap.classList.add('we-open');

    var q = function(c){ return wrap.querySelector(c); };
    var input = q('.watch-elevator-email'), go = q('.watch-elevator-go'), status = q('.watch-elevator-status');
    var kindSel = q('.we-kind'), rowSel = q('.we-row'), dirSel = q('.we-dir'), val = q('.we-val'), note = q('.we-note');
    function show(el, on){ var f = el && el.closest('.we-f'); if(f) f.style.display = on ? 'flex' : 'none'; }
    function sync(){
      if(!kindSel) return;
      var k = kindSel.value, o = opts[+rowSel.value] || opts[0];
      show(rowSel, k !== 'any'); show(dirSel, k === 'cash' || k === 'basis'); show(val, k !== 'any');
      var unit = q('.we-unit'), nowEl = q('.we-now');
      if(k === 'cash'){ unit.textContent = 'Price, $'; val.step = '0.01'; val.min = '1'; val.max = '32'; val.placeholder = (o.cash / 100).toFixed(2); }
      else if(k === 'basis'){ unit.textContent = 'Basis, ¢ (minus = under)'; val.step = '1'; val.min = '-300'; val.max = '300'; val.placeholder = String(o.basis); }
      else if(k === 'move'){ unit.textContent = 'Cents, at least'; val.step = '1'; val.min = '1'; val.max = '100'; val.placeholder = '5'; }
      nowEl.textContent = k === 'any' ? '' : 'Now ' + fmtCash(o.cash) + ' · basis ' + fmtBasis(o.basis) + (o.t ? ' · posted ' + o.t : '');
      note.textContent = k === 'any' ? 'Email when the posted corn basis changes.'
        : k === 'move' ? 'Email each time a new posting moves this basis that far from the last email. If the elevator stops posting this period, you get one note and the alert ends.'
        : 'One email when a new posting reaches it, then the alert clears. If the elevator stops posting this period, you get one note and the alert ends.';
    }
    if(kindSel){
      kindSel.addEventListener('change', sync);
      rowSel.addEventListener('change', sync);
      if(!wid) kindSel.value = 'cash';
      sync();
    }
    if(input) input.focus();

    /* WAVE3-H: a failure names its field with aria-invalid, points the field
       at the status line, and moves focus there so the reader can fix it. */
    function fail(msg, field){
      status.textContent = msg; status.style.color = 'var(--red,#ef4444)';
      [input, val, rowSel].forEach(function(f){ if(f) f.removeAttribute('aria-invalid'); });
      if(field){ field.setAttribute('aria-invalid', 'true'); field.setAttribute('aria-describedby', sid); field.focus(); }
      else status.focus();
    }
    function submit(){
      var email = (input.value || '').trim();
      var k = kindSel ? kindSel.value : 'any';
      var body = { email: email, wid: wid, label: label };
      if(k !== 'any'){
        var o = opts[+rowSel.value], raw = parseFloat(val.value), cond;
        if(!o) return fail('Pick a row.', rowSel);
        body = { email: email, kind: k, ewid: o.w, crop: o.c, period: o.p, plabel: o.l };
        if(k === 'cash'){
          if(!(raw >= 1 && raw <= 32)) return fail('Enter a cash price between $1.00 and $32.00.', val);
          body.direction = dirSel.value; body.target_cents = Math.round(raw * 100);
          cond = 'cash ' + (dirSel.value === 'above' ? 'at or above ' : 'at or below ') + fmtCash(body.target_cents);
        } else if(k === 'basis'){
          if(!(raw >= -300 && raw <= 300) || Math.round(raw) !== raw) return fail('Enter a basis in whole cents, -300 to 300.', val);
          body.direction = dirSel.value; body.target_cents = raw;
          cond = 'basis ' + (dirSel.value === 'above' ? 'at or above ' : 'at or below ') + fmtBasis(raw);
        } else {
          if(!(raw >= 1 && raw <= 100) || Math.round(raw) !== raw) return fail('Enter a move of 1 to 100 cents.', val);
          body.move_cents = raw;
          cond = 'basis moves ' + raw + '¢ or more';
        }
        body.wid = aidFor(o.w, k, o.p, (body.direction || '') + ':' + (k === 'move' ? body.move_cents : body.target_cents));
        body.label = (name + ' — ' + o.n.toLowerCase() + ' ' + o.l + ': ' + cond).slice(0, 120);
        if(!body.wid) return fail('Could not set this alert. Reload the page and try again.');
      }
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail('Enter a real email address.', input);
      go.disabled = true; go.textContent = 'Sending…';
      status.textContent = ''; status.style.color = 'var(--text-muted)';
      [input, val, rowSel].forEach(function(f){ if(f) f.removeAttribute('aria-invalid'); });
      function retry(msg, field){ fail(msg, field); go.disabled = false; go.textContent = 'Watch — free'; }
      /* WAVE3-H: success only on an HTTP 2xx whose body says ok:true. A 404,
         a 5xx, an HTML error page or an empty body is a failure, and nothing
         is written to localStorage until the worker has said yes. */
      fetch(WATCH_WORKER + '/elevator-watch-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function(r){
        return r.json().catch(function(){ return null; }).then(function(data){ return { r: r, data: data }; });
      }, function(){ return null; })
        .then(function(res){
          if(!res) return retry('Could not reach the watch service. Try again in a minute.');
          var r = res.r, data = res.data;
          if(data && data.error === 'limit')
            return retry('This address already has 5 elevator alerts, the most one address can hold.', input);
          if(data && data.ok === false && data.error && r.status >= 400 && r.status < 500)
            return retry(/email/.test(String(data.error)) ? 'That email address was not accepted.' : 'That alert was not accepted.', /email/.test(String(data.error)) ? input : null);
          if(!r.ok || !data || data.ok !== true)
            return retry('The watch service did not confirm this' + (r.ok ? '' : ' (error ' + r.status + ')') + '. Nothing was saved. Try again in a minute.');
          if(wid) markWatched(wid);
          if(body.wid !== wid) markWatched(body.wid);
          var oi = wrap.querySelector('.we-optin');
          var S = window.AgsistSignup, wantDaily = !!(oi && oi.checked && S && !S.isSignedUp());
          wrap.innerHTML = '<span class="we-done" tabindex="-1" style="font-size:.875rem;color:var(--green)">Check your email to confirm. It arrives within about 15 minutes; nothing is sent until you confirm.</span>'
            + '<div class="sa-optmsg" role="status"></div>';
          wrap.classList.remove('we-open');
          var done = wrap.querySelector('.we-done'); if(done) done.focus();
          /* The daily signup goes only after the watch itself was accepted. */
          if(wantDaily) S.subscribe({ email: email, source: 'watch-optin' }).then(function(res){
            var m = wrap.querySelector('.sa-optmsg'); if(!m) return;
            m.className = 'sa-optmsg ' + (res.ok ? 'is-ok' : 'is-err');
            m.textContent = 'AGSIST Daily: ' + (res.ok ? S.okText() : S.errText(res));
          });
        });
    }
    if(go) go.addEventListener('click', submit);
    if(input) input.addEventListener('keydown', function(e){ if(e.key === 'Enter') submit(); });
  }
})();
