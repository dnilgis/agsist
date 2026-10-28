/* components/atlas-foreign.js: "Foreign-held farmland, 2010 to 2024" on /farmland-atlas, the
   national picture that was its own page, /foreign-land, until Oct 23, 2026 (as /land-tenure became
   the tenure fold). The county map is the Atlas map's Foreign-held acres layer; this fold adds the
   state picker, the county's own record for the county picked on the map, the national trend and the
   two tables. Loaded only when a reader opens the fold. Reads /data/afida/county.json and national.json.
   Mount: AgForeign.load() once the fold's markup is on the page. */
(function(){
  var TILE={"AK":[1,1],"ME":[12,1],"VT":[11,2],"NH":[12,2],"WA":[2,3],"MT":[3,3],"ND":[4,3],"SD":[5,3],"MN":[6,3],"WI":[7,3],"MI":[8,3],"NY":[10,3],"MA":[11,3],"RI":[12,3],"OR":[2,4],"ID":[3,4],"WY":[4,4],"NE":[5,4],"IA":[6,4],"IL":[7,4],"IN":[8,4],"OH":[9,4],"PA":[10,4],"NJ":[11,4],"CT":[12,4],"CA":[2,5],"NV":[3,5],"UT":[4,5],"CO":[5,5],"KS":[6,5],"MO":[7,5],"KY":[8,5],"WV":[9,5],"VA":[10,5],"MD":[11,5],"DE":[12,5],"AZ":[3,6],"NM":[4,6],"OK":[5,6],"AR":[6,6],"TN":[7,6],"NC":[8,6],"SC":[9,6],"TX":[5,7],"LA":[6,7],"MS":[7,7],"AL":[8,7],"GA":[9,7],"HI":[1,8],"FL":[10,8]}, F2A={"alaska":"AK","alabama":"AL","arkansas":"AR","arizona":"AZ","california":"CA","colorado":"CO","connecticut":"CT","delaware":"DE","florida":"FL","georgia":"GA","hawaii":"HI","iowa":"IA","idaho":"ID","illinois":"IL","indiana":"IN","kansas":"KS","kentucky":"KY","louisiana":"LA","massachusetts":"MA","maryland":"MD","maine":"ME","michigan":"MI","minnesota":"MN","missouri":"MO","mississippi":"MS","montana":"MT","north carolina":"NC","north dakota":"ND","nebraska":"NE","new hampshire":"NH","new jersey":"NJ","new mexico":"NM","nevada":"NV","new york":"NY","ohio":"OH","oklahoma":"OK","oregon":"OR","pennsylvania":"PA","rhode island":"RI","south carolina":"SC","south dakota":"SD","tennessee":"TN","texas":"TX","utah":"UT","virginia":"VA","vermont":"VT","washington":"WA","wisconsin":"WI","west virginia":"WV","wyoming":"WY"};
  window.__A2F={"AK":"Alaska","AL":"Alabama","AR":"Arkansas","AZ":"Arizona","CA":"California","CO":"Colorado","CT":"Connecticut","DE":"Delaware","FL":"Florida","GA":"Georgia","HI":"Hawaii","IA":"Iowa","ID":"Idaho","IL":"Illinois","IN":"Indiana","KS":"Kansas","KY":"Kentucky","LA":"Louisiana","MA":"Massachusetts","MD":"Maryland","ME":"Maine","MI":"Michigan","MN":"Minnesota","MO":"Missouri","MS":"Mississippi","MT":"Montana","NC":"North Carolina","ND":"North Dakota","NE":"Nebraska","NH":"New Hampshire","NJ":"New Jersey","NM":"New Mexico","NV":"Nevada","NY":"New York","OH":"Ohio","OK":"Oklahoma","OR":"Oregon","PA":"Pennsylvania","RI":"Rhode Island","SC":"South Carolina","SD":"South Dakota","TN":"Tennessee","TX":"Texas","UT":"Utah","VA":"Virginia","VT":"Vermont","WA":"Washington","WI":"Wisconsin","WV":"West Virginia","WY":"Wyoming"};
  var picked=null, geoNote='', VD=null;
  var el=function(id){return document.getElementById(id);};
  function geoPick(av){ try{ var l=JSON.parse(localStorage.getItem('agsist-wx-loc')||'{}');
    var ab=F2A[String(l.state||'').toLowerCase()]||(String(l.state||'').length===2?String(l.state).toUpperCase():null);
    if(ab&&av[ab]){ geoNote='auto-set from your location'; return ab; } }catch(e){}
    return av.IA?'IA':Object.keys(av)[0]; }
  
  function render(){
    if(!VD)return;
    if(!picked||!VD[picked]) picked=geoPick(VD);
    var sl=el('vp-sel');
    sl.innerHTML=Object.keys(VD).sort().map(function(a){return '<option value="'+a+'"'+(a===picked?' selected':'')+'>'+(__A2F[a]||a)+'</option>';}).join('');
    el('vp-geo').textContent=geoNote;
    var d=VD[picked];
    el('vp-big').textContent=d.big; el('vp-big').style.color=d.col;
    el('vp-word').textContent=d.word; el('vp-word').style.color=d.col;
    el('vp-sent').innerHTML=d.sent;
    var g=el('vp-grid');
    if(g){ var h='';
      Object.keys(TILE).forEach(function(ab){ var t=TILE[ab], s=VD[ab];
        if(s){ h+='<div class="vp-tile'+(ab===picked?' sel':'')+'" data-st="'+ab+'" role="button" tabindex="0" aria-pressed="'+(ab===picked)+'" aria-label="'+(__A2F[ab]||ab)+', '+s.tval+' acres" style="--gc:'+t[0]+';--gr:'+t[1]+';background:'+s.tile+'"><div class="vp-tst">'+ab+'</div><div class="vp-tge">'+s.tval+'</div></div>'; }
        else { h+='<div class="vp-tile dim" style="--gc:'+t[0]+';--gr:'+t[1]+'"><div class="vp-tst">'+ab+'</div></div>'; } });
      g.innerHTML=h; }
  }
  document.addEventListener('click',function(e){ var t=e.target.closest('.vp-tile[data-st]');
    if(t){ picked=t.dataset.st; geoNote=''; render(); try{gaEvent('verdict_tap',{st:picked,page:location.pathname});}catch(x){} } });
  document.addEventListener('keydown',function(e){ if(e.key!=='Enter'&&e.key!==' ')return; var t=e.target.closest&&e.target.closest('.vp-tile[data-st]'); if(!t)return; e.preventDefault(); picked=t.dataset.st; geoNote=''; render(); var n=document.querySelector('.vp-tile[data-st="'+picked+'"]'); if(n)n.focus(); });
  document.addEventListener('change',function(e){ if(e.target&&e.target.id==='vp-sel'){ picked=e.target.value; geoNote=''; render(); } });
  // AFIDA counts leases of 10 years or more as holdings, and this file does not
  // split owned from leased. Iowa: Iowa State CARD (2025, on 2023 filings) finds
  // most foreign interest there is long-term leases, mostly for wind turbines.
  var LEASE_NOTE={_:'AFIDA counts leases of 10 years or more (wind turbine leases among them) as holdings; these filings do not split owned from leased.',
    IA:'Most of it is not ownership: Iowa State\u2019s CARD finds most foreign interest in Iowa land is long-term leases, mostly for wind turbines (2023 filings). AFIDA counts leases of 10 years or more as holdings.'};
  function buildVerdicts(j){
    var by={}, out={};
    var N2A={}; Object.keys(__A2F).forEach(function(a){ N2A[__A2F[a].toLowerCase()]=a; });
    var cs=j.counties||j;
    Object.keys(cs).forEach(function(f){
      var c=cs[f]; if(!c||!c.st||!c.y)return;
      var ab=N2A[String(c.st).toLowerCase()]||c.st;
      var b=by[ab]=by[ab]||{};
      Object.keys(c.y).forEach(function(y){ b[y]=(b[y]||0)+(+c.y[y]||0); });
    });
    var latestYr=0;
    Object.keys(by).forEach(function(st){ Object.keys(by[st]).forEach(function(y){ if(+y>latestYr)latestYr=+y; }); });
    var vals=[];
    Object.keys(by).forEach(function(st){ var v=by[st][latestYr]; if(v)vals.push(v); });
    vals.sort(function(a,b){return a-b;});
    function q(v){ var i=0; while(i<vals.length&&vals[i]<v)i++; return i/vals.length; }
    Object.keys(by).forEach(function(st){
      if(!__A2F[st])return;
      // The label reads the last five years, not since 2010: Iowa is +193%
      // since 2010 but peaked in 2020 and sits 8% under that peak in 2024.
      var yrs=Object.keys(by[st]).filter(function(y){return by[st][y]>0;}).sort();
      var cur=by[st][latestYr]||0, y0=yrs[0], first=y0?by[st][y0]:0;
      var ry=yrs.filter(function(y){return +y>=latestYr-4&&+y<latestYr;})[0];
      var rbase=ry?by[st][ry]:0;
      var ch=rbase?100*(cur-rbase)/rbase:null, chAll=first&&y0!=String(latestYr)?100*(cur-first)/first:null;
      var pk=yrs.reduce(function(m,y){return by[st][y]>by[st][m]?y:m;},yrs[0]||String(latestYr));
      var word,c;
      if(ch!=null&&ch>=50){word='GROWING FAST';c='#e0685f';}
      else if(ch!=null&&ch>=10){word='GROWING';c='#d4a23f';}
      else if(ch!=null&&ch>-10){word='HOLDING STEADY';c='#8a948f';}
      else if(ch!=null){word='SHRINKING';c='#5fc28a';}
      else {word='TOO NEW TO CALL';c='#8a948f';}
      var qq=q(cur), t=qq>=0.8?'#af3a32':(qq>=0.6?'#9c4b3d':(qq>=0.4?'#a8823c':(qq>=0.2?'#3a4144':'#396d4f')));
      var lab=cur>=1e6?(cur/1e6).toFixed(1)+'M':Math.round(cur/1e3)+'k';
      var pct=function(x){return (x>=0?'up ':'down ')+Math.abs(x).toFixed(0)+'\u0025';};
      var trend=[];
      if(ch!=null) trend.push(pct(ch)+(pk===ry&&cur<rbase?' from its '+ry+' peak':' since '+ry));
      if(pk!==String(latestYr)&&cur<by[st][pk]*0.95&&pk!==ry) trend.push(pct(100*(cur-by[st][pk])/by[st][pk])+' from its '+pk+' peak');
      if(chAll!=null&&y0!==ry) trend.push(pct(chAll)+' since '+y0);
      out[st]={big:lab,word:word+(ry?' SINCE '+ry:''),col:c,tile:t,tval:lab,
        sent:'Foreign entities report holding <b style="color:'+c+'">'+lab+' acres</b> of '+(__A2F[st]||st)+' agricultural land ('+latestYr+' AFIDA filings)'+(trend.length?', '+trend.join(', '):'')+'. '+(LEASE_NOTE[st]||LEASE_NOTE._)+' Pick a county on the map above to see exactly where, and whose.'};
    });
    return out;
  }
  window.AgForeignStates=function(j){ if(!j)return; VD=buildVerdicts(j); render(); };
})();
(function(){
  'use strict';
  var DATA='/data/afida/';
  var $=function(id){return document.getElementById(id);};
  var gaEvent=window.gaEvent||function(){};
  var fmt=function(n){return Math.round(n).toLocaleString();};
  var county=null, nat=null;
  function isCode(k){return /^\s*99[89]\b|NO PREDOMINANT|NO FOREIGN INVESTOR/i.test(k);}
  function prettyCountry(k){
    if(/999|NO PREDOMINANT/i.test(k)) return 'No predominant country (mixed ownership)';
    return String(k).toLowerCase().replace(/\b\w/g,function(c){return c.toUpperCase();})
      .replace(/\bOf\b/g,'of').replace(/\bAnd\b/g,'and').replace(/\bThe\b/g,'the')
      .replace(/^United Kingdom$/,'United Kingdom').replace(/\bUs\b/g,'US');
  }
  var YEARS=[2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024];
  // Dark ramp is the original. Light ramp: ColorBrewer YlOrBr (colour-blind safe, sequential),
  // its palest class dropped so the first step stays clear of the light canvas and the no-data grey.
  var COLORS_DARK=['#26290f','#4a4416','#6e5d1d','#957a24','#bd982e','#d4a23f'];
  var COLORS_LIGHT=['#fee391','#fec44f','#fe9929','#ec7014','#cc4c02','#8c2d04'];
  function isLight(){ return document.documentElement.getAttribute('data-theme')==='light'; }
  var COLORS=isLight()?COLORS_LIGHT:COLORS_DARK;
  function NA(){ return isLight()?'#d3d6d4':'#12161a'; }


  function showCounty(fips){
    var c=county[fips];
    if(!c){
      // Returning here left the previous county's panel open. About 560 U.S. counties have
      // no AFIDA record, so a reader could attribute Aroostook's 2.08M Canadian-held acres
      // to whichever neighbour they clicked next.
      var d=document.getElementById('fl-detail'); if(d)d.classList.remove('on');
      return;
    }
    var latest=nat.latest_year, ac=c.y[latest]||c.y[String(latest)]||0;
    $('fl-dt-name').textContent=c.n+' County, '+c.st;
    
    $('fl-dt-ac').textContent=ac?fmt(ac)+' ac foreign-held ('+latest+')':'no disclosed holdings in '+latest;
    // trend bars with honest gaps
    var maxv=0; YEARS.forEach(function(y){var v=c.y[y]||c.y[String(y)];if(v&&v>maxv)maxv=v;});
    var bars='';
    YEARS.forEach(function(y){
      var v=c.y[y]||c.y[String(y)];
      var isGap=(nat.missing_years||[]).indexOf(y)>=0;
      if(isGap){ bars+='<div class="fl-bar gap" title="'+y+': no USDA file"><span class="fl-bar-y">'+String(y).slice(2)+'</span></div>'; }
      else{
        var h=v&&maxv?Math.max(3,Math.round(v/maxv*86)):2;
        bars+='<div class="fl-bar" style="height:'+h+'px'+(v?'':';background:#2a2f31')+'" title="'+y+': '+(v?fmt(v)+' ac':'none reported')+'"><span class="fl-bar-y">'+String(y).slice(2)+'</span></div>';
      }
    });
    $('fl-dt-bars').innerHTML=bars;
    var rows='';
    (c.top||[]).forEach(function(t){ rows+='<tr><td>'+prettyCountry(t[0])+'</td><td class="num">'+fmt(t[1])+'</td></tr>'; });
    $('fl-dt-countries').innerHTML=rows||'<tr><td class="fl-mut">No disclosed holdings</td></tr>';
    var land=c.land||{}, tot=0, k;
    for(k in land) tot+=land[k];
    var lc={'Forest':'#5fc28a','Crop':'#d4a23f','Pasture':'#c4922f','Other Non-Ag':'#8a948f','Other Agriculture':'#6e6329'};
    var seg='', leg='';
    for(k in land){
      var pct=tot?land[k]/tot*100:0;
      if(pct<0.5) continue;
      seg+='<div style="width:'+pct+'%;background:'+(lc[k]||'#8a948f')+'" title="'+k+' '+Math.round(pct)+'%"></div>';
      leg+='<span style="color:'+(lc[k]||'#8a948f')+'">&#9632;</span> '+k+' '+Math.round(pct)+'% &nbsp; ';
    }
    $('fl-dt-split').innerHTML=seg||'';
    $('fl-dt-splitleg').innerHTML=leg||'<span class="fl-mut">No land-type detail</span>';
    $('fl-detail').classList.add('on');
    
    try{ window.gaEvent&&gaEvent('foreign_land_county',{fips:fips}); }catch(e){}
  }

  function natChart(){
    var svg=$('fl-nat-chart'), W=900, H=300, P={l:70,r:16,t:16,b:34};
    var ys=nat.years.map(Number), tv=nat.total_by_year;
    var maxv=0; ys.forEach(function(y){var v=tv[y]||tv[String(y)];if(v>maxv)maxv=v;});
    var x=function(y){return P.l+(y-2010)/(2024-2010)*(W-P.l-P.r);};
    var yy=function(v){return H-P.b-(v/maxv)*(H-P.t-P.b);};
    var h='';
    // gridlines
    [10e6,20e6,30e6,40e6].forEach(function(g){
      h+='<line x1="'+P.l+'" y1="'+yy(g)+'" x2="'+(W-P.r)+'" y2="'+yy(g)+'" style="stroke:var(--border)"/>'
        +'<text x="'+(P.l-8)+'" y="'+(yy(g)+4)+'" text-anchor="end" style="fill:var(--text-muted)" font-family="JetBrains Mono,monospace" font-size="11">'+(g/1e6)+'M</text>';
    });
    // segments broken at missing years
    var segs=[], curr=[];
    for(var y=2010;y<=2024;y++){
      var v=tv[y]||tv[String(y)];
      if(v){ curr.push([y,v]); }
      else { if(curr.length) segs.push(curr); curr=[]; }
    }
    if(curr.length) segs.push(curr);
    segs.forEach(function(seg){
      var d='';
      seg.forEach(function(p,i){ d+=(i?'L':'M')+x(p[0]).toFixed(1)+' '+yy(p[1]).toFixed(1)+' '; });
      h+='<path d="'+d+'" fill="none" stroke="#d4a23f" stroke-width="2.5"/>';
      seg.forEach(function(p){
        h+='<circle cx="'+x(p[0]).toFixed(1)+'" cy="'+yy(p[1]).toFixed(1)+'" r="3.5" style="fill:var(--bg)" stroke="#d4a23f" stroke-width="2"><title>'+p[0]+': '+fmt(p[1])+' acres</title></circle>';
      });
    });
    (nat.missing_years||[]).forEach(function(y){
      h+='<text x="'+x(y)+'" y="'+(H-P.b+2)+'" text-anchor="middle" style="fill:var(--text-muted)" font-family="JetBrains Mono,monospace" font-size="10">✕</text>';
    });
    for(var yr=2010;yr<=2024;yr+=2){
      h+='<text x="'+x(yr)+'" y="'+(H-8)+'" text-anchor="middle" style="fill:var(--text-muted)" font-family="JetBrains Mono,monospace" font-size="11">'+yr+'</text>';
    }
    svg.innerHTML=h;
  }

  function tables(){
    var rows='';
    (nat.top_counties||[]).forEach(function(t,i){
      rows+='<tr><td class="fl-mut">'+(i+1)+'</td><td>'+t.n+', '+t.st+'</td><td class="num">'+fmt(t.ac)+'</td></tr>';
    });
    $('fl-top-counties').innerHTML='<tr><th>#</th><th>County</th><th style="text-align:right">Acres</th></tr>'+rows;
    var cr='', bc=nat.by_country, total=nat.total_by_year[nat.latest_year]||nat.total_by_year[String(nat.latest_year)];
    /* 999 / 998 are codes, not countries: keep them out of the ranking and say how many acres they hold */
    var real=Object.keys(bc).filter(function(k){return !isCode(k);}), unassigned=0;
    Object.keys(bc).forEach(function(k){ if(isCode(k)) unassigned+=bc[k]; });
    real.slice(0,15).forEach(function(k,i){
      cr+='<tr><td class="fl-mut">'+(i+1)+'</td><td>'+prettyCountry(k)+'</td><td class="num">'+fmt(bc[k])+'</td><td class="num" class="fl-mut">'+(bc[k]/total*100).toFixed(1)+'%</td></tr>';
    });
    if(unassigned)cr+='<tr><td></td><td class="fl-mut" colspan="3">Not ranked: '+fmt(unassigned)+' acres filed with no predominant country or no foreign investor listed.</td></tr>';
    $('fl-top-countries').innerHTML='<tr><th>#</th><th>Country</th><th style="text-align:right">Acres</th><th style="text-align:right">Share</th></tr>'+cr;
  }

  function stats(){
    var latest=nat.latest_year, tot=nat.total_by_year[latest]||nat.total_by_year[String(latest)];
    var t2010=nat.total_by_year[2010]||nat.total_by_year['2010'];
    $('fl-s-total').textContent=(tot/1e6).toFixed(1)+'M';
    $('fl-s-growth').textContent='+'+Math.round((tot/t2010-1)*100)+'%';
    $('fl-s-top').textContent=Object.keys(nat.by_country).filter(function(k){return !isCode(k);})[0]
      .toLowerCase().replace(/\b\w/g,function(c){return c.toUpperCase();});
    var forest=nat.by_land_type&&nat.by_land_type.Forest;
    $('fl-s-forest').textContent=forest?Math.round(forest/tot*100)+'%':'-';
  }

  /* Owned vs 10+ year lease, from our own tabulation (scripts/process_afida.py writes
     nat.by_interest when the AFIDA file has an interest-type column). Shown only when the
     owned and lease buckets cover at least 99% of the row-summed acres; otherwise the
     static line stays, which says the split is not tabulated. */
  function interestLine(){
    var bi=nat&&nat.by_interest, tot=nat&&nat.total_by_year&&nat.total_by_year[String(nat.latest_year)];
    if(!bi||!tot||!(bi.owned>0)||!(bi.lease>0)) return;
    if((bi.owned+bi.lease)/tot<0.99) return;
    var el=$('fl-confirm'); if(!el) return;
    var pct=function(v){ return (100*v/tot).toFixed(1)+'%'; };
    el.innerHTML='<b>Owned or leased:</b> of '+fmt(tot)+' acres in USDA&rsquo;s '+nat.latest_year+' detail files, '+fmt(bi.owned)+' ('+pct(bi.owned)+') are owned and '+fmt(bi.lease)+' ('+pct(bi.lease)+') are leases of 10 years or more. Our own sum of the file&rsquo;s interest column. '+fmt(bi.nocountry||0)+' acres name no foreign country (codes 998 and 999).';
  }
  function load(){
    return Promise.all([
      fetch(DATA+'county.json',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}),
      fetch(DATA+'national.json',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;})
    ]).then(function(res){
      county=res[0]; nat=res[1];
      if(!county||!nat){ $('fl-nat-chart').outerHTML='<p class="fl-na">The AFIDA files did not load. Close and open this section to try again.</p>'; return false; }
      stats(); natChart(); tables(); interestLine(); hashCounty();
      if(window.AgForeignStates) window.AgForeignStates(county);
      window.addEventListener('hashchange',hashCounty);
      return true;
    });
  }
  /* The county is the one picked on the Atlas map above (#<fips> in the address). */
  function hashCounty(){
    var m=/(?:^#|&)(\d{5})(?:&|$)/.exec(location.hash||'');
    var d=$('fl-detail');
    if(!m){ if(d) d.classList.remove('on'); var p=$('fl-pick'); if(p) p.hidden=false; return; }
    var p2=$('fl-pick'); if(p2) p2.hidden=true;
    showCounty(m[1]);
  }
  window.AgForeign={load:load};

})();
