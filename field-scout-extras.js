/* AGSIST Field Scout extras: field-scout-extras.js
   The print report, the GeoJSON and KML export and note photos. Loaded by
   field-scout.js (loadExtras) when one of those buttons is used, after the read. */
window.__fsExtras = function (FSX) {
  'use strict';
  var crop=FSX.crop, flashHint=FSX.flashHint, PHOTO_CAP=FSX.PHOTO_CAP, loadSavedFields=FSX.loadSavedFields, persistSavedFields=FSX.persistSavedFields, currentSavedField=FSX.currentSavedField, renderNotesSectionInPlace=FSX.renderNotesSectionInPlace, renderSavedFields=FSX.renderSavedFields, currentFieldName=FSX.currentFieldName, latlngs=FSX.latlngs, polyAcres=FSX.polyAcres, soilShare=FSX.soilShare, vigorWord=FSX.vigorWord, ordinal=FSX.ordinal, esc=FSX.esc, ga=FSX.ga;

  // Resize to maxWidth (keeping aspect) and re-encode as JPEG at `quality` so a
  // phone photo (often 3-8MB) shrinks to something localStorage can actually hold.
  function compressPhoto(file, maxWidth, quality){
    return new Promise(function(resolve, reject){
      if(!file || !/^image\//.test(file.type)){ reject(new Error('not an image')); return; }
      var reader = new FileReader();
      reader.onerror = function(){ reject(reader.error||new Error('read failed')); };
      reader.onload = function(){
        var img = new Image();
        img.onerror = function(){ reject(new Error('bad image')); };
        img.onload = function(){
          var w=img.naturalWidth||img.width, h=img.naturalHeight||img.height;
          if(!w||!h){ reject(new Error('bad image')); return; }
          if(w>maxWidth){ h=Math.round(h*(maxWidth/w)); w=maxWidth; }
          var canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
          var ctx=canvas.getContext('2d');
          ctx.drawImage(img,0,0,w,h);
          try{ resolve(canvas.toDataURL('image/jpeg', quality)); }
          catch(e){ reject(e); }
        };
        img.src=reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function handlePhotoFile(file){
    var f=currentSavedField();
    if(!f){ flashHint('Save this field first, then attach photos.'); return; }
    if((f.photos||[]).length>=PHOTO_CAP){ flashHint('Up to '+PHOTO_CAP+' photos per field; delete one to add another.'); return; }
    // A full-resolution phone photo can run 20-50MB; reading that whole to a
    // dataURL before the canvas resize kicks in is real memory pressure on a
    // low-end phone. Reject up front rather than risk a freeze.
    if(file && file.size>26214400){ flashHint('That photo is too large. Try a smaller one (under 25MB).'); return; }
    compressPhoto(file, 800, 0.6).then(function(dataUrl){
      var arr=loadSavedFields();
      var row=arr.filter(function(x){ return x.id===FSX._activeFieldId; })[0]; if(!row) return;
      row.photos = row.photos || [];
      if(row.photos.length>=PHOTO_CAP){ flashHint('Up to '+PHOTO_CAP+' photos per field.'); return; }
      row.photos.push({ id:Date.now().toString(36)+Math.random().toString(36).slice(2,7), dataUrl:dataUrl, addedAt:Date.now() });
      if(!persistSavedFields(arr)){
        // the browser's quota said no — back the photo out and say so plainly, no invented ceiling
        flashHint('Storage on this device is full for saved photos; delete a photo or a saved field to add more.');
        return;
      }
      renderNotesSectionInPlace();
      renderSavedFields();
      ga('field_photo_added', {});
    }).catch(function(){ flashHint('Couldn’t read that photo. Try a different file.'); });
  }
  function deletePhoto(photoId){
    if(FSX._activeFieldId==null || !photoId) return;
    var arr=loadSavedFields();
    var row=arr.filter(function(x){ return x.id===FSX._activeFieldId; })[0]; if(!row) return;
    row.photos=(row.photos||[]).filter(function(p){ return String(p.id)!==String(photoId); });
    persistSavedFields(arr);
    renderNotesSectionInPlace();
    renderSavedFields();
  }
  function fileBase(name){
    return (String(name||'field').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')) || 'field';
  }
  function ringCoords(poly){
    var pts = latlngs(poly).map(function(p){ return [+p.lng.toFixed(6), +p.lat.toFixed(6)]; });
    if(pts.length && (pts[0][0]!==pts[pts.length-1][0] || pts[0][1]!==pts[pts.length-1][1])) pts.push(pts[0]); // close the ring
    return pts;
  }
  function fieldGeoJSON(poly, name){
    return {
      type:'FeatureCollection',
      features:[{
        type:'Feature',
        properties:{ name:name||'Field', acres:+polyAcres(poly).toFixed(1), source:'AGSIST Field Scout', exported:new Date().toISOString() },
        geometry:{ type:'Polygon', coordinates:[ringCoords(poly)] }
      }]
    };
  }
  function fieldKML(poly, name){
    var coordStr = ringCoords(poly).map(function(p){ return p[0]+','+p[1]+',0'; }).join(' ');
    var nm = esc(name||'Field'), desc = esc(polyAcres(poly).toFixed(1)+' acres: exported from AGSIST Field Scout');
    return '<?xml version="1.0" encoding="UTF-8"?>\n'+
      '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>\n'+
      '<name>'+nm+'</name>\n'+
      '<Placemark><name>'+nm+'</name><description>'+desc+'</description>\n'+
      '<Style><LineStyle><color>ff3fa2d4</color><width>3</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>\n'+
      '<Polygon><outerBoundaryIs><LinearRing><coordinates>'+coordStr+'</coordinates></LinearRing></outerBoundaryIs></Polygon>\n'+
      '</Placemark>\n</Document></kml>';
  }
  function downloadBlob(content, filename, mime){
    var blob = new Blob([content], { type:mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href=url; a.download=filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ try{ URL.revokeObjectURL(url); }catch(e){} }, 1000);
  }
  function exportGeoJSON(){
    if(!FSX.activePoly) return;
    var name = currentFieldName();
    downloadBlob(JSON.stringify(fieldGeoJSON(FSX.activePoly, name), null, 2), fileBase(name)+'.geojson', 'application/geo+json');
    ga('field_export_geojson', {});
  }
  function exportKML(){
    if(!FSX.activePoly) return;
    var name = currentFieldName();
    downloadBlob(fieldKML(FSX.activePoly, name), fileBase(name)+'.kml', 'application/vnd.google-earth.kml+xml');
    ga('field_export_kml', {});
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
    if(!FSX.FIELD){ return; }
    var d=FSX.FIELD, s=d.soil, r=d.rotation, dr=d.drought, se=d.season, h=d.hail, b=d.bids, rd=d.read, cy=d.county;
    var dateStr=new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
    function strip(html){ return String(html||'').replace(/<a\b[^>]*>(.*?)<\/a>/gi,'$1'); }
    function kv(label,val){ return val?('<tr><th>'+esc(label)+'</th><td>'+val+'</td></tr>'):''; }
    function sect(title,body){ return body?('<section class="r-sec"><h2>'+esc(title)+'</h2>'+body+'</section>'):''; }

    var notesHtml='';
    var savedF = currentSavedField();
    if(savedF && ((savedF.notes&&savedF.notes.trim()) || (savedF.photos&&savedF.photos.length))){
      var notesTxt = savedF.notes ? '<p class="r-p r-notes-txt">'+esc(savedF.notes)+'</p>' : '';
      var notesPhotos = (savedF.photos&&savedF.photos.length) ? '<div class="r-photos">'+savedF.photos.map(function(p){ return '<img class="r-photo" src="'+p.dataUrl+'" alt="Field photo">'; }).join('')+'</div>' : '';
      notesHtml = sect('Scouting notes', notesTxt+notesPhotos);
    }

    var verdictHtml = (rd&&rd.verdict) ? '<div class="r-verdict"><span>Bottom line</span>'+esc(rd.verdict.charAt(0).toUpperCase()+rd.verdict.slice(1))+'.</div>' : '';
    var lead = (rd&&rd.lines&&rd.lines.length) ? rd.lines.map(function(l){return '<p class="r-p">'+strip(l)+'</p>';}).join('') : '';
    var flagsHtml = (rd&&rd.flags&&rd.flags.length) ? '<ul class="r-flags">'+rd.flags.map(function(f){return '<li>'+strip(f)+'</li>';}).join('')+'</ul>' : '';

    var soilHtml='';
    if(s&&s.classes&&s.classes.length){
      var hasAc=s.total>0;
      soilHtml='<table class="r-tbl">'+s.classes.slice(0,6).map(function(c){
        var hasArea=hasAc&&c.ac>0;
        var pct=hasArea?Math.round(c.ac/s.total*100):null;
        return '<tr><td>'+esc(c.name)+'</td><td>class '+(c.nicc||'?')+'</td><td class="r-num">'+(hasArea?c.ac.toFixed(1)+' ac':'n/a')+'</td><td class="r-num">'+(pct!=null?pct+'%':'n/a')+'</td></tr>';
      }).join('')+'</table>';
      var bits=[];
      if(s.csr2!=null) bits.push('CSR2 '+s.csr2.toFixed(1));
      if(soilShare(s)) bits.push(soilShare(s));
      if(s.nccpi!=null) bits.push('soil productivity '+Math.round(s.nccpi*100)+'/100 (USDA NCCPI '+s.nccpi.toFixed(2)+')');
      if(s.slope!=null) bits.push(s.slope+'% average slope'+(s.maxSlope>s.slope?' (up to '+s.maxSlope+'%)':''));
      if(bits.length) soilHtml+='<p class="r-note">'+bits.join(' &middot; ')+'</p>';
    }

    var vigorHtml='';
    if(d.indices && d.indices.series && d.indices.series.length){
      var vx=d.indices.latest || d.indices.series[d.indices.series.length-1];
      var vv=vx.ndvi;
      var vWord = (FSX.FIELD._vigWord || vigorWord(vv)).toLowerCase();
      var nrm=d.indices.normal;
      var nrmCell='';
      if(nrm && nrm.ndvi!=null && vv!=null){ var df=vv-nrm.ndvi; nrmCell='<tr><th>Normal for this point in season</th><td>NDVI '+nrm.ndvi.toFixed(2)+', '+(Math.abs(df)<0.04?'in line':(df>0?'ahead':'behind'))+(nrm.years&&nrm.years.length?' ('+nrm.years.length+'-yr)':'')+'</td></tr>'; }
      vigorHtml='<table class="r-kv">'+
        (vv!=null?'<tr><th>Crop vigor (NDVI)</th><td>'+vv.toFixed(2)+', '+vWord+'</td></tr>':'')+
        nrmCell+
        (vx.ndmi!=null?'<tr><th>Canopy moisture (NDMI)</th><td>'+vx.ndmi.toFixed(2)+'</td></tr>':'')+
        (vx.ndre!=null?'<tr><th>Nitrogen / chlorophyll (NDRE)</th><td>'+vx.ndre.toFixed(2)+'</td></tr>':'')+
        '<tr><th>Latest clear pass</th><td>'+esc(vx.date)+' &middot; '+d.indices.series.length+' this season</td></tr>'+
        '</table>'+reportSpark(d.indices.series)+'<p class="r-note">Sentinel-2 / Copernicus, cloud-masked, averaged over the field.</p>';
    }

    var rotHtml='';
    if(r&&r.codes&&r.codes.length){
      rotHtml='<div class="r-rot">'+r.codes.map(function(code,i){
        var nm = code ? crop(code).l : '-';
        return '<span><b>\u2019'+String(r.years[i]).slice(2)+'</b> '+esc(nm)+'</span>';
      }).join('')+'</div>';
      if(r.patternText) rotHtml+='<p class="r-note">'+esc(r.patternText)+(FSX.FIELD.thisYear&&FSX.FIELD.thisYear.code!=null?' · '+(r.nextYear||'')+': '+(FSX.FIELD.thisYear.code===1?'corn':FSX.FIELD.thisYear.code===5?'soybeans':'other')+(FSX.FIELD.thisYear.src==='you'?' (as told)':' (likely, from the pattern)'):'')+'</p>';
    }

    var condRows='';
    if(dr&&dr.cat) condRows+=kv('Drought status', dr.cat==='None'?'No drought':esc(dr.cat)+(dr.approx?' (county-wide)':''));
    if(se){
      condRows+=kv('Season rainfall', se.pNow.toFixed(1)+'\u2033 vs '+se.pNorm.toFixed(1)+'\u2033 '+se.n+'-yr average ('+(se.pDep>=0?'+':'')+se.pDep.toFixed(1)+'\u2033)');
      condRows+=kv('Growing degree units', Math.round(se.gNow)+' vs '+Math.round(se.gNorm)+' normal ('+(se.gDep>=0?'+':'')+Math.round(se.gDep)+')');
    }
    if(h&&!h.err) condRows+=kv('Hail reports within ~40 mi, '+(h.years||5)+' yr', h.days+' day'+(h.days===1?'':'s')+' with a report'+(h.maxStone?' \u00b7 max '+h.maxStone+'\u2033':''));

    var bidRows='';
    if(b&&b.corn) bidRows+=kv('Corn cash bid'+(b.corn.mon?', '+b.corn.mon:''), '$'+b.corn.cash.toFixed(2)+' \u00b7 '+esc(b.corn.elev));
    if(b&&b.bean) bidRows+=kv('Soybean cash bid'+(b.bean.mon?', '+b.bean.mon:''), '$'+b.bean.cash.toFixed(2)+' \u00b7 '+esc(b.bean.elev));

    // \u2500\u2500 county & state economics (renders only what actually loaded) \u2500\u2500
    var bandCells='';
    function cell(k,v,n){ bandCells+='<div class="r-st"><div class="r-stk">'+esc(k)+'</div><div class="r-stv">'+v+'</div>'+(n?'<div class="r-stn">'+esc(n)+'</div>':'')+'</div>'; }
    if(cy&&cy.rent) cell('County rent \u2019'+String(cy.rent.year).slice(2), '$'+Math.round(cy.rent.val)+'<span class="r-stu">/ac</span>', cy.rent.avg?('10-yr avg $'+cy.rent.avg):null);
    if(cy&&cy.rent&&cy.rent.level) cell('County corn, recent', cy.rent.level.avg.toFixed(1)+'<span class="r-stu"> bu</span>', cy.rent.level.from+'–'+cy.rent.level.to+', high & low dropped');
    else if(cy&&cy.rent&&cy.rent.trend) cell('Corn trend yield', cy.rent.trend+'<span class="r-stu"> bu</span>', cy.rent.lastYield?('made '+cy.rent.lastYield+' last year'):null);
    // the gap is taken from the two printed (rounded) numbers, so the three figures add up on paper
    var bDev = cy&&cy.basis ? Math.round(cy.basis.latest*100)/100 - Math.round(cy.basis.avg5*100)/100 : null;
    if(cy&&cy.basis) cell(esc(cy.basis.crop)+' basis vs normal', '<span class="'+(bDev<0?'r-red':'r-green')+'">'+(bDev<0?'\u2212$':'+$')+Math.abs(bDev).toFixed(2)+'</span>', (cy.basis.latest<0?'\u2212$':'$')+Math.abs(cy.basis.latest).toFixed(2)+' vs '+(cy.basis.avg5>=0?'+$':'\u2212$')+Math.abs(cy.basis.avg5).toFixed(2)+' avg');
    if(cy&&cy.tenure) cell('Rented ground here', cy.tenure.pct+'%', 'of county farmland');
    var bandHtml = bandCells ? '<h2>The county around it</h2><div class="r-band">'+bandCells+'</div>' : '';

    // FIELD FIRST. The top of the page is this field's own numbers; county figures follow.
    var fCells='';
    function fcell(k,v,n){ fCells+='<div class="r-st r-st-f"><div class="r-stk">'+esc(k)+'</div><div class="r-stv">'+v+'</div>'+(n?'<div class="r-stn">'+esc(n)+'</div>':'')+'</div>'; }
    fcell('Acres', d.acres.toFixed(1), null);
    if(s&&s.csr2!=null) fcell('CSR2', s.csr2.toFixed(1), 'Iowa corn suitability, of 100');
    else if(s&&s.nccpi!=null) fcell('Soil productivity', Math.round(s.nccpi*100)+'<span class="r-stu">/100</span>', 'USDA NCCPI');
    if(s&&(s.farmPct!=null||s.primePct!=null)) fcell('Prime farmland', (s.farmPct!=null?s.farmPct:s.primePct)+'%', s.farmIfPct?('+'+s.farmIfPct+'% if drained'):'of the field');
    if(FSX.FIELD.thisYear&&FSX.FIELD.thisYear.code!=null) fcell((r&&r.nextYear)||'This year', FSX.FIELD.thisYear.code===1?'Corn':FSX.FIELD.thisYear.code===5?'Soybeans':'Other', FSX.FIELD.thisYear.src==='you'?'as told':'likely, from the pattern');
    if(d.indices&&d.indices.series&&d.indices.series.length){
      var fx=d.indices.latest||d.indices.series[d.indices.series.length-1], fn=d.indices.normal;
      if(fx.ndvi!=null) fcell('Vigor (NDVI)', fx.ndvi.toFixed(2), fn&&fn.ndvi!=null?('normal '+fn.ndvi.toFixed(2)+' for the date'):fx.date);
    }
    if(se) fcell('Season rain', se.pNow.toFixed(1)+'<span class="r-stu">\u2033</span>', (se.pDep>=0?'+':'\u2212')+Math.abs(se.pDep).toFixed(1)+'\u2033 vs '+se.n+'-yr avg');
    var fieldBand = '<div class="r-band r-band-f">'+fCells+'</div>';

    // The field's outline, drawn to scale, so the page shows which field it is about.
    var outline='';
    try{
      var pl = FSX.activePoly ? latlngs(FSX.activePoly) : null;
      if(pl && pl.length>=3){
        var kx=Math.cos(d.lat*Math.PI/180), xs=pl.map(function(p){ return p.lng*kx; }), ys=pl.map(function(p){ return -p.lat; });
        var x0=Math.min.apply(null,xs), x1=Math.max.apply(null,xs), y0=Math.min.apply(null,ys), y1=Math.max.apply(null,ys);
        var sc=Math.min(92/Math.max(x1-x0,1e-9), 92/Math.max(y1-y0,1e-9));
        var ox=(100-(x1-x0)*sc)/2, oy=(100-(y1-y0)*sc)/2;
        var pts=xs.map(function(x,i){ return ((x-x0)*sc+ox).toFixed(1)+','+((ys[i]-y0)*sc+oy).toFixed(1); }).join(' ');
        // the longest standard length that fits in 45 of the 100 units
        var pxPerMi=sc/(111.32*0.621371), BARS=[[0.5,'\u00bd mi'],[0.25,'\u00bc mi'],[0.125,'\u215b mi'],[1/16,'330 ft'],[1/32,'165 ft']];
        var bar=BARS[BARS.length-1]; for(var bi=0;bi<BARS.length;bi++){ if(BARS[bi][0]*pxPerMi<=45){ bar=BARS[bi]; break; } }
        var barPx=Math.min(45, bar[0]*pxPerMi);
        outline='<svg class="r-outline" viewBox="0 0 100 112" role="img" aria-label="Field outline"><polygon points="'+pts+'" fill="#f3ecd2" stroke="#8a6d12" stroke-width="1.4" stroke-linejoin="round"/>'+
          '<line x1="4" y1="107" x2="'+(4+barPx).toFixed(1)+'" y2="107" stroke="#555" stroke-width="1.2"/><text x="'+(6+barPx).toFixed(1)+'" y="109" font-size="6" fill="#555">'+bar[1]+'</text>'+
          '<text x="96" y="10" font-size="7" fill="#555" text-anchor="end">N\u2191</text></svg>';
      }
    }catch(e){ outline=''; }

    var moneyRows='';
    if(cy&&cy.rent){
      moneyRows+=kv('County rent, non-irr \u2019'+String(cy.rent.year).slice(2), '$'+Math.round(cy.rent.val)+'/ac');
      var yl=cy.rent.level?cy.rent.level.avg:cy.rent.trend;
      if(yl&&b&&b.corn){
        var gross=Math.round(yl*b.corn.cash);
        moneyRows+=kv('Gross @ '+(cy.rent.level?'recent county yield':'trend')+' \u00d7 $'+b.corn.cash.toFixed(2), '$'+gross.toLocaleString('en-US')+'/ac');
        moneyRows+=kv('Rent share of a corn year\u2019s gross', Math.round(cy.rent.val/gross*100)+'%');
      }
    }
    if(cy&&cy.basis) moneyRows+=kv('State '+esc(cy.basis.crop)+' basis', (cy.basis.latest<0?'\u2212$':'$')+Math.abs(cy.basis.latest).toFixed(2)+' ('+(Math.abs(bDev)<0.005?'on':Math.round(Math.abs(bDev)*100)+'\u00a2 '+(bDev<0?'under':'over'))+' its 5-yr normal)');
    if(cy&&cy.storage) moneyRows+=kv('State bins', Math.round(cy.storage.ratio*100)+'% of capacity filled by the \u2019'+String(cy.storage.year).slice(2)+' crop'+(cy.storage.since&&cy.storage.ratio>=0.85?', tightest since '+cy.storage.since:''));

    var ownRows='';
    if(cy&&cy.tenure) ownRows+=kv('County ground rented', cy.tenure.pct+'%: '+Math.round(cy.tenure.rented).toLocaleString('en-US')+' of '+Math.round(cy.tenure.total).toLocaleString('en-US')+' ac ('+cy.tenure.year+' census)');
    if(cy&&cy.afida) ownRows+=kv('Foreign-held in county', Math.round(cy.afida.acres).toLocaleString('en-US')+' ac'+(cy.afida.share!=null?' ('+cy.afida.share+'% of farmland)':'')+' \u00b7 '+cy.afida.year);

    var stateRows='';
    if(cy&&cy.cond){
      stateRows+=kv('Crop condition ('+esc(cy.st||'state')+' '+esc(cy.cond.crop)+')', Math.round(cy.cond.ge)+'% G+E: '+ordinal(cy.cond.pctile)+' percentile since 2000');
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
      +'.r-top{display:flex;gap:16px;align-items:flex-start}.r-top-t{flex:1;min-width:0}.r-outline{width:118px;height:132px;flex:none}'
      +'.r-band-f{grid-template-columns:repeat(auto-fit,minmax(96px,1fr));margin:6px 0 10px}.r-st-f{border-color:#d9c88a;background:#fdfaf0}.r-st-f .r-stv{font-size:17px}'
      +'@media(max-width:640px){.r-outline{width:84px;height:94px}}'
      +'.r-sec,.r-band,.r-verdict,.r-kv tr,.r-tbl tr{break-inside:avoid;page-break-inside:avoid}h2{break-after:avoid;page-break-after:avoid}'
      +'.r-cols{columns:2;column-gap:24px}.r-cols .r-sec{break-inside:avoid;page-break-inside:avoid}.r-cols .r-kv th{width:52%}.r-cols h2:first-child{margin-top:4px}'
      +'@media(max-width:640px){.r-cols{columns:1}}'
      +'.r-notes-txt{white-space:pre-wrap}.r-photos{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}'
      +'.r-photo{width:108px;height:108px;object-fit:cover;border-radius:6px;border:1px solid #e5e0cf}'
      +'@page{size:letter;margin:.5in}'
      +'@media print{.no-print{display:none}body{padding:0;max-width:none;font-size:11.5px;line-height:1.4}h2{margin:12px 0 5px}.r-p{margin:.15em 0}.r-kv,.r-tbl{font-size:11.5px}.r-kv th,.r-kv td,.r-tbl td{padding:2px 6px 2px 0}.r-foot{margin-top:12px}}';

    var html='<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      +'<title>Field Report: '+d.acres.toFixed(0)+' acres | AGSIST</title><style>'+css+'</style></head><body>'
      +'<div class="r-actions no-print"><button type="button" onclick="window.print()">\u2399 Print / Save as PDF</button></div>'
      +'<div class="r-head"><div class="r-brand">AGSIST \u00b7 Field Scout</div><div class="r-date">'+esc(dateStr)+'</div></div>'
      +'<div class="r-top">'+outline+'<div class="r-top-t"><h1>'+d.acres.toFixed(1)+'-acre field'+(cy&&cy.name?', '+esc(cy.name)+' County, '+esc(cy.st):'')+'</h1><div class="r-loc">Center '+d.lat.toFixed(4)+', '+d.lng.toFixed(4)+'</div>'
      +verdictHtml+'</div></div>'+fieldBand+lead+flagsHtml+notesHtml+bandHtml
      +sect('Soil & productivity', soilHtml)
      +'<div class="r-cols">'
      +sect('Crop vigor & moisture (satellite)', vigorHtml)
      +sect(((r&&r.codes)?r.codes.length:10)+'-year crop rotation', rotHtml)
      +sect('The money', moneyRows?'<table class="r-kv">'+moneyRows+'</table>':'')
      +sect('Ownership picture', ownRows?'<table class="r-kv">'+ownRows+'</table>':'')
      +sect('Statewide crop & bins', stateRows?'<table class="r-kv">'+stateRows+'</table>':'')
      +sect('Conditions', condRows?'<table class="r-kv">'+condRows+'</table>':'')
      +sect('Nearby cash bids', bidRows?'<table class="r-kv">'+bidRows+'</table>':'')
      +(cy&&cy.atlas&&cy.atlas.rows.length?sect('The county\u2019s long record', '<table class="r-kv">'+cy.atlas.rows.map(function(r){ return kv(r[0], esc(r[1])+(r[2]?' <span style="color:#777">\u00b7 '+esc(r[2])+'</span>':'')); }).join('')+'</table>'
        +'<p class="r-note">County-wide, the same figures the Farmland Atlas prints: agsist.com/farmland-atlas#'+esc(cy.atlas.fips)+' \u00b7 county sheet: agsist.com/farmland-atlas/sheet#'+esc(cy.atlas.fips)+'</p>'):'')
      +'</div>'
      +'<div class="r-foot"><strong>Prepared by Sigurd Lindquist \u00b7 AGSIST Field Scout \u00b7 agsist.com/field-scout \u00b7 sig@agsist.com</strong><br>Compiled from public data: USDA SSURGO soil survey, Cropland Data Layer, NASS county cash-rent survey &amp; weekly crop conditions, Census of Agriculture, AFIDA foreign-holdings filings, AgTransport basis, Open-Meteo, US Drought Monitor, Iowa Environmental Mesonet hail reports, and the AGSIST cash-bid feed. Survey estimates, not a substitute for sampling your own ground. A starting read, not an underwriting decision or financial advice. Missing data prints as missing; nothing here is interpolated.</div>'
      +'</body></html>';

    var w=window.open('','_blank');
    if(!w){ flashHint('Allow pop-ups to open the printable field report.'); return; }
    w.document.open(); w.document.write(html); w.document.close();
    ga('field_report', { acres: Math.round(d.acres) });
  }

  return { handlePhotoFile:handlePhotoFile, deletePhoto:deletePhoto, exportGeoJSON:exportGeoJSON, exportKML:exportKML, generateReport:generateReport };
};
