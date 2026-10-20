/* /spray: the wind at your field, next 48 hours, and the best spray windows.
 *
 * Loaded on demand by spray.html once a field is set and the reader nears the
 * #wind section (or at once for a shared ?f= link). Loads its own math
 * (spray-windows.js), its styles and Leaflet, then draws:
 *   - wind flowing over a USGS map around the field (particles; arrows under
 *     reduced motion or on the reader's pick), coloured by the band at the boom,
 *   - a 48-hour time slider and an hour strip,
 *   - the best spray windows in plain words,
 *   - a share link carrying the field and the hour,
 *   - every source on screen, the model and its run time, and a plain line
 *     whenever a source is not answering.
 * Spray rules come from spray.html (window.AgSprayRules), the same copy the
 * hourly strip above uses.
 */
(function () {
  'use strict';
  if (window.AgSprayWind) return;

  var V = { win: 1, css: 1 };
  var LEAFLET = '/vendor/leaflet-1.9.4/';
  var TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}';
  var COLORS = { calm: '#6b3fc4', band: '#13803b', high: '#c27400', over: '#c4281c', na: '#777' };
  var CELL = { good: 'var(--green,#2e7d4f)', fair: 'var(--gold-fill,var(--gold,#d4a23f))', no: 'var(--red,#c0492f)' };
  var FETCH_MS = 12000;

  var S = { hour: 0, mode: null, playing: null, raf: 0, parts: [], nPart: 0, visible: true, frames: 0, ftAvg: 16, rainfree: null };
  var W, R;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function loadScript(src) { return new Promise(function (ok, no) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { no(new Error('load ' + src)); }; document.head.appendChild(s); }); }
  function loadCss(href) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }
  function getJson(u) {
    var ac = ('AbortController' in window) ? new AbortController() : null, t = ac ? setTimeout(function () { ac.abort(); }, FETCH_MS) : 0;
    return fetch(u, ac ? { signal: ac.signal } : {}).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { if (j && j.error) throw new Error(j.reason || 'error'); return j; }, function (e) { clearTimeout(t); throw e; });
  }
  // A single-model answer may name a variable with the model as a suffix; read it under its plain name too.
  function norm(o) {
    if (!o) return o;
    ['hourly', 'daily'].forEach(function (k) { var h = o[k]; if (!h) return; Object.keys(h).forEach(function (n) { var m = /^(.*)_gfs_seamless$/.exec(n); if (m && !(m[1] in h)) h[m[1]] = h[n]; }); });
    return o;
  }
  var reduced = (function () { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();

  /* ---------- shell ---------- */
  function shell(root) {
    root.removeAttribute('aria-busy');
    root.innerHTML =
      '<div class="sw-wrap" id="sw-wrap">' +
        '<div class="sw-map" id="sw-map" role="img" aria-label="Forecast wind around your field"></div>' +
        '<canvas class="sw-cv" id="sw-cv" aria-hidden="true"></canvas>' +
        '<div class="sw-haze" id="sw-haze" hidden></div>' +
        '<div class="sw-tag" id="sw-tag" aria-hidden="true"></div>' +
        '<button type="button" class="sw-mode" id="sw-mode"></button>' +
        '<div class="sw-down" id="sw-down" hidden></div>' +
      '</div>' +
      '<p class="sw-note" id="sw-note" hidden></p>' +
      '<div class="sw-read" id="sw-read" aria-live="polite"></div>' +
      '<div class="sw-time"><button type="button" class="sw-play" id="sw-play" aria-label="Play the next 48 hours">&#9654;</button>' +
        '<input type="range" id="sw-slider" min="0" max="47" step="1" value="0" aria-label="Forecast hour"></div>' +
      '<div class="sw-strip" id="sw-strip" aria-hidden="true"></div>' +
      '<div class="sw-legend" id="sw-legend"></div>' +
      '<div class="sw-win"><h3 class="sw-wh">Best spray windows, next 48 hours</h3>' +
        '<div class="sw-rf" id="sw-rf"></div>' +
        '<ul class="sw-list" id="sw-list" aria-live="polite"><li class="sw-wait">Reading the forecast for your field.</li></ul>' +
        '<p class="sw-fine" id="sw-fine"></p></div>' +
      '<div class="sw-share"><button type="button" class="sw-btn" id="sw-share">Share this field and hour</button> <span id="sw-shared" role="status"></span></div>' +
      '<p class="sw-src" id="sw-src"></p>' +
      '<details class="sw-how"><summary>How this is worked out</summary><div id="sw-how"></div></details>';
    $('sw-mode').addEventListener('click', function () { setMode(S.mode === 'flow' ? 'arrows' : 'flow'); });
    $('sw-slider').addEventListener('input', function () { stopPlay(); setHour(+this.value); });
    $('sw-play').addEventListener('click', function () { if (S.playing) stopPlay(); else startPlay(); });
    $('sw-strip').addEventListener('click', function (e) { var c = e.target.closest('[data-i]'); if (c) { stopPlay(); setHour(+c.getAttribute('data-i')); } });
    $('sw-share').addEventListener('click', share);
    renderLegend();
    renderCredits();
    renderHow();
  }

  /* ---------- data ---------- */
  function start(field) {
    S.field = field;
    S.grid = W.gridPoints(field.lat, field.lon);
    S.W = null; S.F = null; S.hours = []; S.runs = {};
    var shared = W.parseShare(location.search);
    S.wantT = shared && Math.abs(shared.lat - field.lat) < 1e-3 && Math.abs(shared.lon - field.lon) < 1e-3 ? shared.t : null;
    setupMap();
    loadField();
    loadGrid();
    loadMeta();
  }
  function loadField() {
    $('sw-list').innerHTML = '<li class="sw-wait">Reading the forecast for your field.</li>';
    getJson(W.fieldUrl(S.field.lat, S.field.lon)).then(function (j) {
      if (!j || !j.hourly || !j.hourly.time) throw new Error('no hourly forecast');
      S.F = norm(j); S.fieldErr = null; S.readAt = new Date();
      rate();
    }).catch(function (e) {
      S.F = null; S.fieldErr = e; S.hours = [];
      $('sw-list').innerHTML = '<li class="sw-down-li">The forecast for your field is not answering right now (Open-Meteo: ' + esc(msg(e)) + '). No spray windows until it does. <button type="button" class="sw-btn sw-retry" id="sw-retry-f">Try again</button></li>';
      $('sw-retry-f').addEventListener('click', loadField);
      afterData();
    });
  }
  function loadGrid() {
    down('');
    getJson(W.gridUrl(S.grid)).then(function (j) {
      var arr = (Array.isArray(j) ? j : [j]).map(norm);
      var start = S.F ? W.hourKey(S.F) : W.hourKey(arr[0]);
      var g = W.parseGrid(arr, S.grid, start);
      if (!g) throw new Error('the grid came back incomplete');
      S.W = g; S.gridErr = null; S.gridStart = start;
      seed(true);
      afterData();
    }).catch(function (e) {
      S.W = null; S.gridErr = e;
      down('The wind map forecast is not answering right now (Open-Meteo: ' + esc(msg(e)) + '). The spray windows below use the forecast at your field. <button type="button" class="sw-btn sw-retry" id="sw-retry-g">Try again</button>');
      var b = $('sw-retry-g'); if (b) b.addEventListener('click', loadGrid);
      afterData();
    });
  }
  function loadMeta() {
    S.runs = {};
    W.META.forEach(function (m) {
      getJson(m.u).then(function (j) { S.runs[m.name] = W.runTime(j); renderCredits(); }).catch(function () { S.runs[m.name] = null; renderCredits(); });
    });
  }
  function msg(e) { return (e && e.name === 'AbortError') ? 'no answer in ' + (FETCH_MS / 1000) + ' seconds' : String((e && e.message) || e || 'error').slice(0, 80); }
  function down(html) { var d = $('sw-down'); if (!d) return; d.innerHTML = html; d.hidden = !html; }

  function product() { return R.currentProduct ? R.currentProduct() : R.PRODUCTS.general; }
  function pkey() { return R.productKey ? R.productKey() : 'general'; }
  function rate() {
    if (!S.F) return;
    var N = S.rainfree != null ? S.rainfree : (W.RAINFREE[pkey()] || 2);
    S.N = N;
    S.hours = W.rateHours(R, S.F, { P: product(), pkey: pkey(), S: R.currentState ? R.currentState() : null, rainfree: N, startKey: W.hourKey(S.F) });
    renderRf();
    renderList();
    afterData();
  }
  function times() { return S.hours.length ? S.hours.map(function (h) { return h.t; }) : (S.W ? S.W.times : []); }
  function afterData() {
    var ts = times(), sl = $('sw-slider');
    if (!sl) return;
    sl.max = Math.max(0, ts.length - 1);
    sl.disabled = !ts.length;
    if (S.wantT && ts.length) {
      var i = ts.indexOf(S.wantT);
      if (i >= 0) { S.hour = i; S.wantT = null; }
      else if (S.F || S.fieldErr) { note('That shared hour has passed or is past the forecast; showing now.'); S.wantT = null; S.hour = 0; }
    }
    if (S.hour > ts.length - 1) S.hour = 0;
    renderStrip();
    setHour(S.hour);
    renderCredits();
  }
  function note(t) { var n = $('sw-note'); if (n) { n.textContent = t || ''; n.hidden = !t; } }

  /* ---------- the map ---------- */
  function setupMap() {
    var el = $('sw-map');
    S.map = null; S.tilesOk = false;
    if (window.L && !S.mapFailed) {
      try {
        el.innerHTML = '';
        S.map = L.map(el, { dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, zoomControl: false, attributionControl: true, zoomSnap: 0.1 });
        S.map.attributionControl.setPrefix(false);
        S.map.attributionControl.addAttribution('Map: USGS | Wind: NOAA via Open-Meteo');
        var loaded = 0, waiting = 0, t = L.tileLayer(TILES, { maxNativeZoom: 16, maxZoom: 16 });
        t.on('tileload', function () { loaded++; S.tilesOk = true; if (S.tileNote) { S.tileNote = false; note(''); } });
        t.on('tileerror', function () {
          if (loaded || waiting) return;
          waiting = setTimeout(function () { if (!loaded) { S.tileNote = true; note('The map underneath did not load. The wind still draws; the dot is your field.'); } }, 6000);
        });
        t.addTo(S.map);
        fit();
      } catch (e) { S.mapFailed = true; S.map = null; }
    }
    if (!S.map) { el.classList.add('sw-bare'); note('The map underneath did not load. The wind still draws; the dot is your field.'); }
    size();
  }
  function fit() {
    if (!S.map || !S.grid) return;
    var g = S.grid;
    S.map.fitBounds([[g.south, g.west], [g.north, g.east]], { padding: [0, 0], animate: false });
  }
  function size() {
    var cv = $('sw-cv'), wrap = $('sw-wrap'); if (!cv || !wrap) return;
    var w = wrap.clientWidth, h = wrap.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px';
    S.cw = w; S.ch = h; S.dpr = dpr;
    if (S.map) { S.map.invalidateSize(false); fit(); }
    project();
    seed(true);
    if (S.mode === 'arrows') drawArrows();
  }
  // grid corners in canvas pixels: from the map when there is one, else the grid fills the box
  function project() {
    var g = S.grid; if (!g) return;
    if (S.map) {
      var a = S.map.latLngToContainerPoint([g.north, g.west]), b = S.map.latLngToContainerPoint([g.south, g.east]), f = S.map.latLngToContainerPoint([S.field.lat, S.field.lon]);
      S.px = { x0: a.x, y0: a.y, x1: b.x, y1: b.y, fx: f.x, fy: f.y };
    } else {
      S.px = { x0: 0, y0: 0, x1: S.cw, y1: S.ch, fx: S.cw / 2, fy: S.ch / 2 };
    }
  }
  function gridAt(x, y) { var p = S.px, n = S.grid.n - 1; return { gx: (x - p.x0) / (p.x1 - p.x0) * n, gy: (y - p.y0) / (p.y1 - p.y0) * n }; }

  /* ---------- particles ---------- */
  function targetCount() {
    var n = Math.round((S.cw * S.ch) / 320);
    if (navigator.deviceMemory && navigator.deviceMemory <= 2) n = Math.round(n / 2);
    return Math.max(120, Math.min(1500, n));
  }
  function seed(reset) {
    if (!S.cw) return;
    if (reset || !S.nPart) S.nPart = targetCount();
    S.parts = [];
    for (var i = 0; i < S.nPart; i++) S.parts.push(spawn({}));
    var wrap = $('sw-wrap'); if (wrap) wrap.setAttribute('data-particles', String(S.nPart));
  }
  function spawn(p) { p.x = Math.random() * S.cw; p.y = Math.random() * S.ch; p.age = Math.floor(Math.random() * 90); p.life = 60 + Math.floor(Math.random() * 60); return p; }
  var last = 0;
  function frame(ts) {
    S.raf = 0;
    if (S.mode !== 'flow' || !S.visible || document.hidden) return;
    var dt = last ? Math.min(50, ts - last) : 16; last = ts;
    // fewer particles when the phone cannot keep up
    S.ftAvg = S.ftAvg * 0.95 + dt * 0.05; S.frames++;
    if (S.frames > 90 && S.ftAvg > 24 && S.nPart > 100) { S.nPart = Math.max(100, Math.round(S.nPart * 0.7)); S.parts.length = Math.min(S.parts.length, S.nPart); S.frames = 0; var wr = $('sw-wrap'); if (wr) wr.setAttribute('data-particles', String(S.nPart)); }
    var cv = $('sw-cv'), x = cv.getContext('2d'), d = S.dpr;
    x.setTransform(d, 0, 0, d, 0, 0);
    x.globalCompositeOperation = 'destination-out';
    x.fillStyle = 'rgba(0,0,0,0.075)';
    x.fillRect(0, 0, S.cw, S.ch);
    x.globalCompositeOperation = 'source-over';
    x.lineWidth = 1.7; x.lineCap = 'round';
    var P = product(), k = (S.cw / 3800) * (dt / 16.7), t = S.tFloat != null ? S.tFloat : S.hour;
    var byColor = {};
    for (var i = 0; i < S.parts.length; i++) {
      var p = S.parts[i], g = gridAt(p.x, p.y), w = S.W && W.sample(S.W, t, g.gx, g.gy);
      if (!w || ++p.age > p.life) { spawn(p); p.age = 0; continue; }
      var nx = p.x + w.u * k, ny = p.y - w.v * k;
      var c = COLORS[W.band(R, P, w.s)] || COLORS.na;
      (byColor[c] = byColor[c] || []).push(p.x, p.y, nx, ny);
      p.x = nx; p.y = ny;
      if (p.x < -5 || p.y < -5 || p.x > S.cw + 5 || p.y > S.ch + 5) spawn(p);
    }
    Object.keys(byColor).forEach(function (c) {
      var a = byColor[c]; x.strokeStyle = c; x.globalAlpha = 0.9; x.beginPath();
      for (var j = 0; j < a.length; j += 4) { x.moveTo(a[j], a[j + 1]); x.lineTo(a[j + 2], a[j + 3]); }
      x.stroke();
    });
    x.globalAlpha = 1;
    drawField(x);
    S.raf = requestAnimationFrame(frame);
  }
  function drawField(x) {
    var p = S.px; if (!p) return;
    x.save();
    x.beginPath(); x.arc(p.fx, p.fy, 9, 0, 2 * Math.PI); x.fillStyle = '#ffd23f'; x.fill(); x.lineWidth = 2.5; x.strokeStyle = '#111'; x.stroke();
    x.beginPath(); x.arc(p.fx, p.fy, 2.5, 0, 2 * Math.PI); x.fillStyle = '#111'; x.fill();
    x.font = '600 12px system-ui,sans-serif'; x.lineWidth = 3; x.strokeStyle = 'rgba(255,255,255,.9)'; x.fillStyle = '#111';
    x.strokeText('Your field', p.fx + 13, p.fy + 4); x.fillText('Your field', p.fx + 13, p.fy + 4);
    x.restore();
  }
  // reduced motion (or the reader's pick): one arrow per grid point, pointing where the air goes
  function drawArrows() {
    var cv = $('sw-cv'); if (!cv || !S.cw) return;
    var x = cv.getContext('2d'), d = S.dpr, P = product();
    x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, S.cw, S.ch);
    if (S.W) {
      var n = 7, sp = Math.min(S.cw, S.ch) / (n + 1);
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
        var px = S.px.x0 + (S.px.x1 - S.px.x0) * (c + 0.5) / n, py = S.px.y0 + (S.px.y1 - S.px.y0) * (r + 0.5) / n;
        var g = gridAt(px, py), w = W.sample(S.W, S.hour, g.gx, g.gy); if (!w) continue;
        var len = Math.max(8, Math.min(sp * 0.9, 6 + w.s * 2.2)), a = Math.atan2(-w.v, w.u);
        x.save(); x.translate(px, py); x.rotate(a); x.strokeStyle = x.fillStyle = COLORS[W.band(R, P, w.s)] || COLORS.na; x.lineWidth = 2.5;
        x.beginPath(); x.moveTo(-len / 2, 0); x.lineTo(len / 2 - 5, 0); x.stroke();
        x.beginPath(); x.moveTo(len / 2, 0); x.lineTo(len / 2 - 8, -5); x.lineTo(len / 2 - 8, 5); x.closePath(); x.fill();
        x.restore();
      }
    }
    drawField(x);
  }
  function setMode(m) {
    S.mode = m;
    var b = $('sw-mode'); if (b) { b.textContent = m === 'flow' ? 'Show arrows' : 'Show flow'; b.setAttribute('aria-label', m === 'flow' ? 'Show arrows instead of moving wind' : 'Show moving wind'); }
    var wrap = $('sw-wrap'); if (wrap) wrap.setAttribute('data-mode', m);
    var cv = $('sw-cv'); if (cv) { var x = cv.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height); }
    if (m === 'flow') { last = 0; if (!S.raf) S.raf = requestAnimationFrame(frame); }
    else { if (S.raf) cancelAnimationFrame(S.raf); S.raf = 0; drawArrows(); }
  }

  /* ---------- time ---------- */
  function setHour(i) {
    var ts = times(); if (!ts.length) { renderRead(); return; }
    S.hour = Math.max(0, Math.min(ts.length - 1, i | 0)); S.tFloat = null;
    var sl = $('sw-slider'); if (sl && +sl.value !== S.hour) sl.value = S.hour;
    var cells = $('sw-strip').querySelectorAll('[data-i]');
    for (var c = 0; c < cells.length; c++) cells[c].classList.toggle('on', +cells[c].getAttribute('data-i') === S.hour);
    renderRead();
    if (S.mode === 'arrows') drawArrows();
  }
  function startPlay() {
    var ts = times(); if (!ts.length) return;
    if (S.hour >= ts.length - 1) setHour(0);
    var b = $('sw-play'); b.innerHTML = '&#10074;&#10074;'; b.setAttribute('aria-label', 'Pause');
    var t0 = performance.now(), h0 = S.hour, perHour = 1100;
    function step(now) {
      if (!S.playing) return;
      var f = h0 + (now - t0) / perHour, n = times().length - 1;
      if (f >= n) { setHour(n); stopPlay(); return; }
      if (Math.floor(f) !== S.hour) setHour(Math.floor(f));
      S.tFloat = reduced ? null : f;
      S.playing = requestAnimationFrame(step);
    }
    S.playing = requestAnimationFrame(step);
  }
  function stopPlay() {
    if (S.playing) cancelAnimationFrame(S.playing);
    S.playing = null; S.tFloat = null;
    var b = $('sw-play'); if (b) { b.innerHTML = '&#9654;'; b.setAttribute('aria-label', 'Play the next 48 hours'); }
  }

  /* ---------- words ---------- */
  var RWORD = { good: 'Good', fair: 'Fair', no: 'No' };
  function hourLabel(t) { return W.dow(t) + ' ' + W.clock(+String(t).slice(11, 13)); }
  function renderRead() {
    var el = $('sw-read'); if (!el) return;
    var ts = times(), t = ts[S.hour], h = S.hours[S.hour], P = product();
    if (!t) { el.innerHTML = ''; return; }
    var wind = h ? h.wind : (S.W ? S.W.speed[S.hour][Math.floor(S.W.speed[S.hour].length / 2)] : null);
    var gust = h ? h.gust : (S.W ? S.W.gust[S.hour][Math.floor(S.W.gust[S.hour].length / 2)] : null);
    var dir = h ? h.dir : (S.W ? S.W.dir[S.hour][Math.floor(S.W.dir[S.hour].length / 2)] : null);
    var b = wind == null ? null : R.boomWind(wind), bd = W.band(R, P, wind);
    var why = h && h.r !== 'good' && h.why.length ? h.why.slice(0, 2).map(function (k) { return W.WHY_TEXT[k]; }).join(', ') : '';
    el.innerHTML = '<div class="sw-rh"><b>' + esc(hourLabel(t)) + '</b>' + (h ? ' <span class="sw-pill ' + h.r + '">' + RWORD[h.r] + '</span>' : '') + (why ? ' <span class="sw-why">' + esc(why) + '</span>' : '') + '</div>' +
      '<div class="sw-rd">' + (wind == null ? 'Wind not in this forecast.' :
        'Wind from the ' + esc(W.compass(dir)) + ', ' + Math.round(wind) + ' mph at 10 m, <b style="color:' + COLORS[bd] + '">about ' + Math.round(b) + ' mph at the boom</b>' + (gust != null ? ', gusts ' + Math.round(gust) + ' mph' : '') + '.') +
      (h && h.temp != null ? ' ' + h.temp + '°F' + (h.rh != null ? ', ' + Math.round(h.rh) + '% humidity' : '') + (h.dt != null ? ', delta T ' + (h.dt * 9 / 5).toFixed(0) + '°F' : '') + '.' : '') + '</div>';
    var sl = $('sw-slider'); if (sl) sl.setAttribute('aria-valuetext', hourLabel(t) + (h ? ', ' + RWORD[h.r] : '') + (wind != null ? ', about ' + Math.round(b) + ' mph at the boom' : ''));
    var tag = $('sw-tag'); if (tag) tag.textContent = hourLabel(t);
    var inv = h && h.why.indexOf('inv') >= 0, hz = $('sw-haze');
    if (hz) { hz.hidden = !inv; hz.textContent = inv ? 'Inversion risk this hour: calm air, low sun' + (h.cloud != null && h.cloud <= W.INV.clearCloud ? ', clear sky' : '') + '. A risk, not a reading.' : ''; }
  }
  function renderStrip() {
    var el = $('sw-strip'); if (!el) return;
    var ts = times(), html = '';
    for (var i = 0; i < ts.length; i++) {
      var h = S.hours[i], hh = +ts[i].slice(11, 13), cls = h ? h.r : 'na', inv = h && h.why.indexOf('inv') >= 0;
      html += '<span class="sw-c ' + cls + (inv ? ' inv' : '') + (hh === 0 ? ' d0' : '') + '" data-i="' + i + '" title="' + esc(hourLabel(ts[i]) + (h ? ': ' + RWORD[h.r] : '')) + '">' + (hh === 0 || i === 0 ? '<i>' + esc(W.dow(ts[i])) + '</i>' : '') + '</span>';
    }
    el.innerHTML = html;
  }
  function renderList() {
    var el = $('sw-list'); if (!el) return;
    var lines = W.summary(S.hours, { rainfree: S.N });
    el.innerHTML = lines.map(function (l) { return '<li class="sw-li ' + l.r + '">' + esc(l.text) + '</li>'; }).join('');
    var P = product();
    $('sw-fine').innerHTML = 'Rated for ' + esc(P.label === 'General guidance' ? 'general guidance (no product picked above)' : P.label) + ': ' + P.wMin + ' to ' + P.wHiCaution + ' mph at the boom is the band, ' + P.wMax + ' mph the most. Many labels say 3 to 10 mph; <b>check your product label</b>. Good hours also need no rain for ' + S.N + ' hour' + (S.N === 1 ? '' : 's') + ' after, and the temperature, humidity and delta T bands from the cards above. A forecast, so check the wind at the boom before you start.';
  }
  function renderRf() {
    var el = $('sw-rf'); if (!el) return;
    el.innerHTML = '<span>Rain-free hours you need:</span> ' + W.RAINFREE_CHOICES.map(function (n) { return '<button type="button" class="sw-rfb" data-n="' + n + '" aria-pressed="' + (n === S.N) + '">' + n + ' h</button>'; }).join('') + ' <span class="sw-rfn">(check your label; see the rain-free table)</span>';
    el.onclick = function (e) { var b = e.target.closest('[data-n]'); if (!b) return; S.rainfree = +b.getAttribute('data-n'); rate(); };
  }
  function renderLegend() {
    var P = product(), el = $('sw-legend'); if (!el) return;
    el.innerHTML = '<span><i style="background:' + COLORS.calm + '"></i>Too calm, under ' + P.wMin + '</span>' +
      '<span><i style="background:' + COLORS.band + '"></i>In the band, ' + P.wMin + ' to ' + P.wHiCaution + '</span>' +
      '<span><i style="background:' + COLORS.high + '"></i>High, ' + P.wHiCaution + ' to ' + P.wMax + '</span>' +
      '<span><i style="background:' + COLORS.over + '"></i>Over ' + P.wMax + '</span>' +
      '<span class="sw-lnote">mph at the boom. Hour strip: green good, gold fair, red no, purple bar inversion risk.</span>';
  }
  function fmtRun(d) { try { return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); } catch (e) { return d.toISOString(); } }
  function renderCredits() {
    var el = $('sw-src'); if (!el) return;
    var runs = W.META.map(function (m) { var d = S.runs && S.runs[m.name]; return d === undefined ? null : m.name + ' run ' + (d ? fmtRun(d) : 'time not given by the source'); }).filter(Boolean);
    var state = [];
    if (S.fieldErr) state.push('field forecast not answering');
    if (S.gridErr) state.push('wind map forecast not answering');
    el.innerHTML = '<b>Forecast (estimate), model ' + esc(W.MODEL) + ' (NOAA HRRR, then GFS)</b>' + (runs.length ? ': ' + esc(runs.join(', ')) : '') + '.' + (S.readAt ? ' Read ' + esc(fmtRun(S.readAt)) + '.' : '') + (state.length ? ' <span class="sw-bad">Now: ' + esc(state.join('; ')) + '.</span>' : '') + ' ' +
      W.CREDITS.map(function (c) { return '<span data-credit="' + c.id + '">' + esc(c.t) + (c.a ? ' <a href="' + esc(c.u) + '" target="_blank" rel="noopener">' + esc(c.a) + '</a>' : '') + (c.tail ? (c.tail === '.' ? '' : ' ') + esc(c.tail) : '') + '</span>'; }).join(' ');
  }
  function renderHow() {
    var I = W.INV, el = $('sw-how'); if (!el) return;
    el.innerHTML = '<p>The wind comes from the forecast at 25 points around your field, about 7 miles apart, read once when you open this. Between points and hours it is blended in a straight line, so small valleys, tree lines and storms the model does not see are not in it.</p>' +
      '<p>Boom wind is the 10 m forecast times about 0.75 (the FAO-56 wind profile over short grass). Colours and the band use your product from the box above.</p>' +
      '<p><b>Inversion risk</b> is flagged when the air is calm (under ' + I.calmBoom + ' mph at the boom) from ' + (I.beforeSunsetMin / 60) + ' hours before sunset to ' + (I.afterSunriseMin / 60) + ' hour after sunrise under a mostly clear sky (' + I.clearCloud + '% cloud or less), and wherever the inversion card above rates the risk high. It is a risk read from a forecast, not a measurement: inversions can start hours before sunset and depend on low spots and windbreaks. Smoke that hangs or ground fog means one is there.</p>' +
      '<p>An hour is <b>good</b> when every card above would rate it good and there is no rain in it or the rain-free hours after it. <b>Fair</b> is one factor near a limit. <b>No</b> is any factor past a limit, rain too soon, or inversion risk.</p>';
  }

  /* ---------- share ---------- */
  function share() {
    var ts = times(), url = W.shareUrl(location.origin, S.field.lat, S.field.lon, ts[S.hour] || null), out = $('sw-shared');
    var say = function (t) { if (out) out.textContent = t; };
    if (navigator.share) { navigator.share({ title: 'Spray wind at this field', url: url }).catch(function () {}); return; }
    var fallback = function () { if (out) out.innerHTML = '<input class="sw-link" readonly value="' + esc(url) + '" aria-label="Link to this field and hour">'; var i = out.querySelector('input'); if (i) { i.focus(); i.select(); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { say('Link copied: field and hour.'); }, fallback);
    else fallback();
  }

  /* ---------- wire ---------- */
  function init() {
    var root = $('sw-root'); if (!root) return;
    R = window.AgSprayRules; W = window.AgSprayWin;
    if (!R || !W) { root.innerHTML = '<p class="sw-ph">The wind view did not load. Reload the page to try again.</p>'; return; }
    shell(root);
    setMode(reduced ? 'arrows' : 'flow');
    if (window.AgSprayField) start(window.AgSprayField);
    document.addEventListener('agsist:spray-field', function (e) { stopPlay(); S.hour = 0; start(e.detail); });
    ['in-product', 'in-state'].forEach(function (id) { var e = $(id); if (e) e.addEventListener('change', function () { S.rainfree = null; renderLegend(); rate(); }); });
    var rt = 0; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(size, 150); });
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { S.visible = es[0].isIntersecting; if (S.visible && S.mode === 'flow' && !S.raf) { last = 0; S.raf = requestAnimationFrame(frame); } }).observe($('sw-wrap'));
    document.addEventListener('visibilitychange', function () { if (!document.hidden && S.mode === 'flow' && !S.raf) { last = 0; S.raf = requestAnimationFrame(frame); } });
    if (location.hash === '#wind') setTimeout(function () { var w = $('wind'); if (w) w.scrollIntoView({ block: 'start' }); }, 50);
  }

  window.AgSprayWind = { state: S };
  loadCss('/components/spray-wind.css?v=' + V.css);
  var needL = !window.L;
  if (needL) loadCss(LEAFLET + 'leaflet.css');
  Promise.all([
    window.AgSprayWin ? Promise.resolve() : loadScript('/components/spray-windows.js?v=' + V.win),
    needL ? loadScript(LEAFLET + 'leaflet.js').catch(function () { S.mapFailed = true; }) : Promise.resolve()
  ]).then(init, function () { var r = $('sw-root'); if (r) r.innerHTML = '<p class="sw-ph">The wind view did not load. Check your signal and reload the page.</p>'; });
})();
