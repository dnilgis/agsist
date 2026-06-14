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
  var pinArmed=false, cornerHandles=[];
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
  // Generation token: bumped on every new draw. Each loader captures the gen it
  // was fired under and discards its result if a newer field has since been drawn,
  // so an in-flight fetch from a previous field can never write into the new one.
  var fieldGen = 0;
  function resetField(acres, c){
    fieldGen++;
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
      commitField(e.layer, 'draw');
    });

    // Graceful pin-drop: when armed, the next map tap drops an editable field box.
    map.on('click', function(e){
      if(pinArmed){ disarmPin(); dropFieldBox(e.latlng.lat, e.latlng.lng); }
    });

    wireControls();
    wireGodLayers();
    // Track clicks on the in-Read "Run the presell math" call-to-action (delegated,
    // since The Read's HTML is re-rendered on every field).
    document.addEventListener('click', function(e){
      var a = e.target && e.target.closest && e.target.closest('.fs-act-link');
      if(a) ga('presell_click', {});
    });
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
      var on = b.getAttribute('data-god')===which;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if(godLayer){ map.removeLayer(godLayer); godLayer=null; }
    var panel=document.getElementById('fs-god-controls');
    if(!which){ if(panel) panel.hidden=true; return; }
    if(panel) panel.hidden=false;

    var url = FS_WORKER + '/' + which + '/{z}/{x}/{y}' + (godDate?('?date='+godDate):'');
    godLayer = L.tileLayer(url, { opacity:godOpacity, maxZoom:18, minZoom:9, tileSize:256, crossOrigin:true,
      attribution: which==='ndvi' ? 'NDVI: Sentinel-2 / Copernicus' : 'Moisture: Sentinel-1 / Copernicus' }).addTo(map);
    // These layers only render at field scale (zoom 9+): a national-view request
    // would fire dozens of Sentinel tiles at once and hit the processing rate limit.
    if(map.getZoom() < 9){ var hh=document.getElementById('fs-hint'); if(hh) hh.innerHTML='<b>&#128269;</b>&nbsp;Zoom in to your field to see '+(which==='ndvi'?'crop vigor':'soil moisture'); }
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
      godLayer = L.tileLayer(url, { opacity:godOpacity, maxZoom:18, minZoom:9, tileSize:256, crossOrigin:true }).addTo(map);
    }
  }

  function toggleHail(btn){
    if(hailLayer){ map.removeLayer(hailLayer); hailLayer=null; btn.classList.remove('on'); btn.setAttribute('aria-pressed','false'); return; }
    if(!activePoly && !map.getCenter()){ return; }
    var c = activePoly ? polyCentroid(activePoly) : map.getCenter();
    btn.classList.add('on'); btn.setAttribute('aria-pressed','true');
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
    var pinBtn=document.getElementById('fs-pin'); if(pinBtn) pinBtn.addEventListener('click', armPinDrop);
    document.getElementById('fs-draw').addEventListener('click', function(){ drawControl.enable(); flashHint(); });
    document.getElementById('fs-clear').addEventListener('click', clearField);
    document.getElementById('fs-gps').addEventListener('click', locateMe);
    document.getElementById('fs-addr-go').addEventListener('click', searchAddr);
    var demoBtn=document.getElementById('fs-demo'); if(demoBtn) demoBtn.addEventListener('click', loadDemoField);
    document.getElementById('fs-addr').addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); searchAddr(); }});
    document.getElementById('fs-bm-sat').addEventListener('click', function(){ setBasemap('sat'); });
    document.getElementById('fs-bm-map').addEventListener('click', function(){ setBasemap('map'); });
  }

  function setBasemap(which){
    var sat=document.getElementById('fs-bm-sat'), mp=document.getElementById('fs-bm-map');
    if(which==='sat'){ map.removeLayer(mapLayer); satLayer.addTo(map); sat.classList.add('on'); mp.classList.remove('on'); }
    else { map.removeLayer(satLayer); mapLayer.addTo(map); mp.classList.add('on'); sat.classList.remove('on'); }
  }

  function flashHint(msg){
    var h=document.getElementById('fs-hint');
    if(h){ h.innerHTML='<b>&#9998;</b>&nbsp;'+(msg||'Click corners, double-click to finish'); }
  }

  function clearField(){
    drawnLayer.clearLayers(); activePoly=null;
    clearHandles(); disarmPin();
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
        if(d && d[0]){
          map.setView([+d[0].lat, +d[0].lon], 16);
          // One-step flow: drop you on your ground, then prompt the trace and offer a
          // no-mouse fallback (a default box you can analyze or adjust).
          afterLocate(+d[0].lat, +d[0].lon);
        } else {
          flashHint('No match — try a town + state, or pan the map and trace your field.');
        }
      }).catch(function(){ btn.textContent='Go'; flashHint('Address lookup is busy — pan the map and trace your field.'); });
  }

  // After we land on a spot (search or GPS), prompt the draw and surface a keyboard-
  // accessible "analyze a default field box here" affordance so drawing isn't the
  // only way in.
  function afterLocate(lat, lng){
    try { drawControl.enable(); } catch(e){}
    flashHint('Trace your field on the map &mdash; or use “Analyze a field box here.”');
    var host=document.getElementById('fs-hint'); if(!host) return;
    if(document.getElementById('fs-boxbtn')) return;
    var b=document.createElement('button');
    b.id='fs-boxbtn'; b.type='button'; b.className='fs-boxbtn';
    b.textContent='Analyze a field box here';
    b.addEventListener('click', function(){ dropFieldBox(lat, lng); });
    host.appendChild(b);
  }

  // A ~40-acre square centered on a point — a real, analyzable field for keyboard
  // users and a fast start anyone can nudge. Honest: it's an approximate box, not a
  // surveyed boundary.
  // ── Graceful pin-drop: tap once to drop an editable field box, drag corners to fit ──
  function armPinDrop(){
    pinArmed=true;
    try { drawControl.disable(); } catch(e){}
    flashHint('Tap your field on the map');
    try { map.getContainer().style.cursor='crosshair'; } catch(e){}
    ga('field_pin', {});
  }
  function disarmPin(){
    pinArmed=false;
    try { map.getContainer().style.cursor=''; } catch(e){}
  }
  function clearHandles(){
    cornerHandles.forEach(function(h){ try{ map.removeLayer(h); }catch(e){} });
    cornerHandles=[];
  }
  function cornerIcon(){
    return L.divIcon({ className:'fs-corner-handle', iconSize:[16,16], iconAnchor:[8,8] });
  }
  // Add draggable corner handles so a dropped box can be nudged to fit the real field.
  // Dragging reshapes the polygon live; releasing re-runs the analysis on the new shape.
  function makeEditable(poly){
    clearHandles();
    var ring = poly.getLatLngs()[0];
    ring.forEach(function(pt, i){
      var h = L.marker(pt, { draggable:true, icon:cornerIcon(), zIndexOffset:1000, keyboard:false });
      h.on('drag', function(ev){
        var pts = poly.getLatLngs()[0];
        pts[i] = ev.target.getLatLng();
        poly.setLatLngs(pts);
        var hd=document.getElementById('fs-hint'); if(hd) hd.innerHTML='<b>&#9998;</b>&nbsp;'+Math.round(polyAcres(poly))+' ac &middot; drag corners to fit';
      });
      h.on('dragend', function(){
        activePoly = poly;
        runAll(poly);
        ga('field_edit', {});
      });
      h.addTo(map);
      cornerHandles.push(h);
    });
  }

  function dropFieldBox(lat, lng){
    var dLat=0.00255, dLng=0.00255/Math.max(0.2,Math.cos(lat*Math.PI/180)); // ~40ac
    var ring=[[lat+dLat,lng-dLng],[lat+dLat,lng+dLng],[lat-dLat,lng+dLng],[lat-dLat,lng-dLng]];
    var poly=L.polygon(ring, { color:'#daa520', weight:3, fillColor:'#daa520', fillOpacity:0.15 });
    try { drawControl.disable(); } catch(e){}
    commitField(poly, 'box');
    makeEditable(poly);
    flashHint(Math.round(polyAcres(poly))+' ac &middot; drag corners to fit');
    ga('field_box', { acres: Math.round(polyAcres(poly)) });
  }

  // The demo field — a real central-Iowa field so first-time visitors see the whole
  // payoff before drawing anything (also the keyboard/screen-reader way to evaluate).
  function loadDemoField(){
    // Rural row-crop ground in Sherman Township, Hardin County, Iowa (~13 people/sq mi —
    // gridded corn/soybean section land, full SSURGO + CDL coverage). ~40-acre box.
    var ring=[[42.3468,-93.3924],[42.3468,-93.3876],[42.3432,-93.3876],[42.3432,-93.3924]];
    var poly=L.polygon(ring, { color:'#daa520', weight:3, fillColor:'#daa520', fillOpacity:0.15 });
    map.setView([42.3450,-93.3900], 15);
    commitField(poly, 'demo');
    ga('field_demo', {});
  }

  // Shared commit path for every way a field enters: draw, demo, box.
  function commitField(poly, src){
    drawnLayer.clearLayers();
    if(src!=='box') clearHandles();
    activePoly = poly;
    drawnLayer.addLayer(poly);
    try { map.fitBounds(poly.getBounds(), { padding:[40,40], maxZoom:16 }); } catch(e){}
    var cb=document.getElementById('fs-clear'); if(cb) cb.disabled=false;
    runAll(poly);
    if(src==='draw') ga('field_drawn', { acres: Math.round(polyAcres(poly)) });
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
        '<div class="fs-section-h"><span class="ico">'+ICONS.read+'</span>The Read on This Field</div>'+
        '<div class="fs-section-body" id="fs-insight"></div>'+
      '</div>' +
      section('soil',ICONS.soil,'Soil & Productivity','fs-soil') +
      section('rot',ICONS.rot,'5-Year Crop Rotation','fs-rot') +
      section('wx',ICONS.wx,'Weather & Drought','fs-wx') +
      section('season',ICONS.season,'Season vs Normal','fs-season') +
      section('risk',ICONS.risk,'Risk Profile','fs-risk') +
      section('bids',ICONS.bids,'Nearby Cash Bids','fs-bids');

    // fire all sources independently — fail soft; each calls recomputeInsight()
    var sb=document.getElementById('fs-save'); if(sb) sb.addEventListener('click', saveCurrentField);
    var rb=document.getElementById('fs-report'); if(rb) rb.addEventListener('click', generateReport);
    loadSoil(poly);
    loadRotation(poly);
    loadWeather(c);
    loadDrought(c);
    loadSeason(c);
    loadBids(c);
    loadHailData(c);
  }

  function fieldHead(acres, c){
    return '<div class="fs-fieldhead">'+
      '<div class="fs-fh-row">'+
        '<div class="fs-fh-main"><div class="acres">'+acres.toFixed(1)+' <small>acres</small></div>'+
        '<div class="coords">center '+c.lat.toFixed(4)+', '+c.lng.toFixed(4)+'</div></div>'+
        '<div class="fs-fh-btns">'+
        '<button class="fs-save-btn" id="fs-save" type="button">&#9733; Save field</button>'+
        '<button class="fs-save-btn" id="fs-report" type="button">&#11015; Field report</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }
  function section(id,ico,title,bodyid){
    return '<div class="fs-section"><div class="fs-section-h"><span class="ico">'+ico+'</span>'+title+'</div>'+
      '<div class="fs-section-body" id="'+bodyid+'"><div class="fs-loading"><span class="fs-spin"></span>reading</div></div></div>';
  }
  // Consistent stroke-based icon set (Lucide-style, currentColor inherits the gold
  // header accent). Replaces emoji section icons for a uniform, designed feel.
  var SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var ICONS={
    read:  SVG+'<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.8c.6.4 1 1.1 1 1.9h6c0-.8.4-1.5 1-1.9A7 7 0 0 0 12 2Z"/></svg>',
    soil:  SVG+'<path d="M12 22V12"/><path d="M12 12C12 8 9 6 5 6c0 4 3 6 7 6Z"/><path d="M12 11c0-3 2-5 6-5 0 3-2 5-6 5Z"/></svg>',
    rot:   SVG+'<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
    wx:    SVG+'<circle cx="8" cy="8" r="3"/><path d="M8 1v1M8 14v1M1 8h1M14 8h1M3 3l.7.7M12.3 3l-.7.7"/><path d="M17.5 19a3.5 3.5 0 0 0 0-7 4.5 4.5 0 0 0-8.6 1.4A3 3 0 0 0 9.5 19Z"/></svg>',
    season:SVG+'<path d="M3 17l6-6 4 4 7-7"/><path d="M17 8h4v4"/></svg>',
    risk:  SVG+'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>',
    bids:  SVG+'<circle cx="12" cy="12" r="9"/><path d="M12 6v12"/><path d="M14.6 9c0-1.3-1.1-1.9-2.6-1.9s-2.6.6-2.6 1.9 1.1 1.7 2.6 1.9 2.6.6 2.6 1.9-1.1 1.9-2.6 1.9-2.6-.6-2.6-1.9"/></svg>'
  };
  function setBody(id, html){ var el=document.getElementById(id); if(el) el.innerHTML=html; }
  function setErr(id, msg){ var el=document.getElementById(id); if(el) el.innerHTML='<div class="fs-err">'+msg+'</div>'; }

  // ── 1. SOIL (USDA SSURGO via Soil Data Access) ──────────────────────
  // Spatial query: intersect the drawn polygon with SSURGO map units,
  // aggregate area by soil series, pull the national productivity index.
  function loadSoil(poly, tries){
    var gen = fieldGen;
    var wkt = wktPolygon(poly);
    postJSON(FS_WORKER + '/soil', { wkt: wkt })
      .then(function(d){
        if(gen !== fieldGen) return;
        var rows = (d && d.Table) ? d.Table : null;
        if(!rows || !rows.length){ setBody('fs-soil','<div class="fs-err">No SSURGO soil survey published for this spot. Coverage gaps exist in parts of the West and Alaska.</div>'); return; }
        var total=0; rows.forEach(function(r){ total += parseFloat(r[3])||0; });
        // record for the insight engine: dominant class, worst class, prime share
        var classes = rows.map(function(r){ return { name:r[2]||r[1], ac:parseFloat(r[3])||0, nicc:parseInt(r[4],10)||null, slope:(r[5]==null||r[5]==='')?null:parseFloat(r[5]), nccpi:(r[6]==null||r[6]==='')?null:parseFloat(r[6]), nccpiCorn:(r[7]==null||r[7]==='')?null:parseFloat(r[7]), nccpiSoy:(r[8]==null||r[8]==='')?null:parseFloat(r[8]) }; });
        var worst = classes.reduce(function(m,x){ return (x.nicc&&(!m||x.nicc>m.nicc))?x:m; }, null);
        var primeAc = classes.filter(function(x){ return x.nicc&&x.nicc<=2; }).reduce(function(s,x){return s+x.ac;},0);
        // Field slope + steepest mapunit (erosion is largely slope-driven). Prefer
        // area-weighting; when acreage is unavailable (helper query returns no per-
        // mapunit area), fall back to an equal-weight average so slope still reads.
        var hasAc = total>0;
        var slAc=0, slSum=0, slN=0, slPlain=0, maxSlope=null;
        classes.forEach(function(x){ if(x.slope!=null){ slSum+=x.slope*x.ac; slAc+=x.ac; slPlain+=x.slope; slN++; if(maxSlope==null||x.slope>maxSlope)maxSlope=x.slope; } });
        var avgSlope = slAc>0 ? Math.round(slSum/slAc*10)/10 : (slN>0 ? Math.round(slPlain/slN*10)/10 : null);
        // Prime ground %: by acreage when known, else by share of mapunits that are class<=2.
        var primeClassN = classes.filter(function(x){ return x.nicc&&x.nicc<=2; }).length;
        var primePct = hasAc ? Math.round(primeAc/total*100) : (classes.length ? Math.round(primeClassN/classes.length*100) : null);
        // NCCPI (productivity index, 0-1): area-weighted when known, else equal-weight.
        function wNccpi(key){ var a=0,s=0,p=0,n=0; classes.forEach(function(x){ if(x[key]!=null){ s+=x[key]*x.ac; a+=x.ac; p+=x[key]; n++; } }); return a>0?Math.round(s/a*1000)/1000:(n>0?Math.round(p/n*1000)/1000:null); }
        FIELD.soil = { classes:classes, total:total, hasAc:hasAc, worst:worst, primePct:primePct,
                       top:classes[0]||null, slope:avgSlope, maxSlope:maxSlope,
                       nccpi:wNccpi('nccpi'), nccpiCorn:wNccpi('nccpiCorn'), nccpiSoy:wNccpi('nccpiSoy') };
        recomputeInsight(); renderRisk();
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
        var slopeNote = '';
        if(FIELD.soil.nccpi!=null){
          var nc=FIELD.soil.nccpi, tier = nc>=0.65?'upper tier':nc>=0.5?'above the national midpoint':nc>=0.35?'mid-range':nc>=0.2?'lower-middle':'lower end';
          var pct=Math.round(nc*100);
          slopeNote += '<div class="fs-soil-slope"><strong>NCCPI '+nc.toFixed(2)+'</strong> &mdash; '+tier+' of USDA\u2019s national row-crop productivity index ('+pct+'/100). The index is weighted toward Corn Belt soils, so strong regional ground can still sit mid-scale here'+
            (FIELD.soil.nccpiCorn!=null?'. Corn '+FIELD.soil.nccpiCorn.toFixed(2)+(FIELD.soil.nccpiSoy!=null?' · soy '+FIELD.soil.nccpiSoy.toFixed(2):''):'')+'.</div>';
        }
        if(FIELD.soil.slope!=null){
          var sl=FIELD.soil.slope, er = sl<2?'minimal erosion risk':sl<6?'moderate erosion risk':sl<12?'high erosion risk':'severe erosion risk';
          slopeNote += '<div class="fs-soil-slope"><strong>'+sl+'% average slope</strong>'+(FIELD.soil.maxSlope!=null&&FIELD.soil.maxSlope>sl?' (up to '+FIELD.soil.maxSlope+'%)':'')+' &mdash; '+er+'</div>'+
            '<div class="fs-caveat">Slope is SSURGO\u2019s representative value for each soil map unit, not a measurement of your exact acres &mdash; flat bottomland beside a hill can read steeper than it farms.</div>';
        }
        setBody('fs-soil', html + slopeNote + '<div class="fs-src" style="margin-top:.5rem">USDA SSURGO · number = land capability class (1 best, 8 poorest) · slope drives water erosion</div>');
      })
      .catch(function(){
        if(gen!==fieldGen) return;
        // SSURGO upstream flakes transiently (502/504) — retry once before giving up.
        if(!tries){ setTimeout(function(){ if(gen===fieldGen) loadSoil(poly, 1); }, 1500); return; }
        setErr('fs-soil','The USDA soil survey server (SSURGO) isn\u2019t responding right now &mdash; this is a known-flaky government service, not your field. Redraw the field in a few minutes and it usually loads.');
      });
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
    var gen = fieldGen;
    var c = polyCentroid(poly);
    var url = FS_WORKER + '/cdl?lat='+c.lat.toFixed(5)+'&lon='+c.lng.toFixed(5);
    fetch(url).then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){
        if(gen !== fieldGen) return;
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
        // If not one year resolved to a recognized row/forage crop, this field isn't
        // cropland in CDL (pasture, forest, developed, water). Say so plainly rather
        // than render five empty placeholder tiles that look broken.
        if(codes.every(function(c){ return c===null; })){
          setBody('fs-rot','<div class="fs-src">USDA\u2019s Cropland Data Layer doesn\u2019t classify this spot as row-crop or forage ground over the last five years &mdash; it reads as pasture, forest, developed, or water at the field center. Draw over active cropland to see a rotation.</div>');
          return;
        }
        var html='<div class="fs-rotation">'+ codes.map(function(code,i){
          var info = code ? crop(code) : {l:'—',e:'·',c:'#333'};
          return '<div class="fs-rot-year">'+
            '<div class="fs-rot-chip" aria-hidden="true" style="background:'+hexA(info.c,.18)+';border-color:'+hexA(info.c,.5)+'">'+info.e+'</div>'+
            '<div class="fs-rot-crop">'+esc(info.l)+'</div>'+
            '<div class="fs-rot-yr">\''+String(years[i]).slice(2)+'</div></div>';
        }).join('') + '</div>'+
        '<div class="fs-src" style="margin-top:.6rem">USDA Cropland Data Layer · dominant cover at field center</div>'+
        '<div class="fs-caveat">CDL is satellite-classified (~85&ndash;90% accurate per pixel) and sampled at the field\u2019s center point, so a single odd year may be a classification miss rather than a real planting.</div>';
        setBody('fs-rot', html);
      })
      .catch(function(){ if(gen!==fieldGen) return; setErr('fs-rot','The USDA crop-history service isn\u2019t responding right now &mdash; a temporary government-server hiccup, not your field. Redraw in a few minutes.'); });
  }

  // ── 3. WEATHER (Open-Meteo) ─────────────────────────────────────────
  function loadWeather(c){
    var gen = fieldGen;
    var url=METEO_URL+'?latitude='+c.lat.toFixed(4)+'&longitude='+c.lng.toFixed(4)+
      '&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m'+
      '&daily=precipitation_sum,temperature_2m_max,temperature_2m_min'+
      '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&past_days=7&forecast_days=1';
    fetch(url).then(function(r){return r.json();}).then(function(d){
      if(gen !== fieldGen) return;
      if(!d || !d.current){ setErr('fs-wx-weather','Weather unavailable.'); return; }
      var cur=d.current;
      var wk=0; if(d.daily&&d.daily.precipitation_sum){ d.daily.precipitation_sum.forEach(function(v){ wk+=(v||0); }); }
      window.__fsWx = {
        temp:Math.round(cur.temperature_2m), hum:Math.round(cur.relative_humidity_2m),
        wind:Math.round(cur.wind_speed_10m), wk:wk.toFixed(2)
      };
      FIELD.weather = window.__fsWx; recomputeInsight();
      renderWx();
    }).catch(function(){ if(gen!==fieldGen) return; window.__fsWx={err:1}; renderWx(); });
  }
  function loadDrought(c){
    var gen = fieldGen;
    // US Drought Monitor point service, proxied through the worker (the USDM
    // endpoint sends no CORS headers, so a direct browser call is blocked).
    // If unreachable, the panel omits the drought chip rather than blocking weather.
    var url=FS_WORKER+'/drought?lat='+c.lat.toFixed(4)+'&lon='+c.lng.toFixed(4);
    fetch(url).then(function(r){return r.ok?r.json():null;}).then(function(d){
      if(gen !== fieldGen) return;
      var cat='None';
      if(d){
        var lvl = d.DroughtClass!=null ? d.DroughtClass : (d.dm!=null?d.dm:(Array.isArray(d)&&d[0]?d[0].DroughtClass:null));
        cat = droughtLabel(lvl);
      }
      window.__fsDr={cat:cat}; FIELD.drought={cat:cat}; recomputeInsight(); renderWx();
    }).catch(function(){ if(gen!==fieldGen) return; window.__fsDr={cat:null}; if(FIELD)FIELD.drought={cat:null}; recomputeInsight(); renderWx(); });
  }
  function droughtLabel(lvl){
    if(lvl==null||lvl<0) return 'None';
    return ['Abnormally Dry (D0)','Moderate (D1)','Severe (D2)','Extreme (D3)','Exceptional (D4)'][lvl] || 'None';
  }

  // ── 3b. SEASON vs NORMAL — year-to-date rain & GDUs against the 5-yr avg ──
  // One Open-Meteo archive call returns ~5 yrs of daily precip + temps at the
  // field center. We accumulate Jan 1 → the latest available date for each year
  // (same calendar window every year = a fair compare), then cross this season
  // against the average of the prior years. GDUs use corn base 50°F, 86° cap.
  function loadSeason(c){
    var gen = fieldGen;
    var yNow = new Date().getFullYear();
    var start = (yNow-5)+'-01-01';
    // ERA5 archive lags a few days; clamp the end back so we never ask past coverage.
    var end = new Date(Date.now() - 6*864e5).toISOString().slice(0,10);
    var url = 'https://archive-api.open-meteo.com/v1/archive?latitude='+c.lat.toFixed(4)+'&longitude='+c.lng.toFixed(4)+
      '&start_date='+start+'&end_date='+end+
      '&daily=precipitation_sum,temperature_2m_max,temperature_2m_min'+
      '&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto';
    fetch(url).then(function(r){ return r.ok ? r.json() : null; }).then(function(d){
      if(gen !== fieldGen) return;
      if(!d || !d.daily || !d.daily.time || !d.daily.time.length){
        setBody('fs-season','<div class="fs-src">Season-to-date history isn\u2019t available for this spot.</div>'); return;
      }
      var t=d.daily.time, pr=d.daily.precipitation_sum||[], tx=d.daily.temperature_2m_max||[], tn=d.daily.temperature_2m_min||[];
      var cutoff = t[t.length-1].slice(5); // MM-DD: only count Jan 1 → this MM-DD each year
      var acc={};        // year → {precip, gdu}
      var cumMap={};     // year → { 'MM-DD': cumulativePrecip }
      for(var i=0;i<t.length;i++){
        var md=t[i].slice(5); if(md>cutoff) continue;       // MM-DD sorts chronologically
        var yr=+t[i].slice(0,4);
        var p=(pr[i]==null?0:pr[i]);
        var g=0;
        if(tx[i]!=null && tn[i]!=null){ var hi=Math.min(tx[i],86), lo=Math.max(tn[i],50); g=Math.max(0,(hi+lo)/2-50); }
        if(!acc[yr]){ acc[yr]={precip:0,gdu:0}; cumMap[yr]={}; }
        acc[yr].precip+=p; acc[yr].gdu+=g;
        cumMap[yr][md]=acc[yr].precip;
      }
      var ys=Object.keys(acc).map(Number).sort(function(a,b){return a-b;});
      var cur=ys[ys.length-1], prior=ys.filter(function(y){return y<cur;});
      if(!prior.length){ setBody('fs-season','<div class="fs-src">Not enough archive history here to compare.</div>'); return; }
      var avg=function(a){ return a.reduce(function(s,x){return s+x;},0)/a.length; };
      var pNorm=avg(prior.map(function(y){return acc[y].precip;}));
      var gNorm=avg(prior.map(function(y){return acc[y].gdu;}));
      FIELD.season = { thru:t[t.length-1], year:cur, n:prior.length,
        pNow:acc[cur].precip, pNorm:pNorm, pDep:acc[cur].precip-pNorm,
        gNow:acc[cur].gdu, gNorm:gNorm, gDep:acc[cur].gdu-gNorm };
      recomputeInsight(); renderRisk();
      setBody('fs-season', seasonHtml(FIELD.season, cumMap, cur, prior));
    }).catch(function(){ if(gen!==fieldGen) return; setErr('fs-season','Couldn\u2019t reach the weather archive just now.'); });
  }

  function seasonHtml(s, cumMap, cur, prior){
    var fmtDate=function(iso){ var d=new Date(iso+'T00:00'); return d.toLocaleDateString(undefined,{month:'short',day:'numeric'}); };
    var depTxt=function(v,unit){ var a=Math.abs(v).toFixed(unit==='in'?1:0);
      if(Math.abs(v) < (unit==='in'?0.25:15)) return '<span style="color:#9aa">≈ normal</span>';
      var up=v>0, col=(unit==='in')?(up?'#4aab4c':'#d9534f'):(up?'#4aab4c':'#e0a32e');
      return '<span style="color:'+col+'">'+(up?'+':'−')+a+(unit==='in'?'″':'')+' vs normal</span>'; };
    var rainBlock='<div class="fs-stat"><div class="fs-stat-v">'+s.pNow.toFixed(1)+'″</div>'+
      '<div class="fs-stat-l">Rain YTD &nbsp;·&nbsp; '+depTxt(s.pDep,'in')+'</div></div>';
    var gduBlock='<div class="fs-stat"><div class="fs-stat-v">'+Math.round(s.gNow)+'</div>'+
      '<div class="fs-stat-l">GDUs YTD &nbsp;·&nbsp; '+depTxt(s.gDep,'gdu')+'</div></div>';
    var spark = precipSparkline(cumMap, cur, prior);
    return '<div class="fs-stats" style="grid-template-columns:1fr 1fr">'+rainBlock+gduBlock+'</div>'+
      spark +
      '<div class="fs-src" style="margin-top:.55rem">Open-Meteo ERA5 · this season vs '+s.n+'-yr average, Jan 1 through '+fmtDate(s.thru)+' · GDU base 50°F</div>';
  }

  // Cumulative-precip sparkline: this year's curve riding inside the prior-years
  // min/max band — the at-a-glance "ahead of / behind normal" read.
  function precipSparkline(cumMap, cur, prior){
    var mds=Object.keys(cumMap[cur]).sort();           // Jan 1 → cutoff, this year
    if(mds.length<8) return '';
    var W=520, H=92, padL=4, padR=4, padT=8, padB=4;
    var iw=W-padL-padR, ih=H-padT-padB;
    var lo=[], hi=[], now=[], maxV=0;
    mds.forEach(function(md){
      var nv=cumMap[cur][md]; now.push(nv);
      var pv=prior.map(function(y){ return cumMap[y][md]; }).filter(function(v){ return v!=null; });
      var mn=pv.length?Math.min.apply(null,pv):nv, mx=pv.length?Math.max.apply(null,pv):nv;
      lo.push(mn); hi.push(mx);
      maxV=Math.max(maxV,nv,mx);
    });
    if(maxV<=0) maxV=1;
    var X=function(i){ return padL + iw*(i/(mds.length-1)); };
    var Y=function(v){ return padT + ih*(1 - v/maxV); };
    var lineOf=function(arr){ return arr.map(function(v,i){ return (i?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1); }).join(' '); };
    // band polygon: hi forward, lo backward
    var band='M'+X(0).toFixed(1)+' '+Y(hi[0]).toFixed(1)+' '+
      hi.map(function(v,i){ return 'L'+X(i).toFixed(1)+' '+Y(v).toFixed(1); }).join(' ')+' '+
      lo.slice().reverse().map(function(v,i){ var idx=lo.length-1-i; return 'L'+X(idx).toFixed(1)+' '+Y(v).toFixed(1); }).join(' ')+' Z';
    var ahead = now[now.length-1] >= hi[hi.length-1];
    var behind = now[now.length-1] <= lo[lo.length-1];
    var lineCol = behind ? '#e0a32e' : (ahead ? '#4aab4c' : '#9fd2ff');
    return '<div class="fs-chart-title">Cumulative rainfall &mdash; Jan 1 to date</div>'+
      '<svg viewBox="0 0 '+W+' '+H+'" width="100%" height="'+H+'" preserveAspectRatio="none" '+
      'role="img" aria-label="Cumulative rainfall this season versus the prior-years range" style="display:block;margin-top:.35rem">'+
      '<path d="'+band+'" fill="rgba(159,210,255,.14)" stroke="none"></path>'+
      '<path d="'+lineOf(hi)+'" fill="none" stroke="rgba(159,210,255,.35)" stroke-width="1"></path>'+
      '<path d="'+lineOf(lo)+'" fill="none" stroke="rgba(159,210,255,.35)" stroke-width="1"></path>'+
      '<path d="'+lineOf(now)+'" fill="none" stroke="'+lineCol+'" stroke-width="2.4" stroke-linejoin="round"></path>'+
      '</svg>'+
      '<div class="fs-src" style="margin-top:.15rem;display:flex;gap:1rem;flex-wrap:wrap">'+
        '<span style="color:'+lineCol+'">&#9644; This season&rsquo;s rain</span>'+
        '<span style="color:#9fd2ff">&#9636; Normal range (prior '+(prior.length)+' yrs)</span>'+
      '</div>';
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
    var gen = fieldGen;
    fetch(FS_WORKER + '/hail?lat='+c.lat.toFixed(4)+'&lon='+c.lng.toFixed(4)+'&years=5')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(gj){
        if(gen !== fieldGen) return;
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
      .catch(function(){ if(gen!==fieldGen) return; if(FIELD)FIELD.hail={err:1}; renderRisk(); });
  }

  function renderRisk(){
    if(!FIELD) return;
    var soil=FIELD.soil, hail=FIELD.hail, rot=FIELD.rotation, dr=FIELD.drought, se=FIELD.season;
    var rows=[];
    if(soil && soil.worst){
      var wc=soil.worst.nicc;
      var sv = wc<=2?'Low':wc<=4?'Moderate':wc<=6?'Elevated':'High';
      var sc = wc<=2?'#4aab4c':wc<=4?'#ffd400':wc<=6?'#ff9326':'#d9534f';
      rows.push(riskRow('Soil limitation', sv, sc, 'Worst ground on the field is class '+wc+(soil.primePct!=null?' · '+soil.primePct+'% prime':'')));
    }
    if(soil && soil.slope!=null && soil.slope>=2){
      var sl=soil.slope, ev=sl<6?'Moderate':sl<12?'Elevated':'High', ec=sl<6?'#ffd400':sl<12?'#ff9326':'#d9534f';
      rows.push(riskRow('Erosion (slope)', ev, ec, sl+'% average slope'+(soil.maxSlope>sl?' · up to '+soil.maxSlope+'%':'')+' — water-erosion exposure'));
    }
    if(hail && !hail.err){
      var hv = hail.days===0?'Low':hail.days<=1?'Moderate':hail.days<=3?'Elevated':'High';
      var hc = hail.days===0?'#4aab4c':hail.days<=1?'#ffd400':hail.days<=3?'#ff9326':'#d9534f';
      var hband = hail.days===0?'no reported hail nearby' : hail.days<=2?'below the active-hail range' : hail.days<=5?'an active hail area' : hail.days<=9?'hail-alley-level frequency' : 'extreme hail frequency';
      rows.push(riskRow('Hail exposure', hv, hc,
        hail.days+' hail day'+(hail.days===1?'':'s')+' within ~40mi in 5 yrs'+(hail.maxStone?' · max '+hail.maxStone+'"':'')+' — '+hband,
        ' · <a href="/hail-map" target="_blank" rel="noopener" style="color:var(--brand,var(--gold))">see the national map &rarr;</a>'));
    }
    if(rot && rot.cornOnCorn){
      rows.push(riskRow('Rotation stress', 'Elevated', '#ff9326', rot.maxCornStreak+' yrs continuous corn detected — yield-drag & disease pressure'));
    }
    if(dr && dr.cat && dr.cat!=='None'){
      rows.push(riskRow('Drought', (dr.cat.indexOf('D3')>=0||dr.cat.indexOf('D4')>=0)?'High':'Moderate',
        (dr.cat.indexOf('D3')>=0||dr.cat.indexOf('D4')>=0)?'#d9534f':'#ffd400', 'Currently '+dr.cat));
    }
    // Season rainfall deficit vs the 5-yr normal (independent of the USDM snapshot —
    // a field can be tracking dry before it shows up as a drought category).
    if(se && se.pDep <= -2){
      var md = se.pDep<=-5, mv = md?'High':'Elevated', mc = md?'#d9534f':'#ff9326';
      rows.push(riskRow('Moisture deficit', mv, mc, Math.abs(se.pDep).toFixed(1)+'″ below the '+se.n+'-yr rainfall normal season-to-date'));
    }
    if(!rows.length){
      var resolved = (FIELD.soil!==null) && (FIELD.hail!==null);
      if(!resolved){ setBody('fs-risk','<div class="fs-loading"><span class="fs-spin"></span>assessing</div>'); return; }
      var note = (hail&&hail.err)
        ? 'No major risk flags surfaced from public data &mdash; hail history was unavailable.'
        : 'No major risk flags surfaced from public data for this field.';
      setBody('fs-risk','<div class="fs-src">'+note+'</div>');
      return;
    }
    setBody('fs-risk', rows.join('') +
      '<div class="fs-src" style="margin-top:.5rem">A starting risk read from public data &mdash; not an underwriting decision. Questions? <a href="https://farmers1st.com/" target="_blank" rel="noopener" style="color:var(--brand,var(--gold))">Farmers First &rarr;</a></div>');
  }
  function riskRow(label, level, color, detail, link){
    // Colorblind-safe: a symbol carries severity independent of color.
    // `detail` is always escaped (it carries upstream survey/bid text). `link` is an
    // optional, trusted HTML snippet appended after it — never user data.
    var mark = level==='Low'?'●':level==='Moderate'?'◐':level==='Elevated'?'◕':'■';
    return '<div class="fs-risk-row">'+
      '<div class="fs-risk-label">'+esc(label)+'<small>'+esc(detail)+(link||'')+'</small></div>'+
      '<span class="fs-risk-badge" style="background:'+hexA(color,.16)+';color:'+color+';border:1px solid '+hexA(color,.45)+'"><span aria-hidden="true">'+mark+'</span> '+esc(level)+'</span>'+
    '</div>';
  }

  // ── 5. CASH BIDS (AGSIST proxy → Barchart getGrainBids) ─────────────
  function loadBids(c){
    var gen = fieldGen;
    // Reverse-geocode to a ZIP, then the same call cash-bids.html uses.
    fetch(NOMINATIM.replace('/search','/reverse')+'?format=json&lat='+c.lat.toFixed(4)+'&lon='+c.lng.toFixed(4))
      .then(function(r){return r.json();})
      .then(function(g){
        if(gen !== fieldGen) return;
        var zip = g && g.address ? (g.address.postcode||'').slice(0,5) : '';
        if(!zip){ setBody('fs-bids','<div class="fs-src">This field sits far enough from a mapped ZIP that we can\u2019t pull nearby bids for it &mdash; common for remote parcels. Try the cash-bids page directly for your area.</div>'); return; }
        return fetch(BIDS_PROXY+'?zip='+zip+'&radius=75&getAllBids=1')
          .then(function(r){return r.json();})
          .then(function(d){ if(gen!==fieldGen) return; renderBids(d, zip, gen); });
      })
      .catch(function(){ if(gen!==fieldGen) return; setErr('fs-bids','Couldn\u2019t reach the cash-bid feed just now.'); });
  }
  function renderBids(d, zip, gen){
    if(gen!==fieldGen) return;
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
    if(!flat.length){ setBody('fs-bids','<div class="fs-src">No elevators are reporting cash bids near ZIP '+esc(zip)+' right now. Bid coverage is densest across the Corn Belt and thins out elsewhere &mdash; this isn\u2019t an error.</div>'); return; }
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
  // GDU→corn-stage thresholds (cumulative, ~base 50°F). Soybeans are photoperiod-
  // driven, so we deliberately do NOT map them to GDU stages.
  var CORN_STAGES = [[125,'emergence (VE)'],[345,'V4'],[475,'V6'],[610,'V8'],[740,'V10'],
    [870,'V12'],[1000,'V14'],[1135,'tasseling (VT)'],[1400,'silking (R1)'],[1660,'blister (R2)'],
    [1925,'dough (R4)'],[2190,'dent (R5)'],[2700,'maturity (R6)']];
  var GDU_PER_DAY = 22;            // rough midsummer pace, for "days to" estimates
  var POLLEN_GDU  = 1400;          // ~silking (R1), the weather-critical window

  function recomputeInsight(){
    if(!FIELD) return;
    var s=FIELD.soil, r=FIELD.rotation, w=FIELD.weather, d=FIELD.drought, b=FIELD.bids, h=FIELD.hail, se=FIELD.season;
    var lines=[], stress=[];

    // A stressor is a structured concern: severity, whether it's act-now vs monitor,
    // a one-line verdict (`title`), the full `detail`, an optional `watch` (consequence
    // + timing — depth item #2), a `topic` for de-duping, and a `tag` (a few words used
    // to build the compounding-stress narrative — depth item #1).
    function push(o){ stress.push(o); }

    // ── Crop-stage intelligence (depth #3) — approximate corn development from this
    // season's cumulative GDU. Honest framing: it's modeled from temperature, not
    // field scouting, and corn-only. ──
    function estCornStage(g){
      var label='pre-emergence';
      for(var i=0;i<CORN_STAGES.length;i++){ if(g>=CORN_STAGES[i][0]) label=CORN_STAGES[i][1]; }
      var toPollen=POLLEN_GDU-g;
      return { label:label, toPollen:toPollen, daysToPollen: toPollen>0?Math.round(toPollen/GDU_PER_DAY):0, pastPollen: g>=POLLEN_GDU };
    }
    var isCorn = r && (r.lastCrop===1 || r.cornOnCorn);
    var cropStage = (se && se.gNow!=null && isCorn) ? estCornStage(se.gNow) : null;
    function pollenWindow(){ return cropStage && !cropStage.pastPollen ? cropStage.daysToPollen : null; }
    function pacePhrase(){
      if(!se||se.gDep==null) return null;
      var dd=Math.abs(Math.round(se.gDep/GDU_PER_DAY));
      if(se.gDep>=100) return 'running about '+dd+' day'+(dd===1?'':'s')+' ahead of a normal year';
      if(se.gDep<=-100) return 'running about '+dd+' day'+(dd===1?'':'s')+' behind a normal year';
      return 'tracking close to the normal pace';
    }

    // Depth #3 (dollars + a Monday action): translate a corn-on-corn yield drag into a
    // $/ac range using THIS field's nearest cash corn bid, then point at the presell
    // tool. Honest: the bu/ac range is from university continuous-corn trial work, not
    // this field's measured yield — so it's framed as an estimate.
    function dragAction(loBu, hiBu){
      if(!b || !b.corn) return null;
      var p=b.corn.cash, lo=Math.round(loBu*p), hi=Math.round(hiBu*p);
      return 'At <strong>$'+p.toFixed(2)+'</strong> nearby cash corn, a '+loBu+'–'+hiBu+' bu/ac drag is roughly <strong>$'+lo+'–$'+hi+'/ac</strong> left on the table. '
        + '<a href="/presell-calculator" target="_blank" rel="noopener" class="fs-act-link">Run the presell math &rarr;</a>'
        + '<span class="fs-src">est. from university continuous-corn trial ranges &times; your local bid</span>';
    }

    // ── Headline: the field's fundamental character (soil × rotation) ──
    if(s && s.top){
      var headSoil = s.primePct!=null && s.primePct>=70 ? 'mostly prime ground'
        : (s.worst && s.worst.nicc>=5) ? 'mixed ground with some marginal acres'
        : 'solid, workable ground';
      lines.push('This '+FIELD.acres.toFixed(0)+'-acre field is <strong>'+headSoil+'</strong>, led by '+esc(s.top.name)+'.');
    }

    // ── Where the crop likely is right now (depth #3) ──
    if(cropStage){
      var stg = cropStage.pastPollen
        ? 'Corn is likely past pollination and into grain fill — the weeks that set final yield.'
        : (cropStage.toPollen<=0
            ? 'Corn is at or entering pollination — the single most weather-sensitive window of the year.'
            : 'For corn, that heat-unit pace puts development around <strong>'+cropStage.label+'</strong>, roughly '+cropStage.daysToPollen+' day'+(cropStage.daysToPollen===1?'':'s')+' from pollination at a typical midsummer pace.');
      var pp=pacePhrase();
      lines.push(stg+(pp?' The season is '+pp+'.':'')+' <span class="fs-approx">(approximate — modeled from temperature, not field scouting)</span>');
    } else if(se && se.gDep!=null && Math.abs(se.gDep)>=100){
      var pp2=pacePhrase(); if(pp2) lines.push('Heat-unit accumulation is '+pp2+' this season.');
    }

    var nFix='. Soybeans in the rotation would also credit roughly 30–40 lb N/ac to next year\u2019s corn';

    // ── corn-on-corn × soil (the highest-value cross-reference) ──
    if(s && s.worst && r && r.cornOnCorn){
      if(s.worst.nicc>=4){
        push({ sev:5, act:true, topic:'rotation', tag:'continuous corn on your class-'+s.worst.nicc+' ground',
          title:'break the rotation on your class-'+s.worst.nicc+' acres — it\u2019s the highest-ROI move on this field',
          detail:'Your weaker ground (class '+s.worst.nicc+') is also carrying <strong>'+r.maxCornStreak+' years of continuous corn</strong> — two strikes against yield in the same spot. A rotation break there is the highest-ROI change on this field'+nFix+'.',
          action: dragAction(5,12),
          watch: pollenWindow()!=null ? 'Rootworm feeding shows at silking (~'+pollenWindow()+' days out) — pull and check roots before then.' : 'Scout roots for rootworm before pollination, and plan beans on these acres next year.' });
      } else {
        var productive = s.nccpi!=null && s.nccpi>=0.55;
        push({ sev:productive?4:3, act:true, topic:'rotation', tag:'corn-on-corn pressure',
          title:'plan a rotation break to stop the corn-on-corn yield drag'+(productive?' on this productive ground':''),
          detail:(productive?'This is productive ground (NCCPI '+s.nccpi.toFixed(2)+'), so the continuous-corn drag is leaving more bushels on the table here than it would on weaker soil':'Good soil, but '+r.maxCornStreak+' years corn-on-corn is building disease and nitrogen pressure')+' — worth a rotation break before it compounds'+nFix+'.',
          action: dragAction(productive?8:5, productive?15:10),
          watch: pollenWindow()!=null ? 'Rootworm pressure peaks near silking (~'+pollenWindow()+' days out) — scout this season; plan beans next.' : 'Scout for rootworm this season; plan beans on these acres next year.' });
      }
    } else if(r && r.cornOnCorn){
      push({ sev:3, act:true, topic:'rotation', tag:'a multi-year corn streak',
        title:'plan a rotation break and scout for rootworm',
        detail:'CDL shows <strong>'+r.maxCornStreak+' straight years of corn</strong> here — watch for rootworm and the corn-on-corn yield drag'+nFix+'.',
        action: dragAction(5,10),
        watch: pollenWindow()!=null ? 'Rootworm pressure peaks near silking (~'+pollenWindow()+' days out).' : null });
    }

    // ── NCCPI context on its own (descriptive, national scale) ──
    if(s && s.nccpi!=null && !(r && r.cornOnCorn)){
      if(s.nccpi>=0.65){
        var favors=(s.nccpiCorn!=null && s.nccpiSoy!=null && Math.abs(s.nccpiCorn-s.nccpiSoy)>=0.05)
          ? ' For row crops, the index runs a touch higher for '+(s.nccpiCorn>s.nccpiSoy?'corn':'soybeans')+' on this ground.':'';
        push({ sev:1, act:false, topic:'soil', tag:null,
          title:'productive ground (NCCPI '+s.nccpi.toFixed(2)+') — the soil can carry strong yields here',
          detail:'This rates as <strong>highly productive row-crop ground</strong> — NCCPI '+s.nccpi.toFixed(2)+', upper tier on USDA\u2019s national index. The limiting factors here are the ones you manage.'+favors+' <span class="fs-src">source: USDA NCCPI, a national 0–1 productivity index</span>', watch:null });
      } else if(s.nccpi<0.3){
        push({ sev:2, act:false, topic:'soil', tag:null,
          title:'NCCPI '+s.nccpi.toFixed(2)+' nationally — match yield goals and inputs to what this soil reliably returns',
          detail:'On USDA\u2019s <strong>national</strong> index this rates NCCPI '+s.nccpi.toFixed(2)+' — the lower end of a scale weighted heavily by Corn Belt ground. In its own region this can still be solid.'+' <span class="fs-src">source: USDA NCCPI, a national 0–1 productivity index</span>', watch:null });
      }
    }

    // ── Drought (acute) ──
    var inDrought = d && d.cat && d.cat!=='None' && (d.cat.indexOf('D2')>=0||d.cat.indexOf('D3')>=0||d.cat.indexOf('D4')>=0);
    if(inDrought){
      push({ sev:4, act:true, topic:'moisture', tag:esc(d.cat)+' drought',
        title:'moisture is the acute variable right now — prioritize it',
        detail:'Currently in <strong>'+esc(d.cat)+'</strong> — the field is under real moisture stress.',
        watch: (pollenWindow()!=null && pollenWindow()<=21) ? 'Drought through pollination (~'+pollenWindow()+' days out) is the worst-timed stress there is — that window sets kernel count.' : 'Watch soil moisture closely into the next rain.' });
    }

    // ── Season rain × GDU (skip a second moisture stressor if already in drought) ──
    if(se){
      var dryEnough=se.pDep<=-2, wetEnough=se.pDep>=2, hot=se.gDep>=100, cool=se.gDep<=-100;
      if(dryEnough && hot && !inDrought){
        push({ sev:4, act:true, topic:'moisture', tag:'a widening rain deficit',
          title:'the crop is developing fast into a moisture deficit — watch it closely',
          detail:'Rain is <strong>'+Math.abs(se.pDep).toFixed(1)+'″ below</strong> the '+se.n+'-yr normal while GDUs run '+Math.round(se.gDep)+' ahead — fast development into a drying profile.',
          watch: pollenWindow()!=null ? 'The next 2–3 weeks toward pollination (~'+pollenWindow()+' days out) are when a deficit bites hardest.' : 'A timely rain over the next two weeks matters most.' });
      } else if(dryEnough && !inDrought){
        push({ sev:3, act:false, topic:'moisture', tag:'a dry start',
          title:'the field is starting dry — keep an eye on moisture',
          detail:'Season-to-date rain is <strong>'+Math.abs(se.pDep).toFixed(1)+'″ below normal</strong> — drier than its '+se.n+'-yr baseline.',
          watch:'Watch the forecast; a return to normal rainfall still recovers this.' });
      } else if(wetEnough && cool){
        lines.push('A wet, cool start — rain '+se.pDep.toFixed(1)+'″ above normal and GDUs '+Math.round(se.gDep)+' behind, so development is running slow.');
      } else if(wetEnough){
        lines.push('Rain is running '+se.pDep.toFixed(1)+'″ above the '+se.n+'-yr normal so far this season.');
      }
    }

    // ── Erosion (slope-driven) ──
    if(s && s.slope!=null && s.slope>=6){
      push({ sev:s.slope>=12?4:3, act:s.slope>=12, topic:'erosion', tag:'erosion exposure on the steep acres',
        title:'consider erosion control (residue, contouring) on the steeper acres',
        detail:'Slope averages <strong>'+s.slope+'%</strong>'+(s.maxSlope>s.slope?' (up to '+s.maxSlope+'%)':'')+' — real water-erosion exposure on the steeper acres.', watch:null });
    }

    // ── Hail history → bridge to the Hail Map ──
    if(h && !h.err && h.days>=2){
      push({ sev:2, act:false, topic:'hail', tag:null,
        title:'make sure your hail coverage matches this field\u2019s history',
        detail:'This ground has taken <strong>'+h.days+' hail days in five years</strong>'+(h.maxStone?' (up to '+h.maxStone+'" stones)':'')+' — a real factor for your coverage decisions. <a href="/hail-map" target="_blank" rel="noopener" style="color:var(--brand,var(--gold))">See it on the national hail map &rarr;</a>', watch:null });
    }

    // ── Marketing context line ──
    if(b && (b.corn||b.bean)){
      var mk=[];
      if(b.corn) mk.push('corn near $'+b.corn.cash.toFixed(2));
      if(b.bean) mk.push('beans near $'+b.bean.cash.toFixed(2));
      if(mk.length) lines.push('Closest cash market: '+mk.join(', ')+' ('+esc((b.corn||b.bean).elev)+').');
    }

    if(!lines.length && !stress.length) return;

    // No concerns at all → nudge toward the visual NDVI layer.
    if(!stress.length && s && r){
      lines.push('No red flags in the soil and rotation here — flip on <strong>Crop vigor</strong> to see how the stand is actually doing this season.');
    }

    stress.sort(function(a,b){ return b.sev-a.sev; });
    var acts = stress.filter(function(x){ return x.act; });
    var mons = stress.filter(function(x){ return !x.act; });

    // ── Compounding-stress narrative (depth #1): when 2+ act-level concerns hit the
    // same field, name them together as a stack rather than scattering them as bullets. ──
    var compound=null;
    if(acts.length>=2){
      var seen={}, tags=[];
      acts.forEach(function(x){ if(x.tag && !seen[x.topic]){ seen[x.topic]=1; tags.push(x.tag); } });
      if(tags.length>=2){
        var list = tags.length===2 ? tags[0]+' and '+tags[1]
          : tags.slice(0,-1).join(', ')+', and '+tags[tags.length-1];
        var cnt = tags.length===2?'Two':(tags.length===3?'Three':'Several');
        compound = cnt+' things are stacking up on this field at once: '+list+'. '
          + 'Any one is manageable on its own — together they compound, which is why the first item below is the priority.';
      }
    }

    // verdict = top act-now concern (falls back to top stressor)
    var lead = acts[0] || stress[0] || null;
    FIELD.read = { verdict: lead?lead.title:null,
                   flags: stress.map(function(x){ return x.detail; }),
                   lines: lines.slice() };

    // ── render ──
    var wrap=document.getElementById('fs-insight-wrap'); if(wrap) wrap.hidden=false;
    var html='';
    if(lead) html += '<p class="fs-verdict"><span>Bottom line</span><b>'+lead.title.charAt(0).toUpperCase()+lead.title.slice(1)+'.</b></p>';
    html += lines.map(function(l){ return '<p class="fs-insight-p">'+l+'</p>'; }).join('');
    if(compound) html += '<p class="fs-insight-p fs-compound">'+compound+'</p>';

    function block(items, label, cls){
      if(!items.length) return '';
      var rows = items.map(function(x){
        var watch = x.watch ? '<div class="fs-watch"><span>What to watch</span>'+x.watch+'</div>' : '';
        var act = x.action ? '<div class="fs-act-dollar">'+x.action+'</div>' : '';
        return '<div class="fs-insight-flag fs-'+cls+'"><span class="fs-flag-mark">'+(cls==='act'?'!':'\u2022')+'</span><div>'+x.detail+act+watch+'</div></div>';
      }).join('');
      return '<div class="fs-flag-group"><div class="fs-flag-label">'+label+'</div>'+rows+'</div>';
    }
    if(acts.length||mons.length){
      html += '<div class="fs-insight-flags">'+ block(acts,'Act on this','act') + block(mons,'Keep an eye on','mon') +'</div>';
    }
    setBody('fs-insight', html);
  }

  // ── Shareable one-page field report (print / save-as-PDF) ───────────
  function generateReport(){
    if(!FIELD){ return; }
    var d=FIELD, s=d.soil, r=d.rotation, dr=d.drought, se=d.season, h=d.hail, b=d.bids, rd=d.read;
    var dateStr=new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
    function strip(html){ return String(html||'').replace(/<a\b[^>]*>(.*?)<\/a>/gi,'$1'); }
    function kv(label,val){ return val?('<tr><th>'+esc(label)+'</th><td>'+val+'</td></tr>'):''; }
    function sect(title,body){ return body?('<section class="r-sec"><h2>'+esc(title)+'</h2>'+body+'</section>'):''; }

    var verdictHtml = (rd&&rd.verdict) ? '<div class="r-verdict"><span>Bottom line</span>'+esc(rd.verdict.charAt(0).toUpperCase()+rd.verdict.slice(1))+'.</div>' : '';
    var lead = (rd&&rd.lines&&rd.lines.length) ? rd.lines.map(function(l){return '<p class="r-p">'+strip(l)+'</p>';}).join('') : '';
    var flagsHtml = (rd&&rd.flags&&rd.flags.length) ? '<ul class="r-flags">'+rd.flags.map(function(f){return '<li>'+strip(f)+'</li>';}).join('')+'</ul>' : '';

    var soilHtml='';
    if(s&&s.classes&&s.classes.length){
      soilHtml='<table class="r-tbl">'+s.classes.slice(0,6).map(function(c){
        var pct=s.total?Math.round(c.ac/s.total*100):0;
        return '<tr><td>'+esc(c.name)+'</td><td>class '+(c.nicc||'?')+'</td><td class="r-num">'+c.ac.toFixed(1)+' ac</td><td class="r-num">'+pct+'%</td></tr>';
      }).join('')+'</table>';
      var bits=[];
      if(s.primePct!=null) bits.push(s.primePct+'% prime cropland');
      if(s.nccpi!=null) bits.push('NCCPI '+s.nccpi.toFixed(2)+'/1.00 productivity');
      if(s.slope!=null) bits.push(s.slope+'% average slope'+(s.maxSlope>s.slope?' (up to '+s.maxSlope+'%)':''));
      if(bits.length) soilHtml+='<p class="r-note">'+bits.join(' &middot; ')+'</p>';
    }

    var rotHtml='';
    if(r&&r.codes&&r.codes.length){
      rotHtml='<div class="r-rot">'+r.codes.map(function(code,i){
        var nm = code ? crop(code).l : '\u2014';
        return '<span><b>\u2019'+String(r.years[i]).slice(2)+'</b> '+esc(nm)+'</span>';
      }).join('')+'</div>';
      if(r.cornOnCorn) rotHtml+='<p class="r-note">'+r.maxCornStreak+' years continuous corn detected</p>';
    }

    var condRows='';
    if(dr&&dr.cat&&dr.cat!=='None') condRows+=kv('Drought status', esc(dr.cat));
    if(se){
      condRows+=kv('Season rainfall', se.pNow.toFixed(1)+'\u2033 vs '+se.pNorm.toFixed(1)+'\u2033 '+se.n+'-yr normal ('+(se.pDep>=0?'+':'')+se.pDep.toFixed(1)+'\u2033)');
      condRows+=kv('Growing degree units', Math.round(se.gNow)+' vs '+Math.round(se.gNorm)+' normal ('+(se.gDep>=0?'+':'')+Math.round(se.gDep)+')');
    }
    if(h&&!h.err) condRows+=kv('Hail (5 yr, ~40 mi)', h.days+' hail day'+(h.days===1?'':'s')+(h.maxStone?' \u00b7 max '+h.maxStone+'\u2033':''));

    var bidRows='';
    if(b&&b.corn) bidRows+=kv('Corn cash bid', '$'+b.corn.cash.toFixed(2)+' \u00b7 '+esc(b.corn.elev));
    if(b&&b.bean) bidRows+=kv('Soybean cash bid', '$'+b.bean.cash.toFixed(2)+' \u00b7 '+esc(b.bean.elev));

    var css='*{box-sizing:border-box}body{font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;max-width:760px;margin:0 auto;padding:28px 32px}'
      +'h1{font-size:24px;margin:.1em 0 .1em}h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#7a6a2e;border-bottom:1px solid #e3ddc7;padding-bottom:4px;margin:22px 0 10px}'
      +'.r-head{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #c9a227;padding-bottom:8px;margin-bottom:16px}'
      +'.r-brand{font-weight:700;color:#6b5a13;letter-spacing:.02em}.r-date{color:#777;font-size:12px}.r-loc{color:#777;font-size:12px;margin-bottom:14px}'
      +'.r-verdict{background:#fbf6e3;border:1px solid #e6d8a0;border-left:4px solid #c9a227;border-radius:0 8px 8px 0;padding:12px 14px;margin:8px 0 14px}'
      +'.r-verdict span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#9a7d1e;font-weight:700;margin-bottom:3px}'
      +'.r-verdict{font-size:16px;font-weight:600}.r-p{margin:.3em 0}.r-flags{margin:.4em 0;padding-left:18px}.r-flags li{margin:.3em 0}'
      +'.r-tbl,.r-kv{width:100%;border-collapse:collapse;font-size:13px}.r-tbl td{padding:4px 6px;border-bottom:1px solid #eee}.r-num{text-align:right;white-space:nowrap}'
      +'.r-kv th{text-align:left;font-weight:600;color:#555;padding:4px 10px 4px 0;width:40%;vertical-align:top}.r-kv td{padding:4px 0}'
      +'.r-rot{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px}.r-rot b{color:#6b5a13}.r-note{font-size:12px;color:#777;margin:6px 0 0}'
      +'.r-foot{margin-top:24px;border-top:1px solid #e3ddc7;padding-top:10px;font-size:11px;color:#888;line-height:1.5}'
      +'.r-actions{margin-bottom:16px}.r-actions button{background:#c9a227;color:#1a1206;border:none;border-radius:7px;font-weight:700;padding:9px 16px;font-size:14px;cursor:pointer}'
      +'@media print{.no-print{display:none}body{padding:0}}';

    var html='<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      +'<title>Field Report \u2014 '+d.acres.toFixed(0)+' acres \u2014 AGSIST</title><style>'+css+'</style></head><body>'
      +'<div class="r-actions no-print"><button type="button" onclick="window.print()">\u2399 Print / Save as PDF</button></div>'
      +'<div class="r-head"><div class="r-brand">AGSIST \u00b7 Field Scout</div><div class="r-date">'+esc(dateStr)+'</div></div>'
      +'<h1>'+d.acres.toFixed(1)+'-acre field</h1><div class="r-loc">Center '+d.lat.toFixed(4)+', '+d.lng.toFixed(4)+'</div>'
      +verdictHtml+lead+flagsHtml
      +sect('Soil & productivity', soilHtml)
      +sect('5-year crop rotation', rotHtml)
      +sect('Conditions', condRows?'<table class="r-kv">'+condRows+'</table>':'')
      +sect('Nearby cash bids', bidRows?'<table class="r-kv">'+bidRows+'</table>':'')
      +'<div class="r-foot">Compiled by AGSIST Field Scout from public data &mdash; USDA SSURGO soil survey, USDA Cropland Data Layer, Open-Meteo, US Drought Monitor &mdash; plus the AGSIST cash-bid feed. Soil and crop layers are survey estimates, not a substitute for sampling your own ground. This is a starting read, not an underwriting decision or financial advice. Questions about coverage? Farmers First Agri Service \u00b7 farmers1st.com</div>'
      +'</body></html>';

    var w=window.open('','_blank');
    if(!w){ flashHint('Allow pop-ups to open the printable field report.'); return; }
    w.document.open(); w.document.write(html); w.document.close();
    ga('field_report', { acres: Math.round(d.acres) });
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
