/* components/rp-insert.js: the letter that goes on top in every Rain Print box (2026-10-17, Sig).
 *
 * One page, letter size (8.5 x 11 in, 850 x 1100 units, 100 to the inch), so
 * whoever opens the box knows what it is before they see the print. It lies
 * flat on the print in the 12 x 18 box, no fold. Made on Sig's print files page
 * (/rain-print?maker=1, "Insert letter PDF") the way the order files are made:
 * this SVG, drawn into a 300 dpi canvas, wrapped in a one-page PDF. Prints and
 * framed prints only; a digital file has no box.
 *
 * Every number on it comes from AgRainArt.facts(), read from the same model the
 * print is drawn from (components/rain-print-art.js), so the letter and the print
 * can never disagree. The small picture of the print is the print itself, drawn
 * by the same engine. The QR at the foot is the standard code to the Rain Print
 * page (the same one every preview and test print carries).
 *
 *   AgRpInsert.copy(o)   -> the words, in order (pure; the tests read it)
 *   AgRpInsert.render(o) -> the SVG string
 *
 * o = {
 *   facts: AgRainArt.facts(input, {unplaced}),
 *   station: {words: "Ames, IA", dist: "2.0 mi from Ames", kind: 'volunteer' | 'coop' | 'noaa' | 'canada'},
 *   source: "NOAA’s daily records" (Canada: Environment and Climate Change Canada’s),
 *   mini: the print's own SVG (AgRainArt.render, no px), serial: "No. 0001" or '',
 *   gift: the giver's note from the order, or '' (the block is left off),
 *   qr: the standard code's matrix, fontCss, measure(text, style) -> width (optional), px [w, h]
 * }
 * Copy rules (Sig): plain farm words, no em dashes, no store or printer names,
 * never "archival", no prices, no counts of buyers. */
(function (root) {
  'use strict';

  var W0 = 850, H0 = 1100, M = 50, CW = W0 - 2 * M;   // 0.5 in margins: the letter is printed on a sheet, not trimmed
  var ART = function () { return root.AgRainArt || {}; };
  var SANS = "'IBM Plex Sans',system-ui,sans-serif", SERIF = "'Fraunces',Georgia,serif";
  var INK = '#1E2125', MUTE = '#5E6475', RULE = '#D6D9D2', QR_INK = '#A4A89F';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var n2 = function (v) { return +(+v).toFixed(2); };
  function longDate(iso) { var p = String(iso).split('-').map(Number); return MONTHS[p[1] - 1] + ' ' + p[2]; }
  function rangeWords(a, b) {
    var p = String(a).split('-').map(Number), q = String(b).split('-').map(Number);
    return p[1] === q[1] ? MONTHS[p[1] - 1] + ' ' + p[2] + ' to ' + q[2] : longDate(a) + ' to ' + longDate(b);
  }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  // ------------------------------------------------------------------ the words
  var STATION_KIND = {
    volunteer: 'a rain gauge a volunteer keeps and reports to NOAA',
    coop: 'a NOAA co-op weather station',
    noaa: 'a NOAA weather station',
    canada: 'an Environment and Climate Change Canada weather station'
  };
  function copy(o) {
    var F = o.facts, S = o.station || {}, r2 = F.style === 'r2';
    var c = {};
    c.eyebrow = 'RAIN PRINT';
    c.head = 'What you’re holding';
    c.intro = 'Every rain and snow of ' + F.year + ' near ' + F.place + ', drawn day by day from ' + (o.source || 'NOAA’s daily records') + '.';
    c.station = S.words ? 'The gauge is ' + S.words + (S.dist ? ', ' + S.dist : '') + (STATION_KIND[S.kind] ? ', ' + STATION_KIND[S.kind] : '') + '.' : '';

    // the year in numbers: what the print itself says
    var nums = [];
    nums.push(['The year\u2019s total', F.totalText, F.liquid]);
    if (F.snowText) nums.push(['Snowfall', F.snowText, '']);
    if (F.wet) nums.push([F.wet.label, F.wet.amount, longDate(F.wet.date)]);
    if (F.dry) nums.push(['Longest dry stretch', F.dry.len + ' days', rangeWords(F.dry.from, F.dry.to)]);
    if (F.usual) {
      var what = String(F.usualNote || '').replace(/^A usual year: /, '');
      nums.push(['Next to a usual year', F.verdict || F.usual, (F.verdict ? 'usual: ' + F.usual : 'a usual year') + (what ? ', ' + what : '') + (F.missing ? ', on the days reported' : '')]);
    }
    nums.push([F.daysLabel, String(F.wetDays), '']);
    c.numbers = nums;
    c.snowNote = F.snowText ? '' : (F.snowNote ? F.snowNote + '.' : '');
    c.marked = (F.markers || []).map(function (m) { return m.words ? m.words + ', ' + longDate(m.date) : longDate(m.date); });

    // how to read it, from the style the print is in
    var key = [];
    if (!r2) {
      key.push(['climb', 'The blue line climbs with every rain and ends at the year’s total.']);
      if (F.snowText) key.push(['snowStep', 'Light blue steps came as snow.']);
      if (F.wet) key.push(['wet', 'Red step: the ' + (F.wet.label === 'Wettest day' ? 'wettest day' : 'biggest rain') + '.']);
      if (F.usual) key.push(['usual', 'Dashed line: a usual year. Pink where your year fell behind it, blue where it ran ahead.']);
      key.push(['months', 'Months along the bottom' + (F.normals ? ', each with its total and a usual month under it.' : '.')]);
      if (F.dry) key.push(['dry', 'Bracket: the longest dry stretch.']);
    } else {
      key.push(['bar', 'Each rain hangs under the ground line. The longer the bar, the bigger the rain.']);
      if (F.snowText) key.push(['pile', 'Snow piles up above the line, as deep as it fell.']);
      if (F.wet) key.push(['wetBar', 'Red bar: the ' + (F.wet.label === 'Wettest day' ? 'wettest day' : 'biggest rain') + '.']);
      key.push(['monthsTop', 'Months across the top, each with its total' + (F.normals ? ' and a usual month under it.' : '.')]);
      if (F.dry) key.push(['dryWords', 'The longest dry stretch is marked with its days.']);
    }
    if (F.gaps) key.push(['gap', 'A break: a day with no report, left blank, never drawn as dry.']);
    if (F.markers && F.markers.length) key.push(['dot', (F.markers.length === 1 ? 'Your day, with your words.' : 'Your days, with your words.')]);
    c.key = key;

    c.giftHead = 'A NOTE FOR YOU';
    c.gift = String(o.gift || '').replace(/\s+/g, ' ').trim();
    c.maker = 'Print ' + (o.serial || 'No. ______') + ', made, numbered and initialed by hand by Sig Lindquist, CCA, Chetek, Wisconsin.';
    c.makerSub = 'The number is under the code in the corner, my initials beside it in pencil.';
    c.care = ['Hang it out of direct sun. Sunlight fades any print in time.',
      'Keep it dry, away from a damp wall.',
      'Framed, it hangs on one nail. A loose print fits a standard 12 x 18 frame.'];
    c.footer = 'Draw another year at agsist.com/rain-print';
    c.footerSub = 'Any town, any year the nearest station kept records.';
    return c;
  }

  // ------------------------------------------------------------------ drawing
  var canvasCtx = null;
  function measureWith(o) {
    if (typeof o.measure === 'function') return o.measure;
    return function (s, st) {
      try {
        if (!canvasCtx && root.document && root.document.createElement) { var cv = root.document.createElement('canvas'); canvasCtx = cv.getContext ? cv.getContext('2d') : null; }
        if (canvasCtx) {
          canvasCtx.font = (st.it ? 'italic ' : '') + (st.w || 400) + ' ' + st.size + 'px ' + (st.fam || SANS);
          var m = canvasCtx.measureText(String(s));
          if (m && m.width > 0) return m.width + (st.ls || 0) * st.size * Math.max(0, String(s).length - 1);
        }
      } catch (e) { /* fall through */ }
      var rw = ART().roughW;
      return (rw ? rw(s, { fam: st.fam || SANS, w: st.w || 400, it: !!st.it, size: st.size }) : String(s).length * st.size * 0.55) + (st.ls || 0) * st.size * Math.max(0, String(s).length - 1);
    };
  }
  function T(x, y, s, st) {
    var ls = st.ls ? ' letter-spacing="' + n2(st.ls * st.size) + '"' : '';
    return '<text x="' + n2(x) + '" y="' + n2(y) + '" font-family="' + esc(st.fam || SANS) + '" font-weight="' + (st.w || 400) + '" font-style="' + (st.it ? 'italic' : 'normal') +
      '" font-size="' + n2(st.size) + '" fill="' + (st.fill || INK) + '" text-anchor="' + (st.anchor || 'start') + '"' + ls + ' style="font-variant-numeric:lining-nums">' + esc(s) + '</text>';
  }
  function wrap(meas, text, st, maxW) {
    var words = String(text).split(' '), lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (cur && meas(t, st) > maxW) { lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    return lines;
  }
  function line(x1, y1, x2, y2, stroke, sw, extra) {
    return '<line x1="' + n2(x1) + '" y1="' + n2(y1) + '" x2="' + n2(x2) + '" y2="' + n2(y2) + '" stroke="' + stroke + '" stroke-width="' + sw + '"' + (extra || '') + '/>';
  }
  /* The key's little marks, 40 x 22, in the print's own colors and line weights
     (scaled down with the miniature). y is the text's first baseline. */
  function swatch(kind, x, y) {
    var C = ART().COLORS || {}, top = y - 15, mid = y - 5, bot = y + 5, s = '';
    var stair = function (col, w, gap) {
      var d = 'M' + x + ',' + bot + 'H' + (x + 8) + 'V' + (mid + 3) + 'H' + (x + 18);
      d += gap ? 'M' + (x + 26) + ',' + (mid - 3) + 'H' + (x + 30) : 'V' + (mid - 3) + 'H' + (x + 28) + 'V' + top + 'H' + (x + 40);
      return '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + w + '" stroke-linejoin="round"/>';
    };
    switch (kind) {
      case 'climb': return stair(C.rain, 3);
      case 'snowStep': return '<path d="M' + x + ',' + bot + 'H' + (x + 14) + '" stroke="' + C.rain + '" stroke-width="3" fill="none"/><path d="M' + (x + 14) + ',' + bot + 'V' + top + 'H' + (x + 40) + '" stroke="' + C.snowLine + '" stroke-width="3" fill="none"/>';
      case 'wet': return '<path d="M' + x + ',' + bot + 'H' + (x + 20) + 'M' + (x + 20) + ',' + top + 'H' + (x + 40) + '" stroke="' + C.rain + '" stroke-width="3" fill="none"/>' + line(x + 20, bot, x + 20, top, C.accent, 3.4);
      case 'usual':
        s = '<rect x="' + x + '" y="' + top + '" width="20" height="' + (bot - top) + '" fill="' + C.dryBand + '"/><rect x="' + (x + 20) + '" y="' + top + '" width="20" height="' + (bot - top) + '" fill="' + C.wetBand + '"/>';
        return s + line(x, mid, x + 40, mid, C.mute, 1.6, ' stroke-dasharray="5 3"');
      case 'months': case 'monthsTop':
        return line(x, mid, x + 40, mid, C.ink, 1.2) + [0, 13, 26, 39].map(function (k) { return line(x + k + 0.5, mid - 4, x + k + 0.5, mid + 4, C.ink, 1); }).join('');
      case 'dry': return '<path d="M' + x + ',' + (mid - 4) + 'v5H' + (x + 40) + 'v-5" fill="none" stroke="' + C.mute + '" stroke-width="1"/>';
      case 'gap': return stair(C.rain, 3, true);
      case 'dot': return line(x + 20, mid, x + 20, bot + 2, C.mute, 0.8) + '<circle cx="' + (x + 20) + '" cy="' + mid + '" r="3.6" fill="' + C.ink + '"/>';
      case 'bar': case 'wetBar': case 'dryWords':
        s = line(x, top + 4, x + 40, top + 4, C.ink, 1.4);
        [4, 10, 16, 22, 28, 34].forEach(function (k, i) {
          var h = [6, 14, 4, 18, 9, 5][i], red = kind === 'wetBar' && i === 3;
          if (kind === 'dryWords' && (i === 2 || i === 3)) return;
          s += '<rect x="' + (x + k) + '" y="' + (top + 5) + '" width="3.4" height="' + h + '" fill="' + (red ? C.accent : C.bar) + '"/>';
        });
        return s;
      case 'pile':
        s = line(x, bot - 2, x + 40, bot - 2, C.ink, 1.4);
        [6, 12, 18, 24].forEach(function (k, i) { var h = [6, 14, 10, 4][i]; s += '<rect x="' + (x + k) + '" y="' + (bot - 3 - h) + '" width="4.4" height="' + h + '" fill="' + C.snowFill + '" stroke="' + C.snowEdge + '" stroke-width="0.6"/>'; });
        return s;
    }
    return '';
  }
  function qrMark(m, right, bottom, size) {
    if (!m || !m.length) return '';
    var n = m.length, cell = size / n, x0 = right - size, y0 = bottom - size, d = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n;) {
      if (!m[r][c]) { c++; continue; }
      var e = c; while (e < n && m[r][e]) e++;
      d += 'M' + n2(x0 + c * cell) + ',' + n2(y0 + r * cell) + 'H' + n2(x0 + e * cell) + 'V' + n2(y0 + (r + 1) * cell) + 'H' + n2(x0 + c * cell) + 'z';
      c = e;
    }
    return '<g data-rp="qr" aria-hidden="true"><path d="' + d + '" fill="' + QR_INK + '" shape-rendering="crispEdges"/></g>';
  }

  /* The page never runs long: a full page (a long gift note, five marked days)
     draws the small print smaller until everything fits above the foot. */
  function render(o) {
    var fits = [[400, 0], [360, 0], [340, 1], [320, 2], [320, 3], [280, 3]], svg = '';
    for (var k = 0; k < fits.length; k++) {
      svg = draw(Object.assign({}, o, { miniW: fits[k][0], tight: fits[k][1] }));
      if (!render.overflow) break;
    }
    return svg;
  }
  /* tight 1: the care list keeps its first line and the pencil line goes; tight 2: the note and the days a size smaller too;
     tight 3: the foot moves up beside the maker line. */
  function draw(o) {
    var c = copy(o), meas = measureWith(o), out = [], y;
    var size = o.px ? ' width="' + o.px[0] + '" height="' + o.px[1] + '"' : '';
    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W0 + ' ' + H0 + '"' + size + ' role="img" aria-label="' + esc(c.head + ': ' + o.facts.place + ', ' + o.facts.year) + '">' +
      (o.fontCss ? '<style>' + o.fontCss + '</style>' : '') + '<rect width="' + W0 + '" height="' + H0 + '" fill="#FFFFFF"/>');

    var eb = { size: 12.5, w: 500, ls: 0.2, fill: MUTE };
    out.push(T(M, 78, c.eyebrow, eb));
    if (o.serial) out.push(T(W0 - M, 78, o.serial, { size: 12.5, w: 500, ls: 0.06, fill: MUTE, anchor: 'end' }));
    out.push(line(M, 92, W0 - M, 92, RULE, 1));
    out.push(T(M - 2, 146, c.head, { fam: SERIF, w: 600, size: 46 }));

    var ist = { fam: SERIF, w: 400, size: 19.5 };
    y = 186;
    wrap(meas, c.intro, ist, CW).forEach(function (t) { out.push(T(M, y, t, ist)); y += 27; });
    var sst = { size: 14, fill: MUTE };
    if (c.station) { y += 1; wrap(meas, c.station, sst, CW).forEach(function (t) { out.push(T(M, y, t, sst)); y += 20; }); }

    // the giver's note, only when the order has one, right under the words that say what this is
    if (c.gift) {
      y += 10;
      var gst = { fam: SERIF, it: true, size: o.tight > 1 ? 18 : 20 }, gl = wrap(meas, c.gift, gst, CW - 40), gh = 44 + gl.length * (gst.size + 7);
      out.push('<g data-rp="gift"><rect x="' + M + '" y="' + n2(y) + '" width="' + CW + '" height="' + n2(gh) + '" fill="#F7F6F1" stroke="' + RULE + '" stroke-width="1"/>');
      out.push(T(M + 20, y + 26, c.giftHead, eb));
      gl.forEach(function (t, k) { out.push(T(M + 20, y + 54 + k * (gst.size + 7), t, gst)); });
      out.push('</g>');
      y += gh;
    }

    // the print itself, small, beside the key (smaller when the page is full, so it never runs long)
    y += 22;
    var miniW = o.miniW || 400, miniH = miniW * 2 / 3, miniTop = y;
    if (o.mini) {
      var inner = String(o.mini).replace(/^<svg\b/, '<svg x="' + M + '" y="' + n2(miniTop) + '" width="' + miniW + '" height="' + n2(miniH) + '"').replace(/<style>[\s\S]*?<\/style>/, '');
      out.push('<rect x="' + (M - 0.5) + '" y="' + n2(miniTop - 0.5) + '" width="' + (miniW + 1) + '" height="' + n2(miniH + 1) + '" fill="none" stroke="' + RULE + '" stroke-width="1"/>' + inner);
    }
    var kx = M + miniW + 26, kw = W0 - M - kx - 50, kst = { size: 13.5, fill: INK }, ky = miniTop + 10;
    out.push(T(kx, ky, 'HOW TO READ IT', eb));
    ky += 26;
    c.key.forEach(function (k) {
      out.push(swatch(k[0], kx, ky));
      var ls = wrap(meas, k[1], kst, kw);
      ls.forEach(function (t, i) { out.push(T(kx + 50, ky + i * 18, t, kst)); });
      ky += ls.length * 18 + 8;
    });
    y = Math.max(miniTop + miniH, ky - 8) + 40;

    // the year in numbers, three across
    out.push(line(M, y - 22, W0 - M, y - 22, RULE, 1));
    out.push(T(M, y, 'YOUR YEAR IN NUMBERS', eb));
    y += 28;
    var lab = { size: 12.5, w: 500, fill: MUTE }, big = { fam: SERIF, w: 500, size: 24 }, sub = { size: 13, fill: MUTE }, gap = 22, colW = (CW - 2 * gap) / 3;
    for (var i = 0; i < c.numbers.length; i += 3) {
      var rowH = 0;
      [0, 1, 2].forEach(function (j) {
        var r = c.numbers[i + j];
        if (!r) return;
        var x = M + j * (colW + gap), yy = y + 26, bs = Object.assign({}, big);
        out.push(T(x, y, r[0], lab));
        // a long value (the verdict) steps down a size, then wraps
        while (bs.size > 18 && meas(r[1], bs) > colW) bs.size -= 1;
        wrap(meas, r[1], bs, colW).forEach(function (t, q) { if (q) yy += bs.size + 4; out.push(T(x, yy, t, bs)); });
        yy += 2;
        if (r[2]) wrap(meas, r[2], sub, colW).forEach(function (t) { yy += 18; out.push(T(x, yy, t, sub)); });
        rowH = Math.max(rowH, yy - y);
      });
      y += rowH + 30;
    }
    var nst = { size: 13, fill: MUTE, it: true };
    if (c.snowNote) wrap(meas, c.snowNote, nst, CW).forEach(function (s2) { out.push(T(M, y, s2, nst)); y += 18; });
    if (c.marked.length) {
      out.push(T(M, y, c.marked.length === 1 ? 'Your day on the print' : 'Your days on the print', lab));
      y += 24;
      var mst = { fam: SERIF, w: 500, size: o.tight > 1 ? 16 : 18 };
      wrap(meas, c.marked.join('  \u00b7  '), mst, CW).forEach(function (t) { out.push(T(M, y, t, mst)); y += mst.size + 6; });
      y += 4;
    }

    var qs = 76, fb = H0 - M, half = CW / 2 - 16, bst = { size: 13.5, fill: INK }, mk = { fam: SERIF, size: 15 }, cx2 = M + CW / 2 + 16, y1, y2;
    y += 16;
    out.push(line(M, y - 22, W0 - M, y - 22, RULE, 1));
    y1 = y2 = y;
    out.push(T(M, y1, 'MADE BY HAND', eb)); y1 += 24;
    wrap(meas, c.maker, mk, half).forEach(function (t) { out.push(T(M, y1, t, mk)); y1 += 20; });
    y1 += 2;
    if (!o.tight) wrap(meas, c.makerSub, bst, half).forEach(function (t) { out.push(T(M, y1, t, Object.assign({}, bst, { fill: MUTE }))); y1 += 19; });
    if (o.tight < 3) {
      // made by and care, side by side; the foot under them
      out.push(T(cx2, y2, 'TAKING CARE OF IT', eb)); y2 += 24;
      (o.tight ? c.care.slice(0, 1) : c.care).forEach(function (p) { wrap(meas, p, bst, half).forEach(function (t) { out.push(T(cx2, y2, t, bst)); y2 += 19; }); y2 += 3; });
      y = Math.max(y1 - 19, y2 - 22);
      out.push(line(M, fb - qs - 14, W0 - M, fb - qs - 14, RULE, 1));
      out.push(T(M, fb - 38, c.footer, { fam: SERIF, w: 500, size: 21 }));
      out.push(T(M, fb - 14, c.footerSub, { size: 13.5, fill: MUTE }));
      out.push(qrMark(o.qr, W0 - M, fb, qs));
      render.overflow = y > fb - qs - 30 ? Math.round(y - (fb - qs - 30)) : 0;
    } else {
      // the fullest page: care goes under the maker line, and the foot (words and code) takes the right half of the same row
      wrap(meas, c.care[0], bst, half).forEach(function (t) { out.push(T(M, y1, t, bst)); y1 += 19; });
      var fw = half - qs - 16, fst = { fam: SERIF, w: 500, size: 19 };
      wrap(meas, c.footer, fst, fw).forEach(function (t) { out.push(T(cx2, y2, t, fst)); y2 += 24; });
      wrap(meas, c.footerSub, bst, fw).forEach(function (t) { out.push(T(cx2, y2, t, Object.assign({}, bst, { fill: MUTE }))); y2 += 19; });
      out.push(qrMark(o.qr, W0 - M, y - 14 + qs, qs));
      y = Math.max(y1 - 19, y2 - 19, y - 14 + qs);
      render.overflow = y > fb ? Math.round(y - fb) : 0;
    }
    out.push('</svg>');
    return out.join('');
  }

  root.AgRpInsert = { copy: copy, render: render, W: W0, H: H0, lastOverflow: function () { return render.overflow || 0; } };
})(typeof window !== 'undefined' ? window : this);
