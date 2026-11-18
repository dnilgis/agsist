/* atlas-now.js: the Farmland Atlas map (Nov 18, 2026; batch 2 the same day). Five headline tiles, the county map and
   five questions (Weather, Land, Grain, Program, Risk); each question opens its headline map, and every detail map
   sits one tap down. Every figure and sentence of the headline maps comes from /farmland-atlas/data/now.json (built
   on main by scripts/atlas_now.py); geometry loads once from /farmland-atlas/data/geo-us.json.
   Batch 2 folds the old second map ("Every layer") into this one: its layers are listed under the questions and
   drawn here, from their own rules in components/atlas-layers.js (loaded the first time one is opened). Old links
   (#l=<layer>, #s=<state>, #<county code>) open the same layer, state and county here.
   Legend rules, every layer: at most six bins, grey for none, a hatch for no figure, an empty state outline where we
   do not read a state; two-colour scales only for rain against normal and basis. The only figures computed here are
   the counts in each key and the bin edges of the folded layers (quantiles of their own values). */
(function(){
'use strict';
var root=document.getElementById('an'); if(!root) return;
var D='/farmland-atlas/data/', NOW=null, GEO=null, IDX={}, ROWS={}, COL={}, LAY={}, PATHS={}, HAS={}, STATE_OF={};
var S={q:'',m:'',s:'',c:''}, OLD=null, OLDP=null, OL={}, DEC=null, DEEP=null;
// the old map's layers that are the same figure as a headline map open that map
var SAME={val:'value',rent:'rent',sob_cost:'cost',sob_10:'lr',yield_worst:'worst',water_irr:'irr',dr_share:'dweeks',heat_recent:'heat'};
// the old map's layer groups, each under one question
var QOF={'Night heat':'weather','Drought':'weather','Rain and heat':'weather','Season':'weather','Storms':'weather',
  'Land value':'land','Recorded sales':'land','Rent':'land','Who farms it':'land','Tile and tillage':'land','Solar and wind':'land','Livestock':'land',
  'Corn yield':'grain','CRP':'program','Loss record':'risk','Loss ratio':'risk','Water':'risk','Wells and rights':'risk'};
// one scale per kind of number; a trend or a change uses its family's single-hue ramp (no two-colour scale but rain)
var RAMP={heat:'heat',water:'share',gold:'money',loss:'risk',green:'green'};
var DIVSCALE={heat_trend:'heat',prem_slope:'share',rent_change:'money',yield_slope:'money',val_cagr:'money',crp_peak:'green',lv_chg:'money',gs_recent:'rain',gs_latest:'rain'};
var RAINVS=[-30,-15,0,15,30];
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function strong(sent){
  var t=esc(sent.t), ks=Object.keys(sent.src||{}).sort(function(a,b){return b.length-a.length;});
  ks.forEach(function(k){ if(/\d/.test(k)&&!/^(19|20)\d\d$/.test(k)&&!/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d/.test(k)) t=t.replace(esc(k),'<b>'+esc(k)+'</b>'); });
  return t;
}
function ga(n,p){ try{ if(window.gaEvent) window.gaEvent(n,p); }catch(e){} }
function get(u){ return fetch(u,{cache:'no-cache'}).then(function(r){ if(!r.ok) throw new Error(u); return r.json(); }); }
function isOld(k){ return !!k&&!LAY[k]; }

// ---------- values, bins and words (headline maps)
function val(f,l){ var r=ROWS[f]; return r?r[COL[l.col]]:null; }
function gap(f,l){ var r=ROWS[f]; return r&&l.gcol?r[COL[l.gcol]]:null; }
function money(v,dp){ return '$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:dp,maximumFractionDigits:dp}); }
function dp(l){ return l.key==='arc'||l.key==='prf'||l.key==='cost'?2:0; }
function show(v,l){
  if(l.unit==='$') return money(v,dp(l));
  if(l.unit==='%') return (Math.round(v*10)/10)+'%';
  if(l.unit==='F') return v.toFixed(1)+' F';
  if(l.unit==='c'){ var c=Math.round(Math.abs(v)*100); return c?c+(c===1?' cent ':' cents ')+(v<0?'under':'over'):'even'; }
  if(l.unit==='x') return v.toFixed(2);
  return String(v);
}
function cut(v,l){ if(l.unit==='$') return money(v,0); if(l.unit==='c') return cents(v); if(l.unit==='x') return v.toFixed(2); return v+(l.unit==='%'?'%':l.unit==='F'?' F':''); }
// basis in words: 65¢ under, even, 10¢ over
function cents(v){ var c=Math.round(Math.abs(v)*100); return c?c+'¢ '+(v<0?'under':'over'):'even'; }
function basisKey(cs,n){
  var o=[], i, a, b;
  o.push(['k0',cs[0]<0?'More than '+cents(cs[0]):cs[0]===0?'Under futures':'Under '+cents(cs[0]),n.k0]);
  for(i=1;i<cs.length;i++){ a=cs[i-1]; b=cs[i];
    o.push(['k'+i,(a<0&&b<0)?Math.round(-a*100)+'¢ to '+cents(b):(a>0&&b>0)?Math.round(a*100)+'¢ to '+cents(b):cents(a)+' to '+cents(b),n['k'+i]]); }
  b=cs[cs.length-1]; o.push(['k'+cs.length,b===0?'Even or over':b>0?cents(b)+' or more':cents(b)+' or stronger',n['k'+cs.length]]);
  return o;
}
var DRN=['Abnormally dry (D0)','Moderate (D1)','Severe (D2)','Extreme (D3)','Exceptional (D4)'];
// partial layers: a state we do not read is an empty outline (ko), not a few hundred hatched counties
var COVER={sale:1,basis:1,near:1};
// class of one county on one layer: k0..k5 a bin, kn grey (none), kx hatched (a gap with a reason), ko a state we do not read
function cls(f,l){
  if(l.old) return ocls(f,l);
  var v=val(f,l), g=gap(f,l);
  if(l.key==='drought'){ if(v==null) return 'kx'; return v<0?'kn':'k'+v; }
  if(g==='nost'&&COVER[l.key]) return 'ko';
  if(l.scale==='count'&&v===0) return 'kn';
  if(v==null){ if(g==='none'&&(l.key==='basis')) return 'kn'; return 'kx'; }
  var i=0; while(i<l.cuts.length&&v>=l.cuts[i]) i++;
  if(l.scale==='count') i=Math.max(0,i-1);
  return 'k'+i;
}
function count(l){ var n={}, f; for(f in HAS){ var c=cls(f,l); n[c]=(n[c]||0)+1; } return n; }
function outStates(l){ var o={}, f; for(f in HAS) if(cls(f,l)==='ko') o[(STATE_OF[f]||f.slice(0,2))]=1; return Object.keys(o).length; }
function keyItems(l){
  var out=[], n=count(l), f;
  if(l.old) return okeyItems(l,n);
  if(l.key==='drought'){
    out.push(['kn','None',n.kn]); for(var i=0;i<5;i++) out.push(['k'+i,DRN[i],n['k'+i]]);
  }else{
    var cs=l.cuts.slice(); if(l.scale==='count'){ out.push(['kn','None within 30 miles',n.kn]); cs=cs.slice(1); }
    if(l.scale==='rain'){ out.push(['k0','Under '+cs[0]+'%',n.k0]); for(var j=1;j<cs.length;j++) out.push(['k'+j,cs[j-1]+' to '+cs[j]+'%',n['k'+j]]); out.push(['k'+cs.length,cs[cs.length-1]+'% or more',n['k'+cs.length]]); }
    else if(l.unit==='c'&&cs.length){ out=out.concat(basisKey(cs,n)); }
    else if(cs.length){ out.push(['k0','Under '+cut(cs[0],l),n.k0]); for(var k=1;k<cs.length;k++) out.push(['k'+k,cut(cs[k-1],l)+' to '+cut(cs[k],l),n['k'+k]]); out.push(['k'+cs.length,cut(cs[cs.length-1],l)+' or more',n['k'+cs.length]]); }
    if(l.key==='basis') out.push(['kn',l.gaps.none,n.kn]);
  }
  var gx={}; for(f in HAS){ if(cls(f,l)==='kx'){ var g=gap(f,l)||'nodata'; gx[g]=(gx[g]||0)+1; } }
  Object.keys(gx).forEach(function(g){ out.push(['kx',(l.gaps&&l.gaps[g])||'No figure',gx[g]]); });
  if(n.ko) out.push(['ko','States we do not read',outStates(l),'states']);
  return out.filter(function(x){ return x[2]; });
}
function line(f,l){
  var v=val(f,l), g=gap(f,l);
  if(l.key==='drought') return v==null?((l.gaps&&l.gaps[g])||'No county figure'):(v<0?'No drought level covers half the county':DRN[v]+' covers at least half the county');
  if(v==null) return (l.gaps&&l.gaps[g])||'No figure';
  return l.label+': '+show(v,l)+(l.key==='basis'?' '+NOW.dates.basis_vs+' futures':'');
}

// ---------- the folded layers: their values come from atlas-layers.js, their bins and key from here
function sig(v,n){ if(v===0||!isFinite(v)) return v; var m=Math.pow(10,Math.floor(Math.log(Math.abs(v))/Math.LN10)-n+1); return Math.round(v/m)*m; }
function nice(b,gap){ for(var n=1;n<=5;n++){ var r=sig(b,n); if(Math.abs(r-b)<=0.2*gap) return Number(r.toPrecision(12)); } return b; }
function bins(d){
  // a zero is "none" (grey) on a count, an amount or a share, never on a trend, a change or a date
  var zeroNone=!d.div&&!d.doy, a=[], f;
  for(f in d.vals){ var v=d.vals[f]; if(zeroNone&&v===0) continue; a.push(v); }
  a.sort(function(x,y){return x-y;});
  var scale=DIVSCALE[d.key]||RAMP[d.ramp]||'money';
  if(scale==='rain') return {scale:scale,cuts:RAINVS.slice(),zeroNone:false};
  var cuts=[];
  if(a.length>=10){
    var lo=a[0], hi=a[a.length-1];
    for(var i=1;i<5;i++){ var p=(a.length-1)*i/5, x=a[Math.floor(p)]+(a[Math.ceil(p)]-a[Math.floor(p)])*(p-Math.floor(p));
      var g=Math.max((hi-lo)/50,Math.abs(x)*0.02)||1, c=d.doy?Math.round(x):nice(x,g);
      if(!cuts.length||c>cuts[cuts.length-1]) cuts.push(c); }
    if(cuts.length&&cuts[0]<=lo) cuts.shift();
  }
  return {scale:scale,cuts:cuts,zeroNone:zeroNone};
}
function ocls(f,l){
  var d=OL[l.key]; if(!d) return 'kx';
  if(d.cls[f]) return d.cls[f];
  var v=d.vals[f];
  if(v==null) return d.outSt[STATE_OF[f]||f.slice(0,2)]?'ko':'kx';
  if(l.zeroNone&&v===0) return 'kn';
  var i=0; while(i<l.cuts.length&&v>=l.cuts[i]) i++;
  return 'k'+i;
}
function oshort(l,v){ return window.AtlasLayers?window.AtlasLayers.short(l.key,v):String(v); }
function okeyItems(l,n){
  var out=[], cs=l.cuts, d=OL[l.key], w=d.salesWords;
  if(l.zeroNone) out.push(['kn',w?w.kn.charAt(0).toUpperCase()+w.kn.slice(1):'None',n.kn]);
  else if(w) out.push(['kn',w.kn.charAt(0).toUpperCase()+w.kn.slice(1),n.kn]);
  if(l.scale==='rain'){ var r=['30% or more below normal','15 to 30% below','Up to 15% below','Up to 15% above','15 to 30% above','30% or more above'];
    r.forEach(function(t,i){ out.push(['k'+i,t,n['k'+i]]); }); }
  else if(!cs.length) out.push(['k0','All the same',n.k0]);
  else { var lt=l.doy?'Before ':'Under ', ge=l.doy?' or later':' or more';
    out.push(['k0',lt+oshort(l,cs[0]),n.k0]);
    for(var k=1;k<cs.length;k++) out.push(['k'+k,oshort(l,cs[k-1])+' to '+oshort(l,cs[k]),n['k'+k]]);
    out.push(['k'+cs.length,oshort(l,cs[cs.length-1])+ge,n['k'+cs.length]]); }
  if(n.kx) out.push(['kx',w&&w.kx?w.kx.charAt(0).toUpperCase()+w.kx.slice(1):'No figure',n.kx]);
  if(n.ko) out.push(['ko',w?'No public sale records in the state':'States with no figure',outStates(l),'states']);
  return out.filter(function(x){ return x[2]; });
}
function oldList(){
  if(!OLDP){
    OLDP=new Promise(function(ok,no){
      if(window.AtlasLayers) return ok();
      var s=document.createElement('script'); s.src='/components/atlas-layers.js?v=1'; s.onload=function(){ ok(); }; s.onerror=function(){ OLDP=null; no(new Error('layers')); };
      document.head.appendChild(s);
    }).then(function(){
      var names={}; for(var k in NOW.states) names[k]=NOW.states[k].name;
      return window.AtlasLayers.boot({paths:HAS, names:names, pick:function(f){ pick(f,true,true); }, toMap:function(){ $('an-map').scrollIntoView({behavior:'smooth',block:'start'}); }, panelHost:function(){ return $('an-panel'); }});
    }).then(function(api){
      OLD={};
      api.list().forEach(function(x){ if(SAME[x.key]||!QOF[x.grp]) return; OLD[x.key]={key:x.key, old:true, q:QOF[x.grp], label:x.label, grp:x.grp, off:x.off, slider:x.slider}; });
      try{ document.dispatchEvent(new CustomEvent('atlas-layers-ready')); }catch(e){}
      return OLD;
    });
  }
  return OLDP;
}
function loadOld(key){
  return oldList().then(function(){
    var l=OLD[key]; if(!l) throw new Error('layer');
    return window.AtlasLayers.layer(key,{dec:DEC}).then(function(d){
      var b=bins(d); l.scale=b.scale; l.cuts=b.cuts; l.zeroNone=b.zeroNone; l.doy=d.doy;
      var has={}; for(var f in d.vals) has[STATE_OF[f]||f.slice(0,2)]=1;
      d.outSt={}; if(!d.salesWords) for(var g in HAS){ var st=STATE_OF[g]||g.slice(0,2); if(!has[st]) d.outSt[st]=1; }
      OL[key]=d; l.title=d.title; return l;
    });
  });
}
function layerOf(k){ return LAY[k]||(OLD&&OLD[k]); }

// ---------- the map
var SVGNS='http://www.w3.org/2000/svg';
function buildMap(){
  var svg=$('an-svg'), g=document.createElementNS(SVGNS,'g'), st=document.createElementNS(SVGNS,'g');
  svg.setAttribute('viewBox',GEO.vb.join(' '));
  Object.keys(GEO.c).forEach(function(f){ var p=document.createElementNS(SVGNS,'path'); p.setAttribute('d',GEO.c[f]); p.setAttribute('data-f',f); g.appendChild(p); PATHS[f]=p; HAS[f]=true; });
  g.setAttribute('class','an-c'); st.setAttribute('class','an-s');
  Object.keys(GEO.s).forEach(function(k){ var p=document.createElementNS(SVGNS,'path'); p.setAttribute('d',GEO.s[k]); st.appendChild(p); });
  svg.appendChild(g); svg.appendChild(st);
  var hl=document.createElementNS(SVGNS,'path'); hl.setAttribute('class','an-hl'); hl.id='an-hl'; svg.appendChild(hl);
  // Alaska and Hawaii are drawn apart and not to scale: say so on the map
  var lab=$('an-insets'), vb=GEO.vb, h='';
  ['AK','HI'].forEach(function(k){ var b=GEO.box[k]; if(!b) return;
    h+='<span style="left:'+((b[0]-vb[0])/vb[2]*100).toFixed(2)+'%;top:'+((b[1]-vb[1])/vb[3]*100).toFixed(2)+'%">'+(k==='AK'?'Alaska':'Hawaii')+'</span>'; });
  lab.innerHTML=h;
  svg.addEventListener('click',function(e){ var f=e.target&&e.target.getAttribute&&e.target.getAttribute('data-f'); if(f){ pick(f); ga('atlas_now_county',{fips:f}); } });
}
function paint(){
  var l=layerOf(S.m); if(!l) return;
  if(l.old&&!OL[l.key]){ waitOld(l.key); return; }
  $('an-svg').setAttribute('data-scale',l.scale);
  for(var f in PATHS) PATHS[f].setAttribute('class',cls(f,l));
  $('an-maptitle').textContent=l.label;
  var leg=l.old?(OL[l.key].natline||'')+'<span>'+esc(OL[l.key].title)+'.</span> '+(OL[l.key].why?'<span>'+esc(OL[l.key].why)+'.</span> ':'')+(OL[l.key].note||''):strong(l.legend);
  $('an-legend').innerHTML=leg;
  var cs=getComputedStyle(root);
  $('an-key').innerHTML=keyItems(l).map(function(x){ var bg=/^k\d$/.test(x[0])?' style="background:'+cs.getPropertyValue('--an-'+l.scale+'-'+x[0]).trim()+'"':'';
    return '<li><i class="'+x[0]+'"'+bg+'></i>'+esc(x[1])+' <b>'+Number(x[2]).toLocaleString('en-US')+'</b></li>'; }).join('');
  $('an-key').scrollLeft=0;
  $('an-svg').setAttribute('aria-label','County map: '+l.label);
  var dw=$('an-dec'); dw.hidden=!l.slider;
  if(l.slider&&!dw.options.length){ window.AtlasLayers.decades.forEach(function(t,i){ var o=document.createElement('option'); o.value=i; o.textContent=t; dw.appendChild(o); }); dw.value=DEC==null?window.AtlasLayers.decades.length-1:DEC; }
  root.classList.remove('waiting');
  if(S.c) pick(S.c,true);
}
function waitOld(key){
  root.classList.add('waiting');
  $('an-maptitle').textContent=OLD&&OLD[key]?OLD[key].label:'Loading the layer';
  loadOld(key).then(function(){ if(S.m===key){ paint(); side(); } }).catch(function(){
    root.classList.remove('waiting');
    $('an-legend').textContent='This layer did not load. The headline maps above still work; reload to try again.';
    if(S.m===key){ S.m=S.q?headOf(S.q):'drought'; paint(); }
  });
}
function zoom(st){
  S.s=st&&GEO.box[st]?st:''; var vb=GEO.vb;
  if(S.s){ var b=GEO.box[S.s], w=b[2]-b[0], h=b[3]-b[1], p=Math.max(w,h)*.06, W=w+2*p, H=h+2*p, r=vb[2]/vb[3];
    if(W/H<r) W=H*r; else H=W/r; vb=[(b[0]+b[2])/2-W/2,(b[1]+b[3])/2-H/2,W,H]; }
  $('an-svg').setAttribute('viewBox',vb.map(function(v){return Math.round(v*10)/10;}).join(' '));
  root.classList.toggle('zoomed',!!S.s); $('an-st').value=S.s; $('an-all').hidden=!S.s;
  setLink(); save();
}
function pick(f,quiet,fromRecord){
  if(!HAS[f]) return; S.c=f; var l=layerOf(S.m), i=IDX[f], hl=$('an-hl');
  hl.setAttribute('d',GEO.c[f]||'');
  var name=i?i[0]:f, stc=GEO.box[STATE_OF[f]]?STATE_OF[f]:null;
  var body=l&&l.old?(window.AtlasLayers?window.AtlasLayers.card(l.key,f):''):(l&&ROWS[f]?esc(line(f,l))+'.':'');
  $('an-read').innerHTML='<b>'+esc(name)+'</b>: '+body+' '+(i?'<a href="'+esc(i[1])+'">Open the county page</a>':'')+
    ' <button type="button" id="an-rec">Full county record here</button>'+
    (stc&&S.s!==stc?' <button type="button" id="an-zst">Zoom to '+esc(NOW.states[stc]&&NOW.states[stc].name||stc)+'</button>':'');
  var z=$('an-zst'); if(z) z.addEventListener('click',function(){ zoom(stc); ga('atlas_now_state',{state:stc}); });
  $('an-rec').addEventListener('click',function(){ record(f,'tap'); });
  if(!quiet){ setLink(); save(); }
  if(fromRecord){ setLink(); }
}
function record(f,how){
  oldList().then(function(){ window.AtlasLayers.panel(f,how); ga('atlas_now_record',{fips:f}); }).catch(function(){
    $('an-read').insertAdjacentHTML('beforeend',' <span>The full record did not load; the county page has it.</span>'); });
}

// ---------- the questions
function hatch(x,c){ var p=document.createElement('canvas'); p.width=p.height=4; var y=p.getContext('2d'); y.fillStyle=c('gap-bg'); y.fillRect(0,0,4,4); y.strokeStyle=c('gap-line'); y.lineWidth=1.2; y.beginPath(); y.moveTo(0,4); y.lineTo(4,0); y.stroke(); return x.createPattern(p,'repeat'); }
function thumbs(){
  if(!window.Path2D) return;
  var cs=getComputedStyle(root);
  [].forEach.call(root.querySelectorAll('canvas[data-layer]'),function(cv){
    var l=LAY[cv.getAttribute('data-layer')], scale=l.scale, x=cv.getContext('2d'), vb=GEO.vb, k=cv.width/vb[2];
    var col={}; function c(n){ if(!col[n]) col[n]=cs.getPropertyValue('--an-'+scale+'-'+n).trim()||cs.getPropertyValue('--an-'+n).trim()||'#888'; return col[n]; }
    var hx=hatch(x,c);
    x.setTransform(k,0,0,k,-vb[0]*k,-vb[1]*k); x.clearRect(vb[0],vb[1],vb[2],vb[3]);
    for(var f in GEO.c){ var n=cls(f,l); if(n==='ko') continue; x.fillStyle=n==='kx'?hx:n==='kn'?c('none'):c(n); x.fill(new Path2D(GEO.c[f])); }
  });
}
function headOf(q){ return NOW.questions.filter(function(x){return x.key===q;})[0].head; }
function side(){
  var box=$('an-side'), h='';
  if(!S.q){
    h='<h2 class="an-qh">Pick a question</h2><div class="an-qgrid">'+NOW.questions.map(function(q){
      return '<button type="button" class="an-qcard" data-q="'+q.key+'"><canvas width="166" height="113" data-layer="'+q.head+'" aria-hidden="true"></canvas><span><b class="an-ql">'+esc(q.label)+'</b><span class="an-qq">'+esc(q.ask)+'</span><span class="an-qa">'+strong(NOW.say[q.key])+'</span></span></button>';
    }).join('')+'</div>';
  }else{
    var q=NOW.questions.filter(function(x){return x.key===S.q;})[0];
    var more=OLD?Object.keys(OLD).map(function(k){return OLD[k];}).filter(function(l){ return l.q===S.q&&!l.off; }):null;
    h='<p class="an-ask">'+esc(q.ask)+'</p><p class="an-ans">'+strong(NOW.say[q.key])+'</p>'+(NOW.say[q.key+'_sub']?'<p class="an-ans2">'+strong(NOW.say[q.key+'_sub'])+'</p>':'')+
      '<h2 class="an-qh">Maps one tap down</h2><div class="an-dl">'+NOW.layers.filter(function(l){return l.q===S.q;}).map(function(l){
        return '<button type="button" class="an-dbtn" data-m="'+l.key+'" aria-pressed="'+(l.key===S.m)+'"><canvas width="96" height="65" data-layer="'+l.key+'" aria-hidden="true"></canvas><span>'+esc(l.label)+(l.key===q.head?' <small>headline</small>':'')+'</span></button>';
      }).join('')+'</div>'+
      '<h2 class="an-qh an-qh2">More maps</h2>'+(more?'<div class="an-ml">'+more.map(function(l){
        return '<button type="button" class="an-mbtn" data-m="'+l.key+'" aria-pressed="'+(l.key===S.m)+'">'+esc(l.label)+'<small>'+esc(l.grp)+'</small></button>'; }).join('')+'</div>'
        :'<button type="button" class="an-mopen" id="an-mopen">Show every map for '+esc(q.label)+'</button>');
  }
  box.innerHTML=h;
  [].forEach.call(box.querySelectorAll('[data-q]'),function(b){ b.addEventListener('click',function(){ go(b.getAttribute('data-q')); ga('atlas_now_question',{q:b.getAttribute('data-q')}); }); });
  [].forEach.call(box.querySelectorAll('[data-m]'),function(b){ b.addEventListener('click',function(){ S.m=b.getAttribute('data-m'); paint(); side(); setLink(); save(); ga('atlas_now_layer',{layer:S.m}); }); });
  var mo=$('an-mopen'); if(mo) mo.addEventListener('click',function(){ mo.disabled=true; mo.textContent='Loading the maps'; oldList().then(side).catch(function(){ mo.disabled=false; mo.textContent='The maps did not load. Tap to try again.'; }); });
  thumbs();
}
function tabs(){
  [].forEach.call(root.querySelectorAll('.an-tab'),function(b){ var on=b.getAttribute('data-q')===S.q; b.setAttribute('aria-pressed',on?'true':'false'); });
}
function go(q,keepM){
  S.q=q||''; var l=layerOf(S.m);
  if(!keepM||!l||(S.q&&l.q!==S.q)) S.m=S.q?headOf(S.q):'drought';
  tabs(); paint(); side(); setLink(); save();
}
function tiles(){
  var box=$('an-tiles'); if(!box||!NOW.tiles) return;
  box.innerHTML=NOW.tiles.map(function(t){
    return '<button type="button" class="an-tile" data-q="'+esc(t.q)+'"><span class="an-tl">'+esc(t.label)+'</span><b class="an-tb">'+esc(t.big.t)+'</b><span class="an-ts">'+esc(t.sub.t)+'</span></button>'; }).join('');
  [].forEach.call(box.querySelectorAll('.an-tile'),function(b){ b.addEventListener('click',function(){ go(b.getAttribute('data-q')); ga('atlas_now_tile',{q:b.getAttribute('data-q')}); }); });
}

// ---------- links and the picture
function setLink(){
  var l=layerOf(S.m), p=[]; if(S.q) p.push('q='+S.q); if(S.m&&S.m!=='drought'&&!(S.q&&l&&l.q===S.q&&headOf(S.q)===S.m)) p.push('m='+S.m);
  if(S.s) p.push('s='+S.s); if(S.c) p.push('c='+S.c);
  // an old link's own words (#l=, #s=, the county code) come off once they are read; anything else after # stays
  var h=(location.hash||'').replace(/^#/,'').split('&').filter(function(x){ return x&&!/^(l=|s=|\d{5}$)/.test(x); }).join('&');
  try{ history.replaceState(history.state,'',location.pathname+(p.length?'?'+p.join('&'):'')+(h?'#'+h:'')); }catch(e){}
}
function readLink(){
  (location.search||'').replace(/^\?/,'').split('&').forEach(function(kv){ var a=kv.split('='), k=a[0], v=decodeURIComponent(a[1]||'');
    if(k==='q'&&/^[a-z]+$/.test(v)) S.q=v; if(k==='m'&&/^[a-z0-9_]+$/.test(v)) S.m=v; if(k==='s'&&/^[A-Z]{2}$/.test(v)) S.s=v; if(k==='c'&&/^\d{5}$/.test(v)) S.c=v; });
  return readHash();
}
// the old map's links: #19169, #19169&l=rent, #l=afida&s=NE
function readHash(){
  var o=null;
  (location.hash||'').replace(/^#/,'').split('&').forEach(function(p){ var v;
    try{ v=decodeURIComponent(p); }catch(e){ return; }
    if(/^\d{5}$/.test(v)){ (o=o||{}).c=v; } else if(/^l=[a-z0-9_]+$/.test(v)){ (o=o||{}).l=v.slice(2); } else if(/^s=[A-Za-z]{2}$/.test(v)){ (o=o||{}).s=v.slice(2).toUpperCase(); } });
  return o;
}
function applyDeep(o){
  if(o.s) S.s=o.s; if(o.c) S.c=o.c;
  if(o.l){ var k=SAME[o.l]||o.l;
    if(LAY[k]){ S.m=k; S.q=LAY[k].q; }
    else { S.m=k; S.q=''; DEEP=o; return oldList().then(function(){ var l=OLD[k]; if(!l){ S.m='drought'; } else S.q=l.q; go(S.q,true); side(); if(o.s) zoom(o.s); if(o.c){ pick(o.c,true); record(o.c,'link'); } }).catch(function(){ S.m='drought'; go(''); }); }
  }
  return null;
}
function picName(){ return S.c&&S.q==='land'?'pic-'+S.c:S.s?'pic-'+S.s.toLowerCase():'pic-us'; }
function save(){
  var a=$('an-pic'); if(!a||!NOW.pics) return;
  var n=picName(); a.href=NOW.pics+n+'.png'; a.setAttribute('download','agsist-'+n+'.png');
  a.textContent=n==='pic-us'?'Save the picture':n.length===6?'Save the '+(NOW.states[S.s]&&NOW.states[S.s].name||S.s)+' picture':'Save the county picture';
}
function wire(){
  [].forEach.call(root.querySelectorAll('.an-tab'),function(b){ b.addEventListener('click',function(){ go(b.getAttribute('data-q')); ga('atlas_now_question',{q:b.getAttribute('data-q')||'all'}); }); });
  var sel=$('an-st');
  Object.keys(GEO.box).sort(function(a,b){ var A=NOW.states[a]&&NOW.states[a].name||a, B=NOW.states[b]&&NOW.states[b].name||b; return A<B?-1:1; }).forEach(function(st){
    var o=document.createElement('option'); o.value=st; o.textContent=NOW.states[st]&&NOW.states[st].name||st; sel.appendChild(o); });
  sel.addEventListener('change',function(){ zoom(sel.value); if(sel.value) ga('atlas_now_state',{state:sel.value}); });
  $('an-all').addEventListener('click',function(){ zoom(''); });
  $('an-dec').addEventListener('change',function(){ DEC=Number(this.value); var k=S.m; delete OL[k]; paint(); });
  $('an-pic').addEventListener('click',function(e){
    // a same-tab download of a picture on the image host; if the host blocks it, the link opens the picture
    var a=this; if(!window.fetch||!window.URL||!URL.createObjectURL) return; e.preventDefault();
    fetch(a.href,{mode:'cors'}).then(function(r){ if(!r.ok) throw 0; return r.blob(); }).then(function(b){
      var u=URL.createObjectURL(b), t=document.createElement('a'); t.href=u; t.download=a.getAttribute('download'); document.body.appendChild(t); t.click(); t.remove(); setTimeout(function(){ URL.revokeObjectURL(u); },4000);
    }).catch(function(){ window.open(a.href,'_blank','noopener'); });
    ga('atlas_now_picture',{pic:picName()});
  });
  $('an-copy').addEventListener('click',function(){ var u=location.href; try{ navigator.clipboard.writeText(u).then(function(){ $('an-copied').textContent='Link copied.'; }); }catch(e){ $('an-copied').textContent=u; } });
  // a link inside the page that names an old layer (the foreign-held fold's "show it on the map")
  window.addEventListener('hashchange',function(){ var o=readHash(); if(!o) return; applyDeep(o); if(!o.l||LAY[SAME[o.l]||o.l]){ go(S.q,true); if(o.s) zoom(o.s); if(o.c) pick(o.c,true); }
    $('an-map').scrollIntoView({behavior:'smooth',block:'start'}); });
}
// the national folds lower on the page read the Atlas file: drawn the first time one is opened
function folds(){
  [].forEach.call(document.querySelectorAll('details[data-atlas-fold]'),function(d){
    d.addEventListener('toggle',function(){ if(!d.open||d.getAttribute('data-on')) return; d.setAttribute('data-on','1');
      oldList().then(function(){ window.AtlasLayers.national(); }).catch(function(){ d.removeAttribute('data-on'); }); }); });
}

Promise.all([get(D+'now.json'),get(D+'geo-us.json'),get(D+'counties-index.json').catch(function(){ return []; })]).then(function(res){
  NOW=res[0]; GEO=res[1];
  NOW.cols.forEach(function(c,i){ COL[c]=i; });
  NOW.rows.forEach(function(r){ ROWS[r[0]]=r; });
  NOW.layers.forEach(function(l){ LAY[l.key]=l; });
  (res[2]||[]).forEach(function(x){ IDX[x[0]]=[x[1],x[2]]; STATE_OF[x[0]]=String(x[1]).slice(-2); });
  buildMap(); wire(); tiles(); folds();
  var deep=readLink();
  if(S.m&&!LAY[S.m]&&!deep) deep={l:S.m};
  if(S.q&&!NOW.questions.some(function(x){return x.key===S.q;})) S.q='';
  root.classList.add('ready');
  var later=deep?applyDeep(deep):null;
  if(!later){ go(S.q,!!S.m); if(S.s) zoom(S.s); if(S.c) pick(S.c,true); if(deep&&deep.c) record(deep.c,'link'); }
  else { tabs(); side(); waitOld(S.m); }
}).catch(function(){
  var n=$('fa-nodata'); if(n) n.hidden=false;
  root.classList.add('failed');
});
})();
