/* components/basis-drive.js: "Is the drive worth it" on a cash-bids town page (Nov 13, 2026).
 *
 * Today's bids by distance. Left: every bid in town, one dot each, best to lowest. Right: every elevator out to
 * 40 miles, placed by straight-line miles from the page's own point (the center of its ZIP, the same point the
 * page's "Other elevators within 40 miles" list measures from). One cents axis for both, in the words farmers use
 * ("2 over", "even", "25 under"). A thin line under each dot runs from where that bid was a week before. The
 * state's middle bid on the same futures month is one dashed rule. The best bids are the one accent colour.
 *
 * WHAT IS PLOTTED, AND WHAT IS NOT
 *   One bid per elevator and crop, at its nearest open delivery (data/state-basis/<ST>.json, the rows the state
 *   page lists). Only bids for one delivery month against one futures contract share the axis: the pair most bids
 *   in town carry (no bid in town: most bids nearby). Every other bid is named under the chart as not comparable.
 *   A bid the state page marks as a misread or an outlier is left out and counted under the chart. A board that
 *   only relays another elevator's bids is not drawn twice. Nothing is estimated, and no freight cost is assumed.
 *
 * The town page (scripts/build_cash_bid_pages.py drive_box) prints the headline, the words and a phone-sized
 * picture of the first crop from this same file run under node, so the page reads without script; this script
 * redraws it at the box's own width, wires the crop and view buttons, the dot readout (tap, click or the arrow
 * keys), Copy link and Save the picture (1200 x 630).
 *
 * Exports pick, story, svg, readout, note, cardText and render (the builder's entry) for node.
 */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var NEAR_MI = 40;                       // the page's own nearby radius (build_cash_bid_pages.NEARBY_MI)
  var CROPS = [['corn', 'Corn', 'corn'], ['soybeans', 'Soybeans', 'soybean']];
  var FONT = 'Inter, system-ui, -apple-system, Segoe UI, sans-serif';
  // the page's colours are the site's tokens; the picture's are the kit card's (components/ag-chart.js card)
  /* The picture is drawn with classes (components/basis-drive.css gives them the site's colour tokens), every
     line of a kind in one path and every dot a round-capped point, so a town page carries it in a few KB. The saved
     picture is an image with no page around it: it carries its own colours (the kit card's) in a style block. */
  var CARD = { ink: '#e9edeb', mid: 'rgba(233,237,235,.66)', grid: 'rgba(132,160,168,.22)', rule: 'rgba(132,160,168,.45)', zone: '#14191b', gold: '#d4a23f', bg: '#0a0c0d' };
  function cardStyle(c) {
    return '<style>text{fill:' + c.ink + '}.m{fill:' + c.mid + '}.g{fill:' + c.gold + '}.b{font-weight:700}.B{font-size:1.08em}.z{fill:' + c.zone + '}' +
      '.gr,.ev,.ax,.md,.wk,.dr,.di,.dg,path{fill:none}.gr{stroke:' + c.grid + '}.ev,.ax{stroke:' + c.rule + '}.ev{stroke-width:1.4}.md{stroke:' + c.ink + ';stroke-width:1.2;stroke-dasharray:5 4}' +
      '.wk{stroke:' + c.mid + ';stroke-width:1.6}.dr,.di,.dg{stroke-linecap:round}.dr{stroke:' + c.bg + '}.di{stroke:' + c.ink + '}.dg{stroke:' + c.gold + '}</style>';
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hy(s) { return String(s).replace(/(\w)-(?=\w)/g, '$1‐'); }
  function f1(v) { return (Math.round(v * 10) / 10).toString(); }
  /* Twin of miles() in scripts/build_cash_bid_pages.py: the same sphere, so a dot and the page's list agree. */
  function miles(a, b, c, d) {
    var r = Math.PI / 180, x = Math.pow(Math.sin((c - a) * r / 2), 2) + Math.cos(a * r) * Math.cos(c * r) * Math.pow(Math.sin((d - b) * r / 2), 2);
    return 2 * 3958.7613 * Math.asin(Math.sqrt(x));
  }
  /* basis $/bu -> cents to a tenth (a board can post a quarter or half cent) */
  function cents(b) { return Math.round(b * 1000) / 10; }
  function num(c) { var a = Math.abs(c); return a % 1 ? a.toFixed(1) : String(a); }
  /* the farmer's words: "2 over", "even", "25 under" */
  function word(c) { return c === 0 ? 'even' : num(c) + (c > 0 ? ' over' : ' under'); }
  function mi(m) { return m < 1 ? 'under a mile' : Math.round(m) + (Math.round(m) === 1 ? ' mile' : ' miles'); }
  function day(iso) { var d = new Date(iso); if (isNaN(d)) return ''; var c = ct(d); return MON[c.m] + ' ' + c.d; }
  /* a UTC time -> its date in Central time (the network's day), by the US DST rule; no Intl needed under node */
  function ct(d) {
    var y = d.getUTCFullYear(), dst0 = Date.UTC(y, 2, 8 + (7 - new Date(Date.UTC(y, 2, 8)).getUTCDay()) % 7, 8), dst1 = Date.UTC(y, 10, 1 + (7 - new Date(Date.UTC(y, 10, 1)).getUTCDay()) % 7, 7);
    var off = d.getTime() >= dst0 && d.getTime() < dst1 ? 5 : 6, t = new Date(d.getTime() - off * 36e5);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
  }
  function cash(v) { return '$' + (Math.round(v * 100 + 1e-7) / 100).toFixed(2); }
  /* "Dec '26" -> "December 2026"; "" when it is not one */
  function conFull(vs) { var m = /^([A-Z][a-z]{2}) '(\d{2})$/.exec(vs || ''), i = m ? MON.indexOf(m[1]) : -1; return i < 0 ? '' : FULL[i] + ' 20' + m[2]; }
  function conMon(vs) { var m = /^([A-Z][a-z]{2}) /.exec(vs || ''), i = m ? MON.indexOf(m[1]) : -1; return i < 0 ? '' : FULL[i]; }
  function dmFull(dm, year) { var i = +String(dm).slice(5, 7) - 1; return (FULL[i] || '') + (String(dm).slice(0, 4) === String(year) ? '' : ' ' + String(dm).slice(0, 4)); }
  function names() { return (typeof window !== 'undefined' && window.elevNames) || (typeof require === 'function' ? (function () { try { return require('./elev-names.js'); } catch (e) { return null; } })() : null); }

  /* One elevator's name for the readout: the company and its site as the page names them (elevNames.boardLabel),
     with the town when the site does not already say it. */
  function label(r, town, st) {
    var N = names(), l = N && N.boardLabel ? N.boardLabel(r.elevator, r.site ? [r.site] : [], town, st) : r.elevator + (r.site ? ', ' + r.site : '');
    if (town && l.toLowerCase().indexOf(town.toLowerCase()) < 0) l += ', ' + town;
    return l;
  }

  /* docs: {ST: data/state-basis/<ST>.json}; cfg: the page's own box (path, town, st, ll [lat, lon], date, med).
     -> per crop { crop, Crop, adj, town: [dot], out: [dot], ref: {dm, vs}, med, other: [dot], left: n, all: [dot], prev }
     a dot: { name, town, path, cash, c (cents), w (cents in a week or null), mi, inTown, priced, dm, vs } */
  function pick(docs, cfg, crop) {
    var rows = [], prev = '', townOf = {};
    Object.keys(docs || {}).sort().forEach(function (st) {
      var doc = docs[st]; if (!doc || !doc.cols) return;
      var ix = {}; doc.cols.forEach(function (k, i) { ix[k] = i; });
      if (doc.prev && (!prev || doc.prev > prev)) prev = doc.prev;
      (doc.towns || []).forEach(function (t) { townOf[t[0]] = t[1]; });
      doc.rows.forEach(function (r) {
        if (r[ix.crop] !== crop || r[ix.relay]) return;
        var inTown = !!cfg.path && r[ix.path] === cfg.path, lat = r[ix.lat], lon = r[ix.lon];
        var d = typeof lat === 'number' && typeof lon === 'number' && cfg.ll ? miles(cfg.ll[0], cfg.ll[1], lat, lon) : null;
        if (!inTown && (d == null || d > NEAR_MI)) return;
        rows.push({ elevator: r[ix.elevator], site: r[ix.town], path: r[ix.path], cash: r[ix.cash], c: cents(r[ix.basis]),
          w: r[ix.wow_cents] == null ? null : Math.round(r[ix.wow_cents] * 10) / 10, mi: d, inTown: inTown, priced: r[ix.priced],
          dm: r[ix.dm] || '', vs: r[ix.vs] || '', flag: r[ix.flag] || '', st: st });
      });
    });
    rows.forEach(function (r) {
      r.town = r.inTown ? cfg.town : (townOf[r.path] || r.site);
      r.name = label({ elevator: r.elevator, site: r.site }, r.town, r.st);
    });
    var ok = rows.filter(function (r) { return !r.flag; }), bad = rows.filter(function (r) { return r.flag === 'suspect' || r.flag === 'outlier'; }), left = bad.length;
    /* the delivery month and futures contract most bids in town carry (none in town: most bids nearby); a tie goes to
       the state's own headline contract, then the nearer month, then the nearer contract */
    var count = function (rs) { var n = {}; rs.forEach(function (r) { if (r.dm && r.vs) { var k = r.dm + '|' + r.vs; n[k] = (n[k] || 0) + 1; } }); return n; };
    var med = (cfg.med || {})[crop] || null, tally = count(ok.filter(function (r) { return r.inTown; }));
    if (!Object.keys(tally).length) tally = count(ok);
    var conKey = function (vs) { var m = /^([A-Z][a-z]{2}) '(\d{2})$/.exec(vs); return m ? +m[2] * 12 + MON.indexOf(m[1]) : 9999; };
    var refK = Object.keys(tally).sort(function (a, b) {
      var A = a.split('|'), B = b.split('|');
      return tally[b] - tally[a] || (med && B[1] === med.label) - (med && A[1] === med.label) || (A[0] < B[0] ? -1 : A[0] > B[0] ? 1 : 0) || conKey(A[1]) - conKey(B[1]);
    })[0];
    var ref = refK ? { dm: refK.split('|')[0], vs: refK.split('|')[1] } : null;
    var on = ref ? ok.filter(function (r) { return r.dm === ref.dm && r.vs === ref.vs; }) : [];
    var other = rows.filter(function (r) { return (!r.flag || r.flag === 'nocon') && on.indexOf(r) < 0; });
    var town = on.filter(function (r) { return r.inTown; }).sort(function (a, b) { return b.c - a.c || (b.w || 0) - (a.w || 0) || (a.name < b.name ? -1 : 1); });
    var out = on.filter(function (r) { return !r.inTown; }).sort(function (a, b) { return a.mi - b.mi || b.c - a.c || (a.name < b.name ? -1 : 1); });
    var c = CROPS.filter(function (x) { return x[0] === crop; })[0] || [crop, crop, crop];
    return { crop: crop, Crop: c[1], adj: c[2], town: town, out: out, all: town.concat(out), ref: ref, other: other, left: left, leftIn: bad.some(function (r) { return r.inTown; }),
             med: med && ref && med.label === ref.vs ? med : null, prev: prev };
  }
  function bestOf(rs) { return rs.reduce(function (b, r) { return !b || r.c > b.c || (r.c === b.c && (r.mi || 0) < (b.mi || 0)) ? r : b; }, null); }
  function lowOf(rs) { return rs.reduce(function (b, r) { return !b || r.c < b.c ? r : b; }, null); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }
  function list(xs) { return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; }

  /* how the bids in town moved in a week, from the matched week-ago bids only; '' with none */
  function week(rs) {
    var ws = rs.filter(function (r) { return r.w != null; }).map(function (r) { return r.w; });
    if (!ws.length) return '';
    var lo = Math.min.apply(null, ws), hi = Math.max.apply(null, ws), who = rs.length === 1 ? 'The bid in town' : ws.length === rs.length ? 'Bids in town' : plural(ws.length, 'bid') + ' in town that posted a week before';
    var span = function (a, b) { return a === b ? num(a) + (Math.abs(a) === 1 ? ' cent' : ' cents') : num(a) + ' to ' + num(b) + ' cents'; };
    if (hi === 0 && lo === 0) return who + ' held where ' + (rs.length === 1 ? 'it was' : 'they were') + ' a week before.';
    if (lo >= 0) return who + ' rose ' + span(lo === 0 && ws.length > 1 ? 0 : lo, hi) + ' in a week.';
    if (hi <= 0) return who + ' fell ' + span(-hi, -lo) + ' in a week.';
    return who + ' moved from ' + num(-lo) + ' down to ' + num(hi) + ' up in a week.';
  }

  /* The headline is the finding, from the data shown; the take says what is plotted. */
  function story(p, cfg) {
    var C = p.Crop, place = cfg.town, T = p.town, O = p.out, bt = bestOf(T), bo = bestOf(O), yr = String(cfg.date || '').slice(0, 4);
    var head;
    if (!bt && !bo) return { head: 'No ' + p.adj + ' bids in or near ' + place + ' to compare today', take: '' };
    if (bt && bo) {
      head = C + ' is ' + word(bt.c) + ' in ' + place + '. ';
      var dc = Math.round((bo.c - bt.c) * 10) / 10;
      if (dc < 0) head += 'The best bid outside town is ' + word(bo.c) + ', ' + mi(bo.mi) + ' out.';
      else if (dc === 0) head += 'The best bid outside town is the same, ' + word(bo.c) + ', ' + mi(bo.mi) + ' out.';
      else head += 'The best bid within ' + NEAR_MI + ' miles is ' + word(bo.c) + ', ' + mi(bo.mi) + ' away, ' + num(dc) + (dc === 1 ? ' cent' : ' cents') + ' over the bid in town.';
    } else if (bt) {
      var elsewhere = p.other.some(function (r) { return !r.inTown; });
      head = C + ' is ' + word(bt.c) + ' in ' + place + '. No other elevator within ' + NEAR_MI + ' miles posted a ' + p.adj + ' bid' +
        (elsewhere ? ' for ' + dmFull(p.ref.dm, yr) + ' delivery against ' + conMon(p.ref.vs) + ' futures.' : '.');
    } else {
      var here = p.other.some(function (r) { return r.inTown; }) || p.leftIn;
      head = 'No ' + (here ? 'comparable ' : '') + p.adj + ' bid in ' + place + ' today. The best within ' + NEAR_MI + ' miles is ' + word(bo.c) + ', ' + mi(bo.mi) + ' out.';
    }
    var n = p.all.length, terms = (p.ref ? dmFull(p.ref.dm, yr) + ' delivery' : '') + (conFull(p.ref && p.ref.vs) ? ', against ' + conFull(p.ref.vs) + ' ' + p.adj + ' futures' : '');
    var take = (n === 1 ? 'One ' + p.adj + ' bid' : n + ' ' + p.adj + ' bids') + ' within ' + NEAR_MI + ' miles, as of ' + day(cfg.date) + (terms ? ', ' + (n === 1 ? '' : 'all ') + 'for ' + terms : '') + '.';
    var wk = week(T); if (wk) take += ' ' + wk;
    return { head: head, take: take };
  }

  /* the readout line for one dot -> [bold, rest] */
  function readout(p, r) {
    if (!r) return ['', ''];
    var where = r.inTown ? 'in town' : mi(r.mi);
    var rest = cash(r.cash) + ' cash, ' + word(r.c) + (conMon(r.vs) ? ' ' + conMon(r.vs) : '') + ', ' + where + ', posted ' + day(r.priced) + '.';
    rest += r.w == null ? ' No matching bid a week before.' : ' A week before: ' + word(Math.round((r.c - r.w) * 10) / 10) + '.';
    return [r.name + ':', rest];
  }
  /* the days the plotted bids were posted, in Central time: "Nov 12, 2026", "Nov 11 and 12, 2026", "Oct 31 to Nov 2, 2026" */
  function readDays(p) {
    var ds = {}; p.all.forEach(function (r) { var d = new Date(r.priced); if (!isNaN(d)) { var c = ct(d); ds[c.y * 1e4 + c.m * 100 + c.d] = c; } });
    var ks = Object.keys(ds).sort(), a = ks.length && ds[ks[0]], b = ks.length && ds[ks[ks.length - 1]];
    if (!a) return '';
    if (a === b) return MON[a.m] + ' ' + a.d + ', ' + a.y;
    var sep = ks.length === 2 ? ' and ' : ' to ';
    return MON[a.m] + ' ' + a.d + (a.y !== b.y ? ', ' + a.y : '') + sep + (a.m === b.m && a.y === b.y ? '' : MON[b.m] + ' ') + b.d + ', ' + b.y;
  }
  /* the words under the chart: only what this view draws, then the source */
  function note(p, cfg) {
    var s = [], yr = String(cfg.date || '').slice(0, 4), st = cfg.stName || cfg.st;
    if (p.all.length) s.push('Each dot is one posted ' + p.adj + ' bid: cash minus ' + (conFull(p.ref.vs) || p.ref.vs) + ' futures.');
    if (p.all.some(function (r) { return r.w != null; }) && p.prev) s.push('Its line runs from its basis on ' + day(p.prev) + '.');
    if (p.out.length) s.push('Miles are straight-line from ' + (cfg.from || 'the town') + ' to each elevator’s pin; dots that would touch sit side by side.');
    if (p.med) s.push(st + ' median: ' + word(cents(p.med.median)) + ', ' + plural(p.med.n, p.adj + ' bid') + ' against ' + conMon(p.ref.vs) + ' futures.' + (p.med.usda ? ' ' + p.med.usda : ''));
    if (p.other.length) {
      var nm = p.other.map(function (r) { return r.name; }), k = nm.length;
      s.push('Not on the chart, a different delivery month or futures: ' + (k > 4 ? nm.slice(0, 4).join('; ') + ' and ' + (k - 4) + ' more' : nm.join('; ')) + '.');
    }
    if (p.left) s.push(plural(p.left, 'bid') + ' that did not check out against the others ' + (p.left === 1 ? 'is' : 'are') + ' left out.');
    s.push('No freight cost is taken off. Source: posted elevator bids, read by AGSIST' + (readDays(p) ? ' ' + readDays(p) : '') + '. Call the elevator to confirm before you haul.');
    return s.join(' ');
  }

  /* ---------------------------------------------------------------- the picture */
  function widthOf(s, fs, bold) { return String(s).length * fs * (bold ? 0.6 : 0.55); }
  function hit(a, b) { return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1; }
  /* -> { svg, dots: [{x, y, r, i}], H, W } at width W. opt: { fs, card, h } */
  function svg(p, cfg, W, opt) {
    opt = opt || {};
    var phone = W < 640, fs = opt.fs || (phone ? 12 : 13), fb = fs + 1, H = opt.h || (phone ? 400 : 460);
    var T = p.town, O = p.out, st = cfg.stName || cfg.st, o = [], obst = [], labs = [];
    var vals = [];
    p.all.forEach(function (r) { vals.push(r.c); if (r.w != null) vals.push(Math.round((r.c - r.w) * 10) / 10); });
    if (p.med) vals.push(cents(p.med.median));
    if (!vals.length) vals = [0];
    var top = Math.ceil((Math.max.apply(null, vals) + 3) / 10) * 10, bot = Math.floor((Math.min.apply(null, vals) - 3) / 10) * 10;
    if (top - bot < 30) bot = top - 30;
    var stepT = (top - bot) / 10 > (phone ? 7 : 9) ? 20 : 10;
    if (stepT === 20) { top = Math.ceil(top / 20) * 20; bot = Math.floor(bot / 20) * 20; }
    var ticks = []; for (var v = top; v >= bot; v -= stepT) ticks.push(v);
    var L = Math.ceil(Math.max.apply(null, ticks.map(function (t) { return widthOf(word(t), fs, t === 0); }))) + 10;
    var R = phone ? 6 : Math.round(fs * 13.5), TOP = Math.round(fb * 2), BOT = Math.round(fs * 3.4);
    var y0 = TOP, y1 = H - BOT, Y = function (c) { return y0 + (top - c) / (top - bot) * (y1 - y0); };
    var r0 = opt.card ? 7 : phone ? 3.8 : 5.2, gap = phone ? 1.6 : 3, step = 2 * r0 + gap;
    var pad = phone ? 8 : 16;
    var ZA = T.length ? Math.max(phone ? 92 : 150, Math.min(phone ? 132 : 260, T.length * step + 2 * pad + (phone ? 0 : 40))) : 0;
    var GX = T.length ? (phone ? 12 : 28) : 0;
    var x0 = L + ZA + GX, x1 = W - R - (phone ? 10 : 14), Xm = function (m) { return x0 + Math.max(0, Math.min(NEAR_MI, m)) / NEAR_MI * (x1 - x0); };
    var add = function (b) { obst.push(b); };
    var t = function (x, y, s, cls, anchor) {
      var c = [/gold/.test(cls) ? 'g' : /mid/.test(cls) ? 'm' : '', /(^| )b( |$)/.test(cls) ? 'b' : '', /big/.test(cls) ? 'B' : ''].filter(Boolean).join(' ');
      return '<text x="' + f1(x) + '" y="' + f1(y) + '"' + (anchor === 'end' ? ' text-anchor="end"' : anchor === 'middle' ? ' text-anchor="middle"' : '') + (c ? ' class="' + c + '"' : '') + '>' + esc(hy(s)) + '</text>';
    };
    var P = { gr: [], ev: [], ax: [], md: [], wk: [], dr: [], di: [], dg: [] }, H0 = function (y, a, b) { return 'M' + f1(a) + ' ' + f1(y) + 'H' + f1(b); }, V0 = function (x, a, b) { return 'M' + f1(x) + ' ' + f1(a) + 'V' + f1(b); };
    // the in-town zone, the grid, the axis words
    if (T.length) o.push('<rect class="z" x="' + L + '" y="' + y0 + '" width="' + f1(ZA) + '" height="' + f1(y1 - y0) + '"/>');
    ticks.forEach(function (c) {
      var y = Y(c), ev = c === 0;
      P[ev ? 'ev' : 'gr'].push(H0(y, L, phone ? x1 : W - R));
      o.push(t(L - 8, y + fs * 0.36, word(c), ev ? 'b' : 'mid', 'end'));
    });
    var townHead = 'In ' + cfg.town;
    if (T.length) {
      if (widthOf(townHead, fb, true) > ZA + GX - 4) townHead = 'In town';
      o.push(t(L + ZA / 2, y0 - fb * 0.7, townHead, 'b big', 'middle'));
    }
    if (O.length) {
      var m0 = Math.round(O[0].mi), m1 = Math.round(O[O.length - 1].mi), span = m0 === m1 ? mi(O[0].mi) + ' out' : m0 + ' to ' + m1 + ' miles out';
      var oh = phone ? span : (O.length === 1 ? 'One elevator ' : 'Elevators ') + span;
      o.push(t((x0 + x1) / 2, y0 - fb * 0.7, oh, 'b big', 'middle'));
    } else {
      var nt = phone ? ['No bid on the same', 'terms within ' + NEAR_MI + ' miles'] : ['No other elevator within ' + NEAR_MI + ' miles', 'posted a bid on the same terms'];
      nt.forEach(function (s, i) { o.push(t((x0 + x1) / 2, (y0 + y1) / 2 + (i - 0.5) * fs * 1.4, s, 'mid', 'middle')); });
    }
    // the state's middle bid on the same futures month: one dashed rule
    var ym = p.med ? Y(cents(p.med.median)) : null;
    if (p.med) P.md.push(H0(ym, L, phone ? x1 : W - R));
    // the dots: in town side by side, best first; outside by miles, nudged apart where they would touch
    var dots = [], best = bestOf(p.all), bestC = best ? best.c : null;
    var stT = T.length > 1 ? Math.min(step, (ZA - 2 * pad - 2 * r0) / (T.length - 1)) : step, rT = Math.min(r0, Math.max(1.6, (stT - 0.8) / 2));
    T.forEach(function (r, i) { dots.push({ x: L + pad + rT + i * stT, y: Y(r.c), r: rT, d: r }); });
    // outside town: each dot at its miles, or the nearest free place sideways (alternating right and left, never past
    // the plot), so no two dots touch; the readout gives each one's own miles
    var placed = [], xmax = phone ? W - r0 - 2 : W - R - 4 - r0;
    O.forEach(function (r) {
      var base = Xm(r.mi), y = Y(r.c), q = { x: base, y: y, r: r0, d: r };
      for (var k = 0; k < 400; k++) {
        var x = base + (k % 2 ? (k + 1) / 2 : -k / 2) * 0.5;
        if (x < x0 - r0 || x > xmax) continue;
        if (!placed.some(function (z) { return Math.hypot(z.x - x, z.y - y) < 2 * r0 + 1; })) { q.x = x; break; }
      }
      placed.push(q); dots.push(q);
    });
    dots.forEach(function (q) {
      var prev = q.d.w == null ? null : Math.round((q.d.c - q.d.w) * 10) / 10;
      if (prev != null && prev !== q.d.c) { P.wk.push(V0(q.x, Y(prev), q.y)); add({ x0: q.x - 1.5, x1: q.x + 1.5, y0: Math.min(Y(prev), q.y), y1: Math.max(Y(prev), q.y) }); }
    });
    dots.forEach(function (q, i) {
      q.i = i; q.gold = q.d.c === bestC;
      var pt = 'M' + f1(q.x) + ' ' + f1(q.y) + 'h0'; P.dr.push(pt); P[q.gold ? 'dg' : 'di'].push(pt);
      add({ x0: q.x - q.r - 1, x1: q.x + q.r + 1, y0: q.y - q.r - 1, y1: q.y + q.r + 1 });
    });
    // the words on the data: each tries its places in order and is left off (the readout has it) when none is free
    var inPlot = function (b) { return b.x0 >= L - 2 && b.x1 <= (phone ? W - 2 : W - 2) && b.y0 >= y0 - 2 && b.y1 <= y1 + 2; };
    var place = function (lines, cands, cls) {
      var lh = fs * 1.3, w = Math.max.apply(null, lines.map(function (s, k) { var cl = cls[k] || ''; return widthOf(s, /big/.test(cl) ? fb : fs, /(^| )b( |$)/.test(cl)); }));
      for (var k = 0; k < cands.length; k++) {
        var c = cands[k], x = c.anchor === 'end' ? c.x - w : c.anchor === 'middle' ? c.x - w / 2 : c.x;
        var b = { x0: x - 2, x1: x + w + 2, y0: c.y - fs - 1, y1: c.y + (lines.length - 1) * lh + 4 };
        if ((c.free || inPlot(b)) && !obst.concat(labs).some(function (z) { return hit(z, b); })) {
          lines.forEach(function (s, j) { o.push(t(x, c.y + j * lh, s, cls[j] || '', '')); });
          labs.push(b); return true;
        }
      }
      return false;
    };
    var near = function (q, w, lines) {   // around a dot: above right, above left, below right, below left, right, left
      var lh = fs * 1.3, hgt = lines * lh, g = q.r + 6;
      return [{ x: q.x - q.r, y: q.y - g - hgt + lh * 0.8 }, { x: q.x + q.r, y: q.y - g - hgt + lh * 0.8, anchor: 'end' }, { x: q.x + g, y: q.y + fs * 0.35 },
              { x: q.x - q.r, y: q.y + g + fs }, { x: q.x + q.r, y: q.y + g + fs, anchor: 'end' }, { x: q.x - g, y: q.y + fs * 0.35, anchor: 'end' }];
    };
    var golds = dots.filter(function (q) { return q.gold; });
    var tq = dots.filter(function (q) { return q.d.inTown; }), oq = dots.filter(function (q) { return !q.d.inTown; });
    // 1. the best bid, in the accent: over the best dots in town, or at the best one outside
    if (golds.length && golds[0].d.inTown) {
      var gk = golds.filter(function (q) { return q.d.inTown; }).length, gtxt = word(bestC) + (gk > 1 && !phone ? ': ' + gk + ' bids' : '');
      place([gtxt], [{ x: golds[0].x - golds[0].r, y: golds[0].y - golds[0].r - 8 }, { x: golds[0].x - golds[0].r, y: golds[0].y - golds[0].r - 8 - fs }, { x: golds[0].x - golds[0].r, y: golds[0].y + golds[0].r + fb + 4 }], ['gold b big']);
    }
    // 2. the best bid outside town
    var bo = oq.filter(function (q) { return q.d === bestOf(O); })[0];
    if (bo) {
      var ow = bo.d.town, gcls = bo.gold ? 'gold b big' : 'b big';
      if (phone) place([ow + ', ' + word(bo.d.c)], near(bo, 0, 1), [gcls]);
      else place([bo.gold ? 'Best bid within ' + NEAR_MI + ' miles' : 'Best bid outside town', ow + ', ' + mi(bo.d.mi) + ': ' + word(bo.d.c)], near(bo, 0, 2), ['', gcls]);
    }
    // 3. the lowest in town
    if (tq.length > 1) {
      var lt = tq[tq.length - 1];
      if (lt.d.c !== bestC) {
        var ltx = phone ? ['Lowest in town: ' + word(lt.d.c)] : ['Lowest in town:', word(lt.d.c)];
        var lc = [{ x: lt.x + lt.r + 8, y: lt.y + fs * 0.35 }, { x: L + 6, y: y1 - 8 - (ltx.length - 1) * fs * 1.3 }, { x: lt.x + lt.r + 8, y: lt.y + fs * 1.5 }].concat(near(lt, 0, ltx.length));
        place(ltx, lc, ['', '']);
      }
    }
    // 4. the state median, and 5. the lowest outside town: in the right gutter from 640 px, inside on a phone
    var lo = oq.length > 1 ? oq.filter(function (q) { return q.d.c === lowOf(O).c; }) : [];
    if (lo.length && lo[0].d.c === bestC) lo = [];
    var loTowns = lo.map(function (q) { return q.d.town; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
    var loWho = loTowns.length > 2 ? plural(lo.length, 'elevator') : list(loTowns);
    if (!phone) {
      var gx = W - R + 12, items = [];
      if (p.med) items.push({ y: ym, lines: [st + ' median', word(cents(p.med.median)), plural(p.med.n, 'bid') + ', ' + day(cfg.date)].concat(p.med.usdaShort ? [p.med.usdaShort] : []), cls: ['b big', 'b big', 'mid', 'mid'] });
      if (lo.length) items.push({ y: lo[0].y, lines: ['Lowest: ' + word(lo[0].d.c)].concat(loWho ? [loWho] : []), cls: ['b big', 'mid'] });
      var lh = fs * 1.3;
      items.forEach(function (it) { it.h = it.lines.length * lh; it.top = it.y - it.h / 2; });
      items.sort(function (a, b) { return a.top - b.top; });
      items.forEach(function (it, i) { if (i && it.top < items[i - 1].top + items[i - 1].h + fs * 0.8) it.top = items[i - 1].top + items[i - 1].h + fs * 0.8; it.top = Math.max(y0, Math.min(it.top, y1 - it.h)); });
      items.forEach(function (it) {
        var k = 0;
        it.lines.forEach(function (s, j) {
          var cl = it.cls[j] || '', ws = s.split(' '), cur = '';
          ws.forEach(function (w) { var x = cur ? cur + ' ' + w : w; if (cur && widthOf(x, /big/.test(cl) ? fb : fs, /(^| )b( |$)/.test(cl)) > R - 16) { o.push(t(gx, it.top + fs + k++ * lh, cur, cl, '')); cur = w; } else cur = x; });
          if (cur) o.push(t(gx, it.top + fs + k++ * lh, cur, cl, ''));
        });
      });
    } else {
      if (p.med) {
        var mt = st + ' median ' + word(cents(p.med.median)), mw = widthOf(mt, fs, true);
        place([mt], [{ x: L + 6, y: ym - 6 }, { x: L + 6, y: ym + fs + 4 }, { x: x1 - mw, y: ym - 6 }, { x: x1 - mw, y: ym + fs + 4 }, { x: (L + x1) / 2 - mw / 2, y: ym - 6 }, { x: (L + x1) / 2 - mw / 2, y: ym + fs + 4 }], ['b']);
      }
      if (lo.length) {
        var lw = 'Lowest: ' + (loWho ? loWho + ', ' : '') + word(lo[0].d.c), lww = widthOf(lw, fs);
        if (lww > x1 - x0 + ZA) lw = 'Lowest outside town: ' + word(lo[0].d.c);
        place([lw], [{ x: x1 + 4, y: y1 - 8, anchor: 'end' }, { x: x1 + 4, y: lo[0].y + lo[0].r + fs + 6, anchor: 'end' }].concat(near(lo[0], 0, 1)), ['']);
      }
    }
    // 6. the biggest move in a week outside town, when it is big and there is room (wide only)
    if (!phone) {
      var mv = oq.filter(function (q) { return q.d.w != null && Math.abs(q.d.w) >= 10 && q !== bo && lo.indexOf(q) < 0; }).sort(function (a, b) { return Math.abs(b.d.w) - Math.abs(a.d.w); })[0];
      if (mv) place([mv.d.town + ': ' + word(mv.d.c) + ',', (mv.d.w > 0 ? 'up ' : 'down ') + num(mv.d.w) + ' in a week'], near(mv, 0, 2).slice(2).concat(near(mv, 0, 2).slice(0, 2)), ['', '']);
    }
    // the miles axis, and the count under the town zone
    P.ax.push(H0(y1, x0, x1));
    [0, 10, 20, 30, 40].forEach(function (m) {
      var x = Xm(m);
      P.ax.push(V0(x, y1, y1 + 5));
      o.push(t(x, y1 + fs + 6, String(m), 'mid', 'middle'));
    });
    var axt = 'Miles from ' + cfg.town + ', straight line';
    if (widthOf(axt, fs) > x1 - x0 + GX + ZA) axt = 'Miles, straight line';
    o.push(t(x1 + (phone ? 4 : 6), y1 + fs * 2.6 + 4, axt, 'mid', 'end'));
    if (T.length) o.push(t(L + ZA / 2, y1 + fs + 6, T.length === 1 ? '1 bid' : T.length + ' bids', 'mid', 'middle'));
    var aria = p.Crop + ' basis by distance from ' + cfg.town + ': ' + p.all.length + ' bids within ' + NEAR_MI + ' miles' + (p.med ? ', with the ' + st + ' median' : '') + '.';
    // the lines first, then the dots (a ring of the page colour round each, so dots side by side stay apart), then the words
    var rIn = dots.filter(function (q) { return q.d.inTown; }), ro = rIn.length ? rIn[0].r : r0, wd = function (r) { return f1(2 * r); };
    var dp = function (cls, pts) { return pts.length ? '<path class="' + cls + '" d="' + pts.join('') + '"/>' : ''; };
    var dpts = function (k, inTown) { return dots.filter(function (q) { return q.d.inTown === inTown && (k === 'dg') === q.gold; }).map(function (q) { return 'M' + f1(q.x) + ' ' + f1(q.y) + 'h0'; }); };
    var lines = ['gr', 'ev', 'ax', 'md', 'wk'].map(function (k) { return dp(k, P[k]); }).join('');
    // each set of dots is one path, drawn twice: a ring of the page colour, then the dot (<use> of the same points)
    var uid = 'bd' + (opt.id || 'p'), defs = [], dd = '';
    [true, false].forEach(function (inT, a) {
      var r = inT ? ro : r0;
      ['di', 'dg'].forEach(function (k, b) {
        var pts = dpts(k, inT); if (!pts.length) return;
        var id = uid + a + b; defs.push('<path id="' + id + '" d="' + pts.join('') + '"/>');
        dd += '<use href="#' + id + '" class="dr" style="stroke-width:' + f1(2 * r + 3) + '"/><use href="#' + id + '" class="' + k + '" style="stroke-width:' + wd(r) + '"/>';
      });
    });
    dd = (defs.length ? '<defs>' + defs.join('') + '</defs>' : '') + dd;
    var zone = o.length && /^<rect/.test(o[0]) ? o.shift() : '';
    var s = '<svg class="bd-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(aria) + '" style="font-size:' + fs + 'px' + (opt.card ? ';font-family:' + FONT : '') + '">' +
      (opt.card ? cardStyle(CARD) : '') + zone + lines + dd + o.join('') + '</svg>';
    return { svg: s, dots: dots.map(function (q) { return { x: q.x, y: q.y, r: q.r, i: q.i }; }), H: H, W: W, order: dots.map(function (q) { return q.d; }) };
  }

  /* the default dot the readout opens on: the best bid outside town, else the best in town */
  function firstDot(p) { var b = bestOf(p.out) || bestOf(p.town); return b ? p.all.indexOf(b) : -1; }
  function axisText(p) { return p.Crop + ' basis, cents a bushel over or under ' + (conMon(p.ref && p.ref.vs) || 'the') + ' futures'; }
  function cardText(p, cfg) {
    var st = story(p, cfg);
    return { head: st.head, take: st.take, kicker: cfg.town + ', ' + (cfg.st || '') + ' · ' + p.adj + ' basis by distance', source: (p.prev && p.all.some(function (r) { return r.w != null; }) ? 'Each line runs from where that bid was on ' + day(p.prev) + '. ' : '') + 'Posted elevator bids, read by AGSIST' + (readDays(p) ? ' ' + readDays(p) : '') + (p.med && p.med.usdaShort ? '. ' + p.med.usdaShort : '') + '. No freight cost taken off.' };
  }

  /* The page's box carries only what is its own (st, town, path, ll, from, states, crops, hist). The state's name,
     its middle bid per crop (the headline contract, n, USDA's line) and the day come from data/basis-states.json and
     the state table, the files every town page in the state shares. -> cfg with stName, date and med */
  function prep(cfg, docs, bs) {
    var out = {}, k; for (k in cfg) out[k] = cfg[k];
    var srec = ((bs || {}).states || {})[cfg.st] || {}, doc = (docs || {})[cfg.st] || {};
    out.stName = srec.name || cfg.st; out.date = doc.generated || (bs || {}).generated || '';
    out.med = {};
    CROPS.forEach(function (c) {
      var h = (srec.crops || {})[c[0]];
      if (!h || h.median == null || !h.label) return;
      var u = h.usda, m = { label: h.label, median: h.median, n: h.n };
      if (u && u.line) { m.usda = u.line; if (!u.partial && typeof u.basis === 'number') m.usdaShort = 'USDA average: ' + word(u.basis); }
      out.med[c[0]] = m;
    });
    return out;
  }
  /* the builder's entry: everything the page prints for one crop, the picture at phone width */
  function render(docs, cfg0, crop, W, bs) {
    var cfg = prep(cfg0, docs, bs), p = pick(docs, cfg, crop), st = story(p, cfg), pic = svg(p, cfg, W || 358, {}), k = firstDot(p), rd = readout(p, p.all[k]);
    return { crop: crop, n: p.all.length, inTown: p.town.length, out: p.out.length, head: st.head, take: st.take, axis: axisText(p),
             prev: p.prev ? day(p.prev) : '', svg: pic.svg, read: rd, note: note(p, cfg), first: k };
  }

  /* ---------------------------------------------------------------- the page */
  /* the longest-first word wrap the kit's card uses (components/ag-chart.js fitLines), here so the box needs no kit */
  function fitLines(measure, text, maxW, sizes, maxLines) {
    var lines = [];
    for (var i = 0; i < sizes.length; i++) {
      lines = []; var cur = '';
      String(text || '').split(' ').forEach(function (w) { var x = cur ? cur + ' ' + w : w; if (measure(x, sizes[i]) > maxW && cur) { lines.push(cur); cur = w; } else cur = x; });
      if (cur) lines.push(cur);
      if (lines.length <= maxLines && lines.every(function (l) { return measure(l, sizes[i]) <= maxW; })) return { size: sizes[i], lines: lines };
    }
    return { size: sizes[sizes.length - 1], lines: lines.slice(0, maxLines) };
  }
  function ga(n) { try { if (typeof root.gtag === 'function') root.gtag('event', n, { kit: 'basis-drive' }); } catch (e) {} }
  function card(p, cfg, done) {
    var D = root.document, W = 1200, H = 630, c = D.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d'); if (!x || !root.Image) { done(null); return; }
    var ct2 = cardText(p, cfg), meas = function (wt) { return function (s, size) { x.font = wt + ' ' + size + 'px ' + FONT; return x.measureText(s).width; }; };
    var fit = fitLines;
    x.fillStyle = CARD.bg; x.fillRect(0, 0, W, H); x.fillStyle = CARD.gold; x.fillRect(0, 0, W, 10);
    x.font = '800 34px ' + FONT; x.fillStyle = CARD.ink; x.fillText('agsist', 48, 62);
    var aw = x.measureText('agsist').width; x.font = '700 20px ' + FONT; x.fillStyle = CARD.gold; x.fillText('.com', 50 + aw, 62);
    var mark = 50 + aw + x.measureText('.com').width + 32, kk = fit(meas('600'), ct2.kicker + ' · ' + day(cfg.date) + ', ' + String(cfg.date).slice(0, 4), W - 48 - mark, [20, 18, 16], 1);
    x.font = '600 ' + kk.size + 'px ' + FONT; x.fillStyle = 'rgba(233,237,235,.72)'; x.textAlign = 'right'; x.fillText(hy(kk.lines[0]), W - 48, 60); x.textAlign = 'left';
    var hd = fit(meas('800'), ct2.head, W - 96, [36, 32, 29, 27], 2), y = 82 + hd.size;
    x.font = '800 ' + hd.size + 'px ' + FONT; x.fillStyle = CARD.ink;
    hd.lines.forEach(function (l) { x.fillText(hy(l), 48, y); y += hd.size * 1.18; });
    var tk = fit(meas('400'), ct2.take, W - 96, [21, 19, 18], 2);
    x.font = '400 ' + tk.size + 'px ' + FONT; x.fillStyle = 'rgba(233,237,235,.86)';
    tk.lines.forEach(function (l, i) { x.fillText(hy(l), 48, y + i * tk.size * 1.25); }); y += (tk.lines.length - 1) * tk.size * 1.25 + 10;
    var src = fit(meas('400'), ct2.source, W - 96, [17, 16, 15, 14], 1), url = String(cfg.url || '').replace(/^https?:\/\//, '');
    var ph = Math.max(220, Math.round(H - y - 70)), pic = svg(p, cfg, W - 48, { card: true, fs: 16, h: ph });
    var img = new root.Image();
    img.onload = function () {
      x.drawImage(img, 24, y);
      x.font = '400 ' + src.size + 'px ' + FONT; x.fillStyle = 'rgba(233,237,235,.72)'; x.fillText(hy(src.lines[0]), 48, H - 42);
      x.font = '700 19px ' + FONT; x.fillStyle = CARD.gold; x.fillText(url, 48, H - 16);
      c.toBlob(function (b) { done(b); }, 'image/png');
    };
    img.onerror = function () { done(null); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pic.svg);
  }

  function mount(box) {
    var cfg; try { cfg = JSON.parse(box.getAttribute('data-drive') || '{}'); } catch (e) { return; }
    var q = function (s) { return box.querySelector(s); };
    var plot = q('.bd-plot'), read = q('.bd-read'), head = q('.bd-h'), take = q('.bd-take'), axis = q('.bd-axis'), noteEl = q('.bd-note'), keyPrev = q('.bd-kp');
    var urlC = ''; try { urlC = new URLSearchParams(root.location.search).get('crop') || ''; } catch (e) {}
    if (!cfg.url) { var cn = root.document.querySelector('link[rel="canonical"]'); cfg.url = cn ? cn.href : String(root.location.href).split(/[?#]/)[0]; }
    var docs = null, cur = cfg.crops && cfg.crops.indexOf(urlC) >= 0 ? urlC : (cfg.crops || ['corn'])[0], p = null, pic = null, sel = -1, lastW = 0;
    var say = function (k) {
      var rd = readout(p, p.all[k]);
      read.innerHTML = rd[0] ? '<b>' + esc(hy(rd[0])) + '</b> ' + esc(hy(rd[1])) + ' <span class="bd-hint">Tap a dot to read an elevator.</span>' : '';
    };
    var mark = function () {
      var s = plot.querySelector('.bd-sel'); if (s) s.remove();
      var d = pic && pic.dots[sel]; if (!d) return;
      var c = root.document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('class', 'bd-sel'); c.setAttribute('cx', d.x); c.setAttribute('cy', d.y); c.setAttribute('r', d.r + 3.5);
      plot.querySelector('svg').appendChild(c);
    };
    var choose = function (k) { if (k < 0 || !p.all[k]) return; sel = k; say(k); mark(); };
    var draw = function (force) {
      var W = Math.round(plot.clientWidth); if (!W || !docs || (W === lastW && !force)) return; lastW = W;
      p = pick(docs, cfg, cur);
      var st = story(p, cfg);
      head.textContent = hy(st.head); take.textContent = hy(st.take); axis.textContent = axisText(p); noteEl.textContent = hy(note(p, cfg));
      if (keyPrev) { keyPrev.textContent = p.prev ? 'where it was a week before, ' + day(p.prev) : ''; keyPrev.parentNode.hidden = !p.prev; }
      pic = svg(p, cfg, W, { h: plot.clientHeight || undefined });
      plot.innerHTML = pic.svg;
      // the readout holds the room of its longest line, so nothing under it moves when a dot is read
      var keep = sel >= 0 && p.all[sel] ? sel : firstDot(p), hmax = 0; read.style.minHeight = '0';
      p.all.forEach(function (r, k) { say(k); hmax = Math.max(hmax, read.offsetHeight); });
      read.style.minHeight = hmax + 'px'; sel = -1; choose(keep);
    };
    var near = function (ev) {
      var svgEl = plot.querySelector('svg'); if (!svgEl || !pic) return -1;
      var rc = svgEl.getBoundingClientRect(), sx = pic.W / rc.width, x = (ev.clientX - rc.left) * sx, y = (ev.clientY - rc.top) * sx, b = -1, bd = 1e9;
      pic.dots.forEach(function (d, k) { var dd = Math.hypot(d.x - x, d.y - y); if (dd < bd) { bd = dd; b = k; } });
      return bd <= 26 * sx ? b : -1;
    };
    plot.addEventListener('click', function (ev) { var k = near(ev); if (k >= 0) { choose(k); ga('basis_drive_dot'); } });
    plot.addEventListener('mousemove', function (ev) { var k = near(ev); plot.style.cursor = k >= 0 ? 'pointer' : ''; });
    plot.addEventListener('keydown', function (ev) {
      if (!p || !p.all.length) return;
      var k = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? sel + 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? sel - 1 : ev.key === 'Home' ? 0 : ev.key === 'End' ? p.all.length - 1 : null;
      if (k == null) return;
      ev.preventDefault(); choose(Math.max(0, Math.min(p.all.length - 1, k)));
    });
    [].slice.call(box.querySelectorAll('.bd-crop button')).forEach(function (b, i, all) {
      b.addEventListener('click', function () {
        cur = b.getAttribute('data-crop'); all.forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
        sel = -1; draw(true); ga('basis_drive_crop');
        try { var u = new URL(root.location.href); if (cur === (cfg.crops || [])[0]) u.searchParams.delete('crop'); else u.searchParams.set('crop', cur); root.history.replaceState(null, '', u.toString()); } catch (e) {}
      });
      b.setAttribute('aria-pressed', String(b.getAttribute('data-crop') === cur));
    });
    var views = [].slice.call(box.querySelectorAll('.bd-view button')), hist = q('.bd-hist');
    views.forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-view'); views.forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
        box.classList.toggle('bd-on-hist', v === 'hist');
        if (hist) { hist.hidden = v !== 'hist'; var dt = hist.querySelector('details'); if (dt && v === 'hist' && !dt.open) dt.open = true; }
        ga('basis_drive_view');
      });
    });
    var tools = q('.bd-tools');
    if (tools) {
      var link = function () { var u = (cfg.url || String(root.location.href).split('#')[0].split('?')[0]) + (cur !== (cfg.crops || [])[0] ? '?crop=' + cur : '') + '#drive'; return u; };
      var flash = function (b, s) { var t0 = b.textContent; b.textContent = s; setTimeout(function () { b.textContent = t0; }, 1800); };
      var cp = tools.querySelector('.bd-copy'), sv = tools.querySelector('.bd-save');
      if (cp) cp.addEventListener('click', function () { var u = link(); try { root.navigator.clipboard.writeText(u).then(function () { flash(cp, 'Link copied'); }, function () { flash(cp, u); }); } catch (e) { flash(cp, u); } ga('basis_drive_link'); });
      if (sv) sv.addEventListener('click', function () {
        if (!p) return;
        card(p, Object.assign({}, cfg, { url: link().replace(/#drive$/, '') }), function (b) {
          if (!b) return;
          var a = root.document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'agsist-basis-by-distance-' + String(cfg.path || 'town').split('/').pop() + '-' + cur + '.png';
          root.document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); ga('picture_download');
        });
      });
    }
    var sts = cfg.states && cfg.states.length ? cfg.states : [cfg.st];
    var bsDoc = null;
    var load = function () {
      root.fetch('/data/basis-states.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (b) { bsDoc = b; return Promise.all(sts.map(function (s) { return root.fetch('/data/state-basis/' + s + '.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }))
        ; })
        .then(function (ds) {
          var o = {}; ds.forEach(function (d, i) { if (d && d.cols) o[sts[i]] = d; });
          if (!o[cfg.st]) return;   // the printed picture stays: it was drawn from the same file when the page was built
          docs = o; cfg = prep(cfg, o, bsDoc); box.classList.add('bd-js'); draw(true);
          if (root.ResizeObserver) new root.ResizeObserver(function () { draw(); }).observe(plot); else root.addEventListener('resize', function () { draw(); });
        });
    };
    if (root.IntersectionObserver) { var io = new root.IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); load(); } }, { rootMargin: '400px' }); io.observe(box); }
    else load();
  }
  function init() { [].slice.call(root.document.querySelectorAll('[data-drive]')).forEach(mount); }

  var api = { prep: prep, readDays: readDays, pick: pick, story: story, svg: svg, readout: readout, note: note, render: render, cardText: cardText, word: word, miles: miles, cents: cents, firstDot: firstDot, axisText: axisText, NEAR_MI: NEAR_MI };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.BasisDrive = api;
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init); else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
