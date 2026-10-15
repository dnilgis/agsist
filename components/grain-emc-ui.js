/* grain-emc-ui.js: the /grain-emc page. Math lives in grain-emc.js (AgEMC);
 * this file reads the inputs, gets the forecast and draws.
 * Forecast: Open-Meteo hourly temperature and relative humidity, fetched in
 * the reader's browser. ZIP to a point: the bids ZIP table (one small shard),
 * then Open-Meteo's geocoder. The location is kept in localStorage
 * (agsist-wx-loc, shared with /spray and /urea). The manual check needs no
 * network, so it works on a saved page with no signal. */
(function () {
  'use strict';
  var E = window.AgEMC;
  if (!E) return;
  var $ = function (id) { return document.getElementById(id); };
  var LS_LOC = 'agsist-wx-loc', LS_SET = 'agsist-emc';
  var ZIPS = 'https://dnilgis.github.io/bids/data/zips/';
  var state = { grain: 'corn', target: null, fan: 0, grainF: null, cfm: null, rows: null, raw: null, place: null, asof: null };

  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function fmt(x, d) { return (Math.round(x * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d); }
  function numIn(el) { var v = parseFloat(String(el.value).replace(',', '.')); return isFinite(v) ? v : null; }
  function g() { return E.GRAINS[state.grain]; }
  function target() { return state.target != null ? state.target : g().target; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function emcText(r) {
    if (!r || !r.ok) return '—';
    return (r.bound === 'over' ? 'over ' : r.bound === 'under' ? 'under ' : '') + fmt(r.wb, 1) + '%';
  }
  var WORD = { dry: 'Fans dry it', close: 'Close call', wet: 'Fans wet it' };
  var SHORT = { dry: 'dries', close: 'close', wet: 'wets' };

  function hourLabel(iso, withDay) {
    var d = new Date(iso);
    var h = d.getHours(), ap = h < 12 ? 'am' : 'pm', h12 = h % 12 || 12;
    var s = h12 + ' ' + ap;
    if (h === 0) s = 'midnight';
    if (h === 12) s = 'noon';
    return withDay ? dayName(iso) + ' ' + s : s;
  }
  function dayName(iso) {
    var d = new Date(iso), now = new Date();
    var a = new Date(d.getFullYear(), d.getMonth(), d.getDate()), b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var diff = Math.round((a - b) / 864e5);
    if (diff === 0) return d.getHours() >= 18 ? 'tonight' : 'today';
    if (diff === 1) return d.getHours() < 6 ? 'tonight' : 'tomorrow';
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  }

  /* ---------- settings ---------- */
  function readSettings() {
    var s = lsGet(LS_SET) || {};
    var q = new URLSearchParams(location.search);
    var gq = q.get('grain');
    state.grain = E.GRAINS[gq] ? gq : (E.GRAINS[s.grain] ? s.grain : 'corn');
    var tq = parseFloat(q.get('target'));
    state.target = isFinite(tq) ? tq : (s.targets && isFinite(s.targets[state.grain]) ? s.targets[state.grain] : null);
    state.fan = isFinite(parseFloat(q.get('fan'))) ? parseFloat(q.get('fan')) : (isFinite(s.fan) ? s.fan : 0);
    state.targets = s.targets || {};
    var mt = parseFloat(q.get('t')), mr = parseFloat(q.get('rh'));
    if (isFinite(mt)) $('emc-mt').value = mt;
    if (isFinite(mr)) $('emc-mrh').value = mr;
    if (isFinite(mt) && isFinite(mr)) { var d = $('emc-manual'); if (d) d.open = true; }
  }
  function saveSettings() {
    if (state.target != null) state.targets[state.grain] = state.target;
    lsSet(LS_SET, { grain: state.grain, targets: state.targets, fan: state.fan });
  }
  function syncInputs() {
    var bs = document.querySelectorAll('[data-grain]');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i].getAttribute('data-grain') === state.grain ? 'true' : 'false');
    $('emc-target').value = fmt(target(), 1);
    $('emc-fan').value = state.fan || 0;
    var n = document.querySelectorAll('[data-gname]');
    for (var j = 0; j < n.length; j++) n[j].textContent = g().name.toLowerCase();
  }

  /* ---------- the answer from the forecast ---------- */
  function renderForecast() {
    var box = $('emc-answer');
    if (!state.raw) return;
    var t = target();
    var rows = E.hourly(state.grain, state.raw.hours, t, state.fan, state.grainF);
    state.rows = rows;
    var now = E.assess(state.grain, state.raw.now.tF, state.raw.now.rh, t, state.fan);
    var v = now.verdict;
    box.className = 'emc-answer v-' + (v || 'none');
    $('emc-verdict').textContent = v ? WORD[v] : 'No answer for this air';
    var air = fmt(now.tF, 0) + ' F and ' + fmt(now.rh, 0) + '% humidity';
    var fanPart = state.fan > 0 ? ', ' + fmt(now.fanTF, 0) + ' F and ' + fmt(now.fanRh, 0) + '% after the fan' : '';
    var line;
    if (!now.emc.ok) line = 'Air now: ' + air + '. ' + cap(now.emc.reason) + ', so I show no number.';
    else line = 'Air now at ' + esc(state.place || 'your spot') + ': ' + air + fanPart + '. That air brings ' + g().name.toLowerCase() + ' to <b>' + emcText(now.emc) + '</b>. Your target is ' + fmt(t, 1) + '%.';
    $('emc-now').innerHTML = line;
    var inv = E.rhFor(state.grain, now.fanTF, t - E.MARGIN);
    $('emc-inv').innerHTML = inv && inv.inRange
      ? 'At ' + fmt(now.fanTF, 0) + ' F, fans dry ' + g().name.toLowerCase() + ' to ' + fmt(t - E.MARGIN, 1) + '% or lower while humidity' + (state.fan > 0 ? ' at the fan' : '') + ' stays under <b>' + fmt(Math.floor(inv.rh), 0) + '%</b>. Read your own gauge against that.'
      : '';
    var best = E.bestWindow(rows, 2);
    var nd = E.count(rows, 'dry'), nc = E.count(rows, 'close'), nw = E.count(rows, 'wet'), nn = rows.length - nd - nc - nw;
    $('emc-best').innerHTML = best
      ? '<button type="button" class="emc-zw" aria-expanded="false" aria-controls="emc-zwn" title="Named for Zach A., who asked for this tool.">Zach&rsquo;s window</button>: <b>' + hourLabel(rows[best.start].t, true) + ' to ' + hourLabel(endTime(rows[best.end].t), true) + '</b>, ' + best.len + ' hours of drying air, at or under ' + fmt(best.worst, 1) + '% ' + g().name.toLowerCase() + ' EMC.<span id="emc-zwn" class="emc-zwn" hidden>Named for Zach A., who asked for this tool.</span>'
      : 'No run of 2 or more drying hours in the next ' + rows.length + ' hours.';
    $('emc-count').textContent = 'Next ' + rows.length + ' hours: ' + nd + ' drying, ' + nc + ' close, ' + nw + ' wetting' + (nn ? ', ' + nn + ' with no answer (air out of range)' : '') + '.';
    $('emc-asof').textContent = 'Forecast from Open-Meteo for ' + (state.place || 'your spot') + ', pulled ' + state.asof.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '. Fan heat: ' + (state.fan > 0 ? state.fan + ' F.' : 'none.');
    drawStrip(rows, best);
    renderCooling();
    renderShare(now);
    $('emc-results').hidden = false;
    $('emc-hours').hidden = false;
    $('emc-intro').hidden = true;
  }
  function endTime(iso) { return new Date(new Date(iso).getTime() + 3600e3).toISOString(); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function drawStrip(rows, best) {
    var el = $('emc-strip');
    var out = [], lastDay = null;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], d = new Date(r.t), day = d.toDateString();
      var mark = day !== lastDay;
      lastDay = day;
      var inBest = best && i >= best.start && i <= best.end;
      var title = hourLabel(r.t, true) + ': ' + fmt(r.tF, 0) + ' F, ' + fmt(r.rh, 0) + '% RH, EMC ' + emcText(r.emc) + (r.verdict ? ', ' + SHORT[r.verdict] : ', no answer') + (r.cool ? ', cools' : '');
      out.push('<li class="h v-' + (r.verdict || 'none') + (inBest ? ' best' : '') + (mark ? ' day' : '') + (r.cool ? ' cool' : '') + '" title="' + esc(title) + '" data-i="' + i + '">' +
        (mark ? '<span class="dl">' + esc(d.toLocaleDateString('en-US', { weekday: 'short' })) + '</span>' : '') + '</li>');
    }
    el.innerHTML = out.join('');
    $('emc-tip').textContent = 'Tap an hour for its numbers.';
  }
  function tip(e) {
    var li = e.target.closest ? e.target.closest('li.h') : null;
    if (!li || !state.rows) return;
    var r = state.rows[+li.getAttribute('data-i')];
    if (!r) return;
    var s = hourLabel(r.t, true) + ': ' + fmt(r.tF, 0) + ' F, ' + fmt(r.rh, 0) + '%';
    if (state.fan > 0) s += ' (' + fmt(r.fanTF, 0) + ' F, ' + fmt(r.fanRh, 0) + '% at the fan)';
    s += '. EMC ' + emcText(r.emc) + (r.verdict ? ', ' + SHORT[r.verdict] : r.emc.ok ? ', no answer' : ', ' + r.emc.reason) + '.';
    if (r.cool) s += ' Cools the grain.';
    $('emc-tip').textContent = s;
  }

  /* ---------- manual check ---------- */
  function renderManual() {
    var t = numIn($('emc-mt')), rh = numIn($('emc-mrh')), out = $('emc-mout');
    if (t == null || rh == null) { out.innerHTML = 'Type a temperature and a humidity.'; out.className = 'emc-mout'; return; }
    var a = E.assess(state.grain, t, rh, target(), state.fan);
    if (!a.emc.ok) { out.className = 'emc-mout v-none'; out.innerHTML = 'No answer: ' + esc(a.emc.reason) + '.'; return; }
    out.className = 'emc-mout v-' + (a.verdict || 'none');
    var s = '<b>' + (a.verdict ? WORD[a.verdict] : 'No answer') + '.</b> ';
    if (state.fan > 0) s += 'With the fan adding ' + state.fan + ' F, that air reaches the grain at ' + fmt(a.fanTF, 0) + ' F and ' + fmt(a.fanRh, 0) + '%. ';
    s += g().name + ' in that air heads for ' + emcText(a.emc) + '; your target is ' + fmt(target(), 1) + '%.';
    out.innerHTML = s;
  }

  /* ---------- hygrometer table ---------- */
  function renderTable() {
    var t = target(), rows = [];
    for (var f = 20; f <= 90; f += 10) {
      var a = E.rhFor(state.grain, f, t), b = E.rhFor(state.grain, f, t - E.MARGIN);
      rows.push('<tr><th scope="row">' + f + ' F</th><td>' + cell(a) + '</td><td>' + cell(b) + '</td></tr>');
    }
    $('emc-rhtab').innerHTML = rows.join('');
    $('emc-rhcap1').textContent = fmt(t, 1);
    $('emc-rhcap2').textContent = fmt(t - E.MARGIN, 1);
    function cell(x) {
      if (!x) return '—';
      if (x.rh > E.LIMITS.rhMax) return 'over ' + E.LIMITS.rhMax + '%';
      if (x.rh < E.LIMITS.rhMin) return 'under ' + E.LIMITS.rhMin + '%';
      return Math.floor(x.rh) + '%';
    }
  }

  /* ---------- cooling ---------- */
  function renderCooling() {
    var out = $('emc-cout');
    var parts = [];
    var h = E.coolingHours(state.cfm);
    if (state.cfm != null && h == null) parts.push('Airflow should be between 0 and 5 cfm per bushel.');
    else if (h != null) parts.push('At ' + state.cfm + ' cfm per bushel, one cooling front takes about <b>' + Math.round(h) + ' fan hours</b> to pass through the bin (15 divided by cfm per bushel).');
    if (state.grainF != null && state.rows) {
      var n = 0;
      for (var i = 0; i < state.rows.length; i++) if (state.rows[i].cool) n++;
      parts.push('In the next ' + state.rows.length + ' hours, <b>' + n + '</b> are at least ' + E.COOL_GAP_F + ' F under your ' + fmt(state.grainF, 0) + ' F grain without wetting it. They show with a blue tick on the strip.');
      if (h != null) parts.push(n >= h ? 'That is enough to push one front through.' : 'That is short of one full front; finish it on the next cold spell.');
    } else if (state.grainF != null) parts.push('Pick a location to count the cooling hours ahead.');
    out.innerHTML = parts.length ? parts.join(' ') : 'Type your grain temperature to count cooling hours, and your airflow to see how long a front takes.';
  }

  /* ---------- share ---------- */
  function renderShare(now) {
    var t = target(), best = state.rows ? E.bestWindow(state.rows, 2) : null;
    var s = (now && now.verdict ? WORD[now.verdict] : 'No answer') + ' right now' + (state.place ? ' near ' + state.place : '') + ': ' +
      (now && now.emc.ok ? fmt(now.tF, 0) + ' F, ' + fmt(now.rh, 0) + '% brings ' + g().name.toLowerCase() + ' to ' + emcText(now.emc) + ' (target ' + fmt(t, 1) + '%).' : 'air out of range.') +
      (best ? " Zach's window: " + hourLabel(state.rows[best.start].t, true) + ' to ' + hourLabel(endTime(state.rows[best.end].t), true) + ', ' + best.len + ' h.' : '');
    $('emc-line').textContent = s;
  }
  function shareUrl() {
    var u = location.origin + location.pathname + '?grain=' + state.grain + '&target=' + fmt(target(), 1);
    if (state.fan > 0) u += '&fan=' + state.fan;
    return u;
  }

  /* ---------- location and forecast ---------- */
  function status(msg, err) { var s = $('emc-status'); s.textContent = msg || ''; s.className = 'emc-status' + (err ? ' err' : ''); }
  function getJSON(url, ms) {
    var c = typeof AbortController === 'function' ? new AbortController() : null;
    var to = setTimeout(function () { if (c) c.abort(); }, ms || 9000);
    return fetch(url, c ? { signal: c.signal } : {}).then(function (r) { clearTimeout(to); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function load(lat, lon, label) {
    state.place = label || 'your location';
    status('Getting the forecast for ' + state.place + '…');
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + (+lat).toFixed(3) + '&longitude=' + (+lon).toFixed(3) +
      '&current=temperature_2m,relative_humidity_2m&hourly=temperature_2m,relative_humidity_2m&temperature_unit=fahrenheit&timezone=auto&forecast_days=4';
    return getJSON(url, 10000).then(function (d) {
      var hs = d.hourly || {}, times = hs.time || [];
      var curT = d.current && d.current.time ? d.current.time.slice(0, 13) : null;
      var i0 = 0;
      for (var i = 0; i < times.length; i++) if (curT && times[i].slice(0, 13) === curT) { i0 = i; break; }
      var off = d.utc_offset_seconds || 0;
      var hours = [];
      for (var j = i0; j < times.length && hours.length < 72; j++) {
        hours.push({ t: localIso(times[j], off), tF: hs.temperature_2m[j], rh: hs.relative_humidity_2m[j] });
      }
      if (!d.current || !hours.length) throw new Error('empty forecast');
      state.raw = { now: { tF: d.current.temperature_2m, rh: d.current.relative_humidity_2m }, hours: hours };
      state.asof = new Date();
      lsSet(LS_LOC, Object.assign(lsGet(LS_LOC) || {}, { lat: +lat, lon: +lon, label: label || null }));
      $('emc-place').textContent = state.place;
      $('emc-locbox').hidden = true;
      $('emc-change').hidden = false;
      status('');
      renderForecast();
    }).catch(function () {
      status('Could not get the forecast. The check under "Type your own reading" still works.', true);
      $('emc-locbox').hidden = false;
    });
  }
  /* Open-Meteo gives local wall time with no zone; turn it into a real
   * instant using its UTC offset, so labels match the farm's clock even when
   * the phone is set to another zone (labels then use the phone's zone). */
  function localIso(s, off) { return new Date(Date.parse(s + ':00Z') - off * 1000).toISOString(); }

  function byZip() {
    var z = String($('emc-zip').value || '').trim();
    if (!/^\d{5}$/.test(z)) { status('Enter a 5-digit ZIP.', true); return; }
    status('Looking up ' + z + '…');
    getJSON(ZIPS + z.slice(0, 2) + '.json', 6000).then(function (t) {
      var p = t && t[z];
      if (Array.isArray(p) && isFinite(+p[0]) && isFinite(+p[1]) && !(+p[0] === 0 && +p[1] === 0)) return [+p[0], +p[1]];
      throw new Error('not in table');
    }).catch(function () {
      return getJSON('https://geocoding-api.open-meteo.com/v1/search?name=' + z + '&count=1&language=en&format=json&countryCode=US', 6000).then(function (d) {
        var r = d && d.results && d.results[0];
        if (!r) throw new Error('none');
        return [r.latitude, r.longitude];
      });
    }).then(function (ll) { load(ll[0], ll[1], 'ZIP ' + z); })
      .catch(function () { status('Could not find ZIP ' + z + '. Check it and try again.', true); });
  }
  function byDevice() {
    if (!navigator.geolocation) { status('This browser cannot share a location. Enter a ZIP.', true); return; }
    status('Waiting for your location…');
    navigator.geolocation.getCurrentPosition(function (p) { load(p.coords.latitude, p.coords.longitude, 'your location'); },
      function () { status('No location came through. Enter a ZIP instead.', true); }, { timeout: 8000, maximumAge: 600000 });
  }

  /* ---------- wire up ---------- */
  function rerender() { syncInputs(); renderManual(); renderTable(); renderForecast(); renderCooling(); }
  function init() {
    readSettings();
    syncInputs();
    var bs = document.querySelectorAll('[data-grain]');
    for (var i = 0; i < bs.length; i++) bs[i].addEventListener('click', function () {
      state.grain = this.getAttribute('data-grain');
      state.target = isFinite(state.targets[state.grain]) ? state.targets[state.grain] : null;
      saveSettings(); rerender();
    });
    $('emc-target').addEventListener('change', function () {
      var v = numIn(this);
      state.target = v != null && v > 5 && v < 30 ? v : null;
      saveSettings(); rerender();
    });
    $('emc-fan').addEventListener('change', function () {
      var v = numIn(this);
      state.fan = v != null && v >= 0 && v <= 30 ? v : 0;
      saveSettings(); rerender();
    });
    ['emc-mt', 'emc-mrh'].forEach(function (id) { $(id).addEventListener('input', renderManual); });
    $('emc-gt').addEventListener('input', function () { state.grainF = numIn(this); if (state.raw) renderForecast(); else renderCooling(); });
    $('emc-cfm').addEventListener('input', function () { state.cfm = numIn(this); renderCooling(); });
    $('emc-zipgo').addEventListener('click', byZip);
    $('emc-zip').addEventListener('keydown', function (e) { if (e.key === 'Enter') byZip(); });
    $('emc-geo').addEventListener('click', byDevice);
    $('emc-change').addEventListener('click', function () { $('emc-locbox').hidden = false; $('emc-zip').focus(); });
    $('emc-strip').addEventListener('click', tip);
    $('emc-best').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.emc-zw') : null;
      if (!b) return;
      var n = $('emc-zwn');
      if (n) { n.hidden = !n.hidden; b.setAttribute('aria-expanded', n.hidden ? 'false' : 'true'); }
    });
    $('emc-strip').addEventListener('mouseover', tip);
    $('emc-copy').addEventListener('click', function () {
      var txt = $('emc-line').textContent + ' ' + shareUrl();
      var done = function () { $('emc-copy').textContent = 'Copied'; setTimeout(function () { $('emc-copy').textContent = 'Copy the answer'; }, 2000); };
      if (navigator.share && /Mobi/i.test(navigator.userAgent)) { navigator.share({ text: $('emc-line').textContent, url: shareUrl() }).catch(function () {}); return; }
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, function () {});
    });
    $('emc-print').addEventListener('click', function () { window.print(); });
    renderManual(); renderTable(); renderCooling();
    var loc = lsGet(LS_LOC);
    if (loc && isFinite(loc.lat) && isFinite(loc.lon)) load(loc.lat, loc.lon, loc.label || 'your saved location');
    else $('emc-locbox').hidden = false;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
