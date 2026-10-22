/* components/futures.js: the corn, soybean and wheat futures pages, one script.

   Until 2026-10-10 each of corn-futures-prices.html, soybean-futures-prices.html
   and wheat-futures-prices.html carried its own ~80 KB copy of this code, and 19
   shared functions had drifted apart: the soybean page said the WASDE was
   "today" a day after it came out, the corn page printed <svg> markup as text,
   and the RP revenue-floor line never ran on any of the three because it read a
   variable from a script it could not see. Now there is one copy. What is
   different about each crop (contracts, tiles, crush, wheat classes, wording)
   lives in CROPS below; everything else is shared.

   The page says which crop it is before loading this file:
     <script>window.AGSIST_FUTURES='corn'</script>
     <script src="/components/futures.js?v=1"></script>
   Prices print through components/util.js (AG.px), which loads in the head. */
(function(){
'use strict';

/* ── per-crop configuration ──────────────────────────────────────────────── */
var MONTH_TIPS={
  corn:['January usually pays carry; elevators set basis while farmers watch the corn/bean ratio','February: planting talk starts, and the corn/bean ratio gets watched closely','March: acreage decisions firm up ahead of the Prospective Plantings report','April: weather risk starts to get priced in as planting gets close','May is weather market season. Forecasts can move prices day to day','June pollination risk keeps markets sensitive to temperature and moisture outlooks','July crop condition scores increasingly determine the price range for the rest of the season','August is early harvest pressure season as combines begin rolling in the South','September: harvest gets going, and new-crop supply and basis lead the market','October is peak harvest; the most new-crop supply reaches the market; see the seasonal chart for how recent years actually traded this month','November wraps up harvest; storage and carry decisions take over from harvest sales','December is a quieter positioning month; year-end basis can firm as commercials reduce inventory risk'],
  soybean:['January is South American harvest pressure season. Watch Brazil crop estimates closely','February marks peak South American harvest; US basis is typically under competitive export pressure','March is a transition month as South American exports compete while US planting plans take shape','April brings corn/bean ratio decisions and early US planting weather focus','May builds new-crop weather premium as US soybean planting accelerates','June: pod-set weather can move prices hard from one forecast to the next','July crop condition scores increasingly lock in the price range for the remainder of the season','August pod-fill conditions are critical: dry weather now can move prices fast','September: harvest starts and new-crop supply begins to reach the market','October is peak US harvest supply; see the seasonal chart for how recent years actually traded this month','November post-harvest: South American planting underway, watch early growing season weather','December: early South American weather starts to shape next year\'s global supply'],
  wheat:['January: winter wheat is dormant; the Southern Hemisphere harvest sets the supply picture','February: winter wheat begins to break dormancy; cold stress is the risk to watch','March: global supply questions build ahead of Northern Hemisphere planting','April frost risk premium can add volatility as winter wheat breaks dormancy and heads out','May is pre-harvest season: wheat is heading, quality risk keeps buyers attentive','June: SRW harvest begins and new-crop supply arrives; see the seasonal chart for how recent years traded','July is peak harvest; combines roll across the Northern Hemisphere','August is the post-harvest recovery window; old crop clears and new positions begin building','September: global buyers restock after the Northern Hemisphere harvest','October: winter wheat goes in, and stand establishment and early crop reports lead','November: wheat goes dormant and the year\'s global supply gets clearer','December Southern Hemisphere harvest updates and year-end fund positioning drive market direction']
};
/* One set of words for where a price sits in its 52-week range, used by every line
   on the page: quartiles at 25 and 75, halves at 50. "Mid-range" is not one of them
   (it was printed at the 74th percentile, audit N13, Oct 17). */
function bandOf(pct){return pct<25?'lower quartile':pct<50?'lower half':pct<75?'upper half':'upper quartile';}
function zoneOf(pct){return pct<25?'lower quartile: historically a weak pricing window':pct<50?'lower half':pct<75?'upper half':'upper quartile: near recent highs';}

var CROPS={
  corn:{
    key:'corn',label:'Corn',root:'ZC',stats:'corn',ga:'corn',progressKey:'corn',
    emoji:'<svg class="ic" aria-hidden="true"><use href="#i-sprout"/></svg>',
    carry:'corn',
    tiles:[{nc:['corn','dec'],alt:'corn-dec',p:'p-corndec',c:'c-corndec',g:true,lbl:'lbl-corndec'},{root:'beans',name:'Soybeans',sym:'ZS',p:'p-beans',c:'c-beans',g:true},{root:'wheat',name:'Wheat',sym:'ZW',p:'p-wheat',c:'c-wheat',g:true},{key:'crude',p:'p-crude',c:'c-crude',g:false,u:{pre:'$'}},{key:'dollar',p:'p-dollar',c:'c-dollar',g:false,u:{}}],
    heroTile:['p-corn','c-corn'],
    labels:function(lbl,nearby,when){
      setTxt('lbl-corn',lbl);
      setTxt('ph-exch','CBOT · CME Group · '+lbl+' · '+when);
      setTxt('rng-lbl','52-Week Range: Corn '+lbl);
    },
    rollNote:'The nearby contract just rolled to the next month; day-change comparisons span two contracts until the new month has a clean close.',
    pricedWord:'new crop',
    rpHarvestWord:'Harvest price (Oct avg) still setting.',
    dollarHi:'is a headwind for US corn export competitiveness',
    dollarLo:'is providing a tailwind for US corn export demand',
    tv:'CAPITALCOM:CORN',
    seasSuffix:' Major USDA reports and weather events override any seasonal pattern.',
    prices:function(q,data,front){
      if(front&&front.close!=null){
        var cornBu=front.close/100;
        setEl('pc-price',grain$(front.close)+'/bu');
        var bz=document.getElementById('bz'+(cornBu<4?0:cornBu<4.75?1:cornBu<5.5?2:3));
        if(bz)bz.classList.add('active');
      }
      renderRatio(data,function(r){return r<2.4?'<svg class="ic" aria-hidden="true"><use href="#i-sprout"/></svg> Corn favored: historically the stronger per-acre plant':r<2.6?'<svg class="ic" aria-hidden="true"><use href="#i-scale"/></svg> Neutral zone: local costs and rotation should decide':'<svg class="ic" aria-hidden="true"><use href="#i-bean"/></svg> Beans favored: soybeans historically pay more per acre';});
      // S2: new-crop at a glance: the corn-dec benchmark (the next live Dec, which
      // rolls on its own; the label is read from its ticker). Hidden when the key is missing.
      var cornDec=q[newCropKey('corn','dec',q)]||q['corn-dec'];
      /* when the nearby IS the new-crop contract (Dec corn from Sep to Dec) the hero
         already shows it; the line would only repeat the same price */
      var ncSame=!!(front&&cornDec&&front.ticker&&front.ticker===cornDec.ticker);
      if(cornDec&&cornDec.close!=null&&!ncSame){
        var ncEl=document.getElementById('nc-glance');
        if(ncEl){
          var ncl=document.getElementById('nc-lbl'),ncm=contractLabel(cornDec);if(ncl&&ncm)ncl.textContent=ncm;
          var ncp=document.getElementById('nc-price');if(ncp)ncp.textContent=grain$(cornDec.close);
          var ncc=document.getElementById('nc-chg');
          if(ncc){
            if(cornDec.roll){ncc.textContent='(contract roll)';ncc.className='roll';}
            else if(cornDec.pctChange!=null){var ncx=pctChip(cornDec);ncc.textContent=ncx.t;ncc.className=ncx.c;}
            else{ncc.textContent='';}
          }
          ncEl.style.display='block';
        }
      }else{var __nc=document.getElementById('nc-glance');if(__nc)__nc.style.display='none';}
    },
    read:function(q,data,front,lbl){
      var sp=[];
      if(front&&front.wk52_lo!=null&&front.wk52_hi!=null){
        var pct=pctInRange(front);
        sp.push('<strong>'+lbl+' corn at '+grain$(front.close)+'</strong> is <strong>'+pct+'% of the way up</strong> its 52-week range ('+zoneOf(pct)+')');
      }
      var PR=plantingRatio(data);
      if(PR){
        var r2=PR.value,rl=' ('+PR.label+')';
        sp.push(r2<2.4?'the <strong>corn/bean ratio at '+r2.toFixed(2)+':1</strong>'+rl+' historically favors corn in most rotation budgets':r2<2.6?'the <strong>corn/bean ratio at '+r2.toFixed(2)+':1</strong>'+rl+' sits in neutral territory: local costs and rotation should decide acreage':'the <strong>corn/bean ratio at '+r2.toFixed(2)+':1</strong>'+rl+' gives soybeans the historical edge for flexible acres');
      }
      return sp;
    }
  },

  soybean:{
    key:'beans',label:'Soybean',root:'ZS',stats:'soybean',ga:'soybeans',progressKey:'soybeans',
    emoji:'',
    carry:'soybeans',
    tiles:[{nc:['beans','nov'],alt:'beans-nov',p:'p-beansnov',c:'c-beansnov',g:true,lbl:'lbl-beansnov'},{root:'corn',name:'Corn',sym:'ZC',p:'p-corn',c:'c-corn',g:true},{root:'meal',name:'Soybean meal',sym:'ZM',p:'p-meal',c:'c-meal',g:false,u:{pre:'$',suf:'/t'}},{root:'soyoil',name:'Soybean oil',sym:'ZL',p:'p-soyoil',c:'c-soyoil',g:false,u:{suf:'¢'}},{key:'dollar',p:'p-dollar',c:'c-dollar',g:false,u:{}}],
    heroTile:['p-beans','c-beans'],
    labels:function(lbl,nearby){
      setTxt('hero-contract',lbl);
      setTxt('lbl-beans',nearby?lbl+' (ZS)':'Most-active (ZS)');
      /* the range is the hero contract's own 52 weeks: name that contract, as corn does (audit N13, Oct 17) */
      setTxt('rng-lbl','52-Week Range: Soybeans '+(nearby?lbl:'most-active (ZS)'));
    },
    rollNote:'Front-month contract just rolled to the next month; day-change comparisons span two contracts until the new month has a clean close.',
    pricedWord:'new crop',
    rpHarvestWord:'Harvest price (Oct avg) still setting.',
    dollarHi:'is a headwind for US soybean export competitiveness',
    dollarLo:'is supporting US soybean export demand',
    tv:'CAPITALCOM:SOYBEAN',
    seasSuffix:'',
    prices:function(q,data,front){
      /* v15 (S2): new-crop at a glance: the beans-nov benchmark (the next live Nov,
         which rolls on its own; the label is read from its ticker), hidden if key missing */
      var ncQ=q[newCropKey('beans','nov',q)]||q['beans-nov'];
      var ncEl=document.getElementById('nc-line');
      var ncSame=!!(front&&ncQ&&front.ticker&&front.ticker===ncQ.ticker);
      if(ncEl&&ncQ&&ncQ.close!=null&&!ncSame){
        var ncHtml=(contractLabel(ncQ)||'Nov')+" new crop: <strong>"+grain$(ncQ.close)+"</strong>";
        if(ncQ.pctChange!=null&&!ncQ.roll){var npx=pctChip(ncQ);ncHtml+=' <span class="'+npx.c+'">'+npx.t+'</span>';}
        ncEl.innerHTML=ncHtml;
        ncEl.style.display='';
      }else if(ncEl){ncEl.style.display='none';}
      /* corn beside beans (2026-10-17 search-terms check: "corn and soybean prices today"); the corn page's own hero quote, with its stamp */
      var cEl=document.getElementById('corn-line'),cq=(q['corn-nearby']&&q['corn-nearby'].close!=null)?q['corn-nearby']:q.corn;
      if(cEl&&cq&&cq.close!=null){
        var cH='Corn '+(contractLabel(cq)||'')+': <strong>'+grain$(cq.close)+'</strong>';
        if(cq.pctChange!=null&&!cq.roll){var cpx=pctChip(cq);cH+=' <span class="'+cpx.c+'">'+cpx.t+'</span>';}
        var cS=window.AgPxStamp&&AgPxStamp.html?AgPxStamp.html(cq,data&&data.fetched):'';
        cEl.innerHTML=cH+(cS?' &middot; '+cS:'')+' &middot; <a href="/corn-futures-prices">Corn futures</a>';
        cEl.style.display='';
      }
      renderRatio(data,function(r){return r<2.4?'Corn favored: soybeans historically the weaker per-acre choice':r<2.6?'Neutral: an even acre split is common at these levels':'Beans favored: soybeans historically earn more per acre';});
      var BC=boardCrush(q,front),cw=document.getElementById('crush-card');
      if(BC){
        if(cw)cw.style.display='';
        setEl('crush-val',(BC.crush>=0?'+':'\u2212')+'$'+Math.abs(BC.crush).toFixed(2)+'/bu');
        var cz=document.getElementById('cz'+BC.band);
        if(cz)cz.classList.add('active');
        setEl('crush-sub',BC.months+': meal $'+BC.meal.close.toFixed(2)+'/short ton, oil '+BC.oil.close.toFixed(2)+'\u00a2/lb, beans '+grain$(front.close)+'/bu');
      }else if(cw){cw.style.display='none';}
    },
    read:function(q,data,front,lbl,nearby){
      var sp=[];
      if(front&&front.wk52_lo!=null&&front.wk52_hi!=null){
        var pct=pctInRange(front);
        sp.push('<strong>'+(nearby?'Nearby':'Most-active')+' soybeans at '+grain$(front.close)+'</strong> are <strong>'+pct+'% of the way up</strong> their 52-week range ('+zoneOf(pct)+')');
      }
      var PR=plantingRatio(data);
      if(PR){
        var r2=PR.value,rl=' ('+PR.label+')';
        sp.push(r2<2.4?'the <strong>corn/bean ratio at '+r2.toFixed(2)+':1</strong>'+rl+' historically signals corn as the stronger per-acre choice this season':r2<2.6?'the <strong>corn/bean ratio at '+r2.toFixed(2)+':1</strong>'+rl+' is in neutral territory: an even acre split is common at these levels':'the <strong>corn/bean ratio at '+r2.toFixed(2)+':1</strong>'+rl+' gives soybeans the historical per-acre edge');
      }
      var BC2=boardCrush(q,front);
      if(BC2){
        /* A size, not a price call: the gross board crush leaves out what it
           costs to run a plant, and the bands are AGSIST rules of thumb. */
        sp.push('the <strong>gross board crush</strong> ('+BC2.months+') is <strong>'+(BC2.crush<0?'\u2212':'')+'$'+Math.abs(BC2.crush).toFixed(2)+'/bu</strong>, '+['narrow','typical','strong','wide'][BC2.band]+' by AGSIST\u2019s rule-of-thumb bands');
      }
      return sp;
    }
  },

  wheat:{
    key:'wheat',label:'Wheat',root:'ZW',stats:'wheat',ga:'wheat',progressKey:null,
    emoji:'<svg class="ic" aria-hidden="true"><use href="#i-wheat"/></svg>',
    // Forward curve and carry window: components/storesell.js forwardCurve /
    // carryWindow, from the dated contracts on file (Dec '26 to May '27 on
    // 2026-10-11). Jul '27 on is next year's crop: plotted, never in the carry.
    carry:'wheat',
    tiles:[{root:'corn',name:'Corn',sym:'ZC',p:'p-corn',c:'c-corn',g:true},{root:'beans',name:'Soybeans',sym:'ZS',p:'p-beans',c:'c-beans',g:true},{root:'oats',name:'Oats',sym:'ZO',p:'p-oats',c:'c-oats',g:true},{key:'crude',p:'p-crude',c:'c-crude',g:false,u:{pre:'$'}},{key:'dollar',p:'p-dollar',c:'c-dollar',g:false,u:{}}],
    heroTile:['p-wheat','c-wheat'],
    labels:function(lbl){
      setTxt('lbl-wheat','SRW Wheat · '+lbl);
      setTxt('hero-contract','· '+lbl);
      setTxt('rng-lbl','52-Week Range: Wheat · '+lbl);
    },
    rollNote:'Front-month contract just rolled to the next month; day-change comparisons span two contracts until the new month has a clean close.',
    pricedWord:'the 2026 crop',
    rpHarvestWord:'Harvest price still setting.',
    dollarHi:'is a headwind for US wheat export competitiveness against Black Sea origins',
    dollarLo:'is improving US wheat export competitiveness on global tenders',
    tv:'CAPITALCOM:WHEAT',
    seasSuffix:' Black Sea supply and weather events can override any seasonal pattern.',
    cotClasses:[['wheat','Chicago SRW (ZW)'],['kcwheat','KC HRW (KE)'],['mplswheat','Mpls HRS (MWE)']],
    boot:[function(){loadExportPace();}],
    cropProgress:function(){wheatCropProgress();},
    prices:function(q,data,front){
      // Class quote cards: KC HRW (KE) + Minneapolis HRS (MWE), rendered only when keys exist,
      // plus the deferred card: the next live contract after the nearby (wheatDeferred), labeled from its ticker
      var dfr=wheatDeferred(q,front);
      if(dfr)setTxt('l-wheat-def',(contractLabel(q[dfr])||'Deferred')+' (deferred)');
      /* Class cards and class spreads read the SAME quotes (2026-10-16). The KC
         card showed KE=F ($7.02¼) beside a spread figured from KEZ26 ($7.01½),
         so subtracting the two cards gave 44¼¢ against a printed 43½¢. Each
         class card shows the month the pipeline's same-month spread uses
         (data.spreads, fetch_prices class_spreads), else that class's nearby;
         the spread is figured from the quotes on the cards. */
      var SPR=(data&&data.spreads)||{};
      function classQ(cls){
        var s=SPR[cls];
        if(s&&s.cents!=null&&s.class_key&&q[s.class_key]&&q[s.class_key].close!=null)
          return {d:q[s.class_key],label:s.month||contractLabel(q[s.class_key]),chi:q[s.chicago_key]||null,month:s.month||null};
        var r=nearbyOf(q,cls);return r?{d:r.d,label:r.label,chi:null,month:null}:null;
      }
      var KE=classQ('kcwheat'),MW=classQ('mplswheat');
      [{r:KE,card:'cc-kcwheat',p:'p-kcwheat',c:'c-kcwheat',name:'KC HRW',sym:'KE'},{r:MW,card:'cc-mplswheat',p:'p-mplswheat',c:'c-mplswheat',name:'Minneapolis HRS',sym:'MWE'},{r:dfr?{d:q[dfr]}:null,card:'cc-wheat-def',p:'p-wheat-def',c:'c-wheat-def'}].forEach(function(m){
        var d=m.r?m.r.d:null;var cardEl=document.getElementById(m.card);
        if(!d||d.close==null){if(cardEl)cardEl.style.display='none';return;}
        if(cardEl){cardEl.style.display='';if(m.name){var le=cardEl.querySelector('.cc-lbl');if(le)le.textContent=m.name+' '+(m.r.label||'most-active')+' ('+m.sym+')';}}
        setEl(m.p,grain$(d.close));
        var ch=chgTxt(d.netChange,d.pctChange,d.roll);setEl(m.c,ch.t,ch.c);
      });
      // Wheat class spreads: same delivery month only, from the quotes on the cards
    (function(){
      var card=document.getElementById('cls-spread-card');
      if(!card)return;
      var any=false,notes=[],months=[];
      var keRow=document.getElementById('cs-kezw-row'),keVal=document.getElementById('cs-kezw');
      if(keRow&&keVal&&KE&&KE.month&&KE.chi&&KE.chi.close!=null){
        var d1=KE.d.close-KE.chi.close;
        keVal.textContent=amt(d1,{sign:true});
        var kl=keRow.querySelector('.xl');if(kl)kl.textContent='KC HRW − Chicago SRW, '+KE.month;
        keRow.style.display='flex';any=true;months.push(KE.month);
        notes.push(d1>=0?'KC over Chicago: the market is pricing HRW quality/protein over SRW':'KC under Chicago: the market is pricing SRW over HRW right now');
      }else if(keRow){keRow.style.display='none';}
      var mweRow=document.getElementById('cs-mweke-row'),mweVal=document.getElementById('cs-mweke');
      if(mweRow&&mweVal&&MW&&KE&&MW.month&&MW.month===KE.month){
        var d2=MW.d.close-KE.d.close;
        mweVal.textContent=amt(d2,{sign:true});
        var ml=mweRow.querySelector('.xl');if(ml)ml.textContent='Mpls HRS − KC HRW, '+MW.month;
        mweRow.style.display='flex';any=true;
        notes.push(d2>=0?'Minneapolis over KC: the protein premium for spring wheat is intact':'Minneapolis under KC: spring wheat trading below HRW');
      }else if(mweRow){mweRow.style.display='none';}
      var interpEl=document.getElementById('cs-interp');
      if(interpEl)interpEl.textContent=notes.join('. ')+(notes.length?'.':'');
      var srcEl=card.querySelector('.cls-spread-src');
      if(srcEl&&months.length)srcEl.textContent='Same delivery month for both classes ('+months[0]+'), from the quotes on the cards above';
      card.style.display=any?'block':'none';
    })();
      if(front&&front.close!=null){
        var whBu=front.close/100;
        setEl('be-price',grain$(front.close)+'/bu');
        var bz=document.getElementById('bz'+(whBu<5?0:whBu<6?1:whBu<7?2:3));
        if(bz)bz.classList.add('active');
      }
      // Deferred benchmark line: the same contract as the deferred card (never the nearby)
    (function(){
      var bl=document.getElementById('benchline');
      if(!bl)return;
      var d26=dfr?q[dfr]:null;
      if(!d26||d26.close==null||(front&&front.ticker&&front.ticker===d26.ticker)){bl.style.display='none';return;}
      var chg='';
      if(d26.pctChange!=null&&!d26.roll)chg=' ('+AG.px.pct(d26.pctChange)+')';
      bl.innerHTML=esc(contractLabel(d26)||'Deferred')+' (deferred): <strong>'+grain$(d26.close)+'</strong>'+chg+', winter wheat new-crop is July';
      bl.style.display='block';
    })();
      // Feed spread: SAME-MONTH contracts only (Dec wheat minus Dec corn, wheatCornPair).
    // Mixing a continuous most-active with a dated month was silently ~22c off.
    var WC=wheatCornPair(q),wSep=WC&&WC.w,cSep=WC&&WC.c;
    var wcCard=document.getElementById('wc-card');
    if(WC){
      if(wcCard)wcCard.style.display='';
      var wcl=document.getElementById('wc-lbl-m');if(wcl)wcl.textContent=WC.label;
      var spread=(wSep.close-cSep.close)/100;
      setEl('wc-spread',(spread>=0?'+':'\u2212')+'$'+Math.abs(spread).toFixed(2)+'/bu');
      var gp=Math.min(100,Math.max(0,(spread/2)*100));
      document.getElementById('wc-dot').style.left='calc('+gp+'% - 8px)';
      var it=(spread<0.25?'Parity: feed wheat demand is activated, price floor in effect':spread<0.75?'Narrowing: feed buyers starting to substitute wheat for corn':spread<1.5?'Normal premium: standard market structure':'Wide spread: feeders are using corn; wheat feed demand absent')+' ('+WC.label+' wheat and corn)';
      setEl('wc-interp',it);
    }else if(wcCard){
      wcCard.style.display='none';
    }
    },
    read:function(q,data,front,lbl){
      var sp=[];
      if(front&&front.wk52_lo!=null&&front.wk52_hi!=null){
        var pct=pctInRange(front);
        sp.push('<strong>Wheat ('+lbl+') at '+grain$(front.close)+'</strong> sits <strong>'+pct+'% of the way up</strong> its 52-week range ('+zoneOf(pct)+')');
      }
      var WC2=wheatCornPair(q);
    if(WC2){
      var sprd=(WC2.w.close-WC2.c.close)/100,wcs='the <strong>'+WC2.label+' wheat–corn spread at $'+sprd.toFixed(2)+'/bu</strong>';
      sp.push(sprd<0.25?wcs+' is at parity: feed wheat demand is active, providing a price floor':sprd<0.75?wcs+' is narrow: feed buyers are beginning to substitute wheat for corn':sprd<1.5?wcs+' is in normal range':wcs+' is wide: feeders are using corn and wheat loses that demand support');
    }
    if(front&&front.close){
      var whBu2=front.close/100;
      sp.push(whBu2<5?'at <strong>'+grain$(front.close)+'/bu</strong> prices are below full cost of production for most winter wheat farms':whBu2<6?'at <strong>'+grain$(front.close)+'/bu</strong> prices cover variable costs but are tight on land and overhead for most operations':whBu2<7?'at <strong>'+grain$(front.close)+'/bu</strong> prices support profitable production for most well-run operations':'at <strong>'+grain$(front.close)+'/bu</strong> prices are generating strong margins, a forward selling opportunity worth evaluating');
    }
      return sp;
    }
  }
};

/* the pure helpers, for test/futures-one-quote.test.mjs */
window.AgsistFuturesPure={nearbyOf:nearbyOf,amt:amt,wheatProgressRows:wheatProgressRows};
var CROP=CROPS[window.AGSIST_FUTURES];
if(!CROP)return;
var CROP_KEY=CROP.key;
var CROP_LABEL=CROP.label;
var CROP_EMOJI=CROP.emoji;
var CROP_PROGRESS_KEY=CROP.progressKey;
/* The forward curve's contracts: every live dated contract on file, from
   storesell.js forwardCurve (one rule for expiry, window and new crop). */
function fwdContracts(q){var SS=window.AgsistStoreSell;return SS&&SS.forwardCurve?SS.forwardCurve(CROP.carry,q):[];}

/* ── small shared helpers ─────────────────────────────────────────────────── */
/* A percent-only change chip, "(+0.12%)": a move that rounds to no quarter
   cent is "(unch)", class nc, as AG.px.change does for the hero (a11y
   2026-10-19: "(0.00%)" was green "up" on /corn-futures-prices). With no net
   change, a percent that prints 0.00 is unch. Twin of seed_static.py _pct_chip. */
function pctChip(q){
  var net=q.netChange,p=q.pctChange;
  var flat=net!=null?AG.px.quarters(net)===0:Number(Math.abs(p).toFixed(2))===0;
  if(flat)return{t:'(unch)',c:'nc'};
  return{t:'('+AG.px.pct(p)+')',c:(net!=null?net:p)>0?'up':'dn'};
}
function setTxt(id,t){var e=document.getElementById(id);if(e)e.textContent=t;}
/* ONE QUOTE PER CONTRACT (2026-10-16). Every card that names a market reads
   that market's dated nearby: the <root>-nearby alias (fetch_prices
   add_nearby), else the nearest dated month on file (the fetcher writes only
   live months), else the continuous series, labeled most-active. The corn
   page's wheat card read ZW=F (-10 1/2) while the wheat page read ZWZ26
   (-11 1/4) at the same refresh. {d, label} or null; label null means the
   continuous series. Twin: scripts/seed_static.py nearby_of. */
function nearbyOf(q,root){
  if(!q||!root)return null;
  var MONS3=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  var n=q[root+'-nearby'];
  if(n&&n.close!=null)return {d:n,label:n.contract||contractLabel(n)||null};
  var re=new RegExp('^'+root+'-([a-z]{3})(\\d{2})$'),best=null,bi=Infinity,bl=null;
  for(var k in q){
    var m=re.exec(k),x=q[k],mi=m?MONS3.indexOf(m[1]):-1;
    if(mi<0||!x||x.close==null)continue;
    var i=(+m[2])*12+mi;
    if(i<bi){bi=i;best=x;bl=m[1].charAt(0).toUpperCase()+m[1].slice(1)+" '"+m[2];}
  }
  if(best)return {d:best,label:bl};
  var c=q[root];return (c&&c.close!=null)?{d:c,label:null}:null;
}
/* A gap or spread given in cents: under a dollar in cents (43½¢), a dollar
   or more in dollars ($1.48¼), never "148¼¢". o.sign
   prefixes + or a true minus. */
function amt(c,o){
  o=o||{};
  var q4=AG.px.quarters(c);
  if(Math.abs(q4)>=400)return (o.sign?(q4>0?'+':'\u2212'):'')+AG.px.price(Math.abs(c),{style:o.style});
  return AG.px.move(o.sign?c:Math.abs(c),o);
}
/* Wheat's deferred contract: the next live dated contract after the front
   (the nearby), from the forward curve (storesell.js forwardCurve: GRAIN
   calendar, dead from the 15th). Mar '27 while Dec '26 is the nearby, May '27
   once Dec dies. No dated front: the nearest live contract counts as the
   front. Twin of scripts/seed_static.py wheat_deferred. Key or null. */
function wheatDeferred(q,front){
  var rows=fwdContracts(q);if(!rows.length)return null;
  var SS=window.AgsistStoreSell,f=front&&front.ticker&&SS&&SS.futuresMonth?SS.futuresMonth(front.ticker):null;
  var fIdx=rows[0].idx;
  if(f){var p=/^(\d{4})-(\d{2})$/.exec(f.key);fIdx=(+p[1]%100)*12+(+p[2]);}
  for(var i=0;i<rows.length;i++){var r=rows[i],d=q[r.key];if(r.idx>fIdx&&!(front&&d&&d.ticker===front.ticker))return r.key;}
  return null;
}
/* "Dec '26" from a dated quote's ticker (ZCZ26.CBT), else null. */
/* BOARD CRUSH, named months only. Nov beans crush against Dec meal and oil;
   any other bean month against the same month of meal and oil. A missing leg
   hides the card: the old continuous ZM=F/ZL=F against a dated bean month
   mixed contracts nobody named. Gross: 44 lb of meal and 11 lb of oil per
   bushel, minus the beans, before any plant cost. */
var MON3=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function boardCrush(q,front){
  var m=front&&/^ZS([FGHJKMNQUVXZ])(\d{2})/.exec(String(front.ticker||''));
  if(!m||!front.close)return null;
  var mi='FGHJKMNQUVXZ'.indexOf(m[1]),pm=mi===10?11:mi,yy=m[2];
  var meal=q['meal-'+MON3[pm]+yy],oil=q['soyoil-'+MON3[pm]+yy];
  if(!meal||!oil||meal.close==null||oil.close==null||meal.stale||oil.stale)return null;
  var crush=(meal.close/2000)*44+(oil.close/100)*11-front.close/100;
  return {crush:crush,meal:meal,oil:oil,band:crush<0.75?0:crush<1.5?1:crush<2.5?2:3,
          months:AG.px.contract(MON3[pm]+' 20'+yy)+' meal and oil, '+AG.px.contract(MON3[mi]+' 20'+yy)+' beans'};
}
/* The wheat-corn feed spread, same month for both: the next Dec that trades.
   It read Sep '26 keys that stopped trading in September and went blank. */
function wheatCornPair(q){
  var y=new Date().getFullYear()%100;
  for(var k=0;k<2;k++){var yy=String(y+k),w=q['wheat-dec'+yy],c=q['corn-dec'+yy];
    if(w&&c&&w.close!=null&&c.close!=null&&!w.stale&&!c.stale)return {w:w,c:c,label:"Dec '"+yy};}
  return null;
}
/* NEW CROP is next year's crop once this one is in the bin (Sep 1 on): in
   October 2026 that is Dec '27 corn and Nov '27 beans. The undated corn-dec
   key is the next live Dec, which in the fall is the hero's own contract, so
   a "new crop" tile on it repeated the hero (agecon review, 2026-10-12). */
/* chaos-10 (2026-10-17): on the contract roll, not the calendar. On Sep 1
   2027 the nearby is still Sep '27 and Dec '27 is the harvest contract, so
   new crop is Dec '27 until Dec '27 is itself the nearby (then Dec '28).
   With no dated nearby on file, the calendar rule (Sep 1 on) stands. */
function newCropKey(root,mon,q){
  var FC='FGHJKMNQUVXZ',hm=MON3.indexOf(mon)+1,n=q&&q[root+'-nearby'],m=n&&/^[A-Z]{2}([FGHJKMNQUVXZ])(\d{2})\b/.exec(String(n.ticker||''));
  var y;
  if(m&&hm>0){var ny=2000+(+m[2]),nm=FC.indexOf(m[1])+1;y=nm>=hm?ny+1:ny;}
  else{var d=new Date();y=d.getFullYear()+(d.getMonth()>=8?1:0);}
  return root+'-'+mon+String(y).slice(-2);
}
function contractLabel(d){var SS=window.AgsistStoreSell,f=SS&&SS.futuresMonth&&d&&SS.futuresMonth(d.ticker);return f?f.label:null;}
/* The quote the page leads with: the dated nearby contract when the pipeline
   publishes it with a price, else the continuous series (labeled as such). */
function frontQuote(q){if(!q)return null;var n=q[CROP_KEY+'-nearby'];return (n&&n.close!=null)?n:(q[CROP_KEY]||null);}
function frontInfo(q,data){
  var n=q&&q[CROP_KEY+'-nearby'],nearby=!!(n&&n.close!=null);
  var c=nearby?(n.contract||(data&&data.nearby&&data.nearby[CROP_KEY]&&data.nearby[CROP_KEY].label)||'contract'):null;
  return {q:frontQuote(q),nearby:nearby,label:nearby?('Nearby '+c):('Most-active ('+CROP.root+')')};
}
function pctInRange(x){var pct=Math.round(Math.min(100,Math.max(0,(x.close-x.wk52_lo)/(x.wk52_hi-x.wk52_lo)*100)));window.__agsistMR.priceCtx={pct:pct,cropKey:CROP_KEY};return pct;}
function plantingRatio(data){return (data&&data.planting_ratio&&data.planting_ratio.value)?data.planting_ratio:null;}
/* Planting ratio card (corn and soybean pages): the pipeline's pair
   (fetch_prices planting_ratio: next year's Nov beans / Dec corn once
   September corn is off the board, this year's before), named on the card.
   No ratio published: the card hides. */
function renderRatio(data,interp){
  var PR=plantingRatio(data);
  var cbCard=document.getElementById('cb-ratio');cbCard=cbCard&&cbCard.closest?cbCard.closest('.rat-card'):null;
  if(!PR&&cbCard)cbCard.style.display='none';
  if(!PR)return;
  var ratio=PR.value;
  setEl('cb-pair',PR.label+(PR.crop_year?' · '+PR.crop_year+' planting':''));
  setEl('cb-ratio',ratio.toFixed(2)+':1');
  var gp=Math.min(100,Math.max(0,(ratio-2)/1*100));
  var dot=document.getElementById('cb-dot');if(dot)dot.style.left='calc('+gp+'% - 8px)';
  /* innerHTML: the corn line carries an icon (setEl, textContent, printed the <svg> markup as text) */
  var e=document.getElementById('cb-interp');if(e){e.innerHTML=interp(ratio);e.classList.remove('sk');}
}




// ============ MARKET READ ASSEMBLY (v12 refactor) ============
// Single state object so any data source (price/crop/cot/breakeven) can
// re-trigger a render without the others stomping on each other.
window.__agsistMR={base:[],crop:[],cot:[],basis:[],breakeven:null};


// ============ CROP PROGRESS (USDA NASS) ============
/* planting_pct is the last PCT PLANTED ever reported (a June figure), so it is only valid while the report itself is Apr-Jul */
function plantingValid(d){var m=/^\d{4}-(\d{2})/.exec(d&&d.report_date||'');var mo=m?+m[1]:(new Date().getMonth()+1);return mo>=4&&mo<=7;}

function buildCropPhrases(cropData){
  if(!cropData||!CROP_PROGRESS_KEY||!cropData[CROP_PROGRESS_KEY])return [];
  var cp=cropData[CROP_PROGRESS_KEY];
  var phrases=[];
  if(plantingValid(cp)&&cp.planting_pct!=null&&cp.planting_prev_year!=null){
    var diff=cp.planting_pct-cp.planting_prev_year;
    if(Math.abs(diff)>5){
      var tag;
      if(diff<-15)tag='significantly behind pace, historically supportive for prices';
      else if(diff<0)tag='running behind pace';
      else if(diff>15)tag='running well ahead of pace: modest bearish bias';
      else tag='running ahead of pace';
      phrases.push('with planting at <strong>'+cp.planting_pct+'% complete vs '+cp.planting_prev_year+'% prior year</strong>, '+tag);
    }
  }
  if(cp.good_excellent!=null&&cp.good_excellent_prev_year!=null){
    var ged=cp.good_excellent-cp.good_excellent_prev_year;
    if(Math.abs(ged)>=4){
      phrases.push('crop condition at <strong>'+cp.good_excellent+'% good/excellent vs '+cp.good_excellent_prev_year+'% prior year</strong> ('+Math.abs(ged)+' points '+(ged>0?'better':'worse')+')');
    }
  }
  return phrases;
}


function renderCropProgress(data){
  var card=document.getElementById('crop-card');
  if(!card)return;
  if(!data||!CROP_PROGRESS_KEY||!data[CROP_PROGRESS_KEY]){card.style.display='none';return;}
  var d=data[CROP_PROGRESS_KEY];
  if((d.planting_pct==null||!plantingValid(d))&&d.good_excellent==null&&d.good_excellent_prev_year==null){card.style.display='none';return;}
  card.style.display='block';

  // Planting section
  var plantSec=document.getElementById('crop-plant-sec');
  if(plantingValid(d)&&d.planting_pct!=null){
    if(plantSec)plantSec.style.display='block';
    var fill=document.getElementById('crop-plant-fill');if(fill)fill.style.width=d.planting_pct+'%';
    var pct=document.getElementById('crop-plant-bar-pct');if(pct)pct.textContent=d.planting_pct+'%';
    var prevWk=document.getElementById('crop-plant-prev');
    if(prevWk){
      if(d.planting_prev_year!=null)prevWk.innerHTML='Prior year same week: <span class="v">'+d.planting_prev_year+'%</span>';
      else prevWk.textContent='';
    }
    var pace=document.getElementById('crop-plant-pace');
    if(pace&&d.planting_prev_year!=null){
      var diff=d.planting_pct-d.planting_prev_year;
      if(Math.abs(diff)<=3){pace.textContent='On pace: even with prior year';pace.className='crop-pace onpace';}
      else if(diff<0){pace.textContent='Behind pace: '+Math.abs(diff)+' points vs prior year';pace.className='crop-pace behind';}
      else{pace.textContent='Ahead of pace: '+diff+' points vs prior year';pace.className='crop-pace ahead';}
      pace.style.display='block';
    }else if(pace){pace.style.display='none';}
  }else if(plantSec){plantSec.style.display='none';}

  // Good/Excellent section
  var geSec=document.getElementById('crop-ge-sec');
  if(d.good_excellent!=null){
    if(geSec)geSec.style.display='block';
    var fill=document.getElementById('crop-ge-fill');if(fill)fill.style.width=d.good_excellent+'%';
    var pct=document.getElementById('crop-ge-bar-pct');if(pct)pct.textContent=d.good_excellent+'% G/E';
    var pendingEl=document.getElementById('crop-ge-pending');if(pendingEl)pendingEl.style.display='none';
    var prevWk=document.getElementById('crop-ge-prev-week');
    if(prevWk&&d.good_excellent_prev_week!=null){
      var wkChg=d.good_excellent-d.good_excellent_prev_week;
      var s=wkChg>0?'+':wkChg<0?'':'';
      prevWk.innerHTML='Prior week: <span class="v">'+d.good_excellent_prev_week+'%</span> ('+s+wkChg+' pts wk-over-wk)';
    }else if(prevWk)prevWk.textContent='';
    var prevYr=document.getElementById('crop-ge-prev-yr');
    if(prevYr&&d.good_excellent_prev_year!=null){
      prevYr.innerHTML='Prior year same week: <span class="v">'+d.good_excellent_prev_year+'%</span>';
    }else if(prevYr)prevYr.textContent='';
  }else{
    // G/E pending: show context if we have a prior-year value
    if(geSec)geSec.style.display='block';
    var fill=document.getElementById('crop-ge-fill');if(fill)fill.style.width='0%';
    var pct=document.getElementById('crop-ge-bar-pct');if(pct)pct.textContent='-';
    var pendingEl=document.getElementById('crop-ge-pending');
    if(pendingEl){
      var prevYr=d.good_excellent_prev_year;
      pendingEl.innerHTML=prevYr!=null?'Condition reporting begins later this season. Prior year same week: <span class="v" style="color:var(--text);font-family:JetBrains Mono,monospace;font-weight:600">'+prevYr+'%</span>.':'Condition reporting not yet available for current season.';
      pendingEl.style.display='block';
    }
    var prevWk=document.getElementById('crop-ge-prev-week');if(prevWk)prevWk.textContent='';
    var prevYrEl=document.getElementById('crop-ge-prev-yr');if(prevYrEl)prevYrEl.textContent='';
  }

  // As-of stamp
  var asof=document.getElementById('crop-asof');
  if(asof){
    var stamp=d.report_date||data.report_date||data.updated;
    if(window.AgAsOf&&data.updated)asof.innerHTML=(d.report_date||data.report_date?'Week ending '+(d.report_date||data.report_date)+' \u00b7 ':'')+AgAsOf.html(data.updated,'usda');
    else if(stamp)asof.textContent='Updated '+stamp;
  }
}


// ============ COT POSITIONING (CFTC Disaggregated) ============
/* ONE MEASURE OF "CROWDED" (2026-10-10). The three futures pages ranked funds
   by where the net sat between its 52-week low and high in contracts ("86% of
   52-wk range, crowded long: unwind risk"), the COT page by the full-record
   percentile of net as a share of open interest ("81st percentile, high side
   but not extreme"), and the prediction bot by a three-year percentile. One
   word, three answers. Every ranked statement here now comes from the COT
   page's measure, published per market in data/cot-analysis.json `crowd` by
   scripts/cot_analysis.py: the percentile since 2010, its word, whether it is
   crowded (top or bottom tenth on the side the position is on) and what the
   COT page's tests found about it. The 52-week figure in contracts is kept
   under "show the math" as a second yardstick, never as the ranking.
   cot.json still supplies the net, the week's change and the wheat classes;
   when its report date and the analysis's differ, no percentile is printed. */
var COT_CX=null;   // data/cot-analysis.json commodity for this crop, when it matches cot.json's week
function cotIsoDay(s){var d=new Date(String(s||'')+(/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?'T12:00:00':''));if(isNaN(d))return '';return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);}
function cotCrowd(){
  var c=COT_CX;if(!c)return null;
  var cr=c.crowd||null,p=cr?cr.pctl:(c.pctl&&c.pctl.net_oi_all);
  if(p==null)return null;
  return {pctl:p,word:cr?cr.word:null,crowded:cr?cr.crowded:(c.crowded||null),side:c.net>0?'long':c.net<0?'short':'flat',
          since:(cr&&cr.since)||String(c.first_week||'').slice(0,4)||'2010',weeks:(cr&&cr.weeks)||c.weeks_of_history||null,
          tested:cr?cr.tested:null};
}
function buildCOTPhrases(cotData){
  if(!cotData||!cotData[CROP_KEY])return [];
  var d=cotData[CROP_KEY],k=cotCrowd();
  if(d.net==null||!k)return [];
  var side=d.net>0?'net long':d.net<0?'net short':'flat';
  return ['managed money'+(CROP.cotClasses?' in Chicago SRW':'')+' is <strong>'+side+'</strong>, at the '+Math.round(k.pctl)+ord(Math.round(k.pctl))+' percentile of its record since '+k.since+' as a share of open interest ('+(k.crowded?'crowded '+k.crowded:(k.word||'not crowded'))+')'];
}

function cotStrip(data){
  /* wheat: 3-class strip, Chicago SRW / KC HRW / Mpls HRS: net, side, week
     change (net minus prev). KC and Mpls often sit on the opposite side of
     Chicago; a KS or ND grower needs his own class. */
  var strip=document.getElementById('cot-classes');
  if(!strip||!CROP.cotClasses)return;
  var html='';
  CROP.cotClasses.forEach(function(r){
    var c=data[r[0]];
    if(!c||c.net==null)return;
    var side=c.net>=0?'net long':'net short';
    var chg='';
    if(c.prev!=null){
      var dl=c.net-c.prev;
      chg=' · wk chg <span class="delta '+(dl>=0?'up':'dn')+'" style="font-family:JetBrains Mono,monospace;font-weight:700">'+fmtKContracts(dl)+'</span>';
    }
    html+='<div class="cot-cls-row"><span class="cot-cls-name">'+r[1]+'</span><span><span class="cot-cls-net '+(c.net>=0?'long':'short')+'">'+fmtKContracts(c.net)+'</span> <span class="cot-cls-chg">'+side+chg+'</span></span></div>';
  });
  strip.innerHTML=html;
}

function renderCOT(data){
  var card=document.getElementById('cot-card');
  if(!card)return;
  if(!data||!data[CROP_KEY]){card.style.display='none';return;}
  var d=data[CROP_KEY];
  if(d.net==null){card.style.display='none';return;}
  card.style.display='block';

  // Net contracts
  var netEl=document.getElementById('cot-net');
  if(netEl){netEl.textContent=fmtKContracts(d.net);netEl.className='cot-net '+(d.net>=0?'long':'short');}
  var subEl=document.getElementById('cot-sub');
  if(subEl)subEl.textContent=(d.net>=0?'net long':'net short')+' contracts (managed money, futures-only)';
  cotStrip(data);

  // The ranking: share of open interest, every week since 2010.
  var k=cotCrowd(),gauge=document.getElementById('cot-gauge-wrap'),pctEl=document.getElementById('cot-pct');
  if(k){
    if(gauge)gauge.style.display='';
    var p=Math.max(0,Math.min(100,k.pctl)),pr=Math.round(k.pctl);
    var dot=document.getElementById('cot-dot');if(dot)dot.style.left='calc('+p+'% - 8px)';
    if(pctEl)pctEl.innerHTML=(CROP.cotClasses?'Chicago SRW: ':'')+'<strong>'+pr+ord(pr)+' percentile</strong> since '+k.since+', as a share of open interest'+(k.word?': '+k.word:'')+(k.crowded?', crowded '+k.crowded:'');
  }else if(gauge){gauge.style.display='none';}

  // Week change
  var chgEl=document.getElementById('cot-chg');
  if(chgEl){
    if(d.prev!=null){
      var delta=d.net-d.prev;
      var dir;
      if(delta>0&&d.net>=0)dir='added longs';
      else if(delta>0&&d.net<0)dir='covered shorts';
      else if(delta<0&&d.net>0)dir='trimmed longs';
      else if(delta<0&&d.net<0)dir='added shorts';
      else dir='unchanged';
      chgEl.innerHTML='Week-over-week: <span class="delta '+(delta>=0?'up':'dn')+'">'+fmtKContracts(delta)+'</span> contracts ('+dir+')';
    }else{chgEl.style.display='none';}
  }

  // Interpretation: the COT page's tested result, not "crowded longs unwind hard".
  var interp,where=CROP.cotClasses?'In Chicago SRW, f':'F',side=d.net>0?'long':d.net<0?'short':'flat';
  /* Before the pipeline publishes its crowd words, say the percentile itself. */
  var kw=k?(k.word||('at the '+Math.round(k.pctl)+ord(Math.round(k.pctl))+' percentile')):'';
  if(!k){interp=where+'unds are net '+side+'. The percentile against the record is not shown: the analysis file is not from the same week as these positions.';}
  else if(k.crowded){interp='<strong>'+where+'unds are crowded '+k.crowded+'</strong>: '+kw+' of their record since '+k.since+', measured as a share of open interest. '+(k.tested||'');}
  else{interp='<strong>'+where+'unds are net '+side+', '+kw+'</strong> against their record since '+k.since+', not crowded. '+(k.tested||'');}
  if(CROP.cotClasses&&data.kcwheat&&data.kcwheat.net!=null&&d.net!=null&&((data.kcwheat.net>=0)!==(d.net>=0))){
    interp+=' The classes are split: KC HRW funds sit on the opposite side of Chicago right now, so read the row for your class above.';
  }
  var interpEl=document.getElementById('cot-interp');
  if(interpEl)interpEl.innerHTML=interp;

  // Show the math: the measure, its sample, and the 52-week yardstick in contracts.
  var mathEl=document.getElementById('cot-math');
  if(!mathEl&&interpEl){mathEl=document.createElement('details');mathEl.id='cot-math';mathEl.className='cot-math';mathEl.style.cssText='margin-top:.5rem;font-size:.85rem;color:var(--text-dim)';interpEl.parentNode.insertBefore(mathEl,interpEl.nextSibling);}
  if(mathEl){
    var m='<summary style="cursor:pointer">Show the math</summary><p style="margin:.4rem 0">';
    if(k)m+='Ranking: managed-money net (long minus short) divided by open interest, ranked against '+(k.weeks?Number(k.weeks).toLocaleString('en-US')+' weeks':'every week')+' since '+k.since+'. Crowded means the top or bottom tenth of that record, on the side the position is on. Source: CFTC Disaggregated futures-only report; percentile computed by AGSIST from the weekly history (the same figure the <a href="/cot">positioning page</a> shows). ';
    if(d.min52!=null&&d.max52!=null&&d.max52>d.min52){
      var p52=Math.max(0,Math.min(100,Math.round(((d.net-d.min52)/(d.max52-d.min52))*100)));
      /* 2026-10-17 audit N9: /cot gives a percentile under the same words; this is a place in the range, so it says that, and the two never read as one number */
      m+='Where the net sits in its 52-week range, in contracts: '+p52+'% of the way from the low ('+fmtKContracts(d.min52)+') to the high ('+fmtKContracts(d.max52)+'). That is a place in the range, not the percentile /cot shows. Contracts are not adjusted for the size of the market, so this is not the ranking.';
    }
    mathEl.innerHTML=m+'</p>';
  }

  // As-of
  var asof=document.getElementById('cot-asof');
  if(asof&&data.report_date){asof.textContent='As of '+data.report_date;if(window.AgAsOf&&data.updated)asof.innerHTML='Positions as of '+data.report_date+' · '+AgAsOf.html(data.updated,'usda');}
}

function fmtKContracts(n){
  if(n==null)return '-';
  var sign=n>=0?'+':'\u2212';
  var abs=Math.abs(n);
  return sign+(abs>=1000?(abs/1000).toFixed(1)+'k':abs);
}

function loadCropProgress(){
  if(CROP.cropProgress){CROP.cropProgress();return;}
  if(!CROP_PROGRESS_KEY)return;
  fetch('/data/crop-progress.json',{cache:'no-store'})
    .then(function(r){return r.ok?r.json():null;})
    .then(function(d){if(!d)return;renderCropProgress(d);window.__agsistMR.crop=buildCropPhrases(d);if(d&&CROP_PROGRESS_KEY&&d[CROP_PROGRESS_KEY]){var __cd=d[CROP_PROGRESS_KEY];window.__agsistMR.cropCtx={planting_diff:(__cd.planting_pct!=null&&__cd.planting_prev_year!=null)?(__cd.planting_pct-__cd.planting_prev_year):null,ge_diff:(__cd.good_excellent!=null&&__cd.good_excellent_prev_year!=null)?(__cd.good_excellent-__cd.good_excellent_prev_year):null};}renderMarketRead();})
    .catch(function(){var c=document.getElementById('crop-card');if(c)c.style.display='none';});
}


// ============ CROP PROGRESS (USDA NASS): wheat, what is in season now ============
/* 2026-10-16: on Oct 16 the card showed "Spring wheat: 51% good/excellent,
   report 2026-08-23", seven weeks old and the wrong crop for October. A row now
   shows only when its report is 10 days old or less (one weekly report plus a
   holiday delay), and the fall rows come from the national progress block:
   winter wheat planted and emerged against the 5-year average. Pure: rows from
   crop-progress.json and a clock. */
function cpAgeDays(ds,nowMs){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(ds||'');if(!m)return null;return Math.floor((nowMs-Date.UTC(+m[1],+m[2]-1,+m[3]))/864e5);}
/* "2026-10-11" -> "Oct 11, 2026" */
function isoMDY(x){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(x||'');return m?['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m[2]-1]+' '+(+m[3])+', '+m[1]:'';}
function wheatProgressRows(d,nowMs){
  var WHEAT_PROGRESS_MAX_DAYS=10;
  if(!d)return [];
  var rows=[],P=d.progress||{},ww=d.winter_wheat||{},sw=d.spring_wheat||{};
  function fresh(ds){var a=cpAgeDays(ds,nowMs);return a!=null&&a>=0&&a<=WHEAT_PROGRESS_MAX_DAYS;}
  function pr(key,lbl){var x=P[key];if(x&&x.pct!=null&&fresh(x.date))rows.push({lbl:lbl,val:x.pct+'%',prevYr:x.prev_year,avg5:x.avg5,date:x.date});}
  pr('winter_wheat_planted','Winter wheat planted');
  pr('winter_wheat_emerged','Winter wheat emerged');
  if(ww.good_excellent!=null&&fresh(ww.report_date))rows.push({lbl:'Winter wheat condition',val:ww.good_excellent+'% good/excellent',prevYr:ww.good_excellent_prev_year,date:ww.report_date});
  if(ww.harvest_pct!=null&&ww.harvest_pct<100&&fresh(ww.report_date))rows.push({lbl:'Winter wheat harvested',val:ww.harvest_pct+'%',prevYr:ww.harvest_prev_year,date:ww.report_date});
  if(sw.good_excellent!=null&&fresh(sw.report_date))rows.push({lbl:'Spring wheat condition',val:sw.good_excellent+'% good/excellent',prevYr:sw.good_excellent_prev_year,date:sw.report_date});
  if(sw.harvest_pct!=null&&sw.harvest_pct<100&&fresh(sw.report_date))rows.push({lbl:'Spring wheat harvested',val:sw.harvest_pct+'%',prevYr:sw.harvest_prev_year,date:sw.report_date});
  return rows;
}
function wheatCropProgress(){
  fetch('/data/crop-progress.json',{cache:'no-store'})
    .then(function(r){return r.ok?r.json():null;})
    .then(function(d){
      var card=document.getElementById('crop-card'),box=document.getElementById('cp-rows');
      if(!card)return;
      var rows=wheatProgressRows(d,Date.now());
      if(!rows.length||!box){card.style.display='none';return;}
      var anyAvg=false,dates={};
      box.innerHTML=rows.map(function(r){
        var ex=[];
        if(r.avg5!=null){ex.push('5-yr avg '+r.avg5+'%');anyAvg=true;}
        if(r.prevYr!=null)ex.push('last year '+r.prevYr+'%');
        dates[r.date]=1;
        return '<div class="crop-row"><span>'+esc(r.lbl)+': <span class="v">'+esc(r.val)+'</span>'+(ex.length?' ('+esc(ex.join(', '))+')':'')+'</span></div>';
      }).join('');
      var ds=Object.keys(dates).sort();
      var asof=document.getElementById('crop-asof');
      if(asof)asof.textContent=ds.length?'Week ending '+isoMDY(ds[ds.length-1]):'';
      var avgNote=document.getElementById('cp-avg-note');
      if(avgNote)avgNote.style.display=anyAvg?'':'none';
      card.style.display='block';
    })
    .catch(function(){var c=document.getElementById('crop-card');if(c)c.style.display='none';});
}


// ============ EXPORT PACE (USDA FAS weekly export sales) ============
function loadExportPace(){
  fetch('/data/export-sales.json',{cache:'no-store'})
    .then(function(r){return r.ok?r.json():null;})
    .then(function(d){
      if(!d||!d.wheat||d.wheat.pct_of_target==null)return;
      var card=document.getElementById('export-card'),line=document.getElementById('export-line');
      if(!card||!line)return;
      var w=d.wheat;
      var t='US export sales: MY '+(d.marketing_year||'-')+': <strong>'+w.pct_of_target+'% of USDA target</strong>';
      if(w.weekly_net_mt!=null)t+=' \u00b7 weekly net '+Number(w.weekly_net_mt).toLocaleString('en-US')+' t';
      if(w.report_date)t+=' \u00b7 through '+w.report_date;
      line.innerHTML=t;
      card.style.display='block';
    })
    .catch(function(){});
}


function loadCOT(){
  function J(u){return fetch(u,{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;});}
  Promise.all([J('/data/cot.json'),J('/data/cot-analysis.json')])
    .then(function(R){
      var d=R[0],a=R[1];if(!d)throw new Error('no cot');
      var c=a&&a.commodities&&a.commodities[CROP_KEY];
      /* two files, one week: the percentile is printed only when the analysis is for the positions on the card */
      COT_CX=(c&&c.date&&cotIsoDay(c.date)===cotIsoDay(d.report_date))?c:null;
      renderCOT(d);window.__agsistMR.cot=buildCOTPhrases(d);
      var k=cotCrowd();
      window.__agsistMR.cotCtx=k?{pct:k.pctl,crowded:k.crowded,word:k.word,since:k.since,tested:k.tested}:null;
      renderMarketRead();
    })
    .catch(function(){var c=document.getElementById('cot-card');if(c)c.style.display='none';});
}


// ============ NEXT USDA REPORT (S3) ============
// Uses the pipeline-published upcoming report from /data/whats-priced-in.json.
// Never computes a guessed date; hides the line entirely on failure.
function loadWasde(){
  function hide(){var w=document.getElementById('snap-wasde-wrap');if(w)w.style.display='none';}
  fetch('/data/whats-priced-in.json',{cache:'no-store'})
    .then(function(r){return r.ok?r.json():null;})
    .then(function(d){
      var up=d&&d.upcoming;
      var wEl=document.getElementById('snap-wasde');
      if(!up||!up.report||!up.date||!wEl){hide();return;}
      var MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var MF=['January','February','March','April','May','June','July','August','September','October','November','December'];
      function show(name,iso){
        var p=String(iso).split('-');
        if(p.length!==3)return false;
        var dt=new Date(parseInt(p[0],10),parseInt(p[1],10)-1,parseInt(p[2],10));
        if(isNaN(dt.getTime()))return false;
        var today=new Date();today.setHours(0,0,0,0);
        var dd=Math.round((dt-today)/86400000);
        if(dd<0)return false;
        wEl.textContent=name+' · '+MN[dt.getMonth()]+' '+dt.getDate()+' · '+(dd===0?'today':dd===1?'tomorrow':'in '+dd+' days');
        maybeFlagWasdeImminence(dd);
        return true;
      }
      if(show(up.report,up.date))return;
      /* chaos-11 (2026-10-17): the file's "upcoming" report is past (the
         file lags). "Next report" rolls to the next WASDE in the site's own
         calendar file (/usda-calendar.ics, built from /usda-calendar); with
         none listed, the line hides rather than name a past report. */
      return fetch('/usda-calendar.ics',{cache:'no-cache'}).then(function(r){return r.ok?r.text():'';}).then(function(t){
        var next=null,now=Date.now();
        String(t||'').split('BEGIN:VEVENT').slice(1).forEach(function(ev){
          var sm=/\nSUMMARY:([^\r\n]*)/.exec(ev),dm=/\nDTSTART(?:;[^:]*)?:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?/.exec(ev);
          if(!sm||!dm||!/^WASDE\b/.test(sm[1].trim()))return;
          var at=dm[4]!=null?Date.UTC(+dm[1],+dm[2]-1,+dm[3],+dm[4],+dm[5]):Date.UTC(+dm[1],+dm[2]-1,+dm[3],17);
          if(at>now&&(!next||at<next.at))next={at:at,iso:dm[1]+'-'+dm[2]+'-'+dm[3],m:+dm[2]-1};
        });
        if(!next||!show(MF[next.m]+' WASDE',next.iso))hide();
      });
    })
    .catch(hide);
}



// ============ MARKET SESSION (v13) ============
// CME grain futures: Sun-Fri overnight 7:00 PM CT - 7:45 AM CT (next day),
// Mon-Fri day session 8:30 AM CT - 1:20 PM CT.
// Returns {state:'open'|'overnight'|'closed', label, sub} where sub is a brief countdown/context.
function computeMarketSession(){
  // Get current Central Time using Intl
  var fmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',weekday:'short',hour:'numeric',minute:'numeric',hour12:false});
  var parts=fmt.formatToParts(new Date());
  var dayName=parts.find(function(p){return p.type==='weekday';}).value; // Sun,Mon,Tue,Wed,Thu,Fri,Sat
  var hourStr=parts.find(function(p){return p.type==='hour';}).value;
  var minStr=parts.find(function(p){return p.type==='minute';}).value;
  var hr=parseInt(hourStr,10); if(hr===24)hr=0; // some impls return 24 for midnight
  var mn=parseInt(minStr,10);
  var dayMap={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  var dow=dayMap[dayName];
  var tod=hr*60+mn; // minutes since midnight CT

  var DAY_OPEN=8*60+30,    // 510  - 8:30 AM
      DAY_CLOSE=13*60+20,  // 800  - 1:20 PM
      OVN_OPEN=19*60,      // 1140 - 7:00 PM
      OVN_CLOSE=7*60+45;   // 465  - 7:45 AM

  function pad2(n){return n<10?'0'+n:''+n;}
  function untilToday(targetMin){
    var d=targetMin-tod;
    if(d<=0)return null;
    var h=Math.floor(d/60),m=d%60;
    return (h>0?h+'h ':'')+m+'m';
  }
  function fmtUntil(mins){
    if(mins<=0)return '0m';
    var h=Math.floor(mins/60),m=mins%60;
    if(h>=24){var dys=Math.floor(h/24);return dys+'d '+(h%24)+'h';}
    return (h>0?h+'h ':'')+m+'m';
  }

  // Saturday: closed all day until Sunday 7pm
  if(dow===6){
    var minsToSunOpen=(24-hr)*60-mn+OVN_OPEN; // rest of Sat + Sun until 7pm
    return {state:'closed',label:'Weekend',sub:'reopens Sun '+fmtUntil(minsToSunOpen)};
  }
  // Sunday: closed until 7pm CT
  if(dow===0){
    if(tod<OVN_OPEN){
      return {state:'closed',label:'Weekend',sub:'reopens '+untilToday(OVN_OPEN)};
    }
    // Sunday >= 7pm: overnight session running into Monday 7:45am
    var minsToMonOvnEnd=(24-hr)*60-mn+OVN_CLOSE;
    return {state:'overnight',label:'Overnight Session',sub:'day session opens 8:30am CT'};
  }
  // Mon-Fri logic
  // Pre-7:45 AM: still in overnight from last session
  if(tod<OVN_CLOSE){
    return {state:'overnight',label:'Overnight Session',sub:'day session opens '+untilToday(DAY_OPEN)};
  }
  // 7:45-8:30 AM: pause between sessions
  if(tod<DAY_OPEN){
    return {state:'closed',label:'Pre-Open',sub:'day session opens '+untilToday(DAY_OPEN)};
  }
  // 8:30 AM - 1:20 PM: day session open
  if(tod<DAY_CLOSE){
    return {state:'open',label:'Day Session Open',sub:'closes '+untilToday(DAY_CLOSE)};
  }
  // 1:20 PM - 7:00 PM: closed; reopens overnight at 7pm same day (M-Th) or Sunday (Fri)
  if(tod<OVN_OPEN){
    if(dow===5){ // Friday afternoon: closed until Sunday 7pm
      var minsToSun=(2*24*60)-tod+OVN_OPEN;
      return {state:'closed',label:'Market Closed',sub:'reopens Sun '+fmtUntil(minsToSun)};
    }
    return {state:'closed',label:'Market Closed',sub:'overnight reopens '+untilToday(OVN_OPEN)};
  }
  // 7 PM onwards: overnight session
  if(dow===5){ // Friday evening: there's no Friday overnight; market closed until Sunday
    var minsToSun=2*24*60-tod+OVN_OPEN;
    return {state:'closed',label:'Weekend',sub:'reopens Sun '+fmtUntil(minsToSun)};
  }
  return {state:'overnight',label:'Overnight Session',sub:'day session opens 8:30am CT'};
}


function renderMarketSession(){
  var badge=document.getElementById('session-badge');
  if(!badge)return;
  var s=computeMarketSession();
  badge.className='session-badge '+s.state;
  badge.innerHTML='<span class="dot" aria-hidden="true"></span>'+s.label+'<span class="session-sub">'+s.sub+'</span>';
}

/* draw the badge now, not at DOMContentLoaded: "Loading…" then the real badge rewrapped the status row */
try{renderMarketSession();}catch(e){}


// ============ MARKET READ ASSEMBLY (v13 sectioned refactor) ============
// Replaces v12 single-paragraph render with 3-section render.
// State unchanged: {base, crop, cot, breakeven, price}.
// New: buildActionLine(state, ctx) synthesizes a "what I'd do" framework line.

function renderMarketRead(){
  var mr=window.__agsistMR;
  if(!mr||!mr.base||mr.base.length===0)return;
  var whereEl=document.getElementById('mr-where');
  var whatEl=document.getElementById('mr-what');
  var doEl=document.getElementById('mr-do');
  var doWrap=document.getElementById('mr-do-wrap');
  if(!whereEl||!whatEl)return;

  // WHERE: first phrase from base[] (always the price-percentile phrase)
  var wherePhrase=mr.base[0]||'';
  whereEl.innerHTML=wherePhrase?(cap(wherePhrase)+'.'):'';

  // WHAT: remaining base phrases + crop + COT + basis
  var whatPhrases=[];
  for(var i=1;i<mr.base.length;i++)whatPhrases.push(mr.base[i]);
  if(mr.crop&&mr.crop.length)whatPhrases=whatPhrases.concat(mr.crop);
  if(mr.cot&&mr.cot.length)whatPhrases=whatPhrases.concat(mr.cot);
  if(mr.basis&&mr.basis.length)whatPhrases=whatPhrases.concat(mr.basis);
  whatEl.innerHTML=whatPhrases.length?(cap(whatPhrases.join('; '))+'.'):'<span class="sr-only">Loading fundamentals</span><span class="st-sk st-line" aria-hidden="true"></span><span class="st-sk st-line" aria-hidden="true"></span><span class="st-sk st-line" aria-hidden="true"></span>';

  try{renderScorecard();}catch(e){}
  // DO: action-oriented synthesis using breakeven + signal shape
  var actionLine=buildActionLine(mr);
  if(actionLine){
    if(doEl)doEl.innerHTML=actionLine;
    if(doWrap)doWrap.style.display='block';
  }else{
    if(doWrap)doWrap.style.display='none';
  }
}


function cap(s){if(!s)return s;return s.charAt(0).toUpperCase()+s.slice(1);}


// ============ PRICING SITUATION SCORECARD (visualizes existing __agsistMR factors) ============
function scMeter(pct){pct=Math.max(0,Math.min(100,pct));return '<div class="sc-f-meter"><i style="width:'+pct+'%"></i></div>';}

// ============ PRICING SITUATION SCORECARD (visualizes existing __agsistMR factors) ============
// S9: map a bid's board symbol (e.g. ZCU26, ZSX26, ZWZ26) to the matching dated
// contract in prices.json. Returns {key,label,close} or null when no dated quote
// matches; callers then print basis vs the raw symbol WITHOUT an arithmetic
// equation. One function for the three crops (it was three: corn's, soybean's
// and wheat's, each with its own month table).
function boardContractFromSymbol(sym){
  if(!sym||!window.__agsistLastQ)return null;
  var m=String(sym).toUpperCase().match(new RegExp('^'+CROP.root+'([FGHJKMNQUVXZ])(\\d{2})$'));
  if(!m)return null;
  var MC={F:'jan',G:'feb',H:'mar',J:'apr',K:'may',M:'jun',N:'jul',Q:'aug',U:'sep',V:'oct',X:'nov',Z:'dec'};
  var ML={F:'Jan',G:'Feb',H:'Mar',J:'Apr',K:'May',M:'Jun',N:'Jul',Q:'Aug',U:'Sep',V:'Oct',X:'Nov',Z:'Dec'};
  var mon=MC[m[1]],yy=m[2];
  var candidates=[CROP_KEY+'-'+mon+yy];
  for(var i=0;i<candidates.length;i++){
    var d=window.__agsistLastQ[candidates[i]];
    if(d&&d.close!=null)return {key:candidates[i],label:ML[m[1]]+" '"+yy,close:d.close};
  }
  return null;
}
function computeScorecard(){
  var mr=window.__agsistMR; if(!mr)return null;
  var p=mr.priceCtx, be=mr.breakeven, cot=mr.cotCtx, basis=mr.basisCtx, rp=mr.rpCtx;
  if(!p)return null;
  var factors=[];
  // 1. Price position in 52wk range
  var zone=p.pct<25?'lower quartile':p.pct<50?'lower half':p.pct<75?'upper half':'upper quartile';
  factors.push({lbl:'52-Week Position',val:p.pct+'% of 52-wk range',cls:'nu',meter:p.pct,det:zone+' of its range'});
  // 2. Margin vs breakeven
  if(be){
    var d=be.diff;
    factors.push({lbl:'Margin vs Breakeven',val:(d>=0?'+':'−')+'$'+Math.abs(d).toFixed(2)+'/bu',cls:d>=0?'up':'dn',meter:Math.max(0,Math.min(100,50+d*25)),det:(d>=0?'above':'below')+' your $'+be.be.toFixed(2)+' cost'});
  }else{
    factors.push({lbl:'Margin vs Breakeven',val:'-',cls:'nu',meter:0,det:'enter cost of production above'});
  }
  // 3. Fund positioning
  if(cot&&cot.pct!=null){
    var _cp=Math.round(cot.pct);
    factors.push({lbl:'Fund Positioning',val:_cp+ord(_cp)+' pct since '+cot.since,cls:'nu',meter:cot.pct,det:cot.crowded?'crowded '+cot.crowded+' (share of open interest)':(cot.word||'')+', not crowded'});
  }
  // 4. Seasonal: from /data/price-stats.json seasonality; row omitted entirely when data is unavailable
  if(window.__agsistSeas&&window.__agsistSeas.length===12){
    var mo=new Date().getMonth();
    var sv=window.__agsistSeas[mo];
    factors.push({lbl:'Seasonal Tendency',val:sv+'/100',cls:'nu',meter:sv,det:seasWin()});
  }
  // 5. RP projected price (crop insurance), only when harvest-prices has this crop.
  //    It is a price, not a floor: the guarantee is APH yield times coverage
  //    times the higher of the projected and harvest prices.
  //    Measured against the quote the page leads with (the nearby contract).
  var fq=frontQuote(window.__agsistLastQ);
  if(rp&&rp.floor!=null){
    var _bq=(fq&&fq.close!=null)?fq.close/100:null;
    var _gap=(_bq!=null)?(rp.floor-_bq):null;
    factors.push({lbl:'RP projected price',val:AG.px.priceDollars(rp.floor),cls:(_gap!=null?(_gap>=0?'up':'dn'):'nu'),meter:(_gap!=null?Math.max(0,Math.min(100,50+_gap*40)):100),det:(_gap!=null?(AG.px.quarters(_gap*100)===0?'level with today’s board':amt(_gap*100)+' '+(_gap>0?'above':'below')+' today’s board'):('projected '+(rp.window||'')+' avg'))});
  }
  // composite descriptive situation (NOT a recommendation)
  var sit='';
  if(be){
    sit=(be.diff>=0?'Above':'Below')+' breakeven · '+bandOf(p.pct);
  }else{
    sit=bandOf(p.pct).charAt(0).toUpperCase()+bandOf(p.pct).slice(1);
  }
  return {factors:factors,situation:sit,rp:rp,priceCents:(fq?fq.close:null),be:be,basis:basis};
}
function renderScorecard(){
  var sc=computeScorecard(); var card=document.getElementById('scorecard');
  if(!sc||!card)return;
  card.style.display='block';
  var sitEl=document.getElementById('sc-situation'); if(sitEl)sitEl.textContent=sc.situation;
  var fEl=document.getElementById('sc-factors');
  if(fEl){
    fEl.innerHTML=sc.factors.map(function(f){
      return '<div class="sc-f"><div class="sc-f-lbl">'+f.lbl+'</div><div class="sc-f-val '+f.cls+'">'+f.val+'</div>'+scMeter(f.meter)+'<div class="sc-f-det">'+f.det+'</div></div>';
    }).join('');
  }
  // basis-to-cash bridge: the futures leg of the equation must be the SAME contract
  // the bid's basis is quoted against (S9). No matching dated quote = no equation.
  var cashEl=document.getElementById('sc-cash');
  if(cashEl){
    if(sc.basis&&sc.basis.basis!=null){
      var bv=Number(sc.basis.basis);
      var board=boardContractFromSymbol(sc.basis.symbol);
      var line=null,cash=null;
      if(board){
        var futures=board.close/100;
        cash=(sc.basis.bidPrice!=null?Number(sc.basis.bidPrice):futures+bv);
        line='<strong>Your local cash:</strong> futures $'+futures.toFixed(2)+' (vs '+board.label+' board) '+(bv>=0?'+':'−')+' $'+Math.abs(bv).toFixed(2)+' basis = <strong>$'+cash.toFixed(2)+'/bu</strong>';
      }else if(sc.basis.bidPrice!=null){
        cash=Number(sc.basis.bidPrice);
        line='<strong>Your local cash:</strong> <strong>$'+cash.toFixed(2)+'/bu</strong> · basis '+(bv>=0?'+':'−')+'$'+Math.abs(bv).toFixed(2)+(sc.basis.symbol?' vs '+sc.basis.symbol:' vs its board contract');
      }
      if(line!=null){
        if(sc.be&&cash!=null){var cd=cash-sc.be.be;line+=', <strong class="'+(cd>=0?'sc-f-val up':'sc-f-val dn')+'" style="font-weight:700">'+(cd>=0?'+':'−')+'$'+Math.abs(cd).toFixed(2)+'/bu vs your breakeven</strong>';}
        cashEl.innerHTML=line; cashEl.style.display='block';
      }else{ cashEl.style.display='none'; }
    }else{ cashEl.style.display='none'; }
  }
  // RP revenue-floor bridge
  var rpEl=document.getElementById('sc-rp');
  if(rpEl){
    if(sc.rp&&sc.rp.floor!=null){
      var bq=(sc.priceCents!=null)?sc.priceCents/100:null;
      var L='<strong>RP projected price:</strong> <strong>'+AG.px.priceDollars(sc.rp.floor)+'</strong>'+(sc.rp.contract?' ('+AG.px.contract(sc.rp.contract)+(sc.rp.window?', '+sc.rp.window+' avg':'')+')':'');
      /* the board is a futures price, printed to the quarter cent like the hero; it is not "the cash market" */
      if(bq!=null){var g=sc.rp.floor-bq;L+=', today’s board '+AG.px.priceDollars(bq)+(AG.px.quarters(g*100)===0?', level with the board.':', <span class="rp-gap '+(g>=0?'sc-f-val up':'sc-f-val dn')+'">'+(Math.abs(g)>=1?AG.px.priceDollars(Math.abs(g)):AG.px.move(Math.abs(g)*100))+'</span> '+(g>0?'above':'below')+' the board.');}
      L+=' Your revenue guarantee is your APH yield times your coverage level times the higher of the projected and harvest prices.';
      /* 2026-10-15: "still setting" while harvest-prices.json already held the
         running average (corn $4.93, 10 of 22 days). Say it, and where it is tracked. */
      if(sc.rp.running!=null){L+=' Harvest price so far: <strong>'+AG.px.priceDollars(sc.rp.running)+'</strong>, the running average of '+sc.rp.days+(sc.rp.daysTotal?' of '+sc.rp.daysTotal:'')+' October trading days (<a href="/harvest-price-tracker">harvest price tracker</a>).';}
      else if(sc.rp.harvestPending){L+=' <span style="opacity:.7">'+CROP.rpHarvestWord+'</span>';}
      rpEl.innerHTML=L; rpEl.style.display='block';
      try{if(typeof gaEvent==='function')gaEvent('rp_floor_shown',{crop:CROP_KEY});else if(window.gtag)gtag('event','rp_floor_shown',{crop:CROP_KEY});}catch(e){}
    } else { rpEl.style.display='none'; }
  }
  renderPricedResult(sc);
}


// ---- percent priced (self-tracking + educational, NOT advice) ----
function getPriced(){try{var v=localStorage.getItem('agsist_priced_'+CROP_KEY);if(v!=null&&v!=='')return Math.max(0,Math.min(100,parseFloat(v)));}catch(e){}return null;}

function renderPricedResult(sc){
  var resEl=document.getElementById('priced-result'), eduEl=document.getElementById('sc-edu');
  var pct=getPriced();
  if(resEl){
    if(pct==null){resEl.textContent='';}
    else if(sc&&sc.be&&sc.priceCents!=null){
      var futures=sc.priceCents/100, margin=futures-sc.be.be;
      resEl.innerHTML='<strong>'+pct+'% priced</strong> \u00b7 '+(100-pct)+'% still market-exposed \u00b7 ~'+(margin>=0?'+':'\u2212')+'$'+Math.abs(margin).toFixed(2)+'/bu margin at today\u2019s level';
    }else{ resEl.innerHTML='<strong>'+pct+'% priced</strong> \u00b7 '+(100-pct)+'% still market-exposed'; }
  }
  if(eduEl){
    if(pct==null){eduEl.innerHTML='';}
    else{
      var note;
      if(pct===0)note='Nothing priced yet; all bushels are exposed to the market. Extension marketing programs generally favor pricing in <strong>increments</strong> through the pre-harvest window rather than one all-or-nothing decision, to avoid pricing everything at a low.';
      else if(pct<100)note='You\u2019ve scaled in on '+pct+'% and left '+(100-pct)+'% open. Scaled, incremental pricing is the discipline most extension programs teach. It trades the chance of a perfect top for protection against a bad one.';
      else note='Fully priced, no remaining market exposure on '+CROP.pricedWord+'. Basis and any unpriced stored old crop still move your final number.';
      eduEl.innerHTML=note;
    }
  }
}

function initPriced(){
  var inp=document.getElementById('priced-input'), clr=document.getElementById('priced-clear');
  if(!inp)return;
  var v=getPriced(); if(v!=null)inp.value=v;
  function save(){var n=parseFloat(inp.value);if(isNaN(n)){try{localStorage.removeItem('agsist_priced_'+CROP_KEY);}catch(e){}}else{n=Math.max(0,Math.min(100,n));try{localStorage.setItem('agsist_priced_'+CROP_KEY,n);}catch(e){}}renderScorecard();if(typeof gaEvent==='function')gaEvent('percent_priced_set',{page:CROP_KEY,pct:isNaN(n)?null:n});}
  inp.addEventListener('input',save);
  if(clr)clr.addEventListener('click',function(){inp.value='';try{localStorage.removeItem('agsist_priced_'+CROP_KEY);}catch(e){}renderScorecard();});
}



function getBreakevenPhrase(currentPriceDollars){
  var be=null;
  try{var saved=localStorage.getItem('agsist_be_'+CROP_KEY);if(saved)be=parseFloat(saved);}catch(e){}
  if(!be||!currentPriceDollars||isNaN(be)){
    // Clear any previously rendered verdict rather than returning over it:
    // a re-render after the price feed drops used to leave "\u2713 $0.42/bu
    // above your breakeven" on screen against a price that no longer exists.
    var _r=document.getElementById('be-result');
    if(_r&&_r.innerHTML){_r.innerHTML='';_r.className='be-result';}
    return null;
  }
  var diff=currentPriceDollars-be;
  var result=document.getElementById('be-result');
  if(diff>=0){
    if(result){result.innerHTML='\u2713 <strong>$'+diff.toFixed(2)+'/bu above</strong> your $'+be.toFixed(2)+' breakeven';result.className='be-result over';}
    return {phrase:'at current prices you are <strong>$'+diff.toFixed(2)+'/bu above your stated breakeven</strong> of $'+be.toFixed(2),be:be,diff:diff};
  }else{
    if(result){result.innerHTML='<strong>$'+Math.abs(diff).toFixed(2)+'/bu below</strong> your $'+be.toFixed(2)+' breakeven';result.className='be-result under';}
    return {phrase:'current prices are <strong>$'+Math.abs(diff).toFixed(2)+'/bu below your stated breakeven</strong> of $'+be.toFixed(2),be:be,diff:diff};
  }
}


// Action-oriented synthesis. NOT advice: decision framework only.
// Reads from mr.priceCtx (set by price fetch) and breakeven state.
function buildActionLine(mr){
  var p=mr.priceCtx; // {pct, percentile_zone, cropKey}
  if(!p)return null;
  var be=mr.breakeven; // {phrase, be, diff} or null
  var cot=mr.cotCtx;   // {pct, zone}
  var crop=mr.cropCtx; // {planting_diff, ge_diff} or null

  // Frame the four corners using percentile + breakeven
  // pct: 0-100 (price percentile), be.diff: $/bu vs BE
  var pct=p.pct;
  var hasB=!!be;
  var diff=hasB?be.diff:null;
  var lines=[];

  if(hasB){
    if(diff>=0&&pct>=75){
      lines.push('You are <strong>above breakeven and price is in the upper quartile</strong> of its 52-week range. Historically a window where scaling-in forward sales (HTAs, futures hedges, or floor strategies) protects margin without committing all bushels.');
    }else if(diff>=0&&pct>=25){
      lines.push('You are <strong>above breakeven, with price in the '+bandOf(pct)+'</strong> of its 52-week range. Mixed setup. If you need to price bushels for cash flow, partial sales lock in margin; if you can wait, the seasonal calendar may give a better window.');
    }else if(diff>=0&&pct<25){
      lines.push('You are <strong>above breakeven but price is in the lower quartile</strong> of its 52-week range. If you can wait, waiting has often paid at this level. Prices this low in the range have tended to bounce, and selling hard at the bottom rarely works out.');
    }else if(diff<0&&pct<25){
      lines.push('Below breakeven and in the <strong>lower quartile</strong> of the 52-week range. Patience setup: selling here locks in losses. Hold what you can store and watch for any catalyst that breaks the pattern.');
    }else if(diff<0&&pct<75){
      lines.push('Below breakeven, with price in the '+bandOf(pct)+' of its 52-week range. <strong>No forward-selling opportunity at these levels</strong>. Focus on protecting downside (puts) rather than locking in losses through cash sales.');
    }else if(diff<0){
      lines.push('Below breakeven but price is in the upper quartile of its range, a <strong>tight market</strong>. Check whether you can trim your costs (input timing, basis) before you decide these prices are out of reach.');
    }
  }else{
    // No breakeven entered: give a generic price-only frame
    if(pct>=75){
      lines.push('Price is in the <strong>upper quartile</strong> of its 52-week range, a window where many operations evaluate forward sales. Enter your cost of production above to see what these prices mean for your margin.');
    }else if(pct<25){
      lines.push('Price is in the <strong>lower quartile</strong> of its 52-week range. Historically a weak pricing window; selling here locks in losses for most operations. Enter your cost of production above to see how far below your breakeven you are.');
    }else{
      lines.push('Price is in the '+bandOf(pct)+' of its 52-week range. Add your cost of production above to see what it means for your margin.');
    }
  }

  // COT overlay: only when funds are crowded on the one measure, and with the
  // COT page's tested result, not a claim that crowded positions "unwind hard".
  if(cot&&cot.crowded){
    lines.push('Managed money is <strong>crowded '+cot.crowded+'</strong> ('+(cot.word||'')+' of its record since '+cot.since+', as a share of open interest). '+(cot.tested||''));
  }

  // Crop progress overlay: only when there's a meaningful divergence
  if(crop&&crop.planting_diff!=null&&Math.abs(crop.planting_diff)>15){
    if(crop.planting_diff<-15){
      lines.push('Planting pace is <strong>well behind prior year</strong>: historically supportive for prices through the May\u2013June weather window.');
    }else if(crop.planting_diff>15){
      lines.push('Planting pace is <strong>well ahead of prior year</strong>: typically removes weather premium; mild bearish bias for the spring.');
    }
  }

  return lines.join(' ');
}


// ============ WASDE IMMINENCE (v13) ============
function maybeFlagWasdeImminence(daysUntil){
  var el=document.getElementById('snap-wasde-wrap');
  if(!el)return;
  if(daysUntil!=null&&daysUntil<=7){
    el.classList.add('imminent');
  }else{
    el.classList.remove('imminent');
  }
}



// ============ LOCAL CASH BID + BASIS (v14) ============
// Reads /data/bids.json containing zip_grid + bids[] from Barchart proxy.
// Finds nearest grid ZIP to user location, matches bids by commodity,
// renders best matching bid with basis interpretation. Falls back gracefully
// when bids[] is empty (currently true at most fetch times) or when user
// location is unavailable.

function haversineMi(lat1,lng1,lat2,lng2){
  var R=3959,toRad=function(d){return d*Math.PI/180;};
  var dLat=toRad(lat2-lat1),dLng=toRad(lng2-lng1);
  var a=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)*Math.sin(dLng/2);
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}


// Map any commodity name variant to our canonical CROP_KEY values.
function normalizeCommodity(name){
  if(name==null)return null;
  var n=String(name).toLowerCase().trim();
  if(n.indexOf('corn')>=0)return 'corn';
  if(n.indexOf('soy')>=0||n==='beans')return 'beans';
  if(n.indexOf('wheat')>=0)return 'wheat';
  return null;
}


// Pull user location with priority: localStorage ZIP > geo.js state > null.
function getUserLoc(){
  var savedZip=null;
  try{savedZip=localStorage.getItem('agsist_user_zip');}catch(e){}
  if(savedZip)return{source:'saved',zip:String(savedZip).trim()};
  var s=window.AGSIST_STATE;
  if(s){
    // Try multiple plausible shapes
    var loc=s.location||s.geo||s.user||s;
    if(loc){
      var lat=loc.lat||loc.latitude;
      var lng=loc.lng||loc.lon||loc.longitude;
      var zip=loc.zip||loc.postal||loc.postalCode;
      var city=loc.city||loc.cityName;
      var st=loc.state||loc.region||loc.stateCode;
      if((lat!=null&&lng!=null)||zip){
        return{source:'geo',lat:lat,lng:lng,zip:zip,city:city,state:st};
      }
    }
  }
  return null;
}


// Find the closest grid ZIP to the user location.
function findNearestGridZip(userLoc,grid){
  if(!userLoc||!grid||!grid.length)return null;
  // Exact ZIP match
  if(userLoc.zip){
    for(var i=0;i<grid.length;i++){
      if(grid[i].zip===userLoc.zip)return{grid:grid[i],distance:0,exact:true};
    }
  }
  // Haversine to nearest by lat/lng
  if(userLoc.lat!=null&&userLoc.lng!=null){
    var nearest=null,nd=Infinity;
    for(var j=0;j<grid.length;j++){
      var g=grid[j];
      if(g.lat==null||g.lng==null)continue;
      var d=haversineMi(userLoc.lat,userLoc.lng,g.lat,g.lng);
      if(d<nd){nd=d;nearest=g;}
    }
    if(nearest)return{grid:nearest,distance:nd,exact:false};
  }
  return null;
}


// Find the best bid for current crop nearest to the chosen grid ZIP.
// Returns {bid, distance} or null. Defensive about bid field names.
function bidCash(b){
  /* The payload's field is cashPrice. The alternatives are kept because the
     card's own renderer reads them and a future feed may supply one. */
  var v=(b.cashPrice!=null)?b.cashPrice
       :(b.bid_price!=null)?b.bid_price
       :(b.bidPrice!=null)?b.bidPrice
       :(b.price!=null)?b.price:null;
  var n=Number(v);
  return isFinite(n)?n:-Infinity;
}


function findBestBidForCrop(bids,nearestGridResult,cropKey){
  if(!bids||!bids.length)return null;
  var cropBids=[];
  for(var i=0;i<bids.length;i++){
    var b=bids[i];
    var c=normalizeCommodity(b.commodity||b.commodityName||b.crop||b.commodity_name);
    if(c===cropKey)cropBids.push(b);
  }
  if(cropBids.length===0)return null;

  /* WITHHOLD BEFORE SELECTING, ON EVERY BRANCH -- not just the fallback.
     `verified` is false where cash minus basis disagrees with what every other
     facility quoting the same contract implies (scripts/fetch_bids.py). The
     exact-ZIP branch below can return such a row too: on the file committed
     2026-08-29 a reader at Council Bluffs was shown SOYBEANS at $12.87 whose
     basis of -1.00 implies November futures of $13.87, while the other 81 rows
     on that contract imply $12.88. Four verified soybean rows sit at the same
     ZIP; the best of them is $12.63. A number that cannot be checked is not
     shown, and the elevator four cents down the road is.
     A row with no `verified` field is allowed through, so an older
     data/bids.json cannot empty this card. */
  var checked=[];
  for(var v=0;v<cropBids.length;v++){if(cropBids[v].verified!==false)checked.push(cropBids[v]);}
  if(checked.length===0)return null;
  cropBids=checked;

  /* ONE RULE AT TWO RADII: the best price the reader can actually reach.

     THE PROXIMITY FACT WAS IN THE PAYLOAD ALL ALONG AND NOTHING USED IT.
     `sourceZip` is the grid ZIP whose Barchart query returned this row, and
     that query is a radius search around that ZIP. So a row carrying
     sourceZip 53705 is, by Barchart's own arithmetic, within range of
     Madison. It is not a coordinate and not a mileage, but it is the only
     statement about distance this feed makes: `distance` is null on all 346
     rows of the committed file, and lat/lng are absent entirely -- which is
     why the haversine branch that used to sit here had never once executed.

     The facility ZIP is checked as a union, not a fallback. 53 rows in the
     committed file have sourceZip != zip and 50 of those sit AT a grid ZIP,
     returned by a neighbouring ZIP's query rather than their own. Matching
     on either catches both; matching on one loses fifty real local bids.

     WHAT THIS REPLACED. The only local test was `bid.zip === ng.zip`, and
     bids sat at just 16 of the 50 grid ZIPs, so 37 of 50 fell through to
     "highest bid in the country" for corn -- 39 for beans, 41 for wheat. A
     reader in Madison was shown a real, checked bid in Jackson, Tennessee.

     And step 1 takes the HIGHEST price, not the first row. The old exact-ZIP
     branch returned whichever row came first in a file sorted by state, city
     and commodity -- the same arbitrariness as the national fallback with a
     smaller pool. Council Bluffs has five verified soybean rows; there is no
     reason to show a farmer the fourth one. */
  function nearGrid(b,z){
    z=String(z);
    return String(b.sourceZip||'')===z||String(b.zip||'')===z;
  }
  /* NEAREST DELIVERY FIRST, BEST PRICE INSIDE IT SECOND.

     "Prices paid today" does not mean the biggest number on the board. Rank a
     location's rows on price alone and the card goes to the furthest contract,
     because carry pays: on the committed file, Mankato's highest corn bid is
     $5.23 for JUNE 2027 delivery. Real bid, wrong answer to the question the
     heading is asking.

     THE DATE IS TAKEN TO THE DAY, NOT THE SECOND. Barchart returns the same
     contract month with two different end stamps -- of the 56 rows ending 31
     August, 33 say 23:59:59 and 23 say 00:00:00. Compared as full strings that
     splits one month into two groups, the price tie-break never spans them,
     and the national pick came out $5.02 with a $5.72 row sitting in the other
     half of the same month.

     IT ORDERS ON deliveryEnd, NOT deliveryStart. Eight rows in the committed
     file carry a deliveryStart of 2012 against a correct end date and a
     correct month label; ordering on start handed those rows every fallback in
     the file. Every deliveryEnd in that file is a real future date. */
  /* The reader's own calendar day, not UTC: whether a delivery window is
     still open is a question about where he is standing. */
  var TODAY_ISO=(function(){var n=new Date();
    return n.getFullYear()+'-'+('0'+(n.getMonth()+1)).slice(-2)+'-'+('0'+n.getDate()).slice(-2);})();
  /* ONE SORTABLE STRING, THREE TIERS, so bestBid's existing `wa<wb` is
     unchanged and still a total order:
       '0'+date  the window is still open  -- soonest first, as before
       '2'       no date at all            -- after every open window
       '9'+date  the window has closed     -- last, and it can no longer win
     WAS: '9999-99-99' for a missing date and the raw date otherwise, with no
     floor, so a row whose window shut in 2016 beat every real one. */
  function bidWhen(b){
    var w=String(b.deliveryEnd||b.deliveryStart||'').slice(0,10);
    if(!w)return '2';
    return (w>=TODAY_ISO?'0':'9')+w;
  }
  function bestBid(rows){
    var best=rows[0];
    for(var k=1;k<rows.length;k++){
      var a=rows[k], wa=bidWhen(a), wb=bidWhen(best);
      if(wa<wb||(wa===wb&&bidCash(a)>bidCash(best)))best=a;
    }
    return best;
  }

  if(nearestGridResult&&nearestGridResult.grid){
    var ng=nearestGridResult.grid;
    var local=[];
    for(var j=0;j<cropBids.length;j++){
      if(!nearGrid(cropBids[j],ng.zip))continue;
      /* bidWhen tags a closed window with '9'. Such a row may not be this
         reader's LOCAL bid even when it is the only local row: the card
         prints one price under "Local Cash Bid", and a window that shut in
         April is not one. Falling through says "not near you", which is
         true, instead of naming a price he cannot get. */
      if(bidWhen(cropBids[j]).charAt(0)==='9')continue;
      local.push(cropBids[j]);
    }
    if(local.length)return{bid:bestBid(local),distance:nearestGridResult.distance};
  }

  /* NOTHING WITHIN RANGE. The reader's own grid ZIP returned no verified bid
     for this crop, so the honest answer is the best one anywhere plus a
     distance of null, which renderBasisCard turns into a label that says it
     is not near them. */
  return{bid:bestBid(cropBids),distance:null};
}


/* The network's own count (data/elevator-counts.json `coverage`, the one counts file; copied from the file the
   homepage reads), in place of the old "samples 50 ZIP locations" line. No
   file, no number: the sentence reads fine without it. */
function netCount(box){fetch('/data/elevator-counts.json').then(function(r){return r.ok?r.json():null;}).then(function(c){var k=c&&c.coverage;if(!k||typeof k.read!=='number'||typeof k.elevators!=='number'||!box)return;Array.prototype.forEach.call(box.querySelectorAll('.net-count'),function(e){e.textContent=' ('+k.read.toLocaleString('en-US')+' of the '+k.elevators.toLocaleString('en-US')+' elevators it knows are read directly)';});}).catch(function(){});}

/* The seasonal factor's label names the window the index was built on
   (price-stats.json seasonality_years: 2022-2025 is 4 years, not "5-yr"). */
function seasWin(){var s=window.__agsistSeasS,y=s&&s.seasonality_years;return (y&&y.length===2?'weekly closes '+y[0]+'–'+y[1]+' ('+(y[1]-y[0]+1)+' years)':'weekly closes')+', indexed 0–100';}

function fmtBidTime(ts){
  try{
    var d=new Date(ts),now=new Date();
    var m=Math.round((now-d)/60000);
    if(m<2)return 'just now';
    if(m<60)return m+'m ago';
    if(m<24*60)return Math.round(m/60)+'h ago';
    return Math.round(m/(24*60))+'d ago';
  }catch(e){return ''+ts;}
}


function savedPlace(){
  try{
    if(localStorage.getItem('agsist_user_zip')||localStorage.getItem('agsist_zip'))return true;
    var o=JSON.parse(localStorage.getItem('agsist-wx-loc')||'null');
    return !!(o&&(o.zip||o.lat!=null));
  }catch(e){return false;}
}
function fetchAndRenderBasis(){
  /* LIVE FIRST, COMMITTED FILE SECOND.
   *
   * This used to read /data/bids.json and nothing else. That file is written
   * by fetch_bids.yml, which runs about twice an hour, and on 2026-09-23 it
   * stopped writing for 27 hours -- so this card served Wednesday's prices
   * into Thursday afternoon while dnilgis/bids was reading 1,096 elevator
   * boards every ten minutes and publishing them.
   *
   * components/bids-network.js reads that published scrape directly, in one
   * request, and hands back the same { fetched, bids, zip_grid } shape this
   * renderer already takes. So the renderer below is untouched: every rule it
   * carries about what to show and what to withhold still applies, to fresher
   * rows.
   *
   * THE COMMITTED FILE IS STILL THE FALLBACK AND HAS TO BE. The scrape covers
   * 1,002 places in 29 states; the committed file also carries Barchart, which
   * is where a reader outside that footprint gets an answer at all. A reader
   * in Florida gets null from the network and the old path runs untouched.
   *
   * Nothing here can leave the card empty that would not have left it empty
   * before: every failure path falls through to the same fetch this function
   * used to begin with.
   */
  function committed(){
    return fetch('/data/bids.json',{cache:'no-store'})
      .then(function(r){return r.ok?r.json():null;})
      .then(function(data){ if(data)renderBasisCard(data); });
  }
  var loc=null;
  try{loc=getUserLoc();}catch(e){}
  /* NO LOCATION, NO BIDS FILE (2026-10-17). With no saved place at all the
     card can only ask for a ZIP, and it used to download the whole 231 KB
     committed bids file first to say so. It now draws the ask straight away;
     a ZIP typed into the card calls this function again and loads it then. */
  if(!loc&&!savedPlace()){ renderBasisCard({bids:[],zip_grid:[]}); return; }
  if(!window.AGSIST_BIDS_NET||!loc){ committed().catch(function(){}); return; }
  window.AGSIST_BIDS_NET.snapshotForLoc(loc)
    .then(function(live){
      if(live&&live.bids&&live.bids.length){renderBasisCard(live);return;}
      return committed();
    })
    .catch(function(){ return committed(); })
    .catch(function(){ /* no feed at all - leave the card as it was */ });
}


function renderBasisCard(data){
  var card=document.getElementById('basis-card');
  if(!card)return;

  var grid=data.zip_grid||[];
  var bids=data.bids||[];
  /* A NETWORK SNAPSHOT BRINGS THE COORDINATE IT SEARCHED FROM.
     getUserLoc() returns {source:'saved', zip} with no lat/lng whenever the
     reader has saved a ZIP, and three things below need a coordinate: the
     nearest-grid lookup, the local test, and the "X mi from you" label. Left
     to the saved ZIP alone this card told a reader at Chetek that a bid 50
     miles away was "not near you". The committed file carries no origin, so
     that path is unchanged. */
  var userLoc=(data&&data.origin)||getUserLoc();
  var nearest=findNearestGridZip(userLoc,grid);

  // Show the card
  card.style.display='block';

  var locEl=document.getElementById('basis-loc');
  var bidEl=document.getElementById('basis-bid');
  var spreadEl=document.getElementById('basis-spread');
  var deliveryEl=document.getElementById('basis-delivery');
  var interpEl=document.getElementById('basis-interp');
  var emptyEl=document.getElementById('basis-empty-msg');
  var srcEl=document.getElementById('basis-src');
  var basisGrid=document.getElementById('basis-grid');

  // If no user location at all (no saved ZIP, no geo), force prompt state
  if(!userLoc){
    if(basisGrid)basisGrid.style.display='none';
    if(interpEl)interpEl.style.display='none';
    if(locEl)locEl.textContent='No location set';
    if(emptyEl){
      emptyEl.style.display='block';
      emptyEl.innerHTML='<strong>Set your ZIP to see your nearest cash bid.</strong> AGSIST reads posted '+CROP_LABEL.toLowerCase()+' bids straight from elevator boards<span class="net-count"></span> and shows the nearest, with basis vs CBOT futures. Tap \u201cSet my ZIP\u201d below.';netCount(emptyEl);
    }
    if(srcEl){srcEl.innerHTML='Cash bids from the AGSIST elevator network';}
    return;
  }

  var match=findBestBidForCrop(bids,nearest,CROP_KEY);

  if(match&&match.bid){
    var b=match.bid;
    /* THE SAME MISSING FIELD, A SECOND TIME. This read bid_price, then
       bidPrice, then price. data/bids.json carries NONE of them -- the field
       is cashPrice -- so bidPrice was undefined on every row and the card's
       headline number rendered as an em dash. Not a wrong price: no price at
       all, on all three pages, for as long as the payload has had this shape.
       bidCash() is the one place that knows the field name. 2026-08-29. */
    var bidPrice=bidCash(b);
    if(bidPrice===-Infinity)bidPrice=null;
    var basis=b.basis!=null?b.basis:b.bidBasis;
    /* deliveryMonth IS THE FIELD THIS FILE ACTUALLY HAS.
       `delivery` is the board's own words and exists only on rows read
       straight from an elevator, so it stays first. deliveryMonth is on every
       row and was missing from this chain, which is why 90 of 150 cards drew
       an em dash where the row in hand said "Sep26". The snake_case names are
       kept last: they are not in today's payload but cost nothing. */
    var deliveryStr=b.delivery||b.deliveryMonth||b.delivery_str||b.deliveryDescription||
      (b.deliveryStart?String(b.deliveryStart).slice(0,10)+(b.deliveryEnd?' \u2013 '+String(b.deliveryEnd).slice(0,10):''):null)||
      (b.delivery_start?b.delivery_start+(b.delivery_end?' \u2013 '+b.delivery_end:''):null);

    // Resolve the BID\'s actual location for the header label.
    var bidGrid=null;
    if(b.zip){
      for(var i=0;i<grid.length;i++)if(grid[i].zip===b.zip){bidGrid=grid[i];break;}
    }
    /* lon, not lng. The feed writes lat/lon; zero of 584 rows have an
       `lng` key, so this branch was reached 142 times in 150 and ran 0. */
    var bLng=(b.lng!=null)?b.lng:b.lon;
    if(!bidGrid&&b.lat!=null&&bLng!=null){
      var nd=Infinity;
      for(var j=0;j<grid.length;j++){
        var d=haversineMi(b.lat,bLng,grid[j].lat,grid[j].lng);
        if(d<nd){nd=d;bidGrid=grid[j];}
      }
    }

    if(basisGrid)basisGrid.style.display='grid';
    if(emptyEl)emptyEl.style.display='none';
    if(interpEl)interpEl.style.display='block';

    // Header label: show BID\'s location + distance from user
    if(locEl){
      var label=bidGrid?bidGrid.label:((b.town||b.city)?((b.town||b.city)+(b.state?', '+b.state:'')):(b.facility||'-'));
      var locStr=label;
      if(bidGrid&&userLoc.lat!=null&&userLoc.lng!=null&&bidGrid.lat!=null){
        var dMi=haversineMi(userLoc.lat,userLoc.lng,bidGrid.lat,bidGrid.lng);
        if(dMi<2)locStr+=' \u00b7 your area';
        else locStr+=' \u00b7 '+Math.round(dMi)+' mi from you';
      }else if(bidGrid&&userLoc.zip&&bidGrid.zip===userLoc.zip){
        locStr+=' \u00b7 your ZIP';
      }else if(match.distance!==null){
        /* A LOCAL BID WHOSE FACILITY ZIP IS NOT ITSELF A GRID ZIP. It was
           returned by the radius query run around the reader's own grid ZIP,
           so it is within range -- there just is no grid entry to measure a
           mileage from. Say the true thing rather than nothing: an
           unqualified "Sun Prairie, WI" reads as a bid the reader can place,
           which it is, but it should not look like an exact distance either. */
        locStr+=' \u00b7 within range of you';
      }else if(match.distance===null){
        /* SAY SO WHEN IT IS NOT NEAR THEM. findBestBidForCrop returns
           distance:null only from the fallback branch -- the highest verified
           bid anywhere in the sample, chosen because this reader's grid ZIP
           has no bid of its own. That is 37 of the 50 grid ZIPs for corn on
           the file committed 2026-08-29. It used to be labelled with a bare
           city name and no distance, which reads exactly like a local bid.
           A number the reader cannot act on locally has to say that it is
           not local; that is cheaper than being quietly wrong. */
        locStr+=' \u00b7 not near you: highest checked bid in the sample';
      }
      locEl.textContent=locStr;
    }

    if(bidEl)bidEl.textContent=bidPrice!=null?AG.px.cash(bidPrice):'-';
    /* A LOCAL bid (not the "highest checked bid in the sample" fallback) also
       goes to the line under the price (components/price-local.js). */
    if(match.distance!==null&&bidPrice!=null&&locEl){
      try{window.dispatchEvent(new CustomEvent('agsist:nearbid',{detail:{key:window.AGSIST_FUTURES==='soybean'?'soybeans':window.AGSIST_FUTURES,crop:CROP_LABEL.toLowerCase(),
        price:Number(bidPrice),basis:basis!=null?Number(basis):null,contract:b.symbol||'',place:(b.facility||b.bidName||'')+(locEl.textContent?' ('+locEl.textContent+')':''),
        when:(b.timestamp||b.cashPriceTimestamp)?'Posted '+fmtBidTime(b.timestamp||b.cashPriceTimestamp):''}}));}catch(e){}
    }
    try{window.__agsistMR.basisCtx={basis:(basis!=null?Number(basis):null),bidPrice:(bidPrice!=null?Number(bidPrice):null),symbol:(b.symbol||b.futures_symbol||b.futuresSymbol||null),loc:(document.getElementById('basis-loc')?document.getElementById('basis-loc').textContent:null)};renderScorecard();}catch(e){}
    if(spreadEl){
      if(basis!=null){
        var bv=Number(basis);
        spreadEl.textContent=AG.px.basis(bv*100);   /* −65¢, +5¢, even: one basis style */
        spreadEl.className='basis-cell-val '+(bv>=0?'basis-pos':'basis-neg');
      }else{spreadEl.textContent='-';spreadEl.className='basis-cell-val';}
    }
    if(deliveryEl)deliveryEl.textContent=deliveryStr||'-';

    if(interpEl){
      var interp;
      if(basis!=null){
        var bvi=Number(basis),absV=AG.px.basis(Math.abs(bvi)*100).replace(/^\+/,'');
        if(bvi===0)interp='Cash is <strong>level with its board futures contract</strong>. A flat basis is neither a premium nor a discount; the elevator is paying the exchange price.';
        else if(bvi>0)interp='Cash is <strong>'+absV+' above the board contract it is quoted against'+(b.symbol?' ('+b.symbol+')':'')+'</strong>. Positive basis signals firm local demand: buyers are willing to pay above the exchange to attract bushels.';
        else if(bvi>=-0.20)interp='Cash is <strong>'+absV+' under futures</strong>. A tight basis like this is firm, typical of strong local demand or proximity to a processor.';
        else if(bvi>=-0.40)interp='Cash is <strong>'+absV+' under futures</strong>. Roughly typical interior-state basis. Compare against your usual local levels to gauge whether the elevator is bidding up.';
        else interp='Cash is <strong>'+absV+' under futures</strong>. A wide negative basis suggests heavy local supply or soft buyer demand. Storing through to a basis improvement may pay if you have bin space.';
      }else{
        interp='Bid <strong>'+(bidPrice!=null?AG.px.cash(bidPrice):'-')+'/bu</strong> at this location. Basis vs futures not reported.';
      }
      interpEl.innerHTML=interp;
    }

    if(srcEl){
      var srcLine='Source: '+(b.facility||b.bidName||b.location||'local elevator');
      var bidSt=window.AgAsOf?AgAsOf.html(b.timestamp||b.cashPriceTimestamp,'bids'):'';
      if(bidSt)srcLine+=' \u00b7 '+bidSt;
      else if(b.timestamp||b.cashPriceTimestamp)srcLine+=' \u00b7 updated '+fmtBidTime(b.timestamp||b.cashPriceTimestamp);
      else if(data.fetched)srcLine+=' \u00b7 polled '+fmtBidTime(data.fetched);
      // Credit the source of THIS bid: a network elevator's own board, or
      // Barchart. The merged feed marks network rows source=='network'.
      srcLine+= (b.source==='network')
        ? ' \u00b7 AGSIST elevator network'
        : ' \u00b7 a licensed cash-bid feed';
      srcEl.innerHTML=srcLine;
    }

    if(window.__agsistMR){
      var bp='local cash basis ';
      var bidLocLbl=bidGrid?bidGrid.label:'this location';
      if(basis!=null){
        var bv2=Number(basis);
        if(bv2>0)bp+='at <strong>'+AG.px.basis(bv2*100)+' near '+bidLocLbl+'</strong> is positive: a sign of firm local demand';
        else bp+='at <strong>'+AG.px.basis(bv2*100)+' near '+bidLocLbl+'</strong>';
        window.__agsistMR.basis=[bp];
        if(typeof renderMarketRead==='function')renderMarketRead();
      }
    }
  }else{
    // userLoc is set but no matching bid available
    if(basisGrid)basisGrid.style.display='none';
    if(interpEl)interpEl.style.display='none';

    // Header label: show nearest grid point so user knows where we looked
    if(locEl){
      if(nearest&&nearest.grid){
        var ls=nearest.grid.label;
        if(nearest.exact)ls+=' \u00b7 your ZIP';
        else if(nearest.distance>2)ls+=' \u00b7 '+Math.round(nearest.distance)+' mi from you';
        locEl.textContent=ls;
      }else{locEl.textContent='-';}
    }

    if(emptyEl){
      emptyEl.style.display='block';
      var fetched=data.fetched?'Last polled '+fmtBidTime(data.fetched)+'.':'';
      var hasBidsAtAll=(bids.length>0);
      var msg;
      if(hasBidsAtAll){
        msg='<strong>No '+CROP_LABEL.toLowerCase()+' cash bids in the current sample for your area.</strong> Bids vary by elevator, season, and delivery period. Check the full cash bid map for nearby alternatives. '+fetched;
      }else{
        msg='<strong>Cash bid samples are being collected.</strong> AGSIST reads posted bids straight from elevator boards<span class="net-count"></span>, with basis vs CBOT futures. '+fetched;
      }
      emptyEl.innerHTML=msg;netCount(emptyEl);
    }
    if(srcEl){
      srcEl.innerHTML='Cash bids from the AGSIST elevator network';
    }
  }
}




// ZIP override prompt: saves to localStorage and re-renders.
function initZipPrompt(){
  var btn=document.getElementById('basis-zip-btn');
  if(!btn)return;
  btn.addEventListener('click',function(){
    var current='';
    try{current=localStorage.getItem('agsist_user_zip')||'';}catch(e){}
    var zip=window.prompt('Enter your 5-digit ZIP code (or leave blank to clear):',current);
    if(zip===null)return; // user cancelled
    zip=String(zip||'').trim();
    if(zip===''){
      try{localStorage.removeItem('agsist_user_zip');}catch(e){}
      fetchAndRenderBasis();
      if(typeof gaEvent==='function')gaEvent('basis_zip_cleared',{});
    }else if(zip.match(/^\d{5}$/)){
      try{localStorage.setItem('agsist_user_zip',zip);}catch(e){}
      fetchAndRenderBasis();
      if(typeof gaEvent==='function')gaEvent('basis_zip_set',{zip:zip});
    }else{
      window.alert('That doesn\'t look like a 5-digit ZIP code. Try again.');
    }
  });
}


// ============ DAILY BRIEFING STRIP ============
// Fetches /data/daily.json and populates the top strip if today's briefing exists.
// Schema: {date, headline, subheadline, lead, teaser}
function loadBriefingStrip(){
  fetch('/data/daily.json',{cache:'no-store'})
    .then(function(r){return r.ok?r.json():null;})
    .then(function(d){
      if(!d||!d.date||!d.headline)return;
      var today=new Date().toISOString().slice(0,10);
      if(d.date!==today)return;
      var strip=document.getElementById('brief-strip');
      var hd=document.getElementById('brief-hd');
      var teaser=document.getElementById('brief-teaser');
      if(strip&&hd&&teaser){
        /* Audit 2026-07-29 (Sig): NO emoji in reader copy: the briefing pipeline
           still emits them (daily.json), so scrub anything it feeds this strip.
           Surrogate-pair class = all astral emoji; BMP ranges = misc symbols/dingbats.
           Plain arrows are outside these ranges and survive. */
        var deEmoji=function(s){return String(s||'').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200D]/g,'').replace(/  +/g,' ').trim();};
        hd.textContent=deEmoji(d.headline);
        teaser.textContent=deEmoji(d.teaser||d.subheadline||d.lead||'');
        strip.style.display='flex';
      }
    })
    .catch(function(){});
}



// ============ FORWARD CURVE AND CARRY ============
/* One chart and one carry line for the three crops (2026-10-10). The carry
   card said "Storing makes sense if you have bin space" whenever the monthly
   futures carry beat a flat 3.5 cents with no interest; with interest on the
   grain's value the same carry loses money. It now prints the site's one
   store-or-sell calculation (components/storesell.js holdLine: carry minus
   storage, interest and shrink, stated defaults the reader can change on
   /store-or-sell) for the storage window, and points to the elevator's own
   posted carry, which is what a farmer actually gets paid. Contracts in the
   next crop year are plotted and never in the carry. */
function renderForwardCurve(cropKey,contractList,quotes,isGrain){
  var svg=document.getElementById('fwd-svg');
  var shape=document.getElementById('fwd-shape');
  var interp=document.getElementById('fwd-interp');
  if(!svg)return;
  var pts=[];
  contractList.forEach(function(c){
    var d=quotes[c.key];
    if(d&&d.close!=null){
      var nc=!!(c.newCrop||(c.tag&&c.tag.indexOf('new crop')===0));
      pts.push({label:c.month,idx:c.idx,price:isGrain?d.close/100:d.close,newCrop:nc,tag:c.tag||(nc?'new crop':null),key:c.key});
    }
  });
  if(pts.length<2){
    svg.style.display='none';
    var empty=document.getElementById('fwd-empty');
    if(empty)empty.style.display='block';
    if(interp)interp.textContent='';
    return;
  }
  var minP=Math.min.apply(null,pts.map(function(p){return p.price;}));
  var maxP=Math.max.apply(null,pts.map(function(p){return p.price;}));
  var pad=(maxP-minP)*0.15||0.05;
  minP-=pad;maxP+=pad;
  /* The viewBox is the drawn width, so font sizes below are CSS pixels (a
     13-unit label in a 700-wide box was about 7px on a phone). No y-axis:
     its padded bounds were prices that never traded and collided with the
     point labels, and every point carries its own price. */
  var W=Math.round(Math.max(300,Math.min(900,(svg.getBoundingClientRect&&svg.getBoundingClientRect().width)||700))),mL=34,mR=34,mT=22;
  var NARROW=(W-mL-mR)/Math.max(1,pts.length-1)<95,H=NARROW?176:150,mB=NARROW?58:38;
  var pw=W-mL-mR,ph=H-mT-mB;
  function x(i){return mL+(pts.length===1?pw/2:(i/(pts.length-1))*pw);}
  function y(p){return mT+ph-((p-minP)/(maxP-minP))*ph;}
  /* The label is built from the same points the chart draws, so a screen
     reader hears what a sighted reader sees. */
  var aria='Futures price by contract month, dollars per bushel: '+pts.map(function(p){
    return p.label+' '+(isGrain?AG.px.priceDollars(p.price,{style:'slash',dollar:false}):p.price.toFixed(2))+(p.tag?' ('+p.tag+')':'');
  }).join(', ').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  var s=['<svg class="fwd-svg" id="fwd-svg" viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="'+aria+'">'];
  var path='';
  pts.forEach(function(p,i){path+=(i===0?'M':'L')+x(i)+','+y(p.price);});
  s.push('<path d="'+path+'" style="stroke:var(--gold,#d4a23f)" stroke-width="2" fill="none"/>');
  pts.forEach(function(p,i){
    s.push(p.newCrop?'<circle cx="'+x(i)+'" cy="'+y(p.price)+'" r="4" fill="none" style="stroke:var(--gold,#d4a23f)" stroke-width="2"/>':'<circle cx="'+x(i)+'" cy="'+y(p.price)+'" r="4" style="fill:var(--gold,#d4a23f)"/>');
    /* $/bu is the card's unit, so the labels drop the "$"; the end labels
       anchor inward, and on a narrow chart the values sit in a row of their own. */
    var anc=i===0?'start':i===pts.length-1?'end':'middle',lx=x(i)+(i===0?-4:i===pts.length-1?4:0);
    /* narrow: the value goes in its own row under the month, clear of the line */
    var ly=NARROW?(H-34):y(p.price)-9;if(NARROW){anc='middle';lx=x(i);}
    s.push('<text x="'+lx+'" y="'+ly+'" style="fill:var(--text,#e8ebe5)" font-size="'+(NARROW?11:12)+'" font-family="'+(NARROW?'Inter,system-ui,sans-serif':'JetBrains Mono,monospace')+'" text-anchor="'+anc+'" font-weight="700">'+(isGrain?AG.px.priceDollars(p.price,{style:NARROW?'glyph':'slash',dollar:false}):p.price.toFixed(2))+'</text>');
    s.push('<text x="'+x(i)+'" y="'+(H-20)+'" style="fill:var(--text-muted,#9aa39c)" font-size="11" text-anchor="middle">'+p.label+'</text>');
    if(p.tag)s.push('<text x="'+x(i)+'" y="'+(H-6)+'" style="fill:var(--text-dim,#7f8a82)" font-size="11" text-anchor="middle">'+p.tag+'</text>');
  });
  s.push('</svg>');
  svg.outerHTML=s.join('');

  /* The carry is counted contract to contract (Dec to Jul is 7 months). Grain
     binned now waits until the first contract too, and pays storage for it;
     say so rather than let "7 months" stand for grain in the bin since harvest. */
  var FULLMON=['January','February','March','April','May','June','July','August','September','October','November','December'];
  function binNote(f){
    var d=new Date(),extra=f.idx-((d.getFullYear()%100)*12+d.getMonth()+1);   /* idx = yy*12 + month (storesell.js) */
    if(!(extra>0&&extra<12))return '';
    return ' Grain in the bin now pays '+extra+' more month'+(extra===1?'':'s')+' of storage before '+FULLMON[(f.idx-1)%12]+'.';
  }
  // the storage window: the first and last contracts of this crop year that trade
  var SS=window.AgsistStoreSell;
  var cw=(SS&&SS.carryWindow&&SS.carryWindow(CROP.carry,quotes))||[];
  var first=pts.filter(function(p){return p.key===cw[0];})[0],last=pts.filter(function(p){return p.key===cw[1];})[0];
  var shapeTxt='',interpTxt='';
  if(!first||!last||!SS){
    shapeTxt='-';
    interpTxt='Not enough contracts in this crop year trade to show a carry.';
  }else{
    var months=Math.max(1,last.idx-first.idx);
    var spread=last.price-first.price;
    shapeTxt=spread>0.05?'contango':spread<-0.05?'backwardation':'flat';
    var inputs=readStoreInputs();
    var line=SS.holdLine({to:last.label,carry:spread,months:months,spot:first.price,kind:'futures',inputs:inputs});
    interpTxt='<strong>'+esc(line)+'</strong> '
      +esc(first.label+' to '+last.label+' futures: the later month pays '+amt(spread*100,{style:'slash'})+(spread>=0?' more.':' less.'))+' '
      +esc(SS.costNote(inputs,months,first.price,FULLMON[(first.idx-1)%12]))
      +esc(binNote(first))
      +' Futures carry assumes your basis stays where it is; your elevator’s posted later bids show the carry it actually pays. '
      +'<a style="color:var(--gold);text-decoration:underline;text-underline-offset:2px;text-decoration-thickness:1px" href="/store-or-sell?crop='+encodeURIComponent(window.AGSIST_FUTURES)+'">Store or sell, with your elevator’s bids and your costs →</a>';
  }
  if(shape)shape.textContent=shapeTxt;
  if(interp)interp.innerHTML=interpTxt;
}
/* The reader's own storage, interest and shrink from /store-or-sell (or the
   homepage calculator): the same localStorage key, the stated defaults for
   anything blank. */
function readStoreInputs(){
  var s=null,o={};
  try{s=JSON.parse(localStorage.getItem('agsist_storesell')||'null');}catch(e){s=null;}
  if(s&&typeof s==='object'){['cost','rate','shrink'].forEach(function(k){var v=parseFloat(s[k]);if(isFinite(v)&&v>=0)o[k]=v;});}
  return window.AgsistStoreSell.withDefaults(o);
}
function esc(t){return window.AG&&AG.esc?AG.esc(t):String(t==null?'':t);}



// ============ PERSONAL BREAKEVEN ============
// Stored in localStorage under 'agsist_be_<cropKey>'.
// Integrated into Market Read via a phrase appended to the sp[] array.
function initBreakeven(cropKey,cropLabel){
  var input=document.getElementById('be-input');
  var result=document.getElementById('be-result');
  var clear=document.getElementById('be-clear');
  if(!input)return;
  var key='agsist_be_'+cropKey;
  var saved=null;
  try{saved=localStorage.getItem(key);}catch(e){}
  if(saved){input.value=saved;}
  function update(){
    var v=parseFloat(input.value);
    if(isNaN(v)||v<=0){
      if(result){result.textContent='';result.className='be-result';}
      try{localStorage.removeItem(key);}catch(e){}
      return null;
    }
    try{localStorage.setItem(key,v);}catch(e){}
    return v;
  }
  input.addEventListener('input',function(){update();window.dispatchEvent(new Event('be-updated'));});
  if(clear){clear.addEventListener('click',function(){input.value='';update();window.dispatchEvent(new Event('be-updated'));});}
  window.__agsistBE=function(){return update();};
}


// ============ DAILY BRIEFING SIGNUP (Formspree) ============
function initSignup(){
  var form=document.getElementById('signup-form');
  var ok=document.getElementById('signup-ok');
  if(!form)return;
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var data={};new FormData(form).forEach(function(v,k){data[k]=v;});
    fetch('https://agsist-subs.dnilgis.workers.dev/subscribe',{method:'POST',body:JSON.stringify(data),headers:{'Content-Type':'application/json','Accept':'application/json'}})
      .then(function(r){
        if(r.ok){form.style.display='none';if(ok)ok.style.display='block';if(typeof gaEvent==='function')gaEvent('briefing_signup',{page:location.pathname});}
        else{alert('The signup did not go through. Email sig@agsist.com and I will add you by hand.');}
      })
      .catch(function(){alert('The signup did not go through. Email sig@agsist.com and I will add you by hand.');});
  });
}

// Boot widget subsystems on DOMContentLoaded
document.addEventListener('DOMContentLoaded',function(){renderMarketSession();setInterval(renderMarketSession,60000);loadBriefingStrip();loadCropProgress();(CROP.boot||[]).forEach(function(f){f();});loadCOT();loadWasde();fetchAndRenderBasis();initZipPrompt();initBreakeven(CROP_KEY,CROP_LABEL);initSignup();initPriced();});



/* grain prices, moves and ranges: the site's one formatter (components/util.js AG.px) */
function grain$(v){return AG.px.price(v);}

function raw$(v,d){return v.toFixed(d||2);}

function ord(n){var s=['th','st','nd','rd'],v=n%100;return s[(v-20)%10]||s[v]||s[0];}

function chgTxt(net,pct,roll,g,u){if(roll)return{t:'contract roll',c:'roll'};if(net==null)return{t:'',c:''};if(g!==false)return AG.px.change(net,pct);if(Math.abs(net)<0.005)return{t:'unch',c:'nc'};var a=net>=0?'▲':'▼';var s=net>0?'+':net<0?'−':'';u=u||{};return{t:a+' '+s+(u.pre||'')+Math.abs(net).toFixed(2)+(u.suf||'')+' ('+AG.px.pct(pct)+')',c:net>=0?'up':'dn'};}
/* cents first, percent second: reader request 2026-07-20 *//* roll: the front month just switched contracts: the day-change would compare two different months, so it's labeled, not shown (2026-07-20) */
function setEl(id,txt,cls){var el=document.getElementById(id);if(!el)return;el.textContent=txt;el.classList.remove('sk');if(cls){el.classList.remove('up','dn','roll');el.classList.add(cls);}}

// PRICES: fetched immediately, unconditional, independent of TradingView.
// The hero and the lead tile use the nearest dated contract (<crop>-nearby)
// when the pipeline publishes it with a price, else the continuous most-active
// series, labeled "Most-active (ZC)" and never "Front Month".
/* "the Oct 16 settle" | "the last trade as of 9:15 am CT" | "today's quote (Oct 17, 1:46 am)" */
function pxWhat(q,fetched,ctf){
  var s=window.AgPxStamp&&q?AgPxStamp.stamp(q,fetched):'';
  if(/ settle$/.test(s))return 'the '+s;
  if(/^Last trade/.test(s))return 'the l'+s.slice(1);
  if(/^Overnight trade/.test(s))return 'the overnight trade'+s.slice(15);
  return 'today\u2019s quote'+(fetched&&ctf?' ('+ctf(fetched)+')':'');
}
/* The hero line's moment, in the baked seed's words (seed_static.py quote_when,
   state_words): "Settle Oct 16" | "Last trade as of 10:42 am CT" | "Last quote".
   Night audit Oct 19, 2026: it called a Friday settle "refreshed" in session
   on a Sunday, and an answer engine can quote that as a live price. */
function exchWhen(q,fetched){
  var s=window.AgPxStamp&&q?AgPxStamp.stamp(q,fetched):'',m=/^(.*) settle$/.exec(s);
  if(m)return 'Settle '+m[1];
  if(/^(Last|Overnight) trade/.test(s))return s;
  return 'Last quote';
}
/* the price stamp: price-local.js when it is on the page, asof.js otherwise */
function pxStampHtml(q,data){
  if(window.AgPxStamp&&q){
    var h=AgPxStamp.html(q,data.fetched);
    if(h&&q.close_kind!=='settle'&&window.AgAsOf){var st=AgAsOf.staleness(data.fetched,'prices');if(st.stale)h+='<span class="asof-note"> &middot; '+st.note+'</span>';}
    if(h)return h;
  }
  return window.AgAsOf?AgAsOf.html(data.fetched,'prices'):'';
}
/* the overnight line under the hero price: '' and hidden when there is no overnight trade */
function heroOvernight(q){
  var hc=document.getElementById('hero-chg');if(!hc)return;
  var el=document.getElementById('hero-ovn'),h=window.AgPxStamp&&AgPxStamp.overnightHtml?AgPxStamp.overnightHtml(q,grain$,function(n){return AG.px.move(n,{sign:true});}):'';
  if(!el){if(!h)return;el=document.createElement('div');el.id='hero-ovn';el.className='ph-ovn';hc.parentNode.insertBefore(el,hc.nextSibling);}
  /* a box reserved for the night (the page's inline script) stays, empty, rather than shift the page */
  if(!h&&/ph-ovn-wait/.test(el.className)){el.innerHTML='';return;}
  el.innerHTML=h;el.hidden=!h;
}
function loadPrices(){
/* AG.json (util.js): one request for prices.json, shared with geo.js and the
   range/seasonal block below. */
AG.json('/data/prices.json')
  .then(function(data){
    /* chaos-1 (2026-10-17): a file that stopped updating still names contracts
       that have since expired. price-local.js roll() drops them and points
       each alias at the nearest live month on file. */
    var q=data.quotes||{};
    if(window.AgPxStamp&&AgPxStamp.roll)data.quotes=q=AgPxStamp.roll(q);
    window.__agsistLastQ=q;
    var F=frontInfo(q,data),front=F.q,heroLabel=F.label;
    window.__agsistHeroQ=front;
    var __when=exchWhen(front,data.fetched);
    CROP.labels(heroLabel,F.nearby,__when);
    setTxt('ph-when',__when);
    if(front&&front.close!=null){setEl(CROP.heroTile[0],grain$(front.close));var hcT=chgTxt(front.netChange,front.pctChange,front.roll);setEl(CROP.heroTile[1],hcT.t,hcT.c);}
    CROP.tiles.forEach(function(m){var r=m.root?nearbyOf(q,m.root):null,mk=m.nc?newCropKey(m.nc[0],m.nc[1],q):m.key,d=m.root?(r&&r.d):(q[mk]||(m.alt&&q[m.alt]));if(!d||d.close==null)return;if(m.root){var pe=document.getElementById(m.p),le0=pe&&pe.parentNode.querySelector('.cc-lbl');if(le0)le0.textContent=m.name+' '+(r.label||'most-active')+' ('+m.sym+')';}if(m.lbl){var le=document.getElementById(m.lbl),cl=contractLabel(d);if(le&&cl)le.textContent=cl+' new crop';}setEl(m.p,m.g?grain$(d.close):raw$(d.close));var ch=chgTxt(d.netChange,d.pctChange,d.roll,m.g,m.u);setEl(m.c,ch.t,ch.c);});

    if(front&&front.close!=null){
      setEl('hero-price',grain$(front.close));
      /* The baked note and table are the no-script copy of these cards. Once
         the live quotes are up they showed a second, older price for the same
         contract ($4.81½ under a $4.82¾ hero). Hiding only the Nearby row left
         wheat's Mar '27 and KC rows at the 8:31 a.m. bake under live cards
         that said otherwise (2026-10-15), so the whole table goes. */
      var __st=document.querySelector('.seed-tbl-wrap');if(__st)__st.style.display='none';
      /* The note keeps its box and takes the live quote in the seed's words
         (seed_static.py state_words): hiding it moved everything below up
         62 px on a phone, CLS about 0.2 (phone audit, Oct 19, 2026). */
      var __sn=document.querySelector('.px-seed-note');
      if(__sn){
        var __s=window.AgPxStamp?AgPxStamp.stamp(front,data.fetched):'',__m=/^(.*) settle$/.exec(__s),__t=/^(?:Last|Overnight) trade as of (.*)$/.exec(__s),__u=/^Updated (.*)$/.exec(__s);
        var __v=__m?'settled at':__t?(/^Overnight/.test(__s)?'traded overnight near':'last traded near'):'last quoted near',__w=__m?__m[1]:__t?__t[1]:__u?__u[1]:'';
        var __cr={corn:'corn',beans:'soybeans',wheat:'wheat'}[CROP_KEY]||CROP.label.toLowerCase();
        __sn.style.minHeight=__sn.offsetHeight+'px';
        __sn.innerHTML=heroLabel+' '+__cr+' '+__v+' <strong>'+grain$(front.close)+'</strong>'+(front.stale?' (last good quote)':'')+(__w?' &middot; as of '+__w:'')+'.';
      }
      var hc=chgTxt(front.netChange,front.pctChange,front.roll);setEl('hero-chg',hc.t,hc.c);
      /* 2026-10-20 (Sig): the overnight electronic trade, when the file has one,
         beside the settle (price-local.js overnight). Titles keep the settle. */
      heroOvernight(front);
      if(front.roll){var __rn=document.querySelector('.px-seed-note');if(__rn){var __d=document.createElement('div');__d.className='roll-note';__d.innerHTML=CROP.rollNote;__rn.parentNode.insertBefore(__d,__rn);}}
      if(front.wk52_lo!=null&&front.wk52_hi!=null){
        var lo=front.wk52_lo,hi=front.wk52_hi,cu=front.close,rp=Math.min(100,Math.max(0,(cu-lo)/(hi-lo)*100));
        var _rg=AG.px.range(lo,hi);
        document.getElementById('rng-lo').textContent=_rg.lo;
        document.getElementById('rng-hi').textContent=_rg.hi;
        document.getElementById('rng-cur').textContent=grain$(cu);
        document.getElementById('rng-fill').style.width=rp+'%';
        document.getElementById('rng-dot').style.left='calc('+rp+'% - 6px)';
      }
    }
    CROP.prices(q,data,front);

    var sp=CROP.read(q,data,front,heroLabel,F.nearby);
    var mo=new Date().getMonth();
    sp.push(MONTH_TIPS[window.AGSIST_FUTURES][mo]);
    var dol=q.dollar;
    if(dol&&dol.close){if(dol.close>104)sp.push('the <strong>dollar at '+dol.close.toFixed(1)+'</strong> '+CROP.dollarHi);else if(dol.close<100)sp.push('the <strong>dollar at '+dol.close.toFixed(1)+'</strong> '+CROP.dollarLo);}
    if(sp.length){window.__agsistMR.base=sp;if(front&&front.close!=null){window.__agsistMR.breakeven=getBreakevenPhrase(front.close/100);}renderMarketRead();}
    /* v15: freshness timers. Fall back gracefully if loader.js timer module didn't load. */
    if(window.AgAsOf&&data.fetched){
      /* The site's one "Updated" stamp (components/asof.js), greyed with an age once stale. */
      var __st=document.getElementById('status');
      /* 2026-10-17: the stamp says what the price is: "Oct 16 settle" (close_kind
         settle) or "Last trade as of 1:46 pm CT", from components/price-local.js.
         A stale last trade keeps asof.js's age note. */
      var __pxs=pxStampHtml(front,data);
      /* an old settle greys the hero, as the stamp does (price-local.js settleAge) */
      var __age=front&&front.close_kind==='settle'&&window.AgPxStamp&&AgPxStamp.settleAge?AgPxStamp.settleAge(front.settle_date||front.close_date):null;
      Array.prototype.forEach.call(document.querySelectorAll('.ph,.cg'),function(__ph){__ph.classList.toggle('px-old',!!(__age&&__age.old));});
      if(__st){var __sx=(typeof computeMarketSession==='function')?computeMarketSession():null;
        __st.innerHTML=(__sx&&__sx.state==='closed'?'Market closed \u00b7 ':'')+__pxs;}
      var __sa=document.getElementById('snap-age');if(__sa){__sa.innerHTML=__pxs;__sa.hidden=!__pxs;}
    }else if(window.agsistTimer&&data.fetched){
      var statusTmr=document.getElementById('status-timer');
      var statusOld=document.getElementById('status');
      if(statusTmr&&statusOld){
        /* Weekend/evening honesty: a closed market isn't "DELAYED": quotes from
           Friday's close are exactly what they should be. (fixed 2026-07-20) */
        var __sess=(typeof computeMarketSession==='function')?computeMarketSession():null;
        if(__sess&&__sess.state==='closed'){
          window.agsistTimer.set(statusTmr,{mode:'since',target:data.fetched,label:'Market closed \u00b7 quotes from',showNext:false});
        }else{
          window.agsistTimer.set(statusTmr,{mode:'live',fetched:data.fetched,interval:30,label:'Markets'});
        }
        statusTmr.style.display='inline-flex';
        statusOld.style.display='none';
      }
      var snapTmr=document.getElementById('snap-age');
      if(snapTmr){
        window.agsistTimer.set(snapTmr,{mode:'since',target:data.fetched,showNext:false});
      }
    }else if(data.fetched){
      /* loader.js timer missing: fallback to original frozen behavior */
      var ageEl=document.getElementById('snap-age');
      if(ageEl){var am=Math.round((Date.now()-new Date(data.fetched).getTime())/60000);ageEl.textContent=am<2?'live':am<60?am+'m old':am<2880?Math.round(am/60)+'h old':Math.round(am/1440)+'d old';}
      var minsFB=Math.round((Date.now()-new Date(data.fetched).getTime())/60000);
      document.getElementById('status').textContent='Prices updated · '+(minsFB<2?'Just updated':minsFB<60?minsFB+' min ago':Math.round(minsFB/60)+'h ago');
    }
    /* Next-report line is populated by loadWasde() from /data/whats-priced-in.json (S3) , 
       the old new Date(y,m,10) guess was an invented date and is gone. */
    var minsForGA=data.fetched?Math.round((Date.now()-new Date(data.fetched).getTime())/60000):null;
    if(typeof gaEvent==='function')gaEvent('price_loaded',{page:CROP.ga,mins_old:minsForGA});

    // --- NEW: render forward curve ---
    renderForwardCurve(CROP_KEY,fwdContracts(q),q,true);
    /* the curve sizes itself to its box, which has no width inside a closed fold: draw again on open */
    window.addEventListener('agsist:fold-open',function(e){if(e&&e.detail==='fold-fwd'&&window.__agsistLastQ)renderForwardCurve(CROP_KEY,fwdContracts(window.__agsistLastQ),window.__agsistLastQ,true);});
    // --- v12: keep quotes accessible; reactive Market Read on breakeven change ---
    window.__agsistLastQ=q;
    window.addEventListener('be-updated',function(){
      var qq=window.__agsistLastQ; if(!qq)return;
      var front=frontQuote(qq); if(!front||front.close==null)return;
      window.__agsistMR.breakeven=getBreakevenPhrase(front.close/100);
      renderMarketRead();
    });
  })
  .catch(function(){
    /* S4: honest failure: a static-file fetch failure says nothing about market hours.
       Stop the loading animations, say exactly what happened, keep the seeded last close visible. */
    document.querySelectorAll('.sk').forEach(function(el){el.classList.remove('sk');});
    var psd=document.querySelector('.ps-dot');
    if(psd)psd.style.animation='none';
    var st=document.getElementById('status');
    (function(f){f();if(!window.AgStates)(window.AgStatesQ=window.AgStatesQ||[]).push(f);})(function(){if(st){if(window.AgStates)AgStates.error(st,{inline:true,msg:'Live prices didn\u2019t load. Showing the last close below.',retry:loadPrices});else st.textContent='Live update failed, showing last close (see note below).';}});
    /* the market read is built from live prices: say so rather than shimmer */
    var mw=document.getElementById('mr-where');if(mw&&mw.querySelector('.st-sk'))mw.textContent='The market read is built from live prices, and they didn\u2019t load.';
    var mt=document.getElementById('mr-what');if(mt&&mt.querySelector('.st-sk'))mt.textContent='';
  });
}
loadPrices();

/* 5-year range bar and the seasonal index, from /data/price-stats.json (was an
   inline script on each page). Stashes the seasonality for the chart and the
   scorecard and announces it with an "agsist-seas" event. */
(function(){var KEY=CROP.stats,QK=CROP_KEY;function $(i){return document.getElementById(i);}function m(v,md){return AG.px.priceDollars(v,{mode:md});}function ord(n){var v=n%100;if(v>=10&&v<=20)return "th";return {1:"st",2:"nd",3:"rd"}[n%10]||"th";}function band(p){return p<10?"historically very low: near a 5-year bottom":p<25?"historically low: below most of the last 5 years":p<45?"below the 5-year midpoint":p<=55?"right around the 5-year midpoint":p<75?"above the 5-year midpoint":p<90?"historically high: above most of the last 5 years":"historically very high: near a 5-year peak";}function ct(iso){try{return new Date(iso).toLocaleString("en-US",{timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})+" CT";}catch(e){return String(iso);}}function J(u){return AG.json(u).catch(function(){return null;});}
  /* 5-yr bar = ONE measure: the dot sits at the percentile the sentence prints (share of weekly closes at or below the price), not at (price-low)/(high-low). When price-stats.json carries the weekly history (hist), today's live quote is ranked against it so the bar and the hero show the same price; otherwise the stored position is shown and dated. */
  Promise.all([J("/data/price-stats.json"),J("/data/prices.json")]).then(function(a){var d=a[0],p=a[1],s=d&&d[KEY];if(s&&s.seasonality&&s.seasonality.length===12){window.__agsistSeas=s.seasonality;window.__agsistSeasN=s.seasonality_n||s.n||null;window.__agsistSeasS=s;try{window.dispatchEvent(new Event("agsist-seas"));}catch(e){}}if(!s||s.pct==null)return;var w=$("rng5-wrap");if(!w)return;var qs=(p&&p.quotes)||{},q=qs[QK+"-nearby"]||qs[QK]||null,live=(q&&q.close!=null)?q.close/100:null;var h=s.hist,cur,pct,n,lo,hi,note;if(h&&h.length>=29&&live!=null){var c=1;lo=live;hi=live;for(var i=0;i<h.length;i++){if(h[i]<=live)c++;if(h[i]<lo)lo=h[i];if(h[i]>hi)hi=h[i];}n=h.length+1;pct=Math.round(100*c/n);cur=live;note="Ranks "+pxWhat(q,p.fetched,ct)+" ("+m(live)+") against the prior "+h.length+" weekly closes.";}else{pct=s.pct;cur=s.cur;n=s.n;lo=s.lo;hi=s.hi;note="5-yr position as of the "+(d.updated?ct(d.updated):"last")+" update ("+m(s.cur)+"), not today’s live quote.";}pct=Math.max(0,Math.min(100,pct));$("rng5-lo").textContent="5-yr low "+m(lo,"down");$("rng5-hi").textContent="5-yr high "+m(hi,"up");$("rng5-cur").textContent=m(cur)+" · "+pct+ord(pct)+" pct";$("rng5-fill").style.width=pct+"%";$("rng5-dot").style.left="calc("+pct+"% - 6px)";$("rng5-read").textContent="At the "+pct+ord(pct)+" percentile of the last "+(s.years||5)+" years: "+band(pct)+". n = "+n+" weekly closes, continuous front-month (Yahoo Finance, delayed, not CME settlements). "+note;w.style.display="";});})();


/* RP revenue floor from data/harvest-prices.json, corn and soybeans. This ran
   as a separate inline script that tested `typeof CROP_KEY`, a variable inside
   another script's closure, so it never ran on any of the three pages. The
   harvest price counts as still setting while the October window is running,
   not only before it opens. */
(function(){
  var LMAP={corn:'Corn',beans:'Soybeans'};
  var want=LMAP[CROP_KEY];
  if(!want)return; // wheat is not in harvest-prices.json: the RP line stays hidden
  fetch('/data/harvest-prices.json',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){
    if(!d||!d.commodities)return;
    var row=d.commodities.filter(function(c){return c&&c.label===want;})[0];
    if(!row)return;
    var pj=(row.projected&&row.projected.price!=null)?Number(row.projected.price):null;
    var hv=(row.harvest&&row.harvest.price!=null)?Number(row.harvest.price):null;
    var floor=(pj!=null&&hv!=null)?Math.max(pj,hv):(pj!=null?pj:hv);
    if(floor==null)return;
    var hs=row.harvest&&row.harvest.status;
    window.__agsistMR=window.__agsistMR||{};
    window.__agsistMR.rpCtx={floor:floor,projected:pj,harvest:hv,contract:row.contract||null,window:(row.projected&&row.projected.window)||null,harvestPending:(hv==null&&(hs==='pending'||hs==='running')),cropYear:d.crop_year||null,
      running:(hs==='running'&&row.harvest.running_avg!=null&&row.harvest.series&&row.harvest.series.length)?Number(row.harvest.running_avg):null,
      days:(row.harvest&&row.harvest.series)?row.harvest.series.length:null,daysTotal:(row.harvest&&row.harvest.days_total)||null};
    try{renderScorecard();}catch(e){}
    try{renderMarketRead();}catch(e){}
  }).catch(function(){});
})();



// TRADINGVIEW: fully decoupled from prices, loads independently, degrades gracefully
document.addEventListener('DOMContentLoaded',function(){
  // S7: seasonal chart driven by /data/price-stats.json seasonality (stashed by the
  // 5-yr range code as window.__agsistSeas). No data: the card stays hidden;
  // nothing invented.
  function seasCap(s){if(!s)return null;var y=s.seasonality_years;if(s.seasonality_method==='calendar-year-detrended'&&y&&y.length===2){return 'Weekly closes for whole calendar years '+y[0]+'–'+y[1]+', each divided by its own year’s average, then averaged by month and scaled 0–100 (0 = weakest month, 100 = strongest; n='+(s.seasonality_n||'?')+' weeks). Continuous front-month (Yahoo Finance), not roll-adjusted. '+(y[1]-y[0]+1)+' years is a short window: a description of these years, not a forecast.';}return 'Average weekly close by calendar month over a rolling '+(s.years||5)+'-yr window, scaled 0–100 (n='+s.n+' weeks). Raw levels, not detrended, and the window starts and ends mid-year, so in a trending market the months sampled from the earliest or latest year read low or high for that reason alone. A description of these years, not a forecast.';}
  function renderSeasonal(){
    var seas=window.__agsistSeas;
    var wrap=document.getElementById('seas-wrap');
    var ch=document.getElementById('seas-chart');
    if(!wrap||!ch||!seas||seas.length!==12)return;
    var MOS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var cm=new Date().getMonth();
    ch.innerHTML='';
    seas.forEach(function(v,i){var c=document.createElement('div');c.className='seas-col'+(i===cm?' cur':'');c.title=MOS[i]+': '+v+'/100';c.innerHTML='<div style="flex:1"></div><div class="seas-bar" style="height:'+Math.max(4,v*.5)+'px"></div><div class="seas-mo">'+MOS[i]+'</div>';ch.appendChild(c);});
    var capEl=document.getElementById('seas-caption');
    var capTx=seasCap(window.__agsistSeasS);if(capEl&&capTx)capEl.textContent=capTx+CROP.seasSuffix;
    wrap.style.display='block';
    try{renderScorecard();}catch(e){}
  }
  window.addEventListener('agsist-seas',renderSeasonal);
  renderSeasonal();

  // TradingView widget: CAPITALCOM:CORN / SOYBEAN / WHEAT are CFDs that track
  // the CBOT contract and render on the free tier without a TradingView account
  // tv.js is a large third-party bundle and the chart sits below the fold, so
  // it is fetched only when the chart nears the viewport or the reader taps
  // the button. Until then the box holds a static placeholder with a link.
  var tvStarted=false,tvTimeout=null;
  function tvFail(){
    var chart=document.getElementById('tv-chart');
    var fallback=document.getElementById('tv-fallback');
    if(chart)chart.style.display='none';
    if(fallback)fallback.style.display='flex';
  }
  function initTV(){
    var chart=document.getElementById('tv-chart');
    if(!chart)return;
    try{
      chart.innerHTML='';
      new TradingView.widget({container_id:'tv-chart',autosize:true,symbol:CROP.tv,interval:'D',timezone:'America/Chicago',theme:'dark',style:'1',locale:'en',toolbar_bg:'#1a2410',enable_publishing:false,hide_top_toolbar:false,hide_legend:false,save_image:false,backgroundColor:'#1a2410',gridColor:'rgba(255,255,255,0.04)',allow_symbol_change:false});
    }catch(e){clearTimeout(tvTimeout);tvFail();}
  }
  function startTV(){
    if(tvStarted)return;
    var chart=document.getElementById('tv-chart');
    if(!chart)return;
    tvStarted=true;
    var btn=document.getElementById('tv-load');
    if(btn){btn.disabled=true;btn.textContent='Loading chart';}
    tvTimeout=setTimeout(function(){if(!chart.querySelector('iframe'))tvFail();},8000);
    if(typeof TradingView!=='undefined'){initTV();return;}
    var s=document.createElement('script');
    s.src='https://s3.tradingview.com/tv.js';s.async=true;
    s.onload=function(){if(typeof TradingView!=='undefined')initTV();else{clearTimeout(tvTimeout);tvFail();}};
    s.onerror=function(){clearTimeout(tvTimeout);tvFail();};
    document.head.appendChild(s);
  }
  (function(){
    var chart=document.getElementById('tv-chart');
    if(!chart)return;
    var btn=document.getElementById('tv-load');
    if(btn)btn.addEventListener('click',startTV);
    if('IntersectionObserver' in window){
      var io=new IntersectionObserver(function(es){
        if(es.some(function(e){return e.isIntersecting;})){io.disconnect();startTV();}
      },{rootMargin:'300px'});
      io.observe(chart);
    } else {
      startTV();
    }
  })();

  document.querySelectorAll('.faq-q').forEach(function(q){
    q.setAttribute('aria-expanded','false');
    q.addEventListener('click',function(){
      var it=this.closest('.faq-item'),op=it.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach(function(i){i.classList.remove('open');i.querySelector('.faq-q').setAttribute('aria-expanded','false');});
      if(!op){it.classList.add('open');q.setAttribute('aria-expanded','true');if(typeof gaEvent==='function')gaEvent('faq_open',{q:q.textContent.trim().slice(0,60)});}
    });
    q.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();q.click();}});
  });
});
})();
