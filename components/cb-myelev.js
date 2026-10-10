/* components/cb-myelev.js -- "My elevators": the 3 to 6 elevators a farmer
   saves on this device, shown at the top of /cash-bids and in the homepage
   cash card. Nothing leaves the phone: the list lives in localStorage only.

   STORAGE  'agsist-my-elevators' = {v:1, items:[{key, name, town, state, zip?}]}
            at most 6. Every read and write is wrapped: a private window, a
            full disk or a hand-edited value gives an empty list, never an
            error, and a corrupted value is left alone until the next save.

   THE KEY  is the elevator network's own id for a place, the `place` field
            of dnilgis/bids data/merged-index.json and of every row in its
            shards: "operator|branch|city|state". A network card's facility,
            branch, city and state are those same four fields
            (cash-bids.html netRowsFrom), so keyOf(elev) rebuilds it without
            touching array positions, and it holds from one day's file to the
            next. A licensed-feed elevator gets the same shape from its own
            names; it is matched only while those names stay the same.

   THE NUMBERS, each from a file the site already publishes, none computed
   beyond a subtraction, and none shown when its source is missing:
     cash     merged-index.json `now[crop]`: the nearest open delivery the
              merge picked, the same row the card lists for that delivery.
     change   data/bids-prev/<ST>.json (scripts/build_bids_prev.py), the same
              rule as the homepage cash card (bids-homepage.js fillChanges):
              cash now minus the last cash on the latest trading day before
              the day this board last changed.
     basis    data/basis/<ST>.json (scripts/build_basis_history.py), the same
              lookup as the card's "from -42c" line (cash-bids.html bhLine).
     posted   the place's pricedAt.
   A licensed-feed elevator is not in the index. On /cash-bids it is filled
   from the card on screen (feed()); elsewhere it shows its name and links.

   Page hooks:
     CBMyElev.mount(el, {page:'cash-bids'|'home'})  draw the block into el
     CBMyElev.feed(elevators, pick, reveal)         cash-bids, after each render
     CBMyElev.keyOf(elev) / has(key) / toggle(elev, zip) / pinKeys(elevs, pins)
     CBMyElev.saveBtn(elev, compared)                 the card's Save button */
(function(){
  'use strict';
  var KEY = 'agsist-my-elevators', MAX = 6;
  var NET = 'https://dnilgis.github.io/bids/';
  var CROPS = ['corn', 'soybeans', 'wheat', 'sorghum', 'oats'];
  var NAMES = { corn:'Corn', soybeans:'Soy', wheat:'Wheat', sorghum:'Sorghum', oats:'Oats' };
  var CAT = { corn:'corn', soybeans:'soybeans', wheat:'wheat', sorghum:'other', oats:'other' };
  /* components/cb-alerts.js BAND: a cash outside it is not a bushel price. */
  var BAND = { corn:[2,12], soybeans:[6,32], wheat:[3,20], sorghum:[2,7], oats:[1,8] };
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var STAR = '<svg class="mye-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>';

  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  /* ── the list ──────────────────────────────────────────────────────── */
  function clean(it){
    if(!it || typeof it.key !== 'string' || !it.key || it.key.length > 300) return null;
    var o = { key:it.key, name:String(it.name || it.key.split('|')[0] || '').slice(0, 120),
              town:String(it.town || '').slice(0, 80), state:String(it.state || '').slice(0, 4) };
    if(/^\d{5}$/.test(String(it.zip || ''))) o.zip = String(it.zip);
    return o.name ? o : null;
  }
  function read(){
    try{
      var raw = window.localStorage.getItem(KEY);
      if(!raw) return [];
      var d = JSON.parse(raw);
      if(!d || d.v !== 1 || !Array.isArray(d.items)) return [];
      var out = [], seen = {};
      d.items.forEach(function(it){ var c = clean(it); if(c && !seen[c.key]){ seen[c.key] = 1; out.push(c); } });
      return out.slice(0, MAX);
    }catch(e){ return []; }
  }
  function write(items){
    try{ window.localStorage.setItem(KEY, JSON.stringify({ v:1, items:items.slice(0, MAX) })); return true; }
    catch(e){ return false; }
  }
  function has(key){ return read().some(function(i){ return i.key === key; }); }
  function keyOf(elev){
    if(!elev) return '';
    if(elev.place) return String(elev.place);
    return [elev.facility || '', elev.branch || '', elev.city || '', elev.state || ''].join('|');
  }
  function itemOf(elev, zip){
    var it = { key:keyOf(elev), name:elev.facility || '', town:elev.town || elev.city || '', state:elev.state || '' };
    if(/^\d{5}$/.test(String(zip || ''))) it.zip = String(zip);
    return it;
  }
  /* 'saved' | 'removed' | 'full' | 'error' */
  function toggle(elev, zip){
    var k = keyOf(elev), items = read();
    if(!k) return 'error';
    if(items.some(function(i){ return i.key === k; })){
      if(!write(items.filter(function(i){ return i.key !== k; }))) return 'error';
      changed(k, false); return 'removed';
    }
    if(items.length >= MAX) return 'full';
    items.push(itemOf(elev, zip));
    if(!write(items)) return 'error';
    changed(k, true); return 'saved';
  }
  function remove(k){ var items = read(); write(items.filter(function(i){ return i.key !== k; })); changed(k, false); }
  /* Compare pins on /cash-bids are the saved elevators on screen, plus any
     the reader added this visit. */
  function pinKeys(elevators, pins){
    var saved = {}, out = (pins || []).slice();
    read().forEach(function(i){ saved[i.key] = 1; });
    (elevators || []).forEach(function(e){ if(saved[keyOf(e)] && out.indexOf(e.key) < 0 && out.length < MAX) out.push(e.key); });
    return out;
  }
  function saveBtn(elev){
    var on = has(keyOf(elev)), nm = esc(elev.facility || '');
    return '<button type="button" class="pin-btn mye-save' + (on ? ' pinned' : '') + '" data-key="' + esc(elev.key) + '" aria-pressed="' + (on ? 'true' : 'false') + '"'
      + ' aria-label="' + (on ? 'Saved: ' + nm + '. Select to remove from My elevators' : 'Save ' + nm + ' to My elevators') + '"'
      + ' title="Save to My elevators on this device. Saved elevators show first and are compared side by side.">'
      + STAR + '<span class="mye-save-t">' + (on ? 'Saved' : 'Save') + '</span></button>';
  }
  function syncBtn(btn, on){
    if(!btn) return;
    var nm = (btn.getAttribute('aria-label') || '').replace(/^Saved: |^Save /, '').replace(/\. Select to remove from My elevators$| to My elevators$/, '');
    btn.classList.toggle('pinned', !!on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on ? 'Saved: ' + nm + '. Select to remove from My elevators' : 'Save ' + nm + ' to My elevators');
    var t = btn.querySelector('.mye-save-t'); if(t) t.textContent = on ? 'Saved' : 'Save';
  }

  /* ── reading the files ─────────────────────────────────────────────── */
  function getJSON(url, ms, mode){
    return Promise.race([
      fetch(url, { cache: mode || 'default' }).then(function(r){ return r.ok ? r.json() : null; }),
      new Promise(function(res){ setTimeout(function(){ res(null); }, ms || 8000); })
    ]).catch(function(){ return null; });
  }
  var memo = {};
  function once(k, f){ if(!memo[k]) memo[k] = f(); return memo[k]; }
  function index(){ return once('idx', function(){ return getJSON(NET + 'data/merged-index.json', 12000); }); }
  function shard(path){ return once('s:' + path, function(){ return getJSON(NET + 'data/' + path, 8000); }); }
  function prevShard(st){ return once('p:' + st, function(){ return getJSON('/data/bids-prev/' + st + '.json', 6000, 'no-store'); }); }
  function basisShard(st){ return once('b:' + st, function(){ return getJSON('/data/basis/' + st + '.json', 6000, 'no-store'); }); }

  function norm(s){ return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function findPlace(idx, key){
    if(!idx || !Array.isArray(idx.places)) return null;
    var hit = null, k = key.split('|'), loose = norm(k[0]) + '|' + norm(k[2]) + '|' + norm(k[3]), alt = null, n = 0;
    for(var i = 0; i < idx.places.length; i++){
      var p = idx.places[i]; if(!p) continue;
      if(p.place === key){ hit = p; break; }
      if(norm(p.operator) + '|' + norm(p.city) + '|' + norm(p.state) === loose && norm(p.branch) === norm(k[1])){ alt = p; n++; }
    }
    return hit || (n === 1 ? alt : null);
  }

  /* ── dates, Central time (bids-homepage.js) ────────────────────────── */
  function ctDate(t){
    var d = new Date(t); if(t == null || t === '' || isNaN(d)) return '';
    try{ return d.toLocaleDateString('en-CA', { timeZone:'America/Chicago' }); }catch(e){ return ''; }
  }
  function ctToday(){ return ctDate(Date.now()); }
  function dayShift(ds, n){ var d = new Date(ds + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function isWeekend(ds){ var g = new Date(ds + 'T12:00:00Z').getUTCDay(); return g === 0 || g === 6; }
  function prevWeekday(ds){ var x = dayShift(ds, -1); while(isWeekend(x)) x = dayShift(x, -1); return x; }
  function lastWeekday(ds){ var x = ds; while(isWeekend(x)) x = dayShift(x, -1); return x; }
  function dayName(ds){ var d = new Date(ds + 'T12:00:00Z'); return isNaN(d) ? ds : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()]; }
  function shortDate(ds){
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ds || '')); if(!m) return '';
    return MON[+m[2] - 1] + ' ' + (+m[3]) + (String(+m[1]) === ctToday().slice(0, 4) ? '' : ' ’' + m[1].slice(2));
  }
  function posted(t){
    var ds = ctDate(t); if(!ds) return null;
    var today = ctToday(), txt;
    if(ds === today){
      try{ txt = new Date(t).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', timeZone:'America/Chicago' }) + ' CT'; }catch(e){ txt = 'today'; }
    } else if(ds > dayShift(today, -6)) txt = dayName(ds);
    else txt = shortDate(ds);
    /* bids-homepage.js staleSince(): older than the latest finished trading day. */
    return { txt:'posted ' + txt, old: ds < prevWeekday(today) };
  }

  /* ── numbers as the card prints them ───────────────────────────────── */
  function ppu(raw){ return raw == null ? null : (raw > 30 ? raw / 100 : raw); }
  function fmtPx(v){
    var r = Math.round(Math.abs(v) * 10000) / 10000, s = r.toFixed(4).replace(/0+$/, '');
    if(s.length - s.indexOf('.') - 1 < 2) s = r.toFixed(2);
    return s;
  }
  function quarterCents(c){ return AG.px.move(c, { style: 'slash', cent: false }); }
  function centsTxt(c){ return c === 0 ? 'even' : (c > 0 ? '+' : '−') + Math.abs(c) + '¢'; }
  function delLabel(period, delivery){
    var m = /^(\d{4})-(\d{2})(?:\/(\d{4})-(\d{2}))?$/.exec(period || '');
    if(m && MON[+m[2] - 1]) return MON[+m[2] - 1] + (m[3] && m[4] !== m[2] && MON[+m[4] - 1] ? '–' + MON[+m[4] - 1] : '') + ' ' + (m[3] || m[1]);
    var s = /^newcrop-(\d{4})$/.exec(period || '');
    if(s) return 'new crop ' + s[1];
    return String(delivery || '').slice(0, 16);
  }
  function fnv(s){
    var h = 0x811c9dc5;
    for(var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function bhNorm(v){ return String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, ' '); }

  /* The day's change: bids-homepage.js fillChanges(), same file, same rule. */
  function dayChange(prev, place, crop, period, cash, on){
    var hist = prev && prev.rows && prev.rows[fnv(place + '|' + crop + '|' + period)];
    if(!Array.isArray(hist) || !on || cash == null) return null;
    var p = null;
    for(var h = 0; h < hist.length; h++){ if(hist[h] && hist[h][0] < on && hist[h][1] != null) p = hist[h]; }
    if(!p) return null;
    var d = (cash - p[1]) * 100, gap = p[0] < prevWeekday(on) || on !== lastWeekday(ctToday());
    var flat = Math.abs(d) < 0.125;
    return { cls: flat ? 'is-flat' : (d > 0 ? 'is-up' : 'is-dn'),
             txt: (flat ? 'unch' : (d > 0 ? '▲' : '▼') + quarterCents(d) + '¢') + (gap ? ' ' + dayName(p[0]) : ''),
             label: (flat ? 'unchanged' : (d > 0 ? 'up ' : 'down ') + quarterCents(d) + ' cents') + ' since ' + dayName(p[0]) + ' ' + shortDate(p[0]) };
  }
  /* The basis line: cash-bids.html bhLoadState() + bhLine(), as facts. */
  function basisMap(sh){
    if(!sh || !sh.r) return null;
    var m = {}, f = sh.f || [], d = sh.d || [], c = sh.c || ['corn','soybeans','wheat','other'];
    var when = function(i){ return (i == null || i >= d.length) ? null : d[i]; };
    sh.r.forEach(function(r){
      var fc = String(f[r[0]] || '').split('|');
      m[[bhNorm(fc[0]), bhNorm(fc[1]), bhNorm(sh.state), bhNorm(c[r[1]]), bhNorm(r[2]), bhNorm(r[3])].join('|')] =
        { cur:r[4], prev:r[5], since:when(r[6]), first:when(r[7]), last:when(r[8]) };
    });
    return m;
  }
  function sane(c){ return c != null && Math.abs(c) <= 300; }
  function basisFact(h, live){
    if(!h || live == null || !sane(live) || !sane(h.cur)) return null;
    if(h.cur === live){
      if(h.prev == null) return h.first ? { kind:'same', date:h.first } : null;
      return (h.since && sane(h.prev)) ? { kind:'moved', date:h.since, from:h.prev } : null;
    }
    return h.last ? { kind:'after', date:h.last, from:h.cur } : null;
  }

  /* ── one saved elevator's facts ────────────────────────────────────── */
  function factsFromNetwork(item, p){
    var st = String(p.state || '').toUpperCase(), on = ctDate(p.pricedAt), month = ctToday().slice(0, 7);
    var crops = [];
    CROPS.forEach(function(crop){
      var n = p.now && p.now[crop];
      if(!n || typeof n.cash !== 'number' || (p.currency || 'USD') !== 'USD') return;
      var cash = ppu(n.cash);
      if(!(cash >= BAND[crop][0] && cash <= BAND[crop][1])) return;
      var end = String(n.period || '').split('/').pop();
      if(/^\d{4}-\d{2}/.test(end) && end.slice(0, 7) < month) return;
      crops.push({ crop:crop, cash:cash, period:String(n.period || ''), del:delLabel(n.period, n.delivery), delivery:n.delivery || '', commodity:n.commodity || '',
                   basis:typeof n.basisCents === 'number' ? Math.round(n.basisCents) : null });
    });
    return Promise.all([prevShard(st), basisShard(st), p.shard ? shard(p.shard) : null]).then(function(a){
      var prev = a[0], bm = basisMap(a[1]), sh = a[2], stale = false, facts = [];
      crops.forEach(function(c){
        c.chg = dayChange(prev, p.place, c.crop, c.period, c.cash, on);
        /* The shard row this `now` came from: its contract and its read flag. */
        var row = null;
        if(sh && Array.isArray(sh.bids)) sh.bids.forEach(function(b){
          if(!row && b && b.crop === c.crop && String(b.period || '') === c.period && String(b.delivery || '') === c.delivery && ppu(b.cash) === c.cash) row = b;
        });
        if(row && row.stale === true) stale = true;
        if(row && bm){
          var h = bm[[bhNorm(p.operator), bhNorm(p.city), bhNorm(st), bhNorm(CAT[c.crop]), bhNorm(row.futuresMonth || ''), bhNorm(row.delivery || '')].join('|')];
          var f = basisFact(h, c.basis);
          if(f){ f.crop = c.crop; facts.push(f); }
        }
      });
      /* No usable row at all and the board's rows are flagged: say it was not reached. */
      if(!crops.length && sh && Array.isArray(sh.bids) && sh.bids.some(function(b){ return b && b.stale === true; })) stale = true;
      return { item:item, crops:crops, posted:posted(p.pricedAt), stale:stale, basis:basisLine(facts),
               elev:{ facility:p.operator, city:p.city, town:p.town || p.city, state:p.state, commodities: crops.some(function(c){ return c.crop === 'corn'; }) ? { corn:[1] } : {} } };
    });
  }
  function basisLine(facts){
    var moved = facts.filter(function(f){ return f.kind !== 'same'; });
    if(moved.length){
      moved.sort(function(a, b){ return a.date < b.date ? 1 : -1; });
      var f = moved[0];
      return NAMES[f.crop] + ' basis changed ' + (f.kind === 'after' ? 'after ' : '') + shortDate(f.date) + ', was ' + centsTxt(f.from);
    }
    if(facts.length){
      var last = facts.reduce(function(m, f){ return f.date > m ? f.date : m; }, '');
      return last ? 'Basis unchanged since ' + shortDate(last) : '';
    }
    return '';
  }
  /* A licensed-feed elevator, from the card the page drew (cash-bids only). */
  var fed = {}, pickFn = null, revealFn = null, compareFn = null;
  function factsFromCard(item, e){
    var crops = [];
    if(pickFn) ['corn', 'soybeans', 'wheat'].forEach(function(crop){
      var r = pickFn(e, crop);
      if(r && r.cash != null && r.cash >= BAND[crop][0] && r.cash <= BAND[crop][1]) crops.push({ crop:crop, cash:r.cash, del:r.del || '' });
    });
    return { item:item, crops:crops, posted:e.asOfT != null ? posted(e.asOfT) : null, stale:!!e.unread, basis:'', elev:e };
  }
  function factsFor(item){
    return index().then(function(idx){
      var p = findPlace(idx, item.key);
      /* A board the merge left out of `now` (its read failed) still has a
         card on /cash-bids, flagged; the row then reads that card. */
      if(p) return factsFromNetwork(item, p).then(function(f){ return (!f.crops.length && fed[item.key]) ? factsFromCard(item, fed[item.key]) : f; });
      if(fed[item.key]) return factsFromCard(item, fed[item.key]);
      var k = item.key.split('|');
      return { item:item, crops:[], posted:null, stale:false, basis:'', elev:{ facility:item.name, city:k[2] || '', town:item.town, state:item.state, commodities:{} } };
    });
  }

  /* ── drawing ───────────────────────────────────────────────────────── */
  var mounts = [], editing = false;
  function cardHref(it){
    return '/cash-bids?' + (it.zip ? 'zip=' + it.zip + '&' : '') + 'elev=' + encodeURIComponent(it.key);
  }
  function rowHTML(f, page){
    var it = f.item, where = [it.town, it.state].filter(Boolean).join(', ');
    var h = '<li class="mye-row" data-key="' + esc(it.key) + '"><div class="mye-main">'
      + '<div class="mye-top"><a class="mye-name" href="' + esc(cardHref(it)) + '">' + esc(it.name) + '</a>'
      + (where ? '<span class="mye-town">' + esc(where) + '</span>' : '') + '</div>';
    if(f.crops.length){
      h += '<div class="mye-crops">' + f.crops.map(function(c){
        return '<span class="mye-c"><span class="mye-cn">' + NAMES[c.crop] + '</span> <b class="mye-px">$' + fmtPx(c.cash) + '</b>'
          + (c.chg ? ' <span class="mye-chg ' + c.chg.cls + '" aria-label="' + esc(c.chg.label) + '" title="' + esc(c.chg.label) + '">' + esc(c.chg.txt) + '</span>' : '')
          + (c.del ? ' <span class="mye-del">' + esc(c.del) + '</span>' : '') + '</span>';
      }).join('') + '</div>';
    }
    var sub = [];
    if(f.posted) sub.push('<span class="mye-posted' + (f.posted.old ? ' is-old' : '') + '">' + esc(f.posted.txt) + '</span>');
    if(f.stale) sub.push('<span class="mye-posted is-old">board not reached on the last read</span>');
    if(f.basis) sub.push('<span>' + esc(f.basis) + '</span>');
    if(sub.length) h += '<div class="mye-sub">' + sub.join('<span aria-hidden="true"> · </span>') + '</div>';
    h += '</div>';
    if(window.CBAlerts) h += window.CBAlerts.bell(f.elev);
    if(page === 'cash-bids') h += '<button type="button" class="mye-x"' + (editing ? '' : ' hidden') + ' aria-label="Remove ' + esc(it.name) + ' from My elevators">Remove</button>';
    return h + '</li>';
  }
  var drawSeq = 0;
  function draw(m){
    var items = read(), el = m.el, seq = ++drawSeq;
    m.seq = seq;
    if(!items.length){ el.hidden = true; el.innerHTML = ''; return; }
    Promise.all(items.map(function(it){ return factsFor(it).catch(function(){ return { item:it, crops:[], basis:'', elev:{ facility:it.name, state:it.state, commodities:{} } }; }); })).then(function(list){
      if(m.seq !== seq) return;
      /* An alert form open in a row that is still listed: do not wipe what they typed. */
      var keys = items.map(function(i){ return i.key; }).join('\n'), busy = false;
      Array.prototype.forEach.call(el.querySelectorAll('.mye-row'), function(r){ if(r.querySelector('.cba-card:not([hidden])')) busy = true; });
      if(busy && m.keys === keys && !m.force) return;
      m.keys = keys; m.force = false;
      var h = '<section class="mye" aria-labelledby="mye-h-' + m.page + '"><div class="mye-head"><h2 class="mye-h" id="mye-h-' + m.page + '">' + STAR + ' My elevators</h2>'
        + (m.page === 'cash-bids'
           ? '<button type="button" class="mye-edit" aria-pressed="' + (editing ? 'true' : 'false') + '">' + (editing ? 'Done' : 'Edit') + '</button>'
           : '<a class="mye-edit" href="/cash-bids">Edit</a>')
        + '</div>' + (m.page === 'cash-bids' && compareFn && items.filter(function(i){ return fed[i.key]; }).length >= 2
           ? '<button type="button" class="mye-cmp">Compare ' + items.filter(function(i){ return fed[i.key]; }).length + ' side by side</button>' : '')
        + '<ul class="mye-list">' + list.map(function(f){ return rowHTML(f, m.page); }).join('') + '</ul>'
        + (m.page === 'cash-bids' ? '<p class="mye-note">Saved on this phone only. Watch sends an email when a price or basis moves.</p>' : '')
        + '</section>';
      el.innerHTML = h; el.hidden = false;
    });
  }
  function changed(k, saved){
    mounts.forEach(draw);
    if(k) try{ document.dispatchEvent(new CustomEvent('agsist-myelev', { detail:{ key:k, saved:saved } })); }catch(err){}
  }
  function mount(el, opts){
    if(!el) return;
    var m = { el:el, page:(opts && opts.page) || 'home' };
    mounts.push(m);
    el.addEventListener('click', function(e){
      var t = e.target;
      if(t.closest && t.closest('.mye-cmp')){ if(compareFn) compareFn(); return; }
      var ed = t.closest && t.closest('button.mye-edit');
      if(ed){ editing = !editing; mounts.forEach(function(x){ x.force = true; }); changed(); return; }
      var x = t.closest && t.closest('.mye-x');
      if(x){
        var k = x.closest('.mye-row').getAttribute('data-key');
        remove(k);
        return;
      }
      var a = t.closest && t.closest('a.mye-name');
      if(a && m.page === 'cash-bids' && !(e.metaKey || e.ctrlKey || e.shiftKey)){
        if(goTo(a.closest('.mye-row').getAttribute('data-key'))) e.preventDefault();
      }
    });
    if(m.page === 'home' && !window.CBAlerts) loadAlerts();
    draw(m);
    return m;
  }
  /* The homepage has no alert script of its own; Watch needs it. */
  function loadAlerts(){
    if(document.querySelector('script[src*="cb-alerts.js"]')) return;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/components/cb-alerts.css?v=2'; document.head.appendChild(l);
    var s = document.createElement('script'); s.src = '/components/cb-alerts.js?v=2'; s.defer = true;
    s.onload = function(){ mounts.forEach(function(m){ m.force = true; draw(m); }); }; document.head.appendChild(s);
  }
  window.addEventListener('storage', function(e){ if(e.key === KEY) changed(); });
  function autoMount(){
    Array.prototype.forEach.call(document.querySelectorAll('[data-myelev]'), function(el){
      if(!el.__mye){ el.__mye = 1; mount(el, { page:el.getAttribute('data-myelev') }); }
    });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount); else autoMount();

  /* ── /cash-bids: the cards on screen ───────────────────────────────── */
  function cardFor(key){
    var e = fed[key]; if(!e) return null;
    try{ return document.querySelector('.elev-card[data-elev-key="' + CSS.escape(e.key) + '"]'); }catch(err){ return null; }
  }
  function flash(card){
    card.classList.add('mye-flash');
    try{ card.scrollIntoView({ behavior:'smooth', block:'start' }); }catch(err){ card.scrollIntoView(); }
    setTimeout(function(){ card.classList.remove('mye-flash'); }, 2200);
  }
  function goTo(key){
    var card = cardFor(key);
    if(!card && fed[key] && revealFn){ revealFn(); card = cardFor(key); }
    if(card){ flash(card); var n = card.querySelector('.elev-name'); if(n){ n.setAttribute('tabindex', '-1'); try{ n.focus({ preventScroll:true }); }catch(err){} } return true; }
    return false;   /* not in this search: the link runs the search it was saved from */
  }
  var wantKey = null;
  try{ wantKey = new URLSearchParams(window.location.search).get('elev'); }catch(e){}
  function feed(elevators, pick, reveal, compare){
    fed = {}; pickFn = pick || pickFn; revealFn = reveal || revealFn; compareFn = compare || compareFn;
    (elevators || []).forEach(function(e){ var k = keyOf(e); if(k && !fed[k]) fed[k] = e; });
    /* A licensed-feed elevator gets its numbers from the cards: redraw once they exist. */
    var need = read().some(function(i){ return fed[i.key]; }) || mounts.some(function(m){ return m.el.querySelector('.mye-cmp'); });
    if(need) changed();
    if(wantKey && fed[wantKey]){ var k = wantKey; wantKey = null; setTimeout(function(){ goTo(k); }, 60); }
  }

  window.CBMyElev = { KEY:KEY, MAX:MAX, list:read, has:has, keyOf:keyOf, toggle:toggle, remove:remove, pinKeys:pinKeys,
                      saveBtn:saveBtn, syncBtn:syncBtn, mount:mount, feed:feed, goTo:goTo, refresh:changed };
})();
