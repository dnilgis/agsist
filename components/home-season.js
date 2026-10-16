/* The homepage season strip ("This month") and the pieces SEASON decides. Moved out of index.html (2026-10-11), loaded as a plain script in the same place, same order. */
/* 2026-10-01 r7-season. The page changes with the month.
   SEASON below is the only place that decides what leads and what steps
   back. Every figure printed comes from a file in /data, /usda-calendar.ics
   or the Open-Meteo forecast the page already loads; each says when it was
   read. Anything that fails prints "Not loaded yet", never a 0. */
(function(){
  'use strict';
  var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var MONTH=['January','February','March','April','May','June','July','August','September','October','November','December'];
  /* lead: the cells of the "This month" strip, in order.
     planting: Quick Tools final planting dates (also hide once both pass).
     urea: urea loss tile. fallN: fall nitrogen window tile.
     gdu: GDU in Local Conditions. hail: land band hail cell.
     cropTour: crop tour link. band: harvest band shown / open.
     hailLead: hail leads the land band. hp: insurance harvest price link. */
  var SEASON={
    1: /* Jan: annual crop numbers, rent talks, insurance decisions ahead */
       {lead:['report','rent','insurance'],planting:true,urea:false,fallN:false,gdu:false,hail:false,cropTour:false,band:'off',hailLead:false,hp:false},
    2: /* Feb: projected price discovery (Feb average sets the guarantee) */
       {lead:['insurance','report','rent'],planting:true,urea:false,fallN:false,gdu:false,hail:false,cropTour:false,band:'off',hailLead:false,hp:false},
    3: /* Mar: projected price out, sales closing, first soil readings */
       {lead:['insurance','soilPlant','report','rent'],planting:true,urea:true,fallN:false,gdu:false,hail:false,cropTour:false,band:'off',hailLead:false,hp:false},
    4: /* Apr: planting soil temperature, frost, early planting */
       {lead:['soilPlant','planting','frost','spray','report'],planting:true,urea:true,fallN:false,gdu:true,hail:true,cropTour:false,band:'off',hailLead:true,hp:false},
    5: /* May: planting pace, late frost, spray days */
       {lead:['planting','soilPlant','frost','spray','report'],planting:true,urea:true,fallN:false,gdu:true,hail:true,cropTour:false,band:'off',hailLead:true,hp:false},
    6: /* Jun: final planting, first condition ratings, spraying */
       {lead:['planting','condition','spray','report'],planting:true,urea:true,fallN:false,gdu:true,hail:true,cropTour:false,band:'off',hailLead:true,hp:false},
    7: /* Jul: condition and pollination weather, spraying */
       {lead:['condition','spray','report'],planting:false,urea:true,fallN:false,gdu:true,hail:true,cropTour:true,band:'off',hailLead:true,hp:false},
    8: /* Aug: crop tours, condition, harvest price window ahead */
       {lead:['condition','spray','report','insurance'],planting:false,urea:true,fallN:false,gdu:true,hail:true,cropTour:true,band:'shown',hailLead:true,hp:false},
    9: /* Sep: early frost, condition, harvest price window ahead */
       {lead:['condition','frost','insurance','report','harvest'],planting:false,urea:true,fallN:false,gdu:true,hail:true,cropTour:true,band:'shown',hailLead:true,hp:true},
    10:/* Oct: harvest price discovery, harvest, frost, fall N, Oct WASDE */
       {lead:['insurance','prf','harvest','frost','fallN','report'],planting:false,urea:false,fallN:true,gdu:true,hail:false,cropTour:false,band:'open',hailLead:false,hp:true},
    11:/* Nov: harvest wraps, fall N, rent season opens */
       {lead:['prf','harvest','fallN','frost','report','rent'],planting:false,urea:false,fallN:true,gdu:false,hail:false,cropTour:false,band:'open',hailLead:false,hp:true},
    12:/* Dec: rent and lease talks, harvest price settled, Dec WASDE */
       {lead:['rent','insurance','report'],planting:false,urea:false,fallN:false,gdu:false,hail:false,cropTour:false,band:'off',hailLead:false,hp:true}
  };
  var NOW=new Date(), M=NOW.getMonth()+1, S=SEASON[M];
  /* 2026-10-06 EARN, one fact one place: the strip does not repeat what the
     page already shows. Frost and the spray verdict are in Local conditions
     and the hero, the fall nitrogen read is one line in Local conditions, and
     the next USDA report is the calendar's first card. */
  var ELSEWHERE={frost:1,fallN:1,report:1,spray:1};
  if(S)S={lead:S.lead.filter(function(m){return !ELSEWHERE[m];}),planting:S.planting,urea:S.urea,fallN:S.fallN,gdu:S.gdu,hail:S.hail,cropTour:S.cropTour,band:S.band,hailLead:S.hailLead,hp:S.hp};
  var root=document.documentElement;
  function $(i){return document.getElementById(i);}
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function n(x){return '<span class="n">'+x+'</span>';}
  function NL(){return '<span class="s7-nl">Not loaded yet</span>';}
  var MINUS='−';
  function sgn(v){return v>0?'+':(v<0?MINUS:'');}
  /* AG.json / AG.text (util.js): one request per file for the whole page. */
  function get(u){return AG.json(u).catch(function(){return null;});}
  function getText(u){return AG.text(u).catch(function(){return null;});}
  function tzParts(d,tz,o){try{return new Intl.DateTimeFormat('en-US',Object.assign({timeZone:tz},o)).format(d);}catch(e){return '';}}
  function dateLong(d,tz){return tzParts(d,tz||'America/Chicago',{month:'short',day:'numeric',year:'numeric'});}
  function timeIn(d,tz){return tzParts(d,tz,{hour:'numeric',minute:'2-digit'});}
  function isoDay(s){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s||'');return m?MON[+m[2]-1]+' '+(+m[3])+', '+m[1]:'';}
  function loc(){try{return JSON.parse(localStorage.getItem('agsist-wx-loc')||'null');}catch(e){return null;}}
  function hasLoc(){var l=loc();return !!(l&&l.lat!=null&&l.lon!=null);}

  /* ---------- seasonal show/hide ---------- */
  if(S){
    if(!S.urea)root.classList.add('s7-no-urea');
    if(!S.planting)root.classList.add('s7-no-planting');
    if(!S.gdu)root.classList.add('s7-no-gdu');
    if(!S.hail)root.classList.add('s7-no-hail');
    if(!S.cropTour)root.classList.add('s7-no-croptour');
    if(S.hailLead){root.classList.add('s7-hail-lead');var lh=$('land-hail');if(lh&&lh.parentNode&&lh.previousElementSibling)lh.parentNode.insertBefore(lh,lh.parentNode.firstElementChild);}
    var fn=$('s7-falln');if(fn)fn.hidden=!S.fallN;
    var hp=$('s7-hp-link');if(hp)hp.hidden=!S.hp;
    var hb=$('harvest-band');
    if(hb){if(S.band==='off')hb.hidden=true;else if(S.band==='open')hb.open=true;}
  }

  /* ---------- the "This month" strip ---------- */
  var grid=$('s7-grid'), cells={};
  var LABEL={insurance:'Insurance harvest price',harvest:'Harvest progress',frost:'Frost',fallN:'Fall nitrogen window',
    report:'Next USDA report',rent:'Cash rent',condition:'Crop condition',planting:'Planting progress',
    soilPlant:'Planting soil temperature',spray:'Spray today',prf:'PRF pasture insurance'};
  var HREF={insurance:'/harvest-price-tracker',harvest:'/conditions',frost:'/spray',fallN:'/fall-nitrogen',report:'/usda-calendar',
    rent:'/rent/',prf:'/prf',condition:'/conditions',planting:'/planting-date',soilPlant:'/planting-date',spray:'/spray'};
  if(grid&&S){
    var h=$('s7-month-h');if(h)h.textContent=MONTH[M-1]+' on the farm';
    var k=$('s7-month-k');if(k){k.textContent='';k.hidden=true;}
    /* The insurance cell takes a full row of its own (one row per crop inside it). */
    var cols=S.lead.filter(function(m){return m!=='insurance';}).map(function(){return 'minmax(0,1fr)';}).join(' ');
    grid.style.gridTemplateColumns=cols;
    S.lead.forEach(function(m){
      /* The insurance cell holds a state picker and links, so it is a div. */
      var ins=m==='insurance',a=document.createElement(ins?'div':'a');
      a.className='s7-c'+(ins?' s7-wide':'');if(!ins)a.href=HREF[m]||'#';a.setAttribute('data-track','season');a.id='s7-c-'+m;
      a.innerHTML=(ins?'<h3 class="s7-ck idx1-sub-h"><a href="'+HREF[m]+'">'+LABEL[m]+'</a></h3><label class="s7-ins-pick"><span class="visually-hidden">Your state</span><select id="s7-ins-state"></select></label>':'<span class="s7-ck">'+LABEL[m]+'</span>')+'<span class="s7-cv">'+NL()+'</span><span class="s7-cm" hidden></span><span class="s7-cs"></span>';
      grid.appendChild(a);cells[m]=a;
    });
    grid.addEventListener('click',function(e){
      var c=e.target.closest?e.target.closest('.s7-c[data-zip]'):null;if(!c)return;
      e.preventDefault();var chip=$('idx1-zip-chip');if(chip)chip.click();
    });
  }
  var jm=$('s7-jump-m');if(jm)jm.textContent=MONTH[M-1];
  /* 2026-10-06 say it once: a cell keeps its figure and one short line. A
     long sub-line keeps its first sentence; the rest of it, the meaning line
     and any extra detail go to the closed notes under the grid. */
  var NOTES={};
  function note(m,html){
    if(html)NOTES[m]=html;else delete NOTES[m];
    var b=$('s7-notes-b'),d=$('s7-notes');if(!b||!d||!S)return;
    var ks=S.lead.filter(function(k){return NOTES[k];});
    b.innerHTML=ks.map(function(k){return '<p class="s7-note"><b>'+LABEL[k]+'.</b> '+NOTES[k]+'</p>';}).join('');
    d.hidden=!ks.length;
  }
  function put(m,v,s,meaning,extra){
    var c=cells[m];if(!c)return;
    c.querySelector('.s7-cv').innerHTML=v;
    var sub=String(s||''),more=[];
    if(extra)more.push(extra);
    if(sub.replace(/<[^>]*>/g,'').length>70){
      var f=/^([\s\S]*?[.!?])\s+(?=[A-Z<])/.exec(sub);
      if(f){more.push(sub.slice(f[0].length));sub=f[1];}
    }
    if(meaning)more.push(meaning);
    c.querySelector('.s7-cs').innerHTML=sub;
    var cm=c.querySelector('.s7-cm');cm.innerHTML='';cm.hidden=true;
    note(m,more.join(' '));
  }
  function needZip(m){var c=cells[m];if(!c)return;c.setAttribute('data-zip','1');c.href='#bids-zip';put(m,'<span class="s7-nl">Set your ZIP</span>','For your location');}

  /* ---------- shared fetches ---------- */
  var P={};
  function once(key,fn){return P[key]||(P[key]=fn());}
  function prices(){return once('prices',function(){return get('/data/prices.json');});}
  function rma(){return once('rma',function(){return get('/data/rma-prices.json');});}
  function hprices(){return once('hp',function(){return get('/data/harvest-prices.json');});}
  function progress(){return once('cp',function(){return get('/data/crop-progress.json');});}
  function calendar(){return once('ics',function(){return getText('/usda-calendar.ics').then(parseIcs);});}
  function parseIcs(t){
    if(!t)return null;var out=[],cur=null;
    t.replace(/\r/g,'').split('\n').forEach(function(line){
      if(line==='BEGIN:VEVENT')cur={};
      else if(line==='END:VEVENT'){if(cur&&cur.t&&cur.name)out.push(cur);cur=null;}
      else if(cur){
        /* Date-only rows (no release time) are not USDA releases with a time; skipped. */
        var m=/^DTSTART:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(line);
        if(m)cur.t=new Date(Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]));
        var s=/^SUMMARY:(.*)$/.exec(line);if(s)cur.name=s[1].trim();
      }
    });
    /* Foreign agencies in the same file (Statistics Canada, CONAB) are not USDA. */
    return out.filter(function(e){return !/\((Canada|Brazil)\)/.test(e.name);}).sort(function(a,b){return a.t-b.t;});
  }
  function shortName(s){return String(s).replace(/\s+Report$/,'').replace(/\s*\(.*?\)\s*$/,'');}

  /* ---------- A1 insurance harvest price ---------- */
  var AB={AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming"};
  var MCODE={January:'F',February:'G',March:'H',April:'J',May:'K',June:'M',July:'N',August:'Q',September:'U',October:'V',November:'X',December:'Z'};
  /* The reader's state, by full name. An explicit pick (this box, the old
     #pdw widget, or the tracker's own picker) wins; a weather location is a
     guess and is never written back. */
  function stateName(){
    var picked=null;try{picked=localStorage.getItem('agsist-rma-state');}catch(e){}
    if(picked)return picked;
    var pd=null;try{pd=localStorage.getItem('agsist-pd-state');}catch(e){}
    if(pd&&AB[pd])return AB[pd];
    var l=loc(),raw=l&&l.state?String(l.state).trim():'';
    if(raw.length===2)return AB[raw.toUpperCase()]||null;
    for(var k in AB){if(AB[k].toLowerCase()===raw.toLowerCase())return AB[k];}
    return null;
  }
  function stateCode(name){for(var k in AB){if(AB[k]===name)return k;}return '';}
  function dayStart(s){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s||'');return m?new Date(+m[1],+m[2]-1,+m[3]):null;}
  function quoteFor(q,root2,mon,yr){
    /* The futures quote whose ticker is that exact contract (e.g. ZCZ26). */
    var want=root2+MCODE[mon]+String(yr).slice(-2);
    for(var k in q){var t=q[k]&&q[k].ticker;if(t&&t.toUpperCase().indexOf(want)===0&&q[k].close!=null)return q[k];}
    return null;
  }
  /* CME/CBOT full closures, ported from scripts/contract_calendar.py
     market_holidays() (computed, not listed). RMA averages trading days. */
  function nthWd(y,m,wd,n){var d=new Date(y,m,1);d.setDate(1+((wd-d.getDay()+7)%7)+7*(n-1));return d;}
  function lastWd(y,m,wd){var d=new Date(y,m+1,0);d.setDate(d.getDate()-((d.getDay()-wd+7)%7));return d;}
  /* nyd: New Year's Day on a Saturday closes nothing. CME trades Fri Dec 31
     (it did on Dec 31 2021), so that case returns null and is skipped. */
  function obs(d,nyd){var w=d.getDay();if(w===6){if(nyd)return null;d.setDate(d.getDate()-1);}else if(w===0)d.setDate(d.getDate()+1);return d;}
  function easter(y){var a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);return new Date(y,Math.floor((h+l-7*m+114)/31)-1,((h+l-7*m+114)%31)+1);}
  var HOL={};
  function holidays(y){if(HOL[y])return HOL[y];var gf=easter(y);gf.setDate(gf.getDate()-2);
    var l=[obs(new Date(y,0,1),1),nthWd(y,0,1,3),nthWd(y,1,1,3),gf,lastWd(y,4,1),obs(new Date(y,5,19)),obs(new Date(y,6,4)),nthWd(y,8,1,1),nthWd(y,10,4,4),obs(new Date(y,11,25))];
    var o={};l.forEach(function(d){if(d)o[d.toDateString()]=1;});return HOL[y]=o;}
  function isTrading(d){var w=d.getDay();if(w===0||w===6)return false;for(var y=d.getFullYear()-1;y<=d.getFullYear()+1;y++){if(holidays(y)[d.toDateString()])return false;}return true;}
  function tradingDays(a,b){var n=0,d=new Date(a);while(d<=b){if(isTrading(d))n++;d.setDate(d.getDate()+1);}return n;}
  /* The RMA price discovery block below the outlooks uses the same count. */
  window.S7TD=function(a,b,t){return 'trading day '+tradingDays(a,t)+' of '+tradingDays(a,b);};
  [].forEach.call(document.querySelectorAll('.s7-td'),function(x){x.textContent=window.S7TD(new Date(+x.getAttribute('data-a')),new Date(+x.getAttribute('data-b')),new Date(+x.getAttribute('data-t')));});
  /* One row per crop the state has in rma-prices.json, each with its own
     window, its own status and its own date. Conventional practice only;
     organic is priced separately and lives on the tracker. */
  var INS_CROPS=['Corn','Soybeans','Wheat','Grain Sorghum','Cotton','Rice','Peanuts'];
  /* RMA posts rice, cotton and peanuts in dollars per lb (rice 0.165, cotton
     0.78). Rice reads per cwt (x100 lb) and cotton in cents per lb, the way
     both are quoted; peanuts stay dollars per lb. */
  var UNIT={Rice:'cwt',Cotton:'c',Peanuts:'lb'};
  var ROOT={Corn:'ZC',Soybeans:'ZS'};
  function unitOf(crop){return UNIT[crop]||'bu';}
  function usd(v,u){return u==='cwt'?'$'+(v*100).toFixed(2)+'/cwt':u==='c'?(v*100).toFixed(2)+'¢/lb':'$'+v.toFixed(u==='lb'?4:2);}
  function gap(diff,u){
    var c=(u==='bu')?Math.round(diff*100):Math.round(diff*10000)/100,a=Math.abs(c),t;
    if(!c)return 'at projected';
    if(u==='cwt')t='$'+a.toFixed(2)+'/cwt';
    else if(u==='c')t=a.toFixed(2)+'¢/lb';
    else t=(u==='bu'&&a>=100)?'$'+(a/100).toFixed(2):String(a)+'¢';
    return t+' '+(c>0?'above':'below')+' projected';
  }
  function cropName(c){return c==='Grain Sorghum'?'Sorghum':c;}
  /* "Spring wheat", "Long grain rice": the type leads, in sentence case. */
  function rowName(crop,t){return t?t.charAt(0).toUpperCase()+t.slice(1).toLowerCase()+' '+cropName(crop).toLowerCase():cropName(crop);}
  /* "Yet To Start" ships as 0. A zero is not a price. */
  function priceOf(v,status){var x=Number(v);if(v==null||!isFinite(x)||x<=0||/yet to start/i.test(status||''))return null;return x;}
  function rng(a,b){return MON[a.getMonth()]+' '+a.getDate()+'–'+(a.getMonth()===b.getMonth()?'':MON[b.getMonth()]+' ')+b.getDate();}
  function md(d){return MON[d.getMonth()]+' '+d.getDate();}
  /* RMA's sales closing dates ("2/28/2026") as "Sales closing Feb 28" or
     "Sales closing Feb 28, Mar 15". None in the file: the row says so. */
  function scdLabel(l){
    var t=(l||[]).map(function(v){var m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);return m?{k:+m[3]*1e4+ +m[1]*100+ +m[2],t:MON[+m[1]-1]+' '+(+m[2])}:null;}).filter(Boolean);
    t.sort(function(a,b){return a.k-b.k;});
    return t.length?'Sales closing '+t.map(function(x){return x.t;}).join(', '):'Sales closing date not in RMA’s file';
  }
  function realType(t){return (t&&!/^all\b/i.test(String(t)))?String(t):'';}
  /* The site's own average of the settles, from data/harvest-prices.json
     (scripts/fetch_harvest_prices.py computes it; the tracker bakes the same
     figure). Only when that file covers this exact contract and window. */
  function ownAvg(hp,crop,pick,hs,he,today){
    if(!hp||!hs||!he)return null;
    /* County windows (Texas has three for corn): one settled-only average per
       contract and window, in hp.windows. Matched on the exact ticker and the
       exact window dates RMA lists for this row. */
    var root=ROOT[crop],tk=root&&MCODE[pick.h_mon]&&pick.h_yr?root+MCODE[pick.h_mon]+String(pick.h_yr).slice(-2)+'.CBT':'',ww=null;
    (hp.windows||[]).forEach(function(w){if(w&&w.crop===crop&&w.ticker===tk&&w.start===pick.h_start&&w.end===pick.h_end)ww=w;});
    if(ww){
      var wa=ww.status==='final'?ww.price:ww.status==='running'?ww.running_avg:null;
      var ws=ww.series||[],wl=ws.length?dayStart(ws[ws.length-1].d):null;
      if(wa==null||!wl||wl>today||wl<hs||wl>he)return null;
      return {avg:wa,days:ws.length,series:ws,last:ws[ws.length-1].d,fin:ww.status==='final'};
    }
    if(!hp.commodities)return null;
    var c=null;hp.commodities.forEach(function(x){if(x.label===crop)c=x;});
    var leg=c&&c.harvest;if(!leg||!leg.series||!leg.series.length)return null;
    var want=String(pick.h_mon||'').slice(0,3)+" '"+String(pick.h_yr).slice(-2);
    var monthEnd=new Date(hs.getFullYear(),hs.getMonth()+1,0);
    if(c.contract!==want||hp.crop_year!==hs.getFullYear()||leg.window!==MONTH[hs.getMonth()]||hs.getDate()!==1||+he!==+monthEnd)return null;
    var avg=leg.status==='final'?leg.price:leg.running_avg;
    if(avg==null)return null;
    var last=dayStart(leg.series[leg.series.length-1].d);
    if(!last||last>today||last<hs)return null;
    return {avg:avg,days:leg.series.length,series:leg.series,last:leg.series[leg.series.length-1].d};
  }
  /* How many settles RMA's posted figure holds: the day whose running
     average (the pipeline writes it as "a") equals RMA's price. Only a single
     match counts; otherwise the count is not printed. */
  function rmaDays(own,h){
    if(!own)return null;var hit=[];
    own.series.forEach(function(s,i){if(s.a!=null&&Math.round(s.a*100)===Math.round(h*100))hit.push(i+1);});
    return hit.length===1?hit[0]:null;
  }
  function dayWord(n){return n+' day'+(n===1?'':'s');}
  function pickerFill(states,st){
    var c=cells.insurance,sel=c&&c.querySelector?c.querySelector('#s7-ins-state'):null;if(!sel)return;
    if(!sel.options.length||sel.options.length<2){
      sel.innerHTML='<option value="">Pick your state</option>'+states.map(function(s){return '<option>'+esc(s)+'</option>';}).join('');
      sel.addEventListener('change',function(){
        var v=sel.value;
        try{
          if(v){localStorage.setItem('agsist-rma-state',v);localStorage.setItem('agsist-pd-state',stateCode(v));}
          else{localStorage.removeItem('agsist-rma-state');localStorage.removeItem('agsist-pd-state');}
        }catch(e){}
        if(window.gaEvent)try{gaEvent('ins_state_pick',{state:v||'none'});}catch(e){}
        insurance();
      });
    }
    sel.value=(st&&states.indexOf(st)>=0)?st:'';
  }
  function insurance(){
    if(!cells.insurance)return;
    Promise.all([rma(),prices(),hprices()]).then(function(r){
      var d=r[0],px=r[1],hp=r[2];
      if(!d||!d.rows){put('insurance',NL(),'USDA RMA price discovery');return;}
      var today=new Date(NOW.getFullYear(),NOW.getMonth(),NOW.getDate());
      var conv=d.rows.filter(function(x){return x.practice==='Conventional'&&x.year===d.crop_year;});
      var states=[];conv.forEach(function(x){if(x.state&&states.indexOf(x.state)<0)states.push(x.state);});states.sort();
      var st=stateName();if(st&&states.indexOf(st)<0)st=null;
      pickerFill(states,st);
      function wkey(x){return x.p_price+'|'+x.h_start+'|'+x.h_end;}
      var groups=[],usedFut=false,extra=0;
      if(st){
        var mine=conv.filter(function(x){return x.state===st;}),byCT={},order=[];
        mine.forEach(function(x){
          if(INS_CROPS.indexOf(x.crop)<0){extra++;return;}
          if(/^high amylose/i.test(x.type||''))return;
          var k=x.crop+'|'+x.type,wk0=wkey(x);if(!byCT[k]){byCT[k]={};order.push(k);}
          var o=byCT[k][wk0]||(byCT[k][wk0]={row:x,scd:[]});
          if(x.scd&&o.scd.indexOf(x.scd)<0)o.scd.push(x.scd);
        });
        /* WAVE5-A: a crop with more than one county window (Texas corn has
           three) gets one sub-row per window instead of "varies by county".
           Each is labelled with its sales closing date(s) and its own window
           dates, all from RMA's file. RMA's file names no counties. */
        order.forEach(function(k){
          var ws=Object.keys(byCT[k]).map(function(w){return byCT[k][w];});
          if(ws.length>1){
            ws.sort(function(a,b){return String(a.row.h_start).localeCompare(String(b.row.h_start))||String(a.row.p_start).localeCompare(String(b.row.p_start));});
            ws.forEach(function(o,i){groups.push({crop:o.row.crop,type:o.row.type,row:o.row,win:{gid:k,i:i,n:ws.length,scd:o.scd}});});
          }
          else groups.push({crop:ws[0].row.crop,type:ws[0].row.type,row:ws[0].row});
        });
      } else {
        /* No state known: corn and soybeans, the window most states share. */
        ['Corn','Soybeans'].forEach(function(c){
          var rows=conv.filter(function(x){return x.crop===c&&/^All/.test(x.type||'');}),cnt={},best=null;
          rows.forEach(function(x){if(x.p_price!=null){var kk=wkey(x);cnt[kk]=(cnt[kk]||0)+1;}});
          for(var kk in cnt){if(!best||cnt[kk]>cnt[best])best=kk;}
          if(best)groups.push({crop:c,type:'',row:rows.filter(function(x){return wkey(x)===best;})[0]});
        });
      }
      /* Status per group. rank: 0 in window, 1 not open yet or not released, 3 final. County windows share their best rank. */
      groups.forEach(function(g){
        var x=g.row,hs=dayStart(x.h_start),he=dayStart(x.h_end);
        g.hs=hs;g.he=he;g.p=priceOf(x.p_price,x.p_status);g.h=priceOf(x.h_price,x.h_status);
        if(hs&&he&&today>=hs&&today<=he)g.st='open';
        else if(hs&&today<hs)g.st='soon';
        else if(x.h_status==='Released'&&g.h!=null)g.st='final';
        else g.st='closed';
        g.rank={open:0,soon:1,closed:1,final:3}[g.st];
      });
      var gr={};groups.forEach(function(g){if(g.win)gr[g.win.gid]=Math.min(gr[g.win.gid]==null?9:gr[g.win.gid],g.rank);});
      groups.forEach(function(g){if(g.win)g.rank=gr[g.win.gid];});
      /* Types of one crop with no posted price and the same window (peanuts)
         read as one row. */
      var merged=[];
      groups.forEach(function(g){
        var m=null;
        if(!g.win&&g.h==null)merged.forEach(function(o){if(!o.win&&o.h==null&&o.crop===g.crop&&o.st===g.st&&+o.hs===+g.hs&&+o.he===+g.he)m=o;});
        if(m){(m.types=m.types||[{type:m.type,p:m.p}]).push({type:g.type,p:g.p});}else merged.push(g);
      });
      /* WAVE2-F: crops the reader picked in "What do you raise?" come first. */
      var PREF=window.AGSIST_INS_PREF||[],pf=function(c){var i=PREF.indexOf(c);return i<0?99:i;};
      merged.sort(function(a,b){return pf(a.crop)-pf(b.crop)||a.rank-b.rank||INS_CROPS.indexOf(a.crop)-INS_CROPS.indexOf(b.crop)||String(a.type).localeCompare(String(b.type))||(a.win?a.win.i:0)-(b.win?b.win.i:0);});
      var anyCmp=false,trail=false;
      /* WAVE3-M: each row is [name, tag, headline, details, window key, window text].
         The window goes in the sub-line once when every open row shares it. */
      var rows=merged.map(function(g){
        var u=unitOf(g.crop),name=esc(rowName(g.crop,!g.types?realType(g.type):'')),tag='',big='',det=[],wk='',wt='';
        var x=g.row,hs=g.hs,he=g.he,ex=!!(x.h_exch&&String(x.h_exch).trim());
        var tot=ex&&hs&&he?tradingDays(hs,he):0;
        var per=(u==='bu'||u==='lb')?' per '+u:'';
        var proj=g.types?g.types.map(function(t){return esc(realType(t.type)||cropName(g.crop))+' '+(t.p!=null?usd(t.p,u):'-');}).join(', ')+per:(g.p!=null?usd(g.p,u):'-');
        var projTxt='projected '+proj;
        /* A county window: the projected window differs between windows, so it is named. */
        if(g.win&&x.p_start&&x.p_end){var ps=dayStart(x.p_start),pe=dayStart(x.p_end);if(ps&&pe)projTxt+=' ('+rng(ps,pe)+')';}
        if(g.st==='open'){
          tag='in window';
          var own=ownAvg(hp,g.crop,x,hs,he,today);
          var win=hs&&he?rng(hs,he):'';
          /* 2026-10-10 ONE COUNT: the settles in data/harvest-prices.json (the
             tracker, the ARC/PLC snapshot and the briefing clock use the same
             series). The calendar position ("trading day 7 of 22") read as a
             third count beside 6 settles; it is not printed. */
          if(tot&&own)win+=': '+own.days+' of '+tot+' settles counted';
          else if(win)win='window '+win;
          /* A county window names its dates in its label already. */
          if(g.win)win=tot?win.replace(/^[^:]*: /,''):'';
          wk=(hs&&he?+hs+'|'+(+he):'')+'|'+tot;wt=win;
          if(g.p!=null&&(g.h!=null||own)){
            /* Lead with the site's own average of the settles whenever the file
               has it (the one count); RMA's posted figure follows it. RMA's count
               is known only when its figure matches one day's running average. */
            anyCmp=true;tag='so far';
            var k=g.h!=null?rmaDays(own,g.h):null;
            var useOwn=!!own;
            var lead=useOwn?own.avg:g.h,n=useOwn?own.days:k;
            /* One day count only, inside the line it describes; the window's own
               position (trading day N of 22) sits in the sub-line. */
            big=gap(lead-g.p,u);
            if(g.h!=null&&!k)trail=true;
            /* D12: the sample size stays on the visible tag. */
            if(n)tag='so far, '+n+' settle'+(n===1?'':'s');
            var rTxt=g.h!=null?'RMA '+usd(g.h,u)+(k?' ('+dayWord(k)+')':''):'RMA has not posted one';
            var oTxt=own?'our average '+usd(own.avg,u)+' ('+own.days+(tot?' of '+tot:'')+' days, through '+(function(d){var x=dayStart(d);return x?MON[x.getMonth()]+' '+x.getDate():d;})(own.last)+')':'';
            det=useOwn?[oTxt,rTxt]:[rTxt,oTxt];
            det.push(projTxt);
          } else if(g.h!=null){
            big='RMA '+usd(g.h,u);trail=true;det.push(projTxt);
          } else {
            big='RMA has not released a harvest price yet';det.push(projTxt);
          }
        } else if(g.st==='soon'){
          big='opens '+md(hs);
          det.push(projTxt);
          var q=(ROOT[g.crop]&&px&&px.quotes)?quoteFor(px.quotes,ROOT[g.crop],x.h_mon,x.h_yr):null;
          if(q){usedFut=true;det.push(AG.px.contract((x.h_mon||'')+' '+x.h_yr)+' futures '+usd(q.close/100,u)+' today, not the harvest price');}
          det.push(g.win?(tot?tot+' trading days':''):rng(hs,he)+(tot?', '+tot+' trading days':''));
        } else if(g.st==='final'){
          tag='final';
          if(g.p!=null){anyCmp=true;big=gap(g.h-g.p,u);}else big=usd(g.h,u);
          det.push('harvest price '+usd(g.h,u));det.push(projTxt);if(!g.win)det.push(rng(hs,he));
        } else {
          tag='closed';big='not released yet';
          det.push('window closed '+md(he)+'; RMA has not released the final price');
          var ownC=(g.p!=null)?ownAvg(hp,g.crop,x,hs,he,today):null;
          if(ownC&&ownC.fin)det.push('our average of all '+ownC.days+' settles '+usd(ownC.avg,u));
          det.push(projTxt);
        }
        if(g.win){if(wt)det.push(wt);wk='';wt='';}
        return [name,tag,big,det,wk,wt,g.win?{gid:g.win.gid,n:g.win.n,label:scdLabel(g.win.scd),win:hs&&he?rng(hs,he):''}:null];
      });
      var wks=[];rows.forEach(function(r){if(r[4]&&wks.indexOf(r[4])<0)wks.push(r[4]);});
      var oneWin=wks.length===1?rows.filter(function(r){return r[4];})[0][5]:'';
      if(!oneWin)rows.forEach(function(r){if(r[5])r[3].push(r[5]);});
      var html='',seen={},insMore=[];
      /* One short line per crop: the projected price it is measured against.
         Averages, day counts and windows go to the notes, word for word. */
      function shortDet(d){var p=d.filter(function(x){return /^projected /.test(x||'');})[0];return p||d.filter(Boolean)[0]||'';}
      rows.forEach(function(r,i){
        if(!r[6]){var full=r[3].filter(Boolean),sd=shortDet(full);if(full.length>1||full[0]!==sd)insMore.push('<span class="w1c-cp"><b>'+r[0]+':</b> '+full.join(' · ')+'</span>');
          html+='<span class="s7-ir"><span class="s7-ir-k">'+r[0]+(r[1]?' <small>· '+r[1]+'</small>':'')+'</span><span class="s7-ir-v">'+r[2]+'</span><small class="s7-ir-d">'+sd+'</small></span>';return;}
        var gid=r[6].gid;if(seen[gid])return;seen[gid]=1;
        var subs=rows.filter(function(q){return q[6]&&q[6].gid===gid;});
        html+='<span class="s7-ir s7-ir-m"><span class="s7-ir-k">'+r[0]+' <small>· '+subs.length+' county windows</small></span>'+
          subs.map(function(q){
            return '<span class="s7-iw"><span class="s7-ir-k">'+esc(q[6].label)+' <small>· harvest window '+esc(q[6].win||'not in RMA’s file')+(q[1]?' · '+q[1]:'')+'</small></span><span class="s7-ir-v">'+q[2]+'</span><small class="s7-ir-d">'+q[3].filter(Boolean).join(' · ')+'</small></span>';
          }).join('')+'</span>';
      });
      if(!rows.length)html='<span class="s7-nl">No revenue price for '+esc(st||'this state')+' in RMA’s '+d.crop_year+' data</span>';
      var meaning=anyCmp?'Revenue Protection uses the higher price. RP-HPE and Yield Protection stay at projected. <span class="tip"><button type="button" class="tip-b" aria-expanded="false" aria-describedby="tip-s7-rp">When RP pays</button><span id="tip-s7-rp" role="tooltip" class="tip-t" hidden>RP pays when a unit’s revenue to count (production × harvest price) falls below its revenue guarantee.</span></span>':'';
      var _fs=usedFut&&px&&px.fetched&&window.AgAsOf?AgAsOf.html(px.fetched,'prices',{prefix:'Futures updated'}):'';
      var asof=_fs?' '+_fs+', delayed.':usedFut&&px&&px.fetched?' Futures '+dateLong(new Date(px.fetched)).replace(/, \d{4}$/,'')+', '+timeIn(new Date(px.fetched),'America/Chicago')+' CT, delayed.':'';
      var cw=rows.some(function(r){return r[6];})?'County windows: your county’s sales closing date sets which one is yours. RMA’s file lists the dates, not the counties. ':'';
      var lead1=cw+(oneWin?(oneWin.charAt(0).toUpperCase()+oneWin.slice(1))+'. ':'')+(trail?'RMA’s average can trail a day. ':'');
      var sub=lead1+(st?'':'Most states. ')+'Conventional (non-organic) prices, USDA RMA.'+asof+' <a href="/harvest-price-tracker">'+(extra?'Other crops, organic and counties':'Organic and counties')+' on the tracker</a>';
      put('insurance','<span class="s7-irs">'+html+'</span>',sub,meaning,insMore.join(''));
    });
  }

  window.AGSIST_INS_RENDER=insurance;   /* WAVE2-F: the picker re-sorts the rows */

  /* ---------- A2 harvest progress / condition / planting ---------- */
  function cropLine(name,o,key,prev){
    if(!o||o[key]==null)return null;
    return name+' '+o[key]+'%'+(o[prev]!=null?' <small>'+o[prev]+'% '+(/5yr|avg/.test(prev)?'5-year':'a year ago')+'</small>':'');
  }
  function cropModules(){
    if(!cells.harvest&&!cells.condition&&!cells.planting)return;
    progress().then(function(d){
      var asof=d&&d.report_date?'USDA Crop Progress, week ending '+isoDay(d.report_date)+'.':'';
      var cpSt=d&&d.updated&&window.AgAsOf?' '+AgAsOf.html(d.updated,'usda'):'';
      if(cells.harvest){
        /* WAVE1-C 2026-10-03: every number says what it is. National corn and
           soybeans: harvested, same week last year, 5-year average (computed
           in fetch_crop_progress.py; withheld when any of the five years is
           not bracketed). Then the reader's state from the same NASS file:
           corn, soybeans, winter wheat planted/emerged, cotton, rice, peanuts,
           sorghum, whichever NASS published for that state this week. */
        var pc=function(v){return v==null?'-':v+'%';};
        var hline=function(name,o){if(!o||o.harvest_pct==null)return null;
          return name+' '+o.harvest_pct+'% <small>harvested'+(o.harvest_prev_year!=null?' \u00b7 '+o.harvest_prev_year+'% last year':'')+(o.harvest_5yr_avg!=null?' \u00b7 '+o.harvest_5yr_avg+'% 5-yr avg':'')+'</small>';};
        var a=d&&hline('Corn',d.corn),b=d&&hline('Soybeans',d.soybeans);
        var mt=d&&d.corn&&d.corn.mature_pct!=null?'<span class="s7-line"><small>Corn mature '+d.corn.mature_pct+'%</small></span>':'';
        var hd=d&&((d.corn&&d.corn.harvest_date)||(d.soybeans&&d.soybeans.harvest_date));
        var miss=d?[['Corn',d.corn],['soybean',d.soybeans]].filter(function(x){return x[1]&&x[1].harvest_pct!=null&&x[1].harvest_5yr_avg==null;}).map(function(x){return x[0];}):[];
        /* WAVE3-M: the reason prints only when the pipeline withheld the average;
           before the first run that computes it, the segment is simply absent. */
        var avgWhy=miss.length&&d.progress?' '+(miss.length>1?'Corn and soybean':miss[0].charAt(0).toUpperCase()+miss[0].slice(1))+' 5-year average withheld: not every prior year had a NASS week on both sides of this date.':'';
        var SL={corn_harvested:'Corn harvested',soybeans_harvested:'Soybeans harvested',winter_wheat_planted:'Winter wheat planted',winter_wheat_emerged:'Winter wheat emerged',
          cotton_harvested:'Cotton harvested',rice_harvested:'Rice harvested',peanuts_harvested:'Peanuts harvested',sorghum_harvested:'Sorghum harvested'};
        var L=loc(),st=L&&L.state,stTxt='';
        if(!st)stTxt='<span class="w1c-cp">Set your ZIP to see your state.</span>';
        else if(!d||!d.states)stTxt='';
        else{var so=d.states[st]||{},ks=Object.keys(SL).filter(function(k){return so[k]&&so[k].pct!=null;});
          stTxt=ks.length?ks.map(function(k){var o=so[k];return '<span class="w1c-cp"><b>'+esc(st)+' '+SL[k].toLowerCase()+' '+o.pct+'%</b>'+(o.prev_year!=null?', last year '+o.prev_year+'%':'')+(o.avg5!=null?', avg '+o.avg5+'%':'')+'</span>';}).join('')
            :'<span class="w1c-cp"><b>'+esc(st)+':</b> NASS published no progress figure for this state this week.</span>';}
        /* 2026-10-06 EARN: crop condition (good or excellent) joins this cell,
           from the same NASS file and week; it left the markets fold. */
        var ge=[];if(!cells.condition&&d){[['Corn',d.corn],['soybeans',d.soybeans]].forEach(function(x){if(x[1]&&x[1].good_excellent!=null)ge.push(x[0]+' '+x[1].good_excellent+'%');});}
        var gel=ge.length?'<span class="s7-line">Good or excellent <small>'+ge.join(' \u00b7 ')+'</small></span>':'';
        if(a||b)put('harvest',[a,b].filter(Boolean).map(function(x){return '<span class="s7-line">'+x+'</span>';}).join('')+gel,esc(hd?'US, USDA week ending '+isoDay(hd)+'.'+avgWhy:asof)+cpSt,stTxt,mt);
        else put('harvest',NL(),esc('Harvested share is not in our crop progress feed yet'+(d&&d.report_date?' (latest week: '+isoDay(d.report_date)+')':'')+'.'),stTxt);
      }
      if(cells.condition){
        var c1=d&&cropLine('Corn',d.corn,'good_excellent','good_excellent_prev_year'),c2=d&&cropLine('Soybeans',d.soybeans,'good_excellent','good_excellent_prev_year');
        if(c1||c2)put('condition',[c1,c2].filter(Boolean).map(function(x){return '<span class="s7-line">'+x+'</span>';}).join(''),esc('Good or excellent. '+asof)+cpSt);
        else put('condition',NL(),'');
      }
      if(cells.planting){
        var p1=d&&cropLine('Corn',d.corn,'planting_pct','planting_prev_year'),p2=d&&cropLine('Soybeans',d.soybeans,'planting_pct','planting_prev_year');
        if(p1||p2)put('planting',[p1,p2].filter(Boolean).map(function(x){return '<span class="s7-line">'+x+'</span>';}).join(''),esc('Planted. '+asof)+cpSt);
        else put('planting',NL(),'');
      }
    });
  }

  /* ---------- A5 next USDA report ---------- */
  function report(){
    if(!cells.report)return;
    calendar().then(function(ev){
      if(!ev){put('report',NL(),'USDA calendar');return;}
      var next=ev.filter(function(e){return e.t>NOW;});
      if(!next.length){put('report',NL(),'No later dates in the calendar file yet.');return;}
      var t0=next[0].t,same=next.filter(function(e){return +e.t===+t0;}).map(function(e){return shortName(e.name);});
      var days=Math.round((new Date(t0.getFullYear(),t0.getMonth(),t0.getDate())-new Date(NOW.getFullYear(),NOW.getMonth(),NOW.getDate()))/864e5);
      put('report','<span class="s7-line">'+tzParts(t0,'America/New_York',{weekday:'short'})+', '+dateLong(t0,'America/New_York').replace(/, \d{4}$/,'')+'</span><span class="s7-line"><small>'+timeIn(t0,'America/New_York')+' ET</small></span>',
        esc(same.join(' and '))+'. '+(days===0?'Today.':(days===1?'Tomorrow.':'In '+days+' days.')));
    });
  }

  /* ---------- rent ---------- */
  function rent(){
    if(!cells.rent)return;
    var l=loc();if(!l||!l.state){needZip('rent');return;}
    get('/farmland-atlas/data/cards.json').then(function(d){
      if(!d||!d.counties){put('rent',NL(),'Farmland Atlas');return;}
      var st=l.state,cty=String(l.county||'').replace(/\s+County$/i,'').toLowerCase(),hit=null;
      for(var k in d.counties){var c=d.counties[k];if(c.st===st&&String(c.n||'').replace(/\s+County$/i,'').toLowerCase()===cty){hit=c;break;}}
      if(hit&&hit.r!=null)put('rent','$'+Math.round(hit.r)+' <small>per acre'+(hit.ry?', '+hit.ry:'')+'</small>',esc(hit.n+', '+hit.st+'. USDA NASS county cash rent.'));
      else if(d.states&&d.states[st]&&d.states[st].r!=null)put('rent','$'+Math.round(d.states[st].r)+' <small>per acre, state median of counties</small>',esc((d.states[st].n||st)+'. USDA NASS county cash rent survey.'));
      else put('rent',NL(),'Farmland Atlas');
    });
  }

  /* ---------- PRF sign-up (Oct and Nov) ----------
     The sales closing date and crop year come from /data/prf/meta.json, the
     file the PRF pages are built from. The cell hides itself once that date
     has passed in Central time, so it never counts down to a closed sign-up. */
  function prf(){
    if(!cells.prf)return;
    get('/data/prf/meta.json').then(function(m){
      var c=cells.prf;if(!c)return;
      var d=m&&m.dates&&m.dates.sales_closing;
      if(!d){put('prf',NL(),'PRF calculator');return;}
      var today=tzParts(new Date(),'America/Chicago',{year:'numeric',month:'2-digit',day:'2-digit'}).replace(/^(\d{2})\/(\d{2})\/(\d{4})$/,'$3-$1-$2');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(today)||today>d){c.hidden=true;return;}
      var days=Math.round((Date.UTC(+d.slice(0,4),+d.slice(5,7)-1,+d.slice(8,10))-Date.UTC(+today.slice(0,4),+today.slice(5,7)-1,+today.slice(8,10)))/864e5);
      var l=loc(),st=null;
      if(l&&l.state&&m.states)m.states.forEach(function(x){if(x.st===l.state)st=x;});
      if(st)c.href='/prf/'+String(st.name).toLowerCase().replace(/[^a-z0-9]+/g,'-');
      put('prf',esc(isoDay(d).replace(/, \d{4}$/,''))+' <small>sign-up deadline'+(days===0?', today':(days===1?', tomorrow':', '+days+' days'))+'</small>',
          esc((m.crop_year||'')+' crop year. '+(st?'PRF in '+st.name+', county by county.':'Price your grid, every year since 1951.')));
    });
  }

  /* ---------- weather: frost, soil, spray (one rule) ---------- */
  var WX={state:'wait',f:null,spray:null};
  function localNowKey(f){var off=+(f&&f.utc_offset_seconds)||0;return new Date(Date.now()+off*1000).toISOString().slice(0,13);}
  function hourIdx(times,key){for(var i=0;i<times.length;i++){if(String(times[i]).slice(0,13)>=key)return i;}return -1;}
  function overnight(f){
    var h=f&&f.hourly,t=h&&h.time,v=h&&h.temperature_2m;if(!t||!v||!t.length)return null;
    var i0=hourIdx(t,localNowKey(f));if(i0<0)return null;
    var hr=function(i){return +String(t[i]).slice(11,13);};
    var s=i0;if(hr(s)>=10&&hr(s)<18){while(s<t.length&&hr(s)!==18)s++;}
    var e=s+1;while(e<t.length&&hr(e)!==10)e++;
    var lo=null;for(var i=s;i<e&&i<t.length;i++){if(v[i]!=null&&(lo==null||v[i]<lo))lo=v[i];}
    return lo==null?null:Math.round(lo);
  }
  /* 33-36F: frost can form on plants while the air at 2 m stays above freezing. */
  function frostFlag(lo){return lo<=28?'Hard freeze':(lo<=32?'Frost likely':(lo<=36?'Frost possible':''));}
  function firstFrost(f){
    var d=f&&f.daily,t=d&&d.time,v=d&&d.temperature_2m_min;if(!t||!v)return null;
    for(var i=1;i<t.length;i++){if(v[i]!=null&&v[i]<=36){var dd=dayStart(t[i]);return {day:dd?['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dd.getDay()]:t[i],lo:Math.round(v[i])};}}
    return false;
  }
  function soil(f){
    var h=f&&f.hourly,t=h&&h.time;if(!t)return null;
    var a=h.soil_temperature_6cm,b=h.soil_temperature_18cm,i0=hourIdx(t,localNowKey(f));
    if(!a||i0<0||a[i0]==null)return null;
    var mx=null,mx2=null;for(var i=i0;i<a.length;i++){if(a[i]!=null&&(mx==null||a[i]>mx))mx=a[i];if(b&&b[i]!=null&&(mx2==null||b[i]>mx2))mx2=b[i];}
    return {now:Math.round(a[i0]),max:mx==null?null:Math.round(mx),deep:(b&&b[i0]!=null)?Math.round(b[i0]):null,deepMax:mx2==null?null:Math.round(mx2)};
  }
  /* Fall anhydrous: wait until soil at 4 in stays below 50F (extension
     guidance). This page reads Open-Meteo at 6 cm (2.4 in) and 18 cm (7 in);
     it says so and never calls either reading 4 in. */
  function fallVerdict(s){
    if(s.now>=50)return {t:'Not yet',c:''};
    /* In range only when both depths stay below 50F through the forecast. */
    if(s.max!=null&&s.max<50&&s.deep!=null&&s.deepMax!=null&&s.deepMax<50)return {t:'In range',c:'s7-ok'};
    return {t:'Getting close',c:''};
  }
  function paintWx(){
    var f=WX.f,lo=f?overnight(f):null,s=f?soil(f):null,ff=f?firstFrost(f):null;
    var noLoc=(WX.state==='wait'&&!hasLoc());
    /* Local Conditions cells */
    var lw=$('s7-wx-low'),sw=$('s7-wx-soil');
    if(lw){
      if(lo!=null){var fl=frostFlag(lo);lw.innerHTML=lo+'°F'+(fl?'<span class="s7-flag s7-warn">'+fl+'</span>':'<span class="s7-sub">No frost tonight</span>');}
      else if(WX.state!=='wait')lw.innerHTML=NL();
    }
    if(sw){
      if(s)sw.innerHTML=s.now+'°F'+(s.deep!=null?'<span class="s7-sub">7 in: '+s.deep+'°F</span>':'');
      else if(WX.state!=='wait')sw.innerHTML=NL();
    }
    /* Strip cells */
    if(cells.frost){
      if(noLoc)needZip('frost');
      else if(lo!=null){
        var fl2=frostFlag(lo);
        put('frost','<span class="s7-line">'+lo+'°F <small>overnight low</small></span>'+(fl2?'<span class="s7-line s7-warn">'+fl2+'</span>':''),
          esc(ff?'First frost risk in the forecast: '+ff.day+' morning, '+ff.lo+'°F ('+frostFlag(ff.lo).toLowerCase()+').':(ff===false?'No frost in the 5-day forecast.':'')));
      } else if(WX.state!=='wait')put('frost',NL(),'Weather forecast');
    }
    if(cells.fallN||cells.soilPlant||$('s7-falln')){
      var fb=$('s7-falln-badge'),fr=$('s7-falln-rec');
      if(noLoc){needZip('fallN');needZip('soilPlant');if(fb)fb.textContent='Set your ZIP';}
      else if(s){
        var v=fallVerdict(s);
        var sub=(v.t==='In range'?'Both depths below 50°F through the 5-day forecast.':'5-day high '+Math.max(s.max,s.deepMax!=null?s.deepMax:-99)+'°F.')+' Apply once 4 in soil stays below 50°F. Not on sandy or poorly drained soils.';
        put('fallN','<span class="s7-line'+(v.c?' '+v.c:'')+'">'+v.t+'</span><span class="s7-line">'+s.now+'°F <small>at 2.4 in, modeled</small></span>',esc(sub));
        put('soilPlant','<span class="s7-line">'+s.now+'°F <small>at 2.4 in</small></span><span class="s7-line">'+(s.now>=50?'At or above 50°F':'Below 50°F')+'</span>','Soil at 2.4 in (6 cm). Corn is commonly planted once soil holds near 50°F.');
        if(fb){fb.textContent=v.t+' · '+s.now+'°F';fb.style.color=v.c?'var(--green)':'var(--text)';}
        if(fr)fr.textContent='Modeled. '+sub;   /* the cell already says "modelled" beside the reading */
      } else if(WX.state!=='wait'){put('fallN',NL(),'Soil temperature forecast');put('soilPlant',NL(),'');if(fb)fb.textContent='Not loaded yet';}
    }
    if(cells.spray){
      var d0=WX.spray&&WX.spray[0];
      if(noLoc)needZip('spray');
      else if(d0)put('spray',d0.long,esc(d0.why));
      else if(WX.state!=='wait')put('spray',NL(),'');
    }
  }

  /* F: ONE spray rule. Thresholds are the ones this page already used, now
     in one place: the summary sentence, the per-day badges and the Spray
     Advisory tile all call this with the same day's forecast. */
  /* Inversion risk: the lowest hourly 10 m wind under 3 mph in the early
     morning (5-9 AM) or evening (6-9 PM) of that day, from the hourly
     forecast. No hourly data, no inversion line. */
  function calmAt(k){
    var f=WX.f,h=f&&f.hourly,t=h&&h.time,w=h&&h.wind_speed_10m,d=f&&f.daily&&f.daily.time;
    if(!t||!w||!d||!d[k])return null;var lo=null;
    for(var i=0;i<t.length;i++){var s=String(t[i]);if(s.slice(0,10)!==d[k])continue;var hr=+s.slice(11,13);
      if(((hr>=5&&hr<=9)||(hr>=18&&hr<=21))&&w[i]!=null&&(lo==null||w[i]<lo))lo=w[i];}
    return (lo!=null&&lo<3)?Math.round(lo*10)/10:null;
  }
  function sprayRule(x){
    if(x.wind==null&&x.tmax==null)return null;
    var stop=[],cau=[];
    if(x.rain!=null&&x.rain>0.25)stop.push('rain '+(Math.round(x.rain*100)/100)+' in');
    if(x.wind!=null&&x.wind>15)stop.push('wind '+Math.round(x.wind)+' mph');
    if(x.tmax!=null&&x.tmax<40)stop.push('high '+Math.round(x.tmax)+'°F');
    if(x.tmax!=null&&x.tmax>90)stop.push('high '+Math.round(x.tmax)+'°F');
    /* 2026-10-06: the same day rule as /spray's day strip. A forecast weather
       code of 51-95 (drizzle, rain, snow, showers, storms) is a stop there, and
       a 40-49°F high is marginal; the homepage said "OK to spray" on both. */
    if(x.code!=null&&x.code>=51&&x.code<=95)stop.push(x.code>=95?'thunderstorms forecast':(x.code>=71&&x.code<=77)||x.code===85||x.code===86?'snow forecast':'rain forecast');
    if(x.wind!=null&&x.wind>10&&x.wind<=15)cau.push('wind '+Math.round(x.wind)+' mph');
    if(x.calm!=null)cau.push('inversion risk, '+x.calm+' mph at dawn or dusk');
    if(x.pop!=null&&x.pop>50)cau.push('rain chance '+Math.round(x.pop)+'%');
    if(x.rh!=null&&x.rh>85)cau.push('humidity '+Math.round(x.rh)+'%');
    if(x.rh!=null&&x.rh<40)cau.push('humidity '+Math.round(x.rh)+'%');
    if(x.tmin!=null&&x.tmin<45)cau.push('low '+Math.round(x.tmin)+'°F');
    if(x.tmax!=null&&x.tmax>85&&x.tmax<=90)cau.push('high '+Math.round(x.tmax)+'°F');
    if(x.tmax!=null&&x.tmax>=40&&x.tmax<50)cau.push('high '+Math.round(x.tmax)+'°F');
    var g=(x.gust!=null)?', gusts '+Math.round(x.gust)+' mph':'';
    if(stop.length)return {s:'stop',t:'Hold off',long:'Hold off spraying',why:stop.join(', ')+g,short:stop[0].split(',')[0]};
    if(cau.length)return {s:'caution',t:'Caution',long:'Use caution',why:cau.join(', ')+g,short:cau[0].split(',')[0]};
    return {s:'go',t:'OK',long:'OK to spray',why:'wind up to '+Math.round(x.wind)+' mph'+g+(x.tmax!=null?', high '+Math.round(x.tmax)+'°F':''),short:'wind '+Math.round(x.wind)+' mph'};
  }
  var ICON={go:'#i-circle-check',caution:'#i-triangle-alert',stop:'#i-ban'};
  var COLOR={go:'var(--green)',caution:'var(--gold)',stop:'var(--red)'};
  function paintSprayTile(){
    var r=WX.spray&&WX.spray[0];if(!r)return;
    var ic=$('wsp-spray-icon'),st=$('wsp-spray-status'),dt=$('wsp-spray-detail');
    if(ic){ic.innerHTML='<svg class="ic" aria-hidden="true"><use href="'+ICON[r.s]+'"/></svg>';ic.style.color=COLOR[r.s];}
    if(st){st.textContent=r.long;st.style.color=COLOR[r.s];}
    if(dt)dt.textContent='Today: '+r.why+'.';
    var w=$('wsp-spray'),inner=w&&w.querySelector('div');if(inner){inner.style.background='';inner.style.borderColor='';}
  }
  /* geo.js paints the tile from the current reading; repaint it with the
     one rule right after, so the page never shows two verdicts. */
  var _uwp=window.updateWidgetPreviews;
  if(typeof _uwp==='function'){window.updateWidgetPreviews=function(){var o=_uwp.apply(this,arguments);paintSprayTile();return o;};}

  window.S7={
    onWx:function(f){WX.f=(f&&f.hourly)?f:null;WX.state=WX.f?'ok':'fail';paintWx();
      if(!WX.f){try{window.__agsistSprayToday=null;window.dispatchEvent(new CustomEvent('agsist:spray',{detail:null}));}catch(e){}}
      if(!WX.f){var sv=$('wx-forecast-7day');if(sv&&!$('s7-wx-off')){var p=document.createElement('div');p.className='s7-wx-off';p.id='s7-wx-off';p.textContent='Forecast: Not loaded yet';sv.parentNode.insertBefore(p,sv);sv.hidden=true;}}},
    spray:function(a){
      var out=[],names=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],dow=new Date().getDay();
      var len=(a.max||[]).length;
      for(var k=0;k<Math.min(5,len);k++){
        var r=sprayRule({rain:a.rain[k],wind:a.wind[k],gust:a.gust[k],pop:a.pop[k],rh:a.rh[k],tmax:a.max[k],tmin:a.min[k],code:(a.code&&a.code[k]!=null&&!isNaN(a.code[k]))?Number(a.code[k]):null,calm:calmAt(k)});
        if(r){r.label=k===0?'Today':(k===1?'Tmrw':names[(dow+k)%7]);r.pop=(a.pop&&a.pop[k]!=null&&!isNaN(a.pop[k]))?Number(a.pop[k]):null;}
        out.push(r);
      }
      WX.spray=out.length&&out[0]?out:null;
      /* 2026-10-06: the hero band reads today's verdict from here, so the page
         never shows two spray reads. */
      try{window.__agsistSprayToday=WX.spray?WX.spray[0]:null;window.dispatchEvent(new CustomEvent('agsist:spray',{detail:window.__agsistSprayToday}));}catch(e){}
      var strip=$('spray-days-strip');
      if(strip){
        if(WX.spray){strip.innerHTML=out.map(function(r){return r?'<div class="spray-day '+r.s+'"><span class="spray-day-name">'+r.label+'</span><span class="spray-day-icon"><svg class="ic" aria-hidden="true"><use href="'+ICON[r.s]+'"/></svg></span><span class="spray-day-status">'+r.t+'</span><span class="spray-day-reason" title="'+esc(r.why)+'">'+esc(r.short)+'</span></div>':'';}).join('');var sw=$('spray-windows');if(sw)sw.classList.add('loaded');}
        else strip.innerHTML='<div class="s7-wx-off">Not loaded yet</div>';
      }
      if(!WX.spray){
        var st0=$('wsp-spray-status'),dt0=$('wsp-spray-detail');
        if(st0){st0.textContent='Not loaded yet';st0.style.color='var(--text-muted)';}
        if(dt0)dt0.textContent='The spray read needs the forecast, which has not loaded.';
      }
      var el=$('wx-today-summary');
      if(el){
        var r0=WX.spray&&WX.spray[0];
        var clauses=[];
        if(typeof a.gduPct==='number')clauses.push(a.gduPct>2?'season heat is running <strong>'+a.gduPct+'% ahead of</strong> the 5-year normal':(a.gduPct<-2?'season heat is running <strong>'+Math.abs(a.gduPct)+'% behind</strong> the 5-year normal':'season heat is right at the 5-year normal'));
        if(typeof a.prPct==='number')clauses.push('30-day rain is '+(a.prPct>5?'<strong>'+a.prPct+'% above</strong>':(a.prPct<-5?'<strong>'+Math.abs(a.prPct)+'% below</strong>':'near'))+' normal');
        var ctx='';if(clauses.length){var j=clauses.join(', and ');ctx=' '+j.charAt(0).toUpperCase()+j.slice(1)+'.';}
        el.innerHTML=r0?'<span class="wx-today-icon" aria-hidden="true" style="color:'+COLOR[r0.s]+'"><svg class="ic" aria-hidden="true"><use href="'+ICON[r0.s]+'"/></svg></span><span class="wx-today-text"><strong>Today:</strong> '+r0.long+'. '+esc(r0.why.charAt(0).toUpperCase()+r0.why.slice(1))+'.'+ctx+'</span>'
          :'<span class="wx-today-text"><strong>Today:</strong> spray read not loaded yet.</span>';
        el.classList.add('loaded');
      }
      paintSprayTile();paintWx();
    },
    teaser:teaser
  };

  /* ---------- D: the briefing teaser ---------- */
  function teaser(data){
    var el=$('daily-teaser-text');if(!el||!data)return;
    var gen=data.generated_at?new Date(data.generated_at):null;
    var stamp=(gen&&!isNaN(gen))?timeIn(gen,'America/Chicago')+' CT':'';
    var txt=String(data.teaser||'');
    Promise.all([calendar(),get('/data/wpi-history.json')]).then(function(r){
      var ev=(r[0]||[]).map(function(e){return {name:e.name,t:e.t};});
      ((r[1]&&r[1].history)||[]).forEach(function(h){var d=dayStart(h.date);if(d&&h.report)ev.push({name:h.report,t:new Date(d.getTime()+12*36e5)});});
      /* Text is stale when it is "ahead of" (or "before") a report whose
         latest release is behind us and nearer than its next one. */
      function staleIn(s){
        var found=null,re=/\b(ahead of|before|into|awaiting|waiting (?:on|for))\b([^.;]{0,48})/ig,m;
        var noise=/^(report|summary|the|of|and|sep|sept|september|october|quarterly|monthly|annual|final|\d+)$/;
        while((m=re.exec(String(s||'')))){
          var phrase=m[2].toLowerCase(),keys={};
          ev.forEach(function(e){shortName(e.name).toLowerCase().split(/[^a-z]+/).forEach(function(w){if(w.length>3&&!noise.test(w)&&phrase.indexOf(w)>=0)keys[w]=1;});});
          Object.keys(keys).forEach(function(w){
            var hits=ev.filter(function(e){return shortName(e.name).toLowerCase().indexOf(w)>=0;});
            var past=hits.filter(function(e){return e.t<=NOW;}).sort(function(a,b){return b.t-a.t;})[0];
            var fut=hits.filter(function(e){return e.t>NOW;}).sort(function(a,b){return a.t-b.t;})[0];
            if(past&&(!fut||(NOW-past.t)<(fut.t-NOW)))found=found||past;
          });
        }
        return found;
      }
      var stale=staleIn(txt);
      if(stale){
        el.innerHTML=(stamp?'<span class="s7-stamp">'+stamp+'</span>':'')+'Today’s briefing. Tap to read it.';
        el.setAttribute('data-s7','hidden-stale');
      } else {
        el.innerHTML=(stamp?'<span class="s7-stamp">'+(/\bPM\b/.test(stamp)?'Snapshot, ':'Morning snapshot, ')+stamp+'</span>':'')+esc(txt);
        el.setAttribute('data-s7','stamped');
      }
      /* The full briefing: if its headline or lead treats a released report
         as still ahead, say so above it rather than let it read as current. */
      var hl=$('daily-headline'),ld=$('daily-lead');
      var st2=staleIn((hl?hl.textContent:'')+'. '+(ld?ld.textContent:'')+'. '+(data.headline||'')+'. '+(data.lead||''));
      var note=$('s7-brief-note');
      if(st2&&hl){
        if(!note){note=document.createElement('p');note.id='s7-brief-note';note.className='s7-brief-note';hl.parentNode.insertBefore(note,hl);}
        note.textContent='Morning briefing'+(stamp?', '+stamp:'')+'. It treats '+shortName(st2.name)+' as still ahead; that report came out '+dateLong(st2.t,'America/New_York')+'.';
      } else if(note){note.parentNode.removeChild(note);}
    });
  }
  /* F14: the teaser opens the full briefing, the same way the "Read today's
     full briefing" button does (it lives inside the hidden part). */
  (function(){
    var hero=$('daily-hero'),tz=$('daily-teaser');if(!hero||!tz)return;
    function open(){
      if(!hero.classList.contains('is-brief'))return;
      hero.classList.remove('is-brief');hero.setAttribute('aria-expanded','true');var _tz2=document.getElementById('daily-teaser');if(_tz2)_tz2.setAttribute('aria-expanded','true');
      var b=hero.querySelector('[data-daily-more]');if(b)b.setAttribute('aria-expanded','true');
      var h=$('daily-headline');if(h){if(!h.hasAttribute('tabindex'))h.setAttribute('tabindex','-1');try{h.focus({preventScroll:true});}catch(e){}}
      if(window.gaEvent)window.gaEvent('daily_expand',{from:'teaser'});
    }
    tz.addEventListener('click',open);
    tz.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
  })();
  if(window.__s7daily)teaser(window.__s7daily);

  /* ---------- C: chips ---------- */
  function chip(){
    var v=$('idx1-zip-val'),c=$('idx1-zip-change');if(!v||!c)return;
    c.innerHTML='<span class="idx1-zip-dot" aria-hidden="true">· </span>'+(/^\d{5}$/.test(v.textContent.trim())?'Change':'Set')+'<span class="idx1-zip-word"> ZIP</span>';
  }
  chip();
  window.addEventListener('agsist:bids',chip);window.addEventListener('storage',chip);
  window._AGSIST_GEO_CALLBACKS=window._AGSIST_GEO_CALLBACKS||[];
  window._AGSIST_GEO_CALLBACKS.push(function(){setTimeout(chip,0);paintWx();rent();prf();});

  /* ---------- H: drought valid date, I: NOAA dates ---------- */
  get('/data/outlooks/manifest.json').then(function(mf){
    var f=mf&&mf.files||{};
    var u=f['usdm_latest.png'],dv=$('s7-usdm-valid');
    if(dv)dv.textContent=(u&&u.data_valid)?'valid '+isoDay(u.data_valid):'';
    var nd=$('s7-noaa-dates');if(!nd)return;
    function valid(lm,months){
      var d=new Date(lm);if(isNaN(d))return null;
      /* CPC issues each outlook for the month(s) after the issue month. */
      var a=new Date(d.getUTCFullYear(),d.getUTCMonth()+1,1),b=new Date(a.getFullYear(),a.getMonth()+months-1,1);
      return 'valid '+MON[a.getMonth()]+(months>1?'–'+MON[b.getMonth()]:'')+' '+b.getFullYear()+', issued '+isoDay(lm);
    }
    var one=f['noaa_temp_30day.gif'],three=f['noaa_temp_90day.gif'];
    var o=one&&one.last_modified?valid(one.last_modified,1):null,t=three&&three.last_modified?valid(three.last_modified,3):null;
    nd.textContent=(o||t)?[o?'1-Month '+o:'',t?'3-Month '+t:''].filter(Boolean).join(' · '):'Issue dates: Not loaded yet';
  });

  /* ---------- run ---------- */
  /* rma-prices.json is about 430 KB; the insurance cell loads it only when
     it comes within reach of the screen (most phone visits never scroll
     that far). Same draw, later. */
  (function(){var c=cells.insurance;if(!c||!('IntersectionObserver' in window)){insurance();return;}
    var io=new IntersectionObserver(function(es){if(es.some(function(e){return e.isIntersecting;})){io.disconnect();insurance();}},{rootMargin:'800px 0px'});io.observe(c);})();
  cropModules();report();rent();prf();
  if(!hasLoc())setTimeout(paintWx,0);
})();
