/* components/atlas-tenure.js: "Rented vs owner-farmed, 1997 to 2022", the
   national picture that used to be the standalone /land-tenure page.

   Loaded only when a reader opens the fold on /farmland-atlas (that page is
   already over 200 KB, so none of this is inlined). Reads
   /data/tenure/tenure.json (scripts/fetch_tenure.py): Census of Agriculture
   acres owned and rented from others, by census year, for the nation, each
   state and each county. Share rented = rented / (owned + rented), the
   farms' own reports. A suppressed county simply has no figure that year.

   Mount: AgTenure.mount(el)
*/
(function(){
  'use strict';
  if(window.AgTenure) return;
  var NAMES={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'};
  var NO_RENT_PAGE={AK:1,HI:1,RI:1};    // no county cash rent survey pages for these
  var MAJOR_ACRES=5e6;                   // "major farm state": 5 million acres or more in farms, 2022
  var CSS='.at{margin:.4rem 0}.at .at-bar{display:flex;align-items:center;gap:.6rem;margin:.2rem 0;font-family:var(--font-mono);font-size:.8rem}'
    +'.at .at-bar>span{flex:none;white-space:nowrap}.at .at-bar .y{width:3em;color:var(--text-muted)}.at .at-bar .b{height:12px;background:var(--gold);border-radius:3px;min-width:2px;flex:0 1 auto}'
    +'.at .at-bar .m{color:var(--text-muted);font-size:.72rem}.at .at-lead{font-size:1rem;line-height:1.6;margin:.4rem 0 .8rem}'
    +'.at th{cursor:pointer}.at td a{color:var(--gold)}:root[data-theme="light"] .at td a{color:#6f5209}.at .up{color:var(--green)}.at .dn{color:var(--red)}:root[data-theme="light"] .at .dn{color:#b3261e}'
    +'.at details{border-bottom:1px solid var(--border);padding:.45rem 0}.at details summary{cursor:pointer}.at details p{color:var(--text-dim);font-size:.9rem;line-height:1.6;margin:.4rem 0}';

  function esc(t){ return String(t).replace(/[&<>"]/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch];}); }
  function share(p){ return p&&p[0]!=null&&p[1]!=null&&p[0]+p[1]>0?p[1]/(p[0]+p[1]):null; }
  function pc(x){ return (x*100).toFixed(1)+'%'; }
  function mil(x){ return Math.round(x/1e6).toLocaleString('en-US')+' million'; }
  function m1(x){ return (x/1e6).toFixed(1)+'M'; }
  function slug(n){ return n.toLowerCase().replace(/ /g,'-'); }
  function list(a){ return a.length<2?a.join(''):a.slice(0,-1).join(', ')+' and '+a[a.length-1]; }

  function render(el,d){
    var ys=(d.years||[]).map(String), last=ys[ys.length-1], first=ys[0], N=d.national||{};
    var nl=N[last], nf=N[first], sl=share(nl), sf=share(nf);
    if(sl==null){ el.innerHTML='<p class="fa-note">The census tenure file has no national figure. Nothing to show.</p>'; return; }
    // counties: majority-rented, of those with a figure
    var withFig=0, maj=0;
    for(var f in (d.counties||{})){ var s=share((d.counties[f].y||{})[last]); if(s==null) continue; withFig++; if(s>0.5) maj++; }
    // states
    var rows=[];
    for(var st in (d.states||{})){ var y=d.states[st].y||{}, a=share(y[last]), b=share(y[first]);
      if(a==null||!NAMES[st]) continue;
      rows.push({st:st,n:NAMES[st],s:a,d:b==null?null:(a-b)*100,r:y[last][1],o:y[last][0],t:y[last][0]+y[last][1]}); }
    rows.sort(function(x,y){ return y.s-x.s; });
    var major=rows.filter(function(r){ return r.t>=MAJOR_ACRES; });
    var low=rows.slice(-2).reverse();
    var h='<div class="at">';
    h+='<p class="at-lead"><b>'+pc(sl)+'</b> of U.S. farmland is rented from someone else: '+mil(nl[1])+' of '+mil(nl[0]+nl[1])+' acres in the '+last+' census. In '+first+' it was '+pc(sf)+'. '
      +maj.toLocaleString('en-US')+' of '+withFig.toLocaleString('en-US')+' counties with a '+last+' figure are majority-rented. The national share barely moves; the county map is where it moves.</p>';
    var top=Math.max.apply(null,ys.map(function(y){ var s=share(N[y]); return s==null?0:s; }));
    ys.forEach(function(y){ var s=share(N[y]); if(s==null){ h+='<div class="at-bar"><span class="y">'+y+'</span><span class="m">no national figure</span></div>'; return; }
      h+='<div class="at-bar"><span class="y">'+y+'</span><span class="b" style="width:'+(s/top*38).toFixed(1)+'%"></span><span>'+pc(s)+'</span><span class="m">'+m1(N[y][1])+' of '+m1(N[y][0]+N[y][1])+' ac</span></div>'; });
    h+='<h3>Every state, ranked</h3><p class="fa-note">Share of land in farms rented from others, '+last+' census. Tap a heading to sort. A state name opens its county cash rent page.</p>';
    h+='<div class="tblscroll"><table class="fa-table" id="at-t"><thead><tr><th>State</th><th class="n">Rented '+last+'</th><th class="n">Change since '+first+'</th><th class="n">Rented acres</th><th class="n">Owned acres</th></tr></thead><tbody>';
    rows.forEach(function(r){
      h+='<tr><td>'+(NO_RENT_PAGE[r.st]?esc(r.n):'<a href="/rent/'+slug(r.n)+'">'+esc(r.n)+'</a>')+'</td><td class="n" data-v="'+r.s+'">'+pc(r.s)+'</td>'
        +(r.d==null?'<td class="n" data-v="-999">n/a</td>':'<td class="n '+(r.d>=0?'up':'dn')+'" data-v="'+r.d.toFixed(2)+'">'+(r.d>=0?'+':'')+r.d.toFixed(1)+' pts</td>')
        +'<td class="n" data-v="'+r.r+'">'+m1(r.r)+'</td><td class="n" data-v="'+r.o+'">'+m1(r.o)+'</td></tr>'; });
    h+='</tbody></table></div>';
    h+='<p class="fa-note"><b>What this can&rsquo;t tell you.</b> &ldquo;Rented from others&rdquo; is what farms reported to the census. It takes in ground rented from retired neighbors, family, heirs and investors alike. The census does not say where the landlord lives. A small state can show a big share on few acres; the grain states carry the weight.</p>';
    var mj=major.slice(0,5).map(function(r){ return r.n+' ('+pc(r.s)+')'; });
    h+='<h3>Questions</h3>'
      +'<details><summary>What share of U.S. farmland is rented?</summary><p>In the '+last+' Census of Agriculture, farms reported renting '+mil(nl[1])+' of the '+mil(nl[0]+nl[1])+' acres they operate, '+pc(sl)+'. In '+first+' it was '+pc(sf)+'. The share is steady nationally but varies widely by county: '+maj.toLocaleString('en-US')+' counties are majority-rented.</p></details>'
      +'<details><summary>Which states have the most rented farmland?</summary><p>Among states with 5 million acres or more in farms, '+esc(list(mj))+' lead. At the other end of all states: '+esc(list(low.map(function(r){ return r.n+' ('+pc(r.s)+')'; })))+'.</p></details>'
      +'<details><summary>Where does this data come from?</summary><p>The USDA Census of Agriculture, taken every five years ('+ys.join(', ')+'). Farms report acres owned and acres rented from others. The share is rented acres over owned plus rented. No survey sampling, no modeling. Counties USDA suppressed for privacy have no figure for that year.</p></details>'
      +'<details><summary>Does rented farmland mean absentee landlords?</summary><p>Not necessarily. Rented ground includes land owned by retired farmers, widows and heirs still in the county, family members and local investors, as well as owners from away. The census counts the arrangement, not where the landlord lives. What it does tell you: who carries the operating risk (the renter) and who collects a fixed rent (the owner).</p></details>'
      +'<details><summary>Why does the rented share matter for cash rent?</summary><p>The bigger the rented share, the more of a county&rsquo;s farm economy runs through the rental market, and the more the county cash rent is the number. See <a href="/rent/">cash rent by state</a> and the <a href="/cash-lease">printable cash lease</a>. Foreign owners are a different, much smaller dataset: <a href="/foreign-land">foreign-owned land</a>.</p></details>';
    h+='<p class="fa-note">Source: USDA Census of Agriculture '+first+' to '+last+', land in farms by ownership, domain totals. File built '+esc(String(d.generated||'').slice(0,10))+'.</p></div>';
    el.innerHTML=h;
    var t=el.querySelector('#at-t'), b=t.tBodies[0], dir={};
    [].forEach.call(t.tHead.rows[0].cells,function(th,i){ th.addEventListener('click',function(){
      var rs=[].slice.call(b.rows), dd=dir[i]=!dir[i];
      rs.sort(function(x,y){ if(i===0) return dd?x.cells[0].textContent.localeCompare(y.cells[0].textContent):y.cells[0].textContent.localeCompare(x.cells[0].textContent);
        var a=+x.cells[i].getAttribute('data-v'), c=+y.cells[i].getAttribute('data-v'); return dd?c-a:a-c; });
      rs.forEach(function(r){ b.appendChild(r); }); }); });
  }

  window.AgTenure={mount:function(el){
    if(!document.getElementById('at-css')){ var s=document.createElement('style'); s.id='at-css'; s.textContent=CSS; document.head.appendChild(s); }
    el.innerHTML='<p class="fa-note">Opening the census tenure file&hellip;</p>';
    return fetch('/data/tenure/tenure.json').then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; }).then(function(d){
      if(!d){ el.innerHTML='<p class="fa-note">The census tenure file did not load. Close and open this section to try again.</p>'; el.removeAttribute('data-on'); return; }
      render(el,d);
      try{ gaEvent('atlas_tenure_open',{}); }catch(e){}
    });
  }};
})();
