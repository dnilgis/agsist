/* What changed here this week (god's-eye panel, build 4; Sig, Oct 27 2026: plain SVG on phones,
   no new list, sender or cron). Fast Facts "My place" loads this file only once a place is open
   (components/here.js changeMap()); nothing of it is inline in the page.

   For the open county: a sticky line (county, crop, date), one plain sentence of what changed,
   then a state map whose one fill is the drought change this week, with the corn buyers within
   50 mi, the 50 mi ring and the place. Every line carries its source and date. A line we cannot
   back with a file is withheld and says why; it is never guessed.

   Files, all already on the site, fetched by state, never with the reader's point in the URL:
     data/drought/county-week.json   this week's and last week's Drought Monitor map
     data/arc-plc/geo/<ST>.json      the state's county outlines (the ARC/PLC page's own file)
     the bids network's live index   via window.AGSIST_BIDS_NET (already loaded for the price card)
     data/bids-prev/<ST>.json        each place's last posted price on recent trading days
     data/basis-states.json          the state's middle basis
     data/prices.json                futures, to check which contract a county bid is posted against
     data/land-sales/<st>.json       recorded farm sales (Illinois, Indiana, Wisconsin)

   Rules: drought category = the worst category covering at least half the county (the panel's
   one definition). The top bid compares one delivery period only, and "same place" means the
   same posted top, never "the elevator held its price" (posted times are batch times). No
   company, buyer or seller name anywhere: the page is indexed.

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
  var summary = L.summary, linesHtml = L.linesHtml;

  /* ── the map ──────────────────────────────────────────────────────── */
  function projector(geo, st) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    var wrap = st === 'AK' ? function (lon) { return lon > 0 ? lon - 360 : lon; } : function (lon) { return lon; };
    geo.c.forEach(function (c) {
      var b = c[3];
      if (!b) return;
      var a = wrap(b[0]), z = wrap(b[2]);
      x0 = Math.min(x0, a, z); x1 = Math.max(x1, a, z); y0 = Math.min(y0, b[1]); y1 = Math.max(y1, b[3]);
    });
    var k = Math.cos((y0 + y1) / 2 * Math.PI / 180), W = 1000, sx = W / ((x1 - x0) * k), H = Math.round((y1 - y0) * sx);
    return { W: W, H: H, p: function (lon, lat) { return [(wrap(lon) - x0) * k * sx, (y1 - lat) * sx]; } };
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
  /* geo: data/arc-plc/geo/<ST>.json; fills: droughtFills().by; pts: [{lat, lon}] */
  function svg(geo, opts) {
    var P = projector(geo, opts.st), fills = opts.fills || {}, h = '';
    geo.c.forEach(function (c) {
      var f = fills[c[0]], k = f ? f.k : 'none';
      h += '<path d="' + pathOf(P, c[4]) + '" class="cm-' + k + (c[0] === opts.fips ? ' cm-me' : '') + '" data-f="' + c[0] + '" data-n="' + esc(c[1]) + '"/>';
    });
    var me = geo.c.filter(function (c) { return c[0] === opts.fips; })[0];
    if (me) h += '<path d="' + pathOf(P, me[4]) + '" class="cm-meo"/>';
    if (opts.lat != null && isFinite(opts.lat)) h += '<path d="' + ring(P, opts.lat, opts.lng, RING_MI) + '" class="cm-ring"/>';
    (opts.pts || []).forEach(function (q) { var x = P.p(q.lon, q.lat); h += '<circle cx="' + x[0].toFixed(1) + '" cy="' + x[1].toFixed(1) + '" r="7" class="cm-pt"/>'; });
    if (opts.lat != null && isFinite(opts.lat)) { var y = P.p(opts.lng, opts.lat); h += '<circle cx="' + y[0].toFixed(1) + '" cy="' + y[1].toFixed(1) + '" r="18" class="cm-you"/>'; }
    return '<svg class="cm-svg" viewBox="0 0 ' + P.W + ' ' + P.H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + esc(opts.label || '') + '">' + h + '</svg>';
  }

  /* ── drawing into the page ───────────────────────────────────────── */
  var CSS = '.cm{margin:0 0 1rem;border:1px solid var(--border);border-top:0;border-radius:0 0 10px 10px;background:var(--surface);overflow:clip}' +
    '.cm-top{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;margin:.4rem 0 0;padding:.45rem .75rem;background:var(--surface2);border:1px solid var(--border);border-radius:10px 10px 0 0;font-weight:700;font-size:.95rem;color:var(--text)}' +
    '.cm-top:empty{display:none}' +
    '.cm-top span+span::before{content:"\\00b7";margin-right:.4rem;color:var(--text-muted)}' +
    '#h-cm .cm-lead{grid-area:lead;margin:0;font-size:.95rem;font-weight:600;line-height:1.4;color:var(--text)}' +
    '.cm-grid{display:grid;grid-template-columns:minmax(0,1fr);grid-template-areas:"lead" "map" "side";gap:.35rem;padding:.45rem .75rem .7rem}' +
    '.cm-map{grid-area:map}.cm-side{grid-area:side}' +
    '.cm-map{margin:0}.cm-svg{display:block;width:100%;height:240px}' +
    '.cm-svg path{stroke:var(--bg);stroke-width:1.2;vector-effect:non-scaling-stroke}' +
    '.cm-held{fill:rgba(132,160,168,.30)}.cm-none{fill:rgba(132,160,168,.10)}' +
    '.cm-worse{fill:var(--red)}.cm-better{fill:var(--blue)}' +
    '.cm-meo,.cm-ring,.cm-pt,.cm-you{pointer-events:none}' +
    '.cm-svg path.cm-meo{fill:none;stroke:var(--text);stroke-width:2.4}' +
    '.cm-svg path.cm-ring{fill:none;stroke:var(--gold);stroke-width:1.6;stroke-dasharray:5 4}' +
    '.cm-pt{fill:var(--surface);stroke:var(--text);stroke-width:1;vector-effect:non-scaling-stroke}' +
    '.cm-you{fill:var(--gold);stroke:var(--text);stroke-width:2;vector-effect:non-scaling-stroke}' +
    '.cm-key{display:flex;flex-wrap:wrap;gap:.25rem .8rem;margin:.35rem 0 0;padding:0;list-style:none;font-size:.82rem;color:var(--text-dim)}' +
    '.cm-key i{display:inline-block;width:.8rem;height:.8rem;border-radius:2px;margin-right:.3rem;vertical-align:-.1rem}' +
    '.cm-key .cm-worse{background:var(--red)}.cm-key .cm-better{background:var(--blue)}.cm-key .cm-held{background:rgba(132,160,168,.30)}.cm-key .cm-none{background:rgba(132,160,168,.10);border:1px solid var(--border)}' +
    '.cm-key .k-pt,.cm-key .k-you{border-radius:50%}.cm-key .k-pt{background:var(--surface);border:1px solid var(--text)}.cm-key .k-you{background:var(--gold)}' +
    '.cm-key .k-ring{background:none;border:1.5px dashed var(--gold);border-radius:50%}' +
    '.cm-cap,.cm-tap{margin:.3rem 0 0;font-size:.85rem;color:var(--text-dim)}.cm-tap:empty{display:none}' +
    '.cm-lines{margin:0;padding:0;list-style:none}.cm-lines li{padding:.45rem 0;border-top:1px solid var(--border);font-size:.92rem;line-height:1.45;color:var(--text)}' +
    '.cm-lines li:first-child{border-top:0}.cm-lines b{margin-right:.3rem}' +
    '.cm-d{display:block;font-size:.8rem;color:var(--text-muted)}.cm-off{color:var(--text-dim)}' +
    '@media (min-width:900px){.cm-grid{grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);grid-template-areas:"map lead" "map side";grid-template-rows:auto 1fr;gap:.5rem 1.2rem;align-items:start}#h-cm .cm-lead{font-size:1.1rem}.cm-svg{height:420px}}' +
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

  /* ctx: {fips, st, stName, name, lat, lng, net, mine()} */
  function draw(box, ctx) {
    style();
    var today = centralDay();
    /* the one-line header sits beside the box, not in it, so it stays in view down the whole place */
    var top = typeof document !== 'undefined' && document.getElementById('cm-top');
    if (!top && box.parentNode) { top = document.createElement('div'); top.id = 'cm-top'; top.className = 'cm-top'; box.parentNode.insertBefore(top, box); }
    if (top) pinBelowNav(top);
    if (top) top.innerHTML = '<span>' + esc(shortName(ctx.name)) + ', ' + esc(ctx.st) + '</span><span>corn</span><span>' + esc(md(today)) + '</span>';
    box.innerHTML = '<div class="cm-grid"><p class="cm-lead" aria-live="polite">Reading what changed here&hellip;</p><figure class="cm-map"></figure><div class="cm-side"></div></div>';
    box.hidden = false;
    var net = ctx.net, idxP = net && net.index ? net.index() : Promise.resolve(null);
    var geoP = getJSON('/data/arc-plc/geo/' + ctx.st + '.json', 20000), drP = getJSON('/data/drought/county-week.json');
    var salesP = SALES_STATES[ctx.st] ? getJSON('/data/land-sales/' + SALES_STATES[ctx.st] + '.json') : Promise.resolve(null);
    var bidP = idxP.then(function (idx) {
      if (!idx) return [idx, {}];
      var sts = {};
      nearCorn(idx, ctx.lat, ctx.lng, RING_MI).forEach(function (r) { if (/^[A-Z]{2}$/.test(r.st)) sts[r.st] = 1; });
      var ks = Object.keys(sts);
      return Promise.all(ks.map(function (s) { return getJSON('/data/bids-prev/' + s + '.json'); })).then(function (fs) {
        var prev = {}; ks.forEach(function (s, i) { prev[s] = fs[i]; }); return [idx, prev];
      });
    });
    var basisP = Promise.all([idxP, getJSON('/data/basis-states.json'), getJSON('/data/prices.json')]);
    return Promise.all([geoP, drP, bidP, basisP, salesP]).then(function (a) {
      if (ctx.mine && !ctx.mine()) return null;
      var geo = a[0], dr = a[1], idx = a[2][0], prev = a[2][1], bs = a[3], sales = a[4];
      var d = droughtChange(dr, ctx.fips), tb = topBid(idx, prev, ctx.lat, ctx.lng, today);
      var lines = [labelled(droughtLine(d), 'Drought'), labelled(bidLine(tb), 'Top corn bid'),
        labelled(basisLine(countyBasis(bs[0], ctx.fips, bs[1], bs[2], ctx.st, ctx.stName, ctx.name), ctx.stName, ctx.name), 'Corn basis'),
        labelled(salesLine(newSales(sales, ctx.fips, ctx.st), ctx.name), 'Land sales')];
      box.querySelector('.cm-lead').textContent = summary(lines);
      box.querySelector('.cm-side').innerHTML = linesHtml(lines);
      var fig = box.querySelector('.cm-map');
      if (!geo || !geo.c || !geo.c.length) { fig.innerHTML = '<p class="cm-cap">The ' + esc(ctx.stName) + ' county outlines did not load. Refresh in a minute.</p>'; return lines; }
      var fl = droughtFills(dr, geo.c.map(function (c) { return c[0]; }));
      var pts = [], seen = {};
      (tb.rows || (idx ? nearCorn(idx, ctx.lat, ctx.lng, RING_MI) : [])).forEach(function (r) { var k = r.lat + ',' + r.lon; if (!seen[k]) { seen[k] = 1; pts.push(r); } });
      var n = fl.n, cap1 = dr ? ctx.stName + ' counties, drought category ' + md(dr.prev) + ' to ' + md(dr.valid) + ': ' + n.worse + ' worse, ' + n.better + ' eased, ' + n.held + ' held' + (n.none ? ', ' + n.none + ' with no map' : '') + '.' : 'The drought map did not load; counties are gray.';
      fig.innerHTML = svg(geo, { st: ctx.st, fips: ctx.fips, fills: fl.by, pts: pts, lat: ctx.lat, lng: ctx.lng, label: cap1 + ' ' + pts.length + ' corn buyers posting within ' + RING_MI + ' mi.' }) +
        '<ul class="cm-key"><li><i class="cm-worse"></i>Worse</li><li><i class="cm-better"></i>Eased</li><li><i class="cm-held"></i>Held</li><li><i class="cm-none"></i>No map</li>' +
        '<li><i class="k-pt"></i>Corn buyer posting (' + pts.length + ')</li><li><i class="k-ring"></i>' + RING_MI + ' mi</li><li><i class="k-you"></i>Your place</li></ul>' +
        '<figcaption class="cm-cap">' + esc(cap1) + ' U.S. Drought Monitor; buyers from posted elevator bids.</figcaption><p class="cm-tap" aria-live="polite"></p>';
      var tap = fig.querySelector('.cm-tap');
      fig.querySelector('svg').addEventListener('click', function (e) {
        var t = e.target && e.target.closest ? e.target.closest('path[data-f]') : null;
        if (!t) return;
        var f = fl.by[t.getAttribute('data-f')], dd = f && f.d, nm = t.getAttribute('data-n');
        tap.textContent = !dd || dd.status !== 'ok' ? nm + ': ' + (dd ? dd.why : 'no drought map') + '.' :
          nm + ': ' + (dd.dir === 'held' ? 'held at ' + catWords(dd.now) : (dd.dir === 'worse' ? 'worse, ' : 'eased, ') + catWords(dd.now) + ' from ' + catWords(dd.was)) + ' (' + md(dd.valid) + ' map).';
      });
      return lines;
    });
  }

  /* the line functions are re-exported, so a reader of this file sees one set of lines */
  var out = { svg: svg, draw: draw };
  Object.keys(L).forEach(function (k) { if (!(k in out)) out[k] = L[k]; });
  return out;
});
