/* fold/drought.js: the drought tab on /rain (was the inline scripts of /drought-monitor until Nov 11, 2026),
 * in their old order. Loaded by components/page-tabs.js the first time the tab opens. */
fetch("/data/outlooks/manifest.json").then(function(r){return r.json()}).then(function(m){var f=(m&&m.files)||{};var d=(f["usdm_latest.png"]&&f["usdm_latest.png"].data_valid)||(m&&m.usdm_latest&&m.usdm_latest.data_valid)||(m&&m.data_valid);if(d){var v=document.getElementById("dm-valid"),h=window.AgAsOf?AgAsOf.html(d,"drought",{prefix:"Map valid"}):"";if(h)v.innerHTML=h;else v.textContent="Map valid "+d;window.__dmValid=d;var mv=document.getElementById("dm-map-valid");if(mv)mv.textContent=", valid "+d;}}).catch(function(){});
/* Headline: NDMC's own percent of the Lower 48 (and, in the state view, of each state) in
     each category, from data/drought/summary.json (scripts/fetch_drought_county_week.py, each
     Thursday). Only subtraction is done here. Until the file exists the line above stays as written. */
  (function(){
    function day(iso){var p=String(iso).split('-');return new Date(Date.UTC(+p[0],+p[1]-1,+p[2])).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});}
    function f1(v){return (Math.round(v*10)/10).toFixed(1).replace(/\.0$/,'');}
    function move(a,b,words){
      if(a==null||b==null)return '';
      var d=Math.round((a-b)*10)/10;
      if(d===0)return 'no change from '+words;
      return '<span class="'+(d>0?'dm-up':'dm-down')+'">'+(d>0?'up ':'down ')+f1(Math.abs(d))+' points</span> from '+words;
    }
    function line(r,dates){
      var now=r[0],w1=r[1],w4=r[2],y1=r[3];
      var bits=[move(now[1],w1&&w1[1],'a week before'),move(now[1],w4&&w4[1],'four weeks before')].filter(Boolean);
      return {now:now,moves:bits.join(' and '),year:y1?f1(y1[1])+'% a year before ('+day(dates[3])+')':''};
    }
    window.__dmSummary=fetch('/data/drought/summary.json').then(function(r){if(!r.ok)throw 0;return r.json();}).then(function(S){
      var el=document.getElementById('dm-answer');
      if(!S||!S.conus||!S.conus[0]||!el)return S;
      var L=line(S.conus,S.dates),old=(Date.now()-Date.parse(S.valid+'T00:00:00Z'))/864e5>9;
      el.innerHTML='On the map valid '+day(S.valid)+', <strong>'+f1(L.now[1])+'%</strong> of the Lower 48 is in drought (D1 or worse)'
        +(L.moves?', '+L.moves:'')+'. <strong>'+f1(L.now[2])+'%</strong> is in severe drought (D2) or worse.'
        +(L.year?' In drought '+L.year+'.':'')
        +'<small>Percent of area, from NDMC&rsquo;s U.S. Drought Monitor statistics.'+(old?' This is not the newest map: the weekly read is late.':'')+'</small>';
      return S;
    }).catch(function(){return null;});
    window.__dmStateLine=function(st){
      var el=document.getElementById('dm-state-line');
      if(!el)return;
      el.textContent='';
      if(!st)return;
      window.__dmSummary.then(function(S){
        var r=S&&S.states&&S.states[st];
        if(!r||!r[0]){return;}
        var L=line(r,S.dates);
        el.innerHTML='<b>'+st+'</b>, map valid '+day(S.valid)+': <strong>'+f1(L.now[1])+'%</strong> of the state in drought (D1 or worse)'+(L.moves?', '+L.moves:'')+'; '+f1(L.now[2])+'% severe (D2) or worse. NDMC statistics.';
      });
    };
  })();
(function(){var i=document.getElementById('dm-map-img'),w=i&&i.parentNode;if(!i)return;
        function bad(){w.classList.add('is-broken');} function ok(){w.classList.remove('is-broken');}
        i.addEventListener('error',bad); i.addEventListener('load',ok);
        if(i.complete&&!i.naturalWidth)bad();})();
/* The two outlook images (about 240 KB each) load only when the reader opens the box. */
  (function(){
    var d=document.getElementById('dm-outlook-more');if(!d)return;
    d.addEventListener('toggle',function(){
      if(!d.open||d.dataset.done)return;d.dataset.done='1';
      var box=d.querySelector('.dm-outlook-imgs');
      fetch('/data/outlooks/manifest.json').then(function(r){return r.ok?r.json():{};}).catch(function(){return {};}).then(function(m){
        var f=(m&&m.files)||{};
        [['noaa_prcp_30day.gif','Next month'],['noaa_prcp_90day.gif','Next three months']].forEach(function(x){
          var meta=f[x[0]]||{},when=meta.last_modified?new Date(meta.last_modified).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}):'';
          var fig=document.createElement('figure');fig.style.margin='0';
          fig.innerHTML='<img src="/data/outlooks/'+x[0]+'" alt="NOAA CPC precipitation outlook, '+x[1].toLowerCase()+'" loading="lazy" style="width:100%;height:auto;border-radius:6px;background:#fff">'
            +'<figcaption style="font-size:.78rem;color:var(--text-muted);margin-top:.25rem">'+x[1]+(when?', CPC file dated '+when:'')+'. NOAA CPC.</figcaption>';
          box.appendChild(fig);
        });
      });
    });
  })();
(function(){
  'use strict';

  var VIEWS = {
    // national: the dated copy scripts/fetch_outlooks.py saves after each release, so the
    // image and the "Map valid" label are the same map. Regions and states are NDMC's live images.
    national:   { src: '/data/outlooks/usdm_latest.png',                                             label: 'US · National View',     alt: 'US Drought Monitor: national view' },
    'corn-belt':{ src: 'https://droughtmonitor.unl.edu/data/png/current/current_usdm_Midwest.png',   label: 'Corn Belt · Midwest',    alt: 'US Drought Monitor: Corn Belt / Midwest' },
    plains:     { src: 'https://droughtmonitor.unl.edu/data/png/current/current_usdm_High Plains.png', label: 'High Plains View',     alt: 'US Drought Monitor: High Plains' }
  };

  var AG_STATES = [
    'AL','AR','CA','CO','GA','IA','ID','IL','IN','KS','KY','LA',
    'MI','MN','MO','MS','MT','NC','ND','NE','NY','OH','OK','OR',
    'PA','SC','SD','TN','TX','VA','WA','WI','WY'
  ];

  // Compute next Thursday
  function nextThursday() {
    var d = new Date();
    var day = d.getDay(); // 0=Sun,4=Thu
    var diff = (4 - day + 7) % 7;  // 0 on a Thursday: today IS release day, do not skip a week
    d.setDate(d.getDate() + diff);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  var el = document.getElementById('dm-next-update');
  if (el) el.textContent = 'Next update: ' + nextThursday();

  // AGSIST_STATE auto-detect
  function checkAutoState() {
    var S = window.AGSIST_STATE;
    if (!S || !S.state) return;
    var state = S.state.toUpperCase();
    if (AG_STATES.indexOf(state) === -1) return;
    var banner = document.getElementById('dm-auto-banner');
    var nameEl = document.getElementById('dm-auto-state-name');
    if (banner && nameEl) {
      nameEl.textContent = S.stateName || state;
      banner.style.display = 'flex';
      window._autoState = state;
    }
  }

  window.autoLoadState = function() {
    if (!window._autoState) return;
    // Switch to state tab
    document.querySelectorAll('.dm-tab').forEach(function(t){ t.classList.remove('active'); });
    var stTab = document.querySelector('[data-view="state"]');
    if (stTab) stTab.classList.add('active');
    document.getElementById('dm-state-section').style.display = 'block';
    // Activate the state button
    document.querySelectorAll('.dm-state-btn').forEach(function(b){
      b.classList.remove('active');
      if (b.textContent === window._autoState) {
        b.classList.add('active');
        loadStateMap(window._autoState);
        setTimeout(function(){ b.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 100);
      }
    });
    document.getElementById('dm-auto-banner').style.display = 'none';
  };

  function setMap(view) {
    var img = document.getElementById('dm-map-img');
    var lbl = document.getElementById('dm-map-label');
    var v   = VIEWS[view];
    if (!v) return;
    img.src = v.src;
    img.alt = v.alt;
    lbl.textContent = v.label;
    mapNote(view === 'national');
    if (window.__dmStateLine) window.__dmStateLine(null);
  }
  function mapNote(saved) {
    var n = document.getElementById('dm-map-note');
    if (!n) return;
    if (saved) n.innerHTML = "AGSIST's saved copy of the national map<span id=\"dm-map-valid\">" + (window.__dmValid ? ", valid " + window.__dmValid : "") + "</span>.";
    else n.textContent = "NDMC's live image for this view; it changes when the Thursday map is released.";
  }

  function loadStateMap(st) {
    var img = document.getElementById('dm-map-img');
    var lbl = document.getElementById('dm-map-label');
    img.src = 'https://droughtmonitor.unl.edu/data/png/current/current_usdm_' + st + '.png';
    img.alt = 'US Drought Monitor: ' + st + ' state view';
    lbl.textContent = st + ' · State View';
    mapNote(false);
    if (window.__dmStateLine) window.__dmStateLine(st);
  }

  function buildStateGrid() {
    var grid = document.getElementById('dm-state-grid');
    if (!grid) return;
    AG_STATES.forEach(function(st) {
      var btn = document.createElement('button');
      btn.className = 'dm-state-btn';
      btn.textContent = st;
      btn.addEventListener('click', function() {
        document.querySelectorAll('.dm-state-btn').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        loadStateMap(st);
      });
      grid.appendChild(btn);
    });
  }

  document.querySelectorAll('.dm-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.dm-tab').forEach(function(t){ t.classList.remove('active'); });
      tab.classList.add('active');
      var view = tab.dataset.view;
      var stateSection = document.getElementById('dm-state-section');
      if (view === 'state') {
        stateSection.style.display = 'block';
        setMap('national');
      } else {
        stateSection.style.display = 'none';
        document.querySelectorAll('.dm-state-btn').forEach(function(b){ b.classList.remove('active'); });
        setMap(view);
      }
    });
  });

  buildStateGrid();

  // Run after loader has a chance to set AGSIST_STATE
  setTimeout(checkAutoState, 800);
})();
