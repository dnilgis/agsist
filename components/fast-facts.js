/* components/fast-facts.js -- the page script for /fast-facts (tabs, live prices,
   calculators). Moved out of fast-facts.html on 2026-10-14 so the page is lighter
   and the browser caches this once. The manure calculator is in
   components/manure-value.js, shared with /manure-value. */
(function(){
'use strict';

/* ─── TAB SYSTEM ─────────────────────────────────────────────────────── */
var tabs=document.querySelectorAll('.ff-tab');
var panels=document.querySelectorAll('.ff-panel');
function ffEvent(name,params){try{if(window.gtag)gtag('event',name,params||{});}catch(e){}}
function switchTab(tab){
  if(!tab)return;
  var t=tab.dataset.tab;
  tabs.forEach(function(b){var on=b.dataset.tab===t;b.classList.toggle('active',on);b.setAttribute('aria-selected',on?'true':'false');b.tabIndex=on?0:-1;});
  panels.forEach(function(p){var a=p.id==='tab-'+t;p.classList.toggle('active',a);if(a)p.removeAttribute('aria-hidden');else p.setAttribute('aria-hidden','true');});
  if(t==='stages')initStages();
  if(t==='statestats')initStateStats();
  ffEvent('tab_view',{section:t});
}
tabs.forEach(function(b){b.addEventListener('click',function(){switchTab(b);if(history&&history.replaceState){try{history.replaceState(null,'','#'+b.dataset.tab);}catch(e){}}
  // tabs are sticky now — jump the reader to the top of the fresh panel so a deep
  // scroll position from the last tab doesn't strand them mid-table
  var p=document.getElementById('tab-'+b.dataset.tab);
  if(p){var y=p.getBoundingClientRect().top+window.pageYOffset-70;if(Math.abs(window.pageYOffset-y)>40)window.scrollTo({top:Math.max(0,y),behavior:'smooth'});}
});});
document.addEventListener('keydown',function(e){
  if(!e.target.classList||!e.target.classList.contains('ff-tab'))return;
  var arr=Array.prototype.slice.call(tabs);var i=arr.indexOf(e.target);var n=null;
  if(e.key==='ArrowRight')n=arr[(i+1)%arr.length];
  else if(e.key==='ArrowLeft')n=arr[(i-1+arr.length)%arr.length];
  else if(e.key==='Home')n=arr[0];
  else if(e.key==='End')n=arr[arr.length-1];
  if(n){e.preventDefault();n.focus();}
});
/* calculator usage tracking — panel-level, once per session */
var _ffCalcFired={};
function _ffTrackCalc(e){var el=e.target;if(!el||!el.closest)return;var panel=el.closest('.ff-panel');if(!panel||!panel.id||_ffCalcFired[panel.id])return;_ffCalcFired[panel.id]=1;ffEvent('calc_use',{calculator:panel.id.replace('tab-','')});}
document.addEventListener('input',_ffTrackCalc,true);
document.addEventListener('change',_ffTrackCalc,true);
/* deep-link: open tab from URL hash on load (deferred so all init fns are defined) */
/* Each tab has its own address: /fast-facts#manure, #nitrogen, #pk ... A link
   to one opens that tab and brings it into view, on load and when the hash
   changes on the page (the contents list at the top uses plain #links). */
function tabFromHash(scroll){
  var h=(location.hash||'').replace('#','');
  var b=h&&document.getElementById('tab-btn-'+h);
  if(!b)return false;
  switchTab(b);
  if(scroll){var nav=document.querySelector('.ff-tabs');if(nav){var y=nav.getBoundingClientRect().top+window.pageYOffset-8;window.scrollTo(0,Math.max(0,y));}}
  return true;
}
window.addEventListener('hashchange',function(){tabFromHash(true);});
setTimeout(function(){if(!tabFromHash(true)){switchTab(document.querySelector('.ff-tab.active')||tabs[0]);}},0);

/* ─── FERTILIZER PRICES ─────────────────────────────────────────────── */
var PRICES={};
/* data/fertilizer-prices.json (scripts/build_fert_prices.py): each product's
   middle cash price posted by the co-ops Sig sent, nothing else. Every row
   names its co-ops, region and date, and every
   $/lb shown here says how it was worked out. Lime and K-Mag have no live
   source, so they are not priced here (the lime calculator takes your $/ton). */
/* Short source with its region: "Kansas co-ops, Oct 6" / "USDA Illinois, Oct 2". */
function fertShort(p){
  if(p&&p.short_label)return p.short_label;
  var d=p&&p.as_of?new Date(p.as_of+'T12:00:00'):null;
  var when=d&&!isNaN(d)?d.toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
  return (p&&p.src==='coop'?(p.region?p.region+' co-ops':'co-ops'):'USDA Illinois')+(when?', '+when:'');
}
function fertGrade(sym){if(!sym)return null;var a=String(sym).trim().split('-');if(a.length<3)return null;var n=parseFloat(a[0]),pp=parseFloat(a[1]),k=parseFloat(a[2]);if(isNaN(n)||isNaN(pp)||isNaN(k))return null;return {N:n,P:pp,K:k};}
function loadFertPrices(){
  fetch('/data/fertilizer-prices.json').then(function(r){return r.ok?r.json():null;}).then(function(data){
    if(!data||!data.prices)return;
    function key(k){return data.prices.find(function(p){return p.key===k&&p.price>0;})||null;}
    var el=document.getElementById('fert-date');
    if(el&&data.updated){var d=new Date(data.updated+'T12:00:00');el.textContent='Posted through '+d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+'. Co-op posted cash prices, each named with its region. Call to confirm.';
      if((Date.now()-d.getTime())/864e5>30){el.style.color='var(--gold)';}}
    var urea=key('urea'), potash=key('potash'), ams=key('ams'), phos=key('map')||key('dap');
    var wrap=document.getElementById('fert-pills');
    if(!wrap)return;
    wrap.innerHTML='';
    var pillDefs=[
      {obj:urea,   nut:'N', ncPct:'46', label:'N'},
      {obj:ams,    nut:'N', ncPct:'21', label:'N'},
      {obj:key('anhydrous'), nut:'N', ncPct:'82', label:'N'},
      {obj:key('uan28'), nut:'N', ncPct:'28', label:'N'},
      {obj:key('uan32'), nut:'N', ncPct:'32', label:'N'},
      {obj:phos,   nut:'P', ncPct:'', label:'P2O5'},
      {obj:potash, nut:'K', ncPct:'', label:'K2O'}
    ];
    var deriv=[];
    pillDefs.forEach(function(pd){
      if(!pd.obj)return;
      var p=pd.obj, g=fertGrade(p.symbol); if(!g||!(g[pd.nut]>0))return;
      var pct=g[pd.nut]/100, pplb=(p.price/2000/pct);
      var price=Math.round(p.price);
      deriv.push(p.name+' $'+price+' / (2,000 lb x '+g[pd.nut]+'% '+pd.label+') = $'+pplb.toFixed(2)+' a lb of '+pd.label+' ('+p.src_label+').');
      var btn=document.createElement('button');
      btn.className='fert-pill';
      btn.setAttribute('type','button');
      btn.setAttribute('aria-pressed','false');
      btn.setAttribute('aria-label',p.name+' $'+price+'/ton, '+p.src_label+': $'+pplb.toFixed(3)+'/lb '+pd.label);
      btn.innerHTML='<span class="fert-pill-icon"><svg class="ic" aria-hidden="true"><use href="#i-wheat"/></svg></span>'
        +'<span class="fert-pill-body"><span class="fert-pill-name">'+p.name+'</span>'
        +'<span class="fert-pill-sym">'+p.symbol+' · '+fertShort(p)+'</span></span>'
        +'<span class="fert-pill-price">$'+price+'</span>';
      btn.addEventListener('click',function(){
        document.querySelectorAll('.fert-pill').forEach(function(x){x.classList.remove('active');x.setAttribute('aria-pressed','false');});
        btn.classList.add('active');btn.setAttribute('aria-pressed','true');
        if(pd.nut==='N'&&pd.ncPct){
          var fertSel=document.getElementById('nc-fert');
          if(fertSel){for(var i=0;i<fertSel.options.length;i++){if(fertSel.options[i].value===pd.ncPct){fertSel.value=pd.ncPct;break;}}}
          var fpEl=document.getElementById('nc-fertprice');if(fpEl)fpEl.value=price;
          calcNC();
        }
      });
      wrap.appendChild(btn);
    });
    var dv=document.getElementById('fert-deriv');
    if(!dv){dv=document.createElement('ul');dv.id='fert-deriv';dv.className='fert-deriv';wrap.parentNode.insertBefore(dv,wrap.nextSibling);}
    dv.innerHTML=deriv.map(function(x){return '<li>'+x.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</li>';}).join('');
    // Auto-fill N:Corn ratio from urea (primary N source)
    if(urea){
      var pplbU=urea.price/2000/0.46;
      var fpEl=document.getElementById('nc-fertprice');if(fpEl)fpEl.value=Math.round(urea.price);
      var fertSel=document.getElementById('nc-fert');
      if(fertSel){for(var i=0;i<fertSel.options.length;i++){if(fertSel.options[i].value==='46'){fertSel.value='46';break;}}}
      loadNFertPrice(pplbU,'Urea 46% ('+fertShort(urea)+')',Math.round(urea.price));
      calcNC();// the box changed under the calculator; redraw with the posted price
    }
    // P2O5 from MAP or DAP with its N credited at the urea price
    // (components/manure-value.js, the one copy of this math, shared with /manure-value).
    if(phos){
      var mvP=window.AgManure?window.AgManure.nutrientPrices(data).p:null;
      var gp=fertGrade(phos.symbol);
      var dpplb=mvP!=null?mvP:phos.price/2000/(gp.P/100);
      var ep=document.getElementById('eco-p-pplb');if(ep)ep.value=dpplb.toFixed(2);
      var dp=document.getElementById('eco-dap-price');if(dp)dp.textContent='$'+Math.round(phos.price)+' '+phos.name+' ('+fertShort(phos)+')';
      PRICES['DAP_PPLB']=dpplb;
      updateEcoCosts();
    }
    if(potash){
      var gk=fertGrade(potash.symbol);
      var kpplb=potash.price/2000/(gk.K/100);
      var ek=document.getElementById('eco-k-pplb');if(ek)ek.value=kpplb.toFixed(2);
      var mp=document.getElementById('eco-mop-price');if(mp)mp.textContent='$'+Math.round(potash.price)+' ('+fertShort(potash)+')';
      PRICES['MOP_PPLB']=kpplb;
      updateEcoCosts();
    }
  }).catch(function(){});
}
function loadNFertPrice(pplb,name,ton){
  var el=document.getElementById('nc-n-pplb-display');
  var lbl=document.getElementById('eco-n-source-label');if(lbl)lbl.textContent=name;
  var enil=document.getElementById('eco-n-pplb');if(enil)enil.value=pplb.toFixed(2);
  PRICES['N_PPLB']=pplb;
  var eup=document.getElementById('eco-urea-price');if(eup)eup.textContent='$'+ton;
  updateEcoCosts();
}
loadFertPrices();

/* ─── LOAD GRAIN PRICES ─────────────────────────────────────────────── */
function loadGrainPrices(){
  fetch('/data/prices.json').then(function(r){return r.ok?r.json():null;}).then(function(data){
    if(!data||!data.quotes)return;
    var q=data.quotes;
    function fmtGrain(v){return v!=null?AG.px.price(v):'--';}   /* components/util.js */
    var ecp=document.getElementById('eco-corn-price');var ncb=document.getElementById('nc-corn');
    if(q.corn&&q.corn.close){
      if(ecp)ecp.textContent=fmtGrain(q.corn.close);
      if(ncb){ncb.value=(parseFloat(q.corn.close)/100).toFixed(2);calcNC();}
      var lb=document.getElementById('nc-live-badge');if(lb)lb.style.display='inline-flex';
      var elb=document.getElementById('eco-live-badge');if(elb)elb.style.display='inline-flex';
    }
    var ebp=document.getElementById('eco-bean-price');if(q.beans&&q.beans.close&&ebp)ebp.textContent=fmtGrain(q.beans.close); /* key is 'beans' in prices.json — 'soybeans' never existed, tile sat at "-" (fixed 2026-07-20) */
    var ewp=document.getElementById('eco-wheat-price');if(q.wheat&&q.wheat.close&&ewp)ewp.textContent=fmtGrain(q.wheat.close);
    updateEcoCosts();
  }).catch(function(){});
}
loadGrainPrices();

/* ─── TODAY'S CALL + PRICE STRIP + WEEK CARD (2026-07-20) ───────────────
   Verdict-first opener. Same math as the N:corn calculator below (MRTN columns),
   computed from the same two feeds. If either feed fails, the blocks stay hidden —
   an honest blank beats a fake number. */
(function(){
  function isoWeekNow(){
    var d=new Date(), t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
    t.setUTCDate(t.getUTCDate()+4-(t.getUTCDay()||7));
    var y0=new Date(Date.UTC(t.getUTCFullYear(),0,1));
    return Math.ceil(((t-y0)/864e5+1)/7);
  }
  Promise.all([
    fetch('/data/prices.json').then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}),
    fetch('/data/fertilizer-prices.json').then(function(r){return r.ok?r.json():null;}).catch(function(){return null;})
  ]).then(function(res){
    var pj=res[0], fj=res[1];
    var q=pj&&pj.quotes?pj.quotes:{};
    function g(id){return document.getElementById(id);}
    function dollarsBu(v){return v!=null?'$'+(parseFloat(v)/100).toFixed(2):null;}
    var corn=q.corn&&q.corn.close?parseFloat(q.corn.close)/100:null;
    var beans=q.beans&&q.beans.close?dollarsBu(q.beans.close):null;
    var wheat=q.wheat&&q.wheat.close?dollarsBu(q.wheat.close):null;
    var urea=null, uRow=null, fertStale=false;
    if(fj&&fj.prices){
      uRow=fj.prices.find(function(p){return p.key==='urea'&&p.price>0;})||null;
      if(uRow){
        urea=Math.round(uRow.price);
        var fd=new Date(uRow.as_of+'T12:00:00');
        fertStale=!isNaN(fd)&&(Date.now()-fd.getTime())/864e5>30;
      }
    }
    // price strip — show it if we got ANY of the four
    if(corn||beans||wheat||urea){
      if(corn) g('fft-corn').textContent='$'+corn.toFixed(2);
      if(beans) g('fft-beans').textContent=beans;
      if(wheat) g('fft-wheat').textContent=wheat;
      if(urea){ g('fft-urea').textContent='$'+urea; var un=g('fft-urea-n'); un.textContent=fertShort(uRow)+(fertStale?', aging':''); if(fertStale) un.className='n warn'; }
      g('ff-strip').hidden=false;
    }
    // verdict needs both legs
    if(corn&&urea){
      var pplb=urea/920;                       // $/lb N at 46%
      var ratio=pplb/corn;
      var word,cls,advice;
      if(ratio<0.075){word='N is cheap';cls='ff-tv-green';advice='the cheap-N column of the MRTN tables: <a href="#nitrogen" data-jump="nitrogen">push rates to the HIGH end &rarr;</a>';}
      else if(ratio<0.125){word='N is normal';cls='ff-tv-gold';advice='the typical column of the MRTN tables: <a href="#nitrogen" data-jump="nitrogen">use the middle N rates &rarr;</a>';}
      else if(ratio<0.175){word='N is getting pricey';cls='ff-tv-gold';advice='an above-average N cost: <a href="#nitrogen" data-jump="nitrogen">lean to the lower N rates &rarr;</a>';}
      else{word='N is expensive';cls='ff-tv-red';advice='the priciest column of the MRTN tables: <a href="#nitrogen" data-jump="nitrogen">use the LOW end of the N rates &rarr;</a>';}
      g('ffv-num').textContent=ratio.toFixed(2);
      g('ffv-num').className='ff-today-num '+cls;
      g('ffv-word').textContent=word;
      g('ffv-word').className='ff-today-word '+cls;
      g('ffv-line').innerHTML='Urea at <strong>$'+urea+'/ton</strong> / 920 lb of N is <strong>$'+pplb.toFixed(2)+' a pound of N</strong> against <strong>$'+corn.toFixed(2)+' corn</strong>: a '+ratio.toFixed(2)+' ratio. That’s '+advice;
      g('ffv-src').textContent='Corn: CBOT close · urea: '+uRow.src_label+(fertStale?' (aging, call to confirm)':'')+' · same math as the calculator below';
      g('ff-today').hidden=false;
    }
    // week card — editorial staging guide, hedged to "most of the Corn Belt"
    var wk=isoWeekNow();
    var W={
      16:['planting is rolling','Corn planters are rolling across the Belt. Check soil temp ≥50°F and scout for black cutworm as fields green.',['stages']],
      18:['corn VE–V1','Early corn is spiking. Stand counts now save replant regrets later.',['stages']],
      20:['corn V1–V2 · beans in','Corn at V1–V2, beans going in. Cutworm and slugs on the watch list.',['stages','pest']],
      22:['corn V2–V4','Side-dress window opening. Weed escapes show now. Check your MOA rotation.',['stages','pest']],
      24:['corn V4–V6','Side-dress window closing at V6. Rapid N uptake starts now.',['stages']],
      26:['corn V8–V12 · beans V3–R1','Corn stacking leaves fast. First rootworm beetles show; start counting.',['stages','pest']],
      28:['corn VT–R1: pollination','THE weather-sensitive window. Japanese beetles clipping silks? 3+ per ear, silks clipped under 1 inch, pollination not done is the threshold.',['pest']],
      30:['corn ~R2 · beans ~R3','Blister corn, pod-set beans. Worth a walk: rootworm beetles, soybean aphid (250/plant, over 80% of plants, rising).',['pest']],
      32:['corn R3–R4 · beans R4','Aphid pressure peaks. Grain-fill weather sets the top end of yield.',['pest']],
      34:['corn ~R5 · beans R5','Dent corn, seed-fill beans. Late diseases and stink bugs in beans.',['stages','pest']],
      36:['corn R5–R6 · beans R6','Push-test stalks: rots pick lodging candidates. Line up dry-down logistics.',['stages']],
      38:['maturity: black layer','Corn hitting black layer. Moisture checks beat calendar dates for harvest order.',['stages']],
      40:['harvest','Combines rolling. Watch bin moisture targets and shrink math.',['stages']],
      42:['harvest wrap-up','Fall anhydrous below 50°F soil only; patience pays in spring N.',['stages']]
    };
    var pick=null; for(var k in W){ if(wk>=+k&&wk<=+k+1) pick=W[k]; }
    if(pick){
      g('ffw-num').textContent='WEEK '+wk;
      g('ffw-txt').innerHTML='Most of the Corn Belt: <strong>'+pick[0]+'</strong>. '+pick[1]+' <a href="#'+pick[2][0]+'" data-jump="'+pick[2][0]+'">'+(pick[2][0]==='pest'?'Thresholds &rarr;':'Stage guide &rarr;')+'</a>';
      g('ff-week').hidden=false;
    }
    // jump links switch the tab properly (hash alone only works on first load)
    document.querySelectorAll('[data-jump]').forEach(function(a){
      a.addEventListener('click',function(e){
        var b=document.getElementById('tab-btn-'+a.getAttribute('data-jump'));
        if(b){ e.preventDefault(); b.click(); }
      });
    });
  });
})();

/* ─── N:CORN RATIO CALCULATOR ──────────────────────────────────────── */
function calcNC(){
  var corn=parseFloat(document.getElementById('nc-corn').value)||0;
  var fertSel=document.getElementById('nc-fert');
  // The Custom option carries value="0", and 0 is falsy, so `||46` swallowed it and
  // the next line could never fire. Every custom blend was priced as urea at 46% N.
  var isCustom=fertSel.value==='0';
  var pct=isCustom?parseFloat(document.getElementById('nc-custom-pct').value)
                 :parseFloat(fertSel.value);
  if(!isFinite(pct)||pct<=0)pct=isCustom?0:46;
  document.getElementById('nc-custom-wrap').style.display=(fertSel.value==='0')?'flex':'none';
  var ton=parseFloat(document.getElementById('nc-fertprice').value)||0;
  if(!(ton>0)){
    // No live price loaded and none typed: say so rather than price at a made-up number.
    document.getElementById('nc-nlb').textContent='-';document.getElementById('nc-ratio').textContent='-';
    document.getElementById('nc-col').textContent='-';document.getElementById('nc-interp').textContent='Type a fertilizer price per ton (the posted price fills in when it loads).';
    return;
  }
  var pplb=pct>0?ton/(2000*pct/100):0;
  var ratio=(corn>0&&pct>0)?pplb/corn:0;
  var col,interp;
  if(ratio<0.075){col='0.05';interp='Low N:Corn ratio: use high-end MRTN rates';}
  else if(ratio<0.125){col='0.10';interp='Typical ratio: moderate MRTN rates';}
  else if(ratio<0.175){col='0.15';interp='Above-average N cost: consider lower end';}
  else{col='0.20';interp='High N:Corn ratio: use low MRTN rates';}
  document.getElementById('nc-nlb').textContent='$'+pplb.toFixed(2);
  document.getElementById('nc-ratio').textContent=ratio.toFixed(3);
  document.getElementById('nc-col').textContent=col;
  document.getElementById('nc-interp').textContent=interp;
  ['nth-05','nth-10','nth-15','nth-20'].forEach(function(id){
    var th=document.getElementById(id);if(th)th.classList.toggle('act',th.id==='nth-'+col.replace('0.',''));
  });
}
['nc-corn','nc-fert','nc-fertprice','nc-custom-pct'].forEach(function(id){
  var el=document.getElementById(id);if(el)el.addEventListener('input',calcNC);
});
calcNC();

/* ─── ECO COST BUILDER ────────────────────────────────────────────── */
function updateEcoCosts(){
  var nRate=parseFloat(document.getElementById('eco-n-rate').value)||0;
  var nPplb=parseFloat(document.getElementById('eco-n-pplb').value)||0;
  var pRate=parseFloat(document.getElementById('eco-p-rate').value)||0;
  var pPplb=parseFloat(document.getElementById('eco-p-pplb').value)||0;
  var kRate=parseFloat(document.getElementById('eco-k-rate').value)||0;
  var kPplb=parseFloat(document.getElementById('eco-k-pplb').value)||0;
  var seed=parseFloat(document.getElementById('eco-seed').value)||0;
  var chem=parseFloat(document.getElementById('eco-chem').value)||0;
  var rent=parseFloat(document.getElementById('eco-rent').value)||0;
  var other=parseFloat(document.getElementById('eco-other').value)||0;
  var nCost=nRate*nPplb;var pCost=pRate*pPplb;var kCost=kRate*kPplb;
  // No price is never a zero: say which box is empty instead of a stale number.
  var miss=[];if(!(nPplb>0))miss.push('N');if(!(pPplb>0))miss.push('P\u2082O\u2085');if(!(kPplb>0))miss.push('K\u2082O');
  var pn=document.getElementById('eco-price-note');
  if(pn){pn.hidden=!miss.length;pn.textContent=miss.length?'No live price for '+miss.join(', ')+' right now, so the total leaves it out. Type your own $/lb.':'';}
  function s(id,v){var el=document.getElementById(id);if(el)el.textContent='$'+(v.toFixed(2));}
  s('eco-n-cost',nCost);s('eco-p-cost',pCost);s('eco-k-cost',kCost);
  s('eco-seed-echo',seed);s('eco-chem-echo',chem);s('eco-rent-echo',rent);s('eco-other-echo',other);
  var total=nCost+pCost+kCost+seed+chem+rent+other;
  var te=document.getElementById('eco-total');if(te)te.textContent='$'+total.toFixed(2)+'/ac';
  if(PRICES['DAP_PPLB']){
    var pkOut=document.getElementById('pk-cost-out');
    if(pkOut){pkOut.style.display='flex';}
  }
  updateSTCost();
}
['eco-n-rate','eco-n-pplb','eco-p-rate','eco-p-pplb','eco-k-rate','eco-k-pplb','eco-seed','eco-chem','eco-rent','eco-other'].forEach(function(id){
  var el=document.getElementById(id);if(el)el.addEventListener('input',updateEcoCosts);
});

/* ─── SOIL TEST INTERPRETER ──────────────────────────────────────── */
var ST_P={
  corn:{VL:[0,10],L:[11,15],O:[16,25],H:[26,50],VH:[51,75],EH:[76,9999],
    recs:{VL:[95,100,110,115,125,130,140],L:[85,90,100,105,115,120,130],O:[55,60,70,75,85,90,100],H:[30,30,35,40,45,45,50],VH:[0,0,0,0,0,0,0],EH:[0,0,0,0,0,0,0]},
    yields:[150,170,190,210,230,250,270]},
  soybean:{VL:[0,10],L:[11,15],O:[16,25],H:[26,50],VH:[51,75],EH:[76,9999],
    recs:{VL:[80,90,95,105,110],L:[70,80,85,95,100],O:[40,50,55,65,70],H:[20,25,30,35,35],VH:[0,0,0,0,0],EH:[0,0,0,0,0]},
    yields:[55,65,75,85,95]},
  corn_silage:{VL:[0,10],L:[11,15],O:[16,25],H:[26,50],VH:[51,75],EH:[76,9999],
    recs:{VL:[95,100,110,115,125,130,140],L:[85,90,100,105,115,120,130],O:[55,60,70,75,85,90,100],H:[30,30,35,40,45,45,50],VH:[0,0,0,0,0,0,0],EH:[0,0,0,0,0,0,0]},
    yields:[150,170,190,210,230,250,270]},
  alfalfa:{VL:[0,10],L:[11,15],O:[16,25],H:[26,50],VH:[51,75],EH:[76,9999],
    recs:{VL:[95,100,110,115,125,130,140],L:[85,90,100,105,115,120,130],O:[55,60,70,75,85,90,100],H:[30,30,35,40,45,45,50],VH:[0,0,0,0,0,0,0],EH:[0,0,0,0,0,0,0]},
    yields:[150,170,190,210,230,250,270]}
};
var ST_K={
  corn:{VL:[0,60],L:[61,90],O:[91,130],H:[131,200],VH:[201,300],EH:[301,9999],
    recs:{VL:[85,90,95,105,110,115,120],L:[70,75,80,90,95,100,105],O:[40,45,50,60,65,70,75],H:[20,25,25,30,35,35,40],VH:[10,10,15,15,15,20,20],EH:[0,0,0,0,0,0,0]},
    yields:[150,170,190,210,230,250,270]},
  soybean:{VL:[0,60],L:[61,90],O:[91,130],H:[131,200],VH:[201,300],EH:[301,9999],
    recs:{VL:[115,130,145,155,170],L:[100,115,130,140,155],O:[70,85,100,110,125],H:[35,45,50,55,65],VH:[20,20,25,30,30],EH:[0,0,0,0,0]},
    yields:[55,65,75,85,95]},
  corn_silage:{VL:[0,60],L:[61,90],O:[91,130],H:[131,200],VH:[201,300],EH:[301,9999],
    recs:{VL:[85,90,95,105,110,115,120],L:[70,75,80,90,95,100,105],O:[40,45,50,60,65,70,75],H:[20,25,25,30,35,35,40],VH:[10,10,15,15,15,20,20],EH:[0,0,0,0,0,0,0]},
    yields:[150,170,190,210,230,250,270]},
  alfalfa:{VL:[0,60],L:[61,90],O:[91,130],H:[131,200],VH:[201,300],EH:[301,9999],
    recs:{VL:[85,90,95,105,110,115,120],L:[70,75,80,90,95,100,105],O:[40,45,50,60,65,70,75],H:[20,25,25,30,35,35,40],VH:[10,10,15,15,15,20,20],EH:[0,0,0,0,0,0,0]},
    yields:[150,170,190,210,230,250,270]}
};
var CAT_NAMES={'VL':'Very Low','L':'Low','O':'Optimum','H':'High','VH':'Very High','EH':'Extremely High'};
function getSTCat(val,crop,nutrient){
  var tbl=nutrient==='P'?ST_P[crop]:ST_K[crop];if(!tbl)return{cat:'?',rec:0};
  var cats=['VL','L','O','H','VH','EH'];
  for(var i=0;i<cats.length;i++){var c=cats[i];if(val>=tbl[c][0]&&val<=tbl[c][1]){
    var yields=tbl.yields;var yieldGoal=parseFloat(document.getElementById('st-yield').value)||200;
    var yIdx=yields.length-1;
    for(var j=0;j<yields.length;j++){if(yieldGoal<=yields[j]){yIdx=j;break;}}
    var rec=tbl.recs[c]&&tbl.recs[c][yIdx]!==undefined?tbl.recs[c][yIdx]:0;
    return{cat:c,catName:CAT_NAMES[c],rec:rec};
  }}
  return{cat:'?',catName:'Unknown',rec:0};
}
function calcST(){
  var crop=document.getElementById('st-crop').value||'corn';
  var p=parseFloat(document.getElementById('st-p').value)||0;
  var k=parseFloat(document.getElementById('st-k').value)||0;
  var pResult=getSTCat(p,crop,'P');
  var kResult=getSTCat(k,crop,'K');
  function s(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
  s('st-pcat',pResult.catName||pResult.cat);
  s('st-kcat',kResult.catName||kResult.cat);
  s('st-prec',pResult.rec+' lb/ac');
  s('st-krec',kResult.rec+' lb/ac');
  var note='';
  if(pResult.cat==='VL'||pResult.cat==='L')note+='Low P may limit yield. ';
  if(kResult.cat==='VL'||kResult.cat==='L')note+='Low K may limit yield. ';
  if(pResult.cat==='H'||pResult.cat==='VH'||pResult.cat==='EH')note+='High P: reduce or eliminate P application. ';
  s('st-note',note);
  updateSTCost(pResult.rec,kResult.rec);
}
function updateSTCost(prec,krec){
  var pEl=document.getElementById('st-prec');var kEl=document.getElementById('st-krec');
  var p=prec||parseFloat((pEl&&pEl.textContent)||'0');
  var k=krec||parseFloat((kEl&&kEl.textContent)||'0');
  // From the live file (or the reader's own entry); no price -> no cost line, never a fallback number.
  var pPplb=parseFloat(document.getElementById('eco-p-pplb')&&document.getElementById('eco-p-pplb').value)||0;
  var kPplb=parseFloat(document.getElementById('eco-k-pplb')&&document.getElementById('eco-k-pplb').value)||0;
  var pCost=p*pPplb;var kCost=k*kPplb;
  function s(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
  s('pk-p-cost','$'+pCost.toFixed(2)+'/ac');
  s('pk-k-cost','$'+kCost.toFixed(2)+'/ac');
  s('pk-total-cost','$'+(pCost+kCost).toFixed(2)+'/ac');
  var pkOut=document.getElementById('pk-cost-out');
  if(pkOut)pkOut.style.display=(pCost>0||kCost>0)?'flex':'none';
}
['st-crop','st-yield','st-p','st-k'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('input',calcST);});
calcST();

/* ─── CROP REMOVAL CALCULATOR ──────────────────────────────────────── */
function calcRemoval(){
  var sel=document.getElementById('rem-crop').value.split(':');
  var pFac=parseFloat(sel[1])||0;var kFac=parseFloat(sel[2])||0;
  var y=parseFloat(document.getElementById('rem-yield').value)||0;
  var a=parseFloat(document.getElementById('rem-acres').value)||1;
  var pAc=pFac*y;var kAc=kFac*y;
  function s(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
  s('rem-p-ac',pAc.toFixed(1)+' lb/ac');s('rem-k-ac',kAc.toFixed(1)+' lb/ac');
  s('rem-p-tot',(pAc*a).toFixed(0)+' lb');s('rem-k-tot',(kAc*a).toFixed(0)+' lb');
}
['rem-crop','rem-yield','rem-acres'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('input',calcRemoval);});
calcRemoval();

/* ─── CORN YIELD CALCULATOR ─────────────────────────────────────────── */
function calcCornYield(){
  var lbs=parseFloat(document.getElementById('corn-lbs').value)||0;
  var moist=parseFloat(document.getElementById('corn-moist').value)||0;
  var acres=parseFloat(document.getElementById('corn-acres').value)||1;
  var driedLbs=lbs*(100-moist)/84.5;
  var bu=driedLbs/56;var buac=bu/acres;
  function s(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
  s('corn-bu',bu.toFixed(1)+' bu');s('corn-buac',buac.toFixed(1)+' bu/ac');
}
['corn-lbs','corn-moist','corn-acres'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('input',calcCornYield);});
calcCornYield();

/* ─── APPLICATION RATE CALCULATOR ──────────────────────────────────── */
function calcManApp(){
  var loads=parseFloat(document.getElementById('man-loads').value)||0;
  var size=parseFloat(document.getElementById('man-size').value)||0;
  var units=document.getElementById('man-units').value;
  var acres=parseFloat(document.getElementById('man-acres').value)||1;
  var total=loads*size;
  var rate=total/acres;
  var uLabel=units==='tons'?'tons':'gallons';
  function s(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
  s('man-total',total.toFixed(1)+' '+uLabel);
  s('man-rate',rate.toFixed(1)+' '+uLabel+'/acre');
}
['man-loads','man-size','man-units','man-acres'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('input',calcManApp);});
calcManApp();

/* ─── LIME CALCULATOR ──────────────────────────────────────────────── */
function calcLime(){
  var buf=parseFloat(document.getElementById('lime-buf').value)||6.5;
  var target=parseFloat(document.getElementById('lime-target').value)||6.8;
  var cceEl=document.getElementById('lime-cce');
  var cce=cceEl.value==='custom'?parseFloat(document.getElementById('lime-cce-custom').value)||75:parseFloat(cceEl.value)||75;
  document.getElementById('lime-cce-wrap').style.display=cceEl.value==='custom'?'flex':'none';
  var SMP_FACTORS={6.0:{6.8:3.2,6.3:2.8,6.0:2.4},6.1:{6.8:2.9,6.3:2.5,6.0:2.1},6.2:{6.8:2.6,6.3:2.2,6.0:1.8},6.3:{6.8:2.3,6.3:1.9,6.0:1.5},6.4:{6.8:2.0,6.3:1.6,6.0:1.2},6.5:{6.8:1.7,6.3:1.3,6.0:0.9},6.6:{6.8:1.4,6.3:1.0,6.0:0.6},6.7:{6.8:1.1,6.3:0.7,6.0:0.3},6.8:{6.8:0,6.3:0,6.0:0}};
  var bufKey=Math.round(buf*10)/10;if(bufKey>6.8)bufKey=6.8;if(bufKey<6.0)bufKey=6.0;bufKey=parseFloat(bufKey.toFixed(1));
  var tKey=parseFloat(target).toFixed(1);if(!SMP_FACTORS[bufKey])bufKey=6.5;
  var pureTons=SMP_FACTORS[bufKey]?SMP_FACTORS[bufKey][tKey]||0:0;
  var agTons=pureTons/(cce/100);
  function s(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
  s('lime-pure',pureTons.toFixed(1)+' ton');
  s('lime-ag',agTons.toFixed(1)+' ton');
  var note='';
  if(agTons>12)note='Exceeds max: apply 12 ton this year, retest in 2-3 yrs';
  else if(agTons<2&&agTons>0)note='Min rate 2 ton (most soils) or 1 ton (sandy <1% OM)';
  else if(agTons===0)note='No lime needed for target pH';
  else note='Apply in fall for spring benefit. Disk in if possible.';
  s('lime-note',note);
  var costEl=document.getElementById('lime-cost');
  if(costEl){
    // Lime has no live price source (the hand-typed dealer sheet that priced
    // pelletized lime is gone), so lime is priced only at the reader's own $/ton.
    var priceEl=document.getElementById('lime-price');
    var own=priceEl?parseFloat(priceEl.value):NaN;
    costEl.style.color='var(--gold)';
    if(agTons===0){
      costEl.textContent='None needed';costEl.style.color='var(--text-muted)';
    } else if(own>0){
      costEl.textContent='$'+(agTons*own).toFixed(0)+'/ac at your $'+own+'/ton';
    } else {
      costEl.textContent='Type your $/ton to see cost';costEl.style.color='var(--text-muted)';
    }
  }
}
['lime-buf','lime-target','lime-cce','lime-cce-custom','lime-price'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('input',calcLime);});
calcLime();

/* ─── GDU CALCULATOR ────────────────────────────────────────────────── */
function calcGDU(){
  var mx=Math.min(86,parseFloat(document.getElementById('gdu-max').value)||82);
  var mn=Math.max(50,parseFloat(document.getElementById('gdu-min').value)||58);
  var acc=parseFloat(document.getElementById('gdu-acc').value)||0;
  var day=Math.max(0,(mx+mn)/2-50);
  var newAcc=acc+day;
  function s(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
  s('gdu-day',day.toFixed(1)+' GDU');
  s('gdu-new',newAcc.toFixed(1)+' GDU total');
  var CORN_STAGES=[['VE',0],['V1',100],['V3',200],['V5',350],['V6',475],['V8',610],['V10',750],['V12',900],['V14',1050],['VT',1250],['R1',1400],['R2',1600],['R3',1750],['R4',1925],['R5',2200],['R6',2700]];
  var BEAN_STAGES=[['VE',0],['VC',50],['V1',120],['V2',250],['V3',400],['R1',550],['R2',650],['R3',750],['R4',900],['R5',1000],['R6',1200],['R7',1450],['R8',1650]];
  function getStage(acc,stages){for(var i=stages.length-1;i>=0;i--){if(acc>=stages[i][1])return stages[i][0];}return 'Pre-plant';}
  s('gdu-corn-stage',getStage(newAcc,CORN_STAGES));
  s('gdu-bean-stage',getStage(newAcc,BEAN_STAGES));
}
['gdu-max','gdu-min','gdu-acc'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('input',calcGDU);});
calcGDU();

/* ─── SPRAY CONDITIONS ──────────────────────────────────────────────── */
var sprayLat=null,sprayLon=null;
function evalSprayFactor(type,val){
  var chip,cls;
  if(type==='temp'){chip=val<50?'Too Cold':val>90?'Too Hot':val>=60&&val<=85?'Good':'Marginal';cls=val>=60&&val<=85?'good':val<45||val>95?'poor':'marginal';}
  else if(type==='wind'){chip=val<=10?'Good':val<=15?'Marginal':'Too Windy';cls=val<=10?'good':val<=15?'marginal':'poor';}
  else if(type==='hum'){chip=val>=40?'Good':val>=25?'Marginal':'Too Dry';cls=val>=40?'good':val>=25?'marginal':'poor';}
  else if(type==='cloud'){chip=val>=30?'Good':val>=15?'Marginal':'Very Sunny';cls=val>=30?'good':val>=15?'marginal':'poor';}
  else if(type==='precip'){chip=val===0?'None':val<2?'Light':val>=2?'Rain':'None';cls=val===0?'good':val<2?'marginal':'poor';}
  return{chip:chip,cls:cls};
}
function setSprayFactor(id,val,chipId,type){
  var el=document.getElementById(id);if(el)el.textContent=val;
  var chip=document.getElementById(chipId);if(!chip)return;
  var r=evalSprayFactor(type,parseFloat(val)||0);
  chip.textContent=r.chip;chip.className='spray-factor-chip '+r.cls;
}
function renderSprayConditions(w){
  var t=w.temperature_2m||'--';var wind=w.windspeed_10m||'--';var hum=w.relativehumidity_2m||'--';
  var cloud=w.cloudcover||'--';var precip=w.precipitation||0;
  setSprayFactor('spr-temp',Math.round(t)+'\u00b0F','spr-temp-chip','temp');
  setSprayFactor('spr-wind',Math.round(wind)+' mph','spr-wind-chip','wind');
  setSprayFactor('spr-hum',Math.round(hum)+'%','spr-hum-chip','hum');
  setSprayFactor('spr-cloud',Math.round(cloud)+'%','spr-cloud-chip','cloud');
  setSprayFactor('spr-precip',precip+'"','spr-precip-chip','precip');
  var scores=[evalSprayFactor('temp',t).cls,evalSprayFactor('wind',wind).cls,evalSprayFactor('hum',hum).cls,evalSprayFactor('precip',precip).cls];
  var poor=scores.filter(function(s){return s==='poor';}).length;
  var marginal=scores.filter(function(s){return s==='marginal';}).length;
  var overall,ov_cls,rec;
  if(poor>=2){overall='Poor';ov_cls='poor';rec='<strong>Do not spray</strong>: multiple unfavorable conditions present.';}
  else if(poor>=1||marginal>=2){overall='Marginal';ov_cls='marginal';rec='<strong>Use caution</strong>: conditions are marginal. Monitor closely and adjust timing if possible.';}
  else{overall='Good';ov_cls='good';rec='<strong>Conditions are suitable for application.</strong> Always verify wind &lt;10 mph and no rain within 4 hours.';}
  var ove=document.getElementById('spr-overall');if(ove)ove.textContent=overall;
  var ovc=document.getElementById('spr-overall-chip');if(ovc){ovc.textContent=overall;ovc.className='spray-factor-chip '+ov_cls;}
  var ss=document.getElementById('spray-status');if(ss){ss.textContent=overall;ss.className='spray-widget-status '+ov_cls;}
  var sr=document.getElementById('spray-rec');if(sr)sr.innerHTML=rec;
}
function fetchSprayWeather(lat,lon){
  var url='https://api.open-meteo.com/v1/forecast?latitude='+lat+'&longitude='+lon+'&current_weather=false&hourly=temperature_2m,relativehumidity_2m,windspeed_10m,cloudcover,precipitation&temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch&forecast_days=1&timezone=auto';
  fetch(url).then(function(r){return r.ok?r.json():null;}).then(function(data){
    if(!data||!data.hourly)return;
    var now=new Date();var hr=now.getHours();var h=data.hourly;
    var w={temperature_2m:h.temperature_2m[hr],relativehumidity_2m:h.relativehumidity_2m[hr],windspeed_10m:h.windspeed_10m[hr],cloudcover:h.cloudcover[hr],precipitation:h.precipitation[hr]};
    renderSprayConditions(w);
  }).catch(function(){});
}
function sprayFromGeo(){
  if(window.AGSIST_STATE&&window.AGSIST_STATE.lat){fetchSprayWeather(window.AGSIST_STATE.lat,window.AGSIST_STATE.lon);return;}
  setTimeout(sprayFromGeo,800);
}
sprayFromGeo();
document.getElementById('spray-go')&&document.getElementById('spray-go').addEventListener('click',function(){
  var zip=document.getElementById('spray-zip').value.trim();
  if(zip.length!==5)return;
  fetch('https://nominatim.openstreetmap.org/search?postalcode='+zip+'&country=US&format=json&limit=1')
    .then(function(r){return r.json();}).then(function(d){
      if(!d||!d[0])return;
      var lat=d[0].lat;var lon=d[0].lon;
      var lbl=document.getElementById('spray-loc-label');if(lbl)lbl.textContent=d[0].display_name.split(',')[0];
      fetchSprayWeather(lat,lon);
    }).catch(function(){});
});

/* ─── SCOUTING ADVISOR ──────────────────────────────────────────────── */
var SCOUT_DB={
  'VE_V3:VE_V2':[{icon:'<svg class="ic" aria-hidden="true"><use href="#i-bug"/></svg>',text:'Black Cutworm',thresh:'3+ cut plants per 100 (treat immediately)'},
    {icon:'<svg class="ic" aria-hidden="true"><use href="#i-sprout"/></svg>',text:'Stand establishment: count plants per 1/1000 ac row length',thresh:'Replant threshold: <24,000 plants/ac'},
    {icon:'<svg class="ic" aria-hidden="true"><use href="#i-bug"/></svg>',text:'Wireworm / seedcorn maggot',thresh:'Any stand reduction in wet cold soils'}],
  'V4_V6:V3_V5':[{icon:'<svg class="ic" aria-hidden="true"><use href="#i-bug"/></svg>',text:'Black Cutworm',thresh:'3+ cut plants per 100'},
    {icon:'<svg class="ic" aria-hidden="true"><use href="#i-bug"/></svg>',text:'Soybean aphid (first arrival)',thresh:'Not threshold yet: monitor for early colonies'},
    {icon:'<svg class="ic" aria-hidden="true"><use href="#i-leaf"/></svg>',text:'Rootworm egg hatch (soil temp 50\u00b0F at 4")',thresh:'Flag continuous corn fields'},
    {icon:'<svg class="ic" aria-hidden="true"><use href="#i-bug"/></svg>',text:'Bean leaf beetle',thresh:'20-30% defoliation threshold'}],
  'V7_V9:R1_R2':[{icon:'<svg class="ic" aria-hidden="true"><use href="#i-bug"/></svg>',text:'Soybean aphid',thresh:'250 per plant on over 80% of plants, increasing; threshold runs through R5'},
    {icon:'<svg class="ic" aria-hidden="true"><use href="#i-bug"/></svg>',text:'European Corn Borer',thresh:'1 egg mass or fresh feeding per 5 plants'},
    {icon:'<svg class="ic" aria-hidden="true"><use href="#i-bug"/></svg>',text:'Japanese beetle (corn & soybean)',thresh:'Corn: 3+/ear, silks clipped under 1", pollination not done'},
    {icon:'<svg class="ic" aria-hidden="true"><use href="#i-leaf"/></svg>',text:'Gray Leaf Spot: watch warm humid nights',thresh:'Treat if GLS on or above ear leaf before silking'}],
  'VT_R1:R3_R4':[{icon:'<svg class="ic" aria-hidden="true"><use href="#i-bug"/></svg>',text:'Corn rootworm adult silk clipping',thresh:'5+ beetles/plant in the first week of pollen shed, or silks clipped to 1/2" on 25-50% of plants'},
    {icon:'<svg class="ic" aria-hidden="true"><use href="#i-bug"/></svg>',text:'Soybean aphid: critical window',thresh:'250/plant on over 80% of plants, increasing; threshold runs through R5'},
    {icon:'<svg class="ic" aria-hidden="true"><use href="#i-bug"/></svg>',text:'Corn earworm / Western Bean Cutworm',thresh:'8% egg mass infestation pre-tassel'},
    {icon:'<svg class="ic" aria-hidden="true"><use href="#i-bug"/></svg>',text:'Spider mite: check field edges in hot dry weather',thresh:'25-50% stippling with active mites'}],
  'R2_R3:R5_R6':[{icon:'<svg class="ic" aria-hidden="true"><use href="#i-bug"/></svg>',text:'Spider mite: high risk in hot dry conditions',thresh:'25-50% leaf stippling with active mites present'},
    {icon:'<svg class="ic" aria-hidden="true"><use href="#i-bug"/></svg>',text:'Soybean aphid: R5 is the last stage the threshold covers',thresh:'No set threshold at R6; early R6 only for very large populations on stressed plants'},
    {icon:'<svg class="ic" aria-hidden="true"><use href="#i-leaf"/></svg>',text:'Northern Corn Leaf Blight / NCLB',thresh:'Fungicide if NCLB on/below ear leaf by VT/R1'},
    {icon:'<svg class="ic" aria-hidden="true"><use href="#i-chart-column"/></svg>',text:'Yield estimate: ear length/girth method',thresh:'Count every 2 weeks from R3 forward'}],
  'R4_R6:R7':[{icon:'<svg class="ic" aria-hidden="true"><use href="#i-leaf"/></svg>',text:'Harvest timing: corn at black layer',thresh:'Corn at 30-35% moisture for ear snap/combine harvest'},
    {icon:'<svg class="ic" aria-hidden="true"><use href="#i-bug"/></svg>',text:'Soybean harvest timing',thresh:'Beans at R7 (1 mature pod) = safe to harvest when dry'},
    {icon:'<svg class="ic" aria-hidden="true"><use href="#i-droplet"/></svg>',text:'Aflatoxin / Vomitoxin risk in stressed corn',thresh:'Test before delivery if drought or ear rot observed'}]
};
function updateScout(){
  var cs=document.getElementById('scout-corn-stage').value;
  var bs=document.getElementById('scout-bean-stage').value;
  var el=document.getElementById('scout-list');if(!el)return;
  if(!cs&&!bs){el.innerHTML='<span class="scout-empty">Select growth stages above to see priority scouting items for this week.</span>';return;}
  var key=(cs||'any')+':'+(bs||'any');
  var items=SCOUT_DB[key]||SCOUT_DB[(cs||'any')+':VE_V2']||SCOUT_DB['VT_R1:R3_R4']||[];
  if(items.length===0){el.innerHTML='<span class="scout-empty">No specific alerts for this stage combination; general scouting recommended.</span>';return;}
  el.innerHTML=items.map(function(item){
    return '<div class="scout-item"><span class="scout-item-icon">'+item.icon+'</span><span class="scout-item-text">'+item.text+'<span class="scout-item-thresh">'+item.thresh+'</span></span></div>';
  }).join('');
}
['scout-corn-stage','scout-bean-stage'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('change',updateScout);});

/* ─── CROP STAGES TIMELINE ──────────────────────────────────────────── */
var stagesInited=false;
function initStages(){
  if(stagesInited)return;stagesInited=true;
  var CORN_VIS=[
    {s:'VE',gdu:0,key:true,desc:'Coleoptile emerges through soil surface.',mgmt:'Check soil temp \u226550\u00b0F. Scout for stand establishment and black cutworm.'},
    {s:'V1',gdu:100,desc:'First leaf collar visible.',mgmt:'Count stand. 1/1000 ac row count for plant population.'},
    {s:'V3',gdu:200,key:true,desc:'3rd leaf collar visible. Growing point still below soil.',mgmt:'BCW threshold: 3+ cut plants/100. Point of no return for replant decision near.'},
    {s:'V5',gdu:350,desc:'5th leaf collar. Growing point near soil surface.',mgmt:'Last safe opportunity for anhydrous side-dress. Rapid leaf appearance begins.'},
    {s:'V6',gdu:475,desc:'Growing point above soil. Ear shoots determined.',mgmt:'Side-dress N window: V4\u2013V6 optimal. UAN Y-drop effective to V8.'},
    {s:'V8',gdu:610,key:true,desc:'8 leaf collars. Ear shoots forming, row number set.',mgmt:'Scout for European Corn Borer egg masses. Begin fungicide watch if conditions favor disease.'},
    {s:'V10',gdu:750,desc:'10 collars. Ear row number determined.',mgmt:'Final N uptake push begins. Make sure K is adequate for stalk strength.'},
    {s:'V12',gdu:900,desc:'12 collars. Kernel row number set, potential kernels/row determined.',mgmt:'Scout GLS on lower leaves. Fungicide efficacy window: before VT.'},
    {s:'VT',gdu:1250,key:true,desc:'Tassel fully emerged. Pollen shed begins.',mgmt:'Critical pollination window. Corn rootworm adults: 5+/plant in the first week of pollen shed. Japanese beetle: 3+/ear with silks clipped under 1".'},
    {s:'R1',gdu:1400,key:true,desc:'Silking. One or more silks visible outside husk. Pollination occurs.',mgmt:'Avoid canopy disturbance. Drought/heat stress now = yield loss. Monitor silk clipping.'},
    {s:'R2',gdu:1600,desc:'Blister. Kernels white, blister-like, fluid-filled.',mgmt:'Drought stress still damaging. Kernel number now fixed.'},
    {s:'R3',gdu:1750,key:true,desc:'Milk. Kernels yellow, milky fluid inside.',mgmt:'Yield estimate: count ear length \u00d7 circumference. Dry matter accumulation underway.'},
    {s:'R4',gdu:1925,desc:'Dough. Kernel contents doughy, resistance when squeezed.',mgmt:'50% of final dry weight deposited. Stalk cannibalizes if N/K deficient.'},
    {s:'R5',gdu:2200,key:true,desc:'Dent. All kernels dented. Milk line appears.',mgmt:'Black layer forms when milk line reaches kernel tip. Watch for Diplodia ear rot.'},
    {s:'R6',gdu:2700,key:true,desc:'Black Layer / Physiological Maturity. Kernel dry weight maximum.',mgmt:'Moisture ~35%. Begin monitoring for harvest timing (28\u201330% for combine harvest).'}
  ];
  var BEAN_VIS=[
    {s:'VE',gdu:0,desc:'Unifoliate leaves emerge through soil.',mgmt:'Check stand. Seedcorn maggot or pythium risk in cold wet soils.'},
    {s:'VC',gdu:50,desc:'Unifoliate leaves unrolled.',mgmt:'Stand establishment assessment. Replant threshold: <100,000 plants/ac.'},
    {s:'V1',gdu:120,desc:'First trifoliate fully open.',mgmt:'Bean leaf beetle and slug activity. 20-30% defoliation threshold.'},
    {s:'V2',gdu:200,desc:'Second trifoliate.',mgmt:'Continue scouting for bean leaf beetle, slugs, and aphid early detection.'},
    {s:'V3',gdu:300,desc:'Third trifoliate.',mgmt:'Aphid colonies may begin. Iron deficiency chlorosis (IDC) visible on calcareous soils.'},
    {s:'V4',gdu:400,key:true,desc:'4th trifoliate. Branching begins.',mgmt:'Aphid scouting: 250/plant threshold. Begin regular aphid counts.'},
    {s:'R1',gdu:550,key:true,desc:'Beginning bloom. One open flower on any node.',mgmt:'Aphid threshold critical: 250/plant on over 80% of plants, increasing. Japanese beetle: 20% defoliation.'},
    {s:'R2',gdu:650,desc:'Full bloom.',mgmt:'Fungicide window: R1\u2013R3 for white mold in susceptible varieties under wet conditions.'},
    {s:'R3',gdu:750,key:true,desc:'Beginning pod. 3/16" pod on one of the 4 uppermost nodes.',mgmt:'Critical yield-forming stage. Aphid threshold still applies. White mold pressure peak.'},
    {s:'R4',gdu:900,key:true,desc:'Full pod. 3/4" pod at uppermost 4 nodes.',mgmt:'Aphid threshold still applies. Pod feeding by beetles increases yield loss risk.'},
    {s:'R5',gdu:1000,key:true,desc:'Beginning seed. Seed 1/8" long in pod at uppermost 4 nodes.',mgmt:'Last stage the 250/plant aphid threshold covers. Pod and seed fill critical. Spider mite watch in dry heat.'},
    {s:'R6',gdu:1200,desc:'Full seed. Pod contains a green seed filling the pod cavity.',mgmt:'Defoliation threshold rises to 25%. Harvest planning begins.'},
    {s:'R7',gdu:1450,key:true,desc:'Beginning maturity. One mature brown pod.',mgmt:'Safe to harvest when pods dry to <15% moisture. Watch for harvest loss from shattering.'},
    {s:'R8',gdu:1650,desc:'Full maturity. 95% of pods are mature brown color.',mgmt:'Timely harvest critical. 1% per day yield loss from shattering and weathering.'}
  ];
  function buildTimeline(wrapId,markId,detailId,stages){
    var marks=document.getElementById(markId);var detail=document.getElementById(detailId);
    if(!marks||!detail)return;
    marks.innerHTML='';
    stages.forEach(function(st,i){
      var div=document.createElement('div');
      div.className='sv-mark'+(st.key?' key':'');
      div.setAttribute('role','button');div.setAttribute('tabindex','0');
      div.setAttribute('aria-label',st.s+', '+st.gdu+' GDU');
      div.innerHTML='<div class="sv-dot"></div><div class="sv-lbl">'+st.s+'</div><div class="sv-gdu">'+st.gdu+'</div>';
      div.addEventListener('click',function(){
        document.querySelectorAll('#'+markId+' .sv-mark').forEach(function(m){m.classList.remove('active');});
        div.classList.add('active');
        detail.innerHTML='<div class="sv-detail-stage">'+st.s+'</div>'
          +'<div class="sv-detail-gdu">~'+st.gdu+' GDUs from emergence (base 50\u00b0F)</div>'
          +'<div class="sv-detail-desc">'+st.desc+'</div>'
          +'<div class="sv-detail-mgmt"><svg class="ic" aria-hidden="true"><use href="#i-triangle-alert"/></svg> '+st.mgmt+'</div>';
      });
      div.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();div.click();}});
      marks.appendChild(div);
    });
    marks.querySelector('.sv-mark').click();
  }
  buildTimeline('corn-sv-wrap','corn-sv-marks','corn-sv-detail',CORN_VIS);
  buildTimeline('bean-sv-wrap','bean-sv-marks','bean-sv-detail',BEAN_VIS);
}

/* ─── STATE STATS ─────────────────────────────────────────────────── */
var stateInited=false;
var stateData={};
var STATE_NAMES={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'};
function initStateStats(){
  if(stateInited)return;
  stateInited=true;
  var sel=document.getElementById('ff-state-select');
  var activeState=(sel&&sel.value)||'IA';
  function renderState(code){
    var content=document.getElementById('state-content');if(!content)return;
    var s=stateData&&stateData[code];
    if(!s){content.innerHTML='<div style="grid-column:1/-1;color:var(--text-muted);font-size:.84rem;line-height:1.7;padding:1rem 0">Per-state corn, soybean &amp; wheat detail for <strong style="color:var(--text)">'+(STATE_NAMES[code]||code)+'</strong>, acreage, yield, and production: is in the USDA NASS database, the authoritative national source. <a href="https://quickstats.nass.usda.gov/" target="_blank" rel="noopener" style="color:var(--gold);text-decoration:none;white-space:nowrap">Open USDA NASS Quick Stats &rarr;</a></div>';return;}
    var safe=function(v,u){return v!=null?v+(u?u:''):'-';};
    content.innerHTML='<div class="ff-shdr"><div><div class="ff-sname">'+s.name+'</div><div class="ff-smeta">'+s.meta+'</div></div></div>'
      +'<div class="ff-card"><div class="ff-card-head"><span class="ff-card-icon"><svg class="ic" aria-hidden="true"><use href="#i-sprout"/></svg></span><span class="ff-card-title rp corn">Corn</span></div>'
      +'<div class="ff-row"><span class="ff-rl">Planted</span><span class="ff-rv">'+safe(s.corn_acres_planted,' M ac')+'</span></div>'
      +'<div class="ff-row"><span class="ff-rl">Harvested</span><span class="ff-rv">'+safe(s.corn_acres_harvested,' M ac')+'</span></div>'
      +'<div class="ff-row"><span class="ff-rl">Yield</span><span class="ff-rv gold">'+safe(s.corn_yield,' bu/ac')+'</span></div>'
      +'<div class="ff-row"><span class="ff-rl">Production</span><span class="ff-rv">'+safe(s.corn_prod,' M bu')+'</span></div></div>'
      +'<div class="ff-card"><div class="ff-card-head"><span class="ff-card-icon"><svg class="ic" aria-hidden="true"><use href="#i-leaf"/></svg></span><span class="ff-card-title rp beans">Soybeans</span></div>'
      +'<div class="ff-row"><span class="ff-rl">Planted</span><span class="ff-rv">'+safe(s.bean_acres_planted,' M ac')+'</span></div>'
      +'<div class="ff-row"><span class="ff-rl">Harvested</span><span class="ff-rv">'+safe(s.bean_acres_harvested,' M ac')+'</span></div>'
      +'<div class="ff-row"><span class="ff-rl">Yield</span><span class="ff-rv gold">'+safe(s.bean_yield,' bu/ac')+'</span></div>'
      +'<div class="ff-row"><span class="ff-rl">Production</span><span class="ff-rv">'+safe(s.bean_prod,' M bu')+'</span></div></div>'
      +(s.wheat_yield?'<div class="ff-card"><div class="ff-card-head"><span class="ff-card-icon"><svg class="ic" aria-hidden="true"><use href="#i-wheat"/></svg></span><span class="ff-card-title rp wheat">Winter Wheat</span></div>'
      +(s.wheat_meta&&s.wheat_meta!==s.meta?'<div class="ff-row"><span class="ff-rl" style="font-size:.74rem">'+s.wheat_meta+'</span></div>':'')
      +'<div class="ff-row"><span class="ff-rl">Yield</span><span class="ff-rv gold">'+safe(s.wheat_yield,' bu/ac')+'</span></div>'
      +'<div class="ff-row"><span class="ff-rl">Production</span><span class="ff-rv">'+safe(s.wheat_prod,' M bu')+'</span></div></div>':'');
  }
  fetch('/data/state-stats.json').then(function(r){return r.ok?r.json():null;}).then(function(data){
    if(data&&data.stateStats)stateData=data.stateStats;
    renderState(activeState);
  }).catch(function(){renderState(activeState);});
  if(sel){sel.addEventListener('change',function(){activeState=sel.value;renderState(activeState);});}
}

/* ─── SOURCE FOOTER ─────────────────────────────────────────────────── */
var srcEl=document.querySelector('.ff-source');
if(!srcEl){var s2=document.createElement('div');s2.className='ff-source';
  s2.innerHTML='Sources: <a href="https://cropsandsoils.extension.wisc.edu/nutrient-application-guidelines-for-field-vegetable-and-fruit-crops-in-wisconsin-a2809" target="_blank" rel="noopener">UW-Extension A2809</a> &middot; <a href="https://extension.umn.edu" target="_blank" rel="noopener">UMN Extension</a> &middot; <a href="https://www.nass.usda.gov/" target="_blank" rel="noopener">USDA NASS</a> &middot; Live prices from AGSIST data feed &middot; <a href="/">&#x2190; AGSIST Dashboard</a> &middot; <a href="tel:+17157972428">715-797-2428</a>';
  document.querySelector('.ff-page')&&document.querySelector('.ff-page').appendChild(s2);}

})();
