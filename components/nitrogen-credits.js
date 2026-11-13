/* /nitrogen-credits: field history and manure -> lb N to subtract from the corn rate.
   All numbers come from components/a2809.js (UW Extension A2809 chapter 9, edition R-11-2012). */
(function(){
'use strict';
var A=window.AgA2809;if(!A)return;
function $(id){return document.getElementById(id);}
function show(id,on){var e=$(id);if(e)e.hidden=!on;}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
var PREV_NAMES={alfalfa:'Alfalfa',red_clover:'Red clover',birdsfoot:'Birdsfoot trefoil',vetch:'Vetch',gm:'Green manure',soybean:'Soybean',legume_veg:'Pea or bean crop'};

function layout(){
  var p=$('nc-prev').value, forage=p==='alfalfa'||p==='red_clover'||p==='birdsfoot'||p==='vetch';
  var field=p==='soybean'||p==='legume_veg';
  show('nc-next-l',field);
  show('nc-year-l',forage&&p!=='vetch');
  show('nc-stand-l',forage&&p!=='vetch');
  show('nc-regrow-l',forage&&$('nc-year').value==='1'||p==='vetch');
  show('nc-gm-crop-l',p==='gm'); show('nc-gm-grow-l',p==='gm'); show('nc-gm-seed-l',p==='gm');
  var y2=forage&&p!=='vetch'&&$('nc-year').value==='2';
  show('nc-regrow-l',forage&&!y2);
  [['nc-m1-type','nc-m1-unit','nc-u'],['nc-m2-type','nc-m2-unit','nc-u2']].forEach(function(r){
    var m=A.MANURE[$(r[0]).value], u=m?m.unit:'ton';
    $(r[1]).textContent=u==='ton'?'tons':'1,000 gal';
    var els=document.getElementsByClassName(r[2]); for(var i=0;i<els.length;i++)els[i].textContent=u;
  });
}
function legume(){
  var p=$('nc-prev').value, soil=$('nc-soil').value, out=[];
  if(p==='alfalfa'||p==='red_clover'||p==='birdsfoot'||p==='vetch'){
    var year=p==='vetch'?1:+$('nc-year').value;
    var r=A.legumeCredit({crop:p,stand:$('nc-stand').value,regrowth:$('nc-regrow').value,soil:soil,year:year});
    if(!r)return {lo:0,hi:0,lines:[[PREV_NAMES[p]+(year===2?', second year':''),'no figure in A2809 for this case, so none counted']]};
    return {lo:r.n,hi:r.n,lines:[[PREV_NAMES[p]+(year===2?', second year':', first year')+(r.note&&year===1?' ('+r.note+')':''),r.n+' lb']]};
  }
  if(p==='gm'){
    var crop=$('nc-gm-crop').value, g=$('nc-gm-grow').value;
    if(g==='tallest'){
      if(crop!=='vetch')return {lo:0,hi:0,lines:[['Green manure','"Over 12 inches" has a figure for vetch only, so none counted']]};
      var t=A.GREEN_MANURE.vetch.tallest;return {lo:t[0],hi:t[0],range:[t[0],t[1]],counted:'low end',lines:[['Vetch green manure over 12 in','range '+t[0]+' to '+t[1]+' lb; A2809 names no end, so the low end, '+t[0]+' lb, is counted']]};
    }
    var gm=A.greenManureCredit({crop:crop,tall:g==='tall',spring:$('nc-gm-seed').value==='spring'});
    if(g==='short')return {lo:gm.lo,hi:gm.hi,lines:[['Green manure under 6 in',gm.lo+' lb']]};
    var pick=gm.pick;
    return {lo:pick,hi:pick,range:[gm.lo,gm.hi],counted:($('nc-gm-seed').value==='spring'?'top of the range, the end A2809 names for spring seedings plowed down the next spring':'bottom of the range, the end A2809 names for fall seedings'),lines:[['Green manure over 6 in, '+($('nc-gm-seed').value==='spring'?'spring seeding':'fall seeding'),pick+' lb (range '+gm.lo+' to '+gm.hi+')']]};
  }
  if(p==='soybean'||p==='legume_veg'){
    var n=A.fieldLegumeCredit({crop:p,soil:soil,next:$('nc-next').value});
    var nx=$('nc-next').value;
    if(p==='soybean'&&(nx==='corn'||nx==='wheat'))return {lo:0,hi:0,lines:[[PREV_NAMES[p],'none: the corn and wheat rates after soybean already count it']]};
    return {lo:n,hi:n,lines:[[PREV_NAMES[p],n+' lb'+(soil==='sand'?' (none on sands)':'')]]};
  }
  return {lo:0,hi:0,lines:[]};
}
function manure(prefix,yearsAgo){
  var type=$(prefix+'-type').value, rate=+$(prefix+'-rate').value;
  if(!type||!(rate>0))return null;
  var r=A.manureN({type:type,rate:rate,incorp:$('nc-m1-inc').value,yearsAgo:yearsAgo,totalN:+$(prefix+'-test').value});
  if(!r)return null;
  var m=A.MANURE[type];
  return {n:r.n,line:[m.name+', '+rate+' '+(m.unit==='ton'?'tons':'x1,000 gal')+(yearsAgo===0?' this season':yearsAgo===1?' last year':' two years ago'),r.n+' lb ('+r.pct+'% of '+r.total+' lb N per '+m.unit+(+$(prefix+'-test').value>0?', your test':', book')+')']};
}
function run(){
  layout();
  var L=legume(), lines=L.lines.slice(), total=L.hi, m1=manure('nc-m1',0), m2=null;
  var ago=+$('nc-m2-ago').value;
  var type2=$('nc-m2-type').value, rate2=+$('nc-m2-rate').value;
  if(type2&&rate2>0){var r2=A.manureN({type:type2,rate:rate2,yearsAgo:ago,totalN:+$('nc-m2-test').value});
    if(r2){var mm=A.MANURE[type2];m2={n:r2.n,line:[mm.name+', '+rate2+' '+(mm.unit==='ton'?'tons':'x1,000 gal')+(ago===1?' last year':' two years ago'),r2.n+' lb ('+r2.pct+'% of '+r2.total+' lb N per '+mm.unit+(+$('nc-m2-test').value>0?', your test':', book')+')']};}}
  if(m1){lines.push(m1.line);total+=m1.n;}
  if(m2){lines.push(m2.line);total+=m2.n;}
  $('nc-total').innerHTML=total+' <small>lb N per acre</small>';
  var price=+$('nc-price').value, dollars=price>0?' At $'+price.toFixed(2)+' a pound of N that is about $'+Math.round(total*price)+' an acre of fertilizer you do not need to buy.':'';
  var sum=lines.length?'That is the sum of the lines below.'+dollars:'Pick a field history and, if you spread manure, the manure. The answer fills in here.';
  if(L.range&&L.range[0]!==L.range[1])sum+=' The green manure range is '+L.range[0]+' to '+L.range[1]+' lb and the total counts the '+L.counted+'. Across the whole range the total runs '+(total-L.hi+L.range[0])+' to '+(total-L.hi+L.range[1])+'.';
  $('nc-sum').textContent=sum;
  $('nc-res').innerHTML=lines.length?'<ul>'+lines.map(function(l){return '<li><span>'+esc(l[0])+'</span><b>'+esc(l[1])+'</b></li>';}).join('')+'</ul>':'';
}
var form=$('nc-form'); if(!form)return;
form.addEventListener('input',run); form.addEventListener('change',run);
run();
})();
