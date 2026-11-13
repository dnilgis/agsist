/* components/rain-chart.js: the enhanced rain running-total chart (Nov 13 2026).
 *
 * One drawing for every plain "rain so far" chart on the site: a big headline ("57% less" over "than a normal
 * year so far"), this year's line against the dashed normal line with the gap shaded between them, a three line
 * key (this year so far, a normal year by then, the gap), "Jan 1" and the last day under the axis, the year
 * and the place. Few labels, all large.
 *
 * It is the layout of the Daily's "Print of the day" picture (scripts/print_email_art.js), moved here so the
 * email and the pages share ONE copy of the drawing. The email asks for its own measures (spec EMAIL: 560 wide,
 * the height follows the picture); a page asks for one of two fixed designs (PHONE 400 wide, WIDE 640 wide) whose
 * height never depends on the data, so the page can hold the room from the first paint (CSS aspect-ratio, no
 * layout shift) and the browser scales the drawing to the column.
 *
 * It works out no figure of its own: the totals, the normal, the percent and the last day are the page's (data-
 * fields written by the page builder from the same numbers the page prints). The only arithmetic is the gap,
 * normal minus this year, the way the page's own sentence ("15.88 inches more than a normal year") writes it.
 *
 * Pure part: build(model, measure, spec) returns {svg, W, H, texts, ...} or null. measure(text, font) gives a
 * width in px (the page passes the browser's canvas, the tests a fixed one). UMD, so a test can require() it.
 * Browser part: mount(el) reads el's data- fields, draws into el's .rce-art, and redraws when the design (phone
 * or wide) changes.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.AgRainChart = factory(root);
})(typeof window !== 'undefined' ? window : this, function (root) {
  'use strict';

  var EMAIL_COLORS = { ink: '#1E2125', mute: '#5E6475', rain: '#2B5C8A', dry: '#ECE6DE', wet: '#E3EBF3', dryEdge: '#CFC6BA', wetEdge: '#B9C7D6' };
  var SERIF = "'Fraunces',Georgia,serif", SANS = "'IBM Plex Sans',system-ui,sans-serif";
  /* the email: 560 wide at 2x, grows to fit (the Daily's picture; unchanged by the move) */
  var EMAIL = { W: 560, PADX: 22, bigMax: 48, bigMin: 38, SM: 24, plotH: 220, gapTop: 44, keyFS: 22, rowH: 34, sw: 34, axisFS: 20, yearFS: 52,
    placeMax: 24, placeMin: 18, gapMin: 24, colors: EMAIL_COLORS, serif: SERIF, sans: SANS, fixed: false };
  /* the pages: two designs, each with a height that never depends on the figures (only on whether the page has a normal to draw).
     Sizes are in design units; the page scales the drawing to its column. The key (this year, a normal year, the gap) always
     sits in a band above the plot, so it can never meet a line, and the plot gets the height a foot line would have taken (the
     page's own H1 already says the year and the place). The wide design adds quiet month ticks on the baseline. */
  var PHONE = { W: 400, PADX: 2, bigMax: 42, bigMin: 28, SM: 25, plotH: 300, gapTop: 10, keyFS: 23, keyMin: 23, rowH: 34, sw: 30, axisFS: 23,
    band: true, letters: true, vars: true, fixed: true, name: 'phone' };
  var WIDE = { W: 640, PADX: 2, bigMax: 54, bigMin: 34, SM: 26, plotH: 340, gapTop: 12, keyFS: 24, keyMin: 20, rowH: 38, sw: 40, axisFS: 22,
    band: true, letters: true, ticks: true, vars: true, fixed: true, name: 'wide' };

  var n2 = function (v) { return +(+v).toFixed(2); };
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

  /* "57% less" over "than a normal year so far": the full print's one sentence, set in two sizes. */
  function splitVerdict(v) {
    var m = /^(\d+% (?:less|more)) (than a (?:usual|normal) year.*)$/.exec(v);
    if (m) return { big: m[1], small: m[2] };
    m = /^(\d+(?:\.\d+)? times) (a (?:usual|normal) year.*)$/.exec(v);
    if (m) return { big: m[1], small: m[2] };
    m = /^(About a (?:usual|normal) year)( so far)?$/.exec(v);
    if (m) return { big: m[1], small: m[2] ? 'so far' : '' };
    return { big: v, small: '' };
  }

  /* does a segment touch a rectangle (a label's box, padded)? */
  function segHits(ax, ay, bx, by, r) {
    if (Math.max(ax, bx) < r.x || Math.min(ax, bx) > r.x + r.w || Math.max(ay, by) < r.y || Math.min(ay, by) > r.y + r.h) return false;
    var dx = bx - ax, dy = by - ay, t0 = 0, t1 = 1;
    var p = [-dx, dx, -dy, dy], q = [ax - r.x, r.x + r.w - ax, ay - r.y, r.y + r.h - ay];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return false; continue; }
      var t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return t0 <= t1;
  }

  /* does the same two-line shading as the email's; shared so the gap is drawn one way */
  function shade(ptsY, ptsN, n, fp) {
    var runs = [], cur = null, bands = '';
    var sgn = function (k) { var d = (k === 0 ? 0 : ptsN[k][1] - ptsY[k][1]); return d < -1e-9 ? 1 : d > 1e-9 ? -1 : 0; };
    var push = function (s, a, b) { if (!cur || cur.s !== s) { cur = { s: s, top: [], bot: [] }; runs.push(cur); } cur.top.push(a); cur.bot.push(b); };
    for (var k = 1; k <= n; k++) {
      var s1 = sgn(k), s0 = k === 1 ? s1 : sgn(k - 1);
      var u0 = ptsN[k - 1], u1 = ptsN[k], v0 = ptsY[k - 1], v1 = ptsY[k];
      if (s1 !== 0 && s0 !== 0 && s1 !== s0) {
        var d0 = u0[1] - v0[1], d1 = u1[1] - v1[1], t = d0 / (d0 - d1), cx = u0[0] + (u1[0] - u0[0]) * t, cy = u0[1] + (u1[1] - u0[1]) * t;
        push(s0, u0, v0); push(s0, [cx, cy], [cx, cy]);
        cur = null; push(s1, [cx, cy], [cx, cy]); push(s1, u1, v1);
      } else if (s1 !== 0) { if (k === 1 || !cur) push(s1, u0, v0); push(s1, u1, v1); }
      else cur = null;
    }
    runs.forEach(function (r) {
      if (r.top.length < 2) return;
      var dd = 'M' + r.top.map(function (p) { return n2(p[0]) + ',' + n2(p[1]); }).join('L') + 'L' +
        r.bot.slice().reverse().map(function (p) { return n2(p[0]) + ',' + n2(p[1]); }).join('L') + 'Z';
      bands += '<path d="' + dd + '"' + fp('fill', r.s === 1 ? 'dry' : 'wet') + '/>';
    });
    return bands;
  }

  /* The page chart: headline, the key in a band, the plot, "Jan 1" and the last day. Heights depend only on whether there is a normal. */
  function buildBand(m, measure, spec) {
    build.why = '';
    var W = spec.W, PADX = spec.PADX;
    var hasN = !!(m && m.ncum && m.usual > 0);
    if (!m || !m.cum || m.cum.length < 2 || (hasN && m.ncum.length !== m.cum.length) || !m.headBig) { build.why = 'no series'; return null; }
    var FAM = 'var(--font-body,system-ui,sans-serif)', mfont = spec.measureFamily || null;
    var meas = function (t, size, w) { return measure(t, (w || 400) + ' ' + size + 'px ' + (mfont ? mfont.sans : FAM)); };
    var fp = function (kind, c) { return ' class="rce-' + (kind === 'fill' ? 'f' : 's') + '-' + c + '"'; };
    var texts = [], maxW = W - 2 * PADX;
    // the headline: two rows always
    var big = spec.bigMax;
    while (big > spec.bigMin && meas(m.headBig, big, 700) > maxW) big -= 2;
    var y = 22 + Math.round(spec.bigMax * 0.8);
    texts.push({ t: m.headBig, x: PADX, y: y, size: big, w: 700, fill: 'ink', k: 'headline' });
    y += 10 + Math.round(spec.SM * 0.95);
    texts.push({ t: m.headSmall || '', x: PADX, y: y, size: spec.SM, w: 500, fill: 'ink', k: 'headline2' });
    var headBottom = y + 8;
    // the key
    var rows = [];
    if (hasN) {
      rows.push({ t: m.yText, w: 700, fill: 'rain', sw: 'rain', k: 'end' }, { t: m.uText, w: 500, fill: 'mute', sw: 'usual', k: 'end' });
      if (m.gapText) rows.push({ t: m.gapText, w: 700, fill: 'ink', sw: m.cum[m.cum.length - 1] > m.ncum[m.ncum.length - 1] ? 'wet' : 'dry', k: 'gap' });
    }
    var FS = spec.keyFS, sw = spec.sw + 10, rowH = spec.rowH;
    var keyW = function () { return sw + 12 + Math.max.apply(null, rows.map(function (r) { return meas(r.t, FS, r.w); })); };
    while (rows.length && keyW() > maxW && FS > spec.keyMin) FS -= 1;
    var bandTop = headBottom + 6, bandH = rows.length ? rows.length * rowH + 6 : 0;
    var PT = bandTop + bandH + spec.gapTop;
    var PB = headBottom + 6 + (hasN ? 3 * rowH + 6 : 0) + spec.gapTop + spec.plotH;      // the same for every page with a normal, whatever rows it has
    // the plot: Jan 1 at the left edge to the last reported day at the right edge
    var X0 = PADX, X1 = W - PADX - 16, n = m.cum.length, xn = m.xn || n, maxV = 0.01;
    m.cum.concat(hasN ? m.ncum : []).forEach(function (v) { if (v > maxV) maxV = v; });
    var xs = function (v) { return X0 + (X1 - X0) * v / xn; }, ys = function (v) { return PB - (PB - PT) * v / maxV; };
    var xAt = function (i) { return m.x ? m.x[i - 1] : i; };
    var ptsY = [[xs(0), ys(0)]], ptsN = [[xs(0), ys(0)]];
    for (var i = 0; i < n; i++) { ptsY.push([xs(xAt(i + 1)), ys(m.cum[i])]); if (hasN) ptsN.push([xs(xAt(i + 1)), ys(m.ncum[i])]); }
    var bands = hasN ? shade(ptsY, ptsN, n, fp) : '';
    var pl = function (pts) { return 'M' + pts.map(function (p) { return n2(p[0]) + ',' + n2(p[1]); }).join('L'); };
    // rows of the key, then the two ends of the axis
    rows.forEach(function (r, ri) { texts.push({ t: r.t, x: X0 + sw + 12, y: bandTop + FS + 2 + ri * rowH, size: FS, w: r.w, fill: r.fill, k: r.k }); });
    var AF = spec.axisFS, ay = PB + AF + 8;
    texts.push({ t: m.startText, x: X0, y: ay, size: AF, w: 500, fill: 'mute', k: 'start' });
    if (m.endText) texts.push({ t: m.endText, x: X1 + 2, y: ay, size: AF, w: 500, fill: 'mute', anchor: 'end', k: 'end-date' });
    // the months' first letters, quiet, one row under the two ends of the axis (one text element: one x for each letter)
    var ly = ay + AF + 6, H = ly + 14;
    var o = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img"' + (m.svgAttrs || '') + '>' + (m.svgHead || '') + bands;
    o += '<path d="M' + X0 + ',' + PB + 'H' + (X1 + 2) + '"' + fp('stroke', 'ink') + ' stroke-width="1.5" fill="none"/>';
    if (spec.ticks && m.ticks && m.ticks.length) o += '<path d="' + m.ticks.map(function (v) { return 'M' + n2(xs(v)) + ',' + PB + 'v6'; }).join('') + '"' + fp('stroke', 'mute') + ' stroke-width="1.5" fill="none"/>';
    if (hasN) o += '<path d="' + pl(ptsN) + '" fill="none"' + fp('stroke', 'mute') + ' stroke-width="2.5" stroke-dasharray="8 6" stroke-linejoin="round"/>';
    o += '<path d="' + pl(ptsY) + '" fill="none"' + fp('stroke', 'rain') + ' stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/>';
    o += '<circle cx="' + n2(ptsY[n][0]) + '" cy="' + n2(ptsY[n][1]) + '" r="5.5"' + fp('fill', 'rain') + '/>';
    if (hasN) o += '<circle cx="' + n2(ptsN[n][0]) + '" cy="' + n2(ptsN[n][1]) + '" r="4.5"' + fp('fill', 'mute') + '/>';
    rows.forEach(function (r, ri) {
      var yy = bandTop + FS + 2 - Math.round(FS * 0.36) + ri * rowH, SW = spec.sw;
      if (r.sw === 'rain') o += '<path d="M' + X0 + ',' + n2(yy) + 'H' + (X0 + SW) + '"' + fp('stroke', 'rain') + ' stroke-width="4.5" stroke-linecap="round" fill="none"/>';
      else if (r.sw === 'usual') o += '<path d="M' + X0 + ',' + n2(yy) + 'H' + (X0 + SW) + '"' + fp('stroke', 'mute') + ' stroke-width="2.5" stroke-dasharray="8 6" fill="none"/>';
      else o += '<rect x="' + X0 + '" y="' + n2(yy - 8) + '" width="' + SW + '" height="16" class="rce-f-' + (r.sw === 'wet' ? 'wet rce-s-wetEdge' : 'dry rce-s-dryEdge') + '" stroke-width="1"/>';
    });
    if (m.letters && m.letters.length) o += '<text x="' + m.letters.map(function (v) { return n2(xs(v) - AF * 0.3); }).join(' ') + '" y="' + ly + '"' + fp('fill', 'mute') + ' font-size="' + AF + '" fill-opacity=".7">' + 'JFMAMJJASOND'.slice(0, m.letters.length) + '</text>';
    texts.forEach(function (t) {
      if (!t.t) return;
      o += '<text x="' + n2(t.x) + '" y="' + n2(t.y) + '"' + fp('fill', t.fill) + ' font-size="' + t.size + '" font-weight="' + t.w + '"' + (t.anchor ? ' text-anchor="end"' : '') + '>' + esc(t.t) + '</text>';
    });
    o += '</svg>';
    return { svg: o, W: W, H: H, texts: texts.map(function (t) { return { t: t.t, k: t.k, size: t.size, x: t.x, y: t.y, anchor: t.anchor || 'start' }; }), notes: [],
      plot: { X0: X0, X1: X1, PT: PT, PB: PB }, keyAt: { x: X0, y: bandTop, band: true }, hasN: hasN };
  }

  function build(m, measure, spec, extra) {
    spec = spec || EMAIL;
    if (spec.band) return buildBand(m, measure, spec);
    build.why = '';
    var W = spec.W, PADX = spec.PADX, fixed = !!spec.fixed, C = spec.colors || EMAIL_COLORS;
    var SERIFF = spec.serif || (spec.vars ? 'var(--font-display,system-ui,sans-serif)' : SERIF), SANSF = spec.sans || (spec.vars ? 'var(--font-body,system-ui,sans-serif)' : SANS);
    var mfont = spec.measureFamily || null;
    var hasN = !!(m && m.ncum && m.usual > 0);
    var plain = !!spec.allowPlain;
    if (!m || !m.cum || m.cum.length < 2 || (!plain && (!m.verdict || !hasN)) || (hasN && m.ncum.length !== m.cum.length) || (!m.verdict && !m.headBig)) {
      build.why = plain ? 'no series' : 'no usual year to compare'; return null;
    }
    var texts = [], notes = [];
    var meas = function (s, size, w, fam) { return measure(s, (w || 400) + ' ' + size + 'px ' + (mfont ? (fam === SERIFF ? mfont.serif : mfont.sans) : (fam || SANSF))); };
    var fp = function (kind, c) {           // a paint: a literal colour (the email) or a CSS class the page colours (light and dark)
      return spec.vars ? ' class="rce-' + (kind === 'fill' ? 'f' : 's') + '-' + c + '"' : ' ' + (kind === 'fill' ? 'fill' : 'stroke') + '="' + C[c] + '"';
    };

    // ---- the headline (two rows always on a page, so the height holds)
    var hv = m.headBig ? { big: m.headBig, small: m.headSmall || '' } : splitVerdict(m.verdict), big = spec.bigMax, maxW = W - 2 * PADX;
    while (big > spec.bigMin && meas(hv.big, big, spec.bigW || 600, SERIFF) > maxW) big -= 2;
    var SM = spec.SM, bigBase = fixed ? spec.bigMax : big, y = 22 + Math.round(bigBase * 0.8);
    texts.push({ t: hv.big, x: PADX, y: y, size: big, w: spec.bigW || 600, fam: SERIFF, fill: 'ink', k: 'headline' });
    var headBottom = y + 8;
    if (hv.small || fixed) {
      y += 10 + Math.round(SM * 0.95);
      if (hv.small) texts.push({ t: hv.small, x: PADX, y: y, size: SM, w: 500, fam: SERIFF, fill: 'ink', k: 'headline2' });
      headBottom = y + 8;
    }

    // ---- the chart: Jan 1 at the left edge to the last reported day at the right edge
    var X0 = PADX, X1 = W - PADX - 16;
    var PT = headBottom + spec.gapTop + (extra || 0), PB = fixed ? headBottom + spec.gapTop + spec.plotH : PT + spec.plotH;
    var n = m.cum.length, xn = m.xn || n;
    var cumF = [], last = 0;      // this year, a gap (an unreported day) carried flat for the fill only
    m.cum.forEach(function (c) { if (c !== null && c !== undefined) last = c; cumF.push(last); });
    var maxV = 0.01;
    cumF.concat(hasN ? m.ncum : []).forEach(function (v) { if (v > maxV) maxV = v; });
    var xs = function (v) { return X0 + (X1 - X0) * v / xn; };       // day boundary v, 0..xn
    var ys = function (v) { return PB - (PB - PT) * v / maxV; };
    var xAt = function (i) { return m.x ? m.x[i - 1] : i; };         // the boundary after point i (1..n)
    var ptsY = [[xs(0), ys(0)]], ptsN = [[xs(0), ys(0)]];
    for (var i = 0; i < n; i++) { ptsY.push([xs(xAt(i + 1)), ys(cumF[i])]); if (hasN) ptsN.push([xs(xAt(i + 1)), ys(m.ncum[i])]); }
    var endY = ptsY[n][1], endN = hasN ? ptsN[n][1] : 0;

    // the shaded gap: warm stone where the usual year is ahead, pale blue where this year is, one path a run
    var bands = '';
    if (hasN) {
      var runs = [], cur = null;
      var sgn = function (k) { var d = (k === 0 ? 0 : ptsN[k][1] - ptsY[k][1]); return d < -1e-9 ? 1 : d > 1e-9 ? -1 : 0; };  // screen y: smaller is higher
      var push = function (s, a, b) { if (!cur || cur.s !== s) { cur = { s: s, top: [], bot: [] }; runs.push(cur); } cur.top.push(a); cur.bot.push(b); };
      for (var k = 1; k <= n; k++) {
        var s1 = sgn(k), s0 = k === 1 ? s1 : sgn(k - 1);
        var u0 = ptsN[k - 1], u1 = ptsN[k], v0 = ptsY[k - 1], v1 = ptsY[k];
        if (s1 !== 0 && s0 !== 0 && s1 !== s0) {            // the lines cross inside this step: split at the crossing
          var d0 = u0[1] - v0[1], d1 = u1[1] - v1[1], t = d0 / (d0 - d1), cx = u0[0] + (u1[0] - u0[0]) * t, cy = u0[1] + (u1[1] - u0[1]) * t;
          push(s0, u0, v0); push(s0, [cx, cy], [cx, cy]);
          cur = null; push(s1, [cx, cy], [cx, cy]); push(s1, u1, v1);
        } else if (s1 !== 0) { if (k === 1 || !cur) push(s1, u0, v0); push(s1, u1, v1); }
        else cur = null;
      }
      runs.forEach(function (r) {
        if (r.top.length < 2) return;
        var dd = 'M' + r.top.map(function (p) { return n2(p[0]) + ',' + n2(p[1]); }).join('L') + 'L' +
          r.bot.slice().reverse().map(function (p) { return n2(p[0]) + ',' + n2(p[1]); }).join('L') + 'Z';
        bands += '<path d="' + dd + '"' + fp('fill', r.s === 1 ? 'dry' : 'wet') + '/>';
      });
    }

    // this year, broken where the station sent nothing; the usual year a dashed line
    var dY = '', pen = false;
    for (var j = 0; j < n; j++) {
      if (m.cum[j] === null || m.cum[j] === undefined) { pen = false; continue; }
      if (!pen) { dY += 'M' + n2(ptsY[j][0]) + ',' + n2(ptsY[j][1]); pen = true; }
      dY += 'L' + n2(ptsY[j + 1][0]) + ',' + n2(ptsY[j + 1][1]);
    }
    var dN = hasN ? 'M' + ptsN.map(function (p) { return n2(p[0]) + ',' + n2(p[1]); }).join('L') : '';

    // ---- the labels: one key (this year, a normal year, the gap), each led by a sample of what it names, set in the
    // emptiest corner of the chart; the curves only climb, so the top left is clear for most years. The key slides to
    // the first spot where no line, dot, baseline or edge touches it; when no corner is free it takes a band above the
    // chart (the email's picture grows by it; a page's chart gets shorter by it, the page's height never moves).
    var segs = [];
    for (var q = 1; q <= n; q++) { segs.push([ptsY[q - 1], ptsY[q]]); if (hasN) segs.push([ptsN[q - 1], ptsN[q]]); }
    var gapPx = hasN ? Math.abs(ptsY[n][1] - ptsN[n][1]) : 0, gapText = hasN && gapPx >= spec.gapMin ? m.gapText : '';
    var rowH = spec.rowH, sw = spec.sw + (fixed ? 10 : 10), FS = spec.keyFS;
    var rows = [{ t: m.yText, w: 600, fill: 'rain', sw: 'rain', k: 'end' }];
    if (hasN) rows.push({ t: m.uText, w: 500, fill: 'mute', sw: 'usual', k: 'end' });
    if (gapText) rows.push({ t: gapText, w: 600, fill: 'ink', sw: m.cum[n - 1] > m.ncum[n - 1] ? 'wet' : 'dry', k: 'gap' });
    var keyW = function () { return sw + 12 + Math.max.apply(null, rows.map(function (r) { return meas(r.t, FS, r.w); })); };
    if (fixed) while (keyW() > W - 2 * PADX && FS > spec.keyMin) FS -= 1;       // a long line on a narrow page: the key shrinks before it spills
    var kw = keyW() - sw - 12, keyWv = keyW(), boxH = Math.round(FS * 1.18);
    var dots = [[ptsY[n][0], ptsY[n][1]]].concat(hasN ? [[ptsN[n][0], ptsN[n][1]]] : []), keyed = null;
    var cp = spec.clearPad || 6;                  // how far a line or a dot must stay from a label (the email's 6 is unchanged)
    var clear = function (b) {
      if (b.x < 6 || b.x + b.w > W - 6 || b.y < headBottom + 4 || b.y + b.h > PB - 4) return false;
      for (var s = 0; s < segs.length; s++) if (segHits(segs[s][0][0], segs[s][0][1], segs[s][1][0], segs[s][1][1], { x: b.x - cp, y: b.y - cp, w: b.w + 2 * cp, h: b.h + 2 * cp })) return false;
      return !dots.some(function (d) { return d[0] > b.x - 2 * cp && d[0] < b.x + b.w + 2 * cp && d[1] > b.y - 2 * cp && d[1] < b.y + b.h + 2 * cp; });
    };
    var kxs = [X0, Math.round((X0 + X1 - keyWv) / 2), Math.round(X1 - keyWv)];
    for (var xi = 0; xi < kxs.length && !keyed; xi++) {
      for (var ky = headBottom + 14; ky <= PB - rows.length * rowH - 14 && !keyed; ky += 6) {
        var kb = rows.map(function (r, ri) { return { x: kxs[xi], y: ky + ri * rowH + 2, w: sw + 12 + meas(r.t, FS, r.w), h: boxH }; });
        if (kb.every(clear)) keyed = { kx: kxs[xi], ky: ky, kb: kb, rows: rows };
      }
    }
    if (!keyed) {
      var band = (fixed ? rows.length : 3) * rowH + 12;
      if (!extra) {
        if (fixed && band > spec.plotH - 90) { build.why = 'no room for the key'; return null; }
        return build(m, measure, spec, band);
      }
      build.why = 'no room for the key'; return null;
    }
    rows.forEach(function (r, ri) {
      texts.push({ t: r.t, x: keyed.kx + sw + 12, y: keyed.ky + FS + 2 + ri * rowH, size: FS, w: r.w, fam: SANSF, fill: r.fill, k: r.k, box: keyed.kb[ri] });
    });

    // the start of the year, under the left end of the baseline; the last day under the right end
    var AF = spec.axisFS, ay = PB + AF + 8;
    texts.push({ t: m.startText, x: X0, y: ay, size: AF, w: 500, fam: SANSF, fill: 'mute', k: 'start' });
    if (m.endText) texts.push({ t: m.endText, x: X1 + 2, y: ay, size: AF, w: 500, fam: SANSF, fill: 'mute', anchor: 'end', k: 'end-date' });

    // ---- the foot: the year big, the place under it
    var fy = ay + 24 + (fixed ? spec.yearFS * 0.9 : 46);
    texts.push({ t: String(m.year), x: PADX, y: fy, size: spec.yearFS, w: 400, fam: SERIFF, fill: 'ink', k: 'year' });
    var psize = spec.placeMax, pw = meas(m.place, psize, 500, SERIFF), pl2 = [m.place];
    while (psize > spec.placeMin && pw > maxW) { psize -= 1; pw = meas(m.place, psize, 500, SERIFF); }
    if (!fixed && pw > maxW) {            // still too long: break after the comma, county over state
      var ci = m.place.indexOf(', ');
      if (ci > 0) {
        pl2 = [m.place.slice(0, ci + 1), m.place.slice(ci + 2)]; psize = 24;
        while (psize > 16 && pl2.some(function (ln) { return meas(ln, psize, 500, SERIFF) > maxW; })) psize -= 1;
      }
    }
    if (fixed && pw > maxW) {            // a long place on a page: cut at the last word that fits, with an ellipsis
      var words = m.place.split(' ');
      while (words.length > 1 && meas(words.join(' ') + '\u2026', psize, 500, SERIFF) > maxW) words.pop();
      pl2 = [words.join(' ') + '\u2026'];
    }
    var py = fy + 14 + Math.round(psize * 0.95);
    pl2.forEach(function (line, li) { texts.push({ t: line, x: PADX, y: py + li * Math.round(psize * 1.25), size: psize, w: 500, fam: SERIFF, fill: 'ink', k: 'place' }); });
    var H = Math.round(py + (pl2.length - 1) * Math.round(psize * 1.25) + (fixed ? 18 : 26));
    if (fixed) H = Math.round(headBottom + spec.gapTop + spec.plotH + AF + 8 + 24 + spec.yearFS * 0.9 + 14 + Math.round(spec.placeMax * 0.95) + 18);

    // ---- the svg
    var o = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '"' + (fixed ? '' : ' width="' + W + '" height="' + H + '"') + ' role="img"' + (m.svgAttrs || '') + '>';
    if (m.svgHead) o += m.svgHead;
    if (!spec.vars) o += '<rect width="' + W + '" height="' + H + '" fill="#FFFFFF"/>';
    o += bands;
    o += '<path d="M' + X0 + ',' + PB + 'H' + (X1 + 2) + '"' + fp('stroke', 'ink') + ' stroke-width="1.5" fill="none"/>';
    if (hasN) o += '<path d="' + dN + '" fill="none"' + fp('stroke', 'mute') + ' stroke-width="2.5" stroke-dasharray="8 6" stroke-linejoin="round"/>';
    o += '<path d="' + dY + '" fill="none"' + fp('stroke', 'rain') + ' stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/>';
    o += '<circle cx="' + n2(ptsY[n][0]) + '" cy="' + n2(endY) + '" r="5.5"' + fp('fill', 'rain') + '/>';
    if (hasN) o += '<circle cx="' + n2(ptsN[n][0]) + '" cy="' + n2(endN) + '" r="4.5"' + fp('fill', 'mute') + '/>';
    keyed.rows.forEach(function (r, ri) {
      var yy = keyed.ky + FS + 2 - Math.round(FS * 0.36) + ri * rowH, X0k = keyed.kx, SW = spec.sw;
      if (r.sw === 'rain') o += '<path d="M' + X0k + ',' + n2(yy) + 'H' + (X0k + SW) + '"' + fp('stroke', 'rain') + ' stroke-width="4.5" stroke-linecap="round" fill="none"/>';
      else if (r.sw === 'usual') o += '<path d="M' + X0k + ',' + n2(yy) + 'H' + (X0k + SW) + '"' + fp('stroke', 'mute') + ' stroke-width="2.5" stroke-dasharray="8 6" fill="none"/>';
      else o += '<rect x="' + X0k + '" y="' + n2(yy - 8) + '" width="' + SW + '" height="16"' + fp('fill', r.sw === 'wet' ? 'wet' : 'dry') + fp('stroke', r.sw === 'wet' ? 'wetEdge' : 'dryEdge') + ' stroke-width="1"/>';
    });
    texts.forEach(function (t) {
      o += '<text x="' + n2(t.x) + '" y="' + n2(t.y) + '"' + (spec.vars ? ' class="rce-f-' + t.fill + '" style="font-family:' + t.fam + '"' : ' font-family="' + t.fam.replace(/"/g, '') + '"') +
        ' font-size="' + t.size + '" font-weight="' + t.w + '"' + (spec.vars ? '' : ' fill="' + C[t.fill] + '"') + (t.anchor ? ' text-anchor="' + t.anchor + '"' : '') + '>' + esc(t.t) + '</text>';
    });
    o += '</svg>';
    return { svg: o, W: W, H: H, texts: texts.map(function (t) { return { t: t.t, k: t.k, size: t.size, x: t.x, y: t.y, anchor: t.anchor || 'start', box: t.box }; }), notes: notes,
      plot: { X0: X0, X1: X1, PT: PT, PB: PB }, keyAt: { x: keyed.kx, y: keyed.ky, band: !!extra } };
  }

  /* ---------------------------------------------------------------- the page side: words and numbers from the page's own fields */

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso) { var p = String(iso).split('-').map(Number); return MON[p[1] - 1] + ' ' + p[2]; }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function commas(s) { var p = String(s).split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); return p.join('.'); }
  var numOk = function (v) { return v !== '' && v !== null && v !== undefined && isFinite(+v); };

  /* The sentence the full print says for a year against a normal one (rain-print-art.js verdict), from the page's own
     percent of normal. Under a 3% difference it says about a normal year; past double, "2.1 times". */
  function verdictOf(pct, preview) {
    if (!numOk(pct)) return null;
    var d = +pct - 100, soFar = preview ? ' so far' : '', ratio = +pct / 100;
    if (Math.abs(d) <= 3) return 'About a normal year' + soFar;
    // one rule for "times": from 1.95 on, "Twice" for 1.95 to 2.05, else one decimal ("2.6 times")
    if (ratio >= 1.95) return (ratio <= 2.05 ? 'Twice' : ratio.toFixed(1) + ' times') + ' a normal year' + soFar;
    return Math.abs(d) + '% ' + (d < 0 ? 'less' : 'more') + ' than a normal year' + soFar;
  }

  /* The model for one figure. D carries: year, place, total, usual (empty: no normal), pct (empty: no fair percent),
     asof (the last day reported, ISO), days, miss (days not reported), noun, wk ("doy,total,usual;..." in hundredths,
     one point a week and the last day, the points the page's old chart drew). */
  function fromData(D) {
    var year = +D.year, total = +D.total, hasU = numOk(D.usual), usual = hasU ? +D.usual : null;
    // data-wk: one point a week and the last day. The days are implied (the 7th of January and every 7 days on, the last point on the last day
    // reported, data-days less one); the totals are hundredths, the first whole and the rest the week's change: "total,normal;change,change;..."
    var parts = String(D.wk || '').split(';').filter(Boolean), pts = [], ct = 0, cu = 0, dn = +D.days;
    parts.forEach(function (q, i) {
      var v = q.split(',').map(Number); ct += v[0]; if (v.length > 1) cu += v[1];
      pts.push(v.length > 1 ? [i < parts.length - 1 ? 6 + 7 * i : dn - 1, ct, cu] : [i < parts.length - 1 ? 6 + 7 * i : dn - 1, ct]);
    });
    if (!pts.length || !isFinite(year) || !isFinite(total) || !isFinite(dn)) return null;
    var days = +D.days, preview = days < (isLeap(year) ? 366 : 365), dp = numOk(D.dec) ? +D.dec : 2;
    var cum = pts.map(function (p) { return p[1] / 100; }), x = pts.map(function (p) { return p[0] + 1; });
    var ncum = hasU && pts.every(function (p) { return p.length > 2 && isFinite(p[2]); }) ? pts.map(function (p) { return p[2] / 100; }) : null;
    var T = commas(total.toFixed(dp)), pctOk = ncum && numOk(D.pct);
    var m = {
      year: year, place: D.place, cum: cum, ncum: ncum, x: x, xn: x[x.length - 1], usual: ncum ? usual : null,
      yText: T + ' in this year',
      startText: 'Jan 1', endText: fmtDate(D.asof)
    };
    // the headline says the page's own sentence: "150% of normal" (the page prints the percent that way), then "so far"
    if (pctOk) { m.headBig = (+D.pct) + '% of normal'; m.headSmall = preview ? 'so far' : 'this year'; }
    else { m.headBig = T + ' inches'; m.headSmall = preview ? 'of rain so far' : 'of rain this year'; }
    if (ncum) {
      var gap = usual - total, U = commas(usual.toFixed(dp)), gAbs = Math.abs(gap), gmin = numOk(D.gapmin) ? +D.gapmin : 0.5;   // D.gapmin: the smallest difference the page itself prints (Field Scout: 0.25)
      m.uText = preview ? U + ' in normal by ' + fmtDate(D.asof) : U + ' in a normal year' + (+D.miss > 0 ? ', same days' : '');
      // each fact once: the headline says the percent, the rows say this year, the normal and the gap
      m.gapText = gAbs >= gmin ? commas(gAbs.toFixed(dp)) + ' in' + (gap > 0 ? ' short' : ' more') : '';
    }
    m.total = T; m.pct = numOk(D.pct) ? +D.pct : null;
    // quiet month ticks on the baseline (the wide design): the first of each month after Jan 1 that is not within 12 days of the last day
    m.ticks = [];
    for (var mo = 1; mo < 12; mo++) { var dd = Math.round((Date.UTC(year, mo, 1) - Date.UTC(year, 0, 1)) / 864e5); if (dd < m.xn - 12) m.ticks.push(dd); }
    // the month letters sit at the middle of each month so far (the last month's middle of the part gone by)
    m.letters = [];
    for (var lm = 0; lm < 12; lm++) {
      var d0 = Math.round((Date.UTC(year, lm, 1) - Date.UTC(year, 0, 1)) / 864e5), d1 = Math.min(Math.round((Date.UTC(year, lm + 1, 1) - Date.UTC(year, 0, 1)) / 864e5), m.xn);
      if (d0 >= m.xn - 6) break;
      m.letters.push((d0 + d1) / 2);
    }
    return m;
  }

  /* The text alternative: the page's own figures in one sentence. */
  function describe(D, m) {
    var noun = D.noun || 'station', dp = numOk(D.dec) ? +D.dec : 2, up = m.ncum ? ', against ' + commas((+D.usual).toFixed(dp)) + ' inches in a normal year by then' : '';
    var gap = m.ncum ? (+D.usual) - (+D.total) : 0, gAbs = Math.abs(gap);
    return 'Running total of rain ' + (D.where || 'at the ' + noun + ' in ' + D.place) + ', ' + D.year + ': ' + m.total + ' inches through ' + fmtDate(D.asof) + up +
      (m.ncum && gAbs >= 0.005 ? ', ' + commas(gAbs.toFixed(dp)) + ' inches ' + (gap > 0 ? 'less' : 'more') + ' than a normal year' : '') +
      (m.pct != null ? '. ' + m.pct + '% of normal' + (+D.days < (isLeap(+D.year) ? 366 : 365) ? ' so far' : '') + '.' : '.');
  }

  var CSS = '.rce-art svg{display:block;width:100%;height:auto}.rce svg text{font-family:var(--font-body,system-ui,sans-serif)}' +
    '.rce{--rce-ink:var(--text,#161a18);--rce-mute:var(--text-muted,#5e6475);--rce-rain:var(--blue,#6f9fc2);--rce-dry:rgba(200,178,140,.30);--rce-wet:rgba(111,159,194,.30);--rce-dry-edge:rgba(200,178,140,.55);--rce-wet-edge:rgba(111,159,194,.6)}' +
    '[data-theme="light"] .rce,.rce[data-theme="light"]{--rce-rain:#2b5c8a;--rce-mute:#4f5668;--rce-dry:#ece6de;--rce-wet:#e3ebf3;--rce-dry-edge:#cfc6ba;--rce-wet-edge:#b9c7d6}' +
    '.rce-f-ink{fill:var(--rce-ink)}.rce-f-mute{fill:var(--rce-mute)}.rce-f-rain{fill:var(--rce-rain)}.rce-f-dry{fill:var(--rce-dry)}.rce-f-wet{fill:var(--rce-wet)}' +
    '.rce-s-ink{stroke:var(--rce-ink)}.rce-s-mute{stroke:var(--rce-mute)}.rce-s-rain{stroke:var(--rce-rain)}.rce-s-dryEdge{stroke:var(--rce-dry-edge)}.rce-s-wetEdge{stroke:var(--rce-wet-edge)}';
  function injectCss() {
    var doc = root.document;
    if (!doc || doc.getElementById('rce-css')) return;
    var s = doc.createElement('style'); s.id = 'rce-css'; s.textContent = CSS; (doc.head || doc.documentElement).appendChild(s);
  }

  var mq = null;
  function wideNow() {
    try { mq = mq || root.matchMedia('(min-width: 561px)'); return mq.matches; } catch (e) { return true; }
  }
  /* Widths are measured on a hidden SVG text in the page itself, so they are the widths of the font the browser really
     draws with. (A canvas measured Inter at 266 px where the page, whose font-display is optional, had drawn the same
     line in its fallback font at 278: the key then ran into the line beside it.) The measure sits in <body>, off screen
     and invisible, never inside the chart: text in a hidden box (a chart drawn before its box is shown) measures 0. It takes the chart's computed font, and every other inherited text
     property that changes a width (the page sets tabular numerals), from the chart element itself. */
  var MPROPS = ['fontFamily', 'fontVariantNumeric', 'fontFeatureSettings', 'fontVariationSettings', 'fontStretch', 'fontKerning', 'letterSpacing', 'wordSpacing', 'textRendering', 'fontSynthesis'];
  var msvg = null;
  function measurer(el) {
    var doc = root.document, NS = 'http://www.w3.org/2000/svg';
    if (!msvg || !msvg.isConnected) {
      msvg = doc.createElementNS(NS, 'svg');
      msvg.setAttribute('class', 'rce-m'); msvg.setAttribute('aria-hidden', 'true'); msvg.setAttribute('width', '10'); msvg.setAttribute('height', '10');
      msvg.setAttribute('style', 'position:fixed;left:-9999px;top:0;visibility:hidden;overflow:hidden;pointer-events:none');
      msvg.appendChild(doc.createElementNS(NS, 'text'));
      (doc.body || doc.documentElement).appendChild(msvg);
    }
    var cs = root.getComputedStyle(el), tx = msvg.firstChild;
    MPROPS.forEach(function (k) { if (cs[k]) tx.style[k] = cs[k]; });
    return { svg: msvg, measure: function (t, font) {
      var f = /^(\d+) (\d+(?:\.\d+)?)px (.*)$/.exec(font);
      // not the font shorthand: it resets every other font property, tabular numerals included
      tx.style.fontWeight = f[1]; tx.style.fontSize = f[2] + 'px'; tx.style.fontFamily = f[3]; tx.textContent = t;
      return tx.getComputedTextLength();
    } };
  }

  /* The chart's figures: its own data- fields over those of the county page's print figure it sits in (year, place, total, days, and the
     normal when the print has it), which the page writes once. */
  function dataOf(el) {
    var fig = el.closest && el.closest('#rc-print');
    return Object.assign({}, fig ? fig.dataset : {}, el.dataset);
  }
  /* Which design: a county page's chart follows the screen (the stylesheet holds its room by the same media query). A chart in a card
     of its own (class rce-fs, the Field Scout season card, a 340 px side panel on a laptop) follows its own width, so a narrow panel
     on a wide screen gets the phone design and its larger labels. */
  function designFor(el, box) {
    if (el.classList && el.classList.contains('rce-fs')) {
      var w = el.clientWidth;      // the same width the stylesheet's container query holds the room by
      if (w > 0) return w >= 480 ? 'wide' : 'phone';
    }
    // a county page or Fast Facts wider than a phone: the chart is the print's placeholder in the print's box, phone-shaped like the inline
    // drawing the page ships, so nothing is drawn twice at two shapes
    if (el.closest && (el.closest('.rce-top') || el.closest('.rc-print-art'))) return 'phone';
    return wideNow() ? 'wide' : 'phone';
  }
  /* draw into el (a figure carrying the data- fields, with an empty .rce-art). Returns the drawing's result or null. */
  function draw(el) {
    var D = dataOf(el), box = el.querySelector('.rce-art');
    if (!box) return null;
    var m = fromData(D);
    if (!m) { el.classList.add('rce-off'); return null; }
    injectCss();
    var cs = root.getComputedStyle(el), fam = cs.fontFamily || 'system-ui, sans-serif';
    var spec = Object.assign({}, designFor(el, box) === 'wide' ? WIDE : PHONE, { allowPlain: true, measureFamily: { serif: fam, sans: fam } });
    var title = 'Running total of rain, ' + D.year, id = 'rce-' + (D.fips || D.year);
    m.svgAttrs = ' aria-labelledby="' + id + '-t ' + id + '-d"';
    m.svgHead = '<title id="' + id + '-t">' + esc(title + ', ' + D.place) + '</title><desc id="' + id + '-d">' + esc(describe(D, m)) + '</desc>';
    var ms = measurer(el);
    var out = build(m, ms.measure, spec);
    if (!out) { el.classList.add('rce-off'); return null; }
    box.innerHTML = out.svg;
    el.classList.remove('rce-off');
    el.setAttribute('data-rce', spec.name);
    return out;
  }
  var DRAWN = [];
  function mount(el) {
    if (!el || !el.dataset) return null;
    var out = draw(el);
    if (DRAWN.indexOf(el) < 0) { DRAWN.push(el); if (root.addEventListener && !mount.rz) { mount.rz = 1; root.addEventListener('resize', onResize); } }
    return out;
  }
  var rzT = null;
  function onResize() {
    root.clearTimeout(rzT);
    rzT = root.setTimeout(function () {
      DRAWN.forEach(function (el) {
        if (el.isConnected !== false && el.classList.contains('rce-fs') && el.getAttribute('data-rce') !== designFor(el, el.querySelector('.rce-art') || el)) draw(el);
      });
    }, 200);
  }
  function redrawAll() { DRAWN.forEach(function (el) { if (el.isConnected !== false) draw(el); }); }
  function auto() {
    var doc = root.document;
    if (!doc) return;
    Array.prototype.forEach.call(doc.querySelectorAll('.rce[data-wk]'), mount);
    try { (mq = mq || root.matchMedia('(min-width: 561px)')).addEventListener('change', redrawAll); } catch (e) {}
    // the page's own font arrives after the first draw: lay it out once more, same height, same place
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(redrawAll, function () {});
  }
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', auto); else auto();
  }

  return { build: build, splitVerdict: splitVerdict, verdictOf: verdictOf, fromData: fromData, describe: describe, mount: mount, draw: draw,
    EMAIL: EMAIL, PHONE: PHONE, WIDE: WIDE, COLORS: EMAIL_COLORS, W: EMAIL.W, CSS: CSS };
});
