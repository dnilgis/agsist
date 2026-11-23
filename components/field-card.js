/* components/field-card.js: the Field Report picture (Nov 23, 2026).
   One 1200 x 630 picture of a field's read, drawn on a canvas in the reader's own browser and
   never on a server, so the field's outline and place stay on the phone until the reader sends
   the picture. It shows only what the read on the page shows, in the same words and numbers:
   acres and county, the three largest soils with their share, NCCPI (and CSR2 in Iowa), the
   crop at the field center for each of ten years, and rain since Jan 1 against normal, each
   with its source and date. No coordinates and no outline are drawn.

   Field Scout's read builds the model (field-scout-read.js cardModel); this file only draws it.

     AgFieldCard.lines(model)            -> every string the picture prints, in order (the tests)
     AgFieldCard.draw(canvas, model, k)  -> draws at k times 1200 x 630 (2 for a sharp phone picture)
     AgFieldCard.blob(model, k, done)    -> done(PNG Blob or null)
     AgFieldCard.fileName(model)         -> agsist-field-93-acres-hamilton-county-ia.png
   module.exports for node (lines, fileName, layout only). */
(function (root) {
  'use strict';
  var W = 1200, H = 630, PAD = 48;
  var FONT = 'Inter, system-ui, -apple-system, Segoe UI, sans-serif';
  var MONO = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
  var BG = '#0a0c0d', INK = '#e9edeb', DIM = 'rgba(233,237,235,.72)', GOLD = '#d4a23f', RULE = 'rgba(233,237,235,.14)';
  // the soil bar: three soils and the rest; colors that stay apart for every kind of color vision
  var SOIL = ['#d4a23f', '#5fa8d3', '#9bc36b'], REST = '#4a5257';

  function pctText(p) { return p + '%'; }
  function soilLabel(s) { return s.name + ' ' + pctText(s.pct); }
  function chipYears(m) { return m.chips && m.chips.length ? m.chips[0].y + ' to ' + m.chips[m.chips.length - 1].y : ''; }
  function sourceText(m) {
    var s = [];
    if (m.src && m.src.soil) s.push(m.src.soil);
    if (m.src && m.src.crops) s.push(m.src.crops);
    if (m.src && m.src.rain) s.push(m.src.rain);
    return s.join(' · ');
  }
  // every string the picture prints, in the order it prints them
  function lines(m) {
    var out = ['agsist', '.com', 'FIELD SCOUT · ' + m.made, m.acres + ' acres', m.place];
    if (m.soils && m.soils.length) {
      out.push('SOILS');
      m.soils.forEach(function (s) { out.push(soilLabel(s)); });
      if (m.restPct > 0) out.push('Other soils ' + pctText(m.restPct));
    }
    if (m.nccpi) { out.push('NCCPI, 0 TO 1', m.nccpi); if (m.nccpiParts) out.push(m.nccpiParts); }
    if (m.csr2) { out.push('CSR2, 0 TO 100', m.csr2, 'Iowa corn suitability'); }
    if (m.rain) { out.push('RAIN SINCE JAN 1', m.rain.inches + ' in'); if (m.rain.pct != null) out.push(m.rain.pct + '% of normal'); }
    if (m.chips && m.chips.length) {
      out.push('CROP AT THE FIELD CENTER, ' + chipYears(m));
      m.chips.forEach(function (c) { out.push(String(c.y), c.l); });
    }
    var src = sourceText(m); if (src) out.push(src);
    out.push('agsist.com/field-scout');
    return out;
  }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function fileName(m) { return 'agsist-field-' + Math.round(parseFloat(m.acres) || 0) + '-acres' + (m.slug ? '-' + slug(m.slug) : '') + '.png'; }

  // light or dark letters on a chip of color c
  function lum(c) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c || ''); if (!m) return 0.3;
    var f = function (h) { var v = parseInt(h, 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(m[1]) + 0.7152 * f(m[2]) + 0.0722 * f(m[3]);
  }
  function fit(x, text, weight, sizes, family, max) {
    for (var i = 0; i < sizes.length; i++) { x.font = weight + ' ' + sizes[i] + 'px ' + family; if (x.measureText(text).width <= max) return sizes[i]; }
    return sizes[sizes.length - 1];
  }
  function clip(x, text, max) {
    if (x.measureText(text).width <= max) return text;
    var t = text; while (t.length > 1 && x.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t.replace(/\s+$/, '') + '…';
  }
  // words into at most n lines of max width at the current font
  function wrap(x, text, max, n) {
    var words = String(text).split(' '), out = [], cur = '';
    words.forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (x.measureText(t).width <= max || !cur) cur = t; else { out.push(cur); cur = w; } });
    if (cur) out.push(cur);
    if (out.length > n) { out = out.slice(0, n); out[n - 1] = clip(x, out[n - 1] + '…', max); }
    return out;
  }

  function draw(canvas, m, k) {
    k = k || 2;
    canvas.width = W * k; canvas.height = H * k;
    var x = canvas.getContext('2d'); if (!x) return false;
    x.setTransform(k, 0, 0, k, 0, 0);
    x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    x.fillStyle = BG; x.fillRect(0, 0, W, H);
    x.fillStyle = GOLD; x.fillRect(0, 0, W, 10);
    // the mark and the kicker
    x.font = '800 34px ' + FONT; x.fillStyle = INK; x.fillText('agsist', PAD, 62);
    var aw = x.measureText('agsist').width; x.font = '700 20px ' + FONT; x.fillStyle = GOLD; x.fillText('.com', PAD + 2 + aw, 62);
    x.font = '600 17px ' + MONO; x.fillStyle = DIM; x.textAlign = 'right'; x.fillText('FIELD SCOUT · ' + m.made, W - PAD, 58); x.textAlign = 'left';
    // the headline: acres, then the county on the same line when it fits
    var y = 132, head = m.acres + ' acres';
    x.font = '800 60px ' + FONT; x.fillStyle = INK; x.fillText(head, PAD, y);
    var hw = x.measureText(head).width + 22;
    var ps = fit(x, m.place, '600', [32, 28, 24], FONT, W - PAD * 2 - hw);
    x.font = '600 ' + ps + 'px ' + FONT;
    if (x.measureText(m.place).width <= W - PAD * 2 - hw) { x.fillStyle = DIM; x.fillText(m.place, PAD + hw, y); y += 30; }
    else { y += 40; x.font = '600 28px ' + FONT; x.fillStyle = DIM; x.fillText(clip(x, m.place, W - PAD * 2), PAD, y); y += 22; }

    // soils: one bar, then its key
    if (m.soils && m.soils.length) {
      y += 18;
      x.font = '600 15px ' + MONO; x.fillStyle = DIM; x.fillText('SOILS', PAD, y); y += 12;
      var bw = W - PAD * 2, bx = PAD, segs = m.soils.map(function (s, i) { return { p: s.pct, c: SOIL[i] }; });
      if (m.restPct > 0) segs.push({ p: m.restPct, c: REST });
      var tot = segs.reduce(function (a, s) { return a + s.p; }, 0) || 1;
      segs.forEach(function (s, i) {
        var w = bw * s.p / tot; x.fillStyle = s.c; x.fillRect(bx, y, Math.max(0, w - (i < segs.length - 1 ? 3 : 0)), 30); bx += w;
      });
      y += 30 + 30;
      var keys = m.soils.map(function (s, i) { return { t: soilLabel(s), c: SOIL[i] }; });
      if (m.restPct > 0) keys.push({ t: 'Other soils ' + pctText(m.restPct), c: REST });
      var colW = (W - PAD * 2) / keys.length, ks = 19;
      keys.forEach(function (kk) { ks = Math.min(ks, fit(x, kk.t, '500', [19, 17, 15, 14], FONT, colW - 34)); });
      keys.forEach(function (kk, i) {
        var kx = PAD + i * colW; x.fillStyle = kk.c; x.fillRect(kx, y - 13, 14, 14);
        x.font = '500 ' + ks + 'px ' + FONT; x.fillStyle = INK; x.fillText(clip(x, kk.t, colW - 34), kx + 22, y);
      });
      y += 18;
    }

    // the figures: NCCPI, CSR2 (Iowa), rain since Jan 1
    var figs = [];
    if (m.nccpi) figs.push({ k: 'NCCPI, 0 TO 1', v: m.nccpi, n: m.nccpiParts || '' });
    if (m.csr2) figs.push({ k: 'CSR2, 0 TO 100', v: m.csr2, n: 'Iowa corn suitability' });
    if (m.rain) figs.push({ k: 'RAIN SINCE JAN 1', v: m.rain.inches + ' in', n: m.rain.pct != null ? m.rain.pct + '% of normal' : '', bar: m.rain.pct });
    if (figs.length) {
      y += 26;
      x.fillStyle = RULE; x.fillRect(PAD, y - 16, W - PAD * 2, 1);
      var fw = (W - PAD * 2) / figs.length;
      figs.forEach(function (f, i) {
        var fx = PAD + i * fw;
        x.font = '600 15px ' + MONO; x.fillStyle = DIM; x.fillText(f.k, fx, y + 8);
        x.font = '800 46px ' + FONT; x.fillStyle = INK; x.fillText(f.v, fx, y + 58);
        var vw = x.measureText(f.v).width;
        if (f.n) { x.font = '500 18px ' + FONT; x.fillStyle = DIM; x.fillText(clip(x, f.n, fw - 24), fx, y + 86); }
        // rain against normal: a short bar to 100%, the year's share past or short of it
        if (f.bar != null) {
          var sx = fx + vw + 18, sw = Math.max(60, fw - vw - 48), full = Math.max(100, Math.min(200, f.bar));
          var nx = sx + sw * 100 / full;
          x.fillStyle = 'rgba(95,168,211,.85)'; x.fillRect(sx, y + 38, sw * Math.min(f.bar, 200) / full, 14);
          x.fillStyle = INK; x.fillRect(nx - 1, y + 30, 2, 30);
          x.font = '500 13px ' + MONO; x.fillStyle = DIM; x.textAlign = 'center'; x.fillText('normal', nx, y + 24); x.textAlign = 'left';
        }
      });
      y += 100;
    }

    // ten years of the crop at the field center
    if (m.chips && m.chips.length) {
      y += 22;
      x.font = '600 15px ' + MONO; x.fillStyle = DIM; x.fillText('CROP AT THE FIELD CENTER, ' + chipYears(m), PAD, y); y += 12;
      var n = m.chips.length, gap = 8, cw = (W - PAD * 2 - gap * (n - 1)) / n, ch = 58;
      m.chips.forEach(function (c, i) {
        var cx = PAD + i * (cw + gap), dark = lum(c.c) > 0.35;
        x.fillStyle = c.c; x.globalAlpha = c.land ? 0.55 : 1; x.fillRect(cx, y, cw, ch); x.globalAlpha = 1;
        x.fillStyle = dark && !c.land ? '#14181a' : INK;
        x.font = '600 14px ' + MONO; x.fillText(String(c.y), cx + 8, y + 21);
        var ls = fit(x, c.l, '700', [17, 15, 13, 12], FONT, cw - 14);
        x.font = '700 ' + ls + 'px ' + FONT; x.fillText(clip(x, c.l, cw - 14), cx + 8, y + 45);
      });
      y += ch;
    }

    // the sources, then the address
    var src = sourceText(m);
    x.font = '400 15px ' + FONT; x.fillStyle = DIM;
    var sl = src ? wrap(x, src, W - PAD * 2, 2) : [];
    var sy = H - 44 - (sl.length - 1) * 20;
    sl.forEach(function (l, i) { x.fillText(l, PAD, sy + i * 20); });
    x.font = '700 19px ' + FONT; x.fillStyle = GOLD; x.fillText('agsist.com/field-scout', PAD, H - 16);
    x.font = '400 15px ' + FONT; x.fillStyle = DIM; x.textAlign = 'right'; x.fillText('Free, from public records', W - PAD, H - 16); x.textAlign = 'left';
    return true;
  }
  function blob(m, k, done) {
    var D = root.document; if (!D) { done(null); return; }
    var c = D.createElement('canvas');
    var go = function () {
      try { if (!draw(c, m, k) || !c.toBlob) { done(null); return; } c.toBlob(function (b) { done(b || null); }, 'image/png'); }
      catch (e) { done(null); }
    };
    // the page's own fonts, when the browser has them ready; the picture never waits long for them
    if (D.fonts && D.fonts.load) {
      var t = null, once = false, run = function () { if (!once) { once = true; clearTimeout(t); go(); } };
      t = setTimeout(run, 800);
      Promise.all([D.fonts.load('800 60px Inter'), D.fonts.load('600 15px "JetBrains Mono"')]).then(run, run);
    } else go();
  }
  var API = { lines: lines, draw: draw, blob: blob, fileName: fileName, sourceText: sourceText, W: W, H: H };
  if (typeof module === 'object' && module.exports) module.exports = API;
  else root.AgFieldCard = API;
})(typeof window !== 'undefined' ? window : this);
