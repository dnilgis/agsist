/* Gauge Lab reader (/gauge-lab): the pure part. No DOM, no network.
 *
 * Input is an ImageData-like object {width, height, data: RGBA bytes} and the
 * strip spec from data/gauge-strip.json. The steps:
 *
 *   1. markers   adaptive threshold (local mean from an integral image), then
 *                connected components; a marker is a dark square with a light
 *                hole in the middle. Of the candidates, the four that make the
 *                best tall rectangle with the spec's proportions win.
 *   2. rectify   a homography from the four marker centers (strip inches) to
 *                the photo, then resample the strip at R pixels per inch.
 *   3. stripe    the column with the most blue (after white balance on the
 *                paper), then the stripe's width on every row.
 *   4. level     water magnifies the stripe, so it is wide below the water
 *                and narrow above. A two-segment fit finds the step; the
 *                arrowhead pinch (narrowest row next to the step) is the line.
 *                If the stripe has no step, a dark meniscus band is tried.
 *   5. rain      inches in the tube / ratio (10), rounded to 0.01.
 *
 * Also here: the log helpers (totals, CSV, ICS, the CoCoRaHS text) so the
 * tests check the same code the page runs. components/gauge-lab.js is the
 * page code; it is the only part that touches the document.
 *
 *   node --test test/gauge-read.test.mjs
 */
(function (root) {
  'use strict';

  // ---------- image basics ----------

  function toGray(img) {
    var n = img.width * img.height, d = img.data, g = new Uint8Array(n);
    for (var i = 0, p = 0; i < n; i++, p += 4) {
      g[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
    }
    return g;
  }

  function integral(g, w, h) {
    var W = w + 1, s = new Float64Array(W * (h + 1));
    for (var y = 0; y < h; y++) {
      var row = 0;
      for (var x = 0; x < w; x++) {
        row += g[y * w + x];
        s[(y + 1) * W + x + 1] = s[y * W + x + 1] + row;
      }
    }
    return s;
  }

  // 1 where a pixel is clearly darker than its neighborhood.
  function darkMask(g, w, h, r, k) {
    var s = integral(g, w, h), W = w + 1, m = new Uint8Array(w * h);
    var X0 = new Int32Array(w), X1 = new Int32Array(w);
    for (var x = 0; x < w; x++) { X0[x] = x - r < 0 ? 0 : x - r; X1[x] = x + r + 1 > w ? w : x + r + 1; }
    k = k || 0.75;
    for (var y = 0; y < h; y++) {
      var y0 = y - r < 0 ? 0 : y - r, y1 = y + r + 1 > h ? h : y + r + 1;
      var a = y1 * W, b = y0 * W, dy = y1 - y0, row = y * w;
      for (x = 0; x < w; x++) {
        var x0 = X0[x], x1 = X1[x];
        var mean = (s[a + x1] - s[b + x1] - s[a + x0] + s[b + x0]) / (dy * (x1 - x0));
        var v = g[row + x];
        if (v < mean * k && mean - v > 14) m[row + x] = 1;
      }
    }
    return m;
  }

  // Connected components (4-neighbor) of a 0/1 mask with their stats.
  function components(mask, w, h, minArea) {
    var lab = new Int32Array(w * h), stack = new Int32Array(w * h), out = [], id = 0;
    minArea = minArea || 1;
    for (var start = 0; start < w * h; start++) {
      if (!mask[start] || lab[start]) continue;
      id++;
      var sp = 0, area = 0, sx = 0, sy = 0, minx = w, maxx = 0, miny = h, maxy = 0;
      stack[sp++] = start; lab[start] = id;
      while (sp) {
        var p = stack[--sp], x = p % w, y = (p - x) / w;
        area++; sx += x; sy += y;
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
        if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && !lab[p - w]) { lab[p - w] = id; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !lab[p + w]) { lab[p + w] = id; stack[sp++] = p + w; }
      }
      if (area >= minArea) {
        out.push({ id: id, area: area, cx: sx / area + 0.5, cy: sy / area + 0.5,
          minx: minx, maxx: maxx, miny: miny, maxy: maxy });
      }
    }
    return out;
  }

  // Square-ish dark blobs with a light hole in the middle.
  function markerCandidates(comps, mask, w, h) {
    var out = [];
    comps.forEach(function (c) {
      var bw = c.maxx - c.minx + 1, bh = c.maxy - c.miny + 1;
      if (bw < 6 || bh < 6 || bw > w / 3 || bh > h / 3) return;
      var aspect = Math.max(bw, bh) / Math.min(bw, bh);
      if (aspect > 2) return;
      var fill = c.area / (bw * bh);
      if (fill < 0.4 || fill > 0.97) return;
      // the middle fifth of the box should be mostly light (the hole)
      var hx0 = Math.round(c.minx + bw * 0.4), hx1 = Math.round(c.minx + bw * 0.6);
      var hy0 = Math.round(c.miny + bh * 0.4), hy1 = Math.round(c.miny + bh * 0.6);
      var tot = 0, light = 0;
      for (var y = hy0; y <= hy1; y++) for (var x = hx0; x <= hx1; x++) { tot++; if (!mask[y * w + x]) light++; }
      if (!tot || light / tot < 0.35) return;
      c.size = Math.sqrt(bw * bh);
      c.hole = light / tot;
      out.push(c);
    });
    return out;
  }

  function dist(a, b) { return Math.hypot(a.cx - b.cx, a.cy - b.cy); }

  // Order four points as tl, tr, bl, br (top = smaller image y), or null.
  function orderQuad(p) {
    var pairs = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]], best = null, bestD = Infinity;
    pairs.forEach(function (pp) {
      var d = dist(p[pp[0][0]], p[pp[0][1]]) + dist(p[pp[1][0]], p[pp[1][1]]);
      if (d < bestD) { bestD = d; best = pp; }
    });
    var e1 = [p[best[0][0]], p[best[0][1]]], e2 = [p[best[1][0]], p[best[1][1]]];
    var m1 = { x: (e1[0].cx + e1[1].cx) / 2, y: (e1[0].cy + e1[1].cy) / 2 };
    var m2 = { x: (e2[0].cx + e2[1].cx) / 2, y: (e2[0].cy + e2[1].cy) / 2 };
    var vx = m2.x - m1.x, vy = m2.y - m1.y;
    if (Math.abs(vy) < Math.abs(vx)) return { sideways: true };
    var top = e1, bot = e2, mt = m1, mb = m2;
    if (vy < 0) { top = e2; bot = e1; mt = m2; mb = m1; vx = -vx; vy = -vy; }
    var L = Math.hypot(vx, vy), ux = vx / L, uy = vy / L;
    function side(q, m) { return ux * (q.cy - m.y) - uy * (q.cx - m.x); } // > 0 = left
    var tl = side(top[0], mt) > 0 ? top[0] : top[1], tr = tl === top[0] ? top[1] : top[0];
    var bl = side(bot[0], mb) > 0 ? bot[0] : bot[1], br = bl === bot[0] ? bot[1] : bot[0];
    return { tl: tl, tr: tr, bl: bl, br: br };
  }

  function convex(q) {
    var pts = [q.tl, q.tr, q.br, q.bl], sgn = 0;
    for (var i = 0; i < 4; i++) {
      var a = pts[i], b = pts[(i + 1) % 4], c = pts[(i + 2) % 4];
      var cr = (b.cx - a.cx) * (c.cy - b.cy) - (b.cy - a.cy) * (c.cx - b.cx);
      var s = cr > 0 ? 1 : -1;
      if (sgn && s !== sgn) return false;
      sgn = s;
    }
    return true;
  }

  function pickMarkers(cands, spec) {
    var M = spec.markers;
    var specShort = M.tr[0] - M.tl[0], specLong = M.tl[1] - M.bl[1];
    var expRatio = specLong / specShort, expSize = M.size / specShort;
    var c = cands.slice().sort(function (a, b) { return b.area - a.area; }).slice(0, 14);
    var best = null, bestCost = Infinity, sideCost = Infinity;
    var n = c.length;
    for (var a = 0; a < n; a++) for (var b = a + 1; b < n; b++)
      for (var d = b + 1; d < n; d++) for (var e = d + 1; e < n; e++) {
        var four = [c[a], c[b], c[d], c[e]];
        var sz = four.map(function (q) { return q.size; });
        var ms = (sz[0] + sz[1] + sz[2] + sz[3]) / 4;
        var spread = Math.max.apply(null, sz.map(function (s) { return Math.abs(Math.log(s / ms)); }));
        if (spread > 0.6) continue;
        var q = orderQuad(four), turned = false;
        if (q.sideways) {
          // score it as if the photo were turned a quarter, to tell "sideways" from "not found"
          q = orderQuad(four.map(function (p) { return { cx: p.cy, cy: -p.cx, size: p.size }; }));
          turned = true;
          if (q.sideways) continue;
        }
        if (!convex(q)) continue;
        var top = dist(q.tl, q.tr), bot = dist(q.bl, q.br), lft = dist(q.tl, q.bl), rgt = dist(q.tr, q.br);
        var ratio = (lft + rgt) / (top + bot);
        var cost = Math.abs(Math.log(ratio / expRatio)) +
          Math.abs(Math.log(top / bot)) + Math.abs(Math.log(lft / rgt)) + spread +
          0.5 * Math.abs(Math.log((ms / ((top + bot) / 2)) / expSize));
        if (turned) { if (cost < sideCost) sideCost = cost; continue; }
        if (cost < bestCost) { bestCost = cost; best = q; }
      }
    if (!best || bestCost > 1.2) return { quad: null, cost: bestCost, sideways: sideCost <= 1.2 && sideCost < bestCost };
    return { quad: best, cost: bestCost };
  }

  // ---------- homography ----------

  function solve(A, b) {
    var n = b.length, i, j, k;
    for (i = 0; i < n; i++) {
      var piv = i;
      for (j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[piv][i])) piv = j;
      if (Math.abs(A[piv][i]) < 1e-12) return null;
      var t = A[i]; A[i] = A[piv]; A[piv] = t; var tb = b[i]; b[i] = b[piv]; b[piv] = tb;
      for (j = i + 1; j < n; j++) {
        var f = A[j][i] / A[i][i];
        for (k = i; k < n; k++) A[j][k] -= f * A[i][k];
        b[j] -= f * b[i];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var s = b[i];
      for (k = i + 1; k < n; k++) s -= A[i][k] * x[k];
      x[i] = s / A[i][i];
    }
    return x;
  }

  // H maps src [x,y] to dst [x,y]; four pairs. Returns 9 numbers, h[8] = 1.
  function homography(src, dst) {
    var A = [], b = [];
    for (var i = 0; i < 4; i++) {
      var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    var h = solve(A, b);
    return h ? h.concat([1]) : null;
  }

  function applyH(H, x, y) {
    var z = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / z, (H[3] * x + H[4] * y + H[5]) / z];
  }

  // Resample the strip rectangle [x0,x1] x [y0,y1] (inches, y up) at R px/in.
  function rectify(img, H, box, R) {
    var W = Math.round((box.x1 - box.x0) * R), Hh = Math.round((box.y1 - box.y0) * R);
    var out = new Uint8ClampedArray(W * Hh * 4), d = img.data, w = img.width, h = img.height;
    for (var j = 0; j < Hh; j++) {
      var y = box.y1 - (j + 0.5) / R;
      for (var i = 0; i < W; i++) {
        var x = box.x0 + (i + 0.5) / R, p = applyH(H, x, y);
        var px = p[0] - 0.5, py = p[1] - 0.5, o = (j * W + i) * 4;
        if (!(px >= 0 && py >= 0 && px < w - 1 && py < h - 1)) { out[o] = out[o + 1] = out[o + 2] = 128; out[o + 3] = 255; continue; }
        var ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy, q = (iy * w + ix) * 4;
        for (var c = 0; c < 3; c++) {
          var a = d[q + c], bb = d[q + 4 + c], cc = d[q + w * 4 + c], dd = d[q + w * 4 + 4 + c];
          out[o + c] = (a * (1 - fx) + bb * fx) * (1 - fy) + (cc * (1 - fx) + dd * fx) * fy;
        }
        out[o + 3] = 255;
      }
    }
    return { width: W, height: Hh, data: out, box: box, R: R };
  }

  function rowOf(rect, y) { return Math.round((rect.box.y1 - y) * rect.R - 0.5); }
  function colOf(rect, x) { return Math.round((x - rect.box.x0) * rect.R - 0.5); }

  function pct(arr, p) {
    var a = Array.prototype.slice.call(arr).sort(function (x, y) { return x - y; });
    if (!a.length) return 0;
    return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))];
  }

  function smooth(a, r) {
    var n = a.length, out = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      var s = 0, c = 0;
      for (var k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) { s += a[k]; c++; }
      out[i] = s / c;
    }
    return out;
  }

  // Blue-ness of every rectified pixel after balancing on the paper white.
  function blueMap(rect) {
    var d = rect.data, n = rect.width * rect.height, rs = [], gs = [], bs = [];
    for (var i = 0; i < n; i += 7) { rs.push(d[i * 4]); gs.push(d[i * 4 + 1]); bs.push(d[i * 4 + 2]); }
    var kr = 255 / Math.max(40, pct(rs, 0.9)), kg = 255 / Math.max(40, pct(gs, 0.9)), kb = 255 / Math.max(40, pct(bs, 0.9));
    var out = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var r = d[i * 4] * kr, g = d[i * 4 + 1] * kg, b = d[i * 4 + 2] * kb;
      var v = (b - Math.max(r, g)) / Math.max(b, 30);
      out[i] = v > 0 ? v : 0;
    }
    return out;
  }

  // Stripe column, then the stripe's width (inches) on every scale row.
  function stripeProfile(rect, spec) {
    var R = rect.R, W = rect.width, bl = blueMap(rect);
    var rTop = rowOf(rect, spec.scale.full_y), rBot = rowOf(rect, spec.scale.zero_y);
    var xa = Math.max(0, colOf(rect, Math.max(spec.tube.x0, spec.stripe.x - 0.6)));
    var xb = Math.min(W - 1, colOf(rect, Math.min(spec.tube.x1, spec.stripe.x + 0.6)));
    var colP = new Float64Array(xb - xa + 1);
    for (var x = xa; x <= xb; x++) {
      var s = 0;
      for (var y = rTop; y <= rBot; y++) s += bl[y * W + x];
      colP[x - xa] = s / (rBot - rTop + 1);
    }
    var sp = smooth(colP, 1), cxi = 0;
    for (x = 1; x < sp.length; x++) if (sp[x] > sp[cxi]) cxi = x;
    var cx = cxi + xa, peak = sp[cxi];
    var col = [];
    for (y = rTop; y <= rBot; y++) col.push(bl[y * W + cx]);
    var B = pct(col, 0.9);
    if (peak < 0.04 || B < 0.12) return { found: false, peak: peak, B: B };
    var hw = Math.round(0.5 * R), widths = new Float64Array(rBot - rTop + 1);
    var lo = 0.2 * B, span = 0.6 * B;
    for (y = rTop; y <= rBot; y++) {
      var acc = 0;
      for (x = Math.max(xa, cx - hw); x <= Math.min(xb, cx + hw); x++) {
        var t = (bl[y * W + x] - lo) / span;
        acc += t <= 0 ? 0 : t >= 1 ? 1 : t;
      }
      widths[rBot - y] = acc / R;       // index 0 = the zero line, going up
    }
    return { found: true, cx: cx, xIn: rect.box.x0 + (cx + 0.5) / R, B: B, peak: peak, widths: widths, rTop: rTop, rBot: rBot };
  }

  // Best single step in a 1D profile: rows [0,k) below, [k,n) above.
  function stepFit(a, minSeg) {
    var n = a.length, S = new Float64Array(n + 1), Q = new Float64Array(n + 1);
    for (var i = 0; i < n; i++) { S[i + 1] = S[i] + a[i]; Q[i + 1] = Q[i] + a[i] * a[i]; }
    var best = -1, bestC = Infinity;
    for (var k = minSeg; k <= n - minSeg; k++) {
      var s1 = S[k], q1 = Q[k], s2 = S[n] - S[k], q2 = Q[n] - Q[k];
      var c = (q1 - s1 * s1 / k) + (q2 - s2 * s2 / (n - k));
      if (c < bestC) { bestC = c; best = k; }
    }
    if (best < 0) return null;
    return { k: best, below: S[best] / best, above: (S[n] - S[best]) / (n - best), cost: bestC };
  }

  function levelFromStripe(prof, spec, R) {
    var w = smooth(prof.widths, 2), n = w.length, base = spec.stripe.width;
    var st = stepFit(w, 3);
    // A real step stands well clear of the row-to-row noise. sd is the
    // spread left after the fit, on the unsmoothed widths.
    var raw = prof.widths, sse = 0;
    if (st) for (var j = 0; j < n; j++) { var e = raw[j] - (j < st.k ? st.below : st.above); sse += e * e; }
    var sd = st ? Math.sqrt(sse / n) : 1, diff = st ? st.below - st.above : 0;
    if (!st || !(diff > 0.012 && diff > 2.5 * sd && st.below > 1.15 * st.above)) {
      // Call it empty only when the stripe is the printed width all the way up.
      var lo = pct(w, 0.1), hi = pct(w, 0.9);
      if (hi < base * 1.3 && lo > base * 0.6 && hi - lo < base * 0.35) return { kind: 'empty', level: 0 };
      if (lo > base * 1.6) return { kind: 'full' };
      return { kind: 'none' };
    }
    // the arrowhead pinch: the narrowest row near the step
    var w3 = smooth(prof.widths, 1), r = Math.round(0.35 * R), lo = Math.max(0, st.k - r), hi = Math.min(n - 1, st.k + r), m = lo;
    for (var i = lo; i <= hi; i++) if (w3[i] < w3[m]) m = i;
    var pos, method;
    if (w3[m] < 0.75 * st.above && m > lo && m < hi) {
      var a = w3[m - 1], b = w3[m], c = w3[m + 1], den = a - 2 * b + c;
      pos = m + (den > 1e-9 ? 0.5 * (a - c) / den : 0);
      method = 'arrow';
    } else {
      pos = st.k;
      method = 'step';
    }
    return { kind: 'level', level: (pos + 0.5) / R, method: method, below: st.below, above: st.above };
  }

  // Fallback: the meniscus as a thin dark band in the tube, away from the stripe.
  function levelFromMeniscus(rect, spec, stripeX) {
    var R = rect.R, W = rect.width, d = rect.data;
    var rTop = rowOf(rect, spec.scale.full_y), rBot = rowOf(rect, spec.scale.zero_y);
    var x0 = colOf(rect, spec.tube.x0 + 0.12), x1 = colOf(rect, spec.tube.x1 - 0.12);
    var sx = stripeX == null ? spec.stripe.x : stripeX, ex = Math.round(0.3 * R);
    var rows = new Float64Array(rBot - rTop + 1);
    for (var y = rTop; y <= rBot; y++) {
      var s = 0, c = 0;
      for (var x = x0; x <= x1; x++) {
        if (Math.abs(x - colOf(rect, sx)) < ex) continue;
        var o = (y * W + x) * 4; s += d[o] * 0.3 + d[o + 1] * 0.59 + d[o + 2] * 0.11; c++;
      }
      rows[rBot - y] = c ? s / c : 0;
    }
    var n = rows.length, win = Math.round(0.4 * R), best = -1, bestV = 0;
    var sm = smooth(rows, 1);
    for (var i = 2; i < n - 2; i++) {
      var nb = [];
      for (var k = Math.max(0, i - win); k <= Math.min(n - 1, i + win); k += 2) nb.push(sm[k]);
      var v = pct(nb, 0.5) - sm[i];
      if (v > bestV) { bestV = v; best = i; }
    }
    if (best < 0 || bestV < 18) return null;
    var bot = best;
    while (bot > 0 && (sm[best] + bestV / 2) > sm[bot - 1]) bot--;
    return { level: (bot + 0.5) / R, strength: bestV };
  }

  function roundRain(levelIn, spec) {
    var v = Math.round(levelIn / spec.ratio * 100) / 100;
    return v < 0 ? 0 : v;
  }

  var MSG = {
    markers: "Couldn't find the four corner marks. Get the whole strip in the photo, straight on, in good light.",
    sideways: 'The strip looks sideways. Hold the phone upright so the strip runs up and down, then try again.',
    stripe: "Found the corner marks but not the blue stripe. Check that the stripe is behind the tube and not washed out by glare.",
    level: "Found the stripe but not the water line. Tap the water line on the picture to set it.",
    full: 'The tube looks full. Write down 1.00 in, empty the tube, pour the overflow from the outer can into it, read that and add the two.'
  };

  /* The whole read. opts.R = rectified pixels per inch (default 80). */
  function read(img, spec, opts) {
    opts = opts || {};
    var R = opts.R || 80, w = img.width, h = img.height;
    var g = toGray(img);
    var r = Math.max(8, Math.round(Math.max(w, h) / 16));
    var mask = darkMask(g, w, h, r, 0.75);
    var minA = Math.max(20, Math.round(w * h / 40000));
    var comps = components(mask, w, h, minA);
    var cands = markerCandidates(comps, mask, w, h);
    var pick = pickMarkers(cands, spec);
    if (!pick.quad) {
      var code = pick.sideways ? 'sideways' : 'markers';
      var msg = MSG[code];
      if (code === 'markers' && cands.length < 4) msg += ' (Found ' + cands.length + ' of 4.)';
      return { ok: false, code: code, message: msg, candidates: cands.length };
    }
    var q = pick.quad, M = spec.markers;
    var H = homography([M.tl, M.tr, M.bl, M.br],
      [[q.tl.cx, q.tl.cy], [q.tr.cx, q.tr.cy], [q.bl.cx, q.bl.cy], [q.br.cx, q.br.cy]]);
    if (!H) return { ok: false, code: 'markers', message: MSG.markers };
    var box = { x0: 0, x1: spec.width, y0: spec.scale.zero_y - 0.3, y1: spec.scale.full_y + 0.3 };
    var rect = rectify(img, H, box, R);
    var base = { markers: q, H: H, rect: rect, markerCost: pick.cost };
    var prof = stripeProfile(rect, spec);
    var res = null;
    if (prof.found) {
      res = levelFromStripe(prof, spec, R);
      base.stripeX = prof.xIn;
      base.widths = prof.widths;
      if (res.kind === 'full') return assign(base, { ok: false, code: 'full', message: MSG.full });
      if (res.kind === 'empty') return assign(base, { ok: true, levelIn: 0, rain: 0, method: 'empty', note: 'No water found in the tube.' });
      if (res.kind === 'level') return assign(base, { ok: true, levelIn: res.level, rain: roundRain(res.level, spec), method: res.method });
    }
    var men = levelFromMeniscus(rect, spec, prof.found ? prof.xIn : null);
    if (men) {
      return assign(base, { ok: true, levelIn: men.level, rain: roundRain(men.level, spec), method: 'meniscus',
        note: prof.found ? 'Read from the meniscus, not the stripe. Check it.' : 'No blue stripe found. Read from the meniscus. Check it.' });
    }
    var c2 = prof.found ? 'level' : 'stripe';
    return assign(base, { ok: false, code: c2, message: MSG[c2] });
  }

  function assign(a, b) { for (var k in b) a[k] = b[k]; return a; }

  // Strip y (inches) for a rectified pixel row, and back.
  function yOfRow(rect, row) { return rect.box.y1 - (row + 0.5) / rect.R; }
  function rowOfY(rect, y) { return (rect.box.y1 - y) * rect.R - 0.5; }

  // ---------- log helpers ----------

  function cleanGaugeId(s) {
    s = String(s == null ? '' : s).trim();
    return /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : '';
  }

  function fmtRain(v) { return (Math.round(v * 100) / 100).toFixed(2) + ' in'; }

  // entries: {id, when: 'YYYY-MM-DDTHH:MM', rain: number, src}
  function sortLog(list) {
    return list.slice().sort(function (a, b) { return a.when < b.when ? 1 : a.when > b.when ? -1 : 0; });
  }

  function sum(list) {
    var c = 0;
    list.forEach(function (e) { c += Math.round(e.rain * 100); });
    return c / 100;
  }

  // month: 'YYYY-MM'; seasonStart: 'YYYY-MM-DD'
  function totals(list, month, seasonStart) {
    return {
      month: sum(list.filter(function (e) { return e.when.slice(0, 7) === month; })),
      season: sum(list.filter(function (e) { return e.when.slice(0, 10) >= seasonStart; })),
      count: list.length
    };
  }

  function csvCell(s) { s = String(s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

  function toCSV(list, gaugeId) {
    var rows = ['date,time,rain_in,source,gauge_id'];
    sortLog(list).reverse().forEach(function (e) {
      rows.push([e.when.slice(0, 10), e.when.slice(11, 16), e.rain.toFixed(2), e.src || '', gaugeId || ''].map(csvCell).join(','));
    });
    return rows.join('\r\n') + '\r\n';
  }

  function ymd(s) { return s.slice(0, 10).replace(/-/g, ''); }
  function nextDay(s) {
    var p = s.slice(0, 10).split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1));
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }
  function clock12(hhmm) {
    var h = +hhmm.slice(0, 2), m = hhmm.slice(3, 5), ap = h < 12 ? 'AM' : 'PM';
    h = h % 12 || 12;
    return h + ':' + m + ' ' + ap;
  }
  function icsText(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }

  // stamp: 'YYYYMMDDTHHMMSSZ'
  function toICS(list, gaugeId, stamp) {
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AGSIST//Gauge Lab//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Rain gauge' + (gaugeId ? ' ' + gaugeId : '')];
    sortLog(list).reverse().forEach(function (e) {
      L.push('BEGIN:VEVENT',
        'UID:' + e.id + (gaugeId ? '-' + gaugeId : '') + '@agsist.com',
        'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + ymd(e.when),
        'DTEND;VALUE=DATE:' + nextDay(e.when),
        'SUMMARY:' + icsText(fmtRain(e.rain) + ' rain'),
        'DESCRIPTION:' + icsText('Read at ' + clock12(e.when.slice(11, 16)) + (gaugeId ? '. Gauge ' + gaugeId : '') + '.'),
        'TRANSP:TRANSPARENT',
        'END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.join('\r\n') + '\r\n';
  }

  function cocorahsText(e) {
    var p = e.when.slice(0, 10).split('-');
    return 'Observation date: ' + p[1] + '/' + p[2] + '/' + p[0] + '\n' +
      'Observation time: ' + clock12(e.when.slice(11, 16)) + '\n' +
      'Rain and melted snow: ' + e.rain.toFixed(2) + ' in';
  }

  var API = {
    toGray: toGray, darkMask: darkMask, components: components, markerCandidates: markerCandidates,
    orderQuad: orderQuad, pickMarkers: pickMarkers, homography: homography, applyH: applyH,
    rectify: rectify, stripeProfile: stripeProfile, stepFit: stepFit, levelFromStripe: levelFromStripe,
    levelFromMeniscus: levelFromMeniscus, roundRain: roundRain, read: read, MSG: MSG,
    yOfRow: yOfRow, rowOfY: rowOfY,
    cleanGaugeId: cleanGaugeId, fmtRain: fmtRain, sortLog: sortLog, totals: totals,
    toCSV: toCSV, toICS: toICS, cocorahsText: cocorahsText, clock12: clock12
  };
  root.GaugeRead = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
