/* What changed here this week (god's-eye panel, build 4; Sig, Oct 27 2026: no new list, sender or
   cron). Fast Facts "My place" loads this file only once a place is open (components/here.js
   changeMap()); nothing of it is inline in the page.

   For the open county: a sticky line (county, crop, date), one plain sentence of what changed,
   then a state county map whose one fill is "changed this week" (gray = held), with the corn
   buyers within 50 mi, the 50 mi ring and the place. Every line carries its source and date. A
   line we cannot back with a file is withheld and says why; it is never guessed.

   The map (Sig, Oct 29 2026: a good basemap on phone and desktop). The county shapes are drawn as
   one SVG the moment the outlines are in, so the first map needs only this file and the state's
   outlines. Leaflet 1.9.4 (/vendor, the copy Field Scout uses) loads when the map is near the
   screen and lays the same SVG over the USGS National Map topo tiles (public domain, no key,
   "Map: USGS" as Field Scout credits it). If Leaflet or the tiles do not answer, the plain SVG
   stays. The SVG is in Web Mercator so it sits on the tiles exactly. The map's height is held in
   CSS from the start, so nothing moves when the tiles come in.

   One fill at a time, picked with the switch under the map. "Changed" means the source's own value
   differs between two dated releases; a county with no value on both is gray, never guessed:
     Drought     this week's Drought Monitor category against last week's (the worst covering half)
     Corn bids   each posted corn bid's basis on the newest day in data/bids-prev against the oldest
                 day within a week of it (the same days the change-time ledger walks, read from the
                 daily file on the site; the ledger itself stays private)
     Rent        non-irrigated county cash rent, the newest survey against the one before (NASS)
     Land sales  recorded farm sales dated in the newest month of the state record
     Rain        the newest whole week of the county's station record against usual for those days

   Files, all already on the site, fetched by state, never with the reader's point in the URL:
     data/drought/county-week.json   this week's and last week's Drought Monitor map
     data/arc-plc/geo/<ST>.json      the state's county outlines (the ARC/PLC page's own file)
     the bids network's live index   via window.AGSIST_BIDS_NET (already loaded for the price card)
     data/bids-prev/<ST>.json        each place's last posted price on recent trading days
     data/basis-states.json          the state's middle basis
     data/prices.json                futures, to check which contract a county bid is posted against
     data/land-sales/<st>.json       recorded farm sales (Illinois, Indiana, Wisconsin, Vermont)
     data/cash-rent/<ST>.json        county cash rents (only when Rent is picked)
     data/rain/<st>.json             county rain against usual (only when Rain is picked)

   Rules: the top bid compares one delivery period only, and "same place" means the same posted top,
   never "the elevator held its price". No company, buyer or seller name anywhere: the page is indexed.

   The lines themselves (drought, top bid, basis, sales, the sentence) live in components/change-lines.js,
   which the Daily's Thursday "Your county this week" and the Atlas county home read too. This file is
   the map and the drawing. here.js loads change-lines.js first.

   Works in node (require, for test/changemap.test.mjs) and in the browser (window.AgChangeMap). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./change-lines.js'));
  else root.AgChangeMap = factory(root.AgChangeLines);
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';
  var md = L.md, esc = L.esc, cap = L.cap, catWords = L.catWords, RING_MI = L.RING_MI, SALES_STATES = L.SALES_STATES;
  var nearCorn = L.nearCorn, topBid = L.topBid, bidLine = L.bidLine, droughtChange = L.droughtChange, droughtLine = L.droughtLine;
  var droughtFills = L.droughtFills, countyBasis = L.countyBasis, basisLine = L.basisLine, newSales = L.newSales, salesLine = L.salesLine;
  var summary = L.summary, linesHtml = L.linesHtml, fnv = L.fnv, money = L.money;
  var LEAFLET = '/vendor/leaflet-1.9.4/';
  var TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}';
  var TILE_ATTR = 'Map: USGS';
  var MON = L.MON, MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  /* ── the map ──────────────────────────────────────────────────────── */
  function merc(lat) { var s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180); return Math.log((1 + s) / (1 - s)) / 2; }
  /* Web Mercator, linear in both axes, so the SVG lies on the tiles when stretched over P.b */
  function projector(geo, st) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    var wrap = st === 'AK' ? function (lon) { return lon > 0 ? lon - 360 : lon; } : function (lon) { return lon; };
    geo.c.forEach(function (c) {
      var b = c[3];
      if (!b) return;
      var a = wrap(b[0]), z = wrap(b[2]);
      x0 = Math.min(x0, a, z); x1 = Math.max(x1, a, z); y0 = Math.min(y0, b[1]); y1 = Math.max(y1, b[3]);
    });
    var m0 = merc(y0), m1 = merc(y1), W = 1000, sx = W / ((x1 - x0) * Math.PI / 180), H = Math.round((m1 - m0) * sx);
    var latH = function (m) { return Math.atan(Math.sinh(m)) * 180 / Math.PI; };
    return { W: W, H: H, b: [[latH(m1 - H / sx), x0], [y1, x1]],
      p: function (lon, lat) { return [(wrap(lon) - x0) * Math.PI / 180 * sx, (m1 - merc(lat)) * sx]; } };
  }
  function pathOf(P, coords) {
    var out = '';
    (coords || []).forEach(function (poly) {
      (poly || []).forEach(function (ring) {
        var last = null, s = '';
        ring.forEach(function (pt, i) {
          var q = P.p(pt[0], pt[1]);
          if (last && i < ring.length - 1 && Math.abs(q[0] - last[0]) < 0.8 && Math.abs(q[1] - last[1]) < 0.8) return;
          s += (s ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1);
          last = q;
        });
        if (s) out += s + 'Z';
      });
    });
    return out;
  }
  function ring(P, lat, lng, mi) {
    var R = 3958.8, d = mi / R, la = lat * Math.PI / 180, lo = lng * Math.PI / 180, s = '';
    for (var i = 0; i <= 48; i++) {
      var t = i / 48 * 2 * Math.PI;
      var la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(t));
      var lo2 = lo + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
      var q = P.p(lo2 * 180 / Math.PI, la2 * 180 / Math.PI);
      s += (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1);
    }
    return s + 'Z';
  }
  function dot(P, q, r, cls) { var x = P.p(q.lon, q.lat); return '<circle cx="' + x[0].toFixed(1) + '" cy="' + x[1].toFixed(1) + '" r="' + r + '" class="' + cls + '"/>'; }
  /* geo: data/arc-plc/geo/<ST>.json; fills: {fips: {k}}; pts: [{lat, lon}] */
  function svg(geo, opts) {
    var P = projector(geo, opts.st), fills = opts.fills || {}, h = '';
    geo.c.forEach(function (c) {
      var f = fills[c[0]], k = f ? f.k : 'none';
      h += '<path d="' + pathOf(P, c[4]) + '" class="cm-' + k + (c[0] === opts.fips ? ' cm-me' : '') + '" data-f="' + c[0] + '" data-n="' + esc(c[1]) + '"/>';
    });
    var me = geo.c.filter(function (c) { return c[0] === opts.fips; })[0];
    if (me) h += '<path d="' + pathOf(P, me[4]) + '" class="cm-meo"/>';
    if (opts.lat != null && isFinite(opts.lat)) h += '<path d="' + ring(P, opts.lat, opts.lng, RING_MI) + '" class="cm-ring"/>';
    h += '<g class="cm-pts">' + (opts.pts || []).map(function (q) { return dot(P, q, 7, 'cm-pt'); }).join('') + '</g>';
    if (opts.lat != null && isFinite(opts.lat)) h += dot(P, { lat: opts.lat, lon: opts.lng }, 16, 'cm-you');
    return '<svg class="cm-svg" viewBox="0 0 ' + P.W + ' ' + P.H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + esc(opts.label || '') + '">' + h + '</svg>';
  }

  /* ── the fills, one per signal: {by: {fips: {k, t}}, n: {k: count}, key: [[k, words]], cap} ── */
  function tally(list, fn) {
    var by = {}, n = {};
    list.forEach(function (f) { var o = (fn && fn(f)) || { k: 'none' }; by[f] = o; n[o.k] = (n[o.k] || 0) + 1; });
    return { by: by, n: n };
  }
  function counted(n, key) {
    return key.filter(function (k) { return n[k[0]]; }).map(function (k) { return n[k[0]] + ' ' + k[1].toLowerCase(); }).join(', ');
  }
  function bidFilter() {
    try { if (typeof module === 'object' && module.exports) return require('./bid-filter.js'); } catch (e) { /* unfiltered */ }
    return (typeof window !== 'undefined' && window.AG && window.AG.bidFilter) || null;
  }
  function dayAdd(iso, d) { var t = Date.parse(iso + 'T12:00:00Z'); return isFinite(t) ? new Date(t + d * 864e5).toISOString().slice(0, 10) : null; }

  function fillDrought(dr, list, stName) {
    var f = droughtFills(dr, list), by = {};
    Object.keys(f.by).forEach(function (k) {
      var o = f.by[k], d = o.d;
      by[k] = { k: o.k, t: !d || d.status !== 'ok' ? (d ? d.why : 'no drought map') :
        (d.dir === 'held' ? 'held at ' + catWords(d.now) : (d.dir === 'worse' ? 'worse, ' : 'eased, ') + catWords(d.now) + ' from ' + catWords(d.was)) + ' (' + md(d.valid) + ' map)' };
    });
    var n = f.n;
    return { by: by, n: n, key: [['worse', 'Worse'], ['better', 'Eased'], ['held', 'Held'], ['none', 'No map']],
      cap: dr ? stName + ' counties, drought category ' + md(dr.prev) + ' to ' + md(dr.valid) + ': ' + n.worse + ' worse, ' + n.better + ' eased, ' + n.held + ' held' + (n.none ? ', ' + n.none + ' with no map' : '') + '.' : 'The drought map did not load; counties are gray.',
      src: 'U.S. Drought Monitor' };
  }
  /* Every posted corn bid in the state: its basis (cents) on the newest day in the file against the
     oldest day within a week of it. Basis, not cash: a cash move with the basis unchanged is the
     futures moving, not the elevator. A county is up or down when its moved bids lean one way. */
  function fillBids(idx, prev, st, list, stName) {
    var key = [['up', 'Stronger'], ['down', 'Weaker'], ['mix', 'Both ways'], ['held', 'Held'], ['none', 'No bid both days']];
    var src = 'Posted elevator bids';
    if (!idx || !idx.places) return { by: tally(list, null).by, n: { none: list.length }, key: key, cap: 'The elevator network did not answer; counties are gray.', src: src };
    if (!prev || !prev.rows) return { by: tally(list, null).by, n: { none: list.length }, key: key, cap: 'The earlier posted prices did not load; counties are gray.', src: src };
    var d1 = null;
    Object.keys(prev.rows).forEach(function (k) { (prev.rows[k] || []).forEach(function (e) { if (e && (!d1 || e[0] > d1)) d1 = e[0]; }); });
    /* the earlier day: the oldest within a week of d1 that most bids posted on d1 also posted on
       (at least 80% of the best day's count), so one county is never read over another's span */
    var lo = d1 && dayAdd(d1, -7), both = {}, d0 = null, top = 0;
    Object.keys(prev.rows).forEach(function (k) {
      var h = prev.rows[k] || [];
      if (!h.some(function (e) { return e && e[0] === d1; })) return;
      h.forEach(function (e) { if (e && e[0] >= lo && e[0] < d1) both[e[0]] = (both[e[0]] || 0) + 1; });
    });
    Object.keys(both).forEach(function (d) { top = Math.max(top, both[d]); });
    Object.keys(both).sort().forEach(function (d) { if (!d0 && both[d] >= 0.8 * top) d0 = d; });
    if (!d0) return { by: tally(list, null).by, n: { none: list.length }, key: key, cap: 'Only one trading day of posted prices on file; counties are gray.', src: src };
    var BF = bidFilter(), per = {}, seen = {};
    idx.places.forEach(function (p) {
      var c = p.now && p.now.corn;
      if (!c || !c.period || !p.place || !p.fips || String(p.state || '').toUpperCase() !== st || (p.currency || 'USD') !== 'USD') return;
      if (BF && !BF.canSetBest({ commodity: c.commodity || 'Corn', crop: 'corn', cashPrice: c.cash })) return;
      var k = fnv(p.place + '|corn|' + c.period);
      if (seen[k]) return;
      seen[k] = 1;
      var h = prev.rows[k] || [], a = h.filter(function (e) { return e && e[0] === d0 && typeof e[2] === 'number'; })[0], b = h.filter(function (e) { return e && e[0] === d1 && typeof e[2] === 'number'; })[0];
      if (!a || !b) return;
      var o = per[p.fips] = per[p.fips] || { up: 0, down: 0, same: 0 };
      o[b[2] > a[2] ? 'up' : b[2] < a[2] ? 'down' : 'same']++;
    });
    var t = tally(list, function (f) {
      var o = per[f];
      if (!o) return { k: 'none', t: 'no posted corn bid with a basis on both ' + md(d0) + ' and ' + md(d1) };
      var n = o.up + o.down + o.same, moved = o.up + o.down;
      var w = n + ' posted corn bid' + (n === 1 ? '' : 's') + ' on both days: ' + (moved ? [o.up ? o.up + ' basis stronger' : '', o.down ? o.down + ' weaker' : '', o.same ? o.same + ' held' : ''].filter(Boolean).join(', ') : 'every basis held');
      return { k: !moved ? 'held' : o.up > o.down ? 'up' : o.down > o.up ? 'down' : 'mix', t: w + ' (' + md(d0) + ' to ' + md(d1) + ')' };
    });
    return { by: t.by, n: t.n, key: key, src: src,
      cap: stName + ' counties, posted corn basis ' + md(d0) + ' against ' + md(d1) + ': ' + (counted(t.n, key) || 'none on file') + '.' };
  }
  function fillRent(file, list, stName) {
    var key = [['up', 'Up'], ['down', 'Down'], ['held', 'Same'], ['none', 'No county estimate']];
    var src = 'USDA NASS cash rents survey';
    var yrs = file && Array.isArray(file.years) ? file.years.slice().sort() : [];
    if (!file || !Array.isArray(file.counties) || yrs.length < 2) return { by: tally(list, null).by, n: { none: list.length }, key: key, cap: 'No county cash rents on file for ' + stName + '; counties are gray.', src: src };
    var y1 = String(yrs[yrs.length - 1]), y0 = String(yrs[yrs.length - 2]), byF = {};
    file.counties.forEach(function (c) { if (c && c.fips) byF[c.fips] = c; });
    var t = tally(list, function (f) {
      var r = byF[f] && byF[f].rent && byF[f].rent.nonirr, a = r && r[y0], b = r && r[y1];
      if (typeof a !== 'number' || typeof b !== 'number') return { k: 'none', t: 'no NASS county estimate for ' + (typeof b === 'number' ? y0 : y1) };
      return { k: b > a ? 'up' : b < a ? 'down' : 'held', t: money(b) + ' an acre in ' + y1 + ', ' + (b === a ? 'the same as in ' + y0 : (b > a ? 'up from ' : 'down from ') + money(a) + ' in ' + y0) };
    });
    return { by: t.by, n: t.n, key: key, src: src,
      cap: stName + ' counties, non-irrigated cropland rent, ' + y1 + ' survey against ' + y0 + ': ' + counted(t.n, key) + '. Nothing new between yearly surveys.' };
  }
  function fillSales(file, list, st, stName) {
    var key = [['new', 'Sales'], ['held', 'None'], ['none', 'No list']];
    var src = (file && file.source) || 'State deed records';
    if (!SALES_STATES[st]) return { by: tally(list, null).by, n: { none: list.length }, key: key, cap: 'Recorded farm sales are on hand for Illinois, Indiana, Wisconsin and Vermont only.', src: src };
    if (!file || !file.counties || !file.through) return { by: tally(list, null).by, n: { none: list.length }, key: key, cap: 'The recorded sales file did not load; counties are gray.', src: src };
    var month = MONTHS[+file.through.slice(5, 7) - 1];
    var t = tally(list, function (f) {
      var s = newSales(file, f, st);
      if (s.status !== 'ok') return { k: 'none', t: s.why };
      return { k: s.n ? 'new' : 'held', t: s.n ? (s.exact ? s.n : 'at least ' + s.n) + ' recorded farm sale' + (s.n === 1 && s.exact ? '' : 's') + ' of ' + L.SALES_MIN_ACRES + ' acres or more dated in ' + month : 'no recorded farm sale dated in ' + month };
    });
    return { by: t.by, n: t.n, key: key, src: src,
      cap: stName + ' counties with recorded farm sales of ' + L.SALES_MIN_ACRES + ' acres or more dated in ' + month + ' (records through ' + md(file.through) + (file.fetched ? ', read ' + md(file.fetched) : '') + '): ' + counted(t.n, key) + '.' };
  }
  /* the county's running total steps every 7 days from Jan 1 (scripts/county_rain.py CUM_STEP):
     the newest whole step is one week, against usual for the same days */
  function rainWeek(c, year) {
    var cum = c && Array.isArray(c.cum) ? c.cum.filter(function (e) { return e && (e[0] + 1) % 7 === 0; }) : [];
    if (cum.length < 2) return null;
    var a = cum[cum.length - 2], b = cum[cum.length - 1];
    if (b[0] - a[0] !== 7 || typeof a[2] !== 'number' || typeof b[2] !== 'number') return null;
    var jan1 = year + '-01-01';
    return { got: Math.round((b[1] - a[1]) * 100) / 100, usual: Math.round((b[2] - a[2]) * 100) / 100, from: dayAdd(jan1, a[0] + 1), to: dayAdd(jan1, b[0]) };
  }
  function fillRain(file, list, stName) {
    var key = [['wet', 'Wetter than usual'], ['dry', 'Drier than usual'], ['held', 'Usual'], ['none', 'No station or no usual']];
    var src = 'NOAA daily station records, 1991-2020 normals';
    if (!file || !file.counties) return { by: tally(list, null).by, n: { none: list.length }, key: key, cap: 'The county rain file did not load; counties are gray.', src: src };
    var span = null;
    var t = tally(list, function (f) {
      if (file.none && file.none[f]) return { k: 'none', t: 'no station in the county' };
      var w = rainWeek(file.counties[f], file.year);
      if (!w) return { k: 'none', t: 'the county station has no usual on file for this week' };
      if (!span || w.to > span.to) span = w;
      return { k: w.got > w.usual ? 'wet' : w.got < w.usual ? 'dry' : 'held', t: w.got.toFixed(2) + ' in. ' + md(w.from) + ' to ' + md(w.to) + ', usual ' + w.usual.toFixed(2) + ' in.' };
    });
    return { by: t.by, n: t.n, key: key, src: src,
      cap: stName + ' counties, rain ' + (span ? md(span.from) + ' to ' + md(span.to) : 'last week') + ' against usual for those days, one station per county: ' + (counted(t.n, key) || 'none on file') + '.' };
  }
  var SIGNALS = [['drought', 'Drought'], ['bids', 'Bids'], ['rent', 'Rent'], ['sales', 'Sales'], ['rain', 'Rain']];

  /* ── drawing into the page ───────────────────────────────────────── */
  var CSS = '.cm{margin:0 0 1rem;border:1px solid var(--border);border-top:0;border-radius:0 0 10px 10px;background:var(--surface);overflow:clip}' +
    '.cm-top{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;margin:.4rem 0 0;padding:.45rem .75rem;background:var(--surface2);border:1px solid var(--border);border-radius:10px 10px 0 0;font-weight:700;font-size:.95rem;color:var(--text)}' +
    '.cm-top:empty{display:none}' +
    '.cm-top span+span::before{content:"\\00b7";margin-right:.4rem;color:var(--text-muted)}' +
    '#h-cm .cm-lead{grid-area:lead;margin:0;min-height:2.8em;font-size:.95rem;font-weight:600;line-height:1.4;color:var(--text)}' +
    '.cm-grid{display:grid;grid-template-columns:minmax(0,1fr);grid-template-areas:"lead" "map" "side";gap:.35rem;padding:.45rem .75rem .7rem}' +
    '.cm-map{grid-area:map;margin:0;min-width:0}.cm-side{grid-area:side}' +
    '.cm-box{position:relative;height:240px;border-radius:8px;overflow:hidden;background:#e9ece6}' +
    '.cm-box>.cm-svg{display:block;width:100%;height:100%}' +
    '.cm-lf{position:absolute;inset:0;background:#e9ece6;font:inherit}.cm-lf .leaflet-tile-pane{filter:saturate(.55) brightness(1.04)}' +
    '.cm-lf .leaflet-control-attribution{font-size:.68rem;background:rgba(255,255,255,.78);color:#333}' +
    '.cm svg.cm-svg path[data-f]{cursor:pointer}' +
    '.cm-svg path{stroke:rgba(34,40,44,.62);stroke-width:1;vector-effect:non-scaling-stroke}' +
    '.cm-svg .cm-worse{fill:#c0492f;fill-opacity:.62}.cm-svg .cm-better{fill:#2a6390;fill-opacity:.58}' +
    '.cm-svg .cm-up{fill:#c27400;fill-opacity:.58}.cm-svg .cm-down{fill:#2a6390;fill-opacity:.58}.cm-svg .cm-mix{fill:#7b5aa6;fill-opacity:.55}' +
    '.cm-svg .cm-wet{fill:#2a6390;fill-opacity:.55}.cm-svg .cm-dry{fill:#a0631c;fill-opacity:.58}.cm-svg .cm-new{fill:#2e7d4f;fill-opacity:.6}' +
    '.cm-svg .cm-held{fill:#7d878b;fill-opacity:.38}.cm-svg .cm-none{fill:#fff;fill-opacity:.12}' +
    '.cm svg.cm-svg path.cm-meo,.cm svg.cm-svg path.cm-ring,.cm svg.cm-svg .cm-pts,.cm svg.cm-svg circle{pointer-events:none}' +
    '.cm-svg path.cm-meo{fill:none;stroke:#111;stroke-width:2.6}' +
    '.cm-svg path.cm-ring{fill:none;stroke:#8a6514;stroke-width:1.8;stroke-dasharray:5 4}' +
    '.cm-pt{fill:#fff;stroke:#222;stroke-width:1;vector-effect:non-scaling-stroke}' +
    '.cm-you{fill:#d4a23f;stroke:#111;stroke-width:2;vector-effect:non-scaling-stroke}' +
    '.cm-sw{display:flex;flex-wrap:wrap;gap:.2rem;margin:.45rem 0 0;min-height:1.9rem}' +
    '.cm-sw button{font:inherit;font-size:.78rem;min-height:32px;padding:.15rem .45rem;border-radius:999px;border:1px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer}' +
    '.cm-sw button[aria-pressed="true"]{background:var(--text);color:var(--bg);border-color:var(--text)}' +
    '.cm-key{display:flex;flex-wrap:wrap;gap:.25rem .8rem;margin:.35rem 0 0;padding:0;list-style:none;font-size:.82rem;color:var(--text-dim);min-height:1.2rem}' +
    '.cm-key i{display:inline-block;width:.8rem;height:.8rem;border-radius:2px;margin-right:.3rem;vertical-align:-.1rem}' +
    '.cm-key .cm-worse{background:#c0492f}.cm-key .cm-better,.cm-key .cm-down,.cm-key .cm-wet{background:#2a6390}.cm-key .cm-up{background:#c27400}.cm-key .cm-mix{background:#7b5aa6}' +
    '.cm-key .cm-dry{background:#a0631c}.cm-key .cm-new{background:#2e7d4f}.cm-key .cm-held{background:#9aa3a6}.cm-key .cm-none{background:#e9ece6;border:1px solid var(--border)}' +
    '.cm-key .k-pt,.cm-key .k-you{border-radius:50%}.cm-key .k-pt{background:#fff;border:1px solid #222}.cm-key .k-you{background:#d4a23f}' +
    '.cm-key .k-ring{background:none;border:1.5px dashed #8a6514;border-radius:50%}' +
    '.cm-cap,.cm-tap,.cm-go{margin:.3rem 0 0;font-size:.85rem;color:var(--text-dim)}.cm-tap:empty,.cm-go:empty{display:none}.cm-go a{color:var(--text)}' +
    '.cm-lines{margin:0;padding:0;list-style:none}.cm-lines li{padding:.45rem 0;border-top:1px solid var(--border);font-size:.92rem;line-height:1.45;color:var(--text)}' +
    '.cm-lines li:first-child{border-top:0}.cm-lines b{margin-right:.3rem}' +
    '.cm-d{display:block;font-size:.8rem;color:var(--text-muted)}.cm-off{color:var(--text-dim)}' +
    '@media (min-width:900px){.cm-grid{grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);grid-template-areas:"map lead" "map side";grid-template-rows:auto 1fr;gap:.5rem 1.2rem;align-items:start}#h-cm .cm-lead{font-size:1.1rem}.cm-box{height:420px}}' +
    '@media print{.cm{display:none}}';
  function style() {
    if (typeof document === 'undefined' || document.getElementById('cm-css')) return;
    var s = document.createElement('style'); s.id = 'cm-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  function centralDay(now) {
    try { return (now || new Date()).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); } catch (e) { return (now || new Date()).toISOString().slice(0, 10); }
  }
  /* sticky under the site's own sticky bars (the menu, and the price strip where a page has one) */
  function pinBelowNav(el) {
    function set() {
      var y = 0;
      Array.prototype.forEach.call(document.querySelectorAll('.nav, .prices-strip'), function (n) {
        var cs = getComputedStyle(n);
        if (cs.position === 'sticky' || cs.position === 'fixed') y = Math.max(y, Math.round((parseFloat(cs.top) || 0) + n.getBoundingClientRect().height));
      });
      el.style.top = y + 'px';
    }
    set();
    if (!el.getAttribute('data-pin')) { el.setAttribute('data-pin', '1'); window.addEventListener('resize', set); }
  }
  function shortName(n) { return String(n || '').replace(/ County$/, ' Co.'); }
  function getJSON(u, ms) {
    return new Promise(function (ok) {
      var done = false, t = setTimeout(function () { if (!done) { done = true; ok(null); } }, ms || 12000);
      fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (j) { if (!done) { done = true; clearTimeout(t); ok(j); } });
    });
  }
  function labelled(l, label) { if (l.status === 'withheld') l.label = label; return l; }
  var lfP = null;
  function leaflet() {
    if (lfP) return lfP;
    lfP = new Promise(function (ok) {
      if (window.L && window.L.svgOverlay) { ok(window.L); return; }
      var css = new Promise(function (y) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = LEAFLET + 'leaflet.css'; l.onload = l.onerror = function () { y(); }; document.head.appendChild(l); setTimeout(y, 6000); });
      var js = new Promise(function (y) { var s = document.createElement('script'); s.src = LEAFLET + 'leaflet.js'; s.onload = function () { y(window.L || null); }; s.onerror = function () { y(null); }; document.head.appendChild(s); setTimeout(function () { y(window.L || null); }, 15000); });
      Promise.all([css, js]).then(function (a) { ok(a[1] && a[1].svgOverlay ? a[1] : null); });
    });
    return lfP;
  }
  /* when the map is near the screen (or at once where there is no observer) */
  function near(el, fn) {
    if (typeof IntersectionObserver === 'undefined') { fn(); return; }
    var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); fn(); } }, { rootMargin: '300px 0px' });
    io.observe(el);
  }
  /* the plain SVG goes over the USGS tiles; it stays alone if Leaflet does not load */
  function basemap(boxEl, svgEl, P, wide) {
    near(boxEl, function () {
      leaflet().then(function (Lf) {
        if (!Lf || !svgEl.isConnected) return;
        var div = document.createElement('div'); div.className = 'cm-lf'; boxEl.appendChild(div);
        try {
          var map = Lf.map(div, { zoomControl: wide, attributionControl: true, dragging: wide, touchZoom: wide, scrollWheelZoom: false, doubleClickZoom: wide, boxZoom: false, keyboard: false, zoomSnap: 0, zoomDelta: 0.5 });
          map.attributionControl.setPrefix(false);
          Lf.tileLayer(TILES, { maxNativeZoom: 16, maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
          var b = Lf.latLngBounds(P.b);
          map.fitBounds(b, { padding: [2, 2], animate: false });
          svgEl.setAttribute('preserveAspectRatio', 'none');
          Lf.svgOverlay(svgEl, b, { interactive: true }).addTo(map);
          boxEl.cmMap = map;
          boxEl.setAttribute('data-base', 'usgs');
        } catch (e) { if (div.parentNode) div.parentNode.removeChild(div); if (!svgEl.parentNode) boxEl.appendChild(svgEl); }
      });
    });
  }

  /* ctx: {fips, st, stName, name, lat, lng, net, mine(), atlas(fips) -> county home href or null} */
  function draw(box, ctx) {
    style();
    var today = centralDay(), wide = typeof matchMedia === 'function' && matchMedia('(min-width:900px)').matches;
    /* the one-line header sits beside the box, not in it, so it stays in view down the whole place */
    var top = typeof document !== 'undefined' && document.getElementById('cm-top');
    if (!top && box.parentNode) { top = document.createElement('div'); top.id = 'cm-top'; top.className = 'cm-top'; box.parentNode.insertBefore(top, box); }
    if (top) pinBelowNav(top);
    if (top) top.innerHTML = '<span>' + esc(shortName(ctx.name)) + ', ' + esc(ctx.st) + '</span><span>corn</span><span>' + esc(md(today)) + '</span>';
    var sigs = SIGNALS.filter(function (s) { return s[0] !== 'sales' || SALES_STATES[ctx.st]; });
    box.removeAttribute('data-cm');
    box.innerHTML = '<div class="cm-grid"><p class="cm-lead" aria-live="polite">Reading what changed here&hellip;</p><figure class="cm-map"><div class="cm-box"></div>' +
      '<div class="cm-sw" role="group" aria-label="What the map shows">' + sigs.map(function (s, i) { return '<button type="button" data-s="' + s[0] + '" aria-pressed="' + (i ? 'false' : 'true') + '">' + s[1] + '</button>'; }).join('') + '</div>' +
      '<ul class="cm-key"></ul><figcaption class="cm-cap">Reading the county outlines&hellip;</figcaption><p class="cm-tap" aria-live="polite"></p><p class="cm-go"></p></figure><div class="cm-side"></div></div>';
    box.hidden = false;
    var mapBox = box.querySelector('.cm-box'), keyEl = box.querySelector('.cm-key'), capEl = box.querySelector('.cm-cap'), tap = box.querySelector('.cm-tap'), go = box.querySelector('.cm-go');
    var net = ctx.net, idxP = net && net.index ? net.index() : Promise.resolve(null);
    var geoP = getJSON('/data/arc-plc/geo/' + ctx.st + '.json', 20000), drP = getJSON('/data/drought/county-week.json');
    var salesP = SALES_STATES[ctx.st] ? getJSON('/data/land-sales/' + SALES_STATES[ctx.st] + '.json') : Promise.resolve(null);
    var bidP = idxP.then(function (idx) {
      if (!idx) return [idx, {}];
      var sts = {};
      sts[ctx.st] = 1;
      nearCorn(idx, ctx.lat, ctx.lng, RING_MI).forEach(function (r) { if (/^[A-Z]{2}$/.test(r.st)) sts[r.st] = 1; });
      var ks = Object.keys(sts);
      return Promise.all(ks.map(function (s) { return getJSON('/data/bids-prev/' + s + '.json'); })).then(function (fs) {
        var prev = {}; ks.forEach(function (s, i) { prev[s] = fs[i]; }); return [idx, prev];
      });
    });
    var basisP = Promise.all([idxP, getJSON('/data/basis-states.json'), getJSON('/data/prices.json')]);
    var S = { sig: 'drought', fills: {}, svg: null, list: [] };
    var LOAD = {
      drought: function () { return drP.then(function (dr) { return fillDrought(dr, S.list, ctx.stName); }); },
      bids: function () { return bidP.then(function (a) { return fillBids(a[0], a[1][ctx.st], ctx.st, S.list, ctx.stName); }); },
      rent: function () { return getJSON('/data/cash-rent/' + ctx.st + '.json').then(function (f) { return fillRent(f, S.list, ctx.stName); }); },
      sales: function () { return salesP.then(function (f) { return fillSales(f, S.list, ctx.st, ctx.stName); }); },
      rain: function () { return getJSON('/data/rain/' + ctx.st.toLowerCase() + '.json').then(function (f) { return fillRain(f, S.list, ctx.stName); }); }
    };
    function show(sig) {
      S.sig = sig; tap.textContent = ''; go.innerHTML = '';
      Array.prototype.forEach.call(box.querySelectorAll('.cm-sw button'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-s') === sig ? 'true' : 'false'); });
      if (!S.svg) return Promise.resolve(null);
      var p = S.fills[sig] || (S.fills[sig] = LOAD[sig]());
      if (!p.done) capEl.textContent = 'Reading the ' + sig.replace('bids', 'posted bids') + ' file…';
      return p.then(function (fl) {
        p.done = true;
        if (S.sig !== sig || !S.svg) return fl;
        Array.prototype.forEach.call(S.svg.querySelectorAll('path[data-f]'), function (el) {
          var f = el.getAttribute('data-f'), o = fl.by[f] || { k: 'none' };
          el.setAttribute('class', 'cm-' + o.k + (f === ctx.fips ? ' cm-me' : ''));
        });
        keyEl.innerHTML = fl.key.map(function (k) { return '<li><i class="cm-' + k[0] + '"></i>' + esc(k[1]) + '</li>'; }).join('') +
          '<li><i class="k-pt"></i>Corn buyer posting (' + S.svg.querySelectorAll('.cm-pt').length + ')</li><li><i class="k-ring"></i>' + RING_MI + ' mi</li><li><i class="k-you"></i>Your place</li>';
        capEl.textContent = fl.cap + ' ' + fl.src + (sig === 'drought' ? '; buyers from posted elevator bids.' : '.');
        S.svg.setAttribute('aria-label', fl.cap);
        return fl;
      });
    }
    box.querySelector('.cm-sw').addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-s]') : null;
      if (b) show(b.getAttribute('data-s'));
    });
    var mapP = geoP.then(function (geo) {
      if (ctx.mine && !ctx.mine()) return null;
      if (!geo || !geo.c || !geo.c.length) { capEl.textContent = 'The ' + ctx.stName + ' county outlines did not load. Refresh in a minute.'; return null; }
      S.list = geo.c.map(function (c) { return c[0]; });
      var P = projector(geo, ctx.st);
      mapBox.innerHTML = svg(geo, { st: ctx.st, fips: ctx.fips, fills: {}, lat: ctx.lat, lng: ctx.lng, label: ctx.stName + ' counties' });
      S.svg = mapBox.querySelector('svg'); S.P = P;
      S.svg.addEventListener('click', function (e) {
        var t = e.target && e.target.closest ? e.target.closest('path[data-f]') : null;
        if (!t) return;
        var f = t.getAttribute('data-f'), p = S.fills[S.sig];
        (p || Promise.resolve(null)).then(function (fl) {
          var o = fl && fl.by[f];
          tap.textContent = t.getAttribute('data-n') + ': ' + (o && o.t ? o.t : 'nothing on file') + '.';
          var href = ctx.atlas ? ctx.atlas(f) : null;
          go.innerHTML = href ? '<a href="' + esc(href) + '">' + esc(t.getAttribute('data-n')) + ' county home</a>' : '';
        });
      });
      basemap(mapBox, S.svg, P, wide);
      return show(S.sig);
    });
    return Promise.all([mapP, bidP, basisP, salesP, drP]).then(function (a) {
      if (ctx.mine && !ctx.mine()) return null;
      var dr = a[4], idx = a[1][0], prev = a[1][1], bs = a[2], sales = a[3];
      var d = droughtChange(dr, ctx.fips), tb = topBid(idx, prev, ctx.lat, ctx.lng, today);
      var lines = [labelled(droughtLine(d), 'Drought'), labelled(bidLine(tb), 'Top corn bid'),
        labelled(basisLine(countyBasis(bs[0], ctx.fips, bs[1], bs[2], ctx.st, ctx.stName, ctx.name), ctx.stName, ctx.name), 'Corn basis'),
        labelled(salesLine(newSales(sales, ctx.fips, ctx.st), ctx.name), 'Land sales')];
      box.querySelector('.cm-lead').textContent = summary(lines);
      box.querySelector('.cm-side').innerHTML = linesHtml(lines);
      if (S.svg && S.P) {
        var pts = [], seen = {};
        (tb.rows || (idx ? nearCorn(idx, ctx.lat, ctx.lng, RING_MI) : [])).forEach(function (r) { var k = r.lat + ',' + r.lon; if (!seen[k]) { seen[k] = 1; pts.push(r); } });
        S.svg.querySelector('.cm-pts').innerHTML = pts.map(function (q) { return dot(S.P, q, 7, 'cm-pt'); }).join('');
        var kp = keyEl.querySelector('.k-pt');
        if (kp) kp.parentNode.lastChild.textContent = 'Corn buyer posting (' + pts.length + ')';
      }
      box.setAttribute('data-cm', 'ready');
      return lines;
    });
  }

  /* the line functions are re-exported, so a reader of this file sees one set of lines */
  var out = { svg: svg, draw: draw, projector: projector, fillDrought: fillDrought, fillBids: fillBids, fillRent: fillRent, fillSales: fillSales, fillRain: fillRain, rainWeek: rainWeek, SIGNALS: SIGNALS, TILES: TILES, TILE_ATTR: TILE_ATTR };
  Object.keys(L).forEach(function (k) { if (!(k in out)) out[k] = L[k]; });
  return out;
});
