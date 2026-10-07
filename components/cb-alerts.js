/* components/cb-alerts.js -- price alerts on /cash-bids. Two things, both on
   the EXISTING elevator watch (workers/subs-worker.js, routes
   /elevator-watch-*), so the double opt-in, the 5-per-address cap, the
   confirm and unsubscribe links and the mailers are the ones already running:

   1. A bell on each elevator card. One tap opens a small form under the
      card's head: email, crop, and either "cash at or above $___" (kind
      cash) or "any change in their posted basis" (kind move, 1 cent). The
      rows offered are the ones scripts/send_elevator_watch.py reads: the bids
      repo's merged-index.json `now[crop]`, matched by the same FNV-1a hash
      (state|operator|city|crop). A card with no such row (a licensed-feed
      elevator) gets the v5.1 plain watch on its corn basis when
      data/basis/<ST>.json carries it, and otherwise says plainly that it
      cannot be watched yet.
   2. A ZIP-wide alert, "email me when anyone within N mi of <ZIP> pays $X
      for <crop>", stored as a kind=cash alert whose ewid is "ab" + ZIP +
      3-digit miles and mailed by scripts/send_zip_alert.py.

   The page hook is two calls (cash-bids.html):
     CBAlerts.bell(elev)        -> HTML for one button; elev needs facility,
                                   city, state (and town for the label).
     CBAlerts.zipPanel(zip, mi) -> draws/refreshes the ZIP alert above the cards.
   Everything else is event delegation on document, so a card rebuilt by any
   other code keeps working as long as it prints CBAlerts.bell(elev) inside
   an element with class "elev-card".

   Honest degradation: the worker is asked GET /elevator-watch-options first.
   If it does not answer that it knows kind "cash", the cash and ZIP options
   are not offered at all (only the plain corn-basis watch, where it exists).
   Success is shown only on HTTP 2xx with {ok:true}. */
(function(){
  'use strict';
  var WORKER = 'https://agsist-subs.dnilgis.workers.dev';
  var NET = 'https://dnilgis.github.io/bids/';
  var RADII = [10, 25, 50, 75, 100];
  var CROPS = ['corn', 'soybeans', 'wheat', 'sorghum', 'oats'];
  var NAMES = { corn:'Corn', soybeans:'Soybeans', wheat:'Wheat', sorghum:'Sorghum', oats:'Oats' };
  /* components/bids-homepage.js PPU_BAND, scripts/send_elevator_watch.py PPU_BAND */
  var BAND = { corn:[2,12], soybeans:[6,32], wheat:[3,20], sorghum:[2,7], oats:[1,8] };
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var MAX_AGE_H = 96;                       /* scripts/send_zip_alert.py MAX_AGE_H */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var BELL = '<svg class="cba-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  /* Byte-identical to scripts/send_elevator_watch.py wid_for() and
     components/bids-homepage.js widFor(): FNV-1a 32-bit over UTF-16 units. */
  function widFor(a, b, c, d){
    var s = [a, b, c, d].map(function(x){ return String(x || '').trim().toUpperCase(); }).join('|');
    var h = 0x811c9dc5;
    for(var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function ppu(raw){ return raw == null ? null : (raw > 30 ? raw / 100 : raw); }
  function basisCents(n){
    if(typeof n.basisCents === 'number' && isFinite(n.basisCents)) return Math.round(n.basisCents);
    if(typeof n.basis === 'number' && isFinite(n.basis)) return Math.round(Math.abs(n.basis) < 5 ? n.basis * 100 : n.basis);
    return null;
  }
  function periodLabel(p, delivery){
    var m = /^(\d{4})-(\d{2})(?:\/(\d{4})-(\d{2}))?/.exec(p || '');
    if(!m || !MON[+m[2] - 1]) return delivery || '';
    if(m[3] && (m[3] !== m[1] || m[4] !== m[2]) && MON[+m[4] - 1])
      return MON[+m[2] - 1] + (m[3] === m[1] ? '' : ' ' + m[1]) + '–' + MON[+m[4] - 1] + ' ' + m[3];
    return MON[+m[2] - 1] + ' ' + m[1];
  }
  function ctMonth(){ try{ return new Date().toLocaleDateString('en-CA', {timeZone:'America/Chicago'}).slice(0, 7); }catch(e){ return new Date().toISOString().slice(0, 7); } }
  function ctTime(iso){
    var d = new Date(iso); if(!iso || isNaN(d)) return '';
    try{
      return d.toLocaleDateString('en-US', {month:'short', day:'numeric', timeZone:'America/Chicago'}) + ', '
        + d.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit', timeZone:'America/Chicago'}) + ' CT';
    }catch(e){ return ''; }
  }
  function cash$(c){ return '$' + (c / 100).toFixed(2); }
  function miles(a, b){
    var R = 3958.7613, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function getJSON(url, ms){
    return Promise.race([
      fetch(url, {cache:'default'}).then(function(r){ return r.ok ? r.json() : null; }),
      new Promise(function(res){ setTimeout(function(){ res(null); }, ms || 6000); })
    ]).catch(function(){ return null; });
  }
  function store(k, v){ try{ if(v === undefined) return window.localStorage.getItem(k); window.localStorage.setItem(k, v); }catch(e){ return null; } }

  /* ── what the worker knows ─────────────────────────────────────────── */
  var optsP = null;
  function workerHasCash(){
    if(!optsP) optsP = getJSON(WORKER + '/elevator-watch-options', 3500).then(function(d){
      return !!(d && d.ok && d.kinds && d.kinds.indexOf('cash') >= 0 && d.kinds.indexOf('move') >= 0);
    });
    return optsP;
  }

  /* ── the rows the mailers read ─────────────────────────────────────── */
  var indexP = null;
  function netIndex(){
    if(!indexP) indexP = getJSON(NET + 'data/merged-index.json', 8000).then(function(data){
      if(!data || !Array.isArray(data.places)) return null;
      var idx = {}, month = ctMonth();
      data.places.forEach(function(p){
        if(!p || (p.currency || 'USD') !== 'USD') return;
        if(typeof p.lat !== 'number' || typeof p.lon !== 'number') return;
        CROPS.forEach(function(crop){
          var n = p.now && p.now[crop];
          if(!n || typeof n.cash !== 'number') return;
          var cash = ppu(n.cash);
          if(!(cash >= BAND[crop][0] && cash <= BAND[crop][1])) return;
          var period = String(n.period || ''), end = period.split('/').pop();
          if(/^\d{4}-\d{2}/.test(end) && end.slice(0, 7) < month) return;
          var w = widFor(p.state, p.operator, p.city, crop);
          var row = { place:p, crop:crop, period:period, plabel:periodLabel(period, n.delivery || ''),
                      cash:Math.round(cash * 100), basis:basisCents(n), pricedAt:p.pricedAt || '' };
          idx[w] = (w in idx) ? 'ambiguous' : row;
        });
      });
      return { idx: idx, data: data };
    });
    return indexP;
  }
  /* The v5.1 plain watch is confirmed only when data/basis/<ST>.json has
     the elevator's corn row (send_elevator_watch.py plan()). Ask it first. */
  var basisP = {};
  function basisHas(st, wid){
    st = String(st || '').toUpperCase();
    if(!/^[A-Z]{2}$/.test(st)) return Promise.resolve(false);
    if(!basisP[st]) basisP[st] = getJSON('/data/basis/' + st + '.json', 5000).then(function(d){
      var set = {};
      if(!d || !Array.isArray(d.r) || !Array.isArray(d.cols)) return set;
      var iF = d.cols.indexOf('facility'), iC = d.cols.indexOf('commodity');
      d.r.forEach(function(row){
        var key = (d.f || [])[row[iF]], com = (d.c || [])[row[iC]];
        if(typeof key !== 'string' || typeof com !== 'string') return;
        var k = key.split('|');
        set[widFor(d.state || st, k[0], k.slice(1).join('|'), com)] = 1;
      });
      return set;
    });
    return basisP[st].then(function(set){ return !!set[wid]; });
  }

  /* ── posting ───────────────────────────────────────────────────────── */
  function subscribe(body){
    return fetch(WORKER + '/elevator-watch-subscribe', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
    }).then(function(r){
      return r.json().catch(function(){ return null; }).then(function(d){ return { r:r, d:d }; });
    }, function(){ return null; }).then(function(res){
      if(!res) return { ok:false, msg:'Could not reach the alert service. Nothing was saved. Try again in a minute.' };
      var r = res.r, d = res.d;
      if(d && d.error === 'limit') return { ok:false, field:'email', msg:'This address already has 5 elevator alerts, the most one address can hold.' };
      if(d && d.ok === false && d.error && r.status >= 400 && r.status < 500)
        return /email/.test(String(d.error)) ? { ok:false, field:'email', msg:'That email address was not accepted.' }
          : { ok:false, msg:'That alert was not accepted (' + String(d.error).slice(0, 40) + '). Nothing was saved.' };
      if(!r.ok || !d || d.ok !== true)
        return { ok:false, msg:'The alert service did not confirm this' + (r.ok ? '' : ' (error ' + r.status + ')') + '. Nothing was saved. Try again in a minute.' };
      return { ok:true };
    });
  }
  var DONE = 'Check your email to confirm. It arrives within about 30 minutes; nothing is sent until you confirm.';
  function fieldsHTML(id, email){
    return '<div class="cba-row"><label class="cba-f cba-grow"><span class="cba-k">Email</span>'
      + '<input type="email" class="cba-email" autocomplete="email" inputmode="email" placeholder="you@example.com" value="' + esc(email || '') + '" aria-describedby="' + id + '-st"></label>'
      + '<button type="submit" class="cba-go">Set alert</button></div>'
      + '<div class="cba-status" id="' + id + '-st" role="status" tabindex="-1"></div>';
  }
  function fail(form, res){
    var st = form.querySelector('.cba-status'), em = form.querySelector('.cba-email');
    st.textContent = res.msg; st.className = 'cba-status is-err';
    if(res.field === 'email' && em){ em.setAttribute('aria-invalid', 'true'); em.focus(); } else st.focus();
    var go = form.querySelector('.cba-go'); if(go){ go.disabled = false; go.textContent = 'Set alert'; }
  }
  function badPrice(form, price){
    fail(form, { msg:'Enter a cash price between $1.00 and $32.00.' });
    price.setAttribute('aria-invalid', 'true'); price.focus();
  }
  function sending(form){
    var go = form.querySelector('.cba-go'); go.disabled = true; go.textContent = 'Sending…';
    var st = form.querySelector('.cba-status'); st.textContent = ''; st.className = 'cba-status';
    var em = form.querySelector('.cba-email'); if(em) em.removeAttribute('aria-invalid');
    var pr = form.querySelector('.cba-price'); if(pr) pr.removeAttribute('aria-invalid');
  }
  function done(box, email){
    store('cba_email', email);
    box.innerHTML = '<p class="cba-done" tabindex="-1">' + DONE + '</p>';
    var p = box.querySelector('.cba-done'); if(p) p.focus();
  }

  /* ── 1. the bell ───────────────────────────────────────────────────── */
  var seq = 0;
  function bell(elev){
    if(!elev || !elev.facility || !elev.state) return '';
    var town = elev.town || elev.city || '';
    var name = elev.facility + (town ? ', ' + town : '') + ', ' + elev.state;
    return '<button type="button" class="cba-bell" aria-expanded="false"'
      + ' data-st="' + esc(elev.state) + '" data-fac="' + esc(elev.facility) + '" data-city="' + esc(elev.city || '') + '"'
      + ' data-name="' + esc(name) + '" data-corn="' + ((elev.commodities && elev.commodities.corn && elev.commodities.corn.length) ? '1' : '') + '"'
      + ' aria-label="Price alert for ' + esc(name) + '" title="Email me about this elevator">' + BELL + '<span class="cba-bell-t">Alert</span></button>';
  }
  function openBell(btn){
    var card = btn.closest('.elev-card') || btn.parentNode;
    var box = card.querySelector('.cba-card');
    if(box){ var open = box.hidden; box.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false'); if(open){ var f = box.querySelector('input,select,button'); if(f) f.focus(); } return; }
    box = document.createElement('div');
    box.className = 'cba-card'; box.id = 'cba-' + (++seq);
    btn.setAttribute('aria-controls', box.id); btn.setAttribute('aria-expanded', 'true');
    var head = card.querySelector('.elev-head');
    if(head && head.parentNode === card) head.insertAdjacentElement('afterend', box); else card.appendChild(box);
    box.innerHTML = '<p class="cba-note">Checking what this elevator can alert on…</p>';
    var st = btn.getAttribute('data-st'), fac = btn.getAttribute('data-fac'), city = btn.getAttribute('data-city');
    var name = btn.getAttribute('data-name'), cornWid = widFor(st, fac, city, 'corn');
    Promise.all([netIndex(), workerHasCash(), btn.getAttribute('data-corn') ? basisHas(st, cornWid) : Promise.resolve(false)]).then(function(a){
      var idx = a[0] && a[0].idx, full = a[1], plain = a[2], rows = [];
      if(idx) CROPS.forEach(function(c){ var r = idx[widFor(st, fac, city, c)]; if(r && r !== 'ambiguous') rows.push(r); });
      /* Rows the worker cannot take yet are not offered; they only change what the note says. */
      drawCardForm(box, name, full ? rows : [], plain ? cornWid : '', rows.length > 0 && !full);
    });
  }
  function drawCardForm(box, name, rows, plainWid, direct){
    var id = box.id, email = store('cba_email');
    if(!rows.length && !plainWid && direct){
      box.innerHTML = '<p class="cba-note">Price alerts cannot be set right now: the alert service did not answer. Nothing was saved. Try again later.</p>';
      return;
    }
    if(!rows.length && !plainWid){
      box.innerHTML = '<p class="cba-note">Alerts on this card are not available yet. They work on elevators whose own boards AGSIST reads direct, and this one’s prices come from a licensed feed the alert emails cannot read. The ZIP alert above the cards covers every elevator AGSIST reads near you.</p>';
      return;
    }
    var h = '<form class="cba-form" novalidate><p class="cba-title">Email me about ' + esc(name) + '</p>';
    if(rows.length){
      h += '<div class="cba-row"><label class="cba-f"><span class="cba-k">Crop</span><select class="cba-crop">'
        + rows.map(function(r, i){ return '<option value="' + i + '">' + NAMES[r.crop] + ', ' + esc(r.plabel || 'delivery not named') + '</option>'; }).join('')
        + '</select></label></div>'
        + '<p class="cba-now" aria-live="polite"></p>'
        + '<fieldset class="cba-kind"><legend class="cba-k">Tell me when</legend>'
        + '<label class="cba-radio"><input type="radio" name="' + id + '-k" value="cash" checked> cash is at or above $'
        + '<input type="number" class="cba-price" inputmode="decimal" step="0.01" min="1" max="32" aria-label="Cash price, dollars a bushel"></label>'
        + '<label class="cba-radio"><input type="radio" name="' + id + '-k" value="move"> any change in their posted basis</label></fieldset>'
        + '<p class="cba-note cba-how"></p>';
    } else {
      h += '<p class="cba-now">You get an email when this elevator’s posted corn basis changes. '
        + (direct ? 'Cash-price alerts cannot be set right now.' : 'Cash-price alerts work only on elevators AGSIST reads direct.') + '</p>';
    }
    h += fieldsHTML(id, email) + '</form>';
    box.innerHTML = h;
    var form = box.querySelector('form'), crop = form.querySelector('.cba-crop'), price = form.querySelector('.cba-price');
    function sync(){
      if(!crop) return;
      var r = rows[+crop.value];
      form.querySelector('.cba-now').textContent = 'Now ' + cash$(r.cash) + (r.basis != null ? ', basis ' + (r.basis === 0 ? 'even' : (r.basis > 0 ? '+' : '−') + Math.abs(r.basis) + '¢') : '')
        + (ctTime(r.pricedAt) ? ', posted ' + ctTime(r.pricedAt) : '') + '.';
      price.placeholder = (r.cash / 100).toFixed(2);
      var k = form.querySelector('input[name="' + id + '-k"]:checked').value;
      form.querySelector('.cba-how').textContent = (k === 'cash'
        ? 'One email when a new posting is at or above your price, then the alert clears. If it is there already, the email comes with their next posting.'
        : 'An email each time a new posting changes this basis.')
        + ' If they stop posting ' + (r.plabel || 'this delivery') + ', you get one note and the alert ends.';
    }
    if(crop){ crop.addEventListener('change', sync);
      Array.prototype.forEach.call(form.querySelectorAll('input[type="radio"]'), function(x){ x.addEventListener('change', sync); });
      price.addEventListener('focus', function(){ var c = form.querySelector('input[value="cash"]'); if(c && !c.checked){ c.checked = true; sync(); } });
      sync(); }
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var em = form.querySelector('.cba-email'), email = (em.value || '').trim(), body;
      if(rows.length){
        var r = rows[+crop.value], kind = form.querySelector('input[name="' + id + '-k"]:checked').value;
        var lead = r.place.operator + ', ' + (r.place.town || r.place.city || '') + ', ' + r.place.state + ' — ' + r.crop + ' ' + r.plabel + ': ';
        body = { email:email, kind:kind, ewid:widFor(r.place.state, r.place.operator, r.place.city, r.crop), crop:r.crop, period:r.period, plabel:(r.plabel || r.period).slice(0, 40) };
        if(kind === 'cash'){
          var v = parseFloat(price.value);
          if(!(v >= 1 && v <= 32)) return badPrice(form, price);
          price.removeAttribute('aria-invalid');
          body.direction = 'above'; body.target_cents = Math.round(v * 100);
          body.label = (lead + 'cash at or above ' + cash$(body.target_cents)).slice(0, 120);
          body.wid = widFor(body.ewid, 'cash', r.period, 'above:' + body.target_cents);
        } else {
          body.move_cents = 1;
          body.label = (lead + 'any basis change').slice(0, 120);
          body.wid = widFor(body.ewid, 'move', r.period, ':1');
        }
      } else {
        body = { email:email, wid:plainWid, label:(name + ' — corn').slice(0, 120) };
      }
      if(!EMAIL_RE.test(email)) return fail(form, { field:'email', msg:'Enter a real email address.' });
      sending(form);
      subscribe(body).then(function(res){ if(res.ok) done(box, email); else fail(form, res); });
    });
  }
  document.addEventListener('click', function(e){
    var b = e.target && e.target.closest && e.target.closest('.cba-bell');
    if(b){ e.preventDefault(); e.stopPropagation(); openBell(b); }
  });

  /* ── 2. the ZIP-wide alert ─────────────────────────────────────────── */
  function zipCoord(zip){
    return getJSON(NET + 'data/zips/' + zip.slice(0, 2) + '.json', 5000).then(function(t){
      var p = t && t[zip];
      if(!Array.isArray(p) || p.length < 2) return null;
      var lat = Number(p[0]), lon = Number(p[1]);
      return (isFinite(lat) && isFinite(lon) && !(lat === 0 && lon === 0)) ? [lat, lon] : null;
    });
  }
  /* The same places scripts/send_zip_alert.py counts, highest cash first. */
  function zipRows(net, coord, crop, radius){
    var out = [], month = ctMonth(), now = Date.now();
    if(!net || !coord) return out;
    net.data.places.forEach(function(p){
      if(!p || String(p.via || '').toLowerCase() === 'barchart' || (p.currency || 'USD') !== 'USD' || p.mappable === false) return;
      if(typeof p.lat !== 'number' || typeof p.lon !== 'number' || (p.lat === 0 && p.lon === 0)) return;
      var n = p.now && p.now[crop]; if(!n || typeof n.cash !== 'number') return;
      var cash = ppu(n.cash); if(!(cash >= BAND[crop][0] && cash <= BAND[crop][1])) return;
      var end = String(n.period || '').split('/').pop(); if(/^\d{4}-\d{2}/.test(end) && end.slice(0, 7) < month) return;
      var t = Date.parse(p.pricedAt); if(isNaN(t) || now - t > MAX_AGE_H * 3600e3) return;
      var d = miles(coord, [p.lat, p.lon]); if(d > radius) return;
      out.push({ name:p.operator, town:p.town || p.city || '', st:p.state, cash:Math.round(cash * 100), mi:d });
    });
    out.sort(function(a, b){ return b.cash - a.cash || a.mi - b.mi; });
    return out;
  }
  var zipState = { zip:'', radius:25 };
  function zipPanel(zip, radius){
    zip = String(zip || '').replace(/\D/g, '').slice(0, 5);
    var results = document.getElementById('cb-results');
    var box = document.getElementById('cba-zip');
    if(!/^\d{5}$/.test(zip) || !results) { if(box) box.hidden = true; return; }
    if(!box){
      box = document.createElement('section');
      box.id = 'cba-zip'; box.className = 'cba-zip'; box.setAttribute('aria-label', 'ZIP price alert');
      results.parentNode.insertBefore(box, results);
    }
    box.hidden = false;
    var r = +radius; zipState.zip = zip;
    zipState.radius = RADII.indexOf(r) >= 0 ? r : (r > 100 ? 100 : (r > 50 ? 50 : 25));
    var crop0 = '';
    try{ var act = document.querySelector('.cb-filt.active'); crop0 = act ? act.getAttribute('data-filter') : ''; }catch(e){}
    if(CROPS.indexOf(crop0) < 0) crop0 = 'corn';
    var id = 'cba-zip-f';
    box.innerHTML = '<details class="cba-zd"><summary class="cba-zs">' + BELL + ' Email me when anyone near ' + zip + ' pays my price</summary>'
      + '<form class="cba-form" novalidate><p class="cba-title">Email me when anyone within '
      + '<select class="cba-r" aria-label="Miles">' + RADII.map(function(x){ return '<option value="' + x + '"' + (x === zipState.radius ? ' selected' : '') + '>' + x + ' mi</option>'; }).join('') + '</select>'
      + ' of ZIP ' + zip + ' pays $<input type="number" class="cba-price" inputmode="decimal" step="0.01" min="1" max="32" aria-label="Cash price, dollars a bushel"> for '
      + '<select class="cba-zcrop" aria-label="Crop">' + CROPS.map(function(c){ return '<option value="' + c + '"' + (c === crop0 ? ' selected' : '') + '>' + NAMES[c].toLowerCase() + '</option>'; }).join('') + '</select></p>'
      + '<p class="cba-now" aria-live="polite">Checking the boards…</p>'
      + fieldsHTML(id, store('cba_email'))
      + '<p class="cba-note">Nearest delivery on boards AGSIST reads direct from the elevator, not every elevator in the area. One email when one crosses your price, then none until all are back below it and one crosses again. Miles are straight-line from the ZIP’s center.</p>'
      + '</form></details>';
    var form = box.querySelector('form'), rSel = form.querySelector('.cba-r'), cSel = form.querySelector('.cba-zcrop');
    var price = form.querySelector('.cba-price'), nowEl = form.querySelector('.cba-now');
    var ctx = { net:null, coord:null, ok:null };
    function sync(){
      if(!ctx.net || !ctx.coord){ nowEl.textContent = ctx.ok == null ? 'Checking the boards…' : 'The boards could not be read just now, so the highest bid in range is not shown. The alert still works.'; return; }
      var rows = zipRows(ctx.net, ctx.coord, cSel.value, +rSel.value), v = parseFloat(price.value);
      if(!rows.length){ nowEl.textContent = 'No board AGSIST reads direct posts ' + cSel.value + ' within ' + rSel.value + ' mi right now. The alert waits until one does.'; price.placeholder = ''; return; }
      var t = rows[0];
      price.placeholder = (t.cash / 100).toFixed(2);
      var s = 'Highest now: ' + cash$(t.cash) + ' at ' + t.name + ', ' + t.town + ' (' + Math.round(t.mi) + ' mi). ' + rows.length + ' board' + (rows.length === 1 ? '' : 's') + ' in range.';
      if(v >= 1 && Math.round(v * 100) <= t.cash) s += ' That price is already paid: you will get one email soon after you confirm.';
      nowEl.textContent = s;
    }
    [rSel, cSel].forEach(function(el){ el.addEventListener('change', sync); });
    price.addEventListener('input', sync);
    Promise.all([workerHasCash(), netIndex(), zipCoord(zip)]).then(function(a){
      if(zipState.zip !== zip) return;
      ctx.ok = a[0]; ctx.net = a[1]; ctx.coord = a[2];
      if(!ctx.ok){ form.innerHTML = '<p class="cba-note">ZIP alerts cannot be set right now: the alert service did not answer. Nothing was saved. Try again later.</p>'; return; }
      sync();
    });
    form.addEventListener('submit', function(e){
      e.preventDefault();
      if(ctx.ok === false) return;
      var email = (form.querySelector('.cba-email').value || '').trim(), v = parseFloat(price.value);
      var mi = +rSel.value, crop = cSel.value;
      if(!(v >= 1 && v <= 32)) return badPrice(form, price);
      price.removeAttribute('aria-invalid');
      if(!EMAIL_RE.test(email)) return fail(form, { field:'email', msg:'Enter a real email address.' });
      var cents = Math.round(v * 100), ewid = 'ab' + zip + ('00' + mi).slice(-3);
      var body = { email:email, kind:'cash', ewid:ewid, crop:crop, period:'nearby', plabel:'nearest delivery',
        direction:'above', target_cents:cents,
        label:(NAMES[crop] + ' at or above ' + cash$(cents) + ' within ' + mi + ' mi of ZIP ' + zip).slice(0, 120),
        wid:widFor(ewid, 'cash', 'nearby', 'above:' + cents) };
      sending(form);
      subscribe(body).then(function(res){ if(res.ok) done(form, email); else fail(form, res); });
    });
  }

  window.CBAlerts = { bell:bell, zipPanel:zipPanel, _widFor:widFor };
})();
