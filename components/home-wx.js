/* home-wx.js: the weather band on /index1.html (Nov 12, 2026). Draws into the two sections index1.html lays out
   (#f2 holds the forecast and the live radar, #hp-wxb holds rain and corn GDUs against normal), so nothing here
   moves the page: every box holds its room in css/home-wx.css.

   WHERE EACH NUMBER COMES FROM (nothing is worked out here beyond a sum or a subtraction):
     place     AgSavedPlace (components/saved-place.js): the ZIP the reader typed or the place found after a tap on
               "Use my location". Nothing leaves the browser but the files below and the weather service call.
     forecast  the National Weather Service grid (components/nws.js), live in the browser.
     radar     Windy's radar layer, loaded only when the band nears the screen, sandboxed; the map takes no touches
               or wheel turns until its button is pressed ("Tap to move the map" on a phone, "Click" with a pointer).
     rain, GDU data/rain/<st>.json and data/rain/wx/<st>.json (NOAA daily records through RCC-ACIS) for the reader's
               county; the percent is the file's own, withheld when the file withholds it. The bars are the shared
               chart kit (components/ag-chart.js with components/ag-bars.js, AgChart.mountBars) with its Share and Save the picture.
   FAIL SOFT: each source that does not answer says so in its own box; the rest of the band carries on. */
(function (root) {
  'use strict';
  var doc = root.document;
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

  /* ---- the day rows, worked out from the grid and nothing else (the tests read this function) ----
     A day's chance of rain is the National Weather Service's daytime period: the block that starts at 12Z and ends at
     00Z. The grid's chance blocks turn over at 12Z, which is a different clock hour in each zone (7 am Central
     standard, 8 am Eastern daylight) and moves an hour with daylight time, so the period is found from the grid's
     own UTC steps (time_unix) and never from a fixed local hour: a night block cannot land on the next day's card.
     Today counts only the hours from now on; when the day's hours are all gone the row reads "Tonight" and counts
     the hours from now to the next morning's period. The low is the grid's official low for the night after the
     day (the date it ends on); the hourly figure stands in only when the grid has no official one. */
  function hr12(iso) { var h = +String(iso).slice(11, 13); return h === 0 ? '12 am' : h === 12 ? 'noon' : (h % 12) + (h < 12 ? ' am' : ' pm'); }
  function hrAfter(iso) { var h = (+String(iso).slice(11, 13) + 1) % 24; return h === 0 ? '12 am' : h === 12 ? 'noon' : (h % 12) + (h < 12 ? ' am' : ' pm'); }
  /* the 12Z to 00Z daytime period is the one the CONUS forecast offices use; no grid from Alaska, Hawaii or the territories has been checked against it, so there the chance, amount and wind are withheld */
  var CONUS = /^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Detroit|Boise|Menominee|Indiana\/[A-Za-z_]+|Kentucky\/[A-Za-z_]+|North_Dakota\/[A-Za-z_]+)$/;
  /* the sentence under the day rows: what the percent covers, said for the rows it covers */
  function srcText(R) {
    var first = R.rows.filter(function (r) { return !r.tonight; })[0], kind = R.snow ? 'rain or snow' : 'rain';
    if (!R.conus) return 'High, then the low of the night after it. The chance of rain and the wind are not shown for this region.';
    var t = 'High, then the low of the night after it. Percent: chance of ' + kind;
    t += R.mixed && first ? ' in the forecast\'s daytime period (' + R.window + ' on ' + (first.label === 'Today' ? 'today' : first.label) + ')' : R.window ? ', ' + R.window : '';
    if (R.rows.length && R.rows[0].label === 'Today') t += ' (Today: the hours left)';
    if (R.rows.length && R.rows[0].tonight) t += ' (Tonight: now to ' + (R.nightTo || 'morning') + ')';
    return t + '. Rain in inches and the strongest wind in mph, for the same hours.';
  }
  function snowCode(cc) { return (cc >= 71 && cc <= 77) || cc === 85 || cc === 86; }
  function dayRows(f) {
    f = f || {};
    var c = f.current || {}, D = f.daily || {}, H = f.hourly || {}, HT = H.time || [], HU = H.time_unix || [];
    var HP = H.precipitation_probability || [], HTe = H.temperature_2m || [], HC = H.weather_code || [], HQ = H.precipitation || [], HW = H.wind_speed_10m || [], HG = H.wind_gusts_10m || [];
    var times = D.time || [], todayKey = String(c.time || '').slice(0, 10), nowHr = String(c.time || '').slice(0, 13);
    var offH = Math.round((f.utc_offset_seconds || 0) / 3600);
    function isDay(q) {
      var h = num(HU[q]) ? new Date(HU[q] * 1000).getUTCHours() : ((+String(HT[q]).slice(11, 13) - offH) % 24 + 24) % 24;
      return h >= 12;
    }
    function keyOf(q) { return String(HT[q]).slice(0, 10); }
    function dayIdx(key, fromNow) { var o = []; for (var q = 0; q < HT.length; q++) if (keyOf(q) === key && isDay(q) && (!fromNow || String(HT[q]).slice(0, 13) >= nowHr)) o.push(q); return o; }
    function tonightIdx() {
      var o = [], q = 0; while (q < HT.length && String(HT[q]).slice(0, 13) < nowHr) q++;
      for (; q < HT.length; q++) { if (isDay(q) && keyOf(q) !== todayKey) break; o.push(q); }
      return o;
    }
    function maxOf(a, idx) { var m = null; idx.forEach(function (q) { if (num(a[q]) && (m == null || a[q] > m)) m = a[q]; }); return m; }
    function nightFromHours(key, next) {
      var a = dayIdx(key, false), b = next ? dayIdx(next, false) : [], m = null;
      if (!a.length || !b.length) return null;
      for (var q = a[a.length - 1] + 1; q < b[0]; q++) if (num(HTe[q]) && (m == null || HTe[q] < m)) m = HTe[q];
      return m;
    }
    var conus = CONUS.test(String(f.timezone || ''));
    var rows = [], win = null, snowAny = false, mixed = false, nightTo = null, i0 = Math.max(0, times.indexOf(todayKey));
    for (var i = i0; i < times.length && rows.length < 7; i++) {
      var key = times[i], isToday = key === todayKey, hi = (D.temperature_2m_max || [])[i];
      var next = times[i + 1], lo = next != null ? (D.temperature_2m_min || [])[i + 1] : null;
      if (!num(lo)) lo = nightFromHours(key, next);
      var idx = dayIdx(key, isToday), tonight = false;
      if (isToday && !idx.length) {
        /* the day's hours are gone: the row is Tonight, whether or not the grid still holds today's high */
        idx = tonightIdx(); tonight = true;
        if (!idx.length && !num(lo)) continue;
        nightTo = idx.length ? hrAfter(HT[idx[idx.length - 1]]) : null;
      } else if (!num(hi)) continue;   /* a day with no high (past the grid's end) is left out */
      /* the chance, the rain amount and the wind are all for the same hours: the forecast's daytime period (Tonight: now to morning) */
      var pp = maxOf(HP, idx), worst = maxOf(HC, idx), snow = idx.some(function (q) { return snowCode(HC[q]); });
      var amt = 0, got = false;
      idx.forEach(function (q) { if (num(HQ[q])) { amt += HQ[q]; got = true; } });
      var spd = maxOf(HW, idx), gst = maxOf(HG, idx), dir = null;
      idx.forEach(function (q) { if (num(HW[q]) && HW[q] === spd && dir == null) dir = (H.wind_direction_10m || [])[q]; });   /* the direction of the strongest hour, not the day's mean */
      var d = utc(key);
      var whole = dayIdx(key, false), w = whole.length ? hr12(HT[whole[0]]) + ' to ' + hrAfter(HT[whole[whole.length - 1]]) : null;
      if (!tonight && w) { if (win == null) win = w; else if (w !== win) mixed = true; }
      if (snow) snowAny = true;
      rows.push({ key: key, label: tonight ? 'Tonight' : isToday ? 'Today' : DOW[d.getUTCDay()], tonight: tonight, hi: tonight ? null : hi, lo: num(lo) ? lo : null,
        pp: conus && num(pp) ? pp : null, word: snow ? 'snow' : 'rain', code: worst == null ? (D.weather_code || [])[i] : worst, amt: conus && got ? Math.round(amt * 100) / 100 : null,
        wind: conus && num(spd) ? { spd: spd, gust: gst, dir: dir } : null });
    }
    return { rows: rows, window: conus ? win : null, snow: snowAny, mixed: mixed, nightTo: nightTo, conus: conus };
  }

  /* ---- this year against normal: the points of the two running-total lines and the words around them ----
     Pure, so the tests read them. Nothing is worked out beyond a sum or a difference of the file's own figures.
     x is days elapsed since Jan 1 (Jan 1 morning is 0, the end of Jan 31 is 31). */
  var MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function xStart(yr, m) { return doy(new Date(Date.UTC(yr, m, 1))); }
  function whenOf(yr, x) { var d = new Date(Date.UTC(yr, 0, 1) + (x - 1) * 864e5); return MON[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
  function madeMonths(rows, gap) {
    if (!rows.length || !num(gap) || Math.round(Math.abs(gap) * 10) === 0) return [];
    var s = gap > 0 ? 1 : -1;
    return rows.filter(function (r) { return num(r.a) && num(r.n) && s * (r.a - r.n) > 0; })
      .sort(function (p, q) { return s * ((q.a - q.n) - (p.a - p.n)); })
      .filter(function (r) { return s * (r.a - r.n) >= Math.abs(gap) * 0.15; }).slice(0, 2);
  }
  function monthsSentence(made, gap) {
    if (!made.length) return '';
    var part = made.reduce(function (t, r) { return t + Math.abs(r.a - r.n); }, 0) / Math.abs(gap);
    return (gap > 0 ? (part >= 0.5 ? 'Most of it came in ' : 'The biggest months were ') : (part >= 0.5 ? 'Most of the shortfall came in ' : 'The biggest short months were '))
      + made.map(function (r) { return r.full; }).join(' and ') + '.';
  }
  /* the gap in words: "10.3 inches ahead of normal", "332 GDUs behind normal", "right on normal" */
  function gapWords(gap, unit) {
    if (!num(gap)) return '';
    var d = unit === 'in' ? f1(Math.abs(gap), 1) : comma(Math.abs(gap));
    if (+d === 0) return 'right on normal';
    return d + (unit === 'in' ? ' inches' : ' GDUs') + (gap > 0 ? ' ahead of' : ' behind') + ' normal';
  }
  function insertAt(pts, x, y) {
    if (pts.some(function (p) { return Math.abs(p[0] - x) < 1e-9; })) return;
    pts.push([x, y]); pts.sort(function (a, b) { return a[0] - b[0]; });
  }
  function rainRun(c, yr, end) {
    if (!c || !Array.isArray(c.cum) || !c.cum.length || !num(c.total)) return null;
    var hasN = num(c.usual) && c.usual > 0 && c.cum.every(function (r) { return num(r[2]); });
    var T = [[0, 0]], N = hasN ? [[0, 0]] : null;
    c.cum.forEach(function (r) { T.push([r[0] + 1, r[1]]); if (N) N.push([r[0] + 1, r[2]]); });
    var lx = T[T.length - 1][0];
    if (num(c.days) && c.days > lx) { T.push([c.days, c.total]); if (N) N.push([c.days, c.usual]); lx = c.days; }
    var endM = end ? end.getUTCMonth() : 11, rows = [], A = 0, B = 0, okA = true, okB = hasN;
    (Array.isArray(c.months) ? c.months : []).slice(0, endM + 1).forEach(function (r, m) {
      var good = Array.isArray(r) && num(r[0]);
      rows.push({ m: m, lab: MON[m], full: MONTH_FULL[m], a: good ? r[0] : null, n: good && hasN && num(r[1]) ? r[1] : null, x0: xStart(yr, m), x1: Math.min(xStart(yr, m + 1), lx) });
    });
    rows.forEach(function (r) { if (num(r.a)) A += r.a; else okA = false; if (num(r.n)) B += r.n; else okB = false; });
    /* the months' own sums land on the line only when they add to the total */
    if (rows.length && okA && Math.abs(A - c.total) < 0.06) { var sa = 0; rows.forEach(function (r) { sa += r.a; if (r.x1 < lx) insertAt(T, r.x1, sa); }); } else rows = [];
    if (N && rows.length && okB && Math.abs(B - c.usual) < 0.06) { var sb = 0; rows.forEach(function (r) { sb += r.n; if (r.x1 < lx) insertAt(N, r.x1, sb); }); }
    var gap = hasN ? c.total - c.usual : null, made = madeMonths(rows, gap);
    return { T: T, N: N, total: c.total, usual: hasN ? c.usual : null, gap: gap, rows: rows, made: made, x0: 0, x1: lx,
      ticks: Array.apply(null, Array(endM + 1)).map(function (_, m) { return { a: xStart(yr, m), b: Math.min(xStart(yr, m + 1), lx), lab: MON[m] }; }) };
  }
  /* corn GDUs from May 1: the running total through each month end (the file holds months, not days). One withheld month
     is filled from the season total less the other months (the days that were reported); two or more are not drawn. */
  function gduRun(c, yr, end) {
    var g = c && Array.isArray(c.g) && num(c.g[0]) ? c.g : null;
    if (!g || !Array.isArray(c.gm) || c.gm.length < 5) return null;
    var endM = end ? end.getUTCMonth() : 10, normT = num(g[2]) && g[2] > 0 ? g[2] : null, rows = [], lx = end ? doy(end) + 1 : xStart(yr, endM + 1);
    c.gm.slice(4, endM + 1).forEach(function (r, i) {
      var m = 4 + i, good = Array.isArray(r) && num(r[0]);
      rows.push({ m: m, lab: MON[m], full: MONTH_FULL[m], a: good ? r[0] : null, n: good && num(r[1]) ? r[1] : null, gap: !good, x0: Math.max(xStart(yr, m), xStart(yr, 4)), x1: Math.min(xStart(yr, m + 1), lx) });
    });
    var gaps = rows.filter(function (r) { return r.gap; });
    if (!rows.length || gaps.length > 1) return { tooMany: gaps.length > 1 };
    var sumA = 0, sumN = 0, nOk = true;
    rows.forEach(function (r) { if (!r.gap) { sumA += r.a; if (num(r.n)) sumN += r.n; else nOk = false; } });
    if (gaps.length) {
      gaps[0].a = g[0] - sumA; gaps[0].filled = true;
      if (gaps[0].a < 0) return { tooMany: true };
      if (normT != null && nOk) gaps[0].n = normT - sumN; else nOk = false;
    }
    var hasN = normT != null && nOk && rows.every(function (r) { return num(r.n); });
    var A = 0, B = 0; rows.forEach(function (r) { A += r.a; if (hasN) B += r.n; });
    if (Math.abs(A - g[0]) > 2 || (hasN && Math.abs(B - normT) > 2)) return null;
    var x0 = xStart(yr, 4), T = [[x0, 0]], N = hasN ? [[x0, 0]] : null, a = 0, b = 0;
    rows.forEach(function (r) { a += r.a; T.push([r.x1, a]); if (N) { b += r.n; N.push([r.x1, b]); } });
    var gap = hasN ? g[0] - normT : null, fz = c.fr && Array.isArray(c.fr.f28) && num(c.fr.f28[0]) && c.fr.f28[0] >= 101 && c.fr.f28[0] <= 1231 ? new Date(Date.UTC(yr, Math.floor(c.fr.f28[0] / 100) - 1, c.fr.f28[0] % 100)) : null;
    return { T: T, N: N, total: g[0], usual: hasN ? normT : null, gap: gap, rows: rows, made: madeMonths(rows, gap), x0: x0, x1: lx,
      dotted: gaps.map(function (r) { return [r.x0, r.x1]; }), freeze: fz && end && fz <= end ? { x: doy(fz) + 1, text: 'First 28°F freeze, ' + MON[fz.getUTCMonth()] + ' ' + fz.getUTCDate() } : null,
      ticks: rows.map(function (r) { return { a: r.x0, b: r.x1, lab: r.lab }; }) };
  }
  if (typeof module === 'object' && module.exports) module.exports = { dayRows: dayRows, srcText: srcText, rainRun: rainRun, gduRun: gduRun, madeMonths: madeMonths, monthsSentence: monthsSentence, gapWords: gapWords, whenOf: whenOf };
  if (!doc || !doc.getElementById('hp-wxb')) return;

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
  /* state FIPS -> postal code, to find a nearest county across a state line in its own state's file */
  var FIPS_ST = { '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
    '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ',
    '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA',
    '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY' };
  function fcFail(t) { var m = $('hp-fc-msg'), a = doc.querySelector('.hp-a-fc'); if (m) { m.textContent = t; m.style.background = t ? 'var(--surface)' : ''; } if (a) a.classList.toggle('fcfail', !!t); }
  /* the old home's weather icons (index.html sprite), from the NWS words made into WMO-style codes (components/nws.js) */
  function wxIcon(code, day, cls) {
    var night = day === 0;   /* after dark: no sun on a cloudy or showery hour */
    var k = code == null ? (night ? 'i-cloud' : 'i-cloud-sun') : code <= 1 ? (night ? 'i-moon' : code === 0 ? 'i-sun' : 'i-cloud-sun') : code === 2 ? (night ? 'i-cloud' : 'i-cloud-sun') : code === 3 ? 'i-cloud' : code === 45 || code === 48 ? 'i-cloud-fog'
      : code >= 51 && code <= 57 ? (night ? 'i-cloud-rain' : 'i-cloud-sun-rain') : code >= 61 && code <= 67 ? 'i-cloud-rain' : code >= 71 && code <= 77 ? 'i-snowflake' : code >= 80 && code <= 82 ? (night ? 'i-cloud-rain' : 'i-cloud-sun-rain')
      : code === 85 || code === 86 ? 'i-snowflake' : code >= 95 ? 'i-cloud-lightning' : (night ? 'i-cloud' : 'i-cloud-sun');
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#' + k + '"/></svg>';
  }
  /* the sky in words: the function the "Today near me" block above prints with (index1.html sets root.AgSkyWords), so one hour has one wording */
  function skyWords(code, night) { return root.AgSkyWords ? root.AgSkyWords(code, !!night) : ''; }
  /* the old home's fuller forecast: now (icon, temperature, feels like, wind, humidity, dew point,
     chance of rain), the days with icons, highs, lows, chance of rain, rain amount and wind, and the next 24 hours behind a fold */
  function windText(w) {
    if (!w) return '';
    var s = Math.round(w.spd), g = num(w.gust) ? Math.round(w.gust) : null, d = compass(w.dir);
    return (s === 0 ? 'Calm' : (d ? d + ' ' : '') + s) + (g != null && g - s >= 5 ? ', gust ' + g : '');
  }
  function drawForecast(p, seq) {
    if (!root.AgNWS) { fcFail('The forecast did not load. Try again in a few minutes.'); return; }
    root.AgNWS.forecast(p.lat, p.lon, { days: 8 }).then(function (f) {
      if (seq !== band.seq) return;
      var c = f.current || {}, H = f.hourly || {}, r = function (v) { return num(v) ? Math.round(v) : null; };
      var nt = $('hp-now-t'); if (nt) nt.innerHTML = num(c.temperature_2m) ? Math.round(c.temperature_2m) + '<span class="dg">°</span>' : '--<span class="dg">°</span>';
      var ni = $('hp-now-i'); if (ni) ni.outerHTML = wxIcon(c.weather_code, c.is_day, 'hp-nowi').replace('<svg ', '<svg id="hp-now-i" ');
      /* the grid's forecast for the hour that holds now, not a reading */
      html('hp-now-d', '<b>' + esc(skyWords(c.weather_code, c.is_day === 0) || 'Forecast') + '</b><br>Forecast for this hour');
      txt('hp-nw-f', r(c.apparent_temperature) != null ? r(c.apparent_temperature) + '°' : '-');
      txt('hp-nw-w', num(c.wind_speed_10m) ? (Math.round(c.wind_speed_10m) === 0 ? 'Calm' : (compass(c.wind_direction_10m) + ' ' + Math.round(c.wind_speed_10m) + ' mph').trim()) : '-');
      txt('hp-nw-h', r(c.relative_humidity_2m) != null ? r(c.relative_humidity_2m) + '%' : '-');
      txt('hp-nw-d', r(c.dew_point_2m) != null ? r(c.dew_point_2m) + '°' : '-');
      txt('hp-nw-p', r(c.precipitation_probability) != null ? r(c.precipitation_probability) + '%' : '-');
      var snowSoon = (H.weather_code || []).slice(0, 24).some(snowCode);
      txt('hp-nw-pk', snowSoon ? 'Chance of rain or snow' : 'Chance of rain');
      /* each card's chance is the daytime one (see dayRows), so a night block is not counted on two days; its low is
         the night after its high, so the pair reads as one day and night; a day with no high is left out */
      var R = dayRows(f), lis = R.rows.map(function (d) {
        var dc = d.code, wind = windText(d.wind), words = skyWords(dc, d.tonight);
        return '<li' + (d.tonight ? ' class="tn"' : '') + '><b>' + d.label + '</b>' + wxIcon(dc, d.tonight ? 0 : 1)
          + '<span class="hi"><span class="visually-hidden">high </span>' + (num(d.hi) ? Math.round(d.hi) + '°' : '-') + '</span>'
          + '<span class="lo"><span class="visually-hidden">low that night </span>' + (num(d.lo) ? Math.round(d.lo) + '°' : '-') + '</span>'
          + '<span class="pp">' + (num(d.pp) ? Math.round(d.pp) + '%' + (d.word === 'snow' ? ' snow' : '') + '<span class="visually-hidden"> chance of ' + d.word + '</span>' : '-')
          + (num(d.amt) && d.amt >= 0.01 ? ' <span class="am">' + f1(d.amt, 2) + ' in</span>' : '') + '</span>'
          + '<span class="ex"><span class="wd">' + esc(words) + '</span><span class="wn">' + esc(wind) + '</span></span></li>';
      });
      var ol = $('hp-d7');
      if (lis.length) {
        html('hp-d7', lis.join(''));
        /* the list holds room for seven while the week loads; a six-day answer leaves no empty row behind */
        if (ol) ol.style.minHeight = lis.length < 7 ? '0' : '';
      }
      txt('hp-d7h-p', R.snow ? 'Rain, snow' : 'Rain');
      /* the next 24 hours from this hour */
      var ht = H.time || [], h0 = -1, now = String(c.time || '').slice(0, 13), cells = [];
      for (var k = 0; k < ht.length; k++) if (String(ht[k]).slice(0, 13) >= now) { h0 = k; break; }
      if (h0 >= 0) for (var j = h0; j < ht.length && cells.length < 24; j++) {
        var tt = (H.temperature_2m || [])[j], hp = (H.precipitation_probability || [])[j];
        cells.push('<div><b>' + (j === h0 ? 'Now' : hr12(ht[j])) + '</b>' + wxIcon((H.weather_code || [])[j], (H.is_day || [])[j]) + (num(tt) ? Math.round(tt) + '°' : '-') + '<span class="pp">' + (num(hp) ? Math.round(hp) + '%<span class="visually-hidden"> chance of rain or snow</span>' : '-') + '</span></div>');
      }
      var hr = $('hp-hourly'); if (hr) hr.hidden = !cells.length; if (cells.length) html('hp-hr', cells.join(''));
      var src = srcText(R).replace(/\.$/, '') + '. National Weather Service';
      try { var n = f._nws; if (n && n.updated) src += ', issued ' + new Date(n.updated).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: f.timezone || undefined, timeZoneName: 'short' }); } catch (e) {}
      txt('hp-fc-src', src + '.');
      fcFail(''); var m = $('hp-fc-msg'); if (m) m.style.background = '';
    }, function (e) {
      if (seq !== band.seq) return;
      fcFail(e && e.outside ? 'The National Weather Service has no forecast for this point.' : 'The National Weather Service forecast did not answer. Try again in a few minutes.');
    });
  }
  /* the live radar, as the old home had it (Windy's radar layer, the same embed
     components/geo.js built), centred on the reader's place; it loads only when the band comes near the screen
     (loadBand runs from later()), holds its room, and says so if it does not come in */
  /* at every width the map takes no touches or wheel turns until the button ("Tap" on a phone, "Click" with a pointer) is pressed, so a thumb or a wheel scrolling the page is not caught in it */
  /* after the press, focus goes to the map's box (not lost to the page); "Done" gives the page its scroll back */
  function liveTap() {
    var b = $('hp-livego'), d = $('hp-livedone'), box = $('hp-live'); if (!b || !box) return;
    b.addEventListener('click', function () { box.classList.add('on'); try { box.focus({ preventScroll: true }); } catch (e) { box.focus(); } });
    if (d) d.addEventListener('click', function () { box.classList.remove('on'); try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); } });
  }
  var liveSeq = 0;
  /* a frame's load event fires on a failed page too, so the host is probed first (a no-cors
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
        /* a ZIP table that did not download is "did not load, try again", not an unknown ZIP */
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
        /* the nearest gauge is across the state line: read it from that state's own file */
        var st2 = FIPS_ST[cf.cross.slice(0, 2)];
        if (!st2) return [R, null, wst];
        return getJSON(stateFile('rain/', st2)).then(function (R2) {
          var c2 = R2 && R2.counties && R2.counties[cf.cross];
          return c2 ? [R2, { fips: cf.fips, c: c2, near: cf.cross, nearName: c2.name + ', ' + st2 }, st2] : [R, null, wst];
        }, function () { return [R, null, wst]; });
      }).then(function (rr) {
        if (seq !== band.seq) return;
        var R = rr[0], cf = rr[1], wst = rr[2];
        drawRain(R, p, cf, wst);
        if (!cf) { msgIn('hp-gdu-ch', 'No temperature station on file for ' + countyName(p.county, p.state) + '.'); return; }
        getJSON(stateFile('rain/wx/', wst)).then(function (W) { if (seq === band.seq) drawGdu(W, p, cf.near || cf.fips, cf, wst); }, function () { msgIn('hp-gdu-ch', 'The GDU file did not load. Try again later.'); });
      }, function () { msgIn('hp-rain-ch', 'The rain file did not load. Try again later.'); msgIn('hp-gdu-ch', 'The GDU file did not load. Try again later.'); });
    });
  }

  function ga(n, p) { try { p = p || {}; p.page = 'home'; if (typeof root.gtag === 'function') root.gtag('event', n, p); } catch (e) {} }
  /* a message in a chart box: the old bars go, the box's tools go with them */
  function msgIn(id, t) {
    var b = $(id); if (!b) return; var m = b.querySelector('.hp-msg'); if (m) m.textContent = t || '';
    b.classList.toggle('empty', !!t); if (b.parentNode) b.parentNode.classList.toggle('nochart', !!t);
    if (t) {
      var x = b.querySelector('.hp-bx'); if (x) x.innerHTML = ''; var tl = b.parentNode && b.parentNode.querySelector('.hp-tools'); if (tl) tl.innerHTML = '';
      var sr = b.parentNode && b.parentNode.querySelector('.hp-src'); if (sr) sr.textContent = '';   /* no chart, so no method or source line under it */
    }
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

  /* the station line, one form on both charts: "Station: town, ST, 4 mi NE." (the file words it "4 miles northeast of Town" or "Town, 2.7 mi NE") */
  var DIRS = { north: 'N', south: 'S', east: 'E', west: 'W', northeast: 'NE', northwest: 'NW', southeast: 'SE', southwest: 'SW' };
  function stationText(name, st) {
    name = String(name || '').trim().replace(/^at\s+/i, ''); if (!name) return '';
    var m = /^([\d.]+) miles? ([a-z-]+) of (.+)$/i.exec(name), t, d;
    if (m && (d = m[2].toLowerCase().split('-').map(function (w) { return DIRS[w]; })).every(Boolean)) t = m[3] + ', ' + st + ', ' + m[1] + ' mi ' + d.join('');
    else if ((m = /^(.*), ([\d.]+ mi [NSEW]{1,3})$/.exec(name))) t = m[1] + ', ' + st + ', ' + m[2];
    else t = name + ', ' + st;
    return 'Station: ' + t + '. ';
  }
  /* the marks' words on the line: "Aug: 13.3 in, normal 4.1" */
  function markText(r, fmt, unit) { return r.lab + ': ' + fmt(r.a) + unit + ', normal ' + fmt(r.n); }
  function mountRunChart(boxId, run, o) {
    var box = $(boxId), x = box && box.querySelector('.hp-bx'), tl = box && box.parentNode.querySelector('.hp-tools');
    if (!x || !root.AgChart || !root.AgChart.mountRun) { msgIn(boxId, 'The chart did not load. Try again in a few minutes.'); return; }
    var m = box.querySelector('.hp-msg'); if (m) m.textContent = '';
    box.classList.remove('empty'); box.parentNode.classList.remove('nochart');
    if (tl) tl.innerHTML = '';
    var yr = o.yr, iso = o.end ? o.end.toISOString().slice(0, 10) : ctDay().toISOString().slice(0, 10);
    var gw = run.N ? gapWords(run.gap, o.unit) : '';
    root.AgChart.mountRun(x, { this: run.T, norm: run.N, dotted: run.dotted, x0: run.x0, x1: run.x1, ticks: run.ticks, freeze: run.freeze,
      marks: run.made.map(function (r) { return { a: r.x0, b: r.x1, text: markText(r, o.fmt, o.unit === 'in' ? ' in' : '') }; }),
      fmt: o.axis, topUnit: o.topUnit, vfmt: function (v) { return o.fmt(v) + (o.unit === 'in' ? ' in' : ' GDUs'); }, steps: o.steps, names: { a: String(yr), n: 'Normal' }, gapWords: gw, label: o.label,
      read: function (xx, a, n) { return whenOf(yr, xx) + ': ' + o.fmt(a) + (o.unit === 'in' ? ' in' : ' GDUs') + ' so far' + (n != null ? '; normal ' + o.fmt(n) + (o.unit === 'in' ? ' in' : ' GDUs') + '; ' + gapWords(a - n, o.unit) : ''); },
      height: { phone: 250, wide: 250 }, tools: tl,
      story: function () { return { head: o.cardHead, take: o.sub, summary: o.label }; },
      share: { url: 'https://agsist.com/?utm_source=share&utm_medium=picture&utm_campaign=home-' + o.file, title: o.cardHead, file: 'agsist-' + o.file + '-' + iso + '.png', kicker: o.kicker, source: o.source, date: iso } });
  }
  function townOf(p) { return p.town || countyName(p.county, p.state); }
  function drawRain(R, p, cf, wst) {
    var c = cf && cf.c;
    var yr = R.year || (c && utc(c.as_of) || ctDay()).getUTCFullYear(), end = c && utc(c.as_of || R.edate), run = rainRun(c, yr, end);
    if (!run) { msgIn('hp-rain-ch', 'No rain record for this county yet.'); txt('hp-rain-h', 'Rain this year'); txt('hp-rain-lead', ''); return; }
    var miss = num(c.missing) && c.missing > 0 ? c.missing : 0, missText = miss ? miss + ' day' + (miss === 1 ? '' : 's') + ' not reported' : '';
    var place = (cf.near ? 'Near ' : '') + countyName(p.county, p.state) + ', ' + p.state, when = end ? ' to ' + md(end) : '';
    var hasN = run.N != null, gw = hasN ? gapWords(run.gap, 'in') : '';
    txt('hp-rain-h', hasN ? (run.gap === 0 || +f1(Math.abs(run.gap)) === 0 ? townOf(p) + ' is right on normal for rain this year' : townOf(p) + ' is ' + f1(Math.abs(run.gap)) + ' inches of rain ' + (run.gap > 0 ? 'ahead of' : 'behind') + ' normal this year') : 'Rain this year in ' + townOf(p) + ': ' + f1(c.total) + ' in' + when);
    /* the file's own percent, never one worked out here: the builder withholds it on a normal under 1.00 in */
    var pct = hasN && num(c.pct) ? c.pct : null, sent = monthsSentence(run.made, run.gap);
    txt('hp-rain-lead', hasN ? (num(pct) ? pct + '% of normal. ' : '') + sent + (sent || num(pct) ? '' : 'Normal for the same days is ' + f1(c.usual, 1) + ' in.') : 'No normal on file for this gauge.');
    var st = c.station || {}, net = st.net === 'cocorahs' ? ' (CoCoRaHS)' : st.net ? ' (NOAA co-op)' : '', gauge = stationText(st.name, wst || p.state).replace(/\. $/, net + '. ').replace(/^Station:/, 'Gauge:');
    var borrowed = cf.near ? 'No station in ' + countyName(p.county, p.state) + '; nearest county: ' + cf.nearName + '. ' : '';
    var onDays = miss ? ' for the days reported' : '', normNote = hasN ? 'Normal: the 1991 to 2020 average' + onDays + '; the years behind it are not on file here. ' : '';
    var label = 'Running total of rain this year, Jan 1' + when + ': ' + f1(c.total) + ' inches' + (hasN ? ' against a normal of ' + f1(c.usual) + ', ' + gw + '.' : '; no normal on file for this gauge.') + (sent ? ' ' + sent : '');
    mountRunChart('hp-rain-ch', run, { yr: yr, unit: 'in', end: end, file: 'rain', steps: [0.5, 1, 2, 5, 10], axis: function (v) { return String(v); }, topUnit: ' in', fmt: function (v) { return f1(v, 1); }, label: label,
      cardHead: place + ': ' + (hasN ? 'rain is ' + gw + ' this year, ' + f1(c.total) + ' in against ' + f1(c.usual) + ' in' : 'rain this year ' + f1(c.total) + ' in') + when + (missText ? '; ' + missText : ''),
      sub: 'Running total since Jan 1: ' + yr + ' (dark)' + (hasN ? ', normal 1991 to 2020 (grey)' : ', no normal on file') + (run.made.length ? ', months that made the year (gold)' : ''),
      kicker: cf.near ? 'Rain near ' + countyName(p.county, p.state) + ', ' + p.state : 'Rain, ' + countyName(p.county, p.state) + ', ' + p.state,
      source: borrowed + gauge + 'NOAA daily records via RCC-ACIS, Jan 1' + when + '.' });
    txt('hp-rain-src', 'Jan 1' + when + '. ' + (missText ? missText[0].toUpperCase() + missText.slice(1) + '. ' : '') + normNote + borrowed + gauge + 'NOAA daily records via RCC-ACIS.');
  }
  /* Corn GDUs since May 1. The headline is the file's season figure "g" ([total, days missing, normal over the same
     reported days, years, pct]); the line runs through the monthly totals "gm" ([total, normal or null, days
     reported, days so far]; null when the month is withheld). The end date is the county's own (c.a). */
  function drawGdu(W, p, fips, cf, wst) {
    var borrowed = cf && cf.near ? 'No station in ' + countyName(p.county, p.state) + '; nearest county: ' + cf.nearName + '. ' : '';
    var c = W && W.counties && W.counties[fips], yr = (W && W.year) || ctDay().getUTCFullYear();
    var today = ctDay(), early = today < new Date(Date.UTC(today.getUTCFullYear(), 4, 15));
    var end = c && (mmddDate(c.a, yr) || utc(W.edate)), run = gduRun(c, yr, end);
    if (!run || run.tooMany) {
      msgIn('hp-gdu-ch', run && run.tooMany ? 'Too many months have too few days reported at this station to draw the season.' : early && (!c || !Array.isArray(c.gm) || c.gm.length < 5) ? 'The corn GDU season starts May 1.' : c ? 'Not enough days reported at this station to count GDUs.' : 'No temperature station on file for ' + countyName(p.county, p.state) + (cf && cf.near ? ' or the nearest county.' : '.'));
      txt('hp-gdu-lead', ''); return;
    }
    var g = c.g, gmiss = num(g[1]) && g[1] > 0 ? g[1] : 0, gmissText = gmiss ? gmiss + ' day' + (gmiss === 1 ? '' : 's') + ' not reported' : '';
    var hasN = run.N != null, gw = hasN ? gapWords(run.gap, 'gdu') : '', place = (cf && cf.near ? 'Near ' : '') + countyName(p.county, p.state) + ', ' + p.state, when = end ? ' to ' + md(end) : '';
    txt('hp-gdu-h', hasN ? (gw === 'right on normal' ? townOf(p) + ' is right on normal for corn GDUs this year' : townOf(p) + ' is ' + gw.replace(' GDUs', ' corn GDUs') + ' this year') : 'Corn GDUs since May 1 in ' + townOf(p) + ': ' + comma(g[0]));
    /* the file's own percent, never one worked out here: it is withheld on a small normal or missing days */
    var gp = hasN && num(g[4]) && run.usual >= 100 ? g[4] : null, sent = monthsSentence(run.made, run.gap);
    txt('hp-gdu-lead', hasN ? (num(gp) ? gp + '% of normal. ' : '') + sent : 'No normal on file for this station.');
    var s = c.s && c.s[0] ? stationText(c.s[0], wst || p.state) : 'Station name not on file. ';
    var gaps = run.rows.filter(function (r) { return r.gap; }), fz = run.freeze;
    var tail = (gaps.length ? ' ' + gaps[0].lab + ' is drawn dotted: too few days reported, so its figure is the season total less the other months.' : '')
      + (fz ? ' ' + fz.text.replace('First 28°F freeze, ', 'First 28°F freeze: ') + '; the count runs past it.' : '');
    var label = 'Running total of corn growing degree units since May 1, ' + yr + when + ': ' + comma(g[0]) + (hasN ? ' against a normal of ' + comma(run.usual) + ', ' + gw + '.' : '; no 1991 to 2020 normal on file for this station.') + (sent ? ' ' + sent : '');
    mountRunChart('hp-gdu-ch', run, { yr: yr, unit: 'gdu', end: end, file: 'gdu', steps: [100, 200, 250, 500, 1000], axis: function (v) { return comma(v); }, topUnit: ' GDUs', fmt: comma, label: label,
      cardHead: place + ': ' + (hasN ? 'corn GDUs are ' + gw.replace(' GDUs', '') + ' this year, ' + comma(g[0]) + ' against ' + comma(run.usual) : comma(g[0]) + ' corn GDUs since May 1') + (gmissText ? '; ' + gmissText : ''),
      sub: 'Running total since May 1: ' + yr + ' (dark)' + (hasN ? ', normal 1991 to 2020 (grey)' : ', no normal on file') + (run.made.length ? ', months that made it (gold)' : ''),
      kicker: cf && cf.near ? 'Corn GDUs near ' + countyName(p.county, p.state) + ', ' + p.state : 'Corn GDUs, ' + countyName(p.county, p.state) + ', ' + p.state,
      source: borrowed + s + (fz ? fz.text.replace('First 28°F freeze, ', 'First 28°F freeze ') + '; the count runs past it. ' : '') + 'NOAA daily records via RCC-ACIS, May 1' + when + ', by month.' });
    txt('hp-gdu-src', 'Counted May 1' + when + ', 86/50 method, month by month.' + (gmissText && !gaps.length ? ' ' + gmissText[0].toUpperCase() + gmissText.slice(1) + '.' : '') + tail + (hasN ? ' Normal: the 1991 to 2020 average' + (gmiss ? ' for the days reported' : '') + '; the years behind it are not on file here.' : '') + ' ' + borrowed + s + 'NOAA daily records via RCC-ACIS.');
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
