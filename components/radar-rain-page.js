/* radar-rain-page.js: the /rain-radar page. Reads one state's file from
 * data/radar-rain/ (components/radar-rain.js decodes it) and shows the
 * radar-and-gauge estimate at a point for the last 24 hours, 3 days,
 * 7 days and the month, a small map around it, and the nearest county
 * gauge beside radar at that gauge for the same days.
 * Point: ?lat=&lon= (field scout), else the saved location (agsist-wx-loc,
 * shared with /spray, /urea and /grain-emc), else a ZIP or the device. */
(function () {
  'use strict';
  var R = window.AgRadarRain;
  if (!R) return;
  var $ = function (id) { return document.getElementById(id); };
  var LS_LOC = 'agsist-wx-loc', LS_WIN = 'agsist-rr-win';
  var ZIPS = 'https://dnilgis.github.io/bids/data/zips/';
  var BASE = '/data/radar-rain/';
  var STALE_H = 9;              // four runs a day: anything older than this missed a run or two
  var MAP_CELLS = 11;           // cells each side of the point on the map (0.04 deg each, about 30 miles)
  var GAUGE_MI = 30;
  var WINS = [['24h', 'Last 24 hours'], ['3d', 'Last 3 days'], ['7d', 'Last 7 days'], ['month', 'This month']];
  var NET = { cocorahs: 'CoCoRaHS volunteer gauge', noaa: 'NOAA co-op gauge' };
  var COLORS = [[1, '#d9f0d3'], [10, '#a6dba0'], [25, '#5aae61'], [50, '#4eb3d3'], [100, '#2b8cbe'],
                [150, '#0868ac'], [200, '#6a51a3'], [300, '#ae017e'], [400, '#f768a1']];
  var S = { seq: 0, idx: null, files: {}, pt: null, label: '', win: '7d', map: null, over: null, mark: null, data: null, st: null };

  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function status(msg, err) { var el = $('rr-status'); el.textContent = msg || ''; el.className = 'rr-status' + (err ? ' err' : ''); }
  function timed(p, ms) {
    var to;
    var t = new Promise(function (_, rej) { to = setTimeout(function () { rej(new Error('timeout')); }, ms); });
    return Promise.race([p, t]).then(function (v) { clearTimeout(to); return v; }, function (e) { clearTimeout(to); throw e; });
  }
  function getJSON(url, ms) { return timed(fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }), ms || 9000); }
  function getBin(url, ms) { return timed(fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }), ms || 20000); }

  function when(iso, opt) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    try {
      return new Intl.DateTimeFormat('en-US', Object.assign({ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, opt || {})).format(d)
        .replace(':00', '').replace(/ ([AP]M)/, ' $1');
    } catch (e) { return d.toString(); }
  }
  function tzName(iso) {
    try {
      var p = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date(iso));
      for (var i = 0; i < p.length; i++) if (p[i].type === 'timeZoneName') return p[i].value;
    } catch (e) {}
    return '';
  }
  function dayLabel(ds) {
    var d = new Date(ds + 'T12:00:00Z');
    return isNaN(d) ? ds : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
  }
  function inTxt(v) { return v == null ? 'no data' : (v / 100).toFixed(2) + ' in'; }

  /* ---------- the point ---------- */
  function fromQuery() {
    var q = new URLSearchParams(location.search);
    var lat = parseFloat(q.get('lat')), lon = parseFloat(q.get('lon'));
    if (isFinite(lat) && isFinite(lon) && lat > 15 && lat < 72 && lon > -180 && lon < -50) {
      var w = q.get('w');
      if (w && WINS.some(function (x) { return x[0] === w; })) S.win = w;
      return { lat: lat, lon: lon, label: q.get('label') || 'the point you picked' };
    }
    return null;
  }
  function load(lat, lon, label, save) {
    var my = ++S.seq;
    status('Reading the radar file for ' + (label || 'your spot') + '…');
    (S.idx ? Promise.resolve(S.idx) : getJSON(BASE + 'index.json', 9000).then(function (j) { S.idx = j; return j; }))
      .then(function (idx) {
        var st = R.pickState(idx, lat, lon);
        if (!st) { var e = new Error('outside'); e.outside = true; throw e; }
        if (S.files[st]) return S.files[st];
        return getBin(BASE + st.toLowerCase() + '.bin', 25000).then(R.parse).then(function (f) { S.files[st] = f; return f; });
      })
      .then(function (f) {
        if (my !== S.seq) return;
        S.pt = { lat: +lat, lon: +lon }; S.label = label || 'your spot'; S.data = f; S.st = f.header.st;
        if (save) lsSet(LS_LOC, Object.assign(lsGet(LS_LOC) || {}, { lat: +lat, lon: +lon, label: label || null }));
        status('');
        $('rr-place').textContent = S.label;
        $('rr-locbox').hidden = true;
        $('rr-change').hidden = false;
        render();
        var v = $('rr-verdict'); v.setAttribute('tabindex', '-1');
        try { if (save) v.focus({ preventScroll: true }); } catch (e) {}
      })
      .catch(function (e) {
        if (my !== S.seq) return;
        $('rr-locbox').hidden = false;
        if (e && e.outside) status('NOAA’s radar rain estimate covers the lower 48 states. This spot is outside it.', true);
        else if (e && e.message === 'no-inflate') status('This browser is too old to open the radar file. A current Chrome, Safari, Edge or Firefox will.', true);
        else if (typeof navigator !== 'undefined' && navigator.onLine === false) status('You are offline. The radar file loads when you have a signal again.', true);
        else status('Could not load the radar file just now. Try again in a minute.', true);
      });
  }
  function byZip() {
    var z = String($('rr-zip').value || '').replace(/\D/g, '').slice(0, 5);
    if (z.length !== 5) { status('Enter a 5-digit ZIP.', true); return; }
    $('rr-zip').value = z;
    status('Looking up ' + z + '…');
    var my = ++S.seq;
    getJSON(ZIPS + z.slice(0, 2) + '.json', 6000).then(function (t) {
      var p = t && t[z];
      if (Array.isArray(p) && isFinite(+p[0]) && isFinite(+p[1]) && !(+p[0] === 0 && +p[1] === 0)) return { lat: +p[0], lon: +p[1], town: typeof p[2] === 'string' ? p[2] : null };
      throw new Error('not in table');
    }).catch(function () {
      return getJSON('https://geocoding-api.open-meteo.com/v1/search?name=' + z + '&count=1&language=en&format=json&countryCode=US', 6000).then(function (d) {
        var r = d && d.results && d.results[0];
        if (!r) throw new Error('none');
        return { lat: r.latitude, lon: r.longitude, town: r.name && !/^\d+$/.test(r.name) ? r.name : null };
      });
    }).then(function (p) { if (my === S.seq) load(p.lat, p.lon, 'ZIP ' + z + (p.town ? ' (' + p.town + ')' : ''), true); })
      .catch(function () { if (my === S.seq) status('Could not find ZIP ' + z + '. Check it and try again.', true); });
  }
  function byDevice() {
    if (!navigator.geolocation) { status('This browser cannot share a location. Enter a ZIP.', true); return; }
    status('Waiting for your location…');
    var my = ++S.seq;
    navigator.geolocation.getCurrentPosition(function (p) { if (my === S.seq) load(p.coords.latitude, p.coords.longitude, 'your location', true); },
      function () { if (my === S.seq) status('No location came through. Enter a ZIP instead.', true); }, { timeout: 8000, maximumAge: 600000 });
  }

  /* ---------- drawing ---------- */
  function color(v) {
    if (v == null || v < 0) return null;
    var c = null;
    for (var i = 0; i < COLORS.length; i++) if (v >= COLORS[i][0]) c = COLORS[i][1];
    return c;
  }
  function win(id) { return (S.data.header.windows || []).filter(function (w) { return w.id === id; })[0] || null; }

  function render() {
    var h = S.data.header, g = S.data.grids, pt = S.pt;
    if (!win(S.win)) S.win = '24h';
    var tiles = WINS.filter(function (x) { return win(x[0]); }).map(function (x) {
      var w = win(x[0]), v = R.lookup(h, g[x[0]], pt.lat, pt.lon);
      var span = x[0] === 'month' ? 'since ' + when(w.start, { weekday: undefined }) : when(w.start) + ' to ' + when(w.end);
      return '<button type="button" class="rr-tile' + (x[0] === S.win ? ' on' : '') + '" data-win="' + x[0] + '" aria-pressed="' + (x[0] === S.win) + '">' +
        '<span class="k">' + x[1] + '</span><span class="v">' + (v == null ? 'no data' : (v / 100).toFixed(2) + '<small> in</small>') + '</span>' +
        '<span class="t">' + esc(span) + '</span></button>';
    }).join('');
    $('rr-tiles').innerHTML = tiles;
    var v24 = R.lookup(h, g['24h'], pt.lat, pt.lon), v7 = g['7d'] ? R.lookup(h, g['7d'], pt.lat, pt.lon) : null;
    var head;
    if (v24 == null && v7 == null) head = 'No radar estimate for this spot';
    else if (v7 != null) head = (v7 / 100).toFixed(2) + ' in of rain in the last 7 days';
    else head = (v24 / 100).toFixed(2) + ' in of rain in the last 24 hours';
    $('rr-verdict').textContent = head;
    var end = h.data_end, ageH = (Date.now() - Date.parse(end)) / 3600e3;
    var tz = tzName(end);
    $('rr-asof').innerHTML = 'Newest radar hour: <b>' + esc(when(end)) + ' ' + esc(tz) + '</b>. Times are your time zone.' +
      (v24 == null && v7 == null ? ' The radar has a gap here (a blocked or distant beam), so there is no number to give.' : '');
    var stale = $('rr-stale');
    if (!(ageH < STALE_H)) {
      stale.hidden = false;
      stale.textContent = 'Old data: the newest radar total ends ' + when(end) + ' ' + tz + ', ' + Math.round(ageH) + ' hours ago. Rain since then is not in these numbers. This page updates about four times a day; check back.';
    } else stale.hidden = true;
    $('rr-results').hidden = false;
    renderGauge();
    renderMap();
    renderLinks();
  }

  function renderGauge() {
    var h = S.data.header, pt = S.pt, box = $('rr-gauge');
    var near = R.nearestGauge(h, pt.lat, pt.lon, GAUGE_MI);
    if (!near) { box.hidden = true; return; }
    var g = near.g, wk = R.gaugeWeek(g, 7);
    var who = esc(g.name) + ' (' + (NET[g.net] || 'gauge') + ', ' + esc(g.county) + ')';
    var mi = near.mi < 1 ? 'under a mile' : Math.round(near.mi) + (Math.round(near.mi) === 1 ? ' mile' : ' miles');
    var html;
    if (wk) {
      var diff = wk.radar - wk.gauge;
      html = '<p class="rr-gk">Beside a real gauge</p><p>The nearest county gauge I track is ' + who + ', ' + mi + ' away. For the 7 days of reports from ' +
        dayLabel(wk.from) + ' to ' + dayLabel(wk.to) + ' (each day ending about 7 am):</p>' +
        '<div class="rr-gv"><span><b>' + inTxt(wk.gauge) + '</b> gauge</span><span><b>' + inTxt(wk.radar) + '</b> radar at the gauge</span></div>' +
        '<p class="fine">' + (Math.abs(diff) < 5 ? 'Within 0.05 in of each other that week.' : 'Radar read ' + (diff > 0 ? 'more' : 'less') + ' than the gauge by ' + (Math.abs(diff) / 100).toFixed(2) + ' in that week.') +
        ' Gauge reports reach me about once a week, so this week runs behind the totals above.</p>';
    } else {
      html = '<p class="rr-gk">Beside a real gauge</p><p>The nearest county gauge I track is ' + who + ', ' + mi + ' away, but it missed a day or reported a multi-day total in its last 7 days of reports, so there is no clean week to put beside radar.</p>';
    }
    box.innerHTML = html;
    box.hidden = false;
  }

  function overlayCanvas() {
    var h = S.data.header, q = S.data.grids[S.win], pt = S.pt;
    // as many miles east-west as north-south: more columns the farther north
    var cx = Math.round(MAP_CELLS / Math.max(0.5, Math.cos(pt.lat * Math.PI / 180)));
    var c0 = Math.round((pt.lon - h.x0) / h.d) - cx, r0 = Math.round((h.y0 - pt.lat) / h.d) - MAP_CELLS;
    var n = MAP_CELLS * 2 + 1, w = cx * 2 + 1;
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = n;
    var ctx = cv.getContext('2d');
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < w; c++) {
        var rr = r0 + r, cc = c0 + c, v = null, inGrid = rr >= 0 && rr < h.ny && cc >= 0 && cc < h.nx;
        if (inGrid) v = q[rr * h.nx + cc];
        var col = !inGrid || v < 0 ? 'rgba(120,120,120,.55)' : color(v);
        if (col) { ctx.fillStyle = col; ctx.fillRect(c, r, 1, 1); }
      }
    }
    var d = h.d, half = d / 2;
    var west = h.x0 + c0 * d - half, north = h.y0 - r0 * d + half;
    return { canvas: cv, cx: cx, bounds: [[north - n * d, west], [north, west + w * d]] };
  }

  function renderMap() {
    var el = $('rr-map'), o = overlayCanvas(), pt = S.pt;
    $('rr-mapwin').textContent = (WINS.filter(function (x) { return x[0] === S.win; })[0] || [0, ''])[1].toLowerCase();
    if (window.L && !S.mapFailed) {
      try {
        if (!S.map) {
          S.map = L.map(el, { scrollWheelZoom: false, attributionControl: true, zoomSnap: 0.25 });
          var dark = document.documentElement.getAttribute('data-theme') !== 'light';
          L.tileLayer('https://{s}.basemaps.cartocdn.com/' + (dark ? 'dark_all' : 'light_all') + '/{z}/{x}/{y}{r}.png', {
            maxZoom: 14, subdomains: 'abcd', attribution: '&copy; OpenStreetMap &copy; CARTO | Rain: NOAA MRMS'
          }).addTo(S.map);
          S.map.on('click', function (e) {
            var hh = S.data.header, v = R.lookup(hh, S.data.grids[S.win], e.latlng.lat, e.latlng.lng);
            L.popup().setLatLng(e.latlng).setContent('<b>' + inTxt(v) + '</b><br>' + esc($('rr-mapwin').textContent)).openOn(S.map);
          });
        }
        if (S.over) S.map.removeLayer(S.over);
        if (S.mark) S.map.removeLayer(S.mark);
        S.over = L.imageOverlay(o.canvas.toDataURL(), o.bounds, { opacity: 0.72, className: 'rr-px', interactive: false }).addTo(S.map);
        S.mark = L.circleMarker([pt.lat, pt.lon], { radius: 7, color: '#111', weight: 2, fillColor: '#ffd23f', fillOpacity: 1 }).addTo(S.map);
        S.map.fitBounds(o.bounds, { padding: [4, 4] });
        return;
      } catch (e) { S.mapFailed = true; }
    }
    // no map library (offline or blocked): the grid alone, point in the middle
    el.innerHTML = '';
    var cv = o.canvas, big = document.createElement('canvas'), k = 8;
    big.width = cv.width * k; big.height = cv.height * k;
    var x = big.getContext('2d');
    x.imageSmoothingEnabled = false;
    x.fillStyle = getComputedStyle(document.body).backgroundColor || '#fff';
    x.fillRect(0, 0, big.width, big.height);
    x.drawImage(cv, 0, 0, big.width, big.height);
    var m = MAP_CELLS * k + k / 2, mx = o.cx * k + k / 2;
    x.beginPath(); x.arc(mx, m, 7, 0, 2 * Math.PI); x.fillStyle = '#ffd23f'; x.fill(); x.lineWidth = 2; x.strokeStyle = '#111'; x.stroke();
    big.className = 'rr-flat';
    big.setAttribute('role', 'img');
    big.setAttribute('aria-label', 'Radar rain around the point, about 60 miles across');
    el.appendChild(big);
  }

  function renderLinks() {
    var h = S.data.header, pt = S.pt;
    var near = R.nearestGauge(h, pt.lat, pt.lon, GAUGE_MI);
    var a = [];
    if (near && near.g.page) a.push('<a href="' + esc(near.g.page) + '">Rain this year in ' + esc(near.g.county) + ', from the gauge</a>');
    $('rr-more').innerHTML = a.map(function (x) { return '<li>' + x + '</li>'; }).join('');
  }

  /* ---------- wire up ---------- */
  function init() {
    var saved = lsGet(LS_WIN);
    if (saved && WINS.some(function (x) { return x[0] === saved; })) S.win = saved;
    $('rr-zipgo').addEventListener('click', byZip);
    $('rr-zip').addEventListener('keydown', function (e) { if (e.key === 'Enter') byZip(); });
    $('rr-geo').addEventListener('click', byDevice);
    $('rr-change').addEventListener('click', function () { $('rr-locbox').hidden = false; $('rr-zip').focus(); });
    $('rr-tiles').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-win]') : null;
      if (!b || !S.data) return;
      S.win = b.getAttribute('data-win');
      lsSet(LS_WIN, S.win);
      render();
    });
    try { if (window.agsistFillZip) window.agsistFillZip(); } catch (e) {}
    var z = (lsGet(LS_LOC) || {}).zip;
    if (z && /^\d{5}$/.test(String(z)) && !$('rr-zip').value) $('rr-zip').value = z;
    var q = fromQuery();
    if (q) { load(q.lat, q.lon, q.label, false); return; }
    var loc = lsGet(LS_LOC);
    if (loc && typeof loc.lat === 'number' && typeof loc.lon === 'number' && isFinite(loc.lat) && isFinite(loc.lon)) load(loc.lat, loc.lon, loc.label || 'your saved location', false);
    else $('rr-locbox').hidden = false;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
