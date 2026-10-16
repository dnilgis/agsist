/* cash-bids ranking helpers (components/cb-rank.js)
   ---------------------------------------------------------------------------
   What may be RANKED against what on /cash-bids, kept apart from the page so it
   can be tested on its own (test/cb-rank.test.mjs). Nothing here draws a card;
   the page asks these questions and prints the answers.

   1. HOW OLD IS THIS ROW. A board read straight from the elevator is posted
      once a day. A row priced before today (Central time, the grain trade's
      clock) is yesterday's market, and ranking it on its posted cash against a
      neighbour's board posted this afternoon compares two different futures
      prices, not two elevators.
        - It carries a basis and a contract we hold a later settle for in
          data/prices.json: it is ranked on basis + that settle, and the page
          prints that figure with "≈" and the words "on today's futures"
          beside the price the elevator actually posted. The re-marked number
          is never shown as the elevator's price.
        - Otherwise it is ranked below every same-day row and flagged.
   2. A BOARD WE COULD NOT READ (stale:true) whose price is over 24 hours old
      is not ranked at all. Its card still shows it, under its badge.
   3. WHEAT CLASSES ARE NOT ONE WHEAT. The rules are the ones the national
      basis map files rows under (scripts/build_basis_map.py, _WHEAT_RX), in
      the same order, so the two can never disagree about which wheat a row is.
   4. A DELIVERY WINDOW OF TWO MONTHS ("Oct-Nov 26", period 2026-10/2026-11)
      covers every month inside it.
   5. A DELIVERY-POINT LABEL ("ADM DSM") is not a town. Where another place in
      the network index shares its ZIP and names exactly one town, that town is
      used; otherwise the label is printed as given.
   --------------------------------------------------------------------------- */
(function(root){
'use strict';

/* ── Central-time calendar day ─────────────────────────────────────────── */
var _fmt=null;
function centralDay(t){
  var ms=(t instanceof Date)?t.getTime():(typeof t==='number'?t:Date.parse(String(t||'')));
  if(!isFinite(ms))return '';
  try{
    if(!_fmt)_fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'});
    var s=_fmt.format(new Date(ms));
    return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';
  }catch(e){return '';}          /* no time-zone data: the day is unknown, not guessed */
}
var WD=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
var MS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
/* "Tue" inside the last six days, "Sep 30" before that. */
function dayLabel(day,today){
  var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(day||'');if(!m)return '';
  var d=Date.UTC(+m[1],+m[2]-1,+m[3]);
  var n=/^(\d{4})-(\d{2})-(\d{2})$/.exec(today||'');
  var gap=n?Math.round((Date.UTC(+n[1],+n[2]-1,+n[3])-d)/864e5):99;
  if(gap>=1&&gap<=6)return WD[new Date(d).getUTCDay()];
  return MS[+m[2]-1]+' '+(+m[3]);
}

/* ── Two-month delivery windows ────────────────────────────────────────── */
var PAIR=/^(\d{4})-(\d{2})\/(\d{4})-(\d{2})$/;
/* Every YYYY-MM inside "2026-10/2026-11", inclusive. A window longer than a
   year or written backwards is not one this page will expand. */
function pairMonths(period){
  var m=PAIR.exec(String(period||''));if(!m)return [];
  var y=+m[1],mo=+m[2],ey=+m[3],em=+m[4],out=[];
  if(ey*12+em<y*12+mo||(ey*12+em)-(y*12+mo)>11)return [];
  while(y*12+mo<=ey*12+em){out.push(y+'-'+('0'+mo).slice(-2));mo++;if(mo>12){mo=1;y++;}}
  return out;
}
function pairEnd(period){var m=PAIR.exec(String(period||''));return m?m[3]+'-'+m[4]:'';}

/* ── Wheat class (port of build_basis_map.py _WHEAT_RX, same order) ────── */
var WHEAT_RX=[
  ['durum',/\bdurum\b/i],
  ['hdw',/\b(hdw|hard\s*white)\b/i],
  ['hrs',/\b(hrsw?|dns|dark\s*northern|mgex|mgx|spring)\b/i],
  ['sww',/\b(sww|soft\s*white|soft\s*\d+(?:\.\d+)?%?\s*white|white\s*wheat|club)\b/i],
  ['hrw',/\b(hrww?|kcbt|kc|hard\s*red\s*winter)\b/i],
  ['srw',/\b(srw|soft\s*red)\b/i]
];
function wheatClass(label){
  var s=String(label||'');
  for(var i=0;i<WHEAT_RX.length;i++)if(WHEAT_RX[i][1].test(s))return WHEAT_RX[i][0];
  return '';                                 /* the board did not say */
}
var CLASS_LABEL={hrw:'HRW',srw:'SRW',hrs:'Spring',sww:'Soft white',hdw:'Hard white',durum:'Durum','':'class not stated'};
function classLabel(c){return CLASS_LABEL[c]!=null?CLASS_LABEL[c]:c;}

/* ── Futures: which contract a row's basis is against ──────────────────── */
var MCODE='FGHJKMNQUVXZ';
var ROOT_OF={corn:['ZC'],soybeans:['ZS'],wheat:['ZW','KE']};
/* "ZSX26", "ZWZ6", "KEZ26" as written; or "Dec 26" / "Nov 26 Soybeans" /
   "Dec 2026" with the root taken from the crop -- for wheat only when the row
   names its class, because Dec wheat is two different contracts. */
function contractKey(b){
  if(!b)return '';
  var cat=b.category,roots=ROOT_OF[cat];if(!roots)return '';
  var raw=String(b.symbol||b.basisMonth||'').trim().toUpperCase().replace(/\s+/g,' ');
  var m=/^([A-Z]{2})([FGHJKMNQUVXZ])(\d{1,2})$/.exec(raw.replace(/ /g,''));
  if(m){
    if(roots.indexOf(m[1])<0)return '';      /* a corn row against a bean contract is not read */
    return m[1]+m[2]+(m[3].length===1?'2'+m[3]:m[3]);
  }
  var t=/^([A-Z]{3})[A-Z]*\.?\s*'?(\d{2}|\d{4})\b/.exec(raw);
  if(!t)return '';
  var mi=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(t[1]);
  if(mi<0)return '';
  var root=roots[0];
  if(cat==='wheat'){
    var wc=wheatClass(b.commodity);
    root=wc==='srw'?'ZW':wc==='hrw'?'KE':'';
    if(!root)return '';
  }
  return root+MCODE.charAt(mi)+t[2].slice(-2);
}
var FUT={},FUT_ROOTS={ZC:1,ZS:1,ZW:1,KE:1};
/* data/prices.json -> {ZSX26:{price:12.9575,date:'2026-10-07'}}. Only dated
   contracts (ZSX26.CBT), never a rolling front month (ZS=F), and nothing the
   file itself marks stale, withheld or retired. */
function setFutures(json){
  var out={};
  var q=json&&json.quotes;if(!q||typeof q!=='object')return (FUT=out);
  var skip={};
  ['stale_keys','withheld_keys','retired_keys'].forEach(function(k){
    var v=json[k];if(Array.isArray(v))v.forEach(function(x){skip[x]=1;});
    else if(v&&typeof v==='object')Object.keys(v).forEach(function(x){skip[x]=1;});
  });
  Object.keys(q).forEach(function(k){
    if(skip[k])return;
    var r=q[k];if(!r||typeof r!=='object')return;
    var m=/^([A-Z]{2})([FGHJKMNQUVXZ])(\d{2})\.CBT$/.exec(String(r.ticker||''));
    if(!m||!FUT_ROOTS[m[1]])return;
    var c=Number(r.close),d=String(r.close_date||'');
    if(!isFinite(c)||c<=0||!/^\d{4}-\d{2}-\d{2}$/.test(d))return;
    var key=m[1]+m[2]+m[3];
    if(!out[key]||out[key].date<d)out[key]={price:c/100,date:d};
  });
  return (FUT=out);
}
function futureFor(sym){return sym&&FUT[sym]||null;}

/* ── Can this row be ranked, and on what number ────────────────────────── */
/* opt: {now: ms, basisC: basis in cents or null (null when unusual or unclear),
         band: [lo,hi] $/bu for the crop, cash: $/bu as the page reads it} */
function assess(b,opt){
  opt=opt||{};
  var now=opt.now!=null?opt.now:Date.now();
  var cash=opt.cash!=null?opt.cash:null;
  var r={exclude:false,tier:0,fresh:0,price:cash,posted:cash,remark:null,old:false,
         unread:!!(b&&b.stale===true),day:'',today:centralDay(now)};
  if(!b){r.exclude=true;return r;}
  var t=Date.parse(String(b.asOf||''));
  if(r.unread){
    /* unread and over a day old, or of no stated age: not ranked */
    if(!isFinite(t)||(now-t)>24*3600e3){r.exclude=true;return r;}
    r.fresh=2;
  }
  if(b.via!=='direct')return r;               /* the licensed feed is live */
  r.day=isFinite(t)?centralDay(t):'';
  if(r.day&&r.today&&r.day>=r.today)return r; /* posted today */
  if(r.fresh<1)r.fresh=1;
  var sym=contractKey(b),f=futureFor(sym);
  if(f&&r.day&&f.date>r.day&&opt.basisC!=null&&isFinite(opt.basisC)){
    var p=Math.round((f.price+opt.basisC/100)*100)/100;
    if(!opt.band||(p>=opt.band[0]&&p<=opt.band[1])){
      r.remark={price:p,sym:sym,date:f.date};
      r.price=p;
      return r;
    }
  }
  r.tier=1;r.old=true;                         /* below every same-day row */
  return r;
}
/* Best first: same-day before not-re-marked; then price to the cent; on a tie
   the fresher board (posted today, then re-marked, then unread); then nearer. */
function compare(a,b){
  var ra=a.rk,rb=b.rk;
  if(ra.tier!==rb.tier)return ra.tier-rb.tier;
  var pa=Math.round((ra.price!=null?ra.price:-1e9)*100),pb=Math.round((rb.price!=null?rb.price:-1e9)*100);
  if(pa!==pb)return pb-pa;
  if(ra.fresh!==rb.fresh)return ra.fresh-rb.fresh;
  return (a.dist!=null?a.dist:999)-(b.dist!=null?b.dist:999);
}
/* The words that go beside a re-marked or day-old price. Plain text. */
function px(v,fmt){return typeof fmt==='function'?fmt(v):v.toFixed(2);}
/* `fmt`: the page's price formatter (fmtPx, the board's own decimals). */
function note(rk,fmt){
  if(!rk)return '';
  var when=dayLabel(rk.day,rk.today);
  var posted=rk.posted!=null?'$'+px(rk.posted,fmt):'';
  if(rk.remark){
    var on=rk.remark.date===rk.today?'today’s futures':(dayLabel(rk.remark.date,rk.today)+' futures close');
    return 'on '+on+' · posted '+(when?when+' ':'')+posted;
  }
  if(rk.old)return 'posted '+(when?when+' ':'earlier ')+posted+' · not updated for today’s futures';
  return '';
}
function priceText(rk,fmt){
  if(!rk||rk.price==null)return '';
  return (rk.remark?'≈$':'$')+px(rk.price,fmt);
}

/* ── A town for a delivery-point label ─────────────────────────────────── */
var DP=/^(ADM|Cargill|POET|Bunge|CHS|AGP|Gavilon|Valero|Ingredion|LDC|Louis\s+Dreyfus|Scoular)\b/i;
function looksLikePoint(t){return DP.test(String(t||'').trim());}
var ZIP_TOWN={};
function tidy(t){
  t=String(t||'').trim();
  return (t===t.toUpperCase()&&/[A-Z]{3}/.test(t))?t.toLowerCase().replace(/(^|[\s\-'])([a-z])/g,function(_,a,c){return a+c.toUpperCase();}):t;
}
function learnTowns(index){
  var by={};
  var ps=index&&index.places;if(!Array.isArray(ps))return;
  ps.forEach(function(p){
    var z=String(p&&p.zip||'').slice(0,5),t=tidy(p&&(p.town||p.city));
    if(!/^\d{5}$/.test(z)||!t||looksLikePoint(t))return;
    (by[z]=by[z]||{})[t.toLowerCase()]=t;
  });
  var out={};
  Object.keys(by).forEach(function(z){var ks=Object.keys(by[z]);if(ks.length===1)out[z]=by[z][ks[0]];});
  ZIP_TOWN=out;
}
/* label: what the page would print; zip: any ZIP the rows carry. */
function placeTown(label,zip){
  if(!looksLikePoint(label))return label;
  var t=ZIP_TOWN[String(zip||'').slice(0,5)];
  return t||label;
}

/* ── An outlier basis (port of scripts/basis_method.py's outlier guard) ──
   Nutrition Service Co., Riceville IA posted soybeans at $14.04, basis +$1.40,
   on 2026-10-15 with every neighbor near $11.93. Almost surely a food-grade or
   non-GMO contract filed as plain soybeans. The Iowa state page already left
   it out; this page made it Best soybeans and sent Worth the Drive to it.
   The rule is the state page's: a basis further from the middle of the OTHER
   elevators (same crop, same futures contract) than 5 robust standard
   deviations (1.4826 x the median absolute deviation, never under 15c) is
   unusual. So nothing within 75c of the middle is ever flagged. With fewer
   than 4 other elevators to compare, the state's median for that contract
   (data/basis-states.json) is the middle and the gate is the full 75c.
   Basis in cents throughout. */
var OUT_K=5,OUT_FLOOR=15,OUT_MIN_OTHERS=4;
function med(a){
  var s=a.slice().sort(function(x,y){return x-y;}),n=s.length;
  if(!n)return null;
  return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;
}
/* valC: this bid's basis; others: one basis per OTHER elevator; stateC: the
   state median for the contract or null. -> null, or {median, dist, n, via}. */
function outlierCheck(valC,others,stateC){
  if(valC==null||!isFinite(valC))return null;
  var m,gate,via,n=0;
  if(others&&others.length>=OUT_MIN_OTHERS){
    m=med(others);n=others.length;
    var mad=med(others.map(function(v){return Math.abs(v-m);}));
    gate=OUT_K*Math.max(1.4826*mad,OUT_FLOOR);via='search';
  }else if(stateC!=null&&isFinite(stateC)){
    m=stateC;gate=OUT_K*OUT_FLOOR;via='state';
  }else return null;
  var d=valC-m;
  return Math.abs(d)>gate?{median:m,dist:d,n:n,via:via}:null;
}
/* items: [{key: elevator, group: crop+contract, c: basis cents, state}] ->
   a result per item (null or outlierCheck's). An elevator counts once per
   group, at the median of its own rows there. */
var STATE_MED={};
function setStateMedians(json){
  var out={},s=json&&json.states;
  if(s&&typeof s==='object')Object.keys(s).forEach(function(st){
    var cr=s[st]&&s[st].crops;if(!cr)return;
    Object.keys(cr).forEach(function(k){
      var r=cr[k];if(!r||!r.contract||typeof r.median!=='number'||!isFinite(r.median))return;
      (out[st]=out[st]||{})[r.contract]=Math.round(r.median*10000)/100;
    });
  });
  return (STATE_MED=out);
}
function stateMedian(st,con){var s=STATE_MED[String(st||'').toUpperCase()];return s&&s[con]!=null?s[con]:null;}
function markOutliers(items){
  var by={};
  items.forEach(function(it){
    if(!it||!it.group||it.c==null||!isFinite(it.c))return;
    var g=by[it.group]=by[it.group]||{};
    (g[it.key]=g[it.key]||[]).push(it.c);
  });
  var perElev={};
  Object.keys(by).forEach(function(g){
    perElev[g]={};
    Object.keys(by[g]).forEach(function(k){perElev[g][k]=med(by[g][k]);});
  });
  return items.map(function(it){
    if(!it||!it.group||it.c==null||!isFinite(it.c))return null;
    var pe=perElev[it.group],others=[];
    Object.keys(pe).forEach(function(k){if(k!==it.key)others.push(pe[k]);});
    var con=String(it.group).split('|')[1]||'';
    return outlierCheck(it.c,others,stateMedian(it.state,con));
  });
}

/* ── The name printed for an elevator and its place ───────────────────────
   Twin of scripts/elevator_names.py (test/cashfix.test.mjs runs the same cases
   through both). "Cash Bid JSI Site - Ag State" is a page title, not a name;
   "Dewar, IA" printed beside its state read "Dewar, IA, IA". Exact fixes are in
   data/elevator-names.json; until it loads, the general rules still apply. */
var NAMES={operators:{},places:{}};
var OP_HEAD=/^\s*(?:cash\s+bid\s+)?(?:jsi\s+site|iframe|current\s+grain\s+bids)\s*-\s*/i;
var OP_TAIL=/\s*-\s*cash\s+bid\s+include\s*$/i;
var ST_TAIL=/(?:\s*[,.]\s*[A-Z]{2})+\s*$/;
function setNames(json){
  NAMES={operators:(json&&json.operators)||{},places:(json&&json.places)||{}};
  return NAMES;
}
function displayName(op){
  var s=String(op||'').trim();
  if(Object.prototype.hasOwnProperty.call(NAMES.operators,s))return NAMES.operators[s];
  return s.replace(OP_HEAD,'').replace(OP_TAIL,'').trim().replace(/,+$/,'').trim();
}
function cleanPlace(p){
  var s=String(p||'').trim();
  if(Object.prototype.hasOwnProperty.call(NAMES.places,s))return NAMES.places[s];
  s=s.replace(/[,\s]+$/,'').trim();
  var out=s.replace(ST_TAIL,'').trim().replace(/,+$/,'').trim();
  return out||s;
}

var api={centralDay:centralDay,dayLabel:dayLabel,pairMonths:pairMonths,pairEnd:pairEnd,
  wheatClass:wheatClass,classLabel:classLabel,contractKey:contractKey,setFutures:setFutures,
  futureFor:futureFor,assess:assess,compare:compare,note:note,priceText:priceText,
  looksLikePoint:looksLikePoint,learnTowns:learnTowns,placeTown:placeTown,
  outlierCheck:outlierCheck,markOutliers:markOutliers,setStateMedians:setStateMedians,
  stateMedian:stateMedian,setNames:setNames,displayName:displayName,cleanPlace:cleanPlace,
  futuresReady:false,stateReady:false,namesReady:false};
root.cbRank=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;

/* The settles the page re-marks against. Fetched once; when it lands after the
   first render, the ranked panels are drawn again (cbRankRedraw is the page's). */
if(typeof fetch==='function'&&typeof document!=='undefined'){
  try{
    /* AG.json (util.js) shares the page's one request for the file; a page
       on an older util.js fetches its own copy. */
    (root.AG&&typeof root.AG.json==='function'?root.AG.json('/data/prices.json')
      :fetch('/data/prices.json',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}))
      .then(function(j){if(!j)return;setFutures(j);api.futuresReady=true;
        if(typeof root.cbRankRedraw==='function')root.cbRankRedraw();})
      .catch(function(){});
  }catch(e){}
  /* Exact display-name fixes (data/elevator-names.json). */
  try{
    fetch('/data/elevator-names.json').then(function(r){return r.ok?r.json():null;})
      .then(function(j){if(!j)return;setNames(j);api.namesReady=true;
        if(typeof root.cbOutlierRedraw==='function')root.cbOutlierRedraw();})
      .catch(function(){});
  }catch(e){}
  /* The state medians the outlier check falls back to with few elevators. */
  try{
    (root.AG&&typeof root.AG.json==='function'?root.AG.json('/data/basis-states.json')
      :fetch('/data/basis-states.json',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}))
      .then(function(j){if(!j)return;setStateMedians(j);api.stateReady=true;
        if(typeof root.cbOutlierRedraw==='function')root.cbOutlierRedraw();})
      .catch(function(){});
  }catch(e){}
}
})(typeof window!=='undefined'?window:globalThis);
