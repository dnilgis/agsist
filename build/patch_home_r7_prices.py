#!/usr/bin/env python3
"""r7-prices: ticker, Market Prices (key tiles + ledger), crop progress,
export sales, fertilizer, prediction markets on the new homepage.

usage: python3 patch_home_r7_prices.py --repo DIR
Patches DIR/index.html in place. Run after cutover, before bake.
Every anchor must match exactly once or the script exits with its label.
A second run is refused (marker check).
"""
import argparse, os, re, sys

MARK = '/* ===== 2026-10-01 r7-prices'


def once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        sys.exit('ANCHOR %s matched %d times, expected 1' % (label, n))
    return text.replace(old, new)


def times(text, old, new, k, label):
    n = text.count(old)
    if n != k:
        sys.exit('ANCHOR %s matched %d times, expected %d' % (label, n, k))
    return text.replace(old, new)


def rx_once(text, pattern, repl, label, flags=re.S):
    m = list(re.finditer(pattern, text, flags))
    if len(m) != 1:
        sys.exit('ANCHOR %s matched %d times, expected 1' % (label, len(m)))
    return text[:m[0].start()] + (repl(m[0]) if callable(repl) else repl) + text[m[0].end():]


# ---------------------------------------------------------------- ticker
TICKER = [
    # (old label, new label, unit)
    ('Corn (front)', 'Corn front month', 'per bu'),
    ("Corn Dec '26", "Corn deferred", 'per bu'),
    ('Beans (front)', 'Soybeans front month', 'per bu'),
    ("Beans Nov '26", "Soybeans deferred", 'per bu'),
    ('Wheat (front)', 'SRW wheat front month', 'per bu'),
    ('Oats', 'Oats', 'per bu'),
    ('Live Cattle', 'Live cattle', 'per cwt'),
    ('Feeder Cattle', 'Feeder cattle', 'per cwt'),
    ('Lean Hogs', 'Lean hogs', 'per cwt'),
    ('Class III Milk', 'Class III milk', 'per cwt'),
    ('Soy Meal', 'Soybean meal', 'per ton'),
]

BADGE_OLD = """          _tb.textContent=_mins<15?'LIVE':_mins<60?_mins+'m ago':_mins<2880?Math.round(_mins/60)+'h ago':Math.round(_mins/1440)+'d ago';
          _tb.parentNode.classList.toggle('stale',_mins>=15);"""

BADGE_NEW = r"""          /* r7-prices 2026-10-01 (7b): the quotes are delayed about 15
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
            function hol(y){var o={};[[obs(U(y,0,1)),"New Year's Day"],[nth(y,0,1,3),'Martin Luther King Jr. Day'],[nth(y,1,1,3),'Presidents Day'],[easter(y)-2*DY,'Good Friday'],[lastw(y,4,1),'Memorial Day'],[obs(U(y,5,19)),'Juneteenth'],[obs(U(y,6,4)),'Independence Day'],[nth(y,8,1,1),'Labor Day'],[nth(y,10,4,4),'Thanksgiving'],[obs(U(y,11,25)),'Christmas Day']].forEach(function(p){o[p[0]]=p[1];});return o;}
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
            if(tr&&m>=800&&m<815)return{t:'As of '+hm(F),live:false,title:'The day session closed at 1:20 PM CT; settle prices may not be final yet. '+read};
            if(tr&&m>=465&&m<510)return{t:'Pre-open',live:false,title:'Overnight session closed, day session not open yet. '+read};
            var s=(tr&&m>=815)?dayT:dayT-DY,guard=0;while(!trading(s)&&guard++<10)s-=DY;
            var hn=holName(dayT);
            return{t:'Settle '+lbl(s),live:false,title:(hn?'Markets closed for '+hn+'. ':'')+'Settle prices for '+lbl(s)+', '+new Date(s).getUTCFullYear()+'. '+read};
          })(data.fetched);
          if(_st){_tb.textContent=_st.t;_tb.parentNode.title=_st.title;_tb.parentNode.classList.toggle('stale',!_st.live);}
          else{_tb.textContent='Not loaded yet';_tb.parentNode.classList.add('stale');}"""

# ---------------------------------------------------------------- ledger
LEDGER_ROWS = {
    'more': [
        ('wheat', 'Wheat, Chicago SRW', 'pcp-wheat', 'pcc-wheat', 'pcprev-wheat', 'per bu'),
        ('oats', 'Oats', 'pcp-oats', 'pcc-oats', 'pcprev-oats', 'per bu'),
        ('meal', 'Soybean meal', 'pcp-meal', 'pcc-meal', 'pcprev-meal', 'per ton'),
        ('cattle', 'Live cattle', 'pcp-cattle', 'pcc-cattle', 'pcprev-cattle', 'per cwt'),
        ('feeders', 'Feeder cattle', 'pcp-feeders', 'pcc-feeders', 'pcprev-feeders', 'per cwt'),
        ('hogs', 'Lean hogs', 'pcp-hogs', 'pcc-hogs', 'pcprev-hogs', 'per cwt'),
        ('milk', 'Class III milk', 'pcp-milk', 'pcc-milk', 'pcprev-milk', 'per cwt'),
    ],
    'energy': [
        ('crude', 'Crude oil, WTI', 'pcp-crude', 'pcc-crude', 'pcprev-crude', 'per barrel'),
        ('natgas', 'Natural gas', 'pcp-natgas', 'pcc-natgas', 'pcprev-natgas', 'per MMBtu'),
        ('dollar', 'Dollar index', 'pcp-dollar', 'pcc-dollar', 'pcprev-dollar', 'index'),
        ('treasury10', '10-year Treasury', 'pcp-treasury', 'pcc-treasury', 'pcprev-treasury', 'yield'),
    ],
    'metals': [
        ('gold', 'Gold', 'pcp-gold', 'pcc-gold', 'pcprev-gold', 'per troy oz'),
        ('silver', 'Silver', 'pcp-silver', 'pcc-silver', 'pcprev-silver', 'per troy oz'),
    ],
}


def ledger(rows, aria):
    h = ['<div class="r7-led" role="table" aria-label="%s">' % aria,
         '<div class="r7-lh" role="row"><span role="columnheader">Contract</span>'
         '<span role="columnheader">Last</span><span role="columnheader">Change</span>'
         '<span role="columnheader">Percent</span><span role="columnheader">52-week range</span></div>']
    for k, name, pid, cid, prid, unit in rows:
        h.append(
            '<div class="pc r7-row" role="row" data-spark="%s" data-r7k="%s">'
            '<span class="r7-c r7-nm" role="rowheader"><span class="r7-n">%s</span><span class="r7-cm"></span></span>'
            '<span class="r7-c r7-last" role="cell"><span class="pc-price" id="%s"></span><span class="r7-unit">%s</span></span>'
            '<span class="r7-c r7-ch" role="cell"><span class="r7-chg nc"></span></span>'
            '<span class="r7-c r7-pc" role="cell"><span class="r7-pct nc"></span></span>'
            '<span class="r7-c r7-rg" role="cell"><span class="r7-lo"></span><span class="r7-bar" aria-hidden="true"><i class="r7-dot"></i></span><span class="r7-hi"></span></span>'
            '<span class="pc-chg-val nc" id="%s" hidden></span><span class="pc-prev" id="%s" hidden></span>'
            '</div>' % (k, k, name, pid, unit, cid, prid))
    h.append('</div>')
    return '\n      '.join(h)


LEDGER_HTML = '''<!-- r7-prices 2026-10-01: secondary contracts as ruled ledger rows
         (design director's call, approved). S&P 500, Bitcoin and XRP left the
         homepage (Sig's cut); they stay on the markets pages. Same price ids as
         the old tiles, so geo.js still writes the last price and the stale flag;
         change, percent, contract month and the 52-week bar are written by the
         r7-prices script from the same quote object. -->
    <div class="r7-ledgers">
    <details class="m-fold m-fold--more" open><summary class="m-fold-sum"><span>More grains and livestock</span></summary>
    <div class="pc-section-lbl"><svg class="ic" aria-hidden="true"><use href="#i-wheat"/></svg> More grains and livestock</div>
      %s
    </details>
    <details class="m-fold m-fold--outside" open><summary class="m-fold-sum"><span>Energy, metals and outside markets</span></summary>
    <div class="pc-section-lbl"><svg class="ic" aria-hidden="true"><use href="#i-zap"/></svg> Energy and outside markets</div>
      %s
    <div class="pc-section-lbl"><svg class="ic" aria-hidden="true"><use href="#i-medal"/></svg> Metals</div>
      %s
    </details>
    </div>''' % (ledger(LEDGER_ROWS['more'], 'More grains and livestock futures'),
                 ledger(LEDGER_ROWS['energy'], 'Energy and outside markets'),
                 ledger(LEDGER_ROWS['metals'], 'Metals futures'))

# ---------------------------------------------------------------- crop progress
CROP_FMT_OLD = r"""function fmtChg(cur,prev,suffix){if(cur==null||prev==null)return{txt:'--',cls:'nc'};var d=cur-prev;return{txt:(d>=0?'\u25b2+':'\u25bc')+Math.abs(d)+(suffix||''),cls:d>0?'up':d<0?'dn':'nc'};}"""
CROP_FMT_NEW = r"""/* r7-prices: a change in a percentage rating is in points, and no change is "unch". */
function fmtChg(cur,prev,suffix){if(cur==null||prev==null)return{txt:'Not loaded yet',cls:'nc'};var d=cur-prev;if(d===0)return{txt:'unch',cls:'nc'};var a=Math.abs(d);return{txt:(d>0?'\u25b2 +':'\u25bc \u2212')+a+(suffix===' points'&&a===1?' point':(suffix||'')),cls:d>0?'up':'dn'};}"""

CROP_PLANT_OLD = r"""      var plantEl=document.getElementById('crop-'+key+'-plant'),barEl=document.getElementById('crop-'+key+'-bar');
      if(plantEl)plantEl.textContent=d.planting_pct!=null?fmtPct(d.planting_pct):'\u2014';
      if(barEl)barEl.style.width=Math.min(d.planting_pct||0,100)+'%';
      if(d.planting_pct!=null)allNull=false;"""
CROP_PLANT_NEW = r"""      var plantEl=document.getElementById('crop-'+key+'-plant'),barEl=document.getElementById('crop-'+key+'-bar');
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
      }"""

CROP_LOOP_OLD = """    var allNull=true;
    ['corn','soybeans'].forEach(function(comm){"""
CROP_LOOP_NEW = """    var allNull=true,_needHarvestNote=[];
    ['corn','soybeans'].forEach(function(comm){"""

CROP_AFTER_OLD = r"""    if(allNull&&data.in_season!==false){var rows=document.getElementById('crop-rows');"""
CROP_AFTER_NEW = r"""    if(_needHarvestNote.length){var _cr=document.getElementById('crop-rows');if(_cr&&!document.getElementById('r7-crop-note')){var _n=document.createElement('div');_n.id='r7-crop-note';_n.className='r7-crop-note';_n.textContent='Harvested and mature'+(_needHarvestNote.length===1?' ('+_needHarvestNote[0]+')':'')+': Not loaded yet.';_cr.appendChild(_n);}}
    if(allNull&&data.in_season!==false){var rows=document.getElementById('crop-rows');"""

# ---------------------------------------------------------------- export sales
EXP_FMT_OLD = r"""function fmtMT(n){if(n==null||isNaN(n))return'--';if(Math.abs(n)>=1000000)return(n/1000000).toFixed(2)+'M MT';if(Math.abs(n)>=1000)return Math.round(n/1000)+'k MT';return n+' MT';}"""
EXP_FMT_NEW = r"""/* r7-prices: USDA reports export sales in metric tons; a grower reads
   bushels. Standard factors: corn 39.368 bu per metric ton, soybeans and
   wheat 36.744. The factor is printed in the footer tooltip. */
var BU_PER_MT={corn:39.368,soybeans:36.744,wheat:36.744};
function fmtBu(n,comm){if(n==null||isNaN(n)||!BU_PER_MT[comm])return'Not loaded yet';var b=n*BU_PER_MT[comm];if(Math.abs(b)>=1e6)return(b/1e6).toFixed(1)+' million bu';return Math.round(b/1000)+' thousand bu';}"""

EXP_DATE_OLD = r"""function fmtDate(iso){if(!iso)return'\u2014';try{var d=new Date(iso+'T12:00:00');return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});}catch(e){return iso;}}
fetch('/data/export-sales.json')"""
EXP_DATE_NEW = r"""function fmtDate(iso){if(!iso)return'Not loaded yet';try{var d=new Date(iso+'T12:00:00');return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}catch(e){return iso;}}
fetch('/data/export-sales.json')"""

EXP_MKT_OLD = r"""if(mktEl&&data.marketing_year)mktEl.textContent=data.marketing_year+' mkt yr';"""
EXP_MKT_NEW = r"""if(mktEl&&data.marketing_year)mktEl.textContent=data.marketing_year+' marketing year';var _noPace=false;"""

EXP_WK_OLD = r"""?((d.weekly_net_mt<0?'\u2212':'+')+fmtMT(Math.abs(d.weekly_net_mt))):(why?'\u2014':'pending');"""
EXP_WK_NEW = r"""?((d.weekly_net_mt<0?'\u2212':'+')+fmtBu(Math.abs(d.weekly_net_mt),comm)):(why?'\u2014':'Not loaded yet');"""

EXP_PCT_OLD = r"""      var pct=d.pct_of_target,cls=(pct==null)?'no-data':paceClass(pct);"""
EXP_PCT_NEW = r"""      var pct=d.pct_of_target,cls=(pct==null)?'no-data':paceClass(pct);if(pct==null&&!why)_noPace=true;"""

EXP_CUM_OLD = r"""        else if(d.usda_target_mt!=null){
          cumEl.textContent=(d.cumulative_mt/1e6).toFixed(1)+'M / '+(d.usda_target_mt/1e6).toFixed(1)+'M MT \u00b7 of USDA target';
        }else{
          /* The booked total is a real number and was being discarded
             because its denominator is missing. Print it, and say the
             denominator is missing. */
          cumEl.textContent=(d.cumulative_mt/1e6).toFixed(1)+'M MT booked \u00b7 no pace shown';
        }"""
EXP_CUM_NEW = r"""        else if(d.usda_target_mt!=null){
          cumEl.textContent=fmtBu(d.cumulative_mt,comm)+' committed of '+fmtBu(d.usda_target_mt,comm)+' USDA projection';
        }else{
          /* r7-prices: commitments, in bushels. The missing pace is said
             once, in the footer, not on every row. */
          cumEl.textContent=fmtBu(d.cumulative_mt,comm)+' committed';
        }"""

EXP_END_OLD = r"""      var whyEl=document.getElementById('exp-'+key+'-why');
      if(whyEl){whyEl.textContent=why||'';whyEl.hidden=!why;}
    });"""
EXP_END_NEW = r"""      var whyEl=document.getElementById('exp-'+key+'-why');
      if(whyEl){whyEl.textContent=why||'';whyEl.hidden=!why;}
    });
    var _tp=document.getElementById('tip-export');if(_tp&&_tp.parentNode)_tp.parentNode.style.display=_noPace?'':'none';"""

EXP_TIP_OLD = """<span class="tip"><button type="button" class="tip-b" aria-expanded="false" aria-describedby="tip-export">Why no pace</button><span id="tip-export" role="tooltip" class="tip-t" hidden>Pace is bookings against USDA&rsquo;s 2026/27 export projection. That projection is not loaded on this site yet, so no pace is shown rather than one against last year&rsquo;s target.</span></span>"""
EXP_TIP_NEW = """<span class="tip r7-tip"><button type="button" class="tip-b" aria-expanded="false" aria-describedby="tip-export">No pace yet</button><span id="tip-export" role="tooltip" class="tip-t" hidden>Pace is commitments against USDA&rsquo;s export projection for this marketing year. That projection is not loaded on this site yet, so no pace is shown rather than one against last year&rsquo;s target.</span></span><span class="tip r7-tip"><button type="button" class="tip-b" aria-expanded="false" aria-describedby="tip-r7-bu">Bushels</button><span id="tip-r7-bu" role="tooltip" class="tip-t" hidden>USDA reports export sales in metric tons. Converted at 39.368 bushels per metric ton for corn and 36.744 for soybeans and wheat. Commitments are shipments so far plus sales not yet shipped.</span></span>"""

# ---------------------------------------------------------------- fertilizer
FERT_RX = r"""    var dateEl=document\.getElementById\('fert-date'\);if\(dateEl\)dateEl\.textContent='Updated '\+fmtDate\(data\.updated\);.*?\}\)\.join\(''\);\n"""
FERT_NEW = r"""    /* r7-prices 2026-10-01: one row per product with its own quote date;
       a quote older than 45 days is not shown as current, it is counted
       and dated under the table. "Midwest dealer" and "per ton" are said
       once. NH3, UAN and DAP are not in fertilizer.json, so they are not
       shown. */
    var dateEl=document.getElementById('fert-date');if(dateEl)dateEl.textContent='Updated '+fmtDate(data.updated);
    var srcEl=document.getElementById('fert-src-note');if(srcEl)srcEl.textContent='Midwest dealer quotes, dollars per ton';
    var grid=document.getElementById('fert-grid');if(!grid||!data.prices||!data.prices.length)return;
    function age(iso){var t=new Date((iso||'')+'T12:00:00').getTime();return isNaN(t)?null:Math.floor((Date.now()-t)/86400000);}
    var fresh=[],old=[];
    data.prices.forEach(function(p){if(p.price==null)return;var a=age(p.as_of||data.updated);if(a==null||a>45)old.push(p);else fresh.push(p);});
    grid.classList.add('r7-fert');
    var h='<div class="r7-fh" aria-hidden="true"><span>Product</span><span>Per ton</span><span>Change</span><span>Quoted</span></div>';
    h+=fresh.map(function(p){
      var chg=p.prev!=null?p.price-p.prev:null;
      var cls=chg==null?'nc':chg>0?'up':chg<0?'dn':'nc';
      var cs=chg==null?'':chg===0?'unch':(chg>0?'\u25b2 +$':'\u25bc \u2212$')+Math.abs(chg);
      return '<div class="r7-fr"><span class="r7-fn">'+esc(p.name)+' <small>'+esc(p.symbol||'')+'</small></span><span class="r7-fp">$'+esc(String(p.price))+'</span><span class="r7-fc fert-chg-val '+cls+'">'+esc(cs)+'</span><span class="r7-fd">'+esc(fmtDate(p.as_of||data.updated))+'</span></div>';
    }).join('');
    if(!fresh.length)h+='<div class="r7-fnote">Not loaded yet.</div>';
    if(old.length){
      var ds={};old.forEach(function(p){ds[fmtDate(p.as_of||data.updated)]=1;});
      h+='<div class="r7-fnote">'+old.length+(old.length===1?' older quote':' older quotes')+' not shown ('+esc(old.map(function(p){return p.name;}).join(', '))+', last quoted '+esc(Object.keys(ds).join(', '))+').</div>';
    }
    grid.innerHTML=h;
"""

# ---------------------------------------------------------------- CSS
CSS = r"""<style>
/* ===== 2026-10-01 r7-prices: ticker, key contracts, ledger rows, crop progress, export sales, fertilizer, prediction markets ===== */
/* Ticker: units after every price; empty until loaded, never a bare dash. */
.prices-strip .t-unit{font:500 .7rem/1 'JetBrains Mono',monospace;color:var(--text-muted);margin-left:-.15rem}
.prices-strip .t-price:empty+.t-unit{display:none}
.prices-strip .t-price,.prices-strip .t-chg{font-variant-numeric:tabular-nums}
/* Key contracts: unit beside the price. Up/down in the light theme: the
   theme's --green #2e7d4f and --red #c0492f measured only 4.61:1 and 4.53:1
   on the rendered #f4f5f3 behind these tiles (4.40/4.33 on --bg2 #eef0ed),
   so two darker light-theme variants are used here, measured 5.87:1 and
   5.71:1 on #f4f5f3 and 5.60:1 / 5.45:1 on #eef0ed. */
[data-theme="light"]{--r7-up:#276b43;--r7-dn:#a63f28}
#f-prices .price-cards-grid .r7-pl{display:flex;align-items:baseline;gap:8px;min-width:0}
#f-prices .price-cards-grid .r7-pl .pc-price{min-width:0;overflow:visible}
.r7-frac{font-size:.55em;font-weight:600;letter-spacing:0;margin-left:.15em}
#f-prices .price-cards-grid .r7-unit{font:500 12px/1 'JetBrains Mono',monospace;color:var(--text-muted);white-space:nowrap}
#f-prices .pc-price:empty::before{content:'Not loaded yet';font:500 14px/1.4 Inter,system-ui,sans-serif;color:var(--text-muted);letter-spacing:0}
#f-prices .pc-price:empty+.r7-unit{display:none}
/* No stale numbers before (or without) the live file: the range, dot and
   contract chip ship empty and stay out of sight until written. */
#f-prices .price-cards-grid .pc-range:has(.pc-range-labels>span:first-child:empty){visibility:hidden}
#f-prices .price-cards-grid .pc-contract:empty{display:none}
[data-theme="light"] #f-prices .pc-chg-val.up,[data-theme="light"] #f-prices .r7-chg.up,[data-theme="light"] #f-prices .r7-pct.up,[data-theme="light"] .crop-chg.up,[data-theme="light"] #fert-grid .fert-chg-val.dn{color:var(--r7-up)!important}
[data-theme="light"] #f-prices .pc-chg-val.dn,[data-theme="light"] #f-prices .r7-chg.dn,[data-theme="light"] #f-prices .r7-pct.dn,[data-theme="light"] .crop-chg.dn,[data-theme="light"] .crop-ge-val.poor,[data-theme="light"] #fert-grid .fert-chg-val.up{color:var(--r7-dn)!important}

/* Ledger rows: one alignment line, hairlines, no boxes. */
.r7-ledgers{margin:0 0 8px}
@media(min-width:1100px){
  .r7-ledgers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:32px;align-items:start}
  .r7-ledgers>.m-fold{margin:0}
}
@media(min-width:1240px){#f-prices>.r7-ledgers{grid-column:1/-1;grid-row:9}}
#f-prices .r7-led{display:block;margin:0 0 16px;font-variant-numeric:tabular-nums}
#f-prices .r7-lh,#f-prices .r7-led .pc.r7-row{display:grid!important;grid-template-columns:minmax(0,1.45fr) minmax(0,1.35fr) minmax(0,1fr) minmax(0,.7fr) minmax(0,1.5fr);column-gap:16px;align-items:center}
#f-prices .r7-lh{padding:0 0 6px;font:500 12px/1.3 'JetBrains Mono',monospace;color:var(--text-muted);letter-spacing:.02em}
#f-prices .r7-lh span:nth-child(2),#f-prices .r7-lh span:nth-child(3),#f-prices .r7-lh span:nth-child(4){text-align:right}
#f-prices .r7-led .pc.r7-row{padding:8px 0!important;min-height:44px;margin:0;overflow:visible;border-radius:0!important;background:none!important;
  border:0!important;border-top:1px solid var(--hair)!important;box-shadow:none!important;animation:none!important;flex-direction:initial}
#f-prices .r7-led .pc.r7-row:last-child{border-bottom:1px solid var(--hair)!important}
#f-prices .r7-led .r7-row [hidden]{display:none!important}
#f-prices .r7-nm{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:8px;row-gap:0;min-width:0}
#f-prices .r7-n{font:600 14px/1.35 Inter,system-ui,sans-serif;color:var(--text)}
#f-prices .r7-cm{font:500 12px/1.35 'JetBrains Mono',monospace;color:var(--text-muted);white-space:nowrap}
#f-prices .r7-last{display:flex;justify-content:flex-end;align-items:baseline;gap:6px;min-width:0;white-space:nowrap}
#f-prices .r7-led .pc-price{font:600 17px/1.2 'JetBrains Mono',monospace!important;letter-spacing:0!important;margin:0!important;color:var(--text);overflow:visible;font-variant-numeric:tabular-nums}
#f-prices .r7-led .pc-price:empty::before{font-size:12px}
#f-prices .r7-unit{font:500 12px/1 'JetBrains Mono',monospace;color:var(--text-muted)}
#f-prices .r7-ch,#f-prices .r7-pc{text-align:right;white-space:nowrap;font:500 14px/1.3 'JetBrains Mono',monospace}
#f-prices .r7-chg.up,#f-prices .r7-pct.up{color:#8ceeb2}
#f-prices .r7-chg.dn,#f-prices .r7-pct.dn{color:#ffa198}
#f-prices .r7-chg.nc,#f-prices .r7-pct.nc{color:var(--text-muted)}
#f-prices .r7-rg{display:grid;grid-template-columns:auto auto;grid-template-areas:"bar bar" "lo hi";row-gap:5px;align-items:center;min-width:0;font:500 12px/1 'JetBrains Mono',monospace;color:var(--text-muted);white-space:nowrap}
#f-prices .r7-lo{grid-area:lo}#f-prices .r7-hi{grid-area:hi;text-align:right}
#f-prices .r7-bar{grid-area:bar;position:relative;height:2px;margin:3px 4px 0;background:var(--border-2)}
#f-prices .r7-dot{position:absolute;top:50%;left:0;width:7px;height:7px;border-radius:50%;background:var(--text);transform:translate(-50%,-50%)}
#f-prices .r7-lo:empty~.r7-bar{visibility:hidden}
#f-prices .r7-row.stale-tile{opacity:.6}
@media(max-width:600px){
  #f-prices .r7-lh{display:none!important}
  #f-prices .r7-led .pc.r7-row{grid-template-columns:minmax(0,1fr) auto auto;grid-template-areas:"nm last last" "rg ch pc";row-gap:6px;column-gap:12px;padding:10px 0!important}
  #f-prices .r7-nm{grid-area:nm}#f-prices .r7-last{grid-area:last}#f-prices .r7-ch{grid-area:ch}#f-prices .r7-pc{grid-area:pc}#f-prices .r7-rg{grid-area:rg}
  #f-prices .r7-led .pc-price{font-size:17px!important}
}

@media(max-width:900px){.m-fold--outside>summary+.pc-section-lbl{display:none}}

/* Crop progress: one honest line when harvest progress is not in the file. */
.r7-crop-note{font:500 12px/1.5 'JetBrains Mono',monospace;color:var(--text-muted);padding:8px 0 0;border-top:1px solid var(--hair);margin-top:8px}
/* Export and fertilizer tooltips: 44px tap target on phones. */
@media(max-width:900px){.r7-tip .tip-b{min-height:44px;line-height:44px}}
.r7-tip .tip-b{white-space:nowrap}
#export-widget .export-footer{flex-wrap:wrap;column-gap:12px;row-gap:4px}
#export-widget .export-comm-name{white-space:nowrap}
@media(max-width:600px){#export-widget .export-row-head{flex-wrap:wrap;row-gap:2px;column-gap:12px}}
#fert-src-note{font:500 12px/1.5 'JetBrains Mono',monospace;color:var(--text-muted)}

/* Fertilizer: ledger rows instead of cards (the change was wrapping "1 05"). */
#fert-grid.r7-fert{display:block}
#fert-grid .r7-fh,#fert-grid .r7-fr{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,.8fr) minmax(0,.9fr) minmax(0,1fr);column-gap:12px;align-items:baseline}
#fert-grid .r7-fh{font:500 12px/1.3 'JetBrains Mono',monospace;color:var(--text-muted);padding:0 0 6px}
#fert-grid .r7-fh span:nth-child(n+2){text-align:right}
#fert-grid .r7-fr{padding:8px 0;border-top:1px solid var(--hair);min-height:44px;font-variant-numeric:tabular-nums}
#fert-grid .r7-fn{font:600 14px/1.35 Inter,system-ui,sans-serif;color:var(--text);min-width:0}
#fert-grid .r7-fn small{display:block;font:500 12px/1.35 'JetBrains Mono',monospace;color:var(--text-muted)}
#fert-grid .r7-fp,#fert-grid .r7-fc,#fert-grid .r7-fd{text-align:right;white-space:nowrap;font:500 14px/1.3 'JetBrains Mono',monospace}
#fert-grid .r7-fp{font-weight:600;color:var(--text)}
#fert-grid .r7-fd{font-size:12px;color:var(--text-muted)}
#fert-grid .r7-fnote{font:500 12px/1.5 'JetBrains Mono',monospace;color:var(--text-muted);padding:8px 0 0;border-top:1px solid var(--hair)}

/* Prediction markets: hidden unless the file holds an ag-linked market. */
.m-fold--kalshi:not(.r7-ag){display:none!important}
.m-fold--kalshi.r7-ag #kalshi-grid,.m-fold--kalshi.r7-ag #kalshi-footer{display:none!important}
.r7-odds-lbl{font:500 12px/1.5 'JetBrains Mono',monospace;color:var(--text-muted);margin:0 0 8px}
.r7-odds-row{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:16px;padding:8px 0;border-top:1px solid var(--hair);min-height:44px}
.r7-odds-t{font:600 14px/1.4 Inter,system-ui,sans-serif;color:var(--text)}
.r7-odds-p{font:600 17px/1.2 'JetBrains Mono',monospace;color:var(--text);font-variant-numeric:tabular-nums;text-align:right}
.r7-odds-m{grid-column:1/-1;font:500 12px/1.5 'JetBrains Mono',monospace;color:var(--text-muted)}
</style>
"""

# ---------------------------------------------------------------- JS
JS = r"""<script>
/* ===== 2026-10-01 r7-prices: ledger rows, ticker labels, key-tile wording, prediction markets ===== */
(function(){
'use strict';
var MON={jan:'Jan',feb:'Feb',mar:'Mar',apr:'Apr',may:'May',jun:'Jun',jul:'Jul',aug:'Aug',sep:'Sep',oct:'Oct',nov:'Nov',dec:'Dec'};
/* g: price in cents per bu; bp: change in basis points; nod: no dollar sign. */
var CFG={wheat:{g:1},oats:{g:1},meal:{},cattle:{},feeders:{},hogs:{},milk:{},crude:{},natgas:{},
  dollar:{nod:1,cm:'Spot'},treasury10:{bp:1,pctSfx:1,cm:'Spot'},gold:{},silver:{}};
var TICK={corn:'Corn',beans:'Soybeans',wheat:'SRW wheat',oats:'Oats',cattle:'Live cattle',feeders:'Feeder cattle',hogs:'Lean hogs',milk:'Class III milk',meal:'Soybean meal'};
var Q={},NB={},have=false,timer=null;
function qa(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));}
function setT(el,t){if(el&&el.textContent!==t)el.textContent=t;}
function cmKey(k){var m=/-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(\d\d)$/.exec(k||'');return m?MON[m[1]]+" '"+m[2]:null;}
/* The contract month of the quote on the page, from the file only: the
   nearby label, else the dated contract the continuous series was repaired
   from, else the one dated contract whose close, previous close and change
   all equal it. No match: "Front month". */
function source(k){
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
function qc(c){var t=Math.round(c*4)/4,w=Math.floor(t),f=t-w;return '$'+(w/100).toFixed(2)+(f===0.25?' 1/4':f===0.5?' 1/2':f===0.75?' 3/4':'');}
function r2(c){return '$'+(c/100).toFixed(2);}
/* Writes the quarter as a smaller trailing span; textContent stays "$12.83 1/4". */
function setQ(el,c){var t=qc(c);if(!el||el.textContent===t)return;var m=/^(\$[\d.]+)( \d\/\d)?$/.exec(t);el.textContent=m[1];if(m[2]){var sp=document.createElement('span');sp.className='r7-frac';sp.textContent=m[2];el.appendChild(sp);}}
function cents(a){var w=Math.floor(a),f=Math.round((a-w)*4);if(f===4){w++;f=0;}var fr=f===1?'1/4':f===2?'1/2':f===3?'3/4':'';return (w||!fr?String(w):'')+(w&&fr?' ':'')+fr+'\u00a2';}
function chg(k,q){
  var n=q.netChange;if(n==null||isNaN(+n))return null;n=+n;
  if(n===0)return{t:'unch',c:'nc',p:''};
  var c=CFG[k],s=n>0?'+':'\u2212',a=Math.abs(n),t;
  if(c.g)t=s+cents(a);
  else if(c.bp){var b=a*100;t=s+(b<1?b.toFixed(1):String(Math.round(b)))+(Math.round(b)===1&&b>=1?' basis point':' basis points');}
  else if(c.nod)t=s+a.toFixed(2);
  else t=s+'$'+a.toFixed(2);
  var p='',pc=+q.pctChange;
  if(!c.bp&&!isNaN(pc)&&q.pctChange!=null){var ap=Math.abs(pc);p=(pc>0?'+':pc<0?'\u2212':'')+(ap<0.05?ap.toFixed(2):ap.toFixed(1))+'%';}
  return{t:t,c:n>0?'up':'dn',p:p};
}
function rangeFmt(k,v,dir){
  /* Same formatter as the prices: grains to the quarter cent, the rest
     rounded like the last price. No floor/ceil (Nov '26 high 1335.25 is
     $13.35 1/4, not $13.36). */
  var c=CFG[k];if(c.g)return qc(v*100);
  var d=(c.nod||c.bp)?2:(v>=1000?0:2);
  var s=Number(v.toFixed(d)).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
  return c.bp?s+'%':c.nod?s:'$'+s;
}
function renderRow(row){
  var k=row.getAttribute('data-r7k'),q=Q[k],c=CFG[k];if(!q||!c||q.close==null)return;
  var src=source(k)||{label:null,rq:q},rq=c.cm?q:src.rq;
  setT(row.querySelector('.r7-cm'),c.cm||src.label||'Continuous');
  if(c.g){var pp=row.querySelector('.pc-price');if(pp&&pp.textContent===r2(q.close))setQ(pp,q.close);}
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
  rg.setAttribute('aria-label','52-week range '+loT+' to '+hiT+(raised?', high is today\u2019s close':lowered?', low is today\u2019s close':''));
  if(raised||lowered)rg.title='Today\u2019s close is '+(raised?'above the 52-week high':'below the 52-week low')+' on file, so the '+(raised?'high':'low')+' shown is today\u2019s close.';else rg.removeAttribute('title');
}
function renderTicker(){
  var ch=false;
  Object.keys(TICK).forEach(function(k){
    if(!Q[k])return;var lb=TICK[k]+' '+(contractMonth(k)||'continuous');
    qa('.prices-strip [data-sym="'+k+'"] .t-label').forEach(function(e){if(e.textContent!==lb){e.textContent=lb;ch=true;}});
  });
  [['corn-dec','Corn deferred','Corn '],['beans-nov','Soybeans deferred','Soybeans ']].forEach(function(d){
    var lb=cmByTicker(Q[d[0]]);if(!lb)return;
    qa('.prices-strip [data-sym="'+d[0]+'"] .t-label').forEach(function(e){if(e.textContent===d[1]){e.textContent=d[2]+lb;ch=true;}});
  });
  if(ch&&typeof window.rebuildTickerLoop==='function')window.rebuildTickerLoop();
}
function deferredChips(){
  [['pcp-corn-dec','corn-dec'],['pcp-bean-nov','beans-nov']].forEach(function(p){
    var el=document.getElementById(p[0]),card=el&&el.closest?el.closest('.pc'):null,chip=card?card.querySelector('.pc-contract'):null;
    if(chip&&!chip.textContent.trim()){var lb=cmByTicker(Q[p[1]]);if(lb)chip.textContent=lb;}
  });
}
function renderAll(){qa('#f-prices .r7-row[data-r7k]').forEach(renderRow);renderTicker();deferredChips();dress();}
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
      var m=/^prev: (\S+)(?: (\S+))?$/.exec(pv.textContent),q=null;
      if(m){
        q=m[2]?bySym(m[2]):null;
        if(q&&q.open!=null){setT(pv,'Prev close '+qc(q.open));pv.setAttribute('data-r7sym',m[2]);}
        else if(have){setT(pv,'Prev close '+m[1]);pv.removeAttribute('data-r7sym');}
      }else{var sy=pv.getAttribute('data-r7sym');q=sy?bySym(sy):null;}
      if(q&&pr&&q.close!=null&&pr.textContent===r2(q.close))setQ(pr,q.close);
      if(q&&q.wk52_lo!=null&&q.wk52_hi!=null){var ls=card.querySelectorAll('.pc-range-labels>span');if(ls.length>=3&&ls[0].textContent){setT(ls[0],qc(q.wk52_lo));setT(ls[2],qc(q.wk52_hi));}}
    });
    qa('.prices-strip .t-item[data-sym]').forEach(function(it){
      var k=it.getAttribute('data-sym');if(!GRAIN_T[k])return;
      var pe=it.querySelector('.t-price');if(!pe)return;
      [Q[k],Q[GRAIN_T[k]]].some(function(q){if(q&&q.close!=null&&pe.textContent===r2(q.close)){setQ(pe,q.close);return true;}return false;});
    });
    qa('#f-prices .price-cards-grid .pc-chg-val').forEach(function(e){if(/^\u2014 0/.test(e.textContent))setT(e,'unch');});
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
function fallback(){
  fetch('/data/prices.json').then(function(r){return r.ok?r.json():null;}).then(function(d){
    if(!d||have)return;var q=d.quotes||{};
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
var AG=/\b(corn|soybeans?|wheat|cattle|hogs?|pork|beef|dairy|milk|fertili[sz]ers?|urea|usda|wasde|ethanol|biofuels?|crops?|harvest|bushels?|farm bill|grains?|egg prices|bird flu|avian)\b/i;
var NOT_AG=/\b(nominat\w*|elections?|president\w*|senat\w*|governor|primary|mayor|congress\w*)\b/i;
function fmtCT(iso,withTime){var d=new Date(iso);if(isNaN(d.getTime()))return null;var o={timeZone:'America/Chicago',month:'short',day:'numeric',year:'numeric'};if(withTime){o.hour='numeric';o.minute='2-digit';}return d.toLocaleString('en-US',o)+(withTime?' CT':'');}
function odds(){
  var fold=document.querySelector('.m-fold--kalshi'),box=document.getElementById('f-kalshi');if(!fold||!box)return;
  fetch('/data/markets.json').then(function(r){return r.ok?r.json():null;}).then(function(d){
    if(!d)return;
    var ag=(d.markets||[]).filter(function(m){var t=String(m.title||'');return m.yes!=null&&AG.test(t)&&!NOT_AG.test(t);});
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
  hook();observe();dress();odds();
  setTimeout(function(){if(!have)fallback();},2500);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
</script>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True)
    a = ap.parse_args()
    p = os.path.join(a.repo, 'index.html')
    with open(p, encoding='utf-8', newline='') as f:
        t = f.read()
    if MARK in t:
        sys.exit('r7-prices already applied to %s; refusing a second run' % p)

    # 1. Ticker: labels, units, no bare dashes before load.
    for old, new, unit in TICKER:
        t = once(t, '<span class="t-label">%s</span><span class="t-price">--</span><span class="t-chg nc">--</span>' % old,
                 '<span class="t-label">%s</span><span class="t-price"></span><span class="t-unit">%s</span><span class="t-chg nc"></span>' % (new, unit),
                 'ticker:' + old)
    for nm, k in (('Corn', 2), ('Soybean', 2), ('Wheat', 1), ('Cattle', 2)):
        t = times(t, ' data-track="ticker" aria-label="%s futures prices"' % nm, ' data-track="ticker"', k, 'ticker aria ' + nm)
    t = once(t, BADGE_OLD, BADGE_NEW, 'ticker badge')
    t = once(t, "if(_tbErr){_tbErr.textContent='\u2014';", "if(_tbErr){_tbErr.textContent='Not loaded yet';", 'ticker badge error')
    t = once(t, """tick:"Beans Nov '27\"""", """tick:"Soybeans Nov '27\"""", 'forward-year ticker label')

    # 2. Key contracts: unit beside the price, no bare dashes, Soybeans.
    for pid in ('pcp-corn-near', 'pcp-corn-dec', 'pcp-bean-near', 'pcp-bean-nov'):
        t = once(t, '<div class="pc-price" id="%s">--</div>' % pid,
                 '<div class="r7-pl"><div class="pc-price" id="%s"></div><span class="r7-unit">per bu</span></div>' % pid,
                 'key price ' + pid)
    for cid in ('pcc-corn-near', 'pcc-corn-dec', 'pcc-bean-near', 'pcc-bean-nov'):
        t = once(t, '<span class="pc-chg-val nc" id="%s">--</span>' % cid,
                 '<span class="pc-chg-val nc" id="%s"></span>' % cid, 'key chg ' + cid)
    def blank_keys(m):
        b = m.group(0)
        b, n1 = re.subn(r'(<span id="pcrl-[a-z-]+-(?:lo|hi)">)[^<]*(</span>)', r'\1\2', b)
        b, n2 = re.subn(r'(<div class="pc-range-(?:fill|dot)" id="pcr[fd]-[a-z-]+") style="(?:width|left):[0-9.]+%"', r'\1', b)
        b, n3 = re.subn(r'<span class="pc-contract">(?:Front Month|Dec \'26|Nov \'26)</span>', '<span class="pc-contract"></span>', b)
        if (n1, n2, n3) != (8, 8, 4):
            sys.exit('ANCHOR key-tile static values matched %r, expected (8, 8, 4)' % ((n1, n2, n3),))
        return b
    t = rx_once(t, r'<div class="price-cards-grid">.*?<details class="m-fold m-fold--usda"', blank_keys, 'key tiles block')
    t = times(t, '<span>52-Wk Range</span>', '<span>52-week range</span>', 4, 'key range label')
    t = once(t, '</span>Beans Deferred</span>', '</span>Soybeans deferred</span>', 'beans deferred name')
    t = once(t, '</span>Corn Deferred</span>', '</span>Corn deferred</span>', 'corn deferred name')

    # 3-6. Secondary contracts become ledger rows; S&P, Bitcoin, XRP cut.
    t = rx_once(t, r'<details class="m-fold m-fold--more" open>.*?data-spark="ripple".*?</details>', LEDGER_HTML, 'secondary price folds')

    # 7. Crop progress.
    t = once(t, CROP_FMT_OLD, CROP_FMT_NEW, 'crop fmtChg')
    t = once(t, "fmtChg(d.good_excellent,d.good_excellent_prev_week,'%'),yrChg=fmtChg(d.good_excellent,d.good_excellent_prev_year,'%');",
             "fmtChg(d.good_excellent,d.good_excellent_prev_week,' points'),yrChg=fmtChg(d.good_excellent,d.good_excellent_prev_year,' points');",
             'crop change units')
    t = once(t, CROP_LOOP_OLD, CROP_LOOP_NEW, 'crop loop')
    t = once(t, CROP_PLANT_OLD, CROP_PLANT_NEW, 'crop planted')
    t = once(t, CROP_AFTER_OLD, CROP_AFTER_NEW, 'crop note')
    t = times(t, '<span class="crop-chg-lbl">wk</span>', '<span class="crop-chg-lbl">week</span>', 2, 'crop wk label')
    t = times(t, '<span class="crop-chg-lbl">vs yr ago</span>', '<span class="crop-chg-lbl">vs last year</span>', 2, 'crop yr label')
    t = once(t, 'Crop Progress &mdash; G/E Rating</span>', 'Crop Progress &mdash; Good/Excellent</span>', 'crop title')
    t = once(t, '<span class="crop-week-badge" id="crop-week-badge">USDA &middot; Mon 4pm ET</span>', '<span class="crop-week-badge" id="crop-week-badge">USDA &middot; Mondays 4:00 PM ET</span>', 'crop badge')

    # 8. Export sales.
    t = once(t, EXP_FMT_OLD, EXP_FMT_NEW, 'export fmtMT')
    t = once(t, EXP_DATE_OLD, EXP_DATE_NEW, 'export fmtDate')
    t = once(t, EXP_MKT_OLD, EXP_MKT_NEW, 'export marketing year')
    t = once(t, EXP_WK_OLD, EXP_WK_NEW, 'export weekly')
    t = once(t, EXP_PCT_OLD, EXP_PCT_NEW, 'export pace flag')
    t = once(t, EXP_CUM_OLD, EXP_CUM_NEW, 'export cumulative')
    t = once(t, EXP_END_OLD, EXP_END_NEW, 'export end')
    t = once(t, EXP_TIP_OLD, EXP_TIP_NEW, 'export tips')
    t = once(t, 'Export Sales &mdash; Cumulative Bookings</span>', 'Export Sales &mdash; Commitments</span>', 'export title')
    t = times(t, '<span class="export-wk-lbl">this wk</span>', '<span class="export-wk-lbl">net sales this week</span>', 3, 'export week label')

    # 9. Fertilizer.
    t = rx_once(t, FERT_RX, FERT_NEW, 'fertilizer render')
    t = once(t, '<span class="fert-footer-note" id="fert-src-note">Midwest dealer quotes</span>',
             '<span class="fert-footer-note" id="fert-src-note">Midwest dealer quotes, dollars per ton</span>', 'fert footer')

    # 11. Prediction markets: CSS hides the fold; the script shows ag-linked rows only.
    # CSS and JS blocks.
    if t.count('</head>') != 1:
        sys.exit('ANCHOR </head> matched %d times, expected 1' % t.count('</head>'))
    t = t.replace('</head>', CSS + '</head>', 1)
    if t.count('</body>') != 1:
        sys.exit('ANCHOR </body> matched %d times, expected 1' % t.count('</body>'))
    t = t.replace('</body>', JS + '</body>', 1)

    with open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(t)
    print('r7-prices applied to %s' % p)


if __name__ == '__main__':
    main()
