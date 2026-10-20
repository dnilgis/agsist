/* /basis#map: the state basis map, drawn only when the reader opens it.

   Same numbers as the "Basis in every state" table under it (data/basis-states.json,
   scripts/basis_method.py): the middle basis of the AGSIST network elevators in each
   state, against the futures month most of them name. Outlines are
   data/us-states.geo.json, which the site already carries. Nothing here is in the
   page until the reader taps "Show the map" (site rule: depth on demand).

   Color says one thing: how far under or over futures the state's middle bid is.
   Two hues and a gray middle, in the page's own weaker/stronger colors. A state with
   too few elevators on one futures month is outlined and left empty, never filled in. */
(function (root) {
  'use strict';

  /* Cents bands. Gray is within 10 cents of futures either way. */
  var BANDS = [
    { max: -60, side: 'neg', op: 0.9,  label: '60¢ or more under' },
    { max: -30, side: 'neg', op: 0.6,  label: '30 to 60¢ under' },
    { max: -10, side: 'neg', op: 0.32, label: '10 to 30¢ under' },
    { max:  10, side: 'mid', op: 0.4,  label: 'within 10¢' },
    { max:  30, side: 'pos', op: 0.32, label: '10 to 30¢ over' },
    { max:  60, side: 'pos', op: 0.6,  label: '30 to 60¢ over' },
    { max: Infinity, side: 'pos', op: 0.9, label: '60¢ or more over' }
  ];
  function band(c) {
    for (var i = 0; i < BANDS.length; i++) {
      if (i < 3 ? c <= BANDS[i].max : c < BANDS[i].max) return i;
    }
    return BANDS.length - 1;
  }

  /* Albers equal-area conic for the lower 48 (USGS parallels 29.5 and 45.5). */
  var D = Math.PI / 180, P1 = 29.5 * D, P2 = 45.5 * D, L0 = -96 * D, F0 = 37.5 * D;
  var N = (Math.sin(P1) + Math.sin(P2)) / 2, C = Math.cos(P1) * Math.cos(P1) + 2 * N * Math.sin(P1);
  var R0 = Math.sqrt(C - 2 * N * Math.sin(F0)) / N;
  function albers(lon, lat) {
    var r = Math.sqrt(C - 2 * N * Math.sin(lat * D)) / N, t = N * (lon * D - L0);
    return [r * Math.sin(t), R0 - r * Math.cos(t)];
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  /* The table under the map prints the median to the quarter cent (AG.px.basis: +12½¢); the map
     used to round it to whole cents (+13¢). One formatter for both (audit N13, Oct 17). */
  function cents(c) {
    if (window.AG && AG.px && AG.px.basis) return AG.px.basis(c);
    var r = Math.round(c); return r === 0 ? 'even' : (r > 0 ? '+' : '−') + Math.abs(r) + '¢';
  }

  /* -> {paths: [{st, d, cx, cy, area}], w, h} for the lower 48 */
  function project(geo, W) {
    var feats = (geo.features || []).filter(function (f) {
      var p = f.properties || {};
      return p.iso_a2 === 'US' && p.postal !== 'AK' && p.postal !== 'HI';
    });
    var polys = [], x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    feats.forEach(function (f) {
      var g = f.geometry, rings = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      var pr = rings.map(function (poly) {
        return poly.map(function (ring) {
          return ring.map(function (pt) {
            var q = albers(pt[0], pt[1]);
            if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0];
            if (-q[1] < y0) y0 = -q[1]; if (-q[1] > y1) y1 = -q[1];
            return [q[0], -q[1]];
          });
        });
      });
      polys.push({ st: f.properties.postal, rings: pr });
    });
    var k = W / (x1 - x0), H = Math.round((y1 - y0) * k);
    var paths = polys.map(function (p) {
      var d = '', best = null, bestA = 0;
      p.rings.forEach(function (poly) {
        poly.forEach(function (ring, ri) {
          var a = 0, sx = 0, sy = 0;
          d += ring.map(function (pt, i) {
            var x = (pt[0] - x0) * k, y = (pt[1] - y0) * k;
            if (ri === 0 && i) {
              var px = (ring[i - 1][0] - x0) * k, py = (ring[i - 1][1] - y0) * k, cr = px * y - x * py;
              a += cr; sx += (px + x) * cr; sy += (py + y) * cr;
            }
            return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
          }).join('') + 'Z';
          if (ri === 0 && Math.abs(a) > bestA) { bestA = Math.abs(a); best = [sx / (3 * a), sy / (3 * a)]; }
        });
      });
      return { st: p.st, d: d, cx: best ? best[0] : 0, cy: best ? best[1] : 0, area: bestA / 2 };
    });
    return { paths: paths, w: W, h: H };
  }

  /* Small eastern states get no label on the map; the table below has them. */
  var MIN_LABEL_AREA = 900;

  function draw(host, geo, doc, crop) {
    var W = 960, m = project(geo, W), states = doc.states || {};
    var s = ['<svg class="bm-svg" viewBox="0 0 ' + W + ' ' + m.h + '" role="img" aria-labelledby="bm-t">'
      + '<title id="bm-t">Map of middle ' + (crop === 'corn' ? 'corn' : 'soybean') + ' basis by state, AGSIST network elevators. The same numbers are in the state table below.</title>'];
    var labels = [];
    m.paths.forEach(function (p) {
      var v = states[p.st], c = v && v.crops && v.crops[crop];
      var has = c && c.median != null, cv = has ? Math.round(c.median * 10000) / 100 : null;
      var fill = 'none', op = 1, cls = 'bm-st';
      if (has) {
        var b = BANDS[band(cv)];
        fill = b.side === 'neg' ? 'var(--bs-neg)' : b.side === 'pos' ? 'var(--bs-pos)' : 'var(--bm-mid)';
        op = b.op; cls += ' bm-has';
      }
      var tip = has
        ? (v.name + ': ' + cents(cv) + ' vs ' + c.label + ', n = ' + c.n + ' elevator' + (c.n === 1 ? '' : 's'))
        : (v ? v.name + ': too few elevators on one futures month for a middle number' : p.st + ': no elevators in the network');
      var a = has && v.path ? '<a href="' + esc(v.path) + '" class="bm-a" data-tip="' + esc(tip) + '" aria-label="' + esc(tip) + '">' : '';
      s.push(a + '<path class="' + cls + '" d="' + p.d + '" style="fill:' + fill + ';fill-opacity:' + op + '"'
        + (a ? '' : ' data-tip="' + esc(tip) + '"') + '><title>' + esc(tip) + '</title></path>' + (a ? '</a>' : ''));
      if (has && p.area >= MIN_LABEL_AREA) labels.push('<text x="' + p.cx.toFixed(1) + '" y="' + p.cy.toFixed(1) + '" class="bm-lab">' + esc(cents(cv)) + '</text>');
    });
    s.push('<g aria-hidden="true">' + labels.join('') + '</g></svg>');
    var legend = '<div class="bm-leg" aria-label="Legend">' + BANDS.map(function (b) {
      var fill = b.side === 'neg' ? 'var(--bs-neg)' : b.side === 'pos' ? 'var(--bs-pos)' : 'var(--bm-mid)';
      return '<span class="bm-key"><i style="background:' + fill + ';opacity:' + b.op + '"></i>' + b.label + '</span>';
    }).join('') + '<span class="bm-key"><i class="bm-none"></i>too few elevators</span></div>';
    host.innerHTML = s.join('') + legend
      + '<p class="bm-tip" id="bm-tip" aria-live="polite">Tap or point at a state. Each state is against the futures month most of its elevators name; the table below says which.</p>'
      + '<p class="bm-foot">AGSIST network elevators, snapshot of ' + esc(String(doc.generated || '').slice(0, 10))
      + '. Middle bid (median), n = elevators. Not every elevator in the state.</p>';
    var tipEl = host.querySelector('#bm-tip');
    function show(e) {
      var t = e.target && e.target.closest && e.target.closest('[data-tip]');
      if (t && tipEl) tipEl.textContent = t.getAttribute('data-tip');
    }
    host.addEventListener('mouseover', show);
    host.addEventListener('focusin', show);
  }

  var cache = null;
  function open(host, crop) {
    if (!host) return;
    if (!cache) {
      host.innerHTML = '<p class="bm-tip">Drawing the map.</p>';
      cache = Promise.all([
        fetch('/data/us-states.geo.json').then(function (r) { if (!r.ok) throw 0; return r.json(); }),
        fetch('/data/basis-states.json', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw 0; return r.json(); })
      ]);
    }
    cache.then(function (res) { draw(host, res[0], res[1], crop); }).catch(function () {
      cache = null;
      host.innerHTML = '<p class="bm-tip">The map did not load. The state table below has the same numbers.</p>';
    });
  }

  var api = { open: open, band: band, BANDS: BANDS, albers: albers, project: project };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BasisMap = api;
})(typeof window !== 'undefined' ? window : this);
