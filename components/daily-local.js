/* components/daily-local.js: "Your local line" on /daily and each issue page.
   A page opts in with one hidden element plus this script (defer):
     <aside class="dl" data-daily-local hidden></aside>
   data-after="<selector>": move the box after that element once it exists.

   WHAT IT SHOWS, for the reader's saved location only (agsist-wx-loc from
   geo.js, else agsist_zip): the best posted corn and soybean bid within 50
   miles, its elevator, distance and basis, the change since that board's
   last price on the trading day before, the nearest board when it is a
   different one, and rain over the last 24 hours and 7 days.

   WHERE IT COMES FROM. The elevator network's live index and ZIP table
   (dnilgis.github.io/bids, the same files /cash-bids and the homepage read),
   data/bids-prev/<ST>.json for yesterday's price, and Open-Meteo's hourly
   precipitation for the rounded location (the same service the site's
   weather uses). The location is never stored anywhere but this browser and
   nothing about the reader is logged.

   THE RULE FOR "BEST". Boards within 50 miles whose price was posted in the
   last 36 hours; among them the nearest open delivery month; the highest
   cash in it, the nearer board on a tie. Special grades (non-GMO, organic,
   white, feed) and Canadian-dollar boards are left out. Nothing within 50
   miles says so; a missing yesterday leaves the change out, never a zero.

   NO LOCATION: a ZIP box. The ZIP is saved as agsist_zip in this browser
   only, the same key the rest of the site reads.
   Tests: test/daily-local.test.mjs. */
(function (root) {
  'use strict';
  var BASE = 'https://dnilgis.github.io/bids/';
  var RADIUS = 50, STALE_H = 36, DAY = 864e5;
  var CROPS = [['corn', 'Corn'], ['soybeans', 'Soybeans']];
  var BAND = { corn: [2, 12], soybeans: [6, 32] };
  var SPECIAL = /non[- ]?gmo|organic|\bwhite\b|\bfeed\b/i;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var FR = { 0: '', 25: '¼', 50: '½', 75: '¾' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function miles(a, b, c, d) {
    var R = 3958.8, r = Math.PI / 180;
    var x = Math.sin((c - a) * r / 2) * Math.sin((c - a) * r / 2) + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) * Math.sin((d - b) * r / 2);
    return R * 2 * Math.asin(Math.sqrt(x));
  }
  function ctDay(ms) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); }
    catch (e) { return new Date(ms - 5 * 36e5).toISOString().slice(0, 10); }
  }
  function dayName(iso) { var t = Date.parse(iso + 'T12:00:00Z'); return isNaN(t) ? '' : DOW[new Date(t).getUTCDay()]; }
  /* cents to the nearest quarter: 4.5 -> "4½" */
  function qc(c) { var q = Math.round(Math.abs(c) * 4) / 4, w = Math.floor(q), f = Math.round((q - w) * 100); return (w || !f ? String(w) : '') + FR[f]; }
  /* dollars as a board prints them: 3.9125 -> "$3.91¼" */
  function cash(v) {
    var c = Math.round(v * 400) / 4, w = Math.floor(c / 100), r = c - w * 100, rc = Math.floor(r);
    return '$' + w + '.' + (rc < 10 ? '0' : '') + rc + FR[Math.round((r - rc) * 100)];
  }
  function basisWords(cents) {
    if (cents == null || !isFinite(cents)) return '';
    if (Math.abs(cents) < 0.125) return 'even with futures';
    return qc(cents) + '¢ ' + (cents < 0 ? 'under' : 'over') + ' futures';
  }

  function readLoc(ls) {
    var o = null, z = '';
    try { o = JSON.parse(ls.getItem('agsist-wx-loc') || 'null'); } catch (e) { o = null; }
    if (o && typeof o === 'object') {
      var lat = Number(o.lat), lon = Number(o.lon);
      var ok = isFinite(lat) && isFinite(lon) && !(lat === 0 && lon === 0) && o.lat != null && o.lon != null;
      z = /^\d{5}$/.test(o.zip || '') ? o.zip : '';
      if (ok || z) return { lat: ok ? lat : null, lon: ok ? lon : null, zip: z, label: typeof o.label === 'string' ? o.label : '' };
    }
    try { z = String(ls.getItem('agsist_zip') || ''); } catch (e) { z = ''; }
    return /^\d{5}$/.test(z) ? { lat: null, lon: null, zip: z, label: '' } : null;
  }

  /* the start month of a delivery period as "YYYY-MM"; spot = this month */
  function periodKey(p, nowMs) {
    var s = String(p || ''), m = /^(\d{4})-(\d{2})/.exec(s);
    if (m) return m[1] + '-' + m[2];
    if (/^spot$/i.test(s)) return ctDay(nowMs).slice(0, 7);
    m = /^newcrop-(\d{4})$/.exec(s);
    if (m) return m[1] + '-09';
    return '';
  }
  function fresh(iso, nowMs) { var t = Date.parse(iso || ''); return !isNaN(t) && nowMs - t <= STALE_H * 36e5 && t - nowMs <= 36e5; }

  /* Pure. {corn: {best, nearest, n}, soybeans: ...}; best/nearest are
     {place, name, town, state, mi, cash, basisCents, period, pricedAt} */
  function pick(index, lat, lon, nowMs) {
    var out = {};
    var places = (index && index.places) || [];
    CROPS.forEach(function (c) {
      var crop = c[0], cands = [];
      places.forEach(function (p) {
        if (typeof p.lat !== 'number' || typeof p.lon !== 'number' || (p.currency || 'USD') !== 'USD') return;
        var n = p.now && p.now[crop];
        if (!n || typeof n.cash !== 'number' || !isFinite(n.cash) || !n.period || !p.place) return;
        if (n.cash < BAND[crop][0] || n.cash > BAND[crop][1] || SPECIAL.test(n.commodity || '')) return;
        if (!fresh(p.pricedAt, nowMs)) return;
        var d = miles(lat, lon, p.lat, p.lon);
        if (d > RADIUS) return;
        var town = String(p.town || p.city || '').trim();
        if (town && String(p.operator || '').trim().toLowerCase() === town.toLowerCase()) town = '';
        cands.push({ place: p.place, name: String(p.operator || '').trim(), town: town, state: p.state || '',
          mi: Math.round(d * 10) / 10, cash: n.cash, basisCents: typeof n.basisCents === 'number' ? n.basisCents : null,
          period: n.period, key: periodKey(n.period, nowMs), pricedAt: p.pricedAt, delivery: n.delivery || '' });
      });
      if (!cands.length) { out[crop] = { best: null, nearest: null, n: 0 }; return; }
      var thisMonth = ctDay(nowMs).slice(0, 7);
      var keyed = cands.filter(function (x) { return x.key && x.key >= thisMonth; });
      var pool = cands;
      if (keyed.length) {
        var mk = keyed.reduce(function (m, x) { return !m || x.key < m ? x.key : m; }, '');
        pool = keyed.filter(function (x) { return x.key === mk; });
      }
      var best = pool.reduce(function (b, x) { return !b || x.cash > b.cash || (x.cash === b.cash && x.mi < b.mi) ? x : b; }, null);
      var nearest = cands.reduce(function (b, x) { return !b || x.mi < b.mi ? x : b; }, null);
      out[crop] = { best: best, nearest: nearest, n: cands.length };
    });
    return out;
  }

  /* Pure. Cents since the board's last price on the trading day before the
     one it last posted on: {cents, since: "Thu"} or null. */
  function change(row, crop, prevShard) {
    if (!row || !prevShard || !prevShard.rows) return null;
    var hist = prevShard.rows[fnv(row.place + '|' + crop + '|' + row.period)];
    var t = Date.parse(row.pricedAt || '');
    if (!Array.isArray(hist) || isNaN(t)) return null;
    var on = ctDay(t), prev = null;
    for (var i = 0; i < hist.length; i++) if (hist[i] && hist[i][0] < on && typeof hist[i][1] === 'number') prev = hist[i];
    if (!prev) return null;
    return { cents: Math.round((row.cash - prev[1]) * 1e6) / 1e4, since: dayName(prev[0]) };
  }

  /* Pure. Open-Meteo hourly answer -> {h24, d7} inches up to the current
     hour, or null when the hours are not all there. */
  function rain(om, nowMs) {
    var h = om && om.hourly, t = h && h.time, p = h && h.precipitation, off = (om && om.utc_offset_seconds) || 0;
    if (!Array.isArray(t) || !Array.isArray(p) || t.length !== p.length) return null;
    var end = -1;
    for (var i = 0; i < t.length; i++) { var ms = Date.parse(t[i] + 'Z') - off * 1000; if (ms <= nowMs) end = i; }
    if (end < 167) return null;
    function sum(k) { var s = 0; for (var j = end - k + 1; j <= end; j++) { if (typeof p[j] !== 'number') return null; s += p[j]; } return Math.round(s * 100) / 100; }
    var a = sum(24), b = sum(168);
    return a == null || b == null ? null : { h24: a, d7: b };
  }

  function where(r) { return esc(r.name) + (r.town ? ', ' + esc(r.town) : '') + ' (' + r.mi + ' mi)'; }
  function chgWords(c) {
    if (!c) return '';
    if (Math.abs(c.cents) < 0.125) return ', unchanged since ' + esc(c.since);
    return ', ' + (c.cents < 0 ? 'down ' : 'up ') + qc(c.cents) + '¢ since ' + esc(c.since);
  }
  function inches(v) { return v < 0.005 ? 'no rain' : v.toFixed(2) + ' inch'; }

  /* Pure. The box as HTML. o = {loc, picks, changes: {corn, soybeans}, rain, status} */
  function build(o) {
    var loc = o.loc, lines = [], src = [];
    var place = loc.label || (loc.zip ? 'ZIP ' + loc.zip : 'your spot');
    if (o.status === 'failed') lines.push('Bids could not be read just now. <a href="/cash-bids' + (loc.zip ? '?zip=' + loc.zip : '') + '">Try cash bids</a>.');
    else if (o.picks) {
      CROPS.forEach(function (c) {
        var k = o.picks[c[0]];
        if (!k || !k.best) { lines.push('<b>' + c[1] + '</b>: no bid posted in the last 36 hours within ' + RADIUS + ' miles.'); return; }
        var b = k.best, s = '<b>' + c[1] + '</b> best bid ' + cash(b.cash) + ' at ' + where(b);
        var bw = basisWords(b.basisCents);
        s += (bw ? ', ' + bw : '') + chgWords(o.changes && o.changes[c[0]]) + '.';
        if (k.nearest && k.nearest.place !== b.place) s += ' Nearest: ' + where(k.nearest) + ' ' + cash(k.nearest.cash) + '.';
        lines.push(s);
      });
      src.push('Posted bids within ' + RADIUS + ' miles, last 36 hours, nearest delivery month, from the elevator boards AGSIST reads');
    }
    if (o.rain) {
      lines.push('<b>Rain</b>: ' + inches(o.rain.h24) + ' over the last 24 hours, ' + inches(o.rain.d7) + ' over the last 7 days.');
      src.push('Rain is Open-Meteo’s estimate for your area, not a gauge');
    }
    var links = loc.zip ? '<p class="dl-l"><a href="/cash-bids?zip=' + esc(loc.zip) + '">All bids near ' + esc(loc.zip) + ' &rarr;</a></p>' : '<p class="dl-l"><a href="/cash-bids">All bids near you &rarr;</a></p>';
    return '<p class="dl-k">Your local line: ' + esc(place) + '</p>' +
      lines.map(function (s) { return '<p>' + s + '</p>'; }).join('') + links +
      (src.length ? '<p class="dl-s">' + src.join('. ') + '. Your location is saved only in this browser.</p>' : '');
  }
  function empty() {
    return '<p class="dl-k">Your local line</p>' +
      '<p>Add your ZIP to see the best corn and soybean bid near you, its basis, the change since yesterday and your rain.</p>' +
      '<form class="dl-f" novalidate><label class="dl-lab" for="dl-zip">ZIP code</label>' +
      '<input id="dl-zip" name="zip" inputmode="numeric" autocomplete="postal-code" pattern="[0-9]{5}" maxlength="5" placeholder="54728">' +
      '<button type="submit">Show my line</button></form>' +
      '<p class="dl-s">Saved in this browser only.</p>';
  }

  var api = { readLoc: readLoc, pick: pick, change: change, rain: rain, build: build, empty: empty, fnv: fnv, cash: cash, qc: qc, periodKey: periodKey };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AGSIST_DAILY_LOCAL = api;

  var doc = root.document;
  var CSS = 'aside.dl{margin:1rem 0;padding:.75rem .95rem;border:1px solid var(--border);border-left:3px solid var(--gold);border-radius:8px;background:var(--surface);font-size:.9rem;line-height:1.55;color:var(--text-dim)}' +
    'aside.dl p{margin:.3rem 0;font-size:inherit;line-height:inherit;color:inherit}aside.dl b{color:var(--text)}' +
    'aside.dl .dl-k{font-family:"JetBrains Mono",monospace;font-size:.7rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--gold)}' +
    'aside.dl a{color:var(--gold);display:inline-block;padding:.35rem 0}aside.dl .dl-s{font-size:.76rem;color:var(--text-muted)}' +
    'aside.dl .dl-f{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:.5rem 0}' +
    'aside.dl .dl-lab{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}' +
    'aside.dl input{font:inherit;font-family:"JetBrains Mono",monospace;width:7.5rem;min-height:44px;padding:0 .7rem;border:1px solid var(--border);border-radius:6px;background:var(--surface2);color:var(--text)}' +
    'aside.dl button{font:inherit;font-weight:700;min-height:44px;padding:0 1rem;border:1px solid var(--gold);border-radius:6px;background:transparent;color:var(--gold);cursor:pointer}' +
    'aside.dl .dl-err{color:var(--red,#e0685f)}aside.ya.ya-n{display:none}';
  function get(u, opt) { return fetch(u, opt || { cache: 'default' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function coords(loc) {
    if (loc.lat != null && loc.lon != null) return Promise.resolve({ lat: loc.lat, lon: loc.lon });
    return get(BASE + 'data/zips/' + loc.zip.slice(0, 2) + '.json').then(function (t) {
      var p = t && t[loc.zip];
      return Array.isArray(p) && isFinite(+p[0]) && isFinite(+p[1]) && !(+p[0] === 0 && +p[1] === 0) ? { lat: +p[0], lon: +p[1] } : null;
    });
  }
  function fill(el, loc) {
    el.innerHTML = build({ loc: loc, picks: null });
    coords(loc).then(function (c) {
      if (!c) { el.innerHTML = build({ loc: loc, status: 'failed' }); return; }
      var now = Date.now();
      var lat = Math.round(c.lat * 100) / 100, lon = Math.round(c.lon * 100) / 100;
      var om = get('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
        '&hourly=precipitation&precipitation_unit=inch&timezone=auto&past_days=7&forecast_days=1');
      get(BASE + 'data/merged-index.json').then(function (idx) {
        if (!idx || !idx.places) { el.innerHTML = build({ loc: loc, status: 'failed' }); return; }
        var picks = pick(idx, c.lat, c.lon, now), states = {};
        CROPS.forEach(function (k) { var b = picks[k[0]].best; if (b && /^[A-Z]{2}$/.test(b.state)) states[b.state] = 1; });
        var st = Object.keys(states);
        Promise.all([Promise.all(st.map(function (s) { return get('/data/bids-prev/' + s + '.json', { cache: 'no-store' }); })), om]).then(function (r) {
          var shard = {}, changes = {};
          st.forEach(function (s, i) { shard[s] = r[0][i]; });
          CROPS.forEach(function (k) { var b = picks[k[0]].best; changes[k[0]] = b ? change(b, k[0], shard[b.state]) : null; });
          el.innerHTML = build({ loc: loc, picks: picks, changes: changes, rain: rain(r[1], now) });
        });
      });
    });
  }
  function ask(el) {
    el.innerHTML = empty();
    var f = el.querySelector('form'), inp = el.querySelector('input');
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var z = String(inp.value || '').trim();
      if (!/^\d{5}$/.test(z)) {
        var e = el.querySelector('.dl-err');
        if (!e) { e = doc.createElement('p'); e.className = 'dl-err'; f.parentNode.insertBefore(e, f.nextSibling); }
        e.textContent = 'A ZIP is five digits.';
        return;
      }
      try { root.localStorage.setItem('agsist_zip', z); } catch (x) {}
      fill(el, { lat: null, lon: null, zip: z, label: '' });
    });
  }
  function place(el) {
    var sel = el.getAttribute('data-after'), n = 0;
    if (!sel) return;
    (function look() {
      var t = doc.querySelector(sel);
      if (t && t.parentNode) { t.parentNode.insertBefore(el, t.nextSibling); return; }
      if (++n < 40) setTimeout(look, 250);
    })();
  }
  function boot() {
    var els = doc.querySelectorAll('[data-daily-local]');
    if (!els.length) return;
    var loc = null;
    try { loc = readLoc(root.localStorage); } catch (e) { loc = null; }
    var st = doc.createElement('style'); st.textContent = CSS; doc.head.appendChild(st);
    Array.prototype.forEach.call(els, function (el) {
      place(el);
      el.hidden = false;
      if (!loc) ask(el); else fill(el, loc);
    });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : this);
