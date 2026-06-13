/* ═══════════════════════════════════════════════════════════════════
   AGSIST Field Scout — field-scout.js
   Draw a polygon → query soil (SSURGO), crop rotation (CDL), weather
   (Open-Meteo), drought (USDM), and nearby cash bids (AGSIST proxy).

   Every source is a public endpoint hit from the user's browser. Each
   query is independent and fails soft — one source being down never
   blanks the others. No boundary data is stored anywhere.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Config: data endpoints ─────────────────────────────────────────
  // Soil, CDL, NDVI, moisture & hail all flow through the Field Scout Worker
  // (handles CORS, the Sentinel Hub OAuth secret, and the CDL reprojection).
  var FS_WORKER = 'https://agsist-fieldscout.dnilgis.workers.dev';                  // ← deploy & set this
  var METEO_URL = 'https://api.open-meteo.com/v1/forecast';
  var BIDS_PROXY= 'https://agsist-barchart.dnilgis.workers.dev';                    // AGSIST cash-bid proxy
  var NOMINATIM = 'https://nominatim.openstreetmap.org/search';

  // CDL crop code → {label, emoji, color}
  var CDL_CROPS = {
    1:{l:'Corn',e:'🌽',c:'#ffd400'}, 5:{l:'Soybeans',e:'🫘',c:'#267300'},
    24:{l:'Winter Wheat',e:'🌾',c:'#a87000'}, 23:{l:'Spring Wheat',e:'🌾',c:'#d8b056'},
    36:{l:'Alfalfa',e:'🌿',c:'#ffa8e3'}, 37:{l:'Other Hay',e:'🌾',c:'#a5f28c'},
    4:{l:'Sorghum',e:'🌾',c:'#ff9e0f'}, 21:{l:'Barley',e:'🌾',c:'#e2007d'},
    28:{l:'Oats',e:'🌾',c:'#a05989'}, 61:{l:'Fallow',e:'🟫',c:'#bfbf7a'},
    176:{l:'Grass/Pasture',e:'🟩',c:'#e8ffbf'}, 121:{l:'Developed',e:'🏘️',c:'#9c9c9c'},
    111:{l:'Open Water',e:'💧',c:'#4970a3'}, 141:{l:'Deciduous Forest',e:'🌳',c:'#93cc93'},
    190:{l:'Woody Wetlands',e:'🌲',c:'#7cafaf'}, 195:{l:'Herbaceous Wetlands',e:'🌾',c:'#7cafaf'},
    2:{l:'Cotton',e:'🪴',c:'#ff2626'}, 3:{l:'Rice',e:'🌾',c:'#00a8e2'},
    6:{l:'Sunflower',e:'🌻',c:'#ffff00'}, 10:{l:'Peanuts',e:'🥜',c:'#70a500'},
    12:{l:'Sweet Corn',e:'🌽',c:'#dda50a'}, 42:{l:'Dry Beans',e:'🫘',c:'#a80000'},
    53:{l:'Peas',e:'🟢',c:'#54ff00'}, 31:{l:'Canola',e:'🌼',c:'#d1ff00'}
  };
  function crop(code){ return CDL_CROPS[code] || {l:'Code '+code,e:'▦',c:'#666'}; }

  // ── State ───────────────────────────────────────────────────────────
  var map, drawnLayer, drawControl, satLayer, mapLayer, gpsMarker;
  var activePoly = null;
  // God-layer overlays
  var godLayer = null;          // current Leaflet tileLayer overlay
  var godActive = '';           // '', 'ndvi', 'moisture'
  var godOpacity = 0.75;
  var godDate = null;           // YYYY-MM-DD for the time-scrubber
  var hailLayer = null;

  // ── FIELD: shared fact store the insight engine reads across all layers ──
  // Each loader writes its findings here; recomputeInsight() crosses them.
  var FIELD = null;
  function resetField(acres, c){
    FIELD = { acres:acres, lat:c.lat, lng:c.lng,
      soil:null, rotation:null, weather:null, drought:null, bids:null, hail:null };
  }

  // ── Boot ────────────────────────────────────────────────────────────
  function init() {
    if (typeof L === 'undefined') { showFatal('Map library failed to load. Check your connection and refresh.'); return; }
    if (typeof L.Draw === 'undefined' || !L.Draw.Polygon) { showFatal('The field-drawing tool failed to load. Refresh the page; if it persists, your network may be blocking unpkg.com.'); return; }

    map = L.map('fs-map', { zoomControl:true, attributionControl:true }).setView([41.878, -93.0977], 6); // Iowa-ish center

    satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom:19, attribution:'Imagery &copy; Esri'
    }).addTo(map);
    mapLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom:19, attribution:'&copy; OpenStreetMap, &copy; CARTO'
    });

    drawnLayer = new L.FeatureGroup().addTo(map);

    drawControl = new L.Draw.Polygon(map, {
      allowIntersection:false,
      shapeOptions:{ color:'#daa520', weight:3, fillColor:'#daa520', fillOpacity:0.15 }
    });

    map.on(L.Draw.Event.CREATED, function (e) {
      drawnLayer.clearLayers();
      activePoly = e.layer;
      drawnLayer.addLayer(activePoly);
      document.getElementById('fs-clear').disabled = false;
      runAll(activePoly);
      ga('field_drawn', { acres: Math.round(polyAcres(activePoly)) });
    });

    wireControls();
    wireGodLayers();
    renderSavedFields();
    tryAutoLocate();
  }

  // ── GOD LAYERS: NDVI / moisture tile overlays + opacity + time scrub ──
  function wireGodLayers(){
    // layer selector chips
    document.querySelectorAll('[data-god]').forEach(function(btn){
      btn.addEventListener('click', function(){ setGodLayer(btn.getAttribute('data-god')); });
    });
    var op = document.getElementById('fs-opacity');
    if(op) op.addEventListener('input', function(){
      godOpacity = +op.value/100;
      if(godLayer) godLayer.setOpacity(godOpacity);
      var lbl=document.getElementById('fs-opacity-val'); if(lbl) lbl.textContent = op.value+'%';
    });
    var sc = document.getElementById('fs-scrub');
    if(sc) sc.addEventListener('input', function(){ scrubTo(+sc.value); });
    var hail = document.getElementById('fs-hail-toggle');
    if(hail) hail.addEventListener('click', function(){ toggleHail(hail); });
  }

  function setGodLayer(which){
    // toggle off if same chip tapped again
    if(godActive===which) which='';
    godActive=which;
    document.querySelectorAll('[data-god]').forEach(function(b){
      b.classList.toggle('on', b.getAttribute('data-god')===which);
    });
    if(godLayer){ map.removeLayer(godLayer); godLayer=null; }
    var panel=document.getElementById('fs-god-controls');
    if(!which){ if(panel) panel.hidden=true; return; }
    if(panel) panel.hidden=false;

    var url = FS_WORKER + '/' + which + '/{z}/{x}/{y}' + (godDate?('?date='+godDate):'');
    godLayer = L.tileLayer(url, { opacity:godOpacity, maxZoom:18, tileSize:256, crossOrigin:true,
      attribution: which==='ndvi' ? 'NDVI: Sentinel-2 / Copernicus' : 'Moisture: Sentinel-1 / Copernicus' }).addTo(map);
    // scrub label visibility: NDVI/moisture both time-aware
    var scrubWrap=document.getElementById('fs-scrub-wrap'); if(scrubWrap) scrubWrap.hidden=false;
    ga('god_layer', { layer: which });
  }

  function scrubTo(weeksAgo){
    // 0 = today, up to 26 weeks back through the season
    var d = new Date(Date.now() - weeksAgo*7*864e5);
    godDate = d.toISOString().slice(0,10);
    var lbl=document.getElementById('fs-scrub-val');
    if(lbl) lbl.textContent = weeksAgo==0 ? 'Latest' : (d.toLocaleDateString(undefined,{month:'short',day:'numeric'}));
    if(godActive && godLayer){
      map.removeLayer(godLayer);
      var url = FS_WORKER + '/' + godActive + '/{z}/{x}/{y}?date='+godDate;
      godLayer = L.tileLayer(url, { opacity:godOpacity, maxZoom:18, tileSize:256, crossOrigin:true }).addTo(map);
    }
  }

  function toggleHail(btn){
    if(hailLayer){ map.removeLayer(hailLayer); hailLayer=null; btn.classList.remove('on'); return; }
    if(!activePoly && !map.getCenter()){ return; }
    var c = activePoly ? polyCentroid(activePoly) : map.getCenter();
    btn.classList.add('on');
    fetch(FS_WORKER + '/hail?lat='+(c.lat).toFixed(4)+'&lon='+(c.lng).toFixed(4)+'&years=5')
      .then(function(r){ return r.json(); })
      .then(function(gj){
        var feats = (gj && gj.features) || [];
        hailLayer = L.layerGroup();
        feats.forEach(function(f){
          if(!f.geometry || !f.geometry.coordinates) return;
          var ll=[f.geometry.coordinates[1], f.geometry.coordinates[0]];
          var mag = (f.properties && (f.properties.magnitude||f.properties.magf)) || '';
          L.circleMarker(ll,{radius:5,color:'#7cd2ff',fillColor:'#7cd2ff',fillOpacity:.6,weight:1})
            .bindPopup('Hail '+(mag?mag+'"':'')+'<br>'+((f.properties&&f.properties.valid)||'')).addTo(hailLayer);
        });
        hailLayer.addTo(map);
        ga('hail_layer', { reports: feats.length });
      }).catch(function(){ btn.classList.remove('on'); });
  }

  function wireControls() {
    document.getElementById('fs-draw').addEventListener('click', function(){ drawControl.enable(); flashHint(); });
    document.getElementById('fs-clear').addEventListener('click', clearField);
    document.getElementById('fs-gps').addEventListener('click', locateMe);
    document.getElementById('fs-addr-go').addEventListener('click', searchAddr);
    document.getElementById('fs-addr').addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); searchAddr(); }});
    document.getElementById('fs-bm-sat').addEventListener('click', function(){ setBasemap('sat'); });
    document.getElementById('fs-bm-map').addEventListener('click', function(){ setBasemap('map'); });
  }

  function setBasemap(which){
    var sat=document.getElementById('fs-bm-sat'), mp=document.getElementById('fs-bm-map');
    if(which==='sat'){ map.removeLayer(mapLayer); satLayer.addTo(map); sat.classList.add('on'); mp.classList.remove('on'); }
    else { map.removeLayer(satLayer); mapLayer.addTo(map); mp.classList.add('on'); sat.classList.remove('on'); }
  }

  function flashHint(){
    var h=document.getElementById('fs-hint');
    if(h){ h.innerHTML='<b>&#9998;</b>&nbsp;Click corners, double-click to finish'; }
  }

  function clearField(){
    drawnLayer.clearLayers(); activePoly=null;
    document.getElementById('fs-clear').disabled=true;
    document.getElementById('fs-results').hidden=true;
    document.getElementById('fs-empty').hidden=false;
    var h=document.getElementById('fs-hint'); if(h) h.innerHTML='<b>&#9998; Draw</b>&nbsp;your field&rarr;';
  }

  // ── SAVED FIELDS (localStorage — on this device only, never our servers) ──
  var SAVE_KEY = 'agsist-fs-fields';
  function loadSavedFields(){
    try { return JSON.parse(localStorage.getItem(SAVE_KEY) || '[]'); } catch(e){ return []; }
  }
  function persistSavedFields(arr){
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(arr.slice(0,30))); } catch(e){}
  }
  function saveCurrentField(){
    if(!activePoly) return;
    var name = prompt('Name this field (e.g. "Home 80", "North quarter"):', 'Field ' + (loadSavedFields().length+1));
    if(name===null) return;
    var pts = latlngs(activePoly).map(function(p){ return [+p.lat.toFixed(6), +p.lng.toFixed(6)]; });
    var arr = loadSavedFields();
    arr.unshift({ id:Date.now(), name:(name||'Untitled').slice(0,40), pts:pts, acres:+polyAcres(activePoly).toFixed(1) });
    persistSavedFields(arr);
    renderSavedFields();
    ga('field_saved', {});
  }
  function deleteSavedField(id){
    persistSavedFields(loadSavedFields().filter(function(f){ return f.id!==id; }));
    renderSavedFields();
  }
  function openSavedField(id){
    var f = loadSavedFields().filter(function(x){ return x.id===id; })[0];
    if(!f) return;
    drawnLayer.clearLayers();
    activePoly = L.polygon(f.pts.map(function(p){ return L.latLng(p[0],p[1]); }), { color:'#daa520', weight:3, fillColor:'#daa520', fillOpacity:.15 });
    drawnLayer.addLayer(activePoly);
    map.fitBounds(activePoly.getBounds(), { padding:[40,40] });
    document.getElementById('fs-clear').disabled = false;
    runAll(activePoly);
  }
  function renderSavedFields(){
    var wrap = document.getElementById('fs-saved');
    if(!wrap) return;
    var arr = loadSavedFields();
    if(!arr.length){ wrap.hidden = true; return; }
    wrap.hidden = false;
    wrap.innerHTML = '<div class="fs-saved-label">Your saved fields <small>(this device only)</small></div>' +
      '<div class="fs-saved-list">' + arr.map(function(f){
        return '<span class="fs-saved-chip" role="group">'+
          '<button class="fs-saved-open" data-id="'+f.id+'" type="button" title="Open '+esc(f.name)+'">'+esc(f.name)+' <small>'+f.acres+'ac</small></button>'+
          '<button class="fs-saved-del" data-del="'+f.id+'" type="button" aria-label="Delete '+esc(f.name)+'">&times;</button>'+
        '</span>';
      }).join('') + '</div>';
    wrap.querySelectorAll('.fs-saved-open').forEach(function(b){ b.addEventListener('click', function(){ openSavedField(+b.getAttribute('data-id')); }); });
    wrap.querySelectorAll('.fs-saved-del').forEach(function(b){ b.addEventListener('click', function(){ deleteSavedField(+b.getAttribute('data-del')); }); });
  }

  // ── Geo helpers ─────────────────────────────────────────────────────
  function tryAutoLocate(){
    if(window.AGSIST_STATE && window.AGSIST_STATE.lat && window.AGSIST_STATE.lon){
      map.setView([window.AGSIST_STATE.lat, window.AGSIST_STATE.lon], 14);
    }
  }
  function locateMe(){
    if(!navigator.geolocation){ return; }
    var btn=document.getElementById('fs-gps'); btn.textContent='Locating…';
    navigator.geolocation.getCurrentPosition(function(p){
      map.setView([p.coords.latitude, p.coords.longitude], 15);
      if(gpsMarker) map.removeLayer(gpsMarker);
      gpsMarker=L.circleMarker([p.coords.latitude,p.coords.longitude],{radius:7,color:'#daa520',fillColor:'#daa520',fillOpacity:.9}).addTo(map);
      btn.innerHTML='&#9678; My location';
    }, function(){ btn.innerHTML='&#9678; My location'; }, {enableHighAccuracy:true,timeout:8000});
  }
  function searchAddr(){
    var q=document.getElementById('fs-addr').value.trim();
    if(!q) return;
    var btn=document.getElementById('fs-addr-go'); btn.textContent='…';
    fetch(NOMINATIM+'?format=json&limit=1&countrycodes=us&q='+encodeURIComponent(q))
      .then(function(r){return r.json();})
      .then(function(d){
        btn.textContent='Go';
        if(d && d[0]){ map.setView([+d[0].lat, +d[0].lon], 15); }
      }).catch(function(){ btn.textContent='Go'; });
  }

  // ── Polygon math (acreage via spherical excess approximation) ───────
  function latlngs(poly){
    var ll = poly.getLatLngs();
    while (Array.isArray(ll) && ll.length && Array.isArray(ll[0])) ll = ll[0];
    return ll;
  }
  function polyAcres(poly){
    // Spherical excess (same approach as Leaflet.GeometryUtil / geodesy):
    // sum over edges of (λ2-λ1)·(2+sinφ1+sinφ2), times R²/2.
    var pts=latlngs(poly), R=6378137, area=0, d2r=Math.PI/180;
    if(pts.length<3) return 0;
    for(var i=0;i<pts.length;i++){
      var p1=pts[i], p2=pts[(i+1)%pts.length];
      area += (p2.lng-p1.lng)*d2r * (2 + Math.sin(p1.lat*d2r) + Math.sin(p2.lat*d2r));
    }
    area = Math.abs(area * R*R / 2.0);   // m²
    return area * 0.000247105;            // → acres
  }
  function polyCentroid(poly){
    var pts=latlngs(poly), lat=0, lng=0;
    pts.forEach(function(p){ lat+=p.lat; lng+=p.lng; });
    return { lat:lat/pts.length, lng:lng/pts.length };
  }
  function wktPolygon(poly){
    var pts=latlngs(poly);
    var coords=pts.map(function(p){ return p.lng.toFixed(6)+' '+p.lat.toFixed(6); });
    coords.push(pts[0].lng.toFixed(6)+' '+pts[0].lat.toFixed(6)); // close ring
    return 'POLYGON(('+coords.join(',')+'))';
  }
  function bboxOf(poly){
    var b=poly.getBounds();
    return { minlat:b.getSouth(), minlng:b.getWest(), maxlat:b.getNorth(), maxlng:b.getEast() };
  }

  // ── Orchestrator ────────────────────────────────────────────────────
  function runAll(poly){
    var c=polyCentroid(poly), acres=polyAcres(poly);
    resetField(acres, c);
    document.getElementById('fs-empty').hidden=true;
    var R=document.getElementById('fs-results');
    R.hidden=false;
    R.innerHTML =
      fieldHead(acres, c) +
      '<div class="fs-section fs-insight-section" id="fs-insight-wrap" hidden>'+
        '<div class="fs-section-h"><span class="ico">🧠</span>The Read on This Field</div>'+
        '<div class="fs-section-body" id="fs-insight"></div>'+
      '</div>' +
      section('soil','🌱','Soil & Productivity','fs-soil') +
      section('rot','🌽','5-Year Crop Rotation','fs-rot') +
      section('wx','🌤️','Weather & Drought','fs-wx') +
      section('risk','🛡️','Risk Profile','fs-risk') +
      section('bids','💰','Nearby Cash Bids','fs-bids');

    // fire all sources independently — fail soft; each calls recomputeInsight()
    var sb=document.getElementById('fs-save'); if(sb) sb.addEventListener('click', saveCurrentField);
    loadSoil(poly);
    loadRotation(poly);
    loadWeather(c);
    loadDrought(c);
    loadBids(c);
    loadHailData(c);
  }

  function fieldHead(acres, c){
    return '<div class="fs-fieldhead">'+
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem">'+
        '<div><div class="acres">'+acres.toFixed(1)+' <small>acres</small></div>'+
        '<div class="coords">center '+c.lat.toFixed(4)+', '+c.lng.toFixed(4)+'</div></div>'+
        '<button class="fs-save-btn" id="fs-save" type="button">&#9733; Save field</button>'+
      '</div>'+
    '</div>';
  }
  function section(id,ico,title,bodyid){
    return '<div class="fs-section"><div class="fs-section-h"><span class="ico">'+ico+'</span>'+title+'</div>'+
      '<div class="fs-section-body" id="'+bodyid+'"><div class="fs-loading"><span class="fs-spin"></span>reading</div></div></div>';
  }
  function setBody(id, html){ var el=document.getElementById(id); if(el) el.innerHTML=html; }
  function setErr(id, msg){ var el=document.getElementById(id); if(el) el.innerHTML='<div class="fs-err">'+msg+'</div>'; }

  // ── 1. SOIL (USDA SSURGO via Soil Data Access) ──────────────────────
  // Spatial query: intersect the drawn polygon with SSURGO map units,
  // aggregate area by soil series, pull the national productivity index.
  function loadSoil(poly){
    var wkt = wktPolygon(poly);
    postJSON(FS_WORKER + '/soil', { wkt: wkt })
      .then(function(d){
        var rows = (d && d.Table) ? d.Table : null;
        if(!rows || !rows.length){ setBody('fs-soil','<div class="fs-err">No SSURGO soil survey published for this spot. Coverage gaps exist in parts of the West and Alaska.</div>'); return; }
        var total=0; rows.forEach(function(r){ total += parseFloat(r[3])||0; });
        // record for the insight engine: dominant class, worst class, prime share
        var classes = rows.map(function(r){ return { name:r[2]||r[1], ac:parseFloat(r[3])||0, nicc:parseInt(r[4],10)||null }; });
        var worst = classes.reduce(function(m,x){ return (x.nicc&&(!m||x.nicc>m.nicc))?x:m; }, null);
        var primeAc = classes.filter(function(x){ return x.nicc&&x.nicc<=2; }).reduce(function(s,x){return s+x.ac;},0);
        FIELD.soil = { classes:classes, total:total, worst:worst, primePct: total?Math.round(primeAc/total*100):null, top:classes[0]||null };
        recomputeInsight();
        var palette=['#7c5a2e','#9c7339','#b58d4f','#c9a878','#8a6a3b','#a37d45'];
        var html = rows.slice(0,6).map(function(r,i){
          var ac=parseFloat(r[3])||0, pct= total? Math.round(ac/total*100):0;
          var nicc = r[4]; // non-irrigated capability class (1 best … 8 worst)
          var cls = nicc ? classText(nicc) : '';
          return '<div class="fs-soil-row">'+
            '<div class="fs-soil-bar" style="background:'+palette[i%palette.length]+'">'+(nicc||'?')+'</div>'+
            '<div class="fs-soil-info"><div class="fs-soil-name">'+esc(r[2]||r[1])+'</div>'+
            '<div class="fs-soil-meta">'+(cls?cls+' · ':'')+ac.toFixed(1)+' ac</div></div>'+
            '<div class="fs-soil-pct">'+pct+'%</div></div>';
        }).join('');
        setBody('fs-soil', html + '<div class="fs-src" style="margin-top:.5rem">USDA SSURGO · number = land capability class (1 best, 8 poorest)</div>');
      })
      .catch(function(){ setErr('fs-soil','Couldn\u2019t reach the USDA soil survey just now. Try again in a moment.'); });
  }
  function classText(n){
    n=parseInt(n,10);
    if(n<=2) return 'Prime cropland';
    if(n<=4) return 'Good, some limits';
    if(n<=6) return 'Marginal / pasture';
    return 'Poor / non-crop';
  }

  // ── 2. CROP ROTATION (USDA Cropland Data Layer) ─────────────────────
  // One Identify on the worker's /cdl route returns this point's CDL crop code
  // for every published year at once (worker hands back rotation[] most-recent-first
  // plus a byYear map). We flip to oldest→newest for the timeline, treat unrecognized
  // codes (developed / water / forest pixel noise) as gaps, and detect corn-on-corn.
  function loadRotation(poly){
    var c = polyCentroid(poly);
    var url = FS_WORKER + '/cdl?lat='+c.lat.toFixed(5)+'&lon='+c.lng.toFixed(5);
    fetch(url).then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){
        if(!d || d.error || !d.rotation || !d.rotation.length){
          setBody('fs-rot','<div class="fs-err">USDA crop history isn\u2019t resolving for this spot. CDL covers the Lower 48; coverage thins at field edges and outside CONUS.</div>'); return;
        }
        // worker returns most-recent-first; flip to oldest→newest for the timeline + streak math
        var recent = d.rotation.slice().reverse();
        var years = recent.map(function(x){ return x.year; });
        // only recognized row/forage crops count toward the headline & streak;
        // CDL noise (developed/water/forest) shows as a gap and breaks any streak
        var codes = recent.map(function(x){ return CDL_CROPS[x.code] ? x.code : null; });
        var cornStreak=0, maxCornStreak=0;
        codes.forEach(function(cd){ if(cd===1){cornStreak++; maxCornStreak=Math.max(maxCornStreak,cornStreak);} else cornStreak=0; });
        var cornCount = codes.filter(function(c){return c===1;}).length;
        var beanCount = codes.filter(function(c){return c===5;}).length;
        FIELD.rotation = { codes:codes, years:years, maxCornStreak:maxCornStreak, cornCount:cornCount,
          beanCount:beanCount, lastCrop: codes[codes.length-1], cornOnCorn: maxCornStreak>=2 };
        recomputeInsight();
        var html='<div class="fs-rotation">'+ codes.map(function(code,i){
          var info = code ? crop(code) : {l:'—',e:'·',c:'#333'};
          return '<div class="fs-rot-year">'+
            '<div class="fs-rot-chip" style="background:'+hexA(info.c,.18)+';border-color:'+hexA(info.c,.5)+'">'+info.e+'</div>'+
            '<div class="fs-rot-crop">'+esc(info.l)+'</div>'+
            '<div class="fs-rot-yr">\''+String(years[i]).slice(2)+'</div></div>';
        }).join('') + '</div>'+
        '<div class="fs-src" style="margin-top:.6rem">USDA Cropland Data Layer · dominant cover at field center</div>';
        setBody('fs-rot', html);
      })
      .catch(function(){ setErr('fs-rot','Couldn\u2019t reach the USDA crop-history service just now.'); });
  }

  // ── 3. WEATHER (Open-Meteo) ─────────────────────────────────────────
  function loadWeather(c){
    var url=METEO_URL+'?latitude='+c.lat.toFixed(4)+'&longitude='+c.lng.toFixed(4)+
      '&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m'+
      '&daily=precipitation_sum,temperature_2m_max,temperature_2m_min'+
      '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&past_days=7&forecast_days=1';
    fetch(url).then(function(r){return r.json();}).then(function(d){
      if(!d || !d.current){ setErr('fs-wx-weather','Weather unavailable.'); return; }
      var cur=d.current;
      var wk=0; if(d.daily&&d.daily.precipitation_sum){ d.daily.precipitation_sum.forEach(function(v){ wk+=(v||0); }); }
      window.__fsWx = {
        temp:Math.round(cur.temperature_2m), hum:Math.round(cur.relative_humidity_2m),
        wind:Math.round(cur.wind_speed_10m), wk:wk.toFixed(2)
      };
      FIELD.weather = window.__fsWx; recomputeInsight();
      renderWx();
    }).catch(function(){ window.__fsWx={err:1}; renderWx(); });
  }
  function loadDrought(c){
    // US Drought Monitor point service (public). If unreachable, the panel
    // simply omits the drought chip rather than blocking weather.
    var url='https://droughtmonitor.unl.edu/DmData/GetDroughtSeverityStatisticsByPoint.ashx?lon='+c.lng.toFixed(4)+'&lat='+c.lat.toFixed(4);
    fetch(url).then(function(r){return r.ok?r.json():null;}).then(function(d){
      var cat='None';
      if(d){
        var lvl = d.DroughtClass!=null ? d.DroughtClass : (d.dm!=null?d.dm:(Array.isArray(d)&&d[0]?d[0].DroughtClass:null));
        cat = droughtLabel(lvl);
      }
      window.__fsDr={cat:cat}; FIELD.drought={cat:cat}; recomputeInsight(); renderWx();
    }).catch(function(){ window.__fsDr={cat:null}; if(FIELD)FIELD.drought={cat:null}; recomputeInsight(); renderWx(); });
  }
  function droughtLabel(lvl){
    if(lvl==null||lvl<0) return 'None';
    return ['Abnormally Dry (D0)','Moderate (D1)','Severe (D2)','Extreme (D3)','Exceptional (D4)'][lvl] || 'None';
  }
  function droughtColor(cat){
    if(!cat||cat==='None') return '#4aab4c';
    if(cat.indexOf('D0')>=0) return '#ffff00';
    if(cat.indexOf('D1')>=0) return '#fcd37f';
    if(cat.indexOf('D2')>=0) return '#ffaa00';
    if(cat.indexOf('D3')>=0) return '#e60000';
    if(cat.indexOf('D4')>=0) return '#730000';
    return '#4aab4c';
  }
  function renderWx(){
    var wx=window.__fsWx, dr=window.__fsDr;
    if(!wx && !dr) return;
    var html='';
    if(wx && !wx.err){
      html += '<div class="fs-stats">'+
        stat(wx.temp+'°','Air temp')+ stat(wx.hum+'%','Humidity')+
        stat(wx.wind+' mph','Wind')+ stat(wx.wk+'"','Rain, 7 days')+'</div>';
    } else if(wx && wx.err){
      html += '<div class="fs-err" style="margin-bottom:.6rem">Weather unavailable right now.</div>';
    } else {
      html += '<div class="fs-loading"><span class="fs-spin"></span>weather</div>';
    }
    if(dr){
      if(dr.cat!=null){
        var col=droughtColor(dr.cat);
        var dmark = (dr.cat==='None')?'●':(dr.cat.indexOf('D3')>=0||dr.cat.indexOf('D4')>=0)?'■':(dr.cat.indexOf('D2')>=0)?'◕':'◐';
        html += '<div style="margin-top:.7rem"><span class="fs-drought" style="background:'+hexA(col,.18)+';color:'+col+';border:1px solid '+hexA(col,.5)+'"><span aria-hidden="true">'+dmark+'</span> Drought: '+esc(dr.cat)+'</span></div>';
      } else {
        html += '<div class="fs-src" style="margin-top:.6rem">Drought status unavailable.</div>';
      }
    }
    setBody('fs-wx', html);
  }
  function stat(v,l){ return '<div class="fs-stat"><div class="fs-stat-v">'+v+'</div><div class="fs-stat-l">'+l+'</div></div>'; }

  // ── Hail history → FIELD + Risk Profile section ─────────────────────
  function loadHailData(c){
    fetch(FS_WORKER + '/hail?lat='+c.lat.toFixed(4)+'&lon='+c.lng.toFixed(4)+'&years=5')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(gj){
        var feats = (gj && gj.features) || [];
        var days={}, maxStone=0;
        feats.forEach(function(f){
          var p=f.properties||{};
          var day=(p.valid||'').slice(0,10); if(day) days[day]=1;
          var mag=parseFloat(p.magnitude||p.magf||0); if(mag>maxStone)maxStone=mag;
        });
        FIELD.hail = { events:feats.length, days:Object.keys(days).length, maxStone:maxStone, years:5 };
        recomputeInsight(); renderRisk();
      })
      .catch(function(){ if(FIELD)FIELD.hail={err:1}; renderRisk(); });
  }

  function renderRisk(){
    if(!FIELD) return;
    var soil=FIELD.soil, hail=FIELD.hail, rot=FIELD.rotation, dr=FIELD.drought;
    var rows=[];
    if(soil && soil.worst){
      var wc=soil.worst.nicc;
      var sv = wc<=2?'Low':wc<=4?'Moderate':wc<=6?'Elevated':'High';
      var sc = wc<=2?'#4aab4c':wc<=4?'#ffd400':wc<=6?'#ff9326':'#d9534f';
      rows.push(riskRow('Soil limitation', sv, sc, 'Worst ground on the field is class '+wc+(soil.primePct!=null?' · '+soil.primePct+'% prime':'')));
    }
    if(hail && !hail.err){
      var hv = hail.days===0?'Low':hail.days<=1?'Moderate':hail.days<=3?'Elevated':'High';
      var hc = hail.days===0?'#4aab4c':hail.days<=1?'#ffd400':hail.days<=3?'#ff9326':'#d9534f';
      rows.push(riskRow('Hail exposure', hv, hc, hail.days+' hail day'+(hail.days===1?'':'s')+' within ~40mi in 5 yrs'+(hail.maxStone?' · max '+hail.maxStone+'"':'')));
    }
    if(rot && rot.cornOnCorn){
      rows.push(riskRow('Rotation stress', 'Elevated', '#ff9326', rot.maxCornStreak+' yrs continuous corn detected — yield-drag & disease pressure'));
    }
    if(dr && dr.cat && dr.cat!=='None'){
      rows.push(riskRow('Drought', (dr.cat.indexOf('D3')>=0||dr.cat.indexOf('D4')>=0)?'High':'Moderate',
        (dr.cat.indexOf('D3')>=0||dr.cat.indexOf('D4')>=0)?'#d9534f':'#ffd400', 'Currently '+dr.cat));
    }
    if(!rows.length){
      setBody('fs-risk', (hail&&hail.err) ? '<div class="fs-err">Hail history unavailable right now.</div>' : '<div class="fs-loading"><span class="fs-spin"></span>assessing</div>');
      return;
    }
    setBody('fs-risk', rows.join('') +
      '<div class="fs-src" style="margin-top:.5rem">A starting risk read from public data &mdash; not an underwriting decision. Questions? <a href="https://farmers1st.com/" target="_blank" rel="noopener" style="color:var(--brand,var(--gold))">Farmers First &rarr;</a></div>');
  }
  function riskRow(label, level, color, detail){
    // Colorblind-safe: a symbol carries severity independent of color.
    var mark = level==='Low'?'●':level==='Moderate'?'◐':level==='Elevated'?'◕':'■';
    return '<div class="fs-risk-row">'+
      '<div class="fs-risk-label">'+esc(label)+'<small>'+esc(detail)+'</small></div>'+
      '<span class="fs-risk-badge" style="background:'+hexA(color,.16)+';color:'+color+';border:1px solid '+hexA(color,.45)+'"><span aria-hidden="true">'+mark+'</span> '+esc(level)+'</span>'+
    '</div>';
  }

  // ── 5. CASH BIDS (AGSIST proxy → Barchart getGrainBids) ─────────────
  function loadBids(c){
    // Reverse-geocode to a ZIP, then the same call cash-bids.html uses.
    fetch(NOMINATIM.replace('/search','/reverse')+'?format=json&lat='+c.lat.toFixed(4)+'&lon='+c.lng.toFixed(4))
      .then(function(r){return r.json();})
      .then(function(g){
        var zip = g && g.address ? (g.address.postcode||'').slice(0,5) : '';
        if(!zip){ setErr('fs-bids','Couldn\u2019t resolve a ZIP for this field to pull bids.'); return; }
        return fetch(BIDS_PROXY+'?zip='+zip+'&radius=75&getAllBids=1')
          .then(function(r){return r.json();})
          .then(function(d){ renderBids(d, zip); });
      })
      .catch(function(){ setErr('fs-bids','Couldn\u2019t reach the cash-bid feed just now.'); });
  }
  function renderBids(d, zip){
    // Mirror cash-bids.html flatten(): bids nested under item.bids[],
    // fields cashprice & commodity_display_name.
    var items = (d && (d.results||d.data||d.bids)) || [];
    var flat=[];
    items.forEach(function(item){
      var elev = item.location||item.elevatorName||item.name||'Elevator';
      var city = item.city||''; var dist=item.distance;
      var bids = item.bids||[];
      bids.forEach(function(b){
        flat.push({
          elev:elev, city:city, dist:dist,
          commodity:b.commodity_display_name||b.commodity||'',
          cash:parseFloat(b.cashprice||b.cashPrice),
          basis:b.basis!=null?parseFloat(b.basis):null
        });
      });
    });
    flat = flat.filter(function(x){ return !isNaN(x.cash); }).sort(function(a,b){ return (a.dist||999)-(b.dist||999); });
    if(!flat.length){ setBody('fs-bids','<div class="fs-err">No cash bids reporting near ZIP '+esc(zip)+' right now.</div>'); return; }
    // record best corn & bean bid for the insight engine
    var corn=flat.filter(function(x){return /corn/i.test(x.commodity);}).sort(function(a,b){return b.cash-a.cash;})[0];
    var bean=flat.filter(function(x){return /bean|soy/i.test(x.commodity);}).sort(function(a,b){return b.cash-a.cash;})[0];
    if(FIELD) { FIELD.bids = { corn:corn, bean:bean, zip:zip, count:flat.length }; recomputeInsight(); }
    var html = flat.slice(0,6).map(function(x){
      var basis = x.basis!=null ? '<span class="fs-bid-basis" style="color:'+(x.basis>=0?'#4aab4c':'#d9534f')+'">'+(x.basis>=0?'+':'')+x.basis.toFixed(2)+'</span>' : '';
      return '<div class="fs-bid-row"><div class="fs-bid-el">'+esc(x.commodity)+' <small>'+esc(x.elev)+(x.dist?' · '+Math.round(x.dist)+' mi':'')+'</small></div>'+
        '<div style="text-align:right"><div class="fs-bid-px">$'+x.cash.toFixed(2)+'</div>'+basis+'</div></div>';
    }).join('');
    setBody('fs-bids', html + '<div class="fs-src" style="margin-top:.5rem"><a href="/cash-bids" style="color:var(--brand,var(--gold))">All bids near ZIP '+esc(zip)+' →</a></div>');
  }

  // ═══════════════════════════════════════════════════════════════════
  // THE BRAIN — recomputeInsight() crosses every layer into one plain read.
  // Runs each time a layer lands; the read sharpens as more facts arrive.
  // This is the move from "dashboard of facts" to "what your field is
  // telling you." Honest hedging: it speaks only to what it actually knows.
  // ═══════════════════════════════════════════════════════════════════
  function recomputeInsight(){
    if(!FIELD) return;
    var s=FIELD.soil, r=FIELD.rotation, w=FIELD.weather, d=FIELD.drought, b=FIELD.bids, h=FIELD.hail;
    var lines=[], flags=[];

    // ── Headline: the field's fundamental character (soil × rotation) ──
    if(s && s.top){
      var headSoil = s.primePct!=null && s.primePct>=70 ? 'mostly prime ground'
        : (s.worst && s.worst.nicc>=5) ? 'mixed ground with some marginal acres'
        : 'solid, workable ground';
      var lead = 'This '+FIELD.acres.toFixed(0)+'-acre field is <strong>'+headSoil+'</strong>, led by '+esc(s.top.name)+'.';
      lines.push(lead);
    }

    // ── The cross-reference insights (where the magic is) ──
    // Worst soil + corn-on-corn = double yield drag
    if(s && s.worst && r && r.cornOnCorn){
      if(s.worst.nicc>=4){
        flags.push('Your weaker ground (class '+s.worst.nicc+') is also carrying <strong>'+r.maxCornStreak+' years of continuous corn</strong> — that\u2019s two strikes against yield in the same spot. A rotation break there is the highest-ROI change on this field.');
      } else {
        flags.push('Good soil, but <strong>'+r.maxCornStreak+' years corn-on-corn</strong> is building disease and nitrogen pressure — worth a rotation break before it costs you.');
      }
    } else if(r && r.cornOnCorn){
      flags.push('CDL shows <strong>'+r.maxCornStreak+' straight years of corn</strong> here — watch for rootworm and the corn-on-corn yield drag.');
    }

    // Hail history + this is insurance country (the moat)
    if(h && !h.err && h.days>=2){
      flags.push('This ground has taken <strong>'+h.days+' hail days in five years</strong>'+(h.maxStone?' (up to '+h.maxStone+'" stones)':'')+' — a real factor for your coverage decisions.');
    }

    // Drought + current crop
    if(d && d.cat && d.cat!=='None' && (d.cat.indexOf('D2')>=0||d.cat.indexOf('D3')>=0||d.cat.indexOf('D4')>=0)){
      flags.push('Currently in <strong>'+esc(d.cat)+'</strong> — moisture is the variable to watch on this field right now.');
    }

    // Marketing nudge: what it could sell for nearby
    if(b && (b.corn||b.bean)){
      var mk=[];
      if(b.corn) mk.push('corn near $'+b.corn.cash.toFixed(2));
      if(b.bean) mk.push('beans near $'+b.bean.cash.toFixed(2));
      if(mk.length) lines.push('Closest cash market: '+mk.join(', ')+' ('+esc((b.corn||b.bean).elev)+').');
    }

    // Vigor prompt (NDVI is a visual layer, so nudge them to it)
    if(s && r && !flags.length){
      lines.push('No red flags in the soil and rotation here — flip on <strong>Crop vigor</strong> to see how the stand is actually doing this season.');
    }

    if(!lines.length && !flags.length) return; // nothing meaningful yet

    var wrap=document.getElementById('fs-insight-wrap');
    if(wrap) wrap.hidden=false;
    var html = lines.map(function(l){ return '<p class="fs-insight-p">'+l+'</p>'; }).join('');
    if(flags.length){
      html += '<div class="fs-insight-flags">'+ flags.map(function(f){
        return '<div class="fs-insight-flag"><span class="fs-flag-mark">!</span><div>'+f+'</div></div>';
      }).join('') +'</div>';
    }
    setBody('fs-insight', html);
  }

  // ── utils ───────────────────────────────────────────────────────────
  function postJSON(url, body){
    return fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) })
      .then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); });
  }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function hexA(hex,a){
    var h=hex.replace('#',''); if(h.length===3){h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];}
    var n=parseInt(h,16); return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+a+')';
  }
  function ga(n,p){ try{ if(typeof window.gtag==='function') gtag('event',n,p||{}); }catch(e){} }
  function showFatal(msg){ var p=document.getElementById('fs-empty'); if(p) p.innerHTML='<div class="fs-err">'+msg+'</div>'; }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
