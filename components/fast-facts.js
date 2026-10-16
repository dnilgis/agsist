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
  // tabs are sticky now: jump the reader to the top of the fresh panel so a deep
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
/* calculator usage tracking: panel-level, once per session */
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
var ECO_TYPED={};   /* cost-builder boxes the reader typed in */
/* data/fertilizer-prices.json (scripts/build_fert_prices.py): each product's
   middle cash price posted by the co-ops Sig sent, nothing else. Every row
   names its co-ops, region and date, and every
   $/lb shown here says how it was worked out. Lime and K-Mag have no live
   source, so they are not priced here (the lime calculator takes your $/ton).
   AG.json (components/util.js) makes one request per file for the whole page. */
function getJSON(u){return (window.AG&&AG.json)?AG.json(u):fetch(u).then(function(r){if(!r.ok)throw new Error(r.status);return r.json();});}
/* Short source with its region: "Kansas co-ops, Oct 6" / "USDA Illinois, Oct 2". */
function fertShort(p){
  if(p&&p.short_label)return p.short_label;
  var d=p&&p.as_of?new Date(p.as_of+'T12:00:00'):null;
  var when=d&&!isNaN(d)?d.toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
  return (p&&p.src==='coop'?(p.region?p.region+' co-ops':'co-ops'):'USDA Illinois')+(when?', '+when:'');
}
function fertGrade(sym){if(!sym)return null;var a=String(sym).trim().split('-');if(a.length<3)return null;var n=parseFloat(a[0]),pp=parseFloat(a[1]),k=parseFloat(a[2]);if(isNaN(n)||isNaN(pp)||isNaN(k))return null;return {N:n,P:pp,K:k};}
/* The posted N rows by % N, for the N box at the top: {82:{row,price}, 46:...}. */
var N_POSTED={};
function esc(t){return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;');}
function loadFertPrices(){
  getJSON('/data/fertilizer-prices.json').then(function(data){
    if(!data||!data.prices)return;
    function key(k){return data.prices.find(function(p){return p.key===k&&p.price>0;})||null;}
    var el=document.getElementById('fert-date');
    if(el&&data.updated){var d=new Date(data.updated+'T12:00:00');el.textContent='Posted through '+d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+'. Co-op posted cash prices, each named with its region. Call to confirm.';
      if((Date.now()-d.getTime())/864e5>30){el.style.color='var(--gold)';}}
    var urea=key('urea'), potash=key('potash'), ams=key('ams'), phos=key('map')||key('dap'), aa=key('anhydrous');
    var wrap=document.getElementById('fert-pills');
    if(!wrap)return;
    wrap.innerHTML='';
    var pillDefs=[
      {obj:aa,     nut:'N', ncPct:'82', label:'N'},
      {obj:urea,   nut:'N', ncPct:'46', label:'N'},
      {obj:key('uan28'), nut:'N', ncPct:'28', label:'N'},
      {obj:key('uan32'), nut:'N', ncPct:'32', label:'N'},
      {obj:ams,    nut:'N', ncPct:'21', label:'N'},
      {obj:phos,   nut:'P', ncPct:'', label:'P2O5'},
      {obj:potash, nut:'K', ncPct:'', label:'K2O'}
    ];
    var deriv=[];
    pillDefs.forEach(function(pd){
      if(!pd.obj)return;
      var p=pd.obj, g=fertGrade(p.symbol); if(!g||!(g[pd.nut]>0))return;
      var pct=g[pd.nut]/100, pplb=(p.price/2000/pct);
      var price=Math.round(p.price);
      if(pd.nut==='N'&&pd.ncPct&&+pd.ncPct===g.N)N_POSTED[pd.ncPct]={row:p,price:price};
      deriv.push(p.name+' $'+price+' / (2,000 lb x '+g[pd.nut]+'% '+pd.label+') = $'+pplb.toFixed(2)+' a lb of '+pd.label+' ('+p.src_label+').');
      var btn=document.createElement('button');
      btn.className='fert-pill';
      btn.setAttribute('type','button');
      btn.setAttribute('aria-pressed','false');
      btn.setAttribute('aria-label',p.name+' $'+price+'/ton, '+p.src_label+': $'+pplb.toFixed(3)+'/lb '+pd.label);
      btn.innerHTML='<span class="fert-pill-body"><span class="fert-pill-name">'+esc(p.name)+'</span>'
        +'<span class="fert-pill-sym">'+esc(p.symbol)+' · '+esc(fertShort(p))+'</span></span>'
        +'<span class="fert-pill-price">$'+price+'</span>';
      btn.addEventListener('click',function(){
        document.querySelectorAll('.fert-pill').forEach(function(x){x.classList.remove('active');x.setAttribute('aria-pressed','false');});
        btn.classList.add('active');btn.setAttribute('aria-pressed','true');
        if(pd.nut==='N'&&pd.ncPct){
          setNForm(pd.ncPct,price);
          var top=document.getElementById('ff-ans');
          if(top&&top.scrollIntoView){try{top.scrollIntoView({behavior:'smooth',block:'start'});}catch(e){}}
        }
      });
      wrap.appendChild(btn);
    });
    var dv=document.getElementById('fert-deriv');
    if(!dv){
      var how=document.createElement('details');how.className='fert-how';
      how.innerHTML='<summary>How each $/lb is worked out</summary>';
      dv=document.createElement('ul');dv.id='fert-deriv';dv.className='fert-deriv';
      how.appendChild(dv);wrap.parentNode.insertBefore(how,wrap.nextSibling);
    }
    dv.innerHTML=deriv.map(function(x){return '<li>'+esc(x)+'</li>';}).join('');
    // The N box at the top starts on anhydrous when a co-op posts it, else urea.
    var first=N_POSTED['82']?'82':(N_POSTED['46']?'46':null);
    if(first){
      var fertSel=document.getElementById('nc-fert');
      var fpEl=document.getElementById('nc-fertprice');
      if(fpEl&&!nTyped&&(!fertSel||fertSel.value===first||!N_POSTED[fertSel.value]))setNForm(first,N_POSTED[first].price);
      else calcNC();
    } else calcNC();
    if(urea){
      var pplbU=urea.price/2000/0.46;
      loadNFertPrice(pplbU,'Urea 46% ('+fertShort(urea)+')',Math.round(urea.price));
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
  }).catch(function(){calcNC();});
}
function loadNFertPrice(pplb,name,ton){
  PRICES['N_PPLB']=pplb;
  var eup=document.getElementById('eco-urea-price');if(eup)eup.textContent='$'+ton;
  updateEcoCosts();
}
/* Pick an N form in the top box and fill its posted price (when there is one). */
function setNForm(pct,price){
  var fertSel=document.getElementById('nc-fert'), fpEl=document.getElementById('nc-fertprice');
  if(fertSel){for(var i=0;i<fertSel.options.length;i++){if(fertSel.options[i].value===String(pct)){fertSel.value=String(pct);break;}}}
  if(fpEl){fpEl.value=price!=null?price:'';}
  nTyped=false;
  calcNC();
}

/* ─── CORN PRICE FOR THE N RATIO ───────────────────────────────────────
   N bought now feeds next year's crop, so from August on the box uses
   next December's futures (this December's before August). The reader can
   add the median corn basis of AGSIST elevators in a state this week
   (data/basis-states.json), or type a price. */
var CORN={fut:null,label:'',date:'',nearby:null};
var BASIS={};          /* state code -> {name, median, n, label} */
var cornTyped=false, nTyped=false;
function newCropKey(now){
  var y=now.getFullYear(), m=now.getMonth();
  var yy=String((m>=7?y+1:y)%100); if(yy.length<2)yy='0'+yy;
  return {key:'corn-dec'+yy, label:"Dec '"+yy};
}
function loadGrainPrices(){
  getJSON('/data/prices.json').then(function(data){
    if(!data||!data.quotes)return;
    var q=data.quotes;
    function fmtGrain(v){return v!=null?AG.px.price(v):'--';}   /* components/util.js */
    var ecp=document.getElementById('eco-corn-price');
    if(q.corn&&q.corn.close){
      if(ecp)ecp.textContent=fmtGrain(q.corn.close);
      CORN.nearby=parseFloat(q.corn.close)/100;
      var elb=document.getElementById('eco-live-badge');if(elb)elb.style.display='inline-flex';
    }
    var nc=newCropKey(new Date()), row=q[nc.key];
    if(row&&row.close){CORN.fut=parseFloat(row.close)/100;CORN.label=nc.label;CORN.date=row.close_date||'';}
    else if(q.corn&&q.corn.close){CORN.fut=CORN.nearby;CORN.label='nearby';CORN.date=q.corn.close_date||'';}
    fillCorn();
    var ebp=document.getElementById('eco-bean-price');if(q.beans&&q.beans.close&&ebp)ebp.textContent=fmtGrain(q.beans.close); /* key is 'beans' in prices.json: 'soybeans' never existed, tile sat at "-" (fixed 2026-07-20) */
    var ewp=document.getElementById('eco-wheat-price');if(q.wheat&&q.wheat.close&&ewp)ewp.textContent=fmtGrain(q.wheat.close);
    updateEcoCosts();
  }).catch(function(){calcNC();});
}
function savedState(){
  try{var s=localStorage.getItem('agsist-ff-state');if(s!==null)return s;}catch(e){}
  try{var w=JSON.parse(localStorage.getItem('agsist-wx-loc')||'{}');if(w&&/^[A-Z]{2}$/.test(w.state||''))return w.state;}catch(e){}
  return '';
}
function loadBasis(){
  getJSON('/data/basis-states.json').then(function(d){
    var sel=document.getElementById('ans-state');
    if(!d||!d.states||!sel)return;
    var codes=Object.keys(d.states).filter(function(c){var cr=d.states[c].crops&&d.states[c].crops.corn;return cr&&cr.median!=null&&cr.n>=(d.min_n||3);});
    codes.sort(function(a,b){return d.states[a].name<d.states[b].name?-1:1;});
    codes.forEach(function(c){
      var st=d.states[c], cr=st.crops.corn;
      BASIS[c]={name:st.name, median:cr.median, n:cr.n, label:cr.label};
      var o=document.createElement('option');o.value=c;o.textContent=st.name;sel.appendChild(o);
    });
    var pick=savedState();
    if(pick&&BASIS[pick])sel.value=pick;
    fillCorn();
  }).catch(function(){});
}
function fillCorn(){
  var box=document.getElementById('nc-corn');
  if(box&&!cornTyped&&CORN.fut!=null){
    var st=document.getElementById('ans-state'), b=st&&BASIS[st.value];
    box.value=(CORN.fut+(b?b.median:0)).toFixed(2);
  }
  calcNC();
}

/* ─── STRIP + WEEK CARD ─────────────────────────────────────────────── */
(function(){
  function isoWeekNow(){
    var d=new Date(), t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
    t.setUTCDate(t.getUTCDate()+4-(t.getUTCDay()||7));
    var y0=new Date(Date.UTC(t.getUTCFullYear(),0,1));
    return Math.ceil(((t-y0)/864e5+1)/7);
  }
  getJSON('/data/prices.json').catch(function(){return null;}).then(function(pj){
    var q=pj&&pj.quotes?pj.quotes:{};
    function g(id){return document.getElementById(id);}
    function dollarsBu(v){return v!=null?'$'+(parseFloat(v)/100).toFixed(2):null;}
    var corn=q.corn&&q.corn.close?parseFloat(q.corn.close)/100:null;
    var beans=q.beans&&q.beans.close?dollarsBu(q.beans.close):null;
    var wheat=q.wheat&&q.wheat.close?dollarsBu(q.wheat.close):null;
    if(corn||beans||wheat){
      if(corn) g('fft-corn').textContent='$'+corn.toFixed(2);
      if(beans) g('fft-beans').textContent=beans;
      if(wheat) g('fft-wheat').textContent=wheat;
      g('ff-strip').hidden=false;
    }
    // week card: what most of the Corn Belt is doing, hedged
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
      42:['harvest wrap-up','Soil sampling season: plan P and K from the new tests.',['pk']]
    };
    var pick=null; for(var k in W){ if(wk>=+k&&wk<=+k+1) pick=W[k]; }
    if(pick){
      var lt={pest:'Thresholds &rarr;',pk:'P and K by soil test &rarr;'}[pick[2][0]]||'Stage guide &rarr;';
      var link='<a href="#'+pick[2][0]+'" data-jump="'+pick[2][0]+'">'+lt+'</a>';
      g('ffw-num').textContent='WEEK '+wk;
      g('ffw-txt').innerHTML='Most of the Corn Belt: <strong>'+pick[0]+'</strong>. '+pick[1]+' '+link;
      g('ff-week').hidden=false;
    }
    bindJumps();
  });
})();
/* jump links switch the tab properly (hash alone only works on first load) */
function bindJumps(){
  document.querySelectorAll('[data-jump]').forEach(function(a){
    if(a._ffj)return;a._ffj=1;
    a.addEventListener('click',function(e){
      var b=document.getElementById('tab-btn-'+a.getAttribute('data-jump'));
      if(b){ e.preventDefault(); b.click(); }
    });
  });
}
bindJumps();

/* ─── CORN N RATE AT POSTED PRICES (top box) ───────────────────────────
   N:corn ratio = $/lb N / $/bu corn; the rate is the A2809 Table 6.1 cell
   (components/a2809.js) for the soil, the last crop and the nearest
   printed ratio column. */
function rowKey(){
  var soil=(document.getElementById('ans-soil')||{}).value||'hi';
  var prev=(document.getElementById('ans-prev')||{}).value||'soy';
  if(soil==='sand_irr'||soil==='sand_dry')return soil;
  return soil+'_'+(prev==='corn'?'corn':'soy');
}
function money(v){return '$'+(Math.round(v*100)/100).toFixed(2);}
function calcNC(){
  function g(id){return document.getElementById(id);}
  function t(id,v){var e=g(id);if(e)e.textContent=v;}
  var fertSel=g('nc-fert');if(!fertSel)return;
  var corn=parseFloat(g('nc-corn').value)||0;
  // The Custom option carries value="0", and 0 is falsy, so `||46` swallowed it and
  // the next line could never fire. Every custom blend was priced as urea at 46% N.
  var isCustom=fertSel.value==='0';
  var pct=isCustom?parseFloat(g('nc-custom-pct').value):parseFloat(fertSel.value);
  if(!isFinite(pct)||pct<=0)pct=isCustom?0:46;
  g('nc-custom-wrap').style.display=isCustom?'flex':'none';
  var soilSel=g('ans-soil'), prevSel=g('ans-prev');
  var sandy=soilSel&&/^sand/.test(soilSel.value);
  if(prevSel){prevSel.disabled=!!sandy;prevSel.title=sandy?'A2809 uses one rate for all previous crops on sands':'';}
  var fall=g('ans-fall');if(fall){var m=new Date().getMonth();fall.hidden=!(fertSel.value==='82'&&m>=8&&m<=10);}
  var ton=parseFloat(g('nc-fertprice').value)||0;
  ['nth-05','nth-10','nth-15','nth-20'].forEach(function(id){var th=g(id);if(th)th.classList.remove('act');});
  document.querySelectorAll('#nc-table td.act').forEach(function(td){td.classList.remove('act');});
  if(!(ton>0)||!(pct>0)){
    // No posted price for this form and none typed: say so rather than price at a made-up number.
    t('nc-nlb','-');t('nc-ratio','-');t('nc-col','-');t('ans-rate','-');t('ans-range','');t('ans-cost','');
    t('ans-line',ton>0?'Type the % N of your product.':'Type your N price per ton (a co-op posted price fills in when there is one for this form).');
    t('ans-src','');
    return;
  }
  var pplb=ton/(2000*pct/100);
  t('nc-nlb','$'+pplb.toFixed(2));
  if(!(corn>0)){
    t('nc-ratio','-');t('nc-col','-');t('ans-rate','-');t('ans-range','');t('ans-cost','');
    t('ans-line','Type your corn price per bushel.');t('ans-src','');
    return;
  }
  var ratio=pplb/corn;
  var A=window.AgA2809, r=A?A.nRate({row:rowKey(),ratio:ratio}):null;
  t('nc-ratio',ratio.toFixed(3));
  if(!r){t('nc-col','-');return;}
  var colTxt=r.col.toFixed(2);
  t('nc-col',colTxt);
  var thId='nth-'+colTxt.replace('0.','');var th=g(thId);if(th)th.classList.add('act');
  var ci=A.N_RATIOS.indexOf(r.col);
  var tr=document.querySelector('#nc-table tr[data-row="'+rowKey()+'"]');
  if(tr&&tr.children[ci+1])tr.children[ci+1].classList.add('act');
  t('ans-rate',String(r.rate));
  ecoFill('eco-n-rate',r.rate);ecoFill('eco-n-pplb',pplb.toFixed(2));
  if(!ECO_TYPED['eco-n-pplb']){var nl=g('eco-n-source-label');if(nl)nl.textContent=(isCustom?pct+'% N':fertSel.options[fertSel.selectedIndex].text)+' at $'+Math.round(ton)+'/ton';}
  if(typeof updateEcoCosts==='function')updateEcoCosts();
  t('ans-range','Profitable range '+r.lo+'–'+r.hi);
  t('ans-cost','N cost $'+Math.round(r.rate*pplb)+'/ac at '+money(pplb)+'/lb');
  var form=isCustom?(pct+'% N product'):fertSel.options[fertSel.selectedIndex].text.replace('Amm. nitrate','Ammonium nitrate');
  var WHO={hi_corn:'corn after corn or a forage legume on high-yield loamy soil',hi_soy:'corn after soybeans or small grain on high-yield loamy soil',
    med_corn:'corn after corn or a forage legume on medium-yield loamy soil',med_soy:'corn after soybeans or small grain on medium-yield loamy soil',
    sand_irr:'corn on irrigated sand, any previous crop',sand_dry:'corn on dryland sand, any previous crop'};
  var line=form+' at $'+Math.round(ton)+'/ton is '+money(pplb)+' a lb of N. Against $'+corn.toFixed(2)+' corn that is a '+ratio.toFixed(3)+' ratio, so A2809’s '+colTxt+' column: '+r.rate+' lb N for '+WHO[rowKey()]+'.';
  if(r.off)line+=' Your ratio is past the table’s '+(ratio<0.05?'0.05':'0.20')+' end, so this is the nearest column, not a reading off the chart.';
  t('ans-line',line);
  // Where each number came from.
  var src=[];
  var posted=N_POSTED[fertSel.value];
  if(!nTyped&&posted&&Math.round(ton)===posted.price)src.push(form+': '+posted.row.src_label);
  else src.push('N price: yours');
  var st=g('ans-state'), b=st&&BASIS[st.value];
  if(cornTyped)src.push('corn price: yours');
  else if(CORN.fut!=null){
    var cl=(CORN.label==='nearby'?'nearby':CORN.label)+' corn futures $'+CORN.fut.toFixed(2)+(CORN.date?', CBOT close '+fmtDay(CORN.date):'')+', delayed';
    if(b)cl+=(b.median<0?' less ':' plus ')+'$'+Math.abs(b.median).toFixed(2)+', the median '+b.name+' corn basis this week ('+b.n+' elevators, against '+b.label+')';
    src.push(cl);
  }
  t('ans-src',src.join(' · '));
}
function fmtDay(iso){var d=new Date(iso+'T12:00:00');return isNaN(d)?iso:d.toLocaleDateString('en-US',{month:'short',day:'numeric'});}
['nc-fertprice','nc-custom-pct'].forEach(function(id){
  var el=document.getElementById(id);if(el)el.addEventListener('input',function(){if(id==='nc-fertprice')nTyped=true;calcNC();});
});
(function(){
  var fs=document.getElementById('nc-fert');
  if(fs)fs.addEventListener('change',function(){var p=N_POSTED[fs.value];setNForm(fs.value,p?p.price:null);});
  var cb=document.getElementById('nc-corn');
  if(cb)cb.addEventListener('input',function(){cornTyped=cb.value!=='';if(!cornTyped)fillCorn();else calcNC();});
  var st=document.getElementById('ans-state');
  if(st)st.addEventListener('change',function(){try{localStorage.setItem('agsist-ff-state',st.value);}catch(e){}cornTyped=false;fillCorn();});
  ['ans-soil','ans-prev'].forEach(function(id){var e=document.getElementById(id);if(e)e.addEventListener('change',calcNC);});
})();
loadFertPrices();
loadGrainPrices();
loadBasis();
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
  var blank=['eco-seed','eco-chem','eco-rent','eco-other'].filter(function(id){var e=document.getElementById(id);return e&&e.value==='';}).length;
  var te=document.getElementById('eco-total');if(te)te.textContent='$'+total.toFixed(2)+'/ac'+(blank?' so far':'');
  if(PRICES['DAP_PPLB']){
    var pkOut=document.getElementById('pk-cost-out');
    if(pkOut){pkOut.style.display='flex';}
  }
  updateSTCost();
}
/* Boxes the reader typed in keep their number; the rest follow the N box
   and the corn soil test. ECO_TYPED is declared with PRICES, above. */
['eco-n-rate','eco-n-pplb','eco-p-rate','eco-p-pplb','eco-k-rate','eco-k-pplb','eco-seed','eco-chem','eco-rent','eco-other'].forEach(function(id){
  var el=document.getElementById(id);if(el)el.addEventListener('input',function(){ECO_TYPED[id]=el.value!=='';updateEcoCosts();});
});
function ecoFill(id,v){var el=document.getElementById(id);if(el&&!ECO_TYPED[id]&&v!=null)el.value=v;}

/* ─── SOIL TEST INTERPRETER ──────────────────────────────────────── */
/* UW A2809 Tables 7.1, 7.2 and 7.4 (components/a2809.js, the one copy of
   those numbers). The categories depend on the crop's demand level, the
   highest-demand crop in the rotation and the soil group; the rate on the
   crop's own yield row. */
var ST_YIELD={corn:200,soybean:60,corn_silage:25,alfalfa:5,alfalfa_seeding:2};
var stLastCrop=null;
function calcST(){
  var A=window.AgA2809;if(!A)return;
  var cropEl=document.getElementById('st-crop');
  var crop=cropEl.value||'corn';
  var c=A.CROPS[crop];if(!c)return;
  var yEl=document.getElementById('st-yield');
  if(stLastCrop!==null&&stLastCrop!==crop){yEl.value=ST_YIELD[crop];}
  stLastCrop=crop;
  var yl=document.getElementById('st-yield-unit');if(yl)yl.textContent=c.unit==='ton'?'ton/ac':'bu/ac';
  yEl.step=c.unit==='ton'?'0.5':'5';
  var soilEl=document.getElementById('st-soil'), rotEl=document.getElementById('st-rot');
  var pv=document.getElementById('st-p').value, kv=document.getElementById('st-k').value;
  var r=A.pk({crop:crop,yieldGoal:parseFloat(yEl.value),p:pv===''?'':parseFloat(pv),k:kv===''?'':parseFloat(kv),
    soil:soilEl?soilEl.value:'loamy',rotation:rotEl?parseInt(rotEl.value,10):1});
  function s(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
  if(!r){
    s('st-pcat','-');s('st-kcat','-');s('st-prec','-');s('st-krec','-');
    s('st-note','Type a yield goal and both soil tests to see the A2809 rate.');
    updateSTCost(0,0);return;
  }
  s('st-pcat',r.pCatName);
  s('st-kcat',r.kCatName);
  if(crop==='corn'){ecoFill('eco-p-rate',r.p2o5);ecoFill('eco-k-rate',r.k2o);}
  s('st-prec',r.p2o5+' lb/ac');
  s('st-krec',r.k2o+' lb/ac');
  var n=[];
  n.push('A2809 demand level '+r.demand+', '+(r.soil==='sandy'?'sandy or organic':'loamy')+' soil, '+r.cropName.toLowerCase()+' '+r.rowLabel+' row.');
  if(r.aboveTable)n.push('Your yield goal is above A2809\u2019s top row, so this is the top row\u2019s rate. A2809 adds crop removal for yields past its table.');
  if(r.belowTable)n.push('Your yield goal is below A2809\u2019s lowest row, so this is the lowest row\u2019s rate.');
  if(r.pCat==='VL'||r.pCat==='L')n.push('Low P: the rate includes build-up over 4 to 8 years.');
  if(r.kCat==='VL'||r.kCat==='L')n.push('Low K: the rate includes build-up over 4 to 8 years.');
  if(r.pCat==='H')n.push('High P: half the optimum rate.');
  if(r.pCat==='EH')n.push('Excessively high P: A2809 says apply none.');
  if(r.kCat==='EH')n.push('Excessively high K: A2809 says apply none.');
  if(crop==='corn'&&(r.pCat==='EH'||r.kCat==='EH'))n.push('Corn may still pay for up to 20 lb each of P\u2082O\u2085 and K\u2082O as starter (A2809 Chapter 10).');
  if(r.kNote)n.push('Keeping the stand more than 3 years? A2809 says raise topdressed K\u2082O by 20%.');
  if(crop==='alfalfa'||crop==='corn_silage')n.push('Whole-plant harvest pulls a lot of K: retest every 2 years.');
  s('st-note',n.join(' '));
  updateSTCost(r.p2o5,r.k2o);
}
function updateSTCost(prec,krec){
  var pEl=document.getElementById('st-prec');var kEl=document.getElementById('st-krec');
  var p=prec!=null?prec:(parseFloat((pEl&&pEl.textContent)||'0')||0);
  var k=krec!=null?krec:(parseFloat((kEl&&kEl.textContent)||'0')||0);
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
['st-crop','st-yield','st-p','st-k','st-soil','st-rot'].forEach(function(id){var el=document.getElementById(id);if(el){el.addEventListener('input',calcST);el.addEventListener('change',calcST);}});
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
/* UW A2809 Table 5.1 (water pH and buffer pH), Table 5.2 (plow depth) and its
   rounding, minimum and maximum rules, all in components/a2809.js. */
function calcLime(){
  var A=window.AgA2809;if(!A)return;
  function v(id){var el=document.getElementById(id);return el?el.value:'';}
  var niSel=v('lime-ni');
  document.getElementById('lime-ni-wrap').style.display=niSel==='custom'?'flex':'none';
  var ni=niSel==='custom'?parseFloat(v('lime-ni-custom')):parseFloat(niSel);
  var r=A.lime({wph:parseFloat(v('lime-wph')),bph:parseFloat(v('lime-buf')),target:parseFloat(v('lime-target')),
    ni:ni,depth:parseInt(v('lime-depth'),10)||7,sandyLowOM:v('lime-soil')==='sandy'});
  function s(id,t){var el=document.getElementById(id);if(el)el.textContent=t;}
  var costEl=document.getElementById('lime-cost');
  function fmtT(t){return (t%1===0?t.toFixed(0):t.toFixed(1))+' ton';}
  if(!r){
    s('lime-base','-');s('lime-ag','-');s('lime-note','Type water pH, buffer pH and the lime\u2019s NI.');
    if(costEl){costEl.textContent='-';costEl.style.color='var(--text-muted)';}
    return;
  }
  var note;
  if(!r.need){
    s('lime-base','0 ton');s('lime-ag','0 ton');
    note='No lime: pH not more than 0.2 below target';
  } else {
    s('lime-base',fmtT(r.base60));
    s('lime-ag',fmtT(r.tons));
    if(r.capped)note='Capped at 12 ton (A2809 max). Retest in 2\u20133 yrs';
    else if(r.rule==='sandy')note='1 ton: sand under 1% OM (A2809)';
    else if(r.rule==='min')note='A2809 minimum rate (formula is lower)';
    else note='Rounded as A2809 says';
  }
  s('lime-note',note);
  if(costEl){
    // Lime has no live price source, so it is priced only at the reader's own $/ton.
    var own=parseFloat(v('lime-price'));
    costEl.style.color='var(--gold)';
    if(!r.need){
      costEl.textContent='None needed';costEl.style.color='var(--text-muted)';
    } else if(own>0){
      costEl.textContent='$'+(r.tons*own).toFixed(0)+'/ac at your $'+own+'/ton';
    } else {
      costEl.textContent='Type your $/ton to see cost';costEl.style.color='var(--text-muted)';
    }
  }
}
['lime-wph','lime-buf','lime-target','lime-ni','lime-ni-custom','lime-depth','lime-soil','lime-price'].forEach(function(id){var el=document.getElementById(id);if(el){el.addEventListener('input',calcLime);el.addEventListener('change',calcLime);}});
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
  // The site's one stage table (components/gdu-stages.js), GDU from planting.
  var G=window.AgGduStages;
  function stage(list,first){if(!G)return '-';var st=G.stageAt(list,newAcc);return st?st.s:first;}
  s('gdu-corn-stage',stage(G&&G.corn,'Before emergence'));
  s('gdu-bean-stage',stage(G&&G.bean,'Before emergence'));
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

/* ─── CROP STAGES TIMELINE ──────────────────────────────────────────── */
var stagesInited=false;
function initStages(){
  if(stagesInited)return;stagesInited=true;
  /* GDU numbers come from components/gdu-stages.js (the table /gdu-calculator
     uses). Only the notes below are this page's own, by stage name. */
  var CORN_NOTES={
    VE:['Coleoptile through the soil surface.','Check soil temp \u226550\u00b0F. Scout for stand establishment and black cutworm.'],
    V2:['2nd leaf collar visible. Growing point still below soil.','Count stand. Black cutworm: treat at 5% of plants damaged with larvae 6th instar or smaller (UW L023).'],
    V4:['4th leaf collar. Ear shoots being started.','Side-dress N window: V4\u2013V6.'],
    V6:['Growing point above soil.','Side-dress window closing. Post herbicide cutoffs on many labels: read yours.'],
    V8:['8 leaf collars. Kernel row number being set.','Scout for European corn borer. Fungicide watch if conditions favor disease.'],
    V10:['10 collars. Rapid growth.','Heavy N and K uptake. Make sure K is adequate for stalk strength.'],
    V12:['12 collars. Ear size being set.','Scout gray leaf spot on lower leaves.'],
    VT:['Tassel fully out. Pollen shed.','Critical pollination window. Corn rootworm adults: 5+/plant in the first week of pollen shed. Japanese beetle: 3+/ear with silks clipped under 1".'],
    R1:['Silking. Silks outside the husk. Pollination.','Drought or heat stress now costs yield. Watch silk clipping.'],
    R2:['Blister. Kernels white, fluid-filled.','Drought stress still damaging. Kernel number now fixed.'],
    R4:['Dough. Kernel contents doughy.','About half of final dry weight in. Stalks cannibalize if N or K is short.'],
    R5:['Dent. Kernels dented, milk line showing.','Watch for stalk rots and Diplodia ear rot. Plan harvest order.'],
    'R5.5':['Full dent, milk line moving down.','Silage harvest window opens.'],
    R6:['Black layer. Kernel dry weight at its most.','Moisture near 30\u201335%. Moisture checks beat calendar dates for harvest order.']
  };
  var BEAN_NOTES={
    VE:['Unifoliate leaves through the soil.','Check stand. Seedcorn maggot or pythium risk in cold wet soils.'],
    V1:['First trifoliate open.','Bean leaf beetle and slug activity.'],
    V3:['Third trifoliate.','Post herbicide cutoffs are set by the label. Iron deficiency chlorosis shows on high-pH soils.'],
    V5:['Fifth trifoliate. Branching.','Start regular soybean aphid counts.'],
    R1:['Beginning bloom. One open flower on any node.','Soybean aphid: 250/plant on over 80% of plants, increasing.'],
    R2:['Full bloom.','White mold fungicide window in susceptible varieties under wet weather: R1\u2013R3.'],
    R3:['Beginning pod. 3/16" pod on one of the top 4 nodes.','Yield-forming stretch. Aphid threshold still applies.'],
    R4:['Full pod. 3/4" pod on one of the top 4 nodes.','Aphid threshold still applies. Pod feeding raises yield loss.'],
    R5:['Beginning seed. 1/8" seed in a pod on one of the top 4 nodes.','Last stage the 250/plant aphid threshold covers. Spider mite watch in dry heat.'],
    R6:['Full seed. A green seed fills the pod cavity.','Harvest planning begins.'],
    R7:['Beginning maturity. One mature-color pod on the main stem.',''],
    R8:['Full maturity. 95% of pods at mature color.','Shatter losses climb when ripe beans wait in the field.']
  };
  var G=window.AgGduStages;
  if(!G)return;
  function vis(list,notes){return list.map(function(st){var n=notes[st.s]||[st.desc,''];return {s:st.s,gdu:st.gdu,hi:st.hi,key:st.key,desc:n[0],mgmt:n[1]};});}
  var CORN_VIS=vis(G.corn,CORN_NOTES), BEAN_VIS=vis(G.bean,BEAN_NOTES);
  function buildTimeline(wrapId,markId,detailId,stages){
    var marks=document.getElementById(markId);var detail=document.getElementById(detailId);
    if(!marks||!detail)return;
    marks.innerHTML='';
    stages.forEach(function(st,i){
      var div=document.createElement('div');
      div.className='sv-mark'+(st.key?' key':'');
      div.setAttribute('role','button');div.setAttribute('tabindex','0');
      var g=st.hi?st.gdu+'\u2013'+st.hi:String(st.gdu);
      div.setAttribute('aria-label',st.s+', '+g+' GDU from planting');
      div.innerHTML='<div class="sv-dot"></div><div class="sv-lbl">'+st.s+'</div><div class="sv-gdu">'+st.gdu+(st.hi?'+':'')+'</div>';
      div.addEventListener('click',function(){
        document.querySelectorAll('#'+markId+' .sv-mark').forEach(function(m){m.classList.remove('active');});
        div.classList.add('active');
        detail.innerHTML='<div class="sv-detail-stage">'+st.s+'</div>'
          +'<div class="sv-detail-gdu">~'+g+' GDUs from planting (86/50 method)</div>'
          +'<div class="sv-detail-desc">'+st.desc+'</div>'
          +(st.mgmt?'<div class="sv-detail-mgmt"><svg class="ic" aria-hidden="true"><use href="#i-triangle-alert"/></svg> '+st.mgmt+'</div>':'');
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

})();
