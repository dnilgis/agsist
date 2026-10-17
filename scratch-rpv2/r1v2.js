  // ======================================================================= R1 v2 (MOCKUP, fx/rpv2 only)
  /* Staircase "Clean v2" for Sig to look at (2026-10-17): the panel's agreed changes
     plus the typographer's list. I.v2 = {fill, lineEnds: 'words' | 'figures',
     history: true (I.hist: every full year at the station as a running total),
     histNote}. Nothing on the live site reads this. */
  var V2 = { ink: '#1F2328', date: '#8A8F98', fact: '#5B616B', grid: '#EEF0F2', mon: '#8A8F98', usualM: '#A3A8B0', red: '#B23A2E', thread: '#DDD8D0' };
  function tv(x, y, s, o, date, dateO) {
    // words, then an optional date in its own voice on the same baseline
    o = st(o || {});
    var t = T(x, y, s, o);
    if (date) t = t.replace('</text>', '<tspan font-weight="' + (dateO.w || 400) + '" font-size="' + n2(dateO.size || o.size) + '" fill="' + dateO.fill + '"> ' + esc(date) + '</tspan></text>');
    return t;
  }
  function wv(s, o, date, dateO) { return W(s, o) + (date ? W(' ' + date, Object.assign({}, o, dateO)) : 0); }
  function bv(x, y, s, o, date, dateO) {
    var w = wv(s, o, date, dateO), a = o.anchor || 'start', up = 0.77 * o.size, dn = 0.27 * o.size;
    return { x: a === 'start' ? x : a === 'end' ? x - w : x - w / 2, y: y - up, w: w, h: up + dn };
  }
  function r1v2(I) {
    var O = I.v2 || {}, E = model(I), N = E.N, days = E.days;
    var X0 = 196, X1 = 1590, PTOP = 104, PB = 716, w = (X1 - X0) / N;
    var xs = function (i) { return X0 + i * w; };
    var lastCum = function (i) { for (var k = i; k >= 0; k--) if (E.cum[k] !== null) return E.cum[k]; return 0; };
    var recs = recordPoints(E, I.records);
    var hist = O.history && I.hist ? I.hist : [];
    var room = new Room(), o = [open(I, E)];
    var info = { notes: [] };

    // ---- header: two lines, upper left on the one left edge
    var figs = O.lineEnds !== 'figures';
    var hs = { fam: SERIF, w: 600, size: 30, fill: V2.ink };
    var head = E.verdict || (E.T + ' inches of ' + E.liquid);
    var HY = PTOP + 18, KY = HY + 32;
    var yTxt = E.TU + ' this year', uTxt = E.cmp ? rainAmt(E.normalRec, 'tot') + ' a usual year' : '';
    var ks = { size: 15, w: 500, fill: E.full ? C.rain : C.rain }, us = { size: 15, w: 400, fill: C.mute }, sep = { size: 15, fill: C.soft };
    var headW = W(head, hs), keyW = figs ? 34 + W(yTxt, ks) + 36 + 34 + W(uTxt, us) : 0;
    var HB = (figs ? KY + 6 : HY + 8) + (O.histNote ? 22 : 0);   // the header's lowest ink
    room.add({ b: { x: X0 - 4, y: HY - 26, w: Math.max(headW, keyW) + 12, h: HB - HY + 30 }, own: 'head', k: 'mark' });

    // ---- scale: steps of 5 (10 over 60 in), every labelled line clear of the header, no line without a number
    var top = Math.max(E.total, E.cmp ? E.normalRec : 0, 1);
    hist.forEach(function (h) { top = Math.max(top, h.cum[Math.min(h.cum.length, N) - 1] || 0); });
    var step = top > 60 ? 10 : top > 12 ? 5 : 2;
    var dom = Math.ceil(top / step - 1e-6) * step;
    var y = function (v) { return PB - v * (PB - PTOP) / dom; };
    var ticks = [];
    for (var v = 0; v <= dom + 1e-9; v += step) if (v === 0 || y(v) > HB + 18) ticks.push(v);
    var topTick = ticks[ticks.length - 1];
    ticks.forEach(function (v) { if (v > 0) room.seg(X0, y(v), X1, y(v), 0.7, 'axis', 'soft'); });
    room.seg(X0, PB, X1, PB, 0.9 * PT, 'axis', 'axis');

    // ---- the year as segments (for the room) and as a path
    var d1 = '', prev = 0, pen = false;
    days.forEach(function (x, i) {
      if (E.P[i] === null) { pen = false; return; }
      var c = E.cum[i];
      if (!pen) { d1 += 'M' + n2(xs(i)) + ',' + n2(y(prev)); pen = true; }
      if (c !== prev || !pen) room.seg(xs(i), y(prev), xs(i), y(c), 4, 'data', 'data');
      room.seg(xs(i), y(c), xs(i + 1), y(c), 4, 'data', 'data');
      d1 += 'L' + n2(xs(i)) + ',' + n2(y(c)) + 'L' + n2(xs(i + 1)) + ',' + n2(y(c));
      prev = c;
    });
    var np = '';
    if (E.cmp) {
      var px = X0, py = PB; np = 'M' + X0 + ',' + PB;
      days.forEach(function (x, i) { var qx = xs(i + 1), qy = y(E.ncum[i]); room.seg(px, py, qx, qy, 1.5, 'data', 'usual'); np += 'L' + n2(qx) + ',' + n2(qy); px = qx; py = qy; });
    }
    var inPlot = function (b) { return b.x > X0 + 4 && b.x + b.w < X1 - 2 && b.y + b.h < PB - 6 && b.y > HB + 4; };

    // ---- marked days: the only dark labels, above the line
    var mO = { size: 15, w: 500, fill: V2.ink }, mD = { size: 15, w: 400, fill: V2.date };
    var marks = E.markers.map(function (mk, k) { return { k: k, i: mk.i, x: xs(mk.i + 0.5), y: y(lastCum(mk.i)), words: mk.words, date: mk.date }; });
    marks.forEach(function (mk) {
      room.add({ b: { x: mk.x - 5, y: mk.y - 5, w: 10, h: 10 }, own: 'mark:' + mk.k, k: 'mark' });
      room.seg(mk.x, mk.y + 5, mk.x, PB, 0.75, 'mark:' + mk.k, 'lead');
    });
    // the biggest rain's riser
    var wx = -1, wc0 = 0, wc1 = 0;
    if (E.wi >= 0) { wx = xs(E.wi); wc1 = E.cum[E.wi]; wc0 = wc1 - E.wet.p; room.seg(wx, y(wc0), wx, y(wc1), 4, 'wet', 'data'); }
    // record rings
    var rings = recs.pts.map(function (r, k) { var rg = { x: xs(r.i + 0.5), y: y(lastCum(r.i)) }; room.add({ b: { x: rg.x - 5, y: rg.y - 5, w: 10, h: 10 }, own: 'rec:' + k, k: 'mark' }); return rg; });

    function placeNear(ax, ay, words, o1, date, dO, own, cands, maxLead) {
      return choose(cands.map(function (c) { return { x: ax + c[0], y: ay + c[1], a: c[2] }; }).concat(spots(ax, ay, [], [12, 30, 60, 100]).filter(function (c) { return c.y < ay + (maxLead.below ? 400 : 0); })), function (c) {
        var b = bv(c.x, c.y, words, Object.assign({}, o1, { anchor: c.a }), date, dO);
        if (!inPlot(b)) return 0;
        if (maxLead.above && b.y + b.h > ay - 2 && Math.abs(c.x - ax) < 12) return 0;
        if (maxLead.rg && b.y < ay + 6) return 0;
        var L = [ax, ay, c.x + (c.a === 'start' ? -3 : 3), b.y + b.h / 2];
        if (Math.hypot(L[2] - L[0], L[3] - L[1]) > maxLead.d) return 0;
        if (!room.clear(L, own, 7)) return 0;
        if (!room.free(b, own, false)) return 0;
        c.b = b; c.L = L;
        return room.free(b, own, true) ? 2 : 1;
      });
    }
    var placed = [];
    // biggest rain first (it sits close to its riser), red, the same voice as a marked day
    var wetAt = null, wO = { size: 15, w: 500, fill: V2.red };
    if (wx >= 0) {
      var wmy = (y(wc0) + y(wc1)) / 2;
      wetAt = placeNear(wx, wmy, colon(E.wetLabel) + rainAmt(E.wet.p, 'day'), wO, fmtDate(E.wet.date), mD, 'wet',
        [[-12, -22, 'end'], [-12, -46, 'end'], [-14, 0, 'end'], [-14, -70, 'end'], [12, 40, 'start']], { d: 140 });
      if (wetAt) { room.text(wetAt.b, 'wet'); room.seg(wetAt.L[0], wetAt.L[1], wetAt.L[2], wetAt.L[3], 0.8, 'wet', 'lead'); }
      else info.notes.push('biggest rain not placed');
    }
    marks.forEach(function (mk) {
      var own = 'mark:' + mk.k;
      var pick = placeNear(mk.x, mk.y, mk.words, mO, mk.date, mD, own,
        [[-12, -16, 'end'], [12, -16, 'start'], [-14, -40, 'end'], [14, -40, 'start'], [-14, -64, 'end'], [14, -64, 'start'], [-16, -90, 'end'], [16, -90, 'start']], { d: 120, above: true });
      if (pick) { room.text(pick.b, own); if (Math.hypot(pick.L[2] - pick.L[0], pick.L[3] - pick.L[1]) > 16) room.seg(pick.L[0], pick.L[1], pick.L[2], pick.L[3], 0.8, own, 'lead'); else pick.L = null; }
      else info.notes.push('mark not placed: ' + mk.words);
      mk.at = pick;
    });
    // station facts: 12 u gray footnotes, below the line
    var fO = { size: 12, w: 400, fill: V2.fact }, fD = { size: 12, w: 400, fill: V2.date };
    var footFacts = [];
    var recAt = recs.pts.map(function (r, k) {
      var two = splitDate(r.text), words = two ? two[0] : plain(r.text), date = two ? two[1] : '';
      var rg = rings[k], own = 'rec:' + k;
      var pick = placeNear(rg.x, rg.y, words, fO, date, fD, own,
        [[10, 24, 'start'], [-10, 24, 'end'], [12, 44, 'start'], [-12, 44, 'end'], [14, 66, 'start'], [-14, 66, 'end'], [16, 90, 'start'], [-16, 90, 'end'], [40, 30, 'start'], [-40, 30, 'end'], [60, 56, 'start'], [-60, 56, 'end']], { d: 170, below: true, rg: rg });
      if (pick) { room.text(pick.b, own); room.seg(pick.L[0], pick.L[1], pick.L[2], pick.L[3], 0.7, own, 'lead'); }
      else { info.notes.push('fact to the foot line: ' + words); footFacts.push(plain(r.text).replace(/ (\w{3} \d+)/, ', $1')); }
      return pick ? { p: pick, words: words, date: date } : null;
    });

    // ---- line ends, and the gap at Dec 31
    var endY = y(E.total), endN = E.cmp ? y(E.normalRec) : null, EX = X1 + 12;
    var ends = [];
    if (figs) {
      ends.push(T(EX, endY + 5, 'your year', { size: 15, w: 500, fill: C.rain }));
      if (E.cmp) ends.push(T(EX, endN + 5, 'usual', { size: 15, fill: C.mute }));
    } else {
      ends.push(T(EX, endY + 7, E.TU, { size: 22, w: 600, fill: C.rain }));
      if (E.cmp) ends.push(T(EX, endN + 6, rainAmt(E.normalRec, 'tot') + ' usual', { size: 16, fill: C.mute }));
    }
    var gap = E.cmp ? E.normalRec - E.total : 0, br = '';
    if (E.cmp && Math.abs(gap) >= 0.5 && Math.abs(endY - endN) > 60) {
      var bx = X1 + 6, ya = Math.min(endY, endN) + 16, yb = Math.max(endY, endN) - 16, mid = (ya + yb) / 2;
      br = '<path d="M' + n2(bx + 5) + ',' + n2(ya) + 'H' + n2(bx) + 'V' + n2(yb) + 'H' + n2(bx + 5) + '" fill="none" stroke="' + V2.date + '" stroke-width="0.8"/>' +
        T(bx + 12, mid + 5, rainAmt(Math.abs(gap), 'tot') + (gap > 0 ? ' short' : ' ahead'), { size: 15, w: 500, fill: V2.ink });
    }

    // ---- month row: labels 11 u tracked, totals 14 u tabular ink, usual 11 u light
    var months = [], tab = 'font-variant-numeric:tabular-nums lining-nums';
    E.starts.forEach(function (b, m) {
      var cx = (xs(b) + xs(E.ends[m])) / 2;
      months.push(T(cx, PB + 26, monCap(m), { w: 500, size: 11, ls: 0.08, fill: V2.mon, anchor: 'middle' }));
      if (E.monthHas[m]) months.push(T(cx, PB + 46, rainNum(E.month[m], 'tot'), { size: 14, fill: V2.ink, anchor: 'middle' }).replace('lining-nums', 'tabular-nums lining-nums'));
      if (E.showN) months.push(T(cx, PB + 63, rainNum(E.mN[m], 'tot'), { size: 11, fill: V2.usualM, anchor: 'middle' }).replace('lining-nums', 'tabular-nums lining-nums'));
    });
    // the dry stretch, a footnote under the months
    var dryS = '';
    if (E.dry && E.dry.len >= printDryMin(I)) {
      var da = xs(E.dry.s), db = xs(E.dry.e + 1), ry = PB + 78;
      dryS = '<path d="M' + n2(da) + ',' + ry + 'v5H' + n2(db) + 'v-5" fill="none" stroke="' + V2.date + '" stroke-width="0.7"/>' +
        T((da + db) / 2, ry + 20, E.dry.len + ' dry days', { size: 12, fill: V2.fact, anchor: 'middle' });
    }

    // ---- the name block, the year as big as the name, one left edge
    var NB = 905, title = [];
    if (E.name) {
      var nmS = { fam: SERIF, w: 500, size: 64, fill: V2.ink }, yrS = { fam: SERIF, w: 400, size: 64, fill: V2.ink };
      var gapX = 26;
      while (nmS.size > 40 && W(E.name, nmS) + gapX + W(String(E.year), nmS) > 1300) { nmS.size--; yrS.size = nmS.size; }
      title.push(T(X0 - 2, NB, E.name, nmS));
      title.push(T(X0 - 2 + W(E.name, nmS) + gapX, NB, String(E.year), yrS));
      title.push(T(X0, NB + 40, E.place, { fam: SERIF, w: 400, size: 22, fill: V2.ink }));
    } else {
      title.push(T(X0 - 2, NB, String(E.year), { fam: SERIF, w: 400, size: 64, fill: V2.ink }));
      title.push(T(X0, NB + 40, E.place, { fam: SERIF, w: 400, size: 22, fill: V2.ink }));
    }
    if (E.dedication) title.push('<text x="' + X0 + '" y="' + (NB + 70) + '" font-family="' + esc(SERIF) + '" font-style="italic" font-weight="400" font-size="17" fill="' + V2.fact +
      '" style="font-variation-settings:\'opsz\' 12;font-variant-ligatures:no-discretionary-ligatures;font-feature-settings:\'swsh\' 0,\'dlig\' 0">' + esc(E.dedication) + '</text>');

    // ---- the foot: 12 u, two lines, "usual" said once
    var foot1 = [E.gauge, 'Inches of ' + E.liquid + ', Jan 1 to Dec 31, ' + E.year];
    if (E.snowText) foot1.push('Snow ' + E.snowTot.toFixed(1) + ' in, the light blue steps');
    foot1.push(E.daysText);
    footFacts.forEach(function (t) { foot1.push(t); });
    var foot2 = [];
    if (E.cmp) foot2.push('A usual year: NOAA’s 30-year normal (1991 to 2020); the usual month total is the gray number under each month');
    if (E.snowNote) foot2.push(E.snowNote);
    if (hist.length) foot2.push('Gray lines: every full year this station kept, ' + O.histSpan);
    if (E.missing > GAP_QUIET) foot2.push('Gaps: ' + E.missing + ' days with no report');
    var fS = { size: 12, fill: V2.fact };
    var SEPF = '  \u00b7  ', FW = 1380, lines = [[]], dropped = [];
    var core = foot1.filter(function (t) { return footFacts.indexOf(t) < 0; });
    function addPart(t) {
      var cur = lines[lines.length - 1];
      if (!cur.length || W(cur.concat([t]).join(SEPF), fS) <= FW) { cur.push(t); return; }
      lines.push([t]);
    }
    core.forEach(addPart);
    lines.push([]); foot2.forEach(addPart);
    footFacts.forEach(function (t) {
      for (var li = 0; li < lines.length; li++) if (W(lines[li].concat([t]).join(SEPF), fS) <= FW) { lines[li].push(t); return; }
      if (lines.length < 3) { lines.push([t]); return; }
      dropped.push(t);
    });
    lines = lines.filter(function (l) { return l.length; });
    info.footDropped = dropped;
    var foot = lines.map(function (l, k) { return T(X0, 1081 - (lines.length - 1 - k) * 19, l.join(SEPF), fS); }).join('');
    info.footW = Math.max.apply(null, lines.map(function (l) { return W(l.join(SEPF), fS); }));

    // ================= draw, back to front
    o.push(G0('axis'));
    ticks.forEach(function (v) { if (v > 0) o.push(line(X0, y(v), X1, y(v), V2.grid, 0.7)); });
    ticks.forEach(function (v) { o.push(T(X0 - 12, y(v) + 4.5, String(v), { size: 13, fill: V2.date, anchor: 'end' })); });
    o.push(G1);
    // header
    var hx = X0, hp = [T(hx, HY, head, hs)];
    if (figs) {
      hp.push(line(hx, KY - 5, hx + 24, KY - 5, C.rain, 4)); hx += 34;
      hp.push(T(hx, KY, yTxt, ks)); hx += W(yTxt, ks);
      hp.push(T(hx + 18, KY, '·', Object.assign({}, sep, { anchor: 'middle' }))); hx += 36;
      if (E.cmp) { hp.push('<path d="M' + n2(hx) + ',' + (KY - 5) + 'h24" stroke="' + C.mute + '" stroke-width="1.5" stroke-dasharray="6 5"/>'); hx += 34; hp.push(T(hx, KY, uTxt, us)); }
    }
    if (O.histNote) hp.push(T(X0, (figs ? KY : HY) + 22, O.histNote, { size: 12, fill: V2.fact }));
    o.push(G0('head') + hp.join('') + G1);
    // every year behind this one
    if (hist.length) {
      var hpath = '';
      hist.forEach(function (h) {
        var s = 'M' + X0 + ',' + PB;
        for (var i = 0; i < Math.min(h.cum.length, N); i += 1) s += 'L' + n2(xs(i + 1)) + ',' + n2(y(h.cum[i]));
        hpath += '<path d="' + s + '"/>';
      });
      o.push(G0('hist') + '<g fill="none" stroke="' + (O.threadInk || V2.thread) + '" stroke-opacity="' + (O.threadOpacity || 0.4) + '" stroke-width="0.7" stroke-linejoin="round">' + hpath + '</g>' + G1);
    }
    // the band between the year and a usual year (none when the history replaces it)
    if (E.cmp && !hist.length && O.fill) {
      var band = '', last = 0;
      days.forEach(function (x, i) {
        if (E.cum[i] !== null) last = E.cum[i];
        var a = y(last), b = y(E.ncum[i]);
        if (Math.abs(a - b) < 0.3) return;
        band += '<rect x="' + n2(xs(i)) + '" y="' + n2(Math.min(a, b)) + '" width="' + n2(w + 0.25) + '" height="' + n2(Math.abs(a - b)) + '" fill="' + (a > b ? O.fill : (O.wetFill || '#EAEFF4')) + '"/>';
      });
      o.push(G0('band') + '<g shape-rendering="crispEdges">' + band + '</g>' + G1);
    }
    if (E.cmp) o.push(G0('usual') + '<path d="' + np + '" fill="none" stroke="' + C.mute + '" stroke-width="1.5" stroke-dasharray="6 5"/>' + G1);
    o.push(G0('axis') + line(X0, PB, X1, PB, V2.ink, 0.9 * PT));
    E.starts.concat([isLeap(E.year) ? 366 : 365]).forEach(function (b) { if (b <= N) o.push(line(xs(b), PB, xs(b), PB + 7, V2.ink, 0.75 * PT)); });
    o.push(G1);
    // the year: 4 u, snow steps in ice blue on the line (above the line only)
    o.push(G0('data') + '<path d="' + d1 + '" fill="none" stroke="' + C.rain + '" stroke-width="4" stroke-linejoin="round" stroke-linecap="butt"/>');
    if (E.full) {
      var sp = '';
      days.forEach(function (x, i) {
        if (E.P[i] === null || !(x.s > 0) || !(E.P[i] > 0)) return;
        var c = E.cum[i], c0 = c - E.P[i];
        var j = i + 1; while (j < E.n && E.P[j] === 0 && !(days[j].s > 0)) j++;
        sp += 'M' + n2(xs(i)) + ',' + n2(y(c0)) + 'L' + n2(xs(i)) + ',' + n2(y(c)) + 'L' + n2(xs(Math.min(j, E.n))) + ',' + n2(y(c));
      });
      if (sp) o.push('<path d="' + sp + '" fill="none" stroke="' + C.snowLine + '" stroke-width="4" stroke-linejoin="round"/>');
    }
    o.push(G1);
    if (wx >= 0) o.push(G0('wet') + line(wx, y(wc0) + 1.5, wx, y(wc1) - 1.5, V2.red, 4) + G1);
    o.push(G0('months') + months.join('') + dryS + G1);
    // facts
    recs.pts.forEach(function (r, k) {
      var a = recAt[k], rg = rings[k]; if (!a) return;
      o.push(G0('rec:' + k) + '<circle cx="' + n2(rg.x) + '" cy="' + n2(rg.y) + '" r="4" fill="#FFFFFF" stroke="' + V2.fact + '" stroke-width="1.2"/>' +
        '<path d="M' + n2(a.p.L[0]) + ',' + n2(a.p.L[1]) + 'L' + n2(a.p.L[2]) + ',' + n2(a.p.L[3]) + '" stroke="' + V2.fact + '" stroke-width="0.7"/>' +
        tv(a.p.x, a.p.y, a.words, Object.assign({}, fO, { anchor: a.p.a }), a.date, fD) + G1);
    });
    if (wetAt) o.push(G0('wet') + '<path d="M' + n2(wetAt.L[0]) + ',' + n2(wetAt.L[1]) + 'L' + n2(wetAt.L[2]) + ',' + n2(wetAt.L[3]) + '" stroke="' + V2.red + '" stroke-width="0.8"/>' +
      tv(wetAt.x, wetAt.y, colon(E.wetLabel) + rainAmt(E.wet.p, 'day'), Object.assign({}, wO, { anchor: wetAt.a }), fmtDate(E.wet.date), mD) + G1);
    marks.forEach(function (mk) {
      o.push(G0('mark:' + mk.k) + line(mk.x, mk.y + 5, mk.x, PB, V2.ink, 0.75) + '<circle cx="' + n2(mk.x) + '" cy="' + n2(mk.y) + '" r="4.6" fill="' + V2.ink + '" stroke="#FFFFFF" stroke-width="1.4"/>');
      if (mk.at) {
        if (mk.at.L) o.push('<path d="M' + n2(mk.at.L[0]) + ',' + n2(mk.at.L[1]) + 'L' + n2(mk.at.L[2]) + ',' + n2(mk.at.L[3]) + '" stroke="' + V2.ink + '" stroke-width="0.8"/>');
        o.push(tv(mk.at.x, mk.at.y, mk.words, Object.assign({}, mO, { anchor: mk.at.a }), mk.date, mD));
      }
      o.push(G1);
    });
    o.push(G0('ends') + ends.join('') + br + G1);
    o.push(G0('title') + title.join('') + G1);
    o.push(G0('foot') + foot + G1);
    o.push(qrMark(I.qr, 1690, 1081));
    if (I.crop) o.push(cropStrip(I, E, { xs: function (i) { return xs(i + 0.5); }, y: PB + 96, X0: X0, X1: X1 }));
    root.__rpv2info = info;
    o.push('</svg>');
    return o.join('');
  }

