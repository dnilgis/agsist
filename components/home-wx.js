/* home-wx.js: the weather band on /index1.html (Nov 12, 2026). Draws into the two sections index1.html lays out
   (#f2 holds the forecast and the live radar, #hp-wxb holds rain and corn GDUs against normal), so nothing here
   moves the page: every box holds its room in css/home-wx.css.

   WHERE EACH NUMBER COMES FROM (nothing is worked out here beyond a sum or a subtraction):
     place     AgSavedPlace (components/saved-place.js): the ZIP the reader typed or the place found after a tap on
               "Use my location". Nothing leaves the browser but the files below and the weather service call.
     forecast  the National Weather Service grid (components/nws.js), live in the browser.
     radar     Windy's radar layer, loaded only when the band nears the screen, sandboxed; on a phone the map takes
               no touches until "Tap to move the map".
     rain, GDU data/rain/<st>.json and data/rain/wx/<st>.json (NOAA daily records through RCC-ACIS) for the reader's
               county; the percent is the file's own, withheld when the file withholds it. The bars are the shared
               chart kit (components/ag-chart.js with components/ag-bars.js, AgChart.mountBars) with its Share and Save the picture.
   FAIL SOFT: each source that does not answer says so in its own box; the rest of the band carries on. */
(function (root) {
  'use strict';
  var doc = root.document;
  if (!doc || !doc.getElementById('hp-wxb')) return;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(x) { return typeof x === 'number' && isFinite(x); }
  function f1(x, d) { return Number(x).toFixed(d == null ? 1 : d); }
  function comma(x) { return Math.round(x).toLocaleString('en-US'); }
  function utc(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; }
  function md(d) { return MON[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
  function addDays(d, n) { return new Date(d.getTime() + n * 864e5); }
  function doy(d) { return Math.round((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5); }

  function ctDay(t) {
    try {
      var p = {};
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(t || new Date()).forEach(function (x) { p[x.type] = x.value; });
      return new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
    } catch (e) { var n = t || new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); }
  }

  function county(s) {
    return String(s || '').toLowerCase().replace(/\b(county|parish|borough|census area|city and borough|municipality)\b/g, '')
      .replace(/\bsaint\b/g, 'st').replace(/[^a-z0-9]/g, '');
  }
  function countyName(c, st) {
    c = String(c || '').trim();
    if (!c || /\b(County|Parish|Borough|Census Area|Municipality)$/i.test(c)) return c;
    return c + (st === 'LA' ? ' Parish' : st === 'AK' ? ' Borough' : ' County');
  }

  function $(id) { return doc.getElementById(id); }
  function txt(id, t) { var e = $(id); if (e) e.textContent = t; return e; }
  function html(id, h) { var e = $(id); if (e) e.innerHTML = h; return e; }
  function timed(p, ms) {
    var to; var t = new Promise(function (_, rej) { to = setTimeout(function () { rej(new Error('timeout')); }, ms || 12000); });
    return Promise.race([p, t]).then(function (v) { clearTimeout(to); return v; }, function (e) { clearTimeout(to); throw e; });
  }
  var memo = {};
  function getJSON(u, ms) {
    if (!memo[u]) memo[u] = timed(fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }), ms)
      .then(null, function (e) { delete memo[u]; throw e; });
    return memo[u];
  }

  var PHONE = root.matchMedia ? root.matchMedia('(max-width:640px)') : null;
  function phone() { return !!(PHONE && PHONE.matches); }

  function later(el, fn) {
    if (!el) return;
    if (!('IntersectionObserver' in root)) { fn(); return; }
    var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); fn(); } }, { rootMargin: '400px 0px' });
    io.observe(el);
  }


  function readPlace() { try { return root.AgSavedPlace ? root.AgSavedPlace.read() : null; } catch (e) { return null; } }
  function hasZip(p) { return !!(p && /^\d{5}$/.test(String(p.zip || ''))); }
  function fullPlace() {
    try { if (root.AgSavedPlace) return root.AgSavedPlace.full().then(function (p) { return p || readPlace(); }, function () { return readPlace(); }); } catch (e) {}
    return Promise.resolve(readPlace());
  }


  /* ---- weather band ---- */
  var band = { zip: '', seq: 0 };
  var WX = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
    56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow',
    75: 'Heavy snow', 77: 'Snow', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorms', 96: 'Thunderstorms', 99: 'Thunderstorms' };
  function compass(d) { return num(d) ? ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((d % 360) + 360) % 360 / 45) % 8] : ''; }
  function stateFile(dir, st, ext) { return '/data/' + dir + st.toLowerCase() + (ext || '.json'); }
  /* the reader's county in a state's rain file: {fips, c, near} (near: no station in the county; the file names the nearest county) */
  function findCounty(R, name) {
    var key = county(name), cs = (R && R.counties) || {}, k;
    if (!key) return null;
    for (k in cs) if (county(cs[k].name) === key) return { fips: k, c: cs[k] };
    var none = (R && R.none) || {};
    for (k in none) if (county(none[k].name) === key) {
      if (cs[none[k].near]) return { fips: k, c: cs[none[k].near], near: none[k].near, nearName: cs[none[k].near].name };
      if (/^\d{5}$/.test(String(none[k].near || ''))) return { fips: k, cross: String(none[k].near) };   /* the nearest gauge is in another state's file */
    }
    return null;
  }
  /* state FIPS -> postal code, to find a nearest county across a state line in its own state's file (round 3) */
  var FIPS_ST = { '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
    '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ',
    '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA',
    '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY' };
  function fcFail(t) { var m = $('hp-fc-msg'), a = doc.querySelector('.hp-a-fc'); if (m) { m.textContent = t; m.style.background = t ? 'var(--surface)' : ''; } if (a) a.classList.toggle('fcfail', !!t); }
  /* the old home's weather icons (index.html sprite), from the NWS words made into WMO-style codes (components/nws.js) */
  function wxIcon(code, day, cls) {
    var k = code == null ? 'i-cloud-sun' : code === 0 ? (day === 0 ? 'i-moon' : 'i-sun') : code <= 2 ? 'i-cloud-sun' : code === 3 ? 'i-cloud' : code === 45 || code === 48 ? 'i-cloud-fog'
      : code >= 51 && code <= 57 ? 'i-cloud-sun-rain' : code >= 61 && code <= 67 ? 'i-cloud-rain' : code >= 71 && code <= 77 ? 'i-snowflake' : code >= 80 && code <= 82 ? 'i-cloud-sun-rain'
      : code === 85 || code === 86 ? 'i-snowflake' : code >= 95 ? 'i-cloud-lightning' : 'i-cloud-sun';
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#' + k + '"/></svg>';
  }
  function hr12(iso) { var h = +String(iso).slice(11, 13); return h === 0 ? '12 am' : h === 12 ? 'noon' : (h % 12) + (h < 12 ? ' am' : ' pm'); }
  /* owner, Nov 12: the old home's fuller forecast: now (icon, temperature, feels like, wind, humidity, dew point,
     chance of rain), the days with icons, highs, lows and chance of rain, and the next 24 hours behind a fold */
  function drawForecast(p, seq) {
    if (!root.AgNWS) { fcFail('The forecast did not load. Try again in a few minutes.'); return; }
    root.AgNWS.forecast(p.lat, p.lon, { days: 8 }).then(function (f) {
      if (seq !== band.seq) return;
      var c = f.current || {}, D = f.daily || {}, H = f.hourly || {}, r = function (v) { return num(v) ? Math.round(v) : null; };
      txt('hp-now-t', num(c.temperature_2m) ? Math.round(c.temperature_2m) + '°' : '--°');
      var ni = $('hp-now-i'); if (ni) ni.outerHTML = wxIcon(c.weather_code, c.is_day, 'hp-nowi').replace('<svg ', '<svg id="hp-now-i" ');
      /* the grid's forecast for the hour that holds now, not a reading (audit Q15, C14) */
      html('hp-now-d', '<b>' + esc(WX[c.weather_code] || 'Forecast') + '</b><br>Hourly forecast');
      txt('hp-nw-f', r(c.apparent_temperature) != null ? r(c.apparent_temperature) + '°' : '-');
      txt('hp-nw-w', num(c.wind_speed_10m) ? (Math.round(c.wind_speed_10m) === 0 ? 'Calm' : (compass(c.wind_direction_10m) + ' ' + Math.round(c.wind_speed_10m) + ' mph').trim()) : '-');
      txt('hp-nw-h', r(c.relative_humidity_2m) != null ? r(c.relative_humidity_2m) + '%' : '-');
      txt('hp-nw-d', r(c.dew_point_2m) != null ? r(c.dew_point_2m) + '°' : '-');
      txt('hp-nw-p', r(c.precipitation_probability) != null ? r(c.precipitation_probability) + '%' : '-');
      var snowSoon = (H.weather_code || []).slice(0, 24).some(function (cc) { return (cc >= 71 && cc <= 77) || cc === 85 || cc === 86; });
      txt('hp-nw-pk', snowSoon ? 'Chance of rain or snow' : 'Chance of rain');
      /* round 3: each card's chance is the daytime one (6 am to 5 pm, from the hourly grid), so a night block is not
         counted on two days (the daily max ran midnight to midnight: Sunday night's 40% showed on Monday too); its low is
         the night after its high, so the pair reads as one day and night; a day with no high is left out, and today
         stays while it has a high (its low can be past: "-") */
      var times = D.time || [], todayKey = (c.time || '').slice(0, 10), i0 = Math.max(0, times.indexOf(todayKey)), lis = [];
      var HT = H.time || [], HP = H.precipitation_probability || [], HTe = H.temperature_2m || [], HC = H.weather_code || [];
      var dayPop = function (key) { var m = null; for (var q = 0; q < HT.length; q++) { var t = String(HT[q]), hh = +t.slice(11, 13); if (t.slice(0, 10) === key && hh >= 6 && hh <= 17 && num(HP[q])) m = m == null ? HP[q] : Math.max(m, HP[q]); } return m; };
      /* the night's low only when the grid reaches past midnight into it (the last card's evening alone is not a low) */
      var nightLow = function (key, next) { var m = null, late = false; for (var q = 0; q < HT.length; q++) { var t = String(HT[q]), hh = +t.slice(11, 13); if (next && t.slice(0, 10) === next && hh < 6) late = true; if (((t.slice(0, 10) === key && hh >= 18) || (next && t.slice(0, 10) === next && hh < 6)) && num(HTe[q])) m = m == null ? HTe[q] : Math.min(m, HTe[q]); } return late ? m : null; };
      /* the day's icon and words from the same 6 am to 5 pm hours as its chance: the worst code in them */
      var dayCode = function (key, fb) { var w = null; for (var q = 0; q < HT.length; q++) { var t = String(HT[q]), hh = +t.slice(11, 13), cc = HC[q]; if (t.slice(0, 10) === key && hh >= 6 && hh <= 17 && num(cc) && (w == null || cc > w)) w = cc; } return w == null ? fb : w; };
      var snowy = function (key) { for (var q = 0; q < HT.length; q++) { var t = String(HT[q]), hh = +t.slice(11, 13), cc = HC[q]; if (t.slice(0, 10) === key && hh >= 6 && hh <= 17 && ((cc >= 71 && cc <= 77) || cc === 85 || cc === 86)) return true; } return false; };
      for (var i = i0; i < times.length && lis.length < 7; i++) {
        var hi = (D.temperature_2m_max || [])[i];
        if (!num(hi)) continue;   /* a day with no high (past the grid's end, or today's high already gone) is left out */
        var dd = utc(times[i]), nl = nightLow(times[i], times[i + 1]), lo = nl, dc = dayCode(times[i], (D.weather_code || [])[i]);
        var pp = dayPop(times[i]); if (!num(pp)) pp = (D.precipitation_probability_max || [])[i];
        var word = snowy(times[i]) ? 'snow' : 'rain';
        lis.push('<li><b>' + (times[i] === todayKey ? 'Today' : DOW[dd.getUTCDay()]) + '</b>' + wxIcon(dc, 1) + '<span><span class="visually-hidden">high </span><span class="hi">' + Math.round(hi) + '°</span> <span class="visually-hidden">, low </span><span class="lo">' + (num(lo) ? Math.round(lo) + '°' : '-')
          + '</span><span class="visually-hidden">, ' + esc(WX[dc] || '') + ', </span></span><span class="pp">' + (num(pp) ? Math.round(pp) + '% ' + word + '<span class="visually-hidden"> chance</span>' : '-') + '</span></li>');
      }
      if (lis.length) html('hp-d7', lis.join(''));
      /* the next 24 hours from this hour */
      var ht = H.time || [], h0 = -1, now = String(c.time || '').slice(0, 13), cells = [];
      for (var k = 0; k < ht.length; k++) if (String(ht[k]).slice(0, 13) >= now) { h0 = k; break; }
      if (h0 >= 0) for (var j = h0; j < ht.length && cells.length < 24; j++) {
        var tt = (H.temperature_2m || [])[j], hp = (H.precipitation_probability || [])[j];
        cells.push('<div><b>' + (j === h0 ? 'Now' : hr12(ht[j])) + '</b>' + wxIcon((H.weather_code || [])[j], (H.is_day || [])[j]) + (num(tt) ? Math.round(tt) + '°' : '-') + '<span class="pp">' + (num(hp) ? Math.round(hp) + '%<span class="visually-hidden"> chance of rain or snow</span>' : '-') + '</span></div>');
      }
      var hr = $('hp-hourly'); if (hr) hr.hidden = !cells.length; if (cells.length) html('hp-hr', cells.join(''));
      var src = 'High, then the low of the night after; percent: chance of rain or snow, 6 am to 5 pm. National Weather Service';
      try { var n = f._nws; if (n && n.updated) src += ', issued ' + new Date(n.updated).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: f.timezone || undefined, timeZoneName: 'short' }); } catch (e) {}
      txt('hp-fc-src', src + '.');
      fcFail(''); var m = $('hp-fc-msg'); if (m) m.style.background = '';
    }, function (e) {
      if (seq !== band.seq) return;
      fcFail(e && e.outside ? 'The National Weather Service has no forecast for this point.' : 'The National Weather Service forecast did not answer. Try again in a few minutes.');
    });
  }
  /* owner, Nov 12: the live radar back on the home page, as the old home had it (Windy's radar layer, the same embed
     components/geo.js built), centred on the reader's place; it loads only when the band comes near the screen
     (loadBand runs from later()), holds its room, and says so if it does not come in */
  /* round 3 (phones): the map takes no touches until "Tap to move the map", so a thumb scrolling the page is not caught in it */
  /* a11y re-measure: after the tap, focus goes to the map's box (not lost to the page); "Done" gives the page its scroll back */
  function liveTap() {
    var b = $('hp-livego'), d = $('hp-livedone'), box = $('hp-live'); if (!b || !box) return;
    b.addEventListener('click', function () { box.classList.add('on'); try { box.focus({ preventScroll: true }); } catch (e) { box.focus(); } });
    if (d) d.addEventListener('click', function () { box.classList.remove('on'); try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); } });
  }
  var liveSeq = 0;
  /* a11y round 3 (A2, A5): a frame's load event fires on a failed page too, so the host is probed first (a no-cors
     fetch that rejects when Windy cannot be reached), and each call has its own sequence number so a late timer from an
     earlier place never writes over a newer one */
  function drawLive(p) {
    var f = $('hp-live-f'), msg = $('hp-live-msg'), box = $('hp-live'); if (!f) return;
    var la = (+p.lat).toFixed(4), lo = (+p.lon).toFixed(4), mine = ++liveSeq;
    var u = 'https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=in&metricTemp=%C2%B0F&metricWind=mph&zoom=7&overlay=radar&product=radar&level=surface'
      + '&lat=' + la + '&lon=' + lo + '&detailLat=' + la + '&detailLon=' + lo + '&detail=false&pressure=false&menu=false&message=false&marker=true&calendar=now&thunder=false';
    if (f.getAttribute('src') === u) return;
    var fail = function () { if (mine !== liveSeq) return; f.removeAttribute('src'); f.hidden = true; if (box) box.classList.add('fail'); if (msg) msg.textContent = 'The live radar did not load. Try again in a few minutes, or open the radar on the rain page.'; };
    if (box) box.classList.remove('fail', 'ok');
    if (msg) msg.textContent = 'Loading the live radar';
    var probe = root.fetch ? timed(fetch('https://embed.windy.com/', { mode: 'no-cors', cache: 'no-store' }), 10000) : Promise.resolve();
    probe.then(function () {
      if (mine !== liveSeq) return;
      var done = false;
      f.onload = function () { if (mine !== liveSeq) return; done = true; f.hidden = false; if (box) box.classList.add('ok'); if (msg) msg.textContent = ''; };
      f.hidden = false; f.setAttribute('src', u);
      setTimeout(function () { if (!done) fail(); }, 15000);
    }, fail);
  }
  function liveOff() { liveSeq++; var f = $('hp-live-f'); if (f) { f.removeAttribute('src'); f.hidden = true; } }
  function mmddDate(v, yr) { return num(v) && v >= 101 && v <= 1231 ? new Date(Date.UTC(yr, Math.floor(v / 100) - 1, v % 100)) : null; }
  function loadBand() {
    var p0 = readPlace();
    if (!hasZip(p0)) return;
    fullPlace().then(function (p) {
      if (!p || !hasZip(p) || p.lat == null || !/^[A-Z]{2}$/.test(p.state || '')) {
        /* a11y round 3 (A6): a ZIP table that did not download is "did not load, try again", not an unknown ZIP */
        var zz = p && p.zip ? p.zip : '';
        if (!zz) return;
        placeCheck(zz).then(function (r) { if (r === 'failed') bandFailed('The place for ZIP ' + zz + ' did not load. Try again in a minute.'); else unknownBand(zz); });
        return;
      }
      var wh = $('hp-wx-where'); if (wh) wh.textContent = p.town ? ', ' + p.town + ', ' + p.state : ', ZIP ' + p.zip;
      if (band.zip === p.zip) return;
      band.zip = p.zip; var seq = ++band.seq;
      var wm0 = $('hp-wxmsg'); if (wm0) wm0.textContent = '';
      drawForecast(p, seq);
      drawLive(p);
      getJSON(stateFile('rain/', p.state)).then(function (R) {
        var cf = findCounty(R, p.county), wst = p.state;
        if (!cf || !cf.cross) return [R, cf, wst];
        /* round 3: the nearest gauge is across the state line: read it from that state's own file */
        var st2 = FIPS_ST[cf.cross.slice(0, 2)];
        if (!st2) return [R, null, wst];
        return getJSON(stateFile('rain/', st2)).then(function (R2) {
          var c2 = R2 && R2.counties && R2.counties[cf.cross];
          return c2 ? [R2, { fips: cf.fips, c: c2, near: cf.cross, nearName: c2.name + ', ' + st2 }, st2] : [R, null, wst];
        }, function () { return [R, null, wst]; });
      }).then(function (rr) {
        if (seq !== band.seq) return;
        var R = rr[0], cf = rr[1], wst = rr[2];
        drawRain(R, p, cf);
        if (!cf) { msgIn('hp-gdu-ch', 'No temperature station on file for this county.'); return; }
        getJSON(stateFile('rain/wx/', wst)).then(function (W) { if (seq === band.seq) drawGdu(W, p, cf.near || cf.fips, cf); }, function () { msgIn('hp-gdu-ch', 'The GDU file did not load. Try again later.'); });
      }, function () { msgIn('hp-rain-ch', 'The rain file did not load. Try again later.'); msgIn('hp-gdu-ch', 'The GDU file did not load. Try again later.'); });
    });
  }

  function ga(n, p) { try { p = p || {}; p.page = 'home'; if (typeof root.gtag === 'function') root.gtag('event', n, p); } catch (e) {} }
  /* a message in a chart box: the old bars go, the box's tools go with them */
  function msgIn(id, t) {
    var b = $(id); if (!b) return; var m = b.querySelector('.hp-msg'); if (m) m.textContent = t || '';
    if (t) { var x = b.querySelector('.hp-bx'); if (x) x.innerHTML = ''; var tl = b.parentNode && b.parentNode.querySelector('.hp-tools'); if (tl) tl.innerHTML = ''; }
  }
  function placeCheck(z) {
    return getJSON('/data/places/zip/' + z.slice(0, 2) + '.json', 8000).then(function (t) { return t && Array.isArray(t[z]) ? 'ok' : 'unknown'; },
      function (e) { return e && /HTTP 404/.test(String(e.message)) ? 'unknown' : 'failed'; });
  }
  /* one short message for the whole band, not one in each box */
  function bandMsg(t, rest) {
    var wm = $('hp-wxmsg'); if (wm) wm.textContent = t;
    fcFail(rest || t); liveOff(); txt('hp-live-msg', rest || t); ['hp-rain-ch', 'hp-gdu-ch'].forEach(function (id) { msgIn(id, rest || t); });
  }
  function bandFailed(t) { bandMsg(t); }
  function unknownBand(z) { bandMsg('ZIP ' + z + ' is not in our ZIP table. Check the five digits at the top of the page for your forecast, radar, rain and GDUs.', 'ZIP ' + z + ' is not in our ZIP table.'); }

  /* the key above a chart: this year's gold, the normal's slate, and the hatched n/a only when a month is withheld */
  function keyFor(id, yr, normText, gaps) {
    var k = $(id); if (!k) return;
    k.innerHTML = '<span><i></i>' + esc(yr) + '</span>' + (normText ? '<span><i class="n"></i>' + esc(normText) + '</span>' : '') + (gaps ? '<span><i class="x"></i>n/a: too few days reported</span>' : '');
  }
  function mountChart(boxId, G, o) {
    var box = $(boxId), x = box && box.querySelector('.hp-bx'), tl = box && box.parentNode.querySelector('.hp-tools');
    if (!x || !root.AgChart || !root.AgChart.mountBars) { msgIn(boxId, 'The chart did not load. Try again in a few minutes.'); return; }
    var m = box.querySelector('.hp-msg'); if (m) m.textContent = '';
    if (tl) tl.innerHTML = '';
    var iso = o.end ? o.end.toISOString().slice(0, 10) : ctDay().toISOString().slice(0, 10);
    root.AgChart.mountBars(x, { groups: G, steps: o.steps, fmt: o.fmt, vfmt: o.vfmt, names: o.names, label: o.label,
      story: function () { return { head: o.cardHead, take: o.sub, summary: o.label }; },
      tools: tl, height: { phone: 230, wide: 230 },
      share: { url: 'https://agsist.com/?utm_source=share&utm_medium=picture&utm_campaign=home-' + o.file, title: o.cardHead, file: 'agsist-' + o.file + '-' + iso + '.png',
        kicker: o.kicker, source: o.source, date: iso } });
  }
  function monthRows(arr, from, yr, end, hasN, ix) {
    var rows = [];
    for (var i = from; i < arr.length; i++) {
      var r = arr[i], ok = Array.isArray(r) && num(r[0]);
      rows.push({ lab: MON[i], a: ok ? r[0] : null, n: hasN && ok && num(r[1]) ? r[1] : null, gap: !ok, rep: ok ? r[2] : null, so: ok ? r[3] : null,
        part: !!end && i === end.getUTCMonth() && end.getUTCDate() < new Date(Date.UTC(yr, i + 1, 0)).getUTCDate() });
    }
    return rows;
  }
  function readoutFor(G, fmt, unit, pctMin) {
    G.forEach(function (r) {
      r.text = r.gap ? r.lab + ': not enough days reported'
        : r.lab + (r.part ? ' so far' : '') + ': ' + fmt(r.a) + unit + (num(r.n) ? '; normal ' + fmt(r.n) + unit + (r.n >= pctMin ? ' (' + Math.round(r.a / r.n * 100) + '%)' : '') : '')
          + (num(r.rep) && num(r.so) && r.rep < r.so ? '; ' + r.rep + ' of ' + r.so + ' days reported' : '');
    });
  }
  function drawRain(R, p, cf) {
    var c = cf && cf.c;
    if (!c || !Array.isArray(c.cum) || !c.cum.length || !num(c.total)) { msgIn('hp-rain-ch', 'No rain record for this county yet.'); txt('hp-rain-h', 'Rain this year'); html('hp-rain-pct', '&nbsp;'); return; }
    var yr = R.year || (utc(c.as_of) || ctDay()).getUTCFullYear(), end = utc(c.as_of || R.edate);
    /* the normal only where the file has one for every point: 18 of 93 Illinois counties carry usual null and a null
       normal on every day, which drew "normal 0.0 in" */
    var b = c.cum.map(function (r) { return r[2]; });
    var hasN = num(c.usual) && c.usual > 0 && b.every(num);
    /* the file's own percent, never one worked out here: the builder withholds it on a normal under 1.00 in */
    var pct = hasN && num(c.pct) ? c.pct : null;
    /* days the gauge did not report are not rain: say how many */
    var miss = num(c.missing) && c.missing > 0 ? c.missing : 0;
    var head = 'Rain this year: ' + f1(c.total) + ' in' + (num(pct) ? ', ' + pct + '% of normal' + (end ? ' to ' + md(end) : '') : '') + (miss ? '; ' + miss + ' day' + (miss === 1 ? '' : 's') + ' not reported' : '');
    txt('hp-rain-h', head);
    var normKey = hasN ? (miss ? 'Normal for the days reported: ' : 'Normal: ') + f1(c.usual) + ' in (1991 to 2020)' : '';
    var onDays = miss && num(c.reported) ? ' on the ' + c.reported + ' days reported' : '';
    /* rain's percent in a neutral colour: more rain is not good or bad by itself */
    html('hp-rain-pct', num(pct) ? '<b>' + pct + '%</b> of normal (' + f1(c.usual) + ' in' + (onDays || (end ? ' to ' + md(end) : '')) + ')'
      : hasN ? '<b>' + f1(c.total, 2) + ' in</b> since Jan 1; normal ' + f1(c.usual, 2) + ' in' + onDays + ', too small for a percent'
      : '<b>' + f1(c.total) + ' in</b> since Jan 1; no normal on file for this gauge');
    var G = monthRows(Array.isArray(c.months) ? c.months : [], 0, yr, end, hasN);
    if (!G.length) { msgIn('hp-rain-ch', 'No month totals for this county yet.'); return; }
    var gaps = G.some(function (r) { return r.gap; });
    keyFor('hp-rain-key', yr, normKey, gaps);
    readoutFor(G, function (v) { return f1(v, 2); }, ' in', 1);
    var st = c.station || {}, net = st.net === 'cocorahs' ? ' (CoCoRaHS)' : st.net ? ' (NOAA co-op)' : '';
    var borrowed = cf.near ? 'No station in ' + countyName(p.county, p.state) + '; nearest county: ' + cf.nearName + '. ' : '';
    var label = 'Rain by month, ' + yr + (hasN ? ', against the 1991 to 2020 normal for the same days' : '') + '. Since January 1: ' + f1(c.total, num(pct) ? 1 : 2) + ' inches'
      + (num(pct) ? ', ' + pct + ' percent of normal.' : hasN ? '; normal ' + f1(c.usual, 2) + ' inches, too small for a percent.' : '; no normal on file for this gauge.');
    mountChart('hp-rain-ch', G, { steps: [0.5, 1, 2, 5, 10], fmt: function (v) { return v + ' in'; }, vfmt: function (v) { return f1(v, 2) + ' in'; },
      names: { a: String(yr), n: hasN ? 'Normal 1991 to 2020' : '' }, label: label, end: end, file: 'rain',
      cardHead: head + (cf.near ? ', nearest gauge to ' : ' at ') + countyName(p.county, p.state) + ', ' + p.state,
      sub: String(yr) + ' by month (gold)' + (hasN ? ' against the 1991 to 2020 normal for the same days (slate)' : ', no normal on file for this gauge') + ', inches',
      kicker: 'Rain, ' + countyName(p.county, p.state) + ', ' + p.state,
      source: borrowed + (st.name ? 'Gauge: ' + st.name + net + '. ' : '') + 'NOAA daily records via RCC-ACIS, Jan 1 to ' + (end ? md(end) : '') + '.' });
    txt('hp-rain-src', 'Jan 1 to ' + (end ? md(end) : '') + '. ' + borrowed + (st.name ? 'Gauge: ' + st.name + net + '. ' : '') + 'NOAA daily records via RCC-ACIS.');
  }
  /* Corn GDUs since May 1. The headline is the file's season figure "g" ([total, days missing, normal over the same
     reported days, years, pct]; "m" when withheld for missing days). The bars are the monthly totals "gm" ([total,
     normal or null, days reported, days so far]; null when the month is withheld: drawn as n/a, never a zero). The end
     date is the county's own (c.a), not the state file's. */
  function drawGdu(W, p, fips, cf) {
    var borrowed = cf && cf.near ? 'No station in ' + countyName(p.county, p.state) + '; nearest county: ' + cf.nearName + '. ' : '';
    var c = W && W.counties && W.counties[fips], yr = (W && W.year) || ctDay().getUTCFullYear();
    var today = ctDay(), early = today < new Date(Date.UTC(today.getUTCFullYear(), 4, 15));
    var g = c && Array.isArray(c.g) && num(c.g[0]) ? c.g : null;
    if (!c || !Array.isArray(c.gm) || c.gm.length < 5 || !g) {
      msgIn('hp-gdu-ch', early && (!c || !Array.isArray(c.gm) || c.gm.length < 5) ? 'The corn GDU season starts May 1.' : c ? 'Not enough days reported at this station to count GDUs.' : 'No temperature station on file for this county.');
      html('hp-gdu-pct', '&nbsp;'); return;
    }
    var end = mmddDate(c.a, yr) || utc(W.edate), gaps = [];
    var G = monthRows(c.gm, 4, yr, end, true);
    G.forEach(function (x) { if (x.gap) gaps.push(x.lab); });
    if (!G.some(function (x) { return !x.gap; })) { msgIn('hp-gdu-ch', 'Not enough days reported at this station to count GDUs.'); return; }
    var hasNM = G.some(function (x) { return num(x.n); });
    var now = g[0], norm = num(g[2]) && g[2] > 0 ? g[2] : null, gp = norm ? (num(g[4]) ? g[4] : Math.round(now / norm * 100)) : null;
    var gmiss = num(g[1]) && g[1] > 0 ? g[1] : 0;
    var head = 'Corn GDUs since May 1: ' + comma(now) + (norm ? ', ' + comma(Math.abs(now - norm)) + (now >= norm ? ' ahead of' : ' behind') + ' normal' : '') + (gmiss ? '; ' + gmiss + ' day' + (gmiss === 1 ? '' : 's') + ' not reported' : '');
    txt('hp-gdu-h', head);
    /* no big percent on a season normal under 100 GDUs (a few May days make a wild percent) */
    html('hp-gdu-pct', norm && norm >= 100 ? '<b class="' + (gp >= 100 ? 'up' : 'dn') + '">' + gp + '%</b> of normal (' + comma(norm) + ')' : norm ? '<b>' + comma(now) + '</b> GDUs; normal ' + comma(norm) + ' so far' : '<b>' + comma(now) + '</b> GDUs; no normal on file for this station');
    keyFor('hp-gdu-key', yr, hasNM ? 'Normal 1991 to 2020' : '', gaps.length > 0);
    var fz = c.fr && Array.isArray(c.fr.f28) ? mmddDate(c.fr.f28[0], yr) : null;
    var tail = (gaps.length ? ' Not enough days reported in ' + gaps.join(', ') + ' to draw ' + (gaps.length === 1 ? 'that month' : 'those months') + '; the season total counts the days reported in ' + (gaps.length === 1 ? 'it' : 'them') + (gmiss ? ' (' + gmiss + ' day' + (gmiss === 1 ? '' : 's') + ' missing)' : '') + '.' : '')
      + (fz && (!end || fz <= end) ? ' First 28°F freeze: ' + md(fz) + '.' : '');
    readoutFor(G, comma, ' GDUs', 50);
    var s = c.s && c.s[0] ? 'Station ' + c.s[0] + '. ' : '';
    var label = 'Corn growing degree units by month since May 1, ' + yr + ': ' + comma(now) + (norm && norm >= 100 ? ', ' + gp + ' percent of normal' : norm ? '; normal ' + comma(norm) + ' so far' : '; no 1991 to 2020 normal on file for this station') + '.';
    mountChart('hp-gdu-ch', G, { steps: [50, 100, 250, 500], fmt: comma, vfmt: comma, names: { a: String(yr), n: hasNM ? 'Normal 1991 to 2020' : '' }, label: label, end: end, file: 'gdu',
      cardHead: head + (borrowed ? ', nearest station to ' : ', ') + countyName(p.county, p.state) + ', ' + p.state,
      sub: String(yr) + ' by month (gold)' + (hasNM ? ' against the 1991 to 2020 normal for the same days (slate)' : ', no normal on file for this station') + ', corn GDUs, 86/50 method',
      kicker: 'Corn GDUs, ' + countyName(p.county, p.state) + ', ' + p.state, source: borrowed + s + 'NOAA daily records via RCC-ACIS, May 1 to ' + (end ? md(end) : '') + ', month ends.' });
    txt('hp-gdu-src', 'Counted May 1 through ' + (end ? md(end) : '') + ', 86/50 method, by month.' + tail + ' ' + borrowed + s + 'NOAA daily records via RCC-ACIS.');
  }

  /* ---- place and start ---- */
  var started = false;
  function placeChanged() {
    var z = hasZip(readPlace());
    doc.documentElement.classList.toggle('has-zip', z);
    var w = $('hp-wx-where'); if (w && !z) w.textContent = '';
    band.zip = ''; if (started) loadBand();
  }
  function locMsg(t) { var m = $('hp-wxmsg'); if (m) m.textContent = t || ''; }
  function useLocation() {
    locMsg('Finding your location…'); ga('location_tap', {});
    var before = (readPlace() || {}).zip || '', failed = false;
    root.agsistGeoFailed = function () { failed = true; locMsg('Your location did not come through. Type your ZIP at the top of the page.'); };
    if (typeof root.requestGeo === 'function') root.requestGeo(); else { locMsg('Location is not ready yet. Type your ZIP at the top of the page.'); return; }
    var n = 0;
    (function wait() {
      var p = readPlace();
      if (p && p.zip && (p.zip !== before || n > 2) && p.lat != null) { locMsg(''); placeChanged(); return; }
      if (failed) return;
      if (++n < 40) setTimeout(wait, 300); else locMsg('Your location did not come through. Type your ZIP at the top of the page.');
    })();
  }
  function start() {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-hp-loc]'), function (b) { b.addEventListener('click', useLocation); });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-hp-zip]'), function (b) { b.addEventListener('click', function () { if (root.agsistOpenZip) root.agsistOpenZip(); }); });
    liveTap();
    root.addEventListener('agsist-place', placeChanged);
    root.addEventListener('storage', placeChanged);
    root._AGSIST_GEO_CALLBACKS = root._AGSIST_GEO_CALLBACKS || [];
    root._AGSIST_GEO_CALLBACKS.push(function () { setTimeout(placeChanged, 0); });
    later($('f2'), function () { started = true; loadBand(); });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(typeof self !== 'undefined' ? self : this);
