/* harvest-clock.js -- the harvest price clock, on the homepage and /daily.

   Draws data/daily.json -> harvest_clock, which scripts/harvest_clock.py
   builds from USDA RMA's own figures (data/rma-prices.json): RMA's running
   harvest price, its projected price, and RMA's window dates. Nothing here
   computes a price. It only decides whether a reader should see the block
   today: inside the window, and the RMA file no more than 3 days old.
   Anything missing, out of window or stale draws nothing at all. */
(function(){
  'use strict';
  var STALE_DAYS=3;
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function day(s){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(s||''));return m?Date.UTC(+m[1],+m[2]-1,+m[3]):null;}
  function todayCT(now){
    try{return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(now||new Date());}
    catch(e){var d=now||new Date();return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);}
  }
  function visible(b,now){
    if(!b||!b.lines||!b.lines.length)return null;
    var t=day(todayCT(now)),a=day(b.asof),s=day(b.start),e=day(b.end);
    if(t==null||a==null||s==null||e==null)return null;
    if(t<s||t>e||(t-a)/864e5>STALE_DAYS)return null;
    return b;
  }
  function html(b,now){
    b=visible(b,now);if(!b)return '';
    return '<div class="hclock" role="note" aria-label="Harvest price clock">'+
      '<div class="hclock-label">Harvest price clock</div>'+
      b.lines.map(function(l){return '<p class="hclock-line">'+esc(l)+'</p>';}).join('')+
      '<p class="hclock-note">'+esc(b.note||'')+' <a href="'+esc(b.url||'/harvest-price-tracker')+'">Harvest price tracker &rarr;</a></p>'+
    '</div>';
  }
  /* The homepage slot: #home-hclock, filled from the briefing data. */
  function mount(data,now){
    var el=document.getElementById('home-hclock');if(!el)return;
    var h=html(data&&data.harvest_clock,now);
    el.innerHTML=h;el.hidden=!h;
  }
  window.agsistHarvestClock={html:html,visible:visible,mount:mount};
  if(window.AGSIST_DAILY)mount(window.AGSIST_DAILY);
})();
