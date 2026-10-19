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
  var godActive = '';           // '', 'ndvi', 'ndre', 'moisture'
  var GOD_LABEL = { ndvi: 'crop vigor', ndre: 'nitrogen status', moisture: 'soil moisture' };
  var GOD_ATTR  = { ndvi: 'NDVI: Sentinel-2 / Copernicus', ndre: 'NDRE: Sentinel-2 / Copernicus', moisture: 'Moisture: Sentinel-1 / Copernicus' };
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
    // the weather card reads these; a second field must never show the first field's weather
    window.__fsWx=null; window.__fsDr=null;
    clearTimeout(_settleTimer);   // the last field's snapshot retries must not run against this one
    FIELD = { acres:acres, lat:c.lat, lng:c.lng, t0:Date.now(),
      soil:null, rotation:null, weather:null, drought:null, bids:null, hail:null, county:null };
  }

  // ── Boot ────────────────────────────────────────────────────────────
  function init() {
    if (typeof L === 'undefined') { showFatal('Map library failed to load. Check your connection and refresh.'); return; }

    map = L.map('fs-map', { zoomControl:true, attributionControl:true }).setView([41.878, -93.0977], 6); // Iowa-ish center
    map.on('dragstart', function(){ if(FIELD) FIELD._dragged=true; });   // the user moved it: stop auto-fitting
    try{ map.zoomControl.setPosition('bottomleft'); }catch(e){}
    // On phones the action dock sits over the bottom-left zoom buttons; lift them clear of it.
    function liftZoom(){
      try{
        var corner=map.getContainer().querySelector('.leaflet-bottom.leaflet-left');
        var dock=document.querySelector('.fs-dock');
        if(!corner||!dock) return;
        if(window.innerWidth>820){ corner.style.bottom=''; return; }
        var gap=map.getContainer().getBoundingClientRect().bottom-dock.getBoundingClientRect().top;
        corner.style.bottom=(gap>0?Math.ceil(gap)+6:0)+'px';
      }catch(e){}
    }
    liftZoom();
    window.addEventListener('resize', liftZoom);
    try{ if(window.ResizeObserver){ var dk=document.querySelector('.fs-dock'); if(dk) new ResizeObserver(liftZoom).observe(dk); } }catch(e){}
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

    // The tracing tool (Leaflet.draw, vendored on agsist.com) loads on the first "Trace exact"
    // tap, not with the page: most fields start from a tap, and a slow or blocked load can
    // only ever cost the trace, never the map, the pin or the search (ensureDraw below).
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
    wireInviteActs();
    // On a phone the map gets shorter once a field is up, so the bottom line shows under it
    // without a scroll (components/field-scout.css, .fs-has-field). Keep Leaflet in step.
    try{
      var stg=document.querySelector('.fs-stage');
      if(stg && window.ResizeObserver){
        var _lastH=stg.offsetHeight, _refitT=null;
        new ResizeObserver(function(){
          var h=stg.offsetHeight; if(h===_lastH) return; _lastH=h;
          try{ map.invalidateSize(); }catch(e){}
          // Refit after the commit's own zoom animation ends (its last frame would undo an earlier fit).
          // On a phone the search bar sits on top and the dock at the bottom: keep the field between them.
          clearTimeout(_refitT);
          _refitT=setTimeout(function(){
            try{
              var ph=window.innerWidth<=720;
              if(activePoly && !(FIELD&&FIELD._dragged)) map.fitBounds(activePoly.getBounds(), { paddingTopLeft:[30, ph?76:30], paddingBottomRight:[30, ph?118:30], maxZoom:16, animate:false });
            }catch(e){}
          }, 420);
        }).observe(stg);
      }
    }catch(e){}
    if(!restoreFromLink() && !fromAtlasLink()) tryAutoLocate();
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
      attribution: GOD_ATTR[which] || '' }).addTo(map);
    // These layers only render at field scale (zoom 9+): a national-view request
    // would fire dozens of Sentinel tiles at once and hit the processing rate limit.
    if(map.getZoom() < 9){ flashHint('Zoom in to your field to see '+(GOD_LABEL[which] || 'this layer')); }
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
    if(which!=='ndvi' && which!=='ndre'){ var pw=document.getElementById('fs-passes'); if(pw){ pw.hidden=true; pw.innerHTML=''; } }
  }
  function syncSheet(){
    if(godActive){ openSheetFor(godActive); return; }
    if(hailLayer){ openSheetFor('hail'); return; }
    var sheet=document.getElementById('fs-layersheet'); if(sheet) sheet.hidden=true;
  }

  // Plain-language key for the color overlays — answers "what am I looking at?"
  function setLegend(which){
    var el=document.getElementById('fs-legend'); if(!el) return;
    if(which==='ndvi'){
      el.hidden=false;
      el.innerHTML='<div class="fs-leg-top"><span class="fs-leg-ttl">Crop vigor</span><span class="fs-leg-tag">how much living canopy</span></div>'+
        '<div class="fs-leg-bar" style="background:linear-gradient(90deg,#8c6638,#b79a3c,#6aa83a,#1f7a2e)"></div>'+
        '<div class="fs-leg-ends"><span>Bare / stressed</span><span>Healthy / lush</span></div>'+
        '<div class="fs-leg-say">Greener means more living crop. Brown and tan are bare soil, residue, or a struggling stand. Those are the spots worth walking.</div>';
    } else if(which==='ndre'){
      el.hidden=false;
      el.innerHTML='<div class="fs-leg-top"><span class="fs-leg-ttl">Nitrogen (NDRE)</span><span class="fs-leg-tag">red-edge, most useful after canopy closes</span></div>'+
        '<div class="fs-leg-bar" style="background:linear-gradient(90deg,#e0685f,#d4a23f,#5fc28a)"></div>'+
        '<div class="fs-leg-ends"><span>Low</span><span>Strong</span></div>'+
        '<div class="fs-leg-say">Once the canopy closes, NDVI flattens out and stops showing variation; NDRE keeps reading chlorophyll and nitrogen status underneath it. Red/gold patches are where nitrogen is most likely limiting, worth a soil or tissue test before you trust it.</div>';
    } else if(which==='moisture'){
      el.hidden=false;
      el.innerHTML='<div class="fs-leg-top"><span class="fs-leg-ttl">Soil moisture</span><span class="fs-leg-tag">radar surface wetness</span></div>'+
        '<div class="fs-leg-bar" style="background:linear-gradient(90deg,#c7ae73,#8fb59a,#2a7fd6)"></div>'+
        '<div class="fs-leg-ends"><span>Drier</span><span>Wetter</span></div>'+
        '<div class="fs-leg-say">Bluer is a wetter surface, tan is drier. It\u2019s a relative read from radar: good for finding wet holes and dry knobs, not an exact percent.</div>';
    } else if(which==='hail'){
      el.hidden=false;
      el.innerHTML='<div class="fs-leg-top"><span class="fs-leg-ttl">Hail history</span><span class="fs-leg-tag">reported storms, last 5 years</span></div>'+
        '<div class="fs-leg-say">Each blue dot is a severe-hail storm report near this field over the last five years. Tap a dot for the reported stone size and date. No dots means no reports in the archive for this spot.</div>';
    } else { el.hidden=true; el.innerHTML=''; }
  }

  // Leaflet.draw on demand, from agsist.com's own copy (vendor/leaflet-draw-1.0.4).
  var DRAW_JS='/vendor/leaflet-draw-1.0.4/leaflet.draw.js', DRAW_CSS='/vendor/leaflet-draw-1.0.4/leaflet.draw.css';
  var _drawWait=null;
  function drawReady(){ return typeof L!=='undefined' && L.Draw && L.Draw.Polygon; }
  function ensureDraw(cb){
    if(drawControl) return cb(true);
    if(!_drawWait){
      _drawWait=[];
      var finish=function(){
        var ok=!!drawReady();
        if(ok && !drawControl){
          drawControl = new L.Draw.Polygon(map, {
            allowIntersection:false,
            shapeOptions:{ color:'#daa520', weight:3, fillColor:'#daa520', fillOpacity:0.15 }
          });
          map.on(L.Draw.Event.CREATED, function (e) { commitField(e.layer, 'draw'); });
        }
        var w=_drawWait; _drawWait=null; w.forEach(function(f){ f(ok); });
      };
      if(drawReady()){ _drawWait.push(cb); return finish(); }
      try{
        var ln=document.createElement('link'); ln.rel='stylesheet'; ln.href=DRAW_CSS; document.head.appendChild(ln);
        var sc=document.createElement('script'); sc.src=DRAW_JS; sc.async=true;
        sc.onload=finish; sc.onerror=finish;
        document.head.appendChild(sc);
      }catch(e){ _drawWait.push(cb); return finish(); }
    }
    _drawWait.push(cb);
  }
  window.__fsEnsureDraw = ensureDraw;

  function wireControls() {
    var pinBtn=document.getElementById('fs-pin'); if(pinBtn) pinBtn.addEventListener('click', armPinDrop);
    document.getElementById('fs-draw').addEventListener('click', function(){
      // Tracing at county scale draws a "field" the size of a county — make them zoom first.
      if(map && map.getZoom() < 11){ flashHint('Zoom in to your field first, then trace it'); return; }
      ensureDraw(function(ok){
        if(!ok){ flashHint('The tracing tool didn\u2019t load. Tap your field instead and drag the corners to fit.', 7000); return; }
        drawControl.enable();
      });
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
    fieldGen++;                    // requests still in flight must not write into the hidden results
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
    var _pk=document.getElementById('fs-peek'); if(_pk){ _pk.hidden=true; _pk.innerHTML=''; }
    document.documentElement.classList.remove('fs-has-peek');
    _peek={};
    document.getElementById('fs-empty').hidden=false;
    setFieldChrome(false);
    var h=document.getElementById('fs-hint'); if(h) h.innerHTML='<b>&#9998; Draw</b>&nbsp;your field&rarr;';
  }

  // ── SAVED FIELDS (localStorage — on this device only, never our servers) ──
  var SAVE_KEY = 'agsist-fs-fields';
  // Photos: canvas-resized to 800px wide and re-encoded JPEG q0.6 before they ever
  // touch localStorage (see compressPhoto). That typically lands 80-150KB each, but
  // localStorage quotas vary by browser (commonly 5-10MB total, shared with every
  // other site on the origin), so PHOTO_CAP is a soft guard, not the real limit —
  // the real limit is whatever write() actually accepts. tryPersistFields() below
  // catches the quota error live and backs the photo out rather than lying about
  // how much room is left.
  var PHOTO_CAP = 6;
  function loadSavedFields(){
    try {
      var arr = JSON.parse(localStorage.getItem(SAVE_KEY) || '[]');
      if(!Array.isArray(arr)) return [];
      // upgrade old-schema rows in place: fields saved before notes/photos existed
      // just get the defaults, no data lost, no throw on a malformed photo entry.
      return arr.map(function(f){
        return {
          id:f.id, name:f.name, pts:f.pts, acres:f.acres,
          notes: typeof f.notes==='string' ? f.notes : '',
          photos: Array.isArray(f.photos) ? f.photos.filter(function(p){ return p && typeof p.dataUrl==='string'; }) : []
        };
      });
    } catch(e){ return []; }
  }
  function persistSavedFields(arr){
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(arr.slice(0,30))); return true; } catch(e){ return false; }
  }
  function saveCurrentField(){
    if(!activePoly) return;
    var name = prompt('Name this field (e.g. "Home 80", "North quarter"):', 'Field ' + (loadSavedFields().length+1));
    if(name===null) return;
    var pts = latlngs(activePoly).map(function(p){ return [+p.lat.toFixed(6), +p.lng.toFixed(6)]; });
    var arr = loadSavedFields();
    arr.unshift({ id:Date.now(), name:(name||'Untitled').slice(0,40), pts:pts, acres:+polyAcres(activePoly).toFixed(1), notes:'', photos:[] });
    persistSavedFields(arr);
    _activeFieldId = arr[0].id;        // start tracking this field for changed-since
    saveSnap(_activeFieldId, fieldSnapshot());  // baseline = current conditions
    renderSavedFields();
    renderNotesSectionInPlace();       // the "save this field first" hint becomes the real editor
    ga('field_saved', {});
  }

  // ── SCOUTING NOTES + PHOTOS (attached to a saved field, same localStorage row) ──
  var _notesSaveTimer=null;
  function currentSavedField(){
    if(_activeFieldId==null) return null;
    return loadSavedFields().filter(function(x){ return x.id===_activeFieldId; })[0] || null;
  }
  function notesSectionHTML(){
    var f = currentSavedField();
    if(!f){
      return '<div class="fs-section" id="fs-notes-wrap">'+
        '<div class="fs-section-h" role="heading" aria-level="3"><span class="ico" aria-hidden="true">'+ICONS.notes+'</span>Scouting Notes</div>'+
        '<div class="fs-section-body">'+
          '<p class="fs-notes-hint">Save this field to attach notes and photos. They live on this device, right alongside the field.</p>'+
          '<button type="button" class="fs-save-btn" id="fs-notes-save-prompt">Save field</button>'+
        '</div>'+
      '</div>';
    }
    var photos = f.photos || [];
    var atCap = photos.length >= PHOTO_CAP;
    return '<div class="fs-section" id="fs-notes-wrap">'+
      '<div class="fs-section-h" role="heading" aria-level="3"><span class="ico" aria-hidden="true">'+ICONS.notes+'</span>Scouting Notes</div>'+
      '<div class="fs-section-body">'+
        '<textarea id="fs-notes-text" class="fs-notes-area" maxlength="4000" placeholder="Emergence, stand count, weed pressure, whatever you want on file for this field&hellip;">'+esc(f.notes||'')+'</textarea>'+
        (photos.length ? '<div class="fs-notes-photos" id="fs-notes-photos">'+photos.map(photoThumbHTML).join('')+'</div>' : '')+
        '<div class="fs-notes-row">'+
          '<label class="fs-save-btn fs-notes-add" for="fs-notes-photo-input">Add photo</label>'+
          '<input type="file" accept="image/*" id="fs-notes-photo-input" style="display:none"'+(atCap?' disabled':'')+'>'+
          '<span class="fs-notes-meta">'+photos.length+' of '+PHOTO_CAP+' photos</span>'+
        '</div>'+
        (atCap ? '<p class="fs-notes-cap">Photo cap reached ('+PHOTO_CAP+' per field); delete one below to add another.</p>' : '')+
        '<p class="fs-notes-note">Notes and photos save on this device only, with the field, not sent anywhere. Photos are resized and compressed to fit.</p>'+
      '</div>'+
    '</div>';
  }
  function photoThumbHTML(p){
    return '<span class="fs-notes-thumb"><img src="'+p.dataUrl+'" alt="Field photo" loading="lazy">'+
      '<button type="button" class="fs-notes-thumb-del" data-photo="'+esc(p.id)+'" aria-label="Remove photo">&times;</button></span>';
  }
  function wireNotesSection(){
    var sp=document.getElementById('fs-notes-save-prompt'); if(sp) sp.addEventListener('click', saveCurrentField);
    var ta=document.getElementById('fs-notes-text');
    if(ta){
      ta.addEventListener('input', function(){ clearTimeout(_notesSaveTimer); _notesSaveTimer=setTimeout(saveNotesText, 600); });
      ta.addEventListener('blur', saveNotesText);
    }
    var fi=document.getElementById('fs-notes-photo-input');
    if(fi) fi.addEventListener('change', function(){ var file=fi.files&&fi.files[0]; fi.value=''; if(file) handlePhotoFile(file); });
    document.querySelectorAll('.fs-notes-thumb-del').forEach(function(b){
      b.addEventListener('click', function(){ deletePhoto(b.getAttribute('data-photo')); });
    });
  }
  function renderNotesSectionInPlace(){
    var el=document.getElementById('fs-notes-wrap');
    if(!el) return;
    el.outerHTML = notesSectionHTML();
    wireNotesSection();
  }
  function saveNotesText(){
    var f=currentSavedField(); var ta=document.getElementById('fs-notes-text');
    if(!f || !ta) return;
    var arr=loadSavedFields();
    var row=arr.filter(function(x){ return x.id===_activeFieldId; })[0]; if(!row) return;
    row.notes = ta.value.slice(0,4000);
    persistSavedFields(arr);
  }
  function deleteSavedField(id){
    var f=loadSavedFields().filter(function(x){ return x.id===id; })[0];
    if(!window.confirm('Delete "'+((f&&f.name)||'this field')+'"? This can\u2019t be undone.')) return;
    persistSavedFields(loadSavedFields().filter(function(x){ return x.id!==id; }));
    try{ localStorage.removeItem('agsist-fs-snap-'+id); }catch(e){}
    if(_activeFieldId===id){ _activeFieldId=null; renderNotesSectionInPlace(); }
    renderSavedFields();
  }
  function openSavedField(id){
    var f = loadSavedFields().filter(function(x){ return x.id===id; })[0];
    if(!f) return;
    removeChangeBanner();
    // a dropped box's handles and size picker must not survive onto a saved field
    // (clicking "160" used to square off the saved field and snapshot it under its id)
    clearHandles(); boxMode=false; setSizer(false); showTracebar(false); disarmPin();
    _activeFieldId = id;           // saved field → eligible for changed-since
    _priorSnap = loadSnap(id);     // last visit's conditions, if any
    drawnLayer.clearLayers();
    activePoly = L.polygon(f.pts.map(function(p){ return L.latLng(p[0],p[1]); }), { color:'#daa520', weight:3, fillColor:'#daa520', fillOpacity:.15 });
    drawnLayer.addLayer(activePoly);
    map.fitBounds(activePoly.getBounds(), { padding:[40,40] });
    document.getElementById('fs-clear').disabled = false;
    var dk=document.querySelector('.fs-dock'); if(dk) dk.classList.add('has-field');
    dismissInvite();
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
        var hasNotes = !!((f.notes&&f.notes.trim()) || (f.photos&&f.photos.length));
        return '<span class="fs-saved-chip" role="group">'+
          '<button class="fs-saved-open" data-id="'+f.id+'" type="button" title="Open '+esc(f.name)+(hasNotes?', has notes':'')+'">'+esc(f.name)+' <small>'+f.acres+'ac</small>'+(hasNotes?' <small class="fs-saved-note-ind" aria-hidden="true">&#9998;</small>':'')+'</button>'+
          '<button class="fs-saved-del" data-del="'+f.id+'" type="button" aria-label="Delete '+esc(f.name)+'">&times;</button>'+
        '</span>';
      }).join('') + '</div>';
    wrap.querySelectorAll('.fs-saved-open').forEach(function(b){ b.addEventListener('click', function(){ openSavedField(+b.getAttribute('data-id')); }); });
    wrap.querySelectorAll('.fs-saved-del').forEach(function(b){ b.addEventListener('click', function(){ deleteSavedField(+b.getAttribute('data-del')); }); });
  }

  // ── Geo helpers ─────────────────────────────────────────────────────
  // /field-scout?at=lat,lng&fips=19169 — opened from a Farmland Atlas county: start on that county
  function fromAtlasLink(){
    var m=/[?&]at=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(location.search||''); if(!m) return false;
    var lat=+m[1], lng=+m[2]; if(!isFinite(lat)||!isFinite(lng)||Math.abs(lat)>72||lng>-60||lng<-180) return false;
    map.setView([lat,lng], 11);
    flashHint('Zoom in to your field in this county, then tap or draw it', 7000);
    ga('field_from_atlas', {});
    // Coming from the Atlas: show the county's record in the empty panel right away, so the
    // page isn't blank while the user finds the field.
    var fm=/[?&]fips=(\d{5})\b/.exec(location.search||'');
    if(fm) atlasCounty(fm[1]).then(function(d){
      var box=document.getElementById('fs-empty'); if(!d||!box||box.hidden) return;
      var rows=atlasRows(d).slice(0,4); if(!rows.length) return;
      var div=document.createElement('div'); div.className='fs-atlas-pre';
      div.innerHTML='<div class="fs-atlas-pre-h">'+esc(d.name||'')+' County, '+esc(d.state||'')+' &middot; from the Farmland Atlas</div>'+
        rows.map(function(r){ return '<div class="fs-atlas-pre-r"><span>'+esc(r[0])+'</span><b>'+esc(r[1])+'</b></div>'; }).join('')+
        '<div class="fs-atlas-pre-f">Tap or trace your field. The read puts this field next to these county numbers.</div>';
      box.appendChild(div);
    });
    return true;
  }
  // The first screen offers a finished read in one tap: the example field, or, on a device
  // that has saved fields, the last one saved (kept in this browser only).
  function wireInviteActs(){
    var ex=document.getElementById('fs-demo2'); if(ex) ex.addEventListener('click', loadDemoField);
    var last=document.getElementById('fs-last'); if(!last) return;
    var f=loadSavedFields()[0];
    if(!f || !f.pts || f.pts.length<3){ last.hidden=true; return; }
    last.textContent='Open '+String(f.name||'your field').slice(0,28)+' again';
    last.hidden=false;
    last.addEventListener('click', function(){ openSavedField(f.id); ga('field_reopen_invite', {}); });
  }
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
    }, function(err){ btn.innerHTML='&#9678; My location'; flashHint(err&&err.code===1?'Location is blocked for this site: allow it in browser settings, or search your address below':'Couldn\u2019t get a GPS fix: try again outside or search your address'); }, {enableHighAccuracy:true,timeout:8000});
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
          flashHint('No match. Try a town + state, or pan the map and trace your field.');
        }
      }).catch(function(){ btn.textContent='Go'; flashHint('Address lookup is busy; pan the map and trace your field.'); });
  }

  // After we land on a spot (search or GPS), the tap-to-field path is live — just
  // say so. Keep a keyboard-accessible "analyze a field box here" affordance so a
  // pointing device is never required.
  function afterLocate(lat, lng){
    flashHint('Tap your field on the map, or', 15000);
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
      // The headline sat on top of the field it describes. Once per field (and never after the
      // user has dragged the map), refit so the field sits below the headline.
      try{
        if(activePoly && FIELD && !FIELD._mhDone && !FIELD._dragged && FIELD.t0 && Date.now()-FIELD.t0<25000 && mapHeadlineEl.offsetHeight>0 && map.getSize().y>0){
          var bb=activePoly.getBounds(), hb=mapHeadlineEl.offsetTop+mapHeadlineEl.offsetHeight+14;
          var ny=map.latLngToContainerPoint(bb.getNorthWest()).y;
          if(ny<hb) map.fitBounds(bb, { paddingTopLeft:[30,hb], paddingBottomRight:[30,70], maxZoom:map.getZoom(), animate:false });
          FIELD._mhDone=true;
        }
      }catch(e){}
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
    // null = the drought layer hadn't answered. Unknown is not "None"; don't claim a move.
    var was=prev.drought, now=cur.drought;
    if(was!=null && now!=null && was!==now){
      var dN=function(x){var m=/D(\d)/.exec(x||'');return m?+m[1]:(x&&x!=='None'?0:-1);};
      var worse = dN(now)>dN(was);
      out.push((worse?'&#9650; ':'&#9660; ')+'Drought status moved from <strong>'+esc(was)+'</strong> to <strong>'+esc(now)+'</strong>.');
    }
    if(prev.pDep!=null && cur.pDep!=null){
      var dd=+(cur.pDep-prev.pDep).toFixed(1);
      if(Math.abs(dd)>=0.3){
        if(dd<0) out.push('&#9650; The field got drier: rain ran <strong>'+Math.abs(dd)+'&Prime; further below the 5-yr average</strong> since your last look.');
        else out.push('&#9660; The field caught rain: running <strong>'+dd+'&Prime; wetter</strong> than at your last look.');
      }
    }
    if(prev.ndvi!=null && cur.ndvi!=null){
      var dv=+(cur.ndvi-prev.ndvi).toFixed(2);
      var newPass = cur.passDate && prev.passDate && cur.passDate!==prev.passDate;
      if(Math.abs(dv)>=0.04){
        out.push((dv>0?'&#9650; Vigor is <strong>up '+dv.toFixed(2):'&#9660; Vigor is <strong>down '+Math.abs(dv).toFixed(2))+'</strong> since your last look (NDVI '+prev.ndvi.toFixed(2)+' &rarr; '+cur.ndvi.toFixed(2)+')'+(newPass?' on a new clear pass':'')+'.');
      } else if(newPass){
        out.push('&bull; A new clear satellite pass came in ('+esc(cur.passDate)+'): vigor is holding right where you left it (NDVI '+cur.ndvi.toFixed(2)+').');
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
  var _settleTries=0;
  function scheduleSettle(){ clearTimeout(_settleTimer); _settleTries=0; _settleTimer=setTimeout(onReadSettled, 1500); }
  function onReadSettled(){
    if(_activeFieldId==null) return;          // only saved fields have a stable identity
    // Wait for the layers the snapshot compares, or 20 s, whichever comes first. A snapshot
    // taken early stores nulls, and the next visit would compare against half a field.
    var ready=FIELD && FIELD.drought!=null && FIELD.season!==undefined && FIELD.indices!==undefined;
    if(!ready && _settleTries++<12){ _settleTimer=setTimeout(onReadSettled, 1500); return; }
    var cur=fieldSnapshot(); if(!cur) return;
    if(_priorSnap){ ['drought','pDep','gDep','ndvi'].forEach(function(k){ if(cur[k]==null && _priorSnap[k]!=null) cur[k]=_priorSnap[k]; }); }
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
    // meters to degrees with the ellipsoid's own radii at this latitude, so a 40 reads 40.00 ac
    var sp=Math.sin(lat*Math.PI/180), w=1-0.0066943799901413165*sp*sp;
    var M=6378137*(1-0.0066943799901413165)/Math.pow(w,1.5), N=6378137/Math.sqrt(w);
    var dLat=(d[1]/2)/M*180/Math.PI;
    var dLng=(d[0]/2)/(N*Math.max(0.2,Math.cos(lat*Math.PI/180)))*180/Math.PI;
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
    function done(){ flashHint('Field link copied: anyone who opens it sees this exact field', 6000); ga('field_share', {}); }
    // Phones: the system share sheet (text, email, WhatsApp) beats a copied link.
    var coarse = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
    if(coarse && navigator.share){
      var t=(FIELD&&FIELD.acres?(+FIELD.acres).toFixed(0)+'-acre field':'Field')+(FIELD&&FIELD.county&&FIELD.county.name?', '+FIELD.county.name+' County':'');
      navigator.share({ title:t+' | AGSIST Field Scout', url:url }).then(function(){ ga('field_share', {via:'sheet'}); }, function(){});
      return;
    }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(done, function(){ window.prompt('Copy this field link:', url); });
    } else { window.prompt('Copy this field link:', url); }
  }

  // ── Boundary export: GeoJSON / KML, straight from the drawn polygon's own
  // coordinates. Client-side only — a Blob, an object URL, and a click. ──
  function currentFieldName(){
    var f=currentSavedField();
    return (f && f.name) || 'Field';
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
    // No jump on a phone: the map shortens once the field is up and the bottom line sits right under it.
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
      flashHint('That traced out to '+Math.round(_capAc).toLocaleString('en-US')+' acres; Field Scout reads one field at a time (under 2,500 ac). Zoom in and try again.');
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
  function polyAcres(poly){ return acresOfRing(latlngs(poly)); }
  // FS-ACRES-BEGIN (test/field-scout-to50.test.mjs runs this block on its own)
  // Area on the WGS84 ellipsoid, not a sphere: each latitude goes to its authalic (equal-area)
  // latitude, then the equal-area trapezoid sum runs on the authalic sphere. That is exact for
  // edges along parallels and meridians, and far inside a hundredth of an acre for any field.
  // (The sphere at the equator's radius used before read 0.07% to 0.16% high: 640.46 ac for
  // a one-mile square section at 41.5 N.)
  var WGS_A=6378137, WGS_F=1/298.257223563, WGS_E2=WGS_F*(2-WGS_F), WGS_E=Math.sqrt(WGS_E2);
  function authQ(sinp){ return (1-WGS_E2)*( sinp/(1-WGS_E2*sinp*sinp) - (1/(2*WGS_E))*Math.log((1-WGS_E*sinp)/(1+WGS_E*sinp)) ); }
  var WGS_QP=authQ(1), WGS_RQ=WGS_A*Math.sqrt(WGS_QP/2);
  function acresOfRing(pts){
    if(!pts || pts.length<3) return 0;
    var d2r=Math.PI/180, area=0;
    for(var i=0;i<pts.length;i++){
      var p1=pts[i], p2=pts[(i+1)%pts.length];
      var s1=authQ(Math.sin(p1.lat*d2r))/WGS_QP, s2=authQ(Math.sin(p2.lat*d2r))/WGS_QP;   // sin of the authalic latitude
      area += (p2.lng-p1.lng)*d2r * (s1+s2);
    }
    return Math.abs(area*WGS_RQ*WGS_RQ/2) / 4046.8564224;   // m2 to acres (international acre)
  }
  // FS-ACRES-END
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
    cond:  SVG+'<path d="M12 22V8"/><path d="M12 8C12 5 10 3 6 3c0 3 2 5 6 5Z"/><path d="M12 13c0-3 2-5 6-5 0 3-2 5-6 5Z"/></svg>',
    notes: SVG+'<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/><path d="M9 13h6M9 17h6"/></svg>',
    dl:    SVG+'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>'
  };
  // Phone peek: on a phone the map fills the first screen and the read starts below the
  // fold. The peek puts the bottom line and four numbers right under the map.
  var _peek={};

  // ── utils ───────────────────────────────────────────────────────────
  function postJSON(url, body){
    var opt={ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }, id=null;
    if(typeof AbortController!=='undefined'){ var ctrl=new AbortController(); opt.signal=ctrl.signal; id=setTimeout(function(){ try{ctrl.abort();}catch(e){} }, 45000); }
    return fetch(url, opt)
      .then(function(r){ clearTimeout(id); if(!r.ok) throw new Error(r.status); return r.json(); }, function(e){ clearTimeout(id); throw e; });
  }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function hexA(hex,a){
    var h=hex.replace('#',''); if(h.length===3){h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];}
    var n=parseInt(h,16); return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+a+')';
  }
  function ga(n,p){ try{ if(typeof window.gtag==='function') gtag('event',n,p||{}); }catch(e){} }
  function showFatal(msg){ var p=document.getElementById('fs-empty'); if(p) p.innerHTML='<div class="fs-err">'+msg+'</div>'; }

  // ── On demand (Oct 16, 2026) ───────────────────────────────────────
  // This file is the first screen: the map, the field tools, saved fields.
  // The read itself (soil, rotation, weather and its charts, hail, bids, vigor,
  // county numbers, the bottom line) is field-scout-read.js, fetched on the first
  // touch or key press, or when a field is picked. The print report, boundary
  // export and note photos are field-scout-extras.js, fetched on their buttons.
  // Both reach this file's variables through FSX (getters, so always the live value).
  var FS_READ_SRC='/field-scout-read.js?v=9', FS_EXTRAS_SRC='/field-scout-extras.js?v=1';
  var RM=null, XM=null, _rmP=null, _xmP=null;
  var FSX=Object.defineProperties({}, {
    map:{get:function(){ return map; }, set:function(v){ map=v; }},
    activePoly:{get:function(){ return activePoly; }, set:function(v){ activePoly=v; }},
    godLayer:{get:function(){ return godLayer; }, set:function(v){ godLayer=v; }},
    godActive:{get:function(){ return godActive; }, set:function(v){ godActive=v; }},
    godOpacity:{get:function(){ return godOpacity; }, set:function(v){ godOpacity=v; }},
    godDate:{get:function(){ return godDate; }, set:function(v){ godDate=v; }},
    hailLayer:{get:function(){ return hailLayer; }, set:function(v){ hailLayer=v; }},
    FIELD:{get:function(){ return FIELD; }, set:function(v){ FIELD=v; }},
    fieldGen:{get:function(){ return fieldGen; }, set:function(v){ fieldGen=v; }},
    _peek:{get:function(){ return _peek; }, set:function(v){ _peek=v; }},
    _activeFieldId:{get:function(){ return _activeFieldId; }, set:function(v){ _activeFieldId=v; }},
    BIDS_PROXY:{get:function(){ return BIDS_PROXY; }},
    CDL_CROPS:{get:function(){ return CDL_CROPS; }},
    FS_WORKER:{get:function(){ return FS_WORKER; }},
    ICONS:{get:function(){ return ICONS; }},
    METEO_URL:{get:function(){ return METEO_URL; }},
    N2A:{get:function(){ return N2A; }},
    NOMINATIM_REV:{get:function(){ return NOMINATIM_REV; }},
    PHOTO_CAP:{get:function(){ return PHOTO_CAP; }},
    countUp:{get:function(){ return countUp; }},
    crop:{get:function(){ return crop; }},
    currentFieldName:{get:function(){ return currentFieldName; }},
    currentSavedField:{get:function(){ return currentSavedField; }},
    esc:{get:function(){ return esc; }},
    exportGeoJSON:{get:function(){ return exportGeoJSON; }},
    exportKML:{get:function(){ return exportKML; }},
    flashHint:{get:function(){ return flashHint; }},
    ga:{get:function(){ return ga; }},
    generateReport:{get:function(){ return generateReport; }},
    hexA:{get:function(){ return hexA; }},
    latlngs:{get:function(){ return latlngs; }},
    loadSavedFields:{get:function(){ return loadSavedFields; }},
    notesSectionHTML:{get:function(){ return notesSectionHTML; }},
    openSheetFor:{get:function(){ return openSheetFor; }},
    ordinal:{get:function(){ return ordinal; }},
    persistSavedFields:{get:function(){ return persistSavedFields; }},
    polyAcres:{get:function(){ return polyAcres; }},
    polyCentroid:{get:function(){ return polyCentroid; }},
    postJSON:{get:function(){ return postJSON; }},
    renderNotesSectionInPlace:{get:function(){ return renderNotesSectionInPlace; }},
    renderSavedFields:{get:function(){ return renderSavedFields; }},
    resetField:{get:function(){ return resetField; }},
    runFieldScan:{get:function(){ return runFieldScan; }},
    saveCurrentField:{get:function(){ return saveCurrentField; }},
    scheduleSettle:{get:function(){ return scheduleSettle; }},
    setFieldChrome:{get:function(){ return setFieldChrome; }},
    setMapHeadline:{get:function(){ return setMapHeadline; }},
    shareField:{get:function(){ return shareField; }},
    soilShare:{get:function(){ return soilShare; }},
    syncSheet:{get:function(){ return syncSheet; }},
    vigorWord:{get:function(){ return vigorWord; }},
    wireNotesSection:{get:function(){ return wireNotesSection; }},
    wktPolygon:{get:function(){ return wktPolygon; }},
    writeHash:{get:function(){ return writeHash; }}
  });
  function fsScript(src, name){
    return new Promise(function(ok, no){
      var s=document.createElement('script'); s.src=src;
      s.onload=function(){ if(typeof window[name]==='function') ok(window[name]); else no(new Error(src)); };
      s.onerror=function(){ if(s.parentNode) s.parentNode.removeChild(s); no(new Error(src)); };
      document.head.appendChild(s);
    });
  }
  function loadRead(){
    if(!_rmP) _rmP=fsScript(FS_READ_SRC, '__fsRead').then(function(f){ RM=RM||f(FSX); return RM; }, function(e){ _rmP=null; throw e; });
    return _rmP;
  }
  function loadExtras(){
    if(!_xmP) _xmP=loadRead().then(function(){ return fsScript(FS_EXTRAS_SRC, '__fsExtras'); })
      .then(function(f){ XM=XM||f(FSX); return XM; }, function(e){ _xmP=null; throw e; });
    return _xmP;
  }
  function fsLate(load, name, args){
    return load().then(function(M){ return M[name].apply(null, args); },
      function(){ flashHint('That part of Field Scout did not load. Check the connection and tap again.', 6000); });
  }
  function renderPassTimeline(){ if(RM) return RM.renderPassTimeline(); }   // no read yet, nothing to replay
  function scrubTo(){ if(RM) return RM.scrubTo.apply(null, arguments); return fsLate(loadRead, 'scrubTo', arguments); }
  function toggleHail(){ if(RM) return RM.toggleHail.apply(null, arguments); return fsLate(loadRead, 'toggleHail', arguments); }
  // What's on and around this field (flood, wetlands, slope, energy, feedlots, easements): its own file
  var FS_LAYERS_SRC='/field-scout-layers.js?v=2', _lyP=null, LY=null;
  function loadLayers(poly){
    var g=fieldGen;
    if(!_lyP) _lyP=fsScript(FS_LAYERS_SRC, '__fsLayers').then(function(f){ LY=LY||f(FSX); return LY; }, function(e){ _lyP=null; throw e; });
    _lyP.then(function(M){ if(g===fieldGen) M.run(poly); }, function(){});
  }
  function runAll(poly){
    if(RM){ var out=RM.runAll(poly); loadLayers(poly); return out; }
    var g=fieldGen;
    return loadRead().then(function(M){ if(g===fieldGen){ M.runAll(poly); loadLayers(poly); } },
      function(){ flashHint('The field read did not load. Check the connection and tap the field again.', 7000); });
  }
  function soilShare(){ return RM.soilShare.apply(null, arguments); }        // extras only, after the read
  function vigorWord(){ return RM.vigorWord.apply(null, arguments); }
  function ordinal(){ return RM.ordinal.apply(null, arguments); }
  function atlasCounty(fips){ return loadRead().then(function(M){ return M.atlasCounty(fips); }, function(){ return null; }); }
  function atlasRows(d){ return RM ? RM.atlasRows(d) : []; }
  function handlePhotoFile(){ if(XM) return XM.handlePhotoFile.apply(null, arguments); return fsLate(loadExtras, 'handlePhotoFile', arguments); }
  function deletePhoto(){ if(XM) return XM.deletePhoto.apply(null, arguments); return fsLate(loadExtras, 'deletePhoto', arguments); }
  function exportGeoJSON(){ if(XM) return XM.exportGeoJSON.apply(null, arguments); return fsLate(loadExtras, 'exportGeoJSON', arguments); }
  function exportKML(){ if(XM) return XM.exportKML.apply(null, arguments); return fsLate(loadExtras, 'exportKML', arguments); }
  function generateReport(){ if(XM) return XM.generateReport.apply(null, arguments); return fsLate(loadExtras, 'generateReport', arguments); }
  // warm the read on the first sign of use, so a picked field reads at once
  function fsWarm(){ loadRead().catch(function(){}); }
  ['pointerdown','keydown','touchstart'].forEach(function(t){ document.addEventListener(t, fsWarm, { once:true, passive:true, capture:true }); });

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
