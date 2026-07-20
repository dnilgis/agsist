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
  var NOMINATIM_REV = 'https://nominatim.openstreetmap.org/reverse';
  // full state name ↔ postal abbr (nominatim returns full names; data files key by abbr or FIPS)
  var N2A = {'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA','Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA','Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT','Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY'};

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
  var tracing=false;        // true while Leaflet.draw polygon mode is live
  var boxMode=false;        // true when the active field is a resizable preset box
  var _zoomHintAt=0, _hintTimer=null;
  var TAP_MIN_ZOOM=13;      // below this a tap is navigation, not a field
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
      soil:null, rotation:null, weather:null, drought:null, bids:null, hail:null, county:null };
  }

  // ── Boot ────────────────────────────────────────────────────────────
  function init() {
    if (typeof L === 'undefined') { showFatal('Map library failed to load. Check your connection and refresh.'); return; }
    if (typeof L.Draw === 'undefined' || !L.Draw.Polygon) { showFatal('The field-drawing tool failed to load. Refresh the page; if it persists, your network may be blocking unpkg.com.'); return; }

    map = L.map('fs-map', { zoomControl:true, attributionControl:true }).setView([41.878, -93.0977], 6); // Iowa-ish center
    try{ map.zoomControl.setPosition('bottomleft'); }catch(e){}
    setTimeout(function(){ try{ map.invalidateSize(); }catch(e){} }, 60);
    window.addEventListener('resize', function(){ try{ map.invalidateSize(); }catch(e){} });
    // the invitation clears the moment the user engages the map — pan, zoom, or tap
    map.on('movestart', dismissInvite);
    map.on('zoomstart', dismissInvite);
    try{ map.getContainer().addEventListener('pointerdown', dismissInvite, { once:true }); }catch(e){}

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
    // Floating trace toolbar (Undo point / Finish) rides along while drawing —
    // Leaflet.draw's double-click-to-finish is near impossible on a phone.
    map.on('draw:drawstart', function(){ tracing=true; showTracebar(true); dismissInvite(); });
    map.on('draw:drawstop',  function(){ tracing=false; showTracebar(false); });

    // THE zero-friction path: with no field active, a single tap on the map IS the
    // field — an editable preset box drops right there. No arming, no button hunt.
    // (Leaflet suppresses click after a pan, so map dragging never triggers this.)
    map.on('click', function(e){
      if(pinArmed){ disarmPin(); dropFieldBox(e.latlng.lat, e.latlng.lng); return; }
      if(tracing || activePoly) return;
      // a tap on a hail marker (or any interactive vector) is that, not a field
      try{ if(e.originalEvent && e.originalEvent.target && e.originalEvent.target.closest && e.originalEvent.target.closest('.leaflet-interactive')) return; }catch(err){}
      if(map.getZoom() < TAP_MIN_ZOOM){
        if(Date.now()-_zoomHintAt > 4000){ _zoomHintAt=Date.now(); flashHint('Zoom in to your field, then tap it'); }
        return;
      }
      // TOUCH SAFETY (learned in the field, literally): on coarse pointers a bare
      // tap shows a GHOST boundary + confirm chip instead of committing — stray
      // thumbs and pinch-ends were dropping fields mid-conversation with a farmer.
      // Tapping elsewhere just moves the ghost. Desktop keeps the instant drop.
      if(window.matchMedia && matchMedia('(pointer: coarse)').matches){
        showGhost(e.latlng.lat, e.latlng.lng);
        return;
      }
      dropFieldBox(e.latlng.lat, e.latlng.lng);
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
    if(!restoreFromLink()) tryAutoLocate();
  }

  // ── GOD LAYERS: NDVI / moisture tile overlays, on-map chips + bottom layer sheet ──
  function wireGodLayers(){
    // layer selector chips (on the map, under the basemap toggle)
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
    var lsc = document.getElementById('fs-ls-close');
    if(lsc) lsc.addEventListener('click', function(){ var sh=document.getElementById('fs-layersheet'); if(sh) sh.hidden=true; });
    // "flip on Crop vigor" links inside The Read → jump to the map and light the layer
    document.addEventListener('click', function(e){
      var a = e.target && e.target.closest && e.target.closest('.fs-god-link');
      if(!a) return;
      e.preventDefault();
      var stage=document.querySelector('.fs-stage'); if(stage) stage.scrollIntoView({behavior:'smooth', block:'center'});
      var g=a.getAttribute('data-god');
      if(g && godActive!==g) setGodLayer(g);
    });
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
    if(!which){ godDate=null; syncSheet(); return; }
    godDate=null;                         // a fresh layer always starts at the latest pass
    openSheetFor(which);
    var url = FS_WORKER + '/' + which + '/{z}/{x}/{y}';
    godLayer = L.tileLayer(url, { opacity:godOpacity, maxZoom:18, minZoom:9, tileSize:256, crossOrigin:true,
      attribution: which==='ndvi' ? 'NDVI: Sentinel-2 / Copernicus' : 'Moisture: Sentinel-1 / Copernicus' }).addTo(map);
    // These layers only render at field scale (zoom 9+): a national-view request
    // would fire dozens of Sentinel tiles at once and hit the processing rate limit.
    if(map.getZoom() < 9){ flashHint('Zoom in to your field to see '+(which==='ndvi'?'crop vigor':'soil moisture')); }
    renderPassTimeline();
    ga('god_layer', { layer: which });
  }

  // The bottom layer sheet: legend + season replay + opacity, right on the map.
  function openSheetFor(which){
    var sheet=document.getElementById('fs-layersheet'); if(!sheet) return;
    sheet.hidden=false;
    setLegend(which);
    var sw=document.getElementById('fs-scrub-wrap'); if(sw) sw.hidden = which!=='moisture';
    var ow=document.getElementById('fs-opac-wrap'); if(ow) ow.hidden = which==='hail';
    if(which==='moisture'){
      var sc=document.getElementById('fs-scrub'); if(sc) sc.value=0;
      var sv=document.getElementById('fs-scrub-val'); if(sv) sv.textContent='Latest';
    }
    if(which!=='ndvi'){ var pw=document.getElementById('fs-passes'); if(pw){ pw.hidden=true; pw.innerHTML=''; } }
  }
  function syncSheet(){
    if(godActive){ openSheetFor(godActive); return; }
    if(hailLayer){ openSheetFor('hail'); return; }
    var sheet=document.getElementById('fs-layersheet'); if(sheet) sheet.hidden=true;
  }

  // ── Season replay: one tappable chip per real clear satellite pass ──
  // The /indices series carries the actual pass dates; tapping a date reloads the
  // vigor tiles for that pass, so the season plays back like a flipbook.
  function renderPassTimeline(){
    var wrap=document.getElementById('fs-passes'); if(!wrap) return;
    var s = FIELD && FIELD.indices && FIELD.indices.series;
    if(godActive!=='ndvi' || !s || !s.length){ wrap.hidden=true; wrap.innerHTML=''; return; }
    var sel = godDate || s[s.length-1].date;
    var cur=null; for(var i=0;i<s.length;i++){ if(s[i].date===sel){ cur=s[i]; break; } }
    wrap.hidden=false;
    wrap.innerHTML =
      '<div class="fs-passes-l">Season replay &middot; '+s.length+' clear pass'+(s.length===1?'':'es')+
        (cur && cur.ndvi!=null ? ' &middot; <b>NDVI '+(+cur.ndvi).toFixed(2)+'</b> ('+vigorWord(+cur.ndvi)+') on '+passLbl(sel) : '')+'</div>'+
      '<div class="fs-passes-row">'+ s.map(function(p){
        var on = p.date===sel;
        var v = p.ndvi!=null ? '<span class="fs-pass-v" style="color:'+(on?'#0a1206':vigorColor(+p.ndvi))+'">'+(+p.ndvi).toFixed(2)+'</span>' : '';
        return '<button type="button" class="fs-pass'+(on?' on':'')+'" data-date="'+esc(p.date)+'"><span class="fs-pass-d">'+passLbl(p.date)+'</span>'+v+'</button>';
      }).join('') + '</div>';
    wrap.querySelectorAll('.fs-pass').forEach(function(b){
      b.addEventListener('click', function(){ selectPass(b.getAttribute('data-date')); });
    });
    var row=wrap.querySelector('.fs-passes-row'); if(row) row.scrollLeft=row.scrollWidth;  // newest in view
  }
  function passLbl(d){ try{ return new Date(d+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric'}); }catch(e){ return d; } }
  function selectPass(date){
    godDate = date;
    if(godActive && godLayer){
      map.removeLayer(godLayer);
      godLayer = L.tileLayer(FS_WORKER+'/'+godActive+'/{z}/{x}/{y}?date='+godDate, { opacity:godOpacity, maxZoom:18, minZoom:9, tileSize:256, crossOrigin:true }).addTo(map);
    }
    renderPassTimeline();
    ga('pass_scrub', { date: date });
  }

  // Plain-language key for the color overlays — answers "what am I looking at?"
  function setLegend(which){
    var el=document.getElementById('fs-legend'); if(!el) return;
    if(which==='ndvi'){
      el.hidden=false;
      el.innerHTML='<div class="fs-leg-top"><span class="fs-leg-ttl">Crop vigor</span><span class="fs-leg-tag">how much living canopy</span></div>'+
        '<div class="fs-leg-bar" style="background:linear-gradient(90deg,#8c6638,#b79a3c,#6aa83a,#1f7a2e)"></div>'+
        '<div class="fs-leg-ends"><span>Bare / stressed</span><span>Healthy / lush</span></div>'+
        '<div class="fs-leg-say">Greener means more living crop. Brown and tan are bare soil, residue, or a struggling stand &mdash; those are the spots worth walking.</div>';
    } else if(which==='moisture'){
      el.hidden=false;
      el.innerHTML='<div class="fs-leg-top"><span class="fs-leg-ttl">Soil moisture</span><span class="fs-leg-tag">radar surface wetness</span></div>'+
        '<div class="fs-leg-bar" style="background:linear-gradient(90deg,#c7ae73,#8fb59a,#2a7fd6)"></div>'+
        '<div class="fs-leg-ends"><span>Drier</span><span>Wetter</span></div>'+
        '<div class="fs-leg-say">Bluer is a wetter surface, tan is drier. It\u2019s a relative read from radar &mdash; good for finding wet holes and dry knobs, not an exact percent.</div>';
    } else if(which==='hail'){
      el.hidden=false;
      el.innerHTML='<div class="fs-leg-top"><span class="fs-leg-ttl">Hail history</span><span class="fs-leg-tag">reported storms, last 5 years</span></div>'+
        '<div class="fs-leg-say">Each blue dot is a severe-hail storm report near this field over the last five years &mdash; tap a dot for the reported stone size and date. No dots is good news.</div>';
    } else { el.hidden=true; el.innerHTML=''; }
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
    if(hailLayer){ map.removeLayer(hailLayer); hailLayer=null; btn.classList.remove('on'); btn.setAttribute('aria-pressed','false'); syncSheet(); return; }
    if(!activePoly && !map.getCenter()){ return; }
    var c = activePoly ? polyCentroid(activePoly) : map.getCenter();
    btn.classList.add('on'); btn.setAttribute('aria-pressed','true');
    openSheetFor('hail');
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
      }).catch(function(){ btn.classList.remove('on'); btn.setAttribute('aria-pressed','false'); syncSheet(); });
  }

  function wireControls() {
    var pinBtn=document.getElementById('fs-pin'); if(pinBtn) pinBtn.addEventListener('click', armPinDrop);
    document.getElementById('fs-draw').addEventListener('click', function(){
      // Tracing at county scale draws a "field" the size of a county — make them zoom first.
      if(map && map.getZoom() < 11){ flashHint('Zoom in to your field first, then trace it'); return; }
      drawControl.enable();
    });
    document.getElementById('fs-clear').addEventListener('click', clearField);
    var so=document.getElementById('fs-startover'); if(so) so.addEventListener('click', function(){ clearField(); flashHint('Tap the map to drop a fresh field'); });
    document.getElementById('fs-gps').addEventListener('click', locateMe);
    document.getElementById('fs-addr-go').addEventListener('click', searchAddr);
    var demoBtn=document.getElementById('fs-demo'); if(demoBtn) demoBtn.addEventListener('click', loadDemoField);
    document.getElementById('fs-addr').addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); searchAddr(); }});
    document.getElementById('fs-bm-sat').addEventListener('click', function(){ setBasemap('sat'); });
    document.getElementById('fs-bm-map').addEventListener('click', function(){ setBasemap('map'); });
    // trace toolbar (visible only while drawing)
    var tu=document.getElementById('fs-tr-undo');   if(tu) tu.addEventListener('click', function(){ try{ drawControl.deleteLastVertex(); }catch(e){} });
    var tf=document.getElementById('fs-tr-finish'); if(tf) tf.addEventListener('click', function(){ try{ drawControl.completeShape(); }catch(e){} });
    var tc=document.getElementById('fs-tr-cancel'); if(tc) tc.addEventListener('click', function(){ try{ drawControl.disable(); }catch(e){} });
    // acre presets for the dropped box (20/40/80/160 — real PLSS shapes)
    document.querySelectorAll('#fs-sizer [data-ac]').forEach(function(b){
      b.addEventListener('click', function(){ resizeBoxTo(+b.getAttribute('data-ac')); });
    });
    // mobile: jump from the map down to the read
    var jr=document.getElementById('fs-jumpread'); if(jr) jr.addEventListener('click', jumpToRead);
  }

  function setBasemap(which){
    var sat=document.getElementById('fs-bm-sat'), mp=document.getElementById('fs-bm-map');
    if(which==='sat'){ map.removeLayer(mapLayer); satLayer.addTo(map); sat.classList.add('on'); mp.classList.remove('on'); }
    else { map.removeLayer(satLayer); mapLayer.addTo(map); mp.classList.add('on'); sat.classList.remove('on'); }
  }

  function flashHint(msg, ms){
    var h=document.getElementById('fs-hint');
    if(!h) return;
    h.innerHTML=msg||'<b>&#9998;</b>&nbsp;Click corners, double-click to finish';
    h.hidden=false;
    clearTimeout(_hintTimer);
    _hintTimer=setTimeout(function(){ h.hidden=true; }, ms||4500);
  }
  function hideHint(){ var h=document.getElementById('fs-hint'); if(h) h.hidden=true; clearTimeout(_hintTimer); }

  function clearField(){
    clearGhost();
    drawnLayer.clearLayers(); activePoly=null;
    clearHandles(); disarmPin(); setMapHeadline(null);
    boxMode=false; setSizer(false); showTracebar(false); hideHint();
    try{ history.replaceState(null,'',location.pathname+location.search); }catch(e){}
    _activeFieldId=null; _priorSnap=null; removeChangeBanner();
    document.getElementById('fs-clear').disabled=true;
    var dk=document.querySelector('.fs-dock'); if(dk) dk.classList.remove('has-field');
    document.getElementById('fs-results').hidden=true;
    var _dk=document.getElementById('fs-deck'); if(_dk){ _dk.hidden=true; _dk.innerHTML=''; }
    document.getElementById('fs-empty').hidden=false;
    setFieldChrome(false);
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
    _activeFieldId = arr[0].id;        // start tracking this field for changed-since
    saveSnap(_activeFieldId, fieldSnapshot());  // baseline = current conditions
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
    removeChangeBanner();
    _activeFieldId = id;           // saved field → eligible for changed-since
    _priorSnap = loadSnap(id);     // last visit's conditions, if any
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
      flashHint('Tap your field on the map');
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

  // After we land on a spot (search or GPS), the tap-to-field path is live — just
  // say so. Keep a keyboard-accessible "analyze a field box here" affordance so a
  // pointing device is never required.
  function afterLocate(lat, lng){
    flashHint('Tap your field on the map &mdash; or', 15000);
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
        var hd=document.getElementById('fs-hint');
        if(hd){ hd.innerHTML='<b>&#9998;</b>&nbsp;'+Math.round(polyAcres(poly))+' ac &middot; drag corners to fit'; hd.hidden=false; clearTimeout(_hintTimer); }
      });
      h.on('dragend', function(){
        activePoly = poly;
        // hand-fit shape → no preset is "the" size anymore
        if(boxMode){ var sz=document.getElementById('fs-sizer'); if(sz) sz.querySelectorAll('button[data-ac]').forEach(function(b){ b.classList.remove('on'); }); }
        flashHint(Math.round(polyAcres(poly))+' ac');
        runAll(poly);
        ga('field_edit', {});
      });
      h.addTo(map);
      cornerHandles.push(h);
    });
  }

  // ── On-map headline: the bottom-line verdict, revealed onto the map itself ──
  var mapHeadlineEl=null;
  function setMapHeadline(text){
    if(!map) return;
    if(!mapHeadlineEl){
      mapHeadlineEl=document.createElement('div');
      mapHeadlineEl.className='fs-map-headline';
      mapHeadlineEl.style.display='none';
      try { map.getContainer().appendChild(mapHeadlineEl); } catch(e){ return; }
    }
    if(text){
      mapHeadlineEl.innerHTML='<span class="fs-mh-tag">Bottom line</span>'+text;
      mapHeadlineEl.style.display='';
    } else {
      mapHeadlineEl.style.display='none';
    }
  }

  function dismissInvite(){ document.documentElement.classList.add('fs-invite-off'); }

  // Instrument chrome: hide the empty-state invitation + set the app-bar context
  // when a field is active; restore when cleared.
  function setFieldChrome(on, acres){
    var inv=document.getElementById('fs-invite'); if(inv) inv.hidden=!!on;
    document.documentElement.classList.toggle('fs-has-field', !!on);
    var cx=document.getElementById('fs-appbar-ctx');
    if(cx){
      if(on && acres!=null){ cx.textContent=(+acres).toFixed(1)+' ac'; cx.hidden=false; }
      else { cx.hidden=true; cx.textContent=''; }
    }
  }

  // ── SIGNATURE: the land scan ──────────────────────────────────────────────
  // When a field commits, sweep a scan-line across it, spotlight it, and flash a
  // readout — the instrument reading the ground. Self-removing; respects reduced motion.
  function runFieldScan(poly){
    if(!map || !poly) return;
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    try{
      var b=poly.getBounds();
      var p1=map.latLngToContainerPoint(b.getNorthWest());
      var p2=map.latLngToContainerPoint(b.getSouthEast());
      var pad=16;
      var x=Math.min(p1.x,p2.x)-pad, y=Math.min(p1.y,p2.y)-pad;
      var w=Math.abs(p2.x-p1.x)+pad*2, h=Math.abs(p2.y-p1.y)+pad*2;
      if(w<8||h<8) return;
      var host=map.getContainer();
      var prev=host.querySelector('.fs-scan'); if(prev) prev.parentNode.removeChild(prev);
      var ov=document.createElement('div');
      ov.className='fs-scan';
      ov.style.left=x+'px'; ov.style.top=y+'px'; ov.style.width=w+'px'; ov.style.height=h+'px';
      ov.innerHTML='<div class="fs-scan-grid"></div><div class="fs-scan-line"></div>'+
                   '<div class="fs-scan-tag">Reading the ground&hellip;</div>';
      host.appendChild(ov);
      setTimeout(function(){ if(ov.parentNode) ov.parentNode.removeChild(ov); }, 1350);
    }catch(e){}
  }

  // Numbers tally up rather than just appearing — reinforces "the instrument is reading".
  function countUp(el, target, decimals){
    if(!el) return;
    decimals = decimals||0;
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      el.textContent=(+target).toFixed(decimals); return;
    }
    var start=null, dur=750;
    function step(now){
      if(start===null) start=now;
      var t=Math.min(1,(now-start)/dur), e=1-Math.pow(1-t,3);
      el.textContent=(target*e).toFixed(decimals);
      if(t<1) requestAnimationFrame(step); else el.textContent=(+target).toFixed(decimals);
    }
    requestAnimationFrame(step);
  }

  // ── Changed-since-last-visit: for SAVED fields, snapshot key conditions and, on the
  // next open, surface what moved (drought, rain, the bottom line). This is the reason
  // to come back tomorrow. Stored per-field in the browser only — never on a server. ──
  var _settleTimer=null, _activeFieldId=null, _priorSnap=null;
  function fieldSnapshot(){
    if(!FIELD) return null;
    var se=FIELD.season||{}, d=FIELD.drought||{}, rd=FIELD.read||{};
    var ix=FIELD.indices, ixL=ix&&(ix.latest||(ix.series&&ix.series.length?ix.series[ix.series.length-1]:null));
    return { drought: d.cat||null,
             pDep: (se.pDep!=null? +(+se.pDep).toFixed(1):null),
             gDep: (se.gDep!=null? Math.round(se.gDep):null),
             ndvi: (ixL&&ixL.ndvi!=null? +(+ixL.ndvi).toFixed(2):null),
             passDate: (ixL&&ixL.date)||null,
             verdict: rd.verdict||null, ts: Date.now() };
  }
  function snapKey(id){ return 'agsist-fs-snap-'+id; }
  function loadSnap(id){ try{ return JSON.parse(localStorage.getItem(snapKey(id))||'null'); }catch(e){ return null; } }
  function saveSnap(id, snap){ try{ if(snap) localStorage.setItem(snapKey(id), JSON.stringify(snap)); }catch(e){} }
  function diffSnap(prev, cur){
    var out=[];
    if(!prev||!cur) return out;
    var was=prev.drought||'None', now=cur.drought||'None';
    if(was!==now){
      var worse = (now!=='None') && (was==='None' || now>was);
      out.push((worse?'&#9650; ':'&#9660; ')+'Drought status moved from <strong>'+esc(was)+'</strong> to <strong>'+esc(now)+'</strong>.');
    }
    if(prev.pDep!=null && cur.pDep!=null){
      var dd=+(cur.pDep-prev.pDep).toFixed(1);
      if(Math.abs(dd)>=0.3){
        if(dd<0) out.push('&#9650; The field got drier &mdash; rain ran <strong>'+Math.abs(dd)+'&Prime; further below normal</strong> since your last look.');
        else out.push('&#9660; The field caught rain &mdash; running <strong>'+dd+'&Prime; wetter</strong> than at your last look.');
      }
    }
    if(prev.ndvi!=null && cur.ndvi!=null){
      var dv=+(cur.ndvi-prev.ndvi).toFixed(2);
      var newPass = cur.passDate && prev.passDate && cur.passDate!==prev.passDate;
      if(Math.abs(dv)>=0.04){
        out.push((dv>0?'&#9650; Vigor is <strong>up '+dv.toFixed(2):'&#9660; Vigor is <strong>down '+Math.abs(dv).toFixed(2))+'</strong> since your last look (NDVI '+prev.ndvi.toFixed(2)+' &rarr; '+cur.ndvi.toFixed(2)+')'+(newPass?' on a new clear pass':'')+'.');
      } else if(newPass){
        out.push('&bull; A new clear satellite pass came in ('+esc(cur.passDate)+') &mdash; vigor is holding right where you left it (NDVI '+cur.ndvi.toFixed(2)+').');
      }
    }
    if(prev.verdict && cur.verdict && prev.verdict!==cur.verdict){
      out.push('&bull; The bottom line changed: <strong>'+esc(cur.verdict)+'</strong>.');
    }
    return out;
  }
  function removeChangeBanner(){ var ex=document.getElementById('fs-change-banner'); if(ex&&ex.parentNode) ex.parentNode.removeChild(ex); }
  function renderChangeBanner(changes){
    removeChangeBanner();
    if(!changes||!changes.length) return;
    var body=document.getElementById('fs-insight'); if(!body||!body.parentNode) return;
    var div=document.createElement('div');
    div.id='fs-change-banner'; div.className='fs-change-banner';
    div.innerHTML='<span class="fs-cb-tag"><svg class="fs-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:.9em;height:.9em;vertical-align:-.1em"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> Since you last looked</span>'+
      changes.map(function(c){ return '<div class="fs-cb-line">'+c+'</div>'; }).join('');
    body.parentNode.insertBefore(div, body);
  }
  function scheduleSettle(){ clearTimeout(_settleTimer); _settleTimer=setTimeout(onReadSettled, 1500); }
  function onReadSettled(){
    if(_activeFieldId==null) return;          // only saved fields have a stable identity
    var cur=fieldSnapshot(); if(!cur) return;
    if(_priorSnap){ renderChangeBanner(diffSnap(_priorSnap, cur)); _priorSnap=null; }
    saveSnap(_activeFieldId, cur);
  }

  // ── The field box: real PLSS shapes farmers think in ────────────────
  // 40 = quarter-quarter (¼ mi square) · 80 = the long eighty (¼ × ½ mi)
  // 160 = quarter section (½ mi square) · 20 = ¼ × ⅛ mi.
  // [E-W meters, N-S meters]; 1/4 mile = 402.336 m. (The previous single box
  // spanned ~568 m square ≈ 80 ac while labeled ~40 — these are exact.)
  var BOX_DIMS = { 20:[402.336,201.168], 40:[402.336,402.336], 80:[402.336,804.672], 160:[804.672,804.672] };
  function boxRing(lat, lng, ac){
    var d=BOX_DIMS[ac]||BOX_DIMS[40];
    var dLat=(d[1]/2)/111320;
    var dLng=(d[0]/2)/(111320*Math.max(0.2,Math.cos(lat*Math.PI/180)));
    return [[lat+dLat,lng-dLng],[lat+dLat,lng+dLng],[lat-dLat,lng+dLng],[lat-dLat,lng-dLng]];
  }
  var ghostPoly=null, ghostBar=null;
  function clearGhost(){
    if(ghostPoly){ try{ map.removeLayer(ghostPoly); }catch(e){} ghostPoly=null; }
    if(ghostBar){ try{ ghostBar.remove(); }catch(e){} ghostBar=null; }
  }
  function showGhost(lat, lng){
    clearGhost();
    dismissInvite();
    ghostPoly=L.polygon(boxRing(lat,lng,40), { color:'#daa520', weight:2, dashArray:'6,6', fillColor:'#daa520', fillOpacity:0.07, interactive:false });
    ghostPoly.addTo(map);
    ghostBar=document.createElement('div');
    ghostBar.className='fs-ghostbar';
    ghostBar.innerHTML='<span>Field here?</span>'
      +'<button type="button" class="fs-ghost-yes">\u2713 Use this field</button>'
      +'<button type="button" class="fs-ghost-no" aria-label="Cancel">\u2715</button>';
    // Pinned to the VIEWPORT, not the map: the phone map runs taller than the screen,
    // so a map-bottom bar rendered below the fold \u2014 tap a field, see nothing. (Fixed 2026-07-20.)
    document.body.appendChild(ghostBar);
    ghostBar.querySelector('.fs-ghost-yes').addEventListener('click', function(){
      var c=ghostPoly.getBounds().getCenter();
      clearGhost();
      dropFieldBox(c.lat, c.lng);
      ga('field_ghost_confirm', {});
    });
    ghostBar.querySelector('.fs-ghost-no').addEventListener('click', function(){ clearGhost(); });
  }
  function dropFieldBox(lat, lng, ac){
    clearGhost();
    ac = BOX_DIMS[ac] ? ac : 40;
    var poly=L.polygon(boxRing(lat,lng,ac), { color:'#daa520', weight:3, fillColor:'#daa520', fillOpacity:0.15 });
    try { drawControl.disable(); } catch(e){}
    boxMode=true;
    commitField(poly, 'box');
    makeEditable(poly);
    setSizer(true, ac);
    flashHint(Math.round(polyAcres(poly))+' ac &middot; drag corners to fit, or pick a size below');
    ga('field_box', { acres: Math.round(polyAcres(poly)) });
  }
  // Resize the active box around its own center to a standard parcel size.
  function resizeBoxTo(ac){
    if(!activePoly || !boxMode || !BOX_DIMS[ac]) return;
    var c=polyCentroid(activePoly);
    activePoly.setLatLngs(boxRing(c.lat, c.lng, ac));
    makeEditable(activePoly);
    try { map.fitBounds(activePoly.getBounds(), { padding:[40,40], maxZoom:16 }); } catch(e){}
    setSizer(true, ac);
    runAll(activePoly);
    ga('field_resize', { acres: ac });
  }
  function setSizer(show, ac){
    var s=document.getElementById('fs-sizer'); if(!s) return;
    s.hidden=!show;
    if(show) s.querySelectorAll('button[data-ac]').forEach(function(b){
      b.classList.toggle('on', +b.getAttribute('data-ac')===ac);
    });
  }
  function showTracebar(on){ var t=document.getElementById('fs-tracebar'); if(t) t.hidden=!on; }
  function jumpToRead(){ var el=document.getElementById('fs-panel'); if(el) el.scrollIntoView({behavior:'smooth', block:'start'}); }

  // ── Shareable field links: the polygon lives in the URL hash, nowhere else ──
  function encodePoly(poly){
    return latlngs(poly).map(function(p){ return p.lat.toFixed(5)+','+p.lng.toFixed(5); }).join('~');
  }
  function writeHash(poly){
    try { history.replaceState(null,'',location.pathname+location.search+'#f='+encodePoly(poly)); } catch(e){}
  }
  function shareField(){
    if(!activePoly) return;
    writeHash(activePoly);
    var url=location.href;
    function done(){ flashHint('Field link copied &mdash; anyone who opens it sees this exact field', 6000); ga('field_share', {}); }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(done, function(){ window.prompt('Copy this field link:', url); });
    } else { window.prompt('Copy this field link:', url); }
  }
  function restoreFromLink(){
    var m=/^#f=(.+)$/.exec(location.hash||''); if(!m) return false;
    try {
      var pts=decodeURIComponent(m[1]).split('~').map(function(s){
        var a=s.split(','); return L.latLng(+a[0], +a[1]);
      }).filter(function(p){ return isFinite(p.lat)&&isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180; });
      if(pts.length<3 || pts.length>80) return false;
      var poly=L.polygon(pts, { color:'#daa520', weight:3, fillColor:'#daa520', fillOpacity:.15 });
      dismissInvite();
      commitField(poly, 'link');
      ga('field_link_open', {});
      return true;
    } catch(e){ return false; }
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
    if(window.innerWidth<=820) setTimeout(jumpToRead, 1400);  // let the scan land first
    ga('field_demo', {});
  }

  // Shared commit path for every way a field enters: draw, demo, box, link.
  function commitField(poly, src){
    // Sanity cap: a "field" bigger than ~4 sections isn't a field, it's a map mistake
    // (a trace at low zoom once committed 28 million acres). Refuse loudly, keep honest.
    var _capAc = polyAcres(poly);
    if(_capAc > 2500){
      try{ map.removeLayer(poly); }catch(e){}
      drawnLayer.clearLayers();
      flashHint('That traced out to '+Math.round(_capAc).toLocaleString('en-US')+' acres — Field Scout reads one field at a time (under 2,500 ac). Zoom in and try again.');
      ga('field_too_big', { acres: Math.round(_capAc) });
      return;
    }
    drawnLayer.clearLayers();
    if(src!=='box') clearHandles();
    if(src!=='box'){ boxMode=false; setSizer(false); }
    _activeFieldId=null; _priorSnap=null; removeChangeBanner();  // fresh unsaved field
    activePoly = poly;
    drawnLayer.addLayer(poly);
    try { map.fitBounds(poly.getBounds(), { padding:[40,40], maxZoom:16 }); } catch(e){}
    var cb=document.getElementById('fs-clear'); if(cb) cb.disabled=false;
    var dk=document.querySelector('.fs-dock'); if(dk) dk.classList.add('has-field');
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
    runFieldScan(poly);
    resetField(acres, c);
    writeHash(poly);   // the URL is always a share link for the field on screen
    document.getElementById('fs-empty').hidden=true;
    setFieldChrome(true, acres);
    var R=document.getElementById('fs-results');
    R.hidden=false;
    R.innerHTML =
      fieldHead(acres, c) +
      '<div class="fs-section fs-insight-section" id="fs-insight-wrap" hidden>'+
        '<div class="fs-section-h"><span class="ico">'+ICONS.read+'</span>The Read on This Field</div>'+
        '<div class="fs-section-body" id="fs-insight"></div>'+
      '</div>';
    var D=document.getElementById('fs-deck');
    if(D){
      D.hidden=false;
      D.innerHTML =
        '<div class="fs-deck-label">Field readout</div>'+
        '<div class="fs-vitals" id="fs-vitals"></div>' +
        '<div class="fs-deck-grid">' +
          section('soil',ICONS.soil,'Soil & Productivity','fs-soil') +
          section('rot',ICONS.rot,'10-Year Crop Rotation','fs-rot') +
          section('wx',ICONS.wx,'Weather & Drought','fs-wx') +
          section('season',ICONS.season,'Season vs Normal','fs-season') +
          section('vigor',ICONS.vigor,'Crop Vigor &amp; Moisture','fs-vigor') +
          section('risk',ICONS.risk,'Risk Profile','fs-risk') +
          section('bids',ICONS.bids,'Nearby Cash Bids','fs-bids') +
          section('rent',ICONS.rent,'What This Ground Rents For','fs-rent') +
          section('market',ICONS.market,'Selling It From Here','fs-market') +
          section('hood',ICONS.hood,'Who Farms Around Here','fs-hood') +
          section('cond',ICONS.cond,'How the Crop Looks Statewide','fs-cond') +
        '</div>';
    }

    var _an=R.querySelector('.acres-n'); if(_an){ _an.textContent='0.0'; setTimeout(function(){ countUp(_an, acres, 1); }, 320); }
    // fire all sources independently — fail soft; each calls recomputeInsight()
    var sb=document.getElementById('fs-save'); if(sb) sb.addEventListener('click', saveCurrentField);
    var shb=document.getElementById('fs-share'); if(shb) shb.addEventListener('click', shareField);
    var rb=document.getElementById('fs-report'); if(rb) rb.addEventListener('click', generateReport);
    loadSoil(poly);
    loadRotation(poly);
    loadWeather(c);
    loadDrought(c);
    loadSeason(c);
    loadIndices(poly);
    loadBids(c);
    loadHailData(c);
    loadCounty(c);
  }

  function fieldHead(acres, c){
    return '<div class="fs-fieldhead">'+
      '<div class="fs-fh-row">'+
        '<div class="fs-fh-main"><div class="acres"><span class="acres-n">'+acres.toFixed(1)+'</span> <small>acres</small></div>'+
        '<div class="coords">center '+c.lat.toFixed(4)+', '+c.lng.toFixed(4)+'</div></div>'+
        '<div class="fs-fh-btns">'+
        '<button class="fs-save-btn" id="fs-save" type="button"><svg class="fs-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 17l-5.3 2.8 1-5.8L3.5 9.7l5.9-.9z"/></svg>Save field</button>'+
        '<button class="fs-save-btn" id="fs-share" type="button"><svg class="fs-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>Share</button>'+
        '<button class="fs-save-btn" id="fs-report" type="button"><svg class="fs-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14"/></svg>Field report</button>'+
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
    bids:  SVG+'<circle cx="12" cy="12" r="9"/><path d="M12 6v12"/><path d="M14.6 9c0-1.3-1.1-1.9-2.6-1.9s-2.6.6-2.6 1.9 1.1 1.7 2.6 1.9 2.6.6 2.6 1.9-1.1 1.9-2.6 1.9-2.6-.6-2.6-1.9"/></svg>',
    vigor: SVG+'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
    rent:  SVG+'<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/></svg>',
    market:SVG+'<path d="M5 21V9"/><path d="M19 21V9"/><path d="M2 9l10-6 10 6"/><path d="M9 21v-8h6v8"/><path d="M2 21h20"/></svg>',
    hood:  SVG+'<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2"/><circle cx="17.5" cy="9.5" r="2.5"/><path d="M16 21v-1.5a4.5 4.5 0 0 1 6 0V21"/></svg>',
    cond:  SVG+'<path d="M12 22V8"/><path d="M12 8C12 5 10 3 6 3c0 3 2 5 6 5Z"/><path d="M12 13c0-3 2-5 6-5 0 3-2 5-6 5Z"/></svg>'
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
        var classes = rows.map(function(r){ return { name:r[2]||r[1], ac:parseFloat(r[3])||0, nicc:parseInt(r[4],10)||null, slope:(r[5]==null||r[5]==='')?null:parseFloat(r[5]), nccpi:(r[6]==null||r[6]==='')?null:parseFloat(r[6]), nccpiCorn:(r[7]==null||r[7]==='')?null:parseFloat(r[7]), nccpiSoy:(r[8]==null||r[8]==='')?null:parseFloat(r[8]), drainage:(r[9]==null||r[9]==='')?null:String(r[9]) }; });
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
        // Drainage: share of acreage mapped as poorly / very poorly drained (old
        // workers return no drainage column — everything stays null, nothing breaks)
        var drAc=0, drTot=0, drTop=null, drTopAc=-1;
        classes.forEach(function(x){ if(x.drainage){ drTot+=x.ac; if(/poorly/i.test(x.drainage)&&!/somewhat/i.test(x.drainage)) drAc+=x.ac; if(x.ac>drTopAc){ drTopAc=x.ac; drTop=x.drainage; } } });
        var poorPct = drTot>0 ? Math.round(drAc/drTot*100) : null;
        FIELD.soil = { classes:classes, total:total, hasAc:hasAc, worst:worst, primePct:primePct,
                       top:classes[0]||null, slope:avgSlope, maxSlope:maxSlope, drainageTop:drTop, poorDrainPct:poorPct,
                       nccpi:wNccpi('nccpi'), nccpiCorn:wNccpi('nccpiCorn'), nccpiSoy:wNccpi('nccpiSoy') };
        recomputeInsight(); renderRisk();
        var palette=['#7c5a2e','#9c7339','#b58d4f','#c9a878','#8a6a3b','#a37d45'];
        var html = rows.slice(0,6).map(function(r,i){
          var ac=parseFloat(r[3])||0;
          var hasArea = total>0 && ac>0;                 // only show area/% when SSURGO returned per-mapunit acreage
          var pct = hasArea ? Math.round(ac/total*100) : null;
          var nicc = r[4]; // non-irrigated capability class (1 best … 8 worst)
          var cls = nicc ? classText(nicc) : '';
          var meta = cls + (cls&&hasArea?' · ':'') + (hasArea?ac.toFixed(1)+' ac':'');
          return '<div class="fs-soil-row">'+
            '<div class="fs-soil-bar" style="background:'+palette[i%palette.length]+'">'+(nicc||'?')+'</div>'+
            '<div class="fs-soil-info"><div class="fs-soil-name">'+esc(r[2]||r[1])+'</div>'+
            (meta?'<div class="fs-soil-meta">'+meta+'</div>':'')+'</div>'+
            (pct!=null?'<div class="fs-soil-pct">'+pct+'%</div>':'')+'</div>';
        }).join('');
        if(!hasAc){ html += '<div class="fs-caveat">SSURGO returned the soil map units for this field but not per-unit acreage, so area shares aren\u2019t shown. Soils are listed by map unit.</div>'; }
        var slopeNote = '';
        if(FIELD.soil.nccpi!=null){
          var nc=FIELD.soil.nccpi, tier = nc>=0.65?'upper tier':nc>=0.5?'above the national midpoint':nc>=0.35?'mid-range':nc>=0.2?'lower-middle':'lower end';
          var pct=Math.round(nc*100);
          slopeNote += '<div class="fs-soil-slope"><strong>NCCPI '+nc.toFixed(2)+'</strong> &mdash; '+tier+' of USDA\u2019s national row-crop productivity index ('+pct+'/100). The index is weighted toward Corn Belt soils, so strong regional ground can still sit mid-scale here'+
            (FIELD.soil.nccpiCorn!=null?'. Corn '+FIELD.soil.nccpiCorn.toFixed(2)+(FIELD.soil.nccpiSoy!=null?' · soy '+FIELD.soil.nccpiSoy.toFixed(2):''):'')+'.</div>';
        }
        if(FIELD.soil.poorDrainPct!=null && FIELD.soil.poorDrainPct>=25){
          slopeNote += '<div class="fs-soil-slope"><strong>'+FIELD.soil.poorDrainPct+'% of the acreage maps as poorly drained</strong> &mdash; the survey\u2019s way of saying the low ground holds water. Late planting and drown-out corners here are the soil, not the operator; tile is the structural fix conversation.</div>';
        } else if(FIELD.soil.drainageTop){
          slopeNote += '<div class="fs-soil-slope">Dominant drainage: <strong>'+esc(FIELD.soil.drainageTop)+'</strong></div>';
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
    var url = FS_WORKER + '/cdl?lat='+c.lat.toFixed(5)+'&lon='+c.lng.toFixed(5)+'&years=10';
    fetch(url).then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){
        if(gen !== fieldGen) return;
        if(!d || d.error || !d.rotation || !d.rotation.length){
          setBody('fs-rot','<div class="fs-err">USDA crop history isn\u2019t resolving for this spot. CDL covers the Lower 48; coverage thins at field edges and outside CONUS.</div>'); return;
        }
        // worker returns most-recent-first; history carries EVERY published year —
        // take up to a decade of it (falls back to the 5-yr rotation on old workers),
        // flip to oldest→newest for the timeline + streak math
        var full = (d.history && d.history.length ? d.history : d.rotation);
        var recent = full.slice(0, 10).reverse();
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
          setBody('fs-rot','<div class="fs-src">USDA\u2019s Cropland Data Layer doesn\u2019t classify this spot as row-crop or forage ground over the years on record &mdash; it reads as pasture, forest, developed, or water at the field center. Draw over active cropland to see a rotation.</div>');
          return;
        }
        var html='<div class="fs-rotation">'+ codes.map(function(code,i){
          var info = code ? crop(code) : {l:'—',e:'·',c:'#333'};
          return '<div class="fs-rot-year">'+
            '<div class="fs-rot-chip" aria-hidden="true" style="background:'+hexA(info.c,.18)+';border-color:'+hexA(info.c,.5)+'">'+esc(info.l.charAt(0))+'</div>'+
            '<div class="fs-rot-crop">'+esc(info.l)+'</div>'+
            '<div class="fs-rot-yr">\''+String(years[i]).slice(2)+'</div></div>';
        }).join('') + '</div>'+
        (codes.length>5?'<div class="fs-src" style="margin-top:.5rem"><strong style="color:var(--text-dim)">'+codes.length+' years on record:</strong> '+cornCount+'\u00d7 corn, '+beanCount+'\u00d7 beans'+(maxCornStreak>=2?', longest corn streak '+maxCornStreak+' yrs':'')+'</div>':'')+
        '<div class="fs-src" style="margin-top:.6rem">USDA Cropland Data Layer · dominant cover at field center</div>'+
        '<div class="fs-caveat">CDL is satellite-classified (~85&ndash;90% accurate per pixel) and sampled at the field\u2019s center point, so a single odd year may be a classification miss rather than a real planting.</div>';
        setBody('fs-rot', html);
      })
      .catch(function(){ if(gen!==fieldGen) return; setErr('fs-rot','The USDA crop-history service isn\u2019t responding right now &mdash; a temporary government-server hiccup, not your field. Redraw in a few minutes.'); });
  }

  // ── 3. WEATHER (Open-Meteo) ─────────────────────────────────────────
  // fetch with a hard timeout — a stalled (never-responding) connection otherwise
  // leaves a panel spinning forever, since fetch() has no built-in timeout and
  // .catch only fires on rejection, not on a hang.
  function fetchT(url, ms){
    if(typeof AbortController==='undefined') return fetch(url);
    var ctrl=new AbortController(), id=setTimeout(function(){ try{ctrl.abort();}catch(e){} }, ms||12000);
    return fetch(url,{signal:ctrl.signal}).then(function(r){ clearTimeout(id); return r; }, function(e){ clearTimeout(id); throw e; });
  }

  function loadWeather(c){
    var gen = fieldGen;
    var url=METEO_URL+'?latitude='+c.lat.toFixed(4)+'&longitude='+c.lng.toFixed(4)+
      '&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m'+
      '&daily=precipitation_sum,temperature_2m_max,temperature_2m_min'+
      '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&past_days=7&forecast_days=1';
    fetchT(url).then(function(r){return r.json();}).then(function(d){
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
    fetchT(url, 15000).then(function(r){return r.ok?r.json():null;}).then(function(d){
      if(gen !== fieldGen) return;
      // Honesty rule: 'None' is a real answer from the service; a failed or
      // unrecognized response is UNKNOWN (null) — never assert no-drought on error.
      var cat=null;
      if(d && !d.error){
        var lvl = d.DroughtClass!=null ? d.DroughtClass : (d.dm!=null?d.dm:(Array.isArray(d)&&d[0]&&d[0].DroughtClass!=null?d[0].DroughtClass:null));
        if(lvl!=null) cat = droughtLabel(lvl);
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
    fetchT(url, 15000).then(function(r){ return r.ok ? r.json() : null; }).then(function(d){
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
    // one-sentence synthesis of the two numbers above — the "so what"
    var wet=s.pDep>=1, dry=s.pDep<=-1, hot=s.gDep>=75, cool=s.gDep<=-75, seasonSay;
    if(hot&&dry) seasonSay='A hot, dry season so far \u2014 the crop is developing fast into a moisture deficit, the combination to watch closest.';
    else if(hot&&wet) seasonSay='Warm and well-watered \u2014 fast development with moisture to back it. About the best combination there is.';
    else if(cool&&wet) seasonSay='A cool, wet season \u2014 development is running behind, and low ground may be struggling with the surplus.';
    else if(cool&&dry) seasonSay='Cool and dry \u2014 slow development, but the moisture deficit bites less at this pace.';
    else if(hot) seasonSay='Heat is running ahead of normal on near-normal rain \u2014 development is ahead of the calendar.';
    else if(cool) seasonSay='Heat units are lagging on near-normal rain \u2014 expect development a few days behind a typical year.';
    else if(wet) seasonSay='Rain is running ahead of normal at a normal heat pace \u2014 moisture is banked, not a limiting factor so far.';
    else if(dry) seasonSay='Rain is running behind normal at a normal heat pace \u2014 not acute yet, but the deficit is the number to watch.';
    else seasonSay='Both rain and heat are tracking close to this spot\u2019s normal \u2014 an unremarkable season in the best sense.';
    return '<div class="fs-stats" style="grid-template-columns:1fr 1fr">'+rainBlock+gduBlock+'</div>'+
      '<div class="fs-vigor-say" style="margin:.55rem 0 .2rem">'+seasonSay+'</div>'+
      spark +
      '<div class="fs-src" style="margin-top:.55rem">Open-Meteo ERA5 · this season vs '+s.n+'-yr average, Jan 1 through '+fmtDate(s.thru)+' · GDU base 50°F</div>';
  }

  // Cumulative-precip sparkline: this year's curve riding inside the prior-years
  // min/max band — the at-a-glance "ahead of / behind normal" read.
  function precipSparkline(cumMap, cur, prior){
    var mds=Object.keys(cumMap[cur]).sort();           // Jan 1 → cutoff, this year
    if(mds.length<8) return '';
    // v: uniform-scale chart with axes — inch gridlines, month ticks, endpoint value.
    var W=360, H=126, padL=32, padR=40, padT=10, padB=18;
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
    // y-axis: hairlines + inch labels at 0 / half / max
    var MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var grid='';
    [0,0.5,1].forEach(function(f){
      var v=maxV*f, gy=Y(v);
      grid+='<line x1="'+padL+'" y1="'+gy.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+gy.toFixed(1)+'" stroke="rgba(132,160,168,'+(f===0?'.28':'.12')+'" stroke-width="1"/>'+
        '<text x="'+(padL-5)+'" y="'+(gy+3).toFixed(1)+'" text-anchor="end" font-size="9" fill="#8a948f" font-family="JetBrains Mono,monospace">'+(f===0?'0':v.toFixed(1)+'\u2033')+'</text>';
    });
    // x-axis: first-of-month ticks; label alternate months when crowded
    var ticks=[];
    mds.forEach(function(md,i){ if(i>0 && md.slice(3)==='01') ticks.push({i:i,m:+md.slice(0,2)-1}); });
    var every=ticks.length>8?2:1;
    ticks.forEach(function(t,k){
      var tx=X(t.i);
      grid+='<line x1="'+tx.toFixed(1)+'" y1="'+padT+'" x2="'+tx.toFixed(1)+'" y2="'+(H-padB).toFixed(1)+'" stroke="rgba(132,160,168,.1)" stroke-width="1"/>';
      if(k%every===0) grid+='<text x="'+tx.toFixed(1)+'" y="'+(H-6)+'" text-anchor="middle" font-size="9" fill="#8a948f" font-family="JetBrains Mono,monospace">'+MONTHS[t.m]+'</text>';
    });
    // band polygon: hi forward, lo backward
    var band='M'+X(0).toFixed(1)+' '+Y(hi[0]).toFixed(1)+' '+
      hi.map(function(v,i){ return 'L'+X(i).toFixed(1)+' '+Y(v).toFixed(1); }).join(' ')+' '+
      lo.slice().reverse().map(function(v,i){ var idx=lo.length-1-i; return 'L'+X(idx).toFixed(1)+' '+Y(v).toFixed(1); }).join(' ')+' Z';
    var endV=now[now.length-1];
    var ahead = endV >= hi[hi.length-1];
    var behind = endV <= lo[lo.length-1];
    var lineCol = behind ? '#e0a32e' : (ahead ? '#4aab4c' : '#9fd2ff');
    // endpoint dot + value, clamped inside the frame
    var ex=X(now.length-1), ey=Math.max(padT+7, Math.min(H-padB-3, Y(endV)));
    var endLbl='<circle cx="'+ex.toFixed(1)+'" cy="'+Y(endV).toFixed(1)+'" r="3.2" fill="'+lineCol+'"/>'+
      '<text x="'+(ex+6).toFixed(1)+'" y="'+(ey+3).toFixed(1)+'" font-size="10" font-weight="700" fill="'+lineCol+'" font-family="JetBrains Mono,monospace">'+endV.toFixed(1)+'\u2033</text>';
    return '<div class="fs-chart-title">Cumulative rainfall &mdash; Jan 1 to date</div>'+
      '<svg viewBox="0 0 '+W+' '+H+'" '+
      'role="img" aria-label="Cumulative rainfall this season versus the prior-years range" style="display:block;width:100%;height:auto;margin-top:.35rem">'+
      grid+
      '<path d="'+band+'" fill="rgba(159,210,255,.14)" stroke="none"></path>'+
      '<path d="'+lineOf(hi)+'" fill="none" stroke="rgba(159,210,255,.35)" stroke-width="1"></path>'+
      '<path d="'+lineOf(lo)+'" fill="none" stroke="rgba(159,210,255,.35)" stroke-width="1"></path>'+
      '<path d="'+lineOf(now)+'" fill="none" stroke="'+lineCol+'" stroke-width="2.4" stroke-linejoin="round"></path>'+
      endLbl+
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
      // one plain-language read of the numbers above — what they mean for work today
      var wkN=parseFloat(wx.wk)||0, wxSay;
      if(wx.wind>15) wxSay='Too windy to spray right now \u2014 drift risk at '+wx.wind+' mph.';
      else if(wkN>=1.5) wxSay='A wet week ('+wx.wk+'\u2033 in 7 days) \u2014 low ground is likely soft underfoot.';
      else if(wx.hum>85 && wx.temp>=70) wxSay='Warm and humid \u2014 prime conditions for foliar disease; slow herbicide drydown too.';
      else if(wx.temp>90) wxSay='Hot \u2014 crop water demand is peaking; spray early if you spray.';
      else if(wx.wind<=10 && wx.hum<=85) wxSay='A decent working window \u2014 light wind, workable humidity.';
      else wxSay='Middling conditions \u2014 nothing blocking field work, nothing ideal.';
      html += '<div class="fs-vigor-say" style="margin-top:.55rem">'+wxSay+'</div>';
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
  // Hail history now reads the site's own static per-year event files
  // (/data/hail/events-YYYY.json, built by the monthly hail data run) —
  // dated + sized, no live upstream in the request path. The old worker
  // route queried an IEM endpoint whose parameters that service ignores,
  // so it silently returned empty for every field. Never again: the data
  // the map draws and the data the brain reasons on are the same files.
  var _hailEvCache={};
  function _hailYearFile(y){
    if(_hailEvCache[y]) return Promise.resolve(_hailEvCache[y]);
    return fetch('/data/hail/events-'+y+'.json')
      .then(function(r){ if(!r.ok) throw new Error('ev '+y); return r.json(); })
      .then(function(d){ _hailEvCache[y]=d; return d; });
  }
  function _hvsMi(a,b,c,d){ var R=3958.8,p=Math.PI/180,x=(c-a)*p,y=(d-b)*p,
    s=Math.sin(x/2)*Math.sin(x/2)+Math.cos(a*p)*Math.cos(c*p)*Math.sin(y/2)*Math.sin(y/2);
    return R*2*Math.atan2(Math.sqrt(s),Math.sqrt(1-s)); }
  function loadHailData(c){
    var gen = fieldGen;
    var yNow = new Date().getFullYear();
    var yrs = [yNow-4, yNow-3, yNow-2, yNow-1, yNow];
    Promise.all(yrs.map(function(y){ return _hailYearFile(y).catch(function(){ return null; }); }))
      .then(function(files){
        if(gen !== fieldGen) return;
        var got = files.filter(Boolean);
        if(!got.length) throw new Error('no event files');
        var days={}, maxStone=0, events=0;
        got.forEach(function(f){
          (f.ev||[]).forEach(function(e){
            if(_hvsMi(c.lat, c.lng, e[0], e[1]) > 40) return;
            events++;
            var day = f.year + '-' + e[3];
            days[day]=1;
            if(e[2]!=null && +e[2] > maxStone) maxStone = +e[2];
          });
        });
        FIELD.hail = { events:events, days:Object.keys(days).length, dates:Object.keys(days).sort(), maxStone:maxStone, years:got.length };
        recomputeInsight(); renderRisk();
      })
      .catch(function(){
        if(gen!==fieldGen) return;
        // Event files not published yet — fall back to the worker route once.
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
            FIELD.hail = { events:feats.length, days:Object.keys(days).length, dates:Object.keys(days).sort(), maxStone:maxStone, years:5 };
            recomputeInsight(); renderRisk();
          })
          .catch(function(){ if(gen!==fieldGen) return; if(FIELD)FIELD.hail={err:1}; renderRisk(); });
      });
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
      '<div class="fs-src" style="margin-top:.5rem">A starting risk read from public data &mdash; not an underwriting decision. Questions? <a href="mailto:sig@farmers1st.com" style="color:var(--brand,var(--gold))">Sigurd Lindquist &rarr;</a></div>');
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
        if(!zip){ if(FIELD){ FIELD.bids={corn:null,bean:null,zip:'',count:0}; recomputeInsight(); } setBody('fs-bids','<div class="fs-src">This field sits far enough from a mapped ZIP that we can\u2019t pull nearby bids for it &mdash; common for remote parcels. Try the cash-bids page directly for your area.</div>'); return; }
        return fetch(BIDS_PROXY+'/barchart/getGrainBids?zipCode='+encodeURIComponent(zip)+'&maxDistance=75&getAllBids=1')
          .then(function(r){return r.json();})
          .then(function(d){ if(gen!==fieldGen) return; renderBids(d, zip, gen); });
      })
      .catch(function(){ if(gen!==fieldGen) return; if(FIELD){ FIELD.bids={corn:null,bean:null,zip:'',count:0}; recomputeInsight(); } setErr('fs-bids','Couldn\u2019t reach the cash-bid feed just now.'); });
  }
  function renderBids(d, zip, gen){
    if(gen!==fieldGen) return;
    // Mirrors cash-bids.html flatten() exactly: handles both the nested shape
    // (item.bids[]) and the flat shape (bid fields on the item itself).
    var raw = (d && (d.results||d.bids||d.data)) || [];
    if(!Array.isArray(raw)) raw=[];
    var flat=[];
    raw.forEach(function(item){
      if(item.bids && Array.isArray(item.bids)){
        var fac = item.company||item.name||item.locationName||'Elevator';
        item.bids.forEach(function(b){
          flat.push({ elev:fac, city:item.city||b.city||'', dist:parseFloat(item.distance||b.distance)||null,
            commodity:b.commodity||b.commodity_display_name||b.commodityName||'',
            delivery:b.delivery||b.deliveryStart||b.delivery_start||b.deliveryPeriod||b.delivery_end_formatted||'',
            cash:parseFloat(b.cashprice||b.cashPrice), basis:(b.basis!=null&&b.basis!=='')?parseFloat(b.basis):null });
        });
      } else if(item.commodity||item.commodityName||item.cashprice!==undefined||item.cashPrice!==undefined){
        flat.push({ elev:item.company||item.name||item.facility||item.locationName||'Elevator',
          city:item.city||'', dist:parseFloat(item.distance)||null,
          commodity:item.commodity||item.commodity_display_name||item.commodityName||'',
          delivery:item.delivery||item.deliveryStart||item.delivery_start||item.deliveryPeriod||'',
          cash:parseFloat(item.cashprice||item.cashPrice), basis:(item.basis!=null&&item.basis!=='')?parseFloat(item.basis):null });
      }
    });
    flat = flat.filter(function(x){ return !isNaN(x.cash); }).sort(function(a,b){ return (a.dist||999)-(b.dist||999); });
    if(!flat.length){ if(FIELD){ FIELD.bids={corn:null,bean:null,zip:zip,count:0}; recomputeInsight(); } setBody('fs-bids','<div class="fs-src">No elevators are reporting cash bids near ZIP '+esc(zip)+' right now. Bid coverage is densest across the Corn Belt and thins out elsewhere &mdash; this isn\u2019t an error.</div>'); return; }
    // record best CONVENTIONAL corn & bean bid for the insight engine — specialty
    // bids (organic, food-grade, white, popcorn, seed, non-GMO) trade $2–8/bu over
    // conventional and must never headline as "cash corn". The full list below
    // still shows them; they just can't drive the metrics.
    var SPECIALTY=/organic|food|white|pop\b|popcorn|sweet|seed|screen|waxy|non.?gmo|specialty|premium|hi.?oil|high.?oil|nu.?gen|identity/i;
    function bestConv(re){
      return flat.filter(function(x){ return re.test(x.commodity) && !SPECIALTY.test(x.commodity); })
                 .sort(function(a,b){ return b.cash-a.cash; })[0] || null;
    }
    var corn=bestConv(/corn/i);
    var bean=bestConv(/bean|soy/i);
    if(FIELD) { FIELD.bids = { corn:corn, bean:bean, zip:zip, count:flat.length }; recomputeInsight(); }
    var html = flat.slice(0,6).map(function(x){
      // Feeds report basis in cents or dollars inconsistently — normalize to cents.
      var bC = x.basis!=null ? (Math.abs(x.basis)<5 ? Math.round(x.basis*100) : Math.round(x.basis)) : null;
      var basis = bC!=null ? '<span class="fs-bid-basis" style="color:'+(bC>=0?'#4aab4c':'#d9534f')+'">'+(bC>=0?'+':'\u2212')+Math.abs(bC)+'\u00a2</span>' : '';
      var dlv = x.delivery ? ' · '+esc(String(x.delivery).slice(0,18)) : '';
      return '<div class="fs-bid-row"><div class="fs-bid-el">'+esc(x.commodity)+' <small>'+esc(x.elev)+(x.dist?' · '+Math.round(x.dist)+' mi':'')+dlv+'</small></div>'+
        '<div style="text-align:right"><div class="fs-bid-px">$'+x.cash.toFixed(2)+'</div>'+basis+'</div></div>';
    }).join('');
    setBody('fs-bids', html +
      '<div class="fs-src" style="margin-top:.45rem">Basis = cents vs the futures board. A less-negative basis than your area\u2019s usual means local demand is paying up \u2014 the strongest bid isn\u2019t always the highest cash number if hauling eats the spread.</div>'+
      '<div class="fs-src" style="margin-top:.4rem"><a href="/cash-bids" style="color:var(--brand,var(--gold))">All bids near ZIP '+esc(zip)+' →</a></div>');
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

  // ── 7. CROP VIGOR & MOISTURE (Sentinel-2 indices via Worker /indices) ──
  // The field's own satellite pixels, in plain language: vigor (NDVI), canopy
  // moisture (NDMI) and their season trajectory. Big words first, acronyms hidden.
  function loadIndices(poly){
    var gen=fieldGen;
    var pts=latlngs(poly);
    var ring=pts.map(function(p){ return [p.lng, p.lat]; });
    postJSON(FS_WORKER + '/indices', { ring: ring })
      .then(function(d){
        if(gen!==fieldGen) return;
        FIELD.indices = d;
        renderIndices(d);
        recomputeInsight();
        renderPassTimeline();   // if the vigor layer is already on, the replay fills in
      })
      .catch(function(){
        if(gen!==fieldGen) return;
        setBody('fs-vigor','<div class="fs-caveat">Satellite crop-vigor isn\u2019t loading right now. You can still toggle the <b>Crop vigor</b> map layer to see it on the map, or check back after the next clear sky.</div>');
      });
  }

  function idxTrend(series, key){
    var vals=series.filter(function(r){ return r[key]!=null; });
    if(!vals.length) return null;
    var now=vals[vals.length-1][key];
    var peak=vals[0]; for(var i=0;i<vals.length;i++){ if(vals[i][key]>peak[key]) peak=vals[i]; }
    var dir='flat';
    if(vals.length>=3){
      var prev=vals[vals.length-3][key];
      if(now-prev>0.04) dir='rising'; else if(prev-now>0.04) dir='easing';
    }
    if(dir==='flat'){ if(now<peak[key]-0.05) dir='easing'; else if(vals[vals.length-1]===peak) dir='rising'; }
    return { now:now, peak:peak[key], peakDate:peak.date, dir:dir };
  }

  function monthTicks(t0, t1){
    var span=(t1-t0)||1, out=[];
    var d=new Date(t0); var cur=new Date(d.getFullYear(), d.getMonth()+1, 1);
    while(cur.getTime()<t1){
      out.push({ frac:(cur.getTime()-t0)/span, label:cur.toLocaleDateString(undefined,{month:'short'}) });
      cur=new Date(cur.getFullYear(), cur.getMonth()+1, 1);
    }
    return out;
  }

  function sparkline(series, key, color, baseline){
    var vals=series.filter(function(r){ return r[key]!=null; });
    if(vals.length<2) return '';
    var w=280, h=48, pad=5;
    var times=vals.map(function(r){ return new Date(r.date+'T12:00:00Z').getTime(); });
    var t0=times[0], t1=times[times.length-1], span=(t1-t0)||1;
    var ys=vals.map(function(r){ return r[key]; });
    var allY=ys.slice(); if(baseline!=null) allY.push(baseline);
    var mn=Math.min.apply(null,allY), mx=Math.max.apply(null,allY); if(mx-mn<0.01){ mx=mn+0.01; }
    function X(t){ return pad+(w-2*pad)*(t-t0)/span; }
    function Y(v){ return h-pad-(h-2*pad)*(v-mn)/(mx-mn); }
    var pts=vals.map(function(r,i){ return X(times[i]).toFixed(1)+','+Y(r[key]).toFixed(1); });
    var ticks=monthTicks(t0,t1);
    var grid=ticks.map(function(tk){ var x=(pad+(w-2*pad)*tk.frac).toFixed(1); return '<line x1="'+x+'" y1="2" x2="'+x+'" y2="'+(h-2)+'" stroke="rgba(132,160,168,.16)" stroke-width="1"/>'; }).join('');
    var base = (baseline!=null) ? '<line x1="'+pad+'" y1="'+Y(baseline).toFixed(1)+'" x2="'+(w-pad)+'" y2="'+Y(baseline).toFixed(1)+'" stroke="rgba(132,160,168,.6)" stroke-width="1" stroke-dasharray="4 3"/>' : '';
    var last=pts[pts.length-1].split(',');
    // endpoint value label — clamped inside the frame, anchored away from the right edge
    var endVal=ys[ys.length-1];
    var lx=Math.min(+last[0], w-30), ly=Math.max(10, Math.min(h-4, +last[1]-6));
    var endTxt='<text x="'+lx.toFixed(1)+'" y="'+ly.toFixed(1)+'" text-anchor="end" font-size="9" font-weight="700" fill="'+color+'" font-family="JetBrains Mono,monospace">'+endVal.toFixed(2)+'</text>';
    var svg='<svg class="fs-spark" viewBox="0 0 '+w+' '+h+'" aria-hidden="true" style="width:100%;height:auto;display:block">'+grid+base+
      '<polyline points="'+pts.join(' ')+'" fill="none" stroke="'+color+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'+
      '<circle cx="'+last[0]+'" cy="'+last[1]+'" r="3" fill="'+color+'"/>'+endTxt+'</svg>';
    var ax='<span class="fs-spark-ax" style="left:0;transform:none">'+ixDate(vals[0].date)+'</span>';
    ticks.forEach(function(tk){ if(tk.frac>0.1 && tk.frac<0.9) ax+='<span class="fs-spark-ax" style="left:'+(tk.frac*100).toFixed(1)+'%">'+tk.label+'</span>'; });
    ax+='<span class="fs-spark-ax" style="left:auto;right:0;transform:none">'+ixDate(vals[vals.length-1].date)+'</span>';
    return svg+'<div class="fs-spark-axis">'+ax+'</div>';
  }

  // ── Crop-aware vigor language (v: fixes the "alfalfa after cutting reads as
  // failure" problem). Same thresholds don't mean the same thing on hay ground
  // that just got cut, wheat that's supposed to ripen brown, or grazed pasture. ──
  function fieldCropClass(){
    var r=FIELD&&FIELD.rotation, c=r&&r.lastCrop;
    if(c===36||c===37) return 'hay';                       // alfalfa, other hay
    if(c===23||c===24||c===21||c===28) return 'smallgrain'; // wheats, barley, oats
    if(c===176) return 'pasture';
    return 'row';
  }
  function grainRipening(){ var m=new Date().getMonth()+1; return m>=7&&m<=9; }  // Jul–Sep senescence window
  function offSeason(){ var m=new Date().getMonth()+1; return m>=11||m<=3; }      // Nov–Mar
  function vigorWord(v){
    if(v==null) return 'No clear read';
    var cls=fieldCropClass();
    if(cls==='hay') return v>=0.6?'Strong':(v>=0.45?'Healthy':(v>=0.3?'Regrowing':'Just cut / dormant'));
    if(cls==='pasture') return v>=0.6?'Lush':(v>=0.45?'Good cover':(v>=0.3?'Grazed / recovering':'Short / dormant'));
    if(cls==='smallgrain'&&grainRipening()&&v<0.45) return v>=0.3?'Ripening':'Mature / harvested';
    return v>=0.6?'Strong':(v>=0.45?'Healthy':(v>=0.3?'Developing':'Low / bare'));
  }
  function vigorSentence(v){
    if(v==null) return 'No clear vigor read yet';
    var cls=fieldCropClass();
    if(cls==='hay'){
      if(v>=0.6) return 'Dense, healthy stand';
      if(v>=0.45) return 'Solid growing canopy';
      if(v>=0.3) return 'Regrowth building &mdash; normal after a cutting';
      return 'Low canopy &mdash; typical right after a cutting; the regrowth slope over the next passes is the health read';
    }
    if(cls==='pasture'){
      if(v>=0.6) return 'Lush, well-recovered sward';
      if(v>=0.45) return 'Good cover, actively growing';
      if(v>=0.3) return 'Recovering from grazing &mdash; watch the rebound';
      return 'Short cover &mdash; recently grazed or dormant';
    }
    if(cls==='smallgrain'&&grainRipening()&&v<0.45){
      return v>=0.3 ? 'Ripening down &mdash; a falling read is normal as the grain matures'
                    : 'Mature or harvested &mdash; brown is the goal at this stage, not a problem';
    }
    if(v>=0.6) return 'Healthy, closed canopy';
    if(v>=0.45) return 'Solid, actively growing canopy';
    if(v>=0.3) return 'Developing canopy &mdash; partial ground cover';
    return 'Low cover &mdash; bare ground, residue, or a very early stand';
  }
  function vigorColor(v){
    if(v==null) return 'var(--dim)';
    var cls=fieldCropClass();
    // Contextually-normal low reads should never scream red
    if(v<0.3 && (cls==='hay'||cls==='pasture'||(cls==='smallgrain'&&grainRipening()))) return 'var(--gold)';
    return v>=0.6?'var(--green)':(v>=0.3?'var(--gold)':'var(--red)');
  }
  // Plain-language verdict for each index value — so a farmer never meets a naked
  // number. Thresholds are rough season-stage guides (the ? tips carry the nuance).
  function idxRead(k, v){
    if(v==null) return null;
    v=+v;
    if(k==='ndvi') return { w:vigorWord(v), c:vigorColor(v) };
    if(k==='ndre') return v>=0.30?{w:'Strong',c:'var(--green,#5fc28a)'}:(v>=0.15?{w:'Moderate',c:'var(--gold,#d4a23f)'}:{w:'Low',c:'var(--red,#e0685f)'});
    if(k==='ndmi') return v>=0.20?{w:'Well-watered',c:'var(--green,#5fc28a)'}:(v>=0?{w:'Adequate',c:'var(--gold,#d4a23f)'}:{w:'Dry / stressed',c:'var(--red,#e0685f)'});
    if(k==='msi')  return v>=1.4?{w:'High stress',c:'var(--red,#e0685f)'}:(v>=0.8?{w:'Moderate',c:'var(--gold,#d4a23f)'}:{w:'Low stress',c:'var(--green,#5fc28a)'});
    if(k==='ndwi') return v>=0.2?{w:'Very wet',c:'var(--green,#5fc28a)'}:(v>=0?{w:'Moist',c:'var(--green,#5fc28a)'}:(v>=-0.15?{w:'Typical',c:'var(--gold,#d4a23f)'}:{w:'Dry',c:'var(--red,#e0685f)'}));
    if(k==='bsi')  return v>=0.1?{w:'Mostly bare',c:'var(--red,#e0685f)'}:(v>=0?{w:'Thin cover',c:'var(--gold,#d4a23f)'}:{w:'Vegetated',c:'var(--green,#5fc28a)'});
    return null;
  }
  function idxChip(label,val,what){
    var r=idxRead(label.toLowerCase(), val);
    var w = r ? '<span style="color:'+r.c+';font-weight:600">'+r.w+'</span> &middot; '+what : what;
    return '<div class="fs-idx"><span class="fs-idx-l">'+label+tipQ(label.toLowerCase())+'</span><span class="fs-idx-v">'+(val==null?'\u2014':(+val).toFixed(2))+'</span><span class="fs-idx-w">'+w+'</span></div>';
  }

  // ── On-demand explainers: a (?) on any cryptic label opens a plain-language
  // popover. Clean until tapped — the page stays an instrument, not a textbook. ──
  var FS_TIPS = {
    acres:{t:'Acres',b:'Total area inside the boundary you drew.'},
    soil:{t:'Soil & productivity',b:'The dominant USDA soil map units under your field, ranked by share of acreage. Soil sets what the ground can yield and how it drains.'},
    nccpi:{t:'NCCPI',b:'USDA\u2019s National Commodity Crop Productivity Index \u2014 a national 0\u2013100 score for row-crop ground. Higher is more productive soil. It\u2019s weighted toward Corn Belt soils, so strong regional ground can still score mid-scale.'},
    ndvi:{t:'NDVI \u00b7 crop vigor',b:'How much living, green canopy the satellite sees. Runs about 0 (bare or dead) to 0.9 (dense, healthy crop). The best single at-a-glance crop-health number.'},
    ndre:{t:'NDRE \u00b7 nitrogen',b:'A red-edge index tied to chlorophyll and nitrogen status. Most useful after canopy close, when NDVI flattens out.'},
    ndmi:{t:'NDMI \u00b7 canopy moisture',b:'Water held in the crop canopy. Higher means more moisture in the leaves; a drop can flag stress before you can see it.'},
    nmdi:{t:'NMDI \u00b7 moisture',b:'A drought index combining canopy and soil-water signals.'},
    msi:{t:'MSI \u00b7 moisture stress',b:'Moisture Stress Index. Higher means more water stress \u2014 it runs opposite to NDMI.'},
    ndwi:{t:'NDWI \u00b7 water',b:'Surface and canopy water content. Mildly negative over dry crop ground is normal.'},
    bsi:{t:'BSI \u00b7 bare soil',b:'Bare Soil Index. Higher means more exposed soil \u2014 early season, after harvest, or a thin stand.'},
    rotation:{t:'Crop rotation',b:'What grew here each year on record (up to a decade), from USDA\u2019s satellite-classified Cropland Data Layer. Continuous corn raises rootworm and disease pressure.'},
    drought:{t:'Drought',b:'US Drought Monitor category for this field, None through D4 (exceptional). D2 and worse means real moisture stress.'},
    slope:{t:'Slope',b:'Average ground slope across the field. Steeper ground carries more water-erosion exposure.'},
    basis:{t:'Cash bid',b:'What a nearby elevator would pay for grain today \u2014 futures plus or minus local basis. The number you\u2019d actually get, not the board price.'},
    patchy:{t:'Field uniformity',b:'How evenly vigor is spread across the field. A wide spread means part of the field is lagging \u2014 a zone worth walking.'},
    normal:{t:'Field normal',b:'This field\u2019s own NDVI averaged over the same window in prior years \u2014 the baseline that says whether this season is ahead or behind.'}
  };
  var _tipFor=null;
  function tipQ(key){ return FS_TIPS[key] ? '<button class="fs-q" type="button" data-tip="'+key+'" aria-label="What is this?">?</button>' : ''; }
  function closeTip(){ var p=document.getElementById('fs-tip-pop'); if(p&&p.parentNode) p.parentNode.removeChild(p); _tipFor=null; }
  function showTip(btn){
    closeTip();
    var t=FS_TIPS[btn.getAttribute('data-tip')]; if(!t) return;
    var pop=document.createElement('div'); pop.id='fs-tip-pop'; pop.className='fs-tip-pop';
    pop.innerHTML='<div class="fs-tip-ttl">'+t.t+'</div><div class="fs-tip-body">'+t.b+'</div>';
    document.body.appendChild(pop);
    var r=btn.getBoundingClientRect(), pw=Math.min(290, window.innerWidth-20);
    pop.style.width=pw+'px';
    var left=Math.min(Math.max(10, r.left+r.width/2-pw/2), window.innerWidth-pw-10);
    pop.style.left=left+'px';
    pop.style.top=(r.bottom+8+window.scrollY)+'px';
    if(r.bottom+pop.offsetHeight+16>window.innerHeight && r.top-pop.offsetHeight-8>0){ pop.style.top=(r.top+window.scrollY-pop.offsetHeight-8)+'px'; }
    _tipFor=btn;
  }
  document.addEventListener('click', function(e){
    var q=e.target.closest ? e.target.closest('.fs-q') : null;
    if(q){ e.preventDefault(); e.stopPropagation(); if(_tipFor===q){ closeTip(); } else { showTip(q); } return; }
    if(!(e.target.closest && e.target.closest('#fs-tip-pop'))) closeTip();
  });
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeTip(); });

  // ── Vitals console: the at-a-glance ops strip. A dense mono grid of the field's
  // key numbers, each with a tap-to-explain (?). Fills in as the loaders land. ──
  function vCell(label, value, sub, tip, cls){
    return '<div class="fs-vital'+(cls?' '+cls:'')+'">'+
      '<div class="fs-vital-l">'+label+(tip?tipQ(tip):'')+'</div>'+
      '<div class="fs-vital-v">'+(value==null||value===''?'<span class="fs-vital-wait">\u00b7\u00b7\u00b7</span>':value)+'</div>'+
      (sub?'<div class="fs-vital-s">'+sub+'</div>':'')+
    '</div>';
  }
  function renderVitals(){
    var el=document.getElementById('fs-vitals'); if(!el||!FIELD) return;
    var s=FIELD.soil, r=FIELD.rotation, d=FIELD.drought, ix=FIELD.indices, b=FIELD.bids;
    var acres = FIELD.acres!=null ? (+FIELD.acres).toFixed(1) : null;
    var soilV = (s&&s.top&&s.top.name) ? esc(String(s.top.name).split(',')[0]) : null;
    var soilSub = (s&&s.primePct!=null) ? s.primePct+'% prime' : null;
    var nccpiV = (s&&s.nccpi!=null) ? Math.round(s.nccpi*100) : null;
    var v = ix ? ((ix.latest&&ix.latest.ndvi!=null)?ix.latest.ndvi:(ix.series&&ix.series.length?ix.series[ix.series.length-1].ndvi:null)) : null;
    var vigV = (v!=null) ? (+v).toFixed(2) : null;
    var vigSub = (v!=null) ? vigorWord(v) : null;
    var vigCls = (v!=null) ? (v>=0.6?'good':(v>=0.3?'mid':'low')) : '';
    var rotV=null;
    var rotV=null;
    if(r){
      if(r.codes && r.codes.length){
        rotV = r.codes.map(function(cd){ var m=(typeof CDL_CROPS!=='undefined')&&CDL_CROPS[cd]; return m?m.l.charAt(0):'\u00b7'; }).join('\u2009\u00b7\u2009');
      } else { rotV = r.cornOnCorn ? 'Corn' : 'Mixed'; }
    }
    var drV = d ? ((d.cat && d.cat!=='None') ? esc(d.cat) : 'None') : null;
    var drCls = (d && d.cat && /D[234]/.test(d.cat)) ? 'low' : '';
    var slV = (s&&s.slope!=null) ? s.slope+'%' : null;
    var bid = b ? (b.corn||b.bean) : null;
    var bidV, bidSub;
    if(!b){ bidV=null; bidSub=null; }                                    // still loading -> ...
    else if(bid && bid.cash!=null){ bidV='$'+(+bid.cash).toFixed(2); bidSub = b.corn?'cash corn':'cash beans'; }
    else { bidV='&mdash;'; bidSub='none nearby'; }                       // loaded, no elevator
    el.innerHTML =
      vCell('ACRES', acres, null, 'acres') +
      vCell('SOIL', soilV, soilSub, 'soil') +
      vCell('NCCPI', nccpiV, (nccpiV!=null?'/100':null), 'nccpi') +
      vCell('VIGOR', vigV, vigSub, 'ndvi', vigCls) +
      vCell('ROTATION', rotV, (r&&r.codes?r.codes.length+'-yr':'10-yr'), 'rotation') +
      vCell('DROUGHT', drV, null, 'drought', drCls) +
      vCell('SLOPE', slV, null, 'slope') +
      vCell('CASH', bidV, bidSub, 'basis');
  }
  function ixDate(s){ try{ return new Date(s+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric'}); }catch(e){ return s; } }
  function ixDaysAgo(s){ var n=Math.round((Date.now()-new Date(s+'T12:00:00Z').getTime())/864e5); return n<=0?'today':(n===1?'yesterday':n+' days ago'); }

  function renderIndices(d){
    var series=(d && d.series) || [];
    if(!series.length){
      setBody('fs-vigor','<div class="fs-caveat">No clear satellite pass for this field yet this season &mdash; clouds block the read. Check back after the next clear day, or toggle the <b>Crop vigor</b> map layer.</div>');
      return;
    }
    var last=d.latest || series[series.length-1];
    var nd=idxTrend(series,'ndvi'), moist=idxTrend(series,'ndmi');
    var v=nd?nd.now:null, vCol=vigorColor(v);
    var vTrend='';
    if(nd){ vTrend = nd.dir==='rising' ? ' &mdash; still greening up' : (nd.dir==='easing' ? ' &mdash; easing back from its '+ixDate(nd.peakDate)+' peak' : ' &mdash; holding steady'); }
    var sd=last.ndvi_sd, varLine='';
    if(sd!=null && v!=null){ varLine = sd>=0.12 ? 'Vigor <b>varies across the field</b> &mdash; there\u2019s likely a weaker zone worth scouting.' : 'Vigor is <b>fairly uniform</b> across the field.'; }
    var normal=d.normal, normLine='', baseV=null;
    if(normal && normal.ndvi!=null){
      baseV=normal.ndvi;
      if(v!=null){
        var diff=v-normal.ndvi;
        var rel=Math.abs(diff)<0.04?'right in line with':(diff>0?'<b>ahead of</b>':'<b>behind</b>');
        var yrs=(normal.years&&normal.years.length)?normal.years.length+'-year ':'';
        normLine='That\u2019s '+rel+' this field\u2019s '+yrs+'normal for this point in the season (typically NDVI '+normal.ndvi.toFixed(2)+' here).';
      }
    }
    var mLine='';
    if(moist){
      var md=moist.dir==='rising'?'rising':(moist.dir==='easing'?'falling':'steady');
      mLine='Canopy moisture is <b>'+md+'</b>'+(moist.dir==='easing'?' &mdash; the stand is drying down compared with earlier in the season.':(moist.dir==='rising'?' &mdash; the canopy is holding more water than before.':'.'));
    }
    // NDRE line — only meaningful once the canopy is dense enough that NDVI saturates
    var nLine='';
    var ndreT=idxTrend(series,'ndre');
    if(ndreT && v!=null && v>=0.55 && last.ndre!=null){
      var nWord=ndreT.dir==='easing'?'easing':(ndreT.dir==='rising'?'building':'steady');
      nLine='Nitrogen signal (NDRE '+(+last.ndre).toFixed(2)+') is <b>'+nWord+'</b>'+(ndreT.dir==='easing'?' while the canopy holds &mdash; the classic pattern worth a nitrogen check.':' &mdash; chlorophyll is tracking with the canopy.');
    }
    // Off-season (Nov–Mar) with a low canopy: the story is winter cover, not vigor.
    var winterHead=null;
    if(offSeason() && v!=null && v<0.3 && last.bsi!=null){
      var b2=+last.bsi;
      winterHead = b2>=0.1 ? {w:'Mostly bare ground', c:'var(--gold)', s:'Bare or tilled through winter &mdash; vigor picks back up with the next crop.'}
        : (b2>=0 ? {w:'Thin winter cover', c:'var(--gold)', s:'Some residue or thin cover holding through winter.'}
                 : {w:'Living winter cover', c:'var(--green)', s:'The satellite sees living cover through the off-season &mdash; a cover crop or perennial holding the ground.'});
    }
    var headWord = winterHead ? winterHead.w : ('Crop vigor: '+vigorWord(v));
    var headCol  = winterHead ? winterHead.c : vCol;
    var html=
      '<div class="fs-vigor-head">'+
        '<span class="fs-vigor-dot" style="background:'+headCol+'"></span>'+
        '<span class="fs-vigor-word">'+headWord+'</span>'+tipQ(winterHead?'bsi':'ndvi')+
        (v!=null?'<span class="fs-vigor-num">NDVI '+v.toFixed(2)+'</span>':'')+
      '</div>'+
      (nd?'<div class="fs-vigor-spark">'+sparkline(series,'ndvi',vCol,baseV)+'<span class="fs-spark-cap">vigor over the season'+(baseV!=null?' &middot; dashed = normal':'')+'</span></div>':'')+
      '<p class="fs-vigor-say">'+(winterHead?winterHead.s:vigorSentence(v)+vTrend+'.')+'</p>'+
      (normLine?'<p class="fs-vigor-say">'+normLine+'</p>':'')+
      (varLine?'<p class="fs-vigor-say">'+varLine+'</p>':'')+
      (mLine?'<p class="fs-vigor-say">'+mLine+'</p>':'')+
      (nLine?'<p class="fs-vigor-say">'+nLine+'</p>':'')+
      '<div class="fs-vigor-fresh"><svg class="fs-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> Last clear pass <b>'+ixDate(last.date)+'</b> ('+ixDaysAgo(last.date)+') </div>'+
      (series.length>=2?'<a href="#" class="fs-god-link fs-replay-btn" data-god="ndvi"><svg class="fs-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg> Replay '+series.length+' passes on the map &mdash; watch the season</a>':'')+
      '<details class="fs-vigor-more"><summary>Show all indices for the latest pass</summary>'+
        '<div class="fs-vigor-grid">'+
          idxChip('NDVI',last.ndvi,'vigor')+idxChip('NDRE',last.ndre,'nitrogen')+idxChip('NDMI',last.ndmi,'moisture')+
          idxChip('MSI',last.msi,'stress')+idxChip('NDWI',last.ndwi,'water')+idxChip('BSI',last.bsi,'bare soil')+
        '</div>'+
        '<div class="fs-src">Verdict words are rough guides &mdash; the right value shifts with crop and growth stage. Tap ? on any index for what it measures.</div>'+
      '</details>'+
      '<div class="fs-src">Sentinel-2 / Copernicus &middot; cloud-masked &middot; averaged over your field</div>';
    setBody('fs-vigor', html);
  }

  // ── COUNTY & STATE LAYERS (2026-07-20) — join every AGSIST data layer to the field ──
  // One reverse-geocode pins the county; then each layer fetches its own static JSON
  // and renders its own card. A dead source kills its card with a plain-talk error —
  // never the whole read, never a silent blank. All figures stored on FIELD.county
  // so the insight engine and the printable Field Report can use them.
  function cbar(label, val, center, unit, worseIsHigh){
    // ONE self-labeled diverging bar (site RULE 1): value at tip, center tick = own normal.
    var delta = val - center;
    var span = Math.max(Math.abs(delta)*1.4, Math.abs(center)*0.15, 0.01);
    var pct = Math.max(-1, Math.min(1, delta/span));                    // -1..1
    var w = Math.abs(pct)*42;                                           // % of track width
    var left = pct<0 ? (50-w) : 50;
    var bad = worseIsHigh ? delta>0 : delta<0;
    var col = bad ? '#e0685f' : '#5fc28a';
    var sign = delta>0?'+':'−';
    var vtxt = sign + (unit==='$'? '$'+Math.abs(delta).toFixed(Math.abs(delta)<10?2:0) : Math.abs(delta).toFixed(0)+unit);
    var vleft = pct<0 ? 'left:'+left+'%;transform:translateX(calc(-100% - 5px))' : 'left:'+(left+w)+'%;transform:translateX(5px)';
    return '<div class="fs-cbar"><div class="fs-cbar-l">'+label+'</div>'+
      '<div class="fs-cbar-t"><span class="fs-cbar-tick"></span>'+
      '<span class="fs-cbar-f" style="left:'+left+'%;width:'+w+'%;background:'+col+'"></span>'+
      '<span class="fs-cbar-v" style="'+vleft+';color:'+col+'">'+vtxt+'</span></div></div>';
  }
  function bigline(num, numCls, word, wordCls){
    return '<div class="fs-cbig"><span class="fs-cnum '+(numCls||'')+'">'+num+'</span><span class="fs-cword '+(wordCls||'')+'">'+word+'</span></div>';
  }
  function csrc(t){ return '<div class="fs-src" style="margin-top:.45rem">'+t+'</div>'; }
  function isoWeek(dstr){
    var d=new Date(dstr+'T12:00:00Z');
    var t=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));
    t.setUTCDate(t.getUTCDate()+4-(t.getUTCDay()||7));
    var y0=new Date(Date.UTC(t.getUTCFullYear(),0,1));
    return Math.ceil(((t-y0)/864e5+1)/7);
  }
  function getJSON(url){ return fetch(url).then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); }); }
  function loadCounty(c){
    var gen = fieldGen;
    var ERR_ALL = 'Couldn’t pin down the county for this spot right now (reverse-geocode didn’t answer). The county numbers need it — redraw in a minute and they usually load.';
    fetch(NOMINATIM_REV+'?format=jsonv2&zoom=8&lat='+c.lat+'&lon='+c.lng)
      .then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); })
      .then(function(d){
        if(gen!==fieldGen) return;
        var ad=(d&&d.address)||{};
        var stFull=ad.state, cty=(ad.county||'').replace(/\s+County$/i,'');
        var abbr=N2A[stFull];
        if(!abbr||!cty){ ['fs-rent','fs-market','fs-hood','fs-cond'].forEach(function(id){ setErr(id, 'This spot didn’t resolve to a US county — the county and state layers only cover the fifty states.'); }); return; }
        FIELD.county = { name:cty, st:stFull, abbr:abbr, fips:null };
        var co=document.querySelector('#fs-results .coords');
        if(co) co.textContent='center '+c.lat.toFixed(4)+', '+c.lng.toFixed(4)+' · '+cty+' County, '+stFull;
        loadRentCard(gen, abbr, cty, stFull);
        loadMarketCard(gen, abbr, stFull);
        loadHoodCard(gen, abbr, cty, stFull);
        loadCondCard(gen, abbr, stFull);
      })
      .catch(function(){ if(gen!==fieldGen) return; ['fs-rent','fs-market','fs-hood','fs-cond'].forEach(function(id){ setErr(id, ERR_ALL); }); });
  }
  function loadRentCard(gen, abbr, cty, stFull){
    getJSON('/data/cash-rent/'+abbr+'.json').then(function(d){
      if(gen!==fieldGen) return;
      var rec=(d.counties||[]).find(function(x){ return String(x.name).toLowerCase()===cty.toLowerCase(); });
      if(!rec){ setErr('fs-rent','NASS publishes no county rent survey for '+esc(cty)+' County — small samples get suppressed rather than guessed.'); return; }
      if(FIELD.county) FIELD.county.fips = rec.fips;
      var ni=rec.rent&&rec.rent.nonirr||{};
      var yrs=Object.keys(ni).map(Number).sort(function(a,b){return a-b;});
      if(!yrs.length){ setErr('fs-rent','No non-irrigated rent series for '+esc(cty)+' County in the NASS survey.'); return; }
      var last=yrs[yrs.length-1], val=ni[last];
      var last10=yrs.slice(-10), avg=last10.reduce(function(s,y){return s+ni[y];},0)/last10.length;
      var cornY=rec.yield&&rec.yield.corn;
      var html=bigline('$'+Math.round(val), 'gold', '/ac non-irrigated · '+last, '');
      html+=cbar('county rent vs its own '+last10.length+'-yr average, $/ac', val, avg, '$', true);
      html+='<div class="fs-cbar-cap">center tick = '+esc(cty)+' Co’s own average ($'+Math.round(avg)+') · red = pricier than usual</div>';
      if(cornY&&cornY.trend){
        var trend=Math.round(cornY.trend);
        var lastY=cornY.last!=null?cornY.last:null;
        var bid=FIELD.bids&&FIELD.bids.corn?FIELD.bids.corn.cash:null;
        var money = bid ? ' At $'+bid.toFixed(2)+' nearby corn that’s $'+Math.round(trend*bid).toLocaleString('en-US')+' gross — rent takes '+Math.round(val/(trend*bid)*100)+'%.' : '';
        html+='<p class="fs-cline">County corn trend: <strong>'+trend+' bu/ac</strong>'+(lastY?' (made '+lastY+' last year)':'')+'.'+money+' <a class="fs-act-link" href="/cash-lease?st='+abbr+'" target="_blank" rel="noopener">Run this lease in Cash Lease &rarr;</a></p>';
      }
      html+=csrc('USDA NASS county cash-rent survey · '+esc(cty)+' County, '+esc(stFull)+' · missing years = never surveyed, not zero');
      FIELD.county.rent={ val:val, year:last, avg:Math.round(avg), trend:cornY&&cornY.trend?Math.round(cornY.trend):null, lastYield:cornY?cornY.last:null };
      setBody('fs-rent', html); recomputeInsight();
    }).catch(function(){ if(gen===fieldGen) setErr('fs-rent','County rent data didn’t load — refresh in a minute.'); });
  }
  function loadMarketCard(gen, abbr, stFull){
    Promise.all([
      getJSON('/data/transport/basis.json').catch(function(){ return null; }),
      getJSON('/data/storage/storage.json').catch(function(){ return null; })
    ]).then(function(res){
      if(gen!==fieldGen) return;
      var b=res[0], st=res[1], html='', got=false;
      var isBeans = FIELD.rotation && FIELD.rotation.lastCrop===5;
      if(b&&b.series){
        var key=(isBeans?'Soybeans':'Corn')+'|'+stFull+'|Elevator Bid';
        var s=b.series[key] || b.series['Corn|'+stFull+'|Elevator Bid'];
        var crop = b.series[key] ? (isBeans?'soybean':'corn') : 'corn';
        if(s&&s.latest!=null&&s.avg5!=null){
          got=true;
          var dev=s.latest-s.avg5;
          var word = dev<=-0.4?'Basis is ugly':dev<=-0.15?'Basis is soft':dev>=0.15?'Basis is strong':'Basis is normal';
          var wcls = dev<=-0.15?'red':dev>=0.15?'green':'';
          html+=bigline((s.latest<0?'−$':'$')+Math.abs(s.latest).toFixed(2), wcls||'gold', word, wcls);
          html+=cbar(esc(stFull)+' '+crop+' basis vs its own 5-yr normal, $/bu', s.latest, s.avg5, '$', false);
          html+='<div class="fs-cbar-cap">center tick = normal for this week ('+(s.avg5>=0?'+$':'−$')+Math.abs(s.avg5).toFixed(2)+') · as of '+esc(s.date||'')+'</div>';
          FIELD.county.basis={ latest:s.latest, avg5:s.avg5, dev:dev, crop:crop, date:s.date };
        }
      }
      if(st&&st.states&&st.states[abbr]&&st.states[abbr].ratio){
        var ra=st.states[abbr].ratio, ys=Object.keys(ra).map(Number).sort(function(a,c){return a-c;});
        var ly=ys[ys.length-1], r=ra[ly];
        var since=null; for(var i=ys.length-2;i>=0;i--){ if(ra[ys[i]]>=r){ since=ys[i]; break; } }
        got=true;
        var pct=Math.round(r*100);
        html+='<p class="fs-cline">'+(pct>=90?'Storage pressure is part of the picture: ':'')+esc(stFull)+'’s '+ly+' crop filled <strong>'+pct+'% of every bin in the state</strong>'+(since&&pct>=85?' — tightest since '+since:'')+'.'+(pct>=90?' Weak basis pays you to have your own steel.':'')+' <a class="fs-act-link" href="/grain-bin-calculator" target="_blank" rel="noopener">Bin math &rarr;</a></p>';
        FIELD.county.storage={ ratio:r, year:ly, since:since };
      }
      if(!got){ setErr('fs-market','No AgTransport basis series or storage figures published for '+esc(stFull)+' — USDA tracks a limited set of states.'); return; }
      html+=csrc('USDA AgTransport weekly basis · NASS grain stocks &amp; production · state-level, not your elevator');
      setBody('fs-market', html); recomputeInsight();
    });
  }
  function loadHoodCard(gen, abbr, cty, stFull){
    Promise.all([
      getJSON('/data/tenure/tenure.json').catch(function(){ return null; }),
      getJSON('/data/afida/county.json').catch(function(){ return null; })
    ]).then(function(res){
      if(gen!==fieldGen) return;
      var t=res[0], a=res[1], html='', got=false;
      var fips=FIELD.county&&FIELD.county.fips;
      function findByName(obj){ var hit=null; if(!obj) return null;
        Object.keys(obj).some(function(k){ var v=obj[k]; if(v&&String(v.n).toLowerCase()===cty.toLowerCase()&&(v.st===abbr||v.st===stFull)){ hit={k:k,v:v}; return true; } return false; });
        return hit; }
      var trec = t&&t.counties ? (fips&&t.counties[fips]?{k:fips,v:t.counties[fips]}:findByName(t.counties)) : null;
      var denom=null;
      if(trec){
        var ys=Object.keys(trec.v.y).map(Number).sort(function(x,y){return x-y;});
        var ly=ys[ys.length-1], pair=trec.v.y[ly];   // [owned, rented]
        if(pair&&pair.length===2){
          got=true;
          var owned=pair[0], rented=pair[1]; denom=owned+rented;
          var pct=Math.round(rented/denom*100);
          if(!fips){ fips=trec.k; if(FIELD.county) FIELD.county.fips=fips; }
          html+=bigline(pct+'%','blue','rented ground','');
          html+='<p class="fs-cline">'+esc(cty)+' Co farms rent <strong>'+Math.round(rented).toLocaleString('en-US')+' of '+Math.round(denom).toLocaleString('en-US')+' acres</strong> ('+ly+' census)'+(pct>=60?' — landlord country, and rents show it.':'.')+'</p>';
          FIELD.county.tenure={ pct:pct, rented:rented, total:denom, year:ly };
        }
      }
      var arec = a ? (fips&&a[fips]?a[fips]:(findByName(a)||{}).v) : null;
      if(arec&&arec.y){
        var ays=Object.keys(arec.y).map(Number).sort(function(x,y){return x-y;});
        var aly=ays[ays.length-1], ac=arec.y[aly];
        if(ac!=null){
          got=true;
          var share = denom ? Math.round(ac/denom*100) : null;
          var tops=(arec.top||[]).slice(0,2).filter(function(x){ return !/NO PREDOMINANT/i.test(x[0]); });
          var chips=tops.map(function(x){ return '<span class="fs-cchip">'+esc(String(x[0]).replace(/\b\w+/g,function(w){return w.charAt(0)+w.slice(1).toLowerCase();}))+' '+Math.round(x[1]).toLocaleString('en-US')+'</span>'; }).join('');
          html+='<p class="fs-cline">Foreign owners hold <strong>'+Math.round(ac).toLocaleString('en-US')+' ac</strong> in this county'+(share!=null?' ('+share+'% of farmland)':'')+' as of '+aly+'. '+chips+' <a class="fs-act-link" href="/foreign-land" target="_blank" rel="noopener">Who owns the ground &rarr;</a></p>';
          FIELD.county.afida={ acres:ac, year:aly, share:share };
        }
      }
      if(!got){ setErr('fs-hood','No census tenure or AFIDA rows published for '+esc(cty)+' County — suppressed small-sample counties stay blank rather than estimated.'); return; }
      html+=csrc('USDA Census of Agriculture (owned vs rented-from-others) · USDA AFIDA foreign-holdings filings');
      setBody('fs-hood', html); recomputeInsight();
    });
  }
  function loadCondCard(gen, abbr, stFull){
    Promise.all([
      getJSON('/data/conditions/conditions.json').catch(function(){ return null; }),
      getJSON('/data/cond-yield/fit.json').catch(function(){ return null; })
    ]).then(function(res){
      if(gen!==fieldGen) return;
      var c=res[0], f=res[1];
      var isBeans = FIELD.rotation && FIELD.rotation.lastCrop===5;
      var haveSoy = c&&c.crops&&c.crops.soybeans;
      var cropKey = (isBeans&&haveSoy)?'soybeans':'corn', cropWord = cropKey;
      var cc=c&&c.crops&&c.crops[cropKey];
      var srow=cc&&cc.states&&cc.states[abbr];
      if(!srow){ setErr('fs-cond','NASS doesn’t rate '+esc(cropWord)+' weekly in '+esc(stFull)+' (or under 10 comparable years) — thin samples aren’t ranked.'); return; }
      var wcls = srow.pctile>=60?'green':srow.pctile<=30?'red':'gold';
      var html=bigline(Math.round(srow.ge)+'%', wcls, 'Good–Excellent', wcls);
      html+='<p class="fs-cline">'+esc(stFull)+' '+cropWord+' sits in the <strong>'+srow.pctile+'th percentile</strong> for this week since 2000 (best '+Math.round(srow.best)+', worst '+Math.round(srow.worst)+').</p>';
      var wk=cc.week_ending?isoWeek(cc.week_ending):null;
      var fr=f&&f.crops&&f.crops[cropKey]&&f.crops[cropKey].states&&f.crops[cropKey].states[abbr];
      var r2 = fr&&wk!=null&&fr.weeks&&fr.weeks[wk] ? fr.weeks[wk].r2 : null;
      if(r2!=null){
        html+='<p class="fs-cline">Fair warning from the record: this week’s ratings historically explain <strong>~'+Math.round(r2*100)+'% of final yield</strong> — '+(r2<0.35?'the crop is still being made':'ratings are starting to mean something')+'. <a class="fs-act-link" href="/conditions-yield" target="_blank" rel="noopener">What ratings are worth &rarr;</a></p>';
      }
      html+=csrc('USDA NASS weekly crop condition · week of '+esc(cc.week_ending||'')+' · state-level, ranked against the same week 2000–present');
      FIELD.county.cond={ ge:srow.ge, pctile:srow.pctile, week:cc.week_ending, r2:r2, crop:cropWord };
      setBody('fs-cond', html); recomputeInsight();
    });
  }

  function recomputeInsight(){
    if(!FIELD) return;
    renderVitals();
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

    // ── Satellite vigor × soil × the field's own normal (the fused read) ──
    var ix=FIELD.indices;
    if(ix && ix.series && ix.series.length){
      var ixLast=ix.latest||ix.series[ix.series.length-1];
      var ixV=ixLast.ndvi;
      var ixTr=idxTrend(ix.series,'ndvi');
      var ixNrm=ix.normal;
      var belowNorm=(ixNrm && ixNrm.ndvi!=null && ixV!=null) ? (ixV-ixNrm.ndvi) : null;
      var ixPatchy=(ixLast.ndvi_sd!=null && ixLast.ndvi_sd>=0.12);
      var ixPrime=s && ((s.primePct!=null && s.primePct>=70) || (s.nccpi!=null && s.nccpi>=0.55));
      var nrmYrs=(ixNrm && ixNrm.years && ixNrm.years.length)?ixNrm.years.length+'-year ':'';
      var cropCls=fieldCropClass();
      var normTrig = (cropCls==='hay') ? -0.12 : -0.06;   // hay sawtooths against its own normal
      if(belowNorm!=null && belowNorm<=normTrig && !(cropCls==='smallgrain'&&grainRipening())){
        push({ sev: ixPrime?4:3, act:true, topic:'vigor', tag:'a canopy running below its own normal',
          title: ixPrime ? 'the satellite says this capable ground is underperforming its own history \u2014 go look'
                          : 'crop vigor is running below this field\u2019s normal \u2014 worth a scout',
          detail:(ixPrime?'This is capable ground, yet ':'')+'the latest cloud-free pass reads NDVI <strong>'+ixV.toFixed(2)+'</strong>, about <strong>'+Math.abs(belowNorm).toFixed(2)+' below</strong> this field\u2019s '+nrmYrs+'normal for this point in the season. '+(cropCls==='hay'?'On hay ground a fresh cutting explains this &mdash; if you haven\u2019t cut recently, something is holding the stand back.':'Something on the ground is holding the canopy back.')+' <span class="fs-src">source: Sentinel-2 / Copernicus, cloud-masked</span>',
          watch: ixPatchy ? 'It\u2019s also uneven across the field \u2014 start with the weakest zone (<a href="#" class="fs-god-link" data-god="ndvi">the Crop-vigor map layer shows where</a>).'
                          : 'Scout for stand, nutrient, or moisture problems while there\u2019s still time to react.' });
      } else if(ixPatchy && ixV!=null){
        push({ sev:2, act:true, topic:'vigor', tag:'an uneven canopy',
          title:'the canopy is uneven across the field \u2014 scout the weak zone',
          detail:'Satellite vigor varies noticeably across this field (averaging NDVI '+ixV.toFixed(2)+', but spread out around it) \u2014 usually a drainage, compaction, or stand issue in one area.'+' <span class="fs-src">source: Sentinel-2 / Copernicus</span>',
          watch:'Walk the lowest-vigor corner; <a href="#" class="fs-god-link" data-god="ndvi">the map\u2019s Crop-vigor layer</a> points to it.' });
      } else if(ixV!=null && ixV>=0.6 && (belowNorm==null || belowNorm>=-0.03)){
        lines.push('The satellite backs this up: canopy vigor is <strong>strong</strong> (NDVI '+ixV.toFixed(2)+')'+(belowNorm!=null?', tracking '+(belowNorm>0.03?'above':'right at')+' its own normal for the date':'')+(ixTr&&ixTr.dir==='easing'?', easing back from its peak as you\u2019d expect for the stage':'')+'.');
      }
      if(inDrought && ixTr && ixTr.dir==='easing' && ixV!=null){
        lines.push('The drought is already showing in the canopy \u2014 vigor has been easing on recent passes.');
      }

      // ── Cross-index reads (v: the satellite finally reasons in pairs) ──
      // Trends need at least 3 usable passes before we hang a claim on them.
      var enoughPasses = ix.series.filter(function(r){ return r.ndvi!=null; }).length >= 3;

      // (a) Nitrogen divergence — corn only, canopy closed, before/near silking.
      //     NDVI holds (saturated) while NDRE eases = chlorophyll thinning under a
      //     full canopy. Correlational, so the verb is "check", never "deficient".
      if(enoughPasses && isCorn && cropStage && !cropStage.pastPollen && ixV!=null && ixV>=0.55){
        var nT=idxTrend(ix.series,'ndre');
        if(nT && nT.dir==='easing' && ixTr && ixTr.dir!=='easing'){
          push({ sev:3, act:true, topic:'nitrogen', tag:'a fading nitrogen signal under a full canopy',
            title:'the nitrogen signal is fading while the canopy holds \u2014 check N before the window closes',
            detail:'The canopy itself is holding (NDVI '+ixV.toFixed(2)+'), but the red-edge nitrogen signal (NDRE) has been <strong>easing on recent passes</strong> \u2014 the pattern that shows up when chlorophyll thins under a closed canopy. It is a satellite pattern, not a tissue test, but it is exactly what a nitrogen shortfall looks like from above.'+' <span class="fs-src">source: Sentinel-2 red-edge (NDRE), cloud-masked</span>',
            watch: pollenWindow()!=null ? 'Pollination (~'+pollenWindow()+' days out) sets kernel count \u2014 a tissue or soil nitrate check before then still leaves time to sidedress or Y-drop.' : 'A tissue or soil nitrate check confirms it either way \u2014 the satellite can only point.' });
        }
      }

      // (b) Moisture convergence — two independent calculations agreeing beats either alone.
      if(enoughPasses){
        var mT=idxTrend(ix.series,'ndmi'), sT=idxTrend(ix.series,'msi');
        if(mT && sT && mT.dir==='easing' && sT.dir==='rising'){
          var mSev = inDrought ? 4 : ((se && se.pDep!=null && se.pDep<=-2) ? 3 : 2);
          push({ sev:mSev, act:mSev>=3, topic:'moisture', tag:'a canopy drying on two independent reads',
            title: mSev>=4 ? 'the canopy is drying on every read \u2014 moisture is the story on this field'
                           : 'two independent satellite reads agree the canopy is drying',
            detail:'Canopy moisture (NDMI) is <strong>falling</strong> and the moisture-stress index (MSI) is <strong>rising</strong> across recent passes \u2014 two separate calculations from different light bands telling the same story. When they agree like this, the drying is real, not noise.'+(inDrought?' It lines up with the '+esc(d.cat)+' drought status.':'')+' <span class="fs-src">source: Sentinel-2 NDMI + MSI, cloud-masked</span>',
            watch: pollenWindow()!=null && pollenWindow()<=21 ? 'Moisture stress through pollination (~'+pollenWindow()+' days out) is the worst-timed stress there is.' : 'Watch the rain forecast \u2014 a timely inch changes this read fast.' });
        }
      }

      // (c′) Pass-drop × hail correlation — a sharp vigor drop between passes that
      // brackets a reported hail day is the "how did it know that" read. Factual
      // only: the dates line up; walking it and documenting is the action.
      var hl=FIELD.hail;
      if(hl && !hl.err && hl.dates && hl.dates.length && ix.series.length>=2){
        var sArr=ix.series.filter(function(r){ return r.ndvi!=null; });
        for(var hp=sArr.length-1; hp>=1; hp--){
          var drop=sArr[hp-1].ndvi - sArr[hp].ndvi;
          if(drop<0.06) continue;
          var d0=sArr[hp-1].date, d1=sArr[hp].date;
          var hits=hl.dates.filter(function(hd){ return hd>d0 && hd<=d1; });
          if(hits.length){
            push({ sev:3, act:true, topic:'hail', tag:'a vigor drop that lines up with reported hail',
              title:'the '+ixDate(d1)+' vigor drop lines up with a reported hail day \u2014 walk it and document',
              detail:'Vigor fell <strong>'+drop.toFixed(2)+'</strong> between the '+ixDate(d0)+' and '+ixDate(d1)+' passes, and a severe-hail report near this field is dated <strong>'+ixDate(hits[0])+'</strong> \u2014 inside that window'+(hl.maxStone?' (stones up to '+hl.maxStone+'\u2033 reported in the area over 5 yrs)':'')+'. The timing lines up; only boots in the field confirm it.'+' <span class="fs-src">source: Sentinel-2 pass-to-pass + NOAA/IEM storm reports</span>',
              watch:'Walk it soon and photograph what you find \u2014 dated satellite passes plus dated photos make a clean record for any claim conversation with your own agent or adjuster.' });
            break; // one correlation is the story; don't stack duplicates
          }
        }
      }

      // (c) Drown-out read — very wet surface + uneven canopy in a wet season.
      if(ixLast.ndwi!=null && ixLast.ndwi>=0.2 && ixPatchy && se && se.pDep!=null && se.pDep>=2){
        push({ sev:2, act:true, topic:'wet', tag:'saturated ground in the weak zones',
          title:'the wet spots are likely drowning the weak zones \u2014 walk the low ground',
          detail:'The surface-water read (NDWI '+(+ixLast.ndwi).toFixed(2)+') is running <strong>very wet</strong>, the season is '+se.pDep.toFixed(1)+'\u2033 above normal on rain, and vigor is uneven across the field \u2014 the classic drowned-low-spot signature.'+(s&&s.poorDrainPct!=null&&s.poorDrainPct>=25?' The soil survey agrees: <strong>'+s.poorDrainPct+'%</strong> of this ground maps as poorly drained.':'')+' <span class="fs-src">source: Sentinel-2 NDWI + Open-Meteo season rainfall</span>',
          watch:'Check the low corners; <a href="#" class="fs-god-link" data-god="ndvi">the Crop-vigor layer</a> shows which zones are lagging.' });
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
      if(b.corn) mk.push('corn near $'+b.corn.cash.toFixed(2)+' ('+esc(b.corn.elev)+')');
      if(b.bean) mk.push('beans near $'+b.bean.cash.toFixed(2)+' ('+esc(b.bean.elev)+')');
      if(mk.length) lines.push('Best nearby cash bids: '+mk.join(', ')+'.');
    }

    if(!lines.length && !stress.length) return;

    // No concerns at all → nudge toward the visual NDVI layer.
    if(!stress.length && s && r){
      lines.push('No red flags in the soil and rotation here — flip on <a href="#" class="fs-god-link" data-god="ndvi"><strong>Crop vigor</strong></a> to see how the stand is actually doing this season.');
    }

    stress.sort(function(a,b){ return b.sev-a.sev; });
    // ── County & state economics (2026-07-20): woven in only when the joins landed. ──
    var cy=FIELD.county;
    if(cy && (cy.rent || cy.tenure)){
      var bits=[];
      if(cy.tenure) bits.push('<strong>'+cy.tenure.pct+'% of '+esc(cy.name)+' County is rented ground</strong> ('+cy.tenure.year+' census)');
      if(cy.rent) bits.push('county cash rent ran <strong>$'+Math.round(cy.rent.val)+'/ac</strong> in '+cy.rent.year+(cy.rent.trend?' against a '+cy.rent.trend+'-bu corn trend':''));
      lines.push('Around here: '+bits.join('; ')+'.');
    }
    if(cy && cy.basis && cy.basis.dev<=-0.25){
      push({ sev:2, act:false, topic:'basis', tag:'weak basis',
        title:'basis here is running '+Math.round(Math.abs(cy.basis.dev)*100)+'¢ under normal',
        detail:esc(cy.basis.crop.charAt(0).toUpperCase()+cy.basis.crop.slice(1))+' basis in '+esc(cy.st)+' is <strong>'+(cy.basis.latest<0?'−$':'$')+Math.abs(cy.basis.latest).toFixed(2)+'</strong> vs a '+(cy.basis.avg5>=0?'+$':'−$')+Math.abs(cy.basis.avg5).toFixed(2)+' 5-yr normal — '+Math.round(Math.abs(cy.basis.dev)*100)+'¢ of freight and storage pressure coming straight off your price.'+(cy.storage&&cy.storage.ratio>=0.9?' The state’s bins are '+Math.round(cy.storage.ratio*100)+'% committed'+(cy.storage.since?' — tightest since '+cy.storage.since:'')+', which is a lot of the story.':''),
        watch:'If you have on-farm storage, weak basis is paying you to use it — and to shop bids beyond the closest elevator.' });
    }
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
    setMapHeadline(lead ? (lead.title.charAt(0).toUpperCase()+lead.title.slice(1)+'.') : null);
    scheduleSettle();
  }

  // Print-friendly NDVI season sparkline for the field report (dark line on white).
  function reportSpark(series){
    var vals=(series||[]).filter(function(r){ return r.ndvi!=null; });
    if(vals.length<3) return '';
    var w=520,h=64,pad=6,padR=44;
    var t=vals.map(function(r){ return new Date(r.date+'T12:00:00Z').getTime(); });
    var t0=t[0],t1=t[t.length-1],span=(t1-t0)||1;
    var ys=vals.map(function(r){ return r.ndvi; });
    var mn=Math.min.apply(null,ys), mx=Math.max.apply(null,ys); if(mx-mn<0.05){ mx=mn+0.05; }
    var X=function(i){ return pad+(w-pad-padR)*(t[i]-t0)/span; };
    var Y=function(v){ return h-pad-(h-2*pad)*(v-mn)/(mx-mn); };
    var pts=vals.map(function(r,i){ return X(i).toFixed(1)+','+Y(r.ndvi).toFixed(1); }).join(' ');
    var lx=X(vals.length-1), lv=ys[ys.length-1];
    function lbl(iso){ try{ return new Date(iso+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric'}); }catch(e){ return iso; } }
    return '<svg viewBox="0 0 '+w+' '+(h+16)+'" style="width:100%;height:auto;display:block;margin:8px 0 2px" role="img" aria-label="Crop vigor over the season">'+
      '<polyline points="'+pts+'" fill="none" stroke="#6b5a13" stroke-width="2" stroke-linejoin="round"/>'+
      '<circle cx="'+lx.toFixed(1)+'" cy="'+Y(lv).toFixed(1)+'" r="3" fill="#6b5a13"/>'+
      '<text x="'+(lx+6).toFixed(1)+'" y="'+(Y(lv)+4).toFixed(1)+'" font-size="11" font-weight="700" fill="#6b5a13" font-family="ui-monospace,monospace">'+lv.toFixed(2)+'</text>'+
      '<text x="'+pad+'" y="'+(h+12)+'" font-size="10" fill="#888" font-family="ui-monospace,monospace">'+lbl(vals[0].date)+'</text>'+
      '<text x="'+(w-padR)+'" y="'+(h+12)+'" text-anchor="end" font-size="10" fill="#888" font-family="ui-monospace,monospace">'+lbl(vals[vals.length-1].date)+'</text>'+
      '</svg>';
  }

  // ── Shareable one-page field report (print / save-as-PDF) ───────────
  function generateReport(){
    if(!FIELD){ return; }
    var d=FIELD, s=d.soil, r=d.rotation, dr=d.drought, se=d.season, h=d.hail, b=d.bids, rd=d.read, cy=d.county;
    var dateStr=new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
    function strip(html){ return String(html||'').replace(/<a\b[^>]*>(.*?)<\/a>/gi,'$1'); }
    function kv(label,val){ return val?('<tr><th>'+esc(label)+'</th><td>'+val+'</td></tr>'):''; }
    function sect(title,body){ return body?('<section class="r-sec"><h2>'+esc(title)+'</h2>'+body+'</section>'):''; }

    var verdictHtml = (rd&&rd.verdict) ? '<div class="r-verdict"><span>Bottom line</span>'+esc(rd.verdict.charAt(0).toUpperCase()+rd.verdict.slice(1))+'.</div>' : '';
    var lead = (rd&&rd.lines&&rd.lines.length) ? rd.lines.map(function(l){return '<p class="r-p">'+strip(l)+'</p>';}).join('') : '';
    var flagsHtml = (rd&&rd.flags&&rd.flags.length) ? '<ul class="r-flags">'+rd.flags.map(function(f){return '<li>'+strip(f)+'</li>';}).join('')+'</ul>' : '';

    var soilHtml='';
    if(s&&s.classes&&s.classes.length){
      var hasAc=s.total>0;
      soilHtml='<table class="r-tbl">'+s.classes.slice(0,6).map(function(c){
        var hasArea=hasAc&&c.ac>0;
        var pct=hasArea?Math.round(c.ac/s.total*100):null;
        return '<tr><td>'+esc(c.name)+'</td><td>class '+(c.nicc||'?')+'</td><td class="r-num">'+(hasArea?c.ac.toFixed(1)+' ac':'\u2014')+'</td><td class="r-num">'+(pct!=null?pct+'%':'\u2014')+'</td></tr>';
      }).join('')+'</table>';
      var bits=[];
      if(s.primePct!=null) bits.push(s.primePct+'% prime cropland');
      if(s.nccpi!=null) bits.push('NCCPI '+s.nccpi.toFixed(2)+'/1.00 productivity');
      if(s.slope!=null) bits.push(s.slope+'% average slope'+(s.maxSlope>s.slope?' (up to '+s.maxSlope+'%)':''));
      if(bits.length) soilHtml+='<p class="r-note">'+bits.join(' &middot; ')+'</p>';
    }

    var vigorHtml='';
    if(d.indices && d.indices.series && d.indices.series.length){
      var vx=d.indices.latest || d.indices.series[d.indices.series.length-1];
      var vv=vx.ndvi;
      var vWord = vigorWord(vv).toLowerCase();
      var nrm=d.indices.normal;
      var nrmCell='';
      if(nrm && nrm.ndvi!=null && vv!=null){ var df=vv-nrm.ndvi; nrmCell='<tr><th>Normal for this point in season</th><td>NDVI '+nrm.ndvi.toFixed(2)+' &mdash; '+(Math.abs(df)<0.04?'in line':(df>0?'ahead':'behind'))+(nrm.years&&nrm.years.length?' ('+nrm.years.length+'-yr)':'')+'</td></tr>'; }
      vigorHtml='<table class="r-kv">'+
        (vv!=null?'<tr><th>Crop vigor (NDVI)</th><td>'+vv.toFixed(2)+' &mdash; '+vWord+'</td></tr>':'')+
        nrmCell+
        (vx.ndmi!=null?'<tr><th>Canopy moisture (NDMI)</th><td>'+vx.ndmi.toFixed(2)+'</td></tr>':'')+
        (vx.ndre!=null?'<tr><th>Nitrogen / chlorophyll (NDRE)</th><td>'+vx.ndre.toFixed(2)+'</td></tr>':'')+
        '<tr><th>Latest clear pass</th><td>'+esc(vx.date)+' &middot; '+d.indices.series.length+' this season</td></tr>'+
        '</table>'+reportSpark(d.indices.series)+'<p class="r-note">Sentinel-2 / Copernicus, cloud-masked, averaged over the field.</p>';
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

    // \u2500\u2500 county & state economics (renders only what actually loaded) \u2500\u2500
    var bandCells='';
    function cell(k,v,n){ bandCells+='<div class="r-st"><div class="r-stk">'+esc(k)+'</div><div class="r-stv">'+v+'</div>'+(n?'<div class="r-stn">'+esc(n)+'</div>':'')+'</div>'; }
    if(cy&&cy.rent) cell('County rent \u2019'+String(cy.rent.year).slice(2), '$'+Math.round(cy.rent.val)+'<span class="r-stu">/ac</span>', cy.rent.avg?('10-yr avg $'+cy.rent.avg):null);
    if(cy&&cy.rent&&cy.rent.trend) cell('Corn trend yield', cy.rent.trend+'<span class="r-stu"> bu</span>', cy.rent.lastYield?('made '+cy.rent.lastYield+' last year'):null);
    if(cy&&cy.basis) cell(esc(cy.basis.crop)+' basis vs normal', '<span class="'+(cy.basis.dev<0?'r-red':'r-green')+'">'+(cy.basis.dev<0?'\u2212$':'+$')+Math.abs(cy.basis.dev).toFixed(2)+'</span>', (cy.basis.latest<0?'\u2212$':'$')+Math.abs(cy.basis.latest).toFixed(2)+' vs '+(cy.basis.avg5>=0?'+$':'\u2212$')+Math.abs(cy.basis.avg5).toFixed(2)+' avg');
    if(cy&&cy.tenure) cell('Rented ground here', cy.tenure.pct+'%', 'of county farmland');
    var bandHtml = bandCells ? '<div class="r-band">'+bandCells+'</div>' : '';

    var moneyRows='';
    if(cy&&cy.rent){
      moneyRows+=kv('County rent, non-irr \u2019'+String(cy.rent.year).slice(2), '$'+Math.round(cy.rent.val)+'/ac');
      if(cy.rent.trend&&b&&b.corn){
        var gross=Math.round(cy.rent.trend*b.corn.cash);
        moneyRows+=kv('Gross @ trend \u00d7 $'+b.corn.cash.toFixed(2), '$'+gross.toLocaleString('en-US')+'/ac');
        moneyRows+=kv('Rent share of gross', Math.round(cy.rent.val/gross*100)+'%');
      }
    }
    if(cy&&cy.basis) moneyRows+=kv('State '+esc(cy.basis.crop)+' basis', (cy.basis.latest<0?'\u2212$':'$')+Math.abs(cy.basis.latest).toFixed(2)+' ('+(cy.basis.dev<0?Math.round(Math.abs(cy.basis.dev)*100)+'\u00a2 under':'\u00b1 on')+' its 5-yr normal)');
    if(cy&&cy.storage) moneyRows+=kv('State bins', Math.round(cy.storage.ratio*100)+'% of capacity filled by the \u2019'+String(cy.storage.year).slice(2)+' crop'+(cy.storage.since&&cy.storage.ratio>=0.85?' \u2014 tightest since '+cy.storage.since:''));

    var ownRows='';
    if(cy&&cy.tenure) ownRows+=kv('County ground rented', cy.tenure.pct+'% \u2014 '+Math.round(cy.tenure.rented).toLocaleString('en-US')+' of '+Math.round(cy.tenure.total).toLocaleString('en-US')+' ac ('+cy.tenure.year+' census)');
    if(cy&&cy.afida) ownRows+=kv('Foreign-held in county', Math.round(cy.afida.acres).toLocaleString('en-US')+' ac'+(cy.afida.share!=null?' ('+cy.afida.share+'% of farmland)':'')+' \u00b7 '+cy.afida.year);

    var stateRows='';
    if(cy&&cy.cond){
      stateRows+=kv('Crop condition ('+esc(cy.st||'state')+' '+esc(cy.cond.crop)+')', Math.round(cy.cond.ge)+'% G+E \u2014 '+cy.cond.pctile+'th pctile since 2000');
      if(cy.cond.r2!=null) stateRows+=kv('What this week\u2019s ratings are worth', '~'+Math.round(cy.cond.r2*100)+'% of final yield, historically');
    }

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
      +'.r-band{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:0 0 6px}'
      +'@media(max-width:640px){.r-band{grid-template-columns:repeat(2,1fr)}}'
      +'.r-st{border:1px solid #e5e0cf;border-radius:8px;padding:8px 10px}'
      +'.r-stk{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#9a8a4a;font-weight:800}'
      +'.r-stv{font-family:ui-monospace,Menlo,monospace;font-size:19px;font-weight:800;margin-top:2px}'
      +'.r-stu{font-size:11px;font-weight:600;color:#777}'
      +'.r-stn{font-size:10px;color:#888}'
      +'.r-red{color:#b3402f}.r-green{color:#2e7d4f}'
      +'.r-foot{margin-top:24px;border-top:2px solid #c9a227;padding-top:10px;font-size:11px;color:#888;line-height:1.5;font-family:ui-monospace,Menlo,monospace}'
      +'.r-actions{margin-bottom:16px}.r-actions button{background:#c9a227;color:#1a1206;border:none;border-radius:7px;font-weight:700;padding:9px 16px;font-size:14px;cursor:pointer}'
      +'@media print{.no-print{display:none}body{padding:0}}';

    var html='<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      +'<title>Field Report \u2014 '+d.acres.toFixed(0)+' acres \u2014 AGSIST</title><style>'+css+'</style></head><body>'
      +'<div class="r-actions no-print"><button type="button" onclick="window.print()">\u2399 Print / Save as PDF</button></div>'
      +'<div class="r-head"><div class="r-brand">AGSIST \u00b7 Field Scout</div><div class="r-date">'+esc(dateStr)+'</div></div>'
      +'<h1>'+d.acres.toFixed(1)+'-acre field'+(cy&&cy.name?' — '+esc(cy.name)+' County, '+esc(cy.st):'')+'</h1><div class="r-loc">Center '+d.lat.toFixed(4)+', '+d.lng.toFixed(4)+'</div>'
      +verdictHtml+bandHtml+lead+flagsHtml
      +sect('Soil & productivity', soilHtml)
      +sect('Crop vigor & moisture (satellite)', vigorHtml)
      +sect(((r&&r.codes)?r.codes.length:10)+'-year crop rotation', rotHtml)
      +sect('The money', moneyRows?'<table class="r-kv">'+moneyRows+'</table>':'')
      +sect('Ownership picture', ownRows?'<table class="r-kv">'+ownRows+'</table>':'')
      +sect('Statewide crop & bins', stateRows?'<table class="r-kv">'+stateRows+'</table>':'')
      +sect('Conditions', condRows?'<table class="r-kv">'+condRows+'</table>':'')
      +sect('Nearby cash bids', bidRows?'<table class="r-kv">'+bidRows+'</table>':'')
      +'<div class="r-foot"><strong>Prepared by Sigurd Lindquist \u00b7 AGSIST Field Scout \u00b7 agsist.com/field-scout \u00b7 sig@farmers1st.com</strong><br>Compiled from public data: USDA SSURGO soil survey, Cropland Data Layer, NASS county cash-rent survey &amp; weekly crop conditions, Census of Agriculture, AFIDA foreign-holdings filings, AgTransport basis, Open-Meteo, US Drought Monitor, Iowa Environmental Mesonet hail reports, and the AGSIST cash-bid feed. Survey estimates &mdash; not a substitute for sampling your own ground. A starting read, not an underwriting decision or financial advice. Missing data prints as missing; nothing here is interpolated.</div>'
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

// Mobile Layers toggle — deliberately OUTSIDE map init so the control panel
// still opens even if the map library fails to load on a weak connection.
(function(){
  function wire(){
    var ml=document.getElementById('fs-mob-layers');
    if(!ml) return;
    ml.addEventListener('click', function(){
      var r=document.getElementById('fs-cmd-right');
      if(r){ var open=r.classList.toggle('open'); ml.setAttribute('aria-expanded', open?'true':'false'); }
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
