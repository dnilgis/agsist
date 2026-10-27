/* AGSIST Field Scout backup: field-scout-backup.js
   Back up every saved field (outline, notes and photos as stored) to one file on
   this device, and restore from that file or from a one-field GeoJSON or KML export.
   Loaded by field-scout.js (loadBackup) on its buttons. Nothing is sent anywhere. */
window.__fsBackup = function (FSX) {
  'use strict';
  var esc=FSX.esc, flashHint=FSX.flashHint, ga=FSX.ga;
  var KIND='agsist-field-scout-backup', SCHEMA=1, MAX_FIELDS=30, MAX_FILE=60*1024*1024;
  var MAX_PTS=5000, PHOTO_RE=/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+\/]+=*$/;
  var NOT_OURS='That file is not a Field Scout backup, a GeoJSON or a KML outline. Nothing was changed.';
  var _plan=null;

  function snapKey(id){ return 'agsist-fs-snap-'+id; }
  function fmtDate(ms){
    if(!ms || !isFinite(ms)) return 'unknown date';
    try{ return new Date(ms).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }); }catch(e){ return 'unknown date'; }
  }
  function fmtSize(n){ return n>=1048576 ? (n/1048576).toFixed(1)+' MB' : Math.max(1, Math.round(n/1024))+' KB'; }
  function plural(n, one, many){ return n+' '+(n===1?one:(many||one+'s')); }
  // when a field was last changed: its own stamp, else the newest of its creation and its photos
  function editedAt(f){
    if(typeof f.editedAt==='number' && isFinite(f.editedAt)) return f.editedAt;
    var t=typeof f.id==='number' ? f.id : 0;
    (f.photos||[]).forEach(function(p){ if(typeof p.addedAt==='number' && p.addedAt>t) t=p.addedAt; });
    return t;
  }

  // ── Back up ─────────────────────────────────────────────────────────
  function buildBackup(){
    var fields=FSX.loadSavedFields(), snaps={};
    fields.forEach(function(f){
      try{ var s=JSON.parse(localStorage.getItem(snapKey(f.id))||'null'); if(s) snaps[f.id]=s; }catch(e){}
    });
    return { kind:KIND, schema:SCHEMA, saved:new Date().toISOString(), note:'Field Scout saved fields from agsist.com. Open Field Scout and use Restore from a backup to load them.', count:fields.length, fields:fields, snaps:snaps };
  }
  function backupAll(){
    var b=buildBackup();
    if(!b.fields.length){ flashHint('No saved fields on this device to back up yet.', 5000); return null; }
    var text=JSON.stringify(b), photos=0;
    b.fields.forEach(function(f){ photos+=(f.photos||[]).length; });
    var blob=new Blob([text], { type:'application/json' });
    var url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url; a.download='agsist-field-scout-backup-'+b.saved.slice(0,10)+'.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ try{ URL.revokeObjectURL(url); }catch(e){} }, 4000);
    try{ localStorage.setItem('agsist-fs-backup-at', String(Date.now())); }catch(e){}
    FSX.renderSavedFields();
    flashHint('Backup saved: '+plural(b.fields.length,'field')+', '+plural(photos,'photo')+', '+fmtSize(blob.size)+'. Keep the file off this phone too, in your email or cloud drive.', 9000);
    ga('field_backup', { fields:b.fields.length });
    return { fields:b.fields.length, photos:photos, bytes:blob.size };
  }

  // ── Read a file ─────────────────────────────────────────────────────
  function cleanPts(pts){
    if(!Array.isArray(pts)) return null;
    var out=[];
    for(var i=0;i<pts.length && out.length<=MAX_PTS;i++){
      var p=pts[i];
      if(!Array.isArray(p) || p.length<2) return null;
      var lat=+p[0], lng=+p[1];
      if(!isFinite(lat) || !isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180) return null;
      out.push([+lat.toFixed(6), +lng.toFixed(6)]);
    }
    if(out.length>1){ var a=out[0], z=out[out.length-1]; if(a[0]===z[0] && a[1]===z[1]) out.pop(); }   // a closed ring
    return out.length>=3 && out.length<=MAX_PTS ? out : null;
  }
  function acresOf(pts){ return +FSX.acresOfRing(pts.map(function(p){ return { lat:p[0], lng:p[1] }; })).toFixed(1); }
  function cleanField(raw){
    if(!raw || typeof raw!=='object') return null;
    var pts=cleanPts(raw.pts); if(!pts) return null;
    var photos=(Array.isArray(raw.photos)?raw.photos:[]).filter(function(p){
      return p && typeof p.dataUrl==='string' && PHOTO_RE.test(p.dataUrl);
    }).slice(0, FSX.PHOTO_CAP).map(function(p, i){
      return { id:String(p.id!=null?p.id:'r'+i).slice(0,40), dataUrl:p.dataUrl, addedAt:typeof p.addedAt==='number'&&isFinite(p.addedAt)?p.addedAt:undefined };
    });
    var f={
      id: typeof raw.id==='number' && isFinite(raw.id) && raw.id>0 ? raw.id : null,
      name: (typeof raw.name==='string' && raw.name.trim() ? raw.name.trim() : 'Untitled').slice(0,40),
      pts: pts,
      acres: typeof raw.acres==='number' && isFinite(raw.acres) && raw.acres>0 ? +raw.acres.toFixed(1) : acresOf(pts),
      notes: typeof raw.notes==='string' ? raw.notes.slice(0,4000) : '',
      photos: photos
    };
    if(typeof raw.editedAt==='number' && isFinite(raw.editedAt)) f.editedAt=raw.editedAt;
    return f;
  }
  // GeoJSON: [lng, lat] rings in a Polygon or MultiPolygon, in a Feature or a FeatureCollection
  function geoRings(g, out, name){
    if(!g || typeof g!=='object') return;
    if(g.type==='FeatureCollection' && Array.isArray(g.features)) g.features.forEach(function(ft){ geoRings(ft, out); });
    else if(g.type==='Feature') geoRings(g.geometry, out, g.properties && (g.properties.name || g.properties.Name));
    else if(g.type==='Polygon' && Array.isArray(g.coordinates)) out.push({ ring:g.coordinates[0], name:name });
    else if(g.type==='MultiPolygon' && Array.isArray(g.coordinates)) g.coordinates.forEach(function(c){ if(Array.isArray(c)) out.push({ ring:c[0], name:name }); });
    else if(g.type==='GeometryCollection' && Array.isArray(g.geometries)) g.geometries.forEach(function(x){ geoRings(x, out, name); });
  }
  function outlineFields(rings, src){
    var fields=[], skipped=0;
    rings.forEach(function(r, i){
      var pts=Array.isArray(r.ring) ? cleanPts(r.ring.map(function(c){ return Array.isArray(c) ? [c[1], c[0]] : null; })) : null;
      if(!pts){ skipped++; return; }
      fields.push(cleanField({ name:typeof r.name==='string'&&r.name.trim() ? r.name : 'Imported field'+(rings.length>1?' '+(i+1):''), pts:pts }));
    });
    if(!fields.length) throw new Error('That '+src+' file has no field outline (a polygon) Field Scout can read. Nothing was changed.');
    return { source:src, fields:fields, skipped:skipped, snaps:{} };
  }
  function parseKML(text){
    var doc;
    try{ doc=new DOMParser().parseFromString(text, 'application/xml'); }catch(e){ throw new Error(NOT_OURS); }
    if(!doc || doc.getElementsByTagName('parsererror').length || !doc.documentElement || doc.documentElement.localName!=='kml') throw new Error(NOT_OURS);
    var rings=[];
    Array.prototype.forEach.call(doc.getElementsByTagNameNS('*', 'Placemark'), function(pm){
      var nm=null;
      Array.prototype.forEach.call(pm.childNodes, function(c){ if(c.localName==='name' && nm==null) nm=c.textContent; });
      Array.prototype.forEach.call(pm.getElementsByTagNameNS('*', 'outerBoundaryIs'), function(ob){
        var co=ob.getElementsByTagNameNS('*', 'coordinates')[0]; if(!co) return;
        rings.push({ name:nm, ring:co.textContent.trim().split(/\s+/).map(function(t){ var a=t.split(','); return a.length>=2 ? [+a[0], +a[1]] : null; }) });
      });
    });
    return outlineFields(rings, 'KML');
  }
  // Returns { source, fields, skipped, snaps, saved } or throws an Error with a plain message.
  function parseFile(text){
    if(typeof text!=='string' || !text.trim()) throw new Error('That file is empty. Nothing was changed.');
    text=text.replace(/^﻿/, '').trim();
    if(text.charAt(0)==='<') return parseKML(text);
    var o;
    try{ o=JSON.parse(text); }catch(e){ throw new Error(NOT_OURS); }
    if(o && o.kind===KIND){
      if(typeof o.schema!=='number' || o.schema>SCHEMA) throw new Error('That backup was made by a newer Field Scout. Reload this page and try again. Nothing was changed.');
      if(!Array.isArray(o.fields)) throw new Error('That backup has no fields in it. Nothing was changed.');
      var fields=[], skipped=0;
      o.fields.forEach(function(r){ var f=cleanField(r); if(f) fields.push(f); else skipped++; });
      if(!fields.length) throw new Error('That backup has no fields Field Scout can read. Nothing was changed.');
      var snaps={};
      if(o.snaps && typeof o.snaps==='object') Object.keys(o.snaps).forEach(function(k){ var s=o.snaps[k]; if(s && typeof s==='object' && !Array.isArray(s)) snaps[k]=s; });
      return { source:'backup', fields:fields, skipped:skipped, snaps:snaps, saved:Date.parse(o.saved)||null };
    }
    if(o && /^(FeatureCollection|Feature|Polygon|MultiPolygon|GeometryCollection)$/.test(o.type)){
      var rings=[]; geoRings(o, rings); return outlineFields(rings, 'GeoJSON');
    }
    throw new Error(NOT_OURS);
  }

  // ── What a restore would do ─────────────────────────────────────────
  function sig(f){ return JSON.stringify([f.name, f.pts, f.notes||'', (f.photos||[]).map(function(p){ return p.id; })]); }
  function samePts(a, b){ return JSON.stringify(a.pts)===JSON.stringify(b.pts); }
  function planRestore(parsed, existing){
    var byId={}, ids={}, plan={ source:parsed.source, saved:parsed.saved||null, skipped:parsed.skipped||0, snaps:parsed.snaps||{}, add:[], conflict:[], same:[], noRoom:[] };
    existing.forEach(function(f){ byId[f.id]=f; ids[f.id]=1; });
    var seen={}, room=MAX_FIELDS-existing.length, next=Date.now();
    parsed.fields.forEach(function(f){
      if(f.id!=null){ if(seen[f.id]) return; seen[f.id]=1; }
      var mine=f.id!=null ? byId[f.id] : null;
      if(mine){
        if(sig(mine)===sig(f)) plan.same.push({ theirs:f, mine:mine });
        else plan.conflict.push({ theirs:f, mine:mine, useTheirs: editedAt(f)>editedAt(mine) });
        return;
      }
      // an outline file has no id: the same outline already saved is the same field
      var twin=existing.filter(function(m){ return samePts(m, f) && (f.id==null || (m.name===f.name && (m.notes||'')===(f.notes||''))); })[0];
      if(twin){ plan.same.push({ theirs:f, mine:twin }); return; }
      if(f.id==null){ while(ids[next]) next++; f.id=next++; }
      ids[f.id]=1;
      if(room>0){ plan.add.push(f); room--; } else plan.noRoom.push(f);
    });
    return plan;
  }

  // ── The preview panel ───────────────────────────────────────────────
  function panel(){
    var p=document.getElementById('fs-restore');
    if(!p){
      p=document.createElement('div'); p.id='fs-restore'; p.className='fs-restore'; p.setAttribute('role','region'); p.setAttribute('aria-labelledby','fs-restore-h');
      var after=document.getElementById('fs-saved');
      if(after && after.parentNode) after.parentNode.insertBefore(p, after.nextSibling); else document.body.appendChild(p);
    }
    return p;
  }
  function closePanel(){ var p=document.getElementById('fs-restore'); if(p && p.parentNode) p.parentNode.removeChild(p); _plan=null; }
  function show(html, focus){
    var p=panel(); p.innerHTML=html;
    p.querySelectorAll('[data-fsr="close"]').forEach(function(b){ b.addEventListener('click', closePanel); });
    var go=p.querySelector('[data-fsr="go"]'); if(go) go.addEventListener('click', applyPlan);
    var h=p.querySelector(focus||'#fs-restore-h'); if(h) try{ h.focus({ preventScroll:false }); h.scrollIntoView({ block:'nearest' }); }catch(e){}
    return p;
  }
  function refuse(msg){
    show('<h3 class="fs-restore-h" id="fs-restore-h" tabindex="-1">Restore from a backup</h3>'+
      '<p class="fs-restore-err" role="alert">'+esc(msg)+'</p>'+
      '<div class="fs-restore-acts"><button type="button" class="fs-save-btn" data-fsr="close">Close</button></div>');
  }
  function fieldLine(f){
    var n=(f.photos||[]).length, extra=[];
    if(f.notes && f.notes.trim()) extra.push('notes');
    if(n) extra.push(plural(n,'photo'));
    return '<b>'+esc(f.name)+'</b> <small>'+esc(f.acres)+' ac'+(extra.length?', '+extra.join(', '):'')+'</small>';
  }
  function list(items, fn){ return '<ul class="fs-restore-list">'+items.map(function(x){ return '<li>'+fn(x)+'</li>'; }).join('')+'</ul>'; }
  function renderPlan(plan, fileName){
    var photos=0; plan.add.concat(plan.conflict.map(function(c){ return c.theirs; })).forEach(function(f){ photos+=(f.photos||[]).length; });
    var h='<h3 class="fs-restore-h" id="fs-restore-h" tabindex="-1">Restore from '+esc(fileName||'a backup')+'</h3>'+
      '<p class="fs-restore-sub">'+(plan.source==='backup' ? 'Backup saved '+esc(fmtDate(plan.saved)) : esc(plan.source)+' outline')+'. Nothing changes until you press Restore.</p>';
    if(plan.add.length) h+='<div class="fs-restore-grp"><div class="fs-restore-l">Will be added ('+plan.add.length+')</div>'+list(plan.add, fieldLine)+'</div>';
    if(plan.conflict.length){
      h+='<div class="fs-restore-grp fs-restore-conf"><div class="fs-restore-l">On this phone and in the backup, but different ('+plan.conflict.length+'): pick one for each</div><ul class="fs-restore-list">'+
        plan.conflict.map(function(c, i){
          var tn=editedAt(c.theirs), mn=editedAt(c.mine);
          return '<li><fieldset class="fs-restore-pick"><legend>'+esc(c.mine.name)+(c.theirs.name!==c.mine.name?' / '+esc(c.theirs.name):'')+'</legend>'+
            '<label><input type="radio" name="fsr-c'+i+'" value="mine"'+(c.useTheirs?'':' checked')+'> Keep the one on this phone <small>(changed '+esc(fmtDate(mn))+(mn>=tn?', newer':'')+')</small></label>'+
            '<label><input type="radio" name="fsr-c'+i+'" value="theirs"'+(c.useTheirs?' checked':'')+'> Use the one in the backup <small>(changed '+esc(fmtDate(tn))+(tn>mn?', newer':'')+')</small></label>'+
          '</fieldset></li>';
        }).join('')+'</ul></div>';
    }
    if(plan.same.length) h+='<div class="fs-restore-grp"><div class="fs-restore-l">Already on this phone, no change ('+plan.same.length+')</div>'+list(plan.same, function(s){ return esc(s.mine.name); })+'</div>';
    if(plan.noRoom.length) h+='<div class="fs-restore-grp"><div class="fs-restore-l">No room ('+plan.noRoom.length+')</div><p class="fs-restore-sub">Field Scout keeps up to '+MAX_FIELDS+' fields on a device. Delete some, then restore this file again to add:</p>'+list(plan.noRoom, function(f){ return esc(f.name); })+'</div>';
    if(plan.skipped) h+='<p class="fs-restore-sub">'+plural(plan.skipped,'entry','entries')+' in the file could not be read and will be left out.</p>';
    var todo=plan.add.length+plan.conflict.length;
    if(todo){
      if(photos) h+='<label class="fs-restore-ph"><input type="checkbox" id="fsr-photos" checked> Include photos ('+photos+')</label>';
      h+='<p class="fs-restore-msg" id="fs-restore-msg" role="status"></p><div class="fs-restore-acts"><button type="button" class="fs-save-btn fs-restore-go" data-fsr="go">Restore</button><button type="button" class="fs-save-btn fs-restore-no" data-fsr="close">Cancel</button></div>';
    } else {
      h+='<p class="fs-restore-msg" role="status">'+(plan.same.length?'Everything in this file is already on this phone.':'Nothing in this file can be added.')+'</p><div class="fs-restore-acts"><button type="button" class="fs-save-btn" data-fsr="close">Close</button></div>';
    }
    _plan=plan;
    show(h);
  }
  function restoreFromFile(file){
    if(!file) return Promise.resolve();
    if(file.size>MAX_FILE){ refuse('That file is too large to be a Field Scout backup. Nothing was changed.'); return Promise.resolve(); }
    return new Promise(function(ok){
      var r=new FileReader();
      r.onerror=function(){ refuse('That file could not be read. Nothing was changed.'); ok(); };
      r.onload=function(){
        var parsed;
        try{ parsed=parseFile(String(r.result||'')); }catch(e){ refuse(e && e.message ? e.message : NOT_OURS); ok(); return; }
        renderPlan(planRestore(parsed, FSX.loadSavedFields()), file.name);
        ga('field_restore_preview', { source:parsed.source });
        ok();
      };
      r.readAsText(file);
    });
  }
  function applyPlan(){
    var plan=_plan; if(!plan) return;
    var p=document.getElementById('fs-restore'), msg=document.getElementById('fs-restore-msg');
    var ph=document.getElementById('fsr-photos'), withPhotos=!ph || ph.checked;
    var arr=FSX.loadSavedFields(), replaced=0, added=0, touched=[];
    plan.conflict.forEach(function(c, i){
      var pick=p && p.querySelector('input[name="fsr-c'+i+'"]:checked');
      if(!pick || pick.value!=='theirs') return;
      var nf=JSON.parse(JSON.stringify(c.theirs));
      if(!withPhotos) nf.photos=c.mine.photos||[];
      for(var k=0;k<arr.length;k++) if(arr[k].id===nf.id){ arr[k]=nf; replaced++; touched.push(nf.id); break; }
    });
    plan.add.forEach(function(f){
      if(arr.length>=MAX_FIELDS) return;
      var nf=JSON.parse(JSON.stringify(f));
      if(!withPhotos) nf.photos=[];
      arr.push(nf); added++; touched.push(nf.id);
    });
    if(!added && !replaced){ closePanel(); flashHint('Nothing changed: you kept the fields on this phone.', 5000); return; }
    if(!FSX.persistSavedFields(arr)){
      if(msg) msg.textContent='This phone’s storage is full, so nothing was restored. Untick Include photos and try again, or delete a saved field first.';
      return;
    }
    touched.forEach(function(id){ var s=plan.snaps[id]; if(s) try{ localStorage.setItem(snapKey(id), JSON.stringify(s)); }catch(e){} });
    FSX.renderSavedFields();
    if(FSX._activeFieldId!=null && touched.indexOf(FSX._activeFieldId)>=0) FSX.renderNotesSectionInPlace();
    var done='Restored: '+plural(added,'field')+' added'+(replaced?', '+replaced+' replaced':'')+'.';
    show('<h3 class="fs-restore-h" id="fs-restore-h" tabindex="-1">Restore done</h3><p class="fs-restore-msg" role="status">'+esc(done)+'</p>'+
      '<div class="fs-restore-acts"><button type="button" class="fs-save-btn" data-fsr="close">Close</button></div>');
    _plan=null;
    ga('field_restore', { added:added, replaced:replaced });
  }

  return { backupAll:backupAll, buildBackup:buildBackup, restoreFromFile:restoreFromFile, parseFile:parseFile, planRestore:planRestore };
};
