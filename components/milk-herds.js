/* Licensed dairy herds chart (fx/dairy3). Reads /data/dairy-herds.json only when
   the section comes near the screen. The state starts from the reader's saved
   place (agsist-wx-loc, written by geo.js, never sent anywhere), else the last
   state picked here. Every bar and point says its number and the net change. */
(function(){
  var NAMES={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'};
  var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var KEY='agsist-milk-herd-st';
  var $=function(id){return document.getElementById(id);};
  var sec=$('dp-herds'); if(!sec) return;
  function lget(k){try{return localStorage.getItem(k);}catch(e){return null;}}
  function lset(k,v){try{if(v)localStorage.setItem(k,v);else localStorage.removeItem(k);}catch(e){}}
  function saved(){var s='';try{var w=JSON.parse(lget('agsist-wx-loc')||'null');if(w&&/^[A-Z]{2}$/.test(w.state||''))s=w.state;}catch(e){}var m=lget(KEY)||'';return /^[A-Z]{2}$/.test(m)?m:s;}
  function n(v){return String(v).replace(/\B(?=(\d{3})+(?!\d))/g,',');}
  function chg(v){return (v>0?'+':v<0?'−':'')+n(Math.abs(v));}
  function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  var st=saved();
  if(st==='WI') $('dp-hc-wi-f').hidden=false;   // the space is set before the data comes, so nothing jumps
  /* bars: one series, so no legend; the figcaption names it */
  function bars(el,ser,label){
    var ys=Object.keys(ser).sort(); if(ys.length<2){el.innerHTML='';return;}
    var W=640,H=220,L=46,R=8,T=10,B=24,max=0,i;
    for(i=0;i<ys.length;i++) max=Math.max(max,ser[ys[i]]);
    var step=Math.pow(10,Math.floor(Math.log10(max))), top=Math.ceil(max/step)*step; if(top/step<=2) {step/=2;}
    var bw=(W-L-R)/ys.length, g='', y, h, v, d;
    for(v=0;v<=top+1e-9;v+=step){y=T+(H-T-B)*(1-v/top);g+='<line class="dp-hc-grid" x1="'+L+'" x2="'+(W-R)+'" y1="'+y.toFixed(1)+'" y2="'+y.toFixed(1)+'"/><text class="dp-hc-ax" x="'+(L-6)+'" y="'+(y+4).toFixed(1)+'" text-anchor="end">'+n(v)+'</text>';}
    for(i=0;i<ys.length;i++){
      v=ser[ys[i]]; h=(H-T-B)*v/top; y=H-B-h; d=i?v-ser[ys[i-1]]:null;
      var tip=ys[i]+': '+n(v)+' licensed herds'+(d!==null&&String(+ys[i]-1)===ys[i-1]?', '+chg(d)+' from '+ys[i-1]:'');
      g+='<g class="dp-hc-b" tabindex="0" data-tip="'+esc(tip)+'"><rect class="dp-hc-hit" x="'+(L+i*bw).toFixed(1)+'" y="'+T+'" width="'+bw.toFixed(1)+'" height="'+(H-T-B)+'"/>'+
         '<rect class="dp-hc-bar" x="'+(L+i*bw+1).toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+Math.max(1,bw-2).toFixed(1)+'" height="'+h.toFixed(1)+'" rx="2"/><title>'+esc(tip)+'</title></g>';
      if(i===0||i===ys.length-1||+ys[i]%5===0) g+='<text class="dp-hc-ax" x="'+(L+i*bw+bw/2).toFixed(1)+'" y="'+(H-6)+'" text-anchor="middle">'+ys[i]+'</text>';
    }
    el.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(label)+'">'+g+'</svg><div class="dp-hc-tip" hidden></div>';
    hover(el);
  }
  function line(el,ser,label){
    var ks=Object.keys(ser).sort(); if(ks.length<2){el.innerHTML='';return;}
    var W=640,H=220,L=46,R=8,T=10,B=24,max=0,min=Infinity,i;
    for(i=0;i<ks.length;i++){max=Math.max(max,ser[ks[i]]);min=Math.min(min,ser[ks[i]]);}
    var step=Math.pow(10,Math.floor(Math.log10(max))), top=Math.ceil(max/step)*step; if(top/step<=2) step/=2;
    var x=function(j){return L+(W-L-R)*j/(ks.length-1);}, y=function(v){return T+(H-T-B)*(1-v/top);}, g='', p=[];
    for(var v=0;v<=top+1e-9;v+=step) g+='<line class="dp-hc-grid" x1="'+L+'" x2="'+(W-R)+'" y1="'+y(v).toFixed(1)+'" y2="'+y(v).toFixed(1)+'"/><text class="dp-hc-ax" x="'+(L-6)+'" y="'+(y(v)+4).toFixed(1)+'" text-anchor="end">'+n(v)+'</text>';
    for(i=0;i<ks.length;i++){p.push(x(i).toFixed(1)+','+y(ser[ks[i]]).toFixed(1)); if(ks[i].slice(5)==='01'&&+ks[i].slice(0,4)%5===0) g+='<text class="dp-hc-ax" x="'+x(i).toFixed(1)+'" y="'+(H-6)+'" text-anchor="middle">'+ks[i].slice(0,4)+'</text>';}
    g+='<polyline class="dp-hc-line" points="'+p.join(' ')+'"/><circle class="dp-hc-dot" r="4" cx="-9" cy="-9"/>';
    el.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(label)+'">'+g+'<rect class="dp-hc-hit" x="'+L+'" y="'+T+'" width="'+(W-L-R)+'" height="'+(H-T-B)+'"/></svg><div class="dp-hc-tip" hidden></div>';
    var svg=el.querySelector('svg'), tip=el.querySelector('.dp-hc-tip'), dot=el.querySelector('.dp-hc-dot');
    function at(ev){var r=svg.getBoundingClientRect(), fx=(ev.clientX-r.left)*W/r.width, j=Math.round((fx-L)/(W-L-R)*(ks.length-1));j=Math.max(0,Math.min(ks.length-1,j));
      var k=ks[j], v=ser[k], ka=(+k.slice(0,4)-1)+k.slice(4), t=MON[+k.slice(5)-1]+' 1, '+k.slice(0,4)+': '+n(v)+' herds'+(ser[ka]!=null?', '+chg(v-ser[ka])+' from a year earlier':'');
      dot.setAttribute('cx',x(j).toFixed(1));dot.setAttribute('cy',y(v).toFixed(1));tip.textContent=t;tip.hidden=false;
      tip.style.left=Math.min(r.width-170,Math.max(0,(ev.clientX-r.left)-80))+'px';}
    svg.addEventListener('pointermove',at);svg.addEventListener('pointerdown',at);
    svg.addEventListener('pointerleave',function(){tip.hidden=true;dot.setAttribute('cx',-9);});
  }
  function hover(el){
    var tip=el.querySelector('.dp-hc-tip');
    function show(g){var r=el.getBoundingClientRect(),b=g.querySelector('.dp-hc-bar').getBoundingClientRect();tip.textContent=g.getAttribute('data-tip');tip.hidden=false;
      tip.style.left=Math.min(r.width-170,Math.max(0,b.left-r.left-80))+'px';}
    Array.prototype.forEach.call(el.querySelectorAll('.dp-hc-b'),function(g){
      g.addEventListener('pointerenter',function(){show(g);});g.addEventListener('focus',function(){show(g);});
      g.addEventListener('pointerdown',function(){show(g);});
      g.addEventListener('pointerleave',function(){tip.hidden=true;});g.addEventListener('blur',function(){tip.hidden=true;});});
  }
  function note(ser){
    var ys=Object.keys(ser).sort(),i,big=null;
    for(i=1;i<ys.length;i++){if(String(+ys[i]-1)!==ys[i-1])continue;var d=ser[ys[i]]-ser[ys[i-1]];if(big===null||d<big.d)big={y:ys[i],d:d};}
    var a=ys[0],b=ys[ys.length-1];
    return a+' to '+b+': '+n(ser[a])+' to '+n(ser[b])+' ('+chg(ser[b]-ser[a])+').'+(big&&big.d<0?' Biggest one-year net drop: '+big.y+', '+chg(big.d)+'.':'');
  }
  function table(D,s){
    var us=D.us||{}, ss=(s&&D.states&&D.states[s])||{}, ys=Object.keys(us).sort().reverse(), h='<table class="dp-tbl"><caption class="dp-sr">Licensed dairy herds by year, NASS, with the net change from the year before</caption><thead><tr><th scope="col">Year</th><th scope="col" class="num">US</th><th scope="col" class="num">Net change</th>'+(s?'<th scope="col" class="num">'+esc(NAMES[s])+'</th><th scope="col" class="num">Net change</th>':'')+'</tr></thead><tbody>';
    ys.forEach(function(y){var p=String(+y-1);h+='<tr><th scope="row">'+y+'</th><td class="num">'+n(us[y])+'</td><td class="num">'+(us[p]!=null?chg(us[y]-us[p]):'')+'</td>'+(s?'<td class="num">'+(ss[y]!=null?n(ss[y]):'-')+'</td><td class="num">'+(ss[y]!=null&&ss[p]!=null?chg(ss[y]-ss[p]):'')+'</td>':'')+'</tr>';});
    $('dp-herds-tbl-in').innerHTML=h+'</tbody></table><p class="dp-note-src">A dash: NASS did not publish that state that year (it folds small states into Other States).</p>';
  }
  function draw(D){
    var sel=$('dp-herds-st'), ks=Object.keys(D.states||{}).filter(function(k){return NAMES[k];}).sort(function(a,b){return NAMES[a]<NAMES[b]?-1:1;});
    if(sel.options.length<2) ks.forEach(function(k){var o=document.createElement('option');o.value=k;o.textContent=NAMES[k];sel.appendChild(o);});
    if(st&&!(D.states||{})[st]) st='';
    sel.value=st;
    bars($('dp-hc-us'),D.us,'United States licensed dairy herds by year'); $('dp-hc-us-n').textContent=note(D.us);
    if(st){var s=D.states[st];$('dp-hc-st-h').textContent=NAMES[st]+', licensed dairy herds (NASS) by year';bars($('dp-hc-st'),s,NAMES[st]+' licensed dairy herds by year');
      var gap=[];for(var y=+Object.keys(D.us).sort()[0];y<=+Object.keys(D.us).sort().pop();y++) if(s[y]==null) gap.push(y);
      $('dp-hc-st-n').textContent=note(s)+(gap.length?' Not published by NASS for '+NAMES[st]+': '+gap.join(', ')+'.':'');}
    else {$('dp-hc-st-h').textContent='Your state, by year';$('dp-hc-st').innerHTML='';$('dp-hc-st-n').textContent='Pick your state to see it beside the US.';}
    var wm=(D.wi_monthly||{}).months||{}, wf=$('dp-hc-wi-f');
    wf.hidden=!(st==='WI'&&Object.keys(wm).length);
    if(!wf.hidden){line($('dp-hc-wi'),wm,'Wisconsin licensed dairy herds by month');var wk=Object.keys(wm).sort(),last=wk[wk.length-1];
      $('dp-hc-wi-n').textContent='Aug 2003 to '+MON[+last.slice(5)-1]+' '+last.slice(0,4)+': '+n(wm[wk[0]])+' to '+n(wm[last])+'. Monthly counts are herds on the licence list that day; the yearly bars above are NASS’s average for the year, so the two differ.';}
    table(D,st);
  }
  var D=null, asked=false;
  function load(){
    if(asked) return; asked=true;
    fetch('/data/dairy-herds.json',{cache:'no-cache'}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).then(function(j){
      if(!j||!j.us||Object.keys(j.us).length<2) throw new Error('no yearly numbers in the file');
      D=j; draw(D);
    }).catch(function(e){
      $('dp-hc-us-n').textContent='The herd chart did not load ('+(e&&e.message||'no answer')+'). The numbers above still stand; reload to try again.';
      $('dp-hc-wi-f').hidden=true;
    });
  }
  $('dp-herds-st').addEventListener('change',function(){st=this.value;lset(KEY,st);if(D)draw(D);else load();});
  if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){if(es.some(function(e){return e.isIntersecting;})){io.disconnect();load();}},{rootMargin:'600px 0px'});io.observe(sec);}
  else load();
  var t=$('dp-herds-tbl'); if(t) t.addEventListener('toggle',function(){if(t.open)load();});
})();
