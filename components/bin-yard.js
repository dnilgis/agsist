/* components/bin-yard.js: Bin Print, the "my bin yard" tool on /grain-bin-calculator (Nov 6, 2026).

   A top-down map of the reader's bins (round, hopper, flat storage) and markers (dryer, leg, driveway, unload
   point, entry), each bin with its capacity, bushels per foot of straight wall, bushels in it now and market
   bushels, a table and yard totals, short sourced tips, two printed one-page sheets (the full Bin Print and a
   big-type crew sheet for drivers) and a phone picture of each.

   ONE COPY OF THE MATH. Every bushel here comes from components/grain-bin.js (AgGrainBin: roundBin, hopperBin,
   bushels, marketBu, roomLeft, depthFromBelow, PLAIN, DEALER, RINGS_IN) and shrink from components/grain-shrink.js
   (AgShrink.totalShrink). This file only adds up what those return.
     capacity       roomLeft().full: filled to the eave and peaked at the basis angle (plain 25 deg, no pack;
                    dealer 28 deg, 6% pack). Flat storage: level to the top of the wall.
     bu per foot    bushels(roundBin({grainH: 1, surface: 'level'}).total, pack) = pi r^2 x 1 ft x 0.8036 (x 1.06
                    on the dealer basis). Flat: length x width x 1 ft x 0.8036.
     bu now         roomLeft().now at the grain height the reader gives (or depthFromBelow from a tape reading).
     market bu      marketBu(now, test weight, the crop's standard lb).

   Privacy (Nov 6): what the farmer types (yard name, bin names, notes, notes for drivers) stays in this
   browser (localStorage) and in links the farmer chooses to send: the share link carries it in the URL hash,
   which browsers never send to a server. No field asks for an address or a phone number. GA events carry
   counts only, never typed text. There is no dollar line: this page has no local bid for the reader.

   The picture's card, pen and QR code, the sheet shell, the print hook and sharing come from the share kit core
   (components/share-kit.js, loaded just before this file).
   Exports window.AgBinYard (and module.exports in node). The page half runs only with a document. */
(function (root) {
  'use strict';
  function GB() { return root.AgGrainBin || (typeof require === 'function' ? require('./grain-bin.js').AgGrainBin : null); }
  /* the share kit core (components/share-kit.js): dates, the picture's card, pen and QR code, the sheet shell,
     the print hook and sharing */
  function SK() { return root.AgShareKit || (typeof require === 'function' ? require('./share-kit.js') : null); }

  var YARD_W = 200, YARD_H = 140, GRID = 5, MAX_ITEMS = 40, NAME_MAX = 30, NOTE_MAX = 60, YARD_MAX = 40, CREW_MAX = 300;
  var URL_SHOWN = 'agsist.com/grain-bin-calculator', URL_BASE = 'https://agsist.com/grain-bin-calculator';
  /* standard lb and moisture, the same as the calculator's crop list */
  var CROPS = {
    corn: { lb: 56, std: 15.5, label: 'Corn', k: 'C' }, soybeans: { lb: 60, std: 13.0, label: 'Soybeans', k: 'S' },
    wheat: { lb: 60, std: 13.5, label: 'Wheat', k: 'W' }, barley: { lb: 48, std: 14.5, label: 'Barley', k: 'B' },
    oats: { lb: 32, std: 14.0, label: 'Oats', k: 'O' }, sorghum: { lb: 56, std: 14.0, label: 'Sorghum', k: 'G' }
  };
  var STATUS = { filling: ['F', 'Filling'], full: ['U', 'Full'], empty: ['E', 'Empty'], dnu: ['X', 'Do not use'] };
  var CROP_BY_K = {}, ST_BY_K = {}, TYPE_BY_K = {};
  Object.keys(CROPS).forEach(function (c) { CROP_BY_K[CROPS[c].k] = c; });
  Object.keys(STATUS).forEach(function (c) { ST_BY_K[STATUS[c][0]] = c; });
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var TYPES = { round: 'R', hopper: 'K', flat: 'F', dryer: 'D', leg: 'L', drive: 'W', unload: 'U', entry: 'E' };
  Object.keys(TYPES).forEach(function (t) { TYPE_BY_K[TYPES[t]] = t; });
  var MARKER = { dryer: 'Dryer', leg: 'Leg', drive: 'Driveway', unload: 'Unload', entry: 'Entry' };

  function isBin(it) { return !!it && (it.t === 'round' || it.t === 'hopper' || it.t === 'flat'); }
  function fin(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function fN(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function f1(n) { return String(Math.round(n * 10) / 10); }
  function fK(n) { return n >= 9950 ? f1(n / 1000) + 'k' : fN(n); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function dateLine(d) { d = d || new Date(); return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
  /* typed text: no control characters, no angle brackets, trimmed to a length */
  function clean(s, max, keepNl) {
    if (typeof s !== 'string') return '';
    s = s.replace(keepNl ? /[\u0000-\u0009\u000b-\u001f\u007f<>]/g : /[\u0000-\u001f\u007f<>]/g, keepNl ? '' : ' ');
    return s.slice(0, max);
  }

  /* ------------------------------------------------------------------ items */
  function defaults(t) {
    var base = { t: t, x: YARD_W / 2, y: YARD_H / 2, name: '' };
    if (t === 'round' || t === 'hopper') {
      base.d = t === 'round' ? 30 : 18; base.hMode = 'ft'; base.eave = t === 'round' ? 24 : 18; base.rings = 9; base.ringIn = 32;
      base.peak = 'plain'; base.hop = 45;
    } else if (t === 'flat') { base.L = 100; base.W = 40; base.H = 12; }
    else if (t === 'drive') { base.L = 120; base.W = 16; }
    if (isBin(base)) { base.crop = 'corn'; base.tw = 56; base.fm = 'none'; base.fv = null; base.sf = 'level'; base.note = ''; base.st = ''; }
    return base;
  }
  /* Untrusted in (a share link, an imported file, old storage): known fields only, each clamped; null if unusable. */
  function normalize(o) {
    if (!o || typeof o !== 'object' || !TYPES[o.t]) return null;
    var it = defaults(o.t), n = function (k, lo, hi, step) {
      var v = typeof o[k] === 'string' && o[k] !== '' ? +o[k] : o[k];
      if (fin(v)) it[k] = clamp(step ? Math.round(v / step) * step : v, lo, hi);
    };
    n('x', 0, YARD_W); n('y', 0, YARD_H);
    it.name = clean(o.name, NAME_MAX);
    if (o.t === 'round' || o.t === 'hopper') {
      n('d', 6, 160, 0.1); n('eave', 1, 80, 0.1); n('rings', 1, 40, 1); n('hop', 10, 79, 1);
      it.hMode = o.hMode === 'rings' ? 'rings' : 'ft';
      var G = GB(); it.ringIn = G.RINGS_IN.indexOf(+o.ringIn) >= 0 ? +o.ringIn : G.RINGS_IN[0];
      it.peak = o.peak === 'dealer' ? 'dealer' : 'plain';
    } else if (o.t === 'flat') { n('L', 4, YARD_W, 0.1); n('W', 4, YARD_W, 0.1); n('H', 1, 40, 0.1); }
    else if (o.t === 'drive') { n('L', 4, 400, 0.1); n('W', 4, 60, 0.1); }
    if (isBin(it)) {
      it.crop = CROPS[o.crop] ? o.crop : 'corn';
      it.tw = CROPS[it.crop].lb; n('tw', 20, 70, 0.1);
      it.fm = o.fm === 'height' || o.fm === 'below' ? o.fm : 'none';
      var fv = typeof o.fv === 'string' && o.fv !== '' ? +o.fv : o.fv;
      it.fv = fin(fv) ? clamp(Math.round(fv * 10) / 10, 0, 80) : null;
      it.sf = o.sf === 'peaked' || o.sf === 'draw' ? o.sf : 'level';
      it.note = clean(o.note, NOTE_MAX);
      it.st = STATUS[o.st] ? o.st : '';
    }
    return it;
  }
  function normYard(o) {
    o = o || {};
    var items = Array.isArray(o.items) ? o.items.map(normalize).filter(Boolean).slice(0, MAX_ITEMS) : [];
    return { name: clean(o.name, YARD_MAX), crew: clean(o.crew, CREW_MAX, true), crewBu: !!o.crewBu, items: items };
  }

  function heightFt(it) {
    if (it.t === 'flat') return it.H;
    return it.hMode === 'rings' ? it.rings * it.ringIn / 12 : it.eave;
  }

  /* Everything the page shows for one bin, from grain-bin.js. */
  function calc(it) {
    var G = GB(), maxH = heightFt(it), crop = CROPS[it.crop] || CROPS.corn;
    var gH = 0, filled = it.fm !== 'none' && fin(it.fv);
    if (filled) gH = it.fm === 'below' ? G.depthFromBelow(maxH, it.fv, it.t === 'hopper' ? G.coneHeight(it.d, it.hop) : 0) : Math.min(it.fv, maxH);   // a hopper tape past the cylinder lands in the cone (negative gH)
    if (gH === null) { gH = 0; filled = false; }
    var cap, now, perFt, pack = 0, basis = G.PLAIN;
    if (it.t === 'flat') {
      var area = it.L * it.W;
      cap = G.bushels(area * maxH, 0); perFt = G.bushels(area, 0); now = filled ? G.bushels(area * gH, 0) : 0;
    } else {
      basis = it.peak === 'dealer' ? G.DEALER : G.PLAIN; pack = basis.packPct;
      var rm = G.roomLeft({ shape: it.t === 'hopper' ? 'hopper' : 'round', d: it.d, maxH: maxH, grainH: gH,
        surface: it.sf || 'level', peakDeg: basis.peakDeg, hopperDeg: it.hop, packPct: pack });
      cap = rm.full; now = filled ? rm.now : 0;
      perFt = G.bushels(G.roundBin({ d: it.d, grainH: 1, surface: 'level' }).total, pack);
    }
    return { maxH: maxH, grainH: Math.max(0, gH), filled: filled, capacity: cap, perFt: perFt, now: now,
      open: Math.max(0, cap - now), market: G.marketBu(now, it.tw, crop.lb), lb: crop.lb,
      peakDeg: basis.peakDeg, pack: pack };
  }

  /* inches of grain to bushels on the straight wall: 1 in, 6 in, 1 ft, 5 ft */
  function quick(it) {
    var p = calc(it).perFt;
    return [{ s: '1 in', bu: p / 12 }, { s: '6 in', bu: p / 2 }, { s: '1 ft', bu: p }, { s: '5 ft', bu: p * 5 }];
  }

  function sizeText(it) {
    if (it.t === 'flat') return f1(it.L) + ' x ' + f1(it.W) + ' ft, ' + f1(it.H) + ' ft wall';
    var h = it.hMode === 'rings' ? it.rings + ' rings x ' + it.ringIn + ' in (' + GB().ftIn(heightFt(it)) + ')' : f1(it.eave) + ' ft eave';
    return f1(it.d) + ' ft, ' + h + (it.t === 'hopper' ? ', ' + it.hop + '° hopper' : '');
  }
  function statusText(it) { return it.st && STATUS[it.st] ? STATUS[it.st][1] : ''; }

  function labels(items) {
    var n = 0;
    return items.map(function (it) { return isBin(it) ? (it.name || 'Bin ' + (++n)) : (it.name || MARKER[it.t]); });
  }

  function totals(items) {
    var t = { capacity: 0, now: 0, open: 0, bins: 0, crops: {} };
    items.forEach(function (it) {
      if (!isBin(it)) return;
      var c = calc(it);
      t.bins++; t.capacity += c.capacity; t.now += c.now; t.open += c.open;
      if (c.now > 0) {
        var k = t.crops[it.crop] || (t.crops[it.crop] = { bu: 0, market: 0 });
        k.bu += c.now; k.market += c.market;
      }
    });
    return t;
  }
  function cropWords(t) {
    return Object.keys(CROPS).filter(function (c) { return t.crops[c]; }).map(function (c) {
      return CROPS[c].label.toLowerCase() + ' ' + fN(t.crops[c].bu) + ' bu (' + fN(t.crops[c].market) + ' market bu)';
    });
  }

  /* ------------------------------------------------------------- share link
     "1/" then an optional yard part "Y*name*notes for drivers*bu", then items joined by "/", fields by "*".
     Typed text is percent-encoded ("*" and "/" included), so it can never break the fields. The hash part of a
     URL is never sent to a server. */
  function num(v) { return f1(v); }
  function tx(s) { return encodeURIComponent(s || '').replace(/[*!'()~]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); }).replace(/%20/g, '+')
    .replace(/%(2C|3A|40|24|3B)/g, function (m) { return decodeURIComponent(m); }); }
  function untx(s) { try { return decodeURIComponent(String(s || '').replace(/\+/g, ' ')); } catch (e) { return ''; } }
  function encItem(it) {
    var k = TYPES[it.t], f = [k, num(it.x), num(it.y)];
    /* a field at its default is left empty (corn, the crop's own test weight, plain, level, no fill) */
    var fill = function () { return [it.crop === 'corn' ? '' : CROPS[it.crop].k, it.tw === CROPS[it.crop].lb ? '' : num(it.tw), it.fm === 'height' ? 'H' : it.fm === 'below' ? 'B' : '', it.fm !== 'none' && fin(it.fv) ? num(it.fv) : '']; };
    if (it.t === 'round' || it.t === 'hopper') {
      f.push(num(it.d), it.hMode === 'rings' ? it.rings + 'R' + it.ringIn : num(it.eave));
      if (it.t === 'hopper') f.push(num(it.hop));
      f.push(it.peak === 'dealer' ? 'D' : '');
      f = f.concat(fill()); f.push(it.sf === 'peaked' ? 'P' : it.sf === 'draw' ? 'D' : '');
    } else if (it.t === 'flat') { f.push(num(it.L), num(it.W), num(it.H)); f = f.concat(fill()); }
    else if (it.t === 'drive') f.push(num(it.L), num(it.W));
    f.push(tx(it.name));
    if (isBin(it)) f.push(tx(it.note), it.st ? STATUS[it.st][0] : '');
    while (f.length && f[f.length - 1] === '') f.pop();
    return f.join('*');
  }
  /* y: {name, crew, crewBu, items} or a bare items array */
  function encode(y) {
    if (Array.isArray(y)) y = { items: y };
    var parts = ['1'];
    if (y.name || y.crew || y.crewBu) parts.push(['Y', tx(y.name), tx(y.crew), y.crewBu ? '1' : ''].join('*').replace(/\*+$/, ''));
    return parts.concat((y.items || []).slice(0, MAX_ITEMS).map(encItem)).join('/');
  }
  /* -> {name, crew, crewBu, items} or null */
  function decode(s) {
    s = String(s || '').replace(/^#?yard=/, '');
    var parts = s.split('/');
    if (parts.shift() !== '1') return null;
    var out = { name: '', crew: '', crewBu: false, items: [] };
    parts.forEach(function (p) {
      var f = p.split('*'), t = TYPE_BY_K[f[0]];
      if (f[0] === 'Y') { out.name = clean(untx(f[1]), YARD_MAX); out.crew = clean(untx(f[2]), CREW_MAX, true); out.crewBu = f[3] === '1'; return; }
      if (!t || out.items.length >= MAX_ITEMS) return;
      var o = { t: t, x: f[1], y: f[2] }, i = 3;
      var fill = function () { o.crop = CROP_BY_K[f[i++]]; o.tw = f[i++]; var m = f[i++]; o.fm = m === 'H' ? 'height' : m === 'B' ? 'below' : 'none'; o.fv = f[i++]; };
      if (t === 'round' || t === 'hopper') {
        o.d = f[i++];
        var h = f[i++] || '', r = /^(\d+)R(\d+)$/.exec(h);
        if (r) { o.hMode = 'rings'; o.rings = r[1]; o.ringIn = r[2]; } else o.eave = h;
        if (t === 'hopper') o.hop = f[i++];
        o.peak = f[i++] === 'D' ? 'dealer' : 'plain';
        fill(); var sf = f[i++]; o.sf = sf === 'P' ? 'peaked' : sf === 'D' ? 'draw' : 'level';
      } else if (t === 'flat') { o.L = f[i++]; o.W = f[i++]; o.H = f[i++]; fill(); }
      else if (t === 'drive') { o.L = f[i++]; o.W = f[i++]; }
      o.name = untx(f[i++]);
      if (isBin(o)) { o.note = untx(f[i++]); o.st = ST_BY_K[f[i++]] || ''; }
      var it = normalize(o);
      if (it) out.items.push(it);
    });
    return out;
  }
  function shareUrl(y) { return URL_BASE + '#yard=' + encode(y); }

  /* The QR code on the sheets and pictures opens this exact yard: the share link itself. It must stay scannable
     at the printed size (1.6 in), so a link past version QR_MAX_VER (117 modules with the quiet zone) drops the
     typed notes, then the names (both are printed on the sheet beside it); past that the code goes to the tool
     and the sheet prints a yard code to type into "Open a yard link or code". -> {url, matrix, caption, level, code} */
  var QR_MAX_VER = 25, QR_CAP = 'Scan for this yard on your phone';
  function strip(y, names) {
    return { name: names ? '' : y.name, crew: '', crewBu: y.crewBu, items: y.items.map(function (it) {
      var o = JSON.parse(JSON.stringify(it)); o.note = ''; if (names) o.name = ''; return o; }) };
  }
  function qrPlan(y, Q) {
    Q = Q || root.AgQR; if (!Q) return null;
    var tries = [[y, QR_CAP, 'full'], [strip(y, false), QR_CAP + '. The notes are on this sheet.', 'nonotes'], [strip(y, true), QR_CAP + '. Names and notes are on this sheet.', 'nonames']];
    for (var i = 0; i < tries.length; i++) {
      var url = shareUrl(tries[i][0]), m = null;
      try { m = Q.matrix(url, null, 'mixed', 40); } catch (e) { m = null; }
      if (m && (m.length - 17) / 4 <= QR_MAX_VER) return { url: url, matrix: m, caption: tries[i][1], level: tries[i][2] };
    }
    return { url: URL_BASE, matrix: Q.matrix(URL_BASE, null, 'mixed', 40), caption: 'Scan for the tool, then open this yard code:', level: 'tool', code: encode(strip(y, true)) };
  }
  function qrSvg(m, label) {
    var n = m.length + 8, d = '';
    m.forEach(function (row, yy) { row.forEach(function (v, x) { if (v) d += 'M' + (x + 4) + ',' + (yy + 4) + 'h1v1h-1z'; }); });
    return '<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" role="img" aria-label="' + esc(label) + '" shape-rendering="crispEdges"><rect width="' + n + '" height="' + n + '" fill="#fff"/><path fill="#000" d="' + d + '"/></svg>';
  }
  function qrBlock(plan) {
    if (!plan) return '';
    return '<div class="byp-qr">' + qrSvg(plan.matrix, plan.caption) + '</div><p class="byp-open">' + esc(plan.caption) + '</p>'
      + (plan.code ? '<p class="byp-code">' + esc(plan.code) + '</p>' : '');
  }

  /* the yard a new reader sees: a sample, said so on the page */
  function sample() {
    var a = [
      { t: 'round', x: 35, y: 40, d: 30, hMode: 'ft', eave: 24, crop: 'corn', fm: 'height', fv: 16, st: 'filling' },
      { t: 'round', x: 85, y: 40, d: 36, hMode: 'rings', rings: 9, ringIn: 32, crop: 'corn', fm: 'below', fv: 6, sf: 'level', st: 'full' },
      { t: 'hopper', x: 130, y: 35, d: 18, eave: 18, hop: 45, crop: 'soybeans', tw: 60, st: 'empty' },
      { t: 'leg', x: 85, y: 75 }, { t: 'dryer', x: 40, y: 85 }, { t: 'unload', x: 110, y: 80 },
      { t: 'drive', x: 100, y: 120, L: 180, W: 16 }, { t: 'entry', x: 190, y: 120 }
    ];
    return a.map(normalize);
  }

  /* --------------------------------------------------------------- map (SVG)
     One painter for the screen and both sheets. o: {px: px per ft as drawn, fs: label px, sel: index, names,
     hit: true for the screen's 44 px targets and focus stops, crew: crew labels (name, crop and status), bu: show
     bushels (crew)}. */
  function extent(it) {
    if (it.t === 'round' || it.t === 'hopper') return { w: it.d, h: it.d };
    if (it.t === 'flat' || it.t === 'drive') return { w: it.L, h: it.W };
    if (it.t === 'dryer') return { w: 14, h: 10 };
    if (it.t === 'entry') return { w: 10, h: 10 };
    return { w: 8, h: 8 };
  }
  function bbox(items) {
    if (!items.length) return [0, 0, YARD_W, YARD_H];
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    items.forEach(function (it) { var e = extent(it); x0 = Math.min(x0, it.x - e.w / 2); x1 = Math.max(x1, it.x + e.w / 2); y0 = Math.min(y0, it.y - e.h / 2); y1 = Math.max(y1, it.y + e.h / 2); });
    var pad = 10; return [x0 - pad, y0 - pad, Math.max(40, x1 - x0 + 2 * pad), Math.max(30, y1 - y0 + 2 * pad)];
  }
  function itemLabels(it, c, name, o) {
    if (!c) return [[name, 'by-l3']];
    if (o.crew) {
      /* big type: the name always; crop and status, and bushels when ticked, only where they fit inside the bin
         (the table beside the map has them all) */
      var a = [[name, 'by-l1']], st = statusText(it), cr = c.now > 0 || it.st === 'filling' || it.st === 'full' ? CROPS[it.crop].label : '';
      var l2 = [cr, st].filter(Boolean).join(', '), wPx = (it.t === 'flat' ? it.L : it.d) * (o.px || 3) * 0.92, fsPx = o.fs || 12;
      var fits = function (t) { return t.length * fsPx * 0.56 <= wPx; };
      if (l2 && fits(l2)) a.push([l2, 'by-l2']);
      var bl = fK(c.now) + ' of ' + fK(c.capacity) + ' bu';
      if (o.bu && fits(bl)) a.push([bl, 'by-l3']);
      return a;
    }
    if (o.compact) return [[name, 'by-l1'], [fK(c.capacity) + ' bu', 'by-l2']];
    return [[name, 'by-l1'], [fK(c.capacity) + ' bu', 'by-l2'], [(c.now > 0 ? 'now ' + fK(c.now) + ', ' : '') + fN(c.perFt) + '/ft', 'by-l3']];
  }
  function svgItems(items, o) {
    var px = o.px || 3, fs = (o.fs || 12) / px, names = o.names || labels(items), s = '';
    items.forEach(function (it, i) {
      var c = isBin(it) ? calc(it) : null, sel = o.sel === i, e = extent(it);
      var g = '<g class="by-it by-' + it.t + (sel ? ' by-sel' : '') + (it.st ? ' by-st-' + it.st : '') + (it.st === 'dnu' ? ' by-dnu' : '') + '" data-i="' + i + '" transform="translate(' + f1(it.x) + ' ' + f1(it.y) + ')"';
      if (o.hit) g += ' tabindex="0" role="button" aria-label="' + esc(names[i] + (c ? ', ' + sizeText(it) + ', holds ' + fN(c.capacity) + ' bu, ' + fN(c.now) + ' bu in it now' : '')
        + '. Arrow keys move it, Enter edits, Delete removes.') + '"';
      g += '>';
      var hr = Math.max(e.w, e.h) / 2;
      if (o.hit) g += '<circle class="by-hit" r="' + f1(Math.max(hr, 22 / px)) + '"/>';
      if (it.t === 'round' || it.t === 'hopper') {
        var r = it.d / 2;
        g += '<circle class="by-shape" r="' + f1(r) + '"/>';
        if (it.t === 'hopper') g += '<circle class="by-cone" r="' + f1(r * 0.4) + '"/>';
        if (!o.crew && c.capacity > 0 && c.now > 0) {
          var fr = Math.min(1, c.now / c.capacity), a = fr * 2 * Math.PI, rr = r - 0.9;
          g += fr >= 0.999 ? '<circle class="by-fill" r="' + f1(rr) + '"/>'
            : '<path class="by-fill" d="M0 ' + f1(-rr) + 'A' + f1(rr) + ' ' + f1(rr) + ' 0 ' + (fr > 0.5 ? 1 : 0) + ' 1 ' + (rr * Math.sin(a)).toFixed(2) + ' ' + (-rr * Math.cos(a)).toFixed(2) + '"/>';
        }
      } else if (it.t === 'flat' || it.t === 'drive') {
        g += '<rect class="by-shape" x="' + f1(-it.L / 2) + '" y="' + f1(-it.W / 2) + '" width="' + f1(it.L) + '" height="' + f1(it.W) + '"/>';
      } else if (it.t === 'dryer') g += '<rect class="by-shape" x="-7" y="-5" width="14" height="10" rx="1"/>';
      else if (it.t === 'unload') g += '<path class="by-shape" d="M-4 -3.5H4L0 4Z"/>';
      else if (it.t === 'entry') g += '<path class="by-shape" d="M-5 -2H1V-5L5 0L1 5V2H-5Z"/>';
      else g += '<circle class="by-shape" r="4"/><path class="by-cone" d="M-4 0H4M0 -4V4"/>';
      var lab = itemLabels(it, c, names[i], o);
      /* small things (markers, a bin narrower than its label) carry the label under them */
      var under = !c || (!o.crew && it.t !== 'flat' && it.d * px * 0.95 < Math.max(3.2 * (o.fs || 12), names[i].length * (o.fs || 12) * 0.6));
      var y0 = under ? e.h / 2 + fs * 1.05 : -(lab.length - 1) * fs * 0.6 + fs * 0.35;
      lab.forEach(function (l, k) { g += '<text class="by-t ' + l[1] + '" y="' + f1(y0 + k * fs * 1.2) + '" font-size="' + (fs * (k === 0 && c ? 1.05 : 0.95)).toFixed(2) + '">' + esc(l[0]) + '</text>'; });
      s += g + '</g>';
    });
    return s;
  }
  function gridSvg(px) {
    var s = '<rect class="by-yard" x="0" y="0" width="' + YARD_W + '" height="' + YARD_H + '"/>', step = px < 2.2 ? 20 : 10;
    for (var x = step; x < YARD_W; x += step) s += '<path class="by-grid" d="M' + x + ' 0V' + YARD_H + '"/>';
    for (var y = step; y < YARD_H; y += step) s += '<path class="by-grid" d="M0 ' + y + 'H' + YARD_W + '"/>';
    return s;
  }
  /* a map for paper: the items' box drawn into widthIn x heightIn, labels at pt points whatever the scale */
  var A4_W_IN = 7.47;
  function paperMap(items, names, wIn, hIn, pt, o) {
    var box = bbox(items), px = Math.min(wIn * 96 / box[2], hIn * 96 / box[3]), lab = pt * 96 / 72;
    return '<svg class="byp-map" viewBox="' + box.map(f1).join(' ') + '" style="height:' + hIn + 'in" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Yard map" xmlns="http://www.w3.org/2000/svg" data-pxft="' + px.toFixed(3) + '">'
      + svgItems(items, { px: px, fs: lab, names: names, crew: o && o.crew, bu: o && o.bu }) + '</svg>';
  }

  /* ------------------------------------------------------------- the sheets */
  function sheetTitle(y, now) { return 'Bin Print: ' + (y.name || 'My bin yard') + ', ' + dateLine(now); }
  function sheetHtml(y, o) {
    o = o || {};
    var items = y.items, names = labels(items), t = totals(items), cw = cropWords(t), mapH = o.mapH || 3.4;
    var rows = items.map(function (it, i) { return isBin(it) ? i : -1; }).filter(function (i) { return i >= 0; });
    var tr = rows.map(function (i) {
      var it = items[i], c = calc(it), st = statusText(it);
      return '<tr><td><b>' + esc(names[i]) + '</b>' + (it.note || st ? '<span class="byp-note">' + esc([st, it.note].filter(Boolean).join('. ')) + '</span>' : '') + '</td><td>' + esc(sizeText(it)) + '</td><td>' + fN(c.capacity) + '</td><td>' + fN(c.perFt) + '</td><td>'
        + (c.now > 0 ? fN(c.now) + ' ' + esc(CROPS[it.crop].label.toLowerCase()) : '0') + '</td><td>' + (c.now > 0 ? fN(c.market) : '0') + '</td></tr>';
    }).join('');
    var ql = rows.map(function (i) { return '<li><b>' + esc(names[i]) + ':</b> ' + quick(items[i]).slice(0, 3).map(function (q) { return q.s + ' ' + fN(q.bu); }).join(' \u00b7 ') + ' bu</li>'; }).join('');
    return '<header class="byp-top"><div><h1 class="byp-h1">' + esc(sheetTitle(y, o.now)) + '</h1>'
      + '<p class="byp-sum">' + fN(t.capacity) + ' bu of storage in ' + t.bins + ' bin' + (t.bins === 1 ? '' : 's') + ', ' + fN(t.now) + ' bu in now, ' + fN(t.open) + ' bu open.</p></div>'
      + '<div class="byp-brand"><img class="byp-logo" src="/img/logo-agsist-onlight.svg" alt="AGSIST" width="86" height="40"><p class="byp-url">agsist.com</p></div></header>'
      + paperMap(items, names, A4_W_IN, mapH, 9.5)
      + '<table class="byp-tab"><thead><tr><th>Bin</th><th>Size</th><th>Holds, bu</th><th>Bu per ft</th><th>In now, bu</th><th>Market bu</th></tr></thead><tbody>' + tr
      + '<tr class="byp-tot"><td><b>Yard</b></td><td></td><td>' + fN(t.capacity) + '</td><td></td><td>' + fN(t.now) + '</td><td></td></tr></tbody></table>'
      + (cw.length ? '<p class="byp-crops"><b>In storage:</b> ' + esc(cw.join('; ')) + '.</p>' : '')
      + '<div class="byp-low"><div><h2 class="byp-h2">Inches to bushels (straight wall)</h2><ul class="byp-q">' + ql + '</ul>'
      + '<p class="byp-src">Estimates from the sizes typed in, not a scale ticket. 1 bu = 1.2445 cu ft. Holds = filled to the eave and peaked: plain 25° with no pack, dealer 28° with 6% pack (the GSI chart basis); flat storage level full. Market bushels at each bin’s test weight. Free at agsist.com/grain-bin-calculator</p></div>'
      + '<aside class="byp-side">' + qrBlock(o.plan) + '<p class="byp-date">Printed ' + esc(dateLine(o.now)) + '</p></aside></div>';
  }
  /* The crew sheet: for drivers and help. Big-type labels (20 pt names, 18 pt crop and status), unload points and
     the entry on the map, each bin's crop, status and note, the notes for drivers, the date. Bushels only when the
     farmer ticks them. */
  var CREW_PT = 20;
  function crewHtml(y, o) {
    o = o || {};
    var items = y.items, names = labels(items), mapH = o.mapH || 5.2;
    var rows = items.map(function (it, i) { return isBin(it) ? i : -1; }).filter(function (i) { return i >= 0; });
    var tr = rows.map(function (i) {
      var it = items[i], c = calc(it);
      return '<tr' + (it.st === 'dnu' ? ' class="byc-dnu"' : '') + '><td><b>' + esc(names[i]) + '</b></td><td>' + esc(c.now > 0 || it.st === 'filling' || it.st === 'full' ? CROPS[it.crop].label : '') + '</td><td><b>' + esc(statusText(it)) + '</b></td><td>' + esc(it.note) + '</td>'
        + (y.crewBu ? '<td>' + fN(c.now) + ' of ' + fN(c.capacity) + '</td>' : '') + '</tr>';
    }).join('');
    var notes = y.crew ? esc(y.crew).replace(/\n/g, '<br>') : '';
    return '<header class="byp-top"><div><h1 class="byp-h1 byc-h1">Crew sheet: ' + esc(y.name || 'My bin yard') + '</h1><p class="byp-sum byc-date">' + esc(dateLine(o.now)) + '</p></div>'
      + '<div class="byp-brand"><img class="byp-logo" src="/img/logo-agsist-onlight.svg" alt="AGSIST" width="86" height="40"><p class="byp-url">agsist.com</p></div></header>'
      + paperMap(items, names, A4_W_IN, mapH, CREW_PT, { crew: true, bu: y.crewBu })
      + '<p class="byc-key"><i class="byc-k byc-kfull"></i>Full <i class="byc-k byc-kfill"></i>Filling <i class="byc-k"></i>Empty or not set <i class="byc-k byc-kdnu"></i>Do not use</p>'
      + '<table class="byp-tab byc-tab"><thead><tr><th>Bin</th><th>Crop</th><th>Status</th><th>Note</th>' + (y.crewBu ? '<th>Bu in / holds</th>' : '') + '</tr></thead><tbody>' + tr + '</tbody></table>'
      + '<div class="byp-low byc-low"><div class="byc-notes"><h2 class="byp-h2">Notes for drivers</h2><p class="byc-nt' + (notes ? '' : ' byc-blank') + '">' + notes + '</p></div>'
      + '<aside class="byp-side">' + qrBlock(o.plan) + '<p class="byp-date"><span class="byp-big">' + URL_SHOWN + '</span></p></aside></div>';
  }

  /* ----------------------------------------------------------- the pictures
     1080 x 1350, the dark card. Every word 26 px or more except one 20 px source line. o.crew: the crew picture
     (names, crop, status, notes for drivers). -> {canvas, texts, sizes} */
  function image(y, doc, o) {
    o = o || {};
    var K = SK(), FONT = K.FONT, items = y.items, W = 1080, H = 1350, P = 60, c = K.canvas(doc, W, H);
    var ctx = c.getContext('2d'), p = K.pen(ctx, { paras: true }), t = totals(items), names = labels(items);
    var wrap = p.wrap, text = p.text;
    function lines(s, yy, size, weight, ink, lh, max) { return p.lines(s, P, yy, size, weight, ink, lh, max || 9, W - 2 * P); }
    var INK = K.INK, DIM = K.DIM, GOLD = K.GOLD;
    K.frame(ctx, W, H, 12);
    K.head(p, P, URL_SHOWN, (o.crew ? 'Crew sheet, ' : 'Bin Print, ') + dateLine(o.now));
    var yy = lines(y.name || 'My bin yard', 214, 60, 800, INK, 70, 2) + 2;
    var rows = items.map(function (it, i) { return isBin(it) ? i : -1; }).filter(function (i) { return i >= 0; });
    var list = [];
    if (o.crew) {
      rows.forEach(function (i) { var it = items[i], st = statusText(it), cr = calc(it).now > 0 || it.st === 'filling' || it.st === 'full' ? CROPS[it.crop].label.toLowerCase() : ''; list.push(names[i] + ': ' + ([cr, st.toLowerCase()].filter(Boolean).join(', ') || 'no status') + (it.note ? '. ' + it.note : '')); });
    } else {
      if (t.bins) yy = lines('Holds ' + fN(t.capacity) + ' bu. ' + fN(t.now) + ' bu in now, ' + fN(t.open) + ' bu of room.', yy, 32, 500, INK, 42, 2);
      var cw = Object.keys(CROPS).filter(function (k) { return t.crops[k]; }).map(function (k) { return CROPS[k].label + ' ' + fN(t.crops[k].bu) + ' bu'; });
      if (cw.length) yy = lines(cw.join(', ') + '.', yy, 28, 600, DIM, 38, 2);
      rows.forEach(function (i) { var it = items[i], cc = calc(it); list.push(names[i] + ': ' + sizeText(it).replace(/ \(.*\)/, '') + ', ' + fN(cc.capacity) + ' bu' + (cc.now > 0 ? ', ' + fN(cc.now) + ' in' : '')); });
    }
    var maxList = o.crew ? 5 : 6, crewL = [];
    if (o.crew && y.crew) { ctx.font = '600 28px ' + FONT; crewL = wrap('Notes for drivers: ' + y.crew, W - 2 * P).slice(0, 4); }
    var listH = Math.min(list.length, maxList) * 40 + (list.length > maxList ? 40 : 0) + crewL.length * 38 + (crewL.length ? 12 : 0);
    /* the footer: the yard's own QR code at the right, its caption and the source line beside it */
    var plan = o.plan === undefined ? qrPlan(y) : o.plan, qn = plan ? plan.matrix.length + 8 : 0, mod = plan ? Math.max(2, Math.floor(250 / qn)) : 0;
    var qs = qn * mod, FT = H - 40 - (plan ? qs : 60), LW = W - 2 * P - (plan ? qs + 30 : 0);
    var foot = FT - 24;
    var mapTop = yy + 14, mapH = Math.max(200, foot - listH - 30 - mapTop);
    var b = bbox(items), k = Math.min((W - 2 * P) / b[2], mapH / b[3]), ox = P + ((W - 2 * P) - b[2] * k) / 2 - b[0] * k, oy = mapTop + (mapH - b[3] * k) / 2 - b[1] * k;
    ctx.lineWidth = 3;
    items.forEach(function (it, i) {
      var X = ox + it.x * k, Y = oy + it.y * k, e = extent(it), bin = isBin(it);
      ctx.strokeStyle = bin ? GOLD : 'rgba(233,237,235,.6)'; ctx.fillStyle = bin ? '#1c2224' : 'rgba(233,237,235,.10)';
      ctx.beginPath();
      if (it.t === 'round' || it.t === 'hopper' || it.t === 'leg') ctx.arc(X, Y, Math.max(e.w / 2 * k, 6), 0, Math.PI * 2);
      else ctx.rect(X - Math.max(e.w / 2 * k, 6), Y - Math.max(e.h / 2 * k, 6), Math.max(e.w * k, 12), Math.max(e.h * k, 12));
      ctx.fill(); ctx.stroke();
      if (bin && !o.crew) {
        var cc = calc(it);
        if (it.t !== 'flat' && cc.now > 0 && cc.capacity > 0) {
          ctx.beginPath(); ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(212,162,63,.75)';
          ctx.arc(X, Y, Math.max(4, e.w / 2 * k - 7), -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * Math.min(1, cc.now / cc.capacity)); ctx.stroke(); ctx.lineWidth = 3;
        }
      }
      var lab = bin ? names[i] : (o.crew && (it.t === 'unload' || it.t === 'entry' || it.t === 'drive') ? names[i] : '');
      if (lab) {
        ctx.font = '800 26px ' + FONT; ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0a0c0d'; ctx.textAlign = 'center';
        var ly = bin ? Y + 10 : Y + Math.max(e.h / 2 * k, 6) + 30; ctx.strokeText(lab, X, ly); ctx.lineWidth = 3;
        text(lab, X, ly, 26, 800, bin ? INK : GOLD, 'center');
      }
    });
    yy = mapTop + mapH + 30 + 26;
    list.slice(0, maxList).forEach(function (s) { ctx.font = '500 26px ' + FONT; text(wrap(s, W - 2 * P)[0], P, yy, 26, 500, INK); yy += 40; });
    if (list.length > maxList) { text('and ' + (list.length - maxList) + ' more', P, yy, 26, 500, DIM); yy += 40; }
    if (crewL.length) { yy += 12; crewL.forEach(function (l) { text(l, P, yy, 28, 600, GOLD); yy += 38; }); }
    if (plan) {
      K.qr(ctx, plan.matrix, W - P - qs, H - 40 - qs, mod);
      ctx.font = '700 28px ' + FONT;
      var cl = wrap(plan.level === 'tool' ? 'Scan for the tool on your phone' : plan.caption, LW).slice(0, 4);
      cl.forEach(function (l, i) { text(l, P, FT + 34 + i * 36, 28, 700, GOLD); });
    }
    if (!o.crew) {
      var src = 'Estimates from bin sizes, not a scale ticket. 1 bu = 1.2445 cu ft; plain 25° peak, no pack; dealer 28° peak, 6% pack.';
      ctx.font = '400 20px ' + FONT;
      wrap(src, LW).slice(0, 4).forEach(function (l, i, a) { text(l, P, H - 40 - (a.length - 1 - i) * 26, 20, 400, DIM); });
    } else if (!plan) text('Open the map: ' + URL_SHOWN, P, H - 40, 28, 700, GOLD);
    return { canvas: c, texts: p.texts, sizes: p.sizes, plan: plan };
  }

  var api = { YARD_W: YARD_W, YARD_H: YARD_H, GRID: GRID, CROPS: CROPS, STATUS: STATUS, CREW_PT: CREW_PT, defaults: defaults,
    normalize: normalize, normYard: normYard, calc: calc, quick: quick, totals: totals, encode: encode, decode: decode,
    shareUrl: shareUrl, sample: sample, labels: labels, sizeText: sizeText, heightFt: heightFt, sheetHtml: sheetHtml,
    crewHtml: crewHtml, qrPlan: qrPlan, QR_MAX_VER: QR_MAX_VER, QR_CAP: QR_CAP, sheetTitle: sheetTitle, image: image, dateLine: dateLine, bbox: bbox, svgItems: svgItems };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgBinYard = api;

  /* ================================================================ the page */
  /* K: the share kit core. Without it (blocked or not loaded) the yard planner works as ever; only Bin Print's
     print, picture and link buttons are marked unavailable. */
  var doc = root.document, rootEl = doc && doc.getElementById('by-root'), K = root.AgShareKit || null;
  if (!rootEl) return;
  /* Three ways in. 'mine': the reader's own yard (LS). 'view': a yard someone sent (#yard=...), shown read-only
     as the crew view, so a driver cannot change anything by accident. 'copy': "Edit a copy" of a sent yard, saved
     under its own key (LS_COPY) so the reader's own yard is never touched by anyone else's link. */
  var LS = 'agsist_binprint_v1', LS_COPY = 'agsist_binprint_copy_v1';
  var S = { name: '', crew: '', crewBu: false, items: [] }, sel = -1, undo = [], isSample = false, mode = 'mine', shared = null, mine = null;
  var view = { x: 0, y: 0, w: YARD_W, h: YARD_H };

  /* GA gets event names and counts only: never a name, a note or anything else typed */
  function ga(ev, p) { if (K) K.ga(ev, p || {}); else try { if (typeof root.gtag === 'function') root.gtag('event', ev, p || {}); } catch (e) {} }
  function bins() { return { bins: totals(S.items).bins }; }
  function save() {
    if (mode === 'view') return;
    var o = { v: 1, name: S.name, crew: S.crew, crewBu: S.crewBu, items: S.items, sample: isSample };
    if (mode === 'copy') o.active = true;
    try { root.localStorage.setItem(mode === 'copy' ? LS_COPY : LS, JSON.stringify(o)); } catch (e) {}
  }
  function adopt(y) { S.name = y.name; S.crew = y.crew; S.crewBu = y.crewBu; S.items = y.items; }
  function readLS(k) { try { var s = JSON.parse(root.localStorage.getItem(k) || 'null'); return s && Array.isArray(s.items) ? s : null; } catch (e) { return null; } }
  function loadMine() {
    var s = readLS(LS);
    if (s) { adopt(normYard(s)); isSample = !!s.sample; return true; }
    adopt({ name: '', crew: '', crewBu: false, items: sample() }); isSample = true; return false;
  }
  function load() {
    var h = root.location.hash || '';
    if (/^#yard=/.test(h)) {
      var y = decode(h);
      if (y && y.items.length) { shared = normYard(y); mine = !!readLS(LS); loadMine(); mode = 'view'; return 'link'; }
    }
    var c = readLS(LS_COPY);
    if (c && c.active) { adopt(normYard(c)); mode = 'copy'; mine = !!readLS(LS); return 'copy'; }
    return loadMine() ? 'saved' : 'sample';
  }
  function dropHash() { try { if (/^#yard=/.test(root.location.hash)) root.history.replaceState(null, '', root.location.pathname + root.location.search); } catch (e) {} }
  function cur() { return mode === 'view' ? shared : S; }
  function snap() { undo.push(JSON.stringify(S.items)); if (undo.length > 60) undo.shift(); }
  function doUndo() {
    if (!undo.length) { note('Nothing to undo'); return; }
    S.items = JSON.parse(undo.pop()); if (sel >= S.items.length) sel = -1;
    closeEditor(); render(); save(); note('Undone');
  }
  function changed() { isSample = false; save(); }

  /* markup, built once: this script runs before anything below the section is parsed, so nothing moves */
  rootEl.innerHTML =
    '<p class="by-status" id="by-status" role="status" aria-live="polite"></p>'
    + '<div id="by-view" class="by-view" hidden></div><div id="by-bar" class="by-bar" hidden></div>'
    + '<label class="by-yn" for="by-name"><span>Yard or farm name, for your sheets</span><input id="by-name" class="by-in" type="text" maxlength="' + YARD_MAX + '" placeholder="Home place" autocomplete="off"></label>'
    + '<div class="by-main"><div class="by-left">'
    + '<div class="by-tools" role="toolbar" aria-label="Add to the yard">'
    + '<button type="button" class="by-btn" data-add="round">+ Round bin</button>'
    + '<button type="button" class="by-btn" data-add="hopper">+ Hopper bin</button>'
    + '<button type="button" class="by-btn" data-add="flat">+ Flat storage</button>'
    + '<label class="by-sr" for="by-mark">Add a marker</label><select id="by-mark" class="by-btn by-pick"><option value="">+ Marker</option><option value="dryer">Dryer</option><option value="leg">Leg</option><option value="unload">Unload point</option><option value="drive">Driveway</option><option value="entry">Entry</option></select>'
    + '</div>'
    + '<div class="by-mapwrap"><svg id="by-map" class="by-map" viewBox="0 0 ' + YARD_W + ' ' + YARD_H + '" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="Bin yard map, top-down, ' + YARD_W + ' by ' + YARD_H + ' ft. Tab to a bin; arrow keys move it, Enter edits, Delete removes, Ctrl+Z undoes."></svg>'
    + '<div class="by-zoom"><button type="button" class="by-zb" data-z="in" aria-label="Zoom in">+</button><button type="button" class="by-zb" data-z="out" aria-label="Zoom out">−</button><button type="button" class="by-zb by-zfit" data-z="fit" aria-label="Show the whole yard">Fit</button></div></div>'
    + '<p class="by-hint">Drag a bin to move it (5 ft grid). Tap it to name it and set its size, crop, fill and status. Keys: arrows move, Enter edits, Delete removes, Ctrl+Z undoes.</p>'
    + '<div class="by-row"><button type="button" class="by-btn" id="by-undo">Undo</button><button type="button" class="by-btn" id="by-clear">Clear yard</button></div>'
    + '<div id="by-ed" class="by-ed" hidden></div>'
    + '</div><div class="by-right">'
    + '<div class="by-tabwrap"><table class="by-tab"><caption class="by-sr">Your bins</caption><thead><tr><th scope="col">Bin</th><th scope="col">Holds</th><th scope="col">Bu per ft</th><th scope="col">In now</th><th scope="col">Market bu</th></tr></thead><tbody id="by-tbody"></tbody></table></div>'
    + '<div class="by-tot" id="by-tot"></div>'
    + '<div id="by-askslot"></div>'
    + '</div></div>'
    + '<div class="by-tips" id="by-tips"></div>'
    + '<div class="by-kit"><h3 class="by-h3">Print it, share it</h3><div class="by-row">'
    + '<button type="button" class="by-btn by-pri" id="by-print">Print my Bin Print</button>'
    + '<button type="button" class="by-btn by-pri" id="by-pic">Save Bin Print picture</button>'
    + '<button type="button" class="by-btn" id="by-link">Copy Bin Print link</button>'
    + '<button type="button" class="by-btn" id="by-export">Export JSON</button>'
    + '<button type="button" class="by-btn" id="by-import">Import JSON</button><input type="file" id="by-file" accept="application/json,.json" hidden>'
    + '</div>'
    + '<h3 class="by-h3">For your crew</h3>'
    + '<label class="by-f by-wide" for="by-crew"><span>Notes for drivers</span><textarea id="by-crew" class="by-in by-ta" maxlength="' + CREW_MAX + '" rows="3" placeholder="Dump at the north auger. Scale at the shop."></textarea></label>'
    + '<label class="by-chk"><input type="checkbox" id="by-crewbu"> Show bushels on the crew sheet</label>'
    + '<div class="by-row"><button type="button" class="by-btn by-pri" id="by-crewprint">Print crew sheet</button><button type="button" class="by-btn by-pri" id="by-send">Send to crew</button></div>'
    + '<form class="by-row by-open" id="by-openf"><label class="by-f" for="by-code"><span>Open a yard link or code</span><input id="by-code" class="by-in" type="text" autocomplete="off" spellcheck="false" placeholder="Paste a Bin Print link or yard code"></label><button type="submit" class="by-btn">Open</button></form>'
    + '<p class="by-fine"><b>Names and notes travel inside the link to whoever gets it.</b> Everything you type stays in this browser and in links you choose to send; nothing is sent to us. No field here wants an address or a phone number.</p></div>';

  var $ = function (id) { return doc.getElementById(id); };
  var mapEl = $('by-map'), ask = doc.querySelector('#bin-print .gb-ask');
  if (ask) $('by-askslot').appendChild(ask);
  var noteT = 0;
  function note(s) { var n = $('by-status'); n.textContent = s; clearTimeout(noteT); noteT = setTimeout(function () { n.textContent = ''; }, 5000); }

  function pxPerFt() { var w = mapEl.getBoundingClientRect().width || 600; return w / view.w; }
  function drawMap() {
    var px = pxPerFt();
    mapEl.setAttribute('viewBox', [view.x, view.y, view.w, view.h].map(f1).join(' '));
    mapEl.innerHTML = gridSvg(px) + svgItems(S.items, { px: px, fs: px > 2.6 ? 12 : 11, sel: sel, hit: true, compact: px < 2.6 });
    mapEl.classList.toggle('by-zoomed', view.w < YARD_W - 0.5);
  }
  function drawTable() {
    var names = labels(S.items), h = '';
    S.items.forEach(function (it, i) {
      if (!isBin(it)) return;
      var c = calc(it), st = statusText(it);
      h += '<tr data-i="' + i + '"' + (i === sel ? ' class="by-rsel"' : '') + '><th scope="row"><button type="button" class="by-rb" data-i="' + i + '">' + esc(names[i]) + '</button><span class="by-sz">' + esc(sizeText(it)) + (st ? '. ' + esc(st) : '') + '</span></th>'
        + '<td>' + fN(c.capacity) + '</td><td>' + fN(c.perFt) + '</td><td>' + (c.now > 0 ? fN(c.now) + '<span class="by-sz">' + esc(CROPS[it.crop].label.toLowerCase()) + '</span>' : '0') + '</td><td>' + (c.now > 0 ? fN(c.market) : '0') + '</td></tr>';
    });
    $('by-tbody').innerHTML = h || '<tr><td colspan="5" class="by-empty">No bins yet. Add one above.</td></tr>';
    var t = totals(S.items), cw = cropWords(t);
    $('by-tot').innerHTML = '<div class="by-tg"><div><span class="by-k">Yard holds</span><b>' + fN(t.capacity) + ' bu</b></div>'
      + '<div><span class="by-k">In storage</span><b>' + fN(t.now) + ' bu</b></div><div><span class="by-k">Open space</span><b>' + fN(t.open) + ' bu</b></div></div>'
      + (cw.length ? '<p class="by-cw">' + esc(cw.join('; ')) + '.</p>' : '')
      + (isSample ? '<p class="by-cw by-samp">This is a sample yard. Tap a bin to make it yours, or Clear yard to start over.</p>' : '');
  }
  function curBin() { if (sel >= 0 && isBin(S.items[sel])) return sel; for (var i = 0; i < S.items.length; i++) if (isBin(S.items[i])) return i; return -1; }
  var moist = '';
  function shrinkLine(it, c, name) {
    var A = root.AgShrink, crop = CROPS[it.crop], mi = parseFloat(moist);
    var base = c.now > 0 ? c.now : c.capacity, baseW = c.now > 0 ? 'the ' + fN(c.now) + ' bu in ' + name : name + ' full (' + fN(c.capacity) + ' bu)';
    if (!isFinite(mi) || !A) return 'Type a moisture to see the shrink on ' + baseW + '.';
    var fac = A.CROPS ? (A.CROPS[it.crop] || A.CROPS.wheat).factor : 1.3;
    var pct = mi > crop.std ? A.totalShrink(mi, crop.std, { method: 'factor', factor: fac }) : 0;
    return pct > 0 ? 'Drying ' + baseW + ' from ' + mi + '% to ' + crop.std + '% at ' + fac + '% a point shrinks it ' + pct.toFixed(1) + '%, about ' + fN(base * pct / 100) + ' bu.'
      : 'At ' + mi + '% the ' + crop.label.toLowerCase() + ' is at or under ' + crop.std + '%: no drying shrink.';
  }
  /* aeration: fan hours for one cooling cycle ~= 15 / (cfm per bu) (UMN); at least 0.1 cfm per bu (ISU) */
  var fan = '';
  function airLine(c) {
    var bu = c.now > 0 ? c.now : c.capacity, what = c.now > 0 ? 'the ' + fN(bu) + ' bu in it' : fN(bu) + ' bu full', f = parseFloat(fan);
    if (isFinite(f) && f > 0 && bu > 0) {
      var r = f / bu;
      return 'Your ' + fN(f) + ' cfm fan on ' + what + ' is ' + (Math.round(r * 100) / 100) + ' cfm per bu: about ' + fN(15 / r) + ' fan hours for a cooling cycle (approximate).'
        + (r < 0.1 ? ' That is under 0.1 cfm per bu.' : '');
    }
    return 'At 0.1 cfm per bu, ' + what + ' want about ' + fN(bu * 0.1) + ' cfm and about 150 fan hours for a cooling cycle (approximate). Type your fan to figure yours.';
  }
  function drawTips() {
    var i = curBin(), el = $('by-tips');
    if (i < 0) { el.innerHTML = ''; return; }
    var it = S.items[i], c = calc(it), name = labels(S.items)[i];
    var core = it.t === 'flat' ? '' : '<li><b>Coring.</b> Fines collect in the center; pull grain from the center soon after filling, to about half the peak height. About ' + fN(Math.pow(it.d, 3) / 90) + ' bu for this ' + f1(it.d) + ' ft bin (diameter cubed &divide; 90; approximate). <a href="https://crops.extension.iastate.edu/encyclopedia/core-each-grain-bin-fall" rel="noopener">Iowa State Extension</a></li>';
    el.innerHTML = '<h3 class="by-h3">Facts for ' + esc(name) + '</h3><ul class="by-tl">'
      + '<li><b>Aeration.</b> At least 0.1 cfm per bushel for corn and soybeans (<a href="https://crops.extension.iastate.edu/post/2021-stored-grain-management" rel="noopener">Iowa State</a>). Cooling hours are about 15 &divide; cfm per bu (<a href="https://extension.umn.edu/agriculture/crop-production/small-grains/storing-wheat-and-barley" rel="noopener">U of Minnesota</a>); double the air, half the time (<a href="https://extension.okstate.edu/fact-sheets/aeration-and-cooling-of-stored-grain" rel="noopener">Oklahoma State</a>). '
      + '<label for="by-fan">Your fan (cfm)</label> <input id="by-fan" class="by-in by-in-s" type="number" inputmode="numeric" min="0" step="100" placeholder="e.g. 3000" value="' + esc(fan) + '"> <span id="by-air">' + esc(airLine(c)) + '</span></li>'
      + core
      + '<li><b>Shrink.</b> <label for="by-moist">Moisture in (%)</label> <input id="by-moist" class="by-in by-in-s" type="number" inputmode="decimal" step="0.1" min="0" max="40" placeholder="e.g. 18" value="' + esc(moist) + '"> <span id="by-shr">' + esc(shrinkLine(it, c, name)) + '</span> Same arithmetic as <a href="/grain-shrink">grain shrink</a> (<a href="https://www.extension.purdue.edu/extmedia/NCH/NCH-61.html" rel="noopener">Purdue NCH-61</a>).</li>'
      + '<li><b>Bin entry.</b> Lock out and tag out the unload; wear a body harness on a lifeline; keep an observer outside with rescue gear; test the air; never walk grain down or go in under bridged grain. NIOSH: &ldquo;Assume that all stored materials are bridged and unstable.&rdquo; '
      + '<a href="https://archive.cdc.gov/www_cdc_gov/niosh/updates/93-116.html" rel="noopener">NIOSH</a>, <a href="https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.272" rel="noopener">OSHA 1910.272</a> (written for grain-handling facilities, not automatically every farm bin).</li></ul>';
  }
  function render() { if (mode === 'view') { drawView(); return; } drawBar(); drawMap(); drawTable(); drawTips(); }

  /* the crew view: read-only, big labels, statuses, notes for drivers, and "Edit a copy" */
  function drawView() {
    var y = shared, el = $('by-view'), names = labels(y.items), box = bbox(y.items);
    rootEl.classList.add('by-viewing'); el.hidden = false; $('by-bar').hidden = true;
    var w = Math.max(280, rootEl.getBoundingClientRect().width || 600), px = w / box[2];
    var li = y.items.map(function (it, i) {
      if (!isBin(it)) return '';
      var c = calc(it), cr = c.now > 0 || it.st === 'filling' || it.st === 'full' ? CROPS[it.crop].label : '', st = statusText(it);
      return '<li' + (it.st === 'dnu' ? ' class="by-vdnu"' : '') + '><b>' + esc(names[i]) + '</b> <span>' + esc([cr, st].filter(Boolean).join(', ') || 'No status') + '</span>'
        + (y.crewBu ? ' <span class="by-sz">' + fN(c.now) + ' of ' + fN(c.capacity) + ' bu</span>' : '') + (it.note ? '<span class="by-vn">' + esc(it.note) + '</span>' : '') + '</li>';
    }).join('');
    el.innerHTML = '<p class="by-vk">Crew view. Someone shared this yard with you; it is read-only, so nothing you do here changes it.</p>'
      + '<h3 class="by-vh">' + esc(y.name || 'Shared bin yard') + '</h3>'
      + '<svg class="by-vmap" viewBox="' + box.map(f1).join(' ') + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Map of the shared bin yard">' + svgItems(y.items, { px: px, fs: px > 3 ? 18 : 16, crew: true, bu: y.crewBu, names: names }) + '</svg>'
      + '<ul class="by-vl">' + li + '</ul>'
      + (y.crew ? '<div class="by-vnotes"><h4>Notes for drivers</h4><p>' + esc(y.crew).replace(/\n/g, '<br>') + '</p></div>' : '')
      + '<div class="by-row"><button type="button" class="by-btn by-pri" id="by-copy">Edit a copy</button><button type="button" class="by-btn" id="by-vprint">Print crew sheet</button>'
      + '<button type="button" class="by-btn" id="by-mine">' + (mine ? 'Go to my own yard' : 'Map my own yard') + '</button></div>'
      + '<p class="by-fine">Edit a copy keeps your own yard, if you have one, exactly as it was.</p>';
  }
  function leaveView(to) {
    rootEl.classList.remove('by-viewing'); $('by-view').hidden = true; $('by-view').innerHTML = '';
    if (to === 'copy') { adopt(normYard(shared)); mode = 'copy'; isSample = false; save(); ga('bin_print_copy', bins()); }
    else { mode = 'mine'; loadMine(); }
    shared = null; dropHash(); undo = []; sel = -1; closeEditor(); fillKit(); render();
  }
  function drawBar() {
    var b = $('by-bar');
    if (mode !== 'copy') { b.hidden = true; b.innerHTML = ''; return; }
    b.hidden = false;
    b.innerHTML = '<p>You are editing a copy of a shared yard. Your own yard is saved separately and has not changed.</p><div class="by-row"><button type="button" class="by-btn" id="by-keep">Keep this as my yard</button><button type="button" class="by-btn" id="by-back">Back to my yard</button></div>';
  }
  rootEl.addEventListener('click', function (e) {
    var id = e.target && e.target.id;
    if (id === 'by-copy') leaveView('copy');
    else if (id === 'by-mine') leaveView('mine');
    else if (id === 'by-vprint') printSheet('crew');
    else if (id === 'by-keep') { try { root.localStorage.setItem(LS, JSON.stringify({ v: 1, name: S.name, crew: S.crew, crewBu: S.crewBu, items: S.items })); root.localStorage.removeItem(LS_COPY); } catch (x) {} mode = 'mine'; isSample = false; render(); note('This is now your yard.'); }
    else if (id === 'by-back') { try { root.localStorage.removeItem(LS_COPY); } catch (x) {} mode = 'mine'; loadMine(); undo = []; sel = -1; closeEditor(); fillKit(); render(); note('Back to your own yard.'); }
  });

  /* --------------------------------------------------------------- editor */
  function opt(v, cur, label) { return '<option value="' + v + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + label + '</option>'; }
  function field(id, label, val, extra) { return '<label class="by-f" for="' + id + '"><span>' + label + '</span><input class="by-in" id="' + id + '" type="number" inputmode="decimal" step="any" value="' + (val === null || val === undefined ? '' : val) + '"' + (extra || '') + '></label>'; }
  function openEditor(i, focus) {
    sel = i; var it = S.items[i], ed = $('by-ed'), G = GB(), names = labels(S.items);
    snap();
    var h = '<div class="by-edh"><h3 class="by-h3">Edit ' + esc(names[i]) + '</h3><button type="button" class="by-btn" id="by-done">Done</button></div><div class="by-eg">'
      + '<label class="by-f by-wide" for="by-e-name"><span>Name or label</span><input class="by-in" id="by-e-name" type="text" maxlength="' + NAME_MAX + '" placeholder="' + esc(isBin(it) ? names[i] : MARKER[it.t]) + '" value="' + esc(it.name) + '" autocomplete="off"></label>';
    if (it.t === 'round' || it.t === 'hopper') {
      h += field('by-e-d', 'Diameter (ft)', it.d, ' min="6" max="160"')
        + '<label class="by-f" for="by-e-hm"><span>Height by</span><select class="by-in" id="by-e-hm">' + opt('ft', it.hMode, it.t === 'hopper' ? 'Cylinder height (ft)' : 'Eave height (ft)') + opt('rings', it.hMode, 'Rings x ring height') + '</select></label>'
        + '<span class="by-sub" data-show="ft">' + field('by-e-eave', it.t === 'hopper' ? 'Cylinder height (ft)' : 'Eave height (ft)', it.eave, ' min="1" max="80"') + '</span>'
        + '<span class="by-sub" data-show="rings">' + field('by-e-rings', 'Rings', it.rings, ' min="1" max="40" step="1"')
        + '<label class="by-f" for="by-e-ri"><span>Ring height</span><select class="by-in" id="by-e-ri">' + G.RINGS_IN.map(function (r) { return opt(r, it.ringIn, r + ' in' + (r === 32 ? ' (GSI, Brock narrow)' : r === 44 ? ' (GSI, Sukup, Brock wide)' : '')); }).join('') + '</select></label></span>'
        + '<p class="by-fine by-wide" data-show="rings">A measured grain depth beats a ring count: raised floors and offsets change it.</p>'
        + '<label class="by-f" for="by-e-pk"><span>Count it like</span><select class="by-in" id="by-e-pk">' + opt('plain', it.peak, 'Plain: 25° peak, no pack') + opt('dealer', it.peak, 'Dealer chart: 28° peak, 6% pack') + '</select></label>'
        + (it.t === 'hopper' ? field('by-e-hop', 'Hopper angle (°)', it.hop, ' min="10" max="79"') : '');
    } else if (it.t === 'flat') {
      h += field('by-e-L', 'Length (ft)', it.L, ' min="4" max="200"') + field('by-e-W', 'Width (ft)', it.W, ' min="4" max="200"') + field('by-e-H', 'Wall height (ft)', it.H, ' min="1" max="40"');
    } else if (it.t === 'drive') {
      h += field('by-e-L', 'Length (ft)', it.L, ' min="4" max="400"') + field('by-e-W', 'Width (ft)', it.W, ' min="4" max="60"') + '<button type="button" class="by-btn" id="by-rot">Turn 90°</button>';
    }
    if (isBin(it)) {
      h += '<label class="by-f" for="by-e-crop"><span>Crop</span><select class="by-in" id="by-e-crop">' + Object.keys(CROPS).map(function (c) { return opt(c, it.crop, CROPS[c].label + ' (' + CROPS[c].lb + ' lb)'); }).join('') + '</select></label>'
        + field('by-e-tw', 'Test weight (lb/bu)', it.tw, ' min="20" max="70"')
        + '<label class="by-f" for="by-e-fm"><span>Grain in it now</span><select class="by-in" id="by-e-fm">' + opt('none', it.fm, 'Empty / skip') + opt('height', it.fm, 'Grain height at the wall (ft)') + opt('below', it.fm, (it.t === 'flat' ? 'Feet from the top' : 'Feet from the eave') + ' down to grain') + '</select></label>'
        + '<span class="by-sub" data-fill>' + field('by-e-fv', 'Feet', it.fv, ' min="0" max="80"') + '</span>'
        + (it.t === 'flat' ? '' : '<span class="by-sub" data-fill><label class="by-f" for="by-e-sf"><span>Grain surface</span><select class="by-in" id="by-e-sf">' + opt('level', it.sf, 'Level') + opt('peaked', it.sf, 'Peaked') + opt('draw', it.sf, 'Cored (draw-down funnel)') + '</select></label></span>')
        + '<label class="by-f" for="by-e-st"><span>Status for the crew</span><select class="by-in" id="by-e-st">' + opt('', it.st, 'None') + Object.keys(STATUS).map(function (k) { return opt(k, it.st, STATUS[k][1]); }).join('') + '</select></label>'
        + '<label class="by-f by-wide" for="by-e-note"><span>Note (printed on the sheets)</span><input class="by-in" id="by-e-note" type="text" maxlength="' + NOTE_MAX + '" placeholder="Soybeans, full, do not fill" value="' + esc(it.note) + '" autocomplete="off"></label>';
    }
    h += '</div><div class="by-row"><button type="button" class="by-btn by-del" id="by-del">Delete</button></div><p class="by-fine" id="by-e-msg" aria-live="polite"></p>';
    ed.innerHTML = h; ed.hidden = false;
    syncEditor();
    render();
    if (focus) { var f = $('by-e-name'); if (f) f.focus(); }
  }
  function syncEditor() {
    var it = S.items[sel]; if (!it) return;
    doc.querySelectorAll('#by-ed [data-show]').forEach(function (e) { e.hidden = e.getAttribute('data-show') !== it.hMode; });
    doc.querySelectorAll('#by-ed [data-fill]').forEach(function (e) { e.hidden = it.fm === 'none'; });
    var fv = $('by-e-fv');
    if (fv) fv.parentNode.querySelector('span').textContent = it.fm === 'below' ? (it.t === 'flat' ? 'Feet from the top to grain' : 'Feet from the eave to grain') : 'Grain height at the wall (ft)';
  }
  function readEditor() {
    var it = S.items[sel]; if (!it) return;
    var o = JSON.parse(JSON.stringify(it)), bad = [];
    var map = { 'by-e-d': 'd', 'by-e-eave': 'eave', 'by-e-rings': 'rings', 'by-e-hop': 'hop', 'by-e-L': 'L', 'by-e-W': 'W', 'by-e-H': 'H', 'by-e-tw': 'tw', 'by-e-fv': 'fv' };
    Object.keys(map).forEach(function (id) {
      var e = $(id); if (!e) return;
      var v = e.value.trim();
      if (id === 'by-e-fv' && v === '') { o.fv = null; e.removeAttribute('aria-invalid'); return; }
      var n = parseFloat(v), lo = parseFloat(e.min), hi = parseFloat(e.max);
      if (!isFinite(n) || (isFinite(lo) && n < lo) || (isFinite(hi) && n > hi)) { e.setAttribute('aria-invalid', 'true'); bad.push(e.parentNode.querySelector('span').textContent); return; }
      e.removeAttribute('aria-invalid'); o[map[id]] = n;
    });
    var sv = function (id, k) { var e = $(id); if (e) o[k] = e.value; };
    sv('by-e-hm', 'hMode'); sv('by-e-ri', 'ringIn'); sv('by-e-pk', 'peak'); sv('by-e-fm', 'fm'); sv('by-e-sf', 'sf'); sv('by-e-st', 'st'); sv('by-e-name', 'name'); sv('by-e-note', 'note');
    var cr = $('by-e-crop');
    if (cr && cr.value !== it.crop) { o.crop = cr.value; o.tw = CROPS[cr.value].lb; $('by-e-tw').value = o.tw; }
    var n2 = normalize(o); if (!n2) return;
    S.items[sel] = n2;
    var c = isBin(n2) ? calc(n2) : null;
    $('by-e-msg').textContent = bad.length ? 'Check: ' + bad.join(', ') + '. The last good number is used.'
      : c && n2.fm === 'height' && fin(n2.fv) && n2.fv > c.maxH ? 'That is above the ' + f1(c.maxH) + ' ft wall; counted to the wall top.' : '';
    syncEditor(); drawMap(); drawTable(); drawTips(); changed();
  }
  function closeEditor() { var ed = $('by-ed'); ed.hidden = true; ed.innerHTML = ''; }
  $('by-ed').addEventListener('input', readEditor);
  $('by-ed').addEventListener('change', readEditor);
  $('by-ed').addEventListener('click', function (e) {
    var t = e.target;
    if (t.id === 'by-done') { var i = sel; closeEditor(); render(); focusItem(i); }
    else if (t.id === 'by-del') removeItem(sel);
    else if (t.id === 'by-rot') { var it = S.items[sel], L = it.L; it.L = it.W; it.W = L; render(); changed(); }
  });

  function focusItem(i) { var g = mapEl.querySelector('[data-i="' + i + '"]'); if (g && g.focus) { try { g.focus({ preventScroll: true }); } catch (e) { g.focus(); } } }
  function removeItem(i) {
    if (i < 0 || !S.items[i]) return;
    snap(); var nm = labels(S.items)[i];
    S.items.splice(i, 1); sel = -1; closeEditor(); render(); changed();
    note(nm + ' removed. Undo brings it back.');
    if (S.items.length) focusItem(Math.min(i, S.items.length - 1));
  }
  function overlaps(x, y, e) {
    return S.items.some(function (o) { var f = extent(o); return Math.abs(o.x - x) * 2 < f.w + e.w + 4 && Math.abs(o.y - y) * 2 < f.h + e.h + 4; });
  }
  function addItem(t) {
    if (S.items.length >= MAX_ITEMS) { note('A yard holds ' + MAX_ITEMS + ' things here.'); return; }
    snap();
    var it = defaults(t), e = extent(it), spot = null;
    for (var y = Math.ceil(e.h / 2 / GRID) * GRID; y <= YARD_H - e.h / 2 && !spot; y += GRID)
      for (var x = Math.ceil(e.w / 2 / GRID) * GRID; x <= YARD_W - e.w / 2; x += GRID) if (!overlaps(x, y, e)) { spot = [x, y]; break; }
    if (spot) { it.x = spot[0]; it.y = spot[1]; }
    S.items.push(it); isSample = false; ga('bin_print_add', { kind: t });
    openEditor(S.items.length - 1, true); changed();
  }
  doc.querySelectorAll('#by-root [data-add]').forEach(function (b) { b.addEventListener('click', function () { addItem(b.getAttribute('data-add')); }); });
  $('by-mark').addEventListener('change', function () { var v = this.value; this.value = ''; if (v) addItem(v); });
  $('by-undo').addEventListener('click', doUndo);
  $('by-clear').addEventListener('click', function () { if (!S.items.length) return; snap(); S.items = []; sel = -1; closeEditor(); isSample = false; render(); save(); note('Yard cleared. Undo brings it back.'); });
  $('by-name').addEventListener('input', function () { S.name = clean(this.value, YARD_MAX); save(); });
  $('by-crew').addEventListener('input', function () { S.crew = clean(this.value, CREW_MAX, true); save(); });
  $('by-crewbu').addEventListener('change', function () { S.crewBu = this.checked; save(); });
  $('by-tbody').addEventListener('click', function (e) { var b = e.target.closest('[data-i]'); if (b) openEditor(+b.getAttribute('data-i'), false); });
  $('by-tips').addEventListener('input', function (e) {
    var i = curBin(); if (i < 0) return;
    if (e.target.id === 'by-moist') { moist = e.target.value; $('by-shr').textContent = shrinkLine(S.items[i], calc(S.items[i]), labels(S.items)[i]); }
    else if (e.target.id === 'by-fan') { fan = e.target.value; $('by-air').textContent = airLine(calc(S.items[i])); }
  });

  /* ---------------------------------------------------- drag, pinch, keys */
  var drag = null, pts = {};
  function toFt(ev) { var r = mapEl.getBoundingClientRect(); return { x: view.x + (ev.clientX - r.left) / r.width * view.w, y: view.y + (ev.clientY - r.top) / r.height * view.h }; }
  function clampItem(it) { var e = extent(it); it.x = clamp(it.x, Math.min(e.w / 2, YARD_W / 2), Math.max(YARD_W - e.w / 2, YARD_W / 2)); it.y = clamp(it.y, Math.min(e.h / 2, YARD_H / 2), Math.max(YARD_H - e.h / 2, YARD_H / 2)); }
  function setView(w, cx, cy) {
    w = clamp(w, 40, YARD_W); var h = w * YARD_H / YARD_W;
    view = { w: w, h: h, x: clamp(cx - w / 2, 0, YARD_W - w), y: clamp(cy - h / 2, 0, YARD_H - h) };
    drawMap();
  }
  function dist() { var a = Object.keys(pts).map(function (k) { return pts[k]; }); return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1; }
  function mid() { var a = Object.keys(pts).map(function (k) { return pts[k]; }); return { clientX: (a[0].x + a[1].x) / 2, clientY: (a[0].y + a[1].y) / 2 }; }
  mapEl.addEventListener('pointerdown', function (ev) {
    pts[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    if (Object.keys(pts).length === 2) { drag = { pinch: true, d0: dist(), w0: view.w, c: toFt(mid()) }; return; }
    var g = ev.target.closest && ev.target.closest('.by-it'), p = toFt(ev);
    if (g) {
      var i = +g.getAttribute('data-i'), it = S.items[i];
      drag = { i: i, dx: it.x - p.x, dy: it.y - p.y, x0: it.x, y0: it.y, moved: false, g: g, sx: ev.clientX, sy: ev.clientY };
    } else if (view.w < YARD_W - 0.5) drag = { pan: true, p: { x: ev.clientX, y: ev.clientY }, v: { x: view.x, y: view.y } };
    else return;
    try { mapEl.setPointerCapture(ev.pointerId); } catch (e) {}
  });
  mapEl.addEventListener('pointermove', function (ev) {
    if (pts[ev.pointerId]) pts[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    if (!drag) return;
    if (drag.pinch) { if (Object.keys(pts).length === 2) setView(drag.w0 * drag.d0 / dist(), drag.c.x, drag.c.y); return; }
    if (drag.pan) { var r = mapEl.getBoundingClientRect(), k = view.w / r.width; setView(view.w, drag.v.x - (ev.clientX - drag.p.x) * k + view.w / 2, drag.v.y - (ev.clientY - drag.p.y) * k + view.h / 2); return; }
    if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 6) return;
    if (!drag.moved) { drag.moved = true; snap(); }
    var p = toFt(ev), it = S.items[drag.i];
    it.x = Math.round((p.x + drag.dx) / GRID) * GRID; it.y = Math.round((p.y + drag.dy) / GRID) * GRID; clampItem(it);
    drag.g.setAttribute('transform', 'translate(' + it.x + ' ' + it.y + ')');
    ev.preventDefault();
  });
  function endDrag(ev) {
    delete pts[ev.pointerId];
    if (!drag) return;
    var d = drag; drag = null;
    if (d.pinch || d.pan) return;
    if (d.moved) { var it = S.items[d.i]; if (it.x === d.x0 && it.y === d.y0) undo.pop(); else changed(); sel = d.i; render(); focusItem(d.i); }
    else if (ev.type === 'pointerup') openEditor(d.i, false);
  }
  mapEl.addEventListener('pointerup', endDrag);
  mapEl.addEventListener('pointercancel', endDrag);
  mapEl.addEventListener('keydown', function (ev) {
    var g = ev.target.closest && ev.target.closest('.by-it'); if (!g) return;
    var i = +g.getAttribute('data-i'), it = S.items[i], st = ev.shiftKey ? 1 : GRID;
    var mv = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[ev.key];
    if (mv) {
      ev.preventDefault(); snap();
      it.x += mv[0]; it.y += mv[1]; clampItem(it); sel = i; drawMap(); drawTable(); focusItem(i); changed();
    } else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openEditor(i, true); }
    else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); removeItem(i); }
  });
  $('bin-print').addEventListener('keydown', function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && (ev.key === 'z' || ev.key === 'Z')) {
      var t = ev.target; if (t && (t.tagName === 'INPUT' && t.type === 'text' || t.tagName === 'TEXTAREA')) return;
      ev.preventDefault(); var i = sel; doUndo(); if (i >= 0 && S.items[i]) focusItem(i);
    }
  });
  doc.querySelector('#by-root .by-zoom').addEventListener('click', function (e) {
    var z = e.target.getAttribute && e.target.getAttribute('data-z'); if (!z) return;
    var cx = view.x + view.w / 2, cy = view.y + view.h / 2;
    if (z === 'fit') setView(YARD_W, YARD_W / 2, YARD_H / 2); else setView(view.w * (z === 'in' ? 0.7 : 1 / 0.7), cx, cy);
  });
  var rz = 0; root.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (mode === 'view') drawView(); else drawMap(); }, 120); });
  /* a pasted link or yard code opens in the crew view, like a scanned one */
  $('by-openf').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('by-code').value.trim(), k = v.indexOf('#yard='), y = decode(k >= 0 ? v.slice(k + 6) : v);
    if (!y || !y.items.length) { note('That is not a Bin Print link or yard code.'); return; }
    shared = normYard(y); mine = !!readLS(LS); mode = 'view'; closeEditor(); $('by-code').value = '';
    ga('bin_print_open_code', { bins: shared.items.length }); render();
    try { $('bin-print').scrollIntoView({ block: 'start' }); } catch (x) {}
  });

  function download(blob, name) {
    if (K) { K.download(doc, blob, name); return; }
    var a = doc.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = name; doc.body.appendChild(a); a.click(); doc.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }
  function stamp() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  $('by-export').addEventListener('click', function () {
    ga('bin_print_export', bins());
    download(new Blob([JSON.stringify({ v: 1, name: S.name, crew: S.crew, crewBu: S.crewBu, items: S.items }, null, 1)], { type: 'application/json' }), 'agsist-bin-print-' + stamp() + '.json');
    note('Saved a JSON copy of this yard.');
  });
  $('by-import').addEventListener('click', function () { $('by-file').click(); });
  $('by-file').addEventListener('change', function () {
    var f = this.files && this.files[0]; this.value = '';
    if (!f) return;
    if (f.size > 200000) { note('That file is too big for a yard.'); return; }
    var rd = new FileReader();
    rd.onload = function () {
      var y = null;
      try { var o = JSON.parse(rd.result); if (o && Array.isArray(o.items)) y = normYard(o); } catch (e) {}
      if (!y) { note('That file is not a Bin Print yard.'); return; }
      snap(); adopt(y); fillKit(); sel = -1; closeEditor(); render(); changed();
      ga('bin_print_import', bins()); note('Opened ' + y.items.length + ' things from the file.');
    };
    rd.readAsText(f);
  });

  /* Without the share kit: the five Bin Print buttons say they are unavailable instead of doing nothing */
  if (!K) ['by-print', 'by-pic', 'by-link', 'by-crewprint', 'by-send'].forEach(function (id) {
    var b = $(id); if (!b) return;
    b.disabled = true; b.setAttribute('aria-disabled', 'true'); b.title = 'Not available right now. Reload the page to try again.';
  });
  else {
    /* ------------------------------------------------------ share kit */
    function copyLink(url, msg) {
      var ok = function () { note(msg); };
      K.copy(root, url, ok, function () { if (K.execCopy(doc, url)) ok(); else note('Copy this link: ' + url); });
    }
    $('by-link').addEventListener('click', function () {
      ga('bin_print_link', bins());
      copyLink(shareUrl(cur()), 'Bin Print link copied. Names and notes are inside it.');
    });
    /* the sheets: hidden at the end of <body>; print shows only the one chosen while html.byp-on is set */
    var MAX_PX = 10.2 * 96 - 8, chosen = '';
    function buildSheet(kind) {
      var el = K.sheet(doc, 'byp', 'byp');
      var y = cur(), plan = qrPlan(y), fits = false, crew = kind === 'crew';
      api.lastPlan = plan;
      el.style.zoom = ''; el.classList.toggle('byp-crew', crew); el.setAttribute('data-kind', crew ? 'crew' : 'full');
      (crew ? [5.4, 4.6, 3.8, 3.2, 2.8] : [3.4, 2.7, 2.1, 1.7]).some(function (h, i, a) {
        el.innerHTML = crew ? crewHtml(y, { plan: plan, mapH: h }) : sheetHtml(y, { plan: plan, mapH: h });
        el.classList.toggle('byp-tight', i === a.length - 1);
        fits = K.measure(el) <= MAX_PX;
        return fits;
      });
      if (!fits) { var z = Math.floor(MAX_PX / K.measure(el) * 100) / 100; el.style.zoom = String(z); }
      el.setAttribute('data-fit', fits ? '1' : '0');
      return el;
    }
    api.buildSheet = buildSheet;
    function inSection() {
      var s = $('bin-print'), a = doc.activeElement;
      if (a && s.contains(a)) return true;
      var r = s.getBoundingClientRect(), m = (root.innerHeight || 800) / 2;
      return r.top < m && r.bottom > m;
    }
    /* Ctrl+P: the sheet the reader last chose with a button, while they are in this section; else the page's own
       printed record, as before */
    function sheetOff() { K.show(doc, 'byp-on', false); }
    K.printHook(root, function () {
      if (doc.documentElement.classList.contains('byp-on')) return;
      if (chosen && inSection()) { buildSheet(chosen); K.show(doc, 'byp-on', true); }
    }, sheetOff, { mq: false });
    function printSheet(kind) {
      chosen = kind; buildSheet(kind); K.show(doc, 'byp-on', true);
      ga(kind === 'crew' ? 'bin_print_crew_print' : 'bin_print_print', bins());
      K.printNow(root, sheetOff);
    }
    $('by-print').addEventListener('click', function () { printSheet('full'); });
    $('by-crewprint').addEventListener('click', function () { printSheet('crew'); });
    function picture(crew, then) {
      var ready = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
      ready.then(function () {
        var im = image(cur(), doc, { crew: crew });
        api.lastImage = { w: im.canvas.width, h: im.canvas.height, texts: im.texts, sizes: im.sizes, crew: !!crew, url: im.plan && im.plan.url };
        im.canvas.toBlob(function (blob) { then(blob, 'agsist-bin-print-' + (crew ? 'crew-' : '') + stamp() + '.png'); }, 'image/png');
      });
    }
    $('by-pic').addEventListener('click', function () {
      picture(false, function (blob, name) {
        if (!blob) { note('Could not draw the picture here.'); return; }
        ga('bin_print_picture', bins());
        var file = K.file(blob, name);
        if (K.canShareFile(root, file)) { K.share(root, { files: [file], title: 'Bin Print' }); return; }
        download(blob, name); note('Picture saved');
      });
    });
    /* Send to crew: the phone's share sheet with the link and the crew picture; else the link alone; else copy it */
    $('by-send').addEventListener('click', function () {
      var url = shareUrl(cur()), nav = root.navigator;
      ga('bin_print_send', bins());
      picture(true, function (blob, name) {
        var file = blob ? K.file(blob, name) : null;
        var data = { title: 'Bin Print crew sheet', text: 'Our bin yard map, open on your phone:', url: url };
        if (nav.share) {
          if (file && nav.canShare && nav.canShare({ files: [file] })) data.files = [file];
          K.share(root, data, null, function () { copyLink(url, 'Link copied. Names and notes are inside it.'); });
          return;
        }
        copyLink(url, 'This browser has no share sheet, so the link is copied. Names and notes are inside it.');
      });
    });
  }
  function fillKit() { $('by-name').value = S.name; $('by-crew').value = S.crew; $('by-crewbu').checked = S.crewBu; }

  api.state = function () { return S; };
  api.mode = function () { return mode; };
  api.render = render;

  var how = load();
  fillKit();
  render();
  if (how === 'link') ga('bin_print_view', { bins: shared.items.length });
})(typeof window !== 'undefined' ? window : this);
