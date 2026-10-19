/* /drought-monitor county box (moved out of the page 2026-10-16 so the page stays light and this caches). */
  /* County lookup. Data AGSIST already publishes, loaded only when the box is used:
     the Atlas county list (farmland-atlas/data/counties-index.json, [fips, "Name, ST", atlas path]),
     one county's Atlas file (data/atlas/counties/<fips>.json, its "drought" block: weeks with
     at least half the county's area in D2 or worse, per year since 2000), and this week's file
     (data/drought/county-week.json, written each Thursday by scripts/fetch_drought_county_week.py:
     NDMC's cumulative percent of area in D0-D4 for the newest map, a week back and four weeks back).
     No number is made here except the week-to-week differences, which are plain subtraction. */
  (function(){
    var q=document.getElementById('dm-county-q'),list=document.getElementById('dm-county-list'),out=document.getElementById('dm-county-out');
    if(!q)return;
    var IDX=null,loading=null,WK=null,wkLoading=null;
    function loadWeek(){
      if(WK)return Promise.resolve(WK);
      if(!wkLoading)wkLoading=fetch('/data/drought/county-week.json').then(function(r){if(r.status===404)return {missing:true};if(!r.ok)throw 0;return r.json();}).then(function(w){WK=w;return w;},function(){wkLoading=null;return {failed:true};});
      return wkLoading;
    }
    function day(iso){var p=String(iso).split('-');return new Date(Date.UTC(+p[0],+p[1]-1,+p[2])).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});}
    function f1(v){return (Math.round(v*10)/10).toFixed(1).replace(/\.0$/,'');}
    function chg(a,b){if(a==null||b==null)return 'n/a';var d=Math.round((a-b)*10)/10;return d===0?'no change':(d>0?'+':'\u2212')+f1(Math.abs(d))+' pts';}
    var CAT=[['None','#d9d9d9'],['D0','#ffff00'],['D1','#fcd37f'],['D2','#ffaa00'],['D3','#e60000'],['D4','#730000']];
    var ROWS=['D0\u2013D4: abnormally dry or worse','D1\u2013D4: in drought','D2\u2013D4: severe or worse','D3\u2013D4: extreme or worse','D4: exceptional'];
    /* fips -> the week block's HTML. w: the file; every figure carries the map's valid date. */
    function weekHtml(w,fips){
      var head='<div style="font-weight:700;margin:.1rem 0 .15rem">This week</div>';
      if(!w||w.missing)return head+'<p style="margin:0 0 .5rem;color:var(--text-dim)">This week&rsquo;s county numbers load after the first Drought Monitor read. The map below is this week&rsquo;s.</p>';
      if(w.failed)return head+'<p style="margin:0 0 .5rem;color:var(--text-dim)">This week&rsquo;s county numbers did not load. Try again.</p>';
      var rows=w.c&&w.c[fips], zero=w.zero&&w.zero.indexOf(fips)>=0, z=[0,0,0,0,0];
      if(!rows&&zero)rows=[z,z,z];
      if(!rows)return head+'<p style="margin:0 0 .5rem;color:var(--text-dim)">The Drought Monitor has no county figure for this county on the map valid '+esc(day(w.valid))+'.</p>';
      var now=rows[0],wk1=rows[1],wk4=rows[2];
      var old=(Date.now()-Date.parse(w.valid+'T00:00:00Z'))/864e5>9;
      var t='<table class="dm-wk"><thead><tr><th scope="col">Share of the county</th><th scope="col">Map valid '+esc(day(w.valid))+'</th><th scope="col">vs a week before</th><th scope="col">vs 4 weeks before</th></tr></thead><tbody>';
      for(var i=0;i<5;i++)t+='<tr><td>'+ROWS[i]+'</td><td><strong>'+f1(now[i])+'%</strong></td><td>'+chg(now[i],wk1&&wk1[i])+'</td><td>'+chg(now[i],wk4&&wk4[i])+'</td></tr>';
      t+='</tbody></table>';
      var ex=[100-now[0],now[0]-now[1],now[1]-now[2],now[2]-now[3],now[3]-now[4],now[4]];
      var bar='<div class="dm-wk-bar" role="img" aria-label="'+esc(CAT.map(function(c,k){return c[0]+' '+f1(Math.max(0,ex[k]))+'%';}).join(', '))+'">'+CAT.map(function(c,k){var v=Math.max(0,ex[k]);return v>0?'<span style="width:'+v+'%;background:'+c[1]+'"></span>':'';}).join('')+'</div>';
      var key='<div class="dm-wk-key">'+CAT.map(function(c,k){var v=Math.max(0,ex[k]);return v>0?'<span><i style="background:'+c[1]+'"></i>'+(k?c[0]:'No drought')+' '+f1(v)+'%</span>':'';}).join('')+'</div>';
      var say;
      if(!now[0])say='No part of the county is dry or in drought on this map.';
      else if(!now[1])say='Not in drought. '+f1(now[0])+'% of it is abnormally dry (D0).';
      else say='<strong>'+f1(now[1])+'%</strong> of the county is in drought (D1 or worse)'+(now[2]?'; <strong>'+f1(now[2])+'%</strong> severe (D2) or worse':'')+(now[3]?'; '+f1(now[3])+'% extreme (D3) or worse':'')+'.';
      head+='<p class="dm-county-say" style="margin:.1rem 0 .3rem;font-size:.98rem">'+say+'</p>';
      return head+bar+key+t+'<p style="margin:0 0 .6rem;font-size:.8rem;color:var(--text-muted)">Percent of the county&rsquo;s area, U.S. Drought Monitor county statistics (NDMC). Each row counts that category and every worse one; the bar splits them. A week before is the map valid '+esc(day(w.prev))+'; four weeks before, '+esc(day(w.prev4))+'.'+(old?' <strong>This is not the newest map: the weekly read is late.</strong>':'')+'</p>';
    }
    /* Drought streaks from the same weekly file (w.k, counted by the fetcher, never here).
       LFP reads drought in ANY part of the county, so these count any part, not half. */
    function streakHtml(w,fips){
      if(!w||!w.k||w.missing||w.failed)return '';
      var k=w.k[fips],yr=String(w.valid).slice(0,4),thru=esc(day(w.valid));
      var head='<div style="font-weight:700;margin:.1rem 0 .15rem">How long it has run</div>';
      var lfp='<p style="margin:.2rem 0 .6rem;font-size:.8rem;color:var(--text-muted)">Counted on NDMC&rsquo;s weekly county figures: a week counts when any part of the county is in that category. FSA&rsquo;s Livestock Forage Disaster Program reads these same maps the same way (any part of the county), but only inside the county&rsquo;s normal grazing period, which FSA sets by county and pasture type and this page does not check. So these are counts, not an eligibility answer. The rule is in <a href="https://www.ecfr.gov/current/title-7/subtitle-B/chapter-XIV/subchapter-B/part-1416/subpart-C" target="_blank" rel="noopener" style="color:var(--gold)">7 CFR part 1416, subpart C</a>; the county FSA office has the grazing period.</p>';
      if(!k){
        if(!(w.c&&w.c[fips])&&!(w.zero&&w.zero.indexOf(fips)>=0))return '';
        return head+'<p style="margin:0 0 .2rem">No part of the county is in drought (D1 or worse) on the map valid '+thru+', and no weekly map in '+esc(yr)+' had any of it in severe drought (D2) or worse.</p>'+lfp;
      }
      var NM=['in drought (D1 or worse)','in severe drought (D2) or worse','in extreme drought (D3) or worse','in exceptional drought (D4)'];
      var li=[];
      for(var i=0;i<4;i++){
        if(i>1&&!k[i])continue;
        var lb=(k[7]>>i)&1, wk=k[i]===1?'this week&rsquo;s map only (valid '+thru+')':(lb?'at least ':'')+k[i]+' weekly maps in a row, through '+thru;
        li.push(k[i]?'Some of it '+NM[i]+': '+wk+(lb?' (the file reads '+(w.streak_maps||53)+' weeks back)':''):'None of it '+NM[i]+' on the map valid '+thru);
      }
      li.push(yr+' weekly maps with some of it in D2 or worse: '+k[4]+'; D3 or worse: '+k[5]+'; D4: '+k[6]);
      return head+'<ul style="margin:.2rem 0 .2rem;padding-left:1.1rem">'+li.map(function(x){return '<li>'+x+'</li>';}).join('')+'</ul>'+lfp;
    }
    var MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
    function inch(v){return Number(v).toFixed(2)+' in';}
    /* Rain this year for the county, from the county rain file /rain pages are built from
       (NOAA and CoCoRaHS daily gauges via RCC-ACIS; usual = 1991-2020 normals over the days
       the gauge reported). Shown only as the file has it; nothing is filled in. */
    function rainHtml(d,fips){
      var c=d&&d.counties&&d.counties[fips];
      var head='<div style="font-weight:700;margin:.1rem 0 .15rem">Rain this year</div>';
      if(!c){
        if(d&&d.none&&d.none[fips])return head+'<p style="margin:0 0 .5rem;color:var(--text-dim)">No rain gauge in this county has a full enough record for '+esc(d.year)+' to print a total.</p>';
        return '';
      }
      var st=c.station||{},gauge=(st.net==='cocorahs'?'CoCoRaHS volunteer gauge':'NOAA weather station')+(st.name?' at '+esc(st.name):'');
      var thru=esc(day(c.as_of));
      var t='Since Jan 1: <strong>'+inch(c.total)+'</strong>'+(c.pct!=null?', <strong>'+c.pct+'% of usual</strong> (usual '+inch(c.usual)+')':'')+', through '+thru+'.';
      var m=c.months||[],li=[],first=0; /* months run from January */
      for(var j=Math.max(0,m.length-2);j<m.length;j++){
        var x=m[j];if(!x||!x[3])continue;
        var nm=MON[first+j],part=(j===m.length-1&&x[3]<new Date(Date.UTC(+c.as_of.slice(0,4),first+j+1,0)).getUTCDate())?nm+' 1 to '+x[3]:nm;
        var gap=x[2]<x[3]?' (gauge reported '+x[2]+' of '+x[3]+' days)':'';
        li.push(part+': '+inch(x[0])+(x[1]!=null?', usual '+inch(x[1]):'')+gap);
      }
      return head+'<p style="margin:0 0 .2rem">'+t+'</p>'+(li.length?'<ul style="margin:.1rem 0 .2rem;padding-left:1.1rem">'+li.map(function(x){return '<li>'+x+'</li>';}).join('')+'</ul>':'')
        +'<p style="margin:0 0 .6rem;font-size:.8rem;color:var(--text-muted)">One '+gauge+(c.missing?', which missed '+c.missing+(c.missing===1?' day':' days')+' this year':'')+'. Usual is the 1991-2020 normal (NOAA) added up over the days it reported. Daily records via RCC-ACIS.</p>';
    }
    function missingYears(d){
      if(d.missing_years)return d.missing_years.map(Number);
      var s=d.series||{},o=[];
      for(var y=+d.first_year;y<=+d.last_full_year;y++){if(!s[y]||s[y].maps<40)o.push(y);}
      return o;
    }
    function esc(t){return String(t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
    function n(x){return Number(x).toLocaleString('en-US');}
    function loadIdx(){
      if(IDX)return Promise.resolve(IDX);
      if(!loading)loading=fetch('/farmland-atlas/data/counties-index.json').then(function(r){if(!r.ok)throw 0;return r.json();}).then(function(a){IDX=a;return a;});
      return loading;
    }
    function show(){
      var t=q.value.trim().toLowerCase();list.innerHTML='';
      if(t.length<2)return;
      loadIdx().then(function(a){
        if(q.value.trim().toLowerCase()!==t)return;
        var hits=[];
        for(var i=0;i<a.length&&hits.length<8;i++){if(a[i][1].toLowerCase().indexOf(t)===0)hits.push(a[i]);}
        for(var j=0;j<a.length&&hits.length<8;j++){var nm=a[j][1].toLowerCase();if(nm.indexOf(t)>0&&hits.indexOf(a[j])<0)hits.push(a[j]);}
        list.innerHTML=hits.length?hits.map(function(h,k){return '<button type="button" data-k="'+k+'" style="min-height:40px;padding:.3rem .65rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font:inherit;font-size:.82rem;cursor:pointer">'+esc(h[1])+'</button>';}).join(''):'<span style="font-size:.82rem;color:var(--text-muted)">No county by that name.</span>';
        Array.prototype.forEach.call(list.querySelectorAll('button'),function(b){b.addEventListener('click',function(){pick(hits[+b.getAttribute('data-k')]);});});
      }).catch(function(){list.innerHTML='<span style="font-size:.82rem;color:var(--text-muted)">The county list did not load. Reload the page.</span>';});
    }
    function pick(h){
      list.innerHTML='';q.value=h[1];out.textContent='Loading '+h[1]+'\u2026';
      var wkP=loadWeek();
      fetch('/data/atlas/counties/'+h[0]+'.json').then(function(r){if(!r.ok)throw 0;return r.json();}).then(function(c){return wkP.then(function(w){return [c,w];});}).then(function(cw){
        var c=cw[0],wkb=weekHtml(cw[1],h[0])+streakHtml(cw[1],h[0])+'<div id="dm-county-rain"></div>';
        remember(h);
        if(q.value!==h[1])return;
        var d=c.drought||{},links='<a href="'+esc(h[2])+'" style="color:var(--gold)">Full county record in the Atlas</a>';
        if(d.status!=='ok'){
          out.innerHTML='<strong>'+esc(h[1])+'</strong>'+wkb+'<div style="font-weight:700;margin:.1rem 0 .15rem">Since 2000</div>Withheld in the Atlas ('+esc(String(d.status||'no drought record').replace(/^withheld:\s*/,''))+'). '+links;
          return;
        }
        var miss=missingYears(d),exc=miss.length?' except '+miss.join(', '):'';
        var py=d.partial_year,last=d.series&&d.series[String(d.last_full_year)],w=d.weeks||{},wy=d.worst_year;
        var rows=[];
        if(py)rows.push(py.year+' so far: '+py.d2+' of '+py.maps+' weekly maps');
        if(last)rows.push(d.last_full_year+': '+last.d2+' of '+last.maps+' weekly maps');
        if(w.counted)rows.push(d.first_year+'\u2013'+d.last_full_year+exc+': '+n(w.d2)+' of '+n(w.counted)+' weekly maps ('+w.share_d2_pct+'%)'+(w.d3!=null?'; '+n(w.d3)+' of them at D3 or worse':''));
        if(miss.length)rows.push(miss.join(', ')+' left out: the Atlas copy of that year is incomplete, so it is in no total here');
        if(wy&&wy.d2>0)rows.push('Worst year: '+wy.year+', '+wy.d2+' weeks'+(wy.tied&&wy.tied.length?' (tied with '+wy.tied.join(', ')+')':''));
        var built=c.generated?new Date(c.generated).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}):'';
        out.innerHTML='<strong>'+esc(h[1])+'</strong>'+wkb+'<div style="font-weight:700;margin:.1rem 0 .15rem">Since 2000</div>Weeks with at least half the county in D2 or worse:'
          +'<ul style="margin:.3rem 0 .4rem;padding-left:1.1rem">'+rows.map(function(r){return '<li>'+esc(r)+'</li>';}).join('')+'</ul>'
          +'<span style="font-size:.8rem;color:var(--text-muted)">U.S. Drought Monitor county statistics (NDMC), counted by the Atlas'+(built?', built '+esc(built):'')+'. Half the county is the Atlas&rsquo;s line, not an FSA program rule.</span>'
          +'<div id="dm-county-links" style="margin-top:.4rem">'+links+'</div>';
        loadRain(h);
        var rain=h[2].replace(/^\/farmland-atlas\//,'/rain/');
        fetch(rain,{method:'HEAD'}).then(function(r){
          if(!r.ok)return;var l=document.getElementById('dm-county-links');
          if(l&&q.value===h[1])l.insertAdjacentHTML('beforeend',' &middot; <a href="'+esc(rain)+'" style="color:var(--gold)">Rain so far this year</a>');
        }).catch(function(){});
      }).catch(function(){out.textContent='That county\u2019s record did not load. Try again.';});
    }
    function loadRain(h){
      var st=String(h[1]).split(', ').pop().toLowerCase();
      if(!/^[a-z]{2}$/.test(st))return;
      fetch('/data/rain/'+st+'.json').then(function(r){return r.ok?r.json():null;}).then(function(d){
        var el=document.getElementById('dm-county-rain');
        if(d&&el&&q.value===h[1])el.innerHTML=rainHtml(d,h[0]);
      }).catch(function(){});
    }
    /* The county a reader picked: kept in the address (?county=19169, so the link can be
       shared) and, on this device only, for the next visit. */
    function remember(h){
      try{var u=new URL(location.href);u.searchParams.set('county',h[0]);history.replaceState(null,'',u.pathname+u.search+u.hash);}catch(e){}
      try{localStorage.setItem('agsist-drought-county',h[0]);}catch(e){}
    }
    function startFrom(){
      var f=null;
      try{f=new URLSearchParams(location.search).get('county');}catch(e){}
      if(!f){try{f=localStorage.getItem('agsist-drought-county');}catch(e){}}
      if(!f||!/^\d{5}$/.test(f))return;
      loadIdx().then(function(a){for(var i=0;i<a.length;i++){if(a[i][0]===f){pick(a[i]);return;}}}).catch(function(){});
    }
    q.addEventListener('input',show);
    startFrom();
  })();
