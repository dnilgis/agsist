#!/usr/bin/env python3
"""r7-season: the homepage changes with the month (2026-10-01).

Sig approved "seasonal rotation". One month-to-modules table (SEASON, in the
JS block below, all twelve months written out) decides what leads the page
and what steps back. Rows from the approved checklist this script covers:

  A  "This month" strip: insurance harvest price vs today's futures, harvest
     progress, frost, fall nitrogen window, next USDA report (October)
  B  out-of-season tiles step back by the table (planting dates, crop tour,
     GDU, hail)
  C  ZIP and jump chips in plain words
  D  briefing teaser: hidden once the report it names is out, otherwise
     stamped with the time it was written (CT); "Advertise here" moved out
     of the data strip
  E  Local Conditions: no 0 for a value that failed; overnight low with a
     frost flag; soil temperature; Field Scout promo moved out
  F  one spray rule for the summary sentence, the per-day badges and the
     Spray Advisory tile, reason printed, rule in a tooltip
  G  urea tile only in its season; fall N reading in fall
  H  radar and drought: "Not loaded yet"; Drought Monitor valid date
  I  NOAA outlooks: valid month and issue date from the mirror manifest
  J  harvest band open in October and November
  K  land band: Atlas leads Oct-Mar, hail Apr-Sep only, storage and
     foreign-held land off the homepage (linked)
  L  Quick Tools: planting dates hide once passed; harvest price link

Usage: python3 patch_home_r7_season.py --repo DIR
Runs after cutover (and r7-prices), before scripts/bake_homepage.py.
Every anchor must match exactly once, or the script stops.
"""
import argparse, os, re, sys

MARK = '/* ===== 2026-10-01 r7-season'

def once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        sys.exit('ANCHOR %s matched %d times, expected 1' % (label, n))
    return text.replace(old, new)

def rx_once(text, pattern, repl, label, flags=re.S):
    m = list(re.finditer(pattern, text, flags))
    if len(m) != 1:
        sys.exit('ANCHOR %s matched %d times, expected 1' % (label, len(m)))
    return text[:m[0].start()] + (repl(m[0]) if callable(repl) else repl) + text[m[0].end():]

def rd(p):
    with open(p, encoding='utf-8', newline='') as f:
        return f.read()

def wr(p, s):
    with open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)

# ──────────────────────────────────────────────────────────────────── CSS
CSS = r"""<style>
/* ===== 2026-10-01 r7-season: the page changes with the month =====
   The "This month" strip, plain chips, the briefing stamp, frost and soil in
   Local Conditions, one spray rule, and the seasonal show/hide classes the
   SEASON table sets on <html>. Hairlines, JetBrains Mono for numbers, no new
   gold. Ad orange only on the ad link. */
.s7-month{margin:0 0 24px;padding-top:12px;border-top:1px solid var(--hair,rgba(132,160,168,.12))}
.s7-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 4px}
.s7-h{font-family:var(--font-display,'Archivo',sans-serif);font-size:1.375rem;font-weight:800;line-height:1.2;margin:0;color:var(--text)}
.s7-k{font:700 .75rem/1.4 'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted)}
.s7-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0 16px}
.s7-c{display:flex;flex-direction:column;gap:4px;padding:12px 0;min-height:44px;border-top:1px solid var(--hair,rgba(132,160,168,.12));text-decoration:none;color:inherit;min-width:0}
.s7-c:hover .s7-cv,.s7-c:focus-visible .s7-cv{text-decoration:underline}
.s7-c:active{opacity:.75}
.s7-c:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.s7-ck{font:700 .75rem/1.4 'JetBrains Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}
.s7-cv{font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums;font-size:1.0625rem;font-weight:700;line-height:1.35;color:var(--text)}
.s7-cv .s7-line{display:block}
.s7-cv small{font-size:.75rem;font-weight:500;color:var(--text-dim)}
.s7-cm{font-size:.875rem;line-height:1.45;color:var(--text)}
.s7-cs{font-size:.75rem;line-height:1.45;color:var(--text-muted)}
.s7-cs .n,.s7-cm .n{font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums}
.s7-nl{font-family:Inter,system-ui,sans-serif;font-size:.875rem;font-weight:500;color:var(--text-muted)}
.s7-warn{color:var(--red)}
.s7-ok{color:var(--green)}
@media(max-width:900px){
  .idx1-content>.s7-month{order:5}
  .s7-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important}
  .s7-c.s7-wide{grid-column:1/-1}
  .s7-c{min-height:64px}
}
@media(min-width:901px) and (max-width:1239px){.idx1-content>.s7-month{order:-2}}
/* Desktop: the strip shares row 1 of the main columns with the "Live now"
   label, which sits at the bottom of that row. The shell grid is unchanged. */
@media(min-width:1240px){
  .idx1-content>.s7-month{grid-column:1/3;grid-row:1;align-self:start;margin-bottom:48px}
  .idx1-content>.idx1-zone-label{align-self:end}
}
/* C: chips. Plain words, 44px tap targets on a phone. */
@media(max-width:640px){.idx1-subbar .idx1-zip-chip{min-height:44px}}
/* D: briefing stamp and the ad link on its own line, away from the data. */
.s7-stamp{font-family:'JetBrains Mono',monospace;font-size:.75rem;color:var(--text-muted);margin-right:8px;white-space:nowrap}
.s7-adrow{display:flex;justify-content:flex-end;max-width:1400px;margin:0 auto;padding:4px 16px 8px}
@media(max-width:640px){.s7-adrow:has(.empty-state){display:none}}
/* E: overnight low and soil in Local Conditions. */
.wstat .s7-flag{display:block;font-family:Inter,system-ui,sans-serif;font-size:.75rem;font-weight:600;margin-top:4px}
.wstat .s7-sub{display:block;font-family:Inter,system-ui,sans-serif;font-size:.75rem;font-weight:500;color:var(--text-muted);margin-top:4px}
/* F: one spray rule, documented in the tooltip beside the 5-day label. */
.spray-windows-lbl{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.s7-wx-off{font-size:.875rem;color:var(--text-muted);padding:8px 0}
/* H: radar shows "Not loaded yet" until the map paints over it. */
.radar-card{position:relative}
.s7-radar-empty{position:absolute;left:0;right:0;top:50%;text-align:center;font-size:.875rem;color:var(--text-muted);z-index:0;pointer-events:none}
#windy-frame{position:relative;z-index:1;background:transparent}
/* F37: NOAA card headings in text colour (the temperature one read as ad orange). */
.noaa-card-head.temp,.noaa-card-head.precip{color:var(--text-dim)!important}
.s7-brief-note{font-size:.875rem;line-height:1.5;color:var(--text);margin:0 0 8px;padding-left:8px;border-left:2px solid var(--hair,rgba(132,160,168,.24))}
/* Seasonal show/hide, set from the SEASON table. */
html.s7-no-urea #f3 .tool-widget--urea{display:none!important}
html.s7-no-planting #rma-widget{display:none!important}
html.s7-no-gdu #gdu-stat,html.s7-no-gdu #gdu-chart-panel{display:none!important}
html.s7-no-gdu .wx-data-extra{grid-template-columns:minmax(0,1fr)!important}
html.s7-no-hail #land-hail{display:none!important}
html.s7-no-croptour .s7-croptour{display:none!important}
html.s7-hail-lead #land-hail{order:-1}
#idx1-land .land-grid{grid-template-columns:minmax(0,2fr) minmax(0,1fr)}
html.s7-no-hail #idx1-land .land-grid{grid-template-columns:minmax(0,1fr)}
@media(max-width:900px){#idx1-land .land-grid{grid-template-columns:minmax(0,1fr)!important}}
</style>
"""

# ─────────────────────────────────────────────────────────── markup pieces
MONTH_HTML = r"""  <section class="s7-month" id="s7-month" aria-labelledby="s7-month-h" data-track="season">
    <div class="s7-head"><h2 class="s7-h" id="s7-month-h">This month</h2><span class="s7-k" id="s7-month-k">What leads the page this month</span></div>
    <div class="s7-grid" id="s7-grid"></div>
  </section>
"""

WX_EXTRA = (r"""<div class="wstat" id="s7-wx-low-w"><div class="wstat-lbl">Overnight low</div><div class="wstat-val" id="s7-wx-low"><span class="s7-nl">Not loaded yet</span></div></div>"""
            r"""<div class="wstat" id="s7-wx-soil-w"><div class="wstat-lbl">Soil, 2.4 in (6 cm), modelled</div><div class="wstat-val" id="s7-wx-soil"><span class="s7-nl">Not loaded yet</span></div></div>""")

FALLN_HTML = r"""<a href="/urea" class="tool-widget tool-widget--falln" id="s7-falln" data-track="season" hidden>
            <div class="tool-widget-inner">
              <div class="tool-widget-top">
                <span class="tool-widget-icon"><svg class="ic" aria-hidden="true"><use href="#i-thermometer"/></svg></span>
                <div class="tool-widget-body"><span class="tool-widget-status">Fall nitrogen window</span></div>
                <span class="tool-widget-badge" id="s7-falln-badge">Not loaded yet</span>
                <span class="tool-widget-arr">&rarr;</span>
              </div>
              <div class="tool-widget-bottom">
                <span class="tool-widget-rec" id="s7-falln-rec">Soil temperature at 2.4 in (6 cm). Extension guidance: wait for fall anhydrous until soil at 4 in stays below 50&deg;F.</span>
              </div>
            </div>
          </a>
          <a href="/harvest-price-tracker" class="tool-btn" id="s7-hp-link" data-track="season" hidden><span class="tool-name"><svg class="ic" aria-hidden="true"><use href="#i-calendar"/></svg> Insurance harvest price</span><span class="tool-arr">&rarr;</span></a>
          <a href="/breakeven" class="tool-btn">"""

SPRAY_TIP = (r"""5-Day Spray Windows <span class="tip"><button type="button" class="tip-b" aria-expanded="false" aria-describedby="tip-s7-spray">How it&rsquo;s rated</button>"""
             r"""<span id="tip-s7-spray" role="tooltip" class="tip-t" hidden>One rule for every spray verdict on this page, read from each day&rsquo;s forecast. """
             r"""Hold off: more than 0.25 in of rain, wind over 15 mph, or a high under 40&deg;F or over 90&deg;F. """
             r"""Use caution: wind over 10 mph, calm air under 3 mph in the early morning (5&ndash;9 AM) or evening (6&ndash;9 PM) in the hourly forecast (temperature inversion risk), rain chance over 50%, humidity over 85% or under 40%, a low under 45&deg;F, or a high over 85&deg;F. """
             r"""Otherwise OK. Gusts are shown, not rated. Always follow the product label.</span></span></div>""")

# ───────────────────────────────────────────────────────────────────── JS
JS = r"""<script>
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
       {lead:['insurance','harvest','frost','fallN','report'],planting:false,urea:false,fallN:true,gdu:true,hail:false,cropTour:false,band:'open',hailLead:false,hp:true},
    11:/* Nov: harvest wraps, fall N, rent season opens */
       {lead:['harvest','fallN','frost','report','rent'],planting:false,urea:false,fallN:true,gdu:false,hail:false,cropTour:false,band:'open',hailLead:false,hp:true},
    12:/* Dec: rent and lease talks, harvest price settled, Dec WASDE */
       {lead:['rent','insurance','report'],planting:false,urea:false,fallN:false,gdu:false,hail:false,cropTour:false,band:'off',hailLead:false,hp:true}
  };
  var NOW=new Date(), M=NOW.getMonth()+1, S=SEASON[M];
  var root=document.documentElement;
  function $(i){return document.getElementById(i);}
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function n(x){return '<span class="n">'+x+'</span>';}
  function NL(){return '<span class="s7-nl">Not loaded yet</span>';}
  var MINUS='−';
  function sgn(v){return v>0?'+':(v<0?MINUS:'');}
  function get(u){return fetch(u).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;});}
  function getText(u){return fetch(u).then(function(r){return r.ok?r.text():null;}).catch(function(){return null;});}
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
    if(S.hailLead)root.classList.add('s7-hail-lead');
    var fn=$('s7-falln');if(fn)fn.hidden=!S.fallN;
    var hp=$('s7-hp-link');if(hp)hp.hidden=!S.hp;
    var hb=$('harvest-band');
    if(hb){if(S.band==='off')hb.hidden=true;else if(S.band==='open')hb.open=true;}
  }

  /* ---------- the "This month" strip ---------- */
  var grid=$('s7-grid'), cells={};
  var LABEL={insurance:'Insurance harvest price',harvest:'Harvest progress',frost:'Frost',fallN:'Fall nitrogen window',
    report:'Next major USDA report',rent:'Cash rent',condition:'Crop condition',planting:'Planting progress',
    soilPlant:'Planting soil temperature',spray:'Spray today'};
  var HREF={insurance:'/harvest-price-tracker',harvest:'/conditions',frost:'/spray',fallN:'/urea',report:'/usda-calendar',
    rent:'/cash-rent',condition:'/conditions',planting:'/planting-date',soilPlant:'/planting-date',spray:'/spray'};
  if(grid&&S){
    var h=$('s7-month-h');if(h)h.textContent=MONTH[M-1]+' on the farm';
    var k=$('s7-month-k');if(k)k.textContent='Changes with the month';
    var cols=S.lead.map(function(m){return m==='insurance'?'minmax(0,2fr)':'minmax(0,1fr)';}).join(' ');
    grid.style.gridTemplateColumns=cols;
    S.lead.forEach(function(m){
      var a=document.createElement('a');
      a.className='s7-c'+(m==='insurance'?' s7-wide':'');a.href=HREF[m]||'#';a.setAttribute('data-track','season');a.id='s7-c-'+m;
      a.innerHTML='<span class="s7-ck">'+LABEL[m]+'</span><span class="s7-cv">'+NL()+'</span><span class="s7-cm" hidden></span><span class="s7-cs"></span>';
      grid.appendChild(a);cells[m]=a;
    });
    grid.addEventListener('click',function(e){
      var c=e.target.closest?e.target.closest('.s7-c[data-zip]'):null;if(!c)return;
      e.preventDefault();var chip=$('idx1-zip-chip');if(chip)chip.click();
    });
  }
  var jm=$('s7-jump-m');if(jm)jm.textContent=MONTH[M-1];
  function put(m,v,s,meaning){
    var c=cells[m];if(!c)return;
    c.querySelector('.s7-cv').innerHTML=v;
    c.querySelector('.s7-cs').innerHTML=s||'';
    var cm=c.querySelector('.s7-cm');if(meaning){cm.innerHTML=meaning;cm.hidden=false;}else{cm.hidden=true;}
  }
  function needZip(m){var c=cells[m];if(!c)return;c.setAttribute('data-zip','1');c.href='#bids-zip';put(m,'<span class="s7-nl">Set your ZIP</span>','For your location');}

  /* ---------- shared fetches ---------- */
  var P={};
  function once(key,fn){return P[key]||(P[key]=fn());}
  function prices(){return once('prices',function(){return get('/data/prices.json');});}
  function rma(){return once('rma',function(){return get('/data/rma-prices.json');});}
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
  function stateName(){
    var picked=null;try{picked=localStorage.getItem('agsist-rma-state');}catch(e){}
    if(picked)return picked;
    var l=loc(),raw=l&&l.state?String(l.state).trim():'';
    if(raw.length===2)return AB[raw.toUpperCase()]||null;
    return raw||null;
  }
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
  function obs(d){var w=d.getDay();if(w===6)d.setDate(d.getDate()-1);else if(w===0)d.setDate(d.getDate()+1);return d;}
  function easter(y){var a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);return new Date(y,Math.floor((h+l-7*m+114)/31)-1,((h+l-7*m+114)%31)+1);}
  var HOL={};
  function holidays(y){if(HOL[y])return HOL[y];var gf=easter(y);gf.setDate(gf.getDate()-2);
    var l=[obs(new Date(y,0,1)),nthWd(y,0,1,3),nthWd(y,1,1,3),gf,lastWd(y,4,1),obs(new Date(y,5,19)),obs(new Date(y,6,4)),nthWd(y,8,1,1),nthWd(y,10,4,4),obs(new Date(y,11,25))];
    var o={};l.forEach(function(d){o[d.toDateString()]=1;});return HOL[y]=o;}
  function isTrading(d){var w=d.getDay();if(w===0||w===6)return false;for(var y=d.getFullYear()-1;y<=d.getFullYear()+1;y++){if(holidays(y)[d.toDateString()])return false;}return true;}
  function tradingDays(a,b){var n=0,d=new Date(a);while(d<=b){if(isTrading(d))n++;d.setDate(d.getDate()+1);}return n;}
  /* The RMA price discovery block below the outlooks uses the same count. */
  window.S7TD=function(a,b,t){return 'trading day '+tradingDays(a,t)+' of '+tradingDays(a,b);};
  [].forEach.call(document.querySelectorAll('.s7-td'),function(x){x.textContent=window.S7TD(new Date(+x.getAttribute('data-a')),new Date(+x.getAttribute('data-b')),new Date(+x.getAttribute('data-t')));});
  function money(c){var a=Math.abs(c);return sgn(c)+(a>=100?'$'+(a/100).toFixed(2):a+'¢');}
  function crops2(l){return l.length>1?l[0]+' and '+l[1].toLowerCase():l[0];}
  function insurance(){
    if(!cells.insurance)return;
    Promise.all([rma(),prices()]).then(function(r){
      var d=r[0],px=r[1];
      if(!d||!d.rows){put('insurance',NL(),'USDA RMA price discovery');return;}
      var st=stateName(),today=new Date(NOW.getFullYear(),NOW.getMonth(),NOW.getDate());
      var crops=[['Corn','ZC','Corn'],['Soybeans','ZS','Soybeans']],lines=[],up=[],down=[],miss=[],subs=[],legNote='',hold=false,endTxt='',varies=false;
      function key(x){return x.p_price+'|'+x.h_start+'|'+x.h_end;}
      crops.forEach(function(c){
        var rows=d.rows.filter(function(x){return x.crop===c[0]&&x.practice==='Conventional'&&/^All/.test(x.type||'')&&x.year===d.crop_year;});
        var pick=null,scope='';
        if(st){
          var mine=rows.filter(function(x){return x.state===st;});
          if(mine.length){
            /* Several windows (by county sales closing date): use the one whose
               harvest discovery contains today, or the one they all share;
               otherwise it varies by county and the reader is sent to the tracker. */
            var now=mine.filter(function(x){var a=dayStart(x.h_start),b=dayStart(x.h_end);return a&&b&&today>=a&&today<=b;});
            var pool=now.length?now:mine,ks={};pool.forEach(function(x){ks[key(x)]=1;});
            if(Object.keys(ks).length===1){pick=pool[0];scope=st;}
            else{lines.push('<span class="s7-line">'+c[2]+' <small>varies by county in '+esc(st)+'</small></span>');varies=true;return;}
          }
        }
        if(!pick&&rows.length){
          /* No state known: the window most states share. */
          var cnt={};rows.forEach(function(x){if(x.p_price!=null){var kk=key(x);cnt[kk]=(cnt[kk]||0)+1;}});
          var best=null;for(var kk in cnt){if(!best||cnt[kk]>cnt[best])best=kk;}
          if(best){pick=rows.filter(function(x){return key(x)===best;})[0];scope='most states';}
        }
        if(!pick||pick.p_price==null){lines.push('<span class="s7-line">'+c[2]+' '+NL()+'</span>');miss.push(c[2]);return;}
        var hs=dayStart(pick.h_start),he=dayStart(pick.h_end),ps=dayStart(pick.p_start),pe=dayStart(pick.p_end);
        var cm=(pick.h_mon||'').slice(0,3)+' ’'+String(pick.h_yr).slice(-2);
        var q=px&&px.quotes?quoteFor(px.quotes,c[1],pick.h_mon,pick.h_yr):null;
        var proj='$'+pick.p_price.toFixed(2),inWin=hs&&he&&today>=hs&&today<=he;
        if(he&&!endTxt)endTxt=MON[he.getMonth()]+' '+he.getDate();
        if(pick.h_price!=null&&pick.h_status==='Released'){
          var dc=Math.round((pick.h_price-pick.p_price)*100);
          lines.push('<span class="s7-line">'+c[2]+' '+money(dc)+' <small>per bu</small></span><span class="s7-line"><small>Harvest price $'+pick.h_price.toFixed(2)+' vs projected '+proj+'</small></span>');
          (dc>=0?up:down).push(c[2]);
        } else if(he&&today>he){
          lines.push('<span class="s7-line">'+c[2]+' <small>harvest price not loaded yet; projected '+proj+'</small></span>');miss.push(c[2]);
        } else if(inWin&&pick.h_price!=null){
          /* RMA's running average to date (status In Discovery). */
          var dr=Math.round((pick.h_price-pick.p_price)*100);hold=true;
          lines.push('<span class="s7-line">'+c[2]+' '+money(dr)+' <small>per bu</small></span><span class="s7-line"><small>RMA running average $'+pick.h_price.toFixed(2)+' vs projected '+proj+'</small></span>');
          (dr>=0?up:down).push(c[2]);
        } else if(q){
          var fut=q.close/100,diff=Math.round(fut*100-pick.p_price*100);hold=true;
          lines.push('<span class="s7-line">'+c[2]+' '+money(diff)+' <small>per bu</small></span><span class="s7-line"><small>Today’s '+cm+' futures $'+fut.toFixed(2)+', not the harvest price yet. Projected '+proj+'.</small></span>');
          (diff>=0?up:down).push(c[2]);
        } else {
          lines.push('<span class="s7-line">'+c[2]+' <small>projected '+proj+'; '+cm+' futures not loaded yet</small></span>');miss.push(c[2]);
        }
        if(!legNote&&hs&&he){
          var tot=tradingDays(hs,he),rng=MON[hs.getMonth()]+' '+hs.getDate()+'–'+(hs.getMonth()===he.getMonth()?'':MON[he.getMonth()]+' ')+he.getDate();
          if(inWin){var nth=tradingDays(hs,today);legNote='Harvest price: '+rng+' average, trading day '+(isTrading(today)?nth:nth+' done')+' of '+tot+'.';}
          else if(today<hs)legNote='Harvest price discovery runs '+rng+' ('+tot+' trading days).';
          else legNote='Harvest price discovery closed '+isoDay(pick.h_end)+'.';
          if(ps&&pe&&today>=ps&&today<=pe)legNote='Projected price discovery: '+isoDay(pick.p_start).replace(/, \d{4}$/,'')+' to '+isoDay(pick.p_end)+'.';
        }
        if(!subs.length)subs.push('Projected: '+(scope||'')+', '+MON[ps?ps.getMonth():0]+' '+(ps?ps.getFullYear():'')+'.');
      });
      var parts=[];
      if(up.length)parts.push(crops2(up)+(up.length>1?' are':' is')+' above projected. With Revenue Protection, the guarantee rises with the harvest price.');
      if(down.length)parts.push(crops2(down)+(down.length>1?' are':' is')+' below projected. The guarantee stays at the projected price.');
      if(up.length||down.length)parts.push('A claim needs yield × harvest price below the guarantee.');
      if(miss.length)parts.push(crops2(miss)+': price not loaded yet.');
      if(varies)parts.push('Windows differ by county sales closing date; open the tracker for yours.');
      var meaning=parts.join(' ');
      if(meaning&&hold&&(up.length||down.length))meaning='If prices hold through '+(endTxt||'the window')+': '+meaning;
      var asof=px&&px.fetched?'Futures '+dateLong(new Date(px.fetched)).replace(/, \d{4}$/,'')+', '+timeIn(new Date(px.fetched),'America/Chicago')+' CT, delayed.':'';
      put('insurance',lines.join(''),[legNote,subs.join(''),asof].filter(Boolean).map(esc).join(' '),meaning?esc(meaning):'');
    });
  }

  /* ---------- A2 harvest progress / condition / planting ---------- */
  function cropLine(name,o,key,prev){
    if(!o||o[key]==null)return null;
    return name+' '+o[key]+'%'+(o[prev]!=null?' <small>'+o[prev]+'% '+(/5yr|avg/.test(prev)?'5-year':'a year ago')+'</small>':'');
  }
  function cropModules(){
    if(!cells.harvest&&!cells.condition&&!cells.planting)return;
    progress().then(function(d){
      var asof=d&&d.report_date?'USDA Crop Progress, week ending '+isoDay(d.report_date)+'.':'';
      if(cells.harvest){
        /* The feed carries planting and condition; harvested share only when
           the pipeline adds it (harvest_pct, with harvest_5yr_avg or
           harvest_prev_year beside it, the way wheat already does). */
        var hk=function(o){return o&&o.harvest_5yr_avg!=null?'harvest_5yr_avg':'harvest_prev_year';};
        var a=d&&cropLine('Corn',d.corn,'harvest_pct',hk(d.corn)),b=d&&cropLine('Soybeans',d.soybeans,'harvest_pct',hk(d.soybeans));
        var mt=d&&d.corn&&d.corn.mature_pct!=null?'<span class="s7-line"><small>Corn mature '+d.corn.mature_pct+'%</small></span>':'';
        var hd=d&&((d.corn&&d.corn.harvest_date)||(d.soybeans&&d.soybeans.harvest_date));
        if(a||b)put('harvest',[a,b].filter(Boolean).map(function(x){return '<span class="s7-line">'+x+'</span>';}).join('')+mt,esc(hd?'Harvested. USDA Crop Progress, week ending '+isoDay(hd)+'.':asof));
        else put('harvest',NL(),esc('Harvested share is not in our crop progress feed yet'+(d&&d.report_date?' (latest week: '+isoDay(d.report_date)+')':'')+'.'));
      }
      if(cells.condition){
        var c1=d&&cropLine('Corn',d.corn,'good_excellent','good_excellent_prev_year'),c2=d&&cropLine('Soybeans',d.soybeans,'good_excellent','good_excellent_prev_year');
        if(c1||c2)put('condition',[c1,c2].filter(Boolean).map(function(x){return '<span class="s7-line">'+x+'</span>';}).join(''),esc('Good or excellent. '+asof));
        else put('condition',NL(),'');
      }
      if(cells.planting){
        var p1=d&&cropLine('Corn',d.corn,'planting_pct','planting_prev_year'),p2=d&&cropLine('Soybeans',d.soybeans,'planting_pct','planting_prev_year');
        if(p1||p2)put('planting',[p1,p2].filter(Boolean).map(function(x){return '<span class="s7-line">'+x+'</span>';}).join(''),esc('Planted. '+asof));
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
      else if(d.states&&d.states[st]&&d.states[st].r!=null)put('rent','$'+Math.round(d.states[st].r)+' <small>per acre, state average</small>',esc((d.states[st].n||st)+'. USDA NASS cash rent.'));
      else put('rent',NL(),'Farmland Atlas');
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
    for(var i=1;i<t.length;i++){if(v[i]!=null&&v[i]<=32){var dd=dayStart(t[i]);return {day:dd?['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dd.getDay()]:t[i],lo:Math.round(v[i])};}}
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
      if(lo!=null){var fl=frostFlag(lo);lw.innerHTML=lo+'°F'+(fl?'<span class="s7-flag s7-warn">'+fl+'</span>':'<span class="s7-sub">No frost tonight, air at 2 m</span>');}
      else if(WX.state!=='wait')lw.innerHTML=NL();
    }
    if(sw){
      if(s)sw.innerHTML=s.now+'°F'+(s.deep!=null?'<span class="s7-sub">7 in (18 cm): '+s.deep+'°F</span>':'');
      else if(WX.state!=='wait')sw.innerHTML=NL();
    }
    /* Strip cells */
    if(cells.frost){
      if(noLoc)needZip('frost');
      else if(lo!=null){
        var fl2=frostFlag(lo);
        put('frost','<span class="s7-line">'+lo+'°F <small>overnight low, air at 2 m</small></span>'+(fl2?'<span class="s7-line s7-warn">'+fl2+'</span>':''),
          esc(ff?'First frost night in the forecast: '+ff.day+' morning, '+ff.lo+'°F.':(ff===false?'No frost in the 5-day forecast.':'')));
      } else if(WX.state!=='wait')put('frost',NL(),'Weather forecast');
    }
    if(cells.fallN||cells.soilPlant||$('s7-falln')){
      var fb=$('s7-falln-badge'),fr=$('s7-falln-rec');
      if(noLoc){needZip('fallN');needZip('soilPlant');if(fb)fb.textContent='Set your ZIP';}
      else if(s){
        var v=fallVerdict(s);
        var sub='Modelled. '+(s.deep!=null?'7 in (18 cm): '+s.deep+'°F. ':'')+(v.t==='In range'?'Both depths below 50°F through the 5-day forecast.':'5-day highs: '+s.max+'°F at 2.4 in'+(s.deepMax!=null?', '+s.deepMax+'°F at 7 in':'')+'.')+' University extension guidance: wait until soil at 4 in stays below 50°F. Not advised on sandy or poorly drained soils.';
        put('fallN','<span class="s7-line'+(v.c?' '+v.c:'')+'">'+v.t+'</span><span class="s7-line">'+s.now+'°F <small>at 2.4 in, modelled</small></span>',esc(sub));
        put('soilPlant','<span class="s7-line">'+s.now+'°F <small>at 2.4 in</small></span><span class="s7-line">'+(s.now>=50?'At or above 50°F':'Below 50°F')+'</span>','Soil at 2.4 in (6 cm). Corn is commonly planted once soil holds near 50°F.');
        if(fb){fb.textContent=v.t+' · '+s.now+'°F';fb.style.color=v.c?'var(--green)':'var(--text)';}
        if(fr)fr.textContent=sub;
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
    if(x.wind!=null&&x.wind>10&&x.wind<=15)cau.push('wind '+Math.round(x.wind)+' mph');
    if(x.calm!=null)cau.push('inversion risk, '+x.calm+' mph at dawn or dusk');
    if(x.pop!=null&&x.pop>50)cau.push('rain chance '+Math.round(x.pop)+'%');
    if(x.rh!=null&&x.rh>85)cau.push('humidity '+Math.round(x.rh)+'%');
    if(x.rh!=null&&x.rh<40)cau.push('humidity '+Math.round(x.rh)+'%');
    if(x.tmin!=null&&x.tmin<45)cau.push('low '+Math.round(x.tmin)+'°F');
    if(x.tmax!=null&&x.tmax>85&&x.tmax<=90)cau.push('high '+Math.round(x.tmax)+'°F');
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
      if(!WX.f){var sv=$('wx-forecast-7day');if(sv&&!$('s7-wx-off')){var p=document.createElement('div');p.className='s7-wx-off';p.id='s7-wx-off';p.textContent='Forecast: Not loaded yet';sv.parentNode.insertBefore(p,sv);sv.hidden=true;}}},
    spray:function(a){
      var out=[],names=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],dow=new Date().getDay();
      var len=(a.max||[]).length;
      for(var k=0;k<Math.min(5,len);k++){
        var r=sprayRule({rain:a.rain[k],wind:a.wind[k],gust:a.gust[k],pop:a.pop[k],rh:a.rh[k],tmax:a.max[k],tmin:a.min[k],calm:calmAt(k)});
        if(r){r.label=k===0?'Today':(k===1?'Tmrw':names[(dow+k)%7]);}
        out.push(r);
      }
      WX.spray=out.length&&out[0]?out:null;
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
        el.innerHTML=(stamp?'<span class="s7-stamp">Morning snapshot, '+stamp+'</span>':'')+esc(txt);
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
      hero.classList.remove('is-brief');hero.setAttribute('aria-expanded','true');
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
    c.textContent=/^\d{5}$/.test(v.textContent.trim())?'· Change':'· Set';
  }
  chip();
  window.addEventListener('agsist:bids',chip);window.addEventListener('storage',chip);
  window._AGSIST_GEO_CALLBACKS=window._AGSIST_GEO_CALLBACKS||[];
  window._AGSIST_GEO_CALLBACKS.push(function(){setTimeout(chip,0);paintWx();rent();});

  /* ---------- H: drought valid date, I: NOAA dates ---------- */
  get('/data/outlooks/manifest.json').then(function(mf){
    var f=mf&&mf.files||{};
    var u=f['usdm_latest.png'],dv=$('s7-usdm-valid');
    if(dv)dv.textContent=(u&&u.data_valid)?'valid '+isoDay(u.data_valid)+' · ':'';
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
  insurance();cropModules();report();rent();
  if(!hasLoc())setTimeout(paintWx,0);
})();
</script>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True)
    a = ap.parse_args()
    p = os.path.join(a.repo, 'index.html')
    t = rd(p)
    if MARK in t:
        sys.exit('r7-season already applied to %s (marker found); refusing a second run' % p)

    # A: the strip, first in the main column flow.
    t = once(t, '  <div class="idx1-zone-label idx1-zone-live" style="order:-1">',
             MONTH_HTML + '  <div class="idx1-zone-label idx1-zone-live" style="order:-1">', 'A strip')

    # C: chips in plain words.
    t = once(t, '<span class="idx1-zip-change">Set / change &rarr;</span>',
             '<span class="idx1-zip-change" id="idx1-zip-change">&middot; Change</span>', 'C zip change')
    t = once(t, '<span class="idx1-zip-label">Market Intelligence</span>',
             '<span class="idx1-zip-label">Market outlook</span>', 'C intel label')
    t = once(t, 'Jump to COT / Nowcast &darr;', 'Funds and yield &darr;', 'C intel words')
    t = rx_once(t, r'(<span class="idx1-zip-change">Funds and yield &darr;</span>\s*</a>)',
                lambda m: m.group(1) + '\n  <a href="#s7-month" class="idx1-zip-chip" style="text-decoration:none" data-track="season">\n'
                '    <span class="idx1-zip-label">This month</span>\n'
                '    <span class="idx1-zip-change" id="s7-jump-m">Season</span><span class="idx1-zip-change" aria-hidden="true">&darr;</span>\n  </a>',
                'C month chip')

    # D: ad link out of the data strip, onto its own line.
    t = rx_once(t, r'<a class="teaser-sponsor empty-state" id="daily-teaser-sponsor".*?</a>', '', 'D sponsor out')
    t = once(t, '''    <span class="teaser-preview" id="daily-teaser-text">Today's ag market briefing &mdash; click to read</span>
  </div>
''', '''    <span class="teaser-preview" id="daily-teaser-text">Today's ag market briefing &mdash; click to read</span>
  </div>
  <div class="s7-adrow"><a class="teaser-sponsor empty-state" id="daily-teaser-sponsor" href="/sponsor" onclick="event.stopPropagation()"><span class="teaser-sponsor-dot"></span>Advertise here<span class="teaser-sponsor-tag">$100/wk</span></a></div>
''', 'D sponsor row')
    t = once(t, "if(data.teaser)setText('daily-teaser-text',data.teaser);",
             "if(data.teaser){setText('daily-teaser-text',data.teaser);window.__s7daily=data;if(window.S7)window.S7.teaser(data);}", 'D teaser hook')

    # E: overnight low and soil in Local Conditions; Field Scout promo out.
    dew = '<div class="wstat"><div class="wstat-lbl">Dew Point</div><div class="wstat-val" id="wx-dew">--</div></div>'
    t = once(t, dew, dew + WX_EXTRA, 'E wstats')
    t = rx_once(t, r'\n\s*<a href="/field-scout" class="wx-fs-bridge".*?</a>', '', 'E field scout out')

    # F/E: one forecast call feeds frost, soil and the one spray rule.
    t = once(t, 'winddirection_10m_dominant,relative_humidity_2m_mean,weathercode&hourly=',
             'winddirection_10m_dominant,relative_humidity_2m_mean,weathercode,wind_gusts_10m_max&hourly=', 'F gusts')
    t = once(t, 'soil_temperature_6cm&temperature_unit', 'soil_temperature_6cm,soil_temperature_18cm&temperature_unit', 'E soil 18')
    t = once(t, 'var forecast=results[0]||{},history=results[1]||{};',
             'var forecast=results[0]||{},history=results[1]||{};try{if(window.S7)window.S7.onWx(results[0]);}catch(e){}', 'E wx hook')
    t = once(t, "var gduEl2=document.getElementById('gdu-val');if(gduEl2)gduEl2.textContent=Math.round(curGDU)+' GDU';",
             "var _s7h=((dailyH&&dailyH.time)||[]).length>0;var gduEl2=document.getElementById('gdu-val');if(gduEl2)gduEl2.textContent=_s7h?Math.round(curGDU)+' GDU':'Not loaded yet';", 'E gdu 0')
    t = once(t, "var prEl2=document.getElementById('precip-val');if(prEl2)prEl2.textContent=(Math.round(curPrecip*10)/10)+'\"';",
             "var prEl2=document.getElementById('precip-val');if(prEl2)prEl2.textContent=_s7h?(Math.round(curPrecip*10)/10)+'\"':'Not loaded yet';", 'E precip 0')
    t = rx_once(t, r"    var SPRAY_ICONS=\['Sun'.*?      el\.classList\.add\('loaded'\);\n    \}\)\(\);\n",
                "    /* r7-season: the per-day badges and the summary sentence come from\n"
                "       the one spray rule (S7.spray), the same one the tile uses. */\n"
                "    if(window.S7)window.S7.spray({max:forecastMaxArr,min:forecastMinArr,rain:forecastPrecipArr,wind:forecastWindArr,rh:forecastHumidArr,"
                "gust:dailyF.wind_gusts_10m_max||[],pop:dailyF.precipitation_probability_max||[],gduPct:(typeof gduPct==='number'?gduPct:null),prPct:(typeof prPct==='number'?prPct:null)});\n",
                'F spray block')
    t = once(t, '5-Day Spray Windows</div>', SPRAY_TIP, 'F tooltip')

    # G/L: fall N tile and the harvest price link in Quick Tools.
    t = once(t, '<a href="/breakeven" class="tool-btn">', FALLN_HTML, 'G falln')
    # L: planting dates hide once both have passed.
    t = rx_once(t, r"(    if\(src\)src\.innerHTML=rmaSourceLine\(data, current\?'':'<strong>'\+.*?</strong>'\);\n)    w\.hidden=false;\n",
                lambda m: m.group(1) + "    /* r7-season: once both dates have passed, the card steps back. */\n"
                "    w.hidden=!!(current&&entry.corn&&daysUntil(entry.corn)<0&&(!entry.beans||daysUntil(entry.beans)<0));\n",
                'L planting past')

    # H: radar and drought.
    t = once(t, '        <iframe id="windy-frame"', '        <div class="s7-radar-empty" aria-hidden="true">Not loaded yet</div>\n        <iframe id="windy-frame"', 'H radar')
    t = once(t, 'Drought map loading&hellip;', 'Not loaded yet', 'H drought fallback')
    t = once(t, '&mdash; tap to view</small>', '&mdash; <span id="s7-usdm-valid"></span>tap to view</small>', 'H usdm valid')

    # I: NOAA dates from the manifest.
    t = once(t, '&middot; 1-Month issued last day of month &middot; 3-Month issued 3rd Thursday &middot; ',
             '&middot; <span id="s7-noaa-dates">Issue dates: Not loaded yet</span> &middot; ', 'I noaa')

    # K: land band. Storage and foreign-held land off the homepage, linked.
    t = rx_once(t, r'\n      <a class="land-cell" id="land-storage".*?</a>', '', 'K storage cell')
    t = rx_once(t, r'\n      <a class="land-cell" id="land-foreign".*?</a>', '', 'K foreign cell')
    t = rx_once(t, r"      get\('/data/storage/storage\.json'\).*?\n      \}\);\n      get\('/data/afida/national\.json'\).*?\n      \}\);\n",
                "      /* r7-season: storage and foreign-held land are linked below, not fetched here. */\n", 'K fetches')
    t = once(t, '<li><a href="/crop-tour" data-track="land">Crop tour</a></li>',
             '<li class="s7-croptour"><a href="/crop-tour" data-track="land">Crop tour</a></li>', 'K crop tour')
    t = once(t, '<li><a href="/archive" data-track="land">Every Daily briefing</a></li>',
             '<li><a href="/storage-crunch" data-track="land">Storage crunch</a></li>\n'
             '      <li><a href="/foreign-land" data-track="land">Foreign-held land</a></li>\n'
             '      <li><a href="/archive" data-track="land">Every Daily briefing</a></li>', 'K links')

    # Verifier: the RMA discovery block counted calendar days; RMA averages trading days.
    t = once(t, "return {k:'open',t:'open now',day:el,total:tot,", "return {k:'open',t:'open now',day:el,total:tot,s:s,e:e,d0:t,", 'pdw status')
    t = once(t, "calendar day '+hs.day+\n                  ' of '+hs.total+' \\u00b7 RMA averages trading days</div>'",
             "'+(window.S7TD?window.S7TD(hs.s,hs.e,hs.d0):(function(){function wd(a,b){var n=0,x=new Date(a);while(x<=b){var g=x.getDay();if(g&&g<6)n++;x.setDate(x.getDate()+1);}return n;}return '<span class=\"s7-td\" data-a=\"'+(+hs.s)+'\" data-b=\"'+(+hs.e)+'\" data-t=\"'+(+hs.d0)+'\">weekday '+wd(hs.s,hs.d0)+' of '+wd(hs.s,hs.e)+'</span>';})())+\n                  ' \\u00b7 RMA averages trading days</div>'", 'pdw trading days')

    # F34: "right now" is false after the close.
    t = once(t, '<small>&mdash; your location, your bids, right now</small>', '<small>&mdash; your location, your bids</small>', 'F34 live label')

    # CSS and JS.
    if t.count('</head>') != 1:
        sys.exit('ANCHOR </head> matched %d times, expected 1' % t.count('</head>'))
    t = t.replace('</head>', CSS + '</head>', 1)
    if t.count('</body>') != 1:
        sys.exit('ANCHOR </body> matched %d times, expected 1' % t.count('</body>'))
    t = t.replace('</body>', JS + '</body>', 1)
    wr(p, t)
    print('r7-season applied to', p)

if __name__ == '__main__':
    main()
