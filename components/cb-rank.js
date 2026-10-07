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

var api={centralDay:centralDay,dayLabel:dayLabel,pairMonths:pairMonths,pairEnd:pairEnd,
  wheatClass:wheatClass,classLabel:classLabel,contractKey:contractKey,setFutures:setFutures,
  futureFor:futureFor,assess:assess,compare:compare,note:note,priceText:priceText,
  looksLikePoint:looksLikePoint,learnTowns:learnTowns,placeTown:placeTown,
  futuresReady:false};
root.cbRank=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;

/* The settles the page re-marks against. Fetched once; when it lands after the
   first render, the ranked panels are drawn again (cbRankRedraw is the page's). */
if(typeof fetch==='function'&&typeof document!=='undefined'){
  try{
    fetch('/data/prices.json',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;})
      .then(function(j){if(!j)return;setFutures(j);api.futuresReady=true;
        if(typeof root.cbRankRedraw==='function')root.cbRankRedraw();})
      .catch(function(){});
  }catch(e){}
}
})(typeof window!=='undefined'?window:globalThis);
