  // ======================================================================= crop growth strip (MOCKUP, fx/rpv2 only)
  /* E (Sig's idea, 2026-10-17): between the buyer's plant and harvest days, a quiet
     row of line-art plants, each on the day the station's own growing degree days
     reached that stage. I.crop = {kind: 'corn' | 'bean', plant: doy, harvest: doy,
     stages: [{key, label, doy, date}], ghost: [{key, doy}] or null, keyNote}.
     The stage dates are worked out before render (scratch harness) from NOAA
     daily temps with the GDU calculator's 86/50 math and components/gdu-stages.js. */
  var CROP_INK = '#5B616B', GHOST_INK = '#CFCBC4';
  // one plant, base at (x, b), in ink; h is the full height of a grown plant
  function plantArt(kind, key, x, b, ink, h) {
    var p = [], sw = 0.9;
    var L = function (d) { p.push('<path d="' + d + '"/>'); };
    var leaf = function (y, side, len, droop) {   // a leaf from the stalk at height y
      var s = side, ex = x + s * len, ey = b - y + (droop || -len * 0.35);
      L('M' + n2(x) + ',' + n2(b - y) + 'Q' + n2(x + s * len * 0.55) + ',' + n2(b - y - len * 0.45) + ' ' + n2(ex) + ',' + n2(ey));
    };
    if (key === 'seed') {
      p.push('<ellipse cx="' + n2(x) + '" cy="' + n2(b - 2.6) + '" rx="2.2" ry="3" />');
    } else if (kind === 'corn') {
      if (key === 'VE') { L('M' + n2(x) + ',' + n2(b) + 'V' + n2(b - 7)); leaf(6, 1, 5); leaf(5, -1, 4); }
      else if (key === 'V6') { L('M' + n2(x) + ',' + n2(b) + 'V' + n2(b - h * 0.45)); leaf(h * 0.12, -1, 9); leaf(h * 0.2, 1, 10); leaf(h * 0.3, -1, 10); leaf(h * 0.4, 1, 9); }
      else {
        var dry = key === 'R6', droop = key === 'R5' || dry;
        L('M' + n2(x) + ',' + n2(b) + 'V' + n2(b - h));
        // leaves, drooping as the plant dries down
        [0.18, 0.32, 0.46, 0.6, 0.74].forEach(function (f, k) { var s = k % 2 ? 1 : -1; leaf(h * f, s, dry ? 9 : 12, droop ? (dry ? 9 : 3) : null); });
        // tassel
        L('M' + n2(x) + ',' + n2(b - h) + 'l-4,-6M' + n2(x) + ',' + n2(b - h) + 'l4,-6M' + n2(x) + ',' + n2(b - h) + 'v-8');
        // the ear at about half height: silk hairs at R1, angled down at maturity
        var ey = b - h * 0.5;
        if (key === 'R1' || key === 'VT') p.push('<path d="M' + n2(x + 1) + ',' + n2(ey) + 'q4,-2 4,-9q0,-4 -3,-4" /><path d="M' + n2(x + 4) + ',' + n2(ey - 13) + 'q3,-4 6,-3M' + n2(x + 4) + ',' + n2(ey - 13) + 'q4,-1 7,2" />');
        else if (key === 'R5') p.push('<path d="M' + n2(x + 1) + ',' + n2(ey) + 'q6,-2 6,-11q0,-4 -4,-4z" />');
        else if (dry) p.push('<path d="M' + n2(x + 1) + ',' + n2(ey) + 'q8,1 10,8q-6,3 -10,-2z" />');
      }
    } else {
      // soybeans: a low bushy plant; trifoliates, then flowers, pods, and bare stems with pods at maturity
      var tri = function (cx, cy, r) { [-1, 0, 1].forEach(function (k) { var a = -Math.PI / 2 + k * 0.9; p.push('<ellipse cx="' + n2(cx + Math.cos(a) * r) + '" cy="' + n2(cy + Math.sin(a) * r) + '" rx="' + n2(r * 0.55) + '" ry="' + n2(r * 0.9) + '" transform="rotate(' + n2(k * 50) + ' ' + n2(cx + Math.cos(a) * r) + ' ' + n2(cy + Math.sin(a) * r) + ')"/>'); }); };
      var bh = h * 0.6;
      if (key === 'VE') { L('M' + n2(x) + ',' + n2(b) + 'V' + n2(b - 6)); p.push('<ellipse cx="' + n2(x - 3) + '" cy="' + n2(b - 7) + '" rx="3" ry="1.8"/><ellipse cx="' + n2(x + 3) + '" cy="' + n2(b - 7) + '" rx="3" ry="1.8"/>'); }
      else if (key === 'V3') { L('M' + n2(x) + ',' + n2(b) + 'V' + n2(b - bh * 0.55)); tri(x, b - bh * 0.55, 3.2); L('M' + n2(x) + ',' + n2(b - bh * 0.3) + 'l-7,-4'); tri(x - 8, b - bh * 0.3 - 5, 2.6); }
      else {
        L('M' + n2(x) + ',' + n2(b) + 'V' + n2(b - bh));
        [[0.3, -1], [0.5, 1], [0.7, -1]].forEach(function (q) { L('M' + n2(x) + ',' + n2(b - bh * q[0]) + 'l' + n2(q[1] * 8) + ',-5'); if (key !== 'R7') tri(x + q[1] * 9, b - bh * q[0] - 7, 2.6); });
        if (key !== 'R7') tri(x, b - bh - 4, 3);
        if (key === 'R1') p.push('<circle cx="' + n2(x + 3) + '" cy="' + n2(b - bh * 0.45) + '" r="1.4"/>');
        if (key === 'R5' || key === 'R7') [0.25, 0.45, 0.65].forEach(function (f) { p.push('<path d="M' + n2(x + 1) + ',' + n2(b - bh * f) + 'q4,1 4,6" />'); });
      }
    }
    return '<g fill="none" stroke="' + ink + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round">' + p.join('') + '</g>';
  }
  function cropStrip(I, E, g) {
    var c = I.crop, base = g.base, h = 54, o = [], lab = { size: 11.5, fill: CROP_INK, anchor: 'middle' };
    var xa = g.xs(c.plant), xb = g.xs(Math.min(c.harvest, E.n - 1));
    o.push(line(xa, base, xb, base, CROP_INK, 0.8));
    o.push(line(xb, base - 4, xb, base + 4, CROP_INK, 0.8));
    // the usual year, behind
    if (c.ghost) c.ghost.forEach(function (s) { if (s.doy <= c.harvest) o.push(plantArt(c.kind, s.key, g.xs(s.doy), base, GHOST_INK, h)); });
    o.push(plantArt(c.kind, 'seed', xa, base, CROP_INK, h));
    var labs = [];
    c.stages.forEach(function (s) {
      if (s.doy > c.harvest) return;   // harvest came first: draw only what the season reached
      var x = g.xs(s.doy);
      o.push(plantArt(c.kind, s.key, x, base, CROP_INK, h));
      var t = s.label + ' ' + fmtDate(s.date);
      labs.push({ x: x, t: t, note: c.ghost && s.note ? s.note : '' });
    });
    // labels under the row, nudged apart so none touch
    labs.forEach(function (l) { l.w = W(l.t, lab); l.cx = l.x; });
    for (var it = 0; it < 30; it++) for (var k = 1; k < labs.length; k++) {
      var a = labs[k - 1], b2 = labs[k], need = (a.w + b2.w) / 2 + 12 - (b2.cx - a.cx);
      if (need > 0) { a.cx -= need / 2; b2.cx += need / 2; }
    }
    labs.forEach(function (l) {
      o.push(T(l.cx, base + 17, l.t, lab));
      if (l.note) o.push(T(l.cx, base + 31, l.note, { size: 11.5, fill: '#8A8F98', anchor: 'middle' }));
    });
    return G0('crop') + o.join('') + G1;
  }

