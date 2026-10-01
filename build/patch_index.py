#!/usr/bin/env python3
"""
patch_index.py -- 2026-10-01 homepage audit kit, applied to the LIVE
homepage (index.html), not index1.html.

Runs against a pristine clone. Every anchor is asserted to appear exactly
once before it is replaced, so the same input always gives the same output
and a drifted page fails loudly instead of silently half-patching.

  python3 build/patch_index.py --src /path/to/pristine/index.html --out index.html

What it changes, in order:
  1. Corn / beans second tile rolls to next year's harvest contract
     (Dec '27 corn, Nov '27 beans) when the front month IS this year's
     harvest contract, instead of hiding. Ticker item rolls the same way.
     Also fixes the chip label race that left "Front Month + new crop" on
     the first tile after geo.js had already named the contract.
  2. AGSIST_PRICE_DATA is published before the collapse runs (the roll
     reads it; on about half of loads it ran first and found nothing).
  3. THE ACTION carries its own frame of reference: the price it was
     written at and the price now.
  4. USDA calendar: WASDE / Crop Production / Grain Stocks / Acreage at
     12:00pm ET, not 11:00am. Oct 9 note corrected.
  5. Export panel: "Week ending", honest wording when the USDA target
     table has not been loaded, title no longer promises a pace.
  6. The Read: range line says it is the 5-yr range; stray " ." fixed;
     cattle card names the net position and its percentile; no baked
     sentence survives a failed fetch.
  7. Failed fetches say "unavailable" instead of "Loading..." forever
     (yield nowcast, watch list, cattle read).
  8. Keyboard focus lands somewhere after hero expand / dismiss.
  9. Section "all" links reach a 44px tap height on phones.
 10. homepage-extras.js loaded so the "Watch this elevator" button works.
 11. Cache-bust geo.js and bids-homepage.js.
"""
import argparse
from pathlib import Path


def must_count(hay, needle, n, label):
    c = hay.count(needle)
    if c != n:
        raise SystemExit(f"anchor check failed for {label!r}: expected {n}, found {c}\nneedle: {needle[:140]!r}")


def apply(data, old, new, label):
    must_count(data, old, 1, label)
    return data.replace(old, new, 1)


# ───────────────────────────── 1. the roll ─────────────────────────────
OLD_COLLAPSE = '''  /* Reads the rendered cards rather than the feed: the two cards are fed by
     different keys and a symbol match in the data would not prove the reader
     is looking at the same two numbers. */
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
      card.style.display=same?'none':'';
      var keep=a.parentNode;
      while(keep&&keep!==document.body&&(' '+(keep.className||'')+' ').indexOf(' pc ')<0)keep=keep.parentNode;
      var lbl=keep&&keep.querySelector?keep.querySelector('.pc-contract'):null;
      if(lbl){
        var base=(lbl.getAttribute('data-base')||lbl.textContent||'').trim();
        lbl.setAttribute('data-base',base);
        lbl.textContent=same?(base+' + new crop'):base;
      }
    });
  }
'''

NEW_COLLAPSE = '''  /* Reads the rendered cards rather than the feed: the two cards are fed by
     different keys and a symbol match in the data would not prove the reader
     is looking at the same two numbers. */
  /* 2026-10-01. From early fall to year end the front month IS the harvest
     contract, and this page used to hide the second corn and bean tile and
     write "+ new crop" on the first. Sig: never drop to one tile. When the
     two tiles would show the same contract, the second rolls to NEXT year's
     harvest contract -- Dec '27 corn, Nov '27 beans -- which
     scripts/fetch_prices.py already writes into data/prices.json as
     corn-dec27 / beans-nov27. The ticker item for the harvest month rolls
     with it. If that quote is missing the old hide-and-relabel behaviour
     is the fallback, so the page never prints a forward year with no
     number under it. */
  var FORWARD_YEAR={
    'corn-dec':{dataKey:'corn-dec27',rangeId:'corn-dec',sym:'corn-dec',label:"Dec '27",tick:"Corn Dec '27"},
    'bean-nov':{dataKey:'beans-nov27',rangeId:'beans-nov',sym:'beans-nov',label:"Nov '27",tick:"Beans Nov '27"}
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
      if(elLo)elLo.textContent='$'+lo.toFixed(2);
      if(elHi)elHi.textContent='$'+hi.toFixed(2);
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
  var NEW_CROP_SUFFIX=' + new crop';
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
    var call=d.todays_call||{}, lp=d.locked_prices||{};
    var key=call.instrument||'corn';
    var NAMES={corn:'corn',beans:'beans',wheat:'wheat',oats:'oats',cattle:'live cattle',feeders:'feeders',hogs:'hogs',milk:'Class III milk',meal:'soy meal',crude:'crude',natgas:'natural gas'};
    var GRAIN={corn:1,beans:1,wheat:1,oats:1,'corn-dec':1,'beans-nov':1};
    var was=lp[key], live=q[key];
    if(was==null||!live||live.close==null)return;
    var now=GRAIN[key]?live.close/100:+live.close;
    if(!isFinite(now)||!isFinite(+was))return;
    /* Subtract the two PRINTED prices, so the gap a reader checks by hand
       is the gap on the line ($5.25 - $5.01 = 24c, not the 23.25c of the
       unrounded values). */
    var diff=parseFloat((+now).toFixed(2))-parseFloat((+was).toFixed(2)), txt;
    if(GRAIN[key]){
      var c=Math.round(diff*100);
      txt=c===0?'unchanged since':(c>0?'+':'\\u2212')+Math.abs(c)+'\\u00a2 since';
    }else{
      txt=Math.abs(diff)<0.005?'unchanged since':(diff>0?'+':'\\u2212')+'$'+Math.abs(diff).toFixed(2)+' since';
    }
    var fmt=function(v){return '$'+(+v).toFixed(2);};
    var line=document.getElementById('daily-takeaway-frame');
    if(!line){
      line=document.createElement('p');
      line.id='daily-takeaway-frame';
      line.className='daily-takeaway-frame';
      line.setAttribute('style',"font-family:'JetBrains Mono',monospace;font-size:.72rem;color:var(--text-muted);margin:.5rem 0 0;letter-spacing:.02em");
      ta.appendChild(line);
    }
    line.textContent='Written at '+fmt(was)+' '+(NAMES[key]||key)+' \\u00b7 now '+fmt(now)+' ('+txt+')';
  };
'''

OLD_PRICE_SET = '''    renderRanges(q);
    watchSameContract();
'''
NEW_PRICE_SET = '''    /* Published BEFORE the collapse runs: the forward-year roll reads it. */
    window.AGSIST_PRICE_DATA=q;
    renderRanges(q);
    watchSameContract();
    if(typeof window.agsistFrameAction==='function')window.agsistFrameAction();
'''
OLD_PRICE_SET2 = '''    // window.AGSIST_PRICE_DATA exposed for any future charting
    window.AGSIST_PRICE_DATA=q;
'''
NEW_PRICE_SET2 = '''    // window.AGSIST_PRICE_DATA is set above, before renderRanges.
'''

OLD_TAKEAWAY = '''  if(taEl){if(takeaway){if(taText)taText.innerHTML=mdInline(takeaway);taEl.style.display='block';}else{taEl.style.display='none';}}
'''
NEW_TAKEAWAY = '''  if(taEl){if(takeaway){if(taText)taText.innerHTML=mdInline(takeaway);taEl.style.display='block';}else{taEl.style.display='none';}}
  window.AGSIST_DAILY=data;
  if(typeof window.agsistFrameAction==='function')window.agsistFrameAction();
'''

# ──────────────────────── 4. USDA calendar times ────────────────────────
OLD_MAJORS = "var majors=[{name:'WASDE',date:'2026-05-12',time:'11:00am ET',note:'Market-moving'},{name:'WASDE',date:'2026-06-11',time:'11:00am ET',note:'Market-moving'},{name:'Acreage Report',date:'2026-06-30',time:'11:00am ET',note:'Planted acres'},{name:'Grain Stocks',date:'2026-06-30',time:'11:00am ET',note:''},{name:'WASDE',date:'2026-07-10',time:'11:00am ET',note:'Market-moving'},{name:'WASDE',date:'2026-08-12',time:'11:00am ET',note:'Market-moving'},{name:'Crop Production',date:'2026-08-12',time:'11:00am ET',note:'First corn est.'},{name:'WASDE',date:'2026-09-11',time:'11:00am ET',note:'Market-moving'},{name:'Crop Production',date:'2026-09-11',time:'11:00am ET',note:''},{name:'WASDE',date:'2026-10-09',time:'11:00am ET',note:'Market-moving'},{name:'Crop Production',date:'2026-10-09',time:'11:00am ET',note:'Final corn est.'},{name:'WASDE',date:'2026-11-10',time:'11:00am ET',note:'Market-moving'},{name:'WASDE',date:'2026-12-10',time:'11:00am ET',note:'Market-moving'}];"
NEW_MAJORS = "/* NASS and WAOB release WASDE, Crop Production, Grain Stocks and Acreage at 12:00 noon ET; this page's own FAQ and /usda-calendar already said so, this list said 11:00am. October Crop Production is a yield update; the final corn estimate is January's Annual Crop Production. */\n    var majors=[{name:'WASDE',date:'2026-05-12',time:'12:00pm ET',note:'Market-moving'},{name:'WASDE',date:'2026-06-11',time:'12:00pm ET',note:'Market-moving'},{name:'Acreage Report',date:'2026-06-30',time:'12:00pm ET',note:'Planted acres'},{name:'Grain Stocks',date:'2026-06-30',time:'12:00pm ET',note:''},{name:'WASDE',date:'2026-07-10',time:'12:00pm ET',note:'Market-moving'},{name:'WASDE',date:'2026-08-12',time:'12:00pm ET',note:'Market-moving'},{name:'Crop Production',date:'2026-08-12',time:'12:00pm ET',note:'First corn est.'},{name:'WASDE',date:'2026-09-11',time:'12:00pm ET',note:'Market-moving'},{name:'Crop Production',date:'2026-09-11',time:'12:00pm ET',note:''},{name:'WASDE',date:'2026-10-09',time:'12:00pm ET',note:'Market-moving'},{name:'Crop Production',date:'2026-10-09',time:'12:00pm ET',note:'Oct yield update'},{name:'WASDE',date:'2026-11-10',time:'12:00pm ET',note:'Market-moving'},{name:'WASDE',date:'2026-12-10',time:'12:00pm ET',note:'Market-moving'}];"

# ─────────────────────────── 5. export panel ───────────────────────────
OLD_EXP_DATE = "dateEl.textContent='Week of '+fmtDate(data.report_date)+' \\u00b7 FAS';"
NEW_EXP_DATE = "dateEl.textContent='Week ending '+fmtDate(data.report_date)+' \\u00b7 FAS';"
OLD_EXP_COPY = "cumEl.textContent=(d.cumulative_mt/1e6).toFixed(1)+'M MT booked \\u00b7 no USDA target published'+(EX_MY?' for '+EX_MY:'')+', so no pace to measure it against';"
NEW_EXP_COPY = "cumEl.textContent=(d.cumulative_mt/1e6).toFixed(1)+'M MT booked \\u00b7 AGSIST has not loaded USDA\\u2019s'+(EX_MY?' '+EX_MY:'')+' export projection yet, so no pace shown';"
OLD_EXP_TITLE = "Export Sales &mdash; Cumulative Pace</span>"
NEW_EXP_TITLE = "Export Sales &mdash; Cumulative Bookings</span>"

# ───────────────────────────── 6. The Read ─────────────────────────────
OLD_READ_PRICE = "if($(pre+'-price'))$(pre+'-price').textContent='$'+cur.toFixed(2)+' \\u00b7 range $'+lo.toFixed(2)+'\\u2013$'+hi.toFixed(2);"
NEW_READ_PRICE = "if($(pre+'-price'))$(pre+'-price').textContent='$'+cur.toFixed(2)+' \\u00b7 '+(tag==='5-YR'?'5-yr':'52-wk')+' range $'+lo.toFixed(2)+'\\u2013$'+hi.toFixed(2);"
OLD_READ_JOIN = "if($(pre+'-read'))$(pre+'-read').innerHTML='<b>'+rd[0]+'</b> '+rd[1];\n      });"
NEW_READ_JOIN = "if($(pre+'-read'))$(pre+'-read').innerHTML='<b>'+rd[0]+'</b>'+(rd[1]==='.'?'':' ')+rd[1];\n      });"
OLD_READ_RET = "        else return;\n        pct=Math.max(0,Math.min(100,pct));"
# bake_homepage.py writes this morning's real read into the markup. With no
# live data the baked numbers stay, but the tag says they are the bake, not live.
NEW_READ_RET = "        else{if($(pre+'-tag'))$(pre+'-tag').textContent='CACHED';return;}\n        pct=Math.max(0,Math.min(100,pct));"
OLD_CATTLE_READ = "if($(pre+'-read'))$(pre+'-read').innerHTML='<b>Funds '+(lc.net>=0?'net long':'net short')+' fed cattle</b> ('+cp+'%)'+_fclause;}"
NEW_CATTLE_READ = "/* \"(2%)\" read as \"2% net long\". It is the position's place in its own 52-week range. Say the position and say what the percentage is. */\n          var _netTxt=(Math.abs(lc.net)>=1000?(Math.abs(lc.net)/1000).toFixed(1)+'k':String(Math.abs(lc.net)));\n          if($(pre+'-read'))$(pre+'-read').innerHTML='<b>Funds '+(lc.net>=0?'net long':'net short')+' fed cattle</b> '+_netTxt+' contracts, '+cp+ord(cp)+' pctile of its 52-wk range'+(_fclause==='.'?'.':_fclause);}"
OLD_CATTLE_IF = "      var le=px.cattle,gf=px.feeders,lc=cot.livecattle,pre='sig-cattle';\n      if(le&&gf&&le.close!=null&&gf.close!=null){"
# The baked cattle read (price-stats 5-yr percentile) stays; only the
# never-baked price line stops saying "Loading" forever.
NEW_CATTLE_IF = "      var le=px.cattle,gf=px.feeders,lc=cot.livecattle,pre='sig-cattle';\n      if(!(le&&gf&&le.close!=null&&gf.close!=null)){if($(pre+'-price'))$(pre+'-price').textContent='Unavailable right now';if($(pre+'-tag'))$(pre+'-tag').textContent='CACHED';}\n      if(le&&gf&&le.close!=null&&gf.close!=null){"

# ─────────────────────── 7. honest failure states ───────────────────────
OLD_NC = "    fetch('/data/yield-nowcast.json').then(function(r){return r.ok?r.json():null;}).then(function(d){\n      if(!d||!d.crops)return;\n      var map={corn:'nc-corn',soybeans:'nc-beans'};"
NEW_NC = "    fetch('/data/yield-nowcast.json').then(function(r){return r.ok?r.json():null;},function(){return null;}).then(function(d){\n      if(!d||!d.crops){var _v=document.getElementById('nc-verdict');if(_v){_v.className='ratio-verdict neutral';_v.textContent='Unavailable this week';}return;}\n      var map={corn:'nc-corn',soybeans:'nc-beans'};"
OLD_DAILY_CATCH = "    // headline for the share links instead of the fake \"loading\" text.\n    wireShare();\n  });"
NEW_DAILY_CATCH = "    // headline for the share links instead of the fake \"loading\" text.\n    // The sidebar is NOT baked, so its placeholders must not say \"Loading\" forever.\n    var _wl=document.getElementById('daily-watch-list');\n    if(_wl)_wl.innerHTML='<li class=\"watch-item\"><span class=\"watch-time\">&mdash;</span><span class=\"watch-desc\">Watch list unavailable \\u2014 see <a href=\"/daily\" style=\"color:var(--gold)\">today\\u2019s briefing</a></span></li>';\n    wireShare();\n  });"

# ───────────────────────── 8. keyboard focus ─────────────────────────
OLD_DISMISS = "function dismissDaily(){try{localStorage.setItem(TODAY_KEY,'1');}catch(e){}var hero=document.getElementById('daily-hero');if(hero){hero.classList.add('dismissed');hero.setAttribute('aria-expanded','false');}document.documentElement.classList.add('daily-pre-dismissed');setTimeout(function(){window.scrollTo({top:0,behavior:'smooth'});},50);}"
NEW_DISMISS = "function dismissDaily(){try{localStorage.setItem(TODAY_KEY,'1');}catch(e){}var hero=document.getElementById('daily-hero');if(hero){hero.classList.add('dismissed');hero.setAttribute('aria-expanded','false');}document.documentElement.classList.add('daily-pre-dismissed');setTimeout(function(){window.scrollTo({top:0,behavior:'smooth'});var t=document.getElementById('daily-teaser');if(t&&t.focus)t.focus();},50);}"
OLD_EXPAND = "function expandDaily(){try{localStorage.removeItem(TODAY_KEY);}catch(e){}var hero=document.getElementById('daily-hero');if(hero){hero.classList.remove('dismissed');hero.setAttribute('aria-expanded','true');}document.documentElement.classList.remove('daily-pre-dismissed');}"
NEW_EXPAND = "function expandDaily(){try{localStorage.removeItem(TODAY_KEY);}catch(e){}var hero=document.getElementById('daily-hero');if(hero){hero.classList.remove('dismissed');hero.setAttribute('aria-expanded','true');}document.documentElement.classList.remove('daily-pre-dismissed');var h=document.getElementById('daily-headline');if(h){if(!h.hasAttribute('tabindex'))h.setAttribute('tabindex','-1');try{h.focus({preventScroll:true});}catch(e){h.focus();}}}"
OLD_MORE = "    var s=hero.querySelector('.daily-sections');\n    if(s) s.scrollIntoView({block:'start',behavior:'smooth'});"
NEW_MORE = "    var s=hero.querySelector('.daily-sections');\n    if(s){s.scrollIntoView({block:'start',behavior:'smooth'});if(!s.hasAttribute('tabindex'))s.setAttribute('tabindex','-1');try{s.focus({preventScroll:true});}catch(e){}}"
OLD_COMPACT_DISMISS = "var btnCompactDismiss=document.getElementById('btn-compact-dismiss');if(btnCompactDismiss)btnCompactDismiss.addEventListener('click',function(){setDismissed('agsist_signup_compact_dismissed');var el=document.getElementById('signup-compact');if(el)el.style.display='none';});"
NEW_COMPACT_DISMISS = "var btnCompactDismiss=document.getElementById('btn-compact-dismiss');if(btnCompactDismiss)btnCompactDismiss.addEventListener('click',function(){setDismissed('agsist_signup_compact_dismissed');var el=document.getElementById('signup-compact');if(el)el.style.display='none';var m=document.getElementById('main');if(m&&m.focus){try{m.focus({preventScroll:true});}catch(e){}}});"

# ───────────────────────── 9. tap targets ─────────────────────────
OLD_SEC_ALL_CSS = "  .pc-contract{font-size:0.787rem!important;}"
NEW_SEC_ALL_CSS = "  .pc-contract{font-size:0.787rem!important;}\n  /* 2026-10-01: section links measured 22px tall at 390px; 44px is the floor. */\n  .sec-head .sec-all{display:inline-flex;align-items:center;min-height:44px}"

# ───────────────── 10/11. scripts ─────────────────
OLD_SCRIPTS = '<script src="/components/geo.js?v=17" defer></script>\n<script src="/components/bids-homepage.js?v=14" defer></script>'
NEW_SCRIPTS = '<script src="/components/geo.js?v=18" defer></script>\n<script src="/components/bids-homepage.js?v=15" defer></script>\n<script src="/components/homepage-extras.js?v=1" defer></script>'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    data = Path(a.src).read_text(encoding='utf-8')

    data = apply(data, OLD_COLLAPSE, NEW_COLLAPSE, 'collapse block')
    data = apply(data, OLD_PRICE_SET, NEW_PRICE_SET, 'price data before collapse')
    data = apply(data, OLD_PRICE_SET2, NEW_PRICE_SET2, 'remove later price data set')
    data = apply(data, OLD_TAKEAWAY, NEW_TAKEAWAY, 'frame the action')
    data = apply(data, OLD_MAJORS, NEW_MAJORS, 'USDA calendar times')
    data = apply(data, OLD_EXP_DATE, NEW_EXP_DATE, 'week ending')
    data = apply(data, OLD_EXP_COPY, NEW_EXP_COPY, 'export copy')
    data = apply(data, OLD_EXP_TITLE, NEW_EXP_TITLE, 'export title')
    data = apply(data, OLD_READ_PRICE, NEW_READ_PRICE, 'read price line')
    data = apply(data, OLD_READ_JOIN, NEW_READ_JOIN, 'read join')
    data = apply(data, OLD_READ_RET, NEW_READ_RET, 'read unavailable')
    data = apply(data, OLD_CATTLE_READ, NEW_CATTLE_READ, 'cattle read')
    data = apply(data, OLD_CATTLE_IF, NEW_CATTLE_IF, 'cattle unavailable')
    data = apply(data, OLD_NC, NEW_NC, 'nowcast unavailable')
    data = apply(data, OLD_DAILY_CATCH, NEW_DAILY_CATCH, 'watch list unavailable')
    data = apply(data, OLD_DISMISS, NEW_DISMISS, 'dismiss focus')
    data = apply(data, OLD_EXPAND, NEW_EXPAND, 'expand focus')
    data = apply(data, OLD_MORE, NEW_MORE, 'more focus')
    data = apply(data, OLD_COMPACT_DISMISS, NEW_COMPACT_DISMISS, 'compact dismiss focus')
    data = apply(data, OLD_SEC_ALL_CSS, NEW_SEC_ALL_CSS, 'sec-all tap height')
    data = apply(data, OLD_SCRIPTS, NEW_SCRIPTS, 'scripts')

    Path(a.out).write_text(data, encoding='utf-8')
    print(f"wrote {a.out} ({len(data)} bytes)")


if __name__ == '__main__':
    main()
