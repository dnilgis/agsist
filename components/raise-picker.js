/* WAVE2-F 2026-10-03: "What do you raise?" One pick for the whole homepage
   (index1). It only reorders, opens and lifts. Nothing is removed, except the
   "This month" cells that concern only crops the reader did not pick (never
   the insurance box or the frost tile). With no pick the page is unchanged.

   Stored in localStorage 'agsist-raise' as a comma list of the keys in PICKS.
   The old "I raise" toggle (Row Crops / Cattle Only / Mixed) was three radio
   inputs with no stored value, so there is nothing of it to read back.

   Hooks it drives, each owned by another script and only used here:
     ticker            #ticker-items-single children, then rebuildTickerLoop()
     key contracts     #f-prices .price-cards-grid children
     more grains rows  the first .r7-led under .m-fold--more, its fold opened
     COT rows          window.AGSIST_COT.rows (reordered in place) + .render()
     The Read cards    #f-read .sig-grid children
     price alert       #pa-symbol default, until the reader changes it
     insurance box     window.AGSIST_INS_PREF + window.AGSIST_INS_RENDER()
     bids card         localStorage 'agsist_bids_crop' when exactly one bid crop
     This month cells  #s7-grid .s7-c */
(function(){
  'use strict';
  var KEY='agsist-raise', BID_KEY='agsist_bids_crop', BID_MINE='agsist-raise-bid';
  /* k, label, group, and what each pick lifts. */
  var PICKS=[
    {k:'corn',n:'Corn',g:'c',tk:['corn','corn-dec'],led:[],cot:['corn'],sig:['sig-corn'],pa:['corn','corn-dec'],ins:'Corn',bid:'corn'},
    {k:'soy',n:'Soybeans',g:'c',tk:['beans','beans-nov','meal'],led:['meal'],cot:['beans','soymeal'],sig:['sig-beans'],pa:['beans','beans-nov'],ins:'Soybeans',bid:'soybeans'},
    {k:'srw',n:'Chicago SRW',g:'w',tk:['wheat'],led:['wheat'],cot:['wheat'],sig:['sig-wheat'],pa:['wheat'],ins:'Wheat',bid:'wheat'},
    {k:'hrw',n:'KC HRW',g:'w',tk:['kcwheat'],led:['kcwheat'],cot:['kcwheat'],sig:['sig-wheat'],pa:[],ins:'Wheat',bid:'wheat'},
    {k:'hrs',n:'MGEX HRS',g:'w',tk:['mplswheat'],led:['mplswheat'],cot:['mplswheat'],sig:['sig-wheat'],pa:[],ins:'Wheat',bid:'wheat'},
    {k:'sorghum',n:'Sorghum',g:'c',tk:[],led:[],cot:[],sig:[],pa:[],ins:'Grain Sorghum',bid:'sorghum'},
    {k:'cotton',n:'Cotton',g:'c',tk:['cotton'],led:['cotton'],cot:[],sig:[],pa:[],ins:'Cotton'},
    {k:'rice',n:'Rice',g:'c',tk:['rice'],led:['rice'],cot:[],sig:[],pa:[],ins:'Rice'},
    {k:'peanuts',n:'Peanuts',g:'c',tk:[],led:[],cot:[],sig:[],pa:[],ins:'Peanuts'},
    {k:'oats',n:'Oats',g:'c',tk:['oats'],led:['oats'],cot:[],sig:[],pa:[],bid:'oats'},
    {k:'fed',n:'Fed cattle',g:'l',tk:['cattle'],led:['cattle'],cot:['livecattle'],sig:['sig-cattle'],pa:['cattle']},
    {k:'feeder',n:'Feeder cattle',g:'l',tk:['feeders'],led:['feeders'],cot:['feedercattle'],sig:['sig-cattle'],pa:[]},
    {k:'hogs',n:'Hogs',g:'l',tk:['hogs'],led:['hogs'],cot:['leanhogs'],sig:[],pa:[]},
    {k:'dairy',n:'Dairy',g:'l',tk:['milk'],led:['milk'],cot:['milk'],sig:[],pa:[]}
  ];
  var BYK={};PICKS.forEach(function(p,i){p.i=i;BYK[p.k]=p;});
  var GROUPS=[['c','Crops'],['w','Wheat'],['l','Livestock and dairy']];
  /* "This month" cells and the picks they concern. A cell not listed here
     (insurance, frost, report, rent, spray) always shows. */
  var CROP_KEYS=PICKS.filter(function(p){return p.g!=='l';}).map(function(p){return p.k;});
  var CELL={fallN:CROP_KEYS,harvest:CROP_KEYS,soilPlant:CROP_KEYS,condition:['corn','soy'],planting:['corn','soy']};

  function lsGet(k){try{return window.localStorage.getItem(k);}catch(e){return null;}}
  function lsSet(k,v){try{window.localStorage.setItem(k,v);}catch(e){}}
  function lsDel(k){try{window.localStorage.removeItem(k);}catch(e){}}
  function read(){var v=lsGet(KEY)||'',out=[];v.split(',').forEach(function(k){k=k.trim();if(BYK[k]&&out.indexOf(k)<0)out.push(k);});
    return out.sort(function(a,b){return BYK[a].i-BYK[b].i;});}
  var chosen=read();

  /* Union of one field over the chosen picks, in picker order. */
  function all(field){var o=[];chosen.forEach(function(k){(BYK[k][field]||[]).forEach(function(x){if(o.indexOf(x)<0)o.push(x);});});return o;}
  function one(field){var o=[];chosen.forEach(function(k){var x=BYK[k][field];if(x&&o.indexOf(x)<0)o.push(x);});return o;}

  /* ---- Before any later script runs: insurance order and the bids crop. ---- */
  function setPrefs(){
    window.AGSIST_RAISE=chosen.slice();
    window.AGSIST_INS_PREF=one('ins');
    var bids=one('bid'),mine=lsGet(BID_MINE),cur=lsGet(BID_KEY);
    if(bids.length===1){
      if(cur!==bids[0]){lsSet(BID_KEY,bids[0]);clickChip(bids[0]);}
      lsSet(BID_MINE,bids[0]);
    } else if(mine){
      /* Ours, and the reader has not picked another chip since: back to all. */
      if(cur===mine){lsDel(BID_KEY);clickChip('all');}
      lsDel(BID_MINE);
    }
  }
  function clickChip(c){
    var b=document.querySelector('#bids-content .bh-crop[data-crop="'+c+'"], .bh-crop[data-crop="'+c+'"]');
    if(!b||b.getAttribute('aria-pressed')==='true')return;
    /* The card focuses its chip after a click; keep the reader where they are. */
    var was=document.activeElement;b.click();
    if(was&&was!==document.body&&document.contains(was)&&was.focus)try{was.focus({preventScroll:true});}catch(e){}
  }
  setPrefs();

  /* ---- The picker ---- */
  var btn=document.getElementById('pk-btn'),panel=document.getElementById('pk-panel'),
      val=document.getElementById('pk-val'),lead=document.getElementById('pk-lead'),
      chg=document.getElementById('pk-chg'),say=document.getElementById('pk-say');
  /* Does anything on the page answer to this pick right now? */
  function responds(p){
    var q=function(sel){return document.querySelector(sel);};
    if((p.tk||[]).some(function(t){var e=q('.prices-strip .t-item[data-sym="'+t+'"]');return e&&!e.classList.contains('t-noq');}))return true;
    if((p.led||[]).some(function(t){var e=q('#f-prices .r7-row[data-r7k="'+t+'"]');return e&&!e.classList.contains('r7-noq');}))return true;
    if((p.cot||[]).length&&window.AGSIST_COT&&!window.AGSIST_COT.failed)return true;
    if((p.sig||[]).some(function(id){return !!document.getElementById(id);}))return true;
    if(p.bid&&q('#bids-list-area .bh-crop[data-crop="'+p.bid+'"]'))return true;
    if(p.ins){var ic=q('#s7-grid');if(ic&&ic.textContent.indexOf(p.ins)>=0)return true;}
    return false;
  }
  function names(){return chosen.map(function(k){var p=BYK[k];return p.g==='w'?p.n+' wheat':p.n;});}
  function paintBtn(){
    if(!btn)return;
    var nm=names();
    if(!nm.length){lead.textContent='What do you raise?';val.textContent='';chg.textContent='Sort the page';}
    else{lead.textContent='You raise';val.textContent=nm.length>2?nm.slice(0,2).join(', ')+' +'+(nm.length-2):nm.join(', ');chg.textContent='· Change';}
    btn.setAttribute('aria-label',nm.length?'You raise '+nm.join(', ')+'. Change':'What do you raise? Sort the page by it');
  }
  function build(){
    if(!panel)return;
    var h='<fieldset class="pk-fs"><legend class="pk-lg">What do you raise?</legend>'
      +'<p class="pk-hint">Your picks move up the page. Saved in this browser only.</p>';
    GROUPS.forEach(function(g){
      h+='<div class="pk-g" role="group" aria-labelledby="pk-g-'+g[0]+'"><span class="pk-gk" id="pk-g-'+g[0]+'">'+g[1]+'</span><span class="pk-opts">';
      PICKS.forEach(function(p){if(p.g!==g[0])return;
        h+='<label class="pk-o"><input type="checkbox" value="'+p.k+'"'+(chosen.indexOf(p.k)>=0?' checked':'')+'><span>'+p.n+'</span></label>';});
      h+='</span></div>';
    });
    h+='<div class="pk-act"><button type="button" class="pk-done">Done</button><button type="button" class="pk-clear">Clear</button></div></fieldset>';
    panel.innerHTML=h;
    panel.addEventListener('change',function(e){
      if(!e.target||e.target.type!=='checkbox')return;
      var c=[];Array.prototype.forEach.call(panel.querySelectorAll('input[type=checkbox]'),function(x){if(x.checked)c.push(x.value);});
      commit(c);
    });
    panel.querySelector('.pk-done').addEventListener('click',function(){toggle(false,true);});
    panel.querySelector('.pk-clear').addEventListener('click',function(){
      Array.prototype.forEach.call(panel.querySelectorAll('input[type=checkbox]'),function(x){x.checked=false;});commit([]);});
    panel.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();toggle(false,true);}});
  }
  function toggle(open,focusBtn){
    if(!btn||!panel)return;
    panel.hidden=!open;btn.setAttribute('aria-expanded',open?'true':'false');
    if(open){var f=panel.querySelector('input');if(f)f.focus();}
    else if(focusBtn)btn.focus();
  }
  function commit(c){
    chosen=c.filter(function(k){return BYK[k];}).sort(function(a,b){return BYK[a].i-BYK[b].i;});
    if(chosen.length)lsSet(KEY,chosen.join(','));else lsDel(KEY);
    setPrefs();paintBtn();applyPage(true);
    /* WAVE3-L: say only what moved. A pick with nothing on this page for it
       (peanuts in Wisconsin, a crop with no quote yet) is named as such. */
    if(say){
      if(!chosen.length)say.textContent='Cleared. The page is back to its usual order.';
      else{
        var hit=[],none=[];
        chosen.forEach(function(k){(responds(BYK[k])?hit:none).push(BYK[k].g==='w'?BYK[k].n+' wheat':BYK[k].n);});
        say.textContent='Saved. '+(hit.length?hit.join(', ')+' first.':'')+(none.length?' Nothing on this page for '+none.join(', ')+' yet.':'');
      }
    }
    if(window.gaEvent)try{window.gaEvent('raise_pick',{picks:chosen.join(',')||'none'});}catch(e){}
  }
  if(btn&&panel){
    build();paintBtn();
    btn.addEventListener('click',function(){toggle(panel.hidden,false);});
  }

  /* ---- The page ---- */
  var ORIG=null;
  function kids(el,sel){return el?Array.prototype.filter.call(el.children,function(c){return c.matches(sel);}):[];}
  function capture(){
    var o={};
    o.tick=document.getElementById('ticker-items-single');
    o.tItems=kids(o.tick,'.t-item');o.tSeps=kids(o.tick,'.t-sep');
    o.keyGrid=document.querySelector('#f-prices .price-cards-grid');
    o.keyCards=kids(o.keyGrid,'.pc');
    o.more=document.querySelector('#f-prices .m-fold--more');
    o.moreHome=o.more?o.more.parentNode:null;
    o.led=o.more?o.more.querySelector('.r7-led'):null;
    o.ledRows=kids(o.led,'.r7-row');
    o.sigGrid=document.querySelector('#f-read .sig-grid');
    o.sigs=kids(o.sigGrid,'.sig');
    o.cot=(window.AGSIST_COT&&window.AGSIST_COT.rows)?window.AGSIST_COT.rows.slice():null;
    o.pa=document.getElementById('pa-symbol');
    return o;
  }
  /* Stable: chosen first in pick order, the rest in their original order. */
  function rank(list,keyOf,want){
    return list.map(function(x,i){var k=keyOf(x),w=want.indexOf(k);return {x:x,r:w<0?1e6+i:w*1e3+i};})
      .sort(function(a,b){return a.r-b.r;}).map(function(o){return o.x;});
  }
  function reorder(parent,list){
    if(!parent||!list.length)return;
    /* After the item that is last in the page now, so a trailing non-item node stays put. */
    var last=null;Array.prototype.forEach.call(parent.childNodes,function(n){if(list.indexOf(n)>=0)last=n;});
    var anchor=last?last.nextSibling:null;
    while(anchor&&list.indexOf(anchor)>=0)anchor=anchor.nextSibling;
    list.forEach(function(el){parent.insertBefore(el,anchor);});
  }
  var paTouched=false,paMine=null;
  function applyPage(fromCommit){
    if(!ORIG)ORIG=capture();
    var O=ORIG;
    try{ /* ticker */
      if(O.tick&&O.tItems.length){
        var ti=rank(O.tItems,function(e){return e.getAttribute('data-sym');},all('tk'));
        var same=ti.every(function(e,i){return O.tick.children[i*2]===e;});
        if(!same){
          ti.forEach(function(e,i){O.tick.appendChild(e);if(i<ti.length-1&&O.tSeps[i])O.tick.appendChild(O.tSeps[i]);});
          if(typeof window.rebuildTickerLoop==='function')window.rebuildTickerLoop();
        }
      }
    }catch(e){}
    try{ /* key contracts: the chosen crop's pair first */
      var kc=rank(O.keyCards,function(e){var s=e.getAttribute('data-spark')||'';return /^corn/.test(s)?'corn':(/^beans/.test(s)?'soy':s);},chosen);
      reorder(O.keyGrid,kc);
    }catch(e){}
    try{ /* more grains and livestock */
      /* WAVE3-L: a row with no quote (hidden) is not lifted or opened for. */
      var lw=all('led').filter(function(k){var r=document.querySelector('#f-prices .r7-row[data-r7k="'+k+'"]');return !(r&&r.classList.contains('r7-noq'));});
      reorder(O.led,rank(O.ledRows,function(e){return e.getAttribute('data-r7k');},lw));
      if(O.more){
        /* Open the fold when a chosen row is in it; give it back when not. */
        if(lw.length){if(!O.more.open){O.more.open=true;O.more.setAttribute('data-pk-open','1');}O.more.setAttribute('data-touched','1');}
        else if(O.more.getAttribute('data-pk-open')){O.more.removeAttribute('data-pk-open');O.more.removeAttribute('data-touched');
          if(window.matchMedia&&window.matchMedia('(max-width:900px)').matches)O.more.open=false;}
        /* No corn or soybeans picked but a row here is: this table leads Market Prices. */
        var leadIt=lw.length&&chosen.indexOf('corn')<0&&chosen.indexOf('soy')<0;
        var box=document.getElementById('pk-led-lead');
        if(leadIt){
          var fp=document.getElementById('f-prices'),lbl=fp?fp.querySelector(':scope>.pc-section-lbl'):null;
          if(fp&&lbl){
            if(!box){box=document.createElement('div');box.id='pk-led-lead';box.className='r7-ledgers pk-led-lead';}
            if(box.parentNode!==fp||box.nextElementSibling!==lbl)fp.insertBefore(box,lbl);
            if(O.more.parentNode!==box)box.appendChild(O.more);
          }
        } else if(box){
          if(O.moreHome&&O.more.parentNode!==O.moreHome)O.moreHome.insertBefore(O.more,O.moreHome.firstChild);
          box.parentNode.removeChild(box);
        }
      }
    }catch(e){}
    try{ /* COT rows */
      if(O.cot&&window.AGSIST_COT){
        var cr=rank(O.cot,function(r){return r.k;},all('cot')),rows=window.AGSIST_COT.rows;
        rows.length=0;cr.forEach(function(r){rows.push(r);});
        window.AGSIST_COT.render();
      }
    }catch(e){}
    try{ /* The Read */
      reorder(O.sigGrid,rank(O.sigs,function(e){return e.id;},all('sig')));
    }catch(e){}
    try{ /* price alert default */
      var pa=O.pa;
      if(pa&&!paTouched){
        var want=null;all('pa').some(function(v){if(pa.querySelector('option[value="'+v+'"]')){want=v;return true;}return false;});
        if(want&&pa.value!==want){pa.value=want;paMine=want;pa.dispatchEvent(new Event('change'));}
        else if(!want&&paMine){pa.selectedIndex=0;paMine=null;pa.dispatchEvent(new Event('change'));}
      }
    }catch(e){}
    try{ /* insurance box */
      if(fromCommit&&typeof window.AGSIST_INS_RENDER==='function')window.AGSIST_INS_RENDER();
    }catch(e){}
    try{ /* This month cells */
      var grid=document.getElementById('s7-grid');
      if(grid){
        Object.keys(CELL).forEach(function(m){var c=document.getElementById('s7-c-'+m);if(!c)return;
          var off=chosen.length&&!CELL[m].some(function(k){return chosen.indexOf(k)>=0;});
          c.classList.toggle('pk-off',!!off);if(off)c.setAttribute('aria-hidden','true');else c.removeAttribute('aria-hidden');});
        var n=grid.querySelectorAll('.s7-c:not(.s7-wide):not(.pk-off)').length;
        if(n)grid.style.gridTemplateColumns=new Array(n+1).join('minmax(0,1fr) ').trim();
      }
    }catch(e){}
  }
  function boot(){
    var pa=document.getElementById('pa-symbol');
    if(pa)pa.addEventListener('change',function(e){if(e.isTrusted)paTouched=true;});
    applyPage();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
