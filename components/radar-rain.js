/* radar-rain.js: reads data/radar-rain/<st>.bin (written by
 * scripts/radar_rain.py) and answers "how much at this point".
 * No page code here; components/radar-rain-page.js draws /rain-radar.
 *
 * File: "RR01", uint32 LE header length, header JSON, then one zlib blob
 * per window. Each blob is the gradient-predictor residual (cell minus
 * left + above - above-left) of a grid in hundredths of an inch, -1 = no
 * data, row-major, north row first. A window with "base" is stored as its
 * difference from that window. Cell (r, c) center: lat = y0 - r*d,
 * lon = x0 + c*d. */
(function (root) {
  'use strict';

  function inflate(bytes) {
    if (typeof DecompressionStream !== 'function') return Promise.reject(new Error('no-inflate'));
    var ds = new DecompressionStream('deflate');
    var out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return out.arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  function undo(res, ny, nx) {
    // 2-D running sum, the inverse of the encoder's predictor
    var q = new Int32Array(ny * nx), r, c, i;
    for (r = 0; r < ny; r++) {
      var run = 0;
      for (c = 0; c < nx; c++) {
        i = r * nx + c;
        run += res[i];
        q[i] = run + (r ? q[i - nx] : 0);
      }
    }
    return q;
  }

  function parse(buf) {
    var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (u8.length < 8 || String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'RR01') return Promise.reject(new Error('bad-file'));
    var n = u8[4] | (u8[5] << 8) | (u8[6] << 16) | (u8[7] << 24);
    var h;
    try { h = JSON.parse(new TextDecoder('utf-8').decode(u8.subarray(8, 8 + n))); } catch (e) { return Promise.reject(new Error('bad-header')); }
    var base = 8 + n, grids = {};
    var chain = Promise.resolve();
    (h.windows || []).forEach(function (w) {
      chain = chain.then(function () {
        return inflate(u8.slice(base + w.off, base + w.off + w.len)).then(function (raw) {
          var cells = h.nx * h.ny;
          var size = w.t === 'i4' ? 4 : 2;
          if (raw.length !== cells * size) throw new Error('bad-size');
          var ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + cells * size);
          var res = size === 4 ? new Int32Array(ab) : new Int16Array(ab);
          var q = undo(res, h.ny, h.nx);
          if (w.base) { var b = grids[w.base]; if (!b) throw new Error('bad-base'); for (var i = 0; i < cells; i++) q[i] += b[i]; }
          grids[w.id] = q;
        });
      });
    });
    return chain.then(function () { return { header: h, grids: grids }; });
  }

  /* hundredths of an inch at the nearest cell; null outside the grid or no data */
  function lookup(h, q, lat, lon) {
    var c = Math.round((lon - h.x0) / h.d), r = Math.round((h.y0 - lat) / h.d);
    if (!(r >= 0 && r < h.ny && c >= 0 && c < h.nx) || !q) return null;
    var v = q[r * h.nx + c];
    return v < 0 ? null : v;
  }

  /* Which state file to load for a point. Index boxes are each state's box
   * plus a pad, so any box holding the point has data for it; take the one
   * where the point sits farthest from an edge (the map then has room). */
  function pickState(index, lat, lon) {
    var best = null, bestM = -1;
    var st = (index && index.states) || {};
    Object.keys(st).forEach(function (k) {
      var b = st[k];
      var m = Math.min(lon - b[0], b[2] - lon, lat - b[1], b[3] - lat);
      if (m > 0 && m > bestM) { bestM = m; best = k; }
    });
    return best;
  }

  function inches(v) { return v == null ? null : v / 100; }

  function fmtIn(v) {
    if (v == null) return 'no data';
    if (v === 0) return '0.00 in';
    return (v / 100).toFixed(2) + ' in';
  }

  /* gauge vs radar at the gauge over the last n reported days; null if any day cannot be compared */
  function gaugeWeek(g, n) {
    if (!g || !g.dates || !g.dates.length) return null;
    var k = g.dates.length, from = Math.max(0, k - n), gs = 0, rs = 0;
    for (var i = from; i < k; i++) {
      if (g.gauge[i] == null || g.radar[i] == null) return null;
      gs += g.gauge[i]; rs += g.radar[i];
    }
    if (k - from < n) return null;
    return { from: g.dates[from], to: g.dates[k - 1], days: n, gauge: gs, radar: rs };
  }

  function miles(lat1, lon1, lat2, lon2) {
    var R = 3958.8, t = Math.PI / 180;
    var dLat = (lat2 - lat1) * t, dLon = (lon2 - lon1) * t;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * t) * Math.cos(lat2 * t) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function nearestGauge(h, lat, lon, maxMi) {
    var best = null;
    (h.gauges || []).forEach(function (g) {
      var m = miles(lat, lon, g.ll[1], g.ll[0]);
      if (m <= maxMi && (!best || m < best.mi)) best = { g: g, mi: m };
    });
    return best;
  }

  var api = { parse: parse, lookup: lookup, pickState: pickState, inches: inches, fmtIn: fmtIn,
              gaugeWeek: gaugeWeek, nearestGauge: nearestGauge, miles: miles, undo: undo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AgRadarRain = api;
})(typeof window !== 'undefined' ? window : this);
