/* storesell.js: the homepage "Store or sell?" carry, from one elevator's own
 * posted later-delivery bids.
 *
 * The reader picks an elevator and crop in the calculator's "Price from" box
 * (homepage-extras.js). This file lists that elevator's posted delivery
 * periods for the crop: the nearest open one (sell now) and each later month
 * it posts. For each later month:
 *
 *   carry   = later posted cash - nearest posted cash   (same board, same read)
 *   storage = your storage cost x months
 *   interest= nearest posted cash x your rate x months / 12   (only if entered)
 *   shrink  = your shrink % x later posted cash                (only if entered)
 *   net     = carry - storage - interest - shrink
 *
 * months = delivery month minus the nearest open month. Nothing else goes in:
 * no futures spread, no guess for a month the elevator does not post. A month
 * in the next crop year is new crop, not storage, and is left out with a note.
 *
 * Where the bids come from: an elevator from the bids network has its own
 * shard in dnilgis/bids (data/merged/...json, every period it posts, one
 * pricedAt for the whole board). The homepage card only carries each crop's
 * nearest period, so the shard is read when the calculator is opened. A
 * licensed-feed elevator brings all its periods with the card's own rows
 * (option.periods, built in bids-homepage.js storeOptions).
 *
 * The farmer's storage cost, rate and shrink are kept in localStorage
 * (agsist_storesell) so they are there next visit. A blocked store is fine.
 */
(function(root){
  'use strict';

  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var MONTH = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // ── Pure parts (test/storesell.test.mjs runs these) ─────────────────────
  function ym(k){ var m = /^(\d{4})-(\d{2})$/.exec(String(k || '')); return m ? { y: +m[1], m: +m[2] } : null; }
  function monthsApart(a, b){ var x = ym(a), y = ym(b); return (x && y) ? (y.y - x.y) * 12 + (y.m - x.m) : null; }
  function shortMon(k){ var x = ym(k); return x ? MON[x.m - 1] + ' \'' + String(x.y).slice(2) : ''; }
  function longMon(k){ var x = ym(k); return x ? MONTH[x.m - 1] : ''; }
  /* First month of the next crop year after `k`: September for corn,
     soybeans and sorghum, June for wheat and oats. */
  function newCropFrom(k, crop){
    var x = ym(k); if(!x) return '';
    var ncm = (crop === 'wheat' || crop === 'oats' || crop === 'barley') ? 6 : 9;
    var y = x.m < ncm ? x.y : x.y + 1;
    return y + '-' + (ncm < 10 ? '0' : '') + ncm;
  }

  /* rows: [{start:'YYYY-MM', end:'YYYY-MM', cash:Number}] for one elevator,
     one crop, one grade, already cleared of closed periods. The nearest start
     is "now"; a later period starts after the nearest one ends. Two rows for
     the same start month keep the higher cash. */
  function buildPeriods(rows, crop){
    var by = {};
    (rows || []).forEach(function(r){
      if(!r || !ym(r.start) || typeof r.cash !== 'number' || !isFinite(r.cash) || r.cash <= 0) return;
      var end = ym(r.end) && r.end >= r.start ? r.end : r.start;
      var o = by[r.start];
      if(!o || r.cash > o.cash) by[r.start] = { start: r.start, end: end, cash: r.cash };
    });
    var keys = Object.keys(by).sort();
    if(!keys.length) return null;
    var spot = by[keys[0]], cut = newCropFrom(spot.start, crop), later = [], dropped = [];
    for(var i = 1; i < keys.length; i++){
      var p = by[keys[i]];
      if(p.start <= spot.end) continue;            // inside the nearest window: not later
      if(cut && p.start >= cut){ dropped.push(p.start); continue; }
      later.push({ key: p.start, cash: p.cash, months: monthsApart(spot.start, p.start),
                   carry: p.cash - spot.cash });
    }
    return { spot: spot, later: later, newCrop: dropped };
  }

  /* inputs: {cost: $/bu/mo or null, rate: %/yr or null, shrink: % or null}.
     A null optional input is left out, never read as zero typed in. Without a
     storage cost there is no net. */
  function netFor(p, spotCash, inputs){
    inputs = inputs || {};
    var out = { carry: p.carry, storage: null, interest: null, shrink: null, net: null };
    if(inputs.cost == null || !isFinite(inputs.cost)) return out;
    out.storage = inputs.cost * p.months;
    out.interest = inputs.rate == null ? 0 : spotCash * (inputs.rate / 100) * p.months / 12;
    out.shrink = inputs.shrink == null ? 0 : (inputs.shrink / 100) * p.cash;
    out.net = p.carry - out.storage - out.interest - out.shrink;
    return out;
  }

  /* The period the plain line talks about: the reader's own pick if it is
     still posted, else the best net, else (no storage cost yet) the biggest
     carry. Ties go to the earlier month. */
  function pickPeriod(model, inputs, wanted){
    var L = model && model.later || [];
    if(!L.length) return null;
    for(var i = 0; i < L.length; i++) if(L[i].key === wanted) return L[i];
    var best = null, bv = -Infinity;
    L.forEach(function(p){
      var n = netFor(p, model.spot.cash, inputs), v = n.net == null ? p.carry : n.net;
      if(v > bv + 1e-9){ bv = v; best = p; }
    });
    return best;
  }

  /* Quarter cents for posted prices and carry; whole cents for a net that
     mixes in the reader's costs. */
  function qc(cents){
    var a = Math.abs(cents), w = Math.floor(a + 1e-9), f = Math.round((a - w) * 4);
    if(f === 4){ w++; f = 0; }
    var q = ['', '1/4', '1/2', '3/4'][f];
    return w ? w + (f ? ' ' + q : '') : (f ? q : '0');
  }
  function carryText(d){ var c = d * 100; return Math.abs(c) < 0.125 ? 'even' : (c > 0 ? '+' : '−') + qc(c) + '¢'; }
  function netCents(d){ return Math.round(d * 100); }
  function netText(d){ var c = netCents(d); return c === 0 ? '0¢' : (c > 0 ? '+' : '−') + Math.abs(c) + '¢'; }
  function cashQ(d){
    var c = Math.round(d * 400) / 4, whole = Math.floor(c + 1e-9), f = Math.round((c - whole) * 4);
    if(f === 4){ whole++; f = 0; }
    return '$' + (whole / 100).toFixed(2) + (f ? ' ' + ['', '1/4', '1/2', '3/4'][f] : '');
  }

  /* The plain line. `p` is the picked later period. */
  function headline(model, p, inputs, where){
    if(!model) return '';
    if(!p){
      return where + ' posts no ' + (model.cropWord || 'crop') + ' bid later than ' + shortMon(model.spot.start)
        + (model.newCrop && model.newCrop.length ? ' for this year\u2019s crop' : '') + '. Enter the carry you expect below.';
    }
    var to = longMon(p.key), n = netFor(p, model.spot.cash, inputs);
    if(n.net == null){
      return 'Holding to ' + to + ' at ' + where + ': the posted carry is ' + carryText(p.carry)
        + ' a bushel. Enter your storage cost to see what it nets.';
    }
    var c = netCents(n.net), left = [];
    if(inputs.rate == null) left.push('interest');
    if(inputs.shrink == null) left.push('shrink');
    var tail = left.length ? ' ' + left.join(' and ').replace(/^./, function(x){ return x.toUpperCase(); }) + ' not counted.' : '';
    if(c === 0) return 'Holding to ' + to + ' at ' + where + ' about breaks even after your costs.' + tail;
    return 'Holding to ' + to + ' at ' + where + (c > 0 ? ' nets +' + c : ' loses ' + Math.abs(c))
      + ' cent' + (Math.abs(c) === 1 ? '' : 's') + ' a bushel after your costs.' + tail;
  }

  var core = { buildPeriods: buildPeriods, netFor: netFor, pickPeriod: pickPeriod, headline: headline,
               newCropFrom: newCropFrom, monthsApart: monthsApart, carryText: carryText, netText: netText,
               shortMon: shortMon, longMon: longMon, cashQ: cashQ };
  root.AgsistStoreSell = core;
  if(typeof document === 'undefined') return;

  // ── Browser parts ──────────────────────────────────────────────────────
  var KEY = 'agsist_storesell';
  var BOX = { cost: 'idx1-calc-cost', rate: 'idx1-calc-rate', shrink: 'idx1-calc-shrink' };
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function readInputs(){
    var o = {};
    ['cost', 'rate', 'shrink'].forEach(function(k){
      var el = $(BOX[k]), v = el ? String(el.value).trim() : '', n = v === '' ? null : parseFloat(v);
      var ok = n != null && isFinite(n) && n >= 0 && (k === 'cost' || n <= (k === 'rate' ? 30 : 20));
      o[k] = ok ? n : null;
    });
    return o;
  }
  function restore(){
    var s = null;
    try{ s = JSON.parse(window.localStorage.getItem(KEY) || 'null'); }catch(e){ s = null; }
    if(!s || typeof s !== 'object') return;
    Object.keys(BOX).forEach(function(k){
      var el = $(BOX[k]);
      if(el && el.value === '' && typeof s[k] === 'string' && /^\d*\.?\d+$/.test(s[k])) el.value = s[k];
    });
  }
  function save(){
    var s = {};
    Object.keys(BOX).forEach(function(k){ var el = $(BOX[k]); s[k] = el ? String(el.value).trim() : ''; });
    try{ window.localStorage.setItem(KEY, JSON.stringify(s)); }catch(e){}
  }

  function ctTime(iso){
    var d = new Date(iso); if(!iso || isNaN(d)) return '';
    try{ return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }) + ' CT'; }
    catch(e){ return ''; }
  }
  function thisMonth(){
    try{ return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }).slice(0, 7); }
    catch(e){ return new Date().toISOString().slice(0, 7); }
  }

  /* One shard row into {start, end, cash}, with the card's own month rule
     (bids-homepage.js rowMonthKey: spot, newcrop-YYYY and oldcrop-YYYY
     tokens, open windows count as this month). */
  function shardRow(b, crop){
    var H = window.__agsistHomeBidsInternals;
    var per = String(b.period || '');
    var start = H && H.rowMonthKey ? H.rowMonthKey({ deliveryStart: per, deliveryMonth: '', deliveryEnd: '', category: crop, netCrop: crop }) : '';
    if(!start) { var m0 = /^(\d{4}-\d{2})/.exec(per); start = m0 ? m0[1] : ''; }
    if(!start || start < thisMonth()) return null;
    var m = /^(\d{4}-\d{2})(?:\/(\d{4}-\d{2}))?/.exec(per);
    var end = m ? (m[2] || m[1]) : start;
    if(end < start) end = start;
    var c = typeof b.cash === 'number' ? (b.cash > 30 ? b.cash / 100 : b.cash) : null;
    return { start: start, end: end, cash: c };
  }
  function norm(s){ return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

  var idxP = null, shardP = {};
  function base(){ return (window.AGSIST_BIDS_NET && window.AGSIST_BIDS_NET.BASE) || 'https://dnilgis.github.io/bids/'; }
  function getJson(path){
    var f = fetch(base() + path, { cache: 'default' }).then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; });
    return Promise.race([f, new Promise(function(res){ setTimeout(function(){ res(null); }, 12000); })]);
  }
  /* Same URL and cache mode bids-network.js already used for the card, so
     the browser answers it from cache. */
  function shardFor(place){
    if(!idxP) idxP = getJson('data/merged-index.json').then(function(j){ if(!j) idxP = null; return j; });
    return idxP.then(function(idx){
      var hit = null, ps = idx && idx.places || [];
      for(var i = 0; i < ps.length; i++) if(ps[i] && ps[i].place === place){ hit = ps[i]; break; }
      if(!hit || !hit.shard || !/^merged\/[a-z0-9._-]+\.json$/i.test(hit.shard)) return null;
      if(!shardP[hit.shard]) shardP[hit.shard] = getJson('data/' + hit.shard).then(function(s){ if(!s) delete shardP[hit.shard]; return s; });
      return shardP[hit.shard];
    });
  }

  /* The model for one option: {spot, later, newCrop, posted, postedKind}, or
     {failed:true} when the elevator's board could not be read. */
  function modelFor(o){
    var crop = o.crop, word = String(o.cropName || crop || '').toLowerCase();
    function done(rows, posted, kind){
      var m = buildPeriods(rows, crop);
      if(!m) return { failed: true };
      m.posted = posted || ''; m.postedKind = kind; m.cropWord = word;
      return m;
    }
    if(o.place){
      return shardFor(o.place).then(function(s){
        if(!s || !Array.isArray(s.bids)) return { failed: true };
        var want = norm(o.commodity), rows = [];
        s.bids.forEach(function(b){
          if(!b || b.crop !== crop || b.periodPast === true || (b.currency || 'USD') !== 'USD') return;
          if(want && norm(b.commodity) !== want) return;
          var r = shardRow(b, crop); if(r) rows.push(r);
        });
        return done(rows, s.pricedAt || s.checkedAt, 'posted');
      });
    }
    return Promise.resolve(done(o.periods || [], o.posted, 'read'));
  }

  var cur = null;   // {opt, model, picked, hooks, seq}
  var seq = 0;

  function render(){
    var box = $('ss-posted');
    if(!box || !cur) return;
    var m = cur.model, o = cur.opt, inputs = readInputs();
    var town = String(o.city || '').replace(/,\s*[A-Z]{2}$/, '').trim();
    if(town && String(o.where || '').toLowerCase().indexOf(town.toLowerCase()) >= 0) town = '';
    if(!m){ box.hidden = true; return; }
    /* The plain line is one live node that keeps its place; the table under
       it is redrawn without being read out on every keystroke. */
    var line = $('ss-line'), body = $('ss-body');
    if(!line || !body){
      box.innerHTML = '<p class="ss-line" id="ss-line" role="status"></p><div id="ss-body"></div>';
      line = $('ss-line'); body = $('ss-body');
    }
    var whereText = (o.where || 'this elevator') + (town ? ', ' + town : '');
    if(m.failed){
      line.textContent = 'Could not load the later bids at ' + whereText + ' just now. Enter the carry you expect below.';
      body.innerHTML = '';
      box.hidden = false;
      cur.hooks.fill(null);
      return;
    }
    var p = pickPeriod(m, inputs, cur.picked);
    var txt = headline(m, p, inputs, whereText), html = '';
    if(line.textContent !== txt) line.textContent = txt;
    if(m.later.length){
      var withNet = inputs.cost != null;
      html += '<div class="ss-tablewrap"><table class="ss-table"><caption class="visually-hidden">Posted bids at this elevator by delivery month</caption>'
        + '<thead><tr><th scope="col">Deliver</th><th scope="col">Posted bid</th><th scope="col">Carry</th>'
        + (withNet ? '<th scope="col">Net after your costs</th>' : '') + '</tr></thead><tbody>'
        + '<tr class="ss-now"><th scope="row">' + esc(shortMon(m.spot.start)) + '</th><td>' + esc(cashQ(m.spot.cash)) + '</td><td colspan="' + (withNet ? 2 : 1) + '">Sell now</td></tr>';
      m.later.forEach(function(q){
        var n = netFor(q, m.spot.cash, inputs), on = p && q.key === p.key;
        var cls = n.net == null ? '' : (netCents(n.net) > 0 ? ' ss-up' : netCents(n.net) < 0 ? ' ss-dn' : '');
        html += '<tr' + (on ? ' class="ss-on"' : '') + '><th scope="row"><button type="button" class="ss-pick" data-k="' + esc(q.key) + '" aria-pressed="' + (on ? 'true' : 'false') + '">'
          + esc(shortMon(q.key)) + '<span class="ss-mo">' + q.months + ' mo</span></button></th>'
          + '<td>' + esc(cashQ(q.cash)) + '</td><td>' + esc(carryText(q.carry)) + '</td>'
          + (withNet ? '<td class="ss-net' + cls + '">' + esc(netText(n.net)) + '</td>' : '') + '</tr>';
      });
      html += '</tbody></table></div>';
    }
    var fine = [];
    var t = ctTime(m.posted);
    if(t) fine.push((m.postedKind === 'posted' ? 'Bids posted by the elevator ' : 'Bids read from the feed ') + t + '.');
    if(m.later.length){
      fine.push('Carry is the later bid minus the ' + shortMon(m.spot.start) + ' bid of ' + cashQ(m.spot.cash) + '. Net takes off your storage for the months shown'
        + (inputs.rate != null ? ', interest on ' + cashQ(m.spot.cash) : '') + (inputs.shrink != null ? ', shrink on the later bid' : '') + '. '
        + (cur.userPicked ? 'Tap another month to compare.' : 'The line above is the month that '
        + (inputs.cost != null ? 'nets the most' : 'pays the most carry') + '; tap another month to compare.'));
    }
    if(m.newCrop.length) fine.push(m.newCrop.map(shortMon).join(', ') + ' left out: that is next year’s crop, not stored grain.');
    if(fine.length) html += '<p class="idx1-extras-fine ss-fine">' + esc(fine.join(' ')) + '</p>';
    body.innerHTML = html;
    box.hidden = false;
    var btns = box.querySelectorAll('.ss-pick');
    for(var i = 0; i < btns.length; i++) btns[i].addEventListener('click', function(){ cur.picked = this.getAttribute('data-k'); cur.userPicked = true; render(); });
    cur.hooks.fill(p ? { carry: p.carry, months: p.months, from: shortMon(m.spot.start), to: shortMon(p.key), spotCash: m.spot.cash } : null);
  }

  function opened(){
    var d = $('idx1-store-sell'), f = d && d.closest && d.closest('details');
    return !f || f.open;
  }
  function load(){
    if(!cur || cur.loading || cur.model) return;
    var mine = cur;
    mine.loading = true;
    modelFor(mine.opt).then(function(m){
      if(cur !== mine) return;
      mine.loading = false; mine.model = m || { failed: true }; render();
    }, function(){ if(cur !== mine) return; mine.loading = false; mine.model = { failed: true }; render(); });
  }

  /* homepage-extras.js calls this with the picked option and a fill(sel)
     hook that writes the carry and months boxes (sel null: clear them). */
  function show(o, hooks){
    var box = $('ss-posted');
    if(!o || !box){ return false; }
    cur = { opt: o, model: null, picked: null, hooks: hooks || { fill: function(){} }, id: ++seq };
    box.hidden = true; box.innerHTML = '';
    if(opened()) load();
    return true;
  }
  /* The plain line speaks for the result line only while every box it
     filled still holds what it put there. */
  function driving(){
    if(!cur || !cur.model || cur.model.failed || !cur.model.later || !cur.model.later.length) return false;
    var ids = ['idx1-calc-carry', 'idx1-calc-months', 'idx1-calc-price'];
    for(var i = 0; i < ids.length; i++){ var el = $(ids[i]); if(!el || el.dataset.autofilled !== 'true') return false; }
    return true;
  }

  var tmr = null;
  function wire(){
    if(!document.querySelector('link[data-ss]')){
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/components/storesell.css?v=1'; l.setAttribute('data-ss', '1');
      document.head.appendChild(l);
    }
    restore();
    Object.keys(BOX).forEach(function(k){
      var el = $(BOX[k]);
      if(el) el.addEventListener('input', function(){ save(); clearTimeout(tmr); tmr = setTimeout(function(){ if(cur && cur.model){ if(!cur.userPicked) cur.picked = null; render(); } }, 300); });
    });
    var d = $('idx1-store-sell'), f = d && d.closest && d.closest('details');
    if(f) f.addEventListener('toggle', function(){ if(f.open) load(); });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

  core.show = show;
  core.driving = driving;
})(typeof window !== 'undefined' ? window : globalThis);
