/* Homepage: final planting dates (RMA, county or nothing), GDU and precipitation history, and the Local Conditions weather extras. Moved out of index.html (2026-10-11), loaded as a plain script in the same place, same order. */
(function(){
'use strict';
/* FINAL PLANTING DATES -- COUNTY OR NOTHING.
   This used to hold one date per state scraped from 2025 farm-magazine
   articles, plus a "national Corn Belt" pair for the 35 states its bounding
   boxes did not cover, and it rendered both under the label "RMA Final
   Planting Dates". The real RMA file disagrees inside almost every state it
   covered (17 Kansas counties are May 15 against a May 25 state default) and
   is wrong by six weeks outside them (Texas: 82 counties at Apr 15, shown
   May 31). Missing a final planting date costs a grower his revenue
   guarantee, so nothing is shown unless his own county is in the file. */
var _rmaWatching=false;
  function applyPlantingDates(lat,lon){
    /* No sync pass any more -- there is nothing truthful to render until the
       county is known, so the widget stays hidden until then.
       It also no longer needs lat/lon. Those were only ever used by the
       state-guessing that has been deleted; the county comes from
       waitForGeoCounty(), which polls what geo.js already resolved. Keeping
       the old guard meant the widget never appeared on the call that does not
       pass coordinates -- caught by rendering it, not by reading it. */
    if(_rmaWatching)return null; _rmaWatching=true;
    /* The county can arrive late (permission prompt + fix + reverse-geocode)
       and can CHANGE -- geo.js publishes a cached county first and corrects it
       when the real one resolves. Latching the first value showed a grower in
       Iowa a Texas deadline that had already passed. So: no deadline, and
       re-render whenever the pair changes. */
    var _rmaSeen='';
    (function watch(){
      var w=window.AGSIST_STATE&&window.AGSIST_STATE.weather;
      var key=w&&w.state&&w.county?(w.state+'|'+w.county):'';
      if(key&&key!==_rmaSeen){ _rmaSeen=key; renderForCounty(w.state,w.county); }
      setTimeout(watch,400);
    })();
    return null;
  }

  function renderForCounty(state,county){
    Promise.all([loadRmaCountyData()]).then(function(res){
      var rma=res[0];
      var loc={state:state,county:county};
      if(!rma||!loc.state||!loc.county)return;
      if(!rma.index||!Object.keys(rma.index).length){ showRmaBroken(rma.data); return; }
      var entry=lookupCounty(rma.index,loc.state,loc.county);
      if(!entry){
        /* A miss used to be a console.info and nothing else, which left a
           guessed state date standing on screen with no way to know the
           lookup had failed. Now it says so and points at the source. */
        showRmaMiss(loc.county,loc.state,rma.data);
        return;
      }
      renderPlantingDates(entry,rma.data);
    }).catch(function(e){console.warn('[AGSIST] county RMA lookup failed:',e);});
    return null;
  }

  function rmaSourceLine(data,extra){
    var url=(data&&data.source_url)||'https://public-rma.fpac.usda.gov/apps/mapviewer/dates';
    var up=(data&&data.updated)||'';
    return (extra?extra+' ':'')+
      'USDA RMA Revenue Protection final planting dates, '+((data&&data.crop_year)||'')+' crop year'+
      (up?', updated '+up:'')+'. <a href="'+url+'" target="_blank" rel="noopener">Check the RMA map viewer</a> '+
      'and confirm with your crop insurance agent before you plant.';
  }

  function showRmaBroken(data){
    /* An empty index is a pipeline failure, not a county that is missing.
       Telling a grower in a covered county "your county is not in this
       dataset" tells him to stop looking. */
    var w=document.getElementById('rma-widget');if(!w)return;
    var t=document.getElementById('rma-title'),l=document.getElementById('rma-loc'),
        c=document.getElementById('rma-corn'),b=document.getElementById('rma-bean'),
        e=document.getElementById('rma-bean-est'),src=document.getElementById('rma-src');
    if(t)t.textContent='Final planting dates';
    if(l)l.textContent='';
    if(c)c.textContent='-'; if(b)b.textContent='-'; if(e)e.hidden=true;
    if(src)src.innerHTML=rmaSourceLine(data,'<strong>The planting-date file could not be read.</strong>');
    w.hidden=false;
  }

  function showRmaMiss(county,state,data){
    var w=document.getElementById('rma-widget');if(!w)return;
    var t=document.getElementById('rma-title'),l=document.getElementById('rma-loc'),
        c=document.getElementById('rma-corn'),b=document.getElementById('rma-bean'),
        e=document.getElementById('rma-bean-est'),src=document.getElementById('rma-src');
    if(t)t.textContent='Final planting dates';
    if(l)l.textContent=String(county||'')+', '+String(state||'');
    if(c)c.textContent='-';
    if(b)b.textContent='-';
    if(e)e.hidden=true;
    if(src)src.innerHTML=rmaSourceLine(data,'<strong>Your county is not in this dataset.</strong>');
    w.hidden=false;
  }

  function renderPlantingDates(entry,data){
    var w=document.getElementById('rma-widget');if(!w)return;
    var t=document.getElementById('rma-title'),l=document.getElementById('rma-loc'),
        c=document.getElementById('rma-corn'),b=document.getElementById('rma-bean'),
        e=document.getElementById('rma-bean-est'),src=document.getElementById('rma-src');
    /* THE CROP YEAR IS READ. parseMonthDayIso() used to stamp "May 31" with
       whatever year the browser happened to be in, so on 2027-03-01 a 2026
       file would have counted down to a 2027 deadline that may not exist.
       Dates are built from the file's own crop_year, and when that is not the
       current year the countdown is suppressed and the year is stated. */
    var cy=+((data&&data.crop_year)||0)||null;
    var nowY=new Date().getFullYear();
    var current=(cy===nowY);
    if(t)t.textContent='Final planting dates'+(cy?' \u00b7 '+cy+' crop':'');
    if(l)l.textContent=entry.countyName+' County, '+entry.state;

    function put(el,label,iso,isEstimate){
      if(!el)return;
      if(!label){el.textContent='-';return;}
      var d=current?daysUntil(iso):null;
      el.className='rma-d-v'+(d!=null&&d<0?' past':(d!=null&&d<=14?' soon':''));
      el.textContent=label+(d!=null?' \u00b7 '+formatCountdown(d):'');
    }
    put(c,entry.cornLabel,entry.corn,false);
    /* PROVENANCE, SHOWN. 1,786 of the 2,320 soybean dates in this file are
       not RMA dates -- 618 are "corn + 20 days" and the file itself says
       "verify at source_url". The source field was indexed and never read,
       so all four classes rendered identically. An estimated date gets no
       countdown, because a countdown is what makes it look like a deadline. */
    var soyIsReal=(entry.source==='RMA');
    if(soyIsReal){ put(b,entry.beansLabel,entry.beans,false); if(e)e.hidden=true; }
    else {
      if(b){ b.className='rma-d-v'; b.textContent=entry.beansLabel||'-'; }
      if(e){ e.textContent='estimated, not an RMA date, confirm it'; e.hidden=false; }
    }
    if(src)src.innerHTML=rmaSourceLine(data, current?'':'<strong>'+
      (cy?'These are '+cy+' crop-year dates and it is now '+nowY+'.'
         :'This file does not state a crop year, so no countdown is shown.')+'</strong>');
    /* r7-season: once both dates have passed, the card steps back. */
    w.hidden=!!(current&&entry.corn&&daysUntil(entry.corn)<0&&(!entry.beans||daysUntil(entry.beans)<0));
  }

  // County-level RMA data: fetched once per page, cached, indexed by state+normalized-county-name.
var _rmaDataPromise=null;
function loadRmaCountyData(){
  if(_rmaDataPromise)return _rmaDataPromise;
  _rmaDataPromise=fetch('/data/rma-planting-dates.json').then(function(r){
    if(!r.ok)throw new Error('rma fetch '+r.status);
    return r.json();
  }).then(function(data){
    var counties=(data&&data.counties)||{},idx={};
    var cy=(data&&data.crop_year)||null;
    for(var fips in counties){
      var e=counties[fips];if(!e||!e.state||!e.county)continue;
      var row={
        corn:parseMonthDayIso(e.corn,cy),cornLabel:e.corn,
        beans:parseMonthDayIso(e.soybeans,cy),beansLabel:e.soybeans,
        fips:fips,countyName:e.county,state:e.state,source:e.source
      };
      var ks=countyKeys(e.state,e.county);
      for(var i=0;i<ks.length;i++){ if(!idx[ks[i]]) idx[ks[i]]=row; }
    }
    return {data:data,index:idx};
  }).catch(function(err){console.warn('[AGSIST] RMA county data load failed:',err);_rmaDataPromise=null;return null;});
  return _rmaDataPromise;
}
function normalizeCountyName(n){
  return String(n||'').toLowerCase()
    .replace(/\s+county$/,'').replace(/\s+parish$/,'').replace(/\s+city$/,'')
    .replace(/^saint\s+/,'st ').replace(/\bst\.\s*/g,'st ')
    .replace(/\./g,'').replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
}
function parseMonthDayIso(s,yr){
  /* "May 31" -> "2026-05-31". The year is the FILE'S crop_year, passed in.
     This used to use new Date().getFullYear(), so a 2026 file silently
     re-stamped itself every January and counted down to a deadline that had
     already passed or had moved. */
  var m=String(s||'').match(/^(\w+)\s+(\d+)$/);if(!m)return null;
  var MO={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  var mon=MO[m[1].toLowerCase().slice(0,3)];if(!mon)return null;
  var day=+m[2];
  var y=+yr||new Date().getFullYear();
  return y+'-'+(mon<10?'0':'')+mon+'-'+(day<10?'0':'')+day;
}

/* COUNTY NAMES DO NOT MATCH ON THE NOSE. The RMA file spells "O Brien",
   "De Witt", "St Genevieve"; the reverse-geocoder returns "O'Brien County",
   "DeWitt County", "Ste. Genevieve County". Normalising both sides still
   leaves "o brien" against "obrien", so every one of those counties missed
   and the reader was shown a state guess with no sign anything had failed.
   Each row is therefore indexed under its spaced form AND its de-spaced
   form, and the lookup tries both. */
function countyKeys(state,name){
  var n=normalizeCountyName(name);
  var flat=n.replace(/\s+/g,'');
  var ste=n.replace(/^ste\s+/,'st ');
  var out=[state+'|'+n, state+'|'+flat];
  if(ste!==n){ out.push(state+'|'+ste, state+'|'+ste.replace(/\s+/g,'')); }
  return out;
}
function lookupCounty(idx,state,county){
  var ks=countyKeys(state,county);
  for(var i=0;i<ks.length;i++){ if(idx[ks[i]]) return idx[ks[i]]; }
  return null;
}
// v2: geo.js populates window.AGSIST_STATE.weather.{state,county} after its own
// Nominatim reverse-geocode resolves (~1–2s after geo). We poll briefly rather
// than fire a second reverse-geocode. Matches the existing waitForGeo pattern
// used elsewhere in this file.
function waitForGeoCounty(timeoutMs){
  timeoutMs=timeoutMs||6000;
  return new Promise(function(resolve){
    var deadline=Date.now()+timeoutMs;
    (function check(){
      var w=window.AGSIST_STATE&&window.AGSIST_STATE.weather;
      if(w&&w.state&&w.county){resolve({state:w.state,county:w.county});return;}
      if(Date.now()>deadline){console.info('[AGSIST] geo.js did not populate state+county within '+timeoutMs+'ms, county-level RMA dates unavailable');resolve(null);return;}
      setTimeout(check,200);
    })();
  });
}
var GDU_BASE_MAX=86,GDU_BASE_MIN=50;
function calcGDU(tMaxC,tMinC){var tMaxF=(tMaxC*9/5)+32,tMinF=(tMinC*9/5)+32;var hi=Math.min(tMaxF,GDU_BASE_MAX),lo=Math.max(tMinF,GDU_BASE_MIN);return Math.max(0,(hi+lo)/2-GDU_BASE_MIN);}
function daysUntil(iso){
  /* Calendar-date difference. The old noon-anchored Math.ceil made the answer
     a function of the time of day: a 31 May deadline read "1 day" at 07:00 on
     31 May and "Today" at 07:00 on 1 June. Same fix as whats-priced-in.html,
     which has carried it since the 2026-08-11 audit. */
  if(!iso)return null;
  var p=String(iso).split('-'); if(p.length!==3)return null;
  var t=new Date(+p[0],+p[1]-1,+p[2]).getTime(); if(isNaN(t))return null;
  var n=new Date(); n.setHours(0,0,0,0);
  return Math.round((t-n.getTime())/86400000);
}
function formatCountdown(days){if(days==null)return'-';if(days<0)return'Past';if(days===0)return'Today';return days+' day'+(days===1?'':'s');}
function waitForGeo(cb,retries){retries=retries||0;if(retries>20)return;var st=window.AGSIST_STATE;if(st&&st.weather&&st.weather.lat!=null){cb(st);}else{setTimeout(function(){waitForGeo(cb,retries+1);},400);}}

// ---------- Monthly aggregation from Open-Meteo archive ----------
function aggregateArchive(dailyHist){
  // dailyHist = {time:[], temperature_2m_max:[], temperature_2m_min:[], precipitation_sum:[]}
  // Returns {byYearMonth: {year:{month:{gdu,precip}}}, dailyLookup: {isoDate:{max,min,precip}}}
  var times=(dailyHist&&dailyHist.time)||[];
  var maxT=(dailyHist&&dailyHist.temperature_2m_max)||[];
  var minT=(dailyHist&&dailyHist.temperature_2m_min)||[];
  var pr=(dailyHist&&dailyHist.precipitation_sum)||[];
  var byYM={},daily={};
  for(var i=0;i<times.length;i++){
    var iso=times[i];if(!iso)continue;
    var parts=iso.split('-');
    var y=+parts[0],m=+parts[1]-1; // 0-indexed month
    if(isNaN(y)||isNaN(m))continue;
    if(!byYM[y])byYM[y]={};
    if(!byYM[y][m])byYM[y][m]={gdu:0,precip:0,nDays:0};
    var hi=maxT[i],lo=minT[i],p=pr[i];
    if(hi!=null&&lo!=null){
      var hc=Math.min(hi,86),lc=Math.max(lo,50);
      byYM[y][m].gdu+=Math.max(0,(hc+lc)/2-50);
    }
    if(p!=null)byYM[y][m].precip+=p;
    byYM[y][m].nDays++;
    daily[iso]={max:hi,min:lo,precip:p};
  }
  return {byYearMonth:byYM,daily:daily};
}
// ---------- YTD comparison helpers ----------
function ytdGDU(dailyMap,year,fromIso,toIso){
  // Sum GDU from fromIso (YYYY-MM-DD) to toIso inclusive
  var sum=0;
  for(var iso in dailyMap){
    if(iso<fromIso||iso>toIso)continue;
    var d=dailyMap[iso];
    if(d.max!=null&&d.min!=null){
      var hi=Math.min(d.max,86),lo=Math.max(d.min,50);
      sum+=Math.max(0,(hi+lo)/2-50);
    }
  }
  return sum;
}
function ytdPrecip(dailyMap,fromIso,toIso){
  var sum=0;
  for(var iso in dailyMap){
    if(iso<fromIso||iso>toIso)continue;
    if(dailyMap[iso].precip!=null)sum+=dailyMap[iso].precip;
  }
  return sum;
}
function padIso(y,m,d){
  return y+'-'+(m<10?'0':'')+m+'-'+(d<10?'0':'')+d;
}
// v4.5: measure available chart width from the panel's visible parent (panel itself may be display:none)
function wxChartWidth(panelId){
  try{
    var p=document.getElementById(panelId);
    var host=p&&p.parentElement?p.parentElement:null;
    var w=host?host.clientWidth:0;
    if(!w||w<100)return 360;
    return w-22; // panel horizontal padding
  }catch(e){return 360;}
}
// ---------- SVG monthly bar chart (paired bars: avg + current) ----------
function monthlyChartSvg(current,avg,monthLabels,fmtFn,pxWidth){
  var mx=0;
  for(var i=0;i<monthLabels.length;i++){
    if(current[i]>mx)mx=current[i];
    if(avg[i]>mx)mx=avg[i];
  }
  if(mx<0.01)mx=1; // avoid divide-by-zero
  var scaleMax=mx*1.16; // v4.6: 16% headroom — tallest bar's value label sits in clear space, never on the bar (was yellow-on-yellow)
  // v4.5: viewBox width tracks the rendered px width so font units ~= real px (legible on phones)
  var W=Math.max(300,Math.min(760,Math.round(pxWidth||360))),H=180,PL=38,PR=8,PT=22,PB=28;
  var cw=W-PL-PR,ch=H-PT-PB;
  var n=monthLabels.length;
  var gw=cw/n;
  var bw=Math.max(5,Math.min(18,gw*0.36));
  var gap=2;
  var vf=(n<=8)?10:9; // value-label font; slightly smaller when 12 months so they don't crowd
  var out='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;display:block" role="img" aria-label="Monthly comparison: this year vs 5-year average">';
  // horizontal gridlines + y-axis value labels at 0/25/50/75/100% of max
  var fracs=[0,0.25,0.5,0.75,1];
  for(var g=0;g<fracs.length;g++){
    var gy=PT+ch-(fracs[g]*(mx/scaleMax)*ch);
    out+='<line x1="'+PL+'" y1="'+gy.toFixed(1)+'" x2="'+(W-PR)+'" y2="'+gy.toFixed(1)+'" stroke="#ffffff" stroke-opacity="'+(g===0?'0.20':'0.06')+'" stroke-width="0.5"/>';
    out+='<text x="'+(PL-5)+'" y="'+(gy+3.2).toFixed(1)+'" font-size="10" fill="#aab4ae" text-anchor="end" font-family="JetBrains Mono,monospace">'+fmtFn(mx*fracs[g])+'</text>';
  }
  for(var j=0;j<n;j++){
    var gx=PL+gw*j+gw/2;
    var aH=(avg[j]/scaleMax)*ch,aY=PT+ch-aH;
    var aX=gx-bw-gap/2;
    out+='<rect x="'+aX.toFixed(1)+'" y="'+aY.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+Math.max(0.5,aH).toFixed(1)+'" fill="#5fc28a" fill-opacity="0.5" rx="1.2"/>';
    if(current[j]>0){
      var cH=(current[j]/scaleMax)*ch,cY=PT+ch-cH;
      var cX=gx+gap/2;
      out+='<rect x="'+cX.toFixed(1)+'" y="'+cY.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+Math.max(0.5,cH).toFixed(1)+'" fill="#d4a23f" rx="1.2"/>';
      var vY=Math.max(PT+9,cY-5);
      out+='<text x="'+(cX+bw/2).toFixed(1)+'" y="'+vY.toFixed(1)+'" font-size="'+vf+'" fill="#e9edeb" text-anchor="middle" font-family="JetBrains Mono,monospace" font-weight="700" stroke="#0a0c0d" stroke-width="2.5" paint-order="stroke">'+fmtFn(current[j])+'</text>';
    }
    out+='<text x="'+gx.toFixed(1)+'" y="'+(H-8)+'" font-size="11" fill="#b2bbb5" text-anchor="middle" font-family="JetBrains Mono,monospace">'+monthLabels[j]+'</text>';
  }
  out+='</svg>';
  return out;
}
// ---------- Chart toggle wiring ----------
function wireChartToggle(statId,panelId,toggleId){
  var stat=document.getElementById(statId),panel=document.getElementById(panelId),tog=document.getElementById(toggleId);
  if(!stat||!panel||!tog)return;
  function togglePanel(e){
    if(e)e.stopPropagation();
    var open=panel.classList.toggle('expanded');
    stat.setAttribute('aria-expanded',open?'true':'false');
    tog.innerHTML=open?'\u25B2 Hide':'\u25BC History';
  }
  stat.addEventListener('click',togglePanel);
  stat.addEventListener('keydown',function(ev){if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();togglePanel(ev);}});
}
function wireHourlyToggle(){
  var btn=document.getElementById('wx-hourly-toggle'),panel=document.getElementById('wx-hourly-panel');
  if(!btn||!panel)return;
  btn.addEventListener('click',function(){
    var open=panel.classList.toggle('expanded');
    btn.setAttribute('aria-expanded',open?'true':'false');
    btn.innerHTML=open?'\u25B2 Hide hourly':'\u25BC Hourly';
    // auto-scroll "now" cell into view when opening
    if(open){var nowCell=panel.querySelector('.wx-hourly-cell.now');if(nowCell&&nowCell.scrollIntoView){try{nowCell.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});}catch(e){}}}
  });
}
// ---------- Weather code -> icon (Open-Meteo WMO codes) ----------
function wxIcon(code,isDay){
  if(code==null)return '<svg class="ic" aria-hidden="true"><use href="#i-cloud-sun"/></svg>';
  if(code===0)return isDay?'<svg class="ic" aria-hidden="true"><use href="#i-sun"/></svg>':'<svg class="ic" aria-hidden="true"><use href="#i-moon"/></svg>'; // clear
  if(code===1||code===2)return '<svg class="ic" aria-hidden="true"><use href="#i-cloud-sun"/></svg>'; // partly cloudy
  if(code===3)return '<svg class="ic" aria-hidden="true"><use href="#i-cloud"/></svg>'; // overcast
  if(code===45||code===48)return '<svg class="ic" aria-hidden="true"><use href="#i-cloud-fog"/></svg>'; // fog
  if(code>=51&&code<=57)return '<svg class="ic" aria-hidden="true"><use href="#i-cloud-sun-rain"/></svg>'; // drizzle
  if(code>=61&&code<=67)return '<svg class="ic" aria-hidden="true"><use href="#i-cloud-rain"/></svg>'; // rain
  if(code>=71&&code<=77)return '<svg class="ic" aria-hidden="true"><use href="#i-snowflake"/></svg>'; // snow
  if(code>=80&&code<=82)return '<svg class="ic" aria-hidden="true"><use href="#i-cloud-sun-rain"/></svg>'; // showers
  if(code===85||code===86)return '<svg class="ic" aria-hidden="true"><use href="#i-snowflake"/></svg>'; // snow showers
  if(code>=95)return '<svg class="ic" aria-hidden="true"><use href="#i-cloud-lightning"/></svg>'; // thunderstorm
  return '<svg class="ic" aria-hidden="true"><use href="#i-cloud-sun"/></svg>';
}
// ---------- Wind direction: degrees to compass ----------
function windDir(deg){
  if(deg==null||isNaN(+deg))return '';
  var dirs=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round((+deg%360)/22.5)%16];
}
function loadWeatherEnhancements(state){
  var wx=state.weather||{},lat=wx.lat,lon=wx.lon;
  if(lat==null||lon==null||isNaN(+lat)||isNaN(+lon))return;
  var today=new Date();
  var thisApr1=new Date(today.getFullYear(),3,1);
  var d_apr1=thisApr1.toISOString().split('T')[0];
  // Use yesterday as archive end_date — today's data is often not yet available
  var yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);
  var d_yest=yesterday.toISOString().split('T')[0];
  // Extend archive back 5 full years (Jan 1 of year-5) for monthly comparisons
  var fiveYrsAgo=new Date(today.getFullYear()-5,0,1);
  var d_5yr=fiveYrsAgo.toISOString().split('T')[0];
  var soilUrl='https://api.open-meteo.com/v1/forecast?latitude='+lat+'&longitude='+lon+'&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,windspeed_10m_max,winddirection_10m_dominant,relative_humidity_2m_mean,weathercode,wind_gusts_10m_max&hourly=temperature_2m,precipitation,precipitation_probability,wind_speed_10m,wind_direction_10m,weathercode,soil_temperature_6cm,soil_temperature_18cm&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=5';
  var histUrl='https://archive-api.open-meteo.com/v1/archive?latitude='+lat+'&longitude='+lon+'&start_date='+d_5yr+'&end_date='+d_yest+'&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto';
  // Fetch independently — archive failure must not kill forecast/soil temp
  var fcastPromise=fetch(soilUrl).then(function(r){return r.json();}).then(function(d){
    if(d&&d.error){console.warn('[AGSIST] Open-Meteo forecast error:',d.reason||d.error);return null;}
    return d;
  }).catch(function(e){console.warn('[AGSIST] forecast fetch failed',e);return null;});
  var histPromise=fetch(histUrl).then(function(r){return r.json();}).then(function(d){
    if(d&&d.error){console.warn('[AGSIST] Open-Meteo archive error:',d.reason||d.error);return null;}
    return d;
  }).catch(function(e){console.warn('[AGSIST] archive fetch failed',e);return null;});
  Promise.all([fcastPromise,histPromise]).then(function(results){
    var forecast=results[0]||{},history=results[1]||{};try{if(window.S7)window.S7.onWx(results[0]);}catch(e){}
    var dailyF=forecast.daily||{},dailyH=history.daily||{};
    // GDU + precip30 scalars removed — computed via aggregateArchive+ytdGDU/ytdPrecip below for 5-yr comparison
    // Soil temp — use current local hour from time array; fall back to nearest non-null, then daily average
    var soilEstF=null;
    var hourSoilArr=(forecast.hourly&&forecast.hourly.soil_temperature_6cm)||[];
    var hourTimeArr=(forecast.hourly&&forecast.hourly.time)||[];
    if(hourSoilArr.length>0){
      var nowMs=Date.now();
      var bestIdx=-1,bestDiff=Infinity;
      for(var hi=0;hi<hourTimeArr.length;hi++){
        if(hourSoilArr[hi]==null)continue;
        var hT=new Date(hourTimeArr[hi]).getTime();
        if(isNaN(hT))continue;
        var diff=Math.abs(nowMs-hT);
        if(diff<bestDiff){bestIdx=hi;bestDiff=diff;}
      }
      if(bestIdx>=0){
        soilEstF=Math.round(hourSoilArr[bestIdx]);
      } else {
        // fallback: average today's available hourly values
        var ss=0,sc=0;
        for(var si=0;si<Math.min(24,hourSoilArr.length);si++){if(hourSoilArr[si]!=null){ss+=hourSoilArr[si];sc++;}}
        if(sc>0)soilEstF=Math.round(ss/sc);
      }
    }
    if(soilEstF==null){console.warn('[AGSIST] soil temp unavailable, hourly keys:',Object.keys((forecast&&forecast.hourly)||{}),'arr len:',hourSoilArr.length);}
    var soilClass='warn',soilCtx='';
    if(soilEstF!=null){
      if(soilEstF<32){soilClass='cold';soilCtx='Too cold for field work';}
      else if(soilEstF<40){soilClass='cold';soilCtx='Cold, wait for warmup';}
      else if(soilEstF<50){soilClass='warn';soilCtx='Approaching planting threshold';}
      else if(soilEstF<55){soilClass='warn';soilCtx='Near planting threshold (50\xb0F)';}
      else if(soilEstF<60){soilClass='good';soilCtx='Good for planting';}
      else{soilClass='good';soilCtx='Excellent planting conditions';}
    }
    var soilDisplay=soilEstF!=null?soilEstF+'\xb0F':'--\xb0F';
    var stv=document.getElementById('soil-temp-val');
    if(stv){stv.textContent=soilDisplay;stv.className='soil-temp-val '+soilClass;}
    var stc=document.getElementById('soil-temp-ctx');if(stc)stc.textContent=soilCtx;
    var str=document.getElementById('soil-temp-row');if(str)str.classList.add('loaded');
    var gduStat=document.getElementById('gdu-stat');if(gduStat)gduStat.classList.add('loaded');
    var precipStat=document.getElementById('precip-stat');if(precipStat)precipStat.classList.add('loaded');
    // gdu-val and precip-val text set by INTEGRATION block after YTD calc
    // Update Quick Tools planting dates location label with detected city + state-aware dates
    var detectedState=applyPlantingDates(lat,lon);
    var _wxSt=state.weather||{};
    var _locLabel=document.getElementById('plant-dates-loc');
    if(_locLabel){
      var _locBase=_wxSt.city?_wxSt.city:(_wxSt.zip?'ZIP '+_wxSt.zip:'');
      var _locSuffix=detectedState?(_locBase?_locBase+', '+detectedState:detectedState):_locBase;
      _locLabel.textContent=_locSuffix?'<svg class="ic" aria-hidden="true"><use href="#i-map-pin"/></svg> RMA Dates, '+_locSuffix:'<svg class="ic" aria-hidden="true"><use href="#i-map-pin"/></svg> RMA Final Planting Dates';
    }
    // ========== HISTORICAL CHARTS (GDU + precip, 5-yr monthly) ==========
    var agg=aggregateArchive(dailyH);
    var curYear=today.getFullYear();
    var pastYears=[];
    for(var yy=curYear-5;yy<curYear;yy++)pastYears.push(yy);
    var gduMonths=[3,4,5,6,7,8,9]; // Apr..Oct
    var gduCurrent=[],gduAvg=[],gduLabels=['Apr','May','Jun','Jul','Aug','Sep','Oct'];
    for(var gi=0;gi<gduMonths.length;gi++){
      var mi=gduMonths[gi];
      var curV=(agg.byYearMonth[curYear]&&agg.byYearMonth[curYear][mi])?agg.byYearMonth[curYear][mi].gdu:0;
      var sum=0,cnt=0;
      for(var py=0;py<pastYears.length;py++){
        var yym=agg.byYearMonth[pastYears[py]];
        if(yym&&yym[mi]){sum+=yym[mi].gdu;cnt++;}
      }
      gduCurrent.push(Math.round(curV));
      gduAvg.push(cnt>0?Math.round(sum/cnt):0);
    }
    var gduSvgEl=document.getElementById('gdu-chart-svg');
    if(gduSvgEl)gduSvgEl.innerHTML=monthlyChartSvg(gduCurrent,gduAvg,gduLabels,function(v){return Math.round(v);},wxChartWidth('gdu-chart-panel'));
    // Precip: full 12-month
    var prCurrent=[],prAvg=[];
    var moLabels=['J','F','M','A','M','J','J','A','S','O','N','D'];
    for(var mo=0;mo<12;mo++){
      var cV=(agg.byYearMonth[curYear]&&agg.byYearMonth[curYear][mo])?agg.byYearMonth[curYear][mo].precip:0;
      var sP=0,cP=0;
      for(var py2=0;py2<pastYears.length;py2++){
        var yym2=agg.byYearMonth[pastYears[py2]];
        if(yym2&&yym2[mo]){sP+=yym2[mo].precip;cP++;}
      }
      prCurrent.push(Math.round(cV*10)/10);
      prAvg.push(cP>0?Math.round((sP/cP)*10)/10:0);
    }
    var prSvgEl=document.getElementById('precip-chart-svg');
    if(prSvgEl)prSvgEl.innerHTML=monthlyChartSvg(prCurrent,prAvg,moLabels,function(v){return (Math.round(v*10)/10)+'"';},wxChartWidth('precip-chart-panel'));
    // ========== YTD STATS — % vs 5-yr same-period avg ==========
    // GDU YTD: Apr 1 current year → yesterday. Compare to same (Apr 1 → same month/day) for past 5 years.
    var todayIso=d_yest; // same window end as archive
    var thisApr1Iso=d_apr1;
    var curGDU=ytdGDU(agg.daily,curYear,thisApr1Iso,todayIso);
    var pastGDUs=[];
    var yToday=yesterday; // Date obj
    for(var py3=0;py3<pastYears.length;py3++){
      var y=pastYears[py3];
      var fromI=y+'-04-01';
      var toI=padIso(y,yToday.getMonth()+1,yToday.getDate());
      pastGDUs.push(ytdGDU(agg.daily,y,fromI,toI));
    }
    var gduAvg5=pastGDUs.length?pastGDUs.reduce(function(a,b){return a+b;},0)/pastGDUs.length:0;
    var gduPct=gduAvg5>10?Math.round(((curGDU-gduAvg5)/gduAvg5)*100):null;
    var gduCtxEl=document.getElementById('gdu-ctx');
    /* Signed number with a true minus sign (U+2212), not a hyphen. */
    function sgnN(n){return (n>0?'+':n<0?'\u2212':'')+Math.abs(n);}
    if(gduCtxEl&&gduPct!=null){
      var cls=Math.abs(gduPct)<5?'':(gduPct>0?'warm':'cool');
      gduCtxEl.innerHTML='vs 5-yr avg: <span style="font-weight:700;color:'+(cls==='warm'?'#d4a23f':cls==='cool'?'#5ba3e0':'var(--text)')+'">'+sgnN(gduPct)+'%</span>';
    } else if(gduCtxEl){
      gduCtxEl.textContent='';
    }
    // Precip: trailing 30 days vs same 30-day window avg of past 5 years
    var win=new Date(yesterday);win.setDate(win.getDate()-29);
    var winStartIso=win.toISOString().split('T')[0];
    var curPrecip=ytdPrecip(agg.daily,winStartIso,todayIso);
    var pastPrecips=[];
    for(var py4=0;py4<pastYears.length;py4++){
      var y2=pastYears[py4];
      // same 30-day calendar window in past year
      var pEnd=new Date(y2,yesterday.getMonth(),yesterday.getDate());
      var pStart=new Date(pEnd);pStart.setDate(pStart.getDate()-29);
      var fI=pStart.toISOString().split('T')[0],tI=pEnd.toISOString().split('T')[0];
      pastPrecips.push(ytdPrecip(agg.daily,fI,tI));
    }
    var prAvg5=pastPrecips.length?pastPrecips.reduce(function(a,b){return a+b;},0)/pastPrecips.length:0;
    var prPct=prAvg5>0.1?Math.round(((curPrecip-prAvg5)/prAvg5)*100):null;
    var prCtxEl=document.getElementById('precip-ctx');
    if(prCtxEl&&prPct!=null){
      var prCls=Math.abs(prPct)<10?'':(prPct>0?'wet':'dry');
      prCtxEl.innerHTML='vs 5-yr avg: <span style="font-weight:700;color:'+(prCls==='wet'?'#5ba3e0':prCls==='dry'?'#d4a23f':'var(--text)')+'">'+sgnN(prPct)+'%</span>';
    } else if(prCtxEl){
      prCtxEl.textContent='';
    }
    // ----- Plain-language takeaways: absolute delta + vs-normal + what it means -----
    var gduTk=document.getElementById('gdu-takeaway');
    if(gduTk){
      if(gduPct!=null){
        var dGdu=Math.round(curGDU-gduAvg5);
        var gduDir=gduPct>2?'ahead of':(gduPct<-2?'behind':'on pace with');
        var gduMsg=gduPct>2?'Heat is building faster than normal, crops are developing ahead of schedule.':(gduPct<-2?'Heat units are running behind, slower crop development so far this year.':'Heat accumulation is right about average for this point in the season.');
        gduTk.innerHTML='<strong>'+sgnN(dGdu)+' GDU</strong> '+gduDir+' the 5-yr average ('+sgnN(gduPct)+'%). '+gduMsg;
      } else { gduTk.textContent=''; }
    }
    var prTk=document.getElementById('precip-takeaway');
    if(prTk){
      if(prPct!=null){
        var dPr=Math.round((curPrecip-prAvg5)*10)/10;
        var prDir=prPct>5?'above':(prPct<-5?'below':'near');
        var prMsg=prPct>15?'Much wetter than normal. Watch for saturated fields and delayed work.':(prPct>5?'A bit wetter than the 5-yr norm.':(prPct<-15?'Running dry versus normal, keep an eye on moisture stress.':(prPct<-5?'Slightly drier than the 5-yr norm.':'Rainfall is close to the 5-yr normal over the last 30 days.')));
        prTk.innerHTML='<strong>'+sgnN(dPr)+'\"</strong> '+prDir+' the 5-yr average ('+sgnN(prPct)+'%). '+prMsg;
      } else { prTk.textContent=''; }
    }
    // Override the basic values with cleaner display (already set earlier in loop above)
    var _s7h=((dailyH&&dailyH.time)||[]).length>0;var gduEl2=document.getElementById('gdu-val');if(gduEl2)gduEl2.textContent=_s7h?Math.round(curGDU)+' GDU':'Not loaded yet';
    var prEl2=document.getElementById('precip-val');if(prEl2)prEl2.textContent=_s7h?(Math.round(curPrecip*10)/10)+'"':'Not loaded yet';
    var forecastMaxArr=dailyF.temperature_2m_max||[],forecastMinArr=dailyF.temperature_2m_min||[];
    var forecastPrecipArr=dailyF.precipitation_sum||[],forecastWindArr=dailyF.windspeed_10m_max||[];
    var forecastHumidArr=dailyF.relative_humidity_2m_mean||[];
    /* r7-season: the per-day badges and the summary sentence come from
       the one spray rule (S7.spray), the same one the tile uses. */
    if(window.S7)window.S7.spray({max:forecastMaxArr,min:forecastMinArr,rain:forecastPrecipArr,wind:forecastWindArr,rh:forecastHumidArr,gust:dailyF.wind_gusts_10m_max||[],pop:dailyF.precipitation_probability_max||[],code:dailyF.weathercode||dailyF.weather_code||[],gduPct:(typeof gduPct==='number'?gduPct:null),prPct:(typeof prPct==='number'?prPct:null)});

    // ========== 7-DAY FORECAST ==========
    var forecastWcodeArr=dailyF.weathercode||[];
    var forecastPrPctArr=dailyF.precipitation_probability_max||[];
    var forecastWdirArr=dailyF.winddirection_10m_dominant||[];
    var sevenEl=document.getElementById('wx-forecast-7day');
    if(sevenEl&&forecastMaxArr.length>=1){
      var dayNames7=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      var todayDow7=new Date().getDay();
      var cells7=sevenEl.querySelectorAll('.wx-7day-cell');
      for(var fd2=0;fd2<Math.min(5,cells7.length,forecastMaxArr.length);fd2++){
        var mx2=forecastMaxArr[fd2],mn2=forecastMinArr[fd2];
        var pr2=forecastPrecipArr[fd2],prPct=forecastPrPctArr[fd2];
        var wd2=forecastWindArr[fd2],wdir=forecastWdirArr[fd2];
        var wc2=forecastWcodeArr[fd2];
        var ic2=wxIcon(wc2,true);
        var nm2=fd2===0?'Today':fd2===1?'Tmrw':dayNames7[(todayDow7+fd2)%7];
        var cell=cells7[fd2];
        var nmE=cell.querySelector('.wx-7day-name'),icE=cell.querySelector('.wx-7day-icon');
        var tmE=cell.querySelector('.wx-7day-temps'),mtE=cell.querySelector('.wx-7day-meta');
        if(nmE)nmE.textContent=nm2;
        if(icE)icE.innerHTML=ic2;
        if(tmE)tmE.innerHTML='<span class="hi">'+(mx2!=null?Math.round(mx2):'--')+'\u00B0</span><span class="lo">'+(mn2!=null?Math.round(mn2):'--')+'\u00B0</span>';
        if(mtE){
          var prTxt=(pr2!=null&&pr2>0)?(Math.round(pr2*100)/100)+'"':(prPct!=null&&prPct>20?prPct+'%':'0"');
          var prCls=(pr2!=null&&pr2>0.15)||(prPct!=null&&prPct>50)?'rain-hi':'';
          var wdTxt=wd2!=null?Math.round(wd2)+'mph':'--';
          var wdCls=wd2!=null&&wd2>15?'wind-hi':'';
          var dirTxt=windDir(wdir);
          mtE.innerHTML='<div class="'+prCls+'"><svg class="ic" aria-hidden="true"><use href="#i-cloud-rain"/></svg> '+prTxt+'</div><div class="'+wdCls+'"><svg class="ic" aria-hidden="true"><use href="#i-wind"/></svg> '+(dirTxt?dirTxt+' ':'')+wdTxt+'</div>';
        }
      }
      var locLabelEl2=document.getElementById('wx-loc-label');
      if(locLabelEl2){
        var _st2=window.AGSIST_STATE;
        if(_st2&&_st2.weather&&_st2.weather.city)locLabelEl2.textContent=_st2.weather.city;
        else if(_st2&&_st2.weather&&_st2.weather.zip)locLabelEl2.textContent='ZIP '+_st2.weather.zip;
      }
    }
    // ========== HOURLY (next 24 hours from now) ==========
    var hTime=(forecast.hourly&&forecast.hourly.time)||[];
    var hTemp=(forecast.hourly&&forecast.hourly.temperature_2m)||[];
    var hPrecip=(forecast.hourly&&forecast.hourly.precipitation)||[];
    var hWind=(forecast.hourly&&forecast.hourly.wind_speed_10m)||[];
    var hWdir=(forecast.hourly&&forecast.hourly.wind_direction_10m)||[];
    var hWcode=(forecast.hourly&&forecast.hourly.weathercode)||[];
    var hourStrip=document.getElementById('wx-hourly-strip');
    if(hourStrip&&hTime.length>0){
      var nowMs2=Date.now();
      // Find the hour closest to now to mark as .now
      var nowIdx=0,nowDiff=Infinity;
      for(var hi2=0;hi2<hTime.length;hi2++){
        var hMs=new Date(hTime[hi2]).getTime();
        var df=Math.abs(nowMs2-hMs);
        if(df<nowDiff){nowDiff=df;nowIdx=hi2;}
      }
      // Show 24 hours starting from now
      var startI=Math.max(0,nowIdx);
      var endI=Math.min(hTime.length,startI+24);
      var cellsHtml='';
      for(var hxi=startI;hxi<endI;hxi++){
        var hd=new Date(hTime[hxi]);
        if(isNaN(hd))continue;
        var hh=hd.getHours();
        var hlbl=hh===0?'12a':hh<12?hh+'a':hh===12?'12p':(hh-12)+'p';
        var ht=hTemp[hxi]!=null?Math.round(hTemp[hxi])+'\u00B0':'--';
        var hp=hPrecip[hxi]!=null&&hPrecip[hxi]>0?(Math.round(hPrecip[hxi]*100)/100)+'"':'';
        var hw=hWind[hxi]!=null?Math.round(hWind[hxi])+'':'';
        var hwd=windDir(hWdir[hxi]);
        var hic=wxIcon(hWcode[hxi],hh>=6&&hh<20);
        var cls='wx-hourly-cell'+(hxi===nowIdx?' now':'');
        cellsHtml+='<div class="'+cls+'">'
          +'<div class="wx-hourly-hr">'+hlbl+'</div>'
          +'<div class="wx-hourly-icon">'+hic+'</div>'
          +'<div class="wx-hourly-temp">'+ht+'</div>'
          +'<div class="wx-hourly-precip">'+(hp||'&nbsp;')+'</div>'
          +'<div class="wx-hourly-wind">'+(hwd||'')+(hw?' '+hw:'')+'</div>'
          +'</div>';
      }
      hourStrip.innerHTML=cellsHtml;
    }
    // Wire the toggles (idempotent — guarded inside wireChartToggle/wireHourlyToggle)
    if(!window._agsist_toggles_wired){
      wireChartToggle('gdu-stat','gdu-chart-panel','gdu-chart-toggle');
      wireChartToggle('precip-stat','precip-chart-panel','precip-chart-toggle');
      wireHourlyToggle();
      window._agsist_toggles_wired=true;
    }
  }).catch(function(){});
}
// v18 FIX: GDU / 30-day precip / soil temp / charts / planting dates were
// pinned to the FIRST resolved location forever (_geoEnhDone one-shot guard).
// Entering a new ZIP updated the main weather card but never re-ran the
// enhancement block, so GDU and precip silently showed the old spot's data.
// Now: dedupe on coordinates (~1.4 mi) instead of a one-shot flag, and watch
// AGSIST_STATE.weather for location changes (ZIP entry, "Change location",
// background geo refresh) — any coordinate move re-pulls the whole block.
var _lastEnhLat=null,_lastEnhLon=null;
function _runEnhancements(lat,lon,state){
  if(lat==null||lon==null||isNaN(+lat)||isNaN(+lon))return;
  if(_lastEnhLat!=null&&Math.abs(lat-_lastEnhLat)<0.02&&Math.abs(lon-_lastEnhLon)<0.02)return;
  var isRefresh=(_lastEnhLat!=null);
  _lastEnhLat=lat;_lastEnhLon=lon;
  if(isRefresh){
    // Visible cue that the numbers are re-pulling for the new location
    ['gdu-val','precip-val','soil-temp-val'].forEach(function(id){var el=document.getElementById(id);if(el)el.textContent='…';});
    var _gc=document.getElementById('gdu-ctx');if(_gc)_gc.textContent='Updating…';
    var _pc=document.getElementById('precip-ctx');if(_pc)_pc.textContent='Updating…';
  }
  loadWeatherEnhancements(state||{weather:{lat:lat,lon:lon}});
}
// Primary: wait for geo.js state
waitForGeo(function(state){_runEnhancements(state.weather.lat,state.weather.lon,state);});
// Watch for location changes after initial load — geo.js updates
// AGSIST_STATE.weather.lat/lon whenever the user enters a ZIP or the
// background cache-verify finds they moved. Cheap 2-number compare.
// 2026-09-30: _runEnhancements() already short-circuits on an unchanged
// coordinate (see the ~0.02deg check above), so this was never doing real
// work most ticks — but it ran even with the tab backgrounded. Gated on
// visibility so a tab left open in a truck doesn't keep polling for no
// reader to see it.
setInterval(function(){
  if(document.visibilityState==='hidden')return;
  var st=window.AGSIST_STATE;
  if(st&&st.weather&&st.weather.lat!=null)_runEnhancements(st.weather.lat,st.weather.lon,st);
},2500);
// 2026-10-19 (Sig): no browser geolocation fallback here. It asked for the
// location 3.5 s after load; the page now asks only when the reader taps
// "Use my location" (geo.js requestGeo), and waitForGeo above picks that up.
// Planting dates — render immediately with national default; loadWeatherEnhancements overrides with state-specific once geo resolves
(function(){applyPlantingDates(null,null);})();
})();
