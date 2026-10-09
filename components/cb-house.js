/* components/cb-house.js -- the house ask in an UNSOLD sponsor slot, on
   /cash-bids and the cash-bid town pages (scripts/build_cash_bid_pages.py)
   only. A sold slot is never touched.

   /cash-bids   the page's own ribbon (aside.ag-sponsor-ribbon). Sold means
                data/page-sponsors.json carries the ribbon's slot from its
                start date: the rule components/loader.js fillPageRibbons()
                applies. loader.js may answer first (the ribbon then carries
                ag-sponsor-ribbon--sold) or after (it replaces the ribbon's
                contents, which works on this markup too: the slot link keeps
                ?slot=<id>, which is how loader.js finds the slot).
   town pages   they carry no ribbon; the slot is the footer's open slot
                (#adspace-row .ad-slot--open). Sold means data/supporters.json
                has an active supporter, the rule loader.js renderSupporters()
                applies. The house card keeps class ad-slot--open, so a
                supporter loader.js places later still replaces it.
   Any failure to read those files leaves the open slot exactly as it was.
   The ask points at the page's own email sign-up (data-signup-ask) and, on
   /cash-bids, at the Watch buttons on the cards. Both already exist; nothing
   new is collected here. */
(function(){
  'use strict';
  var CSS = '.ag-sponsor-ribbon--house:not(.ag-sponsor-ribbon--sold){background:var(--surface);box-shadow:none;border-color:var(--border);border-left-color:var(--gold);color:var(--text-dim,var(--text))}'
    + '.ag-sponsor-ribbon--house:not(.ag-sponsor-ribbon--sold) .cbh-copy{flex:1 1 16rem;min-width:0}'
    + '.ag-sponsor-ribbon--house:not(.ag-sponsor-ribbon--sold) .cbh-copy b{color:var(--text)}'
    + '.ag-sponsor-ribbon--house:not(.ag-sponsor-ribbon--sold) a.cbh-go{background:var(--gold-fill,var(--gold));color:#0a0c0d!important}'
    + '.ag-sponsor-ribbon--house:not(.ag-sponsor-ribbon--sold) a.cbh-sp,.cbh-slot a.cbh-sp{flex-basis:100%;margin:0;width:auto;justify-content:flex-start;min-height:40px;padding:0;background:none;border:0;color:var(--text-muted)!important;font-weight:400;font-size:.78rem;text-decoration:underline;box-shadow:none;transform:none}'
    + '.cbh-slot{border:1px solid var(--border)!important;border-left:4px solid var(--gold)!important;background:var(--surface)!important;box-shadow:none!important}'
    + '.cbh-slot .cbh-go{margin-left:auto;display:inline-flex;align-items:center;min-height:40px;padding:0 .9rem;border-radius:8px;background:var(--gold-fill,var(--gold));color:#0a0c0d;font-weight:800;font-size:.85rem;text-decoration:none;white-space:nowrap}'
    + '.cbh-slot .ad-slot-tag{color:var(--text-muted)!important;background:none!important;border:1px solid var(--border)!important}'
    + '.cbh-slot .ad-slot-tag::before{display:none!important}';
  function style(){
    if(document.getElementById('cbh-css')) return;
    var s = document.createElement('style'); s.id = 'cbh-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  function getJSON(url){
    return fetch(url, { cache:'no-cache' }).then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); });
  }
  function today(){
    try{ return new Intl.DateTimeFormat('en-CA', { timeZone:'America/Chicago' }).format(new Date()); }
    catch(e){ return new Date().toISOString().slice(0, 10); }
  }
  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function signupTarget(){
    var el = document.querySelector('[data-signup-ask]');
    if(!el) return '';
    if(!el.id) el.id = 'cbh-signup';
    return '#' + el.id;
  }
  function jump(e){
    var a = e.currentTarget, id = (a.getAttribute('href') || '').slice(1), el = id && document.getElementById(id);
    if(!el) return;
    e.preventDefault();
    try{ el.scrollIntoView({ behavior:'smooth', block:'center' }); }catch(err){ el.scrollIntoView(); }
    var f = el.querySelector('input[type="email"],input,button'); if(f){ try{ f.focus({ preventScroll:true }); }catch(err){ f.focus(); } }
  }

  /* ── /cash-bids: the page ribbon ──────────────────────────────────── */
  function ribbon(){
    var rib = document.querySelector('aside.ag-sponsor-ribbon');
    if(!rib || rib.classList.contains('ag-sponsor-ribbon--sold')) return;
    var a = rib.querySelector('a[href*="slot="]');
    var m = a && /[?&]slot=([a-z0-9-]+)/.exec(a.getAttribute('href') || '');
    if(!m) return;
    var id = m[1];
    getJSON('/data/page-sponsors.json').then(function(d){
      var sp = d && d.slots && d.slots[id];
      var sold = !!(sp && sp.active !== false && sp.company && /^https?:\/\//.test(sp.url || '') && /^\d{4}-\d{2}-\d{2}$/.test(sp.start || '') && sp.start <= today());
      if(sold || rib.classList.contains('ag-sponsor-ribbon--sold')) return;
      var to = signupTarget();
      style();
      rib.classList.add('ag-sponsor-ribbon--house');
      rib.setAttribute('aria-label', 'From AGSIST');
      rib.innerHTML = '<span class="cbh-copy"><b>Watch your elevators.</b> Tap Watch on any elevator and get an email when its price or basis moves, or get the best bids near you every weekday morning.</span>'
        + (to ? '<a class="cbh-go" href="' + to + '">Get bids by email</a>' : '')
        + '<a class="cbh-sp" href="/sponsor?slot=' + esc(id) + '">Sponsor this spot</a>';
      var go = rib.querySelector('.cbh-go'); if(go) go.addEventListener('click', jump);
    }).catch(function(){ /* the open ribbon stays */ });
  }

  /* ── town pages: the footer's open slot ───────────────────────────── */
  function footerSlot(){
    var ask = document.querySelector('[data-signup-ask]');
    if(!ask) return;
    var tries = 0;
    (function wait(){
      var slot = document.querySelector('#adspace-row .ad-slot--open');
      if(!slot){ if(++tries < 60) setTimeout(wait, 250); return; }
      getJSON('/data/supporters.json').then(function(d){
        var live = ((d && d.supporters) || []).filter(function(s){ return s && s.active === true; });
        if(live.length || !slot.parentNode || !slot.classList.contains('ad-slot--open')) return;
        var to = signupTarget();
        style();
        var box = document.createElement('div');
        box.className = 'ad-slot ad-slot--open ad-slot--lead cbh-slot';
        box.innerHTML = '<span class="ad-slot-tag">AGSIST</span>'
          + '<span class="ad-slot-pitch">' + esc(ask.getAttribute('data-signup-ask')) + '. Free.</span>'
          + '<a class="cbh-go" href="' + to + '">Sign up</a>'
          + '<a class="cbh-sp" href="/sponsor">Sponsor this spot</a>';
        slot.parentNode.replaceChild(box, slot);
        box.querySelector('.cbh-go').addEventListener('click', jump);
      }).catch(function(){ /* the open slot stays */ });
    })();
  }

  function run(){ if(document.querySelector('aside.ag-sponsor-ribbon')) ribbon(); else footerSlot(); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
