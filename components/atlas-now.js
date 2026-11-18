/* atlas-now.js: the Farmland Atlas map (Nov 18, 2026; batch 2 the same day). Five headline tiles, the county map and
   five questions (Weather, Land, Grain, Program, Risk); each question opens its headline map, and every detail map
   sits one tap down. Every figure and sentence of the headline maps comes from /farmland-atlas/data/now.json (built
   on main by scripts/atlas_now.py); geometry loads once from /farmland-atlas/data/geo-us.json.
   Batch 2 folds the old second map ("Every layer") into this one: its layers are listed under the questions and
   drawn here, from their own rules in components/atlas-layers.js (loaded the first time one is opened). Old links
   (#l=<layer>, #s=<state>, #<county code>) open the same layer, state and county here.
   Legend rules, every layer: at most six bins, grey for none, a hatch for no figure, an empty state outline where we
   do not read a state; two-colour scales only for rain against normal and basis. The only figures computed here are
   the counts in each key, the bin edges of the folded layers (quantiles of their own values), and the old map's reader
   tools restored under the map (Nov 18, batch 2 review): the ranked lists (Highest and Lowest in the US or the state,
   farm counties only), a state's own scale when zoomed (or the US scale), the decade map's reference line, and the
   counts beside each; plus My county, the full county record jump, and the sources and vintages with the build day.
   Batch 2, PR B adds fourteen maps to now.json (soybean basis, CRP ending this fiscal year, frost-free days, corn GDD,
   land rented, rent change, tile, cover crops, cattle, solar and wind proposed, foreign-held acres, hail and wind days,
   claims from heat and drought). Their column holds the figure or a gap code; "zero" names a 0 drawn grey, "kn" a gap
   drawn grey, "cover" an unread state drawn as an outline.
   Batch 2, PR C2 adds ARC-CO for soybeans and wheat under Program; a layer's "dp" sets the decimal places it prints.
   It also adds ARC-CO minus PLC for corn (unit "gd", scale "arcplc"): orange where PLC has the higher estimate, blue
   where ARC-CO has, grey within a dollar; the key names each side (gapKey). */
/* Nov 18: with a state open, the key counts that state's counties and says so ("Iowa counties"), the
   ranked lists give one sentence when every county ties, and the picture button names the map it saves and shows
   only when that picture exists (drought: the U.S. or the state; land value: the county); every other map offers
   "Copy link to this map", the old-style #l=, #s= link. */
(function(){
'use strict';
var root=document.getElementById('an'); if(!root) return;
var D='/farmland-atlas/data/', NOW=null, GEO=null, IDX={}, ROWS={}, COL={}, LAY={}, PATHS={}, HAS={}, STATE_OF={};
var S={q:'',m:'',s:'',c:'',sc:'st'}, OLD=null, OLDP=null, OL={}, DEC=null, DEEP=null;
// the old map's layers that are the same figure as a headline map open that map
var SAME={val:'value',rent:'rent',sob_cost:'cost',sob_10:'lr',yield_worst:'worst',water_irr:'irr',dr_share:'dweeks',heat_recent:'heat',
  fr_ffd:'ffd',fr_gdd:'gdd',st_hail:'hail',st_wind:'wind',rent_change:'rentchg',loss_hd:'claims',pr_tile:'tile',pr_cover:'cover',afida:'foreign'};
// an old layer that is the same figure as a new map but keeps its own link (#l=ten_rent prints the national rented
// line beside its legend): it opens as before, and is left out of "More maps" so the figure is listed once
var HIDE={ten_rent:1};
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
// a county's figure (a number) and its gap code (a word); the newer maps keep both in one column, never both at once
function val(f,l){ var r=ROWS[f], v=r?r[COL[l.col]]:null; return typeof v==='number'?v:null; }
function gap(f,l){ var r=ROWS[f], g=r&&l.gcol?r[COL[l.gcol]]:null; return typeof g==='string'?g:null; }
function money(v,dp){ return '$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:dp,maximumFractionDigits:dp}); }
function dp(l){ return l.dp!=null?l.dp:l.key==='arc'||l.key==='prf'||l.key==='cost'?2:0; }
function n0(v){ return Number(v).toLocaleString('en-US',{maximumFractionDigits:2}); }
function show(v,l){
  if(l.unit==='$') return money(v,dp(l));
  if(l.unit==='ac') return n0(v)+' acres';
  if(l.unit==='d') return n0(v)+' days';
  if(l.unit==='gdd') return n0(v)+' GDD';
  if(l.unit==='pc') return (v>0?'+':'')+(Math.round(v*10)/10)+'%';
  if(l.unit==='hd') return n0(v)+' per 1,000 acres';
  if(l.unit==='mw') return n0(v)+' MW';
  if(l.unit==='%') return v>0&&v<0.05?'under 0.1%':(Math.round(v*10)/10)+'%';
  if(l.unit==='F') return v.toFixed(1)+' F';
  if(l.unit==='c'){ var c=Math.round(Math.abs(v)*100); return c?c+(c===1?' cent ':' cents ')+(v<0?'under':'over'):'even'; }
  if(l.unit==='x') return v.toFixed(2);
  if(l.unit==='gd') return v>0?'ARC-CO higher by '+money(v,2):v<0?'PLC higher by '+money(-v,2):'even';
  return String(v);
}
function cut(v,l){ if(l.unit==='$'||l.unit==='gd') return money(Math.abs(v),0); if(l.unit==='c') return cents(v); if(l.unit==='x') return v.toFixed(2);
  if(l.unit==='ac') return n0(v)+' acres'; if(l.unit==='d') return n0(v)+' days'; if(l.unit==='mw') return n0(v)+' MW';
  if(l.unit==='gdd'||l.unit==='hd') return n0(v); if(l.unit==='pc') return (v>0?'+':'')+v+'%';
  return v+(l.unit==='%'?'%':l.unit==='F'?' F':''); }
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
// ARC-CO minus PLC: five bins around even, orange where PLC has the higher estimate, blue where ARC-CO has
function gapKey(cs,n,l){
  return [['k0','PLC higher by more than '+cut(cs[0],l),n.k0],['k1','PLC higher by '+cut(cs[1],l)+' to '+cut(cs[0],l),n.k1],
    ['k2','Within '+cut(cs[2],l)+' either way',n.k2],['k3','ARC-CO higher by '+cut(cs[2],l)+' to '+cut(cs[3],l),n.k3],['k4','ARC-CO higher by '+cut(cs[3],l)+' or more',n.k4]];
}
var DRN=['Abnormally dry (D0)','Moderate (D1)','Severe (D2)','Extreme (D3)','Exceptional (D4)'];
// partial layers: a state we do not read is an empty outline (ko), not a few hundred hatched counties
var COVER={sale:1,basis:1,near:1};
// class of one county on one layer: k0..k5 a bin, kn grey (none), kx hatched (a gap with a reason), ko a state we do not read
// zoomed to a state, a one-hue map takes that state's own bins (Iowa at national bins is one pale block); the counties
// of other states drop out of the colours (kz). The reader can switch back to the US scale (S.sc)
var LOCAL=null;
function cutsOf(l){ return LOCAL&&LOCAL.key===l.key?LOCAL.cuts:l.cuts; }
function outOf(f){ return !!(LOCAL&&(STATE_OF[f]||f.slice(0,2))!==LOCAL.st); }
function canLocal(l){
  if(!S.s||!l) return false;
  if(l.old){ var d=OL[l.key]; if(!d||d.div||l.scale==='rain'||d.salesWords) return false; }
  else if(['money','risk','share','heat','green','amount'].indexOf(l.scale)<0) return false;
  return inState(l).length>=20;
}
function rv(f,l){ return l.old?(OL[l.key]?OL[l.key].vals[f]:null):val(f,l); }
function inState(l){ var a=[], f, v; for(f in HAS){ if((STATE_OF[f]||f.slice(0,2))!==S.s) continue; v=rv(f,l); if(v==null||isNaN(v)) continue; if((l.old&&l.zeroNone||l.zero)&&v===0) continue; a.push(v); } return a; }
function setLocal(l){
  LOCAL=null; var box=$('an-scl'); if(!box) return;
  var can=canLocal(l); box.hidden=!can;
  if(!can) return;
  var nm=NOW.states[S.s]&&NOW.states[S.s].name||S.s;
  box.querySelector('[data-sc="st"]').textContent=nm+' scale';
  [].forEach.call(box.querySelectorAll('button'),function(b){ b.setAttribute('aria-pressed',b.getAttribute('data-sc')===S.sc?'true':'false'); });
  $('an-scl-note').textContent=S.sc==='st'?'Colors set for '+nm+' alone; other states are grey.':'Colors on the US scale; the key counts '+nm+' counties.';
  if(S.sc!=='st') return;
  var a=inState(l).sort(function(x,y){return x-y;});
  LOCAL={key:l.key, st:S.s, cuts:qcuts(a,l.old&&OL[l.key].doy)};
}
function cls(f,l){
  if(outOf(f)) return 'kz';
  if(l.old) return ocls(f,l);
  var v=val(f,l), g=gap(f,l);
  if(l.key==='drought'){ if(v==null) return 'kx'; return v<0?'kn':'k'+v; }
  if(g==='nost'&&(COVER[l.key]||l.cover)) return 'ko';
  if((l.scale==='count'||l.zero)&&v===0) return 'kn';
  if(v==null){ if(g==='none'&&(l.key==='basis')||l.kn&&g===l.kn) return 'kn'; return 'kx'; }
  var cs=cutsOf(l), i=0; while(i<cs.length&&v>=cs[i]) i++;
  if(l.scale==='count') i=Math.max(0,i-1);
  return 'k'+i;
}
// the counties in view: the open state's, or every county
function inView(f){ return !S.s||(STATE_OF[f]||f.slice(0,2))===S.s; }
function viewName(){ return S.s?(NOW.states[S.s]&&NOW.states[S.s].name||S.s):'U.S.'; }
function count(l){ var n={}, f; for(f in HAS){ if(!inView(f)) continue; var c=cls(f,l); if(c!=='kz') n[c]=(n[c]||0)+1; } return n; }
function outStates(l){ var o={}, f; for(f in HAS) if(inView(f)&&cls(f,l)==='ko') o[(STATE_OF[f]||f.slice(0,2))]=1; return Object.keys(o).length; }
function keyItems(l){
  var out=[], n=count(l), f;
  if(l.old) return okeyItems(l,n);
  if(l.key==='drought'){
    out.push(['kn','None',n.kn]); for(var i=0;i<5;i++) out.push(['k'+i,DRN[i],n['k'+i]]);
  }else{
    var cs=cutsOf(l).slice(); if(l.scale==='count'){ out.push(['kn','None within 30 miles',n.kn]); cs=cs.slice(1); }
    if(l.zero) out.push(['kn',l.zero,n.kn]);
    if(l.scale==='rain'){ out.push(['k0','Under '+cs[0]+'%',n.k0]); for(var j=1;j<cs.length;j++) out.push(['k'+j,cs[j-1]+' to '+cs[j]+'%',n['k'+j]]); out.push(['k'+cs.length,cs[cs.length-1]+'% or more',n['k'+cs.length]]); }
    else if(l.unit==='c'&&cs.length){ out=out.concat(basisKey(cs,n)); }
    else if(l.unit==='gd'&&cs.length===4){ out=out.concat(gapKey(cs,n,l)); }
    else if(cs.length){ out.push(['k0','Under '+cut(cs[0],l),n.k0]); for(var k=1;k<cs.length;k++) out.push(['k'+k,cut(cs[k-1],l)+' to '+cut(cs[k],l),n['k'+k]]); out.push(['k'+cs.length,cut(cs[cs.length-1],l)+' or more',n['k'+cs.length]]); }
    if(l.kn) out.push(['kn',l.gaps[l.kn],n.kn]);
  }
  var gx={}; for(f in HAS){ if(inView(f)&&!outOf(f)&&cls(f,l)==='kx'){ var g=gap(f,l)||'nodata'; gx[g]=(gx[g]||0)+1; } }
  Object.keys(gx).forEach(function(g){ out.push(['kx',(l.gaps&&l.gaps[g])||'No figure',gx[g]]); });
  if(n.ko) out.push(['ko','States we do not read',outStates(l),'states']);
  return out.filter(function(x){ return x[2]; });
}
function line(f,l){
  var v=val(f,l), g=gap(f,l);
  if(l.key==='drought') return v==null?((l.gaps&&l.gaps[g])||'No county figure'):(v<0?'No drought level covers half the county':DRN[v]+' covers at least half the county');
  if(v==null) return (l.gaps&&l.gaps[g])||'No figure';
  if(l.zero&&v===0) return l.label+': '+l.zero.toLowerCase();
  return l.label+': '+show(v,l)+(l.key==='basis'?' '+NOW.dates.basis_vs+' futures':l.key==='sbasis'?' '+NOW.dates.sbasis_vs+' futures':'');
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
  return {scale:scale,cuts:qcuts(a,d.doy),zeroNone:zeroNone};
}
// five classes of about the same number of counties, edges rounded to a figure a reader can say (a: sorted values)
function qcuts(a,doy){
  var cuts=[];
  if(a.length>=10){
    var lo=a[0], hi=a[a.length-1];
    for(var i=1;i<5;i++){ var p=(a.length-1)*i/5, x=a[Math.floor(p)]+(a[Math.ceil(p)]-a[Math.floor(p)])*(p-Math.floor(p));
      var g=Math.max((hi-lo)/50,Math.abs(x)*0.02)||1, c=doy?Math.round(x):nice(x,g);
      if(!cuts.length||c>cuts[cuts.length-1]) cuts.push(c); }
    if(cuts.length&&cuts[0]<=lo) cuts.shift();
  }
  return cuts;
}
function ocls(f,l){
  var d=OL[l.key]; if(!d) return 'kx';
  if(d.cls[f]) return d.cls[f];
  var v=d.vals[f];
  if(v==null) return d.outSt[STATE_OF[f]||f.slice(0,2)]?'ko':'kx';
  if(l.zeroNone&&v===0) return 'kn';
  var cs=cutsOf(l), i=0; while(i<cs.length&&v>=cs[i]) i++;
  return 'k'+i;
}
function oshort(l,v){ return window.AtlasLayers?window.AtlasLayers.short(l.key,v):String(v); }
function okeyItems(l,n){
  var out=[], cs=cutsOf(l), d=OL[l.key], w=d.salesWords;
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
      var s=document.createElement('script'); s.src='/components/atlas-layers.js?v=2'; s.onload=function(){ ok(); }; s.onerror=function(){ OLDP=null; no(new Error('layers')); };
      document.head.appendChild(s);
    }).then(function(){
      var names={}; for(var k in NOW.states) names[k]=NOW.states[k].name;
      return window.AtlasLayers.boot({paths:HAS, names:names, pick:function(f){ pick(f,true,true); }, toMap:function(){ $('an-map').scrollIntoView({behavior:'smooth',block:'start'}); }, panelHost:function(){ return $('an-panel'); }});
    }).then(function(api){
      OLD={};
      api.list().forEach(function(x){ if(SAME[x.key]||!QOF[x.grp]) return; OLD[x.key]={key:x.key, old:true, q:QOF[x.grp], label:x.label, grp:x.grp, off:x.off||!!HIDE[x.key], slider:x.slider}; });
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
  if(l.old&&!OL[l.key]){ save(); waitOld(l.key); return; }
  setLocal(l);
  $('an-svg').setAttribute('data-scale',l.scale); $('an-svg').removeAttribute('data-hk');
  var hit=l.slider?heatLine():null;
  for(var f in PATHS) PATHS[f].setAttribute('class',cls(f,l)+(hit&&hit[f]?' line':''));
  $('an-maptitle').textContent=l.label;
  var leg=l.old?(OL[l.key].natline||'')+'<span>'+esc(OL[l.key].title)+'.</span> '+(OL[l.key].why?'<span>'+esc(OL[l.key].why)+'.</span> ':'')+(OL[l.key].note||''):strong(l.legend);
  $('an-legend').innerHTML=leg;
  // the rented map brings the census tenure table with it, as the old rented layer did (the fold under the map)
  if(l.key==='rented'){ var tf=$('fa-tenure'); if(tf&&!tf.open) tf.open=true; }
  var cs=getComputedStyle(root);
  // each swatch is a button: it lights that class's counties on the map (the old map's swatches)
  var ph=!!(window.matchMedia&&matchMedia('(max-width:699px)').matches);
  $('an-key').innerHTML='<li class="an-kh">'+esc(viewName())+' counties</li>'+keyItems(l).map(function(x){ var bg=/^k\d$/.test(x[0])?' style="background:'+cs.getPropertyValue('--an-'+l.scale+'-'+x[0]).trim()+'"':'';
    var t=x[1]+' '+Number(x[2]).toLocaleString('en-US')+(x[3]?' '+x[3]:'');
    return '<li><button type="button" data-k="'+x[0]+'" aria-pressed="false" aria-label="Show '+esc(t)+' on the map"><i class="'+x[0]+'"'+bg+'></i>'+esc(ph?(l.key==='drought'&&/^k\d$/.test(x[0])?DRS[+x[0].slice(1)]:shortLab(x[1])):x[1])+' <b>'+Number(x[2]).toLocaleString('en-US')+'</b></button></li>'; }).join('');
  $('an-key').scrollLeft=0;
  $('an-svg').setAttribute('aria-label','County map: '+l.label);
  var dw=$('an-dec'); dw.hidden=!l.slider;
  if(l.slider&&!dw.options.length){ window.AtlasLayers.decades.forEach(function(t,i){ var o=document.createElement('option'); o.value=i; o.textContent=t; dw.appendChild(o); }); dw.value=DEC==null?window.AtlasLayers.decades.length-1:DEC; }
  root.classList.remove('waiting');
  if(S.c) pick(S.c,true); else rail();
  save(); vcount();
}
// on a phone a range reads "21-30%" (en dash) and a drought level by its Drought Monitor code ("D1"), so the key takes
// three rows on the common maps and each swatch stays a full 24 px tap; the button's label keeps the full words
var DRS=['D0','D1','D2','D3','D4'];
function shortLab(t){ var m=/^(\$?[\d.,]+)([%\u00a2]?) to (\$?[\d.,]+)([%\u00a2]?)(.*)$/.exec(t); return m?m[1]+(m[2]&&m[2]===m[4]?'':m[2])+'\u2013'+m[3]+m[4]+m[5]:t; }
var KEYPIN=null;
function wireKey(){
  var box=$('an-key'), svg=$('an-svg');
  function show(k){ if(k) svg.setAttribute('data-hk',k); else svg.removeAttribute('data-hk'); }
  box.addEventListener('click',function(e){ var b=e.target.closest&&e.target.closest('button[data-k]'); if(!b) return; var k=b.getAttribute('data-k');
    KEYPIN=KEYPIN===k?null:k; [].forEach.call(box.querySelectorAll('button[data-k]'),function(x){ x.setAttribute('aria-pressed',x.getAttribute('data-k')===KEYPIN?'true':'false'); }); show(KEYPIN); });
  box.addEventListener('mouseover',function(e){ var b=e.target.closest&&e.target.closest('button[data-k]'); if(b&&!KEYPIN) show(b.getAttribute('data-k')); });
  box.addEventListener('mouseleave',function(){ show(KEYPIN); });
}
// the decade map's reference line: counties at or above it get an outline, and the line under the map counts them
function heatLine(){
  var w=$('an-linew'), note=$('an-line-note'); if(!window.AtlasLayers||!window.AtlasLayers.heatLine) return null;
  var line=Number($('an-line').value), r=window.AtlasLayers.heatLine(line);
  w.hidden=false;
  note.textContent=r.n?r.at.toLocaleString('en-US')+' of '+r.n.toLocaleString('en-US')+' counties at or above '+line+' F in the '+r.decade+' (outlined)':'';
  return r.hit;
}

// ---------- the ranked lists: highest and lowest in the US or the zoomed state, on every map. Farm counties only
// (10,000 acres or more in farms, 2022 census: the old map's rule); a rent map ranks within its newest survey year
var RAIL_MORE=false;
function rword(l,v){
  if(l.old) return window.AtlasLayers?window.AtlasLayers.fmt(l.key,v):String(v);
  if(l.key==='drought') return v<0?'No drought':DRN[v];
  return show(v,l);
}
function railList(l){
  var fi=COL.farm, list=[], f, v, yr=null;
  if(l.old&&window.AtlasLayers&&window.AtlasLayers.rlatest) yr=window.AtlasLayers.rlatest(l.key);
  for(f in HAS){ if(S.s&&(STATE_OF[f]||f.slice(0,2))!==S.s) continue;
    var r=ROWS[f]; if(!r||r[fi]!==1) continue;
    v=rv(f,l); if(v==null||isNaN(v)) continue;
    if(yr&&window.AtlasLayers.ryear(l.key,f)!==yr) continue;
    list.push({f:f,v:v}); }
  list.sort(function(a,b){ return b.v-a.v||(a.f<b.f?-1:1); });
  return {list:list, yr:yr};
}
function rail(){
  var box=$('an-rail'); if(!box) return; var l=layerOf(S.m);
  if(!l||(l.old&&!OL[l.key])){ box.innerHTML=''; return; }
  var scope=S.s?(NOW.states[S.s]&&NOW.states[S.s].name||S.s):'the US', doy=l.old&&OL[l.key].doy;
  var hi=doy?'Latest':'Highest', lo=doy?'Earliest':'Lowest', h='';
  if(!NOW.farm||COL.farm==null){ box.innerHTML='<p class="an-rk-n">No ranking: the census farm-acres file did not load, and without it cities would rank as farm counties.</p>'; return; }
  var R=railList(l), list=R.list, n=list.length, k=Math.min(RAIL_MORE?15:8,Math.floor(n/2)), cs=getComputedStyle(root);
  function row(r){ var c=PATHS[r.f]?String(PATHS[r.f].getAttribute('class')||'').split(' ')[0]:'kx', bg=/^k\d$/.test(c)?cs.getPropertyValue('--an-'+l.scale+'-'+c).trim():'';
    var nm=IDX[r.f]?IDX[r.f][0]:r.f; if(S.s) nm=nm.replace(/, [A-Z]{2}$/,'');
    return '<li><button type="button" data-f="'+r.f+'"'+(r.f===S.c?' class="me" aria-current="true"':'')+'><i class="'+c+'"'+(bg?' style="background:'+bg+'"':'')+'></i><span class="nm">'+esc(nm)+'</span><span class="v">'+esc(rword(l,r.v))+'</span></button></li>'; }
  function side(head,rows,tiedAt,tied){ return '<div class="an-rk"><h3 class="an-rk-h">'+head+' in '+esc(scope)+'</h3>'+(tied>k?'<p class="an-rk-n">'+tied.toLocaleString('en-US')+' counties tied at '+esc(rword(l,tiedAt))+'.</p>':'<ol class="an-rk-l">'+rows.map(row).join('')+'</ol>')+'</div>'; }
  if(n<4) h='<p class="an-rk-n">'+(n?'Only '+n:'No')+' '+(n===1?'county':'counties')+' with 10,000 acres or more in farms in '+esc(scope)+' '+(n===1?'has':'have')+' a figure on this map'+(n?', too few to list':'')+'.</p>';
  else if(list[0].v===list[n-1].v) h='<p class="an-rk-n an-rk-tie">All '+n.toLocaleString('en-US')+' counties with 10,000 acres or more in farms in '+esc(scope)+' read the same: '+esc(rword(l,list[0].v))+'.</p>';
  else {
    var top=list[0].v, bot=list[n-1].v;
    h='<div class="an-rk2">'+side(hi,list.slice(0,k),top,list.filter(function(r){return r.v===top;}).length)+side(lo,list.slice(n-k).reverse(),bot,list.filter(function(r){return r.v===bot;}).length)+'</div>'
      +'<p class="an-rk-n">'+n.toLocaleString('en-US')+' counties with 10,000 acres or more in farms'+(!l.old&&l.key==='rent'&&NOW.dates.rent_year?', '+NOW.dates.rent_year+' survey':R.yr?', '+R.yr+(l.key==='rent_rev'?' crop year':' survey'):'')+'. '
      +(n>2*k||RAIL_MORE?'<button type="button" class="an-rk-more" id="an-rk-more" aria-expanded="'+(RAIL_MORE?'true':'false')+'">'+(RAIL_MORE?'Show fewer':'Show more')+'</button>':'')+'</p>';
  }
  box.innerHTML='<h2 class="an-rk-t">Counties on this map</h2>'+h;
  var mo=$('an-rk-more'); if(mo) mo.addEventListener('click',function(){ RAIL_MORE=!RAIL_MORE; rail(); var b=$('an-rk-more'); if(b) b.focus({preventScroll:true}); });
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
  if(NOW&&layerOf(S.m)&&(!layerOf(S.m).old||OL[S.m])) paint();
  setLink(); save();
}
function pick(f,quiet,fromRecord){
  if(!HAS[f]) return; S.c=f; var l=layerOf(S.m), i=IDX[f], hl=$('an-hl');
  hl.setAttribute('d',GEO.c[f]||'');
  var name=i?i[0]:f, stc=GEO.box[STATE_OF[f]]?STATE_OF[f]:null;
  var body=l&&l.old?(window.AtlasLayers?window.AtlasLayers.card(l.key,f):''):(l&&ROWS[f]?esc(line(f,l))+'.':'');
  $('an-read').innerHTML='<b>'+esc(name)+'</b>: '+body+' '+(i?'<a href="'+esc(i[1])+'">Open the county page</a>':'')+
    ' <button type="button" id="an-rec">Full county record \u2193</button>'+
    (stc&&S.s!==stc?' <button type="button" id="an-zst">Zoom to '+esc(NOW.states[stc]&&NOW.states[stc].name||stc)+'</button>':'');
  var z=$('an-zst'); if(z) z.addEventListener('click',function(){ zoom(stc); ga('atlas_now_state',{state:stc}); });
  $('an-rec').addEventListener('click',function(){ record(f,'jump'); });
  rail();
  save();
  if(!quiet){ setLink(); }
  if(fromRecord){ setLink(); }
  if(!quiet||fromRecord){ try{ document.dispatchEvent(new CustomEvent('atlas-county',{detail:f})); }catch(e){} }
}
function record(f,how){
  oldList().then(function(){ window.AtlasLayers.panel(f,how==='jump'?'tap':how); ga('atlas_now_record',{fips:f});
    // the jump: the record opens under the map and the page goes to it
    if(how==='jump') setTimeout(function(){ var p=$('fa-panel')||$('an-panel'); if(p) p.scrollIntoView({behavior:'smooth',block:'start'}); },60); }).catch(function(){
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
  [].forEach.call(box.querySelectorAll('[data-q]'),function(b){ b.addEventListener('click',function(){ ui(); go(b.getAttribute('data-q')); ga('atlas_now_question',{q:b.getAttribute('data-q')}); }); });
  [].forEach.call(box.querySelectorAll('[data-m]'),function(b){ b.addEventListener('click',function(){ ui(); S.m=b.getAttribute('data-m'); paint(); side(); setLink(); save(); ga('atlas_now_layer',{layer:S.m}); }); });
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
  [].forEach.call(box.querySelectorAll('.an-tile'),function(b){ b.addEventListener('click',function(){ ui(); go(b.getAttribute('data-q')); ga('atlas_now_tile',{q:b.getAttribute('data-q')}); }); });
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
// the pictures that exist: the drought map of the US or a state, and a county's land value picture. The button names
// the map it saves; on any other map there is no picture, and the link to this map takes its place
function pic(){
  if(!NOW.pics) return null;
  if(S.m==='drought'){ if(!S.s) return {n:'pic-us', t:'Save the U.S. drought picture'};
    return NOW.states[S.s]&&NOW.states[S.s].d1?{n:'pic-'+S.s.toLowerCase(), t:'Save the '+viewName()+' drought picture'}:null; }
  // the national ARC-CO minus PLC picture (batch 2, PR C2): the US view only, as the picture shows the whole country
  var arc=S.m==='arcgap'?'pic-arc-us':''; if(arc) return S.s?null:{n:arc, t:'Save the U.S. ARC-CO and PLC picture'};
  if(S.m==='value'&&S.c&&GEO.c[S.c]&&IDX[S.c]) return {n:'pic-'+S.c, t:'Save the '+IDX[S.c][0].replace(/, [A-Z]{2}$/,'')+' land value picture'};
  return null;
}
function picName(){ var p=pic(); return p?p.n:''; }
// the link to this map in the old map's words, which every version of the page reads: #l=<map>&s=<state>&<county>
function mapLink(){ return location.origin+location.pathname+'#l='+S.m+(S.s?'&s='+S.s:'')+(S.c?'&'+S.c:''); }
function save(){
  var a=$('an-pic'), c=$('an-copy'); if(!a) return;
  var p=pic(); a.hidden=!p; a.style.display=p?'':'none'; if(c) c.classList.toggle('pri',!p);
  if(!p) return;
  a.href=NOW.pics+p.n+'.png'; a.setAttribute('download','agsist-'+p.n+'.png'); a.textContent=p.t;
}
// the key holds the opening view's room while the page loads; once the reader changes the map or the state it fits its rows
function ui(){ root.classList.add('ui'); }
function wire(){
  [].forEach.call(root.querySelectorAll('.an-tab'),function(b){ b.addEventListener('click',function(){ ui(); go(b.getAttribute('data-q')); ga('atlas_now_question',{q:b.getAttribute('data-q')||'all'}); }); });
  var sel=$('an-st');
  Object.keys(GEO.box).sort(function(a,b){ var A=NOW.states[a]&&NOW.states[a].name||a, B=NOW.states[b]&&NOW.states[b].name||b; return A<B?-1:1; }).forEach(function(st){
    var o=document.createElement('option'); o.value=st; o.textContent=NOW.states[st]&&NOW.states[st].name||st; sel.appendChild(o); });
  sel.addEventListener('change',function(){ ui(); zoom(sel.value); if(sel.value) ga('atlas_now_state',{state:sel.value}); });
  $('an-all').addEventListener('click',function(){ ui(); zoom(''); });
  $('an-dec').addEventListener('change',function(){ DEC=Number(this.value); var k=S.m; delete OL[k]; paint(); });
  // the old map's reference lines, 60 to 70 F, 66 F first
  var ln=$('an-line'); [60,62,64,66,68,70].forEach(function(t){ var o=document.createElement('option'); o.value=o.textContent=t; if(t===66) o.selected=true; ln.appendChild(o); });
  $('an-line').addEventListener('change',function(){ paint(); ga('atlas_now_line',{line:this.value}); });
  [].forEach.call($('an-scl').querySelectorAll('button'),function(b){ b.addEventListener('click',function(){ S.sc=b.getAttribute('data-sc'); paint(); ga('atlas_now_scale',{sc:S.sc}); }); });
  wireKey();
  var rl=$('an-rail');
  rl.addEventListener('click',function(e){ var b=e.target.closest&&e.target.closest('button[data-f]'); if(b){ pick(b.getAttribute('data-f')); ga('atlas_now_rank',{fips:b.getAttribute('data-f')}); } });
  rl.addEventListener('mouseover',function(e){ var b=e.target.closest&&e.target.closest('button[data-f]'); var p=b&&PATHS[b.getAttribute('data-f')]; if(p) $('an-hl').setAttribute('d',GEO.c[b.getAttribute('data-f')]); });
  rl.addEventListener('mouseleave',function(){ $('an-hl').setAttribute('d',S.c&&GEO.c[S.c]||''); });
  mine(window.AGSIST_STATE&&window.AGSIST_STATE.fips||window.AGSIST_MINE);
  document.addEventListener('atlas-mine',function(e){ mine(e.detail); });
  $('an-pic').addEventListener('click',function(e){
    // a same-tab download of a picture on the image host; if the host blocks it, the link opens the picture
    var a=this; if(!window.fetch||!window.URL||!URL.createObjectURL) return; e.preventDefault();
    fetch(a.href,{mode:'cors'}).then(function(r){ if(!r.ok) throw 0; return r.blob(); }).then(function(b){
      var u=URL.createObjectURL(b), t=document.createElement('a'); t.href=u; t.download=a.getAttribute('download'); document.body.appendChild(t); t.click(); t.remove(); setTimeout(function(){ URL.revokeObjectURL(u); },4000);
    }).catch(function(){ window.open(a.href,'_blank','noopener'); });
    ga('atlas_now_picture',{pic:picName()});
  });
  $('an-copy').addEventListener('click',function(){ var u=mapLink(); try{ navigator.clipboard.writeText(u).then(function(){ $('an-copied').textContent='Link copied.'; }); }catch(e){ $('an-copied').textContent=u; } });
  // a link inside the page that names an old layer (the foreign-held fold's "show it on the map")
  window.addEventListener('hashchange',function(){ var o=readHash(); if(!o) return; applyDeep(o); if(!o.l||LAY[SAME[o.l]||o.l]){ go(S.q,true); if(o.s) zoom(o.s); if(o.c) pick(o.c,true); }
    $('an-map').scrollIntoView({behavior:'smooth',block:'start'}); });
}
// My county: the county saved on another page (AGSIST_STATE, or the saved location the finder reads), picked on the map
function mine(f){
  f=f&&String(f); var b=$('an-mine'); if(!b||!f||!HAS[f]||b.getAttribute('data-f')) return;
  b.setAttribute('data-f',f); b.hidden=false;
  b.addEventListener('click',function(){ pick(f); ga('atlas_now_mine',{fips:f}); });
}
// the sources and vintages, and the day the Atlas was built (now.json, from atlas.json's own notes)
function vint(){
  var b=$('an-built'); if(b&&NOW.built){ var d=new Date(String(NOW.built).slice(0,10)+'T12:00:00Z'); b.textContent=d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}); }
  vcount();
  var v=$('an-vint'); if(v&&NOW.vint) v.innerHTML=NOW.vint.map(function(t){ return '<li>'+esc(t)+'</li>'; }).join('');
}
// the county count beside the sources follows the view: every county, or the open state's
function vcount(){
  var n=$('an-n'), w=$('an-nw'), k=0, f; if(!n) return;
  if(S.s){ for(f in HAS) if(inView(f)) k++; } else k=NOW.rows.length;
  n.textContent=k.toLocaleString('en-US'); if(w) w.textContent=S.s?' '+viewName()+' counties':' counties';
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
  buildMap(); wire(); tiles(); folds(); vint();
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
