/* AGSIST homepage page script: the code that ran from inline <script> blocks
   at the end of index.html, moved here on 2026-10-12 so a returning reader's
   phone keeps it (sw.js serves ?v= files from its cache) instead of pulling
   ~120 KB inside the page on every visit. index.html loads it as a plain
   script where the first block stood, so it runs in the same place and order:
   after the page is parsed, before the deferred components (loader, geo,
   bids-homepage, ...). Each former block keeps its own try/catch, so one
   failing block still cannot stop the ones after it, as with separate tags.
   Bump ?v= in index.html when this file changes. */
(function () {
/* One date helper for the homepage cards (fertilizer, exports, tariffs, crop
   progress). "2026-10-09" reads as that calendar day; a full timestamp is
   read as is. Nothing on file prints `empty`. */
function fmtDate(iso, empty) {
  if (!iso) return empty == null ? '-' : empty;
  var d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + 'T12:00:00' : iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function blockFailed(e) { setTimeout(function () { throw e; }, 0); }

/* ---- former inline block 1 ---- */
try {
(function(){
  'use strict';
  function fmtK(n){if(n==null||isNaN(n))return'--';var abs=Math.abs(n);var str=abs>=1000?(abs/1000).toFixed(1)+'k':String(abs);return(n>=0?'+':'\u2212')+str;}
  function fmtKShort(n){if(n==null||isNaN(n))return'--';var abs=Math.abs(n);if(abs>=1000)return(n<0?'\u2212':'')+Math.round(abs/1000)+'k';return String(Math.round(n)).replace('-','\u2212');}
  function renderCOTRow(key,d){
    var netEl=document.getElementById('cot-'+key+'-net'),chgEl=document.getElementById('cot-'+key+'-chg');
    var dirEl=document.getElementById('cot-'+key+'-dir');
    var fillEl=document.getElementById('cot-'+key+'-fill'),zeroEl=document.getElementById('cot-'+key+'-zero');
    var dotEl=document.getElementById('cot-'+key+'-dot'),minEl=document.getElementById('cot-'+key+'-min'),maxEl=document.getElementById('cot-'+key+'-max');
    var net=d.net,prev=d.prev,min52=d.min52,max52=d.max52,range=(max52-min52)||1;
    var isLong=net>=0;
    /* 2026-09-25 audit: /cot labels a net inside +/-5,000 contracts FLAT; this row said SHORT for wheat at -3,674. Same threshold, same word. */
    var isFlat=Math.abs(net)<5000;
    if(netEl){netEl.textContent=fmtK(net);netEl.style.color=isFlat?'var(--text-muted)':isLong?'var(--green)':'var(--red)';}
    if(dirEl){dirEl.textContent=isFlat?'FLAT':isLong?'LONG':'SHORT';dirEl.className='cot-dir '+(isFlat?'':isLong?'long':'short');dirEl.style.color=isFlat?'var(--text-muted)':'';}
    if(chgEl&&prev!=null){var chg=net-prev;chgEl.textContent=(chg>=0?'\u25b2':'\u25bc')+fmtK(Math.abs(chg)).replace(/^[+\u2212-]/,'');chgEl.className='cot-chg '+(chg>0?'up':chg<0?'dn':'nc');}
    if(minEl)minEl.textContent=fmtKShort(min52);if(maxEl)maxEl.textContent=fmtKShort(max52);
    var zeroPct=Math.max(0,Math.min(100,((0-min52)/range)*100));
    var currPct=Math.max(0,Math.min(100,((net-min52)/range)*100));
    var fillStart=Math.min(zeroPct,currPct),fillWidth=Math.abs(currPct-zeroPct);
    var fillClr=isLong?'rgba(34,197,94,.4)':'rgba(239,68,68,.38)',dotClr=isLong?'var(--green)':'#ef4444';
    if(zeroEl)zeroEl.style.left=zeroPct.toFixed(1)+'%';
    if(fillEl){fillEl.style.left=fillStart.toFixed(1)+'%';fillEl.style.width=fillWidth.toFixed(1)+'%';fillEl.style.background=fillClr;}
    if(dotEl){dotEl.style.left=currPct.toFixed(1)+'%';dotEl.style.background=dotClr;}
  }
  /* WAVE1-C 2026-10-03: THE ROWS ARE A LIST. Order here is display order;
     the first COT_SHOWN sit in the card, the rest in "More markets" below it.
     A crop picker reorders this array and calls window.AGSIST_COT.render().
     k: cot.json key. id: DOM id stem (the four original rows keep theirs).
     v: counts toward the badge, which averages the original four (the
     tooltip says so). All series are CFTC disaggregated managed money. */
  var COT_ROWS=[
    {k:'corn',id:'corn',n:'Corn',v:'g'},
    {k:'beans',id:'beans',n:'Soybeans',v:'g'},
    {k:'wheat',id:'wheat',n:'Wheat, Chicago SRW',v:'g'},
    {k:'livecattle',id:'cattle',n:'Live cattle',v:'l'},
    {k:'kcwheat',id:'kcwheat',n:'Wheat, KC HRW'},
    {k:'mplswheat',id:'mplswheat',n:'Wheat, MGEX HRS'},
    {k:'soymeal',id:'meal',n:'Soybean meal'},
    {k:'feedercattle',id:'feeders',n:'Feeder cattle'},
    {k:'leanhogs',id:'hogs',n:'Lean hogs'},
    {k:'milk',id:'milk',n:'Class III milk'}
  ],COT_SHOWN=4;
  function cotRowEl(r){
    var el=document.querySelector('#cot-widget .cot-row-'+r.id);
    if(!el){
      el=document.createElement('div');el.className='cot-row-'+r.id;
      var i=r.id;
      el.innerHTML='<div class="cot-row-top"><div class="cot-label"><span class="cot-comm-name"></span></div><div class="cot-right"><span class="cot-dir nc" id="cot-'+i+'-dir">--</span><span class="cot-net" id="cot-'+i+'-net">--</span><span class="cot-chg nc" id="cot-'+i+'-chg">--</span></div></div><div class="cot-bar-wrap"><div class="cot-bar-fill" id="cot-'+i+'-fill"></div><div class="cot-zero-mark" id="cot-'+i+'-zero"></div><div class="cot-bar-dot" id="cot-'+i+'-dot" style="background:var(--text-muted)"></div></div><div class="cot-bar-labels"><span id="cot-'+i+'-min">--</span><span>52-week range</span><span id="cot-'+i+'-max">--</span></div>';
    }
    var nm=el.querySelector('.cot-comm-name');if(nm&&nm.textContent!==r.n)nm.textContent=r.n;
    return el;
  }
  function placeCOT(data){
    var main=document.getElementById('cot-rows');if(!main)return;
    var more=document.getElementById('cot-more'),moreRows=document.getElementById('cot-rows-more');
    if(!more){
      more=document.createElement('details');more.id='cot-more';more.className='cot-more';
      more.innerHTML='<summary></summary><div class="cot-rows-more" id="cot-rows-more"></div>';
      main.appendChild(more);moreRows=more.querySelector('.cot-rows-more');
    }
    var extra=[];
    /* The fold lives inside #cot-rows, last, so every #cot-rows style reaches its rows. */
    COT_ROWS.forEach(function(r,i){var el=cotRowEl(r);if(i<COT_SHOWN)main.insertBefore(el,more);else moreRows.appendChild(el);
      if(i>=COT_SHOWN)extra.push(r.n.replace(/^Wheat, /,''));
      if(data&&!data[r.k]){var n=document.getElementById('cot-'+r.id+'-net');if(n)n.textContent='-';var c=document.getElementById('cot-'+r.id+'-chg');if(c){c.textContent='not in this week\u2019s file';c.className='cot-chg nc';}}});
    more.style.display=extra.length?'':'none';
    more.querySelector('summary').textContent=extra.length+' more market'+(extra.length===1?'':'s');
    more.querySelector('summary').title=extra.join(', ');
  }
  /* WAVE3-L: after a failed cot.json there are no rows to put back. */
  window.AGSIST_COT={rows:COT_ROWS,render:function(){if(window.AGSIST_COT.failed)return;placeCOT(window.AGSIST_COT._d);}};
  /* WAVE3-L: one badge per group. The old badge averaged three grains with
     live cattle; a cattle feeder and a corn grower read different markets.
     Same thresholds as before, applied to each group on its own. */
  /* 2026-10-10 ONE MEASURE OF CROWDED. The badge averaged each row's place in
     its 52-week range in contracts and said "near 52-wk high" while the COT
     page, on its own measure, called the same funds "high side but not
     extreme". It now names the markets that are crowded on that one measure
     (cot-analysis.json `crowd`), and says so when none is. */
  var COT_CX=null;
  function cotIso(s){var d=new Date(String(s||'')+(/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?'T12:00:00':''));return isNaN(d)?'':d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);}
  function cxFor(k,data){var c=COT_CX&&COT_CX.commodities&&COT_CX.commodities[k];return (c&&c.date&&data&&cotIso(c.date)===cotIso(data.report_date))?c:null;}
  function rankTxt(c){var cr=c.crowd,p=cr?cr.pctl:(c.pctl&&c.pctl.net_oi_all);if(p==null)return '';
    if(c.crowded&&cr&&cr.word)return cr.word+', crowded '+c.crowded;   /* "bottom 1%", never "0th" */
    var r=Math.max(1,Math.min(99,Math.round(p))),o=['th','st','nd','rd'],v=r%100;return r+(o[(v-20)%10]||o[v]||o[0])+' pct'+(c.crowded?', crowded '+c.crowded:'');}
  function badge(el,rows,data,label){
    if(!el)return;
    var have=0,hot=[];rows.forEach(function(r){var c=cxFor(r.k,data);if(!c)return;have++;if(c.crowded)hot.push({n:r.n.replace(/^Wheat, /,'').replace(/^Live cattle$/,'live cattle'),s:c.crowded});});
    if(!have){el.hidden=true;return;}
    el.hidden=false;
    el.title='Crowded: net as a share of open interest in the top or bottom tenth of every week since 2010, on the side the position is on (the COT page\u2019s measure).';
    if(!hot.length){el.className='cot-verdict mixed';el.textContent=label+': none crowded';return;}
    var lg=hot.filter(function(h){return h.s==='long';}),sh=hot.filter(function(h){return h.s==='short';});
    el.className='cot-verdict '+(lg.length&&!sh.length?'long':sh.length&&!lg.length?'short':'mixed');
    el.textContent=label+': crowded '+(lg.length?'long, '+lg.map(function(h){return h.n;}).join(', '):'')+(lg.length&&sh.length?'; crowded ':'')+(sh.length?'short, '+sh.map(function(h){return h.n;}).join(', '):'');
  }
  function rankRows(data){
    COT_ROWS.forEach(function(r){
      /* its own line under the name and numbers, so the row's figures keep their width */
      var top=document.querySelector('#cot-widget .cot-row-'+r.id+' .cot-row-top');if(!top)return;
      var sp=top.parentNode.querySelector('.cot-rank');var c=cxFor(r.k,data),t=c?rankTxt(c):'';
      if(!t){if(sp)sp.remove();return;}
      if(!sp){sp=document.createElement('div');sp.className='cot-rank';sp.style.cssText='font-size:.8em;color:var(--text-muted);font-weight:600;margin:.05rem 0 .1rem';top.parentNode.insertBefore(sp,top.nextSibling);}
      sp.textContent='Rank since '+String(c.first_week||'2010').slice(0,4)+': '+t;sp.title=(c.crowd&&c.crowd.word?c.crowd.word+': ':'')+'net as a share of open interest, against every week since '+String(c.first_week||'2010').slice(0,4);
    });
  }
  /* The crowding badges and rank lines: drawn again once cot-analysis.json
     arrives (it loads when the COT card comes near the screen; see below). */
  function cxPaint(data){
    badge(document.getElementById('cot-verdict'),COT_ROWS.filter(function(r){return r.v==='g';}),data,'Grains');
    badge(document.getElementById('cot-verdict-lv'),COT_ROWS.filter(function(r){return r.v==='l';}),data,'Live cattle');
    /* both quiet: one short line instead of two right-aligned badges */
    (function(){var g=document.getElementById('cot-verdict'),l=document.getElementById('cot-verdict-lv');
      if(g&&l&&!g.hidden&&!l.hidden&&/none crowded$/.test(g.textContent)&&/none crowded$/.test(l.textContent)){g.textContent='No market crowded';l.hidden=true;}})();
    rankRows(data);
  }
  function renderCOT(data){
    window.AGSIST_COT._d=data;placeCOT(data);
    COT_ROWS.forEach(function(row){if(data[row.k])renderCOTRow(row.id,data[row.k]);});
    cxPaint(data);
    var dateEl=document.getElementById('cot-date');
    if(dateEl&&data.report_date){
      var _rds=String(data.report_date);
      var rd=/^\d{4}-\d{2}-\d{2}$/.test(_rds)?new Date(_rds+'T12:00:00'):new Date(_rds);
      var rdOk=rd&&!isNaN(rd.getTime());
      var daysOld=rdOk?Math.round((Date.now()-rd.getTime())/86400000):null;
      var _cmo=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var _cDisp=rdOk?_cmo[rd.getMonth()]+' '+rd.getDate()+', '+rd.getFullYear():_rds;
      var ageNote=daysOld==null?'pending':daysOld<=13?'current':'<svg class="ic" aria-hidden="true"><use href="#i-triangle-alert"/></svg> '+daysOld+'d old';
      var _cs=window.AgAsOf?AgAsOf.html(data.updated,'usda'):'';
      dateEl.innerHTML=(_cs?'Positions as of '+_cDisp+(daysOld!=null&&daysOld>=14?' ('+ageNote+')':'')+' \u00b7 '+_cs:'As of '+_cDisp+' ('+ageNote+')')+' \u00b7 CFTC <span id="cot-countdown" style="color:var(--gold);font-weight:700"></span>';
      if(daysOld!=null&&daysOld>=14){dateEl.style.color='#f0913a';}
      (function(){
        /* 2026-09-25 audit: this counted to Friday 21:30 UTC, two hours after the 3:30pm ET release in summer (19:30 UTC) and one hour after it in winter (20:30 UTC). CFTC publishes at 3:30pm New York time; ask the browser what New York's clock says instead of fixing a UTC hour. */
        function nx(now){for(var i=0;i<9;i++){var d=new Date(now+i*86400000);if(d.getUTCDay()!==5)continue;var t=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),20,30,0);var h=+new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',hourCycle:'h23'}).format(new Date(t));if(h===16)t-=3600000;if(t>now)return t;}return now+604800000;}
        function fmt(ms){if(ms<=0)return null;var s=Math.floor(ms/1000),d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60);return d>0?d+'d '+h+'h':h>0?h+'h '+m+'m':(m>0?m+'m':'<1m');}
        function tick(){var el=document.getElementById('cot-countdown');if(!el)return;var now=Date.now(),f=fmt(nx(now)-now);el.textContent=f?('\u00b7 next in '+f):'\u00b7 update due';}
        tick();setInterval(tick,60000);
      })();
    }
  }
  /* 2026-10-16: cot-analysis.json is about 100 KB for a few crowding words,
     so it loads only when the COT card comes within reach of the screen (on
     a phone the card sits in a closed fold, so most visits never pull it).
     Until then the rows show with no badge; nothing is guessed. */
  function lazyCX(d){
    var w=document.getElementById('cot-widget'),done=false;
    function go(){if(done)return;done=true;
      fetch('/data/cot-analysis.json').then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}).then(function(a){if(!a)return;COT_CX=a;cxPaint(window.AGSIST_COT._d||d);});}
    if(!w||!('IntersectionObserver' in window)){go();return;}
    var io=new IntersectionObserver(function(es){if(es.some(function(e){return e.isIntersecting;})){io.disconnect();go();}},{rootMargin:'600px 0px'});
    io.observe(w);
  }
  /* WAVE3-L: a failed or malformed cot.json is one line, not ten rows of
     placeholders. */
  /* data/cot-analysis.json carries the one crowding measure (cot_analysis.py
     `crowd`); it is used only when it is for the same week as cot.json. */
  AG.json('/data/cot.json').then(function(d){
    if(!d||typeof d!=='object'||!COT_ROWS.some(function(r){return d[r.k]&&d[r.k].net!=null;}))throw new Error('cot malformed');return d;
  }).then(function(d){renderCOT(d);lazyCX(d);},function(){
    window.AGSIST_COT.failed=true;
    var verdict=document.getElementById('cot-verdict');if(verdict)verdict.hidden=true;var _cw=document.getElementById('cot-widget');if(_cw)_cw.classList.add('cot-na');
    var rows=document.getElementById('cot-rows');if(rows)rows.innerHTML='<p class="cot-fail" role="status">CFTC positions did not load.</p>';
    var cap=_cw&&_cw.querySelector('.cot-caption');if(cap)cap.hidden=true;
  });
})();
} catch (e) { blockFailed(e); }

/* ---- former inline block 2 ---- */
try {
(function(){
  var BASE='https://www.cpc.ncep.noaa.gov/products/predictions/';
  var tempImg=document.getElementById('noaa-temp-img'),precipImg=document.getElementById('noaa-precip-img'),label=document.getElementById('noaa-period-label');
  // URL patterns differ by period:
  //   30-day monthly: /30day/off15_temp.gif  + /30day/off15_prcp.gif
  //   90-day seasonal (lead 1, nearest 3-month window): /long_range/lead01/off01_temp.gif + /long_range/lead01/off01_prcp.gif
  function urlsFor(period){
    if(period==='90'){
      return {temp:'/data/outlooks/noaa_temp_90day.gif',precip:'/data/outlooks/noaa_prcp_90day.gif',alt_t:'NOAA 3-month seasonal temperature outlook',alt_p:'NOAA 3-month seasonal precipitation outlook',fallback:'https://www.cpc.ncep.noaa.gov/products/predictions/long_range/seasonal.php'};
    }
    return {temp:'/data/outlooks/noaa_temp_30day.gif',precip:'/data/outlooks/noaa_prcp_30day.gif',alt_t:'NOAA 1-month temperature outlook',alt_p:'NOAA 1-month precipitation outlook',fallback:'https://www.cpc.ncep.noaa.gov/products/predictions/30day/'};
  }
  function setImg(img,src,alt,fallbackUrl){
    if(!img)return;
    var err=img.nextElementSibling;
    img.style.display='';
    if(err&&err.classList.contains('noaa-img-err')){
      err.style.display='none';
      // update fallback link target to match current period so manual onerror still lands right
      var a=err.querySelector('a');if(a)a.setAttribute('href',fallbackUrl);
    }
    img.alt=alt;
    img._loaded=true;
    img.src=src;
  }
  // Lazy-init: defer initial NOAA image load until scrolled into view (rural-bandwidth friendly)
  function lazyInit(img){
    if(!img||!img.dataset.src||img._loaded)return;
    function loadNow(){if(img._loaded)return;img._loaded=true;img.src=img.dataset.src;}
    if('IntersectionObserver' in window){
      var io=new IntersectionObserver(function(e){if(e[0].isIntersecting){loadNow();io.disconnect();}},{rootMargin:'400px'});
      io.observe(img);
    } else loadNow();
  }
  lazyInit(tempImg);lazyInit(precipImg);
  document.querySelectorAll('#noaa-tabs .noaa-tab').forEach(function(btn){
    btn.addEventListener('click',function(){
      document.querySelectorAll('#noaa-tabs .noaa-tab').forEach(function(b){b.classList.remove('active');});
      btn.classList.add('active');
      var p=btn.getAttribute('data-period'),lbl=btn.getAttribute('data-label');
      if(label)label.textContent=lbl;
      var u=urlsFor(p);
      setImg(tempImg,u.temp,u.alt_t,u.fallback);
      setImg(precipImg,u.precip,u.alt_p,u.fallback);
    });
  });
})();
} catch (e) { blockFailed(e); }

/* ---- former inline block 3 ---- */
try {
(function(){
'use strict';
var SHOW_COMMS=['Soybeans','Corn','Wheat','Pork'];
function statusCls(s){return s==='elevated'?'elevated':s==='normal'?'normal':'mixed';}
function statusIcon(s){return s==='elevated'?'<svg class="ic" aria-hidden="true"><use href="#i-siren"/></svg>':s==='normal'?'<svg class="ic" aria-hidden="true"><use href="#i-circle-check"/></svg>':'<svg class="ic" aria-hidden="true"><use href="#i-triangle-alert"/></svg>';}
function statusTxt(s){return s==='elevated'?'Trade War Active':s==='normal'?'Normal Trade':'Mixed';}

/* 2026-10-06 EARN: off the homepage; nothing to fill. */
if(document.getElementById('tariff-rows'))fetch('/data/tariffs.json')
  .then(function(r){if(!r.ok)throw new Error('no-tariffs');return r.json();})
  .then(function(data){
    var badge=document.getElementById('tariff-badge'),cls=statusCls(data.status);
    if(badge){badge.className='tariff-status-badge '+cls;badge.innerHTML=statusIcon(data.status)+' '+statusTxt(data.status);}
    var dateEl=document.getElementById('tariff-date');if(dateEl)dateEl.textContent='Updated '+fmtDate(data.updated);
    var rows=(data.rows||[]).filter(function(r){return r.destination.indexOf('China')>=0&&SHOW_COMMS.indexOf(r.commodity)>=0;}).slice(0,4);
    var container=document.getElementById('tariff-rows');
    if(container&&rows.length){container.innerHTML=rows.map(function(row){var sc=statusCls(row.status);return '<div class="tariff-row"><span class="tariff-row-comm">'+esc(row.commodity)+'</span><span class="tariff-row-dest">\u2192 '+esc(row.destination)+'</span><span class="tariff-row-rate '+sc+'">'+esc(row.rate)+'</span></div>';}).join('');}
  })
  .catch(function(){var badge=document.getElementById('tariff-badge');if(badge){badge.className='tariff-status-badge mixed';badge.textContent='Data unavailable';}var _tr=document.getElementById('tariff-rows');if(_tr)_tr.innerHTML='';});
})();
} catch (e) { blockFailed(e); }

/* ---- former inline block 4 ---- */
try {
(function(){
'use strict';
function fmtPct(n){return n==null?'--':n+'%';}
/* r7-prices: a change in a percentage rating is in points, and no change is "unch". */
function fmtChg(cur,prev,suffix){if(cur==null||prev==null)return{txt:'Not loaded yet',cls:'nc'};var d=cur-prev;if(d===0)return{txt:'unch',cls:'nc'};var a=Math.abs(d);return{txt:(d>0?'\u25b2 +':'\u25bc \u2212')+a+(suffix===' points'&&a===1?' point':(suffix||'')),cls:d>0?'up':'dn'};}
function geClass(v){if(v==null)return'fair';return v>=60?'good':v>=40?'fair':'poor';}
/* 2026-10-06 EARN: off the homepage; nothing to fill. */
if(document.getElementById('crop-rows'))AG.json('/data/crop-progress.json')
  .then(function(data){
    if(!data||typeof data!=='object'||(!data.corn&&!data.soybeans))throw new Error('cp malformed');
    if(data.report_date){var d=document.getElementById('crop-date');if(d)d.textContent='As of '+fmtDate(data.report_date)+' \u00b7 NASS';}
    if(data.week){var wb=document.getElementById('crop-week-badge');if(wb)wb.textContent='Week '+data.week;}
    if(!data.in_season){var rows=document.getElementById('crop-rows');if(rows)rows.innerHTML='<div class="crop-offseason"><svg class="ic" aria-hidden="true"><use href="#i-snowflake"/></svg> Off season, resumes April<br><span style="font-size:.765rem;margin-top:.2rem;display:block">Last season data shown when available</span></div>';}
    var allNull=true,_needHarvestNote=[];
    ['corn','soybeans'].forEach(function(comm){
      var key=comm==='soybeans'?'bean':comm,d=data[comm];if(!d)return;
      var geEl=document.getElementById('crop-'+key+'-ge');
      var wkEl=document.getElementById('crop-'+key+'-wk'),yrEl=document.getElementById('crop-'+key+'-yr');
      var changeRow=wkEl?wkEl.parentElement:null;
      if(d.good_excellent!=null){
        if(geEl){geEl.textContent=fmtPct(d.good_excellent);geEl.className='crop-ge-val '+geClass(d.good_excellent);geEl.style.display='';allNull=false;}
        var wkChg=fmtChg(d.good_excellent,d.good_excellent_prev_week,' points'),yrChg=fmtChg(d.good_excellent,d.good_excellent_prev_year,' points');
        if(wkEl){wkEl.textContent=wkChg.txt;wkEl.className='crop-chg '+wkChg.cls;}
        if(yrEl){if(d.good_excellent_prev_year==null){yrEl.hidden=true;var _yl=yrEl.nextElementSibling;if(_yl&&_yl.classList.contains('crop-chg-lbl'))_yl.hidden=true;}else{yrEl.textContent=yrChg.txt;yrEl.className='crop-chg '+yrChg.cls;}}
        if(changeRow)changeRow.style.display='';
      }else{
        if(geEl)geEl.style.display='none';
        if(changeRow)changeRow.style.display='none';
      }
      var plantEl=document.getElementById('crop-'+key+'-plant'),barEl=document.getElementById('crop-'+key+'-bar');
      /* r7-prices: from August on, "planted" is a finished number. Show
         harvested and mature when the file carries them; this file does not
         carry them for corn or soybeans yet, so say so once and hide the row. */
      var _prow=plantEl?plantEl.parentElement:null,_lbl=_prow?_prow.querySelector('.crop-plant-lbl'):null;
      if(new Date().getMonth()>=7){
        var _hp=d.harvested_pct!=null?d.harvested_pct:d.harvest_pct,_mp=d.mature_pct;
        if(_hp!=null||_mp!=null){
          var _main=_hp!=null?_hp:_mp;
          if(plantEl)plantEl.textContent=fmtPct(_main);
          if(_lbl)_lbl.textContent=(_hp!=null?'harvested':'mature')+(_hp!=null&&_mp!=null?' \u00b7 '+_mp+'% mature':'');
          if(barEl)barEl.style.width=Math.min(_main,100)+'%';
          allNull=false;
        }else{
          if(_prow)_prow.style.display='none';
          _needHarvestNote.push(comm);
        }
      }else{
      if(plantEl)plantEl.textContent=d.planting_pct!=null?fmtPct(d.planting_pct):'Not loaded yet';
      if(barEl)barEl.style.width=Math.min(d.planting_pct||0,100)+'%';
      if(d.planting_pct!=null)allNull=false;
      }
    });
    if(_needHarvestNote.length){var _cr=document.getElementById('crop-rows');if(_cr&&!document.getElementById('r7-crop-note')){var _n=document.createElement('div');_n.id='r7-crop-note';_n.className='r7-crop-note';_n.textContent='Harvested and mature'+(_needHarvestNote.length===1?' ('+_needHarvestNote[0]+')':'')+': Not loaded yet.';_cr.appendChild(_n);}}
    if(allNull&&data.in_season!==false){var rows=document.getElementById('crop-rows');if(rows)rows.innerHTML='<div class="crop-offseason">Season starting, ratings begin once planting gets underway.<br><span style="font-size:.765rem;margin-top:.25rem;display:block">Typically mid-April for corn &amp; soybean country</span></div>';}
  })
  /* WAVE3-L: a failed file is one line. It used to say "Data pending" and
     print "--% planted" in October. */
  .catch(function(){var d=document.getElementById('crop-date');if(d)d.textContent='USDA NASS \u00b7 Weekly';var rows=document.getElementById('crop-rows');if(rows)rows.innerHTML='<p class="crop-fail" role="status">Crop progress did not load.</p>';});
})();
} catch (e) { blockFailed(e); }

/* ---- former inline block 5 ---- */
try {
(function(){
'use strict';
/* r7-prices: USDA reports export sales in metric tons; a grower reads
   bushels. Standard factors: corn 39.368 bu per metric ton, soybeans and
   wheat 36.744. The factor is printed in the footer tooltip. */
var BU_PER_MT={corn:39.368,soybeans:36.744,wheat:36.744};
function fmtBu(n,comm){if(n==null||isNaN(n)||!BU_PER_MT[comm])return'Not loaded yet';var b=n*BU_PER_MT[comm];if(Math.abs(b)>=1e6)return(b/1e6).toFixed(1)+' million bu';return Math.round(b/1000)+' thousand bu';}
// null used to map to 'on-track': missing export data painted a reassuring
// green bar at 0% width. Missing data gets a neutral class, never the good one.
function paceClass(pct){if(pct==null)return'no-data';return pct>=85?'on-track':pct>=70?'lagging':'behind';}
fetch('/data/export-sales.json')
  .then(function(r){if(!r.ok)throw new Error('no-exp');return r.json();})
  .then(function(data){
    var dateEl=document.getElementById('exp-date');if(dateEl){dateEl.textContent='Week ending '+fmtDate(data.report_date,'Not loaded yet')+' \u00b7 FAS';
      if(window.AgAsOf&&data.updated){var _es=AgAsOf.html(data.updated,'usda');if(_es)dateEl.insertAdjacentHTML('beforeend',' \u00b7 '+_es);}}
    var mktEl=document.getElementById('export-mkt-yr');if(mktEl&&data.marketing_year)mktEl.textContent=data.marketing_year+' marketing year';var _noPace=false,_anyNum=false;
    var map={'corn':'corn','soybeans':'bean','wheat':'wheat'};
    Object.keys(map).forEach(function(comm){
      var key=map[comm],d=data[comm];
      /* A commodity missing from the file: its row hides, not a dash. */
      var rowEl=document.getElementById('exp-'+key+'-wk');rowEl=rowEl&&rowEl.closest('.export-rows > div');
      if(!d){if(rowEl)rowEl.style.display='none';return;}
      /* EACH ROW ANSWERS FOR ITSELF. The footer prints one week for the whole
         widget, and that is the top-level `report_date` — the newest of the
         three. A commodity FAS has not published in months used to render its
         last good numbers underneath that date with nothing to say so: on
         2026-09-04 the corn row showed 121.3% of target from a week dated
         2025-09-04, a finished marketing year, labelled as the week of Aug 27
         2026. The fetcher now withholds a figure that stale and says why; this
         prints the why where the number was. */
      /* A FIGURE IS SHOWN IF IT EXISTS, AND THE REASON IS SHOWN IF THERE IS
         ONE. These are two questions, not one: on 2026-09-10 soybeans had a
         real week ending Aug 27 and no usable pace, because USDA's export
         forecast on file was still last marketing year's. Hiding the week
         along with the percentage would throw away a good number to explain a
         missing one. */
      var why=d.withheld||null;
      var EX_MY=(d.marketing_year||'');
      var wkEl=document.getElementById('exp-'+key+'-wk');
      /* No weekly figure: the "net sales this week" line hides instead of printing a dash. */
      if(wkEl){wkEl.textContent=(d.weekly_net_mt!=null)
        ?((d.weekly_net_mt<0?'\u2212':'+')+fmtBu(Math.abs(d.weekly_net_mt),comm)):'';
        if(wkEl.parentNode&&wkEl.parentNode.style)wkEl.parentNode.style.display=(d.weekly_net_mt!=null)?'':'none';}
      if(d.weekly_net_mt!=null||(!why&&d.cumulative_mt!=null)||d.pct_of_target!=null)_anyNum=true;
      var pct=d.pct_of_target,cls=(pct==null)?'no-data':paceClass(pct);if(pct==null&&!why)_noPace=true;
      var barEl=document.getElementById('exp-'+key+'-bar'),pctEl=document.getElementById('exp-'+key+'-pct');
      /* No target on file means there is no pace. Draw neither the track
         nor a dash where a percentage would go -- an empty bar reads as
         zero percent sold, which is the opposite of what is true. */
      var trackEl=barEl&&barEl.parentNode;
      if(pct==null){
        if(trackEl&&trackEl.style)trackEl.style.display='none';
        if(pctEl){pctEl.textContent='';pctEl.className='export-pace-pct '+cls;}
      }else{
        if(trackEl&&trackEl.style)trackEl.style.display='';
        if(barEl){barEl.style.width=Math.min(pct,100)+'%';barEl.className='export-pace-fill '+cls;}
        if(pctEl){pctEl.textContent=pct+'%';pctEl.className='export-pace-pct '+cls;}
      }
      var cumEl=document.getElementById('exp-'+key+'-cumul');
      if(cumEl){
        if(why||d.cumulative_mt==null){cumEl.textContent='';}
        else if(d.usda_target_mt!=null){
          cumEl.textContent=fmtBu(d.cumulative_mt,comm)+' committed of '+fmtBu(d.usda_target_mt,comm)+' USDA projection';
        }else{
          /* r7-prices: commitments, in bushels. The missing pace is said
             once, in the footer, not on every row. */
          cumEl.textContent=fmtBu(d.cumulative_mt,comm)+' committed';
        }
        /* WAVE1-C 2026-10-03: against the same week last marketing year,
           computed by fetch_export_sales.py from the prior year's own weekly
           records. Older files do not carry it: an em dash and the reason. */
        if(!why&&d.cumulative_mt!=null){
          var ly=document.createElement('span');ly.className='w1c-ly';
          if(d.vs_prev_year_pct!=null&&d.prev_year_cumulative_mt!=null){var v=d.vs_prev_year_pct;
            ly.textContent=(v>0?'+':v<0?'\u2212':'')+Math.abs(v).toFixed(1)+'% vs the same week last year ('+fmtBu(d.prev_year_cumulative_mt,comm)+')';}
          else if('prev_year_cumulative_mt' in d)ly.textContent='vs last year: n/a (last year\u2019s week is not in the FAS records)';
          /* WAVE3-L: an older file without the field shows nothing until the next run fills it. */
          if(ly.textContent)cumEl.appendChild(ly);
        }
      }
      /* WAVE1-C: wheat by class, when the FAS file splits it. */
      if(comm==='wheat'&&!why&&d.cumulative_mt!=null){
        var cr=document.getElementById('exp-wheat-cls');
        if(!cr){cr=document.createElement('div');cr.id='exp-wheat-cls';cr.className='export-withheld w1c-cls';var wr=document.getElementById('exp-wheat-why');if(wr)wr.parentNode.insertBefore(cr,wr);}
        var cl=d.classes||null,ks=cl?Object.keys(cl):[];
        cr.textContent=ks.length?'By class, committed: '+ks.map(function(k){return (cl[k].label||k.toUpperCase())+' '+fmtBu(cl[k].cumulative_mt,'wheat').replace(' million bu','M').replace(' thousand bu','k');}).join(' \u00b7 ')+' bu':'';
        cr.hidden=!ks.length;
      }
      var whyEl=document.getElementById('exp-'+key+'-why');
      if(whyEl){whyEl.textContent=why||'';whyEl.hidden=!why;}
    });
    /* 2026-10-09: no "No pace yet" chip. A pace shows on its row when USDA's
       projection is on file; otherwise there is none. No real number at all:
       the module hides, the same as a failed load. */
    if(!_anyNum)throw new Error('no-exp-numbers');
  })
  .catch(function(){var w=document.getElementById('export-widget');if(w)w.style.display='none';var _ef=w&&w.closest('details.m-fold--usda');if(_ef)_ef.style.display='none';var grid=document.getElementById('crop-export-grid-inner');if(grid)grid.style.gridTemplateColumns='1fr';var cw=document.getElementById('crop-widget');if(cw)cw.style.maxWidth='520px';});
})();
} catch (e) { blockFailed(e); }

/* ---- former inline block 6: the homepage fertilizer card, removed 2026-10-15 (index.html has no #fert-grid since 2026-10-06; prices live on /fertilizer) ---- */

/* ---- former inline block 7 ---- */
try {
(function(){
'use strict';
/* What's Moving Agriculture. scripts/fetch_markets.py owns the filter (its
   MEME_BLACKLIST + SPORTS_BLACKLIST and relevance tiers) and the ranking, and
   data/markets.json publishes only what passed. This block renders that list
   as is, so there is one filter, not a second copy here that drifts. */
var MAX_CARDS=4;
function pc(n){return n>=70?'var(--green)':n>=50?'var(--gold)':n>=30?'var(--text-dim)':'#ef4444';}
function barBg(n){var rgb=n>=70?'34,197,94':n>=50?'218,165,32':n>=30?'140,140,130':'239,68,68';return'linear-gradient(90deg,rgba('+rgb+',.9),rgba('+rgb+',.3))';}
function tLeft(iso){if(!iso)return'';try{var d=(new Date(iso).getTime()-Date.now())/86400000;if(d<0)return'';if(d<1)return'Today';if(d<2)return'Tomorrow';if(d<=30)return Math.round(d)+'d left';return'~'+Math.round(d/30)+'mo';}catch(e){return'';}}
var TIER_COLORS={1:'color:var(--green);border-color:rgba(34,197,94,.25);background:rgba(34,197,94,.06)',2:'color:var(--gold);border-color:rgba(var(--gold-rgb),.25);background:rgba(var(--gold-rgb),.06)',3:'color:var(--blue);border-color:rgba(91,163,224,.25);background:rgba(91,163,224,.06)'};
var TIER_LABELS={1:'DIRECT AG',2:'TRADE / ENERGY',3:'MACRO'};
function render(list){
  var grid=document.getElementById('kalshi-grid');
  if(!grid)return;
  var markets=(list||[]).filter(function(m){var y=m?+m.yes:NaN;return m&&m.title&&y>0&&y<100;}).slice(0,MAX_CARDS);
  if(!markets.length){grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:1rem;font-size:.824rem;color:var(--text-muted)">No farm, trade or rate markets are trading today.</div>';return;}
  grid.innerHTML='';
  markets.forEach(function(m){
    var pct=Math.round(+m.yes),tl=tLeft(m.close_time),tierLbl=TIER_LABELS[m.tier]||'MACRO',tierStyle=TIER_COLORS[m.tier]||TIER_COLORS[3];
    var kal=String(m.platform||'').toLowerCase()==='kalshi';
    var a=document.createElement('a');a.className='km-card';a.href=m.url||(kal?'https://kalshi.com':'https://polymarket.com');a.target='_blank';a.rel='noopener noreferrer';a.dataset.tier=String(m.tier||3);
    a.innerHTML='<div class="km-card-row"><div class="km-card-title">'+esc(m.title)+'</div><div class="km-card-pct" style="color:'+pc(pct)+'">'+pct+'%</div></div>'
      +'<div class="km-bar-track"><div class="km-bar-fill" style="width:'+pct+'%;background:'+barBg(pct)+'"></div></div>'
      +(m.why_it_matters?'<div class="km-why">'+esc(m.why_it_matters)+'</div>':'')
      +'<div class="km-card-foot"><span class="km-plat '+(kal?'k':'p')+'">'+(kal?'Kalshi':'Polymarket')+'</span><span class="km-tier-tag" style="'+tierStyle+'">'+tierLbl+'</span>'+(tl?'<span class="km-tl"><svg class="ic" aria-hidden="true"><use href="#i-timer"/></svg> '+esc(tl)+'</span>':'')+'</div>';
    grid.appendChild(a);
  });
}
AG.json('/data/markets.json').catch(function(){return null;}).then(function(d){
  render(d&&Array.isArray(d.markets)?d.markets:[]);
});
})();
} catch (e) { blockFailed(e); }

/* ---- former inline block 8 ---- */
try {
(function() {
  'use strict';
  var d=new Date();
  var TODAY_KEY='agsist-daily-'+d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  window.TODAY_KEY=TODAY_KEY;
  function dismissDaily(){try{localStorage.setItem(TODAY_KEY,'1');}catch(e){}var hero=document.getElementById('daily-hero');if(hero){hero.classList.add('dismissed');hero.setAttribute('aria-expanded','false');var _tz=document.getElementById('daily-teaser');if(_tz)_tz.setAttribute('aria-expanded','false');}document.documentElement.classList.add('daily-pre-dismissed');setTimeout(function(){window.scrollTo({top:0,behavior:'smooth'});var t=document.getElementById('daily-teaser');if(t&&t.focus)t.focus();},50);}
  window.dismissDaily=dismissDaily;
  function expandDaily(){try{localStorage.removeItem(TODAY_KEY);}catch(e){}var hero=document.getElementById('daily-hero');if(hero){hero.classList.remove('dismissed');hero.setAttribute('aria-expanded','true');var _tz=document.getElementById('daily-teaser');if(_tz)_tz.setAttribute('aria-expanded','true');}document.documentElement.classList.remove('daily-pre-dismissed');var h=document.getElementById('daily-headline');if(h){if(!h.hasAttribute('tabindex'))h.setAttribute('tabindex','-1');try{h.focus({preventScroll:true});}catch(e){h.focus();}}}
  window.expandDaily=expandDaily;
  try{if(localStorage.getItem(TODAY_KEY)==='1'){var hero=document.getElementById('daily-hero');if(hero)hero.classList.add('dismissed');}}catch(e){}
  window.addEventListener('resize',function(){var single=document.getElementById('ticker-items-single'),track=document.getElementById('ticker-track');if(!single||!track)return;var w=single.scrollWidth||single.offsetWidth;if(w<200)return;/* one speed: the same 20 px/s geo.js rebuildTickerLoop() uses */track.style.animationDuration=Math.max(20,Math.round(w/20))+'s';});
  (function(){
    var img=document.getElementById('drought-img'),fallback=document.getElementById('drought-fallback');if(!img)return;
    // USDM image is mirrored to /data/outlooks/ by scripts/fetch_outlooks.py.
    // Upstream fallback is kept for the rare case the mirror file is missing.
    var urls=['/data/outlooks/usdm_latest.png','https://droughtmonitor.unl.edu/data/png/current/current_usdm.png'];
    var attempt=0;function tryNext(){if(attempt>=urls.length){img.style.display='none';if(fallback)fallback.style.display='flex';return;}img.src=urls[attempt++];}
    img.addEventListener('error',tryNext);img.addEventListener('load',function(){if(fallback)fallback.style.display='none';});
    if('IntersectionObserver' in window){
      var _dio=new IntersectionObserver(function(e){if(e[0].isIntersecting){tryNext();_dio.disconnect();}},{rootMargin:'400px'});
      _dio.observe(img);
    } else { tryNext(); }
  })();
  var teaser=document.getElementById('daily-teaser');
  if(teaser){teaser.addEventListener('click',expandDaily);teaser.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();expandDaily();}});}
  var btnDismiss=document.getElementById('btn-dismiss-daily');if(btnDismiss)btnDismiss.addEventListener('click',dismissDaily);
  var bidsEnterZip=document.getElementById('bids-enter-zip-btn');
  /* 2026-10-11 polish: one ZIP box, in the hero band. These buttons open it;
     the old in-card rows stay only as a fallback if the band is missing. */
  function openHeroZip(){if(typeof window.agsistOpenZip==='function'){window.agsistOpenZip();return true;}return false;}
  if(bidsEnterZip){bidsEnterZip.addEventListener('click',function(){if(openHeroZip())return;var gb=document.getElementById('bids-geo-bar'),zr=document.getElementById('bids-zip-row');if(gb)gb.style.display='none';if(zr){zr.style.display='block';}});}
  var bidsLookup=document.getElementById('bids-lookup-btn');if(bidsLookup)bidsLookup.addEventListener('click',function(){if(typeof lookupBids==='function')lookupBids();});
  var bidsZip=document.getElementById('bids-zip');if(bidsZip)bidsZip.addEventListener('keydown',function(e){if(e.key==='Enter'&&typeof lookupBids==='function')lookupBids();});
  var btnAllowLoc=document.getElementById('btn-allow-loc');if(btnAllowLoc)btnAllowLoc.addEventListener('click',function(){if(typeof requestGeo==='function')requestGeo();});
  var btnZipInstead=document.getElementById('btn-zip-instead');if(btnZipInstead)btnZipInstead.addEventListener('click',function(){if(openHeroZip())return;if(typeof showZipEntry==='function')showZipEntry();});
  /* 2026-10-01: these two used to call loadWeatherZip() directly, which only
     ever updated the weather pane -- a ZIP typed here never reached Cash
     Bids, even though window.agsistSetZip (geo.js) already exists specifically
     to keep every ZIP box on the page in sync and was already used by the
     Cash Bids -> weather direction (bids-homepage.js's lookupBids()). This
     was a one-way sync, not a missing feature. Routing through the same
     real entry point both ways closes it, and a direct lookupBids() call
     (guarded, real, already wired) forces the bids card to actually reload
     with the synced ZIP rather than only updating the visible field. */
  function wxZipSubmit(){
    var el=document.getElementById('wx-zip');
    var zip=el?el.value.trim():'';
    if(zip.length===5&&!isNaN(zip)&&typeof window.agsistSetZip==='function'){
      window.agsistSetZip(zip);
      if(typeof window.lookupBids==='function')window.lookupBids();
    }else if(typeof loadWeatherZip==='function'){
      loadWeatherZip();
    }
  }
  var btnWxGo=document.getElementById('btn-wx-go');if(btnWxGo)btnWxGo.addEventListener('click',wxZipSubmit);
  var wxZip=document.getElementById('wx-zip');if(wxZip)wxZip.addEventListener('keydown',function(e){if(e.key==='Enter')wxZipSubmit();});
  var btnChangeLoc=document.getElementById('btn-change-loc');if(btnChangeLoc)btnChangeLoc.addEventListener('click',function(){if(openHeroZip())return;if(typeof showZipEntry==='function')showZipEntry();});
  var tabEmail=document.getElementById('tab-email');
  var formEmail=document.getElementById('form-email');
  if(tabEmail){tabEmail.addEventListener('click',function(){tabEmail.classList.add('active');if(formEmail)formEmail.style.display='flex';});}
  (function(){
    /* Every .fade-up section is opacity:0 in the stylesheet, so if this does
       not run the page is BLANK below the ticker with no console error. Belts:
         - threshold 0 (0.08 is unreachable for a section taller than ~12
           screens, since ratio = visible / total, and it gets worse the
           shorter the window)
         - reveal on load
         - an unconditional timer, so a broken observer cannot hide the page */
    var els = document.querySelectorAll('.fade-up');
    function showAll(){ for (var i=0;i<els.length;i++) els[i].classList.add('vis'); }
    if (!('IntersectionObserver' in window)) { showAll(); return; }
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (e.isIntersecting) { e.target.classList.add('vis'); io.unobserve(e.target); }
      });
    }, { threshold: 0, rootMargin: '200px 0px' });
    for (var i=0;i<els.length;i++) io.observe(els[i]);
    setTimeout(showAll, 1200);
    window.addEventListener('load', showAll);
  })();
  function buildUSDACalendar(){
    var strip=document.getElementById('usda-cal-strip');if(!strip)return;
    /* r7-bids 2026-10-01: rebuilt.
       - An event whose release time has passed is gone, compared as a real
         instant (the ET wall time converted with the browser's own zone
         rules), not "today's date".
       - Monthly reports come from /usda-calendar.ics, the calendar file the
         site already publishes. No report date is typed in here. Non-USDA
         rows in that file (CONAB, StatCan) are left out: this is the USDA list.
       - The next WASDE is always on the strip, even when weekly rows would
         push it past the tenth card.
       - A weekly release whose day is a federal holiday (fixed by law: the
         2nd Monday of October and so on) moves to the next business day and
         says it moved: Crop Progress comes out Tuesday after a Monday
         holiday. 2026-10-11: this used to keep the Monday with "date may
         shift" while /usda-calendar said Tuesday. One rule now, the one in
         scripts/usda_dates.py; test/usda-holidays.test.mjs runs these
         functions against /usda-calendar's holiday list.
       - Crop Progress runs from the first Monday of April to the last Monday
         NASS lists (2026: Nov 30), as on /usda-calendar.
       - 2026-10-16: the .ics is built from /usda-calendar's own report list
         (scripts/build_usda_ics.mjs), so livestock and dairy reports show
         here too. */
    function etParts(d){var s=d.toLocaleString('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
      var m=/(\d+)\/(\d+)\/(\d+),?\s+(\d+):(\d+)/.exec(s);return m?{y:+m[3],mo:+m[1],d:+m[2],h:(+m[4])%24,mi:+m[5]}:null;}
    function etToUtc(y,mo,d,h,mi){var g=Date.UTC(y,mo-1,d,h,mi),p=etParts(new Date(g));if(!p)return new Date(g);return new Date(g-(Date.UTC(p.y,p.mo-1,p.d,p.h,p.mi)-g));}
    function nth(y,mo,wd,n){var d=new Date(Date.UTC(y,mo-1,1));var off=(wd-d.getUTCDay()+7)%7;return 1+off+(n-1)*7;}
    function lastMon(y,mo){var d=new Date(Date.UTC(y,mo,0));return d.getUTCDate()-((d.getUTCDay()-1+7)%7);}
    function iso(y,mo,d){return y+'-'+('0'+mo).slice(-2)+'-'+('0'+d).slice(-2);}
    function observed(y,mo,d){var w=new Date(Date.UTC(y,mo-1,d)).getUTCDay(),t=new Date(Date.UTC(y,mo-1,d+(w===6?-1:w===0?1:0)));return iso(t.getUTCFullYear(),t.getUTCMonth()+1,t.getUTCDate());}
    function holidays(y){return [observed(y,1,1),iso(y,1,nth(y,1,1,3)),iso(y,2,nth(y,2,1,3)),iso(y,5,lastMon(y,5)),observed(y,6,19),observed(y,7,4),iso(y,9,nth(y,9,1,1)),iso(y,10,nth(y,10,1,2)),observed(y,11,11),iso(y,11,nth(y,11,4,4)),observed(y,12,25)];}
    var now=new Date(),nowEt=etParts(now)||{y:now.getFullYear(),mo:now.getMonth()+1,d:now.getDate()};
    var todayIso=iso(nowEt.y,nowEt.mo,nowEt.d),HOL={};
    [nowEt.y,nowEt.y+1].forEach(function(y){holidays(y).forEach(function(h){HOL[h]=1;});});
    var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function clock(h,mi){return ((h%12)||12)+':'+('0'+mi).slice(-2)+' '+(h<12?'AM':'PM')+' ET';}
    function nextBiz(di){var p=di.split('-'),d=new Date(Date.UTC(+p[0],+p[1]-1,+p[2]));do{d.setUTCDate(d.getUTCDate()+1);}while(d.getUTCDay()===0||d.getUTCDay()===6||HOL[iso(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate())]);return iso(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate());}
    /* The season's last Monday where NASS's calendar for the year lists it
       (2026: Nov 30, the Monday after Thanksgiving), else the Monday of
       Thanksgiving week. Same table as scripts/usda_dates.py CROP_PROGRESS_LAST. */
    var CP_LAST={2026:'2026-11-30'};
    function cpSeason(di){var y=+di.slice(0,4);return di>=iso(y,4,nth(y,4,1,1))&&di<=(CP_LAST[y]||iso(y,11,nth(y,11,4,4)-3));}
    var weekly=[{name:'Export Sales',wd:4,h:8,mi:30},{name:'Export Inspections',wd:1,h:11,mi:0},{name:'Crop Progress',wd:1,h:16,mi:0,season:cpSeason}];
    var events=[];
    for(var i=-4;i<28;i++){
      var dd=new Date(Date.UTC(nowEt.y,nowEt.mo-1,nowEt.d+i)),wd=dd.getUTCDay(),di=iso(dd.getUTCFullYear(),dd.getUTCMonth()+1,dd.getUTCDate());
      /* a federal holiday Mon to Wed of this week (Columbus Day, Veterans Day on a Wednesday): FAS often
         puts Export Sales out Friday, so its card says Thu or Fri, the same words as the Daily (Oct 19) */
      var mon=new Date(dd.getTime()-((wd+6)%7)*864e5),holWk=false;
      for(var k=0;k<3;k++){var hk=new Date(mon.getTime()+k*864e5);if(HOL[iso(hk.getUTCFullYear(),hk.getUTCMonth()+1,hk.getUTCDate())])holWk=true;}
      weekly.forEach(function(r){if(r.wd!==wd)return;if(r.season&&!r.season(di))return;
        var hol=!!HOL[di],rd=hol?nextBiz(di):di,p=rd.split('-'),y=+p[0],mo=+p[1],da=+p[2],at=etToUtc(y,mo,da,r.h,r.mi);
        if(at<=now)return;
        events.push({name:r.name,day:rd,mo:mo,da:da,at:at,moved:hol?di:null,time:clock(r.h,r.mi)+(hol?' · moved from '+['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][wd]+' '+months[dd.getUTCMonth()]+' '+dd.getUTCDate()+', holiday':holWk&&r.name==='Export Sales'?' · Thu or Fri, holiday week':holWk?' · may shift':'')});});
    }
    function render(list,note){
      list.sort(function(a,b){return a.at-b.at;});
      var seen={},u=[];list.forEach(function(e){var k=e.name+'|'+e.day;if(!seen[k]){seen[k]=1;u.push(e);}});
      var shown=u.slice(0,10),w=null;
      for(var j=0;j<u.length;j++){if(u[j].name==='WASDE'){w=u[j];break;}}
      if(w&&shown.indexOf(w)<0){shown[shown.length-1]=w;}
      strip.innerHTML='';
      shown.forEach(function(ev){var card=document.createElement('div'),isToday=ev.day===todayIso,dateStr=months[ev.mo-1]+' '+ev.da;
        card.className='cal-card'+(isToday?' today':'');card.setAttribute('role','listitem');
        card.innerHTML=(isToday?'<div class="cal-today-badge">Today</div>':'<div class="cal-date">'+dateStr+'</div>')+'<div class="cal-name">'+ev.name+'</div><div class="cal-time">'+ev.time+(isToday?' · '+dateStr:'')+'</div>';
        strip.appendChild(card);});
      /* 7b: one line for a federal holiday inside the strip's dates. The
         repo's calendar flags only the holiday's own releases, so the rest
         of that week is described, not moved. */
      var last=shown.length?shown[shown.length-1].day:todayIso,hd=Object.keys(HOL).sort().filter(function(h){return h>=todayIso&&h<=last;})[0];
      var hn=document.getElementById('r7-cal-hol'),host=strip.parentNode;
      /* wave1-E: a card moved off the holiday already says so; one note, not two. */
      if(hd&&shown.some(function(ev){return ev.day===hd||ev.moved===hd;}))hd=null;
      if(hd){if(!hn){hn=document.createElement('p');hn.id='r7-cal-hol';host.parentNode.insertBefore(hn,host.nextSibling);}
        var hp=hd.split('-');hn.textContent='Federal holiday '+months[+hp[1]-1]+' '+(+hp[2])+': a USDA release due that day comes out the next business day.';}
      else if(hn){hn.parentNode.removeChild(hn);}
      if(note){var n=document.createElement('div');n.className='cal-card';n.setAttribute('role','listitem');n.innerHTML='<div class="cal-name">'+note+'</div><div class="cal-time"><a href="/usda-calendar">Full calendar</a></div>';strip.appendChild(n);}
    }
    render(events.slice(),'');
    fetch('/usda-calendar.ics',{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error(r.status);return r.text();}).then(function(t){
      var out=events.slice();
      t.replace(/\r/g,'').split('BEGIN:VEVENT').slice(1).forEach(function(b){
        var s=/\nSUMMARY:([^\n]*)/.exec(b),d=/\nDTSTART:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}Z/.exec(b);
        if(!s||!d)return;var name=s[1].trim();
        if(/CONAB|StatCan|Brazil|Canada/i.test(name))return;
        var at=new Date(Date.UTC(+d[1],+d[2]-1,+d[3],+d[4],+d[5]));if(at<=now)return;
        var p=etParts(at);if(!p)return;
        out.push({name:name.replace(/\s+Report$/,''),day:iso(p.y,p.mo,p.d),mo:p.mo,da:p.d,at:at,time:clock(p.h,p.mi)});
      });
      render(out,'');
    }).catch(function(){render(events.slice(),'Monthly report dates not loaded yet');});
  }
  buildUSDACalendar();
  (function(){
    var _wf=document.getElementById('windy-frame');
    if(!_wf||!_wf.dataset.src)return;
    if('IntersectionObserver' in window){
      var _wio=new IntersectionObserver(function(e){
        if(e[0].isIntersecting){_wf.src=_wf.dataset.src;_wio.disconnect();}
      },{rootMargin:'200px'});
      _wio.observe(_wf);
    } else { _wf.src=_wf.dataset.src; }
  })();
  /* 2026-10-06 EARN: the radar is its own card. On wide desktop it sits in
     the left column under cash bids; its height makes the left column end
     level with Local conditions when that fits in 340-720px. It reads only
     the two neighbours' own heights, so it never feeds back on itself. */
  (function(){
    var fold=document.getElementById('radar-fold'), card=fold&&fold.querySelector('.radar-card'),
        f1=document.getElementById('f1'), f2=document.getElementById('f2');
    if(!card||!f1||!f2||!window.matchMedia) return;
    var wide=window.matchMedia('(min-width:1240px)');
    function size(){
      if(!wide.matches||!fold.open){ card.style.height=''; return; }
      var r1=f1.getBoundingClientRect(), r2=f2.getBoundingClientRect();
      if(Math.abs(r1.top-r2.top)>40||r2.left<r1.right-4){ card.style.height=''; return; }
      var gap=parseFloat(getComputedStyle(f1).marginBottom)||0;
      var chrome=fold.getBoundingClientRect().height-card.getBoundingClientRect().height;
      var h=Math.round(r2.height-r1.height-gap-chrome);
      card.style.height=Math.max(340,Math.min(h,720))+'px';
    }
    var t; function soon(){clearTimeout(t);t=setTimeout(size,100);}
    size();
    if(wide.addEventListener) wide.addEventListener('change',soon); else if(wide.addListener) wide.addListener(soon);
    window.addEventListener('resize',soon);
    fold.addEventListener('toggle',soon);
    if('ResizeObserver' in window){ var ro=new ResizeObserver(soon); ro.observe(f1); ro.observe(f2); }
  })();
  function isSignedUp(){try{return document.cookie.split(';').some(function(c){return c.trim().startsWith('agsist_subscribed=');})||localStorage.getItem('agsist_subscribed')==='1';}catch(e){return false;}}
  function setSignedUp(){try{var exp=new Date();exp.setFullYear(exp.getFullYear()+2);document.cookie='agsist_subscribed=1;expires='+exp.toUTCString()+';path=/;SameSite=Lax';localStorage.setItem('agsist_subscribed','1');}catch(e){}}
  // 2026-09-30: exposed so components/bids-homepage.js can skip the post-lookup
  // signup CTA for a reader who already subscribed.
  window.isSignedUp=isSignedUp;
  // 2026-09-30: dismissal used to be permanent ('1', forever) and the compact
  // ask is the only one gated purely on that flag with no visit ceiling — so
  // one "No thanks" opted a visitor out of ever seeing it again, and anyone
  // between visit 25 and 49 who'd dismissed it saw no signup ask at all
  // (full hides after visit 24, slim doesn't start until visit 50). Storing a
  // timestamp and expiring it after 35 days closes both: the ask returns on
  // its own, and a legacy '1' value (not a valid recent timestamp) reads as
  // already-expired so existing dismissals don't grandfather in forever.
  var DISMISS_DAYS=35;
  function isDismissed(key){try{var v=parseInt(localStorage.getItem(key),10);if(!v)return false;return (Date.now()-v)<DISMISS_DAYS*24*60*60*1000;}catch(e){return false;}}
  function setDismissed(key){try{localStorage.setItem(key,String(Date.now()));}catch(e){}}
  (function(){
    /* 2026-10-06: a visit is a browser session, not a page load. The same
       gate is in components/signup-ask.js (which loads earlier, under the
       hero, and usually counts first); whichever runs first counts it. */
    try{if(!sessionStorage.getItem('agsist_visit_counted')){sessionStorage.setItem('agsist_visit_counted','1');var n=parseInt(localStorage.getItem('agsist_visits')||'0',10)+1;localStorage.setItem('agsist_visits',String(n));}}catch(e){}
    if(isSignedUp())return;
    /* Oct 18 (re-score 8): one email ask on the homepage, not three. The
       hero line under the bids is the ask and the site footer carries the
       daily band; the compact bar opens only from the bids card link
       (bids-homepage.js) and the big band only for /#signup links. */
    var toSignup=/^#signup(-full)?$/.test(location.hash);
    if(toSignup){var el=document.getElementById('signup-full');if(el){el.style.display='block';if(toSignup)setTimeout(function(){try{el.scrollIntoView({block:'start'});}catch(e){}},0);}}
  })();
  var btnCompactDismiss=document.getElementById('btn-compact-dismiss');if(btnCompactDismiss)btnCompactDismiss.addEventListener('click',function(){setDismissed('agsist_signup_compact_dismissed');var el=document.getElementById('signup-compact');if(el)el.style.display='none';var m=document.getElementById('main');if(m&&m.focus){try{m.focus({preventScroll:true});}catch(e){}}});
  function showSignupSuccess(formId,icon,headline,sub){var formEl=document.getElementById(formId);if(!formEl)return;formEl.innerHTML='<div style="text-align:center;padding:.9rem 0"><div style="font-size:1.882rem;margin-bottom:.4rem">'+icon+'</div><div style="font-size:1rem;font-weight:700;color:var(--text);margin-bottom:.25rem">'+headline+'</div><div style="font-size:.824rem;color:var(--text-muted);line-height:1.5">'+sub+'</div></div>';formEl.style.display='block';}
  /* 2026-10-06: both homepage signups post through components/signup-ask.js
     (source "signup-band", the saved ZIP, reports:true). Success needs HTTP
     ok AND data.ok === true; anything else shows a plain error. */
  function bandSignup(box,email,onOk,onFail){
    var S=window.AgsistSignup;
    if(!S){onFail('That did not go through. Reload the page and try again.');return;}
    if(box)box.setAttribute('data-sa-busy','1');
    S.subscribe({email:email,source:'signup-band'}).then(function(res){
      if(box)box.removeAttribute('data-sa-busy');
      if(res.ok){if(box)box.setAttribute('data-sa-done','1');onOk(S.okText());}
      else onFail(S.errText(res));
    });
  }
  var EMAIL_OK=/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var btnEmailSignup=document.getElementById('btn-email-signup');
  if(btnEmailSignup){btnEmailSignup.addEventListener('click',function(e){e.preventDefault();var inp=document.querySelector('#form-email input[type="email"]');var email=((inp||{}).value||'').trim();
    var dsc=document.querySelector('#form-email .signup-disc');
    if(!EMAIL_OK.test(email)){if(dsc)dsc.innerHTML='<span style="color:var(--red)">Enter a real email address.</span>';if(inp)inp.focus();return;}
    var _b=this,_t=_b.textContent;_b.disabled=true;_b.textContent='Sending…';
    bandSignup(document.getElementById('signup-full'),email,function(txt){
        showSignupSuccess('form-email','<svg class="ic" aria-hidden="true"><use href="#i-circle-check"/></svg>',txt,'AGSIST Daily, free, every morning. Check your spam folder once.');
        var tabs=document.querySelector('#signup-full .signup-tabs');if(tabs)tabs.style.display='none';},
      function(msg){_b.disabled=false;_b.textContent=_t;
        if(dsc){dsc.textContent='';var w=document.createElement('span');w.setAttribute('role','status');w.style.color='var(--red)';w.textContent=msg;dsc.appendChild(w);}});});}
  var btnCompactSignup=document.getElementById('btn-compact-signup'),compactEmail=document.getElementById('compact-email');
  if(btnCompactSignup){btnCompactSignup.addEventListener('click',function(e){e.preventDefault();var email=compactEmail?compactEmail.value.trim():'';
    var bar=document.getElementById('signup-compact');
    function warn(msg){if(!bar)return;var w=bar.querySelector('.sc-warn');if(!w){w=document.createElement('span');w.className='sc-warn';w.setAttribute('role','status');w.style.cssText='font-size:.875rem;color:var(--red);display:block;margin-top:.3rem';bar.appendChild(w);}w.textContent=msg;}
    if(!EMAIL_OK.test(email)){warn('Enter a real email address.');if(compactEmail)compactEmail.focus();return;}
    var _cb=this;_cb.disabled=true;
    bandSignup(bar,email,function(txt){
        if(bar){bar.innerHTML='<span class="sc-ok" tabindex="-1" style="font-size:.875rem;font-weight:700;color:var(--green);padding:.1rem 0"><svg class="ic" aria-hidden="true"><use href="#i-circle-check"/></svg> </span>';bar.querySelector('.sc-ok').appendChild(document.createTextNode(txt));}},
      function(msg){_cb.disabled=false;warn(msg);});});}
  if(compactEmail)compactEmail.addEventListener('keydown',function(e){if(e.key==='Enter'&&btnCompactSignup)btnCompactSignup.click();});
})();
} catch (e) { blockFailed(e); }

/* ---- former inline block 9 ---- */
try {
/* hydrateDaily v4.0 — canonical field names + v4.0 blocks (yesterdays_call, spread_to_watch,
   weekly_thread, basis). Renders thread marker, YC block with outcome pill, spread, basis,
   and byline. v3.5 compat: flexible 2–5 section support, legacy field-name fallback. */
window.hydrateDaily = function(data) {
  'use strict';
  if(!data||!data.headline) return;
  
  function setText(id,v){var e=el(id);if(e&&v!=null)e.textContent=v;}
  function setHTML(id,v){var e=el(id);if(e&&v!=null)e.innerHTML=v;}
  function pick(){for(var i=0;i<arguments.length;i++){if(arguments[i]!=null)return arguments[i];}return null;}
  // v4.4: local HTML-escape helper (used by outside_the_pit hydration which
  // builds innerHTML manually — kept scoped to this function to avoid global pollution)
  function escHtml(s){return(s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  // v4.4.2: mdInline — escape + promote legacy <strong>/<em> tags
  // (model-emitted HTML in JSON body fields) and **markdown** asterisks.
  function mdInline(s){
    if(s==null)return'';
    var t=String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    t=t.replace(/&lt;strong&gt;([\s\S]+?)&lt;\/strong&gt;/g,'<strong>$1</strong>');
    t=t.replace(/&lt;em&gt;([\s\S]+?)&lt;\/em&gt;/g,'<em>$1</em>');
    t=t.replace(/\*\*([^*]+?)\*\*/g,'<strong>$1</strong>');
    return t;
  }

  var headline=data.headline||'',subheadline=data.subheadline||'',lead=data.lead||'';
  var dateStr=data.date||'';
  // v4.4.2: clean render block. headline/subheadline are plain text
  // (no bold expected, matches daily.html). lead uses mdInline so model
  // can emit **bold** or <strong> safely without XSS surface (was raw
  // innerHTML — that bypassed escaping entirely).
  var dh=el('daily-headline');if(dh)dh.textContent=headline;
  // v5.1: subheadline is retired; the <p> stays for issues that carry one and hides otherwise
  var dsh=el('daily-subheadline');if(dsh){dsh.textContent=subheadline;dsh.style.display=subheadline?'':'none';}
  var dl=el('daily-lead');if(dl)dl.innerHTML=mdInline(lead);

  // v5.1: the one thresholded action, in the block the takeaway used to hold.
  // A daily.json from before the cut has no action and shows its takeaway
  // under the old label instead, so the block never goes blank on upload day.
  /* 2026-10-09, Sig: the prediction bot is out of the Daily for now; it
     lives on /scorecard. An issue whose action is the bot's call (bot_call
     present) shows no action, and the box hides. */
  var takeaway=(data.bot_call?'':(data.action||'')).trim();
  var taLabel=takeaway?'THE ACTION':'THE TAKEAWAY';
  if(!takeaway)takeaway=(data.the_takeaway||'').trim();
  var taEl=el('daily-takeaway');
  var taText=el('daily-takeaway-text');
  var taLbl=taEl&&taEl.querySelector('.daily-takeaway-label');
  if(taLbl)taLbl.innerHTML='<svg class="ic" aria-hidden="true"><use href="#i-target"/></svg> '+taLabel;
  if(taEl){if(takeaway){if(taText)taText.innerHTML=mdInline(takeaway);taEl.style.display='block';}else{taEl.style.display='none';}}
  window.AGSIST_DAILY=data;
  if(typeof window.agsistFrameAction==='function')window.agsistFrameAction();

  // v4.3: Copy The Number button — copies "VALUE UNIT" to clipboard
  var dnCopyBtn=el('daily-number-copy');
  if(dnCopyBtn && !dnCopyBtn._wired){
    dnCopyBtn._wired=true;
    dnCopyBtn.addEventListener('click',function(){
      var v=(el('daily-number-value')||{}).textContent||'';
      var u=(el('daily-number-unit')||{}).textContent||'';
      var txt=(v+(u?' '+u:'')).trim();
      if(!txt||txt==='-')return;
      var done=function(){var orig=dnCopyBtn.innerHTML;dnCopyBtn.innerHTML='<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>';setTimeout(function(){dnCopyBtn.innerHTML=orig;},1500);};
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(done).catch(function(){prompt('Copy:',txt);});}
      else{var ta=document.createElement('textarea');ta.value=txt;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');done();}catch(e){prompt('Copy:',txt);}document.body.removeChild(ta);}
    });
  }

  // THE GREETING IS THE READER'S CLOCK; THE BRIEFING IS NOT.
  // At 6pm this said "Good Evening" directly above a briefing written before
  // the open, and the line under it said only "Snapshot at briefing publish"
  // -- true, and silent about WHEN. A reader arriving in the evening had no
  // way to tell whether the prices were an hour old or twelve.
  //
  // The greeting stays as a greeting. The publish time goes where it belongs,
  // in the snapshot note, straight from the issue's own generated_at.
  var now=new Date();
  var h=now.getHours();
  var greeting=h<12?'Good Morning':h<17?'Good Afternoon':'Good Evening';
  setText('site-greeting',greeting);
  (function(){
    var el=document.getElementById('daily-published');
    if(!el) return;
    var g=data&&data.generated_at;
    if(!g) return;
    var d=new Date(g);
    if(isNaN(d.getTime())) return;
    var t;
    try{
      t=d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',
                                      timeZone:'America/Chicago'});
    }catch(e){ return; }
    if(window.AgAsOf){var _ds=AgAsOf.html(g,'daily');if(_ds){el.innerHTML=_ds+' \u00b7 prices are that snapshot';return;}}
    var sameDay=d.toDateString()===now.toDateString();
    el.textContent='Published '+t+' CT'+(sameDay?'':' on '+
      d.toLocaleDateString('en-US',{month:'short',day:'numeric',
                                    timeZone:'America/Chicago'}))+
      ' \u00b7 prices are that snapshot';
  })();

  if(dateStr){
    try{
      var d=/^\d{4}-\d{2}-\d{2}$/.test(dateStr)?new Date(dateStr+'T12:00:00'):new Date(dateStr);
      var dOk=d&&!isNaN(d.getTime());
      var days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      var months=['January','February','March','April','May','June','July','August','September','October','November','December'];
      var ds=dOk?days[d.getDay()]+', '+months[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear():dateStr;
      setText('daily-date',ds);
      /* chaos-8 (2026-10-17): an old issue is not "today's briefing". Not
         today (Central): the action says "latest". Over 2 days old: the badge
         says "latest issue" with the full date. */
      var tz='',age=0;
      try{tz=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(now);}catch(e2){tz='';}
      var dIso=dOk?d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2):'';
      if(tz&&dIso)age=Math.round((Date.parse(tz+'T12:00:00Z')-Date.parse(dIso+'T12:00:00Z'))/864e5);
      var tdd='AGSIST Daily, '+(dOk?months[d.getMonth()]+' '+d.getDate():dateStr);
      if(age>2&&dOk)tdd='Latest issue: '+months[d.getMonth()].slice(0,3)+' '+d.getDate()+', '+d.getFullYear();
      setHTML('daily-teaser-date','<svg class="ic" aria-hidden="true"><use href="#i-newspaper"/></svg> '+tdd);
      var tAct=document.querySelector('#daily-teaser .teaser-action')||document.querySelector('.teaser-action');
      if(tAct&&age>=1)tAct.textContent=(age>2?'Read it':'Read the latest briefing')+' \u2193';
    }catch(e){}
  }
  if(data.teaser){setText('daily-teaser-text',data.teaser);window.__s7daily=data;if(window.S7)window.S7.teaser(data);}

  // v4.3: weekend-aware watch list label
  var watchLblEl=el('daily-watch-label-text');
  if(watchLblEl){watchLblEl.textContent=data.market_closed?"THIS WEEK’S WATCH LIST":"TODAY’S WATCH LIST";}

  // v4.3: cash-bids conversion footer — visible on weekdays only
  var cbEl=el('daily-cashbids-cta');
  if(cbEl){cbEl.style.display=data.market_closed?'none':'flex';}

  // v4.4: outside_the_pit — full-width news block (always populated, weekday and weekend)
  var otpEl=el('daily-otp');
  var otpGrid=el('daily-otp-grid');
  var otpLabelText=el('daily-otp-label-text');
  var otpSubText=el('daily-otp-sub-text');
  var otpItems=Array.isArray(data.outside_the_pit)?data.outside_the_pit:[];
  if(otpEl&&otpGrid){
    var otpHtml='';
    for(var oi=0;oi<otpItems.length;oi++){
      var it=otpItems[oi]||{};
      var oTitle=(it.title||'').trim();
      var oBody=(it.body||'').trim();
      var oTag=(it.tag||'').trim().toUpperCase();
      if(!oTitle&&!oBody)continue;
      var oTagH=oTag?'<span class="daily-otp-tag">'+escHtml(oTag)+'</span>':'';
      var oTitleH=oTitle?'<div class="daily-otp-title">'+escHtml(oTitle)+'</div>':'';
      var oBodyH=oBody?'<div class="daily-otp-body">'+mdInline(oBody)+'</div>':'';
      otpHtml+='<div class="daily-otp-item">'+oTagH+oTitleH+oBodyH+'</div>';
    }
    if(otpHtml){
      otpGrid.innerHTML=otpHtml;
      /* otp_week_ahead, not market_closed: the generator sets it only when the
         item names a dated upcoming event (generate_daily.mark_week_ahead). */
      if(otpLabelText)otpLabelText.textContent=data.otp_week_ahead?'WEEK AHEAD IN AG':'OUTSIDE THE PIT';
      if(otpSubText)otpSubText.textContent=data.otp_week_ahead?'Coming up next week.':'Not moving prices today, but worth knowing.';
      otpEl.classList.add('is-active');
    } else {
      otpEl.classList.remove('is-active');
    }
  }

  // Flexible section rendering — hide unused section divs for 2–5 section support
  var sections=data.sections||[];
  for(var si=1;si<=4;si++){
    var secEl=el('daily-sec-'+si);
    if(!secEl)continue;
    if(si<=sections.length){
      secEl.style.display='';
      var sec=sections[si-1];
      setText('daily-section-'+si+'-title',sec.title||'');
      /* '- ' bullet lines draw as the same list bake_homepage.py bakes (md_body),
         not as one run-on line of dashes. Paragraph bodies are unchanged. */
      setHTML('daily-section-'+si+'-body',(function(b){var ls=String(b||'').split('\n').map(function(x){return x.trim();}).filter(Boolean),bl=ls.filter(function(x){return x.indexOf('- ')===0;});
        if(!bl.length)return mdInline(b||'');
        return '<ul style="list-style:none;margin:0;padding:0">'+bl.map(function(x){return '<li style="position:relative;padding-left:1rem;margin:0 0 .35rem"><span style="position:absolute;left:0;top:.55em;width:.36rem;height:.36rem;border-radius:2px;background:rgba(218,165,32,.55)"></span>'+mdInline(x.slice(2))+'</li>';}).join('')+'</ul>'+
          ls.filter(function(x){return x.indexOf('- ')!==0;}).map(function(x){return '<div style="margin-top:.4rem;font-style:italic">'+mdInline(x)+'</div>';}).join('');})(sec.body));
      // bottom_line + farmer_action default to display:none in CSS — must flip when populated
      // v5.1: so_what is the field; bottom_line is read for issues before the cut
      var soWhat=sec.so_what||sec.bottom_line||'';
      var blEl=el('daily-section-'+si+'-bottomline');
      if(blEl){if(soWhat){blEl.textContent=soWhat;blEl.style.display='block';}else{blEl.style.display='none';}}
      var acEl=el('daily-section-'+si+'-action');
      var acTxt=pick(sec.farmer_action,sec.action);
      if(acEl){if(acTxt){acEl.textContent=acTxt;acEl.style.display='block';}else{acEl.style.display='none';}}
      /* section icons are fixed Lucide in the seed HTML; ignore any emoji in data */
      // v4.3: per-section vs_yesterday continuity marker
      var vsEl=el('daily-section-'+si+'-vs');
      var vsTxtEl=el('daily-section-'+si+'-vs-text');
      var vsTxt=(sec.vs_yesterday||'').trim();
      if(vsEl){if(vsTxt&&!data.market_closed){if(vsTxtEl)vsTxtEl.textContent=vsTxt;vsEl.style.display='flex';}else{vsEl.style.display='none';}}
      // v4.4: per-section catalyst (driver) marker — names the news/data driving the move
      var catEl=el('daily-section-'+si+'-catalyst');
      var catTxtEl=el('daily-section-'+si+'-catalyst-text');
      var catTxt=(sec.catalyst||'').trim();
      if(catEl){if(catTxt&&!data.market_closed){if(catTxtEl)catTxtEl.textContent=catTxt;catEl.style.display='flex';}else{catEl.style.display='none';}}
      var conv=el('daily-section-'+si+'-conviction');
      if(conv){
        var clv=sec.conviction_level;
        if(clv){
          var clsA=clv==='high'?'conviction--bull':clv==='low'?'conviction--bear':'conviction--mixed';
          var lblA=clv==='high'?'\u25b2 High':clv==='low'?'\u25bc Low':'\u2194 Medium';
          conv.className='daily-sec-conviction '+clsA;conv.textContent=lblA;conv.style.display='inline-flex';
        } else if(sec.conviction){
          var clsB=sec.conviction==='bullish'?'conviction--bull':sec.conviction==='bearish'?'conviction--bear':'conviction--mixed';
          var lblB=sec.conviction==='bullish'?'\u25b2 Bullish':sec.conviction==='bearish'?'\u25bc Bearish':'\u2194 Mixed';
          conv.className='daily-sec-conviction '+clsB;conv.textContent=lblB;conv.style.display='inline-flex';
        }
      }
    } else {
      secEl.style.display='none';
    }
  }

  // TMYK — canonical: the_more_you_know, legacy: tmyk
  var tmyk=pick(data.the_more_you_know,data.tmyk);
  var tmykWrap=el('daily-tmyk-wrap');
  if(tmyk&&(tmyk.title||tmyk.body)){
    setText('daily-tmyk-title',tmyk.title||'');
    setHTML('daily-tmyk-body',mdInline(tmyk.body||''));
    if(tmykWrap)tmykWrap.hidden=false;
  } else {
    if(tmykWrap)tmykWrap.hidden=true;
  }

  // Daily Quote: off since 2026-10-09. data/quote-pool.json has no source
  // for any attribution, so no quote is shown, even on an issue carrying one.

  // Watch list
  /* The card stays hidden until it has at least one item to show. */
  var wl=el('daily-watch-list'),wlCard=wl&&wl.closest('.s-card');
  var wItems=Array.isArray(data.watch_list)?data.watch_list.filter(function(item){return item&&(item.desc||item.event);}):[];
  if(wl&&wItems.length){
    wl.innerHTML=wItems.map(function(item){
      return '<li class="watch-item"><span class="watch-time">'+escHtml(item.time||'')+'</span><span class="watch-desc">'+mdInline(item.desc||item.event||'')+'</span></li>';
    }).join('');
    if(wlCard)wlCard.style.display='';
  } else if(wlCard){wlCard.style.display='none';}

  // The Number — canonical: one_number, legacy: the_number or number
  var _num=pick(data.one_number,data.the_number,data.number);
  var nv=el('daily-number-value'),nu=el('daily-number-unit'),nc=el('daily-number-context');
  var numCard=nv&&nv.closest('.s-card');
  /* No value, no card: an empty or "-" value used to print "THE NUMBER -". A numeric 0 is a real headline (e.g. zero export sales), not a missing one. */
  if(_num&&_num.value!=null&&String(_num.value).trim()!==''&&!/^[-\u2013\u2014]+$/.test(String(_num.value).trim())){
    if(nv)nv.textContent=_num.value;
    if(nu)nu.textContent=_num.unit||'';
    if(nc)nc.textContent=_num.context||'';
    if(numCard)numCard.style.display='';
  } else {
    if(numCard)numCard.style.display='none';
  }

  // Mood — canonical: meta.market_mood, legacy: mood
  // v4.0: also adds tone class (bullish/bearish/mixed/neutral/cautious) so styles.css v9.4 pill variants apply
  var mood=pick(data.mood,(data.meta&&data.meta.market_mood));
  var moodEl=el('daily-mood');
  if(moodEl&&mood){
    moodEl.textContent=mood;
    var moodLc=String(mood).toLowerCase();
    var moodClass='neutral';
    if(/bull/.test(moodLc))moodClass='bullish';
    else if(/bear/.test(moodLc))moodClass='bearish';
    else if(/mixed|choppy|sideways/.test(moodLc))moodClass='mixed';
    else if(/caution|wary|risk/.test(moodLc))moodClass='cautious';
    moodEl.className='daily-mood '+moodClass;
    moodEl.style.display='inline-block';
  }

  // Surprise banner
  if(data.surprise_magnitude&&data.surprise_magnitude!=='none'){
    var sb=el('daily-surprise-banner');
    if(sb){
      var mag=data.surprise_magnitude,icon=mag==='high'?'<svg class="ic" aria-hidden="true"><use href="#i-zap"/></svg>':mag==='medium'?'<svg class="ic" aria-hidden="true"><use href="#i-chart-column"/></svg>':'<svg class="ic" aria-hidden="true"><use href="#i-droplet"/></svg>';
      var msg=data.surprise_message||data.subheadline||'Notable market move today';
      var cls=mag==='high'?'surprise--high':mag==='medium'?'surprise--medium':'surprise--low';
      sb.className='daily-surprise-banner '+cls;
      sb.innerHTML='<span class="surprise-icon">'+icon+'</span><span class="surprise-text"><strong>'+msg+'</strong></span>';
      sb.style.display='flex';
    }
  }

  // Source line — canonical: source_summary, legacy: source_line
  var src=pick(data.source_summary,data.source_line);
  if(src)setText('daily-source',src);

  // v4.0: weekly_thread — chapter marker above headline (Mon sets up Tue-Fri progress, Fri resolves)
  var thread=data.weekly_thread,threadEl=el('daily-thread-marker');
  if(threadEl){
    if(thread&&thread.question&&thread.day){
      var threadQ=el('daily-thread-q'),threadD=el('daily-thread-day');
      if(threadD)threadD.textContent=thread.day;
      if(threadQ)threadQ.textContent=thread.question;
      threadEl.style.display='inline-flex';
    } else { threadEl.style.display='none'; }
  }

  // v4.0: yesterdays_call — outcome pill (played_out=green, didnt=red, pending=amber)
  var yc=data.yesterdays_call,ycEl=el('daily-yc');
  if(ycEl){
    // v5.1: call_line is written by the grader from the record; summary is the pre-cut prose
    var ycLine=(yc&&(yc.call_line||yc.summary))||'';
    if(yc&&ycLine){
      var pill=el('daily-yc-pill'),sumEl=el('daily-yc-summary'),noteEl=el('daily-yc-note');
      var oc=String(yc.outcome||'pending').toLowerCase();
      var ocLbl=oc==='played_out'?'<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg> Played out':oc==='didnt'?'<svg class="ic" aria-hidden="true"><use href="#i-x"/></svg> Didn\u2019t':'<svg class="ic" aria-hidden="true"><use href="#i-hourglass"/></svg> Pending';
      var ocCls=oc==='played_out'?'yc-pill--good':oc==='didnt'?'yc-pill--bad':'yc-pill--pending';
      if(pill){pill.innerHTML=ocLbl;pill.className='daily-yc-pill '+ocCls;}
      if(sumEl)sumEl.textContent=ycLine;
      if(noteEl)noteEl.textContent=yc.note?', '+yc.note:'';
      ycEl.style.display='block';
    } else { ycEl.style.display='none'; }
  }

  // v4.0: spread_to_watch — specific futures spread + commentary
  var sp=data.spread_to_watch,spEl=el('daily-spread');
  if(spEl){
    if(sp&&sp.label&&sp.commentary){
      var spLbl=el('daily-spread-label-text'),spLvl=el('daily-spread-level'),spBody=el('daily-spread-commentary');
      if(spLbl)spLbl.textContent=sp.label;
      if(spLvl)spLvl.textContent=sp.level||'';
      if(spBody)spBody.innerHTML=mdInline(sp.commentary);
      spEl.style.display='block';
    } else { spEl.style.display='none'; }
  }

  // v4.0: basis pulse — directional only, weekday-required (hidden on weekends/holidays)
  var bs=data.basis,bsEl=el('daily-basis'),isClosed=data.market_closed===true;
  if(bsEl){
    if(bs&&bs.headline&&bs.body&&!isClosed){
      var bsH=el('daily-basis-headline'),bsB=el('daily-basis-body');
      if(bsH)bsH.textContent=bs.headline;
      if(bsB)bsB.innerHTML=mdInline(bs.body);
      bsEl.style.display='block';
    } else { bsEl.style.display='none'; }
  }

  // v4.1: sponsor block, filled state plus the collapsed teaser credit.
  // 2026-10-11 (Sig, "tone it down"): only a PAID sponsor draws anything. No
  // sponsor, sponsor:false or the house ad -> the block, the credit and the
  // strip all stay hidden. There is no empty-state billboard any more.
  var sp=data.sponsor,spEl=el('daily-sponsor'),spFilled=el('dsp-filled'),spTeaser=el('daily-teaser-sponsor');
  // v4.2: inline sponsor attribution above the greeting — second touchpoint (block + teaser + this line)
  var spAttr=el('daily-spattr');
  if(spEl){
    var _tw=el('idx1-sponsor-wrap'),_tb=el('idx1-sponsor');
    if(_tw){_tw.hidden=true;}
    var spRow=(spTeaser&&spTeaser.parentNode&&spTeaser.parentNode.classList.contains('s7-adrow'))?spTeaser.parentNode:null;
    if(_tb){_tb.innerHTML='';_tb.removeAttribute('data-sponsor-slot');}
    if(!(sp&&!sp.is_house_ad&&(sp.advertiser||sp.name)&&(sp.headline||sp.tagline))){
      // Unsold (or switched off): nothing shows.
      spEl.style.display='none';
      spEl.classList.remove('filled');
      if(spFilled){spFilled.style.display='none';spFilled.innerHTML='';}
      if(spRow)spRow.style.display='none';
      if(spTeaser)spTeaser.style.display='none';
      if(spAttr)spAttr.style.display='none';
    } else {
      // data/sponsor.json carries advertiser/headline/body/cta_url. This used to
      // test sp.name/sp.tagline, which that file has never had, so a paid
      // sponsor fell through to the house billboard below.
      var spNm=sp.advertiser||sp.name||'';
      var spHref=(sp.cta_urls&&sp.cta_urls.homepage)||sp.cta_url||sp.url||'';
      // Filled state — paid sponsor placement
      spEl.style.display='';
      spEl.classList.add('filled');
      if(spFilled)spFilled.style.display='block';
      /* ONE RENDERER. components/sponsor-ad.js draws this ad on the homepage,
         /daily and the sponsor's own portal; the archive pages get the same
         markup from scripts/generate_daily.py. */
      if(spFilled)spFilled.innerHTML=(window.AgsistAd?window.AgsistAd.render(sp,'homepage',{click:'daily-briefing'}):'');
      // Collapsed teaser sponsor — quiet attribution
      if(spTeaser){
        if(spRow)spRow.style.display='';
        spTeaser.style.display='';
        spTeaser.classList.add('has-sponsor');
        spTeaser.textContent='Sponsored by '+(spNm||'partner');
        if(spHref){spTeaser.href=spHref;spTeaser.target='_blank';spTeaser.rel='sponsored noopener';spTeaser.setAttribute('data-sponsor-click','daily-briefing');}
        else{spTeaser.removeAttribute('target');spTeaser.removeAttribute('rel');spTeaser.removeAttribute('data-sponsor-click');spTeaser.href='/sponsor';}
      }
      /* The homepage sponsor strip, outside the fold. Same fields and the same
         tagged homepage link as the ad above; measured as its own slot. The
         teaser pill would say the same name a line higher, so it steps aside. */
      var tw=el('idx1-sponsor-wrap'),tb=el('idx1-sponsor'),tE=window.AgsistAd?window.AgsistAd.esc:escHtml;
      if(tw&&tb){
        var tHead=sp.headline||sp.tagline||'',tCta=sp.cta_text||'Learn more',tExt=/^https?:/i.test(spHref);
        tb.setAttribute('data-sponsor-slot','homepage-top');
        tb.innerHTML='<span class="ag-sponsor-tag">Sponsor</span>'+
          (sp.logo?'<span class="idx1-sp-logo"><img src="'+tE(sp.logo)+'" alt="'+tE(spNm+' logo')+'" width="56" height="28" loading="lazy" decoding="async" onerror="this.parentNode.remove()"></span>':'')+
          '<span class="idx1-sp-txt"><strong>'+tE(spNm)+'</strong>'+(tHead?' <span class="idx1-sp-head">'+tE(tHead)+'</span>':'')+'</span>'+
          (spHref?' <a class="idx1-sp-cta" href="'+tE(spHref)+'" rel="sponsored noopener"'+(tExt?' target="_blank"':'')+' data-sponsor-click="homepage-top">'+tE(tCta)+' &rarr;</a>':'');
        tw.hidden=false;
        if(spTeaser){spTeaser.style.display='none';if(spTeaser.parentNode&&spTeaser.parentNode.classList.contains('s7-adrow'))spTeaser.parentNode.style.display='none';}
      }
      // Inline attribution above greeting — paid state
      if(spAttr&&spNm){
        spAttr.style.display='inline-flex';
        spAttr.classList.remove('daily-spattr--house');
        spAttr.classList.add('daily-spattr--paid');
        spAttr.innerHTML='<svg class="ic" aria-hidden="true"><use href="#i-circle"/></svg> Today\u2019s sponsor: <strong>'+escHtml(spNm)+'</strong> \u2192';
        if(spHref){spAttr.href=spHref;spAttr.target='_blank';spAttr.rel='sponsored noopener';}
        else{spAttr.removeAttribute('target');spAttr.rel='sponsored';spAttr.href='mailto:sig@farmers1st.com';}
      }
    }
  }
};
(function(){
  AG.json('/data/daily.json')
  .then(function(data){if(typeof window.hydrateDaily==='function')window.hydrateDaily(data);wireShare();})
  .catch(function(){
    // 2026-09-30: this used to overwrite daily-headline with "Daily briefing
    // loading\u2026" on a failed fetch \u2014 but bake_homepage.py already wrote
    // today's REAL headline into that element before the page shipped. A
    // failed client-side fetch is a reason to stop trying to re-hydrate, not
    // a reason to erase real content and replace it with a placeholder that
    // implies nothing has loaded yet. Leaving the element alone; wireShare()
    // below reads whatever's already there, so it picks up the correct baked
    // headline for the share links instead of the fake "loading" text.
    // WAVE3-M 2026-10-03: index1 is not baked (bake_homepage.py writes only
    // index.html), so its static block ships empty. A failed fetch says so
    // and links to /daily instead of leaving an undated old briefing up.
    // 2026-10-06: index1 became index.html, which bake_homepage.py DOES bake,
    // and it stamps the briefing's date on the hero. A baked briefing from the
    // last two days stays up with its date showing; only an older or unbaked
    // one gives way to the "did not load" note.
    var _hero=document.getElementById('daily-hero');
    var _bd=_hero&&_hero.getAttribute('data-briefing-date');
    if(_bd&&/^\d{4}-\d{2}-\d{2}$/.test(_bd)){
      var _age=(Date.now()-Date.parse(_bd+'T12:00:00Z'))/864e5;
      if(_age>-1&&_age<2.5){
        var _dd=document.getElementById('daily-date');
        if(_dd&&!_dd.textContent.trim())_dd.textContent=_bd;
        var _pb=document.getElementById('daily-published');
        if(_pb)_pb.textContent='Snapshot at briefing publish \u00b7 this copy shipped with the page';
        wireShare();return;
      }
    }
    if(_hero)_hero.classList.add('daily-failed');
    var _hl=document.getElementById('daily-headline');if(_hl)_hl.textContent='Today\u2019s briefing did not load';
    var _ld=document.getElementById('daily-lead');if(_ld)_ld.innerHTML='Read it on <a href="/daily">the briefing page</a>.';
    var _tt=document.getElementById('daily-teaser-text');if(_tt)_tt.textContent='Today\u2019s briefing did not load.';
    // The sidebar is NOT baked, so its placeholders must not say "Loading" forever.
    var _wl=document.getElementById('daily-watch-list');
    if(_wl)_wl.innerHTML='<li class="watch-item"><span class="watch-time">-</span><span class="watch-desc">Watch list unavailable, see <a href="/daily" style="color:var(--gold)">today\u2019s briefing</a></span></li>';
    wireShare();
  });
  // Share strip wiring — runs after hydrateDaily so headline reflects current briefing
  function wireShare(){
    var SHARE_URL='https://agsist.com/daily';
    var hl=document.getElementById('daily-headline');
    var headlineText=hl?hl.textContent.trim():'Today\u2019s AGSIST Daily';
    if(!headlineText||/loading|did not load/i.test(headlineText))headlineText='Today\u2019s AGSIST Daily';
    var shareTitle='AGSIST Daily, '+headlineText;
    var ld=document.getElementById('daily-lead');
    var leadText=ld?ld.textContent.trim():'';
    var shareSummary=leadText||'Today\u2019s ag market briefing on AGSIST: overnight markets, what to watch, one number to know.';
    var enc=encodeURIComponent;
    var x=document.getElementById('dsb-x');if(x)x.href='https://x.com/intent/post?text='+enc(shareTitle)+'&url='+enc(SHARE_URL)+'&via=agsist';
    var fb=document.getElementById('dsb-fb');if(fb)fb.href='https://www.facebook.com/sharer/sharer.php?u='+enc(SHARE_URL);
    var li=document.getElementById('dsb-li');if(li)li.href='https://www.linkedin.com/sharing/share-offsite/?url='+enc(SHARE_URL);
    var em=document.getElementById('dsb-em');if(em)em.href='mailto:?subject='+enc(shareTitle)+'&body='+enc(shareSummary+'\n\n'+SHARE_URL);
    // Native share (mobile) — show button if API available
    if(navigator.share){
      var nat=document.getElementById('dsb-native');
      if(nat){
        nat.style.display='inline-flex';
        nat.addEventListener('click',function(){
          navigator.share({title:shareTitle,text:shareSummary,url:SHARE_URL}).catch(function(){});
        });
      }
    }
    // Copy to clipboard with toast
    var cp=document.getElementById('dsb-copy');
    if(cp){
      cp.addEventListener('click',function(){
        var t=SHARE_URL;
        function showToast(msg,ok){
          var existing=document.getElementById('daily-share-toast');if(existing)existing.remove();
          var toast=document.createElement('div');
          toast.id='daily-share-toast';toast.className='daily-share-toast';toast.textContent=msg;
          if(!ok)toast.style.background='var(--red)';
          document.body.appendChild(toast);
          requestAnimationFrame(function(){toast.classList.add('show');});
          setTimeout(function(){toast.classList.remove('show');setTimeout(function(){if(toast.parentNode)toast.parentNode.removeChild(toast);},300);},2200);
        }
        if(navigator.clipboard&&navigator.clipboard.writeText){
          navigator.clipboard.writeText(t).then(function(){showToast('<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg> Link copied',true);},function(){showToast('Copy failed',false);});
        } else {
          // Fallback for older browsers
          try{var ta=document.createElement('textarea');ta.value=t;ta.style.position='fixed';ta.style.top='-9999px';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();showToast('<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg> Link copied',true);}
          catch(e){showToast('Copy failed',false);}
        }
      });
    }
  }
})();
} catch (e) { blockFailed(e); }

/* ---- former inline block 10 ---- */
try {
/* PWA: show install hint with visual modal (v2, May 4 2026). The service
   worker is registered by components/loader.js (2026-10-12). */
(function(){
  'use strict';
  /* 2026-10-16: the banner and modals (about 16 KB, mostly SVG) used to sit in
     index.html for every visit; they are built here only for a phone that
     passes the gates below. PWA_HTML is the same markup, comments removed. */
  var hint = null;
  // Bail if already running as installed PWA
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  var iosStandalone = (window.navigator && window.navigator.standalone === true);
  if(standalone || iosStandalone) return;
  // Bail if user previously dismissed
  try{ if(localStorage.getItem('agsist_pwa_dismissed') === '1') return; }catch(e){}
  // Visit-count gate — don't pester first-time visitors
  var visits = 0;
  try{ visits = parseInt(localStorage.getItem('agsist_visits') || '0', 10); }catch(e){}
  if(visits < 2) return;
  // Don't compete with the daily briefing on first read
  var dailyDismissed = false;
  try{ if(window.TODAY_KEY) dailyDismissed = (localStorage.getItem(window.TODAY_KEY) === '1'); }catch(e){}
  var ua = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  var isAndroid = /Android/.test(ua);
  var isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  var isIOSSafari = isIOS && isSafari;
  // Only show on mobile — PWA install on desktop is uncommon
  if(!isIOS && !isAndroid) return;
  if(!document.getElementById('pwa-hint')){
    var PWA_HTML = "<div class=\"pwa-hint\" id=\"pwa-hint\" role=\"dialog\" aria-label=\"Install AGSIST to home screen\" aria-live=\"polite\">\n<span class=\"pwa-hint-icon\" aria-hidden=\"true\"><svg class=\"ic\" aria-hidden=\"true\"><use href=\"#i-smartphone\"/></svg></span>\n<div class=\"pwa-hint-body\">\n<strong id=\"pwa-hint-title\">Add AGSIST to your home screen</strong>\n<em id=\"pwa-hint-text\">Open like a real app, faster, no browser bar.</em>\n</div>\n<div class=\"pwa-hint-actions\" id=\"pwa-hint-actions\">\n<button class=\"pwa-hint-btn pwa-hint-btn--primary\" id=\"pwa-install-btn\" type=\"button\">Show Me How</button>\n</div>\n<button class=\"pwa-hint-close\" id=\"pwa-hint-close\" type=\"button\" aria-label=\"Dismiss install hint\"><svg class=\"ic\" aria-hidden=\"true\"><use href=\"#i-x\"/></svg></button>\n</div>\n<div class=\"pwa-modal\" id=\"pwa-modal-ios\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"pwa-modal-ios-title\" aria-hidden=\"true\">\n<div class=\"pwa-modal-card\" role=\"document\">\n<button class=\"pwa-modal-close\" id=\"pwa-modal-ios-close\" type=\"button\" aria-label=\"Close instructions\"><svg class=\"ic\" aria-hidden=\"true\"><use href=\"#i-x\"/></svg></button>\n<div class=\"pwa-modal-head\">\n<h3 id=\"pwa-modal-ios-title\">Add AGSIST to Your iPhone</h3>\n<p>Three quick taps and AGSIST opens like an app from your home screen, no browser bar, no app store.</p>\n</div>\n<div class=\"pwa-modal-body\">\n<div class=\"pwa-step\">\n<div class=\"pwa-step-num\">1</div>\n<div class=\"pwa-step-content\">\n<div class=\"pwa-step-title\">Tap the Share button below</div>\n<div class=\"pwa-step-desc\">Look at the bottom of your screen. Find the <strong>square with an arrow pointing up</strong>. It&rsquo;s in Safari&rsquo;s toolbar between the back/forward arrows and the bookmarks icon.</div>\n<div class=\"pwa-visual\" aria-hidden=\"true\">\n<svg viewBox=\"0 0 360 200\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\" aria-label=\"Diagram showing the Share button location in Safari’s bottom toolbar\">\n<rect x=\"40\" y=\"10\" width=\"280\" height=\"180\" rx=\"22\" fill=\"#0d0d0d\" stroke=\"#3a3a3a\" stroke-width=\"2\"/>\n<rect x=\"48\" y=\"22\" width=\"264\" height=\"156\" rx=\"14\" fill=\"#1a1a1a\"/>\n<rect x=\"60\" y=\"34\" width=\"240\" height=\"6\" rx=\"2\" fill=\"#2a3520\"/>\n<rect x=\"60\" y=\"46\" width=\"180\" height=\"4\" rx=\"2\" fill=\"#252525\"/>\n<rect x=\"60\" y=\"56\" width=\"220\" height=\"4\" rx=\"2\" fill=\"#252525\"/>\n<rect x=\"60\" y=\"66\" width=\"160\" height=\"4\" rx=\"2\" fill=\"#252525\"/>\n<rect x=\"60\" y=\"80\" width=\"240\" height=\"40\" rx=\"6\" fill=\"#1f2818\"/>\n<rect x=\"60\" y=\"128\" width=\"200\" height=\"4\" rx=\"2\" fill=\"#252525\"/>\n<rect x=\"60\" y=\"138\" width=\"220\" height=\"4\" rx=\"2\" fill=\"#252525\"/>\n<rect x=\"48\" y=\"156\" width=\"264\" height=\"22\" rx=\"0\" fill=\"#2a2a2a\"/>\n<line x1=\"48\" y1=\"156\" x2=\"312\" y2=\"156\" stroke=\"#3a3a3a\" stroke-width=\"1\"/>\n<path d=\"M70 167 L66 170 L70 173\" stroke=\"#888\" stroke-width=\"1.5\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n<path d=\"M105 167 L109 170 L105 173\" stroke=\"#666\" stroke-width=\"1.5\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n<g transform=\"translate(170 167)\">\n<rect x=\"-7\" y=\"-1\" width=\"14\" height=\"11\" rx=\"1.5\" fill=\"none\" stroke=\"#d4a23f\" stroke-width=\"1.6\"/>\n<line x1=\"0\" y1=\"-7\" x2=\"0\" y2=\"4\" stroke=\"#d4a23f\" stroke-width=\"1.6\" stroke-linecap=\"round\"/>\n<path d=\"M-3 -4 L0 -7 L3 -4\" stroke=\"#d4a23f\" stroke-width=\"1.6\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n</g>\n<path d=\"M225 164 L225 174 L228 172 L231 174 L231 164 Z\" fill=\"none\" stroke=\"#888\" stroke-width=\"1.4\"/>\n<rect x=\"265\" y=\"164\" width=\"9\" height=\"9\" rx=\"1\" fill=\"none\" stroke=\"#888\" stroke-width=\"1.4\"/>\n<rect x=\"269\" y=\"167\" width=\"9\" height=\"9\" rx=\"1\" fill=\"none\" stroke=\"#888\" stroke-width=\"1.4\"/>\n<g class=\"pwa-arrow-anim\">\n<path d=\"M170 195 L170 184 L165 184 M170 184 L175 184\" stroke=\"#d4a23f\" stroke-width=\"2.2\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n<text x=\"170\" y=\"208\" text-anchor=\"middle\" fill=\"#d4a23f\" font-family=\"Archivo,sans-serif\" font-size=\"11\" font-weight=\"700\">TAP HERE</text>\n</g>\n</svg>\n</div>\n</div>\n</div>\n<div class=\"pwa-step\">\n<div class=\"pwa-step-num\">2</div>\n<div class=\"pwa-step-content\">\n<div class=\"pwa-step-title\">Scroll down, tap \"Add to Home Screen\"</div>\n<div class=\"pwa-step-desc\">A menu slides up. Scroll past the row of app icons (Messages, Mail, etc.) until you see <strong>Add to Home Screen</strong> with a <kbd>&plus;</kbd> icon. Tap it.</div>\n<div class=\"pwa-visual\" aria-hidden=\"true\">\n<svg viewBox=\"0 0 360 180\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\" aria-label=\"Diagram showing the Add to Home Screen menu option\">\n<rect x=\"20\" y=\"10\" width=\"320\" height=\"160\" rx=\"12\" fill=\"#222\" stroke=\"#3a3a3a\" stroke-width=\"1\"/>\n<rect x=\"167\" y=\"16\" width=\"26\" height=\"3\" rx=\"1.5\" fill=\"#555\"/>\n<circle cx=\"50\" cy=\"40\" r=\"11\" fill=\"#34c759\"/>\n<circle cx=\"84\" cy=\"40\" r=\"11\" fill=\"#007aff\"/>\n<circle cx=\"118\" cy=\"40\" r=\"11\" fill=\"#5856d6\"/>\n<circle cx=\"152\" cy=\"40\" r=\"11\" fill=\"#ff3b30\"/>\n<circle cx=\"186\" cy=\"40\" r=\"11\" fill=\"#ff9500\"/>\n<circle cx=\"220\" cy=\"40\" r=\"11\" fill=\"#af52de\"/>\n<text x=\"50\" y=\"60\" text-anchor=\"middle\" fill=\"#666\" font-family=\"-apple-system,sans-serif\" font-size=\"6\">Msgs</text>\n<text x=\"84\" y=\"60\" text-anchor=\"middle\" fill=\"#666\" font-family=\"-apple-system,sans-serif\" font-size=\"6\">Mail</text>\n<text x=\"118\" y=\"60\" text-anchor=\"middle\" fill=\"#666\" font-family=\"-apple-system,sans-serif\" font-size=\"6\">Notes</text>\n<text x=\"152\" y=\"60\" text-anchor=\"middle\" fill=\"#666\" font-family=\"-apple-system,sans-serif\" font-size=\"6\">Reminders</text>\n<text x=\"186\" y=\"60\" text-anchor=\"middle\" fill=\"#666\" font-family=\"-apple-system,sans-serif\" font-size=\"6\">Maps</text>\n<text x=\"220\" y=\"60\" text-anchor=\"middle\" fill=\"#666\" font-family=\"-apple-system,sans-serif\" font-size=\"6\">Contacts</text>\n<line x1=\"30\" y1=\"76\" x2=\"330\" y2=\"76\" stroke=\"#3a3a3a\" stroke-width=\"1\"/>\n<text x=\"40\" y=\"92\" fill=\"#888\" font-family=\"-apple-system,sans-serif\" font-size=\"11\">Copy</text>\n<text x=\"320\" y=\"92\" text-anchor=\"end\" fill=\"#666\" font-family=\"-apple-system,sans-serif\" font-size=\"14\"><svg class=\"ic\" aria-hidden=\"true\"><use href=\"#i-clipboard-list\"/></svg></text>\n<line x1=\"30\" y1=\"102\" x2=\"330\" y2=\"102\" stroke=\"#3a3a3a\" stroke-width=\"1\"/>\n<text x=\"40\" y=\"118\" fill=\"#888\" font-family=\"-apple-system,sans-serif\" font-size=\"11\">Add to Reading List</text>\n<text x=\"320\" y=\"118\" text-anchor=\"end\" fill=\"#666\" font-family=\"-apple-system,sans-serif\" font-size=\"14\"><svg class=\"ic\" aria-hidden=\"true\"><use href=\"#i-book-open\"/></svg></text>\n<line x1=\"30\" y1=\"128\" x2=\"330\" y2=\"128\" stroke=\"#3a3a3a\" stroke-width=\"1\"/>\n<rect x=\"22\" y=\"130\" width=\"316\" height=\"28\" rx=\"4\" fill=\"rgba(var(--gold-rgb),0.15)\" stroke=\"#d4a23f\" stroke-width=\"1.5\"/>\n<text x=\"40\" y=\"148\" fill=\"#d4a23f\" font-family=\"-apple-system,sans-serif\" font-size=\"11.5\" font-weight=\"600\">Add to Home Screen</text>\n<g transform=\"translate(316 144)\">\n<rect x=\"-9\" y=\"-9\" width=\"18\" height=\"18\" rx=\"3.5\" fill=\"none\" stroke=\"#d4a23f\" stroke-width=\"1.5\"/>\n<line x1=\"-4\" y1=\"0\" x2=\"4\" y2=\"0\" stroke=\"#d4a23f\" stroke-width=\"1.6\"/>\n<line x1=\"0\" y1=\"-4\" x2=\"0\" y2=\"4\" stroke=\"#d4a23f\" stroke-width=\"1.6\"/>\n</g>\n<g class=\"pwa-arrow-anim\">\n<path d=\"M260 144 L246 144 M250 140 L246 144 L250 148\" stroke=\"#d4a23f\" stroke-width=\"2\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n</g>\n</svg>\n</div>\n</div>\n</div>\n<div class=\"pwa-step\">\n<div class=\"pwa-step-num\">3</div>\n<div class=\"pwa-step-content\">\n<div class=\"pwa-step-title\">Tap \"Add\" in the top corner</div>\n<div class=\"pwa-step-desc\">A confirmation screen pops up with &ldquo;AGSIST&rdquo; pre-filled. Tap <strong>Add</strong> in the top-right corner. The icon will appear on your home screen right away.</div>\n</div>\n</div>\n</div>\n<div class=\"pwa-modal-footer\">\n<div class=\"pwa-modal-footer-text\">Once installed, tap the <strong>AGSIST icon</strong> on your home screen any time. Opens like an app, no browser. Works offline for content you&rsquo;ve already viewed.</div>\n</div>\n</div>\n</div>\n<div class=\"pwa-modal\" id=\"pwa-modal-android\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"pwa-modal-android-title\" aria-hidden=\"true\">\n<div class=\"pwa-modal-card\" role=\"document\">\n<button class=\"pwa-modal-close\" id=\"pwa-modal-android-close\" type=\"button\" aria-label=\"Close instructions\"><svg class=\"ic\" aria-hidden=\"true\"><use href=\"#i-x\"/></svg></button>\n<div class=\"pwa-modal-head\">\n<h3 id=\"pwa-modal-android-title\">Install AGSIST on Android</h3>\n<p>Quick install through Chrome&rsquo;s menu, no Play Store needed.</p>\n</div>\n<div class=\"pwa-modal-body\">\n<div class=\"pwa-step\">\n<div class=\"pwa-step-num\">1</div>\n<div class=\"pwa-step-content\">\n<div class=\"pwa-step-title\">Tap the menu button</div>\n<div class=\"pwa-step-desc\">In Chrome&rsquo;s top-right corner, tap the <strong>three vertical dots</strong> (&#x22EE;) to open the menu.</div>\n<div class=\"pwa-visual\" aria-hidden=\"true\">\n<svg viewBox=\"0 0 360 110\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\" aria-label=\"Diagram showing the three-dot menu in Chrome’s top-right\">\n<rect x=\"20\" y=\"20\" width=\"320\" height=\"42\" rx=\"6\" fill=\"#202124\" stroke=\"#3a3a3a\" stroke-width=\"1\"/>\n<rect x=\"30\" y=\"28\" width=\"50\" height=\"6\" rx=\"3\" fill=\"#3a3a3a\"/>\n<rect x=\"40\" y=\"42\" width=\"220\" height=\"14\" rx=\"7\" fill=\"#3a3a3a\"/>\n<text x=\"50\" y=\"52\" fill=\"#888\" font-family=\"-apple-system,sans-serif\" font-size=\"8\">agsist.com</text>\n<rect x=\"278\" y=\"44\" width=\"12\" height=\"12\" rx=\"2\" fill=\"none\" stroke=\"#888\" stroke-width=\"1.4\"/>\n<text x=\"284\" y=\"53\" text-anchor=\"middle\" fill=\"#888\" font-family=\"-apple-system,sans-serif\" font-size=\"7\">3</text>\n<g transform=\"translate(310 49)\">\n<circle cx=\"0\" cy=\"-7\" r=\"2.2\" fill=\"#d4a23f\"/>\n<circle cx=\"0\" cy=\"0\" r=\"2.2\" fill=\"#d4a23f\"/>\n<circle cx=\"0\" cy=\"7\" r=\"2.2\" fill=\"#d4a23f\"/>\n</g>\n<g class=\"pwa-arrow-anim\">\n<path d=\"M310 90 L310 75 M305 80 L310 75 L315 80\" stroke=\"#d4a23f\" stroke-width=\"2.2\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n<text x=\"310\" y=\"103\" text-anchor=\"middle\" fill=\"#d4a23f\" font-family=\"Archivo,sans-serif\" font-size=\"10\" font-weight=\"700\">TAP HERE</text>\n</g>\n</svg>\n</div>\n</div>\n</div>\n<div class=\"pwa-step\">\n<div class=\"pwa-step-num\">2</div>\n<div class=\"pwa-step-content\">\n<div class=\"pwa-step-title\">Tap \"Install app\" or \"Add to Home screen\"</div>\n<div class=\"pwa-step-desc\">Scroll the menu list. Look for <strong>Install app</strong> (newer Chrome) or <strong>Add to Home screen</strong> (older Chrome). Tap it.</div>\n<div class=\"pwa-visual\" aria-hidden=\"true\">\n<svg viewBox=\"0 0 360 180\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\" aria-label=\"Diagram showing the Install app option in Chrome’s menu\">\n<rect x=\"120\" y=\"10\" width=\"220\" height=\"160\" rx=\"6\" fill=\"#2a2a2a\" stroke=\"#3a3a3a\" stroke-width=\"1\"/>\n<text x=\"135\" y=\"32\" fill=\"#aaa\" font-family=\"-apple-system,sans-serif\" font-size=\"11\">New tab</text>\n<line x1=\"125\" y1=\"42\" x2=\"335\" y2=\"42\" stroke=\"#3a3a3a\" stroke-width=\"0.5\"/>\n<text x=\"135\" y=\"58\" fill=\"#aaa\" font-family=\"-apple-system,sans-serif\" font-size=\"11\">New incognito tab</text>\n<line x1=\"125\" y1=\"68\" x2=\"335\" y2=\"68\" stroke=\"#3a3a3a\" stroke-width=\"0.5\"/>\n<text x=\"135\" y=\"84\" fill=\"#aaa\" font-family=\"-apple-system,sans-serif\" font-size=\"11\">Bookmarks</text>\n<line x1=\"125\" y1=\"94\" x2=\"335\" y2=\"94\" stroke=\"#3a3a3a\" stroke-width=\"0.5\"/>\n<text x=\"135\" y=\"110\" fill=\"#aaa\" font-family=\"-apple-system,sans-serif\" font-size=\"11\">Recent tabs</text>\n<line x1=\"125\" y1=\"120\" x2=\"335\" y2=\"120\" stroke=\"#3a3a3a\" stroke-width=\"0.5\"/>\n<rect x=\"122\" y=\"124\" width=\"216\" height=\"26\" rx=\"4\" fill=\"rgba(var(--gold-rgb),0.15)\" stroke=\"#d4a23f\" stroke-width=\"1.5\"/>\n<text x=\"135\" y=\"142\" fill=\"#d4a23f\" font-family=\"-apple-system,sans-serif\" font-size=\"11.5\" font-weight=\"600\">Install app</text>\n<g transform=\"translate(322 137)\">\n<path d=\"M-5 -2 L0 3 L5 -2\" stroke=\"#d4a23f\" stroke-width=\"1.5\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n<line x1=\"0\" y1=\"-5\" x2=\"0\" y2=\"3\" stroke=\"#d4a23f\" stroke-width=\"1.5\" stroke-linecap=\"round\"/>\n</g>\n<g class=\"pwa-arrow-anim\">\n<path d=\"M95 137 L115 137 M111 132 L115 137 L111 142\" stroke=\"#d4a23f\" stroke-width=\"2\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n</g>\n<line x1=\"125\" y1=\"156\" x2=\"335\" y2=\"156\" stroke=\"#3a3a3a\" stroke-width=\"0.5\"/>\n<text x=\"135\" y=\"170\" fill=\"#aaa\" font-family=\"-apple-system,sans-serif\" font-size=\"11\">Settings</text>\n</svg>\n</div>\n</div>\n</div>\n<div class=\"pwa-step\">\n<div class=\"pwa-step-num\">3</div>\n<div class=\"pwa-step-content\">\n<div class=\"pwa-step-title\">Confirm install</div>\n<div class=\"pwa-step-desc\">Chrome shows a confirmation dialog. Tap <strong>Install</strong> (or <strong>Add</strong>). The AGSIST icon appears on your home screen / app drawer right away.</div>\n</div>\n</div>\n</div>\n<div class=\"pwa-modal-footer\">\n<div class=\"pwa-modal-footer-text\">Once installed, tap the <strong>AGSIST icon</strong> any time. Opens like a real app, no browser bar.</div>\n</div>\n</div>\n</div>";
    var wrap = document.createElement('div');
    wrap.innerHTML = PWA_HTML;
    var foot = document.getElementById('site-footer');
    while(wrap.firstChild){ if(foot && foot.parentNode) foot.parentNode.insertBefore(wrap.firstChild, foot); else document.body.appendChild(wrap.firstChild); }
  }
  hint = document.getElementById('pwa-hint');
  if(!hint) return;
  var hintTitle = document.getElementById('pwa-hint-title');
  var hintText = document.getElementById('pwa-hint-text');
  var installBtn = document.getElementById('pwa-install-btn');
  var closeBtn = document.getElementById('pwa-hint-close');
  var modalIos = document.getElementById('pwa-modal-ios');
  var modalAndroid = document.getElementById('pwa-modal-android');
  var modalIosClose = document.getElementById('pwa-modal-ios-close');
  var modalAndroidClose = document.getElementById('pwa-modal-android-close');
  function showHint(){ hint.classList.add('show'); }
  function hideHint(){ hint.classList.remove('show'); }
  function dismissHint(persist){
    hideHint();
    if(persist !== false){
      try{ localStorage.setItem('agsist_pwa_dismissed','1'); }catch(e){}
    }
    if(window.gtag) try{ window.gtag('event','pwa_hint_dismiss',{event_category:'engagement'}); }catch(e){}
  }
  function openModal(modalEl){
    if(!modalEl) return;
    modalEl.classList.add('show');
    modalEl.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
    if(window.gtag) try{ window.gtag('event','pwa_modal_open',{event_category:'engagement',event_label: modalEl.id}); }catch(e){}
  }
  function closeModal(modalEl){
    if(!modalEl) return;
    modalEl.classList.remove('show');
    modalEl.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
  }
  // Wire up close handlers — clicking outside the card OR on the X both close
  function wireModalClose(modalEl, closeBtn){
    if(closeBtn) closeBtn.addEventListener('click', function(){ closeModal(modalEl); });
    if(modalEl) modalEl.addEventListener('click', function(e){
      if(e.target === modalEl) closeModal(modalEl);
    });
  }
  wireModalClose(modalIos, modalIosClose);
  wireModalClose(modalAndroid, modalAndroidClose);
  // ESC key closes any open modal
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){
      if(modalIos && modalIos.classList.contains('show')) closeModal(modalIos);
      if(modalAndroid && modalAndroid.classList.contains('show')) closeModal(modalAndroid);
    }
  });
  if(closeBtn) closeBtn.addEventListener('click', function(){ dismissHint(true); });
  // ANDROID (Chrome/Edge): capture beforeinstallprompt for native one-tap install
  var deferredPrompt = null;
  var androidUseNative = false;
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    deferredPrompt = e;
    androidUseNative = true;
    if(hintTitle) hintTitle.textContent = 'Install AGSIST as an app';
    if(hintText) hintText.textContent = 'Opens from your home screen like an app. No Play Store needed.';
    if(installBtn) installBtn.textContent = 'Install';
  });
  // Install button click — branches by platform
  if(installBtn){
    installBtn.addEventListener('click', function(){
      if(window.gtag) try{ window.gtag('event','pwa_install_click',{event_category:'engagement'}); }catch(e){}
      if(isAndroid && androidUseNative && deferredPrompt){
        // Native install dialog
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function(choice){
          if(window.gtag) try{ window.gtag('event','pwa_install_choice',{event_category:'engagement',event_label:choice && choice.outcome}); }catch(e){}
          if(choice && choice.outcome === 'accepted') dismissHint(true);
          deferredPrompt = null;
        });
      } else if(isIOS){
        // iOS — show visual instructions modal
        openModal(modalIos);
      } else if(isAndroid){
        // Android without beforeinstallprompt — show manual instructions
        openModal(modalAndroid);
      }
    });
  }
  // Show the banner after a delay
  var bannerDelay = dailyDismissed ? 5000 : 14000;
  setTimeout(showHint, bannerDelay);
  // If installed mid-session, hide silently
  window.addEventListener('appinstalled', function(){
    dismissHint(false);
    if(window.gtag) try{ window.gtag('event','pwa_installed',{event_category:'engagement'}); }catch(e){}
  });
})();
} catch (e) { blockFailed(e); }

/* ---- former inline block 11 ---- */
try {
/* The fold. One button, no dependencies, and it degrades to "everything is
   already open" if the script never runs -- the class is what hides things. */
(function(){
  var hero=document.getElementById('daily-hero'); if(!hero) return;
  var btn=hero.querySelector('[data-daily-more]'); if(!btn) return;
  btn.addEventListener('click',function(){
    hero.classList.remove('is-brief');
    btn.setAttribute('aria-expanded','true');
    var s=hero.querySelector('.daily-sections');
    if(s){s.scrollIntoView({block:'start',behavior:'smooth'});if(!s.hasAttribute('tabindex'))s.setAttribute('tabindex','-1');try{s.focus({preventScroll:true});}catch(e){}}
    if(window.gaEvent) gaEvent('daily_expand',{});
  });
})();
} catch (e) { blockFailed(e); }

/* ---- former inline block 12 ---- */
try {
/* ===== 2026-10-01 r7-prices: ledger rows, ticker labels, key-tile wording, prediction markets ===== */
(function(){
'use strict';
var MON={jan:'Jan',feb:'Feb',mar:'Mar',apr:'Apr',may:'May',jun:'Jun',jul:'Jul',aug:'Aug',sep:'Sep',oct:'Oct',nov:'Nov',dec:'Dec'};
/* g: price in cents per bu; bp: change in basis points; nod: no dollar sign. */
var CFG={wheat:{g:1},oats:{g:1},meal:{},cattle:{tk:1},feeders:{tk:1},hogs:{tk:1},milk:{},crude:{},natgas:{},
  dollar:{nod:1,cm:'Spot'},treasury10:{bp:1,pctSfx:1,cm:'Spot'},gold:{},silver:{},
  /* WAVE1-C 2026-10-03. own: geo.js has no PRICE_MAP entry for these, so
     this script writes their price and ticker cells itself. cl: cents per
     pound (cotton). */
  kcwheat:{g:1,own:1},mplswheat:{g:1,own:1},cotton:{cl:1,own:1},rice:{own:1}};
var TICK={corn:'Corn',beans:'Soybeans',wheat:'Chicago SRW wheat',kcwheat:'KC HRW wheat',mplswheat:'MGEX HRS wheat',oats:'Oats',cotton:'Cotton',rice:'Rough rice',cattle:'Live cattle',feeders:'Feeder cattle',hogs:'Lean hogs',milk:'Class III milk',meal:'Soybean meal'};
/* WAVE1-C: the whole prices.json, for the keys geo.js does not hand over
   (absent quotes, withheld_keys, spreads). Null until it loads. */
var D=null;
/* Why a row has no quote, in words, when the file says nothing more. */
var NOQ={mplswheat:'No quote: our price source does not carry this contract',
  cotton:'No quote yet: first price run pending',rice:'No quote yet: first price run pending',
  kcwheat:'Not in this price run'};
var Q={},NB={},have=false,timer=null;
function qa(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));}
function setT(el,t){if(el&&el.textContent!==t)el.textContent=t;}
function cmKey(k){var m=/-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(\d\d)$/.exec(k||'');return m?MON[m[1]]+" '"+m[2]:null;}
/* The contract month of the quote on the page, from the file only: the
   nearby label, else the dated contract the continuous series was repaired
   from, else the one dated contract whose close, previous close and change
   all equal it. No match: "Front month". */
/* agecon 8 (2026-10-12): the rows this script prices itself (KC, MGEX,
   cotton, rice) show the earliest dated contract on file, its price, change,
   range and month together. The continuous series (KE=F) is often a few
   ticks off every dated contract, which left the row saying "Front month"
   next to a spread figured on Dec '26. */
var MI={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
function frontKey(k){
  if(!D||!D.quotes||!(CFG[k]&&CFG[k].own))return null;var best=null,bt=Infinity;
  Object.keys(D.quotes).forEach(function(x){
    var m=/-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(\d\d)$/.exec(x),y=D.quotes[x];
    if(!m||x.indexOf(k+'-')!==0||x.length!==k.length+6||!y||y.close==null||y.stale===true)return;
    var t=+m[2]*12+MI[m[1]];if(t<bt){bt=t;best=x;}
  });
  return best;
}
function ownQ(k){var fk=frontKey(k);return fk?D.quotes[fk]:(Q[k]||(D&&D.quotes?D.quotes[k]:null));}
function source(k){
  var fk=frontKey(k);if(fk)return{label:cmKey(fk),rq:D.quotes[fk]};
  var q=Q[k];if(!q)return null;
  function dated(lb){var d=null;Object.keys(Q).some(function(x){if(x.indexOf(k+'-')===0&&cmKey(x)===lb&&Q[x]){d=x;return true;}return false;});return d;}
  if(NB[k]&&NB[k]!=='nearby'&&NB[k]!=='most-active'){var d0=dated(NB[k]);return{label:NB[k],rq:d0?Q[d0]:q};}
  if(q.repaired_from&&Q[q.repaired_from]&&cmKey(q.repaired_from))return{label:cmKey(q.repaired_from),rq:Q[q.repaired_from]};
  var labs={};
  Object.keys(Q).forEach(function(x){
    if(x.indexOf(k+'-')!==0)return;var lb=cmKey(x);if(!lb)return;var y=Q[x];
    if(y&&y.close===q.close&&y.open===q.open&&y.netChange===q.netChange)labs[lb]=x;
  });
  var ks=Object.keys(labs);
  return ks.length===1?{label:ks[0],rq:Q[labs[ks[0]]]}:{label:null,rq:q};
}
/* The contract month of the quote on the page, from the file only: the
   nearby label, else the dated contract the continuous series was repaired
   from, else the one dated contract whose close, previous close and change
   all equal it. No match: the row says "Continuous". The 52-week range is
   taken from that same dated contract, never from the continuous series. */
function contractMonth(k){var s=source(k);return s?s.label:null;}
function bySym(sym){var hit=null,any=null;Object.keys(Q).forEach(function(x){var y=Q[x];if(!y||y.ticker!==sym)return;if(!any)any=y;if(!hit&&cmKey(x))hit=y;});return hit||any;}
function cmByTicker(q){if(!q||!q.ticker)return null;var r=null;Object.keys(Q).some(function(x){var lb=cmKey(x);if(lb&&Q[x]&&Q[x].ticker===q.ticker){r=lb;return true;}return false;});return r;}
/* Grains trade in quarter cents. Printing $4.99 for 498.5 made the prev
   close and the change disagree; this prints $4.98 1/2. */
function qc(c){return AG.px.price(c,{style:'slash'});}
/* What an older geo.js wrote (cent-rounded) or the current one writes (the
   same quarter text with no small span): either way, dress it with setQ. */
function r2(c){return '$'+(c/100).toFixed(2);}
function plainQ(el,c){var t=el&&el.textContent;return !!el&&(t===r2(c)||(t===qc(c)&&t.indexOf('/')>0&&!el.querySelector('.r7-frac')));}
/* Writes the quarter as a smaller trailing span; textContent stays "$12.83 1/4". */
function setQ(el,c){var t=qc(c);if(!el||(el.textContent===t&&(t.indexOf('/')<0||el.querySelector('.r7-frac'))))return;var m=/^(\$[\d.]+)( \d\/\d)?$/.exec(t);el.textContent=m[1];if(m[2]){var sp=document.createElement('span');sp.className='r7-frac';sp.textContent=m[2];el.appendChild(sp);}}
function cents(a){return AG.px.move(a,{style:'slash'});}
function chg(k,q){
  var n=q.netChange;if(n==null||isNaN(+n))return null;n=+n;
  if(n===0)return{t:'unch',c:'nc',p:''};
  var c=CFG[k],s=n>0?'+':'\u2212',a=Math.abs(n),t;
  if(c.g)t=s+cents(a);
  else if(c.cl)t=s+a.toFixed(2)+'\u00a2';
  else if(c.bp){var b=a*100;t=s+(b<1?b.toFixed(1):String(Math.round(b)))+(Math.round(b)===1&&b>=1?' basis point':' basis points');}
  else if(c.nod)t=s+a.toFixed(2);
  else if(c.tk)t=s+'$'+AG.px.cash(a,{dollar:false});   /* livestock to the tick: +$0.25, +$1.625 */
  else t=s+'$'+a.toFixed(2);
  var p='',pc=+q.pctChange;
  if(!c.bp&&!isNaN(pc)&&q.pctChange!=null)p=AG.px.pct(pc,{dp:Math.abs(pc)<0.05?2:1});
  return{t:t,c:n>0?'up':'dn',p:p};
}
function rangeFmt(k,v,dir){
  /* Grains: the site formatter, low down and high up to the quarter, so a
     traded quarter prints exactly (Nov '26 high 1335.25 is $13.35 1/4) and
     an off-quarter end is never moved inside the range. */
  var c=CFG[k];if(c.g)return AG.px.price(v*100,{style:'slash',mode:dir<0?'down':'up'});
  if(c.cl)return v.toFixed(2)+'\u00a2';
  if(c.tk)return AG.px.cash(v);   /* livestock ends as traded: $375.575 */
  var d=(c.nod||c.bp)?2:(v>=1000?0:2);
  var s=Number(v.toFixed(d)).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
  return c.bp?s+'%':c.nod?s:'$'+s;
}
/* WAVE1-C: own-key price text, and the em dash with its reason. */
function ownPrice(k,q){var c=CFG[k];return c.g?null:c.cl?(+q.close).toFixed(2)+'\u00a2':'$'+(+q.close).toFixed(2);}
function whyNone(k){var w=D&&D.withheld_keys&&D.withheld_keys[k];return w?'Held back: '+w:(NOQ[k]||'No quote on file');}
function renderMissing(row,k){
  var why=whyNone(k),pp=row.querySelector('.pc-price');
  setT(pp,'-');setT(row.querySelector('.r7-cm'),/^Held back/.test(why)?'Held back, unit not confirmed':why);
  row.title=why;qa('.r7-chg,.r7-pct,.r7-lo,.r7-hi',row).forEach(function(e){setT(e,'');});
}
/* KC HRW and MGEX HRS against Chicago SRW, from prices.json `spreads`
   (computed by fetch_prices.py class_spreads). Cents per bushel. */
function spreadTxt(k,rowMon){
  var sp=D&&D.spreads&&D.spreads[k];if(!sp||sp.cents==null)return '';
  var v=+sp.cents,t=v===0?'even with':(v>0?'+':'\u2212')+cents(Math.abs(v))+' vs';
  if(sp.basis==='same-month')return t+' Chicago'+(sp.month&&sp.month!==rowMon?' '+sp.month:'');
  return t+' Chicago, both most active';
}
/* WAVE3-L: does the price file carry a quote for this key at all. Null
   until the file has loaded, so nothing hides before we know. */
function quoted(k){if(!D||!D.quotes)return null;var x=D.quotes[k]||D.quotes[k+'-nearby']||Q[k];if(!(x&&x.close!=null))x=ownQ(k);return !!(x&&x.close!=null);}
/* WAVE3-L: a row with no quote is hidden, and the hidden rows are named
   once under their table, so the gap is still said. */
function noQuoteNote(){
  qa('#f-prices .r7-led').forEach(function(led){
    var off=qa('.r7-row.r7-noq',led).map(function(r){var n=r.querySelector('.r7-n');return n?n.textContent:'';}).filter(Boolean);
    var nt=led.nextElementSibling&&led.nextElementSibling.classList.contains('r7-noq-note')?led.nextElementSibling:null;
    if(!off.length){if(nt)nt.parentNode.removeChild(nt);return;}
    if(!nt){nt=document.createElement('p');nt.className='r7-noq-note';led.parentNode.insertBefore(nt,led.nextSibling);}
    setT(nt,'No quote on file, not shown: '+off.join(', ')+'.');
  });
}
/* P3 2026-10-19: a row whose price is from another day or another kind
   than the badge over the ticker (the corn front month) says so: crude,
   natural gas and the metals are last trades, the dollar and the 10-year
   carry their own date. A quote this run did not refresh says that too.
   '' when the row matches the badge. */
var MN3=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function md(iso){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(iso||'');return m?MN3[+m[2]-1]+' '+(+m[3]):'';}
function dtNote(k,q){
  if(!D||!D.quotes||!q||q.close==null)return '';
  var B=D.quotes['corn-nearby']||D.quotes.corn;if(!B)return '';
  var stale=q.stale===true||(D.stale_keys||[]).indexOf(k)>-1;
  var qd=q.settle_date&&q.close_kind==='settle'?q.settle_date:q.close_date,bd=B.settle_date&&B.close_kind==='settle'?B.settle_date:B.close_date;
  if(!stale&&(q.close_kind||null)===(B.close_kind||null)&&qd===bd)return '';
  var dl=md(qd),t=q.close_kind==='settle'?(dl?dl+' settle':'Settle'):q.close_kind==='last'?'Last trade'+(dl?' '+dl:''):(dl?'As of '+dl:'');
  if(stale)t+=(t?', ':'')+'not updated this run';
  return t;
}
function setDt(host,cls,t,before){
  if(!host)return false;var e=host.querySelector('.'+cls);
  if(!t){if(e){e.parentNode.removeChild(e);return true;}return false;}
  if(!e){e=document.createElement('span');e.className=cls;if(before&&before.parentNode===host)host.insertBefore(e,before);else host.appendChild(e);}
  if(e.textContent!==t){e.textContent=t;return true;}return false;
}
function renderRow(row){
  var k=row.getAttribute('data-r7k'),c=CFG[k],q=c&&c.own&&D?ownQ(k):Q[k];
  var hasQ=quoted(k);if(hasQ!==null)row.classList.toggle('r7-noq',!hasQ);
  if(c&&c.own&&D&&(!q||q.close==null)){renderMissing(row,k);return;}
  if(!q||!c||q.close==null)return;
  if(c.own){row.removeAttribute('title');var pp0=row.querySelector('.pc-price');if(c.g)setQ(pp0,q.close);else setT(pp0,ownPrice(k,q));}
  var src=source(k)||{label:null,rq:q},rq=c.cm?q:src.rq;
  var st=spreadTxt(k,c.cm||src.label);
  setT(row.querySelector('.r7-cm'),(c.cm||src.label||'Front month')+(st?' \u00b7 '+st:''));
  setDt(row.querySelector('.r7-nm'),'r7-dt',dtNote(k,c.own&&D?q:((D&&D.quotes&&D.quotes[k])||q)));
  if(c.g){var pp=row.querySelector('.pc-price');if(plainQ(pp,q.close))setQ(pp,q.close);}
  var ch=chg(k,q),ce=row.querySelector('.r7-chg'),pe=row.querySelector('.r7-pct');
  if(ch){setT(ce,ch.t);ce.className='r7-chg '+ch.c;setT(pe,ch.p);pe.className='r7-pct '+ch.c;}
  var lo=rq.wk52_lo,hi=rq.wk52_hi,cl=q.close,rg=row.querySelector('.r7-rg');
  if(lo==null||hi==null||!(hi>lo)){qa('.r7-lo,.r7-hi',rg).forEach(function(e){setT(e,'');});return;}
  if(c.g){lo/=100;hi/=100;cl/=100;}
  /* A close above the 52-week high on file IS the new high (the dollar
     index printed 102.02 inside a 95.55-101.80 bar). Same for a new low. */
  var raised=cl>hi,lowered=cl<lo;if(raised)hi=cl;if(lowered)lo=cl;
  var pct=Math.max(0,Math.min(100,(cl-lo)/(hi-lo)*100));
  var loT=rangeFmt(k,lo,-1),hiT=rangeFmt(k,hi,1);
  setT(rg.querySelector('.r7-lo'),loT);setT(rg.querySelector('.r7-hi'),hiT);
  var dot=rg.querySelector('.r7-dot');if(dot)dot.style.left=pct.toFixed(1)+'%';
  /* q.close is the last traded price, which is not a close until the session
     ends. Say "last price" so the tooltip is true at 10am and at 3pm. */
  rg.setAttribute('aria-label','52-week range '+loT+' to '+hiT+(raised?', high is the last price':lowered?', low is the last price':''));
  if(raised||lowered)rg.title='The last price is '+(raised?'above the 52-week high':'below the 52-week low')+' on file, so the '+(raised?'high':'low')+' shown is the last price.';else rg.removeAttribute('title');
}
function renderTicker(){
  var ch=false;
  /* WAVE1-C: price and change for the keys geo.js does not write. */
  Object.keys(CFG).forEach(function(k){
    var c=CFG[k];if(!c.own||!D)return;var q=ownQ(k),has=q&&q.close!=null;
    var pt=has?(c.g?qc(q.close):ownPrice(k,q)):'-',cg=has?chg(k,q):{t:'no quote',c:'nc'};
    qa('.prices-strip [data-sym="'+k+'"]').forEach(function(it){
      var pe=it.querySelector('.t-price'),ce=it.querySelector('.t-chg');
      if(pe&&pe.textContent!==pt){pe.textContent=pt;ch=true;}
      if(ce&&cg){var tx=(cg.c==='up'?'\u25b2 ':cg.c==='dn'?'\u25bc ':'')+cg.t+(cg.p?' \u00b7 '+cg.p:'');if(ce.textContent!==tx){ce.textContent=tx;ce.className='t-chg '+cg.c;ch=true;}}
      if(has)it.removeAttribute('title');else it.title=whyNone(k);
    });
  });
  Object.keys(TICK).forEach(function(k){
    if(!Q[k]&&!(CFG[k]&&CFG[k].own&&D&&D.quotes&&D.quotes[k]))return;if(!Q[k])Q[k]=D.quotes[k];var lb=TICK[k]+' '+(contractMonth(k)||'front month');
    qa('.prices-strip [data-sym="'+k+'"] .t-label').forEach(function(e){if(e.textContent!==lb){e.textContent=lb;ch=true;}});
  });
  [['corn-dec','Corn deferred','Corn '],['beans-nov','Soybeans deferred','Soybeans ']].forEach(function(d){
    var lb=cmByTicker(Q[d[0]]);if(!lb)return;
    qa('.prices-strip [data-sym="'+d[0]+'"] .t-label').forEach(function(e){if(e.textContent===d[1]){e.textContent=d[2]+lb;ch=true;}});
  });
  /* P3: the date note on a ticker tile that differs from the badge */
  if(D&&D.quotes)qa('.prices-strip .t-item[data-sym]').forEach(function(it){
    var k=it.getAttribute('data-sym'),q=(CFG[k]&&CFG[k].own)?ownQ(k):(D.quotes[k]||Q[k]);
    if(setDt(it,'t-dt',dtNote(k,q),it.querySelector('.t-chg')))ch=true;
  });
  /* WAVE3-L: a ticker tile with no quote is skipped, not shown as a dash. */
  qa('.prices-strip .t-item[data-sym]').forEach(function(it){var h=quoted(it.getAttribute('data-sym'));if(h===null)return;
    if(it.classList.contains('t-noq')===h){it.classList.toggle('t-noq',!h);ch=true;}});
  if(ch&&typeof window.rebuildTickerLoop==='function')window.rebuildTickerLoop();
}
function deferredChips(){
  [['pcp-corn-dec','corn-dec'],['pcp-bean-nov','beans-nov']].forEach(function(p){
    var el=document.getElementById(p[0]),card=el&&el.closest?el.closest('.pc'):null,chip=card?card.querySelector('.pc-contract'):null;
    if(chip&&!chip.textContent.trim()){var lb=cmByTicker(Q[p[1]]);if(lb)chip.textContent=lb;}
  });
}
function renderAll(){qa('#f-prices .r7-row[data-r7k]').forEach(renderRow);noQuoteNote();renderTicker();deferredChips();dress();}
function schedule(){clearTimeout(timer);timer=setTimeout(renderAll,80);}
/* Reader wording on the four key tiles and the ticker, applied after any
   writer. Every rewrite is idempotent, so the observers settle. */
var busy=false,GRAIN_T={corn:'-',beans:'-',wheat:'-',oats:'-','corn-dec':'corn-dec27','beans-nov':'beans-nov27'};
function fixTick(t){
  var m=/^([\u25b2\u25bc]?)\s*([^\u00b7+\u2212\s][^\u00b7]*?) \u00b7 ([\d.]+)%$/.exec(t);if(!m)return t;
  if(!m[1])return parseFloat(m[2])===0?'unch':t;
  var s=m[1]==='\u25b2'?'+':'\u2212';return m[1]+' '+s+m[2]+' \u00b7 '+s+m[3]+'%';
}
function dress(){
  if(busy)return;busy=true;
  try{
    qa('.prices-strip .t-chg').forEach(function(e){setT(e,fixTick(e.textContent));});
    qa('#f-prices .price-cards-grid .pc-contract').forEach(function(e){
      setT(e,e.textContent.replace(/ \u00b7 nearby( \+ new crop)?$/,' \u00b7 front month$1').replace(/^most-active$/,'Most active').replace(/^Front Month$/,'Front month'));
    });
    qa('#f-prices .price-cards-grid .pc').forEach(function(card){
      var pv=card.querySelector('.pc-prev'),pr=card.querySelector('.pc-price');if(!pv)return;
      var m=/^prev: (\S+(?: \d\/\d)?)(?: (\S+))?$/.exec(pv.textContent),q=null;
      if(m){
        q=m[2]?bySym(m[2]):null;
        if(q&&q.open!=null){setT(pv,'Prev close '+qc(q.open));pv.setAttribute('data-r7sym',m[2]);}
        else if(have){setT(pv,'Prev close '+m[1]);pv.removeAttribute('data-r7sym');}
      }else{var sy=pv.getAttribute('data-r7sym');q=sy?bySym(sy):null;}
      if(q&&pr&&q.close!=null&&plainQ(pr,q.close))setQ(pr,q.close);
      if(q&&q.wk52_lo!=null&&q.wk52_hi!=null){var ls=card.querySelectorAll('.pc-range-labels>span');if(ls.length>=3&&ls[0].textContent){var rg=AG.px.range(q.wk52_lo,q.wk52_hi,{style:'slash'});setT(ls[0],rg.lo);setT(ls[2],rg.hi);}}
    });
    qa('.prices-strip .t-item[data-sym]').forEach(function(it){
      var k=it.getAttribute('data-sym');if(!GRAIN_T[k])return;
      var pe=it.querySelector('.t-price');if(!pe)return;
      [Q[k],Q[GRAIN_T[k]]].some(function(q){if(q&&q.close!=null&&plainQ(pe,q.close)){setQ(pe,q.close);return true;}return false;});
    });
    qa('#f-prices .price-cards-grid .pc-chg-val').forEach(function(e){if(/^0/.test(e.textContent))setT(e,'unch');});
  }finally{busy=false;}
}
function hook(){
  if(window.__r7PriceHook||typeof window.applyPriceResult!=='function')return;
  var o=window.applyPriceResult;
  window.applyPriceResult=function(k,q){
    var r=o.apply(this,arguments);
    if(q&&typeof q==='object'){Q[k]=q;have=true;if(window.AGSIST_NEARBY)NB=window.AGSIST_NEARBY;schedule();}
    return r;
  };
  window.__r7PriceHook=true;
}
/* WAVE1-C: the whole file, once, shared with the other page scripts. */
function loadD(){
  var p=window.__agsistPricesP||(window.__agsistPricesP=AG.json('/data/prices.json').catch(function(){return null;}));
  p.then(function(d){if(d&&d.quotes){if(window.AgPxStamp&&AgPxStamp.roll)d.quotes=AgPxStamp.roll(d.quotes);D=d;schedule();}});
}
function fallback(){
  AG.json('/data/prices.json').then(function(d){
    if(!d||have)return;var q=d.quotes||{};if(window.AgPxStamp&&AgPxStamp.roll)q=AgPxStamp.roll(q);
    ['corn','beans','wheat','cattle'].forEach(function(c){var nb=q[c+'-nearby'];if(nb&&nb.close!=null)q[c]=nb;if(d.nearby&&d.nearby[c]&&d.nearby[c].label)NB[c]=d.nearby[c].label;});
    Q=q;have=true;renderAll();
  }).catch(function(){});
}
function observe(){
  if(typeof MutationObserver!=='function')return;
  var mo=new MutationObserver(function(){if(!busy)dress();});
  qa('.prices-strip,#f-prices .price-cards-grid').forEach(function(el){mo.observe(el,{childList:true,characterData:true,subtree:true});});
}
/* Prediction markets: ag-linked only. Fed and crude odds are not ag, and a
   politician named Cotton is not cotton. No market links. */
var AG_WORDS=/\b(corn|soybeans?|wheat|cattle|hogs?|pork|beef|dairy|milk|fertili[sz]ers?|urea|usda|wasde|ethanol|biofuels?|crops?|harvest|bushels?|farm bill|grains?|egg prices|bird flu|avian)\b/i;
var NOT_AG=/\b(nominat\w*|elections?|president\w*|senat\w*|governor|primary|mayor|congress\w*)\b/i;
function fmtCT(iso,withTime){var d=new Date(iso);if(isNaN(d.getTime()))return null;var o={timeZone:'America/Chicago',month:'short',day:'numeric',year:'numeric'};if(withTime){o.hour='numeric';o.minute='2-digit';}return d.toLocaleString('en-US',o)+(withTime?' CT':'');}
function odds(){
  var fold=document.querySelector('.m-fold--kalshi'),box=document.getElementById('f-kalshi');if(!fold||!box)return;
  AG.json('/data/markets.json').then(function(d){
    if(!d)return;
    var ag=(d.markets||[]).filter(function(m){var t=String(m.title||'');return m.yes!=null&&AG_WORDS.test(t)&&!NOT_AG.test(t);});
    if(!ag.length)return;
    var got=fmtCT(d.fetched,true);
    var h='<p class="r7-odds-lbl">Third-party market odds, not a recommendation.</p>';
    ag.forEach(function(m){
      var cl=fmtCT(m.close_time,false),meta=[String(m.platform||'Source not named')];
      if(got)meta.push('fetched '+got);if(cl)meta.push('closes '+cl);
      var div=document.createElement('div');div.textContent=String(m.title);
      var t=div.innerHTML;div.textContent=meta.join(' \u00b7 ');
      h+='<div class="r7-odds-row"><span class="r7-odds-t">'+t+'</span><span class="r7-odds-p">Yes '+Math.round(+m.yes)+'%</span><span class="r7-odds-m">'+div.innerHTML+'</span></div>';
    });
    var w=document.getElementById('r7-odds');if(!w){w=document.createElement('div');w.id='r7-odds';var sh=box.querySelector('.sec-head');if(sh&&sh.nextSibling)box.insertBefore(w,sh.nextSibling);else box.appendChild(w);}
    w.innerHTML=h;
    var h2=box.querySelector('.sec-title');if(h2&&h2.lastChild&&h2.lastChild.nodeType===3)h2.lastChild.nodeValue='Prediction markets';
    var sm=fold.querySelector('summary span');if(sm)sm.textContent='Prediction markets';
    fold.classList.add('r7-ag');
  }).catch(function(){});
}
function boot(){
  hook();observe();dress();odds();loadD();
  /* WAVE3-L: the board script retried prices.json and got it. */
  window.addEventListener('agsist:prices',function(e){var d=e&&e.detail;if(d&&d.quotes){D=d;schedule();}});
  setTimeout(function(){if(!have)fallback();},2500);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
} catch (e) { blockFailed(e); }

/* ---- former inline block 13 ---- */
try {
/* ===== 2026-10-01 r7-bids: rail and footer, read from the page's own data files ===== */
(function(){
  'use strict';
  function $(i){return document.getElementById(i);}
  function get(u){return AG.json(u).catch(function(){return null;});}
  function pricesOnce(){
    if(!window.__agsistPricesP){window.__agsistPricesP=get('/data/prices.json');}
    return window.__agsistPricesP;
  }
  var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var CODE={F:0,G:1,H:2,J:3,K:4,M:5,N:6,Q:7,U:8,V:9,X:10,Z:11};
  /* "ZCZ26.CBT" -> "Dec '26". A continuous ticker (ZC=F) names no month. */
  function tickMonth(t){var m=/^[A-Z]{2,3}([FGHJKMNQUVXZ])(\d{2})\./.exec(String(t||''));return m?MON[CODE[m[1]]]+" '"+m[2]:'';}
  /* The contract a continuous or alias quote is today: the dated contract in
     the same file carrying the identical close, open and change, or the
     repair note the price pipeline writes. Empty when neither says. */
  function contractOf(q,key){
    var x=q[key];if(!x)return '';
    var own=tickMonth(x.ticker);if(own)return own;
    if(x.contract)return x.contract;
    if(x.repaired_from&&q[x.repaired_from])return tickMonth(q[x.repaired_from].ticker);
    var hit='';
    Object.keys(q).forEach(function(k){var y=q[k];if(hit||!y||k===key||!/-[a-z]{3}\d{2}$/.test(k))return;
      if(k.split('-')[0]!==key.split('-')[0])return;
      if(y.close===x.close&&y.open===x.open&&y.netChange===x.netChange)hit=tickMonth(y.ticker);});
    return hit;
  }
  function ctStamp(iso){var d=new Date(iso);if(!iso||isNaN(d))return '';
    try{return d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Chicago'})+' CT';}catch(e){return '';}}
  /* 34.75 cents -> "34 3/4" (the ticker's own way of writing eighths of a cent). */
  function cents(c){return AG.px.move(c,{style:'slash',cent:false});}
  var MINUS='−';
  window.__r7={pricesOnce:pricesOnce,contractOf:contractOf,ctStamp:ctStamp,cents:cents,tickMonth:tickMonth};

  /* COT: what price did since the positions were taken. cot.json's `price` is
     the Tuesday close of the front-month continuous series (ZC=F and so on,
     scripts/enrich_cot_prices.py); the comparison is that same ticker's
     latest close in data/prices.json, so both ends are one series. If the
     tickers do not match, nothing is printed. */
  var COTMAP=[['corn','corn','corn','ZC=F','c'],['beans','beans','beans','ZS=F','c'],['wheat','wheat','wheat','ZW=F','c'],['cattle','livecattle','cattle','LE=F','cwt'],
    /* WAVE1-C: the added COT rows, same rule (cot.json price and prices.json
       close must be the same ticker or nothing prints). */
    ['kcwheat','kcwheat','kcwheat','KE=F','c'],['meal','soymeal','meal','ZM=F','ton'],['feeders','feedercattle','feeders','GF=F','cwt'],['hogs','leanhogs','hogs','HE=F','cwt'],['milk','milk','milk','DC=F','cwt']];
  Promise.all([get('/data/cot.json'),pricesOnce()]).then(function(R){
    var cot=R[0],pd=R[1];if(!cot||!pd||!pd.quotes)return;
    var q=pd.quotes,rd=new Date(cot.report_date);if(isNaN(rd))return;
    var rds=MON[rd.getMonth()]+' '+rd.getDate();
    if(window.AGSIST_COT&&!document.getElementById('cot-more'))window.AGSIST_COT.render();
    COTMAP.forEach(function(m){
      var row=document.querySelector('#cot-widget .cot-row-'+m[0]);var c=cot[m[1]],x=q[m[2]];
      if(!row||!c||c.price==null||!x||x.close==null||x.ticker!==m[3])return;
      var d=x.close-c.price,mon=contractOf(q,m[2]);
      var txt=m[4]==='c'?(d===0?'unchanged':(d>0?'+':MINUS)+cents(d)+'¢ per bu'):(Math.abs(d)<0.005?'unchanged':(d>0?'+':MINUS)+'$'+Math.abs(d).toFixed(2)+' per '+m[4]);
      var el=row.querySelector('.r7-cot-px');if(!el){el=document.createElement('div');el.className='r7-cot-px';row.appendChild(el);}
      /* WAVE3-L: cot.json carries no dated contract, so both ends are the
         continuous front month and the span can cross a roll. Every row says
         so the same way. */
      el.innerHTML='Since '+rds+': <span class="'+(d>0?'r7-up':d<0?'r7-dn':'')+'">'+txt+'</span><span class="r7-dim">, front month'+(mon?' ('+mon.replace(/ /g,'\u00a0')+')':'')+'</span>';
    });
  });

  /* Price alert: name the contract on every option, and an example target
     that today's price has not already crossed. */
  var BASE={'corn':'Corn, front month','corn-dec':'Corn','beans':'Soybeans, front month','beans-nov':'Soybeans','wheat':'Chicago SRW wheat, front month','cattle':'Live cattle, front month'};
  window.__r7paLabel=function(v){var o=document.querySelector('#pa-symbol option[value="'+v+'"]');return o?(o.getAttribute('data-short')||o.textContent):v;};
  pricesOnce().then(function(pd){
    var sel=$('pa-symbol'),dir=$('pa-direction'),tgt=$('pa-target'),now=$('r7-pa-now');if(!sel||!pd||!pd.quotes)return;
    /* 2026-10-17: an expired month (Dec '26 after its last trade) rolls to the next live one, the
       price-local.js roll every futures page uses; and the line is stamped with the quote's own
       settle or trade time, not the time the file was read (it said Oct 17, 1:46 AM beside an Oct 16 settle). */
    var PS=window.AgPxStamp,q=(PS&&PS.roll)?PS.roll(pd.quotes):pd.quotes;
    function stampOf(x){return (PS&&PS.stamp)?PS.stamp(x,pd.fetched):ctStamp(pd.fetched);}
    /* 7b: a front-month option that is the same contract as a dated one is
       a duplicate; the dated one stays, because it does not roll. */
    [['corn','corn-dec'],['beans','beans-nov']].forEach(function(pr){var a=contractOf(q,pr[0]),b=contractOf(q,pr[1]);
      if(a&&a===b){var o=sel.querySelector('option[value="'+pr[0]+'"]');if(o){if(sel.value===pr[0])sel.value=pr[1];o.parentNode.removeChild(o);}}});
    Array.prototype.forEach.call(sel.options,function(o){var k=o.value,mon=contractOf(q,k);if(!mon||!BASE[k])return;
      var dated=/-[a-z]{3}$/.test(k);
      o.textContent=dated?BASE[k]+' '+mon:BASE[k]+' (now '+mon+', follows the roll)';
      o.setAttribute('data-short',dated?BASE[k]+' '+mon:BASE[k]);});
    function ex(){var x=q[sel.value];
      if(!x||x.close==null){tgt.placeholder='Target';if(now)now.textContent='';return;}
      var p=x.close/(sel.value==='cattle'?1:100),step=sel.value==='cattle'?5:0.25;
      var t=dir.value==='above'?Math.floor(p/step+1)*step:Math.ceil(p/step-1)*step;
      tgt.placeholder=t.toFixed(2);
      /* Grains trade in quarter cents: $5.08\u00bd, not $5.08 (toFixed dropped the half). */
      var nowTxt=sel.value==='cattle'?'$'+p.toFixed(2):AG.px.price(x.close);
      if(now){var mon=contractOf(q,sel.value);var stamp=stampOf(x);now.textContent='Now '+nowTxt+(mon?', '+mon:'')+(stamp?' · '+stamp:'');}}
    sel.addEventListener('change',ex);dir.addEventListener('change',ex);ex();
  });

})();
} catch (e) { blockFailed(e); }

/* ---- former inline block 14 ---- */
try {
/* 2026-10-06 (U13): September to November, a phone folds the GDU and soil
   tiles in Local conditions behind one button. Nothing is removed; the
   button opens them in place. Wider screens show them as before. */
(function(){
  var b=document.getElementById('wx-fold-btn'),root=document.documentElement;if(!b)return;
  var m;try{m=+new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'numeric'}).format(new Date());}catch(e){m=new Date().getMonth()+1;}
  if(m<9||m>11){b.hidden=true;return;}
  root.classList.add('wx-fold-season');
  function word(){b.textContent=root.classList.contains('s7-no-gdu')?'Soil temperature':'Growing degree days and soil temperature';}
  /* home-season.js (deferred) sets s7-no-gdu; DOMContentLoaded comes after it runs. */
  word();setTimeout(word,0);document.addEventListener('DOMContentLoaded',word);
  b.addEventListener('click',function(){var on=!root.classList.contains('wx-fold-open');root.classList.toggle('wx-fold-open',on);b.setAttribute('aria-expanded',on?'true':'false');});
})();
} catch (e) { blockFailed(e); }
/* ---- 2026-10-16: no location after a few seconds ----
   A reader who neither allows nor blocks the browser's location question
   used to sit on "Detecting your location..." and gray rows for the life of
   the page (geo.js only hears back on allow or deny). After NOLOC_MS with no
   saved ZIP and the skeleton still up, the cash bid card says so plainly,
   opens the ZIP box (geo.js's own fallback) and offers a state pick that
   shows that state's median basis from data/basis-states.json (AGSIST
   network elevators, scripts/basis_method.py). If a location lands later,
   geo.js and bids-homepage.js draw over all of it as usual. */
try {
(function(){
  var NOLOC_MS=6000;
  var AB={}; /* code -> state name, from basis-states.json itself */
  var CROP={corn:'Corn',soybeans:'Soybeans',wheat_srw:'SRW wheat',wheat_hrw:'HRW wheat',wheat_hrs:'Spring wheat'};
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function savedZip(){try{var l=JSON.parse(localStorage.getItem('agsist-wx-loc')||'null');return !!(l&&/^\d{5}$/.test(String(l.zip||'')));}catch(e){return false;}}
  function pickedCode(){
    try{var c=localStorage.getItem('agsist-pd-state');if(c&&AB[c])return c;
      var n=localStorage.getItem('agsist-rma-state');for(var k in AB){if(AB[k]===n)return k;}}catch(e){}
    return '';
  }
  function cents(m){var c=Math.round(m*10000)/100;return (window.AG&&AG.px&&AG.px.basis)?AG.px.basis(c):((c>0?'+':'−')+Math.abs(c)+'¢');}
  function day(iso){var d=new Date(iso);return isNaN(d)?'':d.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/Chicago'});}
  /* One state, as lines. Only crops with a median (basis-states.json prints
     one at min_n elevators or more); a thinner crop is counted, not priced. */
  window.__agsistNolocRows=function(doc,code){
    var s=doc&&doc.states&&doc.states[code];if(!s)return null;
    var rows=[],thin=[];
    Object.keys(CROP).forEach(function(k){
      var c=s.crops&&s.crops[k];if(!c)return;
      if(c.median==null){if(k==='corn'||k==='soybeans')thin.push(CROP[k]);return;}
      var wk='';
      if(c.wow!=null&&c.wow_n>=(doc.min_n||3)){var w=Math.round(c.wow*4)/4;wk=w===0?'no change on the week':(AG.px.basis(w)+' on the week');}
      rows.push({crop:CROP[k],basis:cents(c.median),contract:c.label||'',n:c.n,week:wk});
    });
    return {name:s.name,path:s.path||'',elevators:s.elevators,rows:rows,thin:thin};
  }
  function draw(box,doc,code){
    var out=box.querySelector('.hn-out');if(!out)return;
    if(!code){out.innerHTML='';return;}
    var r=window.__agsistNolocRows(doc,code);
    if(!r||!r.rows.length){out.innerHTML='<p class="hn-fine">Not enough fresh '+esc(AB[code])+' bids in the AGSIST network to print a state basis this week.'+(r&&r.path?' <a href="'+esc(r.path.replace(/#.*$/,''))+'">'+esc(r.name)+' bids</a>':'')+'</p>';return;}
    out.innerHTML='<ul class="hn-rows">'+r.rows.map(function(x){
      return '<li><span class="hn-crop">'+esc(x.crop)+'</span><span class="hn-b">'+esc(x.basis)+'</span><span class="hn-c">'+esc(x.contract)+'</span><span class="hn-n">'+x.n+' elevators'+(x.week?', '+esc(x.week):'')+'</span></li>';
    }).join('')+'</ul><p class="hn-fine">Median basis of AGSIST network elevators with a fresh bid, read '+esc(day(doc.generated))+'. Your elevator will differ.'+(r.thin.length?' Too few bids to print: '+esc(r.thin.join(', '))+'.':'')+' <a href="'+esc(r.path||'/basis')+'">All '+esc(r.name)+' bids</a></p>';
  }
  function fallback(){
    var area=document.getElementById('bids-list-area'),txt=document.getElementById('bids-geo-txt');
    if(!area||!area.querySelector('.bids-skeleton')||savedZip())return;
    if(txt&&!/Detecting/.test(txt.textContent||''))return;
    try{if(typeof window._signalBidsGeoFailed==='function')window._signalBidsGeoFailed();}catch(e){}
    try{var wl=document.getElementById('wx-loading');if(wl&&/Detecting/.test(wl.textContent||'')&&typeof window.showZipEntry==='function')window.showZipEntry();}catch(e){}
    area.innerHTML='<div class="hn" id="bids-noloc"><p class="hn-h">Your location did not come through.</p>'
      +'<p class="hn-p">Type your ZIP for the nearest elevators, or pick a state to see its basis now.</p>'
      +'<div class="hn-pick"><button type="button" class="hn-zip">Enter ZIP</button>'
      +'<label class="hn-sl"><span class="visually-hidden">State</span><select class="hn-sel" disabled><option value="">Pick a state</option></select></label></div>'
      +'<div class="hn-out" aria-live="polite"></div></div>';
    var box=area.querySelector('.hn'),sel=box.querySelector('.hn-sel'),doc=null;
    /* The page has one ZIP box, in the hero band (agsistOpenZip opens and
       focuses it); the in-card row only when the band is missing. */
    box.querySelector('.hn-zip').addEventListener('click',function(){
      if(typeof window.agsistOpenZip==='function'){window.agsistOpenZip();return;}
      var row=document.getElementById('bids-zip-row'),z=document.getElementById('bids-zip');
      if(row)row.style.display='block';if(z)z.focus();
    });
    sel.addEventListener('change',function(){
      var v=sel.value;
      try{if(v){localStorage.setItem('agsist-pd-state',v);localStorage.setItem('agsist-rma-state',AB[v]);}}catch(e){}
      if(window.gaEvent)try{gaEvent('noloc_state_pick',{state:v||'none'});}catch(e){}
      draw(box,doc,v);
    });
    AG.json('/data/basis-states.json').then(function(d){
      doc=d;var st=(d&&d.states)||{};
      Object.keys(st).forEach(function(k){if(st[k]&&st[k].name)AB[k]=st[k].name;});
      var ks=Object.keys(AB).sort(function(a,b){return AB[a]<AB[b]?-1:1;});
      if(!ks.length)throw new Error('no states');
      sel.innerHTML='<option value="">Pick a state</option>'+ks.map(function(k){return '<option value="'+esc(k)+'">'+esc(AB[k])+'</option>';}).join('');
      sel.disabled=false;
      var pre=pickedCode();if(pre){sel.value=pre;draw(box,doc,pre);}
    }).catch(function(){
      var lab=box.querySelector('.hn-sl');if(lab)lab.remove();
      var out=box.querySelector('.hn-out');if(out)out.innerHTML='<p class="hn-fine">State basis did not load. Your ZIP still works.</p>';
    });
  }
  function arm(){setTimeout(fallback,NOLOC_MS);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',arm);else arm();
})();
} catch (e) { blockFailed(e); }
/* ---- 2026-10-16: "Also today" under the briefing strip ----
   The strip shows one teaser line. The briefing's other section titles
   (same text bake_homepage.py writes and hydrateDaily refreshes) go on one
   more line, so the first screen says what else happened today without a
   tap. A title already in the headline or teaser is left out. The line hides
   when home-season.js marks the teaser stale or the briefing is not today's. */
try {
(function(){
  var hero=document.getElementById('daily-hero'),teaser=document.getElementById('daily-teaser');
  if(!hero||!teaser)return;
  function todayCT(){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date());}catch(e){return '';}}
  window.__agsistAlsoToday=function(titles,head){
    var h=String(head||'').toLowerCase(),seen={};
    return titles.map(function(t){return String(t||'').replace(/\s+/g,' ').trim();}).filter(function(t){
      var k=t.toLowerCase();if(!t||seen[k]||h.indexOf(k)>=0)return false;seen[k]=1;return true;
    }).slice(0,3);
  };
  function build(){
    var line=document.getElementById('teaser-also');
    var pv=document.getElementById('daily-teaser-text');
    var stale=pv&&pv.getAttribute('data-s7')==='hidden-stale';
    var bd=hero.getAttribute('data-briefing-date')||'',td=todayCT();
    var titles=[];for(var i=1;i<=4;i++){var e=document.getElementById('daily-section-'+i+'-title');if(e)titles.push(e.textContent);}
    var hl=document.getElementById('daily-headline');
    var list=window.__agsistAlsoToday(titles,(hl?hl.textContent:'')+' '+(pv?pv.textContent:''));
    if(stale||!list.length||(bd&&td&&bd!==td)){if(line)line.hidden=true;return;}
    if(!line){line=document.createElement('span');line.id='teaser-also';line.className='teaser-also';teaser.appendChild(line);}
    line.hidden=false;
    line.textContent='Also today: '+list.join(' · ');
  }
  function go(){build();setTimeout(build,2500);setTimeout(build,8000);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();
})();
} catch (e) { blockFailed(e); }
})();
