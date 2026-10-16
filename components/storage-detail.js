/* The storage section of /basis: the reader's state card and its past falls.
   Loaded only when the section is opened (the loader sits after
   <details id="storage"> in basis.html), never with the page.
   Numbers come from the pipeline: the seeded blob <script id="st-data">
   (scripts/seed_static.py storage_html) and data/storage/history.json
   (scripts/fetch_storage.py). This file only formats them. card() and
   histText() are twins of storage_card() and storage_hist_text() in
   seed_static.py; test/storage-section.test.mjs holds them to the same output. */
(function(){
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function ord(n){ var t=n%100; if(t>=10&&t<=20) return n+'th'; return n+({1:'st',2:'nd',3:'rd'}[n%10]||'th'); }
  function mb(x){ return Math.trunc(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g,','); }
  function fx(v,n){ return Number(v).toFixed(n); }
  function pts(x){ return Math.round(Math.abs(x)*100); }
  /* signed cents, the twin of scripts/pricefmt.py basis (AG.px.basis on the page) */
  function money(c){
    if(typeof AG!=='undefined'&&AG.px&&AG.px.basis) return AG.px.basis(c);
    return c===0?'even':(c>0?'+':'−')+Math.abs(c)+'¢';
  }

  function histText(name,h){
    if(!h) return '';
    if(h.withheld) return '<p class="st-h">Past falls in '+esc(name)+': not enough history to say ('+esc(h.withheld)+').</p>';
    var out='<p class="st-h">Past falls in '+esc(name)+' ('+h.first+' to '+h.last+', '+h.n+' with full figures): '
      +'the September pressure averaged '+fx(h.p_avg,2)+'&times; and December 1 use '
      +fx(h.u_avg,2)+'&times;, so moving and using grain took off '+pts(h.drop_avg)+' points by '
      +'December (most years '+pts(h.drop10)+' to '+pts(h.drop90)+').';
    if(h.this_p!=null){
      out+=' This fall&rsquo;s '+fx(h.this_p,2)+'&times; is above '+(h.below===h.n?'all '+h.n:h.below+' of those '+h.n)+'. At the '
        +'usual pace December 1 use would land near '+fx(h.if_usual,2)+'&times;; at the pace of the '
        +'slowest tenth of years, '+fx(h.if_slow,2)+'&times;. Tried on past years, that usual-pace '
        +'rule missed December by '+pts(h.loo_mae)+' points on average, '+pts(h.loo_max)+' at worst.';
    }
    return out+'</p>';
  }

  function card(st,v,hs,haveHist,meta){
    var name=esc(v.n), yr=meta.year, out;
    if(v.r==null){
      out='<p class="st-you-h"><b>'+name+':</b> no ratio this fall. '+(v.w||'')+'.</p>';
    } else {
      var rank=v.k?ord(v.k)+' most crowded of '+meta.n:'a floor: '+v.f+', which can only push it higher';
      var held=(v.s?mb(v.s)+' million bu in the bins on Sept 1 + ':'')
        +mb(v.c)+' million bu of '+yr+' crop, against '+mb(v.b)+' million bu of bin space';
      out='<p class="st-you-h"><b>'+name+': '+v.r+'&times;</b> <span>'+rank+'</span></p><p>'+held+'.</p>';
    }
    if(v.bd!=null){
      var c=v.bd, vs=c===0?'right at':Math.abs(c)+'&cent; '+(c<0?'under':'over');
      out+='<p>Corn basis in USDA&rsquo;s '+name+' region, week of '+meta.wk+': '+money(v.bn)+', '+vs
        +' its 5-year normal for that week. Bins are one cause; freight and local demand are the others.</p>';
    }
    if(v.cp){
      var pa=100*(v.cp[1]/v.cp[0]-1);
      out+='<p>Bin space: '+mb(v.cp[1])+' million bu on Dec 1, '+(yr-1)+', '+(pa>=0?'+':'&minus;')
        +fx(Math.abs(pa),1)+'% from Dec 1, '+(yr-6)+' (NASS).</p>';
    }
    if(hs!=null) out+=histText(v.n,hs);
    else if(!haveHist&&v.r!=null)
      out+='<p class="st-h">How fast '+name+' has cleared the pressure in past falls (NASS December 1 '
        +'stocks, 2000 to '+(yr-1)+') fills in after our next NASS pull.</p>';
    return out;
  }

  /* Past falls as dots: September pressure (filled, gold) and December 1 use
     (hollow, blue) for each year, the 1.00 line where the bins are full, and
     this fall's pressure as a ring. A table of the same numbers sits under it.
     width = the box's real width in px, so the viewBox draws 1:1 and the 11 px
     axis text stays 11 px on a phone (a fixed 340 viewBox shrank it to ~8 px).
     The "bins full" key lives in the legend, not on the dashed line. */
  function chart(name,rec,years,fallYear,width){
    var W=Math.round(Math.max(280,Math.min(560,+width||340)));
    var P=rec.p, U=rec.u, s=rec.stats||{}, H=184, L=36, R=16, T=12, B=26;
    var xs=years.map(Number); if(s.this_p!=null) xs=xs.concat([fallYear]);
    var all=P.concat(U).filter(function(x){return x!=null;}); if(s.this_p!=null) all.push(s.this_p);
    if(!all.length) return '';
    var lo=Math.min(0.4,Math.floor(Math.min.apply(null,all)*10)/10), hi=Math.max(1.2,Math.ceil(Math.max.apply(null,all)*10)/10);
    var x0=xs[0], x1=xs[xs.length-1];
    function X(y){ return L+(W-L-R)*(y-x0)/Math.max(1,(x1-x0)); }
    function Y(v){ return T+(H-T-B)*(hi-v)/(hi-lo); }
    var g='', i, step=(hi-lo)>1?0.4:0.2;
    for(var v=Math.ceil(lo/step)*step; v<=hi+1e-9; v+=step){
      g+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+Y(v).toFixed(1)+'" y2="'+Y(v).toFixed(1)+'" class="sc-grid"/>'
        +'<text x="'+(L-4)+'" y="'+(Y(v)+3).toFixed(1)+'" class="sc-ax" text-anchor="end">'+v.toFixed(1)+'</text>';
    }
    g+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+Y(1).toFixed(1)+'" y2="'+Y(1).toFixed(1)+'" class="sc-full"/>';
    var mid=Math.round((x0+x1)/2/5)*5, xl=[x0];
    if(mid>x0&&mid<x1&&X(mid)-X(x0)>44&&X(x1)-X(mid)>44) xl.push(mid);
    if(x1>x0) xl.push(x1);
    xl.forEach(function(y){
      g+='<text x="'+X(y).toFixed(1)+'" y="'+(H-6)+'" class="sc-ax" text-anchor="'+(y===x1?'end':y===x0?'start':'middle')+'">'+y+'</text>'; });
    function line(A,cls){
      var d='', pen=false;
      for(i=0;i<A.length;i++){ if(A[i]==null){pen=false;continue;} d+=(pen?'L':'M')+X(+years[i]).toFixed(1)+' '+Y(A[i]).toFixed(1); pen=true; }
      return d?'<path d="'+d+'" class="'+cls+'"/>':'';
    }
    g+=line(P,'sc-p')+line(U,'sc-u');
    for(i=0;i<years.length;i++){
      var x=X(+years[i]).toFixed(1), tip=years[i]+': September '+(P[i]==null?'no figure':fx(P[i],2)+'×')+', December 1 '+(U[i]==null?'no figure':fx(U[i],2)+'×');
      if(P[i]!=null) g+='<circle cx="'+x+'" cy="'+Y(P[i]).toFixed(1)+'" r="4" class="sc-pd"/>';
      if(U[i]!=null) g+='<circle cx="'+x+'" cy="'+Y(U[i]).toFixed(1)+'" r="3.5" class="sc-ud"/>';
      g+='<rect x="'+(X(+years[i])-6).toFixed(1)+'" y="'+T+'" width="12" height="'+(H-T-B)+'" class="sc-hit"><title>'+tip+'</title></rect>';
    }
    if(s.this_p!=null){
      g+='<circle cx="'+X(fallYear).toFixed(1)+'" cy="'+Y(s.this_p).toFixed(1)+'" r="6.5" class="sc-now"><title>'+fallYear+' so far: '+fx(s.this_p,2)+'× (latest NASS forecast)</title></circle>';
    }
    var rows='';
    for(i=years.length-1;i>=0;i--){ if(P[i]==null&&U[i]==null) continue;
      rows+='<tr><td>'+years[i]+'</td><td class="num">'+(P[i]==null?'&ndash;':fx(P[i],2))+'</td><td class="num">'+(U[i]==null?'&ndash;':fx(U[i],2))+'</td><td class="num">'+(P[i]==null||U[i]==null?'&ndash;':pts(P[i]-U[i]))+'</td></tr>'; }
    return '<div class="sc-leg"><span><i class="sc-k sc-kp"></i>September pressure</span><span><i class="sc-k sc-ku"></i>December 1 use</span>'
      +(s.this_p!=null?'<span><i class="sc-k sc-kn"></i>'+fallYear+' so far</span>':'')
      +'<span><i class="sc-k sc-kf"></i>1.00 = bins full</span></div>'
      +'<svg viewBox="0 0 '+W+' '+H+'" class="sc-svg" role="img" aria-label="'+esc(name)+': September storage pressure and December 1 use by year">'+g+'</svg>'
      +'<details class="sc-tbl"><summary>Year by year as a table</summary><table class="bs-tbl"><tr><th>Year</th><th style="text-align:right">September</th><th style="text-align:right">Dec 1</th><th style="text-align:right">Points off</th></tr>'+rows+'</table></details>';
  }

  var api={card:card,histText:histText,chart:chart};
  if(typeof module!=='undefined'&&module.exports){ module.exports=api; }
  if(typeof window!=='undefined'){ window.StorageDetail=api; }
  if(typeof document==='undefined') return;

  var root=document.getElementById('storage'), you=document.getElementById('st-you'), blob=document.getElementById('st-data');
  if(!root||!you||!blob) return;
  var D; try{ D=JSON.parse(blob.textContent); }catch(e){ return; }
  var H=undefined, cur=you.getAttribute('data-st'), sel=document.getElementById('bs-st-sel');
  var meta={year:D.year,n:D.n,wk:D.wk};
  function hs(st){ return H&&H.states&&H.states[st]?H.states[st].stats:null; }
  function show(st,scroll){
    var v=D.states[st];
    if(!v){
      var o=sel&&sel.querySelector('option[value="'+st+'"]'), nm=o?o.textContent:st;
      you.innerHTML='<p class="st-you-h"><b>'+esc(nm)+':</b> NASS publishes no state grain stocks we can use, so no ratio.</p>';
    } else {
      var h=hs(st), more=(H&&H.states&&H.states[st])?'<button type="button" class="st-more" aria-expanded="false">Show past falls, year by year</button><div class="st-chart" hidden></div>':'';
      var held=(H===null&&D._held)?'<p class="st-h">'+D._held+'</p>':'';
      you.innerHTML=card(st,v,h,!!H,meta)+held+more;
    }
    cur=st; you.setAttribute('data-st',st);
    Array.prototype.forEach.call(root.querySelectorAll('.st-b'),function(b){ b.setAttribute('aria-pressed',b.getAttribute('data-st')===st?'true':'false'); });
    if(scroll&&you.scrollIntoView){ try{ you.scrollIntoView({block:'nearest',behavior:'smooth'}); }catch(e){ you.scrollIntoView(); } }
  }
  you.addEventListener('click',function(e){
    var b=e.target.closest&&e.target.closest('.st-more'); if(!b) return;
    var box=you.querySelector('.st-chart'), open=b.getAttribute('aria-expanded')==='true';
    box.hidden=open;
    if(!open&&!box.innerHTML) box.innerHTML=chart(D.states[cur].n,H.states[cur],H.years,H.fall_year,box.clientWidth); b.setAttribute('aria-expanded',open?'false':'true');
    b.textContent=open?'Show past falls, year by year':'Hide past falls';
  });
  root.addEventListener('click',function(e){
    var b=e.target.closest&&e.target.closest('.st-b'); if(!b) return;
    show(b.getAttribute('data-st'),true);
    try{ gaEvent('storage_state',{st:b.getAttribute('data-st')}); }catch(x){}
  });
  if(sel) sel.addEventListener('change',function(){ show(sel.value); });
  if(sel&&sel.value&&sel.value!==cur) show(sel.value); else show(cur);
  /* past falls: only from the same NASS pull as the table (two vintages never meet) */
  fetch('/data/storage/history.json').then(function(r){ return r.ok?r.json():null; }).then(function(j){
    if(j&&j.states&&j.generated===D.gen&&j.fall_year===D.year){ H=j; }
    else { H=null; if(j&&j.states) D._held='Past falls are held back: that file is from a different NASS pull than this table.'; }
    show(cur);
  }).catch(function(){ H=null; });
})();
