/**
 * AGSIST homepage extras — added 2026-09-30.
 * Four real, wired features that were prototyped as a design-canvas mockup
 * and are now live here, reading real site data instead of illustrative
 * placeholders:
 *   1. Store-or-sell calculator, anchored to the real cash bid the ZIP
 *      lookup returns (window.AGSIST_STATE.bids / the `agsist:bids` event
 *      components/bids-homepage.js already dispatches).
 *   2. "vs. nearby elevators" basis comparison, computed from the same
 *      bid pool bids-homepage.js already fetched — no new request, no
 *      invented county-average number.
 *   3. "Since your last visit" — real this time. This is the live site, not
 *      the sandboxed design-canvas artifact, so localStorage actually
 *      persists between visits. Stores a snapshot of the day's basis
 *      headline (from data/daily.json, already fetched elsewhere on this
 *      page) and diffs it against the next visit's snapshot.
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

  function calcStoreOrSell(){
    var priceEl = $('idx1-calc-price'), costEl = $('idx1-calc-cost'),
        monthsEl = $('idx1-calc-months'), carryEl = $('idx1-calc-carry'),
        resultEl = $('idx1-calc-result');
    if(!priceEl || !costEl || !monthsEl || !carryEl || !resultEl) return;
    var priceRaw = priceEl.value, costRaw = costEl.value, monthsRaw = monthsEl.value, carryRaw = carryEl.value;
    if(priceRaw === '' || costRaw === '' || monthsRaw === '' || carryRaw === ''){
      resultEl.style.color = 'var(--text-dim)';
      resultEl.textContent = 'Enter your numbers above.';
      return;
    }
    var price = parseFloat(priceRaw), cost = parseFloat(costRaw), months = parseFloat(monthsRaw), carry = parseFloat(carryRaw);
    if(!isFinite(price) || !isFinite(cost) || !isFinite(months) || !isFinite(carry)){
      resultEl.style.color = 'var(--red,#ef4444)';
      resultEl.textContent = 'That number is out of range — try a realistic $/bu or month value.';
      return;
    }
    if(price < 0 || cost < 0 || months < 0 || carry < 0){
      resultEl.style.color = 'var(--red,#ef4444)';
      resultEl.textContent = 'Price, storage cost, months, and carry can’t be negative.';
      return;
    }
    var totalCost = cost * months, net = carry - totalCost;
    if(net > 0.001){
      resultEl.style.color = 'var(--green)';
      resultEl.textContent = 'Storing pencils out by +$' + net.toFixed(2) + '/bu over selling at $' + price.toFixed(2) + ' now, if your carry estimate holds.';
    } else if(net < -0.001){
      resultEl.style.color = 'var(--red,#ef4444)';
      resultEl.textContent = 'Storing costs $' + Math.abs(net).toFixed(2) + '/bu more than selling at $' + price.toFixed(2) + ' now, at these numbers.';
    } else {
      resultEl.style.color = 'var(--text)';
      resultEl.textContent = 'Breakeven — storing and selling now cost the same at these numbers.';
    }
  }
  var calcDebounce = null;
  function calcStoreOrSellDebounced(){
    clearTimeout(calcDebounce);
    calcDebounce = setTimeout(calcStoreOrSell, 400);
  }
  ['idx1-calc-price', 'idx1-calc-cost', 'idx1-calc-months', 'idx1-calc-carry'].forEach(function(id){
    var el = $(id);
    if(el) el.addEventListener('input', calcStoreOrSellDebounced);
  });

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

    /* Both comparison lines require at least 2 OTHER bids before showing a
       "better/worse" verdict -- "the average of 1 other bid" is just one
       other price dressed up as an average, and gave the same confident
       wording as a real average of 10. Below that floor, withhold the line
       rather than show a misleadingly small-sample claim (caught by the
       adversarial audit panel run on this feature before shipping). */
    var MIN_COMPARE_N = 2;

    var cmp = $('idx1-search-compare');
    if(cmp){
      if(sum.avgBasis != null && sum.avgBasisCount >= MIN_COMPARE_N && sum.basis != null){
        var diff = sum.basis - sum.avgBasis;
        var cents = Math.abs(Math.round(diff * 100));
        var verb = diff > 0.005 ? 'better' : diff < -0.005 ? 'worse' : 'even with';
        var clause = (diff > 0.005 || diff < -0.005) ? (cents + '¢/bu ' + verb + ' than') : verb;
        cmp.innerHTML = '<strong>This search, any distance:</strong> basis is <strong style="color:' + (diff > 0.005 ? 'var(--green)' : diff < -0.005 ? 'var(--red,#ef4444)' : 'var(--text-dim)') + '">' + clause + '</strong> the average of ' + sum.avgBasisCount + ' other corn bid' + (sum.avgBasisCount === 1 ? '' : 's') + ' found.';
        cmp.style.display = 'block';
      } else {
        cmp.style.display = 'none';
      }
    }
    var ccmp = $('idx1-distance-compare');
    if(ccmp){
      if(sum.nearbyRadiusMiles && sum.avgBasisNearbyCount >= MIN_COMPARE_N && sum.avgBasisNearby != null && sum.basis != null){
        var cdiff = sum.basis - sum.avgBasisNearby;
        var ccents = Math.abs(Math.round(cdiff * 100));
        var cverb = cdiff > 0.005 ? 'better' : cdiff < -0.005 ? 'worse' : 'even with';
        var cclause = (cdiff > 0.005 || cdiff < -0.005) ? (ccents + '¢/bu ' + cverb + ' than') : cverb;
        ccmp.innerHTML = '<strong>Within ' + sum.nearbyRadiusMiles + ' mi, straight-line:</strong> basis is <strong style="color:' + (cdiff > 0.005 ? 'var(--green)' : cdiff < -0.005 ? 'var(--red,#ef4444)' : 'var(--text-dim)') + '">' + cclause + '</strong> the average of ' + sum.avgBasisNearbyCount + ' other bid' + (sum.avgBasisNearbyCount === 1 ? '' : 's') + ' in that fixed ring, not road miles.';
        ccmp.style.display = 'block';
      } else {
        ccmp.style.display = 'none';
      }
    }
    renderBasisChart(sum);
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
    var cityState = String(sum.city || '');
    var m = /^(.*?),\s*([A-Z]{2})$/.exec(cityState.trim());
    if(!m){ card.style.display = 'none'; return; }
    var cityName = m[1], state = m[2];
    var facilityName = String(sum.where || '').split('·')[0].trim();
    if(!facilityName){ card.style.display = 'none'; return; }
    var wantFac = normKey(facilityName), wantCity = normKey(cityName);

    fetchSparklines(state).then(function(data){
      if(!data || !data.series){ card.style.display = 'none'; return; }
      var best = null, bestLen = 0;
      Object.keys(data.series).forEach(function(key){
        var parts = key.split('|');
        if(parts.length < 6) return;
        var fac = parts[1], city = parts[2], commodity = parts[3];
        if(commodity !== 'corn') return;
        if(normKey(fac) !== wantFac || normKey(city) !== wantCity) return;
        var pts = data.series[key];
        if(pts.length > bestLen){ best = pts; bestLen = pts.length; }
      });
      if(!best || best.length < 2){ card.style.display = 'none'; return; }

      var pts = best.slice(-20); // most recent real change-points only
      var cents = pts.map(function(p){ return p.cents; });
      var lo = Math.min.apply(null, cents), hi = Math.max.apply(null, cents);
      if(lo === hi){ lo -= 1; hi += 1; }
      var w = 300, h = 70, pad = 4;
      var xs = pts.map(function(_, i){ return pts.length === 1 ? w / 2 : pad + i * (w - 2 * pad) / (pts.length - 1); });
      var ys = cents.map(function(c){ return h - pad - (c - lo) * (h - 2 * pad) / (hi - lo); });
      var zeroY = (lo <= 0 && hi >= 0) ? (h - pad - (0 - lo) * (h - 2 * pad) / (hi - lo)) : null;
      var poly = xs.map(function(x, i){ return x.toFixed(1) + ',' + ys[i].toFixed(1); }).join(' ');
      var last = cents[cents.length - 1];
      var lineColor = last >= 0 ? 'var(--green)' : 'var(--red,#ef4444)';

      var svgHtml = '';
      if(zeroY != null){
        svgHtml += '<line x1="0" y1="' + zeroY.toFixed(1) + '" x2="' + w + '" y2="' + zeroY.toFixed(1) + '" stroke="var(--border)" stroke-width="1" stroke-dasharray="2,2"/>';
      }
      svgHtml += '<polyline points="' + poly + '" fill="none" stroke="' + lineColor + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      svg.innerHTML = svgHtml;
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Basis at this elevator ranged from ' + lo + ' to ' + hi + ' cents over the last ' + pts.length + ' logged changes, most recently ' + last + ' cents.');

      var firstDate = pts[0].date;
      fine.textContent = pts.length + ' real basis change' + (pts.length === 1 ? '' : 's') + ' logged at this elevator since ' + firstDate + '. Corn only; the delivery month here may not match the month quoted above.';
      card.style.display = 'block';
    });
  }

  // ── 3: since your last visit ────────────────────────────────────────
  // Real persistence this time (the live site has localStorage; the earlier
  // design-canvas artifact this was prototyped in does not). Stores just
  // enough to say something true next time, nothing that looks like an
  // invented number if the fetch fails.
  var LAST_VISIT_KEY = 'agsist_last_visit_snapshot_v1';
  function loadDailyForSnapshot(){
    fetch('/data/daily.json', { cache: 'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(data){
        if(!data) return;
        var basisHeadline = (data.basis && data.basis.headline) || null;
        var todayKey = data.date || null;
        var el = $('idx1-last-visit');
        var raw = null;
        try { raw = window.localStorage.getItem(LAST_VISIT_KEY); } catch(e){ /* private mode etc — degrade silently */ }
        var prev = null;
        if(raw){ try { prev = JSON.parse(raw); } catch(e){ prev = null; } }

        if(prev && prev.date && todayKey && prev.date !== todayKey && el){
          var parts = [];
          if(prev.basisHeadline && basisHeadline && prev.basisHeadline !== basisHeadline){
            parts.push('basis: ' + basisHeadline);
          }
          if(parts.length){
            el.innerHTML = '<svg class="ic" aria-hidden="true" style="flex:none"><use href="#i-calendar"/></svg> Since your last visit (' + prev.date + '): ' + parts.join(', ') + '.';
            el.style.display = 'flex';
          }
        }

        if(todayKey){
          try {
            window.localStorage.setItem(LAST_VISIT_KEY, JSON.stringify({ date: todayKey, basisHeadline: basisHeadline }));
          } catch(e){ /* storage full/blocked — nothing to show next time, not an error to surface */ }
        }
      })
      .catch(function(){ /* data/daily.json unreachable — recap line just stays hidden */ });
  }
  loadDailyForSnapshot();

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
