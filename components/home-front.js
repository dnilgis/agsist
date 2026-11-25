/* components/home-front.js: the front page on /index1 (Nov 20, 2026; fx/index1-bold, owner: "go bold on index1, i want to
   be blown away"). One answer for the reader's place, then the world around it, one card per topic.

   THE ANSWER (#fp-hero), read at once.
   - Saved place (components/saved-place.js, with town and coordinates): the best corn and soybean bid within 50 miles from
     the elevator boards our network reads (dnilgis.github.io/bids data/merged-index.json, the file the home page and
     /cash-bids read). Only a current-delivery bid counts (spot, this month, this fall's new crop, or a range ending this
     month or next; never a later month or next year's new crop), only plain corn and soybeans (no Plenish, white, IP,
     organic or food grade), and only a board posted in the current or the previous trading session. n, low and high come
     from that same set. Each tile prints the cash price, the elevator on its own line, the distance and the basis with the
     board's own futures month (no month on file: no basis printed), when the board posted (components/bid-age.js
     ageLine, else "Posted 9:10 am") and the change against the same board's last bid on an earlier trading day
     (data/bids-prev/<ST>.json): "vs Thu's bid", or the date when that bid is older than the trading day before.
     Under them, one line: rain at the place in the 24 hours to the radar file's end (NOAA MRMS radar with gauges,
     data/radar-rain), left out when that end is more than 30 hours old.
   - No place: Iowa's median corn basis and its week's move (data/basis-states.json), and how many Corn Belt counties had
     0.10 in of rain in the 24 hours (data/radar-rain/county-<st>.json).
   - "Updated 9:16 am": when the file behind the two numbers was written, Central time, in grey; the dot beside it turns
     green only while that is under an hour old.

   THE WORLD (#fp-world), read when it comes near the screen. Every card: the topic and place, one number, one line on what it
   means, a dated source, a tap to the full tool. Feature cards carry a picture: bids (a map of the elevators around the reader,
   placed by distance and bearing, the best in gold; no place: soybean basis by state), rain, markets. Compact cards carry
   none: the latest top land sale, anhydrous from the USDA state report nearest the reader (data/fert-prices), ARC/PLC, funds.
   Soil (NCCPI, CSR2) joins once a county soil file exists; there is none yet, so no soil card, never an empty one. The Friday
   Chart card shows only when /infographic/latest.json names a chart from the last 13 days and its spot is below the screen.

   RULES
   - Each box holds a fixed height (css/home-front.css) and the copy is written to fit it; nothing is clamped or cut.
   - A file that does not answer leaves that card's own "could not read" line, never an old number.
   - Motion: a number counts up once from 90% of itself when it first shows, a line draws once; none with reduced motion.
   - Colour carries meaning only: green up, red down (a basis that rises is stronger, so green); a cost that rises is not
     good news, so a fertilizer move stays neutral.
   - The place never leaves the browser: every file read is a whole state, county set or the whole country.
   window.AgHomeFront (node: module.exports, test/index1-front.test.mjs; test/home-front.test.mjs is the old home's). */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var NET = 'https://dnilgis.github.io/bids/data/merged-index.json';
  var RADIUS = 50, RAIN_MAX_H = 30;
  var BELT = ['IA', 'IL', 'IN', 'OH', 'MN', 'NE', 'WI', 'MO', 'SD', 'KS', 'ND', 'MI'];
  var STN = { IA: 'Iowa', IL: 'Illinois', IN: 'Indiana', OH: 'Ohio', MN: 'Minnesota', NE: 'Nebraska', WI: 'Wisconsin', MO: 'Missouri',
    SD: 'South Dakota', KS: 'Kansas', ND: 'North Dakota', MI: 'Michigan', KY: 'Kentucky', TN: 'Tennessee', AR: 'Arkansas', OK: 'Oklahoma',
    TX: 'Texas', CO: 'Colorado', MT: 'Montana', PA: 'Pennsylvania', NY: 'New York', FL: 'Florida', NJ: 'New Jersey', VT: 'Vermont' };
  var MINUS = '−';
  /* plain corn and soybeans: a board's specialty rows never stand for the market */
  var SPECIAL = /plenish|white|\bip\b|identity|non.?gmo|organic|food|waxy|oleic|see.?mor|seed|blue|popcorn|canadian/i;

  function PXs() { return root.AgPxStamp || (typeof require === 'function' ? require('./price-local.js') : null); }
  function AGE() { return root.AgBidAge || (typeof require === 'function' ? require('./bid-age.js') : null); }

  /* ------------------------------------------------------------------ pure helpers (tested in node) */
  function num(x) { return typeof x === 'number' && isFinite(x); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ct(t) {
    var d = new Date(t);
    if (!isFinite(d.getTime())) return null;
    try {
      var p = {};
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short' })
        .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
      return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, wd: p.weekday };
    } catch (e) { return null; }
  }
  function isoOf(p) { return p.y + '-' + (p.m < 10 ? '0' : '') + p.m + '-' + (p.d < 10 ? '0' : '') + p.d; }
  function ctIso(t) { var p = ct(t); return p ? isoOf(p) : ''; }
  function hm(p) { var h = p.hh % 12 || 12; return h + ':' + (p.mm < 10 ? '0' : '') + p.mm + ' ' + (p.hh < 12 ? 'am' : 'pm'); }
  function dayNum(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : NaN; }
  function isoDay(n) { return new Date(n * 864e5).toISOString().slice(0, 10); }
  /* a moment in Central, as short as the day allows: "6:42 am" today, "Thu 9:10 pm" this week, "Nov 12" before */
  function when(t, now) {
    var p = ct(t), n = ct(now == null ? Date.now() : now);
    if (!p || !n) return '';
    var days = dayNum(isoOf(n)) - dayNum(isoOf(p));
    if (days === 0) return hm(p);
    if (days > 0 && days < 6) return p.wd + ' ' + hm(p);
    return MON[p.m - 1] + ' ' + p.d;
  }
  function md(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) : ''; }
  function dayName(iso) { var n = dayNum(iso); return isFinite(n) ? WD[new Date(n * 864e5).getUTCDay()] : ''; }
  function comma(n) { return Math.round(n).toLocaleString('en-US'); }
  function money(v, dp) { var s = Math.abs(v).toFixed(dp || 0).split('.'); return (v < 0 ? MINUS : '') + '$' + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (s[1] ? '.' + s[1] : ''); }
  /* cents like the pit: 3 -> "3¢", 1.25 -> "1¼¢", 0.5 -> "½¢" */
  function cents(c) { var q = Math.round(Math.abs(c) * 4), w = Math.floor(q / 4), f = q % 4; return (w || !f ? String(w) : '') + ['', '¼', '½', '¾'][f] + '¢'; }
  function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function miles(a, b, c, d) {
    var R = 3958.8, r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2);
    return R * 2 * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y));
  }
  /* trading days (components/price-local.js, the futures pages' calendar) */
  function prevTrading(iso) {
    var P = PXs(), n = dayNum(iso) - 1, k = 0;
    while (P && !P.isTradingDay(isoDay(n)) && k++ < 10) n--;
    return isoDay(n);
  }
  /* the first day a bid may be from: the session before the current (or last) one */
  function freshFrom(now) {
    var P = PXs(), today = ctIso(now == null ? Date.now() : now);
    var last = P && P.isTradingDay(today) ? today : prevTrading(today);
    return prevTrading(last);
  }
  /* a current-delivery period: spot, this month, this fall's new crop, or a range ending this month or next */
  function currentDelivery(period, now) {
    var p = String(period || ''), t = ct(now == null ? Date.now() : now);
    if (!t) return false;
    var ym = function (y, m) { return y + '-' + (m < 10 ? '0' : '') + m; };
    var cur = ym(t.y, t.m), next = t.m === 12 ? ym(t.y + 1, 1) : ym(t.y, t.m + 1), crop = t.m >= 9 ? t.y : t.y - 1;
    if (p === 'spot' || p === cur || p === 'newcrop-' + crop) return true;
    var r = /^(\d{4}-\d{2})\/(\d{4}-\d{2})$/.exec(p);
    return !!(r && r[1] <= cur && (r[2] === cur || r[2] === next));
  }
  function plain(crop, commodity) {
    var c = String(commodity || '');
    if (SPECIAL.test(c)) return false;
    return crop === 'corn' ? !/soy|bean|wheat|milo|sorghum/i.test(c) : !/corn|wheat|milo|sorghum/i.test(c);
  }
  /* the elevator as the network names it, written to fit one line: in full, else without the state, else the company */
  function placeName(p, max) {
    var city = String(p.town || p.city || '').trim(), st = String(p.state || '').trim(), op = String(p.operator || '').trim();
    if (city && op && city.toLowerCase() === op.toLowerCase()) city = '';
    city = city.replace(/,\s*[A-Za-z]{2}\s*$/, '');
    var c = [op && city ? op + ', ' + city + (st ? ', ' + st : '') : op || city, op && city ? op + ', ' + city : '', op];
    max = max || 38;
    for (var i = 0; i < c.length; i++) if (c[i] && c[i].length <= max) return c[i];
    return op || city;
  }
  /* the board's own futures month: "November '26 (2026-12)" -> "Dec"; none on file -> '' */
  function futMonth(delivery) { var m = /\((\d{4})-(\d{2})\)\s*$/.exec(String(delivery || '')); return m ? MON[+m[2] - 1] : ''; }
  /* basis with its month, or '' (never a basis without its month) */
  function basisWords(c, mon) {
    if (!num(c) || !mon) return '';
    if (Math.round(Math.abs(c) * 4) === 0) return 'even with ' + mon;
    return cents(c) + (c < 0 ? ' under ' : ' over ') + mon;
  }

  /* the bids within RADIUS miles, per crop: {best, nearest, n, lo, hi, rows: [{cash, d, lat, lon, name}]}, from one set:
     a current-delivery, plain-commodity bid in dollars from a board posted in the current or previous session */
  /* Nov 20, 2026: the one rule for a best bid (components/bid-filter.js isPlainCurrent) has the last word too;
     this page's own current-delivery and plain tests are stricter and stay. No rule loaded: no bids, never
     unfiltered ones. */
  function bidRule() {
    var w = typeof window !== 'undefined' && window.AG && window.AG.bidFilter;
    if (w && w.isPlainCurrent) return w;
    try { if (typeof module === 'object' && module.exports) return require('./bid-filter.js'); } catch (e) { /* none */ }
    return null;
  }
  function nearBids(idx, lat, lon, now) {
    var out = { corn: null, soybeans: null, generated: idx && idx.generated || '' }, BR = bidRule();
    if (!idx || !Array.isArray(idx.places) || !num(lat) || !num(lon) || !BR) return out;
    var t = now == null ? Date.now() : now, from = freshFrom(t);
    idx.places.forEach(function (p) {
      if (!p || !num(p.lat) || !num(p.lon) || (p.currency || 'USD') !== 'USD' || !p.now) return;
      var posted = p.pricedAt || p.checkedAt || '', pt = Date.parse(posted);
      if (!isFinite(pt) || pt - t > 36e5 || ctIso(pt) < from) return;
      var d = miles(lat, lon, p.lat, p.lon);
      if (d > RADIUS) return;
      ['corn', 'soybeans'].forEach(function (c) {
        var n = p.now[c];
        if (!n || !num(n.cash) || n.cash <= 0 || !currentDelivery(n.period, t) || !plain(c, n.commodity)) return;
        if (!BR.isPlainCurrent({ commodity: n.commodity || c, crop: c, cash: n.cash, period: n.period }, t)) return;
        var row = { cash: n.cash, basis: num(n.basisCents) ? n.basisCents : num(n.basis) ? n.basis * 100 : null, mon: futMonth(n.delivery), d: d,
          lat: p.lat, lon: p.lon, name: placeName(p), op: String(p.operator || ''), posted: posted, st: p.state, com: String(n.commodity || ''),
          key: p.place && n.period ? fnv(p.place + '|' + c + '|' + n.period) : '' };
        var o = out[c] || (out[c] = { best: null, nearest: null, n: 0, lo: Infinity, hi: -Infinity, rows: [] });
        o.n++; o.rows.push(row);
        if (n.cash < o.lo) o.lo = n.cash;
        if (n.cash > o.hi) o.hi = n.cash;
        if (!o.best || n.cash > o.best.cash || (n.cash === o.best.cash && d < o.best.d)) o.best = row;
        if (!o.nearest || d < o.nearest.d) o.nearest = row;
      });
    });
    return out;
  }
  /* the change against the same board's last bid on an earlier trading day: {c (cents), since (ISO), gap (older than the
     trading day before)} or null */
  function moveSince(prev, row) {
    var hist = prev && prev.rows && row && row.key ? prev.rows[row.key] : null, on = row && row.posted ? ctIso(row.posted) : '';
    if (!Array.isArray(hist) || !on) return null;
    /* an entry of another commodity (bids-prev's 4th field, Nov 20, 2026) is never the day before */
    var p = null, tag = String(row.com || '').toLowerCase().split(/\s+/).filter(Boolean).join(' ');
    hist.forEach(function (h) { if (h && h[0] < on && num(h[1]) && (h.length < 4 || row.com == null || h[3] === tag)) p = h; });
    if (!p) return null;
    return { c: Math.round((row.cash - p[1]) * 400) / 4, since: p[0], gap: p[0] < prevTrading(on) };
  }
  function moveText(m) {
    if (!m) return { t: '', c: 'nc' };
    var vs = m.gap ? 'vs ' + md(m.since) + ' bid' : 'vs ' + dayName(m.since) + '’s bid';
    if (Math.abs(m.c) < 0.125) return { t: 'Unchanged ' + vs, c: 'nc' };
    return { t: (m.c > 0 ? '▲ ' : '▼ ') + cents(m.c) + ' ' + vs, c: m.c > 0 ? 'up' : 'dn' };
  }
  /* when a board posted: bid-age.js's words between sessions, else "Posted 9:10 am" */
  function postedWords(posted, now) {
    var A = AGE(), a = null;
    try { a = A && A.ageLine ? A.ageLine(posted, new Date(now == null ? Date.now() : now)) : null; } catch (e) { a = null; }
    if (a && a.text) return a.text.replace(/\.$/, '');
    var w = when(posted, now);
    return w ? 'Posted ' + w : '';
  }
  /* a state's network basis for a crop: {cents, wow (cents), n, co, mon, lo, hi, name, gen} or null */
  function stateBasis(B, st, crop) {
    var s = B && B.states && B.states[st], c = s && s.crops && s.crops[crop];
    if (!c || !num(c.median) || !(c.n >= ((B && B.min_n) || 3))) return null;
    return { cents: Math.round(c.median * 100), wow: num(c.wow) ? Math.round(c.wow * 100) : null, n: c.n, co: c.companies || null,
      mon: String(c.label || '').split(' ')[0], lo: num(c.lo) ? Math.round(c.lo * 100) : null, hi: num(c.hi) ? Math.round(c.hi * 100) : null,
      name: s.name || st, gen: B.generated || '' };
  }
  /* Corn Belt county rain counts from the county files: window 0 = 24 hours, 1 = 7 days */
  function beltRain(files, w) {
    var out = { n: 0, of: 0, states: [], end: '' };
    (files || []).forEach(function (f) {
      if (!f || !f.counties) return;
      var n = 0, of = 0;
      Object.keys(f.counties).forEach(function (k) { var v = f.counties[k]; if (!v || !num(v[w])) return; of++; if (v[w] >= 10) n++; });
      if (!of) return;
      out.n += n; out.of += of; out.states.push({ st: f.st, share: n / of });
      if (!out.end || String(f.data_end) < out.end) out.end = String(f.data_end || '');
    });
    return out.of ? out : null;
  }
  /* the rain line under the bids: "Rain here: 0.00 in, the 24 h to 6 am", or '' when the file ends over 30 hours ago */
  function rainLine(r, now) {
    var t = now == null ? Date.now() : now, e = Date.parse(r && r.end || '');
    if (!r || !num(r.w && r.w[0]) || !isFinite(e) || t - e > RAIN_MAX_H * 36e5) return '';
    return 'Rain here: <b>' + (r.w[0] / 100).toFixed(2) + ' in</b>, the 24 h to ' + esc(when(r.end, t));
  }
  /* the price strip's file, read with price-local.js's rules: corn and soybeans, the overnight move in the overnight hours */
  function futItems(P, now) {
    var PX = PXs();
    if (!P || !P.quotes || !PX) return null;
    var t = now == null ? Date.now() : now, Q = PX.roll(P.quotes, new Date(t)), nb = P.nearby || {}, out = [], stamp = '', ovn = PX.ovnWindow(new Date(t));
    ['corn', 'beans'].forEach(function (k) {
      var key = nb[k] && nb[k].key, q = (key && Q[key]) || Q[k];
      if (!q || !num(q.close)) return;
      var name = (PX.label(q.ticker) || '').split(' ')[0] + ' ' + (k === 'corn' ? 'corn' : 'beans');
      var o = ovn ? PX.overnight(q) : null, net = null;
      if (o && num(o.net)) { net = o.net; if (!stamp) stamp = 'overnight, ' + when(o.at, t); }
      else { var ch = PX.change(q, key); net = ch ? ch.net : null; if (!stamp) stamp = PX.shortStamp(q, P.fetched, new Date(t)); }
      out.push({ name: name, px: q.close, net: net, ovn: !!(o && num(o.net)), day: String(q.close_date || '') });
    });
    return out.length ? { items: out, stamp: stamp } : null;
  }
  /* where a price sits in the 5 years of weekly closes, at the price shown: "Lower than 7 of every 10 weeks since 2021" */
  function rankWords(hist, px, since) {
    var h = (hist || []).filter(num);
    if (h.length < 52 || !num(px)) return '';
    var above = h.filter(function (v) { return v > px; }).length / h.length;
    return above >= 0.5 ? 'Lower than ' + Math.round(above * 10) + ' of every 10 weeks since ' + since :
      'Higher than ' + Math.round((1 - above) * 10) + ' of every 10 weeks since ' + since;
  }
  /* the Daily's date, written "Friday, November 20, 2026" (or ISO) -> "2026-11-20" */
  var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  function dailyIso(s) {
    var t = String(s || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    var m = /([A-Za-z]+) (\d{1,2}), (\d{4})/.exec(t), i = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
    return i < 0 ? '' : m[3] + '-' + (i < 9 ? '0' : '') + (i + 1) + '-' + (+m[2] < 10 ? '0' : '') + (+m[2]);
  }
  /* a dry week at a place: the 24 h, 3 day and 7 day windows all zero -> the words the file supports (it carries windows,
     not days, so the last rain is said as "none since" the 7-day window's start), else '' */
  function dryWords(r) {
    var w = r && r.w;
    if (!w || w[0] !== 0 || w[1] !== 0 || w[2] !== 0 || !r.weekStart) return '';
    return 'No rain since <b>' + md(ctIso(r.weekStart)) + '</b>, the 7 days to ' + esc(when(r.end)) + '.';
  }
  /* the Daily band's line: a row-crop story for this page (the headline, else the first section that is not livestock), or '' */
  var STOCK = /\b(hogs?|cattle|cows?|pork|beef|milk|dairy|lambs?|feeders?|livestock|cutout|broilers?|eggs?)\b/i;
  function dailyLine(j) {
    if (!j) return '';
    if (j.headline && !STOCK.test(j.headline)) return String(j.headline);
    var s = (j.sections || []).filter(function (x) { return x && x.title && !STOCK.test(x.title); })[0];
    return s ? String(s.title) : '';
  }
  /* fertilizer: the USDA state report for a state (data/fert-prices/index.json nearest), Iowa's for no place */
  function fertReportId(I, st) {
    if (!st) return '2863';
    var n = I && I.nearest && I.nearest[st];
    return n && n.id ? String(n.id) : null;
  }
  function fertCopy(R) {
    var p = (R && R.products || []).filter(function (x) { return x.key === 'anhydrous' && num(x.avg); })[0];
    if (!p) return null;
    var v = p.avg, s = esc(R.region) + ' dealers’ average, a ton.';
    if (p.prev && num(p.prev.change) && p.prev.published) {
      var c = Math.round(p.prev.change);
      s += c === 0 ? ' Unchanged since ' + md(p.prev.published) + '.' : ' ' + (c > 0 ? 'Up ' : 'Down ') + money(Math.abs(c)) + ' since ' + md(p.prev.published) + '.';
    }
    return { v: v, s: s, src: 'USDA AMS, ' + md(R.published), region: R.region };
  }
  /* funds: managed money's net and the week's change, corn's too */
  function fundCopy(C) {
    var s = C && C.beans, c = C && C.corn;
    if (!s || !num(s.net) || !num(s.prev)) return null;
    var w = function (x) { var ch = x.net - x.prev; return (ch < 0 ? 'sold ' : 'bought ') + comma(Math.abs(ch)); };
    var side = s.net >= 0 ? 'Net long' : 'Net short';
    var t = side + '; ' + w(s) + '.';
    if (c && num(c.net) && num(c.prev)) t += ' Corn: ' + w(c) + ', now ' + comma(Math.abs(c.net)) + (c.net < 0 ? ' short.' : ' long.');
    var rd = /^([A-Za-z]+) (\d{1,2}), \d{4}$/.exec(String(C.report_date || ''));
    return { v: Math.abs(s.net), s: t, src: 'CFTC, week to ' + (rd ? rd[1].slice(0, 3) + ' ' + rd[2] : '') };
  }
  /* land: the latest top sale, its county named in the sentence */
  function landCopy(L, pick) {
    var r = pick && pick.lead;
    if (!r) return null;
    var a = r.acres >= 100 ? Math.round(r.acres) : Math.round(r.acres * 10) / 10;
    var s = 'An acre: ' + a + ' acres in ' + r.county + ' County, ' + pick.st + ', ' + md(r.when) + '.';
    var name = STN[pick.st] || pick.st, mine = pick.mine && !pick.covered ? STN[pick.mine] || pick.mine : '';
    var src = mine ? 'No ' + mine + ' sale on file yet. ' + name + ' records.' : String(r.src || name + ' records');
    return { v: r.ppa, s: s, src: src, href: r.url };
  }

  /* ------------------------------------------------------------------ pictures (inline SVG, drawn at the box's own width) */
  var W = 320;
  function svgOpen(H, label) { return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(label) + '">'; }
  function spark(vals, opt) {
    opt = opt || {};
    var H = opt.H || 96, lo = Math.min.apply(null, vals.concat(opt.zero ? [0] : [])), hi = Math.max.apply(null, vals.concat(opt.zero ? [0] : [])), span = hi - lo || 1, n = vals.length;
    var top = 8, bot = opt.labels ? H - 18 : H - 4, y = function (v) { return bot - (v - lo) / span * (bot - top); };
    var pts = vals.map(function (v, i) { return [n > 1 ? 5 + i * (W - 10) / (n - 1) : W / 2, y(v)]; });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('');
    var e = pts[n - 1], h = svgOpen(H, opt.label || '');
    if (opt.zero && lo < 0 && hi > 0) h += '<line class="fp-g-zero" x1="0" x2="' + W + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '"></line>';
    h += '<path class="fp-g-area" d="' + d + 'L' + e[0].toFixed(1) + ' ' + bot + 'L' + pts[0][0].toFixed(1) + ' ' + bot + 'Z"></path>';
    h += '<path class="fp-g-line" d="' + d + '"></path><circle class="fp-g-end" cx="' + e[0].toFixed(1) + '" cy="' + e[1].toFixed(1) + '" r="4"></circle>';
    if (opt.labels) h += '<text class="fp-g-t" x="1" y="' + (H - 2) + '">' + esc(opt.labels[0]) + '</text><text class="fp-g-t is-me" x="' + (W - 1) + '" y="' + (H - 2) + '" text-anchor="end">' + esc(opt.labels[1]) + '</text>';
    return h + '</svg>';
  }
  /* bars: [{k, v (0..1), me}], each label under its bar */
  function bars(items, label, H) {
    H = H || 140;
    var n = items.length, gap = n > 6 ? 5 : 12, bw = (W - gap * (n - 1)) / n, base = H - 18, h = svgOpen(H, label);
    items.forEach(function (it, i) {
      var x = i * (bw + gap), bh = Math.max(2, Math.round(it.v * (base - 6)));
      h += '<rect class="fp-g-bar' + (it.me ? ' is-me' : '') + '" x="' + x.toFixed(1) + '" y="' + (base - bh) + '" width="' + bw.toFixed(1) + '" height="' + bh + '" rx="2"></rect>' +
        '<text class="fp-g-t' + (it.me ? ' is-me' : '') + '" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 2) + '" text-anchor="middle">' + esc(it.k) + '</text>';
    });
    return h + '</svg>';
  }
  /* ranges: [{k, lo, hi, med, me}] on one scale, a state's low to high with its middle as a dot */
  function ranges(items, label, H) {
    H = H || 140;
    var lo = Math.min.apply(null, items.map(function (r) { return r.lo; })), hi = Math.max.apply(null, items.map(function (r) { return r.hi; })), span = hi - lo || 1;
    var cw = W / items.length, base = H - 20, y = function (v) { return base - (v - lo) / span * (base - 8); }, h = svgOpen(H, label);
    items.forEach(function (r, i) {
      var cx = (i + 0.5) * cw;
      h += '<line class="fp-g-rng" x1="' + cx.toFixed(1) + '" x2="' + cx.toFixed(1) + '" y1="' + y(r.lo).toFixed(1) + '" y2="' + y(r.hi).toFixed(1) + '"></line>' +
        '<circle class="fp-g-med" cx="' + cx.toFixed(1) + '" cy="' + y(r.med).toFixed(1) + '" r="' + (r.me ? 5.5 : 4) + '"></circle>' +
        '<text class="fp-g-t' + (r.me ? ' is-me' : '') + '" x="' + cx.toFixed(1) + '" y="' + (H - 2) + '" text-anchor="middle">' + esc(r.k) + '</text>';
    });
    return h + '</svg>';
  }
  /* the bids around the reader: each elevator a dot at its distance and bearing (rings at 25 and 50 mi), shaded and sized by
     its cash bid, the best in gold, the nearest named */
  function bidsMap(o, lat, lon, H) {
    H = H || 140;
    var cx = W / 2, cy = H / 2, R = H / 2 - 8, k = R / RADIUS, cosl = Math.cos(lat * Math.PI / 180), span = (o.hi - o.lo) || 1;
    var pos = function (r) { return [cx + (r.lon - lon) * 69.17 * cosl * k, cy - (r.lat - lat) * 69.17 * k]; };
    var h = svgOpen(H, 'Each corn bid within 50 miles, placed by distance and direction from you, the best in gold');
    [25, 50].forEach(function (m) { h += '<circle class="fp-g-zero" cx="' + cx + '" cy="' + cy + '" r="' + (m * k).toFixed(1) + '"></circle>'; });
    h += '<text class="fp-g-t" x="' + (cx + 50 * k * 0.71 + 3).toFixed(1) + '" y="' + (cy - 50 * k * 0.71).toFixed(1) + '">50 mi</text>';
    o.rows.slice().sort(function (a, b) { return a.cash - b.cash; }).forEach(function (r) {
      if (r === o.best) return;
      var p = pos(r), t = (r.cash - o.lo) / span;
      h += '<circle class="fp-g-pt" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + (3 + t * 2.5).toFixed(1) + '" style="opacity:' + (0.3 + t * 0.55).toFixed(2) + '"></circle>';
    });
    h += '<circle class="fp-g-you" cx="' + cx + '" cy="' + cy + '" r="4"></circle><text class="fp-g-t is-me" x="' + cx + '" y="' + (cy + 16) + '" text-anchor="middle">you</text>';
    var b = pos(o.best), bl = b[0] > cx;
    h += '<circle class="fp-g-pt is-me" cx="' + b[0].toFixed(1) + '" cy="' + b[1].toFixed(1) + '" r="7"></circle>';
    var short = function (r) { var s = r.op.split(/\s+/).slice(0, 2).join(' '); return s.length > 16 ? r.op.split(/\s+/)[0] : s; };
    h += '<text class="fp-g-t is-me" x="' + (b[0] + (bl ? 11 : -11)).toFixed(1) + '" y="' + (b[1] + 4).toFixed(1) + '" text-anchor="' + (bl ? 'start' : 'end') + '">best, ' + esc(short(o.best)) + '</text>';
    if (o.nearest && o.nearest !== o.best && o.nearest.op !== o.best.op) {
      var q = pos(o.nearest), ql = q[0] <= cx;
      h += '<text class="fp-g-t" x="' + (q[0] + (ql ? -9 : 9)).toFixed(1) + '" y="' + (q[1] + 4 + (Math.abs(q[1] - b[1]) < 14 ? 14 : 0)).toFixed(1) + '" text-anchor="' + (ql ? 'end' : 'start') + '">nearest, ' + esc(short(o.nearest)) + '</text>';
    }
    return h + '</svg>';
  }
  function setW(w) { W = w > 120 ? Math.round(w) : 320; }

  var api = { ct: ct, ctIso: ctIso, when: when, md: md, dayName: dayName, fnv: fnv, miles: miles, placeName: placeName, futMonth: futMonth,
    basisWords: basisWords, currentDelivery: currentDelivery, plain: plain, freshFrom: freshFrom, prevTrading: prevTrading, nearBids: nearBids,
    moveSince: moveSince, moveText: moveText, postedWords: postedWords, stateBasis: stateBasis, beltRain: beltRain, rainLine: rainLine,
    futItems: futItems, rankWords: rankWords, dailyIso: dailyIso, dryWords: dryWords, dailyLine: dailyLine, fertReportId: fertReportId, fertCopy: fertCopy, fundCopy: fundCopy,
    landCopy: landCopy, spark: spark, bars: bars, ranges: ranges, bidsMap: bidsMap, setW: setW, BELT: BELT, RADIUS: RADIUS, cents: cents };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (!root || !root.document) return;
  root.AgHomeFront = api;

  /* ------------------------------------------------------------------ the page */
  var d = root.document, hero = d.getElementById('fp-hero');
  if (!hero) return;
  var still = false;
  try { still = root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  function $(id) { return d.getElementById(id); }
  function get(u) { return root.AG && root.AG.json ? root.AG.json(u) : root.fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function text(u) { return root.AG && root.AG.text ? root.AG.text(u) : root.fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }); }
  function px(dollars) { var P = root.AG && root.AG.px; return P ? P.priceDollars(dollars, { fracClass: 'fp-fr' }) : esc('$' + dollars.toFixed(2)); }
  function pxT(dollars) { return px(dollars).replace(/<[^>]+>/g, ''); }
  function mv(c) { var P = root.AG && root.AG.px; return P ? P.move(c, { sign: true }) : (c > 0 ? '+' : '') + cents(c); }
  function load(src, name) {
    if (root[name]) return Promise.resolve(root[name]);
    return new Promise(function (ok, no) {
      var s = d.createElement('script'); s.src = src; s.async = true;
      s.onload = function () { root[name] ? ok(root[name]) : no(new Error('no ' + name)); };
      s.onerror = function () { no(new Error('no ' + name)); };
      d.head.appendChild(s);
    });
  }
  var once = {};
  function memo(k, f) { return once[k] || (once[k] = f().catch(function (e) { delete once[k]; throw e; })); }
  function fitH() {
    var e = $('fp-h'); if (!e) return;
    e.style.fontSize = '';
    var f = parseFloat(root.getComputedStyle(e).fontSize);
    while (e.scrollWidth > e.clientWidth + 1 && f > 18) { f -= 1; e.style.fontSize = f + 'px'; }
  }

  /* the number counts up once from 90% of itself, the first time it is on screen; its width is held */
  var seen = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { seen.unobserve(e.target); if (e.target._fpRun) e.target._fpRun(); } });
  }, { threshold: 0.5 }) : null;
  function tick(node, n, fmt) {
    if (still || !seen || !node || !num(n) || n <= 0 || !root.requestAnimationFrame) return;
    var end = node.innerHTML;
    node.style.display = 'inline-block'; node.style.width = Math.ceil(node.getBoundingClientRect().width) + 'px';
    node._fpRun = function () {
      var t0 = 0;
      function step(t) {
        if (!t0) t0 = t;
        var q = Math.min(1, (t - t0) / 600), e = 1 - Math.pow(1 - q, 3);
        if (q < 1) { node.textContent = fmt(n * (0.9 + 0.1 * e)); root.requestAnimationFrame(step); } else node.innerHTML = end;
      }
      root.requestAnimationFrame(step);
    };
    seen.observe(node);
  }
  function draw(box) {
    if (still || !seen) return;
    var p = box.querySelector('.fp-g-line');
    if (!p || !p.getTotalLength) return;
    var svg = p.ownerSVGElement;
    svg.style.setProperty('--len', String(Math.ceil(p.getTotalLength())));
    svg._fpRun = function () { svg.classList.add('fp-draw'); };
    seen.observe(svg);
  }

  /* ---------------- the place */
  function place() {
    var A = root.AgSavedPlace;
    if (!A || !A.read || !A.read()) return Promise.resolve(null);
    return Promise.resolve(A.full ? A.full() : A.read()).then(function (p) {
      if (!p || !p.zip || p.lat == null || !p.town) return null;
      var raw = ''; try { raw = String((JSON.parse(root.localStorage.getItem('agsist-wx-loc') || 'null') || {}).county || ''); } catch (e) {}
      p.countyRaw = raw && A.county && A.county(raw) === p.county ? raw : p.county;
      return p;
    }).catch(function () { return null; });
  }

  /* ---------------- shared reads */
  function bidsAt(p) {
    return memo('net', function () { return get(NET); }).then(function (idx) {
      var b = nearBids(idx, p.lat, p.lon, Date.now()), sts = {};
      ['corn', 'soybeans'].forEach(function (c) { if (b[c] && b[c].best && b[c].best.st) sts[b[c].best.st] = 1; });
      return Promise.all(Object.keys(sts).map(function (s) { return get('/data/bids-prev/' + s + '.json').then(function (j) { return [s, j]; }, function () { return [s, null]; }); }))
        .then(function (list) { var by = {}; list.forEach(function (x) { by[x[0]] = x[1]; }); b.prev = by; return b; });
    });
  }
  function rainAt(p) {
    return memo('rain:' + p.lat + ',' + p.lon, function () {
      return Promise.all([get('/data/radar-rain/index.json'), load('/components/radar-rain.js?v=1', 'AgRadarRain')]).then(function (a) {
        var idx = a[0], R = a[1], st = R.pickState(idx, p.lat, p.lon);
        if (!st) throw new Error('outside');
        return root.fetch('/data/radar-rain/' + st.toLowerCase() + '.bin').then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(R.parse).then(function (f) {
          var w = ['24h', '3d', '7d', 'month'].map(function (k) { return R.lookup(f.header, f.grids[k], p.lat, p.lon); });
          if (w[0] == null) throw new Error('no data');
          return { w: w, end: idx.data_end, monthStart: idx.windows && idx.windows.month && idx.windows.month.start, weekStart: idx.windows && idx.windows['7d'] && idx.windows['7d'].start };
        });
      });
    });
  }
  function belt() {
    return memo('belt', function () {
      return Promise.all(BELT.map(function (s) { return get('/data/radar-rain/county-' + s.toLowerCase() + '.json').catch(function () { return null; }); })).then(function (fs) {
        if (!fs.some(Boolean)) throw new Error('none');
        return fs;
      });
    });
  }

  /* ---------------- the answer */
  function tile(i, o) {
    var v = $('fp-t' + i + '-v');
    v.innerHTML = '<span class="fp-n">' + o.v + '</span>' + (o.u ? '<span class="fp-u">' + esc(o.u) + '</span>' : '');
    var m = $('fp-t' + i + '-m'); m.textContent = o.m || ''; m.className = 'fp-m ' + (o.mc || '');
    $('fp-t' + i + '-w').innerHTML = o.w || '';
    $('fp-t' + i + '-w2').innerHTML = o.w2 || '';
    $('fp-t' + i + '-age').textContent = o.age || '';
    if (o.n != null) tick(v.firstChild, o.n, o.f);
  }
  function tileFail(i, a, b) { tile(i, { v: '<span class="fp-none">No reading</span>', w: esc(a), w2: esc(b || '') }); }
  function stamp(t) {
    var u = $('fp-upd'), l = $('fp-live'), ms = Date.parse(t || '');
    if (!isFinite(ms)) { u.textContent = 'Could not read this morning’s files'; l.classList.remove('is-fresh'); return; }
    u.textContent = 'Updated ' + when(ms);
    l.classList.toggle('is-fresh', Date.now() - ms < 60 * 6e4);
  }
  function bidTile(i, c, crop, p) {
    var o = c && c[crop], nm = crop === 'corn' ? 'corn' : 'soybean';
    if (!o || !o.best) { tileFail(i, 'No current ' + nm + ' bid within 50 mi', 'on our elevator network today.'); return; }
    var b = o.best, m = moveText(moveSince(c.prev && c.prev[b.st], b)), bw = basisWords(b.basis, b.mon);
    tile(i, { v: px(b.cash), m: m.t, mc: m.c, n: b.cash, f: function (x) { return '$' + x.toFixed(2); },
      w: '<b>' + esc(b.name) + '</b>', w2: Math.round(b.d) + ' mi away' + (bw ? ' · ' + esc(bw) : ''), age: postedWords(b.posted) });
  }
  function freshLabels() {
    hero.classList.remove('fp-saved');
    $('fp-where').textContent = 'Farm country'; $('fp-set').textContent = 'Set your place';
    $('fp-t1-k').textContent = 'Iowa corn basis'; $('fp-t2-k').textContent = 'Corn Belt rain, 24 hours';
    $('fp-t1').setAttribute('href', '/basis'); $('fp-t2').setAttribute('href', '/rain');
    fitH();
  }
  function savedLabels(p) {
    hero.classList.add('fp-saved');
    $('fp-where').textContent = 'Near ' + p.town + (p.state ? ', ' + p.state : ''); $('fp-set').textContent = 'Change place';
    $('fp-t1-k').textContent = 'Best corn bid, 50 mi'; $('fp-t2-k').textContent = 'Best soybean bid, 50 mi';
    $('fp-t1').setAttribute('href', '/cash-bids'); $('fp-t2').setAttribute('href', '/cash-bids');
    fitH();
  }
  function answerSaved(p) {
    $('fp-line').innerHTML = '';
    bidsAt(p).then(function (b) { bidTile(1, b, 'corn', p); bidTile(2, b, 'soybeans', p); stamp(b.generated); })
      .catch(function () { tileFail(1, 'Could not read the elevator bids', 'just now. Try again in a minute.'); tileFail(2, 'Could not read the elevator bids', 'just now. Try again in a minute.'); stamp(null); });
    rainAt(p).then(function (x) { $('fp-line').innerHTML = rainLine(x); }, function () { $('fp-line').innerHTML = ''; });
  }
  function answerFresh() {
    $('fp-line').textContent = 'Set your place for the best bids within 50 mi of you.';
    get('/data/basis-states.json').then(function (B) {
      var s = stateBasis(B, 'IA', 'corn');
      if (!s) throw new Error('none');
      var w = s.wow == null ? { t: '', c: 'nc' } : Math.abs(s.wow) < 0.5 ? { t: 'Flat on the week', c: 'nc' } :
        { t: (s.wow > 0 ? '▲ ' : '▼ ') + cents(s.wow) + ' on the week', c: s.wow > 0 ? 'up' : 'dn' };
      tile(1, { v: esc(String(Math.abs(s.cents))) + '¢', u: (s.cents < 0 ? 'under ' : 'over ') + s.mon, m: w.t, mc: w.c, n: Math.abs(s.cents), f: function (x) { return Math.round(x) + '¢'; },
        w: 'Middle of <b>' + comma(s.n) + '</b> Iowa elevators’ bids', w2: 'Cash minus ' + esc(s.mon) + ' futures', age: 'Elevator boards, ' + when(s.gen) });
      stamp(s.gen);
    }).catch(function () { tileFail(1, 'Could not read the basis file', 'just now. Try again in a minute.'); stamp(null); });
    belt().then(function (fs) {
      var b = beltRain(fs, 0);
      if (!b) throw new Error('none');
      tile(2, { v: comma(b.n), u: b.n === 1 ? 'county' : 'counties', m: 'had 0.10 in or more', mc: 'nc', n: b.n, f: comma,
        w: 'Of <b>' + comma(b.of) + '</b> Corn Belt counties', w2: 'NOAA radar with rain gauges', age: 'The 24 h to ' + when(b.end) });
    }).catch(function () { tileFail(2, 'Could not read the radar file', 'just now. Try again in a minute.'); });
  }

  /* ---------------- the world */
  function card(id, o) {
    var box = $('fp-c-' + id);
    if (!box) return;
    var g = $('fp-c-' + id + '-g');
    $('fp-c-' + id + '-k').innerHTML = o.k || esc(box.getAttribute('data-k0') || '');
    var v = $('fp-c-' + id + '-v');
    v.innerHTML = '<span class="fp-n">' + o.v + '</span>' + (o.u ? '<span class="fp-u">' + esc(o.u) + '</span>' : '');
    $('fp-c-' + id + '-s').innerHTML = o.s || '';
    if (g) g.innerHTML = o.g || '';
    $('fp-c-' + id + '-src').textContent = o.src || '';
    if (o.href) box.setAttribute('href', o.href);
    box.classList.remove('is-off');
    if (o.n != null) tick(v.firstChild, o.n, o.f);
    draw(box);
  }
  function cardFail(id, words) {
    var box = $('fp-c-' + id);
    if (!box) return;
    box.classList.add('is-off');
    $('fp-c-' + id + '-k').textContent = box.getAttribute('data-k0') || '';
    $('fp-c-' + id + '-v').textContent = 'Could not read';
    $('fp-c-' + id + '-s').textContent = words;
    $('fp-c-' + id + '-src').textContent = '';
    var g = $('fp-c-' + id + '-g'); if (g) g.innerHTML = '';
  }
  function gw(id) { var g = $('fp-c-' + id + '-g'); setW(g ? g.getBoundingClientRect().width : 0); }
  var placeK = function (topic, p) { return esc(topic) + (p ? ' · <b>' + esc(p.town) + '</b>' : ''); };

  function bidsCard(p) {
    if (p) {
      return bidsAt(p).then(function (b) {
        var c = b.corn;
        if (!c || !c.best) { cardFail('bids', 'No current corn bid within 50 mi of ' + p.town + ' on our network today.'); return; }
        gw('bids');
        card('bids', { k: placeK('Corn bids around', p), v: comma(c.n), u: c.n === 1 ? 'elevator' : 'elevators', n: c.n, f: comma,
          s: 'Corn bids within 50 mi range <b>' + px(c.lo) + '</b> to <b>' + px(c.hi) + '</b>. Gold is the best bid.',
          g: bidsMap(c, p.lat, p.lon, 140), src: 'Elevator boards, read ' + when(b.generated), href: '/cash-bids' });
      }).catch(function () { cardFail('bids', 'Could not read the elevator bids just now.'); });
    }
    return get('/data/basis-states.json').then(function (B) {
      var rs = [];
      ['IA', 'IL', 'IN', 'OH', 'MN', 'NE', 'SD', 'KS', 'MO', 'WI'].forEach(function (st) { var s = stateBasis(B, st, 'soybeans'); if (s && s.lo != null && s.hi != null) rs.push({ k: st, lo: s.lo, hi: s.hi, med: s.cents, me: st === 'IA', s: s }); });
      var ia = rs.filter(function (r) { return r.me; })[0];
      if (!ia) throw new Error('none');
      gw('bids');
      card('bids', { k: 'Soybean basis · <b>Corn Belt</b>', v: cents(ia.med), u: (ia.med < 0 ? 'under ' : 'over ') + ia.s.mon + ', Iowa', n: Math.abs(ia.med), f: function (x) { return Math.round(x) + '¢'; },
        s: 'Middle Iowa soybean bid of ' + comma(ia.s.n) + ' elevators. Each line: a state, low bid to high.',
        g: ranges(rs, 'Soybean basis by state, low to high, with the middle', 140), src: 'Elevator boards, ' + md(ctIso(B.generated)), href: '/basis' });
    }).catch(function () { cardFail('bids', 'Could not read the basis file just now.'); });
  }
  function rainCard(p) {
    if (p) {
      return rainAt(p).then(function (x) {
        var w = x.w, top = Math.max.apply(null, w.map(function (v) { return v || 0; })) || 1, ms = x.monthStart ? ctIso(x.monthStart) : '';
        gw('rain');
        var dry = dryWords(x);
        card('rain', { k: placeK('Rain', p), v: w[3] == null ? '0.00' : (w[3] / 100).toFixed(2), u: 'in since ' + (ms ? md(ms) : 'the 1st'), n: w[3] != null ? w[3] / 100 : null, f: function (v) { return v.toFixed(2); },
          s: dry ? dry : '<b>' + (w[0] / 100).toFixed(2) + ' in</b> in the 24 h to ' + esc(when(x.end)) + ', <b>' + (w[2] == null ? 'no reading' : (w[2] / 100).toFixed(2) + ' in') + '</b> over 7 days.',
          g: dry ? bars([{ k: (ms ? md(ms) : 'The 1st') + ' to ' + md(ctIso(x.end)) + ': ' + (w[3] / 100).toFixed(2) + ' in, none in the last 7 days', v: w[3] > 0 ? 1 : 0, me: true }], 'Rain this month; none in the last 7 days', 140) : bars([{ k: '24 h', v: (w[0] || 0) / top }, { k: '3 days', v: (w[1] || 0) / top }, { k: '7 days', v: (w[2] || 0) / top }, { k: ms ? MON[+ms.slice(5, 7) - 1] : 'Month', v: (w[3] || 0) / top, me: true }], 'Rain at this place by window', 140),
          src: 'NOAA radar, to ' + when(x.end), href: '/rain#fields' });
      }).catch(function () { cardFail('rain', 'Could not read the radar file just now.'); });
    }
    return belt().then(function (fs) {
      var b = beltRain(fs, 1);
      if (!b) throw new Error('none');
      b.states.sort(function (x, y) { return BELT.indexOf(x.st) - BELT.indexOf(y.st); });
      var top = Math.max(0.25, Math.max.apply(null, b.states.map(function (x) { return x.share; })));
      gw('rain');
      card('rain', { k: 'Rain · <b>12 Corn Belt states</b>', v: comma(b.n), u: b.n === 1 ? 'county' : 'counties', n: b.n, f: comma,
        s: 'had 0.10 in or more in the 7 days to ' + esc(when(b.end)) + ', of ' + comma(b.of) + '. Bars: each state’s share.',
        g: bars(b.states.map(function (s) { return { k: s.st, v: s.share / top }; }), 'Share of each state’s counties with 0.10 in in 7 days', 140),
        src: 'NOAA radar, to ' + when(b.end), href: '/rain#radar' });
    }).catch(function () { cardFail('rain', 'Could not read the radar file just now.'); });
  }
  function mktCard() {
    return Promise.all([get('/data/prices.json'), get('/data/price-stats.json').catch(function () { return null; })]).then(function (a) {
      var F = futItems(a[0]), S = a[1], cs = S && S.corn;
      if (!F) throw new Error('none');
      var c = F.items[0], s = F.items[1], p = c.px / 100;
      var since = cs && num(cs.years) && S.updated ? (+S.updated.slice(0, 4) - cs.years) : '';
      var hist = cs && Array.isArray(cs.hist) ? cs.hist.filter(num) : [];
      var when0 = c.ovn ? ' overnight.' : c.day === ctIso(Date.now()) ? ' today.' : ' ' + dayName(c.day) + '.';
      var chg = num(c.net) ? '<span class="' + (c.net > 0 ? 'up' : c.net < 0 ? 'dn' : 'nc') + '">' + esc(c.net === 0 ? 'Unchanged' : mv(c.net)) + '</span>' + when0 + ' ' : '';
      var rank = since ? rankWords(hist, p, since) : '';
      var last = hist.slice(-52).concat([p]), startDay = S && S.updated ? isoDay(dayNum(S.updated) - 357) : '';
      gw('mkt');
      card('mkt', { k: esc(c.name.replace(' corn', '')) + ' corn · <b>CBOT</b>', v: px(p), n: p, f: function (x) { return '$' + x.toFixed(2); },
        s: chg + (rank ? rank + '.' : '') + (s ? ' ' + esc(s.name) + ' <b>' + px(s.px / 100) + '</b>.' : ''),
        g: last.length > 10 ? spark(last, { H: 96, label: 'Corn futures, weekly closes for a year and the price now', labels: [startDay ? MON[+startDay.slice(5, 7) - 1] + ' ’' + startDay.slice(2, 4) : '', md(c.day)] }) : '',
        src: 'CBOT, ' + F.stamp.replace(/^Read /, 'read ').replace(/ CT\b/, '').replace(/,? delayed$/, ''), href: '/corn-futures-prices' });
    }).catch(function () { cardFail('mkt', 'Could not read the price file just now.'); });
  }
  function fcCard() {
    var F = root.AgHomeFridayChart, box = $('fp-c-fc');
    return get('/infographic/latest.json').then(function (lt) {
      var c = F && F.pick ? F.pick(lt, F.chicagoToday()) : null;
      if (!c || !box) return;
      var next = $('fp-c-mkt'), top = next ? next.getBoundingClientRect().bottom : 0;
      if (top < root.innerHeight) return;
      $('fp-c-fc-img').src = c.img; $('fp-c-fc-img').alt = c.alt;
      $('fp-c-fc-k').innerHTML = 'Friday Chart · <b>' + esc(c.shown.replace(/, \d{4}$/, '')) + '</b>';
      $('fp-c-fc-s').textContent = c.title; $('fp-c-fc-src').textContent = 'AGSIST, ' + c.shown;
      box.setAttribute('href', c.href); box.hidden = false; even();
    }).catch(function () {});
  }
  function landCard(p) {
    var L = root.AgHomeLand;
    return get('/data/land-sales/lead.json').then(function (j) {
      var o = landCopy(j, L && L.pick(j, p && p.state || '', new Date()));
      if (!o) throw new Error('none');
      card('land', { v: money(o.v), n: o.v, f: function (x) { return money(x); }, s: esc(o.s), src: o.src, href: o.href });
    }).catch(function () { cardFail('land', 'Could not read the farm sales file just now.'); });
  }
  function fertCard(p) {
    return get('/data/fert-prices/index.json').then(function (I) {
      var id = fertReportId(I, p && p.state);
      if (!id) { card('fert', { v: '<span class="fp-none">None near</span>', s: 'No USDA state fertilizer report covers ' + esc(STN[p.state] || p.state) + '.', src: 'USDA AMS' }); return; }
      return get('/data/fert-prices/' + id + '.json').then(function (R) {
        var o = fertCopy(R);
        if (!o) throw new Error('none');
        card('fert', { k: 'Anhydrous · <b>' + esc(o.region) + '</b>', v: money(o.v, o.v % 1 ? 2 : 0), n: o.v, f: function (x) { return money(x); }, s: o.s, src: o.src, href: '/fertilizer' });
      });
    }).catch(function () { cardFail('fert', 'Could not read the USDA fertilizer report just now.'); });
  }
  function arcCard(p) {
    var Wd = root.AgHomeWorld;
    if (!Wd) { cardFail('arc', 'Could not read the ARC/PLC file just now.'); return Promise.resolve(); }
    var href = p && p.state && p.countyRaw ? Wd.arcHref(p.state, p.countyRaw) : '';
    var county = href ? text(href).then(function (html) {
      var r = Wd.arcFromPage(html);
      if (!r) throw new Error('none');
      var nm = Wd.countyName(p.state, p.countyRaw).replace(/ (County|Parish)$/, '');
      card('arc', { k: 'ARC/PLC · <b>' + esc(p.state) + '</b>', v: money(r.v, 2), n: r.v, f: function (x) { return money(x, 2); },
        s: 'A base acre: ' + esc(nm) + ' ' + esc(r.crop.toLowerCase()) + ', 2025 ' + r.prog + ', before the 5.7% cut.', src: 'FSA, ' + md(r.date), href: href + '#your-check' });
    }) : Promise.reject(new Error('no county'));
    return county.catch(function () {
      return get('/data/arc-plc.json').then(function (j) {
        var r = Wd.arcNational(j);
        if (!r) throw new Error('none');
        card('arc', { k: 'ARC/PLC · <b>corn</b>', v: money(r.v, 2), n: r.v, f: function (x) { return money(x, 2); },
          s: 'The 2026/27 PLC price line.' + (r.usda != null ? ' USDA projects <b>' + money(r.usda, 2) + '</b>.' : ''),
          src: 'FSA, USDA' + (r.usdaDate ? ' ' + r.usdaDate.replace(/, \d{4}$/, '') : ''), href: '/arc-plc' });
      });
    }).catch(function () { cardFail('arc', 'Could not read the ARC/PLC file just now.'); });
  }
  function cotCard() {
    return get('/data/cot.json').then(function (C) {
      var o = fundCopy(C);
      if (!o) throw new Error('none');
      card('cot', { k: 'Funds · <b>soybeans</b>', v: comma(o.v), n: o.v, f: comma, s: esc(o.s), src: o.src, href: '/cot' });
    }).catch(function () { cardFail('cot', 'Could not read the COT file just now.'); });
  }
  function daily() {
    get('/data/daily.json').then(function (j) {
      var iso = dailyIso(j && j.date);
      if (!j || !iso) return;
      $('fp-dk').textContent = 'The AGSIST Daily · ' + dayName(iso) + ' ' + md(iso);
      $('fp-dt').textContent = dailyLine(j) || 'This morning’s markets, your top local bid';
    }).catch(function () {});
  }

  /* ---------------- set your place */
  var form = $('fp-zip'), btn = $('fp-set');
  btn.addEventListener('click', function () {
    var open = form.hidden;
    form.hidden = !open; btn.setAttribute('aria-expanded', String(open));
    if (open) { try { $('fp-zip-in').focus(); } catch (e) {} }
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var z = String($('fp-zip-in').value || '').trim(), msg = $('fp-zip-msg'), A = root.AgSavedPlace;
    if (!/^\d{5}$/.test(z) || !A) { msg.textContent = 'Type a five-digit ZIP code.'; return; }
    A.save(z);
    msg.textContent = 'Looking up ' + z + '…';
    A.full().then(function (p) {
      if (!p || p.lat == null || !p.town) { msg.textContent = 'We could not find ZIP ' + z + ' in our table.'; return; }
      msg.textContent = '';
      form.hidden = true; btn.setAttribute('aria-expanded', 'false');
      try { root.dispatchEvent(new CustomEvent('agsist:bids')); } catch (er) {}
      start(true);
    });
  });

  /* ---------------- run */
  [].forEach.call(d.querySelectorAll('.fp-card'), function (c) { var k = c.querySelector('.fp-ck'); if (k) c.setAttribute('data-k0', k.textContent); });
  /* an odd number of first-row cards: the last runs the full width on a wide screen (css) */
  function even() {
    var cs = [].slice.call(d.querySelectorAll('#fp-cards .fp-card')).filter(function (c) { return !c.hidden; });
    cs.forEach(function (c, i) { c.classList.toggle('fp-wide', cs.length % 2 === 1 && i === cs.length - 1); });
  }
  even();
  var worldDone = false;
  function world(p) {
    $('fp-wh').textContent = p ? 'Around ' + p.town : 'Around farm country';
    bidsCard(p); rainCard(p); mktCard(); fcCard(); landCard(p); fertCard(p); arcCard(p); cotCard();
  }
  function start(changed) {
    place().then(function (p) {
      if (p) { savedLabels(p); answerSaved(p); } else { freshLabels(); answerFresh(); }
      if (changed || worldDone) { worldDone = true; world(p); return; }
      var near = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function (es) {
        if (es.some(function (x) { return x.isIntersecting; })) { near.disconnect(); if (!worldDone) { worldDone = true; world(p); } }
      }, { rootMargin: '600px 0px' }) : null;
      if (near) near.observe($('fp-world')); else { worldDone = true; world(p); }
    });
    if (!changed) daily();
  }
  start(false);
})(typeof window !== 'undefined' ? window : this);
