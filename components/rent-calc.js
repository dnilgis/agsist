/* components/rent-calc.js: the rent-share calculator, the squeeze chart and the
   rent history for ONE county, built on demand.

   It used to be the standalone /cash-rent page. Since 2026-10 it is one shared
   module that a Farmland Atlas county page loads only when the reader taps
   "Rent share calculator", so 2,041 county pages do not each carry it (the
   Atlas folder has a size budget: scripts/check_site_budget.py).

   Data: /data/cash-rent/<ST>.json (scripts/fetch_cash_rent.py). The pairing of
   rent and yield lives ONCE, in fetch_cash_rent.py pair_county(), and ships per
   county as c.pair: dryland rent over the dryland county yield, irrigated rent
   over the irrigated yield, the all-practice yield only where NASS shows no
   irrigation in the county. Anything else is withheld with its reason.

   The yield the calculator starts from is the same figure the Atlas county page
   and the /rent table print: the county's 15-yr trend (projected to the current
   year), fitted on the same practice as the rent (scripts/county_yield.py).

   Mount: AgRentCalc.mount(el, {st:'IA', fips:'19169'})
*/
(function(){
  'use strict';
  if(window.AgRentCalc) return;
  var BASIS={nonirr:'dryland yield',irr:'irrigated yield',all:'all-practice yield; the county reports no irrigated corn'};
  var RENT={nonirr:'non-irrigated rent',irr:'irrigated rent'};
  var KIND={nonirr:'Non-irrigated',irr:'Irrigated',pasture:'Pasture'};
  var CSS='.rc{margin:.6rem 0 1rem}.rc .rc-in{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.6rem;margin:.6rem 0}'
    +'@media(max-width:560px){.rc .rc-in{grid-template-columns:1fr}}'
    +'.rc label{display:block;font-size:.74rem;color:var(--text-dim);margin:0 0 .25rem}'
    +'.rc input{width:100%;box-sizing:border-box;background:var(--surface,#12161a);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:var(--font-mono);font-size:16px;padding:.5rem .6rem;min-height:40px}'
    +'.rc input:focus{outline:2px solid var(--gold);outline-offset:1px}'
    +'.rc .rc-h{font-size:.72rem;color:var(--text-muted);margin-top:.2rem;line-height:1.35}'
    +'.rc .rc-v{font-family:var(--font-mono);font-size:2rem;font-weight:700;line-height:1.1;margin:.4rem 0 .2rem}'
    +'.rc .rc-x{font-size:.86rem;line-height:1.6;color:var(--text-dim);margin:.2rem 0}'
    +'.rc .rc-m{font-family:var(--font-mono);font-size:.78rem;color:var(--text-muted);overflow-x:auto;white-space:nowrap;padding:.3rem 0}'
    +'.rc svg{width:100%;height:auto;display:block;margin:.4rem 0}'
    +'.rc svg text{fill:var(--text-muted);font-family:var(--font-mono);font-size:17px}'
    +'.rc svg .g{stroke:var(--border);stroke-width:1}.rc svg .gap{stroke:var(--text-muted);stroke-dasharray:2 4;opacity:.6}'
    +'.rc svg .c0{stroke:var(--gold);fill:var(--gold)}.rc svg .c1{stroke:var(--green);fill:var(--green)}.rc svg .c2{stroke:var(--text-muted);fill:var(--text-muted)}'
    +'.rc svg path[class]{fill:none;stroke-width:2.2;stroke-linejoin:round}.rc svg .ref{stroke-dasharray:3 5;opacity:.5;stroke-width:1}'
    +'.rc .rc-k{display:flex;gap:1rem;flex-wrap:wrap;font-size:.76rem;color:var(--text-muted)}.rc .rc-k i{display:inline-block;width:12px;height:3px;vertical-align:middle;margin-right:.3rem}'
    +'.rc .rc-pos{color:var(--green)}.rc .rc-neg{color:var(--red)}.rc .rc-warn{color:var(--gold)}'
    +':root[data-theme="light"] .rc .rc-warn{color:#6f5209}:root[data-theme="light"] .rc .rc-neg{color:#b3261e}';

  function esc(t){ return String(t).replace(/[&<>"]/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch];}); }
  function money(v){ return '$'+Math.round(v).toLocaleString('en-US'); }
  function latestYear(s){ var ys=Object.keys(s||{}).map(Number); return ys.length?Math.max.apply(null,ys):null; }
  function getJSON(u){ return fetch(u).then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; }); }
  function boardPrice(p){
    try{ var q=p&&p.quotes; if(!q) return null; var c=q['corn-nearby']||q['corn-dec']||q.corn;
      if(c&&c.close!=null) return c.close/100; }catch(e){}
    return null;
  }
  function addCss(){
    if(document.getElementById('rc-css')) return;
    var s=document.createElement('style'); s.id='rc-css'; s.textContent=CSS; document.head.appendChild(s);
  }

  // rent(year) / ( paired yield(year) x state price received(year) ). Every term
  // is a number USDA published for that year; a year missing any term has no point.
  function ratioSeries(d,c,crop){
    var p=c.pair&&c.pair[crop], ph=(d.prices&&d.prices[crop])||null, res={s:{},b:{},w:{},rent:c.pair?c.pair.rent:null};
    if(!p||!ph||!res.rent) return res;
    var rent=c.rent[res.rent]||{};
    Object.keys(rent).forEach(function(y){
      var P=ph[y], R=rent[y];
      if(p.w&&p.w[y]&&P!=null){ res.w[y]=p.w[y]; return; }
      var yy=p.y&&p.y[y]; if(!yy) return;
      if(!(yy[0]>0)||!(P>0)||R==null) return;
      res.s[y]=R/(yy[0]*P)*100; res.b[y]=yy[1];
    });
    return res;
  }

  function axes(o,W,H,P,y0,y1,v1,fmt){
    var X=function(y){ return P.l+(y-y0)/Math.max(1,y1-y0)*(W-P.l-P.r); };
    var Y=function(v){ return H-P.b-v/v1*(H-P.t-P.b); };
    for(var g=0;g<=4;g++){ var gv=v1*g/4, gy=Y(gv).toFixed(1);
      o.push('<line class="g" x1="'+P.l+'" y1="'+gy+'" x2="'+(W-P.r)+'" y2="'+gy+'"/>');
      o.push('<text x="'+(P.l-6)+'" y="'+(+gy+4)+'" text-anchor="end">'+fmt(gv)+'</text>'); }
    for(var yy=y0;yy<=y1;yy++){ if((yy-y0)%3!==0&&yy!==y1) continue;
      o.push('<text x="'+X(yy).toFixed(1)+'" y="'+(H-8)+'" text-anchor="'+(yy===y1&&yy!==y0?'end':'middle')+'">\''+String(yy).slice(2)+'</text>'); }
    return {X:X,Y:Y};
  }
  function lines(o,s,cls,X,Y){
    var ys=Object.keys(s).map(Number).sort(function(a,b){return a-b;}), seg=[], segs=[];
    for(var i=0;i<ys.length;i++){ if(i&&ys[i]-ys[i-1]>1){ segs.push(seg); seg=[]; } seg.push(ys[i]); }
    if(seg.length) segs.push(seg);
    segs.forEach(function(sg){ if(sg.length<2) return;
      o.push('<path class="'+cls+'" d="'+sg.map(function(y,i){ return (i?'L':'M')+X(y).toFixed(1)+' '+Y(s[y]).toFixed(1); }).join(' ')+'"/>'); });
    ys.forEach(function(y){ o.push('<circle class="'+cls+'" cx="'+X(y).toFixed(1)+'" cy="'+Y(s[y]).toFixed(1)+'" r="2.4"><title>'+y+'</title></circle>'); });
  }

  function squeeze(d,c){
    var M={corn:ratioSeries(d,c,'corn'),beans:ratioSeries(d,c,'beans')}, all=[], years=[];
    ['corn','beans'].forEach(function(k){ var s=M[k].s; if(Object.keys(s).length>1) Object.keys(s).forEach(function(y){ years.push(+y); all.push(s[y]); }); });
    var notes=[];
    [['corn','Corn'],['beans','Soybeans']].forEach(function(k){
      var m=M[k[0]]; if(!m.rent) return;
      var wy=Object.keys(m.w).sort(); var why={};
      wy.forEach(function(y){ (why[m.w[y]]=why[m.w[y]]||[]).push(y); });
      var b={}; Object.keys(m.s).forEach(function(y){ b[m.b[y]]=1; });
      var t=Object.keys(b).map(function(x){ return RENT[m.rent]+' over the county '+BASIS[x]; }).join('; ');
      var w=Object.keys(why).map(function(r){ return 'withheld '+why[r].join(', ')+': '+r; }).join(' ');
      if(t||w) notes.push('<b>'+k[1]+':</b> '+esc(t||'no year with a matching yield')+(w?' <span class="rc-warn">'+esc(w)+'</span>':''));
    });
    if(!all.length) return '<p class="rc-x">'+(notes.length?notes.join('<br>'):'Not enough published history: the share needs rent, a county yield of the same practice and the state price received in the same year.')+'</p>';
    var W=640,H=280,P={t:14,r:12,b:36,l:58}, y0=Math.min.apply(null,years), y1=Math.max.apply(null,years);
    var v1=Math.min(100,Math.max.apply(null,all)*1.18), o=[];
    var A=axes(o,W,H,P,y0,y1,v1,function(v){ return Math.round(v)+'%'; });
    [30,35].forEach(function(r){ if(r<v1) o.push('<line class="c0 ref" x1="'+P.l+'" y1="'+A.Y(r).toFixed(1)+'" x2="'+(W-P.r)+'" y2="'+A.Y(r).toFixed(1)+'"/>'); });
    (d.no_survey_years||[]).forEach(function(g){ if(g>y0&&g<y1) o.push('<line class="gap" x1="'+A.X(g).toFixed(1)+'" y1="'+P.t+'" x2="'+A.X(g).toFixed(1)+'" y2="'+(H-P.b)+'"/>'); });
    if(Object.keys(M.corn.s).length>1) lines(o,M.corn.s,'c0',A.X,A.Y);
    if(Object.keys(M.beans.s).length>1) lines(o,M.beans.s,'c1',A.X,A.Y);
    return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Rent as a share of gross revenue, by year">'+o.join('')+'</svg>'
      +'<div class="rc-k">'+(Object.keys(M.corn.s).length>1?'<span><i style="background:var(--gold)"></i>corn</span>':'')+(Object.keys(M.beans.s).length>1?'<span><i style="background:var(--green)"></i>soybeans</span>':'')+'<span>dashed lines: 30% and 35%, for reference only</span>'+((d.no_survey_years||[]).length?'<span>dotted: no NASS survey that year</span>':'')+'</div>'
      +'<p class="rc-x">Each point is that year&rsquo;s published rent divided by that year&rsquo;s actual county yield for the same practice times that year&rsquo;s state price received. Nothing here is a forecast. Price received is what farmers actually got, so basis is already in it.</p>'
      +(notes.length?'<p class="rc-x">'+notes.join('<br>')+'</p>':'');
  }

  function history(d,c){
    var ks=['nonirr','irr','pasture'], years=[], vals=[];
    ks.forEach(function(k){ var s=c.rent[k]; if(s) Object.keys(s).forEach(function(y){ years.push(+y); vals.push(s[y]); }); });
    if(!years.length) return '<p class="rc-x">NASS published no rent for this county.</p>';
    var W=640,H=260,P={t:14,r:12,b:36,l:66}, y0=Math.min.apply(null,years), y1=Math.max.apply(null,years), o=[];
    var A=axes(o,W,H,P,y0,y1,Math.max.apply(null,vals)*1.12,function(v){ return '$'+Math.round(v); });
    (d.no_survey_years||[]).forEach(function(g){ if(g>y0&&g<y1) o.push('<line class="gap" x1="'+A.X(g).toFixed(1)+'" y1="'+P.t+'" x2="'+A.X(g).toFixed(1)+'" y2="'+(H-P.b)+'"/>'); });
    var key=[];
    ks.forEach(function(k,i){ var s=c.rent[k]; if(!s) return; lines(o,s,'c'+i,A.X,A.Y);
      key.push('<span><i style="background:'+['var(--gold)','var(--green)','var(--text-muted)'][i]+'"></i>'+KIND[k]+'</span>'); });
    return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="County cash rent by survey year">'+o.join('')+'</svg><div class="rc-k">'+key.join('')+'</div>';
  }

  function render(el,d,c,prices){
    var rk=c.pair&&c.pair.rent, rent=rk?c.rent[rk][latestYear(c.rent[rk])]:null, ry=rk?latestYear(c.rent[rk]):null;
    var t=(c.pair&&c.pair.corn&&c.pair.corn.t)||{}, ty=t.ty||parseInt(String(d.generated||'').slice(0,4),10);
    var seeded=(t.v!=null)?t.v:null;
    var yh=seeded!=null?('15-yr trend (projected '+ty+'), '+BASIS[t.b]+', '+t.n+' years, R² '+(+t.r2).toFixed(2))
      :(t.w?'County trend withheld: '+t.w+'. Type your own yield.':'No county trend. Type your own yield.');
    var bp=boardPrice(prices);
    el.innerHTML='<div class="rc">'
      +'<h3>Rent as a share of corn gross</h3>'
      +(rent==null?'<p class="rc-x">NASS published no cropland rent for this county, so there is nothing to divide.</p>':
        '<div class="rc-in">'
        +'<div><label for="rc-y">Yield, bu/ac</label><input id="rc-y" type="number" inputmode="decimal" step="0.1" value="'+(seeded!=null?seeded:'')+'"><div class="rc-h">'+esc(yh)+'</div></div>'
        +'<div><label for="rc-p">Corn price, $/bu</label><input id="rc-p" type="number" inputmode="decimal" step="0.01" value="'+(bp?bp.toFixed(2):'')+'"><div class="rc-h">'+(bp?'Nearby corn futures, latest close':'Type your new-crop bid')+'</div></div>'
        +'<div><label for="rc-b">Your basis, $/bu</label><input id="rc-b" type="number" inputmode="decimal" step="0.01" value="0"><div class="rc-h">Under the board is negative</div></div>'
        +'</div><div class="rc-v" id="rc-v"></div><div class="rc-m" id="rc-m"></div><p class="rc-x" id="rc-x"></p>')
      +'<h3>The squeeze: rent as a share of gross, every year</h3>'+squeeze(d,c)
      +'<h3>Rent history</h3>'+history(d,c)
      +'<p class="rc-x">USDA NASS Cash Rents Survey (county), NASS county yields and state marketing-year price received. Data pulled '+esc(d.generated||'')+'. A county mean from a voluntary survey: a reference point for the conversation, not a rate card.</p>'
      +'</div>';
    if(rent==null) return;
    var $=function(id){ return el.querySelector('#'+id); };
    function calc(){
      var y=parseFloat($('rc-y').value), p=parseFloat($('rc-p').value), b=parseFloat($('rc-b').value)||0, net=p+b;
      if(!(y>0)||!(p>0)||!(net>0)){ $('rc-v').textContent=''; $('rc-m').textContent=''; $('rc-x').textContent=!(net>0)&&p>0?'Price plus basis is at or below zero. Check the basis.':'Type a yield and a price to run the math.'; return; }
      var gross=y*net, pct=rent/gross*100, ylab=(seeded!=null&&Math.abs(y-seeded)<0.05)?'15-yr trend, projected '+ty:'your yield';
      $('rc-v').textContent=pct.toFixed(1)+'%'; $('rc-v').className='rc-v '+(pct>=35?'rc-neg':pct>=30?'rc-warn':'rc-pos');
      $('rc-m').innerHTML=esc(RENT[rk])+' '+ry+' <b>'+money(rent)+'</b> &divide; ( <b>'+y.toFixed(1)+'</b> bu &times; <b>$'+net.toFixed(2)+'</b> ) = <b>'+money(gross)+'</b> gross &rarr; <b>'+pct.toFixed(1)+'%</b>';
      $('rc-x').innerHTML='At '+y.toFixed(0)+' bu ('+esc(ylab)+') the rent is <b>$'+(rent/y).toFixed(2)+' a bushel</b>. At $'+net.toFixed(2)+' the acre grosses '+money(gross)+'; rent takes '+money(rent)+', leaving '+money(gross-rent)+' for everything else and you. Compare the share with this county&rsquo;s own history below, not with a rule of thumb.';
    }
    ['rc-y','rc-p','rc-b'].forEach(function(id){ $(id).addEventListener('input',calc); });
    calc();
  }

  window.AgRentCalc={mount:function(el,o){
    addCss();
    el.innerHTML='<p class="rc-x">Opening the county rent file&hellip;</p>';
    return Promise.all([getJSON('/data/cash-rent/'+encodeURIComponent(o.st)+'.json'),getJSON('/data/prices.json')]).then(function(r){
      var d=r[0], c=null;
      if(d&&d.counties) for(var i=0;i<d.counties.length;i++){ if(d.counties[i].fips===o.fips){ c=d.counties[i]; break; } }
      if(!d){ el.innerHTML='<p class="rc-x">The county rent file did not load. Try again in a minute.</p>'; return; }
      if(!c){ el.innerHTML='<p class="rc-x">NASS published no cash rent for this county, so there is no calculator to run.</p>'; return; }
      if(!d.pair_rule||!c.pair){ el.innerHTML='<p class="rc-x">This rent file predates the dryland and irrigated yield split, so the share is withheld until the next refresh.</p>'; return; }
      render(el,d,c,r[1]);
      try{ gaEvent('rent_calc_open',{st:o.st,fips:o.fips}); }catch(e){}
    });
  }};
})();
