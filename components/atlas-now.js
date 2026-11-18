/* atlas-now.js: the Farmland Atlas opening view (Nov 18, 2026). The national drought sentence, the county map and
   five questions (Weather, Land, Grain, Program, Risk); each question opens its headline map, and every detail map
   sits one tap down. Every figure and sentence comes from /farmland-atlas/data/now.json (built on main by
   scripts/atlas_now.py); geometry loads once from /farmland-atlas/data/geo-us.json. No figure is computed here
   except the county counts in each key, which count the rows of now.json. */
(function(){
'use strict';
var root=document.getElementById('an'); if(!root) return;
var D='/farmland-atlas/data/', NOW=null, GEO=null, IDX={}, ROWS={}, COL={}, LAY={}, PATHS={};
var S={q:'',m:'',s:'',c:''};
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function strong(sent){
  var t=esc(sent.t), ks=Object.keys(sent.src||{}).sort(function(a,b){return b.length-a.length;});
  ks.forEach(function(k){ if(/\d/.test(k)&&!/^(19|20)\d\d$/.test(k)&&!/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d/.test(k)) t=t.replace(esc(k),'<b>'+esc(k)+'</b>'); });
  return t;
}
function ga(n,p){ try{ if(window.gaEvent) window.gaEvent(n,p); }catch(e){} }
function get(u){ return fetch(u,{cache:'no-cache'}).then(function(r){ if(!r.ok) throw new Error(u); return r.json(); }); }

// ---------- values, bins and words
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
function cut(v,l){ if(l.unit==='$') return money(v,0); if(l.unit==='c') return (v<0?'-':'')+Math.round(Math.abs(v)*100)+'c'; if(l.unit==='x') return v.toFixed(2); return v+(l.unit==='%'?'%':l.unit==='F'?' F':''); }
var DRN=['Abnormally dry (D0)','Moderate (D1)','Severe (D2)','Extreme (D3)','Exceptional (D4)'];
// class of one county on one layer: k0..k6 a bin, kn grey (none), kx hatched (a gap with a reason)
function cls(f,l){
  var v=val(f,l), g=gap(f,l);
  if(l.key==='drought'){ if(v==null) return 'kx'; return v<0?'kn':'k'+v; }
  if(l.scale==='count'&&v===0) return 'kn';
  if(v==null){ if(g==='none'&&(l.key==='basis')) return 'kn'; return 'kx'; }
  var i=0; while(i<l.cuts.length&&v>=l.cuts[i]) i++;
  if(l.scale==='count') i=Math.max(0,i-1);
  return 'k'+i;
}
function keyItems(l){
  var out=[], n={}, f;
  for(f in ROWS){ var c=cls(f,l); n[c]=(n[c]||0)+1; }
  if(l.key==='drought'){
    out.push(['kn','None',n.kn]); for(var i=0;i<5;i++) out.push(['k'+i,DRN[i],n['k'+i]]);
  }else{
    var cs=l.cuts.slice(); if(l.scale==='count'){ out.push(['kn','None within 30 miles',n.kn]); cs=cs.slice(1); }
    if(l.scale==='rain'){ out.push(['k0','Under '+cs[0]+'%',n.k0]); for(var j=1;j<cs.length;j++) out.push(['k'+j,cs[j-1]+' to '+cs[j]+'%',n['k'+j]]); out.push(['k'+cs.length,cs[cs.length-1]+'% or more',n['k'+cs.length]]); }
    else if(cs.length){ out.push(['k0','Under '+cut(cs[0],l),n.k0]); for(var k=1;k<cs.length;k++) out.push(['k'+k,cut(cs[k-1],l)+' to '+cut(cs[k],l),n['k'+k]]); out.push(['k'+cs.length,cut(cs[cs.length-1],l)+' or more',n['k'+cs.length]]); }
    if(l.key==='basis') out.push(['kn',l.gaps.none,n.kn]);
  }
  var gx={}; for(f in ROWS){ if(cls(f,l)==='kx'){ var g=gap(f,l)||'nodata'; gx[g]=(gx[g]||0)+1; } }
  Object.keys(gx).forEach(function(g){ out.push(['kx',(l.gaps&&l.gaps[g])||'No figure',gx[g]]); });
  return out.filter(function(x){ return x[2]; });
}
function line(f,l){
  var v=val(f,l), g=gap(f,l);
  if(l.key==='drought') return v==null?((l.gaps&&l.gaps[g])||'No county figure'):(v<0?'No drought level covers half the county':DRN[v]+' covers at least half the county');
  if(v==null) return (l.gaps&&l.gaps[g])||'No figure';
  return l.label+': '+show(v,l)+(l.key==='basis'?' '+NOW.dates.basis_vs+' futures':'');
}

// ---------- the map
var SVGNS='http://www.w3.org/2000/svg';
function buildMap(){
  var svg=$('an-svg'), g=document.createElementNS(SVGNS,'g'), st=document.createElementNS(SVGNS,'g');
  svg.setAttribute('viewBox',GEO.vb.join(' '));
  Object.keys(GEO.c).forEach(function(f){ var p=document.createElementNS(SVGNS,'path'); p.setAttribute('d',GEO.c[f]); p.setAttribute('data-f',f); g.appendChild(p); PATHS[f]=p; });
  g.setAttribute('class','an-c'); st.setAttribute('class','an-s');
  Object.keys(GEO.s).forEach(function(k){ var p=document.createElementNS(SVGNS,'path'); p.setAttribute('d',GEO.s[k]); st.appendChild(p); });
  svg.appendChild(g); svg.appendChild(st);
  var hl=document.createElementNS(SVGNS,'path'); hl.setAttribute('class','an-hl'); hl.id='an-hl'; svg.appendChild(hl);
  svg.addEventListener('click',function(e){ var f=e.target&&e.target.getAttribute&&e.target.getAttribute('data-f'); if(f){ pick(f); ga('atlas_now_county',{fips:f}); } });
}
function paint(){
  var l=LAY[S.m]; $('an-svg').setAttribute('data-scale',l.scale);
  for(var f in PATHS) PATHS[f].setAttribute('class',cls(f,l));
  $('an-maptitle').textContent=l.label;
  $('an-legend').innerHTML=strong(l.legend);
  var cs=getComputedStyle(root);
  $('an-key').innerHTML=keyItems(l).map(function(x){ var bg=/^k\d$/.test(x[0])?' style="background:'+cs.getPropertyValue('--an-'+l.scale+'-'+x[0]).trim()+'"':'';
    return '<li><i class="'+x[0]+'"'+bg+'></i>'+esc(x[1])+' <b>'+Number(x[2]).toLocaleString('en-US')+'</b></li>'; }).join('');
  $('an-svg').setAttribute('aria-label','County map: '+l.label);
  if(S.c) pick(S.c,true);
}
function zoom(st){
  S.s=st&&GEO.box[st]?st:''; var vb=GEO.vb;
  if(S.s){ var b=GEO.box[S.s], w=b[2]-b[0], h=b[3]-b[1], p=Math.max(w,h)*.06, W=w+2*p, H=h+2*p, r=vb[2]/vb[3];
    if(W/H<r) W=H*r; else H=W/r; vb=[(b[0]+b[2])/2-W/2,(b[1]+b[3])/2-H/2,W,H]; }
  $('an-svg').setAttribute('viewBox',vb.map(function(v){return Math.round(v*10)/10;}).join(' '));
  $('an-svg').classList.toggle('zoomed',!!S.s); $('an-st').value=S.s; $('an-all').hidden=!S.s;
  setLink(); save();
}
function pick(f,quiet){
  if(!ROWS[f]) return; S.c=f; var l=LAY[S.m], i=IDX[f], hl=$('an-hl');
  hl.setAttribute('d',GEO.c[f]||'');
  var name=i?i[0]:f, stc=GEO.box[STATE_OF[f]]?STATE_OF[f]:null;
  $('an-read').innerHTML='<b>'+esc(name)+'</b>: '+esc(line(f,l))+'. '+(i?'<a href="'+esc(i[1])+'">Open the county page</a>':'')+
    (stc&&S.s!==stc?' <button type="button" id="an-zst">Zoom to '+esc(NOW.states[stc]&&NOW.states[stc].name||stc)+'</button>':'');
  var z=$('an-zst'); if(z) z.addEventListener('click',function(){ zoom(stc); ga('atlas_now_state',{state:stc}); });
  if(!quiet){ setLink(); save(); }
}
var STATE_OF={};

// ---------- the questions
function thumbs(){
  if(!window.Path2D) return;
  var cs=getComputedStyle(root);
  [].forEach.call(root.querySelectorAll('canvas[data-layer]'),function(cv){
    var l=LAY[cv.getAttribute('data-layer')], scale=l.scale, x=cv.getContext('2d'), vb=GEO.vb, k=cv.width/vb[2];
    x.setTransform(k,0,0,k,-vb[0]*k,-vb[1]*k); x.clearRect(vb[0],vb[1],vb[2],vb[3]);
    var col={}; function c(n){ if(!col[n]) col[n]=cs.getPropertyValue('--an-'+scale+'-'+n).trim()||cs.getPropertyValue('--an-'+n).trim()||'#888'; return col[n]; }
    for(var f in GEO.c){ var n=cls(f,l); x.fillStyle=n==='kx'?c('gap-line'):n==='kn'?c('none'):c(n); x.fill(new Path2D(GEO.c[f])); }
  });
}
function side(){
  var box=$('an-side'), h='';
  if(!S.q){
    h='<h2 class="an-qh">Pick a question</h2><div class="an-qgrid">'+NOW.questions.map(function(q){
      return '<button type="button" class="an-qcard" data-q="'+q.key+'"><canvas width="166" height="113" data-layer="'+q.head+'" aria-hidden="true"></canvas><span><b class="an-ql">'+esc(q.label)+'</b><span class="an-qq">'+esc(q.ask)+'</span><span class="an-qa">'+strong(NOW.say[q.key])+'</span></span></button>';
    }).join('')+'</div>';
  }else{
    var q=NOW.questions.filter(function(x){return x.key===S.q;})[0];
    h='<p class="an-ask">'+esc(q.ask)+'</p><p class="an-ans">'+strong(NOW.say[q.key])+'</p>'+(NOW.say[q.key+'_sub']?'<p class="an-ans2">'+strong(NOW.say[q.key+'_sub'])+'</p>':'')+
      '<h2 class="an-qh">Maps one tap down</h2><div class="an-dl">'+NOW.layers.filter(function(l){return l.q===S.q;}).map(function(l){
        return '<button type="button" class="an-dbtn" data-m="'+l.key+'" aria-pressed="'+(l.key===S.m)+'"><canvas width="96" height="65" data-layer="'+l.key+'" aria-hidden="true"></canvas><span>'+esc(l.label)+(l.key===q.head?' <small>headline</small>':'')+'</span></button>';
      }).join('')+'</div>';
  }
  box.innerHTML=h;
  [].forEach.call(box.querySelectorAll('[data-q]'),function(b){ b.addEventListener('click',function(){ go(b.getAttribute('data-q')); ga('atlas_now_question',{q:b.getAttribute('data-q')}); }); });
  [].forEach.call(box.querySelectorAll('[data-m]'),function(b){ b.addEventListener('click',function(){ S.m=b.getAttribute('data-m'); paint(); side(); setLink(); save(); ga('atlas_now_layer',{layer:S.m}); }); });
  thumbs();
}
function tabs(){
  [].forEach.call(root.querySelectorAll('.an-tab'),function(b){ var on=b.getAttribute('data-q')===S.q; b.setAttribute('aria-pressed',on?'true':'false'); });
}
function go(q,keepM){
  S.q=q||''; if(!keepM||!LAY[S.m]||(S.q&&LAY[S.m].q!==S.q)) S.m=S.q?NOW.questions.filter(function(x){return x.key===S.q;})[0].head:'drought';
  tabs(); paint(); side(); setLink(); save();
}

// ---------- links and the picture
function setLink(){
  var p=[]; if(S.q) p.push('q='+S.q); if(S.m&&S.m!=='drought'&&!(S.q&&LAY[S.m].q===S.q&&NOW.questions.filter(function(x){return x.key===S.q;})[0].head===S.m)) p.push('m='+S.m);
  if(S.s) p.push('s='+S.s); if(S.c) p.push('c='+S.c);
  try{ history.replaceState(history.state,'',location.pathname+(p.length?'?'+p.join('&'):'')+location.hash); }catch(e){}
}
function readLink(){
  (location.search||'').replace(/^\?/,'').split('&').forEach(function(kv){ var a=kv.split('='), k=a[0], v=decodeURIComponent(a[1]||'');
    if(k==='q'&&/^[a-z]+$/.test(v)) S.q=v; if(k==='m'&&/^[a-z]+$/.test(v)) S.m=v; if(k==='s'&&/^[A-Z]{2}$/.test(v)) S.s=v; if(k==='c'&&/^\d{5}$/.test(v)) S.c=v; });
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
  $('an-pic').addEventListener('click',function(e){
    // a same-tab download of a picture on the image host; if the host blocks it, the link opens the picture
    var a=this; if(!window.fetch||!window.URL||!URL.createObjectURL) return; e.preventDefault();
    fetch(a.href,{mode:'cors'}).then(function(r){ if(!r.ok) throw 0; return r.blob(); }).then(function(b){
      var u=URL.createObjectURL(b), t=document.createElement('a'); t.href=u; t.download=a.getAttribute('download'); document.body.appendChild(t); t.click(); t.remove(); setTimeout(function(){ URL.revokeObjectURL(u); },4000);
    }).catch(function(){ window.open(a.href,'_blank','noopener'); });
    ga('atlas_now_picture',{pic:picName()});
  });
  $('an-copy').addEventListener('click',function(){ var u=location.href; try{ navigator.clipboard.writeText(u).then(function(){ $('an-copied').textContent='Link copied.'; }); }catch(e){ $('an-copied').textContent=u; } });
}

Promise.all([get(D+'now.json'),get(D+'geo-us.json'),get(D+'counties-index.json').catch(function(){ return []; })]).then(function(res){
  NOW=res[0]; GEO=res[1];
  NOW.cols.forEach(function(c,i){ COL[c]=i; });
  NOW.rows.forEach(function(r){ ROWS[r[0]]=r; });
  NOW.layers.forEach(function(l){ LAY[l.key]=l; });
  (res[2]||[]).forEach(function(x){ IDX[x[0]]=[x[1],x[2]]; STATE_OF[x[0]]=String(x[1]).slice(-2); });
  $('an-lede').innerHTML=strong(NOW.say.lede); $('an-sub').innerHTML=strong(NOW.say.lede_sub);
  buildMap(); wire(); readLink();
  if(S.m&&!LAY[S.m]) S.m=''; if(S.q&&!NOW.questions.some(function(x){return x.key===S.q;})) S.q='';
  root.classList.add('ready'); go(S.q,!!S.m); if(S.s) zoom(S.s); if(S.c) pick(S.c,true);
}).catch(function(){
  $('an-lede').textContent='The opening map did not load.'; $('an-sub').innerHTML='Every layer is still on the full map below, and every county has its own page in the <a href="/farmland-atlas/states/">county directory</a>.';
  root.classList.add('failed');
});
})();
