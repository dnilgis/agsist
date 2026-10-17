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
/* TWIN OF scripts/build_state_basis_pages.py parse_contract(). The town pages
   and the state basis pages read a board's futures month there; this page read
   it here with its own two regexes, and they disagreed. A DTN board writes
   Dec '26 corn as "@C6Z" (178 of 2,038 network shards on 2026-10-16), which
   this function could not read, so a day-old DTN board could not be re-marked
   to today's futures and fell below every board that could: at ZIP 54728
   Rooney Grain (≈$4.12) lost Best corn to River Country Boyd (≈$4.10).
   test/fixtures/contract-cases.json is run through both copies
   (test/cb-rank.test.mjs), so a form one learns the other must learn too.
     ticker   "ZCZ26", "ZCZ6", "KEN27", "MWOZ26"
     DTN      "@C6Z" (Dec 2026 corn), "@KW7N" (Jul 2027 KC wheat)
     month    "Dec 26", "December 2026", "Nov 26 Soybeans",
              "Dec 26 KCBT Red Wheat", "Mar 27 MIAX Spring Wheat"
   A bare month on a wheat row names no contract unless the commodity names
   the class: Dec wheat is three different prices. A contract of another crop
   (a corn row against ZS) is not read. A one-digit year is the decade of the
   row's own year, rolled forward if that lands more than a year back. */
var MCODE='FGHJKMNQUVXZ';
var MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var CROP_ROOT={corn:'ZC',soybeans:'ZS'};
var AT_ROOT={C:'ZC',S:'ZS',W:'ZW',KW:'KE',MW:'MW'};
var WHEAT_ROOTS={ZW:1,KE:1,MW:1,MWO:1};
/* port of wheat_root(): the futures root a wheat row's commodity name points to */
function wheatRoot(commodity){
  var t=String(commodity||'').toLowerCase();
  if(/\b(srw|soft red)\b/.test(t))return 'ZW';
  if(/\b(hrs|dns|spring|dark northern)\b/.test(t))return 'MW';
  if(/\b(hrww?|kc|kcbt|hard red winter)\b/.test(t))return 'KE';
  return '';                                 /* "Winter Wheat" alone could be either */
}
function rootFits(root,crop){
  if(CROP_ROOT[crop])return root===CROP_ROOT[crop];
  if(crop==='wheat')return !!WHEAT_ROOTS[root];
  return false;
}
function decadeYear(d,ref){
  var y=Math.floor(ref/10)*10+d;
  return y<ref-1?y+10:y;
}
/* fm: the futures month as the board wrote it; crop: corn|soybeans|wheat;
   ref: the row's year. -> "ZCZ26", or '' when it names no contract we read. */
function parseContract(fm,crop,ref,commodity){
  if(typeof fm!=='string'||!fm)return '';
  var s=fm.trim(),m,root,y;
  if(!CROP_ROOT[crop]&&crop!=='wheat')return '';
  if((m=/^(ZC|ZS|KE|ZW|MWO|MW)([FGHJKMNQUVXZ])(\d{1,2})$/.exec(s))){
    root=m[1];
    y=m[3].length===1?decadeYear(+m[3],ref):2000+(+m[3]);
    return rootFits(root,crop)?root+m[2]+String(y%100).padStart(2,'0'):'';
  }
  if((m=/^@(KW|MW|C|S|W)(\d)([FGHJKMNQUVXZ])$/.exec(s))){
    root=AT_ROOT[m[1]];y=decadeYear(+m[2],ref);
    return rootFits(root,crop)?root+m[3]+String(y%100).padStart(2,'0'):'';
  }
  if(!(m=/^([A-Za-z]{3})[a-z]*\.?\s+(\d{2}|\d{4})\b([\s\S]*)$/.exec(s)))return '';
  var mon=m[1].charAt(0).toUpperCase()+m[1].slice(1).toLowerCase(),mi=MONTHS.indexOf(mon);
  if(mi<0)return '';
  y=+m[2];if(y<100)y+=2000;
  var rest=m[3].toLowerCase();
  if(rest.indexOf('kcbt')>=0||rest.indexOf('kansas')>=0)root='KE';
  else if(rest.indexOf('spring')>=0||rest.indexOf('miax')>=0||rest.indexOf('mgex')>=0)root='MW';
  else if(rest.indexOf('wheat')>=0||(crop==='wheat'&&!rest.trim())){
    root=commodity?wheatRoot(commodity):'';
    if(!root)return '';
  }
  else if(rest.indexOf('oat')>=0)return '';
  else if(rest.indexOf('soy')>=0)root='ZS';
  else if(crop==='corn')root='ZC';
  else if(crop==='soybeans')root='ZS';
  else return '';
  return rootFits(root,crop)?root+MCODE.charAt(mi)+String(y%100).padStart(2,'0'):'';
}
/* A row's contract: its symbol as written, else its basis month. The year a
   one-digit code belongs to is taken from the row's own time (Central). */
function contractKey(b){
  if(!b)return '';
  var cat=b.category;
  if(!CROP_ROOT[cat]&&cat!=='wheat')return '';
  var day=centralDay(b.asOf),ref=day?+day.slice(0,4):+(centralDay(Date.now())||'').slice(0,4)||new Date().getFullYear();
  return parseContract(String(b.symbol||''),cat,ref,b.commodity)||
         parseContract(String(b.basisMonth||''),cat,ref,b.commodity);
}
/* ── The delivery a board posted, as the page prints it ────────────────────
   Twin of scripts/build_cash_bid_pages.py delivery_text(); the ZIP search and
   the town pages print one board the same way (test/fixtures/delivery-labels.json
   runs through both). River Country Co-op posts "HAR 26" and "HAR 27": the town
   page printed both raw, this page said "Fall 2026" for one and "HAR 27" for
   the other. Now both say "Harvest 2026" and "Harvest 2027".
     "(YYYY-MM)" the gradable adapter appends is the futures contract: dropped.
     "Oct 26", "OCTOBER 2026", "10/01/2026", "Oct 01, 2026": "Oct 2026".
     With the network's month (period "2026-10"): "October", "Dec corn" and a
       whole-month range take its year; part of a month is "Oct 1-16, 2026".
       A deadline ("By Oct 9") stays as written.
     A season code in the board's own word: HAR -> Harvest, NC -> New crop,
       Fall, OC -> Old crop; with no year on the label, the season's year.
     Anything else as the board wrote it. */
var SEASON_RE=/^(?:(harv(?:est)?(?:\s+del(?:ivery)?)?|har)|(n\/?c|new\s*crop|n\s+crop|new)|(fall)|(o\/?c|old\s*crop))\s*'?\s*(\d{4}|\d{2})?'?(?![\w\/])([\s\S]*)$/i;
var SEASON_FIRST_RE=/^(\d{4}|\d{2})\s+(new\s*crop|fall|harvest|crop)\b([\s\S]*)$/i;
var SEASON_WORD=['Harvest','New crop','Fall','Old crop'];
var LAST_DAY=[31,29,31,30,31,30,31,31,30,31,30,31];
var MON_START=/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?![a-z])/i;
function yy(t){return t.length===2?2000+(+t):+t;}
function titleMon(t){t=String(t||'');return t.charAt(0).toUpperCase()+t.slice(1,3).toLowerCase();}
function deliveryText(delivery,period){
  var lab=String(delivery||'').trim().replace(/\s*\(\d{4}-\d{2}\)\s*$/,'').replace(/\s+/g,' ').trim();
  var per=String(period||''),m,i;
  if((m=/^([A-Za-z]{3})[A-Za-z]*\.?\s*'?(\d{2}|\d{4})$/.exec(lab))&&MONTHS.indexOf(titleMon(m[1]))>=0)
    return titleMon(m[1])+' '+yy(m[2]);
  if((m=/^(\d{1,2})\/0?1\/(\d{4})$/.exec(lab))&&+m[1]>=1&&+m[1]<=12)
    return MONTHS[+m[1]-1]+' '+m[2];
  if((m=/^([A-Za-z]{3})[A-Za-z]*\.?\s+0?1,?\s+(\d{4})$/.exec(lab))&&MONTHS.indexOf(titleMon(m[1]))>=0)
    return titleMon(m[1])+' '+m[2];
  var pm=/^(\d{4})-(\d{2})$/.exec(per);
  if(pm&&+pm[2]>=1&&+pm[2]<=12){
    var y=+pm[1],mo=+pm[2],MN=MONTHS[mo-1];
    var r=/^(\d{1,2}) ([A-Za-z]{3}) (\d{4}) to (\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(lab);
    if(r&&titleMon(r[2])===MN&&titleMon(r[5])===MN&&+r[3]===y&&+r[6]===y){
      var d1=+r[1],d2=+r[4],last=mo===2?(y%4===0?29:28):LAST_DAY[mo-1];
      if(!(d1===1&&d2===last)&&d1>=1&&d1<=d2&&d2<=last)return MN+' '+d1+'-'+d2+', '+y;
      return MN+' '+y;
    }
    if(!lab)return MN+' '+y;
    var b=/^([A-Za-z]{3})[A-Za-z]*\.?\s*(?:'?(\d{4}|\d{2})'?)?(?![\w\/'])\s*([\s\S]*)$/.exec(lab);
    if(b&&titleMon(b[1])===MN&&(!b[2]||yy(b[2])===y)&&
       /^(?:[A-Za-z]+(?: [A-Za-z]+)*)?$/.test(b[3])&&!MON_START.test(b[3]))
      return MN+' '+y+(b[3]?' '+b[3]:'');
  }
  var sy=/^(?:new|old)crop-(\d{4})$/.exec(per);
  if((m=SEASON_RE.exec(lab))){
    for(i=0;i<4&&!m[i+1];i++);
    var rest=m[6].trim(),year=m[5]?yy(m[5]):null;
    if(year==null&&sy&&!/\d/.test(rest))year=+sy[1];
    var out=SEASON_WORD[i]+(year?' '+year:'');
    if(rest)out+=/^[-,:]/.test(rest)?', '+rest.replace(/^[-,: ]+/,'').trim():' '+rest;
    return out.trim();
  }
  if((m=SEASON_FIRST_RE.exec(lab))){
    var w=m[2].toLowerCase(),rs=m[3].trim();
    var word=w.indexOf('new')===0?'New crop':w==='harvest'?'Harvest':w==='fall'?'Fall':'Crop';
    return word+' '+yy(m[1])+(rs?' '+rs:'');
  }
  if(!lab){
    if(per==='spot')return 'Spot';
    var pr=/^(\d{4})-(\d{2})\/(\d{4})-(\d{2})$/.exec(per);
    if(pr&&+pr[2]>=1&&+pr[2]<=12&&+pr[4]>=1&&+pr[4]<=12){
      var a_=MONTHS[+pr[2]-1],b_=MONTHS[+pr[4]-1];
      return pr[1]===pr[3]?a_+'-'+b_+' '+pr[3]:a_+' '+pr[1]+'-'+b_+' '+pr[3];
    }
    if(sy)return (per.indexOf('new')===0?'New crop':'Old crop')+' '+sy[1];
  }
  return lab;
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

/* Trading days after `day` through `today` (both YYYY-MM-DD, Central):
   weekdays, less exchange holidays when components/price-local.js is on the
   page (AgPxStamp.isTradingDay, the twin of scripts/contract_calendar.py).
   Mon to Thu is 3; Fri to Wed is 3. */
var REMARK_SESSIONS=3;
function sessionsSince(day,today){
  var a=Date.parse(day+'T00:00:00Z'),b=Date.parse(today+'T00:00:00Z');
  if(!isFinite(a)||!isFinite(b)||b<=a)return 0;
  if(b-a>400*864e5)return 999;
  var n=0,P=root.AgPxStamp&&root.AgPxStamp.isTradingDay;
  for(var t=a+864e5;t<=b;t+=864e5){
    var iso=new Date(t).toISOString().slice(0,10),w=new Date(t).getUTCDay();
    if(P?P(iso):(w>=1&&w<=5))n++;
  }
  return n;
}

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
  /* AN OLD BOARD IS NOT RE-PRICED (2026-10-17, chaos-2). Harvest basis can
     move 20 to 40 cents in a month, so a basis posted more than
     REMARK_SESSIONS trading days ago is not carried onto today's futures:
     it is not ranked at all (never Best, never Worth the Drive), the same as
     a board we could not read. Its card still shows it with its age. */
  r.sessions=r.day&&r.today?sessionsSince(r.day,r.today):null;
  if(r.sessions!=null&&r.sessions>REMARK_SESSIONS){r.exclude=true;r.tooOld=true;r.tier=1;r.old=true;return r;}
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
var ST_TAIL=new RegExp('(?:\\s*[,.]\\s*(?:'+('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND '+
  'OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY').split(' ').join('|')+'))+\\s*$','i');
var OP_ARCHIVED=/^z(?=[A-Z])|\s*\.?\b(?:OLD|Old)$/g;
function setNames(json){
  NAMES={operators:(json&&json.operators)||{},places:(json&&json.places)||{}};
  return NAMES;
}
function displayName(op){
  var s=String(op||'').trim();
  if(Object.prototype.hasOwnProperty.call(NAMES.operators,s))return NAMES.operators[s];
  s=s.replace(OP_HEAD,'').replace(OP_TAIL,'').trim().replace(/,+$/,'').trim();
  return s.replace(OP_ARCHIVED,'').trim();
}
function cleanPlace(p){
  var s=String(p||'').trim();
  if(Object.prototype.hasOwnProperty.call(NAMES.places,s))return NAMES.places[s];
  s=s.replace(/^[{\s]+|[}\s]+$/g,'').replace(/[,\s]+$/,'').trim();
  var out=s.replace(ST_TAIL,'').trim().replace(/,+$/,'').trim();
  return out||s;
}

var api={centralDay:centralDay,dayLabel:dayLabel,pairMonths:pairMonths,pairEnd:pairEnd,
  wheatClass:wheatClass,classLabel:classLabel,contractKey:contractKey,parseContract:parseContract,deliveryText:deliveryText,setFutures:setFutures,
  futureFor:futureFor,sessionsSince:sessionsSince,REMARK_SESSIONS:REMARK_SESSIONS,assess:assess,compare:compare,note:note,priceText:priceText,
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
