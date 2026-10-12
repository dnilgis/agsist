/* components/rain-print.js: Rain Print by AGSIST (/rain-print), 2026-10-11.
 *
 * A place and a finished year become a print: every day's precipitation at
 * the nearest NOAA weather station with a usable record, drawn as Staircase
 * (the running total across the year) or Waveform (one tick per day).
 * Ported from Sig's standalone Rain Print Studio (the October last-pass
 * version, with its QR, marker, callout and dry-spell fixes); the art is his design.
 *
 * WHERE THE NUMBERS COME FROM (nothing here is invented or filled in)
 *   place     Open-Meteo geocoding (geocoding-api.open-meteo.com)
 *   stations  RCC-ACIS StnMeta, stations within about 0.6 degrees whose
 *             precipitation record spans the whole year
 *   days      RCC-ACIS StnData pcpn + avgt for that station and year
 *   scale     the station's full period of record (same scale every year)
 *   compare   ACIS's own NOAA 30-year normal (normal:1; which 30 years ACIS
 *             serves was not verified with a live request, so no label names
 *             the period), or the station's own full-record daily average,
 *             labeled with its years
 *   A station with more than MISS_BLOCK unrecorded days in the year gets no
 *   print: the page says so and offers the other stations. Fewer missing days
 *   are printed as a count on the art itself.
 *
 * THE DESIGN IS THE URL. Every choice (place, station, year, layout, palette,
 * size, comparison, name, up to three dates) round-trips through the query
 * string, and through a short design code (?d=...) that the QR maker's mark,
 * Stripe's client_reference_id and the order form all carry. Open
 * /rain-print?d=<code> and the same print draws again.
 *
 * DOWNLOADS. The public button gives a watermarked preview PNG. /rain-print?maker=1
 * shows Sig's clean 300 dpi print files (12x18 in, 0.125 in bleed, so 12.25 x 18.25 in
 * and fits the 13 x 19 sheets his Epson takes),
 * a PDF of the same and the SVG. That switch is a convenience, not security:
 * the art is drawn in the reader's browser and anyone can save it.
 *
 * THIS YEAR, AS A GIFT (2026-10-11). The year list starts with the current
 * year (America/Chicago), offered as a gift delivered in January. It draws a
 * PREVIEW from Jan 1 through the station's last recorded day, laid out on the
 * whole calendar, with a band across the art and a line on the page saying so;
 * a comparison covers the same days. Under GIFT_MIN_DAYS recorded days there
 * is no art, only a plain message, and ordering stays open. A gift order's
 * code is GIFT- plus the design code (Stripe's client_reference_id and the
 * order form carry it); the QR and shared links carry the plain code. A
 * one-page gift card prints from #rp-giftcard (print stylesheet in the page).
 *
 * PRODUCTS (2026-10-11): digital file, 12 x 18 print, 12 x 18 framed; Sig
 * prints, frames and ships them. 18 x 24 is gone; an old code with its size
 * letter still opens as 12 x 18. The maker's seal is square to the page.
 *
 * The pure parts (design code, query string) run without a document, for
 * test/rain-print.test.mjs.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- pure parts
  var LAYOUT = { staircase: 's', waveform: 'w' };
  var PALETTE = { paper: 'p', night: 'n', blueprint: 'b' };
  var CMP = { none: '0', normal: 'n', station: 's' };
  var SIZE = { '12x18': 'a' };   // one print size since 2026-10-11 (18 x 24 was dropped)
  var LIMITS = { place: 32, name: 24, label: 13, markers: 3 };  // at these caps the QR link still fits (qr.js: version 10, level M)
  var SITE = 'https://agsist.com/rain-print';

  function inv(o) { var r = {}; Object.keys(o).forEach(function (k) { r[o[k]] = k; }); return r; }
  var LAYOUT_R = inv(LAYOUT), PALETTE_R = inv(PALETTE), CMP_R = inv(CMP), SIZE_R = inv(SIZE);
  SIZE_R.b = '12x18';  // a code made while 18 x 24 was offered still opens, as the 12 x 18 shape (same art)

  function cleanText(s, n) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n).trim();
  }
  function cleanSid(s) { return String(s == null ? '' : s).replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 16); }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function dayIndex(year, iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m || +m[1] !== year) return -1;
    var t = Date.UTC(year, +m[2] - 1, +m[3]);
    var d = new Date(t);
    if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return -1;
    return Math.round((t - Date.UTC(year, 0, 1)) / 86400000);
  }
  function isoFromDay(year, doy) {
    if (!(doy >= 0) || doy >= (isLeap(year) ? 366 : 365)) return '';
    return new Date(Date.UTC(year, 0, 1) + doy * 86400000).toISOString().slice(0, 10);
  }

  function defaults() {
    return { place: '', station: '', year: null, layout: 'staircase', palette: 'paper', size: '12x18', cmp: 'none', name: '', markers: [], gift: false };
  }
  /* Whatever came in (URL, code, form), out comes a design with only allowed values. */
  function normalize(x) {
    var s = defaults();
    x = x || {};
    s.place = cleanText(x.place, LIMITS.place);
    s.station = cleanSid(x.station);
    var y = parseInt(x.year, 10);
    s.year = y >= 1850 && y <= 2200 ? y : null;
    if (LAYOUT[x.layout]) s.layout = x.layout;
    if (PALETTE[x.palette]) s.palette = x.palette;
    if (CMP[x.cmp]) s.cmp = x.cmp;
    if (SIZE[x.size]) s.size = x.size;
    s.name = cleanText(x.name, LIMITS.name);
    (Array.isArray(x.markers) ? x.markers : []).forEach(function (m) {
      if (s.markers.length >= LIMITS.markers || !m || !s.year) return;
      if (dayIndex(s.year, m.date) < 0) return;
      s.markers.push({ date: m.date, label: cleanText(m.label, LIMITS.label) });
    });
    s.gift = x.gift === true || x.gift === '1' || x.gift === 1;
    return s;
  }

  /* Today's date in Chetek (America/Chicago), as YYYY-MM-DD. The year a reader
     may order as a gift is this date's year, so it never needs a code change. */
  function chicagoToday(now) {
    now = now || new Date();
    try {
      var p = {};
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(now).forEach(function (x) { p[x.type] = x.value; });
      if (p.year && p.month && p.day) return p.year + '-' + p.month + '-' + p.day;
    } catch (e) {}
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }
  /* 'done': a finished year, drawn whole. 'gift': this year, drawn as a preview
     of the days recorded so far and ordered for delivery in January. 'future':
     nothing to draw. */
  function yearMode(year, todayIso) {
    var cy = parseInt(String(todayIso || chicagoToday()).slice(0, 4), 10);
    if (!year) return '';
    return year < cy ? 'done' : year === cy ? 'gift' : 'future';
  }
  /* The Christmas line on a product, from its cutoff date in data/rain-print.json.
     October 1 through the cutoff: "Order by Dec 12 for Christmas delivery."
     After it, through Dec 25: new orders ship after Christmas. Otherwise nothing.
     A plain date, never a countdown. */
  function cutoffNote(todayIso, cutoffIso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(cutoffIso || ''));
    if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(String(todayIso || ''))) return '';
    if (todayIso < m[1] + '-10-01' || todayIso > m[1] + '-12-25') return '';
    if (todayIso <= cutoffIso) return 'Order by ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + (+m[3]) + ' for Christmas delivery.';
    return 'Orders placed now ship after Christmas.';
  }
  /* Index of the last day that has a recorded value (v not null), or -1. A
     preview ends there: the days after it are not in yet, not dry. */
  function lastRecorded(days) {
    for (var i = (days || []).length - 1; i >= 0; i--) if (days[i] && days[i].v !== null && days[i].v !== undefined) return i;
    return -1;
  }

  function utf8b64url(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlUtf8(code) {
    var b = String(code).replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    var bin = atob(b), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  /* Design code v1: base64url of "1|place|station|year|LPCS|name|day|label|day|label|day|label"
     (L P C S = one letter each for layout, palette, comparison, size; day = day of
     the year in base 36). Only the characters A-Z a-z 0-9 - _ so Stripe takes it
     as a client_reference_id (200 at most).
     A gift order (this year, delivered in January) is the same code with GIFT-
     in front, so Sig sees it in Stripe without decoding anything. A v1 code
     always starts with M (base64 of "1|"), so the prefix cannot be mistaken
     for part of a code. */
  var GIFT_PREFIX = 'GIFT-';
  function encodeCode(x) {
    var s = normalize(x);
    if (!s.place || !s.year) return '';
    var f = ['1', s.place, s.station, String(s.year), LAYOUT[s.layout] + PALETTE[s.palette] + CMP[s.cmp] + SIZE[s.size], s.name];
    s.markers.forEach(function (m) { f.push(dayIndex(s.year, m.date).toString(36), m.label); });
    while (f.length > 6 && f[f.length - 1] === '' && f[f.length - 2] === '') f.length -= 2;
    return (s.gift ? GIFT_PREFIX : '') + utf8b64url(f.join('|'));
  }
  function decodeCode(code) {
    code = String(code || '');
    var gift = code.indexOf(GIFT_PREFIX) === 0;
    if (gift) code = code.slice(GIFT_PREFIX.length);
    if (!/^[A-Za-z0-9_-]{8,400}$/.test(code)) return null;
    var raw;
    try { raw = b64urlUtf8(code); } catch (e) { return null; }
    var f = raw.split('|');
    if (f[0] !== '1' || f.length < 6 || (f.length - 6) % 2) return null;
    var k = f[4] || '';
    if (k.length !== 4 || !LAYOUT_R[k[0]] || !PALETTE_R[k[1]] || !CMP_R[k[2]] || !SIZE_R[k[3]]) return null;
    var year = parseInt(f[3], 10);
    if (!(year >= 1850 && year <= 2200) || String(year) !== f[3]) return null;
    var markers = [];
    for (var i = 6; i + 1 < f.length; i += 2) {
      var doy = parseInt(f[i], 36);
      var iso = isoFromDay(year, doy);
      if (!iso) return null;
      markers.push({ date: iso, label: f[i + 1] });
    }
    var s = normalize({ place: f[1], station: f[2], year: year, layout: LAYOUT_R[k[0]], palette: PALETTE_R[k[1]],
      cmp: CMP_R[k[2]], size: SIZE_R[k[3]], name: f[5], markers: markers, gift: gift });
    return s.place ? s : null;
  }

  function toParams(x) {
    var s = normalize(x), q = new URLSearchParams();
    if (s.place) q.set('place', s.place);
    if (s.year) q.set('year', String(s.year));
    if (s.station) q.set('station', s.station);
    q.set('layout', s.layout);
    q.set('palette', s.palette);
    q.set('size', s.size);
    if (s.cmp !== 'none') q.set('cmp', s.cmp);
    if (s.name) q.set('name', s.name);
    s.markers.forEach(function (m, i) { q.set('m' + (i + 1), m.date + (m.label ? ' ' + m.label : '')); });
    if (s.gift) q.set('gift', '1');
    return q.toString();
  }
  function fromParams(search) {
    var q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    if (q.get('d')) { var c = decodeCode(q.get('d')); if (c) return c; }
    var markers = [];
    for (var i = 1; i <= LIMITS.markers; i++) {
      var v = q.get('m' + i);
      if (v) markers.push({ date: v.slice(0, 10), label: v.slice(10).trim() });
    }
    return normalize({ place: q.get('place'), station: q.get('station'), year: q.get('year'), layout: q.get('layout'),
      palette: q.get('palette'), size: q.get('size'), cmp: q.get('cmp'), name: q.get('name'), markers: markers, gift: q.get('gift') });
  }
  function designUrl(x) { return SITE + '?' + toParams(x); }
  function shortUrl(x) { var c = encodeCode(x); return c ? SITE + '?d=' + c : SITE; }

  var api = { encodeCode: encodeCode, decodeCode: decodeCode, toParams: toParams, fromParams: fromParams,
    designUrl: designUrl, shortUrl: shortUrl, normalize: normalize, defaults: defaults, dayIndex: dayIndex, LIMITS: LIMITS,
    chicagoToday: chicagoToday, yearMode: yearMode, lastRecorded: lastRecorded, cutoffNote: cutoffNote, GIFT_PREFIX: GIFT_PREFIX };
  root.RainPrint = api;
  if (!root.document || !root.document.getElementById('rp-form')) return;

  // ---------------------------------------------------------------- the page
  var doc = root.document;
  var $ = function (id) { return doc.getElementById(id); };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var PAL = {
    paper:     {bg:'#F7F6F1', ink:'#1B2430', mute:'#73798A', rain:'#2E5C86', rule:'#DCDFD8', fill:'rgba(46,92,134,.18)', dryFill:'rgba(179,74,46,.14)', temp:'#B34A2E', grain:true},
    night:     {bg:'#0E1216', ink:'#ECEDE8', mute:'#8892A0', rain:'#A9CDEC', rule:'#252C34', fill:'rgba(155,193,230,.22)', dryFill:'rgba(224,149,107,.16)', temp:'#E0956B', grain:false},
    blueprint: {bg:'#1E3F73', ink:'#EEF3FA', mute:'#B0C1DC', rain:'#FFFFFF', rule:'#31548C', fill:'rgba(255,255,255,.20)', dryFill:'rgba(255,217,160,.16)', temp:'#FFD9A0', grain:false}
  };
  /* Print sizes, landscape: trim width and height in inches. Art is 1400 units wide. */
  var PRINT = { '12x18': { w: 18, h: 12, label: '12 x 18 in' } };
  var ART_W = 1400, BLEED_IN = 0.125, DPI = 300;
  var MISS_OK = 10;      // auto station pick: first of the nearest three with at most this many unrecorded days
  var MISS_BLOCK = 31;   // more than a month unrecorded: no print, the page says why
  var TODAY = chicagoToday();                     // YYYY-MM-DD in Chetek's time zone
  var CURRENT_YEAR = parseInt(TODAY.slice(0, 4), 10);
  var GIFT_MIN_DAYS = 60;  // a gift preview needs the year recorded at least this far (to about March 1); less is too thin to draw fairly
  var STALE_DAYS = 30;     // this year: a station whose record stopped longer ago than this is not reporting, so it cannot make the print
  var MAKER = /(?:^|[?&])maker=1(?:&|$)/.test(root.location.search);
  var CHOICE = { digital: 'Digital file', print12x18: '12 x 18 print', framed12x18: '12 x 18 framed print' };
  var PRODUCTS = ['digital', 'print12x18', 'framed12x18'];
  var ORDER_TO = 'sig@farmers1st.com';

  var ST = fromParams(root.location.search);
  var DATA = null, META = null, EXT = null, NORM30 = null, STATIONS = [], PRICES = null, BLOCKED = '';
  /* This year only. PREVIEW: {last: ISO date of the last recorded day, yearLen}
     while a year-to-date preview is drawn. NOART: the plain message shown
     instead of art when the year so far is too thin to draw; ordering stays open. */
  var PREVIEW = null, NOART = '';
  /* SAMPLE (2026-10-11): with no design in the URL the page draws Chetek, WI
     for the last finished year, through the same geocode and ACIS calls a
     reader's own town takes, so the box is never empty. A sample cannot be
     ordered: the buy buttons stay off, nothing goes into the URL or the order
     form, and the town field stays empty, until the reader draws their own
     place or clicks "Use this design". Any failure puts the empty box back. */
  var SAMPLE = null;
  var EXT_CACHE = new Map(), NORM_CACHE = new Map(), DAILY_CACHE = new Map();

  function ga(n, p) { try { if (root.gaEvent) root.gaEvent(n, p); else if (root.gtag) root.gtag('event', n, p); } catch (e) {} }
  var f2 = function (x) { return x.toFixed(2); };
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

  // ---------- color helpers for the seasonal bar tint (Sig's) ----------
  function hex2hsl(hex) {
    var r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) { var d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0); else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; }
    return [h * 360, s, l];
  }
  function hsl2hex(h, s, l) {
    h /= 360; var r, g, b;
    if (s === 0) { r = g = b = l; } else {
      var hue2rgb = function (p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
    }
    var to255 = function (v) { return Math.round(v * 255).toString(16).padStart(2, '0'); };
    return '#' + to255(r) + to255(g) + to255(b);
  }
  // richer in the wet middle of the year, lighter toward the edges (+-7% lightness, hue untouched)
  function seasonalColor(base, monthIdx) {
    var hsl = hex2hsl(base);
    var phase = Math.cos((monthIdx - 6.2) / 12 * 2 * Math.PI);
    return hsl2hex(hsl[0], hsl[1], Math.min(0.92, Math.max(0.08, hsl[2] - phase * 0.07)));
  }

  // ---------- data ----------
  var STATE = {wi:'wisconsin',mn:'minnesota',ia:'iowa',il:'illinois',mi:'michigan',nd:'north dakota',sd:'south dakota',ne:'nebraska',ks:'kansas',mo:'missouri',in:'indiana',oh:'ohio',ky:'kentucky',tn:'tennessee',tx:'texas',ok:'oklahoma',co:'colorado',mt:'montana',wy:'wyoming',id:'idaho',wa:'washington',or:'oregon',ca:'california',nv:'nevada',ut:'utah',az:'arizona',nm:'new mexico',ar:'arkansas',la:'louisiana',ms:'mississippi',al:'alabama',ga:'georgia',fl:'florida',sc:'south carolina',nc:'north carolina',va:'virginia',wv:'west virginia',pa:'pennsylvania',ny:'new york',nj:'new jersey',ct:'connecticut',ri:'rhode island',ma:'massachusetts',vt:'vermont',nh:'new hampshire',me:'maine',md:'maryland',de:'delaware',ak:'alaska',hi:'hawaii',dc:'district of columbia',pr:'puerto rico'};
  function abbrFor(full) { for (var k in STATE) if (STATE[k] === full) return k.toUpperCase(); return null; }
  function toTitle(s) { return String(s).split(' ').map(function (w) { return /\d/.test(w) ? w : (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w); }).join(' '); }
  function miles(km) { return km * 0.621371; }

  function safeFetch(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('The weather data service is not answering right now (code ' + r.status + '). Try again in a minute.');
      return r;
    }, function () { throw new Error('Could not reach the weather data service. Check your connection and try again.'); });
  }
  function geocode(q) {
    var u = 'https://geocoding-api.open-meteo.com/v1/search?count=5&countryCode=US&name=' + encodeURIComponent(q.replace(/,.*$/, '').trim());
    return safeFetch(u).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.results || !j.results.length) throw new Error('No US place found for "' + q + '". Try a town name and state, like Chetek, WI.');
      var st = (q.split(',')[1] || '').trim().toLowerCase();
      return st ? (j.results.find(function (x) { var a = (x.admin1 || '').toLowerCase(); return a === STATE[st] || a === st; }) || j.results[0]) : j.results[0];
    });
  }
  function haversine(a, b, c, d) { var R = 6371, t = function (x) { return x * Math.PI / 180; }, h = Math.pow(Math.sin(t(c - a) / 2), 2) + Math.cos(t(a)) * Math.cos(t(c)) * Math.pow(Math.sin(t(d - b) / 2), 2); return 2 * R * Math.asin(Math.sqrt(h)); }
  function isoMinusDays(iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10); }
  function lastDayOf(year) { return year === CURRENT_YEAR ? TODAY : year + '-12-31'; }
  function stations(lat, lon, year) {
    var d = 0.6;
    var u = 'https://data.rcc-acis.org/StnMeta?' + new URLSearchParams({
      bbox: [lon - d, lat - d, lon + d, lat + d].map(function (x) { return x.toFixed(3); }).join(','),
      elems: 'pcpn', sdate: year + '-01-01', edate: lastDayOf(year), meta: 'name,sids,ll,valid_daterange,state'
    });
    // This year: the record must reach back to Jan 1 and still be current.
    var y0 = year + '-01-01', y1 = year === CURRENT_YEAR ? isoMinusDays(TODAY, STALE_DAYS) : year + '-12-31';
    return safeFetch(u).then(function (r) { return r.json(); }).then(function (j) {
      return (j.meta || []).filter(function (m) { return m.ll && m.sids && m.sids[0] && m.valid_daterange && m.valid_daterange[0] && m.valid_daterange[0][0] <= y0 && m.valid_daterange[0][1] >= y1; })
        .map(function (m) { return Object.assign({}, m, { sid: cleanSid(m.sids[0]), km: haversine(lat, lon, m.ll[1], m.ll[0]) }); })
        .sort(function (a, b) { return a.km - b.km; });
    });
  }
  function parsePcpn(raw) {
    var s = String(raw).trim();
    if (s === 'M') return { v: null, flag: 'M' };
    if (s === 'T') return { v: 0, flag: 'T' };
    if (s === 'S') return { v: 0, flag: 'S' };
    var v = parseFloat(s);
    if (isNaN(v)) return { v: null, flag: 'M' };
    return { v: v, flag: /A$/.test(s) ? 'A' : '' };
  }
  function parseTemp(raw) { var s = String(raw).trim(); if (s === 'M' || s === '') return null; var v = parseFloat(s); return isNaN(v) ? null : v; }
  // pcpn and avgt (daily mean temperature, F) come back as parallel columns from one call
  function daily(sid, year) {
    var key = sid + '|' + year;
    if (DAILY_CACHE.has(key)) return Promise.resolve(DAILY_CACHE.get(key));
    var u = 'https://data.rcc-acis.org/StnData?' + new URLSearchParams({ sid: sid, sdate: year + '-01-01', edate: lastDayOf(year), elems: 'pcpn,avgt', meta: 'name,state,ll' });
    return safeFetch(u).then(function (r) { return r.json(); }).then(function (j) {
      if (j.error || !Array.isArray(j.data)) throw new Error('The weather service has no usable data for that station and year. Try another station from the list.');
      var days = [];
      j.data.forEach(function (row) {
        var p = parsePcpn(row[1]), t = row[2] !== undefined ? parseTemp(row[2]) : null;
        var dt = new Date(row[0] + 'T00:00:00');
        days.push({ date: row[0], v: p.v, flag: p.flag, t: t, m: dt.getMonth(), d: dt.getDate(), doy: days.length });
      });
      // This year: stop at the last recorded day. The days after it have not
      // come in yet (NOAA's daily numbers lag a few days); they are not gaps.
      if (year === CURRENT_YEAR) days = days.slice(0, lastRecorded(days) + 1);
      var out = { meta: j.meta || {}, days: days, d: derive(days) };
      DAILY_CACHE.set(key, out);
      return out;
    });
  }
  // Full period-of-record daily totals: fixes the print scale so every year at a
  // station shares one scale, and gives the station's own daily average.
  function stationExtremes(sid) {
    if (EXT_CACHE.has(sid)) return Promise.resolve(EXT_CACHE.get(sid));
    var u = 'https://data.rcc-acis.org/StnData?' + new URLSearchParams({ sid: sid, sdate: 'por', edate: 'por', elems: 'pcpn,avgt' });
    return safeFetch(u).then(function (r) { return r.json(); }).then(function (j) {
      if (j.error || !Array.isArray(j.data)) throw new Error(j.error || 'no data');
      var maxDaily = 0, curYear = null, curYearTotal = 0, curMonth = null, curMonthTotal = 0, maxAnnual = 0, maxMonthly = 0;
      var yearFrom = null, yearTo = null, maxTemp = null, minTemp = null, sum = new Map(), count = new Map();
      j.data.forEach(function (row) {
        var v = parsePcpn(row[1]).v, t = row[2] !== undefined ? parseTemp(row[2]) : null;
        var date = row[0], year = date.slice(0, 4), month = date.slice(0, 7), md = date.slice(5);
        if (yearFrom === null) yearFrom = year; yearTo = year;
        if (t !== null) { if (maxTemp === null || t > maxTemp) maxTemp = t; if (minTemp === null || t < minTemp) minTemp = t; }
        if (v === null) return;
        if (v > maxDaily) maxDaily = v;
        if (year !== curYear) { if (curYear !== null) maxAnnual = Math.max(maxAnnual, curYearTotal); curYear = year; curYearTotal = 0; }
        curYearTotal += v;
        if (month !== curMonth) { if (curMonth !== null) maxMonthly = Math.max(maxMonthly, curMonthTotal); curMonth = month; curMonthTotal = 0; }
        curMonthTotal += v;
        sum.set(md, (sum.get(md) || 0) + v);
        count.set(md, (count.get(md) || 0) + 1);
      });
      if (curYear !== null) maxAnnual = Math.max(maxAnnual, curYearTotal);
      if (curMonth !== null) maxMonthly = Math.max(maxMonthly, curMonthTotal);
      var avgByDate = new Map();
      sum.forEach(function (s, md) { avgByDate.set(md, s / count.get(md)); });
      var years = yearFrom && yearTo ? (parseInt(yearTo, 10) - parseInt(yearFrom, 10) + 1) : 0;
      var ext = { maxDaily: maxDaily, maxMonthly: maxMonthly, maxAnnual: maxAnnual, avgByDate: avgByDate, yearFrom: yearFrom, yearTo: yearTo, years: years, maxTemp: maxTemp, minTemp: minTemp };
      EXT_CACHE.set(sid, ext);
      return ext;
    });
  }
  // NOAA's 30-year normal for each date, from ACIS's own normal element (period
  // not verified live, so never printed). A station without a normals product
  // fails here and the comparison says so.
  function stationNormal(sid, year) {
    var key = sid + '|' + year;
    if (NORM_CACHE.has(key)) return Promise.resolve(NORM_CACHE.get(key));
    var params = JSON.stringify({ sid: sid, sdate: year + '-01-01', edate: year + '-12-31', elems: [{ name: 'pcpn', normal: 1 }] });
    return safeFetch('https://data.rcc-acis.org/StnData?params=' + encodeURIComponent(params)).then(function (r) { return r.json(); }).then(function (j) {
      if (j.error || !Array.isArray(j.data)) throw new Error(j.error || 'no data');
      var byDate = new Map();
      j.data.forEach(function (row) { var v = parsePcpn(row[1]).v; if (v !== null) byDate.set(row[0].slice(5), v); });
      NORM_CACHE.set(key, byDate);
      return byDate;
    });
  }

  // ---------- derived ----------
  function derive(days) {
    var n = days.length, month = Array(12).fill(0), mdays = Array(12).fill(0), monthValid = Array(12).fill(0);
    var total = 0, wet = 0, missing = 0, trace = 0, max = { v: 0, date: '', doy: -1 };
    var dry = 0, dryStart = -1, dryMax = { len: 0, end: '', endDoy: -1, startDoy: -1 }, cum = [], over1 = 0;
    days.forEach(function (x) {
      mdays[x.m]++;
      // An unrecorded day ends a dry run: nobody knows whether it rained.
      if (x.v === null) { missing++; dry = 0; dryStart = -1; cum.push(total); return; }
      monthValid[x.m]++;
      if (x.flag === 'T') { trace++; dry = 0; dryStart = -1; cum.push(total); return; }
      total += x.v; month[x.m] += x.v; cum.push(total);
      if (x.v >= 1) over1++;
      if (x.v > 0) { wet++; dry = 0; dryStart = -1; if (x.v > max.v) max = { v: x.v, date: x.date, doy: x.doy }; }
      else { if (dry === 0) dryStart = x.doy; dry++; if (dry > dryMax.len) dryMax = { len: dry, end: x.date, endDoy: x.doy, startDoy: dryStart }; }
    });
    var validMonths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter(function (i) { return monthValid[i] > 0; });
    var maxMonth = validMonths.length ? Math.max.apply(null, validMonths.map(function (i) { return month[i]; })) : 0;
    var maxDay = Math.max.apply(null, [0].concat(days.map(function (x) { return x.v || 0; })));
    var hot = { v: null, date: '', doy: -1 }, cold = { v: null, date: '', doy: -1 };
    days.forEach(function (x) {
      if (x.t === null) return;
      if (hot.v === null || x.t > hot.v) hot = { v: x.t, date: x.date, doy: x.doy };
      if (cold.v === null || x.t < cold.v) cold = { v: x.t, date: x.date, doy: x.doy };
    });
    return { n: n, month: month, mdays: mdays, monthValid: monthValid, total: total, wet: wet, missing: missing, trace: trace, max: max, dryMax: dryMax, cum: cum, maxMonth: maxMonth, maxDay: maxDay, over1: over1, hot: hot, cold: cold };
  }
  function overlayKey() { return ST.cmp === 'normal' ? 'normal30' : ST.cmp === 'station' ? 'full' : ''; }
  // The chosen comparison as daily amounts + running total, aligned to the year, or null.
  function overlaySeries() {
    var key = overlayKey();
    if (!key || !DATA) return null;
    var byDate, label;
    if (key === 'normal30' && NORM30) { byDate = NORM30; label = 'NOAA 30-year normal'; }
    else if (key === 'full' && EXT && EXT.avgByDate.size) { byDate = EXT.avgByDate; label = EXT.yearFrom + '–' + EXT.yearTo + ' station average (' + EXT.years + ' yrs)'; }
    else return null;
    var missing = 0;
    var dailyV = DATA.days.map(function (x) { var v = byDate.get(x.date.slice(5)); if (v === undefined) { missing++; return 0; } return v; });
    if (missing === DATA.days.length) return null;
    var cum = [], run = 0;
    dailyV.forEach(function (v) { run += v; cum.push(run); });
    return { daily: dailyV, cum: cum, total: run, label: label };
  }
  // one fixed scale per station: its full-record maxima, never smaller than this year needs
  function domain() {
    var D = DATA.d, ov = overlaySeries();
    return {
      daily: Math.max(EXT ? EXT.maxDaily : 0, D.maxDay, ov ? Math.max.apply(null, ov.daily) : 0, 0.01),
      annual: Math.max(EXT ? EXT.maxAnnual : 0, D.total, ov ? ov.total : 0, 0.01)
    };
  }
  function tempDomain() {
    var D = DATA.d;
    if (D.hot.v === null) return null;
    var hi = Math.max(EXT && EXT.maxTemp !== null ? EXT.maxTemp : -Infinity, D.hot.v);
    var lo = Math.min(EXT && EXT.minTemp !== null ? EXT.minTemp : Infinity, D.cold.v);
    return { hi: hi + 4, lo: lo - 4 };
  }

  // ---------- svg helpers ----------
  function fmtDate(iso) { if (!iso) return ''; var p = iso.split('-').map(Number); return MON[p[1] - 1].toUpperCase() + ' ' + p[2]; }
  function trunc(s, n) { return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }
  function wrapMono(text, maxWidth, fontSize) {
    var charW = fontSize * 0.62, maxChars = Math.max(10, Math.floor(maxWidth / charW));
    var words = text.split(' '), lines = [], cur = '';
    words.forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (t.length > maxChars && cur) { lines.push(cur); cur = w; } else cur = t; });
    if (cur) lines.push(cur);
    return lines;
  }
  function footerText() {
    var D = DATA.d, m = META;
    var sub = [f2(D.total) + ' IN PRECIPITATION', D.wet + ' WET DAYS', 'LONGEST DRY SPELL ' + D.dryMax.len + ' DAYS'];
    if (D.missing) sub.push(D.missing + ' UNRECORDED');
    if (PREVIEW) sub.push('PREVIEW THROUGH ' + fmtDate(PREVIEW.last));
    var mi = miles(m.km);
    var away = mi < 1 ? '' : ', ' + Math.round(mi) + ' MI AWAY';
    return {
      place: m.city + ', ' + m.stateAbbr,
      year: String(m.year),
      sub: sub.join('   ·   '),
      prov: 'RECORDED AT ' + toTitle(m.name) + away + '  ·  NOAA DAILY RECORD VIA RCC-ACIS'
    };
  }
  /* The footer block (place, year, name, totals, source) stacks up from the
     bottom; the plot ends above it, so a taller print gets a taller plot and
     nothing overlaps. */
  function footLayout(W, H) {
    var F = footerText(), marginX = 60, maxW = W - marginX * 2 - 190;
    var provLines = wrapMono(F.prov, maxW, 11), subLines = wrapMono(F.sub, maxW, 14);
    var y = H - 26, prov = [], sub = [];
    for (var i = provLines.length - 1; i >= 0; i--) { prov.unshift([provLines[i], y]); y -= 16; }
    y -= 8;
    for (i = subLines.length - 1; i >= 0; i--) { sub.unshift([subLines[i], y]); y -= 20; }
    if (ST.name) y -= 22;
    var persoY = y; y -= 26;
    var yearY = y; y -= 58;
    return { F: F, marginX: marginX, prov: prov, sub: sub, persoY: persoY, yearY: yearY, placeY: y, top: y - 26 };
  }
  function frame(p, W, H, inner, FL, o) {
    var F = FL.F, mx = FL.marginX, b = o.bleed || 0;
    var vb = (-b) + ' ' + (-b) + ' ' + (W + 2 * b) + ' ' + (H + 2 * b);
    var size = o.px ? ' width="' + o.px[0] + '" height="' + o.px[1] + '"' : '';
    var grain = p.grain ? '<defs><filter id="paperGrain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.035 0"/></filter></defs><rect x="' + (-b) + '" y="' + (-b) + '" width="' + (W + 2 * b) + '" height="' + (H + 2 * b) + '" filter="url(#paperGrain)"/>' : '';
    var mono = "'IBM Plex Mono',monospace", serif = "'Fraunces',Georgia,serif";
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '"' + size + ' font-family="\'IBM Plex Sans\',system-ui,sans-serif" role="img" aria-labelledby="rpT rpD">' +
      (o.fontCss ? '<style>' + o.fontCss + '</style>' : '') +
      '<title id="rpT">' + esc(F.place) + ', ' + esc(F.year) + ', rain print' + (PREVIEW ? ' preview through ' + esc(fmtDate(PREVIEW.last)) : '') + '</title>' +
      '<desc id="rpD">' + esc(F.sub) + '. ' + esc(F.prov) + '</desc>' +
      '<rect x="' + (-b) + '" y="' + (-b) + '" width="' + (W + 2 * b) + '" height="' + (H + 2 * b) + '" fill="' + p.bg + '"/>' + grain + inner +
      '<text x="' + mx + '" y="' + FL.placeY + '" font-family="' + serif + '" font-size="30" font-weight="300" fill="' + p.ink + '">' + esc(F.place) + '</text>' +
      '<text x="' + mx + '" y="' + FL.yearY + '" font-family="' + serif + '" font-size="60" font-weight="600" fill="' + p.ink + '">' + esc(F.year) + '</text>' +
      (ST.name ? '<text x="' + (mx + 2) + '" y="' + FL.persoY + '" font-family="' + mono + '" font-size="13" font-weight="500" fill="' + p.ink + '" opacity="0.8" letter-spacing="1.2">' + esc(ST.name.toUpperCase()) + '</text>' : '') +
      FL.sub.map(function (l) { return '<text x="' + mx + '" y="' + l[1] + '" font-family="' + mono + '" font-size="14" fill="' + p.mute + '" letter-spacing="1">' + esc(l[0]) + '</text>'; }).join('') +
      FL.prov.map(function (l) { return '<text x="' + mx + '" y="' + l[1] + '" font-family="' + mono + '" font-size="11" fill="' + p.mute + '" letter-spacing="0.5">' + esc(l[0]) + '</text>'; }).join('') +
      hankoMark(p, W, H) + (o.watermark ? watermark(p, W, H) : '') + (PREVIEW ? previewBand(p, W, FL) : '') + '</svg>';
    return s;
  }
  /* This year's preview carries a solid band across the art, on screen, in the
     download and on the gift card, so nobody takes it for the finished print. */
  function previewBand(p, W, FL) {
    var y = Math.round(FL.top * 0.42), h = 58, mono = "'IBM Plex Mono',monospace";
    return '<g aria-hidden="true"><rect x="-40" y="' + (y - h / 2) + '" width="' + (W + 80) + '" height="' + h + '" fill="' + p.ink + '" opacity="0.88"/>' +
      '<text x="' + (W / 2) + '" y="' + (y - 4) + '" font-family="' + mono + '" font-size="19" font-weight="500" fill="' + p.bg + '" text-anchor="middle" letter-spacing="2.5">PREVIEW THROUGH ' + esc(fmtDate(PREVIEW.last)) + '</text>' +
      '<text x="' + (W / 2) + '" y="' + (y + 18) + '" font-family="' + mono + '" font-size="13" fill="' + p.bg + '" text-anchor="middle" letter-spacing="1.5">YOUR PRINT WILL SHOW THE FULL YEAR, JAN 1 TO DEC 31, ' + META.year + '</text></g>';
  }
  // Month i's first day and length on the x axis. A preview lays out the whole
  // calendar year, so the months still to come keep their place.
  function monthSpan(i, days, D) {
    if (PREVIEW) {
      var y = META.year, mm = function (k) { return y + '-' + String(k).padStart(2, '0') + '-01'; };
      var a = dayIndex(y, mm(i + 1)), b = i === 11 ? PREVIEW.yearLen : dayIndex(y, mm(i + 2));
      return [a, b - a];
    }
    var s0 = days.findIndex(function (x) { return x.m === i; });
    return [s0, s0 < 0 ? 0 : D.mdays[i]];
  }
  // where a preview stops: a quiet dashed line at the last recorded day
  function cutLine(p, X, yTop, yBase) {
    return PREVIEW ? '<line x1="' + f2(X) + '" y1="' + f2(yTop) + '" x2="' + f2(X) + '" y2="' + f2(yBase) + '" stroke="' + p.mute + '" stroke-width="1" stroke-dasharray="3 4" opacity="0.7"/>' : '';
  }
  function watermark(p, W, H) {
    var line = 'PREVIEW  ·  AGSIST.COM/RAIN-PRINT  ·  ', row = '', i, out = '';
    for (i = 0; i < 6; i++) row += line;
    for (i = -6; i < 14; i++) {
      out += '<text x="' + (-W) + '" y="' + (i * 110) + '" font-family="\'IBM Plex Mono\',monospace" font-size="30" font-weight="500" fill="' + p.ink + '" letter-spacing="3">' + row + '</text>';
    }
    return '<g opacity="0.16" transform="rotate(-24 ' + (W / 2) + ' ' + (H / 2) + ')" aria-hidden="true">' + out + '</g>';
  }
  // minY: the highest a label may climb (the legend row sits above it); a
  // record day that reaches the top gets its label beside the point instead.
  function callout(p, x, y, text, anchor, liftPx, minY) {
    var lift = 26 + (liftPx || 0), labelY = y - lift - 4;
    if (minY !== undefined && labelY < minY) { labelY = Math.max(minY, y + 14); lift = 0; }
    return (lift ? '<line x1="' + f2(x) + '" y1="' + f2(y) + '" x2="' + f2(x) + '" y2="' + f2(y - lift) + '" stroke="' + p.mute + '" stroke-width="1"/>' : '') +
      '<text x="' + f2(x + (anchor === 'end' ? -6 : 6)) + '" y="' + f2(labelY) + '" font-family="\'IBM Plex Mono\',monospace" font-size="12" fill="' + p.ink + '" text-anchor="' + anchor + '" stroke="' + p.bg + '" stroke-width="3" paint-order="stroke">' + esc(text) + '</text>';
  }
  // lift the wettest-day callout clear of a nearby hottest/coldest label
  function calloutLift(maxDoy, D) {
    var nearest = Infinity;
    if (D.hot && D.hot.v !== null) nearest = Math.min(nearest, Math.abs(D.hot.doy - maxDoy));
    if (D.cold && D.cold.v !== null) nearest = Math.min(nearest, Math.abs(D.cold.doy - maxDoy));
    return nearest < 18 ? 34 : 0;
  }
  function bracket(p, xa, xb, y, text) {
    return '<path d="M' + f2(xa) + ',' + f2(y - 6) + ' L' + f2(xa) + ',' + f2(y) + ' L' + f2(xb) + ',' + f2(y) + ' L' + f2(xb) + ',' + f2(y - 6) + '" fill="none" stroke="' + p.mute + '" stroke-width="1"/>' +
      '<text x="' + f2((xa + xb) / 2) + '" y="' + f2(y + 16) + '" font-family="\'IBM Plex Mono\',monospace" font-size="12" fill="' + p.ink + '" text-anchor="middle">' + esc(text) + '</text>';
  }
  // band between the year's running total and the comparison: blue where wetter, amber where drier.
  // One quad per day, drawn opaque and slightly overlapped inside a group that
  // carries the transparency, so neighbouring quads leave no hairline seams.
  function rgbaParts(c) { var m = /rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)/.exec(c); return m ? ['rgb(' + m[1] + ',' + m[2] + ',' + m[3] + ')', +m[4]] : [c, 1]; }
  function bandFill(p, D, OV, x0, w, y1, k) {
    var wet = '', dry = '', pAX = x0, pAY = y1, pNX = x0, pNY = y1, ov = 0.35;
    for (var i = 0; i < D.n; i++) {
      var AX = x0 + (i + 1) * w, AY = y1 - D.cum[i] * k, NY = y1 - OV.cum[i] * k;
      var q = '<polygon points="' + f2(pAX - ov) + ',' + f2(pAY) + ' ' + f2(AX) + ',' + f2(AY) + ' ' + f2(AX) + ',' + f2(NY) + ' ' + f2(pNX - ov) + ',' + f2(pNY) + '"/>';
      if (D.cum[i] >= OV.cum[i]) wet += q; else dry += q;
      pAX = AX; pAY = AY; pNX = AX; pNY = NY;
    }
    var W = rgbaParts(p.fill), Dr = rgbaParts(p.dryFill);
    return '<g fill="' + W[0] + '" opacity="' + W[1] + '">' + wet + '</g><g fill="' + Dr[0] + '" opacity="' + Dr[1] + '">' + dry + '</g>';
  }
  function tempY(t, TD, yTop, yBase) { return yBase - (t - TD.lo) / (TD.hi - TD.lo) * (yBase - yTop); }
  function tempOverlay(p, D, days, x0, w, yTop, yBase, axisX, labelPos) {
    var TD = tempDomain();
    if (!TD) return '';
    var path = '', started = false;
    days.forEach(function (x) {
      if (x.t === null) { started = false; return; }
      path += (started ? 'L' : 'M') + f2(x0 + x.doy * w + w / 2) + ',' + f2(tempY(x.t, TD, yTop, yBase)) + ' ';
      started = true;
    });
    if (!path) return '';
    var mono = "'IBM Plex Mono',monospace", ann = '', axis = '';
    for (var i = 0; i <= 3; i++) {
      var t = TD.lo + (TD.hi - TD.lo) * i / 3;
      axis += '<text x="' + f2(axisX + 8) + '" y="' + f2(tempY(t, TD, yTop, yBase) + 4) + '" font-family="' + mono + '" font-size="10" fill="' + p.temp + '" opacity="0.85">' + Math.round(t) + '°</text>';
    }
    if (D.hot.v !== null) {
      var hx = x0 + D.hot.doy * w + w / 2, hy = tempY(D.hot.v, TD, yTop, yBase);
      ann += '<circle cx="' + f2(hx) + '" cy="' + f2(hy) + '" r="2.5" fill="' + p.temp + '"/><text x="' + f2(hx) + '" y="' + f2(hy + 16) + '" font-family="' + mono + '" font-size="10" fill="' + p.temp + '" text-anchor="middle" stroke="' + p.bg + '" stroke-width="3" paint-order="stroke">' + Math.round(D.hot.v) + '° ' + fmtDate(D.hot.date) + '</text>';
    }
    if (D.cold.v !== null && D.cold.doy !== D.hot.doy) {
      var cx = x0 + D.cold.doy * w + w / 2, cy = tempY(D.cold.v, TD, yTop, yBase);
      ann += '<circle cx="' + f2(cx) + '" cy="' + f2(cy) + '" r="2.5" fill="' + p.temp + '"/><text x="' + f2(cx) + '" y="' + f2(cy - 10) + '" font-family="' + mono + '" font-size="10" fill="' + p.temp + '" text-anchor="middle" stroke="' + p.bg + '" stroke-width="3" paint-order="stroke">' + Math.round(D.cold.v) + '° ' + fmtDate(D.cold.date) + '</text>';
    }
    var label = '<text x="' + f2(labelPos.x) + '" y="' + f2(labelPos.y) + '" font-family="' + mono + '" font-size="11" fill="' + p.temp + '" text-anchor="' + labelPos.anchor + '" font-style="italic">thin line: daily average temperature, °F (right scale)</text>';
    return '<path d="' + path + '" fill="none" stroke="' + p.temp + '" stroke-width="1" opacity="0.55"/>' + axis + ann + label;
  }
  // Pins for the reader's own dates (Staircase only, as Sig designed it):
  // quieter than the data, pushed clear of the wettest-day callout, stacked
  // when two fall within two weeks, anchored inward near the edges and
  // flipped below the line near the top.
  function lifeMarkers(p, markers, x0, x1, w, yFor, avoidDoy, yTop) {
    var s = '', lastDoy = -999, tier = 0;
    markers.slice().sort(function (a, b) { return a.doy - b.doy; }).forEach(function (m) {
      var X = x0 + (m.doy + 0.5) * w, Y = yFor(m.doy);
      tier = (m.doy - lastDoy < 14) ? tier + 1 : 0; lastDoy = m.doy;
      var near = avoidDoy >= 0 && Math.abs(m.doy - avoidDoy) < 16;
      var labelY = Y - 12 - tier * 14 - (near ? 46 : 0), below = false;
      if (labelY < yTop + 14) { labelY = Y + 18 + tier * 14; below = true; }
      var anchor = X > x1 - 110 ? 'end' : (X < x0 + 110 ? 'start' : 'middle');
      s += '<line x1="' + f2(X) + '" y1="' + f2(Y) + '" x2="' + f2(X) + '" y2="' + f2(below ? labelY - 10 : labelY + 4) + '" stroke="' + p.ink + '" stroke-width="1" stroke-dasharray="1.5 2" opacity="0.55"/>' +
        '<circle cx="' + f2(X) + '" cy="' + f2(Y) + '" r="2.5" fill="' + p.ink + '" opacity="0.85"/>' +
        '<text x="' + f2(X) + '" y="' + f2(labelY) + '" font-family="\'IBM Plex Mono\',monospace" font-size="10.5" fill="' + p.ink + '" text-anchor="' + anchor + '" opacity="0.85" stroke="' + p.bg + '" stroke-width="3" paint-order="stroke">' + esc(m.label) + '</text>';
    });
    return s;
  }
  function printMarkers() {
    if (!DATA) return [];
    return ST.markers.map(function (m) {
      var doy = dayIndex(META.year, m.date);
      return doy >= 0 && doy < DATA.d.n ? { doy: doy, label: m.label || fmtDate(m.date) } : null;
    }).filter(Boolean);
  }

  // The maker's mark: a square vermilion seal in the style of an artist's hanko,
  // bottom right. It is a real QR code (components/qr.js, level M, quiet zone
  // kept) that opens this exact design at agsist.com/rain-print?d=<code>.
  var QR_OK = true;
  // The design itself, without the gift marker: what the QR and shared links open.
  function artDesign() { return Object.assign({}, ST, { gift: false }); }
  function hankoMark(p, W, H) {
    var url = shortUrl(artDesign());
    QR_OK = false;
    if (!root.AgQR || url === SITE) return '';
    var m;
    try { m = root.AgQR.matrix(url); } catch (e) { return ''; }
    QR_OK = true;
    // cell size capped so the stamp stays about 100 units, 1.3 in on the 18 in print
    // (Sig, 2026-10-12: smaller). Modules stay 0.44 mm or larger at the longest code.
    var n = m.length, quiet = 4, cell = Math.min(2.2, 88 / (n + 2 * quiet));
    var quietBox = n * cell + 2 * quiet * cell, frameGap = 3, frameW = 3;
    var stampSize = quietBox + 2 * frameGap + 2 * frameW;
    var ox = W - 60 - stampSize, oy = H - 26 - stampSize;
    var cox = ox + (stampSize - quietBox) / 2 + quiet * cell, coy = oy + (stampSize - quietBox) / 2 + quiet * cell;
    var mods = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (m[r][c]) {
      mods += '<rect x="' + f2(cox + c * cell) + '" y="' + f2(coy + r * cell) + '" width="' + f2(cell + 0.3) + '" height="' + f2(cell + 0.3) + '"/>';
    }
    // square to the page edges (Sig, 2026-10-11): no tilt
    return '<g opacity="0.95" aria-hidden="true">' +
      '<rect x="' + f2(ox) + '" y="' + f2(oy) + '" width="' + f2(stampSize) + '" height="' + f2(stampSize) + '" fill="#F7F6F1"/>' +
      '<rect x="' + f2(ox + 1.5) + '" y="' + f2(oy + 1.5) + '" width="' + f2(stampSize - 3) + '" height="' + f2(stampSize - 3) + '" fill="none" stroke="#B0231A" stroke-width="' + frameW + '"/>' +
      '<g fill="#B0231A">' + mods + '</g></g>';
  }

  // Waveform: one tick per day, height = that day's precipitation, on a ruled inch scale
  function waveform(p, W, H, o) {
    var FL = footLayout(W, H);
    var x0 = 90, x1 = W - 70, base = FL.top - 76, top = 110, D = DATA.d, days = DATA.days, DOM = domain();
    var k = (base - top) / DOM.daily, w = (x1 - x0) / (PREVIEW ? PREVIEW.yearLen : D.n), mono = "'IBM Plex Mono',monospace";
    var bars = '', grid = '';
    var step = DOM.daily > 4 ? 1 : DOM.daily > 1.5 ? 0.5 : 0.25;
    for (var r = 0; r <= DOM.daily + 1e-9; r += step) {
      var Y = base - r * k;
      grid += '<line x1="' + x0 + '" y1="' + f2(Y) + '" x2="' + x1 + '" y2="' + f2(Y) + '" stroke="' + p.rule + '" stroke-width="' + (r === 0 ? 1.2 : 0.8) + '" opacity="' + (r === 0 ? 1 : 0.55) + '"/>' +
        '<text x="' + (x0 - 10) + '" y="' + f2(Y + 4) + '" font-family="' + mono + '" font-size="11" fill="' + p.mute + '" text-anchor="end">' + r.toFixed(2).replace(/\.?0+$/, '') + (r === 0 ? ' in' : '') + '</text>';
    }
    for (var i = 0; i < 12; i++) {
      var ms = monthSpan(i, days, D), s0 = ms[0];
      if (s0 < 0) continue;
      var X = x0 + s0 * w;
      grid += '<line x1="' + f2(X) + '" y1="' + top + '" x2="' + f2(X) + '" y2="' + base + '" stroke="' + p.rule + '" stroke-width="0.8" stroke-dasharray="1 3" opacity="0.4"/>' +
        '<line x1="' + f2(X) + '" y1="' + base + '" x2="' + f2(X) + '" y2="' + (base + 8) + '" stroke="' + p.mute + '" stroke-width="1"/>' +
        '<text x="' + f2(X + ms[1] * w / 2) + '" y="' + (base + 27) + '" font-size="12.5" font-weight="500" fill="' + p.mute + '" text-anchor="middle" letter-spacing="1.8">' + MON[i].toUpperCase() + '</text>';
    }
    var overlay = '', OV = overlaySeries();
    if (OV) {
      overlay = '<polygon points="' + f2(x0) + ',' + f2(base) + ' ' + OV.daily.map(function (v, j) { return f2(x0 + j * w + w / 2) + ',' + f2(base - v * k); }).join(' ') + ' ' + f2(PREVIEW ? x0 + D.n * w : x1) + ',' + f2(base) + '" fill="' + p.fill + '" opacity="0.7"/>';
    }
    if (PREVIEW) overlay += cutLine(p, x0 + D.n * w, top, base);
    days.forEach(function (x) {
      var X = x0 + x.doy * w + w / 2, isMax = D.max.v > 0 && x.doy === D.max.doy;
      if (x.v === null) bars += '<line x1="' + f2(X) + '" y1="' + base + '" x2="' + f2(X) + '" y2="' + (base - 6) + '" stroke="' + p.mute + '" stroke-width="1" stroke-dasharray="1 1"/>';
      else if (x.v > 0) {
        var barTop = base - x.v * k, col = isMax ? p.temp : seasonalColor(p.rain, x.m);
        bars += '<line x1="' + f2(X) + '" y1="' + base + '" x2="' + f2(X) + '" y2="' + f2(barTop) + '" stroke="' + col + '" stroke-width="' + f2(isMax ? Math.max(2.2, w * 1.1) : Math.max(1.4, w * 0.75)) + '"/>';
        if (!isMax && (base - barTop) < 3) bars += '<circle cx="' + f2(X) + '" cy="' + f2(barTop) + '" r="1.6" fill="' + col + '"/>';
      }
    });
    var temp = tempOverlay(p, D, days, x0, w, top, base, x1 + 8, { x: x1, y: top - 30, anchor: 'end' });
    var ann = '';
    if (D.max.v > 0 && D.max.doy >= 0) {
      var mx = x0 + D.max.doy * w + w / 2;
      ann += callout(p, mx, base - D.max.v * k, fmtDate(D.max.date) + '  ' + f2(D.max.v) + ' in', mx > (x0 + x1) / 2 ? 'end' : 'start', calloutLift(D.max.doy, D), top + 2);
    }
    if (D.dryMax.len > 0) ann += bracket(p, x0 + D.dryMax.startDoy * w, x0 + (D.dryMax.endDoy + 1) * w, base + 46, D.dryMax.len + ' dry days');
    var key = '<text x="' + x0 + '" y="' + (top - 30) + '" font-family="' + mono + '" font-size="11" fill="' + p.mute + '">' + (OV ? 'shaded: ' + esc(OV.label) : "one line per day · height is that day's precipitation") + '</text>';
    return frame(p, W, H, grid + overlay + bars + temp + ann + key, FL, o);
  }

  // Staircase: the pluviograph trace, the running total across the year
  function staircase(p, W, H, o) {
    var FL = footLayout(W, H);
    var x0 = 90, x1 = W - 90, y0 = 90, y1 = FL.top - 74, D = DATA.d, days = DATA.days, DOM = domain();
    var k = (y1 - y0) / DOM.annual, w = (x1 - x0) / (PREVIEW ? PREVIEW.yearLen : D.n), mono = "'IBM Plex Mono',monospace";
    var d = 'M' + x0 + ',' + y1;
    days.forEach(function (x) { d += 'L' + f2(x0 + (x.doy + 1) * w) + ',' + f2(y1 - D.cum[x.doy] * k); });
    var grid = '', step = DOM.annual > 20 ? 5 : DOM.annual > 8 ? 2 : 1;
    for (var r = 0; r <= DOM.annual; r += step) {
      var Y = y1 - r * k;
      grid += '<line x1="' + x0 + '" y1="' + f2(Y) + '" x2="' + x1 + '" y2="' + f2(Y) + '" stroke="' + p.rule + '" stroke-width="0.8" opacity="' + (r === 0 ? 1 : 0.55) + '"/><text x="' + (x0 - 10) + '" y="' + f2(Y + 4) + '" font-family="' + mono + '" font-size="11" fill="' + p.mute + '" text-anchor="end">' + r + (r === 0 ? ' in' : '') + '</text>';
    }
    for (var i = 0; i < 12; i++) {
      var ms = monthSpan(i, days, D), s0 = ms[0];
      if (s0 < 0) continue;
      var X = x0 + s0 * w;
      grid += '<line x1="' + f2(X) + '" y1="' + y0 + '" x2="' + f2(X) + '" y2="' + y1 + '" stroke="' + p.rule + '" stroke-width="0.8" stroke-dasharray="2 4" opacity="0.35"/>' +
        '<text x="' + f2(X + ms[1] * w / 2) + '" y="' + (y1 + 26) + '" font-size="12" fill="' + p.mute + '" text-anchor="middle" letter-spacing="1.5">' + MON[i].toUpperCase() + '</text>';
    }
    var endX = x0 + D.n * w, endY = y1 - D.total * k;
    grid += cutLine(p, endX, y0, y1);
    var OV = overlaySeries();
    // the line is the hero: a soft wash under it turns the staircase into a landscape profile
    var areaFill = OV ? '' : '<defs><linearGradient id="stairFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + p.rain + '" stop-opacity="0.22"/><stop offset="100%" stop-color="' + p.rain + '" stop-opacity="0.02"/></linearGradient></defs><path d="' + d + ' L' + f2(PREVIEW ? endX : x1) + ',' + f2(y1) + ' Z" fill="url(#stairFill)"/>';
    var path = '<path d="' + d + '" fill="none" stroke="' + p.rain + '" stroke-width="2.75" stroke-linejoin="round" stroke-linecap="round"/>';
    var waypoint = '';
    if (D.max.v > 0 && D.max.doy >= 0) {
      var wx = x0 + (D.max.doy + 1) * w, wy = y1 - D.cum[D.max.doy] * k;
      var wx0 = x0 + D.max.doy * w, wy0 = y1 - D.cum[D.max.doy - 1 >= 0 ? D.max.doy - 1 : 0] * k;
      waypoint = '<line x1="' + f2(wx0) + '" y1="' + f2(wy0) + '" x2="' + f2(wx) + '" y2="' + f2(wy) + '" stroke="' + p.temp + '" stroke-width="3.25" stroke-linecap="round"/><circle cx="' + f2(wx) + '" cy="' + f2(wy) + '" r="4" fill="' + p.temp + '"/>';
    }
    var overlay = '';
    if (OV) {
      var od = 'M' + x0 + ',' + y1;
      for (var j = 0; j < D.n; j++) od += 'L' + f2(x0 + (j + 1) * w) + ',' + f2(y1 - OV.cum[j] * k);
      overlay = bandFill(p, D, OV, x0, w, y1, k) + '<path d="' + od + '" fill="none" stroke="' + p.mute + '" stroke-width="1.1" opacity="0.75" stroke-dasharray="5 4"/>';
    }
    // No temperature line on Staircase (Sig's panel: it competes with the one clean gesture).
    var ann = '';
    if (OV) ann += '<text x="' + f2(x0) + '" y="' + f2(y0 - 14) + '" font-family="' + mono + '" font-size="11" fill="' + p.mute + '">dashed line: ' + esc(OV.label) + '</text>';
    if (D.max.v > 0 && D.max.doy >= 0) {
      var mx = x0 + (D.max.doy + 1) * w, my = y1 - D.cum[D.max.doy] * k;
      ann += callout(p, mx, my, fmtDate(D.max.date) + '  +' + f2(D.max.v) + ' in', mx > (x0 + x1) / 2 ? 'end' : 'start', calloutLift(D.max.doy, D), y0 + 2);
    }
    if (D.dryMax.len >= 5) ann += bracket(p, x0 + D.dryMax.startDoy * w, x0 + (D.dryMax.endDoy + 1) * w, y1 + 44, D.dryMax.len + ' dry days');
    // headline: the comparison, computed from the two real running totals, baseline always named
    // A preview compares the same days: Jan 1 through the last recorded day, on both lines.
    var pct = OV && OV.total > 0 ? Math.round((D.total - OV.total) / OV.total * 100) : null;
    var baseline = ST.cmp === 'station' ? 'this station’s full record' : 'the 30-year normal';
    var insight = pct === null ? '' : pct === 0 ? 'dead on ' + baseline : pct > 0 ? pct + '% wetter than ' + baseline : Math.abs(pct) + '% drier than ' + baseline;
    if (insight && PREVIEW) insight += ' so far';
    var thru = PREVIEW ? fmtDate(PREVIEW.last).replace(/^(\w)(\w+)/, function (a, b, c) { return b + c.toLowerCase(); }) : '';
    ann += '<circle cx="' + f2(endX) + '" cy="' + f2(endY) + '" r="3.5" fill="' + p.ink + '"/>';
    if (insight) {
      ann += '<text x="' + f2(x1) + '" y="' + f2(y0 - 34) + '" font-family="\'Fraunces\',Georgia,serif" font-size="30" font-weight="600" fill="' + p.temp + '" text-anchor="end">' + esc(insight) + '</text>' +
        '<text x="' + f2(x1) + '" y="' + f2(y0 - 10) + '" font-family="' + mono + '" font-size="13" fill="' + p.mute + '" text-anchor="end">' +
        (PREVIEW ? f2(D.total) + ' in through ' + thru + ' · ' + f2(OV.total) + ' in by then in a typical year' : f2(D.total) + ' in this year · ' + f2(OV.total) + ' in a typical year') + '</text>';
    } else {
      ann += '<text x="' + f2(x1) + '" y="' + f2(y0 - 20) + '" font-family="\'Fraunces\',Georgia,serif" font-size="34" font-weight="600" fill="' + p.ink + '" text-anchor="end">' + f2(D.total) + '<tspan font-size="16" font-weight="400" fill="' + p.mute + '">' + (PREVIEW ? ' in, through ' + thru : ' in, by Dec 31') + '</tspan></text>';
    }
    var marks = lifeMarkers(p, printMarkers(), x0, x1, w, function (doy) { return y1 - D.cum[Math.min(doy, D.n - 1)] * k; }, D.max.doy, y0);
    return frame(p, W, H, grid + areaFill + overlay + path + waypoint + marks + ann, FL, o);
  }

  /* o: {bleed (art units), watermark, px [w,h], fontCss}. The art is ART_W wide at the trim. */
  function buildSvg(o) {
    o = o || {};
    var P = PRINT[ST.size], H = Math.round(ART_W * P.h / P.w * 100) / 100;
    var fn = ST.layout === 'waveform' ? waveform : staircase;
    return fn(PAL[ST.palette], ART_W, H, o);
  }

  // ---------------------------------------------------------------- UI
  var form = $('rp-form'), statusEl = $('rp-status'), art = $('rp-art');
  function setStatus(msg, bad) { if (SAMPLE) return; statusEl.textContent = msg; statusEl.classList.toggle('rp-bad', !!bad); }
  var EMPTY_ART = art.innerHTML, EMPTY_STATUS = statusEl.textContent;
  function sampleLine(on) {
    $('rp-sample-line').hidden = !on;
    if (on) $('rp-sample-txt').textContent = 'Sample: ' + SAMPLE.place + ' ' + SAMPLE.year + '. Type your own town to make yours.';
  }
  // Back to the page as it loads with no design: the empty box and the first instruction.
  function clearSample() {
    if (!SAMPLE) return;
    SAMPLE = null;
    sampleLine(false);
    DATA = null; PREVIEW = null; NOART = ''; BLOCKED = '';
    art.innerHTML = EMPTY_ART;
    art.classList.add('rp-empty');
    $('rp-stats-wrap').hidden = true;
    $('rp-source').textContent = '';
    $('rp-code-wrap').hidden = true;
    $('ro-design').value = '';
    setStatus(EMPTY_STATUS);
    showBuy(false);
  }
  function lastFullYear() { return CURRENT_YEAR - 1; }
  function runSample() {
    SAMPLE = { place: 'Chetek, WI', year: lastFullYear() };
    run(null, normalize({ place: SAMPLE.place, year: SAMPLE.year, layout: 'staircase', palette: 'paper', size: '12x18', cmp: 'none', name: '', markers: [] }));
  }
  function useSample() {
    if (!SAMPLE || !DATA) return;
    SAMPLE = null;
    sampleLine(false);
    writeInputs(ST);
    setDesignRefs();
    showBuy(true);
    setStatus('Using the sample design for ' + ST.place + ', ' + ST.year + '. Change anything you like, or order it below.');
  }
  function radios(name) { return Array.prototype.slice.call(doc.querySelectorAll('input[name="' + name + '"]')); }
  function readInputs() {
    var markers = [];
    for (var i = 1; i <= 3; i++) {
      var d = $('rp-m' + i + 'd').value, l = $('rp-m' + i + 'l').value;
      if (d) markers.push({ date: d, label: l });
    }
    var pick = function (n, dflt) { var r = radios(n).find(function (x) { return x.checked; }); return r ? r.value : dflt; };
    return normalize({ place: $('rp-place').value, year: $('rp-year').value, station: ST.station,
      layout: pick('rp-layout', 'staircase'), palette: pick('rp-pal', 'paper'), size: '12x18',
      cmp: $('rp-cmp').value, name: $('rp-name').value, markers: markers });
  }
  // The year list: this year first (a gift, delivered in January), then every finished year.
  function giftYearLabel() { return fill((PRICES && PRICES.gift_year_label) || '{year}, as a gift (delivered in January)'); }
  function buildYears() {
    var h = '<option value="' + CURRENT_YEAR + '">' + esc(giftYearLabel()) + '</option>';
    for (var y = CURRENT_YEAR - 1; y >= 1890; y--) h += '<option value="' + y + '">' + y + '</option>';
    $('rp-year').innerHTML = h;
  }
  function writeInputs(s) {
    $('rp-place').value = s.place;
    var yr = s.year || (CURRENT_YEAR - 1), sel = $('rp-year');
    // a year from a link that is not in the list (next year, or before 1890) still shows, so its message can explain
    if (!sel.querySelector('option[value="' + yr + '"]')) { var o = doc.createElement('option'); o.value = yr; o.textContent = yr; sel.insertBefore(o, sel.firstChild); }
    sel.value = String(yr);
    radios('rp-layout').forEach(function (r) { r.checked = r.value === s.layout; });
    radios('rp-pal').forEach(function (r) { r.checked = r.value === s.palette; });
    $('rp-cmp').value = s.cmp;
    $('rp-name').value = s.name;
    for (var i = 1; i <= 3; i++) {
      var m = s.markers[i - 1];
      $('rp-m' + i + 'd').value = m ? m.date : '';
      $('rp-m' + i + 'l').value = m ? m.label : '';
    }
    syncMarkerBounds();
  }
  function syncMarkerBounds() {
    var y = parseInt($('rp-year').value, 10);
    for (var i = 1; i <= 3; i++) {
      var el = $('rp-m' + i + 'd');
      if (y) { el.min = y + '-01-01'; el.max = y + '-12-31'; }
    }
  }
  function updateUrl() {
    if (SAMPLE) return;   // a sample never goes into the address bar
    var q = toParams(ST) + (MAKER ? '&maker=1' : '');
    try { root.history.replaceState(null, '', root.location.pathname + '?' + q); } catch (e) {}
  }

  function showBuy(on) {
    on = on && !SAMPLE;
    $('rp-buy').classList.toggle('rp-off', !on);
    doc.querySelectorAll('.rp-buy-btn').forEach(function (b) { b.disabled = !on; });
    $('rp-dl').disabled = !on || !DATA;
    // print files wait for the full year: a preview is never sent to the printer
    doc.querySelectorAll('#rp-maker button').forEach(function (b) { b.disabled = !on || !DATA || !!PREVIEW; });
    syncGift();
  }

  // ---------- this year, as a gift ----------
  var GIFT_MSG_MAX = 240, GIFT_TO_MAX = 80;
  function fill(t) { return String(t || '').replace(/\{year\}/g, String(CURRENT_YEAR)).replace(/\{next\}/g, String(CURRENT_YEAR + 1)); }
  function giftMode() { return !!ST.year && yearMode(ST.year, TODAY) === 'gift'; }
  function canOrder() { return !SAMPLE && !BLOCKED && (!!DATA || !!NOART); }
  function longDate(iso) { var p = String(iso).split('-').map(Number); return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][p[1] - 1] + ' ' + p[2]; }
  var ORDER_NOTE = '';
  function syncGift() {
    var on = giftMode() && canOrder();
    $('rp-gift').hidden = !on;
    $('ro-deliver-wrap').hidden = !on;
    if (!ORDER_NOTE) ORDER_NOTE = $('ro-order-note').textContent;
    $('ro-order-note').textContent = on ? 'Sig will email you within a day with a payment link. Nothing is charged until you pay it. The proof comes in January, once the full year is drawn.' : ORDER_NOTE;
    $('ro-address-label').textContent = on ? 'Ship to (name, street, town, state, ZIP; theirs is fine)' : 'Ship to (name, street, town, state, ZIP)';
    $('rp-preview-line').hidden = !(on && PREVIEW);
    syncAddress();
    syncCutoffs();
  }
  // Christmas lines on the print and framed cards. This year's gift ships in January anyway, so none show in gift mode.
  var CUTOFF_KEY = { print12x18: 'print_christmas_cutoff', framed12x18: 'framed_christmas_cutoff' };
  function syncCutoffs() {
    Object.keys(CUTOFF_KEY).forEach(function (id) {
      var el = $('rp-cut-' + id);
      if (!el) return;
      var t = giftMode() && canOrder() ? '' : cutoffNote(TODAY, PRICES && PRICES[CUTOFF_KEY[id]]);
      el.textContent = t;
      el.hidden = !t;
    });
  }

  function distText(m) {
    var mi = miles(m.km);
    return mi < 1 ? 'under a mile from ' + m.place : (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + ' miles from ' + m.place;
  }
  function setDesignRefs() {
    if (SAMPLE) { $('rp-code-wrap').hidden = true; $('ro-design').value = ''; return; }
    var code = encodeCode(ST);
    $('rp-code').textContent = code;
    $('rp-code-wrap').hidden = !code;
    $('ro-design').value = designUrl(ST);
    updateUrl();
  }
  /* This year, too thin to draw: a plain message instead of art. The order stays
     open; Sig draws the print from the full year in January. */
  function renderNoArt() {
    var m = META;
    art.innerHTML = '<p class="rp-placeholder">' + esc(NOART) + '</p>';
    art.classList.add('rp-empty');
    $('rp-stats-wrap').hidden = true;
    $('rp-source').innerHTML = 'The print will come from <b>' + esc(toTitle(m.name)) + ', ' + esc(m.state) + '</b> (NOAA station ' + esc(m.sid) + '), ' + esc(distText(m)) +
      '. Daily NOAA observations through <a href="https://www.rcc-acis.org/" rel="noopener">RCC-ACIS</a>.';
    setDesignRefs();
    showBuy(true);
  }

  function render() {
    if (!DATA || BLOCKED) return;
    art.innerHTML = buildSvg({});
    art.classList.remove('rp-empty');
    var D = DATA.d, m = META, OV = overlaySeries();
    var dist = distText(m);
    var later = PREVIEW ? ST.markers.filter(function (x) { return x.date > PREVIEW.last; }).length : 0;
    if (PREVIEW) $('rp-preview-line').innerHTML = '<b>Preview through ' + esc(longDate(PREVIEW.last)) + '.</b> Your print will show the full year.';
    $('rp-source').innerHTML = 'Recorded at <b>' + esc(toTitle(m.name)) + ', ' + esc(m.state) + '</b> (NOAA station ' + esc(m.sid) + '), ' + esc(dist) + '. ' +
      (PREVIEW ? 'This preview uses the days in so far: ' : '') +
      (D.n - D.missing) + ' of ' + D.n + ' days recorded' + (PREVIEW ? ', January 1 through ' + esc(longDate(PREVIEW.last)) : '') + (D.missing ? ', <b>' + D.missing + ' unrecorded</b> (drawn as flat on Staircase, marked on Waveform and counted on the print)' : '') + '. ' +
      (PREVIEW && OV ? 'The comparison covers the same days. ' : '') +
      (later ? (later === 1 ? 'Your date after ' : 'Your dates after ') + esc(longDate(PREVIEW.last)) + ' will be on the finished print. ' : '') +
      'Daily NOAA observations through <a href="https://www.rcc-acis.org/" rel="noopener">RCC-ACIS</a>. ' +
      (EXT ? 'Scale fixed to this station’s record, ' + EXT.yearFrom + ' to ' + EXT.yearTo + '.' : 'The station history did not load, so the scale is this year only.') +
      (QR_OK ? '' : ' <b>No QR stamp on this one:</b> the name and labels are too long to fit in it. Shorten them and it comes back.') +
      (ST.cmp !== 'none' && !OV ? ' <b>No comparison is drawn:</b> ' + (ST.cmp === 'normal' ? 'this station has no NOAA normal.' : 'the station history did not load.') : '');
    var rows = [
      [PREVIEW ? 'Total so far' : 'Total', f2(D.total) + ' in'], ['Wet days', D.wet], ['Longest dry spell', D.dryMax.len + ' days'],
      ['Wettest day', D.max.v > 0 ? fmtDate(D.max.date) + ', ' + f2(D.max.v) + ' in' : 'no measurable rain'],
      ['Trace days', D.trace], ['Unrecorded days', D.missing],
      ['Compared with', OV ? OV.label + ', ' + f2(OV.total) + ' in' + (PREVIEW ? ' (same days)' : '') : 'nothing']
    ];
    $('rp-stats').innerHTML = rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + esc(String(r[1])) + '</dd></div>'; }).join('');
    $('rp-stats-wrap').hidden = false;
    setDesignRefs();
    showBuy(true);
    sampleLine(!!SAMPLE);
  }

  function blockPrint(msg) {
    BLOCKED = msg;
    PREVIEW = null; NOART = '';
    art.innerHTML = '<p class="rp-placeholder">No print from this station. Pick another under Weather station in Make it yours, below.</p>';
    art.classList.add('rp-empty');
    $('rp-stats-wrap').hidden = true;
    $('rp-source').textContent = '';
    showBuy(false);
    setStatus(msg, true);
  }

  var reqToken = 0;
  function run(e, preset) {
    if (e) e.preventDefault();
    var next;
    if (preset) next = preset;
    else {
      if (SAMPLE) {
        // The reader's own draw replaces the sample. An empty town keeps the sample up and says what is missing.
        var want = readInputs();
        if (!want.place) { statusEl.textContent = 'Enter a town and state, like Chetek, WI.'; statusEl.classList.add('rp-bad'); return; }
        clearSample();
        ST.station = '';
      }
      var fromUrlStation = ST.station;
      next = readInputs();
      if (e && e.type === 'submit' && (next.place !== ST.place || next.year !== ST.year)) next.station = '';
      else next.station = fromUrlStation;
    }
    var my = ++reqToken;
    ST = next;
    var go = $('rp-go'), sel = $('rp-station');
    go.disabled = true; sel.disabled = true;
    BLOCKED = '';
    var g, chosen, picked;
    var done = function () { if (my === reqToken) { go.disabled = false; sel.disabled = STATIONS.length < 2; } };
    Promise.resolve().then(function () {
      if (!ST.place) throw new Error('Enter a town and state, like Chetek, WI.');
      if (!ST.year) throw new Error('Enter a year.');
      var mode = yearMode(ST.year, TODAY);
      if (mode === 'future') throw new Error(ST.year + ' has not started yet. Pick ' + CURRENT_YEAR + ' to order this year as a gift, or an earlier year.');
      ST.gift = mode === 'gift';
      setStatus('Finding ' + ST.place + '…');
      return geocode(ST.place);
    }).then(function (res) {
      if (my !== reqToken) throw 'stale';
      g = res;
      setStatus('Finding weather stations near ' + g.name + ', ' + g.admin1 + (ST.gift ? ' reporting in ' : ' with a record covering ') + ST.year + '…');
      return stations(g.latitude, g.longitude, ST.year);
    }).then(function (list) {
      if (my !== reqToken) throw 'stale';
      STATIONS = list;
      if (!list.length) throw new Error(ST.gift ? 'No weather station within about 40 miles of ' + g.name + ' has been reporting since January 1, ' + ST.year + ', so no print of this year can be made there. Try a nearby town.'
        : 'No weather station within about 40 miles of ' + g.name + ' has a record covering all of ' + ST.year + '. Try a nearby town or another year.');
      var want = list.find(function (s) { return s.sid === ST.station; });
      if (want) { chosen = want; return daily(want.sid, ST.year).then(function (d) { picked = d; }); }
      // Nearest first; take the first of three with a near-complete year, else the most complete.
      var tries = list.slice(0, 3), best = null, bestSt = null, i = 0;
      var step = function () {
        if (i >= tries.length) { picked = best; chosen = bestSt; return null; }
        var s = tries[i++];
        setStatus('Reading ' + toTitle(s.name) + ' for ' + ST.year + '…');
        return daily(s.sid, ST.year).then(function (d) {
          if (!best || d.d.missing < best.d.missing) { best = d; bestSt = s; }
          if (d.d.missing <= MISS_OK) { picked = d; chosen = s; return null; }
          return step();
        }, function () { return step(); });
      };
      return step();
    }).then(function () {
      if (my !== reqToken) throw 'stale';
      // This year with nothing back yet: the station is still the one for the print, so ordering stays open.
      if (!picked && ST.gift) { chosen = STATIONS[0]; picked = { meta: {}, days: [], d: derive([]) }; }
      if (!picked) throw new Error('None of the stations near ' + g.name + ' returned data for ' + ST.year + '. Try again in a minute.');
      ST.station = chosen.sid;
      sel.innerHTML = STATIONS.map(function (s) {
        return '<option value="' + esc(s.sid) + '">' + esc(toTitle(s.name)) + ', ' + Math.round(miles(s.km)) + ' mi, record ' + s.valid_daterange[0][0].slice(0, 4) + '–' + s.valid_daterange[0][1].slice(0, 4) + '</option>';
      }).join('');
      sel.value = chosen.sid;
      var stateAbbr = abbrFor((g.admin1 || '').toLowerCase()) || picked.meta.state || '';
      META = { name: picked.meta.name || chosen.name, state: picked.meta.state || chosen.state || '', stateAbbr: stateAbbr, year: ST.year, km: chosen.km, place: g.name + ', ' + (stateAbbr || g.admin1), city: g.name, sid: chosen.sid };
      if (picked.d.missing > MISS_BLOCK) {
        DATA = null;
        blockPrint(toTitle(META.name) + ' has ' + picked.d.missing + ' unrecorded days in ' + ST.year + '. A print with that many gaps would show dry weeks that may not have been dry, so none is drawn. Pick another station from the list, or another year.');
        throw 'blocked';
      }
      if (ST.gift && picked.days.length < GIFT_MIN_DAYS) {
        DATA = null; PREVIEW = null;
        NOART = 'Too little of ' + ST.year + ' is recorded yet to draw a fair preview. ' +
          (picked.days.length ? 'The record so far runs through ' + longDate(picked.days[picked.days.length - 1].date) + '. ' : 'No days of ' + ST.year + ' have come in from this station yet. ') +
          'You can still order it as a gift: the full-year print is drawn and delivered in January.';
        renderNoArt();
        setStatus('No preview yet: too few days of ' + ST.year + ' are recorded. Ordering is open.');
        throw 'noart';
      }
      DATA = { days: picked.days, d: picked.d }; NOART = '';
      PREVIEW = ST.gift ? { last: picked.days[picked.days.length - 1].date, yearLen: isLeap(ST.year) ? 366 : 365 } : null;
      setStatus('Loading the full history of ' + toTitle(META.name) + '…');
      return Promise.all([
        stationExtremes(chosen.sid).catch(function () { return null; }),
        stationNormal(chosen.sid, ST.year).catch(function () { return null; })
      ]);
    }).then(function (res) {
      if (my !== reqToken) throw 'stale';
      EXT = res[0]; NORM30 = res[1];
      var D = DATA.d;
      setStatus('Drawn from ' + (D.n - D.missing) + ' recorded days at ' + toTitle(META.name) + '.' + (D.missing ? ' ' + D.missing + ' days are unrecorded; the print says so.' : '') +
        (PREVIEW ? ' Preview through ' + longDate(PREVIEW.last) + '.' : ''));
      render();
      if (SAMPLE) setStatus(EMPTY_STATUS);
      else ga('rain_print_draw', { layout: ST.layout });
    }).catch(function (err) {
      if (err === 'stale') return;
      if (SAMPLE) { if (my === reqToken) clearSample(); return; }   // the sample failed: the empty box, quietly
      if (err === 'blocked' || err === 'noart') return;
      if (my !== reqToken) return;
      setStatus(err && err.message ? err.message : 'The print did not draw. Press Draw my print again; if it fails twice, try another year or town.', true);
    }).then(done);
  }

  function restyle() {
    var next = readInputs();
    if (SAMPLE) { next.place = ST.place; next.year = ST.year; }   // style choices try out on the sample
    next.station = ST.station;
    next.gift = ST.gift;
    var yearChanged = next.year !== ST.year, placeChanged = next.place !== ST.place;
    if (yearChanged || placeChanged) { syncMarkerBounds(); return; }
    ST = next;
    render();
  }

  // ---------- prices and buying ----------
  function money(n) { return '$' + (Math.round(n * 100) % 100 ? n.toFixed(2) : String(n)); }
  function loadPrices() {
    return fetch('/data/rain-print.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || typeof j.digital !== 'number') return;
      PRICES = j;
      PRODUCTS.forEach(function (id) {
        var el = doc.querySelector('[data-price="' + id + '"]');
        if (el && typeof j[id] === 'number') el.textContent = money(j[id]);
      });
      if (j.ships_within) $('rp-ships').textContent = j.ships_within;
      if (j.gift_delivery) $('rp-gift-delivery').textContent = fill(j.gift_delivery);
      syncCutoffs();
      var o = $('rp-year').querySelector('option[value="' + CURRENT_YEAR + '"]');
      if (o) o.textContent = giftYearLabel();
    }).catch(function () {});
  }
  function payLink(id) {
    var l = PRICES && PRICES.payment_links && PRICES.payment_links[id];
    return typeof l === 'string' && /^https:\/\/[^\s"<>]+$/.test(l) ? l : '';
  }
  function buy(id) {
    if (!canOrder()) { setStatus('Draw your print first, then choose.', true); return; }
    var code = encodeCode(ST), link = payLink(id), note = $('rp-buy-note');
    ga('rain_print_buy', { choice: id, via: link && code.length <= 200 ? 'checkout' : 'form', gift: ST.gift ? 1 : 0 });
    // Stripe's client_reference_id takes A-Z a-z 0-9 - _ and at most 200 characters; a gift code is GIFT- plus the design code.
    if (link && code && code.length <= 200) {
      var u = link + (link.indexOf('?') >= 0 ? '&' : '?') + 'client_reference_id=' + code;
      root.open(u, '_blank', 'noopener');
      note.innerHTML = ST.gift
        ? 'Checkout opened in a new tab. Your design code is <code>' + esc(code) + '</code>; GIFT at the front tells Sig it is a gift for January. He emails you to confirm where it goes, and sends the proof once the full year is drawn.'
        : 'Checkout opened in a new tab. Your design code is <code>' + esc(code) + '</code>; it travels with the payment, and Sig emails a proof before printing.';
      return;
    }
    openOrder(id);
  }
  function openOrder(id) {
    var box = $('rp-order');
    box.hidden = false;
    $('ro-choice').value = id;
    syncAddress();
    $('ro-design').value = designUrl(ST);
    $('ro-out').innerHTML = '';
    try { box.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
    try { $('ro-name').focus({ preventScroll: true }); } catch (e) {}
  }
  function syncAddress() {
    var print = $('ro-choice').value !== 'digital';
    $('ro-address-wrap').hidden = !print;
    $('ro-address').required = print;
    // a gift file sent straight to the person it is for needs their email
    var theirs = giftMode() && canOrder() && !print && $('ro-deliver').value === 'recipient';
    $('ro-gift-email-wrap').hidden = !theirs;
    $('ro-gift-email').required = theirs;
  }
  var EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[A-Za-z]{2,}$/;
  function orderSubject(x) {
    return 'Rain print order' + (x.gift_january ? ' (' + ST.year + ' gift, January)' : '') + ': ' + CHOICE[x.choice] + ' for ' + x.name;
  }
  function orderText(x) {
    return orderSubject(x) + '\n\nName: ' + x.name + '\nEmail: ' + x.email +
      (x.gift_january ? '\nGift: yes, make it after January 1 once the December numbers are in' +
        (x.gift_to ? '\nGift for: ' + x.gift_to : '') + '\nDeliver to: ' + (x.gift_deliver === 'recipient' ? 'the person it is for' : 'the buyer') +
        (x.gift_email ? '\nTheir email: ' + x.gift_email : '') + (x.gift_message ? '\nCard message: ' + x.gift_message : '') : '') +
      (x.address ? '\nShip to:\n' + x.address : '') + (x.notes ? '\nNotes: ' + x.notes : '') +
      '\nDesign code: ' + x.design_code + '\nDesign: ' + x.design_url + '\n';
  }
  var sending = false;
  function submitOrder(e) {
    e.preventDefault();
    if (sending) return;
    var out = $('ro-out');
    if (!canOrder()) { out.innerHTML = '<p class="rp-msg rp-bad">Draw your print first.</p>'; return; }
    var x = {
      name: cleanText($('ro-name').value, 80), email: $('ro-email').value.trim(), choice: $('ro-choice').value,
      address: $('ro-address').value.trim().slice(0, 600), notes: $('ro-notes').value.trim().slice(0, 2000),
      design_url: designUrl(ST), design_code: encodeCode(ST), page: '/rain-print'
    };
    if (x.choice === 'digital') x.address = '';
    var gift = giftMode();
    if (gift) {
      x.gift_january = true;
      x.gift_to = cleanText($('rp-gift-to').value, GIFT_TO_MAX);
      x.gift_deliver = $('ro-deliver').value === 'recipient' ? 'recipient' : 'buyer';
      x.gift_email = x.choice === 'digital' && x.gift_deliver === 'recipient' ? $('ro-gift-email').value.trim() : '';
      x.gift_message = $('rp-gift-msg').value.replace(/\r\n?/g, '\n').trim().slice(0, GIFT_MSG_MAX);
    }
    var bad = !x.name ? ['ro-name', 'Add your name.'] : !EMAIL_RE.test(x.email) ? ['ro-email', 'Add an email address Sig can reply to.']
      : (x.choice !== 'digital' && x.address.length < 10) ? ['ro-address', 'Add the shipping address for the print.']
      : (gift && x.choice === 'digital' && x.gift_deliver === 'recipient' && !EMAIL_RE.test(x.gift_email)) ? ['ro-gift-email', 'Add their email for the file, or choose Me under Deliver to.'] : null;
    if (bad) { out.innerHTML = '<p class="rp-msg rp-bad">' + esc(bad[1]) + '</p>'; try { $(bad[0]).focus(); } catch (err) {} return; }
    var hp = form && doc.querySelector('#ro-form input[name="_gotcha"]');
    var data = Object.assign({ _gotcha: hp ? hp.value : '' }, x);
    var subj = orderSubject(x);
    var fs = Object.assign({ _subject: subj, _replyto: x.email, form: 'rain-print-order' }, x);
    if (hp && hp.value) fs._gotcha = hp.value;
    var btn = $('ro-submit'), was = btn.textContent;
    sending = true; btn.disabled = true; btn.textContent = 'Sending…'; out.innerHTML = '';
    var send = root.agsistFormPost || function () { return Promise.reject(new Error('no form helper')); };
    send('rain-print-order', data, fs).then(function () {
      ga('rain_print_order', { result: 'ok', choice: x.choice, gift: gift ? 1 : 0 });
      out.innerHTML = gift
        ? '<div class="rp-msg rp-ok" tabindex="-1"><p><b>Sent.</b> Sig will email you within a day with a payment link.</p>' +
          '<p>Your ' + ST.year + ' print is made once the station\u2019s December numbers are in. He sends the proof then, and it is delivered in January. He writes to ' + esc(x.email) +
          '; nothing is charged until you pay that link. Your design code is <code>' + esc(x.design_code) + '</code>.</p>' +
          '<p><button class="btn btn-secondary" id="ro-card" type="button">Print a gift card</button></p></div>'
        : '<div class="rp-msg rp-ok" tabindex="-1"><p><b>Sent.</b> Sig will email you within a day with a payment link and a proof.</p>' +
          '<p>He writes to ' + esc(x.email) + '. Nothing is charged until you pay that link. Your design code is <code>' + esc(x.design_code) + '</code>.</p></div>';
      if ($('ro-card')) $('ro-card').addEventListener('click', printCard);
      $('ro-form').reset(); $('ro-choice').value = x.choice; $('ro-design').value = x.design_url; syncAddress();
      try { out.firstChild.focus(); } catch (err) {}
    }).catch(function () {
      ga('rain_print_order', { result: 'fail', choice: x.choice, gift: gift ? 1 : 0 });
      var body = orderText(x);
      var href = 'mailto:' + ORDER_TO + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(body);
      out.innerHTML = '<div class="rp-msg rp-bad"><p><b>That did not go through. Nothing was sent.</b></p><p>Send it by email instead; the message is written out for you, to ' + ORDER_TO + '.</p>' +
        '<p><a class="rp-btn2" id="ro-mail" href="' + esc(href) + '">Email the order</a></p><textarea readonly rows="7" aria-label="Your order, as text">' + esc(body) + '</textarea></div>';
      try { $('ro-mail').focus(); } catch (err) {}
    }).then(function () { sending = false; btn.disabled = false; btn.textContent = was; });
  }

  // ---------- the gift card ----------
  /* One printed page to put under the tree, built into #rp-giftcard (a child of
     <body>, shown only in print while body has .rp-carding). One shared layout
     filled from the design on the page: no file per order. */
  function cardSvg() {
    // its own ids, so the copy does not lean on the art above (hidden while printing)
    return buildSvg({}).replace(/id="(rpT|rpD|paperGrain|stairFill)"/g, 'id="gc$1"').replace(/url\(#(paperGrain|stairFill)\)/g, 'url(#gc$1)')
      .replace('aria-labelledby="rpT rpD"', 'aria-labelledby="gcrpT gcrpD"');
  }
  function cardHtml() {
    var J = PRICES || {}, m = META;
    var title = fill(J.gift_card_title || 'Your {year} Rain Print is coming in January');
    var note = fill(J.gift_card_note || 'The finished print shows every day of rain from January 1 to December 31, {year}.');
    var to = cleanText($('rp-gift-to').value, GIFT_TO_MAX), msg = $('rp-gift-msg').value.replace(/\r\n?/g, '\n').trim().slice(0, GIFT_MSG_MAX);
    var qr = '';
    try { if (root.AgQR) qr = root.AgQR.svg(shortUrl(artDesign()), 'QR code that opens this design'); } catch (e) { qr = ''; }
    var art = DATA && PREVIEW
      ? '<figure class="rpc-art"><div class="rpc-svg">' + cardSvg() + '</div><figcaption><b>Preview through ' + esc(longDate(PREVIEW.last)) + '</b>, drawn from the days recorded so far. ' + esc(note) + '</figcaption></figure>'
      : '<p class="rpc-noart">' + esc(note) + ' The art is drawn in January, once the whole year is recorded.</p>';
    return '<div class="rpc">' +
      '<p class="rpc-kick">A Rain Print from AGSIST</p>' +
      (to ? '<p class="rpc-to">For ' + esc(to) + '</p>' : '') +
      '<p class="rpc-title">' + esc(title) + '</p>' +
      '<p class="rpc-place">' + esc(m.place) + ' &middot; NOAA station ' + esc(toTitle(m.name)) + '</p>' +
      art +
      (msg ? '<p class="rpc-msg">' + esc(msg).replace(/\n/g, '<br>') + '</p>' : '') +
      '<div class="rpc-foot">' + (qr ? '<div class="rpc-qr">' + qr + '</div>' : '') +
      '<p>Scan to open this design at agsist.com/rain-print. Once the year is over, the same code shows all of ' + META.year + '.</p></div>' +
      '</div>';
  }
  function printCard() {
    if (!canOrder() || !giftMode() || !META) return;
    var el = $('rp-giftcard');
    el.innerHTML = cardHtml();
    doc.body.classList.add('rp-carding');
    var done = function () { doc.body.classList.remove('rp-carding'); root.removeEventListener('afterprint', done); };
    root.addEventListener('afterprint', done);
    ga('rain_print_gift_card', { art: DATA ? 1 : 0 });
    fontsReady().then(function () { try { root.print(); } catch (e) {} });
  }

  // ---------- downloads ----------
  var FONT_FILES = [
    ['Fraunces', '100 900', 'normal', '/fonts/rp-fraunces-var.woff2'],
    ['IBM Plex Sans', '400', 'normal', '/fonts/rp-plex-sans-400.woff2'],
    ['IBM Plex Sans', '500', 'normal', '/fonts/rp-plex-sans-500.woff2'],
    ['IBM Plex Mono', '400', 'normal', '/fonts/rp-plex-mono-400.woff2'],
    ['IBM Plex Mono', '500', 'normal', '/fonts/rp-plex-mono-500.woff2'],
    ['IBM Plex Mono', '400', 'italic', '/fonts/rp-plex-mono-400i.woff2']
  ];
  var fontCssP = null;
  function fontsReady() {
    var fs = doc.fonts;
    if (!fs || !fs.load) return Promise.resolve();
    return Promise.all([
      fs.load("300 30px 'Fraunces'"), fs.load("600 60px 'Fraunces'"), fs.load("400 12px 'IBM Plex Sans'"), fs.load("500 12px 'IBM Plex Sans'"),
      fs.load("400 12px 'IBM Plex Mono'"), fs.load("500 12px 'IBM Plex Mono'"), fs.load("italic 400 12px 'IBM Plex Mono'")
    ]).then(function () { return fs.ready; }, function () { return fs.ready; });
  }
  // An SVG drawn into a canvas cannot see the page's fonts, so the export carries them inline.
  function fontCss() {
    if (fontCssP) return fontCssP;
    fontCssP = Promise.all(FONT_FILES.map(function (f) {
      return fetch(f[3]).then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); }).then(function (buf) {
        var bytes = new Uint8Array(buf), bin = '';
        for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return "@font-face{font-family:'" + f[0] + "';font-weight:" + f[1] + ';font-style:' + f[2] + ";src:url(data:font/woff2;base64," + btoa(bin) + ") format('woff2')}";
      }).catch(function () { return ''; });
    })).then(function (parts) { return parts.join(''); });
    return fontCssP;
  }
  function slug() {
    return ('rain-print-' + META.city + '-' + META.stateAbbr + '-' + META.year + '-' + ST.layout).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
  }
  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob), a = doc.createElement('a');
    a.href = url; a.download = name; doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  /* -> Promise<canvas>. kind 'preview' (watermarked, 2000 px wide, no bleed) or a print size key. */
  function drawCanvas(kind) {
    var P = PRINT[kind === 'preview' ? ST.size : kind];
    var o = {}, pxW, pxH;
    if (kind === 'preview') {
      pxW = 2000; pxH = Math.round(2000 * P.h / P.w); o.watermark = true;
    } else {
      pxW = Math.round((P.w + 2 * BLEED_IN) * DPI); pxH = Math.round((P.h + 2 * BLEED_IN) * DPI);
      o.bleed = ART_W / P.w * BLEED_IN;
    }
    o.px = [pxW, pxH];
    var saved = ST.size;
    if (kind !== 'preview') ST.size = kind;
    // The page's own fonts first (document.fonts), then the same files inlined
    // into the SVG, since an SVG drawn into a canvas cannot see page fonts.
    var svgP = fontsReady().then(fontCss).then(function (css) { o.fontCss = css; var s = buildSvg(o); ST.size = saved; return s; });
    return svgP.then(function (svg) {
      return new Promise(function (resolve, reject) {
        var img = new Image(), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        img.onload = function () {
          (img.decode ? img.decode().catch(function () {}) : Promise.resolve()).then(function () {
            return new Promise(function (r) { setTimeout(r, 60); });
          }).then(function () { try {
            var c = doc.createElement('canvas');
            c.width = pxW; c.height = pxH;
            var cx = c.getContext('2d');
            cx.drawImage(img, 0, 0, pxW, pxH);
            URL.revokeObjectURL(url);
            resolve(c);
          } catch (e) { reject(e); } });
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image')); };
        img.src = url;
      });
    });
  }
  function toBlob(c, type, q) { return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(new Error('too large for this browser')); }, type, q); }); }
  /* A one-page PDF around a JPEG: MediaBox = bleed size, TrimBox inset 0.125 in. No library. */
  function pdfFromJpeg(jpeg, pxW, pxH, P) {
    var enc = new TextEncoder(), parts = [], offs = [], len = 0;
    var put = function (x) { var b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
    var wPt = (P.w + 2 * BLEED_IN) * 72, hPt = (P.h + 2 * BLEED_IN) * 72, bl = BLEED_IN * 72;
    var content = 'q ' + wPt.toFixed(2) + ' 0 0 ' + hPt.toFixed(2) + ' 0 0 cm /Im0 Do Q';
    put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    var obj = function (n, body) { offs[n] = len; put(n + ' 0 obj\n'); body(); put('\nendobj\n'); };
    obj(1, function () { put('<< /Type /Catalog /Pages 2 0 R >>'); });
    obj(2, function () { put('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'); });
    obj(3, function () { put('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + wPt.toFixed(2) + ' ' + hPt.toFixed(2) + '] /BleedBox [0 0 ' + wPt.toFixed(2) + ' ' + hPt.toFixed(2) + '] /TrimBox [' + bl + ' ' + bl + ' ' + (wPt - bl).toFixed(2) + ' ' + (hPt - bl).toFixed(2) + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'); });
    obj(4, function () { put('<< /Type /XObject /Subtype /Image /Width ' + pxW + ' /Height ' + pxH + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n'); put(jpeg); put('\nendstream'); });
    obj(5, function () { put('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream'); });
    var xref = len;
    var x = 'xref\n0 6\n0000000000 65535 f \n';
    for (var i = 1; i <= 5; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    put(x + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(parts, { type: 'application/pdf' });
  }
  function exportFile(kind, fmt, btn) {
    if (!DATA || BLOCKED) return;
    var was = btn.textContent, out = $('rp-dl-note');
    btn.disabled = true; btn.textContent = 'Making the file…';
    var name = slug() + (kind === 'preview' ? '-preview' : '-' + kind + '-300dpi');
    var job;
    if (fmt === 'svg') {
      job = fontCss().then(function (css) { return new Blob([buildSvg({ fontCss: css })], { type: 'image/svg+xml' }); }).then(function (b) { saveBlob(b, slug() + '.svg'); return 'SVG saved.'; });
    } else {
      job = drawCanvas(kind).then(function (c) {
        if (fmt === 'pdf') {
          return toBlob(c, 'image/jpeg', 0.95).then(function (j) { return j.arrayBuffer(); }).then(function (buf) {
            saveBlob(pdfFromJpeg(new Uint8Array(buf), c.width, c.height, PRINT[kind]), name + '.pdf');
            return 'PDF saved: ' + PRINT[kind].label + ' plus 0.125 in bleed on each side, ' + c.width + ' x ' + c.height + ' px.';
          });
        }
        return toBlob(c, 'image/png').then(function (b) {
          saveBlob(b, name + '.png');
          return kind === 'preview' ? 'Preview saved (' + c.width + ' x ' + c.height + ' px, watermarked).'
            : 'Print file saved: ' + PRINT[kind].label + ' plus 0.125 in bleed on each side, ' + c.width + ' x ' + c.height + ' px at 300 dpi.';
        });
      });
    }
    job.then(function (msg) { out.textContent = msg; ga('rain_print_download', { kind: kind, fmt: fmt }); },
      function () { out.textContent = 'This browser could not make that file. A desktop browser handles the big print files best.'; })
      .then(function () { btn.disabled = false; btn.textContent = was; });
  }

  // ---------- wire up ----------
  buildYears();
  writeInputs(ST);
  doc.querySelectorAll('.rp-cy').forEach(function (el) { el.textContent = String(CURRENT_YEAR); });
  // "Giving it for Christmas?" reads right from October through December only
  $('rp-gift-hint').hidden = parseInt(TODAY.slice(5, 7), 10) < 10;
  if (MAKER) $('rp-maker').hidden = false;
  form.addEventListener('submit', run);
  $('rp-station').addEventListener('change', function () {
    ST.station = $('rp-station').value;
    if (SAMPLE) run(null, Object.assign({}, ST)); else run();
  });
  $('rp-sample-use').addEventListener('click', useSample);
  $('rp-year').addEventListener('input', syncMarkerBounds);
  ['rp-cmp'].forEach(function (id) { $(id).addEventListener('change', restyle); });
  ['rp-name', 'rp-m1l', 'rp-m2l', 'rp-m3l', 'rp-m1d', 'rp-m2d', 'rp-m3d'].forEach(function (id) { $(id).addEventListener('input', restyle); });
  radios('rp-layout').concat(radios('rp-pal')).forEach(function (r) { r.addEventListener('change', restyle); });
  doc.querySelectorAll('.rp-buy-btn').forEach(function (b) { b.addEventListener('click', function () { buy(b.getAttribute('data-choice')); }); });
  $('ro-choice').addEventListener('change', syncAddress);
  $('ro-deliver').addEventListener('change', syncAddress);
  $('rp-card').addEventListener('click', printCard);
  $('ro-form').addEventListener('submit', submitOrder);
  $('rp-dl').addEventListener('click', function () { exportFile('preview', 'png', $('rp-dl')); });
  doc.querySelectorAll('#rp-maker button').forEach(function (b) {
    b.addEventListener('click', function () { exportFile(b.getAttribute('data-size'), b.getAttribute('data-fmt'), b); });
  });
  $('rp-copy').addEventListener('click', function () {
    var u = shortUrl(artDesign()), b = $('rp-copy');
    var ok = function () { b.textContent = 'Link copied'; setTimeout(function () { b.textContent = 'Copy link to this design'; }, 2000); };
    if (root.navigator.clipboard && root.navigator.clipboard.writeText) root.navigator.clipboard.writeText(u).then(ok, function () { root.prompt('Copy this link', u); });
    else root.prompt('Copy this link', u);
  });
  showBuy(false);
  loadPrices();
  if (ST.place && ST.year) run();
  else runSample();
})(typeof window !== 'undefined' ? window : this);
