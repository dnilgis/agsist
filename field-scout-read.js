/* AGSIST Field Scout, the read: field-scout-read.js
   Loaded by field-scout.js (loadRead) on the first touch or key press, or when a
   field is picked; never with the first screen. Everything a field read draws:
   soil, rotation, weather and its charts, hail, bids, vigor, county numbers and the
   bottom line. Variables that live in field-scout.js are read through FSX. */
window.__fsRead = function (FSX) {
  'use strict';
  var FS_WORKER=FSX.FS_WORKER, NOMINATIM_REV=FSX.NOMINATIM_REV, N2A=FSX.N2A, CDL_CROPS=FSX.CDL_CROPS, crop=FSX.crop, resetField=FSX.resetField, openSheetFor=FSX.openSheetFor, syncSheet=FSX.syncSheet, flashHint=FSX.flashHint, saveCurrentField=FSX.saveCurrentField, notesSectionHTML=FSX.notesSectionHTML, wireNotesSection=FSX.wireNotesSection, setMapHeadline=FSX.setMapHeadline, setFieldChrome=FSX.setFieldChrome, runFieldScan=FSX.runFieldScan, countUp=FSX.countUp, scheduleSettle=FSX.scheduleSettle, writeHash=FSX.writeHash, shareField=FSX.shareField, exportGeoJSON=FSX.exportGeoJSON, exportKML=FSX.exportKML, latlngs=FSX.latlngs, polyAcres=FSX.polyAcres, polyCentroid=FSX.polyCentroid, wktPolygon=FSX.wktPolygon, ICONS=FSX.ICONS, generateReport=FSX.generateReport, postJSON=FSX.postJSON, esc=FSX.esc, hexA=FSX.hexA, ga=FSX.ga;


  // ── Season replay: one tappable chip per real clear satellite pass ──
  // The /indices series carries the actual pass dates; tapping a date reloads the
  // tile for that pass, so the season plays back like a flipbook. Works for NDVI
  // (its own crop-stage-aware word/color) and NDRE (idxRead's fixed thresholds,
  // the same ones the tile ramp uses) -- every other layer has no matching tile
  // series to replay, so the strip stays hidden there.
  function renderPassTimeline(){
    var wrap=document.getElementById('fs-passes'); if(!wrap) return;
    var s = FSX.FIELD && FSX.FIELD.indices && FSX.FIELD.indices.series;
    var k = FSX.godActive;
    if((k!=='ndvi' && k!=='ndre') || !s || !s.length){ wrap.hidden=true; wrap.innerHTML=''; return; }
    var kLabel = k==='ndvi' ? 'NDVI' : 'NDRE';
    var sel = FSX.godDate || s[s.length-1].date;
    var cur=null; for(var i=0;i<s.length;i++){ if(s[i].date===sel){ cur=s[i]; break; } }
    function word(v){ return k==='ndvi' ? vigorWord(v) : ((idxRead(k,v)||{}).w || ''); }
    function color(v){ return k==='ndvi' ? vigorColor(v) : ((idxRead(k,v)||{}).c || 'var(--dim)'); }
    wrap.hidden=false;
    wrap.innerHTML =
      '<div class="fs-passes-l">Season replay &middot; '+s.length+' clear pass'+(s.length===1?'':'es')+
        (cur && cur[k]!=null ? ' &middot; <b>'+kLabel+' '+(+cur[k]).toFixed(2)+'</b> ('+word(+cur[k])+') on '+passLbl(sel) : '')+'</div>'+
      '<div class="fs-passes-row">'+ s.map(function(p){
        var on = p.date===sel;
        var v = p[k]!=null ? '<span class="fs-pass-v" style="color:'+(on?'#0a1206':color(+p[k]))+'">'+(+p[k]).toFixed(2)+'</span>' : '';
        return '<button type="button" class="fs-pass'+(on?' on':'')+'" data-date="'+esc(p.date)+'"><span class="fs-pass-d">'+passLbl(p.date)+'</span>'+v+'</button>';
      }).join('') + '</div>';
    wrap.querySelectorAll('.fs-pass').forEach(function(b){
      b.addEventListener('click', function(){ selectPass(b.getAttribute('data-date')); });
    });
    var row=wrap.querySelector('.fs-passes-row'); if(row) row.scrollLeft=row.scrollWidth;  // newest in view
  }
  function passLbl(d){ try{ return new Date(d+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric'}); }catch(e){ return d; } }
  function selectPass(date){
    FSX.godDate = date;
    if(FSX.godActive && FSX.godLayer){
      FSX.map.removeLayer(FSX.godLayer);
      FSX.godLayer = L.tileLayer(FS_WORKER+'/'+FSX.godActive+'/{z}/{x}/{y}?date='+FSX.godDate, { opacity:FSX.godOpacity, maxZoom:18, minZoom:9, tileSize:256, crossOrigin:true }).addTo(FSX.map);
    }
    renderPassTimeline();
    ga('pass_scrub', { date: date });
  }

  var _scrubT=null;
  function scrubTo(weeksAgo){
    // 0 = today, up to 26 weeks back through the season
    var d = new Date(Date.now() - weeksAgo*7*864e5);
    FSX.godDate = d.toISOString().slice(0,10);
    var lbl=document.getElementById('fs-scrub-val');
    if(lbl) lbl.textContent = weeksAgo==0 ? 'Latest' : (d.toLocaleDateString(undefined,{month:'short',day:'numeric'}));
    // Dragging fired a full tile reload per step (26 of them). Swap tiles once the thumb rests.
    clearTimeout(_scrubT); _scrubT=setTimeout(swapScrubTiles, 250);
  }
  function swapScrubTiles(){
    if(FSX.godActive && FSX.godLayer){
      FSX.map.removeLayer(FSX.godLayer);
      var url = FS_WORKER + '/' + FSX.godActive + '/{z}/{x}/{y}?date='+FSX.godDate;
      FSX.godLayer = L.tileLayer(url, { opacity:FSX.godOpacity, maxZoom:18, minZoom:9, tileSize:256, crossOrigin:true }).addTo(FSX.map);
    }
  }

  function toggleHail(btn){
    if(FSX.hailLayer){ FSX.map.removeLayer(FSX.hailLayer); FSX.hailLayer=null; btn.classList.remove('on'); btn.setAttribute('aria-pressed','false'); syncSheet(); return; }
    if(!FSX.activePoly && !FSX.map.getCenter()){ return; }
    var c = FSX.activePoly ? polyCentroid(FSX.activePoly) : FSX.map.getCenter();
    btn.classList.add('on'); btn.setAttribute('aria-pressed','true');
    openSheetFor('hail');
    // Draw from the same static event files the field brain reasons on
    // (data/hail/events-YYYY.json) — one source of truth, dates included.
    var yNowH = new Date().getFullYear();
    var yrsH = [yNowH-4, yNowH-3, yNowH-2, yNowH-1, yNowH];
    _hailFilesNear(c, yrsH)
      .then(function(files){
        var got = files.filter(Boolean);
        if(!got.length) throw new Error('no event files');
        FSX.hailLayer = L.layerGroup();
        var n=0;
        got.forEach(function(f){
          (f.ev||[]).forEach(function(e){
            if(_hvsMi(c.lat, c.lng, e[0], e[1]) > 40) return;
            n++;
            L.circleMarker([e[0], e[1]],{radius:5,color:'#7cd2ff',fillColor:'#7cd2ff',fillOpacity:.6,weight:1})
              .bindPopup('Hail '+(e[2]!=null?e[2]+'"':'')+'<br>'+f.year+'-'+e[3]).addTo(FSX.hailLayer);
          });
        });
        FSX.hailLayer.addTo(FSX.map);
        ga('hail_layer', { reports: n });
      }).catch(function(){ btn.classList.remove('on'); btn.setAttribute('aria-pressed','false'); flashHint('Hail history unavailable right now'); syncSheet(); });
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
        '<div class="fs-section-h" role="heading" aria-level="3"><span class="ico" aria-hidden="true">'+ICONS.read+'</span>The Read on This Field</div>'+
        '<div class="fs-section-body" id="fs-insight"></div>'+
      '</div>' +
      notesSectionHTML();
    var D=document.getElementById('fs-deck');
    if(D){
      D.hidden=false;
      D.innerHTML =
        '<div class="fs-deck-label">Field readout <span id="fs-deck-co" class="fs-deck-co"></span></div>'+
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
          section('land',ICONS.rent,'Parcel, Owner &amp; Sales','fs-land') +
          section('atlas',ICONS.risk,'The County’s Long Record','fs-atlas') +
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
    var gjb=document.getElementById('fs-export-geojson'); if(gjb) gjb.addEventListener('click', exportGeoJSON);
    var kmlb=document.getElementById('fs-export-kml'); if(kmlb) kmlb.addEventListener('click', exportKML);
    wireNotesSection();
    loadSoil(poly);
    loadRotation(poly);
    loadWeather(c);
    loadDrought(c);
    loadSeason(c);
    loadIndices(poly);
    loadBids(c);
    loadHailData(c);
    loadCounty(c);
    loadLand(poly);
  }

  // ── Parcel, owner, transfers, sold land, flood and wetlands: field-scout-land.js,
  // fetched only when a field is picked (it is not on the first screen).
  var FS_LAND_SRC='/field-scout-land.js?v=12', _landP=null, LAND=null;
  function loadLand(poly){
    if(LAND) LAND.clear();
    if(!_landP) _landP=new Promise(function(ok, no){
      var s=document.createElement('script'); s.src=FS_LAND_SRC;
      s.onload=function(){ typeof window.__fsLand==='function' ? ok(window.__fsLand(FSX)) : no(new Error('land')); };
      s.onerror=function(){ if(s.parentNode) s.parentNode.removeChild(s); no(new Error('land')); };
      document.head.appendChild(s);
    }).then(function(M){ LAND=M; return M; }, function(e){ _landP=null; throw e; });
    var gen=FSX.fieldGen;
    _landP.then(function(M){ if(gen===FSX.fieldGen) M.run(poly); },
      function(){ setErr('fs-land','The parcel and sales part did not load. Check the connection and tap the field again.'); });
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
        '<button class="fs-save-btn" id="fs-export-geojson" type="button" title="Download this boundary as GeoJSON">'+ICONS.dl+'GeoJSON</button>'+
        '<button class="fs-save-btn" id="fs-export-kml" type="button" title="Download this boundary as KML">'+ICONS.dl+'KML</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }
  function section(id,ico,title,bodyid){
    return '<div class="fs-section"><div class="fs-section-h" role="heading" aria-level="3"><span class="ico" aria-hidden="true">'+ico+'</span>'+title+'</div>'+
      '<div class="fs-section-body" id="'+bodyid+'"><div class="fs-loading"><span class="fs-spin"></span>reading</div></div></div>';
  }
  function setBody(id, html){ var el=document.getElementById(id); if(el) el.innerHTML=html; }
  function setErr(id, msg){ var el=document.getElementById(id); if(el) el.innerHTML='<div class="fs-err">'+msg+'</div>'; }

  // ── 1. SOIL (USDA SSURGO via Soil Data Access) ──────────────────────
  // Spatial query: intersect the drawn polygon with SSURGO map units,
  // aggregate area by soil series, pull the national productivity index.
  function loadSoil(poly, tries){
    var gen = FSX.fieldGen;
    var wkt = wktPolygon(poly);
    postJSON(FS_WORKER + '/soil', { wkt: wkt })
      .then(function(d){
        if(gen !== FSX.fieldGen) return;
        var rows = (d && d.Table) ? d.Table : null;
        if(!rows || !rows.length){ setBody('fs-soil','<div class="fs-err">No SSURGO soil survey published for this spot. Coverage gaps exist in parts of the West and Alaska.</div>'); return; }
        var total=0; rows.forEach(function(r){ total += parseFloat(r[3])||0; });
        // record for the insight engine: dominant class, worst class, prime share
        // columns 10-14 arrive only from the 2026-09-20 worker (d.ext): CSR2, farmland class,
        // flooding frequency, hydric share, capability subclass
        var ext = !!(d && d.ext);
        function nz(v){ return (v==null||v==='')?null:v; }
        var classes = rows.map(function(r){ return { name:r[2]||r[1], ac:parseFloat(r[3])||0, nicc:parseInt(r[4],10)||null, slope:(r[5]==null||r[5]==='')?null:parseFloat(r[5]), nccpi:(r[6]==null||r[6]==='')?null:parseFloat(r[6]), nccpiCorn:(r[7]==null||r[7]==='')?null:parseFloat(r[7]), nccpiSoy:(r[8]==null||r[8]==='')?null:parseFloat(r[8]), drainage:(r[9]==null||r[9]==='')?null:String(r[9]),
          csr2: ext&&nz(r[10])!=null?parseFloat(r[10]):null, farm: ext?nz(r[11]):null, flood: ext?nz(r[12]):null, hydric: ext&&nz(r[13])!=null?parseFloat(r[13]):null, sub: ext?nz(r[14]):null }; });
        var total0=classes.reduce(function(a,x){ return a+x.ac; },0);
        // a class drives a flag only when it covers a real part of the field: a 0.2-ac sliver of class 4
        // used to fire "break the rotation on your class-4 acres" (panel 9/20)
        var worst = classes.reduce(function(m,x){ var big = total0>0 ? (x.ac>=3 || x.ac/total0>=0.10) : true; return (x.nicc&&big&&(!m||x.nicc>m.nicc))?x:m; }, null);
        var primeAc = classes.filter(function(x){ return x.nicc&&x.nicc<=2; }).reduce(function(s,x){return s+x.ac;},0);
        // Prime farmland is a legal designation (mapunit.farmlndcl), not capability class 1-2.
        var farmKnown = classes.some(function(x){ return x.farm; });
        var primeLegalAc = classes.filter(function(x){ return x.farm && /^all areas are prime/i.test(x.farm); }).reduce(function(a,x){ return a+x.ac; },0);
        var primeIfAc = classes.filter(function(x){ return x.farm && /^prime farmland if/i.test(x.farm); }).reduce(function(a,x){ return a+x.ac; },0);
        var csrAc=0, csrSum=0; classes.forEach(function(x){ if(x.csr2!=null&&x.ac>0){ csrSum+=x.csr2*x.ac; csrAc+=x.ac; } });
        var csr2 = csrAc>0 && csrAc>=0.5*total0 ? Math.round(csrSum/csrAc*10)/10 : null;
        var floodAc = classes.filter(function(x){ return x.flood && !/^none$/i.test(x.flood) && !/^very rare$/i.test(x.flood); }).reduce(function(a,x){ return a+x.ac; },0);
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
        FSX.FIELD.soil = { classes:classes, total:total, hasAc:hasAc, worst:worst, primePct:primePct, csr2:csr2, ext:ext,
                       farmPct: farmKnown&&total>0?Math.round(primeLegalAc/total*100):null, farmIfPct: farmKnown&&total>0?Math.round(primeIfAc/total*100):null,
                       floodPct: ext&&total>0?Math.round(floodAc/total*100):null,
                       top:classes[0]||null, slope:avgSlope, maxSlope:maxSlope, drainageTop:drTop, poorDrainPct:poorPct,
                       nccpi:wNccpi('nccpi'), nccpiCorn:wNccpi('nccpiCorn'), nccpiSoy:wNccpi('nccpiSoy') };
        recomputeInsight(); renderRisk();
        var palette=['#7c5a2e','#9c7339','#b58d4f','#c9a878','#8a6a3b','#a37d45'];
        var html = rows.slice(0,6).map(function(r,i){
          var ac=parseFloat(r[3])||0;
          var hasArea = total>0 && ac>0;                 // only show area/% when SSURGO returned per-mapunit acreage
          var pct = hasArea ? Math.round(ac/total*100) : null;
          var nicc = r[4]; // non-irrigated capability class (1 best … 8 worst)
          var cx = classes[i]||{};
          var cls = nicc ? 'class '+nicc+(cx.sub?cx.sub:'')+' · '+classText(nicc) : '';
          if(cx.farm) cls += ' · '+farmShort(cx.farm);
          if(cx.csr2!=null) cls += ' · CSR2 '+Math.round(cx.csr2);
          var meta = cls + (cls&&hasArea?' · ':'') + (hasArea?ac.toFixed(1)+' ac':'');
          return '<div class="fs-soil-row">'+
            '<div class="fs-soil-bar" style="background:'+palette[i%palette.length]+'">'+(nicc||'?')+'</div>'+
            '<div class="fs-soil-info"><div class="fs-soil-name">'+esc(r[2]||r[1])+'</div>'+
            (meta?'<div class="fs-soil-meta">'+meta+'</div>':'')+'</div>'+
            (pct!=null?'<div class="fs-soil-pct">'+pct+'%</div>':'')+'</div>';
        }).join('');
        if(!hasAc){ html += '<div class="fs-caveat">SSURGO returned the soil map units for this field but not per-unit acreage, so area shares aren\u2019t shown. Soils are listed by map unit.</div>'; }
        var slopeNote = '';
        if(FSX.FIELD.soil.csr2!=null){
          slopeNote += '<div class="fs-soil-slope"><strong>CSR2 '+FSX.FIELD.soil.csr2.toFixed(1)+'</strong>: Iowa\u2019s Corn Suitability Rating (0\u2013100), weighted by acres. It is the number Iowa land sales, rents and loans are quoted against.</div>';
        }
        if(FSX.FIELD.soil.nccpi!=null){
          var nc=Math.round(FSX.FIELD.soil.nccpi*100)/100, tier = nc>=0.65?'high':nc>=0.5?'good':nc>=0.35?'moderate':nc>=0.2?'modest':'low';
          slopeNote += '<div class="fs-soil-slope"><strong>Soil productivity '+Math.round(nc*100)+'/100</strong> (USDA NCCPI '+nc.toFixed(2)+', '+tier+'): how well this soil and climate carry dryland row crops, on one national scale'+
            (FSX.FIELD.soil.nccpiCorn!=null?'. Corn '+FSX.FIELD.soil.nccpiCorn.toFixed(2)+(FSX.FIELD.soil.nccpiSoy!=null?' · soy '+FSX.FIELD.soil.nccpiSoy.toFixed(2):''):'')+'.</div>';
        }
        if(FSX.FIELD.soil.farmPct!=null){
          slopeNote += '<div class="fs-soil-slope"><strong>'+FSX.FIELD.soil.farmPct+'% prime farmland</strong>'+(FSX.FIELD.soil.farmIfPct?' and '+FSX.FIELD.soil.farmIfPct+'% prime <em>if drained</em>':'')+': USDA\u2019s farmland classification for each soil map unit.</div>';
        }
        if(FSX.FIELD.soil.floodPct){
          slopeNote += '<div class="fs-soil-slope"><strong>'+FSX.FIELD.soil.floodPct+'% of the acreage has a mapped flooding frequency</strong> (rare or more often). Check the FEMA map before a loan or a lease.</div>';
        }
        if(FSX.FIELD.soil.poorDrainPct!=null && FSX.FIELD.soil.poorDrainPct>=25){
          slopeNote += '<div class="fs-soil-slope"><strong>'+FSX.FIELD.soil.poorDrainPct+'% of the acreage maps as poorly drained</strong>: the survey\u2019s way of saying the low ground holds water. Late planting and drown-out corners here are the soil, not the operator; tile is the structural fix conversation.</div>';
        } else if(FSX.FIELD.soil.drainageTop){
          slopeNote += '<div class="fs-soil-slope">Dominant drainage: <strong>'+esc(FSX.FIELD.soil.drainageTop)+'</strong></div>';
        }
        if(FSX.FIELD.soil.slope!=null){
          var sl=FSX.FIELD.soil.slope, er = sl<3?'little water-erosion exposure':sl<6?'some water-erosion exposure':sl<12?'real water-erosion exposure':'severe water-erosion exposure';
          slopeNote += '<div class="fs-soil-slope"><strong>'+sl+'% average slope</strong>'+(FSX.FIELD.soil.maxSlope!=null&&FSX.FIELD.soil.maxSlope>sl?' (up to '+FSX.FIELD.soil.maxSlope+'%)':'')+': '+er+'</div>'+
            '<div class="fs-caveat">Slope is SSURGO\u2019s representative value for each soil map unit, not a measurement of your exact acres; flat bottomland beside a hill can read steeper than it farms.</div>';
        }
        setBody('fs-soil', html + slopeNote + '<div class="fs-src" style="margin-top:.5rem">USDA SSURGO · number = land capability class (1 fewest limits, 8 most); letter = the main limit (e wind or water erosion, w wetness, s root zone, c climate)</div>');
      })
      .catch(function(){
        if(gen!==FSX.fieldGen) return;
        // SSURGO upstream flakes transiently (502/504) — retry once before giving up.
        if(!tries){ setTimeout(function(){ if(gen===FSX.fieldGen) loadSoil(poly, 1); }, 1500); return; }
        setErr('fs-soil','The USDA soil survey server (SSURGO) isn\u2019t responding right now. This is a known-flaky government service, not your field. Redraw the field in a few minutes and it usually loads.');
      });
  }
  // NRCS capability wording (not "prime": prime farmland is a separate legal class)
  // ── This year's crop. CDL maps a season the February after; the page used to assume
  // last year's crop (or corn) was standing now. Read the pattern, and let the farmer say. ──
  function rotationRead(codes, years){
    var last=years.length?years[years.length-1]:null, nextYear=last?last+1:null;
    var cs=codes.map(function(c){ return c===1?'C':c===5?'S':(c==null?'-':'O'); });
    var streak=0; for(var i=cs.length-1;i>=0&&cs[i]==='C';i--) streak++;
    var tail=cs.slice(-6), t=tail.join('');
    var out={ pattern:null, text:null, predicted:null, nextYear:nextYear, streakNow:streak };
    if(tail.length<4 || /[-O]/.test(t.slice(-4))){ if(streak>=3){ out.pattern='continuous'; out.text=streak+' straight years of corn'; out.predicted=1; } return out; }
    var alt=true; for(var j=1;j<tail.length;j++){ if(tail[j]===tail[j-1]||!/[CS]/.test(tail[j])) alt=false; }
    if(alt){ out.pattern='cs'; out.text='Corn\u2013soybean rotation'; out.predicted=tail[tail.length-1]==='C'?5:1; return out; }
    // corn-corn-soybean: a period-3 cycle with two corn and one soybean
    var p3=true; for(var k=3;k<tail.length;k++){ if(tail[k]!==tail[k-3]) p3=false; }
    var cyc=tail.slice(-3).join('');
    if(p3 && /^(CCS|CSC|SCC)$/.test(cyc)){
      out.pattern='ccs'; out.text='Corn\u2013corn\u2013soybean rotation';
      var nxt=tail[tail.length-3]; out.predicted=nxt==='C'?1:5; return out;
    }
    if(streak>=3){ out.pattern='continuous'; out.text=streak+' straight years of corn'; out.predicted=1; return out; }
    if(tail.slice(-3).join('')==='SSS'){ out.pattern='soy'; out.text='Soybeans three years running'; out.predicted=5; return out; }
    out.pattern='mixed'; out.text='No steady rotation in recent years'; return out;
  }
  function cropKey(){ return FSX.FIELD&&FSX.FIELD.lat!=null?'fs_crop_'+(+FSX.FIELD.lat).toFixed(3)+'_'+(+FSX.FIELD.lng).toFixed(3)+'_'+new Date().getFullYear():null; }
  function applyThisYear(){
    var r=FSX.FIELD&&FSX.FIELD.rotation; if(!r) return;
    var said=null; try{ var k=cropKey(); said=k?localStorage.getItem(k):null; }catch(e){}
    var code = said==='corn'?1:said==='soy'?5:said==='other'?0:null;
    FSX.FIELD.thisYear = code!=null ? { code:code, src:'you' } : (r.predicted ? { code:r.predicted, src:'pattern' } : { code:null, src:'unknown' });
    // corn on corn THIS year: corn now after corn last year
    r.cornOnCorn = FSX.FIELD.thisYear.code===1 && r.lastCrop===1;
    r.corOnCornYears = r.cornOnCorn ? r.streakNow+1 : 0;
  }
  function thisYearCorn(){ return !!(FSX.FIELD&&FSX.FIELD.thisYear&&FSX.FIELD.thisYear.code===1); }
  function thisYearBeans(){ return !!(FSX.FIELD&&FSX.FIELD.thisYear&&FSX.FIELD.thisYear.code===5); }
  function cropChips(){
    var ty=FSX.FIELD&&FSX.FIELD.thisYear, r=FSX.FIELD&&FSX.FIELD.rotation, yr=r&&r.nextYear?r.nextYear:new Date().getFullYear();
    function chip(key,label,code){ var on=ty&&ty.code===code; return '<button type="button" class="fs-crop-chip'+(on?' on':'')+'" data-crop="'+key+'" aria-pressed="'+(on?'true':'false')+'">'+label+(on&&ty.src==='pattern'?' <small>likely</small>':'')+'</button>'; }
    return '<div class="fs-crop-q"><span>What\u2019s in it for '+yr+'?</span>'+chip('corn','Corn',1)+chip('soy','Soybeans',5)+chip('other','Other',0)+'</div>';
  }
  document.addEventListener('click', function(e){
    var b=e.target&&e.target.closest&&e.target.closest('.fs-crop-chip'); if(!b||!FSX.FIELD) return;
    try{ var k=cropKey(); if(k) localStorage.setItem(k, b.getAttribute('data-crop')); }catch(err){}
    applyThisYear();
    var key=b.getAttribute('data-crop'), q=b.closest('.fs-crop-q'), host=q&&q.parentNode;
    if(q) q.outerHTML=cropChips();
    var nb=host&&host.querySelector('.fs-crop-chip[data-crop="'+key+'"]'); if(nb) nb.focus();   // keep keyboard focus
    if(FSX.FIELD.indices) renderIndices(FSX.FIELD.indices);   // the vigor words depend on the crop
    recomputeInsight(); renderRisk();
    var cy=FSX.FIELD.county; if(cy&&cy.abbr){ loadMarketCard(FSX.fieldGen, cy.abbr, cy.st); loadCondCard(FSX.fieldGen, cy.abbr, cy.st); }
    ga('field_crop_set', { crop: key });
  });
  function classText(n){
    n=parseInt(n,10);
    if(n<=1) return 'few limits for crops';
    if(n<=2) return 'moderate limits';
    if(n<=3) return 'severe limits';
    if(n<=4) return 'very severe limits';
    return 'generally not cropland';
  }
  // "62% prime farmland" when the survey's farmland class came back, else the capability share
  function soilShare(s){
    if(!s) return null;
    if(s.farmPct!=null) return s.farmPct+'% prime farmland'+(s.farmIfPct?' + '+s.farmIfPct+'% if drained':'');
    return s.primePct!=null ? s.primePct+'% class 1\u20132' : null;
  }
  function farmShort(t){
    t=String(t||'');
    if(/^all areas are prime/i.test(t)) return 'prime farmland';
    if(/^prime farmland if/i.test(t)) return 'prime if '+t.replace(/^prime farmland if\s*/i,'').replace(/\s+and\s+.*$/,'');
    if(/statewide/i.test(t)) return 'statewide importance';
    if(/local/i.test(t)) return 'local importance';
    if(/unique/i.test(t)) return 'unique farmland';
    if(/not prime/i.test(t)) return 'not prime';
    return t.toLowerCase();
  }

  // ── 2. CROP ROTATION (USDA Cropland Data Layer) ─────────────────────
  // One Identify on the worker's /cdl route returns this point's CDL crop code
  // for every published year at once (worker hands back rotation[] most-recent-first
  // plus a byYear map). We flip to oldest→newest for the timeline, treat unrecognized
  // codes (developed / water / forest pixel noise) as gaps, and detect corn-on-corn.
  function loadRotation(poly){
    var gen = FSX.fieldGen;
    var c = polyCentroid(poly);
    var url = FS_WORKER + '/cdl?lat='+c.lat.toFixed(5)+'&lon='+c.lng.toFixed(5)+'&years=10';
    fetchT(url, 20000).then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){
        if(gen !== FSX.fieldGen) return;
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
        var rr = rotationRead(codes, years);
        // corn-on-corn is THIS year's corn on last year's corn, or a streak of 3+ ending now.
        // A corn-corn-soybean rotation has a 2-year streak every cycle; flagging any 2-year
        // streak in ten years told a disciplined C-C-S farm to "break the rotation" (panel 9/20).
        FSX.FIELD.rotation = { codes:codes, years:years, maxCornStreak:maxCornStreak, cornCount:cornCount,
          beanCount:beanCount, lastCrop: codes[codes.length-1], pattern: rr.pattern, patternText: rr.text,
          predicted: rr.predicted, nextYear: rr.nextYear, streakNow: rr.streakNow, cornOnCorn: false };
        applyThisYear();
        recomputeInsight(); renderRisk();
        // If not one year resolved to a recognized row/forage crop, this field isn't
        // cropland in CDL (pasture, forest, developed, water). Say so plainly rather
        // than render five empty placeholder tiles that look broken.
        if(codes.every(function(c){ return c===null; })){
          setBody('fs-rot','<div class="fs-src">USDA\u2019s Cropland Data Layer doesn\u2019t classify this spot as row-crop or forage ground over the years on record. It reads as pasture, forest, developed, or water at the field center. Draw over active cropland to see a rotation.</div>');
          return;
        }
        var html='<div class="fs-rotation">'+ codes.map(function(code,i){
          var info = code ? crop(code) : {l:'-',e:'·',c:'#333'};
          return '<div class="fs-rot-year">'+
            '<div class="fs-rot-chip" aria-hidden="true" style="background:'+hexA(info.c,.18)+';border-color:'+hexA(info.c,.5)+'">'+esc(info.l.charAt(0))+'</div>'+
            '<div class="fs-rot-crop">'+esc(info.l)+'</div>'+
            '<div class="fs-rot-yr">\''+String(years[i]).slice(2)+'</div></div>';
        }).join('') + '</div>'+
        (codes.length>5?'<div class="fs-src" style="margin-top:.5rem"><strong style="color:var(--text-dim)">'+codes.length+' years on record:</strong> '+cornCount+'\u00d7 corn, '+beanCount+'\u00d7 beans'+(maxCornStreak>=2?', longest corn streak '+maxCornStreak+' yrs':'')+'</div>':'')+
        (rr.text?'<p class="fs-cline" style="margin-top:.55rem"><strong>'+esc(rr.text)+'</strong>'+(rr.predicted?', '+rr.nextYear+' is likely '+(rr.predicted===1?'corn':'soybeans')+' on that pattern.':'.')+'</p>':'')+
        cropChips()+
        '<div class="fs-src" style="margin-top:.6rem">USDA Cropland Data Layer · the crop at the field\u2019s center point each year</div>'+
        '<div class="fs-caveat">CDL is satellite-classified (~85&ndash;90% accurate per pixel) and sampled at the field\u2019s center point, so a single odd year may be a classification miss rather than a real planting.</div>'+
        '<div id="fs-rot-spread"></div>';
        setBody('fs-rot', html);
        rotationSpread(poly, gen, recent);
      })
      .catch(function(){ if(gen!==FSX.fieldGen) return; setErr('fs-rot','The USDA crop-history service isn\u2019t responding right now: a temporary government-server hiccup, not your field. Redraw in a few minutes.'); });
  }

  // ── 2b. One pixel can't see a split field. Read the same CDL years at up to four more
  // points inside the outline (each a quarter of the way out from the center) and say how
  // often they agree with each other. The chips above stay the center read.
  function spreadPoints(ring, c){
    var lats=ring.map(function(p){ return p.lat; }), lngs=ring.map(function(p){ return p.lng; });
    var dy=(Math.max.apply(null,lats)-Math.min.apply(null,lats))*0.25, dx=(Math.max.apply(null,lngs)-Math.min.apply(null,lngs))*0.25;
    var rr=ring.map(function(p){ return [p.lng, p.lat]; });
    return [[c.lat+dy,c.lng-dx],[c.lat+dy,c.lng+dx],[c.lat-dy,c.lng+dx],[c.lat-dy,c.lng-dx]]
      .filter(function(q){ return _hmPointInRing(q[0], q[1], rr); });
  }
  // years[] oldest first; reads[] = one {year: code} map per point that answered (center first)
  function spreadSummary(years, reads){
    var agree=0, split=[];
    years.forEach(function(y){
      var n={}, k=0;
      reads.forEach(function(r){ if(r[y]==null) return; var l=crop(r[y]).l; n[l]=(n[l]||0)+1; k++; });
      var ls=Object.keys(n); if(!k) return;
      if(ls.length===1) agree++;
      else split.push({ year:y, parts:ls.sort(function(a,b){ return n[b]-n[a]; }).map(function(l){ return { l:l, n:n[l] }; }) });
    });
    return { points:reads.length, years:agree+split.length, agree:agree, split:split };
  }
  window.__fsSpread = { summary:spreadSummary, points:spreadPoints };
  function rotationSpread(poly, gen, recent){
    if(!poly || polyAcres(poly) < 8) return;
    var c=polyCentroid(poly), pts=spreadPoints(latlngs(poly), c);
    if(pts.length<2) return;
    var years=recent.map(function(x){ return x.year; });
    var center={}; recent.forEach(function(x){ center[x.year]=x.code; });
    Promise.all(pts.map(function(q){
      return fetchT(FS_WORKER+'/cdl?lat='+q[0].toFixed(5)+'&lon='+q[1].toFixed(5)+'&years=10', 20000)
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(d){ var m={}, h=d&&!d.error?(d.history&&d.history.length?d.history:d.rotation):null; if(!h||!h.length) return null; h.forEach(function(x){ m[x.year]=x.code; }); return m; })
        .catch(function(){ return null; });
    })).then(function(rs){
      if(gen!==FSX.fieldGen) return;
      var reads=[center].concat(rs.filter(Boolean));
      var el=document.getElementById('fs-rot-spread'); if(!el || reads.length<3) return;
      var S=spreadSummary(years, reads);
      if(!S.years) return;
      if(FSX.FIELD && FSX.FIELD.rotation) FSX.FIELD.rotation.spread=S;
      var line='<strong>Checked at '+S.points+' points across the field:</strong> '+(S.agree===S.years?'all agree in every year on record.':'they agree in '+S.agree+' of '+S.years+' years.');
      if(S.split.length) line+=' '+S.split.slice(-3).map(function(sp){ return sp.year+': '+sp.parts.map(function(p){ return esc(p.l.toLowerCase())+' '+p.n; }).join(', '); }).join('; ')+'.';
      if(S.split.length) line+=' A split year is a split field, a waterway or edge, or a pixel miss.';
      el.innerHTML='<p class="fs-cline" style="margin-top:.55rem">'+line+'</p>';
    });
  }

  // fetch with a hard timeout — a stalled (never-responding) connection otherwise
  // leaves a panel spinning forever, since fetch() has no built-in timeout and
  // .catch only fires on rejection, not on a hang.
  function fetchT(url, ms){
    if(typeof AbortController==='undefined') return fetch(url);
    var ctrl=new AbortController(), id=setTimeout(function(){ try{ctrl.abort();}catch(e){} }, ms||12000);
    return fetch(url,{signal:ctrl.signal}).then(function(r){ clearTimeout(id); return r; }, function(e){ clearTimeout(id); throw e; });
  }

  // ── 3. WEATHER NOW: the National Weather Service's nearest observing station ──
  // 2026-10-29 (Sig: no paid Open-Meteo key; its free tier is for sites without ads or
  // subscriptions, and AGSIST runs sponsor slots). api.weather.gov is public domain, free for
  // any purpose, no key. Three small reads: the point, its stations, the newest observation.
  // The 7-day rain number is no longer a weather model's: it is the county gauge's own days
  // (data/rain/daily, NOAA daily records), filled in by loadSeason once the county is known.
  var NWS='https://api.weather.gov';
  function nwsJSON(url, ms){ return fetchT(url, ms||10000).then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); }); }
  function cToF(v){ return v==null||!isFinite(v)?null:Math.round(v*9/5+32); }
  function toMph(q){ if(!q||q.value==null||!isFinite(q.value)) return null; var u=String(q.unitCode||''); return Math.round(/m_s-1/.test(u)?q.value*2.23694:/km_h-1/.test(u)?q.value*0.621371:q.value); }
  function loadWeather(c){
    var gen = FSX.fieldGen;
    nwsJSON(NWS+'/points/'+c.lat.toFixed(4)+','+c.lng.toFixed(4))
      .then(function(pt){ var u=pt&&pt.properties&&pt.properties.observationStations; if(!u) throw new Error('no stations'); return nwsJSON(u); })
      .then(function(st){
        var f=st&&st.features&&st.features[0], sp=f&&f.properties; if(!sp||!sp.stationIdentifier) throw new Error('no station');
        var g=f.geometry&&f.geometry.coordinates;
        return nwsJSON(NWS+'/stations/'+encodeURIComponent(sp.stationIdentifier)+'/observations/latest').then(function(ob){
          return { ob:ob&&ob.properties, id:sp.stationIdentifier, name:sp.name||sp.stationIdentifier, mi:(g&&isFinite(g[1])&&isFinite(g[0]))?_hvsMi(c.lat,c.lng,g[1],g[0]):null };
        });
      })
      .then(function(x){
        if(gen !== FSX.fieldGen) return;
        var o=x.ob||{}, t=cToF(o.temperature&&o.temperature.value);
        if(t==null){ window.__fsWx={err:1, wk:(window.__fsWx&&window.__fsWx.wk)}; renderWx(); return; }
        var prev=window.__fsWx||{};
        window.__fsWx = {
          temp:t, hum:(o.relativeHumidity&&o.relativeHumidity.value!=null)?Math.round(o.relativeHumidity.value):null,
          wind:toMph(o.windSpeed), at:o.timestamp||null, stn:x.name, stnId:x.id, stnMi:x.mi,
          wk:prev.wk, wkAt:prev.wkAt, wkStn:prev.wkStn
        };
        FSX.FIELD.weather = window.__fsWx; recomputeInsight();
        renderWx();
      })
      .catch(function(){ if(gen!==FSX.fieldGen) return; var prev=window.__fsWx||{}; window.__fsWx={err:1, wk:prev.wk, wkAt:prev.wkAt, wkStn:prev.wkStn}; renderWx(); });
  }
  // ── DROUGHT: our own copy of the US Drought Monitor county statistics first ──
  // 2026-10-29: /data/drought/county-week.json (the weekly USDM county statistics, saved by our
  // own run) answers as soon as the county is known: the worst category covering at least half
  // the county, labelled county-wide, with its map week. The worker's point read for the field
  // itself (USDM map at the center) then sharpens it when it answers; when it does not, the
  // county answer stands. Honesty rule: 'None' is a real answer; a failed read is UNKNOWN (null).
  var _dwk=null;
  // FS-DROUGHTCOUNTY-BEGIN
  function droughtFromCounty(d, fips){
    if(!d || !d.c || !fips) return null;
    var row=d.c[fips];
    if(!row){ return (d.zero||[]).indexOf(fips)>=0 ? { lvl:-1, share:0, wk:d.valid } : null; }
    var now=row[0]; if(!now || now.length<5 || now[0]==null) return null;
    var lvl=-1; for(var k=4;k>=0;k--){ if(now[k]!=null && now[k]>=50){ lvl=k; break; } }
    return { lvl:lvl, share:lvl>=0?now[lvl]:now[0], d0:now[0], wk:d.valid };
  }
  // FS-DROUGHTCOUNTY-END
  function loadDrought(c){
    var gen = FSX.fieldGen, point=false;
    if(!_dwk) _dwk=getJSON('/data/drought/county-week.json', 20000).catch(function(){ _dwk=null; return null; });
    var localP = waitCountyFips(20000).then(function(cy){
      if(!cy) return null;
      return _dwk.then(function(d){ return droughtFromCounty(d, String(cy.fips)); });
    }).catch(function(){ return null; });
    localP.then(function(h){
      if(gen !== FSX.fieldGen || point || !h) return;
      var cat=droughtLabel(h.lvl);
      window.__fsDr={cat:cat, approx:'county', wk:h.wk, share:h.share, d0:h.d0, own:true}; FSX.FIELD.drought=window.__fsDr; recomputeInsight(); renderWx();
    });
    // USDM point service for the field itself, through the worker (no CORS on the USDM endpoint).
    var url=FS_WORKER+'/drought?lat='+c.lat.toFixed(4)+'&lon='+c.lng.toFixed(4);
    var workerP = fetchT(url, 20000).then(function(r){return r.ok?r.json():null;}).then(function(d){
      if(gen !== FSX.fieldGen) return false;
      var cat=null;
      if(d && !d.error){
        var lvl = d.DroughtClass!=null ? d.DroughtClass : (d.dm!=null?d.dm:(Array.isArray(d)&&d[0]&&d[0].DroughtClass!=null?d[0].DroughtClass:null));
        if(lvl!=null) cat = droughtLabel(lvl);
      }
      if(cat==null) return false;
      // the worker's own county fallback adds nothing to ours: it shows only until ours lands
      if(d.approx){ if(window.__fsDr && window.__fsDr.own) return true; }
      else point=true;
      var wk = d.mapWeek || d.MapDate || d.mapDate || d.ValidStart || d.validStart || null;
      window.__fsDr={cat:cat, approx:d.approx||null, wk:wk}; FSX.FIELD.drought=window.__fsDr; recomputeInsight(); renderWx();
      return true;
    }).catch(function(){ return false; });
    Promise.all([localP, workerP]).then(function(x){
      if(gen!==FSX.fieldGen) return;
      if(!x[0] && !x[1] && !(window.__fsDr&&window.__fsDr.cat!=null)){ window.__fsDr={cat:null}; if(FSX.FIELD)FSX.FIELD.drought={cat:null}; recomputeInsight(); renderWx(); }
    });
  }
  function droughtLabel(lvl){
    if(lvl==null||lvl<0) return 'None';
    return ['Abnormally Dry (D0)','Moderate (D1)','Severe (D2)','Extreme (D3)','Exceptional (D4)'][lvl] || 'None';
  }

  // ── 3b. SEASON vs NORMAL: our own county gauge for rain, a NOAA grid for heat units ──
  // 2026-10-29: off Open-Meteo (see loadWeather).
  //   Rain: the county's gauge from /data/rain/<st>.json (NOAA daily records through RCC-ACIS,
  //   the same record the county rain pages print), Jan 1 to its last report, against that
  //   gauge's 1991-2020 normal. A real 30-year normal, and the gauge and its miles are named.
  //   GDUs: RCC-ACIS GridData, grid 21 (PRISM daily, an estimate on a 4 km grid), this year and
  //   the five before, Jan 1 to the same calendar day each year; base 50°F, 86° cap. The GDU
  //   comparison stays a 5-year average and says so.
  // Either half can fail alone; the card shows what came back and says what did not.
  var ACIS_GRID='https://data.rcc-acis.org/GridData';
  function waitCountyFips(ms){
    var gen=FSX.fieldGen, t0=Date.now();
    return new Promise(function(ok){ (function tick(){
      var cy=FSX.FIELD&&FSX.FIELD.county;
      if(gen!==FSX.fieldGen) return ok(null);
      if(cy&&cy.fips&&cy.abbr) return ok(cy);
      if(Date.now()-t0>ms) return ok(null);
      setTimeout(tick, 250);
    })(); });
  }
  // data/rain/daily packing (scripts/county_rain.py pack_days): tok or tok*count; hundredths,
  // M missing, T trace, S part of a later multi-day total (A).
  function unpackDays(str){
    var out=[]; String(str||'').split(',').forEach(function(t){
      if(!t) return; var k=1, i=t.indexOf('*'); if(i>0){ k=+t.slice(i+1); t=t.slice(0,i); }
      for(var n=0;n<k;n++) out.push(t);
    }); return out;
  }
  // FS-WEEKRAIN-BEGIN
  // The last 7 reported days at the gauge: null when two or more of them are missing.
  function weekRain(p, year){
    var d=unpackDays(p); if(d.length<7) return null;
    var w=d.slice(-7), miss=0, sum=0;
    w.forEach(function(t){ if(t==='M') miss++; else if(t!=='T'&&t!=='S') sum+=parseInt(t,10)/100||0; });
    if(miss>=2) return null;
    var last=new Date(Date.UTC(year,0,d.length)).toISOString().slice(0,10);
    return { inches:Math.round(sum*100)/100, through:last, missing:miss };
  }
  // FS-WEEKRAIN-END
  function gaugeRain(cy){
    var st=String(cy.abbr).toLowerCase();
    return Promise.all([getJSON('/data/rain/'+st+'.json'), getJSON('/data/rain/daily/'+st+'.json').catch(function(){ return null; })]).then(function(x){
      var R=x[0], D=x[1], f=String(cy.fips), rec=R&&R.counties&&R.counties[f], via=null;
      if(!rec && R && R.none && R.none[f] && R.none[f].near && R.counties[R.none[f].near]){ via=R.none[f].near; rec=R.counties[via]; }
      if(!rec || rec.total==null || rec.usual==null || !rec.station) return null;
      var ll=rec.station.ll, mi=(ll&&isFinite(ll[0]))?_hvsMi(FSX.FIELD.lat, FSX.FIELD.lng, ll[1], ll[0]):null;
      var dd=D&&D.counties&&D.counties[via||f], wk=dd?weekRain(dd.p, +(D.year||R.year)):null;
      return { total:+rec.total, usual:+rec.usual, pct:rec.pct, thru:rec.as_of||R.edate, year:+R.year, cum:rec.cum||null,
        station:rec.station.name, mi:mi, borrowed:via?(rec.name||'a neighboring county'):null, normals:R.normals||'1991-2020', wk:wk };
    });
  }
  function gridGdu(c){
    var yNow=new Date().getFullYear();
    var end=new Date(Date.now()-2*864e5).toISOString().slice(0,10);   // the PRISM day lands a day or two late
    var params=JSON.stringify({ loc:c.lng.toFixed(3)+','+c.lat.toFixed(3), grid:'21', sdate:(yNow-5)+'-01-01', edate:end, elems:'maxt,mint' });
    return fetchT(ACIS_GRID+'?params='+encodeURIComponent(params), 15000).then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); }).then(function(j){
      if(!j || !Array.isArray(j.data) || !j.data.length) return null;
      var rows=j.data.filter(function(r){ return r && +r[1]>-998 && +r[2]>-998; });
      if(!rows.length) return null;
      var cutoffIso=rows[rows.length-1][0], cutoff=cutoffIso.slice(5);
      var plantMD = c.lat>=44 ? '05-05' : c.lat>=41 ? '04-28' : c.lat>=38 ? '04-18' : '04-08';
      var acc={}, gCum={};
      rows.forEach(function(r){
        var md=String(r[0]).slice(5), yr=+String(r[0]).slice(0,4); if(md>cutoff) return;
        var hi=Math.min(+r[1],86), lo=Math.max(+r[2],50), g=Math.max(0,(hi+lo)/2-50);
        if(!acc[yr]){ acc[yr]={gdu:0,gduP:0}; gCum[yr]={}; }
        acc[yr].gdu+=g; if(md>=plantMD){ acc[yr].gduP+=g; gCum[yr][md]=acc[yr].gduP; }
      });
      var ys=Object.keys(acc).map(Number).sort(function(a,b){return a-b;}), cur=ys[ys.length-1];
      var prior=ys.filter(function(y){ return y<cur; });
      if(cur!==yNow || prior.length<3) return null;
      var gNorm=prior.reduce(function(a,y){ return a+acc[y].gdu; },0)/prior.length;
      return { gNow:acc[cur].gdu, gNorm:gNorm, gDep:acc[cur].gdu-gNorm, gPlant:acc[cur].gduP, plantMD:plantMD, gCumMap:gCum[cur]||null, n:prior.length, gThru:cutoffIso };
    });
  }
  function loadSeason(c){
    var gen = FSX.fieldGen;
    var rainP = waitCountyFips(20000).then(function(cy){ return cy ? gaugeRain(cy) : null; }).catch(function(){ return null; });
    var gduP = gridGdu(c).catch(function(){ return null; });
    rainP.then(function(r){
      if(gen!==FSX.fieldGen || !r || !r.wk) return;
      var w=window.__fsWx||{}; w.wk=r.wk.inches.toFixed(2); w.wkAt=r.wk.through; w.wkStn=r.station; w.wkMi=r.mi; window.__fsWx=w;
      if(!w.err) FSX.FIELD.weather=w; renderWx();
    });
    Promise.all([rainP, gduP]).then(function(x){
      if(gen !== FSX.fieldGen) return;
      var r=x[0], g=x[1];
      if(!r && !g){ FSX.FIELD.season=null; recomputeInsight(); renderRisk(); setErr('fs-season','The county rain gauge record and the heat-unit grid did not answer just now.'); return; }
      var se={ year:new Date().getFullYear(), n:g?g.n:null, gauge:!!r, pLbl: r ? r.normals+' normal' : null };
      if(r){ se.pNow=r.total; se.pNorm=r.usual; se.pDep=r.total-r.usual; se.pct=r.pct; se.thru=r.thru; se.station=r.station; se.mi=r.mi; se.borrowed=r.borrowed; se.cum=r.cum; }
      else { se.pNow=null; se.pNorm=null; se.pDep=null; }
      if(g){ se.gNow=g.gNow; se.gNorm=g.gNorm; se.gDep=g.gDep; se.gPlant=g.gPlant; se.plantMD=g.plantMD; se.gCumMap=g.gCumMap; se.gThru=g.gThru; if(!se.thru) se.thru=g.gThru; }
      else { se.gNow=null; se.gNorm=null; se.gDep=null; se.gPlant=null; se.gCumMap=null; }
      FSX.FIELD.season=se;
      recomputeInsight(); renderRisk();
      setBody('fs-season', seasonHtml(se));
    });
  }
  // "the 1991-2020 normal" for gauge rain; the GDU line keeps its own "N-year average"
  function pLbl(se){ return se&&se.pLbl ? 'the '+se.pLbl : 'normal'; }

  function seasonHtml(s){
    var fmtDate=function(iso){ var d=new Date(iso+'T00:00'); return d.toLocaleDateString(undefined,{month:'short',day:'numeric'}); };
    var depIn=function(v){ if(Math.abs(v)<0.25) return '<span style="color:#9aa">about normal</span>';
      var up=v>0; return '<span style="color:'+(up?'#4aab4c':'#d9534f')+'">'+(up?'+':'−')+Math.abs(v).toFixed(1)+'″ vs normal</span>'; };
    var depG=function(v){ if(Math.abs(v)<15) return '<span style="color:#9aa">≈ '+s.n+'-yr avg</span>';
      var up=v>0; return '<span style="color:'+(up?'#4aab4c':'#e0a32e')+'">'+(up?'+':'−')+Math.abs(v).toFixed(0)+' vs '+s.n+'-yr avg</span>'; };
    var blocks=[];
    if(s.pNow!=null) blocks.push('<div class="fs-stat"><div class="fs-stat-v">'+s.pNow.toFixed(1)+'″</div><div class="fs-stat-l">Rain since Jan 1 &nbsp;·&nbsp; '+depIn(s.pDep)+(s.pct!=null?' ('+Math.round(s.pct)+'%)':'')+'</div></div>');
    else blocks.push('<div class="fs-stat"><div class="fs-stat-v">-</div><div class="fs-stat-l">Rain since Jan 1 &nbsp;·&nbsp; no county gauge record</div></div>');
    if(s.gNow!=null) blocks.push('<div class="fs-stat"><div class="fs-stat-v">'+Math.round(s.gNow)+'</div><div class="fs-stat-l">GDUs YTD &nbsp;·&nbsp; '+depG(s.gDep)+'</div></div>');
    else blocks.push('<div class="fs-stat"><div class="fs-stat-v">-</div><div class="fs-stat-l">GDUs YTD &nbsp;·&nbsp; the grid did not answer</div></div>');
    var wet=s.pDep!=null&&s.pDep>=1, dry=s.pDep!=null&&s.pDep<=-1, hot=s.gDep!=null&&s.gDep>=75, cool=s.gDep!=null&&s.gDep<=-75, say;
    if(hot&&dry) say='A hot, dry season so far: the crop is developing fast into a moisture deficit, the combination to watch closest.';
    else if(hot&&wet) say='Warm and well-watered, fast development with moisture to back it. About the best combination there is.';
    else if(cool&&wet) say='A cool, wet season: development is running behind, and low ground may be struggling with the surplus.';
    else if(cool&&dry) say='Cool and dry: slow development, but the moisture deficit bites less at this pace.';
    else if(hot) say='Heat is running ahead of the last '+s.n+' years; development is ahead of the calendar.';
    else if(cool) say='Heat units are lagging the last '+s.n+' years. Expect development a few days behind.';
    else if(wet) say='Rain is running ahead of '+pLbl(s)+' at the county gauge: moisture is banked, not a limiting factor so far.';
    else if(dry) say='Rain is running behind '+pLbl(s)+' at the county gauge, not acute yet, but the deficit is the number to watch.';
    else if(s.pDep!=null&&s.gDep!=null) say='Rain is close to normal and heat close to the last '+s.n+' years, an unremarkable season in the best sense.';
    else say='';
    var src=[];
    if(s.pNow!=null) src.push('Rain: the '+esc(s.station)+' gauge'+(s.mi!=null?', '+Math.round(s.mi)+' mi from this field':'')+(s.borrowed?' (no gauge reports in this county; this is '+esc(s.borrowed)+'’s)':'')+', Jan 1 through '+fmtDate(s.thru)+', against its '+esc(s.pLbl)+' (NOAA daily records via RCC-ACIS)');
    if(s.gNow!=null) src.push('GDUs: PRISM daily grid via RCC-ACIS, an estimate, this year vs the '+s.n+' before, Jan 1 through '+fmtDate(s.gThru)+', base 50°F');
    return '<div class="fs-stats" style="grid-template-columns:1fr 1fr">'+blocks.join('')+'</div>'+
      (say?'<div class="fs-vigor-say" style="margin:.55rem 0 .2rem">'+say+'</div>':'')+
      gaugeSpark(s)+
      '<div class="fs-src" style="margin-top:.55rem">'+src.join(' · ')+'</div>';
  }
  // The gauge's running total against its normal running total, week by week, Jan 1 to date.
  function gaugeSpark(s){
    var cum=(s.cum||[]).filter(function(r){ return r && r[1]!=null && r[2]!=null; });
    if(cum.length<4) return '';
    var W=360, H=120, pl=32, pr=40, pt=10, pb=18, iw=W-pl-pr, ih=H-pt-pb;
    var maxV=Math.max.apply(null, cum.map(function(r){ return Math.max(r[1], r[2]); }))||1;
    var step=maxV>40?20:maxV>16?10:maxV>8?5:maxV>4?2:1; maxV=Math.ceil(maxV/step)*step;
    var d0=cum[0][0], d1=cum[cum.length-1][0]||1;
    var X=function(d){ return pl+iw*((d-d0)/Math.max(1,d1-d0)); }, Y=function(v){ return pt+ih*(1-v/maxV); };
    var line=function(k){ return cum.map(function(r,i){ return (i?'L':'M')+X(r[0]).toFixed(1)+' '+Y(r[k]).toFixed(1); }).join(' '); };
    var grid=''; for(var tv=0; tv<=maxV+1e-9; tv+=step){ var gy=Y(tv);
      grid+='<line x1="'+pl+'" y1="'+gy.toFixed(1)+'" x2="'+(W-pr)+'" y2="'+gy.toFixed(1)+'" stroke="rgba(132,160,168,'+(tv===0?'.28':'.12')+'" stroke-width="1"/><text x="'+(pl-5)+'" y="'+(gy+3).toFixed(1)+'" text-anchor="end" font-size="9" fill="#8a948f" font-family="JetBrains Mono,monospace">'+(tv===0?'0':tv+'″')+'</text>'; }
    var last=cum[cum.length-1], dev=last[1]-last[2];
    var col = dev<=-2 ? '#d98a1f' : dev>=2 ? '#3f9a45' : 'var(--fs-rain,#4f8fc0)';
    return '<div class="fs-chart-title">Rain at the county gauge: Jan 1 to date</div>'+
      '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Rain this year at the county gauge against its normal" style="display:block;width:100%;height:auto;margin-top:.35rem">'+grid+
      '<path d="'+line(2)+'" fill="none" stroke="#8a948f" stroke-width="1.2" stroke-dasharray="4 3"></path>'+
      '<path d="'+line(1)+'" fill="none" stroke="'+col+'" stroke-width="2.4" stroke-linejoin="round"></path>'+
      '<circle cx="'+X(last[0]).toFixed(1)+'" cy="'+Y(last[1]).toFixed(1)+'" r="3.2" fill="'+col+'"/>'+
      '<text x="'+(X(last[0])+6).toFixed(1)+'" y="'+(Math.max(pt+7,Y(last[1]))+3).toFixed(1)+'" font-size="10" font-weight="700" fill="'+col+'" font-family="JetBrains Mono,monospace">'+(+last[1]).toFixed(1)+'″</text></svg>'+
      '<div class="fs-src" style="margin-top:.15rem;display:flex;gap:1rem;flex-wrap:wrap"><span style="color:'+col+'">&#9644; This year</span><span style="color:#8a948f">- - '+esc(s.pLbl||'normal')+'</span></div>';
  }

  function droughtColor(cat){
    if(!cat||cat==='None') return '#4aab4c';
    if(cat.indexOf('D0')>=0) return '#d8c300';
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
      var wkTxt = wx.wk!=null ? wx.wk+'"' : '-';
      html += '<div class="fs-stats">'+
        stat(wx.temp+'°','Air temp')+ stat(wx.hum!=null?wx.hum+'%':'-','Humidity')+
        stat(wx.wind!=null?wx.wind+' mph':'-','Wind')+ stat(wkTxt,'Rain, 7 days')+'</div>';
      // one plain-language read of the numbers above — what they mean for work today
      var wkN=parseFloat(wx.wk)||0, wxSay;
      if(wx.wind!=null && wx.wind>15) wxSay='Too windy to spray right now: drift risk at '+wx.wind+' mph.';
      else if(wkN>=1.5) wxSay='A wet week ('+wx.wk+'″ in 7 days at the county gauge); low ground is likely soft underfoot.';
      else if(wx.hum!=null && wx.hum>85 && wx.temp>=70) wxSay='Warm and humid, prime conditions for foliar disease; slow herbicide drydown too.';
      else if(wx.temp>90) wxSay='Hot: crop water demand is peaking; spray early if you spray.';
      else if(wx.wind!=null && wx.wind<=10 && wx.hum!=null && wx.hum<=85) wxSay='A decent working window: light wind, workable humidity.';
      // hand off to the full spray tool for the forward window
      if(wxSay) wxSay+=' <a href="/spray" target="_blank" rel="noopener" style="color:var(--brand,var(--gold))">Full spray forecast &rarr;</a>';
      else wxSay='Middling conditions. Nothing blocking field work, nothing ideal.';
      html += '<div class="fs-vigor-say" style="margin-top:.55rem">'+wxSay+'</div>';
      // NOAA's radar and gauge estimate for the field itself is on /rain-radar
      if(FSX.FIELD && isFinite(FSX.FIELD.lat) && isFinite(FSX.FIELD.lng))
        html += '<div class="fs-vigor-say" style="margin-top:.35rem"><a href="/rain-radar?lat='+FSX.FIELD.lat.toFixed(4)+'&lon='+FSX.FIELD.lng.toFixed(4)+'&label=this%20field" target="_blank" rel="noopener" style="color:var(--brand,var(--gold))">Rain on this field from NOAA radar and gauges, 24 hours to this month &rarr;</a></div>';
    } else if(wx && wx.err){
      html += '<div class="fs-err" style="margin-bottom:.6rem">National Weather Service observations not answering right now.'+(wx.wk!=null?' Rain at the county gauge, last 7 reported days: '+esc(wx.wk)+'″.':'')+'</div>';
    } else {
      html += '<div class="fs-loading"><span class="fs-spin"></span>weather</div>';
    }
    if(dr){
      if(dr.cat!=null){
        var col=droughtColor(dr.cat);
        var dmark = (dr.cat==='None')?'●':(dr.cat.indexOf('D3')>=0||dr.cat.indexOf('D4')>=0)?'■':(dr.cat.indexOf('D2')>=0)?'◕':'◐';
        var dword = dr.cat==='None' ? 'No drought' : /D0/.test(dr.cat) ? 'Not drought yet: '+esc(dr.cat) : 'Drought: '+esc(dr.cat);
        html += '<div style="margin-top:.7rem"><span class="fs-drought" style="background:'+hexA(col,.18)+';color:var(--text);border:1px solid '+hexA(col,.6)+'"><span aria-hidden="true" style="color:'+col+'">'+dmark+'</span> '+dword+(dr.approx?' <small>(county-wide)</small>':'')+'</span></div>';
      } else {
        html += '<div class="fs-src" style="margin-top:.6rem">Drought status unavailable.</div>';
      }
    }
    var srcs=[];
    if(wx && !wx.err) srcs.push('National Weather Service, '+esc(wx.stn||'nearest station')+(wx.stnMi!=null?' ('+Math.round(wx.stnMi)+' mi)':'')+(wx.at?', observed '+esc(wxTime(wx.at)):''));
    if(wx && wx.wk!=null && wx.wkStn) srcs.push('7-day rain: '+esc(wx.wkStn)+' gauge, through '+esc(usdmWeek(wx.wkAt)));
    if(dr && dr.cat!=null) srcs.push('US Drought Monitor'+(dr.own?' county statistics':'')+(usdmWeek(dr.wk)?', map of '+esc(usdmWeek(dr.wk)):', this week\u2019s map'));
    if(srcs.length) html += '<div class="fs-src" style="margin-top:.5rem">'+srcs.join(' &middot; ')+'</div>';
    setBody('fs-wx', html);
  }
  // NWS timestamps carry their offset ("2026-10-16T19:15:00+00:00"): print the reader's own
  // clock time, "2:15 PM". A bare local time ("2026-10-16T14:15") prints as written.
  function wxTime(t){
    var sx=String(t||''), m=/T(\d{2}):(\d{2})/.exec(sx); if(!m) return '';
    if(/(Z|[+-]\d{2}:?\d{2})$/.test(sx)){ var d=new Date(sx); if(!isNaN(d)) try{ return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); }catch(e){} }
    var h=+m[1]; return (h%12||12)+':'+m[2]+' '+(h<12?'AM':'PM'); }
  // USDM dates come as "2026-10-06", "2026-10-06T00:00:00" or "20261006": print "Oct 6".
  function usdmWeek(v){
    var s=String(v||''), m=/^(\d{4})-?(\d{2})-?(\d{2})/.exec(s); if(!m) return '';
    var M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m[2]-1];
    return M ? M+' '+(+m[3]) : '';
  }
  window.__fsFmt = { wxTime:wxTime, usdmWeek:usdmWeek };
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
  // Closed years come from 2 x 2 degree cells (data/field-scout/hail/, built from the same
  // events files by scripts/build_field_scout_data.py): the 1 to 4 cells within 40 miles
  // instead of every report in the country. The current year, and any year the cells were
  // not built for, still reads the national file. A cell that fails to load sends its years
  // back to the national files, so a failed read is never counted as "no hail".
  var _hailIdx=null;
  function _hailIndex(){
    if(!_hailIdx) _hailIdx=fetch('/data/field-scout/hail/index.json')
      .then(function(r){ if(!r.ok) throw new Error('idx'); return r.json(); })
      .catch(function(){ _hailIdx=null; return null; });
    return _hailIdx;
  }
  var _hailCellCache={};
  function _hailCell(k){
    if(!_hailCellCache[k]) _hailCellCache[k]=fetch('/data/field-scout/hail/'+k+'.json')
      .then(function(r){ if(!r.ok) throw new Error('cell '+k); return r.json(); })
      .catch(function(e){ delete _hailCellCache[k]; throw e; });
    return _hailCellCache[k];
  }
  function _hailCellsNear(lat, lng, miles, size){
    var dLat=miles/69.0, dLng=miles/(69.0*Math.max(0.2, Math.cos(lat*Math.PI/180)));
    var out=[];
    for(var a=Math.floor((lat-dLat)/size)*size; a<=Math.floor((lat+dLat)/size)*size; a+=size)
      for(var b=Math.floor((lng-dLng)/size)*size; b<=Math.floor((lng+dLng)/size)*size; b+=size)
        out.push(a+'_'+b);
    return out;
  }
  function _hailFilesNear(c, yrs){
    function national(list){ return Promise.all(list.map(function(y){ return _hailYearFile(y).catch(function(){ return null; }); })); }
    return _hailIndex().then(function(ix){
      var cov = (ix && ix.years && ix.cell) ? yrs.filter(function(y){ return ix.years.indexOf(y)>=0; }) : [];
      if(!cov.length) return national(yrs);
      var have={}; (ix.cells||[]).forEach(function(k){ have[k]=1; });
      var keys=_hailCellsNear(c.lat, c.lng, 41, ix.cell).filter(function(k){ return have[k]; });
      var cellsP=Promise.all(keys.map(_hailCell)).then(function(cells){
        var by={}; cov.forEach(function(y){ by[y]={ year:y, ev:[] }; });
        cells.forEach(function(cl){ (cl.ev||[]).forEach(function(e){ if(by[e[4]]) by[e[4]].ev.push(e); }); });
        return by;
      }, function(){ return null; });
      var rest=yrs.filter(function(y){ return cov.indexOf(y)<0; });
      return Promise.all([cellsP, national(rest)]).then(function(r){
        if(!r[0]) return national(yrs);
        var restBy={}; rest.forEach(function(y,i){ restBy[y]=r[1][i]; });
        return yrs.map(function(y){ return r[0][y] || restBy[y] || null; });
      });
    });
  }
  window.__fsHailInternals = { cellsNear:_hailCellsNear, filesNear:_hailFilesNear };
  function _hvsMi(a,b,c,d){ var R=3958.8,p=Math.PI/180,x=(c-a)*p,y=(d-b)*p,
    s=Math.sin(x/2)*Math.sin(x/2)+Math.cos(a*p)*Math.cos(c*p)*Math.sin(y/2)*Math.sin(y/2);
    return R*2*Math.atan2(Math.sqrt(s),Math.sqrt(1-s)); }

  // ── Radar hail swath verification (ported from hail-map.html) ───────
  // hail-map.html tests one pin against the MESH archive with pointInRing()
  // + maxBandAt() — a point-in-polygon walk. A field is a polygon, not a
  // pin, so the same ring test is extended here to a full boundary test:
  // the field's drawn edge intersects a swath cell if either shape has a
  // vertex inside the other, or an edge of one crosses an edge of the
  // other. pointInRing() itself is copied verbatim; maxBandAt()'s walk
  // over features/thresholds is the same, it just calls the new ring test.
  var meshIdxFS = null, meshCacheFS = {}, _meshFetching = false;
  var MESH_COLORS_FS = {0.75:'#7cd2ff', 1:'#fed976', 1.5:'#fd8d3c', 2:'#e31a1c'};
  function fetchMeshIndex(){
    if(meshIdxFS !== null || _meshFetching) return;
    _meshFetching = true;
    fetch('/data/hail/mesh/index.json').then(function(r){ return r.ok ? r.json() : null; })
      .then(function(ix){ meshIdxFS = (ix && ix.dates && ix.dates.length) ? ix : false; renderRisk(); })
      .catch(function(){ meshIdxFS = false; });
  }
  function _hmPointInRing(lat,lon,ring){
    var inside=false;
    for(var i=0,j=ring.length-1;i<ring.length;j=i++){
      var xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];
      if(((yi>lat)!==(yj>lat)) && (lon < (xj-xi)*(lat-yi)/(yj-yi)+xi)) inside=!inside;
    }
    return inside;
  }
  function _hmRingBbox(ring){
    var mnx=Infinity,mxx=-Infinity,mny=Infinity,mxy=-Infinity;
    for(var i=0;i<ring.length;i++){ var x=ring[i][0],y=ring[i][1];
      if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
    return {minLon:mnx,maxLon:mxx,minLat:mny,maxLat:mxy};
  }
  function _hmBboxHit(p,q){ return p.minLon<=q.maxLon && p.maxLon>=q.minLon && p.minLat<=q.maxLat && p.maxLat>=q.minLat; }
  function _hmSegXing(ax,ay,bx,by,cx,cy,dx,dy){
    function ccw(px,py,qx,qy,rx,ry){ return (ry-py)*(qx-px) - (qy-py)*(rx-px); }
    var d1=ccw(cx,cy,dx,dy,ax,ay), d2=ccw(cx,cy,dx,dy,bx,by);
    var d3=ccw(ax,ay,bx,by,cx,cy), d4=ccw(ax,ay,bx,by,dx,dy);
    return ((d1>0)!==(d2>0)) && ((d3>0)!==(d4>0));
  }
  // True boundary-to-boundary test: containment either way, or any edge crossing.
  // A bbox reject first, since almost every swath ring on a given day is nowhere
  // near a given field and shouldn't pay for the edge-crossing double loop.
  function _hmRingsCross(fieldRing, fieldBbox, swathRing){
    if(!_hmBboxHit(fieldBbox, _hmRingBbox(swathRing))) return false;
    var i;
    for(i=0;i<fieldRing.length;i++){ if(_hmPointInRing(fieldRing[i][1],fieldRing[i][0],swathRing)) return true; }
    for(i=0;i<swathRing.length;i++){ if(_hmPointInRing(swathRing[i][1],swathRing[i][0],fieldRing)) return true; }
    for(i=0;i<fieldRing.length;i++){
      var a=fieldRing[i], b=fieldRing[(i+1)%fieldRing.length];
      for(var k=0;k<swathRing.length;k++){
        var c2=swathRing[k], d2=swathRing[(k+1)%swathRing.length];
        if(_hmSegXing(a[0],a[1],b[0],b[1],c2[0],c2[1],d2[0],d2[1])) return true;
      }
    }
    return false;
  }
  // NOTE: only the exterior ring of each Polygon/MultiPolygon (mp[p][0]) is
  // tested. An interior ring (a hole — e.g. a coverage gap inside a merged
  // storm's swath) is never subtracted, so a field sitting in such a hole
  // would be reported as hit. MESH swath polygons haven't been observed to
  // carry holes in this archive, so this is a documented assumption, not an
  // oversight — revisit if a holed swath ever ships.
  function maxBandAtField(fieldRing, fc){
    var fieldBbox=_hmRingBbox(fieldRing), best=null;
    (fc.features||[]).forEach(function(f){
      var th=f.properties&&f.properties.thresh_in;
      if(th==null || (best!=null && th<=best)) return;
      var mp=f.geometry&&f.geometry.type==='MultiPolygon'?f.geometry.coordinates:
             (f.geometry&&f.geometry.type==='Polygon'?[f.geometry.coordinates]:[]);
      for(var p=0;p<mp.length;p++){
        if(mp[p][0] && _hmRingsCross(fieldRing, fieldBbox, mp[p][0])){ best=th; break; }
      }
    });
    return best;
  }
  function fsFieldRing(poly){ return latlngs(poly).map(function(p){ return [p.lng, p.lat]; }); }

  // Crop stage AT A PAST DATE, not "as of now" — estCornStage() below answers
  // the latter. This reads the same CORN_STAGES table against the season's
  // own day-by-day GDU accumulation (FIELD.season.gCumMap, built in
  // loadSeason()), so a hail day only gets a stage when this field's actual
  // weather record covers that date. No stage is invented for a date outside
  // what the weather archive has, or for a year other than the one on file.
  function stageAtDate(dateStr){
    var se = FSX.FIELD && FSX.FIELD.season;
    if(!se || !se.gCumMap || !thisYearCorn()) return null;
    var yr = +dateStr.slice(0,4), md = dateStr.slice(5);
    if(yr !== se.year) return null;
    if(md < se.plantMD) return { pre:true };
    var g = se.gCumMap[md];
    if(g == null) return null;
    var label='pre-emergence';
    for(var i=0;i<CORN_STAGES.length;i++){ if(g>=CORN_STAGES[i][0]) label=CORN_STAGES[i][1]; }
    return { label:label };
  }
  function runFieldSwathCheck(){
    if(!FSX.activePoly || !meshIdxFS || !meshIdxFS.dates || !FSX.FIELD || !FSX.FIELD.hail || FSX.FIELD.hail.err) return;
    var gen = FSX.fieldGen;
    FSX.FIELD.hail.swath = { running:true };
    renderRisk();
    ga('fs_hail_swath_check', {});
    var ring = fsFieldRing(FSX.activePoly);
    Promise.all(meshIdxFS.dates.map(function(d){
      if(meshCacheFS[d]) return Promise.resolve({d:d,fc:meshCacheFS[d]});
      return fetch('/data/hail/mesh/'+d+'.json').then(function(r){ return r.ok?r.json():null; })
        .then(function(fc){ if(fc) meshCacheFS[d]=fc; return {d:d,fc:fc}; })
        .catch(function(){ return {d:d,fc:null}; });
    })).then(function(daysArr){
      if(gen!==FSX.fieldGen || !FSX.FIELD || !FSX.FIELD.hail) return;   // a new field was drawn while this ran
      var hits=[], failed=0;
      daysArr.forEach(function(x){
        if(!x.fc){ failed++; return; }
        var b=maxBandAtField(ring, x.fc);
        if(b!=null) hits.push({d:x.d, band:b});
      });
      hits.sort(function(a,b){ return a.d<b.d?1:-1; });
      FSX.FIELD.hail.swath = { checked:meshIdxFS.dates.length-failed, failed:failed, hits:hits };
      renderRisk();
    });
  }
  function hailSwathHtml(){
    if(!FSX.FIELD || !FSX.FIELD.hail || FSX.FIELD.hail.err || !FSX.activePoly) return '';
    if(meshIdxFS===null || meshIdxFS===false) return '';
    var sw = FSX.FIELD.hail.swath;
    if(!sw){
      return '<div class="fs-swathcheck" id="fs-swathcheck">'+
        '<button type="button" class="fs-swath-btn" id="fs-swath-btn">Check radar hail swaths against this field’s drawn boundary '+
        '<small>('+meshIdxFS.dates.length+' storm days on file, since '+esc(ixDate(meshIdxFS.dates[0]))+' · a swath is NOAA’s radar-estimated hail footprint, not a confirmed report · may take a few seconds on a slow connection)</small></button></div>';
    }
    if(sw.running){
      return '<div class="fs-swathcheck" id="fs-swathcheck"><span class="fs-swath-status"><span class="fs-spin"></span>'+
        'Testing '+meshIdxFS.dates.length+' storm days against the field boundary…</span></div>';
    }
    var body;
    if(!sw.hits.length){
      body = '<strong>No radar-estimated hail ≥0.75″ crossed this field’s drawn boundary</strong> on any of the '+
        sw.checked+' storm day'+(sw.checked===1?'':'s')+' in the archive'+(sw.failed?' ('+sw.failed+' day'+(sw.failed===1?'':'s')+' couldn’t load)':'')+
        '. Nearby reports above may still be real: swaths are ~1 km radar estimates, and the archive starts '+esc(ixDate(meshIdxFS.dates[0]))+'.';
    } else {
      body = '<strong>'+sw.hits.length+' storm day'+(sw.hits.length===1?'':'s')+' put a radar-estimated hail swath across this field’s drawn boundary:</strong>'+
        sw.hits.map(function(h){
          var c=MESH_COLORS_FS[h.band]||'#fed976';
          var stage=stageAtDate(h.d), stageNote='';
          if(stage){
            var se0 = FSX.FIELD && FSX.FIELD.season;
            var plantHedge0 = se0 && se0.plantMD ? ' and a typical ~'+({'04-08':'Apr 8','04-18':'Apr 18','04-28':'Apr 28','05-05':'May 5'}[se0.plantMD]||se0.plantMD)+' planting' : '';
            stageNote = stage.pre
              ? ', before this field’s estimated planting window, so no corn was up yet'
              : ', <span class="fs-swath-stage">estimated corn stage at the time: '+esc(stage.label)+
                '</span> <span class="fs-approx">(approximate, modeled from temperature'+plantHedge0+', not field scouting)</span>';
          }
          return '<div class="fs-swath-hit"><span class="fs-swath-dot" style="background:'+c+'"></span>'+
            '<span class="fs-swath-date">'+esc(ixDate(h.d))+'</span>, inside the ≥'+h.band+'″ estimated band'+stageNote+
            ' <a href="/hail-map?swath='+h.d+'&lat='+FSX.FIELD.lat.toFixed(4)+'&lon='+FSX.FIELD.lng.toFixed(4)+'" target="_blank" rel="noopener" class="fs-act-link">view that day’s swath →</a></div>';
        }).join('')+
        '<div class="fs-src">Radar estimate (NOAA MRMS MESH, Maximum Estimated Size of Hail), not a ground measurement · MESH typically runs larger than stones measured on the ground · '+
        'tested against the field’s actual drawn boundary, not just its center point'+(sw.failed?' · '+sw.failed+' day'+(sw.failed===1?'':'s')+' could not be loaded':'')+'</div>';
    }
    return '<div class="fs-swathcheck" id="fs-swathcheck"><div class="fs-swath-out">'+body+'</div></div>';
  }
  document.addEventListener('click', function(e){
    var b=e.target && e.target.closest && e.target.closest('#fs-swath-btn'); if(!b) return;
    runFieldSwathCheck();
  });

  function loadHailData(c){
    var gen = FSX.fieldGen;
    fetchMeshIndex();
    var yNow = new Date().getFullYear();
    var yrs = [yNow-4, yNow-3, yNow-2, yNow-1, yNow];
    _hailFilesNear(c, yrs)
      .then(function(files){
        if(gen !== FSX.fieldGen) return;
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
        FSX.FIELD.hail = { events:events, days:Object.keys(days).length, dates:Object.keys(days).sort(), maxStone:maxStone, years:got.length };
        recomputeInsight(); renderRisk();
      })
      .catch(function(){
        if(gen!==FSX.fieldGen) return;
        // Event files unavailable — say so honestly rather than risk a false
        // "no hail nearby" from the worker route (which has silently returned
        // empty before). Unavailable ≠ zero.
        if(FSX.FIELD)FSX.FIELD.hail={err:1};
        renderRisk();
      });
  }

  function renderRisk(){
    if(!FSX.FIELD) return;
    var soil=FSX.FIELD.soil, hail=FSX.FIELD.hail, rot=FSX.FIELD.rotation, dr=FSX.FIELD.drought, se=FSX.FIELD.season;
    var rows=[];
    if(soil && soil.worst){
      var wc=soil.worst.nicc;
      var sv = wc<=2?'Low':wc<=4?'Moderate':wc<=6?'Elevated':'High';
      var sc = wc<=2?'#4aab4c':wc<=4?'#ffd400':wc<=6?'#ff9326':'#d9534f';
      rows.push(riskRow('Soil limitation', sv, sc, 'Most-limited ground covering a real share of the field is class '+wc+(soil.worst.sub||'')+(soilShare(soil)?' · '+soilShare(soil):'')));
    }
    if(soil && soil.slope!=null && soil.slope>=3){
      var sl=soil.slope, ev=sl<6?'Moderate':sl<12?'Elevated':'High', ec=sl<6?'#ffd400':sl<12?'#ff9326':'#d9534f';
      rows.push(riskRow('Erosion (slope)', ev, ec, sl+'% average slope'+(soil.maxSlope>sl?' · up to '+soil.maxSlope+'%':'')+', water-erosion exposure'));
    }
    if(hail && !hail.err){
      // report-days in a ~40-mile circle (about 5,000 sq mi): banded per year, and worded as reports
      // near the field, never as hail on "this ground" (panel 9/20: 47 days read as extreme everywhere)
      var hy = hail.days/(hail.years||5);
      var hv = hy<2?'Low':hy<5?'Moderate':hy<10?'Elevated':'High';
      var hc = hy<2?'#4aab4c':hy<5?'#ffd400':hy<10?'#ff9326':'#d9534f';
      var cst = FSX.FIELD.county&&FSX.FIELD.county.storms;
      rows.push(riskRow('Hail reports nearby', hv, hc,
        hail.days+' day'+(hail.days===1?'':'s')+' with a hail report within ~40 mi in '+(hail.years||5)+' yrs'+(hail.maxStone?' · largest '+hail.maxStone+'"':'')+(cst?' · county: '+cst.toFixed(1)+' days a year with 1"+ reports':'')+', reports follow people, so towns and highways count more',
        ' · <a href="/hail-map" target="_blank" rel="noopener" style="color:var(--brand,var(--gold))">see the national map &rarr;</a>'));
    }
    if(rot && rot.cornOnCorn){
      rows.push(riskRow('Rotation stress', rot.corOnCornYears>=3?'Elevated':'Moderate', rot.corOnCornYears>=3?'#ff9326':'#ffd400',
        (FSX.FIELD.thisYear.src==='you'?'Corn this year':'Likely corn this year')+' on corn last year'+(rot.corOnCornYears>=3?', '+rot.corOnCornYears+' years running':'')+', rootworm and a corn-on-corn yield drag'));
    }
    if(dr && dr.cat && dr.cat!=='None'){
      // D0 is "abnormally dry", not drought
      var d0 = dr.cat.indexOf('D0')>=0 && !/D[1-4]/.test(dr.cat);
      var dHi = dr.cat.indexOf('D3')>=0||dr.cat.indexOf('D4')>=0;
      rows.push(riskRow(d0?'Dryness':'Drought', d0?'Watch':dHi?'High':'Moderate',
        d0?'#c9a227':dHi?'#d9534f':'#ff9326', 'Currently '+dr.cat+(dr.approx?' (county-wide reading)':'')));
    }
    // Season rainfall deficit vs the 5-yr normal (independent of the USDM snapshot —
    // a field can be tracking dry before it shows up as a drought category).
    if(se && se.pDep <= -2){
      var md = se.pDep<=-5, mv = md?'High':'Elevated', mc = md?'#d9534f':'#ff9326';
      rows.push(riskRow('Moisture deficit', mv, mc, Math.abs(se.pDep).toFixed(1)+'″ below '+pLbl(se)+' at the county gauge, season to date'));
    }
    if(!rows.length){
      var resolved = (FSX.FIELD.soil!==null) && (FSX.FIELD.hail!==null);
      if(!resolved){ setBody('fs-risk','<div class="fs-loading"><span class="fs-spin"></span>assessing</div>'); return; }
      var note = (hail&&hail.err)
        ? 'No major risk flags surfaced from public data; hail history was unavailable.'
        : 'No major risk flags surfaced from public data for this field.';
      setBody('fs-risk','<div class="fs-src">'+note+'</div>');
      return;
    }
    setBody('fs-risk', rows.join('') + hailSwathHtml() +
      '<div class="fs-src" style="margin-top:.5rem">A starting risk read from public data, not an underwriting decision.</div>'+
      // Sig, Oct 29, 2026: his contact stays, but quiet: one small plain line, no button or arrow
      '<p class="fs-risk-ask" style="margin:.35rem 0 0;font-size:.78rem;color:var(--text-muted)">Questions about this read: <a href="mailto:sig@agsist.com" style="color:inherit">sig@agsist.com</a></p>');
  }
  function riskRow(label, level, color, detail, link){
    // Colorblind-safe: a symbol carries severity independent of color.
    // `detail` is always escaped (it carries upstream survey/bid text). `link` is an
    // optional, trusted HTML snippet appended after it — never user data.
    var mark = level==='Low'?'●':level==='Moderate'||level==='Watch'?'◐':level==='Elevated'?'◕':'■';
    return '<div class="fs-risk-row">'+
      '<div class="fs-risk-label">'+esc(label)+'<small>'+esc(detail)+(link||'')+'</small></div>'+
      '<span class="fs-risk-badge" style="background:'+hexA(color,.16)+';color:var(--text);border:1px solid '+hexA(color,.55)+'"><span aria-hidden="true" style="color:'+color+'">'+mark+'</span> '+esc(level)+'</span>'+
    '</div>';
  }

  // ── 5. CASH BIDS (our own elevator network, measured from the field) ──
  // 2026-10-29: our own data only, from the field's own point. The network (dnilgis/bids, read
  // in the browser by components/bids-network.js) is searched from the field center, so every
  // mile on the card is from this field, and no ZIP (no reverse geocode) is needed. If the
  // network does not answer, the committed /data/bids.json (the same network, this morning's
  // copy) fills in. The licensed Barchart feed and its proxy are gone: the feed is off
  // (STANDING-DECISIONS: "The Barchart feed is off"), and the call was already switched off
  // here on 2026-10-11.
  var FS_LEGAL = {llc:1,lc:1,inc:1,incorporated:1,co:1,corp:1,corporation:1,ltd:1,limited:1,lp:1,llp:1,company:1};
  function fsKey(name, city, state){
    var t = String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/co op/g,'coop').replace(/co operative/g,'cooperative').split(' ').filter(Boolean);
    while(t.length && FS_LEGAL[t[t.length-1]]) t.pop();
    var FOLD={bros:'brother',brothers:'brother',brother:'brother',st:'saint',mt:'mount',ft:'fort',farmers:'farmer',assn:'association',assoc:'association',elev:'elevator',elevators:'elevator'};
    t = t.map(function(x){ return (x==='cooperative'||x==='coops')?'coop':x; })
         .map(function(x){ return FOLD[x]||x; })
         .map(function(x){ return (x.length>3&&x.charAt(x.length-1)==='s')?x.slice(0,-1):x; });
    var pl=function(x){ return String(x||'').toLowerCase().replace(/[^a-z0-9]/g,''); };
    return t.join('')+'|'+pl(city)+'|'+pl(state);
  }
  // 'YYYY-MM' or 'YYYY-MM/YYYY-MM' -> first and last day, as the licensed feed writes them
  function fsPeriodDates(period){
    var parts = String(period||'').split('/'), s0 = parts[0], e0 = parts[1] || parts[0];
    var sm = /^(\d{4})-(\d{2})/.exec(s0), em = /^(\d{4})-(\d{2})/.exec(e0);
    if(!sm || !em) return { start:'', end:'' };
    var last = new Date(+em[1], +em[2], 0).getDate();
    return { start: sm[1]+'-'+sm[2]+'-01', end: em[1]+'-'+em[2]+'-'+(last<10?'0':'')+last };
  }
  function fsEnsureNet(){
    return new Promise(function(resolve){
      if(window.AGSIST_BIDS_NET) return resolve(window.AGSIST_BIDS_NET);
      var done=false; function fin(){ if(!done){ done=true; resolve(window.AGSIST_BIDS_NET||null); } }
      try{ var sc=document.createElement('script'); sc.src='/components/bids-network.js?v=8'; sc.async=true; sc.onload=fin; sc.onerror=fin; document.head.appendChild(sc); }catch(e){ return fin(); }
      setTimeout(fin, 3000);
    });
  }
  function fsEnsureNet(){
    return new Promise(function(resolve){
      if(window.AGSIST_BIDS_NET) return resolve(window.AGSIST_BIDS_NET);
      var done=false; function fin(){ if(!done){ done=true; resolve(window.AGSIST_BIDS_NET||null); } }
      try{ var sc=document.createElement('script'); sc.src='/components/bids-network.js?v=8'; sc.async=true; sc.onload=fin; sc.onerror=fin; document.head.appendChild(sc); }catch(e){ return fin(); }
      setTimeout(fin, 3000);
    });
  }
  // Each source resolves to {rows, ok}: ok false = could not be read at all. An empty answer
  // from a source that answered is ok.
  var FS_CROP_NAME={corn:'Corn',soybeans:'Soybeans',wheat:'Wheat'};
  var BID_MILES=75;
  function fsGroup(list){
    var by={}, order=[];
    list.forEach(function(r){
      var k = fsKey(r.facility, r.city, r.state);
      if(!by[k]){ by[k]={ company:r.facility, location:r.branch||'', city:r.town||r.city, state:r.state, distance:r.distance, _net:true, bids:[] }; order.push(k); }
      var pa=r.pricedAt||r.checkedAt||null;   // when this board's prices last changed (else last read)
      if(pa && (!by[k].posted || pa>by[k].posted)) by[k].posted=pa;
      var d = r.period ? fsPeriodDates(r.period) : { start:r.deliveryStart||'', end:r.deliveryEnd||'' };
      // The board's own label can be a code ("Yc", "Sww"); the crop key is what the network knows.
      var crop=r.crop||r.category, nm = r.commodity||'';
      if(FS_CROP_NAME[crop] && !/corn|soy|bean|wheat/i.test(nm)) nm = FS_CROP_NAME[crop];
      by[k].bids.push({ commodity:nm, cashprice:r.cashPrice,
        basis:(r.basisCents!=null ? r.basisCents : (r.basis!=null&&isFinite(r.basis) ? Math.round(r.basis*1000)/10 : null)),   // cents
        currency:'USD', delivery:r.delivery||'', delivery_start:d.start, delivery_end:d.end });
    });
    return order.map(function(k){ return by[k]; });
  }
  function fsFromNetwork(c){
    return fsEnsureNet().then(function(NET){
      if(!NET || typeof NET.snapshot!=='function') return {rows:[], ok:false};
      return NET.snapshot(c.lat, c.lng, { radiusMi: BID_MILES }).then(function(snap){
        if(!snap || !snap.bids){
          return (typeof NET.reachable==='function' ? NET.reachable() : Promise.resolve(true))
            .then(function(up){ return {rows:[], ok:!!up}; });
        }
        return {rows: fsGroup(snap.bids), ok:true, at:snap.fetched||null};
      });
    }).catch(function(){ return {rows:[], ok:false}; });
  }
  function fsMiles(a,b,c2,d){ var R=3958.8,p=Math.PI/180,x=(c2-a)*p,y=(d-b)*p,h=Math.sin(x/2)*Math.sin(x/2)+Math.cos(a*p)*Math.cos(c2*p)*Math.sin(y/2)*Math.sin(y/2); return 2*R*Math.asin(Math.min(1,Math.sqrt(h))); }
  // The committed copy: its rows carry their own lat/lon, so the miles are still from the field.
  function fsFromLocal(c){
    return getJSON('/data/bids.json', 20000).then(function(d){
      var rows=(d&&d.bids||[]).filter(function(r){ return r && isFinite(r.lat) && isFinite(r.lon) && r.verified!==false && (r.currency||'USD')==='USD'; })
        .map(function(r){ var o={}; for(var q in r) o[q]=r[q]; o.distance=Math.round(fsMiles(c.lat,c.lng,r.lat,r.lon)*10)/10; o.town=r.city||r.town; return o; })
        .filter(function(r){ return r.distance<=BID_MILES; })
        .sort(function(a,b){ return a.distance-b.distance; });
      return {rows: fsGroup(rows), ok:true, at:d&&d.fetched||null, local:true};
    }).catch(function(){ return {rows:[], ok:false}; });
  }
  function loadBids(c){
    var gen = FSX.fieldGen;
    fsFromNetwork(c)
      .then(function(x){ return (x.ok===false) ? fsFromLocal(c) : x; })
      .then(function(x){
        if(gen!==FSX.fieldGen) return;
        if(x.ok===false) throw new Error('no bid source reachable');   // say so; do not report "no elevators"
        renderBids({ results:x.rows, unitsResolved:true, local:!!x.local, at:x.at }, '', gen);
      })
      .catch(function(){ if(gen!==FSX.fieldGen) return; if(FSX.FIELD){ FSX.FIELD.bids={corn:null,bean:null,zip:'',count:0,err:1}; recomputeInsight(); } setErr('fs-bids','Couldn\u2019t reach the cash-bid feed just now.'); });
  }
  window.__fsBidsInternals = { fsKey:fsKey, fsPeriodDates:fsPeriodDates, fsGroup:fsGroup, fsFromLocal:fsFromLocal, loadBids:loadBids };
  function bidDate(v){ if(!v) return null; var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(v)); return m?new Date(+m[1],+m[2]-1,+m[3]):null; }
  function monthIdx(t){ var d=new Date(t); return d.getFullYear()*12+d.getMonth(); }
  var MON3=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function bidMon(b){
    var d=bidDate(b.delivery_start||b.deliveryStart);
    if(d) return MON3[d.getMonth()]+' \u2019'+String(d.getFullYear()).slice(2);
    var m=/^([A-Za-z]{3})(\d{2})$/.exec(b.deliveryMonth||''); return m?m[1]+' \u2019'+m[2]:'';
  }
  // "Oct 15", or "today", in Central time, the way the cash-bids pages print it.
  function postedDay(iso){
    var d=new Date(iso); if(!iso || isNaN(d)) return '';
    try{
      var o={month:'short', day:'numeric', timeZone:'America/Chicago'};
      var day=d.toLocaleDateString('en-US', o), today=new Date().toLocaleDateString('en-US', o);
      return day===today ? 'today' : day;
    }catch(e){ return ''; }
  }
  window.__fsPostedDay = postedDay;
  function renderBids(d, zip, gen){
    if(gen!==FSX.fieldGen) return;
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
            dEnd:bidDate(b.delivery_end||b.deliveryEnd), dStart:bidDate(b.delivery_start||b.deliveryStart), mon:bidMon(b),
            cur:String(b.currency||item.currency||'USD').toUpperCase(),
            cash:parseFloat(b.cashprice||b.cashPrice), basis:(b.basis!=null&&b.basis!=='')?parseFloat(b.basis):null,
            posted:item.posted||null });
        });
      } else if(item.commodity||item.commodityName||item.cashprice!==undefined||item.cashPrice!==undefined){
        flat.push({ elev:item.company||item.name||item.facility||item.locationName||'Elevator',
          city:item.city||'', dist:parseFloat(item.distance)||null,
          commodity:item.commodity||item.commodity_display_name||item.commodityName||'',
          delivery:item.delivery||item.deliveryStart||item.delivery_start||item.deliveryPeriod||'',
          dEnd:bidDate(item.delivery_end||item.deliveryEnd), dStart:bidDate(item.delivery_start||item.deliveryStart), mon:bidMon(item),
          cur:String(item.currency||'USD').toUpperCase(),
          cash:parseFloat(item.cashprice||item.cashPrice), basis:(item.basis!=null&&item.basis!=='')?parseFloat(item.basis):null });
      }
    });
    // Border ZIPs pull Ontario/Manitoba elevators quoting CAD. This page prints "$" and
    // multiplies by US county yields, so a CAD price would read as a US price. Leave them out.
    flat = flat.filter(function(x){ return !isNaN(x.cash) && x.cur==='USD'; }).sort(function(a,b){ return (a.dist||999)-(b.dist||999); });
    if(!flat.length){ if(FSX.FIELD){ FSX.FIELD.bids={corn:null,bean:null,zip:zip,count:0}; recomputeInsight(); } setBody('fs-bids','<div class="fs-src">No elevator in our network posts a cash bid within '+BID_MILES+' miles of this field right now. Coverage is densest across the Corn Belt and thins out elsewhere. <a href="/cash-bids" style="color:var(--brand,var(--gold))">Cash bids &rarr;</a></div>'); return; }
    // record best CONVENTIONAL corn & bean bid for the insight engine — specialty
    // bids (organic, food-grade, white, popcorn, seed, non-GMO) trade $2–8/bu over
    // conventional and must never headline as "cash corn". The full list below
    // still shows them; they just can't drive the metrics.
    var SPECIALTY=/organic|food|white|pop\b|popcorn|sweet|seed|screen|waxy|non.?gmo|specialty|premium|hi.?oil|high.?oil|nu.?gen|identity/i;
    // NEAREST DELIVERY ONLY. Elevators post a ladder of months; the highest number on the
    // ladder is usually a deferred month (April pays carry), not what the grain brings at
    // harvest. Each elevator contributes its nearest open window, and the best of those
    // headlines, labelled with its month.
    var today=new Date(); today.setHours(0,0,0,0);
    // An elevator's windows are compared by MONTH: a Sep 1-30 and a Sep 16-30 window are the
    // same delivery month, and the better price of the two is that elevator's September bid.
    function monOf(x){ return x.dStart ? monthIdx(x.dStart.getTime()) : Infinity; }
    function nearestPerElev(list){
      var by={};
      list.forEach(function(x){
        if(x.dEnd && x.dEnd<today) return;                      // window already closed
        var k=x.elev+'|'+(x.city||'');
        var cur=by[k], m=monOf(x), mc=cur?monOf(cur):Infinity;
        if(!cur || m<mc || (m===mc && x.cash>cur.cash)) by[k]=x;
      });
      return Object.keys(by).map(function(k){ return by[k]; });
    }
    function bestConv(re){
      var conv=flat.filter(function(x){ return re.test(x.commodity) && !SPECIALTY.test(x.commodity); });
      var near=nearestPerElev(conv);
      if(!near.length) return null;
      // Compare elevators on one month: the nearest month most of them quote (ties go to the
      // earlier). One elevator still posting September can't set the headline for a market
      // that has moved to October, and a January bid can't win on carry.
      var cnt={}; near.forEach(function(x){ var m=monOf(x); cnt[m]=(cnt[m]||0)+1; });
      var best=null; Object.keys(cnt).forEach(function(k){ var m=+k; if(best===null || cnt[k]>cnt[best] || (cnt[k]===cnt[best] && m<best)) best=m; });
      var pool=near.filter(function(x){ return monOf(x)===best; });
      if(!pool.length) pool=near;
      return pool.sort(function(a,b){ return b.cash-a.cash; })[0] || null;
    }
    var corn=bestConv(/corn/i);
    var bean=bestConv(/bean|soy/i);
    // the NEAREST elevator's own bid for each crop (its nearest delivery month): the first screen
    // shows this one, with its miles; the headline-best above still feeds the rent and gross lines
    function nearestConv(re){
      var near=nearestPerElev(flat.filter(function(x){ return re.test(x.commodity) && !SPECIALTY.test(x.commodity) && x.dist!=null; }));
      return near.sort(function(a,b){ return a.dist-b.dist; })[0] || null;
    }
    if(FSX.FIELD) { FSX.FIELD.bids = { corn:corn, bean:bean, nearCorn:nearestConv(/corn/i), nearBean:nearestConv(/bean|soy/i), zip:zip, count:flat.length }; recomputeInsight(); if(FSX.FIELD._rentRedraw) FSX.FIELD._rentRedraw(); }   // the rent card's gross line needs the bid
    var shown=(function(){
      var groups={}; flat.forEach(function(x){ var g=x.commodity.toLowerCase(); (groups[g]=groups[g]||[]).push(x); });
      var out=[]; Object.keys(groups).forEach(function(g){ out=out.concat(nearestPerElev(groups[g])); });
      return out.sort(function(a,b){ var sa=SPECIALTY.test(a.commodity)?1:0, sb=SPECIALTY.test(b.commodity)?1:0; return (sa-sb)||((a.dist||999)-(b.dist||999)); });
    })();
    if(!shown.length) shown=flat;
    // Barchart quotes basis in cents. Decide the unit once for the whole reply: only if every
    // basis is under 2 in size is the feed in dollars. (Per-row guessing turned -1.5 cents into -150.)
    var bs=flat.filter(function(x){ return x.basis!=null && !isNaN(x.basis); });
    var inDollars = !(d && d.unitsResolved) && bs.length>0 && bs.every(function(x){ return Math.abs(x.basis)<2; }) && bs.some(function(x){ return x.basis!==Math.round(x.basis); });
    var html = shown.slice(0,6).map(function(x){
      var bC = (x.basis!=null && !isNaN(x.basis)) ? (inDollars ? x.basis*100 : x.basis) : null;
      var bTxt = bC!=null ? (Math.abs(bC%1)>=0.05 ? Math.abs(bC).toFixed(1) : String(Math.round(Math.abs(bC)))) : '';
      var basis = bC!=null ? '<span class="fs-bid-basis" style="color:'+(bC>=0?'#4aab4c':'#d9534f')+'">'+(bC>=0?'+':'\u2212')+bTxt+'\u00a2</span>' : '';
      var dlv = x.mon ? ' · '+esc(x.mon)+' delivery' : (x.delivery ? ' · '+esc(String(x.delivery).slice(0,18)) : '');
      var pd=postedDay(x.posted);
      return '<div class="fs-bid-row"><div class="fs-bid-el">'+esc(x.commodity)+' <small>'+esc(x.elev)+(x.dist?' · '+Math.round(x.dist)+' mi':'')+dlv+(pd?' · posted '+esc(pd):'')+'</small></div>'+
        '<div style="text-align:right"><div class="fs-bid-px">$'+x.cash.toFixed(2)+'</div>'+basis+'</div></div>';
    }).join('');
    setBody('fs-bids', html +
      '<div class="fs-src" style="margin-top:.45rem">Each elevator\u2019s nearest delivery month. Later months usually pay more for storage; see them all on Cash Bids. Basis = cents vs the futures board. A less-negative basis than your area\u2019s usual means local demand is paying up; the strongest bid isn\u2019t always the highest cash number if hauling eats the spread.</div>'+
      '<div class="fs-src" style="margin-top:.4rem">Miles are from the middle of this field. AGSIST elevator network'+(d&&d.local?' (the copy saved '+esc(postedDay(d.at)||'today')+'; the live read did not answer)':'')+' · <a href="/cash-bids" style="color:var(--brand,var(--gold))">All cash bids &rarr;</a></div>');
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
    var gen=FSX.fieldGen;
    var pts=latlngs(poly);
    var ring=pts.map(function(p){ return [p.lng, p.lat]; });
    postJSON(FS_WORKER + '/indices', { ring: ring })
      .then(function(d){
        if(gen!==FSX.fieldGen) return;
        FSX.FIELD.indices = d;
        renderIndices(d);
        recomputeInsight();
        renderPassTimeline();   // if the vigor layer is already on, the replay fills in
      })
      .catch(function(){
        if(gen!==FSX.fieldGen) return;
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
    var last=pts[pts.length-1].split(',');
    // The normal is one number: this field's usual NDVI for TODAY's date. Drawn as a line across
    // April it read as "normal all season". It is a ring at the latest pass, with a short tick.
    var base = '';
    if(baseline!=null){
      var by=Y(baseline).toFixed(1), bx=(+last[0]).toFixed(1);
      base='<line x1="'+(bx-14)+'" y1="'+by+'" x2="'+bx+'" y2="'+by+'" stroke="rgba(132,160,168,.9)" stroke-width="1.5" stroke-dasharray="3 2"/>'+
           '<circle cx="'+bx+'" cy="'+by+'" r="4" fill="none" stroke="rgba(132,160,168,.95)" stroke-width="1.5"/>';
    }
    // endpoint value label — clamped inside the frame, anchored away from the right edge
    var endVal=ys[ys.length-1];
    var lx=Math.min(+last[0], w-30), ly=Math.max(10, Math.min(h-4, +last[1]-6));
    var endTxt='<text x="'+lx.toFixed(1)+'" y="'+ly.toFixed(1)+'" text-anchor="end" font-size="9" font-weight="700" fill="'+color+'" font-family="JetBrains Mono,monospace">'+endVal.toFixed(2)+'</text>';
    var svg='<svg class="fs-spark" viewBox="0 0 '+w+' '+h+'" aria-hidden="true" style="width:100%;height:auto;display:block">'+grid+base+
      '<polyline points="'+pts.join(' ')+'" fill="none" stroke="'+color+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'+
      '<circle cx="'+last[0]+'" cy="'+last[1]+'" r="3" fill="'+color+'"/>'+endTxt+'</svg>';
    var ax='<span class="fs-spark-ax" style="left:0;transform:none">'+ixDate(vals[0].date)+'</span>';
    // month labels keep clear of the first and last date labels (they ran together at 390 px: "May 10Jun")
    ticks.forEach(function(tk){ if(tk.frac>0.18 && tk.frac<0.82) ax+='<span class="fs-spark-ax" style="left:'+(tk.frac*100).toFixed(1)+'%">'+tk.label+'</span>'; });
    ax+='<span class="fs-spark-ax" style="left:auto;right:0;transform:none">'+ixDate(vals[vals.length-1].date)+'</span>';
    return svg+'<div class="fs-spark-axis">'+ax+'</div>';
  }

  // ── Crop-aware vigor language (v: fixes the "alfalfa after cutting reads as
  // failure" problem). Same thresholds don't mean the same thing on hay ground
  // that just got cut, wheat that's supposed to ripen brown, or grazed pasture. ──
  function fieldCropClass(){
    var r=FSX.FIELD&&FSX.FIELD.rotation, ty=FSX.FIELD&&FSX.FIELD.thisYear, c=(ty&&ty.code!=null)?ty.code:(r&&r.lastCrop);   // 0 = "Other", said on purpose
    if(c===36||c===37) return 'hay';                       // alfalfa, other hay
    if(c===23||c===24||c===21||c===28) return 'smallgrain'; // wheats, barley, oats
    if(c===176) return 'pasture';
    return 'row';
  }
  function grainRipening(){ var m=new Date().getMonth()+1; return m>=5&&m<=9; }  // May–Sep: southern winter wheat browns in May–Jun, northern grain Jul–Sep
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
      if(v>=0.3) return 'Regrowth building: normal after a cutting';
      return 'Low canopy, typical right after a cutting; the regrowth slope over the next passes is the health read';
    }
    if(cls==='pasture'){
      if(v>=0.6) return 'Lush, well-recovered sward';
      if(v>=0.45) return 'Good cover, actively growing';
      if(v>=0.3) return 'Recovering from grazing: watch the rebound';
      return 'Short cover: recently grazed or dormant';
    }
    if(cls==='smallgrain'&&grainRipening()&&v<0.45){
      return v>=0.3 ? 'Ripening down: a falling read is normal as the grain matures'
                    : 'Mature or harvested: brown is the goal at this stage, not a problem';
    }
    if(v>=0.6) return 'Healthy, closed canopy';
    if(v>=0.45) return 'Solid, actively growing canopy';
    if(v>=0.3) return 'Developing canopy: partial ground cover';
    return 'Low cover: bare ground, residue, or a very early stand';
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
    return '<div class="fs-idx"><span class="fs-idx-l">'+label+tipQ(label.toLowerCase())+'</span><span class="fs-idx-v">'+(val==null?'-':(+val).toFixed(2))+'</span><span class="fs-idx-w">'+w+'</span></div>';
  }

  // ── On-demand explainers: a (?) on any cryptic label opens a plain-language
  // popover. Clean until tapped — the page stays an instrument, not a textbook. ──
  var FS_TIPS = {
    acres:{t:'Acres',b:'Total area inside the boundary you drew.'},
    soil:{t:'Soil & productivity',b:'The dominant USDA soil map units under your field, ranked by share of acreage. Soil sets what the ground can yield and how it drains.'},
    nccpi:{t:'NCCPI',b:'USDA\u2019s National Commodity Crop Productivity Index, a 0\u20131 index for row-crop ground (shown \u00d7100 in the vitals strip). Higher is more productive soil. It\u2019s weighted toward Corn Belt soils, so strong regional ground can still score mid-scale.'},
    ndvi:{t:'NDVI \u00b7 crop vigor',b:'How much living, green canopy the satellite sees. Runs about 0 (bare or dead) to 0.9 (dense, healthy crop). The best single at-a-glance crop-health number.'},
    ndre:{t:'NDRE \u00b7 red-edge',b:'A red-edge index tied to leaf chlorophyll. Most useful after canopy close, when NDVI flattens out. A satellite greenness reading, not a nitrogen test: low chlorophyll has many causes, and only tissue or soil tests measure nitrogen.'},
    ndmi:{t:'NDMI \u00b7 canopy moisture',b:'Water held in the crop canopy. Higher means more moisture in the leaves; a drop can flag stress before you can see it.'},
    nmdi:{t:'NMDI \u00b7 moisture',b:'A drought index combining canopy and soil-water signals.'},
    msi:{t:'MSI \u00b7 moisture stress',b:'Moisture Stress Index. Higher means more water stress. It runs opposite to NDMI.'},
    ndwi:{t:'NDWI \u00b7 water',b:'Surface and canopy water content. Mildly negative over dry crop ground is normal.'},
    bsi:{t:'BSI \u00b7 bare soil',b:'Bare Soil Index. Higher means more exposed soil: early season, after harvest, or a thin stand.'},
    rotation:{t:'Crop rotation',b:'What grew here each year on record (up to a decade), from USDA\u2019s satellite-classified Cropland Data Layer. Continuous corn raises rootworm and disease pressure.'},
    drought:{t:'Drought',b:'US Drought Monitor category for this field, None through D4 (exceptional). D2 and worse means real moisture stress.'},
    slope:{t:'Slope',b:'Average ground slope across the field. Steeper ground carries more water-erosion exposure.'},
    basis:{t:'Nearest bid',b:'The nearest elevator in our network that posts a bid for this crop, its nearest delivery month, and how far it is from the middle of this field. Futures plus or minus local basis: the number you\u2019d actually get, not the board price.'},
    rain:{t:'Rain vs normal',b:'Rain since January 1 at this county\u2019s NOAA gauge, as a share of that gauge\u2019s 1991\u20132020 normal for the same days. The gauge and its miles from your field are on the Season card.'},
    patchy:{t:'Field uniformity',b:'How evenly vigor is spread across the field. A wide spread means part of the field is lagging, a zone worth walking.'},
    normal:{t:'Field normal',b:'This field\u2019s own NDVI averaged over the same window in prior years, the baseline that says whether this season is ahead or behind.'}
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
    var el=document.getElementById('fs-vitals'); if(!el||!FSX.FIELD) return;
    var s=FSX.FIELD.soil, r=FSX.FIELD.rotation, d=FSX.FIELD.drought, ix=FSX.FIELD.indices, b=FSX.FIELD.bids;
    var acres = FSX.FIELD.acres!=null ? (+FSX.FIELD.acres).toFixed(1) : null;
    var soilV = (s&&s.top&&s.top.name) ? esc(String(s.top.name).split(',')[0]) : null;
    var soilSub = s ? soilShare(s) : null;
    var nccpiV = (s&&s.nccpi!=null) ? Math.round(s.nccpi*100) : null;
    var v = ix ? ((ix.latest&&ix.latest.ndvi!=null)?ix.latest.ndvi:(ix.series&&ix.series.length?ix.series[ix.series.length-1].ndvi:null)) : null;
    var vigV = (v!=null) ? (+v).toFixed(2) : null;
    var vigSub = (v!=null) ? (FSX.FIELD._vigWord || vigorWord(v)) : null;   // same word as the vigor card
    var vigCls = (v!=null) ? (v>=0.6?'good':(v>=0.3?'mid':'low')) : '';
    var rotV=null, rotSub=null;
    if(r){
      if(r.codes && r.codes.length){
        rotV = r.codes.map(function(cd){ var m=(typeof CDL_CROPS!=='undefined')&&CDL_CROPS[cd]; return m?m.l.charAt(0):'\u00b7'; }).join('\u2009\u00b7\u2009');
      } else { rotV = r.cornOnCorn ? 'Corn' : 'Mixed'; }
      if(r.patternText) rotSub = r.pattern==='cs'?'corn\u2013soy':r.pattern==='ccs'?'corn\u2013corn\u2013soy':r.pattern==='continuous'?'continuous corn':'mixed';
    }
    var drV = d ? (d.cat==null ? '-' : (d.cat!=='None' ? esc(d.cat) : 'None')) : null;   // no answer is not "None"
    var drCls = (d && d.cat && /D[234]/.test(d.cat)) ? 'low' : '';
    var slV = (s&&s.slope!=null) ? s.slope+'%' : null;
    // the bid that matters is the crop in the field this year
    var beansNow = thisYearBeans();
    var bid = b ? (beansNow ? (b.nearBean||b.nearCorn) : (b.nearCorn||b.nearBean)) : null;
    var bidV, bidSub;
    if(!b){ bidV=null; bidSub=null; }                                    // still loading -> ...
    else if(bid && bid.cash!=null){ bidV='$'+(+bid.cash).toFixed(2); bidSub = (bid===b.nearBean?'beans':'corn')+' \u00b7 '+esc(bid.elev)+' \u00b7 '+Math.round(bid.dist)+' mi'; }
    else if(b.err){ bidV='-'; bidSub='feed didn\u2019t answer'; }     // a failed read is not "no elevator"
    else if(b.noZip){ bidV='-'; bidSub='no ZIP here'; }
    else { bidV='-'; bidSub='none nearby'; }                       // loaded, no elevator
    // FIRST SCREEN (2026-10-29): what a farmer checks first. Last year's crop, rain against
    // normal at the county gauge, the nearest elevator's bid with its miles; the county name
    // heads the readout.
    var lastY=null, lastV=null, lastSub=null;
    if(r && r.codes && r.codes.length){
      lastY=r.years[r.years.length-1]; var lc=r.codes[r.codes.length-1], lm=lc&&CDL_CROPS[lc];
      lastV = lm ? esc(lm.l) : 'Not a crop';
      lastSub = rotSub ? rotSub+' \u00b7 '+rotV : rotV;
    } else if(r===false || (r && !r.codes)) { lastV='-'; }
    var se=FSX.FIELD.season, rainV=null, rainSub=null;
    if(se===null || (se && se.pNow==null)){ rainV='-'; rainSub='no gauge record'; }
    else if(se){ rainV=(se.pct!=null?Math.round(se.pct)+'%':se.pNow.toFixed(1)+'\u2033'); rainSub='of normal since Jan 1'+(se.mi!=null?' \u00b7 gauge '+Math.round(se.mi)+' mi':''); }
    var cy=FSX.FIELD.county;
    var co=document.getElementById('fs-deck-co'); if(co) co.textContent = cy&&cy.name ? cy.name+' County, '+cy.abbr : '';
    renderPeek({acres:acres, nccpi:nccpiV, vig:vigSub, dr:(d?(d.cat==null?'no answer':(d.cat==='None'?'None':d.cat)):null), bid:bidV!=='-'?bidV:null, bidSub:bidSub,
      county:cy&&cy.name?cy.name+' County, '+cy.abbr:null, last:lastV, lastY:lastY, rain:rainV, rainSub:rainSub});
    el.innerHTML =
      vCell(lastY?lastY+' CROP':'LAST CROP', lastV, lastSub, 'rotation') +
      vCell('RAIN', rainV, rainSub, 'rain') +
      vCell('NEAREST BID', bidV, bidSub, 'basis') +
      vCell('DROUGHT', drV, (d&&d.cat==null?'no answer':(d&&d.approx?'county-wide':null)), 'drought', drCls) +
      vCell('PRODUCTIVITY', nccpiV, (nccpiV!=null?'/100 NCCPI':null), 'nccpi') +
      vCell('VIGOR', vigV, vigSub, 'ndvi', vigCls) +
      vCell('SOIL', soilV, soilSub, 'soil') +
      vCell('SLOPE', slV, null, 'slope');
  }
  function renderPeek(k){
    if(k) FSX._peek=k;
    var el=document.getElementById('fs-peek'); if(!el) return;
    if(!FSX.FIELD){ el.hidden=true; el.innerHTML=''; return; }
    var rd=FSX.FIELD.read||{}, P=FSX._peek;
    var v=rd.verdict ? '<b>Bottom line:</b> '+esc(rd.verdict.charAt(0).toUpperCase()+rd.verdict.slice(1))+'.' : 'Reading this field&hellip;';
    var waiting = FSX.FIELD.t0 && (Date.now()-FSX.FIELD.t0)<12000;   // after the hold, a gap is a gap, not "loading"
    function kv(k,val){ return '<div class="fs-peek-k"><span class="k">'+k+'</span><span class="v">'+(val!=null&&val!==''?val:(waiting?'&hellip;':'-'))+'</span></div>'; }
    var bidK = P.bid ? kv('Nearest bid', P.bid+(P.bidSub?' <small>'+P.bidSub.replace(/^(corn|beans) \u00b7 /,'')+'</small>':'')) : kv('Nearest bid', P.bidSub==='feed didn\u2019t answer'?'no answer':(P.bidSub?'-':null));
    el.innerHTML='<p class="fs-peek-v">'+v+'</p>'+
      (P.county?'<p class="fs-peek-co">'+esc(P.county)+'</p>':'')+
      kv(P.lastY?P.lastY+' crop':'Last crop', P.last)+kv('Rain vs normal', P.rain!=null?P.rain:null)+bidK+kv('Productivity', P.nccpi!=null?P.nccpi+'/100':null)+
      '<a class="fs-peek-go" href="#fs-results">Read the whole field &darr;</a>';
    el.hidden=false;
    document.documentElement.classList.add('fs-has-peek');
  }
  function ordinal(n){ n=Math.round(+n); var t=n%100, u=n%10; return n+((t>=11&&t<=13)?'th':u===1?'st':u===2?'nd':u===3?'rd':'th'); }
  function ixDate(s){ try{ return new Date(s+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric'}); }catch(e){ return s; } }
  function ixDaysAgo(s){ var n=Math.round((Date.now()-new Date(s+'T12:00:00Z').getTime())/864e5); return n<=0?'today':(n===1?'yesterday':n+' days ago'); }

  function renderIndices(d){
    var series=(d && d.series) || [];
    if(!series.length){
      setBody('fs-vigor','<div class="fs-caveat">No clear satellite pass for this field yet this season; clouds block the read. Check back after the next clear day, or toggle the <b>Crop vigor</b> map layer.</div>');
      return;
    }
    var last=d.latest || series[series.length-1];
    var nd=idxTrend(series,'ndvi'), moist=idxTrend(series,'ndmi');
    var v=nd?nd.now:null, vCol=vigorColor(v);
    var vTrend='';
    if(nd){ vTrend = nd.dir==='rising' ? ', still greening up' : (nd.dir==='easing' ? ', easing back from its '+ixDate(nd.peakDate)+' peak' : ', holding steady'); }
    var sd=last.ndvi_sd, varLine='';
    if(sd!=null && v!=null){ varLine = sd>=0.12 ? 'Vigor <b>varies across the field</b>: there\u2019s likely a weaker zone worth scouting.' : 'Vigor is <b>fairly uniform</b> across the field.'; }
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
      mLine='Canopy moisture is <b>'+md+'</b>'+(moist.dir==='easing'?', the stand is drying down compared with earlier in the season.':(moist.dir==='rising'?', the canopy is holding more water than before.':'.'));
    }
    // NDRE line — only meaningful once the canopy is dense enough that NDVI saturates
    var nLine='';
    var ndreT=idxTrend(series,'ndre');
    if(ndreT && v!=null && v>=0.55 && last.ndre!=null){
      var nWord=ndreT.dir==='easing'?'easing':(ndreT.dir==='rising'?'building':'steady');
      nLine='Red-edge chlorophyll signal (NDRE '+(+last.ndre).toFixed(2)+') is <b>'+nWord+'</b>'+(ndreT.dir==='easing'?' while the canopy holds, a pattern worth a tissue test for nitrogen.':', chlorophyll is tracking with the canopy.');
    }
    // Off-season (Nov–Mar) with a low canopy: the story is winter cover, not vigor.
    var winterHead=null;
    if(offSeason() && v!=null && v<0.3 && last.bsi!=null){
      var b2=+last.bsi;
      winterHead = b2>=0.1 ? {w:'Mostly bare ground', c:'var(--gold)', s:'Bare or tilled through winter; vigor picks back up with the next crop.'}
        : (b2>=0 ? {w:'Thin winter cover', c:'var(--gold)', s:'Some residue or thin cover holding through winter.'}
                 : {w:'Living winter cover', c:'var(--green)', s:'The satellite sees living cover through the off-season, a cover crop or perennial holding the ground.'});
    }
    var headWord = winterHead ? winterHead.w : ('Crop vigor: '+vigorWord(v));
    var headCol  = winterHead ? winterHead.c : vCol;
    var mNow=new Date().getMonth()+1;
    var dryDown = !winterHead && fieldCropClass()==='row' && mNow>=9 && mNow<=11 && nd && nd.dir==='easing' && nd.peak>=0.6;
    var harvested = dryDown && v!=null && v<0.3;
    if(harvested){
      headWord='Crop vigor: harvested or near bare'; headCol='var(--dim)';
    } else if(dryDown){
      // September on a row crop: a falling NDVI is the crop maturing. Saying "Developing" or
      // "Low" here reads as a problem. It isn't one.
      headWord='Crop vigor: drying down'; headCol='var(--gold,#d4a23f)';
    } else if(!winterHead && baseV!=null && v!=null && baseV-v>=0.06 && v>=0.45){
      // "Strong" next to "behind normal" contradicted itself; the comparison wins.
      headWord='Crop vigor: '+vigorWord(v).toLowerCase()+', behind normal'; headCol='var(--gold,#d4a23f)';
    }
    FSX.FIELD._vigWord = winterHead ? winterHead.w : headWord.replace(/^Crop vigor: /,'').replace(/^./,function(c){ return c.toUpperCase(); });
    var html=
      '<div class="fs-vigor-head">'+
        '<span class="fs-vigor-dot" style="background:'+headCol+'"></span>'+
        '<span class="fs-vigor-word">'+headWord+'</span>'+tipQ(winterHead?'bsi':'ndvi')+
        (v!=null?'<span class="fs-vigor-num">NDVI '+v.toFixed(2)+'</span>':'')+
      '</div>'+
      (nd?'<div class="fs-vigor-spark">'+sparkline(series,'ndvi',vCol,baseV)+'<span class="fs-spark-cap">vigor over the season'+(baseV!=null?' &middot; grey ring = this field\u2019s normal for the date':'')+'</span></div>':'')+
      '<p class="fs-vigor-say">'+(winterHead?winterHead.s:(harvested?'Down from a '+nd.peak.toFixed(2)+' peak on '+ixDate(nd.peakDate)+' to bare-ground levels: the crop is off or nearly so':dryDown?'Down from a '+nd.peak.toFixed(2)+' peak on '+ixDate(nd.peakDate)+'. On a row crop this late, that is the canopy maturing and browning, which is what should happen before harvest':vigorSentence(v)+vTrend)+'.')+'</p>'+
      (normLine?'<p class="fs-vigor-say">'+normLine+'</p>':'')+
      (varLine?'<p class="fs-vigor-say">'+varLine+'</p>':'')+
      (mLine?'<p class="fs-vigor-say">'+mLine+'</p>':'')+
      (nLine?'<p class="fs-vigor-say">'+nLine+'</p>':'')+
      '<div class="fs-vigor-fresh"><svg class="fs-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> Last clear pass <b>'+ixDate(last.date)+'</b> ('+ixDaysAgo(last.date)+') </div>'+
      (series.length>=2?'<a href="#" class="fs-god-link fs-replay-btn" data-god="ndvi"><svg class="fs-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg> Replay '+series.length+' passes on the map: watch the season</a>':'')+
      '<details class="fs-vigor-more"><summary>Show all indices for the latest pass</summary>'+
        '<div class="fs-vigor-grid">'+
          idxChip('NDVI',last.ndvi,'vigor')+idxChip('NDRE',last.ndre,'red-edge')+idxChip('NDMI',last.ndmi,'moisture')+
          idxChip('MSI',last.msi,'stress')+idxChip('NDWI',last.ndwi,'water')+idxChip('BSI',last.bsi,'bare soil')+
        '</div>'+
        '<div class="fs-src">Verdict words are rough guides; the right value shifts with crop and growth stage. Tap ? on any index for what it measures.</div>'+
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
  function getJSON(url, ms){ return fetchT(url, ms||15000).then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); }); }
  // ONE reverse geocode per field. The bids card and the county cards used to ask
  // Nominatim twice for the same point (its policy is one request a second).
  // Reverse geocodes, one per purpose per field. The county comes from a zoom-8 lookup (the
  // county AREA holding the point); zoom 18 snaps to the nearest road, and county lines are
  // often roads. The ZIP needs zoom 18. Each is cached for the field.
  var _rev={};
  function geoRev(c, zoom){
    zoom=zoom||18;
    var k='z'+zoom;
    if(_rev.gen!==FSX.fieldGen) _rev={gen:FSX.fieldGen};   // a new field drops the last field's lookups
    if(_rev[k]) return _rev[k];
    var p=fetchT(NOMINATIM_REV+'?format=jsonv2&zoom='+zoom+'&addressdetails=1&lat='+c.lat.toFixed(5)+'&lon='+c.lng.toFixed(5), 10000)
      .then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); });
    _rev[k]=p;
    p.catch(function(){ if(_rev[k]===p) delete _rev[k]; });   // a later call can retry
    return p;
  }
  // County names never agree across sources: OSM says "DeKalb County", NASS says "De Kalb";
  // "St. Louis", "St Louis", "Saint Louis"; "Ste Genevieve"; parishes; Virginia's cities.
  // Compare on letters only, with every saint spelled one way and the suffix dropped.
  function normCty(n){
    var t=String(n||'');
    try{ t=t.normalize('NFD').replace(/[\u0300-\u036f]/g,''); }catch(e){}
    t=t.toLowerCase().replace(/\b(city and borough|county|parish|borough|census area|municipality|municipio)\b/g,' ');
    t=t.replace(/\b(saint|sainte|ste\.?|st\.?)\s/g,'st ');
    // "city" stays: Virginia's Richmond city and Richmond County are different places.
    t=t.replace(/^\s*city of\s+(.+)$/,'$1 city');
    return t.replace(/[^a-z]/g,'');
  }
  // Last resort when the name still doesn't match: which county polygon holds the point.
  // Only fetched when needed (it is the Atlas's own boundary file, 2 MB; cached after).
  var _geoCo=null;
  function fipsByPoint(c, abbr){
    if(!_geoCo){ _geoCo=getJSON('/data/atlas/counties.geo.json', 30000); _geoCo.catch(function(){ _geoCo=null; }); }
    return _geoCo.then(function(g){
      if(!g||!g.features) return null;
      function inRing(r){ var x=c.lng,y=c.lat,ins=false; for(var i=0,j=r.length-1;i<r.length;j=i++){ var xi=r[i][0],yi=r[i][1],xj=r[j][0],yj=r[j][1]; if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi)) ins=!ins; } return ins; }
      function inPoly(p){ if(!inRing(p[0])) return false; for(var h=1;h<p.length;h++){ if(inRing(p[h])) return false; } return true; }
      var hit=null;
      g.features.some(function(f){
        if(abbr && f.properties && f.properties.st && f.properties.st!==abbr) return false;
        var gm=f.geometry; if(!gm) return false;
        var polys=gm.type==='Polygon'?[gm.coordinates]:gm.type==='MultiPolygon'?gm.coordinates:[];
        if(polys.some(inPoly)){ hit={fips:String(f.id), name:f.properties&&f.properties.name, st:f.properties&&f.properties.st}; return true; }
        return false;
      });
      return hit;
    });
  }
  // THE COUNTY COMES FROM OUR OWN BOUNDARIES FIRST (2026-10-29). It used to wait on a Nominatim
  // reverse geocode, so when that one outside service was slow or blocked, six cards (rent,
  // parcel and sales, the county record, selling, who farms, statewide) all failed together,
  // even though the point-in-county code below was already here. Now the county is the
  // polygon in the Atlas's own boundary file (/data/atlas/counties.geo.json, the file the land
  // card reads too) that holds the field center; Nominatim is asked only if that file does
  // not load or the point falls in no county (offshore, Canada, a sliver the simplified lines
  // miss).
  var A2N={}; Object.keys(N2A).forEach(function(n){ A2N[N2A[n]]=n; });
  function countyStart(gen, c, cty, abbr, stFull, fips, via){
    FSX.FIELD.county = { name:cty, st:stFull, abbr:abbr, fips:fips||null, via:via };
    var co=document.querySelector('#fs-results .coords');
    if(co) co.textContent='center '+c.lat.toFixed(4)+', '+c.lng.toFixed(4)+' · '+cty+' County, '+stFull;
    try{ if(typeof FSX.onCounty==='function') FSX.onCounty(FSX.FIELD.county); }catch(e){}
    loadRentCard(gen, abbr, cty, stFull);
    loadMarketCard(gen, abbr, stFull);
    loadHoodCard(gen, abbr, cty, stFull);
    loadCondCard(gen, abbr, stFull);
    recomputeInsight();
  }
  function loadCounty(c){
    var gen = FSX.fieldGen;
    fipsByPoint(c, null).then(function(h){
      if(gen!==FSX.fieldGen) return;
      var abbr=h&&h.st, stFull=abbr&&A2N[abbr];
      if(h&&h.name&&stFull){ countyStart(gen, c, h.name, abbr, stFull, h.fips, 'boundary'); return; }
      countyByNominatim(c, gen);
    }, function(){ if(gen===FSX.fieldGen) countyByNominatim(c, gen); });
  }
  function countyByNominatim(c, gen){
    var ERR_ALL = 'Couldn’t pin down the county for this spot right now: the county boundary file did not load and the place lookup did not answer. Redraw in a minute and they usually load.';
    geoRev(c, 8)
      .then(function(d){
        if(gen!==FSX.fieldGen) return;
        var ad=(d&&d.address)||{};
        var iso=/^US-([A-Z]{2})$/.exec(ad['ISO3166-2-lvl4']||'');
        var stFull=ad.state, abbr=N2A[stFull]||(iso&&iso[1]);
        // Virginia's independent cities carry no county in OSM; NASS lists them as "X City".
        var cty=(ad.county||(abbr==='VA'&&ad.city?ad.city+' City':'')).replace(/\s+(County|Parish|Borough|Census Area)$/i,'');
        if(!abbr||!cty){ ['fs-rent','fs-market','fs-hood','fs-cond','fs-atlas'].forEach(function(id){ setErr(id, 'This spot didn’t resolve to a US county; the county and state layers only cover the fifty states.'); }); return; }
        countyStart(gen, c, cty, abbr, stFull, null, 'nominatim');
      })
      .catch(function(){ if(gen!==FSX.fieldGen) return; ['fs-rent','fs-market','fs-hood','fs-cond','fs-atlas'].forEach(function(id){ setErr(id, ERR_ALL); }); });
  }
  function loadRentCard(gen, abbr, cty, stFull){
    getJSON('/data/cash-rent/'+abbr+'.json').then(function(d){
      if(gen!==FSX.fieldGen) return;
      var want=normCty(cty), wantF=FSX.FIELD&&FSX.FIELD.county&&FSX.FIELD.county.fips;
      var rec=(wantF&&(d.counties||[]).find(function(x){ return String(x.fips)===String(wantF); }))||(d.counties||[]).find(function(x){ return normCty(x.name)===want; });
      if(!rec){
        setErr('fs-rent','NASS publishes no county rent survey for '+esc(cty)+', small samples get suppressed rather than guessed.');
        // The Atlas card doesn't need rent; find the county by its boundary instead.
        if(wantF){ atlasCard(gen, wantF); return; }
        if(FSX.FIELD&&FSX.FIELD.lat!=null) fipsByPoint({lat:FSX.FIELD.lat,lng:FSX.FIELD.lng}, abbr).then(function(h){
          if(gen!==FSX.fieldGen) return;
          if(h){ if(FSX.FIELD.county) FSX.FIELD.county.fips=h.fips; atlasCard(gen, h.fips); }
          else setErr('fs-atlas','Couldn’t place this point in a county boundary.');
        }, function(){ if(gen===FSX.fieldGen) setErr('fs-atlas','The county boundary file did not load, so the county record can’t be shown. Redraw in a minute.'); });
        return;
      }
      if(FSX.FIELD.county) FSX.FIELD.county.fips = rec.fips;
      atlasCard(gen, rec.fips);
      atlasCounty(rec.fips).then(function(ad){ if(gen!==FSX.fieldGen) return; rentCard(rec, ad); if(FSX.FIELD) FSX.FIELD._rentRedraw=function(){ if(gen===FSX.fieldGen) rentCard(rec, ad); }; });
    }).catch(function(){ if(gen===FSX.fieldGen) setErr('fs-rent','County rent data didn’t load; refresh in a minute.'); });
    function rentCard(rec, ad){
      var ni=rec.rent&&rec.rent.nonirr||{};
      var yrs=Object.keys(ni).map(Number).sort(function(a,b){return a-b;});
      if(!yrs.length){ setErr('fs-rent','No non-irrigated rent series for '+esc(cty)+' County in the NASS survey.'); return; }
      var last=yrs[yrs.length-1], val=ni[last];
      var last10=yrs.slice(-10), avg=last10.reduce(function(s,y){return s+ni[y];},0)/last10.length;
      var cornY=rec.yield&&rec.yield.corn;
      var html=bigline('$'+Math.round(val), 'gold', '/ac non-irrigated · '+last, '');
      html+=cbar('county rent vs its own '+last10.length+'-yr average, $/ac', val, avg, '$', true);
      html+='<div class="fs-cbar-cap">center tick = '+esc(cty)+' Co’s own average ($'+Math.round(avg)+') · red = pricier than usual</div>';
      // THE COUNTY YIELD IS THE ATLAS'S: the last five published years, high and low dropped. The
      // Atlas, its county sheet and this report now print one number for a county; before, this
      // card printed the /cash-rent trend (Story IA 3.9 bu/yr) while the sheet printed another.
      var lv=recentLevel(ad&&ad['yield']);
      var bid=FSX.FIELD.bids&&FSX.FIELD.bids.corn?FSX.FIELD.bids.corn.cash:null;
      var yl=null, ylab='';
      if(lv){ yl=lv.avg; ylab='County corn, recent level: <strong>'+lv.avg.toFixed(1)+' bu/ac</strong> ('+lv.from+'–'+lv.to+', high and low year dropped)'; }
      else if(cornY&&cornY.trend){ yl=Math.round(cornY.trend); ylab='County corn trend: <strong>'+yl+' bu/ac</strong>'+(cornY.last!=null?' (recent county average: '+cornY.last+' bu)':''); }
      /* SAME PRACTICE, OR NO SHARE -- 2026-10-06, same rule as /cash-rent. This divided
         NON-IRRIGATED rent by the county's all-practice corn yield, which in an irrigated
         county is mostly irrigated corn, so the dryland share read far too low (Finney KS:
         4.3%). Use the dryland trend when the data carries one; use the all-practice level
         only where the county shows no irrigation at all; otherwise say why there is none. */
      var pt=rec.pair&&rec.pair.corn&&rec.pair.corn.t, ylShare=null, shareWhy='';
      var irrSeen=!!((rec.rent&&rec.rent.irr&&Object.keys(rec.rent.irr).length)||(rec.yield&&rec.yield.corn_irr&&rec.yield.corn_irr.hist&&Object.keys(rec.yield.corn_irr.hist).length));
      if(pt&&pt.v!=null&&pt.b==='nonirr'){ ylShare=pt.v; shareWhy=' (county dryland corn trend, '+Math.round(pt.v)+' bu)'; }
      else if(pt&&pt.v!=null&&pt.b==='all'){ ylShare=yl; }
      else if(!pt&&!irrSeen){ ylShare=yl; }
      if(yl){
        var bm=FSX.FIELD.bids&&FSX.FIELD.bids.corn&&FSX.FIELD.bids.corn.mon;
        var money = !bid ? '' : ylShare
          ? ' At $'+bid.toFixed(2)+' nearby corn'+(bm?' ('+bm+' delivery)':'')+', a corn year grosses $'+Math.round(ylShare*bid).toLocaleString('en-US')+'/ac'+shareWhy+' and rent takes '+Math.round(val/(ylShare*bid)*100)+'% of it.'
          : ' Rent share not shown: this county\u2019s corn yield mixes irrigated and dryland acres, so dividing dryland rent by it would understate the share.';
        html+='<p class="fs-cline">'+ylab+'.'+money+' <a class="fs-act-link" href="/cash-lease?st='+abbr+'" target="_blank" rel="noopener">Run this lease in Cash Lease &rarr;</a></p>';
      }
      html+=csrc('USDA NASS county cash-rent survey and county corn yield · '+esc(cty)+' County, '+esc(stFull)+' · missing years = never surveyed, not zero');
      FSX.FIELD.county.rent={ val:val, year:last, avg:Math.round(avg), level:lv, trend:!lv&&cornY&&cornY.trend?Math.round(cornY.trend):null, lastYield:!lv&&cornY?cornY.last:null };
      setBody('fs-rent', html); recomputeInsight();
    }
  }
  // ── The county's long record, from the same file the Farmland Atlas and its county sheet print ──
  var ATLAS_CO={};
  function atlasCounty(fips){
    if(!fips) return Promise.resolve(null);
    if(!ATLAS_CO[fips]) ATLAS_CO[fips]=getJSON('/data/atlas/counties/'+fips+'.json').catch(function(){ return null; });
    return ATLAS_CO[fips];
  }
  // the Atlas's recent yield level, same rule: five years ending at the county's newest, four needed, high and low dropped
  function recentLevel(y){
    if(!y||y.status!=='ok'||!y.hist||!y.last_year) return null;
    var last=y.last_year, yrs=[]; for(var k=last-4;k<=last;k++) if(y.hist[k]!=null) yrs.push(k);
    if(yrs.length<4 || last < new Date().getFullYear()-3) return null;     // the Atlas drops a series last published 4+ years back
    var v=yrs.map(function(k){ return y.hist[k]; }).sort(function(a,b){ return a-b; }).slice(1,-1);
    return { avg:v.reduce(function(a,b){ return a+b; },0)/v.length, from:last-4, to:last, n:yrs.length };
  }
  function atlasRows(d){
    var rows=[], ok=function(x){ return x&&x.status==='ok'; }, n0=function(x){ return Math.round(x).toLocaleString('en-US'); };
    var V=d.value, Y=d['yield'], S=d.sob, Lo=d.loss, Dr=d.drought, Cl=d.climate, Fr=d.frost, St=d.storms, W=d.water, Pr=d.practices, C=d.crp, H=d.heat, Wl=d.wells, Lv=d.livestock;
    if(ok(V)&&V.latest!=null) rows.push(['Land and buildings, '+V.latest_year+' census', '$'+n0(V.latest)+'/ac',
      V.flag?'read with care: the census value moved far off the counties next door':(V.change&&V.change.pct!=null?(V.change.pct>=0?'+':'')+V.change.pct.toFixed(1)+'% since '+V.change.from_year:'operators’ own estimate')]);
    if(ok(Y)) rows.push(['Corn yield, '+Y.first_year+'–'+Y.last_year+' median', Y.median.toFixed(1)+' bu/ac', 'worst year '+Y.worst.year+' at '+Math.round(Y.worst.share_of_median*100)+'% of median']);
    if(ok(S)&&S.last10&&S.last10.loss_cost!=null) rows.push(['Crop insurance claims per $100 of coverage', '$'+(S.last10.loss_cost*100).toFixed(2), S.last10.from+'–'+S.last10.to+(S.loss_ratio_all!=null?'; loss ratio since '+S.first_year+' '+S.loss_ratio_all.toFixed(2):'')]);
    if(ok(Lo)&&Lo.share_all){ var NM={heat_drought:'heat and drought',wet:'excess moisture',hail:'hail',wind:'wind',cold:'cold',irrigation:'irrigation failure',price:'price decline',unassigned:'area plans',other:'other'};
      var top=Object.keys(Lo.share_all).filter(function(k){ return Lo.share_all[k]!=null; }).sort(function(a,b){ return Lo.share_all[b]-Lo.share_all[a]; })[0];
      if(top) rows.push(['Largest cause of crop insurance payouts', NM[top]||top, Math.round(Lo.share_all[top]*100)+'% of dollars paid, '+Lo.first_year+'–'+Lo.last_year]); }
    if(ok(Dr)&&Dr.weeks&&Dr.weeks.share_d2_pct!=null){ var drm=(function(Dr){if(Dr.missing_years)return Dr.missing_years.map(Number);var s=Dr.series||{},o=[];if(!Dr.first_year||!Dr.last_full_year||!Dr.series)return o;for(var y=+Dr.first_year;y<=+Dr.last_full_year;y++){if(!s[y]||s[y].maps<40)o.push(y);}return o;})(Dr);
      rows.push(['Weeks in severe drought or worse', Math.round(Dr.weeks.share_d2_pct)+'%', 'of weeks since '+Dr.first_year+' with half the county in D2+'+(drm.length?' ('+drm.join(', ')+' left out, incomplete in the Atlas copy)':'')]); }
    if(ok(Cl)&&Cl.gs_normal_in!=null) rows.push(['April–September rain, normal', Cl.gs_normal_in.toFixed(1)+' in', (Cl.gs_recent&&Cl.gs_recent.pct_of_normal!=null?'last ten seasons '+Cl.gs_recent.pct_of_normal+'% of normal; ':'')+'1991–2020']);
    if(ok(Fr)&&Fr.frost_free_days&&Fr.frost_free_days.median!=null) rows.push(['Frost-free days, median', (Fr.frost_free_days.at_least?'at least ':'')+Fr.frost_free_days.median,
      ((Fr.last_spring_freeze||{}).median||'')+' to '+((Fr.first_fall_freeze||{}).median||'')+(Fr.gdd?'; corn GDD '+n0(Fr.gdd.median):'')+'; county-average lows']);
    if(ok(St)) rows.push(['Hail 1 inch or larger, county reports', St.hail_1in_days_per_year.toFixed(1)+' days a year', St.from+'–'+St.to+'; reports, not storms']);
    if(ok(H)&&H.months&&H.months.jul&&H.months.jul.recent) rows.push(['July nights, average low', H.months.jul.recent.mean.toFixed(1)+' °F', H.months.jul.recent.from+'–'+H.months.jul.recent.to]);
    if(ok(W)&&W.irrigated_share_2022&&W.irrigated_share_2022.share!=null) rows.push(['Harvested cropland irrigated', Math.round(W.irrigated_share_2022.share*100)+'%', '2022 census']);
    if(ok(Pr)&&Pr.tile&&Pr.tile.share!=null&&Pr.tile.share>=0.005) rows.push(['Cropland drained by tile', Math.round(Pr.tile.share*100)+'%', '2022 census']);
    if(ok(C)&&C.latest&&C.latest.acres) rows.push(['CRP enrolled', n0(C.latest.acres)+' ac', C.expiring_next3?n0(C.expiring_next3.acres)+' ac expire FY'+C.expiring_next3.from+'–'+C.expiring_next3.to:String(C.latest.year)]);
    if(ok(Wl)&&(Wl.irrigation_wells!=null||Wl.irrigation_active!=null)) rows.push(['Irrigation wells on the state register', n0(Wl.irrigation_wells!=null?Wl.irrigation_wells:Wl.irrigation_active), Wl.depth_median_ft!=null?'median depth '+n0(Wl.depth_median_ft)+' ft':'']);
    if(ok(Lv)&&Lv.cattle&&Lv.cattle.value!=null) rows.push(['Cattle and calves', n0(Lv.cattle.value)+' head', '2022 census']);
    return rows;
  }
  function atlasCard(gen, fips){
    if(!fips||!FSX.FIELD||!FSX.FIELD.county||FSX.FIELD.county.atlasFips===fips) return;
    FSX.FIELD.county.atlasFips=fips;
    atlasCounty(fips).then(function(d){
      if(gen!==FSX.fieldGen) return;
      if(!d){ setErr('fs-atlas','The county’s Farmland Atlas record didn’t load; refresh in a minute.'); return; }
      var rows=atlasRows(d);
      FSX.FIELD.county.atlas={ fips:fips, rows:rows };
      if(d.storms&&d.storms.status==='ok'&&d.storms.hail_1in_days_per_year!=null){ FSX.FIELD.county.storms=+d.storms.hail_1in_days_per_year; renderRisk(); }
      var html=rows.length?rows.map(function(r){ return '<p class="fs-cline">'+esc(r[0])+': <strong>'+esc(r[1])+'</strong>'+(r[2]?' <span style="opacity:.8">· '+esc(r[2])+'</span>':'')+'</p>'; }).join('')
        :'<div class="fs-err">The Atlas publishes no county figures here yet.</div>';
      html+='<p class="fs-cline"><a class="fs-act-link" href="/farmland-atlas#'+fips+'" target="_blank" rel="noopener">Full county record on the Farmland Atlas &rarr;</a> &nbsp; <a class="fs-act-link" href="/farmland-atlas/sheet#'+fips+'" target="_blank" rel="noopener">Printable county sheet &rarr;</a></p>';
      html+=csrc('County-wide figures, the same ones the Farmland Atlas prints · the field sections above are this field alone');
      setBody('fs-atlas', html);
    });
  }
  function loadMarketCard(gen, abbr, stFull){
    Promise.all([
      getJSON('/data/transport/basis.json').catch(function(){ return null; }),
      getJSON('/data/storage/storage.json').catch(function(){ return null; })
    ]).then(function(res){
      if(gen!==FSX.fieldGen) return;
      var b=res[0], st=res[1], html='', got=false;
      var isBeans = thisYearBeans();
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
          html+=cbar(esc(stFull)+' '+crop+' basis vs its own 5-yr normal, $/bu', Math.round(s.latest*100)/100, Math.round(s.avg5*100)/100, '$', false);   // rounded first, so the bar's gap matches the two printed numbers
          html+='<div class="fs-cbar-cap">center tick = normal for this week ('+(s.avg5>=0?'+$':'−$')+Math.abs(s.avg5).toFixed(2)+') · as of '+esc(s.date||'')+'</div>';
          FSX.FIELD.county.basis={ latest:s.latest, avg5:s.avg5, dev:dev, crop:crop, date:s.date };
        }
      }
      if(st&&st.states&&st.states[abbr]&&st.states[abbr].ratio){
        var ra=st.states[abbr].ratio, ys=Object.keys(ra).map(Number).sort(function(a,c){return a-c;});
        var ly=ys[ys.length-1], r=ra[ly];
        var since=null; for(var i=ys.length-2;i>=0;i--){ if(ra[ys[i]]>=r){ since=ys[i]; break; } }
        got=true;
        var pct=Math.round(r*100);
        html+='<p class="fs-cline">'+(pct>=90?'Storage pressure is part of the picture: ':'')+esc(stFull)+'’s '+ly+' crop filled <strong>'+pct+'% of every bin in the state</strong>'+(since&&pct>=85?', tightest since '+since:'')+'.'+(pct>=90?' Weak basis pays you to have your own steel.':'')+' <a class="fs-act-link" href="/grain-bin-calculator" target="_blank" rel="noopener">Bin math &rarr;</a></p>';
        FSX.FIELD.county.storage={ ratio:r, year:ly, since:since };
      }
      if(!got){ setErr('fs-market','No AgTransport basis series or storage figures published for '+esc(stFull)+', USDA tracks a limited set of states.'); return; }
      html+=csrc('USDA AgTransport weekly basis · NASS grain stocks &amp; production · state-level, not your elevator');
      setBody('fs-market', html); recomputeInsight();
    });
  }
  function loadHoodCard(gen, abbr, cty, stFull){
    // One state's slice of the national tenure and AFIDA files (scripts/build_field_scout_data.py),
    // records unchanged: about 30 KB instead of 1.4 MB.
    getJSON('/data/field-scout/county/'+encodeURIComponent(abbr)+'.json').catch(function(){ return null; }).then(function(sl){
      if(gen!==FSX.fieldGen) return;
      var t=sl&&sl.tenure, a=sl&&sl.afida, html='', got=false;
      var fips=FSX.FIELD.county&&FSX.FIELD.county.fips;
      function findByName(obj){ var hit=null; if(!obj) return null;
        Object.keys(obj).some(function(k){ var v=obj[k]; if(v&&normCty(v.n)===normCty(cty)&&(v.st===abbr||v.st===stFull)){ hit={k:k,v:v}; return true; } return false; });
        return hit; }
      // FS-TENYEAR-BEGIN
      // latest census with BOTH parts published: a (D) half would read as 100% or 0% rented
      // (Wakulla FL 2022 is [null, 2384]: owned suppressed)
      function tenureYear(y){ var ys=Object.keys(y||{}).filter(function(k){ var p=y[k]; return !!(p&&p.length===2&&p[0]!=null&&p[1]!=null&&p[0]+p[1]>0); }).map(Number).sort(function(a,b){return a-b;});
        return ys.length?ys[ys.length-1]:null; }
      // FS-TENYEAR-END
      var trec = t&&t.counties ? (fips&&t.counties[fips]?{k:fips,v:t.counties[fips]}:findByName(t.counties)) : null;
      var denom=null;
      if(trec){
        var ly=tenureYear(trec.v.y), pair=ly!=null?trec.v.y[ly]:null;   // [owned, rented]
        if(pair){
          got=true;
          var owned=pair[0], rented=pair[1]; denom=owned+rented;
          var pct=Math.round(rented/denom*100);
          if(!fips){ fips=trec.k; if(FSX.FIELD.county) FSX.FIELD.county.fips=fips; }
          atlasCard(gen, fips);
          html+=bigline(pct+'%','blue','rented ground','');
          html+='<p class="fs-cline">'+esc(cty)+' Co farms rent <strong>'+Math.round(rented).toLocaleString('en-US')+' of '+Math.round(denom).toLocaleString('en-US')+' acres</strong> ('+ly+' census)'+(pct>=60?', landlord country, and rents show it.':'.')+'</p>';
          FSX.FIELD.county.tenure={ pct:pct, rented:rented, total:denom, year:ly };
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
          html+='<p class="fs-cline">Foreign owners hold <strong>'+Math.round(ac).toLocaleString('en-US')+' ac</strong> in this county'+(share!=null?' ('+share+'% of farmland)':'')+' as of '+aly+'. '+chips+' <a class="fs-act-link" href="/farmland-atlas#foreign" target="_blank" rel="noopener">Who owns the ground &rarr;</a></p>';
          FSX.FIELD.county.afida={ acres:ac, year:aly, share:share };
        }
      }
      if(!fips&&!(FSX.FIELD.county&&FSX.FIELD.county.fips)) setErr('fs-atlas','Couldn’t match '+esc(cty)+' County to a county code, so its long record can’t be shown.');
      if(!got){ setErr('fs-hood','No census tenure or AFIDA rows published for '+esc(cty)+' County; suppressed small-sample counties stay blank rather than estimated.'); return; }
      html+=csrc('USDA Census of Agriculture (owned vs rented-from-others) · USDA AFIDA foreign-holdings filings');
      setBody('fs-hood', html); recomputeInsight();
    });
  }
  function loadCondCard(gen, abbr, stFull){
    Promise.all([
      getJSON('/data/conditions/conditions.json').catch(function(){ return null; }),
      getJSON('/data/cond-yield/fit.json').catch(function(){ return null; })
    ]).then(function(res){
      if(gen!==FSX.fieldGen) return;
      var c=res[0], f=res[1];
      var isBeans = thisYearBeans();
      var haveSoy = c&&c.crops&&c.crops.soybeans;
      var cropKey = (isBeans&&haveSoy)?'soybeans':'corn', cropWord = cropKey;
      var cc=c&&c.crops&&c.crops[cropKey];
      var srow=cc&&cc.states&&cc.states[abbr];
      if(!srow){ setErr('fs-cond','NASS doesn’t rate '+esc(cropWord)+' weekly in '+esc(stFull)+' (or under 10 comparable years); thin samples aren’t ranked.'); return; }
      var wcls = srow.pctile>=60?'green':srow.pctile<=30?'red':'gold';
      var html=bigline(Math.round(srow.ge)+'%', wcls, 'Good–Excellent', wcls);
      html+='<p class="fs-cline">'+esc(stFull)+' '+cropWord+' sits in the <strong>'+ordinal(srow.pctile)+' percentile</strong> for this week since 2000 (best '+Math.round(srow.best)+', worst '+Math.round(srow.worst)+').</p>';
      var wk=cc.week_ending?isoWeek(cc.week_ending):null;
      var fr=f&&f.crops&&f.crops[cropKey]&&f.crops[cropKey].states&&f.crops[cropKey].states[abbr];
      var r2 = fr&&wk!=null&&fr.weeks&&fr.weeks[wk] ? fr.weeks[wk].r2 : null;
      if(r2!=null){
        html+='<p class="fs-cline">From the record: this week’s ratings historically explain <strong>~'+Math.round(r2*100)+'% of final yield</strong>, '+(r2<0.35?'the crop is still being made':'ratings are starting to mean something')+'. <a class="fs-act-link" href="/conditions#crop-size" target="_blank" rel="noopener">What ratings are worth &rarr;</a></p>';
      }
      html+=csrc('USDA NASS weekly crop condition · week of '+esc(cc.week_ending||'')+' · state-level, ranked against the same week 2000–present');
      FSX.FIELD.county.cond={ ge:srow.ge, pctile:srow.pctile, week:cc.week_ending, r2:r2, crop:cropWord };
      setBody('fs-cond', html); recomputeInsight();
    });
  }

  function recomputeInsight(){
    if(!FSX.FIELD) return;
    renderVitals();
    var s=FSX.FIELD.soil, r=FSX.FIELD.rotation, w=FSX.FIELD.weather, d=FSX.FIELD.drought, b=FSX.FIELD.bids, h=FSX.FIELD.hail, se=FSX.FIELD.season;
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
      return { label:label, toPollen:toPollen, daysToPollen: toPollen>0?Math.round(toPollen/GDU_PER_DAY):0, pastPollen: g>=POLLEN_GDU, dent: g>=2190, mature: g>=2700 };
    }
    // this year's crop: what the farmer said, else the rotation pattern; never last year's map
    var isCorn = thisYearCorn();
    var cornSure = !!(FSX.FIELD.thisYear && FSX.FIELD.thisYear.src==='you');
    // Stage GDUs count from a latitude-banded planting proxy (se.gPlant), not Jan 1.
    var cropStage = (se && se.gPlant!=null && isCorn) ? estCornStage(se.gPlant) : null;
    function pollenWindow(){ return cropStage && !cropStage.pastPollen ? cropStage.daysToPollen : null; }
    // Late season: corn at dent or later, or any row crop from September on. A canopy that
    // is drying down is doing its job, and rain or nitrogen no longer changes the yield
    // (panel 9/20: the Read called normal September senescence stress).
    var mon=new Date().getMonth()+1;
    var lateSeason = (cropStage && cropStage.dent) || (mon>=9 && mon<=11 && fieldCropClass()==='row');
    function pacePhrase(){
      if(!se||se.gDep==null) return null;
      var dd=Math.abs(Math.round(se.gDep/GDU_PER_DAY));
      if(se.gDep>=100) return 'running about '+dd+' day'+(dd===1?'':'s')+' ahead of the '+se.n+'-year average (at a typical midsummer pace)';
      if(se.gDep<=-100) return 'running about '+dd+' day'+(dd===1?'':'s')+' behind the '+se.n+'-year average (at a typical midsummer pace)';
      return 'tracking close to the '+se.n+'-year average pace';
    }

    // Depth #3 (dollars + a Monday action): translate a corn-on-corn yield drag into a
    // $/ac range using THIS field's nearest cash corn bid, then point at the presell
    // tool. Honest: the bu/ac range is from university continuous-corn trial work, not
    // this field's measured yield — so it's framed as an estimate.
    function dragAction(loBu, hiBu){
      if(!b || !b.corn) return null;
      var p=b.corn.cash, lo=Math.round(loBu*p), hi=Math.round(hiBu*p);
      return 'At <strong>$'+p.toFixed(2)+'</strong> nearby cash corn, a '+loBu+'–'+hiBu+' bu/ac drag is roughly <strong>$'+lo+'–$'+hi+'/ac</strong> left on the table. '
        + '<a href="/harvest-price-tracker#presell" target="_blank" rel="noopener" class="fs-act-link">Run the presell math &rarr;</a>'
        + '<span class="fs-src">est. from university continuous-corn trial ranges &times; your local bid</span>';
    }

    // ── Headline: the field's fundamental character (soil × rotation) ──
    if(s && s.top){
      var headSoil = (s.farmPct!=null ? s.farmPct+(s.farmIfPct||0)>=70 : s.primePct!=null && s.primePct>=70) ? (s.farmPct!=null&&s.farmPct<70?'mostly prime farmland once drained':s.farmPct!=null?'mostly prime farmland':'mostly class 1\u20132 ground (few limits)')
        : (s.worst && s.worst.nicc>=5) ? 'mixed ground with some marginal acres'
        : 'solid, workable ground';
      lines.push('This '+FSX.FIELD.acres.toFixed(0)+'-acre field is <strong>'+headSoil+'</strong>, led by '+esc(s.top.name)+'.');
    }

    // ── Where the crop likely is right now (depth #3) ──
    if(cropStage){
      var plantHedge = se && se.plantMD ? ' and a typical ~'+({'04-08':'Apr 8','04-18':'Apr 18','04-28':'Apr 28','05-05':'May 5'}[se.plantMD]||se.plantMD)+' planting' : '';
      var cornIf = cornSure ? '' : 'If this field is in corn this year, ';
      function cap(t){ return t.charAt(0).toUpperCase()+t.slice(1); }
      var stg = cropStage.mature
        ? cap(cornIf+'corn is likely at or past black layer (R6): yield is set, and the questions now are dry-down, harvest timing and the bid.')
        : cropStage.dent
        ? cap(cornIf+'corn is likely at dent (R5): most of the yield is made, and the canopy drying from here is normal.')
        : cropStage.pastPollen
        ? cap(cornIf+'corn is likely past pollination and filling grain, the weeks that set final yield.')
        : (cropStage.toPollen<=50
            ? cap(cornIf+'corn is at or entering pollination, the single most weather-sensitive window of the year.')
            : cap(cornIf+'that heat-unit pace puts development around <strong>'+cropStage.label+'</strong>, roughly '+cropStage.daysToPollen+' day'+(cropStage.daysToPollen===1?'':'s')+' from pollination at a typical midsummer pace.'));
      var pp=pacePhrase();
      lines.push(stg+(pp?' The season is '+pp+'.':'')+' <span class="fs-approx">(approximate, modeled from temperature'+plantHedge+', not field scouting)</span>');
    } else if(se && se.gDep!=null && Math.abs(se.gDep)>=100){
      var pp2=pacePhrase(); if(pp2) lines.push('Heat-unit accumulation is '+pp2+' this season.');
    }

    var nFix='. Soybeans in the rotation would also credit roughly 30–40 lb N/ac to next year\u2019s corn';

    // ── corn-on-corn × soil (the highest-value cross-reference) ──
    if(s && s.worst && r && r.cornOnCorn){
      if(s.worst.nicc>=4){
        push({ sev:5, act:true, topic:'rotation', tag:'continuous corn on your class-'+s.worst.nicc+' ground',
          title:'break the rotation on your class-'+s.worst.nicc+' acres: it\u2019s the change most likely to pay on this field',
          detail:'Your weaker ground (class '+s.worst.nicc+') is '+(cornSure?'in':'likely in')+' <strong>corn on corn this year</strong>'+(r.corOnCornYears>=3?' ('+r.corOnCornYears+' years running)':'')+', two strikes against yield in the same spot. A rotation break there is the change most likely to pay on this field'+nFix+'.',
          action: dragAction(5,12),
          watch: pollenWindow()!=null ? 'Rootworm feeding shows at silking (~'+pollenWindow()+' days out); pull and check roots before then.' : 'Scout roots for rootworm before pollination, and plan beans on these acres next year.' });
      } else {
        var productive = s.nccpi!=null && s.nccpi>=0.55;
        push({ sev:productive?4:3, act:true, topic:'rotation', tag:'corn-on-corn pressure',
          title: r.pattern==='ccs' ? 'second-year corn this season: scout rootworm and budget the drag' : 'plan a rotation break to stop the corn-on-corn yield drag'+(productive?' on this productive ground':''),
          detail:(cornSure?'Corn':'On its rotation, likely corn')+' this year on corn last year. '+'Second-year corn carries rootworm and nitrogen pressure'+(r.pattern==='ccs'?'; it is part of a planned corn\u2013corn\u2013soybean rotation, so weigh the drag against the rotation\u2019s other gains':', worth a rotation break before it compounds'+nFix)+'.',
          action: dragAction(5, 15),   // one range for every soil: trials (Gentry 2013, Seifert 2017) find the drag largest on weaker, drier ground, not productive ground
          watch: pollenWindow()!=null ? 'Rootworm pressure peaks near silking (~'+pollenWindow()+' days out); scout this season; plan beans next.' : 'Scout for rootworm this season; plan beans on these acres next year.' });
      }
    } else if(r && r.cornOnCorn){
      push({ sev:3, act:true, topic:'rotation', tag:'a multi-year corn streak',
        title:'plan a rotation break and scout for rootworm',
        detail:(cornSure?'Corn':'Likely corn')+' this year on corn last year'+(r.corOnCornYears>=3?' (<strong>'+r.corOnCornYears+' years running</strong>)':'')+', watch for rootworm and the corn-on-corn yield drag'+nFix+'.',
        action: dragAction(5,10),
        watch: pollenWindow()!=null ? 'Rootworm pressure peaks near silking (~'+pollenWindow()+' days out).' : null });
    }

    // ── NCCPI context on its own (descriptive, national scale) ──
    if(s && s.nccpi!=null && !(r && r.cornOnCorn)){
      if(s.nccpi>=0.65){
        var favors=(s.nccpiCorn!=null && s.nccpiSoy!=null && Math.abs(s.nccpiCorn-s.nccpiSoy)>=0.05)
          ? ' For row crops, the index runs a touch higher for '+(s.nccpiCorn>s.nccpiSoy?'corn':'soybeans')+' on this ground.':'';
        // good news is part of the read, not something to "keep an eye on"
        lines.push('The soil scores <strong>'+Math.round(s.nccpi*100)+'/100</strong> on USDA\u2019s national productivity index (NCCPI '+s.nccpi.toFixed(2)+'), upper tier: what limits yield here is mostly what you manage.'+favors);
      } else if(s.nccpi<0.3){
        push({ sev:2, act:false, topic:'soil', tag:null,
          title:'NCCPI '+s.nccpi.toFixed(2)+' nationally: match yield goals and inputs to what this soil reliably returns',
          detail:'On USDA\u2019s <strong>national</strong> index this rates NCCPI '+s.nccpi.toFixed(2)+', the lower end of a scale weighted heavily by Corn Belt ground. In its own region this can still be solid.'+' <span class="fs-src">source: USDA NCCPI, a national 0–1 productivity index</span>', watch:null });
      }
    }

    // ── Drought (acute) ──
    var inDrought = d && d.cat && d.cat!=='None' && (d.cat.indexOf('D2')>=0||d.cat.indexOf('D3')>=0||d.cat.indexOf('D4')>=0);
    if(inDrought){
      push({ sev:4, act:true, topic:'moisture', tag:esc(d.cat)+' drought',
        title:'moisture is the acute variable right now; prioritize it',
        detail:'Currently in <strong>'+esc(d.cat)+'</strong>, the field is under real moisture stress.',
        watch: (pollenWindow()!=null && pollenWindow()<=21) ? 'Drought through pollination (~'+pollenWindow()+' days out) is the worst-timed stress there is. That window sets kernel count.' : 'Watch soil moisture closely into the next rain.' });
    }

    // ── Season rain × GDU (skip a second moisture stressor if already in drought) ──
    if(se && lateSeason && se.pDep<=-2){
      lines.push('The season ran '+Math.abs(se.pDep).toFixed(1)+'\u2033 drier than '+pLbl(se)+' at the county gauge; this late, rain no longer changes this year\u2019s crop, but it sets the soil profile for next spring.');
    } else if(se){
      var dryEnough=se.pDep<=-2, wetEnough=se.pDep>=2, hot=se.gDep>=100, cool=se.gDep<=-100;
      if(dryEnough && hot && !inDrought){
        push({ sev:4, act:true, topic:'moisture', tag:'a widening rain deficit',
          title:'the crop is developing fast into a moisture deficit. Watch it closely',
          detail:'Rain is <strong>'+Math.abs(se.pDep).toFixed(1)+'″ below</strong> '+pLbl(se)+' while GDUs run '+Math.round(se.gDep)+' ahead of the '+se.n+'-year average: fast development into a drying profile.',
          watch: pollenWindow()!=null ? 'The next 2–3 weeks toward pollination (~'+pollenWindow()+' days out) are when a deficit bites hardest.' : 'A timely rain over the next two weeks matters most.' });
      } else if(dryEnough && !inDrought){
        push({ sev:3, act:false, topic:'moisture', tag:'a dry start',
          title:'the field is starting dry: keep an eye on moisture',
          detail:'Season-to-date rain is <strong>'+Math.abs(se.pDep).toFixed(1)+'″ below</strong> '+pLbl(se)+'.',
          watch:'Watch the forecast; a return to normal rainfall still recovers this.' });
      } else if(wetEnough && cool){
        lines.push('A wet, cool start: rain '+se.pDep.toFixed(1)+'″ above '+pLbl(se)+' and GDUs '+Math.round(se.gDep)+' behind, so development is running slow.');
      } else if(wetEnough){
        lines.push('Rain is running '+se.pDep.toFixed(1)+'″ above '+pLbl(se)+' so far this season.');
      }
    }

    // ── Satellite vigor × soil × the field's own normal (the fused read) ──
    var ix=FSX.FIELD.indices;
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
      if(lateSeason && ixV!=null && cropCls==='row'){
        lines.push('The satellite shows the canopy '+(ixTr&&ixTr.dir==='easing'?'drying down':'holding')+' (NDVI '+ixV.toFixed(2)+(belowNorm!=null?', '+(belowNorm<-0.05?'below':belowNorm>0.05?'above':'close to')+' this field\u2019s other years at this date':'')+'). This late in the season that is maturity, not stress; what moves money now is harvest timing and the bid.');
      } else if(belowNorm!=null && belowNorm<=normTrig && !(cropCls==='smallgrain'&&grainRipening())){
        push({ sev: ixPrime?4:3, act:true, topic:'vigor', tag:'a canopy running below its own normal',
          title: ixPrime ? 'the satellite says this capable ground is underperforming its own history. Go look'
                          : 'crop vigor is running below this field\u2019s normal, worth a scout',
          detail:(ixPrime?'This is capable ground, yet ':'')+'the latest cloud-free pass reads NDVI <strong>'+ixV.toFixed(2)+'</strong>, about <strong>'+Math.abs(belowNorm).toFixed(2)+' below</strong> this field\u2019s '+nrmYrs+'normal for this point in the season. '+(cropCls==='hay'?'On hay ground a fresh cutting explains this. If you haven\u2019t cut recently, something is holding the stand back.':'Something on the ground is holding the canopy back.')+' <span class="fs-src">source: Sentinel-2 / Copernicus, cloud-masked</span>',
          watch: ixPatchy ? 'It\u2019s also uneven across the field: start with the weakest zone (<a href="#" class="fs-god-link" data-god="ndvi">the Crop-vigor map layer shows where</a>).'
                          : 'Scout for stand, nutrient, or moisture problems while there\u2019s still time to react.' });
      } else if(ixPatchy && ixV!=null){
        push({ sev:2, act:true, topic:'vigor', tag:'an uneven canopy',
          title:'the canopy is uneven across the field; scout the weak zone',
          detail:'Satellite vigor varies noticeably across this field (averaging NDVI '+ixV.toFixed(2)+', but spread out around it): usually a drainage, compaction, or stand issue in one area.'+' <span class="fs-src">source: Sentinel-2 / Copernicus</span>',
          watch:'Walk the lowest-vigor corner; <a href="#" class="fs-god-link" data-god="ndvi">the map\u2019s Crop-vigor layer</a> points to it.' });
      } else if(ixV!=null && ixV>=0.6 && (belowNorm==null || belowNorm>=-0.03)){
        lines.push('The satellite backs this up: canopy vigor is <strong>strong</strong> (NDVI '+ixV.toFixed(2)+')'+(belowNorm!=null?', tracking '+(belowNorm>0.03?'above':'right at')+' its own normal for the date':'')+(ixTr&&ixTr.dir==='easing'?', easing back from its peak as you\u2019d expect for the stage':'')+'.');
      }
      if(inDrought && ixTr && ixTr.dir==='easing' && ixV!=null){
        lines.push('The drought is already showing in the canopy: vigor has been easing on recent passes.');
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
          push({ sev:3, act:true, topic:'nitrogen', tag:'a fading red-edge signal under a full canopy',
            title:'the red-edge chlorophyll signal is fading while the canopy holds. A tissue test for N before the window closes would tell',
            detail:'The canopy itself is holding (NDVI '+ixV.toFixed(2)+'), but the red-edge chlorophyll signal (NDRE) has been <strong>easing on recent passes</strong>: the pattern that shows up when chlorophyll thins under a closed canopy. It is a satellite pattern, not a tissue test, but it matches what a nitrogen shortfall looks like from above.'+' <span class="fs-src">source: Sentinel-2 red-edge (NDRE), cloud-masked</span>',
            watch: pollenWindow()!=null ? 'Pollination (~'+pollenWindow()+' days out) sets kernel count; a tissue or soil nitrate check before then still leaves time to sidedress or Y-drop.' : 'A tissue or soil nitrate check confirms it either way; the satellite can only point.' });
        }
      }

      // (b) Moisture convergence — two independent calculations agreeing beats either alone.
      if(enoughPasses && !lateSeason){
        var mT=idxTrend(ix.series,'ndmi'), sT=idxTrend(ix.series,'msi');
        if(mT && sT && mT.dir==='easing' && sT.dir==='rising'){
          var mSev = inDrought ? 4 : ((se && se.pDep!=null && se.pDep<=-2) ? 3 : 2);
          push({ sev:mSev, act:mSev>=3, topic:'moisture', tag:'a canopy drying on two independent reads',
            title: mSev>=4 ? 'the canopy is drying on every read; moisture is the story on this field'
                           : 'two independent satellite reads agree the canopy is drying',
            detail:'Canopy moisture (NDMI) is <strong>falling</strong> and the moisture-stress index (MSI) is <strong>rising</strong> across recent passes: two separate calculations from different light bands telling the same story. When they agree like this, the drying is likely real.'+(inDrought?' It lines up with the '+esc(d.cat)+' drought status.':'')+' <span class="fs-src">source: Sentinel-2 NDMI + MSI, cloud-masked</span>',
            watch: pollenWindow()!=null && pollenWindow()<=21 ? 'Moisture stress through pollination (~'+pollenWindow()+' days out) is the worst-timed stress there is.' : 'Watch the rain forecast; a timely inch changes this read fast.' });
        }
      }

      // (c′) Pass-drop × hail correlation — a sharp vigor drop between passes that
      // brackets a reported hail day is the "how did it know that" read. Factual
      // only: the dates line up; walking it and documenting is the action.
      var hl=FSX.FIELD.hail;
      if(hl && !hl.err && hl.dates && hl.dates.length && ix.series.length>=2){
        var sArr=ix.series.filter(function(r){ return r.ndvi!=null; });
        for(var hp=sArr.length-1; hp>=1; hp--){
          var drop=sArr[hp-1].ndvi - sArr[hp].ndvi;
          if(drop<0.06) continue;
          var d0=sArr[hp-1].date, d1=sArr[hp].date;
          var hits=hl.dates.filter(function(hd){ return hd>d0 && hd<=d1; });
          if(hits.length){
            push({ sev:3, act:true, topic:'hail', tag:'a vigor drop that lines up with reported hail',
              title:'the '+ixDate(d1)+' vigor drop lines up with a reported hail day; walk it and document',
              detail:'Vigor fell <strong>'+drop.toFixed(2)+'</strong> between the '+ixDate(d0)+' and '+ixDate(d1)+' passes, and a severe-hail report near this field is dated <strong>'+ixDate(hits[0])+'</strong>, inside that window'+(hl.maxStone?' (stones up to '+hl.maxStone+'\u2033 reported in the area over 5 yrs)':'')+'. The timing lines up; only boots in the field confirm it.'+' <span class="fs-src">source: Sentinel-2 pass-to-pass + NOAA/IEM storm reports</span>',
              watch:'Walk it soon and photograph what you find: dated satellite passes plus dated photos make a clean record for any claim conversation with your own agent or adjuster.' });
            break; // one correlation is the story; don't stack duplicates
          }
        }
      }

      // (c) Drown-out read — very wet surface + uneven canopy in a wet season.
      if(ixLast.ndwi!=null && ixLast.ndwi>=0.2 && ixPatchy && se && se.pDep!=null && se.pDep>=2){
        push({ sev:2, act:true, topic:'wet', tag:'saturated ground in the weak zones',
          title:'the wet spots are likely drowning the weak zones; walk the low ground',
          detail:'The surface-water read (NDWI '+(+ixLast.ndwi).toFixed(2)+') is running <strong>very wet</strong>, the season is '+se.pDep.toFixed(1)+'\u2033 above '+pLbl(se)+' on rain, and vigor is uneven across the field: the classic drowned-low-spot signature.'+(s&&s.poorDrainPct!=null&&s.poorDrainPct>=25?' The soil survey agrees: <strong>'+s.poorDrainPct+'%</strong> of this ground maps as poorly drained.':'')+' <span class="fs-src">source: Sentinel-2 NDWI + Open-Meteo season rainfall</span>',
          watch:'Check the low corners; <a href="#" class="fs-god-link" data-god="ndvi">the Crop-vigor layer</a> shows which zones are lagging.' });
      }
    }

    // ── Erosion (slope-driven) ──
    if(s && s.slope!=null && s.slope>=6){
      push({ sev:s.slope>=12?4:3, act:s.slope>=12, topic:'erosion', tag:'erosion exposure on the steep acres',
        title:'consider erosion control (residue, contouring) on the steeper acres',
        detail:'Slope averages <strong>'+s.slope+'%</strong>'+(s.maxSlope>s.slope?' (up to '+s.maxSlope+'%)':'')+', real water-erosion exposure on the steeper acres.', watch:null });
    }

    // ── Hail history → bridge to the Hail Map ──
    if(h && !h.err && h.days>=2){
      push({ sev:1, act:false, topic:'hail', tag:null,   // area history, not a field condition: never the headline
        title:'check that your hail coverage fits how often hail is reported around here',
        detail:'Hail was reported within about 40 miles on <strong>'+h.days+' days in '+(h.years||5)+' years</strong>'+(h.maxStone?' (stones up to '+h.maxStone+'")':'')+'. That is the area, not proof this field was hit. <a href="/hail-map" target="_blank" rel="noopener" style="color:var(--brand,var(--gold))">See it on the national hail map &rarr;</a>', watch:null });
    }

    // ── Marketing context line ──
    if(b && (b.corn||b.bean)){
      var mk=[];
      if(b.corn) mk.push('corn $'+b.corn.cash.toFixed(2)+(b.corn.mon?' for '+esc(b.corn.mon):'')+' ('+esc(b.corn.elev)+')');
      if(b.bean) mk.push('beans $'+b.bean.cash.toFixed(2)+(b.bean.mon?' for '+esc(b.bean.mon):'')+' ('+esc(b.bean.elev)+')');
      if(mk.length) lines.push('Best nearby cash bids, nearest delivery: '+mk.join(', ')+'.');
    }

    if(!lines.length && !stress.length) return;

    // No concerns at all → nudge toward the visual NDVI layer.
    if(!stress.length && s && r){
      lines.push('No red flags in the soil and rotation here; flip on <a href="#" class="fs-god-link" data-god="ndvi"><strong>Crop vigor</strong></a> to see how the stand is actually doing this season.');
    }

    stress.sort(function(a,b){ return b.sev-a.sev; });
    // ── County & state economics (2026-07-20): woven in only when the joins landed. ──
    var cy=FSX.FIELD.county;
    if(cy && (cy.rent || cy.tenure)){
      var bits=[];
      if(cy.tenure) bits.push('<strong>'+cy.tenure.pct+'% of '+esc(cy.name)+' County is rented ground</strong> ('+cy.tenure.year+' census)');
      if(cy.rent) bits.push('county cash rent ran <strong>$'+Math.round(cy.rent.val)+'/ac</strong> in '+cy.rent.year+(cy.rent.trend?' against a '+cy.rent.trend+'-bu corn trend':''));
      lines.push('Around here: '+bits.join('; ')+'.');
    }
    if(cy && cy.basis && cy.basis.dev<=-0.25){
      push({ sev:2, act:false, topic:'basis', tag:'weak basis',
        title:'basis here is running '+Math.round(Math.abs(cy.basis.dev)*100)+'¢ under normal',
        detail:esc(cy.basis.crop.charAt(0).toUpperCase()+cy.basis.crop.slice(1))+' basis in '+esc(cy.st)+' is <strong>'+(cy.basis.latest<0?'−$':'$')+Math.abs(cy.basis.latest).toFixed(2)+'</strong> vs a '+(cy.basis.avg5>=0?'+$':'−$')+Math.abs(cy.basis.avg5).toFixed(2)+' 5-yr normal: '+Math.round(Math.abs(cy.basis.dev)*100)+'¢ of freight and storage pressure coming straight off your price.'+(cy.storage&&cy.storage.ratio>=0.9?' The state’s bins are '+Math.round(cy.storage.ratio*100)+'% committed'+(cy.storage.since?', tightest since '+cy.storage.since:'')+', which is a lot of the story.':''),
        watch:'If you have on-farm storage, weak basis is paying you to use it, and to shop bids beyond the closest elevator.' });
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
          + 'Any one is manageable on its own: together they compound, which is why the first item below is the priority.';
      }
    }

    // verdict = top act-now concern (falls back to top stressor)
    // A watch item is not a bottom line. With nothing to act on, say so plainly instead of
    // promoting the first monitor line (panel 9/20: "check your hail coverage" headlined a
    // healthy field).
    var bigMon = mons.filter(function(x){ return (x.sev||0)>=2; }).sort(function(a,b){ return (b.sev||0)-(a.sev||0); })[0];
    // "Nothing needs action" is a claim about the field. Make it only when the field-level
    // layers actually answered; with soil, crop history and satellite all missing, say that.
    // name what did not answer, so "redraw" is not a guess (2026-10-29)
    function missingFieldLayers(){
      var m=[]; if(!FSX.FIELD.soil) m.push('the USDA soil survey'); if(!FSX.FIELD.rotation) m.push('the USDA crop history');
      if(!(FSX.FIELD.indices&&FSX.FIELD.indices.series&&FSX.FIELD.indices.series.length)) m.push('the satellite passes');
      return m.length>1 ? m.slice(0,-1).join(', ')+' and '+m[m.length-1] : (m[0]||'part of the field data');
    }
    var fieldLayers = (FSX.FIELD.soil?1:0) + (FSX.FIELD.rotation?1:0) + (FSX.FIELD.indices&&FSX.FIELD.indices.series&&FSX.FIELD.indices.series.length?1:0);
    var lead = acts[0] || bigMon || (fieldLayers<2 ? { title:'not enough of this field\u2019s data loaded for a bottom line: '+missingFieldLayers()+' did not answer; redraw in a minute' } : null) || { title: lateSeason
        ? 'nothing on this field needs action now; the crop is maturing, so harvest timing and the bid are what move money'
        : 'nothing on this field needs action right now; the items below are worth watching' };
    FSX.FIELD.read = { verdict: lead?lead.title:null,
                   flags: stress.map(function(x){ return x.detail; }),
                   lines: lines.slice() };

    // ── render ──
    var wrap=document.getElementById('fs-insight-wrap'); if(wrap) wrap.hidden=false;
    var html='';
    // HOLD THE BOTTOM LINE until soil, crop history, season weather and drought have answered
    // (or 12 s have passed). Before this, the first layer to land wrote the verdict, and the
    // headline could flip two or three times in the first seconds.
    var waitFor=[];
    if(FSX.FIELD.soil===null) waitFor.push('soil');
    if(FSX.FIELD.rotation===null) waitFor.push('crop history');
    if(FSX.FIELD.season===undefined) waitFor.push('season weather');
    if(FSX.FIELD.drought===null) waitFor.push('drought');
    var held = waitFor.length && FSX.FIELD.t0 && (Date.now()-FSX.FIELD.t0)<12000;
    if(held){
      var g0=FSX.fieldGen; clearTimeout(FSX.FIELD._holdT);
      FSX.FIELD._holdT=setTimeout(function(){ if(g0===FSX.fieldGen) recomputeInsight(); }, Math.max(200, 12100-(Date.now()-FSX.FIELD.t0)));
      FSX.FIELD.read.verdict=null;
      html += '<p class="fs-verdict fs-verdict-wait" aria-live="polite"><span>Bottom line</span><b>Waiting on '+waitFor.join(', ')+'&hellip;</b></p>';
    }
    else if(lead) html += '<p class="fs-verdict"><span>Bottom line</span><b>'+lead.title.charAt(0).toUpperCase()+lead.title.slice(1)+'.</b></p>';
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
    setMapHeadline(lead && !held ? (lead.title.charAt(0).toUpperCase()+lead.title.slice(1)+'.') : null);
    renderPeek();
    if(!held) scheduleSettle();
  }

  return { renderPassTimeline:renderPassTimeline, scrubTo:scrubTo, toggleHail:toggleHail, runAll:runAll, soilShare:soilShare, vigorWord:vigorWord, ordinal:ordinal, atlasCounty:atlasCounty, atlasRows:atlasRows };
};
