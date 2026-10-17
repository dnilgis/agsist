/* Homepage: the yield nowcast, the futures cards' 52-week ranges and their trading-hours labels. Moved out of index.html (2026-10-11) so the page is lighter and this caches between visits; loaded as a plain script in the same place, so it runs in the same order as before. */
(function() {
  'use strict';
  /* USDA's weather-adjusted 2026 corn trend, 183.0 bu/ac: Feb 19, 2026 Outlook
     Forum, kept in the May 2026 WASDE. The same figure and source as
     USDA_TREND in scripts/bake_crop_size.py (/conditions-yield); change both.
     No soybean figure until one is checked at the source. */
  var USDA_TREND={corn:183.0};
  function loadYieldNowcast(){
    fetch('/data/yield-nowcast.json').then(function(r){if(!r.ok)throw new Error('no-nowcast');return r.json();}).then(function(d){
      if(!d||!d.crops)throw new Error('no-nowcast');
      var map={corn:'nc-corn',soybeans:'nc-beans'};
      var above=0,below=0;
      Object.keys(map).forEach(function(crop){
        var c=d.crops[crop];
        /* A crop missing from the file: its box hides rather than print "--". */
        if(!c||typeof c.nowcast!=='number'){var _bx=document.getElementById(map[crop]);if(_bx&&_bx.parentNode)_bx.parentNode.style.display='none';return;}
        var el=document.getElementById(map[crop]);
        var bd=document.getElementById(map[crop]+'-band');
        var vs=document.getElementById(map[crop]+'-vs');
        if(el)el.textContent=c.nowcast.toFixed(1);
        if(bd)bd.textContent=typeof c.band80==='number'?c.band80.toFixed(1):'';
        var diff=c.nowcast-c.trend;
        if(diff>0.4)above++; else if(diff<-0.4)below++;
        /* r7-bids 7b: the headline is the difference from USDA (filled below
           from data/wasde.json). The trend is AGSIST's own linear fit on the
           backtest years (scripts/build_yield_nowcast.py), and says so. */
        if(vs){vs.textContent='USDA estimate not loaded yet';vs.style.color='var(--text-muted)';
          var tl=document.getElementById(map[crop]+'-trend');
          if(!tl){tl=document.createElement('div');tl.id=map[crop]+'-trend';tl.className='r7-nc-usda';vs.parentNode.insertBefore(tl,vs.nextSibling);}
          /* The line is fit on trend_window (2010-2025, 16 finals), not on the
             backtest years, so it is labeled by its window, as on
             /conditions-yield. USDA's own trend sits beside it where we have
             one checked at the source (USDA_TREND below). */
          var tw=c.trend_window?' ('+String(c.trend_window).replace('-','\u2013')+' finals)':'';
          var ut=USDA_TREND[crop];
          tl.textContent='Our straight-line trend: '+c.trend.toFixed(1)+tw+(typeof ut==='number'?' \u00b7 USDA\u2019s trend: '+ut.toFixed(1):'')+(typeof c.mae==='number'?' \u00b7 backtest miss averages '+c.mae.toFixed(1)+' bu':'');}
      });
      var v=document.getElementById('nc-verdict');
      if(v){v.className='ratio-verdict neutral';v.textContent='USDA not loaded yet';}
      fetch('/data/wasde.json',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(w){if(!w||!w.metrics)return;
        var rel=w.release?new Date(w.release+'T12:00:00'):null,rs=rel&&!isNaN(rel)?rel.toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
        var ab=0,bl=0,n=0;
        [['corn_yield','corn','nc-corn'],['soy_yield','soybeans','nc-beans']].forEach(function(p){var m=null;w.metrics.forEach(function(x){if(!m&&String(x.key).indexOf(p[0])===0&&typeof x.value==='number')m=x;});
          var vs=document.getElementById(p[2]+'-vs'),c=d.crops[p[1]];if(!m||!vs||!c)return;
          var df=Math.round((c.nowcast-m.value)*10)/10,bd=(typeof c.band80==='number'&&c.band80>0)?c.band80:0.4;n++;if(df>bd)ab++;else if(df<-bd)bl++;
          vs.style.color='var(--text-dim)';
          vs.textContent=(Math.abs(df)<0.05?'Even with':(Math.abs(df).toFixed(1)+' bu '+(df>0?'above':'below')))+' USDA\u2019s '+(rs?rs+' ':'')+'estimate ('+m.value.toFixed(1)+')';});
        if(v&&n){v.textContent=ab&&!bl?'Above USDA':bl&&!ab?'Below USDA':'Near USDA';}
      }).catch(function(){});
      var wk=document.getElementById('nc-week');
      if(wk&&d.crops.corn){
        var _wkEnd=d.crops.corn.week_ending;
        var _rd=/^\d{4}-\d{2}-\d{2}$/.test(String(_wkEnd))?new Date(_wkEnd+'T12:00:00'):new Date(_wkEnd);
        var _daysOld=(_rd&&!isNaN(_rd.getTime()))?Math.round((Date.now()-_rd.getTime())/86400000):null;
        var _age=_daysOld==null?'':_daysOld<=13?'':' <svg class="ic" aria-hidden="true"><use href="#i-triangle-alert"/></svg> '+_daysOld+'d old';
        /* r7-bids: dates as "Sep 20, 2026", and say when the ratings week trails the latest Crop Progress week. */
        var _wkTxt=function(s){var d=new Date(s+'T12:00:00');return isNaN(d)?s:d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});};
        wk.innerHTML='Ratings week ending '+_wkTxt(_wkEnd)+' \u00b7 updates Tuesdays'+_age;
        AG.json('/data/crop-progress.json').catch(function(){return null;}).then(function(cp){
          if(!cp||!/^\d{4}-\d{2}-\d{2}$/.test(String(cp.report_date))||!/^\d{4}-\d{2}-\d{2}$/.test(String(_wkEnd)))return;
          var n=Math.round((new Date(cp.report_date+'T12:00:00')-new Date(_wkEnd+'T12:00:00'))/6048e5);
          if(n>=1)wk.innerHTML='Ratings week ending '+_wkTxt(_wkEnd)+', '+(n===1?'one week':n+' weeks')+' behind Crop Progress ('+_wkTxt(cp.report_date)+')'+_age;
        }).catch(function(){});
        if(_daysOld!=null&&_daysOld>=14){wk.style.color='#f0913a';}
      }
      var yr=document.getElementById('nc-years');
      if(yr&&d.crops.corn)yr.textContent=d.crops.corn.backtest_years;
    }).catch(function(){
      var v=document.getElementById('nc-verdict');
      if(v){v.className='ratio-verdict neutral';v.textContent='Data unavailable';}
      var wk=document.getElementById('nc-week');
      if(wk){wk.textContent='Could not load this week\u2019s ratings.';wk.style.color='';}
      /* No numbers to show: the two "--" boxes hide; the line above says why. */
      var _g=document.getElementById('nc-corn');_g=_g&&_g.parentNode&&_g.parentNode.parentNode;if(_g&&_g.style)_g.style.display='none';
    });
  }
  loadYieldNowcast();
  function blankRanges(){
    // The dollar figures baked into the markup are a year old and only rot.
    // If the live file cannot be read, show nothing rather than a confident
    // wrong bar.
    var rs=document.querySelectorAll('.pc-range');
    for(var i=0;i<rs.length;i++)rs[i].style.visibility='hidden';
  }
  /* Reads the rendered cards rather than the feed: the two cards are fed by
     different keys and a symbol match in the data would not prove the reader
     is looking at the same two numbers. */
  var FORWARD_YEAR={
    'corn-dec':{dataKey:'corn-dec27',rangeId:'corn-dec',sym:'corn-dec',label:"Dec '27",tick:"Corn Dec '27"},
    'bean-nov':{dataKey:'beans-nov27',rangeId:'beans-nov',sym:'beans-nov',label:"Nov '27",tick:"Soybeans Nov '27"}
  };
  function applyForwardYear(domSuffix,fwd){
    var q=window.AGSIST_PRICE_DATA||{};
    var fq=q[fwd.dataKey];
    if(!fq||fq.close==null||fq.wk52_lo==null||fq.wk52_hi==null)return false;
    if(typeof fmtPrice!=='function'||typeof fmtChange!=='function')return false;
    var priceEl=document.getElementById('pcp-'+domSuffix);
    var chgEl=document.getElementById('pcc-'+domSuffix);
    var prevEl=document.getElementById('pcprev-'+domSuffix);
    if(!priceEl||!chgEl)return false;
    priceEl.textContent=fmtPrice(fq.close,2,true);
    var chgObj=fmtChange(fq.close,fq.open,true,fq.netChange,fq.pctChange);
    chgEl.textContent=chgObj.text;
    chgEl.className='pc-chg-val '+chgObj.cls;
    if(prevEl&&fq.open!=null)prevEl.textContent='prev: '+fmtPrice(fq.open,2,true)+' '+(fq.ticker||'');
    var lo=fq.wk52_lo/100,hi=fq.wk52_hi/100,cl=fq.close/100;
    if(hi>lo){
      var pct=Math.max(0,Math.min(100,((cl-lo)/(hi-lo))*100));
      var elLo=document.getElementById('pcrl-'+fwd.rangeId+'-lo'), elHi=document.getElementById('pcrl-'+fwd.rangeId+'-hi');
      var elF=document.getElementById('pcrf-'+fwd.rangeId), elD=document.getElementById('pcrd-'+fwd.rangeId);
      var fr=AG.px.range(fq.wk52_lo,fq.wk52_hi,{style:'slash'});
      if(elLo)elLo.textContent=fr.lo;
      if(elHi)elHi.textContent=fr.hi;
      if(elF)elF.style.width=pct.toFixed(1)+'%';
      if(elD)elD.style.left=pct.toFixed(1)+'%';
    }
    /* The ticker carries the same contract under the same key. Roll every
       copy (rebuildTickerLoop clones the strip) so the strip does not read
       "Corn Dec '26 $5.01" beside "Corn (front) $5.01". */
    if(typeof fmtTickerPrice==='function'&&typeof fmtTickerChange==='function'){
      var tp=fmtTickerPrice(fq.close,true,2), tc=fmtTickerChange(fq.close,fq.open,true,fq.netChange,fq.pctChange);
      document.querySelectorAll('[data-sym="'+fwd.sym+'"]').forEach(function(el){
        var le=el.querySelector('.t-label'), pe=el.querySelector('.t-price'), ce=el.querySelector('.t-chg');
        if(le)le.textContent=fwd.tick;
        if(pe)pe.textContent=tp;
        if(ce){ce.textContent=tc.text;ce.className='t-chg '+tc.cls;}
      });
    }
    return true;
  }
  /* 2026-10-01: when the front-month and this-year's-harvest contract are
     the same contract (true for corn/beans from early fall through year end),
     this used to hide the second tile and append "+ new crop" to the first.
     Sig's call: never drop to one tile for corn or beans -- when that
     happens, swap the second tile to NEXT year's harvest contract
     (corn-dec27 / beans-nov27) instead, so the reader always sees two real,
     distinct corn (or bean) prices. Both symbols are already fetched live by
     scripts/fetch_prices.py into data/prices.json -- no new data source. */
  function collapseSameContract(){
    [['corn-near','corn-dec'],['bean-near','bean-nov']].forEach(function(pair){
      var a=document.getElementById('pcp-'+pair[0]), b=document.getElementById('pcp-'+pair[1]);
      var ap=document.getElementById('pcprev-'+pair[0]), bp=document.getElementById('pcprev-'+pair[1]);
      if(!a||!b||!ap||!bp)return;
      var at=(a.textContent||'').trim(), bt=(b.textContent||'').trim();
      var as=(ap.textContent||'').trim(), bs=(bp.textContent||'').trim();
      var card=b.parentNode;
      while(card&&card!==document.body&&(' '+(card.className||'')+' ').indexOf(' pc ')<0)card=card.parentNode;
      if(!card||card===document.body)return;
      var same=at&&at!=='--'&&at===bt&&as&&as===bs;
      var fwd=FORWARD_YEAR[pair[1]];
      var swapped=(same&&fwd)?applyForwardYear(pair[1],fwd):false;
      card.style.display=(same&&!swapped)?'none':'';
      var keep=a.parentNode;
      while(keep&&keep!==document.body&&(' '+(keep.className||'')+' ').indexOf(' pc ')<0)keep=keep.parentNode;
      var lbl=keep&&keep.querySelector?keep.querySelector('.pc-contract'):null;
      if(lbl){
        /* geo.js names the contract on this chip ("Dec '26 - nearby") after
           prices load. The old code cached the chip's FIRST text ("Front
           Month") and wrote it back on every re-run, so the contract name
           never survived. Only the suffix is ours; the base is whatever is
           on the chip right now. */
        var NEW_CROP_SUFFIX=' + new crop';
        var cur=(lbl.textContent||'').trim();
        var base=cur.slice(-NEW_CROP_SUFFIX.length)===NEW_CROP_SUFFIX?cur.slice(0,-NEW_CROP_SUFFIX.length):cur;
        var want=(same&&!swapped)?(base+NEW_CROP_SUFFIX):base;
        if(cur!==want)lbl.textContent=want;
      }
      if(same&&swapped){
        var bLbl=card.querySelector&&card.querySelector('.pc-contract');
        if(bLbl&&bLbl.textContent!==fwd.label)bLbl.textContent=fwd.label;
      }
    });
  }
  /* THE ACTION names a price. The briefing is written at 6:00 AM CT and the
     board moves all day; by evening a reader can be told "nothing to do at
     $5.25 corn" under a ticker that says $5.01. daily.json already carries
     locked_prices (what the writer saw) and todays_call (which contract the
     action is about); nothing on this page read either. This prints both
     prices, and the gap, under the action. It never rewrites the action. */
  window.agsistFrameAction=function(){
    var d=window.AGSIST_DAILY, q=window.AGSIST_PRICE_DATA;
    if(!d||!q)return;
    var ta=document.getElementById('daily-takeaway');
    if(!ta||ta.style.display==='none')return;
    /* WAVE1-D: the bot's call names no price from the morning board, so
       there is no "written at" price to frame it with. Without this guard the
       instrument defaulted to corn and printed a corn gap under a four-crop
       call. */
    if(d.bot_call){var _old=document.getElementById('daily-takeaway-frame');if(_old)_old.remove();return;}
    var call=d.todays_call||{}, lp=d.locked_prices||{};
    /* No instrument named: no price to frame (a diesel line got a corn price under it). */
    if(!call.instrument){var _o=document.getElementById('daily-takeaway-frame');if(_o)_o.remove();return;}
    var key=call.instrument;
    var NAMES={corn:'corn',beans:'beans',wheat:'wheat',oats:'oats',cattle:'live cattle',feeders:'feeders',hogs:'hogs',milk:'Class III milk',meal:'soy meal',crude:'crude',natgas:'natural gas'};
    var GRAIN={corn:1,beans:1,wheat:1,oats:1,'corn-dec':1,'beans-nov':1};
    var was=lp[key], live=q[key];
    if(was==null||!live||live.close==null)return;
    var now=GRAIN[key]?live.close/100:+live.close;
    if(!isFinite(now)||!isFinite(+was))return;
    /* Subtract the two PRINTED prices, so the gap a reader checks by hand
       is the gap on the line ($5.25 - $5.01 = 24c, not the 23.25c of the
       unrounded values). */
    var diff=parseFloat((+now).toFixed(2))-parseFloat((+was).toFixed(2)), txt, fmt;
    if(GRAIN[key]){
      /* Grains print to the quarter cent (components/util.js), so the gap
         is the difference of the two printed quarters. */
      var c=(AG.px.quarters(+now*100)-AG.px.quarters(+was*100))/4;
      txt=c===0?'unchanged since':AG.px.move(c,{style:'slash',sign:true})+' since';
      fmt=function(v){return AG.px.priceDollars(v,{style:'slash'});};
    }else{
      txt=Math.abs(diff)<0.005?'unchanged since':(diff>0?'+':'\u2212')+'$'+Math.abs(diff).toFixed(2)+' since';
      fmt=function(v){return '$'+(+v).toFixed(2);};
    }
    var line=document.getElementById('daily-takeaway-frame');
    if(!line){
      line=document.createElement('p');
      line.id='daily-takeaway-frame';
      line.className='daily-takeaway-frame';
      line.setAttribute('style',"font-family:'JetBrains Mono',monospace;font-size:.765rem;color:var(--text-muted);margin:.5rem 0 0;letter-spacing:.02em");
      ta.appendChild(line);
    }
    line.textContent='Written at '+fmt(was)+' '+(NAMES[key]||key)+' \u00b7 now '+fmt(now)+' ('+txt+')';
  };
  /* Run it again whenever any of the four values it reads changes. The first
     version ran once, straight after renderRanges, and compared price text a
     different code path writes -- so on about half of loads the values were
     still "--" when it looked, it bailed, and nothing ran it again. Measured
     over four loads: 19, 21, 21, 19 visible cards. */
  var _sameWired = false;
  function watchSameContract(){
    collapseSameContract();
    if(_sameWired) return;
    _sameWired = true;
    var ids = ['pcp-corn-near','pcp-corn-dec','pcprev-corn-near','pcprev-corn-dec',
               'pcp-bean-near','pcp-bean-nov','pcprev-bean-near','pcprev-bean-nov'];
    if(typeof MutationObserver === 'function'){
      var mo = new MutationObserver(function(){ collapseSameContract(); });
      ids.forEach(function(id){
        var el = document.getElementById(id);
        if(el) mo.observe(el, {childList:true, characterData:true, subtree:true});
      });
    }else{
      var n = 0;
      (function again(){ collapseSameContract(); if(++n < 12) setTimeout(again, 400); })();
    }
  }
  function renderRanges(q){
    var GR={'corn':1,'corn-dec':1,'beans':1,'beans-nov':1,'wheat':1,'oats':1};
    var SYMS=['corn','corn-dec','beans','beans-nov','wheat','oats','meal','cattle','feeders','hogs','milk','crude','natgas','dollar','sp500','treasury10','gold','silver','bitcoin','ripple','kaspa'];
    /* CORRECTION 2026-09-24. These two labels are the 52-week LOW and the
       52-week HIGH, and they were being rounded to whole dollars, which moved
       them INSIDE the range that actually traded. Class III milk printed a
       $15 low against a real low of $14.53; feeders printed $300 against
       $299.52; the ten-year printed a 3.9% low against 3.947%. A low nobody
       ever traded at is a wrong number on the page, and it is wrong in the
       direction that makes the range look tighter than it was.

       The low now rounds DOWN and the high rounds UP at the precision each
       quote is actually quoted in, so the printed range always contains the
       real one. The dollar index also loses the "$" it never should have
       carried -- DX-Y.NYB is an index, not a price in dollars, and the
       headline number above these labels has never had one. */
    function fmt(sym,v,dir){
      function snap(d){
        var f=Math.pow(10,d);
        return dir<0?Math.floor(v*f)/f:(dir>0?Math.ceil(v*f)/f:Math.round(v*f)/f);
      }
      function usd(d){
        return '$'+snap(d).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
      }
      if(sym==='treasury10')return snap(2).toFixed(2)+'%';
      if(sym==='dollar')return snap(2).toFixed(2);
      if(sym==='kaspa')return usd(3);
      if(sym==='sp500')return snap(0).toLocaleString('en-US');
      if(sym==='bitcoin')return usd(0);
      return usd(2);
    }
    for(var i=0;i<SYMS.length;i++){
      var sym=SYMS[i],x=q[sym];
      if(!x)continue;
      var lo=x.wk52_lo,hi=x.wk52_hi,cl=x.close;
      if(lo==null||hi==null||cl==null||hi<=lo)continue;
      if(GR[sym]){lo=lo/100;hi=hi/100;cl=cl/100;}
      var pct=Math.max(0,Math.min(100,((cl-lo)/(hi-lo))*100));
      var elLo=document.getElementById('pcrl-'+sym+'-lo');
      var elHi=document.getElementById('pcrl-'+sym+'-hi');
      var elF=document.getElementById('pcrf-'+sym);
      var elD=document.getElementById('pcrd-'+sym);
      /* Grains: the site formatter's range, to the quarter cent, never inward. */
      var gr=GR[sym]?AG.px.range(x.wk52_lo,x.wk52_hi,{style:'slash'}):null;
      if(elLo)elLo.textContent=gr?gr.lo:fmt(sym,lo,-1);
      if(elHi)elHi.textContent=gr?gr.hi:fmt(sym,hi,1);
      if(elF)elF.style.width=pct.toFixed(1)+'%';
      if(elD)elD.style.left=pct.toFixed(1)+'%';
    }
  }
  /* WAVE3-L 2026-10-03: a failed or malformed prices.json used to leave
     every price cell on "Not loaded yet", an empty ticker and a header that
     still said "Updated every 15 min". Now: one line saying the prices did
     not load and when we tried, the empty ticker hidden, and a retry on a
     timer and when the browser comes back online. A file with no quotes
     object counts as malformed. */
  var _pxTry=0,_pxTimer=null,_pxDone=false;
  function pxCT(){try{return new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(new Date())+' CT';}catch(e){return '';}}
  function pxFail(){
    if(_pxDone)return;
    var fp=document.getElementById('f-prices'),strip=document.querySelector('.prices-strip');
    if(fp)fp.classList.add('px-off');if(strip)strip.classList.add('px-off');
    var pa=document.getElementById('prices-age');if(pa)pa.textContent='';
    var ln=document.getElementById('px-fail');
    if(!ln&&fp){ln=document.createElement('p');ln.id='px-fail';ln.className='px-fail';ln.setAttribute('role','status');var sh=fp.querySelector('.sec-head');fp.insertBefore(ln,sh?sh.nextSibling:fp.firstChild);}
    var t=pxCT();if(ln)ln.textContent='Prices did not load'+(t?' ('+t+')':'')+'. Retrying.';
    clearTimeout(_pxTimer);_pxTimer=setTimeout(pxLoad,[30,60,120][_pxTry-1]*1000||300000);
  }
  function pxClear(){
    var fp=document.getElementById('f-prices'),strip=document.querySelector('.prices-strip'),ln=document.getElementById('px-fail');
    if(fp)fp.classList.remove('px-off');if(strip)strip.classList.remove('px-off');if(ln&&ln.parentNode)ln.parentNode.removeChild(ln);
    var rs=document.querySelectorAll('.pc-range');for(var i=0;i<rs.length;i++)rs[i].style.visibility='';
  }
  window.addEventListener('online',function(){if(!_pxDone){clearTimeout(_pxTimer);pxLoad();}});
  function pxLoad(){
  _pxTry++;
  var first=_pxTry===1;
  /* The first read shares the page's one request (AG.json); a retry asks the
     server again. */
  (first?AG.json('/data/prices.json'):fetch('/data/prices.json',{cache:'no-store'}).then(function(r){
    if(!r.ok)throw new Error('prices.json '+r.status);
    return r.json();
  })).then(function(data){
    if(!data||typeof data!=='object'||!data.quotes||typeof data.quotes!=='object')throw new Error('prices.json malformed');
    return data;
  }).then(function(data){
    _pxDone=true;clearTimeout(_pxTimer);
    if(!first){
      /* A retry worked: put the page back and let the other readers of the
         file paint (geo.js the cards and ticker, r7-prices the ledgers). */
      pxClear();
      window.__agsistPricesP=Promise.resolve(data);
      try{window.dispatchEvent(new CustomEvent('agsist:prices',{detail:data}));}catch(e){}
      if(typeof window.fetchAllPrices==='function')window.fetchAllPrices();
    }
    var q=data.quotes||{};
    /* The continuous series tracks the MOST-ACTIVE contract, so these bars
       placed the December price inside the continuous 52-week band and read
       85% of range when the contract a grower prices against sat at 42%. */
    ['corn','beans','wheat','cattle'].forEach(function(c){
      var nb=q[c+'-nearby'];
      if(nb&&nb.close!=null)q[c]=nb;
    });
    /* Published BEFORE the collapse runs: the forward-year roll reads it. */
    window.AGSIST_PRICE_DATA=q;
    renderRanges(q);
    watchSameContract();
    if(typeof window.agsistFrameAction==='function')window.agsistFrameAction();
    // Update "prices-age" label with actual fetch time
    if(data.fetched){
      var _pa=document.getElementById('prices-age');
      if(_pa){
        var _mins=Math.round((Date.now()-new Date(data.fetched).getTime())/60000);
        /* THE BADGE AT THE TOP OF THE PAGE SAID LIVE WHATEVER THE AGE.
           This age was already computed, and already rendered -- but into
           #prices-age, which sits a thousand lines down beside a section
           heading. The ticker above the fold carried a pulsing dot and the
           word LIVE unconditionally. Measured 2026-09-12 at 03:06 UTC: the
           feed was 185 minutes old and the badge still said LIVE.
           Same computation, second rendering. Not a second calculation. */
        var _tb=document.getElementById('ticker-age');
        if(_tb){
          /* r7-prices 2026-10-01 (7b): the quotes are delayed about 15
             minutes while the market trades, and after the close they are the
             settle. This reads the file's own fetch time against the CBOT grain
             sessions (Central time): day 8:30 AM-1:20 PM, overnight 7:00 PM-
             7:45 AM. Until 1:35 PM a quote may still be pre-settle. Full-closure
             holidays are the same rules as scripts/contract_calendar.py
             market_holidays(); early closes are not in the repo, so they are
             not modelled. */
          var _st=(function(iso){
            var F=new Date(iso);if(isNaN(F.getTime()))return null;
            var DY=864e5,MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            function U(y,m,d){return Date.UTC(y,m,d);}
            function wd(t){return new Date(t).getUTCDay();}
            function nth(y,m,w,n){var t=U(y,m,1);t+=((w-wd(t)+7)%7)*DY;return t+(n-1)*7*DY;}
            function lastw(y,m,w){var t=U(y,m+1,0);return t-((wd(t)-w+7)%7)*DY;}
            function obs(t){var x=wd(t);return x===6?t-DY:x===0?t+DY:t;}
            function easter(y){var a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);return U(y,Math.floor((h+l-7*m+114)/31)-1,((h+l-7*m+114)%31)+1);}
            function hol(y){var o={};[[obs(U(y,0,1)),"New Year’s Day"],[nth(y,0,1,3),'Martin Luther King Jr. Day'],[nth(y,1,1,3),'Presidents Day'],[easter(y)-2*DY,'Good Friday'],[lastw(y,4,1),'Memorial Day'],[obs(U(y,5,19)),'Juneteenth'],[obs(U(y,6,4)),'Independence Day'],[nth(y,8,1,1),'Labor Day'],[nth(y,10,4,4),'Thanksgiving'],[obs(U(y,11,25)),'Christmas Day']].forEach(function(p){o[p[0]]=p[1];});return o;}
            function holName(t){var y=new Date(t).getUTCFullYear();for(var i=-1;i<=1;i++){var n=hol(y+i)[t];if(n)return n;}return null;}
            function trading(t){var x=wd(t);return x>=1&&x<=5&&!holName(t);}
            function lbl(t){var d=new Date(t);return MN[d.getUTCMonth()]+' '+d.getUTCDate();}
            function ct(d){var p={};new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'2-digit',minute:'2-digit',hourCycle:'h23',month:'numeric',day:'numeric',year:'numeric'}).formatToParts(d).forEach(function(x){p[x.type]=x.value;});return p;}
            function hm(d){return new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(d)+' CT';}
            var p=ct(F),dayT=U(+p.year,+p.month-1,+p.day),m=(+p.hour%24)*60+(+p.minute);
            var tr=trading(dayT),age=(Date.now()-F.getTime())/60000;
            var read='Read at '+hm(F)+', '+lbl(dayT)+', '+p.year+'.';
            var day=tr&&m>=510&&m<800, night=(m>=1140&&trading(dayT+DY))||(m<465&&tr);
            if(day||night){
              if(age<=45)return{t:'Delayed 15 min',live:true,title:'Futures prices delayed about 15 minutes. '+read};
              var n=ct(new Date()),same=(+n.year===+p.year&&+n.month===+p.month&&+n.day===+p.day);
              return{t:'As of '+(same?hm(F):lbl(dayT)),live:false,title:read};
            }
            if(tr&&m>=800&&m<815)return{t:'As of '+hm(F),live:false,title:'The day session closed at 1:20 PM CT; closing prices may not be final yet. '+read};
            if(tr&&m>=465&&m<510)return{t:'Pre-open',live:false,title:'Overnight session closed, day session not open yet. '+read};
            /* 2026-10-17: after the bell Yahoo's bar is the LAST TRADE until
               late evening, then the settle (fetch_prices v3.7 RESTATED_BY).
               The file says which (close_kind); only a settle is labeled one.
               On Oct 16 this badge said "Close" over soybeans $12.60 1/2, a
               1:46 PM trade; CBOT settled $12.61 1/4. */
            var qs=data.quotes||{},cq=qs['corn-nearby']||qs.corn||{};
            var hn=holName(dayT);
            if(cq.close_kind==='settle'&&cq.close_date){
              var sd=Date.parse(cq.close_date+'T00:00:00Z');
              return{t:'Settle '+lbl(sd),live:false,title:(hn?'Markets closed for '+hn+'. ':'')+'Settles for '+lbl(sd)+', '+new Date(sd).getUTCFullYear()+' (the CME settle as Yahoo Finance posts it). '+read};
            }
            if(cq.close_kind==='last'||(tr&&m>=815&&m<1410)){
              var n2=ct(new Date()),same2=(+n2.year===+p.year&&+n2.month===+p.month&&+n2.day===+p.day);
              return{t:'As of '+(same2?hm(F):lbl(dayT)),live:false,title:'Last trades. The day session closed at 1:20 PM CT; the settles post late in the evening. '+read};}
            var s=(tr&&m>=815)?dayT:dayT-DY,guard=0;while(!trading(s)&&guard++<10)s-=DY;
            /* A file from before close_kind: "Close", not "Settle". */
            return{t:'Close '+lbl(s),live:false,title:(hn?'Markets closed for '+hn+'. ':'')+'Closing prices for '+lbl(s)+', '+new Date(s).getUTCFullYear()+' (Yahoo Finance closes, not CME settlements). '+read};
          })(data.fetched);
          if(_st){_tb.innerHTML='';(/^As of /.test(_st.t)?['As of',_st.t.slice(6)]:_st.t.split(/ (.+)/).slice(0,2)).forEach(function(w,i){if(i)_tb.appendChild(document.createElement('br'));_tb.appendChild(document.createTextNode(w));});_tb.parentNode.title=_st.title;_tb.parentNode.classList.toggle('stale',!_st.live);}
          else{_tb.innerHTML='Not loaded<br>yet';_tb.parentNode.classList.add('stale');}
        }
        if(window.AgAsOf)AgAsOf.set(_pa,data.fetched,'prices');
        else{_pa.textContent=_mins<2?'• Live now':_mins<60?'• Updated '+_mins+' min ago':_mins<2880?'• Updated '+Math.round(_mins/60)+'h ago':'• Updated '+Math.round(_mins/1440)+'d ago';
        _pa.style.color=_mins>60?'#f0913a':_mins>30?'var(--gold)':'var(--text-muted)';}
      }
    }
    // Wire sparklines if geo.js hasn't already — REMOVED (sparklines disabled)
    // window.AGSIST_PRICE_DATA is set above, before renderRanges.
    // ---- staleness: ratio-widget flag + GA (per-tile dimming handled authoritatively in geo.js) ----
    try{
      var __sk=(data.stale_keys||[]);
      function __st(k){return (q[k]&&q[k].stale===true)||__sk.indexOf(k)>-1;}
      var __anyAg=['corn','beans','wheat','corn-dec','beans-nov'].some(__st);
      if(__anyAg&&typeof gaEvent==='function'){gaEvent('quote_stale_shown',{page:'home'});}
    }catch(e){}

  },function(){
    blankRanges();
    // 2026-09-30: on an outright fetch failure (not just stale data — that
    // case is handled above) this never touched #ticker-age, so a visitor
    // kept seeing the static "LIVE" pulsing dot with a page full of "--"
    // prices underneath it. Same dishonest-badge bug fixed for staleness on
    // 2026-09-12; this closes the failure case too.
    var _tbErr=document.getElementById('ticker-age');
    if(_tbErr){_tbErr.innerHTML='Not loaded<br>yet';_tbErr.parentNode.classList.add('stale');}
    pxFail();
  });
  }
  pxLoad();
})();
