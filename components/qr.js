/* components/qr.js: a small QR code encoder (byte mode, error correction
   level M, versions 1 to 10) that returns an inline SVG (window.AgQR).
   A line-for-line port of scripts/qr_svg.py, which the build's selftest
   checks against a symbol jsQR decoded; test/arc-plc-math.test.mjs checks
   this file gives the same symbol as the Python one for county URLs and that
   jsQR reads them back. Used by the counter sheet (/arc-plc/sheet), so the
   QR code is drawn on the reader's phone: no outside QR service.

     AgQR.matrix(text)  -> rows of booleans (true = dark), no quiet zone
     AgQR.svg(text, label) -> '<svg class="qr" ...>' */
(function (w) {
  'use strict';
  if (w.AgQR) return;

  var ECC_PER_BLOCK = [null, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  var NUM_BLOCKS = [null, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  var FORMAT_M = 0;

  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = ((z << 1) ^ ((z >> 7) * 0x11D)) & 0x1FF;
      z ^= ((y >> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(degree) {
    var result = [], root = 1, i, j;
    for (i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    for (i = 0; i < degree; i++) {
      for (j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    var result = divisor.map(function () { return 0; });
    data.forEach(function (b) {
      var factor = b ^ result.shift();
      result.push(0);
      for (var i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor);
    });
    return result;
  }
  function rawModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var na = Math.floor(ver / 7) + 2;
      result -= (25 * na - 10) * na - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }
  function dataCodewords(ver) { return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver]; }
  function alignPositions(ver) {
    if (ver === 1) return [];
    var size = ver * 4 + 17, na = Math.floor(ver / 7) + 2;
    var step = Math.floor((ver * 4 + na * 2 + 1) / (na * 2 - 2)) * 2, out = [];
    for (var i = 0; i < na - 1; i++) out.push(size - 7 - i * step);
    out.push(6);
    return out.reverse();
  }
  function utf8(text) {
    var out = [], s = unescape(encodeURIComponent(text));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }
  function encodeData(data, ver) {
    var bits = [];
    function put(val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); }
    put(4, 4);
    put(data.length, ver <= 9 ? 8 : 16);
    data.forEach(function (b) { put(b, 8); });
    var cap = dataCodewords(ver) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, ((-bits.length) % 8 + 8) % 8);
    var pad = 0xEC;
    while (bits.length < cap) { put(pad, 8); pad ^= 0xEC ^ 0x11; }
    var out = [];
    for (var i = 0; i < bits.length; i += 8) { var v = 0; for (var j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; out.push(v); }
    return out;
  }
  function interleave(data, ver) {
    var nb = NUM_BLOCKS[ver], el = ECC_PER_BLOCK[ver], raw = Math.floor(rawModules(ver) / 8);
    var nshort = nb - raw % nb, shortlen = Math.floor(raw / nb), div = rsDivisor(el), blocks = [], k = 0, i, j;
    for (i = 0; i < nb; i++) {
      var dat = data.slice(k, k + shortlen - el + (i < nshort ? 0 : 1));
      k += dat.length;
      var ecc = rsRemainder(dat, div);
      if (i < nshort) dat = dat.concat([0]);
      blocks.push(dat.concat(ecc));
    }
    var out = [];
    for (i = 0; i < blocks[0].length; i++) for (j = 0; j < blocks.length; j++) if (i !== shortlen - el || j >= nshort) out.push(blocks[j][i]);
    return out;
  }
  function count(s, pat) { var n = 0, i = s.indexOf(pat); while (i >= 0) { n++; i = s.indexOf(pat, i + 1); } return n; }
  function penalty(m) {
    var n = m.length, p = 0, x, y;
    var cols = m[0].map(function (_v, c) { return m.map(function (row) { return row[c]; }); });
    [m, cols].forEach(function (lines) {
      lines.forEach(function (row) {
        var run = 0, prev = null;
        row.forEach(function (v) {
          if (v === prev) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; } else { run = 1; prev = v; }
        });
        var s = row.map(function (v) { return v ? '1' : '0'; }).join('');
        p += 40 * (count(s, '10111010000') + count(s, '00001011101'));
      });
    });
    for (y = 0; y < n - 1; y++) for (x = 0; x < n - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
    var dark = 0;
    m.forEach(function (row) { row.forEach(function (v) { if (v) dark++; }); });
    var total = n * n, k = Math.floor((Math.abs(dark * 20 - total * 10) + total - 1) / total) - 1;
    return p + Math.max(0, k) * 10;
  }
  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x, y) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return x * y % 2 + x * y % 3 === 0; },
    function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
    function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }
  ];

  function matrix(text, mask) {
    var data = utf8(text), ver = null, v, i, j, x, y;
    for (v = 1; v <= 10; v++) if (data.length + (v <= 9 ? 2 : 3) <= dataCodewords(v)) { ver = v; break; }
    if (ver === null) throw new Error('text too long for a version 10 QR code at level M');
    var size = ver * 4 + 17, mod = [], fn = [];
    for (y = 0; y < size; y++) { mod.push([]); fn.push([]); for (x = 0; x < size; x++) { mod[y].push(false); fn[y].push(false); } }
    function setf(x, y, dark) { mod[y][x] = dark; fn[y][x] = true; }
    for (i = 0; i < size; i++) { setf(6, i, i % 2 === 0); setf(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var xx = c[0] + dx, yy = c[1] + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setf(xx, yy, d !== 2 && d !== 4);
      }
    });
    var al = alignPositions(ver), na = al.length;
    for (i = 0; i < na; i++) for (j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) setf(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    function drawFormat(msk) {
      var d = FORMAT_M << 3 | msk, rem = d, k;
      for (k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
      var bits = (d << 10 | rem) ^ 0x5412, b = [];
      for (k = 0; k < 15; k++) b.push(((bits >> k) & 1) === 1);
      for (k = 0; k < 6; k++) setf(8, k, b[k]);
      setf(8, 7, b[6]); setf(8, 8, b[7]); setf(7, 8, b[8]);
      for (k = 9; k < 15; k++) setf(14 - k, 8, b[k]);
      for (k = 0; k < 8; k++) setf(size - 1 - k, 8, b[k]);
      for (k = 8; k < 15; k++) setf(8, size - 15 + k, b[k]);
      setf(8, size - 8, true);
    }
    drawFormat(0);
    if (ver >= 7) {
      var rem = ver;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1F25);
      var vb = ver << 12 | rem;
      for (i = 0; i < 18; i++) { var bt = ((vb >> i) & 1) === 1, a = size - 11 + i % 3, b2 = Math.floor(i / 3); setf(a, b2, bt); setf(b2, a, bt); }
    }
    var cw = interleave(encodeData(data, ver), ver), bi = 0, right = size - 1;
    while (right >= 1) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (j = 0; j < 2; j++) {
        x = right - j;
        var upward = ((right + 1) & 2) === 0;
        y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && bi < cw.length * 8) { mod[y][x] = ((cw[bi >> 3] >> (7 - (bi & 7))) & 1) === 1; bi++; }
      }
      right -= 2;
    }
    var base = mod.map(function (r) { return r.slice(); }), best = null;
    var masks = mask == null ? [0, 1, 2, 3, 4, 5, 6, 7] : [mask];
    masks.forEach(function (msk) {
      var m = base.map(function (r) { return r.slice(); });
      for (var yy = 0; yy < size; yy++) for (var xx = 0; xx < size; xx++) if (!fn[yy][xx] && MASKS[msk](xx, yy)) m[yy][xx] = !m[yy][xx];
      mod = m;
      drawFormat(msk);
      var sc = penalty(mod);
      if (best === null || sc < best[0]) best = [sc, mod.map(function (r) { return r.slice(); })];
    });
    return best[1];
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }[c]; }); }
  function svg(text, label) {
    var m = matrix(text), n = m.length + 8, d = '';
    m.forEach(function (row, y) { row.forEach(function (v, x) { if (v) d += 'M' + (x + 4) + ',' + (y + 4) + 'h1v1h-1z'; }); });
    return '<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" role="img" aria-label="' + esc(label || 'QR code') + '" ' +
      'shape-rendering="crispEdges"><rect width="' + n + '" height="' + n + '" fill="#fff"/><path fill="#000" d="' + d + '"/></svg>';
  }

  w.AgQR = { matrix: matrix, svg: svg };
})(typeof window !== 'undefined' ? window : this);
